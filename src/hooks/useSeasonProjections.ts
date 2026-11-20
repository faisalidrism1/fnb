import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TransformedLeagueData,
  GwEventStatus,
  SyncStatus,
  ServerProjectionCorePayload,
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
} from '../storage.ts';

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
  const [isLoadingMatches, setIsLoadingMatches] = useState<boolean>(false);
  const inFlightEpochRef = useRef<string | null>(null);

  // Hydrate instantly from persistent IndexedDB on mount
  useEffect(() => {
    let mounted = true;
    loadProjectionsCoreFromIndexedDB<ServerProjectionCorePayload>()
      .then((cached) => {
        if (mounted && cached && cached.epochKey && Array.isArray(cached.allPlayerFullSeasonProjections)) {
          setCorePayload((prev) => prev || cached);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Deterministic GW Epoch Key:
  // Strictly shifts ONLY on:
  //   1. Cold Start / empty cache
  //   2. Live -> Provisional
  //   3. Provisional -> Confirmed
  // Zero shift during Live 30s/60s ticks, Not Started rollover, or Kickoff (Not Started -> Live)!
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
    const epochKey = `${baseHistoricalGW}:${effectiveEpochStatus}`;

    return {
      epochKey,
      lifecycleStatus,
      isCurrentGwFinishedOrConfirmed,
      baseHistoricalGW,
      targetNextGW,
      maxReviewGW,
    };
  }, [availableGWs, currentGW, eventsStatus, gwStatus, syncStatus, leagueData?.available_gws, leagueData?.events_status, leagueData?.gw_status, leagueData?.sync_status]);

  // Lazy fetch from server ONLY when user views one of the 3 projection tabs AND epoch changed
  useEffect(() => {
    if (!enabled || !leagueData) return;
    if (corePayload && corePayload.epochKey === epochInfo.epochKey) return;
    if (inFlightEpochRef.current === epochInfo.epochKey) return;

    let mounted = true;
    inFlightEpochRef.current = epochInfo.epochKey;
    setIsLoadingMatches(true);

    fetch('/api/projections-core')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted || !json?.success || !json.data) return;
        const payload = json.data as ServerProjectionCorePayload;
        setCorePayload(payload);
        saveProjectionsCoreToIndexedDB(payload).catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightEpochRef.current === epochInfo.epochKey) {
          inFlightEpochRef.current = null;
        }
        if (mounted) {
          setIsLoadingMatches(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [enabled, leagueData, epochInfo.epochKey, corePayload?.epochKey]);

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
