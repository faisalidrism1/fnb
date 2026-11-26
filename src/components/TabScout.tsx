import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ScoutSubTab,
  TransformedLeagueData,
  GwEventStatus,
  SyncStatus,
  ProjectionClubItem,
  ClubNextMatchEntry,
  ScheduleFixtureSummary,
  ClubGwMatchProjectionItem,
  ProjectedPlayerCoreItem,
  ProjectedFixtureOutcome,
  ServerScoutSquadsPayload,
  ServerScoutManagerAnalysisPayload,
  ServerScoutChipsAnalysis,
  ServerScoutTransferAnalysis,
  SolvedScoutSquadResult,
  ScoutPlayerCardItem,
} from '../types.ts';
import { useUserProfileId } from '../utils/userProfile.ts';
import { useLanguage } from '../utils/i18n.ts';
import { Star, ArrowRight, Zap, CheckCircle, X } from 'lucide-react';
import { PROJECTION_FORMULA_VERSION } from '../utils/projectionModel.ts';
import { loadScoutSquadsFromIndexedDB, saveScoutSquadsToIndexedDB } from '../utils/indexedDbCache.ts';
import {
  resolvePlayerAvailabilityHighlight,
  PlayerAvailabilityHighlight,
} from '../utils/playerAvailabilityHighlight.ts';
import { PlayerAvailabilityFlag } from './PlayerAvailabilityFlag.tsx';

interface TabScoutProps {
  leagueData?: TransformedLeagueData;
  currentGW?: number;
  availableGWs?: number[];
  subTab: ScoutSubTab;
  onSelectSubTab?: (sub: ScoutSubTab) => void;
  onSelectManager?: (managerId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
  active?: boolean;
  sharedEpochKey?: string;
  sharedClubs?: ProjectionClubItem[];
  sharedBaseHistoricalGW?: number;
  sharedTargetNextGW?: number;
  sharedClubNextMatchesMap?: Record<string, ClubNextMatchEntry[]>;
  sharedScheduleByGw?: Record<number, ScheduleFixtureSummary[]>;
  sharedClubGwMatchProjections?: Record<string, ClubGwMatchProjectionItem[]>;
  playerProjections?: ProjectedPlayerCoreItem[];
  sharedMatchesByGW?: Record<number, any[]>;
  sharedProjectFixture?: (homeShort: string, awayShort: string, gw?: number) => ProjectedFixtureOutcome;
  sharedScoutSquads?: ServerScoutSquadsPayload | null;
  isLoadingSharedScoutSquads?: boolean;
}

const isEpochCompatible = (payloadEpoch?: string | null, targetEpoch?: string | null): boolean => {
  if (!payloadEpoch || !targetEpoch) return false;
  if (payloadEpoch === targetEpoch) return true;
  const payloadParts = payloadEpoch.split(':');
  const targetParts = targetEpoch.split(':');
  if (targetParts.length === 3 && payloadParts.length >= 4) {
    return payloadEpoch.startsWith(`${targetEpoch}:`);
  }
  return false;
};

const isScoutSquadsPayloadComplete = (payload?: ServerScoutSquadsPayload | null): payload is ServerScoutSquadsPayload => {
  return Boolean(
    payload &&
      payload.epochKey &&
      payload.fhTarget &&
      payload.wcTarget &&
      Array.isArray(payload.fhTarget.starters) &&
      Array.isArray(payload.fhTarget.bench) &&
      Array.isArray(payload.wcTarget.starters) &&
      Array.isArray(payload.wcTarget.bench) &&
      Array.isArray(payload.captainPicks?.id) &&
      Array.isArray(payload.captainPicks?.en) &&
      Array.isArray(payload.differentialPicks?.id) &&
      Array.isArray(payload.differentialPicks?.en) &&
      Array.isArray(payload.differentialPicksAll?.id) &&
      Array.isArray(payload.differentialPicksAll?.en)
  );
};

export const TabScout: React.FC<TabScoutProps> = ({
  leagueData,
  currentGW = 9,
  availableGWs = [],
  subTab,
  onSelectPlayer,
  gwStatus,
  eventsStatus,
  active = true,
  sharedEpochKey,
  sharedBaseHistoricalGW,
  sharedTargetNextGW,
  sharedScoutSquads,
  isLoadingSharedScoutSquads = false,
  playerProjections = [],
  sharedClubGwMatchProjections,
}) => {
  const { language } = useLanguage();
  // FNB League default ('fnb') and Indonesian ('id') both use Bahasa Indonesia for narratives
  const isId = language !== 'en';
  const langKey: 'id' | 'en' = isId ? 'id' : 'en';
  const profileId = useUserProfileId();

  const [formulaRevision, setFormulaRevision] = useState<number>(0);
  const [syncRevision, setSyncRevision] = useState<number>(0);
  const [picksType, setPicksType] = useState<'FH' | 'WC'>('FH');
  const [activePicksBreakdownId, setActivePicksBreakdownId] = useState<number | null>(null);
  const [diffMode, setDiffMode] = useState<'EXCLUDE' | 'ALL'>('EXCLUDE');
  const [transferMode, setTransferMode] = useState<'FT' | 'HIT'>('FT');
  const [transferHorizon, setTransferHorizon] = useState<1 | 3 | 6>(1);

  // Epoch-aligned historical & target GW context (synced from server projection core)
  const baseHistoricalGW = useMemo(() => {
    if (sharedBaseHistoricalGW && sharedBaseHistoricalGW >= 1) return sharedBaseHistoricalGW;
    const avail = Array.isArray(availableGWs) && availableGWs.length > 0
      ? availableGWs
      : (Array.isArray(leagueData?.available_gws) && leagueData.available_gws.length > 0
        ? leagueData.available_gws
        : [Math.max(currentGW || 1, 1)]);
    const curr = currentGW || Math.max(...avail, 1);
    const ev = eventsStatus?.[curr] || (gwStatus?.event === curr ? gwStatus : undefined);
    if (ev?.status === 'Confirmed' || ev?.status === 'Provisional') {
      return Math.min(Math.max(...avail, curr), 38);
    }
    const completed = avail.filter((gw) => gw < curr || eventsStatus?.[gw]?.status === 'Confirmed' || eventsStatus?.[gw]?.finished === true);
    return completed.length > 0 ? Math.max(...completed) : Math.max(curr - 1, 1);
  }, [sharedBaseHistoricalGW, availableGWs, leagueData?.available_gws, currentGW, eventsStatus, gwStatus]);

  const targetNextGW = useMemo(() => {
    if (sharedTargetNextGW && sharedTargetNextGW >= 1) return Math.min(sharedTargetNextGW, 38);
    return Math.min(baseHistoricalGW + 1, 38);
  }, [sharedTargetNextGW, baseHistoricalGW]);

  const effectiveEpochKey = useMemo(() => {
    if (sharedEpochKey) return sharedEpochKey;
    if (leagueData?.sync_status?.projection_epoch_key) {
      return leagueData.sync_status.projection_epoch_key;
    }
    const curr = currentGW || baseHistoricalGW;
    const ev = eventsStatus?.[curr] || (gwStatus?.event === curr ? gwStatus : undefined);
    const st = baseHistoricalGW === curr && ev?.status === 'Provisional' ? 'Provisional' : 'Confirmed';
    return `${baseHistoricalGW}:${st}:${PROJECTION_FORMULA_VERSION}`;
  }, [sharedEpochKey, leagueData?.sync_status?.projection_epoch_key, currentGW, baseHistoricalGW, eventsStatus, gwStatus]);

  // Resolve target entryId strictly from user's selected profile (0 when Guest)
  const resolvedEntryId = useMemo(() => {
    if (profileId && Number.isInteger(profileId) && profileId > 0) return profileId;
    return 0;
  }, [profileId]);

  // ==========================================
  // SERVER SCOUT SQUADS (PICKS, CAPTAIN, DIFFERENTIAL)
  // ==========================================
  const [localScoutSquadsPayload, setLocalScoutSquadsPayload] = useState<ServerScoutSquadsPayload | null>(null);
  const [isLoadingLocalScoutSquads, setIsLoadingLocalScoutSquads] = useState<boolean>(false);
  const scoutSquadsCacheRef = useRef<Map<string, ServerScoutSquadsPayload>>(new Map());
  const verifiedLocalScoutEpochRef = useRef<string | null>(null);
  const inFlightScoutRef = useRef<{
    epochKey: string;
    promise: Promise<ServerScoutSquadsPayload | null>;
  } | null>(null);

  const scoutSquadsPayload =
    isScoutSquadsPayloadComplete(sharedScoutSquads) && isEpochCompatible(sharedScoutSquads.epochKey, effectiveEpochKey)
      ? sharedScoutSquads
      : isScoutSquadsPayloadComplete(localScoutSquadsPayload) && isEpochCompatible(localScoutSquadsPayload.epochKey, effectiveEpochKey)
      ? localScoutSquadsPayload
      : null;

  const isLoadingScoutSquads = Boolean(
    !scoutSquadsPayload && (isLoadingSharedScoutSquads || isLoadingLocalScoutSquads)
  );

  // ==========================================
  // SERVER MANAGER ANALYSIS (CHIPS & TRANSFER)
  // ==========================================
  const [managerAnalysisMap, setManagerAnalysisMap] = useState<Record<string, ServerScoutManagerAnalysisPayload>>({});
  const [isLoadingManagerAnalysis, setIsLoadingManagerAnalysis] = useState<boolean>(false);
  const managerAnalysisCacheRef = useRef<Map<string, ServerScoutManagerAnalysisPayload>>(new Map());
  const inFlightManagerAnalysisRef = useRef<Map<string, Promise<ServerScoutManagerAnalysisPayload | null>>>(new Map());

  useEffect(() => {
    const handleFormulaUpdated = () => {
      scoutSquadsCacheRef.current.clear();
      verifiedLocalScoutEpochRef.current = null;
      inFlightScoutRef.current = null;
      managerAnalysisCacheRef.current.clear();
      inFlightManagerAnalysisRef.current.clear();
      setLocalScoutSquadsPayload(null);
      setManagerAnalysisMap({});
      setFormulaRevision((prev) => prev + 1);
    };
    const handleDataSynced = (ev: Event) => {
      const nextServerEpoch = (ev as CustomEvent)?.detail?.data?.sync_status?.projection_epoch_key as
        | string
        | undefined;
      if (!nextServerEpoch || verifiedLocalScoutEpochRef.current !== nextServerEpoch) {
        verifiedLocalScoutEpochRef.current = null;
        scoutSquadsCacheRef.current.clear();
      }
      managerAnalysisCacheRef.current.clear();
      inFlightManagerAnalysisRef.current.clear();
      setSyncRevision((prev) => prev + 1);
    };
    window.addEventListener('fpl:formula-updated', handleFormulaUpdated);
    window.addEventListener('fpl:data-synced', handleDataSynced);
    return () => {
      window.removeEventListener('fpl:formula-updated', handleFormulaUpdated);
      window.removeEventListener('fpl:data-synced', handleDataSynced);
    };
  }, []);

  // Hydrate fallback from IndexedDB immediately ONLY when epochKey matches and payload includes server-rendered picks
  useEffect(() => {
    if (isScoutSquadsPayloadComplete(sharedScoutSquads) && isEpochCompatible(sharedScoutSquads.epochKey, effectiveEpochKey)) {
      return;
    }
    let mounted = true;
    loadScoutSquadsFromIndexedDB<ServerScoutSquadsPayload>()
      .then((cached) => {
        if (!mounted || !isScoutSquadsPayloadComplete(cached)) return;
        if (isEpochCompatible(cached.epochKey, effectiveEpochKey)) {
          setLocalScoutSquadsPayload((prev) =>
            prev && isEpochCompatible(prev.epochKey, effectiveEpochKey) ? prev : cached
          );
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [sharedScoutSquads, effectiveEpochKey]);

  useEffect(() => {
    if (!leagueData) return;
    if (isScoutSquadsPayloadComplete(sharedScoutSquads) && isEpochCompatible(sharedScoutSquads.epochKey, effectiveEpochKey)) {
      scoutSquadsCacheRef.current.set(effectiveEpochKey, sharedScoutSquads);
      verifiedLocalScoutEpochRef.current = effectiveEpochKey;
      setIsLoadingLocalScoutSquads(false);
      return;
    }

    const cached = scoutSquadsCacheRef.current.get(effectiveEpochKey);
    if (
      verifiedLocalScoutEpochRef.current === effectiveEpochKey &&
      isScoutSquadsPayloadComplete(cached) &&
      isEpochCompatible(cached.epochKey, effectiveEpochKey)
    ) {
      setLocalScoutSquadsPayload(cached);
      setIsLoadingLocalScoutSquads(false);
      return;
    }
    if (sharedScoutSquads !== undefined && isLoadingSharedScoutSquads) {
      return;
    }

    let mounted = true;
    if (!isScoutSquadsPayloadComplete(localScoutSquadsPayload)) {
      setIsLoadingLocalScoutSquads(true);
    }

    let activePromise: Promise<ServerScoutSquadsPayload | null>;
    if (inFlightScoutRef.current && inFlightScoutRef.current.epochKey === effectiveEpochKey) {
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
      inFlightScoutRef.current = { epochKey: effectiveEpochKey, promise: fetchPromise };
      activePromise = fetchPromise;
    }

    activePromise.then((payload) => {
      if (!mounted) return;
      if (isScoutSquadsPayloadComplete(payload)) {
        if (payload.epochKey) {
          scoutSquadsCacheRef.current.set(payload.epochKey, payload);
        }
        scoutSquadsCacheRef.current.set(effectiveEpochKey, payload);
        verifiedLocalScoutEpochRef.current = payload.epochKey || effectiveEpochKey;
        setLocalScoutSquadsPayload(payload);
        saveScoutSquadsToIndexedDB(payload).catch(() => {});
      }
      setIsLoadingLocalScoutSquads(false);
    });

    return () => {
      mounted = false;
    };
  }, [leagueData, effectiveEpochKey, sharedScoutSquads, isLoadingSharedScoutSquads, formulaRevision]);

  const managerAnalysisQueryKey = useMemo(() => {
    if (resolvedEntryId <= 0) return '';
    if (subTab === 'chips') {
      return `${effectiveEpochKey}:${resolvedEntryId}:chips:${langKey}:${formulaRevision}:${syncRevision}`;
    }
    if (subTab === 'transfer') {
      return `${effectiveEpochKey}:${resolvedEntryId}:transfer:${transferMode}:${transferHorizon}:${langKey}:${formulaRevision}:${syncRevision}`;
    }
    return '';
  }, [effectiveEpochKey, resolvedEntryId, subTab, transferMode, transferHorizon, langKey, formulaRevision, syncRevision]);

  useEffect(() => {
    if (!active || !leagueData || !managerAnalysisQueryKey || resolvedEntryId <= 0) return;
    if (subTab !== 'chips' && subTab !== 'transfer') return;

    const cached = managerAnalysisCacheRef.current.get(managerAnalysisQueryKey);
    if (cached) {
      setManagerAnalysisMap((prev) =>
        prev[managerAnalysisQueryKey] === cached
          ? prev
          : { ...prev, [managerAnalysisQueryKey]: cached }
      );
      setIsLoadingManagerAnalysis(false);
      return;
    }

    let mounted = true;
    setIsLoadingManagerAnalysis(true);

    let activePromise = inFlightManagerAnalysisRef.current.get(managerAnalysisQueryKey);
    if (!activePromise) {
      const qs = new URLSearchParams({
        section: subTab,
        lang: langKey,
        _t: String(Date.now()),
      });
      if (resolvedEntryId > 0) {
        qs.set('entryId', String(resolvedEntryId));
      }
      if (subTab === 'transfer') {
        qs.set('transferMode', transferMode);
        qs.set('transferHorizon', String(transferHorizon));
      }
      const fetchPromise = fetch(`/api/scout-manager-analysis?${qs.toString()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => (json?.success && json.data ? (json.data as ServerScoutManagerAnalysisPayload) : null))
        .catch(() => null)
        .finally(() => {
          if (inFlightManagerAnalysisRef.current.get(managerAnalysisQueryKey) === fetchPromise) {
            inFlightManagerAnalysisRef.current.delete(managerAnalysisQueryKey);
          }
        });
      inFlightManagerAnalysisRef.current.set(managerAnalysisQueryKey, fetchPromise);
      activePromise = fetchPromise;
    }

    activePromise.then((payload) => {
      if (!mounted) return;
      if (payload) {
        if (managerAnalysisCacheRef.current.size >= 80) {
          const oldest = managerAnalysisCacheRef.current.keys().next().value;
          if (oldest !== undefined) managerAnalysisCacheRef.current.delete(oldest);
        }
        managerAnalysisCacheRef.current.set(managerAnalysisQueryKey, payload);
        setManagerAnalysisMap((prev) => ({
          ...prev,
          [managerAnalysisQueryKey]: payload,
        }));
      }
      setIsLoadingManagerAnalysis(false);
    });

    return () => {
      mounted = false;
    };
  }, [
    active,
    leagueData,
    subTab,
    resolvedEntryId,
    transferMode,
    transferHorizon,
    langKey,
    managerAnalysisQueryKey,
  ]);

  // Silent background prefetch for Chips + Transfer sections while Scout tab is active
  useEffect(() => {
    if (!active || !leagueData || resolvedEntryId <= 0 || !scoutSquadsPayload) return;
    let mounted = true;
    const targets: Array<{ key: string; url: string }> = [
      {
        key: `${effectiveEpochKey}:${resolvedEntryId}:chips:${langKey}:${formulaRevision}:${syncRevision}`,
        url: `/api/scout-manager-analysis?section=chips&lang=${langKey}&entryId=${resolvedEntryId}`,
      },
      {
        key: `${effectiveEpochKey}:${resolvedEntryId}:transfer:${transferMode}:${transferHorizon}:${langKey}:${formulaRevision}:${syncRevision}`,
        url: `/api/scout-manager-analysis?section=transfer&transferMode=${transferMode}&transferHorizon=${transferHorizon}&lang=${langKey}&entryId=${resolvedEntryId}`,
      },
    ];

    const timer = window.setTimeout(() => {
      if (!mounted) return;
      for (const target of targets) {
        if (managerAnalysisCacheRef.current.has(target.key) || inFlightManagerAnalysisRef.current.has(target.key)) {
          continue;
        }
        const fetchPromise = fetch(`${target.url}&_t=${Date.now()}`, { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => (json?.success && json.data ? (json.data as ServerScoutManagerAnalysisPayload) : null))
          .catch(() => null)
          .finally(() => {
            if (inFlightManagerAnalysisRef.current.get(target.key) === fetchPromise) {
              inFlightManagerAnalysisRef.current.delete(target.key);
            }
          });
        inFlightManagerAnalysisRef.current.set(target.key, fetchPromise);
        fetchPromise.then((payload) => {
          if (!mounted || !payload) return;
          if (managerAnalysisCacheRef.current.size >= 80) {
            const oldest = managerAnalysisCacheRef.current.keys().next().value;
            if (oldest !== undefined) managerAnalysisCacheRef.current.delete(oldest);
          }
          managerAnalysisCacheRef.current.set(target.key, payload);
          setManagerAnalysisMap((prev) =>
            prev[target.key] ? prev : { ...prev, [target.key]: payload }
          );
        });
      }
    }, 60);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [
    active,
    leagueData,
    resolvedEntryId,
    scoutSquadsPayload,
    effectiveEpochKey,
    transferMode,
    transferHorizon,
    langKey,
    formulaRevision,
    syncRevision,
  ]);

  // ==========================================
  // DERIVED DISPLAY STATE FROM SERVER PAYLOADS
  // ==========================================
  const solvedScoutSquads = useMemo(() => {
    const extractTarget = (raw?: SolvedScoutSquadResult) => {
      if (!raw || !Array.isArray(raw.starters) || raw.starters.length === 0) {
        return {
          starters: [] as ScoutPlayerCardItem[],
          bench: [] as ScoutPlayerCardItem[],
          xiCost: 0,
          xiBudget: 83.0,
          totalCost: 0,
          budget: 100.0,
          xiXp: 0,
          formation: '3-4-3',
        };
      }
      return {
        starters: raw.starters,
        bench: raw.bench || [],
        xiCost: raw.xiCost,
        xiBudget: raw.xiBudget,
        totalCost: raw.totalCost,
        budget: raw.budget,
        xiXp: raw.xiXp,
        formation: raw.formation,
      };
    };

    return {
      fh: extractTarget(scoutSquadsPayload?.fhTarget),
      wc: extractTarget(scoutSquadsPayload?.wcTarget),
    };
  }, [scoutSquadsPayload]);

  const picksSquad = picksType === 'FH' ? solvedScoutSquads.fh : solvedScoutSquads.wc;

  const pitchStarters = useMemo(() => {
    return {
      gks: picksSquad.starters.filter((p) => p.position === 'GKP'),
      defs: picksSquad.starters.filter((p) => p.position === 'DEF'),
      mids: picksSquad.starters.filter((p) => p.position === 'MID'),
      fwds: picksSquad.starters.filter((p) => p.position === 'FWD'),
    };
  }, [picksSquad.starters]);

  const playerProjById = useMemo(() => {
    const map = new Map<number, ProjectedPlayerCoreItem>();
    for (const p of playerProjections) {
      map.set(p.id, p);
    }
    return map;
  }, [playerProjections]);

  const playerHighlightById = useMemo(() => {
    const map = new Map<number, PlayerAvailabilityHighlight>();
    for (const ps of leagueData?.player_stats || []) {
      if (!ps || !ps.id) continue;
      const hl = resolvePlayerAvailabilityHighlight(ps, langKey);
      if (hl) {
        map.set(ps.id, hl);
      }
    }
    for (const p of playerProjections) {
      if (!p || !p.id || map.has(p.id)) continue;
      const hl = resolvePlayerAvailabilityHighlight(p, langKey);
      if (hl) {
        map.set(p.id, hl);
      }
    }
    return map;
  }, [leagueData?.player_stats, playerProjections, langKey]);

  const getPicksBreakdownRows = useCallback(
    (player: ScoutPlayerCardItem): ScoutPitchBreakdownRow[] => {
      const endGw = picksType === 'FH' ? targetNextGW : Math.min(targetNextGW + 5, 38);
      const corePlayer = playerProjById.get(player.id);
      const rows: ScoutPitchBreakdownRow[] = [];
      for (let gw = targetNextGW; gw <= endGw; gw++) {
        const cell = corePlayer?.fullSeasonPointsMap?.[gw];
        if (cell) {
          const oppText = cell.isBlank || !cell.opp || cell.opp === '-' ? 'BGW' : cell.opp;
          rows.push({
            gw,
            opp: oppText,
            xp: typeof cell.xp === 'number' ? cell.xp : 0,
          });
        } else {
          const clubMatches = sharedClubGwMatchProjections?.[`${player.teamShort}_${gw}`] || [];
          const oppText =
            clubMatches.length > 0
              ? clubMatches.map((m) => `${m.oppShort} (${m.isHome ? 'H' : 'A'})`).join(' + ')
              : '-';
          rows.push({
            gw,
            opp: oppText,
            xp: gw === targetNextGW ? player.xP1 : player.avgXp6,
          });
        }
      }
      return rows;
    },
    [picksType, targetNextGW, playerProjById, sharedClubGwMatchProjections]
  );

  const getTargetFixtureInfo = useCallback(
    (playerId: number, teamShort: string): { fixtureText: string | null; targetXp: number | null } => {
      const cell = playerProjById.get(playerId)?.fullSeasonPointsMap?.[targetNextGW];
      if (cell) {
        const fixtureText = cell.isBlank || !cell.opp || cell.opp === '-' ? 'BGW' : cell.opp;
        return {
          fixtureText,
          targetXp: typeof cell.xp === 'number' ? cell.xp : null,
        };
      }
      const clubMatches = sharedClubGwMatchProjections?.[`${teamShort}_${targetNextGW}`] || [];
      const fixtureText =
        clubMatches.length > 0
          ? clubMatches.map((m) => `${m.oppShort} (${m.isHome ? 'H' : 'A'})`).join(' + ')
          : null;
      return { fixtureText, targetXp: null };
    },
    [playerProjById, sharedClubGwMatchProjections, targetNextGW]
  );

  const handleTogglePicksBreakdown = useCallback((playerId: number) => {
    setActivePicksBreakdownId((prev) => (prev === playerId ? null : playerId));
  }, []);

  useEffect(() => {
    if (subTab !== 'picks') {
      setActivePicksBreakdownId(null);
    }
  }, [subTab, effectiveEpochKey]);

  useEffect(() => {
    if (activePicksBreakdownId === null) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-scout-breakdown-card]')) {
        setActivePicksBreakdownId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePicksBreakdownId(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePicksBreakdownId]);

  const captainPicks = useMemo(() => {
    if (subTab !== 'captain') return [];
    return scoutSquadsPayload?.captainPicks?.[langKey] || [];
  }, [subTab, scoutSquadsPayload?.captainPicks, langKey]);

  const differentialPicks = useMemo(() => {
    if (subTab !== 'differential') return [];
    if (diffMode === 'ALL') {
      return (
        scoutSquadsPayload?.differentialPicksAll?.[langKey] ||
        scoutSquadsPayload?.differentialPicks?.[langKey] ||
        []
      );
    }
    return scoutSquadsPayload?.differentialPicks?.[langKey] || [];
  }, [subTab, diffMode, scoutSquadsPayload?.differentialPicks, scoutSquadsPayload?.differentialPicksAll, langKey]);

  const activeManagerPayload = managerAnalysisQueryKey
    ? managerAnalysisMap[managerAnalysisQueryKey] || null
    : null;

  const chipsAnalysis: ServerScoutChipsAnalysis | null = activeManagerPayload?.chips || null;
  const transferRecommendation: ServerScoutTransferAnalysis | null = activeManagerPayload?.transfer || null;
  const ftAllowance = activeManagerPayload?.ftAllowance ?? 1;

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-3 space-y-3">
      {/* ======================================================== */}
      {/* 1. SUBTAB: PICKS                                         */}
      {/* ======================================================== */}
      {subTab === 'picks' && (() => {
        const picksEndGw = Math.min(targetNextGW + 5, 38);
        const picksGwLabel =
          picksType === 'FH' || picksEndGw <= targetNextGW
            ? `GW ${targetNextGW}`
            : `GW ${targetNextGW}–${picksEndGw}`;

        return (
        <div className="space-y-2">
          {/* Compact Switcher, Dual Budget Status (£83.0m XI / £100.0m Squad / Max 3 Club) & Target GW Badge */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 bg-white dark:bg-[#1a0f2e] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="order-1 flex items-center gap-1 shrink-0">
              <button
                onClick={() => setPicksType('FH')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wider transition-all cursor-pointer ${
                  picksType === 'FH'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                FREE HIT
              </button>
              <button
                onClick={() => setPicksType('WC')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wider transition-all cursor-pointer ${
                  picksType === 'WC'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                WILDCARD
              </button>
            </div>

            {/* Compact Formation, XI xP & Dual Budget Status */}
            <div className="order-3 sm:order-2 w-full sm:w-auto sm:ml-auto flex flex-wrap items-center justify-between sm:justify-end gap-1.5 text-[11px] font-extrabold text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-white/5 pt-1.5 sm:border-t-0 sm:pt-0">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-[10px] font-black text-slate-600 dark:text-slate-300">
                  {picksSquad.formation}
                </span>
                <span className="font-mono font-black text-[#37003c] dark:text-[#00ff87]">
                  {picksSquad.xiXp.toFixed(1)} xP
                </span>
              </div>
              <span className="hidden sm:inline text-slate-300 dark:text-white/15">•</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300" title="Starting XI Limit £83.0m">
                  XI <span className="text-emerald-600 dark:text-[#00ff87] font-black">£{picksSquad.xiCost.toFixed(1)}m</span>/{picksSquad.xiBudget.toFixed(0)}m
                </span>
                <span className="text-slate-300 dark:text-white/15">•</span>
                <span className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300" title="Overall Squad Limit £100.0m • Max 3/club">
                  15 <span className="text-emerald-600 dark:text-[#00ff87] font-black">£{picksSquad.totalCost.toFixed(1)}m</span>/{picksSquad.budget.toFixed(0)}m
                </span>
              </div>
            </div>

            <span
              title={
                picksType === 'FH'
                  ? (isId ? `Target Free Hit: ${picksGwLabel}` : `Free Hit Target: ${picksGwLabel}`)
                  : (isId ? `Target Wildcard: ${picksGwLabel}` : `Wildcard Target: ${picksGwLabel}`)
              }
              className="order-2 sm:order-3 px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
            >
              {picksGwLabel}
            </span>
          </div>

          {/* Regulation Pitch View (Compact & 5-Across Single Row Guaranteed) */}
          {(() => {
            const isBenchBreakdownOpen =
              activePicksBreakdownId !== null && picksSquad.bench.some((p) => p.id === activePicksBreakdownId);
            const isStarterBreakdownOpen = activePicksBreakdownId !== null && !isBenchBreakdownOpen;
            return (
          <div className={`relative w-full max-w-4xl mx-auto rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-xl ${activePicksBreakdownId !== null ? 'z-40' : 'z-20'}`}>
            {isLoadingScoutSquads && picksSquad.starters.length === 0 ? (
              <div className="bg-[#00aa52] rounded-t-2xl py-16 px-4 text-center text-white text-xs font-bold">
                {isId ? 'Memuat optimasi skuad terbaik...' : 'Loading optimal squad...'}
              </div>
            ) : null}
            {/* Pitch Grass Surface (overflow-visible so Quick xP Breakdown Popups never clip) */}
            <div className={`relative w-full pt-3 sm:pt-4 pb-3.5 sm:pb-5 px-1.5 sm:px-3 bg-[#00aa52] rounded-t-2xl select-none ${isStarterBreakdownOpen ? 'z-30' : 'z-10'}`}>
              {/* 10 Alternating Horizontal Lawn Mowing Stripes */}
              <div
                className="absolute inset-0 flex flex-col pointer-events-none overflow-hidden rounded-t-2xl"
                style={{ clipPath: 'polygon(6% 0%, 94% 0%, 98.5% 100%, 1.5% 100%)' }}
              >
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 w-full ${i % 2 === 0 ? 'bg-[#00c261]' : 'bg-[#00aa52]'}`}
                  />
                ))}
              </div>

              {/* Pitch Markings SVG */}
              <div className="absolute inset-0 overflow-hidden rounded-t-2xl pointer-events-none">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 1200">
                  <line x1="70" y1="0" x2="930" y2="0" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <line x1="70" y1="0" x2="15" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
                  <line x1="930" y1="0" x2="985" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
                  <polyline points="245,0 239.8,190 760.2,190 755,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <polyline points="384.3,0 383.5,65 616.5,65 615.7,0" fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="3" />
                  <circle cx="500" cy="127" r="4.5" fill="rgba(255,255,255,0.95)" />
                  <path d="M 445,190 A 85,55 0 0,0 555,190" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <line x1="23.25" y1="1020" x2="976.75" y2="1020" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <ellipse cx="500" cy="1020" rx="145" ry="90" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <circle cx="500" cy="1020" r="5" fill="rgba(255,255,255,0.95)" />
                </svg>
              </div>

              {/* Pitch Players Grid */}
              <div className={`relative ${isStarterBreakdownOpen ? 'z-40' : 'z-10'} space-y-2.5 sm:space-y-3.5`}>
                {/* 1. GKP */}
                <div className="flex justify-center items-center gap-1.5 sm:gap-3 flex-nowrap">
                  {pitchStarters.gks.map((p) => (
                    <ScoutPitchCard
                      key={p.id}
                      player={p}
                      picksType={picksType}
                      isId={isId}
                      availabilityHighlight={playerHighlightById.get(p.id)}
                      isBreakdownOpen={activePicksBreakdownId === p.id}
                      breakdownRows={activePicksBreakdownId === p.id ? getPicksBreakdownRows(p) : undefined}
                      onToggleBreakdown={handleTogglePicksBreakdown}
                      onSelectPlayer={() => onSelectPlayer?.(p.id)}
                    />
                  ))}
                </div>

                {/* 2. DEF (Up to 5 in 1 single horizontal row) */}
                <div className="flex justify-center items-center gap-1 sm:gap-2.5 md:gap-3.5 flex-nowrap">
                  {pitchStarters.defs.map((p) => (
                    <ScoutPitchCard
                      key={p.id}
                      player={p}
                      picksType={picksType}
                      isId={isId}
                      availabilityHighlight={playerHighlightById.get(p.id)}
                      isBreakdownOpen={activePicksBreakdownId === p.id}
                      breakdownRows={activePicksBreakdownId === p.id ? getPicksBreakdownRows(p) : undefined}
                      onToggleBreakdown={handleTogglePicksBreakdown}
                      onSelectPlayer={() => onSelectPlayer?.(p.id)}
                    />
                  ))}
                </div>

                {/* 3. MID (Up to 5 in 1 single horizontal row) */}
                <div className="flex justify-center items-center gap-1 sm:gap-2.5 md:gap-3.5 flex-nowrap">
                  {pitchStarters.mids.map((p) => (
                    <ScoutPitchCard
                      key={p.id}
                      player={p}
                      picksType={picksType}
                      isId={isId}
                      availabilityHighlight={playerHighlightById.get(p.id)}
                      isBreakdownOpen={activePicksBreakdownId === p.id}
                      breakdownRows={activePicksBreakdownId === p.id ? getPicksBreakdownRows(p) : undefined}
                      onToggleBreakdown={handleTogglePicksBreakdown}
                      onSelectPlayer={() => onSelectPlayer?.(p.id)}
                    />
                  ))}
                </div>

                {/* 4. FWD (Up to 3 in 1 single horizontal row) */}
                <div className="flex justify-center items-center gap-1 sm:gap-2.5 md:gap-3.5 flex-nowrap">
                  {pitchStarters.fwds.map((p) => (
                    <ScoutPitchCard
                      key={p.id}
                      player={p}
                      picksType={picksType}
                      isId={isId}
                      availabilityHighlight={playerHighlightById.get(p.id)}
                      isBreakdownOpen={activePicksBreakdownId === p.id}
                      breakdownRows={activePicksBreakdownId === p.id ? getPicksBreakdownRows(p) : undefined}
                      onToggleBreakdown={handleTogglePicksBreakdown}
                      onSelectPlayer={() => onSelectPlayer?.(p.id)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Bench Dugout (4 players cleanly on 1 row) */}
            <div className={`relative bg-[#005a2b] border-t border-[#007038] rounded-b-2xl px-1.5 sm:px-3 py-2 ${isBenchBreakdownOpen ? 'z-40' : 'z-20'}`}>
              <div className={`relative ${isBenchBreakdownOpen ? 'z-40' : 'z-10'} flex justify-center items-start gap-1.5 sm:gap-4 flex-nowrap`}>
                {picksSquad.bench.map((p) => (
                  <ScoutPitchCard
                    key={p.id}
                    player={p}
                    picksType={picksType}
                    isId={isId}
                    isBench
                    availabilityHighlight={playerHighlightById.get(p.id)}
                    isBreakdownOpen={activePicksBreakdownId === p.id}
                    breakdownRows={activePicksBreakdownId === p.id ? getPicksBreakdownRows(p) : undefined}
                    onToggleBreakdown={handleTogglePicksBreakdown}
                    onSelectPlayer={() => onSelectPlayer?.(p.id)}
                  />
                ))}
              </div>
            </div>
          </div>
            );
          })()}
        </div>
        );
      })()}

      {/* ======================================================== */}
      {/* 2. SUBTAB: CAPTAIN                                       */}
      {/* ======================================================== */}
      {subTab === 'captain' && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <span
              title={isId ? `Target Kapten: GW ${targetNextGW}` : `Captain Target: GW ${targetNextGW}`}
              className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
            >
              GW {targetNextGW}
            </span>
          </div>
          {isLoadingScoutSquads && captainPicks.length === 0 ? (
            <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
              {isId ? 'Memuat peringkat kapten terbaik dari server...' : 'Loading captain rankings from server...'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {captainPicks.map((p) => {
                const { fixtureText, targetXp } = getTargetFixtureInfo(p.id, p.teamShort);
                const availHl = playerHighlightById.get(p.id);
                return (
                <div
                  key={p.id}
                  onClick={() => onSelectPlayer?.(p.id)}
                  className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3 shadow-sm hover:border-[#00ff87]/60 transition-all cursor-pointer flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-lg bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] flex items-center justify-center text-xs font-black shrink-0">
                        {p.rank}
                      </span>
                      <div className="min-w-0">
                        <h4
                          className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight flex items-center gap-1 min-w-0"
                          title={availHl?.tooltip}
                        >
                          <span className="truncate">{p.webName}</span>
                          {availHl && <PlayerAvailabilityFlag highlight={availHl} />}
                        </h4>
                        <div className="text-[11px] font-bold text-slate-400">
                          {p.clubName} • {p.position} • £{p.cost.toFixed(1)}m
                        </div>
                        {(fixtureText || targetXp !== null) && (
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-bold mt-0.5">
                            {fixtureText && (
                              <span className="text-slate-700 dark:text-slate-200 font-extrabold">
                                {fixtureText === 'BGW' ? 'BGW' : `vs ${fixtureText}`}
                              </span>
                            )}
                            {fixtureText && targetXp !== null && (
                              <span className="text-slate-400">•</span>
                            )}
                            {targetXp !== null && (
                              <span className="text-emerald-600 dark:text-[#00ff87] font-mono font-black">
                                {targetXp.toFixed(1)} xP
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Clean Rating Badge */}
                    <div className="flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md text-xs font-black shrink-0">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{p.rating}</span>
                    </div>
                  </div>

                  {/* 1 Paragraph Narrative */}
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {p.narrative}
                  </p>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. SUBTAB: DIFFERENTIAL                                  */}
      {/* ======================================================== */}
      {subTab === 'differential' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#1a0f2e] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setDiffMode('EXCLUDE')}
                title={
                  isId
                    ? 'Tampilkan 3 differential <5% di luar skuad Picks (FH/WC) & Captain'
                    : 'Show top 3 <5% differentials outside Picks (FH/WC) & Captain'
                }
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wide transition-all cursor-pointer ${
                  diffMode === 'EXCLUDE'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                Exclude Picks &amp; (C)
              </button>
              <button
                type="button"
                onClick={() => setDiffMode('ALL')}
                title={
                  isId
                    ? 'Tampilkan semua 3 differential <5% terbaik termasuk Picks & Captain'
                    : 'Show all top 3 <5% differentials including Picks & Captain'
                }
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wide transition-all cursor-pointer ${
                  diffMode === 'ALL'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                All
              </button>
            </div>

            <span
              title={isId ? `Target Differential: GW ${targetNextGW}` : `Differential Target: GW ${targetNextGW}`}
              className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
            >
              GW {targetNextGW}
            </span>
          </div>
          {isLoadingScoutSquads && differentialPicks.length === 0 ? (
            <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
              {isId ? 'Memuat kandidat differential dari server...' : 'Loading differential picks from server...'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {differentialPicks.map((p) => {
                const { fixtureText, targetXp } = getTargetFixtureInfo(p.id, p.teamShort);
                const availHl = playerHighlightById.get(p.id);
                return (
                <div
                  key={p.id}
                  onClick={() => onSelectPlayer?.(p.id)}
                  className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3.5 shadow-sm hover:border-[#00ff87]/60 transition-all cursor-pointer flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-[#00ff87] flex items-center justify-center text-xs font-black shrink-0">
                        {p.rank}
                      </span>
                      <div className="min-w-0">
                        <h4
                          className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight flex items-center gap-1 min-w-0"
                          title={availHl?.tooltip}
                        >
                          <span className="truncate">{p.webName}</span>
                          {availHl && <PlayerAvailabilityFlag highlight={availHl} />}
                        </h4>
                        <div className="text-[11px] font-bold text-slate-400">
                          {p.clubName} • {p.position} • £{p.cost.toFixed(1)}m
                        </div>
                        {(fixtureText || targetXp !== null) && (
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-bold mt-0.5">
                            {fixtureText && (
                              <span className="text-slate-700 dark:text-slate-200 font-extrabold">
                                {fixtureText === 'BGW' ? 'BGW' : `vs ${fixtureText}`}
                              </span>
                            )}
                            {fixtureText && targetXp !== null && (
                              <span className="text-slate-400">•</span>
                            )}
                            {targetXp !== null && (
                              <span className="text-emerald-600 dark:text-[#00ff87] font-mono font-black">
                                {targetXp.toFixed(1)} xP
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ownership & Rating Badges */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-black text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">
                        {p.fnbOwn.toFixed(1)}%
                      </span>
                      <div className="flex items-center gap-1 bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded text-xs font-black">
                        <Star className="w-3 h-3 fill-current" />
                        <span>{p.rating}</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {p.narrative}
                  </p>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. SUBTAB: CHIPS                                         */}
      {/* ======================================================== */}
      {subTab === 'chips' && (() => {
        const chipColors: Record<'WC' | 'TC' | 'BB' | 'FH', { dot: string; active: string }> = {
          WC: {
            dot: 'bg-purple-600 dark:bg-purple-400',
            active: 'bg-purple-50/70 text-[#37003c] border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-400/30',
          },
          TC: {
            dot: 'bg-amber-500 dark:bg-amber-400',
            active: 'bg-amber-50/70 text-amber-900 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30',
          },
          BB: {
            dot: 'bg-blue-600 dark:bg-blue-400',
            active: 'bg-blue-50/70 text-blue-900 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-400/30',
          },
          FH: {
            dot: 'bg-teal-600 dark:bg-teal-400',
            active: 'bg-teal-50/70 text-teal-900 border-teal-200 dark:bg-teal-500/15 dark:text-teal-200 dark:border-teal-400/30',
          },
        };

        return (
          <div className="space-y-2">
            <div className="flex justify-end">
              <span
                title={isId ? `Target Evaluasi Chip: GW ${targetNextGW}` : `Chip Evaluation Target: GW ${targetNextGW}`}
                className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
              >
                GW {targetNextGW}
              </span>
            </div>

            {resolvedEntryId <= 0 ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                Please select a team profile in Settings first to view your personalized Chips analysis.
              </div>
            ) : !chipsAnalysis ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                {isLoadingManagerAnalysis
                  ? (isId ? 'Menghitung jadwal chip optimal di server...' : 'Computing optimal chip schedule on server...')
                  : (isId ? 'Data analisis chip belum tersedia.' : 'Chip analysis data unavailable.')}
              </div>
            ) : (
              <div className="w-full space-y-3 text-center">
                {/* Minimalist 1 Set Chip (4 kapsul ukuran sama, full width sejajar grid Captain/Differential) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                  {chipsAnalysis.chipSet.map((chip) => {
                    const isUsed = Boolean(chip.used);
                    const color = chipColors[chip.key];

                    return (
                      <div
                        key={chip.short}
                        title={
                          chip.used
                            ? `${chip.name} — ${isId ? 'Sudah digunakan' : 'Used'} (GW ${chip.used.gw}${chip.used.points ? ` • ${chip.used.points} pts` : ''})`
                            : `${chip.name} — ${isId ? 'Belum digunakan' : 'Available'}`
                        }
                        className={`w-full px-2.5 py-2 rounded-xl border text-[11px] font-bold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors ${
                          isUsed
                            ? 'bg-slate-100/70 dark:bg-white/[0.02] border-dashed border-slate-300 dark:border-white/15 text-slate-400 dark:text-slate-500 opacity-65'
                            : color.active
                        }`}
                      >
                        {isUsed ? (
                          <X className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                        ) : (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.dot}`} />
                        )}
                        <span className={isUsed ? 'line-through' : ''}>{chip.name}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Recommendation / Status Card */}
                {chipsAnalysis.needChip ? (
                  <div className="bg-white dark:bg-[#1a0f2e] border border-emerald-500/30 dark:border-[#00ff87]/30 rounded-xl p-5 w-full shadow-sm space-y-2.5">
                    <div className="w-11 h-11 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 dark:text-[#00ff87] flex items-center justify-center">
                      <Zap className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                      {chipsAnalysis.chipName}
                    </h3>
                    <div className="inline-flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-[#00ff87] bg-emerald-500/10 px-3 py-1 rounded-full">
                      <span>
                        +{chipsAnalysis.gain.toFixed(1)} xP{chipsAnalysis.chipName === 'Wildcard' ? '/GW' : ''} projected gain
                      </span>
                    </div>
                    {chipsAnalysis.comboPlan && (
                      <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/10 text-[#37003c] dark:text-[#00ff87] border border-purple-500/20 dark:border-[#00ff87]/25">
                          <ArrowRight className="w-3 h-3 shrink-0" />
                          {chipsAnalysis.comboPlan.nextChipName} GW {chipsAnalysis.comboPlan.nextGw} (+{chipsAnalysis.comboPlan.nextGain.toFixed(1)} xP)
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-5 w-full shadow-sm space-y-2">
                    <div className="w-11 h-11 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 dark:text-[#00ff87] flex items-center justify-center">
                      <CheckCircle className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200">
                      You're good to go
                    </h3>
                  </div>
                )}

                {/* FPL Scout Editorial Narrative */}
                {chipsAnalysis.openingNarrative && (
                  <div className="w-full text-left bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-4 sm:p-5 space-y-3 shadow-sm text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {chipsAnalysis.openingNarrative}
                    </p>
                    {chipsAnalysis.chipParagraphs.map((para) => (
                      <p key={para.chipKey || para.text.slice(0, 20)}>
                        {para.chipLead && (
                          <strong className="font-bold text-slate-900 dark:text-white">
                            {para.chipLead}{' '}
                          </strong>
                        )}
                        {para.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ======================================================== */}
      {/* 5. SUBTAB: TRANSFER                                      */}
      {/* ======================================================== */}
      {subTab === 'transfer' && (() => {
        const horizonCount = transferRecommendation?.horizonCount ?? Math.min(transferHorizon, Math.max(1, 38 - targetNextGW + 1));
        const horizonEndGw = transferRecommendation?.horizonEndGw ?? Math.min(targetNextGW + horizonCount - 1, 38);
        const transferGwLabel =
          horizonCount === 1 || horizonEndGw <= targetNextGW
            ? `GW ${targetNextGW}`
            : `GW ${targetNextGW}–${horizonEndGw}`;

        return (
        <div className="space-y-2">
          {/* Controls Bar: 1 unified bar (left: FT Only / Allow Hits, right: 1 GW / 3 GW / 6 GW) */}
          <div className="w-full flex items-center justify-between gap-2 bg-white dark:bg-[#1a0f2e] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setTransferMode('FT')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wide transition-all cursor-pointer ${
                  transferMode === 'FT'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                FT Only
              </button>
              <button
                type="button"
                onClick={() => setTransferMode('HIT')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wide transition-all cursor-pointer ${
                  transferMode === 'HIT'
                    ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                Allow Hits
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {([1, 3, 6] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setTransferHorizon(h)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-wide transition-all cursor-pointer ${
                    transferHorizon === h
                      ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                >
                  {h} GW
                </button>
              ))}
            </div>
          </div>

          {/* Full-Width Content Card (Sejajar Captain & Differential) */}
          <div className="w-full text-center">
            {resolvedEntryId <= 0 ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                Please select a team profile in Settings first to view your personalized Transfer recommendations.
              </div>
            ) : !transferRecommendation ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl py-10 px-4 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                {isLoadingManagerAnalysis
                  ? (isId ? 'Menjalankan simulasi transfer optimal di server...' : 'Running transfer optimization on server...')
                  : (isId ? 'Data rekomendasi transfer belum tersedia.' : 'Transfer recommendation unavailable.')}
              </div>
            ) : transferRecommendation.needTransfer && transferRecommendation.moves.length > 0 ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3.5 sm:p-4 w-full shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider">
                    <span className={transferRecommendation.hitCount > 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-[#00ff87]'}>
                      {transferRecommendation.hitCount > 0
                        ? `${transferRecommendation.ftUsed} FT + ${transferRecommendation.hitCount}x HIT (-${transferRecommendation.hitCost})`
                        : `${transferRecommendation.ftUsed} / ${ftAllowance} FT`}
                    </span>
                    <span className="text-slate-400 font-mono font-bold normal-case tracking-normal">
                      • {transferRecommendation.moves.length} {transferRecommendation.moves.length === 1 ? 'Transfer' : 'Transfers'}
                    </span>
                  </div>
                  <span
                    title={isId ? `Rentang Target Transfer: ${transferGwLabel}` : `Transfer Target Range: ${transferGwLabel}`}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
                  >
                    {transferGwLabel}
                  </span>
                </div>

                {/* Compact Starting XI xP & Bank (Awal -> Akhir) */}
                <div className="grid grid-cols-2 gap-2 text-left">
                  <div className="bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-100 dark:border-white/5 flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-400">
                      XI xP
                    </span>
                    <span className="text-[11px] font-black text-slate-800 dark:text-white font-mono flex items-center gap-1">
                      <span>{transferRecommendation.startXiXpH.toFixed(1)}</span>
                      <ArrowRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                      <span className="text-emerald-600 dark:text-[#00ff87]">
                        {transferRecommendation.endXiXpH.toFixed(1)}
                      </span>
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-lg border border-slate-100 dark:border-white/5 flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-400">
                      Bank
                    </span>
                    <span className="text-[11px] font-black text-slate-800 dark:text-white font-mono flex items-center gap-1">
                      <span>£{transferRecommendation.startBank.toFixed(1)}m</span>
                      <ArrowRight className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                      <span>£{transferRecommendation.endBank.toFixed(1)}m</span>
                    </span>
                  </div>
                </div>

                {/* Compact Moves List */}
                <div className="space-y-1.5">
                  {transferRecommendation.moves.map((m) => {
                    const outHl = playerHighlightById.get(m.out.id);
                    const inHl = playerHighlightById.get(m.in.id);
                    return (
                    <div
                      key={`${m.out.id}-${m.in.id}`}
                      className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-xl border border-slate-100 dark:border-white/5"
                    >
                      <div
                        onClick={() => onSelectPlayer?.(m.out.id)}
                        title={outHl?.tooltip}
                        className="flex-1 text-left cursor-pointer min-w-0"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-black uppercase text-rose-500">
                            OUT{m.isHit ? ' (-4)' : ''}
                          </span>
                          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1 min-w-0">
                            <span className="truncate">{m.out.webName}</span>
                            {outHl && <PlayerAvailabilityFlag highlight={outHl} />}
                          </h4>
                        </div>
                        <span
                          title={
                            m.out.sellingPrice !== undefined && Math.abs(m.out.sellingPrice - m.out.cost) >= 0.05
                              ? (isId
                                  ? `Harga jual £${m.out.sellingPrice.toFixed(1)}m (harga pasar £${m.out.cost.toFixed(1)}m — aturan 50% FPL)`
                                  : `Selling price £${m.out.sellingPrice.toFixed(1)}m (market £${m.out.cost.toFixed(1)}m — 50% FPL rule)`)
                              : undefined
                          }
                          className="text-[10px] text-slate-400 font-mono"
                        >
                          £{(m.out.sellingPrice ?? m.out.cost).toFixed(1)}m • {m.out.effXpH.toFixed(1)} pts
                        </span>
                      </div>

                      <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

                      <div
                        onClick={() => onSelectPlayer?.(m.in.id)}
                        title={inHl?.tooltip}
                        className="flex-1 text-right cursor-pointer min-w-0"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center justify-end gap-1 min-w-0">
                            <span className="truncate">{m.in.webName}</span>
                            {inHl && <PlayerAvailabilityFlag highlight={inHl} />}
                          </h4>
                          <span className="text-[9px] font-black uppercase text-emerald-500">IN</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          £{m.in.cost.toFixed(1)}m • {m.in.effXpH.toFixed(1)} pts
                        </span>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Editorial FPL Narrative */}
                <div className="space-y-2 text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed text-left bg-slate-50/70 dark:bg-black/20 p-3.5 sm:p-4 rounded-xl border border-slate-100 dark:border-white/5">
                  {transferRecommendation.reasonParagraphs.map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
                </div>

                <div className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-[#00ff87] bg-emerald-500/10 px-2.5 py-0.5 rounded-full">
                  <span>
                    +{transferRecommendation.netGain} pts net ({transferRecommendation.horizonLabel})
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3.5 sm:p-4 w-full shadow-sm space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-[#00ff87]">
                    0 / {ftAllowance} FT
                  </span>
                  <span
                    title={isId ? `Rentang Target Transfer: ${transferGwLabel}` : `Transfer Target Range: ${transferGwLabel}`}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0"
                  >
                    {transferGwLabel}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-[#00ff87] flex items-center justify-center shrink-0">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                    You're good to go
                  </h3>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  <span>
                    XI xP: {transferRecommendation.startXiXpH.toFixed(1)} → {transferRecommendation.endXiXpH.toFixed(1)}
                  </span>
                  <span>
                    Bank: £{transferRecommendation.startBank.toFixed(1)}m → £{transferRecommendation.endBank.toFixed(1)}m
                  </span>
                </div>
                {transferRecommendation.reasonParagraphs.length > 0 && (
                  <div className="space-y-2 text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed text-left bg-slate-50/70 dark:bg-black/20 p-3.5 sm:p-4 rounded-xl border border-slate-100 dark:border-white/5">
                    {transferRecommendation.reasonParagraphs.map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

// ==========================================
// PITCH PLAYER CARD COMPONENT
// ==========================================
interface ScoutPitchBreakdownRow {
  gw: number;
  opp: string;
  xp: number;
}

interface ScoutPitchCardProps {
  player: ScoutPlayerCardItem;
  picksType: 'FH' | 'WC';
  isId: boolean;
  isBench?: boolean;
  availabilityHighlight?: PlayerAvailabilityHighlight;
  isBreakdownOpen?: boolean;
  breakdownRows?: ScoutPitchBreakdownRow[];
  onToggleBreakdown?: (playerId: number) => void;
  onSelectPlayer?: () => void;
}

const ScoutPitchCard: React.FC<ScoutPitchCardProps> = ({
  player,
  picksType,
  isId,
  isBench = false,
  availabilityHighlight,
  isBreakdownOpen = false,
  breakdownRows,
  onToggleBreakdown,
  onSelectPlayer,
}) => {
  const displayXp = picksType === 'FH' ? player.xP1 : player.avgXp6;
  const breakdownTooltip = isId
    ? 'Klik kotak nama / angka xP untuk melihat breakdown xP per GW'
    : 'Click player name or xP box to view GW xP breakdown';
  const nameTooltip = availabilityHighlight
    ? `${player.webName} — ${availabilityHighlight.tooltip} (${breakdownTooltip})`
    : breakdownTooltip;

  return (
    <div
      data-scout-breakdown-card={player.id}
      className={`relative flex flex-col items-center justify-center select-none min-w-0 shrink-0 ${
        isBreakdownOpen ? 'z-50' : 'z-10'
      } w-[calc((100%-16px)/5)] max-w-[82px] sm:max-w-none sm:w-22 md:w-24`}
    >
      {/* Kit / Player Photo - Klik membuka modal detail pemain */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectPlayer?.();
        }}
        title={availabilityHighlight ? `${player.webName} — ${availabilityHighlight.tooltip}` : player.webName}
        className="relative z-0 w-[54px] h-[54px] max-w-full sm:w-16 sm:h-16 md:w-[74px] md:h-[74px] flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
      >
        {player.photo ? (
          <img
            src={player.photo}
            alt={player.webName}
            className="w-full h-full object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-[10px] font-black text-white">
            {player.position}
          </div>
        )}
      </div>

      {/* Strip Area (Dark Premier League Purple/Black Name Strip + Neon Green Cost & xP Strip) */}
      <div className="relative z-10 w-full">
        {/* QUICK xP BREAKDOWN POPUP (MENEMPEL TEPAT DI ATAS BOX NAMA, LEBAR SAMA / MIN-W-FULL, BORDER TIPIS 3 SISI) */}
        {isBreakdownOpen && breakdownRows && breakdownRows.length > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-full left-1/2 -translate-x-1/2 min-w-full w-max max-w-[148px] sm:max-w-[172px] bg-[#1e0026]/95 dark:bg-[#12001a]/95 backdrop-blur-md rounded-t shadow-2xl px-1.5 sm:px-2 py-1 z-50 animate-in fade-in duration-75 border-t border-x border-purple-500/40 border-b-0"
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 sm:gap-x-2 gap-y-1 text-[8px] sm:text-[9.5px] md:text-[10.5px] font-mono leading-tight">
              {breakdownRows.map((row, idx, arr) => {
                const isLast = idx === arr.length - 1;
                const borderClass = isLast ? '' : 'border-b border-purple-900/30 pb-[1.5px]';
                return (
                  <React.Fragment key={row.gw}>
                    {/* Kolom 1: GW (e.g. GW12) */}
                    <span className={`text-left font-black text-[#00ff87] tracking-tight whitespace-nowrap ${borderClass}`}>
                      GW{row.gw}
                    </span>
                    {/* Kolom 2: Opponent H/A (e.g. MCI (H)) */}
                    <span className={`text-center font-bold text-slate-200 whitespace-nowrap truncate max-w-[88px] sm:max-w-[115px] ${borderClass}`}>
                      {row.opp}
                    </span>
                    {/* Kolom 3: xP */}
                    <span
                      className={`text-right font-black whitespace-nowrap ${borderClass} ${
                        row.xp > 0 ? 'text-[#00ff87]' : 'text-slate-300'
                      }`}
                    >
                      {row.xp.toFixed(1)}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Name Strip (Dark Premier League Purple/Black) - Klik toggle popup xP */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleBreakdown?.(player.id);
          }}
          title={nameTooltip}
          className="w-full bg-[#37003c] hover:bg-[#4d0054] text-white text-center py-0.5 px-1 rounded-t-md mt-0.5 shadow-md transition-colors flex items-center justify-center gap-0.5 text-[9px] sm:text-[10.5px] font-extrabold leading-tight cursor-pointer min-w-0"
        >
          <span className="truncate">{player.webName}</span>
          {availabilityHighlight && <PlayerAvailabilityFlag highlight={availabilityHighlight} />}
        </div>

        {/* Cost & Projected Points Strip (Neon Green) - Klik toggle popup xP */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleBreakdown?.(player.id);
          }}
          title={breakdownTooltip}
          className="w-full bg-[#00ff87] hover:bg-[#2eff9e] text-[#37003c] text-center py-0.5 px-1 rounded-b-md flex items-center justify-between font-black text-[8.5px] sm:text-[9.5px] leading-tight transition-colors cursor-pointer"
        >
          <span>£{player.cost.toFixed(1)}</span>
          <span>{displayXp}</span>
        </div>
      </div>
    </div>
  );
};
