import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUpDown,
  Calendar,
  Layers,
  LayoutGrid,
  Filter,
  CheckCircle,
  AlertCircle,
  XCircle,
  Shield,
  Clock,
  Sparkles,
  Minus,
  Plus,
  Sliders,
  ZoomIn,
  ZoomOut,
  List
} from 'lucide-react';
import {
  TransformedLeagueData,
  ProjectionSubTab,
  PositionType,
  GwEventStatus,
  SyncStatus,
  FplProvenStatus,
  ProjectionClubItem,
  ProjectedSquadPlayer,
  PlayerGwProjectionCell,
} from '../types.ts';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { useLanguage } from '../utils/i18n.ts';
import { useUserProfileId, USER_ROW_BG, USER_ROW_HOVER_BG } from '../utils/userProfile.ts';
import { useSeasonProjections } from '../hooks/useSeasonProjections.ts';

export type SeasonProjectionsEngineResult = ReturnType<typeof useSeasonProjections>;

const FALLBACK_PREMIER_LEAGUE_CLUBS: ProjectionClubItem[] = [
  { id: 1, name: 'Arsenal', short: 'ARS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t3.png' },
  { id: 2, name: 'Aston Villa', short: 'AVL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t7.png' },
  { id: 3, name: 'Bournemouth', short: 'BOU', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t91.png' },
  { id: 4, name: 'Brentford', short: 'BRE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t94.png' },
  { id: 5, name: 'Brighton', short: 'BHA', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t36.png' },
  { id: 6, name: 'Chelsea', short: 'CHE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t8.png' },
  { id: 7, name: 'Coventry City', short: 'COV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t9.png' },
  { id: 8, name: 'Crystal Palace', short: 'CRY', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t31.png' },
  { id: 9, name: 'Everton', short: 'EVE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t11.png' },
  { id: 10, name: 'Fulham', short: 'FUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t54.png' },
  { id: 11, name: 'Hull City', short: 'HUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t88.png' },
  { id: 12, name: 'Ipswich Town', short: 'IPS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t40.png' },
  { id: 13, name: 'Leeds', short: 'LEE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t2.png' },
  { id: 14, name: 'Liverpool', short: 'LIV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t14.png' },
  { id: 15, name: 'Man City', short: 'MCI', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t43.png' },
  { id: 16, name: 'Man Utd', short: 'MUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t1.png' },
  { id: 17, name: 'Newcastle', short: 'NEW', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t4.png' },
  { id: 18, name: "Nott'm Forest", short: 'NFO', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t17.png' },
  { id: 19, name: 'Spurs', short: 'TOT', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t6.png' },
  { id: 20, name: 'Sunderland', short: 'SUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t56.png' }
];

interface TabProjectionProps {
  leagueData?: TransformedLeagueData;
  currentGW?: number;
  availableGWs?: number[];
  subTab: ProjectionSubTab;
  onSelectSubTab?: (sub: ProjectionSubTab) => void;
  onSelectManager?: (managerId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
  onProjectionsComputed?: (projections: any[]) => void;
  sharedEngine?: SeasonProjectionsEngineResult;
}

// Helper to format ISO Kickoff string into clean date
function formatKickoff(isoStr?: string, isIdLang = false): string {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = d.toLocaleDateString(isIdLang ? 'id-ID' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Jakarta'
    });
    const time = d.toLocaleTimeString(isIdLang ? 'id-ID' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta'
    });
    return `${day} • ${time} WIB`;
  } catch {
    return isoStr;
  }
}

// Football position hierarchy (GKP -> DEF -> MID -> FWD)
const POS_ORDER: Record<string, number> = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4
};

// Lineup role hierarchy (Starting XI -> Bench -> Out)
const ROLE_ORDER: Record<string, number> = {
  starting: 1,
  bench: 2,
  out: 3
};

export const TabProjection: React.FC<TabProjectionProps> = ({
  leagueData,
  currentGW,
  availableGWs = [],
  subTab,
  onSelectPlayer,
  gwStatus,
  eventsStatus,
  onProjectionsComputed,
  sharedEngine,
}) => {
  const { language } = useLanguage();
  const isIdLang = language === 'id';
  const profileId = useUserProfileId();

  const localEngine = useSeasonProjections({
    leagueData,
    currentGW,
    availableGWs,
    gwStatus,
    eventsStatus,
    enabled: !sharedEngine,
  });
  const engine = sharedEngine || localEngine;
  const {
    baseHistoricalGW,
    targetNextGW,
    matchesByGW,
    isLoadingMatches,
    projectFixture,
    clubNextMatchMap,
    clubNextMatchesMap,
    clubSquadProjections,
    allPlayerFullSeasonProjections,
  } = engine;

  const clubs = useMemo<ProjectionClubItem[]>(
    () => (engine.clubs && engine.clubs.length > 0 ? engine.clubs : FALLBACK_PREMIER_LEAGUE_CLUBS),
    [engine.clubs]
  );

  // Owned player IDs for user profile highlighting & "Tim Saya" filter
  const ownedPlayerIds = useMemo<Set<number>>(() => {
    const ids = new Set<number>();
    if (!profileId || !leagueData?.ownership_players) return ids;
    const candidateGws = [
      currentGW,
      baseHistoricalGW,
      ...Object.keys(leagueData.ownership_players)
        .map(Number)
        .filter((g) => !isNaN(g) && (leagueData.ownership_players[g]?.length || 0) > 0)
        .sort((a, b) => b - a),
    ].filter((g): g is number => typeof g === 'number' && g > 0);
    const targetList = candidateGws.map((g) => leagueData.ownership_players[g]).find((arr) => Array.isArray(arr) && arr.length > 0);
    if (targetList) {
      for (const p of targetList) {
        if (p.owners?.some((o) => o.entry_id === profileId)) {
          ids.add(p.id);
        }
      }
    }
    return ids;
  }, [profileId, leagueData?.ownership_players, currentGW, baseHistoricalGW]);

  // GW Horizon Range State (Dual-Thumb Range Slider & Dropdowns):
  // Subtab Score & Subtab Points default to 1 GW
  const [scoreGwStart, setScoreGwStart] = useState<number>(() => targetNextGW);
  const [scoreGwEnd, setScoreGwEnd] = useState<number>(() => targetNextGW);
  const [pointsGwStart, setPointsGwStart] = useState<number>(() => targetNextGW);
  const [pointsGwEnd, setPointsGwEnd] = useState<number>(() => targetNextGW);
  const [activeThumb, setActiveThumb] = useState<'start' | 'end'>('end');

  const gwStart = subTab === 'score' ? scoreGwStart : pointsGwStart;
  const gwEnd = subTab === 'score' ? scoreGwEnd : pointsGwEnd;
  const setGwStart = subTab === 'score' ? setScoreGwStart : setPointsGwStart;
  const setGwEnd = subTab === 'score' ? setScoreGwEnd : setPointsGwEnd;

  // Sync if targetNextGW advances
  useEffect(() => {
    setScoreGwStart((prev) => (prev < targetNextGW ? targetNextGW : prev));
    setScoreGwEnd((prev) => (prev < targetNextGW ? targetNextGW : prev));
    setPointsGwStart((prev) => (prev < targetNextGW ? targetNextGW : prev));
    setPointsGwEnd((prev) => (prev < targetNextGW ? targetNextGW : prev));
  }, [targetNextGW]);

  // Handle GW Start change (via dropdown or left dot)
  const handleGwStartChange = (val: number) => {
    const newStart = Math.max(targetNextGW, Math.min(val, 38));
    setGwStart(newStart);
    if (gwEnd < newStart) {
      setGwEnd(newStart);
    }
  };

  // Handle GW End change (via dropdown or right dot)
  const handleGwEndChange = (val: number) => {
    const newEnd = Math.max(targetNextGW, Math.min(val, 38));
    setGwEnd(newEnd);
    if (newEnd < gwStart) {
      setGwStart(newEnd);
    }
  };

  // Dynamically resolve official club badge URLs matching Tab Matches
  const clubBadgeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clubs) {
      map.set(c.short, c.badgeUrl);
      map.set(c.name, c.badgeUrl);
      map.set(String(c.id), c.badgeUrl);
    }
    if (leagueData?.ownership_clubs) {
      for (const gwKey of Object.keys(leagueData.ownership_clubs)) {
        const gwClubs = leagueData.ownership_clubs[Number(gwKey)] || [];
        for (const c of gwClubs) {
          if (c.badge_url) {
            if (c.short_name) map.set(c.short_name, c.badge_url);
            if (c.name) map.set(c.name, c.badge_url);
            if (c.club_id) map.set(String(c.club_id), c.badge_url);
          }
        }
      }
    }
    return map;
  }, [leagueData, clubs]);

  // Dropdown options for GW Awal (from targetNextGW up to 38)
  const startGwOptions = useMemo(() => {
    const opts: Array<{ value: number; label: string }> = [];
    for (let gw = targetNextGW; gw <= 38; gw++) {
      opts.push({ value: gw, label: `GW ${gw}` });
    }
    return opts;
  }, [targetNextGW]);

  // Dropdown options for GW Akhir (from targetNextGW up to 38)
  const endGwOptions = useMemo(() => {
    const opts: Array<{ value: number; label: string }> = [];
    for (let gw = targetNextGW; gw <= 38; gw++) {
      opts.push({ value: gw, label: `GW ${gw}` });
    }
    return opts;
  }, [targetNextGW]);

  // Horizon GW list for Score & Points subtabs
  const scoreHorizonGWs = useMemo(() => {
    const list: number[] = [];
    const start = Math.max(scoreGwStart, targetNextGW);
    const end = Math.min(Math.max(scoreGwEnd, start), 38);
    for (let gw = start; gw <= end; gw++) {
      list.push(gw);
    }
    return list;
  }, [scoreGwStart, scoreGwEnd, targetNextGW]);

  const pointsHorizonGWs = useMemo(() => {
    const list: number[] = [];
    const start = Math.max(pointsGwStart, targetNextGW);
    const end = Math.min(Math.max(pointsGwEnd, start), 38);
    for (let gw = start; gw <= end; gw++) {
      list.push(gw);
    }
    return list;
  }, [pointsGwStart, pointsGwEnd, targetNextGW]);

  const horizonGWs = subTab === 'score' ? scoreHorizonGWs : pointsHorizonGWs;

  // =========================================================================
  // SUBTAB 1: LINE UP (FOR GW N+1 / GW 8)
  // Accordion per 20 Premier League clubs, full squad table with SI index
  // =========================================================================
  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(new Set());
  const [lineupViewMode, setLineupViewMode] = useState<'list' | 'pitch'>('list');
  const [lineupSortCol, setLineupSortCol] = useState<string>('role');
  const [lineupSortDir, setLineupSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleClubAccordion = (clubShort: string) => {
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(clubShort)) next.delete(clubShort);
      else next.add(clubShort);
      return next;
    });
  };

  // =========================================================================
  // SUBTAB 2: SCORE (GW N+1 TO GW 38)
  // Two Toggle Modes: [Match Scoreboard] and [Club Fixture Matrix]
  // =========================================================================
  const [scoreViewMode, setScoreViewMode] = useState<'scoreboard' | 'matrix'>('scoreboard');
  const [matrixSortCol, setMatrixSortCol] = useState<string>('pts');
  const [matrixSortDir, setMatrixSortDir] = useState<'asc' | 'desc'>('desc');

  // Matrix calculation per club across selected horizon (supports Single, DGW & BGW)
  interface ClubMatrixMatchDetail {
    oppShort: string;
    isHome: boolean;
    scoreText: string;
    result: 'W' | 'D' | 'L';
    xg: number;
    oppXg: number;
    csProb: number;
    gf: number;
    ga: number;
  }

  interface ClubMatrixRow {
    club: ProjectionClubItem;
    cells: Record<
      number,
      {
        isBlank: boolean;
        matches: ClubMatrixMatchDetail[];
        oppShort: string;
        isHome: boolean;
        scoreText: string;
        result: 'W' | 'D' | 'L';
        gwPts: number;
        xg: number;
        oppXg: number;
        csProb: number;
        gf: number;
        ga: number;
      }
    >;
    totalPts: number;
    totalGF: number;
    totalGA: number;
    totalCS: number;
  }

  const clubMatrixData = useMemo<ClubMatrixRow[]>(() => {
    if (subTab !== 'score') return [];
    return clubs.map((c) => {
      const cells: ClubMatrixRow['cells'] = {};
      let totalPts = 0;
      let totalGF = 0;
      let totalGA = 0;
      let totalCS = 0;

      for (const gw of scoreHorizonGWs) {
        const matches = matchesByGW[gw] || [];
        const clubMatches = matches.filter(
          (m) => m.home_team?.short_name === c.short || m.away_team?.short_name === c.short
        );

        if (clubMatches.length === 0) {
          cells[gw] = {
            isBlank: true,
            matches: [],
            oppShort: 'BGW',
            isHome: true,
            scoreText: 'Blank',
            result: 'D',
            gwPts: -1,
            xg: 0,
            oppXg: 0,
            csProb: 0,
            gf: 0,
            ga: 0,
          };
          continue;
        }

        const details: ClubMatrixMatchDetail[] = [];
        let gwPts = 0;
        let gwGF = 0;
        let gwGA = 0;
        let gwXg = 0;
        let gwOppXg = 0;
        let gwCsProbSum = 0;

        for (const match of clubMatches) {
          const isHome = match.home_team?.short_name === c.short;
          const oppShort = isHome ? match.away_team?.short_name || '' : match.home_team?.short_name || '';

          const proj = isHome ? projectFixture(c.short, oppShort, gw) : projectFixture(oppShort, c.short, gw);

          const myGoals = isHome ? proj.homeGoals : proj.awayGoals;
          const oppGoals = isHome ? proj.awayGoals : proj.homeGoals;
          const myXg = isHome ? proj.lambdaH : proj.lambdaA;
          const oppXg = isHome ? proj.lambdaA : proj.lambdaH;
          const myCsProb = isHome ? proj.homeCsProb : proj.awayCsProb;

          let res: 'W' | 'D' | 'L' = 'D';
          if (myGoals > oppGoals) {
            res = 'W';
            gwPts += 3;
          } else if (myGoals === oppGoals) {
            res = 'D';
            gwPts += 1;
          } else {
            res = 'L';
          }

          gwGF += myGoals;
          gwGA += oppGoals;
          gwXg += myXg;
          gwOppXg += oppXg;
          gwCsProbSum += myCsProb;
          if (oppGoals === 0) totalCS += 1;

          details.push({
            oppShort,
            isHome,
            scoreText: `${myGoals}-${oppGoals}`,
            result: res,
            xg: myXg,
            oppXg,
            csProb: myCsProb,
            gf: myGoals,
            ga: oppGoals,
          });
        }

        totalPts += gwPts;
        totalGF += gwGF;
        totalGA += gwGA;

        const aggResult: 'W' | 'D' | 'L' =
          details.length === 1
            ? details[0].result
            : gwPts >= details.length * 2
            ? 'W'
            : gwPts >= details.length
            ? 'D'
            : 'L';

        cells[gw] = {
          isBlank: false,
          matches: details,
          oppShort: details.map((d) => `${d.oppShort}`).join('+'),
          isHome: details[0].isHome,
          scoreText: details.map((d) => d.scoreText).join(' / '),
          result: aggResult,
          gwPts,
          xg: gwXg,
          oppXg: gwOppXg,
          csProb: Math.round(gwCsProbSum / details.length),
          gf: gwGF,
          ga: gwGA,
        };
      }

      return {
        club: c,
        cells,
        totalPts,
        totalGF,
        totalGA,
        totalCS
      };
    });
  }, [subTab, clubs, scoreHorizonGWs, matchesByGW, projectFixture]);

  const handleMatrixSort = (col: string) => {
    if (matrixSortCol === col) {
      setMatrixSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setMatrixSortCol(col);
      setMatrixSortDir(col === 'club' || col === 'ga' ? 'asc' : 'desc');
    }
  };

  // Sort Matrix rows
  const sortedClubMatrix = useMemo(() => {
    const list = [...clubMatrixData];
    list.sort((a, b) => {
      if (matrixSortCol === 'club') {
        return matrixSortDir === 'asc' ? a.club.name.localeCompare(b.club.name) : b.club.name.localeCompare(a.club.name);
      }

      if (matrixSortCol.startsWith('gw_')) {
        const gwNum = parseInt(matrixSortCol.replace('gw_', ''), 10);
        const cellA = a.cells[gwNum];
        const cellB = b.cells[gwNum];
        if ((!cellA || cellA.isBlank) && (!cellB || cellB.isBlank)) return a.club.name.localeCompare(b.club.name);
        if (!cellA || cellA.isBlank) return 1;
        if (!cellB || cellB.isBlank) return -1;

        const compareGwDesc = (cA: ClubMatrixRow['cells'][number], cB: ClubMatrixRow['cells'][number]) => {
          const ptsDiff = cB.gwPts - cA.gwPts;
          if (ptsDiff !== 0) return ptsDiff;

          const gdDiff = (cB.gf - cB.ga) - (cA.gf - cA.ga);
          if (gdDiff !== 0) return gdDiff;

          const gfDiff = cB.gf - cA.gf;
          if (gfDiff !== 0) return gfDiff;

          const csDiff = cB.csProb - cA.csProb;
          if (csDiff !== 0) return csDiff;

          const xgDiff = cB.xg - cA.xg;
          if (Math.abs(xgDiff) > 0.0001) return xgDiff;

          return 0;
        };

        const cmp = compareGwDesc(cellA, cellB);
        if (cmp !== 0) return matrixSortDir === 'desc' ? cmp : -cmp;
        return a.club.name.localeCompare(b.club.name);
      }

      let vA = 0;
      let vB = 0;
      if (matrixSortCol === 'pts') {
        vA = a.totalPts;
        vB = b.totalPts;
      } else if (matrixSortCol === 'gf') {
        vA = a.totalGF;
        vB = b.totalGF;
      } else if (matrixSortCol === 'ga') {
        vA = a.totalGA;
        vB = b.totalGA;
      } else if (matrixSortCol === 'cs') {
        vA = a.totalCS;
        vB = b.totalCS;
      }

      const diff = matrixSortDir === 'asc' ? vA - vB : vB - vA;
      if (diff !== 0) return diff;
      return b.totalPts - a.totalPts || a.club.name.localeCompare(b.club.name);
    });
    return list;
  }, [clubMatrixData, matrixSortCol, matrixSortDir]);

  // =========================================================================
  // SUBTAB 3: POINTS (GW N+1 TO GW 38)
  // Table of all FPL players stretching horizontally across GWs
  // Full FPL scoring rules + DefCon calculation
  // =========================================================================
  const [posFilter, setPosFilter] = useState<'ALL' | PositionType>('ALL');
  const [clubFilter, setClubFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [provenOnly, setProvenOnly] = useState<boolean>(false);
  const [myTeamOnly, setMyTeamOnly] = useState<boolean>(false);
  const [pointsSortCol, setPointsSortCol] = useState<string>('total');
  const [pointsSortDir, setPointsSortDir] = useState<'asc' | 'desc'>('desc');

  interface PlayerPointsRow {
    id: number;
    code: number;
    webName: string;
    fullName: string;
    teamShort: string;
    position: PositionType;
    nowCost: number;
    gwPointsMap: Record<number, PlayerGwProjectionCell>;
    totalXp: number;
    avgXp: number;
    valueRatio: number;
    doubleDigitHauls: number;
    maxGwPoints: number;
    haulRate: number;
    explosiveIndex: number;
    proven?: FplProvenStatus;
  }

  // Share computed projections if legacy callback provided
  useEffect(() => {
    if (onProjectionsComputed && allPlayerFullSeasonProjections && allPlayerFullSeasonProjections.length > 0) {
      onProjectionsComputed(allPlayerFullSeasonProjections);
    }
  }, [allPlayerFullSeasonProjections, onProjectionsComputed]);

  // 3. Ultra-fast Horizon Slicing (Executed in < 1ms when user moves slider; gated by active subTab)
  const playerPointsRows = useMemo<PlayerPointsRow[]>(() => {
    if (subTab !== 'points') return [];
    return allPlayerFullSeasonProjections.map((p) => {
      let sumXp = 0;
      const gwPointsMap: Record<number, PlayerGwProjectionCell> = {};

      for (const gw of pointsHorizonGWs) {
        const cell = p.fullSeasonPointsMap[gw] || {
          opp: '-',
          isHome: true,
          xp: 0,
          baseXp: 0,
          spikeMod: 0,
          matchCount: 0,
          isBlank: true,
        };
        gwPointsMap[gw] = cell;
        sumXp += cell.xp;
      }

      const count = Math.max(pointsHorizonGWs.length, 1);
      const avg = Math.round((sumXp / count) * 10) / 10;
      const valRatio = Math.round((sumXp / Math.max(p.nowCost, 0.1)) * 10) / 10;

      return {
        id: p.id,
        code: p.code,
        webName: p.webName,
        fullName: p.fullName,
        teamShort: p.teamShort,
        position: p.position,
        nowCost: p.nowCost,
        gwPointsMap,
        totalXp: Math.round(sumXp * 10) / 10,
        avgXp: avg,
        valueRatio: valRatio,
        doubleDigitHauls: p.doubleDigitHauls,
        maxGwPoints: p.maxGwPoints,
        haulRate: p.haulRate,
        explosiveIndex: p.explosiveIndex,
        proven: p.proven
      };
    });
  }, [subTab, allPlayerFullSeasonProjections, pointsHorizonGWs]);

  // Progressive Rendering Count (Instant Sorting & Zero DOM lag)
  const [visibleCount, setVisibleCount] = useState<number>(50);

  // Reset to 50 items when user changes filter, search, or sorting
  useEffect(() => {
    setVisibleCount(50);
  }, [posFilter, clubFilter, deferredSearchQuery, provenOnly, myTeamOnly, pointsSortCol, pointsSortDir]);

  // Filtered & Sorted Points rows
  const filteredPointsRows = useMemo(() => {
    let list = [...playerPointsRows];

    if (posFilter !== 'ALL') {
      list = list.filter((p) => p.position === posFilter);
    }

    if (clubFilter !== 'ALL') {
      list = list.filter((p) => p.teamShort === clubFilter);
    }

    if (provenOnly) {
      list = list.filter((p) => p.proven?.isProven);
    }

    if (myTeamOnly && ownedPlayerIds.size > 0) {
      list = list.filter((p) => ownedPlayerIds.has(p.id));
    }

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((p) => p.webName.toLowerCase().includes(q) || p.fullName.toLowerCase().includes(q) || p.teamShort.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let vA = 0;
      let vB = 0;

      if (pointsSortCol === 'player') return pointsSortDir === 'asc' ? a.webName.localeCompare(b.webName) : b.webName.localeCompare(a.webName);
      if (pointsSortCol === 'club') return pointsSortDir === 'asc' ? a.teamShort.localeCompare(b.teamShort) : b.teamShort.localeCompare(a.teamShort);
      if (pointsSortCol === 'pos') return pointsSortDir === 'asc' ? a.position.localeCompare(b.position) : b.position.localeCompare(a.position);
      if (pointsSortCol === 'price') {
        vA = a.nowCost;
        vB = b.nowCost;
      } else if (pointsSortCol === 'total') {
        vA = a.totalXp;
        vB = b.totalXp;
      } else if (pointsSortCol === 'avg') {
        vA = a.avgXp;
        vB = b.avgXp;
      } else if (pointsSortCol === 'value') {
        vA = a.valueRatio;
        vB = b.valueRatio;
      } else if (pointsSortCol.startsWith('gw_')) {
        const gwNum = parseInt(pointsSortCol.replace('gw_', ''), 10);
        vA = a.gwPointsMap[gwNum]?.xp || 0;
        vB = b.gwPointsMap[gwNum]?.xp || 0;
      }

      return pointsSortDir === 'asc' ? vA - vB : vB - vA;
    });

    return list;
  }, [playerPointsRows, posFilter, clubFilter, deferredSearchQuery, provenOnly, myTeamOnly, ownedPlayerIds, pointsSortCol, pointsSortDir]);

  // Sliced rows actually mounted in DOM (Instant 10ms render instead of 800ms)
  const displayedPointsRows = useMemo(() => {
    return filteredPointsRows.slice(0, visibleCount);
  }, [filteredPointsRows, visibleCount]);

  // Render Dual-Thumb Range Slider & GW Range Dropdowns (flanked left & right, no bulky labels)
  const renderGwHorizonControl = (options?: { fullWidthEndAligned?: boolean }) => {
    const fullWidthEndAligned = options?.fullWidthEndAligned ?? false;
    const rangeSpan = Math.max(38 - targetNextGW, 1);
    const leftPercent = Math.max(0, Math.min(100, ((gwStart - targetNextGW) / rangeSpan) * 100));
    const rightPercent = Math.max(0, Math.min(100, ((gwEnd - targetNextGW) / rangeSpan) * 100));

    return (
      <div className={`flex items-center gap-2 sm:gap-2.5 ${fullWidthEndAligned ? 'w-full' : 'w-full sm:w-auto'}`}>
        {/* SISI KIRI: Capsule Dropdown GW Awal */}
        <div className="shrink-0" title={isIdLang ? 'GW Awal Proyeksi' : 'Projection Start GW'}>
          <CustomPopoverSelect
            value={gwStart}
            onChange={(val) => handleGwStartChange(Number(val))}
            options={startGwOptions}
            className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
          />
        </div>

        {/* TENGAH: Range Slider dengan 2 Dot (Dual-Thumb Slider) */}
        <div
          className={`relative flex-1 min-w-[80px] ${
            fullWidthEndAligned ? '' : 'sm:min-w-[130px] md:min-w-[170px] max-w-[220px]'
          } h-6 flex items-center`}
        >
          {/* Background Track */}
          <div className="absolute inset-x-0 my-auto h-2 w-full rounded-full bg-slate-200 dark:bg-white/15" />

          {/* Active Range Highlight between Dot 1 and Dot 2 */}
          <div
            className="absolute inset-y-0 my-auto h-2 rounded-full bg-[#37003c] dark:bg-[#00ff87] transition-all duration-75"
            style={{
              left: `${leftPercent}%`,
              width: `${Math.max(rightPercent - leftPercent, 0)}%`
            }}
          />

          {/* Input Left Dot (GW Awal) */}
          <input
            type="range"
            min={targetNextGW}
            max={38}
            step={1}
            value={gwStart}
            onMouseDown={() => setActiveThumb('start')}
            onTouchStart={() => setActiveThumb('start')}
            onChange={(e) => {
              const val = Number(e.target.value);
              setGwStart(Math.min(val, gwEnd));
            }}
            className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none ${
              activeThumb === 'start' ? 'z-30' : 'z-20'
            } [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#37003c] dark:[&::-webkit-slider-thumb]:border-[#00ff87] dark:[&::-webkit-slider-thumb]:bg-[#1a0f2e] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#37003c] dark:[&::-moz-range-thumb]:border-[#00ff87] dark:[&::-moz-range-thumb]:bg-[#1a0f2e] [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab`}
            title={`GW Awal: ${gwStart}`}
          />

          {/* Input Right Dot (GW Akhir) */}
          <input
            type="range"
            min={targetNextGW}
            max={38}
            step={1}
            value={gwEnd}
            onMouseDown={() => setActiveThumb('end')}
            onTouchStart={() => setActiveThumb('end')}
            onChange={(e) => {
              const val = Number(e.target.value);
              setGwEnd(Math.max(val, gwStart));
            }}
            className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none ${
              activeThumb === 'end' ? 'z-30' : 'z-20'
            } [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#37003c] dark:[&::-webkit-slider-thumb]:border-[#00ff87] dark:[&::-webkit-slider-thumb]:bg-[#1a0f2e] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#37003c] dark:[&::-moz-range-thumb]:border-[#00ff87] dark:[&::-moz-range-thumb]:bg-[#1a0f2e] [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab`}
            title={`GW Akhir: ${gwEnd}`}
          />
        </div>

        {/* SISI KANAN: Capsule Dropdown GW Akhir */}
        <div className={`shrink-0 ${fullWidthEndAligned ? 'ml-auto' : ''}`} title={isIdLang ? 'GW Akhir Proyeksi' : 'Projection End GW'}>
          <CustomPopoverSelect
            value={gwEnd}
            onChange={(val) => handleGwEndChange(Number(val))}
            options={endGwOptions}
            className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
          />
        </div>

        {!fullWidthEndAligned && (
          <>
            {/* Lencana Total GW */}
            <span className="px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] whitespace-nowrap shadow-xs shrink-0">
              {horizonGWs.length} GW
            </span>

            {/* Quick Presets */}
            <div className="hidden lg:flex items-center gap-1 shrink-0">
              {[
                { label: '+3 GW', end: Math.min(targetNextGW + 2, 38) },
                { label: '+5 GW', end: Math.min(targetNextGW + 4, 38) },
                { label: '+10 GW', end: Math.min(targetNextGW + 9, 38) },
                { label: 'GW 38', end: 38 }
              ].map((preset) => {
                const isActive = gwStart === targetNextGW && gwEnd === preset.end;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setGwStart(targetNextGW);
                      setGwEnd(preset.end);
                    }}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold cursor-pointer transition-all ${
                      isActive
                        ? 'bg-[#37003c]/15 text-[#37003c] dark:bg-[#00ff87]/20 dark:text-[#00ff87] border border-[#37003c]/30 dark:border-[#00ff87]/40'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-full space-y-2.5 pb-6">
      {/* ========================================================================= */}
      {/* 1. SUBTAB: LINE UP (GW N+1 ACCORDION PER 20 CLUBS)                         */}
      {/* ========================================================================= */}
      {subTab === 'line-up' && (
        <div className="space-y-1.5">
          {/* Header Bar */}
          <div className="bg-white dark:bg-[#1a0f2e] px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-between gap-1.5 w-full min-w-0">
            <div className="flex items-center bg-slate-100 dark:bg-white/5 p-0.5 rounded-lg border border-slate-200 dark:border-white/10 whitespace-nowrap">
              <button
                onClick={() => setLineupViewMode('list')}
                className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1 ${
                  lineupViewMode === 'list'
                    ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                }`}
              >
                <List className="w-3 h-3" />
                List
              </button>
              <button
                onClick={() => setLineupViewMode('pitch')}
                className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1 ${
                  lineupViewMode === 'pitch'
                    ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3 h-3" />
                Pitch
              </button>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                onClick={() => setExpandedClubs(new Set(clubs.map((c) => c.short)))}
                className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-black dark:hover:text-white cursor-pointer px-1.5 sm:px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 whitespace-nowrap"
              >
                {isIdLang ? 'Buka' : 'Expand'}
              </button>
              <button
                onClick={() => setExpandedClubs(new Set())}
                className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-black dark:hover:text-white cursor-pointer px-1.5 sm:px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 whitespace-nowrap"
              >
                {isIdLang ? 'Tutup' : 'Collapse'}
              </button>
            </div>
          </div>

          {/* 20 Club Accordions */}
          <div className="space-y-1.5">
            {clubs.map((club) => {
              const isExpanded = expandedClubs.has(club.short);
              const nextMatchesFromList = clubNextMatchesMap?.[club.short];
              const fallbackSingle = clubNextMatchMap.get(club.short);
              const nextMatches =
                Array.isArray(nextMatchesFromList) && nextMatchesFromList.length > 0
                  ? nextMatchesFromList
                  : fallbackSingle
                  ? [fallbackSingle]
                  : [];
              const nextMatch = nextMatches[0];
              const isDgwClub = nextMatches.length >= 2;
              const isBgwClub = nextMatches.length === 0;
              const squad = clubSquadProjections[club.short] || [];

              // Sort squad for expanded table by role (Starting -> Bench -> Out) and position (GKP -> DEF -> MID -> FWD)
              const sortedSquad = [...squad].sort((a, b) => {
                let vA: any = a.si;
                let vB: any = b.si;

                if (lineupSortCol === 'role' || lineupSortCol === 'status') {
                  const roleDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
                  if (roleDiff !== 0) return lineupSortDir === 'asc' ? roleDiff : -roleDiff;

                  if (
                    a.role === 'starting' &&
                    b.role === 'starting' &&
                    a.tacticalSlotIndex !== undefined &&
                    b.tacticalSlotIndex !== undefined
                  ) {
                    const slotDiff = a.tacticalSlotIndex - b.tacticalSlotIndex;
                    if (slotDiff !== 0) return lineupSortDir === 'asc' ? slotDiff : -slotDiff;
                  }

                  const posDiff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
                  if (posDiff !== 0) return posDiff;

                  return b.si - a.si || b.starts - a.starts || b.sub - a.sub || b.unused - a.unused || b.nowCost - a.nowCost;
                }

                if (lineupSortCol === 'pos') {
                  const posDiff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
                  if (posDiff !== 0) return lineupSortDir === 'asc' ? posDiff : -posDiff;

                  const roleDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
                  if (roleDiff !== 0) return roleDiff;

                  return b.si - a.si || b.starts - a.starts || b.sub - a.sub || b.unused - a.unused || b.nowCost - a.nowCost;
                }

                if (lineupSortCol === 'num') {
                  vA = a.shirtNum;
                  vB = b.shirtNum;
                } else if (lineupSortCol === 'player') return lineupSortDir === 'asc' ? a.webName.localeCompare(b.webName) : b.webName.localeCompare(a.webName);
                else if (lineupSortCol === 'si') {
                  vA = a.si;
                  vB = b.si;
                } else if (lineupSortCol === 'starts') {
                  vA = a.starts;
                  vB = b.starts;
                } else if (lineupSortCol === 'sub' || lineupSortCol === 'bench') {
                  vA = a.sub;
                  vB = b.sub;
                } else if (lineupSortCol === 'unused') {
                  vA = a.unused;
                  vB = b.unused;
                } else if (lineupSortCol === 'out') {
                  vA = a.outOfSquad;
                  vB = b.outOfSquad;
                }
                return lineupSortDir === 'asc' ? vA - vB : vB - vA;
              });

              return (
                <div
                  key={club.id}
                  className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-xs"
                >
                  {/* Accordion Header Row */}
                  <div
                    onClick={() => toggleClubAccordion(club.short)}
                    className="px-2 sm:px-3 py-1.5 flex items-center justify-between gap-1.5 sm:gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors select-none w-full min-w-0 overflow-hidden"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 shrink">
                      <img
                        src={clubBadgeMap.get(club.short) || club.badgeUrl}
                        alt={club.name}
                        className="w-4 h-4 sm:w-4.5 sm:h-4.5 object-contain shrink-0 filter drop-shadow select-none self-center"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/default_team_badge.png';
                        }}
                      />
                      <span className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white truncate max-w-[130px] xs:max-w-[170px] sm:max-w-none">
                        {club.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                      <span
                        title={
                          isDgwClub
                            ? nextMatches.map((m) => `${m.opponentShort} (${m.isHome ? 'H' : 'A'}): ${formatKickoff(m.kickoffTime, isIdLang)}`).join(' | ')
                            : undefined
                        }
                        className="hidden md:inline text-[11px] text-slate-400 w-28 text-right shrink-0 truncate"
                      >
                        {nextMatch ? formatKickoff(nextMatch.kickoffTime, isIdLang) : 'Blank GW'}
                      </span>
                      {(() => {
                        const pulseFormation = squad.find((p) => p.projectedFormation)?.projectedFormation;
                        const shapeStr = pulseFormation || '-';
                        return (
                          <span className="inline-flex items-center justify-center w-[56px] sm:w-[62px] font-mono font-bold text-[10px] sm:text-[11px] py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 shrink-0 text-center tabular-nums">
                            {shapeStr}
                          </span>
                        );
                      })()}
                      {isBgwClub ? (
                        <span className="inline-flex items-center justify-center text-center w-[72px] sm:w-[82px] text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 border border-slate-200/70 dark:border-white/10">
                          BGW
                        </span>
                      ) : isDgwClub ? (
                        <div
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                          title={`Double Gameweek ${targetNextGW}: ${nextMatches.map((m) => `vs ${m.opponentShort} (${m.isHome ? 'H' : 'A'})`).join(' + ')}`}
                        >
                          <span className="px-1 py-0.5 rounded text-[9px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c]">
                            DGW
                          </span>
                          {nextMatches.map((m, idx) => {
                            const proj = m.isHome
                              ? projectFixture(club.short, m.opponentShort, targetNextGW)
                              : projectFixture(m.opponentShort, club.short, targetNextGW);
                            const myGoals = m.isHome ? proj.homeGoals : proj.awayGoals;
                            const oppGoals = m.isHome ? proj.awayGoals : proj.homeGoals;
                            const cls =
                              myGoals > oppGoals
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25'
                                : myGoals === oppGoals
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25'
                                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25';
                            return (
                              <span
                                key={`${m.opponentShort}-${idx}`}
                                className={`inline-flex items-center justify-center text-center text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}
                              >
                                {m.opponentShort}({m.isHome ? 'H' : 'A'})
                              </span>
                            );
                          })}
                        </div>
                      ) : (() => {
                        let fixCapsuleClass =
                          'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-white/10';
                        if (nextMatch) {
                          const proj = nextMatch.isHome
                            ? projectFixture(club.short, nextMatch.opponentShort, targetNextGW)
                            : projectFixture(nextMatch.opponentShort, club.short, targetNextGW);
                          const myGoals = nextMatch.isHome ? proj.homeGoals : proj.awayGoals;
                          const oppGoals = nextMatch.isHome ? proj.awayGoals : proj.homeGoals;
                          if (myGoals > oppGoals) {
                            fixCapsuleClass =
                              'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25';
                          } else if (myGoals === oppGoals) {
                            fixCapsuleClass =
                              'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25';
                          } else {
                            fixCapsuleClass =
                              'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25';
                          }
                        }
                        return (
                          <span
                            className={`inline-flex items-center justify-center text-center w-[72px] sm:w-[82px] text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${fixCapsuleClass}`}
                          >
                            {nextMatch ? `vs ${nextMatch.opponentShort} (${nextMatch.isHome ? 'H' : 'A'})` : 'vs TBA'}
                          </span>
                        );
                      })()}
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                    </div>
                  </div>

                  {/* Expanded Content: List Table OR Scout-Picks Style Pitch */}
                  {isExpanded && lineupViewMode === 'pitch' && (() => {
                    const xiSlotOrder = squad
                      .filter((p) => p.role === 'starting')
                      .sort((a, b) => (a.tacticalSlotIndex ?? 99) - (b.tacticalSlotIndex ?? 99));

                    const pulseFormation = squad.find((p) => p.projectedFormation)?.projectedFormation;
                    const parsedParts = (pulseFormation || '')
                      .split('-')
                      .map((n) => parseInt(n, 10))
                      .filter((n) => !isNaN(n) && n > 0);
                    const hasValidPulseShape =
                      parsedParts.length >= 3 &&
                      xiSlotOrder.length === 11 &&
                      parsedParts.reduce((s, n) => s + n, 0) === 10;

                    const pitchRows: ProjectedSquadPlayer[][] = [];
                    if (hasValidPulseShape) {
                      pitchRows.push([xiSlotOrder[0]]);
                      let cursor = 1;
                      for (const cnt of parsedParts) {
                        pitchRows.push(xiSlotOrder.slice(cursor, cursor + cnt));
                        cursor += cnt;
                      }
                    } else {
                      const gks = xiSlotOrder.filter((p) => p.position === 'GKP');
                      const defs = xiSlotOrder.filter((p) => p.position === 'DEF');
                      const mids = xiSlotOrder.filter((p) => p.position === 'MID');
                      const fwds = xiSlotOrder.filter((p) => p.position === 'FWD');
                      if (gks.length > 0) pitchRows.push(gks);
                      if (defs.length > 0) pitchRows.push(defs);
                      if (mids.length > 0) pitchRows.push(mids);
                      if (fwds.length > 0) pitchRows.push(fwds);
                    }

                    const benchPlayers = squad
                      .filter((p) => p.role === 'bench')
                      .sort(
                        (a, b) =>
                          (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99) ||
                          b.si - a.si ||
                          b.starts - a.starts ||
                          b.sub - a.sub ||
                          b.nowCost - a.nowCost
                      );

                    const outPlayers = squad
                      .filter((p) => p.role === 'out')
                      .sort(
                        (a, b) =>
                          (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99) ||
                          b.si - a.si ||
                          b.starts - a.starts ||
                          b.nowCost - a.nowCost
                      );

                    return (
                      <div className="border-t border-slate-200 dark:border-white/10 p-2 sm:p-3 bg-slate-50/70 dark:bg-[#130a24]/60">
                        <div className="relative w-full max-w-4xl mx-auto rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/10 shadow-xl">
                          {/* Pitch Grass Surface */}
                          <div className="relative w-full pt-2.5 sm:pt-3.5 pb-3 sm:pb-4 px-1.5 sm:px-3 bg-[#00aa52] select-none">
                            {/* 10 Alternating Horizontal Lawn Mowing Stripes */}
                            <div
                              className="absolute inset-0 flex flex-col pointer-events-none overflow-hidden"
                              style={{ clipPath: 'polygon(6% 0%, 94% 0%, 98.5% 100%, 1.5% 100%)' }}
                            >
                              {Array.from({ length: 10 }).map((_, i) => (
                                <div
                                  key={i}
                                  className={`flex-1 w-full ${i % 2 === 0 ? 'bg-[#00c261]' : 'bg-[#00aa52]'}`}
                                />
                              ))}
                            </div>

                            {/* Pitch Markings SVG */}
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                              <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 1200">
                                <line x1="70" y1="0" x2="930" y2="0" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                                <line x1="70" y1="0" x2="15" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
                                <line x1="930" y1="0" x2="985" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
                                <polyline points="245,0 239.8,190 760.2,190 755,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                                <polyline points="384.3,0 383.5,65 616.5,65 615.7,0" fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="3" />
                                <circle cx="500" cy="127" r="4.5" fill="rgba(255,255,255,0.95)" />
                                <path d="M 445,190 A 85,55 0 0,0 555,190" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                                <line x1="23.25" y1="1020" x2="976.75" y2="1020" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                                <ellipse cx="500" cy="1020" rx="145" ry="90" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                                <circle cx="500" cy="1020" r="5" fill="rgba(255,255,255,0.95)" />
                              </svg>
                            </div>

                            {/* Pitch Players Grid */}
                            <div className="relative z-10 space-y-2 sm:space-y-3">
                              {pitchRows.map((rowPlayers, rowIdx) => (
                                <div key={rowIdx} className="flex justify-center items-center gap-1 sm:gap-2.5 md:gap-3.5 flex-nowrap">
                                  {rowPlayers.map((p) => {
                                    const isOwned = ownedPlayerIds.has(p.id);
                                    return (
                                    <div
                                      key={p.id}
                                      onClick={() => onSelectPlayer?.(p.id)}
                                      className="group flex flex-col items-center justify-center cursor-pointer transition-transform hover:scale-105 select-none min-w-0 shrink-0 w-[calc((100%-16px)/5)] max-w-[82px] sm:max-w-none sm:w-22 md:w-24"
                                    >
                                      {/* Player Photo */}
                                      <div className="relative w-[48px] h-[48px] max-w-full sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center">
                                        {p.photo ? (
                                          <img
                                            src={p.photo}
                                            alt={p.webName}
                                            className="w-full h-full object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                                            loading="lazy"
                                            onError={(e) => {
                                              (e.currentTarget as HTMLElement).style.display = 'none';
                                            }}
                                          />
                                        ) : (
                                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20 border border-white/40 flex items-center justify-center text-[10px] font-black text-white">
                                            {p.position}
                                          </div>
                                        )}
                                      </div>

                                      {/* Name Strip (Dark Purple) + Position/SI Strip (Neon Green) */}
                                      <div className={`w-full rounded-md ${isOwned ? 'ring-2 ring-[#00ff87] shadow-[0_0_10px_rgba(0,255,135,0.45)]' : ''}`}>
                                        <div className={`w-full ${isOwned ? 'bg-emerald-950' : 'bg-[#37003c] group-hover:bg-[#4d0054]'} text-white text-center py-0.5 px-1 rounded-t-md mt-0.5 shadow-md transition-colors flex items-center justify-center`}>
                                          <span className="block text-[9px] sm:text-[10.5px] font-extrabold truncate leading-tight">
                                            {p.webName}
                                          </span>
                                        </div>
                                        <div className="w-full bg-[#00ff87] group-hover:bg-[#2eff9e] text-[#37003c] text-center py-0.5 px-1 rounded-b-md flex items-center justify-between font-black text-[8.5px] sm:text-[9.5px] leading-tight transition-colors">
                                          <span>{p.position}</span>
                                          <span>{p.si}%</span>
                                        </div>
                                      </div>
                                    </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Bench (Left-aligned vertical list) & Out (Right-aligned vertical list) */}
                          <div className="bg-[#005a2b] border-t border-[#007038] px-3 sm:px-4 py-2.5">
                            <div className="grid grid-cols-2 gap-3 sm:gap-6 items-start">
                              {/* Bench Column - Vertical Top-to-Bottom, Left-Aligned */}
                              <div className="flex flex-col items-start text-left min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-wider text-[#00ff87] mb-1">
                                  Bench ({benchPlayers.length})
                                </div>
                                <div className="flex flex-col items-start gap-1 w-full">
                                  {benchPlayers.map((p) => {
                                    const isOwned = ownedPlayerIds.has(p.id);
                                    return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => onSelectPlayer?.(p.id)}
                                      className={`inline-flex items-center gap-1.5 text-left text-[11px] sm:text-xs ${isOwned ? 'text-[#00ff87] bg-white/10 px-1.5 py-0.5 rounded' : 'text-white/95'} hover:text-[#00ff87] transition-colors cursor-pointer max-w-full`}
                                    >
                                      <span className="px-1 py-0.2 rounded text-[9px] font-black bg-white/15 text-[#00ff87] shrink-0 w-8 text-center">
                                        {p.position}
                                      </span>
                                      <span className="font-bold truncate">{p.webName}</span>
                                      <span className="font-mono text-[10px] font-extrabold text-[#00ff87]/90 shrink-0 tabular-nums">
                                        {p.si}%
                                      </span>
                                    </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Out Column - Vertical Top-to-Bottom, Right-Aligned */}
                              <div className="flex flex-col items-end text-right min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-wider text-rose-300 mb-1">
                                  Out ({outPlayers.length})
                                </div>
                                <div className="flex flex-col items-end gap-1 w-full">
                                  {outPlayers.length === 0 ? (
                                    <span className="text-[11px] text-white/50">-</span>
                                  ) : (
                                    outPlayers.map((p) => {
                                      const isOwned = ownedPlayerIds.has(p.id);
                                      return (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => onSelectPlayer?.(p.id)}
                                        className={`inline-flex items-center justify-end gap-1.5 text-right text-[11px] sm:text-xs ${isOwned ? 'text-[#00ff87] bg-white/10 px-1.5 py-0.5 rounded' : 'text-white/90'} hover:text-rose-200 transition-colors cursor-pointer max-w-full`}
                                      >
                                        <span className="font-mono text-[9.5px] font-bold text-rose-200/90 shrink-0 tabular-nums">
                                          {p.status === 's'
                                            ? 'SUS'
                                            : p.status === 'i'
                                            ? 'INJ'
                                            : p.status === 'd'
                                            ? `${p.chance ?? 75}%`
                                            : `${p.si}%`}
                                        </span>
                                        <span className="font-bold truncate">{p.webName}</span>
                                        <span className="px-1 py-0.2 rounded text-[9px] font-black bg-rose-500/25 text-rose-200 shrink-0 w-8 text-center">
                                          {p.position}
                                        </span>
                                      </button>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Expanded Full Squad Table */}
                  {isExpanded && lineupViewMode === 'list' && (
                    <div className="border-t border-slate-200 dark:border-white/10 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/90 dark:bg-white/5 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-white/10 text-[11px] whitespace-nowrap">
                            <th
                              className="py-1 px-2 w-8 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('num');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              #
                            </th>
                            <th
                              className="py-1 px-2 min-w-[130px] cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('player');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Player
                            </th>
                            <th
                              className="py-1 px-1.5 w-10 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('pos');
                                setLineupSortDir(lineupSortCol === 'pos' && lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Pos
                            </th>
                            <th
                              className="py-1 px-1.5 w-16 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('role');
                                setLineupSortDir(lineupSortCol === 'role' && lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Role
                            </th>
                            <th
                              className="py-1 px-2 w-16 text-right cursor-pointer text-[#37003c] dark:text-[#00ff87] font-black"
                              onClick={() => {
                                setLineupSortCol('si');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              SI (%)
                            </th>
                            <th
                              className="py-1 px-1.5 w-12 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('starts');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Starts
                            </th>
                            <th
                              className="py-1 px-1.5 w-10 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('sub');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Sub
                            </th>
                            <th
                              className="py-1 px-1.5 w-11 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('unused');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Unused
                            </th>
                            <th
                              className="py-1 px-1.5 w-10 text-center cursor-pointer hover:text-black dark:hover:text-white"
                              onClick={() => {
                                setLineupSortCol('out');
                                setLineupSortDir(lineupSortDir === 'asc' ? 'desc' : 'asc');
                              }}
                            >
                              Out
                            </th>
                            <th className="py-1 px-2 min-w-[140px]">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {sortedSquad.map((player) => {
                            const isStarting = player.role === 'starting';
                            const isBench = player.role === 'bench';
                            const isOwned = ownedPlayerIds.has(player.id);

                            return (
                              <tr
                                key={player.id}
                                onClick={() => onSelectPlayer?.(player.id)}
                                className={`transition-colors cursor-pointer whitespace-nowrap leading-none ${
                                  isOwned
                                    ? `${USER_ROW_BG} ${USER_ROW_HOVER_BG}`
                                    : isStarting
                                    ? 'bg-emerald-50/30 dark:bg-emerald-950/10 hover:bg-emerald-50/60'
                                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                                }`}
                              >
                                <td className="py-1 px-2 w-8 text-center font-bold text-slate-400 tabular-nums">
                                  {player.shirtNum > 0 ? player.shirtNum : '-'}
                                </td>
                                <td className="py-1 px-2 min-w-[130px] font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                  {player.webName}
                                </td>
                                <td className="py-1 px-1.5 w-10 text-center">
                                  <span className="w-8 inline-block text-center px-1 py-0.2 rounded text-[10px] font-black bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                                    {player.position}
                                  </span>
                                </td>
                                <td className="py-1 px-1.5 w-16 text-center">
                                  {isStarting ? (
                                    <span className="w-14 text-center inline-block px-1.5 py-0.2 rounded text-[10px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
                                      Start
                                    </span>
                                  ) : isBench ? (
                                    <span className="w-14 text-center inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                      Bench
                                    </span>
                                  ) : (
                                    <span className="w-14 text-center inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 whitespace-nowrap">
                                      Out
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 px-2 w-16 text-right whitespace-nowrap">
                                  <span className="font-black tabular-nums text-xs text-[#37003c] dark:text-[#00ff87]">
                                    {player.si}%
                                  </span>
                                </td>
                                <td className="py-1 px-1.5 w-12 text-center tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                                  {player.starts}
                                </td>
                                <td className="py-1 px-1.5 w-10 text-center tabular-nums text-slate-500 dark:text-slate-400">
                                  {player.sub}
                                </td>
                                <td className="py-1 px-1.5 w-11 text-center tabular-nums text-slate-500 dark:text-slate-400">
                                  {player.unused}
                                </td>
                                <td className="py-1 px-1.5 w-10 text-center tabular-nums text-slate-400">
                                  {player.outOfSquad}
                                </td>
                                <td className="py-1 px-2 min-w-[140px] text-[11px] whitespace-nowrap">
                                  {player.status === 'u' ? (
                                    <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                      <span className="w-10 text-center inline-block px-1 py-0.2 rounded text-[9px] font-black uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                        Out
                                      </span>
                                      <span className="truncate max-w-[200px] font-medium" title={player.news || 'Transferred'}>
                                        {player.news || 'Transferred'}
                                      </span>
                                    </span>
                                  ) : player.status === 's' ? (
                                    <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                                      <span className="w-10 text-center inline-block px-1 py-0.2 rounded text-[9px] font-black uppercase bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                        SUS
                                      </span>
                                      <span className="truncate max-w-[200px] font-bold" title={player.news || 'SUS'}>
                                        {player.news || 'SUS'}
                                      </span>
                                    </span>
                                  ) : player.status === 'i' ? (
                                    <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                                      <span className="w-10 text-center inline-block px-1 py-0.2 rounded text-[9px] font-black uppercase bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                        INJ
                                      </span>
                                      <span className="truncate max-w-[200px] font-bold" title={player.news || 'INJ'}>
                                        {player.news || 'INJ'}
                                      </span>
                                    </span>
                                  ) : player.status === 'd' ? (
                                    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                      <span className="w-10 text-center inline-block px-1 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                        {player.chance !== null ? `${player.chance}%` : 'Doubtful'}
                                      </span>
                                      <span className="truncate max-w-[200px] font-semibold" title={player.news || 'Doubtful'}>
                                        {player.news || `Doubtful (${player.chance || 75}%)`}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      <span className="w-10 text-center inline-block px-1 py-0.2 rounded text-[9px] font-black uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                        Fit
                                      </span>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. SUBTAB: SCORE (GW N+1 TO GW 38)                                         */}
      {/* Horizon filter + 2 Toggle Views (Match Scoreboard vs Club Fixture Matrix)  */}
      {/* ========================================================================= */}
      {subTab === 'score' && (
        <div className="space-y-2">
          {/* Controls Bar: Horizon Zoom Slider (GW End Rapat Kanan) + Mode Switcher & Total GW Rapat Kanan */}
          <div className="bg-white dark:bg-[#1a0f2e] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
            {renderGwHorizonControl({ fullWidthEndAligned: true })}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-white/5 pt-2">
              {/* View Toggle */}
              <div className="flex items-center bg-slate-100 dark:bg-white/5 p-0.5 rounded-lg border border-slate-200 dark:border-white/10 whitespace-nowrap shrink-0">
                <button
                  type="button"
                  onClick={() => setScoreViewMode('scoreboard')}
                  className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    scoreViewMode === 'scoreboard'
                      ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3 h-3" />
                  Scoreboard
                </button>
                <button
                  type="button"
                  onClick={() => setScoreViewMode('matrix')}
                  className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    scoreViewMode === 'matrix'
                      ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  Matrix
                </button>
              </div>

              {/* Quick Presets (Desktop) + Jumlah GW Horizon Rapat Kanan */}
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {[
                    { label: '1 GW', end: targetNextGW },
                    { label: '+3 GW', end: Math.min(targetNextGW + 2, 38) },
                    { label: '+5 GW', end: Math.min(targetNextGW + 4, 38) },
                    { label: '+10 GW', end: Math.min(targetNextGW + 9, 38) },
                    { label: 'GW 38', end: 38 }
                  ].map((preset) => {
                    const isActive = gwStart === targetNextGW && gwEnd === preset.end;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setGwStart(targetNextGW);
                          setGwEnd(preset.end);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                          isActive
                            ? 'bg-[#37003c]/15 text-[#37003c] dark:bg-[#00ff87]/20 dark:text-[#00ff87] border border-[#37003c]/30 dark:border-[#00ff87]/40'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0">
                  {horizonGWs.length} GW
                </span>
              </div>
            </div>
          </div>

          {/* MODE 1: MATCH SCOREBOARD (Symmetric Card: xG on top, Club + Score inline, CS% below) */}
          {scoreViewMode === 'scoreboard' && (() => {
            const renderScoreboardCard = (m: any, gw: number, cardKey: string) => {
              const hShort = m.home_team?.short_name || 'HOM';
              const aShort = m.away_team?.short_name || 'AWY';
              const proj = projectFixture(hShort, aShort, gw);

              return (
                <div
                  key={cardKey}
                  title={`${hShort} xG ${proj.lambdaH.toFixed(2)} • CS ${proj.homeCsProb}% | ${aShort} xG ${proj.lambdaA.toFixed(2)} • CS ${proj.awayCsProb}%`}
                  className="bg-slate-50/90 dark:bg-white/[0.035] hover:bg-slate-100/80 dark:hover:bg-white/[0.06] transition-colors px-1.5 py-1.5 @[355px]:px-2 sm:px-2.5 sm:py-2 rounded-lg border border-slate-200/80 dark:border-white/10"
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-1 @[355px]:gap-x-1.5 sm:gap-x-2 gap-y-1">
                    {/* Atas: Nilai xG sejajar di atas klub & score */}
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-500 dark:text-slate-400 text-right leading-none">
                      {proj.lambdaH.toFixed(2)}
                    </span>
                    <span className="text-[9px] font-bold tracking-wide text-slate-400 dark:text-slate-500 text-center leading-none">
                      xG
                    </span>
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-500 dark:text-slate-400 text-left leading-none">
                      {proj.lambdaA.toFixed(2)}
                    </span>

                    {/* Tengah: Nama & Logo Klub sejajar horizontal dengan Score */}
                    <div className="flex items-center justify-end gap-1 sm:gap-1.5">
                      <span className="text-[11px] @[355px]:text-xs font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        {hShort}
                      </span>
                      <img
                        src={clubBadgeMap.get(hShort) || '/default_team_badge.png'}
                        alt={hShort}
                        className="w-3.5 h-3.5 @[355px]:w-4 @[355px]:h-4 sm:w-4.5 sm:h-4.5 object-contain shrink-0 filter drop-shadow-xs"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/default_team_badge.png';
                        }}
                      />
                    </div>

                    <span className="min-w-[40px] @[355px]:min-w-[44px] sm:min-w-[48px] text-center px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] @[355px]:text-xs font-black bg-[#37003c] dark:bg-[#00ff87] text-white dark:text-[#37003c] tabular-nums leading-tight shadow-2xs whitespace-nowrap">
                      {proj.homeGoals} - {proj.awayGoals}
                    </span>

                    <div className="flex items-center justify-start gap-1 sm:gap-1.5">
                      <img
                        src={clubBadgeMap.get(aShort) || '/default_team_badge.png'}
                        alt={aShort}
                        className="w-3.5 h-3.5 @[355px]:w-4 @[355px]:h-4 sm:w-4.5 sm:h-4.5 object-contain shrink-0 filter drop-shadow-xs"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/default_team_badge.png';
                        }}
                      />
                      <span className="text-[11px] @[355px]:text-xs font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                        {aShort}
                      </span>
                    </div>

                    {/* Bawah: Nilai CS% sejajar di bawah klub & score */}
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 text-right leading-none">
                      {proj.homeCsProb}%
                    </span>
                    <span className="text-[9px] font-bold tracking-wide text-slate-400 dark:text-slate-500 text-center leading-none">
                      CS%
                    </span>
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 text-left leading-none">
                      {proj.awayCsProb}%
                    </span>
                  </div>
                </div>
              );
            };

            const isExactTwoGw = horizonGWs.length === 2;
            const multiGwColWidthClass = isExactTwoGw
              ? 'w-1/2 sm:min-w-[216px]'
              : 'w-[50cqw] min-w-[50cqw] max-w-[50cqw] sm:w-auto sm:min-w-[216px] sm:max-w-none';

            return (
              <div className="@container bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  {horizonGWs.length === 1 ? (
                    <div className="p-3">
                      {horizonGWs.map((gw) => {
                        const matches = matchesByGW[gw] || [];
                        return (
                          <div key={gw} className="space-y-2">
                            <div className="flex items-center justify-center px-3 py-1.5 rounded-lg bg-slate-100/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
                              <span className="text-xs font-black text-[#37003c] dark:text-[#00ff87] tabular-nums">
                                GW {gw}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                              {matches.map((m, idx) => renderScoreboardCard(m, gw, `${gw}-${idx}`))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <table
                      className={`${
                        isExactTwoGw ? 'w-full table-fixed sm:table-auto' : 'w-max min-w-full'
                      } text-left text-xs border-collapse`}
                    >
                      <thead>
                        <tr className="bg-slate-100/90 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 font-extrabold text-[11px] whitespace-nowrap">
                          {horizonGWs.map((gw) => (
                            <th
                              key={gw}
                              className={`py-2 px-1.5 sm:px-2 text-center border-r last:border-r-0 border-slate-200 dark:border-white/10 ${multiGwColWidthClass} whitespace-nowrap font-black text-[#37003c] dark:text-[#00ff87] tabular-nums`}
                            >
                              GW {gw}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {Array.from({ length: Math.max(10, ...horizonGWs.map((g) => (matchesByGW[g] || []).length)) }).map((_, matchIdx) => (
                          <tr key={matchIdx} className="whitespace-nowrap">
                            {horizonGWs.map((gw) => {
                              const matches = matchesByGW[gw] || [];
                              const m = matches[matchIdx];

                              if (!m) {
                                return (
                                  <td
                                    key={gw}
                                    className={`py-1.5 px-1.5 sm:px-2 text-center text-slate-400 border-r last:border-r-0 border-slate-200 dark:border-white/10 ${multiGwColWidthClass} whitespace-nowrap`}
                                  >
                                    -
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={gw}
                                  className={`p-1 sm:p-1.5 border-r last:border-r-0 border-slate-200 dark:border-white/10 ${multiGwColWidthClass} align-middle whitespace-nowrap`}
                                >
                                  {renderScoreboardCard(m, gw, `${gw}-${matchIdx}`)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}

          {/* MODE 2: CLUB FIXTURE MATRIX (Rows: 20 Clubs, Columns: GWs — Clean & Symmetric) */}
          {scoreViewMode === 'matrix' && (
            <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/90 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-extrabold text-[11px] whitespace-nowrap">
                    <th
                      className="py-2 px-[8.5px] sticky left-0 z-20 bg-slate-100 dark:bg-[#20133b] border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-[#2a1a4a] transition-colors min-w-[126px] whitespace-nowrap select-none"
                      onClick={() => handleMatrixSort('club')}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>Club</span>
                        {matrixSortCol === 'club' &&
                          (matrixSortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ))}
                      </div>
                    </th>
                    {horizonGWs.map((gw) => {
                      const colKey = `gw_${gw}`;
                      const isSorted = matrixSortCol === colKey;
                      return (
                        <th
                          key={gw}
                          onClick={() => handleMatrixSort(colKey)}
                          title={isIdLang ? `Urutkan berdasarkan hasil GW ${gw}` : `Sort by GW ${gw} result`}
                          className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 w-[115px] min-w-[112px] whitespace-nowrap font-black cursor-pointer select-none transition-colors tabular-nums ${
                            isSorted
                              ? 'bg-[#37003c]/[0.08] dark:bg-[#00ff87]/[0.1] text-[#37003c] dark:text-[#00ff87]'
                              : 'text-[#37003c] dark:text-[#00ff87] hover:bg-slate-200/60 dark:hover:bg-white/10'
                          }`}
                        >
                          <div className="inline-flex items-center justify-center gap-0.5">
                            <span>GW {gw}</span>
                            {isSorted &&
                              (matrixSortDir === 'asc' ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              ))}
                          </div>
                        </th>
                      );
                    })}
                    <th
                      className="py-2 px-2 text-center border-l border-r border-slate-200 dark:border-white/10 cursor-pointer font-black text-[#37003c] dark:text-[#00ff87] bg-[#37003c]/[0.04] dark:bg-[#00ff87]/[0.05] hover:bg-[#37003c]/[0.09] dark:hover:bg-[#00ff87]/[0.1] transition-colors w-14 min-w-[54px] whitespace-nowrap select-none"
                      onClick={() => handleMatrixSort('pts')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>Pts</span>
                        {matrixSortCol === 'pts' &&
                          (matrixSortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          ))}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors w-14 min-w-[54px] whitespace-nowrap select-none"
                      onClick={() => handleMatrixSort('gf')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>GF</span>
                        {matrixSortCol === 'gf' &&
                          (matrixSortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ))}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors w-14 min-w-[54px] whitespace-nowrap select-none"
                      onClick={() => handleMatrixSort('ga')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>GA</span>
                        {matrixSortCol === 'ga' &&
                          (matrixSortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ))}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center cursor-pointer hover:text-black dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors w-14 min-w-[54px] whitespace-nowrap select-none"
                      onClick={() => handleMatrixSort('cs')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>CS</span>
                        {matrixSortCol === 'cs' &&
                          (matrixSortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[#37003c] dark:text-[#00ff87]" />
                          ))}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {sortedClubMatrix.map((row) => (
                    <tr
                      key={row.club.id}
                      className="group hover:bg-slate-50/70 dark:hover:bg-white/[0.025] transition-colors whitespace-nowrap"
                    >
                      {/* Sticky Club Header */}
                      <td className="py-1.5 px-[8.5px] sticky left-0 z-10 bg-white dark:bg-[#1a0f2e] group-hover:bg-slate-50 dark:group-hover:bg-[#23153c] transition-colors border-r border-slate-200 dark:border-white/10 font-bold text-slate-900 dark:text-white min-w-[126px] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <img
                            src={clubBadgeMap.get(row.club.short) || row.club.badgeUrl}
                            alt={row.club.name}
                            className="w-4.5 h-4.5 object-contain shrink-0 filter drop-shadow-xs select-none"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = '/default_team_badge.png';
                            }}
                          />
                          <span className="text-xs font-extrabold whitespace-nowrap">{row.club.name}</span>
                        </div>
                      </td>

                      {/* GW Cells - Handles Single GW, DGW (stacked matches), and BGW (Blank) */}
                      {horizonGWs.map((gw) => {
                        const cell = row.cells[gw];
                        if (!cell || cell.isBlank || cell.matches.length === 0) {
                          return (
                            <td
                              key={gw}
                              title={`${row.club.short} GW ${gw}: Blank Gameweek`}
                              className="py-1.5 px-2 text-center text-slate-400 bg-slate-50/50 dark:bg-white/[0.015] border-r border-slate-200 dark:border-white/10 w-[115px] min-w-[112px] whitespace-nowrap"
                            >
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/5">
                                Blank
                              </span>
                            </td>
                          );
                        }

                        const isWin = cell.result === 'W';
                        const isDraw = cell.result === 'D';
                        const isDgw = cell.matches.length >= 2;
                        const cellTooltip = cell.matches
                          .map((m) => `${row.club.short} vs ${m.oppShort} (${m.isHome ? 'H' : 'A'}) • ${m.scoreText} • xG ${m.xg.toFixed(2)}-${m.oppXg.toFixed(2)} • CS ${m.csProb}%`)
                          .join(' | ');

                        return (
                          <td
                            key={gw}
                            title={cellTooltip}
                            className={`py-1.5 px-2 border-r border-slate-200 dark:border-white/10 w-[115px] min-w-[112px] whitespace-nowrap ${
                              isWin
                                ? 'bg-emerald-500/[0.11] dark:bg-emerald-500/[0.14]'
                                : isDraw
                                ? 'bg-amber-500/[0.11] dark:bg-amber-500/[0.14]'
                                : 'bg-rose-500/[0.11] dark:bg-rose-500/[0.14]'
                            }`}
                          >
                            {!isDgw ? (
                              <div className="flex flex-col gap-1 leading-none">
                                <div className="text-center">
                                  <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100">
                                    {cell.matches[0].oppShort}{' '}
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                                      ({cell.matches[0].isHome ? 'H' : 'A'})
                                    </span>
                                  </span>
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 tabular-nums">
                                  <span className="text-left text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                    {cell.matches[0].xg.toFixed(2)}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 font-black text-[11px] text-slate-900 dark:text-white leading-none text-center">
                                    {cell.matches[0].scoreText}
                                  </span>
                                  <span className="text-right text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    {cell.matches[0].csProb}%
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-0.5 leading-tight">
                                {cell.matches.map((m, idx) => (
                                  <div key={idx} className="flex items-center justify-between gap-1 text-[10px] tabular-nums">
                                    <span className="font-extrabold text-slate-800 dark:text-slate-100">
                                      {m.oppShort}({m.isHome ? 'H' : 'A'})
                                    </span>
                                    <span className="px-1 py-0.2 rounded bg-black/10 dark:bg-white/15 font-black text-[10px] text-slate-900 dark:text-white">
                                      {m.scoreText}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Summary Columns - Symmetric Centered Alignment */}
                      <td className="py-1.5 px-2 text-center font-black text-[#37003c] dark:text-[#00ff87] bg-[#37003c]/[0.03] dark:bg-[#00ff87]/[0.04] border-l border-r border-slate-200 dark:border-white/10 tabular-nums text-xs w-14 min-w-[54px] whitespace-nowrap">
                        {row.totalPts}
                      </td>
                      <td className="py-1.5 px-2 text-center tabular-nums font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-white/10 whitespace-nowrap text-xs w-14 min-w-[54px]">
                        {row.totalGF}
                      </td>
                      <td className="py-1.5 px-2 text-center tabular-nums font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-white/10 whitespace-nowrap text-xs w-14 min-w-[54px]">
                        {row.totalGA}
                      </td>
                      <td className="py-1.5 px-2 text-center tabular-nums font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap text-xs w-14 min-w-[54px]">
                        {row.totalCS}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. SUBTAB: POINTS (GW N+1 TO GW 38)                                       */}
      {/* Table of all FPL players with horizontal GW columns (xP per match)        */}
      {/* ========================================================================= */}
      {subTab === 'points' && (
        <div className="space-y-2">
          {/* Controls Bar: Horizon Slider (GW End Rapat Kanan) + Pos/Club Dropdowns, Search & Total GW */}
          <div className="bg-white dark:bg-[#1a0f2e] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
            {renderGwHorizonControl({ fullWidthEndAligned: true })}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-white/5 pt-2 whitespace-nowrap">
              {/* Position Dropdown */}
              <div className="flex items-center gap-1.5 order-1 shrink-0">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Pos:</span>
                <CustomPopoverSelect
                  value={posFilter}
                  onChange={(val) => setPosFilter(val as 'ALL' | 'GKP' | 'DEF' | 'MID' | 'FWD')}
                  options={[
                    { value: 'ALL', label: 'All' },
                    { value: 'GKP', label: 'GKP' },
                    { value: 'DEF', label: 'DEF' },
                    { value: 'MID', label: 'MID' },
                    { value: 'FWD', label: 'FWD' }
                  ]}
                  className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
                />
              </div>

              {/* Club Dropdown */}
              <div className="flex items-center gap-1.5 order-2 shrink-0">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Club:</span>
                <CustomPopoverSelect
                  value={clubFilter}
                  onChange={(val) => setClubFilter(String(val))}
                  options={[
                    { value: 'ALL', label: 'All' },
                    ...clubs.map((c) => ({ value: c.short, label: c.short }))
                  ]}
                  className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
                />
              </div>

              {/* Proven Filter Toggle */}
              <button
                type="button"
                onClick={() => setProvenOnly((prev) => !prev)}
                title={isIdLang ? 'Tampilkan hanya pemain FPL Proven' : 'Show only FPL Proven players'}
                className={`order-3 shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-extrabold text-center transition-all cursor-pointer border ${
                  provenOnly
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-white/10'
                }`}
              >
                Proven
              </button>

              {/* My Team Filter Toggle */}
              {ownedPlayerIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setMyTeamOnly((prev) => !prev)}
                  title={isIdLang ? 'Tampilkan hanya pemain di skuad saya' : 'Show only players in my team'}
                  className={`order-3 shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-extrabold text-center transition-all cursor-pointer border ${
                    myTeamOnly
                      ? 'bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] border-transparent shadow-xs'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-transparent hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {isIdLang ? 'Tim Saya' : 'My Team'}
                </button>
              )}

              {/* Jumlah GW Horizon (Dipindahkan dari baris slider, rapat kanan di mobile & desktop) */}
              <span className="order-4 md:order-7 ml-auto md:ml-0 px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0">
                {horizonGWs.length} GW
              </span>

              {/* Search Bar */}
              <div className="relative order-5 md:order-4 flex-1 min-w-[160px] md:flex-initial md:w-44 lg:w-52">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={isIdLang ? 'Cari pemain...' : 'Search player...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#00ff87]"
                />
              </div>

              {/* Quick Presets (Desktop XL) */}
              <div className="hidden xl:flex items-center gap-1 order-6 md:order-5 xl:ml-auto shrink-0">
                {[
                  { label: '+3 GW', end: Math.min(targetNextGW + 2, 38) },
                  { label: '+5 GW', end: Math.min(targetNextGW + 4, 38) },
                  { label: '+10 GW', end: Math.min(targetNextGW + 9, 38) },
                  { label: 'GW 38', end: 38 }
                ].map((preset) => {
                  const isActive = gwStart === targetNextGW && gwEnd === preset.end;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setGwStart(targetNextGW);
                        setGwEnd(preset.end);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-[#37003c]/15 text-[#37003c] dark:bg-[#00ff87]/20 dark:text-[#00ff87] border border-[#37003c]/30 dark:border-[#00ff87]/40'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Total Filtered Players */}
              <div className="order-7 md:order-6 md:ml-auto xl:ml-0 text-xs font-bold text-slate-400 shrink-0">
                {filteredPointsRows.length} {isIdLang ? 'pemain' : 'players'}
              </div>
            </div>
          </div>

          {/* Full Player Projections Table */}
          <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-extrabold text-[11px] whitespace-nowrap">
                  <th
                    className="py-1 px-1.5 sm:px-2 sticky left-0 z-20 bg-slate-100 dark:bg-[#20133b] border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[114px] min-w-[114px] sm:w-36 sm:min-w-[130px] whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('player');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Player
                  </th>
                  <th
                    className="py-1 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-11 min-w-[44px] sm:w-14 sm:min-w-[56px] whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('club');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Club
                  </th>
                  <th
                    className="py-1 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[42px] min-w-[42px] sm:w-12 sm:min-w-[48px] whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('pos');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Pos
                  </th>
                  <th
                    className="py-1 px-1 sm:px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[56px] min-w-[56px] sm:w-16 sm:min-w-[64px] whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('price');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Price
                  </th>

                  {/* GW Columns (All Sortable!) */}
                  {horizonGWs.map((gw) => (
                    <th
                      key={gw}
                      className="py-1 px-1.5 sm:px-2 text-center border-r border-slate-200 dark:border-white/10 w-[78px] min-w-[78px] sm:w-[90px] sm:min-w-[90px] whitespace-nowrap cursor-pointer hover:text-black dark:hover:text-white"
                      onClick={() => {
                        setPointsSortCol(`gw_${gw}`);
                        setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                      }}
                    >
                      GW {gw}
                    </th>
                  ))}

                  {/* Summary Columns */}
                  <th
                    className="py-1 px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer font-black text-[#37003c] dark:text-[#00ff87] w-16 whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('total');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Total
                  </th>
                  <th
                    className="py-1 px-1.5 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('avg');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Avg
                  </th>
                  <th
                    className="py-1 px-2 text-right cursor-pointer hover:text-black dark:hover:text-white w-14 whitespace-nowrap"
                    onClick={() => {
                      setPointsSortCol('value');
                      setPointsSortDir(pointsSortDir === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {displayedPointsRows.map((player) => {
                  const isOwned = ownedPlayerIds.has(player.id);
                  return (
                  <tr
                    key={player.id}
                    onClick={() => onSelectPlayer?.(player.id)}
                    className={`transition-colors cursor-pointer whitespace-nowrap leading-none ${
                      isOwned ? `${USER_ROW_BG} ${USER_ROW_HOVER_BG}` : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Sticky Player Name */}
                    <td
                      className={`py-1 px-1.5 sm:px-2 sticky left-0 z-10 border-r border-slate-200 dark:border-white/10 font-bold text-slate-900 dark:text-white w-[114px] min-w-[114px] sm:w-36 sm:min-w-[130px] whitespace-nowrap ${
                        isOwned ? 'bg-emerald-100 dark:bg-[#163832]' : 'bg-white dark:bg-[#1a0f2e]'
                      }`}
                    >
                      {player.webName}
                    </td>
                    <td className="py-0.5 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold w-11 min-w-[44px] sm:w-14 sm:min-w-[56px] whitespace-nowrap">
                      {player.teamShort}
                    </td>
                    <td className="py-0.5 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 w-[42px] min-w-[42px] sm:w-12 sm:min-w-[48px] whitespace-nowrap">
                      <span
                        className={`w-8 sm:w-9 inline-block text-center px-1 sm:px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none whitespace-nowrap ${
                          player.position === 'FWD'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300'
                            : player.position === 'MID'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                            : player.position === 'DEF'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                        }`}
                      >
                        {player.position}
                      </span>
                    </td>
                    <td className="py-0.5 px-1 sm:px-2 text-right border-r border-slate-200 dark:border-white/10 tabular-nums font-semibold text-slate-700 dark:text-slate-300 w-[56px] min-w-[56px] sm:w-16 sm:min-w-[64px] whitespace-nowrap">
                      £{player.nowCost.toFixed(1)}m
                    </td>

                    {/* GW Horizon Cells - Handles Single GW, DGW, and BGW */}
                    {horizonGWs.map((gw) => {
                      const item = player.gwPointsMap[gw];
                      if (!item || item.isBlank || item.matchCount === 0 || item.opp === '-') {
                        return (
                          <td
                            key={gw}
                            className="py-0.5 px-1.5 sm:px-2 border-r border-slate-200 dark:border-white/10 w-[78px] min-w-[78px] sm:w-[90px] sm:min-w-[90px] whitespace-nowrap bg-slate-50/40 dark:bg-white/[0.015]"
                          >
                            <div className="w-full flex items-center justify-between gap-1 leading-none text-slate-400">
                              <span className="text-[10px] font-semibold">Blank</span>
                              <span className="text-[11px] font-bold tabular-nums">0.0</span>
                            </div>
                          </td>
                        );
                      }

                      const isDgw = (item.matchCount || item.matches?.length || 1) >= 2;
                      const dgwTooltip =
                        isDgw && item.matches?.length
                          ? item.matches.map((m) => `${m.oppShort} (${m.isHome ? 'H' : 'A'}): ${m.xp.toFixed(1)} xP`).join(' + ')
                          : undefined;

                      return (
                        <td
                          key={gw}
                          title={dgwTooltip}
                          className={`py-0.5 px-1.5 sm:px-2 border-r border-slate-200 dark:border-white/10 w-[78px] min-w-[78px] sm:w-[90px] sm:min-w-[90px] whitespace-nowrap ${
                            isDgw ? 'bg-emerald-500/[0.08] dark:bg-[#00ff87]/[0.07]' : ''
                          }`}
                        >
                          {isDgw && item.matches && item.matches.length >= 2 ? (
                            <div className="w-full flex items-center justify-between gap-1 leading-tight font-bold">
                              <div className="flex flex-col text-[9px] text-slate-600 dark:text-slate-300 leading-none gap-0.5">
                                {item.matches.slice(0, 2).map((m, i) => (
                                  <span key={i}>
                                    {m.oppShort}({m.isHome ? 'H' : 'A'})
                                  </span>
                                ))}
                              </div>
                              <span className="text-xs font-black text-[#37003c] dark:text-[#00ff87] tabular-nums text-right shrink-0">
                                {item.xp.toFixed(1)}
                              </span>
                            </div>
                          ) : (
                            <div className="w-full whitespace-nowrap flex items-center justify-between gap-1 sm:gap-1.5 leading-none font-bold">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 text-left shrink-0">
                                {item.opp}
                              </span>
                              <span className="text-xs font-black text-[#37003c] dark:text-[#00ff87] tabular-nums text-right shrink-0">
                                {item.xp.toFixed(1)}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    {/* Summary Columns */}
                    <td className="py-0.5 px-2 text-right font-black text-xs text-[#37003c] dark:text-[#00ff87] border-r border-slate-200 dark:border-white/10 tabular-nums w-16 whitespace-nowrap">
                      {player.totalXp.toFixed(1)}
                    </td>
                    <td className="py-0.5 px-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-white/10 whitespace-nowrap text-xs w-14">
                      {player.avgXp.toFixed(1)}
                    </td>
                    <td className="py-0.5 px-2 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap text-xs w-14">
                      {player.valueRatio.toFixed(1)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Progressive Load Bar (Guarantees Instant Sorting & Smooth Horizon Slider) */}
          {filteredPointsRows.length > visibleCount && (
            <div className="py-2.5 px-4 bg-white dark:bg-[#1a0f2e] border border-t-0 border-slate-200 dark:border-white/10 rounded-b-xl flex items-center justify-between gap-3 text-xs flex-wrap">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">
                {isIdLang
                  ? `Menampilkan ${visibleCount} dari ${filteredPointsRows.length} pemain`
                  : `Showing ${visibleCount} of ${filteredPointsRows.length} players`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 50, filteredPointsRows.length))}
                  className="px-3 py-1 rounded-lg font-bold bg-[#37003c]/10 text-[#37003c] dark:bg-[#00ff87]/15 dark:text-[#00ff87] hover:bg-[#37003c]/20 dark:hover:bg-[#00ff87]/25 cursor-pointer transition-colors"
                >
                  {isIdLang ? '+ Muat 50 Lagi' : '+ Load 50 More'}
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredPointsRows.length)}
                  className="px-3 py-1 rounded-lg font-bold bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/15 cursor-pointer transition-colors"
                >
                  {isIdLang ? `Muat Semua (${filteredPointsRows.length})` : `Load All (${filteredPointsRows.length})`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
