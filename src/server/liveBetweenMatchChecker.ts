import type { MatchCardItem } from '../types.ts';
import { getOptimalDatabase } from './db.ts';
import { fetchMatchesForGw, getCachedMatchesForGw } from './matchesFetcher.ts';

export interface RunningMatchSummary {
  id?: number;
  homeTeam: string;
  awayTeam: string;
  phase: string;
  minutes: number;
}

export interface LiveBetweenMatchCheckResult {
  gw: number;
  appGwStatus: string;
  isGwStatusLive: boolean;
  hasRunningMatch: boolean;
  runningMatchesCount: number;
  finishedMatchesCount: number;
  upcomingMatchesCount: number;
  totalMatchesCount: number;
  allMatchesFinished: boolean;
  allMatchesUpcoming: boolean;
  runningMatches: RunningMatchSummary[];
  resolvedTickerPhase: 'Live Match' | 'Between Match' | null;
  source: 'matches_override' | 'live_matches_cache' | 'db_gw_fixtures' | 'gw_meta_fallback' | 'none';
  checkedAt: string;
}

export function isMatchCardFinished(match: MatchCardItem): boolean {
  if (!match) return false;
  const clockUpper = String(match.clock_label || '').trim().toUpperCase();
  const isFullTimeClock = clockUpper === 'FT' || clockUpper.includes('FULL TIME') || clockUpper.includes('FULLTIME');
  return Boolean(match.finished || match.finished_provisional || match.phase === 'FT' || isFullTimeClock);
}

export function isMatchCardRunning(match: MatchCardItem): boolean {
  if (!match) return false;
  if (isMatchCardFinished(match)) return false;
  return Boolean(match.started && match.phase !== 'UPCOMING');
}

export function isDbFixtureRunning(fixture: any): boolean {
  if (!fixture) return false;
  const isFinished = Boolean(fixture.finished || fixture.finished_provisional);
  if (isFinished) return false;
  return Boolean(fixture.started);
}

export function isDbFixtureFinished(fixture: any): boolean {
  if (!fixture) return false;
  return Boolean(fixture.finished || fixture.finished_provisional);
}

/**
 * Dedicated checker for News Ticker phases Live Match (LM) vs Between Match (BM).
 *
 * Strictly leaves application GW status untouched (`db.meta.gw_status`).
 * Whenever the application GW status is 'Live' (or fixtures are mid-GW),
 * inspects whether any match in the active Gameweek is currently running:
 * - >= 1 match currently running -> 'Live Match'
 * - 0 matches currently running  -> 'Between Match'
 */
export function checkLiveBetweenMatchPhase(
  targetGw?: number,
  options?: {
    matchesOverride?: MatchCardItem[] | null;
    dbOverride?: any;
  }
): LiveBetweenMatchCheckResult {
  const checkedAt = new Date().toISOString();
  const db = options?.dbOverride || getOptimalDatabase();
  const currentGw = Number(db?.meta?.current_gw) || 0;
  const gw = Number(targetGw || currentGw) || 0;
  const statusObj = db?.meta?.gw_status || {};
  const appGwStatus = String(statusObj.status || '');
  const isDataChecked = Boolean(statusObj.data_checked);
  const isLeaguesUpdated = statusObj.leagues_status === 'Updated';

  if (!gw || gw !== currentGw) {
    return {
      gw,
      appGwStatus,
      isGwStatusLive: false,
      hasRunningMatch: false,
      runningMatchesCount: 0,
      finishedMatchesCount: 0,
      upcomingMatchesCount: 0,
      totalMatchesCount: 0,
      allMatchesFinished: false,
      allMatchesUpcoming: false,
      runningMatches: [],
      resolvedTickerPhase: null,
      source: 'none',
      checkedAt,
    };
  }

  // Confirmed / Not started / Provisional are outside the Live LM<->BM window
  if ((isDataChecked && isLeaguesUpdated) || appGwStatus === 'Confirmed' || appGwStatus === 'Not started' || appGwStatus === 'Provisional') {
    return {
      gw,
      appGwStatus,
      isGwStatusLive: false,
      hasRunningMatch: false,
      runningMatchesCount: 0,
      finishedMatchesCount: 0,
      upcomingMatchesCount: 0,
      totalMatchesCount: 0,
      allMatchesFinished: appGwStatus === 'Confirmed' || appGwStatus === 'Provisional',
      allMatchesUpcoming: appGwStatus === 'Not started',
      runningMatches: [],
      resolvedTickerPhase: null,
      source: 'none',
      checkedAt,
    };
  }

  // Gather match states from the freshest available source:
  // 1) Explicit matchesOverride (testing / caller-supplied fresh MatchCardItem[])
  // 2) Live matches cache from matchesFetcher (15s TTL with FPL + Pulse clock/HT/FT accuracy)
  // 3) Synced db.meta.sync_status.gw_fixtures
  const cachedMatches = options?.matchesOverride === undefined ? getCachedMatchesForGw(gw) : null;
  const activeMatchCards =
    Array.isArray(options?.matchesOverride) && options.matchesOverride.length > 0
      ? options.matchesOverride
      : Array.isArray(cachedMatches) && cachedMatches.length > 0
      ? cachedMatches
      : null;

  let runningMatches: RunningMatchSummary[] = [];
  let finishedMatchesCount = 0;
  let upcomingMatchesCount = 0;
  let totalMatchesCount = 0;
  let source: LiveBetweenMatchCheckResult['source'] = 'none';

  if (activeMatchCards) {
    source = Array.isArray(options?.matchesOverride) && options.matchesOverride.length > 0
      ? 'matches_override'
      : 'live_matches_cache';
    totalMatchesCount = activeMatchCards.length;

    for (const m of activeMatchCards) {
      if (isMatchCardFinished(m)) {
        finishedMatchesCount++;
      } else if (isMatchCardRunning(m)) {
        runningMatches.push({
          id: m.id,
          homeTeam: m.home_team?.name || m.home_team?.short_name || 'Home',
          awayTeam: m.away_team?.name || m.away_team?.short_name || 'Away',
          phase: m.phase || (m.is_half_time ? 'HT' : 'LIVE'),
          minutes: Number(m.minutes) || 0,
        });
      } else {
        upcomingMatchesCount++;
      }
    }
  } else {
    const dbFixtures = (db?.meta?.sync_status?.gw_fixtures || []).filter(
      (f: any) => Number(f.event) === gw
    );

    if (dbFixtures.length > 0) {
      source = 'db_gw_fixtures';
      totalMatchesCount = dbFixtures.length;

      for (const f of dbFixtures) {
        if (isDbFixtureFinished(f)) {
          finishedMatchesCount++;
        } else if (isDbFixtureRunning(f)) {
          runningMatches.push({
            id: f.id,
            homeTeam: String(f.home_team || 'Home'),
            awayTeam: String(f.away_team || 'Away'),
            phase: 'LIVE',
            minutes: Number(f.minutes) || 0,
          });
        } else {
          upcomingMatchesCount++;
        }
      }
    }
  }

  const allMatchesFinished = totalMatchesCount > 0 && finishedMatchesCount === totalMatchesCount;
  const allMatchesUpcoming = totalMatchesCount > 0 && upcomingMatchesCount === totalMatchesCount;

  // Determine whether we are in the GW Live state (either explicitly via appGwStatus === 'Live',
  // or inferred when appGwStatus is blank/missing and fixtures show GW is currently in progress)
  const hasExplicitLiveStatus = appGwStatus === 'Live';
  const hasMixedOrActiveFixtures = totalMatchesCount > 0 && !allMatchesUpcoming && !allMatchesFinished;
  const isGwStatusLive = hasExplicitLiveStatus || (!appGwStatus && hasMixedOrActiveFixtures);

  if (!isGwStatusLive) {
    return {
      gw,
      appGwStatus,
      isGwStatusLive: false,
      hasRunningMatch: runningMatches.length > 0,
      runningMatchesCount: runningMatches.length,
      finishedMatchesCount,
      upcomingMatchesCount,
      totalMatchesCount,
      allMatchesFinished,
      allMatchesUpcoming,
      runningMatches,
      resolvedTickerPhase: null,
      source,
      checkedAt,
    };
  }

  // Fallback when GW status is explicitly 'Live' but neither cache nor db_gw_fixtures has match rows
  if (totalMatchesCount === 0) {
    const activeFixturesMeta = Array.isArray(db?.meta?.sync_status?.active_fixtures)
      ? db.meta.sync_status.active_fixtures
      : [];
    const fallbackRunning = Boolean(
      activeFixturesMeta.length > 0 ||
      db?.meta?.sync_status?.is_matchday_live ||
      db?.meta?.is_live
    );
    source = 'gw_meta_fallback';
    return {
      gw,
      appGwStatus,
      isGwStatusLive: true,
      hasRunningMatch: fallbackRunning,
      runningMatchesCount: activeFixturesMeta.length || (fallbackRunning ? 1 : 0),
      finishedMatchesCount: 0,
      upcomingMatchesCount: 0,
      totalMatchesCount: 0,
      allMatchesFinished: false,
      allMatchesUpcoming: false,
      runningMatches: activeFixturesMeta.map((label: string) => {
        const parts = String(label).split(' vs ');
        return {
          homeTeam: parts[0] || label,
          awayTeam: parts[1] || '',
          phase: 'LIVE',
          minutes: 0,
        };
      }),
      resolvedTickerPhase: fallbackRunning ? 'Live Match' : 'Between Match',
      source,
      checkedAt,
    };
  }

  const hasRunningMatch = runningMatches.length > 0;
  const resolvedTickerPhase: 'Live Match' | 'Between Match' = hasRunningMatch
    ? 'Live Match'
    : 'Between Match';

  return {
    gw,
    appGwStatus,
    isGwStatusLive: true,
    hasRunningMatch,
    runningMatchesCount: runningMatches.length,
    finishedMatchesCount,
    upcomingMatchesCount,
    totalMatchesCount,
    allMatchesFinished,
    allMatchesUpcoming,
    runningMatches,
    resolvedTickerPhase,
    source,
    checkedAt,
  };
}

/**
 * Ensures live match states are freshly fetched (respecting matchesFetcher's 15s TTL)
 * whenever the app GW status is 'Live' or fixtures are mid-GW, then runs the LM vs BM checker.
 */
export async function ensureLiveMatchesAndCheckPhase(
  targetGw?: number
): Promise<LiveBetweenMatchCheckResult> {
  const db = getOptimalDatabase();
  const currentGw = Number(db?.meta?.current_gw) || 0;
  const gw = Number(targetGw || currentGw) || 0;

  if (!gw || gw !== currentGw) {
    return checkLiveBetweenMatchPhase(gw, { dbOverride: db });
  }

  const initialCheck = checkLiveBetweenMatchPhase(gw, { dbOverride: db });
  if (initialCheck.isGwStatusLive) {
    try {
      const freshMatches = await fetchMatchesForGw(gw);
      if (Array.isArray(freshMatches) && freshMatches.length > 0) {
        return checkLiveBetweenMatchPhase(gw, {
          matchesOverride: freshMatches,
          dbOverride: db,
        });
      }
    } catch {
      // Fall back gracefully to initialCheck (cached matches or db_gw_fixtures)
    }
  }

  return initialCheck;
}
