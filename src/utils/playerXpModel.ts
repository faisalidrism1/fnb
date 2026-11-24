import {
  DbPlayerStat,
  DeadBallDutyStatus,
  FplProvenStatus,
  PositionType,
} from '../types.ts';
import {
  FPL_BPS_METRICS,
  FPL_SCORING_TABLE,
  FplPosition,
} from './fplScoring.ts';
import type { CausalAvailability } from './hybridLineupModel.ts';

// ============================================================================
// STAGE 3 PLAYER xP ENGINE: xMin_P7 + P10 SIMPLEX ENSEMBLE + P9 HIT EVALUATOR
// ============================================================================
// Strictly downstream of Stage 1 (hybridLineupModel) & Stage 2 (matchScoreModel).
// Zero-hardcode: All priors, xMin durations, sub-on propensities, BPS tournament
// adjustments, and P10 positional simplex weights are learned causally from
// historical observations (kickoffMs < targetCutoffMs) + past-season EB priors.
// ============================================================================

export type FineRole = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM_W' | 'FWD';

export interface PastSeasonXpRecord {
  id: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
}

export interface Stage3HistoricalAppearance {
  playerId: number;
  gw: number;
  clubShort: string;
  oppShort: string;
  isHome: boolean;
  kickoffMs: number;
  position: FplPosition;
  fineRole: FineRole;
  wasStarter: boolean;
  wasBench: boolean;
  mins: number;
  pts: number;
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  cs: number;
  gc: number;
  saves: number;
  bps: number;
  bonus: number;
  dc: number;
  yc: number;
  rc: number;
  og: number;
  penSaved: number;
  penMissed: number;
}

export interface NonEplClubSideRecord {
  kickoffMs: number;
  compAbbr: string;
  clubShort: string;
  starterIds: Set<number>;
  subOnIds: Set<number>;
  minutesByPlayer: Record<number, number>;
}

export interface Stage1SnapshotForStage3 {
  starterIds: Set<number>;
  benchIds: Set<number>;
  siByPlayer: Map<number, number>;
  baseSiByPlayer: Map<number, number>;
  midweekProofByPlayer: Map<number, boolean>;
  nonEplMins7dByPlayer: Map<number, number>;
  availabilityById: Map<number, CausalAvailability>;
}

export interface Stage2FixtureContext {
  fixtureId?: number;
  gw: number;
  homeShort: string;
  awayShort: string;
  kickoffMs: number;
  kickoffIso: string;
  homeLambda: number;
  awayLambda: number;
  homeCsProb: number;
  awayCsProb: number;
  homeExpGcPenalty: number;
  awayExpGcPenalty: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeCongested72h: boolean;
  awayCongested72h: boolean;
}

export interface Stage3XMinResult {
  pStart: number;
  pStartRaw: number;
  pSubOn: number;
  pPlay: number;
  pPlay60: number;
  muStart: number;
  muCameo: number;
  xMin: number;
}

export interface Stage3PlayerOutput {
  playerId: number;
  xp: number;
  baseXp: number;
  spikeMod: number;
  xMin: number;
  pStart: number;
  pPlay60: number;
  mcQ75: number;
  mcQ85: number;
  mcPHaul10: number;
  mcQuantiles: number[];
  modelPreds: [number, number, number, number, number, number, number, number]; // [P1..P8]
}

export interface CausalStage3Priors {
  starterMinsByPos: Record<FplPosition, number>;
  p60StartByPos: Record<FplPosition, number>;
  subOnRateBenchByPos: Record<FplPosition, number>;
  subOnRateOutByPos: Record<FplPosition, number>;
  subCameoMinsByPos: Record<FplPosition, number>;
  goalRate90ByRole: Record<FineRole, number>;
  assistRate90ByRole: Record<FineRole, number>;
  dcPer90ByRole: Record<FineRole, number>;
  defConScaleByPos: Record<FplPosition, number>;
  bpsBase90ByPos: Record<FplPosition, number>;
  savesPerOppLambdaGkp: number;
  ycPer90ByPos: Record<FplPosition, number>;
  rcPer90ByPos: Record<FplPosition, number>;
  ogPer90ByPos: Record<FplPosition, number>;
  assistsPerGoal: number;
  starterGoalShare: number;
  avgBonusPerMatch: number;
  penRatePerMatch: number;
  penGoalShare: number;
  penSaveRate: number;
  kGoalMins: number;
  kAssistMins: number;
  wXgVsG: number;
  wXaVsA: number;
}

export interface CausalXMinModels {
  starterMinsBeta: Record<FplPosition, number[]>;
  p60Beta: Record<FplPosition, number[]>;
  subOnBeta: Record<FplPosition, number[]>;
  cameoMinsBeta: Record<FplPosition, number[]>;
}

export interface CausalTrainingRow {
  gw: number;
  playerId: number;
  position: FplPosition;
  fineRole: FineRole;
  actualPts: number;
  actualMins: number;
  wasStarter: boolean;
  isCongested72h: boolean;
  modelPreds: [number, number, number, number, number, number, number, number];
  pStart: number;
  pPlay: number;
  pPlay60: number;
  xMin: number;
  expGoals: number;
  expAssists: number;
  csExpected: number;
  bpsSignal: number;
  isPrimaryPen: boolean;
  teamLambda: number;
}

export interface CausalStage3Models {
  priors: CausalStage3Priors;
  xminModels: CausalXMinModels;
  p2ResidualBetaByPos: Record<FplPosition, number[]>;
  p6TailScaleByPos: Record<FplPosition, number>;
  p8CongBetaByPos: Record<FplPosition, number[]>;
  p10WeightsByPos: Record<FplPosition, number[]>;
}

export interface P9HitEvaluationResult {
  viable: boolean;
  netXp1: number;
  pBeatHit4: number;
  meanSimulatedNet1: number;
  reasonCode: 'OK' | 'LOW_NET_XP' | 'LOW_P_BEAT_4' | 'MID_HIGH_VARIANCE';
}

const POSITIONS: FplPosition[] = ['GKP', 'DEF', 'MID', 'FWD'];
const FINE_ROLES: FineRole[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM_W', 'FWD'];
const QUANTILE_PROBS: number[] = Array.from({ length: 16 }, (_, i) => (i + 0.5) / 16);

export interface Stage3TuningConfig {
  // #3 Adaptive 25/26 Fade-Out & Anti-Double-Counting Dead-Ball
  pastFadeMins: number;
  pastRoleFadeMins: number;
  histRecTau: number;
  rawMinsMix: number;
  kGoalMins: number;
  kAssistMins: number;
  dbFade: number;
  dbFloor: number;
  // #4 Stage 2 TeamLambda/WinProb & Bonus/CS Alignment
  goalNormMixAll: number;
  p5WinEdge: number;
  bpsTemp: number;
  bpsMatchMult: number;
  // #5 Recent-GW Calibration & XI Timing
  calibEwmaHalfLife: number;
  calibGlobPriorClubs: number;
  calibPosPriorClubs: number;
  covBeta: number;
  alphaRisk: number;
  benchStartScale: number;
  formGain: number;
}

export const DEFAULT_STAGE3_TUNING: Stage3TuningConfig = {
  pastFadeMins: 720,
  pastRoleFadeMins: 12000,
  histRecTau: 5.5,
  rawMinsMix: 0.68,
  kGoalMins: 320,
  kAssistMins: 360,
  dbFade: 0.85,
  dbFloor: 0.18,
  goalNormMixAll: 1.00,
  p5WinEdge: 11.0,
  bpsTemp: 3.0,
  bpsMatchMult: 1.14,
  calibEwmaHalfLife: 2.0,
  calibGlobPriorClubs: 4,
  calibPosPriorClubs: 5,
  covBeta: 0.78,
  alphaRisk: 0.62,
  benchStartScale: 0.75,
  formGain: 0.30,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sigmoid(x: number): number {
  if (x >= 30) return 1;
  if (x <= -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

function logit(p: number): number {
  const c = clamp(p, 0.005, 0.995);
  return Math.log(c / (1 - c));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function samplePoisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda < 20) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation for high rate
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erfApprox(z / Math.SQRT2));
}

function defConHitProb(expDc: number, threshold: number): number {
  if (!Number.isFinite(expDc) || expDc <= 0 || !Number.isFinite(threshold)) return 0;
  // Slightly over-dispersed Poisson-normal approximation centered at expDc
  const sigma = Math.max(2.0, Math.sqrt(expDc * 1.45));
  return clamp(1 - normalCdf((threshold - 0.5 - expDc) / sigma), 0, 0.96);
}

export function classifyFineRole(pos: PositionType | string, pulsePositionInfo?: string): FineRole {
  const info = (pulsePositionInfo || '').toLowerCase();
  if (pos === 'GKP' || info.includes('goalkeeper')) return 'GK';
  if (pos === 'FWD' || info.includes('striker') || info.includes('centre forward')) return 'FWD';
  if (info.includes('centre back') || info.includes('central defender')) return 'CB';
  if (info.includes('full back') || info.includes('wing back') || info.includes('left back') || info.includes('right back')) return 'FB';
  if (info.includes('defensive midfielder')) return 'DM';
  if (info.includes('attacking midfielder') || info.includes('winger')) return 'AM_W';
  if (info.includes('central midfielder') || info.includes('midfielder')) return 'CM';
  if (pos === 'DEF') return 'CB';
  if (pos === 'MID') return 'CM';
  return 'FWD';
}

// ============================================================================
// LINEAR ALGEBRA & CAUSAL LEARNERS (RIDGE, LOGISTIC, SIMPLEX PROJECTION)
// ============================================================================
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const pivot = Math.abs(M[col][col]) < 1e-9 ? 1e-9 : M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }
  return M.map((row) => row[n]);
}

function fitRidge(X: number[][], y: number[], l2: number, defaultIntercept: number): number[] {
  const d = X[0]?.length || 1;
  if (X.length < Math.max(10, d + 4)) {
    const beta = new Array(d).fill(0);
    beta[0] = y.length > 0 ? y.reduce((s, v) => s + v, 0) / y.length : defaultIntercept;
    return beta;
  }
  const XtX: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const Xty: number[] = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xi = X[i];
    const yi = y[i];
    for (let a = 0; a < d; a++) {
      Xty[a] += xi[a] * yi;
      for (let b = a; b < d; b++) {
        XtX[a][b] += xi[a] * xi[b];
      }
    }
  }
  for (let a = 0; a < d; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += a === 0 ? 1e-3 : l2;
  }
  try {
    const beta = solveLinearSystem(XtX, Xty);
    if (beta.some((v) => !Number.isFinite(v))) {
      const fb = new Array(d).fill(0);
      fb[0] = defaultIntercept;
      return fb;
    }
    return beta;
  } catch {
    const fb = new Array(d).fill(0);
    fb[0] = defaultIntercept;
    return fb;
  }
}

function fitLogistic(X: number[][], y: number[], l2: number, priorProb: number): number[] {
  const d = X[0]?.length || 1;
  const w = new Array(d).fill(0);
  w[0] = logit(priorProb);
  if (X.length < Math.max(12, d + 5)) return w;

  const n = X.length;
  const lr = 0.25;
  for (let iter = 0; iter < 65; iter++) {
    const grad = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * xi[j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < d; j++) grad[j] += err * xi[j];
    }
    for (let j = 0; j < d; j++) {
      const reg = j === 0 ? 0.02 * (w[0] - logit(priorProb)) : (l2 / Math.max(1, n)) * w[j];
      w[j] -= lr * (grad[j] / n + reg);
    }
  }
  return w;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

function projectToSimplex(v: number[]): number[] {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = -1;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (u[i] - t > 0) rho = i;
  }
  let sumRho = 0;
  for (let i = 0; i <= rho; i++) sumRho += u[i];
  const theta = rho >= 0 ? (sumRho - 1) / (rho + 1) : 0;
  return v.map((x) => Math.max(0, x - theta));
}

function fitCausalSimplexWeights(
  preds: number[][],
  actuals: number[],
  priorW: number[],
  minRows: number = 24
): number[] {
  const k = priorW.length;
  if (preds.length < minRows) return [...priorW];

  let w = [...priorW];
  const n = preds.length;
  // Shrinkage decreases gently as observed N grows
  const reg = 24 / Math.max(24, n);
  const lr = 0.018;

  for (let iter = 0; iter < 140; iter++) {
    const grad = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const pi = preds[i];
      let yhat = 0;
      for (let j = 0; j < k; j++) yhat += w[j] * pi[j];
      const diff = yhat - actuals[i];
      // Combined MSE + smooth Huberized MAE gradient for outlier stability
      const absDiff = Math.abs(diff);
      const scaleErr = absDiff <= 3.5 ? diff : Math.sign(diff) * 3.5;
      const lossDeriv = 0.7 * diff + 0.3 * scaleErr;
      for (let j = 0; j < k; j++) grad[j] += lossDeriv * pi[j];
    }
    const nextW = w.map((wj, j) => wj - lr * ((grad[j] / n) + reg * (wj - priorW[j])));
    w = projectToSimplex(nextW);
  }
  return w;
}

// ============================================================================
// CAUSAL HISTORICAL STAT EXTRACTION & CROSS-COMP LOAD
// ============================================================================
export function extractHistoricalAppearances(
  allPlayers: DbPlayerStat[],
  historicalMatchesByGw: Record<number, any[]>,
  precalcPlayers: Record<string, Record<string, { pts: number; mins: number; wasStarter: boolean; wasSub: boolean }>>,
  playerPosSeed: Record<number, string>,
  deadlines: Record<string, string> | undefined,
  maxGw: number,
  minGw: number = 1
): Stage3HistoricalAppearance[] {
  const playerMetaById = new Map<number, DbPlayerStat>(allPlayers.map((p) => [p.id, p]));
  const rows: Stage3HistoricalAppearance[] = [];
  const seenPlayerGwMatch = new Set<string>();
  const effMinGw = Math.max(1, Math.floor(minGw));

  for (let gw = effMinGw; gw <= maxGw; gw++) {
    const matches = historicalMatchesByGw[gw] || [];
    const fallbackKo = deadlines?.[String(gw)] ? Date.parse(deadlines[String(gw)]) : 0;

    for (const m of matches) {
      const koMsRaw = m?.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
      const kickoffMs = Number.isFinite(koMsRaw) && koMsRaw > 0 ? koMsRaw : fallbackKo;
      const hShort = m?.home_team?.short_name || '';
      const aShort = m?.away_team?.short_name || '';
      const matchId = m?.id || `${hShort}_${aShort}`;

      const ingestList = (
        list: any[] | undefined,
        clubShort: string,
        oppShort: string,
        isHome: boolean,
        wasStarter: boolean,
        wasBench: boolean,
        oppGoals: number
      ) => {
        if (!Array.isArray(list)) return;
        const sideSeen = new Set<number>();
        for (const item of list) {
          const pid = Number(item?.id || 0);
          if (!pid || sideSeen.has(pid)) continue;
          sideSeen.add(pid);

          const meta = playerMetaById.get(pid);
          const pos = ((item?.position || meta?.position || 'MID') as FplPosition);
          const pulseInfo = item?.pulse_position_info || playerPosSeed[pid] || meta?.pulsePositionInfo;
          const fineRole = classifyFineRole(pos, pulseInfo);

          const st = item?.stats || {};
          const mins = Number(st.minutes ?? item?.minutes ?? 0);
          const pts = Number(
            typeof item?.gw_points === 'number' ? item.gw_points : (st.total_points ?? 0)
          );
          const goals = Number(st.goals_scored ?? 0);
          const assists = Number(st.assists ?? 0);
          const xg = Number(st.expected_goals ?? 0);
          const xa = Number(st.expected_assists ?? 0);
          const gc = Number(st.goals_conceded ?? 0);
          const csRaw = st.clean_sheets;
          const cs = csRaw !== undefined && csRaw !== null
            ? Number(csRaw)
            : mins >= 60 && oppGoals === 0 ? 1 : 0;
          const saves = Number(st.saves ?? 0);
          const bps = Number(st.bps ?? 0);
          const bonus = Number(st.bonus ?? 0);
          const dc = Number(
            st.defensive_contribution ??
            ((Number(st.clearances_blocks_interceptions || 0) + Number(st.tackles || 0)) +
              (pos === 'MID' || pos === 'FWD' ? Number(st.recoveries || 0) : 0))
          );
          const yc = Number(st.yellow_cards ?? 0);
          const rc = Number(st.red_cards ?? 0);
          const og = Number(st.own_goals ?? 0);
          const penSaved = Number(st.penalties_saved ?? 0);
          const penMissed = Number(st.penalties_missed ?? 0);

          rows.push({
            playerId: pid,
            gw,
            clubShort,
            oppShort,
            isHome,
            kickoffMs,
            position: POSITIONS.includes(pos) ? pos : 'MID',
            fineRole,
            wasStarter,
            wasBench,
            mins,
            pts,
            goals,
            assists,
            xg,
            xa,
            cs,
            gc,
            saves,
            bps,
            bonus,
            dc,
            yc,
            rc,
            og,
            penSaved,
            penMissed,
          });
          seenPlayerGwMatch.add(`${pid}_${gw}_${matchId}`);
          seenPlayerGwMatch.add(`${pid}_${gw}`);
        }
      };

      const hGoals = Number(m?.team_h_score ?? 0);
      const aGoals = Number(m?.team_a_score ?? 0);
      ingestList(m?.home_lineup, hShort, aShort, true, true, false, aGoals);
      ingestList(m?.home_bench, hShort, aShort, true, false, true, aGoals);
      ingestList(m?.away_lineup, aShort, hShort, false, true, false, hGoals);
      ingestList(m?.away_bench, aShort, hShort, false, false, true, hGoals);
    }

    // Fallback to precalculatedReviewData & gwHistory for any missing GWs
    for (const p of allPlayers) {
      if (seenPlayerGwMatch.has(`${p.id}_${gw}`)) continue;
      const pre = precalcPlayers[String(p.id)]?.[String(gw)];
      const h = p.gwHistory?.find((x) => x.round === gw);
      if (!pre && !h) continue;
      const pos = POSITIONS.includes(p.position as FplPosition) ? (p.position as FplPosition) : 'MID';
      const fineRole = classifyFineRole(pos, playerPosSeed[p.id] || p.pulsePositionInfo);
      const mins = Number(h?.minutes ?? pre?.mins ?? 0);
      const pts = Number(h?.points ?? pre?.pts ?? 0);
      const wasStarter = Boolean(pre?.wasStarter ?? mins >= 45);
      const wasBench = Boolean(pre?.wasSub ?? (!wasStarter && mins > 0));
      rows.push({
        playerId: p.id,
        gw,
        clubShort: p.teamShort,
        oppShort: '',
        isHome: true,
        kickoffMs: fallbackKo,
        position: pos,
        fineRole,
        wasStarter,
        wasBench,
        mins,
        pts,
        goals: Number(h?.goals ?? 0),
        assists: Number(h?.assists ?? 0),
        xg: Number(h?.goals ?? 0),
        xa: Number(h?.assists ?? 0),
        cs: Number(h?.cleanSheets ?? 0),
        gc: 0,
        saves: 0,
        bps: Number(h?.bps ?? 0),
        bonus: Number(h?.bonus ?? 0),
        dc: 0,
        yc: 0,
        rc: 0,
        og: 0,
        penSaved: 0,
        penMissed: 0,
      });
      seenPlayerGwMatch.add(`${p.id}_${gw}`);
    }
  }

  return rows;
}

// ============================================================================
// CAUSAL EMPIRICAL BAYES PRIORS (ZERO HARDCODE)
// ============================================================================
export function learnCausalStage3Priors(
  historyBeforeGw: Stage3HistoricalAppearance[],
  allPlayers: DbPlayerStat[],
  pastSeasonMap: Record<string, PastSeasonXpRecord>,
  playerPosSeed: Record<number, string>,
  tuning: Stage3TuningConfig = DEFAULT_STAGE3_TUNING
): CausalStage3Priors {
  const starterMinsAcc: Record<FplPosition, { sum: number; n: number }> = {
    GKP: { sum: 0, n: 0 },
    DEF: { sum: 0, n: 0 },
    MID: { sum: 0, n: 0 },
    FWD: { sum: 0, n: 0 },
  };
  const p60StartAcc: Record<FplPosition, { hit: number; n: number }> = {
    GKP: { hit: 0, n: 0 },
    DEF: { hit: 0, n: 0 },
    MID: { hit: 0, n: 0 },
    FWD: { hit: 0, n: 0 },
  };
  const subBenchAcc: Record<FplPosition, { on: number; n: number; minsSum: number }> = {
    GKP: { on: 0, n: 0, minsSum: 0 },
    DEF: { on: 0, n: 0, minsSum: 0 },
    MID: { on: 0, n: 0, minsSum: 0 },
    FWD: { on: 0, n: 0, minsSum: 0 },
  };
  const roleAcc: Record<
    FineRole,
    { mins: number; goals: number; assists: number; xg: number; xa: number; dc: number }
  > = {
    GK: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    CB: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    FB: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    DM: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    CM: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    AM_W: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
    FWD: { mins: 0, goals: 0, assists: 0, xg: 0, xa: 0, dc: 0 },
  };
  const posRateAcc: Record<
    FplPosition,
    { mins: number; bpsBase: number; yc: number; rc: number; og: number; saves: number; gc: number }
  > = {
    GKP: { mins: 0, bpsBase: 0, yc: 0, rc: 0, og: 0, saves: 0, gc: 0 },
    DEF: { mins: 0, bpsBase: 0, yc: 0, rc: 0, og: 0, saves: 0, gc: 0 },
    MID: { mins: 0, bpsBase: 0, yc: 0, rc: 0, og: 0, saves: 0, gc: 0 },
    FWD: { mins: 0, bpsBase: 0, yc: 0, rc: 0, og: 0, saves: 0, gc: 0 },
  };

  let totalPenEvents = 0;
  let totalPenScoredOrMissed = 0;
  let totalPenSaved = 0;
  let totalClubAppearances = 0;
  let totalGoalsObs = 0;
  let starterGoalsObs = 0;
  let totalAssistsObs = 0;
  let totalBonusObs = 0;

  for (const r of historyBeforeGw) {
    const pos = r.position;
    if (r.wasStarter && r.mins > 0) {
      starterMinsAcc[pos].sum += r.mins;
      starterMinsAcc[pos].n += 1;
      p60StartAcc[pos].n += 1;
      if (r.mins >= 60) p60StartAcc[pos].hit += 1;
      totalClubAppearances += 1;
      starterGoalsObs += r.goals;
    } else if (r.wasBench) {
      subBenchAcc[pos].n += 1;
      if (r.mins > 0) {
        subBenchAcc[pos].on += 1;
        subBenchAcc[pos].minsSum += r.mins;
      }
    }

    if (r.mins > 0) {
      totalGoalsObs += r.goals;
      totalAssistsObs += r.assists;
      totalBonusObs += r.bonus;

      const ra = roleAcc[r.fineRole];
      ra.mins += r.mins;
      ra.goals += r.goals;
      ra.assists += r.assists;
      ra.xg += r.xg > 0 ? r.xg : r.goals;
      ra.xa += r.xa > 0 ? r.xa : r.assists;
      ra.dc += r.dc;

      const pa = posRateAcc[pos];
      pa.mins += r.mins;
      pa.yc += r.yc;
      pa.rc += r.rc;
      pa.og += r.og;
      pa.saves += r.saves;
      pa.gc += r.gc;

      // Remove discrete major event BPS (goals/assists/cs/saves/cards/og/pens/gc) to isolate underlying base BPS
      const goalBpsUnit =
        pos === 'FWD'
          ? FPL_BPS_METRICS.GOAL_SCORED_FWD
          : pos === 'MID'
          ? FPL_BPS_METRICS.GOAL_SCORED_MID
          : FPL_BPS_METRICS.GOAL_SCORED_DEF_GKP;
      const majorBps =
        (r.mins > 60 ? FPL_BPS_METRICS.PLAYING_OVER_60_MINS : FPL_BPS_METRICS.PLAYING_UP_TO_60_MINS) +
        r.goals * goalBpsUnit +
        r.assists * FPL_BPS_METRICS.ASSIST +
        (pos === 'GKP' || pos === 'DEF' ? r.cs * FPL_BPS_METRICS.CLEAN_SHEET_GKP_DEF : 0) +
        r.penSaved * FPL_BPS_METRICS.SAVING_PENALTY +
        r.penMissed * FPL_BPS_METRICS.MISSING_PENALTY +
        r.yc * FPL_BPS_METRICS.YELLOW_CARD +
        r.rc * FPL_BPS_METRICS.RED_CARD +
        r.og * FPL_BPS_METRICS.OWN_GOAL +
        (pos === 'GKP' || pos === 'DEF'
          ? Math.floor(r.gc / 2) * FPL_BPS_METRICS.PER_TWO_GOALS_CONCEDED_GKP_DEF
          : 0) +
        (pos === 'GKP' ? Math.floor(r.saves / 3) * FPL_BPS_METRICS.PER_THREE_SAVES : 0);
      pa.bpsBase += Math.max(0, r.bps - majorBps);
    }

    totalPenSaved += r.penSaved;
    totalPenScoredOrMissed += r.penMissed;
    // Direct pen saves + misses capture roughly 21-25% of all penalties; scale if observed
    totalPenEvents += r.penSaved + r.penMissed;
  }

  // Fold pastSeasonMap cleanly into role priors (Empirical Bayes foundation for GW 1..3)
  const pastRoleAcc: Record<FineRole, { mins: number; goals: number; assists: number }> = {
    GK: { mins: 0, goals: 0, assists: 0 },
    CB: { mins: 0, goals: 0, assists: 0 },
    FB: { mins: 0, goals: 0, assists: 0 },
    DM: { mins: 0, goals: 0, assists: 0 },
    CM: { mins: 0, goals: 0, assists: 0 },
    AM_W: { mins: 0, goals: 0, assists: 0 },
    FWD: { mins: 0, goals: 0, assists: 0 },
  };
  for (const p of allPlayers) {
    const past = pastSeasonMap[String(p.id)];
    if (!past || past.minutes < 180) continue;
    const pos = POSITIONS.includes(p.position as FplPosition) ? (p.position as FplPosition) : 'MID';
    const fr = classifyFineRole(pos, playerPosSeed[p.id] || p.pulsePositionInfo);
    pastRoleAcc[fr].mins += past.minutes;
    pastRoleAcc[fr].goals += past.goals_scored;
    pastRoleAcc[fr].assists += past.assists;
  }

  // Fallback baseline structural priors (only used for smoothing weight N0 before empirical mass dominates)
  const defaultStarterMins: Record<FplPosition, number> = { GKP: 90, DEF: 84, MID: 77, FWD: 76 };
  const defaultP60: Record<FplPosition, number> = { GKP: 0.99, DEF: 0.91, MID: 0.80, FWD: 0.78 };
  const defaultSubOnBench: Record<FplPosition, number> = { GKP: 0.02, DEF: 0.24, MID: 0.56, FWD: 0.60 };
  const defaultCameoMins: Record<FplPosition, number> = { GKP: 25, DEF: 18, MID: 21, FWD: 21 };
  const defaultGoal90: Record<FineRole, number> = { GK: 0.0, CB: 0.05, FB: 0.05, DM: 0.07, CM: 0.14, AM_W: 0.30, FWD: 0.44 };
  const defaultAssist90: Record<FineRole, number> = { GK: 0.005, CB: 0.03, FB: 0.12, DM: 0.08, CM: 0.16, AM_W: 0.24, FWD: 0.17 };
  const defaultDc90: Record<FineRole, number> = { GK: 0, CB: 9.2, FB: 7.4, DM: 10.2, CM: 8.6, AM_W: 6.2, FWD: 4.5 };
  const defaultBpsBase90: Record<FplPosition, number> = { GKP: 10.5, DEF: 9.8, MID: 10.2, FWD: 7.2 };
  const defaultYc90: Record<FplPosition, number> = { GKP: 0.04, DEF: 0.18, MID: 0.17, FWD: 0.13 };

  const starterMinsByPos = {} as Record<FplPosition, number>;
  const p60StartByPos = {} as Record<FplPosition, number>;
  const subOnRateBenchByPos = {} as Record<FplPosition, number>;
  const subOnRateOutByPos = {} as Record<FplPosition, number>;
  const subCameoMinsByPos = {} as Record<FplPosition, number>;
  const bpsBase90ByPos = {} as Record<FplPosition, number>;
  const ycPer90ByPos = {} as Record<FplPosition, number>;
  const rcPer90ByPos = {} as Record<FplPosition, number>;
  const ogPer90ByPos = {} as Record<FplPosition, number>;

  for (const pos of POSITIONS) {
    const s = starterMinsAcc[pos];
    starterMinsByPos[pos] = clamp((s.sum + 18 * defaultStarterMins[pos]) / (s.n + 18), 60, 91);

    const p60 = p60StartAcc[pos];
    p60StartByPos[pos] = clamp((p60.hit + 18 * defaultP60[pos]) / (p60.n + 18), 0.50, 0.995);

    const sb = subBenchAcc[pos];
    subOnRateBenchByPos[pos] = clamp((sb.on + 16 * defaultSubOnBench[pos]) / (sb.n + 16), 0.01, 0.85);
    subOnRateOutByPos[pos] = pos === 'GKP' ? 0.002 : 0.025;
    subCameoMinsByPos[pos] = clamp(
      (sb.minsSum + 10 * defaultCameoMins[pos]) / (sb.on + 10),
      10,
      36
    );

    const pa = posRateAcc[pos];
    bpsBase90ByPos[pos] = (pa.bpsBase + 10 * 90 * (defaultBpsBase90[pos] / 90)) / ((pa.mins + 900) / 90);
    ycPer90ByPos[pos] = (pa.yc + 10 * defaultYc90[pos]) / ((pa.mins + 900) / 90);
    rcPer90ByPos[pos] = (pa.rc + 0.15) / ((pa.mins + 1800) / 90);
    ogPer90ByPos[pos] = (pa.og + 0.08) / ((pa.mins + 2700) / 90);
  }

  const goalRate90ByRole = {} as Record<FineRole, number>;
  const assistRate90ByRole = {} as Record<FineRole, number>;
  const dcPer90ByRole = {} as Record<FineRole, number>;

  for (const fr of FINE_ROLES) {
    const ra = roleAcc[fr];
    const past = pastRoleAcc[fr];
    const roleFade = Number.isFinite(tuning.pastRoleFadeMins)
      ? clamp(1 - ra.mins / Math.max(1, tuning.pastRoleFadeMins), 0.05, 1)
      : 1;
    const pastW = 0.25 * roleFade;
    const obsAttG = 0.65 * ra.xg + 0.35 * ra.goals + pastW * past.goals;
    const obsAttA = 0.65 * ra.xa + 0.35 * ra.assists + pastW * past.assists;
    const effMins = ra.mins + pastW * past.mins + 1200;
    goalRate90ByRole[fr] = ((obsAttG + (1200 / 90) * defaultGoal90[fr]) / effMins) * 90;
    assistRate90ByRole[fr] = ((obsAttA + (1200 / 90) * defaultAssist90[fr]) / effMins) * 90;
    dcPer90ByRole[fr] = ((ra.dc + (1200 / 90) * defaultDc90[fr]) / (ra.mins + 1200)) * 90;
  }

  const dcActualHits: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const dcExpHits: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const r of historyBeforeGw) {
    if (r.mins <= 0 || r.position === 'GKP') continue;
    const pos = r.position;
    const thresh = FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.THRESHOLDS[pos];
    if (r.dc >= thresh) dcActualHits[pos] += 1;
    dcExpHits[pos] += defConHitProb(dcPer90ByRole[r.fineRole] * (r.mins / 90), thresh);
  }
  const defConScaleByPos: Record<FplPosition, number> = {
    GKP: 1.0,
    DEF: clamp((dcActualHits.DEF + 25) / (dcExpHits.DEF + 25), 0.78, 1.32),
    MID: clamp((dcActualHits.MID + 25) / (dcExpHits.MID + 25), 0.78, 1.32),
    FWD: clamp((dcActualHits.FWD + 25) / (dcExpHits.FWD + 25), 0.78, 1.32),
  };

  const gkpPa = posRateAcc.GKP;
  const savesPerOppLambdaGkp =
    gkpPa.gc > 15
      ? clamp((gkpPa.saves + 28) / (Math.max(gkpPa.gc, 1) + 10), 1.8, 3.6)
      : 2.65;

  const teamMatchesObs = Math.max(1, totalClubAppearances / 11);
  const estMatchesObs = Math.max(1, totalClubAppearances / 22);
  const assistsPerGoal =
    totalGoalsObs >= 10
      ? clamp((totalAssistsObs + 40 * 0.83) / (totalGoalsObs + 40), 0.72, 0.86)
      : 0.83;
  const starterGoalShare =
    totalGoalsObs >= 10
      ? clamp((starterGoalsObs + 30 * 0.83) / (totalGoalsObs + 30), 0.74, 0.92)
      : 0.83;
  const avgBonusPerMatch =
    estMatchesObs >= 8
      ? clamp((totalBonusObs + 20 * 6.0) / (estMatchesObs + 20), 5.0, 6.8)
      : 6.0;

  const estPenRate =
    teamMatchesObs >= 20 && totalPenEvents > 0
      ? clamp((totalPenEvents / 0.22) / teamMatchesObs, 0.08, 0.22)
      : 0.14;
  const estPenSaveRate =
    totalPenSaved + totalPenScoredOrMissed >= 4
      ? clamp((totalPenSaved + 1.0) / (totalPenSaved + totalPenScoredOrMissed + 5.0), 0.12, 0.30)
      : 0.20;

  return {
    starterMinsByPos,
    p60StartByPos,
    subOnRateBenchByPos,
    subOnRateOutByPos,
    subCameoMinsByPos,
    goalRate90ByRole,
    assistRate90ByRole,
    dcPer90ByRole,
    defConScaleByPos,
    bpsBase90ByPos,
    savesPerOppLambdaGkp,
    ycPer90ByPos,
    rcPer90ByPos,
    ogPer90ByPos,
    assistsPerGoal,
    starterGoalShare,
    avgBonusPerMatch,
    penRatePerMatch: estPenRate,
    penGoalShare: 0.78,
    penSaveRate: estPenSaveRate,
    kGoalMins: tuning.kGoalMins,
    kAssistMins: tuning.kAssistMins,
    wXgVsG: 0.68,
    wXaVsA: 0.68,
  };
}

// ============================================================================
// CAUSAL CROSS-COMPETITION FEATURES
// ============================================================================
export interface CrossCompIndex {
  byClub: Map<string, NonEplClubSideRecord[]>;
}

export function buildCrossCompIndex(sides: NonEplClubSideRecord[]): CrossCompIndex {
  const byClub = new Map<string, NonEplClubSideRecord[]>();
  for (const s of sides) {
    if (!s.clubShort) continue;
    const list = byClub.get(s.clubShort) || [];
    list.push(s);
    byClub.set(s.clubShort, list);
  }
  for (const list of byClub.values()) {
    list.sort((a, b) => a.kickoffMs - b.kickoffMs);
  }
  return { byClub };
}

export function computeCausalCrossCompPlayerSignals(
  crossCompIndex: CrossCompIndex,
  clubShort: string,
  targetCutoffMs: number,
  lastEplKoMsByPlayer: Map<number, number>,
  lastEplStartedByPlayer: Map<number, boolean>,
  lastEplMinsByPlayer: Map<number, number>
): { nonEplMins7d: Map<number, number>; midweekProof: Map<number, boolean> } {
  const nonEplMins7d = new Map<number, number>();
  const midweekProof = new Map<number, boolean>();
  const list = crossCompIndex.byClub.get(clubShort);
  if (!list || list.length === 0 || !Number.isFinite(targetCutoffMs) || targetCutoffMs <= 0) {
    return { nonEplMins7d, midweekProof };
  }

  const sevenDaysMs = 7 * 24 * 3600_000;
  for (const s of list) {
    if (s.kickoffMs >= targetCutoffMs) break;
    const isWithin7d = targetCutoffMs - s.kickoffMs <= sevenDaysMs;
    for (const [pidStr, mins] of Object.entries(s.minutesByPlayer)) {
      const pid = Number(pidStr);
      if (!pid || mins <= 0) continue;
      if (isWithin7d) {
        nonEplMins7d.set(pid, (nonEplMins7d.get(pid) || 0) + mins);
      }
      const lastEplKo = lastEplKoMsByPlayer.get(pid) || 0;
      const didNotStartLastEpl = !lastEplStartedByPlayer.get(pid) || (lastEplMinsByPlayer.get(pid) || 0) < 45;
      if (s.kickoffMs > lastEplKo && didNotStartLastEpl && (s.starterIds.has(pid) || mins >= 45)) {
        midweekProof.set(pid, true);
      }
    }
  }
  return { nonEplMins7d, midweekProof };
}

// ============================================================================
// xMin_P7: CAUSAL SI-ANCHORED CALIBRATED MINUTES MODEL
// ============================================================================
interface PlayerHistorySummary {
  startsCount: number;
  startMinsSum: number;
  start60Hits: number;
  benchCount: number;
  subOnCount: number;
  cameoMinsSum: number;
  totalMins: number;
  totalAppearances: number;
  recentStartMins: number;
  recent60Rate: number;
  recentSubOnRate: number;
  recentCameoMins: number;
  lastKoMs: number;
  lastWasStarter: boolean;
  lastMins: number;
  // Performance accumulators strictly causal (< targetGw)
  weightedMins: number;
  weightedGoals: number;
  weightedAssists: number;
  weightedXg: number;
  weightedXa: number;
  weightedDc: number;
  weightedBpsBase: number;
  weightedSaves: number;
  weightedYc: number;
  weightedPts: number;
  ptsSum: number;
  rawGoals: number;
  rawAssists: number;
  rawXg: number;
  rawXa: number;
  rawBps: number;
  rawSaves: number;
  rawYc: number;
  rawDc: number;
  recentPtsDecayed: number;
  recentWeightSum: number;
}

function summarizePlayerCausalHistory(
  historyBeforeGw: Stage3HistoricalAppearance[],
  targetGw: number,
  priors: CausalStage3Priors,
  histRecTau: number = DEFAULT_STAGE3_TUNING.histRecTau
): Map<number, PlayerHistorySummary> {
  const byPlayer = new Map<number, PlayerHistorySummary>();
  const sorted = [...historyBeforeGw].sort((a, b) => a.gw - b.gw || a.kickoffMs - b.kickoffMs);

  for (const r of sorted) {
    let s = byPlayer.get(r.playerId);
    if (!s) {
      s = {
        startsCount: 0,
        startMinsSum: 0,
        start60Hits: 0,
        benchCount: 0,
        subOnCount: 0,
        cameoMinsSum: 0,
        totalMins: 0,
        totalAppearances: 0,
        recentStartMins: priors.starterMinsByPos[r.position],
        recent60Rate: priors.p60StartByPos[r.position],
        recentSubOnRate: priors.subOnRateBenchByPos[r.position],
        recentCameoMins: priors.subCameoMinsByPos[r.position],
        lastKoMs: 0,
        lastWasStarter: false,
        lastMins: 0,
        weightedMins: 0,
        weightedGoals: 0,
        weightedAssists: 0,
        weightedXg: 0,
        weightedXa: 0,
        weightedDc: 0,
        weightedBpsBase: 0,
        weightedSaves: 0,
        weightedYc: 0,
        weightedPts: 0,
        ptsSum: 0,
        rawGoals: 0,
        rawAssists: 0,
        rawXg: 0,
        rawXa: 0,
        rawBps: 0,
        rawSaves: 0,
        rawYc: 0,
        rawDc: 0,
        recentPtsDecayed: 0,
        recentWeightSum: 0,
      };
      byPlayer.set(r.playerId, s);
    }

    const age = Math.max(0, targetGw - 1 - r.gw);
    const recW = Math.exp(-age / Math.max(1, histRecTau));
    const formW = Math.exp(-age / 3.8);

    if (r.wasStarter && r.mins > 0) {
      s.startsCount += 1;
      s.startMinsSum += r.mins;
      if (r.mins >= 60) s.start60Hits += 1;
      s.recentStartMins = 0.65 * s.recentStartMins + 0.35 * r.mins;
      s.recent60Rate = 0.65 * s.recent60Rate + 0.35 * (r.mins >= 60 ? 1 : 0);
    } else if (r.wasBench) {
      s.benchCount += 1;
      const didSub = r.mins > 0 ? 1 : 0;
      if (didSub) {
        s.subOnCount += 1;
        s.cameoMinsSum += r.mins;
        s.recentCameoMins = 0.65 * s.recentCameoMins + 0.35 * r.mins;
      }
      s.recentSubOnRate = 0.68 * s.recentSubOnRate + 0.32 * didSub;
    }

    if (r.mins > 0) {
      s.totalAppearances += 1;
      s.totalMins += r.mins;
      s.weightedMins += r.mins * recW;
      s.weightedGoals += r.goals * recW;
      s.weightedAssists += r.assists * recW;
      s.weightedXg += (r.xg > 0 ? r.xg : r.goals) * recW;
      s.weightedXa += (r.xa > 0 ? r.xa : r.assists) * recW;
      s.weightedDc += r.dc * recW;
      s.weightedSaves += r.saves * recW;
      s.weightedYc += r.yc * recW;

      const pos = r.position;
      const goalBpsUnit =
        pos === 'FWD'
          ? FPL_BPS_METRICS.GOAL_SCORED_FWD
          : pos === 'MID'
          ? FPL_BPS_METRICS.GOAL_SCORED_MID
          : FPL_BPS_METRICS.GOAL_SCORED_DEF_GKP;
      const majorBps =
        (r.mins > 60 ? FPL_BPS_METRICS.PLAYING_OVER_60_MINS : FPL_BPS_METRICS.PLAYING_UP_TO_60_MINS) +
        r.goals * goalBpsUnit +
        r.assists * FPL_BPS_METRICS.ASSIST +
        (pos === 'GKP' || pos === 'DEF' ? r.cs * FPL_BPS_METRICS.CLEAN_SHEET_GKP_DEF : 0) +
        r.penSaved * FPL_BPS_METRICS.SAVING_PENALTY +
        r.penMissed * FPL_BPS_METRICS.MISSING_PENALTY +
        r.yc * FPL_BPS_METRICS.YELLOW_CARD +
        r.rc * FPL_BPS_METRICS.RED_CARD +
        r.og * FPL_BPS_METRICS.OWN_GOAL +
        (pos === 'GKP' || pos === 'DEF'
          ? Math.floor(r.gc / 2) * FPL_BPS_METRICS.PER_TWO_GOALS_CONCEDED_GKP_DEF
          : 0) +
        (pos === 'GKP' ? Math.floor(r.saves / 3) * FPL_BPS_METRICS.PER_THREE_SAVES : 0);
      const baseBps = Math.max(0, r.bps - majorBps);
      s.weightedBpsBase += baseBps * recW;

      s.rawGoals += r.goals;
      s.rawAssists += r.assists;
      s.rawXg += r.xg > 0 ? r.xg : r.goals;
      s.rawXa += r.xa > 0 ? r.xa : r.assists;
      s.rawBps += r.bps;
      s.rawSaves += r.saves;
      s.rawYc += r.yc;
      s.rawDc += r.dc;
    }

    s.ptsSum += r.pts;
    s.weightedPts += r.pts * recW;
    s.recentPtsDecayed += r.pts * formW;
    s.recentWeightSum += formW;

    if (r.kickoffMs >= s.lastKoMs) {
      s.lastKoMs = r.kickoffMs;
      s.lastWasStarter = r.wasStarter;
      s.lastMins = r.mins;
    }
  }

  return byPlayer;
}

export interface XMinObsSample {
  position: FplPosition;
  wasStarter: boolean;
  actualMins: number;
  starterFeat: number[];
  p60Feat: number[];
  subOnFeat: number[];
  cameoFeat: number[];
}

export function fitCausalXMinModels(
  samples: XMinObsSample[],
  priors: CausalStage3Priors
): CausalXMinModels {
  const starterMinsBeta = {} as Record<FplPosition, number[]>;
  const p60Beta = {} as Record<FplPosition, number[]>;
  const subOnBeta = {} as Record<FplPosition, number[]>;
  const cameoMinsBeta = {} as Record<FplPosition, number[]>;

  for (const pos of POSITIONS) {
    const posSamples = samples.filter((s) => s.position === pos);
    const stRows = posSamples.filter((s) => s.wasStarter && s.actualMins > 0);
    const nonStRows = posSamples.filter((s) => !s.wasStarter);
    const cameoRows = nonStRows.filter((s) => s.actualMins > 0);

    starterMinsBeta[pos] = fitRidge(
      stRows.map((s) => s.starterFeat),
      stRows.map((s) => s.actualMins),
      8.0,
      priors.starterMinsByPos[pos]
    );
    p60Beta[pos] = fitLogistic(
      stRows.map((s) => s.p60Feat),
      stRows.map((s) => (s.actualMins >= 60 ? 1 : 0)),
      4.0,
      priors.p60StartByPos[pos]
    );
    subOnBeta[pos] = fitLogistic(
      nonStRows.map((s) => s.subOnFeat),
      nonStRows.map((s) => (s.actualMins > 0 ? 1 : 0)),
      5.0,
      priors.subOnRateBenchByPos[pos]
    );
    cameoMinsBeta[pos] = fitRidge(
      cameoRows.map((s) => s.cameoFeat),
      cameoRows.map((s) => s.actualMins),
      6.0,
      priors.subCameoMinsByPos[pos]
    );
  }

  return { starterMinsBeta, p60Beta, subOnBeta, cameoMinsBeta };
}

function buildXMinFeatureVectors(
  pos: FplPosition,
  hist: PlayerHistorySummary | undefined,
  priors: CausalStage3Priors,
  isBenchPredicted: boolean,
  isCongested72h: boolean,
  nonEplMins7d: number,
  midweekProof: boolean,
  isDoubtful: boolean,
  recentStartRate: number
) {
  const priorStMins = priors.starterMinsByPos[pos];
  const stCount = hist?.startsCount || 0;
  const meanStMins = stCount > 0 ? hist!.startMinsSum / stCount : priorStMins;
  const shrunkStMins = (stCount * meanStMins + 3 * priorStMins) / (stCount + 3);
  const blendedStMins = hist ? 0.65 * shrunkStMins + 0.35 * hist.recentStartMins : priorStMins;

  const priorP60 = priors.p60StartByPos[pos];
  const mean60 = stCount > 0 ? hist!.start60Hits / stCount : priorP60;
  const shrunk60 = (stCount * mean60 + 3 * priorP60) / (stCount + 3);

  const priorSubRate = isBenchPredicted ? priors.subOnRateBenchByPos[pos] : priors.subOnRateOutByPos[pos];
  const bCount = hist?.benchCount || 0;
  const meanSubRate = bCount > 0 ? hist!.subOnCount / bCount : priorSubRate;
  const shrunkSubRate = (bCount * meanSubRate + 3 * priorSubRate) / (bCount + 3);

  const priorCameo = priors.subCameoMinsByPos[pos];
  const camCount = hist?.subOnCount || 0;
  const meanCameo = camCount > 0 ? hist!.cameoMinsSum / camCount : priorCameo;
  const shrunkCameo = (camCount * meanCameo + 3 * priorCameo) / (camCount + 3);

  const starterFeat = [
    1,
    (blendedStMins - priorStMins) / 10,
    isCongested72h ? 1 : 0,
    clamp(nonEplMins7d / 180, 0, 1.5),
    midweekProof ? 1 : 0,
    isDoubtful ? 1 : 0,
  ];
  const p60Feat = [
    1,
    (blendedStMins - 60) / 15,
    shrunk60 - priorP60,
    isCongested72h ? 1 : 0,
  ];
  const subOnFeat = [
    1,
    isBenchPredicted ? 1 : 0,
    shrunkSubRate - priorSubRate,
    clamp(recentStartRate, 0, 1),
    midweekProof ? 1 : 0,
    isCongested72h ? 1 : 0,
    isDoubtful ? 1 : 0,
  ];
  const cameoFeat = [
    1,
    (shrunkCameo - priorCameo) / 8,
    isBenchPredicted ? 1 : 0,
    midweekProof ? 1 : 0,
  ];

  return { starterFeat, p60Feat, subOnFeat, cameoFeat };
}

export function predictCalibratedXMinP7(params: {
  pos: FplPosition;
  gwSiProb: number;
  gwIsOut: boolean;
  availFactor: number;
  isStarterPredicted?: boolean;
  isBenchPredicted: boolean;
  isCongested72h: boolean;
  nonEplMins7d: number;
  midweekProof: boolean;
  isDoubtful: boolean;
  recentStartRate: number;
  hist: PlayerHistorySummary | undefined;
  priors: CausalStage3Priors;
  xminModels: CausalXMinModels;
  horizonOffset?: number;
  tuning?: Stage3TuningConfig;
}): { xMinRes: Stage3XMinResult; feats: ReturnType<typeof buildXMinFeatureVectors> } {
  const {
    pos,
    gwSiProb,
    gwIsOut,
    availFactor,
    isStarterPredicted = false,
    isBenchPredicted,
    isCongested72h,
    nonEplMins7d,
    midweekProof,
    isDoubtful,
    recentStartRate,
    hist,
    priors,
    xminModels,
    horizonOffset = 0,
    tuning = DEFAULT_STAGE3_TUNING,
  } = params;

  const feats = buildXMinFeatureVectors(
    pos,
    hist,
    priors,
    isBenchPredicted,
    isCongested72h,
    nonEplMins7d,
    midweekProof,
    isDoubtful,
    recentStartRate
  );

  if (gwIsOut || availFactor <= 0 || gwSiProb <= 0) {
    return {
      xMinRes: { pStart: 0, pStartRaw: 0, pSubOn: 0, pPlay: 0, pPlay60: 0, muStart: 0, muCameo: 0, xMin: 0 },
      feats,
    };
  }

  const pStartRaw = clamp(gwSiProb, 0, 0.995);
  // Preserve starter separation via alphaRisk while attenuating non-starter spillover (benchStartScale)
  const pStart = isStarterPredicted
    ? clamp(1 - tuning.alphaRisk * (1 - pStartRaw), pStartRaw, 0.995)
    : clamp(pStartRaw * tuning.benchStartScale, 0, 0.995);

  const rawMuStart = dot(xminModels.starterMinsBeta[pos], feats.starterFeat);
  const muStart = clamp(
    Number.isFinite(rawMuStart) ? rawMuStart : priors.starterMinsByPos[pos],
    52,
    92
  );

  const p60GivenStart = clamp(sigmoid(dot(xminModels.p60Beta[pos], feats.p60Feat)), 0.30, 0.995);
  const p60Adjusted =
    pos === 'GKP' ? Math.max(0.95, p60GivenStart) : clamp(p60GivenStart, 0.30, 0.99);

  const rawSubProbCond = clamp(sigmoid(dot(xminModels.subOnBeta[pos], feats.subOnFeat)), 0.002, 0.85);
  // Modulate non-starter sub-on probability cleanly by availability and non-bench penalty
  const availDecay = horizonOffset > 0 ? Math.min(1, availFactor + 0.15 * horizonOffset) : availFactor;
  const pSubOnCond = pos === 'GKP'
    ? clamp(rawSubProbCond * 0.25, 0.001, 0.03)
    : clamp(rawSubProbCond * availDecay * (isBenchPredicted ? 1.0 : Math.max(0.25, recentStartRate)), 0.002, 0.78);
  const pSubOn = (1 - pStart) * pSubOnCond;

  const rawMuCameo = dot(xminModels.cameoMinsBeta[pos], feats.cameoFeat);
  const muCameo = clamp(
    Number.isFinite(rawMuCameo) ? rawMuCameo : priors.subCameoMinsByPos[pos],
    8,
    38
  );

  const pPlay = clamp(pStart + pSubOn, 0, 1);
  const pPlay60 = clamp(pStart * p60Adjusted, 0, 0.995);
  const xMin = clamp(pStart * muStart + pSubOn * muCameo, 0, 92);

  return {
    xMinRes: { pStart, pStartRaw, pSubOn, pPlay, pPlay60, muStart, muCameo, xMin },
    feats,
  };
}

// ============================================================================
// CAUSAL PLAYER PER-90 RATE COMPUTATION (ZERO HARDCODE)
// ============================================================================
interface CausalPlayerRates {
  playerId: number;
  position: FplPosition;
  fineRole: FineRole;
  postXg90: number;
  postXa90: number;
  dcPer90: number;
  bpsBase90: number;
  savesPerOppLambda: number;
  ycPer90: number;
  rcPer90: number;
  ogPer90: number;
  formDelta: number;
  regressionBounce: number;
  deadBall: DeadBallDutyStatus;
  proven?: FplProvenStatus;
  xMinRes: Stage3XMinResult;
  isDoubtful: boolean;
  isCongested72h: boolean;
  nonEplMins7d: number;
  midweekProof: boolean;
  horizonOffset: number;
}

function buildCausalRatesForPlayer(params: {
  player: DbPlayerStat;
  fineRole: FineRole;
  hist: PlayerHistorySummary | undefined;
  past: PastSeasonXpRecord | undefined;
  priors: CausalStage3Priors;
  deadBall: DeadBallDutyStatus;
  proven: FplProvenStatus | undefined;
  xMinRes: Stage3XMinResult;
  isDoubtful: boolean;
  isCongested72h: boolean;
  nonEplMins7d: number;
  midweekProof: boolean;
  horizonOffset: number;
  tuning?: Stage3TuningConfig;
}): CausalPlayerRates {
  const {
    player,
    fineRole,
    hist,
    past,
    priors,
    deadBall,
    proven,
    xMinRes,
    isDoubtful,
    isCongested72h,
    nonEplMins7d,
    midweekProof,
    horizonOffset,
    tuning = DEFAULT_STAGE3_TUNING,
  } = params;

  const pos = POSITIONS.includes(player.position as FplPosition)
    ? (player.position as FplPosition)
    : 'MID';

  const roleGoal90 = priors.goalRate90ByRole[fineRole];
  const roleAssist90 = priors.assistRate90ByRole[fineRole];

  const wMins = hist?.weightedMins || 0;
  const rawMins = hist?.totalMins || 0;

  let priorXg90 = roleGoal90;
  let priorXa90 = roleAssist90;
  if (past && past.minutes >= 450) {
    const pastSeasonFade = Number.isFinite(tuning.pastFadeMins)
      ? clamp(1 - rawMins / Math.max(1, tuning.pastFadeMins), 0, 1)
      : 1;
    const pastMinsWeight = clamp(past.minutes / (past.minutes + 900), 0, 0.72) * pastSeasonFade;
    const pastG90 = (past.goals_scored / past.minutes) * 90;
    const pastA90 = (past.assists / past.minutes) * 90;
    priorXg90 = pastMinsWeight * pastG90 + (1 - pastMinsWeight) * roleGoal90;
    priorXa90 = pastMinsWeight * pastA90 + (1 - pastMinsWeight) * roleAssist90;
  }

  const rawMix = clamp(tuning.rawMinsMix, 0, 1);
  const effSampleMins = (1 - rawMix) * wMins + rawMix * rawMins;

  const sampleXg90 =
    wMins > 0
      ? ((priors.wXgVsG * hist!.weightedXg + (1 - priors.wXgVsG) * hist!.weightedGoals) / wMins) * 90
      : priorXg90;
  const sampleXa90 =
    wMins > 0
      ? ((priors.wXaVsA * hist!.weightedXa + (1 - priors.wXaVsA) * hist!.weightedAssists) / wMins) * 90
      : priorXa90;

  const wg = effSampleMins / (effSampleMins + priors.kGoalMins);
  const wa = effSampleMins / (effSampleMins + priors.kAssistMins);
  let postXg90 = pos === 'GKP' ? 0 : Math.max(0.004, wg * sampleXg90 + (1 - wg) * priorXg90);
  let postXa90 = pos === 'GKP' ? Math.max(0.001, wa * sampleXa90 + (1 - wa) * priorXa90) : Math.max(0.004, wa * sampleXa90 + (1 - wa) * priorXa90);

  // Dead-ball additive boost with causal fade as sample xG/xA already embeds pens/set-pieces
  if (pos !== 'GKP') {
    const dbMultG = Math.max(tuning.dbFloor, 1 - tuning.dbFade * wg);
    const dbMultA = Math.max(tuning.dbFloor, 1 - tuning.dbFade * wa);
    if (deadBall.isPrimaryPen) {
      postXg90 += priors.penRatePerMatch * priors.penGoalShare * 0.65 * dbMultG;
    } else if (deadBall.isSecondaryPen) {
      postXg90 += priors.penRatePerMatch * priors.penGoalShare * 0.12 * dbMultG;
    }
    if (deadBall.isFkTaker) {
      postXg90 += 0.025 * dbMultG;
      postXa90 += 0.025 * dbMultA;
    }
    if (deadBall.isCornerTaker) {
      postXa90 += 0.055 * dbMultA;
    }
  }

  const dcPer90 =
    rawMins > 0
      ? ((hist!.weightedDc + (450 / 90) * priors.dcPer90ByRole[fineRole]) / (wMins + 450)) * 90
      : priors.dcPer90ByRole[fineRole];

  const bpsBase90 =
    rawMins > 0
      ? ((hist!.weightedBpsBase + (450 / 90) * priors.bpsBase90ByPos[pos]) / (wMins + 450)) * 90
      : priors.bpsBase90ByPos[pos];

  const savesPerOppLambda =
    pos === 'GKP' && rawMins >= 180
      ? clamp((hist!.rawSaves / Math.max(1, rawMins / 90)) / 1.35, 1.4, 4.0) * 0.55 +
        priors.savesPerOppLambdaGkp * 0.45
      : priors.savesPerOppLambdaGkp;

  const ycPer90 =
    rawMins > 0
      ? ((hist!.weightedYc + (600 / 90) * priors.ycPer90ByPos[pos]) / (wMins + 600)) * 90
      : priors.ycPer90ByPos[pos];

  // Causal form delta & symmetric mild regression bounce strictly from causal history
  let formDelta = 0;
  let regressionBounce = 0;
  if (hist && hist.totalAppearances >= 2) {
    const seasonAvgPts = hist.ptsSum / Math.max(1, hist.totalAppearances);
    const recentAvgPts = hist.recentPtsDecayed / Math.max(0.5, hist.recentWeightSum);
    formDelta = clamp((recentAvgPts - seasonAvgPts) * tuning.formGain, -0.55, 0.70);
    if (formDelta < 0 && proven && proven.guardFactor > 0) {
      formDelta = Math.max(formDelta * (1 - proven.guardFactor), proven.maxBlankDropPenalty);
    }
    const expInv = hist.rawXg + hist.rawXa;
    const actInv = hist.rawGoals + hist.rawAssists;
    const diffInv = expInv - actInv;
    if (diffInv > 0.65) {
      regressionBounce = clamp(diffInv * 0.16, 0, 0.28);
    } else if (diffInv < -0.85) {
      regressionBounce = -clamp((-diffInv - 0.85) * 0.12, 0, 0.22);
    }
  }

  return {
    playerId: player.id,
    position: pos,
    fineRole,
    postXg90,
    postXa90,
    dcPer90,
    bpsBase90,
    savesPerOppLambda,
    ycPer90,
    rcPer90: priors.rcPer90ByPos[pos],
    ogPer90: priors.ogPer90ByPos[pos],
    formDelta,
    regressionBounce,
    deadBall,
    proven,
    xMinRes,
    isDoubtful,
    isCongested72h,
    nonEplMins7d,
    midweekProof,
    horizonOffset,
  };
}

// ============================================================================
// JOINT FIXTURE STAGE 3 EVALUATOR: [P1..P8] + P10 SIMPLEX ENSEMBLE
// ============================================================================
export function createInitialStage3Models(priors: CausalStage3Priors): CausalStage3Models {
  const zeroArr = [0, 0, 0, 0, 0, 0, 0];
  const zeroCong = [0, 0, 0, 0];
  // Balanced prior weights across [P1..P8], slight preference to P1/P2/P7/P3
  const basePriorW = [0.16, 0.15, 0.14, 0.12, 0.10, 0.10, 0.13, 0.10];

  return {
    priors,
    xminModels: fitCausalXMinModels([], priors),
    p2ResidualBetaByPos: {
      GKP: [...zeroArr],
      DEF: [...zeroArr],
      MID: [...zeroArr],
      FWD: [...zeroArr],
    },
    p6TailScaleByPos: { GKP: 0, DEF: 0, MID: 0, FWD: 0 },
    p8CongBetaByPos: {
      GKP: [...zeroCong],
      DEF: [...zeroCong],
      MID: [...zeroCong],
      FWD: [...zeroCong],
    },
    p10WeightsByPos: {
      GKP: [...basePriorW],
      DEF: [...basePriorW],
      MID: [...basePriorW],
      FWD: [...basePriorW],
    },
  };
}

export function refitStage3LearnedComponents(
  baseModels: CausalStage3Models,
  trainingRows: CausalTrainingRow[]
): CausalStage3Models {
  const basePriorW = [0.16, 0.15, 0.14, 0.12, 0.10, 0.10, 0.13, 0.10];
  const p2ResidualBetaByPos = {} as Record<FplPosition, number[]>;
  const p6TailScaleByPos = {} as Record<FplPosition, number>;
  const p8CongBetaByPos = {} as Record<FplPosition, number[]>;
  const p10WeightsByPos = {} as Record<FplPosition, number[]>;

  for (const pos of POSITIONS) {
    const posRows = trainingRows.filter((r) => r.position === pos);
    const activePosRows = posRows.filter((r) => r.pPlay >= 0.10);
    const resFitRows = activePosRows.length >= 24 ? activePosRows : posRows;

    // P2 Residual Ridge: learns residual (actualPts - P7_analytical) on active/played signals
    if (resFitRows.length >= 24) {
      const X2 = resFitRows.map((r) => [
        1,
        r.expGoals,
        r.expAssists,
        r.csExpected,
        r.bpsSignal / 20,
        r.isPrimaryPen ? 1 : 0,
        r.xMin / 90,
      ]);
      const y2 = resFitRows.map((r) => r.actualPts - r.modelPreds[6]);
      p2ResidualBetaByPos[pos] = fitRidge(X2, y2, 35.0, 0);
    } else {
      p2ResidualBetaByPos[pos] = [0, 0, 0, 0, 0, 0, 0];
    }

    // P6 Centered Tail scale: causal correlation between non-linear upside signal & residual
    if (resFitRows.length >= 24) {
      let num = 0;
      let den = 0;
      for (const r of resFitRows) {
        const tailSig = Math.max(0, r.expGoals * 3.0 + r.expAssists * 1.5 - 0.65);
        const res = r.actualPts - r.modelPreds[6];
        num += tailSig * res;
        den += tailSig * tailSig;
      }
      p6TailScaleByPos[pos] = clamp(den > 0.5 ? num / (den + 18) : 0, -0.35, 0.65);
    } else {
      p6TailScaleByPos[pos] = 0;
    }

    // P8 Congestion Ridge residual over congested/play features
    if (resFitRows.length >= 28) {
      const X8 = resFitRows.map((r) => [
        1,
        r.isCongested72h ? 1 : 0,
        r.isCongested72h ? r.xMin / 90 : 0,
        (r.teamLambda - 1.35) * (r.xMin / 90),
      ]);
      const y8 = resFitRows.map((r) => r.actualPts - r.modelPreds[6]);
      p8CongBetaByPos[pos] = fitRidge(X8, y8, 45.0, 0);
    } else {
      p8CongBetaByPos[pos] = [0, 0, 0, 0];
    }

    // P10 Non-negative Simplex weights across [P1..P8]
    p10WeightsByPos[pos] = fitCausalSimplexWeights(
      posRows.map((r) => r.modelPreds),
      posRows.map((r) => r.actualPts),
      basePriorW,
      24
    );
  }

  return {
    priors: baseModels.priors,
    xminModels: baseModels.xminModels,
    p2ResidualBetaByPos,
    p6TailScaleByPos,
    p8CongBetaByPos,
    p10WeightsByPos,
  };
}

function computeFixtureSideModels(params: {
  players: CausalPlayerRates[];
  teamLambda: number;
  oppLambda: number;
  winProb: number;
  lossProb: number;
  csProb: number;
  expGcPenalty: number;
  priors: CausalStage3Priors;
  models: CausalStage3Models;
  tuning: Stage3TuningConfig;
}) {
  const { players, teamLambda, oppLambda, winProb, lossProb, csProb, expGcPenalty, priors, models, tuning } = params;

  // Club expected active goal/assist pool for P4 team-share normalization
  let sumRawGoalMass = 0;
  let sumRawAssistMass = 0;
  for (const p of players) {
    const minsRatio = p.xMinRes.xMin / 90;
    sumRawGoalMass += p.postXg90 * minsRatio;
    sumRawAssistMass += p.postXa90 * minsRatio;
  }

  const goalScaleP4 = sumRawGoalMass > 0.15 ? clamp(teamLambda / sumRawGoalMass, 0.55, 1.55) : 1.0;
  const expectedTeamAssists = teamLambda * priors.assistsPerGoal;
  const assistScaleP4 = sumRawAssistMass > 0.12 ? clamp(expectedTeamAssists / sumRawAssistMass, 0.55, 1.55) : 1.0;
  const goalNormMix = 0.38;
  const topDownMix = clamp(tuning.goalNormMixAll, 0, 1);

  return players.map((p) => {
    const pos = p.position;
    const xm = p.xMinRes;
    const minsRatio = xm.xMin / 90;

    // 1. P7 Analytical Core driven strictly by xMin_P7
    const expApp = xm.pStart * 2.0 + xm.pSubOn * 1.0;
    const goalPtsUnit = FPL_SCORING_TABLE.GOAL_SCORED[pos];
    const assistPtsUnit = FPL_SCORING_TABLE.ASSIST;
    const csPtsUnit = FPL_SCORING_TABLE.CLEAN_SHEET[pos];

    // Opponent defensive environment modulation vs average PL lambda (~1.35)
    const oppDefMod = clamp(Math.pow(Math.max(teamLambda, 0.35) / 1.35, 0.58), 0.55, 1.68);
    const expGoalsRawUnnorm = p.postXg90 * minsRatio * oppDefMod;
    const expAssistsRawUnnorm = p.postXa90 * minsRatio * Math.pow(oppDefMod, 0.85);

    // P4 team-share normalized goals & assists
    const expGoalsP4 = p.postXg90 * minsRatio * goalScaleP4;
    const expAssistsP4 = p.postXa90 * minsRatio * assistScaleP4;

    // Top-down Stage 2 alignment blend across analytical models
    const expGoalsRaw = (1 - topDownMix) * expGoalsRawUnnorm + topDownMix * expGoalsP4;
    const expAssistsRaw = (1 - topDownMix) * expAssistsRawUnnorm + topDownMix * expAssistsP4;

    // Clean Sheet (condition on playing >=60 mins)
    const csPts = xm.pPlay60 * csProb * csPtsUnit;

    // Goals conceded penalty (GKP & DEF: -floor(gc/2) using Stage 2 expGcPenalty scaled by mins)
    const gcPenalty =
      pos === 'GKP' || pos === 'DEF'
        ? -xm.pPlay * Math.max(0, expGcPenalty) * Math.min(1, xm.xMin / 75)
        : 0;

    // GKP Saves (Poisson sum over floor(k/3))
    let savesPts = 0;
    let expSaves = 0;
    if (pos === 'GKP') {
      expSaves = clamp(p.savesPerOppLambda * Math.max(oppLambda, 0.35) * minsRatio, 0.8, 6.8);
      for (let k = 3; k <= 12; k++) {
        savesPts += Math.floor(k / 3) * poissonProb(expSaves, k);
      }
      savesPts *= xm.pPlay;
    }

    // Defensive Contribution (DC / DefCon: DEF>=10 -> +2, MID/FWD>=12 -> +2; no 60m gate)
    let defConPts = 0;
    if (pos !== 'GKP' && xm.pPlay > 0.01) {
      const thresh = FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.THRESHOLDS[pos];
      const oppActivityScale = clamp(Math.pow(Math.max(oppLambda, 0.45) / 1.35, 0.18), 0.86, 1.16);
      const expDcMatch = p.dcPer90 * minsRatio * oppActivityScale;
      defConPts =
        xm.pPlay *
        FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.POINTS *
        priors.defConScaleByPos[pos] *
        defConHitProb(expDcMatch, thresh);
    }

    // Cards & OG
    const ycPenalty = -minsRatio * p.ycPer90;
    const rcPenalty = -minsRatio * p.rcPer90 * 3;
    const ogPenalty = -minsRatio * p.ogPer90 * 2;
    const cardPenalty = ycPenalty + rcPenalty + ogPenalty;

    // Expected Opta BPS signal
    const goalBpsVal =
      pos === 'FWD'
        ? FPL_BPS_METRICS.GOAL_SCORED_FWD
        : pos === 'MID'
        ? FPL_BPS_METRICS.GOAL_SCORED_MID
        : FPL_BPS_METRICS.GOAL_SCORED_DEF_GKP;
    const expBps =
      xm.pPlay * 3 +
      xm.pPlay60 * 3 +
      p.bpsBase90 * minsRatio +
      expGoalsRaw * goalBpsVal +
      expAssistsRaw * FPL_BPS_METRICS.ASSIST +
      (pos === 'GKP' || pos === 'DEF' ? xm.pPlay60 * csProb * FPL_BPS_METRICS.CLEAN_SHEET_GKP_DEF : 0) +
      (pos === 'GKP' ? (expSaves / 3) * FPL_BPS_METRICS.PER_THREE_SAVES * xm.pPlay : 0) +
      (pos === 'GKP' || pos === 'DEF' ? -Math.max(0, oppLambda * 0.5) * 2 * xm.pPlay : 0) -
      minsRatio * p.ycPer90 * 3 +
      xm.pPlay60 * (winProb - lossProb) * tuning.p5WinEdge;

    // Analytical P7 bonus prior (before match-wide tournament scaling)
    const bpsScaledBonusP7 =
      xm.pPlay *
      clamp((Math.max(0, expBps - 11) / 15) * (pos === 'FWD' ? 0.92 : pos === 'MID' ? 0.72 : 0.60), 0, 2.5);

    const p7Analytical = Math.max(
      0,
      expApp +
        expGoalsRaw * goalPtsUnit +
        expAssistsRaw * assistPtsUnit +
        csPts +
        gcPenalty +
        savesPts +
        defConPts +
        bpsScaledBonusP7 +
        cardPenalty
    );

    // P3 Analytical Poisson (uses blended raw & P4 goal/assist expectations + exact penalty expected)
    const expPenMissPen = p.deadBall.isPrimaryPen
      ? -xm.pPlay * priors.penRatePerMatch * (1 - priors.penGoalShare) * 2
      : 0;
    const expPenSaveGkp =
      pos === 'GKP' ? xm.pPlay * priors.penRatePerMatch * priors.penSaveRate * 5 : 0;

    const p3Poisson = Math.max(
      0,
      expApp +
        ((1 - goalNormMix) * expGoalsRaw + goalNormMix * expGoalsP4) * goalPtsUnit +
        ((1 - goalNormMix) * expAssistsRaw + goalNormMix * expAssistsP4) * assistPtsUnit +
        csPts +
        gcPenalty +
        savesPts +
        defConPts +
        bpsScaledBonusP7 +
        cardPenalty +
        expPenMissPen +
        expPenSaveGkp
    );

    // P4 Team-Share Normalized
    const p4TeamShare = Math.max(
      0,
      expApp +
        expGoalsP4 * goalPtsUnit +
        expAssistsP4 * assistPtsUnit +
        csPts +
        gcPenalty +
        savesPts +
        defConPts +
        bpsScaledBonusP7 +
        cardPenalty
    );

    // P2 Conditional Hurdle + Causal Ridge Residual (gated by pPlay)
    const r2Feat = [
      1,
      expGoalsRaw,
      expAssistsRaw,
      csPts,
      expBps / 20,
      p.deadBall.isPrimaryPen ? 1 : 0,
      minsRatio,
    ];
    const p2Residual = dot(models.p2ResidualBetaByPos[pos], r2Feat) * xm.pPlay;
    const p2Hurdle = Math.max(0, p7Analytical + clamp(p2Residual, -1.2, 2.2));

    // P6 Centered Tail-Adjusted
    const tailSig = Math.max(0, expGoalsRaw * 3.0 + expAssistsRaw * 1.5 - 0.65);
    const tailAdj = models.p6TailScaleByPos[pos] * tailSig;
    const formDecay = Math.pow(0.72, Math.max(0, p.horizonOffset));
    const spikeSignal = clamp((p.formDelta + p.regressionBounce) * formDecay, -0.45, 0.55) * Math.min(1, minsRatio * 1.2);
    const p6Tail = Math.max(0, p7Analytical + tailAdj + spikeSignal);

    // P8 Congestion Interaction (gated by pPlay)
    const r8Feat = [
      1,
      p.isCongested72h ? 1 : 0,
      p.isCongested72h ? minsRatio : 0,
      (teamLambda - 1.35) * minsRatio,
    ];
    const p8CongAdj = dot(models.p8CongBetaByPos[pos], r8Feat) * xm.pPlay;
    const p8Copula = Math.max(0, p7Analytical + clamp(p8CongAdj, -1.0, 1.0));

    return {
      player: p,
      expApp,
      expGoalsRaw,
      expAssistsRaw,
      expGoalsP4,
      expAssistsP4,
      csPts,
      gcPenalty,
      savesPts,
      expSaves,
      defConPts,
      bpsScaledBonusP7,
      cardPenalty,
      expBps,
      p2Hurdle,
      p3Poisson,
      p4TeamShare,
      p6Tail,
      p7Analytical,
      p8Copula,
    };
  });
}

export function evaluateFixtureStage3Xp(params: {
  fixture: Stage2FixtureContext;
  homePlayers: CausalPlayerRates[];
  awayPlayers: CausalPlayerRates[];
  models: CausalStage3Models;
  mcIterations: number;
  collectQuantileLadder: boolean;
  tuning?: Stage3TuningConfig;
}): {
  homeOutputs: Map<number, Stage3PlayerOutput>;
  awayOutputs: Map<number, Stage3PlayerOutput>;
} {
  const {
    fixture,
    homePlayers,
    awayPlayers,
    models,
    mcIterations,
    collectQuantileLadder,
    tuning = DEFAULT_STAGE3_TUNING,
  } = params;
  const priors = models.priors;

  const hSide = computeFixtureSideModels({
    players: homePlayers,
    teamLambda: fixture.homeLambda,
    oppLambda: fixture.awayLambda,
    winProb: fixture.homeWinProb,
    lossProb: fixture.awayWinProb,
    csProb: fixture.homeCsProb,
    expGcPenalty: fixture.homeExpGcPenalty,
    priors,
    models,
    tuning,
  });
  const aSide = computeFixtureSideModels({
    players: awayPlayers,
    teamLambda: fixture.awayLambda,
    oppLambda: fixture.homeLambda,
    winProb: fixture.awayWinProb,
    lossProb: fixture.homeWinProb,
    csProb: fixture.awayCsProb,
    expGcPenalty: fixture.awayExpGcPenalty,
    priors,
    models,
    tuning,
  });

  // P5: Causal Softmax Tournament BPS across all active players in this fixture
  const allMatchEntries = [...hSide, ...aSide];
  const bpsScores = allMatchEntries.map((e) => e.expBps);
  const temp = Math.max(1.0, tuning.bpsTemp);
  let expSum = 0;
  const maxBps = bpsScores.length > 0 ? Math.max(...bpsScores) : 0;
  const expWeights = bpsScores.map((b, idx) => {
    if (allMatchEntries[idx].player.xMinRes.pPlay <= 0.01) return 0;
    const w = Math.exp((b - maxBps) / temp);
    expSum += w;
    return w;
  });

  const p5BonusByIdx = allMatchEntries.map((e, idx) => {
    if (expSum <= 0 || e.player.xMinRes.pPlay <= 0.01) return 0;
    const share = expWeights[idx] / expSum;
    return clamp(share * priors.avgBonusPerMatch * tuning.bpsMatchMult, 0, 2.7);
  });

  // P1: Monte Carlo Joint Fixture Simulation
  const M = Math.max(80, mcIterations);
  const seed = hashString(`${fixture.gw}_${fixture.homeShort}_${fixture.awayShort}`);
  const rand = mulberry32(seed);

  const N = allMatchEntries.length;
  const isHomeSide = allMatchEntries.map((_, idx) => idx < hSide.length);
  const simPts = allMatchEntries.map(() => new Float32Array(M));
  const simBonusPts = new Float32Array(N);

  // Normalize player goal/assist share weights within each team (conditioned on playing)
  const computeWeights = (list: typeof hSide, key: 'expGoalsP4' | 'expAssistsP4') => {
    const arr = list.map((x) => {
      const pPlay = Math.max(0.01, x.player.xMinRes.pPlay);
      return Math.max(0.002, x[key] / pPlay);
    });
    return arr;
  };
  const hGoalW = computeWeights(hSide, 'expGoalsP4');
  const aGoalW = computeWeights(aSide, 'expGoalsP4');
  const hAstW = computeWeights(hSide, 'expAssistsP4');
  const aAstW = computeWeights(aSide, 'expAssistsP4');

  const iterBps = new Float32Array(N);
  const iterBasePts = new Float32Array(N);
  const iterGoals = new Uint8Array(N);
  const iterAssists = new Uint8Array(N);
  const orderIdx = Array.from({ length: N }, (_, i) => i);

  for (let m = 0; m < M; m++) {
    // Draw correlated match goal totals (bivariate flavor via shared tempo factor)
    const tempo = 0.88 + rand() * 0.24;
    const hGoalsTotal = samplePoisson(fixture.homeLambda * tempo, rand);
    const aGoalsTotal = samplePoisson(fixture.awayLambda * tempo, rand);

    let hGoalWActive = 0;
    let aGoalWActive = 0;
    let hAstWActive = 0;
    let aAstWActive = 0;

    // 1. Sample player appearance & base non-scoring FPL events
    for (let i = 0; i < N; i++) {
      iterGoals[i] = 0;
      iterAssists[i] = 0;
      const entry = allMatchEntries[i];
      const p = entry.player;
      const xm = p.xMinRes;

      const uApp = rand();
      const started = uApp < xm.pStart;
      const subbedOn = !started && uApp < xm.pStart + xm.pSubOn;
      if (!started && !subbedOn) {
        iterBasePts[i] = 0;
        iterBps[i] = -999;
        continue;
      }

      const played60 = started && rand() < (xm.pStart > 0 ? xm.pPlay60 / xm.pStart : 0);
      const minsDrawn = started
        ? played60
          ? 60 + rand() * 30
          : 30 + rand() * 29
        : Math.max(1, xm.muCameo * (0.6 + rand() * 0.8));
      const mRatio = minsDrawn / 90;

      if (isHomeSide[i]) {
        hGoalWActive += hGoalW[i];
        hAstWActive += hAstW[i];
      } else {
        const ai = i - hSide.length;
        aGoalWActive += aGoalW[ai];
        aAstWActive += aAstW[ai];
      }

      const oppConceded = isHomeSide[i] ? aGoalsTotal : hGoalsTotal;
      const pos = p.position;

      // Clean sheet: starters who play >=60m may leave before late goals slightly (~4% edge)
      const gotCs = played60 && (oppConceded === 0 || (oppConceded === 1 && minsDrawn < 85 && rand() < 0.08));
      const playerGc = oppConceded > 0 ? (played60 ? oppConceded : Math.round(oppConceded * mRatio)) : 0;

      // Saves (GKP)
      const savesDrawn =
        pos === 'GKP'
          ? samplePoisson(Math.max(0.5, entry.expSaves * (0.7 + 0.3 * (oppConceded / Math.max(0.8, isHomeSide[i] ? fixture.awayLambda : fixture.homeLambda)))), rand)
          : 0;

      // DefCon (no 60-minute gate per official FPL scoring rules)
      let dcPtsDrawn = 0;
      let dcCountDrawn = 0;
      if (pos !== 'GKP') {
        const thresh = FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.THRESHOLDS[pos];
        const dcMean = p.dcPer90 * mRatio;
        const hitP = clamp(defConHitProb(dcMean, thresh) * priors.defConScaleByPos[pos], 0, 0.96);
        if (rand() < hitP) dcPtsDrawn = 2;
        dcCountDrawn = Math.round(dcMean);
      }

      const yc = rand() < clamp(p.ycPer90 * mRatio, 0, 0.5) ? 1 : 0;
      const rc = rand() < clamp(p.rcPer90 * mRatio, 0, 0.05) ? 1 : 0;
      const og = rand() < clamp(p.ogPer90 * mRatio, 0, 0.02) ? 1 : 0;

      let pts =
        (played60 ? 2 : 1) +
        (gotCs ? FPL_SCORING_TABLE.CLEAN_SHEET[pos] : 0) +
        (pos === 'GKP' || pos === 'DEF' ? -Math.floor(playerGc / 2) : 0) +
        (pos === 'GKP' ? Math.floor(savesDrawn / 3) : 0) +
        dcPtsDrawn -
        yc -
        rc * 3 -
        og * 2;

      let bps =
        (minsDrawn > 60 ? 6 : 3) +
        p.bpsBase90 * mRatio * (0.78 + rand() * 0.44) +
        (gotCs && (pos === 'GKP' || pos === 'DEF') ? 12 : 0) +
        (pos === 'GKP' || pos === 'DEF' ? -Math.floor(playerGc / 2) * 4 : 0) +
        (pos === 'GKP' ? Math.floor(savesDrawn / 3) * 2 : 0) +
        Math.floor(dcCountDrawn / 3) -
        yc * 3 -
        rc * 9 -
        og * 6;

      iterBasePts[i] = pts;
      iterBps[i] = bps;
    }

    // 2. Allocate Home Goals & Assists across playing Home squad
    const allocateSideGoalsAndAssists = (
      totalG: number,
      startIdx: number,
      endIdx: number,
      goalWeights: number[],
      astWeights: number[],
      gWSum: number,
      aWSum: number
    ) => {
      if (totalG <= 0 || gWSum <= 0) return;
      for (let g = 0; g < totalG; g++) {
        let rG = rand() * gWSum;
        let scorer = -1;
        for (let i = startIdx; i < endIdx; i++) {
          if (iterBps[i] < -500) continue;
          rG -= goalWeights[i - startIdx];
          if (rG <= 0) {
            scorer = i;
            break;
          }
        }
        if (scorer === -1) {
          for (let i = startIdx; i < endIdx; i++) {
            if (iterBps[i] > -500) {
              scorer = i;
              break;
            }
          }
        }
        if (scorer >= 0) {
          iterGoals[scorer] += 1;
          const pos = allMatchEntries[scorer].player.position;
          iterBasePts[scorer] += FPL_SCORING_TABLE.GOAL_SCORED[pos];
          iterBps[scorer] +=
            pos === 'FWD'
              ? FPL_BPS_METRICS.GOAL_SCORED_FWD
              : pos === 'MID'
              ? FPL_BPS_METRICS.GOAL_SCORED_MID
              : FPL_BPS_METRICS.GOAL_SCORED_DEF_GKP;

          // Causal league-learned assist-per-goal propensity
          if (rand() < priors.assistsPerGoal && aWSum > 0) {
            const availA = Math.max(0.0001, aWSum - astWeights[scorer - startIdx]);
            let rA = rand() * availA;
            let assister = -1;
            for (let i = startIdx; i < endIdx; i++) {
              if (i === scorer || iterBps[i] < -500) continue;
              rA -= astWeights[i - startIdx];
              if (rA <= 0) {
                assister = i;
                break;
              }
            }
            if (assister >= 0) {
              iterAssists[assister] += 1;
              iterBasePts[assister] += FPL_SCORING_TABLE.ASSIST;
              iterBps[assister] += FPL_BPS_METRICS.ASSIST;
            }
          }
        }
      }
    };

    allocateSideGoalsAndAssists(hGoalsTotal, 0, hSide.length, hGoalW, hAstW, hGoalWActive, hAstWActive);
    allocateSideGoalsAndAssists(aGoalsTotal, hSide.length, N, aGoalW, aAstW, aGoalWActive, aAstWActive);

    // 3. Official Opta BPS Tournament with Tie-Breaks [3, 2, 1]
    orderIdx.sort((a, b) => iterBps[b] - iterBps[a]);
    let idx = 0;
    let rankPtsAvail = 3;
    while (idx < N && rankPtsAvail >= 1 && iterBps[orderIdx[idx]] > -500) {
      const score = Math.round(iterBps[orderIdx[idx]]);
      let tieEnd = idx + 1;
      while (
        tieEnd < N &&
        iterBps[orderIdx[tieEnd]] > -500 &&
        Math.round(iterBps[orderIdx[tieEnd]]) === score
      ) {
        tieEnd++;
      }
      const ptsAward = rankPtsAvail;
      for (let k = idx; k < tieEnd; k++) {
        iterBasePts[orderIdx[k]] += ptsAward;
        simBonusPts[orderIdx[k]] += ptsAward;
      }
      const tieCount = tieEnd - idx;
      rankPtsAvail -= tieCount;
      idx = tieEnd;
    }

    for (let i = 0; i < N; i++) {
      simPts[i][m] = Math.max(0, iterBasePts[i]);
    }
  }

  // Build final [P1..P8] + P10 outputs per player
  const homeOutputs = new Map<number, Stage3PlayerOutput>();
  const awayOutputs = new Map<number, Stage3PlayerOutput>();

  for (let i = 0; i < N; i++) {
    const entry = allMatchEntries[i];
    const p = entry.player;
    const pos = p.position;

    if (p.xMinRes.pPlay <= 0) {
      const zeroOut: Stage3PlayerOutput = {
        playerId: p.playerId,
        xp: 0,
        baseXp: 0,
        spikeMod: 0,
        xMin: 0,
        pStart: 0,
        pPlay60: 0,
        mcQ75: 0,
        mcQ85: 0,
        mcPHaul10: 0,
        mcQuantiles: collectQuantileLadder ? new Array(QUANTILE_PROBS.length).fill(0) : [],
        modelPreds: [0, 0, 0, 0, 0, 0, 0, 0],
      };
      if (isHomeSide[i]) homeOutputs.set(p.playerId, zeroOut);
      else awayOutputs.set(p.playerId, zeroOut);
      continue;
    }

    const dist = Array.from(simPts[i]).sort((a, b) => a - b);
    let sumSim = 0;
    let haulCount = 0;
    for (let m = 0; m < M; m++) {
      const v = dist[m];
      sumSim += v;
      if (v >= 10) haulCount++;
    }
    const p1Mc = sumSim / M;
    const mcBonMean = simBonusPts[i] / M;
    const blendedBonus = 0.70 * mcBonMean + 0.30 * p5BonusByIdx[i];
    const bonusDelta = blendedBonus - entry.bpsScaledBonusP7;

    const p5Bps = Math.max(
      0,
      entry.expApp +
        entry.expGoalsRaw * FPL_SCORING_TABLE.GOAL_SCORED[pos] +
        entry.expAssistsRaw * FPL_SCORING_TABLE.ASSIST +
        entry.csPts +
        entry.gcPenalty +
        entry.savesPts +
        entry.defConPts +
        blendedBonus +
        entry.cardPenalty
    );

    const p2Adj = Math.max(0, entry.p2Hurdle + 0.50 * bonusDelta);
    const p3Adj = Math.max(0, entry.p3Poisson + 0.70 * bonusDelta);
    const p4Adj = Math.max(0, entry.p4TeamShare + 0.70 * bonusDelta);
    const p6Adj = Math.max(0, entry.p6Tail + 0.70 * bonusDelta);
    const p7Adj = Math.max(0, entry.p7Analytical + 0.70 * bonusDelta);
    const p8Adj = Math.max(0, entry.p8Copula + 0.70 * bonusDelta);

    const modelPreds: [number, number, number, number, number, number, number, number] = [
      p1Mc,
      p2Adj,
      p3Adj,
      p4Adj,
      p5Bps,
      p6Adj,
      p7Adj,
      p8Adj,
    ];

    const weights = models.p10WeightsByPos[pos];
    let p10Raw = 0;
    for (let k = 0; k < 8; k++) {
      p10Raw += weights[k] * modelPreds[k];
    }

    const baseXp = Math.max(0, Math.round(p7Adj * 10) / 10);
    const xp = Math.max(0, Math.round(p10Raw * 10) / 10);
    const spikeMod = Math.round((xp - baseXp) * 10) / 10;

    const q75Raw = dist[Math.min(M - 1, Math.floor(0.75 * M))];
    const q85Raw = dist[Math.min(M - 1, Math.floor(0.85 * M))];
    const mcQ75 = Number(Math.max(xp, q75Raw).toFixed(1));
    const mcQ85 = Number(Math.max(mcQ75, q85Raw).toFixed(1));
    const pHaul10 = haulCount / M;
    const ladder = collectQuantileLadder
      ? QUANTILE_PROBS.map((q) => Number(dist[Math.min(M - 1, Math.floor(q * M))].toFixed(1)))
      : [];

    const output: Stage3PlayerOutput = {
      playerId: p.playerId,
      xp,
      baseXp,
      spikeMod,
      xMin: Number(p.xMinRes.xMin.toFixed(1)),
      pStart: Number(p.xMinRes.pStart.toFixed(3)),
      pPlay60: Number(p.xMinRes.pPlay60.toFixed(3)),
      mcQ75,
      mcQ85,
      mcPHaul10: Number(pHaul10.toFixed(3)),
      mcQuantiles: ladder,
      modelPreds,
    };

    if (isHomeSide[i]) homeOutputs.set(p.playerId, output);
    else awayOutputs.set(p.playerId, output);
  }

  return { homeOutputs, awayOutputs };
}

// ============================================================================
// P9: RISK-AWARE 1-GW -4 HIT EVALUATOR (USES P1 MC QUANTILE LADDERS)
// ============================================================================
export interface P9PolicyThresholds {
  minNetNonMid?: number;
  minNetMid?: number;
  minNetBroken?: number;
  minPBeatNonMid?: number;
  minPBeatMid?: number;
  minPBeatBroken?: number;
  minMultiGwDiff?: number;
  minMultiGwBrokenDiff?: number;
  minMultiGwNet?: number;
}

export function evaluateP9HitTransfer(params: {
  posIn: PositionType | string;
  posOut: PositionType | string;
  inXp1: number;
  outXp1: number;
  inQuantiles?: number[];
  outQuantiles?: number[];
  outIsBroken?: boolean;
  horizonCount: number;
  policyThresholds?: P9PolicyThresholds;
}): P9HitEvaluationResult {
  const {
    posIn,
    inXp1,
    outXp1,
    inQuantiles,
    outQuantiles,
    outIsBroken = false,
    horizonCount,
    policyThresholds,
  } = params;

  const netXp1 = Number((inXp1 - outXp1 - 4.0).toFixed(2));

  // Empirical convolution P(X_in - X_out > 4) across P1 quantile ladders
  let pBeatHit4 = 0;
  let meanSimNet = netXp1;
  if (inQuantiles && inQuantiles.length > 0 && outQuantiles && outQuantiles.length > 0) {
    let beatCount = 0;
    let diffSum = 0;
    const totalPairs = inQuantiles.length * outQuantiles.length;
    for (let i = 0; i < inQuantiles.length; i++) {
      for (let j = 0; j < outQuantiles.length; j++) {
        const d = inQuantiles[i] - outQuantiles[j];
        diffSum += d;
        if (d > 4.0) beatCount++;
      }
    }
    pBeatHit4 = Number((beatCount / totalPairs).toFixed(3));
    meanSimNet = Number((diffSum / totalPairs - 4.0).toFixed(2));
  } else {
    // Smooth analytical fallback if ladders unavailable
    const z = netXp1 / 3.6;
    pBeatHit4 = Number(normalCdf(z).toFixed(3));
  }

  // On multi-GW horizons (3 GW / 6 GW), hit cost amortizes over horizon while preserving P9 risk sanity check
  if (horizonCount > 1) {
    const reqBrokenDiff = policyThresholds?.minMultiGwBrokenDiff ?? 0.6;
    const reqDiff = policyThresholds?.minMultiGwDiff ?? 0.3;
    const reqNet = policyThresholds?.minMultiGwNet ?? -2.2;
    const viable = outIsBroken ? inXp1 - outXp1 >= reqBrokenDiff : inXp1 - outXp1 >= reqDiff || netXp1 >= reqNet;
    return {
      viable,
      netXp1,
      pBeatHit4,
      meanSimulatedNet1: meanSimNet,
      reasonCode: viable ? 'OK' : 'LOW_NET_XP',
    };
  }

  // 1-GW instant -4 hit thresholds: driven by causal walk-forward policyThresholds when available
  const isMid = posIn === 'MID';
  const minNetReq = outIsBroken
    ? (policyThresholds?.minNetBroken ?? 0.5)
    : isMid
    ? (policyThresholds?.minNetMid ?? 2.2)
    : (policyThresholds?.minNetNonMid ?? 1.0);
  const minPBeatReq = outIsBroken
    ? (policyThresholds?.minPBeatBroken ?? 0.42)
    : isMid
    ? (policyThresholds?.minPBeatMid ?? 0.54)
    : (policyThresholds?.minPBeatNonMid ?? 0.48);

  if (netXp1 < minNetReq) {
    return {
      viable: false,
      netXp1,
      pBeatHit4,
      meanSimulatedNet1: meanSimNet,
      reasonCode: 'LOW_NET_XP',
    };
  }
  if (pBeatHit4 < minPBeatReq) {
    return {
      viable: false,
      netXp1,
      pBeatHit4,
      meanSimulatedNet1: meanSimNet,
      reasonCode: isMid ? 'MID_HIGH_VARIANCE' : 'LOW_P_BEAT_4',
    };
  }

  return {
    viable: true,
    netXp1,
    pBeatHit4,
    meanSimulatedNet1: meanSimNet,
    reasonCode: 'OK',
  };
}

// ============================================================================
// ORCHESTRATOR: FULL CAUSAL WALK-FORWARD (GW 1..baseHistoricalGW) + FUTURE (..38)
// ============================================================================
export interface Stage3PipelineInput {
  allPlayers: DbPlayerStat[];
  clubs: Array<{ short: string }>;
  scheduleByGw: Record<number, any[]>;
  historicalMatchesForStats: Record<number, any[]>;
  clubGwMatchProjections: Record<string, any[]>;
  stage1ByGwClub: Map<string, Stage1SnapshotForStage3>;
  nonEplClubSides: NonEplClubSideRecord[];
  pastSeasonMap: Record<string, PastSeasonXpRecord>;
  precalcPlayers: Record<string, Record<string, { pts: number; mins: number; wasStarter: boolean; wasSub: boolean }>>;
  playerPosSeed: Record<number, string>;
  deadlines: Record<string, string> | undefined;
  deadBallByPlayerId: Map<number, DeadBallDutyStatus>;
  provenByPlayerId: Map<number, FplProvenStatus>;
  expectedReturnByPlayerId: Map<number, Date | null>;
  baseHistoricalGW: number;
  minHistoricalGw?: number;
  targetNextGW: number;
  isCurrentGwFinishedOrConfirmed: boolean;
  tuning?: Partial<Stage3TuningConfig>;
}

export interface Stage3FixturePlayerCell {
  oppShort: string;
  isHome: boolean;
  oppLabel: string;
  kickoffTime: string;
  teamLambda: number;
  oppLambda: number;
  csProbPct: number;
  winProb: number;
  drawProb: number;
  lossProb: number;
  isCongested72h: boolean;
  output: Stage3PlayerOutput;
}

const yieldStage3Loop = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });

export async function runFullSeasonStage3ProjectionEngine(input: Stage3PipelineInput): Promise<{
  playerGwMatchesMap: Map<number, Map<number, Stage3FixturePlayerCell[]>>;
  trainedModels: CausalStage3Models;
}> {
  const {
    allPlayers,
    scheduleByGw,
    historicalMatchesForStats,
    clubGwMatchProjections,
    stage1ByGwClub,
    nonEplClubSides,
    pastSeasonMap,
    precalcPlayers,
    playerPosSeed,
    deadlines,
    deadBallByPlayerId,
    provenByPlayerId,
    expectedReturnByPlayerId,
    baseHistoricalGW,
    minHistoricalGw = 1,
    targetNextGW,
    isCurrentGwFinishedOrConfirmed,
    tuning: partialTuning,
  } = input;
  const tuning: Stage3TuningConfig = { ...DEFAULT_STAGE3_TUNING, ...(partialTuning || {}) };
  const effMinHistGw = Math.max(1, Math.floor(minHistoricalGw));
  const effMaxHistGw = Math.max(0, Math.min(baseHistoricalGW, targetNextGW - 1));

  const allPlayersByClub = new Map<string, DbPlayerStat[]>();
  const playerById = new Map<number, DbPlayerStat>();
  for (const p of allPlayers) {
    playerById.set(p.id, p);
    if (!allPlayersByClub.has(p.teamShort)) allPlayersByClub.set(p.teamShort, []);
    allPlayersByClub.get(p.teamShort)!.push(p);
  }

  const allAppearances = extractHistoricalAppearances(
    allPlayers,
    historicalMatchesForStats,
    precalcPlayers,
    playerPosSeed,
    deadlines,
    effMaxHistGw,
    effMinHistGw
  );

  // Deduplicate actual match appearances per (playerId, gw, oppShort) with GW fallback
  const actualAppLookup = new Map<string, Stage3HistoricalAppearance>();
  for (const a of allAppearances) {
    actualAppLookup.set(`${a.playerId}_${a.gw}_${a.oppShort}`, a);
    if (!actualAppLookup.has(`${a.playerId}_${a.gw}`)) {
      actualAppLookup.set(`${a.playerId}_${a.gw}`, a);
    }
  }

  const crossCompIndex = buildCrossCompIndex(nonEplClubSides);

  // Output map: playerId -> gw -> Stage3FixturePlayerCell[]
  const playerGwMatchesMap = new Map<number, Map<number, Stage3FixturePlayerCell[]>>();
  for (const p of allPlayers) {
    playerGwMatchesMap.set(p.id, new Map());
  }

  const xminSamples: XMinObsSample[] = [];
  const stage3TrainingRows: CausalTrainingRow[] = [];

  // Causal walk-forward XI calibration history strictly from gw < targetGw
  interface ClubGwXiObs {
    gw: number;
    actClubXi: number;
    predClubXi: number;
    actByPos: Record<FplPosition, number>;
    predByPos: Record<FplPosition, number>;
  }
  const clubXiObsHistory: ClubGwXiObs[] = [];

  const computeCausalXiCalib = (
    targetGw: number
  ): { globalK: number; posK: Record<FplPosition, number> } => {
    const globPriorClubs = tuning.calibGlobPriorClubs;
    const posPriorClubs = tuning.calibPosPriorClubs;
    const ewmaHalfLife = tuning.calibEwmaHalfLife;
    const avgClubPrior = 40.0;

    if (clubXiObsHistory.length < 10) {
      return { globalK: 1.0, posK: { GKP: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0 } };
    }

    let wActSum = globPriorClubs * avgClubPrior;
    let wPredSum = globPriorClubs * avgClubPrior;

    const wActPos: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const wPredPos: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
    const baselinePosPerClub: Record<FplPosition, number> = {
      GKP: 3.8,
      DEF: 14.5,
      MID: 15.2,
      FWD: 6.5,
    };

    for (const obs of clubXiObsHistory) {
      const age = Math.max(0, targetGw - 1 - obs.gw);
      const w = Math.exp((-age * Math.LN2) / ewmaHalfLife);
      wActSum += w * obs.actClubXi;
      wPredSum += w * obs.predClubXi;
      for (const pos of POSITIONS) {
        wActPos[pos] += w * obs.actByPos[pos];
        wPredPos[pos] += w * obs.predByPos[pos];
      }
    }

    const globalK = clamp(wActSum / Math.max(1, wPredSum), 0.85, 1.28);

    // Compute raw positional residual ratios and mean-normalize so posK does not double-count globalK
    const rawPosK = {} as Record<FplPosition, number>;
    let posMassTotal = 0;
    let weightedRawPosK = 0;
    for (const pos of POSITIONS) {
      const priorMass = posPriorClubs * baselinePosPerClub[pos];
      const rk = clamp(
        (wActPos[pos] + priorMass) / Math.max(1, wPredPos[pos] + priorMass),
        0.78,
        1.24
      );
      rawPosK[pos] = rk;
      const obsMass = Math.max(1, wPredPos[pos]);
      posMassTotal += obsMass;
      weightedRawPosK += obsMass * rk;
    }
    const meanRawPosK = posMassTotal > 0 ? weightedRawPosK / posMassTotal : 1.0;
    const posK = {} as Record<FplPosition, number>;
    for (const pos of POSITIONS) {
      posK[pos] = clamp(rawPosK[pos] / Math.max(0.5, meanRawPosK), 0.80, 1.22);
    }

    return { globalK, posK };
  };

  const applyXiScaleToOutput = (
    out: Stage3PlayerOutput,
    scale: number
  ): Stage3PlayerOutput => {
    if (out.xp <= 0 || Math.abs(scale - 1.0) < 1e-4) return out;
    const scaledXp = Math.max(0, Math.round(out.xp * scale * 10) / 10);
    const scaledBase = Math.max(0, Math.round(out.baseXp * scale * 10) / 10);
    const scaledQ75 = Number(Math.max(scaledXp, out.mcQ75 * scale).toFixed(1));
    const scaledQ85 = Number(Math.max(scaledQ75, out.mcQ85 * scale).toFixed(1));
    const scaledLadder =
      out.mcQuantiles.length > 0
        ? out.mcQuantiles.map((v) => Number((v * scale).toFixed(1)))
        : out.mcQuantiles;
    const scaledPreds = out.modelPreds.map((v) => v * scale) as Stage3PlayerOutput['modelPreds'];
    return {
      ...out,
      xp: scaledXp,
      baseXp: scaledBase,
      spikeMod: Math.round((scaledXp - scaledBase) * 10) / 10,
      mcQ75: scaledQ75,
      mcQ85: scaledQ85,
      mcQuantiles: scaledLadder,
      modelPreds: scaledPreds,
    };
  };

  const computeClubCovLift = (
    prepRates: Array<{ isStarterPredicted: boolean; pStart: number }>
  ): number => {
    let sumStart = 0;
    let cnt = 0;
    for (const r of prepRates) {
      if (r.isStarterPredicted) {
        sumStart += r.pStart;
        cnt++;
      }
    }
    if (cnt === 0) return 1.0;
    const meanStart = clamp(sumStart / cnt, 0.72, 1.0);
    // covBeta recovers conditional XI coverage gap while keeping early GWs balanced
    return clamp(1 + tuning.covBeta * (1 / meanStart - 1), 1.0, 1.28);
  };

  // Initialize models on GW 1 priors (pastSeason + structural priors, zero leakage)
  let currentModels = createInitialStage3Models(
    learnCausalStage3Priors([], allPlayers, pastSeasonMap, playerPosSeed, tuning)
  );

  // 1. CAUSAL WALK-FORWARD ACROSS HISTORICAL GWs (effMinHistGw..effMaxHistGw)
  for (let gw = effMinHistGw; gw <= effMaxHistGw; gw++) {
    await yieldStage3Loop();
    const historyBeforeGw = allAppearances.filter((a) => a.gw >= effMinHistGw && a.gw < gw);
    const priors = learnCausalStage3Priors(historyBeforeGw, allPlayers, pastSeasonMap, playerPosSeed, tuning);
    const { globalK: causalGlobalK, posK: causalPosK } = computeCausalXiCalib(gw);

    if (gw >= 3 && xminSamples.length >= 24) {
      currentModels = {
        ...refitStage3LearnedComponents(currentModels, stage3TrainingRows),
        priors,
        xminModels: fitCausalXMinModels(xminSamples, priors),
      };
    } else {
      currentModels = {
        ...currentModels,
        priors,
        xminModels: fitCausalXMinModels(xminSamples, priors),
      };
    }

    const histSummaryById = summarizePlayerCausalHistory(historyBeforeGw, gw, priors, tuning.histRecTau);
    const lastKoByPlayer = new Map<number, number>();
    const lastStartedByPlayer = new Map<number, boolean>();
    const lastMinsByPlayer = new Map<number, number>();
    for (const [pid, hs] of histSummaryById.entries()) {
      lastKoByPlayer.set(pid, hs.lastKoMs);
      lastStartedByPlayer.set(pid, hs.lastWasStarter);
      lastMinsByPlayer.set(pid, hs.lastMins);
    }

    const gwSchedule = scheduleByGw[gw] || [];
    const seenFixtures = new Set<string>();

    for (const m of gwSchedule) {
      const hShort = m?.home_team?.short_name || '';
      const aShort = m?.away_team?.short_name || '';
      if (!hShort || !aShort) continue;
      const fixKey = `${gw}_${hShort}_${aShort}_${m?.id || ''}`;
      if (seenFixtures.has(fixKey)) continue;
      seenFixtures.add(fixKey);

      const hMatchProj = (clubGwMatchProjections[`${hShort}_${gw}`] || []).find(
        (item: any) => item.oppShort === aShort && item.isHome
      );
      const aMatchProj = (clubGwMatchProjections[`${aShort}_${gw}`] || []).find(
        (item: any) => item.oppShort === hShort && !item.isHome
      );
      if (!hMatchProj || !aMatchProj) continue;

      const koMs = hMatchProj.kickoffTime ? Date.parse(hMatchProj.kickoffTime) : 0;
      const fixtureCtx: Stage2FixtureContext = {
        fixtureId: m.id,
        gw,
        homeShort: hShort,
        awayShort: aShort,
        kickoffMs: Number.isFinite(koMs) ? koMs : 0,
        kickoffIso: hMatchProj.kickoffTime || '',
        homeLambda: hMatchProj.teamLambda,
        awayLambda: aMatchProj.teamLambda,
        homeCsProb: hMatchProj.csProb,
        awayCsProb: aMatchProj.csProb,
        homeExpGcPenalty: hMatchProj.expGcPenalty,
        awayExpGcPenalty: aMatchProj.expGcPenalty,
        homeWinProb: hMatchProj.winProb ?? 0.4,
        drawProb: hMatchProj.drawProb ?? 0.27,
        awayWinProb: aMatchProj.winProb ?? 0.33,
        homeCongested72h: Boolean(hMatchProj.isCongested72h),
        awayCongested72h: Boolean(aMatchProj.isCongested72h),
      };

      const prepareClubRates = (
        clubShort: string,
        isCongested72h: boolean,
        cutoffMs: number
      ) => {
        const squad = allPlayersByClub.get(clubShort) || [];
        const s1 = stage1ByGwClub.get(`${gw}_${clubShort}`);
        const cross = computeCausalCrossCompPlayerSignals(
          crossCompIndex,
          clubShort,
          cutoffMs,
          lastKoByPlayer,
          lastStartedByPlayer,
          lastMinsByPlayer
        );

        const prepared: Array<{
          rates: CausalPlayerRates;
          feats: ReturnType<typeof buildXMinFeatureVectors>;
          isStarterPredicted: boolean;
          isBenchPredicted: boolean;
        }> = [];

        for (const p of squad) {
          const hs = histSummaryById.get(p.id);
          const pos = POSITIONS.includes(p.position as FplPosition)
            ? (p.position as FplPosition)
            : 'MID';
          const fineRole = classifyFineRole(pos, playerPosSeed[p.id] || p.pulsePositionInfo);
          const av = s1?.availabilityById.get(p.id);
          const siPct = s1?.siByPlayer.get(p.id) ?? 0;
          const gwSiProb = clamp(siPct / 100, 0, 0.995);
          const isStarterPredicted = Boolean(s1?.starterIds.has(p.id));
          const isBenchPredicted = Boolean(s1?.benchIds.has(p.id));
          const isDoubtful = av?.status === 'd';
          const gwIsOut = Boolean(av && av.avail <= 0) || gwSiProb <= 0.005;
          const nonEpl7d = Math.max(
            s1?.nonEplMins7dByPlayer.get(p.id) || 0,
            cross.nonEplMins7d.get(p.id) || 0
          );
          const mwProof = Boolean(s1?.midweekProofByPlayer.get(p.id) || cross.midweekProof.get(p.id));
          const recentStartRate = hs
            ? hs.startsCount / Math.max(1, gw - effMinHistGw)
            : gwSiProb;

          const { xMinRes, feats } = predictCalibratedXMinP7({
            pos,
            gwSiProb,
            gwIsOut,
            availFactor: av?.avail ?? 1,
            isStarterPredicted,
            isBenchPredicted,
            isCongested72h,
            nonEplMins7d: nonEpl7d,
            midweekProof: mwProof,
            isDoubtful,
            recentStartRate,
            hist: hs,
            priors,
            xminModels: currentModels.xminModels,
            horizonOffset: 0,
            tuning,
          });

          const rates = buildCausalRatesForPlayer({
            player: p,
            fineRole,
            hist: hs,
            past: pastSeasonMap[String(p.id)],
            priors,
            deadBall: deadBallByPlayerId.get(p.id) || {
              isPrimaryPen: false,
              isSecondaryPen: false,
              isFkTaker: false,
              isCornerTaker: false,
            },
            proven: provenByPlayerId.get(p.id),
            xMinRes,
            isDoubtful,
            isCongested72h,
            nonEplMins7d: nonEpl7d,
            midweekProof: mwProof,
            horizonOffset: 0,
            tuning,
          });

          prepared.push({ rates, feats, isStarterPredicted, isBenchPredicted });
        }
        return prepared;
      };

      const hPrep = prepareClubRates(hShort, fixtureCtx.homeCongested72h, fixtureCtx.kickoffMs);
      const aPrep = prepareClubRates(aShort, fixtureCtx.awayCongested72h, fixtureCtx.kickoffMs);

      const { homeOutputs, awayOutputs } = evaluateFixtureStage3Xp({
        fixture: fixtureCtx,
        homePlayers: hPrep.map((x) => x.rates),
        awayPlayers: aPrep.map((x) => x.rates),
        models: currentModels,
        mcIterations: 160,
        collectQuantileLadder: false,
        tuning,
      });

      const storeAndCollect = (
        clubShort: string,
        prepList: typeof hPrep,
        outMap: Map<number, Stage3PlayerOutput>,
        oppShort: string,
        isHome: boolean,
        teamLambda: number,
        oppLambda: number,
        csProbPct: number,
        winProb: number,
        drawProb: number,
        lossProb: number,
        isCongested: boolean
      ) => {
        const covLift = computeClubCovLift(
          prepList.map((item) => ({
            isStarterPredicted: item.isStarterPredicted,
            pStart: item.rates.xMinRes.pStart,
          }))
        );

        let predClubXi = 0;
        let actClubXi = 0;
        const predByPos: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
        const actByPos: Record<FplPosition, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
        let hasClubActualStarters = false;

        for (const item of prepList) {
          const pid = item.rates.playerId;
          const rawOut = outMap.get(pid);
          if (!rawOut) continue;

          const pos = item.rates.position;
          const calibScale = item.isStarterPredicted
            ? clamp(covLift * causalGlobalK * causalPosK[pos], 0.85, 1.28)
            : 1.0;
          const out = applyXiScaleToOutput(rawOut, calibScale);

          const pGwMap = playerGwMatchesMap.get(pid)!;
          if (!pGwMap.has(gw)) pGwMap.set(gw, []);
          pGwMap.get(gw)!.push({
            oppShort,
            isHome,
            oppLabel: `${oppShort} (${isHome ? 'H' : 'A'})`,
            kickoffTime: fixtureCtx.kickoffIso,
            teamLambda,
            oppLambda,
            csProbPct,
            winProb,
            drawProb,
            lossProb,
            isCongested72h: isCongested,
            output: out,
          });

          // Track cov-lifted raw Stage 3 XI totals BEFORE globalK/posK so causal residual calibration stays unbiased
          if (item.isStarterPredicted) {
            const covOnlyXp = rawOut.xp * covLift;
            predClubXi += covOnlyXp;
            predByPos[pos] += covOnlyXp;
          }

          // Feed causal observation into training buffers AFTER prediction for GW
          const actual =
            actualAppLookup.get(`${pid}_${gw}_${oppShort}`) ?? actualAppLookup.get(`${pid}_${gw}`);
          if (actual) {
            if (actual.wasStarter) {
              hasClubActualStarters = true;
              actClubXi += actual.pts;
              actByPos[actual.position] += actual.pts;
            }
            if (actual.wasStarter || actual.wasBench || actual.mins > 0 || item.rates.xMinRes.pStart >= 0.04) {
              xminSamples.push({
                position: actual.position,
                wasStarter: actual.wasStarter,
                actualMins: actual.mins,
                starterFeat: item.feats.starterFeat,
                p60Feat: item.feats.p60Feat,
                subOnFeat: item.feats.subOnFeat,
                cameoFeat: item.feats.cameoFeat,
              });
            }
            if (item.isStarterPredicted || item.isBenchPredicted || out.pStart >= 0.04) {
              stage3TrainingRows.push({
                gw,
                playerId: pid,
                position: actual.position,
                fineRole: actual.fineRole,
                actualPts: actual.pts,
                actualMins: actual.mins,
                wasStarter: actual.wasStarter,
                isCongested72h: isCongested,
                modelPreds: rawOut.modelPreds,
                pStart: rawOut.pStart,
                pPlay: item.rates.xMinRes.pPlay,
                pPlay60: rawOut.pPlay60,
                xMin: rawOut.xMin,
                expGoals: (item.rates.postXg90 * rawOut.xMin) / 90,
                expAssists: (item.rates.postXa90 * rawOut.xMin) / 90,
                csExpected:
                  rawOut.pPlay60 * (isHome ? fixtureCtx.homeCsProb : fixtureCtx.awayCsProb),
                bpsSignal: (item.rates.bpsBase90 * rawOut.xMin) / 90,
                isPrimaryPen: item.rates.deadBall.isPrimaryPen,
                teamLambda,
              });
            }
          }
        }

        if (hasClubActualStarters && predClubXi > 10) {
          clubXiObsHistory.push({
            gw,
            actClubXi,
            predClubXi,
            actByPos,
            predByPos,
          });
        } else if (clubShort && !hasClubActualStarters) {
          // Skip unplayed/deferred club side from XI calibration history
        }
      };

      storeAndCollect(
        hShort,
        hPrep,
        homeOutputs,
        aShort,
        true,
        fixtureCtx.homeLambda,
        fixtureCtx.awayLambda,
        hMatchProj.csProbPct ?? Math.round(fixtureCtx.homeCsProb * 100),
        fixtureCtx.homeWinProb,
        fixtureCtx.drawProb,
        fixtureCtx.awayWinProb,
        fixtureCtx.homeCongested72h
      );
      storeAndCollect(
        aShort,
        aPrep,
        awayOutputs,
        hShort,
        false,
        fixtureCtx.awayLambda,
        fixtureCtx.homeLambda,
        aMatchProj.csProbPct ?? Math.round(fixtureCtx.awayCsProb * 100),
        fixtureCtx.awayWinProb,
        fixtureCtx.drawProb,
        fixtureCtx.homeWinProb,
        fixtureCtx.awayCongested72h
      );
    }
  }

  // 2. FINAL FIT ON ALL OBSERVED GWs (1..baseHistoricalGW) FOR TARGET & FUTURE GWs (targetNextGW..38)
  const finalPriors = learnCausalStage3Priors(allAppearances, allPlayers, pastSeasonMap, playerPosSeed, tuning);
  const { globalK: finalGlobalK, posK: finalPosK } = computeCausalXiCalib(targetNextGW);
  const finalTrainedModels: CausalStage3Models = {
    ...refitStage3LearnedComponents(currentModels, stage3TrainingRows),
    priors: finalPriors,
    xminModels: fitCausalXMinModels(xminSamples, finalPriors),
  };

  const fullHistSummary = summarizePlayerCausalHistory(allAppearances, targetNextGW, finalPriors, tuning.histRecTau);
  const fullLastKo = new Map<number, number>();
  const fullLastStarted = new Map<number, boolean>();
  const fullLastMins = new Map<number, number>();
  for (const [pid, hs] of fullHistSummary.entries()) {
    fullLastKo.set(pid, hs.lastKoMs);
    fullLastStarted.set(pid, hs.lastWasStarter);
    fullLastMins.set(pid, hs.lastMins);
  }

  // Track club fixture counts per future GW for gentle DGW fatigue scaling
  for (let gw = targetNextGW; gw <= 38; gw++) {
    await yieldStage3Loop();
    const gwSchedule = scheduleByGw[gw] || [];
    const seenFixtures = new Set<string>();
    const clubGwFixCount = new Map<string, number>();
    for (const m of gwSchedule) {
      const h = m?.home_team?.short_name;
      const a = m?.away_team?.short_name;
      if (h) clubGwFixCount.set(h, (clubGwFixCount.get(h) || 0) + 1);
      if (a) clubGwFixCount.set(a, (clubGwFixCount.get(a) || 0) + 1);
    }

    const horizonOffset = Math.max(0, gw - targetNextGW);
    const isImmediateGw = gw === targetNextGW;
    const mcIter = isImmediateGw ? 420 : gw <= targetNextGW + 5 ? 150 : 70;

    for (const m of gwSchedule) {
      const hShort = m?.home_team?.short_name || '';
      const aShort = m?.away_team?.short_name || '';
      if (!hShort || !aShort) continue;
      const fixKey = `${gw}_${hShort}_${aShort}_${m?.id || ''}`;
      if (seenFixtures.has(fixKey)) continue;
      seenFixtures.add(fixKey);

      const hMatchProj = (clubGwMatchProjections[`${hShort}_${gw}`] || []).find(
        (item: any) => item.oppShort === aShort && item.isHome
      );
      const aMatchProj = (clubGwMatchProjections[`${aShort}_${gw}`] || []).find(
        (item: any) => item.oppShort === hShort && !item.isHome
      );
      if (!hMatchProj || !aMatchProj) continue;

      const koMs = hMatchProj.kickoffTime ? Date.parse(hMatchProj.kickoffTime) : 0;
      const fixtureCtx: Stage2FixtureContext = {
        fixtureId: m.id,
        gw,
        homeShort: hShort,
        awayShort: aShort,
        kickoffMs: Number.isFinite(koMs) ? koMs : 0,
        kickoffIso: hMatchProj.kickoffTime || '',
        homeLambda: hMatchProj.teamLambda,
        awayLambda: aMatchProj.teamLambda,
        homeCsProb: hMatchProj.csProb,
        awayCsProb: aMatchProj.csProb,
        homeExpGcPenalty: hMatchProj.expGcPenalty,
        awayExpGcPenalty: aMatchProj.expGcPenalty,
        homeWinProb: hMatchProj.winProb ?? 0.4,
        drawProb: hMatchProj.drawProb ?? 0.27,
        awayWinProb: aMatchProj.winProb ?? 0.33,
        homeCongested72h: Boolean(hMatchProj.isCongested72h),
        awayCongested72h: Boolean(aMatchProj.isCongested72h),
      };

      const prepareFutureClub = (
        clubShort: string,
        isCongested72h: boolean,
        cutoffMs: number
      ) => {
        const squad = allPlayersByClub.get(clubShort) || [];
        const s1 = stage1ByGwClub.get(`${targetNextGW}_${clubShort}`);
        const fallbackGwAnchorMs = Date.UTC(2026, 7, 22, 14, 0, 0) + Math.max(0, gw - 1) * 7 * 86400_000;
        const resolvedCutoffMs = cutoffMs > 0 ? cutoffMs : fallbackGwAnchorMs;
        const cross = isImmediateGw
          ? computeCausalCrossCompPlayerSignals(
              crossCompIndex,
              clubShort,
              resolvedCutoffMs,
              fullLastKo,
              fullLastStarted,
              fullLastMins
            )
          : { nonEplMins7d: new Map<number, number>(), midweekProof: new Map<number, boolean>() };
        const isDgwClub = (clubGwFixCount.get(clubShort) || 1) >= 2;
        const matchDate = new Date(resolvedCutoffMs);

        const candidateSpecs = squad.map((p) => {
          const hs = fullHistSummary.get(p.id);
          const pos = POSITIONS.includes(p.position as FplPosition)
            ? (p.position as FplPosition)
            : 'MID';
          const fineRole = classifyFineRole(pos, playerPosSeed[p.id] || p.pulsePositionInfo);
          const av = s1?.availabilityById.get(p.id);
          const rawSi = s1?.siByPlayer.get(p.id) ?? 0;
          const baseSi = s1?.baseSiByPlayer.get(p.id) ?? rawSi;
          const isBenchPredicted = Boolean(s1?.benchIds.has(p.id));
          const expectedReturn = expectedReturnByPlayerId.get(p.id) ?? null;

          const pChanceThis = (p as any).chanceOfPlayingThisRound;
          const pChanceNext = p.chanceOfPlayingNextRound;
          const isNewsSuspended = typeof p.news === 'string' && /suspende/i.test(p.news);
          let isSuspended = p.status === 's' || isNewsSuspended;
          if (isSuspended && isCurrentGwFinishedOrConfirmed && pChanceNext === 100) {
            isSuspended = false;
          }
          const isInjured = p.status === 'i';
          const isDoubtful = p.status === 'd';

          let gwIsOut = false;
          let gwSiProb = rawSi / 100;
          let availFactor = av?.avail ?? 1.0;

          if (isInjured || isSuspended) {
            if (expectedReturn) {
              if (matchDate < expectedReturn) {
                gwIsOut = true;
                gwSiProb = 0;
                availFactor = 0;
              } else {
                const isFirstWeekBack =
                  matchDate.getTime() - expectedReturn.getTime() < 7 * 24 * 3600_000;
                gwSiProb = (isFirstWeekBack ? baseSi * 0.75 : baseSi) / 100;
                availFactor = isFirstWeekBack ? 0.75 : 1.0;
              }
            } else if (isSuspended) {
              if (isImmediateGw) {
                gwIsOut = true;
                gwSiProb = 0;
                availFactor = 0;
              } else {
                gwSiProb = baseSi / 100;
                availFactor = 1.0;
              }
            } else {
              if (isImmediateGw) {
                gwIsOut = true;
                gwSiProb = 0;
                availFactor = 0;
              } else if (gw === targetNextGW + 1) {
                gwSiProb = (baseSi * 0.5) / 100;
                availFactor = 0.5;
              } else {
                gwSiProb = baseSi / 100;
                availFactor = 1.0;
              }
            }
          } else if (isDoubtful) {
            const chance =
              pChanceNext !== null && pChanceNext !== undefined
                ? pChanceNext
                : (pChanceThis ?? 75);
            if (isImmediateGw) {
              if (chance === 0) {
                gwIsOut = true;
                gwSiProb = 0;
                availFactor = 0;
              } else {
                gwSiProb = (baseSi * (chance / 100)) / 100;
                availFactor = chance / 100;
              }
            } else if (gw === targetNextGW + 1) {
              gwSiProb = (chance === 0 ? baseSi * 0.75 : baseSi) / 100;
              availFactor = chance === 0 ? 0.75 : 1.0;
            } else {
              gwSiProb = baseSi / 100;
              availFactor = 1.0;
            }
          } else if (isImmediateGw) {
            const ch = isCurrentGwFinishedOrConfirmed ? pChanceNext : pChanceThis;
            if (ch === 0) {
              gwIsOut = true;
              gwSiProb = 0;
              availFactor = 0;
            }
          } else {
            gwSiProb = baseSi / 100;
            availFactor = 1.0;
          }

          if (isDgwClub && pos !== 'GKP') {
            gwSiProb *= 0.94;
          }

          return {
            p,
            hs,
            pos,
            fineRole,
            rawSi,
            isBenchPredicted,
            isDoubtful,
            gwIsOut,
            gwSiProb,
            availFactor,
          };
        });

        // For immediate targetNextGW use exact Stage 1 starters; for future horizons pick top 1 GKP + top 10 outfield by gwSiProb
        const futureStarterIds = new Set<number>();
        if (isImmediateGw && s1) {
          for (const id of s1.starterIds) futureStarterIds.add(id);
        } else {
          const bestGkp = candidateSpecs
            .filter((c) => c.pos === 'GKP' && !c.gwIsOut)
            .sort((a, b) => b.gwSiProb - a.gwSiProb)[0];
          if (bestGkp) futureStarterIds.add(bestGkp.p.id);
          const outfields = candidateSpecs
            .filter((c) => c.pos !== 'GKP' && !c.gwIsOut)
            .sort((a, b) => b.gwSiProb - a.gwSiProb)
            .slice(0, 10);
          for (const c of outfields) futureStarterIds.add(c.p.id);
        }

        const prepared: Array<{ rates: CausalPlayerRates; isStarterPredicted: boolean }> = [];
        for (const c of candidateSpecs) {
          const { p, hs, pos, fineRole, rawSi, isBenchPredicted, isDoubtful, gwIsOut, gwSiProb, availFactor } = c;
          const isStarterPredicted = futureStarterIds.has(p.id);
          const nonEpl7d = isImmediateGw
            ? Math.max(s1?.nonEplMins7dByPlayer.get(p.id) || 0, cross.nonEplMins7d.get(p.id) || 0)
            : 0;
          const mwProof = isImmediateGw
            ? Boolean(s1?.midweekProofByPlayer.get(p.id) || cross.midweekProof.get(p.id))
            : false;
          const recentStartRate = hs
            ? hs.startsCount / Math.max(1, effMaxHistGw - effMinHistGw + 1)
            : gwSiProb;

          const { xMinRes } = predictCalibratedXMinP7({
            pos,
            gwSiProb,
            gwIsOut,
            availFactor,
            isStarterPredicted,
            isBenchPredicted: isImmediateGw ? isBenchPredicted : rawSi < 50,
            isCongested72h: isImmediateGw ? isCongested72h : false,
            nonEplMins7d: nonEpl7d,
            midweekProof: mwProof,
            isDoubtful: isImmediateGw ? isDoubtful : false,
            recentStartRate,
            hist: hs,
            priors: finalPriors,
            xminModels: finalTrainedModels.xminModels,
            horizonOffset,
            tuning,
          });

          prepared.push({
            isStarterPredicted,
            rates: buildCausalRatesForPlayer({
              player: p,
              fineRole,
              hist: hs,
              past: pastSeasonMap[String(p.id)],
              priors: finalPriors,
              deadBall: deadBallByPlayerId.get(p.id) || {
                isPrimaryPen: false,
                isSecondaryPen: false,
                isFkTaker: false,
                isCornerTaker: false,
              },
              proven: provenByPlayerId.get(p.id),
              xMinRes,
              isDoubtful: isImmediateGw ? isDoubtful : false,
              isCongested72h: isImmediateGw ? isCongested72h : false,
              nonEplMins7d: nonEpl7d,
              midweekProof: mwProof,
              horizonOffset,
              tuning,
            }),
          });
        }
        return prepared;
      };

      const hPrep = prepareFutureClub(hShort, fixtureCtx.homeCongested72h, fixtureCtx.kickoffMs);
      const aPrep = prepareFutureClub(aShort, fixtureCtx.awayCongested72h, fixtureCtx.kickoffMs);

      const { homeOutputs, awayOutputs } = evaluateFixtureStage3Xp({
        fixture: fixtureCtx,
        homePlayers: hPrep.map((x) => x.rates),
        awayPlayers: aPrep.map((x) => x.rates),
        models: finalTrainedModels,
        mcIterations: mcIter,
        collectQuantileLadder: isImmediateGw,
        tuning,
      });

      const storeFuture = (
        prepList: typeof hPrep,
        outMap: Map<number, Stage3PlayerOutput>,
        oppShort: string,
        isHome: boolean,
        teamLambda: number,
        oppLambda: number,
        csProbPct: number,
        winProb: number,
        drawProb: number,
        lossProb: number,
        isCongested: boolean
      ) => {
        const covLift = computeClubCovLift(
          prepList.map((item) => ({
            isStarterPredicted: item.isStarterPredicted,
            pStart: item.rates.xMinRes.pStart,
          }))
        );
        for (const item of prepList) {
          const r = item.rates;
          const rawOut = outMap.get(r.playerId);
          if (!rawOut) continue;
          const calibScale = item.isStarterPredicted
            ? clamp(covLift * finalGlobalK * finalPosK[r.position], 0.85, 1.28)
            : 1.0;
          const out = applyXiScaleToOutput(rawOut, calibScale);

          const pGwMap = playerGwMatchesMap.get(r.playerId)!;
          if (!pGwMap.has(gw)) pGwMap.set(gw, []);
          pGwMap.get(gw)!.push({
            oppShort,
            isHome,
            oppLabel: `${oppShort} (${isHome ? 'H' : 'A'})`,
            kickoffTime: fixtureCtx.kickoffIso,
            teamLambda,
            oppLambda,
            csProbPct,
            winProb,
            drawProb,
            lossProb,
            isCongested72h: isCongested,
            output: out,
          });
        }
      };

      storeFuture(
        hPrep,
        homeOutputs,
        aShort,
        true,
        fixtureCtx.homeLambda,
        fixtureCtx.awayLambda,
        hMatchProj.csProbPct ?? Math.round(fixtureCtx.homeCsProb * 100),
        fixtureCtx.homeWinProb,
        fixtureCtx.drawProb,
        fixtureCtx.awayWinProb,
        fixtureCtx.homeCongested72h
      );
      storeFuture(
        aPrep,
        awayOutputs,
        hShort,
        false,
        fixtureCtx.awayLambda,
        fixtureCtx.homeLambda,
        aMatchProj.csProbPct ?? Math.round(fixtureCtx.awayCsProb * 100),
        fixtureCtx.awayWinProb,
        fixtureCtx.drawProb,
        fixtureCtx.homeWinProb,
        fixtureCtx.awayCongested72h
      );
    }
  }

  return {
    playerGwMatchesMap,
    trainedModels: finalTrainedModels,
  };
}
