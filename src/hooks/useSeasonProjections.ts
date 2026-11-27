import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TransformedLeagueData,
  GwEventStatus,
  SyncStatus,
  ServerProjectionCorePayload,
  ServerScoutSquadsPayload,
  ScheduleFixtureSummary,
  ProjectedFixtureOutcome,
  ClubNextMatchEntry,
  ClubGwMatchProjectionItem,
  ProjectedSquadPlayer,
  ProjectedPlayerCoreItem,
} from '../types.ts';
import { getGameweekStatus } from '../utils/gwStatus.ts';
import {
  loadProjectionsCoreFromIndexedDB,
  saveProjectionsCoreToIndexedDB,
  loadScoutSquadsFromIndexedDB,
  saveScoutSquadsToIndexedDB,
  clearProjectionCachesFromIndexedDB,
} from '../utils/indexedDbCache.ts';
import { PROJECTION_FORMULA_VERSION } from '../utils/projectionModel.ts';

interface UseSeasonProjectionsParams {
  enabled?: boolean;
  leagueData?: TransformedLeagueData;
  currentGW?: number;
  availableGWs?: number[];
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
}

const DEFAULT_PROJECTED_FIXTURE: ProjectedFixtureOutcome = {
  lambdaH: 1.45,
  lambdaA: 1.15,
  homeGoals: 1,
  awayGoals: 1,
  homeWinProb: 0.42,
  drawProb: 0.27,
  awayWinProb: 0.31,
  homeCsProb: 32,
  awayCsProb: 23,
  homeCsProbRaw: 0.3166,
  awayCsProbRaw: 0.2346,
  homeExpGcPenalty: 0.32,
  awayExpGcPenalty: 0.43,
};

export function useSeasonProjections({
  enabled = true,
  leagueData,
  currentGW = 9,
  availableGWs = [],
  gwStatus,
  eventsStatus,
  syncStatus,
}: UseSeasonProjectionsParams) {
  const [corePayload, setCorePayload] = useState<ServerProjectionCorePayload | null>(null);
  const [scoutSquadsPayload, setScoutSquadsPayload] = useState<ServerScoutSquadsPayload | null>(null);
  const [isLoadingMatches, setIsLoadingMatches] = useState<boolean>(false);
  const [isLoadingScoutSquads, setIsLoadingScoutSquads] = useState<boolean>(false);
  const [idbHydrated, setIdbHydrated] = useState<boolean>(false);
  const [refreshRevision, setRefreshRevision] = useState<number>(0);

  const inFlightCoreRef = useRef<{
    rev: number;
    promise: Promise<ServerProjectionCorePayload | null>;
  } | null>(null);
  const inFlightScoutRef = useRef<{
    rev: number;
    promise: Promise<ServerScoutSquadsPayload | null>;
  } | null>(null);
  const fetchedCoreRevRef = useRef<number>(-1);
  const fetchedScoutRevRef = useRef<number>(-1);
  const lastSyncSigRef = useRef<string | null>(null);

  // Lightweight GW lifecycle metadata (display + fallback before server payload lands)
  const epochInfo = useMemo(() => {
    const avail =
      Array.isArray(availableGWs) && availableGWs.length > 0
        ? availableGWs
        : Array.isArray(leagueData?.available_gws) && leagueData.available_gws.length > 0
        ? leagueData.available_gws
        : [1];
    const curr = currentGW || Math.max(...avail, 1);
    const evStatus =
      eventsStatus?.[curr] ||
      (gwStatus?.event === curr ? gwStatus : undefined) ||
      leagueData?.events_status?.[curr] ||
      (leagueData?.gw_status?.event === curr ? leagueData.gw_status : undefined);
    const lifecycleStatus = getGameweekStatus(curr, curr, evStatus, syncStatus || leagueData?.sync_status).status;
    const isCurrentGwFinishedOrConfirmed =
      lifecycleStatus === 'Confirmed' || lifecycleStatus === 'Provisional';

    let baseHistoricalGW: number;
    if (isCurrentGwFinishedOrConfirmed) {
      baseHistoricalGW = Math.min(Math.max(...avail, curr), 38);
    } else {
      const completed = avail.filter((gw) => {
        const st = eventsStatus?.[gw] ?? leagueData?.events_status?.[gw];
        return gw < curr || st?.status === 'Confirmed' || st?.finished === true;
      });
      baseHistoricalGW = completed.length > 0 ? Math.max(...completed) : Math.max(curr - 1, 1);
    }
    baseHistoricalGW = Math.min(Math.max(baseHistoricalGW, 1), 38);
    const maxReviewGW = baseHistoricalGW;
    const targetNextGW = Math.min(baseHistoricalGW + 1, 38);
    const effectiveEpochStatus =
      baseHistoricalGW === curr && lifecycleStatus === 'Provisional' ? 'Provisional' : 'Confirmed';
    const serverEpochKey =
      syncStatus?.projection_epoch_key || leagueData?.sync_status?.projection_epoch_key;
    const epochKey =
      serverEpochKey || `${baseHistoricalGW}:${effectiveEpochStatus}:${PROJECTION_FORMULA_VERSION}`;

    return {
      epochKey,
      lifecycleStatus,
      isCurrentGwFinishedOrConfirmed,
      baseHistoricalGW,
      targetNextGW,
      maxReviewGW,
    };
  }, [availableGWs, currentGW, eventsStatus, gwStatus, syncStatus, leagueData?.available_gws, leagueData?.events_status, leagueData?.gw_status, leagueData?.sync_status]);

  // Hydrate instant IndexedDB preview on mount unconditionally (no epochKey gate)
  useEffect(() => {
    let mounted = true;
    Promise.all([
      loadProjectionsCoreFromIndexedDB<ServerProjectionCorePayload>().catch(() => null),
      loadScoutSquadsFromIndexedDB<ServerScoutSquadsPayload>().catch(() => null),
    ]).then(([cachedCore, cachedScout]) => {
      if (!mounted) return;
      if (cachedCore && Array.isArray(cachedCore.allPlayerFullSeasonProjections)) {
        setCorePayload((prev) => prev || cachedCore);
      }
      if (
        cachedScout &&
        cachedScout.fhTarget &&
        cachedScout.wcTarget &&
        Array.isArray(cachedScout.fhTarget.starters) &&
        Array.isArray(cachedScout.wcTarget.starters) &&
        Array.isArray(cachedScout.captainPicks?.id) &&
        Array.isArray(cachedScout.differentialPicks?.id) &&
        Array.isArray(cachedScout.differentialPicksAll?.id)
      ) {
        setScoutSquadsPayload((prev) => prev || cachedScout);
      }
      setIdbHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Re-fetch from server cleanly whenever server sync updates timestamp/epoch or dev formula updates
  useEffect(() => {
    const handleSynced = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      const sig = `${detail?.lastSynced || ''}|${detail?.data?.sync_status?.projection_epoch_key || ''}`;
      if (lastSyncSigRef.current === null) {
        lastSyncSigRef.current = sig;
        return;
      }
      if (lastSyncSigRef.current !== sig) {
        lastSyncSigRef.current = sig;
        setRefreshRevision((prev) => prev + 1);
      }
    };
    const handleFormulaUpdated = () => {
      inFlightCoreRef.current = null;
      inFlightScoutRef.current = null;
      clearProjectionCachesFromIndexedDB().catch(() => {});
      setRefreshRevision((prev) => prev + 1);
    };
    window.addEventListener('fpl:data-synced', handleSynced);
    window.addEventListener('fpl:formula-updated', handleFormulaUpdated);
    return () => {
      window.removeEventListener('fpl:data-synced', handleSynced);
      window.removeEventListener('fpl:formula-updated', handleFormulaUpdated);
    };
  }, []);

  // Always fetch latest /api/projections-core once per boot/sync revision and keep existing view while loading
  useEffect(() => {
    if (!enabled || !leagueData || !idbHydrated) return;
    if (fetchedCoreRevRef.current === refreshRevision) return;

    let mounted = true;
    if (!corePayload) {
      setIsLoadingMatches(true);
    }

    let activePromise: Promise<ServerProjectionCorePayload | null>;
    if (inFlightCoreRef.current && inFlightCoreRef.current.rev === refreshRevision) {
      activePromise = inFlightCoreRef.current.promise;
    } else {
      const fetchPromise = fetch(`/api/projections-core?_t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => (json?.success && json.data ? (json.data as ServerProjectionCorePayload) : null))
        .catch(() => null)
        .finally(() => {
          if (inFlightCoreRef.current?.promise === fetchPromise) {
            inFlightCoreRef.current = null;
          }
        });
      inFlightCoreRef.current = { rev: refreshRevision, promise: fetchPromise };
      activePromise = fetchPromise;
    }

    activePromise.then((payload) => {
      if (!mounted) return;
      if (payload) {
        fetchedCoreRevRef.current = refreshRevision;
        setCorePayload((prev) => {
          if (
            prev &&
            prev.epochKey === payload.epochKey &&
            prev.generatedAt === payload.generatedAt
          ) {
            return prev;
          }
          return payload;
        });
        saveProjectionsCoreToIndexedDB(payload).catch(() => {});
      }
      setIsLoadingMatches(false);
    });

    return () => {
      mounted = false;
    };
  }, [enabled, leagueData, idbHydrated, refreshRevision]);

  // Always fetch latest /api/projections-scout-squads once per boot/sync revision
  useEffect(() => {
    if (!enabled || !leagueData || !idbHydrated) return;
    if (fetchedScoutRevRef.current === refreshRevision) return;

    let mounted = true;
    if (!scoutSquadsPayload) {
      setIsLoadingScoutSquads(true);
    }

    let activePromise: Promise<ServerScoutSquadsPayload | null>;
    if (inFlightScoutRef.current && inFlightScoutRef.current.rev === refreshRevision) {
      activePromise = inFlightScoutRef.current.promise;
    } else {
      const fetchPromise = fetch(`/api/projections-scout-squads?_t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => (json?.success && json.data ? (json.data as ServerScoutSquadsPayload) : null))
        .catch(() => null)
        .finally(() => {
          if (inFlightScoutRef.current?.promise === fetchPromise) {
            inFlightScoutRef.current = null;
          }
        });
      inFlightScoutRef.current = { rev: refreshRevision, promise: fetchPromise };
      activePromise = fetchPromise;
    }

    activePromise.then((payload) => {
      if (!mounted) return;
      if (payload) {
        fetchedScoutRevRef.current = refreshRevision;
        setScoutSquadsPayload((prev) => {
          if (
            prev &&
            prev.epochKey === payload.epochKey &&
            prev.generatedAt === payload.generatedAt
          ) {
            return prev;
          }
          return payload;
        });
        saveScoutSquadsToIndexedDB(payload).catch(() => {});
      }
      setIsLoadingScoutSquads(false);
    });

    return () => {
      mounted = false;
    };
  }, [enabled, leagueData, idbHydrated, refreshRevision]);

  const scheduleByGw: Record<number, ScheduleFixtureSummary[]> = useMemo(
    () => corePayload?.scheduleByGw || {},
    [corePayload?.scheduleByGw]
  );

  const clubNextMatchesMap: Record<string, ClubNextMatchEntry[]> = useMemo(
    () => corePayload?.clubNextMatchesMap || {},
    [corePayload?.clubNextMatchesMap]
  );

  const clubNextMatchMap = useMemo(() => {
    const map = new Map<
      string,
      { opponentShort: string; opponentName: string; isHome: boolean; kickoffTime: string }
    >();
    for (const [short, list] of Object.entries(clubNextMatchesMap)) {
      if (Array.isArray(list) && list.length > 0) {
        map.set(short, {
          opponentShort: list[0].opponentShort,
          opponentName: list[0].opponentName,
          isHome: list[0].isHome,
          kickoffTime: list[0].kickoffTime,
        });
      }
    }
    return map;
  }, [clubNextMatchesMap]);

  const clubGwMatchProjections: Record<string, ClubGwMatchProjectionItem[]> = useMemo(
    () => corePayload?.clubGwMatchProjections || {},
    [corePayload?.clubGwMatchProjections]
  );

  const clubSquadProjections: Record<string, ProjectedSquadPlayer[]> = useMemo(
    () => corePayload?.clubSquadProjections || {},
    [corePayload?.clubSquadProjections]
  );

  const allPlayerFullSeasonProjections: ProjectedPlayerCoreItem[] = useMemo(
    () => corePayload?.allPlayerFullSeasonProjections || [],
    [corePayload?.allPlayerFullSeasonProjections]
  );

  const targetNextGW = corePayload?.targetNextGW ?? epochInfo.targetNextGW;
  const baseHistoricalGW = corePayload?.baseHistoricalGW ?? epochInfo.baseHistoricalGW;
  const maxReviewGW = corePayload?.maxReviewGW ?? epochInfo.maxReviewGW;

  const projectFixture = useCallback(
    (homeShort: string, awayShort: string, gw: number = targetNextGW): ProjectedFixtureOutcome => {
      const key = `${gw}_${homeShort}_${awayShort}`;
      return corePayload?.fixtureProjectionsByKey?.[key] || DEFAULT_PROJECTED_FIXTURE;
    },
    [corePayload?.fixtureProjectionsByKey, targetNextGW]
  );

  return {
    epochKey: corePayload?.epochKey || epochInfo.epochKey,
    targetEpochKey: epochInfo.epochKey,
    clubs: corePayload?.clubs || [],
    isCurrentGwFinishedOrConfirmed:
      corePayload?.isCurrentGwFinishedOrConfirmed ?? epochInfo.isCurrentGwFinishedOrConfirmed,
    baseHistoricalGW,
    targetNextGW,
    maxReviewGW,
    isLoadingMatches,
    scoutSquadsPayload,
    isLoadingScoutSquads,
    scheduleByGw,
    matchesByGW: scheduleByGw,
    fixtureProjectionsByKey: corePayload?.fixtureProjectionsByKey || {},
    clubNextMatchesMap,
    clubNextMatchMap,
    clubGwMatchProjections,
    clubSquadProjections,
    allPlayerFullSeasonProjections,
    projectFixture,
  };
}
