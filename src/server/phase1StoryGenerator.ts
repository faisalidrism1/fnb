import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { formatTeamList, getTeamAppearanceCounts } from './teamExposureTracker.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';

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
}

/**
 * Reads existing poin_tayang map directly from database table
 */
function getExistingPoinTayangMap(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    if (fs.existsSync(TABLE_PATH)) {
      const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r && r.id && typeof r.poin_tayang === 'number') {
            map.set(String(r.id), r.poin_tayang);
          }
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

  const inFrequency: Record<string, number> = {};
  const outFrequency: Record<string, number> = {};
  const inCosts: Record<string, number> = {};
  const outCosts: Record<string, number> = {};

  for (const tr of relevantTransfers) {
    const pIn = tr.element_in?.name;
    const pOut = tr.element_out?.name;
    if (pIn) {
      inFrequency[pIn] = (inFrequency[pIn] || 0) + 1;
      inCosts[pIn] = Math.max(inCosts[pIn] || 0, tr.element_in?.cost || 0);
    }
    if (pOut) {
      outFrequency[pOut] = (outFrequency[pOut] || 0) + 1;
      outCosts[pOut] = Math.max(outCosts[pOut] || 0, tr.element_out?.cost || 0);
    }
  }

  const sortedIn = Object.keys(inFrequency).sort((a, b) => {
    if (inFrequency[b] !== inFrequency[a]) return inFrequency[b] - inFrequency[a];
    return (inCosts[b] || 0) - (inCosts[a] || 0);
  });

  const sortedOut = Object.keys(outFrequency).sort((a, b) => {
    if (outFrequency[b] !== outFrequency[a]) return outFrequency[b] - outFrequency[a];
    return (outCosts[b] || 0) - (outCosts[a] || 0);
  });

  if (!sortedIn[0] || !sortedOut[0]) return null;
  return {
    player_in: sortedIn[0],
    player_out: sortedOut[0],
  };
}

/**
 * Resolves the top bench player across teams using Bench Boost for Phase 1 (Not started)
 * Hierarki:
 * 1. Frekuensi pemain di bangku cadangan antar tim (kondisi Multi-Tim)
 * 2. Harga pemain tertinggi di bangku cadangan (nowCost)
 * 3. Jika harga sama: Total poin musim berjalan (totalPoints)
 * 4. Jika total poin sama: Form pemain (form)
 */
function getTopBenchPlayerForTeams(teamIds: number[]): string | null {
  if (!teamIds || teamIds.length === 0) return null;

  try {
    const db = getOptimalDatabase();
    const playersArr = Object.values(db.players || {});
    const idSet = new Set(teamIds);

    const benchCounts: Record<string, number> = {};
    const benchCosts: Record<string, number> = {};
    const benchTotalPts: Record<string, number> = {};
    const benchForm: Record<string, number> = {};

    for (const p of playersArr as any[]) {
      const owners = p.league_ownership?.owners || [];
      for (const o of owners) {
        if (idSet.has(o.entry_id)) {
          const isBench = o.is_starter === false || (o.position_in_squad != null && o.position_in_squad > 11);
          if (isBench) {
            const name = p.webName || p.web_name || p.name;
            if (!name) continue;
            benchCounts[name] = (benchCounts[name] || 0) + 1;
            const cost = Number(p.nowCost || p.cost || 0);
            const totalPts = Number(p.totalPoints || 0);
            const formVal = parseFloat(String(p.form || '0')) || 0;

            benchCosts[name] = Math.max(benchCosts[name] || 0, cost);
            benchTotalPts[name] = Math.max(benchTotalPts[name] || 0, totalPts);
            benchForm[name] = Math.max(benchForm[name] || 0, formVal);
          }
        }
      }
    }

    const sorted = Object.keys(benchCounts).sort((a, b) => {
      if (benchCounts[b] !== benchCounts[a]) return benchCounts[b] - benchCounts[a];
      if (benchCosts[b] !== benchCosts[a]) return (benchCosts[b] || 0) - (benchCosts[a] || 0);
      if (benchTotalPts[b] !== benchTotalPts[a]) return (benchTotalPts[b] || 0) - (benchTotalPts[a] || 0);
      return (benchForm[b] || 0) - (benchForm[a] || 0);
    });

    return sorted[0] || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the top differing starting XI players between two teams strictly from db.ts.
 * Prioritizes: cost (nowCost) -> total points -> form.
 */
function getTopDifferingStarters(
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
function getHistoricalMostGwLeaders(
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
function formatInjuryDescription(news?: string): string {
  if (!news) return 'masalah kebugaran';
  const lower = news.toLowerCase();
  if (lower.includes('thigh')) return 'cedera paha';
  if (lower.includes('hamstring')) return 'cedera hamstring';
  if (lower.includes('knee')) return 'cedera lutut';
  if (lower.includes('ankle')) return 'cedera pergelangan kaki';
  if (lower.includes('calf')) return 'cedera betis';
  if (lower.includes('groin')) return 'cedera pangkal paha';
  if (lower.includes('foot')) return 'cedera kaki';
  if (lower.includes('head') || lower.includes('concussion')) return 'cedera kepala';
  if (lower.includes('illness')) return 'kondisi sakit';
  if (lower.includes('suspended')) return 'sanksi larangan bertanding';
  return news.split(' - ')[0].toLowerCase();
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
    if (!prevDeadline) return [];

    const candidates: FlaggedPlayerItem[] = [];
    for (const p of playersArr as any[]) {
      if (p.news && p.newsAdded && p.newsAdded >= prevDeadline) {
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
            isOut: p.status === 'i' || p.chanceOfPlayingNextRound === 0,
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

  const gwFixturesAll = db.meta?.sync_status?.gw_fixtures || [];
  const currentFixtures = gwFixturesAll.filter((f: any) => Number(f.event) === currentGw);
  const isGwNotStarted =
    db.meta?.gw_status?.status === 'Not started' ||
    (currentFixtures.length > 0 && currentFixtures.every((f: any) => !f.started));

  const currentStandings = getDbStandings(currentGw);
  const currentSnap = getGwSnapshot(currentGw);
  const allChipsUsed = db.league_analytics?.all_chips_used || [];
  const allTransfers = db.league_analytics?.all_transfers || [];

  const storiesByTemplateId = new Map<string, GeneratedPhase1Story>();
  let flaggedAscStories: GeneratedPhase1Story[] = [];

  for (const tmpl of templates) {
    try {
      let filledHeadline = '';

      switch (tmpl.no) {
        // 1. Match Fixtures
        case 1: {
          if (currentFixtures.length > 0) {
            const earliestTime = currentFixtures[0].kickoff_time;
            const opening = currentFixtures.filter((f: any) => f.kickoff_time === earliestTime);
            const wibTime = formatWibTime(earliestTime);

            if (wibTime && opening.length === 1) {
              const f = opening[0];
              const homeClub = resolveClubName(f.home_team);
              const awayClub = resolveClubName(f.away_team);
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
                const listStr = pairs
                  .map((p, i) => (i === pairs.length - 1 ? `dan ${p}` : p))
                  .join(', ');
                filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                  gw: currentGw,
                  count: pairs.length,
                  kickoff_time: wibTime,
                  matches_list: listStr,
                });
              }
            }
          }
          break;
        }

        // 2. Chip Wildcard
        case 2: {
          const rawWcTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) {
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
              gw: currentGw,
              player_in: wcTransfers.player_in,
              player_out: wcTransfers.player_out,
            });
          } else if (wcTransfers && rawWcTeams.length > 1) {
            const teamsStr = formatTeamList(rawWcTeams.map((t) => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawWcTeams[0].name,
              gw: currentGw,
              player_in: wcTransfers.player_in,
              player_out: wcTransfers.player_out,
            });
          }
          break;
        }

        // 3. Chip Free Hit
        case 3: {
          const rawFhTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) {
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
              gw: currentGw,
              player_in: fhTransfers.player_in,
              player_out: fhTransfers.player_out,
            });
          } else if (fhTransfers && rawFhTeams.length > 1) {
            const teamsStr = formatTeamList(rawFhTeams.map((t) => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawFhTeams[0].name,
              gw: currentGw,
              player_in: fhTransfers.player_in,
              player_out: fhTransfers.player_out,
            });
          }
          break;
        }

        // 4. Chip Bench Boost
        case 4: {
          const rawBbTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) {
              rawBbTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const bbBenchPlayer = getTopBenchPlayerForTeams(rawBbTeams.map((t) => t.id));

          if (bbBenchPlayer && rawBbTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawBbTeams[0].name,
              teams: `[T:${rawBbTeams[0].name}]`,
              gw: currentGw,
              player_bench: bbBenchPlayer,
            });
          } else if (bbBenchPlayer && rawBbTeams.length > 1) {
            const teamsStr = formatTeamList(rawBbTeams.map((t) => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawBbTeams[0].name,
              gw: currentGw,
              player_bench: bbBenchPlayer,
            });
          }
          break;
        }

        // 5. Chip Triple Captain
        case 5: {
          const rawTcTeams: { name: string; id: number }[] = [];
          for (const row of allChipsUsed) {
            if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) {
              rawTcTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          if (rawTcTeams.length > 0) {
            const tcEntry = currentStandings.find((s: any) => s.entry_id === rawTcTeams[0].id);
            const dynamicCaptain = tcEntry?.captain?.name;
            if (dynamicCaptain) {
              if (rawTcTeams.length === 1) {
                filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
                  team: rawTcTeams[0].name,
                  teams: `[T:${rawTcTeams[0].name}]`,
                  captain: dynamicCaptain,
                  dominant_captain: dynamicCaptain,
                  gw: currentGw,
                  others_clause: '',
                });
              } else {
                const teamsStr = formatTeamList(rawTcTeams.map((t) => t.name), 'id', false);
                filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                  teams: teamsStr,
                  team: rawTcTeams[0].name,
                  captain: dynamicCaptain,
                  dominant_captain: dynamicCaptain,
                  gw: currentGw,
                  others_clause:
                    rawTcTeams.length > 2
                      ? `, sementara [N:${rawTcTeams.length - 2}] tim lainnya memilih opsi kapten berbeda`
                      : '',
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
            const wcStr = `[N:Wildcard] [N:${wcCount}]${wcNew > 0 ? ` (+[N:${wcNew}] pekan ini)` : ''}`;
            const fhStr = `[N:Free Hit] [N:${fhCount}]${fhNew > 0 ? ` (+[N:${fhNew}] pekan ini)` : ''}`;
            const bbStr = `[N:Bench Boost] [N:${bbCount}]${bbNew > 0 ? ` (+[N:${bbNew}] pekan ini)` : ''}`;
            const tcStr = `[N:Triple Captain] [N:${tcCount}]${tcNew > 0 ? ` (+[N:${tcNew}] pekan ini)` : ''}`;
            const summary = `${wcStr}, ${fhStr}, ${bbStr}, dan ${tcStr}`;

            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              chips_summary: summary,
            });
          }
          break;
        }

        // 7. Most Transferred In
        case 7: {
          const transfersInMap = new Map<string, number>();
          for (const tr of allTransfers) {
            if (Number(tr.event) === currentGw && tr.element_in?.name) {
              const name = tr.element_in.name;
              transfersInMap.set(name, (transfersInMap.get(name) || 0) + 1);
            }
          }
          const sortedIn = Array.from(transfersInMap.entries()).sort((a, b) => b[1] - a[1]);
          if (sortedIn.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              player1: sortedIn[0][0],
              count1: sortedIn[0][1],
              player2: sortedIn[1][0],
              count2: sortedIn[1][1],
            });
          }
          break;
        }

        // 8. Most Transferred Out
        case 8: {
          const transfersOutMap = new Map<string, number>();
          for (const tr of allTransfers) {
            if (Number(tr.event) === currentGw && tr.element_out?.name) {
              const name = tr.element_out.name;
              transfersOutMap.set(name, (transfersOutMap.get(name) || 0) + 1);
            }
          }
          const sortedOut = Array.from(transfersOutMap.entries()).sort((a, b) => b[1] - a[1]);
          if (sortedOut.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              player1: sortedOut[0][0],
              count1: sortedOut[0][1],
              player2: sortedOut[1][0],
              count2: sortedOut[1][1],
            });
          }
          break;
        }

        // 9. Captaincy Recap
        case 9: {
          const capPlayers = currentSnap?.top_captains || [];
          if (capPlayers.length >= 2) {
            const dominant = capPlayers[0];
            const second = capPlayers[1];
            const dominantName = dominant.web_name;
            const dominantCount = dominant.captain_count;
            const secondName = second.web_name;
            const secondCount = second.captain_count;
            if (dominantName && dominantCount != null && secondName && secondCount != null) {
              const othersCount = capPlayers
                .slice(2)
                .reduce((acc: number, c: any) => acc + (c.captain_count || 0), 0);

              filledHeadline = renderTemplateBranch(tmpl.template, '', {
                gw: currentGw,
                dominant_captain: dominantName,
                count1: dominantCount,
                player2: secondName,
                second_captain: secondName,
                count2: secondCount,
                count_others: othersCount,
                others_count: othersCount,
                second_clause: `, disusul [P:${secondName}] dengan [N:${secondCount}] tim`,
                others_clause:
                  othersCount > 0 ? `, sementara [N:${othersCount}] tim lainnya memilih kapten alternatif` : '',
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
              (t: any) => `[T:${t.entry_name}] (-[N:${t.event_transfers_cost} Poin])`
            );
            let formatted = '';
            if (minusTeams.length === 1) {
              formatted = minusTeams[0];
            } else if (minusTeams.length === 2) {
              formatted = `${minusTeams[0]} dan ${minusTeams[1]}`;
            } else if (minusTeams.length === 3) {
              formatted = `${minusTeams[0]}, ${minusTeams[1]}, dan ${minusTeams[2]}`;
            } else {
              formatted = `${minusTeams[0]}, ${minusTeams[1]}, dan [N:${minusTeams.length - 2}] tim lainnya`;
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
              filledHeadline = renderTemplateBranch(tmpl.template, '', {
                player1: p1.web_name,
                pct1: Math.round(Number(p1.owned_percentage)),
                player2: p2.web_name,
                pct2: Math.round(Number(p2.owned_percentage)),
              });
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
              const pct = Math.round((count / totalLeagueTeams) * 100);
              if (count > 0 && pct < 5 && (p.webName || p.web_name)) {
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
                  gw: currentGw,
                  player1: topDiffs[0].name,
                  pct1: topDiffs[0].pct,
                });
              } else {
                filledHeadline = renderTemplateBranch(tmpl.template, '2 pemain', {
                  team: picked.team.entry_name,
                  gw: currentGw,
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

        // 13. Differential Captain (Single News: 1 tim kapten langka via Opsi B)
        case 13: {
          const capPlayers = currentSnap?.top_captains || [];
          const diffCaptains = capPlayers.filter(
            (c: any) =>
              (c.captain_percentage != null && c.captain_percentage < 5) ||
              (c.captain_count != null && c.captain_count <= 2)
          );

          if (diffCaptains.length > 0 && currentStandings.length > 0) {
            diffCaptains.sort((a: any, b: any) => {
              const cntDiff = (a.captain_count || 0) - (b.captain_count || 0);
              if (cntDiff !== 0) return cntDiff;
              return (b.now_cost || 0) - (a.now_cost || 0);
            });

            const counts = getTeamAppearanceCounts();
            const targetCap = diffCaptains[0];
            const pickingTeams = currentStandings.filter(
              (s: any) =>
                s.captain?.id === targetCap.id ||
                s.captain?.name === targetCap.web_name
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

              const selectedTeam = pickingTeams[0];
              const pickersCount = targetCap.captain_count ?? pickingTeams.length;
              const isExclusive = pickersCount === 1;
              const cond = isExclusive ? 'kapten eksklusif' : 'kapten differential';

              filledHeadline = renderTemplateBranch(tmpl.template, cond, {
                team: selectedTeam.entry_name,
                captain: targetCap.web_name,
                gw: currentGw,
                pickers_count: pickersCount,
              });
            }
          }
          break;
        }

        // 14. Flagged Players (Injury Update Post-Deadline)
        case 14: {
          const flaggedList = getAllFlaggedPlayersPostDeadline(currentGw);
          if (flaggedList.length > 0) {
            flaggedAscStories = flaggedList.map((item) => {
              const cond = item.isOut || (item.chance != null && item.chance === 0) ? 'dipastikan absen' : 'meragukan';
              const headline = renderTemplateBranch(tmpl.template, cond, {
                owners_count: item.ownersCount,
                player: item.name,
                club: item.club,
                injury_desc: item.injuryDesc,
                gw: currentGw,
              });
              const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
              return {
                id: `${tmpl.id}_${slug}`,
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
                status_tayang: isGwNotStarted ? 'Y' : 'N',
                keterangan_tidak_tayang: isGwNotStarted ? '' : 'Fase saat ini bukan Not started',
                timestamp_produksi: tmpl.timestamp || tmpl.updated_at || new Date().toISOString(),
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

            if (chip1 || chip2) {
              const chipTeam = chip1 ? team1.entry_name : team2.entry_name;
              const rivalTeam = chip1 ? team2.entry_name : team1.entry_name;
              const chipName = chip1 || chip2;
              const targetClause = chip1 ? 'memperlebar' : 'memangkas';
              filledHeadline = renderTemplateBranch(tmpl.template, 'manuver chip', {
                gw: currentGw,
                team_chip: chipTeam,
                chip: chipName,
                target_clause: targetClause,
                margin,
                team_rival: rivalTeam,
              });
            } else if (cap1 && cap2 && cap1 !== cap2) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                gw: currentGw,
                team1: team1.entry_name,
                margin,
                team2: team2.entry_name,
                captain1: cap1,
                captain2: cap2,
              });
            } else if (cap1 && cap2 && cap1 === cap2) {
              const diffStarters = getTopDifferingStarters(team1.entry_id, team2.entry_id);
              if (diffStarters) {
                filledHeadline = renderTemplateBranch(tmpl.template, 'kapten sama', {
                  gw: currentGw,
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

            if (chip1 || chip2) {
              const chipTeam = chip1 ? team1.entry_name : team2.entry_name;
              const rivalTeam = chip1 ? team2.entry_name : team1.entry_name;
              const chipName = chip1 || chip2;
              filledHeadline = renderTemplateBranch(tmpl.template, 'manuver chip', {
                gw: currentGw,
                team_chip: chipTeam,
                chip: chipName,
                team_rival: rivalTeam,
              });
            } else if (cap1 && cap2 && cap1 !== cap2) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                gw: currentGw,
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
                  gw: currentGw,
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  captain: cap1,
                  diff_player1: diffStarters.player1,
                  diff_player2: diffStarters.player2,
                  diff_players1: diffStarters.players1Str,
                  diff_players2: diffStarters.players2Str,
                });
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
          status_tayang: isGwNotStarted ? 'Y' : 'N',
          keterangan_tidak_tayang: isGwNotStarted ? '' : 'Fase saat ini bukan Not started',
          timestamp_produksi: tmpl.timestamp || tmpl.updated_at || new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.warn(`[Phase1StoryGenerator] Error generating template ${tmpl.id}:`, err.message);
    }
  }

  // =========================================================================
  // ATURAN SIKLUS ROTASI 4 GELOMBANG TEMATIK & KAIDAH POIN TAYANG (AGENTS.md Sec 7)
  // 1. Gelombang 1:
  //    - Fixture SELALU di paling awal gelombang 1
  //    - Top Rivalry (Puncak Klasemen P1 vs P2)
  //    - Captaincy Recap (Sebaran Kapten Dominan Liga)
  // 2. Gelombang 2:
  //    - Hits Recap (Agresivitas Minus Transfer)
  //    - Wildcard Use & Freehit Use (Manuver Chip Skuad)
  //    - Most Transferred In (Pembelian Terbanyak)
  //    - Differential Captain (Keberanian Kapten Langka)
  //    - 1 Flagged player (Multi-tier: poin_tayang ASC, peluang main ASC) di AKHIR gelombang 2
  // 3. Gelombang 3:
  //    - Most GW Rivalry (Perburuan Gelar Mingguan Terbanyak)
  //    - Triple Captain Use & Bench Boost Use (Chip Daya Ledak Poin)
  //    - Most Transferred Out (Pelepasan Terbanyak)
  //    - Differential XI (Pilihan Pembeda Starting XI)
  // 4. Gelombang 4:
  //    - Most Owned (Aset Esensial Kepemilikan Tertinggi)
  //    - Chip Recap (Akumulasi Penggunaan Seluruh Chip)
  //    - 1 Flagged player (Multi-tier: poin_tayang ASC, peluang main DESC) di AKHIR gelombang 4
  // =========================================================================

  // Inisialisasi pool kandidat Flagged Players dengan poin_tayang persisten dari database
  interface FlaggedCandidate {
    story: GeneratedPhase1Story;
    meta: { id: number; chance: number; ownersCount: number; cost: number };
    poin_tayang: number;
  }

  const existingPointsMap = getExistingPoinTayangMap();

  // Hitung baseline poin tayang untuk siklus aktif saat ini
  let currentCycle = 1;
  for (const [id, pts] of existingPointsMap.entries()) {
    if (id.includes(`gw${currentGw}`) && pts > currentCycle) {
      currentCycle = pts;
    }
  }

  const flaggedPool: FlaggedCandidate[] = (flaggedAscStories.length > 0 ? flaggedAscStories : []).map((s: any) => ({
    story: s,
    meta: s._flaggedMeta || { id: 0, chance: 0, ownersCount: 0, cost: 0 },
    poin_tayang: existingPointsMap.get(s.id) ?? 0,
  }));

  // =========================================================================
  // PENYUSUNAN ANTREAN JIT (JUST-IN-TIME): TEPAT 1 SIKLUS AKTIF BERJALAN
  // Tidak membuat antrean untuk beberapa siklus ke depan!
  // Poin tayang terbesar di database selalu merepresentasikan siklus yang sedang berjalan.
  // =========================================================================

  // -------------------------------------------------------------
  // Pemilihan 1 Flagged Player untuk Gelombang 2:
  // Multi-tier sort:
  // 1) poin_tayang ASC (selalu ASCENDING)
  // 2) Peluang main ASC (paling kecil peluangnya / absen)
  // 3) ownersCount DESC, cost DESC
  // -------------------------------------------------------------
  let pickedAscStory: GeneratedPhase1Story | undefined;
  if (flaggedPool.length > 0) {
    flaggedPool.sort((a, b) => {
      if (a.poin_tayang !== b.poin_tayang) return a.poin_tayang - b.poin_tayang;
      if (a.meta.chance !== b.meta.chance) return a.meta.chance - b.meta.chance;
      if (b.meta.ownersCount !== a.meta.ownersCount) return b.meta.ownersCount - a.meta.ownersCount;
      return b.meta.cost - a.meta.cost;
    });
    const chosenAsc = flaggedPool[0];
    chosenAsc.poin_tayang = Math.max(chosenAsc.poin_tayang + 1, currentCycle);
    pickedAscStory = {
      ...chosenAsc.story,
      poin_tayang: chosenAsc.poin_tayang,
    };
  }

  // -------------------------------------------------------------
  // Pemilihan 1 Flagged Player untuk Gelombang 4:
  // Multi-tier sort:
  // 1) poin_tayang ASC (selalu ASCENDING) -> Menjamin pemain berbeda dari Wave 2 terpilih!
  // 2) Peluang main DESC (peluang tertinggi di antara cedera)
  // 3) ownersCount DESC, cost DESC
  // -------------------------------------------------------------
  let pickedDescStory: GeneratedPhase1Story | undefined;
  if (flaggedPool.length > 0) {
    flaggedPool.sort((a, b) => {
      if (a.poin_tayang !== b.poin_tayang) return a.poin_tayang - b.poin_tayang;
      if (b.meta.chance !== a.meta.chance) return b.meta.chance - a.meta.chance;
      if (b.meta.ownersCount !== a.meta.ownersCount) return b.meta.ownersCount - a.meta.ownersCount;
      return b.meta.cost - a.meta.cost;
    });
    const chosenDesc = flaggedPool[0];
    chosenDesc.poin_tayang = Math.max(chosenDesc.poin_tayang + 1, currentCycle);
    pickedDescStory = {
      ...chosenDesc.story,
      poin_tayang: chosenDesc.poin_tayang,
    };
  }

  const wave1 = [
    storiesByTemplateId.get('NS_MATCH_FIXTURE'),
    storiesByTemplateId.get('NS_TOP_RIVALRY'),
    storiesByTemplateId.get('NS_CAPTAIN_RECAP'),
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave2 = [
    storiesByTemplateId.get('NS_HITS_RECAP'),
    storiesByTemplateId.get('NS_CHIP_WILDCARD'),
    storiesByTemplateId.get('NS_CHIP_FREEHIT'),
    storiesByTemplateId.get('NS_TRANSFER_IN'),
    storiesByTemplateId.get('NS_DIFFERENTIAL_CAPTAIN'),
    pickedAscStory,
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave3 = [
    storiesByTemplateId.get('NS_MOST_GW_RIVALRY'),
    storiesByTemplateId.get('NS_CHIP_TRIPLE_CAPTAIN'),
    storiesByTemplateId.get('NS_CHIP_BENCH_BOOST'),
    storiesByTemplateId.get('NS_TRANSFER_OUT'),
    storiesByTemplateId.get('NS_DIFFERENTIAL_XI'),
  ].filter(Boolean) as GeneratedPhase1Story[];

  const wave4 = [
    storiesByTemplateId.get('NS_MOST_OWNED'),
    storiesByTemplateId.get('NS_CHIP_RECAP'),
    pickedDescStory,
  ].filter(Boolean) as GeneratedPhase1Story[];

  const activeCycleItems = [...wave1, ...wave2, ...wave3, ...wave4];
  const orderedStories: GeneratedPhase1Story[] = [];

  for (const item of activeCycleItems) {
    const cleanItem = { ...item };
    delete (cleanItem as any)._flaggedMeta;
    // Beri poin tayang siklus aktif jika belum terdefinisi
    if (cleanItem.poin_tayang === undefined) {
      cleanItem.poin_tayang = Math.max(existingPointsMap.get(cleanItem.id) ?? 0, currentCycle);
    }
    orderedStories.push(cleanItem);
  }

  // Jika diminta (default untuk master DB table), sertakan sisa kandidat cedera yang belum tayang
  // di siklus ini agar tetap terdaftar lengkap di tabel dengan poin_tayang mereka saat ini (0 / sebelumnya)
  if (includeRemainingPool) {
    const registeredIds = new Set(orderedStories.map((s) => s.id));
    for (const f of flaggedPool) {
      const cleanStory = { ...f.story, poin_tayang: f.poin_tayang };
      delete (cleanStory as any)._flaggedMeta;
      if (!registeredIds.has(cleanStory.id)) {
        registeredIds.add(cleanStory.id);
        orderedStories.push(cleanStory);
      }
    }
  }

  return orderedStories;
}

