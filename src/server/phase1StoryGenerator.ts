import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { formatTeamList } from './liveJournalismEngine.ts';
import { sortTeamsByLeastFeatured, sortObjectsByLeastFeaturedTeam, getTeamAppearanceCounts } from './teamExposureTracker.ts';

const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');
const DB_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');

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
  sumber: 'Bukan';
  status_tayang: 'Y' | 'N';
  keterangan_tidak_tayang: string;
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
  if (!isoString) return '18:30 WIB';
  try {
    const d = new Date(isoString);
    // WIB is UTC+7
    const utcHours = d.getUTCHours();
    const utcMinutes = d.getUTCMinutes();
    const wibHours = (utcHours + 7) % 24;
    const hh = String(wibHours).padStart(2, '0');
    const mm = String(utcMinutes).padStart(2, '0');
    return `${hh}:${mm} WIB`;
  } catch {
    return '18:30 WIB';
  }
}

/**
 * Parses and fills a template containing conditional blocks [Kondisi: ...] or simple template
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
    let matchingSection: string[] = [];
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

    if (matchingSection.length > 0) {
      targetBody = matchingSection.join('\n');
    } else {
      // Fallback: pick first condition body if specific match not found
      const firstSection: string[] = [];
      let collectingFirst = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (/^\[Kondisi:/i.test(line)) {
          if (collectingFirst) break;
          collectingFirst = true;
        } else if (collectingFirst && line) {
          firstSection.push(rawLine);
        }
      }
      if (firstSection.length > 0) targetBody = firstSection.join('\n');
    }
  }

  let result = targetBody;
  for (const [k, v] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

/**
 * Resolves the top player transferred IN and OUT for teams using chips (WC / FH)
 */
function getTopTransfersForTeams(
  allTransfers: any[],
  teamIds: number[],
  gw: number,
  fallbackIn: string,
  fallbackOut: string
): { player_in: string; player_out: string } {
  if (!allTransfers || allTransfers.length === 0 || teamIds.length === 0) {
    return { player_in: fallbackIn, player_out: fallbackOut };
  }

  const idSet = new Set(teamIds);
  const relevantTransfers = allTransfers.filter(
    (t) => idSet.has(t.entry_id) && Number(t.event) === Number(gw)
  );

  if (relevantTransfers.length === 0) {
    return { player_in: fallbackIn, player_out: fallbackOut };
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

  return {
    player_in: sortedIn[0] || fallbackIn,
    player_out: sortedOut[0] || fallbackOut,
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
function getTopBenchPlayerForTeams(
  teamIds: number[],
  gw: number,
  fallbackPlayer: string
): string {
  if (!teamIds || teamIds.length === 0) return fallbackPlayer;

  try {
    if (!fs.existsSync(DB_PATH)) return fallbackPlayer;
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const playersArr = Array.isArray(db.players) ? db.players : Object.values(db.players || {});
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
      // 1. Frekuensi pemain cadangan (Multi-Tim)
      if (benchCounts[b] !== benchCounts[a]) return benchCounts[b] - benchCounts[a];
      // 2. Harga pemain tertinggi (nowCost)
      if (benchCosts[b] !== benchCosts[a]) return (benchCosts[b] || 0) - (benchCosts[a] || 0);
      // 3. Bila harga sama: Total poin musim berjalan
      if (benchTotalPts[b] !== benchTotalPts[a]) return (benchTotalPts[b] || 0) - (benchTotalPts[a] || 0);
      // 4. Bila total poin sama: Form pemain
      return (benchForm[b] || 0) - (benchForm[a] || 0);
    });

    return sorted[0] || fallbackPlayer;
  } catch {
    return fallbackPlayer;
  }
}

/**
 * Resolves the top differing starting XI players between two managers.
 * Prioritizes: cost (nowCost) -> total points -> form.
 */
function getTopDifferingStarters(
  team1Id: number,
  team2Id: number,
  fallbackPlayer1: string,
  fallbackPlayer2: string
): { player1: string; player2: string } {
  try {
    if (!fs.existsSync(DB_PATH)) return { player1: fallbackPlayer1, player2: fallbackPlayer2 };
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const playersArr = Array.isArray(db.players) ? db.players : Object.values(db.players || {});

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

    return {
      player1: diff1[0]?.name || fallbackPlayer1,
      player2: diff2[0]?.name || fallbackPlayer2,
    };
  } catch {
    return { player1: fallbackPlayer1, player2: fallbackPlayer2 };
  }
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
    if (!fs.existsSync(DB_PATH)) return [];
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const playersArr = Array.isArray(db.players) ? db.players : Object.values(db.players || {});
    const deadlines = db.meta?.deadlines || {};
    // Deadline of previous GW (gw - 1)
    const prevDeadline = deadlines[String(gw - 1)] || '2026-10-23T17:30:00Z';

    const candidates: FlaggedPlayerItem[] = [];
    for (const p of playersArr as any[]) {
      // Must have news, and newsAdded must be AFTER previous GW deadline
      if (p.news && p.newsAdded && p.newsAdded >= prevDeadline) {
        const ownersCount = p.league_ownership?.count || 0;
        if (ownersCount > 0) {
          candidates.push({
            id: p.id,
            name: p.webName || p.web_name,
            club: p.teamShort || 'UNK',
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

    // Sort by: Dipastikan Absen first, then ownersCount desc, then cost desc
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
 * Generates ready-to-air news stories for all 13 Phase 1 templates based on real league data
 */
export function generatePhase1Stories(targetGw?: number): GeneratedPhase1Story[] {
  const templates = getPhase1Templates();
  let leagueData: any = null;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      leagueData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch {}

  const currentGw = targetGw || Number(leagueData?.current_gw) || 9;
  const isGwNotStarted = leagueData?.gw_status?.status === 'Not started' ||
    (leagueData?.sync_status?.gw_fixtures && leagueData.sync_status.gw_fixtures.filter((f: any) => f.event === currentGw).every((f: any) => !f.started));

  const stories: GeneratedPhase1Story[] = [];

  for (const tmpl of templates) {
    try {
      let filledHeadline = '';
      const sample = tmpl.sample_data || {};

      switch (tmpl.no) {
        // 1. Match Fixtures
        case 1: {
          const fixtures = (leagueData?.sync_status?.gw_fixtures || []).filter((f: any) => f.event === currentGw);
          if (fixtures.length > 0) {
            const earliestTime = fixtures[0].kickoff_time;
            const opening = fixtures.filter((f: any) => f.kickoff_time === earliestTime);
            const wibTime = formatWibTime(earliestTime);

            if (opening.length === 1) {
              const f = opening[0];
              filledHeadline = renderTemplateBranch(tmpl.template, '1 laga', {
                gw: currentGw,
                kickoff_time: wibTime,
                home_club: f.home_team || f.homeClub || sample.home_club,
                away_club: f.away_team || f.awayClub || sample.away_club,
              });
            } else {
              const listStr = opening.map((f: any, i: number) => {
                const pair = `[C:${f.home_team || f.homeClub}] vs [C:${f.away_team || f.awayClub}]`;
                return i === opening.length - 1 ? `dan ${pair}` : pair;
              }).join(', ');
              filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                gw: currentGw,
                count: opening.length,
                kickoff_time: wibTime,
                matches_list: listStr,
              });
            }
          }
          if (!filledHeadline) {
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              gw: currentGw,
              kickoff_time: sample.kickoff_time || '18:30 WIB',
              count: sample.count || 5,
              matches_list: sample.matches_list,
            });
          }
          break;
        }

        // 2. Chip Wildcard
        case 2: {
          const rawWcTeams: { name: string; id: number }[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) {
              rawWcTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const wcTransfers = getTopTransfersForTeams(
            leagueData?.all_transfers || [],
            rawWcTeams.map(t => t.id),
            currentGw,
            String(sample.player_in || 'Isak'),
            String(sample.player_out || 'João Pedro')
          );

          if (rawWcTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawWcTeams[0].name,
              teams: `[T:${rawWcTeams[0].name}]`,
              gw: currentGw,
              player_in: wcTransfers.player_in,
              player_out: wcTransfers.player_out,
            });
          } else if (rawWcTeams.length > 1) {
            const teamsStr = formatTeamList(rawWcTeams.map(t => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawWcTeams[0].name,
              gw: currentGw,
              player_in: wcTransfers.player_in,
              player_out: wcTransfers.player_out,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 3. Chip Free Hit
        case 3: {
          const rawFhTeams: { name: string; id: number }[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) {
              rawFhTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const fhTransfers = getTopTransfersForTeams(
            leagueData?.all_transfers || [],
            rawFhTeams.map(t => t.id),
            currentGw,
            String(sample.player_in || 'N.Jackson'),
            String(sample.player_out || 'João Pedro')
          );

          if (rawFhTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawFhTeams[0].name,
              teams: `[T:${rawFhTeams[0].name}]`,
              gw: currentGw,
              player_in: fhTransfers.player_in,
              player_out: fhTransfers.player_out,
            });
          } else if (rawFhTeams.length > 1) {
            const teamsStr = formatTeamList(rawFhTeams.map(t => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawFhTeams[0].name,
              gw: currentGw,
              player_in: fhTransfers.player_in,
              player_out: fhTransfers.player_out,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 4. Chip Bench Boost
        case 4: {
          const rawBbTeams: { name: string; id: number }[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) {
              rawBbTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          const bbBenchPlayer = getTopBenchPlayerForTeams(
            rawBbTeams.map(t => t.id),
            currentGw,
            String(sample.player_bench || 'Groß')
          );

          if (rawBbTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawBbTeams[0].name,
              teams: `[T:${rawBbTeams[0].name}]`,
              gw: currentGw,
              player_bench: bbBenchPlayer,
            });
          } else if (rawBbTeams.length > 1) {
            const teamsStr = formatTeamList(rawBbTeams.map(t => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawBbTeams[0].name,
              gw: currentGw,
              player_bench: bbBenchPlayer,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              player_bench: bbBenchPlayer,
              gw: currentGw,
            });
          }
          break;
        }

        // 5. Chip Triple Captain
        case 5: {
          const rawTcTeams: { name: string; id: number }[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) {
              rawTcTeams.push({ name: row.entry_name, id: row.entry_id });
            }
          }
          let dynamicCaptain = sample.captain || 'Haaland';
          if (rawTcTeams.length > 0 && leagueData?.standings?.[String(currentGw)]) {
            const standings = leagueData.standings[String(currentGw)];
            const tcEntry = standings.find((s: any) => s.entry_id === rawTcTeams[0].id);
            if (tcEntry?.captain?.name) {
              dynamicCaptain = tcEntry.captain.name;
            }
          }

          if (rawTcTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawTcTeams[0].name,
              teams: `[T:${rawTcTeams[0].name}]`,
              captain: dynamicCaptain,
              dominant_captain: dynamicCaptain,
              gw: currentGw,
              others_clause: '',
            });
          } else if (rawTcTeams.length > 1) {
            const teamsStr = formatTeamList(rawTcTeams.map(t => t.name), 'id', false);
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawTcTeams[0].name,
              captain: dynamicCaptain,
              dominant_captain: dynamicCaptain,
              gw: currentGw,
              others_clause: rawTcTeams.length > 2 ? `, sementara [N:${rawTcTeams.length - 2}] tim lainnya memilih opsi kapten berbeda` : '',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              captain: dynamicCaptain,
              dominant_captain: dynamicCaptain,
              gw: currentGw,
            });
          }
          break;
        }

        // 6. Chip Recap
        case 6: {
          let wcCount = 0, fhCount = 0, bbCount = 0, tcCount = 0;
          let wcNew = 0, fhNew = 0, bbNew = 0, tcNew = 0;
          for (const row of leagueData?.all_chips_used || []) {
            if (row.wc1 && Number(row.wc1.gw) <= currentGw) { wcCount++; if (Number(row.wc1.gw) === currentGw) wcNew++; }
            if (row.wc2 && Number(row.wc2.gw) <= currentGw) { wcCount++; if (Number(row.wc2.gw) === currentGw) wcNew++; }
            if (row.fh1 && Number(row.fh1.gw) <= currentGw) { fhCount++; if (Number(row.fh1.gw) === currentGw) fhNew++; }
            if (row.fh2 && Number(row.fh2.gw) <= currentGw) { fhCount++; if (Number(row.fh2.gw) === currentGw) fhNew++; }
            if (row.bb1 && Number(row.bb1.gw) <= currentGw) { bbCount++; if (Number(row.bb1.gw) === currentGw) bbNew++; }
            if (row.bb2 && Number(row.bb2.gw) <= currentGw) { bbCount++; if (Number(row.bb2.gw) === currentGw) bbNew++; }
            if (row.tc1 && Number(row.tc1.gw) <= currentGw) { tcCount++; if (Number(row.tc1.gw) === currentGw) tcNew++; }
            if (row.tc2 && Number(row.tc2.gw) <= currentGw) { tcCount++; if (Number(row.tc2.gw) === currentGw) tcNew++; }
          }
          const wcStr = `[N:Wildcard] [N:${wcCount || 14}]${wcNew > 0 ? ` (+[N:${wcNew}] pekan ini)` : ''}`;
          const fhStr = `[N:Free Hit] [N:${fhCount || 8}]${fhNew > 0 ? ` (+[N:${fhNew}] pekan ini)` : ''}`;
          const bbStr = `[N:Bench Boost] [N:${bbCount || 6}]${bbNew > 0 ? ` (+[N:${bbNew}] pekan ini)` : ''}`;
          const tcStr = `[N:Triple Captain] [N:${tcCount || 12}]${tcNew > 0 ? ` (+[N:${tcNew}] pekan ini)` : ''}`;
          const summary = `${wcStr}, ${fhStr}, ${bbStr}, dan ${tcStr}`;

          filledHeadline = renderTemplateBranch(tmpl.template, '', {
            gw: currentGw,
            chips_summary: summary,
          });
          break;
        }

        // 7. Most Transferred In
        case 7: {
          const transfersInMap = new Map<string, number>();
          for (const tr of leagueData?.all_transfers || []) {
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
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 8. Most Transferred Out
        case 8: {
          const transfersOutMap = new Map<string, number>();
          for (const tr of leagueData?.all_transfers || []) {
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
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 9. Captaincy Recap
        case 9: {
          const capStats = Array.isArray(leagueData?.captain_stats) ? leagueData.captain_stats : [];
          if (capStats.length >= 2) {
            const dominant = capStats[0];
            const second = capStats[1];
            const othersCount = capStats.slice(2).reduce((acc: number, c: any) => acc + (c.count || 1), 0);
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              dominant_captain: dominant.name || dominant.player_name || sample.dominant_captain,
              count1: dominant.count || sample.count1,
              second_clause: `, disusul [P:${second.name || second.player_name}] sebanyak [N:${second.count}] pemilih`,
              others_clause: othersCount > 0 ? `, sementara [N:${othersCount}] tim lainnya memilih kapten alternatif` : '',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 10. Hits Recap
        case 10: {
          const minusRows = (leagueData?.liga_minus || []).filter(
            (t: any) => t.event_transfers_cost && t.event_transfers_cost > 0
          );
          if (minusRows.length > 0) {
            const counts = getTeamAppearanceCounts();
            // Urutan utama: Poin penalti transfer terbesar (descending, contoh -8 sebelum -4)
            // Tie-breaker saat poin penalti sama: Opsi B (tim yang paling jarang disorot)
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
              formatted = `${minusTeams[0]}, ${minusTeams[1]}, serta [N:${minusTeams.length - 2}] tim lainnya`;
            }
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              teams_with_hits: formatted,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 11. Ownership Most Owned
        case 11: {
          const ownPlayers = Array.isArray(leagueData?.ownership_players) ? leagueData.ownership_players : [];
          if (ownPlayers.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              player1: ownPlayers[0].name || sample.player1,
              pct1: ownPlayers[0].ownership || ownPlayers[0].percentage || sample.pct1,
              player2: ownPlayers[1].name || sample.player2,
              pct2: ownPlayers[1].ownership || ownPlayers[1].percentage || sample.pct2,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 12. Differential Starting XI
        case 12: {
          filledHeadline = renderTemplateBranch(tmpl.template, '2 pemain', {
            team: sample.team || 'Kuda Hitam',
            gw: currentGw,
            player1: sample.player1 || 'Kluivert',
            pct1: sample.pct1 || '3',
            player2: sample.player2 || 'Welbeck',
            pct2: sample.pct2 || '4',
          });
          break;
        }

        // 13. Differential Captain
        case 13: {
          filledHeadline = renderTemplateBranch(tmpl.template, 'kapten eksklusif', {
            team: sample.team || 'Sunda Kelapa',
            captain: sample.captain || 'Bowen',
            gw: currentGw,
            pickers_count: sample.pickers_count || '2',
          });
          break;
        }

        // 14. Flagged Players (Injury Update Post-Deadline)
        case 14: {
          const flaggedList = getAllFlaggedPlayersPostDeadline(currentGw);
          if (flaggedList.length > 0) {
            for (const item of flaggedList) {
              const cond = item.isOut ? 'dipastikan absen' : 'meragukan';
              const headline = renderTemplateBranch(tmpl.template, cond, {
                owners_count: item.ownersCount,
                player: item.name,
                club: item.club,
                injury_desc: item.injuryDesc,
                gw: currentGw,
              });
              if (headline) {
                const teams = extractTagNames(headline, 'T');
                const players = extractTagNames(headline, 'P');
                const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                stories.push({
                  id: `p1_injury_${slug}_gw${currentGw}`,
                  headline_id: headline,
                  headline_en: headline,
                  kategori: tmpl.category,
                  sub_kategori: tmpl.subcategory,
                  drama_score: item.isOut ? 88 : 84,
                  waktu_tayang: ['Not started'],
                  gw: currentGw,
                  teams,
                  players,
                  sumber: 'Bukan',
                  status_tayang: isGwNotStarted ? 'Y' : 'N',
                  keterangan_tidak_tayang: isGwNotStarted ? '' : 'Fase saat ini bukan Not started',
                });
              }
            }
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, 'dipastikan absen', {
              owners_count: sample.owners_count || 35,
              player: sample.player || 'João Pedro',
              club: sample.club || 'CHE',
              injury_desc: sample.injury_desc || 'cedera paha',
              gw: currentGw,
            });
          }
          break;
        }

        // 15. Top Rivalry (Sorotan Rivalitas Puncak)
        case 15: {
          const prevGw = currentGw > 1 ? currentGw - 1 : currentGw;
          const prevStandings = leagueData?.standings?.[String(prevGw)] || leagueData?.standings?.[String(currentGw)] || [];
          if (prevStandings.length >= 2) {
            const team1 = prevStandings[0];
            const team2 = prevStandings[1];
            const margin = Math.abs((team1.total_points ?? team1.total ?? 0) - (team2.total_points ?? team2.total ?? 0));

            // Periksa chip aktif untuk kedua tim di currentGw
            let chip1 = '';
            let chip2 = '';
            for (const row of leagueData?.all_chips_used || []) {
              if (row.entry_id === team1.entry_id) {
                if (row.wc1 && Number(row.wc1.gw) === currentGw) chip1 = 'Wildcard';
                else if (row.fh1 && Number(row.fh1.gw) === currentGw) chip1 = 'Free Hit';
                else if (row.bb1 && Number(row.bb1.gw) === currentGw) chip1 = 'Bench Boost';
                else if (row.tc1 && Number(row.tc1.gw) === currentGw) chip1 = 'Triple Captain';
              }
              if (row.entry_id === team2.entry_id) {
                if (row.wc1 && Number(row.wc1.gw) === currentGw) chip2 = 'Wildcard';
                else if (row.fh1 && Number(row.fh1.gw) === currentGw) chip2 = 'Free Hit';
                else if (row.bb1 && Number(row.bb1.gw) === currentGw) chip2 = 'Bench Boost';
                else if (row.tc1 && Number(row.tc1.gw) === currentGw) chip2 = 'Triple Captain';
              }
            }

            // Periksa kapten kedua tim di currentGw
            const currentStandings = leagueData?.standings?.[String(currentGw)] || [];
            const curr1 = currentStandings.find((s: any) => s.entry_id === team1.entry_id) || team1;
            const curr2 = currentStandings.find((s: any) => s.entry_id === team2.entry_id) || team2;
            const cap1 = curr1.captain?.name || sample.captain1 || 'Haaland';
            const cap2 = curr2.captain?.name || sample.captain2 || 'Salah';

            if (chip1 || chip2) {
              const chipTeam = chip1 ? team1.entry_name : team2.entry_name;
              const rivalTeam = chip1 ? team2.entry_name : team1.entry_name;
              const chipName = chip1 || chip2;
              const targetClause = chip1 ? 'memperlebar keunggulan' : 'memangkas ketertinggalan';
              filledHeadline = renderTemplateBranch(tmpl.template, 'manuver chip', {
                gw: currentGw,
                team_chip: chipTeam,
                chip: chipName,
                target_clause: targetClause,
                margin,
                team_rival: rivalTeam,
              });
            } else if (cap1 !== cap2) {
              filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                gw: currentGw,
                team1: team1.entry_name,
                margin,
                team2: team2.entry_name,
                captain1: cap1,
                captain2: cap2,
              });
            } else {
              const diffStarters = getTopDifferingStarters(
                team1.entry_id,
                team2.entry_id,
                sample.diff_player1 || 'Palmer',
                sample.diff_player2 || 'Mbeumo'
              );
              filledHeadline = renderTemplateBranch(tmpl.template, 'kapten sama', {
                gw: currentGw,
                team1: team1.entry_name,
                margin,
                team2: team2.entry_name,
                captain: cap1,
                diff_player1: diffStarters.player1,
                diff_player2: diffStarters.player2,
              });
            }
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        default:
          filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          break;
      }

      if (filledHeadline) {
        const teams = extractTagNames(filledHeadline, 'T');
        const players = extractTagNames(filledHeadline, 'P');

        stories.push({
          id: `p1_${tmpl.id.toLowerCase()}_gw${currentGw}`,
          headline_id: filledHeadline,
          headline_en: filledHeadline, // Clean English/Indonesian format
          kategori: tmpl.category,
          sub_kategori: tmpl.subcategory,
          drama_score: 82 + (tmpl.no % 8),
          waktu_tayang: ['Not started'],
          gw: currentGw,
          teams,
          players,
          sumber: 'Bukan',
          status_tayang: isGwNotStarted ? 'Y' : 'N',
          keterangan_tidak_tayang: isGwNotStarted ? '' : 'Fase saat ini bukan Not started',
        });
      }
    } catch (err: any) {
      console.warn(`[Phase1StoryGenerator] Error generating template ${tmpl.id}:`, err.message);
    }
  }

  return stories;
}
