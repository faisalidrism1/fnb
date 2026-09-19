import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { StandingsRow, GWChampionRow, MostGWChampionLeader } from '../types.ts';

interface TabStandingsProps {
  standings: Record<number, StandingsRow[]>;
  gameweekChampions: GWChampionRow[];
  mostGameweekChampions: MostGWChampionLeader[];
  currentGW: number;
  availableGWs: number[];
  selectedGW: number;
  onSelectGW: (gw: number) => void;
  onSelectManager: (entryId: number) => void;
}

type StandingsSubTab = 'live-table' | 'gw-champions' | 'most-gw-champions';

type SortField = 'rank' | 'entry_name' | 'total_points' | 'event_points' | 'event_transfers_cost';
type SortOrder = 'asc' | 'desc';

export const TabStandings: React.FC<TabStandingsProps> = ({
  standings,
  gameweekChampions,
  mostGameweekChampions,
  currentGW,
  availableGWs,
  selectedGW,
  onSelectGW,
  onSelectManager,
}) => {
  const [subTab, setSubTab] = useState<StandingsSubTab>('live-table');
  const [searchQuery, setSearchQuery] = useState('');
  
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
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5">
        <button
          id="subtab-live-table"
          onClick={() => setSubTab('live-table')}
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
          onClick={() => setSubTab('gw-champions')}
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
          onClick={() => setSubTab('most-gw-champions')}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-gw-champions'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Medal className="w-3.5 h-3.5 text-emerald-600" />
          <span>Most GW Champions</span>
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
                onChange={(e) => onSelectGW(Number(e.target.value))}
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
              <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold select-none">
                <tr>
                  {/* Frozen Rank Column - Slim & Minimalist */}
                  <th
                    className="sticky left-0 z-30 bg-[#37003c] py-2 px-1 text-center cursor-pointer hover:bg-purple-950 transition-colors w-14 min-w-[56px] max-w-[56px] border-b border-purple-900"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>#</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Frozen Team & Manager Column - Seamless with table */}
                  <th
                    className="sticky left-[56px] z-30 bg-[#37003c] py-2 px-2.5 cursor-pointer hover:bg-purple-950 transition-colors whitespace-nowrap border-b border-purple-900 border-r border-purple-900/40"
                    onClick={() => handleSort('entry_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Team & Manager</span>
                      <ArrowUpDown className="w-3 h-3 text-purple-300" />
                    </div>
                  </th>

                  {/* Total Points - Wrapped header */}
                  <th
                    className="py-1.5 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-12"
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
                    className="py-1.5 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-11"
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
                    className="py-2 px-2 text-right cursor-pointer hover:bg-purple-950 transition-colors whitespace-nowrap border-b border-purple-900"
                    onClick={() => handleSort('event_transfers_cost')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Hits</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                    </div>
                  </th>

                  {/* Chip */}
                  <th className="py-2 px-2 text-center whitespace-nowrap border-b border-purple-900">
                    Chip
                  </th>

                  {/* Captain & Vice Captain */}
                  <th className="py-2 px-2.5 whitespace-nowrap border-b border-purple-900">
                    Captain & Vice
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedRows.map((row) => {
                  return (
                    <tr
                      key={row.entry_id}
                      className="group hover:bg-purple-50/50 transition-colors cursor-pointer"
                      onClick={() => onSelectManager(row.entry_id)}
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
                            <div className="flex items-center gap-1.5">
                              <span className="bg-black text-[#00ff87] text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
                                C
                              </span>
                              <span className="font-bold text-slate-800 text-xs">
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
                            <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                              <span className="bg-slate-300 text-slate-800 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
                                V
                              </span>
                              <span>{row.vice_captain.name}</span>
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
      </>
    )}

      {/* SUB TAB 2: Gameweek Champions (Full Season) */}
      {subTab === 'gw-champions' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
              <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold select-none">
                <tr>
                  <th
                    className="py-2 px-1.5 text-center w-14 min-w-[52px] whitespace-nowrap border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors"
                    onClick={() => handleGwChampSort('event')}
                    title="Sort berdasarkan Gameweek"
                  >
                    <div className="flex items-center justify-center gap-0.5">
                      <span>GW</span>
                      <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                    </div>
                  </th>
                  <th className="py-2 px-2.5 whitespace-nowrap border-b border-purple-900">
                    Team & Manager
                  </th>
                  <th className="py-2 px-1.5 text-center w-14 min-w-[52px] whitespace-nowrap border-b border-purple-900">
                    Rank
                  </th>
                  <th
                    className="py-1.5 px-2 text-right whitespace-nowrap w-16 min-w-[56px] border-b border-purple-900 cursor-pointer hover:bg-purple-950 transition-colors"
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
              <tbody className="divide-y divide-slate-100">
                {sortedGameweekChampions.map((item) => (
                  <tr key={item.event} className="hover:bg-purple-50/40 transition-colors">
                    <td className="py-2 px-1.5 text-center whitespace-nowrap">
                      <span className="inline-flex items-center justify-center font-black text-xs bg-purple-100 text-[#37003c] px-1.5 py-0.5 rounded border border-purple-200/80">
                        GW {item.event}
                      </span>
                      {item.champions.length > 1 && (
                        <span className="mt-1 block text-[9px] font-extrabold text-amber-700 bg-amber-50 border border-amber-200/80 px-1 py-0.5 rounded text-center">
                          Seri ({item.champions.length})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <div className="flex flex-col gap-2">
                        {item.champions.map((champ, cIdx) => (
                          <div
                            key={cIdx}
                            onClick={() => onSelectManager(champ.entry_id)}
                            className="inline-flex items-center gap-1.5 cursor-pointer group whitespace-nowrap h-8"
                          >
                            <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <div className="whitespace-nowrap leading-tight">
                              <p className="font-extrabold text-slate-900 text-xs group-hover:text-[#37003c] transition-colors whitespace-nowrap">
                                {champ.entry_name}
                              </p>
                              <p className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                                {champ.player_name}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-1.5 text-center whitespace-nowrap">
                      <div className="flex flex-col gap-2 justify-center">
                        {item.champions.map((champ, cIdx) => (
                          <div key={cIdx} className="flex flex-col items-center justify-center h-8">
                            <div className="flex items-baseline justify-center gap-0.5">
                              <span className="font-extrabold text-xs text-slate-800">
                                {champ.rank_at_gw}
                              </span>
                              {champ.last_rank_at_gw !== null && champ.last_rank_at_gw !== undefined && (
                                <span className="text-[10px] text-slate-400 font-semibold tracking-tighter">
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
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <span className="font-black text-emerald-600 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded text-xs">
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
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold select-none">
                <tr>
                  <th className="py-2.5 px-2 text-center w-12 min-w-[44px] whitespace-nowrap border-b border-purple-900">
                    Rank
                  </th>
                  <th className="py-2.5 px-2 whitespace-nowrap border-b border-purple-900">
                    Team & Manager
                  </th>
                  <th className="py-2.5 px-2 text-center w-12 min-w-[44px] whitespace-nowrap border-b border-purple-900">
                    Wins
                  </th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap border-b border-purple-900">
                    GWs Won
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
                      (s) => s.entry_name === lead.entry_name || s.player_name === lead.player_name
                    );
                    const entryId = lead.entry_id || standing?.entry_id;

                    return (
                      <tr
                        key={idx}
                        onClick={() => entryId && onSelectManager(entryId)}
                        className={`transition-colors ${
                          entryId ? 'cursor-pointer hover:bg-purple-50/50' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {/* Current Rank di Kolom Paling Kiri */}
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span className="font-extrabold text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80 inline-flex items-center justify-center min-w-[26px]">
                            {lead.current_rank}
                          </span>
                        </td>

                        {/* Nama Tim dan Manager: Atas-Bawah, masing-masing 1 baris tanpa wrap text */}
                        <td className="py-2 px-2 whitespace-nowrap">
                          <div className="font-extrabold text-slate-900 text-xs whitespace-nowrap leading-tight">
                            {lead.entry_name}
                          </div>
                          <div className="text-[10px] sm:text-[11px] font-medium text-slate-500 whitespace-nowrap leading-tight mt-0.5">
                            {lead.player_name}
                          </div>
                        </td>

                        {/* Wins */}
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span className="inline-flex items-center justify-center font-black text-xs text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded">
                            {lead.win_count}
                          </span>
                        </td>

                        {/* GWs Won */}
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1 flex-nowrap">
                            {lead.gws_won.map((gw) => (
                              <span
                                key={gw}
                                className="bg-[#37003c] text-[#00ff87] text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                              >
                                GW{gw}
                              </span>
                            ))}
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
    </div>
  );
};
