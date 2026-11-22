import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ScoutSubTab,
  TransformedLeagueData,
  GwEventStatus,
  SyncStatus,
  PlayerOwnershipItem,
  ProjectionClubItem,
  ClubNextMatchEntry,
  ScheduleFixtureSummary,
  ClubGwMatchProjectionItem,
  ProjectedPlayerCoreItem,
  ProjectedFixtureOutcome,
  ServerScoutSquadsPayload,
  SolvedScoutSquadResult,
  FplProvenStatus,
  DeadBallDutyStatus,
  PlayerGwProjectionCell,
} from '../types.ts';
import { useUserProfileId } from '../utils/userProfile.ts';
import { useLanguage } from '../utils/i18n.ts';
import {
  generateCaptainArticlePicks,
  generateDifferentialArticlePicks,
  resolveClubName,
  MatchProjInput,
} from '../utils/scoutNarratives.ts';
import { Star, ArrowRight, Zap, CheckCircle, X } from 'lucide-react';
import { PROJECTION_FORMULA_VERSION } from '../utils/projectionModel.ts';
import { loadScoutSquadsFromIndexedDB, saveScoutSquadsToIndexedDB } from '../storage.ts';

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

const DEFAULT_UNPROVEN_STATUS: FplProvenStatus = {
  isProven: false,
  tier: 'REGULAR',
  score: 0,
  guardFactor: 0,
  maxBlankDropPenalty: -0.60,
  provenXpFloor: 0,
  badgeLabel: '',
  badgeClass: '',
  pastPoints: 0,
  pastMinutes: 0,
  returnRate: 0,
  doubleDigitHauls: 0,
  guardDescription: '',
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
  sharedClubs,
  sharedBaseHistoricalGW,
  sharedTargetNextGW,
  sharedClubNextMatchesMap,
  sharedClubGwMatchProjections,
  playerProjections,
  sharedScoutSquads,
  isLoadingSharedScoutSquads = false,
}) => {
  const { language } = useLanguage();
  // FNB League default ('fnb') and Indonesian ('id') both use Bahasa Indonesia for narratives
  const isId = language !== 'en';
  const profileId = useUserProfileId();

  const [formulaRevision, setFormulaRevision] = useState<number>(0);
  const [narrativeFns, setNarrativeFns] = useState(() => ({
    generateCaptainArticlePicks,
    generateDifferentialArticlePicks,
    resolveClubName,
  }));

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

  // Resolve effective populated GW keys (resilient during live GW rollover before new picks finish syncing)
  const effectiveStandingsGW = useMemo(() => {
    if (leagueData?.standings?.[currentGW]?.length) return currentGW;
    if (leagueData?.standings?.[baseHistoricalGW]?.length) return baseHistoricalGW;
    const keys = Object.keys(leagueData?.standings || {})
      .map(Number)
      .filter((n) => !isNaN(n) && (leagueData?.standings?.[n]?.length || 0) > 0);
    return keys.length > 0 ? Math.max(...keys) : currentGW;
  }, [leagueData?.standings, currentGW, baseHistoricalGW]);

  const effectiveOwnershipGW = useMemo(() => {
    if (leagueData?.ownership_players?.[currentGW]?.length) return currentGW;
    if (leagueData?.ownership_players?.[baseHistoricalGW]?.length) return baseHistoricalGW;
    const keys = Object.keys(leagueData?.ownership_players || {})
      .map(Number)
      .filter((n) => !isNaN(n) && (leagueData?.ownership_players?.[n]?.length || 0) > 0);
    return keys.length > 0 ? Math.max(...keys) : currentGW;
  }, [leagueData?.ownership_players, currentGW, baseHistoricalGW]);

  // 1. Identify active profile manager
  const activeManager = useMemo(() => {
    const standingsList = leagueData?.standings?.[effectiveStandingsGW] || [];
    if (standingsList.length === 0) return null;
    if (profileId) {
      const found = standingsList.find((m) => m.entry_id === profileId);
      if (found) return found;
    }
    return standingsList[0] || null;
  }, [leagueData?.standings, effectiveStandingsGW, profileId]);

  // Active manager squad from latest snapshot
  const activeSquad = useMemo(() => {
    if (!activeManager || !leagueData?.ownership_players) return [];
    const list = leagueData.ownership_players[effectiveOwnershipGW] || [];
    const matched: Array<{
      player: PlayerOwnershipItem;
      position_in_squad: number;
      is_starter: boolean;
    }> = [];

    for (const p of list) {
      if (p.owners && Array.isArray(p.owners)) {
        const o = p.owners.find((owner) => owner.entry_id === activeManager.entry_id);
        if (o) {
          matched.push({
            player: p,
            position_in_squad: o.position_in_squad,
            is_starter: o.is_starter,
          });
        }
      }
    }

    matched.sort((a, b) => a.position_in_squad - b.position_in_squad);
    return matched;
  }, [activeManager, leagueData?.ownership_players, effectiveOwnershipGW]);

  // Squad Value of active manager
  const activeSquadValue = useMemo(() => {
    if (activeSquad.length === 0) return 100.0;
    const totalCost = activeSquad.reduce((sum, item) => sum + (item.player.now_cost || 0), 0);
    return Math.max(100.0, Math.round((totalCost / 10) * 10) / 10);
  }, [activeSquad]);

  // Total Managers in League for FNB ownership calculation
  const totalManagersCount = useMemo(() => {
    const count = leagueData?.standings?.[effectiveStandingsGW]?.length;
    return count && count > 0 ? count : 97;
  }, [leagueData?.standings, effectiveStandingsGW]);

  // Map of player ID to FNB League ownership %
  const fnbOwnershipMap = useMemo(() => {
    const map = new Map<number, number>();
    const list = (leagueData?.ownership_players && leagueData.ownership_players[effectiveOwnershipGW]) || [];
    for (const p of list) {
      const count = p.owners ? p.owners.length : (p.owned_count || 0);
      const pct = (count / totalManagersCount) * 100;
      map.set(p.id, Math.round(pct * 10) / 10);
    }
    return map;
  }, [leagueData?.ownership_players, effectiveOwnershipGW, totalManagersCount]);

  // Full Tab Matches club name map built from server projection clubs
  const clubNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (Array.isArray(sharedClubs)) {
      for (const c of sharedClubs) {
        if (c?.short && c?.name) map[c.short] = c.name;
      }
    }
    return map;
  }, [sharedClubs]);

  // Matchup lookup for targetNextGW built cleanly from server clubGwMatchProjections (DGW & BGW aware)
  const targetGwMatchProjections = useMemo(() => {
    const map = new Map<string, MatchProjInput>();

    if (sharedClubGwMatchProjections) {
      const suffix = `_${targetNextGW}`;
      for (const [key, list] of Object.entries(sharedClubGwMatchProjections)) {
        if (!key.endsWith(suffix) || !Array.isArray(list)) continue;
        const clubShort = key.slice(0, key.length - suffix.length);
        if (!clubShort) continue;
        if (list.length === 0) {
          map.set(clubShort, {
            oppShort: 'Blank',
            isHome: true,
            teamLambda: 0,
            oppLambda: 0,
            csProb: 0,
            isBlank: true,
            matches: [],
          });
          continue;
        }
        const first = list[0];
        const sumTeamLambda = list.reduce((s, item) => s + Number(item.teamLambda || 0), 0);
        const sumOppLambda = list.reduce((s, item) => s + Number(item.oppLambda || 0), 0);
        const maxCsPct = Math.max(
          ...list.map((item) =>
            typeof item.csProbPct === 'number'
              ? item.csProbPct
              : Math.round(Number(item.csProb || 0) * 100)
          )
        );
        map.set(clubShort, {
          oppShort: list.length >= 2 ? list.map((m) => m.oppShort).join(' + ') : first.oppShort,
          isHome: first.isHome,
          teamLambda: Number(sumTeamLambda.toFixed(2)),
          oppLambda: Number(sumOppLambda.toFixed(2)),
          csProb: maxCsPct,
          isBlank: false,
          matches: list.map((item) => ({
            oppShort: item.oppShort,
            isHome: item.isHome,
            teamLambda: item.teamLambda,
            oppLambda: item.oppLambda,
            csProb: typeof item.csProbPct === 'number' ? item.csProbPct : Math.round(Number(item.csProb || 0) * 100),
          })),
        });
      }
    }

    // Fallback to sharedClubNextMatchesMap if sharedClubGwMatchProjections wasn't populated for a club
    if (sharedClubNextMatchesMap) {
      for (const [clubShort, entries] of Object.entries(sharedClubNextMatchesMap)) {
        if (map.has(clubShort) || !Array.isArray(entries)) continue;
        if (entries.length === 0) {
          map.set(clubShort, { oppShort: 'Blank', isHome: true, teamLambda: 0, oppLambda: 0, csProb: 0, isBlank: true, matches: [] });
        } else {
          const first = entries[0];
          map.set(clubShort, {
            oppShort: entries.length >= 2 ? entries.map((e) => e.opponentShort).join(' + ') : first.opponentShort,
            isHome: first.isHome,
            teamLambda: 1.4,
            oppLambda: 1.2,
            csProb: 28,
            isBlank: false,
            matches: entries.map((e) => ({ oppShort: e.opponentShort, isHome: e.isHome })),
          });
        }
      }
    }

    return map;
  }, [sharedClubGwMatchProjections, sharedClubNextMatchesMap, targetNextGW]);

  // Map of computed projections from TabProjection (Single Source of Truth)
  const projMap = useMemo(() => {
    if (!playerProjections || playerProjections.length === 0) return new Map<number, any>();
    return new Map<number, any>(playerProjections.map((p) => [p.id, p]));
  }, [playerProjections]);

  // Player pool mapped from raw database elements / player_stats with TabProjection Single Source of Truth
  const playerPool = useMemo(() => {
    const rawList = leagueData?.player_stats || [];
    return rawList.map((p: any) => {
      const cost = typeof p.nowCost === 'number' ? (p.nowCost > 20 ? p.nowCost / 10 : p.nowCost) : ((p.now_cost || 50) / 10);
      const form = Number(p.form || 0);
      const ppg = Number(p.pointsPerGame || p.points_per_game || 0);
      const xG = Number(p.expectedGoals || p.expected_goals || 0);
      const xA = Number(p.expectedAssists || p.expected_assists || 0);
      const xGI = Number(p.expectedGoalInvolvements || p.expected_goal_involvements || (xG + xA));
      const threat = Number(p.threat || 0);
      const creativity = Number(p.creativity || 0);
      const pts = Number(p.totalPoints || p.total_points || 0);
      const goals = Number(p.goalsScored || p.goals_scored || 0);
      const assists = Number(p.assists || 0);
      const mins = Number(p.minutes || 1);
      const starts = Number(p.starts || (mins > 0 ? 1 : 0));
      const yellowCards = Number(p.yellowCards || (p as any).yellow_cards || 0);
      const cleanSheets = Number(p.cleanSheets ?? (p as any).clean_sheets ?? 0);
      const goalsConceded = Number(p.goalsConceded ?? (p as any).goals_conceded ?? 0);
      const influence = Number(p.influence || 0);
      const bps = Number(p.bps || 0);
      const bonus = Number(p.bonus || 0);
      const cShort = p.teamShort || p.team_short_name || '';
      // Unified match projection and xP lookup from server projection core (Single Source of Truth)
      const proj = projMap.get(p.id);
      const fullSeasonPointsMap = proj?.fullSeasonPointsMap as Record<number, PlayerGwProjectionCell> | undefined;
      const deadBall: DeadBallDutyStatus = proj?.deadBall || {
        isPrimaryPen: p.penaltiesOrder === 1 || p.penalties_order === 1,
        isSecondaryPen: p.penaltiesOrder === 2 || p.penalties_order === 2,
        isFkTaker: (p.directFreekicksOrder ?? p.direct_freekicks_order ?? 99) <= 2,
        isCornerTaker: (p.cornersAndIndirectFreekicksOrder ?? p.corners_and_indirect_freekicks_order ?? 99) <= 2,
      };
      const status = p.status || 'a';
      const chanceOfPlaying = p.chanceOfPlayingNextRound ?? p.chanceOfPlayingThisRound ?? (p as any).chance_of_playing_next_round ?? null;
      const news = p.news || '';
      const fnbOwn = fnbOwnershipMap.get(p.id) || 0;
      const hauls = Number(proj?.doubleDigitHauls ?? (p as any).doubleDigitHauls ?? 0);
      const maxGwPoints = Number(proj?.maxGwPoints ?? (p as any).maxGwPoints ?? 0);

      // 1 GW Projection for targetNextGW (Free Hit) — explicit DGW & BGW handling
      const targetCell = fullSeasonPointsMap?.[targetNextGW];
      const matchProj = targetGwMatchProjections.get(cShort);
      const isBlankTarget = Boolean(
        targetCell?.isBlank ||
        (!targetCell && matchProj?.isBlank)
      );

      const targetOpp = isBlankTarget
        ? 'Blank'
        : targetCell?.opp
        ? targetCell.opp
        : (matchProj?.oppShort && !matchProj.isBlank
          ? `${matchProj.oppShort} (${matchProj.isHome ? 'H' : 'A'})`
          : '-');
      const targetIsHome = targetCell?.isHome ?? (matchProj?.isHome ?? true);

      // xP 1 GW (Free Hit): 0.0 on Blank GW; otherwise server projection core or lightweight fallback
      const xP1 = isBlankTarget
        ? 0
        : targetCell?.xp !== undefined
        ? Number(targetCell.xp.toFixed(1))
        : Number((form * 0.55 + ppg * 0.35 + xGI * 0.4).toFixed(1));

      // 6 GW Horizon (Wildcard)
      const wildcardGWs = [
        targetNextGW,
        targetNextGW + 1,
        targetNextGW + 2,
        targetNextGW + 3,
        targetNextGW + 4,
        targetNextGW + 5
      ].filter((g) => g <= 38);

      let sum6 = 0;
      const fixtures6: Array<{ gw: number; opp: string; isHome: boolean; xp: number; isBlank?: boolean; isDgw?: boolean }> = [];

      for (const g of wildcardGWs) {
        const cell = fullSeasonPointsMap?.[g];
        const cellBlank = Boolean(cell?.isBlank);
        const gXp = cellBlank ? 0 : (cell?.xp !== undefined ? Number(cell.xp.toFixed(1)) : xP1);
        const gOpp = cellBlank ? 'Blank' : (cell?.opp ? cell.opp : (g === targetNextGW ? targetOpp : '-'));
        const gHome = cell?.isHome ?? (g === targetNextGW ? targetIsHome : true);
        sum6 += gXp;
        fixtures6.push({
          gw: g,
          opp: gOpp,
          isHome: gHome,
          xp: gXp,
          isBlank: cellBlank,
          isDgw: Boolean(cell?.isDgw),
        });
      }

      // Rata-rata 6 GW untuk mode Wildcard
      const avgXp6 = wildcardGWs.length > 0 ? Number((sum6 / wildcardGWs.length).toFixed(1)) : xP1;
      const totalXp6 = Number(sum6.toFixed(1));

      // 1 GW Fixture untuk mode Free Hit
      const fixtures1 = fixtures6.length > 0 ? [fixtures6[0]] : [{
        gw: targetNextGW,
        opp: targetOpp,
        isHome: targetIsHome,
        xp: xP1,
        isBlank: isBlankTarget,
        isDgw: Boolean(targetCell?.isDgw),
      }];

      // 3 GW Average xP from same Projection Points source
      const fixtures3 = fixtures6.slice(0, 3);
      const avgXp3 = fixtures3.length > 0
        ? Number((fixtures3.reduce((s, f) => s + f.xp, 0) / fixtures3.length).toFixed(1))
        : xP1;

      // Player xGI per 90 minutes
      const xGi90 = Number(((xGI / mins) * 90).toFixed(2));

      // Server-computed FPL Proven Guard status
      const proven = proj?.proven || DEFAULT_UNPROVEN_STATUS;

      // Unified Captain Score: Anchored directly on Projection Points (xP1) + bounded 2x armband ceiling tie-breaker
      const posArmbandBias = p.position === 'FWD' ? 1.5 : p.position === 'MID' ? 1.0 : p.position === 'DEF' ? -2.0 : -3.2;
      const penArmbandBias = deadBall.isPrimaryPen ? 0.8 : 0;
      const haulCeilingBias = Math.min(1.5, hauls * 0.4);
      const provenBias = proven.tier === 'ELITE' ? 1.2 : proven.tier === 'ESTABLISHED' ? 0.5 : 0;
      const captainScore = Number((xP1 * 10 + posArmbandBias + penArmbandBias + haulCeilingBias + provenBias).toFixed(2));

      // Unified Differential Score (<5% FNB ownership): Anchored on Projection Points (xP1 + 3-GW avg xP) + subtle upside tie-breaker
      const diffScore = Number((
        xP1 * 5.5 +
        avgXp3 * 4.5 +
        Math.min(3.0, hauls * 0.9) +
        (deadBall.isPrimaryPen ? 1.5 : 0) +
        Math.min(2.5, xGi90 * 2.5)
      ).toFixed(1));

      return {
        id: p.id,
        webName: p.webName || p.web_name || 'Player',
        fullName: p.fullName || p.full_name || p.webName || 'Player',
        position: p.position || 'MID',
        teamShort: cShort,
        clubName: narrativeFns.resolveClubName(cShort, clubNameMap),
        cost,
        form,
        ppg,
        xG,
        xA,
        xGI,
        threat,
        creativity,
        influence,
        bps,
        bonus,
        starts,
        yellowCards,
        cleanSheets,
        goalsConceded,
        deadBall,
        hauls,
        maxGwPoints,
        gwHistory: p.gwHistory,
        matchProj,
        pts,
        goals,
        assists,
        mins,
        status,
        chanceOfPlaying,
        news,
        fnbOwn,
        photo: proj?.photo || p.photo || '',
        isBlankTarget,
        xP1,
        avgXp3,
        avgXp6,
        totalXp6,
        fixtures1,
        fixtures6,
        fullSeasonPointsMap: (fullSeasonPointsMap || {}) as Record<number, PlayerGwProjectionCell>,
        captainScore,
        diffScore,
        proven,
      };
    });
  }, [leagueData?.player_stats, fnbOwnershipMap, targetNextGW, projMap, targetGwMatchProjections, clubNameMap]);

  const getPoolPlayerGwXp = (p: (typeof playerPool)[number], gw: number): number => {
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

  // ==========================================
  // 1. SUBTAB: PICKS (Server-Solved Free Hit vs Wildcard)
  // ==========================================
  const [picksType, setPicksType] = useState<'FH' | 'WC'>('FH');
  const [localScoutSquadsPayload, setLocalScoutSquadsPayload] = useState<ServerScoutSquadsPayload | null>(null);
  const [isLoadingLocalScoutSquads, setIsLoadingLocalScoutSquads] = useState<boolean>(false);
  const scoutSquadsCacheRef = useRef<Map<string, ServerScoutSquadsPayload>>(new Map());
  const inFlightScoutEpochRef = useRef<string | null>(null);

  useEffect(() => {
    const handleFormulaUpdated = async (e: Event) => {
      scoutSquadsCacheRef.current.clear();
      inFlightScoutEpochRef.current = null;
      setLocalScoutSquadsPayload(null);
      setFormulaRevision((prev) => prev + 1);

      if (import.meta.env.DEV) {
        const changedFiles: string[] = (e as CustomEvent<{ changed_files?: string[] }>)?.detail?.changed_files || [];
        if (changedFiles.length === 0 || changedFiles.some((f) => f.includes('scoutNarratives'))) {
          try {
            const mod = await import(/* @vite-ignore */ `/src/utils/scoutNarratives.ts?t=${Date.now()}`);
            if (mod?.generateCaptainArticlePicks && mod?.generateDifferentialArticlePicks && mod?.resolveClubName) {
              setNarrativeFns({
                generateCaptainArticlePicks: mod.generateCaptainArticlePicks,
                generateDifferentialArticlePicks: mod.generateDifferentialArticlePicks,
                resolveClubName: mod.resolveClubName,
              });
            }
          } catch {}
        }
      }
    };
    window.addEventListener('fpl:formula-updated', handleFormulaUpdated);
    return () => window.removeEventListener('fpl:formula-updated', handleFormulaUpdated);
  }, []);

  // Hydrate fallback from IndexedDB immediately ONLY when epochKey matches effectiveEpochKey
  useEffect(() => {
    if (sharedScoutSquads && sharedScoutSquads.epochKey === effectiveEpochKey) return;
    let mounted = true;
    loadScoutSquadsFromIndexedDB<ServerScoutSquadsPayload>()
      .then((cached) => {
        if (!mounted || !cached?.epochKey) return;
        if (cached.epochKey === effectiveEpochKey) {
          scoutSquadsCacheRef.current.set(cached.epochKey, cached);
          setLocalScoutSquadsPayload((prev) =>
            prev && prev.epochKey === effectiveEpochKey ? prev : cached
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
    if (sharedScoutSquads && sharedScoutSquads.epochKey === effectiveEpochKey) {
      scoutSquadsCacheRef.current.set(effectiveEpochKey, sharedScoutSquads);
      return;
    }

    const cached = scoutSquadsCacheRef.current.get(effectiveEpochKey);
    if (cached && cached.epochKey === effectiveEpochKey) {
      setLocalScoutSquadsPayload(cached);
      return;
    }
    if (sharedScoutSquads !== undefined && isLoadingSharedScoutSquads) {
      return;
    }
    if (inFlightScoutEpochRef.current === effectiveEpochKey) return;

    let mounted = true;
    inFlightScoutEpochRef.current = effectiveEpochKey;
    setIsLoadingLocalScoutSquads(true);

    fetch(`/api/projections-scout-squads?_t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted || !json?.success || !json.data) return;
        const payload = json.data as ServerScoutSquadsPayload;
        if (payload.epochKey) {
          scoutSquadsCacheRef.current.set(payload.epochKey, payload);
        }
        scoutSquadsCacheRef.current.set(effectiveEpochKey, payload);
        setLocalScoutSquadsPayload(payload);
        saveScoutSquadsToIndexedDB(payload).catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightScoutEpochRef.current === effectiveEpochKey) {
          inFlightScoutEpochRef.current = null;
        }
        if (mounted) {
          setIsLoadingLocalScoutSquads(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [leagueData, effectiveEpochKey, sharedScoutSquads, isLoadingSharedScoutSquads, formulaRevision]);

  const scoutSquadsPayload =
    sharedScoutSquads && sharedScoutSquads.epochKey === effectiveEpochKey
      ? sharedScoutSquads
      : localScoutSquadsPayload && localScoutSquadsPayload.epochKey === effectiveEpochKey
      ? localScoutSquadsPayload
      : null;
  const isLoadingScoutSquads = Boolean(
    !scoutSquadsPayload && (isLoadingSharedScoutSquads || isLoadingLocalScoutSquads)
  );

  const playerPoolById = useMemo(() => {
    return new Map(playerPool.map((p) => [p.id, p]));
  }, [playerPool]);

  const solvedScoutSquads = useMemo(() => {
    type PoolPlayer = (typeof playerPool)[number];
    const hydrateTarget = (raw?: SolvedScoutSquadResult) => {
      if (!raw || raw.starterIds.length === 0) {
        return {
          starters: [] as PoolPlayer[],
          bench: [] as PoolPlayer[],
          xiCost: 0,
          xiBudget: 83.0,
          totalCost: 0,
          budget: 100.0,
          xiXp: 0,
          formation: '3-4-3',
        };
      }
      const starters = raw.starterIds
        .map((id) => playerPoolById.get(id))
        .filter((p): p is PoolPlayer => Boolean(p));
      const bench = raw.benchIds
        .map((id) => playerPoolById.get(id))
        .filter((p): p is PoolPlayer => Boolean(p));
      return {
        starters,
        bench,
        xiCost: raw.xiCost,
        xiBudget: raw.xiBudget,
        totalCost: raw.totalCost,
        budget: raw.budget,
        xiXp: raw.xiXp,
        formation: raw.formation,
      };
    };

    return {
      fh: hydrateTarget(scoutSquadsPayload?.fhTarget),
      wc: hydrateTarget(scoutSquadsPayload?.wcTarget),
    };
  }, [scoutSquadsPayload, playerPoolById]);

  const scoutChipSetSimByGw = useMemo(() => {
    type PoolPlayer = (typeof playerPool)[number];
    const map = new Map<number, { fhSquad15: PoolPlayer[]; wcSquad15: PoolPlayer[] }>();
    if (subTab !== 'chips' || !scoutSquadsPayload?.chipSetByGw || playerPoolById.size === 0) return map;

    for (const [gwKey, val] of Object.entries(scoutSquadsPayload.chipSetByGw)) {
      const gwNum = Number(gwKey);
      if (isNaN(gwNum)) continue;
      map.set(gwNum, {
        fhSquad15: (val.fhSquadIds || []).map((id) => playerPoolById.get(id)).filter((p): p is PoolPlayer => Boolean(p)),
        wcSquad15: (val.wcSquadIds || []).map((id) => playerPoolById.get(id)).filter((p): p is PoolPlayer => Boolean(p)),
      });
    }
    return map;
  }, [subTab, scoutSquadsPayload?.chipSetByGw, playerPoolById]);

  const picksSquad = picksType === 'FH' ? solvedScoutSquads.fh : solvedScoutSquads.wc;

  // Group starters by position for pitch layout
  const pitchStarters = useMemo(() => {
    return {
      gks: picksSquad.starters.filter((p) => p.position === 'GKP'),
      defs: picksSquad.starters.filter((p) => p.position === 'DEF'),
      mids: picksSquad.starters.filter((p) => p.position === 'MID'),
      fwds: picksSquad.starters.filter((p) => p.position === 'FWD'),
    };
  }, [picksSquad.starters]);

  // ==========================================
  // 2. SUBTAB: CAPTAIN (Top 10 Attacking Weighted, Non-Blank Priority)
  // ==========================================
  const captainPicks = useMemo(() => {
    if (subTab !== 'captain') return [];
    const activeNonBlank = playerPool.filter((p) => p.status === 'a' && p.mins >= 250 && !p.isBlankTarget);
    const list = activeNonBlank.length >= 10
      ? [...activeNonBlank]
      : playerPool.filter((p) => p.status === 'a' && p.mins >= 250);
    list.sort((a, b) => b.captainScore - a.captainScore);
    const top10 = list.slice(0, 10);
    return narrativeFns.generateCaptainArticlePicks(top10, targetGwMatchProjections, targetNextGW, isId, playerPool, clubNameMap);
  }, [subTab, playerPool, isId, targetNextGW, targetGwMatchProjections, clubNameMap, narrativeFns]);

  // ==========================================
  // 3. SUBTAB: DIFFERENTIAL (<5% FNB Ownership, Top 3, Non-Blank Priority)
  // ==========================================
  const differentialPicks = useMemo(() => {
    if (subTab !== 'differential') return [];
    const nonBlankDiffs = playerPool.filter((p) => p.fnbOwn < 5.0 && p.status === 'a' && p.mins >= 270 && !p.isBlankTarget);
    const diffs = nonBlankDiffs.length >= 3
      ? [...nonBlankDiffs]
      : playerPool.filter((p) => p.fnbOwn < 5.0 && p.status === 'a' && p.mins >= 270);
    diffs.sort((a, b) => b.diffScore - a.diffScore);
    const top3 = diffs.slice(0, 3);
    return narrativeFns.generateDifferentialArticlePicks(top3, targetGwMatchProjections, targetNextGW, isId, playerPool, clubNameMap);
  }, [subTab, playerPool, isId, targetNextGW, targetGwMatchProjections, clubNameMap, narrativeFns]);

  // ==========================================
  // 4. SUBTAB: CHIPS (Per-GW Active Set Simulation & Global Optimal Chip Schedule)
  // ==========================================
  const [transferMode, setTransferMode] = useState<'FT' | 'HIT'>('FT');
  const [transferHorizon, setTransferHorizon] = useState<1 | 3 | 6>(1);
  const [managerFinances, setManagerFinances] = useState<{
    entryId: number | null;
    bank: number;
    ft: number;
  }>({ entryId: null, bank: 0.0, ft: 1 });
  const managerFinanceCacheRef = useRef<Map<number, { bank: number; ft: number }>>(new Map());

  // Instant DB fallback for manager FT allowance using leagueData history, chips & transfer feed
  const dbEstimatedFtAllowance = useMemo(() => {
    if (!activeManager?.entry_id) return 1;
    const entryId = activeManager.entry_id;
    const upToGw = Math.max(baseHistoricalGW, 1);
    if (upToGw < 2) return 1;

    // Collect WC/FH GWs for this manager from all_chips_used
    const chipRow = leagueData?.all_chips_used?.find((c) => c.entry_id === entryId);
    const preserveFtGws = new Set<number>();
    if (chipRow) {
      if (chipRow.wc1?.gw) preserveFtGws.add(chipRow.wc1.gw);
      if (chipRow.wc2?.gw) preserveFtGws.add(chipRow.wc2.gw);
      if (chipRow.fh1?.gw) preserveFtGws.add(chipRow.fh1.gw);
      if (chipRow.fh2?.gw) preserveFtGws.add(chipRow.fh2.gw);
    }

    // Count transfers per GW from all_transfers
    const transferCountByGw = new Map<number, number>();
    for (const tr of leagueData?.all_transfers || []) {
      if (tr.entry_id === entryId) {
        transferCountByGw.set(tr.event, (transferCountByGw.get(tr.event) || 0) + 1);
      }
    }

    let ft = 1;
    for (let gw = 2; gw <= upToGw; gw++) {
      const standingRow = leagueData?.standings?.[gw]?.find((r) => r.entry_id === entryId);
      const chipName = (standingRow?.active_chip || '').toLowerCase();
      if (preserveFtGws.has(gw) || chipName.includes('wildcard') || chipName.includes('free')) {
        ft = Math.max(1, Math.min(5, ft));
        continue;
      }
      const made = transferCountByGw.get(gw) || 0;
      const hitCost = Number(standingRow?.event_transfers_cost || 0);
      const hits = Math.round(hitCost / 4);
      const freeUsed = Math.max(0, made - hits);
      const effectiveBefore = Math.max(ft, freeUsed);
      const remaining = Math.max(0, effectiveBefore - freeUsed);
      ft = Math.min(5, remaining + 1);
    }
    return ft;
  }, [activeManager?.entry_id, baseHistoricalGW, leagueData?.all_chips_used, leagueData?.all_transfers, leagueData?.standings]);

  useEffect(() => {
    if ((subTab !== 'transfer' && subTab !== 'chips') || !activeManager?.entry_id) return;
    const entryId = activeManager.entry_id;
    const cached = managerFinanceCacheRef.current.get(entryId);
    if (cached) {
      setManagerFinances({ entryId, bank: cached.bank, ft: cached.ft });
      return;
    }

    // Seed with DB-estimated FT while fetching full manager detail (exact bank + current_history)
    setManagerFinances({ entryId, bank: 0.0, ft: dbEstimatedFtAllowance });

    let mounted = true;
    fetch(`/api/fpl-manager-detail/${entryId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!mounted || !json?.success || !json?.data) return;
        const d = json.data;
        const bank = Math.max(0, Math.round(Number(d.last_deadline_bank || 0) * 10) / 10);

        // Compute exact FPL Free Transfers from current_history + chips
        let ft = 1;
        const history = Array.isArray(d.current_history)
          ? [...d.current_history].sort((a: any, b: any) => a.event - b.event)
          : [];
        const chipsList = Array.isArray(d.chips) ? d.chips : [];
        const preserveFtGws = new Set<number>(
          chipsList
            .filter((c: any) => {
              const nm = String(c.name || '').toLowerCase();
              return nm.includes('wildcard') || nm === 'wc' || nm.includes('freehit') || nm === 'fh';
            })
            .map((c: any) => Number(c.event))
        );

        const upToGw = Math.max(baseHistoricalGW, 1);
        for (const h of history) {
          const gw = Number(h.event || 0);
          if (gw < 2 || gw > upToGw) continue;
          if (preserveFtGws.has(gw)) {
            ft = Math.max(1, Math.min(5, ft));
            continue;
          }
          const made = Number(h.event_transfers || 0);
          const hits = Math.round(Number(h.event_transfers_cost || 0) / 4);
          const freeUsed = Math.max(0, made - hits);
          const effectiveBefore = Math.max(ft, freeUsed);
          const remaining = Math.max(0, effectiveBefore - freeUsed);
          ft = Math.min(5, remaining + 1);
        }

        const resolved = { bank: isNaN(bank) ? 0 : bank, ft: history.length > 0 ? ft : dbEstimatedFtAllowance };
        managerFinanceCacheRef.current.set(entryId, resolved);
        setManagerFinances({ entryId, ...resolved });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [subTab, activeManager?.entry_id, baseHistoricalGW, dbEstimatedFtAllowance]);

  const ftAllowance = managerFinances.entryId === activeManager?.entry_id ? managerFinances.ft : dbEstimatedFtAllowance;
  const bankBalance = managerFinances.entryId === activeManager?.entry_id ? managerFinances.bank : 0.0;

  const chipsAnalysis = useMemo(() => {
    const isSecondHalf = targetNextGW >= 20;
    const halfStartGW = isSecondHalf ? 20 : 1;
    const halfEndGW = isSecondHalf ? 38 : 19;
    if (subTab !== 'chips') {
      return {
        needChip: false,
        chipName: null as string | null,
        gain: 0,
        reason: '',
        chipSet: [] as Array<{ key: 'WC' | 'TC' | 'BB' | 'FH'; name: string; short: string; used: { gw: number; points: number } | null }>,
        isSecondHalf,
        halfStartGW,
        halfEndGW,
        currentFT: ftAllowance,
        openingNarrative: '',
        chipParagraphs: [] as Array<{ chipKey?: 'WC' | 'TC' | 'BB' | 'FH'; chipLead?: string; text: string }>,
        allUsed: false,
      };
    }
    const chipRow = activeManager
      ? leagueData?.all_chips_used?.find((c) => c.entry_id === activeManager.entry_id)
      : undefined;

    const resolveFallbackActiveChip = (chipKeyword: string, currentUsed: { gw: number; points: number } | null | undefined) => {
      if (currentUsed) return currentUsed;
      if (!activeManager) return null;
      const standingInHalf = isSecondHalf ? effectiveStandingsGW >= 20 : effectiveStandingsGW < 20;
      const activeChipName = (activeManager.active_chip || '').toLowerCase();
      if (standingInHalf && activeChipName.includes(chipKeyword)) {
        return { gw: effectiveStandingsGW, points: activeManager.event_points || 0 };
      }
      return null;
    };

    const wcUsed = resolveFallbackActiveChip('wildcard', isSecondHalf ? chipRow?.wc2 : chipRow?.wc1);
    const tcUsed = resolveFallbackActiveChip('3xc', isSecondHalf ? chipRow?.tc2 : chipRow?.tc1);
    const bbUsed = resolveFallbackActiveChip('bboost', isSecondHalf ? chipRow?.bb2 : chipRow?.bb1);
    const fhUsed = resolveFallbackActiveChip('freehit', isSecondHalf ? chipRow?.fh2 : chipRow?.fh1);

    const chipSet = [
      {
        key: 'WC' as const,
        name: 'Wildcard',
        short: isSecondHalf ? 'WC2' : 'WC1',
        used: wcUsed,
      },
      {
        key: 'TC' as const,
        name: 'Triple Captain',
        short: isSecondHalf ? 'TC2' : 'TC1',
        used: tcUsed,
      },
      {
        key: 'BB' as const,
        name: 'Bench Boost',
        short: isSecondHalf ? 'BB2' : 'BB1',
        used: bbUsed,
      },
      {
        key: 'FH' as const,
        name: 'Free Hit',
        short: isSecondHalf ? 'FH2' : 'FH1',
        used: fhUsed,
      },
    ];

    type ChipKey = 'WC' | 'TC' | 'BB' | 'FH';
    type EditorialParagraph = {
      chipKey?: ChipKey;
      chipLead?: string;
      text: string;
    };

    if (!activeManager || activeSquad.length === 0 || playerPool.length === 0) {
      return {
        needChip: false,
        chipName: null as string | null,
        gain: 0,
        reason: '',
        chipSet,
        isSecondHalf,
        halfStartGW,
        halfEndGW,
        currentFT: ftAllowance,
        openingNarrative: '',
        chipParagraphs: [] as EditorialParagraph[],
        allUsed: false,
      };
    }

    const availableChips = chipSet.filter((c) => !c.used);
    if (availableChips.length === 0) {
      return {
        needChip: false,
        chipName: null as string | null,
        gain: 0,
        reason: '',
        chipSet,
        isSecondHalf,
        halfStartGW,
        halfEndGW,
        currentFT: ftAllowance,
        openingNarrative: isId
          ? `Seluruh chip pada ${isSecondHalf ? 'paruh kedua musim (GW 20–38)' : 'paruh pertama musim (GW 1–19)'} sudah habis terpakai. Fokus penuh pekan ini cukup diarahkan ke penyusunan Starting XI terbaik dan pemanfaatan ${ftAllowance} Free Transfer yang ada.`
          : `All four chips for ${isSecondHalf ? 'the second half of the season (GW 20–38)' : 'the first half of the season (GW 1–19)'} have already been played. Focus on optimizing your Starting XI and managing your ${ftAllowance} Free Transfers.`,
        chipParagraphs: [] as EditorialParagraph[],
        allUsed: true,
      };
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const poolMap = new Map(playerPool.map((p) => [p.id, p]));
    type PoolPlayer = (typeof playerPool)[number];
    const managerSquad15 = activeSquad
      .map((item) => poolMap.get(item.player.id))
      .filter((p): p is PoolPlayer => Boolean(p));

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

    const getOptimalXiAtGw = (squad15: PoolPlayer[], gw: number) => {
      const sortFn = (a: PoolPlayer, b: PoolPlayer) =>
        getPoolPlayerGwXp(b, gw) - getPoolPlayerGwXp(a, gw) || b.captainScore - a.captainScore || b.pts - a.pts;

      const gkps = squad15.filter((p) => p.position === 'GKP').sort(sortFn);
      const defs = squad15.filter((p) => p.position === 'DEF').sort(sortFn);
      const mids = squad15.filter((p) => p.position === 'MID').sort(sortFn);
      const fwds = squad15.filter((p) => p.position === 'FWD').sort(sortFn);

      let bestStarters: PoolPlayer[] = [];
      let bestBench: PoolPlayer[] = [];
      let bestXiXp = -1;
      let bestMaxStarterXp = -1;
      let bestBenchXp = -1;

      for (const [d, m, f] of FORMATIONS) {
        if (gkps.length < 1 || defs.length < d || mids.length < m || fwds.length < f) continue;
        const starters = [gkps[0], ...defs.slice(0, d), ...mids.slice(0, m), ...fwds.slice(0, f)];
        const starterIds = new Set(starters.map((p) => p.id));
        const bench = squad15.filter((p) => !starterIds.has(p.id));
        const xiXp = starters.reduce((s, p) => s + getPoolPlayerGwXp(p, gw), 0);
        const maxStarterXp = starters.reduce((mx, p) => Math.max(mx, getPoolPlayerGwXp(p, gw)), 0);
        const benchXp = bench.reduce((s, p) => s + getPoolPlayerGwXp(p, gw), 0);

        if (
          xiXp > bestXiXp + 1e-6 ||
          (Math.abs(xiXp - bestXiXp) <= 1e-6 &&
            (maxStarterXp > bestMaxStarterXp + 1e-6 ||
              (Math.abs(maxStarterXp - bestMaxStarterXp) <= 1e-6 && benchXp > bestBenchXp)))
        ) {
          bestStarters = starters;
          bestBench = bench;
          bestXiXp = xiXp;
          bestMaxStarterXp = maxStarterXp;
          bestBenchXp = benchXp;
        }
      }

      if (bestStarters.length === 0) {
        const sortedAll = [...squad15].sort(sortFn);
        bestStarters = sortedAll.slice(0, 11);
        bestBench = sortedAll.slice(11);
        bestXiXp = bestStarters.reduce((s, p) => s + getPoolPlayerGwXp(p, gw), 0);
        bestBenchXp = bestBench.reduce((s, p) => s + getPoolPlayerGwXp(p, gw), 0);
      }

      const bestStarter = [...bestStarters].sort(sortFn)[0] || null;
      const capXp = bestStarter ? getPoolPlayerGwXp(bestStarter, gw) : 0;
      const sorted15 = [...squad15].sort(sortFn);
      const tcCandidate = sorted15[0] || bestStarter;
      const tcXp = tcCandidate ? getPoolPlayerGwXp(tcCandidate, gw) : 0;

      return {
        starters: bestStarters,
        bench: bestBench,
        xiXp: round1(bestXiXp),
        benchXp: round1(bestBenchXp),
        bestStarter,
        capXp: round1(capXp),
        xiPlusCap: round1(bestXiXp + capXp),
        tcCandidate,
        tcXp: round1(tcXp),
      };
    };

    const gwRange: number[] = [];
    for (let g = targetNextGW; g <= halfEndGW; g++) gwRange.push(g);

    // Precompute manager's optimal XI per GW across [targetNextGW .. 38] (needed up to GW 24 for WC at GW 19)
    const teamOptCache = new Map<number, ReturnType<typeof getOptimalXiAtGw>>();
    const maxEvalGw = isSecondHalf ? 38 : Math.min(38, halfEndGW + 5);
    for (let g = targetNextGW; g <= maxEvalGw; g++) {
      teamOptCache.set(g, getOptimalXiAtGw(managerSquad15, g));
    }

    type TcGwInfo = { gw: number; gain: number; playerName: string; opp: string };
    type BbGwInfo = {
      gw: number;
      gain: number;
      benchDetails: Array<{ name: string; xp: number; opp: string }>;
    };
    type FhGwInfo = {
      gw: number;
      gain: number;
      fhScore: number;
      teamScore: number;
      fhCapName: string;
      teamCapName: string;
      diffNames: string[];
    };
    type WcGwInfo = {
      gw: number;
      gain: number;
      horizonEnd: number;
      horizonLen: number;
      diffStarters: number;
      heldByFt: boolean;
      eligible: boolean;
      keyAdditions: string[];
    };

    const tcByGw = new Map<number, TcGwInfo>();
    const bbByGw = new Map<number, BbGwInfo>();
    const fhByGw = new Map<number, FhGwInfo>();
    const wcByGw = new Map<number, WcGwInfo>();

    for (const g of gwRange) {
      const teamAtG = teamOptCache.get(g)!;
      const teamStarterIds = new Set(teamAtG.starters.map((p) => p.id));

      // 1. TC at GW g
      const tcCand = teamAtG.tcCandidate;
      const tcOpp = tcCand?.fullSeasonPointsMap?.[g]?.opp || '-';
      tcByGw.set(g, {
        gw: g,
        gain: teamAtG.tcXp,
        playerName: tcCand?.webName || '-',
        opp: tcOpp,
      });

      // 2. BB at GW g
      const benchDetails = [...teamAtG.bench]
        .sort((a, b) => getPoolPlayerGwXp(b, g) - getPoolPlayerGwXp(a, g))
        .map((b) => ({
          name: b.webName,
          xp: getPoolPlayerGwXp(b, g),
          opp: b.fullSeasonPointsMap?.[g]?.opp || '-',
        }));
      bbByGw.set(g, {
        gw: g,
        gain: teamAtG.benchXp,
        benchDetails,
      });

      // 3. FH at GW g
      const simG = scoutChipSetSimByGw.get(g);
      if (simG && simG.fhSquad15.length > 0) {
        const fhAtG = getOptimalXiAtGw(simG.fhSquad15, g);
        const fhGain = round1(fhAtG.xiPlusCap - teamAtG.xiPlusCap);
        const diffNames = fhAtG.starters
          .filter((p) => !teamStarterIds.has(p.id))
          .sort((a, b) => getPoolPlayerGwXp(b, g) - getPoolPlayerGwXp(a, g))
          .slice(0, 3)
          .map((p) => p.webName);
        fhByGw.set(g, {
          gw: g,
          gain: fhGain,
          fhScore: fhAtG.xiPlusCap,
          teamScore: teamAtG.xiPlusCap,
          fhCapName: fhAtG.bestStarter?.webName || '-',
          teamCapName: teamAtG.bestStarter?.webName || '-',
          diffNames,
        });
      }

      // 4. WC at GW g (6-GW horizon [g .. min(38, g + 5)], e.g. GW19 -> GW19..24)
      if (simG && simG.wcSquad15.length > 0) {
        const horizonEnd = Math.min(38, g + 5);
        const horizonLen = horizonEnd - g + 1;
        let diffSum = 0;
        for (let k = g; k <= horizonEnd; k++) {
          const wcAtK = getOptimalXiAtGw(simG.wcSquad15, k);
          const teamAtK = teamOptCache.get(k) || getOptimalXiAtGw(managerSquad15, k);
          diffSum += wcAtK.xiPlusCap - teamAtK.xiPlusCap;
        }
        const avgGain = round1(diffSum / horizonLen);
        const wcAtG = getOptimalXiAtGw(simG.wcSquad15, g);
        const diffStarterPlayers = wcAtG.starters.filter((p) => !teamStarterIds.has(p.id));
        const diffStarters = diffStarterPlayers.length;
        const heldByFt = diffStarters <= ftAllowance;
        const keyAdditions = diffStarterPlayers
          .sort((a, b) => getPoolPlayerGwXp(b, g) - getPoolPlayerGwXp(a, g))
          .slice(0, 3)
          .map((p) => p.webName);

        wcByGw.set(g, {
          gw: g,
          gain: avgGain,
          horizonEnd,
          horizonLen,
          diffStarters,
          heldByFt,
          eligible: !heldByFt && avgGain > 0,
          keyAdditions,
        });
      }
    }

    // Build top candidate GWs per available chip (Top 6 guarantees exact optimum for <= 4 chips)
    const eligibleByChip = new Map<ChipKey, Array<{ gw: number; gain: number }>>();
    const allPeakByChip = new Map<ChipKey, { gw: number; gain: number } | null>();

    for (const chip of availableChips) {
      let entries: Array<{ gw: number; gain: number }> = [];
      let rawAll: Array<{ gw: number; gain: number }> = [];

      if (chip.key === 'TC') {
        rawAll = Array.from(tcByGw.values()).map((v) => ({ gw: v.gw, gain: v.gain }));
        entries = rawAll.filter((v) => v.gain > 0);
      } else if (chip.key === 'BB') {
        rawAll = Array.from(bbByGw.values()).map((v) => ({ gw: v.gw, gain: v.gain }));
        entries = rawAll.filter((v) => v.gain > 0);
      } else if (chip.key === 'FH') {
        rawAll = Array.from(fhByGw.values()).map((v) => ({ gw: v.gw, gain: v.gain }));
        entries = rawAll.filter((v) => v.gain > 0);
      } else if (chip.key === 'WC') {
        const wcVals = Array.from(wcByGw.values());
        rawAll = wcVals.map((v) => ({ gw: v.gw, gain: v.gain }));
        entries = wcVals.filter((v) => v.eligible).map((v) => ({ gw: v.gw, gain: v.gain }));
      }

      rawAll.sort((a, b) => b.gain - a.gain || a.gw - b.gw);
      entries.sort((a, b) => b.gain - a.gain || a.gw - b.gw);

      allPeakByChip.set(chip.key, entries[0] || rawAll[0] || null);
      eligibleByChip.set(chip.key, entries.slice(0, 6));
    }

    // Global exact non-clashing scheduler (1 GW = max 1 chip) maximizing sum of gains
    const schedulableKeys = availableChips
      .map((c) => c.key)
      .filter((k) => (eligibleByChip.get(k)?.length || 0) > 0);

    let bestAssignment = new Map<ChipKey, { gw: number; gain: number }>();
    let bestCount = -1;
    let bestTotalGain = -Infinity;
    let bestEarlinessScore = -Infinity;

    const usedGws = new Set<number>();
    const currentAssignment = new Map<ChipKey, { gw: number; gain: number }>();

    const searchSchedule = (idx: number, countPlaced: number, sumGain: number, earliness: number) => {
      if (idx >= schedulableKeys.length) {
        if (
          countPlaced > bestCount ||
          (countPlaced === bestCount &&
            (sumGain > bestTotalGain + 1e-6 ||
              (Math.abs(sumGain - bestTotalGain) <= 1e-6 && earliness > bestEarlinessScore)))
        ) {
          bestCount = countPlaced;
          bestTotalGain = sumGain;
          bestEarlinessScore = earliness;
          bestAssignment = new Map(currentAssignment);
        }
        return;
      }

      const key = schedulableKeys[idx];
      const candidates = eligibleByChip.get(key) || [];
      let placedAny = false;
      for (const cand of candidates) {
        if (usedGws.has(cand.gw)) continue;
        placedAny = true;
        usedGws.add(cand.gw);
        currentAssignment.set(key, cand);
        searchSchedule(idx + 1, countPlaced + 1, sumGain + cand.gain, earliness - cand.gw);
        usedGws.delete(cand.gw);
        currentAssignment.delete(key);
      }

      if (!placedAny || schedulableKeys.length > gwRange.length) {
        searchSchedule(idx + 1, countPlaced, sumGain, earliness);
      }
    };

    searchSchedule(0, 0, 0, 0);

    // Check if any chip is scheduled for targetNextGW
    let activeChipAtTarget: { key: ChipKey; name: string; short: string; gain: number } | null = null;
    for (const chip of availableChips) {
      const assigned = bestAssignment.get(chip.key);
      if (assigned && assigned.gw === targetNextGW) {
        activeChipAtTarget = {
          key: chip.key,
          name: chip.name,
          short: chip.short,
          gain: assigned.gain,
        };
        break;
      }
    }

    // Build natural FPL Scout editorial paragraphs for each available chip
    const fmt = (n: number) => n.toFixed(1);
    const fmtSigned = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
    const setShortLabel = isSecondHalf ? 'paruh kedua musim (GW 20–38)' : 'paruh pertama musim (GW 1–19)';
    const setShortLabelEn = isSecondHalf ? 'the second half of the season (GW 20–38)' : 'the first half of the season (GW 1–19)';

    const chipParagraphs: EditorialParagraph[] = [];
    const futureChipSummaries: string[] = [];

    for (const chip of availableChips) {
      const assigned = bestAssignment.get(chip.key) || null;
      const peak = allPeakByChip.get(chip.key) || null;
      const isNow = assigned?.gw === targetNextGW;

      if (chip.key === 'TC') {
        const cur = tcByGw.get(targetNextGW);
        const optGw = assigned?.gw ?? peak?.gw ?? null;
        const opt = optGw ? tcByGw.get(optGw) : undefined;
        const curGain = cur?.gain ?? 0;
        const optGain = opt?.gain ?? 0;
        if (opt && !isNow && optGain > 0) futureChipSummaries.push(`Triple Captain (GW ${opt.gw})`);

        const clashClause =
          peak && assigned && peak.gw !== assigned.gw
            ? isId
              ? ` Meski GW ${peak.gw} juga menyentuh ${fmt(peak.gain)} xP, slot pekan itu lebih maksimal dipakai oleh chip lain.`
              : ` While GW ${peak.gw} reaches ${fmt(peak.gain)} xP, that week delivers greater overall value with another chip.`
            : '';

        const text = opt && optGain > 0
          ? isNow
            ? isId
              ? `layak langsung diarahkan kepada ${opt.playerName} saat menghadapi ${opt.opp} di GW ${opt.gw}. Proyeksi ${fmt(opt.gain)} xP miliknya merupakan potensi kapten tertinggi skuad Anda hingga GW ${halfEndGW}, menjadikannya momen paling meyakinkan untuk memaksimalkan ban kapten tiga kali lipat.${clashClause}`
              : `stands out for ${opt.playerName} against ${opt.opp} in GW ${opt.gw}. His ${fmt(opt.gain)} xP projection is your squad's strongest single-week captain ceiling through GW ${halfEndGW}.${clashClause}`
            : isId
              ? `lebih bijak disimpan hingga GW ${opt.gw}, saat ${opt.playerName} menjumpai ${opt.opp} dengan proyeksi puncak ${fmt(opt.gain)} xP — unggul di atas opsi terbaik Anda pekan ini, ${cur?.playerName || '-'} (${cur?.opp || '-'}, ${fmt(curGain)} xP).${clashClause}`
              : `is better saved for GW ${opt.gw}, when ${opt.playerName} faces ${opt.opp} at a peak ${fmt(opt.gain)} xP — edging your top GW ${targetNextGW} option ${cur?.playerName || '-'} (${cur?.opp || '-'}, ${fmt(curGain)} xP).${clashClause}`
          : isId
            ? `belum menemukan kandidat kapten yang cukup menonjol di sisa ${setShortLabel}.`
            : `lacks a standout captaincy ceiling across the rest of ${setShortLabelEn}.`;

        chipParagraphs.push({ chipKey: 'TC', chipLead: 'Triple Captain', text });
      } else if (chip.key === 'BB') {
        const cur = bbByGw.get(targetNextGW);
        const optGw = assigned?.gw ?? peak?.gw ?? null;
        const opt = optGw ? bbByGw.get(optGw) : undefined;
        const curGain = cur?.gain ?? 0;
        const optGain = opt?.gain ?? 0;
        if (opt && !isNow && optGain > 0) futureChipSummaries.push(`Bench Boost (GW ${opt.gw})`);

        const benchText = opt
          ? opt.benchDetails.map((b) => `${b.name} ${fmt(b.xp)}`).join(', ')
          : '';
        const clashClause =
          peak && assigned && peak.gw !== assigned.gw
            ? isId
              ? ` Pekan GW ${peak.gw} sebenarnya menyentuh ${fmt(peak.gain)} xP, tetapi dialihkan agar tidak bertabrakan dengan jadwal chip lain.`
              : ` GW ${peak.gw} hits ${fmt(peak.gain)} xP, but yields that slot to maximize combined chip-set points.`
            : '';

        const text = opt && optGain > 0
          ? isNow
            ? isId
              ? `menemukan pekan idealnya sekarang. Keempat penghuni bangku cadangan Anda aktif menyumbang poin dengan total ${fmt(opt.gain)} xP (${benchText}) — kedalaman bangku terkuat hingga GW ${halfEndGW}.${clashClause}`
              : `hits its sweet spot right now, with all four bench spots combining for ${fmt(opt.gain)} xP (${benchText}) — your deepest bench return through GW ${halfEndGW}.${clashClause}`
            : isId
              ? `belum cukup padat pekan ini karena empat pemain cadangan Anda baru memproyeksikan ${fmt(curGain)} xP. Momen terkuatnya baru hadir di GW ${opt.gw}, ketika kuartet cadangan (${benchText}) secara kolektif mencapai ${fmt(opt.gain)} xP.${clashClause}`
              : `can stay on ice this week with your bench projecting just ${fmt(curGain)} xP. Its peak arrives in GW ${opt.gw}, when your four bench players (${benchText}) combine for ${fmt(opt.gain)} xP.${clashClause}`
          : isId
            ? `belum layak diaktifkan karena proyeksi poin bangku cadangan masih 0.0 xP.`
            : `offers no return yet with bench projections sitting at 0.0 xP.`;

        chipParagraphs.push({ chipKey: 'BB', chipLead: 'Bench Boost', text });
      } else if (chip.key === 'FH') {
        const cur = fhByGw.get(targetNextGW);
        const optGw = assigned?.gw ?? (peak && peak.gain > 0 ? peak.gw : null);
        const opt = optGw ? fhByGw.get(optGw) : undefined;
        const curGain = cur?.gain ?? 0;
        const optGain = opt?.gain ?? 0;
        if (opt && !isNow && optGain > 0) futureChipSummaries.push(`Free Hit (GW ${opt.gw})`);

        const diffStr = opt?.diffNames.length ? opt.diffNames.join(', ') : '-';
        const clashClause =
          peak && assigned && peak.gw !== assigned.gw
            ? isId
              ? ` GW ${peak.gw} sempat mencatat +${fmt(peak.gain)} xP, namun digeser demi memaksimalkan perolehan total seluruh chip.`
              : ` GW ${peak.gw} showed +${fmt(peak.gain)} xP, shifted to maximize overall chip-set gains.`
            : '';

        const text = opt && optGain > 0
          ? isNow
            ? isId
              ? `memberi lompatan instan di GW ${opt.gw}, mengangkat proyeksi Starting XI plus kapten dari ${fmt(opt.teamScore)} xP menjadi ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP). Kehadiran pembeda seperti ${diffStr} menutup celah jadwal skuad saat ini.${clashClause}`
              : `provides an immediate GW ${opt.gw} surge, lifting your best XI plus captain from ${fmt(opt.teamScore)} xP to ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) behind key picks like ${diffStr}.${clashClause}`
            : isId
              ? `belum perlu tergesa-gesa dipakai pekan ini karena selisihnya baru ${fmtSigned(curGain)} xP (${fmt(cur?.fhScore || 0)} vs ${fmt(cur?.teamScore || 0)} xP). Lonjakan terbaiknya muncul di GW ${opt.gw}, di mana skuad bebas transfer mampu mendongkrak perolehan dari ${fmt(opt.teamScore)} menjadi ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) berkat masuknya ${diffStr}.${clashClause}`
              : `can wait with GW ${targetNextGW} offering only ${fmtSigned(curGain)} xP (${fmt(cur?.fhScore || 0)} vs ${fmt(cur?.teamScore || 0)} xP). The real swing lands in GW ${opt.gw}, lifting your XI plus captain from ${fmt(opt.teamScore)} to ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) via ${diffStr}.${clashClause}`
          : isId
            ? `juga belum mendesak di sisa ${setShortLabel} karena kerangka XI Anda saat ini sudah mampu menandingi komposisi bebas transfer (selisih terbaik hanya ${peak ? `${fmtSigned(peak.gain)} xP di GW ${peak.gw}` : '0.0 xP'}).`
            : `isn't needed across ${setShortLabelEn} as your current XI already holds its own against a one-week rebuild (best delta: ${peak ? `${fmtSigned(peak.gain)} xP in GW ${peak.gw}` : '0.0 xP'}).`;

        chipParagraphs.push({ chipKey: 'FH', chipLead: 'Free Hit', text });
      } else {
        // WC
        const cur = wcByGw.get(targetNextGW);
        const optGw = assigned?.gw ?? (peak && peak.gain > 0 ? peak.gw : null);
        const opt = optGw ? wcByGw.get(optGw) : undefined;
        const allWcVals = Array.from(wcByGw.values());
        const anyHeldOnly = allWcVals.length > 0 && allWcVals.every((v) => v.heldByFt || v.gain <= 0);
        const curDiff = cur?.diffStarters ?? 0;

        if (!opt || anyHeldOnly) {
          const text = isId
            ? `sebaiknya ditahan karena kerangka Starting XI Anda di seluruh pekan tersisa hanya terpaut ${curDiff} pemain dari komposisi idealnya — masih terjangkau dengan ${ftAllowance} Free Transfer yang dimiliki tanpa perlu menghabiskan chip.`
            : `should be held since your Starting XI differs by only ${curDiff} players across candidate weeks — easily manageable with your ${ftAllowance} Free Transfers.`;
          chipParagraphs.push({ chipKey: 'WC', chipLead: 'Wildcard', text });
          continue;
        }

        if (!isNow) futureChipSummaries.push(`Wildcard (GW ${opt.gw})`);
        const keyAdds = opt.keyAdditions.length ? opt.keyAdditions.join(', ') : '-';
        const clashClause =
          peak && assigned && peak.gw !== assigned.gw
            ? isId
              ? ` Jendela GW ${peak.gw} sebenarnya memproyeksikan +${fmt(peak.gain)} xP/GW, namun pekan tersebut diprioritaskan untuk chip lain.`
              : ` GW ${peak.gw} projected +${fmt(peak.gain)} xP/GW, but that week is reserved for another chip.`
            : '';

        let text = '';
        if (isNow) {
          text = isId
            ? `paling masuk akal diaktifkan di GW ${opt.gw} untuk merombak struktur tim menghadapi rentang GW ${opt.gw}–${opt.horizonEnd}. Ada ${opt.diffStarters} perubahan pada Starting XI terbaik yang melampaui jangkauan ${ftAllowance} Free Transfer saat ini, dengan tambahan rata-rata +${fmt(opt.gain)} xP per pekan lewat pilar seperti ${keyAdds}.${clashClause}`
            : `makes sense now in GW ${opt.gw} to reshape your core for GW ${opt.gw}–${opt.horizonEnd}. With ${opt.diffStarters} Starting XI upgrades beyond your ${ftAllowance} Free Transfers, it adds +${fmt(opt.gain)} xP per week behind targets like ${keyAdds}.${clashClause}`;
        } else if (cur?.heldByFt) {
          text = isId
            ? `belum perlu disentuh di GW ${targetNextGW} karena perbedaan Starting XI terbaiknya hanya ${cur.diffStarters} pemain — masih sanggup dibereskan dengan ${ftAllowance} Free Transfer yang Anda pegang. Perombakan menyeluruh baru terasa dampaknya mulai GW ${opt.gw} (horizon GW ${opt.gw}–${opt.horizonEnd}) dengan ${opt.diffStarters} perubahan XI dan dorongan rata-rata +${fmt(opt.gain)} xP per pekan lewat ${keyAdds}.${clashClause}`
            : `isn't needed in GW ${targetNextGW} with only ${cur.diffStarters} Starting XI differences — easily fixed using your ${ftAllowance} Free Transfers. A full rebuild pays off starting in GW ${opt.gw} (GW ${opt.gw}–${opt.horizonEnd}), bringing ${opt.diffStarters} XI upgrades worth +${fmt(opt.gain)} xP/GW led by ${keyAdds}.${clashClause}`;
        } else {
          text = isId
            ? `memang menjanjikan ${cur ? `+${fmt(cur.gain)}` : '+0.0'} xP/GW bila ditarik pekan ini, tetapi jendela GW ${opt.gw}–${opt.horizonEnd} memberi dorongan lebih kuat sebesar +${fmt(opt.gain)} xP per pekan dengan ${opt.diffStarters} perubahan inti seperti ${keyAdds}.${clashClause}`
            : `offers ${cur ? `+${fmt(cur.gain)}` : '+0.0'} xP/GW now, yet GW ${opt.gw}–${opt.horizonEnd} delivers a stronger +${fmt(opt.gain)} xP/GW lift across ${opt.diffStarters} XI changes featuring ${keyAdds}.${clashClause}`;
        }

        chipParagraphs.push({ chipKey: 'WC', chipLead: 'Wildcard', text });
      }
    }

    const joinNatural = (items: string[]) => {
      if (items.length <= 1) return items[0] || '';
      if (items.length === 2) return isId ? `${items[0]} dan ${items[1]}` : `${items[0]} and ${items[1]}`;
      return isId
        ? `${items.slice(0, -1).join(', ')}, dan ${items[items.length - 1]}`
        : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
    };

    const availListText = joinNatural(availableChips.map((c) => c.name));
    const futureChipText = joinNatural(futureChipSummaries);
    let openingNarrative = '';
    if (activeChipAtTarget) {
      const restFutureText = futureChipSummaries.length
        ? isId
          ? ` Sisa chip lainnya paling ideal disimpan untuk ${futureChipText}.`
          : ` Your other remaining chips line up best at ${futureChipText}.`
        : '';
      openingNarrative = isId
        ? `GW ${targetNextGW} menjadi titik paling menguntungkan untuk mengaktifkan ${activeChipAtTarget.name} (+${fmt(activeChipAtTarget.gain)} xP${activeChipAtTarget.key === 'WC' ? '/GW' : ''}) di sisa ${setShortLabel}, mempertimbangkan ${availableChips.length} chip yang masih Anda pegang (${availListText}).${restFutureText}`
        : `GW ${targetNextGW} stands out as the prime week to play ${activeChipAtTarget.name} (+${fmt(activeChipAtTarget.gain)} xP${activeChipAtTarget.key === 'WC' ? '/GW' : ''}) across the rest of ${setShortLabelEn}, factoring in your remaining chips (${availListText}).${restFutureText}`;
    } else {
      const waitWindowText = futureChipSummaries.length
        ? isId
          ? ` Untuk ${availableChips.length} chip yang masih tersedia (${availListText}), jendela terbaiknya justru jatuh di pekan-pekan mendatang (${futureChipText}).`
          : ` Across your available chips (${availListText}), stronger peaks arrive later in the set (${futureChipText}).`
        : isId
          ? ` Tidak satu pun dari chip yang tersisa (${availListText}) memberi nilai tambah berarti di GW ${targetNextGW}.`
          : ` None of your remaining chips (${availListText}) deliver enough upside in GW ${targetNextGW}.`;
      openingNarrative = isId
        ? `Belum ada alasan kuat untuk membakar chip di GW ${targetNextGW}.${waitWindowText} Langkah paling bijak pekan ini adalah menjaga amunisi chip dan memoles skuad lewat ${ftAllowance} Free Transfer yang Anda miliki.`
        : `There is no pressing reason to trigger a chip in GW ${targetNextGW}.${waitWindowText} Holding your chips and shaping the squad with your ${ftAllowance} Free Transfers is the smart play this week.`;
    }

    const activePlanText = activeChipAtTarget
      ? chipParagraphs.find((p) => p.chipKey === activeChipAtTarget?.key)?.text || ''
      : '';

    return {
      needChip: Boolean(activeChipAtTarget),
      chipName: activeChipAtTarget ? activeChipAtTarget.name : null,
      gain: activeChipAtTarget ? activeChipAtTarget.gain : 0,
      reason: activePlanText,
      chipSet,
      isSecondHalf,
      halfStartGW,
      halfEndGW,
      currentFT: ftAllowance,
      openingNarrative,
      chipParagraphs,
      allUsed: false,
    };
  }, [
    subTab,
    activeManager,
    activeSquad,
    playerPool,
    scoutChipSetSimByGw,
    leagueData?.all_chips_used,
    effectiveStandingsGW,
    isId,
    targetNextGW,
    ftAllowance,
  ]);

  // ==========================================
  // 5. SUBTAB: TRANSFER (DB-Driven Multi-FT & Unlimited Optimal Hit Optimizer)
  // ==========================================

  const transferRecommendation = useMemo(() => {
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const completedGws = Math.max(baseHistoricalGW, 1);
    const horizonCount = Math.min(transferHorizon, Math.max(1, 38 - targetNextGW + 1));
    const horizonEndGw = Math.min(targetNextGW + horizonCount - 1, 38);
    const horizonLabel = horizonCount === 1 ? `GW${targetNextGW}` : `${horizonCount} GW`;

    if (subTab !== 'transfer' || !activeManager || activeSquad.length === 0 || playerPool.length === 0) {
      return {
        needTransfer: false,
        moves: [] as any[],
        netGain: 0,
        hitCount: 0,
        hitCost: 0,
        ftUsed: 0,
        reason: '',
        reasonParagraphs: [] as string[],
        startXiXpH: 0,
        endXiXpH: 0,
        startBank: round1(bankBalance),
        endBank: round1(bankBalance),
        startFormation: '3-4-3',
        endFormation: '3-4-3',
        horizonCount,
        horizonEndGw,
        horizonLabel,
      };
    }

    const poolMap = new Map(playerPool.map((p) => [p.id, p]));
    const currentSquad15 = activeSquad
      .map((s) => poolMap.get(s.player.id))
      .filter((p): p is (typeof playerPool)[number] => Boolean(p));

    if (currentSquad15.length < 11) {
      return {
        needTransfer: false,
        moves: [] as any[],
        netGain: 0,
        hitCount: 0,
        hitCost: 0,
        ftUsed: 0,
        reason: '',
        reasonParagraphs: [] as string[],
        startXiXpH: 0,
        endXiXpH: 0,
        startBank: round1(bankBalance),
        endBank: round1(bankBalance),
        startFormation: '3-4-3',
        endFormation: '3-4-3',
        horizonCount,
        horizonEndGw,
        horizonLabel,
      };
    }

    // Per-player effective value profile parameterized dynamically across 1 / 3 / 6 GW horizon
    const getEffProfile = (p: (typeof playerPool)[number]) => {
      const minsPerGw = p.mins / completedGws;
      const isOutStatus = p.status === 'i' || p.status === 's' || p.status === 'u';
      const isSevereDoubt = p.status === 'd' && p.chanceOfPlaying !== null && p.chanceOfPlaying <= 25;
      const isDoubt = p.status === 'd' && !isSevereDoubt;
      const isBenchFodder = !isOutStatus && !isSevereDoubt && (minsPerGw < 25 || (completedGws >= 3 && p.mins < 75));
      const isRotationRisk = !isOutStatus && !isSevereDoubt && !isBenchFodder && minsPerGw < 45;

      let availWeights: number[];
      if (isOutStatus) {
        availWeights = [0.0, 0.15, 0.35, 0.55, 0.70, 0.80];
      } else if (isSevereDoubt) {
        const ch1 = Math.max(0.0, (p.chanceOfPlaying ?? 0) / 100);
        availWeights = [ch1, 0.35, 0.60, 0.80, 0.90, 1.0];
      } else if (isDoubt) {
        const ch = (p.chanceOfPlaying ?? 60) / 100;
        availWeights = [ch, Math.min(1.0, ch + 0.25), Math.min(1.0, ch + 0.40), 1.0, 1.0, 1.0];
      } else {
        availWeights = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
      }

      const minsMult = isBenchFodder ? 0.15 : isRotationRisk ? 0.68 : 1.0;
      const g1 = p.fixtures6?.[0]?.xp ?? p.xP1;
      const horizonFixtures = (p.fixtures6 || []).slice(0, horizonCount);

      let sumH = 0;
      for (let i = 0; i < horizonCount; i++) {
        const gwXp = p.fixtures6?.[i]?.xp ?? g1;
        const w = availWeights[Math.min(i, availWeights.length - 1)];
        sumH += gwXp * w * minsMult;
      }

      const effXp1 = round2(g1 * availWeights[0] * minsMult);
      const effXpH = round2(sumH);

      const sampleMins = Math.max(p.mins, 90);
      const xGi90 = round2((p.xGI / sampleMins) * 90);
      const threat90 = round1((p.threat / sampleMins) * 90);
      const creat90 = round1((p.creativity / sampleMins) * 90);
      const hasExplosiveUpside = p.hauls >= 2 || p.maxGwPoints >= 11 || p.captainScore >= 52 || xGi90 >= 0.52;
      const explosiveBonus = p.hauls >= 2 ? 1.1 : (p.maxGwPoints >= 11 || p.captainScore >= 52 || xGi90 >= 0.55) ? 0.65 : 0.0;

      return {
        p,
        minsPerGw: Math.round(minsPerGw),
        isBroken: isOutStatus || isSevereDoubt || isBenchFodder,
        isOutStatus: isOutStatus || isSevereDoubt,
        isBenchFodder,
        isDoubt,
        isNailedSafe: p.status === 'a' && minsPerGw >= 50,
        effXp1,
        effXpH,
        horizonFixtures,
        xGi90,
        threat90,
        creat90,
        hasExplosiveUpside,
        explosiveBonus,
      };
    };

    type EffPlayer = ReturnType<typeof getEffProfile>;
    const effById = new Map<number, EffPlayer>();
    for (const p of playerPool) {
      effById.set(p.id, getEffProfile(p));
    }
    const getEff = (id: number) => effById.get(id)!;

    // Legal FPL Starting XI Solver (evaluates all valid formations: 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD)
    const VALID_FORMATIONS: Array<[number, number, number]> = [
      [3, 4, 3],
      [3, 5, 2],
      [4, 3, 3],
      [4, 4, 2],
      [4, 5, 1],
      [5, 3, 2],
      [5, 4, 1],
      [5, 2, 3],
    ];

    const solveOptimalXI = (squadIds: number[]) => {
      const gkps: EffPlayer[] = [];
      const defs: EffPlayer[] = [];
      const mids: EffPlayer[] = [];
      const fwds: EffPlayer[] = [];

      for (let i = 0; i < squadIds.length; i++) {
        const item = getEff(squadIds[i]);
        if (!item) continue;
        const pos = item.p.position;
        if (pos === 'GKP') gkps.push(item);
        else if (pos === 'DEF') defs.push(item);
        else if (pos === 'MID') mids.push(item);
        else fwds.push(item);
      }

      const byEff = (a: EffPlayer, b: EffPlayer) => b.effXpH - a.effXpH || b.effXp1 - a.effXp1;
      gkps.sort(byEff);
      defs.sort(byEff);
      mids.sort(byEff);
      fwds.sort(byEff);

      const startGkp = gkps[0];
      const benchGkp = gkps[1];

      // Precompute prefix sums for O(1) formation scoring across all 8 formations
      const defPref = [0];
      for (let i = 0; i < defs.length; i++) defPref.push(defPref[i] + defs[i].effXpH);
      const midPref = [0];
      for (let i = 0; i < mids.length; i++) midPref.push(midPref[i] + mids[i].effXpH);
      const fwdPref = [0];
      for (let i = 0; i < fwds.length; i++) fwdPref.push(fwdPref[i] + fwds[i].effXpH);

      let bestD = -1;
      let bestM = -1;
      let bestF = -1;
      let bestObj = -1e9;

      for (let f = 0; f < VALID_FORMATIONS.length; f++) {
        const [dCount, mCount, fCount] = VALID_FORMATIONS[f];
        if (defs.length < dCount || mids.length < mCount || fwds.length < fCount) continue;
        const obj = defPref[dCount] + midPref[mCount] + fwdPref[fCount];
        if (obj > bestObj) {
          bestObj = obj;
          bestD = dCount;
          bestM = mCount;
          bestF = fCount;
        }
      }

      let bestFormLabel = '3-4-3';
      let bestStarters: EffPlayer[];
      let bestBenchOut: EffPlayer[];

      if (bestD >= 0) {
        bestFormLabel = `${bestD}-${bestM}-${bestF}`;
        bestStarters = startGkp ? [startGkp] : [];
        for (let i = 0; i < bestD; i++) bestStarters.push(defs[i]);
        for (let i = 0; i < bestM; i++) bestStarters.push(mids[i]);
        for (let i = 0; i < bestF; i++) bestStarters.push(fwds[i]);

        bestBenchOut = [];
        for (let i = bestD; i < defs.length; i++) bestBenchOut.push(defs[i]);
        for (let i = bestM; i < mids.length; i++) bestBenchOut.push(mids[i]);
        for (let i = bestF; i < fwds.length; i++) bestBenchOut.push(fwds[i]);
        bestBenchOut.sort(byEff);
      } else {
        const sortedAll = [...gkps, ...defs, ...mids, ...fwds].sort((a, b) => b.effXpH - a.effXpH);
        bestStarters = sortedAll.slice(0, 11);
        bestBenchOut = sortedAll.slice(11);
      }

      const bench = benchGkp ? [benchGkp, ...bestBenchOut] : bestBenchOut;
      let rawXiXp1 = 0;
      let rawXiXpH = 0;
      let rawStartersCost = 0;
      let brokenStarters = 0;
      let safeStarterCount = 0;
      for (let i = 0; i < bestStarters.length; i++) {
        const x = bestStarters[i];
        rawXiXp1 += x.effXp1;
        rawXiXpH += x.effXpH;
        rawStartersCost += x.p.cost;
        if (x.isBroken) brokenStarters++;
        if (x.isNailedSafe) safeStarterCount++;
      }
      let benchPlayables = 0;
      for (let i = 0; i < bestBenchOut.length; i++) {
        if (bestBenchOut[i].isNailedSafe) benchPlayables++;
      }

      const xiXp1 = round1(rawXiXp1);
      const xiXpH = round1(rawXiXpH);
      const benchDepthH = round2(
        (bestBenchOut[0]?.effXpH || 0) * 0.05 +
        (bestBenchOut[1]?.effXpH || 0) * 0.02 +
        (benchGkp?.effXpH || 0) * 0.01
      );
      const startersCost = round1(rawStartersCost);

      return {
        starters: bestStarters,
        bench,
        formation: bestFormLabel,
        xiXp1,
        xiXpH,
        benchDepthH,
        brokenStarters,
        safeStarterCount,
        benchPlayables,
        startersCost,
      };
    };

    const baseIds = currentSquad15.map((p) => p.id);
    const baseXI = solveOptimalXI(baseIds);

    // Dynamic "Nilai 1 FT" (Opportunity Cost) scaled to active horizon
    const normalFtValue =
      horizonCount === 1
        ? ftAllowance >= 5 ? 1.2 : ftAllowance === 4 ? 2.0 : 2.8
        : horizonCount <= 3
        ? ftAllowance >= 5 ? 1.5 : ftAllowance === 4 ? 2.5 : 3.4
        : ftAllowance >= 5 ? 1.8 : ftAllowance === 4 ? 3.2 : 4.4;
    const repairFtValue = horizonCount === 1 ? 1.2 : horizonCount <= 3 ? 1.5 : 1.8;
    const getFtCostForStep = (stepIndex1Based: number) => {
      return stepIndex1Based <= baseXI.brokenStarters ? repairFtValue : normalFtValue;
    };

    // Build wide candidate IN pool per position maximizing horizon points across all price tiers within budget
    const baseIdSet = new Set(baseIds);
    const fitInPool = playerPool
      .filter((p) => p.status === 'a' && p.mins >= Math.min(135, completedGws * 25) && !baseIdSet.has(p.id))
      .map((p) => getEff(p.id));

    const candidatesByPos: Record<string, EffPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
    for (const pos of ['GKP', 'DEF', 'MID', 'FWD']) {
      const posList = fitInPool.filter((e) => e.p.position === pos);
      const topByXp = [...posList]
        .sort((a, b) => b.effXpH - a.effXpH || b.effXp1 - a.effXp1)
        .slice(0, 18);
      const topEnablers = [...posList]
        .filter((e) => e.p.cost <= (pos === 'FWD' ? 6.0 : pos === 'MID' ? 5.5 : 4.6) && e.minsPerGw >= 55)
        .sort((a, b) => b.effXpH / Math.max(b.p.cost, 4) - a.effXpH / Math.max(a.p.cost, 4))
        .slice(0, 4);
      const merged = new Map<number, EffPlayer>();
      for (const item of [...topByXp, ...topEnablers]) {
        merged.set(item.p.id, item);
      }
      candidatesByPos[pos] = Array.from(merged.values());
    }

    interface TransferStep {
      out: EffPlayer;
      in: EffPlayer;
      bankBefore: number;
      bankAfter: number;
      isHit: boolean;
      stepNum: number;
    }

    interface SearchState {
      squadIds: number[];
      bank: number;
      moves: TransferStep[];
      xi: ReturnType<typeof solveOptimalXI>;
      xiGain1: number;
      xiGainH: number;
      depthGainH: number;
      explosiveDelta: number;
      provenPenalty: number;
      ftCost: number;
      hitCount: number;
      hitCost: number;
      netDecisionScore: number;
      meetsHitGuard: boolean;
    }

    const hitSurplusMargin = horizonCount === 1 ? 1.5 : horizonCount <= 3 ? 2.5 : 4.0;

    const evaluateState = (squadIds: number[], bank: number, moves: TransferStep[]): SearchState => {
      const xi = moves.length === 0 ? baseXI : solveOptimalXI(squadIds);
      const xiGain1 = round1(xi.xiXp1 - baseXI.xiXp1);
      const xiGainH = round1(xi.xiXpH - baseXI.xiXpH);
      // Subtle bench tie-breaker only (never enough to trigger or subsidize a -4 hit)
      const depthGainH = round2(Math.max(-1.0, Math.min(1.2, xi.benchDepthH - baseXI.benchDepthH)));
      // Tiny positive preference for utilizing available budget toward stronger on-pitch XI when points are close
      const budgetUtilizationTieBreak = round2(Math.max(0, xi.startersCost - baseXI.startersCost) * 0.005);

      let explosiveDelta = 0;
      let provenPenalty = 0;
      for (const m of moves) {
        explosiveDelta += 0.25 * (m.in.explosiveBonus - 0.5 * m.out.explosiveBonus);
        if (m.out.p.proven?.isProven && m.out.p.status === 'a') {
          provenPenalty += m.out.p.proven.tier === 'ELITE' ? 2.5 : 1.5;
        }
      }
      explosiveDelta = round2(explosiveDelta);
      provenPenalty = round2(provenPenalty);

      const k = moves.length;
      const ftUsed = Math.min(k, ftAllowance);
      const hitCount = Math.max(0, k - ftAllowance);
      const hitCost = hitCount * 4;

      let ftCost = 0;
      for (let i = 1; i <= ftUsed; i++) {
        ftCost += getFtCostForStep(i);
      }
      ftCost = round2(ftCost);

      // Hit viability guard: each hit must recover -4 AND add meaningful urgency margin in Starting XI xP
      const repairedStarter = xi.brokenStarters < baseXI.brokenStarters;
      const meetsHitGuard =
        hitCount === 0 ||
        (xiGainH >= hitCost + hitCount * hitSurplusMargin &&
          (horizonCount === 1 ? xiGain1 > 0 : xiGain1 >= -0.5 || repairedStarter));

      // Account for future-FT opportunity cost on hits so extra hits stop when diminishing returns kick in
      const effectiveHitCost = hitCost + hitCount * hitSurplusMargin;
      const netDecisionScore = round2(
        xiGainH + depthGainH + explosiveDelta + budgetUtilizationTieBreak - provenPenalty - effectiveHitCost - ftCost
      );

      return {
        squadIds,
        bank: round1(bank),
        moves,
        xi,
        xiGain1,
        xiGainH,
        depthGainH,
        explosiveDelta,
        provenPenalty,
        ftCost,
        hitCount,
        hitCost,
        netDecisionScore,
        meetsHitGuard,
      };
    };

    const initialState = evaluateState(baseIds, round1(bankBalance), []);
    const isHitMode = transferMode === 'HIT';
    // Unlimited hits based on squad needs (up to full 15-man squad if crisis like 10 injured players)
    const maxDepth = isHitMode ? 15 : ftAllowance;

    const allEvaluatedStates: SearchState[] = [initialState];
    let frontier: SearchState[] = [initialState];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextMap = new Map<string, SearchState>();

      for (const state of frontier) {
        const currentSet = new Set(state.squadIds);
        const boughtIds = new Set(state.moves.map((m) => m.in.p.id));
        const soldIds = new Set(state.moves.map((m) => m.out.p.id));
        const clubCounts: Record<string, number> = {};
        for (const id of state.squadIds) {
          const team = getEff(id)?.p.teamShort;
          if (team) clubCounts[team] = (clubCounts[team] || 0) + 1;
        }

        // At deep hit depths, prioritize fixing remaining broken/weak slots so search remains <15ms up to 15 moves
        const outOrder = [...state.squadIds]
          .filter((id) => !boughtIds.has(id))
          .sort((a, b) => Number(getEff(b)?.isBroken || 0) - Number(getEff(a)?.isBroken || 0) || (getEff(a)?.effXpH || 0) - (getEff(b)?.effXpH || 0));

        const outCandidates = depth > ftAllowance + 2 ? outOrder.slice(0, 8) : outOrder;

        for (const outId of outCandidates) {
          const outEff = getEff(outId);
          if (!outEff) continue;
          const pos = outEff.p.position;
          const inCandidates = candidatesByPos[pos] || [];

          for (const inEff of inCandidates) {
            if (currentSet.has(inEff.p.id) || soldIds.has(inEff.p.id)) continue;
            const newBank = round1(state.bank + outEff.p.cost - inEff.p.cost);
            if (newBank < -0.05) continue;

            // Enforce max 3 players per Premier League club
            const nextClubCount =
              (clubCounts[inEff.p.teamShort] || 0) + (inEff.p.teamShort === outEff.p.teamShort ? 0 : 1);
            if (nextClubCount > 3) continue;

            const newSquadIds = state.squadIds.map((id) => (id === outId ? inEff.p.id : id));
            const step: TransferStep = {
              out: outEff,
              in: inEff,
              bankBefore: state.bank,
              bankAfter: Math.max(0, newBank),
              isHit: depth > ftAllowance,
              stepNum: depth,
            };
            const evaluated = evaluateState(newSquadIds, Math.max(0, newBank), [...state.moves, step]);

            // Allow budget-freeing step to continue searching even in hit mode, otherwise prune strictly worse hit steps
            const isBudgetUnlock = newBank >= state.bank + 1.5;
            if (depth > ftAllowance && !isBudgetUnlock && evaluated.netDecisionScore <= state.netDecisionScore + 0.2) {
              continue;
            }

            const key = [...newSquadIds].sort((a, b) => a - b).join(',');
            const existing = nextMap.get(key);
            if (!existing || evaluated.netDecisionScore > existing.netDecisionScore) {
              nextMap.set(key, evaluated);
            }
          }
        }
      }

      const layerStates = Array.from(nextMap.values());
      if (layerStates.length === 0) break;

      for (const st of layerStates) {
        if (st.meetsHitGuard) {
          allEvaluatedStates.push(st);
        }
      }

      const byScore = [...layerStates].sort((a, b) => b.netDecisionScore - a.netDecisionScore).slice(0, 10);
      const byBankUnlock = [...layerStates]
        .filter((s) => s.bank >= round1(initialState.bank + 1.5))
        .sort((a, b) => b.bank - a.bank || b.netDecisionScore - a.netDecisionScore)
        .slice(0, 3);

      const mergedBeam = new Map<string, SearchState>();
      for (const s of [...byScore, ...byBankUnlock]) {
        const k = [...s.squadIds].sort((a, b) => a - b).join(',');
        mergedBeam.set(k, s);
      }
      frontier = Array.from(mergedBeam.values());
    }

    // Reject any hit plan where fewer transfers/hits achieve nearly the same or better real XI net (prevents good FTs from subsidizing marginal extra hits)
    const bestRealXiNetByHit = new Map<number, number>();
    for (const st of allEvaluatedStates) {
      const realNet = round1(st.xiGainH - st.hitCost);
      const prevBest = bestRealXiNetByHit.get(st.hitCount);
      if (prevBest === undefined || realNet > prevBest) {
        bestRealXiNetByHit.set(st.hitCount, realNet);
      }
    }

    const marginalHitMargin = horizonCount === 1 ? 1.5 : horizonCount <= 3 ? 2.5 : 3.5;
    const marginallyValidStates = allEvaluatedStates.filter((st) => {
      if (st.hitCount === 0) return true;
      const stRealNet = round1(st.xiGainH - st.hitCost);
      for (const [prevHit, prevRealNet] of bestRealXiNetByHit.entries()) {
        if (prevHit < st.hitCount) {
          const extraHits = st.hitCount - prevHit;
          if (stRealNet < prevRealNet + extraHits * marginalHitMargin) {
            return false;
          }
        }
      }
      return true;
    });

    const sortedBest = [...marginallyValidStates].sort(
      (a, b) => b.netDecisionScore - a.netDecisionScore || a.hitCount - b.hitCount
    );
    const bestState = sortedBest[0] || initialState;
    const needTransfer = bestState.moves.length > 0 && bestState.netDecisionScore > 0;
    const ftUsed = Math.min(bestState.moves.length, ftAllowance);
    const savedFt = Math.max(0, ftAllowance - ftUsed);
    const netGain = round1(bestState.xiGainH - bestState.hitCost);

    const formatFixturesText = (eff: EffPlayer) => {
      const list = eff.horizonFixtures;
      if (list.length <= 3) {
        return list.map((f) => `${f.opp} (${f.xp.toFixed(1)} xP)`).join(', ');
      }
      const head = list.slice(0, 3).map((f) => `${f.opp} (${f.xp.toFixed(1)} xP)`).join(', ');
      const tail = list.slice(3).map((f) => f.opp).join(', ');
      return `${head}, ${tail}`;
    };

    const windowPhraseId =
      horizonCount === 1
        ? `menatap GW${targetNextGW}`
        : `untuk ${horizonCount} pekan ke depan (GW${targetNextGW}–GW${horizonEndGw})`;
    const windowPhraseEn =
      horizonCount === 1
        ? `heading into GW${targetNextGW}`
        : `across the next ${horizonCount} Gameweeks (GW${targetNextGW}–GW${horizonEndGw})`;

    const baseSeed = Math.abs(
      (activeManager.entry_id || 1) * 31 + targetNextGW * 17 + horizonCount * 13 + bestState.moves.length * 7
    );

    const reasonParagraphs: string[] = [];
    if (needTransfer) {
      const formChanged = baseXI.formation !== bestState.xi.formation;
      const formTxtId = formChanged
        ? `mengubah skema menjadi ${bestState.xi.formation}`
        : `menjaga kerangka ${bestState.xi.formation}`;
      const formTxtEn = formChanged
        ? `reshaping into ${bestState.xi.formation}`
        : `keeping a ${bestState.xi.formation} shape`;
      const bankMoved = Math.abs(round1(bankBalance) - bestState.bank) >= 0.1;
      const bankNoteId = bankMoved
        ? `sisa dana bergeser dari £${round1(bankBalance).toFixed(1)}m ke £${bestState.bank.toFixed(1)}m`
        : `dana bank tetap rapi di £${bestState.bank.toFixed(1)}m`;
      const bankNoteEn = bankMoved
        ? `leaving £${bestState.bank.toFixed(1)}m in the bank (from £${round1(bankBalance).toFixed(1)}m)`
        : `keeping £${bestState.bank.toFixed(1)}m in the bank`;

      if (bestState.hitCount > 0) {
        const hitOpenersId = [
          `Mengambil ${bestState.hitCount}x hit (-${bestState.hitCost} pts) mendampingi ${ftUsed} FT terhitung agresif namun rasional ${windowPhraseId}. Dengan ${formTxtId}, proyeksi Starting XI melonjak dari ${baseXI.xiXpH.toFixed(1)} ke ${bestState.xi.xiXpH.toFixed(1)} pts (+${bestState.xiGainH.toFixed(1)} pts kotor)—cukup lebar untuk menutup penalti dan mengantongi surplus +${netGain.toFixed(1)} pts (${bankNoteId}).`,
          `Penalti -${bestState.hitCost} pts dari ${bestState.hitCount}x hit bukan halangan ${windowPhraseId} karena lonjakan poinnya sangat terasa. Skuad inti (${bestState.xi.formation}) naik kelas dari ${baseXI.xiXpH.toFixed(1)} menjadi ${bestState.xi.xiXpH.toFixed(1)} pts, menyisakan untung bersih +${netGain.toFixed(1)} pts dengan ${bankNoteId}.`,
          `Kombinasi ${ftUsed} FT plus ${bestState.hitCount}x hit (-${bestState.hitCost} pts) jadi jalan tercepat menambal celah tim ${windowPhraseId}. Rombakan ini mengangkat estimasi Starting XI ke ${bestState.xi.xiXpH.toFixed(1)} pts dari semula ${baseXI.xiXpH.toFixed(1)} pts—net +${netGain.toFixed(1)} pts setelah dipotong biaya hit, sekaligus membuat ${bankNoteId}.`,
          `Daripada membiarkan titik lemah menggerus poin ${windowPhraseId}, memakai ${ftUsed} FT beserta ${bestState.hitCount}x hit (-${bestState.hitCost} pts) memberi imbal balik yang jelas. Skema ${bestState.xi.formation} menghasilkan kenaikan Starting XI +${bestState.xiGainH.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) atau +${netGain.toFixed(1)} pts bersih (${bankNoteId}).`,
        ];
        const hitOpenersEn = [
          `Taking ${bestState.hitCount}x hit (-${bestState.hitCost} pts) alongside ${ftUsed} FT is an aggressive yet calculated call ${windowPhraseEn}. By ${formTxtEn}, projected Starting XI output climbs from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts, clearing the penalty for a +${netGain.toFixed(1)} pts net edge while ${bankNoteEn}.`,
          `Paying a -${bestState.hitCost} pts hit (${bestState.hitCount}x) pays off ${windowPhraseEn}: moving into ${bestState.xi.formation} boosts Starting XI expectation from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts, leaving +${netGain.toFixed(1)} pts in net profit and ${bankNoteEn}.`,
          `Pairing ${ftUsed} FT with ${bestState.hitCount}x hit (-${bestState.hitCost} pts) fixes key weak spots immediately ${windowPhraseEn}. Your XI rises by +${bestState.xiGainH.toFixed(1)} pts gross (+${netGain.toFixed(1)} pts net) while ${bankNoteEn}.`,
          `Rather than carrying deadweight ${windowPhraseEn}, investing ${ftUsed} FT and ${bestState.hitCount}x hit (-${bestState.hitCost} pts) transforms the XI to ${bestState.xi.xiXpH.toFixed(1)} pts (up from ${baseXI.xiXpH.toFixed(1)}) for a +${netGain.toFixed(1)} pts net gain, ${bankNoteEn}.`,
        ];
        reasonParagraphs.push(
          isId
            ? hitOpenersId[baseSeed % hitOpenersId.length]
            : hitOpenersEn[baseSeed % hitOpenersEn.length]
        );
      } else {
        const rollClauseId = savedFt > 0 ? ` sembari menabung ${savedFt} FT untuk pekan depan` : '';
        const rollClauseEn = savedFt > 0 ? ` while rolling ${savedFt} FT into next week` : '';
        const ftOpenersId = [
          `Mengaktifkan ${ftUsed} dari ${ftAllowance} Free Transfer${rollClauseId} adalah manuver paling efisien ${windowPhraseId}. Selain ${formTxtId}, proyeksi Starting XI terdongkrak dari ${baseXI.xiXpH.toFixed(1)} ke ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts bersih) dan ${bankNoteId}.`,
          `Tanpa perlu mengambil penalti poin, ${ftUsed} FT${rollClauseId} sudah cukup untuk mempertajam skuad ${windowPhraseId}. Estimasi Starting XI bergerak naik dari ${baseXI.xiXpH.toFixed(1)} menuju ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts) lewat skema ${bestState.xi.formation}, dengan ${bankNoteId}.`,
          `Peluang peningkatan poin paling bersih ${windowPhraseId} datang dari pemakaian ${ftUsed} FT${savedFt > 0 ? ` (sisa ${savedFt} FT tetap aman)` : ''}. Susunan inti ${bestState.xi.formation} kini memproyeksikan ${bestState.xi.xiXpH.toFixed(1)} pts—unggul +${netGain.toFixed(1)} pts dari skuad awal—sementara ${bankNoteId}.`,
          `Fokus utama ${windowPhraseId} adalah memaksimalkan ${ftUsed} dari ${ftAllowance} jatah FT yang tersedia${rollClauseId}. Pergerakan ini langsung menaikkan angka harapan Starting XI sebesar +${netGain.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) dengan ${bankNoteId}.`,
        ];
        const ftOpenersEn = [
          `Deploying ${ftUsed} of ${ftAllowance} Free Transfers${rollClauseEn} is the sharpest move ${windowPhraseEn}. Beyond ${formTxtEn}, your Starting XI rises from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts net), ${bankNoteEn}.`,
          `Without taking a single hit, using ${ftUsed} FT${rollClauseEn} meaningfully upgrades the XI ${windowPhraseEn}—lifting output from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts) while ${bankNoteEn}.`,
          `The cleanest value play ${windowPhraseEn} uses ${ftUsed} FT${savedFt > 0 ? ` (keeping ${savedFt} FT in reserve)` : ''}, raising XI expectation to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts gain) and ${bankNoteEn}.`,
          `Putting ${ftUsed} of ${ftAllowance} FTs to work${rollClauseEn} boosts Starting XI potential by +${netGain.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) ${windowPhraseEn}, ${bankNoteEn}.`,
        ];
        reasonParagraphs.push(
          isId
            ? ftOpenersId[baseSeed % ftOpenersId.length]
            : ftOpenersEn[baseSeed % ftOpenersEn.length]
        );
      }

      bestState.moves.forEach((m, moveIdx) => {
        const outP = m.out.p;
        const inP = m.in.p;
        const xpDiff = round1(m.in.effXpH - m.out.effXpH);
        const outFixStr = formatFixturesText(m.out) || '-';
        const inFixStr = formatFixturesText(m.in) || '-';

        // Varied OUT narratives per diagnosis reason (strict round-robin offset guarantees adjacent moves never collide)
        let outSentenceId = '';
        let outSentenceEn = '';
        if (m.out.isOutStatus) {
          const stTextId = outP.status === 's' ? 'terkena suspensi' : outP.status === 'i' ? 'dibekap cedera' : 'diragukan berat tampil';
          const chanceId = outP.chanceOfPlaying !== null ? ` (${outP.chanceOfPlaying}% peluang main)` : '';
          const newsNote = outP.news ? ` — "${outP.news}"` : '';
          const outVariantsId = [
            `Mengandalkan ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) terlalu berisiko setelah ia ${stTextId}${chanceId}${newsNote}, membuat proyeksinya mentok di ${m.out.effXpH.toFixed(1)} pts melawan ${outFixStr}.`,
            `Kabar terbaru memaksa kita mencoret ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) yang sedang ${stTextId}${chanceId}${newsNote}; menghadapi ${outFixStr}, ekspektasi poinnya turun ke ${m.out.effXpH.toFixed(1)} pts.`,
            `Slot ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) butuh penanganan cepat karena statusnya ${stTextId}${chanceId}${newsNote}, sehingga potensi poinnya hanya ${m.out.effXpH.toFixed(1)} pts pada laga ${outFixStr}.`,
          ];
          const stTextEn = outP.status === 's' ? 'suspended' : outP.status === 'i' ? 'injured' : 'a major doubt';
          const chanceEn = outP.chanceOfPlaying !== null ? ` (${outP.chanceOfPlaying}% chance)` : '';
          const outVariantsEn = [
            `Holding ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) carries too much risk while he is ${stTextEn}${chanceEn}${newsNote}, leaving him at just ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
            `Availability concerns force an exit for ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m), currently ${stTextEn}${chanceEn}${newsNote} with only ${m.out.effXpH.toFixed(1)} pts projected versus ${outFixStr}.`,
            `${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) needs replacing immediately after being flagged ${stTextEn}${chanceEn}${newsNote}, capping his output at ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
          ];
          const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
          outSentenceId = outVariantsId[outIdx];
          outSentenceEn = outVariantsEn[outIdx];
        } else if (m.out.isBenchFodder) {
          const outVariantsId = [
            `Slot ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) praktis menganggur karena baru mengumpulkan ${outP.mins} menit (${m.out.minsPerGw} mnt/GW, ${outP.starts} starter), dengan proyeksi hanya ${m.out.effXpH.toFixed(1)} pts saat meladeni ${outFixStr}.`,
            `Minimnya jam terbang ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m)—cuma ${outP.mins} menit dari ${outP.starts} kali starter—membuat nilainya tertahan di ${m.out.effXpH.toFixed(1)} pts di laga ${outFixStr}.`,
            `Mempertahankan ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) sulit memberi kontribusi nyata mengingat menit bermainnya baru ${outP.mins} mnt (rata-rata ${m.out.minsPerGw} mnt/GW) dan proyeksi ${m.out.effXpH.toFixed(1)} pts menghadapi ${outFixStr}.`,
          ];
          const outVariantsEn = [
            `${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) has become deadwood at just ${outP.mins} minutes (${m.out.minsPerGw}/GW, ${outP.starts} starts), projecting only ${m.out.effXpH.toFixed(1)} pts versus ${outFixStr}.`,
            `Lack of pitch time makes ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) an easy sell—only ${outP.mins} mins across ${outP.starts} starts leaves him at ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
            `Keeping ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) wastes a squad spot while he sits on ${outP.mins} mins (${m.out.minsPerGw}/GW) and ${m.out.effXpH.toFixed(1)} projected pts for ${outFixStr}.`,
          ];
          const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
          outSentenceId = outVariantsId[outIdx];
          outSentenceEn = outVariantsEn[outIdx];
        } else if (m.out.isDoubt) {
          const newsNote = outP.news ? `, "${outP.news}"` : '';
          const outVariantsId = [
            `Status ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) yang masih abu-abu (${outP.chanceOfPlaying ?? 50}% peluang tampil${newsNote}) memangkas ekspektasinya menjadi ${m.out.effXpH.toFixed(1)} pts menghadapi ${outFixStr}.`,
            `Dengan kondisi kebugaran ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) belum 100% (${outP.chanceOfPlaying ?? 50}%${newsNote}), proyeksi poinnya menyusut ke ${m.out.effXpH.toFixed(1)} pts melawan ${outFixStr}.`,
          ];
          const outVariantsEn = [
            `With ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) flagged doubtful (${outP.chanceOfPlaying ?? 50}% chance${newsNote}), his projection drops to ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
            `Fitness uncertainty around ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) (${outP.chanceOfPlaying ?? 50}%${newsNote}) pulls his expectation down to ${m.out.effXpH.toFixed(1)} pts versus ${outFixStr}.`,
          ];
          const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
          outSentenceId = outVariantsId[outIdx];
          outSentenceEn = outVariantsEn[outIdx];
        } else {
          const isOutDef = outP.position === 'DEF' || outP.position === 'GKP';
          const outStatId = isOutDef
            ? `${outP.pts} pts, ${outP.cleanSheets} clean sheet, Form ${outP.form.toFixed(1)}`
            : `${outP.pts} pts (${outP.goals}G/${outP.assists}A), Form ${outP.form.toFixed(1)}, ${m.out.xGi90.toFixed(2)} xGI/90'`;
          const outVariantsId = [
            `Meski ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) mengantongi ${outStatId}, lajunya tertahan jadwal ${outFixStr} yang cuma menjanjikan ${m.out.effXpH.toFixed(1)} pts sehingga dananya layak dialihkan.`,
            `Melepas ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) memang tak mudah menilik catatan ${outStatId}, namun benturan lawan ${outFixStr} membatasi proyeksinya di ${m.out.effXpH.toFixed(1)} pts.`,
            `Di atas kertas ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) cukup solid (${outStatId}), tetapi menghadapi ${outFixStr} plafon poinnya melandai ke ${m.out.effXpH.toFixed(1)} pts—membuka ruang untuk opsi yang lebih tajam.`,
            `Dana £${outP.cost.toFixed(1)}m pada ${outP.webName} (${outP.clubName}) mulai kurang maksimal; kendati mencatat ${outStatId}, duel ${outFixStr} hanya memberinya proyeksi ${m.out.effXpH.toFixed(1)} pts.`,
          ];
          const outStatEn = isOutDef
            ? `${outP.pts} pts, ${outP.cleanSheets} clean sheets, Form ${outP.form.toFixed(1)}`
            : `${outP.pts} pts (${outP.goals}G/${outP.assists}A), Form ${outP.form.toFixed(1)}, ${m.out.xGi90.toFixed(2)} xGI/90'`;
          const outVariantsEn = [
            `Although ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) holds ${outStatEn}, a tougher schedule (${outFixStr}) caps him at ${m.out.effXpH.toFixed(1)} pts and opens an upgrade route.`,
            `Parting with ${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) comes despite ${outStatEn}, as ${outFixStr} suppresses his projection to ${m.out.effXpH.toFixed(1)} pts.`,
            `${outP.webName} (${outP.clubName}, £${outP.cost.toFixed(1)}m) has delivered ${outStatEn}, yet ${outFixStr} limits his ceiling to ${m.out.effXpH.toFixed(1)} pts when better fixtures beckon elsewhere.`,
            `Reallocating £${outP.cost.toFixed(1)}m from ${outP.webName} (${outP.clubName}, ${outStatEn}) makes tactical sense with ${outFixStr} yielding just ${m.out.effXpH.toFixed(1)} pts.`,
          ];
          const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
          outSentenceId = outVariantsId[outIdx];
          outSentenceEn = outVariantsEn[outIdx];
        }

        // Rich, varied IN player spotlights tailored by position, ownership, hauls, and dead-ball role
        const isInDef = inP.position === 'DEF' || inP.position === 'GKP';
        const hitTagId = m.isHit ? ' lewat Hit (-4)' : '';
        const hitTagEn = m.isHit ? ' (for a -4 hit)' : '';
        const ownTagId =
          inP.fnbOwn < 6
            ? `masih berstatus pembeda langka (${inP.fnbOwn.toFixed(1)}% kepemilikan liga)`
            : inP.fnbOwn > 35
            ? `menjadi aset populer (${inP.fnbOwn.toFixed(1)}% kepemilikan liga) untuk melindungi peringkat`
            : `berada di kepemilikan ${inP.fnbOwn.toFixed(1)}% tim liga`;
        const ownTagEn =
          inP.fnbOwn < 6
            ? `acting as a crisp differential (${inP.fnbOwn.toFixed(1)}% league ownership)`
            : inP.fnbOwn > 35
            ? `covering a key rank threat (${inP.fnbOwn.toFixed(1)}% league ownership)`
            : `owned by ${inP.fnbOwn.toFixed(1)}% of league squads`;

        const haulTxtId =
          inP.hauls >= 2
            ? `sudah ${inP.hauls} kali meledak dua digit (puncak ${inP.maxGwPoints} pts)`
            : inP.hauls === 1
            ? `sempat mencetak skor puncak ${inP.maxGwPoints} pts`
            : `memiliki skor pekan tertinggi ${inP.maxGwPoints} pts`;
        const haulTxtEn =
          inP.hauls >= 2
            ? `already boasting ${inP.hauls} double-digit hauls (peak ${inP.maxGwPoints} pts)`
            : inP.hauls === 1
            ? `having already hit a ${inP.maxGwPoints}-pt ceiling`
            : `with a season-best ${inP.maxGwPoints} pts`;

        const deadBallNotesId: string[] = [];
        if (inP.deadBall?.isPrimaryPen) deadBallNotesId.push('algojo penalti utama');
        else if (inP.deadBall?.isSecondaryPen) deadBallNotesId.push('penendang penalti cadangan');
        if (inP.deadBall?.isCornerTaker || inP.deadBall?.isFkTaker) deadBallNotesId.push('eksekutor bola mati');
        const dbClauseId = deadBallNotesId.length > 0 ? ` Statusnya sebagai ${deadBallNotesId.join(' & ')} memberi jalur poin ekstra.` : '';

        const deadBallNotesEn: string[] = [];
        if (inP.deadBall?.isPrimaryPen) deadBallNotesEn.push('primary penalties');
        else if (inP.deadBall?.isSecondaryPen) deadBallNotesEn.push('backup penalties');
        if (inP.deadBall?.isCornerTaker || inP.deadBall?.isFkTaker) deadBallNotesEn.push('set-piece duties');
        const dbClauseEn = deadBallNotesEn.length > 0 ? ` Added ${deadBallNotesEn.join(' & ')} bolster his weekly floor.` : '';

        const attackProfileId = isInDef
          ? `${inP.cleanSheets} clean sheet${inP.goals + inP.assists > 0 ? ` ditambah ${inP.goals} gol & ${inP.assists} assist` : ''}, serta xGI ${inP.xGI.toFixed(2)} (${m.in.xGi90.toFixed(2)}/90')`
          : `${inP.goals} gol & ${inP.assists} assist dari xGI ${inP.xGI.toFixed(2)} (${m.in.xGi90.toFixed(2)}/90'), Threat ${m.in.threat90.toFixed(1)}/90', dan Creativity ${m.in.creat90.toFixed(1)}/90'`;

        const attackProfileEn = isInDef
          ? `${inP.cleanSheets} clean sheets${inP.goals + inP.assists > 0 ? ` plus ${inP.goals}G/${inP.assists}A` : ''} and ${inP.xGI.toFixed(2)} xGI (${m.in.xGi90.toFixed(2)}/90')`
          : `${inP.goals}G/${inP.assists}A from ${inP.xGI.toFixed(2)} xGI (${m.in.xGi90.toFixed(2)}/90'), ${m.in.threat90.toFixed(1)} Threat/90', and ${m.in.creat90.toFixed(1)} Creativity/90'`;

        const inVariantsId = [
          `Beralih ke ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} langsung memberi selisih +${xpDiff.toFixed(1)} pts lewat proyeksi ${m.in.effXpH.toFixed(1)} pts saat menghadapi ${inFixStr}. Ia datang bermodal ${inP.pts} poin (Form ${inP.form.toFixed(1)}, ${inP.ppg.toFixed(1)} PPG) dengan ${attackProfileId}, sekaligus ${ownTagId}.${dbClauseId}`,
          `Sebagai pengganti${hitTagId}, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m) tampil sangat menjanjikan dengan angka harapan ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts lebih tinggi) melawan ${inFixStr}. Menit bermain reguler (${inP.mins} mnt, ${inP.starts} starter) terkonversi rapi menjadi ${attackProfileId} dan ${haulTxtId}.${dbClauseId}`,
          `Kandidat paling tepat untuk mengisi slot tersebut${hitTagId} adalah ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m), yang diproyeksikan mengemas ${m.in.effXpH.toFixed(1)} pts di laga ${inFixStr}. Konsistensinya terjaga di Form ${inP.form.toFixed(1)} (${inP.ppg.toFixed(1)} PPG, total ${inP.pts} poin), ${haulTxtId}, dan kini ${ownTagId}.${dbClauseId}`,
          `Dari kacamata statistik mendasar, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} sulit dilewatkan: ${attackProfileId}. Ditopang ${inP.mins} menit tampil (${inP.starts} starter) serta Form ${inP.form.toFixed(1)}, jadwal ${inFixStr} memberinya proyeksi ${m.in.effXpH.toFixed(1)} pts—unggul +${xpDiff.toFixed(1)} pts.${dbClauseId}`,
          `Merekrut ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} menghadirkan kombinasi jadwal ramah (${inFixStr}) dan produktivitas tinggi (${inP.pts} pts, ${inP.ppg.toFixed(1)} PPG). Proyeksinya menyentuh ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts di atas ${outP.webName}), didukung ${haulTxtId} sambil tetap ${ownTagId}.${dbClauseId}`,
        ];

        const inVariantsEn = [
          `Switching to ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn} delivers a +${xpDiff.toFixed(1)} pts swing at ${m.in.effXpH.toFixed(1)} projected pts against ${inFixStr}. He arrives on ${inP.pts} total pts (Form ${inP.form.toFixed(1)}, ${inP.ppg.toFixed(1)} PPG) with ${attackProfileEn}, ${ownTagEn}.${dbClauseEn}`,
          `Coming in${hitTagEn}, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m) stands out at ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts better) facing ${inFixStr}. Nailed minutes (${inP.mins} mins, ${inP.starts} starts) fuel ${attackProfileEn}, ${haulTxtEn}.${dbClauseEn}`,
          `The standout target${hitTagEn} is ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m), rated for ${m.in.effXpH.toFixed(1)} pts over ${inFixStr}. Steady Form ${inP.form.toFixed(1)} (${inP.ppg.toFixed(1)} PPG, ${inP.pts} pts), ${haulTxtEn}, while ${ownTagEn}.${dbClauseEn}`,
          `Underlying numbers strongly back ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn}: ${attackProfileEn}. Backed by ${inP.mins} mins (${inP.starts} starts) and Form ${inP.form.toFixed(1)}, ${inFixStr} lifts him to ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts gain).${dbClauseEn}`,
          `Bringing in ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn} pairs inviting fixtures (${inFixStr}) with proven output (${inP.pts} pts, ${inP.ppg.toFixed(1)} PPG), projecting ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} over ${outP.webName}) while ${ownTagEn}.${dbClauseEn}`,
        ];

        // Guarantee distinct IN template per move index across all moves
        const inIdx = (baseSeed + moveIdx) % inVariantsId.length;
        const inSentenceId = inVariantsId[inIdx];
        const inSentenceEn = inVariantsEn[inIdx];

        reasonParagraphs.push(isId ? `${outSentenceId} ${inSentenceId}` : `${outSentenceEn} ${inSentenceEn}`);
      });
    } else {
      const holdVariantsId = [
        `Skuad Anda sudah berada di posisi solid ${windowPhraseId}: ${baseXI.safeStarterCount} dari 11 starter (${baseXI.formation}) punya menit bermain aman dengan total proyeksi ${baseXI.xiXpH.toFixed(1)} pts dan dana cadangan £${round1(bankBalance).toFixed(1)}m. Menyimpan jatah ${ftAllowance} FT jauh lebih menguntungkan ketimbang memaksakan transfer yang margin keuntungannya tipis${isHitMode ? ' atau harus menebus penalti -4' : ''}.`,
        `Belum ada alasan mendesak untuk membongkar tim ${windowPhraseId}. Formasi ${baseXI.formation} sudah diisi ${baseXI.safeStarterCount}/11 pemain inti reguler yang memproyeksikan ${baseXI.xiXpH.toFixed(1)} pts dengan Bank £${round1(bankBalance).toFixed(1)}m, jadi menabung ${ftAllowance} FT memberi fleksibilitas jauh lebih besar ke depan.`,
        `Kesabaran adalah keputusan terbaik ${windowPhraseId}. Sebelas starter terbaik Anda (${baseXI.formation}, ${baseXI.xiXpH.toFixed(1)} pts proyeksi) tidak memiliki celah berarti—mengamankan ${ftAllowance} FT hari ini membuat ruang manuver di GW berikutnya kian leluasa.`,
      ];
      const holdVariantsEn = [
        `Your squad is already well positioned ${windowPhraseEn}: ${baseXI.safeStarterCount} of 11 starters (${baseXI.formation}) hold secure minutes projecting ${baseXI.xiXpH.toFixed(1)} pts with £${round1(bankBalance).toFixed(1)}m in the bank. Rolling your ${ftAllowance} FT is more valuable than forcing a marginal move${isHitMode ? ' or paying a -4 hit' : ''}.`,
        `There is no urgent fire to put out ${windowPhraseEn}. Your ${baseXI.formation} XI packs ${baseXI.safeStarterCount}/11 regular starters projecting ${baseXI.xiXpH.toFixed(1)} pts alongside £${round1(bankBalance).toFixed(1)}m ITB, making ${ftAllowance} banked FT the smart play.`,
        `Patience pays best ${windowPhraseEn}. With ${baseXI.xiXpH.toFixed(1)} projected pts from a healthy ${baseXI.formation} lineup, rolling your ${ftAllowance} FT preserves maximum flexibility for future weeks.`,
      ];
      reasonParagraphs.push(
        isId
          ? holdVariantsId[baseSeed % holdVariantsId.length]
          : holdVariantsEn[baseSeed % holdVariantsEn.length]
      );
    }

    const reason = reasonParagraphs.join('\n\n');

    return {
      needTransfer,
      moves: bestState.moves,
      netGain,
      hitCount: bestState.hitCount,
      hitCost: bestState.hitCost,
      ftUsed,
      reason,
      reasonParagraphs,
      startXiXpH: baseXI.xiXpH,
      endXiXpH: bestState.xi.xiXpH,
      startBank: round1(bankBalance),
      endBank: round1(bestState.bank),
      startFormation: baseXI.formation,
      endFormation: bestState.xi.formation,
      horizonCount,
      horizonEndGw,
      horizonLabel,
    };
  }, [subTab, activeManager, activeSquad, playerPool, transferMode, transferHorizon, ftAllowance, bankBalance, isId, baseHistoricalGW, targetNextGW]);

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-3 space-y-3">
      {/* ======================================================== */}
      {/* 1. SUBTAB: PICKS                                         */}
      {/* ======================================================== */}
      {subTab === 'picks' && (
        <div className="space-y-2">
          {/* Compact Switcher & Dual Budget Status (£83.0m XI / £100.0m Squad / Max 3 Club) */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#1a0f2e] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1">
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
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold text-slate-700 dark:text-slate-300">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-[10px] font-black text-slate-600 dark:text-slate-300">
                {picksSquad.formation}
              </span>
              <span className="font-mono font-black text-[#37003c] dark:text-[#00ff87]">
                {picksSquad.xiXp.toFixed(1)} xP
              </span>
              <span className="text-slate-300 dark:text-white/15">•</span>
              <span className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300" title="Starting XI Limit £83.0m">
                XI <span className="text-emerald-600 dark:text-[#00ff87] font-black">£{picksSquad.xiCost.toFixed(1)}m</span>/{picksSquad.xiBudget.toFixed(0)}m
              </span>
              <span className="text-slate-300 dark:text-white/15">•</span>
              <span className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300" title="Overall Squad Limit £100.0m • Max 3/club">
                15 <span className="text-emerald-600 dark:text-[#00ff87] font-black">£{picksSquad.totalCost.toFixed(1)}m</span>/{picksSquad.budget.toFixed(0)}m
              </span>
            </div>
          </div>

          {/* Regulation Pitch View (Compact & 5-Across Single Row Guaranteed) */}
          <div className="relative w-full max-w-4xl mx-auto rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/10 shadow-xl">
            {isLoadingScoutSquads && picksSquad.starters.length === 0 ? (
              <div className="bg-[#00aa52] py-16 px-4 text-center text-white text-xs font-bold">
                {isId ? 'Memuat optimasi skuad terbaik...' : 'Loading optimal squad...'}
              </div>
            ) : null}
            {/* Pitch Grass Surface */}
            <div className="relative w-full pt-3 sm:pt-4 pb-3.5 sm:pb-5 px-1.5 sm:px-3 bg-[#00aa52] select-none">
              {/* 10 Alternating Horizontal Lawn Mowing Stripes */}
              <div
                className="absolute inset-0 flex flex-col pointer-events-none overflow-hidden"
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
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
              <div className="relative z-10 space-y-2.5 sm:space-y-3.5">
                {/* 1. GKP */}
                <div className="flex justify-center items-center gap-1.5 sm:gap-3 flex-nowrap">
                  {pitchStarters.gks.map((p) => (
                    <ScoutPitchCard
                      key={p.id}
                      player={p}
                      picksType={picksType}
                      onClick={() => onSelectPlayer?.(p.id)}
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
                      onClick={() => onSelectPlayer?.(p.id)}
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
                      onClick={() => onSelectPlayer?.(p.id)}
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
                      onClick={() => onSelectPlayer?.(p.id)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Bench Dugout (4 players cleanly on 1 row) */}
            <div className="bg-[#005a2b] border-t border-[#007038] px-1.5 sm:px-3 py-2">
              <div className="flex justify-center items-center gap-1.5 sm:gap-4 flex-nowrap">
                {picksSquad.bench.map((p) => (
                  <ScoutPitchCard
                    key={p.id}
                    player={p}
                    picksType={picksType}
                    isBench
                    onClick={() => onSelectPlayer?.(p.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. SUBTAB: CAPTAIN                                       */}
      {/* ======================================================== */}
      {subTab === 'captain' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {captainPicks.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelectPlayer?.(p.id)}
              className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3 shadow-sm hover:border-[#00ff87]/60 transition-all cursor-pointer flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-lg bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] flex items-center justify-center text-xs font-black">
                    {p.rank}
                  </span>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                      {p.webName}
                    </h4>
                    <span className="text-[11px] font-bold text-slate-400">
                      {narrativeFns.resolveClubName(p.teamShort, clubNameMap)} • {p.position} • £{p.cost.toFixed(1)}m
                    </span>
                  </div>
                </div>

                {/* Clean Rating Badge */}
                <div className="flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-md text-xs font-black">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>{p.rating}</span>
                </div>
              </div>

              {/* 1 Paragraph Narrative */}
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {p.narrative}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. SUBTAB: DIFFERENTIAL                                  */}
      {/* ======================================================== */}
      {subTab === 'differential' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {differentialPicks.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelectPlayer?.(p.id)}
              className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-xl p-3.5 shadow-sm hover:border-[#00ff87]/60 transition-all cursor-pointer flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-[#00ff87] flex items-center justify-center text-xs font-black">
                    {p.rank}
                  </span>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                      {p.webName}
                    </h4>
                    <span className="text-[11px] font-bold text-slate-400">
                      {narrativeFns.resolveClubName(p.teamShort, clubNameMap)} • {p.position} • £{p.cost.toFixed(1)}m
                    </span>
                  </div>
                </div>

                {/* Ownership & Rating Badges */}
                <div className="flex items-center gap-1.5">
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
          ))}
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
          <div className="flex flex-col items-center justify-center py-6 px-4 text-center space-y-5">
            {/* Minimalist 1 Set Chip (4 kapsul ukuran sama) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 max-w-lg w-full">
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
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-bold whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors ${
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

            {/* Recommendation Card */}
            {chipsAnalysis.needChip ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-emerald-500/30 dark:border-[#00ff87]/30 rounded-2xl p-5 max-w-lg w-full shadow-lg space-y-2.5">
                <div className="w-11 h-11 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 dark:text-[#00ff87] flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-[#00ff87]">
                  GW {targetNextGW}
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {chipsAnalysis.chipName}
                </h3>
                <div className="inline-flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-[#00ff87] bg-emerald-500/10 px-3 py-1 rounded-full">
                  <span>
                    +{chipsAnalysis.gain.toFixed(1)} xP{chipsAnalysis.chipName === 'Wildcard' ? '/GW' : ''} projected gain
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
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
              <div className="max-w-2xl w-full text-left bg-white/85 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 sm:p-5 space-y-3 text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
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
        );
      })()}

      {/* ======================================================== */}
      {/* 5. SUBTAB: TRANSFER                                      */}
      {/* ======================================================== */}
      {subTab === 'transfer' && (
        <div className="space-y-2.5">
          {/* Compact Controls: Mode (FT Only / Allow Hits) & Range (1 GW / 3 GW / 6 GW) */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div className="flex items-center bg-white dark:bg-[#1a0f2e] p-0.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
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

            <div className="flex items-center bg-white dark:bg-[#1a0f2e] p-0.5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm">
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

          {/* Compact Content Card */}
          <div className="flex flex-col items-center justify-center py-2 px-1 sm:px-2 text-center">
            {transferRecommendation.needTransfer && transferRecommendation.moves.length > 0 ? (
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-2xl p-3.5 sm:p-4 max-w-xl w-full shadow-md space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider">
                  <span className={transferRecommendation.hitCount > 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-[#00ff87]'}>
                    {transferRecommendation.hitCount > 0
                      ? `${transferRecommendation.ftUsed} FT + ${transferRecommendation.hitCount}x HIT (-${transferRecommendation.hitCost})`
                      : `${transferRecommendation.ftUsed} / ${ftAllowance} FT`}
                  </span>
                  <span className="text-slate-400 font-mono">
                    {transferRecommendation.horizonCount === 1
                      ? `GW${targetNextGW}`
                      : `GW${targetNextGW}–GW${transferRecommendation.horizonEndGw}`}
                  </span>
                </div>

                {/* Compact Starting XI xP & Bank (Awal -> Akhir) */}
                <div className="grid grid-cols-2 gap-1.5 text-left">
                  <div className="bg-slate-50 dark:bg-black/20 px-2.5 py-1.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center justify-between gap-1">
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
                  <div className="bg-slate-50 dark:bg-black/20 px-2.5 py-1.5 rounded-lg border border-slate-100 dark:border-white/5 flex items-center justify-between gap-1">
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
                  {transferRecommendation.moves.map((m) => (
                    <div
                      key={`${m.out.p.id}-${m.in.p.id}`}
                      className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-black/20 px-3 py-2 rounded-xl border border-slate-100 dark:border-white/5"
                    >
                      <div
                        onClick={() => onSelectPlayer?.(m.out.p.id)}
                        className="flex-1 text-left cursor-pointer min-w-0"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-black uppercase text-rose-500">
                            OUT{m.isHit ? ' (-4)' : ''}
                          </span>
                          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                            {m.out.p.webName}
                          </h4>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          £{m.out.p.cost.toFixed(1)}m • {m.out.effXpH.toFixed(1)} pts
                        </span>
                      </div>

                      <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />

                      <div
                        onClick={() => onSelectPlayer?.(m.in.p.id)}
                        className="flex-1 text-right cursor-pointer min-w-0"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                            {m.in.p.webName}
                          </h4>
                          <span className="text-[9px] font-black uppercase text-emerald-500">IN</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          £{m.in.p.cost.toFixed(1)}m • {m.in.effXpH.toFixed(1)} pts
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Editorial FPL Narrative */}
                <div className="space-y-2 text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed text-left bg-slate-50/70 dark:bg-black/20 p-3 rounded-xl border border-slate-100 dark:border-white/5">
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
              <div className="bg-white dark:bg-[#1a0f2e] border border-slate-200 dark:border-white/10 rounded-2xl p-4 max-w-xl w-full shadow-md space-y-2.5">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-[#00ff87] flex items-center justify-center shrink-0">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                    You're good to go
                  </h3>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  <span>FT: {ftAllowance}</span>
                  <span>
                    XI xP: {transferRecommendation.startXiXpH.toFixed(1)} → {transferRecommendation.endXiXpH.toFixed(1)}
                  </span>
                  <span>
                    Bank: £{transferRecommendation.startBank.toFixed(1)}m → £{transferRecommendation.endBank.toFixed(1)}m
                  </span>
                </div>
                {transferRecommendation.reasonParagraphs.length > 0 && (
                  <div className="space-y-2 text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed text-left bg-slate-50/70 dark:bg-black/20 p-3 rounded-xl border border-slate-100 dark:border-white/5">
                    {transferRecommendation.reasonParagraphs.map((para, idx) => (
                      <p key={idx}>{para}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// PITCH PLAYER CARD COMPONENT
// ==========================================
interface ScoutPitchCardProps {
  player: {
    id: number;
    webName: string;
    teamShort: string;
    position: string;
    cost: number;
    fixtures1: Array<{ gw: number; opp: string; isHome: boolean; xp: number }>;
    fixtures6: Array<{ gw: number; opp: string; isHome: boolean; xp: number }>;
    xP1: number;
    avgXp6: number;
    photo?: string;
    proven?: any;
  };
  picksType: 'FH' | 'WC';
  isBench?: boolean;
  onClick?: () => void;
}

const ScoutPitchCard: React.FC<ScoutPitchCardProps> = ({
  player,
  picksType,
  isBench = false,
  onClick,
}) => {
  const displayXp = picksType === 'FH' ? player.xP1 : player.avgXp6;

  return (
    <div
      onClick={onClick}
      className={`group flex flex-col items-center justify-center cursor-pointer transition-transform hover:scale-105 select-none min-w-0 shrink-0 ${
        isBench
          ? 'w-[calc((100%-18px)/4)] max-w-[78px] sm:max-w-none sm:w-22 md:w-24'
          : 'w-[calc((100%-16px)/5)] max-w-[82px] sm:max-w-none sm:w-22 md:w-24'
      }`}
    >
      {/* Kit / Player Photo */}
      <div className="relative w-[54px] h-[54px] max-w-full sm:w-16 sm:h-16 md:w-[74px] md:h-[74px] flex items-center justify-center">
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
      <div className="relative w-full">
        {/* Name Strip (Dark Premier League Purple/Black) */}
        <div className="w-full bg-[#37003c] group-hover:bg-[#4d0054] text-white text-center py-0.5 px-1 rounded-t-md mt-0.5 shadow-md transition-colors flex items-center justify-center">
          <span className="block text-[9px] sm:text-[10.5px] font-extrabold truncate leading-tight">
            {player.webName}
          </span>
        </div>

        {/* Cost & Projected Points Strip (Neon Green) */}
        <div className="w-full bg-[#00ff87] group-hover:bg-[#2eff9e] text-[#37003c] text-center py-0.5 px-1 rounded-b-md flex items-center justify-between font-black text-[8.5px] sm:text-[9.5px] leading-tight transition-colors">
          <span>£{player.cost.toFixed(1)}</span>
          <span>{displayXp}</span>
        </div>
      </div>
    </div>
  );
};
