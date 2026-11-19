import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { formatTeamList, getTeamAppearanceCounts } from './teamExposureTracker.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import {
  getFplPlayerDirectory,
  detectSurpriseLineupsForClub,
  normalizeDiacritics,
} from './liveMatchStoryGenerator.ts';

/**
 * ============================================================================
 * KONVENSI FPL & STATUS GAMEWEEK:
 * Setelah transfer deadline terlewati, game FPL SUDAH RESMI MASUK KE GAMEWEEK N.
 * Status 'Not started' BUKAN berarti Gameweek N belum dimulai secara game/kalender,
 * melainkan berarti seluruh tim sudah terkunci di GW N, tetapi BELUM ADA
 * PERTANDINGAN YANG DIMULAI (kickoff) di pekan tersebut.
 * 
 * ATURAN BAKU NARASI BERITA (FASE NOT STARTED):
 * - JANGAN gunakan kata "menjelang", "sebelum Gameweek [N:{gw}]", atau frasa
 *   sejenis yang mengesankan Gameweek N belum tiba.
 * - Gunakan frasa: "di Gameweek [N:{gw}]", "pada Gameweek [N:{gw}]", dsb.,
 *   karena kondisi tim dan pilihan sudah resmi aktif di Gameweek N.
 * ============================================================================
 */

const TABLE_PATH = path.join(process.cwd(), 'src/data/news_ticker_table.json');

interface GeneratedPhase1Story {
  id: string;
  headline_id: string;
  headline_en: string;
  kategori: string;
  sub_kategori: string;
  drama_score: number;
  waktu_tayang: string[];
  gw: number;
  teams: string[];
  players: string[];
  sumber: 'Sys' | 'Bukan' | string;
  status_tayang: 'Y' | 'N';
  keterangan_tidak_tayang: string;
  poin_tayang?: number;
  timestamp_produksi?: string;
  cycle_meta?: {
    chance?: number;
    ownersCount?: number;
    cost?: number;
    specialRank?: number;
  };
}

/**
 * Reads existing poin_tayang map directly from database table (scoped to active GW & Not started phase)
 */
function getExistingPoinTayangMap(targetGw?: number): Map<string, number> {
  const map = new Map<string, number>();
  try {
    if (fs.existsSync(TABLE_PATH)) {
      const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (!r || !r.id || typeof r.poin_tayang !== 'number') continue;
          if (targetGw && Number(r.gw) !== targetGw) continue;
          if (r.fase && String(r.fase).trim().toLowerCase() !== 'not started') continue;
          map.set(String(r.id), r.poin_tayang);
        }
      }
    }
  } catch {}
  return map;
}

/**
 * Extracts tagged entities from text
 */
function extractTagNames(text: string, type: 'T' | 'P'): string[] {
  const regex = new RegExp(`\\[${type}:([^\\]]+)\\]`, 'g');
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (!result.includes(m[1].trim())) {
      result.push(m[1].trim());
    }
  }
  return result;
}

/**
 * Formats ISO date to WIB time e.g. "18:30 WIB"
 */
function formatWibTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const utcHours = d.getUTCHours();
    const utcMinutes = d.getUTCMinutes();
    const wibHours = (utcHours + 7) % 24;
    const hh = String(wibHours).padStart(2, '0');
    const mm = String(utcMinutes).padStart(2, '0');
    return `${hh}:${mm} WIB`;
  } catch {
    return '';
  }
}

/**
 * Parses and fills a template containing conditional blocks [Kondisi: ...] or simple template.
 * Returns empty string if conditional template does not match the given conditionKeyword.
 */
function renderTemplateBranch(
  rawTemplate: string,
  conditionKeyword: string,
  variables: Record<string, any>
): string {
  if (!rawTemplate) return '';

  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(rawTemplate);
  let targetBody = rawTemplate;

  if (hasConditions) {
    const lines = rawTemplate.split('\n');
    const matchingSection: string[] = [];
    let isCurrentMatch = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
      if (match) {
        const condName = match[1].toLowerCase();
        isCurrentMatch = condName.includes(conditionKeyword.toLowerCase());
      } else if (isCurrentMatch && line) {
        matchingSection.push(rawLine);
      }
    }

    if (matchingSection.length === 0) {
      return '';
    }
    targetBody = matchingSection.join('\n');
  }

  let result = targetBody;
  for (const [k, v] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

/**
 * Resolves the top player transferred IN and OUT for teams using chips (WC / FH).
 * Returns null if no genuine GW transfer data exists for these teams.
 */
function getTopTransfersForTeams(
  allTransfers: any[],
  teamIds: number[],
  gw: number
): { player_in: string; player_out: string } | null {
  if (!allTransfers || allTransfers.length === 0 || teamIds.length === 0) {
    return null;
  }

  const idSet = new Set(teamIds);
  const relevantTransfers = allTransfers.filter(
    (t) => idSet.has(t.entry_id) && Number(t.event) === Number(gw)
  );

  if (relevantTransfers.length === 0) {
    return null;
  }

  const netByTeam = new Map<number, Map<string, number>>();
  const inCosts: Record<string, number> = {};
  const outCosts: Record<string, number> = {};
  const playerNames: Record<string, string> = {};

  for (const tr of relevantTransfers) {
    const eid = Number(tr.entry_id);
    if (!netByTeam.has(eid)) {
      netByTeam.set(eid, new Map());
    }
    const playerNet = netByTeam.get(eid)!;

    if (tr.element_in?.name) {
      const inId = tr.element_in.id != null ? String(tr.element_in.id) : `name:${tr.element_in.name}`;
      playerNet.set(inId, (playerNet.get(inId) || 0) + 1);
      playerNames[inId] = tr.element_in.name;
      inCosts[inId] = Math.max(inCosts[inId] || 0, tr.element_in?.cost || 0);
    }
    if (tr.element_out?.name) {
      const outId = tr.element_out.id != null ? String(tr.element_out.id) : `name:${tr.element_out.name}`;
      playerNet.set(outId, (playerNet.get(outId) || 0) - 1);
      playerNames[outId] = tr.element_out.name;
      outCosts[outId] = Math.max(outCosts[outId] || 0, tr.element_out?.cost || 0);
    }
  }

  const inFrequency: Record<string, number> = {};
  const outFrequency: Record<string, number> = {};

  for (const playerNet of netByTeam.values()) {
    for (const [idKey, net] of playerNet.entries()) {
      if (net > 0) {
        inFrequency[idKey] = (inFrequency[idKey] || 0) + 1;
      } else if (net < 0) {
        outFrequency[idKey] = (outFrequency[idKey] || 0) + 1;
      }
    }
  }

  const sortedIn = Object.keys(inFrequency).sort((a, b) => {
    if (inFrequency[b] !== inFrequency[a]) return inFrequency[b] - inFrequency[a];
    if ((inCosts[b] || 0) !== (inCosts[a] || 0)) return (inCosts[b] || 0) - (inCosts[a] || 0);
    return (playerNames[a] || a).localeCompare(playerNames[b] || b);
  });

  const sortedOut = Object.keys(outFrequency).sort((a, b) => {
    if (outFrequency[b] !== outFrequency[a]) return outFrequency[b] - outFrequency[a];
    if ((outCosts[b] || 0) !== (outCosts[a] || 0)) return (outCosts[b] || 0) - (outCosts[a] || 0);
    return (playerNames[a] || a).localeCompare(playerNames[b] || b);
  });

  const bestIn = sortedIn[0];
  if (!bestIn) return null;
  const bestOut = sortedOut.find((idKey) => idKey !== bestIn);
  if (!bestOut) return null;

  return {
    player_in: playerNames[bestIn] || bestIn,
    player_out: playerNames[bestOut] || bestOut,
  };
}

/**
 * Resolves Bench Boost summary for Phase 1 (Not started) without fallback.
 * - 1 Tim: daftar seluruh pemain bangku cadangan terurut posisi skuad (`{bench_players}`)
 * - Multi Tim: pemain cadangan teratas berdasarkan frekuensi -> harga -> total poin -> form -> abjad,
 *   beserta `maxCount` untuk membedakan kondisi "Pemain Sama" (maxCount >= 2) vs "Semua Berbeda" (maxCount === 1).
 */
function getBenchBoostSummaryForTeams(
  teamIds: number[]
): { benchPlayersList: string; topPlayer: string; maxCount: number } | null {
  if (!teamIds || teamIds.length === 0) return null;

  try {
    const db = getOptimalDatabase();
    const playersArr = Object.values(db.players || {});
    const idSet = new Set(teamIds);

    const benchCounts: Record<string, number> = {};
    const benchCosts: Record<string, number> = {};
    const benchTotalPts: Record<string, number> = {};
    const benchForm: Record<string, number> = {};
    const singleTeamBench: { name: string; pos: number; cost: number }[] = [];

    for (const p of playersArr as any[]) {
      const owners = p.league_ownership?.owners || [];
      for (const o of owners) {
        if (idSet.has(o.entry_id)) {
          const isBench = o.is_starter === false || (o.position_in_squad != null && o.position_in_squad > 11);
          if (isBench) {
            const name = p.webName || p.web_name || p.name;
            if (!name) continue;
            const cost = Number(p.nowCost || p.cost || 0);
            const totalPts = Number(p.totalPoints || 0);
            const formVal = parseFloat(String(p.form || '0')) || 0;

            benchCounts[name] = (benchCounts[name] || 0) + 1;
            benchCosts[name] = Math.max(benchCosts[name] || 0, cost);
            benchTotalPts[name] = Math.max(benchTotalPts[name] || 0, totalPts);
            benchForm[name] = Math.max(benchForm[name] || 0, formVal);

            if (teamIds.length === 1) {
              singleTeamBench.push({
                name,
                pos: Number(o.position_in_squad || 99),
                cost,
              });
            }
          }
        }
      }
    }

    const sorted = Object.keys(benchCounts).sort((a, b) => {
      if (benchCounts[b] !== benchCounts[a]) return benchCounts[b] - benchCounts[a];
      if (benchCosts[b] !== benchCosts[a]) return (benchCosts[b] || 0) - (benchCosts[a] || 0);
      if (benchTotalPts[b] !== benchTotalPts[a]) return (benchTotalPts[b] || 0) - (benchTotalPts[a] || 0);
      if ((benchForm[b] || 0) !== (benchForm[a] || 0)) return (benchForm[b] || 0) - (benchForm[a] || 0);
      return a.localeCompare(b);
    });

    const topPlayer = sorted[0];
    if (!topPlayer) return null;

    let benchPlayersList = '';
    if (teamIds.length === 1) {
      singleTeamBench.sort((a, b) => {
        if (a.pos !== b.pos) return a.pos - b.pos;
        if (b.cost !== a.cost) return b.cost - a.cost;
        return a.name.localeCompare(b.name);
      });
      const tagged = singleTeamBench.map((x) => `[P:${x.name}]`);
      if (tagged.length === 0) return null;
      if (tagged.length === 1) {
        benchPlayersList = tagged[0];
      } else if (tagged.length === 2) {
        benchPlayersList = `${tagged[0]} dan ${tagged[1]}`;
      } else {
        benchPlayersList = `${tagged.slice(0, -1).join(', ')} dan ${tagged[tagged.length - 1]}`;
      }
    }

    return {
      benchPlayersList,
      topPlayer,
      maxCount: benchCounts[topPlayer] || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the top differing starting XI players between two teams strictly from db.ts.
 * Prioritizes: cost (nowCost) -> total points -> form.
 */
export function getTopDifferingStarters(
  team1Id: number,
  team2Id: number
): {
  player1: string;
  player2: string;
  players1Str: string;
  players2Str: string;
} | null {
  try {
    const db = getOptimalDatabase();
    const playersArr = Object.values(db.players || {});

    function getStarters(entryId: number) {
      return (playersArr as any[])
        .filter((p) =>
          (p.league_ownership?.owners || []).some(
            (o: any) =>
              o.entry_id === entryId &&
              (o.is_starter === true || (o.position_in_squad != null && o.position_in_squad <= 11))
          )
        )
        .map((p) => ({
          id: p.id,
          name: p.webName || p.web_name || p.name,
          cost: Number(p.nowCost || p.cost || 0),
          totalPoints: Number(p.totalPoints || 0),
          form: parseFloat(String(p.form || '0')) || 0,
        }));
    }

    const s1 = getStarters(team1Id);
    const s2 = getStarters(team2Id);

    const s2Ids = new Set(s2.map((p) => p.id));
    const s1Ids = new Set(s1.map((p) => p.id));

    const diff1 = s1.filter((p) => !s2Ids.has(p.id));
    const diff2 = s2.filter((p) => !s1Ids.has(p.id));

    const sortByWeight = (a: any, b: any) => {
      if (b.cost !== a.cost) return b.cost - a.cost;
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return b.form - a.form;
    };

    diff1.sort(sortByWeight);
    diff2.sort(sortByWeight);

    if (diff1.length === 0 || diff2.length === 0) return null;

    const formatPlayerList = (list: any[]) => {
      if (list.length === 1) return `[P:${list[0].name}]`;
      if (list.length === 2) return `[P:${list[0].name}] dan [P:${list[1].name}]`;
      return `[P:${list[0].name}], [P:${list[1].name}], dan [P:${list[2].name}]`;
    };

    return {
      player1: diff1[0].name,
      player2: diff2[0].name,
      players1Str: formatPlayerList(diff1),
      players2Str: formatPlayerList(diff2),
    };
  } catch {
    return null;
  }
}

/**
 * Resolves teams with most gameweek champion titles from GW 1 up to GW (n - 1) strictly from db.ts.
 */
export function getHistoricalMostGwLeaders(
  currentGw: number
): {
  entry_id: number;
  entry_name: string;
  player_name: string;
  titles: number;
  gws_won: number[];
}[] {
  const maxGw = currentGw - 1;
  if (maxGw < 1) return [];

  const db = getOptimalDatabase();
  const teamMap = new Map<
    number,
    {
      entry_id: number;
      entry_name: string;
      player_name: string;
      titles: number;
      gws_won: number[];
    }
  >();

  for (let g = 1; g <= maxGw; g++) {
    const snap = getGwSnapshot(g);
    const gc = snap?.champion;
    if (!gc) continue;
    for (const champ of gc.champions || []) {
      const eid = Number(champ.entry_id);
      const existing = teamMap.get(eid) || {
        entry_id: eid,
        entry_name: champ.entry_name || '',
        player_name: champ.player_name || '',
        titles: 0,
        gws_won: [],
      };
      existing.titles += 1;
      if (!existing.gws_won.includes(g)) {
        existing.gws_won.push(g);
      }
      teamMap.set(eid, existing);
    }
  }

  const list = Array.from(teamMap.values()).filter((t) => t.titles > 0);

  // Peringkat 1 dan 2 di klasemen akhir GW (n - 1) dikecualikan agar tidak bentrok dengan Top Rivalry
  const standingsPrev = [...getDbStandings(maxGw)].sort(
    (a: any, b: any) =>
      Number(a.rank || 999) - Number(b.rank || 999) ||
      Number(b.total_points || 0) - Number(a.total_points || 0)
  );

  const excludedEntryIds = new Set<number>(
    standingsPrev.slice(0, 2).map((s: any) => Number(s.entry_id)).filter(Boolean)
  );

  const candidateList = list.filter((t) => !excludedEntryIds.has(t.entry_id));

  const rankMap = new Map<number, { rank: number; totalPts: number }>();
  standingsPrev.forEach((s: any, idx: number) => {
    rankMap.set(Number(s.entry_id), {
      rank: Number(s.rank || idx + 1),
      totalPts: Number(s.total_points || 0),
    });
  });

  candidateList.sort((a, b) => {
    if (b.titles !== a.titles) return b.titles - a.titles;
    const infoA = rankMap.get(a.entry_id) ?? { rank: 999, totalPts: 0 };
    const infoB = rankMap.get(b.entry_id) ?? { rank: 999, totalPts: 0 };
    return infoA.rank - infoB.rank || infoB.totalPts - infoA.totalPts;
  });

  return candidateList;
}

/**
 * Formats FPL English injury/suspension news into concise Indonesian news phrasing
 */
export function formatInjuryDescription(news?: string): string {
  if (!news) return 'masalah kebugaran';
  const lower = news.toLowerCase();
  if (lower.includes('unspecified injury')) return 'masalah cedera';
  if (lower.includes('muscular') || lower.includes('muscle')) return 'cedera otot';
  if (lower.includes('hamstring')) return 'cedera hamstring';
  if (lower.includes('thigh')) return 'cedera paha';
  if (lower.includes('knee')) return 'cedera lutut';
  if (lower.includes('ankle')) return 'cedera pergelangan kaki';
  if (lower.includes('achilles')) return 'cedera tendon achilles';
  if (lower.includes('calf')) return 'cedera betis';
  if (lower.includes('shin')) return 'cedera tulang kering';
  if (lower.includes('groin')) return 'cedera pangkal paha';
  if (lower.includes('hip')) return 'cedera pinggul';
  if (lower.includes('back')) return 'cedera punggung';
  if (lower.includes('shoulder')) return 'cedera bahu';
  if (lower.includes('collarbone')) return 'cedera tulang selangka';
  if (lower.includes('neck')) return 'cedera leher';
  if (lower.includes('ribs') || lower.includes('rib') || lower.includes('chest')) return 'cedera rusuk';
  if (lower.includes('abdominal') || lower.includes('stomach')) return 'cedera perut';
  if (lower.includes('wrist') || lower.includes('hand') || lower.includes('finger') || lower.includes('thumb')) return 'cedera tangan';
  if (lower.includes('arm') || lower.includes('elbow')) return 'cedera lengan';
  if (lower.includes('foot') || lower.includes('toe')) return 'cedera kaki';
  if (lower.includes('head') || lower.includes('concussion') || lower.includes('facial') || lower.includes('nose')) return 'cedera kepala';
  if (lower.includes('knock')) return 'benturan';
  if (lower.includes('illness') || lower.includes('virus') || lower.includes('flu')) return 'kondisi sakit';
  if (lower.includes('suspended') || lower.includes('suspension') || lower.includes('red card') || lower.includes('yellow card')) return 'sanksi larangan bertanding';
  if (lower.includes('not included in squad') || lower.includes('left out') || lower.includes('not registered')) return 'tidak masuk skuad';
  if (lower.includes('ineligible') || lower.includes('loan')) return 'tidak memenuhi syarat bertanding';
  if (lower.includes('personal')) return 'alasan pribadi';
  if (lower.includes('lack of match fitness') || lower.includes('fitness')) return 'masalah kebugaran';
  if (lower.includes('international')) return 'tugas internasional';
  if (lower.includes('injury')) return 'cedera';
  return 'masalah kebugaran';
}

/**
 * Resolves all flagged players whose news_added occurred after the previous GW deadline
 * (pascadeadline sebelum kick-off pekan berjalan)
 */
interface FlaggedPlayerItem {
  id: number;
  name: string;
  club: string;
  status: string;
  chance: number | null;
  ownersCount: number;
  cost: number;
  injuryDesc: string;
  isOut: boolean;
}

function getAllFlaggedPlayersPostDeadline(gw: number): FlaggedPlayerItem[] {
  try {
    const db = getOptimalDatabase();
    const playersArr = Object.values(db.players || {});
    const deadlines = db.meta?.deadlines || {};
    const prevDeadline = gw > 1 ? deadlines[gw - 1] ?? (deadlines as any)[String(gw - 1)] : undefined;
    const prevDeadlineMs = prevDeadline ? new Date(prevDeadline).getTime() : NaN;
    if (!Number.isFinite(prevDeadlineMs)) return [];

    const candidates: FlaggedPlayerItem[] = [];
    for (const p of playersArr as any[]) {
      if (p.status && p.status !== 'a' && p.news && p.newsAdded) {
        const newsAddedMs = new Date(p.newsAdded).getTime();
        if (!Number.isFinite(newsAddedMs) || newsAddedMs < prevDeadlineMs) continue;
        const ownersCount = p.league_ownership?.count || 0;
        if (ownersCount > 0) {
          const club = resolveClubName(p.teamName || p.teamShort);
          if (!club) continue;
          candidates.push({
            id: p.id,
            name: p.webName || p.web_name,
            club,
            status: p.status,
            chance: p.chanceOfPlayingNextRound ?? null,
            ownersCount,
            cost: p.nowCost || p.cost || 0,
            injuryDesc: formatInjuryDescription(p.news),
            isOut:
              p.status === 'i' ||
              p.status === 's' ||
              p.status === 'n' ||
              p.chanceOfPlayingNextRound === 0,
          });
        }
      }
    }

    candidates.sort((a, b) => {
      if (a.isOut !== b.isOut) return a.isOut ? -1 : 1;
      if (b.ownersCount !== a.ownersCount) return b.ownersCount - a.ownersCount;
      return (b.cost || 0) - (a.cost || 0);
    });

    return candidates;
  } catch {
    return [];
  }
}

/**
 * Generates ready-to-air news stories for all Phase 1 (Not started) templates strictly from db.ts
 */
export function generatePhase1Stories(targetGw?: number, includeRemainingPool: boolean = true): GeneratedPhase1Story[] {
  const templates = getPhase1Templates();
  const db = getOptimalDatabase();
  const currentGw = targetGw || Number(db.meta?.current_gw);
  if (!currentGw) return [];
  const nowIso = new Date().toISOString();

  const gwFixturesAll = db.meta?.sync_status?.gw_fixtures || [];
  const currentFixtures = gwFixturesAll.filter((f: any) => Number(f.event) === currentGw);

  const currentStandings = getDbStandings(currentGw);
  const currentSnap = getGwSnapshot(currentGw);
  const allChipsUsed = db.league_analytics?.all_chips_used || [];
  const allTransfers = db.league_analytics?.all_transfers || [];

  const storiesByTemplateId = new Map<string, GeneratedPhase1Story>();
  let flaggedAscStories: GeneratedPhase1Story[] = [];
  const surpriseLineupStories: GeneratedPhase1Story[] = [];

  for (const tmpl of templates) {
    try {
      let filledHeadline = '';

      switch (tmpl.no) {
        // 1. Match Fixtures
        case 1: {
          if (currentFixtures.length > 0) {
            const sortedFixtures = [...currentFixtures]
              .filter((f: any) => Boolean(f.kickoff_time))
              .sort((a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime());

            if (sortedFixtures.length > 0) {
              const earliestTime = sortedFixtures[0].kickoff_time;
              const opening = sortedFixtures.filter((f: any) => f.kickoff_time === earliestTime);
              const wibTime = formatWibTime(earliestTime);

              if (wibTime && opening.length === 1) {
                const f = opening[0];
                const homeClub = resolveClubName(f.home_team || (f as any).homeClub);
                const awayClub = resolveClubName(f.away_team || (f as any).awayClub);
                if (homeClub && awayClub) {
                  filledHeadline = renderTemplateBranch(tmpl.template, '1 laga', {
                    gw: currentGw,
                    kickoff_time: wibTime,
                    home_club: homeClub,
                    away_club: awayClub,
                  });
                }
              } else if (wibTime && opening.length > 1) {
                const pairs = opening
                  .map((f: any) => {
                    const homeName = resolveClubName(f.home_team || f.homeClub);
                    const awayName = resolveClubName(f.away_team || f.awayClub);
                    return homeName && awayName ? `[C:${homeName}] vs [C:${awayName}]` : '';
                  })
                  .filter(Boolean);
                if (pairs.length > 1) {
                  const listStr = `${pairs.slice(0, -1).join(', ')} dan ${pairs[pairs.length - 1]}`;
                  filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                    gw: currentGw,
                    count: pairs.length,
                    kickoff_time: wibTime,
                    matches_list: listStr,
                  });
                }
              }
            }
          }
          break;
        }

        // 2. Chip Wildcard
        case 2: {
          const rawWcTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if (
              row.entry_name &&
              ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw))
            ) {
              rawWcTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const wcTransfers = getTopTransfersForTeams(
            allTransfers,
            rawWcTeams.map((t) => t.id),
            currentGw
          );

          if (wcTransfers && rawWcTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawWcTeams[0].name,
              teams: `[T:${rawWcTeams[0].name}]`,
              player_in: wcTransfers.player_in,
              player_out: wcTransfers.player_out,
            });
          } else if (wcTransfers && rawWcTeams.length > 1) {
            const teamsStr = formatTeamList(rawWcTeams.map((t) => t.name), 'id', false);
            if (teamsStr) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                teams: teamsStr,
                team: rawWcTeams[0].name,
                player_in: wcTransfers.player_in,
                player_out: wcTransfers.player_out,
              });
            }
          }
          break;
        }

        // 3. Chip Free Hit
        case 3: {
          const rawFhTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if (
              row.entry_name &&
              ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw))
            ) {
              rawFhTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const fhTransfers = getTopTransfersForTeams(
            allTransfers,
            rawFhTeams.map((t) => t.id),
            currentGw
          );

          if (fhTransfers && rawFhTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawFhTeams[0].name,
              teams: `[T:${rawFhTeams[0].name}]`,
              player_in: fhTransfers.player_in,
              player_out: fhTransfers.player_out,
            });
          } else if (fhTransfers && rawFhTeams.length > 1) {
            const teamsStr = formatTeamList(rawFhTeams.map((t) => t.name), 'id', false);
            if (teamsStr) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                teams: teamsStr,
                team: rawFhTeams[0].name,
                player_in: fhTransfers.player_in,
                player_out: fhTransfers.player_out,
              });
            }
          }
          break;
        }

        // 4. Chip Bench Boost
        case 4: {
          const rawBbTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if (
              row.entry_name &&
              ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw))
            ) {
              rawBbTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const bbSummary = getBenchBoostSummaryForTeams(rawBbTeams.map((t) => t.id));

          if (bbSummary && rawBbTeams.length === 1 && bbSummary.benchPlayersList) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawBbTeams[0].name,
              bench_players: bbSummary.benchPlayersList,
            });
          } else if (bbSummary && rawBbTeams.length > 1) {
            const teamsStr = formatTeamList(rawBbTeams.map((t) => t.name), 'id', false);
            if (teamsStr) {
              const condKeyword = bbSummary.maxCount >= 2 ? 'pemain sama' : 'semua berbeda';
              filledHeadline = renderTemplateBranch(tmpl.template, condKeyword, {
                teams: teamsStr,
                player_bench: bbSummary.topPlayer,
              });
            }
          }
          break;
        }

        // 5. Chip Triple Captain
        case 5: {
          const rawTcTeams: { name: string; id: number; captain: string }[] = [];
          for (const row of allChipsUsed) {
            if (
              row.entry_name &&
              ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw))
            ) {
              const tcEntry = currentStandings.find((s: any) => s.entry_id === row.entry_id);
              const capName = tcEntry?.captain?.name || '';
              if (capName) {
                rawTcTeams.push({ name: row.entry_name, id: row.entry_id, captain: capName });
              }
            }
          }
          if (rawTcTeams.length > 0) {
            if (rawTcTeams.length === 1) {
              const single = rawTcTeams[0];
              filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
                team: single.name,
                teams: `[T:${single.name}]`,
                captain: single.captain,
                dominant_captain: single.captain,
                others_clause: '',
              });
            } else {
              const byCaptain = new Map<string, { captain: string; teams: { name: string; id: number; captain: string }[] }>();
              for (const t of rawTcTeams) {
                const key = t.captain.trim().toLowerCase();
                if (!byCaptain.has(key)) byCaptain.set(key, { captain: t.captain, teams: [] });
                byCaptain.get(key)!.teams.push(t);
              }
              const groups = Array.from(byCaptain.values()).sort((a, b) => b.teams.length - a.teams.length);
              const dominantGroup = groups[0];
              const otherTeams = rawTcTeams.filter(
                (t) => t.captain.trim().toLowerCase() !== dominantGroup.captain.trim().toLowerCase()
              );

              const teamsStr = formatTeamList(dominantGroup.teams.map((t) => t.name), 'id', false);
              if (teamsStr) {
                let othersClause = '';
                if (otherTeams.length === 1) {
                  othersClause = `, sementara [T:${otherTeams[0].name}] mengapteni [P:${otherTeams[0].captain}]`;
                } else if (otherTeams.length > 1) {
                  othersClause = `, sementara [N:${otherTeams.length}] tim memilih target berbeda`;
                }

                filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                  teams: teamsStr,
                  team: dominantGroup.teams[0].name,
                  captain: dominantGroup.captain,
                  dominant_captain: dominantGroup.captain,
                  others_clause: othersClause,
                });
              }
            }
          }
          break;
        }

        // 6. Chip Recap
        case 6: {
          if (allChipsUsed.length > 0) {
            let wcCount = 0, fhCount = 0, bbCount = 0, tcCount = 0;
            let wcNew = 0, fhNew = 0, bbNew = 0, tcNew = 0;
            for (const row of allChipsUsed) {
              if (row.wc1 && Number(row.wc1.gw) <= currentGw) { wcCount++; if (Number(row.wc1.gw) === currentGw) wcNew++; }
              if (row.wc2 && Number(row.wc2.gw) <= currentGw) { wcCount++; if (Number(row.wc2.gw) === currentGw) wcNew++; }
              if (row.fh1 && Number(row.fh1.gw) <= currentGw) { fhCount++; if (Number(row.fh1.gw) === currentGw) fhNew++; }
              if (row.fh2 && Number(row.fh2.gw) <= currentGw) { fhCount++; if (Number(row.fh2.gw) === currentGw) fhNew++; }
              if (row.bb1 && Number(row.bb1.gw) <= currentGw) { bbCount++; if (Number(row.bb1.gw) === currentGw) bbNew++; }
              if (row.bb2 && Number(row.bb2.gw) <= currentGw) { bbCount++; if (Number(row.bb2.gw) === currentGw) bbNew++; }
              if (row.tc1 && Number(row.tc1.gw) <= currentGw) { tcCount++; if (Number(row.tc1.gw) === currentGw) tcNew++; }
              if (row.tc2 && Number(row.tc2.gw) <= currentGw) { tcCount++; if (Number(row.tc2.gw) === currentGw) tcNew++; }
            }
            if (wcCount + fhCount + bbCount + tcCount > 0) {
              const wcStr = `[N:Wildcard] [N:${wcCount}]${wcNew > 0 ? ` ([N:+${wcNew}])` : ''}`;
              const fhStr = `[N:Free Hit] [N:${fhCount}]${fhNew > 0 ? ` ([N:+${fhNew}])` : ''}`;
              const bbStr = `[N:Bench Boost] [N:${bbCount}]${bbNew > 0 ? ` ([N:+${bbNew}])` : ''}`;
              const tcStr = `[N:Triple Captain] [N:${tcCount}]${tcNew > 0 ? ` ([N:+${tcNew}])` : ''}`;
              const summary = `${wcStr}, ${fhStr}, ${bbStr} dan ${tcStr}`;

              filledHeadline = renderTemplateBranch(tmpl.template, '', {
                gw: currentGw,
                chips_summary: summary,
              });
            }
          }
          break;
        }

        // 7. Most Transferred In (Bruto, grouping pakai element_in.id, tampilkan element_in.name / web_name)
        case 7: {
          const transfersInMap = new Map<string, { name: string; count: number; cost: number }>();
          for (const tr of allTransfers) {
            if (Number(tr.event) === currentGw && tr.element_in?.name) {
              const idKey = tr.element_in.id != null ? String(tr.element_in.id) : `name:${tr.element_in.name}`;
              const prev = transfersInMap.get(idKey) || { name: tr.element_in.name, count: 0, cost: 0 };
              transfersInMap.set(idKey, {
                name: tr.element_in.name,
                count: prev.count + 1,
                cost: Math.max(prev.cost, Number(tr.element_in?.cost || 0)),
              });
            }
          }
          const sortedIn = Array.from(transfersInMap.values()).sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (b.cost !== a.cost) return b.cost - a.cost;
            return a.name.localeCompare(b.name);
          });
          if (sortedIn.length >= 2) {
            const top1 = sortedIn[0];
            const top2 = sortedIn[1];
            if (top1.count === top2.count) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'Seri di Puncak', {
                player1: top1.name,
                player2: top2.name,
                count1: top1.count,
                keduanya: 'keduanya',
              });
            } else {
              filledHeadline = renderTemplateBranch(tmpl.template, 'Terbanyak Tunggal', {
                player1: top1.name,
                count1: top1.count,
                player2: top2.name,
                count2: top2.count,
              });
            }
          }
          break;
        }

        // 8. Most Transferred Out (Bruto, grouping pakai element_out.id, tampilkan element_out.name / web_name)
        case 8: {
          const transfersOutMap = new Map<string, { name: string; count: number; cost: number }>();
          for (const tr of allTransfers) {
            if (Number(tr.event) === currentGw && tr.element_out?.name) {
              const idKey = tr.element_out.id != null ? String(tr.element_out.id) : `name:${tr.element_out.name}`;
              const prev = transfersOutMap.get(idKey) || { name: tr.element_out.name, count: 0, cost: 0 };
              transfersOutMap.set(idKey, {
                name: tr.element_out.name,
                count: prev.count + 1,
                cost: Math.max(prev.cost, Number(tr.element_out?.cost || 0)),
              });
            }
          }
          const sortedOut = Array.from(transfersOutMap.values()).sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (b.cost !== a.cost) return b.cost - a.cost;
            return a.name.localeCompare(b.name);
          });
          if (sortedOut.length >= 2) {
            const top1 = sortedOut[0];
            const top2 = sortedOut[1];
            if (top1.count === top2.count) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'Seri di Puncak', {
                player1: top1.name,
                player2: top2.name,
                count1: top1.count,
                keduanya: 'keduanya',
              });
            } else {
              filledHeadline = renderTemplateBranch(tmpl.template, 'Terbanyak Tunggal', {
                player1: top1.name,
                count1: top1.count,
                player2: top2.name,
                count2: top2.count,
              });
            }
          }
          break;
        }

        // 9. Captaincy Recap
        case 9: {
          const capPlayers = currentSnap?.top_captains || [];
          if (capPlayers.length >= 1) {
            const dominant = capPlayers[0];
            const second = capPlayers[1];
            const dominantName = dominant?.web_name;
            const dominantCount = dominant?.captain_count;
            const secondName = second?.web_name;
            const secondCount = second?.captain_count;
            if (dominantName && dominantCount != null) {
              const othersCount = capPlayers
                .slice(2)
                .reduce((acc: number, c: any) => acc + (c.captain_count || 0), 0);

              filledHeadline = renderTemplateBranch(tmpl.template, '', {
                dominant_captain: dominantName,
                count1: dominantCount,
                second_clause:
                  secondName && secondCount != null
                    ? `, diikuti [P:${secondName}] ([N:${secondCount}] tim)`
                    : '',
                others_clause:
                  othersCount > 0 ? `, sementara [N:${othersCount}] tim memilih kapten lain` : '',
              });
            }
          }
          break;
        }

        // 10. Hits Recap
        case 10: {
          const minusRows = currentStandings.filter(
            (t: any) => t.event_transfers_cost && Number(t.event_transfers_cost) > 0
          );
          if (minusRows.length > 0) {
            const counts = getTeamAppearanceCounts();
            const sortedRows = [...minusRows].sort((a: any, b: any) => {
              const costDiff = (b.event_transfers_cost || 0) - (a.event_transfers_cost || 0);
              if (costDiff !== 0) return costDiff;

              const cleanA = (a.entry_name || '').trim();
              const cleanB = (b.entry_name || '').trim();
              const countA = counts[cleanA] || 0;
              const countB = counts[cleanB] || 0;
              if (countA !== countB) return countA - countB;
              return cleanA.localeCompare(cleanB);
            });

            const minusTeams = sortedRows.map(
              (t: any) => `[T:${t.entry_name}] ([N:-${t.event_transfers_cost} Poin])`
            );
            let formatted = '';
            if (minusTeams.length === 1) {
              formatted = minusTeams[0];
            } else if (minusTeams.length === 2) {
              formatted = `${minusTeams[0]} dan ${minusTeams[1]}`;
            } else if (minusTeams.length === 3) {
              formatted = `${minusTeams[0]}, ${minusTeams[1]} dan ${minusTeams[2]}`;
            } else {
              formatted = `${minusTeams[0]}, ${minusTeams[1]} dan [N:${minusTeams.length - 2}] tim lainnya`;
            }
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              teams_with_hits: formatted,
            });
          }
          break;
        }

        // 11. Ownership Most Owned
        case 11: {
          const ownPlayers = currentSnap?.ownership_players || [];
          if (ownPlayers.length >= 2) {
            const p1 = ownPlayers[0];
            const p2 = ownPlayers[1];
            if (p1.web_name && p1.owned_percentage != null && p2.web_name && p2.owned_percentage != null) {
              const pct1 = Math.round(Number(p1.owned_percentage));
              const pct2 = Math.round(Number(p2.owned_percentage));
              if (pct1 === pct2) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'Seri di Puncak', {
                  player1: p1.web_name,
                  player2: p2.web_name,
                  pct1,
                  keduanya: 'keduanya',
                });
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, 'Terbanyak Tunggal', {
                  player1: p1.web_name,
                  pct1,
                  player2: p2.web_name,
                  pct2,
                });
              }
            }
          }
          break;
        }

        // 12. Differential Starting XI (Single News: 1 tim paling unik via Opsi B)
        case 12: {
          const playersArr = Object.values(db.players || {});
          const totalLeagueTeams = currentStandings.length;
          if (totalLeagueTeams > 0 && playersArr.length > 0) {
            const diffPlayersMap = new Map<number, { name: string; pct: number; form: number; cost: number }>();
            for (const p of playersArr as any[]) {
              const count = p.league_ownership?.count || 0;
              const rawPct = (count / totalLeagueTeams) * 100;
              const pct = Math.round(rawPct);
              if (count > 0 && rawPct < 5 && (p.webName || p.web_name)) {
                diffPlayersMap.set(p.id, {
                  name: p.webName || p.web_name,
                  pct: pct || 1,
                  form: parseFloat(String(p.form || '0')) || 0,
                  cost: Number(p.nowCost || 0),
                });
              }
            }

            const teamDiffCandidates: { team: any; diffs: any[] }[] = [];
            const counts = getTeamAppearanceCounts();

            for (const s of currentStandings) {
              const starterDiffs: any[] = [];
              for (const p of playersArr as any[]) {
                if (diffPlayersMap.has(p.id)) {
                  const owner = (p.league_ownership?.owners || []).find((o: any) => o.entry_id === s.entry_id);
                  if (owner && (owner.is_starter === true || (owner.position_in_squad != null && owner.position_in_squad <= 11))) {
                    starterDiffs.push(diffPlayersMap.get(p.id));
                  }
                }
              }
              if (starterDiffs.length > 0) {
                starterDiffs.sort((a, b) => {
                  if (b.form !== a.form) return b.form - a.form;
                  return b.cost - a.cost;
                });
                teamDiffCandidates.push({ team: s, diffs: starterDiffs });
              }
            }

            if (teamDiffCandidates.length > 0) {
              teamDiffCandidates.sort((a, b) => {
                if (b.diffs.length !== a.diffs.length) return b.diffs.length - a.diffs.length;
                const cleanA = (a.team.entry_name || '').trim();
                const cleanB = (b.team.entry_name || '').trim();
                const countA = counts[cleanA] || 0;
                const countB = counts[cleanB] || 0;
                if (countA !== countB) return countA - countB;
                return cleanA.localeCompare(cleanB);
              });

              const picked = teamDiffCandidates[0];
              const topDiffs = picked.diffs.slice(0, 2);

              if (topDiffs.length === 1) {
                filledHeadline = renderTemplateBranch(tmpl.template, '1 pemain', {
                  team: picked.team.entry_name,
                  player1: topDiffs[0].name,
                  pct1: topDiffs[0].pct,
                });
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, '2 pemain', {
                  team: picked.team.entry_name,
                  player1: topDiffs[0].name,
                  pct1: topDiffs[0].pct,
                  player2: topDiffs[1].name,
                  pct2: topDiffs[1].pct,
                });
              }
            }
          }
          break;
        }

        // 13. Differential Captain (Single News: kapten terlangka < 5%, Opsi B pada daftar tim)
        case 13: {
          const capPlayers = currentSnap?.top_captains || [];
          const totalLeagueTeams = currentStandings.length;
          const diffCaptains = capPlayers.filter((c: any) => {
            const rawPct =
              totalLeagueTeams > 0 && c.captain_count != null
                ? (Number(c.captain_count) / totalLeagueTeams) * 100
                : Number(c.captain_percentage ?? 100);
            return rawPct < 5;
          });

          if (diffCaptains.length > 0 && currentStandings.length > 0) {
            diffCaptains.sort((a: any, b: any) => {
              const cntDiff = (a.captain_count || 0) - (b.captain_count || 0);
              if (cntDiff !== 0) return cntDiff;
              return (b.now_cost || 0) - (a.now_cost || 0);
            });

            const counts = getTeamAppearanceCounts();
            const targetCap = diffCaptains[0];
            const pickingTeams = currentStandings.filter((s: any) =>
              s.captain?.id != null && targetCap.id != null
                ? Number(s.captain.id) === Number(targetCap.id)
                : s.captain?.name === targetCap.web_name
            );

            if (pickingTeams.length > 0 && targetCap.web_name) {
              pickingTeams.sort((a: any, b: any) => {
                const cleanA = (a.entry_name || '').trim();
                const cleanB = (b.entry_name || '').trim();
                const countA = counts[cleanA] || 0;
                const countB = counts[cleanB] || 0;
                if (countA !== countB) return countA - countB;
                return cleanA.localeCompare(cleanB);
              });

              const pickersCount = targetCap.captain_count ?? pickingTeams.length;
              const isExclusive = pickersCount === 1;

              if (isExclusive) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'kapten eksklusif', {
                  team: pickingTeams[0].entry_name,
                  captain: targetCap.web_name,
                });
              } else {
                const teamsStr = formatTeamList(pickingTeams.map((t: any) => t.entry_name));
                if (teamsStr) {
                  filledHeadline = renderTemplateBranch(tmpl.template, 'kapten differential', {
                    teams: teamsStr,
                    captain: targetCap.web_name,
                    pickers_count: pickersCount,
                  });
                }
              }
            }
          }
          break;
        }

        // 14. Flagged Players (Injury Update Post-Deadline)
        case 14: {
          const flaggedList = getAllFlaggedPlayersPostDeadline(currentGw);
          if (flaggedList.length > 0) {
            const slugCounts = new Map<string, number>();
            for (const item of flaggedList) {
              const s = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
              slugCounts.set(s, (slugCounts.get(s) || 0) + 1);
            }
            flaggedAscStories = flaggedList.map((item) => {
              const cond = item.isOut || (item.chance != null && item.chance === 0) ? 'dipastikan absen' : 'meragukan';
              const headline = renderTemplateBranch(tmpl.template, cond, {
                owners_count: item.ownersCount,
                player: item.name,
                club: item.club,
                injury_desc: item.injuryDesc,
              });
              const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
              const uniqueSuffix = (slugCounts.get(slug) || 0) > 1 ? `${slug}_${item.id}` : slug;
              return {
                id: `${tmpl.id}_${uniqueSuffix}`,
                headline_id: headline,
                headline_en: headline,
                kategori: tmpl.category,
                sub_kategori: tmpl.subcategory,
                drama_score: item.isOut ? 88 : 84,
                waktu_tayang: tmpl.gw_phase ? [tmpl.gw_phase] : ['Not started'],
                gw: Number(tmpl.gw) || currentGw,
                teams: extractTagNames(headline, 'T'),
                players: extractTagNames(headline, 'P'),
                sumber: 'Sys',
                status_tayang: 'Y',
                keterangan_tidak_tayang: '',
                timestamp_produksi: nowIso,
                cycle_meta: {
                  chance: item.chance != null ? item.chance : (item.isOut ? 0 : 50),
                  ownersCount: item.ownersCount,
                  cost: item.cost || 0,
                },
                _flaggedMeta: {
                  id: item.id,
                  chance: item.chance != null ? item.chance : (item.isOut ? 0 : 50),
                  ownersCount: item.ownersCount,
                  cost: item.cost || 0,
                },
              } as any;
            });
          }
          break;
        }

        // 15. Top Rivalry (Sorotan Rivalitas Puncak)
        case 15: {
          const prevGw = currentGw > 1 ? currentGw - 1 : currentGw;
          const prevStandings = getDbStandings(prevGw);
          if (prevStandings.length >= 2) {
            const team1 = prevStandings[0];
            const team2 = prevStandings[1];
            const margin = Math.abs((team1.total_points ?? 0) - (team2.total_points ?? 0));

            let chip1 = '';
            let chip2 = '';
            for (const row of allChipsUsed) {
              if (row.entry_id === team1.entry_id) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) chip1 = 'Wildcard';
                else if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) chip1 = 'Free Hit';
                else if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) chip1 = 'Bench Boost';
                else if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) chip1 = 'Triple Captain';
              }
              if (row.entry_id === team2.entry_id) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) chip2 = 'Wildcard';
                else if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) chip2 = 'Free Hit';
                else if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) chip2 = 'Bench Boost';
                else if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) chip2 = 'Triple Captain';
              }
            }

            const curr1 = currentStandings.find((s: any) => s.entry_id === team1.entry_id);
            const curr2 = currentStandings.find((s: any) => s.entry_id === team2.entry_id);
            const cap1 = curr1?.captain?.name;
            const cap2 = curr2?.captain?.name;

            const marginClause =
              margin === 0 ? ' dengan poin identik' : ` dengan keduanya terpaut [N:${margin} Poin]`;

            if (chip1 && chip2) {
              if (chip1 === chip2) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'chip sama', {
                  team1: team1.entry_name,
                  team2: team2.entry_name,
                  chip: chip1,
                  margin_clause: marginClause,
                });
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, 'duel chip berbeda', {
                  team1: team1.entry_name,
                  team2: team2.entry_name,
                  chip1,
                  chip2,
                  margin_clause: marginClause,
                });
              }
            } else if (chip1 || chip2) {
              const chipTeam = chip1 ? team1.entry_name : team2.entry_name;
              const rivalTeam = chip1 ? team2.entry_name : team1.entry_name;
              const chipName = chip1 || chip2;
              const targetClause =
                margin === 0
                  ? 'memecah kebuntuan poin identik melawan'
                  : chip1
                    ? `memperlebar keunggulan [N:${margin} Poin] atas`
                    : `memangkas jarak [N:${margin} Poin] dari`;
              filledHeadline = renderTemplateBranch(tmpl.template, 'manuver chip', {
                team_chip: chipTeam,
                chip: chipName,
                target_clause: targetClause,
                team_rival: rivalTeam,
              });
            } else if (cap1 && cap2 && cap1 !== cap2) {
              if (margin === 0) {
                filledHeadline = `[T:${team1.entry_name}] dan [T:${team2.entry_name}] mengoleksi poin identik di puncak klasemen, dengan duel kapten [P:${cap1}] vs [P:${cap2}].`;
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                  team1: team1.entry_name,
                  margin,
                  team2: team2.entry_name,
                  captain1: cap1,
                  captain2: cap2,
                });
              }
            } else if (cap1 && cap2 && cap1 === cap2) {
              const diffStarters = getTopDifferingStarters(team1.entry_id, team2.entry_id);
              if (diffStarters) {
                if (margin === 0) {
                  filledHeadline = `[T:${team1.entry_name}] dan [T:${team2.entry_name}] mengoleksi poin identik di puncak klasemen; keduanya mengapteni [P:${cap1}], sehingga penentu selisih poin beralih ke [P:${diffStarters.player1}] dan [P:${diffStarters.player2}].`;
                } else {
                  filledHeadline = renderTemplateBranch(tmpl.template, 'kapten sama', {
                    team1: team1.entry_name,
                    margin,
                    team2: team2.entry_name,
                    captain: cap1,
                    diff_player1: diffStarters.player1,
                    diff_player2: diffStarters.player2,
                    diff_players1: diffStarters.players1Str,
                    diff_players2: diffStarters.players2Str,
                  });
                }
              }
            }
          }
          break;
        }

        // 16. Championship - Most GW Rivalry
        case 16: {
          const mostGwLeaders = getHistoricalMostGwLeaders(currentGw);

          if (mostGwLeaders.length >= 2) {
            const team1 = mostGwLeaders[0];
            const team2 = mostGwLeaders[1];

            let chip1 = '';
            let chip2 = '';
            for (const row of allChipsUsed) {
              if (row.entry_id === team1.entry_id) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) chip1 = 'Wildcard';
                else if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) chip1 = 'Free Hit';
                else if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) chip1 = 'Bench Boost';
                else if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) chip1 = 'Triple Captain';
              }
              if (row.entry_id === team2.entry_id) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) chip2 = 'Wildcard';
                else if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) chip2 = 'Free Hit';
                else if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) chip2 = 'Bench Boost';
                else if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) chip2 = 'Triple Captain';
              }
            }

            const curr1 = currentStandings.find((s: any) => s.entry_id === team1.entry_id);
            const curr2 = currentStandings.find((s: any) => s.entry_id === team2.entry_id);
            const cap1 = curr1?.captain?.name;
            const cap2 = curr2?.captain?.name;

            if (chip1 && chip2) {
              if (chip1 === chip2) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'chip sama', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  chip: chip1,
                });
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, 'duel chip berbeda', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  chip1,
                  chip2,
                });
              }
            } else if (chip1 || chip2) {
              const chipTeam = chip1 ? team1.entry_name : team2.entry_name;
              const chipName = chip1 || chip2;
              filledHeadline = renderTemplateBranch(tmpl.template, 'manuver chip', {
                team_chip: chipTeam,
                chip: chipName,
              });
            } else if (cap1 && cap2 && cap1 !== cap2) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                team1: team1.entry_name,
                titles1: team1.titles,
                team2: team2.entry_name,
                titles2: team2.titles,
                captain1: cap1,
                captain2: cap2,
              });
            } else if (cap1 && cap2 && cap1 === cap2) {
              const diffStarters = getTopDifferingStarters(team1.entry_id, team2.entry_id);
              if (diffStarters) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'kapten sama', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  captain: cap1,
                  diff_player1: diffStarters.player1,
                  diff_player2: diffStarters.player2,
                });
              }
            }
          }
          break;
        }

        // 81. Surprise Lineup (Upcoming Match Lineup Released in NS)
        case 81: {
          const cachedMatches = getCachedMatchesForGw(currentGw) || [];
          const preKickoffWithLineups = cachedMatches.filter(
            (m) =>
              !m.started &&
              m.has_lineup &&
              (m.home_lineup?.length || 0) >= 10 &&
              (m.away_lineup?.length || 0) >= 10
          );
          if (preKickoffWithLineups.length > 0) {
            const { allPlayers } = getFplPlayerDirectory(currentGw);
            for (const m of preKickoffWithLineups) {
              const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
              const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
              if (!homeClub || !awayClub) continue;

              const sides = [
                { club: homeClub, opponent: awayClub, lineup: m.home_lineup, bench: m.home_bench },
                { club: awayClub, opponent: homeClub, lineup: m.away_lineup, bench: m.away_bench },
              ];
              for (const side of sides) {
                const starterFplIds = new Set<number>(side.lineup.filter((p) => p.id > 0).map((p) => p.id));
                const benchFplIds = new Set<number>(side.bench.filter((p) => p.id > 0).map((p) => p.id));
                const starterNamesNorm = new Set<string>(side.lineup.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));
                const benchNamesNorm = new Set<string>(side.bench.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));

                const surprises = detectSurpriseLineupsForClub(
                  side.club,
                  side.opponent,
                  starterFplIds,
                  benchFplIds,
                  side.lineup.length,
                  allPlayers,
                  starterNamesNorm,
                  benchNamesNorm
                );
                for (const surprise of surprises) {
                  const cond = surprise.isBenched ? 'Dicadangkan' : 'Absen dari Skuad';
                  const headline = renderTemplateBranch(tmpl.template, cond, {
                    club: surprise.club,
                    player: surprise.player.webName,
                    starter_pct: surprise.player.starterPct,
                    opponent: surprise.opponent,
                  });
                  if (!headline) continue;

                  const clubSlug = surprise.club.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                  const playerSlug = surprise.player.webName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                  surpriseLineupStories.push({
                    id: `${tmpl.id}_${clubSlug}_${playerSlug}_${surprise.player.id}`,
                    headline_id: headline,
                    headline_en: headline,
                    kategori: tmpl.category,
                    sub_kategori: tmpl.subcategory,
                    drama_score: Math.min(92, 82 + Math.floor(surprise.player.starterPct / 10)),
                    waktu_tayang: tmpl.gw_phase ? [tmpl.gw_phase] : ['Not started'],
                    gw: Number(tmpl.gw) || currentGw,
                    teams: extractTagNames(headline, 'T'),
                    players: [surprise.player.webName],
                    sumber: 'Sys',
                    status_tayang: 'Y',
                    keterangan_tidak_tayang: '',
                    timestamp_produksi: nowIso,
                  });
                }
              }
            }
          }
          break;
        }

        default:
          filledHeadline = '';
          break;
      }

      if (filledHeadline) {
        const teams = extractTagNames(filledHeadline, 'T');
        const players = extractTagNames(filledHeadline, 'P');

        storiesByTemplateId.set(tmpl.id, {
          id: tmpl.id,
          headline_id: filledHeadline,
          headline_en: filledHeadline, // Clean English/Indonesian format
          kategori: tmpl.category,
          sub_kategori: tmpl.subcategory,
          drama_score: 82 + (tmpl.no % 8),
          waktu_tayang: tmpl.gw_phase ? [tmpl.gw_phase] : ['Not started'],
          gw: Number(tmpl.gw) || currentGw,
          teams,
          players,
          sumber: 'Sys',
          status_tayang: 'Y',
          keterangan_tidak_tayang: '',
          timestamp_produksi: nowIso,
        });
      }
    } catch (err: any) {
      console.warn(`[Phase1StoryGenerator] Error generating template ${tmpl.id}:`, err.message);
    }
  }

  // =========================================================================
  // ATURAN SIKLUS ROTASI 5 GELOMBANG TEMATIK & KAIDAH POIN TAYANG (AGENTS.md Sec 7)
  // Aturan Mutlak: Dalam setiap gelombang TIDAK BOLEH ada >1 berita dari kategori sama.
  // 1. Gelombang 1 (Opening & Prime Rivalry):
  //    - NS_MATCH_FIXTURE_OPENING (Match) — wajib paling awal gelombang 1
  //    - NS_STANDINGS_TITLE_RACE (Standings)
  //    - NS_CAPTAIN_POPULAR_MOST_CAPTAINED (Captain)
  //    - NS_CHIP_WILDCARD (Chip)
  //    - (+ NS_LINEUP_SURPRISE_BENCHED [Lineup, MULTI-NEWS] jika lineup rilis pra-kickoff)
  // 2. Gelombang 2 (Transfer Maneuvers & Severe Flagged):
  //    - NS_TRANSFER_HITS_MOST (Transfer)
  //    - NS_CHIP_FREE_HIT (Chip)
  //    - NS_CAPTAIN_DIFFERENTIAL (Captain)
  //    - 1 Flagged Player (Player, MULTI-NEWS: poin_tayang ASC, peluang main ASC) di akhir gelombang 2
  // 3. Gelombang 3 (Weekly Race & Attacking Chips):
  //    - NS_STANDINGS_WEEKLY_WINS_MOST (Standings)
  //    - NS_CHIP_TRIPLE_CAPTAIN (Chip)
  //    - NS_TRANSFER_IN_MOST_BOUGHT (Transfer)
  // 4. Gelombang 4 (Lineup Tactics & Doubtful Flagged):
  //    - NS_LINEUP_DIFFERENTIAL_XI (Lineup)
  //    - NS_CHIP_BENCH_BOOST (Chip)
  //    - NS_TRANSFER_OUT_MOST_SOLD (Transfer)
  //    - 1 Flagged Player (Player, MULTI-NEWS: poin_tayang ASC, peluang main DESC) di akhir gelombang 4
  // 5. Gelombang 5 (Macro Recap & Core Ownership):
  //    - NS_CHIP_SUMMARY_USAGE (Chip)
  //    - NS_PLAYER_OWNERSHIP_MOST_OWNED (Player)
  // =========================================================================

  // Inisialisasi pool kandidat Flagged Players dengan poin_tayang persisten dari database
  interface FlaggedCandidate {
    story: GeneratedPhase1Story;
    meta: { id: number; chance: number; ownersCount: number; cost: number };
    poin_tayang: number;
  }

  const existingPointsMap = getExistingPoinTayangMap(currentGw);

  const flaggedPool: FlaggedCandidate[] = (flaggedAscStories.length > 0 ? flaggedAscStories : []).map((s: any) => ({
    story: s,
    meta: s._flaggedMeta || { id: 0, chance: 0, ownersCount: 0, cost: 0 },
    poin_tayang: existingPointsMap.get(s.id) ?? 0,
  }));

  // =========================================================================
  // PENYUSUNAN ANTREAN JIT (JUST-IN-TIME): TEPAT 1 SIKLUS AKTIF BERJALAN
  // Tidak membuat antrean untuk beberapa siklus ke depan!
  // poin_tayang bertambah +1 oleh sistem antrean ticker saat berita ditayangkan.
  // =========================================================================

  // -------------------------------------------------------------
  // Pemilihan 1 Flagged Player untuk Gelombang 2:
  // Multi-tier sort:
  // 1) poin_tayang ASC (selalu ASCENDING)
  // 2) Peluang main ASC (paling kecil peluangnya / absen)
  // 3) ownersCount DESC, cost DESC
  // -------------------------------------------------------------
  let pickedAscId: string | null = null;
  let pickedAscStory: GeneratedPhase1Story | undefined;
  if (flaggedPool.length > 0) {
    const ascCandidates = [...flaggedPool].sort((a, b) => {
      if (a.poin_tayang !== b.poin_tayang) return a.poin_tayang - b.poin_tayang;
      if (a.meta.chance !== b.meta.chance) return a.meta.chance - b.meta.chance;
      if (b.meta.ownersCount !== a.meta.ownersCount) return b.meta.ownersCount - a.meta.ownersCount;
      return b.meta.cost - a.meta.cost;
    });
    const chosenAsc = ascCandidates[0];
    pickedAscId = chosenAsc.story.id;
    pickedAscStory = {
      ...chosenAsc.story,
      poin_tayang: chosenAsc.poin_tayang,
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    };
  }

  // -------------------------------------------------------------
  // Pemilihan 1 Flagged Player untuk Gelombang 4:
  // Multi-tier sort:
  // 1) Kecualikan pemain yang sudah dipilih di Gelombang 2 (jika pool >= 2)
  // 2) poin_tayang ASC (selalu ASCENDING)
  // 3) Peluang main DESC (peluang tertinggi di antara pemain flagged)
  // 4) ownersCount DESC, cost DESC
  // -------------------------------------------------------------
  let pickedDescId: string | null = null;
  let pickedDescStory: GeneratedPhase1Story | undefined;
  const descPool = flaggedPool.filter((c) => c.story.id !== pickedAscId);
  if (descPool.length > 0) {
    descPool.sort((a, b) => {
      if (a.poin_tayang !== b.poin_tayang) return a.poin_tayang - b.poin_tayang;
      if (b.meta.chance !== a.meta.chance) return b.meta.chance - a.meta.chance;
      if (b.meta.ownersCount !== a.meta.ownersCount) return b.meta.ownersCount - a.meta.ownersCount;
      return b.meta.cost - a.meta.cost;
    });
    const chosenDesc = descPool[0];
    pickedDescId = chosenDesc.story.id;
    pickedDescStory = {
      ...chosenDesc.story,
      poin_tayang: chosenDesc.poin_tayang,
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    };
  }

  const wave1 = [
    storiesByTemplateId.get('NS_MATCH_FIXTURE_OPENING'),
    storiesByTemplateId.get('NS_STANDINGS_TITLE_RACE'),
    storiesByTemplateId.get('NS_CAPTAIN_POPULAR_MOST_CAPTAINED'),
    storiesByTemplateId.get('NS_CHIP_WILDCARD'),
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave2 = [
    storiesByTemplateId.get('NS_TRANSFER_HITS_MOST'),
    storiesByTemplateId.get('NS_CHIP_FREE_HIT'),
    storiesByTemplateId.get('NS_CAPTAIN_DIFFERENTIAL'),
    pickedAscStory,
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave3 = [
    storiesByTemplateId.get('NS_STANDINGS_WEEKLY_WINS_MOST'),
    storiesByTemplateId.get('NS_CHIP_TRIPLE_CAPTAIN'),
    storiesByTemplateId.get('NS_TRANSFER_IN_MOST_BOUGHT'),
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave4 = [
    storiesByTemplateId.get('NS_LINEUP_DIFFERENTIAL_XI'),
    storiesByTemplateId.get('NS_CHIP_BENCH_BOOST'),
    storiesByTemplateId.get('NS_TRANSFER_OUT_MOST_SOLD'),
    pickedDescStory,
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave5 = [
    storiesByTemplateId.get('NS_CHIP_SUMMARY_USAGE'),
    storiesByTemplateId.get('NS_PLAYER_OWNERSHIP_MOST_OWNED'),
  ].filter(Boolean) as GeneratedPhase1Story[];

  const activeCycleItems = [
    ...wave1,
    ...surpriseLineupStories,
    ...wave2,
    ...wave3,
    ...wave4,
    ...wave5,
  ];
  const orderedStories: GeneratedPhase1Story[] = [];

  for (const item of activeCycleItems) {
    const cleanItem = { ...item };
    delete (cleanItem as any)._flaggedMeta;
    if (cleanItem.poin_tayang === undefined) {
      cleanItem.poin_tayang = existingPointsMap.get(cleanItem.id) ?? 0;
    }
    orderedStories.push(cleanItem);
  }

  // Daftarkan seluruh kandidat Flagged Player lainnya tetap dengan status_tayang: 'Y'
  // (tidak pernah mengubah status_tayang menjadi 'N'); pemilihan batch siklus murni memakai poin_tayang.
  if (includeRemainingPool) {
    const registeredIds = new Set(orderedStories.map((s) => s.id));
    for (const f of flaggedPool) {
      if (f.story.id === pickedAscId || f.story.id === pickedDescId) continue;
      const cleanStory: GeneratedPhase1Story = {
        ...f.story,
        poin_tayang: f.poin_tayang,
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
      };
      delete (cleanStory as any)._flaggedMeta;
      if (!registeredIds.has(cleanStory.id)) {
        registeredIds.add(cleanStory.id);
        orderedStories.push(cleanStory);
      }
    }
  }

  return orderedStories;
}

