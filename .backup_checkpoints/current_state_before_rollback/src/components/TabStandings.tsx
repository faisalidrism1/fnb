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
} from 'lucide-react';
import { StandingsRow, GWChampionRow, MostGWChampionLeader, LigaMinusItem, GwEventStatus } from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';
import { StandingsChart } from './StandingsChart.tsx';

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
}

type StandingsSubTab = 'live-table' | 'gw-champions' | 'most-gw-champions' | 'chart' | 'liga-minus';

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
}) => {
  const [subTab, setSubTab] = useState<StandingsSubTab>('live-table');
  const [searchQuery, setSearchQuery] = useState('');
  const [showStatusDetails, setShowStatusDetails] = useState(false);
  const [liveEventStatus, setLiveEventStatus] = useState<GwEventStatus | null>(null);
  const subTabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!subTabsRef.current) return;
    const activeBtn = subTabsRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(subTabsRef.current, activeBtn);
    }
  }, [subTab]);

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
    fetch('/api/fpl-event-status')
      .then(r => r.json())
      .then(json => {
        if (!isMounted || !json.success || !json.data) return;
        const raw = json.data;
        const days = Array.isArray(raw.status) ? raw.status.filter((s: any) => s.event === selectedGW) : [];
        if (days.length > 0) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const daysList = days.map((dItem: any) => {
            let dayName = dItem.date;
            try {
              const dObj = new Date(dItem.date + 'T12:00:00Z');
              dayName = `${dayNames[dObj.getUTCDay()]} ${dObj.getUTCDate()} ${monthNames[dObj.getUTCMonth()]}`;
            } catch {}
            let dayStatus: 'Not started' | 'Provisional' | 'Confirmed' = 'Not started';
            if (dItem.points === 'r') dayStatus = 'Confirmed';
            else if (dItem.points === 'p') dayStatus = 'Provisional';
            return {
              date: dItem.date,
              day_name: dayName,
              status: dayStatus,
              points: dItem.points || '',
              bonus_added: !!dItem.bonus_added
            };
          });

          let overallStatus: 'Not started' | 'Provisional' | 'Confirmed' = 'Not started';
          const hasProvisional = daysList.some(d => d.status === 'Provisional');
          const allConfirmed = daysList.every(d => d.status === 'Confirmed');
          const allNotStarted = daysList.every(d => d.status === 'Not started');
          if (hasProvisional) overallStatus = 'Provisional';
          else if (allConfirmed) overallStatus = 'Confirmed';
          else if (allNotStarted) overallStatus = 'Not started';
          else overallStatus = 'Provisional';

          setLiveEventStatus({
            event: selectedGW,
            status: overallStatus,
            days: daysList,
            leagues_status: raw.leagues
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [selectedGW]);

  const gwEventStatus = useMemo((): GwEventStatus => {
    if (liveEventStatus && liveEventStatus.event === selectedGW) {
      return liveEventStatus;
    }
    if (eventsStatus && eventsStatus[selectedGW]) {
      return eventsStatus[selectedGW];
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
      {/* Minimalist Sub Tab Navigation - flush to top, no wrap, horizontal scrollable */}
      <div
        ref={subTabsRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5 scroll-smooth"
      >
        <button
          id="subtab-live-table"
          data-active={subTab === 'live-table' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('live-table');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'live-table'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          </span>
          <span>Live League Table</span>
        </button>
        <button
          id="subtab-gw-champions"
          data-active={subTab === 'gw-champions' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('gw-champions');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'gw-champions'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Trophy className="w-3.5 h-3.5 text-amber-500" />
          <span>GW Champions</span>
        </button>
        <button
          id="subtab-most-gw-champions"
          data-active={subTab === 'most-gw-champions' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('most-gw-champions');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-gw-champions'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Medal className="w-3.5 h-3.5 text-emerald-600" />
          <span>Most GW Champions</span>
        </button>
        {/* SUB-TAB CHART: Available in AI Studio Development, hidden in production deploy */}
        {import.meta.env.DEV && (
          <button
            id="subtab-chart"
            data-active={subTab === 'chart' ? 'true' : 'false'}
            onClick={(e) => {
              setSubTab('chart');
              scrollTabIntoView(subTabsRef.current, e.currentTarget);
            }}
            className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              subTab === 'chart'
                ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <LineChart className="w-3.5 h-3.5 text-cyan-500" />
            <span>Chart</span>
          </button>
        )}
        <button
          id="subtab-liga-minus"
          data-active={subTab === 'liga-minus' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('liga-minus');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'liga-minus'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Liga Minus</span>
        </button>
      </div>

      {/* SUB TAB 1: Live League Table */}
      {subTab === 'live-table' && (
        <>
          {/* Filters directly below sub tab - Side by side */}
          <div className="flex items-center gap-2 py-0.5">
            <div className="relative shrink-0">
              <select
                id="standings-gw-filter"
                value={selectedGW}
                onChange={(e) => handleSelectGW(Number(e.target.value))}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                {availableGWs.map((gw) => (
                  <option key={gw} value={gw}>
                    GW {gw} {gw === currentGW ? '(Live)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {selectedGW === currentGW && (
              <span className="bg-[#00ff87]/30 text-[#0f5132] border border-[#00ff87] text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 hidden xs:inline-block">
                Live
              </span>
            )}

            {/* Quick Search side-by-side with GW filter */}
            <div className="relative flex-1 max-w-xs sm:max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="search-standings-input"
                placeholder="Search team or manager..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#37003c] text-slate-800 shadow-2xs"
              />
            </div>
          </div>

          {/* Table directly below filter */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  {/* Frozen Rank Column - Slim & Minimalist */}
                  <th
                    className="sticky left-0 z-30 bg-[#37003c] py-2 px-1 text-center cursor-pointer hover:bg-purple-950 transition-colors w-14 min-w-[56px] max-w-[56px] border-b border-purple-900 leading-tight"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>#</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Frozen Team & Manager Column - Seamless with table */}
                  <th
                    className="sticky left-[56px] z-30 bg-[#37003c] py-2 px-2.5 cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 border-r border-purple-900/40 leading-tight"
                    onClick={() => handleSort('entry_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Team & Manager</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-300" />
                    </div>
                  </th>

                  {/* Total Points - Wrapped header */}
                  <th
                    className="py-1.5 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-12 leading-tight"
                    onClick={() => handleSort('total_points')}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <div className="flex flex-col leading-tight text-right">
                        <span>Total</span>
                        <span>Pts</span>
                      </div>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>

                  {/* GW Points - Wrapped header */}
                  <th
                    className="py-1.5 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-11 leading-tight"
                    onClick={() => handleSort('event_points')}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <div className="flex flex-col leading-tight text-right">
                        <span>GW</span>
                        <span>Pts</span>
                      </div>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>

                  {/* Hits */}
                  <th
                    className="py-2 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 leading-tight"
                    onClick={() => handleSort('event_transfers_cost')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Hits</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Chip */}
                  <th className="py-2 px-2 text-center border-b border-purple-900 leading-tight">
                    Chip
                  </th>

                  {/* Captain & Vice */}
                  <th className="py-2 px-2.5 border-b border-purple-900 leading-tight">
                    Captain & Vice
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
                      <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-1 text-center whitespace-nowrap w-14 min-w-[56px] max-w-[56px] border-b border-slate-100 transition-colors">
                        <div className="flex flex-col items-center justify-center leading-none">
                          <div className="flex items-baseline justify-center gap-0.5 leading-none">
                            <span
                              className={`font-black text-xs ${
                                row.rank === 1
                                  ? 'text-amber-500'
                                  : row.rank === 2
                                  ? 'text-slate-700'
                                  : row.rank === 3
                                  ? 'text-amber-700'
                                  : 'text-slate-800'
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
                      <td className="sticky left-[56px] z-20 bg-white group-hover:bg-purple-50/50 py-2 px-2.5 whitespace-nowrap border-b border-slate-100 border-r border-slate-200/80 transition-colors">
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
                      <td className="py-2 px-2 text-right whitespace-nowrap border-b border-slate-100">
                        <span className="font-black text-slate-900 text-xs sm:text-sm">
                          {row.total_points}
                        </span>
                      </td>

                      {/* GW Points */}
                      <td className="py-2 px-2 text-right whitespace-nowrap border-b border-slate-100">
                        <span className="font-bold text-[#37003c] bg-purple-100/70 border border-purple-200 px-1.5 py-0.5 rounded text-xs">
                          {row.event_points}
                        </span>
                      </td>

                      {/* Hits */}
                      <td className="py-2 px-2 text-right whitespace-nowrap border-b border-slate-100">
                        {row.event_transfers_cost > 0 ? (
                          <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded text-[11px]">
                            -{row.event_transfers_cost}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium text-xs">0</span>
                        )}
                      </td>

                      {/* Chip */}
                      <td className="py-2 px-2 text-center whitespace-nowrap border-b border-slate-100">
                        {row.active_chip ? (
                          <span className="inline-block bg-[#37003c] text-[#00ff87] font-black text-[10px] px-2 py-0.5 rounded-full border border-[#00ff87]/60 uppercase shadow-xs">
                            {row.active_chip}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">-</span>
                        )}
                      </td>

                      {/* Captain & Vice Captain */}
                      <td className="py-2 px-2.5 whitespace-nowrap border-b border-slate-100">
                        <div className="space-y-0.5">
                          {row.captain ? (
                            <div
                              onClick={(e) => {
                                if (onSelectPlayer && row.captain?.id) {
                                  e.stopPropagation();
                                  onSelectPlayer(row.captain.id, selectedGW);
                                }
                              }}
                              className={`flex items-center gap-1.5 ${
                                onSelectPlayer && row.captain?.id
                                  ? 'cursor-pointer group/cap hover:opacity-85'
                                  : ''
                              }`}
                              title={
                                onSelectPlayer && row.captain?.id
                                  ? `Lihat detail statistik ${row.captain.name}`
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
                              <span className="font-black text-purple-900 text-xs ml-auto pl-2">
                                {row.captain.points} pts
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
                              className={`flex items-center gap-1.5 text-slate-500 text-[11px] ${
                                onSelectPlayer && row.vice_captain?.id
                                  ? 'cursor-pointer group/vcap hover:opacity-85'
                                  : ''
                              }`}
                              title={
                                onSelectPlayer && row.vice_captain?.id
                                  ? `Lihat detail statistik ${row.vice_captain.name}`
                                  : undefined
                              }
                            >
                              <span className="bg-slate-300 text-slate-800 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
                                V
                              </span>
                              <span className="group-hover/vcap:text-purple-700 group-hover/vcap:underline">
                                {row.vice_captain.name}
                              </span>
                              <span className="text-[10px]">({row.vice_captain.club})</span>
                              <span className="font-semibold text-slate-600 text-[11px] ml-auto pl-2">
                                {row.vice_captain.points} pts
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

        {/* 1-Baris Gameweek Status sesuai Web Resmi FPL */}
        <div className="mt-2.5 px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-700">
              GW {selectedGW} status:
            </span>
            {gwEventStatus.status === 'Provisional' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Provisional
              </span>
            ) : gwEventStatus.status === 'Confirmed' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                Confirmed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Not started
              </span>
            )}
          </div>

          {gwEventStatus.days && gwEventStatus.days.length > 0 && (
            <button
              type="button"
              onClick={() => setShowStatusDetails(!showStatusDetails)}
              aria-label={showStatusDetails ? 'Tutup detail status' : 'Buka detail status'}
              title={showStatusDetails ? 'Tutup detail' : 'Buka detail'}
              className="p-1 rounded-lg text-slate-400 hover:text-purple-900 hover:bg-purple-50 flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showStatusDetails ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {/* Detail Hari jika dibuka */}
        {showStatusDetails && gwEventStatus.days && gwEventStatus.days.length > 0 && (
          <div className="mt-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 text-slate-700">
              <span className="font-extrabold text-[11px]">Gameweek {selectedGW} Status</span>
              <span className="text-[10px] text-slate-500">Official FPL Status</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {gwEventStatus.days.map((day, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-slate-200/80 text-[11px] shadow-2xs">
                  <span className="font-medium text-slate-700">{day.day_name}:</span>
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                    day.status === 'Provisional'
                      ? 'bg-amber-100 text-amber-800'
                      : day.status === 'Confirmed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {day.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )}

      {/* SUB TAB 2: Gameweek Champions (Full Season) */}
      {subTab === 'gw-champions' && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-[#37003c] text-white text-[10px] sm:text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  <th
                    className="py-2 px-1 sm:px-2 text-center w-12 sm:w-14 border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors leading-tight"
                    onClick={() => handleGwChampSort('event')}
                    title="Sort berdasarkan Gameweek"
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>GW</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>
                  <th className="py-2 px-1.5 sm:px-3 text-left border-b border-purple-900 leading-tight">
                    Team & Manager
                  </th>
                  <th className="py-2 px-1 text-center w-10 sm:w-14 border-b border-purple-900 leading-tight">
                    Rank
                  </th>
                  <th
                    className="py-2 px-1.5 sm:px-3 text-right w-12 sm:w-16 border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors leading-tight"
                    onClick={() => handleGwChampSort('points')}
                    title="Sort berdasarkan GW Poin"
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <div className="flex flex-col leading-tight items-end">
                        <span>GW</span>
                        <span>Pts</span>
                      </div>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedGameweekChampions.map((item) => (
                  <tr key={item.event} className="hover:bg-purple-50/40 transition-colors border-b border-slate-200">
                    <td className="py-2 px-1 text-center whitespace-nowrap border-b border-slate-200">
                      <div className="flex flex-col items-center justify-center gap-0.5">
                        <span className="inline-flex items-center justify-center font-black text-[11px] sm:text-xs bg-purple-100 text-[#37003c] px-1 sm:px-1.5 py-0.5 rounded border border-purple-200/80">
                          GW {item.event}
                        </span>
                        {item.is_finished === false && (
                          <span className="inline-flex items-center gap-0.5 font-black text-[8px] sm:text-[9px] bg-rose-50 text-rose-700 border border-rose-200 px-1 sm:px-1.5 py-0.2 rounded-full animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                            Live
                          </span>
                        )}
                      </div>
                      {item.champions.length > 1 && (
                        <span className="mt-0.5 block text-[8px] sm:text-[9px] font-extrabold text-amber-700 bg-amber-50 border border-amber-200/80 px-1 py-0.2 rounded text-center whitespace-nowrap">
                          ({item.champions.length} Teams)
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-1.5 sm:px-3 border-b border-slate-200">
                      <div className="flex flex-col gap-1.5">
                        {item.champions.map((champ, cIdx) => (
                          <div
                            key={cIdx}
                            onClick={() => onSelectManager(champ.entry_id, item.event)}
                            className="flex items-center gap-1 sm:gap-1.5 cursor-pointer group min-w-0"
                          >
                            <Trophy className="w-3 h-3 text-amber-500 shrink-0 hidden xs:block" />
                            <div className="min-w-0 leading-tight">
                              <p className="font-extrabold text-slate-900 text-[11px] sm:text-xs group-hover:text-[#37003c] transition-colors truncate max-w-[120px] xs:max-w-[150px] sm:max-w-none">
                                {champ.entry_name}
                              </p>
                              <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium truncate max-w-[120px] xs:max-w-[150px] sm:max-w-none">
                                {champ.player_name}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-1 text-center whitespace-nowrap border-b border-slate-200">
                      <div className="flex flex-col gap-1.5 justify-center">
                        {item.champions.map((champ, cIdx) => (
                          <div key={cIdx} className="flex flex-col items-center justify-center">
                            <div className="flex items-baseline justify-center gap-0.5">
                              <span className="font-extrabold text-[11px] sm:text-xs text-slate-800">
                                {champ.rank_at_gw}
                              </span>
                              {champ.last_rank_at_gw !== null && champ.last_rank_at_gw !== undefined && (
                                <span className="text-[9px] sm:text-[10px] text-slate-400 font-semibold tracking-tighter">
                                  ({champ.last_rank_at_gw})
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5">
                              {champ.rank_change_at_gw !== undefined && champ.rank_change_at_gw > 0 ? (
                                <span className="text-[8px] sm:text-[9px] font-extrabold text-emerald-600 flex items-center justify-center leading-none">
                                  ▲{champ.rank_change_at_gw}
                                </span>
                              ) : champ.rank_change_at_gw !== undefined && champ.rank_change_at_gw < 0 ? (
                                <span className="text-[8px] sm:text-[9px] font-extrabold text-rose-600 flex items-center justify-center leading-none">
                                  ▼{Math.abs(champ.rank_change_at_gw)}
                                </span>
                              ) : (
                                <span className="text-[8px] sm:text-[9px] text-slate-300 leading-none">-</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-1.5 sm:px-3 text-right whitespace-nowrap border-b border-slate-200">
                      <span className="font-black text-emerald-600 bg-emerald-50 border border-emerald-200/80 px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs whitespace-nowrap">
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
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-[#37003c] text-white text-[10px] sm:text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  <th className="py-2 px-1 sm:px-2 text-center w-10 sm:w-12 border-b border-purple-900 leading-tight">
                    #
                  </th>
                  <th className="py-2 px-1.5 sm:px-2 border-b border-purple-900 text-left leading-tight">
                    Team & Manager
                  </th>
                  <th className="py-2 px-1 sm:px-2 text-center w-10 sm:w-12 border-b border-purple-900 leading-tight">
                    Wins
                  </th>
                  <th className="py-2 px-1.5 sm:px-2 text-right border-b border-purple-900 leading-tight">
                    GW
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
                        className={`transition-colors ${
                          entryId ? 'cursor-pointer hover:bg-purple-50/50' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Current Rank di Kolom Paling Kiri */}
                        <td className="py-2 px-1 sm:px-2 text-center whitespace-nowrap">
                          <span className="font-extrabold text-[11px] sm:text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80 inline-flex items-center justify-center min-w-[22px] sm:min-w-[26px]">
                            {lead.current_rank}
                          </span>
                        </td>

                        {/* Nama Tim dan Manager: Atas-Bawah */}
                        <td className="py-2 px-1.5 sm:px-2 border-b border-slate-100">
                          <div className="font-extrabold text-slate-900 text-[11px] sm:text-xs whitespace-nowrap leading-tight truncate max-w-[115px] xs:max-w-[145px] sm:max-w-none">
                            {lead.entry_name}
                          </div>
                          <div className="text-[10px] sm:text-[11px] font-medium text-slate-500 whitespace-nowrap leading-tight mt-0.5 truncate max-w-[115px] xs:max-w-[145px] sm:max-w-none">
                            {lead.player_name}
                          </div>
                        </td>

                        {/* Wins */}
                        <td className="py-2 px-1 sm:px-2 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center font-black text-[11px] sm:text-xs text-amber-800 bg-amber-100 border border-amber-300 px-1.5 sm:px-2 py-0.5 rounded">
                            {lead.win_count}
                          </span>
                        </td>

                        {/* GWs Won */}
                        <td className="py-2 px-1.5 sm:px-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1 flex-nowrap">
                            {lead.gws_won.map((gw, gIdx) => {
                              const isGwLive = liveGwEvents.has(gw);
                              return (
                                <div key={`${gw}-${gIdx}`} className="flex flex-col items-center justify-center shrink-0">
                                  <span className="bg-[#37003c] text-[#00ff87] text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">
                                    GW{gw}
                                  </span>
                                  {isGwLive && (
                                    <span className="inline-flex items-center gap-0.5 font-black text-[8px] bg-rose-50 text-rose-700 border border-rose-200 px-1 py-0.2 rounded-full animate-pulse mt-0.5">
                                      <span className="w-1 h-1 rounded-full bg-rose-600"></span>
                                      Live
                                    </span>
                                  )}
                                </div>
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

      {/* SUB TAB: Chart - Modern movement chart GW 1 to latest GW (Dev only) */}
      {import.meta.env.DEV && subTab === 'chart' && (
        <StandingsChart
          standings={standings}
          availableGWs={availableGWs}
          currentGW={currentGW}
          onSelectManager={onSelectManager}
          onSelectPlayer={onSelectPlayer}
        />
      )}

      {/* SUB TAB 4: Liga Minus - Fits horizontally on mobile screen without wrap */}
      {subTab === 'liga-minus' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          {ligaMinus.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              <p className="font-bold text-slate-700">No managers have taken transfer hits so far this season!</p>
              <p className="text-xs mt-1">Check back after the next gameweek deadline.</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                  <tr>
                    {/* # Column */}
                    <th className="py-2 px-1.5 text-center w-9 min-w-[36px] max-w-[36px] border-b border-purple-900 leading-tight">
                      #
                    </th>
                    {/* Manager & Team */}
                    <th className="py-2 px-2 sm:px-3 border-b border-purple-900 leading-tight">
                      Manager & Team
                    </th>
                    {/* Hits */}
                    <th className="py-2 px-2 text-right w-16 min-w-[64px] border-b border-purple-900 leading-tight">
                      Hits
                    </th>
                    {/* Last Rank */}
                    <th className="py-2 px-2 text-right w-16 min-w-[64px] border-b border-purple-900 leading-tight">
                      Last Rank
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
                      <td className="py-2 px-1.5 text-center whitespace-nowrap">
                        <span className="font-black text-slate-600 text-[11px] inline-flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-2 px-2 sm:px-3 whitespace-nowrap">
                        <p className="font-extrabold text-slate-900 text-xs whitespace-nowrap leading-tight">
                          {entry.entry_name}
                        </p>
                        <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium whitespace-nowrap leading-tight">
                          {entry.player_name}
                        </p>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <span className="font-black text-rose-700 bg-rose-50 border border-rose-200/80 px-1.5 py-0.5 rounded text-[11px] sm:text-xs whitespace-nowrap">
                          -{entry.total_minus_points}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <span className="font-extrabold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] whitespace-nowrap">
                          #{entry.current_rank}
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
