import { getPhase1Templates } from '../data/phase1Templates.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { buildRawMatchdayPayload } from './newsAggregator.ts';
import { formatTeamList } from './teamExposureTracker.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import { computeValidFplAutosubs } from './fplAutosub.ts';

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

const WIB_DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const WIB_DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WIB_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const WIB_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWibDateTimeParts(isoString?: string): {
  dayId: string;
  dayEn: string;
  dateId: string;
  dateEn: string;
  timeWib: string;
} | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const dow = wib.getUTCDay();
  const dom = wib.getUTCDate();
  const mon = wib.getUTCMonth();
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return {
    dayId: WIB_DAYS_ID[dow] || '',
    dayEn: WIB_DAYS_EN[dow] || '',
    dateId: `${dom} ${WIB_MONTHS_ID[mon] || ''}`,
    dateEn: `${dom} ${WIB_MONTHS_EN[mon] || ''}`,
    timeWib: `${hh}:${mm} WIB`,
  };
}

function formatFixtureTopPlayersList(
  players: Array<{ webName: string; ownedPct: number }>,
  lang: 'id' | 'en' = 'id'
): string {
  const tags = players.slice(0, 2).map((p) => `[P:${p.webName}] ([N:${p.ownedPct}%])`);
  if (tags.length === 0) return '';
  if (tags.length === 1) return tags[0];
  return lang === 'id' ? `${tags[0]} dan ${tags[1]}` : `${tags[0]} and ${tags[1]}`;
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

  // Pre-index player statistics strictly from SSOT (dbData.players + gw snapshot ownership)
  const ownershipList: any[] = Array.isArray(snap?.ownership_players) ? snap.ownership_players : [];
  const ownershipById = new Map<number, { pct: number; count: number }>();
  for (const op of ownershipList) {
    if (op?.id) {
      const rawPct = Number(op.owned_percentage ?? op.ownership ?? 0);
      const count = Number(op.owned_count ?? 0);
      ownershipById.set(op.id, {
        pct: Math.round(rawPct) || (rawPct > 0 ? Number(rawPct.toFixed(1)) : 0),
        count,
      });
    }
  }

  const totalTeams = standings.length || Number(dbData?.meta?.total_teams) || 0;
  const playerStatsList: any[] = Object.values(dbData?.players || {});
  const playerMinutesMap = new Map<
    number,
    {
      id: number;
      name: string;
      club: string;
      position: string;
      minutes: number;
      points: number;
      goals: number;
      assists: number;
      bps: number;
      bonus: number;
      ownersCount: number;
      ownershipPct: number;
      status: string;
      newsAdded: string;
      redCards: number;
    }
  >();
  for (const p of playerStatsList) {
    const h = (p.gwHistory || []).find((x: any) => Number(x.round) === currentGw);
    const name = p.webName || p.web_name;
    const club = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name);
    if (!p?.id || !name || !club) continue;

    const ownFromList = ownershipById.get(p.id);
    const ownersCount = ownFromList?.count ?? (p.league_ownership?.count || 0);
    const fallbackPct = totalTeams > 0 ? (ownersCount / totalTeams) * 100 : 0;
    const ownershipPct = ownFromList?.pct ?? (Math.round(fallbackPct) || (fallbackPct > 0 ? Number(fallbackPct.toFixed(1)) : 0));

    playerMinutesMap.set(p.id, {
      id: p.id,
      name,
      club,
      position: p.position || 'MID',
      minutes: h?.minutes || 0,
      points: h?.points || 0,
      goals: h?.goalsScored ?? h?.goals ?? 0,
      assists: h?.assists || 0,
      bps: h?.bps || 0,
      bonus: h?.bonus || 0,
      ownersCount,
      ownershipPct,
      status: p.status || 'a',
      newsAdded: p.newsAdded || '',
      redCards: Number(p.redCards || 0),
    });
  }

  const fixtures = (dbData?.meta?.sync_status?.gw_fixtures || []).filter(
    (f: any) => Number(f.event) === currentGw
  );
  const clubOpponentMap = new Map<string, string>();
  for (const f of fixtures) {
    const home = resolveClubName(f.home_team);
    const away = resolveClubName(f.away_team);
    if (home && away) {
      if (!clubOpponentMap.has(home)) clubOpponentMap.set(home, away);
      if (!clubOpponentMap.has(away)) clubOpponentMap.set(away, home);
    }
  }

  const findPlayerStatByNameClub = (name: string, clubRaw?: string) => {
    const lower = (name || '').trim().toLowerCase();
    const club = clubRaw ? resolveClubName(clubRaw, '') : '';
    for (const p of playerMinutesMap.values()) {
      if (p.name.toLowerCase() === lower && (!club || p.club === club)) return p;
    }
    for (const p of playerMinutesMap.values()) {
      if (p.name.toLowerCase() === lower) return p;
    }
    return undefined;
  };

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
              const maxPts = winner.event_points;
              const tiedWinners = sortedByGwPts.filter((s) => (s.event_points || 0) === maxPts);
              if (tiedWinners.length > 1) {
                const teamsId = formatTeamList(tiedWinners.map((t) => t.entry_name), 'id', false);
                const teamsEn = formatTeamList(tiedWinners.map((t) => t.entry_name), 'en', false);
                produced.push({
                  id: tmpl.id,
                  headlineId: renderTemplateBranch(tmpl.template, 'Poin Sama', {
                    gw: currentGw,
                    teams_list: teamsId,
                    gw_pts: maxPts,
                  }),
                  headlineEn: `${teamsEn} share the Gameweek [N:${currentGw}] crown with [N:${maxPts} Pts].`,
                  dramaScore: 94,
                });
              } else {
                produced.push({
                  id: tmpl.id,
                  headlineId: renderTemplateBranch(tmpl.template, 'Pemenang Tunggal', {
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
            const isTied = margin === 0;

            if (leader && chaser && leader.total_points > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, isTied ? 'Poin Sama' : 'Unggul Poin', {
                  gw: currentGw,
                  team_1: leader.entry_name,
                  pts_1: leader.total_points,
                  margin,
                  team_2: chaser.entry_name,
                }),
                headlineEn: isTied
                  ? `[T:${leader.entry_name}] and [T:${chaser.entry_name}] sit level on [N:${leader.total_points} Pts] at the top after Gameweek [N:${currentGw}].`
                  : `[T:${leader.entry_name}] leads the league table after Gameweek [N:${currentGw}] with [N:${leader.total_points} Pts], [N:${margin} Pts] ahead of [T:${chaser.entry_name}] in 2nd place.`,
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
          const ownershipList: any[] = Array.isArray(snap?.ownership_players) ? snap.ownership_players : [];
          const foundSubs = ownershipList.length > 0
            ? computeValidFplAutosubs(ownershipList, standings, (id, op) => {
                const pInfo = playerMinutesMap.get(id);
                if (!pInfo) return undefined;
                return {
                  id,
                  name: op.web_name || pInfo.name,
                  club: pInfo.club,
                  position: op.position || pInfo.position,
                  minutes: pInfo.minutes,
                  points: pInfo.points,
                };
              })
            : [];

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
            produced.push({
              id: hitsTeams.length === 1 ? tmpl.id : `${tmpl.id}_${idx + 1}_${toStorySlug(topHit.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                hits_pts: topHit.event_transfers_cost,
                team: topHit.entry_name,
              }),
              headlineEn: `[T:${topHit.entry_name}] received a [N:-${topHit.event_transfers_cost} Pts] transfer hit deduction.`,
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
            const isTied = margin === 0;

            produced.push({
              id: tmpl.id,
              headlineId: renderTemplateBranch(tmpl.template, isTied ? 'Poin Sama' : 'Unggul Poin', {
                gw: currentGw,
                new_leader: rank1.entry_name,
                old_rank: r1LastRank,
                former_leader: formerLeader.entry_name,
                former_new_rank: formerLeader.rank,
                margin,
                total_pts: rank1.total_points || 0,
              }),
              headlineEn: isTied
                ? `[T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to share 1st place on [N:${rank1.total_points || 0} Pts], displacing [T:${formerLeader.entry_name}] to rank [N:${formerLeader.rank}].`
                : `[T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to claim 1st place, overtaking [T:${formerLeader.entry_name}] (now rank [N:${formerLeader.rank}]) by [N:${margin} Pts].`,
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

        // ====================================================================
        // CF_CAPTAIN_VICE_CAPTAIN (Captain | Vice-Captain | MULTI-NEWS)
        // ====================================================================
        case 'CF_CAPTAIN_VICE_CAPTAIN': {
          if (rawPayload) {
            const vcSwaps: { team: string; dnpCap: string; vcName: string; vcPts: number }[] = [];
            for (const s of rawPayload.standingsTable) {
              const capStarter = (s.starters || []).find((st) => st.isC);
              const vcStarter = (s.starters || []).find((st) => st.isVC);
              if (!capStarter || !vcStarter) continue;

              const capStat = findPlayerStatByNameClub(capStarter.name, capStarter.club);
              const vcStat = findPlayerStatByNameClub(vcStarter.name, vcStarter.club);
              if (!capStat || capStat.minutes > 0 || !vcStat || vcStat.minutes <= 0) continue;

              const chipLower = String(s.chip || '').toLowerCase();
              const isTc = chipLower === 'tc' || chipLower === '3xc' || chipLower.includes('triple');
              const vcCaptainPts = vcStat.points * (isTc ? 3 : 2);
              vcSwaps.push({
                team: s.team,
                dnpCap: capStat.name,
                vcName: vcStat.name,
                vcPts: vcCaptainPts,
              });
            }

            vcSwaps
              .sort((a, b) => b.vcPts - a.vcPts)
              .slice(0, 3)
              .forEach((v, idx) => {
                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(v.team)}`,
                  headlineId: renderTemplate(tmpl.template, {
                    team: v.team,
                    vice_captain: v.vcName,
                    vice_pts: v.vcPts,
                    captain_dnp: v.dnpCap,
                  }),
                  headlineEn: `[T:${v.team}] officially received captaincy points from vice-captain [P:${v.vcName}] ([N:${v.vcPts} Pts]) after [P:${v.dnpCap}] missed out.`,
                  dramaScore: Math.min(92, 85 + Math.floor(v.vcPts / 4)),
                });
              });
          }
          break;
        }

        // ====================================================================
        // CF_CAPTAIN_DIFFERENTIAL_RETURN (Captain | Differential | MULTI-NEWS)
        // ====================================================================
        case 'CF_CAPTAIN_DIFFERENTIAL_RETURN': {
          const diffCaps = topCaptains.filter(
            (c: any) =>
              (c.captain_percentage != null && c.captain_percentage < 5) ||
              (c.captain_count != null && c.captain_count <= 2)
          );

          const diffStories: {
            team: string;
            pts: number;
            captain: string;
            club: string;
            pickersCount: number;
          }[] = [];

          for (const dc of diffCaps) {
            const stat = dc.id ? playerMinutesMap.get(Number(dc.id)) : findPlayerStatByNameClub(dc.web_name || dc.name);
            if (!stat || stat.points < 8) continue;

            const pickers = standings.filter(
              (s: any) => s.captain?.id === stat.id || (s.captain?.name === stat.name && (!s.captain?.club || resolveClubName(s.captain.club, '') === stat.club))
            );
            const pickersCount = Number(dc.captain_count ?? pickers.length) || pickers.length || 1;
            for (const picker of pickers) {
              const chipLower = String(picker.active_chip || '').toLowerCase();
              const isTc = chipLower === 'tc' || chipLower === '3xc';
              diffStories.push({
                team: picker.entry_name,
                pts: stat.points * (isTc ? 3 : 2),
                captain: stat.name,
                club: stat.club,
                pickersCount,
              });
            }
          }

          diffStories
            .sort((a, b) => b.pts - a.pts || a.pickersCount - b.pickersCount)
            .slice(0, 3)
            .forEach((ds, idx) => {
              const cond = ds.pickersCount === 1 ? 'Kapten Eksklusif' : 'Kapten Differential';
              const headlineId = renderTemplateBranch(tmpl.template, cond, {
                team: ds.team,
                pts: ds.pts,
                captain: ds.captain,
                club: ds.club,
                pickers_count: ds.pickersCount,
              });
              if (!headlineId) return;
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(ds.team)}`,
                headlineId,
                headlineEn:
                  ds.pickersCount === 1
                    ? `[T:${ds.team}] collected [N:${ds.pts} Pts] from [P:${ds.captain}] ([C:${ds.club}]) as the sole team to captain him.`
                    : `[T:${ds.team}] collected [N:${ds.pts} Pts] from differential captain [P:${ds.captain}] ([C:${ds.club}]), backed by just [N:${ds.pickersCount}] teams.`,
                dramaScore: Math.min(93, 86 + Math.floor(ds.pts / 6)),
              });
            });
          break;
        }

        // ====================================================================
        // CF_TRANSFER_IN_MOST_BOUGHT (Transfer | Transfers In | Most Bought | SINGLE-NEWS)
        // ====================================================================
        case 'CF_TRANSFER_IN_MOST_BOUGHT': {
          const topIn: any[] = Array.isArray(snap?.transfers_in) ? snap.transfers_in : [];
          if (topIn.length >= 2) {
            const p1 = topIn[0];
            const p2 = topIn[1];
            const stat1 = p1.id ? playerMinutesMap.get(Number(p1.id)) : findPlayerStatByNameClub(p1.web_name || p1.name);
            const stat2 = p2.id ? playerMinutesMap.get(Number(p2.id)) : findPlayerStatByNameClub(p2.web_name || p2.name);
            const name1 = stat1?.name || p1.web_name || p1.name;
            const name2 = stat2?.name || p2.web_name || p2.name;
            const count1 = Number(p1.transfer_count ?? p1.count ?? 0);
            const count2 = Number(p2.transfer_count ?? p2.count ?? 0);
            const pts1 = stat1?.points ?? Number(p1.gw_points ?? 0);
            const pts2 = stat2?.points ?? Number(p2.gw_points ?? 0);

            if (name1 && name2 && count1 > 0 && count2 > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  player1: name1,
                  count1,
                  pts1,
                  player2: name2,
                  count2,
                  pts2,
                }),
                headlineEn: `[P:${name1}] ([N:${count1}] transfers in) finished the week with [N:${pts1} Pts], while second-most bought [P:${name2}] ([N:${count2}] transfers in) scored [N:${pts2} Pts].`,
                dramaScore: 86,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_MATCH_CLEAN_SHEET (Match | Clean Sheet | MULTI-NEWS)
        // ====================================================================
        case 'CF_MATCH_CLEAN_SHEET': {
          const csMatches: { club: string; opponent: string; score: string }[] = [];
          for (const f of fixtures) {
            if (!f.finished && !f.finished_provisional) continue;
            const hs = Number(f.team_h_score ?? 0);
            const as = Number(f.team_a_score ?? 0);
            const home = resolveClubName(f.home_team);
            const away = resolveClubName(f.away_team);
            if (!home || !away) continue;
            if (as === 0) {
              csMatches.push({ club: home, opponent: away, score: `${hs} - ${as}` });
            }
            if (hs === 0) {
              csMatches.push({ club: away, opponent: home, score: `${as} - ${hs}` });
            }
          }

          const csStories: {
            club: string;
            opponent: string;
            score: string;
            ownersCount: number;
            defender: string;
          }[] = [];

          for (const cm of csMatches) {
            const topDef = Array.from(playerMinutesMap.values())
              .filter(
                (p) =>
                  p.club === cm.club &&
                  (p.position === 'DEF' || p.position === 'GKP') &&
                  p.minutes >= 60 &&
                  p.ownersCount > 0
              )
              .sort((a, b) => b.ownersCount - a.ownersCount || b.points - a.points)[0];
            if (!topDef) continue;
            csStories.push({
              club: cm.club,
              opponent: cm.opponent,
              score: cm.score,
              ownersCount: topDef.ownersCount,
              defender: topDef.name,
            });
          }

          csStories
            .sort((a, b) => b.ownersCount - a.ownersCount)
            .slice(0, 4)
            .forEach((cs) => {
              produced.push({
                id: `${tmpl.id}_${toStorySlug(cs.club)}_${toStorySlug(cs.defender)}`,
                headlineId: renderTemplate(tmpl.template, {
                  club: cs.club,
                  opponent: cs.opponent,
                  score: cs.score,
                  owners_count: cs.ownersCount,
                  defender: cs.defender,
                }),
                headlineEn: `[C:${cs.club}] locked in a clean sheet against [C:${cs.opponent}] ([N:${cs.score}]), delivering official points for [N:${cs.ownersCount}] owners of [P:${cs.defender}].`,
                dramaScore: Math.min(89, 82 + Math.floor(cs.ownersCount / 6)),
              });
            });
          break;
        }

        // ====================================================================
        // CF_LINEUP_DIFFERENTIAL_RETURN (Lineup | Differential | MULTI-NEWS)
        // ====================================================================
        case 'CF_LINEUP_DIFFERENTIAL_RETURN': {
          const diffPlayers: {
            name: string;
            club: string;
            points: number;
            ownershipPct: number;
            starterTeams: string[];
          }[] = [];

          for (const op of ownershipList) {
            const pStat = op?.id ? playerMinutesMap.get(Number(op.id)) : undefined;
            if (!pStat || pStat.points < 8) continue;
            const rawPct = Number(op.owned_percentage ?? op.ownership ?? 100);
            if (rawPct >= 5) continue;

            const starterTeams = (op.owners || [])
              .filter((o: any) => o.is_starter === true)
              .map((o: any) => String(o.entry_name || '').trim())
              .filter(Boolean);
            if (starterTeams.length === 0) continue;

            diffPlayers.push({
              name: pStat.name,
              club: pStat.club,
              points: pStat.points,
              ownershipPct: pStat.ownershipPct,
              starterTeams,
            });
          }

          diffPlayers
            .sort((a, b) => b.points - a.points || b.starterTeams.length - a.starterTeams.length)
            .slice(0, 3)
            .forEach((dp, idx) => {
              const isMulti = dp.starterTeams.length >= 2;
              const headlineId = renderTemplateBranch(tmpl.template, isMulti ? 'Multi Tim' : '1 Tim', {
                team: dp.starterTeams[0],
                teams: isMulti ? formatTeamList(dp.starterTeams, 'id') : `[T:${dp.starterTeams[0]}]`,
                points: dp.points,
                player: dp.name,
                club: dp.club,
                ownership_pct: dp.ownershipPct,
              });
              if (!headlineId) return;
              const teamsEn = isMulti ? formatTeamList(dp.starterTeams, 'en') : `[T:${dp.starterTeams[0]}]`;
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(dp.name)}`,
                headlineId,
                headlineEn: `${teamsEn} reaped [N:${dp.points} Pts] from differential starter [P:${dp.name}] ([C:${dp.club}], [N:${dp.ownershipPct}%] ownership).`,
                dramaScore: Math.min(91, 83 + Math.floor(dp.points / 3)),
              });
            });
          break;
        }

        // ====================================================================
        // CF_MATCH_BONUS_POINTS (Match | Bonus | Bonus Points | SINGLE-NEWS)
        // ====================================================================
        case 'CF_MATCH_BONUS_POINTS': {
          const topBps = Array.from(playerMinutesMap.values())
            .filter((p) => p.minutes > 0 && p.bonus >= 3 && p.bps > 0 && p.ownersCount > 0)
            .sort((a, b) => b.bps - a.bps || b.points - a.points || b.ownersCount - a.ownersCount)[0];

          if (topBps) {
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                player: topBps.name,
                club: topBps.club,
                bps: topBps.bps,
                gw: currentGw,
                points: topBps.points,
                owners_count: topBps.ownersCount,
              }),
              headlineEn: `[P:${topBps.name}] ([C:${topBps.club}]) recorded a Gameweek [N:${currentGw}] high [N:${topBps.bps} BPS] to secure [N:+3 Bonus Pts] ([N:${topBps.points} Pts]) for [N:${topBps.ownersCount}] teams.`,
              dramaScore: 88,
            });
          }
          break;
        }

        // ====================================================================
        // CF_MATCH_DEFENSIVE_CONTRIBUTION (Match | Defensive | SINGLE-NEWS)
        // ====================================================================
        case 'CF_MATCH_DEFENSIVE_CONTRIBUTION': {
          const cachedMatches = getCachedMatchesForGw(currentGw) || [];
          const dcQualifiers: { name: string; club: string; dcCount: number; ownersCount: number }[] = [];
          const seenDcIds = new Set<number>();

          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            const sides = [
              { players: [...(m.home_lineup || []), ...(m.home_bench || [])], club: homeClub },
              { players: [...(m.away_lineup || []), ...(m.away_bench || [])], club: awayClub },
            ];
            for (const side of sides) {
              for (const mp of side.players) {
                if (!mp?.id || seenDcIds.has(mp.id)) continue;
                const dc = Number(mp.stats?.defensive_contribution || 0);
                const pos = mp.position || playerMinutesMap.get(mp.id)?.position || 'MID';
                const qualified = (pos === 'DEF' && dc >= 10) || ((pos === 'MID' || pos === 'FWD') && dc >= 12);
                if (!qualified) continue;
                seenDcIds.add(mp.id);
                const pStat = playerMinutesMap.get(mp.id);
                const ownersCount = pStat?.ownersCount ?? 0;
                if (ownersCount <= 0) continue;
                dcQualifiers.push({
                  name: pStat?.name || mp.web_name,
                  club: pStat?.club || side.club,
                  dcCount: dc,
                  ownersCount,
                });
              }
            }
          }

          if (dcQualifiers.length > 0) {
            dcQualifiers.sort((a, b) => b.dcCount - a.dcCount || b.ownersCount - a.ownersCount);
            const leader = dcQualifiers[0];
            const isSingle = dcQualifiers.length === 1;
            const headlineId = renderTemplateBranch(tmpl.template, isSingle ? '1 Pemain' : 'Multi Pemain', {
              player: leader.name,
              club: leader.club,
              dc_count: leader.dcCount,
              owners_count: leader.ownersCount,
              count: dcQualifiers.length,
              gw: currentGw,
            });
            if (headlineId) {
              produced.push({
                id: tmpl.id,
                headlineId,
                headlineEn: isSingle
                  ? `[P:${leader.name}] ([C:${leader.club}]) secured [N:+2 Pts] Defensive Contribution via [N:${leader.dcCount} Defensive Actions] for [N:${leader.ownersCount}] owners.`
                  : `[N:${dcQualifiers.length}] players, led by [P:${leader.name}] ([C:${leader.club}], [N:${leader.dcCount} Defensive Actions]), earned [N:+2 Pts] Defensive Contribution in Gameweek [N:${currentGw}].`,
                dramaScore: 86,
              });
            }
          }
          break;
        }

        // ====================================================================
        // CF_PLAYER_AVAILABILITY_IMPACT (Player | Availability | MULTI-NEWS)
        // ====================================================================
        case 'CF_PLAYER_AVAILABILITY_IMPACT': {
          const cachedMatches = getCachedMatchesForGw(currentGw) || [];
          const currDeadline = String(
            dbData?.meta?.sync_status?.deadlines?.[String(currentGw)] ||
              dbData?.meta?.deadlines?.[currentGw] ||
              dbData?.meta?.deadlines?.[String(currentGw)] ||
              ''
          );
          const emittedPlayerIds = new Set<number>();
          const incidents: {
            id: number;
            type: 'red' | 'injury';
            name: string;
            club: string;
            opponent: string;
            ownersCount: number;
          }[] = [];

          // 1. Exact GW red cards from cachedMatches when available
          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;
            for (const side of [
              { list: [...(m.home_lineup || []), ...(m.home_bench || [])], club: homeClub, opp: awayClub },
              { list: [...(m.away_lineup || []), ...(m.away_bench || [])], club: awayClub, opp: homeClub },
            ]) {
              for (const mp of side.list) {
                if (!mp?.id || Number(mp.stats?.red_cards || 0) <= 0 || emittedPlayerIds.has(mp.id)) continue;
                const pStat = playerMinutesMap.get(mp.id);
                const ownersCount = pStat?.ownersCount ?? 0;
                if (ownersCount <= 0) continue;
                emittedPlayerIds.add(mp.id);
                incidents.push({
                  id: mp.id,
                  type: 'red',
                  name: pStat?.name || mp.web_name,
                  club: pStat?.club || side.club,
                  opponent: side.opp,
                  ownersCount,
                });
              }
            }
          }

          // 2. SSOT fallback for GW red-card suspension + injuries updated after GW N deadline
          const fallbackRed = Array.from(playerMinutesMap.values())
            .filter(
              (p) =>
                !emittedPlayerIds.has(p.id) &&
                p.minutes > 0 &&
                p.status === 's' &&
                p.redCards > 0 &&
                p.ownersCount > 0 &&
                (!currDeadline || (p.newsAdded && p.newsAdded >= currDeadline)) &&
                clubOpponentMap.has(p.club)
            )
            .sort((a, b) => b.ownersCount - a.ownersCount);

          for (const rp of fallbackRed) {
            emittedPlayerIds.add(rp.id);
            incidents.push({
              id: rp.id,
              type: 'red',
              name: rp.name,
              club: rp.club,
              opponent: clubOpponentMap.get(rp.club)!,
              ownersCount: rp.ownersCount,
            });
          }

          const injuredPlayers = Array.from(playerMinutesMap.values())
            .filter(
              (p) =>
                !emittedPlayerIds.has(p.id) &&
                p.minutes > 0 &&
                (p.status === 'i' || p.status === 'd') &&
                p.ownersCount > 0 &&
                (!currDeadline || (p.newsAdded && p.newsAdded >= currDeadline)) &&
                clubOpponentMap.has(p.club)
            )
            .sort((a, b) => b.ownersCount - a.ownersCount)
            .slice(0, Math.max(0, 3 - incidents.length));

          for (const ip of injuredPlayers) {
            emittedPlayerIds.add(ip.id);
            incidents.push({
              id: ip.id,
              type: 'injury',
              name: ip.name,
              club: ip.club,
              opponent: clubOpponentMap.get(ip.club)!,
              ownersCount: ip.ownersCount,
            });
          }

          const selectedIncidents = incidents.slice(0, 3);
          const cfSlugCounts = new Map<string, number>();
          for (const inc of selectedIncidents) {
            const k = `${inc.type}_${toStorySlug(inc.name)}`;
            cfSlugCounts.set(k, (cfSlugCounts.get(k) || 0) + 1);
          }

          selectedIncidents.forEach((inc) => {
            const cond = inc.type === 'red' ? 'Kartu Merah' : 'Cedera';
            const headlineId = renderTemplateBranch(tmpl.template, cond, {
              player: inc.name,
              club: inc.club,
              opponent: inc.opponent,
              owners_count: inc.ownersCount,
            });
            if (!headlineId) return;
            const slugKey = `${inc.type}_${toStorySlug(inc.name)}`;
            const uniqueSuffix = (cfSlugCounts.get(slugKey) || 0) > 1 ? `${slugKey}_${inc.id}` : slugKey;
            produced.push({
              id: `${tmpl.id}_${uniqueSuffix}`,
              headlineId,
              headlineEn:
                inc.type === 'red'
                  ? `[P:${inc.name}] ([C:${inc.club}]) received a red card ([N:-3 Pts]) against [C:${inc.opponent}] and faces suspension for [N:${inc.ownersCount}] owners.`
                  : `[P:${inc.name}] ([C:${inc.club}]) suffered an injury against [C:${inc.opponent}], impacting [N:${inc.ownersCount}] owners ahead of next week.`,
              dramaScore: inc.type === 'red' ? 91 : 88,
            });
          });
          break;
        }

        // ====================================================================
        // CF_MATCH_NEXT_DEADLINE (Match | Deadline | Next GW Deadline | SINGLE-NEWS)
        // ====================================================================
        case 'CF_MATCH_NEXT_DEADLINE': {
          if (currentGw >= 38) break;
          const nextGw = currentGw + 1;
          const deadlinesMap: Record<string, string> =
            (dbData?.meta?.deadlines as Record<string, string>) ||
            (dbData?.meta?.sync_status?.deadlines as Record<string, string>) ||
            {};
          const nextDeadlineIso =
            deadlinesMap[String(nextGw)] ||
            (Number(dbData?.meta?.current_gw) === currentGw
              ? String(dbData?.meta?.sync_status?.next_deadline_time || '')
              : '');
          const parts = formatWibDateTimeParts(nextDeadlineIso);
          if (!parts) break;

          const headlineId = renderTemplate(tmpl.template, {
            next_gw: nextGw,
            wib_day: parts.dayId,
            wib_date: parts.dateId,
            deadline_time: parts.timeWib,
          });
          if (headlineId) {
            produced.push({
              id: tmpl.id,
              headlineId,
              headlineEn: `Gameweek [N:${nextGw}] Deadline: ${parts.dayEn}, ${parts.dateEn} at [N:${parts.timeWib}].`,
              dramaScore: 92,
            });
          }
          break;
        }

        // ====================================================================
        // CF_MATCH_NEXT_GW_FIXTURES (Match | Next Fixtures | Upcoming Fixtures | MULTI-NEWS)
        // ====================================================================
        case 'CF_MATCH_NEXT_GW_FIXTURES': {
          if (currentGw >= 38) break;
          const nextGw = currentGw + 1;
          const nextFixtures = (dbData?.meta?.sync_status?.gw_fixtures || [])
            .filter((f: any) => Number(f.event) === nextGw && Boolean(f.kickoff_time))
            .sort((a: any, b: any) => {
              const tDiff = new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime();
              return tDiff !== 0 ? tDiff : Number(a.id || 0) - Number(b.id || 0);
            });
          if (nextFixtures.length === 0) break;

          // Build set of FNB entry IDs still holding Triple Captain in the target season half
          const isHalf2 = nextGw >= 20;
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          const remTcEntryIds = new Set<number>(
            allChips
              .filter((c: any) => c?.entry_id && !(isHalf2 ? c.tc2 : c.tc1))
              .map((c: any) => Number(c.entry_id))
          );

          // Index owned players per club from snapshot ownership + db players
          type MatchOwnedAsset = {
            id: number;
            webName: string;
            club: string;
            position: string;
            ownedCount: number;
            ownedPct: number;
            totalPoints: number;
            nowCost: number;
            ownersSet: Set<number>;
          };

          const dbPlayerById = new Map<number, any>();
          const allPlayersByClub = new Map<string, any[]>();
          for (const p of playerStatsList) {
            if (!p?.id) continue;
            dbPlayerById.set(Number(p.id), p);
            const club = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name, '');
            if (!club) continue;
            if (!allPlayersByClub.has(club)) allPlayersByClub.set(club, []);
            allPlayersByClub.get(club)!.push(p);
          }

          const ownedPlayersByClub = new Map<string, MatchOwnedAsset[]>();
          const seenOwnedPlayerIds = new Set<number>();
          for (const op of ownershipList) {
            if (!op?.id || Number(op.owned_count || 0) <= 0) continue;
            const dbP = dbPlayerById.get(Number(op.id));
            const club = resolveClubName(
              op.team_name || dbP?.teamName || op.team_short_name || dbP?.teamShort,
              ''
            );
            const webName = op.web_name || dbP?.webName;
            if (!club || !webName) continue;

            const ownersArr: any[] = Array.isArray(op.owners)
              ? op.owners
              : Array.isArray(dbP?.league_ownership?.owners)
                ? dbP.league_ownership.owners
                : [];
            const ownersSet = new Set<number>(
              ownersArr.map((o: any) => Number(o?.entry_id || o)).filter(Boolean)
            );
            const rawPct = Number(op.owned_percentage ?? 0);
            const ownedPct = Math.round(rawPct) || (rawPct > 0 ? Number(rawPct.toFixed(1)) : 0);

            seenOwnedPlayerIds.add(Number(op.id));
            if (!ownedPlayersByClub.has(club)) ownedPlayersByClub.set(club, []);
            ownedPlayersByClub.get(club)!.push({
              id: Number(op.id),
              webName,
              club,
              position: String(op.position || dbP?.position || 'MID').toUpperCase(),
              ownedCount: Number(op.owned_count || 0),
              ownedPct,
              totalPoints: Number(op.total_points ?? dbP?.totalPoints ?? 0),
              nowCost: Number(op.now_cost ?? dbP?.nowCost ?? 0),
              ownersSet,
            });
          }

          // Fallback if ownership_players list omitted an owned dbPlayer
          for (const p of playerStatsList) {
            const count = Number(p?.league_ownership?.count || 0);
            if (!p?.id || count <= 0 || seenOwnedPlayerIds.has(Number(p.id))) continue;
            const club = resolveClubName(p.teamName || p.teamShort, '');
            const webName = p.webName || p.web_name;
            if (!club || !webName) continue;
            const ownersArr: any[] = Array.isArray(p.league_ownership?.owners) ? p.league_ownership.owners : [];
            const ownersSet = new Set<number>(
              ownersArr.map((o: any) => Number(o?.entry_id || o)).filter(Boolean)
            );
            const rawPct = Number(p.league_ownership?.percentage ?? (totalTeams > 0 ? (count / totalTeams) * 100 : 0));
            const ownedPct = Math.round(rawPct) || (rawPct > 0 ? Number(rawPct.toFixed(1)) : 0);
            if (!ownedPlayersByClub.has(club)) ownedPlayersByClub.set(club, []);
            ownedPlayersByClub.get(club)!.push({
              id: Number(p.id),
              webName,
              club,
              position: String(p.position || 'MID').toUpperCase(),
              ownedCount: count,
              ownedPct,
              totalPoints: Number(p.totalPoints ?? 0),
              nowCost: Number(p.nowCost ?? 0),
              ownersSet,
            });
          }

          const sortOwnedDesc = (a: MatchOwnedAsset, b: MatchOwnedAsset) =>
            b.ownedCount - a.ownedCount ||
            b.totalPoints - a.totalPoints ||
            b.nowCost - a.nowCost;

          for (const list of ownedPlayersByClub.values()) {
            list.sort(sortOwnedDesc);
          }

          nextFixtures.forEach((fix: any, idx: number) => {
            const homeClub = resolveClubName(fix.home_team, '');
            const awayClub = resolveClubName(fix.away_team, '');
            const parts = formatWibDateTimeParts(fix.kickoff_time);
            if (!homeClub || !awayClub || !parts) return;

            const hFdr = fix.team_h_difficulty != null ? Number(fix.team_h_difficulty) : null;
            const aFdr = fix.team_a_difficulty != null ? Number(fix.team_a_difficulty) : null;
            const hPos = fix.home_pos != null ? Number(fix.home_pos) : null;
            const aPos = fix.away_pos != null ? Number(fix.away_pos) : null;

            const isMenjanjikan =
              hFdr !== null &&
              aFdr !== null &&
              Math.min(hFdr, aFdr) <= 2 &&
              Math.max(hFdr, aFdr) >= 4;
            const favoredClub =
              isMenjanjikan && hFdr !== null && aFdr !== null
                ? hFdr <= aFdr
                  ? homeClub
                  : awayClub
                : '';
            const isKetat =
              !isMenjanjikan &&
              hPos !== null &&
              aPos !== null &&
              Math.abs(hPos - aPos) <= 4;

            const homeOwned = ownedPlayersByClub.get(homeClub) || [];
            const awayOwned = ownedPlayersByClub.get(awayClub) || [];
            const matchOwned = [...homeOwned, ...awayOwned].sort(sortOwnedDesc);

            let headlineId = '';
            let headlineEn = '';
            let dramaScore = 82;

            if (matchOwned.length === 0) {
              // Tanpa Kepemilikan: soroti aset fit dengan form tertinggi yang belum dimiliki tim FNB
              const clubPool = [
                ...(allPlayersByClub.get(homeClub) || []),
                ...(allPlayersByClub.get(awayClub) || []),
              ];
              const fitPool = clubPool.filter(
                (p: any) =>
                  p.status !== 'i' &&
                  p.status !== 's' &&
                  (p.chanceOfPlayingNextRound === null ||
                    p.chanceOfPlayingNextRound === undefined ||
                    Number(p.chanceOfPlayingNextRound) >= 50)
              );
              const candidatePool = (fitPool.length > 0 ? fitPool : clubPool).sort(
                (a: any, b: any) =>
                  Number(b.form || 0) - Number(a.form || 0) ||
                  Number(b.totalPoints || 0) - Number(a.totalPoints || 0) ||
                  Number(b.nowCost || 0) - Number(a.nowCost || 0)
              );
              const topForm = candidatePool[0];
              if (!topForm?.webName) return;
              const formScore = Number(topForm.form || 0).toFixed(1);
              headlineId = renderTemplateBranch(tmpl.template, 'tanpa kepemilikan', {
                next_gw: nextGw,
                home_club: homeClub,
                away_club: awayClub,
                wib_day: parts.dayId,
                wib_date: parts.dateId,
                kickoff_time: parts.timeWib,
                top_form_player: topForm.webName,
                form_score: formScore,
              });
              headlineEn = `Gameweek [N:${nextGw}]: [C:${homeClub}] vs [C:${awayClub}] on ${parts.dayEn}, ${parts.dateEn} [N:${parts.timeWib}] highlights [P:${topForm.webName}] (form [N:${formScore}]) as an unowned FNB League prospect.`;
              dramaScore = 76;
            } else if (isMenjanjikan) {
              const favoredOwned = ownedPlayersByClub.get(favoredClub) || [];
              // STRICT FPL RULE: NEVER recommend DEF or GKP for Triple Captain — only MID or FWD >= 15%
              const tcCandidates = favoredOwned
                .filter((p) => (p.position === 'MID' || p.position === 'FWD') && p.ownedPct >= 15)
                .map((p) => {
                  let tcOwners = 0;
                  for (const eid of p.ownersSet) {
                    if (remTcEntryIds.has(eid)) tcOwners++;
                  }
                  return { player: p, tcOwners };
                })
                .filter((x) => x.tcOwners >= 1)
                .sort(
                  (a, b) =>
                    b.player.ownedCount - a.player.ownedCount ||
                    b.tcOwners - a.tcOwners ||
                    b.player.totalPoints - a.player.totalPoints
                );

              if (tcCandidates.length > 0) {
                const bestTc = tcCandidates[0];
                headlineId = renderTemplateBranch(tmpl.template, 'ada pemegang tc', {
                  next_gw: nextGw,
                  home_club: homeClub,
                  away_club: awayClub,
                  wib_day: parts.dayId,
                  wib_date: parts.dateId,
                  kickoff_time: parts.timeWib,
                  favored_player: bestTc.player.webName,
                  favored_pct: bestTc.player.ownedPct,
                  tc_owners: bestTc.tcOwners,
                });
                headlineEn = `Gameweek [N:${nextGw}]: [C:${homeClub}] vs [C:${awayClub}] on ${parts.dayEn}, ${parts.dateEn} [N:${parts.timeWib}] offers a promising fixture for [P:${bestTc.player.webName}] ([N:${bestTc.player.ownedPct}%]) with [N:${bestTc.tcOwners}] owners still holding [N:Triple Captain].`;
                dramaScore = 88;
              } else {
                const favoredListPool = favoredOwned.length > 0 ? favoredOwned : matchOwned;
                const playersId = formatFixtureTopPlayersList(favoredListPool, 'id');
                const playersEn = formatFixtureTopPlayersList(favoredListPool, 'en');
                headlineId = renderTemplateBranch(tmpl.template, 'tanpa pemegang tc', {
                  next_gw: nextGw,
                  home_club: homeClub,
                  away_club: awayClub,
                  wib_day: parts.dayId,
                  wib_date: parts.dateId,
                  kickoff_time: parts.timeWib,
                  players_list: playersId,
                });
                headlineEn = `Gameweek [N:${nextGw}]: [C:${homeClub}] vs [C:${awayClub}] on ${parts.dayEn}, ${parts.dateEn} [N:${parts.timeWib}] offers a promising fixture for ${playersEn}.`;
                dramaScore = 85;
              }
            } else if (isKetat) {
              const playersId = formatFixtureTopPlayersList(matchOwned, 'id');
              const playersEn = formatFixtureTopPlayersList(matchOwned, 'en');
              headlineId = renderTemplateBranch(tmpl.template, 'laga ketat', {
                next_gw: nextGw,
                home_club: homeClub,
                away_club: awayClub,
                wib_day: parts.dayId,
                wib_date: parts.dateId,
                kickoff_time: parts.timeWib,
                players_list: playersId,
              });
              headlineEn = `Gameweek [N:${nextGw}]: [C:${homeClub}] vs [C:${awayClub}] on ${parts.dayEn}, ${parts.dateEn} [N:${parts.timeWib}] presents a tight clash for ${playersEn}.`;
              dramaScore = 83;
            } else {
              const playersId = formatFixtureTopPlayersList(matchOwned, 'id');
              const playersEn = formatFixtureTopPlayersList(matchOwned, 'en');
              headlineId = renderTemplateBranch(tmpl.template, 'laga normal', {
                next_gw: nextGw,
                home_club: homeClub,
                away_club: awayClub,
                wib_day: parts.dayId,
                wib_date: parts.dateId,
                kickoff_time: parts.timeWib,
                players_list: playersId,
              });
              headlineEn = `Gameweek [N:${nextGw}]: [C:${homeClub}] vs [C:${awayClub}] on ${parts.dayEn}, ${parts.dateEn} [N:${parts.timeWib}] features ${playersEn}.`;
              dramaScore = 81;
            }

            if (headlineId) {
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(homeClub)}_${toStorySlug(awayClub)}`,
                headlineId,
                headlineEn,
                dramaScore,
              });
            }
          });
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
