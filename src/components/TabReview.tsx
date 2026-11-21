import React, { useState, useMemo, useEffect, useCallback, useDeferredValue, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Layers,
  LayoutGrid
} from 'lucide-react';
import {
  TransformedLeagueData,
  ReviewSubTab,
  PositionType,
  GwEventStatus,
  SyncStatus,
  ProjectionClubItem,
  ScheduleFixtureSummary,
  ProjectedFixtureOutcome,
  ClubGwMatchProjectionItem,
  ProjectedPlayerCoreItem,
  ServerReviewBundlePayload,
  ActualMatchReviewEntry
} from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { useUserProfileId, USER_ROW_BG, USER_ROW_HOVER_BG } from '../utils/userProfile.ts';
import { PROJECTION_FORMULA_VERSION } from '../utils/projectionModel.ts';

interface TabReviewProps {
  leagueData?: TransformedLeagueData;
  currentGW?: number;
  availableGWs?: number[];
  subTab: ReviewSubTab;
  onSelectSubTab?: (sub: ReviewSubTab) => void;
  onSelectManager?: (managerId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  syncStatus?: SyncStatus;
  active?: boolean;
  sharedEpochKey?: string;
  sharedMaxReviewGW?: number;
  sharedClubs?: ProjectionClubItem[];
  sharedScheduleByGw?: Record<number, ScheduleFixtureSummary[]>;
  sharedClubGwMatchProjections?: Record<string, ClubGwMatchProjectionItem[]>;
  sharedProjectFixture?: (homeShort: string, awayShort: string, gw?: number) => ProjectedFixtureOutcome;
  playerProjections?: ProjectedPlayerCoreItem[];
  sharedMatchesByGW?: Record<number, any[]>;
}

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

const POS_ORDER: Record<string, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const ROLE_ORDER: Record<string, number> = { starting: 1, bench: 2, out: 3 };

export const TabReview: React.FC<TabReviewProps> = ({
  leagueData,
  currentGW,
  availableGWs = [],
  subTab,
  onSelectPlayer,
  gwStatus,
  eventsStatus,
  active,
  sharedEpochKey,
  sharedMaxReviewGW,
  sharedClubs,
  sharedScheduleByGw,
  sharedClubGwMatchProjections,
  sharedProjectFixture,
  playerProjections,
  sharedMatchesByGW,
}) => {
  const { language } = useLanguage();
  const isIdLang = language === 'id';
  const profileId = useUserProfileId();

  const clubs = useMemo<ProjectionClubItem[]>(
    () => (sharedClubs && sharedClubs.length > 0 ? sharedClubs : FALLBACK_PREMIER_LEAGUE_CLUBS),
    [sharedClubs]
  );

  // User profile owned player IDs (for green row highlights & My Team filter)
  const ownedPlayerIds = useMemo(() => {
    const set = new Set<number>();
    if (!profileId || !leagueData?.ownership_players) return set;
    const gwKeys = Object.keys(leagueData.ownership_players)
      .map(Number)
      .filter((n) => !isNaN(n) && (leagueData.ownership_players[n]?.length || 0) > 0);
    const targetGw =
      currentGW && leagueData.ownership_players[currentGW]?.length
        ? currentGW
        : gwKeys.length > 0
        ? Math.max(...gwKeys)
        : 0;
    if (!targetGw) return set;
    for (const p of leagueData.ownership_players[targetGw] || []) {
      if (p.owners?.some((o) => o.entry_id === profileId)) {
        set.add(p.id);
      }
    }
    return set;
  }, [profileId, leagueData?.ownership_players, currentGW]);

  // Scope of Review: GW 1 up to latest started/Provisional/Confirmed GW (never includes Not Started future GW)
  const maxReviewGW = useMemo(() => {
    if (typeof sharedMaxReviewGW === 'number' && sharedMaxReviewGW >= 1) {
      return Math.min(Math.max(sharedMaxReviewGW, 1), 38);
    }
    const available = Array.isArray(availableGWs) && availableGWs.length > 0 ? availableGWs : [1];
    const curr = currentGW || Math.max(...available, 1);
    const evStatus = eventsStatus?.[curr] || (gwStatus?.event === curr ? gwStatus : undefined);
    const isNotStarted = evStatus?.status === 'Not started';
    const effectiveMax = isNotStarted ? Math.max(curr - 1, 1) : curr;
    return Math.min(Math.max(effectiveMax, 1), 38);
  }, [sharedMaxReviewGW, availableGWs, currentGW, eventsStatus, gwStatus]);

  const targetEpochKey = sharedEpochKey || `fallback:${maxReviewGW}:${PROJECTION_FORMULA_VERSION}`;

  // Independent GW Horizon State per subtab (matching TabProjection)
  const [scoreGwStart, setScoreGwStart] = useState<number>(() => maxReviewGW);
  const [scoreGwEnd, setScoreGwEnd] = useState<number>(() => maxReviewGW);
  const [pointsGwStart, setPointsGwStart] = useState<number>(1);
  const [pointsGwEnd, setPointsGwEnd] = useState<number>(() => maxReviewGW);
  const [activeThumb, setActiveThumb] = useState<'start' | 'end'>('end');

  const gwStart = subTab === 'score' ? scoreGwStart : pointsGwStart;
  const gwEnd = subTab === 'score' ? scoreGwEnd : pointsGwEnd;
  const setGwStart = subTab === 'score' ? setScoreGwStart : setPointsGwStart;
  const setGwEnd = subTab === 'score' ? setScoreGwEnd : setPointsGwEnd;

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
        const clubList = leagueData.ownership_clubs[Number(gwKey)] || [];
        for (const c of clubList) {
          if (c.badge_url) {
            if (c.short_name) map.set(c.short_name, c.badge_url);
            if (c.name) map.set(c.name, c.badge_url);
            if (c.club_id) map.set(String(c.club_id), c.badge_url);
          }
        }
      }
    }
    return map;
  }, [clubs, leagueData]);

  // Resolve player ID for MAE drawer entries (prefers explicit id, falls back to webName + teamShort lookup)
  const reviewPlayerLookup = useMemo(() => {
    const byNameTeam = new Map<string, number>();
    const byName = new Map<string, number>();
    if (playerProjections) {
      for (const p of playerProjections) {
        if (!p?.id || !p?.webName) continue;
        const n = p.webName.trim().toLowerCase();
        const t = (p.teamShort || '').trim().toUpperCase();
        if (t) byNameTeam.set(`${n}__${t}`, p.id);
        if (!byName.has(n)) byName.set(n, p.id);
      }
    }
    if (leagueData?.player_stats) {
      for (const p of leagueData.player_stats) {
        if (!p?.id || !p?.webName) continue;
        const n = p.webName.trim().toLowerCase();
        const t = (p.teamShort || '').trim().toUpperCase();
        if (t && !byNameTeam.has(`${n}__${t}`)) byNameTeam.set(`${n}__${t}`, p.id);
        if (!byName.has(n)) byName.set(n, p.id);
      }
    }
    return { byNameTeam, byName };
  }, [playerProjections, leagueData?.player_stats]);

  const resolveReviewPlayerId = useCallback(
    (explicitId?: number, webName?: string, teamShort?: string): number | undefined => {
      if (typeof explicitId === 'number' && explicitId > 0) return explicitId;
      if (!webName) return undefined;
      const n = webName.trim().toLowerCase();
      const t = (teamShort || '').trim().toUpperCase();
      if (t) {
        const exact = reviewPlayerLookup.byNameTeam.get(`${n}__${t}`);
        if (exact) return exact;
      }
      return reviewPlayerLookup.byName.get(n);
    },
    [reviewPlayerLookup]
  );

  // Keep bounds in sync if maxReviewGW changes
  useEffect(() => {
    setScoreGwStart((prev) => Math.min(Math.max(prev, 1), maxReviewGW));
    setScoreGwEnd((prev) => Math.min(Math.max(prev, 1), maxReviewGW));
    setPointsGwStart((prev) => Math.min(Math.max(prev, 1), maxReviewGW));
    setPointsGwEnd((prev) => Math.min(Math.max(prev, 1), maxReviewGW));
  }, [maxReviewGW]);

  const handleGwStartChange = (val: number) => {
    const newStart = Math.max(1, Math.min(val, maxReviewGW));
    setGwStart(newStart);
    if (gwEnd < newStart) {
      setGwEnd(newStart);
    }
  };

  const handleGwEndChange = (val: number) => {
    const newEnd = Math.max(1, Math.min(val, maxReviewGW));
    setGwEnd(newEnd);
    if (newEnd < gwStart) {
      setGwStart(newEnd);
    }
  };

  const startGwOptions = useMemo(() => {
    const opts: Array<{ value: number; label: string }> = [];
    for (let gw = 1; gw <= maxReviewGW; gw++) {
      opts.push({ value: gw, label: `GW ${gw}` });
    }
    return opts;
  }, [maxReviewGW]);

  const endGwOptions = useMemo(() => {
    const opts: Array<{ value: number; label: string }> = [];
    for (let gw = 1; gw <= maxReviewGW; gw++) {
      opts.push({ value: gw, label: `GW ${gw}` });
    }
    return opts;
  }, [maxReviewGW]);

  // Horizon GW list from gwStart to gwEnd
  const horizonGWs = useMemo(() => {
    const list: number[] = [];
    const start = Math.max(gwStart, 1);
    const end = Math.min(Math.max(gwEnd, start), maxReviewGW);
    for (let gw = start; gw <= end; gw++) {
      list.push(gw);
    }
    return list;
  }, [gwStart, gwEnd, maxReviewGW]);

  // Line-up subtab GW selection (needed for epoch-gated server review fetch)
  const [lineupReviewGW, setLineupReviewGW] = useState<number>(() => maxReviewGW);
  useEffect(() => {
    setLineupReviewGW((prev) => Math.min(Math.max(prev, 1), maxReviewGW));
  }, [maxReviewGW]);

  // Epoch-gated Server Review Bundle Fetch (syncs ONLY on Live -> Provisional / Provisional -> Confirmed)
  const [reviewBundle, setReviewBundle] = useState<ServerReviewBundlePayload | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState<boolean>(false);
  const reviewCacheRef = useRef<Map<string, ServerReviewBundlePayload>>(new Map());
  const inFlightReviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (active === false || !leagueData) return;
    const reqGw = subTab === 'line-up' ? lineupReviewGW : maxReviewGW;
    const exactKey = `${targetEpochKey}:${reqGw}`;
    const exactCached = reviewCacheRef.current.get(exactKey);
    if (exactCached) {
      if (reviewBundle !== exactCached) setReviewBundle(exactCached);
      return;
    }
    if (subTab !== 'line-up' && reviewBundle?.epochKey === targetEpochKey) {
      return;
    }
    if (inFlightReviewKeyRef.current === exactKey) return;

    inFlightReviewKeyRef.current = exactKey;
    setIsLoadingReview(true);
    let cancelled = false;

    fetch(`/api/projections-review?gw=${reqGw}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.success || !json.data) return;
        const payload = json.data as ServerReviewBundlePayload;
        reviewCacheRef.current.set(`${targetEpochKey}:${reqGw}`, payload);
        reviewCacheRef.current.set(`${payload.epochKey}:${payload.lineupGw}`, payload);
        setReviewBundle(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (inFlightReviewKeyRef.current === exactKey) {
          inFlightReviewKeyRef.current = null;
        }
        if (!cancelled) setIsLoadingReview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, leagueData, targetEpochKey, subTab, lineupReviewGW, maxReviewGW, reviewBundle]);

  const actualMatchLookup = useMemo(
    () => reviewBundle?.actualMatchLookup || ({} as Record<string, ActualMatchReviewEntry[]>),
    [reviewBundle]
  );

  const actualPlayerStatsMap = useMemo(
    () => reviewBundle?.actualPlayerStatsMap || ({} as ServerReviewBundlePayload['actualPlayerStatsMap']),
    [reviewBundle]
  );

  const scheduleByGw = useMemo<Record<number, any[]>>(
    () => sharedScheduleByGw ?? sharedMatchesByGW ?? {},
    [sharedScheduleByGw, sharedMatchesByGW]
  );

  const projectFixture = useCallback(
    (homeShort: string, awayShort: string, gw?: number): ProjectedFixtureOutcome => {
      if (sharedProjectFixture) return sharedProjectFixture(homeShort, awayShort, gw);
      return {
        homeGoals: 1,
        awayGoals: 1,
        homeCsProb: 30,
        awayCsProb: 25,
        lambdaH: 1.35,
        lambdaA: 1.15,
        homeExpGcPenalty: -0.35,
        awayExpGcPenalty: -0.45,
      };
    },
    [sharedProjectFixture]
  );

  // =========================================================================
  // SUBTAB 2: SCORE REVIEW (Match Scoreboard & Club Matrix with DGW/BGW)
  // =========================================================================
  const [scoreViewMode, setScoreViewMode] = useState<'scoreboard' | 'matrix'>('scoreboard');
  const [matrixSortCol, setMatrixSortCol] = useState<string>('pts');
  const [matrixSortDir, setMatrixSortDir] = useState<'asc' | 'desc'>('desc');

  const handleMatrixSort = (col: string) => {
    if (matrixSortCol === col) {
      setMatrixSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setMatrixSortCol(col);
      setMatrixSortDir(col === 'club' || col === 'ga' ? 'asc' : 'desc');
    }
  };

  const clubScoreMatrix = useMemo(() => {
    if (subTab !== 'score') return [];
    return clubs.map((club) => {
      let projTotalPts = 0;
      let realTotalPts = 0;
      let projTotalGf = 0;
      let realTotalGf = 0;
      let projTotalGa = 0;
      let realTotalGa = 0;
      let projTotalCs = 0;
      let realTotalCs = 0;
      let correctResults = 0;
      let finishedMatches = 0;
      let totalMatches = 0;

      const cells: Record<
        number,
        {
          isBlank: boolean;
          matches: Array<{
            oppShort: string;
            isHome: boolean;
            projScore: string;
            projGoals: number;
            projOppGoals: number;
            projCsProb: number;
            projResult: 'W' | 'D' | 'L';
            realScore: string;
            realTeamGoals: number | null;
            realOppGoals: number | null;
            realResult: 'W' | 'D' | 'L' | null;
            realPts: number;
            realCs: boolean;
            isExactScore: boolean;
            isResultMatch: boolean;
            hasReal: boolean;
          }>;
          oppShort: string;
          isHome: boolean;
          projScore: string;
          projCsProb: number;
          realScore: string;
          realPts: number;
          realTeamGoals: number | null;
          realOppGoals: number | null;
          isExactScore: boolean;
          isResultMatch: boolean;
          hasReal: boolean;
        }
      > = {};

      for (const gw of horizonGWs) {
        const projList = sharedClubGwMatchProjections?.[`${club.short}_${gw}`] || [];
        const realList = actualMatchLookup[`${gw}_${club.short}`] || [];

        if (projList.length === 0 && realList.length === 0) {
          cells[gw] = {
            isBlank: true,
            matches: [],
            oppShort: 'Blank',
            isHome: true,
            projScore: '-',
            projCsProb: 0,
            realScore: '-',
            realPts: 0,
            realTeamGoals: null,
            realOppGoals: null,
            isExactScore: false,
            isResultMatch: false,
            hasReal: false,
          };
          continue;
        }

        const fixturesToEval =
          projList.length > 0
            ? projList.map((f) => ({
                oppShort: f.oppShort,
                isHome: f.isHome,
                teamGoals: f.teamGoals,
                oppGoals: f.oppGoals,
                csProbPct: f.csProbPct ?? Math.round((f.csProb ?? 0) * 100),
              }))
            : realList.map((r) => {
                const outcome = r.isHome
                  ? projectFixture(club.short, r.oppShort, gw)
                  : projectFixture(r.oppShort, club.short, gw);
                return {
                  oppShort: r.oppShort,
                  isHome: r.isHome,
                  teamGoals: r.isHome ? outcome.homeGoals : outcome.awayGoals,
                  oppGoals: r.isHome ? outcome.awayGoals : outcome.homeGoals,
                  csProbPct: r.isHome ? outcome.homeCsProb : outcome.awayCsProb,
                };
              });

        const matchEntries: Array<{
          oppShort: string;
          isHome: boolean;
          projScore: string;
          projGoals: number;
          projOppGoals: number;
          projCsProb: number;
          projResult: 'W' | 'D' | 'L';
          realScore: string;
          realTeamGoals: number | null;
          realOppGoals: number | null;
          realResult: 'W' | 'D' | 'L' | null;
          realPts: number;
          realCs: boolean;
          isExactScore: boolean;
          isResultMatch: boolean;
          hasReal: boolean;
        }> = [];

        let cellRealPts = 0;
        let cellRealGf = 0;
        let cellRealGa = 0;

        for (const f of fixturesToEval) {
          totalMatches += 1;
          const projWin = f.teamGoals > f.oppGoals;
          const projDraw = f.teamGoals === f.oppGoals;
          const projResult: 'W' | 'D' | 'L' = projWin ? 'W' : projDraw ? 'D' : 'L';
          const projPts = projWin ? 3 : projDraw ? 1 : 0;

          projTotalPts += projPts;
          projTotalGf += f.teamGoals;
          projTotalGa += f.oppGoals;
          if (f.oppGoals === 0) projTotalCs += 1;

          const real =
            realList.find((r) => r.oppShort === f.oppShort && r.isHome === f.isHome) ||
            (realList.length === 1 && fixturesToEval.length === 1 ? realList[0] : undefined);

          let realResult: 'W' | 'D' | 'L' | null = null;
          let realPts = 0;
          let isExactScore = false;
          let isResultMatch = false;
          const hasReal = Boolean(real && real.finished && real.teamScore !== null && real.oppScore !== null);

          if (hasReal && real) {
            finishedMatches += 1;
            realResult = real.result;
            realPts = real.result === 'W' ? 3 : real.result === 'D' ? 1 : 0;
            realTotalPts += realPts;
            realTotalGf += real.teamScore!;
            realTotalGa += real.oppScore!;
            cellRealPts += realPts;
            cellRealGf += real.teamScore!;
            cellRealGa += real.oppScore!;
            if (real.cleanSheet) realTotalCs += 1;

            isExactScore = f.teamGoals === real.teamScore && f.oppGoals === real.oppScore;
            isResultMatch = projResult === realResult;
            if (isResultMatch) correctResults += 1;
          }

          matchEntries.push({
            oppShort: f.oppShort,
            isHome: f.isHome,
            projScore: `${f.teamGoals}-${f.oppGoals}`,
            projGoals: f.teamGoals,
            projOppGoals: f.oppGoals,
            projCsProb: f.csProbPct,
            projResult,
            realScore: hasReal && real ? `${real.teamScore}-${real.oppScore}` : '-',
            realTeamGoals: real?.teamScore ?? null,
            realOppGoals: real?.oppScore ?? null,
            realResult,
            realPts,
            realCs: real ? real.cleanSheet : false,
            isExactScore,
            isResultMatch,
            hasReal,
          });
        }

        const primary = matchEntries[0];
        const anyReal = matchEntries.some((me) => me.hasReal);
        const allExact = matchEntries.length > 0 && matchEntries.every((me) => me.hasReal && me.isExactScore);
        const allResultMatch =
          matchEntries.length > 0 &&
          anyReal &&
          matchEntries.every((me) => !me.hasReal || me.isResultMatch);

        cells[gw] = {
          isBlank: false,
          matches: matchEntries,
          oppShort: matchEntries.map((me) => `${me.oppShort}(${me.isHome ? 'H' : 'A'})`).join(' + '),
          isHome: primary?.isHome ?? true,
          projScore: matchEntries.map((me) => me.projScore).join(' | '),
          projCsProb: primary?.projCsProb ?? 0,
          realScore: matchEntries.map((me) => me.realScore).join(' | '),
          realPts: cellRealPts,
          realTeamGoals: anyReal ? cellRealGf : null,
          realOppGoals: anyReal ? cellRealGa : null,
          isExactScore: allExact,
          isResultMatch: allResultMatch,
          hasReal: anyReal,
        };
      }

      const denom = finishedMatches > 0 ? finishedMatches : totalMatches;
      const accPct = denom > 0 ? Math.round((correctResults / denom) * 100) : 0;

      return {
        club,
        cells,
        projTotalPts,
        realTotalPts,
        projTotalGf,
        realTotalGf,
        projTotalGa,
        realTotalGa,
        projTotalCs,
        realTotalCs,
        correctResults,
        finishedMatches,
        totalMatches,
        accPct,
      };
    });
  }, [subTab, clubs, horizonGWs, sharedClubGwMatchProjections, actualMatchLookup, projectFixture]);

  const sortedClubMatrix = useMemo(() => {
    const list = [...clubScoreMatrix];
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
        const scoreCell = (c: typeof cellA) =>
          (c.isExactScore ? 100 : c.isResultMatch ? 50 : 0) +
          (c.realPts || 0) * 5 +
          ((c.realTeamGoals ?? 0) - (c.realOppGoals ?? 0));
        const cmp = scoreCell(cellB) - scoreCell(cellA);
        if (cmp !== 0) return matrixSortDir === 'desc' ? cmp : -cmp;
        return a.club.name.localeCompare(b.club.name);
      }
      let vA = 0;
      let vB = 0;
      if (matrixSortCol === 'pts') { vA = a.realTotalPts; vB = b.realTotalPts; }
      else if (matrixSortCol === 'gf') { vA = a.realTotalGf; vB = b.realTotalGf; }
      else if (matrixSortCol === 'ga') { vA = a.realTotalGa; vB = b.realTotalGa; }
      else if (matrixSortCol === 'cs') { vA = a.realTotalCs; vB = b.realTotalCs; }
      else if (matrixSortCol === 'acc') { vA = a.accPct; vB = b.accPct; }
      return matrixSortDir === 'asc' ? vA - vB : vB - vA;
    });
    return list;
  }, [clubScoreMatrix, matrixSortCol, matrixSortDir]);

  // =========================================================================
  // SUBTAB 1: LINE UP REVIEW (Server-computed Squad Lineup Proj vs Reality)
  // =========================================================================
  const [lineupSortCol, setLineupSortCol] = useState<string>('role');
  const [lineupSortDir, setLineupSortDir] = useState<'asc' | 'desc'>('asc');

  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(() => new Set());
  const toggleClubAccordion = (short: string) => {
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(short)) next.delete(short);
      else next.add(short);
      return next;
    });
  };

  const lineupReviewPerClub = useMemo(
    () => reviewBundle?.lineupReviewPerClub || {},
    [reviewBundle]
  );

  const lineupGwSummary = useMemo(
    () => reviewBundle?.lineupGwSummary || { playedClubs: 0, totalHit: 0, avgHit: 0, pct: 0 },
    [reviewBundle]
  );

  // =========================================================================
  // SUBTAB 3: PLAYER POINTS REVIEW (Final xP vs Real Points Side-by-Side)
  // =========================================================================
  const [posFilter, setPosFilter] = useState<'ALL' | PositionType>('ALL');
  const [clubFilter, setClubFilter] = useState<string>('ALL');
  const [myTeamOnly, setMyTeamOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [pointsSortCol, setPointsSortCol] = useState<string>('totalReal');
  const [pointsSortDir, setPointsSortDir] = useState<'asc' | 'desc'>('desc');
  const [visibleCount, setVisibleCount] = useState<number>(50);

  const handlePointsSort = (col: string) => {
    if (pointsSortCol === col) {
      setPointsSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setPointsSortCol(col);
      setPointsSortDir(col === 'player' || col === 'club' || col === 'pos' || col === 'mae' ? 'asc' : 'desc');
    }
  };

  useEffect(() => {
    setVisibleCount(50);
  }, [posFilter, clubFilter, myTeamOnly, deferredSearchQuery, pointsSortCol, pointsSortDir, pointsGwStart, pointsGwEnd]);

  const playerPointsReviewRows = useMemo(() => {
    if (subTab !== 'points') return [];
    const players: any[] =
      playerProjections && playerProjections.length > 0
        ? playerProjections
        : (leagueData?.player_stats || []).filter((p) => p.status !== 'u');

    return players.map((p: any) => {
      const pos = p.position as PositionType;
      const costMil = typeof p.nowCost === 'number' ? (p.nowCost > 20 ? p.nowCost / 10 : p.nowCost) : 5.0;
      const cShort = p.teamShort;

      const gwMap: Record<
        number,
        {
          opp: string;
          isHome: boolean;
          xp: number;
          baseXp: number;
          spikeMod: number;
          realPts: number;
          diff: number;
          realMins: number;
          hasReal: boolean;
          isBlank: boolean;
          isDgw: boolean;
        }
      > = {};
      let sumProj = 0;
      let sumReal = 0;
      let sumAbsDiff = 0;
      let matchCount = 0;

      const playerStatByGw = actualPlayerStatsMap[p.id];

      for (const gw of horizonGWs) {
        const projCell = p.fullSeasonPointsMap?.[gw];
        const projMatches = sharedClubGwMatchProjections?.[`${cShort}_${gw}`] || [];
        const actualList = actualMatchLookup[`${gw}_${cShort}`] || [];
        const isBlank = Boolean(projCell?.isBlank || (projMatches.length === 0 && !projCell && actualList.length === 0));

        if (isBlank) {
          gwMap[gw] = {
            opp: 'Blank',
            isHome: true,
            xp: 0,
            baseXp: 0,
            spikeMod: 0,
            realPts: 0,
            diff: 0,
            realMins: 0,
            hasReal: false,
            isBlank: true,
            isDgw: false,
          };
          continue;
        }

        const xp = projCell ? projCell.xp ?? 0 : 0;
        const baseXp = projCell ? projCell.baseXp ?? 0 : 0;
        const spikeMod = projCell ? projCell.spikeMod ?? 0 : 0;
        const opp =
          projCell?.opp ||
          (projMatches.length > 0
            ? projMatches.map((m) => `${m.oppShort} (${m.isHome ? 'H' : 'A'})`).join(' + ')
            : actualList.length > 0
            ? actualList.map((m) => `${m.oppShort} (${m.isHome ? 'H' : 'A'})`).join(' + ')
            : '-');
        const isHome = projCell?.isHome ?? (projMatches[0]?.isHome ?? actualList[0]?.isHome ?? true);
        const isDgw = Boolean(projCell?.isDgw || projMatches.length >= 2 || actualList.length >= 2);

        const realGw = playerStatByGw?.[gw];
        const isClubMatchPlayed = actualList.some((m) => m.finished || m.teamScore !== null);
        const realPts = realGw ? realGw.pts : 0;
        const realMins = realGw ? realGw.mins : 0;
        const hasReal = Boolean(realGw);
        const diff = Math.round((realPts - xp) * 10) / 10;

        if (hasReal || isClubMatchPlayed) {
          matchCount += 1;
          sumProj += xp;
          sumReal += realPts;
          sumAbsDiff += Math.abs(diff);
        }

        gwMap[gw] = {
          opp,
          isHome,
          xp,
          baseXp,
          spikeMod,
          realPts,
          diff,
          realMins,
          hasReal,
          isBlank: false,
          isDgw,
        };
      }

      const count = Math.max(matchCount, 1);
      const totalProj = Math.round(sumProj * 10) / 10;
      const totalReal = sumReal;
      const diff = Math.round((totalReal - totalProj) * 10) / 10;
      const avgProj = Math.round((totalProj / count) * 10) / 10;
      const avgReal = Math.round((totalReal / count) * 10) / 10;
      const mae = Math.round((sumAbsDiff / count) * 10) / 10;

      return {
        id: p.id,
        webName: p.webName,
        fullName: p.fullName,
        teamShort: cShort,
        position: pos,
        nowCost: costMil,
        gwMap,
        totalProj,
        totalReal,
        diff,
        avgProj,
        avgReal,
        mae,
      };
    });
  }, [subTab, playerProjections, leagueData?.player_stats, horizonGWs, sharedClubGwMatchProjections, actualPlayerStatsMap, actualMatchLookup]);

  const filteredPointsReviewRows = useMemo(() => {
    let list = [...playerPointsReviewRows];

    if (posFilter !== 'ALL') {
      list = list.filter((p) => p.position === posFilter);
    }
    if (clubFilter !== 'ALL') {
      list = list.filter((p) => p.teamShort === clubFilter);
    }
    if (myTeamOnly && ownedPlayerIds.size > 0) {
      list = list.filter((p) => ownedPlayerIds.has(p.id));
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.webName.toLowerCase().includes(q) ||
          p.fullName.toLowerCase().includes(q) ||
          p.teamShort.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let vA = 0;
      let vB = 0;
      if (pointsSortCol === 'player') {
        return pointsSortDir === 'asc' ? a.webName.localeCompare(b.webName) : b.webName.localeCompare(a.webName);
      }
      if (pointsSortCol === 'club') {
        return pointsSortDir === 'asc' ? a.teamShort.localeCompare(b.teamShort) : b.teamShort.localeCompare(a.teamShort);
      }
      if (pointsSortCol.startsWith('gw_')) {
        const gwNum = parseInt(pointsSortCol.replace('gw_', ''), 10);
        const cA = a.gwMap[gwNum];
        const cB = b.gwMap[gwNum];
        vA = cA && !cA.isBlank ? (cA.hasReal ? cA.realPts * 100 + cA.xp : cA.xp) : -999;
        vB = cB && !cB.isBlank ? (cB.hasReal ? cB.realPts * 100 + cB.xp : cB.xp) : -999;
      } else if (pointsSortCol === 'pos') {
        vA = POS_ORDER[a.position] || 99;
        vB = POS_ORDER[b.position] || 99;
      } else if (pointsSortCol === 'cost') {
        vA = a.nowCost;
        vB = b.nowCost;
      } else if (pointsSortCol === 'totalProj') {
        vA = a.totalProj;
        vB = b.totalProj;
      } else if (pointsSortCol === 'totalReal') {
        vA = a.totalReal;
        vB = b.totalReal;
      } else if (pointsSortCol === 'diff') {
        vA = a.diff;
        vB = b.diff;
      } else if (pointsSortCol === 'avgProj') {
        vA = a.avgProj;
        vB = b.avgProj;
      } else if (pointsSortCol === 'avgReal') {
        vA = a.avgReal;
        vB = b.avgReal;
      } else if (pointsSortCol === 'mae') {
        vA = a.mae;
        vB = b.mae;
      }
      return pointsSortDir === 'asc' ? vA - vB : vB - vA;
    });

    return list;
  }, [playerPointsReviewRows, posFilter, clubFilter, myTeamOnly, ownedPlayerIds, deferredSearchQuery, pointsSortCol, pointsSortDir]);

  const displayedPointsReviewRows = useMemo(() => {
    return filteredPointsReviewRows.slice(0, visibleCount);
  }, [filteredPointsReviewRows, visibleCount]);

  // Dual-Thumb Slider Horizon Control matching TabProjection (flanked left & right, full-width option)
  const renderGwHorizonControl = (options?: { fullWidthEndAligned?: boolean }) => {
    const fullWidthEndAligned = options?.fullWidthEndAligned ?? false;
    const minGw = 1;
    const maxGw = maxReviewGW;
    const rangeSpan = Math.max(maxGw - minGw, 1);
    const leftPercent = Math.max(0, Math.min(100, ((gwStart - minGw) / rangeSpan) * 100));
    const rightPercent = Math.max(0, Math.min(100, ((gwEnd - minGw) / rangeSpan) * 100));

    return (
      <div className={`flex items-center gap-2 sm:gap-2.5 ${fullWidthEndAligned ? 'w-full' : 'w-full sm:w-auto'}`}>
        {/* Left: Start GW */}
        <div className="shrink-0" title={isIdLang ? 'GW Awal Review' : 'Review Start GW'}>
          <CustomPopoverSelect
            value={gwStart}
            onChange={(val) => handleGwStartChange(Number(val))}
            options={startGwOptions}
            className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
          />
        </div>

        {/* Center: Dual-Thumb Range Slider */}
        <div
          className={`relative flex-1 min-w-[80px] ${
            fullWidthEndAligned ? '' : 'sm:min-w-[130px] md:min-w-[170px] max-w-[220px]'
          } h-6 flex items-center`}
        >
          <div className="absolute inset-x-0 my-auto h-2 w-full rounded-full bg-slate-200 dark:bg-white/15" />
          <div
            className="absolute inset-y-0 my-auto h-2 rounded-full bg-[#37003c] dark:bg-[#00ff87] transition-all duration-75"
            style={{
              left: `${leftPercent}%`,
              width: `${Math.max(rightPercent - leftPercent, 0)}%`
            }}
          />
          <input
            type="range"
            min={minGw}
            max={maxGw}
            step={1}
            value={gwStart}
            onMouseDown={() => setActiveThumb('start')}
            onTouchStart={() => setActiveThumb('start')}
            onChange={(e) => handleGwStartChange(Number(e.target.value))}
            className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none ${
              activeThumb === 'start' ? 'z-30' : 'z-20'
            } [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#37003c] dark:[&::-webkit-slider-thumb]:border-[#00ff87] dark:[&::-webkit-slider-thumb]:bg-[#1a0f2e] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#37003c] dark:[&::-moz-range-thumb]:border-[#00ff87] dark:[&::-moz-range-thumb]:bg-[#1a0f2e] [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab`}
            title={`GW Awal: ${gwStart}`}
          />
          <input
            type="range"
            min={minGw}
            max={maxGw}
            step={1}
            value={gwEnd}
            onMouseDown={() => setActiveThumb('end')}
            onTouchStart={() => setActiveThumb('end')}
            onChange={(e) => handleGwEndChange(Number(e.target.value))}
            className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none ${
              activeThumb === 'end' ? 'z-30' : 'z-20'
            } [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#37003c] dark:[&::-webkit-slider-thumb]:border-[#00ff87] dark:[&::-webkit-slider-thumb]:bg-[#1a0f2e] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#37003c] dark:[&::-moz-range-thumb]:border-[#00ff87] dark:[&::-moz-range-thumb]:bg-[#1a0f2e] [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab`}
            title={`GW Akhir: ${gwEnd}`}
          />
        </div>

        {/* Right: End GW */}
        <div className={`shrink-0 ${fullWidthEndAligned ? 'ml-auto' : ''}`} title={isIdLang ? 'GW Akhir Review' : 'Review End GW'}>
          <CustomPopoverSelect
            value={gwEnd}
            onChange={(val) => handleGwEndChange(Number(val))}
            options={endGwOptions}
            className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 py-1.5 px-1.5 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
          />
        </div>
      </div>
    );
  };

  // =========================================================================
  // SUBTAB 4: MAE REVIEW (GW 1 s.d. GW n Accuracy & Mean Absolute Error Recap)
  // =========================================================================
  const [maeViewMode, setMaeViewMode] = useState<'all' | 'score' | 'lineup' | 'points'>('all');
  const [maeSortCol, setMaeSortCol] = useState<'gw' | 'goalMae' | 'outcomeAcc' | 'exactScore' | 'lineupAcc' | 'avgStarters' | 'startersMae' | 'activeMae' | 'composite'>('gw');
  const [maeSortDir, setMaeSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedMaeGw, setExpandedMaeGw] = useState<number | null>(null);
  const [maeHorizonPreset, setMaeHorizonPreset] = useState<'all' | 'last5' | 'last3'>('all');
  const [selectedDrilldownTab, setSelectedDrilldownTab] = useState<'score' | 'lineup' | 'points'>('score');

  // Server-computed Accuracy & Mean Absolute Error Recap (zero client recomputation)
  const allMaeRecapRows = useMemo(
    () => (reviewBundle?.maeRecapRows || []),
    [reviewBundle]
  );

  // Filtered rows by preset horizon
  const filteredMaeRows = useMemo(() => {
    let rows = [...allMaeRecapRows];
    if (maeHorizonPreset === 'last5') {
      rows = rows.slice(-5);
    } else if (maeHorizonPreset === 'last3') {
      rows = rows.slice(-3);
    }
    return rows;
  }, [allMaeRecapRows, maeHorizonPreset]);

  // Dynamic Summary computed strictly over filteredMaeRows (matches horizon filter)
  const seasonMaeSummary = useMemo(() => {
    let totalMatches = 0;
    let totalOutcomeHits = 0;
    let totalExactScoreHits = 0;
    let sumTeamGoalsDiff = 0;
    let sumStartersHit = 0;
    let sumStartersProj = 0;
    let sumStartersAbsDiff = 0;
    let sumStartersCount = 0;
    let sumActiveAbsDiff = 0;
    let sumActiveCount = 0;
    let finishedGwsCount = 0;

    for (const row of filteredMaeRows) {
      if (!row.isFinished && row.matchesFinished === 0) continue;
      finishedGwsCount += 1;
      totalMatches += row.matchesFinished;
      totalOutcomeHits += row.outcomeHits;
      totalExactScoreHits += row.exactScoreHits;
      sumTeamGoalsDiff += row.teamGoalsMae * (row.matchesFinished * 2);
      sumStartersHit += row.totalStartersHit;
      sumStartersProj += row.totalStartersPredicted;
      sumStartersAbsDiff += row.startersXpMae * row.startersCount;
      sumStartersCount += row.startersCount;
      sumActiveAbsDiff += row.activeXpMae * row.activeCount;
      sumActiveCount += row.activeCount;
    }

    const seasonOutcomeAcc = totalMatches > 0 ? Math.round((totalOutcomeHits / totalMatches) * 1000) / 10 : 0;
    const seasonExactScore = totalMatches > 0 ? Math.round((totalExactScoreHits / totalMatches) * 1000) / 10 : 0;
    const seasonGoalMae = totalMatches > 0 ? Math.round((sumTeamGoalsDiff / (totalMatches * 2)) * 100) / 100 : 0;
    const seasonLineupAcc = sumStartersProj > 0 ? Math.round((sumStartersHit / sumStartersProj) * 1000) / 10 : 0;
    const seasonAvgStarters = finishedGwsCount > 0 ? Math.round((sumStartersHit / (finishedGwsCount * 20)) * 10) / 10 : 0;
    const seasonStartersMae = sumStartersCount > 0 ? Math.round((sumStartersAbsDiff / sumStartersCount) * 100) / 100 : 0;
    const seasonActiveMae = sumActiveCount > 0 ? Math.round((sumActiveAbsDiff / sumActiveCount) * 100) / 100 : 0;

    const goalScore = Math.max(0, Math.min(100, Math.round((1 - seasonGoalMae / 2.2) * 100)));
    const ptsScore = Math.max(0, Math.min(100, Math.round((1 - seasonStartersMae / 5.0) * 100)));
    const seasonComposite = Math.round(seasonLineupAcc * 0.35 + seasonOutcomeAcc * 0.30 + goalScore * 0.15 + ptsScore * 0.20);
    const seasonGrade = seasonComposite >= 82 ? 'A+' : seasonComposite >= 75 ? 'A' : seasonComposite >= 68 ? 'B+' : seasonComposite >= 60 ? 'B' : 'C';

    return {
      totalMatches,
      seasonOutcomeAcc,
      seasonExactScore,
      seasonGoalMae,
      seasonLineupAcc,
      seasonAvgStarters,
      seasonStartersMae,
      seasonActiveMae,
      seasonComposite,
      seasonGrade,
      finishedGwsCount
    };
  }, [filteredMaeRows]);

  // Sorted rows by selected table column
  const sortedMaeRows = useMemo(() => {
    const list = [...filteredMaeRows];
    list.sort((a, b) => {
      let vA = 0;
      let vB = 0;
      if (maeSortCol === 'gw') {
        vA = a.gw;
        vB = b.gw;
      } else if (maeSortCol === 'goalMae') {
        vA = a.teamGoalsMae;
        vB = b.teamGoalsMae;
      } else if (maeSortCol === 'outcomeAcc') {
        vA = a.outcomeAccPct;
        vB = b.outcomeAccPct;
      } else if (maeSortCol === 'exactScore') {
        vA = a.exactScorePct;
        vB = b.exactScorePct;
      } else if (maeSortCol === 'lineupAcc') {
        vA = a.lineupAccPct;
        vB = b.lineupAccPct;
      } else if (maeSortCol === 'avgStarters') {
        vA = a.avgStartersPerClub;
        vB = b.avgStartersPerClub;
      } else if (maeSortCol === 'startersMae') {
        vA = a.startersXpMae;
        vB = b.startersXpMae;
      } else if (maeSortCol === 'activeMae') {
        vA = a.activeXpMae;
        vB = b.activeXpMae;
      } else if (maeSortCol === 'composite') {
        vA = a.compositeScore;
        vB = b.compositeScore;
      }
      return maeSortDir === 'asc' ? vA - vB : vB - vA;
    });
    return list;
  }, [filteredMaeRows, maeSortCol, maeSortDir]);

  return (
    <div className="w-full space-y-2.5 pb-6">
      {/* ========================================================================= */}
      {/* 1. SUBTAB: LINE UP REVIEW (GW N ACCORDION PER 20 CLUBS)                  */}
      {/* ========================================================================= */}
      {subTab === 'line-up' && (
        <div className="space-y-1.5">
          {/* Compact Header Bar matching TabProjection */}
          <div className="bg-white dark:bg-[#1a0f2e] px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setLineupReviewGW((prev) => Math.max(1, prev - 1))}
                  disabled={lineupReviewGW <= 1}
                  aria-label="Previous Gameweek"
                  className="p-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <CustomPopoverSelect
                  value={lineupReviewGW}
                  onChange={(val) => setLineupReviewGW(Number(val))}
                  options={startGwOptions}
                  className="bg-white dark:bg-[#1b0d2d] border border-slate-300 dark:border-purple-800/60 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-extrabold text-[#37003c] dark:text-[#00ff87] py-1 px-2 shadow-2xs flex items-center justify-between gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#37003c] dark:focus:ring-[#00ff87] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setLineupReviewGW((prev) => Math.min(maxReviewGW, prev + 1))}
                  disabled={lineupReviewGW >= maxReviewGW}
                  aria-label="Next Gameweek"
                  className="p-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {lineupGwSummary.playedClubs > 0 && (
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate tabular-nums">
                  {isIdLang
                    ? `Rata-rata ${lineupGwSummary.avgHit}/11 · ${lineupGwSummary.pct}%`
                    : `Avg ${lineupGwSummary.avgHit}/11 · ${lineupGwSummary.pct}%`}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setExpandedClubs(new Set(clubs.map((c) => c.short)))}
                className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-black dark:hover:text-white cursor-pointer px-1.5 sm:px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 whitespace-nowrap"
              >
                {isIdLang ? 'Buka' : 'Expand'}
              </button>
              <button
                type="button"
                onClick={() => setExpandedClubs(new Set())}
                className="text-[10px] sm:text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-black dark:hover:text-white cursor-pointer px-1.5 sm:px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 whitespace-nowrap"
              >
                {isIdLang ? 'Tutup' : 'Collapse'}
              </button>
            </div>
          </div>

          {isLoadingReview && !reviewBundle && (
            <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 p-6 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-[#37003c] dark:border-[#00ff87] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* 20 Club Accordions */}
          <div className="space-y-1.5">
            {clubs.map((club) => {
              const isExpanded = expandedClubs.has(club.short);
              const squad = lineupReviewPerClub[club.short] || [];
              const actualList = actualMatchLookup[`${lineupReviewGW}_${club.short}`] || [];
              const isMatchPlayed = actualList.some((m) => m.finished || m.teamScore !== null);

              const starterCount = squad.filter((p) => p.role === 'starting').length;
              const starterAccurate = squad.filter((p) => p.role === 'starting' && p.realStarted).length;
              const lineupAccPct = starterCount > 0 ? Math.round((starterAccurate / 11) * 100) : 0;

              const projForm = squad.find((p) => p.projectedFormation)?.projectedFormation || '-';
              const realForm = squad.find((p) => p.actualFormation)?.actualFormation || null;

              const sortedSquad = [...squad].sort((a, b) => {
                if (lineupSortCol === 'num') {
                  return lineupSortDir === 'asc' ? a.shirtNum - b.shirtNum : b.shirtNum - a.shirtNum;
                }
                if (lineupSortCol === 'player') {
                  return lineupSortDir === 'asc' ? a.webName.localeCompare(b.webName) : b.webName.localeCompare(a.webName);
                }
                if (lineupSortCol === 'pos') {
                  const diff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
                  if (diff !== 0) return lineupSortDir === 'asc' ? diff : -diff;
                  return b.si - a.si;
                }
                if (lineupSortCol === 'proj') {
                  const rDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
                  if (rDiff !== 0) return lineupSortDir === 'asc' ? rDiff : -rDiff;
                  return b.si - a.si;
                }
                if (lineupSortCol === 'real') {
                  const rankReal = (p: any) => (p.realStarted ? 1 : p.realSub ? 2 : p.realUnusedSub ? 3 : 4);
                  const diff = rankReal(a) - rankReal(b);
                  if (diff !== 0) return lineupSortDir === 'asc' ? diff : -diff;
                  return b.realMins - a.realMins;
                }
                if (lineupSortCol === 'match') {
                  const mDiff = (a.isAccuracyMatch ? 1 : 0) - (b.isAccuracyMatch ? 1 : 0);
                  if (mDiff !== 0) return lineupSortDir === 'asc' ? mDiff : -mDiff;
                  return b.si - a.si;
                }
                if (lineupSortCol === 'pts') {
                  return lineupSortDir === 'asc' ? a.realPts - b.realPts : b.realPts - a.realPts;
                }
                const rDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
                if (rDiff !== 0) return lineupSortDir === 'asc' ? rDiff : -rDiff;
                const pDiff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
                if (pDiff !== 0) return pDiff;
                return b.si - a.si;
              });

              const handleLineupSort = (col: string, defaultDir: 'asc' | 'desc' = 'asc') => {
                if (lineupSortCol === col) {
                  setLineupSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                } else {
                  setLineupSortCol(col);
                  setLineupSortDir(defaultDir);
                }
              };

              const getMatchChipClass = (res: 'W' | 'D' | 'L' | null) => {
                if (res === 'W') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25';
                if (res === 'D') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25';
                if (res === 'L') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25';
                return 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-white/10';
              };

              const accTextColor =
                starterAccurate >= 9
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : starterAccurate >= 7
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400';

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
                        title={realForm && realForm !== projForm ? `Proj ${projForm} vs Real ${realForm}` : `Formation ${projForm}`}
                        className="hidden sm:inline-flex items-center justify-center font-mono font-bold text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 shrink-0 tabular-nums"
                      >
                        {projForm}{realForm && realForm !== projForm ? ` → ${realForm}` : ''}
                      </span>

                      {actualList.length === 0 ? (
                        <span className="inline-flex items-center justify-center text-center min-w-[60px] text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-400 border border-slate-200/60 dark:border-white/10 shrink-0 whitespace-nowrap">
                          BGW
                        </span>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          {actualList.map((actualMatch, mIdx) => {
                            const mDone = Boolean(actualMatch.finished || actualMatch.teamScore !== null);
                            return (
                              <span
                                key={`${actualMatch.oppShort}-${mIdx}`}
                                className={`inline-flex items-center justify-center text-center min-w-[74px] sm:min-w-[94px] text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap tabular-nums ${getMatchChipClass(actualMatch.result)}`}
                              >
                                {actualMatch.oppShort} ({actualMatch.isHome ? 'H' : 'A'})
                                {mDone && actualMatch.teamScore !== null && actualMatch.oppScore !== null
                                  ? ` · ${actualMatch.teamScore}-${actualMatch.oppScore}`
                                  : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {isMatchPlayed ? (
                        <span className={`font-black text-[11px] tabular-nums shrink-0 whitespace-nowrap w-[68px] text-right ${accTextColor}`}>
                          {starterAccurate}/11 ({lineupAccPct}%)
                        </span>
                      ) : actualList.length === 0 ? (
                        <span className="font-semibold text-[11px] text-slate-400 shrink-0 whitespace-nowrap w-[68px] text-right">
                          Blank
                        </span>
                      ) : (
                        <span className="font-semibold text-[11px] text-slate-400 shrink-0 whitespace-nowrap w-[68px] text-right">
                          {isIdLang ? 'Belum' : 'Pending'}
                        </span>
                      )}

                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                    </div>
                  </div>

                  {/* Expanded Squad Comparison Table */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 dark:border-white/10 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/90 dark:bg-white/5 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-white/10 text-[11px] whitespace-nowrap select-none">
                            <th
                              onClick={() => handleLineupSort('num', 'asc')}
                              className="py-1 px-2 w-8 text-center cursor-pointer hover:text-black dark:hover:text-white"
                            >
                              #
                            </th>
                            <th
                              onClick={() => handleLineupSort('player', 'asc')}
                              className="py-1 px-2 min-w-[130px] cursor-pointer hover:text-black dark:hover:text-white"
                            >
                              {isIdLang ? 'Pemain' : 'Player'}
                            </th>
                            <th
                              onClick={() => handleLineupSort('pos', 'asc')}
                              className="py-1 px-1.5 w-11 text-center cursor-pointer hover:text-black dark:hover:text-white"
                            >
                              Pos
                            </th>
                            <th
                              onClick={() => handleLineupSort('proj', 'asc')}
                              className="py-1 px-2 w-32 min-w-[122px] text-[#37003c] dark:text-[#00ff87] font-black border-r border-slate-200 dark:border-white/10 cursor-pointer"
                            >
                              {isIdLang ? 'Proyeksi' : 'Projected'}
                            </th>
                            <th
                              onClick={() => handleLineupSort('real', 'asc')}
                              className="py-1 px-2 w-28 min-w-[108px] text-slate-800 dark:text-slate-200 font-black border-r border-slate-200 dark:border-white/10 cursor-pointer"
                            >
                              {isIdLang ? 'Aktual' : 'Actual'}
                            </th>
                            <th
                              onClick={() => handleLineupSort('match', 'desc')}
                              className="py-1 px-1.5 w-14 text-center cursor-pointer hover:text-black dark:hover:text-white"
                            >
                              {isIdLang ? 'Tepat' : 'Match'}
                            </th>
                            <th
                              onClick={() => handleLineupSort('pts', 'desc')}
                              className="py-1 px-2 w-14 text-right cursor-pointer hover:text-black dark:hover:text-white"
                            >
                              Pts
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {sortedSquad.map((player) => {
                            const isStarting = player.role === 'starting';
                            const isOwned = ownedPlayerIds.has(player.id);

                            return (
                              <tr
                                key={player.id}
                                onClick={() => onSelectPlayer?.(player.id, lineupReviewGW)}
                                className={`transition-colors cursor-pointer whitespace-nowrap leading-none ${
                                  isOwned
                                    ? `${USER_ROW_BG} ${USER_ROW_HOVER_BG}`
                                    : isStarting
                                    ? 'bg-emerald-50/25 dark:bg-emerald-950/10 hover:bg-emerald-50/50'
                                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                                }`}
                              >
                                <td className="py-1 px-2 w-8 text-center font-bold text-slate-400 tabular-nums">
                                  {player.shirtNum > 0 ? player.shirtNum : '-'}
                                </td>
                                <td className="py-1 px-2 min-w-[130px] font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                  {player.webName}
                                </td>
                                <td className="py-1 px-1.5 w-11 text-center">
                                  <span
                                    className={`w-8 inline-block text-center px-1 py-0.5 rounded-full text-[10px] font-black leading-none ${
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

                                {/* Projected Role & SI% */}
                                <td className="py-1 px-2 w-32 border-r border-slate-200 dark:border-white/10 whitespace-nowrap">
                                  <div className="flex items-center justify-between gap-1.5">
                                    {player.role === 'starting' ? (
                                      <span className="w-13 text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                                        Start
                                      </span>
                                    ) : player.role === 'bench' ? (
                                      <span className="w-13 text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                                        Bench
                                      </span>
                                    ) : (
                                      <span className="w-13 text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                        Out
                                      </span>
                                    )}
                                    <span className="font-black text-xs text-[#37003c] dark:text-[#00ff87] tabular-nums">
                                      {player.si}%
                                    </span>
                                  </div>
                                </td>

                                {/* Actual Status (Minutes only, no duplicate points) */}
                                <td className="py-1 px-2 w-28 border-r border-slate-200 dark:border-white/10 whitespace-nowrap">
                                  {!player.isMatchPlayed ? (
                                    <span className="text-[11px] font-medium text-slate-400">
                                      {isIdLang ? 'Belum' : 'Pending'}
                                    </span>
                                  ) : player.realStarted ? (
                                    <span className="w-[74px] text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white tabular-nums">
                                      Start ({player.realMins}&apos;)
                                    </span>
                                  ) : player.realSub ? (
                                    <span className="w-[74px] text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white tabular-nums">
                                      Sub ({player.realMins}&apos;)
                                    </span>
                                  ) : player.realUnusedSub ? (
                                    <span className="w-[74px] text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 tabular-nums">
                                      Bench (0&apos;)
                                    </span>
                                  ) : (
                                    <span className="w-[74px] text-center inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-50 dark:bg-white/5 text-slate-400">
                                      Out
                                    </span>
                                  )}
                                </td>

                                {/* Accuracy Check (Unboxed) */}
                                <td className="py-1 px-1.5 w-14 text-center whitespace-nowrap">
                                  {!player.isMatchPlayed ? (
                                    <span className="text-slate-400">-</span>
                                  ) : player.isAccuracyMatch ? (
                                    <span className="font-black text-xs text-emerald-600 dark:text-emerald-400">✓</span>
                                  ) : (
                                    <span className="font-black text-xs text-rose-500 dark:text-rose-400">✗</span>
                                  )}
                                </td>

                                {/* Actual GW Points */}
                                <td className="py-1 px-2 w-14 text-right font-black text-xs tabular-nums text-slate-900 dark:text-white">
                                  {player.isMatchPlayed ? player.realPts : '-'}
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
      {/* 2. SUBTAB: SCORE REVIEW (Scoreboard vs Club Matrix — TabProjection Style) */}
      {/* ========================================================================= */}
      {subTab === 'score' && (
        <div className="space-y-2">
          {/* Controls Bar: Horizon Slider + Mode Switcher, Quick Presets & Total GW */}
          <div className="bg-white dark:bg-[#1a0f2e] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
            {renderGwHorizonControl({ fullWidthEndAligned: true })}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-white/5 pt-2">
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

              {/* Quick Presets (Desktop) + Jumlah GW Horizon */}
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <div className="hidden md:flex items-center gap-1 shrink-0">
                  {[
                    { label: '1 GW', start: maxReviewGW, end: maxReviewGW },
                    { label: '3 GW', start: Math.max(1, maxReviewGW - 2), end: maxReviewGW },
                    { label: '5 GW', start: Math.max(1, maxReviewGW - 4), end: maxReviewGW },
                    { label: isIdLang ? 'Semua' : 'All', start: 1, end: maxReviewGW }
                  ].map((preset) => {
                    const isActive = gwStart === preset.start && gwEnd === preset.end;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setGwStart(preset.start);
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

          {/* MODE 1: MATCH SCOREBOARD (Symmetric Proj vs Real Card matching TabProjection) */}
          {scoreViewMode === 'scoreboard' && (() => {
            const renderScoreboardCard = (m: any, gw: number, cardKey: string) => {
              const hShort = m.home_team?.short_name || 'HOM';
              const aShort = m.away_team?.short_name || 'AWY';
              const proj = projectFixture(hShort, aShort, gw);
              const actualHList = actualMatchLookup[`${gw}_${hShort}`] || [];
              const actualH = actualHList.find((e) => e.isHome && e.oppShort === aShort) || actualHList[0];
              const isDone = Boolean(actualH && actualH.finished && actualH.teamScore !== null && actualH.oppScore !== null);
              const realH = actualH?.teamScore ?? null;
              const realA = actualH?.oppScore ?? null;

              const isExact = isDone && proj.homeGoals === realH && proj.awayGoals === realA;
              const projRes = proj.homeGoals > proj.awayGoals ? 'H' : proj.homeGoals < proj.awayGoals ? 'A' : 'D';
              const realRes = (realH || 0) > (realA || 0) ? 'H' : (realH || 0) < (realA || 0) ? 'A' : 'D';
              const isResultMatch = isDone && projRes === realRes;

              const cardTone = isExact
                ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-500/35'
                : isResultMatch
                ? 'bg-sky-50/60 dark:bg-sky-950/15 border-sky-500/25'
                : isDone
                ? 'bg-rose-50/35 dark:bg-rose-950/10 border-slate-200/90 dark:border-white/10'
                : 'bg-slate-50/90 dark:bg-white/[0.035] border-slate-200/80 dark:border-white/10';

              const scorePillClass = isExact
                ? 'bg-emerald-600 text-white'
                : isResultMatch
                ? 'bg-[#37003c] dark:bg-[#00ff87] text-white dark:text-[#37003c]'
                : isDone
                ? 'bg-slate-800 dark:bg-white/15 text-white'
                : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300';

              return (
                <div
                  key={cardKey}
                  title={`${hShort} vs ${aShort} | Proj ${proj.homeGoals}-${proj.awayGoals} (xG ${proj.lambdaH.toFixed(2)}-${proj.lambdaA.toFixed(2)}) | Real ${isDone ? `${realH}-${realA}` : 'Upcoming'}`}
                  className={`transition-colors px-1.5 py-1.5 @[355px]:px-2 sm:px-2.5 sm:py-2 rounded-lg border ${cardTone}`}
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-1 @[355px]:gap-x-1.5 sm:gap-x-2 gap-y-1">
                    {/* Row 1: xG & Projected Score */}
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-400 text-right leading-none">
                      {proj.lambdaH.toFixed(2)}
                    </span>
                    <span className="text-[10px] font-bold text-[#37003c] dark:text-[#00ff87] text-center leading-none tabular-nums whitespace-nowrap">
                      P {proj.homeGoals}-{proj.awayGoals}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-slate-400 text-left leading-none">
                      {proj.lambdaA.toFixed(2)}
                    </span>

                    {/* Row 2: Club Badges & Actual Score */}
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

                    <span className={`min-w-[40px] @[355px]:min-w-[44px] sm:min-w-[48px] text-center px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] @[355px]:text-xs font-black tabular-nums leading-tight shadow-2xs whitespace-nowrap ${scorePillClass}`}>
                      {isDone ? `${realH} - ${realA}` : 'vs'}
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

                    {/* Row 3: CS% & Clean Unboxed Eval */}
                    <span className="text-[10px] font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 text-right leading-none">
                      {proj.homeCsProb}%
                    </span>
                    <span
                      className={`text-[9.5px] font-black text-center leading-none whitespace-nowrap ${
                        isExact
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isResultMatch
                          ? 'text-sky-600 dark:text-sky-400'
                          : isDone
                          ? 'text-rose-500 dark:text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {isExact ? 'Exact ✓' : isResultMatch ? 'WDL ✓' : isDone ? (isIdLang ? 'Meleset' : 'Miss') : '-'}
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
            const maxMatchesInHorizon = Math.max(10, ...horizonGWs.map((gw) => (scheduleByGw[gw] || []).length));

            return (
              <div className="@container bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  {horizonGWs.length === 1 ? (
                    <div className="p-3">
                      {horizonGWs.map((gw) => {
                        const matches = scheduleByGw[gw] || [];
                        let wdlHits = 0;
                        let exactHits = 0;
                        let doneCount = 0;
                        for (const m of matches) {
                          const hShort = m.home_team?.short_name || '';
                          const aShort = m.away_team?.short_name || '';
                          if (!hShort || !aShort) continue;
                          const proj = projectFixture(hShort, aShort, gw);
                          const actualHList = actualMatchLookup[`${gw}_${hShort}`] || [];
                          const actualH = actualHList.find((e) => e.isHome && e.oppShort === aShort) || actualHList[0];
                          if (actualH && actualH.finished && actualH.teamScore !== null && actualH.oppScore !== null) {
                            doneCount += 1;
                            if (proj.homeGoals === actualH.teamScore && proj.awayGoals === actualH.oppScore) exactHits += 1;
                            const pR = proj.homeGoals > proj.awayGoals ? 'H' : proj.homeGoals < proj.awayGoals ? 'A' : 'D';
                            const rR = actualH.teamScore > actualH.oppScore ? 'H' : actualH.teamScore < actualH.oppScore ? 'A' : 'D';
                            if (pR === rR) wdlHits += 1;
                          }
                        }

                        return (
                          <div key={gw} className="space-y-2">
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100/90 dark:bg-white/5 border border-slate-200/80 dark:border-white/10">
                              <span className="text-xs font-black text-[#37003c] dark:text-[#00ff87] tabular-nums">
                                GW {gw}
                              </span>
                              {doneCount > 0 && (
                                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                                  WDL {wdlHits}/{doneCount} · Exact {exactHits}/{doneCount}
                                </span>
                              )}
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
                        {Array.from({ length: maxMatchesInHorizon }).map((_, matchIdx) => (
                          <tr key={matchIdx} className="whitespace-nowrap">
                            {horizonGWs.map((gw) => {
                              const matches = scheduleByGw[gw] || [];
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

          {/* MODE 2: CLUB FIXTURE MATRIX (Rows: 20 Clubs, Columns: GWs — Clean Proj vs Real) */}
          {scoreViewMode === 'matrix' && (
            <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/90 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-extrabold text-[11px] whitespace-nowrap select-none">
                    <th
                      className="py-2 px-[8.5px] sticky left-0 z-20 bg-slate-100 dark:bg-[#20133b] border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-[#2a1a4a] transition-colors min-w-[126px] whitespace-nowrap"
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
                          className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 w-[114px] min-w-[110px] whitespace-nowrap font-black cursor-pointer transition-colors tabular-nums ${
                            isSorted
                              ? 'bg-[#37003c]/[0.08] dark:bg-[#00ff87]/[0.1] text-[#37003c] dark:text-[#00ff87]'
                              : 'text-[#37003c] dark:text-[#00ff87] hover:bg-slate-200/60 dark:hover:bg-white/10'
                          }`}
                        >
                          <div className="inline-flex items-center justify-center gap-0.5">
                            <span>GW {gw}</span>
                            {isSorted &&
                              (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                          </div>
                        </th>
                      );
                    })}
                    <th
                      className="py-2 px-2 text-center border-l border-r border-slate-200 dark:border-white/10 cursor-pointer font-black text-[#37003c] dark:text-[#00ff87] bg-[#37003c]/[0.04] dark:bg-[#00ff87]/[0.05] w-16 min-w-[60px] whitespace-nowrap"
                      onClick={() => handleMatrixSort('pts')}
                      title={isIdLang ? 'Poin Aktual (atas) vs Proyeksi (bawah)' : 'Actual Pts (top) vs Projected (bottom)'}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>Pts</span>
                        {matrixSortCol === 'pts' && (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 min-w-[54px] whitespace-nowrap"
                      onClick={() => handleMatrixSort('gf')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>GF</span>
                        {matrixSortCol === 'gf' && (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 min-w-[54px] whitespace-nowrap"
                      onClick={() => handleMatrixSort('ga')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>GA</span>
                        {matrixSortCol === 'ga' && (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 min-w-[54px] whitespace-nowrap"
                      onClick={() => handleMatrixSort('cs')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>CS</span>
                        {matrixSortCol === 'cs' && (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-center cursor-pointer hover:text-black dark:hover:text-white w-16 min-w-[64px] whitespace-nowrap"
                      onClick={() => handleMatrixSort('acc')}
                    >
                      <div className="inline-flex items-center justify-center gap-0.5">
                        <span>WDL%</span>
                        {matrixSortCol === 'acc' && (matrixSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
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

                      {/* GW Cells - Row 1: Opponent (H/A); Row 2: Proj → Real (supports Blank & DGW) */}
                      {horizonGWs.map((gw) => {
                        const cell = row.cells[gw];
                        if (!cell || cell.isBlank || cell.matches.length === 0) {
                          return (
                            <td
                              key={gw}
                              className="py-1.5 px-2 text-center border-r border-slate-200 dark:border-white/10 w-[114px] min-w-[110px] whitespace-nowrap bg-slate-50/40 dark:bg-white/[0.015]"
                            >
                              <span className="inline-block px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                Blank
                              </span>
                            </td>
                          );
                        }

                        const toneClass = cell.isExactScore
                          ? 'bg-emerald-500/[0.14] dark:bg-emerald-500/[0.18]'
                          : cell.isResultMatch
                          ? 'bg-sky-500/[0.10] dark:bg-sky-500/[0.14]'
                          : cell.hasReal
                          ? 'bg-rose-500/[0.08] dark:bg-rose-500/[0.10]'
                          : 'bg-slate-50/50 dark:bg-white/[0.02]';

                        return (
                          <td
                            key={gw}
                            title={`${row.club.short} vs ${cell.oppShort} • Proj ${cell.projScore} • Real ${cell.realScore}`}
                            className={`py-1.5 px-2 border-r border-slate-200 dark:border-white/10 w-[114px] min-w-[110px] whitespace-nowrap ${toneClass}`}
                          >
                            {cell.matches.length === 1 ? (
                              <div className="flex flex-col gap-1 leading-none">
                                <div className="text-center">
                                  <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100">
                                    {cell.matches[0].oppShort}{' '}
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                                      ({cell.matches[0].isHome ? 'H' : 'A'})
                                    </span>
                                  </span>
                                </div>
                                <div className="flex items-center justify-center gap-1 tabular-nums text-[11px]">
                                  <span className="font-semibold text-[#37003c] dark:text-[#00ff87]">
                                    P {cell.matches[0].projScore}
                                  </span>
                                  <span className="text-slate-400">→</span>
                                  <span className="font-black text-slate-900 dark:text-white">
                                    {cell.matches[0].realScore}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1 leading-none">
                                {cell.matches.map((me, mIdx) => (
                                  <div
                                    key={`${me.oppShort}-${mIdx}`}
                                    className="flex items-center justify-between gap-1 text-[10px] tabular-nums"
                                  >
                                    <span className="font-extrabold text-slate-800 dark:text-slate-100">
                                      {me.oppShort}({me.isHome ? 'H' : 'A'})
                                    </span>
                                    <span>
                                      <span className="font-semibold text-[#37003c] dark:text-[#00ff87]">
                                        P{me.projScore}
                                      </span>
                                      <span className="text-slate-400 mx-0.5">→</span>
                                      <span className="font-black text-slate-900 dark:text-white">
                                        {me.realScore}
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Summary Columns: Real Bold Top, Proj Muted Below */}
                      <td className="py-1 px-2 text-center bg-[#37003c]/[0.03] dark:bg-[#00ff87]/[0.04] border-l border-r border-slate-200 dark:border-white/10 tabular-nums w-16 min-w-[60px] whitespace-nowrap leading-tight">
                        <div className="text-xs font-black text-[#37003c] dark:text-[#00ff87]">{row.realTotalPts}</div>
                        <div className="text-[10px] font-semibold text-slate-400">P {row.projTotalPts}</div>
                      </td>
                      <td className="py-1 px-2 text-center tabular-nums border-r border-slate-200 dark:border-white/10 whitespace-nowrap w-14 min-w-[54px] leading-tight">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{row.realTotalGf}</div>
                        <div className="text-[10px] font-semibold text-slate-400">P {row.projTotalGf}</div>
                      </td>
                      <td className="py-1 px-2 text-center tabular-nums border-r border-slate-200 dark:border-white/10 whitespace-nowrap w-14 min-w-[54px] leading-tight">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{row.realTotalGa}</div>
                        <div className="text-[10px] font-semibold text-slate-400">P {row.projTotalGa}</div>
                      </td>
                      <td className="py-1 px-2 text-center tabular-nums border-r border-slate-200 dark:border-white/10 whitespace-nowrap w-14 min-w-[54px] leading-tight">
                        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{row.realTotalCs}</div>
                        <div className="text-[10px] font-semibold text-slate-400">P {row.projTotalCs}</div>
                      </td>
                      <td className="py-1 px-2 text-center tabular-nums whitespace-nowrap w-16 min-w-[64px] leading-tight">
                        <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">{row.accPct}%</div>
                        <div className="text-[10px] font-semibold text-slate-400">
                          {row.correctResults}/{row.finishedMatches || row.totalMatches}
                        </div>
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
      {/* 3. SUBTAB: PLAYER POINTS REVIEW (xP vs Real — TabProjection Style)        */}
      {/* ========================================================================= */}
      {subTab === 'points' && (
        <div className="space-y-2">
          {/* Controls Bar matching TabProjection */}
          <div className="bg-white dark:bg-[#1a0f2e] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 space-y-2">
            {renderGwHorizonControl({ fullWidthEndAligned: true })}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-white/5 pt-2 whitespace-nowrap">
              {/* Position Dropdown */}
              <div className="flex items-center gap-1.5 order-1 shrink-0">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Pos:</span>
                <CustomPopoverSelect
                  value={posFilter}
                  onChange={(val) => setPosFilter(val as 'ALL' | PositionType)}
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

              {/* My Team Toggle */}
              {ownedPlayerIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setMyTeamOnly((prev) => !prev)}
                  className={`order-2 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer shrink-0 ${
                    myTeamOnly
                      ? 'bg-emerald-600 text-white border-emerald-600 dark:bg-[#00ff87] dark:text-[#37003c] dark:border-[#00ff87]'
                      : 'bg-white dark:bg-[#1b0d2d] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-purple-800/60 hover:border-emerald-500'
                  }`}
                >
                  {isIdLang ? 'Tim Saya' : 'My Team'}
                </button>
              )}

              {/* Jumlah GW Horizon */}
              <span className="order-3 md:order-6 ml-auto md:ml-0 px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0">
                {horizonGWs.length} GW
              </span>

              {/* Search Bar */}
              <div className="relative order-4 md:order-3 flex-1 min-w-[160px] md:flex-initial md:w-44 lg:w-52">
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
              <div className="hidden xl:flex items-center gap-1 order-5 md:order-4 xl:ml-auto shrink-0">
                {[
                  { label: '1 GW', start: maxReviewGW, end: maxReviewGW },
                  { label: '3 GW', start: Math.max(1, maxReviewGW - 2), end: maxReviewGW },
                  { label: '5 GW', start: Math.max(1, maxReviewGW - 4), end: maxReviewGW },
                  { label: isIdLang ? 'Semua' : 'All', start: 1, end: maxReviewGW }
                ].map((preset) => {
                  const isActive = gwStart === preset.start && gwEnd === preset.end;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setGwStart(preset.start);
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
              <div className="order-6 md:order-5 md:ml-auto xl:ml-0 text-xs font-bold text-slate-400 shrink-0 tabular-nums">
                {filteredPointsReviewRows.length} {isIdLang ? 'pemain' : 'players'}
              </div>
            </div>
          </div>

          {/* Player Points Comparison Table */}
          <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 font-extrabold text-[11px] whitespace-nowrap select-none">
                  <th
                    className="py-1.5 px-1.5 sm:px-2 sticky left-0 z-20 bg-slate-100 dark:bg-[#20133b] border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[114px] min-w-[114px] sm:w-36 sm:min-w-[130px] whitespace-nowrap"
                    onClick={() => handlePointsSort('player')}
                  >
                    Player
                  </th>
                  <th
                    className="py-1.5 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-11 min-w-[44px] sm:w-14 sm:min-w-[56px] whitespace-nowrap"
                    onClick={() => handlePointsSort('club')}
                  >
                    Club
                  </th>
                  <th
                    className="py-1.5 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[42px] min-w-[42px] sm:w-12 sm:min-w-[48px] whitespace-nowrap"
                    onClick={() => handlePointsSort('pos')}
                  >
                    Pos
                  </th>
                  <th
                    className="py-1.5 px-1 sm:px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-[56px] min-w-[56px] sm:w-16 sm:min-w-[64px] whitespace-nowrap"
                    onClick={() => handlePointsSort('cost')}
                  >
                    Price
                  </th>

                  {/* Sortable GW Columns */}
                  {horizonGWs.map((gw) => {
                    const colKey = `gw_${gw}`;
                    const isSorted = pointsSortCol === colKey;
                    return (
                      <th
                        key={gw}
                        onClick={() => handlePointsSort(colKey)}
                        className={`py-1.5 px-1.5 text-center border-r border-slate-200 dark:border-white/10 w-[86px] min-w-[84px] sm:w-[96px] sm:min-w-[92px] whitespace-nowrap cursor-pointer transition-colors tabular-nums ${
                          isSorted
                            ? 'bg-[#37003c]/[0.08] dark:bg-[#00ff87]/[0.1] text-[#37003c] dark:text-[#00ff87]'
                            : 'hover:text-black dark:hover:text-white'
                        }`}
                      >
                        <div className="inline-flex items-center justify-center gap-0.5">
                          <span>GW {gw}</span>
                          {isSorted &&
                            (pointsSortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                    );
                  })}

                  {/* Summary Columns: Proj, Real, Diff, Avg, MAE */}
                  <th
                    className="py-1.5 px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 whitespace-nowrap"
                    onClick={() => handlePointsSort('totalProj')}
                  >
                    Proj
                  </th>
                  <th
                    className="py-1.5 px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer font-black text-[#37003c] dark:text-[#00ff87] bg-[#37003c]/[0.04] dark:bg-[#00ff87]/[0.05] w-14 whitespace-nowrap"
                    onClick={() => handlePointsSort('totalReal')}
                  >
                    Real
                  </th>
                  <th
                    className="py-1.5 px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-14 whitespace-nowrap"
                    onClick={() => handlePointsSort('diff')}
                  >
                    Diff
                  </th>
                  <th
                    className="py-1.5 px-2 text-right border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-16 whitespace-nowrap"
                    onClick={() => handlePointsSort('avgReal')}
                  >
                    Avg
                  </th>
                  <th
                    className="py-1.5 px-2 text-right cursor-pointer hover:text-black dark:hover:text-white w-14 whitespace-nowrap"
                    onClick={() => handlePointsSort('mae')}
                    title="Mean Absolute Error"
                  >
                    MAE
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {displayedPointsReviewRows.map((player) => {
                  const isOwned = ownedPlayerIds.has(player.id);
                  return (
                  <tr
                    key={player.id}
                    onClick={() => onSelectPlayer?.(player.id, maxReviewGW)}
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
                    <td className="py-1 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold w-11 min-w-[44px] sm:w-14 sm:min-w-[56px] whitespace-nowrap">
                      {player.teamShort}
                    </td>
                    <td className="py-1 px-1 sm:px-1.5 text-center border-r border-slate-200 dark:border-white/10 w-[42px] min-w-[42px] sm:w-12 sm:min-w-[48px] whitespace-nowrap">
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
                    <td className="py-1 px-1 sm:px-2 text-right border-r border-slate-200 dark:border-white/10 tabular-nums font-semibold text-slate-700 dark:text-slate-300 w-[56px] min-w-[56px] sm:w-16 sm:min-w-[64px] whitespace-nowrap">
                      £{player.nowCost.toFixed(1)}m
                    </td>

                    {/* Clean 2-Line GW Cells: Row 1 = opp + diff, Row 2 = xP + realPts */}
                    {horizonGWs.map((gw) => {
                      const item = player.gwMap[gw];
                      if (!item || item.isBlank) {
                        return (
                          <td
                            key={gw}
                            className="py-1 px-1.5 text-center text-slate-400 border-r border-slate-200 dark:border-white/10 w-[86px] min-w-[84px] sm:w-[96px] sm:min-w-[92px] whitespace-nowrap bg-slate-50/40 dark:bg-white/[0.015]"
                          >
                            <div className="flex flex-col gap-0.5 leading-none tabular-nums">
                              <span className="text-[10px] font-semibold text-slate-400">Blank</span>
                              <span className="text-xs font-bold text-slate-400">0.0</span>
                            </div>
                          </td>
                        );
                      }

                      const isPositiveDiff = item.diff >= 0;

                      return (
                        <td
                          key={gw}
                          title={`Proj: ${item.xp} (Base ${item.baseXp} / Spike ${item.spikeMod}) | Real: ${item.hasReal ? `${item.realPts} pts (${item.realMins}')` : 'Pending'}`}
                          className="py-1 px-1.5 border-r border-slate-200 dark:border-white/10 w-[86px] min-w-[84px] sm:w-[96px] sm:min-w-[92px] whitespace-nowrap"
                        >
                          <div className="flex flex-col gap-0.5 leading-none tabular-nums">
                            <div className="flex items-center justify-between gap-1 text-[10px]">
                              <span className={`font-medium truncate ${item.isDgw ? 'text-purple-600 dark:text-[#00ff87] font-bold' : 'text-slate-400'}`}>
                                {item.opp}
                              </span>
                              {item.hasReal ? (
                                <span
                                  className={`font-bold shrink-0 ${
                                    isPositiveDiff ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
                                  }`}
                                >
                                  {item.diff > 0 ? `+${item.diff}` : item.diff}
                                </span>
                              ) : (
                                <span className="text-slate-400 shrink-0">-</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-1 text-xs">
                              <span className="font-bold text-[#37003c] dark:text-[#00ff87]">
                                {item.xp.toFixed(1)}
                              </span>
                              <span className="font-black text-slate-900 dark:text-white">
                                {item.hasReal ? item.realPts : '-'}
                              </span>
                            </div>
                          </div>
                        </td>
                      );
                    })}

                    {/* Summary Columns */}
                    <td className="py-1 px-2 text-right font-bold text-xs text-slate-600 dark:text-slate-300 border-r border-slate-200 dark:border-white/10 tabular-nums w-14 whitespace-nowrap">
                      {player.totalProj.toFixed(1)}
                    </td>
                    <td className="py-1 px-2 text-right font-black text-xs text-[#37003c] dark:text-[#00ff87] bg-[#37003c]/[0.03] dark:bg-[#00ff87]/[0.04] border-r border-slate-200 dark:border-white/10 tabular-nums w-14 whitespace-nowrap">
                      {player.totalReal}
                    </td>
                    <td
                      className={`py-1 px-2 text-right font-extrabold text-xs border-r border-slate-200 dark:border-white/10 tabular-nums w-14 whitespace-nowrap ${
                        player.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {player.diff > 0 ? `+${player.diff}` : player.diff}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums border-r border-slate-200 dark:border-white/10 whitespace-nowrap w-16 leading-tight">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{player.avgReal}</div>
                      <div className="text-[10px] font-semibold text-slate-400">P {player.avgProj}</div>
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap text-xs w-14">
                      ±{player.mae}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Progressive Load Bar */}
          {filteredPointsReviewRows.length > visibleCount && (
            <div className="py-2.5 px-4 bg-white dark:bg-[#1a0f2e] border border-t-0 border-slate-200 dark:border-white/10 rounded-b-xl flex items-center justify-between gap-3 text-xs flex-wrap">
              <span className="text-slate-500 dark:text-slate-400 font-semibold tabular-nums">
                {isIdLang
                  ? `Menampilkan ${visibleCount} dari ${filteredPointsReviewRows.length} pemain`
                  : `Showing ${visibleCount} of ${filteredPointsReviewRows.length} players`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 50, filteredPointsReviewRows.length))}
                  className="px-3 py-1 rounded-lg font-bold bg-[#37003c]/10 text-[#37003c] dark:bg-[#00ff87]/15 dark:text-[#00ff87] hover:bg-[#37003c]/20 dark:hover:bg-[#00ff87]/25 cursor-pointer transition-colors"
                >
                  {isIdLang ? '+ Muat 50 Lagi' : '+ Load 50 More'}
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredPointsReviewRows.length)}
                  className="px-3 py-1 rounded-lg font-bold bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/15 cursor-pointer transition-colors"
                >
                  {isIdLang ? `Muat Semua (${filteredPointsReviewRows.length})` : `Load All (${filteredPointsReviewRows.length})`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. SUBTAB: MAE (ACCURACY & MEAN ABSOLUTE ERROR RECAP)                     */}
      {/* ========================================================================= */}
      {subTab === 'mae' && (
        <div className="space-y-2">
          {/* Controls Bar matching TabProjection */}
          <div className="bg-white dark:bg-[#1a0f2e] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
            {/* Focus Mode Segmented Control */}
            <div className="flex items-center bg-slate-100 dark:bg-white/5 p-0.5 rounded-lg border border-slate-200 dark:border-white/10 whitespace-nowrap overflow-x-auto no-scrollbar">
              {[
                { id: 'all' as const, label: isIdLang ? 'Semua' : 'All' },
                { id: 'score' as const, label: isIdLang ? 'Skor' : 'Score' },
                { id: 'lineup' as const, label: 'Line Up' },
                { id: 'points' as const, label: isIdLang ? 'Poin' : 'Points' }
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMaeViewMode(m.id);
                    if (m.id !== 'all') setSelectedDrilldownTab(m.id);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                    maeViewMode === m.id
                      ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Horizon Presets + GW Count */}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {[
                { id: 'all' as const, label: isIdLang ? 'Semua GW' : 'All GWs' },
                { id: 'last5' as const, label: isIdLang ? '5 GW Terakhir' : 'Last 5' },
                { id: 'last3' as const, label: isIdLang ? '3 GW Terakhir' : 'Last 3' }
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setMaeHorizonPreset(preset.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                    maeHorizonPreset === preset.id
                      ? 'bg-[#37003c]/15 text-[#37003c] dark:bg-[#00ff87]/20 dark:text-[#00ff87] border border-[#37003c]/30 dark:border-[#00ff87]/40'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-[#37003c] text-white dark:bg-[#00ff87] dark:text-[#37003c] tabular-nums whitespace-nowrap shadow-xs shrink-0">
                {filteredMaeRows.length} GW
              </span>
            </div>
          </div>

          {/* Unified Single-Container 5-Column KPI Summary Strip */}
          <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 shadow-xs grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-white/5">
            <div className="p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {isIdLang ? 'Komposit' : 'Composite'}
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5 tabular-nums">
                <span className="text-lg sm:text-xl font-black text-[#37003c] dark:text-[#00ff87]">
                  {seasonMaeSummary.seasonComposite}%
                </span>
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                  ({seasonMaeSummary.seasonGrade})
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium tabular-nums">
                {seasonMaeSummary.finishedGwsCount} GW · {seasonMaeSummary.totalMatches} {isIdLang ? 'laga' : 'matches'}
              </span>
            </div>

            <div className="p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Line Up XI
              </span>
              <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                {seasonMaeSummary.seasonLineupAcc}%
              </span>
              <span className="text-[10px] text-slate-400 font-medium tabular-nums">
                {isIdLang ? `Rata-rata ${seasonMaeSummary.seasonAvgStarters}/11` : `Avg ${seasonMaeSummary.seasonAvgStarters}/11`}
              </span>
            </div>

            <div className="p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {isIdLang ? 'Hasil (WDL)' : 'Outcome (WDL)'}
              </span>
              <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                {seasonMaeSummary.seasonOutcomeAcc}%
              </span>
              <span className="text-[10px] text-slate-400 font-medium tabular-nums">
                {isIdLang ? `Skor tepat ${seasonMaeSummary.seasonExactScore}%` : `Exact ${seasonMaeSummary.seasonExactScore}%`}
              </span>
            </div>

            <div className="p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Goal MAE
              </span>
              <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                ±{seasonMaeSummary.seasonGoalMae}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {isIdLang ? 'Gol per tim' : 'Goals per team'}
              </span>
            </div>

            <div className="p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Starter xP MAE
              </span>
              <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tabular-nums mt-0.5">
                ±{seasonMaeSummary.seasonStartersMae}
              </span>
              <span className="text-[10px] text-slate-400 font-medium tabular-nums">
                {isIdLang ? `Aktif ±${seasonMaeSummary.seasonActiveMae}` : `Active ±${seasonMaeSummary.seasonActiveMae}`}
              </span>
            </div>
          </div>

          {/* Master Accuracy Recap Table */}
          <div className="bg-white dark:bg-[#1a0f2e] rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100/90 dark:bg-white/5 text-[11px] text-slate-700 dark:text-slate-300 font-extrabold border-b border-slate-200 dark:border-white/10 whitespace-nowrap select-none">
                  <tr>
                    <th
                      className="py-2 px-2.5 sticky left-0 z-10 bg-slate-100 dark:bg-[#20133b] border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white w-20 text-center"
                      onClick={() => {
                        setMaeSortCol('gw');
                        setMaeSortDir(maeSortCol === 'gw' && maeSortDir === 'asc' ? 'desc' : 'asc');
                      }}
                    >
                      GW
                    </th>
                    {(maeViewMode === 'all' || maeViewMode === 'score') && (
                      <>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('goalMae');
                            setMaeSortDir(maeSortCol === 'goalMae' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Goal MAE
                        </th>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('outcomeAcc');
                            setMaeSortDir(maeSortCol === 'outcomeAcc' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          {isIdLang ? 'WDL%' : 'Outcome'}
                        </th>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('exactScore');
                            setMaeSortDir(maeSortCol === 'exactScore' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Exact
                        </th>
                      </>
                    )}
                    {(maeViewMode === 'all' || maeViewMode === 'lineup') && (
                      <>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('lineupAcc');
                            setMaeSortDir(maeSortCol === 'lineupAcc' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Line Up XI
                        </th>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('avgStarters');
                            setMaeSortDir(maeSortCol === 'avgStarters' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Avg XI
                        </th>
                      </>
                    )}
                    {(maeViewMode === 'all' || maeViewMode === 'points') && (
                      <>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('startersMae');
                            setMaeSortDir(maeSortCol === 'startersMae' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Starter MAE
                        </th>
                        <th
                          className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer hover:text-black dark:hover:text-white"
                          onClick={() => {
                            setMaeSortCol('activeMae');
                            setMaeSortDir(maeSortCol === 'activeMae' && maeSortDir === 'asc' ? 'desc' : 'asc');
                          }}
                        >
                          Active MAE
                        </th>
                        {maeViewMode === 'points' && (
                          <th className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10">
                            Proj vs Real
                          </th>
                        )}
                      </>
                    )}
                    <th
                      className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 cursor-pointer font-black text-[#37003c] dark:text-[#00ff87]"
                      onClick={() => {
                        setMaeSortCol('composite');
                        setMaeSortDir(maeSortCol === 'composite' && maeSortDir === 'asc' ? 'desc' : 'asc');
                      }}
                    >
                      {isIdLang ? 'Komposit' : 'Composite'}
                    </th>
                    <th className="py-2 px-2 text-center w-20">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-medium">
                  {sortedMaeRows.map((row) => {
                    const isExpanded = expandedMaeGw === row.gw;
                    const colSpanCount =
                      maeViewMode === 'all'
                        ? 10
                        : maeViewMode === 'lineup'
                        ? 5
                        : 6;

                    const goalMaeColor =
                      row.teamGoalsMae <= 0.85
                        ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                        : row.teamGoalsMae <= 1.05
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400';
                    const outcomeColor =
                      row.outcomeAccPct >= 60
                        ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                        : row.outcomeAccPct >= 45
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-rose-600 dark:text-rose-400';
                    const lineupColor =
                      row.lineupAccPct >= 82
                        ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                        : row.lineupAccPct >= 73
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-rose-600 dark:text-rose-400';
                    const xpMaeColor =
                      row.startersXpMae <= 2.2
                        ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                        : row.startersXpMae <= 2.6
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-rose-600 dark:text-rose-400';

                    return (
                      <React.Fragment key={row.gw}>
                        <tr
                          onClick={() => setExpandedMaeGw(isExpanded ? null : row.gw)}
                          className={`transition-colors cursor-pointer whitespace-nowrap leading-none ${
                            isExpanded
                              ? 'bg-[#37003c]/[0.04] dark:bg-[#00ff87]/[0.06]'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="py-2 px-2.5 sticky left-0 z-10 bg-white dark:bg-[#1a0f2e] border-r border-slate-200 dark:border-white/10 text-center font-black text-[#37003c] dark:text-[#00ff87] tabular-nums">
                            GW {row.gw}
                          </td>

                          {(maeViewMode === 'all' || maeViewMode === 'score') && (
                            <>
                              <td className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums ${goalMaeColor}`}>
                                ±{row.teamGoalsMae}
                              </td>
                              <td className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums ${outcomeColor}`}>
                                {row.outcomeAccPct}%{' '}
                                <span className="text-[10px] text-slate-400 font-normal">
                                  ({row.outcomeHits}/{row.matchesFinished})
                                </span>
                              </td>
                              <td className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums text-slate-600 dark:text-slate-300">
                                {row.exactScorePct}%{' '}
                                <span className="text-[10px] text-slate-400 font-normal">
                                  ({row.exactScoreHits})
                                </span>
                              </td>
                            </>
                          )}

                          {(maeViewMode === 'all' || maeViewMode === 'lineup') && (
                            <>
                              <td className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums ${lineupColor}`}>
                                {row.lineupAccPct}%{' '}
                                <span className="text-[10px] text-slate-400 font-normal">
                                  ({row.totalStartersHit}/{row.totalStartersPredicted})
                                </span>
                              </td>
                              <td className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                                {row.avgStartersPerClub}/11
                              </td>
                            </>
                          )}

                          {(maeViewMode === 'all' || maeViewMode === 'points') && (
                            <>
                              <td className={`py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums ${xpMaeColor}`}>
                                ±{row.startersXpMae}
                              </td>
                              <td className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums text-slate-500 dark:text-slate-400">
                                ±{row.activeXpMae}
                              </td>
                              {maeViewMode === 'points' && (
                                <td className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums font-bold">
                                  <span className="text-[#37003c] dark:text-[#00ff87]">{row.totalProjPts}</span>
                                  <span className="text-slate-400 mx-1">→</span>
                                  <span className="text-slate-900 dark:text-white">{row.totalRealPts}</span>
                                </td>
                              )}
                            </>
                          )}

                          <td className="py-2 px-2 text-center border-r border-slate-200 dark:border-white/10 tabular-nums">
                            <span
                              className={`font-black ${
                                row.compositeGrade === 'A+' || row.compositeGrade === 'A'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : row.compositeGrade === 'B+' || row.compositeGrade === 'B'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {row.compositeScore}% ({row.compositeGrade})
                            </span>
                          </td>

                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedMaeGw(isExpanded ? null : row.gw);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/15 cursor-pointer transition-colors"
                            >
                              {isExpanded ? (
                                <>
                                  {isIdLang ? 'Tutup' : 'Close'}
                                  <ChevronUp className="w-3 h-3" />
                                </>
                              ) : (
                                <>
                                  Detail
                                  <ChevronDown className="w-3 h-3" />
                                </>
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* Flat Inline Drilldown Panel (No Card-in-Card Nesting) */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 dark:bg-black/25">
                            <td colSpan={colSpanCount} className="p-3 sm:p-4 border-t border-slate-200 dark:border-white/10">
                              <div className="space-y-3">
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-white/10 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-[#37003c] dark:text-[#00ff87]">
                                      GW {row.gw} · {isIdLang ? 'Rincian Evaluasi' : 'Evaluation Breakdown'}
                                    </span>
                                    <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
                                      {row.matchesFinished}/{row.matchesTotal} {isIdLang ? 'laga' : 'matches'}
                                    </span>
                                  </div>

                                  <div className="flex items-center bg-slate-200/70 dark:bg-white/5 p-0.5 rounded-lg border border-slate-200 dark:border-white/10 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDrilldownTab('score')}
                                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                                        selectedDrilldownTab === 'score'
                                          ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                                          : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                                      }`}
                                    >
                                      {isIdLang ? 'Skor' : 'Score'} ({row.outcomeHits}/{row.matchesFinished})
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDrilldownTab('lineup')}
                                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                                        selectedDrilldownTab === 'lineup'
                                          ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                                          : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                                      }`}
                                    >
                                      Line Up ({row.lineupAccPct}%)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDrilldownTab('points')}
                                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                                        selectedDrilldownTab === 'points'
                                          ? 'bg-white dark:bg-[#1a0f2e] text-[#37003c] dark:text-[#00ff87] shadow-xs'
                                          : 'text-slate-600 dark:text-slate-400 hover:text-black dark:hover:text-white'
                                      }`}
                                    >
                                      {isIdLang ? 'Poin xP' : 'Player xP'} (±{row.startersXpMae})
                                    </button>
                                  </div>
                                </div>

                                {/* Drawer 1: Matches & Scores */}
                                {selectedDrilldownTab === 'score' && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                                    {row.matchesDetail.map((m, idx) => (
                                      <div
                                        key={idx}
                                        className={`px-2.5 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                                          m.exactScoreHit
                                            ? 'bg-emerald-500/10 border-emerald-500/30'
                                            : m.outcomeHit
                                            ? 'bg-sky-500/10 border-sky-500/25'
                                            : 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/10'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1 font-bold text-slate-900 dark:text-white min-w-0">
                                          <img
                                            src={clubBadgeMap.get(m.homeShort)}
                                            alt={m.homeShort}
                                            className="w-3.5 h-3.5 object-contain shrink-0"
                                            onError={(e) => {
                                              e.currentTarget.onerror = null;
                                              e.currentTarget.src = '/default_team_badge.png';
                                            }}
                                          />
                                          <span>{m.homeShort}</span>
                                          <span className="text-slate-400 font-normal">-</span>
                                          <span>{m.awayShort}</span>
                                          <img
                                            src={clubBadgeMap.get(m.awayShort)}
                                            alt={m.awayShort}
                                            className="w-3.5 h-3.5 object-contain shrink-0"
                                            onError={(e) => {
                                              e.currentTarget.onerror = null;
                                              e.currentTarget.src = '/default_team_badge.png';
                                            }}
                                          />
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 tabular-nums">
                                          <div className="text-right leading-tight">
                                            <div className="text-[10px] font-semibold text-[#37003c] dark:text-[#00ff87]">
                                              P {m.projHomeGoals}-{m.projAwayGoals}
                                            </div>
                                            <div className="text-xs font-black text-slate-900 dark:text-white">
                                              {m.realHomeGoals !== null && m.realAwayGoals !== null ? `${m.realHomeGoals}-${m.realAwayGoals}` : '-'}
                                            </div>
                                          </div>
                                          <span
                                            className={`font-black text-xs ${
                                              m.outcomeHit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
                                            }`}
                                          >
                                            {m.outcomeHit ? '✓' : '✗'}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Drawer 2: 20 Club Lineups */}
                                {selectedDrilldownTab === 'lineup' && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                                    {row.clubsLineupDetail.map((c) => (
                                      <div
                                        key={c.club.id}
                                        className="p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col justify-between text-xs space-y-1"
                                      >
                                        <div className="flex items-center justify-between gap-1.5">
                                          <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white truncate">
                                            <img
                                              src={clubBadgeMap.get(c.club.short) || c.club.badgeUrl}
                                              alt={c.club.name}
                                              className="w-4 h-4 object-contain shrink-0"
                                              onError={(e) => {
                                                e.currentTarget.onerror = null;
                                                e.currentTarget.src = '/default_team_badge.png';
                                              }}
                                            />
                                            <span className="truncate">{c.club.short}</span>
                                          </div>
                                          <span
                                            className={`text-[11px] font-black tabular-nums shrink-0 ${
                                              c.startersHit >= 10
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : c.startersHit >= 8
                                                ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                            }`}
                                          >
                                            {c.startersHit}/11 ({c.accuracyPct}%)
                                          </span>
                                        </div>
                                        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                                          {c.missedStarters.length > 0 ? (
                                            <span>
                                              <span className="font-semibold text-rose-500">{isIdLang ? 'Meleset: ' : 'Missed: '}</span>
                                              {c.missedStarters.map((m: any, mIdx: number) => {
                                                const pid = resolveReviewPlayerId(m?.id, m?.name, c.club?.short);
                                                return (
                                                  <React.Fragment key={`${m?.name || mIdx}-${mIdx}`}>
                                                    {mIdx > 0 && ', '}
                                                    {pid && onSelectPlayer ? (
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          onSelectPlayer(pid, row.gw);
                                                        }}
                                                        className="font-semibold text-slate-700 dark:text-slate-200 hover:text-[#37003c] dark:hover:text-[#00ff87] hover:underline cursor-pointer transition-colors"
                                                      >
                                                        {m.name}
                                                      </button>
                                                    ) : (
                                                      <span>{m.name}</span>
                                                    )}
                                                  </React.Fragment>
                                                );
                                              })}
                                            </span>
                                          ) : (
                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                              ✓ {isIdLang ? '11/11 Tepat' : '11/11 Exact'}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Drawer 3: Player xP Accuracy */}
                                {selectedDrilldownTab === 'points' && (
                                  <div className="space-y-2.5">
                                    <div className="grid grid-cols-4 divide-x divide-slate-200 dark:divide-white/10 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-center">
                                      {(['GKP', 'DEF', 'MID', 'FWD'] as const).map((pos) => (
                                        <div key={pos} className="py-1.5 px-2">
                                          <div className="text-[10px] font-bold text-slate-400">{pos} MAE</div>
                                          <div className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                                            ±{row.posMae[pos]}
                                          </div>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                      <div className="p-2.5 rounded-lg border border-emerald-500/20 bg-white dark:bg-white/[0.03] space-y-1.5">
                                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                                          {isIdLang ? 'Melebihi Proyeksi' : 'Top Overperformers'}
                                        </span>
                                        <div className="space-y-1">
                                          {row.topOverperformers.map((p: any, idx: number) => {
                                            const pid = resolveReviewPlayerId(p?.id, p?.webName, p?.teamShort);
                                            const canClick = Boolean(pid && onSelectPlayer);
                                            return (
                                              <button
                                                key={idx}
                                                type="button"
                                                disabled={!canClick}
                                                onClick={() => {
                                                  if (pid && onSelectPlayer) onSelectPlayer(pid, row.gw);
                                                }}
                                                className={`w-full flex items-center justify-between text-left rounded px-1 -mx-1 py-0.5 text-slate-800 dark:text-slate-200 transition-colors ${
                                                  canClick
                                                    ? 'hover:bg-emerald-50 dark:hover:bg-emerald-500/10 cursor-pointer'
                                                    : 'cursor-default'
                                                }`}
                                              >
                                                <span className="font-semibold truncate max-w-[160px] hover:underline">
                                                  {p.webName} <span className="text-[10px] text-slate-400">({p.teamShort})</span>
                                                </span>
                                                <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                                                  +{p.diff} <span className="text-[10px] text-slate-400 font-normal">(P {p.xp} → {p.realPts})</span>
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      <div className="p-2.5 rounded-lg border border-rose-500/20 bg-white dark:bg-white/[0.03] space-y-1.5">
                                        <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                                          {isIdLang ? 'Di Bawah Proyeksi' : 'Top Underperformers'}
                                        </span>
                                        <div className="space-y-1">
                                          {row.topUnderperformers.map((p: any, idx: number) => {
                                            const pid = resolveReviewPlayerId(p?.id, p?.webName, p?.teamShort);
                                            const canClick = Boolean(pid && onSelectPlayer);
                                            return (
                                              <button
                                                key={idx}
                                                type="button"
                                                disabled={!canClick}
                                                onClick={() => {
                                                  if (pid && onSelectPlayer) onSelectPlayer(pid, row.gw);
                                                }}
                                                className={`w-full flex items-center justify-between text-left rounded px-1 -mx-1 py-0.5 text-slate-800 dark:text-slate-200 transition-colors ${
                                                  canClick
                                                    ? 'hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer'
                                                    : 'cursor-default'
                                                }`}
                                              >
                                                <span className="font-semibold truncate max-w-[160px] hover:underline">
                                                  {p.webName} <span className="text-[10px] text-slate-400">({p.teamShort})</span>
                                                </span>
                                                <span className="tabular-nums font-bold text-rose-600 dark:text-rose-400">
                                                  {p.diff} <span className="text-[10px] text-slate-400 font-normal">(P {p.xp} → {p.realPts})</span>
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
