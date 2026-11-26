import { PositionType, DbPlayerStat } from '../types.ts';
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json';

export const PROJECTION_FORMULA_VERSION = '2026.18-scout-walkfwd';

// ============================================================================
// PREMIER LEAGUE 2026/2027 DEAD-BALL HIERARCHY CATALOG (20 CLUBS)
// Used for penalty taker conversion boost (~79% historic PL rate) and
// high-volume set-piece cross/assist expectations (direct FK & corners).
// ============================================================================
export interface DeadBallClubTakers {
  penalties: string[];
  directFk: string[];
  corners: string[];
}

export const PREMIER_LEAGUE_DEAD_BALL_CATALOG: Record<string, DeadBallClubTakers> = {
  ARS: {
    penalties: ['Saka', 'Havertz', 'Ødegaard'],
    directFk: ['Rice', 'Saka', 'Ødegaard'],
    corners: ['Saka', 'Rice', 'Martinelli']
  },
  AVL: {
    penalties: ['Watkins', 'Tielemans'],
    directFk: ['Digne', 'McGinn', 'Tielemans'],
    corners: ['Digne', 'Tielemans', 'McGinn']
  },
  BOU: {
    penalties: ['Kluivert', 'Semenyo', 'Evanilson'],
    directFk: ['Tavernier', 'Christie'],
    corners: ['Tavernier', 'Cook']
  },
  BRE: {
    penalties: ['Mbeumo', 'Wissa'],
    directFk: ['Mbeumo', 'Damsgaard'],
    corners: ['Mbeumo', 'Damsgaard']
  },
  BHA: {
    penalties: ['Pedro', 'Welbeck', 'Milner'],
    directFk: ['Estupiñan', 'Enciso'],
    corners: ['Estupiñan', 'Mitoma', 'Minteh']
  },
  CHE: {
    penalties: ['Palmer', 'Nkunku'],
    directFk: ['Palmer', 'Enzo', 'James'],
    corners: ['Palmer', 'Enzo', 'Neto']
  },
  COV: {
    penalties: ['Wright', 'Simms'],
    directFk: ['Rudoni', 'Torp'],
    corners: ['Rudoni', 'Torp']
  },
  CRY: {
    penalties: ['Mateta', 'Eze'],
    directFk: ['Eze', 'Wharton'],
    corners: ['Eze', 'Wharton', 'Muñoz']
  },
  EVE: {
    penalties: ['Calvert-Lewin', 'McNeil'],
    directFk: ['McNeil', 'Young'],
    corners: ['McNeil', 'Lindstrøm']
  },
  FUL: {
    penalties: ['Jiménez', 'Pereira'],
    directFk: ['Pereira', 'Wilson'],
    corners: ['Pereira', 'Wilson', 'Iwobi']
  },
  HUL: {
    penalties: ['Bedia', 'Connolly'],
    directFk: ['Coyle', 'Slater'],
    corners: ['Slater', 'Ömür']
  },
  IPS: {
    penalties: ['Delap', 'Broadhead', 'Chaplin'],
    directFk: ['Davis', 'Leif Davis'],
    corners: ['Davis', 'Leif Davis']
  },
  LEE: {
    penalties: ['Piroe', 'Gnonto'],
    directFk: ['Tanaka', 'Rothwell'],
    corners: ['Rothwell', 'Bogle']
  },
  LIV: {
    penalties: ['Salah', 'Szoboszlai'],
    directFk: ['Alexander-Arnold', 'Szoboszlai', 'Mac Allister'],
    corners: ['Alexander-Arnold', 'Robertson', 'Szoboszlai']
  },
  MCI: {
    penalties: ['Haaland', 'De Bruyne', 'Foden'],
    directFk: ['De Bruyne', 'Foden'],
    corners: ['De Bruyne', 'Foden', 'Bernardo']
  },
  MUN: {
    penalties: ['Fernandes', 'Rashford'],
    directFk: ['Fernandes', 'Rashford', 'Eriksen'],
    corners: ['Fernandes', 'Eriksen', 'Shaw']
  },
  NEW: {
    penalties: ['Isak', 'Gordon', 'Schär'],
    directFk: ['Trippier', 'Schär', 'Gordon'],
    corners: ['Trippier', 'Gordon', 'Hall']
  },
  NFO: {
    penalties: ['Wood', 'Gibbs-White'],
    directFk: ['Gibbs-White', 'Anderson'],
    corners: ['Gibbs-White', 'Anderson', 'Elanga']
  },
  TOT: {
    penalties: ['Son', 'Solanke'],
    directFk: ['Maddison', 'Porro', 'Kulusevski'],
    corners: ['Porro', 'Maddison', 'Kulusevski']
  },
  SUN: {
    penalties: ['Mayenda', 'Isidor'],
    directFk: ['Roberts', 'Rigg'],
    corners: ['Roberts', 'Hume']
  }
};

// ============================================================================
// CLUB AGGREGATES & ADVANCED FORMULA ENGINE
// ============================================================================

export interface ClubSplitStats {
  id: number;
  name: string;
  short: string;
  // Season aggregate
  totalMatches: number;
  gf: number;
  ga: number;
  cs: number;
  xg: number;
  xgc: number;
  // Home splits
  homeMatches: number;
  homeGf: number;
  homeGa: number;
  homeXg: number;
  homeXgc: number;
  // Away splits
  awayMatches: number;
  awayGf: number;
  awayGa: number;
  awayXg: number;
  awayXgc: number;
  // Recency-weighted form (last 4 GWs with linear decay: 4, 3, 2, 1)
  recentHomeWeight: number;
  recentAwayWeight: number;
  recentHomeGf: number;
  recentHomeGa: number;
  recentAwayGf: number;
  recentAwayGa: number;
  recentHomeXg: number;
  recentHomeXgc: number;
  recentAwayXg: number;
  recentAwayXgc: number;
}

export interface ClubFixtureProjection {
  lambdaH: number;
  lambdaA: number;
  homeGoals: number;
  awayGoals: number;
  homeCsProb: number; // 0..100
  awayCsProb: number; // 0..100
  homeCsProbRaw?: number; // continuous 0..1 exp(-lambdaA)
  awayCsProbRaw?: number; // continuous 0..1 exp(-lambdaH)
  homeExpGcPenalty: number; // expected negative points from goals conceded (per 2 goals)
  awayExpGcPenalty: number;
}

/**
 * Computes discrete Poisson probability P(X = k) = (lambda^k * e^-lambda) / k!
 */
export function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

/**
 * Computes mathematically rigorous expected goals conceded deduction
 * for FPL Defenders and Goalkeepers: -1 point per every 2 goals conceded.
 * E[Deduction] = sum_{k=2}^8 floor(k/2) * P(X = k; lambda)
 */
export function calculateExpectedGcPenalty(lambda: number): number {
  if (lambda <= 0.05) return 0;
  let expectedDeduction = 0;
  for (let k = 2; k <= 8; k++) {
    const penaltyUnits = Math.floor(k / 2);
    expectedDeduction += penaltyUnits * poissonProb(lambda, k);
  }
  return expectedDeduction;
}

/**
 * Parses return date from FPL news string (e.g. "Expected back 1 Nov", "Suspended until 31 Oct")
 */
export function parseExpectedReturnDate(news?: string, referenceDate: Date = new Date()): Date | null {
  if (!news) return null;
  const match = news.match(/(?:Expected back|Suspended until)\s+(\d{1,2})\s+([A-Za-z]{3})/i);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  const m = months[monthStr];
  if (m === undefined) return null;
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();
  const seasonStartYear = refMonth >= 6 ? refYear : refYear - 1;
  const year = m <= 5 ? seasonStartYear + 1 : seasonStartYear;
  return new Date(Date.UTC(year, m, day, 23, 59, 59));
}

/**
 * Determines whether a player is a primary/secondary dead-ball taker
 */
export function resolveDeadBallDuties(
  webName: string,
  fullName: string,
  teamShort: string,
  rawPlayer?: any
): { isPrimaryPen: boolean; isSecondaryPen: boolean; isFkTaker: boolean; isCornerTaker: boolean } {
  const normName = `${webName} ${fullName}`.toLowerCase();

  // 1. Check official FPL API orders if available on player object
  const penOrder = rawPlayer?.penalties_order ?? rawPlayer?.penaltiesOrder;
  const fkOrder = rawPlayer?.direct_freekicks_order ?? rawPlayer?.directFreekicksOrder;
  const cornerOrder = rawPlayer?.corners_and_indirect_freekicks_order ?? rawPlayer?.cornersAndIndirectFreekicksOrder;

  let isPrimaryPen = penOrder === 1;
  let isSecondaryPen = penOrder === 2;
  let isFkTaker = fkOrder === 1 || fkOrder === 2;
  let isCornerTaker = cornerOrder === 1 || cornerOrder === 2;

  // 2. Cross-reference with Premier League verified Dead-Ball catalog
  const clubTakers = PREMIER_LEAGUE_DEAD_BALL_CATALOG[teamShort];
  if (clubTakers) {
    if (!isPrimaryPen && clubTakers.penalties[0] && normName.includes(clubTakers.penalties[0].toLowerCase())) {
      isPrimaryPen = true;
    }
    if (!isPrimaryPen && !isSecondaryPen && clubTakers.penalties[1] && normName.includes(clubTakers.penalties[1].toLowerCase())) {
      isSecondaryPen = true;
    }
    if (!isFkTaker && clubTakers.directFk.some(t => normName.includes(t.toLowerCase()))) {
      isFkTaker = true;
    }
    if (!isCornerTaker && clubTakers.corners.some(t => normName.includes(t.toLowerCase()))) {
      isCornerTaker = true;
    }
  }

  return { isPrimaryPen, isSecondaryPen, isFkTaker, isCornerTaker };
}

/**
 * Aggregates club performance data from historical matches and players with Home/Away splits
 * and Recency-Weighted Form (last 4 GWs with linear decay: 4, 3, 2, 1).
 */
export function buildClubSplitStatsMap(
  clubs: Array<{ id: number; name: string; short: string }>,
  players: DbPlayerStat[] = [],
  matchesByGW: Record<number, any[]> = {},
  baseHistoricalGW: number = 7,
  options?: { minHistoricalGW?: number; skipRawPlayerAggregates?: boolean }
): {
  clubStatsMap: Record<string, ClubSplitStats>;
  leagueAvgHomeGoals: number;
  leagueAvgAwayGoals: number;
} {
  const minHistoricalGW = Math.max(1, options?.minHistoricalGW ?? 1);
  const skipRawPlayerAggregates = Boolean(options?.skipRawPlayerAggregates);
  const windowMatchCount = Math.max(baseHistoricalGW - minHistoricalGW + 1, 1);
  const statsMap: Record<string, ClubSplitStats> = {};

  for (const c of clubs) {
    statsMap[c.short] = {
      id: c.id,
      name: c.name,
      short: c.short,
      totalMatches: windowMatchCount,
      gf: 0,
      ga: 0,
      cs: 0,
      xg: 0,
      xgc: 0,
      homeMatches: 0,
      homeGf: 0,
      homeGa: 0,
      homeXg: 0,
      homeXgc: 0,
      awayMatches: 0,
      awayGf: 0,
      awayGa: 0,
      awayXg: 0,
      awayXgc: 0,
      recentHomeWeight: 0,
      recentAwayWeight: 0,
      recentHomeGf: 0,
      recentHomeGa: 0,
      recentAwayGf: 0,
      recentAwayGa: 0,
      recentHomeXg: 0,
      recentHomeXgc: 0,
      recentAwayXg: 0,
      recentAwayXgc: 0
    };
  }

  // 1. Process player aggregates (skipped when building strict windowed baseline from match history only)
  if (!skipRawPlayerAggregates) {
    for (const p of players) {
      const c = p.teamShort;
      if (!statsMap[c]) continue;
      statsMap[c].gf += p.goalsScored || 0;
      statsMap[c].xg += p.expectedGoals || 0;
      if (p.position === 'GKP' || p.position === 'DEF') {
        if ((p.goalsConceded || 0) > statsMap[c].ga) statsMap[c].ga = p.goalsConceded;
        if ((p.cleanSheets || 0) > statsMap[c].cs) statsMap[c].cs = p.cleanSheets;
        if ((p.expectedGoalsConceded || 0) > statsMap[c].xgc) statsMap[c].xgc = p.expectedGoalsConceded;
      }
    }
  }

  // 2. Process match history to calculate Home/Away splits and 4-GW Recency Form
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  let totalHomeMatches = 0;
  let totalAwayMatches = 0;

  const recentWindowStart = Math.max(minHistoricalGW, baseHistoricalGW - 3); // last 4 GWs within window

  const ingestedMatchKeySet = new Set<string>();

  // A. Prioritize live / app-fetched matches from matchesByGW FIRST
  for (let gw = minHistoricalGW; gw <= baseHistoricalGW; gw++) {
    const matches = matchesByGW[gw] || [];
    const isRecent = gw >= recentWindowStart;
    const recencyWeight = isRecent ? (gw - recentWindowStart + 1) : 0;

    for (const m of matches) {
      const rawHScore = m.team_h_score ?? m.home_score ?? m.hScore;
      const rawAScore = m.team_a_score ?? m.away_score ?? m.aScore;
      const hScore = rawHScore !== null && rawHScore !== undefined ? Number(rawHScore) : null;
      const aScore = rawAScore !== null && rawAScore !== undefined ? Number(rawAScore) : null;
      if (hScore === null || aScore === null || Number.isNaN(hScore) || Number.isNaN(aScore)) continue;

      const hShort = m.home_team?.short_name || (typeof m.home_team === 'string' ? m.home_team : m.hShort);
      const aShort = m.away_team?.short_name || (typeof m.away_team === 'string' ? m.away_team : m.aShort);
      if (!hShort || !aShort) continue;

      ingestedMatchKeySet.add(`${gw}_${hShort}_${aShort}`);

      totalHomeGoals += hScore;
      totalAwayGoals += aScore;
      totalHomeMatches++;
      totalAwayMatches++;

      // Extract real match-level xG from lineup + bench player stats when available (matchesFetcher zeros DGW optical stats)
      const sumTeamMatchXg = (lineup?: any[], bench?: any[]): number => {
        let sum = 0;
        if (Array.isArray(lineup)) {
          for (const lp of lineup) sum += Number(lp?.stats?.expected_goals || 0);
        }
        if (Array.isArray(bench)) {
          for (const lp of bench) sum += Number(lp?.stats?.expected_goals || 0);
        }
        return sum;
      };
      const rawHomeXg = sumTeamMatchXg(m.home_lineup, m.home_bench);
      const rawAwayXg = sumTeamMatchXg(m.away_lineup, m.away_bench);
      const hasRealMatchXg = rawHomeXg > 0.05 || rawAwayXg > 0.05;

      const hMatchXg = hasRealMatchXg ? Math.max(0.15, rawHomeXg) : Math.max(0.6, hScore * 0.75 + 0.35);
      const hMatchXgc = hasRealMatchXg ? Math.max(0.15, rawAwayXg) : Math.max(0.5, aScore * 0.75 + 0.35);
      const aMatchXg = hasRealMatchXg ? Math.max(0.15, rawAwayXg) : Math.max(0.5, aScore * 0.75 + 0.35);
      const aMatchXgc = hasRealMatchXg ? Math.max(0.15, rawHomeXg) : Math.max(0.6, hScore * 0.75 + 0.35);

      if (statsMap[hShort]) {
        statsMap[hShort].homeMatches++;
        statsMap[hShort].homeGf += hScore;
        statsMap[hShort].homeGa += aScore;
        statsMap[hShort].homeXg += hMatchXg;
        statsMap[hShort].homeXgc += hMatchXgc;

        if (isRecent) {
          statsMap[hShort].recentHomeWeight += recencyWeight;
          statsMap[hShort].recentHomeGf += hScore * recencyWeight;
          statsMap[hShort].recentHomeGa += aScore * recencyWeight;
          statsMap[hShort].recentHomeXg += hMatchXg * recencyWeight;
          statsMap[hShort].recentHomeXgc += hMatchXgc * recencyWeight;
        }
      }

      if (statsMap[aShort]) {
        statsMap[aShort].awayMatches++;
        statsMap[aShort].awayGf += aScore;
        statsMap[aShort].awayGa += hScore;
        statsMap[aShort].awayXg += aMatchXg;
        statsMap[aShort].awayXgc += aMatchXgc;

        if (isRecent) {
          statsMap[aShort].recentAwayWeight += recencyWeight;
          statsMap[aShort].recentAwayGf += aScore * recencyWeight;
          statsMap[aShort].recentAwayGa += hScore * recencyWeight;
          statsMap[aShort].recentAwayXg += aMatchXg * recencyWeight;
          statsMap[aShort].recentAwayXgc += aMatchXgc * recencyWeight;
        }
      }
    }
  }

  // B. Fallback to verified precalculatedReviewData ONLY for GW/fixtures not already ingested from matchesByGW
  const precalcList = (precalculatedReviewDataRaw as any)?.matches || [];
  for (const m of precalcList) {
    if (m.gw < minHistoricalGW || m.gw > baseHistoricalGW || !m.finished) continue;
    const hShort = m.hShort;
    const aShort = m.aShort;
    if (ingestedMatchKeySet.has(`${m.gw}_${hShort}_${aShort}`)) continue;
    ingestedMatchKeySet.add(`${m.gw}_${hShort}_${aShort}`);

    const hScore = Number(m.hScore ?? 0);
    const aScore = Number(m.aScore ?? 0);

    totalHomeGoals += hScore;
    totalAwayGoals += aScore;
    totalHomeMatches++;
    totalAwayMatches++;

    const isRecent = m.gw >= recentWindowStart;
    const recencyWeight = isRecent ? (m.gw - recentWindowStart + 1) : 0;

    if (statsMap[hShort]) {
      statsMap[hShort].homeMatches++;
      statsMap[hShort].homeGf += hScore;
      statsMap[hShort].homeGa += aScore;
      statsMap[hShort].homeXg += Math.max(0.6, hScore * 0.75 + 0.35);
      statsMap[hShort].homeXgc += Math.max(0.5, aScore * 0.75 + 0.35);

      if (isRecent) {
        statsMap[hShort].recentHomeWeight += recencyWeight;
        statsMap[hShort].recentHomeGf += hScore * recencyWeight;
        statsMap[hShort].recentHomeGa += aScore * recencyWeight;
        statsMap[hShort].recentHomeXg += (hScore * 0.75 + 0.35) * recencyWeight;
        statsMap[hShort].recentHomeXgc += (aScore * 0.75 + 0.35) * recencyWeight;
      }
    }

    if (statsMap[aShort]) {
      statsMap[aShort].awayMatches++;
      statsMap[aShort].awayGf += aScore;
      statsMap[aShort].awayGa += hScore;
      statsMap[aShort].awayXg += Math.max(0.5, aScore * 0.75 + 0.35);
      statsMap[aShort].awayXgc += Math.max(0.6, hScore * 0.75 + 0.35);

      if (isRecent) {
        statsMap[aShort].recentAwayWeight += recencyWeight;
        statsMap[aShort].recentAwayGf += aScore * recencyWeight;
        statsMap[aShort].recentAwayGa += hScore * recencyWeight;
        statsMap[aShort].recentAwayXg += (aScore * 0.75 + 0.35) * recencyWeight;
        statsMap[aShort].recentAwayXgc += (hScore * 0.75 + 0.35) * recencyWeight;
      }
    }
  }

  // C. Guarantee complete & exact match-level GF/GA across all 20 clubs and historical GWs
  for (const c of clubs) {
    const st = statsMap[c.short];
    const splitMatchTotal = st.homeMatches + st.awayMatches;
    if (splitMatchTotal > 0 && (splitMatchTotal >= baseHistoricalGW || st.gf === 0)) {
      st.totalMatches = splitMatchTotal;
      st.gf = st.homeGf + st.awayGf;
      st.ga = st.homeGa + st.awayGa;
      if (st.xg === 0) st.xg = st.homeXg + st.awayXg;
      if (st.xgc === 0) st.xgc = st.homeXgc + st.awayXgc;
    }

    const hasSample = splitMatchTotal > 0 || st.xg > 0 || st.gf > 0;
    const mCount = Math.max(st.totalMatches, 1);
    const seasonAttPerMatch = hasSample
      ? Math.max(0.7, (st.xg * 0.65 + st.gf * 0.35) / mCount)
      : 1.40;
    const seasonDefPerMatch = hasSample
      ? Math.max(0.7, (st.xgc * 0.65 + st.ga * 0.35) / mCount)
      : 1.40;

    if (!hasSample) {
      st.xg = seasonAttPerMatch * mCount;
      st.gf = st.xg;
      st.xgc = seasonDefPerMatch * mCount;
      st.ga = st.xgc;
    }

    if (st.homeMatches === 0) {
      st.homeMatches = Math.max(1, Math.round(mCount / 2));
      st.homeGf = seasonAttPerMatch * st.homeMatches * 1.15;
      st.homeGa = seasonDefPerMatch * st.homeMatches * 0.85;
      st.homeXg = seasonAttPerMatch * st.homeMatches * 1.15;
      st.homeXgc = seasonDefPerMatch * st.homeMatches * 0.85;
    }
    if (st.awayMatches === 0) {
      st.awayMatches = Math.max(1, Math.round(mCount / 2));
      st.awayGf = seasonAttPerMatch * st.awayMatches * 0.85;
      st.awayGa = seasonDefPerMatch * st.awayMatches * 1.15;
      st.awayXg = seasonAttPerMatch * st.awayMatches * 0.85;
      st.awayXgc = seasonDefPerMatch * st.awayMatches * 1.15;
    }
  }

  // League averages (calibrated with default Premier League benchmarks)
  const leagueAvgHomeGoals = totalHomeMatches > 0 ? Math.max(totalHomeGoals / totalHomeMatches, 1.45) : 1.55;
  const leagueAvgAwayGoals = totalAwayMatches > 0 ? Math.max(totalAwayGoals / totalAwayMatches, 1.15) : 1.25;

  return { clubStatsMap: statsMap, leagueAvgHomeGoals, leagueAvgAwayGoals };
}

