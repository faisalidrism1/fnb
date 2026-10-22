import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Minus,
  Trophy,
  Award,
  Medal,
  ChevronDown,
  ArrowUpDown,
  Search,
  AlertTriangle,
  LineChart,
  Activity,
  Info,
} from 'lucide-react';
import {
  StandingsRow,
  GWChampionRow,
  MostGWChampionLeader,
  LigaMinusItem,
  GwEventStatus,
  SyncStatus,
  StandingsSubTab,
} from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';
import { getGameweekStatus, GameweekLifecycleStatus } from '../utils/gwStatus.ts';
import { StandingsChart } from './StandingsChart.tsx';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { useLanguage, formatDeadlineByLanguage } from '../utils/i18n.ts';

interface TabStandingsProps {
  standings: Record<number, StandingsRow[]>;
  gameweekChampions: GWChampionRow[];
  mostGameweekChampions: MostGWChampionLeader[];
  ligaMinus: LigaMinusItem[];
  currentGW: number;
  availableGWs: number[];
  selectedGW?: number;
  onSelectGW?: (gw: number) => void;
  onSelectManager: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
  subTab?: StandingsSubTab;
  onSelectSubTab?: (subTab: StandingsSubTab) => void;
}

export type { StandingsSubTab };

type SortField = 'rank' | 'entry_name' | 'total_points' | 'event_points' | 'event_transfers_cost';
type SortOrder = 'asc' | 'desc';

export const TabStandings: React.FC<TabStandingsProps> = ({
  standings,
  gameweekChampions,
  mostGameweekChampions,
  ligaMinus,
  currentGW,
  availableGWs,
  selectedGW: propSelectedGW,
  onSelectGW,
  onSelectManager,
  onSelectPlayer,
  gwStatus,
  eventsStatus,
  syncStatus,
  subTab: propSubTab,
  onSelectSubTab,
}) => {
  const { language, t } = useLanguage();
  const [internalSubTab, setInternalSubTab] = useState<StandingsSubTab>(() => {
    const gw = currentGW || 1;
    const gwStatusObj = eventsStatus?.[gw] || gwStatus;
    const { status } = getGameweekStatus(gw, gw, gwStatusObj, syncStatus);
    return status === 'Confirmed' ? 'status' : 'live-table';
  });
  const hasSetDefaultInternalSubTab = useRef(false);
  useEffect(() => {
    if (!hasSetDefaultInternalSubTab.current && (eventsStatus || gwStatus)) {
      hasSetDefaultInternalSubTab.current = true;
      const gw = currentGW || 1;
      const gwStatusObj = eventsStatus?.[gw] || gwStatus;
      const { status } = getGameweekStatus(gw, gw, gwStatusObj, syncStatus);
      setInternalSubTab(status === 'Confirmed' ? 'status' : 'live-table');
    }
  }, [currentGW, eventsStatus, gwStatus, syncStatus]);

  const subTab = propSubTab !== undefined ? propSubTab : internalSubTab;
  const setSubTab = (val: StandingsSubTab) => {
    if (onSelectSubTab) onSelectSubTab(val);
    else setInternalSubTab(val);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [liveEventStatus, setLiveEventStatus] = useState<GwEventStatus | null>(null);
  const [nowTime, setNowTime] = useState<number>(() => Date.now());

  // Live countdown timer ticking every 1 second
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Internal independent GW filter to preserve user choice during session
  const [internalGW, setInternalGW] = useState<number>(() => {
    if (propSelectedGW !== undefined) return propSelectedGW;
    return availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW;
  });

  const activeGW = propSelectedGW !== undefined ? propSelectedGW : internalGW;
  const selectedGW = availableGWs.includes(activeGW)
    ? activeGW
    : (availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW);

  const handleSelectGW = (gw: number) => {
    setInternalGW(gw);
    onSelectGW?.(gw);
  };

  useEffect(() => {
    let isMounted = true;
    const fetchStatus = () => {
      fetch(`/api/fpl-event-status?_t=${Date.now()}`)
        .then(r => r.json())
        .then(json => {
          if (!isMounted || !json.success) return;

          // Ambil 1 paket utuh yang telah digabungkan dari 2 endpoint (bootstrap-static & event-status) di server
          if (json.eventsStatus && json.eventsStatus[selectedGW]) {
            setLiveEventStatus(json.eventsStatus[selectedGW]);
          } else if (json.currentGwStatus && selectedGW === json.currentGW) {
            setLiveEventStatus(json.currentGwStatus);
          }
        })
        .catch(() => {});
    };

    fetchStatus();

    const handleGlobalSync = () => {
      fetchStatus();
    };
    window.addEventListener('fpl:data-synced', handleGlobalSync);

    // Periodic live polling every 20s so live match audits & bonus updates reflect automatically
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    }, 20 * 1000);

    return () => {
      isMounted = false;
      window.removeEventListener('fpl:data-synced', handleGlobalSync);
      clearInterval(interval);
    };
  }, [selectedGW, syncStatus]);

  const gwEventStatus = useMemo((): GwEventStatus => {
    if (eventsStatus && eventsStatus[selectedGW]) {
      return eventsStatus[selectedGW];
    }
    if (liveEventStatus && liveEventStatus.event === selectedGW) {
      return liveEventStatus;
    }
    if (selectedGW === currentGW && gwStatus) {
      return gwStatus;
    }
    if (selectedGW < currentGW) {
      return {
        event: selectedGW,
        status: 'Confirmed',
        days: [],
        data_checked: true,
        finished: true
      };
    }
    if (selectedGW > currentGW) {
      return {
        event: selectedGW,
        status: 'Not started',
        days: [],
        data_checked: false,
        finished: false
      };
    }
    return {
      event: selectedGW,
      status: 'Provisional',
      days: []
    };
  }, [liveEventStatus, eventsStatus, gwStatus, selectedGW, currentGW]);

  // Status for the active gameweek (currentGW)
  const currentGwLifecycleStatus = useMemo(() => {
    const activeObj = (liveEventStatus && liveEventStatus.event === currentGW ? liveEventStatus : null) || eventsStatus?.[currentGW] || gwStatus;
    return getGameweekStatus(currentGW, currentGW, activeObj, syncStatus);
  }, [currentGW, liveEventStatus, eventsStatus, gwStatus, syncStatus]);

  // When active GW is Confirmed or Not Started -> "Current" (or "Terkini" in id)
  // When active GW is Live or Provisional -> "Live"
  const currentGwBadgeText = currentGwLifecycleStatus.isLiveOrProvisional
    ? 'Live'
    : (language === 'id' ? 'Terkini' : 'Current');
  
  // Sort state for live table: default rank ASCENDING
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Sort state for Gameweek Champions: default GW DESCENDING
  const [gwChampSortField, setGwChampSortField] = useState<'event' | 'points'>('event');
  const [gwChampSortOrder, setGwChampSortOrder] = useState<SortOrder>('desc');

  const handleGwChampSort = (field: 'event' | 'points') => {
    if (gwChampSortField === field) {
      setGwChampSortOrder(gwChampSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setGwChampSortField(field);
      setGwChampSortOrder('desc');
    }
  };

  const sortedGameweekChampions = useMemo(() => {
    const list = [...gameweekChampions];
    list.sort((a, b) => {
      if (gwChampSortField === 'event') {
        return gwChampSortOrder === 'desc' ? b.event - a.event : a.event - b.event;
      }
      if (gwChampSortField === 'points') {
        if (b.points !== a.points) {
          return gwChampSortOrder === 'desc' ? b.points - a.points : a.points - b.points;
        }
        return b.event - a.event;
      }
      return b.event - a.event;
    });
    return list;
  }, [gameweekChampions, gwChampSortField, gwChampSortOrder]);

  const liveGwEvents = useMemo(() => {
    const set = new Set<number>();
    gameweekChampions.forEach((g) => {
      if (g.is_finished === false) {
        set.add(g.event);
      }
    });
    return set;
  }, [gameweekChampions]);

  const rows = standings[selectedGW] || [];

  // Compute 4 champion teams from the Status subtab (Peringkat 1, Peringkat 2, Juara Terbanyak, Juara Gameweek)
  const statusChampionEntryIds = useMemo(() => {
    const liveRows = (standings && standings[selectedGW]) ? standings[selectedGW] : [];
    if (liveRows.length === 0) return [];

    const rank1 = liveRows.find((r) => r.rank === 1) || liveRows[0];
    const rank2 = liveRows.find((r) => r.rank === 2) || liveRows[1];

    const top1Or2EntryIds = new Set<number>();
    if (rank1?.entry_id) top1Or2EntryIds.add(rank1.entry_id);
    if (rank2?.entry_id) top1Or2EntryIds.add(rank2.entry_id);

    const mostGwList = Array.isArray(mostGameweekChampions) ? mostGameweekChampions : [];
    const eligibleMostGwWinner =
      mostGwList
        .filter((m) => m && m.win_count > 0)
        .find((m) => {
          if (!m.entry_id) {
            const found = liveRows.find(
              (r) => r.entry_name === m.entry_name || r.player_name === m.player_name
            );
            return found ? !top1Or2EntryIds.has(found.entry_id) : true;
          }
          return !top1Or2EntryIds.has(m.entry_id);
        }) || mostGwList[0];

    const eligibleMostGwWinnerEntryId =
      eligibleMostGwWinner?.entry_id ||
      (eligibleMostGwWinner
        ? liveRows.find(
            (r) =>
              r.entry_name === eligibleMostGwWinner.entry_name ||
              r.player_name === eligibleMostGwWinner.player_name
          )?.entry_id
        : undefined);

    const gwChampsList = Array.isArray(gameweekChampions) ? gameweekChampions : [];
    const gwNChampionRow = gwChampsList.find((g) => g && g.event === selectedGW);
    const topGwNChampion = gwNChampionRow?.champions?.[0];
    const topGwNChampionEntryId = topGwNChampion?.entry_id;

    const ids: number[] = [];
    const addId = (id: number | undefined) => {
      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    };

    addId(rank1?.entry_id);
    addId(rank2?.entry_id);
    addId(eligibleMostGwWinnerEntryId);
    addId(topGwNChampionEntryId);

    // If less than 4 unique (e.g. if topGwNChampion is already in top 2), find next eligible champion or rank
    if (ids.length < 4 && gwNChampionRow?.champions) {
      for (const c of gwNChampionRow.champions) {
        if (c.entry_id) addId(c.entry_id);
        if (ids.length === 4) break;
      }
    }
    if (ids.length < 4) {
      for (const m of mostGwList) {
        const mId =
          m.entry_id ||
          liveRows.find((r) => r.entry_name === m.entry_name || r.player_name === m.player_name)
            ?.entry_id;
        if (mId) addId(mId);
        if (ids.length === 4) break;
      }
    }
    if (ids.length < 4) {
      for (const row of liveRows) {
        if (row.entry_id) addId(row.entry_id);
        if (ids.length === 4) break;
      }
    }

    return ids.slice(0, 4);
  }, [standings, selectedGW, mostGameweekChampions, gameweekChampions]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // "kolom poin default DESCENDING saat pertama diklik"
      if (field === 'total_points' || field === 'event_points' || field === 'event_transfers_cost') {
        setSortOrder('desc');
      } else {
        setSortOrder('asc');
      }
    }
  };

  const filteredAndSortedRows = useMemo(() => {
    let list = [...rows];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.entry_name.toLowerCase().includes(q) ||
          r.player_name.toLowerCase().includes(q) ||
          r.captain?.name.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (typeof valA === 'string') {
        return sortOrder === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [rows, searchQuery, sortField, sortOrder]);

  return (
    <div className="space-y-2.5">
      {/* SUB TAB 0: Status */}
      {subTab === 'status' && (() => {
        // GW N is current active GW, GW N+1 is next GW
        const activeGW = currentGW;
        const nextGW = activeGW < 38 ? activeGW + 1 : 38;

        // Deadline computation
        let targetDeadlineMs = 0;
        if (syncStatus?.next_deadline_time) {
          targetDeadlineMs = new Date(syncStatus.next_deadline_time).getTime();
        } else if (syncStatus?.gw_fixtures && syncStatus.gw_fixtures.length > 0) {
          const nextGwFixtures = syncStatus.gw_fixtures.filter(f => f.event === nextGW && f.kickoff_time);
          if (nextGwFixtures.length > 0) {
            const firstKickoffMs = Math.min(...nextGwFixtures.map(f => new Date(f.kickoff_time).getTime()));
            targetDeadlineMs = firstKickoffMs - 90 * 60 * 1000;
          }
        }

        if (!targetDeadlineMs || isNaN(targetDeadlineMs) || targetDeadlineMs < nowTime) {
          const fallbackDate = new Date();
          fallbackDate.setUTCDate(fallbackDate.getUTCDate() + ((6 - fallbackDate.getUTCDay() + 7) % 7 || 7));
          fallbackDate.setUTCHours(10, 0, 0, 0);
          targetDeadlineMs = fallbackDate.getTime();
        }

        const diffMs = Math.max(0, targetDeadlineMs - nowTime);
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

        const padZero = (n: number) => String(n).padStart(2, '0');

        const deadlineWibStr = formatDeadlineByLanguage(targetDeadlineMs, language);

        // Gameweek [N] Status text & color
        // Sesuai konvensi RULE[AGENTS_md] & warna khas FPL:
        // 1. Not Started (abu-abu)
        // 2. Live (merah FPL #e90052)
        // 3. Provisional (oranye/kuning)
        // 4. Confirmed (hijau cyan FPL #00ff87)
        const activeGwStatusObj = liveEventStatus || eventsStatus?.[activeGW] || gwStatus;
        const { status: calculatedStatus } = getGameweekStatus(
          activeGW,
          currentGW,
          activeGwStatusObj,
          syncStatus
        );

        const translatedStatusBadge =
          calculatedStatus === 'Not Started'
            ? t('status_not_started')
            : calculatedStatus === 'Live'
            ? t('status_live')
            : calculatedStatus === 'Provisional'
            ? t('status_provisional')
            : t('status_confirmed');

        let statusBadgeClasses = 'bg-[#00ff87]/20 border border-[#00c968] text-[#006e36]';

        if (calculatedStatus === 'Not Started') {
          statusBadgeClasses = 'bg-slate-100 border border-slate-300 text-slate-600';
        } else if (calculatedStatus === 'Live') {
          statusBadgeClasses = 'bg-[#e90052]/15 border border-[#e90052] text-[#e90052]';
        } else if (calculatedStatus === 'Provisional') {
          statusBadgeClasses = 'bg-amber-400/20 border border-amber-500 text-amber-800';
        } else {
          statusBadgeClasses = 'bg-[#00ff87]/20 border border-[#00c968] text-[#006e36]';
        }

        // Live Table GW N
        const liveRows = (standings && standings[activeGW]) ? standings[activeGW] : [];
        const rank1 = liveRows.find(r => r.rank === 1) || liveRows[0];
        const rank2 = liveRows.find(r => r.rank === 2) || liveRows[1];

        // Juara Terbanyak: Tampilkan 1 tim Rank teratas Most GW Champion.
        // Catatan: bila manager yg sama menduduki peringkat 1 atau 2 live table GW N,
        // pemenangnya diganti jadi peringkat berikutnya pada tabel Most GW champion.
        const top1Or2EntryIds = new Set<number>();
        if (rank1?.entry_id) top1Or2EntryIds.add(rank1.entry_id);
        if (rank2?.entry_id) top1Or2EntryIds.add(rank2.entry_id);

        const mostGwList = Array.isArray(mostGameweekChampions) ? mostGameweekChampions : [];
        const eligibleMostGwWinner = mostGwList
          .filter(m => m && m.win_count > 0)
          .find(m => {
            if (!m.entry_id) {
              // Match by entry_name or player_name in liveRows
              const found = liveRows.find(r => r.entry_name === m.entry_name || r.player_name === m.player_name);
              return found ? !top1Or2EntryIds.has(found.entry_id) : true;
            }
            return !top1Or2EntryIds.has(m.entry_id);
          }) || mostGwList[0];

        // Juara Gameweek: Tampilkan 1 tim Rank teratas pada GW N di tabel GW Champion
        const gwChampsList = Array.isArray(gameweekChampions) ? gameweekChampions : [];
        const gwNChampionRow = gwChampsList.find(g => g && g.event === activeGW);
        const topGwNChampion = gwNChampionRow?.champions?.[0];

        // Points stats for GW N: Highest Points, Average Points, Lowest Points
        const eventPointsList = liveRows
          .map(r => Number(r.event_points))
          .filter(p => !isNaN(p));
        const highestPoints = eventPointsList.length > 0 ? Math.max(...eventPointsList) : 0;
        const lowestPoints = eventPointsList.length > 0 ? Math.min(...eventPointsList) : 0;
        const avgPoints = eventPointsList.length > 0
          ? Math.round(eventPointsList.reduce((acc, p) => acc + p, 0) / eventPointsList.length)
          : 0;

        return (
          <div className="space-y-4 max-w-4xl mx-auto py-2">
            {/* Gameweek [N+1] Deadline & Countdown - Tanpa Panel & Tanpa Icon Jam */}
            <div className="flex flex-col items-center justify-center text-center py-2 space-y-1">
              <h3 className="text-xs sm:text-sm font-black tracking-wide text-slate-800 dark:text-slate-100">
                {t('deadline_title', { N: nextGW })}
              </h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
                {deadlineWibStr}
              </p>

              {/* 4 Countdown items: Days box putih dengan border ungu tua, boxes waktu ungu tua */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 pt-2">
                {/* Days Box */}
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white dark:bg-[#1f0d38] text-[#37003c] dark:text-[#00ff87] rounded-xl shadow-xs flex items-center justify-center border-2 border-[#37003c] dark:border-[#00ff87]/60">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-[#37003c] dark:text-[#00ff87]">
                      {days}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    {t('countdown_days')}
                  </span>
                </div>

                {/* Hours Box */}
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#37003c] text-white rounded-xl shadow-xs flex items-center justify-center border-2 border-[#37003c]">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight">
                      {padZero(hours)}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    {t('countdown_hours')}
                  </span>
                </div>

                {/* Minutes Box */}
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#37003c] text-white rounded-xl shadow-xs flex items-center justify-center border-2 border-[#37003c]">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight">
                      {padZero(minutes)}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    {t('countdown_minutes')}
                  </span>
                </div>

                {/* Seconds Box */}
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#37003c] text-white rounded-xl shadow-xs flex items-center justify-center border-2 border-[#37003c]">
                    <span className="text-xl sm:text-2xl font-black font-mono tracking-tight">
                      {padZero(seconds)}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    {t('countdown_seconds')}
                  </span>
                </div>
              </div>
            </div>

            {/* Gameweek [N] Status */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex items-center gap-1.5 w-36 sm:w-40 shrink-0">
                <span className="text-xs sm:text-sm font-black tracking-wide text-slate-800 dark:text-slate-100">
                  {t('gw_status_label', { N: activeGW })}
                </span>
              </div>
              <span className={`px-3 py-1 rounded-md text-xs sm:text-sm font-bold ${statusBadgeClasses}`}>
                {translatedStatusBadge}
              </span>
            </div>

            {/* Section 2: Leaders & Highlights (Tanpa Panel, Nama Tim & Pemain di Sebelah Kanan Nama Peringkat, Tanpa Poin) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5 py-1">
              {/* Peringkat 1 */}
              <div
                onClick={() => rank1?.entry_id && onSelectManager(rank1.entry_id, activeGW)}
                className={`flex items-center gap-3 ${rank1?.entry_id ? 'cursor-pointer group' : ''}`}
              >
                <div className="flex items-center gap-1.5 w-36 sm:w-40 shrink-0">
                  <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-700">
                    {t('highlight_rank_1')}
                  </span>
                </div>
                {rank1 ? (
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs sm:text-sm font-black text-slate-900 truncate group-hover:text-purple-900">
                      {rank1.entry_name}
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
                      {rank1.player_name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 font-medium">{t('no_data_available')}</span>
                )}
              </div>

              {/* Peringkat 2 */}
              <div
                onClick={() => rank2?.entry_id && onSelectManager(rank2.entry_id, activeGW)}
                className={`flex items-center gap-3 ${rank2?.entry_id ? 'cursor-pointer group' : ''}`}
              >
                <div className="flex items-center gap-1.5 w-36 sm:w-40 shrink-0">
                  <Trophy className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-700">
                    {t('highlight_rank_2')}
                  </span>
                </div>
                {rank2 ? (
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs sm:text-sm font-black text-slate-900 truncate group-hover:text-purple-900">
                      {rank2.entry_name}
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
                      {rank2.player_name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 font-medium">{t('no_data_available')}</span>
                )}
              </div>

              {/* Juara Terbanyak */}
              <div
                onClick={() => {
                  const entryId = eligibleMostGwWinner?.entry_id || liveRows.find(r => r.entry_name === eligibleMostGwWinner?.entry_name)?.entry_id;
                  if (entryId) onSelectManager(entryId, activeGW);
                }}
                className={`flex items-center gap-3 ${eligibleMostGwWinner ? 'cursor-pointer group' : ''}`}
              >
                <div className="flex items-center gap-1.5 w-36 sm:w-40 shrink-0">
                  <Award className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-700">
                    {t('highlight_most_wins')}
                  </span>
                </div>
                {eligibleMostGwWinner ? (
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs sm:text-sm font-black text-slate-900 truncate group-hover:text-purple-900">
                      {eligibleMostGwWinner.entry_name}
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
                      {eligibleMostGwWinner.player_name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 font-medium">{t('no_data_available')}</span>
                )}
              </div>

              {/* Juara Gameweek */}
              <div
                onClick={() => topGwNChampion?.entry_id && onSelectManager(topGwNChampion.entry_id, activeGW)}
                className={`flex items-center gap-3 ${topGwNChampion?.entry_id ? 'cursor-pointer group' : ''}`}
              >
                <div className="flex items-center gap-1.5 w-36 sm:w-40 shrink-0">
                  <Medal className="w-4 h-4 text-purple-600 shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-700">
                    {t('highlight_gw_champ', { N: activeGW })}
                  </span>
                </div>
                {topGwNChampion ? (
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs sm:text-sm font-black text-slate-900 truncate group-hover:text-purple-900">
                      {topGwNChampion.entry_name}
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
                      {topGwNChampion.player_name}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 font-medium">{t('no_data_available')}</span>
                )}
              </div>
            </div>

            {/* Section 3: Points Overview GW N (Highest, Average, Lowest) DALAM 1 PANEL - Warna Khas FPL */}
            <div className="bg-white rounded-xl border border-slate-200/90 p-4 sm:p-5 shadow-xs grid grid-cols-3 divide-x divide-slate-100 text-center">
              {/* Highest Points: Hijau Emerald */}
              <div className="px-2 sm:px-4">
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-500 block mb-1">
                  {t('points_highest')}
                </span>
                <span className="text-xl sm:text-2xl md:text-3xl font-black text-emerald-600 dark:text-[#00ff87]">
                  {highestPoints}
                </span>
              </div>

              {/* Average Points: Ungu Tua Khas FPL */}
              <div className="px-2 sm:px-4">
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-500 block mb-1">
                  {t('points_average')}
                </span>
                <span className="text-xl sm:text-2xl md:text-3xl font-black text-[#37003c] dark:text-purple-300">
                  {avgPoints}
                </span>
              </div>

              {/* Lowest Points: Red Rose */}
              <div className="px-2 sm:px-4">
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-500 block mb-1">
                  {t('points_lowest')}
                </span>
                <span className="text-xl sm:text-2xl md:text-3xl font-black text-rose-600 dark:text-rose-400">
                  {lowestPoints}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SUB TAB 1: Live League Table */}
      {subTab === 'live-table' && (
        <>
          {/* Filters directly below sub tab - Side by side (reduced horizontal padding 50%) */}
          <div className="flex items-center gap-1.5 py-0.5">
            <CustomPopoverSelect
              id="standings-gw-filter"
              value={selectedGW}
              onChange={(val) => handleSelectGW(Number(val))}
              className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
              options={availableGWs.map((gw) => ({
                value: gw,
                label: `GW ${gw}`,
                sublabel: gw === currentGW ? currentGwBadgeText : undefined,
              }))}
            />
            {selectedGW === currentGW && (
              <span className={`border text-[10px] font-extrabold px-1 py-0.5 rounded-full uppercase tracking-wider shrink-0 hidden xs:inline-block ${
                currentGwBadgeText === 'Live'
                  ? 'bg-[#ff2851]/15 border-[#ff2851] text-[#ff2851]'
                  : 'bg-[#00ff87]/30 text-[#0f5132] border-[#00ff87]'
              }`}>
                {currentGwBadgeText}
              </span>
            )}

            {/* Quick Search side-by-side with GW filter */}
            <div className="relative flex-1 max-w-xs sm:max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-1.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="search-standings-input"
                placeholder={t('search_team_manager')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-6 pr-1.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#37003c] text-slate-800 shadow-2xs"
              />
            </div>
          </div>

          {/* Table directly below filter - Horizontal padding reduced by 50% */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  {/* Frozen Rank Column - Slim & Minimalist */}
                  <th
                    className="sticky left-0 z-30 bg-[#37003c] py-2 px-0.5 text-center cursor-pointer hover:bg-purple-950 transition-colors w-12 min-w-[48px] max-w-[48px] border-b border-purple-900 leading-tight"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>{t('col_rank')}</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Frozen Team & Manager Column - Seamless with table */}
                  <th
                    className="sticky left-[48px] z-30 bg-[#37003c] py-2 px-1 cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 border-r border-purple-900/40 leading-tight"
                    onClick={() => handleSort('entry_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>{t('col_team_manager')}</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-300" />
                    </div>
                  </th>

                  {/* Total Points - Wrapped header */}
                  <th
                    className="py-1.5 px-0.5 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-10 leading-tight"
                    onClick={() => handleSort('total_points')}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <div className="flex flex-col leading-tight text-right">
                        {language === 'id' ? (
                          <>
                            <span>Total</span>
                            <span>Poin</span>
                          </>
                        ) : (
                          <>
                            <span>Total</span>
                            <span>Pts</span>
                          </>
                        )}
                      </div>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>

                  {/* GW Points - Wrapped header */}
                  <th
                    className="py-1.5 px-0.5 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[40px] min-w-[40px] leading-tight"
                    onClick={() => handleSort('event_points')}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <div className="flex flex-col leading-tight text-right">
                        {language === 'id' ? (
                          <>
                            <span>Poin</span>
                            <span>GW</span>
                          </>
                        ) : (
                          <>
                            <span>GW</span>
                            <span>Pts</span>
                          </>
                        )}
                      </div>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>

                  {/* Hits */}
                  <th
                    className="py-2 px-0.5 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 leading-tight"
                    onClick={() => handleSort('event_transfers_cost')}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <span>{t('col_hits')}</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Chip */}
                  <th className="py-2 px-0.5 text-center border-b border-purple-900 w-[40px] min-w-[40px] leading-tight">
                    {t('col_chip')}
                  </th>

                  {/* Captain & Vice */}
                  <th className="py-2 px-1 border-b border-purple-900 leading-tight">
                    {t('col_captain_vice')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedRows.map((row, idx) => {
                  return (
                    <tr
                      key={`${row.entry_id}-${idx}`}
                      className="group hover:bg-purple-50/50 transition-colors cursor-pointer"
                      onClick={() => onSelectManager(row.entry_id, selectedGW)}
                    >
                      {/* Frozen Rank Column - Last rank in parentheses & movement below */}
                      <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-0.5 text-center whitespace-nowrap w-12 min-w-[48px] max-w-[48px] border-b border-slate-100 transition-colors">
                        <div className="flex flex-col items-center justify-center leading-none">
                          <div className="flex items-baseline justify-center gap-0.5 leading-none">
                            <span
                              className={`font-black text-xs ${
                                row.rank === 1
                                  ? 'text-amber-500 dark:text-amber-400'
                                  : row.rank === 2
                                  ? 'text-slate-700 dark:text-slate-300'
                                  : row.rank === 3
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {row.rank}
                            </span>
                            {row.last_rank !== null && (
                              <span className="text-[10px] text-slate-400 font-semibold tracking-tighter">
                                ({row.last_rank})
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5">
                            {row.rank_change > 0 ? (
                              <span className="text-[9px] font-extrabold text-emerald-600 flex items-center justify-center leading-none">
                                ▲{row.rank_change}
                              </span>
                            ) : row.rank_change < 0 ? (
                              <span className="text-[9px] font-extrabold text-rose-600 flex items-center justify-center leading-none">
                                ▼{Math.abs(row.rank_change)}
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-300 leading-none">-</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Frozen Team & Manager Column - Seamless border and matching hover */}
                      <td className="sticky left-[48px] z-20 bg-white group-hover:bg-purple-50/50 py-2 px-1 whitespace-nowrap border-b border-slate-100 border-r border-slate-200/80 transition-colors">
                        <div className="whitespace-nowrap">
                          <p className="font-extrabold text-slate-900 text-xs hover:text-[#37003c] leading-snug whitespace-nowrap">
                            {row.entry_name}
                          </p>
                          <p className="text-[11px] text-slate-500 font-medium leading-tight whitespace-nowrap">
                            {row.player_name}
                          </p>
                        </div>
                      </td>

                      {/* Total Points */}
                      <td className="py-2 px-0.5 text-right whitespace-nowrap border-b border-slate-100">
                        <span className="font-black text-slate-900 text-xs sm:text-sm">
                          {row.total_points}
                        </span>
                      </td>

                      {/* GW Points */}
                      <td className="py-2 px-0.5 text-right whitespace-nowrap border-b border-slate-100 w-[40px] min-w-[40px]">
                        <span className="font-bold text-emerald-600 dark:text-[#00ff87] text-xs">
                          {row.event_points}
                        </span>
                      </td>

                      {/* Hits */}
                      <td className="py-2 px-0.5 text-right whitespace-nowrap border-b border-slate-100">
                        {row.event_transfers_cost > 0 ? (
                          <span className="font-bold text-rose-600 dark:text-rose-400 text-xs">
                            -{row.event_transfers_cost}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium text-xs">0</span>
                        )}
                      </td>

                      {/* Chip */}
                      <td className="py-2 px-0.5 text-center whitespace-nowrap border-b border-slate-100 w-[40px] min-w-[40px]">
                        {row.active_chip ? (
                          <span className="inline-block bg-[#37003c] text-[#00ff87] font-black text-[10px] px-1.5 py-0.5 rounded-full border border-[#00ff87]/60 uppercase shadow-xs">
                            {row.active_chip}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">-</span>
                        )}
                      </td>

                      {/* Captain & Vice Captain */}
                      <td className="py-2 px-1 whitespace-nowrap border-b border-slate-100">
                        <div className="space-y-0.5">
                          {row.captain ? (
                            <div
                              onClick={(e) => {
                                if (onSelectPlayer && row.captain?.id) {
                                  e.stopPropagation();
                                  onSelectPlayer(row.captain.id, selectedGW);
                                }
                              }}
                              className={`flex items-center gap-1 ${
                                onSelectPlayer && row.captain?.id
                                  ? 'cursor-pointer group/cap hover:opacity-85'
                                  : ''
                              }`}
                              title={
                                onSelectPlayer && row.captain?.id
                                  ? (language === 'id' ? `Lihat detail statistik ${row.captain.name}` : `View stats for ${row.captain.name}`)
                                  : undefined
                              }
                            >
                              <span className="bg-black text-[#00ff87] text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
                                C
                              </span>
                              <span className="font-bold text-slate-800 text-xs group-hover/cap:text-purple-700 group-hover/cap:underline">
                                {row.captain.name}
                              </span>
                              <span className="text-[10px] text-slate-500 font-medium">
                                ({row.captain.club})
                              </span>
                              <span className="font-black text-purple-900 text-xs ml-auto pl-1">
                                {row.captain.points} {language === 'id' ? 'poin' : 'pts'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}

                          {row.vice_captain && (
                            <div
                              onClick={(e) => {
                                if (onSelectPlayer && row.vice_captain?.id) {
                                  e.stopPropagation();
                                  onSelectPlayer(row.vice_captain.id, selectedGW);
                                }
                              }}
                              className={`flex items-center gap-1 text-slate-500 text-[11px] ${
                                onSelectPlayer && row.vice_captain?.id
                                  ? 'cursor-pointer group/vcap hover:opacity-85'
                                  : ''
                              }`}
                              title={
                                onSelectPlayer && row.vice_captain?.id
                                  ? (language === 'id' ? `Lihat detail statistik ${row.vice_captain.name}` : `View stats for ${row.vice_captain.name}`)
                                  : undefined
                              }
                            >
                              <span className="bg-slate-300 dark:bg-purple-900/80 text-slate-800 dark:text-purple-200 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
                                V
                              </span>
                              <span className="group-hover/vcap:text-purple-700 group-hover/vcap:underline">
                                {row.vice_captain.name}
                              </span>
                              <span className="text-[10px]">({row.vice_captain.club})</span>
                              <span className="font-semibold text-slate-600 text-[11px] ml-auto pl-1">
                                {row.vice_captain.points} {language === 'id' ? 'poin' : 'pts'}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    )}

      {/* SUB TAB 2: Gameweek Champions (Full Season) */}
      {subTab === 'gw-champions' && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-collapse table-auto sm:table-fixed">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  <th
                    className="py-2.5 px-2 text-center w-[68px] sm:w-[84px] shrink-0 border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors leading-tight"
                    onClick={() => handleGwChampSort('event')}
                    title={t('tooltip_sort_gw')}
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>{t('col_gw')}</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>
                  <th className="py-2.5 px-2 text-left border-b border-purple-900 leading-tight">
                    {t('col_team_manager')}
                  </th>
                  <th className="py-2.5 px-1.5 text-center w-[52px] sm:w-[64px] shrink-0 border-b border-purple-900 leading-tight">
                    {t('col_rank')}
                  </th>
                  <th
                    className="py-2.5 px-2 text-right w-[66px] sm:w-[80px] shrink-0 border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors leading-tight"
                    onClick={() => handleGwChampSort('points')}
                    title={t('tooltip_sort_pts')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{t('col_pts')}</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedGameweekChampions.map((item) => (
                  <tr key={item.event} className="hover:bg-purple-50/40 transition-colors border-b border-slate-200">
                    <td className="py-2 px-1 sm:px-2 text-center whitespace-nowrap border-b border-slate-200 align-middle">
                      <div className="flex flex-col items-center justify-center gap-0.5">
                        <span className="inline-flex items-center justify-center font-black text-[11px] sm:text-xs bg-purple-100 text-[#37003c] px-1.5 py-0.5 rounded border border-purple-200/80 leading-none">
                          GW {item.event}
                        </span>
                        {item.is_finished === false && (
                          <span className="inline-flex items-center gap-0.5 font-bold text-[8.5px] sm:text-[9px] bg-rose-50 text-rose-700 border border-rose-200 px-1 py-0.2 rounded-full animate-pulse leading-none mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                            Live
                          </span>
                        )}
                        {item.champions.length > 1 && (
                          <span className="text-[8.5px] sm:text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200/80 px-1 py-0.2 rounded text-center whitespace-nowrap leading-none mt-0.5">
                            ({item.champions.length})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 border-b border-slate-200 align-middle min-w-0">
                      <div className="flex flex-col gap-1.5">
                        {item.champions.map((champ, cIdx) => (
                          <div
                            key={cIdx}
                            onClick={() => onSelectManager(champ.entry_id, item.event)}
                            className="cursor-pointer group min-w-0"
                          >
                            <p className="font-extrabold text-slate-900 text-xs hover:text-[#37003c] leading-snug truncate">
                              {champ.entry_name}
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium leading-tight truncate">
                              {champ.player_name}
                            </p>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-1 text-center whitespace-nowrap border-b border-slate-200 align-middle">
                      <div className="flex flex-col gap-1.5 justify-center">
                        {item.champions.map((champ, cIdx) => (
                          <div key={cIdx} className="flex flex-col items-center justify-center">
                            <div className="flex items-baseline justify-center gap-0.5">
                              <span className="font-black text-xs text-slate-800">
                                {champ.rank_at_gw}
                              </span>
                              {champ.last_rank_at_gw !== null && champ.last_rank_at_gw !== undefined && (
                                <span className="text-[9px] text-slate-400 font-bold tracking-tighter">
                                  ({champ.last_rank_at_gw})
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5">
                              {champ.rank_change_at_gw !== undefined && champ.rank_change_at_gw > 0 ? (
                                <span className="text-[9px] font-extrabold text-emerald-600 flex items-center justify-center leading-none">
                                  ▲{champ.rank_change_at_gw}
                                </span>
                              ) : champ.rank_change_at_gw !== undefined && champ.rank_change_at_gw < 0 ? (
                                <span className="text-[9px] font-extrabold text-rose-600 flex items-center justify-center leading-none">
                                  ▼{Math.abs(champ.rank_change_at_gw)}
                                </span>
                              ) : (
                                <span className="text-[9px] text-slate-300 leading-none">-</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap border-b border-slate-200 align-middle">
                      <span className="inline-flex items-center justify-center font-bold text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded whitespace-nowrap">
                        {item.points} pts
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB TAB 3: Most Gameweek Champions (Leaderboard) */}
      {subTab === 'most-gw-champions' && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-collapse table-auto sm:table-fixed">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  <th className="py-2.5 px-1.5 text-center w-[46px] sm:w-[54px] shrink-0 border-b border-purple-900 leading-tight">
                    {t('col_rank')}
                  </th>
                  <th className="py-2.5 px-2 border-b border-purple-900 text-left leading-tight">
                    {t('col_team_manager')}
                  </th>
                  <th className="py-2.5 px-1.5 text-center w-[54px] sm:w-[64px] shrink-0 border-b border-purple-900 leading-tight">
                    {t('col_wins')}
                  </th>
                  <th className="py-2.5 px-2 text-right w-[86px] sm:w-[110px] shrink-0 border-b border-purple-900 leading-tight">
                    {t('col_gw')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mostGameweekChampions
                  .filter((m) => m.win_count > 0)
                  .map((lead, idx) => {
                    // Temukan entry_id untuk interaktivitas modal manajer
                    const allCurrentRows = standings[currentGW] || standings[selectedGW] || [];
                    const standing = allCurrentRows.find(
                      (s) =>
                        (lead.entry_id ? s.entry_id === lead.entry_id : false) ||
                        s.entry_name === lead.entry_name ||
                        s.player_name === lead.player_name
                    );
                    const entryId = lead.entry_id || standing?.entry_id;

                    return (
                      <tr
                        key={idx}
                        onClick={() => entryId && onSelectManager(entryId, currentGW)}
                        className={`transition-colors border-b border-slate-100 ${
                          entryId ? 'cursor-pointer hover:bg-purple-50/50' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Current Rank di Kolom Paling Kiri */}
                        <td className="py-2 px-1 text-center whitespace-nowrap align-middle border-b border-slate-100">
                          <span className="font-black text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80 inline-flex items-center justify-center min-w-[24px]">
                            {lead.current_rank}
                          </span>
                        </td>

                        {/* Nama Tim dan Manager: Atas-Bawah */}
                        <td
                          className="py-2 px-2 align-middle min-w-0 border-b border-slate-100 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (entryId) onSelectManager(entryId, currentGW);
                          }}
                        >
                          <div className="min-w-0">
                            <p className="font-extrabold text-slate-900 text-xs hover:text-[#37003c] leading-snug truncate">
                              {lead.entry_name}
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium leading-tight truncate">
                              {lead.player_name}
                            </p>
                          </div>
                        </td>

                        {/* Wins */}
                        <td className="py-2 px-1 text-center whitespace-nowrap align-middle border-b border-slate-100">
                          <span className="inline-flex items-center justify-center font-black text-xs text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded min-w-[28px]">
                            {lead.win_count}
                          </span>
                        </td>

                        {/* GWs Won */}
                        <td className="py-2 px-2 text-right whitespace-nowrap align-middle border-b border-slate-100">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {lead.gws_won.map((gw, gIdx) => {
                              const isGwLive = liveGwEvents.has(gw);
                              return (
                                <button
                                  key={`${gw}-${gIdx}`}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (entryId) onSelectManager(entryId, Number(gw));
                                  }}
                                  className="inline-flex flex-col items-center justify-center shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                                  title={t('tooltip_open_team_gw', { gw })}
                                >
                                  <span className="bg-[#37003c] text-[#00ff87] hover:bg-purple-950 text-[9.5px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap leading-none border border-purple-800/40">
                                    GW{gw}
                                  </span>
                                  {isGwLive && (
                                    <span className="inline-flex items-center gap-0.5 font-bold text-[8px] bg-rose-50 text-rose-700 border border-rose-200 px-1 py-0.2 rounded-full animate-pulse mt-0.5 leading-none">
                                      <span className="w-1 h-1 rounded-full bg-rose-600"></span>
                                      Live
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB TAB: Chart */}
      {subTab === 'chart' && (
        <StandingsChart
          standings={standings}
          availableGWs={availableGWs}
          currentGW={currentGW}
          onSelectManager={onSelectManager}
          onSelectPlayer={onSelectPlayer}
          initialChampionEntryIds={statusChampionEntryIds}
        />
      )}

      {/* SUB TAB 4: Liga Minus - Fits horizontally on mobile screen without wrap */}
      {subTab === 'liga-minus' && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          {ligaMinus.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              <p className="font-bold text-slate-700">{t('minus_empty_1')}</p>
              <p className="text-xs mt-1">{t('minus_empty_2')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs text-slate-700 border-collapse table-auto sm:table-fixed">
                <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                  <tr>
                    {/* Rank Column */}
                    <th className="py-2.5 px-1 text-center w-[36px] sm:w-[44px] shrink-0 border-b border-purple-900 leading-tight">
                    </th>
                    {/* Team & Manager */}
                    <th className="py-2.5 px-2 border-b border-purple-900 text-left leading-tight">
                      {t('col_team_manager')}
                    </th>
                    {/* Hits */}
                    <th className="py-2.5 px-1.5 text-right w-[60px] sm:w-[72px] shrink-0 border-b border-purple-900 leading-tight">
                      {t('col_hits')}
                    </th>
                    {/* Last Rank */}
                    <th className="py-2.5 px-2 text-right w-[54px] sm:w-[66px] shrink-0 border-b border-purple-900 leading-tight">
                      {t('col_rank')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ligaMinus.map((entry, idx) => (
                    <tr
                      key={`${entry.entry_id}-${idx}`}
                      onClick={() => onSelectManager(entry.entry_id, currentGW)}
                      className="hover:bg-purple-50/30 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-2 px-1 text-center whitespace-nowrap align-middle border-b border-slate-100">
                        <span className="font-bold text-xs text-slate-600 inline-flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-2 px-2 border-b border-slate-100 align-middle min-w-0">
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900 text-xs hover:text-[#37003c] leading-snug truncate">
                            {entry.entry_name}
                          </p>
                          <p className="text-[11px] text-slate-500 font-medium leading-tight truncate">
                            {entry.player_name}
                          </p>
                        </div>
                      </td>
                      <td className="py-2 px-1.5 text-right whitespace-nowrap align-middle border-b border-slate-100">
                        <span className="font-black text-xs text-rose-700 bg-rose-50 border border-rose-200/80 px-1.5 py-0.5 rounded whitespace-nowrap">
                          -{entry.total_minus_points}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap align-middle border-b border-slate-100">
                        <span className="font-bold text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {entry.current_rank}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
