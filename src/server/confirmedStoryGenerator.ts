import { getPhase1Templates } from '../data/phase1Templates.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { buildRawMatchdayPayload } from './newsAggregator.ts';
import { formatTeamList } from './teamExposureTracker.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';

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
    return '';
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

function formatPlayerClubList(
  players: Array<{ name: string; club: string }>,
  lang: 'id' | 'en' = 'id'
): string {
  const tags = players.map((p) => `[P:${p.name}] ([C:${p.club}])`);
  const n = tags.length;
  if (n === 0) return '';
  if (n === 1) return tags[0];
  if (n === 2) return lang === 'id' ? `${tags[0]} dan ${tags[1]}` : `${tags[0]} and ${tags[1]}`;
  if (n === 3) return lang === 'id' ? `${tags[0]}, ${tags[1]}, dan ${tags[2]}` : `${tags[0]}, ${tags[1]}, and ${tags[2]}`;
  const remaining = n - 2;
  return lang === 'id'
    ? `${tags[0]}, ${tags[1]}, dan [N:${remaining}] pemain lainnya`
    : `${tags[0]}, ${tags[1]}, and [N:${remaining}] other players`;
}

function formatCaptainListWithPts(
  captains: Array<{ name: string; captainPts: number }>,
  lang: 'id' | 'en' = 'id'
): string {
  const tags = captains.map((c) =>
    lang === 'id' ? `[P:${c.name}] ([N:${c.captainPts} Poin])` : `[P:${c.name}] ([N:${c.captainPts} Pts])`
  );
  const n = tags.length;
  if (n === 0) return '';
  if (n === 1) return tags[0];
  if (n === 2) return lang === 'id' ? `${tags[0]} dan ${tags[1]}` : `${tags[0]} and ${tags[1]}`;
  if (n === 3) return lang === 'id' ? `${tags[0]}, ${tags[1]}, dan ${tags[2]}` : `${tags[0]}, ${tags[1]}, and ${tags[2]}`;
  const remaining = n - 2;
  return lang === 'id'
    ? `${tags[0]}, ${tags[1]}, dan [N:${remaining}] pemain lainnya`
    : `${tags[0]}, ${tags[1]}, and [N:${remaining}] other players`;
}

function formatClimberList(
  climbers: Array<{ team: string; oldRank: number; newRank: number }>,
  lang: 'id' | 'en' = 'id'
): string {
  const tags = climbers.map((c) =>
    lang === 'id'
      ? `[T:${c.team}] ([N:${c.oldRank}] ke [N:${c.newRank}])`
      : `[T:${c.team}] ([N:${c.oldRank}] to [N:${c.newRank}])`
  );
  const n = tags.length;
  if (n === 0) return '';
  if (n === 1) return tags[0];
  if (n === 2) return lang === 'id' ? `${tags[0]} dan ${tags[1]}` : `${tags[0]} and ${tags[1]}`;
  if (n === 3) return lang === 'id' ? `${tags[0]}, ${tags[1]}, dan ${tags[2]}` : `${tags[0]}, ${tags[1]}, and ${tags[2]}`;
  const remaining = n - 2;
  return lang === 'id'
    ? `${tags[0]}, ${tags[1]}, dan [N:${remaining}] tim lainnya`
    : `${tags[0]}, ${tags[1]}, and [N:${remaining}] other teams`;
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

  const dbData = getOptimalDatabase();
  const currentGw = targetGw || Number(dbData?.meta?.current_gw) || 0;
  if (!currentGw) return [];

  const snap = getGwSnapshot(currentGw);
  const standings: any[] = getDbStandings(currentGw);
  const topCaptains: any[] = Array.isArray(snap?.top_captains) ? snap.top_captains : [];

  const rawPayload = buildRawMatchdayPayload(currentGw);

  const stories: GeneratedConfirmedStory[] = [];
  const nowIso = new Date().toISOString();

  // Pre-index player statistics strictly from SSOT (dbData.players)
  const playerStatsList: any[] = Object.values(dbData?.players || {});
  const playerMinutesMap = new Map<
    number,
    { name: string; club: string; minutes: number; points: number; goals: number; assists: number; bonus: number }
  >();
  for (const p of playerStatsList) {
    const h = (p.gwHistory || []).find((x: any) => Number(x.round) === currentGw);
    const name = p.webName || p.web_name;
    const club = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name);
    if (!p?.id || !name || !club) continue;
    playerMinutesMap.set(p.id, {
      name,
      club,
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
        // CF_STANDINGS_GAMEWEEK_WINNER (Standings | Gameweek | GW Winner)
        // ====================================================================
        case 'CF_STANDINGS_GAMEWEEK_WINNER': {
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
                headlineEn: `[T:${winner.entry_name}] wins Gameweek [N:${currentGw}] with [N:${winner.event_points} Pts], finishing [N:${margin} Pts] ahead of [T:${runnerUp.entry_name}].`,
                dramaScore: 94,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_STANDINGS_TITLE_RACE (Standings | Title Race | Title Race)
        // ====================================================================
        case 'CF_STANDINGS_TITLE_RACE': {
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
                headlineEn: `[T:${leader.entry_name}] leads the league table after Gameweek [N:${currentGw}] with [N:${leader.total_points} Pts], [N:${margin} Pts] ahead of [T:${chaser.entry_name}] in 2nd place.`,
                dramaScore: 93,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_STANDINGS_WEEKLY_WINS_MOST (Standings | Weekly Wins | Most GW Wins | SINGLE-NEWS)
        // Kondisi sementara s.d. GW N untuk gelar Juara GW Terbanyak Semusim:
        // - Peringkat 1 dan 2 klasemen FNB League dikecualikan
        // - Jika win_count sama, pemenang sementara adalah yang peringkatnya lebih tinggi (rank lebih kecil)
        // ====================================================================
        case 'CF_STANDINGS_WEEKLY_WINS_MOST': {
          const sortedStandings = [...standings].sort(
            (a, b) => (a.rank || 0) - (b.rank || 0) || (b.total_points || 0) - (a.total_points || 0)
          );
          const top2Ids = new Set(
            sortedStandings.slice(0, 2).map((s) => Number(s.entry_id || s.entry || s.id)).filter(Boolean)
          );
          const top2Names = new Set(
            sortedStandings.slice(0, 2).map((s) => String(s.entry_name || '').trim().toLowerCase()).filter(Boolean)
          );

          const standingInfoById = new Map<number, { rank: number; totalPts: number }>();
          const standingInfoByName = new Map<string, { rank: number; totalPts: number }>();
          sortedStandings.forEach((s, idx) => {
            const info = { rank: Number(s.rank || idx + 1), totalPts: Number(s.total_points || 0) };
            const eid = Number(s.entry_id || s.entry || s.id || 0);
            const ename = String(s.entry_name || '').trim().toLowerCase();
            if (eid) standingInfoById.set(eid, info);
            if (ename) standingInfoByName.set(ename, info);
          });

          const mostGwLeaders: any[] = Array.isArray(dbData?.league_analytics?.most_gameweek_champions)
            ? dbData.league_analytics.most_gameweek_champions
            : [];
          const eligibleTeams = mostGwLeaders
            .filter((m: any) => {
              const wins = Number(m.win_count) || 0;
              if (wins <= 0) return false;
              const entryId = Number(m.entry_id || m.id || 0);
              const entryName = String(m.entry_name || '').trim().toLowerCase();
              if (entryId && top2Ids.has(entryId)) return false;
              if (entryName && top2Names.has(entryName)) return false;
              return true;
            })
            .map((m: any) => {
              const entryId = Number(m.entry_id || m.id || 0);
              const entryName = String(m.entry_name || '').trim().toLowerCase();
              const info = standingInfoById.get(entryId) || standingInfoByName.get(entryName);
              return {
                entry_name: m.entry_name,
                win_count: Number(m.win_count) || 0,
                standingRank: info?.rank ?? Number(m.current_rank || 999),
                totalPts: info?.totalPts ?? 0,
              };
            })
            .sort(
              (a, b) =>
                b.win_count - a.win_count ||
                a.standingRank - b.standingRank ||
                b.totalPts - a.totalPts
            );

          if (eligibleTeams.length > 0) {
            const leader = eligibleTeams[0];
            const maxWins = leader.win_count;
            const topTied = eligibleTeams.filter((m) => m.win_count === maxWins);

            if (topTied.length >= 2) {
              const others = topTied.slice(1);
              let challengersId = '';
              let challengersEn = '';
              if (others.length === 1) {
                challengersId = `[T:${others[0].entry_name}] (peringkat [N:${others[0].standingRank}])`;
                challengersEn = `[T:${others[0].entry_name}] (rank [N:${others[0].standingRank}])`;
              } else if (others.length === 2) {
                challengersId = `[T:${others[0].entry_name}] (peringkat [N:${others[0].standingRank}]) dan [T:${others[1].entry_name}] (peringkat [N:${others[1].standingRank}])`;
                challengersEn = `[T:${others[0].entry_name}] (rank [N:${others[0].standingRank}]) and [T:${others[1].entry_name}] (rank [N:${others[1].standingRank}])`;
              } else {
                const rem = others.length - 1;
                challengersId = `[T:${others[0].entry_name}] (peringkat [N:${others[0].standingRank}]) dan [N:${rem}] tim lainnya`;
                challengersEn = `[T:${others[0].entry_name}] (rank [N:${others[0].standingRank}]) and [N:${rem}] other teams`;
              }

              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Jumlah Kemenangan Sama', {
                  gw: currentGw,
                  team_1: leader.entry_name,
                  rank_1: leader.standingRank,
                  titles: maxWins,
                  challengers: challengersId,
                }),
                headlineEn: `[T:${leader.entry_name}] (rank [N:${leader.standingRank}]) leads the race for most weekly titles through Gameweek [N:${currentGw}] with [N:${maxWins} Titles], edging ${challengersEn} on league standing.`,
                dramaScore: 90,
              });
            } else if (eligibleTeams.length >= 2) {
              const runnerUp = eligibleTeams[1];
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Pemimpin Tunggal', {
                  gw: currentGw,
                  team_1: leader.entry_name,
                  rank_1: leader.standingRank,
                  titles_1: maxWins,
                  team_2: runnerUp.entry_name,
                  rank_2: runnerUp.standingRank,
                  titles_2: runnerUp.win_count,
                }),
                headlineEn: `[T:${leader.entry_name}] (rank [N:${leader.standingRank}]) leads the race for most weekly titles through Gameweek [N:${currentGw}] with [N:${maxWins} Titles], followed by [T:${runnerUp.entry_name}] (rank [N:${runnerUp.standingRank}], [N:${runnerUp.win_count} Titles]).`,
                dramaScore: 90,
              });
            } else {
              produced.push({
                id: tmpl.id,
                headlineId: `[T:${leader.entry_name}] (peringkat [N:${leader.standingRank}]) memuncaki perburuan gelar juara mingguan hingga Gameweek [N:${currentGw}] dengan [N:${maxWins} Gelar].`,
                headlineEn: `[T:${leader.entry_name}] (rank [N:${leader.standingRank}]) leads the race for most weekly titles through Gameweek [N:${currentGw}] with [N:${maxWins} Titles].`,
                dramaScore: 90,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_STANDINGS_RANK_BIGGEST_RISE (Standings | Rank | Biggest Rise | SINGLE-NEWS)
        // ====================================================================
        case 'CF_STANDINGS_RANK_BIGGEST_RISE': {
          const climbers = standings
            .map((s) => ({
              team: s.entry_name,
              rankDiff: (s.last_rank || s.rank) - s.rank,
              oldRank: s.last_rank || s.rank,
              newRank: s.rank,
            }))
            .filter((c) => c.rankDiff > 0)
            .sort((a, b) => b.rankDiff - a.rankDiff || a.newRank - b.newRank);

          if (climbers.length > 0) {
            const maxClimb = climbers[0].rankDiff;
            const tiedTopClimbers = climbers.filter((c) => c.rankDiff === maxClimb);
            if (tiedTopClimbers.length === 1) {
              const topClimber = tiedTopClimbers[0];
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Tim Tunggal', {
                  gw: currentGw,
                  team: topClimber.team,
                  rank_climb: topClimber.rankDiff,
                  old_rank: topClimber.oldRank,
                  new_rank: topClimber.newRank,
                }),
                headlineEn: `[T:${topClimber.team}] recorded the highest rank climb, leaping [N:+${topClimber.rankDiff} Places] from rank [N:${topClimber.oldRank}] to [N:${topClimber.newRank}].`,
                dramaScore: 88,
              });
            } else {
              const climbersId = formatClimberList(tiedTopClimbers, 'id');
              const climbersEn = formatClimberList(tiedTopClimbers, 'en');
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Lonjakan Peringkat Sama', {
                  gw: currentGw,
                  teams_climbers: climbersId,
                  rank_climb: maxClimb,
                }),
                headlineEn: `${climbersEn} shared the highest rank climb, each leaping [N:+${maxClimb} Places].`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_PLAYER_TOP_PERFORMER_GW_SCORER (Player | Top Performer | GW Top Scorer | SINGLE-NEWS)
        // ====================================================================
        case 'CF_PLAYER_TOP_PERFORMER_GW_SCORER': {
          const scoredPlayers = Array.from(playerMinutesMap.values())
            .filter((p) => p.points > 0)
            .sort((a, b) => b.points - a.points || b.bonus - a.bonus || b.goals - a.goals || b.assists - a.assists);

          if (scoredPlayers.length > 0) {
            const maxPts = scoredPlayers[0].points;
            const topPlayers = scoredPlayers.filter((p) => p.points === maxPts);
            if (topPlayers.length === 1) {
              const topPlayer = topPlayers[0];
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Pemain Tunggal', {
                  gw: currentGw,
                  player: topPlayer.name,
                  club: topPlayer.club,
                  points: topPlayer.points,
                  goals: topPlayer.goals,
                  assists: topPlayer.assists,
                  bps_pts: topPlayer.bonus,
                }),
                headlineEn: `[P:${topPlayer.name}] ([C:${topPlayer.club}]) finishes Gameweek [N:${currentGw}] as the top-scoring player with [N:${topPlayer.points} Pts] from [N:${topPlayer.goals} Goals], [N:${topPlayer.assists} Assists], and [N:${topPlayer.bonus} Bonus Pts].`,
                dramaScore: 91,
              });
            } else {
              const playersId = formatPlayerClubList(topPlayers, 'id');
              const playersEn = formatPlayerClubList(topPlayers, 'en');
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Poin Sama', {
                  gw: currentGw,
                  players_list: playersId,
                  points: maxPts,
                }),
                headlineEn: `${playersEn} share the top-scoring player honor in Gameweek [N:${currentGw}] with [N:${maxPts} Pts] each.`,
                dramaScore: 91,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_LINEUP_AUTOSUB_CONFIRMED (Lineup | Autosub | Confirmed Autosubs | MULTI-NEWS)
        // ====================================================================
        case 'CF_LINEUP_AUTOSUB_CONFIRMED': {
          const foundSubs: { team: string; dnp: string; bench: string; benchPts: number }[] = [];
          const ownershipList: any[] = Array.isArray(snap?.ownership_players) ? snap.ownership_players : [];

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
              const scoringBench = [...bench]
                .filter((b) => b.minutes > 0 && b.points > 0)
                .sort((a, b) => b.points - a.points)[0];
              if (dnpStarter && scoringBench) {
                foundSubs.push({
                  team,
                  dnp: dnpStarter.name,
                  bench: scoringBench.name,
                  benchPts: scoringBench.points,
                });
              }
            }
          }

          foundSubs
            .sort((a, b) => b.benchPts - a.benchPts)
            .slice(0, 3)
            .forEach((sub, idx) => {
              produced.push({
                id: foundSubs.length === 1 ? tmpl.id : `${tmpl.id}_${idx + 1}_${toStorySlug(sub.team)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  bench_player: sub.bench,
                  bench_pts: sub.benchPts,
                  team: sub.team,
                  player_dnp: sub.dnp,
                }),
                headlineEn: `[T:${sub.team}] gained [N:+${sub.benchPts} Pts] via an autosub as [P:${sub.bench}] replaced [P:${sub.dnp}].`,
                dramaScore: Math.min(92, 84 + Math.floor(sub.benchPts / 2)),
              });
            });
          break;
        }

        // ====================================================================
        // CF_CAPTAIN_POPULAR_MOST_CAPTAINED (Captain | Popular | Most Captained | SINGLE-NEWS)
        // ====================================================================
        case 'CF_CAPTAIN_POPULAR_MOST_CAPTAINED': {
          const validCaps = topCaptains
            .map((cap: any) => {
              const capName = cap.web_name || cap.name;
              const capCount = Number(cap.captain_count || cap.count || 0);
              const capStat = cap.id ? playerMinutesMap.get(cap.id) : null;
              const singlePts = capStat?.points ?? cap.gw_points ?? cap.total_points;
              return {
                name: capName,
                count: capCount,
                captainPts: typeof singlePts === 'number' ? singlePts * 2 : null,
              };
            })
            .filter((c): c is { name: string; count: number; captainPts: number } =>
              Boolean(c.name && c.count > 0 && typeof c.captainPts === 'number')
            )
            .sort((a, b) => b.count - a.count || b.captainPts - a.captainPts);

          if (validCaps.length > 0) {
            const maxCount = validCaps[0].count;
            const tiedCaps = validCaps.filter((c) => c.count === maxCount);
            if (tiedCaps.length === 1) {
              const cap = tiedCaps[0];
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Kapten Terbanyak Tunggal', {
                  gw: currentGw,
                  captain: cap.name,
                  count: cap.count,
                  captain_pts: cap.captainPts,
                }),
                headlineEn: `[P:${cap.name}] was the most captained player ([N:${cap.count}] teams) and finished the week with [N:${cap.captainPts} Pts].`,
                dramaScore: 87,
              });
            } else {
              const listId = formatCaptainListWithPts(tiedCaps, 'id');
              const listEn = formatCaptainListWithPts(tiedCaps, 'en');
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Jumlah Pemilih Sama', {
                  gw: currentGw,
                  captains_list: listId,
                  count: maxCount,
                }),
                headlineEn: `${listEn} tied as the most captained players, each backed by [N:${maxCount}] teams.`,
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
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload.standingsTable.find((s) => s.team === teamName);
            const teamStanding = standings.find((s) => s.entry_name === teamName);
            const tcGw = entry.tc1?.gw === currentGw ? entry.tc1 : (entry.tc2?.gw === currentGw ? entry.tc2 : null);

            if (tcGw) {
              const capStarter = teamRow?.starters?.find((st) => st.isC);
              const capName = capStarter?.name || teamStanding?.captain?.name;
              if (!capName) continue;
              chipIdx++;
              const capTotalPts = capStarter ? capStarter.pts : (tcGw.points ?? teamStanding?.event_points ?? 0);
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  total_pts: capTotalPts,
                  captain: capName,
                }),
                headlineEn: `[T:${teamName}] collected [N:${capTotalPts} Pts] from captain [P:${capName}] via [N:Triple Captain].`,
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
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload.standingsTable.find((s) => s.team === teamName);
            const bbGw = entry.bb1?.gw === currentGw ? entry.bb1 : (entry.bb2?.gw === currentGw ? entry.bb2 : null);

            if (bbGw) {
              chipIdx++;
              const realBenchPts = typeof teamRow?.benchPts === 'number' ? teamRow.benchPts : (bbGw.points ?? 0);
              produced.push({
                id: `${tmpl.id}_${chipIdx}_${toStorySlug(teamName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: teamName,
                  bench_pts: realBenchPts,
                }),
                headlineEn: `[T:${teamName}] added [N:${realBenchPts} Pts] from the bench via [N:Bench Boost].`,
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
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload.standingsTable.find((s) => s.team === teamName);
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
                headlineEn: `[T:${teamName}] finished the week with [N:${gwPts} Pts] via [N:Wildcard].`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CHIP_FREE_HIT (Chip | Free Hit | MULTI-NEWS)
        // ====================================================================
        case 'CF_CHIP_FREE_HIT': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let chipIdx = 0;

          for (const entry of allChips) {
            const teamName = entry.entry_name;
            const teamRow = rawPayload.standingsTable.find((s) => s.team === teamName);
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
                headlineEn: `[T:${teamName}] finished the week with [N:${gwPts} Pts] via [N:Free Hit].`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_TRANSFER_HITS_DEDUCTED (Transfer | Hits | Hits Deducted | MULTI-NEWS)
        // ====================================================================
        case 'CF_TRANSFER_HITS_DEDUCTED': {
          const hitsTeams = standings
            .filter((s) => (s.event_transfers_cost || 0) > 0)
            .sort((a, b) => (b.event_transfers_cost || 0) - (a.event_transfers_cost || 0))
            .slice(0, 3);

          hitsTeams.forEach((topHit, idx) => {
            const transfersEstimated = Math.floor(topHit.event_transfers_cost / 4) + 1;
            produced.push({
              id: hitsTeams.length === 1 ? tmpl.id : `${tmpl.id}_${idx + 1}_${toStorySlug(topHit.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                hits_pts: topHit.event_transfers_cost,
                team: topHit.entry_name,
                transfers_count: transfersEstimated,
              }),
              headlineEn: `[T:${topHit.entry_name}] had [N:-${topHit.event_transfers_cost} Pts] deducted after making [N:${transfersEstimated} Transfers].`,
              dramaScore: Math.max(82, 87 - idx),
            });
          });
          break;
        }

        // ====================================================================
        // CF_TRANSFER_OUT_SOLD_HAULERS (Transfer | Transfers Out | Sold Haulers | MULTI-NEWS)
        // ====================================================================
        case 'CF_TRANSFER_OUT_SOLD_HAULERS': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Transfer' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            const clubResolved = resolveClubName(grp.club);
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: clubResolved,
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} sold [P:${grp.player}] ([C:${clubResolved}]), who went on to score [N:${grp.playerPts} Pts].`,
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
                club: resolveClubName(tr.element_out.club),
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
                headlineEn: `[T:${c.team}] sold [P:${c.playerOut}] ([C:${c.club}]) who scored [N:${c.outPts} Pts], while replacement [P:${c.playerIn}] earned [N:${c.inPts} Pts].`,
                dramaScore: Math.min(92, 82 + Math.floor(c.delta / 2)),
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_CAPTAIN_ALTERNATIVE_MISSED_HAUL (Captain | Alternative | Missed Captain Haul | MULTI-NEWS)
        // Strictly compares MID/FWD alternatives only (enforced by newsAggregator)
        // ====================================================================
        case 'CF_CAPTAIN_ALTERNATIVE_MISSED_HAUL': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Captaincy' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            const clubResolved = resolveClubName(grp.club);
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: clubResolved,
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} fielded [P:${grp.player}] ([C:${clubResolved}]) who scored [N:${grp.playerPts} Pts], without captaining him.`,
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
              const actualCaptainName = capStarter?.name || w.realChoice.split(' (')[0];
              const actualCaptainBasePts = w.realBasePts;
              const clubResolved = resolveClubName(w.club);
              if (!actualCaptainName || !clubResolved) continue;

              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: w.team,
                  actual_captain: actualCaptainName,
                  captain_pts: actualCaptainBasePts,
                  gw: currentGw,
                  player: w.player,
                  club: clubResolved,
                  points: w.alternativePts,
                }),
                headlineEn: `[T:${w.team}] captained [P:${actualCaptainName}] ([N:${actualCaptainBasePts} Pts]) instead of [P:${w.player}] ([C:${clubResolved}]) who scored [N:${w.alternativePts} Pts].`,
                dramaScore: Math.min(91, 82 + Math.floor(w.netDeltaPts / 2)),
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_STANDINGS_RANK_BIGGEST_DROP (Standings | Rank | Biggest Drop | MULTI-NEWS)
        // ====================================================================
        case 'CF_STANDINGS_RANK_BIGGEST_DROP': {
          const fallers = [...standings]
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

          fallers.forEach((f, idx) => {
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
              headlineEn: `[T:${f.team}] dropped [N:-${f.fallSteps} Places] from rank [N:${f.fromRank}] to [N:${f.toRank}] after scoring [N:${f.gwPts} Pts].`,
              dramaScore: Math.min(92, 82 + Math.floor(f.fallSteps / 3)),
            });
          });
          break;
        }

        // ====================================================================
        // CF_STANDINGS_TITLE_RACE_LEAD_CHANGE (Standings | Title Race | Lead Change | SINGLE-NEWS)
        // Emitted ONLY if rank 1 actually changed hands (coupOccurred === true)
        // ====================================================================
        case 'CF_STANDINGS_TITLE_RACE_LEAD_CHANGE': {
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
              headlineEn: `[T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to claim 1st place, overtaking [T:${formerLeader.entry_name}] (now rank [N:${formerLeader.rank}]) by [N:${margin} Pts].`,
              dramaScore: 98,
            });
          }
          break;
        }

        // ====================================================================
        // CF_STANDINGS_TITLE_RACE_POINTS_GAP (Standings | Title Race | Points Gap | MULTI-NEWS)
        // Tight battles (gap <= 3 pts) among top 20, excluding #1 vs #2 pair
        // ====================================================================
        case 'CF_STANDINGS_TITLE_RACE_POINTS_GAP': {
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
            // Exclude #1 vs #2 which is dedicated to CF_STANDINGS_TITLE_RACE
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
                ? `[T:${d.team1}] (rank [N:${d.rank1}]) and [T:${d.team2}] (rank [N:${d.rank2}]) sit level on [N:${d.pts1} Pts].`
                : `[T:${d.team1}] (rank [N:${d.rank1}], [N:${d.pts1} Pts]) leads [T:${d.team2}] (rank [N:${d.rank2}], [N:${d.pts2} Pts]) by [N:${d.gap} Pts].`,
              dramaScore: isTied ? 93 : Math.max(85, 92 - d.gap * 2),
            });
          });
          break;
        }

        // ====================================================================
        // CF_LINEUP_BENCH_POINTS (Lineup | Bench | Points on Bench | MULTI-NEWS)
        // ====================================================================
        case 'CF_LINEUP_BENCH_POINTS': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Bench' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            const clubResolved = resolveClubName(grp.club);
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: clubResolved,
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} benched [P:${grp.player}] ([C:${clubResolved}]) as he scored [N:${grp.playerPts} Pts].`,
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
              const clubResolved = resolveClubName(w.club);
              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: w.team,
                  player: w.player,
                  club: clubResolved,
                  points: w.alternativePts,
                  gw: currentGw,
                }),
                headlineEn: `[T:${w.team}] benched [P:${w.player}] ([C:${clubResolved}]) as he scored [N:${w.alternativePts} Pts].`,
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
