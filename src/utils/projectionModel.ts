import { PositionType, DbPlayerStat } from '../types.ts';
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json';

export const PROJECTION_FORMULA_VERSION = '2026.7';

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
 * Computes Poisson upper-tail exceedance probability P(X >= threshold)
 */
export function poissonTailProb(lambda: number, threshold: number): number {
  if (threshold <= 0) return 1;
  if (lambda <= 0.01) return 0;
  let cdfBelow = 0;
  for (let k = 0; k < threshold; k++) {
    cdfBelow += poissonProb(lambda, k);
  }
  return Math.max(0, Math.min(1, 1 - cdfBelow));
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

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - d * poly;
  return z >= 0 ? p : 1 - p;
}

/**
 * Computes overdispersed defensive contribution hit probability P(X >= threshold)
 * blending exact Poisson tail with Negative-Binomial/normal variance (var = 1.45 * mu).
 */
export function defConTailProb(lambda: number, threshold: number): number {
  if (lambda <= 0.05) return 0;
  const pPoisson = poissonTailProb(lambda, threshold);
  const sd = Math.sqrt(Math.max(0.25, 1.45 * lambda));
  const z = (threshold - 0.5 - lambda) / sd;
  const pNormal = Math.max(0, Math.min(1, 1 - normalCdf(z)));
  return Math.max(0, Math.min(1, 0.55 * pPoisson + 0.45 * pNormal));
}

/**
 * Calculates deterministic, expectation-aligned match scoreline from the joint Bivariate Poisson
 * probability distribution P(H=h, A=a). Eliminates noisy random score sampling while preserving
 * expected goals alignment (~2.73 PL goals/match) and directional result consistency.
 */
export function calculatePoissonScore(
  lambdaH: number,
  lambdaA: number,
  _seedKey?: string
): { homeGoals: number; awayGoals: number } {
  const lH = Math.max(0.05, lambdaH * 0.99);
  const lA = Math.max(0.05, lambdaA * 0.99);
  const rho = Math.min(lH, lA) * 0.04;
  const l1 = Math.max(0.05, lH - rho);
  const l2 = Math.max(0.05, lA - rho);
  const maxG = 6;

  const p1 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(l1, k));
  const p2 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(l2, k));
  const p3 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(rho, k));

  const grid: Array<{ h: number; a: number; score: number }> = [];
  const diff = lH - lA;

  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      let jointP = 0;
      const minHA = Math.min(h, a);
      for (let s = 0; s <= minHA; s++) {
        jointP += p1[h - s] * p2[a - s] * p3[s];
      }
      // Align joint probability closely with continuous team expectation (lH, lA)
      // to avoid degenerate 0-0 modes when lH ~ 1.4 or extreme blowouts like 4-1.
      const distPenalty = Math.exp(-1.15 * ((h - lH) * (h - lH) + (a - lA) * (a - lA)));
      const drawBoost = h === a && Math.abs(diff) <= 0.16 ? 1.12 : 1.0;
      grid.push({ h, a, score: jointP * distPenalty * drawBoost });
    }
  }

  const matchesDirection = (h: number, a: number): boolean => {
    if (diff >= 0.45) return h > a;
    if (diff <= -0.45) return a > h;
    if (diff >= 0.16) return h >= a;
    if (diff <= -0.16) return a >= h;
    return Math.abs(h - a) <= 1;
  };

  let candidates = grid.filter((o) => {
    if (!matchesDirection(o.h, o.a)) return false;
    if (o.h === 0 && o.a === 0 && lH + lA >= 2.15) return false;
    return true;
  });

  if (candidates.length === 0) {
    candidates = grid.filter((o) => matchesDirection(o.h, o.a));
  }
  if (candidates.length === 0) {
    candidates = grid;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    homeGoals: best ? best.h : Math.round(lH),
    awayGoals: best ? best.a : Math.round(lA),
  };
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
  baseHistoricalGW: number = 7
): {
  clubStatsMap: Record<string, ClubSplitStats>;
  leagueAvgHomeGoals: number;
  leagueAvgAwayGoals: number;
} {
  const statsMap: Record<string, ClubSplitStats> = {};

  for (const c of clubs) {
    statsMap[c.short] = {
      id: c.id,
      name: c.name,
      short: c.short,
      totalMatches: Math.max(baseHistoricalGW, 1),
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

  // 1. Process player aggregates (total season metrics)
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

  // 2. Process match history to calculate Home/Away splits and 4-GW Recency Form
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;
  let totalHomeMatches = 0;
  let totalAwayMatches = 0;

  const recentWindowStart = Math.max(1, baseHistoricalGW - 3); // last 4 GWs

  const ingestedMatchKeySet = new Set<string>();

  // A. Prioritize live / app-fetched matches from matchesByGW FIRST
  for (let gw = 1; gw <= baseHistoricalGW; gw++) {
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
    if (m.gw > baseHistoricalGW || !m.finished) continue;
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

/**
 * Computes per-club lineup attacking multiplier per GW by accumulating
 * individual player xG/90 * pPlayAny against full-strength baseline.
 * Keeps team xG synchronized when key attackers (e.g., Thiago/Saka) are absent.
 */
export function buildClubLineupAttackMods(
  players: DbPlayerStat[] = [],
  baseHistoricalGW: number = 7,
  targetNextGW: number = 8,
  matchesByGW: Record<number, any[]> = {}
): Record<string, Record<number, number>> {
  const clubBaseXg: Record<string, number> = {};
  const clubGwXg: Record<string, Record<number, number>> = {};
  const N = Math.max(baseHistoricalGW, 1);

  for (const p of players) {
    if (p.status === 'u') continue;
    const c = p.teamShort;
    if (!c) continue;
    if (!(c in clubBaseXg)) {
      clubBaseXg[c] = 0;
      clubGwXg[c] = {};
    }

    const pos = p.position as PositionType;
    const costMil = (p.nowCost || 50) / 10;
    const mins = p.minutes || (p.starts ? p.starts * 75 : 0);
    const priorXg90 =
      pos === 'FWD'
        ? costMil >= 12 ? 0.70 : costMil >= 9 ? 0.46 : costMil >= 7 ? 0.34 : costMil >= 5.5 ? 0.22 : 0.14
        : pos === 'MID'
        ? costMil >= 10 ? 0.42 : costMil >= 8 ? 0.28 : costMil >= 6.5 ? 0.18 : costMil >= 5 ? 0.10 : 0.04
        : pos === 'DEF'
        ? costMil >= 6 ? 0.07 : costMil >= 5 ? 0.04 : costMil >= 4.5 ? 0.03 : 0.01
        : 0;
    const sampleXg90 = mins > 0 ? ((p.expectedGoals || p.goalsScored || 0) / mins) * 90 : priorXg90;
    const w = mins / (mins + 540);
    const postXg90 = w * sampleXg90 + (1 - w) * priorXg90;

    const baseSiProb = Math.min(0.99, Math.max(0.05, (p.starts || 0) / N));
    const basePAny = Math.min(1.0, baseSiProb + (1 - baseSiProb) * (pos === 'GKP' ? 0.02 : 0.32));
    clubBaseXg[c] += postXg90 * basePAny;

    const returnDate = parseExpectedReturnDate(p.news);
    const rawStatus = (p.status || 'a').toLowerCase();
    const isNewsSuspended = typeof p.news === 'string' && /suspende/i.test(p.news);
    const isSuspended = rawStatus === 's' || isNewsSuspended;
    const isInjured = rawStatus === 'i';
    const chanceNext = p.chanceOfPlayingNextRound;

    for (let gw = targetNextGW; gw <= Math.min(targetNextGW + 5, 38); gw++) {
      const mList = matchesByGW[gw] || [];
      const clubFixes = mList
        .filter((m) => m.home_team?.short_name === c || m.away_team?.short_name === c)
        .sort((a, b) => (a.kickoff_time ? Date.parse(a.kickoff_time) : 0) - (b.kickoff_time ? Date.parse(b.kickoff_time) : 0));
      const fix = clubFixes[0];
      const matchDate = fix?.kickoff_time
        ? new Date(fix.kickoff_time)
        : new Date(Date.UTC(2026, 9, 24 + (gw - targetNextGW) * 7));

      let effSi = baseSiProb;
      let isOut = false;
      if (isInjured || isSuspended) {
        if (returnDate) {
          if (matchDate < returnDate) {
            isOut = true;
            effSi = 0;
          } else {
            const firstBack = matchDate.getTime() - returnDate.getTime() < 7 * 24 * 60 * 60 * 1000;
            effSi = firstBack ? baseSiProb * 0.75 : baseSiProb;
          }
        } else if (gw === targetNextGW) {
          isOut = true;
          effSi = 0;
        } else if (gw === targetNextGW + 1 && isInjured) {
          effSi = baseSiProb * 0.5;
        }
      } else if (rawStatus === 'd') {
        const ch = chanceNext ?? 75;
        if (gw === targetNextGW) {
          if (ch === 0) { isOut = true; effSi = 0; }
          else effSi = baseSiProb * (ch / 100);
        } else if (gw === targetNextGW + 1 && ch === 0) {
          effSi = baseSiProb * 0.75;
        }
      }

      const gwPAny = isOut ? 0 : Math.min(1.0, effSi + (1 - effSi) * (pos === 'GKP' ? 0.02 : 0.32));
      clubGwXg[c][gw] = (clubGwXg[c][gw] || 0) + postXg90 * gwPAny;
    }
  }

  const mods: Record<string, Record<number, number>> = {};
  for (const [c, baseTotal] of Object.entries(clubBaseXg)) {
    mods[c] = {};
    for (let gw = targetNextGW; gw <= Math.min(targetNextGW + 5, 38); gw++) {
      const ratio = baseTotal > 0.25 ? (clubGwXg[c]?.[gw] ?? baseTotal) / baseTotal : 1.0;
      mods[c][gw] = Math.min(1.12, Math.max(0.78, 0.60 + 0.40 * ratio));
    }
  }
  return mods;
}

/**
 * Computes per-club defensive vulnerability multiplier per GW when key GKPs or regular DEFs
 * are unavailable (returns >= 1.0 when regular defenders/GKP are missing, increasing oppLambda).
 */
export function buildClubLineupDefenseMods(
  players: DbPlayerStat[] = [],
  baseHistoricalGW: number = 7,
  targetNextGW: number = 8,
  matchesByGW: Record<number, any[]> = {}
): Record<string, Record<number, number>> {
  const clubBaseDef: Record<string, number> = {};
  const clubGwDef: Record<string, Record<number, number>> = {};
  const N = Math.max(baseHistoricalGW, 1);

  for (const p of players) {
    if (p.status === 'u') continue;
    const pos = p.position as PositionType;
    if (pos !== 'GKP' && pos !== 'DEF') continue;
    const c = p.teamShort;
    if (!c) continue;
    if (!(c in clubBaseDef)) {
      clubBaseDef[c] = 0;
      clubGwDef[c] = {};
    }

    const costMil = (p.nowCost || 45) / 10;
    const baseSiProb = Math.min(0.99, Math.max(0.05, (p.starts || 0) / N));
    const roleWeight = pos === 'GKP' ? 2.2 : (costMil >= 5.5 ? 1.25 : 1.0);
    const defValue = roleWeight * baseSiProb;
    clubBaseDef[c] += defValue;

    const returnDate = parseExpectedReturnDate(p.news);
    const rawStatus = (p.status || 'a').toLowerCase();
    const isNewsSuspended = typeof p.news === 'string' && /suspende/i.test(p.news);
    const isSuspended = rawStatus === 's' || isNewsSuspended;
    const isInjured = rawStatus === 'i';
    const chanceNext = p.chanceOfPlayingNextRound;

    for (let gw = targetNextGW; gw <= Math.min(targetNextGW + 5, 38); gw++) {
      const mList = matchesByGW[gw] || [];
      const clubFixes = mList
        .filter((m) => m.home_team?.short_name === c || m.away_team?.short_name === c)
        .sort((a, b) => (a.kickoff_time ? Date.parse(a.kickoff_time) : 0) - (b.kickoff_time ? Date.parse(b.kickoff_time) : 0));
      const fix = clubFixes[0];
      const matchDate = fix?.kickoff_time
        ? new Date(fix.kickoff_time)
        : new Date(Date.UTC(2026, 9, 24 + (gw - targetNextGW) * 7));

      let effSi = baseSiProb;
      let isOut = false;
      if (isInjured || isSuspended) {
        if (returnDate) {
          if (matchDate < returnDate) {
            isOut = true;
            effSi = 0;
          } else {
            const firstBack = matchDate.getTime() - returnDate.getTime() < 7 * 24 * 60 * 60 * 1000;
            effSi = firstBack ? baseSiProb * 0.75 : baseSiProb;
          }
        } else if (gw === targetNextGW) {
          isOut = true;
          effSi = 0;
        } else if (gw === targetNextGW + 1 && isInjured) {
          effSi = baseSiProb * 0.5;
        }
      } else if (rawStatus === 'd') {
        const ch = chanceNext ?? 75;
        if (gw === targetNextGW) {
          if (ch === 0) { isOut = true; effSi = 0; }
          else effSi = baseSiProb * (ch / 100);
        } else if (gw === targetNextGW + 1 && ch === 0) {
          effSi = baseSiProb * 0.75;
        }
      }

      const gwDefValue = isOut ? 0 : roleWeight * effSi;
      clubGwDef[c][gw] = (clubGwDef[c][gw] || 0) + gwDefValue;
    }
  }

  const mods: Record<string, Record<number, number>> = {};
  for (const [c, baseTotal] of Object.entries(clubBaseDef)) {
    mods[c] = {};
    for (let gw = targetNextGW; gw <= Math.min(targetNextGW + 5, 38); gw++) {
      const ratio = baseTotal > 0.25 ? (clubGwDef[c]?.[gw] ?? baseTotal) / baseTotal : 1.0;
      mods[c][gw] = Math.min(1.16, Math.max(0.95, 1.0 + (1.0 - ratio) * 0.38));
    }
  }
  return mods;
}

/**
 * Calculates Fixture Projection (Lambda, Clean Sheet odds, and Expected Goals Conceded penalty)
 * using Home/Away Splits, Recency Form Weighting, Lineup Attack/Defense Sync, and Bivariate Poisson Simulation.
 */
export function projectEnhancedFixture(
  homeShort: string,
  awayShort: string,
  statsMap: Record<string, ClubSplitStats>,
  leagueAvgHomeGoals: number,
  leagueAvgAwayGoals: number,
  baseHistoricalGW: number,
  gw?: number,
  homeLineupAttMod: number = 1.0,
  awayLineupAttMod: number = 1.0,
  homeLineupDefMod: number = 1.0,
  awayLineupDefMod: number = 1.0
): ClubFixtureProjection {
  const hStats: ClubSplitStats = statsMap[homeShort] || {
    id: 0,
    name: homeShort,
    short: homeShort,
    totalMatches: baseHistoricalGW,
    gf: 10,
    ga: 10,
    cs: 2,
    xg: 10,
    xgc: 10,
    homeMatches: 3,
    homeGf: 5,
    homeGa: 4,
    homeXg: 5,
    homeXgc: 4,
    awayMatches: 3,
    awayGf: 4,
    awayGa: 5,
    awayXg: 4,
    awayXgc: 5,
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
  const aStats: ClubSplitStats = statsMap[awayShort] || {
    id: 0,
    name: awayShort,
    short: awayShort,
    totalMatches: baseHistoricalGW,
    gf: 10,
    ga: 10,
    cs: 2,
    xg: 10,
    xgc: 10,
    homeMatches: 3,
    homeGf: 5,
    homeGa: 4,
    homeXg: 5,
    homeXgc: 4,
    awayMatches: 3,
    awayGf: 4,
    awayGa: 5,
    awayXg: 4,
    awayXgc: 5,
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

  const hTotM = Math.max(hStats.totalMatches || baseHistoricalGW, 1);
  const aTotM = Math.max(aStats.totalMatches || baseHistoricalGW, 1);
  const leagueAvgGoals = Math.max(1.35, (leagueAvgHomeGoals + leagueAvgAwayGoals) / 2);

  // 1. Empirical Bayes Prior & Horizon-Regressed Shrinkage (K = 3.5 + mild horizon mean reversion)
  const dist = Math.max(0, (gw ?? baseHistoricalGW + 1) - (baseHistoricalGW + 1));
  const horizonKAdd = Math.min(1.5, dist * 0.05);
  const effK = 3.5 + horizonKAdd;

  const hAttRaw = 0.72 * (hStats.xg / hTotM) + 0.28 * (hStats.gf / hTotM);
  const hDefRaw = 0.78 * (hStats.xgc / hTotM) + 0.22 * (hStats.ga / hTotM);
  const aAttRaw = 0.72 * (aStats.xg / aTotM) + 0.28 * (aStats.gf / aTotM);
  const aDefRaw = 0.78 * (aStats.xgc / aTotM) + 0.22 * (aStats.ga / aTotM);

  const hSeasonAtt = (hTotM * hAttRaw + effK * leagueAvgGoals) / ((hTotM + effK) * leagueAvgGoals);
  const hSeasonDef = (hTotM * hDefRaw + effK * leagueAvgGoals) / ((hTotM + effK) * leagueAvgGoals);
  const aSeasonAtt = (aTotM * aAttRaw + effK * leagueAvgGoals) / ((aTotM + effK) * leagueAvgGoals);
  const aSeasonDef = (aTotM * aDefRaw + effK * leagueAvgGoals) / ((aTotM + effK) * leagueAvgGoals);

  // 2. Home/Away Split Shrinkage (protects against 5-match home/away sample variance)
  const hM = Math.max(hStats.homeMatches || 1, 1);
  const aM = Math.max(aStats.awayMatches || 1, 1);
  const splitShrink = 7.0 + horizonKAdd * 0.5;
  const hSplitAttRaw = 0.72 * (hStats.homeXg / hM) + 0.28 * (hStats.homeGf / hM);
  const aSplitDefRaw = 0.75 * (aStats.awayXgc / aM) + 0.25 * (aStats.awayGa / aM);
  const aSplitAttRaw = 0.72 * (aStats.awayXg / aM) + 0.28 * (aStats.awayGf / aM);
  const hSplitDefRaw = 0.75 * (hStats.homeXgc / hM) + 0.25 * (hStats.homeGa / hM);

  const hSplitAtt = (hM * hSplitAttRaw + splitShrink * leagueAvgHomeGoals) / ((hM + splitShrink) * leagueAvgHomeGoals);
  const aSplitDef = (aM * aSplitDefRaw + splitShrink * leagueAvgHomeGoals) / ((aM + splitShrink) * leagueAvgHomeGoals);
  const aSplitAtt = (aM * aSplitAttRaw + splitShrink * leagueAvgAwayGoals) / ((aM + splitShrink) * leagueAvgAwayGoals);
  const hSplitDef = (hM * hSplitDefRaw + splitShrink * leagueAvgAwayGoals) / ((hM + splitShrink) * leagueAvgAwayGoals);

  let effHomeAtt = 0.80 * hSeasonAtt + 0.20 * hSplitAtt;
  let effAwayDef = 0.80 * aSeasonDef + 0.20 * aSplitDef;
  let effAwayAtt = 0.80 * aSeasonAtt + 0.20 * aSplitAtt;
  let effHomeDef = 0.80 * hSeasonDef + 0.20 * hSplitDef;

  // 3. Horizon-Decayed Recency Form Smoothing (Max 8% weight in GW N+1, decaying cleanly down-horizon)
  const recWeightCap = 0.08 * Math.exp(-dist * 0.14);
  if (recWeightCap > 0.01) {
    if (hStats.recentHomeWeight > 0) {
      const rHW = hStats.recentHomeWeight;
      const rw = Math.min(recWeightCap, recWeightCap * (rHW / 4));
      const recHomeAtt = (0.72 * (hStats.recentHomeXg / rHW) + 0.28 * (hStats.recentHomeGf / rHW)) / leagueAvgHomeGoals;
      effHomeAtt = Math.max(0.68, rw * recHomeAtt + (1 - rw) * effHomeAtt);
    }
    if (aStats.recentAwayWeight > 0) {
      const rAW = aStats.recentAwayWeight;
      const rw = Math.min(recWeightCap, recWeightCap * (rAW / 4));
      const recAwayDef = (0.75 * (aStats.recentAwayXgc / rAW) + 0.25 * (aStats.recentAwayGa / rAW)) / leagueAvgHomeGoals;
      effAwayDef = Math.max(0.68, rw * recAwayDef + (1 - rw) * effAwayDef);
    }
    if (aStats.recentAwayWeight > 0) {
      const rAW = aStats.recentAwayWeight;
      const rw = Math.min(recWeightCap, recWeightCap * (rAW / 4));
      const recAwayAtt = (0.72 * (aStats.recentAwayXg / rAW) + 0.28 * (aStats.recentAwayGf / rAW)) / leagueAvgAwayGoals;
      effAwayAtt = Math.max(0.64, rw * recAwayAtt + (1 - rw) * effAwayAtt);
    }
    if (hStats.recentHomeWeight > 0) {
      const rHW = hStats.recentHomeWeight;
      const rw = Math.min(recWeightCap, recWeightCap * (rHW / 4));
      const recHomeDef = (0.75 * (hStats.recentHomeXgc / rHW) + 0.25 * (hStats.recentHomeGa / rHW)) / leagueAvgAwayGoals;
      effHomeDef = Math.max(0.64, rw * recHomeDef + (1 - rw) * effHomeDef);
    }
  }

  // 4. Match Lambdas calibrated directly to empirical PL goal rates (~1.53 H / ~1.20 A) + lineup attack/defense sync
  const plLeagueTempoScale = 0.995;
  let lambdaH = leagueAvgHomeGoals * effHomeAtt * effAwayDef * homeLineupAttMod * awayLineupDefMod * plLeagueTempoScale;
  let lambdaA = leagueAvgAwayGoals * effAwayAtt * effHomeDef * awayLineupAttMod * homeLineupDefMod * plLeagueTempoScale;

  // Keep within mathematically sound football bounds
  lambdaH = Math.min(Math.max(lambdaH, 0.55), 2.65);
  lambdaA = Math.min(Math.max(lambdaA, 0.42), 2.35);

  const seedKey = `${gw ?? 0}:${homeShort}:${awayShort}`;
  const score = calculatePoissonScore(lambdaH, lambdaA, seedKey);
  const homeCsProbRaw = Math.exp(-lambdaA);
  const awayCsProbRaw = Math.exp(-lambdaH);
  const homeCsProb = Math.round(homeCsProbRaw * 100);
  const awayCsProb = Math.round(awayCsProbRaw * 100);

  const homeExpGcPenalty = calculateExpectedGcPenalty(lambdaA);
  const awayExpGcPenalty = calculateExpectedGcPenalty(lambdaH);

  return {
    lambdaH,
    lambdaA,
    homeGoals: score.homeGoals,
    awayGoals: score.awayGoals,
    homeCsProb,
    awayCsProb,
    homeCsProbRaw,
    awayCsProbRaw,
    homeExpGcPenalty,
    awayExpGcPenalty
  };
}

/**
 * Calculates comprehensive Player Expected Points (xP) for a matchday
 * incorporates non-linear appearance probability, dead-ball duties, and true Poisson clean sheet & concession.
 */
export interface PlayerExpectedPointsInput {
  pos: PositionType;
  costMil: number;
  starterIndexProb: number; // 0..1 (from SI)
  isInjuredOrOut: boolean;
  starterMins: number; // e.g. 74..86
  teamLambda: number;
  oppLambda: number;
  csProb: number; // 0..1
  expGcPenalty: number; // discrete Poisson penalty
  playerGoalShare: number; // Bayesian shrinkage postXg90 / teamXg
  playerAssistShare: number; // Bayesian shrinkage postXa90 / teamXg
  isPrimaryPen: boolean;
  isSecondaryPen: boolean;
  isFkTaker: boolean;
  isCornerTaker: boolean;
  pDc: number; // DefCon rate fallback
  dcPer90?: number; // Actual per-90 CBIT/CBIRT defensive contribution rate
  isHome: boolean;
  formDelta: number;
  regressionBounce: number;
  threatPer90?: number;
  creativityPer90?: number;
  influencePer90?: number;
  bpsPer90?: number;
  savesPer90?: number;
  yellowsPer90?: number;
  subAppRate?: number; // Empirical probability of substitute appearance given not starting
  horizonOffset?: number;
  provenGuard?: {
    guardFactor: number;
    maxBlankDropPenalty: number;
    provenXpFloor: number;
    isProven?: boolean;
    tier?: string;
  };
}

export function calculatePlayerMatchExpectedPoints(input: PlayerExpectedPointsInput): {
  xpTotal: number;
  baseXp: number;
  spikeMod: number;
  expBonus: number;
} {
  const {
    pos,
    starterIndexProb,
    isInjuredOrOut,
    starterMins,
    teamLambda,
    oppLambda,
    csProb,
    expGcPenalty,
    playerGoalShare,
    playerAssistShare,
    isPrimaryPen,
    isSecondaryPen,
    isFkTaker,
    isCornerTaker,
    pDc,
    dcPer90 = 0,
    formDelta,
    regressionBounce,
    threatPer90 = 0,
    creativityPer90 = 0,
    influencePer90 = 0,
    bpsPer90 = 0,
    savesPer90 = 0,
    yellowsPer90 = 0,
    subAppRate,
    horizonOffset = 0,
    provenGuard
  } = input;

  if (isInjuredOrOut || starterIndexProb <= 0) {
    return { xpTotal: 0, baseXp: 0, spikeMod: 0, expBonus: 0 };
  }

  // 1. Continuous Non-linear Probability of 60+ minutes & Appearance Points
  // Nailed 85+ min starters complete 60+ mins ~97.5-98.5% of starts; GKPs ~99%.
  const isStarter = starterIndexProb >= 0.70;
  const minsFactor60 =
    pos === 'GKP'
      ? 0.99
      : Math.min(0.985, Math.max(0.86, (starterMins - 54) / 30));
  const pPlay60 = isStarter
    ? Math.min(0.985, starterIndexProb * minsFactor60)
    : Math.max(0.002, starterIndexProb * minsFactor60 * Math.pow(starterIndexProb / 0.70, 1.15));

  const fallbackSubRate =
    pos === 'GKP'
      ? 0.01
      : starterIndexProb >= 0.50
      ? 0.30
      : starterIndexProb >= 0.18
      ? 0.16
      : 0.02;
  const effSubRate = typeof subAppRate === 'number' ? Math.max(0.01, Math.min(0.55, subAppRate)) : fallbackSubRate;
  const pPlayAny = Math.min(1.0, starterIndexProb + (1 - starterIndexProb) * effSubRate);
  const expAppearance = pPlay60 * 2.0 + Math.max(0, pPlayAny - pPlay60) * 1.0;

  // Expected Minutes
  const effStarterMins = pos === 'GKP' && isStarter ? 90 : starterMins;
  const xMins = pPlay60 * effStarterMins + Math.max(0, pPlayAny - pPlay60) * (pos === 'GKP' ? 5 : 16);

  // 2. Dead-Ball & Goal/Assist Adjustments (mild tie-breakers only; postXg90/postXa90 already capture observed pens & set pieces)
  let penXgBoost = 0;
  if (isPrimaryPen) {
    penXgBoost = Math.max(0.01, 0.032 - playerGoalShare * 0.04) * (teamLambda / 1.4);
  } else if (isSecondaryPen) {
    penXgBoost = Math.max(0.004, 0.010 - playerGoalShare * 0.02) * (teamLambda / 1.4);
  }

  let setPieceXaBoost = 0;
  if (isCornerTaker && isFkTaker) setPieceXaBoost = 0.022 * (teamLambda / 1.4);
  else if (isCornerTaker || isFkTaker) setPieceXaBoost = 0.014 * (teamLambda / 1.4);

  let aerialThreatBoost = 0;
  let chanceCreationBoost = 0;
  if (pos === 'DEF') {
    aerialThreatBoost = Math.min(0.03, (threatPer90 / 250) * 0.03);
    chanceCreationBoost = Math.min(0.03, (creativityPer90 / 250) * 0.03);
  } else if (pos === 'MID' || pos === 'FWD') {
    aerialThreatBoost = Math.min(0.015, (threatPer90 / 350) * 0.015);
    chanceCreationBoost = Math.min(0.02, (creativityPer90 / 300) * 0.02);
  }

  const goalShareLimit = pos === 'FWD' && (isPrimaryPen || provenGuard?.tier === 'ELITE')
    ? 0.60
    : pos === 'MID' && provenGuard?.tier === 'ELITE'
    ? 0.52
    : pos === 'FWD'
    ? 0.54
    : pos === 'MID'
    ? 0.48
    : 0.22;
  const effectiveGoalShare = Math.min(goalShareLimit, playerGoalShare + aerialThreatBoost + (penXgBoost / Math.max(teamLambda, 0.5)));
  const effectiveAssistShare = Math.min(0.42, playerAssistShare + chanceCreationBoost + (setPieceXaBoost / Math.max(teamLambda, 0.5)));

  // FPL assists include penalties won & rebounds (~1.08x Opta xA share); FWD strikers slightly outpace team-shrunk goal share
  const posGoalScale = pos === 'FWD' ? 1.06 : 1.0;
  const expGoals = teamLambda * posGoalScale * effectiveGoalShare * (xMins / 90);
  const expAssists = teamLambda * 1.08 * effectiveAssistShare * (xMins / 90);

  const goalPts = expGoals * (pos === 'FWD' ? 4 : pos === 'MID' ? 5 : 6);
  const assistPts = expAssists * 3.0;

  // 3. Clean Sheet & Goals Conceded (Discrete Poisson)
  const eligibleCsProb = pPlay60 * csProb;
  const csPts = (pos === 'GKP' || pos === 'DEF') ? eligibleCsProb * 4.0 : pos === 'MID' ? eligibleCsProb * 1.0 : 0;
  const gcPenalty = (pos === 'GKP' || pos === 'DEF') ? -(pPlay60 * expGcPenalty) : 0;

  // 4. Defensive Contribution (+2 pts at CBIT >= 10 DEF / CBIRT >= 12 MID & FWD; GKP ineligible)
  let defConPts = 0;
  if (pos !== 'GKP') {
    if (dcPer90 > 0) {
      const dcThreshold = pos === 'DEF' ? 10 : 12;
      const oppActivityScale = Math.min(1.18, Math.max(0.86, Math.pow(Math.max(oppLambda, 0.5) / 1.35, 0.20)));
      const expDcMatch = dcPer90 * (effStarterMins / 90) * oppActivityScale;
      const probHitDc = defConTailProb(expDcMatch, dcThreshold);
      defConPts = Math.min(1.90, pPlay60 * 2.0 * probHitDc);
    } else {
      // Unobserved sample prior (GW 1 / new transfer) calibrated to PL averages
      defConPts = pos === 'DEF'
        ? pPlay60 * Math.max(0.45, pDc * 1.15)
        : pos === 'MID'
        ? pPlay60 * Math.max(0.22, pDc * 0.90)
        : pPlay60 * 0.02;
    }
  }

  // Goalkeeper Saves: discrete expectation sum_{k=3}^12 floor(k/3) * Poisson(expSaves, k)
  let savesPts = 0;
  let expSaves = 0;
  if (pos === 'GKP') {
    const expShotsOnTarget = oppLambda * 3.55;
    const historicalSaves = savesPer90 > 0 ? savesPer90 : 3.2;
    expSaves = Math.max(1.6, 0.55 * historicalSaves + 0.45 * (expShotsOnTarget * 0.78));
    let expSavePtsUnit = 0;
    for (let k = 3; k <= 12; k++) {
      expSavePtsUnit += Math.floor(k / 3) * poissonProb(expSaves, k);
    }
    savesPts = pPlay60 * expSavePtsUnit;
  }

  // 5. Dynamic Bonus Point System (BPS) Modeling
  // Calibrated to official FPL BPS tournament dynamics (top-3 winner-take-most)
  const starterBpsPresence = Math.pow(pPlay60, 1.55);
  let expBonusRaw = 0;
  if (pos === 'GKP') {
    const gkpBpsMod = bpsPer90 > 0 ? Math.min(1.6, Math.max(0.60, bpsPer90 / 16.5)) : 1.0;
    expBonusRaw = (eligibleCsProb * 0.56 * gkpBpsMod) + starterBpsPresence * (expSaves >= 4 ? 0.42 : 0.22) * gkpBpsMod;
  } else if (pos === 'DEF') {
    const defBpsMod = bpsPer90 > 0 ? Math.min(1.85, Math.max(0.40, bpsPer90 / 16)) : 0.85;
    expBonusRaw = (eligibleCsProb * 0.45 * defBpsMod) + expGoals * 1.25 + expAssists * 0.65;
  } else {
    const goalBpsWeight = pos === 'FWD' ? 2.05 : 1.40;
    const attBpsMod = (bpsPer90 > 0 ? Math.pow(bpsPer90 / 23, 2.0) * (pos === 'FWD' ? 0.28 : 0.18) : 0.08) * starterBpsPresence;
    expBonusRaw = expGoals * goalBpsWeight + expAssists * 0.65 + attBpsMod;
  }
  const bonusPts = Math.min(expBonusRaw, pos === 'FWD' ? 2.6 : pos === 'MID' ? 2.2 : 1.7);

  // 6. Individual Disciplinary Card Penalty
  const cardRate = yellowsPer90 > 0 ? Math.max(0.04, Math.min(0.32, yellowsPer90 * 0.28)) : (pos === 'DEF' ? 0.14 : 0.10);
  const cardPenalty = -(xMins / 90) * cardRate;

  const rawMatchXp = expAppearance + goalPts + assistPts + csPts + gcPenalty + defConPts + savesPts + bonusPts + cardPenalty;
  const baseXp = Math.max(0.0, Math.round(rawMatchXp * 10) / 10);

  // 7. Gentle Horizon-Decayed Form & Proven Reliability (without letting 3-GW noise overpower base xP)
  const offset = Math.max(0, horizonOffset);
  const formDecay = Math.pow(0.72, offset);
  const regDecay = Math.pow(0.65, offset);

  let effectiveFormDelta = formDelta * formDecay;
  if (effectiveFormDelta < 0 && provenGuard && provenGuard.guardFactor > 0) {
    const softenedDelta = effectiveFormDelta * (1 - provenGuard.guardFactor);
    effectiveFormDelta = Math.max(softenedDelta, provenGuard.maxBlankDropPenalty);
  }
  const decayedRegressionBounce = regressionBounce * regDecay;

  let provenReliabilityBoost = 0.0;
  if (provenGuard?.isProven && isStarter && !isInjuredOrOut) {
    const baseBoost = provenGuard.tier === 'ELITE' ? 0.28 : 0.14;
    const taperBenchmark = (pos === 'DEF' || pos === 'GKP') ? 4.4 : 5.6;
    const taper = Math.max(0, baseXp - taperBenchmark) * 0.08;
    provenReliabilityBoost = Math.max(0.08, baseBoost - taper);
  }
  const spikePlayScale = Math.min(1.0, Math.max(0.04, xMins / 72));
  const rawSpike = (effectiveFormDelta + decayedRegressionBounce + provenReliabilityBoost) * spikePlayScale;
  const spikeMod = Math.round(Math.max(-0.5, Math.min(0.6, rawSpike)) * 10) / 10;

  const xpTotal = Math.max(0.0, Math.round((baseXp + spikeMod) * 10) / 10);

  return { xpTotal, baseXp, spikeMod, expBonus: Number(bonusPts.toFixed(3)) };
}

// ============================================================================
// DYNAMIC RECENCY-WEIGHTED FORMATION MODEL
// ============================================================================
export interface FormationTarget {
  DEF: number;
  MID: number;
  FWD: number;
  [key: string]: number;
}

/**
 * Extracts historical starter formation counts (DEF, MID, FWD, GKP) per club per completed GW
 */
export function getClubFormationsHistory(
  upToGw: number,
  playerStatsList: DbPlayerStat[],
  precalcPlayers: Record<string, Record<string, { wasStarter?: boolean }>>,
  matchesByGW?: Record<number, any[]>
): Record<string, Record<number, { DEF: number; MID: number; FWD: number; GKP: number }>> {
  const history: Record<string, Record<number, { DEF: number; MID: number; FWD: number; GKP: number }>> = {};
  const playerPosMap = new Map<number, PositionType>();
  const playerTeamMap = new Map<number, string>();

  for (const p of playerStatsList) {
    playerPosMap.set(p.id, p.position as PositionType);
    playerTeamMap.set(p.id, p.teamShort);
  }

  const coveredFromLive = new Set<string>();
  if (matchesByGW) {
    for (let gw = 1; gw <= upToGw; gw++) {
      const matches = matchesByGW[gw] || [];
      for (const m of matches) {
        const ingestSide = (teamShort: string | undefined, lineup: any[]) => {
          if (!teamShort || !Array.isArray(lineup) || lineup.length === 0) return;
          const covKey = `${teamShort}_${gw}`;
          // Guard against DGW clubs summing two matches into 22 starters in a single GW
          if (coveredFromLive.has(covKey)) return;
          coveredFromLive.add(covKey);
          if (!history[teamShort]) history[teamShort] = {};
          if (!history[teamShort][gw]) history[teamShort][gw] = { DEF: 0, MID: 0, FWD: 0, GKP: 0 };
          for (const lp of lineup) {
            const pos = (lp?.position || playerPosMap.get(lp?.id) || 'MID') as PositionType;
            history[teamShort][gw][pos] = (history[teamShort][gw][pos] || 0) + 1;
          }
        };
        ingestSide(m?.home_team?.short_name, m?.home_lineup);
        ingestSide(m?.away_team?.short_name, m?.away_lineup);
      }
    }
  }

  for (let gw = 1; gw <= upToGw; gw++) {
    for (const [pIdStr, gwMap] of Object.entries(precalcPlayers)) {
      const pId = Number(pIdStr);
      const team = playerTeamMap.get(pId);
      if (!team || coveredFromLive.has(`${team}_${gw}`)) continue;
      const stat = gwMap[gw];
      if (stat?.wasStarter) {
        if (!history[team]) history[team] = {};
        if (!history[team][gw]) history[team][gw] = { DEF: 0, MID: 0, FWD: 0, GKP: 0 };
        const pos = playerPosMap.get(pId) || 'MID';
        history[team][gw][pos] = (history[team][gw][pos] || 0) + 1;
      }
    }
  }

  return history;
}

/**
 * Calculates recency-weighted formation prior for a club entering targetGw
 * GW N-1: 50%
 * GW N-2: 30%
 * Historical aggregate (GW <= N-3): 20%
 */
export function getRecencyWeightedFormationPrior(
  teamShort: string,
  targetGw: number,
  clubHistory: Record<string, Record<number, { DEF: number; MID: number; FWD: number }>>
): FormationTarget {
  const teamHist = clubHistory[teamShort] || {};
  const prevGws = Object.keys(teamHist)
    .map(Number)
    .filter((g) => g < targetGw)
    .sort((a, b) => b - a);

  if (prevGws.length === 0) {
    return { DEF: 4.0, MID: 4.5, FWD: 1.5 };
  }
  if (prevGws.length === 1) {
    const f1 = teamHist[prevGws[0]];
    return { DEF: f1.DEF, MID: f1.MID, FWD: f1.FWD };
  }
  if (prevGws.length === 2) {
    const f1 = teamHist[prevGws[0]];
    const f2 = teamHist[prevGws[1]];
    return {
      DEF: Number((0.65 * f1.DEF + 0.35 * f2.DEF).toFixed(2)),
      MID: Number((0.65 * f1.MID + 0.35 * f2.MID).toFixed(2)),
      FWD: Number((0.65 * f1.FWD + 0.35 * f2.FWD).toFixed(2))
    };
  }

  const f1 = teamHist[prevGws[0]];
  const f2 = teamHist[prevGws[1]];
  const olderGws = prevGws.slice(2);
  let sumDef = 0;
  let sumMid = 0;
  let sumFwd = 0;
  for (const ogw of olderGws) {
    sumDef += teamHist[ogw].DEF;
    sumMid += teamHist[ogw].MID;
    sumFwd += teamHist[ogw].FWD;
  }
  const olderCount = Math.max(1, olderGws.length);

  return {
    DEF: Number((0.50 * f1.DEF + 0.30 * f2.DEF + 0.20 * (sumDef / olderCount)).toFixed(2)),
    MID: Number((0.50 * f1.MID + 0.30 * f2.MID + 0.20 * (sumMid / olderCount)).toFixed(2)),
    FWD: Number((0.50 * f1.FWD + 0.30 * f2.FWD + 0.20 * (sumFwd / olderCount)).toFixed(2))
  };
}

