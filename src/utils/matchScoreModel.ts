import { DbPlayerStat } from '../types.ts';
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json';
import {
  ClubFixtureProjection,
  calculateExpectedGcPenalty,
  poissonProb,
} from './projectionModel.ts';

// ============================================================================
// STANDALONE MATCH SCORE, TEAM xG (LAMBDA) & CLUB CLEAN SHEET MODEL
// Completely decoupled from hybridLineupModel.ts (lineup formula remains locked).
// Method:
//   1. Opponent-adjusted Poisson Ridge GLM with pre-season top-14 squad prior
//   2. De-biased Opta match xG + Threat + actual goals + causal non-EPL scores
//   3. Jensen-compensated fixture lambdas (zero mean-inflation bias)
//   4. Dixon-Coles joint probability matrix + Bayes-Risk scoreline selector
//   5. Negative-Binomial clean sheet calibration (accounts for away overdispersion)
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

export interface MatchScoreModelContext {
  maxTrainGw: number;
  cutoffMs: number;
  clubShorts: string[];
  clubIdx: Map<string, number>;
  att: Float64Array;
  def: Float64Array;
  mu: number;
  homeAdv: number;
  jensenLog: number;
}

export interface FitCausalMatchScoreParams {
  clubs: Array<{ id: number; name: string; short: string }>;
  players: DbPlayerStat[];
  eplMatchesByGw: Record<number, any[]>;
  nonEplRecords?: NonEplMatchScoreRecord[];
  maxTrainGw: number;
  cutoffMs?: number;
}

export interface PredictDixonColesOptions {
  gw?: number;
  baseHistoricalGW?: number;
  homeAttMod?: number;
  awayAttMod?: number;
  homeDefMod?: number;
  awayDefMod?: number;
}

const NON_EPL_SCORE_COMP_WEIGHT: Record<string, number> = {
  EU_CL: 0.45,
  EU_UC: 0.40,
  EU_CF: 0.32,
  EN_FA: 0.45,
  EN_FC: 0.45,
  EN_LC: 0.22,
};

const MODEL_CFG = {
  halfLifeGw: 6.5,
  l2: 3.0,
  priorScale: 0.80,
  goalWeight: 0.38,
  xgWeight: 0.50,
  threatWeight: 0.12,
  muPrior: Math.log(1.365),
  homeAdvPrior: 0.22,
  dcRho: -0.06,
  nbDispH: 0.08, // Home team CS variance (vs away attack)
  nbDispA: 0.26, // Away team CS overdispersion (vs home attack)
  mDiffWeight: 0.05,
  exactW: 0.40,
  dirPen: 0.40,
  drawThresh: 0.04,
} as const;

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
 * Builds normalized pre-season club strength prior from top-14 squad cost per club.
 * Deterministic and free of future match outcome leakage.
 */
function buildClubSquadStrengthPrior(
  clubShorts: string[],
  players: DbPlayerStat[]
): Record<string, number> {
  const byClub: Record<string, DbPlayerStat[]> = {};
  for (const p of players) {
    if (!p?.teamShort || p.status === 'u') continue;
    if (!byClub[p.teamShort]) byClub[p.teamShort] = [];
    byClub[p.teamShort].push(p);
  }

  const rawCosts: Record<string, number> = {};
  let sumAll = 0;
  let count = 0;

  for (const short of clubShorts) {
    const arr = [...(byClub[short] || [])].sort((a, b) => (b.nowCost || 40) - (a.nowCost || 40));
    const top14 = arr.slice(0, 14);
    const totalCost =
      top14.length > 0
        ? top14.reduce((s, p) => s + (p.nowCost || 45), 0) / 10
        : 75.0;
    rawCosts[short] = totalCost;
    sumAll += totalCost;
    count++;
  }

  const meanCost = count > 0 ? sumAll / count : 75.0;
  const prior: Record<string, number> = {};
  for (const short of clubShorts) {
    prior[short] = ((rawCosts[short] ?? meanCost) - meanCost) / 28.0;
  }
  return prior;
}

/**
 * Fits a strictly causal opponent-adjusted Poisson Ridge GLM up to `maxTrainGw`
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
    cutoffMs = Number.MAX_SAFE_INTEGER,
  } = params;

  const clubShorts = clubs.map((c) => c.short).filter(Boolean);
  const nC = clubShorts.length;
  const clubIdx = new Map<string, number>(clubShorts.map((s, i) => [s, i]));
  const squadPrior = buildClubSquadStrengthPrior(clubShorts, players);

  interface GlmObs {
    h: number;
    a: number;
    yH: number;
    yA: number;
    w: number;
    hasOpp: boolean;
  }

  const obs: GlmObs[] = [];
  const ingestedEpl = new Set<string>();
  const effTrainGw = Math.max(0, Math.floor(maxTrainGw));

  // 1. Ingest EPL matches strictly <= effTrainGw
  for (let gw = 1; gw <= effTrainGw; gw++) {
    const ageGw = effTrainGw - gw;
    const decay = Math.exp((-Math.LN2 * ageGw) / MODEL_CFG.halfLifeGw);
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
      const hasXg = rawHXg > 0.05 || rawAXg > 0.05;

      // De-bias Opta xG & Threat (away Opta xG averages ~+13.7% above actual away goals)
      const hXgDebiased = rawHXg * 0.965;
      const aXgDebiased = rawAXg * 0.88;
      const hThrSignal = rawHThr * 0.78;
      const aThrSignal = rawAThr * 0.72;

      const yH = hasXg
        ? MODEL_CFG.goalWeight * hScore + MODEL_CFG.xgWeight * hXgDebiased + MODEL_CFG.threatWeight * hThrSignal
        : hScore;
      const yA = hasXg
        ? MODEL_CFG.goalWeight * aScore + MODEL_CFG.xgWeight * aXgDebiased + MODEL_CFG.threatWeight * aThrSignal
        : aScore;

      obs.push({
        h: clubIdx.get(hs)!,
        a: clubIdx.get(as)!,
        yH,
        yA,
        w: decay,
        hasOpp: true,
      });
    }
  }

  // 2. Fallback to precalculated review matches ONLY if missing from live EPL matches
  const precalcList = (precalculatedReviewDataRaw as any)?.matches || [];
  for (const pm of precalcList) {
    if (!pm?.finished || pm.gw > effTrainGw) continue;
    if (!pm.hShort || !pm.aShort || !clubIdx.has(pm.hShort) || !clubIdx.has(pm.aShort)) continue;
    if (ingestedEpl.has(`${pm.gw}_${pm.hShort}_${pm.aShort}`)) continue;
    if (pm.hScore == null || pm.aScore == null) continue;
    ingestedEpl.add(`${pm.gw}_${pm.hShort}_${pm.aShort}`);

    const ageGw = effTrainGw - Number(pm.gw);
    const decay = Math.exp((-Math.LN2 * ageGw) / MODEL_CFG.halfLifeGw);
    obs.push({
      h: clubIdx.get(pm.hShort)!,
      a: clubIdx.get(pm.aShort)!,
      yH: Number(pm.hScore),
      yA: Number(pm.aScore),
      w: decay,
      hasOpp: true,
    });
  }

  // 3. Ingest causal finalized non-EPL match scores strictly before cutoffMs
  const seenNonEplPairs = new Set<string>();
  const halfLifeDays = MODEL_CFG.halfLifeGw * 7;
  for (const rec of nonEplRecords) {
    if (!rec || rec.kickoffMs >= cutoffMs || !clubIdx.has(rec.clubShort)) continue;
    const ageDays = Math.max(0, (cutoffMs - rec.kickoffMs) / 86400000);
    const decay = Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
    const compW = NON_EPL_SCORE_COMP_WEIGHT[rec.compAbbr] ?? 0.25;
    const w = compW * decay;
    if (w <= 0.01) continue;

    const cI = clubIdx.get(rec.clubShort)!;
    const oI = rec.oppShort && clubIdx.has(rec.oppShort) ? clubIdx.get(rec.oppShort)! : -1;
    const gfCap = Math.min(4.0, Math.max(0, rec.teamScore));
    const gaCap = Math.min(4.0, Math.max(0, rec.oppScore));

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
        w,
        hasOpp: true,
      });
    } else {
      obs.push({
        h: rec.isHome ? cI : -1,
        a: rec.isHome ? -1 : cI,
        yH: rec.isHome ? gfCap : gaCap,
        yA: rec.isHome ? gaCap : gfCap,
        w: w * 0.75,
        hasOpp: false,
      });
    }
  }

  // 4. Initialize attack/defense vectors around squad prior & fit Ridge GLM
  const att = new Float64Array(nC);
  const def = new Float64Array(nC);
  const attPrior = new Float64Array(nC);
  const defPrior = new Float64Array(nC);

  for (let i = 0; i < nC; i++) {
    const pStrength = (squadPrior[clubShorts[i]] || 0) * MODEL_CFG.priorScale;
    attPrior[i] = pStrength;
    defPrior[i] = -pStrength * 0.85;
    att[i] = attPrior[i];
    def[i] = defPrior[i];
  }

  let mu: number = MODEL_CFG.muPrior;
  let homeAdv: number = MODEL_CFG.homeAdvPrior;

  if (obs.length > 0 && nC > 1) {
    const l2 = MODEL_CFG.l2;
    for (let iter = 0; iter < 40; iter++) {
      let gMu = 0;
      let hMu = 0;
      let gHa = 0;
      let hHa = 0;

      for (const o of obs) {
        if (!o.hasOpp) continue;
        const lH = Math.exp(Math.max(-2.5, Math.min(2.5, mu + homeAdv * 0.5 + att[o.h] + def[o.a])));
        const lA = Math.exp(Math.max(-2.5, Math.min(2.5, mu - homeAdv * 0.5 + att[o.a] + def[o.h])));
        gMu += o.w * ((lH - o.yH) + (lA - o.yA));
        hMu += o.w * (lH + lA);
        gHa += o.w * 0.5 * ((lH - o.yH) - (lA - o.yA));
        hHa += o.w * 0.25 * (lH + lA);
      }

      gMu += 6.0 * (mu - MODEL_CFG.muPrior);
      hMu += 6.0;
      gHa += 12.0 * (homeAdv - MODEL_CFG.homeAdvPrior);
      hHa += 12.0;

      if (hMu > 0) mu -= gMu / hMu;
      if (hHa > 0) homeAdv -= gHa / hHa;
      homeAdv = Math.max(0.08, Math.min(0.36, homeAdv));

      for (let i = 0; i < nC; i++) {
        let gA = l2 * (att[i] - attPrior[i]);
        let hA = l2;
        let gD = l2 * (def[i] - defPrior[i]);
        let hD = l2;

        for (const o of obs) {
          if (o.h === i) {
            const dOpp = o.a >= 0 ? def[o.a] : 0;
            const aOpp = o.a >= 0 ? att[o.a] : 0;
            const lH = Math.exp(Math.max(-2.5, Math.min(2.5, mu + homeAdv * 0.5 + att[i] + dOpp)));
            const lA = Math.exp(Math.max(-2.5, Math.min(2.5, mu - homeAdv * 0.5 + aOpp + def[i])));
            gA += o.w * (lH - o.yH);
            hA += o.w * lH;
            gD += o.w * (lA - o.yA);
            hD += o.w * lA;
          }
          if (o.a === i) {
            const dOpp = o.h >= 0 ? def[o.h] : 0;
            const aOpp = o.h >= 0 ? att[o.h] : 0;
            const lA = Math.exp(Math.max(-2.5, Math.min(2.5, mu - homeAdv * 0.5 + att[i] + dOpp)));
            const lH = Math.exp(Math.max(-2.5, Math.min(2.5, mu + homeAdv * 0.5 + aOpp + def[i])));
            gA += o.w * (lA - o.yA);
            hA += o.w * lA;
            gD += o.w * (lH - o.yH);
            hD += o.w * lH;
          }
        }

        att[i] -= Math.max(-0.25, Math.min(0.25, gA / hA));
        def[i] -= Math.max(-0.25, Math.min(0.25, gD / hD));
      }

      // Zero-center att & def while shifting mean offset cleanly into mu
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
  }

  // Jensen's inequality compensation across all ordered pairs so E[lambda] equals empirical mean
  let sumExp = 0;
  let pairCount = 0;
  for (let h = 0; h < nC; h++) {
    for (let a = 0; a < nC; a++) {
      if (h === a) continue;
      sumExp += Math.exp(att[h] + def[a]);
      pairCount++;
    }
  }
  const jensenLog = pairCount > 0 ? Math.log(Math.max(1e-6, sumExp / pairCount)) : 0;

  return {
    maxTrainGw: effTrainGw,
    cutoffMs,
    clubShorts,
    clubIdx,
    att,
    def,
    mu,
    homeAdv,
    jensenLog,
  };
}

/**
 * Predicts expected goals (lambdaH, lambdaA), discrete scoreline (Bayes-Risk over Dixon-Coles matrix),
 * Negative-Binomial Clean Sheet %, and Expected Goals Conceded penalty for a single fixture.
 */
export function predictDixonColesFixture(
  model: MatchScoreModelContext,
  homeShort: string,
  awayShort: string,
  opts: PredictDixonColesOptions = {}
): ClubFixtureProjection {
  const hi = model.clubIdx.get(homeShort) ?? -1;
  const ai = model.clubIdx.get(awayShort) ?? -1;

  const baseGw = opts.baseHistoricalGW ?? model.maxTrainGw;
  const targetGw = opts.gw ?? baseGw + 1;
  const dist = Math.max(0, targetGw - (baseGw + 1));
  const horizonShrink = Math.exp(-dist * 0.015);

  const attH = (hi >= 0 ? model.att[hi] : 0) * horizonShrink;
  const defH = (hi >= 0 ? model.def[hi] : 0) * horizonShrink;
  const attA = (ai >= 0 ? model.att[ai] : 0) * horizonShrink;
  const defA = (ai >= 0 ? model.def[ai] : 0) * horizonShrink;

  const homeAttMod = opts.homeAttMod ?? 1.0;
  const awayAttMod = opts.awayAttMod ?? 1.0;
  const homeDefMod = opts.homeDefMod ?? 1.0;
  const awayDefMod = opts.awayDefMod ?? 1.0;

  // Mildly damped horizon-aware Jensen recomputation when shrunk
  const effJensen = dist > 0 ? model.jensenLog * (horizonShrink * horizonShrink) : model.jensenLog;

  let lambdaH = Math.exp(model.mu + model.homeAdv * 0.5 - effJensen + attH + defA) * homeAttMod * awayDefMod;
  let lambdaA = Math.exp(model.mu - model.homeAdv * 0.5 - effJensen + attA + defH) * awayAttMod * homeDefMod;

  lambdaH = Math.min(Math.max(lambdaH, 0.55), 2.75);
  lambdaA = Math.min(Math.max(lambdaA, 0.42), 2.40);

  // Build Dixon-Coles low-score-adjusted bivariate Poisson probability matrix
  const maxG = 6;
  const dcRho = MODEL_CFG.dcRho;
  const pH = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(lambdaH, k));
  const pA = Array.from({ length: maxG + 1 }, (_, k) => poissonProb(lambdaA, k));
  const mat: number[][] = Array.from({ length: maxG + 1 }, () => Array(maxG + 1).fill(0));

  let totP = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      let tau = 1.0;
      if (h === 0 && a === 0) tau = 1 - lambdaH * lambdaA * dcRho;
      else if (h === 0 && a === 1) tau = 1 + lambdaH * dcRho;
      else if (h === 1 && a === 0) tau = 1 + lambdaA * dcRho;
      else if (h === 1 && a === 1) tau = 1 - dcRho;
      const p = Math.max(0, pH[h] * pA[a] * tau);
      mat[h][a] = p;
      totP += p;
    }
  }

  let pWin = 0;
  let pDraw = 0;
  let pLoss = 0;
  const invTot = totP > 0 ? 1 / totP : 1;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      mat[h][a] *= invTot;
      if (h > a) pWin += mat[h][a];
      else if (h === a) pDraw += mat[h][a];
      else pLoss += mat[h][a];
    }
  }

  let bestDir: 'W' | 'D' | 'L' = 'D';
  if (pWin >= pLoss && pWin >= pDraw + MODEL_CFG.drawThresh) bestDir = 'W';
  else if (pLoss > pWin && pLoss >= pDraw + MODEL_CFG.drawThresh) bestDir = 'L';
  else if (Math.max(pWin, pLoss) > pDraw + 0.08) bestDir = pWin >= pLoss ? 'W' : 'L';

  // Bayes-Risk scoreline selection minimizing expected absolute goal errors + result coherence
  let bestH = 1;
  let bestA = 1;
  let bestRisk = Infinity;

  for (let gh = 0; gh <= 5; gh++) {
    for (let ga = 0; ga <= 5; ga++) {
      let expTeamAbs = 0;
      let expMatchAbs = 0;
      for (let h = 0; h <= maxG; h++) {
        for (let a = 0; a <= maxG; a++) {
          const p = mat[h][a];
          expTeamAbs += p * (Math.abs(h - gh) + Math.abs(a - ga));
          expMatchAbs += p * Math.abs((h + a) - (gh + ga));
        }
      }
      const gDir = gh > ga ? 'W' : gh < ga ? 'L' : 'D';
      const dPen = gDir === bestDir ? 0 : MODEL_CFG.dirPen;
      const risk =
        expTeamAbs +
        MODEL_CFG.mDiffWeight * expMatchAbs +
        dPen -
        MODEL_CFG.exactW * mat[gh][ga];
      if (risk < bestRisk) {
        bestRisk = risk;
        bestH = gh;
        bestA = ga;
      }
    }
  }

  // Negative-Binomial zero-goal Clean Sheet calibration
  const homeCsProbRaw = Math.pow(1 + MODEL_CFG.nbDispH * lambdaA, -1 / MODEL_CFG.nbDispH);
  const awayCsProbRaw = Math.pow(1 + MODEL_CFG.nbDispA * lambdaH, -1 / MODEL_CFG.nbDispA);

  return {
    lambdaH,
    lambdaA,
    homeGoals: bestH,
    awayGoals: bestA,
    homeCsProb: Math.round(homeCsProbRaw * 100),
    awayCsProb: Math.round(awayCsProbRaw * 100),
    homeCsProbRaw,
    awayCsProbRaw,
    homeExpGcPenalty: calculateExpectedGcPenalty(lambdaA),
    awayExpGcPenalty: calculateExpectedGcPenalty(lambdaH),
  };
}
