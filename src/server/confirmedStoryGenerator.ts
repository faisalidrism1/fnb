import fs from 'fs';
import path from 'path';
import { getPhase1Templates } from '../data/phase1Templates.ts';
import { buildRawMatchdayPayload } from './newsAggregator.ts';
import { formatTeamList } from './teamExposureTracker.ts';

const DB_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');
const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

export interface GeneratedConfirmedStory {
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

interface EmittedStoryDraft {
  id: string;
  headlineId: string;
  headlineEn: string;
  dramaScore?: number;
}

/**
 * Extracts tagged entity names [T:...], [P:...], or [C:...]
 */
function extractTagNames(text: string, type: 'T' | 'P' | 'C'): string[] {
  const regex = new RegExp(`\\[${type}:([^\\]]+)\\]`, 'g');
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const val = m[1].trim();
    if (!result.includes(val)) {
      result.push(val);
    }
  }
  return result;
}

/**
 * Interpolates template variables {key} with values from an object.
 */
function renderTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

/**
 * Renders a specific [Kondisi: ...] branch if present, or entire template.
 */
function renderTemplateBranch(
  template: string,
  conditionKeyword: string,
  vars: Record<string, string | number>
): string {
  if (template.includes('[Kondisi:')) {
    const sections = template.split(/\[Kondisi:\s*([^\]]+)\]/i);
    for (let i = 1; i < sections.length; i += 2) {
      const condName = sections[i].trim().toLowerCase();
      const body = sections[i + 1]?.trim() || '';
      if (condName.includes(conditionKeyword.toLowerCase())) {
        return renderTemplate(body, vars);
      }
    }
    if (sections[2]) {
      return renderTemplate(sections[2].trim(), vars);
    }
  }
  return renderTemplate(template, vars);
}

function toStorySlug(val: string): string {
  return (
    String(val || 'item')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}

/**
 * Generates ready-to-air news stories for all Confirmed Phase templates (`CF_*`)
 * based on official, audited league data.
 *
 * ATURAN BAKU:
 * Template yang berasal dari editor, tapi tidak menemukan kondisi yang cocok dan
 * tidak menghasilkan berita, TIDAK DITAMBAHKAN ke db news ticker dan tidak ditampilkan
 * di tabel news ticker (hanya diproduksi jika kondisi terpenuhi secara riil).
 */
export function generateConfirmedStories(targetGw?: number): GeneratedConfirmedStory[] {
  const templates = getPhase1Templates();
  const confirmedTemplates = templates.filter(
    (t) =>
      (t.gw_phase || '').trim().toLowerCase() === 'confirmed' ||
      String(t.id || '').startsWith('CF_')
  );

  let leagueData: any = null;
  let dbData: any = null;

  try {
    if (fs.existsSync(CACHE_PATH)) {
      leagueData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch {}

  try {
    if (fs.existsSync(DB_PATH)) {
      dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch {}

  const currentGw = targetGw || Number(leagueData?.current_gw) || Number(dbData?.meta?.current_gw) || 10;
  const snap = dbData?.gw_snapshots?.[String(currentGw)] || dbData?.gw_snapshots?.[currentGw] || {};
  const standings: any[] =
    Array.isArray(snap.standings) && snap.standings.length > 0
      ? snap.standings
      : Array.isArray(leagueData?.standings)
      ? leagueData.standings
      : [];
  const topCaptains: any[] =
    Array.isArray(snap.top_captains) && snap.top_captains.length > 0
      ? snap.top_captains
      : Array.isArray(leagueData?.captain_players)
      ? leagueData.captain_players
      : [];

  let rawPayload: ReturnType<typeof buildRawMatchdayPayload> | null = null;
  try {
    rawPayload = buildRawMatchdayPayload(currentGw);
  } catch (err: any) {
    console.warn('[Confirmed Story Generator] Could not build raw matchday payload:', err.message);
  }

  const stories: GeneratedConfirmedStory[] = [];
  const nowIso = new Date().toISOString();

  // Pre-index player statistics for current GW
  const playerStatsList: any[] = Array.isArray(leagueData?.player_stats) ? leagueData.player_stats : [];
  const playerMinutesMap = new Map<
    number,
    { name: string; club: string; minutes: number; points: number; goals: number; assists: number; bonus: number }
  >();
  for (const p of playerStatsList) {
    const h = (p.gwHistory || []).find((x: any) => x.round === currentGw);
    playerMinutesMap.set(p.id, {
      name: p.webName || p.web_name,
      club: p.teamShort || p.team_short_name || 'PL',
      minutes: h?.minutes || 0,
      points: h?.points || 0,
      goals: h?.goalsScored ?? h?.goals ?? 0,
      assists: h?.assists || 0,
      bonus: h?.bonus || 0,
    });
  }

  for (const tmpl of confirmedTemplates) {
    try {
      const produced: EmittedStoryDraft[] = [];

      switch (tmpl.id) {
        // ====================================================================
        // CF_FOUR_CHAMPS (Championship | Four Champions)
        // ====================================================================
        case 'CF_FOUR_CHAMPS': {
          if (standings.length >= 4) {
            const sortedByGwPts = [...standings].sort((a, b) => (b.event_points || 0) - (a.event_points || 0));
            const c1 = sortedByGwPts[0];
            const c2 = sortedByGwPts[1];
            const c3 = sortedByGwPts[2];
            const c4 = sortedByGwPts[3];

            if (c1 && c2 && c3 && c4) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  champ_1: c1.entry_name,
                  pts_1: c1.event_points,
                  champ_2: c2.entry_name,
                  pts_2: c2.event_points,
                  champ_3: c3.entry_name,
                  pts_3: c3.event_points,
                  champ_4: c4.entry_name,
                  pts_4: c4.event_points,
                }),
                headlineEn: `Official results for Gameweek [N:${currentGw}] crown 4 champions: 1st Place [T:${c1.entry_name}] ([N:${c1.event_points} Pts]), 2nd Place [T:${c2.entry_name}] ([N:${c2.event_points} Pts]), 3rd Place [T:${c3.entry_name}] ([N:${c3.event_points} Pts]), and 4th Place [T:${c4.entry_name}] ([N:${c4.event_points} Pts]).`,
                dramaScore: 95,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_GW_CHAMPION (Championship | Gameweek Leader)
        // ====================================================================
        case 'CF_GW_CHAMPION': {
          if (standings.length >= 2) {
            const sortedByGwPts = [...standings].sort((a, b) => (b.event_points || 0) - (a.event_points || 0));
            const winner = sortedByGwPts[0];
            const runnerUp = sortedByGwPts[1];
            const margin = (winner.event_points || 0) - (runnerUp.event_points || 0);

            if (winner && runnerUp && winner.event_points > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: winner.entry_name,
                  gw_pts: winner.event_points,
                  margin,
                  runner_up: runnerUp.entry_name,
                }),
                headlineEn: `[T:${winner.entry_name}] is officially crowned Gameweek [N:${currentGw}] Champion with [N:${winner.event_points} Pts], leading by [N:${margin} Pts] over [T:${runnerUp.entry_name}].`,
                dramaScore: 94,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_TOP_RIVALRY (Championship | Top Rivalry)
        // ====================================================================
        case 'CF_TOP_RIVALRY': {
          if (standings.length >= 2) {
            const sortedStandings = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
            const leader = sortedStandings[0];
            const chaser = sortedStandings[1];
            const margin = (leader.total_points || 0) - (chaser.total_points || 0);

            if (leader && chaser && leader.total_points > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team_1: leader.entry_name,
                  pts_1: leader.total_points,
                  margin,
                  team_2: chaser.entry_name,
                }),
                headlineEn: `Official Gameweek [N:${currentGw}] standings place [T:${leader.entry_name}] at the summit with [N:${leader.total_points} Pts], holding a [N:${margin} Pts] lead over [T:${chaser.entry_name}] in 2nd place.`,
                dramaScore: 93,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_MOST_GW_RIVALRY (Championship | Most GW Rivalry)
        // ====================================================================
        case 'CF_MOST_GW_RIVALRY': {
          const mostGwLeaders: any[] = Array.isArray(leagueData?.most_gameweek_champions)
            ? leagueData.most_gameweek_champions
            : [];
          const teamsWithWins = mostGwLeaders.filter((m: any) => (m.win_count || 0) > 0);
          if (teamsWithWins.length >= 2) {
            const m1 = teamsWithWins[0];
            const m2 = teamsWithWins[1];
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team_1: m1.entry_name,
                titles_1: m1.win_count,
                team_2: m2.entry_name,
                titles_2: m2.win_count,
              }),
              headlineEn: `Through Gameweek [N:${currentGw}], the Most Weekly Champion leaderboard is led by [T:${m1.entry_name}] ([N:${m1.win_count} Titles]), closely trailed by [T:${m2.entry_name}] ([N:${m2.win_count} Titles]).`,
              dramaScore: 90,
            });
          }
          break;
        }

        // ====================================================================
        // CF_RANK_CLIMBER (Championship | Rank Climber)
        // ====================================================================
        case 'CF_RANK_CLIMBER': {
          const climbers = standings
            .map((s) => ({
              team: s.entry_name,
              rankDiff: (s.last_rank || s.rank) - s.rank,
              oldRank: s.last_rank || s.rank,
              newRank: s.rank,
            }))
            .filter((c) => c.rankDiff > 0)
            .sort((a, b) => b.rankDiff - a.rankDiff);

          if (climbers.length > 0) {
            const topClimber = climbers[0];
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team: topClimber.team,
                rank_climb: topClimber.rankDiff,
                old_rank: topClimber.oldRank,
                new_rank: topClimber.newRank,
              }),
              headlineEn: `[T:${topClimber.team}] recorded the highest rank climb in Gameweek [N:${currentGw}], leaping [N:+${topClimber.rankDiff} Places] from rank [N:${topClimber.oldRank}] to rank [N:${topClimber.newRank}].`,
              dramaScore: 88,
            });
          }
          break;
        }

        // ====================================================================
        // CF_PLAYER_OF_THE_GW (Scoring Events | Top Performer)
        // ====================================================================
        case 'CF_PLAYER_OF_THE_GW': {
          let topPlayer: any = null;
          for (const [, p] of playerMinutesMap.entries()) {
            if (p.points > 0 && (!topPlayer || p.points > topPlayer.points)) {
              topPlayer = p;
            }
          }

          if (topPlayer) {
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                player: topPlayer.name,
                club: topPlayer.club,
                points: topPlayer.points,
                goals: topPlayer.goals,
                assists: topPlayer.assists,
                bps_pts: topPlayer.bonus,
              }),
              headlineEn: `[P:${topPlayer.name}] ([C:${topPlayer.club}]) is officially crowned player of the week for Gameweek [N:${currentGw}] with [N:${topPlayer.points} Pts], contributed by [N:${topPlayer.goals} Goals], [N:${topPlayer.assists} Assists], and [N:${topPlayer.bonus} Bonus Pts].`,
              dramaScore: 91,
            });
          }
          break;
        }

        // ====================================================================
        // CF_AUTOSUB_OFFICIAL (Starting XI | Autosub Watch)
        // ====================================================================
        case 'CF_AUTOSUB_OFFICIAL': {
          let foundSub: { team: string; dnp: string; bench: string; benchPts: number } | null = null;
          const ownershipList: any[] = Array.isArray(snap.ownership_players) ? snap.ownership_players : [];

          if (ownershipList.length > 0) {
            const teamStarters = new Map<string, { id: number; name: string; minutes: number; points: number }[]>();
            const teamBench = new Map<string, { id: number; name: string; minutes: number; points: number }[]>();

            for (const op of ownershipList) {
              const pInfo = playerMinutesMap.get(op.id);
              for (const o of op.owners || []) {
                if (o.is_starter) {
                  if (!teamStarters.has(o.entry_name)) teamStarters.set(o.entry_name, []);
                  teamStarters.get(o.entry_name)!.push({
                    id: op.id,
                    name: op.web_name,
                    minutes: pInfo?.minutes || 0,
                    points: pInfo?.points || 0,
                  });
                } else {
                  if (!teamBench.has(o.entry_name)) teamBench.set(o.entry_name, []);
                  teamBench.get(o.entry_name)!.push({
                    id: op.id,
                    name: op.web_name,
                    minutes: pInfo?.minutes || 0,
                    points: pInfo?.points || 0,
                  });
                }
              }
            }

            for (const [team, starters] of teamStarters.entries()) {
              const dnpStarter = starters.find((s) => s.minutes === 0);
              const bench = teamBench.get(team) || [];
              const scoringBench = bench.find((b) => b.minutes > 0 && b.points > 0);
              if (dnpStarter && scoringBench) {
                foundSub = {
                  team,
                  dnp: dnpStarter.name,
                  bench: scoringBench.name,
                  benchPts: scoringBench.points,
                };
                break;
              }
            }
          }

          if (foundSub) {
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                bench_player: foundSub.bench,
                bench_pts: foundSub.benchPts,
                team: foundSub.team,
                player_dnp: foundSub.dnp,
              }),
              headlineEn: `Official automatic substitutions for Gameweek [N:${currentGw}] brought in [P:${foundSub.bench}] ([N:+${foundSub.benchPts} Pts]) into [T:${foundSub.team}] starting XI, replacing the unplayed [P:${foundSub.dnp}].`,
              dramaScore: 86,
            });
          }
          break;
        }

        // ====================================================================
        // CF_CAPTAIN_OFFICIAL (Captain | Most Captained)
        // ====================================================================
        case 'CF_CAPTAIN_OFFICIAL': {
          if (topCaptains.length > 0) {
            const cap = topCaptains[0];
            const capName = cap.web_name || cap.name || 'Haaland';
            const capCount = cap.captain_count || cap.count || 0;
            const singlePts = cap.gw_points ?? cap.total_points ?? 2;
            const capPoints = singlePts * 2;

            if (capCount > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  captain: capName,
                  count: capCount,
                  captain_pts: capPoints,
                }),
                headlineEn: `The most popular captain across the league in Gameweek [N:${currentGw}], [P:${capName}] ([N:${capCount}] teams), yielded [N:${capPoints} Pts] doubled following official Opta bonus confirmation.`,
                dramaScore: 87,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CHIP_TRIPLE_CAPTAIN (Chip | Triple Captain | MULTI-NEWS)
        // ====================================================================
        case 'CF_CHIP_TRIPLE_CAPTAIN': {
          const allChips: any[] = Array.isArray(leagueData?.all_chips_used) ? leagueData.all_chips_used : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === teamName);
            const teamStanding = standings.find((s) => s.entry_name === teamName);
            const tcGw = entry.tc1?.gw === currentGw ? entry.tc1 : (entry.tc2?.gw === currentGw ? entry.tc2 : null);

            if (tcGw) {
              chipIdx++;
              const capStarter = teamRow?.starters?.find((st) => st.isC);
              const capName = capStarter?.name || teamStanding?.captain?.name || 'Haaland';
              const capTotalPts = capStarter ? capStarter.pts : (tcGw.points || teamStanding?.event_points || 0);
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  total_pts: capTotalPts,
                  captain: capName,
                }),
                headlineEn: `Official Triple Captain activation by [T:${teamName}] in Gameweek [N:${currentGw}] harvested [N:${capTotalPts} Pts] thanks to captain [P:${capName}].`,
                dramaScore: 91,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CHIP_BENCH_BOOST (Chip | Bench Boost | MULTI-NEWS)
        // ====================================================================
        case 'CF_CHIP_BENCH_BOOST': {
          const allChips: any[] = Array.isArray(leagueData?.all_chips_used) ? leagueData.all_chips_used : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === teamName);
            const bbGw = entry.bb1?.gw === currentGw ? entry.bb1 : (entry.bb2?.gw === currentGw ? entry.bb2 : null);

            if (bbGw) {
              chipIdx++;
              const realBenchPts = typeof teamRow?.benchPts === 'number' ? teamRow.benchPts : (bbGw.points || 0);
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  bench_pts: realBenchPts,
                }),
                headlineEn: `Official Bench Boost activation by [T:${teamName}] in Gameweek [N:${currentGw}] harvested [N:${realBenchPts} Pts] from all four bench players.`,
                dramaScore: 90,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CHIP_WILDCARD (Chip | Wildcard | MULTI-NEWS)
        // ====================================================================
        case 'CF_CHIP_WILDCARD': {
          const allChips: any[] = Array.isArray(leagueData?.all_chips_used) ? leagueData.all_chips_used : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === teamName);
            const teamStanding = standings.find((s) => s.entry_name === teamName);
            const wcGw = entry.wc1?.gw === currentGw ? entry.wc1 : (entry.wc2?.gw === currentGw ? entry.wc2 : null);

            if (wcGw) {
              chipIdx++;
              const gwPts = wcGw.points ?? teamRow?.gwPts ?? teamStanding?.event_points ?? 0;
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  gw_pts: gwPts,
                }),
                headlineEn: `Official Wildcard activation by [T:${teamName}] in Gameweek [N:${currentGw}] produced [N:${gwPts} Pts].`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CHIP_FREEHIT (Chip | Free Hit | MULTI-NEWS)
        // ====================================================================
        case 'CF_CHIP_FREEHIT': {
          const allChips: any[] = Array.isArray(leagueData?.all_chips_used) ? leagueData.all_chips_used : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === teamName);
            const teamStanding = standings.find((s) => s.entry_name === teamName);
            const fhGw = entry.fh1?.gw === currentGw ? entry.fh1 : (entry.fh2?.gw === currentGw ? entry.fh2 : null);

            if (fhGw) {
              chipIdx++;
              const gwPts = fhGw.points ?? teamRow?.gwPts ?? teamStanding?.event_points ?? 0;
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  gw_pts: gwPts,
                }),
                headlineEn: `Official Free Hit activation by [T:${teamName}] in Gameweek [N:${currentGw}] produced [N:${gwPts} Pts].`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_HITS_DEDUCTED (Hits | Most Hits)
        // ====================================================================
        case 'CF_HITS_DEDUCTED': {
          const hitsTeams = standings
            .filter((s) => (s.event_transfers_cost || 0) > 0)
            .sort((a, b) => (b.event_transfers_cost || 0) - (a.event_transfers_cost || 0));

          if (hitsTeams.length > 0) {
            const topHit = hitsTeams[0];
            const transfersEstimated = Math.floor(topHit.event_transfers_cost / 4) + 1;

            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                hits_pts: topHit.event_transfers_cost,
                team: topHit.entry_name,
                transfers_count: transfersEstimated,
              }),
              headlineEn: `Official transfer point deductions for Gameweek [N:${currentGw}] deducted [N:-${topHit.event_transfers_cost} Pts] from [T:${topHit.entry_name}] after completing [N:${transfersEstimated} Transfers].`,
              dramaScore: 85,
            });
          }
          break;
        }

        // ====================================================================
        // CF_TRANSFER_KARMA (Transfer | Transfer Karma | MULTI-NEWS)
        // ====================================================================
        case 'CF_TRANSFER_KARMA': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Transfer' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: grp.club || 'PL',
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} all sold [P:${grp.player}] ([C:${grp.club || 'PL'}]) who officially scored [N:${grp.playerPts} Pts] in Gameweek [N:${currentGw}].`,
              dramaScore: Math.min(96, 84 + Math.min(8, grp.teamCount) + Math.min(4, Math.floor(grp.playerPts / 3))),
            });
          });

          // Fill up to 3 stories with high-delta single-team transfers if fewer than 3 multi-team groups
          if (produced.length < 3) {
            const allGwTransfers = (dbData?.league_analytics?.all_transfers || []).filter(
              (tr: any) => Number(tr.event) === currentGw && tr.element_out && tr.element_in
            );
            const singleCandidates = allGwTransfers
              .map((tr: any) => ({
                team: tr.entry_name,
                playerOut: tr.element_out.name,
                club: tr.element_out.club || 'PL',
                outPts: Number(tr.element_out.gw_points) || 0,
                playerIn: tr.element_in.name,
                inPts: Number(tr.element_in.gw_points) || 0,
                delta: (Number(tr.element_out.gw_points) || 0) - (Number(tr.element_in.gw_points) || 0),
              }))
              .filter((c: any) => c.delta >= 6 && !coveredPlayers.has(String(c.playerOut || '').toLowerCase()))
              .sort((a: any, b: any) => b.delta - a.delta);

            const seenSingleKey = new Set<string>();
            for (const c of singleCandidates) {
              if (produced.length >= 3) break;
              const k = `${c.team}::${c.playerOut}`;
              if (seenSingleKey.has(k)) continue;
              seenSingleKey.add(k);
              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(c.playerOut)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: c.team,
                  player: c.playerOut,
                  club: c.club,
                  points: c.outPts,
                  gw: currentGw,
                  player_in: c.playerIn,
                  in_points: c.inPts,
                }),
                headlineEn: `[T:${c.team}] sold [P:${c.playerOut}] ([C:${c.club}]) who officially scored [N:${c.outPts} Pts] in Gameweek [N:${currentGw}], while replacement [P:${c.playerIn}] earned [N:${c.inPts} Pts].`,
                dramaScore: Math.min(92, 82 + Math.floor(c.delta / 2)),
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CAPTAIN_REGRET (Captain | Captain Regret | MULTI-NEWS)
        // Strictly compares MID/FWD alternatives only (enforced by newsAggregator)
        // ====================================================================
        case 'CF_CAPTAIN_REGRET': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Captaincy' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: grp.club || 'PL',
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} opted not to captain [P:${grp.player}] ([C:${grp.club || 'PL'}]) who officially scored [N:${grp.playerPts} Pts] in Gameweek [N:${currentGw}].`,
              dramaScore: Math.min(96, 84 + Math.min(8, Math.floor(grp.teamCount / 3)) + Math.min(4, Math.floor(grp.playerPts / 3))),
            });
          });

          if (produced.length < 3) {
            const singleRegrets = (rawPayload.whatIfOpportunities || [])
              .filter(
                (w) =>
                  w.category === 'Captaincy' &&
                  w.netDeltaPts >= 6 &&
                  !coveredPlayers.has(String(w.player || '').toLowerCase())
              )
              .slice(0, 3 - produced.length);

            for (const w of singleRegrets) {
              const teamEntry = rawPayload.standingsTable.find((s) => s.team === w.team);
              const capStarter = teamEntry?.starters?.find((st) => st.isC);
              const actualCaptainName = capStarter?.name || w.realChoice.split(' (')[0] || 'Captain';
              const actualCaptainBasePts = w.realBasePts;

              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: w.team,
                  actual_captain: actualCaptainName,
                  captain_pts: actualCaptainBasePts,
                  gw: currentGw,
                  player: w.player,
                  club: w.club || 'PL',
                  points: w.alternativePts,
                }),
                headlineEn: `[T:${w.team}] entrusted the captaincy to [P:${actualCaptainName}] ([N:${actualCaptainBasePts} Pts]) in Gameweek [N:${currentGw}], while [P:${w.player}] ([C:${w.club || 'PL'}]) in their starting lineup scored [N:${w.alternativePts} Pts].`,
                dramaScore: Math.min(91, 82 + Math.floor(w.netDeltaPts / 2)),
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_RANK_FALLER (Championship | Rank Faller | MULTI-NEWS)
        // ====================================================================
        case 'CF_RANK_FALLER': {
          const fallers = (rawPayload?.standingsHistoricalContext?.topRankFallers || [])
            .filter((f) => f.fallSteps >= 5)
            .slice(0, 3);

          const fallbackFallers =
            fallers.length > 0
              ? fallers
              : [...standings]
                  .map((s) => ({
                    team: s.entry_name,
                    fromRank: s.last_rank || s.rank,
                    toRank: s.rank,
                    fallSteps: s.rank - (s.last_rank || s.rank),
                    gwPts: s.event_points || 0,
                  }))
                  .filter((f) => f.fallSteps >= 5)
                  .sort((a, b) => b.fallSteps - a.fallSteps)
                  .slice(0, 3);

          fallbackFallers.forEach((f, idx) => {
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(f.team)}`,
              headlineId: renderTemplate(tmpl.template, {
                team: f.team,
                gw: currentGw,
                rank_drop: f.fallSteps,
                old_rank: f.fromRank,
                new_rank: f.toRank,
                gw_pts: f.gwPts,
              }),
              headlineEn: `[T:${f.team}] suffered a sharp drop in the official Gameweek [N:${currentGw}] standings, sliding [N:-${f.fallSteps} Places] from rank [N:${f.fromRank}] to rank [N:${f.toRank}] after scoring [N:${f.gwPts} Pts].`,
              dramaScore: Math.min(92, 82 + Math.floor(f.fallSteps / 3)),
            });
          });
          break;
        }

        // ====================================================================
        // CF_SUMMIT_COUP (Championship | Summit Coup | SINGLE-NEWS)
        // Emitted ONLY if rank 1 actually changed hands (coupOccurred === true)
        // ====================================================================
        case 'CF_SUMMIT_COUP': {
          const sortedStandings = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
          const rank1 = sortedStandings[0];
          const rank2 = sortedStandings[1];
          const r1LastRank = rank1 ? Number(rank1.last_rank || rank1.rank || 1) : 1;
          const coupOccurred = Boolean(rank1 && r1LastRank > 1);

          if (coupOccurred && rank1 && rank2) {
            const formerLeader =
              sortedStandings.find((s) => Number(s.last_rank) === 1 && s.entry_name !== rank1.entry_name) || rank2;
            const margin = (rank1.total_points || 0) - (rank2.total_points || 0);

            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                new_leader: rank1.entry_name,
                old_rank: r1LastRank,
                former_leader: formerLeader.entry_name,
                former_new_rank: formerLeader.rank,
                margin,
              }),
              headlineEn: `A summit coup occurred in the official Gameweek [N:${currentGw}] standings as [T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to 1st place, overtaking [T:${formerLeader.entry_name}] (now rank [N:${formerLeader.rank}]) by [N:${margin} Pts].`,
              dramaScore: 98,
            });
          }
          break;
        }

        // ====================================================================
        // CF_RIVALRY_DUEL (Championship | Rivalry Duel | MULTI-NEWS)
        // Tight battles (gap <= 3 pts) among top 20, excluding #1 vs #2 pair
        // ====================================================================
        case 'CF_RIVALRY_DUEL': {
          const sortedTop20 = [...standings]
            .sort((a, b) => (a.rank || 0) - (b.rank || 0))
            .slice(0, 20);

          const duelCandidates: Array<{
            rank1: number;
            team1: string;
            pts1: number;
            rank2: number;
            team2: string;
            pts2: number;
            gap: number;
          }> = [];

          for (let i = 0; i < sortedTop20.length - 1; i++) {
            const t1 = sortedTop20[i];
            const t2 = sortedTop20[i + 1];
            const r1 = Number(t1.rank || i + 1);
            const r2 = Number(t2.rank || i + 2);
            // Exclude #1 vs #2 which is dedicated to CF_TOP_RIVALRY
            if (r1 === 1 && r2 === 2) continue;

            const pts1 = Number(t1.total_points || 0);
            const pts2 = Number(t2.total_points || 0);
            const gap = pts1 - pts2;
            if (gap >= 0 && gap <= 3 && pts1 > 0) {
              duelCandidates.push({
                rank1: r1,
                team1: t1.entry_name,
                pts1,
                rank2: r2,
                team2: t2.entry_name,
                pts2,
                gap,
              });
            }
          }

          duelCandidates.sort((a, b) => a.gap - b.gap || a.rank1 - b.rank1);
          duelCandidates.slice(0, 3).forEach((d, idx) => {
            const isTied = d.gap === 0;
            produced.push({
              id: `${tmpl.id}_${idx + 1}_r${d.rank1}_r${d.rank2}`,
              headlineId: renderTemplateBranch(tmpl.template, isTied ? 'Poin Sama' : 'Selisih Poin', {
                gw: currentGw,
                rank_1: d.rank1,
                team_1: d.team1,
                pts_1: d.pts1,
                rank_2: d.rank2,
                team_2: d.team2,
                pts_2: d.pts2,
                gap: d.gap,
              }),
              headlineEn: isTied
                ? `A tight battle in the official Gameweek [N:${currentGw}] standings sees rank [N:${d.rank1}] [T:${d.team1}] and rank [N:${d.rank2}] [T:${d.team2}] locked level on [N:${d.pts1} Pts].`
                : `A tight battle in the official Gameweek [N:${currentGw}] standings separates rank [N:${d.rank1}] [T:${d.team1}] ([N:${d.pts1} Pts]) and rank [N:${d.rank2}] [T:${d.team2}] ([N:${d.pts2} Pts]) by only [N:${d.gap} Pts].`,
              dramaScore: isTied ? 93 : Math.max(85, 92 - d.gap * 2),
            });
          });
          break;
        }

        // ====================================================================
        // CF_BENCH_POINTS (Starting XI | Bench Points | MULTI-NEWS)
        // ====================================================================
        case 'CF_BENCH_POINTS': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Bench' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: grp.club || 'PL',
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} all left [P:${grp.player}] ([C:${grp.club || 'PL'}]) on the bench despite officially scoring [N:${grp.playerPts} Pts] in Gameweek [N:${currentGw}].`,
              dramaScore: Math.min(93, 82 + Math.min(6, grp.teamCount) + Math.min(4, Math.floor(grp.playerPts / 3))),
            });
          });

          if (produced.length < 3) {
            const singleBenches = (rawPayload.whatIfOpportunities || [])
              .filter(
                (w) =>
                  w.category === 'Bench' &&
                  w.netDeltaPts >= 6 &&
                  !coveredPlayers.has(String(w.player || '').toLowerCase())
              )
              .slice(0, 3 - produced.length);

            for (const w of singleBenches) {
              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: w.team,
                  player: w.player,
                  club: w.club || 'PL',
                  points: w.alternativePts,
                  gw: currentGw,
                }),
                headlineEn: `[T:${w.team}] kept [P:${w.player}] ([C:${w.club || 'PL'}]) on the bench despite scoring [N:${w.alternativePts} Pts] in official Gameweek [N:${currentGw}] fixtures.`,
                dramaScore: Math.min(89, 80 + Math.floor(w.netDeltaPts / 2)),
              });
            }
          }
          break;
        }
      }

      // CRITICAL RULE: If no real condition matched, produced remains empty ([]).
      // It is NOT added to stories list, NOT saved to db container, and NOT displayed in table.
      for (const item of produced) {
        if (!item.headlineId) continue;
        stories.push({
          id: item.id,
          headline_id: item.headlineId,
          headline_en: item.headlineEn || item.headlineId,
          kategori: tmpl.category,
          sub_kategori: tmpl.subcategory,
          drama_score: item.dramaScore ?? 90,
          waktu_tayang: ['Confirmed'],
          gw: currentGw,
          teams: extractTagNames(item.headlineId, 'T'),
          players: extractTagNames(item.headlineId, 'P'),
          sumber: 'Sys',
          status_tayang: 'Y',
          keterangan_tidak_tayang: '',
          timestamp_produksi: nowIso,
        });
      }
    } catch (tmplErr: any) {
      console.warn(`[Confirmed Story Generator] Error rendering template ${tmpl.id}:`, tmplErr.message);
    }
  }

  return stories;
}
