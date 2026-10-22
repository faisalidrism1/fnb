import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { StandingsRow } from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';

export type ChartMetricType = 'last_rank' | 'gw_rank' | 'total_points' | 'event_points';
export type RankPreset = 'all' | '1-20' | '21-40' | '41-60' | '61-80' | '81-100';

interface ChartSessionState {
  startGW?: number;
  endGW?: number;
  metricType?: ChartMetricType;
  rankPreset?: RankPreset;
  selectedEntryIds?: Set<number> | null;
  showChips?: boolean;
  showHits?: boolean;
  showCaptains?: boolean;
}

// Module-level in-memory cache: persists state across tab and subtab switches,
// but automatically resets when the user refreshes (F5) or reloads/opens the app afresh.
let chartSessionState: ChartSessionState | null = null;

interface StandingsChartProps {
  standings: Record<number, StandingsRow[]>;
  availableGWs: number[];
  currentGW: number;
  onSelectManager?: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  initialChampionEntryIds?: number[];
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

// 100 warna palet unik yang diurutkan bersiklus 25 putaran:
// [Mendekati Merah -> Mendekati Kuning/Orange -> Mendekati Hijau -> Mendekati Biru/Ungu]
// Menjamin hingga 100 tim (seluruh tim dalam liga) memiliki warna unik tanpa ada yang kembar.
const PALETTE = [
  // Siklus 1
  '#ef4444', // 1: Mendekati Merah (Red)
  '#f59e0b', // 2: Mendekati Kuning (Amber)
  '#10b981', // 3: Mendekati Hijau (Emerald)
  '#3b82f6', // 4: Mendekati Biru (Blue)

  // Siklus 2
  '#e11d48', // 5: Mendekati Merah (Rose)
  '#eab308', // 6: Mendekati Kuning (Yellow)
  '#00ff87', // 7: Mendekati Hijau (Neon Green)
  '#0284c7', // 8: Mendekati Biru (Sky Blue)

  // Siklus 3
  '#ec4899', // 9: Mendekati Merah (Pink)
  '#f97316', // 10: Mendekati Kuning (Orange)
  '#84cc16', // 11: Mendekati Hijau (Lime)
  '#4f46e5', // 12: Mendekati Biru (Dark Indigo)

  // Siklus 4
  '#fb7185', // 13: Mendekati Merah (Salmon)
  '#fbbf24', // 14: Mendekati Kuning (Bright Amber)
  '#14b8a6', // 15: Mendekati Hijau (Teal)
  '#06b6d4', // 16: Mendekati Biru (Cyan)

  // Siklus 5
  '#d946ef', // 17: Mendekati Merah (Fuchsia)
  '#a3e635', // 18: Mendekati Kuning (Bright Lime)
  '#2dd4bf', // 19: Mendekati Hijau (Light Teal)
  '#38bdf8', // 20: Mendekati Biru (Light Sky)

  // Siklus 6
  '#a855f7', // 21: Mendekati Merah (Purple)
  '#ca8a04', // 22: Mendekati Kuning (Goldenrod)
  '#059669', // 23: Mendekati Hijau (Dark Emerald)
  '#6366f1', // 24: Mendekati Biru (Slate Indigo)

  // Siklus 7
  '#dc2626', // 25: Mendekati Merah (Vivid Red)
  '#d97706', // 26: Mendekati Kuning (Deep Amber)
  '#16a34a', // 27: Mendekati Hijau (Green)
  '#2563eb', // 28: Mendekati Biru (Royal Blue)

  // Siklus 8
  '#db2777', // 29: Mendekati Merah (Hot Pink)
  '#ea580c', // 30: Mendekati Kuning (Tangerine)
  '#65a30d', // 31: Mendekati Hijau (Olive Lime)
  '#0891b2', // 32: Mendekati Biru (Deep Cyan)

  // Siklus 9
  '#be123c', // 33: Mendekati Merah (Crimson)
  '#b45309', // 34: Mendekati Kuning (Bronze Orange)
  '#0d9488', // 35: Mendekati Hijau (Dark Teal)
  '#1d4ed8', // 36: Mendekati Biru (Cobalt Blue)

  // Siklus 10
  '#f43f5e', // 37: Mendekati Merah (Coral Red)
  '#d48806', // 38: Mendekati Kuning (Warm Gold)
  '#22c55e', // 39: Mendekati Hijau (Vivid Green)
  '#0ea5e9', // 40: Mendekati Biru (Vibrant Sky)

  // Siklus 11
  '#c026d3', // 41: Mendekati Merah (Bright Magenta)
  '#f58320', // 42: Mendekati Kuning (Bright Tangerine)
  '#4ade80', // 43: Mendekati Hijau (Mint Green)
  '#4338ca', // 44: Mendekati Biru (Navy Indigo)

  // Siklus 12
  '#9f1239', // 45: Mendekati Merah (Deep Ruby)
  '#d9822b', // 46: Mendekati Kuning (Caramel Amber)
  '#15803d', // 47: Mendekati Hijau (Forest Green)
  '#0284c7', // 48: Mendekati Biru (Cerulean)

  // Siklus 13
  '#e879f9', // 49: Mendekati Merah (Light Orchid)
  '#fbb72c', // 50: Mendekati Kuning (Marigold)
  '#5eead4', // 51: Mendekati Hijau (Aquamarine)
  '#60a5fa', // 52: Mendekati Biru (Cornflower)

  // Siklus 14
  '#b91c1c', // 53: Mendekati Merah (Dark Crimson)
  '#c2410c', // 54: Mendekati Kuning (Rust Orange)
  '#166534', // 55: Mendekati Hijau (Dark Forest)
  '#1e40af', // 56: Mendekati Biru (Dark Blue)

  // Siklus 15
  '#f472b6', // 57: Mendekati Merah (Candy Pink)
  '#facc15', // 58: Mendekati Kuning (Sunflower Yellow)
  '#34d399', // 59: Mendekati Hijau (Seafoam)
  '#7c3aed', // 60: Mendekati Biru (Violet)

  // Siklus 16
  '#881337', // 61: Mendekati Merah (Burgundy)
  '#a16207', // 62: Mendekati Kuning (Honey Bronze)
  '#047857', // 63: Mendekati Hijau (Pine Green)
  '#1e3a8a', // 64: Mendekati Biru (Midnight Blue)

  // Siklus 17
  '#991b1b', // 65: Mendekati Merah (Brick Red)
  '#b45309', // 66: Mendekati Kuning (Burnt Amber)
  '#2f855a', // 67: Mendekati Hijau (Eucalyptus)
  '#2b6cb0', // 68: Mendekati Biru (Ocean Blue)

  // Siklus 18
  '#c53030', // 69: Mendekati Merah (Carmine)
  '#c05621', // 70: Mendekati Kuning (Copper Orange)
  '#276749', // 71: Mendekati Hijau (Jungle Green)
  '#2c5282', // 72: Mendekati Biru (Steel Blue)

  // Siklus 19
  '#9b2c2c', // 73: Mendekati Merah (Dark Maroon)
  '#975a16', // 74: Mendekati Kuning (Raw Umber)
  '#285e61', // 75: Mendekati Hijau (Dark Cypress)
  '#2a4365', // 76: Mendekati Biru (Prussian Blue)

  // Siklus 20
  '#d53f8c', // 77: Mendekati Merah (Raspberry)
  '#dd6b20', // 78: Mendekati Kuning (Mandarin)
  '#319795', // 79: Mendekati Hijau (Muted Teal)
  '#3182ce', // 80: Mendekati Biru (Azure)

  // Siklus 21
  '#e53e3e', // 81: Mendekati Merah (Alizarin)
  '#d69e2e', // 82: Mendekati Kuning (Dark Gold)
  '#38a169', // 83: Mendekati Hijau (Fern Green)
  '#4c51bf', // 84: Mendekati Biru (Denim Indigo)

  // Siklus 22
  '#97266d', // 85: Mendekati Merah (Plum)
  '#b7791f', // 86: Mendekati Kuning (Topaz)
  '#234e52', // 87: Mendekati Hijau (Deep Spruce)
  '#5b21b6', // 88: Mendekati Biru (Deep Violet)

  // Siklus 23
  '#ff2a5f', // 89: Mendekati Merah (Flamingo Red)
  '#ff922b', // 90: Mendekati Kuning (Clementine)
  '#00a86b', // 91: Mendekati Hijau (Jade Green)
  '#0077b6', // 92: Mendekati Biru (Star Blue)

  // Siklus 24
  '#c71585', // 93: Mendekati Merah (Medium Violet Red)
  '#b26b00', // 94: Mendekati Kuning (Dark Mustard)
  '#008080', // 95: Mendekati Hijau (Classic Teal)
  '#1890ff', // 96: Mendekati Biru (Daybreak Blue)

  // Siklus 25
  '#ad2102', // 97: Mendekati Merah (Mahogany Red)
  '#c67d00', // 98: Mendekati Kuning (Ochre Amber)
  '#137333', // 99: Mendekati Hijau (Google Green)
  '#1a73e8', // 100: Mendekati Biru (Google Blue)
];

export const StandingsChart: React.FC<StandingsChartProps> = ({
  standings,
  availableGWs,
  currentGW,
  onSelectManager,
  onSelectPlayer,
  initialChampionEntryIds,
}) => {
  // All available GWs sorted ascending
  const allAvailableGWs = useMemo(() => {
    const gws = (availableGWs && availableGWs.length > 0 ? availableGWs : [currentGW || 1])
      .slice()
      .sort((a, b) => a - b);
    return gws;
  }, [availableGWs, currentGW]);

  const minGW = allAvailableGWs[0] || 1;
  const maxGW = allAvailableGWs[allAvailableGWs.length - 1] || 1;

  // Gameweek range filter (default: from minGW to maxGW, or restored from in-memory session)
  const [startGW, setStartGW] = useState<number>(() => {
    if (chartSessionState?.startGW !== undefined && allAvailableGWs.includes(chartSessionState.startGW)) {
      return chartSessionState.startGW;
    }
    return minGW;
  });
  const [endGW, setEndGW] = useState<number>(() => {
    if (chartSessionState?.endGW !== undefined && allAvailableGWs.includes(chartSessionState.endGW)) {
      return chartSessionState.endGW;
    }
    return maxGW;
  });
  const [isStartGWOpen, setIsStartGWOpen] = useState(false);
  const [isEndGWOpen, setIsEndGWOpen] = useState(false);

  // Active GWs displayed on the chart
  const sortedGWs = useMemo(() => {
    const s = Math.min(startGW, endGW);
    const e = Math.max(startGW, endGW);
    const filtered = allAvailableGWs.filter((gw) => gw >= s && gw <= e);
    return filtered.length > 0 ? filtered : allAvailableGWs;
  }, [allAvailableGWs, startGW, endGW]);

  const { language, t } = useLanguage();
  const latestGW = sortedGWs[sortedGWs.length - 1] || maxGW;

  // Chart Metric Selection (Default: Last Rank, or restored from session)
  const [metricType, setMetricType] = useState<ChartMetricType>(() => {
    return chartSessionState?.metricType || 'last_rank';
  });

  // Preset Filter (Default: All Teams, or restored from session)
  const [rankPreset, setRankPreset] = useState<RankPreset>(() => {
    return chartSessionState?.rankPreset || 'all';
  });

  // Multiple Picker State (Initial: 4 status champion teams on fresh load, or restored from session)
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number> | null>(() => {
    if (chartSessionState?.selectedEntryIds !== undefined) {
      return chartSessionState.selectedEntryIds ? new Set(chartSessionState.selectedEntryIds) : null;
    }
    if (initialChampionEntryIds && initialChampionEntryIds.length > 0) {
      return new Set(initialChampionEntryIds);
    }
    return null;
  });
  const [isTeamSelectorOpen, setIsTeamSelectorOpen] = useState(false);
  const [teamSelectorSearch, setTeamSelectorSearch] = useState('');

  // If initialChampionEntryIds arrives after initial render and user has not interacted yet, apply it
  const hasInitializedFromChampionsRef = useRef(false);
  useEffect(() => {
    if (chartSessionState !== null) return;
    if (hasInitializedFromChampionsRef.current) return;
    if (initialChampionEntryIds && initialChampionEntryIds.length > 0) {
      setSelectedEntryIds(new Set(initialChampionEntryIds));
      hasInitializedFromChampionsRef.current = true;
    }
  }, [initialChampionEntryIds]);

  // Toggles (Default: all false, or restored from session)
  const [showChips, setShowChips] = useState<boolean>(() => {
    return chartSessionState?.showChips ?? false;
  });
  const [showHits, setShowHits] = useState<boolean>(() => {
    return chartSessionState?.showHits ?? false;
  });
  const [showCaptains, setShowCaptains] = useState<boolean>(() => {
    return chartSessionState?.showCaptains ?? false;
  });

  // Keep in-memory session cache updated so switching tabs/subtabs preserves choices
  useEffect(() => {
    chartSessionState = {
      startGW,
      endGW,
      metricType,
      rankPreset,
      selectedEntryIds: selectedEntryIds ? new Set(selectedEntryIds) : null,
      showChips,
      showHits,
      showCaptains,
    };
  }, [startGW, endGW, metricType, rankPreset, selectedEntryIds, showChips, showHits, showCaptains]);

  // Hovered / highlighted team
  const [hoveredEntryId, setHoveredEntryId] = useState<number | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<{
    x: number;
    y: number;
    team: TeamSeries;
    gw: number;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoldTriggeredRef = useRef<boolean>(false);

  const startHold = useCallback((entryId: number) => {
    isHoldTriggeredRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      isHoldTriggeredRef.current = true;
      setHoveredEntryId((prev) => (prev === entryId ? null : entryId));
    }, 350);
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handleLineClick = useCallback(
    (e: React.MouseEvent<SVGElement>) => {
      cancelHold();
      if (isHoldTriggeredRef.current) {
        isHoldTriggeredRef.current = false;
        return;
      }
      // Saat klik garis pada chart tidak ada action apapun (kecuali hold click yang ditangani oleh startHold)
      e.stopPropagation();
    },
    [cancelHold]
  );

  // Measure Row 2 width (GW selector through Captains toggle) to align Row 1 (Metric selector) exactly
  const row2Ref = useRef<HTMLDivElement>(null);
  const [row2Width, setRow2Width] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!row2Ref.current) return;
    const updateWidth = () => {
      if (row2Ref.current) {
        setRow2Width(row2Ref.current.offsetWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(row2Ref.current);
    return () => ro.disconnect();
  }, []);

  // 1. Calculate per-GW ranks and build series for all teams
  const { allTeams, teamsMap } = useMemo(() => {
    // Map of GW -> Map of entryId -> GW Rank
    const gwRanksMap: Record<number, Record<number, number>> = {};

    sortedGWs.forEach((gw) => {
      const rows = standings[gw] || [];
      // Sort rows by event_points descending. If event_points are equal, break tie by last_rank (r.rank) ascending.
      const sortedByGwPoints = [...rows].sort((a, b) => {
        const ptsDiff = (b.event_points || 0) - (a.event_points || 0);
        if (ptsDiff !== 0) return ptsDiff;
        // Tie breaker: last_rank (r.rank) at the respective GW (lower rank number = better)
        return (a.rank || 999) - (b.rank || 999);
      });
      const rMap: Record<number, number> = {};
      sortedByGwPoints.forEach((r, idx) => {
        // Unique 1-based sequential rank so no two teams have the same GW rank
        rMap[r.entry_id] = idx + 1;
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
    let list: TeamSeries[] = [];
    // If multiple picker is active (not null)
    if (selectedEntryIds !== null) {
      list = allTeams.filter((t) => selectedEntryIds.has(t.entryId));
    } else {
      // Otherwise apply Rank Preset
      switch (rankPreset) {
        case '1-20':
          list = allTeams.filter((t) => t.latestRank >= 1 && t.latestRank <= 20);
          break;
        case '21-40':
          list = allTeams.filter((t) => t.latestRank >= 21 && t.latestRank <= 40);
          break;
        case '41-60':
          list = allTeams.filter((t) => t.latestRank >= 41 && t.latestRank <= 60);
          break;
        case '61-80':
          list = allTeams.filter((t) => t.latestRank >= 61 && t.latestRank <= 80);
          break;
        case '81-100':
          list = allTeams.filter((t) => t.latestRank >= 81);
          break;
        case 'all':
        default:
          list = allTeams;
          break;
      }
    }

    // Dynamic color assignment:
    // If user picks manual teams, presets, or All Teams (up to 100 teams), each visible team receives
    // a unique, distinct color from the 100 palette colors so no two teams have the same color.
    return list.map((team, idx) => ({
      ...team,
      color: PALETTE[idx % PALETTE.length],
    }));
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

  // Preset options configuration for unified team selector
  const rankPresetOptions: Array<{ id: RankPreset; label: string }> = useMemo(
    () => {
      const isId = language === 'id';
      const rankWord = isId ? 'Peringkat' : 'Ranks';
      const allWord = isId ? 'Semua Tim' : 'All Teams';
      return [
        { id: 'all', label: allWord },
        { id: '1-20', label: `${rankWord} 1–20` },
        { id: '21-40', label: `${rankWord} 21–40` },
        { id: '41-60', label: `${rankWord} 41–60` },
        { id: '61-80', label: `${rankWord} 61–80` },
        { id: '81-100', label: `${rankWord} 81–${totalTeamsCount}` },
      ];
    },
    [totalTeamsCount, language]
  );

  const currentTeamSelectorLabel = useMemo(() => {
    const isId = language === 'id';
    const allWord = isId ? 'Semua Tim' : 'All Teams';
    const teamsWord = isId ? 'Tim' : 'Teams';
    if (selectedEntryIds !== null) {
      if (selectedEntryIds.size === allTeams.length) {
        return `${allWord} (${allTeams.length})`;
      }
      return `${selectedEntryIds.size} ${teamsWord}`;
    }
    if (rankPreset === 'all') {
      return `${allWord} (${allTeams.length})`;
    }
    const found = rankPresetOptions.find((o) => o.id === rankPreset);
    return found ? `${found.label} (${visibleTeams.length})` : `${allWord} (${allTeams.length})`;
  }, [selectedEntryIds, allTeams.length, rankPreset, rankPresetOptions, visibleTeams.length, language]);

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
  // Jarak antar-Gameweek dibuat rapat & padat (~60px) agar kemiringan tanjakan/turunan terlihat tegas
  const gwStep = 60;
  const plotWidth = Math.max(180, (sortedGWs.length - 1) * gwStep);
  const svgHeight = 560;

  const margin = {
    top: 36,
    right: 165, // single neat column for team names
    bottom: 50,
    left: 56,
  };

  const svgWidth = margin.left + plotWidth + margin.right;
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

  // Team names placed directly beside their exact endpoint without shifting
  const endLabels = useMemo(() => {
    return visibleTeams
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
          lastRank: lastDp.last_rank || t.latestRank || 999,
        };
      })
      .filter(Boolean) as Array<{
      entryId: number;
      entryName: string;
      color: string;
      y: number;
      val: number;
      lastRank: number;
    }>;
  }, [visibleTeams, latestGW, getValue, getY]);

  // Universal comparator for rendering order (bottom of chart rendered first -> top of chart rendered last)
  // Tie-breaker: If values on the chart at latestGW are equal (e.g., same points), the team with better last_rank (lower number) is rendered later (on top)
  const compareByChartPosition = useCallback(
    (
      a: { entryId: number; val: number; lastRank: number },
      b: { entryId: number; val: number; lastRank: number }
    ): number => {
      // 1. Hovered team is always in the absolute foreground (rendered last)
      if (a.entryId === hoveredEntryId) return 1;
      if (b.entryId === hoveredEntryId) return -1;

      // 2. Primary order: Chart vertical position from bottom to top
      if (isRankMetric) {
        // Rank metrics (Last Rank, GW Rank):
        // Higher rank number (e.g. 100, 80) is at the BOTTOM -> rendered first
        // Lower rank number (e.g. 2, 1) is at the TOP -> rendered last (on top)
        const diff = b.val - a.val;
        if (diff !== 0) return diff;
      } else {
        // Points metrics (Total Pts, GW Pts, or any future point/score metrics):
        // Lower points (e.g. 10 pts) are at the BOTTOM -> rendered first
        // Higher points (e.g. 90 pts) are at the TOP -> rendered last (on top)
        const diff = a.val - b.val;
        if (diff !== 0) return diff;
      }

      // 3. Tie-breaker for identical value:
      // Team with better last_rank (smaller number, e.g. Rank 5 vs Rank 10) is rendered last (on top)
      return b.lastRank - a.lastRank;
    },
    [hoveredEntryId, isRankMetric]
  );

  return (
    <div className="space-y-4">
      {/* Top Filter and Controls Bar - Space-saving layout */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-2 sm:p-2.5 shadow-xs space-y-1.5">
        {/* Top Control Block: Row 1 & Row 2 with matching total width */}
        <div className="inline-flex flex-col gap-1.5 items-start max-w-full">
          {/* Row 1: Metric Selector with equal width for all chart types, matching Row 2 width */}
          <div
            className="grid grid-cols-4 p-0.5 bg-slate-100 rounded-lg border border-slate-200/70"
            style={{ width: row2Width ? `${row2Width}px` : 'auto' }}
          >
            {(
              [
                { id: 'last_rank', label: t('chart_last_rank') },
                { id: 'gw_rank', label: t('chart_gw_rank') },
                { id: 'total_points', label: t('chart_total_pts') },
                { id: 'event_points', label: t('chart_gw_pts') },
              ] as const
            ).map((item) => {
              const active = metricType === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMetricType(item.id)}
                  className={`py-1 rounded-md text-[11.5px] font-bold text-center transition-all cursor-pointer truncate ${
                    active
                      ? 'bg-[#37003c] text-[#00ff87] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Row 2: Gameweek Range Selector on left, Badges toggles to its right, anchored to the left */}
          <div
            ref={row2Ref}
            className="inline-flex items-center gap-1.5 flex-nowrap justify-start"
          >
            {/* Custom Non-Native Gameweek Range Selector */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200/70 text-xs font-semibold text-slate-700">
              {/* Start GW Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setIsStartGWOpen(!isStartGWOpen);
                    setIsEndGWOpen(false);
                    setIsTeamSelectorOpen(false);
                  }}
                  className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer flex items-center gap-1"
                >
                  <span>GW {startGW}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {isStartGWOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setIsStartGWOpen(false)} />
                    <div className="absolute left-0 mt-1 w-24 max-h-48 overflow-y-auto bg-white rounded-lg shadow-xl border border-slate-200 z-40 p-1 divide-y divide-slate-50">
                      {allAvailableGWs.map((gw) => (
                        <button
                          key={`start-opt-${gw}`}
                          onClick={() => {
                            setStartGW(gw);
                            if (gw > endGW) setEndGW(gw);
                            setIsStartGWOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            gw === startGW
                              ? 'bg-[#37003c] text-[#00ff87]'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          GW {gw}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <span className="text-slate-400 font-bold px-0.5">–</span>

              {/* End GW Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setIsEndGWOpen(!isEndGWOpen);
                    setIsStartGWOpen(false);
                    setIsTeamSelectorOpen(false);
                  }}
                  className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-800 hover:bg-slate-50 cursor-pointer flex items-center gap-1"
                >
                  <span>GW {endGW}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {isEndGWOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setIsEndGWOpen(false)} />
                    <div className="absolute left-0 mt-1 w-24 max-h-48 overflow-y-auto bg-white rounded-lg shadow-xl border border-slate-200 z-40 p-1 divide-y divide-slate-50">
                      {allAvailableGWs.map((gw) => (
                        <button
                          key={`end-opt-${gw}`}
                          onClick={() => {
                            setEndGW(gw);
                            if (gw < startGW) setStartGW(gw);
                            setIsEndGWOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1 rounded text-xs font-bold cursor-pointer transition-colors ${
                            gw === endGW
                              ? 'bg-[#37003c] text-[#00ff87]'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          GW {gw}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Badges Toggles (Chips, Hits, Captains) - Placed to the right of GW selector, anchored to the left */}
            <div className="flex items-center gap-1.5">
              {/* Chip Used Toggle */}
              <button
                onClick={() => setShowChips(!showChips)}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                  showChips
                    ? 'bg-purple-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t('chart_chips')}
              </button>

              {/* Hits Toggle (Rose/Red) */}
              <button
                onClick={() => setShowHits(!showHits)}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                  showHits
                    ? 'bg-rose-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t('chart_hits')}
              </button>

              {/* Captained Player Toggle (Teal/Cyan) */}
              <button
                onClick={() => setShowCaptains(!showCaptains)}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                  showCaptains
                    ? 'bg-teal-800 text-teal-100 shadow-xs ring-1 ring-teal-500'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t('chart_captains')}
              </button>
            </div>
          </div>
        </div>

        {/* Row 3: Filter Teams (Placed below GW selector, anchored to the left) */}
        <div className="flex items-center gap-1.5 flex-wrap justify-start">
          <div className="relative">
            <button
              onClick={() => {
                setIsTeamSelectorOpen(!isTeamSelectorOpen);
                setIsStartGWOpen(false);
                setIsEndGWOpen(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center border transition-all cursor-pointer ${
                selectedEntryIds !== null || rankPreset !== 'all'
                  ? 'bg-purple-50 text-purple-900 border-purple-300 ring-1 ring-purple-400'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/80'
              }`}
            >
              <span>{currentTeamSelectorLabel}</span>
            </button>

            {/* Combined Popover Dropdown */}
            {isTeamSelectorOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsTeamSelectorOpen(false)}
                />
                <div className="absolute left-0 mt-1.5 w-72 sm:w-80 bg-white rounded-xl shadow-2xl border border-slate-200 z-40 p-2.5 animate-in fade-in zoom-in-95">
                  {/* Section 1: Quick Rank Presets */}
                  <div className="pb-2 border-b border-slate-100">
                    <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                      {t('chart_filter_by_rank')}
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {rankPresetOptions.map((opt) => {
                        const isSelected = selectedEntryIds === null && rankPreset === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => {
                              handlePresetChange(opt.id);
                              setIsTeamSelectorOpen(false);
                            }}
                            className={`px-2 py-1 rounded-md text-[11px] font-semibold text-center transition-colors cursor-pointer truncate ${
                              isSelected
                                ? 'bg-[#37003c] text-[#00ff87] font-bold shadow-xs'
                                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 2: Manual Team Picker */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between pb-1.5">
                      <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                        {t('chart_select_individual')}
                      </span>
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          onClick={handleSelectAllTeams}
                          className="text-purple-700 hover:underline font-bold px-1.5 py-0.5 rounded hover:bg-purple-50 cursor-pointer"
                        >
                          {t('chart_all')}
                        </button>
                        <span className="text-slate-300">•</span>
                        <button
                          onClick={handleClearAllTeams}
                          className="text-slate-500 hover:underline font-bold px-1.5 py-0.5 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          {t('chart_clear')}
                        </button>
                      </div>
                    </div>

                    {/* Search Field */}
                    <div className="relative my-1.5">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder={t('chart_search_team')}
                        value={teamSelectorSearch}
                        onChange={(e) => setTeamSelectorSearch(e.target.value)}
                        className="w-full text-xs pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-600"
                      />
                    </div>

                    {/* Team List with Checkboxes */}
                    <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1 divide-y divide-slate-50">
                      {alphabeticalTeams
                        .filter((t) =>
                          t.entryName.toLowerCase().includes(teamSelectorSearch.toLowerCase())
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
                    <div className="pt-2 mt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 font-medium">
                        {t('chart_teams_shown', { N: visibleTeams.length })}
                      </span>
                      <button
                        onClick={() => setIsTeamSelectorOpen(false)}
                        className="bg-[#37003c] text-white px-3 py-1 rounded-md font-bold hover:bg-[#37003c]/90 cursor-pointer"
                      >
                        {t('chart_done')}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick Reset Button if filtered */}
          {(rankPreset !== 'all' || selectedEntryIds !== null) && (
            <button
              onClick={() => {
                setRankPreset('all');
                setSelectedEntryIds(null);
                setIsTeamSelectorOpen(false);
              }}
              title={language === 'id' ? 'Reset ke Semua Tim' : 'Reset to All Teams'}
              className="px-2 py-1 rounded-lg text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 flex items-center cursor-pointer transition-colors"
            >
              <span>{t('chart_reset')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div
        ref={containerRef}
        className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-2 sm:p-4 overflow-x-auto relative"
      >
        {/* SVG Visualization */}
        <div className="min-w-fit relative">
          <svg
            ref={svgRef}
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

            {/* Render Team Lines: sorted from bottom to top of chart, with tie-break by last_rank, and hovered team on top */}
            {[...visibleTeams]
              .sort((a, b) => {
                const aDp = a.dataPoints[latestGW];
                const bDp = b.dataPoints[latestGW];
                const aVal = aDp ? getValue(aDp) : (isRankMetric ? 999 : -999);
                const bVal = bDp ? getValue(bDp) : (isRankMetric ? 999 : -999);
                const aRank = aDp?.last_rank || a.latestRank || 999;
                const bRank = bDp?.last_rank || b.latestRank || 999;
                return compareByChartPosition(
                  { entryId: a.entryId, val: aVal, lastRank: aRank },
                  { entryId: b.entryId, val: bVal, lastRank: bRank }
                );
              })
              .map((team) => {
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

              // Garis lurus tegas untuk membaca kemiringan (slope) kenaikan/penurunan secara akurat
              const pathD = points.reduce((acc, p, idx) => {
                return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
              }, '');

              return (
                <g
                  key={`line-${team.entryId}`}
                  className="transition-opacity duration-150 cursor-pointer"
                  opacity={isDimmed ? 0.15 : 1}
                  onMouseEnter={() => setHoveredEntryId(team.entryId)}
                  onMouseDown={() => startHold(team.entryId)}
                  onMouseUp={cancelHold}
                  onMouseLeave={cancelHold}
                  onTouchStart={() => startHold(team.entryId)}
                  onTouchEnd={cancelHold}
                  onTouchCancel={cancelHold}
                  onClick={handleLineClick}
                >
                  {/* Invisible thick stroke for easy mouse hovering and clicking */}
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

                  {/* Data Points (Dots) */}
                  {points.map((p) => {
                    const dotRadius = isHovered ? 4.2 : 1.5;
                    return (
                      <g key={`pt-${team.entryId}-${p.gw}`}>
                        {/* Transparent larger hit area for point click and hover */}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 10 : 7}
                          fill="transparent"
                          className="cursor-pointer"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            startHold(team.entryId);
                          }}
                          onMouseUp={cancelHold}
                          onMouseLeave={cancelHold}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            startHold(team.entryId);
                          }}
                          onTouchEnd={cancelHold}
                          onTouchCancel={cancelHold}
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelHold();
                            if (isHoldTriggeredRef.current) {
                              isHoldTriggeredRef.current = false;
                              return;
                            }
                            onSelectManager?.(team.entryId, p.gw);
                          }}
                          onMouseEnter={() => {
                            setHoveredEntryId(team.entryId);
                            setActiveTooltip({
                              x: p.x,
                              y: p.y,
                              team,
                              gw: p.gw,
                            });
                          }}
                        />
                        {/* Visual Dot */}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={dotRadius}
                          fill={isHovered ? '#ffffff' : team.color}
                          stroke={team.color}
                          strokeWidth={isHovered ? 2.2 : 0.7}
                          className="pointer-events-none"
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Badges Layer (Chips, Hits, Captains): rendered in separate sorted layer from bottom to top following team names, with hovered team on top */}
            {(showChips || showHits || showCaptains) &&
              [...visibleTeams]
                .sort((a, b) => {
                  const aDp = a.dataPoints[latestGW];
                  const bDp = b.dataPoints[latestGW];
                  const aVal = aDp ? getValue(aDp) : (isRankMetric ? 999 : -999);
                  const bVal = bDp ? getValue(bDp) : (isRankMetric ? 999 : -999);
                  const aRank = aDp?.last_rank || a.latestRank || 999;
                  const bRank = bDp?.last_rank || b.latestRank || 999;
                  return compareByChartPosition(
                    { entryId: a.entryId, val: aVal, lastRank: aRank },
                    { entryId: b.entryId, val: bVal, lastRank: bRank }
                  );
                })
                .map((team) => {
                  const isHovered = hoveredEntryId === team.entryId;
                  const isDimmed = hoveredEntryId !== null && !isHovered;

                  const badgeFontSize = isHovered ? '8.5' : '3.6';
                  const boxHeight = isHovered ? 9.5 : 4.4;
                  const textYOffset = isHovered ? 0.6 : 0.2;
                  const dotRadius = isHovered ? 3.8 : 1.2;
                  const gapToDot = isHovered ? 2.5 : 1.2;
                  const gapBetweenBadges = isHovered ? 2 : 1;

                  return (
                    <g
                      key={`badges-group-${team.entryId}`}
                      opacity={isDimmed ? 0.15 : 1}
                      className="transition-opacity duration-150"
                    >
                      {sortedGWs.map((gw) => {
                        const dp = team.dataPoints[gw];
                        if (!dp) return null;
                        const val = getValue(dp);
                        const px = getX(gw);
                        const py = getY(val);

                        const hasChip = showChips && !!dp.active_chip;
                        const hasHits = showHits && dp.hits > 0;
                        const hasCaptain = showCaptains && !!dp.captain;

                        if (!hasChip && !hasHits && !hasCaptain) return null;

                        const isStartGW = gw === sortedGWs[0];

                        // Widths calculation
                        const chipText = dp.active_chip || '';
                        const chipWidth = isHovered
                          ? (chipText.length > 2 ? 20 : 15)
                          : (chipText.length > 2 ? 9.5 : 7.2);

                        const hitsText = `-${dp.hits}`;
                        const hitsWidth = isHovered ? 14 : 6.8;

                        const captainName = dp.captain?.name?.slice(0, 6) || '';
                        const captainWidth = isHovered
                          ? Math.max(28, captainName.length * 5 + 6)
                          : Math.max(12, captainName.length * 2.2 + 3);

                        // Position calculation:
                        // Jika isStartGW: Tetap di sebelah KANAN dot (agar tidak menabrak sumbu Y)
                        // [Dot] -> [Chips] -> [Hits] -> [Captains]
                        //
                        // Selain GW start: Di sebelah KIRI dot
                        // [Captains] <- [Hits] <- [Chips] <- [Dot]

                        let chipBadgeX = 0;
                        let hitsBadgeX = 0;
                        let captainBadgeX = 0;

                        if (isStartGW) {
                          // Right side of dot (khusus untuk GW start): Dot -> Chips -> Hits -> Captains
                          let currRight = px + dotRadius + gapToDot;

                          if (hasChip) {
                            chipBadgeX = currRight + chipWidth / 2;
                            currRight += chipWidth + gapBetweenBadges;
                          }
                          if (hasHits) {
                            hitsBadgeX = currRight + hitsWidth / 2;
                            currRight += hitsWidth + gapBetweenBadges;
                          }
                          if (hasCaptain) {
                            captainBadgeX = currRight + captainWidth / 2;
                            currRight += captainWidth + gapBetweenBadges;
                          }
                        } else {
                          // Left side of dot (untuk semua GW selain start): Captains <- Hits <- Chips <- Dot
                          let currLeft = px - dotRadius - gapToDot;

                          if (hasChip) {
                            chipBadgeX = currLeft - chipWidth / 2;
                            currLeft -= chipWidth + gapBetweenBadges;
                          }
                          if (hasHits) {
                            hitsBadgeX = currLeft - hitsWidth / 2;
                            currLeft -= hitsWidth + gapBetweenBadges;
                          }
                          if (hasCaptain) {
                            captainBadgeX = currLeft - captainWidth / 2;
                            currLeft -= captainWidth + gapBetweenBadges;
                          }
                        }

                        return (
                          <g key={`badges-${team.entryId}-${gw}`}>
                            {/* Chip Badge */}
                            {hasChip && (
                              <g transform={`translate(${chipBadgeX}, ${py})`}>
                                <rect
                                  x={-chipWidth / 2}
                                  y={-boxHeight / 2}
                                  width={chipWidth}
                                  height={boxHeight}
                                  rx={isHovered ? 2 : 1}
                                  fill="#37003c"
                                  stroke="#00ff87"
                                  strokeWidth={isHovered ? 0.7 : 0.25}
                                />
                                <text
                                  x="0"
                                  y={textYOffset}
                                  dominantBaseline="central"
                                  textAnchor="middle"
                                  fontSize={badgeFontSize}
                                  fontWeight="900"
                                  fill="#00ff87"
                                >
                                  {chipText}
                                </text>
                              </g>
                            )}

                            {/* Hits Badge */}
                            {hasHits && (
                              <g transform={`translate(${hitsBadgeX}, ${py})`}>
                                <rect
                                  x={-hitsWidth / 2}
                                  y={-boxHeight / 2}
                                  width={hitsWidth}
                                  height={boxHeight}
                                  rx={isHovered ? 2 : 1}
                                  fill="#e11d48"
                                />
                                <text
                                  x="0"
                                  y={textYOffset}
                                  dominantBaseline="central"
                                  textAnchor="middle"
                                  fontSize={badgeFontSize}
                                  fontWeight="900"
                                  fill="#ffffff"
                                >
                                  {hitsText}
                                </text>
                              </g>
                            )}

                            {/* Captain Badge */}
                            {hasCaptain && dp.captain && (
                              <g
                                transform={`translate(${captainBadgeX}, ${py})`}
                                className={onSelectPlayer ? 'cursor-pointer hover:opacity-80' : ''}
                                onClick={(e) => {
                                  if (onSelectPlayer && dp.captain?.id) {
                                    e.stopPropagation();
                                    onSelectPlayer(dp.captain.id, dp.gw);
                                  }
                                }}
                              >
                                <rect
                                  x={-captainWidth / 2}
                                  y={-boxHeight / 2}
                                  width={captainWidth}
                                  height={boxHeight}
                                  rx={isHovered ? 2 : 1}
                                  fill="#0f766e"
                                  stroke="#5eead4"
                                  strokeWidth={isHovered ? 0.7 : 0.25}
                                />
                                <text
                                  x="0"
                                  y={textYOffset}
                                  dominantBaseline="central"
                                  textAnchor="middle"
                                  fontSize={badgeFontSize}
                                  fontWeight="800"
                                  fill="#ccfbf1"
                                >
                                  {captainName}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })}

            {/* Team Names on Right Edge: sorted from bottom to top of chart, with tie-break by last_rank, and hovered team on top */}
            {[...endLabels]
              .sort((a, b) => compareByChartPosition(a, b))
              .map((lbl) => {
                const isHovered = hoveredEntryId === lbl.entryId;
                const isDimmed = hoveredEntryId !== null && !isHovered;
                const lastX = getX(latestGW);
                const labelX = lastX + 5;

                return (
                  <g
                    key={`lbl-${lbl.entryId}`}
                    className="cursor-pointer select-none transition-opacity duration-150"
                    opacity={isDimmed ? 0.25 : 1}
                    onMouseEnter={() => setHoveredEntryId(lbl.entryId)}
                    onMouseDown={() => startHold(lbl.entryId)}
                    onMouseUp={cancelHold}
                    onMouseLeave={cancelHold}
                    onTouchStart={() => startHold(lbl.entryId)}
                    onTouchEnd={cancelHold}
                    onTouchCancel={cancelHold}
                    onClick={() => {
                      cancelHold();
                      if (isHoldTriggeredRef.current) {
                        isHoldTriggeredRef.current = false;
                        return;
                      }
                      onSelectManager?.(lbl.entryId, latestGW);
                    }}
                  >
                    {/* Team Name Label placed directly at exact last y position with matching line color */}
                    <text
                      x={labelX}
                      y={lbl.y}
                      dominantBaseline="central"
                      fontSize={isHovered ? '11' : '4.5'}
                      fontWeight={isHovered ? '900' : '700'}
                      fill={lbl.color}
                      stroke="white"
                      strokeWidth={isHovered ? 2.5 : 0.4}
                      paintOrder="stroke fill"
                      className="chart-team-label"
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
              <div
                className="font-black text-sm truncate"
                style={{ color: activeTooltip.team.color }}
              >
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
                      ? t('chart_last_rank')
                      : metricType === 'gw_rank'
                      ? t('chart_gw_rank')
                      : metricType === 'total_points'
                      ? t('chart_total_pts')
                      : t('chart_gw_pts')}
                  </span>
                  <span className="font-extrabold text-[#00ff87]">
                    {isRankMetric ? '#' : ''}
                    {getValue(activeTooltip.team.dataPoints[activeTooltip.gw])}
                    {!isRankMetric ? (language === 'id' ? ' poin' : ' pts') : ''}
                  </span>
                </div>
              </div>

              {/* Extra chips or captain details in tooltip */}
              {activeTooltip.team.dataPoints[activeTooltip.gw] && (
                <div className="space-y-0.5 text-[10px] text-slate-300 pt-1 border-t border-white/5">
                  {activeTooltip.team.dataPoints[activeTooltip.gw].captain && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">{language === 'id' ? 'Kapten:' : 'Captain:'}</span>
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
                      <span className="text-slate-400">{language === 'id' ? 'Penalti Hit:' : 'Transfer Hits:'}</span>
                      <span className="font-bold text-rose-300">
                        -{activeTooltip.team.dataPoints[activeTooltip.gw].hits} {language === 'id' ? 'poin' : 'pts'}
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
