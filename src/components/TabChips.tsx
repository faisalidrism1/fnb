import React, { useState, useMemo } from 'react';
import { Zap, ArrowUpDown, Search, Sparkles } from 'lucide-react';
import { ChipUsedRow } from '../types.ts';

interface TabChipsProps {
  chips: ChipUsedRow[];
  onSelectManager: (entryId: number) => void;
}

type ChipColumnKey = 'entry_name' | 'wc1' | 'tc1' | 'bb1' | 'fh1' | 'wc2' | 'tc2' | 'bb2' | 'fh2';

export const TabChips: React.FC<TabChipsProps> = ({ chips, onSelectManager }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<ChipColumnKey>('tc1');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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

  const renderChipCell = (chip: { gw: number; points: number } | null, badgeColor: string) => {
    if (!chip) {
      return <span className="text-slate-300 font-medium">-</span>;
    }
    return (
      <div className="flex flex-col items-center justify-center">
        <span
          className={`font-black text-xs px-2 py-0.5 rounded-md shadow-2xs border ${badgeColor}`}
        >
          GW{chip.gw}
        </span>
        <span className="text-[10px] font-extrabold text-slate-700 mt-0.5">
          {chip.points} pts
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-2.5">
      {/* Search Filter directly above table */}
      <div className="flex items-center justify-between gap-2 py-0.5">
        <div className="flex items-center gap-2">
          <span className="p-1 bg-purple-100 text-[#37003c] rounded-lg">
            <Zap className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-bold text-slate-800">Chip Used Matrix</span>
        </div>

        {/* Quick Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Chips Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold select-none">
              <tr>
                <th
                  className="py-3 px-3 cursor-pointer hover:bg-purple-950 transition-colors w-12 text-center"
                >
                  #
                </th>
                <th
                  className="py-3 px-3 cursor-pointer hover:bg-purple-950 transition-colors min-w-[160px]"
                  onClick={() => handleSort('entry_name')}
                >
                  <div className="flex items-center gap-1">
                    <span>Manager & Team</span>
                    <ArrowUpDown className="w-3 h-3 text-purple-300" />
                  </div>
                </th>

                {/* WC 1 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('wc1')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>WC 1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* TC 1 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('tc1')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>TC 1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* BB 1 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('bb1')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>BB 1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* FH 1 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('fh1')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>FH 1</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* WC 2 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('wc2')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>WC 2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* TC 2 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('tc2')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>TC 2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* BB 2 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('bb2')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>BB 2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>

                {/* FH 2 */}
                <th
                  className="py-3 px-2.5 text-center cursor-pointer hover:bg-purple-950 transition-colors"
                  onClick={() => handleSort('fh2')}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>FH 2</span>
                    <ArrowUpDown className="w-2.5 h-2.5 text-purple-300" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedChips.map((row, idx) => (
                <tr
                  key={row.entry_id}
                  onClick={() => onSelectManager(row.entry_id)}
                  className="hover:bg-purple-50/30 transition-colors cursor-pointer"
                >
                  <td className="py-3 px-3 text-center text-slate-400 font-bold">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-3">
                    <p className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      {row.entry_name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {row.player_name}
                    </p>
                  </td>

                  {/* WC 1 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.wc1, 'bg-purple-100 text-[#37003c] border-purple-300')}
                  </td>

                  {/* TC 1 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.tc1, 'bg-amber-100 text-amber-900 border-amber-300')}
                  </td>

                  {/* BB 1 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.bb1, 'bg-blue-100 text-blue-900 border-blue-300')}
                  </td>

                  {/* FH 1 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.fh1, 'bg-teal-100 text-teal-900 border-teal-300')}
                  </td>

                  {/* WC 2 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.wc2, 'bg-purple-50 text-[#37003c] border-purple-200')}
                  </td>

                  {/* TC 2 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.tc2, 'bg-amber-50 text-amber-900 border-amber-200')}
                  </td>

                  {/* BB 2 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.bb2, 'bg-blue-50 text-blue-900 border-blue-200')}
                  </td>

                  {/* FH 2 */}
                  <td className="py-3 px-2.5 text-center whitespace-nowrap">
                    {renderChipCell(row.fh2, 'bg-teal-50 text-teal-900 border-teal-200')}
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
