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
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';

interface TabTransferProps {
  transfers: TransferItem[];
  mostTransferredIn: Record<string, MostTransferredItem[]>;
  mostTransferredOut: Record<string, MostTransferredItem[]>;
  ownershipPlayers?: Record<number, any[]>;
  currentGW: number;
  availableGWs: number[];
  onSelectManager: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  subTab?: TransferSubTab;
  onSelectSubTab?: (subTab: TransferSubTab) => void;
}

export type { TransferSubTab };

type TransferSubTab = 'all-transfers' | 'transferred-in' | 'transferred-out';

export const TabTransfer: React.FC<TabTransferProps> = ({
  transfers,
  mostTransferredIn,
  mostTransferredOut,
  ownershipPlayers,
  currentGW,
  availableGWs,
  onSelectManager,
  onSelectPlayer,
  subTab: propSubTab,
  onSelectSubTab,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<TransferSubTab>('all-transfers');
  const subTab = propSubTab !== undefined ? propSubTab : internalSubTab;
  const setSubTab = (val: TransferSubTab) => {
    if (onSelectSubTab) onSelectSubTab(val);
    else setInternalSubTab(val);
  };

  // Default filters to Current GW
  const currentGWStr = String(currentGW || (availableGWs.length > 0 ? Math.max(...availableGWs) : 'all'));

  // Filters for All Transfers
  const [transferGWFilter, setTransferGWFilter] = useState<string>(currentGWStr);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Default statGWFilter to the current / latest available gameweek
  const [statGWFilter, setStatGWFilter] = useState<string>(currentGWStr);

  // Sync default filter to currentGW when available
  useEffect(() => {
    if (currentGW) {
      const gStr = String(currentGW);
      setTransferGWFilter((prev) => (prev === 'all' || !prev ? gStr : prev));
      setStatGWFilter((prev) => (prev === 'all' || !prev ? gStr : prev));
    }
  }, [currentGW]);

  const getPlayerGWPoints = (elementId?: number, gw?: number, fallbackPts?: number): number => {
    if (typeof fallbackPts === 'number') return fallbackPts;
    if (!elementId || !gw || !ownershipPlayers || !ownershipPlayers[gw]) return 0;
    const p = ownershipPlayers[gw].find((x: any) => x.id === elementId);
    return typeof p?.gw_points === 'number' ? p.gw_points : 0;
  };

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
      {/* SUB TAB 1: All Transfers */}
      {subTab === 'all-transfers' && (
        <>
          {/* Filters directly below sub tab */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 py-0.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* GW Filter */}
              <CustomPopoverSelect
                id="transfer-gw-filter"
                value={transferGWFilter}
                onChange={(val) => setTransferGWFilter(String(val))}
                options={[
                  { value: 'all', label: 'Season' },
                  ...availableGWs.map((gw) => ({
                    value: String(gw),
                    label: `GW ${gw}`,
                    sublabel: gw === currentGW ? 'Current' : undefined,
                  })),
                ]}
              />

              {/* Team Filter: renamed to "All Teams" per prompt */}
              <CustomPopoverSelect
                id="transfer-team-filter"
                value={selectedTeamFilter}
                onChange={(val) => setSelectedTeamFilter(String(val))}
                className="bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 px-3 shadow-2xs flex items-center justify-between gap-1.5 cursor-pointer max-w-48 truncate"
                dropdownClassName="w-64"
                searchable={false}
                options={[
                  { value: 'all', label: 'All Teams' },
                  ...uniqueTeams.map(([id, name]) => ({
                    value: String(id),
                    label: name,
                  })),
                ]}
              />
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
                    {/* 4. In Pts */}
                    <th className="py-2 px-2 text-center border-b border-purple-900 w-16 min-w-[56px] whitespace-nowrap leading-tight">
                      In Pts
                    </th>
                    {/* 5. Out Pts */}
                    <th className="py-2 px-2 text-center border-b border-purple-900 w-16 min-w-[56px] whitespace-nowrap leading-tight">
                      Out Pts
                    </th>
                    {/* 6. Gap */}
                    <th className="py-2 px-2 text-center border-b border-purple-900 w-14 min-w-[52px] leading-tight">
                      Gap
                    </th>
                    {/* 7. GW */}
                    <th className="py-2 px-2 text-center border-b border-purple-900 w-14 min-w-[56px] leading-tight">
                      GW
                    </th>
                    {/* 8. Time (WIB) */}
                    <th className="py-2 px-2.5 border-b border-purple-900 w-32 min-w-[120px] leading-tight">
                      Time (WIB)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransfers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 font-medium">
                        No transfers matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredTransfers.slice(0, 100).map((t, idx) => {
                      const inPts = getPlayerGWPoints(t.element_in?.id, t.event, t.element_in?.gw_points);
                      const outPts = getPlayerGWPoints(t.element_out?.id, t.event, t.element_out?.gw_points);
                      const gap = inPts - outPts;

                      return (
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
                            <div className="whitespace-nowrap leading-tight">
                              <p className="font-extrabold text-emerald-600 dark:text-emerald-400 text-xs whitespace-nowrap group-hover/pin:underline">
                                {t.element_in.name}
                              </p>
                              <p className="text-[10px] text-slate-500 whitespace-nowrap font-medium">
                                {t.element_in.position ? `${t.element_in.position} • ` : ''}{t.element_in.club} • £{(t.element_in.cost / 10).toFixed(1)}m
                              </p>
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
                            <div className="whitespace-nowrap leading-tight">
                              <p className="font-extrabold text-rose-500 dark:text-rose-400 text-xs whitespace-nowrap group-hover/pout:underline">
                                {t.element_out.name}
                              </p>
                              <p className="text-[10px] text-slate-500 whitespace-nowrap font-medium">
                                {t.element_out.position ? `${t.element_out.position} • ` : ''}{t.element_out.club} • £{(t.element_out.cost / 10).toFixed(1)}m
                              </p>
                            </div>
                          </td>

                          {/* 4. In Pts */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <span className="font-black text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded">
                              {inPts}
                            </span>
                          </td>

                          {/* 5. Out Pts */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <span className="font-black text-xs text-rose-700 bg-rose-50 border border-rose-200/80 px-1.5 py-0.5 rounded">
                              {outPts}
                            </span>
                          </td>

                          {/* 6. Gap */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <span
                              className={`font-black text-xs px-1.5 py-0.5 rounded border ${
                                gap > 0
                                  ? 'text-emerald-700 bg-emerald-100/90 border-emerald-300'
                                  : gap < 0
                                  ? 'text-rose-700 bg-rose-100/90 border-rose-300'
                                  : 'text-slate-600 bg-slate-100 border-slate-200'
                              }`}
                            >
                              {gap > 0 ? `+${gap}` : `${gap}`}
                            </span>
                          </td>

                          {/* 7. GW */}
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            <span className="bg-purple-100 text-[#37003c] font-black text-xs px-2 py-0.5 rounded">
                              GW{t.event}
                            </span>
                          </td>

                          {/* 8. Time (WIB) - Clock icon removed */}
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            <span className="text-slate-500 text-[11px] whitespace-nowrap font-medium">
                              {(() => {
                                if (t.formatted_time_wib) {
                                  return t.formatted_time_wib.replace(/(\d{1,2})\.(\d{2})/, '$1:$2');
                                }
                                if (!t.time) return '-';
                                const d = new Date(t.time);
                                if (isNaN(d.getTime())) return t.time;
                                const datePart = d.toLocaleDateString('id-ID', {
                                  timeZone: 'Asia/Jakarta',
                                  day: 'numeric',
                                  month: 'short',
                                });
                                const timePart = d.toLocaleTimeString('id-ID', {
                                  timeZone: 'Asia/Jakarta',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }).replace('.', ':');
                                return `${datePart} ${timePart} WIB`;
                              })()}
                            </span>
                          </td>
                        </tr>
                      );
                    })
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
            <CustomPopoverSelect
              id="stat-in-gw-select"
              value={statGWFilter}
              onChange={(val) => setStatGWFilter(String(val))}
              options={[
                { value: 'all', label: 'Season' },
                ...availableGWs.map((gw) => ({
                  value: String(gw),
                  label: `GW ${gw}`,
                  sublabel: gw === currentGW ? 'Current' : undefined,
                })),
              ]}
            />

            {/* Club Filter */}
            <CustomPopoverSelect
              id="stat-in-club-select"
              value={statClubFilter}
              onChange={(val) => setStatClubFilter(String(val))}
              options={[
                { value: 'all', label: 'All Clubs' },
                ...availableClubs.map((club) => ({
                  value: club,
                  label: club,
                })),
              ]}
              searchable={false}
            />

            {/* Pos Filter */}
            <CustomPopoverSelect
              id="stat-in-pos-select"
              value={statPosFilter}
              onChange={(val) => setStatPosFilter(String(val))}
              options={[
                { value: 'all', label: 'All Pos' },
                { value: 'GKP', label: 'GKP' },
                { value: 'DEF', label: 'DEF' },
                { value: 'MID', label: 'MID' },
                { value: 'FWD', label: 'FWD' },
              ]}
            />
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
                          <span
                            className={`font-black text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                              item.position === 'FWD'
                                ? 'bg-rose-100 text-rose-800'
                                : item.position === 'MID'
                                ? 'bg-amber-100 text-amber-800'
                                : item.position === 'DEF'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
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
            <CustomPopoverSelect
              id="stat-out-gw-select"
              value={statGWFilter}
              onChange={(val) => setStatGWFilter(String(val))}
              options={[
                { value: 'all', label: 'Season' },
                ...availableGWs.map((gw) => ({
                  value: String(gw),
                  label: `GW ${gw}`,
                  sublabel: gw === currentGW ? 'Current' : undefined,
                })),
              ]}
            />

            {/* Club Filter */}
            <CustomPopoverSelect
              id="stat-out-club-select"
              value={statClubFilter}
              onChange={(val) => setStatClubFilter(String(val))}
              options={[
                { value: 'all', label: 'All Clubs' },
                ...availableClubs.map((club) => ({
                  value: club,
                  label: club,
                })),
              ]}
              searchable={false}
            />

            {/* Pos Filter */}
            <CustomPopoverSelect
              id="stat-out-pos-select"
              value={statPosFilter}
              onChange={(val) => setStatPosFilter(String(val))}
              options={[
                { value: 'all', label: 'All Pos' },
                { value: 'GKP', label: 'GKP' },
                { value: 'DEF', label: 'DEF' },
                { value: 'MID', label: 'MID' },
                { value: 'FWD', label: 'FWD' },
              ]}
            />
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
                          <span
                            className={`font-black text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                              item.position === 'FWD'
                                ? 'bg-rose-100 text-rose-800'
                                : item.position === 'MID'
                                ? 'bg-amber-100 text-amber-800'
                                : item.position === 'DEF'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
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
