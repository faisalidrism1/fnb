import {
  ActualPlayerReviewStat,
  DeadBallDutyStatus,
  PlayerGwProjectionCell,
  PlayerOwnershipItem,
  PositionType,
  ScoutSelectionPolicy,
  ScoutTransferHorizonPolicy,
  SolvedScoutSquadResult,
  StandingsRow,
} from '../types.ts';
import { evaluateP9HitTransfer } from './playerXpModel.ts';

export const SCOUT_SELECTION_POLICY_VERSION = '2026.1-wf-all-5';

export const DEFAULT_TRANSFER_H1_POLICY: ScoutTransferHorizonPolicy = {
  ftValueBase: 2.2,
  repairFtValue: 1.0,
  hitSurplusMargin: 1.2,
  marginalHitMargin: 1.4,
  pStartRelWeight: 0.15,
  upsideWeight: 0.08,
  minInPStart: 0.55,
  p9MinNetNonMid: 1.0,
  p9MinNetMid: 2.0,
  p9MinNetBroken: 0.5,
  p9MinPBeatNonMid: 0.46,
  p9MinPBeatMid: 0.52,
  p9MinPBeatBroken: 0.40,
};

export const DEFAULT_TRANSFER_H3_POLICY: ScoutTransferHorizonPolicy = {
  ftValueBase: 2.8,
  repairFtValue: 1.3,
  hitSurplusMargin: 2.2,
  marginalHitMargin: 2.2,
  pStartRelWeight: 0.25,
  upsideWeight: 0.06,
  minInPStart: 0.50,
  p9MinNetNonMid: 0.8,
  p9MinNetMid: 1.6,
  p9MinNetBroken: 0.4,
  p9MinPBeatNonMid: 0.44,
  p9MinPBeatMid: 0.50,
  p9MinPBeatBroken: 0.38,
};

export const DEFAULT_TRANSFER_H6_POLICY: ScoutTransferHorizonPolicy = {
  ftValueBase: 3.6,
  repairFtValue: 1.6,
  hitSurplusMargin: 3.4,
  marginalHitMargin: 3.2,
  pStartRelWeight: 0.30,
  upsideWeight: 0.05,
  minInPStart: 0.48,
  p9MinNetNonMid: 0.6,
  p9MinNetMid: 1.4,
  p9MinNetBroken: 0.3,
  p9MinPBeatNonMid: 0.42,
  p9MinPBeatMid: 0.48,
  p9MinPBeatBroken: 0.36,
};

export const DEFAULT_SCOUT_SELECTION_POLICY: ScoutSelectionPolicy = {
  version: SCOUT_SELECTION_POLICY_VERSION,
  calibrationGwRange: [3, 3],
  picksFH: {
    benchWeight: 0.015,
    pStartGamma: 0.20,
    upsideBeta: 0.06,
    minPStart: 0.50,
  },
  picksWC: {
    benchWeight: 0.035,
    pStartGamma: 0.25,
    upsideBeta: 0.04,
    minPStart: 0.45,
  },
  captain: {
    wTail: 0.35,
    wHaul: 0.25,
    wPStart: 0.60,
    wPen: 0.80,
    defPenalty: 1.50,
    minPStart: 0.50,
  },
  differential: {
    wHorizon: 0.60,
    wTail: 0.40,
    wHaul: 0.25,
    wPStart: 0.80,
    wPen: 1.00,
    minPStart: 0.50,
    maxFnbOwn: 5.0,
  },
  chips: {
    tcTailWeight: 0.15,
    tcReliabilityAlpha: 0.15,
    bbMinPStart: 0.40,
    bbReliabilityAlpha: 0.20,
  },
  transfer: {
    h1: DEFAULT_TRANSFER_H1_POLICY,
    h3: DEFAULT_TRANSFER_H3_POLICY,
    h6: DEFAULT_TRANSFER_H6_POLICY,
  },
};

export interface ScoutModelPlayerInput {
  id: number;
  position: PositionType;
  teamShort: string;
  cost: number;
  status: string;
  chanceOfPlaying?: number | null;
  deadBall?: Partial<DeadBallDutyStatus>;
  fullSeasonPointsMap: Record<number, PlayerGwProjectionCell>;
}

const POSITIONS_ORDER: PositionType[] = ['GKP', 'DEF', 'MID', 'FWD'];
const FORMATIONS: Array<[number, number, number]> = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 3, 2],
  [5, 4, 1],
  [5, 2, 3],
];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export function getCellAtGw(
  p: Pick<ScoutModelPlayerInput, 'fullSeasonPointsMap' | 'status'>,
  gw: number,
  targetNextGW: number
): {
  xp: number;
  xMin: number;
  pStart: number;
  mcQ85: number;
  mcPHaul10: number;
  isBlank: boolean;
  mcQuantiles?: number[];
} {
  const cell = p.fullSeasonPointsMap?.[gw];
  if (!cell || cell.isBlank) {
    return { xp: 0, xMin: 0, pStart: 0, mcQ85: 0, mcPHaul10: 0, isBlank: true };
  }
  const ruledOutAtTarget =
    gw === targetNextGW && (p.status === 'i' || p.status === 's' || p.status === 'u');
  if (ruledOutAtTarget) {
    return {
      xp: 0,
      xMin: 0,
      pStart: 0,
      mcQ85: 0,
      mcPHaul10: 0,
      isBlank: false,
      mcQuantiles: cell.mcQuantiles,
    };
  }
  const xp = typeof cell.xp === 'number' && Number.isFinite(cell.xp) ? Math.max(0, cell.xp) : 0;
  const xMin =
    typeof cell.xMin === 'number' && Number.isFinite(cell.xMin)
      ? Math.max(0, cell.xMin)
      : xp > 0
      ? 60
      : 0;
  const pStart =
    typeof cell.pStart === 'number' && Number.isFinite(cell.pStart)
      ? clamp(cell.pStart, 0, 1)
      : xMin >= 55
      ? 0.85
      : xMin > 0
      ? clamp(xMin / 80, 0.1, 0.8)
      : 0;
  const mcQ85 =
    typeof cell.mcQ85 === 'number' && Number.isFinite(cell.mcQ85)
      ? Math.max(xp, cell.mcQ85)
      : xp * 1.45;
  const mcPHaul10 =
    typeof cell.mcPHaul10 === 'number' && Number.isFinite(cell.mcPHaul10)
      ? clamp(cell.mcPHaul10, 0, 1)
      : clamp((xp - 3.5) / 14, 0, 0.35);

  return {
    xp,
    xMin,
    pStart,
    mcQ85,
    mcPHaul10,
    isBlank: false,
    mcQuantiles: cell.mcQuantiles,
  };
}

export function isScoutPlayerEligibleAtGw(params: {
  player: ScoutModelPlayerInput;
  gw: number;
  targetNextGW: number;
  minPStart: number;
  minXMin?: number;
}): boolean {
  const { player, gw, targetNextGW, minPStart, minXMin = 20 } = params;
  const c = getCellAtGw(player, gw, targetNextGW);
  if (c.isBlank || c.xp <= 0) return false;
  if (gw >= targetNextGW && (player.status === 'i' || player.status === 's' || player.status === 'u')) {
    return false;
  }
  return c.pStart >= minPStart || c.xMin >= minXMin;
}

export function scoreCaptainAtGw(
  player: ScoutModelPlayerInput,
  gw: number,
  targetNextGW: number,
  policy: ScoutSelectionPolicy = DEFAULT_SCOUT_SELECTION_POLICY
): number {
  const c = getCellAtGw(player, gw, targetNextGW);
  if (c.isBlank || c.xp <= 0) return 0;
  const tail = Math.max(0, c.mcQ85 - c.xp);
  const penFlag = player.deadBall?.isPrimaryPen ? 1 : 0;
  const isDefGk = player.position === 'DEF' || player.position === 'GKP' ? 1 : 0;
  const score =
    c.xp * 10 +
    policy.captain.wTail * tail +
    policy.captain.wHaul * (c.mcPHaul10 * 10) +
    policy.captain.wPStart * ((c.pStart - 0.75) * 4) +
    policy.captain.wPen * penFlag -
    policy.captain.defPenalty * isDefGk;
  return Number(Math.max(0.1, score).toFixed(2));
}

export function scoreDifferentialAtGw(
  player: ScoutModelPlayerInput,
  gw: number,
  targetNextGW: number,
  policy: ScoutSelectionPolicy = DEFAULT_SCOUT_SELECTION_POLICY
): number {
  const c1 = getCellAtGw(player, gw, targetNextGW);
  if (c1.isBlank || c1.xp <= 0) return 0;

  let sum3 = 0;
  let cnt3 = 0;
  for (let g = gw; g <= Math.min(38, gw + 2); g++) {
    sum3 += getCellAtGw(player, g, targetNextGW).xp;
    cnt3++;
  }
  const avgXp3 = cnt3 > 0 ? sum3 / cnt3 : c1.xp;
  const wH = clamp(policy.differential.wHorizon, 0.25, 0.90);
  const horizonBlend = wH * c1.xp + (1 - wH) * avgXp3;
  const tail = Math.max(0, c1.mcQ85 - c1.xp);
  const penFlag = player.deadBall?.isPrimaryPen ? 1 : 0;

  const score =
    horizonBlend * 10 +
    policy.differential.wTail * tail +
    policy.differential.wHaul * (c1.mcPHaul10 * 10) +
    policy.differential.wPStart * ((c1.pStart - 0.70) * 4) +
    policy.differential.wPen * penFlag;
  return Number(Math.max(0.1, score).toFixed(2));
}

export function computePlayerUtilityAtGw(
  player: ScoutModelPlayerInput,
  gw: number,
  targetNextGW: number,
  params: { pStartGamma: number; upsideBeta: number }
): { xp: number; utility: number; pStart: number; xMin: number } {
  const c = getCellAtGw(player, gw, targetNextGW);
  if (c.isBlank || c.xp <= 0) {
    return { xp: 0, utility: 0, pStart: c.pStart, xMin: c.xMin };
  }
  const relScale = Math.pow(clamp(c.pStart, 0.15, 1.0), params.pStartGamma);
  const upside = params.upsideBeta * Math.max(0, c.mcQ85 - c.xp);
  const utility = c.xp * relScale + upside;
  return { xp: c.xp, utility, pStart: c.pStart, xMin: c.xMin };
}

export function getTransferHorizonPolicy(
  policy: ScoutSelectionPolicy | undefined | null,
  horizonCount: number
): ScoutTransferHorizonPolicy {
  const tr = policy?.transfer || DEFAULT_SCOUT_SELECTION_POLICY.transfer;
  if (horizonCount <= 1) return tr.h1;
  if (horizonCount <= 3) return tr.h3;
  return tr.h6;
}

// ============================================================================
// UNIFIED CAUSAL SQUAD SOLVER (FH & WC) FOR TARGET & WALK-FORWARD BACKTEST
// ============================================================================
export function solveScoutSquadForGwMode(params: {
  players: ScoutModelPlayerInput[];
  targetNextGW: number;
  targetGw: number;
  mode: 'FH' | 'WC';
  policy?: ScoutSelectionPolicy;
  fastMode?: boolean;
  calibrationMode?: boolean;
  wcHorizonLen?: number;
  maxGwCap?: number;
  bbSetupGw?: number;
}): SolvedScoutSquadResult {
  const {
    players,
    targetNextGW,
    targetGw,
    mode,
    policy = DEFAULT_SCOUT_SELECTION_POLICY,
    fastMode = false,
    calibrationMode = false,
    wcHorizonLen = 6,
    maxGwCap = 38,
    bbSetupGw,
  } = params;

  const MAX_XI_BUDGET = 83.0;
  const MAX_SQUAD_BUDGET = 100.0;
  const isFH = mode === 'FH';
  const modeCfg = isFH ? policy.picksFH : policy.picksWC;
  const effectiveHorizonLen = Math.max(1, Math.min(wcHorizonLen, Math.max(1, (calibrationMode ? Math.min(maxGwCap, targetNextGW - 1) : maxGwCap) - targetGw + 1)));
  const benchWeight =
    !isFH && bbSetupGw !== undefined
      ? Math.max(modeCfg.benchWeight, 1 / effectiveHorizonLen)
      : modeCfg.benchWeight;

  if (players.length < 15) {
    return {
      starterIds: [],
      benchIds: [],
      xiCost: 0,
      xiBudget: MAX_XI_BUDGET,
      totalCost: 0,
      budget: MAX_SQUAD_BUDGET,
      xiXp: 0,
      formation: '3-4-3',
    };
  }

  const effectiveMaxGwCap = calibrationMode ? Math.min(maxGwCap, targetNextGW - 1) : maxGwCap;
  const wcEndGw = Math.min(effectiveMaxGwCap, targetGw + Math.max(1, wcHorizonLen) - 1);
  const utilCache = new Map<number, number>();
  const rawXpCache = new Map<number, number>();
  const tieCache = new Map<number, number>();
  const pStartCache = new Map<number, number>();
  const xMinCache = new Map<number, number>();

  for (const p of players) {
    const u1 = computePlayerUtilityAtGw(p, targetGw, targetNextGW, modeCfg);
    let sumU = 0;
    let sumRaw = 0;
    let cnt = 0;
    for (let g = targetGw; g <= wcEndGw; g++) {
      const ug = computePlayerUtilityAtGw(p, g, targetNextGW, modeCfg);
      sumU += ug.utility;
      sumRaw += ug.xp;
      cnt++;
    }
    const avgU = cnt > 0 ? sumU / cnt : u1.utility;
    const avgRaw = cnt > 0 ? round1(sumRaw / cnt) : round1(u1.xp);

    utilCache.set(p.id, isFH ? u1.utility : avgU);
    rawXpCache.set(p.id, isFH ? round1(u1.xp) : avgRaw);
    tieCache.set(p.id, isFH ? avgU : u1.utility);
    pStartCache.set(p.id, u1.pStart);
    xMinCache.set(p.id, u1.xMin);
  }

  const getUtil = (p: ScoutModelPlayerInput) => utilCache.get(p.id) ?? 0;
  const getRawXp = (p: ScoutModelPlayerInput) => rawXpCache.get(p.id) ?? 0;
  const getTie = (p: ScoutModelPlayerInput) => tieCache.get(p.id) ?? 0;
  const getPStart = (p: ScoutModelPlayerInput) => pStartCache.get(p.id) ?? 0;
  const getXMin = (p: ScoutModelPlayerInput) => xMinCache.get(p.id) ?? 0;

  // Strictly causal Stage 1 / Stage 3 eligibility gates (zero cumulative season minutes hardcoding!)
  const fitCandidates = players.filter((p) =>
    isScoutPlayerEligibleAtGw({
      player: p,
      gw: targetGw,
      targetNextGW,
      minPStart: modeCfg.minPStart,
      minXMin: 25,
    })
  );
  const backupCandidates = players.filter((p) => {
    const c = getCellAtGw(p, targetGw, targetNextGW);
    if (targetGw >= targetNextGW && (p.status === 'i' || p.status === 's' || p.status === 'u')) {
      return false;
    }
    return !c.isBlank && (c.xp > 0 || c.pStart >= 0.15);
  });

  const posPool: Record<PositionType, ScoutModelPlayerInput[]> = {
    GKP: [],
    DEF: [],
    MID: [],
    FWD: [],
  };

  const topN = calibrationMode ? 11 : fastMode ? 14 : 18;
  const valN = calibrationMode ? 5 : fastMode ? 8 : 12;
  const cheapN = calibrationMode ? 4 : fastMode ? 6 : 8;

  for (const pos of POSITIONS_ORDER) {
    const primary = fitCandidates.filter((p) => p.position === pos);
    const source = primary.length >= 6 ? primary : backupCandidates.filter((p) => p.position === pos);
    const fallback = source.length >= 5 ? source : players.filter((p) => p.position === pos);

    const topUtil = [...fallback]
      .sort((a, b) => getUtil(b) - getUtil(a) || getTie(b) - getTie(a) || a.cost - b.cost)
      .slice(0, topN);
    const topValue = [...fallback]
      .sort((a, b) => getUtil(b) / Math.max(b.cost, 3.8) - getUtil(a) / Math.max(a.cost, 3.8))
      .slice(0, valN);
    const cheapPlaying = [...fallback]
      .filter((p) => {
        if (bbSetupGw !== undefined && !isFH) {
          const bbCell = getCellAtGw(p, bbSetupGw, targetNextGW);
          return (getPStart(p) >= 0.40 || getXMin(p) >= 35) && bbCell.pStart >= 0.45 && !bbCell.isBlank;
        }
        return getPStart(p) >= 0.40 || getXMin(p) >= 35;
      })
      .sort((a, b) => a.cost - b.cost || getUtil(b) - getUtil(a))
      .slice(0, cheapN);
    const ultraCheap = [...fallback]
      .sort((a, b) => a.cost - b.cost || getUtil(b) - getUtil(a))
      .slice(0, cheapN);
    const bbValueExtras =
      bbSetupGw !== undefined && !isFH
        ? [...fallback]
            .filter((p) => {
              const bbCell = getCellAtGw(p, bbSetupGw, targetNextGW);
              return !bbCell.isBlank && bbCell.pStart >= 0.50;
            })
            .sort((a, b) => {
              const ca = getCellAtGw(a, bbSetupGw, targetNextGW).xp / Math.max(a.cost, 3.8);
              const cb = getCellAtGw(b, bbSetupGw, targetNextGW).xp / Math.max(b.cost, 3.8);
              return cb - ca;
            })
            .slice(0, 6)
        : [];

    const merged = new Map<number, ScoutModelPlayerInput>();
    for (const item of [...topUtil, ...topValue, ...cheapPlaying, ...ultraCheap, ...bbValueExtras]) {
      merged.set(item.id, item);
    }
    posPool[pos] = Array.from(merged.values());
  }

  const clubIdxMap = new Map<string, number>();
  let nextClubIdx = 0;
  const getClubIdx = (teamShort: string) => {
    let idx = clubIdxMap.get(teamShort);
    if (idx === undefined) {
      idx = nextClubIdx++;
      clubIdxMap.set(teamShort, idx);
    }
    return idx;
  };

  type PoolMeta = {
    p: ScoutModelPlayerInput;
    id: number;
    posIdx: 0 | 1 | 2 | 3;
    cost: number;
    xp: number;
    rawXp: number;
    tie: number;
    clubIdx: number;
  };

  const POS_TO_IDX: Record<PositionType, 0 | 1 | 2 | 3> = {
    GKP: 0,
    DEF: 1,
    MID: 2,
    FWD: 3,
  };

  const metaById = new Map<number, PoolMeta>();
  const posPoolMeta: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
  const posPoolByXpOnly: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];

  for (const pos of POSITIONS_ORDER) {
    const pIdx = POS_TO_IDX[pos];
    const metas = posPool[pos].map((p) => {
      const m: PoolMeta = {
        p,
        id: p.id,
        posIdx: pIdx,
        cost: p.cost,
        xp: getUtil(p),
        rawXp: getRawXp(p),
        tie: getTie(p),
        clubIdx: getClubIdx(p.teamShort),
      };
      metaById.set(p.id, m);
      return m;
    });
    posPoolByXpOnly[pIdx] = [...metas].sort((a, b) => b.xp - a.xp);
    posPoolMeta[pIdx] = [...metas].sort((a, b) => b.xp - a.xp || b.tie - a.tie);
  }
  const numClubs = Math.max(nextClubIdx, 1);

  const isDualBudgetValidNums = (xiCost: number, cost: number) =>
    xiCost <= MAX_XI_BUDGET + 0.001 && cost <= MAX_SQUAD_BUDGET + 0.001;
  const calcBudgetExcessNums = (xiCost: number, cost: number) =>
    Math.max(0, xiCost - MAX_XI_BUDGET) + Math.max(0, cost - MAX_SQUAD_BUDGET);
  const cmpMeta = (a: PoolMeta, b: PoolMeta) => (b.xp !== a.xp ? b.xp - a.xp : b.tie - a.tie);

  const scratchArr1: PoolMeta[] = new Array(5);
  const scratchArr2: PoolMeta[] = new Array(5);

  const evalGroup = (arr: PoolMeta[], sCount: number) => {
    let sXp = 0;
    let sRawXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sRawXp += item.rawXp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, sRawXp, bXp, sCost, tCost };
  };

  const evalReplaced1 = (arr: PoolMeta[], replaceIdx: number, inM: PoolMeta, sCount: number) => {
    const len = arr.length;
    let w = 0;
    let inserted = false;
    for (let i = 0; i < len; i++) {
      if (i === replaceIdx) continue;
      const cur = arr[i];
      if (!inserted && cmpMeta(cur, inM) > 0) {
        scratchArr1[w++] = inM;
        inserted = true;
      }
      scratchArr1[w++] = cur;
    }
    if (!inserted) scratchArr1[w++] = inM;

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr1[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const evalReplaced2Same = (
    arr: PoolMeta[],
    idx1: number,
    in1: PoolMeta,
    idx2: number,
    in2: PoolMeta,
    sCount: number
  ) => {
    const len = arr.length;
    const firstIn = cmpMeta(in1, in2) <= 0 ? in1 : in2;
    const secondIn = firstIn === in1 ? in2 : in1;
    let w = 0;
    let ins = 0;
    for (let i = 0; i < len; i++) {
      if (i === idx1 || i === idx2) continue;
      const cur = arr[i];
      if (ins === 0 && cmpMeta(cur, firstIn) > 0) {
        scratchArr2[w++] = firstIn;
        ins = 1;
      }
      if (ins === 1 && cmpMeta(cur, secondIn) > 0) {
        scratchArr2[w++] = secondIn;
        ins = 2;
      }
      scratchArr2[w++] = cur;
    }
    if (ins === 0) {
      scratchArr2[w++] = firstIn;
      scratchArr2[w++] = secondIn;
    } else if (ins === 1) {
      scratchArr2[w++] = secondIn;
    }

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr2[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const optimizeForFormation = (
    seedSquad: ScoutModelPlayerInput[],
    dCount: number,
    mCount: number,
    fCount: number
  ) => {
    const sCounts: [number, number, number, number] = [1, dCount, mCount, fCount];
    const groups: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
    const clubCounts = new Int32Array(numClubs);
    const currentIds = new Set<number>();

    for (const p of seedSquad) {
      const m = metaById.get(p.id);
      if (!m) return null;
      clubCounts[m.clubIdx]++;
      if (clubCounts[m.clubIdx] > 3) return null;
      groups[m.posIdx].push(m);
      currentIds.add(m.id);
    }
    for (let g = 0; g < 4; g++) groups[g].sort(cmpMeta);

    const gStats = [
      evalGroup(groups[0], sCounts[0]),
      evalGroup(groups[1], sCounts[1]),
      evalGroup(groups[2], sCounts[2]),
      evalGroup(groups[3], sCounts[3]),
    ];

    const getTotals = () => {
      let xiXp = 0;
      let xiRawXp = 0;
      let benchXp = 0;
      let rawXiCost = 0;
      let rawCost = 0;
      for (let g = 0; g < 4; g++) {
        xiXp += gStats[g].sXp;
        xiRawXp += gStats[g].sRawXp;
        benchXp += gStats[g].bXp;
        rawXiCost += gStats[g].sCost;
        rawCost += gStats[g].tCost;
      }
      return {
        xiXp,
        xiRawXp,
        benchXp,
        xiCost: round1(rawXiCost),
        cost: round1(rawCost),
        obj: xiXp + benchWeight * benchXp,
      };
    };

    const applySwap1 = (posIdx: 0 | 1 | 2 | 3, slotIdx: number, inM: PoolMeta) => {
      const outM = groups[posIdx][slotIdx];
      currentIds.delete(outM.id);
      currentIds.add(inM.id);
      clubCounts[outM.clubIdx]--;
      clubCounts[inM.clubIdx]++;
      groups[posIdx][slotIdx] = inM;
      groups[posIdx].sort(cmpMeta);
      gStats[posIdx] = evalGroup(groups[posIdx], sCounts[posIdx]);
    };

    let baseTot = getTotals();
    let repairGuard = 0;
    while (calcBudgetExcessNums(baseTot.xiCost, baseTot.cost) > 0.001 && repairGuard < 36) {
      repairGuard++;
      const curExcess = calcBudgetExcessNums(baseTot.xiCost, baseTot.cost);
      let bestPos: 0 | 1 | 2 | 3 = 0;
      let bestSlot = -1;
      let bestIn: PoolMeta | null = null;
      let bestLossPerReduction = Infinity;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = baseTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = baseTot.benchXp - gStats[posIdx].bXp;
        const baseRawXiCost =
          gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost - gStats[posIdx].sCost;
        const baseRawTotalCost =
          gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.cost >= outM.cost - 0.05 || currentIds.has(inM.id)) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;
            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = round1(baseRawXiCost + rep.sCost);
            const nextCost = round1(baseRawTotalCost + rep.tCost);
            const reduction = curExcess - calcBudgetExcessNums(nextXiCost, nextCost);
            if (reduction <= 0.001) continue;
            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            const lossPerReduction = (baseTot.obj - nextObj) / reduction;
            if (lossPerReduction < bestLossPerReduction) {
              bestLossPerReduction = lossPerReduction;
              bestPos = posIdx;
              bestSlot = slotIdx;
              bestIn = inM;
            }
          }
        }
      }
      if (bestSlot === -1 || !bestIn) break;
      applySwap1(bestPos, bestSlot, bestIn);
      baseTot = getTotals();
    }

    if (!isDualBudgetValidNums(baseTot.xiCost, baseTot.cost)) return null;

    const swapCheapLimit = calibrationMode ? 3 : fastMode ? 4 : 8;
    const swapUpLimit = calibrationMode ? 3 : fastMode ? 3 : 6;
    const flatSlots: Array<{ posIdx: 0 | 1 | 2 | 3; slotIdx: number; m: PoolMeta }> = new Array(15);
    const maxIter = calibrationMode ? 24 : 40;

    for (let iter = 0; iter < maxIter; iter++) {
      const stepTot = getTotals();
      const sumRawXiCost = gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost;
      const sumRawCost = gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost;

      let bestNextObj = stepTot.obj + 1e-6;
      let bestSwapKind: 0 | 1 | 2 = 0;
      let b1Pos: 0 | 1 | 2 | 3 = 0;
      let b1Slot = 0;
      let b1In: PoolMeta | null = null;
      let b2Pos: 0 | 1 | 2 | 3 = 0;
      let b2Slot = 0;
      let b2In: PoolMeta | null = null;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = stepTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = stepTot.benchXp - gStats[posIdx].bXp;
        const baseOtherRawXiCost = sumRawXiCost - gStats[posIdx].sCost;
        const baseOtherRawCost = sumRawCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.xp <= outM.xp) break;
            if (currentIds.has(inM.id)) continue;
            const nextCost = round1(stepTot.cost - outM.cost + inM.cost);
            if (nextCost > MAX_SQUAD_BUDGET + 0.001) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;

            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = round1(baseOtherRawXiCost + rep.sCost);
            const nextTotCost = round1(baseOtherRawCost + rep.tCost);
            if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            if (nextObj > bestNextObj) {
              bestNextObj = nextObj;
              bestSwapKind = 1;
              b1Pos = posIdx;
              b1Slot = slotIdx;
              b1In = inM;
            }
          }
        }
      }

      if (bestSwapKind === 1 && b1In) {
        applySwap1(b1Pos, b1Slot, b1In);
        continue;
      }

      const allowTwoOpt = calibrationMode ? iter < 4 : !fastMode || iter < 8;
      if (allowTwoOpt) {
        let fIdx = 0;
        for (let p = 0 as 0 | 1 | 2 | 3; p < 4; p = (p + 1) as 0 | 1 | 2 | 3) {
          const grp = groups[p];
          for (let s = 0; s < grp.length; s++) flatSlots[fIdx++] = { posIdx: p, slotIdx: s, m: grp[s] };
        }

        const cheaperBySlot: PoolMeta[][] = new Array(15);
        const upgradesBySlot: PoolMeta[][] = new Array(15);
        for (let k = 0; k < 15; k++) {
          const slot = flatSlots[k];
          const outM = slot.m;
          const xpPool = posPoolByXpOnly[slot.posIdx];
          const cheapList: PoolMeta[] = [];
          const upList: PoolMeta[] = [];
          for (let idx = 0; idx < xpPool.length; idx++) {
            const cand = xpPool[idx];
            if (currentIds.has(cand.id)) continue;
            if (cand.cost < outM.cost - 0.05 && cheapList.length < swapCheapLimit) cheapList.push(cand);
            if (cand.xp > outM.xp) upList.push(cand);
          }
          cheaperBySlot[k] = cheapList;
          upgradesBySlot[k] = upList;
        }

        for (let i = 0; i < 15; i++) {
          const s1 = flatSlots[i];
          const out1 = s1.m;
          const cheaper1 = cheaperBySlot[i];
          if (cheaper1.length === 0) continue;

          for (let c1 = 0; c1 < cheaper1.length; c1++) {
            const in1 = cheaper1[c1];
            const remSquadBudget = MAX_SQUAD_BUDGET - (stepTot.cost - out1.cost + in1.cost);

            for (let j = 0; j < 15; j++) {
              if (j === i) continue;
              const s2 = flatSlots[j];
              const out2 = s2.m;
              const upAll = upgradesBySlot[j];
              let takenUp = 0;

              for (let u2 = 0; u2 < upAll.length && takenUp < swapUpLimit; u2++) {
                const in2 = upAll[u2];
                if (in2.id === in1.id || in2.cost - out2.cost > remSquadBudget + 0.001) continue;
                takenUp++;

                const oc1 = out1.clubIdx;
                const oc2 = out2.clubIdx;
                const ic1 = in1.clubIdx;
                const ic2 = in2.clubIdx;
                if (ic1 === ic2) {
                  const freed = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed + 2 > 3) continue;
                } else {
                  const freed1 = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed1 + 1 > 3) continue;
                  const freed2 = (oc1 === ic2 ? 1 : 0) + (oc2 === ic2 ? 1 : 0);
                  if (clubCounts[ic2] - freed2 + 1 > 3) continue;
                }

                let nextXiXp: number;
                let nextBenchXp: number;
                let nextRawXiCost: number;
                let nextRawTotalCost: number;

                if (s1.posIdx === s2.posIdx) {
                  const grp = groups[s1.posIdx];
                  const rep = evalReplaced2Same(grp, s1.slotIdx, in1, s2.slotIdx, in2, sCounts[s1.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp + rep.sXp;
                  nextBenchXp = stepTot.benchXp - gStats[s1.posIdx].bXp + rep.bXp;
                  nextRawXiCost = sumRawXiCost - gStats[s1.posIdx].sCost + rep.sCost;
                  nextRawTotalCost = sumRawCost - gStats[s1.posIdx].tCost + rep.tCost;
                } else {
                  const rep1 = evalReplaced1(groups[s1.posIdx], s1.slotIdx, in1, sCounts[s1.posIdx]);
                  const rep2 = evalReplaced1(groups[s2.posIdx], s2.slotIdx, in2, sCounts[s2.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp - gStats[s2.posIdx].sXp + rep1.sXp + rep2.sXp;
                  nextBenchXp =
                    stepTot.benchXp - gStats[s1.posIdx].bXp - gStats[s2.posIdx].bXp + rep1.bXp + rep2.bXp;
                  nextRawXiCost =
                    sumRawXiCost - gStats[s1.posIdx].sCost - gStats[s2.posIdx].sCost + rep1.sCost + rep2.sCost;
                  nextRawTotalCost =
                    sumRawCost - gStats[s1.posIdx].tCost - gStats[s2.posIdx].tCost + rep1.tCost + rep2.tCost;
                }

                const nextXiCost = round1(nextRawXiCost);
                const nextTotCost = round1(nextRawTotalCost);
                if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

                const nextObj = nextXiXp + benchWeight * nextBenchXp;
                if (nextObj > bestNextObj) {
                  bestNextObj = nextObj;
                  bestSwapKind = 2;
                  b1Pos = s1.posIdx;
                  b1Slot = s1.slotIdx;
                  b1In = in1;
                  b2Pos = s2.posIdx;
                  b2Slot = s2.slotIdx;
                  b2In = in2;
                }
              }
            }
          }
        }
      }

      if (bestSwapKind === 2 && b1In && b2In) {
        if (b1Pos === b2Pos) {
          const out1 = groups[b1Pos][b1Slot];
          const out2 = groups[b2Pos][b2Slot];
          currentIds.delete(out1.id);
          currentIds.delete(out2.id);
          currentIds.add(b1In.id);
          currentIds.add(b2In.id);
          clubCounts[out1.clubIdx]--;
          clubCounts[out2.clubIdx]--;
          clubCounts[b1In.clubIdx]++;
          clubCounts[b2In.clubIdx]++;
          groups[b1Pos][b1Slot] = b1In;
          groups[b2Pos][b2Slot] = b2In;
          groups[b1Pos].sort(cmpMeta);
          gStats[b1Pos] = evalGroup(groups[b1Pos], sCounts[b1Pos]);
        } else {
          applySwap1(b1Pos, b1Slot, b1In);
          applySwap1(b2Pos, b2Slot, b2In);
        }
      } else {
        break;
      }
    }

    const finalTot = getTotals();
    if (!isDualBudgetValidNums(finalTot.xiCost, finalTot.cost)) return null;

    const starterIds: number[] = [
      groups[0][0].id,
      ...groups[1].slice(0, dCount).map((m) => m.id),
      ...groups[2].slice(0, mCount).map((m) => m.id),
      ...groups[3].slice(0, fCount).map((m) => m.id),
    ];
    const benchOut = [
      ...groups[1].slice(dCount),
      ...groups[2].slice(mCount),
      ...groups[3].slice(fCount),
    ]
      .sort((a, b) => b.xp - a.xp)
      .map((m) => m.id);
    const benchIds: number[] = groups[0][1] ? [groups[0][1].id, ...benchOut] : benchOut;

    return {
      starterIds,
      benchIds,
      xiXp: finalTot.xiRawXp,
      xiCost: finalTot.xiCost,
      cost: finalTot.cost,
      obj: finalTot.obj,
      formation: `${dCount}-${mCount}-${fCount}`,
    };
  };

  const buildCheapestSeed = () => {
    const picked: ScoutModelPlayerInput[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const quotas: Array<[PositionType, number]> = [
      ['GKP', 2],
      ['DEF', 5],
      ['MID', 5],
      ['FWD', 3],
    ];
    for (const [pos, need] of quotas) {
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getUtil(b) - getUtil(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
          picked.push(p);
          used.add(p.id);
          cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
          taken++;
        }
      }
    }
    return picked;
  };

  const buildTopDownSeed = (dCount: number, mCount: number, fCount: number) => {
    const picked: ScoutModelPlayerInput[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const tryAdd = (p: ScoutModelPlayerInput) => {
      if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
        picked.push(p);
        used.add(p.id);
        cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
        return true;
      }
      return false;
    };
    const starterQuotas: Array<[PositionType, number]> = [
      ['GKP', 1],
      ['DEF', dCount],
      ['MID', mCount],
      ['FWD', fCount],
    ];
    for (const [pos, need] of starterQuotas) {
      const list = [...posPool[pos]].sort((a, b) => getUtil(b) - getUtil(a) || a.cost - b.cost);
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    const benchQuotas: Array<[PositionType, number]> = [
      ['GKP', 1],
      ['DEF', 5 - dCount],
      ['MID', 5 - mCount],
      ['FWD', 3 - fCount],
    ];
    for (const [pos, need] of benchQuotas) {
      if (need <= 0) continue;
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getUtil(b) - getUtil(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    return picked;
  };

  const cheapSeed = buildCheapestSeed();
  let bestOverall: ReturnType<typeof optimizeForFormation> = null;
  const evalFormations = calibrationMode ? FORMATIONS.slice(0, 5) : FORMATIONS;

  for (const [dCount, mCount, fCount] of evalFormations) {
    const seeds = calibrationMode ? [cheapSeed] : [cheapSeed, buildTopDownSeed(dCount, mCount, fCount)];
    for (const seed of seeds) {
      if (seed.length !== 15) continue;
      const res = optimizeForFormation(seed, dCount, mCount, fCount);
      if (!res) continue;
      if (
        !bestOverall ||
        res.obj > bestOverall.obj + 1e-6 ||
        (Math.abs(res.obj - bestOverall.obj) <= 1e-6 && res.xiXp > bestOverall.xiXp)
      ) {
        bestOverall = res;
      }
    }
  }

  if (!bestOverall) {
    const s15 = cheapSeed.slice(0, 15);
    const gkps = s15.filter((p) => p.position === 'GKP');
    const defs = s15.filter((p) => p.position === 'DEF');
    const mids = s15.filter((p) => p.position === 'MID');
    const fwds = s15.filter((p) => p.position === 'FWD');
    const st = [gkps[0], ...defs.slice(0, 3), ...mids.slice(0, 4), ...fwds.slice(0, 3)].filter(Boolean);
    const bn = [gkps[1], ...defs.slice(3), ...mids.slice(4), ...fwds.slice(3)].filter(Boolean);
    return {
      starterIds: st.map((p) => p.id),
      benchIds: bn.map((p) => p.id),
      xiCost: round1(st.reduce((s, p) => s + p.cost, 0)),
      xiBudget: MAX_XI_BUDGET,
      totalCost: round1(s15.reduce((s, p) => s + p.cost, 0)),
      budget: MAX_SQUAD_BUDGET,
      xiXp: round1(st.reduce((s, p) => s + getRawXp(p), 0)),
      formation: '3-4-3',
    };
  }

  return {
    starterIds: bestOverall.starterIds,
    benchIds: bestOverall.benchIds,
    xiCost: bestOverall.xiCost,
    xiBudget: MAX_XI_BUDGET,
    totalCost: bestOverall.cost,
    budget: MAX_SQUAD_BUDGET,
    xiXp: round1(bestOverall.xiXp),
    formation: bestOverall.formation,
  };
}

// ============================================================================
// OFFICIAL FPL AUTOSUB + CAPTAINCY REALIZED POINTS SIMULATOR (WALK-FORWARD)
// ============================================================================
export function simulateFplSquadActualScore(params: {
  starterIds: number[];
  benchIds: number[];
  captainId: number | null;
  viceCaptainId: number | null;
  actualStatsAtGw: Record<number, ActualPlayerReviewStat> | ((id: number) => ActualPlayerReviewStat | undefined);
  posById: Map<number, PositionType>;
}): { xiPts: number; totalWithCap: number; benchPts: number } {
  const { starterIds, benchIds, captainId, viceCaptainId, actualStatsAtGw, posById } = params;
  const getStat = (id: number): ActualPlayerReviewStat | undefined =>
    typeof actualStatsAtGw === 'function' ? actualStatsAtGw(id) : actualStatsAtGw?.[id];

  const playedMins = (id: number) => Number(getStat(id)?.mins || 0);
  const actualPts = (id: number) => Number(getStat(id)?.pts || 0);

  const activeIds = new Set<number>();
  const posCounts: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };

  let starterGkpMissing = false;
  const missingOutfieldSlots: number[] = [];

  for (const id of starterIds) {
    const pos = posById.get(id) || 'MID';
    if (playedMins(id) > 0) {
      activeIds.add(id);
      posCounts[pos]++;
    } else if (pos === 'GKP') {
      starterGkpMissing = true;
    } else {
      missingOutfieldSlots.push(id);
    }
  }

  const benchGkp = benchIds.find((id) => posById.get(id) === 'GKP');
  const benchOutfield = benchIds.filter((id) => posById.get(id) !== 'GKP');

  if (starterGkpMissing && benchGkp && playedMins(benchGkp) > 0) {
    activeIds.add(benchGkp);
    posCounts.GKP++;
  }

  let remSubs = missingOutfieldSlots.length;
  for (const bId of benchOutfield) {
    if (remSubs <= 0) break;
    if (playedMins(bId) <= 0) continue;
    const bPos = posById.get(bId) || 'MID';
    const nextDef = posCounts.DEF + (bPos === 'DEF' ? 1 : 0);
    const nextMid = posCounts.MID + (bPos === 'MID' ? 1 : 0);
    const nextFwd = posCounts.FWD + (bPos === 'FWD' ? 1 : 0);
    const slotsLeftAfter = remSubs - 1;
    // Ensure remaining subs can still satisfy minimum FPL formation: >= 3 DEF, >= 2 MID, >= 1 FWD
    const neededDef = Math.max(0, 3 - nextDef);
    const neededMid = Math.max(0, 2 - nextMid);
    const neededFwd = Math.max(0, 1 - nextFwd);
    if (neededDef + neededMid + neededFwd <= slotsLeftAfter) {
      activeIds.add(bId);
      posCounts[bPos]++;
      remSubs--;
    }
  }

  let xiPts = 0;
  for (const id of activeIds) {
    xiPts += actualPts(id);
  }

  let benchPts = 0;
  for (const bId of benchIds) {
    if (!activeIds.has(bId)) {
      benchPts += actualPts(bId);
    }
  }

  let capBonus = 0;
  if (captainId && playedMins(captainId) > 0) {
    capBonus = actualPts(captainId);
  } else if (viceCaptainId && playedMins(viceCaptainId) > 0) {
    capBonus = actualPts(viceCaptainId);
  }

  return {
    xiPts,
    totalWithCap: xiPts + capBonus,
    benchPts,
  };
}

// ============================================================================
// UNIFIED CAUSAL TRANSFER ENGINE (USED IN BOTH WALK-FORWARD & TAB SCOUT)
// ============================================================================
export interface ScoutTransferPlayerEff {
  id: number;
  position: PositionType;
  teamShort: string;
  clubIdx: number;
  cost: number;
  sellingPrice: number;
  isOutStatus: boolean;
  isBroken: boolean;
  isBenchFodder: boolean;
  isDoubt: boolean;
  isNailedSafe: boolean;
  effXp1: number;
  effXpH: number;
  utilityH: number;
  pStart1: number;
  xMin1: number;
  mcQ85_1: number;
  mcQuantiles?: number[];
}

export interface ScoutTransferStepResult {
  outId: number;
  inId: number;
  effXp1Out: number;
  effXpHOut: number;
  effXp1In: number;
  effXpHIn: number;
  isHit: boolean;
  stepNum: number;
  bankBefore: number;
  bankAfter: number;
  isOutStatusOut: boolean;
  isBenchFodderOut: boolean;
  isDoubtOut: boolean;
  sellingPriceOut?: number;
}

export interface ScoutTransferXiSummary {
  starterIds: number[];
  benchIds: number[];
  formation: string;
  xiXp1: number;
  xiXpH: number;
  xiUtilityH: number;
  benchDepthH: number;
  brokenStarters: number;
  safeStarterCount: number;
  benchPlayables: number;
  startersCost: number;
}

export interface ScoutTransferSearchResult {
  needTransfer: boolean;
  moves: ScoutTransferStepResult[];
  netGain: number;
  hitCount: number;
  hitCost: number;
  ftUsed: number;
  startXI: ScoutTransferXiSummary;
  endXI: ScoutTransferXiSummary;
  startBank: number;
  endBank: number;
  horizonCount: number;
  horizonEndGw: number;
  bestScore: number;
}

export interface ScoutTransferPrecomputedContext {
  playerById: Map<number, ScoutModelPlayerInput>;
  effById: Map<number, ScoutTransferPlayerEff>;
  clubIdxMap: Map<string, number>;
  fitByUtil: Record<PositionType, ScoutTransferPlayerEff[]>;
  fitEnablers: Record<PositionType, ScoutTransferPlayerEff[]>;
}

export function buildScoutTransferPrecomputedContext(params: {
  players: ScoutModelPlayerInput[];
  startGw: number;
  targetNextGW: number;
  horizonCount: number;
  policy?: ScoutSelectionPolicy;
  quantilesByPlayerGw?: Map<number, Map<number, number[]>>;
  sellingPriceById?: Map<number, number>;
}): ScoutTransferPrecomputedContext {
  const {
    players,
    startGw,
    targetNextGW,
    horizonCount,
    policy = DEFAULT_SCOUT_SELECTION_POLICY,
    quantilesByPlayerGw,
    sellingPriceById,
  } = params;

  const hPolicy = getTransferHorizonPolicy(policy, horizonCount);
  const maxAllowedHorizonGw = startGw < targetNextGW ? targetNextGW - 1 : 38;
  const effHorizonCount = Math.max(1, Math.min(horizonCount, maxAllowedHorizonGw - startGw + 1));
  const horizonEndGw = Math.min(maxAllowedHorizonGw, startGw + effHorizonCount - 1);

  const clubIdxMap = new Map<string, number>();
  let nextClubIdx = 0;
  const getClubIdx = (short: string) => {
    let idx = clubIdxMap.get(short);
    if (idx === undefined) {
      idx = nextClubIdx++;
      clubIdxMap.set(short, idx);
    }
    return idx;
  };

  const effById = new Map<number, ScoutTransferPlayerEff>();
  const playerById = new Map<number, ScoutModelPlayerInput>();
  const fitPosAll: Record<PositionType, ScoutTransferPlayerEff[]> = {
    GKP: [],
    DEF: [],
    MID: [],
    FWD: [],
  };

  for (const p of players) {
    playerById.set(p.id, p);
    const c1 = getCellAtGw(p, startGw, targetNextGW);
    const isOutStatus =
      startGw >= targetNextGW &&
      (p.status === 'i' ||
        p.status === 's' ||
        p.status === 'u' ||
        (p.status === 'd' && p.chanceOfPlaying != null && p.chanceOfPlaying <= 25));
    const isDoubt =
      startGw >= targetNextGW && p.status === 'd' && !isOutStatus;

    const isBenchFodder = !isOutStatus && c1.pStart < 0.25 && c1.xMin < 18;
    const isBroken = isOutStatus || isBenchFodder || (c1.isBlank && effHorizonCount === 1);
    const isNailedSafe =
      !isOutStatus &&
      !isDoubt &&
      c1.pStart >= Math.max(0.55, hPolicy.minInPStart) &&
      c1.xMin >= 50;

    let sumXpH = 0;
    let sumUtilH = 0;
    for (let g = startGw; g <= horizonEndGw; g++) {
      const cg = getCellAtGw(p, g, targetNextGW);
      sumXpH += cg.xp;
      const relBonus = hPolicy.pStartRelWeight * (cg.pStart - 0.70);
      const upsideBonus = hPolicy.upsideWeight * Math.max(0, cg.mcQ85 - cg.xp);
      sumUtilH += Math.max(0, cg.xp + relBonus + upsideBonus);
    }

    const qLadder =
      quantilesByPlayerGw?.get(p.id)?.get(startGw) ?? c1.mcQuantiles;

    const eff: ScoutTransferPlayerEff = {
      id: p.id,
      position: p.position,
      teamShort: p.teamShort,
      clubIdx: getClubIdx(p.teamShort),
      cost: p.cost,
      sellingPrice: sellingPriceById?.get(p.id) ?? p.cost,
      isOutStatus,
      isBroken,
      isBenchFodder,
      isDoubt,
      isNailedSafe,
      effXp1: round2(c1.xp),
      effXpH: round2(sumXpH),
      utilityH: round2(sumUtilH),
      pStart1: c1.pStart,
      xMin1: c1.xMin,
      mcQ85_1: c1.mcQ85,
      mcQuantiles: qLadder,
    };
    effById.set(p.id, eff);

    if (
      eff.effXpH > 0 &&
      isScoutPlayerEligibleAtGw({
        player: p,
        gw: startGw,
        targetNextGW,
        minPStart: hPolicy.minInPStart,
        minXMin: 25,
      })
    ) {
      fitPosAll[p.position].push(eff);
    }
  }

  const fitByUtil: Record<PositionType, ScoutTransferPlayerEff[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  const fitEnablers: Record<PositionType, ScoutTransferPlayerEff[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const pos of POSITIONS_ORDER) {
    const arr = fitPosAll[pos];
    fitByUtil[pos] = [...arr].sort(
      (a, b) => b.utilityH - a.utilityH || b.effXpH - a.effXpH || b.effXp1 - a.effXp1
    );
    const maxCost = pos === 'FWD' ? 6.0 : pos === 'MID' ? 5.5 : 4.6;
    fitEnablers[pos] = arr
      .filter((e) => e.cost <= maxCost && e.pStart1 >= 0.6)
      .sort((a, b) => b.utilityH / Math.max(b.cost, 4) - a.utilityH / Math.max(a.cost, 4));
  }

  return { playerById, effById, clubIdxMap, fitByUtil, fitEnablers };
}

export function runScoutTransferSearch(params: {
  players: ScoutModelPlayerInput[];
  squad15Ids: number[];
  bank: number;
  ftAllowance: number;
  transferMode: 'FT' | 'HIT';
  startGw: number;
  targetNextGW: number;
  horizonCount: number;
  policy?: ScoutSelectionPolicy;
  quantilesByPlayerGw?: Map<number, Map<number, number[]>>;
  sellingPriceById?: Map<number, number>;
  maxHitDepth?: number;
  maxDepthCap?: number;
  beamWidth?: number;
  candidateTopN?: number;
  precomputedContext?: ScoutTransferPrecomputedContext;
}): ScoutTransferSearchResult {
  const {
    players,
    squad15Ids,
    bank,
    ftAllowance,
    transferMode,
    startGw,
    targetNextGW,
    horizonCount,
    policy = DEFAULT_SCOUT_SELECTION_POLICY,
    quantilesByPlayerGw,
    sellingPriceById,
    maxHitDepth = 15,
    maxDepthCap = 15,
    beamWidth = 10,
    candidateTopN = 18,
    precomputedContext,
  } = params;

  const hPolicy = getTransferHorizonPolicy(policy, horizonCount);
  const maxAllowedHorizonGw = startGw < targetNextGW ? targetNextGW - 1 : 38;
  const effHorizonCount = Math.max(1, Math.min(horizonCount, maxAllowedHorizonGw - startGw + 1));
  const horizonEndGw = Math.min(maxAllowedHorizonGw, startGw + effHorizonCount - 1);

  const builtCtx =
    precomputedContext ||
    buildScoutTransferPrecomputedContext({
      players,
      startGw,
      targetNextGW,
      horizonCount,
      policy,
      quantilesByPlayerGw,
      sellingPriceById,
    });
  const { effById, playerById } = builtCtx;

  const getEff = (id: number) => effById.get(id);

  const solveOptimalXI = (ids: number[]): ScoutTransferXiSummary => {
    const gkps: ScoutTransferPlayerEff[] = [];
    const defs: ScoutTransferPlayerEff[] = [];
    const mids: ScoutTransferPlayerEff[] = [];
    const fwds: ScoutTransferPlayerEff[] = [];

    for (let i = 0; i < ids.length; i++) {
      const item = getEff(ids[i]);
      if (!item) continue;
      if (item.position === 'GKP') gkps.push(item);
      else if (item.position === 'DEF') defs.push(item);
      else if (item.position === 'MID') mids.push(item);
      else fwds.push(item);
    }

    const byUtil = (a: ScoutTransferPlayerEff, b: ScoutTransferPlayerEff) =>
      b.utilityH - a.utilityH || b.effXpH - a.effXpH || b.effXp1 - a.effXp1;
    gkps.sort(byUtil);
    defs.sort(byUtil);
    mids.sort(byUtil);
    fwds.sort(byUtil);

    const startGkp = gkps[0];
    const benchGkp = gkps[1];

    const defPref = [0];
    for (let i = 0; i < defs.length; i++) defPref.push(defPref[i] + defs[i].utilityH);
    const midPref = [0];
    for (let i = 0; i < mids.length; i++) midPref.push(midPref[i] + mids[i].utilityH);
    const fwdPref = [0];
    for (let i = 0; i < fwds.length; i++) fwdPref.push(fwdPref[i] + fwds[i].utilityH);

    let bestD = -1;
    let bestM = -1;
    let bestF = -1;
    let bestObj = -1e9;

    for (let f = 0; f < FORMATIONS.length; f++) {
      const [dCount, mCount, fCount] = FORMATIONS[f];
      if (defs.length < dCount || mids.length < mCount || fwds.length < fCount) continue;
      const obj = defPref[dCount] + midPref[mCount] + fwdPref[fCount];
      if (obj > bestObj) {
        bestObj = obj;
        bestD = dCount;
        bestM = mCount;
        bestF = fCount;
      }
    }

    let bestFormLabel = '3-4-3';
    let bestStarters: ScoutTransferPlayerEff[];
    let bestBenchOut: ScoutTransferPlayerEff[];

    if (bestD >= 0) {
      bestFormLabel = `${bestD}-${bestM}-${bestF}`;
      bestStarters = startGkp ? [startGkp] : [];
      for (let i = 0; i < bestD; i++) bestStarters.push(defs[i]);
      for (let i = 0; i < bestM; i++) bestStarters.push(mids[i]);
      for (let i = 0; i < bestF; i++) bestStarters.push(fwds[i]);

      bestBenchOut = [];
      for (let i = bestD; i < defs.length; i++) bestBenchOut.push(defs[i]);
      for (let i = bestM; i < mids.length; i++) bestBenchOut.push(mids[i]);
      for (let i = bestF; i < fwds.length; i++) bestBenchOut.push(fwds[i]);
      bestBenchOut.sort(byUtil);
    } else {
      const sortedAll = [...gkps, ...defs, ...mids, ...fwds].sort(byUtil);
      bestStarters = sortedAll.slice(0, 11);
      bestBenchOut = sortedAll.slice(11);
    }

    const bench = benchGkp ? [benchGkp, ...bestBenchOut] : bestBenchOut;
    let rawXiXp1 = 0;
    let rawXiXpH = 0;
    let rawXiUtilH = 0;
    let rawStartersCost = 0;
    let brokenStarters = 0;
    let safeStarterCount = 0;

    for (const x of bestStarters) {
      rawXiXp1 += x.effXp1;
      rawXiXpH += x.effXpH;
      rawXiUtilH += x.utilityH;
      rawStartersCost += x.cost;
      if (x.isBroken) brokenStarters++;
      if (x.isNailedSafe) safeStarterCount++;
    }
    let benchPlayables = 0;
    for (const b of bestBenchOut) {
      if (b.isNailedSafe) benchPlayables++;
    }

    const benchDepthH = round2(
      (bestBenchOut[0]?.effXpH || 0) * 0.05 +
        (bestBenchOut[1]?.effXpH || 0) * 0.02 +
        (benchGkp?.effXpH || 0) * 0.01
    );

    return {
      starterIds: bestStarters.map((x) => x.id),
      benchIds: bench.map((x) => x.id),
      formation: bestFormLabel,
      xiXp1: round1(rawXiXp1),
      xiXpH: round1(rawXiXpH),
      xiUtilityH: round2(rawXiUtilH),
      benchDepthH,
      brokenStarters,
      safeStarterCount,
      benchPlayables,
      startersCost: round1(rawStartersCost),
    };
  };

  const validBaseIds = squad15Ids.filter((id) => effById.has(id));
  const baseXI = solveOptimalXI(validBaseIds);
  const startBank = round1(bank);

  if (validBaseIds.length < 11) {
    return {
      needTransfer: false,
      moves: [],
      netGain: 0,
      hitCount: 0,
      hitCost: 0,
      ftUsed: 0,
      startXI: baseXI,
      endXI: baseXI,
      startBank,
      endBank: startBank,
      horizonCount: effHorizonCount,
      horizonEndGw,
      bestScore: 0,
    };
  }

  // FT opportunity cost scales smoothly with banked FT abundance (5 FT near expiry vs 1 FT)
  const ftDiscountFactor = ftAllowance >= 5 ? 0.45 : ftAllowance === 4 ? 0.72 : 1.0;
  const normalFtValue = round2(hPolicy.ftValueBase * ftDiscountFactor);
  const repairFtValue = hPolicy.repairFtValue;
  const getFtCostForStep = (stepIndex1Based: number) =>
    stepIndex1Based <= baseXI.brokenStarters ? repairFtValue : normalFtValue;

  const baseIdSet = new Set(validBaseIds);
  const candidatesByPos: Record<PositionType, ScoutTransferPlayerEff[]> = {
    GKP: [],
    DEF: [],
    MID: [],
    FWD: [],
  };

  for (const pos of POSITIONS_ORDER) {
    const merged = new Map<number, ScoutTransferPlayerEff>();
    const utilList = builtCtx.fitByUtil[pos];
    let topAdded = 0;
    for (let i = 0; i < utilList.length && topAdded < candidateTopN; i++) {
      const item = utilList[i];
      if (baseIdSet.has(item.id)) continue;
      merged.set(item.id, item);
      topAdded++;
    }
    const enablerList = builtCtx.fitEnablers[pos];
    let enablerAdded = 0;
    for (let i = 0; i < enablerList.length && enablerAdded < 4; i++) {
      const item = enablerList[i];
      if (baseIdSet.has(item.id)) continue;
      merged.set(item.id, item);
      enablerAdded++;
    }
    candidatesByPos[pos] = Array.from(merged.values());
  }

  interface SearchState {
    squadIds: number[];
    bank: number;
    moves: ScoutTransferStepResult[];
    xi: ScoutTransferXiSummary;
    xiGain1: number;
    xiGainH: number;
    utilGainH: number;
    ftCost: number;
    hitCount: number;
    hitCost: number;
    netDecisionScore: number;
    meetsHitGuard: boolean;
  }

  const p9PolicyThresholds = {
    minNetNonMid: hPolicy.p9MinNetNonMid,
    minNetMid: hPolicy.p9MinNetMid,
    minNetBroken: hPolicy.p9MinNetBroken,
    minPBeatNonMid: hPolicy.p9MinPBeatNonMid,
    minPBeatMid: hPolicy.p9MinPBeatMid,
    minPBeatBroken: hPolicy.p9MinPBeatBroken,
  };
  const p9Memo = new Map<string, boolean>();

  const evaluateState = (
    squadIds: number[],
    nextBank: number,
    moves: ScoutTransferStepResult[]
  ): SearchState => {
    const xi = moves.length === 0 ? baseXI : solveOptimalXI(squadIds);
    const xiGain1 = round1(xi.xiXp1 - baseXI.xiXp1);
    const xiGainH = round1(xi.xiXpH - baseXI.xiXpH);
    const utilGainH = round2(xi.xiUtilityH - baseXI.xiUtilityH);
    const depthGainH = round2(clamp(xi.benchDepthH - baseXI.benchDepthH, -1.0, 1.0));
    const budgetTieBreak = round2(Math.max(0, xi.startersCost - baseXI.startersCost) * 0.004);

    const k = moves.length;
    const ftUsed = Math.min(k, ftAllowance);
    const hitCount = Math.max(0, k - ftAllowance);
    const hitCost = hitCount * 4;

    let ftCost = 0;
    for (let i = 1; i <= ftUsed; i++) {
      ftCost += getFtCostForStep(i);
    }
    ftCost = round2(ftCost);

    const repairedStarter = xi.brokenStarters < baseXI.brokenStarters;
    let p9HitViable = true;
    if (hitCount > 0) {
      const rankedByGain1 = [...moves].sort(
        (a, b) => (b.effXp1In - b.effXp1Out) - (a.effXp1In - a.effXp1Out)
      );
      const hitMoves = rankedByGain1.slice(ftUsed);
      for (const hm of hitMoves) {
        const memoKey = `${hm.outId}_${hm.inId}`;
        let viable = p9Memo.get(memoKey);
        if (viable === undefined) {
          const inEff = getEff(hm.inId);
          const outEff = getEff(hm.outId);
          if (!inEff || !outEff) {
            viable = false;
          } else {
            const p9 = evaluateP9HitTransfer({
              posIn: inEff.position,
              posOut: outEff.position,
              inXp1: hm.effXp1In,
              outXp1: hm.effXp1Out,
              inQuantiles: inEff.mcQuantiles,
              outQuantiles: outEff.mcQuantiles,
              outIsBroken: outEff.isBroken,
              horizonCount: effHorizonCount,
              policyThresholds: p9PolicyThresholds,
            });
            viable = p9.viable;
          }
          p9Memo.set(memoKey, viable);
        }
        if (!viable) {
          p9HitViable = false;
          break;
        }
      }
    }

    const activeHitMargin =
      effHorizonCount === 1 && repairedStarter && p9HitViable
        ? Math.min(hPolicy.hitSurplusMargin, 0.8)
        : hPolicy.hitSurplusMargin;
    const meetsHitGuard =
      hitCount === 0 ||
      (p9HitViable &&
        xiGainH >= hitCost + hitCount * activeHitMargin &&
        (effHorizonCount === 1 ? xiGain1 > 0 : xiGain1 >= -0.5 || repairedStarter));

    const effectiveHitCost = hitCost + hitCount * activeHitMargin;
    const netDecisionScore = round2(
      utilGainH + depthGainH + budgetTieBreak - effectiveHitCost - ftCost
    );

    return {
      squadIds,
      bank: round1(nextBank),
      moves,
      xi,
      xiGain1,
      xiGainH,
      utilGainH,
      ftCost,
      hitCount,
      hitCost,
      netDecisionScore,
      meetsHitGuard,
    };
  };

  const initialState = evaluateState(validBaseIds, startBank, []);
  const isHitMode = transferMode === 'HIT';
  const maxDepth = Math.min(maxDepthCap, isHitMode ? Math.min(15, ftAllowance + maxHitDepth) : ftAllowance);

  const allEvaluatedStates: SearchState[] = [initialState];
  let frontier: SearchState[] = [initialState];
  const clubLimit = Math.max(builtCtx.clubIdxMap.size + 1, 20);

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextMap = new Map<string, SearchState>();

    for (const state of frontier) {
      const currentSet = new Set(state.squadIds);
      const boughtIds = new Set(state.moves.map((m) => m.inId));
      const soldIds = new Set(state.moves.map((m) => m.outId));
      const clubCounts = new Int32Array(clubLimit);
      for (const id of state.squadIds) {
        const eff = getEff(id);
        if (eff && eff.clubIdx < clubLimit) clubCounts[eff.clubIdx]++;
      }

      const outOrder = [...state.squadIds]
        .filter((id) => !boughtIds.has(id))
        .sort(
          (a, b) =>
            Number(getEff(b)?.isBroken || 0) - Number(getEff(a)?.isBroken || 0) ||
            (getEff(a)?.utilityH || 0) - (getEff(b)?.utilityH || 0)
        );
      const outCandidates = depth > ftAllowance + 2 ? outOrder.slice(0, 8) : outOrder;

      for (const outId of outCandidates) {
        const outEff = getEff(outId);
        if (!outEff) continue;
        const inCandidates = candidatesByPos[outEff.position] || [];

        for (const inEff of inCandidates) {
          if (currentSet.has(inEff.id) || soldIds.has(inEff.id)) continue;
          const newBank = round1(state.bank + outEff.sellingPrice - inEff.cost);
          if (newBank < -0.05) continue;

          if (inEff.clubIdx !== outEff.clubIdx && clubCounts[inEff.clubIdx] >= 3) continue;

          const newSquadIds = state.squadIds.map((id) => (id === outId ? inEff.id : id));
          const step: ScoutTransferStepResult = {
            outId,
            inId: inEff.id,
            effXp1Out: outEff.effXp1,
            effXpHOut: outEff.effXpH,
            effXp1In: inEff.effXp1,
            effXpHIn: inEff.effXpH,
            isHit: depth > ftAllowance,
            stepNum: depth,
            bankBefore: state.bank,
            bankAfter: Math.max(0, newBank),
            isOutStatusOut: outEff.isOutStatus,
            isBenchFodderOut: outEff.isBenchFodder,
            isDoubtOut: outEff.isDoubt,
            sellingPriceOut: outEff.sellingPrice,
          };
          const evaluated = evaluateState(newSquadIds, Math.max(0, newBank), [...state.moves, step]);

          const isBudgetUnlock = newBank >= state.bank + 1.5;
          if (
            depth > ftAllowance &&
            !isBudgetUnlock &&
            evaluated.netDecisionScore <= state.netDecisionScore + 0.2
          ) {
            continue;
          }

          const key = [...newSquadIds].sort((a, b) => a - b).join(',');
          const existing = nextMap.get(key);
          if (!existing || evaluated.netDecisionScore > existing.netDecisionScore) {
            nextMap.set(key, evaluated);
          }
        }
      }
    }

    const layerStates = Array.from(nextMap.values());
    if (layerStates.length === 0) break;

    for (const st of layerStates) {
      if (st.meetsHitGuard) {
        allEvaluatedStates.push(st);
      }
    }

    const byScore = [...layerStates].sort((a, b) => b.netDecisionScore - a.netDecisionScore).slice(0, beamWidth);
    const byBankUnlock = [...layerStates]
      .filter((s) => s.bank >= round1(initialState.bank + 1.5))
      .sort((a, b) => b.bank - a.bank || b.netDecisionScore - a.netDecisionScore)
      .slice(0, 3);

    const mergedBeam = new Map<string, SearchState>();
    for (const s of [...byScore, ...byBankUnlock]) {
      const k = [...s.squadIds].sort((a, b) => a - b).join(',');
      mergedBeam.set(k, s);
    }
    frontier = Array.from(mergedBeam.values());
  }

  const bestRealXiNetByHit = new Map<number, number>();
  for (const st of allEvaluatedStates) {
    const realNet = round1(st.xiGainH - st.hitCost);
    const prevBest = bestRealXiNetByHit.get(st.hitCount);
    if (prevBest === undefined || realNet > prevBest) {
      bestRealXiNetByHit.set(st.hitCount, realNet);
    }
  }

  const marginalHitMargin = hPolicy.marginalHitMargin;
  const marginallyValidStates = allEvaluatedStates.filter((st) => {
    if (st.hitCount === 0) return true;
    const stRealNet = round1(st.xiGainH - st.hitCost);
    for (const [prevHit, prevRealNet] of bestRealXiNetByHit.entries()) {
      if (prevHit < st.hitCount) {
        const extraHits = st.hitCount - prevHit;
        if (stRealNet < prevRealNet + extraHits * marginalHitMargin) {
          return false;
        }
      }
    }
    return true;
  });

  const sortedBest = [...marginallyValidStates].sort(
    (a, b) => b.netDecisionScore - a.netDecisionScore || a.hitCount - b.hitCount
  );
  const bestState = sortedBest[0] || initialState;
  const needTransfer = bestState.moves.length > 0 && bestState.netDecisionScore > 0;
  const ftUsed = Math.min(bestState.moves.length, ftAllowance);
  const netGain = round1(bestState.xiGainH - bestState.hitCost);

  return {
    needTransfer,
    moves: needTransfer ? bestState.moves : [],
    netGain: needTransfer ? netGain : 0,
    hitCount: needTransfer ? bestState.hitCount : 0,
    hitCost: needTransfer ? bestState.hitCost : 0,
    ftUsed: needTransfer ? ftUsed : 0,
    startXI: baseXI,
    endXI: needTransfer ? bestState.xi : baseXI,
    startBank,
    endBank: needTransfer ? bestState.bank : startBank,
    horizonCount: effHorizonCount,
    horizonEndGw,
    bestScore: needTransfer ? bestState.netDecisionScore : 0,
  };
}

// ============================================================================
// STRICT CAUSAL WALK-FORWARD CALIBRATION ACROSS ALL 5 SCOUT SUBTABS
// ============================================================================
export interface ScoutCalibrationInput {
  players: ScoutModelPlayerInput[];
  baseHistoricalGW: number;
  targetNextGW: number;
  actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>>;
  ownershipPlayersByGw: Record<number, PlayerOwnershipItem[]>;
  standingsByGw: Record<number, StandingsRow[]>;
  allTransfers?: Array<{ entry_id: number; event: number }>;
  allChipsUsed?: Array<{
    entry_id: number;
    wc1?: { gw: number } | null;
    wc2?: { gw: number } | null;
    fh1?: { gw: number } | null;
    fh2?: { gw: number } | null;
  }>;
  quantilesByPlayerGw?: Map<number, Map<number, number[]>>;
  maxCalibrationGw?: number; // Allows expanding-window leave-future-out benchmarking at t
  minCalibrationGw?: number;
}

export function estimateCausalFtAtGw(params: {
  entryId: number;
  upToPrevGw: number;
  targetNextGW?: number;
  allTransfers?: Array<{ entry_id: number; event: number }>;
  standingsByGw?: Record<number, StandingsRow[]>;
  allChipsUsed?: ScoutCalibrationInput['allChipsUsed'];
}): number {
  const { entryId, upToPrevGw, targetNextGW, allTransfers, standingsByGw, allChipsUsed } = params;
  const effUpToPrevGw =
    targetNextGW !== undefined ? Math.min(upToPrevGw, Math.max(0, targetNextGW - 1)) : upToPrevGw;
  if (effUpToPrevGw < 1) return 1;

  const chipRow = allChipsUsed?.find((c) => c.entry_id === entryId);
  const preserveGws = new Set<number>();
  if (chipRow?.wc1?.gw && chipRow.wc1.gw <= effUpToPrevGw) preserveGws.add(chipRow.wc1.gw);
  if (chipRow?.wc2?.gw && chipRow.wc2.gw <= effUpToPrevGw) preserveGws.add(chipRow.wc2.gw);
  if (chipRow?.fh1?.gw && chipRow.fh1.gw <= effUpToPrevGw) preserveGws.add(chipRow.fh1.gw);
  if (chipRow?.fh2?.gw && chipRow.fh2.gw <= effUpToPrevGw) preserveGws.add(chipRow.fh2.gw);

  const countByGw = new Map<number, number>();
  if (allTransfers) {
    for (const tr of allTransfers) {
      if (tr.entry_id === entryId && tr.event <= effUpToPrevGw) {
        countByGw.set(tr.event, (countByGw.get(tr.event) || 0) + 1);
      }
    }
  }

  let ft = 1;
  for (let gw = 2; gw <= effUpToPrevGw; gw++) {
    const row = standingsByGw?.[gw]?.find((r) => r.entry_id === entryId);
    const chipName = (row?.active_chip || '').toLowerCase();
    if (preserveGws.has(gw) || chipName.includes('wildcard') || chipName.includes('free')) {
      ft = Math.max(1, Math.min(5, ft));
      continue;
    }
    const made = countByGw.get(gw) || 0;
    const hitCost = Number(row?.event_transfers_cost || 0);
    const paidTransfers = Math.max(0, Math.round(hitCost / 4));
    const freeUsed = Math.max(0, made - paidTransfers);
    const spentFt = hitCost > 0 ? ft : Math.min(ft, freeUsed);
    ft = Math.min(5, Math.max(1, ft - spentFt + 1));
  }
  return ft;
}

const yieldScoutLoop = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });

export async function calibrateScoutPolicyWalkForward(input: ScoutCalibrationInput): Promise<ScoutSelectionPolicy> {
  const {
    players,
    baseHistoricalGW,
    targetNextGW,
    actualPlayerStatsMap,
    ownershipPlayersByGw,
    standingsByGw,
    allTransfers,
    allChipsUsed,
    quantilesByPlayerGw,
    maxCalibrationGw,
    minCalibrationGw = 3,
  } = input;

  const effMinCalGw = Math.max(3, minCalibrationGw);
  const endCalGw = Math.min(baseHistoricalGW, targetNextGW - 1, maxCalibrationGw ?? (targetNextGW - 1));
  if (endCalGw < effMinCalGw || players.length < 15) {
    return {
      ...DEFAULT_SCOUT_SELECTION_POLICY,
      calibrationGwRange: [effMinCalGw, Math.max(effMinCalGw, endCalGw)],
    };
  }

  // Strictly isolate actuals and baseline lookups to [effMinCalGw..endCalGw] (GW 3..n-1)
  const causalActualStatsMap: Record<number, Record<number, ActualPlayerReviewStat>> = {};
  for (const [pidStr, gMap] of Object.entries(actualPlayerStatsMap || {})) {
    const pid = Number(pidStr);
    const filtered: Record<number, ActualPlayerReviewStat> = {};
    for (const [gwStr, st] of Object.entries(gMap || {})) {
      const g = Number(gwStr);
      if (g >= effMinCalGw && g <= endCalGw) {
        filtered[g] = st;
      }
    }
    if (Object.keys(filtered).length > 0) {
      causalActualStatsMap[pid] = filtered;
    }
  }
  const causalTransfers = allTransfers?.filter((tr) => tr.event < targetNextGW);
  const causalChips = allChipsUsed?.map((c) => ({
    ...c,
    wc1: c.wc1 && c.wc1.gw < targetNextGW ? c.wc1 : null,
    wc2: c.wc2 && c.wc2.gw < targetNextGW ? c.wc2 : null,
    fh1: c.fh1 && c.fh1.gw < targetNextGW ? c.fh1 : null,
    fh2: c.fh2 && c.fh2.gw < targetNextGW ? c.fh2 : null,
  }));

  const posById = new Map<number, PositionType>(players.map((p) => [p.id, p.position]));
  const evalGws: number[] = [];
  for (let s = effMinCalGw; s <= endCalGw; s++) {
    if (Object.keys(causalActualStatsMap).length > 0) {
      evalGws.push(s);
    }
  }
  if (evalGws.length === 0) {
    return {
      ...DEFAULT_SCOUT_SELECTION_POLICY,
      calibrationGwRange: [effMinCalGw, endCalGw],
    };
  }

  const recencyWeight = (gw: number) => Math.exp(-(endCalGw - gw) / 6.0);
  const getActualPts = (pid: number, gw: number) =>
    gw >= effMinCalGw && gw <= endCalGw ? Number(causalActualStatsMap[pid]?.[gw]?.pts || 0) : 0;
  const getActualStatsForGw = (gw: number) => (pid: number) =>
    gw >= effMinCalGw && gw <= endCalGw ? causalActualStatsMap[pid]?.[gw] : undefined;

  // Build strict causal ownership maps for GW s using ownership_players[s - 1] (strictly s - 1 <= targetNextGW - 2)
  const causalOwnPctByGw = new Map<number, Map<number, number>>();
  const causalSquadsByGw = new Map<number, Array<{ entryId: number; squadIds: number[]; ft: number }>>();

  for (const s of evalGws) {
    const prevGw = s - 1;
    const ownList = prevGw < targetNextGW ? ownershipPlayersByGw?.[prevGw] || [] : [];
    const totalManagers = Math.max(
      standingsByGw?.[prevGw]?.length || (s < targetNextGW ? standingsByGw?.[s]?.length : 0) || 97,
      1
    );
    const pctMap = new Map<number, number>();
    const squadByEntry = new Map<number, number[]>();

    for (const item of ownList) {
      const owners = item.owners || [];
      pctMap.set(item.id, (owners.length / totalManagers) * 100);
      for (const o of owners) {
        let arr = squadByEntry.get(o.entry_id);
        if (!arr) {
          arr = [];
          squadByEntry.set(o.entry_id, arr);
        }
        arr.push(item.id);
      }
    }
    causalOwnPctByGw.set(s, pctMap);

    // Sample representative managers evenly across standings ranks for transfer walk-forward calibration
    const standingsPrev = standingsByGw?.[prevGw] || (s < targetNextGW ? standingsByGw?.[s] : undefined) || [];
    const sampled: Array<{ entryId: number; squadIds: number[]; ft: number }> = [];
    const targetSampleCount = 8;
    const step = Math.max(1, Math.floor(standingsPrev.length / targetSampleCount));
    for (let i = 0; i < standingsPrev.length && sampled.length < targetSampleCount; i += step) {
      const eid = standingsPrev[i].entry_id;
      const sq = squadByEntry.get(eid);
      if (sq && sq.length >= 11) {
        const ft = estimateCausalFtAtGw({
          entryId: eid,
          upToPrevGw: prevGw,
          targetNextGW,
          allTransfers: causalTransfers,
          standingsByGw,
          allChipsUsed: causalChips,
        });
        sampled.push({ entryId: eid, squadIds: sq.slice(0, 15), ft });
      }
    }
    causalSquadsByGw.set(s, sampled);
  }

  // Filter active pool once (any player with projection in eval GWs or targetNextGW)
  const activePool = players.filter((p) => {
    for (const s of evalGws) {
      const c = p.fullSeasonPointsMap?.[s];
      if (c && !c.isBlank && c.xp > 0.1) return true;
    }
    const cT = p.fullSeasonPointsMap?.[targetNextGW];
    return Boolean(cT && !cT.isBlank && cT.xp > 0.1);
  });
  const playerById = new Map<number, ScoutModelPlayerInput>(activePool.map((p) => [p.id, p]));

  // =========================================================================
  // 1. CALIBRATE CAPTAIN POLICY (ISOLATED WALK-FORWARD)
  // =========================================================================
  let bestCapCfg = DEFAULT_SCOUT_SELECTION_POLICY.captain;
  let bestCapScore = -Infinity;
  let bestCapTop1Avg = 0;
  let bestCapTop3Avg = 0;

  const capGrid = {
    wTail: [0.20, 0.35, 0.60],
    wHaul: [0.15, 0.25, 0.50],
    wPStart: [0.40, 0.60, 0.85],
    wPen: [0.50, 0.80, 1.10],
    defPenalty: [0.80, 1.50],
  };

  for (const wTail of capGrid.wTail) {
    await yieldScoutLoop();
    for (const wHaul of capGrid.wHaul) {
      for (const wPStart of capGrid.wPStart) {
        for (const wPen of capGrid.wPen) {
          for (const defPenalty of capGrid.defPenalty) {
            const cfg = { wTail, wHaul, wPStart, wPen, defPenalty, minPStart: 0.50 };
            const testPolicy: ScoutSelectionPolicy = { ...DEFAULT_SCOUT_SELECTION_POLICY, captain: cfg };

            let wSumObj = 0;
            let wTotal = 0;
            let top1Sum = 0;
            let top3Sum = 0;

            for (const s of evalGws) {
              const cand = activePool.filter((p) =>
                isScoutPlayerEligibleAtGw({
                  player: p,
                  gw: s,
                  targetNextGW,
                  minPStart: cfg.minPStart,
                  minXMin: 25,
                })
              );
              const ranked = cand
                .map((p) => ({
                  id: p.id,
                  score: scoreCaptainAtGw(p, s, targetNextGW, testPolicy),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

              if (ranked.length === 0) continue;
              const p1 = getActualPts(ranked[0].id, s) * 2;
              const p3 =
                (ranked.slice(0, 3).reduce((acc, r) => acc + getActualPts(r.id, s), 0) /
                  Math.min(3, ranked.length)) *
                2;
              const p10 =
                (ranked.reduce((acc, r) => acc + getActualPts(r.id, s), 0) / ranked.length) * 2;

              const w = recencyWeight(s);
              wSumObj += w * (0.45 * p1 + 0.35 * p3 + 0.20 * p10);
              wTotal += w;
              top1Sum += p1;
              top3Sum += p3;
            }

            const capPriorDist =
              Math.abs(wTail - 0.35) +
              Math.abs(wHaul - 0.25) +
              0.5 * Math.abs(wPStart - 0.60) +
              0.4 * Math.abs(wPen - 0.80) +
              0.25 * Math.abs(defPenalty - 1.50);
            const capReg = (0.45 / Math.max(1, evalGws.length)) * capPriorDist;
            const obj = (wTotal > 0 ? wSumObj / wTotal : 0) - capReg;
            if (obj > bestCapScore + 1e-6) {
              bestCapScore = obj;
              bestCapCfg = cfg;
              bestCapTop1Avg = round1(top1Sum / evalGws.length);
              bestCapTop3Avg = round1(top3Sum / evalGws.length);
            }
          }
        }
      }
    }
  }

  // =========================================================================
  // 2. CALIBRATE DIFFERENTIAL (<5% CAUSAL FNB OWN) POLICY
  // =========================================================================
  let bestDiffCfg = DEFAULT_SCOUT_SELECTION_POLICY.differential;
  let bestDiffScore = -Infinity;
  let bestDiffTop3Avg = 0;

  const diffGrid = {
    wHorizon: [0.50, 0.60, 0.72],
    wTail: [0.25, 0.40, 0.55],
    wHaul: [0.15, 0.25, 0.40],
    wPStart: [0.60, 0.80],
  };

  for (const wHorizon of diffGrid.wHorizon) {
    await yieldScoutLoop();
    for (const wTail of diffGrid.wTail) {
      for (const wHaul of diffGrid.wHaul) {
        for (const wPStart of diffGrid.wPStart) {
          const cfg = {
            wHorizon,
            wTail,
            wHaul,
            wPStart,
            wPen: 1.00,
            minPStart: 0.50,
            maxFnbOwn: 5.0,
          };
          const testPolicy: ScoutSelectionPolicy = {
            ...DEFAULT_SCOUT_SELECTION_POLICY,
            captain: bestCapCfg,
            differential: cfg,
          };

          let wSumObj = 0;
          let wTotal = 0;
          let top3Sum = 0;

          for (const s of evalGws) {
            const ownMap = causalOwnPctByGw.get(s);
            const cand = activePool.filter((p) => {
              const own = ownMap?.get(p.id) ?? 0;
              if (own >= cfg.maxFnbOwn) return false;
              return isScoutPlayerEligibleAtGw({
                player: p,
                gw: s,
                targetNextGW,
                minPStart: cfg.minPStart,
                minXMin: 25,
              });
            });
            const ranked = cand
              .map((p) => ({
                id: p.id,
                score: scoreDifferentialAtGw(p, s, targetNextGW, testPolicy),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 6);

            if (ranked.length === 0) continue;
            const top3 = ranked.slice(0, 3);
            const avg1Top3 = top3.reduce((acc, r) => acc + getActualPts(r.id, s), 0) / top3.length;
            const avg1Top6 = ranked.reduce((acc, r) => acc + getActualPts(r.id, s), 0) / ranked.length;
            const end3 = Math.min(endCalGw, s + 2);
            let sum3 = 0;
            let gCnt = 0;
            for (let k = s; k <= end3; k++) {
              sum3 += top3.reduce((acc, r) => acc + getActualPts(r.id, k), 0) / top3.length;
              gCnt++;
            }
            const avg3 = gCnt > 0 ? sum3 / gCnt : avg1Top3;
            const w = recencyWeight(s);
            wSumObj += w * (0.40 * avg1Top3 + 0.35 * avg1Top6 + 0.25 * avg3);
            wTotal += w;
            top3Sum += avg1Top3;
          }

          const priorDist =
            Math.abs(wHorizon - 0.60) +
            0.7 * Math.abs(wTail - 0.40) +
            0.7 * Math.abs(wHaul - 0.25) +
            0.3 * Math.abs(wPStart - 0.80);
          const regPenalty = (1.60 / Math.max(1, evalGws.length)) * priorDist;
          const obj = (wTotal > 0 ? wSumObj / wTotal : 0) - regPenalty;
          if (obj > bestDiffScore + 1e-6) {
            bestDiffScore = obj;
            bestDiffCfg = cfg;
            bestDiffTop3Avg = round1(top3Sum / evalGws.length);
          }
        }
      }
    }
  }

  // =========================================================================
  // 3. CALIBRATE PICKS (FREE HIT & WILDCARD) IN ISOLATED WALK-FORWARD
  // =========================================================================
  let bestFhCfg = DEFAULT_SCOUT_SELECTION_POLICY.picksFH;
  let bestFhScore = -Infinity;
  let bestFhRawAvg = 0;

  const fhCandidates: Array<ScoutSelectionPolicy['picksFH']> = [
    DEFAULT_SCOUT_SELECTION_POLICY.picksFH,
    { benchWeight: 0.010, pStartGamma: 0.0, upsideBeta: 0.0, minPStart: 0.45 },
    { benchWeight: 0.025, pStartGamma: 0.45, upsideBeta: 0.08, minPStart: 0.55 },
    { benchWeight: 0.015, pStartGamma: 0.35, upsideBeta: 0.12, minPStart: 0.50 },
    { benchWeight: 0.030, pStartGamma: 0.20, upsideBeta: 0.04, minPStart: 0.45 },
    { benchWeight: 0.012, pStartGamma: 0.55, upsideBeta: 0.0, minPStart: 0.55 },
    { benchWeight: 0.020, pStartGamma: 0.15, upsideBeta: 0.10, minPStart: 0.48 },
    { benchWeight: 0.035, pStartGamma: 0.40, upsideBeta: 0.06, minPStart: 0.52 },
  ];

  const policyWithCapDiff: ScoutSelectionPolicy = {
    ...DEFAULT_SCOUT_SELECTION_POLICY,
    captain: bestCapCfg,
    differential: bestDiffCfg,
  };

  for (const cfg of fhCandidates) {
    await yieldScoutLoop();
    const testPolicy: ScoutSelectionPolicy = { ...policyWithCapDiff, picksFH: cfg };
    let wSum = 0;
    let wTotal = 0;
    let rawSum = 0;

    for (const s of evalGws) {
      const solved = solveScoutSquadForGwMode({
        players: activePool,
        targetNextGW,
        targetGw: s,
        mode: 'FH',
        policy: testPolicy,
        fastMode: true,
        calibrationMode: true,
      });
      if (solved.starterIds.length === 0) continue;

      const sortedStartersCap = [...solved.starterIds].sort((a, b) => {
        const pa = playerById.get(a);
        const pb = playerById.get(b);
        const sa = pa ? scoreCaptainAtGw(pa, s, targetNextGW, testPolicy) : 0;
        const sb = pb ? scoreCaptainAtGw(pb, s, targetNextGW, testPolicy) : 0;
        return sb - sa;
      });
      const sim = simulateFplSquadActualScore({
        starterIds: solved.starterIds,
        benchIds: solved.benchIds,
        captainId: sortedStartersCap[0] ?? null,
        viceCaptainId: sortedStartersCap[1] ?? null,
        actualStatsAtGw: getActualStatsForGw(s),
        posById,
      });

      const w = recencyWeight(s);
      wSum += w * sim.totalWithCap;
      wTotal += w;
      rawSum += sim.totalWithCap;
    }

    const fhPriorDist =
      Math.abs(cfg.pStartGamma - DEFAULT_SCOUT_SELECTION_POLICY.picksFH.pStartGamma) +
      Math.abs(cfg.upsideBeta - DEFAULT_SCOUT_SELECTION_POLICY.picksFH.upsideBeta);
    const obj = (wTotal > 0 ? wSum / wTotal : 0) - (0.60 / Math.max(1, evalGws.length)) * fhPriorDist;
    if (obj > bestFhScore + 1e-6) {
      bestFhScore = obj;
      bestFhCfg = cfg;
      bestFhRawAvg = round1(rawSum / evalGws.length);
    }
  }

  let bestWcCfg = DEFAULT_SCOUT_SELECTION_POLICY.picksWC;
  let bestWcScore = -Infinity;
  let bestWcRawAvg = 0;

  const wcCandidates: Array<ScoutSelectionPolicy['picksWC']> = [
    DEFAULT_SCOUT_SELECTION_POLICY.picksWC,
    { benchWeight: 0.025, pStartGamma: 0.15, upsideBeta: 0.0, minPStart: 0.42 },
    { benchWeight: 0.060, pStartGamma: 0.45, upsideBeta: 0.06, minPStart: 0.50 },
    { benchWeight: 0.045, pStartGamma: 0.25, upsideBeta: 0.10, minPStart: 0.45 },
    { benchWeight: 0.080, pStartGamma: 0.35, upsideBeta: 0.04, minPStart: 0.48 },
    { benchWeight: 0.030, pStartGamma: 0.55, upsideBeta: 0.02, minPStart: 0.52 },
  ];

  const wcEvalStarts = evalGws.filter((s) => s <= endCalGw - 1);
  const effectiveWcStarts = wcEvalStarts.length > 0 ? wcEvalStarts : evalGws;

  for (const cfg of wcCandidates) {
    await yieldScoutLoop();
    const testPolicy: ScoutSelectionPolicy = { ...policyWithCapDiff, picksFH: bestFhCfg, picksWC: cfg };
    let wSum = 0;
    let wTotal = 0;
    let rawSum = 0;

    for (const s of effectiveWcStarts) {
      const winEnd = Math.min(endCalGw, s + 2);
      const winLen = winEnd - s + 1;
      const solved = solveScoutSquadForGwMode({
        players: activePool,
        targetNextGW,
        targetGw: s,
        mode: 'WC',
        policy: testPolicy,
        fastMode: true,
        calibrationMode: true,
        wcHorizonLen: winLen,
        maxGwCap: endCalGw,
      });
      if (solved.starterIds.length === 0) continue;

      const squad15 = [...solved.starterIds, ...solved.benchIds];
      let gwSum = 0;
      for (let k = s; k <= winEnd; k++) {
        // Select optimal XI for GW k from fixed WC 15-man squad using causal k projections
        const startersK = selectBestXiFrom15AtGw(squad15, activePool, k, targetNextGW, testPolicy, playerById);
        const capSorted = [...startersK.starterIds].sort((a, b) => {
          const pa = playerById.get(a);
          const pb = playerById.get(b);
          return (
            (pb ? scoreCaptainAtGw(pb, k, targetNextGW, testPolicy) : 0) -
            (pa ? scoreCaptainAtGw(pa, k, targetNextGW, testPolicy) : 0)
          );
        });
        const simK = simulateFplSquadActualScore({
          starterIds: startersK.starterIds,
          benchIds: startersK.benchIds,
          captainId: capSorted[0] ?? null,
          viceCaptainId: capSorted[1] ?? null,
          actualStatsAtGw: getActualStatsForGw(k),
          posById,
        });
        gwSum += simK.totalWithCap;
      }

      const avgPerGw = gwSum / winLen;
      const w = recencyWeight(s);
      wSum += w * avgPerGw;
      wTotal += w;
      rawSum += avgPerGw;
    }

    const wcPriorDist =
      Math.abs(cfg.pStartGamma - DEFAULT_SCOUT_SELECTION_POLICY.picksWC.pStartGamma) +
      Math.abs(cfg.upsideBeta - DEFAULT_SCOUT_SELECTION_POLICY.picksWC.upsideBeta);
    const obj = (wTotal > 0 ? wSum / wTotal : 0) - (0.60 / Math.max(1, effectiveWcStarts.length)) * wcPriorDist;
    if (obj > bestWcScore + 1e-6) {
      bestWcScore = obj;
      bestWcCfg = cfg;
      bestWcRawAvg = round1(rawSum / effectiveWcStarts.length);
    }
  }

  // =========================================================================
  // 4. CALIBRATE CHIPS POLICY (TC & BB SEPARATED WITH RECENCY & PRIOR SHRINKAGE)
  // =========================================================================
  const chipsPrecomputed: Array<{
    s: number;
    w: number;
    squadIds: number[];
    benchIds: number[];
    benchActual: number;
  }> = [];
  for (const s of evalGws) {
    const squads = causalSquadsByGw.get(s) || [];
    const w = recencyWeight(s);
    for (const sq of squads.slice(0, 6)) {
      const xi = selectBestXiFrom15AtGw(sq.squadIds, activePool, s, targetNextGW, policyWithCapDiff, playerById);
      let benchActual = 0;
      for (const bid of xi.benchIds) benchActual += getActualPts(bid, s);
      chipsPrecomputed.push({ s, w, squadIds: sq.squadIds, benchIds: xi.benchIds, benchActual });
    }
  }

  let bestTcTail = DEFAULT_SCOUT_SELECTION_POLICY.chips.tcTailWeight;
  let bestTcRel = DEFAULT_SCOUT_SELECTION_POLICY.chips.tcReliabilityAlpha;
  let bestTcObj = -Infinity;
  for (const tcTailWeight of [0.05, 0.15, 0.25, 0.35]) {
    for (const tcReliabilityAlpha of [0.05, 0.15, 0.25]) {
      let tcWSum = 0;
      let tcWTot = 0;
      for (const item of chipsPrecomputed) {
        let bestTcScore = -1;
        let bestTcActual = 0;
        for (const pid of item.squadIds) {
          const p = playerById.get(pid);
          if (!p) continue;
          const c = getCellAtGw(p, item.s, targetNextGW);
          const tcS =
            c.xp * (1 - tcReliabilityAlpha + tcReliabilityAlpha * c.pStart) +
            tcTailWeight * Math.max(0, c.mcQ85 - c.xp);
          if (tcS > bestTcScore) {
            bestTcScore = tcS;
            bestTcActual = getActualPts(pid, item.s);
          }
        }
        tcWSum += item.w * bestTcActual;
        tcWTot += item.w;
      }
      const priorDist = Math.abs(tcTailWeight - 0.15) + Math.abs(tcReliabilityAlpha - 0.15);
      const obj = (tcWTot > 0 ? tcWSum / tcWTot : 0) - (0.50 / Math.max(1, evalGws.length)) * priorDist;
      if (obj > bestTcObj + 1e-6) {
        bestTcObj = obj;
        bestTcTail = tcTailWeight;
        bestTcRel = tcReliabilityAlpha;
      }
    }
  }

  let bestBbMin = DEFAULT_SCOUT_SELECTION_POLICY.chips.bbMinPStart;
  let bestBbRel = DEFAULT_SCOUT_SELECTION_POLICY.chips.bbReliabilityAlpha;
  let bestBbObj = -Infinity;
  for (const bbMinPStart of [0.15, 0.25, 0.35, 0.40, 0.48]) {
    for (const bbReliabilityAlpha of [0.00, 0.10, 0.20, 0.30]) {
      let maeWSum = 0;
      let maeWTot = 0;
      for (const item of chipsPrecomputed) {
        let benchWeightedXp = 0;
        for (const bid of item.benchIds) {
          const p = playerById.get(bid);
          if (!p) continue;
          const c = getCellAtGw(p, item.s, targetNextGW);
          if (c.pStart >= bbMinPStart) {
            benchWeightedXp += c.xp * (1 - bbReliabilityAlpha + bbReliabilityAlpha * c.pStart);
          }
        }
        maeWSum += item.w * Math.abs(benchWeightedXp - item.benchActual);
        maeWTot += item.w;
      }
      const priorDist = Math.abs(bbMinPStart - 0.40) + Math.abs(bbReliabilityAlpha - 0.20);
      const obj = -(maeWTot > 0 ? maeWSum / maeWTot : 0) - (0.25 / Math.max(1, evalGws.length)) * priorDist;
      if (obj > bestBbObj + 1e-6) {
        bestBbObj = obj;
        bestBbMin = bbMinPStart;
        bestBbRel = bbReliabilityAlpha;
      }
    }
  }

  const bestChipsCfg = {
    tcTailWeight: bestTcTail,
    tcReliabilityAlpha: bestTcRel,
    bbMinPStart: bestBbMin,
    bbReliabilityAlpha: bestBbRel,
  };

  // =========================================================================
  // 5. CALIBRATE TRANSFER POLICY (1 GW, 3 GW, 6 GW ON CAUSAL MANAGER SQUADS)
  // =========================================================================
  const evalTransferHorizon = async (
    horizon: 1 | 3,
    candidates: ScoutTransferHorizonPolicy[]
  ): Promise<{ best: ScoutTransferHorizonPolicy; avgNetGain: number }> => {
    const validS = horizon === 1 ? evalGws : evalGws.filter((s) => s <= endCalGw - 2);
    const activeS = validS.length > 0 ? validS : evalGws;

    let bestPol = candidates[0];
    let bestScore = -Infinity;
    let bestNetAvg = 0;

    // Precompute baseline XI actuals and pruned transfer pool per GW once
    const baseActualByKey = new Map<string, number>();
    const prunedPoolByGw = new Map<number, ScoutModelPlayerInput[]>();
    for (const s of activeS) {
      const winEnd = Math.min(endCalGw, s + horizon - 1);
      const poolIds = new Set<number>();
      for (const pos of POSITIONS_ORDER) {
        const posRanked = activePool
          .filter((p) => p.position === pos)
          .sort((a, b) => getCellAtGw(b, s, targetNextGW).xp - getCellAtGw(a, s, targetNextGW).xp)
          .slice(0, 14);
        for (const p of posRanked) poolIds.add(p.id);
      }
      for (const sq of causalSquadsByGw.get(s) || []) {
        for (const id of sq.squadIds) poolIds.add(id);
        let sumActual = 0;
        for (let k = s; k <= winEnd; k++) {
          const xiK = selectBestXiFrom15AtGw(sq.squadIds, activePool, k, targetNextGW, policyWithCapDiff, playerById);
          const capSorted = [...xiK.starterIds].sort((a, b) => {
            const pa = playerById.get(a);
            const pb = playerById.get(b);
            return (
              (pb ? scoreCaptainAtGw(pb, k, targetNextGW, policyWithCapDiff) : 0) -
              (pa ? scoreCaptainAtGw(pa, k, targetNextGW, policyWithCapDiff) : 0)
            );
          });
          const simK = simulateFplSquadActualScore({
            starterIds: xiK.starterIds,
            benchIds: xiK.benchIds,
            captainId: capSorted[0] ?? null,
            viceCaptainId: capSorted[1] ?? null,
            actualStatsAtGw: getActualStatsForGw(k),
            posById,
          });
          sumActual += simK.xiPts;
        }
        baseActualByKey.set(`${s}_${sq.entryId}`, sumActual);
      }
      prunedPoolByGw.set(
        s,
        Array.from(poolIds)
          .map((id) => playerById.get(id))
          .filter((p): p is ScoutModelPlayerInput => Boolean(p))
      );
    }

    for (const cand of candidates) {
      await yieldScoutLoop();
      const testPol: ScoutSelectionPolicy = {
        ...policyWithCapDiff,
        picksFH: bestFhCfg,
        picksWC: bestWcCfg,
        chips: bestChipsCfg,
        transfer: {
          h1: horizon === 1 ? cand : DEFAULT_TRANSFER_H1_POLICY,
          h3: horizon === 3 ? cand : DEFAULT_TRANSFER_H3_POLICY,
          h6: DEFAULT_TRANSFER_H6_POLICY,
        },
      };

      let wSum = 0;
      let wTot = 0;
      let netSum = 0;
      let cnt = 0;

      for (const s of activeS) {
        const winEnd = Math.min(endCalGw, s + horizon - 1);
        const effH = winEnd - s + 1;
        const w = recencyWeight(s);
        const sPool = prunedPoolByGw.get(s) || activePool;
        const sPreCtx = buildScoutTransferPrecomputedContext({
          players: sPool,
          startGw: s,
          targetNextGW,
          horizonCount: effH,
          policy: testPol,
          quantilesByPlayerGw,
        });

        for (const sq of causalSquadsByGw.get(s) || []) {
          const res = runScoutTransferSearch({
            players: sPool,
            squad15Ids: sq.squadIds,
            bank: 0.5,
            ftAllowance: sq.ft,
            transferMode: 'HIT',
            startGw: s,
            targetNextGW,
            horizonCount: effH,
            policy: testPol,
            quantilesByPlayerGw,
            maxHitDepth: 1,
            maxDepthCap: 2,
            beamWidth: 3,
            candidateTopN: 8,
            precomputedContext: sPreCtx,
          });

          let realNetGain = 0;
          if (res.needTransfer && res.moves.length > 0) {
            const movedSet = new Set(sq.squadIds);
            for (const m of res.moves) {
              movedSet.delete(m.outId);
              movedSet.add(m.inId);
            }
            const afterIds = Array.from(movedSet);
            let afterActual = 0;
            for (let k = s; k <= winEnd; k++) {
              const xiK = selectBestXiFrom15AtGw(afterIds, sPool, k, targetNextGW, testPol, sPreCtx.playerById);
              const capSorted = [...xiK.starterIds].sort((a, b) => {
                const pa = playerById.get(a);
                const pb = playerById.get(b);
                return (
                  (pb ? scoreCaptainAtGw(pb, k, targetNextGW, testPol) : 0) -
                  (pa ? scoreCaptainAtGw(pa, k, targetNextGW, testPol) : 0)
                );
              });
              const simK = simulateFplSquadActualScore({
                starterIds: xiK.starterIds,
                benchIds: xiK.benchIds,
                captainId: capSorted[0] ?? null,
                viceCaptainId: capSorted[1] ?? null,
                actualStatsAtGw: getActualStatsForGw(k),
                posById,
              });
              afterActual += simK.xiPts;
            }
            const baseActual = baseActualByKey.get(`${s}_${sq.entryId}`) ?? afterActual;
            realNetGain = afterActual - res.hitCost - baseActual;
          }

          // Lightly credit conserved FT flexibility as tie-breaker only
          const savedFts = Math.max(0, sq.ft - res.ftUsed);
          const bankedFtOptionValue = savedFts * 0.10 * (sq.ft >= 5 ? 0.2 : 1.0);
          wSum += w * (realNetGain + bankedFtOptionValue);
          wTot += w;
          netSum += realNetGain;
          cnt++;
        }
      }

      const priorFt = horizon === 1 ? DEFAULT_TRANSFER_H1_POLICY.ftValueBase : DEFAULT_TRANSFER_H3_POLICY.ftValueBase;
      const priorHit = horizon === 1 ? DEFAULT_TRANSFER_H1_POLICY.hitSurplusMargin : DEFAULT_TRANSFER_H3_POLICY.hitSurplusMargin;
      const priorDist = Math.abs(cand.ftValueBase - priorFt) + Math.abs(cand.hitSurplusMargin - priorHit);
      const regPenalty = (0.75 / Math.max(1, activeS.length)) * priorDist;
      const obj = (wTot > 0 ? wSum / wTot : 0) - regPenalty;
      if (obj > bestScore + 1e-6) {
        bestScore = obj;
        bestPol = cand;
        bestNetAvg = cnt > 0 ? round2(netSum / cnt) : 0;
      }
    }

    return { best: bestPol, avgNetGain: bestNetAvg };
  };

  const h1Grid: ScoutTransferHorizonPolicy[] = [DEFAULT_TRANSFER_H1_POLICY];
  for (const ftValueBase of [1.6, 2.2, 2.8]) {
    for (const hitSurplusMargin of [1.0, 1.5]) {
      const tight = hitSurplusMargin >= 1.4;
      const pStartRelWeight = tight ? 0.20 : 0.10;
      h1Grid.push({
        ftValueBase,
        repairFtValue: Math.max(0.7, round2(ftValueBase * 0.45)),
        hitSurplusMargin,
        marginalHitMargin: round2(hitSurplusMargin + 0.2),
        pStartRelWeight,
        upsideWeight: tight ? 0.06 : 0.08,
        minInPStart: tight ? 0.55 : 0.52,
        p9MinNetNonMid: tight ? 1.2 : 0.9,
        p9MinNetMid: tight ? 2.2 : 1.8,
        p9MinNetBroken: tight ? 0.6 : 0.4,
        p9MinPBeatNonMid: tight ? 0.48 : 0.45,
        p9MinPBeatMid: tight ? 0.54 : 0.51,
        p9MinPBeatBroken: tight ? 0.42 : 0.39,
      });
    }
  }

  const h3Grid: ScoutTransferHorizonPolicy[] = [DEFAULT_TRANSFER_H3_POLICY];
  for (const ftValueBase of [2.2, 2.8, 3.4]) {
    for (const hitSurplusMargin of [1.8, 2.4]) {
      const tight = hitSurplusMargin >= 2.2;
      const pStartRelWeight = tight ? 0.25 : 0.18;
      h3Grid.push({
        ftValueBase,
        repairFtValue: Math.max(1.0, round2(ftValueBase * 0.45)),
        hitSurplusMargin,
        marginalHitMargin: round2(hitSurplusMargin + 0.1),
        pStartRelWeight,
        upsideWeight: 0.06,
        minInPStart: 0.50,
        p9MinNetNonMid: tight ? 1.0 : 0.7,
        p9MinNetMid: tight ? 1.8 : 1.5,
        p9MinNetBroken: 0.4,
        p9MinPBeatNonMid: tight ? 0.46 : 0.43,
        p9MinPBeatMid: tight ? 0.51 : 0.49,
        p9MinPBeatBroken: 0.38,
      });
    }
  }

  const h1Res = await evalTransferHorizon(1, h1Grid);
  const h3Res = await evalTransferHorizon(3, h3Grid);

  // Derive causal H6 policy scaled smoothly from observed H1 -> H3 progression
  const h6Policy: ScoutTransferHorizonPolicy = {
    ftValueBase: round2(Math.max(h3Res.best.ftValueBase + 0.6, h3Res.best.ftValueBase * 1.25)),
    repairFtValue: round2(Math.max(h3Res.best.repairFtValue + 0.25, 1.5)),
    hitSurplusMargin: round2(Math.max(h3Res.best.hitSurplusMargin + 0.9, 3.0)),
    marginalHitMargin: round2(Math.max(h3Res.best.marginalHitMargin + 0.8, 3.0)),
    pStartRelWeight: round2(Math.max(h3Res.best.pStartRelWeight, 0.25)),
    upsideWeight: 0.05,
    minInPStart: 0.48,
    p9MinNetNonMid: round2(Math.max(0.4, h3Res.best.p9MinNetNonMid - 0.2)),
    p9MinNetMid: round2(Math.max(1.0, h3Res.best.p9MinNetMid - 0.2)),
    p9MinNetBroken: 0.3,
    p9MinPBeatNonMid: round2(Math.max(0.40, h3Res.best.p9MinPBeatNonMid - 0.02)),
    p9MinPBeatMid: round2(Math.max(0.46, h3Res.best.p9MinPBeatMid - 0.02)),
    p9MinPBeatBroken: 0.36,
  };

  return {
    version: SCOUT_SELECTION_POLICY_VERSION,
    calibrationGwRange: [evalGws[0], evalGws[evalGws.length - 1]],
    picksFH: bestFhCfg,
    picksWC: bestWcCfg,
    captain: bestCapCfg,
    differential: bestDiffCfg,
    chips: bestChipsCfg,
    transfer: {
      h1: h1Res.best,
      h3: h3Res.best,
      h6: h6Policy,
    },
    walkForwardSummary: {
      fhAvgActualPts: bestFhRawAvg,
      wcAvgActualPtsPerGw: bestWcRawAvg,
      capTop1AvgActualPts: bestCapTop1Avg,
      capTop3AvgActualPts: bestCapTop3Avg,
      diffTop3AvgActualPts: bestDiffTop3Avg,
      transferAvgNetGainH1: h1Res.avgNetGain,
      transferAvgNetGainH3: h3Res.avgNetGain,
      evaluatedGws: evalGws,
    },
  };
}

export function selectBestXiFrom15AtGw(
  squad15Ids: number[],
  players: ScoutModelPlayerInput[],
  gw: number,
  targetNextGW: number,
  policy: ScoutSelectionPolicy = DEFAULT_SCOUT_SELECTION_POLICY,
  playerByIdMap?: Map<number, ScoutModelPlayerInput>
): { starterIds: number[]; benchIds: number[]; formation: string } {
  const byId = playerByIdMap || new Map<number, ScoutModelPlayerInput>(players.map((p) => [p.id, p]));
  const gkps: ScoutModelPlayerInput[] = [];
  const defs: ScoutModelPlayerInput[] = [];
  const mids: ScoutModelPlayerInput[] = [];
  const fwds: ScoutModelPlayerInput[] = [];

  for (const id of squad15Ids) {
    const p = byId.get(id);
    if (!p) continue;
    if (p.position === 'GKP') gkps.push(p);
    else if (p.position === 'DEF') defs.push(p);
    else if (p.position === 'MID') mids.push(p);
    else fwds.push(p);
  }

  const sortFn = (a: ScoutModelPlayerInput, b: ScoutModelPlayerInput) => {
    const ca = getCellAtGw(a, gw, targetNextGW);
    const cb = getCellAtGw(b, gw, targetNextGW);
    if (cb.xp !== ca.xp) return cb.xp - ca.xp;
    const capDiff = scoreCaptainAtGw(b, gw, targetNextGW, policy) - scoreCaptainAtGw(a, gw, targetNextGW, policy);
    if (capDiff !== 0) return capDiff;
    return cb.pStart - ca.pStart;
  };

  gkps.sort(sortFn);
  defs.sort(sortFn);
  mids.sort(sortFn);
  fwds.sort(sortFn);

  let bestStarters: ScoutModelPlayerInput[] = [];
  let bestBench: ScoutModelPlayerInput[] = [];
  let bestForm = '3-4-3';
  let bestXiXp = -1;

  for (const [d, m, f] of FORMATIONS) {
    if (gkps.length < 1 || defs.length < d || mids.length < m || fwds.length < f) continue;
    const st = [gkps[0], ...defs.slice(0, d), ...mids.slice(0, m), ...fwds.slice(0, f)];
    const xp = st.reduce((s, p) => s + getCellAtGw(p, gw, targetNextGW).xp, 0);
    if (xp > bestXiXp + 1e-6) {
      bestXiXp = xp;
      bestForm = `${d}-${m}-${f}`;
      bestStarters = st;
      const stSet = new Set(st.map((p) => p.id));
      bestBench = [
        ...gkps.filter((p) => !stSet.has(p.id)),
        ...[...defs.filter((p) => !stSet.has(p.id)), ...mids.filter((p) => !stSet.has(p.id)), ...fwds.filter((p) => !stSet.has(p.id))].sort(sortFn),
      ];
    }
  }

  if (bestStarters.length === 0) {
    const all = [...gkps, ...defs, ...mids, ...fwds].sort(sortFn);
    bestStarters = all.slice(0, 11);
    bestBench = all.slice(11);
  }

  return {
    starterIds: bestStarters.map((p) => p.id),
    benchIds: bestBench.map((p) => p.id),
    formation: bestForm,
  };
}
