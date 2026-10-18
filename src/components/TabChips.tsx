import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Search } from 'lucide-react';
import { ChipUsedRow } from '../types.ts';

interface TabChipsProps {
  chips: ChipUsedRow[];
  currentGW?: number;
  onSelectManager: (entryId: number, gw?: number) => void;
}

type ChipColumnKey = 'entry_name' | 'wc1' | 'tc1' | 'bb1' | 'fh1' | 'wc2' | 'tc2' | 'bb2' | 'fh2';

export const TabChips: React.FC<TabChipsProps> = ({ chips, currentGW, onSelectManager }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<ChipColumnKey>('entry_name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: ChipColumnKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc'); // Default descending to show highest points/active chips first
    }
  };

  const sortedChips = useMemo(() => {
    let list = [...chips];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.entry_name.toLowerCase().includes(q) ||
          c.player_name.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (sortKey === 'entry_name') {
        return sortOrder === 'asc'
          ? a.entry_name.localeCompare(b.entry_name)
          : b.entry_name.localeCompare(a.entry_name);
      }

      const valA = a[sortKey];
      const valB = b[sortKey];

      // If one used chip and the other didn't
      if (valA && !valB) return sortOrder === 'asc' ? 1 : -1;
      if (!valA && valB) return sortOrder === 'asc' ? -1 : 1;
      if (!valA && !valB) return 0;

      // Both used chip, sort by points scored or GW
      if (valA && valB) {
        return sortOrder === 'asc'
          ? valA.points - valB.points
          : valB.points - valA.points;
      }

      return 0;
    });

    return list;
  }, [chips, searchQuery, sortKey, sortOrder]);

  const renderChipCell = (
    rowEntryId: number,
    chip: { gw: number; points: number } | null,
    badgeColor: string
  ) => {
    if (!chip) {
      return <span className="text-slate-300 font-medium whitespace-nowrap text-xs select-none">-</span>;
    }
    return (
      <div
        className="flex flex-col items-center justify-center whitespace-nowrap leading-none cursor-pointer group/chip"
        onClick={(e) => {
          e.stopPropagation();
          onSelectManager(rowEntryId, chip.gw);
        }}
        title={`Buka tim GW ${chip.gw}`}
      >
        <span
          className={`font-black text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded shadow-2xs border whitespace-nowrap leading-none transition-transform group-hover/chip:scale-105 active:scale-95 ${badgeColor}`}
        >
          GW{chip.gw}
        </span>
        <span className="text-[9px] sm:text-[10px] font-extrabold text-slate-700 mt-0.5 whitespace-nowrap leading-none">
          {chip.points} pts
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Top Bar with Search */}
      <div className="flex items-center justify-end gap-2 py-0.5">
        {/* Quick Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            id="search-chips-input"
            placeholder="Search manager or team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#37003c] text-slate-800 shadow-2xs"
          />
        </div>
      </div>

      <div className="@container bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        {/* Chips Table: Team & Manager dynamically sized to remaining screen space with comfortable chips */}
        <div className="overflow-x-auto scrollbar-none sm:scrollbar-thin">
          <table className="text-left text-xs text-slate-700 border-separate border-spacing-0">
            <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
              <tr>
                {/* Frozen Team & Manager Column - Dynamically sized to fill remaining screen space */}
                <th
                  className="sticky left-0 z-30 bg-[#37003c] py-2.5 px-2 sm:px-2.5 whitespace-nowrap border-b border-purple-900 border-r border-purple-900/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] cursor-pointer hover:bg-purple-950 transition-colors leading-tight w-[calc(100cqw-184px)] min-w-[calc(100cqw-184px)] max-w-[calc(100cqw-184px)] sm:w-auto sm:min-w-[160px] sm:max-w-none"
                  onClick={() => handleSort('entry_name')}
                >
                  <div className="flex items-center gap-1 truncate">
                    <span className="truncate">Team & Manager</span>
                    <ArrowUpDown className="w-3 h-3 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* WC1 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('wc1')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>WC1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* TC1 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('tc1')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>TC1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* BB1 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('bb1')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>BB1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* FH1 with dividing right border */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 border-r border-r-purple-900/60 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('fh1')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>FH1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* WC2 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('wc2')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>WC2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* TC2 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('tc2')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>TC2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* BB2 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('bb2')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>BB2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>

                {/* FH2 */}
                <th
                  className="py-2.5 px-1.5 sm:px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors border-b border-purple-900 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none leading-tight"
                  onClick={() => handleSort('fh2')}
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>FH2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300 shrink-0" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedChips.map((row, idx) => (
                <tr
                  key={`${row.entry_id}-${idx}`}
                  onClick={() => onSelectManager(row.entry_id, currentGW)}
                  className="hover:bg-purple-50/30 transition-colors cursor-pointer group"
                >
                  {/* Frozen Team & Manager Column - Dynamically sized to fill remaining screen space */}
                  <td
                    onClick={() => onSelectManager(row.entry_id, currentGW)}
                    className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2.5 px-2 sm:px-2.5 whitespace-nowrap border-b border-slate-100 border-r border-slate-200/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] transition-colors w-[calc(100cqw-184px)] min-w-[calc(100cqw-184px)] max-w-[calc(100cqw-184px)] sm:w-auto sm:min-w-[160px] sm:max-w-none cursor-pointer"
                    title={`Buka tim ${row.entry_name} (GW ${currentGW || 'terkini'})`}
                  >
                    <div className="truncate">
                      <p className="font-extrabold text-slate-900 text-xs hover:text-[#37003c] leading-snug truncate">
                        {row.entry_name}
                      </p>
                      <p className="text-[11px] text-slate-500 font-medium leading-tight truncate">
                        {row.player_name}
                      </p>
                    </div>
                  </td>

                  {/* WC1 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.wc1, 'bg-purple-100 text-[#37003c] border-purple-300')}
                  </td>

                  {/* TC1 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.tc1, 'bg-amber-100 text-amber-900 border-amber-300')}
                  </td>

                  {/* BB1 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.bb1, 'bg-blue-100 text-blue-900 border-blue-300')}
                  </td>

                  {/* FH1 with dividing right border */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 border-r border-slate-200/80 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.fh1, 'bg-teal-100 text-teal-900 border-teal-300')}
                  </td>

                  {/* WC2 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.wc2, 'bg-purple-50 text-[#37003c] border-purple-200')}
                  </td>

                  {/* TC2 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.tc2, 'bg-amber-50 text-amber-900 border-amber-200')}
                  </td>

                  {/* BB2 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.bb2, 'bg-blue-50 text-blue-900 border-blue-200')}
                  </td>

                  {/* FH2 */}
                  <td className="py-2.5 px-1.5 sm:px-2.5 text-center whitespace-nowrap border-b border-slate-100 w-[46px] min-w-[46px] max-w-[46px] sm:w-14 sm:min-w-[56px] sm:max-w-none">
                    {renderChipCell(row.entry_id, row.fh2, 'bg-teal-50 text-teal-900 border-teal-200')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
