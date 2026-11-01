import React, { useState, useMemo, useRef } from 'react';
import {
  TrendingUp,
  Search,
  Check,
  RotateCcw,
  ChevronDown,
  Sparkles,
  Zap,
  Flame,
  Award,
  Filter,
  Eye,
  X
} from 'lucide-react';
import { StandingsRow } from '../types.ts';

export type ChartMetricType = 'last_rank' | 'gw_rank' | 'total_points' | 'event_points';
export type RankPreset = 'all' | '1-20' | '21-40' | '41-60' | '61-80' | '81-100';

interface StandingsChartProps {
  standings: Record<number, StandingsRow[]>;
  availableGWs: number[];
  currentGW: number;
  onSelectManager?: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
}

interface TeamSeries {
  entryId: number;
  entryName: string;
  playerName: string;
  latestRank: number;
  dataPoints: Record<
    number,
    {
      gw: number;
      last_rank: number;
      gw_rank: number;
      total_points: number;
      event_points: number;
      active_chip: string | null;
      hits: number;
      captain: {
        id: number;
        name: string;
        points: number;
        multiplier: number;
      } | null;
    }
  >;
  color: string;
}

// 24 vibrant, distinct colors cycled for modern lines
const PALETTE = [
  '#00ff87', // neon green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f97316', // orange
  '#a855f7', // purple
  '#0284c7', // sky
  '#84cc16', // lime
  '#e11d48', // rose
  '#eab308', // yellow
  '#4f46e5', // dark indigo
  '#d946ef', // fuchsia
  '#2dd4bf', // light teal
  '#fb7185', // salmon
  '#38bdf8', // light sky
  '#a3e635', // bright lime
  '#c084fc', // light purple
  '#fbbf24', // bright amber
];

export const StandingsChart: React.FC<StandingsChartProps> = ({
  standings,
  availableGWs,
  currentGW,
  onSelectManager,
  onSelectPlayer,
}) => {
  // Sort GWs ascending (1, 2, 3...)
  const sortedGWs = useMemo(() => {
    const gws = (availableGWs && availableGWs.length > 0 ? availableGWs : [currentGW || 1])
      .slice()
      .sort((a, b) => a - b);
    return gws;
  }, [availableGWs, currentGW]);

  const latestGW = sortedGWs[sortedGWs.length - 1] || 1;

  // Chart Metric Selection (Default: Last Rank)
  const [metricType, setMetricType] = useState<ChartMetricType>('last_rank');

  // Preset Filter (Default: All Teams)
  const [rankPreset, setRankPreset] = useState<RankPreset>('all');

  // Multiple Picker State
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number> | null>(null); // null means All Teams
  const [isMultiPickerOpen, setIsMultiPickerOpen] = useState(false);
  const [multiPickerSearch, setMultiPickerSearch] = useState('');

  // Toggles (Default: all false)
  const [showChips, setShowChips] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [showCaptains, setShowCaptains] = useState(false);

  // Hovered / highlighted team
  const [hoveredEntryId, setHoveredEntryId] = useState<number | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<{
    x: number;
    y: number;
    team: TeamSeries;
    gw: number;
  } | null>(null);

  // 1. Calculate per-GW ranks and build series for all teams
  const { allTeams, teamsMap } = useMemo(() => {
    // Map of GW -> Map of entryId -> GW Rank
    const gwRanksMap: Record<number, Record<number, number>> = {};

    sortedGWs.forEach((gw) => {
      const rows = standings[gw] || [];
      // Sort rows by event_points descending to determine GW Rank
      const sortedByGwPoints = [...rows].sort((a, b) => (b.event_points || 0) - (a.event_points || 0));
      const rMap: Record<number, number> = {};
      let currentGwRank = 1;
      sortedByGwPoints.forEach((r, idx) => {
        if (idx > 0 && r.event_points === sortedByGwPoints[idx - 1].event_points) {
          rMap[r.entry_id] = currentGwRank;
        } else {
          currentGwRank = idx + 1;
          rMap[r.entry_id] = currentGwRank;
        }
      });
      gwRanksMap[gw] = rMap;
    });

    // Collect all teams appearing in the latest GW (or any GW)
    const latestRows = standings[latestGW] || standings[sortedGWs[0]] || [];
    const tMap: Record<number, TeamSeries> = {};

    latestRows.forEach((r, index) => {
      tMap[r.entry_id] = {
        entryId: r.entry_id,
        entryName: r.entry_name,
        playerName: r.player_name,
        latestRank: r.rank || index + 1,
        dataPoints: {},
        color: PALETTE[index % PALETTE.length],
      };
    });

    // Populate dataPoints across all sorted GWs
    sortedGWs.forEach((gw) => {
      const rows = standings[gw] || [];
      rows.forEach((r) => {
        if (!tMap[r.entry_id]) {
          tMap[r.entry_id] = {
            entryId: r.entry_id,
            entryName: r.entry_name,
            playerName: r.player_name,
            latestRank: r.rank || 99,
            dataPoints: {},
            color: PALETTE[Object.keys(tMap).length % PALETTE.length],
          };
        }
        tMap[r.entry_id].dataPoints[gw] = {
          gw,
          last_rank: r.rank,
          gw_rank: gwRanksMap[gw]?.[r.entry_id] || r.rank,
          total_points: r.total_points,
          event_points: r.event_points,
          active_chip: r.active_chip || null,
          hits: r.event_transfers_cost || 0,
          captain: r.captain
            ? {
                id: r.captain.id,
                name: r.captain.name,
                points: r.captain.points,
                multiplier: r.captain.multiplier,
              }
            : null,
        };
      });
    });

    const list = Object.values(tMap).sort((a, b) => a.latestRank - b.latestRank);
    return { allTeams: list, teamsMap: tMap };
  }, [standings, sortedGWs, latestGW]);

  // Alphabetically sorted list for multiple picker
  const alphabeticalTeams = useMemo(() => {
    return [...allTeams].sort((a, b) => a.entryName.localeCompare(b.entryName));
  }, [allTeams]);

  // Filtered teams based on rank preset OR multiple picker
  const visibleTeams = useMemo(() => {
    // If multiple picker is active (not null)
    if (selectedEntryIds !== null) {
      return allTeams.filter((t) => selectedEntryIds.has(t.entryId));
    }

    // Otherwise apply Rank Preset
    switch (rankPreset) {
      case '1-20':
        return allTeams.filter((t) => t.latestRank >= 1 && t.latestRank <= 20);
      case '21-40':
        return allTeams.filter((t) => t.latestRank >= 21 && t.latestRank <= 40);
      case '41-60':
        return allTeams.filter((t) => t.latestRank >= 41 && t.latestRank <= 60);
      case '61-80':
        return allTeams.filter((t) => t.latestRank >= 61 && t.latestRank <= 80);
      case '81-100':
        return allTeams.filter((t) => t.latestRank >= 81);
      case 'all':
      default:
        return allTeams;
    }
  }, [allTeams, selectedEntryIds, rankPreset]);

  // Handle Preset Dropdown Selection (Mutual Reset: resets multi-picker to null/all)
  const handlePresetChange = (preset: RankPreset) => {
    setRankPreset(preset);
    setSelectedEntryIds(null); // Reset multiple picker to All Teams
  };

  // Handle Multi Picker Team Toggle (Mutual Reset: resets rank preset to 'all')
  const handleToggleTeam = (entryId: number) => {
    setRankPreset('all'); // Reset preset dropdown to default All Teams
    setSelectedEntryIds((prev) => {
      const current = prev !== null ? new Set(prev) : new Set(allTeams.map((t) => t.entryId));
      if (current.has(entryId)) {
        current.delete(entryId);
      } else {
        current.add(entryId);
      }
      return current;
    });
  };

  // Handle "Select All" in multi-picker
  const handleSelectAllTeams = () => {
    setRankPreset('all');
    setSelectedEntryIds(null); // null represents all teams
  };

  // Handle "Clear All" in multi-picker
  const handleClearAllTeams = () => {
    setRankPreset('all');
    setSelectedEntryIds(new Set());
  };

  // Helper to extract numeric value from a data point
  const getValue = (dp: TeamSeries['dataPoints'][number] | undefined): number => {
    if (!dp) return 0;
    switch (metricType) {
      case 'last_rank':
        return dp.last_rank;
      case 'gw_rank':
        return dp.gw_rank;
      case 'total_points':
        return dp.total_points;
      case 'event_points':
        return dp.event_points;
      default:
        return dp.last_rank;
    }
  };

  // Compute Min and Max for Y-Axis
  const isRankMetric = metricType === 'last_rank' || metricType === 'gw_rank';
  const totalTeamsCount = allTeams.length || 97;

  const { yMin, yMax, yTicks } = useMemo(() => {
    if (isRankMetric) {
      // For Rank: Rank 1 is at the TOP (yMin = 1).
      // Bottom axis value is 100 (or totalTeams rounded up with space)
      // "misal jumlah tim 97, value vertikal yang berada di titik potong sumbu vertikal-horizontal bernilai 100."
      const bottomRank = Math.max(100, Math.ceil(totalTeamsCount / 10) * 10);
      return {
        yMin: 1,
        yMax: bottomRank,
        yTicks: [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, bottomRank],
      };
    }

    // For Points (Total Pts / GW Pts)
    let minVal = Infinity;
    let maxVal = -Infinity;

    visibleTeams.forEach((t) => {
      sortedGWs.forEach((gw) => {
        const dp = t.dataPoints[gw];
        if (dp) {
          const v = getValue(dp);
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      });
    });

    if (!isFinite(minVal) || !isFinite(maxVal)) {
      minVal = 0;
      maxVal = 100;
    }

    if (metricType === 'event_points') {
      const top = Math.ceil((maxVal + 5) / 10) * 10;
      const bottom = Math.max(0, Math.floor((minVal - 5) / 10) * 10);
      const step = Math.max(10, Math.round((top - bottom) / 5));
      const ticks: number[] = [];
      for (let v = bottom; v <= top; v += step) ticks.push(v);
      return { yMin: bottom, yMax: top, yTicks: ticks };
    } else {
      // Total Points
      const top = Math.ceil((maxVal + 15) / 25) * 25;
      const bottom = Math.max(0, Math.floor((minVal - 15) / 25) * 25);
      const step = Math.max(25, Math.round((top - bottom) / 5));
      const ticks: number[] = [];
      for (let v = bottom; v <= top; v += step) ticks.push(v);
      return { yMin: bottom, yMax: top, yTicks: ticks };
    }
  }, [isRankMetric, metricType, visibleTeams, sortedGWs, totalTeamsCount]);

  // Chart SVG Dimensions
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWidth = Math.max(760, sortedGWs.length * 130 + 220);
  const svgHeight = 560;

  const margin = {
    top: 36,
    right: 170, // generous right margin for team names
    bottom: 50,
    left: 56,
  };

  const plotWidth = svgWidth - margin.left - margin.right;
  const plotHeight = svgHeight - margin.top - margin.bottom;

  // Coordinate scales
  const getX = (gw: number): number => {
    if (sortedGWs.length <= 1) return margin.left + plotWidth / 2;
    const index = sortedGWs.indexOf(gw);
    return margin.left + (index / (sortedGWs.length - 1)) * plotWidth;
  };

  const getY = (val: number): number => {
    if (isRankMetric) {
      // Inverted: val = 1 -> top (margin.top), val = yMax (100) -> bottom (margin.top + plotHeight)
      const ratio = (val - yMin) / (yMax - yMin);
      return margin.top + ratio * plotHeight;
    } else {
      // Normal: val = yMax -> top, val = yMin -> bottom
      const ratio = (val - yMin) / (yMax - yMin);
      return margin.top + plotHeight - ratio * plotHeight;
    }
  };

  // Compute relaxed label positions for the right edge to avoid overlapping text
  const endLabels = useMemo(() => {
    const rawLabels = visibleTeams
      .map((t) => {
        const lastDp = t.dataPoints[latestGW];
        if (!lastDp) return null;
        const val = getValue(lastDp);
        const y = getY(val);
        return {
          entryId: t.entryId,
          entryName: t.entryName,
          color: t.color,
          y,
          val,
        };
      })
      .filter(Boolean) as Array<{
      entryId: number;
      entryName: string;
      color: string;
      y: number;
      val: number;
    }>;

    // Sort by y position
    rawLabels.sort((a, b) => a.y - b.y);

    // Iterative separation to ensure at least 15px distance
    const minDistance = 14;
    const adjusted = rawLabels.map((l) => ({ ...l, targetY: l.y }));

    for (let iter = 0; iter < 8; iter++) {
      for (let i = 0; i < adjusted.length - 1; i++) {
        const curr = adjusted[i];
        const next = adjusted[i + 1];
        const overlap = minDistance - (next.targetY - curr.targetY);
        if (overlap > 0) {
          curr.targetY -= overlap / 2;
          next.targetY += overlap / 2;
        }
      }
    }

    // Bound within SVG canvas
    adjusted.forEach((l) => {
      if (l.targetY < margin.top) l.targetY = margin.top;
      if (l.targetY > margin.top + plotHeight) l.targetY = margin.top + plotHeight;
    });

    return adjusted;
  }, [visibleTeams, latestGW, metricType, yMin, yMax, plotHeight]);

  return (
    <div className="space-y-4">
      {/* Top Filter and Controls Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-4 shadow-sm space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Chart Metric Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-purple-700" />
              Tipe Chart:
            </span>
            {(
              [
                { id: 'last_rank', label: 'Last Rank (Default)' },
                { id: 'gw_rank', label: 'GW Rank' },
                { id: 'total_points', label: 'Total Pts' },
                { id: 'event_points', label: 'GW Pts' },
              ] as const
            ).map((item) => {
              const active = metricType === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMetricType(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    active
                      ? 'bg-[#37003c] text-[#00ff87] shadow-sm ring-1 ring-[#00ff87]/30'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Preset Dropdown & Multi-Picker Dropdown */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Dropdown 1: Preset Ranks */}
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-bold text-slate-500">Filter Rank:</label>
              <div className="relative">
                <select
                  value={selectedEntryIds !== null ? 'custom' : rankPreset}
                  onChange={(e) => {
                    const val = e.target.value as RankPreset;
                    handlePresetChange(val);
                  }}
                  className="bg-slate-100 border border-slate-200 text-slate-800 text-xs font-bold rounded-lg px-2.5 py-1.5 pr-7 appearance-none focus:outline-none focus:ring-2 focus:ring-purple-600 cursor-pointer shadow-xs"
                >
                  <option value="all">All Teams (Default)</option>
                  <option value="1-20">1st-20 (Rank 1-20)</option>
                  <option value="21-40">2nd-20 (Rank 21-40)</option>
                  <option value="41-60">3rd-20 (Rank 41-60)</option>
                  <option value="61-80">4th-20 (Rank 61-80)</option>
                  <option value="81-100">5th-20 (Rank 81-{totalTeamsCount})</option>
                  {selectedEntryIds !== null && (
                    <option value="custom" disabled>
                      Pilihan Tim Khusus ({visibleTeams.length})
                    </option>
                  )}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Dropdown 2: Multiple Picker */}
            <div className="relative">
              <button
                onClick={() => setIsMultiPickerOpen(!isMultiPickerOpen)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                  selectedEntryIds !== null
                    ? 'bg-purple-50 text-purple-900 border-purple-300 ring-1 ring-purple-400'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/80'
                }`}
              >
                <Filter className="w-3.5 h-3.5 text-purple-700" />
                <span>
                  {selectedEntryIds === null
                    ? `Pilih Tim (Semua: ${allTeams.length})`
                    : `${selectedEntryIds.size} Tim Dipilih`}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {/* Multi Picker Dropdown Content */}
              {isMultiPickerOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setIsMultiPickerOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-72 sm:w-80 bg-white rounded-xl shadow-2xl border border-slate-200 z-40 p-2.5 animate-in fade-in zoom-in-95">
                    {/* Header Controls */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <span className="text-xs font-black text-slate-800">
                        Pilih Tim (Urut Abjad)
                      </span>
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          onClick={handleSelectAllTeams}
                          className="text-purple-700 hover:underline font-bold px-1.5 py-0.5 rounded hover:bg-purple-50"
                        >
                          Semua
                        </button>
                        <span className="text-slate-300">•</span>
                        <button
                          onClick={handleClearAllTeams}
                          className="text-slate-500 hover:underline font-bold px-1.5 py-0.5 rounded hover:bg-slate-50"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>

                    {/* Search Field */}
                    <div className="relative my-2">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Cari nama tim..."
                        value={multiPickerSearch}
                        onChange={(e) => setMultiPickerSearch(e.target.value)}
                        className="w-full text-xs pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-600"
                      />
                    </div>

                    {/* Team List with Checkboxes */}
                    <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1 divide-y divide-slate-50">
                      {alphabeticalTeams
                        .filter((t) =>
                          t.entryName.toLowerCase().includes(multiPickerSearch.toLowerCase())
                        )
                        .map((team) => {
                          const isChecked =
                            selectedEntryIds === null || selectedEntryIds.has(team.entryId);
                          return (
                            <label
                              key={team.entryId}
                              className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs group"
                            >
                              <div className="flex items-center gap-2 overflow-hidden">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleTeam(team.entryId)}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                                />
                                <span
                                  className={`truncate font-semibold ${
                                    isChecked ? 'text-slate-900' : 'text-slate-400'
                                  }`}
                                >
                                  {team.entryName}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-1">
                                #{team.latestRank}
                              </span>
                            </label>
                          );
                        })}
                    </div>

                    {/* Footer */}
                    <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">
                        {visibleTeams.length} tim aktif
                      </span>
                      <button
                        onClick={() => setIsMultiPickerOpen(false)}
                        className="bg-[#37003c] text-white px-3 py-1 rounded-md font-bold hover:bg-[#37003c]/90"
                      >
                        Selesai
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Toggles Bar: Chip used, Hits, Captained Player */}
        <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              Tampilkan:
            </span>

            {/* Chip Used Toggle */}
            <button
              onClick={() => setShowChips(!showChips)}
              className={`px-2.5 py-1 rounded-md font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                showChips
                  ? 'bg-purple-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-[#00ff87]" />
              <span>Chip used</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  showChips ? 'bg-[#00ff87]' : 'bg-slate-300'
                }`}
              />
            </button>

            {/* Hits Toggle */}
            <button
              onClick={() => setShowHits(!showHits)}
              className={`px-2.5 py-1 rounded-md font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                showHits
                  ? 'bg-rose-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Zap className="w-3 h-3 text-rose-300" />
              <span>Hits</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  showHits ? 'bg-rose-400' : 'bg-slate-300'
                }`}
              />
            </button>

            {/* Captained Player Toggle */}
            <button
              onClick={() => setShowCaptains(!showCaptains)}
              className={`px-2.5 py-1 rounded-md font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                showCaptains
                  ? 'bg-amber-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Award className="w-3 h-3 text-amber-300" />
              <span>Captained Player</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  showCaptains ? 'bg-amber-400' : 'bg-slate-300'
                }`}
              />
            </button>
          </div>

          {/* Reset Filters Quick Button */}
          {(rankPreset !== 'all' || selectedEntryIds !== null) && (
            <button
              onClick={() => {
                setRankPreset('all');
                setSelectedEntryIds(null);
              }}
              className="text-[11px] font-bold text-purple-700 hover:text-purple-950 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filter Tim</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div
        ref={containerRef}
        className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-2 sm:p-4 overflow-x-auto relative"
      >
        {/* Info Header Banner */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 text-xs text-slate-500 px-1">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-900">
              Pergerakan GW 1 s.d. GW {latestGW}
            </span>
            <span>•</span>
            <span>Menampilkan {visibleTeams.length} tim</span>
          </div>
          <div className="text-[11px] text-slate-400">
            {isRankMetric
              ? 'Rank 1 di puncak • Sumbu dasar 100'
              : 'Poin tertinggi di bagian atas'}
          </div>
        </div>

        {/* SVG Visualization */}
        <div className="min-w-[760px] relative">
          <svg
            width={svgWidth}
            height={svgHeight}
            className="overflow-visible select-none"
            onMouseLeave={() => {
              setHoveredEntryId(null);
              setActiveTooltip(null);
            }}
          >
            <defs>
              <linearGradient id="grid-fade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.7" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines and Y-axis Labels */}
            {yTicks.map((val) => {
              const y = getY(val);
              return (
                <g key={`ytick-${val}`}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={margin.left + plotWidth}
                    y2={y}
                    stroke="#f1f5f9"
                    strokeDasharray={val === 1 || val === yMax ? 'none' : '3 3'}
                    strokeWidth={val === 1 || val === yMax ? 1.5 : 1}
                  />
                  <text
                    x={margin.left - 10}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="10.5"
                    fontFamily="monospace"
                    fontWeight={val === 1 ? '900' : '600'}
                    fill={val === 1 ? '#37003c' : '#64748b'}
                  >
                    {isRankMetric ? `#${val}` : val}
                  </text>
                </g>
              );
            })}

            {/* Vertical GW Lines and X-axis Labels */}
            {sortedGWs.map((gw) => {
              const x = getX(gw);
              return (
                <g key={`xgrid-${gw}`}>
                  <line
                    x1={x}
                    y1={margin.top}
                    x2={x}
                    y2={margin.top + plotHeight}
                    stroke="#f8fafc"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={x}
                    y1={margin.top + plotHeight}
                    x2={x}
                    y2={margin.top + plotHeight + 6}
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />
                  <text
                    x={x}
                    y={margin.top + plotHeight + 20}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="800"
                    fill={gw === latestGW ? '#37003c' : '#475569'}
                  >
                    GW {gw}
                  </text>
                </g>
              );
            })}

            {/* Horizontal axis bottom border (titik potong 100 untuk rank) */}
            <line
              x1={margin.left}
              y1={margin.top + plotHeight}
              x2={margin.left + plotWidth}
              y2={margin.top + plotHeight}
              stroke="#cbd5e1"
              strokeWidth="2"
            />

            {/* Render Team Lines */}
            {visibleTeams.map((team) => {
              const isHovered = hoveredEntryId === team.entryId;
              const isDimmed = hoveredEntryId !== null && !isHovered;

              // Build path points
              const points = sortedGWs
                .map((gw) => {
                  const dp = team.dataPoints[gw];
                  if (!dp) return null;
                  const val = getValue(dp);
                  return { x: getX(gw), y: getY(val), gw, dp };
                })
                .filter(Boolean) as Array<{
                x: number;
                y: number;
                gw: number;
                dp: TeamSeries['dataPoints'][number];
              }>;

              if (points.length === 0) return null;

              const pathD = points.reduce((acc, p, idx) => {
                return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
              }, '');

              return (
                <g
                  key={`line-${team.entryId}`}
                  className="transition-opacity duration-150 cursor-pointer"
                  opacity={isDimmed ? 0.15 : 1}
                  onMouseEnter={() => setHoveredEntryId(team.entryId)}
                  onClick={() => onSelectManager?.(team.entryId, latestGW)}
                >
                  {/* Invisible thick stroke for easy mouse hovering */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                  />

                  {/* Visual Line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={team.color}
                    strokeWidth={isHovered ? 3.5 : 1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Data Points and Badges */}
                  {points.map((p) => {
                    return (
                      <g key={`pt-${team.entryId}-${p.gw}`}>
                        {/* Circle at data point */}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 4.5 : 2.5}
                          fill={isHovered ? '#ffffff' : team.color}
                          stroke={team.color}
                          strokeWidth={isHovered ? 2.5 : 1.5}
                          onMouseEnter={(e) => {
                            setHoveredEntryId(team.entryId);
                            setActiveTooltip({
                              x: p.x,
                              y: p.y,
                              team,
                              gw: p.gw,
                            });
                          }}
                        />

                        {/* Chip Used Badge */}
                        {showChips && p.dp.active_chip && (
                          <g transform={`translate(${p.x}, ${p.y - 12})`}>
                            <rect
                              x="-11"
                              y="-8"
                              width="22"
                              height="12"
                              rx="3"
                              fill="#37003c"
                              stroke="#00ff87"
                              strokeWidth="0.8"
                            />
                            <text
                              x="0"
                              y="1"
                              textAnchor="middle"
                              fontSize="8"
                              fontWeight="900"
                              fill="#00ff87"
                            >
                              {p.dp.active_chip}
                            </text>
                          </g>
                        )}

                        {/* Hits Badge (-4, -8) */}
                        {showHits && p.dp.hits > 0 && (
                          <g transform={`translate(${p.x}, ${p.y + 12})`}>
                            <rect
                              x="-9"
                              y="-6"
                              width="18"
                              height="11"
                              rx="3"
                              fill="#e11d48"
                            />
                            <text
                              x="0"
                              y="2.5"
                              textAnchor="middle"
                              fontSize="7.5"
                              fontWeight="900"
                              fill="#ffffff"
                            >
                              -{p.dp.hits}
                            </text>
                          </g>
                        )}

                        {/* Captain Player Badge */}
                        {showCaptains && p.dp.captain && (
                          <g
                            transform={`translate(${p.x}, ${p.y - (showChips ? 24 : 12)})`}
                            className={onSelectPlayer ? 'cursor-pointer hover:opacity-80' : ''}
                            onClick={(e) => {
                              if (onSelectPlayer && p.dp.captain?.id) {
                                e.stopPropagation();
                                onSelectPlayer(p.dp.captain.id, p.dp.gw);
                              }
                            }}
                          >
                            <rect
                              x="-22"
                              y="-8"
                              width="44"
                              height="13"
                              rx="3"
                              fill="#1e1b4b"
                              stroke="#fbbf24"
                              strokeWidth="0.8"
                            />
                            <text
                              x="0"
                              y="1.5"
                              textAnchor="middle"
                              fontSize="7.5"
                              fontWeight="800"
                              fill="#fde68a"
                            >
                              © {p.dp.captain.name.slice(0, 7)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Team Names on Right Edge */}
            {endLabels.map((lbl) => {
              const isHovered = hoveredEntryId === lbl.entryId;
              const isDimmed = hoveredEntryId !== null && !isHovered;
              const lastX = getX(latestGW);

              return (
                <g
                  key={`lbl-${lbl.entryId}`}
                  className="cursor-pointer select-none transition-all duration-150"
                  opacity={isDimmed ? 0.2 : 1}
                  onMouseEnter={() => setHoveredEntryId(lbl.entryId)}
                  onClick={() => onSelectManager?.(lbl.entryId, latestGW)}
                >
                  {/* Subtle connecting leader line if label shifted slightly */}
                  {Math.abs(lbl.targetY - lbl.y) > 2 && (
                    <line
                      x1={lastX + 4}
                      y1={lbl.y}
                      x2={lastX + 12}
                      y2={lbl.targetY}
                      stroke={lbl.color}
                      strokeWidth="0.8"
                      strokeDasharray="2 2"
                      opacity={isHovered ? 0.9 : 0.4}
                    />
                  )}

                  {/* Team Name Label */}
                  <circle
                    cx={lastX + 14}
                    cy={lbl.targetY}
                    r={isHovered ? 3 : 2}
                    fill={lbl.color}
                  />
                  <text
                    x={lastX + 20}
                    y={lbl.targetY + 3.5}
                    fontSize={isHovered ? '11.5' : '10'}
                    fontWeight={isHovered ? '900' : '600'}
                    fill={isHovered ? '#1e1b4b' : '#334155'}
                  >
                    {lbl.entryName}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Floating Detail Tooltip */}
          {activeTooltip && (
            <div
              className="absolute z-20 pointer-events-none bg-[#1e1b4b] text-white p-2.5 rounded-xl shadow-xl border border-white/10 text-xs w-48 -translate-x-1/2 -translate-y-full -mt-2 animate-in fade-in"
              style={{
                left: `${activeTooltip.x}px`,
                top: `${activeTooltip.y}px`,
              }}
            >
              <div className="font-black text-sm text-[#00ff87] truncate">
                {activeTooltip.team.entryName}
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                {activeTooltip.team.playerName}
              </div>
              <div className="my-1.5 pt-1.5 border-t border-white/10 grid grid-cols-2 gap-1 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[9.5px]">Gameweek</span>
                  <span className="font-extrabold text-white">GW {activeTooltip.gw}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9.5px]">
                    {metricType === 'last_rank'
                      ? 'Last Rank'
                      : metricType === 'gw_rank'
                      ? 'GW Rank'
                      : metricType === 'total_points'
                      ? 'Total Pts'
                      : 'GW Pts'}
                  </span>
                  <span className="font-extrabold text-[#00ff87]">
                    {isRankMetric ? '#' : ''}
                    {getValue(activeTooltip.team.dataPoints[activeTooltip.gw])}
                    {!isRankMetric ? ' pts' : ''}
                  </span>
                </div>
              </div>

              {/* Extra chips or captain details in tooltip */}
              {activeTooltip.team.dataPoints[activeTooltip.gw] && (
                <div className="space-y-0.5 text-[10px] text-slate-300 pt-1 border-t border-white/5">
                  {activeTooltip.team.dataPoints[activeTooltip.gw].captain && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Captain:</span>
                      <span className="font-bold text-amber-300">
                        {activeTooltip.team.dataPoints[activeTooltip.gw].captain?.name} (
                        {activeTooltip.team.dataPoints[activeTooltip.gw].captain?.points}p)
                      </span>
                    </div>
                  )}
                  {activeTooltip.team.dataPoints[activeTooltip.gw].active_chip && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Chip:</span>
                      <span className="font-bold text-purple-300">
                        {activeTooltip.team.dataPoints[activeTooltip.gw].active_chip}
                      </span>
                    </div>
                  )}
                  {activeTooltip.team.dataPoints[activeTooltip.gw].hits > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Transfer Hits:</span>
                      <span className="font-bold text-rose-300">
                        -{activeTooltip.team.dataPoints[activeTooltip.gw].hits} pts
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
