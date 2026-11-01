import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ExternalLink,
  Clock
} from 'lucide-react';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { useLanguage } from '../utils/i18n.ts';
import {
  StandingsRow,
  PlayerOwnershipItem,
  PlayerOwnerItem,
  TransferItem,
  DbPlayerStat,
  GwFixtureItem
} from '../types.ts';

interface PastSeasonItem {
  season_name: string;
  total_points: number;
  rank: number;
  fnb_rank?: number;
}

const FPL_SEASON_TOTAL_PLAYERS: Record<string, number> = {
  '2006/07': 1450000,
  '2007/08': 1700000,
  '2008/09': 1930000,
  '2009/10': 2096000,
  '2010/11': 2354000,
  '2011/12': 2778000,
  '2012/13': 2608000,
  '2013/14': 3218000,
  '2014/15': 3502000,
  '2015/16': 3734000,
  '2016/17': 4503000,
  '2017/18': 5910000,
  '2018/19': 6324000,
  '2019/20': 7628000,
  '2020/21': 8240000,
  '2021/22': 9167000,
  '2022/23': 11447000,
  '2023/24': 10917000,
  '2024/25': 11100000,
  '2025/26': 11200000,
};

const getFullChipName = (chip?: string | null): string => {
  if (!chip) return '';
  const lower = chip.toLowerCase();
  if (lower === 'wildcard' || lower === 'wc') return 'Wildcard';
  if (lower === 'freehit' || lower === 'fh') return 'Free Hit';
  if (lower === 'bboost' || lower === 'bb') return 'Bench Boost';
  if (lower === '3xc' || lower === 'tc' || lower === 'triple_captain') return 'Triple Captain';
  return chip;
};

interface ManagerDetailData {
  id: number;
  name: string;
  player_name: string;
  club_badge_src: string | null;
  favourite_team: number | null;
  summary_overall_points: number;
  summary_overall_rank: number;
  last_deadline_bank: string;
  last_deadline_value: string;
  past_seasons: PastSeasonItem[];
  current_history: Array<{
    event: number;
    points: number;
    total_points: number;
    rank: number;
    rank_sort: number;
    overall_rank: number;
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  }>;
  chips: Array<{ name: string; time: string; event: number }>;
}

interface ManagerDetailModalProps {
  entryId: number | null;
  onClose: () => void;
  selectedGW: number;
  availableGWs?: number[];
  standings?: Record<number, StandingsRow[]>;
  ownershipPlayers?: Record<number, PlayerOwnershipItem[]>;
  transfers?: TransferItem[];
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  lastSynced?: string;
  playerStats?: DbPlayerStat[];
  gwFixtures?: GwFixtureItem[] | any[];
}

type ModalTab = 'overview' | 'history';

// Client-side cache for manager details to load instantly (0ms)
const managerDetailClientCache = new Map<number, ManagerDetailData>();

// In-memory cache for player summaries for 0ms quick point breakdown
const playerSummaryMemoryCache = new Map<string, any>();

const BREAKDOWN_ORDER_MAP: Record<string, number> = {
  MP: 1,
  GS: 2,
  A: 3,
  CS: 4,
  S: 5,
  PS: 6,
  DC: 7,
  GC: 8,
  OG: 9,
  PM: 10,
  YC: 11,
  RC: 12,
  BP: 13,
};

interface BreakdownItem {
  code: string;
  value: string | number;
  points: number;
  order: number;
}

function formatPointsBreakdown(
  summaryData: any,
  gw: number,
  position: string
): Array<{ code: string; value: string | number; points: number }> {
  if (!summaryData) return [];
  const items: BreakdownItem[] = [];

  // 1. Try live_explain stats first (handles single GW and multi-match DGW) - Raw base points without multiplier
  const rawExplains = summaryData?.live_explain;
  if (Array.isArray(rawExplains) && rawExplains.length > 0) {
    const statAggregator: Record<string, { value: number; points: number }> = {};
    for (const expl of rawExplains) {
      if (Array.isArray(expl?.stats)) {
        for (const st of expl.stats) {
          const id = st.identifier;
          if (!statAggregator[id]) {
            statAggregator[id] = { value: 0, points: 0 };
          }
          statAggregator[id].value += Number(st.value) || 0;
          statAggregator[id].points += Number(st.points) || 0;
        }
      }
    }

    for (const [id, agg] of Object.entries(statAggregator)) {
      const val = agg.value;
      const pts = agg.points;
      if (val === 0 && pts === 0) continue;

      if (id === 'minutes') {
        items.push({ code: 'MP', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.MP });
      } else if (id === 'goals_scored') {
        items.push({ code: 'GS', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.GS });
      } else if (id === 'assists') {
        items.push({ code: 'A', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.A });
      } else if (id === 'clean_sheets') {
        items.push({ code: 'CS', value: val > 0 ? val : 1, points: pts, order: BREAKDOWN_ORDER_MAP.CS });
      } else if (id === 'saves') {
        items.push({ code: 'S', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.S });
      } else if (id === 'penalties_saved') {
        items.push({ code: 'PS', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.PS });
      } else if (id === 'defensive_contribution') {
        items.push({ code: 'DC', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.DC });
      } else if (id === 'goals_conceded') {
        items.push({ code: 'GC', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.GC });
      } else if (id === 'own_goals') {
        items.push({ code: 'OG', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.OG });
      } else if (id === 'penalties_missed') {
        items.push({ code: 'PM', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.PM });
      } else if (id === 'yellow_cards') {
        items.push({ code: 'YC', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.YC });
      } else if (id === 'red_cards') {
        items.push({ code: 'RC', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.RC });
      } else if (id === 'bonus') {
        items.push({ code: 'BP', value: val, points: pts, order: BREAKDOWN_ORDER_MAP.BP });
      }
    }
  }

  // 2. If explainStats was empty (e.g. past gameweeks), fallback to round history or live_stats
  if (items.length === 0) {
    const roundStat = (summaryData?.history || []).find((h: any) => h.round === gw) || summaryData?.live_stats;
    if (roundStat) {
      const isDef = position === 'DEF' || position === 'GKP';
      const isMid = position === 'MID';
      const goalPts = isDef ? 6 : isMid ? 5 : 4;
      const csPts = isDef ? 4 : isMid ? 1 : 0;

      if (roundStat.minutes > 0) {
        const mPts = roundStat.minutes >= 60 ? 2 : 1;
        items.push({ code: 'MP', value: roundStat.minutes, points: mPts, order: BREAKDOWN_ORDER_MAP.MP });
      }
      if (roundStat.goals_scored > 0) {
        items.push({ code: 'GS', value: roundStat.goals_scored, points: roundStat.goals_scored * goalPts, order: BREAKDOWN_ORDER_MAP.GS });
      }
      if (roundStat.assists > 0) {
        items.push({ code: 'A', value: roundStat.assists, points: roundStat.assists * 3, order: BREAKDOWN_ORDER_MAP.A });
      }
      if (roundStat.clean_sheets > 0 && csPts > 0) {
        items.push({ code: 'CS', value: roundStat.clean_sheets || 1, points: roundStat.clean_sheets * csPts, order: BREAKDOWN_ORDER_MAP.CS });
      }
      if (roundStat.saves > 0) {
        const sPts = Math.floor(roundStat.saves / 3);
        if (sPts > 0) items.push({ code: 'S', value: roundStat.saves, points: sPts, order: BREAKDOWN_ORDER_MAP.S });
      }
      if (roundStat.penalties_saved > 0) {
        items.push({ code: 'PS', value: roundStat.penalties_saved, points: roundStat.penalties_saved * 5, order: BREAKDOWN_ORDER_MAP.PS });
      }
      if (roundStat.defensive_contribution > 0) {
        const dcThreshold = isDef ? 10 : 12;
        const dcPts = (position !== 'GKP' && roundStat.defensive_contribution >= dcThreshold) ? 2 : 0;
        if (dcPts > 0) {
          items.push({ code: 'DC', value: roundStat.defensive_contribution, points: dcPts, order: BREAKDOWN_ORDER_MAP.DC });
        }
      }
      if (roundStat.goals_conceded >= 2 && isDef) {
        const gcPts = -Math.floor(roundStat.goals_conceded / 2);
        items.push({ code: 'GC', value: roundStat.goals_conceded, points: gcPts, order: BREAKDOWN_ORDER_MAP.GC });
      }
      if (roundStat.own_goals > 0) {
        items.push({ code: 'OG', value: roundStat.own_goals, points: roundStat.own_goals * -2, order: BREAKDOWN_ORDER_MAP.OG });
      }
      if (roundStat.penalties_missed > 0) {
        items.push({ code: 'PM', value: roundStat.penalties_missed, points: roundStat.penalties_missed * -2, order: BREAKDOWN_ORDER_MAP.PM });
      }
      if (roundStat.yellow_cards > 0) {
        items.push({ code: 'YC', value: roundStat.yellow_cards, points: roundStat.yellow_cards * -1, order: BREAKDOWN_ORDER_MAP.YC });
      }
      if (roundStat.red_cards > 0) {
        items.push({ code: 'RC', value: roundStat.red_cards, points: roundStat.red_cards * -3, order: BREAKDOWN_ORDER_MAP.RC });
      }
      if (roundStat.bonus > 0) {
        items.push({ code: 'BP', value: roundStat.bonus, points: roundStat.bonus, order: BREAKDOWN_ORDER_MAP.BP });
      }
    }
  }

  // If player did not play (0 minutes, 0 stats), present MP 0 0
  if (items.length === 0) {
    items.push({ code: 'MP', value: 0, points: 0, order: BREAKDOWN_ORDER_MAP.MP });
  }

  // Sort by the established standard hierarchy 1 to 13
  items.sort((a, b) => a.order - b.order);
  return items;
}

// Preload and pre-decode team badge in memory to eliminate any badge appearance delay (0ms)
if (typeof window !== 'undefined') {
  const preloadedBadge = new Image();
  preloadedBadge.src = '/team_badge.png';
  if ('decode' in preloadedBadge) {
    preloadedBadge.decode().catch(() => {});
  }
  const preloadedLogo = new Image();
  preloadedLogo.src = '/logo.png';
  if ('decode' in preloadedLogo) {
    preloadedLogo.decode().catch(() => {});
  }
}

// Fixed positioning and typography for Hero Panel elements (viewBox 0 0 88 88)
// Completely fixed coordinates and sizes - zero dynamic adjustments regardless of digit count.
const HERO_BADGE_CONFIG = {
  top: {
    x: '44',
    y: '17',
    fontSize: '10.5',
    fontWeight: '900',
    letterSpacing: '0.2',
  },
  score: {
    x: '44',
    y: '61',
    fontSize: '48',
    fontWeight: '900',
    letterSpacing: '-1',
  },
  bottom: {
    x: '44',
    y: '78',
    fontSize: '9.5',
    fontWeight: '700',
    letterSpacing: '0.1',
  },
} as const;

export const ManagerDetailModal: React.FC<ManagerDetailModalProps> = React.memo(({
  entryId,
  onClose,
  selectedGW,
  availableGWs = [],
  standings = {},
  ownershipPlayers = {},
  transfers = [],
  onSelectPlayer,
  lastSynced,
  playerStats = [],
  gwFixtures = [],
}) => {
  const { t, language } = useLanguage();
  const [activeGW, setActiveGW] = useState<number>(selectedGW);
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [managerDetail, setManagerDetail] = useState<ManagerDetailData | null>(null);
  const [badgeImgError, setBadgeImgError] = useState<boolean>(false);
  const [isGWDropdownOpen, setIsGWDropdownOpen] = useState<boolean>(false);

  // Map player ID to player team information for fast O(1) opponent resolution
  const playerTeamMap = useMemo(() => {
    const map = new Map<number, { teamId: number; teamShort: string }>();
    if (Array.isArray(playerStats)) {
      for (const p of playerStats) {
        if (p.id) {
          map.set(p.id, {
            teamId: p.teamId,
            teamShort: p.teamShort || ''
          });
        }
      }
    }
    return map;
  }, [playerStats]);

  // Lookup match status and opponent info for a player in a specific GW
  const getPlayerMatchInfo = useCallback(
    (player: PlayerOwnershipItem, gw: number) => {
      const pId = player.id;
      const pInfo = playerTeamMap.get(pId);
      const teamShort = pInfo?.teamShort || player.team_short_name || '';

      // Find match fixture in gwFixtures for this event
      const fixList = Array.isArray(gwFixtures) ? gwFixtures : [];
      const matchFixture = fixList.find((f: any) => {
        if (f.event !== undefined && f.event !== gw) return false;
        if (pInfo?.teamId) {
          return f.team_h === pInfo.teamId || f.team_a === pInfo.teamId;
        }
        return f.home_team === teamShort || f.away_team === teamShort;
      });

      if (!matchFixture) {
        return {
          oppLabel: teamShort,
          matchStatus: 'ft' as const,
        };
      }

      const isHome = pInfo?.teamId
        ? matchFixture.team_h === pInfo.teamId
        : matchFixture.home_team === teamShort;

      const oppShort = isHome
        ? (matchFixture.away_team || 'OPP')
        : (matchFixture.home_team || 'OPP');

      const oppLabel = isHome ? `${oppShort} (H)` : `${oppShort} (A)`;

      const isFt = Boolean(matchFixture.finished || matchFixture.finished_provisional);
      const isLive = Boolean(matchFixture.started && !isFt);

      const matchStatus: 'upcoming' | 'live' | 'ft' = isFt
        ? 'ft'
        : isLive
        ? 'live'
        : 'upcoming';

      return {
        oppLabel,
        matchStatus,
      };
    },
    [playerTeamMap, gwFixtures]
  );

  // Quick Point Breakdown state for players on the pitch/bench
  const [activeBreakdownPlayerId, setActiveBreakdownPlayerId] = useState<number | null>(null);
  const [breakdownDataMap, setBreakdownDataMap] = useState<Record<string, Array<{ code: string; value: string | number; points: number }>>>({});
  const [loadingBreakdownId, setLoadingBreakdownId] = useState<number | null>(null);

  // Sync initial selectedGW when modal opens or entryId changes
  useEffect(() => {
    setActiveGW(selectedGW);
    setActiveTab('overview');
    setBadgeImgError(false);
    setIsGWDropdownOpen(false);
    setActiveBreakdownPlayerId(null);
    setBreakdownDataMap({});
  }, [selectedGW, entryId]);

  // Extract 15 squad players from ownershipPlayers for activeGW
  const squad = useMemo(() => {
    if (!entryId) return { starters: [], bench: [] };
    const list = (ownershipPlayers && ownershipPlayers[activeGW]) || [];
    const matched: Array<{
      player: PlayerOwnershipItem;
      ownerInfo: PlayerOwnerItem;
    }> = [];

    for (const p of list) {
      if (p.owners && Array.isArray(p.owners)) {
        const ownerMatch = p.owners.find((o) => o.entry_id === entryId);
        if (ownerMatch) {
          matched.push({
            player: p,
            ownerInfo: ownerMatch
          });
        }
      }
    }

    // Sort by position_in_squad (1 to 15)
    matched.sort((a, b) => a.ownerInfo.position_in_squad - b.ownerInfo.position_in_squad);

    const starters = matched.filter((m) => m.ownerInfo.is_starter || m.ownerInfo.position_in_squad <= 11);
    const bench = matched.filter((m) => !m.ownerInfo.is_starter && m.ownerInfo.position_in_squad > 11);

    return { starters, bench };
  }, [ownershipPlayers, activeGW, entryId]);

  // Exact 15 players in this manager's squad for activeGW
  const all15SquadPlayers = useMemo(() => {
    return [...squad.starters, ...squad.bench];
  }, [squad.starters, squad.bench]);

  // Fetch or refresh breakdown for a player
  const fetchPlayerBreakdown = useCallback(
    async (pId: number, playerPos: string, bypassCache = false) => {
      const cacheKey = `${pId}_${activeGW}`;
      if (!bypassCache && playerSummaryMemoryCache.has(cacheKey)) {
        const summary = playerSummaryMemoryCache.get(cacheKey);
        const formatted = formatPointsBreakdown(summary, activeGW, playerPos);
        setBreakdownDataMap((prev) => ({ ...prev, [cacheKey]: formatted }));
        return formatted;
      }

      try {
        const url = bypassCache
          ? `/api/fpl-player-summary/${pId}?gw=${activeGW}&_t=${Date.now()}`
          : `/api/fpl-player-summary/${pId}?gw=${activeGW}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            playerSummaryMemoryCache.set(cacheKey, json.data);
            const formatted = formatPointsBreakdown(json.data, activeGW, playerPos);
            setBreakdownDataMap((prev) => {
              const current = prev[cacheKey];
              if (JSON.stringify(current) !== JSON.stringify(formatted)) {
                return { ...prev, [cacheKey]: formatted };
              }
              return prev;
            });
            return formatted;
          }
        }
      } catch {
        // Graceful error handling
      }
      return null;
    },
    [activeGW]
  );

  const handleToggleBreakdown = useCallback(
    async (pId: number, playerPos: string) => {
      if (activeBreakdownPlayerId === pId) {
        setActiveBreakdownPlayerId(null);
        return;
      }
      setActiveBreakdownPlayerId(pId);

      const cacheKey = `${pId}_${activeGW}`;
      if (breakdownDataMap[cacheKey] && breakdownDataMap[cacheKey].length > 0) {
        return;
      }

      // Instant 0ms response: If player has 0 points, immediately show MP 0
      const squadItem = all15SquadPlayers.find((m) => m.player.id === pId);
      const gwPts = squadItem?.player?.gw_points;
      if (gwPts === 0 || gwPts === undefined) {
        setBreakdownDataMap((prev) => ({
          ...prev,
          [cacheKey]: [{ code: 'MP', value: 0, points: 0 }]
        }));
      }

      if (playerSummaryMemoryCache.has(cacheKey)) {
        const summary = playerSummaryMemoryCache.get(cacheKey);
        const formatted = formatPointsBreakdown(summary, activeGW, playerPos);
        setBreakdownDataMap((prev) => ({ ...prev, [cacheKey]: formatted }));
        return;
      }

      setLoadingBreakdownId(pId);
      try {
        await fetchPlayerBreakdown(pId, playerPos, false);
      } finally {
        setLoadingBreakdownId(null);
      }
    },
    [activeBreakdownPlayerId, activeGW, all15SquadPlayers, breakdownDataMap, fetchPlayerBreakdown]
  );

  // 1. Background prefetch player breakdown summaries for ALL 15 squad players in activeGW
  // Eliminates modal opening delays and height jumps so clicking any card is instant (0ms)
  useEffect(() => {
    if (!all15SquadPlayers.length) return;
    let isCancelled = false;

    // Immediately pre-populate MP 0 for all 0-point squad players in 0ms
    const immediatePrecomputed: Record<string, Array<{ code: string; value: string | number; points: number }>> = {};
    for (const item of all15SquadPlayers) {
      const pl = item.player;
      const key = `${pl.id}_${activeGW}`;
      if ((pl.gw_points === 0 || pl.gw_points === undefined) && !breakdownDataMap[key]) {
        immediatePrecomputed[key] = [{ code: 'MP', value: 0, points: 0 }];
      }
    }
    if (Object.keys(immediatePrecomputed).length > 0) {
      setBreakdownDataMap((prev) => ({ ...prev, ...immediatePrecomputed }));
    }

    // Prefetch all 15 squad players: prioritize players with points > 0 first, then 0-point players
    const sortedSquad = [...all15SquadPlayers].sort(
      (a, b) => (b.player.gw_points || 0) - (a.player.gw_points || 0)
    );

    const prefetchSquad = async () => {
      const chunkSize = 5;
      for (let i = 0; i < sortedSquad.length; i += chunkSize) {
        if (isCancelled) break;
        const chunk = sortedSquad.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (item) => {
            if (isCancelled) return;
            const pl = item.player;
            const cacheKey = `${pl.id}_${activeGW}`;
            if (playerSummaryMemoryCache.has(cacheKey)) {
              const summary = playerSummaryMemoryCache.get(cacheKey);
              const formatted = formatPointsBreakdown(summary, activeGW, pl.position);
              if (!isCancelled) {
                setBreakdownDataMap((prev) => ({ ...prev, [cacheKey]: formatted }));
              }
              return;
            }
            try {
              const res = await fetch(`/api/fpl-player-summary/${pl.id}?gw=${activeGW}`);
              if (res.ok && !isCancelled) {
                const json = await res.json();
                if (json.success && json.data) {
                  playerSummaryMemoryCache.set(cacheKey, json.data);
                  const formatted = formatPointsBreakdown(json.data, activeGW, pl.position);
                  if (!isCancelled) {
                    setBreakdownDataMap((prev) => ({ ...prev, [cacheKey]: formatted }));
                  }
                }
              }
            } catch {
              // Ignore prefetch error
            }
          })
        );
      }
    };

    prefetchSquad();

    return () => {
      isCancelled = true;
    };
  }, [activeGW, all15SquadPlayers]);

  // 2. Real-time auto-refresh when popup is open and points update during live match
  // Requirement: "Saat live dan ada perubahan poin saat pop up terbuka, poinnya langsung terupdate otomatis tanpa harus buka tutup popup"
  const activeSquadItem = useMemo(() => {
    if (activeBreakdownPlayerId === null) return null;
    return all15SquadPlayers.find((m) => m.player.id === activeBreakdownPlayerId) || null;
  }, [all15SquadPlayers, activeBreakdownPlayerId]);

  const activePlayerPoints = activeSquadItem?.player.gw_points;
  const activePlayerPos = activeSquadItem?.player.position || 'MID';

  // Immediate refresh when points change for the open player in ownershipPlayers (from sync, SSE, or parent fetch)
  useEffect(() => {
    if (activeBreakdownPlayerId === null) return;
    fetchPlayerBreakdown(activeBreakdownPlayerId, activePlayerPos, true);
  }, [activeBreakdownPlayerId, activePlayerPoints, activePlayerPos, fetchPlayerBreakdown]);

  // Periodic live polling while breakdown popup is open (every 15s)
  useEffect(() => {
    if (activeBreakdownPlayerId === null) return;

    const refreshLive = () => {
      if (document.visibilityState === 'visible' && activeBreakdownPlayerId !== null) {
        fetchPlayerBreakdown(activeBreakdownPlayerId, activePlayerPos, true);
      }
    };

    const interval = setInterval(refreshLive, 15000);
    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        refreshLive();
      }
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVis);
    };
  }, [activeBreakdownPlayerId, activePlayerPos, fetchPlayerBreakdown]);

  // Click outside breakdown card to dismiss active breakdown
  useEffect(() => {
    if (activeBreakdownPlayerId === null) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-breakdown-card]')) {
        setActiveBreakdownPlayerId(null);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [activeBreakdownPlayerId]);

  // Handle device back button to close modal
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!entryId) return;

    // Push history state entry specifically for this open modal session
    const modalHistoryToken = `manager-modal-${entryId}-${Date.now()}`;
    window.history.pushState({ modalType: 'managerDetail', token: modalHistoryToken }, '');

    let closedViaPopState = false;

    const handlePopState = () => {
      // If we popped to a child modal or are still on manager modal, do not close manager modal
      if (window.history.state?.token === modalHistoryToken) {
        return;
      }
      if (window.history.state?.modal === 'playerDetail') {
        return;
      }
      closedViaPopState = true;
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeBreakdownPlayerId !== null) {
          setActiveBreakdownPlayerId(null);
          return;
        }
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
      // If modal was closed via UI (e.g. close button, backdrop, Escape) and not via back button,
      // revert the history entry we pushed so browser history stays clean.
      if (!closedViaPopState) {
        if (window.history.state?.token === modalHistoryToken) {
          window.history.back();
        }
      }
    };
  }, [entryId]);

  // Reusable function to fetch/refresh manager profile & history
  const refreshManagerDetail = useCallback(async () => {
    if (!entryId) return;
    try {
      const res = await fetch(`/api/fpl-manager-detail/${entryId}?_t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          managerDetailClientCache.set(entryId, json.data);
          setManagerDetail(json.data);
        }
      }
    } catch {
      // Graceful error
    }
  }, [entryId]);

  // Fetch full manager profile, Adobe Express badge, and history (Stale-While-Revalidate)
  useEffect(() => {
    if (!entryId) return;

    if (managerDetailClientCache.has(entryId)) {
      setManagerDetail(managerDetailClientCache.get(entryId)!);
    }

    refreshManagerDetail();
  }, [entryId, refreshManagerDetail]);

  // Periodic background auto-refresh while modal is open (25s cadence)
  useEffect(() => {
    if (!entryId) return;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshManagerDetail();
      }
    }, 25 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshManagerDetail();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [entryId, refreshManagerDetail]);

  // Immediate auto-refresh when parent data sync finishes or global sync event fires
  useEffect(() => {
    if (!entryId) return;

    const performSyncRefresh = () => {
      playerSummaryMemoryCache.clear();
      managerDetailClientCache.delete(entryId);
      refreshManagerDetail();
      if (activeBreakdownPlayerId !== null) {
        fetchPlayerBreakdown(activeBreakdownPlayerId, activePlayerPos, true);
      }
    };

    performSyncRefresh();

    const handleGlobalSync = () => {
      performSyncRefresh();
    };

    window.addEventListener('fpl:data-synced', handleGlobalSync);
    return () => {
      window.removeEventListener('fpl:data-synced', handleGlobalSync);
    };
  }, [entryId, lastSynced, activeBreakdownPlayerId, activePlayerPos, refreshManagerDetail, fetchPlayerBreakdown]);

  // Sorted list of available gameweeks
  const sortedGWs = useMemo(() => {
    if (availableGWs && availableGWs.length > 0) {
      return [...availableGWs].sort((a, b) => a - b);
    }
    const gwKeys = Object.keys(standings || {})
      .map(Number)
      .filter((n) => !isNaN(n));
    return gwKeys.length > 0 ? gwKeys.sort((a, b) => a - b) : [selectedGW];
  }, [availableGWs, standings, selectedGW]);

  const minGW = sortedGWs[0] ?? 1;
  const maxGW = sortedGWs[sortedGWs.length - 1] ?? 1;
  const activeGWIndex = sortedGWs.indexOf(activeGW);

  const canGoPrev = activeGWIndex > 0;
  const canGoNext = activeGWIndex < sortedGWs.length - 1 && activeGWIndex !== -1;

  const handlePrevGW = useCallback(() => {
    if (canGoPrev) {
      setActiveGW(sortedGWs[activeGWIndex - 1]);
    }
  }, [canGoPrev, sortedGWs, activeGWIndex]);

  const handleNextGW = useCallback(() => {
    if (canGoNext) {
      setActiveGW(sortedGWs[activeGWIndex + 1]);
    }
  }, [canGoNext, sortedGWs, activeGWIndex]);

  // Keyboard navigation for desktop (ArrowLeft / ArrowRight)
  useEffect(() => {
    if (!entryId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        if (canGoPrev) handlePrevGW();
      } else if (e.key === 'ArrowRight') {
        if (canGoNext) handleNextGW();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entryId, canGoPrev, canGoNext, handlePrevGW, handleNextGW]);

  // Find standings data for the selected GW
  const currentStanding = useMemo(() => {
    return ((standings && standings[activeGW]) || []).find((s) => s.entry_id === entryId);
  }, [standings, activeGW, entryId]);

  // Dynamic Global Rank per active GW from entry history
  const activeGWGlobalRank = useMemo(() => {
    const hist = managerDetail?.current_history?.find((h) => h.event === activeGW);
    return hist?.overall_rank ?? managerDetail?.summary_overall_rank ?? null;
  }, [managerDetail, activeGW]);

  // Calculate GW Rank: rank of this team solely based on event_points in activeGW
  const gwRankInfo = useMemo(() => {
    const list = (standings && standings[activeGW]) || [];
    if (!list.length || !entryId) return { rank: 1, isChampion: false };

    const sortedByGWScore = [...list].sort((a, b) => {
      if (b.event_points !== a.event_points) {
        return b.event_points - a.event_points;
      }
      return a.event_transfers_cost - b.event_transfers_cost;
    });

    const idx = sortedByGWScore.findIndex((s) => s.entry_id === entryId);
    const rank = idx !== -1 ? idx + 1 : 1;
    const topScore = sortedByGWScore[0]?.event_points ?? 0;
    const isChampion = rank === 1 || (currentStanding?.event_points === topScore && topScore > 0);

    return { rank, isChampion };
  }, [standings, activeGW, entryId, currentStanding]);

  // Group starters into tactical lines (GKP, DEF, MID, FWD)
  const startersByPosition = useMemo(() => {
    const gks = squad.starters.filter((m) => m.player.position === 'GKP' || m.player.element_type === 1);
    const defs = squad.starters.filter((m) => m.player.position === 'DEF' || m.player.element_type === 2);
    const mids = squad.starters.filter((m) => m.player.position === 'MID' || m.player.element_type === 3);
    const fwds = squad.starters.filter((m) => m.player.position === 'FWD' || m.player.element_type === 4);
    return { gks, defs, mids, fwds };
  }, [squad.starters]);

  // Total points generated by bench players
  const totalBenchPoints = useMemo(() => {
    return squad.bench.reduce((sum, item) => sum + (item.player.gw_points || 0), 0);
  }, [squad.bench]);

  // Transfers made in activeGW
  const currentGWTransfers = useMemo(() => {
    if (!entryId || !transfers) return [];
    return transfers.filter((t) => t.entry_id === entryId && t.event === activeGW);
  }, [transfers, entryId, activeGW]);

  // Check if Triple Captain chip is active for this team in activeGW
  const isTcActive = useMemo(() => {
    const chip = (currentStanding?.active_chip || '').toLowerCase();
    if (chip === 'tc' || chip === '3xc' || chip.includes('triple')) return true;
    return (
      squad.starters.some((s) => (s.ownerInfo.multiplier || 1) === 3) ||
      squad.bench.some((s) => (s.ownerInfo.multiplier || 1) === 3)
    );
  }, [currentStanding, squad.starters, squad.bench]);

  // Check if Bench Boost chip is active for this team in activeGW
  const isBbActive = useMemo(() => {
    const chip = (currentStanding?.active_chip || '').toLowerCase();
    return chip === 'bb' || chip === 'bboost' || chip.includes('bench');
  }, [currentStanding]);

  // Active chip info for hero panel badge (BB, WC, FH, TC) and theme effects, or null if no chip
  const activeChipInfo = useMemo(() => {
    if (!currentStanding?.active_chip) return null;
    const c = currentStanding.active_chip.toLowerCase().trim();
    if (c === 'none' || c === 'no chip' || c === '') return null;
    if (c === 'bboost' || c === 'bb' || c.includes('bench')) {
      return {
        code: 'BB',
        fullName: 'Bench Boost',
        badgeBg: 'bg-gradient-to-r from-cyan-400 to-cyan-500 text-slate-950 ring-1 ring-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.6)]',
        heroBorder: 'border-cyan-400/80 shadow-[0_0_16px_rgba(6,182,212,0.3)]',
        heroBg: 'bg-gradient-to-b from-cyan-950/50 via-purple-950/40 to-black/70'
      };
    }
    if (c === '3xc' || c === 'tc' || c.includes('triple')) {
      return {
        code: 'TC',
        fullName: 'Triple Captain',
        badgeBg: 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 ring-1 ring-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]',
        heroBorder: 'border-amber-400/80 shadow-[0_0_16px_rgba(251,191,36,0.3)]',
        heroBg: 'bg-gradient-to-b from-amber-950/50 via-purple-950/40 to-black/70'
      };
    }
    if (c === 'freehit' || c === 'fh' || c.includes('hit')) {
      return {
        code: 'FH',
        fullName: 'Free Hit',
        badgeBg: 'bg-gradient-to-r from-fuchsia-400 to-purple-500 text-white ring-1 ring-fuchsia-300 shadow-[0_0_8px_rgba(217,70,239,0.6)]',
        heroBorder: 'border-fuchsia-400/80 shadow-[0_0_16px_rgba(217,70,239,0.3)]',
        heroBg: 'bg-gradient-to-b from-fuchsia-950/50 via-purple-950/40 to-black/70'
      };
    }
    if (c === 'wildcard' || c === 'wc') {
      return {
        code: 'WC',
        fullName: 'Wildcard',
        badgeBg: 'bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 ring-1 ring-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
        heroBorder: 'border-emerald-400/80 shadow-[0_0_16px_rgba(16,185,129,0.3)]',
        heroBg: 'bg-gradient-to-b from-emerald-950/50 via-purple-950/40 to-black/70'
      };
    }
    return {
      code: currentStanding.active_chip.toUpperCase(),
      fullName: currentStanding.active_chip,
      badgeBg: 'bg-gradient-to-r from-[#00ff87] to-emerald-400 text-slate-950 ring-1 ring-[#00ff87] shadow-[0_0_8px_rgba(0,255,135,0.6)]',
      heroBorder: 'border-[#00ff87]/80 shadow-[0_0_16px_rgba(0,255,135,0.3)]',
      heroBg: 'bg-gradient-to-b from-purple-950/40 via-black/50 to-black/70'
    };
  }, [currentStanding]);

  // Chip display name formatted as short codes (BB, WC, FH, TC) and proper "No Chip"
  const chipDisplayName = useMemo(() => {
    if (!currentStanding?.active_chip) return 'No Chip';
    const c = currentStanding.active_chip.toLowerCase().trim();
    if (c === 'bboost' || c === 'bb' || c.includes('bench')) return 'BB';
    if (c === '3xc' || c === 'tc' || c.includes('triple')) return 'TC';
    if (c === 'freehit' || c === 'fh' || c.includes('hit')) return 'FH';
    if (c === 'wildcard' || c === 'wc') return 'WC';
    if (c === 'none' || c === 'no chip' || c === '') return 'No Chip';
    return currentStanding.active_chip.toUpperCase();
  }, [currentStanding]);

  // Data extraction helper for any given GW (used for continuous side-by-side Instagram carousel)
  const getGWData = useCallback((gw: number) => {
    const standing = ((standings && standings[gw]) || []).find((s) => s.entry_id === entryId) || {
      entry_id: entryId || 0,
      entry_name: '',
      player_name: '',
      rank: 1,
      last_rank: 1,
      rank_change: 0,
      total_points: 0,
      event_points: 0,
      event_transfers: 0,
      event_transfers_cost: 0,
      active_chip: ''
    };

    const list = (standings && standings[gw]) || [];
    let rank = 1;
    let isChampion = false;
    if (list.length && entryId) {
      const sorted = [...list].sort((a, b) => {
        if (b.event_points !== a.event_points) return b.event_points - a.event_points;
        return a.event_transfers_cost - b.event_transfers_cost;
      });
      const idx = sorted.findIndex((s) => s.entry_id === entryId);
      rank = idx !== -1 ? idx + 1 : 1;
      const topScore = sorted[0]?.event_points ?? 0;
      isChampion = rank === 1 || (standing.event_points === topScore && topScore > 0);
    }

    const pList = (ownershipPlayers && ownershipPlayers[gw]) || [];
    const matched: Array<{ player: PlayerOwnershipItem; ownerInfo: PlayerOwnerItem }> = [];
    for (const p of pList) {
      if (p.owners && Array.isArray(p.owners)) {
        const oMatch = p.owners.find((o) => o.entry_id === entryId);
        if (oMatch) matched.push({ player: p, ownerInfo: oMatch });
      }
    }
    matched.sort((a, b) => a.ownerInfo.position_in_squad - b.ownerInfo.position_in_squad);
    const starters = matched.filter((m) => m.ownerInfo.is_starter || m.ownerInfo.position_in_squad <= 11);
    const bench = matched.filter((m) => !m.ownerInfo.is_starter && m.ownerInfo.position_in_squad > 11);

    const gks = starters.filter((m) => m.player.position === 'GKP' || m.player.element_type === 1);
    const defs = starters.filter((m) => m.player.position === 'DEF' || m.player.element_type === 2);
    const mids = starters.filter((m) => m.player.position === 'MID' || m.player.element_type === 3);
    const fwds = starters.filter((m) => m.player.position === 'FWD' || m.player.element_type === 4);

    const chip = (standing.active_chip || '').toLowerCase().trim();
    const isTc = chip === 'tc' || chip === '3xc' || chip.includes('triple') ||
      starters.some((s) => (s.ownerInfo.multiplier || 1) === 3) ||
      bench.some((s) => (s.ownerInfo.multiplier || 1) === 3);
    const isBb = chip === 'bb' || chip === 'bboost' || chip.includes('bench');

    const gwTransfers = (transfers || []).filter((t) => t.entry_id === entryId && t.event === gw);

    return {
      standing,
      gwRank: { rank, isChampion },
      startersByPosition: { gks, defs, mids, fwds },
      bench,
      isTc,
      isBb,
      gwTransfers,
    };
  }, [standings, ownershipPlayers, transfers, entryId]);

  // Full Gameweek History (Sorted newest at the top)
  const fullGWHistory = useMemo(() => {
    const histMap = new Map<number, any>();
    if (managerDetail?.current_history && Array.isArray(managerDetail.current_history)) {
      for (const h of managerDetail.current_history) {
        if (h && typeof h.event === 'number') {
          histMap.set(h.event, h);
        }
      }
    }

    const items = Object.entries(standings || {})
      .map(([gwStr, list]) => {
        const gw = Number(gwStr);
        const rowList = (list || []) as StandingsRow[];
        const item = rowList.find((s) => s.entry_id === entryId);
        const histItem = histMap.get(gw);

        let gwRank = 1;
        let isGWChampion = false;
        if (rowList.length > 0) {
          const sorted = [...rowList].sort((a, b) => {
            if (b.event_points !== a.event_points) return b.event_points - a.event_points;
            return a.event_transfers_cost - b.event_transfers_cost;
          });
          const idx = sorted.findIndex((s) => s.entry_id === entryId);
          gwRank = idx !== -1 ? idx + 1 : 1;
          isGWChampion = gwRank === 1 && (item?.event_points ?? 0) > 0;
        }

        // Determine true accumulated total points: prefer official FPL history total_points if available or higher
        let trueTotalPts = item?.total_points;
        if (histItem?.total_points !== undefined && (trueTotalPts === undefined || histItem.total_points > trueTotalPts)) {
          trueTotalPts = histItem.total_points;
        }

        const resolvedItem = item ? { ...item, total_points: trueTotalPts ?? item.total_points } : item;

        return {
          gw,
          item: resolvedItem,
          gwRank,
          isGWChampion
        };
      })
      .filter((h) => h.item !== undefined)
      .sort((a, b) => b.gw - a.gw);

    return items;
  }, [standings, entryId, managerDetail?.current_history]);

  // Past Seasons History (Sorted newest season first)
  const sortedPastSeasons = useMemo(() => {
    const list = managerDetail?.past_seasons || [];
    return [...list].sort((a, b) => b.season_name.localeCompare(a.season_name));
  }, [managerDetail]);

  const careerAvg = useMemo(() => {
    if (sortedPastSeasons.length === 0) return null;
    const count = sortedPastSeasons.length;
    const totalPtsSum = sortedPastSeasons.reduce((acc, s) => acc + (s.total_points || 0), 0);
    const globalRankSum = sortedPastSeasons.reduce((acc, s) => acc + (s.rank || 0), 0);
    const fnbRanks = sortedPastSeasons.filter((s) => typeof s.fnb_rank === 'number');
    const fnbRankSum = fnbRanks.reduce((acc, s) => acc + (s.fnb_rank || 0), 0);
    const pctSum = sortedPastSeasons.reduce((acc, s) => {
      const tot = FPL_SEASON_TOTAL_PLAYERS[s.season_name] || 11100000;
      return acc + (s.rank / tot) * 100;
    }, 0);

    return {
      avgPts: Math.round(totalPtsSum / count),
      avgFnbRank: fnbRanks.length > 0 ? (fnbRankSum / fnbRanks.length).toFixed(1) : '-',
      avgGlobalRank: Math.round(globalRankSum / count).toLocaleString(),
      avgPct: (pctSum / count).toFixed(2),
    };
  }, [sortedPastSeasons]);

  // Reusable floating Gameweek dropdown for all theme variants
  const renderGWDropdown = (positionClass = 'left-1/2 -translate-x-1/2') => {
    if (!isGWDropdownOpen) return null;
    return (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsGWDropdownOpen(false)}
        />
        <div className={`absolute top-full ${positionClass} mt-1.5 w-36 bg-white dark:bg-[#190a2a] border border-slate-200 dark:border-purple-800/80 text-slate-800 dark:text-slate-100 shadow-2xl rounded-xl z-50 p-1.5 animate-in fade-in zoom-in-95 space-y-0.5 max-h-60 overflow-y-auto`}>
          {sortedGWs.map((gw) => {
            const isSelected = gw === activeGW;
            return (
              <button
                key={gw}
                type="button"
                onClick={() => {
                  setActiveGW(gw);
                  setIsGWDropdownOpen(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer gap-2 ${
                  isSelected
                    ? 'bg-purple-50 dark:bg-purple-900/60 text-purple-900 dark:text-[#00ff87] font-bold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-900/30 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>GW {gw}</span>
                {gw === maxGW && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-[#00ff87] font-mono">
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  const renderGWOverviewContent = (gw: number) => {
    const gwData = getGWData(gw);
    const { standing, gwRank, startersByPosition, bench, isTc, isBb, gwTransfers } = gwData;
    const activeChip = standing.active_chip || (isBb ? 'bboost' : isTc ? '3xc' : null);
    const fullChipName = getFullChipName(activeChip);

    const isBenchBreakdownOpen = activeBreakdownPlayerId !== null && bench.some((b) => b.player.id === activeBreakdownPlayerId);
    const isStarterBreakdownOpen = activeBreakdownPlayerId !== null && !isBenchBreakdownOpen;

    return (
      <div className="space-y-2 sm:space-y-2.5">
        {/* ================= MATCHDAY METRICS & HERO PANEL (UNBOXED, DIRECTLY ON BACKGROUND) ================= */}
        <div className={`w-full h-[84px] sm:h-[88px] flex items-center justify-between select-none relative ${isGWDropdownOpen ? 'z-50' : 'z-10'}`}>
          {/* Tombol < di ujung sekali kiri area informasi, tanpa margin dari tepian area, center secara vertikal */}
          <button
            type="button"
            onClick={handlePrevGW}
            disabled={!canGoPrev}
            className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 hover:bg-slate-700 dark:hover:bg-purple-900 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center transition-all cursor-pointer disabled:opacity-20 disabled:pointer-events-none active:scale-95"
            title={canGoPrev ? (language === 'id' ? `Lompat ke GW ${sortedGWs[activeGWIndex - 1]}` : `Jump to GW ${sortedGWs[activeGWIndex - 1]}`) : undefined}
            aria-label="Previous Gameweek"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </button>

          {/* LEFT SECTION (flex-1): Top = GW Rank, Bottom = Last Rank */}
          <div className="flex-1 flex flex-col justify-around h-full min-w-0 py-0.5 px-0.5 sm:px-1">
            {/* Top Item: GW Rank */}
            <div className="flex flex-col items-center justify-center text-center min-w-0">
              <span className="text-base sm:text-lg md:text-xl font-black text-slate-900 dark:text-white leading-none truncate">
                {gwRank.rank}
              </span>
              <span className="text-[8.5px] sm:text-[9.5px] font-bold text-slate-500 dark:text-purple-300/70 leading-none mt-1 truncate">
                GW Rank
              </span>
            </div>

            {/* Bottom Item: Last Rank (Symmetric with GW Rank) */}
            <div className="flex flex-col items-center justify-center text-center min-w-0">
              <div className="flex items-center justify-center gap-0.5 leading-none">
                <span className="text-base sm:text-lg md:text-xl font-black text-slate-900 dark:text-white">
                  {standing.rank}
                </span>
                {standing.rank_change > 0 && (
                  <span className="text-[9.5px] sm:text-[10.5px] font-black text-emerald-600 dark:text-[#00ff87] flex items-center leading-none">
                    <ArrowUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 stroke-[3]" />{standing.rank_change}
                  </span>
                )}
                {standing.rank_change < 0 && (
                  <span className="text-[9.5px] sm:text-[10.5px] font-black text-rose-600 dark:text-rose-400 flex items-center leading-none">
                    <ArrowDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 stroke-[3]" />{Math.abs(standing.rank_change)}
                  </span>
                )}
              </div>
              <span className="text-[8.5px] sm:text-[9.5px] font-bold text-slate-500 dark:text-purple-300/70 leading-none mt-1 truncate">
                Last Rank
              </span>
            </div>
          </div>

          {/* CENTER HERO PANEL: Standalone square dark badge placed directly on background */}
          <div className="relative shrink-0 z-30 flex items-center h-full mx-1">
            {/* Outer Cyan Bezel Frame: Menempel tepat di sisi luar panel tanpa menggeser layout (anti-membal) */}
            {activeChip && (
              <div
                className="absolute -inset-[2px] rounded-[14px] border-2 border-[#00e5ff] pointer-events-none z-30 shadow-[0_0_8px_rgba(0,229,255,0.35)]"
                aria-hidden="true"
              />
            )}

            <button
              type="button"
              onClick={() => setIsGWDropdownOpen((prev) => !prev)}
              className="relative w-[84px] h-[84px] sm:w-[88px] sm:h-[88px] rounded-xl cursor-pointer group focus:outline-none overflow-hidden select-none p-0 z-20 bg-gradient-to-b from-[#1c0022] via-[#10031b] to-black border border-purple-500/40 hover:border-[#00ff87]/60 shadow-md"
            >
              <svg viewBox="0 0 88 88" className="w-full h-full relative z-10 pointer-events-none select-none">
                <defs>
                  <filter id="pointsGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00ff87" floodOpacity="0.45" />
                  </filter>
                </defs>

                {/* Top: GW {gw} (Fixed position & size) */}
                <text
                  x={HERO_BADGE_CONFIG.top.x}
                  y={HERO_BADGE_CONFIG.top.y}
                  textAnchor="middle"
                  fill="#e9d5ff"
                  fontWeight={HERO_BADGE_CONFIG.top.fontWeight}
                  fontSize={HERO_BADGE_CONFIG.top.fontSize}
                  letterSpacing={HERO_BADGE_CONFIG.top.letterSpacing}
                  style={{ fontFamily: "var(--app-font), 'Plus Jakarta Sans', sans-serif" }}
                  className="group-hover:fill-[#00ff87] transition-colors"
                >
                  GW {gw}
                </text>

                {/* Center: Score Number (Fixed position & size - identical for 1, 2, or 3 digits) */}
                <text
                  x={HERO_BADGE_CONFIG.score.x}
                  y={HERO_BADGE_CONFIG.score.y}
                  textAnchor="middle"
                  fill="#00ff87"
                  fontWeight={HERO_BADGE_CONFIG.score.fontWeight}
                  fontSize={HERO_BADGE_CONFIG.score.fontSize}
                  letterSpacing={HERO_BADGE_CONFIG.score.letterSpacing}
                  filter="url(#pointsGlow)"
                  style={{ fontFamily: "var(--app-font), 'Plus Jakarta Sans', sans-serif" }}
                >
                  {standing.event_points}
                </text>

                {/* Bottom: Points label atau nama chip lengkap (Wildcard/Free Hit/Bench Boost/Triple Captain) warna cyan solid dengan jenis font aplikasi */}
                <text
                  x={HERO_BADGE_CONFIG.bottom.x}
                  y={HERO_BADGE_CONFIG.bottom.y}
                  textAnchor="middle"
                  fill={activeChip ? "#00e5ff" : "#d8b4fe"}
                  fillOpacity="1"
                  fontWeight={activeChip ? "800" : HERO_BADGE_CONFIG.bottom.fontWeight}
                  fontSize={HERO_BADGE_CONFIG.bottom.fontSize}
                  letterSpacing={HERO_BADGE_CONFIG.bottom.letterSpacing}
                  style={{ fontFamily: "var(--app-font), 'Plus Jakarta Sans', sans-serif" }}
                >
                  {activeChip ? fullChipName : t('modal_mgr_box_points')}
                </text>
              </svg>
            </button>
            {renderGWDropdown()}
          </div>

          {/* RIGHT SECTION (flex-1): Top = Hits, Bottom = Total Points */}
          <div className="flex-1 flex flex-col justify-around h-full min-w-0 py-0.5 px-0.5 sm:px-1">
            {/* Top Item: Hits */}
            <div className="flex flex-col items-center justify-center text-center min-w-0">
              <span className={`text-base sm:text-lg md:text-xl font-black leading-none truncate ${
                standing.event_transfers_cost ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
              }`}>
                {standing.event_transfers_cost ? `-${standing.event_transfers_cost}` : '0'}
              </span>
              <span className="text-[8.5px] sm:text-[9.5px] font-bold text-slate-500 dark:text-purple-300/70 leading-none mt-1 truncate">
                {t('modal_mgr_box_hits')}
              </span>
            </div>

            {/* Bottom Item: Total Points */}
            <div className="flex flex-col items-center justify-center text-center min-w-0">
              <span className="text-base sm:text-lg md:text-xl font-black text-slate-900 dark:text-white leading-none truncate">
                {standing.total_points}
              </span>
              <span className="text-[8.5px] sm:text-[9.5px] font-bold text-slate-500 dark:text-purple-300/70 leading-none mt-1 truncate">
                {t('modal_mgr_box_total')}
              </span>
            </div>
          </div>

          {/* Tombol > di ujung sekali kanan area informasi, tanpa margin dari tepian area, center secara vertikal */}
          <button
            type="button"
            onClick={handleNextGW}
            disabled={!canGoNext}
            className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 hover:bg-slate-700 dark:hover:bg-purple-900 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center transition-all cursor-pointer disabled:opacity-20 disabled:pointer-events-none active:scale-95"
            title={canGoNext ? (language === 'id' ? `Lompat ke GW ${sortedGWs[activeGWIndex + 1]}` : `Jump to GW ${sortedGWs[activeGWIndex + 1]}`) : undefined}
            aria-label="Next Gameweek"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </button>
        </div>

        {/* ================= PITCH VIEW (CLEAN TOP, REGULATION PITCH) ================= */}
        <div className={`bg-slate-900 rounded-2xl border border-slate-800 shadow-md relative ${activeBreakdownPlayerId !== null ? 'z-40' : 'z-20'}`}>
          
          {/* Pitch Grass Surface: Regulation pitch styling (overflow-visible to allow popups to overlap pitch) */}
          <div className="relative w-full pt-3 sm:pt-5 md:pt-6 pb-4 sm:pb-6 md:pb-8 px-1 sm:px-2 md:px-3 bg-[#00aa52] rounded-t-2xl select-none z-10">
            {/* 10 Alternating Horizontal Lawn Mowing Stripes */}
            <div
              className="absolute inset-0 flex flex-col pointer-events-none overflow-hidden rounded-t-2xl"
              style={{ clipPath: 'polygon(7% 0%, 93% 0%, 98.5% 100%, 1.5% 100%)' }}
            >
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 w-full ${i % 2 === 0 ? 'bg-[#00c261]' : 'bg-[#00aa52]'}`}
                />
              ))}
            </div>

            {/* SVG True 1-Point Perspective Regulation Pitch Markings */}
            <div className="absolute inset-0 overflow-hidden rounded-t-2xl pointer-events-none">
              <svg
                className="w-full h-full"
                preserveAspectRatio="none"
                viewBox="0 0 1000 1200"
              >
              {/* Top Goal Line */}
              <line x1="70" y1="0" x2="930" y2="0" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

              {/* Left & Right Touchlines */}
              <line x1="70" y1="0" x2="15" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
              <line x1="930" y1="0" x2="985" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />

              {/* Top Corner Arcs */}
              <path d="M 68.2,40 A 40,40 0 0,0 110,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
              <path d="M 931.8,40 A 40,40 0 0,1 890,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

              {/* 18-Yard Penalty Area */}
              <polyline
                points="245,0 239.8,190 760.2,190 755,0"
                fill="none"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth="3.5"
              />

              {/* 6-Yard Goal Area */}
              <polyline
                points="384.3,0 383.5,65 616.5,65 615.7,0"
                fill="none"
                stroke="rgba(255,255,255,0.88)"
                strokeWidth="3"
              />

              {/* Penalty Spot */}
              <circle cx="500" cy="127" r="4.5" fill="rgba(255,255,255,0.95)" />

              {/* Penalty Arc (D-Shape) */}
              <path
                d="M 445,190 A 85,55 0 0,0 555,190"
                fill="none"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth="3.5"
              />

              {/* Midfield Halfway Line */}
              <line x1="23.25" y1="1020" x2="976.75" y2="1020" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

              {/* Center Circle Ellipse */}
              <ellipse cx="500" cy="1020" rx="145" ry="90" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
              <circle cx="500" cy="1020" r="5" fill="rgba(255,255,255,0.95)" />
            </svg>
            </div>

            {/* Tactical Pitch Rows (GKP, DEF, MID, FWD) */}
            <div className={`relative ${isStarterBreakdownOpen ? 'z-40' : 'z-10'} space-y-3 sm:space-y-5 md:space-y-6`}>
              {/* Line 1: GKP */}
              <div>
                <div className="flex justify-center items-center gap-6 sm:gap-12 md:gap-16">
                  {startersByPosition.gks.map(({ player, ownerInfo }) => {
                    const matchInfo = getPlayerMatchInfo(player, gw);
                    return (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        ownerInfo={ownerInfo}
                        gw={gw}
                        isTcActive={isTc}
                        onSelectPlayer={onSelectPlayer}
                        isBreakdownOpen={activeBreakdownPlayerId === player.id}
                        breakdownItems={breakdownDataMap[`${player.id}_${activeGW}`]}
                        isLoadingBreakdown={loadingBreakdownId === player.id}
                        onToggleBreakdown={handleToggleBreakdown}
                        opponentLabel={matchInfo.oppLabel}
                        matchStatus={matchInfo.matchStatus}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Line 2: DEF */}
              <div>
                <div className="flex justify-center items-center gap-0.5 sm:gap-1.5 md:gap-2">
                  {startersByPosition.defs.map(({ player, ownerInfo }) => {
                    const matchInfo = getPlayerMatchInfo(player, gw);
                    return (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        ownerInfo={ownerInfo}
                        gw={gw}
                        isTcActive={isTc}
                        onSelectPlayer={onSelectPlayer}
                        isBreakdownOpen={activeBreakdownPlayerId === player.id}
                        breakdownItems={breakdownDataMap[`${player.id}_${activeGW}`]}
                        isLoadingBreakdown={loadingBreakdownId === player.id}
                        onToggleBreakdown={handleToggleBreakdown}
                        opponentLabel={matchInfo.oppLabel}
                        matchStatus={matchInfo.matchStatus}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Line 3: MID */}
              <div>
                <div className="flex justify-center items-center gap-0.5 sm:gap-1.5 md:gap-2">
                  {startersByPosition.mids.map(({ player, ownerInfo }) => {
                    const matchInfo = getPlayerMatchInfo(player, gw);
                    return (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        ownerInfo={ownerInfo}
                        gw={gw}
                        isTcActive={isTc}
                        onSelectPlayer={onSelectPlayer}
                        isBreakdownOpen={activeBreakdownPlayerId === player.id}
                        breakdownItems={breakdownDataMap[`${player.id}_${activeGW}`]}
                        isLoadingBreakdown={loadingBreakdownId === player.id}
                        onToggleBreakdown={handleToggleBreakdown}
                        opponentLabel={matchInfo.oppLabel}
                        matchStatus={matchInfo.matchStatus}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Line 4: FWD */}
              <div>
                <div className="flex justify-center items-center gap-3 sm:gap-6 md:gap-8">
                  {startersByPosition.fwds.map(({ player, ownerInfo }) => {
                    const matchInfo = getPlayerMatchInfo(player, gw);
                    return (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        ownerInfo={ownerInfo}
                        gw={gw}
                        isTcActive={isTc}
                        onSelectPlayer={onSelectPlayer}
                        isBreakdownOpen={activeBreakdownPlayerId === player.id}
                        breakdownItems={breakdownDataMap[`${player.id}_${activeGW}`]}
                        isLoadingBreakdown={loadingBreakdownId === player.id}
                        onToggleBreakdown={handleToggleBreakdown}
                        opponentLabel={matchInfo.oppLabel}
                        matchStatus={matchInfo.matchStatus}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ================= BENCH DUGOUT ================= */}
          <div className={`relative px-2 py-2 sm:px-3 sm:py-3 transition-colors ${
            isBenchBreakdownOpen ? 'z-40' : (isBb ? 'z-30' : 'z-20')
          } ${
            isBb
              ? 'bg-[#00aa52] border-t-0'
              : 'bg-[#005a2b] border-t border-[#007038]'
          }`}>
            {isBb && (
              <>
                <div
                  className="absolute inset-0 flex flex-col pointer-events-none z-0 select-none overflow-hidden"
                  style={{ clipPath: 'polygon(1.5% 0%, 98.5% 0%, 100% 100%, 0% 100%)' }}
                >
                  <div className="flex-1 w-full bg-[#00c261]" />
                  <div className="flex-1 w-full bg-[#00aa52]" />
                  <div className="flex-1 w-full bg-[#00c261]" />
                </div>

                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none z-0"
                  preserveAspectRatio="none"
                  viewBox="0 0 1000 327.3"
                >
                  <line
                    x1="15"
                    y1="0"
                    x2="0"
                    y2="327.3"
                    stroke="rgba(255,255,255,0.88)"
                    strokeWidth="3.5"
                  />
                  <line
                    x1="985"
                    y1="0"
                    x2="1000"
                    y2="327.3"
                    stroke="rgba(255,255,255,0.88)"
                    strokeWidth="3.5"
                  />
                </svg>

                {/* Bench Boost Highlight: Border atas berada di area starting XI (-top-[6px]) menempel pada bench, cyan 4px luar, putih 2px dalam, sudut atas kanan & kiri round corner */}
                <div
                  className="pointer-events-none absolute -top-[6px] left-0 right-0 bottom-0 z-20 border-t-4 border-l-4 border-r-4 border-b-0 border-[#00e5ff] rounded-t-xl"
                  style={{
                    boxShadow: 'inset 0 2px 0 0 #ffffff, inset 2px 0 0 0 #ffffff, inset -2px 0 0 0 #ffffff'
                  }}
                />
              </>
            )}

            <div className={`relative ${isBenchBreakdownOpen ? 'z-40' : 'z-10'} flex justify-center items-center gap-2 sm:gap-4 md:gap-6 max-w-lg mx-auto`}>
              {bench.map(({ player, ownerInfo }) => {
                const posLabel = player.position || (player.element_type === 1 ? 'GKP' : player.element_type === 2 ? 'DEF' : player.element_type === 3 ? 'MID' : 'FWD');
                const matchInfo = getPlayerMatchInfo(player, gw);
                return (
                  <div key={player.id} className={`flex flex-col items-center relative ${activeBreakdownPlayerId === player.id ? 'z-50' : 'z-10'}`}>
                    <span className="text-[8px] sm:text-[9px] font-black uppercase text-white/90 bg-black/40 px-1.5 py-0.5 rounded-xs mb-1 leading-none shadow-2xs">
                      {posLabel}
                    </span>
                    <PitchPlayerCard
                      player={player}
                      ownerInfo={ownerInfo}
                      gw={gw}
                      isTcActive={isTc}
                      onSelectPlayer={onSelectPlayer}
                      isBreakdownOpen={activeBreakdownPlayerId === player.id}
                      breakdownItems={breakdownDataMap[`${player.id}_${activeGW}`]}
                      isLoadingBreakdown={loadingBreakdownId === player.id}
                      onToggleBreakdown={handleToggleBreakdown}
                      opponentLabel={matchInfo.oppLabel}
                      matchStatus={matchInfo.matchStatus}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ================= GW TRANSFERS (COMPACT, NO BOX, IN ON LEFT, OUT ON RIGHT) ================= */}
        <div className="py-1">
          <div className="flex items-center justify-between mb-1 px-1">
            <h4 className="font-bold text-slate-700 dark:text-slate-200 text-xs">
              {t('modal_mgr_transfers_gw', { N: activeGW })}
            </h4>
            {gwTransfers.length > 0 && standing.event_transfers_cost > 0 && (
              <span className="text-[10.5px] font-bold text-rose-600 dark:text-rose-400">
                Hit: -{standing.event_transfers_cost} pts
              </span>
            )}
          </div>

          {gwTransfers.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-purple-900/30 text-xs">
              {gwTransfers.map((t, idx) => {
                const inPos = t.element_in?.position || (() => {
                  if (!t.element_in?.id || !ownershipPlayers) return '';
                  for (const list of Object.values(ownershipPlayers)) {
                    const p = list?.find((x) => x.id === t.element_in?.id);
                    if (p?.position) return p.position;
                  }
                  return '';
                })();
                const outPos = t.element_out?.position || (() => {
                  if (!t.element_out?.id || !ownershipPlayers) return '';
                  for (const list of Object.values(ownershipPlayers)) {
                    const p = list?.find((x) => x.id === t.element_out?.id);
                    if (p?.position) return p.position;
                  }
                  return '';
                })();

                return (
                  <div
                    key={t.id || idx}
                    className="py-1.5 px-1 flex items-center justify-between gap-2"
                  >
                    {/* IN (Kiri) */}
                    <div
                      onClick={() => onSelectPlayer && t.element_in?.id && onSelectPlayer(t.element_in.id, gw)}
                      className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0 stroke-[2.5]" />
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate text-[11px] sm:text-xs">
                        {t.element_in?.name || 'Player In'}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        ({inPos ? `${inPos}, ` : ''}{t.element_in?.club})
                      </span>
                    </div>

                    {/* Divider - Arrow pointing LEFT */}
                    <span className="text-slate-400 dark:text-slate-500 px-1 select-none flex items-center justify-center shrink-0">
                      <ArrowLeft className="w-3.5 h-3.5 stroke-[2.5]" />
                    </span>

                    {/* OUT (Kanan) */}
                    <div
                      onClick={() => onSelectPlayer && t.element_out?.id && onSelectPlayer(t.element_out.id, gw)}
                      className="flex items-center justify-end gap-1.5 min-w-0 flex-1 text-right cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      <span className="font-bold text-rose-500 dark:text-rose-400 truncate text-[11px] sm:text-xs">
                        {t.element_out?.name || 'Player Out'}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        ({outPos ? `${outPos}, ` : ''}{t.element_out?.club})
                      </span>
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0 stroke-[2.5]" />
                    </div>
                  </div>
                );
              })}
              {gwTransfers[0]?.formatted_time_wib && (
                <p className="text-[9.5px] text-slate-400 dark:text-slate-500 text-right flex items-center justify-end gap-1 pt-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{t('modal_mgr_transfer_time', { time: gwTransfers[0].formatted_time_wib.replace(/(\d{1,2})\.(\d{2})/, '$1:$2'), jam: gwTransfers[0].formatted_time_wib.replace(/(\d{1,2})\.(\d{2})/, '$1:$2') })}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 px-1 py-1">
              {t('modal_mgr_transfer_empty')}
            </p>
          )}
        </div>
      </div>
    );
  };

  if (!entryId || !currentStanding) return null;

  // Decide team badge: Adobe Express custom badge if available, otherwise optimized transparent badge
  const hasAdobeBadge = Boolean(managerDetail?.club_badge_src && !badgeImgError);
  const badgeSrc = hasAdobeBadge
    ? managerDetail!.club_badge_src!
    : '/team_badge.png';

  const teamName = currentStanding.entry_name || managerDetail?.name || 'Team';
  const managerName = currentStanding.player_name || managerDetail?.player_name || 'Manager';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white dark:bg-[#150a24] rounded-2xl max-w-2xl sm:max-w-3xl w-full border border-slate-200 dark:border-purple-900/60 shadow-2xl overflow-hidden flex flex-col h-[calc(100dvh-1.5rem)] sm:h-[88vh] max-h-[850px] animate-in fade-in duration-200">
        
        {/* ================= CLEAN HEADER (WITHOUT RANK, NO "Manager:", NO BORDER TO TABS) ================= */}
        <div className="bg-gradient-to-r from-[#37003c] via-[#28002d] to-[#1c0022] text-white pt-2 sm:pt-2.5 pb-0 px-3 sm:px-4 shrink-0">
          <div className="flex items-center justify-between gap-3">
            
            {/* Left: Full Badge & Team + Manager Info (Badge directly on header background without container) */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img
                src={badgeSrc}
                alt={`${teamName} Badge`}
                loading="eager"
                decoding="sync"
                onError={() => {
                  if (badgeSrc !== '/team_badge.png') {
                    setBadgeImgError(true);
                  }
                }}
                className="w-11 h-11 sm:w-13 sm:h-13 object-contain rounded-xl sm:rounded-2xl shrink-0 select-none filter drop-shadow"
              />

              <div className="min-w-0">
                <h3 className="font-black text-base sm:text-lg text-white leading-tight truncate">
                  {teamName}
                </h3>
                <p className="text-xs text-purple-200 truncate mt-0.5">
                  <span className="text-white font-semibold">{managerName}</span> • ID: {entryId}
                </p>
              </div>
            </div>

            {/* Right: External Link & Close Button */}
            <div className="flex items-center gap-1 shrink-0">
              <a
                href={`https://fantasy.premierleague.com/entry/${entryId}/event/${activeGW}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-purple-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors hidden sm:flex items-center gap-1 text-[11px] font-semibold"
                title={t('tooltip_open_fpl_site')}
              >
                <span>FPL Site</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                onClick={onClose}
                className="p-1 text-purple-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title={t('tooltip_close_modal')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Subtab Navigation (styled like main application subtab, seamlessly attached without border) */}
          <div className="flex items-center px-1 mt-1 sm:mt-1.5">
            <nav className="flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => setActiveTab('overview')}
                className={`relative py-1.5 px-3 sm:px-4 flex items-center justify-center transition-colors cursor-pointer select-none text-xs sm:text-[13px] leading-none ${
                  activeTab === 'overview'
                    ? 'text-white font-bold'
                    : 'text-purple-300/80 hover:text-white font-medium'
                }`}
              >
                <span>{t('modal_mgr_tab_squad')}</span>
                {activeTab === 'overview' && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`relative py-1.5 px-3 sm:px-4 flex items-center justify-center transition-colors cursor-pointer select-none text-xs sm:text-[13px] leading-none ${
                  activeTab === 'history'
                    ? 'text-white font-bold'
                    : 'text-purple-300/80 hover:text-white font-medium'
                }`}
              >
                <span>{t('modal_mgr_tab_history')}</span>
                {activeTab === 'history' && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* ================= MODAL BODY ================= */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 sm:p-3 text-slate-800 dark:text-slate-100">
          
          {/* TAB 1: GW OVERVIEW (Clean, solid single-view, 0ms instant, zero flicker) */}
          {activeTab === 'overview' && renderGWOverviewContent(activeGW)}

          {/* TAB 2: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              
              {/* 1. Gameweek History (Terbaru di atas) */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 dark:bg-purple-950/40 px-3 py-2 border-b border-slate-200 dark:border-purple-900/60 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">
                    {language === 'id' ? 'Riwayat GW' : 'GW History'}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs table-fixed">
                    <thead className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[10px] font-extrabold tracking-wider leading-tight">
                      <tr>
                        <th className="py-2 px-1 sm:px-1.5 text-left w-[15%]">GW</th>
                        <th className="py-2 px-1 sm:px-1.5 text-right w-[13%]">{language === 'id' ? <>GW<br />Poin</> : <>GW<br />Pts</>}</th>
                        <th className="py-2 px-1 sm:px-1.5 text-right w-[11%]">{language === 'id' ? 'Hit' : 'Hits'}</th>
                        <th className="py-2 px-1 sm:px-1.5 text-right w-[16%]">{language === 'id' ? <>Total<br />Poin</> : <>Total<br />Pts</>}</th>
                        <th className="py-2 px-1 sm:px-1.5 text-right w-[15%]">{language === 'id' ? <>Peringkat<br />GW</> : <>GW<br />Rank</>}</th>
                        <th className="py-2 px-1 sm:px-1.5 text-right w-[15%]">{language === 'id' ? <>Peringkat<br />Lalu</> : <>Last<br />Rank</>}</th>
                        <th className="py-2 px-1 sm:px-1.5 text-center w-[15%]">Chip</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30 text-xs">
                      {fullGWHistory.map(({ gw, item, gwRank }) => (
                        <tr
                          key={gw}
                          onClick={() => {
                            setActiveGW(gw);
                            setActiveTab('overview');
                          }}
                          className={`cursor-pointer transition-colors ${
                            gw === activeGW
                              ? 'bg-purple-50/80 dark:bg-purple-900/40 font-bold'
                              : 'hover:bg-slate-50 dark:hover:bg-purple-950/30'
                          }`}
                          title={language === 'id' ? `Klik untuk melihat detail GW ${gw}` : `Click to view GW ${gw} details`}
                        >
                          <td className="py-1.5 px-1 sm:px-1.5 font-black text-slate-900 dark:text-white whitespace-nowrap">
                            GW {gw}
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-right font-black text-purple-900 dark:text-[#00ff87] whitespace-nowrap">
                            {item?.event_points}
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-right font-semibold whitespace-nowrap">
                            {item?.event_transfers_cost ? (
                              <span className="text-rose-600 dark:text-rose-400">
                                -{item.event_transfers_cost}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-right font-black text-slate-900 dark:text-white whitespace-nowrap">
                            {item?.total_points}
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-right font-bold whitespace-nowrap">
                            <span className="text-slate-600 dark:text-slate-400 text-[10.5px]">
                              {gwRank}
                            </span>
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-right font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {item?.rank}
                          </td>
                          <td className="py-1.5 px-1 sm:px-1.5 text-center whitespace-nowrap">
                            {item?.active_chip ? (
                              <span className="bg-[#37003c] text-[#00ff87] text-[9px] font-black px-1.5 py-0.5 rounded shadow-2xs uppercase">
                                {item.active_chip}
                              </span>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 2. Season History (Musim-musim sebelumnya) */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 dark:bg-purple-950/40 px-3 py-2 border-b border-slate-200 dark:border-purple-900/60 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">
                    {t('modal_mgr_tab_history')}
                  </span>
                </div>

                {sortedPastSeasons.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs table-fixed">
                      <thead className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[10px] font-extrabold tracking-wider leading-tight">
                        <tr>
                          <th className="py-2 px-1 sm:px-2 text-left w-[22%]">{t('modal_mgr_col_season')}</th>
                          <th className="py-2 px-1 sm:px-2 text-right w-[17%]">{language === 'id' ? <>Total<br />Poin</> : <>Total<br />Pts</>}</th>
                          <th className="py-2 px-1 sm:px-2 text-right w-[15%]">FNB<br />Rank</th>
                          <th className="py-2 px-1 sm:px-2 text-right w-[29%]">{language === 'id' ? <>Peringkat<br />Dunia</> : <>Global<br />Rank</>}</th>
                          <th className="py-2 px-1 sm:px-2 text-right w-[17%]">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30 text-xs">
                        {sortedPastSeasons.map((s) => {
                          const tot = FPL_SEASON_TOTAL_PLAYERS[s.season_name] || 11100000;
                          const pct = ((s.rank / tot) * 100).toFixed(2);
                          return (
                            <tr key={s.season_name} className="hover:bg-slate-50 dark:hover:bg-purple-950/20">
                              <td className="py-1.5 px-1 sm:px-2 font-black text-slate-900 dark:text-white whitespace-nowrap">
                                {s.season_name}
                              </td>
                              <td className="py-1.5 px-1 sm:px-2 text-right font-black text-purple-900 dark:text-[#00ff87] whitespace-nowrap">
                                {s.total_points}
                              </td>
                              <td className="py-1.5 px-1 sm:px-2 text-right font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {s.fnb_rank ?? '-'}
                              </td>
                              <td className="py-1.5 px-1 sm:px-2 text-right font-black text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {s.rank.toLocaleString()}
                              </td>
                              <td className="py-1.5 px-1 sm:px-2 text-right font-mono font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {pct}%
                              </td>
                            </tr>
                          );
                        })}
                        {careerAvg && (
                          <tr className="bg-purple-50/70 dark:bg-purple-950/40 font-black border-t-2 border-purple-200 dark:border-purple-800">
                            <td className="py-2 px-1 sm:px-2 text-purple-950 dark:text-[#00ff87] leading-tight">
                              Career<br />Average
                            </td>
                            <td className="py-2 px-1 sm:px-2 text-right text-purple-950 dark:text-[#00ff87] whitespace-nowrap">
                              {careerAvg.avgPts}
                            </td>
                            <td className="py-2 px-1 sm:px-2 text-right text-slate-900 dark:text-white whitespace-nowrap">
                              {careerAvg.avgFnbRank}
                            </td>
                            <td className="py-2 px-1 sm:px-2 text-right text-slate-900 dark:text-white whitespace-nowrap">
                              {careerAvg.avgGlobalRank}
                            </td>
                            <td className="py-2 px-1 sm:px-2 text-right text-emerald-600 dark:text-[#00ff87] font-mono whitespace-nowrap">
                              {careerAvg.avgPct}%
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                    No History.
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
});

// ================= EXACT TEMPLATE SQUAD PLAYER CARD COMPONENT =================
interface PitchPlayerCardProps {
  player: PlayerOwnershipItem;
  ownerInfo: PlayerOwnerItem;
  gw: number;
  isTcActive?: boolean;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  isBreakdownOpen?: boolean;
  breakdownItems?: Array<{ code: string; value: string | number; points: number }>;
  isLoadingBreakdown?: boolean;
  onToggleBreakdown?: (playerId: number, position: string) => void;
  opponentLabel?: string;
  matchStatus?: 'upcoming' | 'live' | 'ft';
}

const PitchPlayerCard: React.FC<PitchPlayerCardProps> = React.memo(({
  player,
  ownerInfo,
  gw,
  isTcActive = false,
  onSelectPlayer,
  isBreakdownOpen = false,
  breakdownItems,
  isLoadingBreakdown = false,
  onToggleBreakdown,
  opponentLabel,
  matchStatus = 'ft',
}) => {
  const { t, language } = useLanguage();
  const isGk = player.position === 'GKP' || player.element_type === 1;
  const multiplier = ownerInfo.multiplier || 1;
  const displayPoints = (player.gw_points || 0) * multiplier;

  const isCaptain = ownerInfo.is_captain;
  const isViceCaptain = ownerInfo.is_vice_captain;
  // Sesuai tampilan resmi FPL: Saat tim menggunakan chip Triple Captain, C dan VC keduanya ber-background putih (text ungu #37003c) tanpa border
  const isTcMatch = isTcActive || multiplier === 3;

  // Ultra HD 220px jersey proxied locally for blazing fast load without CORS/ISP blocks
  const teamCode = player.team_code || 1;
  const proxyShirtUrl = `/api/fpl-shirt/${teamCode}${isGk ? '_1' : ''}`;
  const directShirtUrl = isGk
    ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}_1-220.webp`
    : `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-220.webp`;

  // Dynamic point box styling based on match status:
  // - Upcoming: Putih (bg-white text-slate-900 border border-slate-200)
  // - Live: Red rose (bg-[#e90052] text-white border border-rose-600)
  // - Full Time: Warna saat ini (bg-[#00ff87] text-[#200024] border border-[#00c968])
  const pointsBoxStyle =
    matchStatus === 'upcoming'
      ? 'bg-white group-hover/name:bg-slate-100 text-slate-900 border-x border-b border-slate-200 shadow-sm'
      : matchStatus === 'live'
      ? 'bg-[#e90052] group-hover/name:bg-[#d00049] text-white border-x border-b border-[#e90052] shadow-sm'
      : 'bg-[#00ff87] group-hover/name:bg-[#34fab0] text-[#200024] border-x border-b border-[#00c968] shadow-sm';

  const opponentDisplay = opponentLabel || player.team_short_name;

  return (
    <div
      data-breakdown-card={player.id}
      className={`relative flex flex-col items-center select-none w-[66px] sm:w-[82px] md:w-[96px] ${
        isBreakdownOpen ? 'z-50' : 'z-10'
      }`}
    >
      {/* Club Jersey Image directly from official FPL CDN - Klik jersey membuka modal pemain */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectPlayer && onSelectPlayer(player.id, gw);
        }}
        className="relative z-0 w-[60px] h-[69px] sm:w-[78px] sm:h-[85px] md:w-[94px] md:h-[102px] flex items-center justify-center cursor-pointer transition-transform hover:scale-105 group"
        title={t('tooltip_jersey_modal', { name: player.full_name || player.web_name })}
      >
        <img
          src={proxyShirtUrl}
          alt={player.team_short_name || 'Jersey'}
          className="w-full h-full object-contain filter drop-shadow select-none"
          loading="eager"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const target = e.currentTarget;
            if (target.src.includes('/api/fpl-shirt/')) {
              target.src = directShirtUrl;
            } else if (!target.src.includes('shirt_0')) {
              target.src = 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-220.webp';
            } else {
              target.onerror = null;
              target.src = '/default_team_badge.png';
            }
          }}
        />

        {/* Captain Badge (C) - Tanpa border: background putih saat TC, ungu saat normal */}
        {isCaptain && (
          <span
            className={`absolute -top-0.5 -right-0.5 font-black text-[9px] sm:text-[11px] leading-none w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center shadow-md z-20 select-none ${
              isTcMatch
                ? 'bg-white text-[#37003c]'
                : 'bg-[#37003c] text-white'
            }`}
            style={{ fontWeight: 900 }}
            title={isTcMatch ? (language === 'id' ? `Kapten (Triple Captain Aktif - ${multiplier}x poin)` : `Captain (Triple Captain Active - ${multiplier}x points)`) : (language === 'id' ? `Kapten (${multiplier}x poin)` : `Captain (${multiplier}x points)`)}
          >
            C
          </span>
        )}

        {/* Vice Captain Badge (V) - Tanpa border: background putih saat TC, ungu saat normal */}
        {!isCaptain && isViceCaptain && (
          <span
            className={`absolute -top-0.5 -right-0.5 font-black text-[9px] sm:text-[11px] leading-none w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center shadow-md z-20 select-none ${
              isTcMatch
                ? 'bg-white text-[#37003c]'
                : 'bg-[#37003c] text-white'
            }`}
            style={{ fontWeight: 900 }}
            title={isTcMatch ? (language === 'id' ? 'Wakil Kapten (Triple Captain Aktif)' : 'Vice Captain (Triple Captain Active)') : (language === 'id' ? 'Wakil Kapten' : 'Vice Captain')}
          >
            V
          </span>
        )}
      </div>

      {/* Ramping Name and Info Box: Overlapping on top of bottom 1/3 of the jersey - Klik nama / poin membuka breakdown */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleBreakdown && onToggleBreakdown(player.id, player.position);
        }}
        className="relative z-10 -mt-[23px] sm:-mt-[28px] md:-mt-[34px] w-full text-center cursor-pointer group/name"
        title={t('modal_mgr_tooltip_breakdown')}
      >
        {/* QUICK POINT BREAKDOWN POPUP (MENEMPEL TEPAT DI ATAS BOX NAMA, LEBAR SAMA PERSIS, BORDER TIPIS 3 SISI) */}
        {isBreakdownOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-full left-0 right-0 w-full bg-[#1e0026]/95 dark:bg-[#12001a]/95 backdrop-blur-md rounded-t shadow-2xl px-1.5 sm:px-2 py-1 z-50 animate-in fade-in duration-75 border-t border-x border-purple-500/40 border-b-0"
          >
            {isLoadingBreakdown && (!breakdownItems || breakdownItems.length === 0) ? (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-[9px] sm:text-[10px] md:text-[11px] font-mono leading-tight animate-pulse opacity-60">
                <span className="text-left font-black text-[#00ff87] min-w-[2ch]">MP</span>
                <span className="text-right font-bold text-slate-400">--</span>
                <span className="text-right font-black text-slate-400 min-w-[2.5ch]">--</span>
              </div>
            ) : (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-[9px] sm:text-[10px] md:text-[11px] font-mono leading-tight">
                {(breakdownItems && breakdownItems.length > 0
                  ? breakdownItems
                  : [{ code: 'MP', value: 0, points: 0 }]
                ).map((item, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const borderClass = isLast ? '' : 'border-b border-purple-900/30 pb-[1.5px]';
                  return (
                    <React.Fragment key={item.code}>
                      {/* Kolom 1: Singkatan (maks 2 karakter, rata kiri) */}
                      <span className={`text-left font-black text-[#00ff87] tracking-tight whitespace-nowrap min-w-[2ch] ${borderClass}`}>
                        {item.code}
                      </span>
                      {/* Kolom 2: Nilai (maks 2 karakter, murni rata kanan) */}
                      <span className={`text-right font-bold text-slate-200 whitespace-nowrap ${borderClass}`}>
                        {item.value}
                      </span>
                      {/* Kolom 3: Poin (maks 3 karakter, murni rata kanan, kosong jika tidak main MP 0) */}
                      <span
                        className={`text-right font-black whitespace-nowrap min-w-[2.5ch] ${borderClass} ${
                          item.code === 'MP' && item.value === 0 && item.points === 0
                            ? 'invisible'
                            : item.points > 0
                            ? 'text-[#00ff87]'
                            : item.points < 0
                            ? 'text-rose-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {item.code === 'MP' && item.value === 0 && item.points === 0
                          ? '0'
                          : item.points > 0
                          ? `+${item.points}`
                          : item.points}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Web name in 1 row without wrap - Tanpa penambahan border saat dipilih */}
        <div
          title={player.web_name}
          className="bg-[#37003c] group-hover/name:bg-purple-900 text-white text-[8.5px] sm:text-[10px] md:text-[11px] font-bold py-0.5 px-0.5 rounded-t truncate whitespace-nowrap shadow-sm border-x border-t border-purple-900 leading-tight transition-colors"
        >
          {player.web_name}
        </div>
        {/* Opponent club with H/A and Points in 1 row - Dynamic background based on match status */}
        <div
          className={`text-[7.5px] sm:text-[8.5px] md:text-[9.5px] font-black py-0.5 px-1 rounded-b flex items-center justify-between whitespace-nowrap leading-tight transition-colors ${pointsBoxStyle}`}
        >
          <span className="truncate pr-0.5" title={opponentDisplay}>
            {opponentDisplay}
          </span>
          <span className="shrink-0">{displayPoints} pts</span>
        </div>
      </div>
    </div>
  );
});
