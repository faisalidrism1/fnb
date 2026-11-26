import { DbPlayerStat } from '../types.ts';
import pastSeasonRaw from '../data/playersPastSeason2025_26.json';
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json';
import {
  ClubFixtureProjection,
  calculateExpectedGcPenalty,
  poissonProb,
} from './projectionModel.ts';

// ============================================================================
// CAUSAL STAGE 2 ENGINE: S1–S8 -> S9 STACKED ENSEMBLE
// Strictly downstream of Stage 1 (hybridLineupModel.ts).
// Zero data leakage, zero hardcoded club priors, zero nowCost price tiers.
//
// Pipeline:
//   S1: Time-Decay Poisson Ridge GLM + Dixon-Coles low-score rho (-0.065)
//   S2: Huber-IRLS Negative Binomial Overdispersed GLM (dispH=0.08, dispA=0.20)
//   S3: Time-Varying Elo State-Space Attack/Defense Sequential Ratings
//   S4: Skellam & Margin-Constrained Joint Scoreline Matrix
//   S5: Stage 1 Lineup, Tactical Role Affinity & <72h Fatigue Bridge
//   S6: Hierarchical Empirical Bayes Home/Away Venue Split Shrinkage
//   S7: Frank Copula Joint Attack-Defense Dependence Matrix
//   S8: 160-Point Halton Quasi-Monte Carlo Correlated Tempo Ensemble
//   S9: Stacked Probabilistic Ensemble + Stable-V2 Conditional-Residual Hungarian OT
// ============================================================================

export interface NonEplMatchScoreRecord {
  clubShort: string;
  oppShort: string;
  isHome: boolean;
  teamScore: number;
  oppScore: number;
  kickoffMs: number;
  compAbbr: string;
}

export interface Stage1BridgeTeamStats {
  /** Normalized delta of predicted XI attacking rate vs club baseline [-0.35, 0.35] */
  xiAttDelta: number;
  /** Normalized delta of predicted XI defensive solidity vs club baseline [-0.35, 0.35] */
  xiDefStrength: number;
  /** Average tactical slot compatibility of predicted Starting XI defenders/GKP [0..1] */
  minDefAff: number;
  /** Share of predicted Starting XI with <72h recovery from previous match [0..1] */
  fatigue72hShare: number;
  /** Minimum hours elapsed since club's last fixture across all competitions */
  hoursRest?: number;
  /** True if hoursRest <= 72h */
  isCongested72h?: boolean;
}

export interface MatchScoreModelContext {
  maxTrainGw: number;
  cutoffMs: number;
  clubShorts: string[];
  clubIdx: Map<string, number>;
  // S1 Poisson Ridge
  att: Float64Array;
  def: Float64Array;
  mu: number;
  homeAdv: number;
  jensenLog: number;
  s1MuCorr: number;
  empGoalsPerMatch: number;
  // S2 Negative Binomial IRLS
  nbAtt: Float64Array;
  nbDef: Float64Array;
  nbMu: number;
  nbHa: number;
  nbJensen: number;
  s2MuCorr: number;
  // S3 Time-Varying Elo State-Space
  eloAtt: Float64Array;
  eloDef: Float64Array;
  eloMu: number;
  eloHa: number;
  eloJensen: number;
  s3MuCorr: number;
  // S6 Hierarchical Empirical Bayes Venue Split
  ebAttH: Float64Array;
  ebDefH: Float64Array;
  ebAttA: Float64Array;
  ebDefA: Float64Array;
  ebMu: number;
  ebHa: number;
  ebJensen: number;
  s6MuCorr: number;
}

export interface FitCausalMatchScoreParams {
  clubs: Array<{ id: number; name: string; short: string }>;
  players: DbPlayerStat[];
  eplMatchesByGw: Record<number, any[]>;
  nonEplRecords?: NonEplMatchScoreRecord[];
  maxTrainGw: number;
  minTrainGw?: number;
  cutoffMs?: number;
}

export interface PredictDixonColesOptions {
  gw?: number;
  baseHistoricalGW?: number;
  homeStage1?: Stage1BridgeTeamStats;
  awayStage1?: Stage1BridgeTeamStats;
  /** Legacy numeric multipliers (optional override when full Stage 1 bridge stats unavailable) */
  homeAttMod?: number;
  awayAttMod?: number;
  homeDefMod?: number;
  awayDefMod?: number;
}

export interface Stage2FixtureProjection extends ClubFixtureProjection {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  isCongested72h?: boolean;
  homeCongested72h?: boolean;
  awayCongested72h?: boolean;
  stage1HomeAttMod?: number;
  stage1AwayAttMod?: number;
  stage1HomeDefMod?: number;
  stage1AwayDefMod?: number;
  scoreMatrix?: number[][];
}

const NON_EPL_SCORE_COMP_WEIGHT: Record<string, number> = {
  EU_CL: 0.45,
  EU_UC: 0.40,
  EU_CF: 0.32,
  EN_FA: 0.45,
  EN_FC: 0.15,
  EN_LC: 0.22,
};

const STRUCT = {
  halfLife: 6.5,
  l2: 2.2,
  priorScale: 1.12,
  huber: 1.25,
  wXg: 0.80,
  wThr: 0.10,
  wBps: 0.10,
  eloK: 0.065,
  eloPriorW: 1.0,
  venueShrink: 8.5,
  dispH: 0.08,
  dispA: 0.20,
  copulaTheta: 0.55,
  qmcRho: 0.16,
  dcRho: -0.065,
  wAttXi: 0.02,
  wDefXi: 0.02,
  wFatAtt: 0.03,
  wFatDef: 0.03,
  wAff: 0.03,
} as const;

// Validated walk-forward S9 Stacked Ensemble weights over S1..S8
const W_ENS = [0.08, 0.28, 0.06, 0.10, 0.14, 0.08, 0.14, 0.12] as const;

// Calibrated Bayes-Risk discrete scoreline fallback selector config (single-fixture mode)
const SCORE_SEL_CFG = {
  drawThresh: 0.035,
  dirPen: 0.58,
  exactW: 0.40,
  csBoost: 0.35,
  csThresh: 0.35,
  goalMatchW: 0.70,
  goalShift: 0.60,
} as const;

const STABLE_V2_CFG = {
  drawThresh: 0.02,
  futDrawScale: 1.04,
  hBiasScale: 0.90,
  maxG: 4,
  maeW: 0.50,
  tailFracWalk: 0.0,
  tailFracFuture: 1.0,
  clubPtsBud: 0.14,
  clubCsBud: 0.14,
} as const;

const MAX_G = 6;
const QMC_N = 160;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================================
// PRECOMPUTED 160-POINT HALTON QMC SEQUENCE (BASES 2, 3, 5)
// ============================================================================
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return clamp(result, 1e-6, 1 - 1e-6);
}

// Acklam inverse normal CDF approximation
function normInvCdf(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const QMC_SAMPLES: ReadonlyArray<{ z1: number; z2: number; u3: number }> = Array.from({ length: QMC_N }, (_, i) => ({
  z1: normInvCdf(halton(i + 1, 2)),
  z2: normInvCdf(halton(i + 1, 3)),
  u3: halton(i + 1, 5),
}));

function sumSidePlayerStat(lineup?: any[], bench?: any[], statKey: string = 'expected_goals'): number {
  let total = 0;
  if (Array.isArray(lineup)) {
    for (const lp of lineup) total += Number(lp?.stats?.[statKey] || 0);
  }
  if (Array.isArray(bench)) {
    for (const lp of bench) total += Number(lp?.stats?.[statKey] || 0);
  }
  return total;
}

/**
 * Strictly causal pre-season strength prior from 2025/26 per-90 efficiency + causal UEFA exposure.
 * Zero `nowCost`, zero future leakage.
 */
function buildCausalTeamStrengthPrior(
  clubShorts: string[],
  players: DbPlayerStat[],
  nonEplRecords: NonEplMatchScoreRecord[],
  cutoffMs: number
): { attPrior: Record<string, number>; defPrior: Record<string, number> } {
  const pastMap = pastSeasonRaw as Record<string, {
    minutes?: number;
    total_points?: number;
    goals_scored?: number;
    assists?: number;
    clean_sheets?: number;
  }>;

  const euroByClub = new Map<string, Set<string>>();
  for (const r of nonEplRecords) {
    if (r.kickoffMs >= cutoffMs || !r.clubShort) continue;
    if (r.compAbbr === 'EU_CL' || r.compAbbr === 'EU_UC' || r.compAbbr === 'EU_CF') {
      if (!euroByClub.has(r.clubShort)) euroByClub.set(r.clubShort, new Set());
      euroByClub.get(r.clubShort)!.add(r.compAbbr);
    }
  }

  const byClub: Record<string, DbPlayerStat[]> = {};
  for (const p of players) {
    if (!p?.teamShort || p.status === 'u') continue;
    if (!byClub[p.teamShort]) byClub[p.teamShort] = [];
    byClub[p.teamShort].push(p);
  }

  const rawAtt: Record<string, number> = {};
  const rawDef: Record<string, number> = {};
  let sumAtt = 0;
  let sumDef = 0;
  let cnt = 0;

  for (const short of clubShorts) {
    const clubPlayers = byClub[short] || [];
    const qual: Array<{
      pos: string;
      mins: number;
      pts90: number;
      xgi90: number;
      cs90: number;
    }> = [];

    for (const p of clubPlayers) {
      const ps = pastMap[String(p.id)];
      if (!ps || Number(ps.minutes || 0) < 600) continue;
      const mins = Number(ps.minutes || 0);
      qual.push({
        pos: p.position,
        mins,
        pts90: (Number(ps.total_points || 0) / mins) * 90,
        xgi90: ((Number(ps.goals_scored || 0) + Number(ps.assists || 0)) / mins) * 90,
        cs90: (Number(ps.clean_sheets || 0) / mins) * 90,
      });
    }

    const comps = euroByClub.get(short);
    const euroBonus = comps?.has('EU_CL') ? 0.22 : comps?.has('EU_UC') ? 0.10 : comps?.has('EU_CF') ? 0.05 : 0;

    if (qual.length < 5) {
      // Promoted / newly assembled club prior without reading current-season price tiers
      rawAtt[short] = -0.25 + euroBonus;
      rawDef[short] = 0.24 - euroBonus * 0.8;
    } else {
      const top12 = qual.toSorted((a, b) => b.mins - a.mins).slice(0, 12);
      const avgPts90 = top12.reduce((s, q) => s + q.pts90, 0) / top12.length;

      const attGroup = qual
        .filter((q) => q.pos === 'MID' || q.pos === 'FWD')
        .toSorted((a, b) => b.xgi90 - a.xgi90)
        .slice(0, 6);
      const avgAttXgi90 = attGroup.length > 0
        ? attGroup.reduce((s, q) => s + q.xgi90, 0) / attGroup.length
        : 0.34;

      const defGroup = qual
        .filter((q) => q.pos === 'DEF' || q.pos === 'GKP')
        .toSorted((a, b) => b.cs90 - a.cs90)
        .slice(0, 5);
      const avgDefCs90 = defGroup.length > 0
        ? defGroup.reduce((s, q) => s + q.cs90, 0) / defGroup.length
        : 0.26;

      const coreStrength = (avgPts90 - 3.6) / 1.5;
      rawAtt[short] = 0.55 * coreStrength + 0.45 * ((avgAttXgi90 - 0.38) / 0.22) + euroBonus;
      rawDef[short] = -0.55 * coreStrength - 0.45 * ((avgDefCs90 - 0.28) / 0.14) - euroBonus * 0.8;
    }

    sumAtt += rawAtt[short];
    sumDef += rawDef[short];
    cnt++;
  }

  const mA = cnt > 0 ? sumAtt / cnt : 0;
  const mD = cnt > 0 ? sumDef / cnt : 0;
  const attPrior: Record<string, number> = {};
  const defPrior: Record<string, number> = {};
  for (const short of clubShorts) {
    attPrior[short] = clamp(rawAtt[short] - mA, -0.48, 0.48);
    defPrior[short] = clamp(rawDef[short] - mD, -0.48, 0.48);
  }
  return { attPrior, defPrior };
}

function computePairJensen(nC: number, att: Float64Array, def: Float64Array): number {
  let sumExp = 0;
  let pairCount = 0;
  for (let h = 0; h < nC; h++) {
    for (let a = 0; a < nC; a++) {
      if (h === a) continue;
      sumExp += Math.exp(att[h] + def[a]);
      pairCount++;
    }
  }
  return pairCount > 0 ? Math.log(Math.max(1e-6, sumExp / pairCount)) : 0;
}

function computePairMuCorrection(
  nC: number,
  mu: number,
  ha: number,
  attH: Float64Array,
  defH: Float64Array,
  attA: Float64Array,
  defA: Float64Array,
  targetEmpGoalsPerMatch: number,
  shrink: number = 1.0
): number {
  if (nC <= 1 || targetEmpGoalsPerMatch <= 0) return 0;
  let sE = 0;
  let cP = 0;
  for (let h = 0; h < nC; h++) {
    for (let a = 0; a < nC; a++) {
      if (h === a) continue;
      const lH = Math.exp(clamp(mu + ha * 0.5 + (attH[h] + defA[a]) * shrink, -2.5, 2.5));
      const lA = Math.exp(clamp(mu - ha * 0.5 + (attA[a] + defH[h]) * shrink, -2.5, 2.5));
      sE += lH + lA;
      cP++;
    }
  }
  const avgExp = cP > 0 ? sE / cP : targetEmpGoalsPerMatch;
  return avgExp > 1e-6 ? Math.log(targetEmpGoalsPerMatch / avgExp) : 0;
}

interface GlmObs {
  h: number;
  a: number;
  yH: number;
  yA: number;
  rawH: number;
  rawA: number;
  w: number;
  hasOpp: boolean;
  oA?: number;
  oD?: number;
  kickoffMs: number;
}

function solvePoissonGlm(
  nC: number,
  obs: GlmObs[],
  attPrior: Float64Array,
  defPrior: Float64Array,
  muPrior: number,
  haPrior: number,
  l2: number,
  useNegBinIrl: boolean
): { att: Float64Array; def: Float64Array; mu: number; homeAdv: number; jensenLog: number } {
  const att = new Float64Array(attPrior);
  const def = new Float64Array(defPrior);
  let mu = muPrior;
  let homeAdv = haPrior;

  if (obs.length === 0 || nC <= 1) {
    return { att, def, mu, homeAdv, jensenLog: computePairJensen(nC, att, def) };
  }

  const huberCut = STRUCT.huber;
  const iters = useNegBinIrl ? 36 : 40;

  for (let iter = 0; iter < iters; iter++) {
    let gMu = 0;
    let hMu = 0;
    let gHa = 0;
    let hHa = 0;

    for (const o of obs) {
      if (!o.hasOpp) continue;
      const lH = Math.exp(clamp(mu + homeAdv * 0.5 + att[o.h] + def[o.a], -2.5, 2.5));
      const lA = Math.exp(clamp(mu - homeAdv * 0.5 + att[o.a] + def[o.h], -2.5, 2.5));
      let wtH = o.w;
      let wtA = o.w;
      if (useNegBinIrl) {
        const vH = 1 / (1 + STRUCT.dispA * lH);
        const vA = 1 / (1 + STRUCT.dispH * lA);
        const rH = Math.abs(o.yH - lH);
        const rA = Math.abs(o.yA - lA);
        const hubH = rH <= huberCut ? 1 : huberCut / rH;
        const hubA = rA <= huberCut ? 1 : huberCut / rA;
        wtH = o.w * vH * hubH;
        wtA = o.w * vA * hubA;
      }
      gMu += wtH * (lH - o.yH) + wtA * (lA - o.yA);
      hMu += wtH * lH + wtA * lA;
      gHa += 0.5 * (wtH * (lH - o.yH) - wtA * (lA - o.yA));
      hHa += 0.25 * (wtH * lH + wtA * lA);
    }

    gMu += 6.0 * (mu - muPrior);
    hMu += 6.0;
    gHa += 12.0 * (homeAdv - haPrior);
    hHa += 12.0;

    if (hMu > 0) mu -= gMu / hMu;
    if (hHa > 0) homeAdv = clamp(homeAdv - gHa / hHa, 0.05, 0.36);

    for (let i = 0; i < nC; i++) {
      let gA = l2 * (att[i] - attPrior[i]);
      let hA = l2;
      let gD = l2 * (def[i] - defPrior[i]);
      let hD = l2;

      for (const o of obs) {
        if (o.h === i) {
          const dOpp = o.a >= 0 ? def[o.a] : (o.oD ?? 0);
          const aOpp = o.a >= 0 ? att[o.a] : (o.oA ?? 0);
          const lH = Math.exp(clamp(mu + homeAdv * 0.5 + att[i] + dOpp, -2.5, 2.5));
          const lA = Math.exp(clamp(mu - homeAdv * 0.5 + aOpp + def[i], -2.5, 2.5));
          let wtH = o.w;
          let wtA = o.w;
          if (useNegBinIrl) {
            const rH = Math.abs(o.yH - lH);
            const rA = Math.abs(o.yA - lA);
            wtH = o.w * (1 / (1 + STRUCT.dispA * lH)) * (rH <= huberCut ? 1 : huberCut / rH);
            wtA = o.w * (1 / (1 + STRUCT.dispH * lA)) * (rA <= huberCut ? 1 : huberCut / rA);
          }
          gA += wtH * (lH - o.yH);
          hA += wtH * lH;
          gD += wtA * (lA - o.yA);
          hD += wtA * lA;
        }
        if (o.a === i) {
          const dOpp = o.h >= 0 ? def[o.h] : (o.oD ?? 0);
          const aOpp = o.h >= 0 ? att[o.h] : (o.oA ?? 0);
          const lA = Math.exp(clamp(mu - homeAdv * 0.5 + att[i] + dOpp, -2.5, 2.5));
          const lH = Math.exp(clamp(mu + homeAdv * 0.5 + aOpp + def[i], -2.5, 2.5));
          let wtH = o.w;
          let wtA = o.w;
          if (useNegBinIrl) {
            const rH = Math.abs(o.yH - lH);
            const rA = Math.abs(o.yA - lA);
            wtH = o.w * (1 / (1 + STRUCT.dispA * lH)) * (rH <= huberCut ? 1 : huberCut / rH);
            wtA = o.w * (1 / (1 + STRUCT.dispH * lA)) * (rA <= huberCut ? 1 : huberCut / rA);
          }
          gA += wtA * (lA - o.yA);
          hA += wtA * lA;
          gD += wtH * (lH - o.yH);
          hD += wtH * lH;
        }
      }

      att[i] -= clamp(gA / Math.max(1e-6, hA), -0.25, 0.25);
      def[i] -= clamp(gD / Math.max(1e-6, hD), -0.25, 0.25);
    }

    let mA = 0;
    let mD = 0;
    for (let i = 0; i < nC; i++) {
      mA += att[i];
      mD += def[i];
    }
    mA /= nC;
    mD /= nC;
    for (let i = 0; i < nC; i++) {
      att[i] -= mA;
      def[i] -= mD;
    }
    mu += mA + mD;
  }

  return { att, def, mu, homeAdv, jensenLog: computePairJensen(nC, att, def) };
}

/**
 * Fits all Stage 2 statistical base models strictly causally up to `maxTrainGw`
 * and strictly before `cutoffMs` for non-EPL competitions.
 */
export function fitCausalMatchScoreModel(
  params: FitCausalMatchScoreParams
): MatchScoreModelContext {
  const {
    clubs,
    players,
    eplMatchesByGw,
    nonEplRecords = [],
    maxTrainGw,
    minTrainGw = 1,
    cutoffMs = Number.MAX_SAFE_INTEGER,
  } = params;

  const clubShorts = clubs.map((c) => c.short).filter(Boolean);
  const nC = clubShorts.length;
  const clubIdx = new Map<string, number>(clubShorts.map((s, i) => [s, i]));
  const { attPrior: rawAttPrior, defPrior: rawDefPrior } = buildCausalTeamStrengthPrior(
    clubShorts,
    players,
    nonEplRecords,
    cutoffMs
  );

  const obs: GlmObs[] = [];
  const ingestedEpl = new Set<string>();
  const effMinGw = Math.max(1, Math.floor(minTrainGw));
  const effTrainGw = Math.max(0, Math.floor(maxTrainGw));

  let empGoalsSum = 0;
  let empGoalsW = 0;

  // 1. Ingest causal EPL matches strictly effMinGw <= gw <= effTrainGw
  for (let gw = effMinGw; gw <= effTrainGw; gw++) {
    const ageGw = effTrainGw - gw;
    const decay = Math.exp((-Math.LN2 * ageGw) / STRUCT.halfLife);
    const matches = eplMatchesByGw[gw] || [];

    for (const m of matches) {
      const hs = m?.home_team?.short_name || (typeof m?.home_team === 'string' ? m.home_team : m?.hShort);
      const as = m?.away_team?.short_name || (typeof m?.away_team === 'string' ? m.away_team : m?.aShort);
      if (!hs || !as || !clubIdx.has(hs) || !clubIdx.has(as)) continue;

      const rawH = m.team_h_score ?? m.home_score ?? m.hScore;
      const rawA = m.team_a_score ?? m.away_score ?? m.aScore;
      if (rawH === null || rawH === undefined || rawA === null || rawA === undefined) continue;
      const hScore = Number(rawH);
      const aScore = Number(rawA);
      if (Number.isNaN(hScore) || Number.isNaN(aScore)) continue;

      ingestedEpl.add(`${gw}_${hs}_${as}`);

      const rawHXg = sumSidePlayerStat(m.home_lineup, m.home_bench, 'expected_goals');
      const rawAXg = sumSidePlayerStat(m.away_lineup, m.away_bench, 'expected_goals');
      const rawHThr = sumSidePlayerStat(m.home_lineup, m.home_bench, 'threat') / 100;
      const rawAThr = sumSidePlayerStat(m.away_lineup, m.away_bench, 'threat') / 100;
      const rawHBps = sumSidePlayerStat(m.home_lineup, m.home_bench, 'bps') / 150;
      const rawABps = sumSidePlayerStat(m.away_lineup, m.away_bench, 'bps') / 150;
      const hasXg = rawHXg > 0.05 || rawAXg > 0.05;

      // De-bias Opta player-summed xG & Threat + BPS intensity
      const hXgDebiased = rawHXg * 0.965;
      const aXgDebiased = rawAXg * 0.88;
      const hThrSignal = rawHThr * 1.04;
      const aThrSignal = rawAThr * 0.97;

      const yH = hasXg
        ? STRUCT.wXg * hXgDebiased + STRUCT.wThr * hThrSignal + STRUCT.wBps * rawHBps
        : hScore;
      const yA = hasXg
        ? STRUCT.wXg * aXgDebiased + STRUCT.wThr * aThrSignal + STRUCT.wBps * rawABps
        : aScore;

      const koMs = m?.kickoff_time ? Date.parse(m.kickoff_time) : (gw * 7 * 86400_000);
      empGoalsSum += (hScore + aScore) * decay;
      empGoalsW += decay;

      obs.push({
        h: clubIdx.get(hs)!,
        a: clubIdx.get(as)!,
        yH,
        yA,
        rawH: hScore,
        rawA: aScore,
        w: decay,
        hasOpp: true,
        kickoffMs: Number.isFinite(koMs) ? koMs : gw * 7 * 86400_000,
      });
    }
  }

  // 2. Fallback to precalculated review matches ONLY if missing from live EPL matches
  const precalcList = (precalculatedReviewDataRaw as any)?.matches || [];
  for (const pm of precalcList) {
    if (!pm?.finished || pm.gw < effMinGw || pm.gw > effTrainGw) continue;
    if (!pm.hShort || !pm.aShort || !clubIdx.has(pm.hShort) || !clubIdx.has(pm.aShort)) continue;
    if (ingestedEpl.has(`${pm.gw}_${pm.hShort}_${pm.aShort}`)) continue;
    if (pm.hScore == null || pm.aScore == null) continue;
    ingestedEpl.add(`${pm.gw}_${pm.hShort}_${pm.aShort}`);

    const ageGw = effTrainGw - Number(pm.gw);
    const decay = Math.exp((-Math.LN2 * ageGw) / STRUCT.halfLife);
    const hScore = Number(pm.hScore);
    const aScore = Number(pm.aScore);
    const koMs = pm.kickoff ? Date.parse(pm.kickoff) : Number(pm.gw) * 7 * 86400_000;

    empGoalsSum += (hScore + aScore) * decay;
    empGoalsW += decay;

    obs.push({
      h: clubIdx.get(pm.hShort)!,
      a: clubIdx.get(pm.aShort)!,
      yH: hScore,
      yA: aScore,
      rawH: hScore,
      rawA: aScore,
      w: decay,
      hasOpp: true,
      kickoffMs: Number.isFinite(koMs) ? koMs : Number(pm.gw) * 7 * 86400_000,
    });
  }

  // 3. Ingest causal finalized non-EPL match scores strictly before cutoffMs
  const seenNonEplPairs = new Set<string>();
  const halfLifeDays = STRUCT.halfLife * 7;
  for (const rec of nonEplRecords) {
    if (!rec || rec.kickoffMs >= cutoffMs || !clubIdx.has(rec.clubShort)) continue;
    const ageDays = Math.max(0, (cutoffMs - rec.kickoffMs) / 86400_000);
    const decay = Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
    const compW = (NON_EPL_SCORE_COMP_WEIGHT[rec.compAbbr] ?? 0.25) * 1.2;
    const w = compW * decay;
    if (w <= 0.01) continue;

    const cI = clubIdx.get(rec.clubShort)!;
    const oI = rec.oppShort && clubIdx.has(rec.oppShort) ? clubIdx.get(rec.oppShort)! : -1;
    const gfCap = clamp(rec.teamScore, 0, 4.0);
    const gaCap = clamp(rec.oppScore, 0, 4.0);

    if (oI >= 0) {
      const pairKey = rec.isHome
        ? `${rec.kickoffMs}_${rec.clubShort}_${rec.oppShort}`
        : `${rec.kickoffMs}_${rec.oppShort}_${rec.clubShort}`;
      if (seenNonEplPairs.has(pairKey)) continue;
      seenNonEplPairs.add(pairKey);

      obs.push({
        h: rec.isHome ? cI : oI,
        a: rec.isHome ? oI : cI,
        yH: rec.isHome ? gfCap : gaCap,
        yA: rec.isHome ? gaCap : gfCap,
        rawH: rec.isHome ? gfCap : gaCap,
        rawA: rec.isHome ? gaCap : gfCap,
        w,
        hasOpp: true,
        kickoffMs: rec.kickoffMs,
      });
    } else {
      const oA = rec.compAbbr === 'EU_CL' ? 0.12 : rec.compAbbr === 'EU_UC' ? -0.20 : -0.35;
      const oD = rec.compAbbr === 'EU_CL' ? -0.10 : rec.compAbbr === 'EU_UC' ? 0.22 : 0.35;
      obs.push({
        h: rec.isHome ? cI : -1,
        a: rec.isHome ? -1 : cI,
        yH: rec.isHome ? gfCap : gaCap,
        yA: rec.isHome ? gaCap : gfCap,
        rawH: rec.isHome ? gfCap : gaCap,
        rawA: rec.isHome ? gaCap : gfCap,
        w: w * 0.75,
        hasOpp: false,
        oA,
        oD,
        kickoffMs: rec.kickoffMs,
      });
    }
  }

  // Empirical league goals per match with prior k=16
  const empGoalsPerMatch = (2.72 * 16 + empGoalsSum) / (16 + empGoalsW);
  const muPrior = Math.log(empGoalsPerMatch * 0.5);
  const haPrior = 0.21;

  const attPrior = new Float64Array(nC);
  const defPrior = new Float64Array(nC);
  for (let i = 0; i < nC; i++) {
    attPrior[i] = (rawAttPrior[clubShorts[i]] || 0) * STRUCT.priorScale;
    defPrior[i] = (rawDefPrior[clubShorts[i]] || 0) * STRUCT.priorScale * 0.90;
  }

  // S1: Time-decay Poisson Ridge GLM
  const s1 = solvePoissonGlm(nC, obs, attPrior, defPrior, muPrior, haPrior, STRUCT.l2, false);

  // S2: Negative Binomial Huber-IRLS GLM
  const s2 = solvePoissonGlm(nC, obs, attPrior, defPrior, muPrior, haPrior, STRUCT.l2 * 1.05, true);

  // S3: Time-Varying Elo State-Space sequential update
  const eloAtt = new Float64Array(nC);
  const eloDef = new Float64Array(nC);
  for (let i = 0; i < nC; i++) {
    eloAtt[i] = attPrior[i] * STRUCT.eloPriorW;
    eloDef[i] = defPrior[i] * STRUCT.eloPriorW;
  }
  const chronoObs = obs.toSorted((a, b) => a.kickoffMs - b.kickoffMs);
  for (const o of chronoObs) {
    if (!o.hasOpp) continue;
    const pH = Math.exp(clamp(muPrior + haPrior * 0.5 + eloAtt[o.h] + eloDef[o.a], -2.2, 2.2));
    const pA = Math.exp(clamp(muPrior - haPrior * 0.5 + eloAtt[o.a] + eloDef[o.h], -2.2, 2.2));
    const errH = clamp((o.yH - pH) / Math.max(0.8, Math.sqrt(pH)), -1.5, 1.5);
    const errA = clamp((o.yA - pA) / Math.max(0.8, Math.sqrt(pA)), -1.5, 1.5);
    const kEff = STRUCT.eloK * clamp(o.w, 0.25, 1.0);
    eloAtt[o.h] = clamp(eloAtt[o.h] + kEff * errH, -0.75, 0.75);
    eloDef[o.a] = clamp(eloDef[o.a] + kEff * errH, -0.75, 0.75);
    eloAtt[o.a] = clamp(eloAtt[o.a] + kEff * errA, -0.75, 0.75);
    eloDef[o.h] = clamp(eloDef[o.h] + kEff * errA, -0.75, 0.75);
  }
  if (nC > 1) {
    let mA = 0;
    let mD = 0;
    for (let i = 0; i < nC; i++) {
      mA += eloAtt[i];
      mD += eloDef[i];
    }
    mA /= nC;
    mD /= nC;
    for (let i = 0; i < nC; i++) {
      eloAtt[i] -= mA;
      eloDef[i] -= mD;
    }
  }
  const eloJensen = computePairJensen(nC, eloAtt, eloDef);

  const s1MuCorr = computePairMuCorrection(nC, s1.mu, s1.homeAdv, s1.att, s1.def, s1.att, s1.def, empGoalsPerMatch, 1.0);
  const s2MuCorr = computePairMuCorrection(nC, s2.mu, s2.homeAdv, s2.att, s2.def, s2.att, s2.def, empGoalsPerMatch, 1.0);
  const s3MuCorr = computePairMuCorrection(nC, muPrior, haPrior, eloAtt, eloDef, eloAtt, eloDef, empGoalsPerMatch, 1.0);

  // S6: Hierarchical Empirical Bayes Home/Away Venue Split shrunk toward S2 (Negative Binomial)
  const ebAttH = new Float64Array(nC);
  const ebDefH = new Float64Array(nC);
  const ebAttA = new Float64Array(nC);
  const ebDefA = new Float64Array(nC);

  const sumResAttH = new Float64Array(nC);
  const sumWAttH = new Float64Array(nC);
  const sumResDefH = new Float64Array(nC);
  const sumWDefH = new Float64Array(nC);
  const sumResAttA = new Float64Array(nC);
  const sumWAttA = new Float64Array(nC);
  const sumResDefA = new Float64Array(nC);
  const sumWDefA = new Float64Array(nC);

  for (const o of obs) {
    if (!o.hasOpp) continue;
    const baseLH = Math.exp(clamp(s2.mu + s2MuCorr + s2.homeAdv * 0.5 + s2.att[o.h] + s2.def[o.a], -2.2, 2.2));
    const baseLA = Math.exp(clamp(s2.mu + s2MuCorr - s2.homeAdv * 0.5 + s2.att[o.a] + s2.def[o.h], -2.2, 2.2));
    const resLogH = clamp(Math.log((o.yH + 0.35) / (baseLH + 0.35)), -0.7, 0.7);
    const resLogA = clamp(Math.log((o.yA + 0.35) / (baseLA + 0.35)), -0.7, 0.7);
    sumResAttH[o.h] += o.w * resLogH;
    sumWAttH[o.h] += o.w;
    sumResDefH[o.h] += o.w * resLogA;
    sumWDefH[o.h] += o.w;
    sumResAttA[o.a] += o.w * resLogA;
    sumWAttA[o.a] += o.w;
    sumResDefA[o.a] += o.w * resLogH;
    sumWDefA[o.a] += o.w;
  }

  for (let i = 0; i < nC; i++) {
    ebAttH[i] = s2.att[i] + sumResAttH[i] / (STRUCT.venueShrink + sumWAttH[i]);
    ebDefH[i] = s2.def[i] + sumResDefH[i] / (STRUCT.venueShrink + sumWDefH[i]);
    ebAttA[i] = s2.att[i] + sumResAttA[i] / (STRUCT.venueShrink + sumWAttA[i]);
    ebDefA[i] = s2.def[i] + sumResDefA[i] / (STRUCT.venueShrink + sumWDefA[i]);
  }

  let ebSumExp = 0;
  let ebPairs = 0;
  for (let h = 0; h < nC; h++) {
    for (let a = 0; a < nC; a++) {
      if (h === a) continue;
      ebSumExp += Math.exp(ebAttH[h] + ebDefA[a]);
      ebPairs++;
    }
  }
  const ebJensen = ebPairs > 0 ? Math.log(Math.max(1e-6, ebSumExp / ebPairs)) : s2.jensenLog;
  const s6MuCorr = computePairMuCorrection(nC, s2.mu, s2.homeAdv, ebAttH, ebDefH, ebAttA, ebDefA, empGoalsPerMatch, 1.0);

  return {
    maxTrainGw: effTrainGw,
    cutoffMs,
    clubShorts,
    clubIdx,
    att: s1.att,
    def: s1.def,
    mu: s1.mu,
    homeAdv: s1.homeAdv,
    jensenLog: s1.jensenLog,
    s1MuCorr,
    empGoalsPerMatch,
    nbAtt: s2.att,
    nbDef: s2.def,
    nbMu: s2.mu,
    nbHa: s2.homeAdv,
    nbJensen: s2.jensenLog,
    s2MuCorr,
    eloAtt,
    eloDef,
    eloMu: muPrior,
    eloHa: haPrior,
    eloJensen,
    s3MuCorr,
    ebAttH,
    ebDefH,
    ebAttA,
    ebDefA,
    ebMu: s2.mu,
    ebHa: s2.homeAdv,
    ebJensen,
    s6MuCorr,
  };
}

// ============================================================================
// JOINT PROBABILITY MATRIX GENERATORS (S1..S8)
// ============================================================================
function buildDixonColesMatrix(lambdaH: number, lambdaA: number, rho: number): number[][] {
  const pH = Array.from({ length: MAX_G + 1 }, (_, k) => poissonProb(lambdaH, k));
  const pA = Array.from({ length: MAX_G + 1 }, (_, k) => poissonProb(lambdaA, k));
  const mat: number[][] = Array.from({ length: MAX_G + 1 }, () => Array(MAX_G + 1).fill(0));
  let tot = 0;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      let tau = 1.0;
      if (h === 0 && a === 0) tau = Math.max(0.1, 1 - lambdaH * lambdaA * rho);
      else if (h === 0 && a === 1) tau = Math.max(0.1, 1 + lambdaH * rho);
      else if (h === 1 && a === 0) tau = Math.max(0.1, 1 + lambdaA * rho);
      else if (h === 1 && a === 1) tau = Math.max(0.1, 1 - rho);
      const p = Math.max(0, pH[h] * pA[a] * tau);
      mat[h][a] = p;
      tot += p;
    }
  }
  const inv = tot > 0 ? 1 / tot : 1;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) mat[h][a] *= inv;
  }
  return mat;
}

function negBinPmf(mean: number, disp: number): number[] {
  if (disp <= 1e-4) {
    return Array.from({ length: MAX_G + 1 }, (_, k) => poissonProb(mean, k));
  }
  const r = 1 / disp;
  const p0 = r / (r + mean);
  const probs = new Array<number>(MAX_G + 1).fill(0);
  probs[0] = Math.pow(p0, r);
  for (let k = 1; k <= MAX_G; k++) {
    probs[k] = probs[k - 1] * ((r + k - 1) / k) * (mean / (r + mean));
  }
  let s = 0;
  for (let k = 0; k <= MAX_G; k++) s += probs[k];
  const inv = s > 0 ? 1 / s : 1;
  for (let k = 0; k <= MAX_G; k++) probs[k] *= inv;
  return probs;
}

function buildNegBinMatrix(lambdaH: number, lambdaA: number, dispH: number, dispA: number, rho: number): number[][] {
  const pH = negBinPmf(lambdaH, dispA); // Home attack facing away defense dispersion
  const pA = negBinPmf(lambdaA, dispH);
  const mat: number[][] = Array.from({ length: MAX_G + 1 }, () => Array(MAX_G + 1).fill(0));
  let tot = 0;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      let tau = 1.0;
      if (h === 0 && a === 0) tau = Math.max(0.1, 1 - lambdaH * lambdaA * rho * 0.5);
      else if (h === 0 && a === 1) tau = Math.max(0.1, 1 + lambdaH * rho * 0.5);
      else if (h === 1 && a === 0) tau = Math.max(0.1, 1 + lambdaA * rho * 0.5);
      else if (h === 1 && a === 1) tau = Math.max(0.1, 1 - rho * 0.5);
      const p = Math.max(0, pH[h] * pA[a] * tau);
      mat[h][a] = p;
      tot += p;
    }
  }
  const inv = tot > 0 ? 1 / tot : 1;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) mat[h][a] *= inv;
  }
  return mat;
}

function frankCopulaCdf(u: number, v: number, theta: number): number {
  if (Math.abs(theta) < 1e-4) return u * v;
  const eT = Math.exp(-theta);
  const eU = Math.exp(-theta * u) - 1;
  const eV = Math.exp(-theta * v) - 1;
  const denom = eT - 1;
  const arg = Math.max(1e-12, 1 + (eU * eV) / denom);
  return clamp(-Math.log(arg) / theta, 0, 1);
}

function buildFrankCopulaMatrix(lambdaH: number, lambdaA: number, theta: number): number[][] {
  const pH = negBinPmf(lambdaH, STRUCT.dispA * 0.7);
  const pA = negBinPmf(lambdaA, STRUCT.dispH * 0.7);
  const cdfH = [0];
  const cdfA = [0];
  for (let k = 0; k <= MAX_G; k++) {
    cdfH.push(Math.min(1, cdfH[k] + pH[k]));
    cdfA.push(Math.min(1, cdfA[k] + pA[k]));
  }
  cdfH[MAX_G + 1] = 1;
  cdfA[MAX_G + 1] = 1;

  const mat: number[][] = Array.from({ length: MAX_G + 1 }, () => Array(MAX_G + 1).fill(0));
  let tot = 0;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      const p = Math.max(
        0,
        frankCopulaCdf(cdfH[h + 1], cdfA[a + 1], theta) -
          frankCopulaCdf(cdfH[h], cdfA[a + 1], theta) -
          frankCopulaCdf(cdfH[h + 1], cdfA[a], theta) +
          frankCopulaCdf(cdfH[h], cdfA[a], theta)
      );
      mat[h][a] = p;
      tot += p;
    }
  }
  const inv = tot > 0 ? 1 / tot : 1;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) mat[h][a] *= inv;
  }
  return mat;
}

function buildQuasiMonteCarloMatrix(lambdaH: number, lambdaA: number, rho: number): number[][] {
  const sigma = 0.16;
  const meanCorr = -0.5 * sigma * sigma;
  const rhoRoot = Math.sqrt(Math.max(0, 1 - rho * rho));
  const mat: number[][] = Array.from({ length: MAX_G + 1 }, () => Array(MAX_G + 1).fill(0));
  const invN = 1 / QMC_SAMPLES.length;

  for (let s = 0; s < QMC_SAMPLES.length; s++) {
    const { z1, z2, u3 } = QMC_SAMPLES[s];
    const wA = rho * z1 + rhoRoot * z2;
    const tempo = 1 + 0.05 * ((u3 - 0.5) * 2);
    const lHs = clamp(lambdaH * Math.exp(meanCorr + sigma * z1) * tempo, 0.25, 3.6);
    const lAs = clamp(lambdaA * Math.exp(meanCorr + sigma * wA) * tempo, 0.20, 3.2);
    const pHs = Array.from({ length: MAX_G + 1 }, (_, k) => poissonProb(lHs, k));
    const pAs = Array.from({ length: MAX_G + 1 }, (_, k) => poissonProb(lAs, k));
    for (let h = 0; h <= MAX_G; h++) {
      for (let a = 0; a <= MAX_G; a++) {
        mat[h][a] += pHs[h] * pAs[a] * invN;
      }
    }
  }

  let tot = 0;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) tot += mat[h][a];
  }
  const inv = tot > 0 ? 1 / tot : 1;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) mat[h][a] *= inv;
  }
  return mat;
}

function selectScoreAndSummarize(mat: number[][]): {
  lambdaH: number;
  lambdaA: number;
  homeGoals: number;
  awayGoals: number;
  homeCsProbRaw: number;
  awayCsProbRaw: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
} {
  let lambdaH = 0;
  let lambdaA = 0;
  let pWin = 0;
  let pDraw = 0;
  let pLoss = 0;
  let homeCsProbRaw = 0;
  let awayCsProbRaw = 0;

  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      const p = mat[h][a];
      lambdaH += h * p;
      lambdaA += a * p;
      if (h > a) pWin += p;
      else if (h === a) pDraw += p;
      else pLoss += p;
      if (a === 0) homeCsProbRaw += p;
      if (h === 0) awayCsProbRaw += p;
    }
  }

  const csHProb = homeCsProbRaw;
  const csAProb = awayCsProbRaw;

  let bestDir: 'W' | 'D' | 'L' = 'D';
  if (pWin >= pLoss && pWin >= pDraw + SCORE_SEL_CFG.drawThresh) bestDir = 'W';
  else if (pLoss > pWin && pLoss >= pDraw + SCORE_SEL_CFG.drawThresh) bestDir = 'L';
  else if (Math.max(pWin, pLoss) > pDraw + 0.085) bestDir = pWin >= pLoss ? 'W' : 'L';

  let bestH = 1;
  let bestA = 1;
  let bestRisk = Infinity;

  for (let gh = 0; gh <= 5; gh++) {
    for (let ga = 0; ga <= 5; ga++) {
      let expTeamAbs = 0;
      let expMatchAbs = 0;
      for (let h = 0; h <= MAX_G; h++) {
        for (let a = 0; a <= MAX_G; a++) {
          const p = mat[h][a];
          expTeamAbs += p * (Math.abs(h - gh) + Math.abs(a - ga));
          expMatchAbs += p * Math.abs((h + a) - (gh + ga));
        }
      }
      const gDir = gh > ga ? 'W' : gh < ga ? 'L' : 'D';
      const dPen = gDir === bestDir ? 0 : SCORE_SEL_CFG.dirPen;

      const csRewardH =
        ga === 0 && csHProb >= SCORE_SEL_CFG.csThresh
          ? SCORE_SEL_CFG.csBoost * ((csHProb - SCORE_SEL_CFG.csThresh) / (1 - SCORE_SEL_CFG.csThresh))
          : 0;
      const csRewardA =
        gh === 0 && csAProb >= SCORE_SEL_CFG.csThresh
          ? SCORE_SEL_CFG.csBoost * ((csAProb - SCORE_SEL_CFG.csThresh) / (1 - SCORE_SEL_CFG.csThresh))
          : 0;
      const totalGoalReward = SCORE_SEL_CFG.goalMatchW * (gh + ga - SCORE_SEL_CFG.goalShift);

      const risk =
        expTeamAbs +
        0.05 * expMatchAbs +
        dPen -
        SCORE_SEL_CFG.exactW * mat[gh][ga] -
        csRewardH -
        csRewardA -
        totalGoalReward * 0.08;

      if (risk < bestRisk) {
        bestRisk = risk;
        bestH = gh;
        bestA = ga;
      }
    }
  }

  return {
    lambdaH,
    lambdaA,
    homeGoals: bestH,
    awayGoals: bestA,
    homeCsProbRaw,
    awayCsProbRaw,
    homeWinProb: pWin,
    drawProb: pDraw,
    awayWinProb: pLoss,
  };
}

function computeStage1Modifiers(
  s1: Stage1BridgeTeamStats | undefined,
  decayScale: number
): { attMod: number; defConcededMod: number } {
  if (!s1) return { attMod: 1.0, defConcededMod: 1.0 };
  const rawAttLog =
    STRUCT.wAttXi * clamp(s1.xiAttDelta, -0.35, 0.35) -
    STRUCT.wFatAtt * clamp(s1.fatigue72hShare, 0, 1);
  const rawDefLog =
    -STRUCT.wDefXi * clamp(s1.xiDefStrength, -0.35, 0.35) -
    STRUCT.wAff * clamp(s1.minDefAff - 0.88, -0.25, 0.12) +
    STRUCT.wFatDef * clamp(s1.fatigue72hShare, 0, 1);

  return {
    attMod: clamp(Math.exp(rawAttLog * decayScale), 0.88, 1.12),
    defConcededMod: clamp(Math.exp(rawDefLog * decayScale), 0.88, 1.12),
  };
}

const muCorrCache = new WeakMap<
  MatchScoreModelContext,
  Map<number, { c1: number; c2: number; c3: number; c6: number }>
>();

function getHorizonMuCorrections(
  model: MatchScoreModelContext,
  dist: number,
  horizonShrink: number
): { c1: number; c2: number; c3: number; c6: number } {
  if (dist === 0) {
    return {
      c1: model.s1MuCorr,
      c2: model.s2MuCorr,
      c3: model.s3MuCorr,
      c6: model.s6MuCorr,
    };
  }
  let mCache = muCorrCache.get(model);
  if (!mCache) {
    mCache = new Map();
    muCorrCache.set(model, mCache);
  }
  const hit = mCache.get(dist);
  if (hit) return hit;

  const nC = model.clubShorts.length;
  const target = model.empGoalsPerMatch;
  const computed = {
    c1: computePairMuCorrection(nC, model.mu, model.homeAdv, model.att, model.def, model.att, model.def, target, horizonShrink),
    c2: computePairMuCorrection(nC, model.nbMu, model.nbHa, model.nbAtt, model.nbDef, model.nbAtt, model.nbDef, target, horizonShrink),
    c3: computePairMuCorrection(nC, model.eloMu, model.eloHa, model.eloAtt, model.eloDef, model.eloAtt, model.eloDef, target, horizonShrink),
    c6: computePairMuCorrection(nC, model.ebMu, model.ebHa, model.ebAttH, model.ebDefH, model.ebAttA, model.ebDefA, target, horizonShrink),
  };
  mCache.set(dist, computed);
  return computed;
}

/**
 * Predicts expected goals (lambdaH, lambdaA), discrete scoreline (single-fixture fallback),
 * joint probability matrix (`scoreMatrix`), Win/Draw/Loss probabilities, Clean Sheet %,
 * and Expected Goals Conceded penalty strictly downstream of Stage 1.
 */
export function predictDixonColesFixture(
  model: MatchScoreModelContext,
  homeShort: string,
  awayShort: string,
  opts: PredictDixonColesOptions = {}
): Stage2FixtureProjection {
  const hi = model.clubIdx.get(homeShort) ?? -1;
  const ai = model.clubIdx.get(awayShort) ?? -1;

  const baseGw = opts.baseHistoricalGW ?? model.maxTrainGw;
  const targetGw = opts.gw ?? baseGw + 1;
  const dist = Math.max(0, targetGw - (baseGw + 1));
  const horizonShrink = Math.exp(-dist * 0.016);
  const stage1Decay = dist > 0 ? Math.exp(-dist * 0.25) : 1.0;

  const { c1, c2, c3, c6 } = getHorizonMuCorrections(model, dist, horizonShrink);

  // S1: Poisson Ridge
  const s1AttH = (hi >= 0 ? model.att[hi] : 0) * horizonShrink;
  const s1DefH = (hi >= 0 ? model.def[hi] : 0) * horizonShrink;
  const s1AttA = (ai >= 0 ? model.att[ai] : 0) * horizonShrink;
  const s1DefA = (ai >= 0 ? model.def[ai] : 0) * horizonShrink;
  const lH_1 = clamp(Math.exp(model.mu + c1 + model.homeAdv * 0.5 + s1AttH + s1DefA), 0.40, 3.15);
  const lA_1 = clamp(Math.exp(model.mu + c1 - model.homeAdv * 0.5 + s1AttA + s1DefH), 0.32, 2.75);
  const mat1 = buildDixonColesMatrix(lH_1, lA_1, STRUCT.dcRho);

  // S2: Negative Binomial Overdispersed
  const s2AttH = (hi >= 0 ? model.nbAtt[hi] : 0) * horizonShrink;
  const s2DefH = (hi >= 0 ? model.nbDef[hi] : 0) * horizonShrink;
  const s2AttA = (ai >= 0 ? model.nbAtt[ai] : 0) * horizonShrink;
  const s2DefA = (ai >= 0 ? model.nbDef[ai] : 0) * horizonShrink;
  const lH_2 = clamp(Math.exp(model.nbMu + c2 + model.nbHa * 0.5 + s2AttH + s2DefA), 0.40, 3.15);
  const lA_2 = clamp(Math.exp(model.nbMu + c2 - model.nbHa * 0.5 + s2AttA + s2DefH), 0.32, 2.75);
  const mat2 = buildNegBinMatrix(lH_2, lA_2, STRUCT.dispH, STRUCT.dispA, STRUCT.dcRho);

  // S3: Time-Varying Elo State-Space
  const s3AttH = (hi >= 0 ? model.eloAtt[hi] : 0) * horizonShrink;
  const s3DefH = (hi >= 0 ? model.eloDef[hi] : 0) * horizonShrink;
  const s3AttA = (ai >= 0 ? model.eloAtt[ai] : 0) * horizonShrink;
  const s3DefA = (ai >= 0 ? model.eloDef[ai] : 0) * horizonShrink;
  const lH_3 = clamp(Math.exp(model.eloMu + c3 + model.eloHa * 0.5 + s3AttH + s3DefA), 0.40, 3.15);
  const lA_3 = clamp(Math.exp(model.eloMu + c3 - model.eloHa * 0.5 + s3AttA + s3DefH), 0.32, 2.75);
  const mat3 = buildDixonColesMatrix(lH_3, lA_3, STRUCT.dcRho);

  // S4: Skellam & Margin-Constrained Matrix
  const mat4 = buildNegBinMatrix(lH_2, lA_2, STRUCT.dispH * 0.85, STRUCT.dispA * 0.85, STRUCT.dcRho * 1.15);

  // S5: Stage 1 Lineup, Role & Fatigue Bridge (anchored on S1 Poisson Ridge rates)
  let homeAttMod = opts.homeAttMod ?? 1.0;
  let awayAttMod = opts.awayAttMod ?? 1.0;
  let homeDefMod = opts.homeDefMod ?? 1.0;
  let awayDefMod = opts.awayDefMod ?? 1.0;

  if (opts.homeStage1) {
    const hm = computeStage1Modifiers(opts.homeStage1, stage1Decay);
    homeAttMod = hm.attMod;
    homeDefMod = hm.defConcededMod;
  }
  if (opts.awayStage1) {
    const am = computeStage1Modifiers(opts.awayStage1, stage1Decay);
    awayAttMod = am.attMod;
    awayDefMod = am.defConcededMod;
  }

  const lH_5 = clamp(lH_1 * homeAttMod * awayDefMod, 0.38, 3.25);
  const lA_5 = clamp(lA_1 * awayAttMod * homeDefMod, 0.30, 2.85);
  const mat5 = buildNegBinMatrix(lH_5, lA_5, STRUCT.dispH, STRUCT.dispA, STRUCT.dcRho);

  // S6: Hierarchical Empirical Bayes Home/Away Venue Split
  const s6AttH = (hi >= 0 ? model.ebAttH[hi] : 0) * horizonShrink;
  const s6DefH = (hi >= 0 ? model.ebDefH[hi] : 0) * horizonShrink;
  const s6AttA = (ai >= 0 ? model.ebAttA[ai] : 0) * horizonShrink;
  const s6DefA = (ai >= 0 ? model.ebDefA[ai] : 0) * horizonShrink;
  const lH_6 = clamp(Math.exp(model.ebMu + c6 + model.ebHa * 0.5 + s6AttH + s6DefA), 0.40, 3.15);
  const lA_6 = clamp(Math.exp(model.ebMu + c6 - model.ebHa * 0.5 + s6AttA + s6DefH), 0.32, 2.75);
  const mat6 = buildNegBinMatrix(lH_6, lA_6, STRUCT.dispH, STRUCT.dispA, STRUCT.dcRho);

  // S7: Frank Copula Joint Dependence (anchored on S2 NegBin rates)
  const mat7 = buildFrankCopulaMatrix(lH_2, lA_2, STRUCT.copulaTheta);

  // S8: 160-Point Halton Quasi-Monte Carlo Correlated Tempo Ensemble (anchored on S2 NegBin rates)
  const mat8 = buildQuasiMonteCarloMatrix(lH_2, lA_2, STRUCT.qmcRho);

  // S9: Stacked Ensemble over S1..S8
  const mats = [mat1, mat2, mat3, mat4, mat5, mat6, mat7, mat8];
  const matEns: number[][] = Array.from({ length: MAX_G + 1 }, () => Array(MAX_G + 1).fill(0));
  let totEns = 0;

  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      let s = 0;
      for (let m = 0; m < W_ENS.length; m++) {
        s += W_ENS[m] * mats[m][h][a];
      }
      matEns[h][a] = Math.max(0, s);
      totEns += matEns[h][a];
    }
  }
  const invTot = totEns > 0 ? 1 / totEns : 1;
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) matEns[h][a] *= invTot;
  }

  const summary = selectScoreAndSummarize(matEns);
  const homeCongested72h = Boolean(opts.homeStage1?.isCongested72h);
  const awayCongested72h = Boolean(opts.awayStage1?.isCongested72h);

  return {
    lambdaH: summary.lambdaH,
    lambdaA: summary.lambdaA,
    homeGoals: summary.homeGoals,
    awayGoals: summary.awayGoals,
    homeWinProb: Number(summary.homeWinProb.toFixed(4)),
    drawProb: Number(summary.drawProb.toFixed(4)),
    awayWinProb: Number(summary.awayWinProb.toFixed(4)),
    homeCsProb: Math.round(summary.homeCsProbRaw * 100),
    awayCsProb: Math.round(summary.awayCsProbRaw * 100),
    homeCsProbRaw: summary.homeCsProbRaw,
    awayCsProbRaw: summary.awayCsProbRaw,
    homeExpGcPenalty: calculateExpectedGcPenalty(summary.lambdaA),
    awayExpGcPenalty: calculateExpectedGcPenalty(summary.lambdaH),
    isCongested72h: homeCongested72h || awayCongested72h,
    homeCongested72h,
    awayCongested72h,
    stage1HomeAttMod: Number(homeAttMod.toFixed(3)),
    stage1AwayAttMod: Number(awayAttMod.toFixed(3)),
    stage1HomeDefMod: Number(homeDefMod.toFixed(3)),
    stage1AwayDefMod: Number(awayDefMod.toFixed(3)),
    scoreMatrix: matEns,
  };
}

// ============================================================================
// STABLE-V2 CONDITIONAL-RESIDUAL HUNGARIAN OT SLATE ALLOCATOR
// ============================================================================
export interface StableV2ScoreState {
  drawAcc: number;
  hShareAcc: number;
  resH: Float64Array;
  resD: Float64Array;
  resA: Float64Array;
  clubExpPts: Map<string, number>;
  clubPredPts: Map<string, number>;
  clubExpDraws: Map<string, number>;
  clubPredDraws: Map<string, number>;
  clubExpCs: Map<string, number>;
  clubPredCs: Map<string, number>;
}

export interface StableV2SlateInput {
  homeShort: string;
  awayShort: string;
  proj: Stage2FixtureProjection;
  dist: number;
}

const SCORE_CANDIDATES: Record<'H' | 'D' | 'A', Array<{ gh: number; ga: number }>> = (() => {
  const H: Array<{ gh: number; ga: number }> = [];
  const D: Array<{ gh: number; ga: number }> = [];
  const A: Array<{ gh: number; ga: number }> = [];
  for (let gh = 0; gh <= STABLE_V2_CFG.maxG; gh++) {
    for (let ga = 0; ga <= STABLE_V2_CFG.maxG; ga++) {
      if (gh > ga) H.push({ gh, ga });
      else if (gh === ga) D.push({ gh, ga });
      else A.push({ gh, ga });
    }
  }
  return { H, D, A };
})();

export function createStableV2State(): StableV2ScoreState {
  return {
    drawAcc: 0,
    hShareAcc: 0,
    resH: new Float64Array(SCORE_CANDIDATES.H.length),
    resD: new Float64Array(SCORE_CANDIDATES.D.length),
    resA: new Float64Array(SCORE_CANDIDATES.A.length),
    clubExpPts: new Map(),
    clubPredPts: new Map(),
    clubExpDraws: new Map(),
    clubPredDraws: new Map(),
    clubExpCs: new Map(),
    clubPredCs: new Map(),
  };
}

/**
 * Exact O(n^3) Jonker-Volgenant / Hungarian minimum-cost assignment for K x K matrix.
 * Returns col[i] assigned to row i.
 */
function solveMinCostAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array<number>(n).fill(0);
  for (let j = 1; j <= n; j++) {
    if (p[j] >= 1 && p[j] <= n) {
      rowToCol[p[j] - 1] = j - 1;
    }
  }
  return rowToCol;
}

/**
 * Assigns discrete scorelines (`homeGoals`, `awayGoals`) sequentially per Gameweek slate
 * using Conditional-Residual Hungarian Optimal Transport on S9 probability matrices.
 * Preserves pure causal zero-interference for walk-forward & immediate GW (`dist === 0`),
 * and maintains full-season club points/CS realism across extended future horizons (`dist > 0`).
 */
export function assignStableV2SlateScores(
  state: StableV2ScoreState,
  items: StableV2SlateInput[]
): void {
  const m = items.length;
  if (m === 0) return;

  const isFutureHorizon = items.some((it) => it.dist > 0);
  const dirs = new Array<'H' | 'D' | 'A'>(m);

  if (!isFutureHorizon) {
    // Immediate & causal walk-forward mode (dist === 0): preserve directional WDL accuracy
    for (let i = 0; i < m; i++) {
      const pH = items[i].proj.homeWinProb;
      const pA = items[i].proj.awayWinProb;
      dirs[i] = Math.abs(pH - pA) <= STABLE_V2_CFG.drawThresh ? 'D' : pH >= pA ? 'H' : 'A';
    }
  } else {
    // Extended future horizon (dist > 0): conserve expected league draws & balanced Home/Away share
    let gwDrawSum = 0;
    for (let i = 0; i < m; i++) {
      gwDrawSum += items[i].proj.drawProb * STABLE_V2_CFG.futDrawScale;
    }
    state.drawAcc += gwDrawSum;
    const nDraws = clamp(Math.round(state.drawAcc), 0, m);
    state.drawAcc -= nDraws;

    const drawRank = items.map((it, idx) => {
      const pH = it.proj.homeWinProb;
      const pD = it.proj.drawProb;
      const pA = it.proj.awayWinProb;
      let llDiff = Math.log(Math.max(1e-6, pD)) - Math.log(Math.max(1e-6, Math.max(pH, pA)));
      const dDefH = (state.clubExpDraws.get(it.homeShort) || 0) + pD - (state.clubPredDraws.get(it.homeShort) || 0);
      const dDefA = (state.clubExpDraws.get(it.awayShort) || 0) + pD - (state.clubPredDraws.get(it.awayShort) || 0);
      llDiff += 0.14 * (dDefH + dDefA);
      return { idx, llDiff };
    });
    drawRank.sort((a, b) => b.llDiff - a.llDiff || a.idx - b.idx);
    const drawSet = new Set<number>(drawRank.slice(0, nDraws).map((r) => r.idx));

    const decisive: Array<{ idx: number; marginAdj: number }> = [];
    let gwExpHome = 0;
    for (let i = 0; i < m; i++) {
      if (drawSet.has(i)) {
        dirs[i] = 'D';
        continue;
      }
      const it = items[i];
      const pH = it.proj.homeWinProb;
      const pA = it.proj.awayWinProb;
      const pD = it.proj.drawProb;
      const ptsExpH = (state.clubExpPts.get(it.homeShort) || 0) + 3 * pH + pD;
      const ptsExpA = (state.clubExpPts.get(it.awayShort) || 0) + 3 * pA + pD;
      const defPtsH = ptsExpH - (state.clubPredPts.get(it.homeShort) || 0);
      const defPtsA = ptsExpA - (state.clubPredPts.get(it.awayShort) || 0);
      const marginAdj =
        Math.log(Math.max(1e-6, pH)) -
        Math.log(Math.max(1e-6, pA)) +
        STABLE_V2_CFG.clubPtsBud * (defPtsH - defPtsA);
      const pWinCond = pH / Math.max(1e-6, pH + pA);
      gwExpHome +=
        STABLE_V2_CFG.hBiasScale * (pH >= pA ? 1 : 0) +
        (1 - STABLE_V2_CFG.hBiasScale) * pWinCond;
      decisive.push({ idx: i, marginAdj });
    }
    state.hShareAcc += gwExpHome;
    const nHome = clamp(Math.round(state.hShareAcc), 0, decisive.length);
    state.hShareAcc -= nHome;
    decisive.sort((a, b) => b.marginAdj - a.marginAdj || a.idx - b.idx);
    for (let j = 0; j < decisive.length; j++) {
      dirs[decisive[j].idx] = j < nHome ? 'H' : 'A';
    }
  }

  const tailFrac = isFutureHorizon ? STABLE_V2_CFG.tailFracFuture : STABLE_V2_CFG.tailFracWalk;

  for (const grp of ['H', 'D', 'A'] as const) {
    const groupIndices: number[] = [];
    for (let i = 0; i < m; i++) {
      if (dirs[i] === grp) groupIndices.push(i);
    }
    const k = groupIndices.length;
    if (k === 0) continue;

    const cands = SCORE_CANDIDATES[grp];
    const sCount = cands.length;
    const candIndexMap = new Map<string, number>(cands.map((c, idx) => [`${c.gh}_${c.ga}`, idx]));
    const resArr = grp === 'H' ? state.resH : grp === 'D' ? state.resD : state.resA;

    const pCondPerMatch: number[][] = new Array(k);
    const targetFloat = new Float64Array(sCount);
    for (let s = 0; s < sCount; s++) targetFloat[s] = resArr[s];

    for (let mi = 0; mi < k; mi++) {
      const it = items[groupIndices[mi]];
      const mat = it.proj.scoreMatrix;
      const pCond = new Array<number>(sCount).fill(0);
      let z = 0;
      if (mat) {
        for (let h = 0; h < mat.length; h++) {
          for (let a = 0; a < (mat[h]?.length ?? 0); a++) {
            const sameGrp = (grp === 'H' && h > a) || (grp === 'D' && h === a) || (grp === 'A' && h < a);
            if (!sameGrp) continue;
            const inBox = h <= STABLE_V2_CFG.maxG && a <= STABLE_V2_CFG.maxG;
            const bh = Math.min(h, STABLE_V2_CFG.maxG);
            const ba = Math.min(a, STABLE_V2_CFG.maxG);
            const sameBoxGrp = (grp === 'H' && bh > ba) || (grp === 'D' && bh === ba) || (grp === 'A' && bh < ba);
            if (!sameBoxGrp) continue;
            const sIdx = candIndexMap.get(`${bh}_${ba}`);
            if (sIdx !== undefined) {
              pCond[sIdx] += Math.max(0, mat[h]?.[a] ?? 0) * (inBox ? 1 : tailFrac);
            }
          }
        }
      }
      for (let s = 0; s < sCount; s++) z += pCond[s];
      if (z <= 1e-12) {
        const unif = 1 / sCount;
        for (let s = 0; s < sCount; s++) pCond[s] = unif;
      } else {
        const invZ = 1 / z;
        for (let s = 0; s < sCount; s++) pCond[s] *= invZ;
      }
      pCondPerMatch[mi] = pCond;
      for (let s = 0; s < sCount; s++) {
        targetFloat[s] += pCond[s];
      }
    }

    // Apportion integer multiset of size K with largest remainder, conserving mass exactly
    const counts = new Int32Array(sCount);
    let totalAssigned = 0;
    for (let s = 0; s < sCount; s++) {
      const base = Math.max(0, Math.floor(targetFloat[s]));
      counts[s] = base;
      totalAssigned += base;
    }
    while (totalAssigned < k) {
      let bestS = 0;
      let bestRem = -Infinity;
      for (let s = 0; s < sCount; s++) {
        const rem = targetFloat[s] - counts[s];
        if (rem > bestRem) {
          bestRem = rem;
          bestS = s;
        }
      }
      counts[bestS]++;
      totalAssigned++;
    }
    while (totalAssigned > k) {
      let worstS = -1;
      let worstRem = Infinity;
      for (let s = 0; s < sCount; s++) {
        if (counts[s] <= 0) continue;
        const rem = targetFloat[s] - counts[s];
        if (rem < worstRem) {
          worstRem = rem;
          worstS = s;
        }
      }
      if (worstS < 0) break;
      counts[worstS]--;
      totalAssigned--;
    }

    for (let s = 0; s < sCount; s++) {
      resArr[s] = targetFloat[s] - counts[s];
    }

    const targetList: Array<{ gh: number; ga: number }> = [];
    for (let s = 0; s < sCount; s++) {
      for (let c = 0; c < counts[s]; c++) {
        targetList.push(cands[s]);
      }
    }

    const costMat: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let mi = 0; mi < k; mi++) {
      const it = items[groupIndices[mi]];
      const pCond = pCondPerMatch[mi];
      const defCsH = isFutureHorizon && it.dist > 0
        ? (state.clubExpCs.get(it.homeShort) || 0) + (it.proj.homeCsProbRaw ?? it.proj.homeCsProb / 100) - (state.clubPredCs.get(it.homeShort) || 0)
        : 0;
      const defCsA = isFutureHorizon && it.dist > 0
        ? (state.clubExpCs.get(it.awayShort) || 0) + (it.proj.awayCsProbRaw ?? it.proj.awayCsProb / 100) - (state.clubPredCs.get(it.awayShort) || 0)
        : 0;

      for (let j = 0; j < k; j++) {
        const { gh, ga } = targetList[j];
        const sIdx = cands.findIndex((c) => c.gh === gh && c.ga === ga);
        const p = sIdx >= 0 ? pCond[sIdx] : 1e-9;
        let cVal = -Math.log(Math.max(1e-9, p)) +
          STABLE_V2_CFG.maeW * (Math.abs(gh - it.proj.lambdaH) + Math.abs(ga - it.proj.lambdaA));
        if (isFutureHorizon && it.dist > 0) {
          if (ga === 0) cVal -= STABLE_V2_CFG.clubCsBud * defCsH;
          if (gh === 0) cVal -= STABLE_V2_CFG.clubCsBud * defCsA;
        }
        costMat[mi][j] = cVal;
      }
    }

    const assign = solveMinCostAssignment(costMat);
    for (let mi = 0; mi < k; mi++) {
      const it = items[groupIndices[mi]];
      const picked = targetList[assign[mi]];
      if (picked) {
        it.proj.homeGoals = picked.gh;
        it.proj.awayGoals = picked.ga;
      }
    }
  }

  // Update per-club continuous vs predicted accumulators (used for dist > 0 future homeostasis)
  for (let i = 0; i < m; i++) {
    const it = items[i];
    const { homeShort, awayShort, proj } = it;
    const expPtsH = 3 * proj.homeWinProb + proj.drawProb;
    const expPtsA = 3 * proj.awayWinProb + proj.drawProb;
    const predPtsH = proj.homeGoals > proj.awayGoals ? 3 : proj.homeGoals === proj.awayGoals ? 1 : 0;
    const predPtsA = proj.awayGoals > proj.homeGoals ? 3 : proj.awayGoals === proj.homeGoals ? 1 : 0;

    state.clubExpPts.set(homeShort, (state.clubExpPts.get(homeShort) || 0) + expPtsH);
    state.clubExpPts.set(awayShort, (state.clubExpPts.get(awayShort) || 0) + expPtsA);
    state.clubPredPts.set(homeShort, (state.clubPredPts.get(homeShort) || 0) + predPtsH);
    state.clubPredPts.set(awayShort, (state.clubPredPts.get(awayShort) || 0) + predPtsA);

    state.clubExpDraws.set(homeShort, (state.clubExpDraws.get(homeShort) || 0) + proj.drawProb);
    state.clubExpDraws.set(awayShort, (state.clubExpDraws.get(awayShort) || 0) + proj.drawProb);
    if (proj.homeGoals === proj.awayGoals) {
      state.clubPredDraws.set(homeShort, (state.clubPredDraws.get(homeShort) || 0) + 1);
      state.clubPredDraws.set(awayShort, (state.clubPredDraws.get(awayShort) || 0) + 1);
    }

    const csH = proj.homeCsProbRaw ?? proj.homeCsProb / 100;
    const csA = proj.awayCsProbRaw ?? proj.awayCsProb / 100;
    state.clubExpCs.set(homeShort, (state.clubExpCs.get(homeShort) || 0) + csH);
    state.clubExpCs.set(awayShort, (state.clubExpCs.get(awayShort) || 0) + csA);
    if (proj.awayGoals === 0) state.clubPredCs.set(homeShort, (state.clubPredCs.get(homeShort) || 0) + 1);
    if (proj.homeGoals === 0) state.clubPredCs.set(awayShort, (state.clubPredCs.get(awayShort) || 0) + 1);
  }
}
