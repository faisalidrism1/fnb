import { PositionType, DbPlayerStat } from '../types.ts';
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json';

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

function fnvMixHash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function seededPrng(seed: number): () => number {
  let a = seed >>> 0;
  const step = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 4; i++) step();
  return step;
}

/**
 * Calculates projected match score from the joint Bivariate Poisson probability
 * distribution P(H=h, A=a), strictly aligned with expected goals (lambdaH/lambdaA)
 * and Clean Sheet probabilities so projected winners and goal counts never contradict xG/CS%.
 */
export function calculatePoissonScore(
  lambdaH: number,
  lambdaA: number,
  seedKey?: string
): { homeGoals: number; awayGoals: number } {
  const rho = Math.min(lambdaH, lambdaA) * 0.02;
  const l1 = Math.max(0.05, lambdaH - rho);
  const l2 = Math.max(0.05, lambdaA - rho);
  const maxG = 6;

  const p1 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(l1, k));
  const p2 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(l2, k));
  const p3 = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(rho, k));

  const grid: Array<{ h: number; a: number; jointP: number }> = [];

  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      let jointP = 0;
      const minHA = Math.min(h, a);
      for (let s = 0; s <= minHA; s++) {
        jointP += p1[h - s] * p2[a - s] * p3[s];
      }
      grid.push({ h, a, jointP });
    }
  }

  const diff = lambdaH - lambdaA;

  const matchesDirection = (h: number, a: number): boolean => {
    if (diff >= 0.28) return h > a;
    if (diff <= -0.28) return a > h;
    if (diff >= 0.08) return h >= a;
    if (diff <= -0.08) return a >= h;
    return Math.abs(h - a) <= 1;
  };

  let candidates = grid.filter((o) => {
    if (!matchesDirection(o.h, o.a)) return false;

    // Keep each team's projected goals tightly anchored to its expected goals (xG)
    if (Math.abs(o.h - lambdaH) > 1.25 || Math.abs(o.a - lambdaA) > 1.25) return false;
    if (o.h === 0 && lambdaH >= 1.55) return false;
    if (o.a === 0 && lambdaA >= 1.55) return false;
    if (o.h >= 2 && lambdaH < 1.20) return false;
    if (o.a >= 2 && lambdaA < 1.20) return false;
    if (o.h >= 3 && lambdaH < 2.00) return false;
    if (o.a >= 3 && lambdaA < 2.00) return false;
    if (o.h >= 4 && lambdaH < 2.55) return false;
    if (o.a >= 4 && lambdaA < 2.55) return false;

    // Keep winning margin proportional to xG gap
    if (o.h - o.a >= 2 && diff < 0.45) return false;
    if (o.a - o.h >= 2 && diff > -0.45) return false;
    if (o.h - o.a >= 3 && diff < 1.20) return false;
    if (o.a - o.h >= 3 && diff > -1.20) return false;
    if (o.h - o.a >= 4 && diff < 1.75) return false;
    if (o.a - o.h >= 4 && diff > -1.75) return false;

    // Prevent unrealistic 0-0 in high-xG matches or inflated high-scoring draws
    if (o.h === 0 && o.a === 0 && lambdaH + lambdaA >= 2.65) return false;
    if (o.h >= 2 && o.h === o.a && (lambdaH < 1.50 || lambdaA < 1.50)) return false;

    return true;
  });

  if (candidates.length === 0) {
    candidates = grid.filter((o) => matchesDirection(o.h, o.a));
  }

  candidates.sort((a, b) => b.jointP - a.jointP);
  const topAlignedP = candidates[0]?.jointP ?? 0;
  const tightBand = candidates.filter((o) => o.jointP >= topAlignedP * 0.55);
  const pool = tightBand.length > 0 ? tightBand : candidates;

  let totalWeight = 0;
  const outcomes = pool.map((o) => {
    const w = Math.pow(o.jointP, 1.35);
    totalWeight += w;
    return { h: o.h, a: o.a, w };
  });

  const key = seedKey || `${lambdaH.toFixed(3)}:${lambdaA.toFixed(3)}`;
  const rand = seededPrng(fnvMixHash(key));
  const u = rand() * totalWeight;
  let cum = 0;
  for (const o of outcomes) {
    cum += o.w;
    if (u <= cum) {
      return { homeGoals: o.h, awayGoals: o.a };
    }
  }

  return {
    homeGoals: outcomes[0]?.h ?? Math.round(lambdaH),
    awayGoals: outcomes[0]?.a ?? Math.round(lambdaA)
  };
}

/**
 * Parses return date from FPL news string (e.g. "Expected back 1 Nov", "Suspended until 31 Oct")
 */
export function parseExpectedReturnDate(news?: string): Date | null {
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
  const year = m <= 5 ? 2027 : 2026;
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
    if (splitMatchTotal >= baseHistoricalGW && splitMatchTotal > 0) {
      st.totalMatches = splitMatchTotal;
      st.gf = st.homeGf + st.awayGf;
      st.ga = st.homeGa + st.awayGa;
    }
    const mCount = Math.max(st.totalMatches, 1);
    const seasonAttPerMatch = Math.max(0.7, (st.xg * 0.65 + st.gf * 0.35) / mCount);
    const seasonDefPerMatch = Math.max(0.7, (st.xgc * 0.65 + st.ga * 0.35) / mCount);

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
 * Calculates Fixture Projection (Lambda, Clean Sheet odds, and Expected Goals Conceded penalty)
 * using Home/Away Splits, Recency Form Weighting, Lineup Attack Sync, and Bivariate Poisson Simulation.
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
  awayLineupAttMod: number = 1.0
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

  // 4. Match Lambdas calibrated at 380-match PL aggregate (~1,035–1,085 goals, ~195–215 CS) + lineup attack sync
  const plLeagueTempoScale = 1.055;
  let lambdaH = leagueAvgHomeGoals * effHomeAtt * effAwayDef * homeLineupAttMod * plLeagueTempoScale;
  let lambdaA = leagueAvgAwayGoals * effAwayAtt * effHomeDef * awayLineupAttMod * plLeagueTempoScale;

  // Keep within mathematically sound football bounds
  lambdaH = Math.min(Math.max(lambdaH, 0.58), 2.68);
  lambdaA = Math.min(Math.max(lambdaA, 0.42), 2.38);

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
  pDc: number; // DefCon rate
  isHome: boolean;
  formDelta: number;
  regressionBounce: number;
  threatPer90?: number;
  creativityPer90?: number;
  influencePer90?: number;
  bpsPer90?: number;
  savesPer90?: number;
  yellowsPer90?: number;
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
    isHome,
    formDelta,
    regressionBounce,
    threatPer90 = 0,
    creativityPer90 = 0,
    influencePer90 = 0,
    bpsPer90 = 0,
    savesPer90 = 0,
    yellowsPer90 = 0,
    horizonOffset = 0,
    provenGuard
  } = input;

  if (isInjuredOrOut || starterIndexProb <= 0) {
    return { xpTotal: 0, baseXp: 0, spikeMod: 0 };
  }

  // 1. Continuous Non-linear Probability of 60+ minutes & Appearance Points
  const isStarter = starterIndexProb >= 0.70;
  const pPlay60 = isStarter
    ? Math.min(0.95, starterIndexProb * 0.94)
    : Math.max(0.02, 0.94 * starterIndexProb * Math.pow(starterIndexProb / 0.70, 0.45));

  const pPlayAny = Math.min(1.0, starterIndexProb + (1 - starterIndexProb) * (pos === 'GKP' ? 0.02 : 0.32));
  const expAppearance = pPlay60 * 2.0 + Math.max(0, pPlayAny - pPlay60) * 1.0;

  // Expected Minutes
  const xMins = pPlay60 * starterMins + Math.max(0, pPlayAny - pPlay60) * (pos === 'GKP' ? 5 : 20);

  // 2. Dead-Ball & Goal/Assist Adjustments using Threat & Creativity
  // For players with high historical goal share, penalty duties are already largely baked into their xG.
  let penXgBoost = 0;
  if (isPrimaryPen) {
    penXgBoost = Math.max(0.02, 0.08 - playerGoalShare * 0.12) * (teamLambda / 1.4);
  } else if (isSecondaryPen) {
    penXgBoost = Math.max(0.01, 0.03 - playerGoalShare * 0.05) * (teamLambda / 1.4);
  }

  let setPieceXaBoost = 0;
  if (isCornerTaker && isFkTaker) setPieceXaBoost = 0.06 * (teamLambda / 1.4);
  else if (isCornerTaker || isFkTaker) setPieceXaBoost = 0.04 * (teamLambda / 1.4);

  // Aerial threat (e.g. Gabriel, Tarkowski, Van Dijk) & Crossing creativity (e.g. Porro, Robinson, Digne)
  let aerialThreatBoost = 0;
  let chanceCreationBoost = 0;
  if (pos === 'DEF') {
    aerialThreatBoost = Math.min(0.12, (threatPer90 / 200) * 0.15);
    chanceCreationBoost = Math.min(0.14, (creativityPer90 / 180) * 0.18);
  } else if (pos === 'MID' || pos === 'FWD') {
    aerialThreatBoost = Math.min(0.04, (threatPer90 / 250) * 0.05);
    chanceCreationBoost = Math.min(0.04, (creativityPer90 / 200) * 0.05);
  }

  // Calibrated goal share limit
  const goalShareLimit = pos === 'FWD' && (isPrimaryPen || provenGuard?.tier === 'ELITE')
    ? 0.54
    : pos === 'MID' && provenGuard?.tier === 'ELITE'
    ? 0.48
    : (pos === 'FWD' || pos === 'MID') ? 0.46 : 0.22;
  const effectiveGoalShare = Math.min(goalShareLimit, playerGoalShare + aerialThreatBoost + (penXgBoost / Math.max(teamLambda, 0.5)));
  const effectiveAssistShare = Math.min(0.35, playerAssistShare + chanceCreationBoost + (setPieceXaBoost / Math.max(teamLambda, 0.5)));

  const expGoals = teamLambda * effectiveGoalShare * (xMins / 90);
  const expAssists = teamLambda * 0.75 * effectiveAssistShare * (xMins / 90);

  const goalPts = expGoals * (pos === 'FWD' ? 4 : pos === 'MID' ? 5 : 6);
  const assistPts = expAssists * 3.0;

  // 3. Clean Sheet & Goals Conceded (Discrete Poisson)
  const eligibleCsProb = pPlay60 * csProb;
  const csPts = (pos === 'GKP' || pos === 'DEF') ? eligibleCsProb * 4.0 : pos === 'MID' ? eligibleCsProb * 1.0 : 0;
  const gcPenalty = (pos === 'GKP' || pos === 'DEF') ? -(pPlay60 * expGcPenalty) : 0;

  // 4. Defensive Contribution (Influence CBI) & Goalkeeper Shot-Stopping Saves
  // CBs with high clearances/blocks/interceptions have high influence (e.g., Gabriel, Saliba, Tarkowski)
  const influenceFactor = influencePer90 > 0 ? Math.min(0.45, (influencePer90 / 25) * 0.35) : pDc * 0.35;
  const defConPts = pos === 'DEF' ? pPlay60 * influenceFactor : pos === 'MID' ? pPlay60 * (influenceFactor * 0.5) : 0;

  // Goalkeepers face shots proportional to opponent attack lambda, blended with player's actual save rate
  const expShotsOnTarget = oppLambda * 2.8;
  const historicalSaves = savesPer90 > 0 ? savesPer90 : 2.5;
  const expSaves = pos === 'GKP' ? Math.max(1.2, 0.45 * historicalSaves + 0.55 * (expShotsOnTarget * 0.65)) : 0;
  const savesPts = pos === 'GKP' ? pPlay60 * (expSaves / 3.0) : 0;

  // 5. Dynamic Bonus Point System (BPS) Modeling
  // Players with higher baseline BPS (CBs winning duels, creative FBs, shot-stopping GKPs) earn distinct bonus
  const minsScale = Math.min(1.0, xMins / 78);
  let expBonus = 0;
  if (pos === 'GKP') {
    const gkpBpsMod = bpsPer90 > 0 ? Math.min(1.5, Math.max(0.4, bpsPer90 / 18)) : 1.0;
    expBonus = (eligibleCsProb * 0.25 * gkpBpsMod) + pPlay60 * (expSaves >= 4 ? 0.30 : 0.08);
  } else if (pos === 'DEF') {
    const defBpsMod = bpsPer90 > 0 ? Math.min(1.8, Math.max(0.25, bpsPer90 / 16)) : 0.75;
    expBonus = (eligibleCsProb * 0.28 * defBpsMod) + expGoals * 1.0 + expAssists * 0.50;
  } else {
    const attBpsMod = (bpsPer90 > 0 ? (bpsPer90 / 25) * 0.12 : 0.08) * minsScale;
    expBonus = expGoals * 0.90 + expAssists * 0.45 + attBpsMod;
  }
  const bonusPts = Math.min(expBonus, pos === 'DEF' ? 1.5 : (pos === 'GKP' ? 1.2 : 2.0));

  // 6. Individual Disciplinary Card Penalty
  const cardRate = yellowsPer90 > 0 ? Math.max(0.04, Math.min(0.32, yellowsPer90 * 0.28)) : (pos === 'DEF' ? 0.12 : 0.08);
  const cardPenalty = -(xMins / 90) * cardRate;

  const rawMatchXp = expAppearance + goalPts + assistPts + csPts + gcPenalty + defConPts + savesPts + bonusPts + cardPenalty;
  const baseXp = Math.max(0.1, Math.round(rawMatchXp * 10) / 10);

  // 7. Dynamic Matchup Elasticity & Horizon-Decayed Spike Modifiers
  const offset = Math.max(0, horizonOffset);
  const formDecay = Math.pow(0.76, offset);
  const regDecay = Math.pow(0.68, offset);

  let effectiveFormDelta = formDelta * formDecay;
  if (effectiveFormDelta < 0 && provenGuard && provenGuard.guardFactor > 0) {
    const softenedDelta = effectiveFormDelta * (1 - provenGuard.guardFactor);
    effectiveFormDelta = Math.max(softenedDelta, provenGuard.maxBlankDropPenalty);
  }
  const decayedRegressionBounce = regressionBounce * regDecay;

  let matchupDelta = 0;
  if (pos === 'FWD' || pos === 'MID') {
    // Mild elasticity above linear Poisson teamLambda baseline
    matchupDelta = (teamLambda - 1.35) * 0.25 + (isHome ? 0.08 : -0.08);
  } else {
    // Mild defensive/home edge without double-counting Poisson csProb & expGcPenalty
    matchupDelta = (1.35 - oppLambda) * 0.14 + (isHome ? 0.06 : -0.06);
  }

  let provenReliabilityBoost = 0.0;
  if (provenGuard?.isProven && isStarter && !isInjuredOrOut) {
    const baseBoost = provenGuard.tier === 'ELITE' ? 0.28 : 0.15;
    const taperBenchmark = (pos === 'DEF' || pos === 'GKP') ? 3.8 : 4.5;
    const taper = Math.max(0, baseXp - taperBenchmark) * 0.12;
    provenReliabilityBoost = Math.max(0.06, baseBoost - taper);
  }
  const spikePlayScale = Math.min(1.0, Math.max(0.10, xMins / 72));
  const rawSpike = (effectiveFormDelta + decayedRegressionBounce + matchupDelta + provenReliabilityBoost) * spikePlayScale;
  const spikeMod = Math.round(Math.max(-2.2, Math.min(2.6, rawSpike)) * 10) / 10;

  let xpTotal = Math.max(0.1, Math.round((baseXp + spikeMod) * 10) / 10);

  // FPL Proven Quality Guard Floor
  if (provenGuard && provenGuard.isProven && isStarter && !isInjuredOrOut) {
    const fixtureStrengthMod = Math.min(1.15, Math.max(0.85, teamLambda / 1.35));
    const locationMod = isHome ? 1.04 : 0.96;
    const guardedFloor = Math.round(provenGuard.provenXpFloor * fixtureStrengthMod * locationMod * 10) / 10;
    xpTotal = Math.max(xpTotal, guardedFloor);
  }

  return { xpTotal, baseXp, spikeMod };
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

