import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X,
  ExternalLink,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  PlayerOwnershipItem,
  PlayerOwnerItem,
  PlayerSummaryDetail,
  PlayerExplainStatItem,
  DbPlayerStat,
  StandingsRow,
  TransferItem,
  PlayerHistoryPast,
  GwEventStatus,
  SyncStatus,
} from '../types.ts';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import {
  useLanguage,
  STAT_IDENTIFIER_LABELS_BY_LANG,
  FPL_STAT_TOOLTIP_TITLES_ID,
  MATCH_METRIC_LABELS_ID,
} from '../utils/i18n.ts';
import { useUserProfileId, USER_ROW_BG, USER_ROW_HOVER_BG } from '../utils/userProfile.ts';

interface PlayerDetailModalProps {
  playerId: number | null;
  initialGW: number;
  availableGWs: number[];
  onClose: () => void;
  onSelectManager?: (entryId: number, gw?: number) => void;
  ownershipPlayers: Record<number, PlayerOwnershipItem[]>;
  playerStats?: DbPlayerStat[];
  standings?: Record<number, StandingsRow[]>;
  transfers?: TransferItem[];
  lastSynced?: string;
  currentGW?: number;
  gwFixtures?: any[];
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
}

type ModalTab = 'overview' | 'owners' | 'history';
type OwnerSortField = 'team' | 'squad' | 'captain';
type SortDirection = 'asc' | 'desc';

// High-speed client cache to make modal transitions instantaneous (0ms)
export const playerSummaryClientCache = new Map<string, PlayerSummaryDetail>();

export const prefetchPlayerSummary = (playerId: number, gw: number) => {
  if (!playerId) return;
  const key = `${playerId}_${gw}`;
  if (playerSummaryClientCache.has(key)) return;
  fetch(`/api/fpl-player-summary/${playerId}?gw=${gw}`)
    .then((res) => res.json())
    .then((json) => {
      if (json.success && json.data) {
        playerSummaryClientCache.set(key, json.data);
        playerSummaryClientCache.set(String(playerId), json.data);
      }
    })
    .catch(() => {});
};

const STAT_IDENTIFIER_LABELS: Record<string, string> = {
  minutes: 'Minutes Played',
  goals_scored: 'Goals Scored',
  assists: 'Assists',
  clean_sheets: 'Clean Sheets',
  goals_conceded: 'Goals Conceded',
  own_goals: 'Own Goals',
  penalties_saved: 'Penalties Saved',
  penalties_missed: 'Penalties Missed',
  yellow_cards: 'Yellow Cards',
  red_cards: 'Red Cards',
  saves: 'Saves',
  bonus: 'Bonus Points',
  defensive_contribution: 'Defensive Contribution (DefCon)'
};

const GW_HISTORY_COLUMNS = [
  { key: 'gw', label: 'GW', title: 'Gameweek', align: 'text-left' },
  { key: 'opp', label: 'Opponent', title: 'Opponent Team (Home/Away)', align: 'text-left' },
  { key: 'res', label: 'Result', title: 'Match Result (Win / Draw / Loss)', align: 'text-center' },
  { key: 'pts', label: 'Pts', title: 'Total Points', align: 'text-right' },
  { key: 'st', label: 'ST', title: 'Starts (Started Match)', align: 'text-center' },
  { key: 'mp', label: 'MP', title: 'Minutes Played', align: 'text-right' },
  { key: 'gs', label: 'GS', title: 'Goals Scored', align: 'text-center' },
  { key: 'a', label: 'A', title: 'Assists', align: 'text-center' },
  { key: 'xg', label: 'xG', title: 'Expected Goals', align: 'text-right' },
  { key: 'xa', label: 'xA', title: 'Expected Assists', align: 'text-right' },
  { key: 'xgi', label: 'xGI', title: 'Expected Goal Involvement', align: 'text-right' },
  { key: 'cs', label: 'CS', title: 'Clean Sheets', align: 'text-center' },
  { key: 'gc', label: 'GC', title: 'Goals Conceded', align: 'text-center' },
  { key: 'xgc', label: 'xGC', title: 'Expected Goals Conceded', align: 'text-right' },
  { key: 't', label: 'T', title: 'Tackles', align: 'text-center' },
  { key: 'cbi', label: 'CBI', title: 'Clearances, Blocks & Interceptions', align: 'text-center' },
  { key: 'r', label: 'R', title: 'Recoveries', align: 'text-center' },
  { key: 'dc', label: 'DC', title: 'Defensive Contribution', align: 'text-center' },
  { key: 'og', label: 'OG', title: 'Own Goals', align: 'text-center' },
  { key: 'ps', label: 'PS', title: 'Penalties Saved', align: 'text-center' },
  { key: 'pm', label: 'PM', title: 'Penalties Missed', align: 'text-center' },
  { key: 'yc', label: 'YC', title: 'Yellow Cards', align: 'text-center' },
  { key: 'rc', label: 'RC', title: 'Red Cards', align: 'text-center' },
  { key: 's', label: 'S', title: 'Saves', align: 'text-center' },
  { key: 'bp', label: 'BP', title: 'Bonus Points', align: 'text-center' },
  { key: 'bps', label: 'BPS', title: 'Bonus Points System', align: 'text-center' },
  { key: 'inf', label: 'I', title: 'Influence (ICT Index)', align: 'text-right' },
  { key: 'cre', label: 'C', title: 'Creativity (ICT Index)', align: 'text-right' },
  { key: 'thr', label: 'T', title: 'Threat (ICT Index)', align: 'text-right' },
  { key: 'ii', label: 'II', title: 'ICT Index (Influence, Creativity, Threat)', align: 'text-right' },
  { key: 'nt', label: 'NT', title: 'Net Transfers (FNB League)', align: 'text-center' },
  { key: 'tsb', label: 'TSB', title: 'Teams Selected By (FNB League Ownership %)', align: 'text-center' },
  { key: 'cost', label: '£', title: 'Player Price (£m)', align: 'text-right' },
] as const;

const PAST_SEASON_COLUMNS = [
  { key: 'season', label: 'Season', title: 'Premier League Season', align: 'text-left' },
  { key: 'pts', label: 'Pts', title: 'Total Points', align: 'text-right' },
  { key: 'st', label: 'ST', title: 'Starts (Started Match)', align: 'text-center' },
  { key: 'mp', label: 'MP', title: 'Minutes Played', align: 'text-right' },
  { key: 'gs', label: 'GS', title: 'Goals Scored', align: 'text-center' },
  { key: 'a', label: 'A', title: 'Assists', align: 'text-center' },
  { key: 'xg', label: 'xG', title: 'Expected Goals', align: 'text-right' },
  { key: 'xa', label: 'xA', title: 'Expected Assists', align: 'text-right' },
  { key: 'xgi', label: 'xGI', title: 'Expected Goal Involvement', align: 'text-right' },
  { key: 'cs', label: 'CS', title: 'Clean Sheets', align: 'text-center' },
  { key: 'gc', label: 'GC', title: 'Goals Conceded', align: 'text-center' },
  { key: 'xgc', label: 'xGC', title: 'Expected Goals Conceded', align: 'text-right' },
  { key: 't', label: 'T', title: 'Tackles', align: 'text-center' },
  { key: 'cbi', label: 'CBI', title: 'Clearances, Blocks & Interceptions', align: 'text-center' },
  { key: 'r', label: 'R', title: 'Recoveries', align: 'text-center' },
  { key: 'dc', label: 'DC', title: 'Defensive Contribution', align: 'text-center' },
  { key: 'og', label: 'OG', title: 'Own Goals', align: 'text-center' },
  { key: 'ps', label: 'PS', title: 'Penalties Saved', align: 'text-center' },
  { key: 'pm', label: 'PM', title: 'Penalties Missed', align: 'text-center' },
  { key: 'yc', label: 'YC', title: 'Yellow Cards', align: 'text-center' },
  { key: 'rc', label: 'RC', title: 'Red Cards', align: 'text-center' },
  { key: 's', label: 'S', title: 'Saves', align: 'text-center' },
  { key: 'bp', label: 'BP', title: 'Bonus Points', align: 'text-center' },
  { key: 'bps', label: 'BPS', title: 'Bonus Points System', align: 'text-center' },
  { key: 'inf', label: 'I', title: 'Influence (ICT Index)', align: 'text-right' },
  { key: 'cre', label: 'C', title: 'Creativity (ICT Index)', align: 'text-right' },
  { key: 'thr', label: 'T', title: 'Threat (ICT Index)', align: 'text-right' },
  { key: 'ii', label: 'II', title: 'ICT Index (Influence, Creativity, Threat)', align: 'text-right' },
  { key: 'start_cost', label: '£S', title: 'Starting Price (£m)', align: 'text-right' },
  { key: 'end_cost', label: '£E', title: 'Ending Price (£m)', align: 'text-right' },
] as const;

// Official FPL 2024/2025 Premier League Club dictionary (ID -> Code, Name, Short Name)
const FPL_TEAMS_BY_ID: Record<number, { id: number; code: number; name: string; short_name: string }> = {
  1: { id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' },
  2: { id: 2, code: 7, name: 'Aston Villa', short_name: 'AVL' },
  3: { id: 3, code: 91, name: 'Bournemouth', short_name: 'BOU' },
  4: { id: 4, code: 94, name: 'Brentford', short_name: 'BRE' },
  5: { id: 5, code: 36, name: 'Brighton', short_name: 'BHA' },
  6: { id: 6, code: 8, name: 'Chelsea', short_name: 'CHE' },
  7: { id: 7, code: 9, name: 'Coventry City', short_name: 'COV' },
  8: { id: 8, code: 31, name: 'Crystal Palace', short_name: 'CRY' },
  9: { id: 9, code: 11, name: 'Everton', short_name: 'EVE' },
  10: { id: 10, code: 54, name: 'Fulham', short_name: 'FUL' },
  11: { id: 11, code: 88, name: 'Hull City', short_name: 'HUL' },
  12: { id: 12, code: 40, name: 'Ipswich Town', short_name: 'IPS' },
  13: { id: 13, code: 2, name: 'Leeds', short_name: 'LEE' },
  14: { id: 14, code: 14, name: 'Liverpool', short_name: 'LIV' },
  15: { id: 15, code: 43, name: 'Man City', short_name: 'MCI' },
  16: { id: 16, code: 1, name: 'Man Utd', short_name: 'MUN' },
  17: { id: 17, code: 4, name: 'Newcastle', short_name: 'NEW' },
  18: { id: 18, code: 17, name: "Nott'm Forest", short_name: 'NFO' },
  19: { id: 19, code: 6, name: 'Spurs', short_name: 'TOT' },
  20: { id: 20, code: 56, name: 'Sunderland', short_name: 'SUN' },
};

export const PlayerDetailModal: React.FC<PlayerDetailModalProps> = React.memo(({
  playerId,
  initialGW,
  availableGWs = [],
  onClose,
  onSelectManager,
  ownershipPlayers = {},
  playerStats = [],
  standings = {},
  transfers = [],
  lastSynced,
  currentGW,
  gwFixtures = [],
  gwStatus,
  eventsStatus,
  syncStatus,
}) => {
  const { t, language } = useLanguage();
  const userProfileId = useUserProfileId();
  const [activeGW, setActiveGW] = useState<number>(initialGW);
  const [isGWDropdownOpen, setIsGWDropdownOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [ownerSearch, setOwnerSearch] = useState<string>('');
  const [ownerSortField, setOwnerSortField] = useState<OwnerSortField | null>(null);
  const [ownerSortDirection, setOwnerSortDirection] = useState<SortDirection>('asc');

  // Sorted list of available gameweeks
  const sortedGWs = useMemo(() => {
    if (availableGWs && availableGWs.length > 0) {
      return [...availableGWs].sort((a, b) => a - b);
    }
    const gwKeys = Object.keys(standings || {})
      .map(Number)
      .filter((n) => !isNaN(n));
    return gwKeys.length > 0 ? gwKeys.sort((a, b) => a - b) : [initialGW];
  }, [availableGWs, standings, initialGW]);

  const maxGW = sortedGWs[sortedGWs.length - 1] ?? activeGW;
  const effectiveCurrentGW = currentGW || maxGW;
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
    if (!playerId) return;
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
  }, [playerId, canGoPrev, canGoNext, handlePrevGW, handleNextGW]);

  // Close dropdown on tab change or player change
  useEffect(() => {
    setIsGWDropdownOpen(false);
  }, [playerId, activeTab]);

  // Reusable floating Gameweek dropdown filter
  const renderGWDropdown = (positionClass = 'left-1/2 -translate-x-1/2') => {
    if (!isGWDropdownOpen) return null;
    return (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={(e) => {
            e.stopPropagation();
            setIsGWDropdownOpen(false);
          }}
        />
        <div className={`absolute top-full ${positionClass} mt-1.5 w-36 bg-white dark:bg-[#190a2a] border border-slate-200 dark:border-purple-800/80 text-slate-800 dark:text-slate-100 shadow-2xl rounded-xl z-50 p-1.5 animate-in fade-in zoom-in-95 space-y-0.5 max-h-60 overflow-y-auto`}>
          {sortedGWs.map((gw) => {
            const isSelected = gw === activeGW;
            return (
              <button
                key={gw}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
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
                    {language === 'id' ? 'Terkini' : 'Current'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  // Synchronous cache lookup for instantaneous 0ms frame-0 render without 1-frame flash
  const initialCacheKey = playerId ? `${playerId}_${initialGW}` : '';
  const initialCached = initialCacheKey ? (playerSummaryClientCache.get(initialCacheKey) || playerSummaryClientCache.get(String(playerId)) || null) : null;
  const [summaryData, setSummaryData] = useState<PlayerSummaryDetail | null>(initialCached);
  const [loadingSummary, setLoadingSummary] = useState<boolean>(!initialCached);
  const [prevPlayerId, setPrevPlayerId] = useState<number | null>(playerId);

  // Synchronously update summaryData & loadingSummary ONLY if playerId changes (never wipe out when only GW changes)
  if (prevPlayerId !== playerId) {
    setPrevPlayerId(playerId);
    const cached = playerId ? (playerSummaryClientCache.get(`${playerId}_${activeGW}`) || playerSummaryClientCache.get(String(playerId)) || null) : null;
    setSummaryData(cached);
    setLoadingSummary(!cached);
  }

  const [photoError, setPhotoError] = useState<boolean>(false);
  const [activeHeaderTooltip, setActiveHeaderTooltip] = useState<string | null>(null);

  // Close header tooltip on outside click
  useEffect(() => {
    if (!activeHeaderTooltip) return;
    const handleGlobalClick = () => setActiveHeaderTooltip(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [activeHeaderTooltip]);

  // Reset photo error status when player or activeGW changes
  useEffect(() => {
    setPhotoError(false);
  }, [playerId, activeGW]);

  // Sync initialGW if changed from props
  useEffect(() => {
    setActiveGW(initialGW);
  }, [initialGW]);

  // Handle device back button to close modal cleanly without double-back or auto-close
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleClose = useCallback(() => {
    if (window.history.state?.modal === 'playerDetail') {
      window.history.back();
    }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!playerId) return;

    // Push history entry only if not already tagged for playerDetail
    if (window.history.state?.modal !== 'playerDetail') {
      window.history.pushState({ modal: 'playerDetail' }, '');
    }

    const handlePopState = () => {
      if (window.history.state?.modal !== 'playerDetail') {
        onCloseRef.current();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playerId, handleClose]);

  // Find player metadata in ownershipPlayers across GWs
  const playerMeta = useMemo(() => {
    if (!playerId) return null;
    const safeOwnership = ownershipPlayers || {};
    const currentList = safeOwnership[activeGW] || [];
    let found = currentList.find((p) => p.id === playerId);
    if (!found && Array.isArray(availableGWs)) {
      for (const gw of availableGWs) {
        const list = safeOwnership[gw] || [];
        found = list.find((p) => p.id === playerId);
        if (found) break;
      }
    }
    return found || null;
  }, [playerId, activeGW, ownershipPlayers, availableGWs]);

  // Reusable function to refresh player stats with cache-busting
  const refreshPlayerStats = useCallback(async () => {
    if (!playerId) return;
    try {
      const cacheKey = `${playerId}_${activeGW}`;
      const res = await fetch(`/api/fpl-player-summary/${playerId}?gw=${activeGW}&_t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          playerSummaryClientCache.set(cacheKey, json.data);
          setSummaryData(json.data);
        }
      }
    } catch {
      // Silent catch for background polling
    }
  }, [playerId, activeGW]);

  // Fetch player official history & live stats when playerId or activeGW changes (Stale-While-Revalidate)
  useEffect(() => {
    if (!playerId) return;
    let isCancelled = false;

    // 1. Check client-side memory cache first for 0ms instantaneous opening
    const cacheKey = `${playerId}_${activeGW}`;
    const cached = playerSummaryClientCache.get(cacheKey) || playerSummaryClientCache.get(String(playerId));
    if (cached) {
      setSummaryData(cached);
      setLoadingSummary(false);
    } else {
      setLoadingSummary((prev) => (!summaryData ? true : prev));
    }

    // 2. Always fetch fresh in background with timestamp so live match changes appear seamlessly
    fetch(`/api/fpl-player-summary/${playerId}?gw=${activeGW}&_t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch player statistics');
        return res.json();
      })
      .then((json) => {
        if (!isCancelled && json.success && json.data) {
          playerSummaryClientCache.set(cacheKey, json.data);
          playerSummaryClientCache.set(String(playerId), json.data);
          setSummaryData(json.data);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn('Player summary fetch error:', err);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoadingSummary(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [playerId, activeGW]);

  // Periodic background auto-refresh while modal is open (20s cadence during live matches)
  useEffect(() => {
    if (!playerId) return;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshPlayerStats();
      }
    }, 20 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshPlayerStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [playerId, activeGW, refreshPlayerStats]);

  // Owners in activeGW
  const currentGWPlayer = playerId
    ? (ownershipPlayers[activeGW] || []).find((p) => p.id === playerId)
    : undefined;

  // Immediate auto-refresh whenever this player's points change in parent ownershipPlayers, when parent sync finishes, or when global sync event fires
  const currentGWPoints = currentGWPlayer?.gw_points;
  useEffect(() => {
    if (!playerId) return;

    const performSyncRefresh = () => {
      playerSummaryClientCache.clear();
      refreshPlayerStats();
    };

    performSyncRefresh();

    const handleGlobalSync = () => {
      performSyncRefresh();
    };

    window.addEventListener('fpl:data-synced', handleGlobalSync);
    return () => {
      window.removeEventListener('fpl:data-synced', handleGlobalSync);
    };
  }, [playerId, currentGWPoints, lastSynced, refreshPlayerStats]);
  const owners: PlayerOwnerItem[] = useMemo(() => {
    return currentGWPlayer?.owners || [];
  }, [currentGWPlayer]);

  // Check if a manager has Bench Boost active in activeGW
  const isManagerBenchBoost = useCallback(
    (owner: PlayerOwnerItem) => {
      const currentStandingsList = standings?.[activeGW] || [];
      const standing = currentStandingsList.find((s) => s.entry_id === owner.entry_id);
      const chip = (standing?.active_chip || (owner as any).active_chip || '').toLowerCase().trim();
      if (chip === 'bboost' || chip === 'bb' || chip.includes('bench')) return true;
      if (!owner.is_starter && (owner.multiplier > 0 || (owner as any).is_bench_boost)) return true;
      return false;
    },
    [standings, activeGW]
  );

  // Check if a manager has Triple Captain active in activeGW
  const isManagerTripleCaptain = useCallback(
    (owner: PlayerOwnerItem) => {
      if (owner.multiplier === 3) return true;
      const currentStandingsList = standings?.[activeGW] || [];
      const standing = currentStandingsList.find((s) => s.entry_id === owner.entry_id);
      if (standing) {
        const chip = (standing.active_chip || '').toLowerCase().trim();
        if (chip === '3xc' || chip === 'tc' || chip.includes('triple')) return true;
        if (standing.captain?.multiplier === 3) return true;
      }
      const currentGWPlayers = ownershipPlayers?.[activeGW] || [];
      for (const p of currentGWPlayers) {
        const o = p.owners?.find((item) => item.entry_id === owner.entry_id);
        if (o && o.multiplier === 3) return true;
      }
      return false;
    },
    [standings, activeGW, ownershipPlayers]
  );

  const handleSort = (field: OwnerSortField) => {
    if (ownerSortField === field) {
      setOwnerSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOwnerSortField(field);
      setOwnerSortDirection(field === 'team' ? 'asc' : 'desc');
    }
  };

  const filteredOwners = useMemo(() => {
    let list = [...owners];
    if (ownerSearch.trim()) {
      const q = ownerSearch.toLowerCase();
      list = list.filter(
        (o) =>
          o.entry_name.toLowerCase().includes(q) ||
          o.player_name.toLowerCase().includes(q)
      );
    }

    if (!ownerSortField) return list;

    return [...list].sort((a, b) => {
      if (ownerSortField === 'team') {
        const cmp = a.entry_name.localeCompare(b.entry_name, undefined, { sensitivity: 'base' });
        return ownerSortDirection === 'asc' ? cmp : -cmp;
      }
      if (ownerSortField === 'squad') {
        const getSquadScore = (o: PlayerOwnerItem) => {
          if (o.is_starter) return 3;
          if (isManagerBenchBoost(o)) return 2;
          return 1;
        };
        const diff = getSquadScore(a) - getSquadScore(b);
        if (diff !== 0) {
          return ownerSortDirection === 'asc' ? diff : -diff;
        }
        return a.entry_name.localeCompare(b.entry_name);
      }
      if (ownerSortField === 'captain') {
        const getCaptainScore = (o: PlayerOwnerItem) => {
          const isTc = isManagerTripleCaptain(o);
          if (o.is_captain && (o.multiplier === 3 || isTc)) return 4;
          if (o.is_captain) return 3;
          if (o.is_vice_captain && isTc) return 2;
          if (o.is_vice_captain) return 1;
          return 0;
        };
        const diff = getCaptainScore(a) - getCaptainScore(b);
        if (diff !== 0) {
          return ownerSortDirection === 'asc' ? diff : -diff;
        }
        return a.entry_name.localeCompare(b.entry_name);
      }
      return 0;
    });
  }, [owners, ownerSearch, ownerSortField, ownerSortDirection, isManagerBenchBoost, isManagerTripleCaptain]);

  const totalLeagueManagers = useMemo(() => {
    const fromStandings = (standings?.[activeGW] || []).length;
    if (fromStandings > 0) return fromStandings;
    for (const gw of availableGWs) {
      const list = standings?.[gw] || [];
      if (list.length > 0) return list.length;
    }
    if (playerMeta?.owned_percentage && owners.length > 0) {
      return Math.round((owners.length / playerMeta.owned_percentage) * 100);
    }
    return owners.length || 1;
  }, [standings, activeGW, availableGWs, playerMeta, owners]);

  const infoStats = useMemo(() => {
    let ownedCount = owners.length;
    let startedCount = 0;
    let benchedCount = 0;
    let benchBoostedCount = 0;
    let captainedCount = 0;
    let viceCaptainedCount = 0;
    let tripleCaptainedCount = 0;
    let tripleViceCaptainedCount = 0;

    for (const o of owners) {
      const isTc = isManagerTripleCaptain(o);

      if (o.is_starter) {
        startedCount++;
      } else {
        benchedCount++;
        if (isManagerBenchBoost(o)) {
          benchBoostedCount++;
        }
      }

      if (o.is_captain) {
        if (o.multiplier === 3 || isTc) {
          tripleCaptainedCount++;
        } else {
          captainedCount++;
        }
      } else if (o.is_vice_captain) {
        if (isTc) {
          tripleViceCaptainedCount++;
        } else {
          viceCaptainedCount++;
        }
      }
    }

    const formatPct = (cnt: number) => {
      if (!totalLeagueManagers || totalLeagueManagers <= 0) return '0%';
      const pct = Number(((cnt / totalLeagueManagers) * 100).toFixed(1));
      return `${pct}%`;
    };

    const isId = language === 'id';
    const rows = [
      { label: isId ? 'Dimiliki oleh' : 'Owned by', count: ownedCount },
      { label: isId ? 'Dimainkan (Starter) oleh' : 'Started by', count: startedCount },
      { label: isId ? 'Dicadangkan oleh' : 'Benched by', count: benchedCount },
      { label: isId ? 'Bench Boost aktif oleh' : 'Bench Boosted by', count: benchBoostedCount },
      { label: isId ? 'Dikaptenkan oleh' : 'Captained by', count: captainedCount },
      { label: isId ? 'Wakil Kapten oleh' : 'Vice Captained by', count: viceCaptainedCount },
      { label: isId ? 'Triple Captain oleh' : 'Triple Captained by', count: tripleCaptainedCount },
      { label: isId ? 'Triple Wakil Kapten oleh' : 'Triple (Vice) Captained by', count: tripleViceCaptainedCount },
    ];

    return rows
      .filter((r) => r.count > 0)
      .map((r) => ({
        ...r,
        pct: formatPct(r.count),
      }));
  }, [owners, totalLeagueManagers, isManagerTripleCaptain, isManagerBenchBoost, language]);

  // Calculate FNB League Net Transfers and Ownership % for a given GW
  const getFnbMetrics = useCallback(
    (gw: number) => {
      // 1. TSB (Ownership %) in FNB League
      const gwOwnershipList = ownershipPlayers[gw] || [];
      const pOwnership = gwOwnershipList.find((p) => p.id === playerId);
      const tsb = pOwnership ? `${pOwnership.owned_percentage.toFixed(1)}%` : '0.0%';

      // 2. Net Transfers (NT) in FNB League for this GW
      let inCount = 0;
      let outCount = 0;
      if (transfers && transfers.length > 0) {
        for (const t of transfers) {
          if (t.event === gw) {
            if (t.element_in?.id === playerId) inCount++;
            if (t.element_out?.id === playerId) outCount++;
          }
        }
      }
      const netTransfers = inCount - outCount;
      const ntFormatted = netTransfers > 0 ? `+${netTransfers}` : `${netTransfers}`;

      return { tsb, netTransfers, ntFormatted };
    },
    [ownershipPlayers, transfers, playerId]
  );

  // Determine Match Result Outcome (W/D/L), badge color, and formatted score
  const getMatchResultDetails = useCallback(
    (h: any) => {
      const hasScore =
        h.team_h_score !== null &&
        h.team_h_score !== undefined &&
        h.team_a_score !== null &&
        h.team_a_score !== undefined;

      // If match has no score, show "Upcoming"
      if (!hasScore) {
        return {
          outcome: 'UPCOMING' as const,
          badgeBg: 'bg-slate-200 dark:bg-purple-900/40 text-slate-600 dark:text-purple-200 border border-slate-300 dark:border-purple-700/50',
          scoreDisplay: 'Upcoming',
          isUpcoming: true
        };
      }

      const myScore = h.was_home ? h.team_h_score : h.team_a_score;
      const oppScore = h.was_home ? h.team_a_score : h.team_h_score;
      let outcome: 'W' | 'D' | 'L' = 'D';
      let badgeBg = 'bg-slate-500 text-white';

      if (myScore > oppScore) {
        outcome = 'W';
        badgeBg = 'bg-emerald-600 text-white';
      } else if (myScore < oppScore) {
        outcome = 'L';
        badgeBg = 'bg-rose-600 text-white';
      }

      const scoreDisplay = `${h.team_h_score} - ${h.team_a_score}`;
      return { outcome, badgeBg, scoreDisplay, isUpcoming: false };
    },
    []
  );

  // GW History sorted descending by Gameweek
  const sortedHistory = useMemo(() => {
    if (!summaryData?.history) return [];
    return [...summaryData.history].sort((a, b) => b.round - a.round);
  }, [summaryData?.history]);

  // Previous seasons sorted descending by season_name (e.g. 2024/25, 2023/24)
  const sortedPastSeasons = useMemo(() => {
    if (!summaryData?.history_past) return [];
    return [...summaryData.history_past].sort((a, b) => b.season_name.localeCompare(a.season_name));
  }, [summaryData?.history_past]);

  // Dynamic positioning for clicked header tooltips to prevent edge clipping
  const getHeaderTooltipClasses = (key: string) => {
    if (key === 'gw' || key === 'season' || key === 'opp') {
      return {
        box: 'left-0 translate-x-0',
        arrow: 'left-4 -translate-x-1/2',
      };
    }
    if (
      key === 'cost' ||
      key === 'end_cost' ||
      key === 'start_cost' ||
      key === 'tsb' ||
      key === 'nt'
    ) {
      return {
        box: 'right-0 left-auto translate-x-0',
        arrow: 'right-4 translate-x-1/2',
      };
    }
    return {
      box: 'left-1/2 -translate-x-1/2',
      arrow: 'left-1/2 -translate-x-1/2',
    };
  };

  // Aggregated Season totals for GW History
  const seasonHistoryTotals = useMemo(() => {
    if (!summaryData?.history || summaryData.history.length === 0) return null;
    const list = summaryData.history;

    let pts = 0;
    let st = 0;
    let mp = 0;
    let gs = 0;
    let a = 0;
    let xg = 0;
    let xa = 0;
    let xgi = 0;
    let cs = 0;
    let gc = 0;
    let xgc = 0;
    let t = 0;
    let cbi = 0;
    let r = 0;
    let dc = 0;
    let og = 0;
    let ps = 0;
    let pm = 0;
    let yc = 0;
    let rc = 0;
    let s = 0;
    let bp = 0;
    let bps = 0;
    let inf = 0;
    let cre = 0;
    let thr = 0;
    let ii = 0;
    let nt = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;

    for (const h of list) {
      pts += h.total_points || 0;
      st += h.starts || 0;
      mp += h.minutes || 0;
      gs += h.goals_scored || 0;
      a += h.assists || 0;
      xg += Number(h.expected_goals) || 0;
      xa += Number(h.expected_assists) || 0;
      xgi += Number(h.expected_goal_involvements) || 0;
      cs += h.clean_sheets || 0;
      gc += h.goals_conceded || 0;
      xgc += Number(h.expected_goals_conceded) || 0;
      t += h.tackles || 0;
      cbi += h.clearances_blocks_interceptions || 0;
      r += h.recoveries || 0;
      dc += h.defensive_contribution || 0;
      og += h.own_goals || 0;
      ps += h.penalties_saved || 0;
      pm += h.penalties_missed || 0;
      yc += h.yellow_cards || 0;
      rc += h.red_cards || 0;
      s += h.saves || 0;
      bp += h.bonus || 0;
      bps += h.bps || 0;
      inf += Number(h.influence) || 0;
      cre += Number(h.creativity) || 0;
      thr += Number(h.threat) || 0;
      ii += Number(h.ict_index) || 0;

      const res = getMatchResultDetails(h);
      if (!res.isUpcoming) {
        if (res.outcome === 'W') wins++;
        else if (res.outcome === 'D') draws++;
        else if (res.outcome === 'L') losses++;
      }

      const m = getFnbMetrics(h.round);
      nt += m.netTransfers;
    }

    const latestRound = sortedHistory[0]?.round || activeGW;
    const latestPrice = sortedHistory[0]?.value ? (sortedHistory[0].value / 10).toFixed(1) : '-';
    const latestTsb = getFnbMetrics(latestRound).tsb;

    return {
      pts,
      st,
      mp,
      gs,
      a,
      xg: xg.toFixed(2),
      xa: xa.toFixed(2),
      xgi: xgi.toFixed(2),
      cs,
      gc,
      xgc: xgc.toFixed(2),
      t,
      cbi,
      r,
      dc,
      og,
      ps,
      pm,
      yc,
      rc,
      s,
      bp,
      bps,
      inf: inf.toFixed(1),
      cre: cre.toFixed(1),
      thr: thr.toFixed(1),
      ii: ii.toFixed(1),
      nt: nt > 0 ? `+${nt}` : `${nt}`,
      tsb: latestTsb,
      price: latestPrice,
      record: `${wins}W ${draws}D ${losses}L`
    };
  }, [summaryData?.history, sortedHistory, getFnbMetrics, getMatchResultDetails, activeGW]);

  if (!playerId) return null;

  // Selected GW Round stats from history
  const roundHistory = summaryData?.history?.find((h) => h.round === activeGW);

  // Live stats or fallback to round history
  const liveStats = summaryData?.live_stats;
  const explainList: PlayerExplainStatItem[] = summaryData?.live_explain?.[0]?.stats || [];

  // Effective GW stats
  const starts = liveStats?.starts ?? roundHistory?.starts ?? 0;
  const minutesPlayed = liveStats?.minutes ?? roundHistory?.minutes ?? 0;
  const goalsScored = liveStats?.goals_scored ?? roundHistory?.goals_scored ?? 0;
  const assists = liveStats?.assists ?? roundHistory?.assists ?? 0;
  const cleanSheets = liveStats?.clean_sheets ?? roundHistory?.clean_sheets ?? 0;
  const defCon = liveStats?.defensive_contribution ?? roundHistory?.defensive_contribution ?? 0;
  const goalsConceded = liveStats?.goals_conceded ?? roundHistory?.goals_conceded ?? 0;
  const yellowCards = liveStats?.yellow_cards ?? roundHistory?.yellow_cards ?? 0;
  const redCards = liveStats?.red_cards ?? roundHistory?.red_cards ?? 0;
  const saves = liveStats?.saves ?? roundHistory?.saves ?? 0;
  const penaltiesSaved = liveStats?.penalties_saved ?? roundHistory?.penalties_saved ?? 0;
  const penaltiesMissed = liveStats?.penalties_missed ?? roundHistory?.penalties_missed ?? 0;
  const ownGoals = liveStats?.own_goals ?? roundHistory?.own_goals ?? 0;
  const bonus = liveStats?.bonus ?? roundHistory?.bonus ?? 0;
  const bps = liveStats?.bps ?? roundHistory?.bps ?? 0;

  // Effective GW Points: prefer liveStats, then roundHistory, then playerMeta.gw_points
  const effectiveGWPoints =
    liveStats?.total_points ?? roundHistory?.total_points ?? playerMeta?.gw_points ?? 0;

  // Advanced & underlying stats in activeGW
  const expectedGoals = Number(liveStats?.expected_goals ?? roundHistory?.expected_goals ?? 0).toFixed(2);
  const expectedAssists = Number(liveStats?.expected_assists ?? roundHistory?.expected_assists ?? 0).toFixed(2);
  const expectedGoalInvolvements = Number(liveStats?.expected_goal_involvements ?? roundHistory?.expected_goal_involvements ?? 0).toFixed(2);
  const expectedGoalsConceded = Number(liveStats?.expected_goals_conceded ?? roundHistory?.expected_goals_conceded ?? 0).toFixed(2);

  const cbi = liveStats?.clearances_blocks_interceptions ?? (roundHistory as any)?.clearances_blocks_interceptions ?? 0;
  const tackles = liveStats?.tackles ?? (roundHistory as any)?.tackles ?? 0;
  const recoveries = liveStats?.recoveries ?? (roundHistory as any)?.recoveries ?? 0;

  const influence = Number(liveStats?.influence ?? roundHistory?.influence ?? 0).toFixed(1);
  const creativity = Number(liveStats?.creativity ?? roundHistory?.creativity ?? 0).toFixed(1);
  const threat = Number(liveStats?.threat ?? roundHistory?.threat ?? 0).toFixed(1);
  const ictIndex = Number(liveStats?.ict_index ?? roundHistory?.ict_index ?? 0).toFixed(1);

  const isGk =
    playerMeta?.position === 'GKP' ||
    playerMeta?.element_type === 1 ||
    summaryData?.player_info?.position === 'GKP';

  // Fallback points explanation generator if live_explain is empty
  const effectiveExplainList = useMemo(() => {
    if (explainList && explainList.length > 0) {
      return explainList;
    }
    const list: PlayerExplainStatItem[] = [];
    if (minutesPlayed > 0) {
      list.push({
        identifier: 'minutes',
        value: minutesPlayed,
        points: minutesPlayed >= 60 ? 2 : 1
      });
    }
    if (goalsScored > 0) {
      const pos = playerMeta?.position || summaryData?.player_info?.position;
      const perGoal = isGk || pos === 'DEF' ? 6 : pos === 'MID' ? 5 : 4;
      list.push({
        identifier: 'goals_scored',
        value: goalsScored,
        points: goalsScored * perGoal
      });
    }
    if (assists > 0) {
      list.push({
        identifier: 'assists',
        value: assists,
        points: assists * 3
      });
    }
    if (cleanSheets > 0) {
      const pos = playerMeta?.position || summaryData?.player_info?.position;
      const csPts = isGk || pos === 'DEF' ? 4 : pos === 'MID' ? 1 : 0;
      if (csPts > 0) {
        list.push({
          identifier: 'clean_sheets',
          value: cleanSheets,
          points: csPts
        });
      }
    }
    if (defCon > 0) {
      list.push({
        identifier: 'defensive_contribution',
        value: defCon,
        points: 2
      });
    }
    if (saves >= 3) {
      list.push({
        identifier: 'saves',
        value: saves,
        points: Math.floor(saves / 3)
      });
    }
    if (penaltiesSaved > 0) {
      list.push({
        identifier: 'penalties_saved',
        value: penaltiesSaved,
        points: penaltiesSaved * 5
      });
    }
    if (bonus > 0) {
      list.push({
        identifier: 'bonus',
        value: bonus,
        points: bonus
      });
    }
    if (goalsConceded >= 2 && (isGk || playerMeta?.position === 'DEF' || summaryData?.player_info?.position === 'DEF')) {
      list.push({
        identifier: 'goals_conceded',
        value: goalsConceded,
        points: -Math.floor(goalsConceded / 2)
      });
    }
    if (yellowCards > 0) {
      list.push({
        identifier: 'yellow_cards',
        value: yellowCards,
        points: -yellowCards
      });
    }
    if (redCards > 0) {
      list.push({
        identifier: 'red_cards',
        value: redCards,
        points: -redCards * 3
      });
    }
    if (ownGoals > 0) {
      list.push({
        identifier: 'own_goals',
        value: ownGoals,
        points: -ownGoals * 2
      });
    }
    if (penaltiesMissed > 0) {
      list.push({
        identifier: 'penalties_missed',
        value: penaltiesMissed,
        points: -penaltiesMissed * 2
      });
    }
    return list;
  }, [explainList, minutesPlayed, goalsScored, assists, cleanSheets, defCon, saves, penaltiesSaved, bonus, goalsConceded, yellowCards, redCards, ownGoals, penaltiesMissed, isGk, playerMeta, summaryData]);

  // Helper for determining comparison font colors across GW, Form, and Season
  // Rules:
  // 1. Bandingkan kolom GW, Form, dan Season sesuai angka yang tampil pada user.
  // 2. Untuk statistik normal:
  //    - Nilai tertinggi fontnya warna hijau emerald jika unik (tidak sama dengan nilai kolom lainnya).
  //    - Nilai terendah fontnya warna merah rose jika unik (tidak sama dengan nilai kolom lainnya).
  // 3. Untuk statistik negatif (isInverted: true):
  //    - Nilai terkecil fontnya warna hijau emerald jika unik.
  //    - Nilai terbesar fontnya warna merah rose jika unik.
  // 4. Nilai tengah dan nilai yang memiliki kembaran bernilai font normal.
  const getStatComparisonStyles = useCallback((gwStr: string, formStr: string, seasonStr: string, isInverted = false) => {
    const parseNum = (val: string) => {
      if (!val) return 0;
      const clean = val.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    };

    const gwVal = parseNum(gwStr);
    const formVal = parseNum(formStr);
    const seasonVal = parseNum(seasonStr);

    const values = [gwVal, formVal, seasonVal];
    const max = Math.max(...values);
    const min = Math.min(...values);

    const normalColor = 'text-slate-700 dark:text-purple-200';
    const emeraldColor = 'text-emerald-600 dark:text-[#00ff87]';
    const roseColor = 'text-rose-600 dark:text-rose-400';

    // Jika seluruh nilai sama
    if (max === min) {
      return {
        gw: normalColor,
        form: normalColor,
        season: normalColor,
      };
    }

    const maxCount = values.filter((v) => v === max).length;
    const minCount = values.filter((v) => v === min).length;

    const getColorForVal = (val: number) => {
      if (isInverted) {
        // Jika statistik negatif: bila terkecil hijau (unik), bila terbesar merah (unik)
        if (val === min && minCount === 1) {
          return emeraldColor;
        }
        if (val === max && maxCount === 1) {
          return roseColor;
        }
        return normalColor;
      }

      // Statistik normal: nilai tertinggi hijau (unik), nilai terendah merah (unik)
      if (val === max && maxCount === 1) {
        return emeraldColor;
      }
      if (val === min && minCount === 1) {
        return roseColor;
      }
      // Nilai tengah atau bila ada yang nilainya sama: warna font normal
      return normalColor;
    };

    return {
      gw: getColorForVal(gwVal),
      form: getColorForVal(formVal),
      season: getColorForVal(seasonVal),
    };
  }, []);

  // Combined Statistics & Insights: All 30 GW History fields transposed top-to-bottom with full names
  const combinedStatsData = useMemo(() => {
    const historyList = summaryData?.history || [];
    const currentRound = historyList.find((h) => h.round === activeGW);
    // 1. Season matches: Dari pertandingan pertama musim ini s.d. pertandingan terakhir di GW yang dipilih (activeGW)
    const historyUpToGW = historyList.filter((h) => h.round <= activeGW);
    const matchesInActiveGW = historyList.filter((h) => h.round === activeGW);

    // 2. Titik acuan waktu (anchor timestamp):
    // Jika melihat Gameweek aktif terkini (activeGW >= maxGW), titik acuan adalah waktu sekarang (Date.now())
    // sesuai standar resmi FPL (rolling 30 calendar days from now).
    // Jika melihat Gameweek lampau (activeGW < maxGW), acuan waktu adalah kick-off pertandingan terakhir di GW tersebut.
    const isCurrentActiveGW = activeGW >= maxGW;
    let targetAnchorTime: number;

    if (isCurrentActiveGW) {
      targetAnchorTime = Date.now();
    } else {
      if (matchesInActiveGW.length > 0) {
        const times = matchesInActiveGW
          .map((m) => (m.kickoff_time ? new Date(m.kickoff_time).getTime() : 0))
          .filter((t) => t > 0);
        targetAnchorTime = times.length > 0 ? Math.max(...times) : Date.now();
      } else {
        const previousPlayed = historyUpToGW.filter((h) => h.kickoff_time);
        if (previousPlayed.length > 0) {
          const times = previousPlayed.map((m) => new Date(m.kickoff_time).getTime());
          targetAnchorTime = Math.max(...times);
        } else {
          targetAnchorTime = Date.now();
        }
      }
    }

    // 3. Form window: 30 hari ke belakang dari pertandingan terakhir di GW yang dipilih
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const formMatchesRaw = historyUpToGW.filter((h) => {
      if (!h.kickoff_time) return false;
      const matchTime = new Date(h.kickoff_time).getTime();
      return matchTime <= targetAnchorTime && matchTime >= (targetAnchorTime - thirtyDaysMs);
    });
    const effectiveFormMatches =
      formMatchesRaw.length > 0
        ? formMatchesRaw
        : matchesInActiveGW.length > 0
        ? matchesInActiveGW
        : historyUpToGW.slice(-1);

    const formCount = effectiveFormMatches.length;
    const seasonCount = historyUpToGW.length || 1;

    const calcAvg = (items: typeof historyList, extractor: (h: any) => number) => {
      if (!items || items.length === 0) return 0;
      const sum = items.reduce((acc, h) => acc + (extractor(h) || 0), 0);
      return sum / items.length;
    };

    // 1. Total Points
    const ptsGW = effectiveGWPoints;
    const ptsForm = calcAvg(effectiveFormMatches, (h) => h.total_points || 0);
    const ptsSeason = calcAvg(historyUpToGW, (h) => h.total_points || 0);

    // 2. Starts
    const stGW = starts;
    const stForm = calcAvg(effectiveFormMatches, (h) => h.starts ?? 0);
    const stSeason = calcAvg(historyUpToGW, (h) => h.starts ?? 0);

    // 3. Minutes Played
    const mpGW = minutesPlayed;
    const mpForm = calcAvg(effectiveFormMatches, (h) => h.minutes || 0);
    const mpSeason = calcAvg(historyUpToGW, (h) => h.minutes || 0);

    // 4. Goals Scored
    const gsGW = goalsScored;
    const gsForm = calcAvg(effectiveFormMatches, (h) => h.goals_scored || 0);
    const gsSeason = calcAvg(historyUpToGW, (h) => h.goals_scored || 0);

    // 5. Assists
    const aGW = assists;
    const aForm = calcAvg(effectiveFormMatches, (h) => h.assists || 0);
    const aSeason = calcAvg(historyUpToGW, (h) => h.assists || 0);

    // 6. Expected Goals (xG)
    const xgGW = parseFloat(expectedGoals) || 0;
    const xgForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.expected_goals || 0)));
    const xgSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.expected_goals || 0)));

    // 7. Expected Assists (xA)
    const xaGW = parseFloat(expectedAssists) || 0;
    const xaForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.expected_assists || 0)));
    const xaSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.expected_assists || 0)));

    // 8. Expected Goal Involvement (xGI)
    const xgiGW = parseFloat(expectedGoalInvolvements) || 0;
    const xgiForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.expected_goal_involvements || 0)));
    const xgiSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.expected_goal_involvements || 0)));

    // 9. Clean Sheets
    const csGW = cleanSheets;
    const csForm = calcAvg(effectiveFormMatches, (h) => h.clean_sheets || 0);
    const csSeason = calcAvg(historyUpToGW, (h) => h.clean_sheets || 0);

    // 10. Goals Conceded (isInverted: true)
    const gcGW = goalsConceded;
    const gcForm = calcAvg(effectiveFormMatches, (h) => h.goals_conceded || 0);
    const gcSeason = calcAvg(historyUpToGW, (h) => h.goals_conceded || 0);

    // 11. Expected Goals Conceded (xGC) (isInverted: true)
    const xgcGW = parseFloat(expectedGoalsConceded) || 0;
    const xgcForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.expected_goals_conceded || 0)));
    const xgcSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.expected_goals_conceded || 0)));

    // 12. Tackles
    const tGW = tackles;
    const tForm = calcAvg(effectiveFormMatches, (h) => (h as any).tackles || 0);
    const tSeason = calcAvg(historyUpToGW, (h) => (h as any).tackles || 0);

    // 13. Clearances, Blocks & Interceptions (CBI)
    const cbiGW = cbi;
    const cbiForm = calcAvg(effectiveFormMatches, (h) => (h as any).clearances_blocks_interceptions || 0);
    const cbiSeason = calcAvg(historyUpToGW, (h) => (h as any).clearances_blocks_interceptions || 0);

    // 14. Recoveries
    const rGW = recoveries;
    const rForm = calcAvg(effectiveFormMatches, (h) => (h as any).recoveries || 0);
    const rSeason = calcAvg(historyUpToGW, (h) => (h as any).recoveries || 0);

    // 15. Defensive Contribution (DefCon)
    const dcGW = defCon;
    const dcForm = calcAvg(effectiveFormMatches, (h) => (h as any).defensive_contribution || 0);
    const dcSeason = calcAvg(historyUpToGW, (h) => (h as any).defensive_contribution || 0);

    // 16. Own Goals (isInverted: true)
    const ogGW = ownGoals;
    const ogForm = calcAvg(effectiveFormMatches, (h) => h.own_goals || 0);
    const ogSeason = calcAvg(historyUpToGW, (h) => h.own_goals || 0);

    // 17. Penalties Saved
    const psGW = penaltiesSaved;
    const psForm = calcAvg(effectiveFormMatches, (h) => h.penalties_saved || 0);
    const psSeason = calcAvg(historyUpToGW, (h) => h.penalties_saved || 0);

    // 18. Penalties Missed (isInverted: true)
    const pmGW = penaltiesMissed;
    const pmForm = calcAvg(effectiveFormMatches, (h) => h.penalties_missed || 0);
    const pmSeason = calcAvg(historyUpToGW, (h) => h.penalties_missed || 0);

    // 19. Yellow Cards (isInverted: true)
    const ycGW = yellowCards;
    const ycForm = calcAvg(effectiveFormMatches, (h) => h.yellow_cards || 0);
    const ycSeason = calcAvg(historyUpToGW, (h) => h.yellow_cards || 0);

    // 20. Red Cards (isInverted: true)
    const rcGW = redCards;
    const rcForm = calcAvg(effectiveFormMatches, (h) => h.red_cards || 0);
    const rcSeason = calcAvg(historyUpToGW, (h) => h.red_cards || 0);

    // 21. Saves
    const sGW = saves;
    const sForm = calcAvg(effectiveFormMatches, (h) => h.saves || 0);
    const sSeason = calcAvg(historyUpToGW, (h) => h.saves || 0);

    // 22. Bonus Points
    const bpGW = bonus;
    const bpForm = calcAvg(effectiveFormMatches, (h) => h.bonus || 0);
    const bpSeason = calcAvg(historyUpToGW, (h) => h.bonus || 0);

    // 23. Bonus Points System (BPS)
    const bpsGW = bps;
    const bpsForm = calcAvg(effectiveFormMatches, (h) => h.bps || 0);
    const bpsSeason = calcAvg(historyUpToGW, (h) => h.bps || 0);

    // 24. Influence
    const infGW = parseFloat(influence) || 0;
    const infForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.influence || 0)));
    const infSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.influence || 0)));

    // 25. Creativity
    const creGW = parseFloat(creativity) || 0;
    const creForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.creativity || 0)));
    const creSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.creativity || 0)));

    // 26. Threat
    const thrGW = parseFloat(threat) || 0;
    const thrForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.threat || 0)));
    const thrSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.threat || 0)));

    // 27. ICT Index
    const iiGW = parseFloat(ictIndex) || 0;
    const iiForm = calcAvg(effectiveFormMatches, (h) => parseFloat(String(h.ict_index || 0)));
    const iiSeason = calcAvg(historyUpToGW, (h) => parseFloat(String(h.ict_index || 0)));

    // 28. Net Transfers (FNB League)
    const fnbGWMetrics = getFnbMetrics(activeGW);
    const ntGW = fnbGWMetrics.netTransfers;
    const ntForm = calcAvg(effectiveFormMatches, (h) => getFnbMetrics(h.round).netTransfers);
    const ntSeason = calcAvg(historyUpToGW, (h) => getFnbMetrics(h.round).netTransfers);

    // 29. Teams Selected By (FNB League Ownership %)
    const tsbGW = parseFloat(fnbGWMetrics.tsb) || 0;
    const tsbForm = calcAvg(effectiveFormMatches, (h) => parseFloat(getFnbMetrics(h.round).tsb) || 0);
    const tsbSeason = calcAvg(historyUpToGW, (h) => parseFloat(getFnbMetrics(h.round).tsb) || 0);

    // 30. Price (£m)
    const priceGW = currentRound?.value ? currentRound.value / 10 : (playerMeta?.now_cost ? playerMeta.now_cost / 10 : 0);
    const priceForm = calcAvg(effectiveFormMatches, (h) => (h.value ? h.value / 10 : 0));
    const priceSeason = calcAvg(historyUpToGW, (h) => (h.value ? h.value / 10 : 0));

    const rows = [
      { key: 'pts', label: 'Total Points', gw: `${ptsGW}`, form: ptsForm.toFixed(1), season: ptsSeason.toFixed(1), gwNum: ptsGW, formNum: ptsForm, seasonNum: ptsSeason },
      { key: 'st', label: 'Starts', gw: `${stGW}`, form: stForm.toFixed(1), season: stSeason.toFixed(1), gwNum: stGW, formNum: stForm, seasonNum: stSeason },
      { key: 'mp', label: 'Minutes Played', gw: `${mpGW}'`, form: `${mpForm.toFixed(0)}'`, season: `${mpSeason.toFixed(0)}'`, gwNum: mpGW, formNum: mpForm, seasonNum: mpSeason },
      { key: 'gs', label: 'Goals Scored', gw: `${gsGW}`, form: gsForm.toFixed(1), season: gsSeason.toFixed(1), gwNum: gsGW, formNum: gsForm, seasonNum: gsSeason },
      { key: 'a', label: 'Assists', gw: `${aGW}`, form: aForm.toFixed(1), season: aSeason.toFixed(1), gwNum: aGW, formNum: aForm, seasonNum: aSeason },
      { key: 'xg', label: 'Expected Goals (xG)', gw: xgGW.toFixed(2), form: xgForm.toFixed(2), season: xgSeason.toFixed(2), gwNum: xgGW, formNum: xgForm, seasonNum: xgSeason },
      { key: 'xa', label: 'Expected Assists (xA)', gw: xaGW.toFixed(2), form: xaForm.toFixed(2), season: xaSeason.toFixed(2), gwNum: xaGW, formNum: xaForm, seasonNum: xaSeason },
      { key: 'xgi', label: 'Expected Goal Involvement (xGI)', gw: xgiGW.toFixed(2), form: xgiForm.toFixed(2), season: xgiSeason.toFixed(2), gwNum: xgiGW, formNum: xgiForm, seasonNum: xgiSeason },
      { key: 'cs', label: 'Clean Sheets', gw: `${csGW}`, form: csForm.toFixed(1), season: csSeason.toFixed(1), gwNum: csGW, formNum: csForm, seasonNum: csSeason },
      { key: 'gc', label: 'Goals Conceded', gw: `${gcGW}`, form: gcForm.toFixed(1), season: gcSeason.toFixed(1), gwNum: gcGW, formNum: gcForm, seasonNum: gcSeason, isInverted: true },
      { key: 'xgc', label: 'Expected Goals Conceded (xGC)', gw: xgcGW.toFixed(2), form: xgcForm.toFixed(2), season: xgcSeason.toFixed(2), gwNum: xgcGW, formNum: xgcForm, seasonNum: xgcSeason, isInverted: true },
      { key: 't', label: 'Tackles', gw: `${tGW}`, form: tForm.toFixed(1), season: tSeason.toFixed(1), gwNum: tGW, formNum: tForm, seasonNum: tSeason },
      { key: 'cbi', label: 'Clearances, Blocks & Interceptions (CBI)', gw: `${cbiGW}`, form: cbiForm.toFixed(1), season: cbiSeason.toFixed(1), gwNum: cbiGW, formNum: cbiForm, seasonNum: cbiSeason },
      { key: 'r', label: 'Recoveries', gw: `${rGW}`, form: rForm.toFixed(1), season: rSeason.toFixed(1), gwNum: rGW, formNum: rForm, seasonNum: rSeason },
      { key: 'dc', label: 'Defensive Contribution (DefCon)', gw: `${dcGW}`, form: dcForm.toFixed(1), season: dcSeason.toFixed(1), gwNum: dcGW, formNum: dcForm, seasonNum: dcSeason },
      { key: 'og', label: 'Own Goals', gw: `${ogGW}`, form: ogForm.toFixed(1), season: ogSeason.toFixed(1), gwNum: ogGW, formNum: ogForm, seasonNum: ogSeason, isInverted: true },
      { key: 'ps', label: 'Penalties Saved', gw: `${psGW}`, form: psForm.toFixed(1), season: psSeason.toFixed(1), gwNum: psGW, formNum: psForm, seasonNum: psSeason },
      { key: 'pm', label: 'Penalties Missed', gw: `${pmGW}`, form: pmForm.toFixed(1), season: pmSeason.toFixed(1), gwNum: pmGW, formNum: pmForm, seasonNum: pmSeason, isInverted: true },
      { key: 'yc', label: 'Yellow Cards', gw: `${ycGW}`, form: ycForm.toFixed(1), season: ycSeason.toFixed(1), gwNum: ycGW, formNum: ycForm, seasonNum: ycSeason, isInverted: true },
      { key: 'rc', label: 'Red Cards', gw: `${rcGW}`, form: rcForm.toFixed(1), season: rcSeason.toFixed(1), gwNum: rcGW, formNum: rcForm, seasonNum: rcSeason, isInverted: true },
      { key: 's', label: 'Saves', gw: `${sGW}`, form: sForm.toFixed(1), season: sSeason.toFixed(1), gwNum: sGW, formNum: sForm, seasonNum: sSeason },
      { key: 'bp', label: 'Bonus Points', gw: `${bpGW}`, form: bpForm.toFixed(1), season: bpSeason.toFixed(1), gwNum: bpGW, formNum: bpForm, seasonNum: bpSeason },
      { key: 'bps', label: 'Bonus Points System (BPS)', gw: `${bpsGW}`, form: bpsForm.toFixed(1), season: bpsSeason.toFixed(1), gwNum: bpsGW, formNum: bpsForm, seasonNum: bpsSeason },
      { key: 'inf', label: 'Influence', gw: infGW.toFixed(1), form: infForm.toFixed(1), season: infSeason.toFixed(1), gwNum: infGW, formNum: infForm, seasonNum: infSeason },
      { key: 'cre', label: 'Creativity', gw: creGW.toFixed(1), form: creForm.toFixed(1), season: creSeason.toFixed(1), gwNum: creGW, formNum: creForm, seasonNum: creSeason },
      { key: 'thr', label: 'Threat', gw: thrGW.toFixed(1), form: thrForm.toFixed(1), season: thrSeason.toFixed(1), gwNum: thrGW, formNum: thrForm, seasonNum: thrSeason },
      { key: 'ii', label: 'ICT Index', gw: iiGW.toFixed(1), form: iiForm.toFixed(1), season: iiSeason.toFixed(1), gwNum: iiGW, formNum: iiForm, seasonNum: iiSeason },
      { key: 'nt', label: 'Net Transfers (FNB League)', gw: ntGW > 0 ? `+${ntGW}` : `${ntGW}`, form: ntForm > 0 ? `+${ntForm.toFixed(1)}` : ntForm.toFixed(1), season: ntSeason > 0 ? `+${ntSeason.toFixed(1)}` : ntSeason.toFixed(1), gwNum: ntGW, formNum: ntForm, seasonNum: ntSeason },
      { key: 'tsb', label: 'Teams Selected By (FNB League)', gw: `${tsbGW.toFixed(1)}%`, form: `${tsbForm.toFixed(1)}%`, season: `${tsbSeason.toFixed(1)}%`, gwNum: tsbGW, formNum: tsbForm, seasonNum: tsbSeason },
      { key: 'cost', label: 'Player Price', gw: `£${priceGW.toFixed(1)}m`, form: `£${priceForm.toFixed(1)}m`, season: `£${priceSeason.toFixed(1)}m`, gwNum: priceGW, formNum: priceForm, seasonNum: priceSeason },
    ];

    return {
      rows,
      formCount,
      seasonCount,
    };
  }, [
    summaryData?.history,
    activeGW,
    effectiveGWPoints,
    minutesPlayed,
    goalsScored,
    assists,
    expectedGoals,
    expectedAssists,
    expectedGoalInvolvements,
    cleanSheets,
    goalsConceded,
    expectedGoalsConceded,
    tackles,
    cbi,
    recoveries,
    defCon,
    ownGoals,
    penaltiesSaved,
    penaltiesMissed,
    yellowCards,
    redCards,
    saves,
    bonus,
    bps,
    influence,
    creativity,
    threat,
    ictIndex,
    getFnbMetrics,
    playerMeta?.now_cost,
    maxGW,
  ]);

  const playerStatsObj = useMemo(() => {
    if (!playerId || !playerStats) return null;
    return playerStats.find((p) => p.id === playerId) || null;
  }, [playerId, playerStats]);

  const teamCode =
    playerMeta?.team_code ||
    (summaryData?.player_info as any)?.teamCode ||
    (playerStatsObj as any)?.teamCode;

  // Official Premier League Club Badge URL
  const clubBadgeUrl = teamCode
    ? `https://resources.premierleague.com/premierleague/badges/t${teamCode}.svg`
    : '/default_team_badge.png';

  // Official Premier League 2025/2026 Season 500x500 Ultra HD Cutout Photo
  const rawPhoto =
    summaryData?.player_info?.photo ||
    playerStatsObj?.photo ||
    (playerMeta as any)?.photo ||
    '';

  // Extract pure numeric player code (e.g. 177815 from '177815.jpg' or 'p177815.png')
  const playerCode = useMemo(() => {
    if (playerMeta?.code) return playerMeta.code;
    if ((summaryData?.player_info as any)?.code) return (summaryData?.player_info as any).code;
    if ((playerStatsObj as any)?.code) return (playerStatsObj as any).code;
    if (rawPhoto) {
      const match = rawPhoto.match(/(\d+)\.(?:png|jpg|webp)/);
      if (match) return Number(match[1]);
    }
    return null;
  }, [playerMeta, summaryData, playerStatsObj, rawPhoto]);

  // Modern Premier League 2025/2026 Cutout Photo proxied locally to prevent CORS/ISP blocks
  const playerPhotoUrl = useMemo(() => {
    if (playerCode) {
      return `/api/fpl-player-photo/${playerCode}`;
    }
    if (rawPhoto) {
      const match = rawPhoto.match(/(\d+)/);
      if (match) {
        return `/api/fpl-player-photo/${match[1]}`;
      }
      if (rawPhoto.startsWith('http')) return rawPhoto;
    }
    return '';
  }, [playerCode, rawPhoto]);

  const displayImageSrc = (!photoError && playerPhotoUrl) ? playerPhotoUrl : clubBadgeUrl;
  const isShowingPhoto = !photoError && Boolean(playerPhotoUrl);

  const playerPosition = playerMeta?.position || summaryData?.player_info?.position || 'PL';
  const positionBg =
    playerPosition === 'GKP'
      ? 'bg-amber-400 text-amber-950'
      : playerPosition === 'DEF'
      ? 'bg-emerald-500 text-white'
      : playerPosition === 'MID'
      ? 'bg-sky-500 text-white'
      : 'bg-purple-600 text-white';

  const playerName =
    playerMeta?.full_name ||
    playerMeta?.web_name ||
    summaryData?.player_info?.fullName ||
    summaryData?.player_info?.webName ||
    'Player';
  const teamShortName = playerMeta?.team_short_name || summaryData?.player_info?.teamShort || '';
  const playerCostFormatted = playerMeta
    ? (playerMeta.now_cost / 10).toFixed(1)
    : summaryData?.player_info?.nowCost
    ? (summaryData.player_info.nowCost / 10).toFixed(1)
    : '-';
  const ownershipPct = currentGWPlayer ? currentGWPlayer.owned_percentage : 0;
  const totalSeasonPoints = summaryData?.player_info?.totalPoints ?? playerMeta?.total_points ?? '-';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      {/* Container aligned with Modal Tim: identical max width and fixed height */}
      <div className="bg-white dark:bg-[#150a24] rounded-2xl max-w-2xl sm:max-w-3xl w-full border border-slate-200 dark:border-purple-900/60 shadow-2xl overflow-hidden flex flex-col h-[calc(100dvh-1.5rem)] sm:h-[88vh] max-h-[850px] animate-in fade-in duration-200">
        
        {/* ================= CLEAN HEADER (ALIGNED WITH TEAM MODAL) ================= */}
        {/* ================= CLEAN HEADER (ALIGNED WITH TEAM MODAL) ================= */}
        <div className="bg-gradient-to-r from-[#37003c] via-[#28002d] to-[#1c0022] text-white pt-2 sm:pt-2.5 pb-0 px-3 sm:px-4 shrink-0 relative z-30 overflow-hidden">
          {/* Foto Pemain: Full dari atas header sampai batas bawah tab */}
          <div className="absolute top-0 bottom-0 left-3 sm:left-4 z-10 pointer-events-none flex items-end justify-center">
            <img
              key={`${playerId}-${displayImageSrc}`}
              src={displayImageSrc}
              alt={isShowingPhoto ? playerName : (teamShortName || 'Club Badge')}
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              className={`select-none transition-transform duration-200 ${
                isShowingPhoto
                  ? 'h-full w-auto max-w-[80px] sm:max-w-[92px] object-contain object-bottom filter drop-shadow-md'
                  : 'h-11 sm:h-13 w-auto object-contain filter drop-shadow mb-2'
              }`}
              onError={(e) => {
                const target = e.currentTarget;
                const currentSrc = target.src;
                if (target.src.includes('/api/fpl-player-photo/') && playerCode) {
                  // Fallback 1: Direct Premier League CDN
                  target.src = `https://resources.premierleague.com/premierleague25/photos/players/500x500/${playerCode}.png`;
                } else if (playerCode && currentSrc.includes('500x500')) {
                  // Fallback 2: Versi 110x140
                  target.src = `https://resources.premierleague.com/premierleague25/photos/players/110x140/${playerCode}.png`;
                } else if (playerCode && currentSrc.includes('110x140') && !currentSrc.includes('/p')) {
                  // Fallback 3: Format legacy 250x250
                  target.src = `https://resources.premierleague.com/premierleague/photos/players/250x250/p${playerCode}.png`;
                } else if (playerCode && !currentSrc.includes('/110x140/p')) {
                  // Fallback 4: Format legacy 110x140
                  target.src = `https://resources.premierleague.com/premierleague/photos/players/110x140/p${playerCode}.png`;
                } else if (!photoError && playerPhotoUrl) {
                  // Fallback 5: Switch to official club badge
                  target.onerror = null;
                  setPhotoError(true);
                } else {
                  target.onerror = null;
                  target.src = '/default_team_badge.png';
                }
              }}
            />
          </div>

          {/* Baris Konten Header: Tepat di tengah secara vertikal antara batas atas modal/header dan batas atas tab nav */}
          <div className="h-14 sm:h-16 flex items-center justify-between gap-3 relative z-20">
            
            {/* Left: Spacer untuk foto pemain + Info Nama, Posisi, Klub, Harga */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {/* Spacer transparan yang lebarnya sama dengan foto agar info teks tidak menimpa foto */}
              <div className="shrink-0 w-[64px] sm:w-[76px]" aria-hidden="true" />

              <div className="min-w-0 flex flex-col justify-center">
                {/* 1. Nama Pemain di atas */}
                <h3 className="font-black text-base sm:text-lg text-white leading-tight truncate">
                  {playerName}
                </h3>

                {/* 2. Posisi, Club, Harga, Kepemilikan di bawah nama pemain */}
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5 sm:mt-1">
                  <span
                    className={`text-[9.5px] sm:text-[10px] font-black px-1.5 py-0.5 rounded leading-none ${positionBg}`}
                  >
                    {playerPosition}
                  </span>
                  {teamShortName && (
                    <span className="bg-white/20 text-[#00ff87] text-[9.5px] sm:text-[10px] font-black px-1.5 py-0.5 rounded leading-none">
                      {teamShortName}
                    </span>
                  )}
                  <span className="text-[10.5px] sm:text-xs text-purple-200 font-bold">
                    £{playerCostFormatted}m
                  </span>
                  <span className="text-[10px] text-purple-300/80 font-medium hidden xs:inline">
                    • {ownershipPct}% {language === 'id' ? 'dimiliki' : 'owned'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Controls (vertically centered) */}
            <div className="flex items-center gap-2 shrink-0 relative z-30">
              <a
                href="https://fantasy.premierleague.com/statistics"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-purple-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors hidden sm:flex items-center gap-1 text-[11px] font-semibold"
                title={language === 'id' ? 'Buka Statistik Resmi FPL' : 'Open Official FPL Statistics'}
              >
                <span>FPL</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                onClick={handleClose}
                className="p-1 text-purple-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title={t('tooltip_close_player_modal')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Subtab Navigation (styled like main application subtab, seamlessly attached without border) */}
          <div className="flex items-center px-1 mt-1 sm:mt-1.5 relative z-20">
            <nav className="flex items-center gap-2 sm:gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`relative py-1.5 px-3 sm:px-4 flex items-center justify-center transition-colors cursor-pointer select-none text-xs sm:text-[13px] leading-none ${
                  activeTab === 'overview'
                    ? 'text-white font-bold'
                    : 'text-purple-300/80 hover:text-white font-medium'
                }`}
              >
                <span>{t('modal_plyr_tab_overview')}</span>
                {activeTab === 'overview' && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('owners')}
                className={`relative py-1.5 px-3 sm:px-4 flex items-center justify-center transition-colors cursor-pointer select-none text-xs sm:text-[13px] leading-none ${
                  activeTab === 'owners'
                    ? 'text-white font-bold'
                    : 'text-purple-300/80 hover:text-white font-medium'
                }`}
              >
                <span>{t('modal_plyr_tab_owners', { N: owners.length })}</span>
                {activeTab === 'owners' && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`relative py-1.5 px-3 sm:px-4 flex items-center justify-center transition-colors cursor-pointer select-none text-xs sm:text-[13px] leading-none ${
                  activeTab === 'history'
                    ? 'text-white font-bold'
                    : 'text-purple-300/80 hover:text-white font-medium'
                }`}
              >
                <span>{t('modal_plyr_tab_history')}</span>
                {activeTab === 'history' && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* ================= MODAL BODY ================= */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 sm:p-3 text-slate-800 dark:text-slate-100">
          
          {/* TAB 1: GW OVERVIEW (CLEAN ENGLISH & TABLE-DRIVEN) */}
          {activeTab === 'overview' && (
            <div className="space-y-3">
              
              {/* 1. MATCH REPORT */}
              <div className={`bg-gradient-to-r from-slate-900 via-[#1b092a] to-slate-900 text-white rounded-xl p-3 sm:p-3.5 border border-purple-500/30 shadow-md relative ${isGWDropdownOpen ? 'z-30' : 'z-10'}`}>
                {(() => {
                  // State A: Loading summary without cached round history -> Smooth Skeleton Loader (No layout jump)
                  if (loadingSummary && !roundHistory) {
                    return (
                      <>
                        <div className="w-full flex items-center justify-between gap-1.5 sm:gap-2.5 relative select-none">
                          {/* Tombol < */}
                          <button
                            type="button"
                            disabled
                            className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center opacity-20 pointer-events-none"
                            aria-label="Previous Gameweek"
                          >
                            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                          </button>

                          <div className="flex-1 flex items-center justify-center gap-1.5 sm:gap-3 min-w-0 animate-pulse">
                            <div className="flex-1 text-right min-w-0 flex items-center justify-end gap-1.5 sm:gap-2">
                              <span className="font-black text-sm sm:text-base text-purple-200 tracking-tight truncate block">
                                {teamShortName || '...'}
                              </span>
                              <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center rounded-full bg-white/10">
                                {clubBadgeUrl ? (
                                  <img src={clubBadgeUrl} alt="Club" className="w-full h-full object-contain filter drop-shadow opacity-70" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-white/20" />
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-center justify-center shrink-0 px-1 sm:px-2 gap-1.5">
                              <span className="font-medium text-[11px] sm:text-xs text-slate-300 tracking-wider select-none leading-tight">
                                GW {activeGW}
                              </span>
                              <div className="h-4 w-9 bg-white/20 rounded-md"></div>
                              <div className="h-3 w-10 bg-white/20 rounded"></div>
                            </div>

                            <div className="flex-1 text-left min-w-0 flex items-center justify-start gap-1.5 sm:gap-2">
                              <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center rounded-full bg-white/10">
                                <div className="w-5 h-5 rounded-full bg-white/20" />
                              </div>
                              <div className="h-4 w-12 bg-white/20 rounded"></div>
                            </div>
                          </div>

                          {/* Tombol > */}
                          <button
                            type="button"
                            disabled
                            className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center opacity-20 pointer-events-none"
                            aria-label="Next Gameweek"
                          >
                            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                          </button>
                        </div>

                        {/* Integrated Points & Breakdown Skeleton */}
                        <div className="mt-2.5 pt-2.5 border-t border-purple-500/25 flex flex-row items-stretch gap-2.5">
                          <div className="bg-[#12001a] border border-purple-500/50 rounded-lg px-1 py-1 h-[68px] max-h-[68px] w-[59px] min-w-[59px] max-w-[59px] shrink-0 self-start text-center shadow-inner flex flex-col items-center justify-center">
                            <span className="text-[36px] font-black text-[#00ff87] leading-none tracking-tight">
                              {effectiveGWPoints}
                            </span>
                            <span className="font-medium text-[11px] sm:text-xs text-slate-300 tracking-wider select-none leading-tight mt-0.5">
                              {t('modal_plyr_match_points')}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="bg-black/30 rounded-lg border border-purple-500/20 p-2.5 h-[68px] flex flex-col justify-around animate-pulse">
                              <div className="flex items-center justify-between">
                                <div className="h-3 w-28 bg-white/15 rounded"></div>
                                <div className="h-3 w-12 bg-white/15 rounded"></div>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="h-3 w-20 bg-white/15 rounded"></div>
                                <div className="h-3 w-10 bg-white/15 rounded"></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  }

                  // State B: Not loading, but roundHistory is absent (Blank Gameweek)
                  if (!roundHistory) {
                    return (
                      <>
                        <div className="w-full flex items-center justify-between gap-1.5 sm:gap-2.5 relative select-none">
                          {/* Tombol < */}
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

                          <div className="relative shrink-0 flex flex-col items-center justify-center z-20">
                            <button
                              type="button"
                              onClick={() => setIsGWDropdownOpen((prev) => !prev)}
                              className="flex flex-col items-center justify-center cursor-pointer group focus:outline-none select-none py-0.5 px-1.5 sm:px-2 rounded-lg hover:bg-white/5 transition-colors text-center gap-1.5"
                              title={language === 'id' ? 'Pilih Gameweek' : 'Select Gameweek'}
                            >
                              <span className="font-medium text-[11px] sm:text-xs text-slate-300 group-hover:text-white transition-colors tracking-wider select-none leading-tight">
                                GW {activeGW}
                              </span>
                              <span className="font-black text-base sm:text-lg text-white tracking-tight leading-none">
                                Blank GW
                              </span>
                              <span className="font-medium text-[11px] sm:text-xs text-slate-300 group-hover:text-white transition-colors tracking-wider select-none leading-tight">
                                {language === 'id' ? 'Tidak Ada Pertandingan' : 'No Fixture'}
                              </span>
                            </button>
                            {renderGWDropdown()}
                          </div>

                          {/* Tombol > */}
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

                        <div className="mt-2.5 pt-2.5 border-t border-purple-500/25 flex flex-row items-stretch gap-2.5">
                          <div className="bg-[#12001a] border border-purple-500/50 rounded-lg px-1 py-1 h-[68px] max-h-[68px] w-[59px] min-w-[59px] max-w-[59px] shrink-0 self-start text-center shadow-inner flex flex-col items-center justify-center">
                            <span className="text-[36px] font-black text-[#00ff87] leading-none tracking-tight">
                              {effectiveGWPoints}
                            </span>
                            <span className="font-medium text-[11px] sm:text-xs text-slate-300 tracking-wider select-none leading-tight mt-0.5">
                              {t('modal_plyr_match_points')}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="bg-black/20 rounded-lg p-2.5 h-[68px] flex items-center justify-center text-center text-xs text-purple-300/70 italic border border-purple-500/20">
                              Blank Gameweek ({effectiveGWPoints} {language === 'id' ? 'poin' : 'pts'})
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  }

                  // State C: Full Match Report with roundHistory
                  const playerTeamId =
                    roundHistory.player_team ||
                    (playerMeta as any)?.team ||
                    summaryData?.player_info?.teamId ||
                    (playerStatsObj as any)?.teamId ||
                    (playerStatsObj as any)?.team ||
                    (playerMeta?.team_code ? Object.values(FPL_TEAMS_BY_ID).find((t) => t.code === playerMeta.team_code)?.id : undefined) ||
                    (playerMeta?.team_short_name ? Object.values(FPL_TEAMS_BY_ID).find((t) => t.short_name.toLowerCase() === playerMeta.team_short_name.toLowerCase())?.id : undefined);

                  const oppTeamId = roundHistory.opponent_team;
                  const isHome = roundHistory.was_home ?? true;

                  const homeTeamId = roundHistory.home_team_id || (isHome ? playerTeamId : oppTeamId);
                  const awayTeamId = roundHistory.away_team_id || (isHome ? oppTeamId : playerTeamId);

                  const homeTeamInfo = homeTeamId ? FPL_TEAMS_BY_ID[homeTeamId] : null;
                  const awayTeamInfo = awayTeamId ? FPL_TEAMS_BY_ID[awayTeamId] : null;

                  const homeName = roundHistory.home_short_name || homeTeamInfo?.short_name || (isHome ? (roundHistory.player_team_short_name || teamShortName) : roundHistory.opponent_short_name) || 'H';
                  const awayName = roundHistory.away_short_name || awayTeamInfo?.short_name || (!isHome ? (roundHistory.player_team_short_name || teamShortName) : roundHistory.opponent_short_name) || 'A';

                  const homeBadgeUrl = homeTeamInfo?.code
                    ? `https://resources.premierleague.com/premierleague/badges/t${homeTeamInfo.code}.svg`
                    : isHome
                    ? clubBadgeUrl
                    : '/default_team_badge.png';

                  const awayBadgeUrl = awayTeamInfo?.code
                    ? `https://resources.premierleague.com/premierleague/badges/t${awayTeamInfo.code}.svg`
                    : !isHome
                    ? clubBadgeUrl
                    : '/default_team_badge.png';

                  const hasScore =
                    roundHistory.team_h_score !== undefined &&
                    roundHistory.team_h_score !== null &&
                    roundHistory.team_a_score !== undefined &&
                    roundHistory.team_a_score !== null;

                  const homeScore = hasScore ? roundHistory.team_h_score : 0;
                  const awayScore = hasScore ? roundHistory.team_a_score : 0;

                  // Outcome for player's team: W (Win: Emerald), D (Draw: Slate), L (Loss: Rose)
                  const myScore = isHome ? homeScore : awayScore;
                  const oppScore = isHome ? awayScore : homeScore;

                  let scoreTextColor = 'text-white';
                  if (hasScore) {
                    if (myScore > oppScore) {
                      scoreTextColor = 'text-[#00ff87] drop-shadow-[0_0_8px_rgba(0,255,135,0.4)]';
                    } else if (myScore < oppScore) {
                      scoreTextColor = 'text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]';
                    } else {
                      scoreTextColor = 'text-slate-300';
                    }
                  }

                  const isPastGW = activeGW < effectiveCurrentGW;
                  const isFutureGW = activeGW > effectiveCurrentGW;

                  const fixObj = (roundHistory as any)?.fixture_started !== undefined
                    ? {
                        started: Boolean((roundHistory as any).fixture_started),
                        finished: Boolean((roundHistory as any).fixture_finished),
                        finished_provisional: Boolean((roundHistory as any).fixture_finished_provisional),
                        minutes: Number((roundHistory as any).fixture_minutes || 0),
                        phase: (roundHistory as any).fixture_phase,
                        clock_label: (roundHistory as any).fixture_clock_label,
                        is_half_time: (roundHistory as any).fixture_is_half_time
                      }
                    : (summaryData?.gw_fixtures || gwFixtures || []).find((f: any) => f.id === roundHistory?.fixture);

                  const rawMatchMinutes = fixObj?.minutes !== undefined
                    ? Number(fixObj.minutes)
                    : ((roundHistory as any)?.fixture_minutes !== undefined ? Number((roundHistory as any).fixture_minutes) : 0);
                  const matchMinutes = rawMatchMinutes > 0 ? rawMatchMinutes : (minutesPlayed > 0 ? minutesPlayed : 0);

                  const isFtMatch = Boolean(
                    fixObj?.finished ||
                    fixObj?.finished_provisional ||
                    fixObj?.phase === 'FT' ||
                    fixObj?.phase === 'F' ||
                    fixObj?.clock_label === 'Full Time' ||
                    (roundHistory as any)?.fixture_finished ||
                    (roundHistory as any)?.fixture_finished_provisional ||
                    (roundHistory as any)?.fixture_phase === 'FT' ||
                    (roundHistory as any)?.fixture_phase === 'F' ||
                    (roundHistory as any)?.fixture_clock_label === 'Full Time'
                  );

                  const isHalfTime = Boolean(
                    !isFtMatch && (
                      fixObj?.is_half_time ||
                      fixObj?.phase === 'HT' ||
                      fixObj?.clock_label === 'Half Time' ||
                      (roundHistory as any)?.fixture_is_half_time ||
                      (roundHistory as any)?.fixture_phase === 'HT' ||
                      (roundHistory as any)?.fixture_clock_label === 'Half Time'
                    )
                  );

                  let clockLabel = fixObj?.clock_label || (roundHistory as any)?.fixture_clock_label || '';
                  if (clockLabel === "00'") {
                    clockLabel = "0'";
                  } else if (clockLabel) {
                    clockLabel = clockLabel.replace(/^0([0-9]')/, '$1');
                  }
                  if (!clockLabel && matchMinutes > 0) {
                    clockLabel = matchMinutes >= 90 ? "90+'" : `${matchMinutes}'`;
                  } else if (!clockLabel && fixObj?.started) {
                    clockLabel = "0'";
                  }

                  let isLive = false;
                  let isFt = false;

                  if (isPastGW) {
                    isFt = true;
                  } else if (isFutureGW) {
                    isLive = false;
                    isFt = false;
                  } else {
                    // activeGW === effectiveCurrentGW
                    if (fixObj) {
                      if (isFtMatch) {
                        isFt = true;
                        isLive = false;
                      } else if (fixObj.started) {
                        isLive = true;
                        isFt = false;
                      } else {
                        isLive = false;
                        isFt = false;
                      }
                    } else {
                      // Fallback when fixture object is not found: check kickoff time or active live stats
                      const kickoff = roundHistory?.kickoff_time ? new Date(roundHistory.kickoff_time).getTime() : 0;
                      const now = Date.now();
                      if (kickoff > 0) {
                        if (now < kickoff) {
                          isLive = false;
                          isFt = false;
                        } else if (now < kickoff + 135 * 60 * 1000) {
                          isLive = true;
                          isFt = false;
                        } else {
                          isFt = true;
                          isLive = false;
                        }
                      } else if (minutesPlayed > 0) {
                        isLive = true;
                        isFt = false;
                      }
                    }
                  }

                  return (
                    <>
                      <div className="w-full flex items-center justify-between gap-1.5 sm:gap-2.5 relative select-none">
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

                        {/* Match Information Row: Home Team | Center Clickable Filter | Away Team */}
                        <div className="flex-1 flex items-center justify-center gap-1.5 sm:gap-3 min-w-0">
                          {/* Home Team */}
                          <div className="flex-1 flex items-center justify-end gap-1.5 sm:gap-2 min-w-0">
                            <span className="font-black text-sm sm:text-base text-white tracking-tight truncate block text-right">
                              {homeName}
                            </span>
                            <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center">
                              <img
                                src={homeBadgeUrl}
                                alt={homeName}
                                className="w-full h-full object-contain filter drop-shadow select-none"
                                onError={(e) => {
                                  if (homeTeamInfo?.code && !e.currentTarget.src.includes('100/t')) {
                                    e.currentTarget.src = `https://resources.premierleague.com/premierleague/badges/100/t${homeTeamInfo.code}.png`;
                                  } else {
                                    e.currentTarget.src = '/default_team_badge.png';
                                  }
                                }}
                              />
                            </div>
                          </div>

                          {/* Center Clickable Area: GW text di atas skor, skor pertandingan, status match */}
                          <div className="relative shrink-0 flex flex-col items-center justify-center z-20">
                            <button
                              type="button"
                              onClick={() => setIsGWDropdownOpen((prev) => !prev)}
                              className="flex flex-col items-center justify-center cursor-pointer group focus:outline-none select-none py-0.5 px-1.5 sm:px-2 rounded-lg hover:bg-white/5 transition-colors gap-1.5"
                              title={language === 'id' ? 'Pilih Gameweek' : 'Select Gameweek'}
                            >
                              {/* 1. Text GW di atas skor pertandingan: font, ukuran, format sama persis dengan GW Status */}
                              <span className="font-medium text-[11px] sm:text-xs text-slate-300 group-hover:text-white transition-colors tracking-wider select-none leading-tight">
                                GW {activeGW}
                              </span>

                              {/* 2. Skor pertandingan */}
                              <div className="flex items-center justify-center">
                                <span className={`font-black text-base sm:text-lg tracking-wider leading-none select-none font-sans group-hover:scale-105 transition-transform ${scoreTextColor}`}>
                                  {hasScore ? `${homeScore} - ${awayScore}` : 'vs'}
                                </span>
                              </div>

                              {/* 3. Status match */}
                              <div className="flex items-center justify-center">
                                {isFt ? (
                                  <span className="font-medium text-[11px] sm:text-xs text-slate-300 group-hover:text-white transition-colors tracking-wider select-none leading-tight">
                                    {language === 'id' ? 'Selesai' : 'Full Time'}
                                  </span>
                                ) : isHalfTime ? (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 shadow-xs">
                                    <span className="font-sans tracking-wide">
                                      {language === 'id' ? 'Paruh Waktu' : 'Half Time'}
                                    </span>
                                  </span>
                                ) : isLive ? (
                                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1.5 shadow-xs">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shadow-[0_0_6px_rgba(244,63,94,0.8)] shrink-0"></span>
                                    <span className="font-sans tracking-wide">
                                      {clockLabel && clockLabel !== 'Full Time' && clockLabel !== 'Half Time'
                                        ? clockLabel
                                        : (matchMinutes >= 90 ? "90+'" : matchMinutes > 0 ? `${matchMinutes}'` : "1'")}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="font-medium text-[11px] sm:text-xs text-slate-300 group-hover:text-white transition-colors tracking-wider select-none leading-tight">
                                    {language === 'id' ? 'Belum Dimulai' : 'Upcoming'}
                                  </span>
                                )}
                              </div>
                            </button>

                            {/* Dropdown Filter GW */}
                            {renderGWDropdown()}
                          </div>

                          {/* Away Team */}
                          <div className="flex-1 flex items-center justify-start gap-1.5 sm:gap-2 min-w-0">
                            <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 flex items-center justify-center">
                              <img
                                src={awayBadgeUrl}
                                alt={awayName}
                                className="w-full h-full object-contain filter drop-shadow select-none"
                                onError={(e) => {
                                  if (awayTeamInfo?.code && !e.currentTarget.src.includes('100/t')) {
                                    e.currentTarget.src = `https://resources.premierleague.com/premierleague/badges/100/t${awayTeamInfo.code}.png`;
                                  } else {
                                    e.currentTarget.src = '/default_team_badge.png';
                                  }
                                }}
                              />
                            </div>
                            <span className="font-black text-sm sm:text-base text-white tracking-tight truncate block text-left">
                              {awayName}
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

                      {/* Integrated Points & Breakdown Section: GW Points at Left, Breakdown at Right */}
                      <div className="mt-2.5 pt-2.5 border-t border-purple-500/25 flex flex-row items-stretch gap-2.5">
                        {/* Left: Fixed-height GW Points Panel matching 2 breakdown data rows (~68px) with width reduced by 30% */}
                        <div className="bg-[#12001a] border border-purple-500/50 rounded-lg px-1 py-1 h-[68px] max-h-[68px] w-[59px] min-w-[59px] max-w-[59px] shrink-0 self-start text-center shadow-inner flex flex-col items-center justify-center">
                          <span className="text-[36px] font-black text-[#00ff87] leading-none tracking-tight">
                            {effectiveGWPoints}
                          </span>
                          <span className="font-medium text-[11px] sm:text-xs text-slate-300 tracking-wider select-none leading-tight mt-0.5">
                            {t('modal_plyr_match_points')}
                          </span>
                        </div>

                        {/* Right: Points Breakdown Panel */}
                        <div className="flex-1 min-w-0">
                          {effectiveExplainList.length > 0 ? (
                            <div className="bg-black/30 rounded-lg border border-purple-500/20 divide-y divide-purple-500/15 max-h-[170px] overflow-y-auto">
                              {effectiveExplainList.map((stat, idx) => {
                                const dict = STAT_IDENTIFIER_LABELS_BY_LANG[language] || STAT_IDENTIFIER_LABELS;
                                const label = dict[stat.identifier] || stat.identifier;
                                return (
                                  <div key={idx} className="flex items-center justify-between py-1.5 px-2.5 text-xs h-[34px] box-border">
                                    <span className="text-slate-200 font-medium truncate mr-2">{label}</span>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className="text-purple-300/80 font-mono text-[11px]">{stat.value}</span>
                                      <span className={`font-black text-right min-w-[50px] ${
                                        stat.points > 0 ? 'text-[#00ff87]' : stat.points < 0 ? 'text-rose-400' : 'text-slate-400'
                                      }`}>
                                        {stat.points > 0 ? `+${stat.points}` : stat.points} {language === 'id' ? 'poin' : 'pts'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="bg-black/20 rounded-lg p-2.5 h-[68px] flex items-center justify-center text-center text-xs text-purple-300/70 italic border border-purple-500/20">
                              {minutesPlayed === 0 ? t('modal_plyr_did_not_play') : (language === 'id' ? 'Tidak ada peristiwa poin tercatat.' : 'No points events registered.')}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* 2. COMBINED STATISTICS & INSIGHTS (TRANSPOSED) */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[11px] font-extrabold tracking-wider border-b border-slate-200 dark:border-purple-900/40 select-none">
                        <th className="py-2.5 px-3 text-left w-[43%] sm:w-[46%]">{language === 'id' ? 'Statistik' : 'Statistic'}</th>
                        <th className="py-2.5 px-2.5 text-right w-[19%] sm:w-[18%]">GW {activeGW}</th>
                        <th className="py-2.5 px-2.5 text-right w-[19%] sm:w-[18%]">{language === 'id' ? 'Performa' : 'Form'}</th>
                        <th className="py-2.5 px-2.5 text-right w-[19%] sm:w-[18%]">{language === 'id' ? 'Musim' : 'Season'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                      {combinedStatsData.rows.map((row) => {
                        const styles = getStatComparisonStyles(row.gw, row.form, row.season, row.isInverted);
                        const displayMetricLabel = language === 'id' ? (MATCH_METRIC_LABELS_ID[row.key] || row.label) : row.label;
                        return (
                          <tr key={row.key} className="hover:bg-purple-50/20 dark:hover:bg-purple-950/20 transition-colors">
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200 text-xs sm:text-[12.5px]">
                              {displayMetricLabel}
                            </td>
                            <td className={`py-2 px-2.5 text-right font-mono font-semibold text-xs sm:text-[13px] ${styles.gw}`}>
                              {row.gw}
                            </td>
                            <td className={`py-2 px-2.5 text-right font-mono font-semibold text-xs sm:text-[13px] ${styles.form}`}>
                              {row.form}
                            </td>
                            <td className={`py-2 px-2.5 text-right font-mono font-semibold text-xs sm:text-[13px] ${styles.season}`}>
                              {row.season}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: OWNERS (FULL LEAGUE OWNERSHIP PANEL) */}
          {activeTab === 'owners' && (
            <div className="space-y-2">
              {/* GW Picker (Identik dengan subtab League Table, rapat kiri di atas panel info owned by) */}
              <div className="flex items-center gap-1.5 py-0.5">
                <CustomPopoverSelect
                  id="player-owners-gw-filter"
                  value={activeGW}
                  onChange={(val) => setActiveGW(Number(val))}
                  className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
                  options={sortedGWs.map((gw) => ({
                    value: gw,
                    label: `GW ${gw}`,
                    sublabel: gw === effectiveCurrentGW ? (language === 'id' ? 'Terkini' : 'Current') : undefined,
                  }))}
                />
              </div>

              {/* Panel informasi owned by */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                
                {/* 3-Column Manager Info Summary (Above search box, no table, no header) */}
                {infoStats.length > 0 && (
                <div className="bg-slate-50/80 dark:bg-purple-950/40 px-3.5 py-2.5 border-b border-slate-200 dark:border-purple-900/60">
                  <div className="grid grid-cols-[max-content_max-content_1fr] items-baseline gap-x-2.5 sm:gap-x-3 gap-y-1 text-xs">
                    {infoStats.map((row) => (
                      <React.Fragment key={row.label}>
                        <span className="text-slate-600 dark:text-purple-200 font-medium">
                          {row.label}
                        </span>
                        <span className="font-black text-slate-900 dark:text-white font-mono text-right">
                          {row.count}
                        </span>
                        <span className="text-slate-500 dark:text-purple-300/70 font-semibold">
                          ({row.pct})
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Box */}
              <div className="p-2 sm:p-2.5 bg-white dark:bg-[#150a24] border-b border-slate-200 dark:border-purple-900/60 flex items-center">
                <div className="relative w-full">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('search_team_manager')}
                    value={ownerSearch}
                    onChange={(e) => setOwnerSearch(e.target.value)}
                    className="text-xs bg-slate-50 dark:bg-[#1a0c2c] border border-slate-300 dark:border-purple-800/60 rounded-lg pl-8 pr-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-600 text-slate-800 dark:text-slate-100 w-full"
                  />
                </div>
              </div>

              {filteredOwners.length > 0 ? (
                <div className="w-full">
                  <table className="w-full table-fixed text-left text-xs border-collapse">
                    <thead className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[10.5px] font-extrabold tracking-wider border-b border-slate-200 dark:border-purple-900/40 select-none">
                      <tr>
                        <th
                          onClick={() => handleSort('team')}
                          className="py-2 px-2.5 sm:px-3 text-left w-[54%] sm:w-[58%] cursor-pointer group"
                        >
                          <div className="flex items-center gap-1">
                            <span className="group-hover:text-purple-900 dark:group-hover:text-white transition-colors">
                              {t('col_team_manager')}
                            </span>
                            {ownerSortField === 'team' ? (
                              ownerSortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="w-2.5 h-2.5 text-slate-400/60 dark:text-purple-400/40 group-hover:text-slate-600 dark:group-hover:text-purple-200 transition-colors shrink-0" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort('squad')}
                          className="py-2 px-1 text-center w-[25%] sm:w-[23%] cursor-pointer group"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span className="whitespace-normal leading-tight text-center group-hover:text-purple-900 dark:group-hover:text-white transition-colors">
                              {t('modal_plyr_col_squad_status')}
                            </span>
                            {ownerSortField === 'squad' ? (
                              ownerSortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="w-2.5 h-2.5 text-slate-400/60 dark:text-purple-400/40 group-hover:text-slate-600 dark:group-hover:text-purple-200 transition-colors shrink-0" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort('captain')}
                          className="py-2 px-1 text-center w-[21%] sm:w-[19%] cursor-pointer group"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span className="group-hover:text-purple-900 dark:group-hover:text-white transition-colors">
                              {t('modal_plyr_col_captain')}
                            </span>
                            {ownerSortField === 'captain' ? (
                              ownerSortDirection === 'asc' ? (
                                <ArrowUp className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-purple-900 dark:text-[#00ff87] shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="w-2.5 h-2.5 text-slate-400/60 dark:text-purple-400/40 group-hover:text-slate-600 dark:group-hover:text-purple-200 transition-colors shrink-0" />
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                      {filteredOwners.map((owner) => {
                        const isTc = isManagerTripleCaptain(owner);
                        const isBb = isManagerBenchBoost(owner);
                        const isUser = userProfileId !== null && owner.entry_id === userProfileId;
                        return (
                          <tr
                            key={owner.entry_id}
                            onClick={() => onSelectManager && onSelectManager(owner.entry_id, activeGW)}
                            className={`transition-colors cursor-pointer ${
                              isUser
                                ? `${USER_ROW_BG} ${USER_ROW_HOVER_BG}`
                                : 'hover:bg-purple-50/40 dark:hover:bg-purple-950/30'
                            }`}
                            title={onSelectManager ? (language === 'id' ? `Klik untuk melihat ${owner.entry_name}` : `Click to view ${owner.entry_name}`) : undefined}
                          >
                            <td className="py-2 px-2.5 sm:px-3 min-w-0">
                              <div className="font-black text-slate-900 dark:text-white leading-tight truncate text-xs sm:text-[13px]">
                                {owner.entry_name}
                              </div>
                              <div className="text-[10.5px] sm:text-[11px] text-slate-500 dark:text-purple-300/70 truncate mt-0.5">
                                {owner.player_name}
                              </div>
                            </td>
                            <td className="py-2 px-1 text-center whitespace-nowrap">
                              {owner.is_starter ? (
                                <span className="inline-block bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold text-[9.5px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded leading-none">
                                  Starter
                                </span>
                              ) : isBb ? (
                                <span
                                  className="inline-block bg-cyan-100 dark:bg-cyan-950/60 text-cyan-900 dark:text-cyan-200 border border-cyan-400 dark:border-cyan-600 font-bold text-[9.5px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded leading-none"
                                  title="Bench Boost Active"
                                >
                                  Bench
                                </span>
                              ) : (
                                <span className="inline-block bg-slate-100 dark:bg-purple-950/30 text-slate-600 dark:text-slate-400 font-medium text-[9.5px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded leading-none">
                                  Bench
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-1 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center">
                                {owner.is_captain ? (
                                  isTc ? (
                                    <span
                                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-black text-[9px] sm:text-[11px] leading-none bg-white text-[#37003c] border border-slate-900 dark:border-slate-800 shadow-xs select-none"
                                      style={{ fontWeight: 900 }}
                                      title="Triple Captain (3x points)"
                                    >
                                      C
                                    </span>
                                  ) : (
                                    <span
                                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-black text-[9px] sm:text-[11px] leading-none bg-[#37003c] text-white shadow-xs select-none"
                                      style={{ fontWeight: 900 }}
                                      title={`Captain (${owner.multiplier || 2}x points)`}
                                    >
                                      C
                                    </span>
                                  )
                                ) : owner.is_vice_captain ? (
                                  isTc ? (
                                    <span
                                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-black text-[9px] sm:text-[11px] leading-none bg-white text-[#37003c] border border-slate-900 dark:border-slate-800 shadow-xs select-none"
                                      style={{ fontWeight: 900 }}
                                      title="Triple Vice Captain"
                                    >
                                      V
                                    </span>
                                  ) : (
                                    <span
                                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-black text-[9px] sm:text-[11px] leading-none bg-[#37003c] text-white shadow-xs select-none"
                                      style={{ fontWeight: 900 }}
                                      title="Vice Captain"
                                    >
                                      V
                                    </span>
                                  )
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-600 font-bold text-xs select-none">
                                    -
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-purple-300/80 font-medium">
                  {ownerSearch ? t('modal_plyr_owners_empty_search') : t('modal_plyr_owners_empty_gw', { gw: activeGW })}
                </div>
              )}
            </div>
          </div>
        )}

          {/* TAB 3: HISTORY (GW PROGRESSION & PREVIOUS SEASONS) */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              
              {/* 1. GW History (Gameweek progression table) */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 dark:bg-purple-950/40 px-3 py-2 border-b border-slate-200 dark:border-purple-900/60 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">
                    {language === 'id' ? 'Riwayat GW' : 'GW History'}
                  </span>
                </div>

                {summaryData?.history && summaryData.history.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                      <thead className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[10px] font-extrabold tracking-wider border-b border-slate-200 dark:border-purple-900/40 select-none">
                        <tr>
                          {GW_HISTORY_COLUMNS.map((col) => {
                            const isTooltipOpen = activeHeaderTooltip === `gw_${col.key}`;
                            const pos = getHeaderTooltipClasses(col.key);
                            return (
                              <th
                                key={col.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveHeaderTooltip(isTooltipOpen ? null : `gw_${col.key}`);
                                }}
                                className={`relative py-2 px-2 whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-slate-200/80 dark:hover:bg-purple-900/60 ${
                                  col.key === 'gw' || col.key === 'opp'
                                    ? 'text-left px-2.5'
                                    : col.key === 'pts' ||
                                      col.key === 'cost' ||
                                      col.key === 'mp' ||
                                      col.key === 'xg' ||
                                      col.key === 'xa' ||
                                      col.key === 'xgi' ||
                                      col.key === 'xgc' ||
                                      col.key === 'inf' ||
                                      col.key === 'cre' ||
                                      col.key === 'thr' ||
                                      col.key === 'ii'
                                    ? 'text-right'
                                    : 'text-center'
                                }`}
                              >
                                <span className="inline-block">
                                  {language === 'id' ? (
                                    col.key === 'opp' ? 'Lawan' :
                                    col.key === 'res' ? 'Hasil' :
                                    col.key === 'pts' ? 'Poin' :
                                    col.key === 'st' ? 'Starter' :
                                    col.key === 'mp' ? 'Menit' :
                                    col.key === 'gs' ? 'Gol' :
                                    col.key === 'a' ? 'Assist' :
                                    col.key === 'cs' ? 'CS' :
                                    col.label
                                  ) : col.label}
                                </span>
                                {isTooltipOpen && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className={`absolute z-50 bottom-full ${pos.box} mb-1.5 px-2.5 py-1 bg-slate-900/95 dark:bg-[#12001a]/95 text-white text-[11px] font-medium rounded-lg shadow-2xl border border-purple-500/40 whitespace-nowrap pointer-events-auto`}
                                  >
                                    <span className="font-bold text-[#00ff87] mr-1">
                                      {language === 'id' ? (
                                        col.key === 'opp' ? 'Lawan' :
                                        col.key === 'res' ? 'Hasil' :
                                        col.key === 'pts' ? 'Poin' :
                                        col.key === 'st' ? 'Starter' :
                                        col.key === 'mp' ? 'Menit' :
                                        col.key === 'gs' ? 'Gol' :
                                        col.key === 'a' ? 'Assist' :
                                        col.key === 'cs' ? 'CS' :
                                        col.label
                                      ) : col.label}:
                                    </span>
                                    {language === 'id' ? (FPL_STAT_TOOLTIP_TITLES_ID[col.key] || col.title) : col.title}
                                    <div className={`absolute top-full ${pos.arrow} -mt-[1px] border-4 border-transparent border-t-slate-900/95 dark:border-t-[#12001a]/95`} />
                                  </div>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                        {sortedHistory.map((h) => {
                          const isCurrent = h.round === activeGW;
                          const res = getMatchResultDetails(h);
                          const fnb = getFnbMetrics(h.round);
                          return (
                            <tr
                              key={h.round}
                              onClick={() => {
                                setActiveGW(h.round);
                                setActiveTab('overview');
                              }}
                              className={`transition-colors cursor-pointer ${
                                isCurrent
                                  ? 'bg-purple-50/80 dark:bg-purple-900/40 font-bold'
                                  : 'hover:bg-slate-50 dark:hover:bg-purple-950/30'
                              }`}
                            >
                              {/* GW */}
                              <td className="py-1.5 px-2.5 font-black text-slate-900 dark:text-white">
                                GW {h.round}
                              </td>
                              {/* Opponent */}
                              <td className="py-1.5 px-2.5">
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {h.opponent_short_name || `Team ${h.opponent_team}`}
                                </span>{' '}
                                <span className="text-[10px] text-slate-400">
                                  ({h.was_home ? 'H' : 'A'})
                                </span>
                              </td>
                              {/* Result: Score in colored box indicating W/D/L */}
                              <td className="py-1.5 px-2 text-center">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded font-mono font-bold text-[10.5px] leading-tight ${res.badgeBg}`}
                                  title={res.outcome === 'W' ? 'Win' : res.outcome === 'D' ? 'Draw' : 'Loss'}
                                >
                                  {res.scoreDisplay}
                                </span>
                              </td>
                              {/* Pts */}
                              <td className="py-1.5 px-2 text-right font-black text-purple-900 dark:text-[#00ff87]">
                                {h.total_points}
                              </td>
                              {/* ST */}
                              <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                                {h.starts ?? 0}
                              </td>
                              {/* MP */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                {h.minutes}'
                              </td>
                              {/* GS */}
                              <td className="py-1.5 px-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                {h.goals_scored || '-'}
                              </td>
                              {/* A */}
                              <td className="py-1.5 px-2 text-center font-bold text-sky-600 dark:text-sky-400">
                                {h.assists || '-'}
                              </td>
                              {/* xG */}
                              <td className="py-1.5 px-2 text-right font-mono text-rose-600 dark:text-rose-400">
                                {h.expected_goals ? Number(h.expected_goals).toFixed(2) : '0.00'}
                              </td>
                              {/* xA */}
                              <td className="py-1.5 px-2 text-right font-mono text-sky-600 dark:text-sky-400">
                                {h.expected_assists ? Number(h.expected_assists).toFixed(2) : '0.00'}
                              </td>
                              {/* xGI */}
                              <td className="py-1.5 px-2 text-right font-mono text-purple-600 dark:text-purple-400">
                                {h.expected_goal_involvements ? Number(h.expected_goal_involvements).toFixed(2) : '0.00'}
                              </td>
                              {/* CS */}
                              <td className="py-1.5 px-2 text-center font-bold text-indigo-600 dark:text-indigo-400">
                                {h.clean_sheets || '-'}
                              </td>
                              {/* GC */}
                              <td className="py-1.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                                {h.goals_conceded || '-'}
                              </td>
                              {/* xGC */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                                {h.expected_goals_conceded ? Number(h.expected_goals_conceded).toFixed(2) : '0.00'}
                              </td>
                              {/* T */}
                              <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                                {h.tackles ?? '-'}
                              </td>
                              {/* CBI */}
                              <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                                {h.clearances_blocks_interceptions ?? '-'}
                              </td>
                              {/* R */}
                              <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                                {h.recoveries ?? '-'}
                              </td>
                              {/* DC */}
                              <td className="py-1.5 px-2 text-center font-bold text-slate-800 dark:text-slate-200">
                                {h.defensive_contribution ?? '-'}
                              </td>
                              {/* OG */}
                              <td className="py-1.5 px-2 text-center text-rose-500 font-bold">
                                {h.own_goals ? h.own_goals : '-'}
                              </td>
                              {/* PS */}
                              <td className="py-1.5 px-2 text-center text-emerald-600 font-bold">
                                {h.penalties_saved ? h.penalties_saved : '-'}
                              </td>
                              {/* PM */}
                              <td className="py-1.5 px-2 text-center text-rose-500 font-bold">
                                {h.penalties_missed ? h.penalties_missed : '-'}
                              </td>
                              {/* YC */}
                              <td className="py-1.5 px-2 text-center font-bold text-amber-500">
                                {h.yellow_cards ? h.yellow_cards : '-'}
                              </td>
                              {/* RC */}
                              <td className="py-1.5 px-2 text-center font-bold text-rose-600">
                                {h.red_cards ? h.red_cards : '-'}
                              </td>
                              {/* S */}
                              <td className="py-1.5 px-2 text-center font-mono text-slate-700 dark:text-slate-300">
                                {h.saves || '-'}
                              </td>
                              {/* BP */}
                              <td className="py-1.5 px-2 text-center font-bold text-amber-600 dark:text-amber-400">
                                {h.bonus || '-'}
                              </td>
                              {/* BPS */}
                              <td className="py-1.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                                {h.bps}
                              </td>
                              {/* I */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                {h.influence ? Number(h.influence).toFixed(1) : '0.0'}
                              </td>
                              {/* C */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                {h.creativity ? Number(h.creativity).toFixed(1) : '0.0'}
                              </td>
                              {/* T */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                {h.threat ? Number(h.threat).toFixed(1) : '0.0'}
                              </td>
                              {/* II */}
                              <td className="py-1.5 px-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                                {h.ict_index ? Number(h.ict_index).toFixed(1) : '0.0'}
                              </td>
                              {/* NT (FNB League) */}
                              <td className="py-1.5 px-2 text-center font-mono">
                                {fnb.netTransfers > 0 ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{fnb.ntFormatted}</span>
                                ) : fnb.netTransfers < 0 ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold">{fnb.ntFormatted}</span>
                                ) : (
                                  <span className="text-slate-400">0</span>
                                )}
                              </td>
                              {/* TSB (FNB League) */}
                              <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-700 dark:text-purple-200">
                                {fnb.tsb}
                              </td>
                              {/* £ */}
                              <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                                {h.value ? (h.value / 10).toFixed(1) : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Season Row at the bottom */}
                      {seasonHistoryTotals && (
                        <tfoot>
                          <tr className="bg-slate-100 dark:bg-purple-950/80 font-black border-t-2 border-slate-300 dark:border-purple-800 text-slate-900 dark:text-white">
                            <td className="py-2 px-2.5 font-bold text-xs text-purple-900 dark:text-[#00ff87]">
                              {language === 'id' ? 'Musim' : 'Season'}
                            </td>
                            <td className="py-2 px-2.5 text-slate-400">
                              -
                            </td>
                            <td className="py-2 px-2 text-center text-[10px] text-slate-600 dark:text-slate-300">
                              {seasonHistoryTotals.record}
                            </td>
                            <td className="py-2 px-2 text-right font-black text-purple-900 dark:text-[#00ff87]">
                              {seasonHistoryTotals.pts}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {seasonHistoryTotals.st}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.mp}'
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                              {seasonHistoryTotals.gs}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-sky-600 dark:text-sky-400">
                              {seasonHistoryTotals.a}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-rose-600 dark:text-rose-400">
                              {seasonHistoryTotals.xg}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-sky-600 dark:text-sky-400">
                              {seasonHistoryTotals.xa}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-purple-600 dark:text-purple-400">
                              {seasonHistoryTotals.xgi}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-indigo-600 dark:text-indigo-400">
                              {seasonHistoryTotals.cs}
                            </td>
                            <td className="py-2 px-2 text-center font-mono">
                              {seasonHistoryTotals.gc}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.xgc}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {seasonHistoryTotals.t}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {seasonHistoryTotals.cbi}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {seasonHistoryTotals.r}
                            </td>
                            <td className="py-2 px-2 text-center font-bold">
                              {seasonHistoryTotals.dc}
                            </td>
                            <td className="py-2 px-2 text-center text-rose-500 font-bold">
                              {seasonHistoryTotals.og || '-'}
                            </td>
                            <td className="py-2 px-2 text-center text-emerald-600 font-bold">
                              {seasonHistoryTotals.ps || '-'}
                            </td>
                            <td className="py-2 px-2 text-center text-rose-500 font-bold">
                              {seasonHistoryTotals.pm || '-'}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-amber-500">
                              {seasonHistoryTotals.yc}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-rose-600">
                              {seasonHistoryTotals.rc}
                            </td>
                            <td className="py-2 px-2 text-center font-mono">
                              {seasonHistoryTotals.s}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-amber-600 dark:text-amber-400">
                              {seasonHistoryTotals.bp}
                            </td>
                            <td className="py-2 px-2 text-center font-mono">
                              {seasonHistoryTotals.bps}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.inf}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.cre}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.thr}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                              {seasonHistoryTotals.ii}
                            </td>
                            <td className="py-2 px-2 text-center font-mono">
                              {seasonHistoryTotals.nt}
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold text-slate-700 dark:text-purple-200">
                              {seasonHistoryTotals.tsb}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {seasonHistoryTotals.price}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    {loadingSummary ? t('modal_plyr_history_loading') : t('modal_plyr_history_empty')}
                  </div>
                )}
              </div>

              {/* 2. Previous Seasons (Replaces Season Performance) */}
              <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 dark:bg-purple-950/40 px-3 py-2 border-b border-slate-200 dark:border-purple-900/60 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">
                    {t('modal_plyr_prev_seasons')}
                  </span>
                </div>

                {summaryData?.history_past && summaryData.history_past.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                      <thead className="bg-slate-100 dark:bg-purple-950/60 text-slate-700 dark:text-purple-200 text-[10px] font-extrabold tracking-wider border-b border-slate-200 dark:border-purple-900/40 select-none">
                        <tr>
                          {PAST_SEASON_COLUMNS.map((col) => {
                            const isTooltipOpen = activeHeaderTooltip === `past_${col.key}`;
                            const pos = getHeaderTooltipClasses(col.key);
                            const displayColLabel = (col.key === 'season' && language === 'id') ? 'Musim' : (language === 'id' && col.key === 'pts' ? 'Poin' : col.label);
                            return (
                              <th
                                key={col.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveHeaderTooltip(isTooltipOpen ? null : `past_${col.key}`);
                                }}
                                className={`relative py-2 px-2 whitespace-nowrap cursor-pointer select-none transition-colors hover:bg-slate-200/80 dark:hover:bg-purple-900/60 ${
                                  col.key === 'season'
                                    ? 'text-left px-2.5'
                                    : col.key === 'pts' ||
                                      col.key === 'start_cost' ||
                                      col.key === 'end_cost' ||
                                      col.key === 'mp' ||
                                      col.key === 'xg' ||
                                      col.key === 'xa' ||
                                      col.key === 'xgi' ||
                                      col.key === 'xgc' ||
                                      col.key === 'inf' ||
                                      col.key === 'cre' ||
                                      col.key === 'thr' ||
                                      col.key === 'ii'
                                    ? 'text-right'
                                    : 'text-center'
                                }`}
                              >
                                <span className="inline-block">{displayColLabel}</span>
                                {isTooltipOpen && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className={`absolute z-50 bottom-full ${pos.box} mb-1.5 px-2.5 py-1 bg-slate-900/95 dark:bg-[#12001a]/95 text-white text-[11px] font-medium rounded-lg shadow-2xl border border-purple-500/40 whitespace-nowrap pointer-events-auto`}
                                  >
                                    <span className="font-bold text-[#00ff87] mr-1">{displayColLabel}:</span>
                                    {language === 'id' ? (FPL_STAT_TOOLTIP_TITLES_ID[col.key] || col.title) : col.title}
                                    <div className={`absolute top-full ${pos.arrow} -mt-[1px] border-4 border-transparent border-t-slate-900/95 dark:border-t-[#12001a]/95`} />
                                  </div>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-purple-900/30">
                        {sortedPastSeasons.map((hp) => (
                          <tr
                            key={hp.season_name}
                            className="hover:bg-slate-50 dark:hover:bg-purple-950/30 transition-colors"
                          >
                            {/* Season */}
                            <td className="py-1.5 px-2.5 font-black text-slate-900 dark:text-white">
                              {hp.season_name}
                            </td>
                            {/* Pts */}
                            <td className="py-1.5 px-2 text-right font-black text-purple-900 dark:text-[#00ff87]">
                              {hp.total_points}
                            </td>
                            {/* ST */}
                            <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                              {hp.starts ?? '-'}
                            </td>
                            {/* MP */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.minutes}'
                            </td>
                            {/* GS */}
                            <td className="py-1.5 px-2 text-center font-bold text-emerald-600 dark:text-emerald-400">
                              {hp.goals_scored ?? '-'}
                            </td>
                            {/* A */}
                            <td className="py-1.5 px-2 text-center font-bold text-sky-600 dark:text-sky-400">
                              {hp.assists ?? '-'}
                            </td>
                            {/* xG */}
                            <td className="py-1.5 px-2 text-right font-mono text-rose-600 dark:text-rose-400">
                              {hp.expected_goals ? Number(hp.expected_goals).toFixed(2) : '0.00'}
                            </td>
                            {/* xA */}
                            <td className="py-1.5 px-2 text-right font-mono text-sky-600 dark:text-sky-400">
                              {hp.expected_assists ? Number(hp.expected_assists).toFixed(2) : '0.00'}
                            </td>
                            {/* xGI */}
                            <td className="py-1.5 px-2 text-right font-mono text-purple-600 dark:text-purple-400">
                              {hp.expected_goal_involvements ? Number(hp.expected_goal_involvements).toFixed(2) : '0.00'}
                            </td>
                            {/* CS */}
                            <td className="py-1.5 px-2 text-center font-bold text-indigo-600 dark:text-indigo-400">
                              {hp.clean_sheets ?? '-'}
                            </td>
                            {/* GC */}
                            <td className="py-1.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                              {hp.goals_conceded ?? '-'}
                            </td>
                            {/* xGC */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                              {hp.expected_goals_conceded ? Number(hp.expected_goals_conceded).toFixed(2) : '0.00'}
                            </td>
                            {/* T */}
                            <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                              {hp.tackles ?? '-'}
                            </td>
                            {/* CBI */}
                            <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                              {hp.clearances_blocks_interceptions ?? '-'}
                            </td>
                            {/* R */}
                            <td className="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300">
                              {hp.recoveries ?? '-'}
                            </td>
                            {/* DC */}
                            <td className="py-1.5 px-2 text-center font-bold text-slate-800 dark:text-slate-200">
                              {hp.defensive_contribution ?? '-'}
                            </td>
                            {/* OG */}
                            <td className="py-1.5 px-2 text-center text-rose-500 font-bold">
                              {hp.own_goals || '-'}
                            </td>
                            {/* PS */}
                            <td className="py-1.5 px-2 text-center text-emerald-600 font-bold">
                              {hp.penalties_saved || '-'}
                            </td>
                            {/* PM */}
                            <td className="py-1.5 px-2 text-center text-rose-500 font-bold">
                              {hp.penalties_missed || '-'}
                            </td>
                            {/* YC */}
                            <td className="py-1.5 px-2 text-center font-bold text-amber-500">
                              {hp.yellow_cards || '-'}
                            </td>
                            {/* RC */}
                            <td className="py-1.5 px-2 text-center font-bold text-rose-600">
                              {hp.red_cards || '-'}
                            </td>
                            {/* S */}
                            <td className="py-1.5 px-2 text-center font-mono text-slate-700 dark:text-slate-300">
                              {hp.saves || '-'}
                            </td>
                            {/* BP */}
                            <td className="py-1.5 px-2 text-center font-bold text-amber-600 dark:text-amber-400">
                              {hp.bonus || '-'}
                            </td>
                            {/* BPS */}
                            <td className="py-1.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                              {hp.bps}
                            </td>
                            {/* I */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.influence ? Number(hp.influence).toFixed(1) : '0.0'}
                            </td>
                            {/* C */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.creativity ? Number(hp.creativity).toFixed(1) : '0.0'}
                            </td>
                            {/* T */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.threat ? Number(hp.threat).toFixed(1) : '0.0'}
                            </td>
                            {/* II */}
                            <td className="py-1.5 px-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                              {hp.ict_index ? Number(hp.ict_index).toFixed(1) : '0.0'}
                            </td>
                            {/* £S */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.start_cost ? (hp.start_cost / 10).toFixed(1) : '-'}
                            </td>
                            {/* £E */}
                            <td className="py-1.5 px-2 text-right font-mono text-slate-700 dark:text-slate-300">
                              {hp.end_cost ? (hp.end_cost / 10).toFixed(1) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    {loadingSummary ? 'Loading previous seasons...' : 'No previous season records found for this player.'}
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
