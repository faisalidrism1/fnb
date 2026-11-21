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
} from '../storage.ts';
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
  const inFlightEpochRef = useRef<string | null>(null);
  const inFlightScoutEpochRef = useRef<string | null>(null);
  // Tracks whether this browser session has verified Core / Scout payloads with the live server
  const verifiedCoreEpochRef = useRef<string | null>(null);
  const verifiedCoreServerEpochRef = useRef<string | null>(null);
  const verifiedScoutEpochRef = useRef<string | null>(null);
  const verifiedScoutServerEpochRef = useRef<string | null>(null);

  // Deterministic GW Epoch Key:
  // Combines GW lifecycle state + server formula source fingerprint (detects edits AND rollbacks!)
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

  // Hydrate both core projections and scout squads from persistent IndexedDB on mount ONLY if epoch matches
  useEffect(() => {
    let mounted = true;
    loadProjectionsCoreFromIndexedDB<ServerProjectionCorePayload>()
      .then((cached) => {
        if (!mounted || !cached || !cached.epochKey || !Array.isArray(cached.allPlayerFullSeasonProjections)) {
          return;
        }
        if (cached.epochKey === epochInfo.epochKey) {
          setCorePayload((prev) => prev || cached);
        }
      })
      .catch(() => {});
    loadScoutSquadsFromIndexedDB<ServerScoutSquadsPayload>()
      .then((cached) => {
        if (!mounted || !cached || !cached.epochKey || !cached.fhTarget || !cached.wcTarget) {
          return;
        }
        if (cached.epochKey === epochInfo.epochKey) {
          setScoutSquadsPayload((prev) => prev || cached);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [epochInfo.epochKey]);

  // Invalidate verification refs whenever SSE / fetchData sync completes so dev restarts/rollbacks auto-refresh
  useEffect(() => {
    const handleSynced = () => {
      verifiedCoreEpochRef.current = null;
      verifiedScoutEpochRef.current = null;
    };
    window.addEventListener('fpl:data-synced', handleSynced);
    return () => window.removeEventListener('fpl:data-synced', handleSynced);
  }, []);

  // Fetch /api/projections-core when epoch mismatches OR once per session to catch formula edits/rollbacks
  useEffect(() => {
    if (!enabled || !leagueData) return;

    const coreMatches = Boolean(
      corePayload &&
      (corePayload.epochKey === epochInfo.epochKey ||
        (verifiedCoreEpochRef.current === epochInfo.epochKey &&
          corePayload.epochKey === verifiedCoreServerEpochRef.current))
    );
    if (corePayload && !coreMatches) {
      // Formula/epoch changed or rolled back: discard stale cached projections immediately
      setCorePayload(null);
      clearProjectionCachesFromIndexedDB().catch(() => {});
    }

    const alreadyVerified = verifiedCoreEpochRef.current === epochInfo.epochKey;
    if (coreMatches && alreadyVerified) return;
    if (inFlightEpochRef.current === epochInfo.epochKey) return;

    let mounted = true;
    inFlightEpochRef.current = epochInfo.epochKey;
    if (!coreMatches) {
      setIsLoadingMatches(true);
    }

    fetch(`/api/projections-core?_t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted || !json?.success || !json.data) return;
        const payload = json.data as ServerProjectionCorePayload;
        verifiedCoreEpochRef.current = epochInfo.epochKey;
        verifiedCoreServerEpochRef.current = payload.epochKey || epochInfo.epochKey;
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
  }, [enabled, leagueData, epochInfo.epochKey, corePayload?.epochKey, corePayload?.generatedAt]);

  // Fetch /api/projections-scout-squads when epoch mismatches OR once per session to catch formula edits/rollbacks
  useEffect(() => {
    if (!enabled || !leagueData) return;

    const scoutMatches = Boolean(
      scoutSquadsPayload &&
      (scoutSquadsPayload.epochKey === epochInfo.epochKey ||
        (verifiedScoutEpochRef.current === epochInfo.epochKey &&
          scoutSquadsPayload.epochKey === verifiedScoutServerEpochRef.current))
    );
    if (scoutSquadsPayload && !scoutMatches) {
      // Formula/epoch changed or rolled back: discard stale cached scout squads immediately
      setScoutSquadsPayload(null);
    }

    const alreadyVerified = verifiedScoutEpochRef.current === epochInfo.epochKey;
    if (scoutMatches && alreadyVerified) return;
    if (inFlightScoutEpochRef.current === epochInfo.epochKey) return;

    let mounted = true;
    inFlightScoutEpochRef.current = epochInfo.epochKey;
    if (!scoutMatches) {
      setIsLoadingScoutSquads(true);
    }

    fetch(`/api/projections-scout-squads?_t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted || !json?.success || !json.data) return;
        const payload = json.data as ServerScoutSquadsPayload;
        verifiedScoutEpochRef.current = epochInfo.epochKey;
        verifiedScoutServerEpochRef.current = payload.epochKey || epochInfo.epochKey;
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
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightScoutEpochRef.current === epochInfo.epochKey) {
          inFlightScoutEpochRef.current = null;
        }
        if (mounted) {
          setIsLoadingScoutSquads(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [enabled, leagueData, epochInfo.epochKey, scoutSquadsPayload?.epochKey, scoutSquadsPayload?.generatedAt]);

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
