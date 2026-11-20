export interface ScoutNarrativeInput {
  id: number;
  webName: string;
  fullName: string;
  teamShort: string;
  position: string;
  cost: number;
  goals: number;
  assists: number;
  pts?: number;
  xG: number;
  xA: number;
  xGI: number;
  threat: number;
  creativity: number;
  influence?: number;
  bps?: number;
  bonus?: number;
  form: number;
  ppg: number;
  mins: number;
  starts: number;
  yellowCards?: number;
  cleanSheets?: number;
  saves?: number;
  fnbOwn: number;
  xP1?: number;
  captainScore?: number;
  diffScore?: number;
  rating?: number;
  hauls?: number;
  maxGwPoints?: number;
  proven?: {
    isProven?: boolean;
    tier?: string;
  };
  deadBall?: {
    isPrimaryPen?: boolean;
    isSecondaryPen?: boolean;
    isFkTaker?: boolean;
    isCornerTaker?: boolean;
  };
  gwHistory?: Array<{
    round: number;
    points: number;
    goals?: number;
    assists?: number;
    minutes?: number;
    bps?: number;
    bonus?: number;
    cleanSheets?: number;
    goalsConceded?: number;
  }>;
}

export interface MatchProjInput {
  oppShort: string;
  isHome: boolean;
  teamLambda: number;
  oppLambda: number;
  csProb?: number;
  isBlank?: boolean;
  matches?: Array<{
    oppShort: string;
    isHome: boolean;
    teamLambda?: number;
    oppLambda?: number;
    csProb?: number;
  }>;
}

const CLUB_NAME_BY_SHORT: Record<string, string> = {
  ARS: 'Arsenal',
  AVL: 'Aston Villa',
  BOU: 'Bournemouth',
  BRE: 'Brentford',
  BHA: 'Brighton',
  BUR: 'Burnley',
  CHE: 'Chelsea',
  COV: 'Coventry City',
  CRY: 'Crystal Palace',
  EVE: 'Everton',
  FUL: 'Fulham',
  HUL: 'Hull City',
  IPS: 'Ipswich Town',
  LEE: 'Leeds',
  LEI: 'Leicester',
  LIV: 'Liverpool',
  MCI: 'Man City',
  MUN: 'Man Utd',
  NEW: 'Newcastle',
  NFO: "Nott'm Forest",
  SOU: 'Southampton',
  SUN: 'Sunderland',
  TOT: 'Spurs',
  WHU: 'West Ham',
  WOL: 'Wolves',
};

export function resolveClubName(short: string, clubNameMap?: Record<string, string>): string {
  if (!short) return '';
  return clubNameMap?.[short] || CLUB_NAME_BY_SHORT[short] || short;
}

const BIG_SIX_CLUBS = new Set(['ARS', 'CHE', 'LIV', 'MCI', 'MUN', 'TOT']);
const BOTTOM_HALF_CLUBS = new Set(['IPS', 'EVE', 'CRY', 'BRE', 'SUN', 'HUL', 'COV', 'LEE', 'BOU', 'FUL']);

interface PlayerHistoryProfile {
  consecutiveGoals: number;
  consecutiveReturns: number;
  recentBlanks: number;
  last3Goals: number;
  last3Assists: number;
  last3Points: number;
  threeBonusCount: number;
  bonusTotal: number;
  maxPointsInGW: number;
  maxGwRounds: number[];
  cleanSheetsTotal: number;
  cleanSheetsHome: number;
  consecutiveCleanSheets: number;
  defConHits: number;
  isDefOrGkp: boolean;
}

/**
 * Accurately extracts historical streaks and gameweek data with position-aware blank definitions.
 * For DEF and GKP: A blank is strictly conceding goals and failing to score/assist (points <= 2). Keeping a clean sheet is NEVER a blank!
 */
export function extractHistoryProfile(p: ScoutNarrativeInput): PlayerHistoryProfile {
  const isDefOrGkp = p.position === 'DEF' || p.position === 'GKP';
  const hist = [...(p.gwHistory || [])].sort((a, b) => (a.round || 0) - (b.round || 0));
  const hasRawCs = p.cleanSheets !== undefined || (p as any).clean_sheets !== undefined;
  const rawCs = Number(p.cleanSheets ?? (p as any).clean_sheets ?? 0);
  const goalPtsUnit = isDefOrGkp ? 6 : p.position === 'MID' ? 5 : 4;

  // Accurate per-round Clean Sheet detection for DEF/GKP (accounts for bonus & +2 DefCon points)
  const isRoundCs = (r: any): boolean => {
    if (!isDefOrGkp) return false;
    if ((r.cleanSheets || 0) > 0) return true;
    const mins = r.minutes || 0;
    if (mins < 60) return false;
    if (r.goalsConceded !== undefined) return r.goalsConceded === 0;
    const pts = r.points || 0;
    const g = r.goals || 0;
    const a = r.assists || 0;
    const bon = r.bonus || 0;
    const baseRem = pts - g * goalPtsUnit - a * 3 - bon;
    // Standard 2 appearance + 4 CS = 6 (+2 DefCon = 8). If 5 with no G/A/bon, 2 + 4 CS - 1 YC = 5.
    // Note: baseRem === 4 (e.g. Vuskovic GW3: 12 - 6(G) - 2(bon) = 4) is 2 app + 2 DefCon (NO CS!).
    if (baseRem >= 6) return true;
    if (baseRem === 5 && g === 0 && a === 0 && bon === 0) return true;
    return false;
  };

  const histCsCount = hist.filter(isRoundCs).length;
  // Trust official FPL cleanSheets count whenever provided; never inflate it upward from heuristics
  const cleanSheetsTotal = hasRawCs ? rawCs : histCsCount;

  // Accurate per-round +2 DefCon threshold detection
  let defConHits = 0;
  for (const r of hist) {
    const rawDc = (r as any).defensive_contribution ?? (r as any).defensiveContribution;
    if (typeof rawDc === 'number') {
      const thresh = isDefOrGkp ? 10 : 12;
      if (p.position !== 'GKP' && rawDc >= thresh) defConHits++;
      continue;
    }
    const mins = r.minutes || 0;
    if (mins < 60 || p.position === 'GKP') continue;
    const pts = r.points || 0;
    const g = r.goals || 0;
    const a = r.assists || 0;
    const bon = r.bonus || 0;
    const baseAfterApp = pts - 2 - g * goalPtsUnit - a * 3 - bon;
    if (p.position === 'DEF') {
      // 2 = +2 DefCon (conceded 1), 6 = +4 CS + 2 DefCon
      if (baseAfterApp === 2 || baseAfterApp === 6) defConHits++;
    } else if (p.position === 'MID') {
      // 2 = +2 DefCon (no CS), 3 = +1 CS + 2 DefCon
      if (baseAfterApp === 2 || baseAfterApp === 3) defConHits++;
    }
  }

  let consecutiveCleanSheets = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (isRoundCs(hist[i])) consecutiveCleanSheets++;
    else break;
  }

  let consecutiveGoals = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if ((hist[i].goals || 0) > 0) consecutiveGoals++;
    else break;
  }

  let consecutiveReturns = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if ((hist[i].goals || 0) > 0 || (hist[i].assists || 0) > 0) consecutiveReturns++;
    else break;
  }

  let recentBlanks = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const r = hist[i];
    let isBlank = false;
    if (isDefOrGkp) {
      // DEF/GKP blank = conceded goals and no attacking returns (points <= 2)
      const hasCs = isRoundCs(r);
      const hasAttReturn = (r.goals || 0) > 0 || (r.assists || 0) > 0;
      isBlank = !hasCs && !hasAttReturn && (r.points || 0) <= 2;
    } else {
      // FWD/MID blank = no goals and no assists (points <= 2)
      isBlank = (r.goals || 0) === 0 && (r.assists || 0) === 0 && (r.points || 0) <= 2;
    }
    if (isBlank) recentBlanks++;
    else break;
  }

  const last3 = hist.slice(-3);
  const last3Goals = last3.reduce((acc, r) => acc + (r.goals || 0), 0);
  const last3Assists = last3.reduce((acc, r) => acc + (r.assists || 0), 0);
  const last3Points = last3.reduce((acc, r) => acc + (r.points || 0), 0);
  const threeBonusCount = hist.filter((r) => (r.bonus || 0) === 3).length;
  const histBonusSum = hist.reduce((acc, r) => acc + (r.bonus || 0), 0);
  const bonusTotal = Number(p.bonus ?? histBonusSum);
  const maxPointsInGW = Math.max(...hist.map((r) => r.points || 0), Number(p.maxGwPoints || 0), 0);
  const maxGwRounds = maxPointsInGW > 0
    ? hist.filter((r) => (r.points || 0) === maxPointsInGW && (r.round || 0) > 0).map((r) => r.round)
    : [];

  return {
    consecutiveGoals,
    consecutiveReturns,
    recentBlanks,
    last3Goals,
    last3Assists,
    last3Points,
    threeBonusCount,
    bonusTotal,
    maxPointsInGW,
    maxGwRounds,
    cleanSheetsTotal,
    cleanSheetsHome: Math.round(cleanSheetsTotal * 0.6),
    consecutiveCleanSheets,
    defConHits,
    isDefOrGkp
  };
}

export interface PlayerLeagueRanks {
  // Per 90' ranks
  xG90Rank: number;
  xA90Rank: number;
  xGI90Rank: number;
  threat90Rank: number;
  creat90Rank: number;
  inf90Rank: number;
  bps90Rank: number;
  pts90Rank: number;
  defThreat90Rank: number;
  // Per GW peak rank
  maxGwPtsRank: number;
  // Per n GW (3-GW / Form) ranks
  last3PtsRank: number;
  last3GoalsRank: number;
  last3AssistsRank: number;
  formRank: number;
  // Season total ranks
  ptsRank: number;
  goalsRank: number;
  assistsRank: number;
  xGRank: number;
  xARank: number;
  xGIRank: number;
  threatRank: number;
  creatRank: number;
  infRank: number;
  bpsRank: number;
  bonusRank: number;
  haulsRank: number;
  csRank: number;
  defConRank: number;
  cohortSize: number;
  defCohortSize: number;
}

/**
 * Ranks all active players across the entire league for 4 statistical horizons:
 * Per 90', Per GW (peak), Per n GW (last 3 GWs / form), and Full Season totals.
 */
export function buildLeagueStatRankMap(players: ScoutNarrativeInput[]): Map<number, PlayerLeagueRanks> {
  const rankMap = new Map<number, PlayerLeagueRanks>();
  if (!players || players.length === 0) return rankMap;

  const maxLeagueMins = Math.max(...players.map((p) => Number(p.mins ?? (p as any).minutes ?? 0)), 90);
  const minCohortMins = Math.max(90, Math.round(maxLeagueMins * 0.25));

  const cohort = players
    .filter((p) => Number(p.mins ?? (p as any).minutes ?? 0) >= minCohortMins)
    .map((p) => {
      const h = extractHistoryProfile(p);
      const mins = Math.max(1, Number(p.mins ?? (p as any).minutes ?? 1));
      const n90 = Math.max(1, mins / 90);
      const g = Number(p.goals ?? (p as any).goalsScored ?? 0);
      const a = Number(p.assists ?? 0);
      const pts = Number(p.pts ?? (p as any).totalPoints ?? 0);
      const xG = Number(p.xG ?? (p as any).expectedGoals ?? 0);
      const xA = Number(p.xA ?? (p as any).expectedAssists ?? 0);
      const xGI = Number(p.xGI ?? (xG + xA));
      const threat = Number(p.threat ?? 0);
      const creat = Number(p.creativity ?? 0);
      const inf = Number(p.influence ?? 0);
      const bps = Number(p.bps ?? 0);
      const form = Number(p.form ?? 0);
      const hauls = Number(p.hauls ?? (p as any).doubleDigitHauls ?? 0);
      const isDef = p.position === 'DEF' || p.position === 'GKP';

      return {
        id: p.id,
        isDef,
        xG90: xG / n90,
        xA90: xA / n90,
        xGI90: xGI / n90,
        threat90: threat / n90,
        creat90: creat / n90,
        inf90: inf / n90,
        bps90: bps / n90,
        pts90: pts / n90,
        maxGwPts: h.maxPointsInGW,
        last3Pts: h.last3Points,
        last3Goals: h.last3Goals,
        last3Assists: h.last3Assists,
        form,
        pts,
        g,
        a,
        xG,
        xA,
        xGI,
        threat,
        creat,
        inf,
        bps,
        bonus: h.bonusTotal,
        hauls,
        cs: h.cleanSheetsTotal,
        defConHits: h.defConHits,
      };
    });

  if (cohort.length === 0) return rankMap;
  const defCohort = cohort.filter((c) => c.isDef);

  const computeRanks = <T extends { id: number }>(items: T[], val: (item: T) => number): Map<number, number> => {
    const sorted = [...items].sort((a, b) => val(b) - val(a));
    const out = new Map<number, number>();
    let prevVal = Infinity;
    let prevRank = 1;
    sorted.forEach((item, i) => {
      const v = val(item);
      const r = v === prevVal ? prevRank : i + 1;
      prevVal = v;
      prevRank = r;
      out.set(item.id, r);
    });
    return out;
  };

  const rXg90 = computeRanks(cohort, (c) => c.xG90);
  const rXa90 = computeRanks(cohort, (c) => c.xA90);
  const rXgi90 = computeRanks(cohort, (c) => c.xGI90);
  const rThreat90 = computeRanks(cohort, (c) => c.threat90);
  const rCreat90 = computeRanks(cohort, (c) => c.creat90);
  const rInf90 = computeRanks(cohort, (c) => c.inf90);
  const rBps90 = computeRanks(cohort, (c) => c.bps90);
  const rPts90 = computeRanks(cohort, (c) => c.pts90);
  const rDefThreat90 = computeRanks(defCohort, (c) => c.threat90);

  const rMaxGwPts = computeRanks(cohort, (c) => c.maxGwPts);
  const rLast3Pts = computeRanks(cohort, (c) => c.last3Pts);
  const rLast3Goals = computeRanks(cohort, (c) => c.last3Goals);
  const rLast3Assists = computeRanks(cohort, (c) => c.last3Assists);
  const rForm = computeRanks(cohort, (c) => c.form);

  const rPts = computeRanks(cohort, (c) => c.pts);
  const rGoals = computeRanks(cohort, (c) => c.g);
  const rAssists = computeRanks(cohort, (c) => c.a);
  const rXg = computeRanks(cohort, (c) => c.xG);
  const rXa = computeRanks(cohort, (c) => c.xA);
  const rXgi = computeRanks(cohort, (c) => c.xGI);
  const rThreat = computeRanks(cohort, (c) => c.threat);
  const rCreat = computeRanks(cohort, (c) => c.creat);
  const rInf = computeRanks(cohort, (c) => c.inf);
  const rBps = computeRanks(cohort, (c) => c.bps);
  const rBonus = computeRanks(cohort, (c) => c.bonus);
  const rHauls = computeRanks(cohort, (c) => c.hauls);
  const rCs = computeRanks(defCohort, (c) => c.cs);
  const rDefCon = computeRanks(cohort, (c) => c.defConHits);

  const fallback = cohort.length + 1;
  const defFallback = defCohort.length + 1;

  for (const c of cohort) {
    rankMap.set(c.id, {
      xG90Rank: rXg90.get(c.id) ?? fallback,
      xA90Rank: rXa90.get(c.id) ?? fallback,
      xGI90Rank: rXgi90.get(c.id) ?? fallback,
      threat90Rank: rThreat90.get(c.id) ?? fallback,
      creat90Rank: rCreat90.get(c.id) ?? fallback,
      inf90Rank: rInf90.get(c.id) ?? fallback,
      bps90Rank: rBps90.get(c.id) ?? fallback,
      pts90Rank: rPts90.get(c.id) ?? fallback,
      defThreat90Rank: rDefThreat90.get(c.id) ?? defFallback,
      maxGwPtsRank: rMaxGwPts.get(c.id) ?? fallback,
      last3PtsRank: rLast3Pts.get(c.id) ?? fallback,
      last3GoalsRank: rLast3Goals.get(c.id) ?? fallback,
      last3AssistsRank: rLast3Assists.get(c.id) ?? fallback,
      formRank: rForm.get(c.id) ?? fallback,
      ptsRank: rPts.get(c.id) ?? fallback,
      goalsRank: rGoals.get(c.id) ?? fallback,
      assistsRank: rAssists.get(c.id) ?? fallback,
      xGRank: rXg.get(c.id) ?? fallback,
      xARank: rXa.get(c.id) ?? fallback,
      xGIRank: rXgi.get(c.id) ?? fallback,
      threatRank: rThreat.get(c.id) ?? fallback,
      creatRank: rCreat.get(c.id) ?? fallback,
      infRank: rInf.get(c.id) ?? fallback,
      bpsRank: rBps.get(c.id) ?? fallback,
      bonusRank: rBonus.get(c.id) ?? fallback,
      haulsRank: rHauls.get(c.id) ?? fallback,
      csRank: rCs.get(c.id) ?? defFallback,
      defConRank: rDefCon.get(c.id) ?? fallback,
      cohortSize: cohort.length,
      defCohortSize: defCohort.length,
    });
  }

  return rankMap;
}

type TraitType =
  | 'SCORING_STREAK'
  | 'RETURN_STREAK'
  | 'CLINICAL_FINISHER'
  | 'OVERDUE_HAUL'
  | 'DEFCON_GUARDIAN'
  | 'AERIAL_SET_PIECE'
  | 'CREATIVE_ORCHESTRATOR'
  | 'BOX_MONSTER'
  | 'BONUS_MAGNET'
  | 'BALANCED_ATTACKER'
  | 'HIGH_CEILING_HAUL'
  | 'CONSISTENT_FLOOR'
  | 'SET_PIECE_SPECIALIST'
  | 'MINUTES_TALISMAN'
  | 'STEADY_SCORER';

type CaveatType =
  | 'YELLOW_CARD_RISK'
  | 'EARLY_SUB_RISK'
  | 'GOAL_RELIANT_NARROW'
  | 'RECENT_COLD_BLANKS'
  | 'FINISHING_SCRUTINY';

interface AnalyzedPlayerProfile {
  g: number;
  a: number;
  pts: number;
  xG: number;
  xA: number;
  xGI: number;
  xG90: number;
  xA90: number;
  xGI90: number;
  threat: number;
  threat90: number;
  creat: number;
  creat90: number;
  inf: number;
  inf90: number;
  bps: number;
  bps90: number;
  bonusTotal: number;
  defConHits: number;
  form: number;
  minsPerStart: number;
  yc: number;
  hauls: number;
  cleanSheetsTotal: number;
  isPrimaryPen: boolean;
  isCornerOrFk: boolean;
  isDef: boolean;
  primaryTrait: TraitType;
  secondaryTrait: TraitType;
  caveat: CaveatType | null;
  ranks?: PlayerLeagueRanks;
}

const TRAIT_GROUP: Record<TraitType, string> = {
  SCORING_STREAK: 'GOAL_STREAK',
  RETURN_STREAK: 'GOAL_STREAK',
  STEADY_SCORER: 'GOAL_OUTPUT',
  CLINICAL_FINISHER: 'FINISHING',
  OVERDUE_HAUL: 'FINISHING',
  CREATIVE_ORCHESTRATOR: 'CREATION',
  BALANCED_ATTACKER: 'CREATION',
  DEFCON_GUARDIAN: 'DEFCON',
  AERIAL_SET_PIECE: 'AERIAL',
  BOX_MONSTER: 'SHOT_VOLUME',
  BONUS_MAGNET: 'BONUS',
  HIGH_CEILING_HAUL: 'HAUL_CEILING',
  CONSISTENT_FLOOR: 'FORM_FLOOR',
  SET_PIECE_SPECIALIST: 'SET_PIECE',
  MINUTES_TALISMAN: 'MINUTES',
};

function areTraitsCompatible(t1: TraitType, t2: TraitType): boolean {
  if (t1 === t2) return false;
  if (TRAIT_GROUP[t1] === TRAIT_GROUP[t2]) return false;
  // Never pair streak/scoring with generic goal output or finishing if both just repeat goals
  const goalCluster = new Set<TraitType>(['SCORING_STREAK', 'RETURN_STREAK', 'STEADY_SCORER']);
  if (goalCluster.has(t1) && goalCluster.has(t2)) return false;
  if ((t1 === 'CLINICAL_FINISHER' && t2 === 'STEADY_SCORER') || (t2 === 'CLINICAL_FINISHER' && t1 === 'STEADY_SCORER')) {
    return false;
  }
  if ((t1 === 'OVERDUE_HAUL' && t2 === 'STEADY_SCORER') || (t2 === 'OVERDUE_HAUL' && t1 === 'STEADY_SCORER')) {
    return false;
  }
  return true;
}

function analyzePlayerTraits(
  p: ScoutNarrativeInput,
  hist: PlayerHistoryProfile,
  usedTraitCounts?: Map<TraitType, number>,
  ranks?: PlayerLeagueRanks
): AnalyzedPlayerProfile {
  const g = Number(p.goals ?? (p as any).goalsScored ?? 0);
  const a = Number(p.assists ?? 0);
  const pts = Number(p.pts ?? (p as any).totalPoints ?? 0);
  const xG = Number(p.xG ?? (p as any).expectedGoals ?? 0);
  const xA = Number(p.xA ?? (p as any).expectedAssists ?? 0);
  const xGI = Number(p.xGI ?? (xG + xA));
  const threat = Number(p.threat ?? 0);
  const creat = Number(p.creativity ?? 0);
  const inf = Number(p.influence ?? 0);
  const bps = Number(p.bps ?? 0);
  const bonusTotal = hist.bonusTotal;
  const defConHits = hist.defConHits;
  const form = Number(p.form ?? 0);
  const mins = Math.max(1, Number(p.mins ?? (p as any).minutes ?? 1));
  const n90 = Math.max(1, mins / 90);
  const xG90 = xG / n90;
  const xA90 = xA / n90;
  const xGI90 = xGI / n90;
  const threat90 = threat / n90;
  const creat90 = creat / n90;
  const inf90 = inf / n90;
  const bps90 = bps / n90;
  const starts = Number(p.starts ?? (mins > 0 ? Math.ceil(mins / 80) : 0));
  const minsPerStart = starts > 0 ? Math.round(mins / starts) : 75;
  const yc = Number(p.yellowCards ?? 0);
  const hauls = Number(p.hauls ?? (p as any).doubleDigitHauls ?? 0);
  const cleanSheetsTotal = hist.cleanSheetsTotal;
  const isPrimaryPen = !!p.deadBall?.isPrimaryPen;
  const isCornerOrFk = !!(p.deadBall?.isCornerTaker || p.deadBall?.isFkTaker);
  const isDef = p.position === 'DEF' || p.position === 'GKP';

  // Helper: determine true league-wide top-tier status across per-90', peak GW, 3-GW form, and season totals
  const hasRank = !!ranks && ranks.cohortSize >= 20;
  const topN = (r: number | undefined, limit: number, fallbackCond: boolean) =>
    hasRank && r !== undefined ? r <= limit : fallbackCond;

  const scoredTraits: Array<{ trait: TraitType; priority: number }> = [];

  const hasScoringStreak = hist.consecutiveGoals >= 2 || hist.last3Goals >= 3 || (hasRank && (ranks?.last3GoalsRank ?? 999) <= 10 && hist.last3Goals >= 2);
  if (hasScoringStreak) {
    scoredTraits.push({ trait: 'SCORING_STREAK', priority: 102 + hist.consecutiveGoals * 10 });
  }
  // Only push RETURN_STREAK if they don't already have an identical pure-goal streak
  if (hist.consecutiveReturns >= 2 && (!hasScoringStreak || hist.consecutiveReturns > hist.consecutiveGoals + 1)) {
    scoredTraits.push({ trait: 'RETURN_STREAK', priority: 88 + hist.consecutiveReturns * 7 });
  }
  if (g >= xG + 1.1 && g >= 3 && topN(ranks?.goalsRank, 35, (g / n90) >= 0.32)) {
    scoredTraits.push({ trait: 'CLINICAL_FINISHER', priority: 92 + (topN(ranks?.goalsRank, 10, false) ? 3 : 0) });
  }
  if (xG >= g + 1.2 && (topN(ranks?.xG90Rank, 20, xG90 >= 0.35) || topN(ranks?.xGRank, 20, xG >= 3.0))) {
    scoredTraits.push({ trait: 'OVERDUE_HAUL', priority: 89 });
  }
  if (isDef && (topN(ranks?.csRank, 15, cleanSheetsTotal >= 3) || topN(ranks?.defConRank, 15, defConHits >= 2) || topN(ranks?.inf90Rank, 25, inf90 >= 22))) {
    scoredTraits.push({ trait: 'DEFCON_GUARDIAN', priority: (topN(ranks?.csRank, 8, cleanSheetsTotal >= 6) || defConHits >= 4) ? 96 : 93 });
  } else if (!isDef && defConHits >= 4 && topN(ranks?.defConRank, 15, inf90 >= 25)) {
    scoredTraits.push({ trait: 'DEFCON_GUARDIAN', priority: 85 });
  }
  if (isDef && (hasRank && ranks ? ranks.defThreat90Rank <= 15 : threat90 >= 11 && threat >= 90)) {
    scoredTraits.push({ trait: 'AERIAL_SET_PIECE', priority: 90 });
  }

  // Creativity: either genuinely elite xA/creativity rank OR high assist overperformance vs low xA!
  const isAssistOverperformer = a >= 3 && a >= xA + 1.0 && topN(ranks?.assistsRank, 25, true);
  const isEliteCreator = (topN(ranks?.xA90Rank, 18, xA90 >= 0.22 && xA >= 2.2) || topN(ranks?.creat90Rank, 15, creat90 >= 28)) && (a >= 2 || xA >= 1.5);
  if (isAssistOverperformer || isEliteCreator) {
    scoredTraits.push({ trait: 'CREATIVE_ORCHESTRATOR', priority: topN(ranks?.assistsRank, 8, a >= 4) ? 90 : 87 });
  }

  if (!isDef && (topN(ranks?.threat90Rank, 20, threat90 >= 27) || topN(ranks?.threatRank, 20, threat >= 200))) {
    scoredTraits.push({ trait: 'BOX_MONSTER', priority: 88 });
  }
  if ((hauls >= 2 || hist.maxPointsInGW >= 11) && (topN(ranks?.haulsRank, 25, hauls >= 2) || topN(ranks?.maxGwPtsRank, 25, hist.maxPointsInGW >= 11))) {
    scoredTraits.push({ trait: 'HIGH_CEILING_HAUL', priority: 85 + Math.min(10, hauls * 2) });
  }
  if (hist.threeBonusCount >= 3 || topN(ranks?.bonusRank, 12, bonusTotal >= 10) || topN(ranks?.bpsRank, 12, bps >= 245)) {
    const bonusPriority = (topN(ranks?.bpsRank, 6, bps >= 280) || topN(ranks?.bonusRank, 6, bonusTotal >= 14) || hist.threeBonusCount >= 4)
      ? 91
      : 86;
    scoredTraits.push({ trait: 'BONUS_MAGNET', priority: bonusPriority });
  }
  if (hist.recentBlanks === 0 && topN(ranks?.last3PtsRank, 25, hist.last3Points >= 14)) {
    scoredTraits.push({ trait: 'CONSISTENT_FLOOR', priority: 82 });
  }
  if (((g >= 3 && a >= 2) || (g >= 2 && a >= 3)) && topN(ranks?.goalsRank, 40, true) && topN(ranks?.assistsRank, 40, true)) {
    scoredTraits.push({ trait: 'BALANCED_ATTACKER', priority: 81 });
  }
  if (isCornerOrFk && !isDef) {
    scoredTraits.push({ trait: 'SET_PIECE_SPECIALIST', priority: 80 });
  }
  if (minsPerStart >= 83) {
    scoredTraits.push({ trait: 'MINUTES_TALISMAN', priority: 76 });
  }
  if (g >= 3 || topN(ranks?.xGI90Rank, 30, xGI90 >= 0.35)) {
    scoredTraits.push({ trait: 'STEADY_SCORER', priority: 72 });
  }

  // Apply gentle article-wide saturation adjustment so shared traits don't starve other genuine traits
  scoredTraits.sort((a, b) => {
    const penA = (usedTraitCounts?.get(a.trait) || 0) * 6;
    const penB = (usedTraitCounts?.get(b.trait) || 0) * 6;
    return (b.priority - penB) - (a.priority - penA);
  });

  const primaryTrait = scoredTraits[0]?.trait || (isDef ? 'DEFCON_GUARDIAN' : 'STEADY_SCORER');

  // Pick a genuinely distinct, non-overlapping secondary trait
  const compatibleCandidate = scoredTraits.find((t, idx) => idx > 0 && areTraitsCompatible(primaryTrait, t.trait));

  let secondaryTrait: TraitType | undefined = compatibleCandidate?.trait;
  if (!secondaryTrait) {
    const fallbackOrder: TraitType[] = isDef
      ? ['BONUS_MAGNET', 'MINUTES_TALISMAN', 'CONSISTENT_FLOOR', 'AERIAL_SET_PIECE', 'DEFCON_GUARDIAN']
      : ['BONUS_MAGNET', 'CONSISTENT_FLOOR', 'MINUTES_TALISMAN', 'HIGH_CEILING_HAUL', 'CREATIVE_ORCHESTRATOR', 'BOX_MONSTER', 'STEADY_SCORER'];
    secondaryTrait = fallbackOrder.find((ft) => areTraitsCompatible(primaryTrait, ft)) || 'MINUTES_TALISMAN';
  }

  // Real caveat detection
  let caveat: CaveatType | null = null;
  if (yc >= 3) {
    caveat = 'YELLOW_CARD_RISK';
  } else if (!isDef && a === 0 && creat90 < 10 && g >= 3) {
    caveat = 'GOAL_RELIANT_NARROW';
  } else if (minsPerStart < 74 && starts >= 3) {
    caveat = 'EARLY_SUB_RISK';
  } else if (hist.recentBlanks >= 2) {
    caveat = 'RECENT_COLD_BLANKS';
  } else if (!isDef && g === 0 && xG >= 1.5) {
    caveat = 'FINISHING_SCRUTINY';
  }

  return {
    g,
    a,
    pts,
    xG,
    xA,
    xGI,
    xG90,
    xA90,
    xGI90,
    threat,
    threat90,
    creat,
    creat90,
    inf,
    inf90,
    bps,
    bps90,
    bonusTotal,
    defConHits,
    form,
    minsPerStart,
    yc,
    hauls,
    cleanSheetsTotal,
    isPrimaryPen,
    isCornerOrFk,
    isDef,
    primaryTrait,
    secondaryTrait,
    caveat,
    ranks
  };
}

/**
 * Produces varied editorial phrasings for any trait.
 * Every returned string is a clean verbal predicate (starts with verb/adjective that follows "ia ...")
 * so it flows grammatically inside any editorial sentence template!
 */
function renderTraitPhrasing(
  trait: TraitType,
  profile: AnalyzedPlayerProfile,
  hist: PlayerHistoryProfile,
  variantIdx: number,
  isId: boolean
): string {
  const { g, a, pts, xG, xA, xG90, xA90, xGI90, threat, threat90, creat, creat90, inf, bps, bps90, bonusTotal, defConHits, hauls, ranks } = profile;
  const mod = variantIdx % 3;
  const mod4 = variantIdx % 4;
  const hasLeagueRanks = !!ranks && ranks.cohortSize >= 20;
  const formatPeakList = (rounds: number[]) => {
    const list = rounds.length > 4 ? rounds.slice(-3) : rounds;
    if (list.length === 1) return `GW${list[0]}`;
    if (list.length === 2) return `GW${list[0]} & GW${list[1]}`;
    return `${list.slice(0, -1).map((n) => `GW${n}`).join(', ')} & GW${list[list.length - 1]}`;
  };
  const formatPeakGwId = () => (hist.maxGwRounds.length > 0 ? `di ${formatPeakList(hist.maxGwRounds)}` : `dalam satu gameweek`);
  const formatPeakGwEn = () => (hist.maxGwRounds.length > 0 ? `in ${formatPeakList(hist.maxGwRounds)}` : `in a single gameweek`);
  const assistVsXaContrast = a >= 3 && a >= xA + 1.0;

  if (isId) {
    switch (trait) {
      case 'SCORING_STREAK':
        if (hist.consecutiveGoals >= 2) {
          if (mod4 === 0) return `sedang tajam setelah selalu mencetak gol dalam ${hist.consecutiveGoals} pertandingan beruntun`;
          if (mod4 === 1) return `menjaga ketajaman mematikan lewat rentetan gol di ${hist.consecutiveGoals} pekan berturut-turut`;
          if (mod4 === 2) return `tengah panas usai merobek jala lawan pada ${hist.consecutiveGoals} laga terakhir tanpa putus`;
          return `berada dalam tren subur berkat catatan gol di ${hist.consecutiveGoals} gameweek pamungkas`;
        }
        if (mod4 === 0) return `sulit dibendung di area penalti lawan usai memborong ${hist.last3Goals} gol dalam 3 laga pamungkas`;
        if (mod4 === 1) return `tampil eksplosif dengan koleksi ${hist.last3Goals} gol hanya dari 3 pertandingan terakhir`;
        if (mod4 === 2) return `membuktikan insting predatornya lewat torehan ${hist.last3Goals} gol dalam 3 pekan terkini`;
        return `mencuri sorotan lewat produktivitas ${hist.last3Goals} gol sepanjang 3 pekan terakhir`;

      case 'RETURN_STREAK':
        if (mod === 0) return `konsisten menyumbang poin lewat gol atau assist dalam ${hist.consecutiveReturns} pertandingan terakhir`;
        if (mod === 1) return `selalu menghadirkan kontribusi attacking return di ${hist.consecutiveReturns} pekan beruntun`;
        return `mempertahankan rantai kontribusi gol dan assist tanpa henti dalam ${hist.consecutiveReturns} laga terakhir`;

      case 'CLINICAL_FINISHER': {
        const gRankParen = hasLeagueRanks && ranks && ranks.goalsRank <= 10 ? ` (#${ranks.goalsRank})` : '';
        if (mod === 0) return `memiliki efisiensi konversi mematikan dengan melesakkan ${g} gol${gRankParen} dari hanya ${xG.toFixed(1)} total xG`;
        if (mod === 1) return `berada di level penyelesaian akhir klinis usai mencetak ${g} gol${gRankParen} dari total ${xG.toFixed(1)} xG`;
        return `sangat efektif memanfaatkan peluang sempit hingga mengemas ${g} gol${gRankParen} berbanding ${xG.toFixed(1)} total xG`;
      }

      case 'OVERDUE_HAUL': {
        const xgRankInline = hasLeagueRanks && ranks && ranks.xG90Rank <= 10 ? `, #${ranks.xG90Rank}` : '';
        if (mod === 0) return `mengoleksi total ${xG.toFixed(1)} xG (${xG90.toFixed(2)}/90${xgRankInline}) berbanding ${g} gol riil yang menjadi sinyal kuat panen poin`;
        if (mod === 1) return `mencatatkan rata-rata ${xG90.toFixed(2)} xG/90${xgRankInline ? ` (${xgRankInline.slice(2)})` : ''} dengan total ${xG.toFixed(1)} xG vs ${g} gol, indikasi kuat siap meledak`;
        return `termasuk pemain paling aktif mengancam lewat total ${xG.toFixed(1)} xG (${xG90.toFixed(2)}/90${xgRankInline}) yang tinggal menunggu waktu terbayar lunas`;
      }

      case 'DEFCON_GUARDIAN': {
        const csNum = profile.cleanSheetsTotal || hist.cleanSheetsTotal;
        const csRankParen = hasLeagueRanks && ranks && ranks.csRank <= 10 ? ` (#${ranks.csRank})` : '';
        const dcRankInline = hasLeagueRanks && ranks && ranks.defConRank <= 10 ? `, #${ranks.defConRank}` : '';
        if (csNum > 0 && defConHits >= 3) {
          if (mod === 0) return `mengawal lini belakang dengan koleksi ${csNum} clean sheet${csRankParen} serta ${defConHits} kali bonus +2 DefCon`;
          if (mod === 1) return `memadukan ${csNum} clean sheet${csRankParen} dengan status DefCon magnet (${defConHits} kali bonus +2 DefCon${dcRankInline})`;
          return `sukses menjaga ${csNum} clean sheet${csRankParen} dan sudah ${defConHits} kali mengamankan poin tambahan DefCon`;
        }
        if (csNum > 0) {
          if (mod === 0) return `mengawal lini belakang dengan koleksi ${csNum} clean sheet${csRankParen} dan kontribusi bertahan yang solid`;
          if (mod === 1) return `menjadi palang pintu tangguh bermodal ${csNum} clean sheet${csRankParen} serta dominasi duel pertahanan (total Influence ${Math.round(inf)})`;
          return `sukses mengunci ${csNum} clean sheet${csRankParen} berkat ketangguhan tekel, sapuan, dan intersep krusial`;
        }
        if (defConHits >= 3) {
          return `berstatus DefCon magnet dengan ${defConHits} kali menembus bonus +2 DefCon${dcRankInline ? ` (${dcRankInline.slice(2)})` : ''} (total Influence ${Math.round(inf)})`;
        }
        if (mod === 0) return `menjadi benteng utama pertahanan lewat dominasi tekel, sapuan, dan blok (total Influence ${Math.round(inf)})`;
        if (mod === 1) return `aktif memenangi duel bertahan di kotak penalti dengan total Influence ${Math.round(inf)}`;
        return `memberikan proteksi kokoh lewat aksi bertahan (total Influence ${Math.round(inf)}) yang stabil`;
      }

      case 'AERIAL_SET_PIECE': {
        const dtRankInline = hasLeagueRanks && ranks && ranks.defThreat90Rank <= 10 ? `, #${ranks.defThreat90Rank} bek` : '';
        if (mod === 0) return `menghadirkan ancaman duel udara berbahaya (${threat90.toFixed(1)} Threat/90${dtRankInline}) dalam setiap situasi set-piece`;
        if (mod === 1) return `kerap menjadi target utama umpan corner dan free-kick untuk mencuri gol sundulan`;
        return `memadukan ketangguhan bertahan dengan insting gol sundulan (${threat90.toFixed(1)} Threat/90${dtRankInline}) yang merepotkan bek lawan`;
      }

      case 'CREATIVE_ORCHESTRATOR': {
        const rankTag = hasLeagueRanks && ranks && ranks.assistsRank <= 10 ? ` (#${ranks.assistsRank})` : '';
        const creatRankInline = hasLeagueRanks && ranks && ranks.creat90Rank <= 10 ? `, #${ranks.creat90Rank}` : '';
        const creatRankParen = hasLeagueRanks && ranks && ranks.creat90Rank <= 10 ? ` (#${ranks.creat90Rank})` : '';
        if (assistVsXaContrast) {
          if (mod === 0) return `efektif menyulap peluang menjadi ${a} assist${rankTag} meski hanya mencatatkan total ${xA.toFixed(1)} xA`;
          if (mod === 1) return `memimpin kreativitas serangan (${creat90.toFixed(1)} Creativity/90${creatRankInline}) dengan ${a} assist walau total xA-nya baru ${xA.toFixed(1)}`;
          return `tajam mengeksekusi umpan kunci hingga membuahkan ${a} assist${rankTag} meski total xA-nya hanya ${xA.toFixed(1)}`;
        }
        if (a >= 2) {
          if (mod === 0) return `memimpin kreativitas serangan lewat visi umpan kelas satu (${creat90.toFixed(1)} Creativity/90${creatRankInline}) yang membuahkan ${a} assist`;
          if (mod === 1) return `menjadi motor kreasi peluang tim dengan ${a} assist${rankTag} dan total ${xA.toFixed(1)} xA (${xA90.toFixed(2)}/90)`;
          return `rutin membongkar pertahanan rapat melalui ${a} assist${rankTag} (${xA90.toFixed(2)} xA/90)`;
        }
        if (mod === 0) return `menebar umpan-umpan matang dengan rata-rata ${xA90.toFixed(2)} xA/90 (total ${xA.toFixed(1)} xA)`;
        if (mod === 1) return `rajin menciptakan peluang bersih bagi rekan setim (total ${xA.toFixed(1)} xA dan ${creat90.toFixed(1)} Creativity/90${creatRankInline})`;
        return `beroperasi sebagai playmaker utama tim dengan catatan ${creat90.toFixed(1)} Creativity/90${creatRankParen}`;
      }

      case 'BOX_MONSTER': {
        const thRankInline = hasLeagueRanks && ranks && ranks.threat90Rank <= 10 ? `, #${ranks.threat90Rank}` : '';
        if (mod === 0) return `meneror lini pertahanan lewat intensitas tembakan masif di kotak penalti (${threat90.toFixed(1)} Threat/90${thRankInline})`;
        if (mod === 1) return `senantiasa menemukan ruang tembak ideal dengan total ${Math.round(threat)} Threat (${threat90.toFixed(1)}/90${thRankInline})`;
        return `agresif menggempur kotak penalti lawan dengan rata-rata ${threat90.toFixed(1)} Threat/90${thRankInline ? ` (${thRankInline.slice(2)})` : ''}`;
      }

      case 'HIGH_CEILING_HAUL': {
        const peakGw = formatPeakGwId();
        const peakRankInline = hasLeagueRanks && ranks && ranks.maxGwPtsRank <= 10 ? `, #${ranks.maxGwPtsRank}` : '';
        if (hauls >= 2) {
          if (mod === 0) return `sudah ${hauls} kali membukukan double-digit haul (tertinggi ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline})`;
          if (mod === 1) return `terbukti punya ceiling poin tinggi setelah ${hauls} kali menembus 10+ poin (puncak ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline})`;
          return `memiliki rekam jejak meledak hingga ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline ? ` (${peakRankInline.slice(2)})` : ''} dengan total ${hauls} kali haul besar`;
        }
        if (mod === 0) return `pernah mencatatkan ledakan ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline ? ` (${peakRankInline.slice(2)})` : ''}`;
        if (mod === 1) return `menyimpan potensi haul puncak setelah mendulang ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline ? ` (${peakRankInline.slice(2)})` : ''}`;
        return `terbukti mampu mendongkrak poin tim lewat rekor pribadi ${hist.maxPointsInGW} poin ${peakGw}${peakRankInline ? ` (${peakRankInline.slice(2)})` : ''}`;
      }

      case 'BONUS_MAGNET': {
        const bpsRankInline = hasLeagueRanks && ranks && ranks.bpsRank <= 10 ? `, #${ranks.bpsRank}` : '';
        if (hist.threeBonusCount >= 3 || (hasLeagueRanks && ranks && ranks.bpsRank <= 6)) {
          if (mod === 0) return `sering menyapu bersih bonus poin dengan ${hist.threeBonusCount} kali meraih 3 poin bonus penuh (total ${bonusTotal} bonus)`;
          if (mod === 1) return `berstatus BPS magnet (total ${bps} BPS${bpsRankInline}, ${bps90.toFixed(1)}/90) yang sudah berbuah ${bonusTotal} poin bonus`;
          return `memiliki efisiensi aksi tinggi (${bps90.toFixed(1)} BPS/90) yang kerap berbuah tambahan bonus poin di akhir laga`;
        }
        if (mod === 0) return `mengantongi total ${bps} BPS (${bps90.toFixed(1)}/90${bpsRankInline}) dan ${bonusTotal} poin bonus`;
        if (mod === 1) return `didukung indeks BPS tinggi (${bps90.toFixed(1)} BPS/90) yang menghasilkan total ${bonusTotal} poin bonus`;
        return `kerap unggul dalam kalkulasi BPS (total ${bps}${bpsRankInline}) untuk mengamankan ekstra bonus poin`;
      }

      case 'CONSISTENT_FLOOR': {
        const l3RankParen = hasLeagueRanks && ranks && ranks.last3PtsRank <= 10 ? ` (#${ranks.last3PtsRank})` : '';
        if (mod === 0) return `membukukan ${hist.last3Points} poin dalam 3 gameweek terakhir${l3RankParen} tanpa sekali pun mengecewakan pemiliknya`;
        if (mod === 1) return `tampil amat stabil lewat koleksi ${hist.last3Points} poin dari 3 laga terakhir beruntun${l3RankParen}`;
        return `menjaga konsistensi poin aman lewat kontribusi ${hist.last3Points} poin sepanjang 3 gameweek terkini${l3RankParen}`;
      }

      case 'BALANCED_ATTACKER':
        if (mod === 0) return `menawarkan jalur poin ganda lewat kombinasi total ${g} gol dan ${a} assist`;
        if (mod === 1) return `mampu menjadi pencetak gol sekaligus penyedia assist (${g}G, ${a}A)`;
        return `memberikan kontribusi serangan komplet (total ${g} gol dan ${a} assist)`;

      case 'SET_PIECE_SPECIALIST':
        if (mod === 0) return `memegang kendali eksekusi set-piece tim yang memperbesar peluang assist dan bonus poin`;
        if (mod === 1) return `rutin mengeksekusi corner dan free-kick berbahaya untuk membongkar kebuntuan`;
        return `mendapatkan rute poin tambahan dari tugas set-piece (corner/free-kick)`;

      case 'MINUTES_TALISMAN':
        if (mod === 0) return `menikmati jaminan menit bermain reguler (${profile.minsPerStart} menit/start) tanpa bayang-bayang rotasi`;
        if (mod === 1) return profile.isDef
          ? `berstatus pilar lini belakang yang nyaris selalu bermain penuh 90 menit`
          : `berstatus starter reguler yang nyaris selalu bermain penuh 90 menit`;
        return `mengantongi kepercayaan penuh pelatih untuk menjaga stabilitas menit bermain di lapangan`;

      case 'STEADY_SCORER':
      default:
        if (g >= 3) {
          if (mod === 0) return `telah menyumbangkan total ${g} gol dengan rata-rata ${xGI90.toFixed(2)} xGI/90`;
          if (mod === 1) return `menjaga ancaman konstan di depan gawang lewat koleksi total ${g} gol`;
          return `berkontribusi aktif terhadap produktivitas klub dengan total ${g} gol dan ${pts} poin FPL`;
        }
        if (mod === 0) return `terlibat aktif dalam alur serangan dengan ${xGI90.toFixed(2)} xGI/90`;
        if (mod === 1) return `mengumpulkan total ${pts} poin FPL lewat kontribusi konsisten bagi tim`;
        return `tampil solid mendulang total ${pts} poin FPL sebagai tumpuan skuadnya`;
    }
  } else {
    // English phrasing
    const peakGwEn = formatPeakGwEn();
    switch (trait) {
      case 'SCORING_STREAK':
        return hist.consecutiveGoals >= 2
          ? `riding a scorching goal-scoring run across his last ${hist.consecutiveGoals} consecutive matches`
          : `blazing through recent outings with ${hist.last3Goals} goals in his last 3 appearances`;
      case 'RETURN_STREAK':
        return `delivering consistent attacking returns across ${hist.consecutiveReturns} consecutive matchdays`;
      case 'CLINICAL_FINISHER':
        return `displaying clinical finishing precision with ${g} goals outperforming his ${xG.toFixed(1)} xG this season`;
      case 'OVERDUE_HAUL':
        return `generating ${xG.toFixed(1)} xG this season (${xG90.toFixed(2)}/90) against ${g} actual goals, pointing to an imminent breakout haul`;
      case 'DEFCON_GUARDIAN': {
        const csNumEn = profile.cleanSheetsTotal || hist.cleanSheetsTotal;
        if (csNumEn > 0) {
          return `anchoring ${csNumEn} clean sheets this season while dominating defensive clearances and duels (Influence ${Math.round(inf)})`;
        }
        return `anchoring the backline through dominant clearances, blocks, and interceptions this season (Influence ${Math.round(inf)})`;
      }
      case 'AERIAL_SET_PIECE':
        return `providing lethal aerial set-piece threat (${threat90.toFixed(1)} Threat/90 this season) alongside defensive solidity`;
      case 'CREATIVE_ORCHESTRATOR':
        if (assistVsXaContrast) {
          return `turning chances into ${a} assists this season despite posting just ${xA.toFixed(1)} xA (${creat90.toFixed(1)} Creativity/90)`;
        }
        return a >= 2
          ? `commanding the attack with ${a} assists and ${creat90.toFixed(1)} Creativity/90 this season`
          : `unlocking defenses with sharp passing vision (${xA90.toFixed(2)} xA/90, ${creat90.toFixed(1)} Creativity/90 this season)`;
      case 'BOX_MONSTER':
        return `dominating the opposition penalty area with relentless shot volume (${threat90.toFixed(1)} Threat/90 this season)`;
      case 'HIGH_CEILING_HAUL':
        return `boasting an explosive ceiling proven by his ${hist.maxPointsInGW}-point haul ${peakGwEn} this season`;
      case 'BONUS_MAGNET':
        return `acting as a genuine bonus magnet with ${bps} BPS and ${bonusTotal} bonus points this season`;
      case 'CONSISTENT_FLOOR':
        return `delivering steady output with ${hist.last3Points} points across his last 3 outings`;
      case 'BALANCED_ATTACKER':
        return `combining goal threat and playmaking precision (${g}G, ${a}A this season)`;
      case 'SET_PIECE_SPECIALIST':
        return `owning dead-ball delivery duties to maximize assist and bonus potential`;
      case 'MINUTES_TALISMAN':
        return `commanding near-guaranteed 90-minute security (${profile.minsPerStart} mins/start this season)`;
      default:
        return g >= 3
          ? `delivering reliable attacking output with ${g} goals this season (${xGI90.toFixed(2)} xGI/90)`
          : `accumulating ${pts} FPL points this season with active involvement (${xGI90.toFixed(2)} xGI/90)`;
    }
  }
}

function renderCaveatPhrasing(caveat: CaveatType | null, p: ScoutNarrativeInput, isId: boolean, vSeed: number): string {
  if (!caveat) return '';
  const mod = vSeed % 3;
  const yc = p.yellowCards || 0;

  if (isId) {
    switch (caveat) {
      case 'YELLOW_CARD_RISK':
        if (mod === 0) return `risiko disiplin akibat akumulasi ${yc} kartu kuning`;
        if (mod === 1) return `ancaman suspensi setelah mengantongi ${yc} kartu kuning`;
        return `koleksi ${yc} kartu kuning yang mengintai potensi poin minus`;
      case 'EARLY_SUB_RISK':
        if (mod === 0) return `menit bermainnya yang kerap dipotong pergantian taktis sebelum menit ke-75`;
        if (mod === 1) return `kebijakan rotasi yang membuatnya ditarik keluar lebih awal di babak kedua`;
        return `menit bermain yang kerap dibatasi sebelum peluit akhir`;
      case 'GOAL_RELIANT_NARROW':
        if (mod === 0) return `perolehan poinnya yang sangat bertumpu pada gol langsung tanpa banyak sokongan assist`;
        if (mod === 1) return `jalur poin yang relatif linier akibat minimnya kreasi umpan matang`;
        return `ketergantungan tinggi pada gol langsung untuk mendulang poin`;
      case 'RECENT_COLD_BLANKS':
        if (p.position === 'DEF' || p.position === 'GKP') {
          return mod === 0
            ? `lini belakang tim yang sempat kebobolan di dua pekan terakhir`
            : `terputusnya catatan clean sheet tim dalam dua laga terakhir`;
        }
        return mod === 0
          ? `sedikit jeda gol dalam dua pekan terakhir`
          : `dua pertandingan belakangan yang belum menghasilkan gol`;
      case 'FINISHING_SCRUTINY':
        return mod === 0
          ? `penyelesaian akhirnya yang sedang diuji setelah melewatkan peluang emas`
          : `efisiensi konversi yang sedikit tersendat belakangan ini`;
    }
  } else {
    switch (caveat) {
      case 'YELLOW_CARD_RISK':
        return `disciplinary risk from ${yc} accumulated yellow cards`;
      case 'EARLY_SUB_RISK':
        return `early substitutions trimming his second-half minutes`;
      case 'GOAL_RELIANT_NARROW':
        return `heavy reliance on direct goals with modest assist output`;
      case 'RECENT_COLD_BLANKS':
        return p.position === 'DEF' || p.position === 'GKP'
          ? `his backline conceding across the last two matchdays`
          : `brief blanks across his last two outings`;
      case 'FINISHING_SCRUTINY':
        return `recent missed chances`;
    }
  }
}

/**
 * Unifies the Top 10 Captain Picks into a single, cohesive, journalistic editorial feature.
 * Ensures zero duplicated trait pairings, position-accurate prose for DEF/GKP vs ATT,
 * and article-wide tracking so no two picks reuse the exact same template or matchup phrasing.
 */
export function generateCaptainArticlePicks(
  top10: ScoutNarrativeInput[],
  matchProjections: Map<string, MatchProjInput> | Record<string, MatchProjInput>,
  targetNextGW: number,
  isId: boolean,
  allPlayers?: ScoutNarrativeInput[],
  clubNameMap?: Record<string, string>
): Array<ScoutNarrativeInput & { rank: number; rating: number; narrative: string }> {
  if (top10.length === 0) return [];

  const maxScore = top10[0]?.captainScore || 1;
  const minScore = top10[top10.length - 1]?.captainScore || 0;
  const scoreRange = Math.max(0.1, maxScore - minScore);

  const leagueRankMap = buildLeagueStatRankMap(allPlayers && allPlayers.length > 0 ? allPlayers : top10);

  // Track counters across the 10-pick article so shared traits/matchups NEVER repeat the same sentence!
  const traitCounter = new Map<TraitType, number>();
  const matchCatCounter = new Map<string, number>();
  const cleanTemplatePool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const caveatTemplatePool = [0, 1, 2, 3, 4, 5, 6, 7];
  let cleanUseIdx = 0;
  let caveatUseIdx = 0;

  return top10.map((p, idx) => {
    const rank = idx + 1;
    const normalizedScore = ((p.captainScore || 0) - minScore) / scoreRange;
    const rating = Math.min(99, Math.max(72, Math.round(74 + normalizedScore * (98 - 74))));

    const match = (matchProjections instanceof Map)
      ? matchProjections.get(p.teamShort)
      : (matchProjections as Record<string, MatchProjInput>)?.[p.teamShort];
    const hist = extractHistoryProfile(p);
    const profile = analyzePlayerTraits(p, hist, traitCounter, leagueRankMap.get(p.id));

    const clubName = resolveClubName(p.teamShort, clubNameMap);
    const matchesList = match?.matches && match.matches.length > 0 ? match.matches : null;
    const isDgw = Boolean(matchesList && matchesList.length >= 2);
    const oppShort = match?.oppShort || '';
    const opp = isDgw && matchesList
      ? matchesList.map((m) => resolveClubName(m.oppShort, clubNameMap)).join(' & ')
      : oppShort
      ? resolveClubName(oppShort, clubNameMap)
      : (isId ? 'lawan' : 'opponent');
    const isHome = match?.isHome ?? true;
    const tLambda = match?.teamLambda ?? 1.5;
    const csProb = match?.csProb ?? 25;
    const isOppBig6 = matchesList
      ? matchesList.some((m) => BIG_SIX_CLUBS.has(m.oppShort))
      : BIG_SIX_CLUBS.has(oppShort);
    const isOppBottom = matchesList
      ? matchesList.some((m) => BOTTOM_HALF_CLUBS.has(m.oppShort))
      : BOTTOM_HALF_CLUBS.has(oppShort);
    const venue = isDgw
      ? (isId ? 'Double Gameweek' : 'Double Gameweek')
      : isHome
      ? (isId ? 'kandang' : 'home')
      : (isId ? 'tandang' : 'away');

    const vSeed = (p.id * 17 + rank * 23) % 100;

    // 1. POSITION-AWARE EDITORIAL ARTICLE FRAMING BY RANK
    let rankEditorialIntro = '';
    if (isId) {
      if (rank === 1) {
        rankEditorialIntro = profile.isDef
          ? `Memimpin daftar rekomendasi ban kapten GW${targetNextGW}, tembok tangguh ${p.webName} (${clubName}) hadir sebagai pilihan utama yang sulit digeser.`
          : `Memimpin daftar rekomendasi ban kapten GW${targetNextGW}, ${p.webName} (${clubName}) hadir sebagai pilihan utama nomor satu yang tak terbantahkan.`;
      } else if (rank === 2) {
        rankEditorialIntro = profile.isDef
          ? `Membuntuti ketat di peringkat kedua sebagai opsi kapten bertahan elit, ${p.webName} (${clubName}) menawarkan garansi poin solid di dua sisi lapangan.`
          : `Membuntuti ketat di peringkat kedua sebagai penantang terberat ban kapten, ${p.webName} (${clubName}) menawarkan daya ledak serangan yang sangat diperhitungkan.`;
      } else if (rank === 3) {
        rankEditorialIntro = `Bagi tim yang memprioritaskan tren performa terkini, ${p.webName} (${clubName}) di peringkat ketiga adalah opsi momentum terpanas pekan ini.`;
      } else if (rank === 4) {
        rankEditorialIntro = profile.isDef
          ? `Menempati peringkat keempat, ${p.webName} (${clubName}) menjadi simbol stabilitas pertahanan dengan potensi bonus poin dan set-piece tinggi.`
          : `Menempati peringkat keempat, ${p.webName} (${clubName}) membawa reputasi sebagai aset high-ceiling yang siap memanen poin besar.`;
      } else if (rank === 5) {
        rankEditorialIntro = profile.isDef
          ? `Memasuki paruh tengah lima besar, pilar pertahanan ${p.webName} (${clubName}) menyuguhkan konsistensi poin pekan demi pekan.`
          : `Memasuki paruh tengah lima besar, ${p.webName} (${clubName}) merepresentasikan opsi kapten berdaya dobrak tinggi yang sangat konsisten.`;
      } else if (rank === 6) {
        rankEditorialIntro = profile.isDef
          ? `Di peringkat keenam, sorotan mengarah pada jangkar pertahanan ${p.webName} (${clubName}) dengan peluang clean sheet dan konsistensi poin paling terjaga.`
          : `Di peringkat keenam, fokus beralih pada figur sentral penyerangan ${p.webName} (${clubName}) yang memiliki rasio peluang matang stabil.`;
      } else if (rank === 7) {
        rankEditorialIntro = `Opsi ketujuh menghadirkan ${p.webName} (${clubName}) yang membuka jalur perolehan poin kompetitif di gameweek ini.`;
      } else if (rank === 8) {
        rankEditorialIntro = `Sebagai opsi bernilai efisiensi tinggi di peringkat kedelapan, ${p.webName} (${clubName}) membuktikan kontribusinya mampu menyaingi bintang berharga mahal.`;
      } else if (rank === 9) {
        rankEditorialIntro = `Di peringkat kesembilan, ${p.webName} (${clubName}) beroperasi sebagai kuda hitam berbahaya yang luput dari perhatian mayoritas tim.`;
      } else {
        rankEditorialIntro = `Menutup sepuluh besar kandidat kapten GW${targetNextGW}, ${p.webName} (${clubName}) menjadi opsi differential berani berdaya ungkit maksimal.`;
      }
    } else {
      if (rank === 1) {
        rankEditorialIntro = `Leading our GW${targetNextGW} captaincy hierarchy, ${p.webName} (${clubName}) stands as the undisputed top pick.`;
      } else if (rank === 2) {
        rankEditorialIntro = `Hot on the leader's heels in second spot, ${p.webName} (${clubName}) represents the foremost alternative armband weapon.`;
      } else if (rank === 3) {
        rankEditorialIntro = `For squads hunting pure form momentum, our third-ranked pick ${p.webName} (${clubName}) is riding a blazing streak.`;
      } else if (rank === 4) {
        rankEditorialIntro = `Slotting into fourth, ${p.webName} (${clubName}) brings proven high-ceiling haul pedigree into the fold.`;
      } else if (rank === 5) {
        rankEditorialIntro = `Anchoring fifth spot, ${p.webName} (${clubName}) provides exceptional tactical consistency across key metrics.`;
      } else if (rank === 6) {
        rankEditorialIntro = profile.isDef
          ? `In sixth spot, defensive powerhouse ${p.webName} (${clubName}) offers elite clean-sheet equity and set-piece threat.`
          : `In sixth spot, ${p.webName} (${clubName}) offers razor-sharp penalty-box menace.`;
      } else if (rank === 7) {
        rankEditorialIntro = `Our seventh recommendation highlights ${p.webName} (${clubName}) who delivers immense competitive return potential.`;
      } else if (rank === 8) {
        rankEditorialIntro = `Offering remarkable efficiency at £${p.cost.toFixed(1)}m, eighth-placed ${p.webName} (${clubName}) rivals premium assets in underlying output.`;
      } else if (rank === 9) {
        rankEditorialIntro = `In ninth spot, ${p.webName} (${clubName}) functions as a dangerous silent weapon capable of shocking competitors.`;
      } else {
        rankEditorialIntro = `Rounding off our top ten captaincy suite, ${p.webName} (${clubName}) is the definitive fearless punt to slash your league deficit.`;
      }
    }

    // 2. PLAYER-DRIVEN STATISTICAL SUBSTANCE (Article-wide uniqueness + 100% grammatical flow)
    const t1Count = traitCounter.get(profile.primaryTrait) || 0;
    traitCounter.set(profile.primaryTrait, t1Count + 1);
    const t2Count = traitCounter.get(profile.secondaryTrait) || 0;
    traitCounter.set(profile.secondaryTrait, t2Count + 1);

    const trait1Text = renderTraitPhrasing(profile.primaryTrait, profile, hist, t1Count, isId);
    const trait2Text = renderTraitPhrasing(profile.secondaryTrait, profile, hist, t2Count, isId);
    const caveatText = renderCaveatPhrasing(profile.caveat, p, isId, vSeed);

    let statBody = '';

    if (isId) {
      let penPrefix = '';
      if (profile.isPrimaryPen) {
        const penVariants = [
          'Memegang status eksekutor penalti utama tim, ',
          'Dengan jaminan tugas penalti di tangannya, ',
          'Sebagai algojo penalti nomor satu klub, ',
          'Ditambah garansi sebagai penendang penalti tim, ',
        ];
        penPrefix = penVariants[(rank + p.id) % penVariants.length];
      }

      if (caveatText) {
        const cTemplateId = caveatTemplatePool[caveatUseIdx % caveatTemplatePool.length];
        caveatUseIdx++;
        const caveatTemplates = [
          `Kendati ada catatan ${caveatText}, kualitasnya tidak surut karena ia ${trait1Text}, serta ${trait2Text}.`,
          `Meskipun dibayangi ${caveatText}, setiap tim tetap layak percaya mengingat ia ${trait1Text}, sekaligus ${trait2Text}.`,
          `Walau menghadapi ${caveatText}, performanya tetap menjanjikan sebab ia ${trait1Text}, ditambah ia juga ${trait2Text}.`,
          `Terlepas dari ${caveatText}, ${profile.isDef ? 'pilar pertahanan ini' : 'tumpuan serangan ini'} tetap menghadirkan ancaman nyata karena ia ${trait1Text}, sementara ia pun ${trait2Text}.`,
          `Faktor ${caveatText} memang patut dicermati, namun potensi poinnya terjaga karena ia ${trait1Text} dan ${trait2Text}.`,
          `Meski sempat diwarnai ${caveatText}, kontribusinya terimbangi oleh fakta bahwa ia ${trait1Text}, berpadu fakta ia ${trait2Text}.`,
          `Walau ada sorotan soal ${caveatText}, sang bintang tetap menjadi figur sentral di mana ia ${trait1Text}, sekaligus ${trait2Text}.`,
          `Kendati perhatian tertuju pada ${caveatText}, data membuktikan ia ${trait1Text}, diiringi catatan bahwa ia ${trait2Text}.`,
        ];
        const raw = caveatTemplates[cTemplateId];
        statBody = penPrefix ? `${penPrefix}${raw[0].toLowerCase()}${raw.slice(1)}` : raw;
      } else {
        const sTemplateId = cleanTemplatePool[cleanUseIdx % cleanTemplatePool.length];
        cleanUseIdx++;
        const cleanTemplates = [
          `Statistiknya menunjukkan betapa ia ${trait1Text}, berpadu serasi dengan catatan bahwa ia ${trait2Text}.`,
          `Di atas lapangan, ${profile.isDef ? 'bek tangguh ini' : 'pemain andalan ini'} ${trait1Text}. Nilai tambahnya semakin nyata karena ia ${trait2Text}.`,
          `Keunggulan utamanya terpancar saat ia ${trait1Text}, yang kian lengkap lantaran ia juga ${trait2Text}.`,
          `Secara taktikal, pemain ini ${trait1Text}. Menariknya, ia sekaligus ${trait2Text}.`,
          `Performa impresifnya terlihat jelas saat ia ${trait1Text}, sementara di sisi lain ia ${trait2Text}.`,
          `Bukan cuma ${trait1Text}, sang pemain pun terbukti ${trait2Text}.`,
          `Angka-angka dasarnya mengonfirmasi bahwa ia ${trait1Text}, diperkuat fakta di mana ia ${trait2Text}.`,
          `Ditinjau dari kontribusi lapangan, ia ${trait1Text}. Pada saat bersamaan, ia ${trait2Text}.`,
          `Profil permainannya kian meyakinkan mengingat ia ${trait1Text}, apalagi ia turut ${trait2Text}.`,
          `Pondasi performanya sangat solid: sang bintang ${trait1Text}, dan tak kalah penting, ia ${trait2Text}.`,
          `Dari kacamata analitik, ia ${trait1Text}. Rekam jejaknya makin kokoh karena ia ${trait2Text}.`,
          `Dalam setiap laga, ia ${trait1Text}, dan nilainya berlipat ganda sebab ia ${trait2Text}.`,
        ];
        const raw = cleanTemplates[sTemplateId];
        statBody = penPrefix ? `${penPrefix}${raw[0].toLowerCase()}${raw.slice(1)}` : raw;
      }
    } else {
      const penPrefix = profile.isPrimaryPen ? 'Holding primary spot-kick duties, ' : '';
      if (caveatText) {
        const cIdx = caveatUseIdx % 3;
        caveatUseIdx++;
        const enCaveatTemplates = [
          `Despite ${caveatText}, his baseline remains formidable as he is ${trait1Text}, alongside ${trait2Text}.`,
          `While navigating ${caveatText}, his explosive upside holds firm because he is ${trait1Text}, and also ${trait2Text}.`,
          `Regardless of ${caveatText}, he consistently delivers as he is ${trait1Text}, reinforced by ${trait2Text}.`,
        ];
        const raw = enCaveatTemplates[cIdx];
        statBody = penPrefix ? `${penPrefix}${raw[0].toLowerCase()}${raw.slice(1)}` : raw;
      } else {
        const sIdx = cleanUseIdx % 5;
        cleanUseIdx++;
        const enCleanTemplates = [
          `Underlying metrics demonstrate that he is ${trait1Text}, harmoniously paired with ${trait2Text}.`,
          `On the pitch, he is ${trait1Text}. His value is further elevated as he is ${trait2Text}.`,
          `His primary strength lies in being ${trait1Text}, while also ${trait2Text}.`,
          `Tactically, he stands out as he is ${trait1Text}, while simultaneously ${trait2Text}.`,
          `Consistent returns highlight that he is ${trait1Text}, backed by ${trait2Text}.`,
        ];
        const raw = enCleanTemplates[sIdx];
        statBody = penPrefix ? `${penPrefix}${raw[0].toLowerCase()}${raw.slice(1)}` : raw;
      }
    }

    // 3. POSITION-AWARE & NON-REPETITIVE TACTICAL MATCHUP REALITY
    let matchText = '';
    if (isId) {
      if (isDgw) {
        matchText = profile.isDef
          ? `Jadwal ganda melawan ${opp} memberi dua kesempatan penuh untuk mengamankan clean sheet, DefCon, serta tambahan bonus poin.`
          : `Jadwal ganda melawan ${opp} melipatgandakan volume menit bermain dan peluang gol sepanjang satu gameweek.`;
      } else if (profile.isDef) {
        const defKey = isOppBig6 ? 'def_big6' : (csProb >= 34 || isOppBottom ? 'def_cs' : (isHome ? 'def_home' : 'def_away'));
        const mc = matchCatCounter.get(defKey) || 0;
        matchCatCounter.set(defKey, mc + 1);

        if (defKey === 'def_big6') {
          const variants = [
            `Ujian besar menghadapi rival papan atas ${opp} (${venue}) menuntut kedisiplinan lini belakang, sekaligus membuka peluang poin DefCon dan bonus BPS.`,
            `Berhadapan dengan serangan tajam ${opp} (${venue}), ketangguhannya dalam duel bertahan serta potensi gol set-piece akan menjadi pembeda.`,
          ];
          matchText = variants[mc % variants.length];
        } else if (defKey === 'def_cs') {
          const variants = [
            `Meladeni ${opp} (${venue}), soliditas pertahanan tim membuka peluang clean sheet meyakinkan (~${Math.round(csProb)}%).`,
            `Laga melawan ${opp} (${venue}) menawarkan prospek clean sheet tinggi (~${Math.round(csProb)}%) plus ancaman tambahan dari situasi set-piece.`,
            `Menghadapi ${opp} (${venue}), struktur defensif klubnya difavoritkan menjaga clean sheet sekaligus mendulang bonus poin.`,
          ];
          matchText = variants[mc % variants.length];
        } else if (defKey === 'def_home') {
          const variants = [
            `Bermain di hadapan pendukung sendiri melawan ${opp} memperkuat kans timnya mengunci clean sheet dan poin DefCon.`,
            `Atmosfer kandang saat menjamu ${opp} memberi keuntungan kontrol wilayah untuk mengejar bonus clean sheet maupun duel udara.`,
          ];
          matchText = variants[mc % variants.length];
        } else {
          const variants = [
            `Saat melawat ke markas ${opp}, organisasi pertahanan rapat dan dominasi sapuannya di kotak penalti bakal menjadi tulang punggung poin.`,
            `Bertandang menghadapi ${opp}, disiplin garis belakang timnya serta peluang set-piece tetap menjanjikan poin bertahan yang aman.`,
          ];
          matchText = variants[mc % variants.length];
        }
      } else {
        const attKey = isOppBig6 ? 'att_big6' : (isOppBottom || tLambda >= 1.7 ? 'att_fav' : (isHome ? 'att_home' : 'att_away'));
        const mc = matchCatCounter.get(attKey) || 0;
        matchCatCounter.set(attKey, mc + 1);

        if (attKey === 'att_big6') {
          const variants = [
            `Bentrok sengit melawan rival papan atas ${opp} (${venue}) menjadi panggung pembuktian mentalitas sang bintang dalam laga berintensitas tinggi.`,
            `Duel bergengsi melawan ${opp} (${venue}) kerap memancing performa terbaiknya di ruang transisi terbuka.`,
          ];
          matchText = variants[mc % variants.length];
        } else if (attKey === 'att_fav') {
          const lambdaClause = tLambda >= 1.65 ? ` (proyeksi tim ~${tLambda.toFixed(1)} gol)` : '';
          const variants = [
            `Jadwal menghadapi ${opp} (${venue}) membuka jalan lebar bagi agresivitas serangnya${lambdaClause} membongkar pertahanan rapuh lawan.`,
            `Menantang ${opp} (${venue}), celah di garis pertahanan lawan memberi ruang leluasa bagi dirinya untuk memproduksi gol maupun assist${lambdaClause}.`,
            `Laga melawan ${opp} (${venue}) menyajikan skenario ideal bagi lini depannya untuk mencetak banyak peluang${lambdaClause}.`,
          ];
          matchText = variants[mc % variants.length];
        } else if (attKey === 'att_home') {
          const variants = [
            `Keunggulan atmosfer kandang saat meladeni ${opp} menjamin dominasi penguasaan bola serta gelombang serangan beruntun.`,
            `Tampil di hadapan publik sendiri menghadapi ${opp}, intensitas tekanan timnya bakal memberinya pasokan umpan matang melimpah.`,
            `Bermain di kandang melawan ${opp} membuat lini serangnya leluasa mengurung pertahanan lawan sejak menit awal.`,
            `Dukungan penuh publik tuan rumah saat menjamu ${opp} menjadi bahan bakar ekstra bagi daya gedor timnya sepanjang laga.`,
          ];
          matchText = variants[mc % variants.length];
        } else {
          const variants = [
            `Melawat ke markas ${opp}, efektivitas transisi cepat dan pergerakannya di kotak penalti lawan siap menjadi senjata pemecah kebuntuan.`,
            `Dalam lawatan ke kandang ${opp}, celah di belakang garis pertahanan tuan rumah sangat cocok untuk gaya mainnya yang eksplosif.`,
            `Bertandang menghadapi ${opp}, dirinya diprediksi tetap menjadi titik tumpu utama saat tim membangun serangan balik mematikan.`,
            `Berstatus tim tamu di markas ${opp}, ketajamannya memanfaatkan ruang terbuka dapat langsung menghukum kelengahan tuan rumah.`,
          ];
          matchText = variants[mc % variants.length];
        }
      }
    } else {
      if (isDgw) {
        matchText = `With a Double Gameweek against ${opp}, two full fixtures amplify his expected minutes, ceiling, and bonus potential.`;
      } else if (isOppBig6) {
        matchText = `A heavyweight clash against Big 6 rivals ${opp} (${venue}) demands sharp execution, though big occasions routinely elevate his game.`;
      } else if (isOppBottom || tLambda >= 1.8) {
        matchText = profile.isDef
          ? `Facing ${opp} (${venue}) sets up strong clean-sheet probability (~${Math.round(csProb)}%) alongside set-piece threat.`
          : `Facing ${opp} (${venue}) offers prime attacking conditions (projected ~${tLambda.toFixed(1)} team goals).`;
      } else {
        matchText = `Operating ${venue} against ${opp}, his tactical role puts him at the heart of his team's key actions.`;
      }
    }

    // 4. VARIED, POSITION-AWARE STRATEGIC FPL TEAM ADVICE
    let verdictText = '';
    if (isId) {
      if (rank === 1) {
        verdictText = `Bagi tim yang mengutamakan keamanan peringkat puncak, ban kapten di tangannya adalah jaminan poin aman paling rasional pekan ini.`;
      } else if (rank === 2) {
        verdictText = `Alternatif kapten nomor dua yang siap menghadirkan lonjakan poin masif andai pilihan terpopuler terhenti.`;
      } else if (rank === 3) {
        verdictText = `Pilihan tepat untuk menunggangi gelombang panas performa sang pemain di GW${targetNextGW}.`;
      } else if (rank === 4) {
        verdictText = profile.isDef
          ? `Opsi kapten berkarakter unik dengan kombinasi peluang clean sheet dan bonus poin yang sangat kompetitif.`
          : `Kandidat kuat pemanen poin ganda yang memadukan ketajaman peluang dengan prospek bonus poin maksimal.`;
      } else if (rank === 5) {
        verdictText = profile.isDef
          ? `Solusi aman bagi pemburu kestabilan poin bertahan tanpa kehilangan kans poin kejutan.`
          : `Kandidat kapten seimbang yang menjanjikan keterlibatan gol tinggi sepanjang 90 menit.`;
      } else if (rank === 6) {
        verdictText = profile.isDef
          ? `Pilar pertahanan ideal apabila Anda memprediksi laga ketat minim gol di gameweek ini.`
          : `Penantang serius di papan tengah yang sanggup menyamai perolehan poin aset-aset termahal.`;
      } else if (rank === 7) {
        verdictText = profile.isDef
          ? `Opsi kapten defensif bernilai strategis untuk mengunci clean sheet plus potensi gol set-piece.`
          : `Kandidat serbaguna yang layak dipertimbangkan sebagai vice-captain maupun kejutan taktis.`;
      } else if (rank === 8) {
        verdictText = `Pilihan bernilai efisiensi tinggi yang sanggup membalikkan selisih poin mini-league lewat pengali kapten 2x.`;
      } else if (rank === 9) {
        verdictText = `Kuda hitam kapten berdaya ledak differential untuk menyalip lawan yang terpaku pada nama-nama template.`;
      } else {
        verdictText = `Opsi differential berani berisiko terukur bagi tim yang mengincar lompatan peringkat drastis di GW${targetNextGW}.`;
      }
    } else {
      if (rank === 1) {
        verdictText = `The definitive high-floor template armband to preserve your mini-league lead in GW${targetNextGW}.`;
      } else if (rank === 2) {
        verdictText = `A lethal alternative ready to reward squads if the primary template favorite fails to fire.`;
      } else if (rank >= 8) {
        verdictText = `A bold differential armband carrying massive rank-climbing leverage for GW${targetNextGW}.`;
      } else {
        verdictText = profile.isDef
          ? `A high-floor defensive captaincy contender blending clean-sheet equity with bonus upside.`
          : `A formidable captaincy contender delivering a potent blend of volume, form, and bonus upside.`;
      }
    }

    const narrative = `${rankEditorialIntro} ${statBody} ${matchText} ${verdictText}`;

    return {
      ...p,
      rank,
      rating,
      narrative
    };
  });
}

/**
 * Unifies the Top 3 Differential Picks (<5% FNB League ownership) into a single, cohesive 3-part feature article.
 * Dynamically highlights each individual player's genuine statistics with zero duplicate phrasing.
 */
export function generateDifferentialArticlePicks(
  top3: ScoutNarrativeInput[],
  matchProjections: Map<string, MatchProjInput> | Record<string, MatchProjInput>,
  targetNextGW: number,
  isId: boolean,
  allPlayers?: ScoutNarrativeInput[],
  clubNameMap?: Record<string, string>
): Array<ScoutNarrativeInput & { rank: number; rating: number; narrative: string }> {
  if (top3.length === 0) return [];

  const maxScore = top3[0]?.diffScore || 1;
  const diffTraitCounter = new Map<TraitType, number>();
  const leagueRankMap = buildLeagueStatRankMap(allPlayers && allPlayers.length > 0 ? allPlayers : top3);

  return top3.slice(0, 3).map((p, idx) => {
    const rank = idx + 1;
    const rating = Math.min(96, Math.max(78, Math.round(((p.diffScore || 0) / maxScore) * 95) - (idx * 3)));

    const match = (matchProjections instanceof Map)
      ? matchProjections.get(p.teamShort)
      : (matchProjections as Record<string, MatchProjInput>)?.[p.teamShort];
    const hist = extractHistoryProfile(p);
    const profile = analyzePlayerTraits(p, hist, diffTraitCounter, leagueRankMap.get(p.id));

    const clubName = resolveClubName(p.teamShort, clubNameMap);
    const matchesList = match?.matches && match.matches.length > 0 ? match.matches : null;
    const isDgw = Boolean(matchesList && matchesList.length >= 2);
    const oppShort = match?.oppShort || '';
    const opp = isDgw && matchesList
      ? matchesList.map((m) => resolveClubName(m.oppShort, clubNameMap)).join(' & ')
      : oppShort
      ? resolveClubName(oppShort, clubNameMap)
      : (isId ? 'lawan' : 'opponent');
    const isHome = match?.isHome ?? true;
    const venue = isDgw
      ? 'Double Gameweek'
      : isHome
      ? (isId ? 'kandang' : 'home')
      : (isId ? 'tandang' : 'away');
    const own = Number(p.fnbOwn || 0);

    const tCount = diffTraitCounter.get(profile.primaryTrait) || 0;
    diffTraitCounter.set(profile.primaryTrait, tCount + 1);
    const traitText = renderTraitPhrasing(profile.primaryTrait, profile, hist, tCount, isId);

    const t2Count = diffTraitCounter.get(profile.secondaryTrait) || 0;
    diffTraitCounter.set(profile.secondaryTrait, t2Count + 1);
    const trait2Text = renderTraitPhrasing(profile.secondaryTrait, profile, hist, t2Count, isId);

    let narrative = '';

    if (isId) {
      if (rank === 1) {
        // PART 1: THE PRIME HIDDEN GEM (0% OWNERSHIP HERO)
        const actionTail = profile.isDef
          ? `ketangguhannya menjaga pertahanan plus kontribusi bonus siap menjadi kunci pembalik keadaan klasemen`
          : `pergerakan cerdiknya di area penalti lawan siap menjadi kunci pembalik keadaan klasemen`;
        narrative = `Membuka trio kartu as pembeda GW${targetNextGW}, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) adalah permata tersembunyi nomor satu dengan kepemilikan ${own <= 0.5 ? '0%' : `${own.toFixed(1)}%`} di FNB League. Tanpa ada rival yang mengawalnya, setiap poin yang diraihnya menjadi keuntungan bersih 100% bagi peringkat Anda. Di lapangan, ia ${traitText} sekaligus ${trait2Text}. Menghadapi ${opp} (${venue}), ${actionTail}.`;

      } else if (rank === 2) {
        // PART 2: THE BUDGET ENABLER OR HIGH-VALUE DIFFERENTIAL
        const isBudget = p.cost <= 7.5;
        if (isBudget) {
          narrative = `Melengkapi lini kedua pembeda, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) hadir sebagai solusi efisiensi anggaran paling cerdas (kepemilikan ${own.toFixed(1)}%). Ia membebaskan saldo anggaran skuad Anda untuk mempertahankan bintang-bintang premium tanpa mengorbankan daya saing mingguan. Konsistensinya terlihat jelas karena ia ${traitText}, diiringi fakta bahwa ia ${trait2Text}. Pertandingan melawan ${opp} (${venue}) memberi panggung ideal bagi dirinya untuk membuktikan bahwa harga hemat bisa membuahkan hasil mewah.`;
        } else {
          narrative = `Melengkapi lini kedua pembeda, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) hadir sebagai senjata premium berlabel differential murni (kepemilikan ${own.toFixed(1)}%). Ketika mayoritas rival berpaling ke aset lain, ia justru ${traitText}, diiringi catatan bahwa ia ${trait2Text}. Pertandingan melawan ${opp} (${venue}) memberi panggung ideal bagi dirinya untuk menghadirkan lonjakan peringkat seketika.`;
        }

      } else {
        // PART 3: THE TACTICAL FIXTURE EXPLOITER
        const styleLabel = profile.isDef ? 'disiplin pertahanan dan ancaman set-piece-nya' : 'gaya permainannya yang agresif';
        narrative = `Menyempurnakan trio differential pekan ini, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) adalah kartu truf taktis yang siap mencuri poin krusial. Hanya dimiliki ${own.toFixed(1)}% tim di liga, potensinya menonjol karena ia ${traitText}, dan tak kalah penting ia juga ${trait2Text}. Jadwal menghadapi ${opp} (${venue}) membuka jalan bagi ${styleLabel} untuk melompati rival yang terjebak dalam ketergantungan aset template di GW${targetNextGW}.`;
      }

    } else {
      if (rank === 1) {
        narrative = `Headlining our differential triumvirate for GW${targetNextGW}, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) is the quintessential hidden gem owned by ${own <= 0.5 ? '0%' : `${own.toFixed(1)}%`} of FNB League rivals. With virtually zero competition ownership, every point he produces delivers 100% net rank acceleration. On the pitch he is ${traitText}, while also ${trait2Text}, making his matchup against ${opp} (${venue}) the ultimate rank-swinging catalyst.`;
      } else if (rank === 2) {
        narrative = p.cost <= 7.5
          ? `Occupying the second differential berth, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) stands out as an astute budget enabler at ${own.toFixed(1)}% ownership. Releasing vital transfer funds while delivering genuine output, he is ${traitText} alongside ${trait2Text}. Against ${opp} (${venue}), his profile offers premium returns at discount valuation.`
          : `Occupying the second differential berth, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) stands out as an overlooked high-upside differential at ${own.toFixed(1)}% ownership. On the pitch he is ${traitText} alongside ${trait2Text}, turning his fixture against ${opp} (${venue}) into a huge rank-gaining opportunity.`;
      } else {
        narrative = `Completing our differential trio, ${p.webName} (${clubName}, £${p.cost.toFixed(1)}m) is a tactical fixture punisher primed to exploit key edges. Selected by only ${own.toFixed(1)}% of managers, he is ${traitText} and ${trait2Text}, making his clash with ${opp} (${venue}) the definitive lever to leapfrog stagnant template squads.`;
      }
    }

    return {
      ...p,
      rank,
      rating,
      narrative
    };
  });
}
