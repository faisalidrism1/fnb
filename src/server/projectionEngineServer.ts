import {
  TransformedLeagueData,
  DbPlayerStat,
  PositionType,
  ScheduleTeamSummary,
  ScheduleFixtureSummary,
  ProjectedFixtureOutcome,
  ClubNextMatchEntry,
  ClubGwMatchProjectionItem,
  PlayerGwMatchDetail,
  PlayerGwProjectionCell,
  ProjectedSquadPlayer,
  ProjectedPlayerCoreItem,
  ServerProjectionCorePayload,
  ActualMatchReviewEntry,
  ActualPlayerReviewStat,
  ServerReviewBundlePayload,
  ServerScoutSquadsPayload,
} from '../types.ts';
import { getGameweekStatus } from '../utils/gwStatus.ts';
import {
  ClubSplitStats,
  PROJECTION_FORMULA_VERSION,
  buildClubSplitStatsMap,
  buildClubLineupAttackMods,
  buildClubLineupDefenseMods,
  projectEnhancedFixture,
  calculatePlayerMatchExpectedPoints,
  parseExpectedReturnDate,
  resolveDeadBallDuties,
  getClubFormationsHistory,
  getRecencyWeightedFormationPrior,
} from '../utils/projectionModel.ts';
import {
  buildTacticalHistoryIndex,
  predictClubFormationSlots,
  selectTacticalOutfieldStarters,
} from '../utils/tacticalLineupModel.ts';
import { getFplProvenStatus } from '../utils/fplProvenGuard.ts';
import { ALL_SEASON_FIXTURES } from '../data/allSeasonFixtures.ts';
import pastSeasonRaw from '../data/playersPastSeason2025_26.json' with { type: 'json' };
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json' with { type: 'json' };
import { PLAYER_EXPLOSIVE_CATALOG } from '../data/playerExplosiveCatalog.ts';
import {
  fetchAllSeasonFixturesSchedule,
  fetchMatchesForGw,
  getCachedMatchesForGw,
} from './matchesFetcher.ts';

interface PastSeasonPlayerRecord {
  id: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
}

interface PrecalcMatch {
  gw: number;
  id: number;
  hShort: string;
  aShort: string;
  hScore: number | null;
  aScore: number | null;
  finished: boolean;
  kickoff: string;
}

interface PrecalcPlayerStat {
  pts: number;
  mins: number;
  wasStarter: boolean;
  wasSub: boolean;
}

interface PrecalcReviewData {
  matches: PrecalcMatch[];
  players: Record<string, Record<string, PrecalcPlayerStat>>;
}

const pastSeasonMap = pastSeasonRaw as Record<string, PastSeasonPlayerRecord>;
const precalculatedReviewData = precalculatedReviewDataRaw as PrecalcReviewData;

interface EngineClubMeta {
  id: number;
  name: string;
  short: string;
  badgeUrl: string;
}

const PREMIER_LEAGUE_CLUBS: EngineClubMeta[] = [
  { id: 1, name: 'Arsenal', short: 'ARS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t3.png' },
  { id: 2, name: 'Aston Villa', short: 'AVL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t7.png' },
  { id: 3, name: 'Bournemouth', short: 'BOU', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t91.png' },
  { id: 4, name: 'Brentford', short: 'BRE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t94.png' },
  { id: 5, name: 'Brighton', short: 'BHA', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t36.png' },
  { id: 6, name: 'Chelsea', short: 'CHE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t8.png' },
  { id: 7, name: 'Coventry City', short: 'COV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t9.png' },
  { id: 8, name: 'Crystal Palace', short: 'CRY', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t31.png' },
  { id: 9, name: 'Everton', short: 'EVE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t11.png' },
  { id: 10, name: 'Fulham', short: 'FUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t54.png' },
  { id: 11, name: 'Hull City', short: 'HUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t88.png' },
  { id: 12, name: 'Ipswich Town', short: 'IPS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t40.png' },
  { id: 13, name: 'Leeds', short: 'LEE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t2.png' },
  { id: 14, name: 'Liverpool', short: 'LIV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t14.png' },
  { id: 15, name: 'Man City', short: 'MCI', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t43.png' },
  { id: 16, name: 'Man Utd', short: 'MUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t1.png' },
  { id: 17, name: 'Newcastle', short: 'NEW', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t4.png' },
  { id: 18, name: "Nott'm Forest", short: 'NFO', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t17.png' },
  { id: 19, name: 'Spurs', short: 'TOT', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t6.png' },
  { id: 20, name: 'Sunderland', short: 'SUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t56.png' },
];

function getPositionalPrior(
  pos: PositionType,
  costMil: number,
  past?: PastSeasonPlayerRecord,
  provenTier?: string
): { priorXg90: number; priorXa90: number } {
  let priorXg90 =
    pos === 'FWD'
      ? costMil >= 12 ? 0.70 : costMil >= 9 ? 0.46 : costMil >= 7 ? 0.34 : costMil >= 5.5 ? 0.22 : 0.14
      : pos === 'MID'
      ? costMil >= 10 ? 0.42 : costMil >= 8 ? 0.28 : costMil >= 6.5 ? 0.18 : costMil >= 5 ? 0.10 : 0.04
      : pos === 'DEF'
      ? costMil >= 6 ? 0.07 : costMil >= 5 ? 0.04 : costMil >= 4.5 ? 0.03 : 0.01
      : 0;

  let priorXa90 =
    pos === 'MID'
      ? costMil >= 10 ? 0.34 : costMil >= 8 ? 0.24 : costMil >= 6.5 ? 0.16 : costMil >= 5 ? 0.10 : 0.06
      : pos === 'FWD'
      ? costMil >= 12 ? 0.18 : costMil >= 9 ? 0.16 : costMil >= 7 ? 0.14 : costMil >= 5.5 ? 0.10 : 0.08
      : pos === 'DEF'
      ? costMil >= 6 ? 0.12 : costMil >= 5 ? 0.08 : costMil >= 4.5 ? 0.05 : 0.02
      : 0;

  if (past && past.minutes >= 900) {
    const pastG90 = (past.goals_scored / past.minutes) * 90;
    const pastA90 = (past.assists / past.minutes) * 90;
    const priceWeight = provenTier === 'ELITE' ? 0.45 : provenTier === 'ESTABLISHED' ? 0.55 : 0.60;
    priorXg90 = priceWeight * priorXg90 + (1 - priceWeight) * pastG90;
    priorXa90 = priceWeight * priorXa90 + (1 - priceWeight) * pastA90;
  }

  return { priorXg90, priorXa90 };
}

const POS_STARTER_MINS_PRIOR: Record<PositionType, number> = {
  GKP: 89.5,
  DEF: 85.0,
  MID: 77.0,
  FWD: 79.0,
};

function computeShrunkStarterMinutes(
  pos: PositionType,
  starterMinsSum: number,
  starterStartsCount: number,
  fallbackTotalMins?: number,
  fallbackStarts?: number
): number {
  const prior = POS_STARTER_MINS_PRIOR[pos] ?? 78.0;
  let sampleSum = starterMinsSum;
  let sampleCnt = starterStartsCount;
  if (sampleCnt === 0 && fallbackStarts && fallbackStarts > 0 && fallbackTotalMins && fallbackTotalMins > 0) {
    const avg = Math.min(90, Math.max(55, fallbackTotalMins / fallbackStarts));
    sampleSum = avg * fallbackStarts;
    sampleCnt = fallbackStarts;
  }
  const shrunk = (sampleSum + 4 * prior) / (sampleCnt + 4);
  return Number(Math.min(90, Math.max(60, shrunk)).toFixed(1));
}

interface BonusPoolItem {
  detail: PlayerGwMatchDetail;
  cell?: PlayerGwProjectionCell;
  expBonus: number;
}

function normalizeFixtureBonusPool(entriesByFixKey: Map<string, BonusPoolItem[]>): void {
  const dirtyCells = new Set<PlayerGwProjectionCell>();
  for (const list of entriesByFixKey.values()) {
    if (list.length === 0) continue;
    let sumExpBonus = 0;
    for (const item of list) sumExpBonus += item.expBonus;
    if (sumExpBonus <= 0.6) continue;

    // A Premier League match distributes ~6.35 BPS bonus points on average (3+2+1 plus ties)
    const scale = Math.min(1.42, Math.max(0.62, 6.35 / sumExpBonus));
    if (Math.abs(scale - 1.0) <= 0.02) continue;

    for (const item of list) {
      if (item.expBonus <= 0) continue;
      const delta = (scale - 1.0) * item.expBonus;
      const nextBaseXp = Math.max(0.0, Math.round((item.detail.baseXp + delta) * 10) / 10);
      item.detail.baseXp = nextBaseXp;
      item.detail.xp = Math.max(0.0, Math.round((nextBaseXp + item.detail.spikeMod) * 10) / 10);
      if (item.cell) dirtyCells.add(item.cell);
    }
  }

  for (const cell of dirtyCells) {
    if (!Array.isArray(cell.matches) || cell.matches.length === 0) continue;
    const sumXp = cell.matches.reduce((s, d) => s + (d.xp || 0), 0);
    const sumBase = cell.matches.reduce((s, d) => s + (d.baseXp || 0), 0);
    cell.xp = Number(sumXp.toFixed(1));
    cell.baseXp = Number(sumBase.toFixed(1));
  }
}

export interface ProjectionEpochInfo {
  epochKey: string;
  lifecycleStatus: string;
  isCurrentGwFinishedOrConfirmed: boolean;
  baseHistoricalGW: number;
  targetNextGW: number;
  maxReviewGW: number;
}

/**
 * Deterministic epoch key used to enforce STRICT sync only on:
 *   - Live -> Provisional (epochKey changes from `N-1:Confirmed` to `N:Provisional`)
 *   - Provisional -> Confirmed (epochKey changes from `N:Provisional` to `N:Confirmed`)
 *   - Cold start / full GW shift where cache is empty
 *
 * Notice:
 *   - During GW `N` Live ticks (every 30-60s): epoch stays `N-1:Confirmed` -> ZERO recompute!
 *   - When GW `N` Confirmed rolls over to GW `N+1` Not Started: epoch stays `N:Confirmed` -> ZERO recompute!
 *   - When GW `N+1` Not Started kicks off to Live: epoch stays `N:Confirmed` -> ZERO recompute!
 */
export function computeProjectionEpochInfo(cachedData: TransformedLeagueData | null | undefined): ProjectionEpochInfo {
  const available =
    Array.isArray(cachedData?.available_gws) && cachedData!.available_gws.length > 0
      ? cachedData!.available_gws
      : [1];
  const curr = cachedData?.current_gw || Math.max(...available, 1);
  const evStatus =
    cachedData?.events_status?.[curr] ||
    (cachedData?.gw_status?.event === curr ? cachedData.gw_status : undefined);

  const lifecycleStatus = getGameweekStatus(curr, curr, evStatus, cachedData?.sync_status).status;
  const isCurrentGwFinishedOrConfirmed =
    lifecycleStatus === 'Confirmed' || lifecycleStatus === 'Provisional';

  let baseHistoricalGW: number;
  if (isCurrentGwFinishedOrConfirmed) {
    baseHistoricalGW = Math.min(Math.max(...available, curr), 38);
  } else {
    const completed = available.filter((gw) => {
      const st = cachedData?.events_status?.[gw];
      return gw < curr || st?.status === 'Confirmed' || st?.finished === true;
    });
    baseHistoricalGW = completed.length > 0 ? Math.max(...completed) : Math.max(curr - 1, 1);
  }
  baseHistoricalGW = Math.min(Math.max(baseHistoricalGW, 1), 38);

  const maxReviewGW = baseHistoricalGW;
  const targetNextGW = Math.min(baseHistoricalGW + 1, 38);
  const effectiveEpochStatus =
    baseHistoricalGW === curr && lifecycleStatus === 'Provisional' ? 'Provisional' : 'Confirmed';
  const epochKey = `${baseHistoricalGW}:${effectiveEpochStatus}:${PROJECTION_FORMULA_VERSION}`;

  return {
    epochKey,
    lifecycleStatus,
    isCurrentGwFinishedOrConfirmed,
    baseHistoricalGW,
    targetNextGW,
    maxReviewGW,
  };
}

// ============================================================================
// SERVER MEMORY CACHES & IN-FLIGHT DEDUP
// ============================================================================
interface CoreRuntimeContext {
  epoch: ProjectionEpochInfo;
  corePayload: ServerProjectionCorePayload;
  matchesWithLineupsByGw: Record<number, any[]>;
  clubStatsMap: Record<string, ClubSplitStats>;
  leagueAvgHomeGoals: number;
  leagueAvgAwayGoals: number;
}

let cachedCoreContext: CoreRuntimeContext | null = null;
let inFlightCoreBuild: { epochKey: string; promise: Promise<CoreRuntimeContext> } | null = null;

interface ReviewBaseCache {
  epochKey: string;
  actualMatchLookup: Record<string, ActualMatchReviewEntry[]>;
  actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>>;
  maeRecapRows: any[];
  lineupByGwCache: Map<number, { lineupReviewPerClub: Record<string, any[]>; lineupGwSummary: any }>;
}

let cachedReviewBase: ReviewBaseCache | null = null;
let inFlightReviewBuild: { epochKey: string; promise: Promise<ReviewBaseCache> } | null = null;
// Finished-GW MAE rows survive epoch bumps when GW <= N-1 and already Confirmed!
const confirmedMaeRowCache = new Map<number, { epochBaseGw: number; row: any }>();

let cachedScoutPayload: ServerScoutSquadsPayload | null = null;
let inFlightScoutBuild: { epochKey: string; promise: Promise<ServerScoutSquadsPayload> } | null = null;

export function hasProjectionCoreCache(): boolean {
  return cachedCoreContext !== null;
}

export function hasProjectionScoutCache(): boolean {
  return cachedScoutPayload !== null;
}

export function getProjectionCacheEpochKey(): string | null {
  return cachedCoreContext?.epoch.epochKey ?? null;
}

export function invalidateProjectionEngine(reason?: string): void {
  cachedCoreContext = null;
  inFlightCoreBuild = null;
  cachedReviewBase = null;
  inFlightReviewBuild = null;
  cachedScoutPayload = null;
  inFlightScoutBuild = null;
  confirmedMaeRowCache.clear();
  if (reason) {
    console.log(`[ProjectionEngine] Cache invalidated (${reason})`);
  }
}

export function warmProjectionEngineIfNeeded(cachedData: TransformedLeagueData | null): void {
  if (!cachedData) return;
  const epochInfo = computeProjectionEpochInfo(cachedData);
  const coreWarm = Boolean(cachedCoreContext && cachedCoreContext.epoch.epochKey === epochInfo.epochKey);
  const scoutWarm = Boolean(cachedScoutPayload && cachedScoutPayload.epochKey === epochInfo.epochKey);
  if (coreWarm && scoutWarm) {
    return;
  }
  const warmTask = coreWarm
    ? getServerScoutSquads(cachedData, false)
    : getOrBuildCoreContext(cachedData, false).then(() => getServerScoutSquads(cachedData, false));

  warmTask
    .then(() => {
      console.log(`[ProjectionEngine] Background warm completed (Core + Scout Squads) for epoch ${epochInfo.epochKey}`);
    })
    .catch((err: any) => {
      console.warn(`[ProjectionEngine] Background warm warning:`, err?.message || err);
    });
}

// ============================================================================
// CLUB METADATA & SCHEDULE UNIFICATION (DGW / BGW / LIVE RESCHEDULED AWARE)
// ============================================================================
function buildClubsList(
  cachedData: TransformedLeagueData,
  scheduleTeams?: ScheduleTeamSummary[]
): Array<{ id: number; name: string; short: string; badgeUrl: string }> {
  const fallbackByShort = new Map(PREMIER_LEAGUE_CLUBS.map((c) => [c.short, c]));
  const badgeByShort = new Map<string, string>();
  const badgeById = new Map<number, string>();

  for (const c of PREMIER_LEAGUE_CLUBS) {
    badgeByShort.set(c.short, c.badgeUrl);
    badgeById.set(c.id, c.badgeUrl);
  }
  if (cachedData?.ownership_clubs) {
    for (const gwClubs of Object.values(cachedData.ownership_clubs)) {
      if (!Array.isArray(gwClubs)) continue;
      for (const c of gwClubs) {
        if (c.badge_url) {
          if (c.short_name) badgeByShort.set(c.short_name, c.badge_url);
          if (c.club_id) badgeById.set(c.club_id, c.badge_url);
        }
      }
    }
  }

  const sourceTeams: Array<{ id: number; name: string; short_name: string }> =
    scheduleTeams && scheduleTeams.length >= 20
      ? scheduleTeams
      : PREMIER_LEAGUE_CLUBS.map((c) => ({ id: c.id, name: c.name, short_name: c.short }));

  return sourceTeams.map((t) => {
    const fb = fallbackByShort.get(t.short_name);
    return {
      id: t.id,
      name: t.name || fb?.name || t.short_name,
      short: t.short_name,
      badgeUrl: badgeByShort.get(t.short_name) || badgeById.get(t.id) || fb?.badgeUrl || '',
    };
  });
}

async function buildUnifiedScheduleAndLineups(
  cachedData: TransformedLeagueData,
  epoch: ProjectionEpochInfo,
  force: boolean
): Promise<{
  clubs: Array<{ id: number; name: string; short: string; badgeUrl: string }>;
  scheduleByGw: Record<number, ScheduleFixtureSummary[]>;
  matchesWithLineupsByGw: Record<number, any[]>;
}> {
  const maxDetailGw = Math.min(Math.max(epoch.targetNextGW, epoch.baseHistoricalGW), 38);
  const gwsToLoad = Array.from({ length: maxDetailGw }, (_, i) => i + 1);

  const [liveSchedule, ...gwMatchResults] = await Promise.all([
    fetchAllSeasonFixturesSchedule(force).catch(() => null),
    ...gwsToLoad.map(async (gw) => {
      if (!force) {
        const mem = getCachedMatchesForGw(gw);
        if (mem && mem.length > 0) return { gw, matches: mem };
      }
      const fetched = await fetchMatchesForGw(gw).catch(() => null);
      return { gw, matches: fetched || [] };
    }),
  ]);

  const clubs = buildClubsList(cachedData, liveSchedule?.teams);
  const clubInfoByShort = new Map(clubs.map((c) => [c.short, c]));

  const matchesWithLineupsByGw: Record<number, any[]> = {};
  for (const item of gwMatchResults) {
    if (item && Array.isArray(item.matches) && item.matches.length > 0) {
      matchesWithLineupsByGw[item.gw] = item.matches;
    }
  }

  // Merge sync_status.gw_fixtures for fast live overlay
  const syncFixByGw = new Map<number, Map<string, any>>();
  if (Array.isArray(cachedData?.sync_status?.gw_fixtures)) {
    for (const f of cachedData.sync_status.gw_fixtures) {
      const gw = Number(f?.event);
      if (!gw || !f.home_team || !f.away_team) continue;
      if (!syncFixByGw.has(gw)) syncFixByGw.set(gw, new Map());
      syncFixByGw.get(gw)!.set(`${f.home_team}_${f.away_team}`, f);
    }
  }

  const precalcByGw = new Map<number, PrecalcMatch[]>();
  for (const pm of precalculatedReviewData.matches) {
    if (!precalcByGw.has(pm.gw)) precalcByGw.set(pm.gw, []);
    precalcByGw.get(pm.gw)!.push(pm);
  }

  const scheduleByGw: Record<number, ScheduleFixtureSummary[]> = {};
  for (let gw = 1; gw <= 38; gw++) {
    const liveSchedList = liveSchedule?.matchesByGW?.[gw];
    const detailedList = matchesWithLineupsByGw[gw];

    let rawList: ScheduleFixtureSummary[] = [];

    if (liveSchedList) {
      // Live FPL /api/fixtures/ is the canonical schedule source (naturally handles postponed BGW & DGW)
      rawList = liveSchedList.map((f) => ({ ...f }));
    } else if (detailedList && detailedList.length > 0) {
      rawList = detailedList.map((m: any) => ({
        id: Number(m.id || 0),
        event: gw,
        kickoff_time: m.kickoff_time,
        started: Boolean(m.started),
        finished: Boolean(m.finished),
        finished_provisional: Boolean(m.finished_provisional),
        team_h_score: m.team_h_score ?? null,
        team_a_score: m.team_a_score ?? null,
        home_team: m.home_team,
        away_team: m.away_team,
      }));
    } else {
      const staticList = (ALL_SEASON_FIXTURES as Record<number, any[]>)[gw] || [];
      rawList = staticList.map((m: any) => ({
        id: Number(m.id || 0),
        event: gw,
        kickoff_time: m.kickoff_time,
        started: Boolean(m.started),
        finished: Boolean(m.finished),
        finished_provisional: Boolean(m.finished_provisional),
        team_h_difficulty: m.team_h_difficulty,
        team_a_difficulty: m.team_a_difficulty,
        team_h_score: m.team_h_score ?? null,
        team_a_score: m.team_a_score ?? null,
        home_team: {
          id: m.home_team?.id || clubInfoByShort.get(m.home_team?.short_name)?.id || 0,
          name: m.home_team?.name || clubInfoByShort.get(m.home_team?.short_name)?.name || m.home_team?.short_name || '',
          short_name: m.home_team?.short_name || '',
        },
        away_team: {
          id: m.away_team?.id || clubInfoByShort.get(m.away_team?.short_name)?.id || 0,
          name: m.away_team?.name || clubInfoByShort.get(m.away_team?.short_name)?.name || m.away_team?.short_name || '',
          short_name: m.away_team?.short_name || '',
        },
      }));
    }

    // Overlay authoritative detailed/sync/precalc scores onto schedule items
    const detailByKey = new Map<string, any>();
    if (detailedList) {
      for (const m of detailedList) {
        const hs = m.home_team?.short_name;
        const as = m.away_team?.short_name;
        if (hs && as) detailByKey.set(`${hs}_${as}`, m);
      }
    }
    const syncMap = syncFixByGw.get(gw);
    const precalcMap = new Map((precalcByGw.get(gw) || []).map((pm) => [`${pm.hShort}_${pm.aShort}`, pm]));

    for (const fix of rawList) {
      const key = `${fix.home_team.short_name}_${fix.away_team.short_name}`;
      const det = detailByKey.get(key);
      if (det) {
        fix.started = fix.started || Boolean(det.started);
        fix.finished = fix.finished || Boolean(det.finished);
        fix.finished_provisional = fix.finished_provisional || Boolean(det.finished_provisional);
        if (fix.team_h_score == null && det.team_h_score != null) fix.team_h_score = det.team_h_score;
        if (fix.team_a_score == null && det.team_a_score != null) fix.team_a_score = det.team_a_score;
        if (!fix.kickoff_time && det.kickoff_time) fix.kickoff_time = det.kickoff_time;
      }
      const sf = syncMap?.get(key);
      if (sf) {
        fix.started = fix.started || Boolean(sf.started);
        fix.finished = fix.finished || Boolean(sf.finished);
        fix.finished_provisional = fix.finished_provisional || Boolean(sf.finished_provisional);
        if (fix.team_h_score == null && sf.team_h_score != null) fix.team_h_score = sf.team_h_score;
        if (fix.team_a_score == null && sf.team_a_score != null) fix.team_a_score = sf.team_a_score;
        if (fix.team_h_difficulty == null && sf.team_h_difficulty != null) fix.team_h_difficulty = sf.team_h_difficulty;
        if (fix.team_a_difficulty == null && sf.team_a_difficulty != null) fix.team_a_difficulty = sf.team_a_difficulty;
      }
      const pm = precalcMap.get(key);
      if (pm && gw <= epoch.baseHistoricalGW) {
        fix.finished = fix.finished || Boolean(pm.finished);
        if (fix.team_h_score == null && pm.hScore != null) fix.team_h_score = pm.hScore;
        if (fix.team_a_score == null && pm.aScore != null) fix.team_a_score = pm.aScore;
        if (!fix.kickoff_time && pm.kickoff) fix.kickoff_time = pm.kickoff;
      }
    }

    rawList.sort((a, b) => {
      const ta = a.kickoff_time ? Date.parse(a.kickoff_time) : 0;
      const tb = b.kickoff_time ? Date.parse(b.kickoff_time) : 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    scheduleByGw[gw] = rawList;
  }

  return { clubs, scheduleByGw, matchesWithLineupsByGw };
}

// ============================================================================
// CORE ENGINE: PROJECTION CONTEXT (MATCHES, CLUB STATS, LINEUPS, PLAYER xP)
// ============================================================================
async function getOrBuildCoreContext(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<CoreRuntimeContext> {
  const epoch = computeProjectionEpochInfo(cachedData);

  if (!force && cachedCoreContext && cachedCoreContext.epoch.epochKey === epoch.epochKey) {
    return cachedCoreContext;
  }

  if (!force && inFlightCoreBuild && inFlightCoreBuild.epochKey === epoch.epochKey) {
    return inFlightCoreBuild.promise;
  }

  const buildPromise = (async (): Promise<CoreRuntimeContext> => {
    const startMs = Date.now();
    const { baseHistoricalGW, targetNextGW, isCurrentGwFinishedOrConfirmed } = epoch;

    const { clubs, scheduleByGw, matchesWithLineupsByGw } = await buildUnifiedScheduleAndLineups(
      cachedData,
      epoch,
      force
    );

    // 1. Build merged historical matches map for club stats (prefers Pulse/live, overlays schedule + precalc)
    const historicalMatchesForStats: Record<number, any[]> = {};
    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      if (matchesWithLineupsByGw[gw] && matchesWithLineupsByGw[gw].length > 0) {
        historicalMatchesForStats[gw] = matchesWithLineupsByGw[gw];
      } else if (scheduleByGw[gw] && scheduleByGw[gw].length > 0) {
        historicalMatchesForStats[gw] = scheduleByGw[gw];
      }
    }

    // Also include future/target GW schedule for kickoff lookups in attack mods
    const combinedScheduleForMods: Record<number, any[]> = { ...scheduleByGw };
    for (const [gwStr, list] of Object.entries(matchesWithLineupsByGw)) {
      const gw = Number(gwStr);
      if (list && list.length > 0 && (!combinedScheduleForMods[gw] || combinedScheduleForMods[gw].length === 0)) {
        combinedScheduleForMods[gw] = list;
      }
    }

    const { clubStatsMap, leagueAvgHomeGoals, leagueAvgAwayGoals } = buildClubSplitStatsMap(
      clubs,
      cachedData.player_stats || [],
      historicalMatchesForStats,
      baseHistoricalGW
    );

    const clubLineupAttackMods = buildClubLineupAttackMods(
      cachedData.player_stats || [],
      baseHistoricalGW,
      targetNextGW,
      combinedScheduleForMods
    );
    const clubLineupDefenseMods = buildClubLineupDefenseMods(
      cachedData.player_stats || [],
      baseHistoricalGW,
      targetNextGW,
      combinedScheduleForMods
    );

    const projectFixture = (homeShort: string, awayShort: string, gw: number = targetNextGW): ProjectedFixtureOutcome => {
      const hAttMod = clubLineupAttackMods[homeShort]?.[gw] ?? 1.0;
      const aAttMod = clubLineupAttackMods[awayShort]?.[gw] ?? 1.0;
      const hDefMod = clubLineupDefenseMods[homeShort]?.[gw] ?? 1.0;
      const aDefMod = clubLineupDefenseMods[awayShort]?.[gw] ?? 1.0;
      return projectEnhancedFixture(
        homeShort,
        awayShort,
        clubStatsMap,
        leagueAvgHomeGoals,
        leagueAvgAwayGoals,
        baseHistoricalGW,
        gw,
        hAttMod,
        aAttMod,
        hDefMod,
        aDefMod
      );
    };

    // 2. Fixture projections map + Club Next Matches Map (DGW/BGW array) + Club GW Match Projections (DGW/BGW array)
    const fixtureProjectionsByKey: Record<string, ProjectedFixtureOutcome> = {};
    const clubNextMatchesMap: Record<string, ClubNextMatchEntry[]> = {};
    const clubGwMatchProjections: Record<string, ClubGwMatchProjectionItem[]> = {};

    for (const c of clubs) {
      clubNextMatchesMap[c.short] = [];
      for (let gw = 1; gw <= 38; gw++) {
        clubGwMatchProjections[`${c.short}_${gw}`] = [];
      }
    }

    const clubNameByShort = new Map(clubs.map((c) => [c.short, c.name]));

    for (let gw = 1; gw <= 38; gw++) {
      const matches = scheduleByGw[gw] || [];
      for (const m of matches) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;

        const proj = projectFixture(hShort, aShort, gw);
        fixtureProjectionsByKey[`${gw}_${hShort}_${aShort}`] = proj;

        const fallbackDateIso = new Date(Date.UTC(2026, 9, 24 + (gw - targetNextGW) * 7)).toISOString();
        const kickoffTime = m.kickoff_time || fallbackDateIso;

        const hCsRaw = proj.homeCsProbRaw ?? proj.homeCsProb / 100;
        const aCsRaw = proj.awayCsProbRaw ?? proj.awayCsProb / 100;

        const hEntry: ClubGwMatchProjectionItem = {
          fixtureId: m.id,
          oppShort: aShort,
          oppName: m.away_team?.name || clubNameByShort.get(aShort) || aShort,
          isHome: true,
          kickoffTime,
          teamLambda: proj.lambdaH,
          oppLambda: proj.lambdaA,
          teamGoals: proj.homeGoals,
          oppGoals: proj.awayGoals,
          csProb: hCsRaw,
          csProbPct: proj.homeCsProb,
          expGcPenalty: proj.homeExpGcPenalty,
        };
        const aEntry: ClubGwMatchProjectionItem = {
          fixtureId: m.id,
          oppShort: hShort,
          oppName: m.home_team?.name || clubNameByShort.get(hShort) || hShort,
          isHome: false,
          kickoffTime,
          teamLambda: proj.lambdaA,
          oppLambda: proj.lambdaH,
          teamGoals: proj.awayGoals,
          oppGoals: proj.homeGoals,
          csProb: aCsRaw,
          csProbPct: proj.awayCsProb,
          expGcPenalty: proj.awayExpGcPenalty,
        };

        if (!clubGwMatchProjections[`${hShort}_${gw}`]) clubGwMatchProjections[`${hShort}_${gw}`] = [];
        if (!clubGwMatchProjections[`${aShort}_${gw}`]) clubGwMatchProjections[`${aShort}_${gw}`] = [];
        clubGwMatchProjections[`${hShort}_${gw}`].push(hEntry);
        clubGwMatchProjections[`${aShort}_${gw}`].push(aEntry);

        if (gw === targetNextGW) {
          if (!clubNextMatchesMap[hShort]) clubNextMatchesMap[hShort] = [];
          if (!clubNextMatchesMap[aShort]) clubNextMatchesMap[aShort] = [];
          clubNextMatchesMap[hShort].push({
            fixtureId: m.id,
            opponentShort: aShort,
            opponentName: hEntry.oppName,
            isHome: true,
            kickoffTime: m.kickoff_time || '',
          });
          clubNextMatchesMap[aShort].push({
            fixtureId: m.id,
            opponentShort: hShort,
            opponentName: aEntry.oppName,
            isHome: false,
            kickoffTime: m.kickoff_time || '',
          });
        }
      }
    }

    // 3. Extract Pulse & Precalc matchday participation stats (GW 1..baseHistoricalGW)
    const pulsePlayerStats: Record<number, { starts: number; sub: number; unused: number; bench: number }> = {};
    const clubMatchCount: Record<string, number> = {};
    const livePlayerGwMap = new Map<string, { wasStarter: boolean; mins: number }>();
    const liveCoveredMatchKeySet = new Set<string>();
    const liveCoveredPlayerGwSet = new Set<string>();
    const livePtsByPlayerGw = new Map<number, Map<number, number>>();
    const starterMinsAccumById = new Map<number, { minsSum: number; count: number }>();
    const starterSampleCoveredGwSet = new Set<string>();

    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      const matches = matchesWithLineupsByGw[gw] || [];
      for (const m of matches) {
        const hShort = m.home_team?.short_name;
        const aShort = m.away_team?.short_name;
        const hasLineup = Array.isArray(m.home_lineup) && m.home_lineup.length > 0;
        if (!hasLineup) continue;

        if (m.id) liveCoveredMatchKeySet.add(`${gw}_${m.id}`);
        if (hShort && aShort) liveCoveredMatchKeySet.add(`${gw}_${hShort}_${aShort}`);
        if (hShort) clubMatchCount[hShort] = (clubMatchCount[hShort] || 0) + 1;
        if (aShort) clubMatchCount[aShort] = (clubMatchCount[aShort] || 0) + 1;

        for (const p of [...m.home_lineup, ...(Array.isArray(m.away_lineup) ? m.away_lineup : [])]) {
          if (!p?.id) continue;
          if (!pulsePlayerStats[p.id]) pulsePlayerStats[p.id] = { starts: 0, sub: 0, unused: 0, bench: 0 };
          pulsePlayerStats[p.id].starts += 1;
          liveCoveredPlayerGwSet.add(`${p.id}_${gw}`);
          starterSampleCoveredGwSet.add(`${p.id}_${gw}`);

          const mins = p.stats?.minutes ?? p.minutes ?? 90;
          if (mins > 0) {
            const sm = starterMinsAccumById.get(p.id) || { minsSum: 0, count: 0 };
            sm.minsSum += Math.min(90, mins);
            sm.count += 1;
            starterMinsAccumById.set(p.id, sm);
          }

          const prevLive = livePlayerGwMap.get(`${p.id}_${gw}`);
          livePlayerGwMap.set(`${p.id}_${gw}`, {
            wasStarter: Boolean(prevLive?.wasStarter) || true,
            mins: (prevLive?.mins || 0) + mins,
          });

          const pts = typeof p.gw_points === 'number' ? p.gw_points : Number(p.stats?.total_points ?? 0);
          if (!livePtsByPlayerGw.has(p.id)) livePtsByPlayerGw.set(p.id, new Map());
          const gMap = livePtsByPlayerGw.get(p.id)!;
          gMap.set(gw, (gMap.get(gw) || 0) + pts);
        }

        for (const p of [
          ...(Array.isArray(m.home_bench) ? m.home_bench : []),
          ...(Array.isArray(m.away_bench) ? m.away_bench : []),
        ]) {
          if (!p?.id) continue;
          if (!pulsePlayerStats[p.id]) pulsePlayerStats[p.id] = { starts: 0, sub: 0, unused: 0, bench: 0 };
          const mins = p.stats?.minutes ?? p.minutes ?? 0;
          if (mins > 0) pulsePlayerStats[p.id].sub += 1;
          else pulsePlayerStats[p.id].unused += 1;
          pulsePlayerStats[p.id].bench += 1;
          liveCoveredPlayerGwSet.add(`${p.id}_${gw}`);

          const prevLive = livePlayerGwMap.get(`${p.id}_${gw}`);
          livePlayerGwMap.set(`${p.id}_${gw}`, {
            wasStarter: Boolean(prevLive?.wasStarter),
            mins: (prevLive?.mins || 0) + mins,
          });

          const pts = typeof p.gw_points === 'number' ? p.gw_points : Number(p.stats?.total_points ?? 0);
          if (!livePtsByPlayerGw.has(p.id)) livePtsByPlayerGw.set(p.id, new Map());
          const gMap = livePtsByPlayerGw.get(p.id)!;
          gMap.set(gw, (gMap.get(gw) || 0) + pts);
        }
      }
    }

    const fallbackMatchGwSet = new Set<number>();
    for (const pm of precalculatedReviewData.matches) {
      if (pm.gw > baseHistoricalGW || !pm.finished) continue;
      if (
        liveCoveredMatchKeySet.has(`${pm.gw}_${pm.id}`) ||
        liveCoveredMatchKeySet.has(`${pm.gw}_${pm.hShort}_${pm.aShort}`)
      ) {
        continue;
      }
      fallbackMatchGwSet.add(pm.gw);
      clubMatchCount[pm.hShort] = (clubMatchCount[pm.hShort] || 0) + 1;
      clubMatchCount[pm.aShort] = (clubMatchCount[pm.aShort] || 0) + 1;
    }

    for (const [idStr, gws] of Object.entries(precalculatedReviewData.players)) {
      const pId = Number(idStr);
      for (const [gwStr, stat] of Object.entries(gws)) {
        const gw = Number(gwStr);
        if (gw > baseHistoricalGW || liveCoveredPlayerGwSet.has(`${pId}_${gw}`) || !fallbackMatchGwSet.has(gw)) {
          continue;
        }
        if (!pulsePlayerStats[pId]) pulsePlayerStats[pId] = { starts: 0, sub: 0, unused: 0, bench: 0 };
        if (stat.wasStarter) {
          pulsePlayerStats[pId].starts += 1;
          if (!starterSampleCoveredGwSet.has(`${pId}_${gw}`) && stat.mins > 0) {
            starterSampleCoveredGwSet.add(`${pId}_${gw}`);
            const sm = starterMinsAccumById.get(pId) || { minsSum: 0, count: 0 };
            sm.minsSum += Math.min(90, stat.mins);
            sm.count += 1;
            starterMinsAccumById.set(pId, sm);
          }
        }
        else if (stat.wasSub) {
          pulsePlayerStats[pId].sub += 1;
          pulsePlayerStats[pId].bench += 1;
        } else {
          pulsePlayerStats[pId].unused += 1;
          pulsePlayerStats[pId].bench += 1;
        }
      }
    }

    for (const c of clubs) {
      if (!clubMatchCount[c.short]) {
        clubMatchCount[c.short] = clubStatsMap[c.short]?.totalMatches || baseHistoricalGW;
      }
    }

    // 4. Dynamic Explosive Hauls per player
    const dynamicExplosiveById = new Map<number, { hauls: number; maxPts: number; haulRate: number }>();
    const allPlayers = (cachedData.player_stats || []).filter((p) => p.status !== 'u');

    for (const p of allPlayers) {
      const gwPts = new Map<number, number>();
      const liveMap = livePtsByPlayerGw.get(p.id);
      if (liveMap) {
        for (const [gw, pts] of liveMap.entries()) gwPts.set(gw, pts);
      }
      for (const h of p.gwHistory || []) {
        if (h.round <= baseHistoricalGW && !gwPts.has(h.round)) {
          gwPts.set(h.round, Number(h.points || 0));
        }
      }

      const expProfile = PLAYER_EXPLOSIVE_CATALOG[p.id];
      const earlyGwsMissing = Array.from({ length: Math.min(8, baseHistoricalGW) }, (_, i) => i + 1).some(
        (g) => !gwPts.has(g)
      );

      let hauls = 0;
      let maxPts = 0;
      let sampleGws = gwPts.size;

      if (earlyGwsMissing && expProfile) {
        hauls = expProfile.hauls;
        maxPts = expProfile.maxPts;
        let extraGws = 0;
        for (const [gw, pts] of gwPts.entries()) {
          if (gw > 8) {
            extraGws++;
            if (pts >= 10) hauls++;
            if (pts > maxPts) maxPts = pts;
          }
        }
        sampleGws = Math.max(8 + extraGws, baseHistoricalGW, 1);
      } else {
        for (const pts of gwPts.values()) {
          if (pts >= 10) hauls++;
          if (pts > maxPts) maxPts = pts;
        }
        hauls = Math.max(hauls, Number((p as any).doubleDigitHauls || 0));
        maxPts = Math.max(maxPts, Number((p as any).maxGwPoints || 0));
        sampleGws = Math.max(sampleGws, baseHistoricalGW, 1);
      }

      const haulRate =
        hauls > 0
          ? Math.round((hauls / Math.max(sampleGws, 1)) * 100)
          : (expProfile?.haulRate ?? Number((p as any).haulRate || 0));
      dynamicExplosiveById.set(p.id, { hauls, maxPts, haulRate });
    }

    // 5. Club Squad Projections (Starting XI / Bench / Out) for targetNextGW
    const clubSquadProjections: Record<string, ProjectedSquadPlayer[]> = {};
    for (const c of clubs) {
      clubSquadProjections[c.short] = [];
    }

    const N = Math.max(baseHistoricalGW, 1);
    for (const p of allPlayers) {
      const c = p.teamShort;
      if (!clubSquadProjections[c]) continue;

      const chanceThis = (p as any).chanceOfPlayingThisRound;
      const chanceNext = p.chanceOfPlayingNextRound;
      const rawStatus = (p.status || 'a').toLowerCase();
      const rawNews = p.news || '';
      const isNewsSuspended = /suspende/i.test(rawNews);

      const effectiveChance: number | null = isCurrentGwFinishedOrConfirmed
        ? (chanceNext !== null && chanceNext !== undefined ? chanceNext : chanceThis)
        : (chanceThis !== null && chanceThis !== undefined ? chanceThis : chanceNext);

      const returnDate = parseExpectedReturnDate(rawNews);
      // Earliest fixture in targetNextGW (handles DGW cleanly; BGW won't adjust return date)
      const nextMatches = clubNextMatchesMap[c] || [];
      const earliestKickoff = nextMatches[0]?.kickoffTime;

      let isBeforeReturnDate = false;
      let hasPassedReturnDate = false;
      if (returnDate && earliestKickoff) {
        const matchTime = new Date(earliestKickoff);
        if (!isNaN(matchTime.getTime())) {
          if (matchTime < returnDate) isBeforeReturnDate = true;
          else hasPassedReturnDate = true;
        }
      }

      let effectiveStatus = rawStatus;
      let isSuspended = rawStatus === 's' || isNewsSuspended;
      if (isSuspended && isCurrentGwFinishedOrConfirmed && chanceNext === 100) {
        isSuspended = false;
        effectiveStatus = 'a';
      }

      let A = 1.0;
      if (effectiveStatus === 'u') {
        A = 0.0;
      } else if (isSuspended) {
        A = 0.0;
        effectiveStatus = 's';
      } else if (effectiveStatus === 'i') {
        if (hasPassedReturnDate) {
          A = 0.75;
          effectiveStatus = 'd';
        } else {
          A = 0.0;
          effectiveStatus = 'i';
        }
      } else if (isBeforeReturnDate) {
        A = 0.0;
        effectiveStatus = 'i';
      } else if (effectiveChance === 0) {
        A = 0.0;
      } else if (effectiveChance === 25) {
        A = 0.25;
        effectiveStatus = 'd';
      } else if (effectiveChance === 50) {
        A = 0.5;
        effectiveStatus = 'd';
      } else if (effectiveChance === 75) {
        A = 0.75;
        effectiveStatus = 'd';
      } else {
        A = 1.0;
        effectiveStatus = 'a';
      }

      const pulseP = pulsePlayerStats[p.id];
      const clubMatchesPlayed = clubMatchCount[c] || N;
      const startsCount = pulseP ? pulseP.starts : (p.starts || 0);
      const subCount = pulseP ? pulseP.sub : 0;
      const unusedCount = pulseP ? pulseP.unused : 0;
      const benchCount = pulseP ? pulseP.bench : subCount + unusedCount;
      const inSquadCount = startsCount + subCount + unusedCount;
      const outOfSquadCount = Math.max(clubMatchesPlayed - inSquadCount, 0);

      const R =
        inSquadCount > 0
          ? startsCount / inSquadCount
          : clubMatchesPlayed > 0
          ? startsCount / clubMatchesPlayed
          : 0.05;

      let sPrev1 = 0;
      let sPrev2 = 0;
      let hasPrev1 = false;
      let hasPrev2 = false;
      let startedPrev1 = false;
      let startedPrev2 = false;

      const pPrecalc = precalculatedReviewData.players[String(p.id)];
      if (baseHistoricalGW >= 1) {
        hasPrev1 = true;
        const live1 = livePlayerGwMap.get(`${p.id}_${baseHistoricalGW}`);
        const h1 = p.gwHistory?.find((h) => h.round === baseHistoricalGW);
        const stat1 = live1 ?? (h1 ? { wasStarter: h1.minutes >= 55, mins: h1.minutes } : pPrecalc?.[String(baseHistoricalGW)]);
        if (stat1?.wasStarter) {
          sPrev1 = 1.0;
          startedPrev1 = true;
        } else if (stat1 && stat1.mins > 0) {
          sPrev1 = 0.35;
        }
      }

      if (baseHistoricalGW >= 2) {
        hasPrev2 = true;
        const live2 = livePlayerGwMap.get(`${p.id}_${baseHistoricalGW - 1}`);
        const h2 = p.gwHistory?.find((h) => h.round === baseHistoricalGW - 1);
        const stat2 = live2 ?? (h2 ? { wasStarter: h2.minutes >= 55, mins: h2.minutes } : pPrecalc?.[String(baseHistoricalGW - 1)]);
        if (stat2?.wasStarter) {
          sPrev2 = 1.0;
          startedPrev2 = true;
        } else if (stat2 && stat2.mins > 0) {
          sPrev2 = 0.35;
        }
      }

      let compositeRate = R;
      if (hasPrev1 && hasPrev2) {
        compositeRate = 0.50 * R + 0.30 * sPrev1 + 0.20 * sPrev2;
      } else if (hasPrev1) {
        compositeRate = 0.60 * R + 0.40 * sPrev1;
      }

      const dynExp = dynamicExplosiveById.get(p.id);
      const provenStatus = getFplProvenStatus({
        ...p,
        doubleDigitHauls: dynExp?.hauls ?? (p as any).doubleDigitHauls,
      } as any);

      let momentumBonus = 0;
      if (startedPrev1 && startedPrev2) {
        momentumBonus = 8;
      } else if (hasPrev1 && hasPrev2 && sPrev1 === 0 && sPrev2 === 0 && inSquadCount >= 2) {
        momentumBonus = provenStatus.isProven ? 0 : -8;
      }

      const rawBaseSi = Math.round(compositeRate * 100) + momentumBonus;
      const baseSi = Math.min(99, Math.max(rawBaseSi, 5));
      const siVal = Math.round(A * baseSi);

      clubSquadProjections[c].push({
        id: p.id,
        code: (p as any).code || p.id,
        webName: p.webName,
        fullName: p.fullName,
        position: p.position as PositionType,
        shirtNum: (p as any).shirtNum || (p as any).shirt_number || 0,
        teamShort: c,
        nowCost: (p.nowCost || 50) / 10,
        si: siVal,
        baseSi,
        isRotation5050: false,
        starts: startsCount,
        sub: subCount,
        unused: unusedCount,
        bench: benchCount,
        outOfSquad: outOfSquadCount,
        status: effectiveStatus,
        chance: A === 0 ? 0 : effectiveChance,
        news: rawNews || (effectiveStatus === 's' ? 'SUS (0%)' : effectiveStatus === 'i' ? 'INJ (0%)' : ''),
        expectedReturnDate: returnDate ? returnDate.toISOString() : null,
        role: 'bench',
        doubleDigitHauls: dynExp?.hauls ?? (p as any).doubleDigitHauls ?? 0,
        maxGwPoints: dynExp?.maxPts ?? (p as any).maxGwPoints ?? 0,
        haulRate: dynExp?.haulRate ?? (p as any).haulRate ?? 0,
        explosiveIndex: (p as any).explosiveIndex || ((dynExp?.hauls ?? 0) * 22),
        proven: provenStatus,
        photo:
          (p as any).photo ||
          ((p as any).code
            ? `https://resources.premierleague.com/premierleague25/photos/players/500x500/${(p as any).code}.png`
            : ''),
      });
    }

    const clubFormationsHistory = getClubFormationsHistory(
      baseHistoricalGW,
      cachedData.player_stats || [],
      precalculatedReviewData.players,
      historicalMatchesForStats
    );
    const tacticalIndex = buildTacticalHistoryIndex(historicalMatchesForStats, baseHistoricalGW);

    for (const c of clubs) {
      const squad = clubSquadProjections[c.short] || [];
      squad.sort((a, b) => b.si - a.si || b.starts - a.starts || b.bench - a.bench || b.nowCost - a.nowCost);

      const isPlayerAvailable = (p: ProjectedSquadPlayer) =>
        p.si > 0 &&
        p.status !== 'i' &&
        p.status !== 's' &&
        p.status !== 'u' &&
        p.chance !== 0 &&
        !/suspende/i.test(p.news || '');

      const isFitStarterCandidate = (p: ProjectedSquadPlayer) => isPlayerAvailable(p) && p.chance !== 50;

      const availableGkps = squad.filter((p) => p.position === 'GKP' && isPlayerAvailable(p));
      const fitGkps = availableGkps.filter((p) => isFitStarterCandidate(p));
      const allGkpsSorted = squad.filter((p) => p.position === 'GKP');

      const starters: ProjectedSquadPlayer[] = [];
      if (fitGkps.length > 0) starters.push(fitGkps[0]);
      else if (availableGkps.length > 0) starters.push(availableGkps[0]);
      else if (allGkpsSorted.length > 0) starters.push(allGkpsSorted[0]);

      const availableOutfields = squad.filter((p) => p.position !== 'GKP' && isPlayerAvailable(p));
      const fitOutfields = availableOutfields.filter((p) => isFitStarterCandidate(p));
      const outOutfields = squad.filter((p) => p.position !== 'GKP' && !isPlayerAvailable(p));

      const tacticalResult = selectTacticalOutfieldStarters(
        c.short,
        targetNextGW,
        fitOutfields.map((p) => ({
          id: p.id,
          position: p.position,
          si: p.si,
          starts: p.starts,
          bench: p.bench,
          nowCost: p.nowCost,
          provenTier: p.proven?.tier,
        })),
        tacticalIndex
      );

      if (tacticalResult && tacticalResult.starterOutfieldIds.length > 0) {
        const fitById = new Map(fitOutfields.map((p) => [p.id, p]));
        for (const pId of tacticalResult.starterOutfieldIds) {
          const picked = fitById.get(pId);
          if (picked) starters.push(picked);
        }
      } else {
        const formationTarget = getRecencyWeightedFormationPrior(c.short, targetNextGW, clubFormationsHistory);
        const fitDefs = fitOutfields.filter((p) => p.position === 'DEF');
        const fitMids = fitOutfields.filter((p) => p.position === 'MID');
        const fitFwds = fitOutfields.filter((p) => p.position === 'FWD');
        const availFwds = availableOutfields.filter((p) => p.position === 'FWD');
        const coreDefs = fitDefs.slice(0, 3);
        const coreMids = fitMids.slice(0, 3);
        const requiresPureFwd = (formationTarget.FWD ?? 0) >= 0.65;
        const coreFwds = requiresPureFwd
          ? (fitFwds.length > 0 ? fitFwds.slice(0, 1) : availFwds.slice(0, 1))
          : [];
        coreDefs.forEach((p) => starters.push(p));
        coreMids.forEach((p) => starters.push(p));
        coreFwds.forEach((p) => starters.push(p));

        const coreStarterIds = new Set(starters.map((p) => p.id));
        const flexCandidates = fitOutfields.filter((p) => !coreStarterIds.has(p.id));
        let curDef = coreDefs.length;
        let curMid = coreMids.length;
        let curFwd = coreFwds.length;
        const flexSlotsNeeded = Math.max(0, 11 - starters.length);

        for (let slot = 0; slot < flexSlotsNeeded; slot++) {
          if (flexCandidates.length === 0) break;
          flexCandidates.forEach((cand) => {
            const target = formationTarget[cand.position] || 0;
            const cur = cand.position === 'DEF' ? curDef : cand.position === 'MID' ? curMid : curFwd;
            const quotaGap = Math.max(0, target - cur);
            const provenPriority = cand.proven?.tier === 'ELITE' ? 14 : cand.proven?.tier === 'ESTABLISHED' ? 8 : 0;
            (cand as any).flexScore = cand.si + 8 * quotaGap + provenPriority;
          });
          flexCandidates.sort(
            (a, b) =>
              ((b as any).flexScore ?? b.si) - ((a as any).flexScore ?? a.si) ||
              b.si - a.si ||
              b.starts - a.starts ||
              b.bench - a.bench ||
              b.nowCost - a.nowCost
          );
          const chosen = flexCandidates.shift();
          if (chosen) {
            starters.push(chosen);
            coreStarterIds.add(chosen.id);
            if (chosen.position === 'DEF') curDef++;
            else if (chosen.position === 'MID') curMid++;
            else if (chosen.position === 'FWD') curFwd++;
          }
        }
      }

      let starterIds = new Set(starters.map((p) => p.id));
      if (starters.length < 11) {
        const remAvail = availableOutfields.filter((p) => !starterIds.has(p.id));
        remAvail.slice(0, 11 - starters.length).forEach((p) => {
          starters.push(p);
          starterIds.add(p.id);
        });
      }
      if (starters.length < 11 && outOutfields.length > 0) {
        const remOut = outOutfields.filter((p) => !starterIds.has(p.id));
        remOut.slice(0, 11 - starters.length).forEach((p) => {
          starters.push(p);
          starterIds.add(p.id);
        });
      }
      starterIds = new Set(starters.map((p) => p.id));

      const predictedFormationLabel =
        tacticalResult?.predictedFormationLabel ||
        predictClubFormationSlots(c.short, targetNextGW, tacticalIndex)?.label;
      starters.forEach((p, idx) => {
        p.tacticalSlotIndex = idx;
      });
      if (predictedFormationLabel) {
        squad.forEach((p) => {
          p.projectedFormation = predictedFormationLabel;
        });
      }

      const remaining = squad.filter((p) => !starterIds.has(p.id));
      const availableRemaining = remaining.filter((p) => isPlayerAvailable(p));
      const outRemaining = remaining.filter((p) => !isPlayerAvailable(p));

      availableRemaining.sort((a, b) => b.si - a.si || b.bench - a.bench || b.starts - a.starts || b.nowCost - a.nowCost);
      outRemaining.sort((a, b) => b.si - a.si || b.bench - a.bench || b.starts - a.starts || b.nowCost - a.nowCost);

      const bench: ProjectedSquadPlayer[] = [];
      const backupGkp =
        availableRemaining.find((p) => p.position === 'GKP') ||
        remaining.find((p) => p.position === 'GKP');
      if (backupGkp) bench.push(backupGkp);

      const remAvailBench = availableRemaining.filter((p) => !bench.some((b) => b.id === p.id));
      remAvailBench.slice(0, 9 - bench.length).forEach((p) => bench.push(p));

      if (bench.length < 9) {
        const remOutBench = outRemaining.filter((p) => !bench.some((b) => b.id === p.id));
        remOutBench.slice(0, 9 - bench.length).forEach((p) => bench.push(p));
      }

      const benchIds = new Set(bench.map((p) => p.id));
      squad.forEach((p) => {
        if (starterIds.has(p.id)) p.role = 'starting';
        else if (benchIds.has(p.id)) p.role = 'bench';
        else p.role = 'out';
      });

      for (let i = 0; i < squad.length - 1; i++) {
        if (squad[i].si >= 40 && squad[i].si <= 60 && Math.abs(squad[i].si - squad[i + 1].si) <= 10) {
          squad[i].isRotation5050 = true;
          squad[i + 1].isRotation5050 = true;
        }
      }
      if (tacticalResult?.slotBattleIds && tacticalResult.slotBattleIds.size > 0) {
        squad.forEach((p) => {
          if (tacticalResult.slotBattleIds.has(p.id)) p.isRotation5050 = true;
        });
      }
    }

    // 6. All-Player Full-Season Projections (GW 1..38, native DGW sum & BGW blank support)
    const squadPlayerById = new Map<number, ProjectedSquadPlayer>();
    for (const squad of Object.values(clubSquadProjections)) {
      for (const sp of squad) {
        squadPlayerById.set(sp.id, sp);
      }
    }

    const coreBonusPoolByFixKey = new Map<string, BonusPoolItem[]>();
    const allPlayerFullSeasonProjections: ProjectedPlayerCoreItem[] = allPlayers.map((p) => {
      const cShort = p.teamShort;
      const pos = p.position as PositionType;
      const costMil = (p.nowCost || 50) / 10;
      const squadPlayer = squadPlayerById.get(p.id);

      const startsCount = p.starts || 0;
      const fallbackBaseSi = Math.round((Math.max(startsCount, 1) / Math.max(baseHistoricalGW, 1)) * 80);
      const baseSi = squadPlayer?.baseSi || fallbackBaseSi;
      const expectedReturn = squadPlayer?.expectedReturnDate
        ? new Date(squadPlayer.expectedReturnDate)
        : parseExpectedReturnDate(p.news);

      const dynExp = dynamicExplosiveById.get(p.id);
      const doubleDigitHauls = dynExp?.hauls ?? (p as any).doubleDigitHauls ?? 0;
      const maxGwPoints = dynExp?.maxPts ?? (p as any).maxGwPoints ?? 0;
      const haulRate = dynExp?.haulRate ?? (p as any).haulRate ?? 0;

      const deadBall = resolveDeadBallDuties(p.webName, p.fullName, cShort, p);
      const provenStatus = getFplProvenStatus({ ...p, doubleDigitHauls } as any);

      const past = pastSeasonMap[String(p.id)];
      const { priorXg90, priorXa90 } = getPositionalPrior(pos, costMil, past, provenStatus.tier);

      const mins = p.minutes || (p.starts ? p.starts * 75 : 0);
      const rawGoals = p.goalsScored || 0;
      const rawXg = p.expectedGoals || 0;
      const rawAssists = p.assists || 0;
      const rawXa = p.expectedAssists || 0;
      const blendedG = rawXg > 0 ? (0.72 * rawXg + 0.28 * rawGoals) : rawGoals;
      const blendedA = rawXa > 0 ? (0.70 * rawXa + 0.30 * rawAssists) : rawAssists;
      const sampleXg90 = mins > 0 ? (blendedG / mins) * 90 : priorXg90;
      const sampleXa90 = mins > 0 ? (blendedA / mins) * 90 : priorXa90;

      const w = mins / (mins + 300);
      const postXg90 = w * sampleXg90 + (1 - w) * priorXg90;
      const postXa90 = w * sampleXa90 + (1 - w) * priorXa90;

      // Use cStats.totalMatches as divisor and shrink toward PL mean (1.38) consistently with projectEnhancedFixture
      const cStats = clubStatsMap[cShort] || { xg: 10, gf: 10, totalMatches: baseHistoricalGW };
      const clubMatchDivisor = Math.max(cStats.totalMatches || baseHistoricalGW, 1);
      const rawClubXgPerMatch = (cStats.xg * 0.7 + cStats.gf * 0.3) / clubMatchDivisor;
      const clubW = clubMatchDivisor / (clubMatchDivisor + 5);
      const teamXgPerMatch = Math.min(1.95, Math.max(1.15, clubW * rawClubXgPerMatch + (1 - clubW) * 1.38));
      const goalShareCap = pos === 'FWD' ? (costMil >= 11.0 ? 0.60 : 0.55) : pos === 'MID' && costMil >= 10.0 ? 0.52 : 0.48;
      const playerGoalShare = Math.min(goalShareCap, postXg90 / teamXgPerMatch);
      const playerAssistShare = Math.min(0.42, postXa90 / teamXgPerMatch);

      const pForm = Number(p.form || 0);
      const pPpg = Number(p.pointsPerGame || 0);
      const formSlope = pForm < pPpg && pPpg >= 4.5 ? 0.06 : 0.10;
      const formDelta = Math.max(-0.20, Math.min(0.25, (pForm - pPpg) * formSlope));
      const expTotalInvolvement = (p.expectedGoals || 0) + (p.expectedAssists || 0);
      const actualTotalInvolvement = (p.goalsScored || 0) + (p.assists || 0);
      const regressionBounce = expTotalInvolvement > actualTotalInvolvement + 1.5 ? 0.15 : 0.0;

      const nonStartEvents = Math.max(1, baseHistoricalGW - (squadPlayer?.starts ?? startsCount));
      const subAppRate = squadPlayer && baseHistoricalGW >= 3
        ? (squadPlayer.sub === 0 ? 0.02 : Math.min(0.60, squadPlayer.sub / nonStartEvents))
        : undefined;

      const pChanceThis = (p as any).chanceOfPlayingThisRound;
      const pChanceNext = p.chanceOfPlayingNextRound;
      const isNewsSuspended = typeof p.news === 'string' && /suspende/i.test(p.news);
      let isSuspended = p.status === 's' || isNewsSuspended;
      const isInjured = p.status === 'i';
      if (isSuspended && isCurrentGwFinishedOrConfirmed && pChanceNext === 100) {
        isSuspended = false;
      }

      // Backfill starter sample mins from gwHistory when neither live match nor precalc covered a GW
      const starterAccum = { ...(starterMinsAccumById.get(p.id) || { minsSum: 0, count: 0 }) };
      for (const h of p.gwHistory || []) {
        if (h.round <= baseHistoricalGW && h.minutes >= 55 && !starterSampleCoveredGwSet.has(`${p.id}_${h.round}`)) {
          starterAccum.minsSum += Math.min(90, h.minutes);
          starterAccum.count += 1;
        }
      }

      const starterMins = computeShrunkStarterMinutes(
        pos,
        starterAccum.minsSum,
        starterAccum.count,
        p.minutes,
        p.starts
      );

      const rawDc = Number((p as any).defensive_contribution ?? (p as any).defensiveContribution ?? 0);
      const dcPer90 = mins >= 90 && rawDc > 0 ? Number(((rawDc / mins) * 90).toFixed(2)) : 0;
      const avgDcMatch = mins >= 90 && rawDc > 0 ? (rawDc / mins) * 90 : rawDc / clubMatchDivisor;
      const pDc =
        pos === 'DEF'
          ? (avgDcMatch >= 10 ? 0.75 : avgDcMatch >= 7 ? 0.45 : 0.20)
          : pos === 'MID' || pos === 'FWD'
          ? (avgDcMatch >= 12 ? 0.40 : avgDcMatch >= 9 ? 0.25 : 0.05)
          : 0;

      const sampleMins = Math.max(mins, 90);
      const threatPer90 = Number((((Number(p.threat) || 0) / sampleMins) * 90).toFixed(2));
      const creativityPer90 = Number((((Number(p.creativity) || 0) / sampleMins) * 90).toFixed(2));
      const influencePer90 = Number((((Number(p.influence) || 0) / sampleMins) * 90).toFixed(2));
      const bpsPer90 = Number((((Number(p.bps) || 0) / sampleMins) * 90).toFixed(2));
      const savesPer90 = Number((((Number(p.saves) || 0) / sampleMins) * 90).toFixed(2));
      const yellowsPer90 = Number((((Number(p.yellowCards) || 0) / sampleMins) * 90).toFixed(2));

      const fullSeasonPointsMap: Record<number, PlayerGwProjectionCell> = {};

      for (let gw = 1; gw <= 38; gw++) {
        const matchList = clubGwMatchProjections[`${cShort}_${gw}`] || [];
        if (matchList.length === 0) {
          // Blank Gameweek (BGW): 0 matches -> 0.0 xP, clear opp '-'
          fullSeasonPointsMap[gw] = {
            opp: '-',
            isHome: true,
            xp: 0,
            baseXp: 0,
            spikeMod: 0,
            isBlank: true,
            matchCount: 0,
            matches: [],
          };
          continue;
        }

        const matchDetails: PlayerGwMatchDetail[] = [];
        const pendingBonusRefs: Array<{ detail: PlayerGwMatchDetail; fixKey: string; expBonus: number }> = [];
        let sumXp = 0;
        let sumBaseXp = 0;
        let sumSpikeMod = 0;

        for (const matchInfo of matchList) {
          const { oppShort, isHome, kickoffTime, teamLambda, oppLambda, csProb, expGcPenalty } = matchInfo;
          const matchDate = new Date(kickoffTime);

          let gwIsOut = false;
          let gwSiProb =
            squadPlayer?.role === 'out' && p.status === 'a'
              ? Math.min(baseSi, 8) / 100
              : squadPlayer?.role === 'bench' && p.status === 'a'
              ? Math.min(baseSi, 38) / 100
              : baseSi / 100;

          if (isInjured || isSuspended) {
            if (expectedReturn) {
              if (matchDate < expectedReturn) {
                gwIsOut = true;
                gwSiProb = 0.0;
              } else {
                const isFirstWeekBack = matchDate.getTime() - expectedReturn.getTime() < 7 * 24 * 60 * 60 * 1000;
                gwIsOut = false;
                gwSiProb = (isFirstWeekBack ? baseSi * 0.75 : baseSi) / 100;
              }
            } else if (isSuspended) {
              if (gw === targetNextGW) {
                gwIsOut = true;
                gwSiProb = 0.0;
              } else {
                gwIsOut = false;
                gwSiProb = baseSi / 100;
              }
            } else {
              if (gw === targetNextGW) {
                gwIsOut = true;
                gwSiProb = 0.0;
              } else if (gw === targetNextGW + 1) {
                gwIsOut = false;
                gwSiProb = (baseSi * 0.5) / 100;
              } else {
                gwIsOut = false;
                gwSiProb = baseSi / 100;
              }
            }
          } else if (p.status === 'd') {
            if (gw === targetNextGW) {
              const chance = pChanceNext !== null && pChanceNext !== undefined ? pChanceNext : (pChanceThis ?? 75);
              if (chance === 0) {
                gwIsOut = true;
                gwSiProb = 0.0;
              } else {
                gwIsOut = false;
                gwSiProb = (baseSi * (chance / 100)) / 100;
              }
            } else if (gw === targetNextGW + 1) {
              const chance = pChanceNext !== null && pChanceNext !== undefined ? pChanceNext : (pChanceThis ?? 75);
              gwIsOut = false;
              gwSiProb = chance === 0 ? (baseSi * 0.75) / 100 : baseSi / 100;
            } else {
              gwIsOut = false;
              gwSiProb = baseSi / 100;
            }
          } else {
            const chance = gw === targetNextGW ? (isCurrentGwFinishedOrConfirmed ? pChanceNext : pChanceThis) : null;
            if (chance === 0) {
              gwIsOut = true;
              gwSiProb = 0.0;
            }
          }

          if (gw <= baseHistoricalGW) {
            const liveGw = livePlayerGwMap.get(`${p.id}_${gw}`);
            const hGw = p.gwHistory?.find((h) => h.round === gw);
            const precalcGw = precalculatedReviewData.players[String(p.id)]?.[String(gw)];
            const participated = Boolean(
              (liveGw && (liveGw.wasStarter || liveGw.mins > 0)) ||
              (hGw && hGw.minutes > 0) ||
              (precalcGw && (precalcGw.wasStarter || precalcGw.mins > 0))
            );
            if (participated) {
              gwIsOut = false;
              gwSiProb = Math.max(gwSiProb, liveGw?.wasStarter || precalcGw?.wasStarter ? 0.90 : 0.45);
            }
          }

          // In a Double Gameweek (matchList.length >= 2), mild minutes rotation realism if both games are tight
          const dgwRotationFactor = matchList.length >= 2 && costMil < 9.5 && pos !== 'GKP' ? 0.94 : 1.0;

          const xpCalc = calculatePlayerMatchExpectedPoints({
            pos,
            costMil,
            starterIndexProb: Math.min(0.99, gwSiProb * dgwRotationFactor),
            isInjuredOrOut: gwIsOut,
            starterMins,
            teamLambda,
            oppLambda,
            csProb,
            expGcPenalty,
            playerGoalShare,
            playerAssistShare,
            isPrimaryPen: deadBall.isPrimaryPen,
            isSecondaryPen: deadBall.isSecondaryPen,
            isFkTaker: deadBall.isFkTaker,
            isCornerTaker: deadBall.isCornerTaker,
            pDc,
            dcPer90,
            isHome,
            formDelta,
            regressionBounce,
            threatPer90,
            creativityPer90,
            influencePer90,
            bpsPer90,
            savesPer90,
            yellowsPer90,
            subAppRate,
            horizonOffset: Math.max(0, gw - targetNextGW),
            provenGuard: {
              guardFactor: provenStatus.guardFactor,
              maxBlankDropPenalty: provenStatus.maxBlankDropPenalty,
              provenXpFloor: provenStatus.provenXpFloor,
              isProven: provenStatus.isProven,
              tier: provenStatus.tier,
            },
          });

          sumXp += xpCalc.xpTotal;
          sumBaseXp += xpCalc.baseXp;
          sumSpikeMod += xpCalc.spikeMod;

          const detailObj: PlayerGwMatchDetail = {
            fixtureId: matchInfo.fixtureId,
            oppShort,
            isHome,
            oppLabel: `${oppShort} (${isHome ? 'H' : 'A'})`,
            xp: Number(xpCalc.xpTotal.toFixed(1)),
            baseXp: Number(xpCalc.baseXp.toFixed(1)),
            spikeMod: Number(xpCalc.spikeMod.toFixed(1)),
            teamLambda: Number(teamLambda.toFixed(2)),
            oppLambda: Number(oppLambda.toFixed(2)),
            csProb: matchInfo.csProbPct,
          };
          matchDetails.push(detailObj);

          const fixKey = matchInfo.fixtureId
            ? `${gw}_id_${matchInfo.fixtureId}`
            : `${gw}_${isHome ? cShort : oppShort}_${isHome ? oppShort : cShort}`;
          if (xpCalc.expBonus >= 0.04) {
            pendingBonusRefs.push({ detail: detailObj, fixKey, expBonus: xpCalc.expBonus });
          }
        }

        const combinedOpp = matchDetails.map((d) => d.oppLabel).join(' + ');
        const gwCell: PlayerGwProjectionCell = {
          opp: combinedOpp,
          isHome: matchDetails[0]?.isHome ?? true,
          xp: Number(sumXp.toFixed(1)),
          baseXp: Number(sumBaseXp.toFixed(1)),
          spikeMod: Number(sumSpikeMod.toFixed(1)),
          isBlank: false,
          matchCount: matchDetails.length,
          matches: matchDetails,
        };
        fullSeasonPointsMap[gw] = gwCell;

        for (const ref of pendingBonusRefs) {
          if (!coreBonusPoolByFixKey.has(ref.fixKey)) coreBonusPoolByFixKey.set(ref.fixKey, []);
          coreBonusPoolByFixKey.get(ref.fixKey)!.push({
            detail: ref.detail,
            cell: gwCell,
            expBonus: ref.expBonus,
          });
        }
      }

      return {
        id: p.id,
        code: (p as any).code || p.id,
        webName: p.webName,
        fullName: p.fullName,
        teamShort: cShort,
        position: pos,
        nowCost: costMil,
        si: squadPlayer?.si ?? fallbackBaseSi,
        status: squadPlayer?.status ?? p.status ?? 'a',
        chance: squadPlayer?.chance ?? p.chanceOfPlayingNextRound ?? null,
        news: squadPlayer?.news ?? p.news ?? '',
        photo: squadPlayer?.photo ?? (p as any).photo ?? '',
        deadBall,
        proven: provenStatus,
        doubleDigitHauls,
        maxGwPoints,
        haulRate,
        explosiveIndex: (p as any).explosiveIndex || (doubleDigitHauls * 22),
        fullSeasonPointsMap,
      };
    });

    normalizeFixtureBonusPool(coreBonusPoolByFixKey);

    const corePayload: ServerProjectionCorePayload = {
      epochKey: epoch.epochKey,
      generatedAt: new Date().toISOString(),
      lifecycleStatus: epoch.lifecycleStatus,
      isCurrentGwFinishedOrConfirmed: epoch.isCurrentGwFinishedOrConfirmed,
      baseHistoricalGW,
      targetNextGW,
      maxReviewGW: epoch.maxReviewGW,
      clubs,
      scheduleByGw,
      fixtureProjectionsByKey,
      clubNextMatchesMap,
      clubGwMatchProjections,
      clubSquadProjections,
      allPlayerFullSeasonProjections,
    };

    const ctx: CoreRuntimeContext = {
      epoch,
      corePayload,
      matchesWithLineupsByGw,
      clubStatsMap,
      leagueAvgHomeGoals,
      leagueAvgAwayGoals,
    };

    cachedCoreContext = ctx;
    console.log(
      `[ProjectionEngine] Built Core Context epoch=${epoch.epochKey} (${allPlayerFullSeasonProjections.length} players) in ${Date.now() - startMs}ms`
    );
    return ctx;
  })();

  inFlightCoreBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightCoreBuild?.promise === buildPromise) {
      inFlightCoreBuild = null;
    }
  }
}

export async function getServerProjectionCore(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ServerProjectionCorePayload> {
  const ctx = await getOrBuildCoreContext(cachedData, force);
  return ctx.corePayload;
}

// ============================================================================
// REVIEW ENGINE: ACTUALS + LINEUP REVIEW + FULL MAE RECAP (SERVER CACHED)
// ============================================================================
function buildLineupReviewForGw(
  gw: number,
  maxReviewGW: number,
  clubs: Array<{ id: number; name: string; short: string; badgeUrl: string }>,
  allPlayers: DbPlayerStat[],
  actualMatchLookup: Record<string, ActualMatchReviewEntry[]>,
  actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>>,
  matchesByGw: Record<number, any[]>
): { lineupReviewPerClub: Record<string, any[]>; lineupGwSummary: { playedClubs: number; totalHit: number; avgHit: number; pct: number } } {
  const clubsData: Record<string, any[]> = {};
  const clubFormationsHistory = getClubFormationsHistory(
    gw - 1,
    allPlayers,
    precalculatedReviewData.players,
    matchesByGw
  );
  const tacticalIndex = buildTacticalHistoryIndex(matchesByGw, gw - 1);

  const actualPulseFormationMap = new Map<string, string>();
  for (const m of matchesByGw[gw] || []) {
    const hShort = m?.home_team?.short_name;
    const aShort = m?.away_team?.short_name;
    if (hShort && m?.home_formation && !actualPulseFormationMap.has(hShort)) {
      actualPulseFormationMap.set(hShort, String(m.home_formation));
    }
    if (aShort && m?.away_formation && !actualPulseFormationMap.has(aShort)) {
      actualPulseFormationMap.set(aShort, String(m.away_formation));
    }
  }

  let playedClubs = 0;
  let totalHit = 0;

  for (const c of clubs) {
    const squad = allPlayers.filter((p) => p.teamShort === c.short);
    const actualList = actualMatchLookup[`${gw}_${c.short}`] || [];
    const isMatchPlayed = actualList.some((m) => m.finished || m.teamScore !== null);

    const rawSquad = squad.map((p) => {
      const costMil = (p.nowCost || 50) / 10;
      let startsBefore = 0;
      let matchesBefore = 0;
      let inSquadBefore = 0;
      for (let g = 1; g < gw; g++) {
        const gMatches = actualMatchLookup[`${g}_${c.short}`] || [];
        if (gMatches.length > 0) {
          matchesBefore += 1;
          const gStat = actualPlayerStatsMap[p.id]?.[g];
          if (gStat) inSquadBefore += 1;
          if (gStat?.wasStarter) startsBefore += 1;
        }
      }

      const past = pastSeasonMap[String(p.id)];
      const priorRate = past ? Math.min(1.0, past.minutes / 3420) : 0.20;
      const baselineRate =
        inSquadBefore > 0
          ? startsBefore / inSquadBefore
          : matchesBefore > 0
          ? startsBefore / matchesBefore
          : priorRate;

      let sPrev1 = 0;
      let hasPrev1 = false;
      let startedPrev1 = false;
      if (gw >= 2) {
        hasPrev1 = true;
        const stat1 = actualPlayerStatsMap[p.id]?.[gw - 1];
        if (stat1?.wasStarter) {
          sPrev1 = 1.0;
          startedPrev1 = true;
        } else if (stat1 && stat1.mins > 0) {
          sPrev1 = 0.35;
        }
      }

      let sPrev2 = 0;
      let hasPrev2 = false;
      let startedPrev2 = false;
      if (gw >= 3) {
        hasPrev2 = true;
        const stat2 = actualPlayerStatsMap[p.id]?.[gw - 2];
        if (stat2?.wasStarter) {
          sPrev2 = 1.0;
          startedPrev2 = true;
        } else if (stat2 && stat2.mins > 0) {
          sPrev2 = 0.35;
        }
      }

      let compositeRate = baselineRate;
      if (hasPrev1 && hasPrev2) compositeRate = 0.50 * baselineRate + 0.30 * sPrev1 + 0.20 * sPrev2;
      else if (hasPrev1) compositeRate = 0.60 * baselineRate + 0.40 * sPrev1;

      const provenStatus = getFplProvenStatus(p);

      let momentum = 0;
      if (startedPrev1 && startedPrev2) momentum = 8;
      else if (hasPrev1 && hasPrev2 && sPrev1 === 0 && sPrev2 === 0 && inSquadBefore >= 2) {
        momentum = provenStatus.isProven ? 0 : -8;
      }

      const isHistoricalPast = gw < maxReviewGW || isMatchPlayed;
      const isAvailable = isHistoricalPast
        ? true
        : p.status !== 'i' && p.status !== 's' && p.status !== 'u' && p.chanceOfPlayingThisRound !== 0;
      const discount = isHistoricalPast
        ? 1.0
        : p.chanceOfPlayingThisRound === 75
        ? 0.75
        : p.chanceOfPlayingThisRound === 50
        ? 0.5
        : 1.0;
      const baseSi = Math.min(99, Math.max(5, Math.round(compositeRate * 100) + momentum));
      const finalSi = isAvailable ? Math.round(baseSi * discount) : 0;

      return { p, costMil, totalStarts: startsBefore, si: finalSi, isAvailable, provenTier: provenStatus.tier };
    });

    rawSquad.sort((a, b) => b.si - a.si || b.totalStarts - a.totalStarts || b.costMil - a.costMil);

    const isHistoricalPast = gw < maxReviewGW || isMatchPlayed;
    const availableGkps = rawSquad.filter((item) => item.p.position === 'GKP' && item.isAvailable);
    const fitGkps = isHistoricalPast ? availableGkps : availableGkps.filter((item) => item.p.chanceOfPlayingThisRound !== 50);
    const allGkps = rawSquad.filter((item) => item.p.position === 'GKP');
    const starterGkp = fitGkps[0] || availableGkps[0] || allGkps[0];

    const starters: typeof rawSquad = [];
    if (starterGkp) starters.push(starterGkp);

    const availableOutfields = rawSquad.filter((item) => item.p.position !== 'GKP' && item.isAvailable);
    const fitOutfields = isHistoricalPast ? availableOutfields : availableOutfields.filter((item) => item.p.chanceOfPlayingThisRound !== 50);
    const allOutfields = rawSquad.filter((item) => item.p.position !== 'GKP');

    const tacticalResult = selectTacticalOutfieldStarters(
      c.short,
      gw,
      fitOutfields.map((item) => ({
        id: item.p.id,
        position: item.p.position as PositionType,
        si: item.si,
        starts: item.totalStarts,
        bench: 0,
        nowCost: item.costMil,
        provenTier: item.provenTier,
      })),
      tacticalIndex
    );

    if (tacticalResult && tacticalResult.starterOutfieldIds.length > 0) {
      const fitById = new Map(fitOutfields.map((item) => [item.p.id, item]));
      for (const pId of tacticalResult.starterOutfieldIds) {
        const picked = fitById.get(pId);
        if (picked) starters.push(picked);
      }
    } else {
      const formationTarget = getRecencyWeightedFormationPrior(c.short, gw, clubFormationsHistory);
      const fitDefs = fitOutfields.filter((item) => item.p.position === 'DEF');
      const fitMids = fitOutfields.filter((item) => item.p.position === 'MID');
      const fitFwds = fitOutfields.filter((item) => item.p.position === 'FWD');
      const availFwds = availableOutfields.filter((item) => item.p.position === 'FWD');
      const coreDefs = fitDefs.slice(0, 3);
      const coreMids = fitMids.slice(0, 3);
      const requiresPureFwd = (formationTarget.FWD ?? 0) >= 0.65;
      const coreFwds = requiresPureFwd ? (fitFwds.length > 0 ? fitFwds.slice(0, 1) : availFwds.slice(0, 1)) : [];
      coreDefs.forEach((item) => starters.push(item));
      coreMids.forEach((item) => starters.push(item));
      coreFwds.forEach((item) => starters.push(item));

      const coreStarterIds = new Set(starters.map((s) => s.p.id));
      const flexCandidates = fitOutfields.filter((item) => !coreStarterIds.has(item.p.id));
      let curDef = coreDefs.length;
      let curMid = coreMids.length;
      let curFwd = coreFwds.length;
      const flexSlotsNeeded = Math.max(0, 11 - starters.length);

      for (let slot = 0; slot < flexSlotsNeeded; slot++) {
        if (flexCandidates.length === 0) break;
        flexCandidates.forEach((cand) => {
          const target = formationTarget[cand.p.position] || 0;
          const cur = cand.p.position === 'DEF' ? curDef : cand.p.position === 'MID' ? curMid : curFwd;
          const quotaGap = Math.max(0, target - cur);
          const provenPriority = cand.provenTier === 'ELITE' ? 14 : cand.provenTier === 'ESTABLISHED' ? 8 : 0;
          (cand as any).flexScore = cand.si + 8 * quotaGap + provenPriority;
        });
        flexCandidates.sort(
          (a, b) =>
            ((b as any).flexScore ?? b.si) - ((a as any).flexScore ?? a.si) ||
            b.si - a.si ||
            b.totalStarts - a.totalStarts ||
            b.costMil - a.costMil
        );
        const chosen = flexCandidates.shift();
        if (chosen) {
          starters.push(chosen);
          coreStarterIds.add(chosen.p.id);
          if (chosen.p.position === 'DEF') curDef++;
          else if (chosen.p.position === 'MID') curMid++;
          else if (chosen.p.position === 'FWD') curFwd++;
        }
      }
    }

    let starterIds = new Set(starters.map((s) => s.p.id));
    if (starters.length < 11) {
      availableOutfields
        .filter((item) => !starterIds.has(item.p.id))
        .slice(0, 11 - starters.length)
        .forEach((item) => {
          starters.push(item);
          starterIds.add(item.p.id);
        });
    }
    if (starters.length < 11) {
      allOutfields
        .filter((item) => !starterIds.has(item.p.id))
        .slice(0, 11 - starters.length)
        .forEach((item) => {
          starters.push(item);
          starterIds.add(item.p.id);
        });
    }
    starterIds = new Set(starters.map((s) => s.p.id));

    const nonStarters = rawSquad.filter((item) => !starterIds.has(item.p.id));
    const availableBench = nonStarters.filter((item) => item.isAvailable);
    const outBench = nonStarters.filter((item) => !item.isAvailable);
    availableBench.sort((a, b) => b.si - a.si || b.totalStarts - a.totalStarts || b.costMil - a.costMil);
    outBench.sort((a, b) => b.si - a.si || b.totalStarts - a.totalStarts || b.costMil - a.costMil);

    const bench: typeof rawSquad = [];
    const backupGkp =
      availableBench.find((item) => item.p.position === 'GKP') ||
      nonStarters.find((item) => item.p.position === 'GKP');
    if (backupGkp) bench.push(backupGkp);

    availableBench
      .filter((item) => !bench.some((b) => b.p.id === item.p.id))
      .slice(0, 9 - bench.length)
      .forEach((item) => bench.push(item));

    if (bench.length < 9) {
      outBench
        .filter((item) => !bench.some((b) => b.p.id === item.p.id))
        .slice(0, 9 - bench.length)
        .forEach((item) => bench.push(item));
    }

    const benchIds = new Set(bench.map((b) => b.p.id));
    const projectedFormation =
      tacticalResult?.predictedFormationLabel ||
      predictClubFormationSlots(c.short, gw, tacticalIndex)?.label;
    const actualFormation = actualPulseFormationMap.get(c.short) || undefined;

    const ROLE_ORDER: Record<string, number> = { starting: 1, bench: 2, out: 3 };
    const POS_ORDER: Record<string, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };

    const scored = rawSquad.map((item) => {
      const p = item.p;
      const role: 'starting' | 'bench' | 'out' = starterIds.has(p.id)
        ? 'starting'
        : benchIds.has(p.id)
        ? 'bench'
        : 'out';

      const realGw = actualPlayerStatsMap[p.id]?.[gw];
      const realStarted = Boolean(realGw && realGw.wasStarter);
      const realSub = Boolean(realGw && !realGw.wasStarter && realGw.mins > 0);
      const realUnusedSub = Boolean(realGw && !realGw.wasStarter && realGw.mins === 0);
      const realNotInSquad = !realGw;
      const realMins = realGw ? realGw.mins : 0;
      const realPts = realGw ? realGw.pts : 0;

      let isAccuracyMatch = false;
      let accuracyStatusLabel = '-';
      let accuracyBadgeColor = 'bg-slate-500/10 text-slate-400 border-slate-500/20';

      if (isMatchPlayed) {
        if (role === 'starting') isAccuracyMatch = realStarted;
        else if (role === 'bench') isAccuracyMatch = realSub || realUnusedSub;
        else isAccuracyMatch = realNotInSquad;

        if (isAccuracyMatch) {
          accuracyStatusLabel = '✓';
          accuracyBadgeColor = 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
        } else {
          accuracyStatusLabel = '✗';
          accuracyBadgeColor = 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30';
        }
      }

      return {
        id: p.id,
        webName: p.webName,
        fullName: p.fullName,
        position: p.position as PositionType,
        shirtNum: (p as any).shirtNum || 0,
        nowCost: item.costMil,
        status: p.status,
        role,
        si: item.si,
        projectedFormation,
        actualFormation,
        isMatchPlayed,
        realStarted,
        realSub,
        realUnusedSub,
        realNotInSquad,
        realMins,
        realPts,
        isAccuracyMatch,
        accuracyStatusLabel,
        accuracyBadgeColor,
      };
    });

    scored.sort((a, b) => {
      const rDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
      if (rDiff !== 0) return rDiff;
      const pDiff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
      if (pDiff !== 0) return pDiff;
      return b.si - a.si;
    });

    clubsData[c.short] = scored;
    if (isMatchPlayed) {
      playedClubs += 1;
      totalHit += scored.filter((p) => p.role === 'starting' && p.realStarted).length;
    }
  }

  const avgHit = playedClubs > 0 ? Math.round((totalHit / playedClubs) * 10) / 10 : 0;
  const pct = playedClubs > 0 ? Math.round((totalHit / (playedClubs * 11)) * 100) : 0;

  return {
    lineupReviewPerClub: clubsData,
    lineupGwSummary: { playedClubs, totalHit, avgHit, pct },
  };
}

async function getOrBuildReviewBase(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ReviewBaseCache> {
  const epoch = computeProjectionEpochInfo(cachedData);
  if (!force && cachedReviewBase && cachedReviewBase.epochKey === epoch.epochKey) {
    return cachedReviewBase;
  }
  if (!force && inFlightReviewBuild && inFlightReviewBuild.epochKey === epoch.epochKey) {
    return inFlightReviewBuild.promise;
  }

  const buildPromise = (async (): Promise<ReviewBaseCache> => {
    const startMs = Date.now();
    const coreCtx = await getOrBuildCoreContext(cachedData, force);
    const { corePayload, matchesWithLineupsByGw } = coreCtx;
    const maxReviewGW = corePayload.maxReviewGW;

    // 1. Actual Match Lookup keyed as `${gw}_${clubShort}` -> ActualMatchReviewEntry[] (full DGW support!)
    const actualMatchLookup: Record<string, ActualMatchReviewEntry[]> = {};
    const upsertActualMatch = (gw: number, clubShort: string, entry: ActualMatchReviewEntry) => {
      const key = `${gw}_${clubShort}`;
      if (!actualMatchLookup[key]) actualMatchLookup[key] = [];
      const existingIdx = actualMatchLookup[key].findIndex(
        (e) =>
          (entry.fixtureId && e.fixtureId === entry.fixtureId) ||
          (e.oppShort === entry.oppShort && e.isHome === entry.isHome)
      );
      if (existingIdx >= 0) {
        actualMatchLookup[key][existingIdx] = { ...actualMatchLookup[key][existingIdx], ...entry };
      } else {
        actualMatchLookup[key].push(entry);
      }
    };

    for (const pm of precalculatedReviewData.matches) {
      if (pm.gw > maxReviewGW) continue;
      const hScore = pm.hScore;
      const aScore = pm.aScore;
      const isDone = Boolean(pm.finished);

      let resH: 'W' | 'D' | 'L' | null = null;
      let resA: 'W' | 'D' | 'L' | null = null;
      if (isDone && hScore !== null && aScore !== null) {
        if (hScore > aScore) { resH = 'W'; resA = 'L'; }
        else if (hScore < aScore) { resH = 'L'; resA = 'W'; }
        else { resH = 'D'; resA = 'D'; }
      }

      upsertActualMatch(pm.gw, pm.hShort, {
        fixtureId: pm.id,
        gw: pm.gw,
        isHome: true,
        oppShort: pm.aShort,
        teamScore: hScore,
        oppScore: aScore,
        scoreText: isDone && hScore !== null && aScore !== null ? `${hScore} - ${aScore}` : isDone ? 'FT' : `vs ${pm.aShort}`,
        result: resH,
        cleanSheet: isDone && aScore === 0,
        finished: isDone,
        kickoff: pm.kickoff,
      });

      upsertActualMatch(pm.gw, pm.aShort, {
        fixtureId: pm.id,
        gw: pm.gw,
        isHome: false,
        oppShort: pm.hShort,
        teamScore: aScore,
        oppScore: hScore,
        scoreText: isDone && aScore !== null && hScore !== null ? `${aScore} - ${hScore}` : isDone ? 'FT' : `vs ${pm.hShort}`,
        result: resA,
        cleanSheet: isDone && hScore === 0,
        finished: isDone,
        kickoff: pm.kickoff,
      });
    }

    // Merge live/schedule matches cleanly without overwriting DGW siblings
    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const gwList = (matchesWithLineupsByGw[gw]?.length ? matchesWithLineupsByGw[gw] : corePayload.scheduleByGw[gw]) || [];
      for (const m of gwList) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;
        const hScore = m.team_h_score !== null && m.team_h_score !== undefined ? m.team_h_score : null;
        const aScore = m.team_a_score !== null && m.team_a_score !== undefined ? m.team_a_score : null;
        const isDone = Boolean(m.finished || m.finished_provisional || (hScore !== null && aScore !== null));

        let resH: 'W' | 'D' | 'L' | null = null;
        let resA: 'W' | 'D' | 'L' | null = null;
        if (isDone && hScore !== null && aScore !== null) {
          if (hScore > aScore) { resH = 'W'; resA = 'L'; }
          else if (hScore < aScore) { resH = 'L'; resA = 'W'; }
          else { resH = 'D'; resA = 'D'; }
        }

        upsertActualMatch(gw, hShort, {
          fixtureId: m.id,
          gw,
          isHome: true,
          oppShort: aShort,
          teamScore: hScore,
          oppScore: aScore,
          scoreText: isDone && hScore !== null && aScore !== null ? `${hScore} - ${aScore}` : isDone ? 'FT' : `vs ${aShort}`,
          result: resH,
          cleanSheet: isDone && aScore === 0,
          finished: isDone,
          kickoff: m.kickoff_time || '',
        });

        upsertActualMatch(gw, aShort, {
          fixtureId: m.id,
          gw,
          isHome: false,
          oppShort: hShort,
          teamScore: aScore,
          oppScore: hScore,
          scoreText: isDone && aScore !== null && hScore !== null ? `${aScore} - ${hScore}` : isDone ? 'FT' : `vs ${hShort}`,
          result: resA,
          cleanSheet: isDone && hScore === 0,
          finished: isDone,
          kickoff: m.kickoff_time || '',
        });
      }
    }

    for (const arr of Object.values(actualMatchLookup)) {
      arr.sort((a, b) => (a.kickoff ? Date.parse(a.kickoff) : 0) - (b.kickoff ? Date.parse(b.kickoff) : 0));
    }

    // 2. Actual Player Stats Map (sums points & mins across DGW fixtures!)
    const actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>> = {};
    for (const [idStr, gws] of Object.entries(precalculatedReviewData.players)) {
      const pId = Number(idStr);
      actualPlayerStatsMap[pId] = {};
      for (const [gwStr, stat] of Object.entries(gws)) {
        const gw = Number(gwStr);
        if (gw > maxReviewGW) continue;
        actualPlayerStatsMap[pId][gw] = {
          pts: stat.pts,
          mins: stat.mins,
          wasStarter: stat.wasStarter,
          wasSub: stat.wasSub,
        };
      }
    }

    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const matches = matchesWithLineupsByGw[gw];
      if (!Array.isArray(matches) || matches.length === 0) continue;

      const gwAccumulator = new Map<number, ActualPlayerReviewStat>();
      for (const m of matches) {
        for (const p of [
          ...(Array.isArray(m.home_lineup) ? m.home_lineup : []),
          ...(Array.isArray(m.away_lineup) ? m.away_lineup : []),
        ]) {
          if (!p?.id) continue;
          const cur = gwAccumulator.get(p.id) || { pts: 0, mins: 0, wasStarter: false, wasSub: false, matchCount: 0 };
          cur.pts += typeof p.gw_points === 'number' ? p.gw_points : (p.stats?.total_points || 0);
          cur.mins += p.stats?.minutes || 0;
          cur.wasStarter = true;
          cur.matchCount = (cur.matchCount || 0) + 1;
          gwAccumulator.set(p.id, cur);
        }
        for (const p of [
          ...(Array.isArray(m.home_bench) ? m.home_bench : []),
          ...(Array.isArray(m.away_bench) ? m.away_bench : []),
        ]) {
          if (!p?.id) continue;
          const mins = p.stats?.minutes || 0;
          const cur = gwAccumulator.get(p.id) || { pts: 0, mins: 0, wasStarter: false, wasSub: false, matchCount: 0 };
          cur.pts += typeof p.gw_points === 'number' ? p.gw_points : (p.stats?.total_points || 0);
          cur.mins += mins;
          if (!cur.wasStarter && mins > 0) cur.wasSub = true;
          cur.matchCount = (cur.matchCount || 0) + 1;
          gwAccumulator.set(p.id, cur);
        }
      }
      for (const [pId, stat] of gwAccumulator.entries()) {
        if (!actualPlayerStatsMap[pId]) actualPlayerStatsMap[pId] = {};
        actualPlayerStatsMap[pId][gw] = stat;
      }
    }

    // Also backfill from gwHistory if any GW wasn't covered by Pulse/Precalc
    for (const p of cachedData.player_stats || []) {
      for (const h of p.gwHistory || []) {
        if (h.round <= maxReviewGW && !actualPlayerStatsMap[p.id]?.[h.round]) {
          if (!actualPlayerStatsMap[p.id]) actualPlayerStatsMap[p.id] = {};
          actualPlayerStatsMap[p.id][h.round] = {
            pts: Number(h.points || 0),
            mins: Number(h.minutes || 0),
            wasStarter: Number(h.minutes || 0) >= 55,
            wasSub: Number(h.minutes || 0) > 0 && Number(h.minutes || 0) < 55,
          };
        }
      }
    }

    // 3. Precompute full Walk-Forward Out-of-Sample MAE Recap Rows (GW 1..maxReviewGW)
    // Strictly forbids look-ahead leakage: GW `t` uses ONLY GW `1..(t-1)` match stats & prior season data!
    const allPlayers = (cachedData.player_stats || []).filter((p) => p.status !== 'u');

    const buildWalkForwardGwPredictions = (
      gw: number,
      lineupPerClub: Record<string, any[]>
    ): {
      fixtureProjectionsByKey: Record<string, ProjectedFixtureOutcome>;
      playerXpById: Map<number, number>;
    } => {
      const prevGw = gw - 1;
      const histMatches: Record<number, any[]> = {};
      for (let g = 1; g <= prevGw; g++) {
        if (matchesWithLineupsByGw[g]?.length) {
          histMatches[g] = matchesWithLineupsByGw[g];
        } else if (corePayload.scheduleByGw[g]?.length) {
          histMatches[g] = corePayload.scheduleByGw[g];
        }
      }

      // Accumulate strictly < gw per-player metrics from matchesWithLineupsByGw, precalc, and gwHistory
      interface WfPlayerAgg {
        mins: number;
        starts: number;
        goals: number;
        assists: number;
        xg: number;
        xa: number;
        gc: number;
        cs: number;
        xgc: number;
        bps: number;
        saves: number;
        yellows: number;
        threat: number;
        creativity: number;
        influence: number;
        dc: number;
        pts: number;
        hauls: number;
        starterMinsSum: number;
        starterCount: number;
        gwPts: Map<number, number>;
        coveredGws: Set<number>;
      }
      const wfAggMap = new Map<number, WfPlayerAgg>();
      const ensureAgg = (pId: number): WfPlayerAgg => {
        let a = wfAggMap.get(pId);
        if (!a) {
          a = {
            mins: 0, starts: 0, goals: 0, assists: 0, xg: 0, xa: 0, gc: 0, cs: 0, xgc: 0,
            bps: 0, saves: 0, yellows: 0, threat: 0, creativity: 0, influence: 0, dc: 0,
            pts: 0, hauls: 0, starterMinsSum: 0, starterCount: 0,
            gwPts: new Map(), coveredGws: new Set(),
          };
          wfAggMap.set(pId, a);
        }
        return a;
      };

      for (let g = 1; g <= prevGw; g++) {
        const gMatches = matchesWithLineupsByGw[g] || [];
        for (const m of gMatches) {
          const hScore = Number(m.team_h_score ?? 0);
          const aScore = Number(m.team_a_score ?? 0);
          const ingestList = (list: any[] | undefined, isStarterList: boolean, conceded: number) => {
            if (!Array.isArray(list)) return;
            for (const lp of list) {
              if (!lp?.id) continue;
              const agg = ensureAgg(lp.id);
              const st = lp.stats || {};
              const mins = Number(st.minutes ?? lp.minutes ?? (isStarterList ? 90 : 0));
              const pts = typeof lp.gw_points === 'number' ? lp.gw_points : Number(st.total_points ?? 0);
              agg.mins += mins;
              if (isStarterList) {
                agg.starts += 1;
                if (mins > 0) {
                  agg.starterMinsSum += Math.min(90, mins);
                  agg.starterCount += 1;
                }
              }
              agg.goals += Number(st.goals_scored || 0);
              agg.assists += Number(st.assists || 0);
              agg.xg += Number(st.expected_goals || 0);
              agg.xa += Number(st.expected_assists || 0);
              agg.gc += Number(st.goals_conceded ?? (mins > 0 ? conceded : 0));
              agg.cs += Number(st.clean_sheets ?? (mins >= 60 && conceded === 0 ? 1 : 0));
              agg.xgc += Number(st.expected_goals_conceded || 0);
              agg.bps += Number(st.bps || 0);
              agg.saves += Number(st.saves || 0);
              agg.yellows += Number(st.yellow_cards || 0);
              agg.threat += Number(st.threat || 0);
              agg.creativity += Number(st.creativity || 0);
              agg.influence += Number(st.influence || 0);
              agg.dc += Number(st.defensive_contribution || 0);
              agg.pts += pts;
              agg.gwPts.set(g, (agg.gwPts.get(g) || 0) + pts);
              agg.coveredGws.add(g);
            }
          };
          ingestList(m.home_lineup, true, aScore);
          ingestList(m.home_bench, false, aScore);
          ingestList(m.away_lineup, true, hScore);
          ingestList(m.away_bench, false, hScore);
        }
      }

      // Overlay missing < gw rounds from p.gwHistory & precalculatedReviewData
      const syntheticHistPlayers: DbPlayerStat[] = [];
      for (const p of allPlayers) {
        const agg = ensureAgg(p.id);
        const filteredHistory = (p.gwHistory || []).filter((h) => h.round < gw);
        for (const h of filteredHistory) {
          if (agg.coveredGws.has(h.round)) continue;
          agg.coveredGws.add(h.round);
          const mins = Number(h.minutes || 0);
          const pts = Number(h.points || 0);
          agg.mins += mins;
          if (mins >= 55) {
            agg.starts += 1;
            agg.starterMinsSum += Math.min(90, mins);
            agg.starterCount += 1;
          }
          agg.goals += Number((h as any).goals_scored || 0);
          agg.assists += Number((h as any).assists || 0);
          agg.xg += Number((h as any).expected_goals || 0);
          agg.xa += Number((h as any).expected_assists || 0);
          agg.bps += Number((h as any).bps || 0);
          agg.pts += pts;
          agg.gwPts.set(h.round, (agg.gwPts.get(h.round) || 0) + pts);
        }
        const precalcGws = precalculatedReviewData.players[String(p.id)] || {};
        for (let g = 1; g <= prevGw; g++) {
          if (agg.coveredGws.has(g)) continue;
          const ps = precalcGws[String(g)];
          if (!ps) continue;
          agg.coveredGws.add(g);
          agg.mins += ps.mins;
          if (ps.wasStarter) {
            agg.starts += 1;
            if (ps.mins > 0) {
              agg.starterMinsSum += Math.min(90, ps.mins);
              agg.starterCount += 1;
            }
          }
          agg.pts += ps.pts;
          agg.gwPts.set(g, (agg.gwPts.get(g) || 0) + ps.pts);
        }

        for (const pts of agg.gwPts.values()) {
          if (pts >= 10) agg.hauls += 1;
        }

        if (prevGw > 0) {
          syntheticHistPlayers.push({
            ...p,
            totalPoints: agg.pts,
            minutes: agg.mins,
            starts: agg.starts,
            goalsScored: agg.goals,
            assists: agg.assists,
            cleanSheets: agg.cs,
            goalsConceded: agg.gc,
            expectedGoals: agg.xg,
            expectedAssists: agg.xa,
            expectedGoalsConceded: agg.xgc,
            bps: agg.bps,
            saves: agg.saves,
            yellowCards: agg.yellows,
            threat: agg.threat,
            creativity: agg.creativity,
            influence: agg.influence,
            gwHistory: filteredHistory,
          });
        }
      }

      const {
        clubStatsMap: wfClubStats,
        leagueAvgHomeGoals: wfAvgHome,
        leagueAvgAwayGoals: wfAvgAway,
      } = buildClubSplitStatsMap(
        corePayload.clubs,
        prevGw > 0 ? syntheticHistPlayers : [],
        histMatches,
        prevGw
      );

      // Build walk-forward SI & role map from gwLineupBuilt (strictly < gw)
      const wfSiByPlayerId = new Map<number, number>();
      const wfRoleByPlayerId = new Map<number, string>();
      for (const squadList of Object.values(lineupPerClub)) {
        for (const sp of squadList) {
          wfSiByPlayerId.set(sp.id, Number(sp.si ?? 50));
          wfRoleByPlayerId.set(sp.id, String(sp.role || 'bench'));
        }
      }

      // Project all matches in target GW `gw` strictly from < gw knowledge
      const wfFixtureProjectionsByKey: Record<string, ProjectedFixtureOutcome> = {};
      const wfClubMatches: Record<string, Array<{
        fixtureId?: number;
        oppShort: string;
        isHome: boolean;
        teamLambda: number;
        oppLambda: number;
        csProb: number;
        expGcPenalty: number;
      }>> = {};

      const targetMatches =
        (corePayload.scheduleByGw[gw]?.length ? corePayload.scheduleByGw[gw] : matchesWithLineupsByGw[gw]) || [];
      for (const m of targetMatches) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;
        const proj = projectEnhancedFixture(
          hShort,
          aShort,
          wfClubStats,
          wfAvgHome,
          wfAvgAway,
          prevGw,
          gw,
          1.0,
          1.0,
          1.0,
          1.0
        );
        wfFixtureProjectionsByKey[`${gw}_${hShort}_${aShort}`] = proj;
        const hCsRaw = proj.homeCsProbRaw ?? proj.homeCsProb / 100;
        const aCsRaw = proj.awayCsProbRaw ?? proj.awayCsProb / 100;
        if (!wfClubMatches[hShort]) wfClubMatches[hShort] = [];
        if (!wfClubMatches[aShort]) wfClubMatches[aShort] = [];
        wfClubMatches[hShort].push({
          fixtureId: m.id,
          oppShort: aShort,
          isHome: true,
          teamLambda: proj.lambdaH,
          oppLambda: proj.lambdaA,
          csProb: hCsRaw,
          expGcPenalty: proj.homeExpGcPenalty,
        });
        wfClubMatches[aShort].push({
          fixtureId: m.id,
          oppShort: hShort,
          isHome: false,
          teamLambda: proj.lambdaA,
          oppLambda: proj.lambdaH,
          csProb: aCsRaw,
          expGcPenalty: proj.awayExpGcPenalty,
        });
      }

      const bonusPool = new Map<string, BonusPoolItem[]>();
      const playerDetailsMap = new Map<number, PlayerGwMatchDetail[]>();

      for (const p of allPlayers) {
        const cShort = p.teamShort;
        const matchList = wfClubMatches[cShort] || [];
        if (matchList.length === 0) continue;

        const agg = wfAggMap.get(p.id);
        const pos = p.position as PositionType;
        const costMil = (p.nowCost || 50) / 10;
        const past = pastSeasonMap[String(p.id)];
        const filteredHist = (p.gwHistory || []).filter((h) => h.round < gw);

        const wfProven = getFplProvenStatus({
          id: p.id,
          webName: p.webName,
          position: pos,
          nowCost: p.nowCost,
          totalPoints: agg?.pts || 0,
          minutes: agg?.mins || 0,
          doubleDigitHauls: agg?.hauls || 0,
          gwHistory: filteredHist,
        });

        const { priorXg90, priorXa90 } = getPositionalPrior(pos, costMil, past, wfProven.tier);
        const mins = agg?.mins || 0;
        const wfGoals = agg?.goals || 0;
        const wfXg = agg?.xg || 0;
        const wfAssists = agg?.assists || 0;
        const wfXa = agg?.xa || 0;
        const wfBlendG = wfXg > 0 ? (0.72 * wfXg + 0.28 * wfGoals) : wfGoals;
        const wfBlendA = wfXa > 0 ? (0.70 * wfXa + 0.30 * wfAssists) : wfAssists;
        const sampleXg90 = mins > 0 ? (wfBlendG / mins) * 90 : priorXg90;
        const sampleXa90 = mins > 0 ? (wfBlendA / mins) * 90 : priorXa90;

        const w = mins / (mins + 300);
        const postXg90 = w * sampleXg90 + (1 - w) * priorXg90;
        const postXa90 = w * sampleXa90 + (1 - w) * priorXa90;

        const cStats = wfClubStats[cShort] || { xg: 1.4, gf: 1.4, totalMatches: 1 };
        const clubDiv = Math.max(cStats.totalMatches || prevGw, 1);
        const rawWfClubXgPerMatch = prevGw > 0 ? (cStats.xg * 0.7 + cStats.gf * 0.3) / clubDiv : 1.38;
        const wfClubW = prevGw > 0 ? clubDiv / (clubDiv + 5) : 0;
        const teamXgPerMatch = Math.min(1.95, Math.max(1.15, wfClubW * rawWfClubXgPerMatch + (1 - wfClubW) * 1.38));
        const goalShareCap = pos === 'FWD' ? (costMil >= 11.0 ? 0.60 : 0.55) : pos === 'MID' && costMil >= 10.0 ? 0.52 : 0.48;
        const playerGoalShare = Math.min(goalShareCap, postXg90 / teamXgPerMatch);
        const playerAssistShare = Math.min(0.42, postXa90 / teamXgPerMatch);

        // Compute formDelta strictly from gw-3..gw-1 vs seasonal 1..gw-1
        let recentSum = 0;
        let recentCnt = 0;
        for (let g = Math.max(1, prevGw - 2); g <= prevGw; g++) {
          const pts = agg?.gwPts.get(g);
          if (pts !== undefined) {
            recentSum += pts;
            recentCnt += 1;
          }
        }
        const totalGwsCount = agg?.gwPts.size || 0;
        const recentFormPpg = recentCnt > 0 ? recentSum / recentCnt : 0;
        const seasonPpg = totalGwsCount > 0 ? (agg?.pts || 0) / totalGwsCount : 0;
        const wfSlope = recentFormPpg < seasonPpg && seasonPpg >= 4.5 ? 0.06 : 0.10;
        const formDelta = prevGw > 0 ? Math.max(-0.20, Math.min(0.25, (recentFormPpg - seasonPpg) * wfSlope)) : 0;

        const expInvolv = (agg?.xg || 0) + (agg?.xa || 0);
        const actInvolv = (agg?.goals || 0) + (agg?.assists || 0);
        const regressionBounce = expInvolv > actInvolv + 1.5 ? 0.15 : 0.0;

        const starterMins = computeShrunkStarterMinutes(
          pos,
          agg?.starterMinsSum || 0,
          agg?.starterCount || 0
        );
        const rawDc = agg?.dc || 0;
        const dcPer90 = mins >= 90 && rawDc > 0 ? Number(((rawDc / mins) * 90).toFixed(2)) : 0;
        const wfAvgDcMatch = mins >= 90 && rawDc > 0 ? (rawDc / mins) * 90 : rawDc / clubDiv;
        const wfPDc =
          pos === 'DEF'
            ? (wfAvgDcMatch >= 10 ? 0.75 : wfAvgDcMatch >= 7 ? 0.45 : 0.20)
            : pos === 'MID' || pos === 'FWD'
            ? (wfAvgDcMatch >= 12 ? 0.40 : wfAvgDcMatch >= 9 ? 0.25 : 0.05)
            : 0;
        const sampleMins = Math.max(mins, 90);
        const threatPer90 = mins > 0 ? Number((((agg?.threat || 0) / sampleMins) * 90).toFixed(2)) : 0;
        const creativityPer90 = mins > 0 ? Number((((agg?.creativity || 0) / sampleMins) * 90).toFixed(2)) : 0;
        const influencePer90 = mins > 0 ? Number((((agg?.influence || 0) / sampleMins) * 90).toFixed(2)) : 0;
        const bpsPer90 = mins > 0 ? Number((((agg?.bps || 0) / sampleMins) * 90).toFixed(2)) : 0;
        const savesPer90 = mins > 0 ? Number((((agg?.saves || 0) / sampleMins) * 90).toFixed(2)) : 0;
        const yellowsPer90 = mins > 0 ? Number((((agg?.yellows || 0) / sampleMins) * 90).toFixed(2)) : 0;

        const deadBall = resolveDeadBallDuties(p.webName, p.fullName, cShort, p);
        const wfRole = wfRoleByPlayerId.get(p.id) || 'bench';
        const rawWfSi = wfSiByPlayerId.get(p.id) ?? (wfRole === 'starting' ? 80 : 15);
        const effWfSi = prevGw === 0 && wfRole === 'starting'
          ? Math.max(rawWfSi, 82)
          : wfRole === 'out'
          ? Math.min(rawWfSi, (agg?.mins || 0) === 0 && prevGw >= 2 ? 3 : 8)
          : wfRole === 'bench'
          ? Math.min(rawWfSi, 35)
          : rawWfSi;
        const gwSiProb = wfRole === 'out'
          ? Math.min(0.08, Math.max(0.01, effWfSi / 100))
          : Math.min(0.99, Math.max(0.01, effWfSi / 100));
        const wfSubApps = Math.max(0, (agg?.gwPts.size || 0) - (agg?.starterCount || 0));
        const wfNonStart = Math.max(1, prevGw - (agg?.starterCount || 0));
        const wfSubAppRate = prevGw >= 3
          ? (wfSubApps === 0 ? 0.02 : Math.min(0.55, wfSubApps / wfNonStart))
          : (wfRole === 'out' ? 0.01 : wfRole === 'bench' ? 0.06 : undefined);
        const dgwRot = matchList.length >= 2 && costMil < 9.5 && pos !== 'GKP' ? 0.94 : 1.0;

        const details: PlayerGwMatchDetail[] = [];
        for (const matchInfo of matchList) {
          const xpCalc = calculatePlayerMatchExpectedPoints({
            pos,
            costMil,
            starterIndexProb: Math.min(0.99, gwSiProb * dgwRot),
            isInjuredOrOut: false,
            starterMins,
            teamLambda: matchInfo.teamLambda,
            oppLambda: matchInfo.oppLambda,
            csProb: matchInfo.csProb,
            expGcPenalty: matchInfo.expGcPenalty,
            playerGoalShare,
            playerAssistShare,
            isPrimaryPen: deadBall.isPrimaryPen,
            isSecondaryPen: deadBall.isSecondaryPen,
            isFkTaker: deadBall.isFkTaker,
            isCornerTaker: deadBall.isCornerTaker,
            pDc: wfPDc,
            dcPer90,
            isHome: matchInfo.isHome,
            formDelta,
            regressionBounce,
            threatPer90,
            creativityPer90,
            influencePer90,
            bpsPer90,
            savesPer90,
            yellowsPer90,
            subAppRate: wfSubAppRate,
            horizonOffset: 0,
            provenGuard: {
              guardFactor: wfProven.guardFactor,
              maxBlankDropPenalty: wfProven.maxBlankDropPenalty,
              provenXpFloor: wfProven.provenXpFloor,
              isProven: wfProven.isProven,
              tier: wfProven.tier,
            },
          });

          const det: PlayerGwMatchDetail = {
            fixtureId: matchInfo.fixtureId,
            oppShort: matchInfo.oppShort,
            isHome: matchInfo.isHome,
            xp: Number(xpCalc.xpTotal.toFixed(1)),
            baseXp: Number(xpCalc.baseXp.toFixed(1)),
            spikeMod: Number(xpCalc.spikeMod.toFixed(1)),
          };
          details.push(det);

          const fixKey = matchInfo.fixtureId
            ? `${gw}_id_${matchInfo.fixtureId}`
            : `${gw}_${matchInfo.isHome ? cShort : matchInfo.oppShort}_${matchInfo.isHome ? matchInfo.oppShort : cShort}`;
          if (xpCalc.expBonus >= 0.04) {
            if (!bonusPool.has(fixKey)) bonusPool.set(fixKey, []);
            bonusPool.get(fixKey)!.push({ detail: det, expBonus: xpCalc.expBonus });
          }
        }
        playerDetailsMap.set(p.id, details);
      }

      normalizeFixtureBonusPool(bonusPool);

      const playerXpById = new Map<number, number>();
      for (const [pId, details] of playerDetailsMap.entries()) {
        const total = details.reduce((s, d) => s + (d.xp || 0), 0);
        playerXpById.set(pId, Number(total.toFixed(1)));
      }

      return { fixtureProjectionsByKey: wfFixtureProjectionsByKey, playerXpById };
    };

    const maeRecapRows: any[] = [];

    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const canUseConfirmedCache =
        !force &&
        gw < maxReviewGW &&
        confirmedMaeRowCache.has(gw);

      if (canUseConfirmedCache) {
        maeRecapRows.push(confirmedMaeRowCache.get(gw)!.row);
        continue;
      }

      // Lineup accuracy evaluation for GW (already strictly walk-forward from 1..gw-1)
      const gwLineupBuilt = buildLineupReviewForGw(
        gw,
        maxReviewGW,
        corePayload.clubs,
        allPlayers,
        actualMatchLookup,
        actualPlayerStatsMap,
        matchesWithLineupsByGw
      );

      // Strictly Out-of-Sample Walk-Forward Match & Player xP Predictions for GW `gw`
      const wfPred = buildWalkForwardGwPredictions(gw, gwLineupBuilt.lineupReviewPerClub);

      const matchesInGw = (matchesWithLineupsByGw[gw]?.length ? matchesWithLineupsByGw[gw] : corePayload.scheduleByGw[gw]) || [];
      const matchesDetail: any[] = [];
      let matchesFinished = 0;
      let teamGoalsSumDiff = 0;
      let matchGoalsSumDiff = 0;
      let outcomeHits = 0;
      let exactScoreHits = 0;
      let cleanSheetHits = 0;

      for (const m of matchesInGw) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;

        const proj = wfPred.fixtureProjectionsByKey[`${gw}_${hShort}_${aShort}`] || {
          homeGoals: 1,
          awayGoals: 1,
          homeCsProb: 30,
          awayCsProb: 25,
        };

        // Match exact fixture in DGW array (matches oppShort & isHome)
        const hActual = (actualMatchLookup[`${gw}_${hShort}`] || []).find(
          (e) => e.isHome && e.oppShort === aShort
        );
        const isDone = Boolean(hActual && hActual.finished && hActual.teamScore !== null && hActual.oppScore !== null);

        const realH = isDone ? hActual!.teamScore : null;
        const realA = isDone ? hActual!.oppScore : null;
        const projH = proj.homeGoals;
        const projA = proj.awayGoals;

        let projRes: 'W' | 'D' | 'L' = 'D';
        if (projH > projA) projRes = 'W';
        else if (projH < projA) projRes = 'L';

        let realRes: 'W' | 'D' | 'L' | null = null;
        let outcomeHit = false;
        let exactScoreHit = false;
        let homeCsHit = false;
        let awayCsHit = false;

        if (isDone && realH !== null && realA !== null) {
          matchesFinished += 1;
          if (realH > realA) realRes = 'W';
          else if (realH < realA) realRes = 'L';
          else realRes = 'D';

          outcomeHit = projRes === realRes;
          if (outcomeHit) outcomeHits += 1;

          exactScoreHit = projH === realH && projA === realA;
          if (exactScoreHit) exactScoreHits += 1;

          teamGoalsSumDiff += Math.abs(projH - realH) + Math.abs(projA - realA);
          matchGoalsSumDiff += Math.abs(projH + projA - (realH + realA));

          const realHHasCs = realA === 0;
          const realAHasCs = realH === 0;
          const projHHasCs = proj.homeCsProb >= 40;
          const projAHasCs = proj.awayCsProb >= 40;
          homeCsHit = projHHasCs === realHHasCs;
          awayCsHit = projAHasCs === realAHasCs;
          if (homeCsHit) cleanSheetHits += 1;
          if (awayCsHit) cleanSheetHits += 1;
        }

        matchesDetail.push({
          homeShort: hShort,
          awayShort: aShort,
          projHomeGoals: projH,
          projAwayGoals: projA,
          realHomeGoals: realH,
          realAwayGoals: realA,
          projResult: projRes,
          realResult: realRes,
          outcomeHit,
          exactScoreHit,
          homeCsHit,
          awayCsHit,
          finished: isDone,
        });
      }

      let totalStartersHit = 0;
      let totalStartersPredicted = 0;
      const clubsLineupDetail: any[] = [];

      for (const club of corePayload.clubs) {
        const gwMatchList = actualMatchLookup[`${gw}_${club.short}`] || [];
        const isClubMatchPlayed = gwMatchList.some((m) => m.finished || m.teamScore !== null);
        if (!isClubMatchPlayed) continue;

        const squad = gwLineupBuilt.lineupReviewPerClub[club.short] || [];
        const starters = squad.filter((s) => s.role === 'starting');
        const clubStartersHit = starters.filter((s) => s.realStarted).length;
        const missedStarters = starters.filter((s) => !s.realStarted).map((s) => ({ id: s.id, name: s.webName, pos: s.position }));
        const unexpectedStarters = squad
          .filter((s) => s.role !== 'starting' && s.realStarted)
          .map((s) => ({ id: s.id, name: s.webName, pos: s.position }));

        totalStartersHit += clubStartersHit;
        totalStartersPredicted += 11;

        clubsLineupDetail.push({
          club,
          startersHit: clubStartersHit,
          startersTotal: 11,
          accuracyPct: Math.round((clubStartersHit / 11) * 100),
          missedStarters,
          unexpectedStarters,
        });
      }

      // Points MAE evaluation for GW (strictly out-of-sample walk-forward)
      let startersSumAbsDiff = 0;
      let startersCount = 0;
      let activeSumAbsDiff = 0;
      let activeCount = 0;
      const posDiffMap: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      const posCountMap: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      let totalProjPts = 0;
      let totalRealPts = 0;
      const playerPerformances: Array<{ id: number; webName: string; teamShort: string; pos: PositionType; xp: number; realPts: number; diff: number }> = [];

      for (const p of allPlayers) {
        const cShort = p.teamShort;
        const clubProjMatches = corePayload.clubGwMatchProjections[`${cShort}_${gw}`] || [];
        if (clubProjMatches.length === 0) continue;

        const realStat = actualPlayerStatsMap[p.id]?.[gw];
        if (!realStat) continue;

        const pos = p.position as PositionType;
        const xp = wfPred.playerXpById.get(p.id) ?? 0;

        const realPts = realStat.pts;
        const realMins = realStat.mins;
        const absDiff = Math.abs(realPts - xp);
        const diff = Math.round((realPts - xp) * 10) / 10;

        totalProjPts += xp;
        totalRealPts += realPts;

        if (realStat.wasStarter) {
          startersSumAbsDiff += absDiff;
          startersCount += 1;
          if (pos in posDiffMap) {
            posDiffMap[pos] += absDiff;
            posCountMap[pos] += 1;
          }
        }

        if (realMins > 0) {
          activeSumAbsDiff += absDiff;
          activeCount += 1;
          playerPerformances.push({
            id: p.id,
            webName: p.webName,
            teamShort: cShort,
            pos,
            xp,
            realPts,
            diff,
          });
        }
      }

      const topOverperformers = [...playerPerformances].sort((a, b) => b.diff - a.diff).slice(0, 5);
      const topUnderperformers = [...playerPerformances].sort((a, b) => a.diff - b.diff).slice(0, 5);

      const isFinished = matchesFinished >= Math.max(matchesInGw.length - 2, 1) || gw < maxReviewGW;
      const teamGoalsMae = matchesFinished > 0 ? Math.round((teamGoalsSumDiff / (matchesFinished * 2)) * 100) / 100 : 0;
      const matchGoalsMae = matchesFinished > 0 ? Math.round((matchGoalsSumDiff / matchesFinished) * 100) / 100 : 0;
      const outcomeAccPct = matchesFinished > 0 ? Math.round((outcomeHits / matchesFinished) * 1000) / 10 : 0;
      const exactScorePct = matchesFinished > 0 ? Math.round((exactScoreHits / matchesFinished) * 1000) / 10 : 0;
      const cleanSheetPct = matchesFinished > 0 ? Math.round((cleanSheetHits / (matchesFinished * 2)) * 1000) / 10 : 0;

      const lineupAccPct = totalStartersPredicted > 0 ? Math.round((totalStartersHit / totalStartersPredicted) * 1000) / 10 : 0;
      const avgStartersPerClub =
        clubsLineupDetail.length > 0 ? Math.round((totalStartersHit / clubsLineupDetail.length) * 10) / 10 : 0;

      const startersXpMae = startersCount > 0 ? Math.round((startersSumAbsDiff / startersCount) * 100) / 100 : 0;
      const activeXpMae = activeCount > 0 ? Math.round((activeSumAbsDiff / activeCount) * 100) / 100 : 0;

      const posMae = {
        GKP: posCountMap.GKP > 0 ? Math.round((posDiffMap.GKP / posCountMap.GKP) * 100) / 100 : 0,
        DEF: posCountMap.DEF > 0 ? Math.round((posDiffMap.DEF / posCountMap.DEF) * 100) / 100 : 0,
        MID: posCountMap.MID > 0 ? Math.round((posDiffMap.MID / posCountMap.MID) * 100) / 100 : 0,
        FWD: posCountMap.FWD > 0 ? Math.round((posDiffMap.FWD / posCountMap.FWD) * 100) / 100 : 0,
      };

      const goalScore = Math.max(0, Math.min(100, Math.round((1 - teamGoalsMae / 2.2) * 100)));
      const ptsScore = Math.max(0, Math.min(100, Math.round((1 - startersXpMae / 5.0) * 100)));
      const compositeScore = Math.round(lineupAccPct * 0.35 + outcomeAccPct * 0.30 + goalScore * 0.15 + ptsScore * 0.20);
      const compositeGrade =
        compositeScore >= 82 ? 'A+' : compositeScore >= 75 ? 'A' : compositeScore >= 68 ? 'B+' : compositeScore >= 60 ? 'B' : 'C';

      const row = {
        gw,
        isFinished,
        matchesTotal: matchesInGw.length,
        matchesFinished,
        teamGoalsMae,
        matchGoalsMae,
        outcomeHits,
        outcomeAccPct,
        exactScoreHits,
        exactScorePct,
        cleanSheetHits,
        cleanSheetPct,
        matchesDetail,
        totalStartersPredicted,
        totalStartersHit,
        lineupAccPct,
        avgStartersPerClub,
        clubsLineupDetail,
        startersCount,
        startersXpMae,
        activeCount,
        activeXpMae,
        posMae,
        totalProjPts: Math.round(totalProjPts * 10) / 10,
        totalRealPts: Math.round(totalRealPts * 10) / 10,
        ptsBias: Math.round((totalRealPts - totalProjPts) * 10) / 10,
        topOverperformers,
        topUnderperformers,
        compositeScore,
        compositeGrade,
      };

      if (gw < maxReviewGW && isFinished) {
        confirmedMaeRowCache.set(gw, { epochBaseGw: maxReviewGW, row });
      }
      maeRecapRows.push(row);
    }

    const baseCache: ReviewBaseCache = {
      epochKey: epoch.epochKey,
      actualMatchLookup,
      actualPlayerStatsMap,
      maeRecapRows,
      lineupByGwCache: new Map(),
    };

    cachedReviewBase = baseCache;
    console.log(
      `[ProjectionEngine] Built Review Base epoch=${epoch.epochKey} (${maeRecapRows.length} MAE GWs) in ${Date.now() - startMs}ms`
    );
    return baseCache;
  })();

  inFlightReviewBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightReviewBuild?.promise === buildPromise) {
      inFlightReviewBuild = null;
    }
  }
}

export async function getServerReviewBundle(
  cachedData: TransformedLeagueData,
  requestedLineupGw?: number,
  force: boolean = false
): Promise<ServerReviewBundlePayload> {
  const coreCtx = await getOrBuildCoreContext(cachedData, force);
  const reviewBase = await getOrBuildReviewBase(cachedData, force);
  const maxReviewGW = coreCtx.corePayload.maxReviewGW;
  const targetGw = Math.min(Math.max(Number(requestedLineupGw) || maxReviewGW, 1), maxReviewGW);

  let gwLineup = reviewBase.lineupByGwCache.get(targetGw);
  if (!gwLineup || force) {
    gwLineup = buildLineupReviewForGw(
      targetGw,
      maxReviewGW,
      coreCtx.corePayload.clubs,
      cachedData.player_stats || [],
      reviewBase.actualMatchLookup,
      reviewBase.actualPlayerStatsMap,
      coreCtx.matchesWithLineupsByGw
    );
    reviewBase.lineupByGwCache.set(targetGw, gwLineup);
  }

  return {
    epochKey: coreCtx.epoch.epochKey,
    generatedAt: new Date().toISOString(),
    maxReviewGW,
    lineupGw: targetGw,
    actualMatchLookup: reviewBase.actualMatchLookup,
    actualPlayerStatsMap: reviewBase.actualPlayerStatsMap,
    lineupReviewPerClub: gwLineup.lineupReviewPerClub,
    lineupGwSummary: gwLineup.lineupGwSummary,
    maeRecapRows: reviewBase.maeRecapRows,
  };
}

// ============================================================================
// SCOUT ENGINE: DUAL-BUDGET FH & WC HILL-CLIMBING SOLVER (SERVER CACHED)
// ============================================================================
interface SolverPlayer {
  id: number;
  position: PositionType;
  teamShort: string;
  cost: number;
  pts: number;
  mins: number;
  status: string;
  fullSeasonPointsMap: Record<number, PlayerGwProjectionCell>;
  xP1: number;
  avgXp6: number;
}

function solveServerScoutForGwMode(
  players: SolverPlayer[],
  baseHistoricalGW: number,
  targetNextGW: number,
  targetGw: number,
  mode: 'FH' | 'WC',
  fastMode: boolean = false
) {
  const MAX_XI_BUDGET = 83.0;
  const MAX_SQUAD_BUDGET = 100.0;
  const completedGws = Math.max(baseHistoricalGW, 1);
  const isFH = mode === 'FH';

  if (players.length < 15) {
    return {
      starterIds: [] as number[],
      benchIds: [] as number[],
      xiCost: 0,
      xiBudget: MAX_XI_BUDGET,
      totalCost: 0,
      budget: MAX_SQUAD_BUDGET,
      xiXp: 0,
      formation: '3-4-3',
    };
  }

  const getPlayerGwXp = (p: SolverPlayer, gw: number): number => {
    if (gw === targetNextGW) {
      if (p.status === 'i' || p.status === 's' || p.status === 'u') return 0;
      return p.xP1;
    }
    const cell = p.fullSeasonPointsMap?.[gw];
    if (cell && typeof cell.xp === 'number') {
      return Math.round(cell.xp * 10) / 10;
    }
    return p.xP1;
  };

  const wcEndGw = Math.min(38, targetGw + 5);
  const avgWindowXp = (p: SolverPlayer, startGw: number, endGw: number) => {
    let sum = 0;
    let cnt = 0;
    for (let g = startGw; g <= endGw; g++) {
      sum += getPlayerGwXp(p, g);
      cnt++;
    }
    return cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : getPlayerGwXp(p, startGw);
  };

  const xpCache = new Map<number, number>();
  const tieCache = new Map<number, number>();
  for (const p of players) {
    const g1 = getPlayerGwXp(p, targetGw);
    const g6 =
      targetGw === targetNextGW && wcEndGw === Math.min(38, targetNextGW + 5)
        ? p.avgXp6
        : avgWindowXp(p, targetGw, wcEndGw);
    xpCache.set(p.id, isFH ? g1 : g6);
    tieCache.set(p.id, isFH ? g6 : g1);
  }

  const getXp = (p: SolverPlayer) => xpCache.get(p.id) ?? 0;
  const getTie = (p: SolverPlayer) => tieCache.get(p.id) ?? 0;
  const benchWeight = isFH ? 0.012 : 0.035;

  const minMins = Math.min(90, completedGws * 20);
  const fitCandidates = players.filter((p) => {
    if (targetGw === targetNextGW) return p.status === 'a' && p.mins >= minMins;
    return getPlayerGwXp(p, targetGw) > 0 && p.mins >= minMins;
  });
  const backupCandidates = players.filter((p) => {
    if (targetGw === targetNextGW) return p.status !== 'i' && p.status !== 'u';
    return getPlayerGwXp(p, targetGw) > 0 || (p.status !== 'i' && p.status !== 'u');
  });

  const posPool: Record<'GKP' | 'DEF' | 'MID' | 'FWD', SolverPlayer[]> = {
    GKP: [],
    DEF: [],
    MID: [],
    FWD: [],
  };

  const topN = fastMode ? 14 : 18;
  const valN = fastMode ? 8 : 12;
  const cheapN = fastMode ? 6 : 8;

  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
    const primary = fitCandidates.filter((p) => p.position === pos);
    const source = primary.length >= 6 ? primary : backupCandidates.filter((p) => p.position === pos);
    const fallback = source.length >= 5 ? source : players.filter((p) => p.position === pos);

    const topXp = [...fallback]
      .sort((a, b) => getXp(b) - getXp(a) || getTie(b) - getTie(a) || b.pts - a.pts || a.cost - b.cost)
      .slice(0, topN);
    const topValue = [...fallback]
      .sort((a, b) => getXp(b) / Math.max(b.cost, 3.8) - getXp(a) / Math.max(a.cost, 3.8))
      .slice(0, valN);
    const cheapPlaying = [...fallback]
      .filter((p) => p.mins / completedGws >= 35)
      .sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a))
      .slice(0, cheapN);
    const ultraCheap = [...fallback].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a)).slice(0, cheapN);

    const merged = new Map<number, SolverPlayer>();
    for (const item of [...topXp, ...topValue, ...cheapPlaying, ...ultraCheap]) {
      merged.set(item.id, item);
    }
    posPool[pos] = Array.from(merged.values());
  }

  const clubIdxMap = new Map<string, number>();
  let nextClubIdx = 0;
  const getClubIdx = (teamShort: string) => {
    let idx = clubIdxMap.get(teamShort);
    if (idx === undefined) {
      idx = nextClubIdx++;
      clubIdxMap.set(teamShort, idx);
    }
    return idx;
  };

  type PoolMeta = {
    p: SolverPlayer;
    id: number;
    posIdx: 0 | 1 | 2 | 3;
    cost: number;
    xp: number;
    tie: number;
    clubIdx: number;
  };

  const POS_TO_IDX: Record<'GKP' | 'DEF' | 'MID' | 'FWD', 0 | 1 | 2 | 3> = {
    GKP: 0,
    DEF: 1,
    MID: 2,
    FWD: 3,
  };

  const metaById = new Map<number, PoolMeta>();
  const posPoolMeta: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
  const posPoolByXpOnly: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];

  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
    const pIdx = POS_TO_IDX[pos];
    const metas = posPool[pos].map((p) => {
      const m: PoolMeta = {
        p,
        id: p.id,
        posIdx: pIdx,
        cost: p.cost,
        xp: getXp(p),
        tie: getTie(p),
        clubIdx: getClubIdx(p.teamShort),
      };
      metaById.set(p.id, m);
      return m;
    });
    posPoolByXpOnly[pIdx] = [...metas].sort((a, b) => b.xp - a.xp);
    posPoolMeta[pIdx] = [...metas].sort((a, b) => b.xp - a.xp || b.tie - a.tie);
  }
  const numClubs = Math.max(nextClubIdx, 1);

  const FORMATIONS: Array<[number, number, number]> = [
    [3, 4, 3],
    [3, 5, 2],
    [4, 3, 3],
    [4, 4, 2],
    [4, 5, 1],
    [5, 3, 2],
    [5, 4, 1],
    [5, 2, 3],
  ];

  const isDualBudgetValidNums = (xiCost: number, cost: number) =>
    xiCost <= MAX_XI_BUDGET + 0.001 && cost <= MAX_SQUAD_BUDGET + 0.001;
  const calcBudgetExcessNums = (xiCost: number, cost: number) =>
    Math.max(0, xiCost - MAX_XI_BUDGET) + Math.max(0, cost - MAX_SQUAD_BUDGET);
  const cmpMeta = (a: PoolMeta, b: PoolMeta) => (b.xp !== a.xp ? b.xp - a.xp : b.tie - a.tie);

  const scratchArr1: PoolMeta[] = new Array(5);
  const scratchArr2: PoolMeta[] = new Array(5);

  const evalGroup = (arr: PoolMeta[], sCount: number) => {
    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const evalReplaced1 = (arr: PoolMeta[], replaceIdx: number, inM: PoolMeta, sCount: number) => {
    const len = arr.length;
    let w = 0;
    let inserted = false;
    for (let i = 0; i < len; i++) {
      if (i === replaceIdx) continue;
      const cur = arr[i];
      if (!inserted && cmpMeta(cur, inM) > 0) {
        scratchArr1[w++] = inM;
        inserted = true;
      }
      scratchArr1[w++] = cur;
    }
    if (!inserted) scratchArr1[w++] = inM;

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr1[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const evalReplaced2Same = (
    arr: PoolMeta[],
    idx1: number,
    in1: PoolMeta,
    idx2: number,
    in2: PoolMeta,
    sCount: number
  ) => {
    const len = arr.length;
    const firstIn = cmpMeta(in1, in2) <= 0 ? in1 : in2;
    const secondIn = firstIn === in1 ? in2 : in1;
    let w = 0;
    let ins = 0;
    for (let i = 0; i < len; i++) {
      if (i === idx1 || i === idx2) continue;
      const cur = arr[i];
      if (ins === 0 && cmpMeta(cur, firstIn) > 0) {
        scratchArr2[w++] = firstIn;
        ins = 1;
      }
      if (ins === 1 && cmpMeta(cur, secondIn) > 0) {
        scratchArr2[w++] = secondIn;
        ins = 2;
      }
      scratchArr2[w++] = cur;
    }
    if (ins === 0) {
      scratchArr2[w++] = firstIn;
      scratchArr2[w++] = secondIn;
    } else if (ins === 1) {
      scratchArr2[w++] = secondIn;
    }

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr2[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const optimizeForFormation = (seedSquad: SolverPlayer[], dCount: number, mCount: number, fCount: number) => {
    const sCounts: [number, number, number, number] = [1, dCount, mCount, fCount];
    const groups: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
    const clubCounts = new Int32Array(numClubs);
    const currentIds = new Set<number>();

    for (const p of seedSquad) {
      const m = metaById.get(p.id);
      if (!m) return null;
      clubCounts[m.clubIdx]++;
      if (clubCounts[m.clubIdx] > 3) return null;
      groups[m.posIdx].push(m);
      currentIds.add(m.id);
    }
    for (let g = 0; g < 4; g++) groups[g].sort(cmpMeta);

    const gStats = [
      evalGroup(groups[0], sCounts[0]),
      evalGroup(groups[1], sCounts[1]),
      evalGroup(groups[2], sCounts[2]),
      evalGroup(groups[3], sCounts[3]),
    ];

    const getTotals = () => {
      let xiXp = 0;
      let benchXp = 0;
      let rawXiCost = 0;
      let rawCost = 0;
      for (let g = 0; g < 4; g++) {
        xiXp += gStats[g].sXp;
        benchXp += gStats[g].bXp;
        rawXiCost += gStats[g].sCost;
        rawCost += gStats[g].tCost;
      }
      return {
        xiXp,
        benchXp,
        xiCost: Math.round(rawXiCost * 10) / 10,
        cost: Math.round(rawCost * 10) / 10,
        obj: xiXp + benchWeight * benchXp,
      };
    };

    const applySwap1 = (posIdx: 0 | 1 | 2 | 3, slotIdx: number, inM: PoolMeta) => {
      const outM = groups[posIdx][slotIdx];
      currentIds.delete(outM.id);
      currentIds.add(inM.id);
      clubCounts[outM.clubIdx]--;
      clubCounts[inM.clubIdx]++;
      groups[posIdx][slotIdx] = inM;
      groups[posIdx].sort(cmpMeta);
      gStats[posIdx] = evalGroup(groups[posIdx], sCounts[posIdx]);
    };

    let baseTot = getTotals();
    let repairGuard = 0;
    while (calcBudgetExcessNums(baseTot.xiCost, baseTot.cost) > 0.001 && repairGuard < 36) {
      repairGuard++;
      const curExcess = calcBudgetExcessNums(baseTot.xiCost, baseTot.cost);
      let bestPos: 0 | 1 | 2 | 3 = 0;
      let bestSlot = -1;
      let bestIn: PoolMeta | null = null;
      let bestLossPerReduction = Infinity;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = baseTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = baseTot.benchXp - gStats[posIdx].bXp;
        const baseRawXiCost = gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost - gStats[posIdx].sCost;
        const baseRawTotalCost = gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.cost >= outM.cost - 0.05 || currentIds.has(inM.id)) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;
            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = Math.round((baseRawXiCost + rep.sCost) * 10) / 10;
            const nextCost = Math.round((baseRawTotalCost + rep.tCost) * 10) / 10;
            const reduction = curExcess - calcBudgetExcessNums(nextXiCost, nextCost);
            if (reduction <= 0.001) continue;
            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            const lossPerReduction = (baseTot.obj - nextObj) / reduction;
            if (lossPerReduction < bestLossPerReduction) {
              bestLossPerReduction = lossPerReduction;
              bestPos = posIdx;
              bestSlot = slotIdx;
              bestIn = inM;
            }
          }
        }
      }
      if (bestSlot === -1 || !bestIn) break;
      applySwap1(bestPos, bestSlot, bestIn);
      baseTot = getTotals();
    }

    if (!isDualBudgetValidNums(baseTot.xiCost, baseTot.cost)) return null;

    const swapCheapLimit = fastMode ? 4 : 8;
    const swapUpLimit = fastMode ? 3 : 6;
    const flatSlots: Array<{ posIdx: 0 | 1 | 2 | 3; slotIdx: number; m: PoolMeta }> = new Array(15);

    for (let iter = 0; iter < 40; iter++) {
      const stepTot = getTotals();
      const sumRawXiCost = gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost;
      const sumRawCost = gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost;

      let bestNextObj = stepTot.obj + 1e-6;
      let bestSwapKind: 0 | 1 | 2 = 0;
      let b1Pos: 0 | 1 | 2 | 3 = 0;
      let b1Slot = 0;
      let b1In: PoolMeta | null = null;
      let b2Pos: 0 | 1 | 2 | 3 = 0;
      let b2Slot = 0;
      let b2In: PoolMeta | null = null;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = stepTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = stepTot.benchXp - gStats[posIdx].bXp;
        const baseOtherRawXiCost = sumRawXiCost - gStats[posIdx].sCost;
        const baseOtherRawCost = sumRawCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.xp <= outM.xp) break;
            if (currentIds.has(inM.id)) continue;
            const nextCost = Math.round((stepTot.cost - outM.cost + inM.cost) * 10) / 10;
            if (nextCost > MAX_SQUAD_BUDGET + 0.001) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;

            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = Math.round((baseOtherRawXiCost + rep.sCost) * 10) / 10;
            const nextTotCost = Math.round((baseOtherRawCost + rep.tCost) * 10) / 10;
            if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            if (nextObj > bestNextObj) {
              bestNextObj = nextObj;
              bestSwapKind = 1;
              b1Pos = posIdx;
              b1Slot = slotIdx;
              b1In = inM;
            }
          }
        }
      }

      if (bestSwapKind === 1 && b1In) {
        applySwap1(b1Pos, b1Slot, b1In);
        continue;
      }

      if (!fastMode || iter < 8) {
        let fIdx = 0;
        for (let p = 0 as 0 | 1 | 2 | 3; p < 4; p = (p + 1) as 0 | 1 | 2 | 3) {
          const grp = groups[p];
          for (let s = 0; s < grp.length; s++) flatSlots[fIdx++] = { posIdx: p, slotIdx: s, m: grp[s] };
        }

        const cheaperBySlot: PoolMeta[][] = new Array(15);
        const upgradesBySlot: PoolMeta[][] = new Array(15);
        for (let k = 0; k < 15; k++) {
          const slot = flatSlots[k];
          const outM = slot.m;
          const xpPool = posPoolByXpOnly[slot.posIdx];
          const cheapList: PoolMeta[] = [];
          const upList: PoolMeta[] = [];
          for (let idx = 0; idx < xpPool.length; idx++) {
            const cand = xpPool[idx];
            if (currentIds.has(cand.id)) continue;
            if (cand.cost < outM.cost - 0.05 && cheapList.length < swapCheapLimit) cheapList.push(cand);
            if (cand.xp > outM.xp) upList.push(cand);
          }
          cheaperBySlot[k] = cheapList;
          upgradesBySlot[k] = upList;
        }

        for (let i = 0; i < 15; i++) {
          const s1 = flatSlots[i];
          const out1 = s1.m;
          const cheaper1 = cheaperBySlot[i];
          if (cheaper1.length === 0) continue;

          for (let c1 = 0; c1 < cheaper1.length; c1++) {
            const in1 = cheaper1[c1];
            const remSquadBudget = MAX_SQUAD_BUDGET - (stepTot.cost - out1.cost + in1.cost);

            for (let j = 0; j < 15; j++) {
              if (j === i) continue;
              const s2 = flatSlots[j];
              const out2 = s2.m;
              const upAll = upgradesBySlot[j];
              let takenUp = 0;

              for (let u2 = 0; u2 < upAll.length && takenUp < swapUpLimit; u2++) {
                const in2 = upAll[u2];
                if (in2.id === in1.id || in2.cost - out2.cost > remSquadBudget + 0.001) continue;
                takenUp++;

                const oc1 = out1.clubIdx;
                const oc2 = out2.clubIdx;
                const ic1 = in1.clubIdx;
                const ic2 = in2.clubIdx;
                if (ic1 === ic2) {
                  const freed = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed + 2 > 3) continue;
                } else {
                  const freed1 = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed1 + 1 > 3) continue;
                  const freed2 = (oc1 === ic2 ? 1 : 0) + (oc2 === ic2 ? 1 : 0);
                  if (clubCounts[ic2] - freed2 + 1 > 3) continue;
                }

                let nextXiXp: number;
                let nextBenchXp: number;
                let nextRawXiCost: number;
                let nextRawTotalCost: number;

                if (s1.posIdx === s2.posIdx) {
                  const grp = groups[s1.posIdx];
                  const rep = evalReplaced2Same(grp, s1.slotIdx, in1, s2.slotIdx, in2, sCounts[s1.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp + rep.sXp;
                  nextBenchXp = stepTot.benchXp - gStats[s1.posIdx].bXp + rep.bXp;
                  nextRawXiCost = sumRawXiCost - gStats[s1.posIdx].sCost + rep.sCost;
                  nextRawTotalCost = sumRawCost - gStats[s1.posIdx].tCost + rep.tCost;
                } else {
                  const rep1 = evalReplaced1(groups[s1.posIdx], s1.slotIdx, in1, sCounts[s1.posIdx]);
                  const rep2 = evalReplaced1(groups[s2.posIdx], s2.slotIdx, in2, sCounts[s2.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp - gStats[s2.posIdx].sXp + rep1.sXp + rep2.sXp;
                  nextBenchXp = stepTot.benchXp - gStats[s1.posIdx].bXp - gStats[s2.posIdx].bXp + rep1.bXp + rep2.bXp;
                  nextRawXiCost = sumRawXiCost - gStats[s1.posIdx].sCost - gStats[s2.posIdx].sCost + rep1.sCost + rep2.sCost;
                  nextRawTotalCost = sumRawCost - gStats[s1.posIdx].tCost - gStats[s2.posIdx].tCost + rep1.tCost + rep2.tCost;
                }

                const nextXiCost = Math.round(nextRawXiCost * 10) / 10;
                const nextTotCost = Math.round(nextRawTotalCost * 10) / 10;
                if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

                const nextObj = nextXiXp + benchWeight * nextBenchXp;
                if (nextObj > bestNextObj) {
                  bestNextObj = nextObj;
                  bestSwapKind = 2;
                  b1Pos = s1.posIdx;
                  b1Slot = s1.slotIdx;
                  b1In = in1;
                  b2Pos = s2.posIdx;
                  b2Slot = s2.slotIdx;
                  b2In = in2;
                }
              }
            }
          }
        }
      }

      if (bestSwapKind === 2 && b1In && b2In) {
        if (b1Pos === b2Pos) {
          const out1 = groups[b1Pos][b1Slot];
          const out2 = groups[b2Pos][b2Slot];
          currentIds.delete(out1.id);
          currentIds.delete(out2.id);
          currentIds.add(b1In.id);
          currentIds.add(b2In.id);
          clubCounts[out1.clubIdx]--;
          clubCounts[out2.clubIdx]--;
          clubCounts[b1In.clubIdx]++;
          clubCounts[b2In.clubIdx]++;
          groups[b1Pos][b1Slot] = b1In;
          groups[b2Pos][b2Slot] = b2In;
          groups[b1Pos].sort(cmpMeta);
          gStats[b1Pos] = evalGroup(groups[b1Pos], sCounts[b1Pos]);
        } else {
          applySwap1(b1Pos, b1Slot, b1In);
          applySwap1(b2Pos, b2Slot, b2In);
        }
      } else {
        break;
      }
    }

    const finalTot = getTotals();
    if (!isDualBudgetValidNums(finalTot.xiCost, finalTot.cost)) return null;

    const starterIds: number[] = [
      groups[0][0].id,
      ...groups[1].slice(0, dCount).map((m) => m.id),
      ...groups[2].slice(0, mCount).map((m) => m.id),
      ...groups[3].slice(0, fCount).map((m) => m.id),
    ];
    const benchOut = [
      ...groups[1].slice(dCount),
      ...groups[2].slice(mCount),
      ...groups[3].slice(fCount),
    ]
      .sort((a, b) => b.xp - a.xp)
      .map((m) => m.id);
    const benchIds: number[] = groups[0][1] ? [groups[0][1].id, ...benchOut] : benchOut;

    return {
      starterIds,
      benchIds,
      xiXp: finalTot.xiXp,
      xiCost: finalTot.xiCost,
      cost: finalTot.cost,
      obj: finalTot.obj,
      formation: `${dCount}-${mCount}-${fCount}`,
    };
  };

  const buildCheapestSeed = () => {
    const picked: SolverPlayer[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const quotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 2],
      ['DEF', 5],
      ['MID', 5],
      ['FWD', 3],
    ];
    for (const [pos, need] of quotas) {
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
          picked.push(p);
          used.add(p.id);
          cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
          taken++;
        }
      }
    }
    return picked;
  };

  const buildTopDownSeed = (dCount: number, mCount: number, fCount: number) => {
    const picked: SolverPlayer[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const tryAdd = (p: SolverPlayer) => {
      if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
        picked.push(p);
        used.add(p.id);
        cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
        return true;
      }
      return false;
    };
    const starterQuotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 1],
      ['DEF', dCount],
      ['MID', mCount],
      ['FWD', fCount],
    ];
    for (const [pos, need] of starterQuotas) {
      const list = [...posPool[pos]].sort((a, b) => getXp(b) - getXp(a) || a.cost - b.cost);
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    const benchQuotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 1],
      ['DEF', 5 - dCount],
      ['MID', 5 - mCount],
      ['FWD', 3 - fCount],
    ];
    for (const [pos, need] of benchQuotas) {
      if (need <= 0) continue;
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    return picked;
  };

  const cheapSeed = buildCheapestSeed();
  let bestOverall: ReturnType<typeof optimizeForFormation> = null;

  for (const [dCount, mCount, fCount] of FORMATIONS) {
    const seeds = [cheapSeed, buildTopDownSeed(dCount, mCount, fCount)];
    for (const seed of seeds) {
      if (seed.length !== 15) continue;
      const res = optimizeForFormation(seed, dCount, mCount, fCount);
      if (!res) continue;
      if (
        !bestOverall ||
        res.obj > bestOverall.obj + 1e-6 ||
        (Math.abs(res.obj - bestOverall.obj) <= 1e-6 && res.xiXp > bestOverall.xiXp)
      ) {
        bestOverall = res;
      }
    }
  }

  if (!bestOverall) {
    const s15 = cheapSeed.slice(0, 15);
    const gkps = s15.filter((p) => p.position === 'GKP');
    const defs = s15.filter((p) => p.position === 'DEF');
    const mids = s15.filter((p) => p.position === 'MID');
    const fwds = s15.filter((p) => p.position === 'FWD');
    const st = [gkps[0], ...defs.slice(0, 3), ...mids.slice(0, 4), ...fwds.slice(0, 3)].filter(Boolean);
    const bn = [gkps[1], ...defs.slice(3), ...mids.slice(4), ...fwds.slice(3)].filter(Boolean);
    return {
      starterIds: st.map((p) => p.id),
      benchIds: bn.map((p) => p.id),
      xiCost: Math.round(st.reduce((s, p) => s + p.cost, 0) * 10) / 10,
      xiBudget: MAX_XI_BUDGET,
      totalCost: Math.round(s15.reduce((s, p) => s + p.cost, 0) * 10) / 10,
      budget: MAX_SQUAD_BUDGET,
      xiXp: Math.round(st.reduce((s, p) => s + getXp(p), 0) * 10) / 10,
      formation: '3-4-3',
    };
  }

  return {
    starterIds: bestOverall.starterIds,
    benchIds: bestOverall.benchIds,
    xiCost: bestOverall.xiCost,
    xiBudget: MAX_XI_BUDGET,
    totalCost: bestOverall.cost,
    budget: MAX_SQUAD_BUDGET,
    xiXp: Math.round(bestOverall.xiXp * 10) / 10,
    formation: bestOverall.formation,
  };
}

export async function getServerScoutSquads(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ServerScoutSquadsPayload> {
  const epoch = computeProjectionEpochInfo(cachedData);
  if (!force && cachedScoutPayload && cachedScoutPayload.epochKey === epoch.epochKey) {
    return cachedScoutPayload;
  }
  if (!force && inFlightScoutBuild && inFlightScoutBuild.epochKey === epoch.epochKey) {
    return inFlightScoutBuild.promise;
  }

  const buildPromise = (async (): Promise<ServerScoutSquadsPayload> => {
    const startMs = Date.now();
    const coreCtx = await getOrBuildCoreContext(cachedData, force);
    const { baseHistoricalGW, targetNextGW } = coreCtx.epoch;
    const rawById = new Map((cachedData.player_stats || []).map((p) => [p.id, p]));

    const solverPlayers: SolverPlayer[] = coreCtx.corePayload.allPlayerFullSeasonProjections.map((proj) => {
      const raw = rawById.get(proj.id);
      const cell1 = proj.fullSeasonPointsMap?.[targetNextGW];
      const xP1 = cell1?.xp ?? 0;

      const wcGws = [targetNextGW, targetNextGW + 1, targetNextGW + 2, targetNextGW + 3, targetNextGW + 4, targetNextGW + 5].filter(
        (g) => g <= 38
      );
      const sum6 = wcGws.reduce((s, g) => s + (proj.fullSeasonPointsMap?.[g]?.xp ?? xP1), 0);
      const avgXp6 = wcGws.length > 0 ? Number((sum6 / wcGws.length).toFixed(1)) : xP1;

      return {
        id: proj.id,
        position: proj.position,
        teamShort: proj.teamShort,
        cost: proj.nowCost,
        pts: raw?.totalPoints || 0,
        mins: Math.max(raw?.minutes || 0, 1),
        status: proj.status || 'a',
        fullSeasonPointsMap: proj.fullSeasonPointsMap,
        xP1: Number(xP1.toFixed(1)),
        avgXp6,
      };
    });

    const fhTarget = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, targetNextGW, 'FH', false);
    const wcTarget = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, targetNextGW, 'WC', false);

    const halfEndGW = targetNextGW >= 20 ? 38 : 19;
    const chipSetByGw: Record<number, { fhSquadIds: number[]; wcSquadIds: number[] }> = {};

    for (let g = targetNextGW; g <= halfEndGW; g++) {
      if (g === targetNextGW) {
        chipSetByGw[g] = {
          fhSquadIds: [...fhTarget.starterIds, ...fhTarget.benchIds],
          wcSquadIds: [...wcTarget.starterIds, ...wcTarget.benchIds],
        };
      } else {
        const fhRes = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, g, 'FH', true);
        const wcRes = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, g, 'WC', true);
        chipSetByGw[g] = {
          fhSquadIds: [...fhRes.starterIds, ...fhRes.benchIds],
          wcSquadIds: [...wcRes.starterIds, ...wcRes.benchIds],
        };
      }
    }

    const payload: ServerScoutSquadsPayload = {
      epochKey: coreCtx.epoch.epochKey,
      generatedAt: new Date().toISOString(),
      targetNextGW,
      fhTarget,
      wcTarget,
      chipSetByGw,
    };

    cachedScoutPayload = payload;
    console.log(
      `[ProjectionEngine] Solved Scout FH/WC Squads epoch=${coreCtx.epoch.epochKey} (${Object.keys(chipSetByGw).length} GWs) in ${Date.now() - startMs}ms`
    );
    return payload;
  })();

  inFlightScoutBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightScoutBuild?.promise === buildPromise) {
      inFlightScoutBuild = null;
    }
  }
}
