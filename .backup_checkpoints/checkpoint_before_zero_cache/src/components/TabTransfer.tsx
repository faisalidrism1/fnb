import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowRightLeft,
  UserPlus,
  UserMinus,
  Search,
  ChevronDown,
  Clock,
} from 'lucide-react';
import {
  TransferItem,
  MostTransferredItem,
} from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';

interface TabTransferProps {
  transfers: TransferItem[];
  mostTransferredIn: Record<string, MostTransferredItem[]>;
  mostTransferredOut: Record<string, MostTransferredItem[]>;
  currentGW: number;
  availableGWs: number[];
  onSelectManager: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
}

type TransferSubTab = 'all-transfers' | 'transferred-in' | 'transferred-out';

export const TabTransfer: React.FC<TabTransferProps> = ({
  transfers,
  mostTransferredIn,
  mostTransferredOut,
  currentGW,
  availableGWs,
  onSelectManager,
  onSelectPlayer,
}) => {
  const [subTab, setSubTab] = useState<TransferSubTab>('all-transfers');
  const subTabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!subTabsRef.current) return;
    const activeBtn = subTabsRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(subTabsRef.current, activeBtn);
    }
  }, [subTab]);

  // Filters for All Transfers
  const [transferGWFilter, setTransferGWFilter] = useState<string>('all');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Default statGWFilter to the latest available gameweek
  const latestGWStr = availableGWs.length > 0 ? String(Math.max(...availableGWs)) : 'all';
  const [statGWFilter, setStatGWFilter] = useState<string>(latestGWStr);

  // Filters for Transferred In / Out: Club and Pos
  const [statClubFilter, setStatClubFilter] = useState<string>('all');
  const [statPosFilter, setStatPosFilter] = useState<string>('all');

  // Unique clubs derived from all transfers in/out
  const availableClubs = useMemo(() => {
    const clubs = new Set<string>();
    (Object.values(mostTransferredIn) as MostTransferredItem[][]).forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((item) => {
          if (item.team_short_name) clubs.add(item.team_short_name);
        });
      }
    });
    (Object.values(mostTransferredOut) as MostTransferredItem[][]).forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((item) => {
          if (item.team_short_name) clubs.add(item.team_short_name);
        });
      }
    });
    return Array.from(clubs).sort();
  }, [mostTransferredIn, mostTransferredOut]);

  // Unique teams list for filter dropdown
  const uniqueTeams = useMemo(() => {
    const map = new Map<number, string>();
    transfers.forEach((t) => {
      map.set(t.entry_id, t.entry_name);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [transfers]);

  // Filtered All Transfers
  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      // GW filter
      if (transferGWFilter !== 'all' && t.event !== Number(transferGWFilter)) {
        return false;
      }
      // Team filter
      if (selectedTeamFilter !== 'all' && t.entry_id !== Number(selectedTeamFilter)) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inMatch =
          t.element_in.name.toLowerCase().includes(q) ||
          t.element_in.club.toLowerCase().includes(q);
        const outMatch =
          t.element_out.name.toLowerCase().includes(q) ||
          t.element_out.club.toLowerCase().includes(q);
        const teamMatch =
          t.entry_name.toLowerCase().includes(q) ||
          t.player_name.toLowerCase().includes(q);
        return inMatch || outMatch || teamMatch;
      }
      return true;
    });
  }, [transfers, transferGWFilter, selectedTeamFilter, searchQuery]);

  // Filtered Most Transferred In
  const currentTransferredIn = useMemo(() => {
    const raw = mostTransferredIn[statGWFilter] || [];
    return raw.filter((item) => {
      if (statClubFilter !== 'all' && item.team_short_name !== statClubFilter) {
        return false;
      }
      if (statPosFilter !== 'all' && item.position !== statPosFilter) {
        return false;
      }
      return true;
    });
  }, [mostTransferredIn, statGWFilter, statClubFilter, statPosFilter]);

  // Filtered Most Transferred Out
  const currentTransferredOut = useMemo(() => {
    const raw = mostTransferredOut[statGWFilter] || [];
    return raw.filter((item) => {
      if (statClubFilter !== 'all' && item.team_short_name !== statClubFilter) {
        return false;
      }
      if (statPosFilter !== 'all' && item.position !== statPosFilter) {
        return false;
      }
      return true;
    });
  }, [mostTransferredOut, statGWFilter, statClubFilter, statPosFilter]);

  return (
    <div className="space-y-2.5">
      {/* Minimalist Sub Tab Navigation - flush to top, no wrap, horizontal scrollable */}
      <div
        ref={subTabsRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5 scroll-smooth"
      >
        <button
          id="subtab-all-transfers"
          data-active={subTab === 'all-transfers' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('all-transfers');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'all-transfers'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>All Transfers</span>
        </button>
        <button
          id="subtab-transferred-in"
          data-active={subTab === 'transferred-in' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('transferred-in');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'transferred-in'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5 text-emerald-500" />
          <span>Most Transferred In</span>
        </button>
        <button
          id="subtab-transferred-out"
          data-active={subTab === 'transferred-out' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('transferred-out');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'transferred-out'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <UserMinus className="w-3.5 h-3.5 text-rose-500" />
          <span>Most Transferred Out</span>
        </button>
      </div>

      {/* SUB TAB 1: All Transfers */}
      {subTab === 'all-transfers' && (
        <>
          {/* Filters directly below sub tab */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 py-0.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* GW Filter */}
              <div className="relative">
                <select
                  id="transfer-gw-filter"
                  value={transferGWFilter}
                  onChange={(e) => setTransferGWFilter(e.target.value)}
                  className="appearance-none bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-3 pr-8 shadow-2xs"
                >
                  <option value="all">All GWs</option>
                  {availableGWs.map((gw) => (
                    <option key={gw} value={String(gw)}>
                      GW {gw}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Team Filter: renamed to "All Teams" per prompt */}
              <div className="relative max-w-44">
                <select
                  id="transfer-team-filter"
                  value={selectedTeamFilter}
                  onChange={(e) => setSelectedTeamFilter(e.target.value)}
                  className="appearance-none w-full bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-3 pr-8 shadow-2xs truncate"
                >
                  <option value="all">All Teams</option>
                  {uniqueTeams.map(([id, name]) => (
                    <option key={id} value={String(id)}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="search-transfers-input"
                placeholder="Search player or club..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#37003c] text-slate-800 shadow-2xs"
              />
            </div>
          </div>

          {/* Transfers Table directly below filter - Slim & Frozen Team & Manager Column */}
          {/* Requested column order: Team & Manager, Player In, Player Out, GW, Time (WIB) */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
                <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                  <tr>
                    {/* 1. Frozen Team & Manager */}
                    <th className="sticky left-0 z-30 bg-[#37003c] py-2 px-3 border-b border-purple-900 border-r border-purple-900/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] leading-tight">
                      Team & Manager
                    </th>
                    {/* 2. Player In */}
                    <th className="py-2 px-2.5 border-b border-purple-900 leading-tight">
                      Player In
                    </th>
                    {/* 3. Player Out */}
                    <th className="py-2 px-2.5 border-b border-purple-900 leading-tight">
                      Player Out
                    </th>
                    {/* 4. GW */}
                    <th className="py-2 px-2 text-center border-b border-purple-900 w-14 min-w-[56px] leading-tight">
                      GW
                    </th>
                    {/* 5. Time (WIB) */}
                    <th className="py-2 px-2.5 border-b border-purple-900 w-32 min-w-[120px] leading-tight">
                      Time (WIB)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransfers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 font-medium">
                        No transfers matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredTransfers.slice(0, 100).map((t, idx) => (
                      <tr key={idx} className="hover:bg-purple-50/30 transition-colors group">
                        {/* 1. Frozen Team & Manager - Without text wrap */}
                        <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-3 whitespace-nowrap border-r border-slate-200/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                          <div
                            className="cursor-pointer hover:text-[#37003c] whitespace-nowrap"
                            onClick={() => onSelectManager(t.entry_id, t.event)}
                          >
                            <p className="font-extrabold text-slate-900 text-xs whitespace-nowrap leading-tight">
                              {t.entry_name}
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium whitespace-nowrap leading-tight">
                              {t.player_name}
                            </p>
                          </div>
                        </td>

                        {/* 2. Player In - Without text wrap */}
                        <td
                          onClick={() => {
                            if (onSelectPlayer && t.element_in?.id) {
                              onSelectPlayer(t.element_in.id, t.event);
                            }
                          }}
                          className={`py-2 px-2.5 whitespace-nowrap ${
                            onSelectPlayer && t.element_in?.id
                              ? 'cursor-pointer hover:bg-emerald-50/60 transition-colors group/pin'
                              : ''
                          }`}
                          title={
                            onSelectPlayer && t.element_in?.id
                              ? `Klik untuk melihat detail ${t.element_in.name}`
                              : undefined
                          }
                        >
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="bg-emerald-100 text-emerald-800 font-bold p-1 rounded-full shrink-0 group-hover/pin:bg-emerald-200">
                              <UserPlus className="w-3 h-3" />
                            </span>
                            <div className="whitespace-nowrap leading-tight">
                              <p className="font-black text-emerald-950 text-xs whitespace-nowrap group-hover/pin:text-emerald-700 group-hover/pin:underline">
                                {t.element_in.name}
                              </p>
                              <p className="text-[10px] text-slate-500 whitespace-nowrap font-medium">
                                {t.element_in.position} • {t.element_in.club} • £{(t.element_in.cost / 10).toFixed(1)}m
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* 3. Player Out - Without text wrap */}
                        <td
                          onClick={() => {
                            if (onSelectPlayer && t.element_out?.id) {
                              onSelectPlayer(t.element_out.id, t.event);
                            }
                          }}
                          className={`py-2 px-2.5 whitespace-nowrap ${
                            onSelectPlayer && t.element_out?.id
                              ? 'cursor-pointer hover:bg-rose-50/60 transition-colors group/pout'
                              : ''
                          }`}
                          title={
                            onSelectPlayer && t.element_out?.id
                              ? `Klik untuk melihat detail ${t.element_out.name}`
                              : undefined
                          }
                        >
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="bg-rose-100 text-rose-800 font-bold p-1 rounded-full shrink-0 group-hover/pout:bg-rose-200">
                              <UserMinus className="w-3 h-3" />
                            </span>
                            <div className="whitespace-nowrap leading-tight">
                              <p className="font-black text-rose-950 text-xs whitespace-nowrap group-hover/pout:text-rose-700 group-hover/pout:underline">
                                {t.element_out.name}
                              </p>
                              <p className="text-[10px] text-slate-500 whitespace-nowrap font-medium">
                                {t.element_out.position} • {t.element_out.club} • £{(t.element_out.cost / 10).toFixed(1)}m
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* 4. GW */}
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span className="bg-purple-100 text-[#37003c] font-black text-xs px-2 py-0.5 rounded">
                            GW{t.event}
                          </span>
                        </td>

                        {/* 5. Time (WIB) */}
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] whitespace-nowrap">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="whitespace-nowrap">
                              {t.formatted_time_wib ||
                                new Date(t.time).toLocaleDateString('id-ID', {
                                  timeZone: 'Asia/Jakarta',
                                  day: 'numeric',
                                  month: 'short',
                                }) +
                                  ' ' +
                                  new Date(t.time).toLocaleTimeString('id-ID', {
                                    timeZone: 'Asia/Jakarta',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }) +
                                  ' WIB'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* SUB TAB 2: Most Transferred In */}
      {subTab === 'transferred-in' && (
        <>
          {/* Direct Filter Row: GW, Club, and Pos filters */}
          <div className="flex flex-wrap items-center gap-2 py-0.5">
            {/* Gameweek Filter */}
            <div className="relative">
              <select
                id="stat-in-gw-select"
                value={statGWFilter}
                onChange={(e) => setStatGWFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All GWs</option>
                {availableGWs.map((gw) => (
                  <option key={gw} value={String(gw)}>
                    GW {gw} {gw === currentGW ? '(Current)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Club Filter */}
            <div className="relative">
              <select
                id="stat-in-club-select"
                value={statClubFilter}
                onChange={(e) => setStatClubFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All Club</option>
                {availableClubs.map((club) => (
                  <option key={club} value={club}>
                    {club}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Pos Filter */}
            <div className="relative">
              <select
                id="stat-in-pos-select"
                value={statPosFilter}
                onChange={(e) => setStatPosFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All Pos</option>
                <option value="GKP">GKP</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
                <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                  <tr>
                    {/* Frozen # Column */}
                    <th className="sticky left-0 z-30 bg-[#37003c] py-2 px-1 text-center w-10 min-w-[40px] max-w-[40px] border-b border-purple-900 border-r border-purple-900/60 leading-tight">
                      #
                    </th>
                    {/* Frozen Player Column */}
                    <th className="sticky left-[40px] z-30 bg-[#37003c] py-2 px-3 border-b border-purple-900 border-r border-purple-900/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] leading-tight">
                      Player
                    </th>
                    <th className="py-2 px-2.5 border-b border-purple-900 text-center leading-tight">Club</th>
                    <th className="py-2 px-2 text-center border-b border-purple-900 leading-tight">Pos</th>
                    <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">Cost</th>
                    <th className="py-2 px-2 text-right border-b border-purple-900 leading-tight">GW Pts</th>
                    <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">Total Pts</th>
                    <th className="py-2 px-3 text-right border-b border-purple-900 leading-tight">In</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentTransferredIn.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 font-medium">
                        No players found matching the filters.
                      </td>
                    </tr>
                  ) : (
                    currentTransferredIn.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-purple-50/30 transition-colors group">
                        {/* Frozen # Column */}
                        <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-1 text-center border-r border-slate-100 w-10 min-w-[40px] max-w-[40px]">
                          <span className="font-bold text-slate-500">{idx + 1}</span>
                        </td>
                        {/* Frozen Player Column */}
                        <td
                          onClick={() => {
                            if (onSelectPlayer) {
                              const targetGw = statGWFilter === 'all' ? currentGW : Number(statGWFilter);
                              onSelectPlayer(item.id, targetGw);
                            }
                          }}
                          className={`sticky left-[40px] z-20 bg-white group-hover:bg-purple-100/70 py-2 px-3 whitespace-nowrap border-r border-slate-200/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] transition-colors ${
                            onSelectPlayer ? 'cursor-pointer' : ''
                          }`}
                          title={onSelectPlayer ? `Klik untuk melihat detail ${item.web_name}` : undefined}
                        >
                          <p className="font-black text-slate-900 group-hover:text-purple-900 group-hover:underline text-xs whitespace-nowrap">
                            {item.web_name}
                          </p>
                        </td>
                        <td className="py-2 px-2.5 text-center whitespace-nowrap">
                          <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px] whitespace-nowrap">
                            {item.team_short_name}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span className="font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">
                            {item.position}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap font-mono">
                          £{(item.now_cost / 10).toFixed(1)}m
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <span className="font-extrabold text-purple-900 bg-purple-50 border border-purple-200/70 px-1.5 py-0.5 rounded text-[11px]">
                            {item.gw_points ?? 0}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap font-black text-slate-900">
                          {item.total_points}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <span className="font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-xs whitespace-nowrap">
                            +{item.transfer_count} In
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* SUB TAB 3: Most Transferred Out */}
      {subTab === 'transferred-out' && (
        <>
          {/* Direct Filter Row: GW, Club, and Pos filters */}
          <div className="flex flex-wrap items-center gap-2 py-0.5">
            {/* Gameweek Filter */}
            <div className="relative">
              <select
                id="stat-out-gw-select"
                value={statGWFilter}
                onChange={(e) => setStatGWFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All GWs</option>
                {availableGWs.map((gw) => (
                  <option key={gw} value={String(gw)}>
                    GW {gw} {gw === currentGW ? '(Current)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Club Filter */}
            <div className="relative">
              <select
                id="stat-out-club-select"
                value={statClubFilter}
                onChange={(e) => setStatClubFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All Club</option>
                {availableClubs.map((club) => (
                  <option key={club} value={club}>
                    {club}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Pos Filter */}
            <div className="relative">
              <select
                id="stat-out-pos-select"
                value={statPosFilter}
                onChange={(e) => setStatPosFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">All Pos</option>
                <option value="GKP">GKP</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
                <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                  <tr>
                    {/* Frozen # Column */}
                    <th className="sticky left-0 z-30 bg-[#37003c] py-2 px-1 text-center w-10 min-w-[40px] max-w-[40px] border-b border-purple-900 border-r border-purple-900/60 leading-tight">
                      #
                    </th>
                    {/* Frozen Player Column */}
                    <th className="sticky left-[40px] z-30 bg-[#37003c] py-2 px-3 border-b border-purple-900 border-r border-purple-900/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] leading-tight">
                      Player
                    </th>
                    <th className="py-2 px-2.5 border-b border-purple-900 text-center leading-tight">Club</th>
                    <th className="py-2 px-2 text-center border-b border-purple-900 leading-tight">Pos</th>
                    <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">Cost</th>
                    <th className="py-2 px-2 text-right border-b border-purple-900 leading-tight">GW Pts</th>
                    <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">Total Pts</th>
                    <th className="py-2 px-3 text-right border-b border-purple-900 leading-tight">Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentTransferredOut.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 font-medium">
                        No players found matching the filters.
                      </td>
                    </tr>
                  ) : (
                    currentTransferredOut.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-purple-50/30 transition-colors group">
                        {/* Frozen # Column */}
                        <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-1 text-center border-r border-slate-100 w-10 min-w-[40px] max-w-[40px]">
                          <span className="font-bold text-slate-500">{idx + 1}</span>
                        </td>
                        {/* Frozen Player Column */}
                        <td
                          onClick={() => {
                            if (onSelectPlayer) {
                              const targetGw = statGWFilter === 'all' ? currentGW : Number(statGWFilter);
                              onSelectPlayer(item.id, targetGw);
                            }
                          }}
                          className={`sticky left-[40px] z-20 bg-white group-hover:bg-purple-100/70 py-2 px-3 whitespace-nowrap border-r border-slate-200/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] transition-colors ${
                            onSelectPlayer ? 'cursor-pointer' : ''
                          }`}
                          title={onSelectPlayer ? `Klik untuk melihat detail ${item.web_name}` : undefined}
                        >
                          <p className="font-black text-slate-900 group-hover:text-purple-900 group-hover:underline text-xs whitespace-nowrap">
                            {item.web_name}
                          </p>
                        </td>
                        <td className="py-2 px-2.5 text-center whitespace-nowrap">
                          <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px] whitespace-nowrap">
                            {item.team_short_name}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center whitespace-nowrap">
                          <span className="font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">
                            {item.position}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap font-mono">
                          £{(item.now_cost / 10).toFixed(1)}m
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <span className="font-extrabold text-purple-900 bg-purple-50 border border-purple-200/70 px-1.5 py-0.5 rounded text-[11px]">
                            {item.gw_points ?? 0}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right whitespace-nowrap font-black text-slate-900">
                          {item.total_points}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <span className="font-black text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md text-xs whitespace-nowrap">
                            -{item.transfer_count} Out
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
