import React, { useState, useMemo } from 'react';
import {
  ArrowRightLeft,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Search,
  ChevronDown,
  Clock,
} from 'lucide-react';
import {
  TransferItem,
  MostTransferredItem,
  LigaMinusItem,
} from '../types.ts';

interface TabTransferProps {
  transfers: TransferItem[];
  mostTransferredIn: Record<string, MostTransferredItem[]>;
  mostTransferredOut: Record<string, MostTransferredItem[]>;
  ligaMinus: LigaMinusItem[];
  currentGW: number;
  availableGWs: number[];
  onSelectManager: (entryId: number) => void;
}

type TransferSubTab = 'all-transfers' | 'transferred-in' | 'transferred-out' | 'liga-minus';

export const TabTransfer: React.FC<TabTransferProps> = ({
  transfers,
  mostTransferredIn,
  mostTransferredOut,
  ligaMinus,
  currentGW,
  availableGWs,
  onSelectManager,
}) => {
  const [subTab, setSubTab] = useState<TransferSubTab>('all-transfers');

  // Filters for All Transfers
  const [transferGWFilter, setTransferGWFilter] = useState<string>('all');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filters for Transferred In / Out
  const [statGWFilter, setStatGWFilter] = useState<string>('all');

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

  const currentTransferredIn = mostTransferredIn[statGWFilter] || [];
  const currentTransferredOut = mostTransferredOut[statGWFilter] || [];

  return (
    <div className="space-y-2.5">
      {/* Minimalist Sub Tab Navigation - flush to top, no wrap, horizontal scrollable */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5">
        <button
          id="subtab-all-transfers"
          onClick={() => setSubTab('all-transfers')}
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
          onClick={() => setSubTab('transferred-in')}
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
          onClick={() => setSubTab('transferred-out')}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'transferred-out'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <UserMinus className="w-3.5 h-3.5 text-rose-500" />
          <span>Most Transferred Out</span>
        </button>
        <button
          id="subtab-liga-minus"
          onClick={() => setSubTab('liga-minus')}
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
                  className="appearance-none bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-3 pr-8 shadow-xs"
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

              {/* Team Filter */}
              <div className="relative max-w-44">
                <select
                  id="transfer-team-filter"
                  value={selectedTeamFilter}
                  onChange={(e) => setSelectedTeamFilter(e.target.value)}
                  className="appearance-none w-full bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-3 pr-8 shadow-xs truncate"
                >
                  <option value="all">All Teams (50)</option>
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
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#37003c] text-slate-800"
              />
            </div>
          </div>

          {/* Transfers Table directly below filter */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold">
                <tr>
                  <th className="py-3 px-3 w-28">Time (WIB)</th>
                  <th className="py-3 px-3 w-16 text-center">GW</th>
                  <th className="py-3 px-3">Manager & Team</th>
                  <th className="py-3 px-3">Transferred In</th>
                  <th className="py-3 px-3">Transferred Out</th>
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
                    <tr key={idx} className="hover:bg-purple-50/30 transition-colors">
                      {/* Time WIB */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>
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

                      {/* GW */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="bg-purple-100 text-[#37003c] font-black text-xs px-2 py-0.5 rounded">
                          GW{t.event}
                        </span>
                      </td>

                      {/* Manager & Team */}
                      <td className="py-3 px-3">
                        <div
                          className="cursor-pointer hover:text-[#37003c]"
                          onClick={() => onSelectManager(t.entry_id)}
                        >
                          <p className="font-extrabold text-slate-900 text-xs">
                            {t.entry_name}
                          </p>
                          <p className="text-[11px] text-slate-500">{t.player_name}</p>
                        </div>
                      </td>

                      {/* In */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="bg-emerald-100 text-emerald-800 font-bold p-1 rounded-full">
                            <UserPlus className="w-3 h-3" />
                          </span>
                          <div>
                            <p className="font-black text-emerald-950 text-xs">
                              {t.element_in.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {t.element_in.position} • {t.element_in.club} • £{(t.element_in.cost / 10).toFixed(1)}m
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Out */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="bg-rose-100 text-rose-800 font-bold p-1 rounded-full">
                            <UserMinus className="w-3 h-3" />
                          </span>
                          <div>
                            <p className="font-black text-rose-950 text-xs">
                              {t.element_out.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {t.element_out.position} • {t.element_out.club} • £{(t.element_out.cost / 10).toFixed(1)}m
                            </p>
                          </div>
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
          {/* Direct Filter Row below sub tab */}
          <div className="flex items-center gap-2 py-0.5">
            <div className="relative">
              <select
                id="stat-in-gw-select"
                value={statGWFilter}
                onChange={(e) => setStatGWFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
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
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold">
                  <tr>
                    <th className="py-3 px-4 w-16">Rank</th>
                    <th className="py-3 px-4">Player</th>
                    <th className="py-3 px-4">Club</th>
                    <th className="py-3 px-4 text-center">Pos</th>
                    <th className="py-3 px-4 text-right">Cost</th>
                    <th className="py-3 px-4 text-right">Season Pts</th>
                    <th className="py-3 px-4 text-right">Transfers In</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentTransferredIn.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-purple-50/30 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-500">{idx + 1}</span>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-black text-slate-900 text-xs sm:text-sm">
                          {item.web_name}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          {item.team_short_name}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span className="font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded">
                          {item.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap font-mono">
                        £{(item.now_cost / 10).toFixed(1)}m
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap font-black text-slate-900">
                        {item.total_points}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className="font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs">
                          +{item.transfer_count} In
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* SUB TAB 3: Most Transferred Out */}
      {subTab === 'transferred-out' && (
        <>
          {/* Direct Filter Row below sub tab */}
          <div className="flex items-center gap-2 py-0.5">
            <div className="relative">
              <select
                id="stat-out-gw-select"
                value={statGWFilter}
                onChange={(e) => setStatGWFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
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
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold">
                  <tr>
                    <th className="py-3 px-4 w-16">Rank</th>
                    <th className="py-3 px-4">Player</th>
                    <th className="py-3 px-4">Club</th>
                    <th className="py-3 px-4 text-center">Pos</th>
                    <th className="py-3 px-4 text-right">Cost</th>
                    <th className="py-3 px-4 text-right">Season Pts</th>
                    <th className="py-3 px-4 text-right">Transfers Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentTransferredOut.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-purple-50/30 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-500">{idx + 1}</span>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-black text-slate-900 text-xs sm:text-sm">
                          {item.web_name}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          {item.team_short_name}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span className="font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded">
                          {item.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap font-mono">
                        £{(item.now_cost / 10).toFixed(1)}m
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap font-black text-slate-900">
                        {item.total_points}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className="font-black text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg text-xs">
                          -{item.transfer_count} Out
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* SUB TAB 4: Liga Minus */}
      {subTab === 'liga-minus' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {ligaMinus.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              <p className="font-bold text-slate-700">No managers have taken transfer hits so far this season!</p>
              <p className="text-xs mt-1">Check back after the next gameweek deadline.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold">
                  <tr>
                    <th className="py-3 px-4 w-20">Position</th>
                    <th className="py-3 px-4">Manager & Team</th>
                    <th className="py-3 px-4 text-right">Points Sacrificed</th>
                    <th className="py-3 px-4 text-right">Current Mini League Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ligaMinus.map((entry, idx) => (
                    <tr
                      key={entry.entry_id}
                      onClick={() => onSelectManager(entry.entry_id)}
                      className="hover:bg-purple-50/30 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-black text-slate-700 text-xs bg-slate-100 w-6 h-6 rounded flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-extrabold text-slate-900 text-xs sm:text-sm">
                          {entry.entry_name}
                        </p>
                        <p className="text-[11px] text-slate-500 font-medium">
                          {entry.player_name}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="font-black text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1 rounded-lg text-sm sm:text-base">
                          -{entry.total_minus_points} pts
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="font-extrabold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md text-xs">
                          Rank {entry.current_rank}
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
