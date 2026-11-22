import type { DbPlayerStat, PositionType } from '../types.ts';
import { parseExpectedReturnDate } from './projectionModel.ts';
import {
  CanonicalTacticalRole,
  getFormationOutfieldSlots,
  getFormationRoleMatrix,
  solveMaxWeightAssignment,
} from './tacticalLineupModel.ts';

export const CROSS_COMP_WEIGHTS: Record<string, number> = {
  EN_PR: 1.0,
  EU_CL: 0.78,
  EU_UC: 0.62,
  EU_CF: 0.50,
  EN_FA: 0.65,
  EN_FC: 0.65,
  EN_LC: 0.35,
};

export interface HybridTuneParams {
  // Stage 1: Formation
  lambdaF: number;
  venueBoost: number;
  wV6: number;
  formHalfLifeDays: number;
  // Stage 2A: Calibration & Kalman Drift
  decay: number;
  halfLifeDays: number;
  roleDecayDays: number;
  rolePriorStrength: number;
  mShrink: number;
  l2: number;
  kalmanGain: number;
  clubSumShrinkage: number;
  // Stage 2B: Starting XI Slot Assignment & Synergy
  wA: number;
  wSyn: number;
  lambdaCo: number;
  coPlayHalfLifeDays: number;
  etaJoint: number;
  // Stage 3: Sub_9 & Role Squad Prior
  subUseAllComp: boolean;
  useRoleSquadPrior: boolean;
  wSubBench: number; // bench appearance propensity (sub + unused)
  wSubSquad: number; // total squad inclusion & recent bench momentum
  wSubStart: number; // squad importance / missed-XI starter overflow onto bench
  wSubRole: number;
  subLift: number;
  subStackPen: number;
  subCov: number;
}

export const DEFAULT_HYBRID_PARAMS: HybridTuneParams = {
  lambdaF: 0.64,
  venueBoost: 0.05,
  wV6: 0.15,
  formHalfLifeDays: 21,
  decay: 0.78,
  halfLifeDays: 14,
  roleDecayDays: 28,
  rolePriorStrength: 2.0,
  mShrink: 1.5,
  l2: 2.5,
  kalmanGain: 0.48,
  clubSumShrinkage: 0.50,
  wA: 1.25,
  wSyn: 0.20,
  lambdaCo: 0.75,
  coPlayHalfLifeDays: 24,
  etaJoint: 0.45,
  subUseAllComp: true,
  useRoleSquadPrior: false,
  wSubBench: 0.56,
  wSubSquad: 0.26,
  wSubStart: 0.04,
  wSubRole: 0.14,
  subLift: 0.20,
  subStackPen: 0.12,
  subCov: 0.40,
};

export interface CausalAvailability {
  avail: number; // 0..1
  absen: number; // 0..1
  status: string;
  chance: number | null;
  expectedReturnDate: string | null;
}

export interface PastSeasonMinutesRecord {
  id: number;
  minutes: number;
  total_points?: number;
}

export interface HybridMatchClubSide {
  gw: number;
  eplGw?: number | null;
  compAbbr?: string;
  compWeight?: number;
  kickoffMs?: number;
  clubShort?: string;
  isHome: boolean;
  oppShort: string;
  formationLabel?: string;
  outfieldSlots?: CanonicalTacticalRole[];
  starterIds: number[];
  starterRoles: Record<number, CanonicalTacticalRole>;
  subOnIds: number[];
  unusedBenchIds: number[];
  minutesByPlayer: Record<number, number>;
  playerPosInfo?: Record<number, string>;
}

export interface HybridHistoryStore {
  maxGw: number;
  clubSides: Record<string, HybridMatchClubSide[]>;
  eplClubSides: Record<string, HybridMatchClubSide[]>;
  allCompClubSides: Record<string, HybridMatchClubSide[]>;
  eplKickoffMsByGwClub: Record<string, number>;
  playerPosInfo: Record<number, string>;
}

const ALL_OUTFIELD_ROLES: CanonicalTacticalRole[] = [
  'RB',
  'RWB',
  'RCB',
  'CCB',
  'LCB',
  'LB',
  'LWB',
  'DM',
  'CM',
  'AM',
  'RW',
  'LW',
  'ST',
];

const ROLE_COMPAT: Record<CanonicalTacticalRole, Partial<Record<CanonicalTacticalRole, number>>> = {
  GK: { GK: 1.0 },
  RB: { RB: 1.0, RWB: 0.92, RCB: 0.74, CCB: 0.48, LCB: 0.45, LB: 0.72, LWB: 0.65, RW: 0.55, DM: 0.45, CM: 0.35 },
  RWB: { RWB: 1.0, RB: 0.92, RW: 0.72, RCB: 0.58, LB: 0.65, LWB: 0.72, CM: 0.42, DM: 0.38 },
  RCB: { RCB: 1.0, CCB: 0.94, LCB: 0.88, RB: 0.72, RWB: 0.55, LB: 0.45, DM: 0.48, CM: 0.30 },
  CCB: { CCB: 1.0, RCB: 0.94, LCB: 0.94, RB: 0.48, LB: 0.48, DM: 0.50, CM: 0.30 },
  LCB: { LCB: 1.0, CCB: 0.94, RCB: 0.88, LB: 0.72, LWB: 0.55, RB: 0.45, DM: 0.48, CM: 0.30 },
  LB: { LB: 1.0, LWB: 0.92, LCB: 0.74, CCB: 0.48, RCB: 0.45, RB: 0.72, RWB: 0.65, LW: 0.55, DM: 0.45, CM: 0.35 },
  LWB: { LWB: 1.0, LB: 0.92, LW: 0.72, LCB: 0.58, RB: 0.65, RWB: 0.72, CM: 0.42, DM: 0.38 },
  DM: { DM: 1.0, CM: 0.88, AM: 0.58, RCB: 0.48, CCB: 0.48, LCB: 0.48, RB: 0.38, LB: 0.38, RW: 0.30, LW: 0.30 },
  CM: { CM: 1.0, DM: 0.86, AM: 0.82, RW: 0.52, LW: 0.52, RWB: 0.40, LWB: 0.40, RB: 0.32, LB: 0.32, ST: 0.25 },
  AM: { AM: 1.0, RW: 0.84, LW: 0.84, CM: 0.80, ST: 0.58, DM: 0.52, RWB: 0.35, LWB: 0.35 },
  RW: { RW: 1.0, AM: 0.84, LW: 0.84, RWB: 0.60, ST: 0.56, CM: 0.48, LWB: 0.42, RB: 0.36 },
  LW: { LW: 1.0, AM: 0.84, RW: 0.84, LWB: 0.60, ST: 0.56, CM: 0.48, RWB: 0.42, LB: 0.36 },
  ST: { ST: 1.0, AM: 0.54, RW: 0.52, LW: 0.52, CM: 0.22 },
};

function getCompat(src: CanonicalTacticalRole, dst: CanonicalTacticalRole): number {
  if (src === dst) return 1.0;
  return ROLE_COMPAT[src]?.[dst] ?? 0.08;
}

function getLineGroup(role: CanonicalTacticalRole): 'GK' | 'DEF' | 'MID' | 'FWD' {
  if (role === 'GK') return 'GK';
  if (
    role === 'RB' ||
    role === 'RWB' ||
    role === 'RCB' ||
    role === 'CCB' ||
    role === 'LCB' ||
    role === 'LB' ||
    role === 'LWB'
  ) {
    return 'DEF';
  }
  if (role === 'ST') return 'FWD';
  return 'MID';
}

function sigmoid(x: number): number {
  if (x >= 18) return 0.99999998;
  if (x <= -18) return 0.00000002;
  return 1 / (1 + Math.exp(-x));
}

function parsePosInfoVector(posInfo: string | undefined, fplPos: PositionType): Record<CanonicalTacticalRole, number> {
  const info = (posInfo || '').toLowerCase();
  let raw: Partial<Record<CanonicalTacticalRole, number>>;

  if (info.includes('goalkeeper')) raw = { GK: 1.0 };
  else if (info.includes('right full back') || info.includes('right back')) raw = { RB: 0.96, RWB: 0.90, RCB: 0.65, RW: 0.50 };
  else if (info.includes('left full back') || info.includes('left back')) raw = { LB: 0.96, LWB: 0.90, LCB: 0.65, LW: 0.50 };
  else if (info.includes('wing back')) {
    if (info.includes('right')) raw = { RWB: 0.96, RB: 0.90, RW: 0.68 };
    else if (info.includes('left')) raw = { LWB: 0.96, LB: 0.90, LW: 0.68 };
    else raw = { RWB: 0.85, LWB: 0.85, RB: 0.75, LB: 0.75 };
  } else if (info.includes('central defender')) {
    if (info.includes('left')) raw = { LCB: 0.95, CCB: 0.90, RCB: 0.82, LB: 0.68 };
    else if (info.includes('right')) raw = { RCB: 0.95, CCB: 0.90, LCB: 0.82, RB: 0.68 };
    else raw = { CCB: 0.92, RCB: 0.92, LCB: 0.92, RB: 0.55, LB: 0.55, DM: 0.42 };
  } else if (info.includes('defensive midfielder')) {
    raw = { DM: 0.96, CM: 0.84, AM: 0.52, RCB: 0.45, CCB: 0.45, LCB: 0.45 };
  } else if (info.includes('attacking midfielder')) {
    if (info.includes('right')) raw = { AM: 0.92, RW: 0.88, LW: 0.72, CM: 0.72, ST: 0.55 };
    else if (info.includes('left')) raw = { AM: 0.92, LW: 0.88, RW: 0.72, CM: 0.72, ST: 0.55 };
    else raw = { AM: 0.95, CM: 0.78, RW: 0.76, LW: 0.76, ST: 0.55 };
  } else if (info.includes('central midfielder')) {
    raw = { CM: 0.94, DM: 0.84, AM: 0.74, RW: 0.45, LW: 0.45 };
  } else if (info.includes('winger')) {
    if (info.includes('left') && info.includes('right')) raw = { RW: 0.90, LW: 0.90, AM: 0.80, ST: 0.55, RWB: 0.52, LWB: 0.52 };
    else if (info.includes('right')) raw = { RW: 0.96, LW: 0.80, AM: 0.80, ST: 0.55, RWB: 0.55 };
    else if (info.includes('left')) raw = { LW: 0.96, RW: 0.80, AM: 0.80, ST: 0.55, LWB: 0.55 };
    else raw = { RW: 0.88, LW: 0.88, AM: 0.78, ST: 0.52 };
  } else if (info.includes('striker') || info.includes('forward')) {
    if (info.includes('second')) raw = { ST: 0.84, AM: 0.82, RW: 0.72, LW: 0.72 };
    else raw = { ST: 0.96, AM: 0.52, RW: 0.50, LW: 0.50 };
  } else if (fplPos === 'GKP') {
    raw = { GK: 1.0 };
  } else if (fplPos === 'DEF') {
    raw = { RCB: 0.78, CCB: 0.78, LCB: 0.78, RB: 0.72, LB: 0.72, RWB: 0.66, LWB: 0.66 };
  } else if (fplPos === 'MID') {
    raw = { DM: 0.74, CM: 0.78, AM: 0.78, RW: 0.72, LW: 0.72 };
  } else {
    raw = { ST: 0.94, AM: 0.50, RW: 0.48, LW: 0.48 };
  }

  const out = {} as Record<CanonicalTacticalRole, number>;
  out.GK = fplPos === 'GKP' ? 1.0 : 0.0;
  for (const targetRole of ALL_OUTFIELD_ROLES) {
    let best = 0.08;
    for (const [k, w] of Object.entries(raw)) {
      best = Math.max(best, (w || 0) * getCompat(k as CanonicalTacticalRole, targetRole));
    }
    out[targetRole] = best;
  }
  return out;
}

function resolveFallbackGwKickoffMs(gw: number): number {
  return Date.UTC(2026, 7, 22, 14, 0, 0) + Math.max(0, gw - 1) * 7 * 86400_000;
}

/**
 * Builds chronological match-level club histories strictly up to `upToGw` for EPL
 * and merges optional Non-EPL cross-competition club sides sorted by `kickoffMs`.
 */
export function buildHybridHistoryStore(
  matchesByGw: Record<number, any[]>,
  upToGw: number,
  playerPositionInfoSeed?: Record<number, string>,
  precalcPlayers?: Record<string, Record<string, { mins?: number; wasStarter?: boolean; wasSub?: boolean }>>,
  playerTeamMap?: Map<number, string>,
  extraAllCompSides?: HybridMatchClubSide[]
): HybridHistoryStore {
  const eplClubSides: Record<string, HybridMatchClubSide[]> = {};
  const allCompClubSides: Record<string, HybridMatchClubSide[]> = {};
  const eplKickoffMsByGwClub: Record<string, number> = {};
  const playerPosInfo: Record<number, string> = { ...(playerPositionInfoSeed || {}) };
  const coveredClubGw = new Set<string>();

  const pushAllCompSide = (clubShort: string, side: HybridMatchClubSide) => {
    if (!allCompClubSides[clubShort]) allCompClubSides[clubShort] = [];
    allCompClubSides[clubShort].push(side);
  };

  const ingestSide = (
    gw: number,
    kickoffMs: number,
    clubShort: string,
    oppShort: string,
    isHome: boolean,
    formationRaw: any,
    rowsRaw: any,
    lineup?: any[],
    bench?: any[]
  ) => {
    if (!clubShort) return;
    if (Number.isFinite(kickoffMs) && kickoffMs > 0) {
      eplKickoffMsByGwClub[`${gw}_${clubShort}`] = kickoffMs;
    }

    for (const lp of [...(lineup || []), ...(bench || [])]) {
      if (!lp?.id) continue;
      const infoStr = lp.pulse_position_info || lp.position_info;
      if (infoStr && !playerPosInfo[lp.id]) {
        playerPosInfo[lp.id] = infoStr;
      }
    }

    const label = typeof formationRaw === 'string' ? formationRaw : formationRaw?.label;
    const rows: number[][] | undefined = Array.isArray(rowsRaw)
      ? rowsRaw
      : formationRaw && typeof formationRaw === 'object'
      ? formationRaw.rows
      : undefined;

    const starterIds: number[] = [];
    const starterRoles: Record<number, CanonicalTacticalRole> = {};
    const subOnIds: number[] = [];
    const unusedBenchIds: number[] = [];
    const minutesByPlayer: Record<number, number> = {};

    const hasLineup = Array.isArray(lineup) && lineup.length > 0;
    if (!hasLineup) return;

    for (const lp of lineup || []) {
      if (!lp?.id) continue;
      starterIds.push(lp.id);
      minutesByPlayer[lp.id] = Number(lp.stats?.minutes ?? lp.minutes ?? 90);
    }

    for (const bp of bench || []) {
      if (!bp?.id) continue;
      const mins = Number(bp.stats?.minutes ?? bp.minutes ?? 0);
      minutesByPlayer[bp.id] = mins;
      if (mins > 0) subOnIds.push(bp.id);
      else unusedBenchIds.push(bp.id);
    }

    let outfieldSlots: CanonicalTacticalRole[] | undefined;
    if (label && Array.isArray(rows) && rows.length >= 3) {
      const rowLengths = rows.map((r) => r.length);
      const roleMatrix = getFormationRoleMatrix(label, rowLengths);
      const slotsOut: CanonicalTacticalRole[] = [];
      rows.forEach((rowIds, rIdx) => {
        const roleRow = roleMatrix[rIdx] || [];
        rowIds.forEach((pId, cIdx) => {
          const role = roleRow[cIdx] || (rIdx === 0 ? 'GK' : 'CM');
          if (rIdx > 0) slotsOut.push(role);
          if (pId > 0) starterRoles[pId] = role;
        });
      });
      if (slotsOut.length === 10) outfieldSlots = slotsOut;
    } else if (label) {
      const inferred = getFormationOutfieldSlots(label);
      if (inferred.length === 10) outfieldSlots = inferred;
    }

    const side: HybridMatchClubSide = {
      gw,
      eplGw: gw,
      compAbbr: 'EN_PR',
      compWeight: 1.0,
      kickoffMs,
      clubShort,
      isHome,
      oppShort,
      formationLabel: label || undefined,
      outfieldSlots,
      starterIds,
      starterRoles,
      subOnIds,
      unusedBenchIds,
      minutesByPlayer,
    };

    if (!eplClubSides[clubShort]) eplClubSides[clubShort] = [];
    eplClubSides[clubShort].push(side);
    pushAllCompSide(clubShort, side);
    coveredClubGw.add(`${clubShort}_${gw}`);
  };

  for (let gw = 1; gw <= upToGw; gw++) {
    const matches = matchesByGw[gw] || [];
    for (const m of matches) {
      if (!m) continue;
      const hShort = m.home_team?.short_name || '';
      const aShort = m.away_team?.short_name || '';
      const parsedKo = m.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
      const koMs = Number.isFinite(parsedKo) && parsedKo > 0 ? parsedKo : resolveFallbackGwKickoffMs(gw);
      ingestSide(gw, koMs, hShort, aShort, true, m.home_formation, m.home_formation_rows, m.home_lineup, m.home_bench);
      ingestSide(gw, koMs, aShort, hShort, false, m.away_formation, m.away_formation_rows, m.away_lineup, m.away_bench);
    }
  }

  if (precalcPlayers && playerTeamMap) {
    for (let gw = 1; gw <= upToGw; gw++) {
      const byTeam = new Map<string, HybridMatchClubSide>();
      const fallbackKoMs = resolveFallbackGwKickoffMs(gw);
      for (const [idStr, gwMap] of Object.entries(precalcPlayers)) {
        const pId = Number(idStr);
        const team = playerTeamMap.get(pId);
        if (!team || coveredClubGw.has(`${team}_${gw}`)) continue;
        const st = gwMap[String(gw)];
        if (!st) continue;
        let side = byTeam.get(team);
        if (!side) {
          side = {
            gw,
            eplGw: gw,
            compAbbr: 'EN_PR',
            compWeight: 1.0,
            kickoffMs: eplKickoffMsByGwClub[`${gw}_${team}`] || fallbackKoMs,
            clubShort: team,
            isHome: true,
            oppShort: '',
            starterIds: [],
            starterRoles: {},
            subOnIds: [],
            unusedBenchIds: [],
            minutesByPlayer: {},
          };
          byTeam.set(team, side);
        }
        const mins = Number(st.mins || 0);
        side.minutesByPlayer[pId] = mins;
        if (st.wasStarter) side.starterIds.push(pId);
        else if (st.wasSub || mins > 0) side.subOnIds.push(pId);
        else side.unusedBenchIds.push(pId);
      }
      for (const [team, side] of byTeam.entries()) {
        if (side.starterIds.length > 0) {
          if (!eplClubSides[team]) eplClubSides[team] = [];
          eplClubSides[team].push(side);
          pushAllCompSide(team, side);
          coveredClubGw.add(`${team}_${gw}`);
        }
      }
    }
  }

  // Merge Non-EPL cross-competition club sides chronologically
  if (Array.isArray(extraAllCompSides) && extraAllCompSides.length > 0) {
    for (const extra of extraAllCompSides) {
      if (!extra || !extra.clubShort || extra.compAbbr === 'EN_PR') continue;
      if (!extra.kickoffMs || !Number.isFinite(extra.kickoffMs)) continue;
      if (extra.playerPosInfo) {
        for (const [idStr, info] of Object.entries(extra.playerPosInfo)) {
          const pId = Number(idStr);
          if (pId > 0 && info && !playerPosInfo[pId]) {
            playerPosInfo[pId] = info;
          }
        }
      }
      const compAbbr = extra.compAbbr || 'EU_CL';
      pushAllCompSide(extra.clubShort, {
        ...extra,
        eplGw: null,
        compAbbr,
        compWeight: extra.compWeight ?? CROSS_COMP_WEIGHTS[compAbbr] ?? 0.5,
      });
    }
  }

  for (const sides of Object.values(eplClubSides)) {
    sides.sort((a, b) => a.gw - b.gw || (a.kickoffMs || 0) - (b.kickoffMs || 0));
  }
  for (const sides of Object.values(allCompClubSides)) {
    sides.sort((a, b) => (a.kickoffMs || 0) - (b.kickoffMs || 0) || a.gw - b.gw);
  }

  return {
    maxGw: upToGw,
    clubSides: eplClubSides,
    eplClubSides,
    allCompClubSides,
    eplKickoffMsByGwClub,
    playerPosInfo,
  };
}

/**
 * Resolves strict zero-leakage player availability entering `targetGw`.
 */
export function resolveCausalPlayerAvailability(params: {
  player: DbPlayerStat;
  targetGw: number;
  mode: 'future' | 'historical';
  isCurrentGwFinishedOrConfirmed?: boolean;
  earliestKickoffIso?: string;
  gwDeadlineIso?: string;
}): CausalAvailability {
  const {
    player,
    mode,
    isCurrentGwFinishedOrConfirmed = true,
    earliestKickoffIso,
    gwDeadlineIso,
  } = params;

  const rawStatus = (player.status || 'a').toLowerCase();
  const rawNews = player.news || '';
  const isNewsSuspended = /suspende/i.test(rawNews);
  const chanceThis = (player as any).chanceOfPlayingThisRound as number | null | undefined;
  const chanceNext = player.chanceOfPlayingNextRound as number | null | undefined;

  if (mode === 'historical') {
    if (!gwDeadlineIso || !player.newsAdded) {
      return { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
    }
    const newsMs = Date.parse(player.newsAdded);
    const deadlineMs = Date.parse(gwDeadlineIso);
    if (!Number.isFinite(newsMs) || !Number.isFinite(deadlineMs) || newsMs > deadlineMs) {
      return { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
    }

    if (rawStatus === 'a' && !rawNews && chanceThis !== 0 && chanceNext !== 0) {
      return { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
    }

    const refDate = new Date(deadlineMs);
    const returnDate = parseExpectedReturnDate(rawNews, refDate);
    const matchMs = earliestKickoffIso ? Date.parse(earliestKickoffIso) : deadlineMs + 24 * 3600 * 1000;

    if (rawStatus === 'u') {
      return { avail: 0.0, absen: 1.0, status: 'u', chance: 0, expectedReturnDate: null };
    }
    if (rawStatus === 's' || isNewsSuspended) {
      if (returnDate && Number.isFinite(matchMs) && matchMs >= returnDate.getTime()) {
        return { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: returnDate.toISOString() };
      }
      return { avail: 0.0, absen: 1.0, status: 's', chance: 0, expectedReturnDate: returnDate ? returnDate.toISOString() : null };
    }
    if (rawStatus === 'i') {
      if (returnDate && Number.isFinite(matchMs)) {
        if (matchMs < returnDate.getTime()) {
          return { avail: 0.0, absen: 1.0, status: 'i', chance: 0, expectedReturnDate: returnDate.toISOString() };
        }
        const firstWeekBack = matchMs - returnDate.getTime() < 7 * 24 * 3600 * 1000;
        return {
          avail: firstWeekBack ? 0.75 : 1.0,
          absen: firstWeekBack ? 0.25 : 0.0,
          status: firstWeekBack ? 'd' : 'a',
          chance: firstWeekBack ? 75 : 100,
          expectedReturnDate: returnDate.toISOString(),
        };
      }
      return { avail: 0.0, absen: 1.0, status: 'i', chance: 0, expectedReturnDate: null };
    }
    if (returnDate && Number.isFinite(matchMs) && matchMs < returnDate.getTime()) {
      return { avail: 0.0, absen: 1.0, status: 'i', chance: 0, expectedReturnDate: returnDate.toISOString() };
    }

    const effChance = chanceNext ?? chanceThis;
    if (effChance === 0) return { avail: 0.0, absen: 1.0, status: rawStatus || 'i', chance: 0, expectedReturnDate: returnDate ? returnDate.toISOString() : null };
    if (effChance === 25) return { avail: 0.25, absen: 0.75, status: 'd', chance: 25, expectedReturnDate: null };
    if (effChance === 50) return { avail: 0.50, absen: 0.50, status: 'd', chance: 50, expectedReturnDate: null };
    if (effChance === 75) return { avail: 0.75, absen: 0.25, status: 'd', chance: 75, expectedReturnDate: null };
    return { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
  }

  const effectiveChance: number | null = isCurrentGwFinishedOrConfirmed
    ? (chanceNext !== null && chanceNext !== undefined ? chanceNext : chanceThis ?? null)
    : (chanceThis !== null && chanceThis !== undefined ? chanceThis : chanceNext ?? null);

  const returnDate = parseExpectedReturnDate(rawNews);
  let isBeforeReturnDate = false;
  let hasPassedReturnDate = false;
  if (returnDate && earliestKickoffIso) {
    const matchTime = new Date(earliestKickoffIso);
    if (!isNaN(matchTime.getTime())) {
      if (matchTime < returnDate) isBeforeReturnDate = true;
      else hasPassedReturnDate = true;
    }
  }

  let effectiveStatus = rawStatus;
  let isSuspended = rawStatus === 's' || isNewsSuspended;
  if (isSuspended && isCurrentGwFinishedOrConfirmed && chanceNext === 100) {
    isSuspended = false;
    effectiveStatus = 'a';
  }

  let avail = 1.0;
  if (effectiveStatus === 'u') {
    avail = 0.0;
  } else if (isSuspended) {
    avail = 0.0;
    effectiveStatus = 's';
  } else if (effectiveStatus === 'i') {
    if (hasPassedReturnDate) {
      avail = 0.75;
      effectiveStatus = 'd';
    } else {
      avail = 0.0;
      effectiveStatus = 'i';
    }
  } else if (isBeforeReturnDate) {
    avail = 0.0;
    effectiveStatus = 'i';
  } else if (effectiveChance === 0) {
    avail = 0.0;
  } else if (effectiveChance === 25) {
    avail = 0.25;
    effectiveStatus = 'd';
  } else if (effectiveChance === 50) {
    avail = 0.50;
    effectiveStatus = 'd';
  } else if (effectiveChance === 75) {
    avail = 0.75;
    effectiveStatus = 'd';
  } else {
    avail = 1.0;
    effectiveStatus = 'a';
  }

  return {
    avail,
    absen: 1.0 - avail,
    status: effectiveStatus,
    chance: avail === 0 ? 0 : effectiveChance ?? null,
    expectedReturnDate: returnDate ? returnDate.toISOString() : null,
  };
}

export interface PlayerFeaturesAtGw {
  id: number;
  teamShort: string;
  position: PositionType;
  nowCost: number;
  priorRate: number;
  nClub: number;
  nObs: number;
  // Pure EPL counts & rates (for UI/Review compatibility & EPL track)
  startsCount: number;
  subCount: number;
  unusedCount: number;
  benchCount: number;
  inSquadCount: number;
  startRate: number;
  ebStartRate: number;
  minAvg: number;
  subOnRate: number;
  benchAppRate: number;
  inSquadRate: number;
  benchPrev1: number;
  benchPrev2: number;
  startedPrev1: number;
  startedPrev2: number;
  prev1EplMins: number;
  // Chronological 7-Comp features (Clean14 + prev1EplMins)
  allCompStartRate: number;
  allCompEbStartRate: number;
  allCompMinAvg: number;
  dMin: number;
  kalmanState: number;
  inSquadAllRate: number;
  allBenchRate: number;
  benchPrev1Any: number;
  benchPrev2Any: number;
  fatigue72h: number;
  uefaRestedPen: number;
  roleAffinity: Record<CanonicalTacticalRole, number>;
  topRole: CanonicalTacticalRole;
  maxAffinity: number;
  compRole: number; // filled at club level
}

function resolveTargetCutoffMs(
  clubShort: string,
  targetGw: number,
  history: HybridHistoryStore,
  explicitCutoffMs?: number,
  deadlines?: Record<string, string>
): number {
  if (explicitCutoffMs && Number.isFinite(explicitCutoffMs) && explicitCutoffMs > 0) {
    return explicitCutoffMs;
  }
  const byHistory = history.eplKickoffMsByGwClub?.[`${targetGw}_${clubShort}`];
  if (byHistory && Number.isFinite(byHistory) && byHistory > 0) {
    return byHistory;
  }
  const dlIso = deadlines?.[String(targetGw)];
  if (dlIso) {
    const parsedDl = Date.parse(dlIso);
    if (Number.isFinite(parsedDl) && parsedDl > 0) return parsedDl + 12 * 3600_000;
  }
  return resolveFallbackGwKickoffMs(targetGw);
}

function getCausalAllCompSides(
  history: HybridHistoryStore,
  clubShort: string,
  targetGw: number,
  targetCutoffMs: number
): HybridMatchClubSide[] {
  const source = history.allCompClubSides?.[clubShort] || history.clubSides[clubShort] || [];
  return source.filter((s) => {
    const isEpl = !s.compAbbr || s.compAbbr === 'EN_PR';
    if (isEpl) return (s.eplGw ?? s.gw) < targetGw;
    return Boolean(s.kickoffMs && s.kickoffMs > 0 && s.kickoffMs < targetCutoffMs);
  });
}

function getCausalEplSides(
  history: HybridHistoryStore,
  clubShort: string,
  targetGw: number
): HybridMatchClubSide[] {
  const source = history.eplClubSides?.[clubShort] || history.clubSides[clubShort] || [];
  return source.filter((s) => (!s.compAbbr || s.compAbbr === 'EN_PR') && (s.eplGw ?? s.gw) < targetGw);
}

function computePlayerPriorRate(p: DbPlayerStat, pastMap: Record<string, PastSeasonMinutesRecord>): number {
  const past = pastMap[String(p.id)];
  if (past && past.minutes > 0) {
    return Math.min(0.95, Math.max(0.06, past.minutes / 3420));
  }
  const costMil = (p.nowCost || 50) / 10;
  if (p.position === 'GKP') return costMil >= 5.0 ? 0.78 : costMil >= 4.5 ? 0.45 : 0.08;
  if (p.position === 'DEF') return costMil >= 5.5 ? 0.75 : costMil >= 4.5 ? 0.48 : 0.14;
  if (p.position === 'MID') return costMil >= 7.5 ? 0.78 : costMil >= 5.5 ? 0.52 : 0.14;
  return costMil >= 7.5 ? 0.80 : costMil >= 5.5 ? 0.48 : 0.14;
}

export function extractPlayerFeaturesBeforeGw(
  player: DbPlayerStat,
  targetGw: number,
  history: HybridHistoryStore,
  pastMap: Record<string, PastSeasonMinutesRecord>,
  decay: number,
  mShrink: number,
  kalmanGain: number,
  priorAffCache?: Map<number, Record<CanonicalTacticalRole, number>>,
  opts?: {
    halfLifeDays?: number;
    roleDecayDays?: number;
    rolePriorStrength?: number;
    targetCutoffMs?: number;
    deadlines?: Record<string, string>;
  }
): PlayerFeaturesAtGw {
  const halfLifeDays = opts?.halfLifeDays ?? DEFAULT_HYBRID_PARAMS.halfLifeDays;
  const roleDecayDays = opts?.roleDecayDays ?? DEFAULT_HYBRID_PARAMS.roleDecayDays;
  const rolePriorStrength = opts?.rolePriorStrength ?? DEFAULT_HYBRID_PARAMS.rolePriorStrength;
  const targetCutoffMs = resolveTargetCutoffMs(
    player.teamShort,
    targetGw,
    history,
    opts?.targetCutoffMs,
    opts?.deadlines
  );

  const eplSides = getCausalEplSides(history, player.teamShort, targetGw);
  const allSides = getCausalAllCompSides(history, player.teamShort, targetGw, targetCutoffMs);

  const fplPos = (player.position || 'MID') as PositionType;
  const priorRate = computePlayerPriorRate(player, pastMap);

  let priorRoleVec = priorAffCache?.get(player.id);
  if (!priorRoleVec) {
    const posInfo = history.playerPosInfo[player.id] || player.pulsePositionInfo;
    priorRoleVec = parsePosInfoVector(posInfo, fplPos);
    priorAffCache?.set(player.id, priorRoleVec);
  }

  // --- Track 1: Pure EPL historical features ---
  const nClub = eplSides.length;
  let wEplSum = 0;
  let wEplStart = 0;
  let wEplMin = 0;
  let wEplSubOn = 0;
  let wEplBench = 0;
  let wEplSquad = 0;

  let startsCount = 0;
  let subCount = 0;
  let unusedCount = 0;
  let inSquadCount = 0;

  let startedPrev1 = 0;
  let startedPrev2 = 0;
  let benchPrev1 = 0;
  let benchPrev2 = 0;

  for (let idx = 0; idx < eplSides.length; idx++) {
    const side = eplSides[idx];
    const age = Math.max(0, targetGw - 1 - (side.eplGw ?? side.gw));
    const w = Math.pow(decay, age);
    wEplSum += w;

    const didStart = side.starterIds.includes(player.id);
    const didSub = !didStart && side.subOnIds.includes(player.id);
    const didUnused = !didStart && !didSub && side.unusedBenchIds.includes(player.id);
    const onBench = didSub || didUnused;
    const inSq = didStart || onBench;
    const mins = side.minutesByPlayer[player.id] ?? (didStart ? 82 : 0);

    if (didStart) {
      startsCount++;
      wEplStart += w;
    }
    if (didSub) {
      subCount++;
      wEplSubOn += w;
    }
    if (didUnused) unusedCount++;
    if (onBench) wEplBench += w;
    if (inSq) {
      inSquadCount++;
      wEplSquad += w;
    }
    wEplMin += w * mins;

    const sGw = side.eplGw ?? side.gw;
    if (sGw === targetGw - 1) {
      if (didStart) startedPrev1 = 1;
      else if (onBench) benchPrev1 = 1;
    }
    if (sGw === targetGw - 2) {
      if (didStart) startedPrev2 = 1;
      else if (onBench) benchPrev2 = 1;
    }
  }

  const prevEpl = eplSides.length > 0 ? eplSides[eplSides.length - 1] : undefined;
  const prev1EplMins = prevEpl ? (prevEpl.minutesByPlayer[player.id] ?? 0) / 90 : priorRate;

  const startRate = wEplSum > 0 ? wEplStart / wEplSum : priorRate;
  const minAvg = wEplSum > 0 ? wEplMin / wEplSum : priorRate * 75;
  const subOnRate = wEplSum > 0 ? wEplSubOn / wEplSum : 0.06;
  const benchAppRate = wEplSum > 0 ? wEplBench / wEplSum : 0.15;
  const inSquadRate = wEplSum > 0 ? wEplSquad / wEplSum : Math.min(0.95, priorRate + 0.15);
  const ebStartRate = (nClub * startRate + mShrink * priorRate) / (nClub + mShrink);

  // --- Track 2: Chronological 7-Competition features (kickoffMs < targetCutoffMs) ---
  let wAllSum = 0;
  let wAllStart = 0;
  let wAllMin = 0;
  let wAllBench = 0;
  let wAllSquad = 0;
  let nAllEff = 0;
  let kalmanAll = priorRate;
  let recentMinSum = 0;
  let recentW = 0;
  let roleWeightSum = 0;
  let allRoleObs = 0;
  let fatigue72h = 0;
  const roleObsWeights: Partial<Record<CanonicalTacticalRole, number>> = {};

  for (let idx = 0; idx < allSides.length; idx++) {
    const side = allSides[idx];
    const sideKo = side.kickoffMs && side.kickoffMs > 0 ? side.kickoffMs : resolveFallbackGwKickoffMs(side.gw);
    const daysAgo = Math.max(0, (targetCutoffMs - sideKo) / 86400_000);
    const hoursAgo = (targetCutoffMs - sideKo) / 3600_000;
    const cw = side.compWeight ?? CROSS_COMP_WEIGHTS[side.compAbbr || 'EN_PR'] ?? 0.5;
    const w = Math.pow(0.5, daysAgo / Math.max(1, halfLifeDays)) * cw;

    wAllSum += w;
    nAllEff += cw;

    const didStart = side.starterIds.includes(player.id);
    const didSub = !didStart && side.subOnIds.includes(player.id);
    const didUnused = !didStart && !didSub && side.unusedBenchIds.includes(player.id);
    const onBench = didSub || didUnused;
    const inSq = didStart || onBench;
    const mins = side.minutesByPlayer[player.id] ?? (didStart ? 82 : 0);

    if (didStart) wAllStart += w;
    if (onBench) wAllBench += w;
    if (inSq) wAllSquad += w;
    wAllMin += w * mins;

    if (daysAgo <= 14) {
      recentMinSum += cw * mins;
      recentW += cw;
    }

    const obsY = didStart ? 1.0 : didSub ? 0.22 : didUnused ? 0.04 : 0.0;
    kalmanAll = kalmanAll + kalmanGain * cw * (obsY - kalmanAll);

    const obsRole = side.starterRoles[player.id];
    if (obsRole && obsRole !== 'GK') {
      const rw = Math.pow(0.5, daysAgo / Math.max(1, roleDecayDays)) * cw;
      roleWeightSum += rw;
      roleObsWeights[obsRole] = (roleObsWeights[obsRole] || 0) + rw;
      allRoleObs++;
    }

    if (hoursAgo > 0 && hoursAgo < 72 && mins >= 60) {
      fatigue72h = Math.max(fatigue72h, Math.min(1.0, mins / 90));
    }
  }

  const allCompStartRate = wAllSum > 0 ? wAllStart / wAllSum : priorRate;
  const allCompEbStartRate = (nAllEff * allCompStartRate + mShrink * priorRate) / (nAllEff + mShrink);
  const allCompMinAvg = wAllSum > 0 ? wAllMin / wAllSum : priorRate * 75;
  const recentMinAvg = recentW > 0 ? recentMinSum / recentW : allCompMinAvg;
  const dMin = recentMinAvg - allCompMinAvg;
  const inSquadAllRate = wAllSum > 0 ? wAllSquad / wAllSum : Math.min(0.95, priorRate + 0.15);
  const allBenchRate = wAllSum > 0 ? wAllBench / wAllSum : 0.15;

  const prevAny1 = allSides.length > 0 ? allSides[allSides.length - 1] : undefined;
  const prevAny2 = allSides.length > 1 ? allSides[allSides.length - 2] : undefined;
  const benchPrev1Any =
    prevAny1 &&
    !prevAny1.starterIds.includes(player.id) &&
    (prevAny1.subOnIds.includes(player.id) || prevAny1.unusedBenchIds.includes(player.id))
      ? 1
      : 0;
  const benchPrev2Any =
    prevAny2 &&
    !prevAny2.starterIds.includes(player.id) &&
    (prevAny2.subOnIds.includes(player.id) || prevAny2.unusedBenchIds.includes(player.id))
      ? 1
      : 0;

  let uefaRestedPen = 0;
  const prevEplKo = prevEpl?.kickoffMs || 0;
  const majorMidweek = allSides.filter(
    (s) => s.compAbbr && s.compAbbr !== 'EN_PR' && s.compAbbr !== 'EN_LC' && (!prevEpl || (s.kickoffMs || 0) > prevEplKo)
  );
  if (startedPrev1 && majorMidweek.length > 0) {
    const latestMid = majorMidweek[majorMidweek.length - 1];
    if (!latestMid.starterIds.includes(player.id) && (latestMid.minutesByPlayer[player.id] ?? 0) < 35) {
      uefaRestedPen = 1.0;
    }
  }

  const roleAffinity = {} as Record<CanonicalTacticalRole, number>;
  roleAffinity.GK = fplPos === 'GKP' ? 1.0 : 0.0;
  const nRoleObs = Object.keys(roleObsWeights).length > 0 ? allRoleObs : 0;
  const wHist = nRoleObs > 0 ? nRoleObs / (nRoleObs + rolePriorStrength) : 0;

  let topRole: CanonicalTacticalRole = fplPos === 'GKP' ? 'GK' : 'CM';
  let maxAffinity = fplPos === 'GKP' ? 1.0 : 0.08;
  for (const targetRole of ALL_OUTFIELD_ROLES) {
    let obsCompat = 0;
    if (roleWeightSum > 0) {
      for (const [rKey, rw] of Object.entries(roleObsWeights)) {
        obsCompat += ((rw || 0) / roleWeightSum) * getCompat(rKey as CanonicalTacticalRole, targetRole);
      }
    }
    const aff = wHist * obsCompat + (1 - wHist) * (priorRoleVec[targetRole] ?? 0.08);
    roleAffinity[targetRole] = aff;
    if (fplPos !== 'GKP' && aff > maxAffinity) {
      maxAffinity = aff;
      topRole = targetRole;
    }
  }

  return {
    id: player.id,
    teamShort: player.teamShort,
    position: fplPos,
    nowCost: (player.nowCost || 50) / 10,
    priorRate,
    nClub,
    nObs: startsCount,
    startsCount,
    subCount,
    unusedCount,
    benchCount: subCount + unusedCount,
    inSquadCount,
    startRate,
    ebStartRate,
    minAvg,
    subOnRate,
    benchAppRate,
    inSquadRate,
    benchPrev1,
    benchPrev2,
    startedPrev1,
    startedPrev2,
    prev1EplMins,
    allCompStartRate,
    allCompEbStartRate,
    allCompMinAvg,
    dMin,
    kalmanState: kalmanAll,
    inSquadAllRate,
    allBenchRate,
    benchPrev1Any,
    benchPrev2Any,
    fatigue72h,
    uefaRestedPen,
    roleAffinity,
    topRole,
    maxAffinity,
    compRole: 0,
  };
}

function populateClubCompRole(feats: PlayerFeaturesAtGw[], availMap?: Map<number, number>): void {
  for (let i = 0; i < feats.length; i++) {
    const fi = feats[i];
    let comp = 0;
    for (let j = 0; j < feats.length; j++) {
      if (i === j) continue;
      const fj = feats[j];
      if ((fi.position === 'GKP') !== (fj.position === 'GKP')) continue;
      const avJ = availMap ? (availMap.get(fj.id) ?? 1.0) : 1.0;
      if (avJ <= 0) continue;
      const compat = fi.position === 'GKP' ? 1.0 : getCompat(fj.topRole, fi.topRole);
      if (compat >= 0.45) {
        comp += avJ * fj.allCompEbStartRate * compat;
      }
    }
    fi.compRole = Math.min(2.0, comp / 2.2);
  }
}

function buildFeatureVector(f: PlayerFeaturesAtGw): number[] {
  return [
    1.0,
    f.allCompEbStartRate,
    f.ebStartRate,
    f.allCompMinAvg / 90,
    f.kalmanState,
    Math.max(-0.5, Math.min(0.5, f.dMin / 90)),
    f.maxAffinity,
    f.compRole,
    f.inSquadAllRate,
    f.startedPrev1,
    f.priorRate,
    Math.min(1.5, Math.max(0, (f.nowCost - 4.0) / 8.0)),
    f.fatigue72h,
    f.uefaRestedPen,
    f.prev1EplMins,
  ];
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    }
    [M[i], M[pivot]] = [M[pivot], M[i]];
    const diag = M[i][i];
    if (Math.abs(diag) < 1e-10) continue;
    for (let j = i; j <= n; j++) M[i][j] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = M[r][i];
      if (factor === 0) continue;
      for (let j = i; j <= n; j++) M[r][j] -= factor * M[i][j];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) > 1e-12 ? row[n] : 0));
}

function fitLogisticFromCachedFeatures(
  allPlayers: DbPlayerStat[],
  targetGw: number,
  history: HybridHistoryStore,
  featByGwPlayer: Map<number, Map<number, PlayerFeaturesAtGw>>,
  l2: number,
  deadlines?: Record<string, string>
): number[] {
  const dim = 15;
  const fallback = [-3.5, 1.2, 1.0, 1.4, 0.8, 0.1, 0.4, -0.2, 0.5, 0.2, 0.6, 0.4, -0.3, -0.1, 1.6];
  if (targetGw <= 2) return fallback;

  // Strictly EPL training labels
  const eplMap = history.eplClubSides || history.clubSides;
  const actualStarterByGwClub = new Map<string, Set<number>>();
  const playedClubsByGw = new Map<number, Set<string>>();
  for (const [clubShort, sides] of Object.entries(eplMap)) {
    for (const side of sides) {
      const sGw = side.eplGw ?? side.gw;
      if (sGw >= targetGw) continue;
      actualStarterByGwClub.set(`${sGw}_${clubShort}`, new Set(side.starterIds));
      let set = playedClubsByGw.get(sGw);
      if (!set) {
        set = new Set();
        playedClubsByGw.set(sGw, set);
      }
      set.add(clubShort);
    }
  }

  const samplesX: number[][] = [];
  const samplesY: number[] = [];
  const samplesW: number[] = [];

  for (let s = 2; s < targetGw; s++) {
    const clubsPlayed = playedClubsByGw.get(s);
    const featMap = featByGwPlayer.get(s);
    if (!clubsPlayed || !featMap) continue;
    const recencyW = Math.pow(0.88, targetGw - 1 - s);
    const dlIso = deadlines?.[String(s)];

    for (const p of allPlayers) {
      if (!clubsPlayed.has(p.teamShort)) continue;
      if (dlIso) {
        const koMs = history.eplKickoffMsByGwClub?.[`${s}_${p.teamShort}`];
        const av = resolveCausalPlayerAvailability({
          player: p,
          targetGw: s,
          mode: 'historical',
          earliestKickoffIso: koMs ? new Date(koMs).toISOString() : undefined,
          gwDeadlineIso: dlIso,
        });
        if (av.avail <= 0) continue;
      }
      const feat = featMap.get(p.id);
      if (!feat) continue;
      const started = actualStarterByGwClub.get(`${s}_${p.teamShort}`)?.has(p.id) ? 1 : 0;
      samplesX.push(buildFeatureVector(feat));
      samplesY.push(started);
      samplesW.push(recencyW);
    }
  }

  if (samplesX.length < 40) return fallback;

  const w = [...fallback];

  for (let iter = 0; iter < 8; iter++) {
    const H = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
    const g = new Array<number>(dim).fill(0);

    for (let idx = 0; idx < samplesX.length; idx++) {
      const x = samplesX[idx];
      const y = samplesY[idx];
      const sw = samplesW[idx];
      let z = 0;
      for (let d = 0; d < dim; d++) z += w[d] * x[d];
      const p = sigmoid(z);
      const err = sw * (p - y);
      const hess = sw * Math.max(1e-5, p * (1 - p));

      for (let d = 0; d < dim; d++) {
        g[d] += err * x[d];
        for (let k = d; k < dim; k++) {
          H[d][k] += hess * x[d] * x[k];
        }
      }
    }

    for (let d = 0; d < dim; d++) {
      const reg = d === 0 ? 0.02 : l2;
      g[d] += reg * w[d];
      H[d][d] += reg;
      for (let k = 0; k < d; k++) H[d][k] = H[k][d];
    }

    const step = solveLinearSystem(H, g);
    let maxStep = 0;
    for (let d = 0; d < dim; d++) {
      w[d] -= step[d];
      if (Math.abs(step[d]) > maxStep) maxStep = Math.abs(step[d]);
    }
    if (maxStep < 1e-4) break;
  }

  return w;
}

export function fitCausalLogisticCalibration(
  allPlayers: DbPlayerStat[],
  targetGw: number,
  history: HybridHistoryStore,
  pastMap: Record<string, PastSeasonMinutesRecord>,
  decay: number,
  mShrink: number,
  l2: number,
  kalmanGain: number,
  deadlines?: Record<string, string>,
  halfLifeDays: number = DEFAULT_HYBRID_PARAMS.halfLifeDays
): number[] {
  const priorAffCache = new Map<number, Record<CanonicalTacticalRole, number>>();
  const featByGwPlayer = new Map<number, Map<number, PlayerFeaturesAtGw>>();
  for (let s = 2; s < targetGw; s++) {
    const fMap = new Map<number, PlayerFeaturesAtGw>();
    const byClub = new Map<string, PlayerFeaturesAtGw[]>();
    for (const p of allPlayers) {
      const f = extractPlayerFeaturesBeforeGw(p, s, history, pastMap, decay, mShrink, kalmanGain, priorAffCache, {
        halfLifeDays,
        deadlines,
      });
      fMap.set(p.id, f);
      if (!byClub.has(p.teamShort)) byClub.set(p.teamShort, []);
      byClub.get(p.teamShort)!.push(f);
    }
    for (const cFeats of byClub.values()) populateClubCompRole(cFeats);
    featByGwPlayer.set(s, fMap);
  }
  return fitLogisticFromCachedFeatures(allPlayers, targetGw, history, featByGwPlayer, l2, deadlines);
}

export function predictCalibratedStartProb(feat: PlayerFeaturesAtGw, weights: number[]): number {
  const x = buildFeatureVector(feat);
  let z = 0;
  for (let d = 0; d < x.length; d++) z += (weights[d] || 0) * x[d];
  return sigmoid(z);
}

function applyClubSumLogitShrinkage(
  probs: Map<number, { pStartBase: number; pStartAvail: number; feat: PlayerFeaturesAtGw }>,
  outfieldIds: number[],
  shrinkage: number
): void {
  if (shrinkage <= 0 || outfieldIds.length < 10) return;
  let sumAvail = 0;
  let activeCount = 0;
  for (const id of outfieldIds) {
    const p = probs.get(id)?.pStartAvail ?? 0;
    if (p > 0) {
      sumAvail += p;
      activeCount++;
    }
  }
  if (activeCount < 10 || sumAvail <= 0.1) return;

  const targetSum = 10.0;
  let lo = -2.0;
  let hi = 2.0;
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) * 0.5;
    let sum = 0;
    for (const id of outfieldIds) {
      const p = probs.get(id)?.pStartAvail ?? 0;
      if (p <= 0) continue;
      const clamped = Math.min(0.999, Math.max(0.001, p));
      const logit = Math.log(clamped / (1 - clamped));
      sum += sigmoid(logit + mid);
    }
    if (sum > targetSum) hi = mid;
    else lo = mid;
  }

  const shift = shrinkage * ((lo + hi) * 0.5);
  for (const id of outfieldIds) {
    const cur = probs.get(id);
    if (!cur || cur.pStartAvail <= 0) continue;
    const clamped = Math.min(0.999, Math.max(0.001, cur.pStartAvail));
    const logit = Math.log(clamped / (1 - clamped));
    cur.pStartAvail = Math.min(0.99, Math.max(0.001, sigmoid(logit + shift)));
  }
}

/**
 * Resolves causal optimal parameters & fitted logistic weights entering `targetGw`
 * using memoized nested walk-forward evaluation over `s = 3..(targetGw - 1)`
 * with zero hardcode and zero data leakage.
 */
export function selectCausalHybridParamsAndWeights(
  allPlayers: DbPlayerStat[],
  clubs: string[],
  targetGw: number,
  history: HybridHistoryStore,
  pastMap: Record<string, PastSeasonMinutesRecord>,
  deadlines?: Record<string, string>,
  targetCutoffMsByClub?: Record<string, number>
): { params: HybridTuneParams; logitWeights: number[]; targetFeatMap?: Map<number, PlayerFeaturesAtGw> } {
  const base = { ...DEFAULT_HYBRID_PARAMS };
  const priorAffCache = new Map<number, Record<CanonicalTacticalRole, number>>();

  if (targetGw <= 3) {
    const wLogit = fitCausalLogisticCalibration(
      allPlayers,
      targetGw,
      history,
      pastMap,
      base.decay,
      base.mShrink,
      base.l2,
      base.kalmanGain,
      deadlines,
      base.halfLifeDays
    );
    const fMap = new Map<number, PlayerFeaturesAtGw>();
    const byClub = new Map<string, PlayerFeaturesAtGw[]>();
    for (const p of allPlayers) {
      const f = extractPlayerFeaturesBeforeGw(
        p,
        targetGw,
        history,
        pastMap,
        base.decay,
        base.mShrink,
        base.kalmanGain,
        priorAffCache,
        {
          halfLifeDays: base.halfLifeDays,
          roleDecayDays: base.roleDecayDays,
          rolePriorStrength: base.rolePriorStrength,
          targetCutoffMs: targetCutoffMsByClub?.[p.teamShort],
          deadlines,
        }
      );
      fMap.set(p.id, f);
      if (!byClub.has(p.teamShort)) byClub.set(p.teamShort, []);
      byClub.get(p.teamShort)!.push(f);
    }
    for (const cFeats of byClub.values()) populateClubCompRole(cFeats);
    return { params: base, logitWeights: wLogit, targetFeatMap: fMap };
  }

  const penaltyScale = 1 / Math.max(1, targetGw - 2);
  const eplMap = history.eplClubSides || history.clubSides;

  const actualSidesByKey = new Map<string, HybridMatchClubSide>();
  for (const c of clubs) {
    for (const s of eplMap[c] || []) {
      const sGw = s.eplGw ?? s.gw;
      if (sGw < targetGw) actualSidesByKey.set(`${sGw}_${c}`, s);
    }
  }

  // --- Stage 1: Formation parameters (using EPL + Major comps, strictly excluding EN_LC) ---
  const formCandidates: Array<Pick<HybridTuneParams, 'lambdaF' | 'venueBoost' | 'wV6'>> = [
    { lambdaF: 0.64, venueBoost: 0.05, wV6: 0.15 },
    { lambdaF: 0.58, venueBoost: 0.04, wV6: 0.0 },
    { lambdaF: 0.72, venueBoost: 0.05, wV6: 0.15 },
  ];

  let bestFormCand = formCandidates[0];
  let bestFormObj = -Infinity;
  for (const fc of formCandidates) {
    let hits = 0;
    let tot = 0;
    for (let s = 3; s < targetGw; s++) {
      for (const c of clubs) {
        const act = actualSidesByKey.get(`${s}_${c}`);
        if (!act?.formationLabel) continue;
        const cutoffMs = resolveTargetCutoffMs(c, s, history, act.kickoffMs, deadlines);
        const pred = predictFormationInternal(
          c,
          s,
          act.isHome,
          history,
          fc.lambdaF,
          fc.venueBoost,
          base.formHalfLifeDays,
          cutoffMs
        );
        if (pred?.label) {
          tot++;
          if (pred.label === act.formationLabel) hits++;
        }
      }
    }
    const priorDist =
      Math.abs(fc.lambdaF - base.lambdaF) + Math.abs(fc.venueBoost - base.venueBoost) + Math.abs(fc.wV6 - base.wV6);
    const obj = (tot > 0 ? hits / tot : 0) - 0.012 * penaltyScale * priorDist;
    if (obj > bestFormObj + 1e-9) {
      bestFormObj = obj;
      bestFormCand = fc;
    }
  }

  // --- Stage 2A: Causal C8+ Calibration (Half-Life [14, 21] x L2 [2.5, 3.0]) ---
  const featureRegimes: Array<{ halfLifeDays: number; decay: number; mShrink: number; kalmanGain: number }> = [
    { halfLifeDays: 14, decay: 0.78, mShrink: 1.5, kalmanGain: 0.48 },
    { halfLifeDays: 21, decay: 0.78, mShrink: 1.5, kalmanGain: 0.48 },
  ];
  const l2Grid = [2.5, 3.0];

  const playersByClub = new Map<string, DbPlayerStat[]>();
  for (const p of allPlayers) {
    if (!playersByClub.has(p.teamShort)) playersByClub.set(p.teamShort, []);
    playersByClub.get(p.teamShort)!.push(p);
  }

  let bestCalibCand: Pick<HybridTuneParams, 'halfLifeDays' | 'decay' | 'mShrink' | 'l2' | 'kalmanGain'> = {
    ...featureRegimes[0],
    l2: base.l2,
  };
  let bestCalibObj = -Infinity;
  let bestFeatByGwPlayer = new Map<number, Map<number, PlayerFeaturesAtGw>>();
  const bestWByS = new Map<number, number[]>();

  for (const fr of featureRegimes) {
    const featByGwPlayer = new Map<number, Map<number, PlayerFeaturesAtGw>>();
    for (let s = 2; s <= targetGw; s++) {
      const fMap = new Map<number, PlayerFeaturesAtGw>();
      const dlIso = deadlines?.[String(s)];
      for (const c of clubs) {
        const cPlayers = playersByClub.get(c) || [];
        const cFeats: PlayerFeaturesAtGw[] = [];
        const avMap = new Map<number, number>();
        const cutoffMs = resolveTargetCutoffMs(
          c,
          s,
          history,
          s === targetGw ? targetCutoffMsByClub?.[c] : undefined,
          deadlines
        );
        const koIso = cutoffMs > 0 ? new Date(cutoffMs).toISOString() : undefined;
        for (const p of cPlayers) {
          const f = extractPlayerFeaturesBeforeGw(p, s, history, pastMap, fr.decay, fr.mShrink, fr.kalmanGain, priorAffCache, {
            halfLifeDays: fr.halfLifeDays,
            roleDecayDays: base.roleDecayDays,
            rolePriorStrength: base.rolePriorStrength,
            targetCutoffMs: cutoffMs,
            deadlines,
          });
          fMap.set(p.id, f);
          cFeats.push(f);
          if (dlIso) {
            avMap.set(
              p.id,
              resolveCausalPlayerAvailability({
                player: p,
                targetGw: s,
                mode: 'historical',
                earliestKickoffIso: koIso,
                gwDeadlineIso: dlIso,
              }).avail
            );
          }
        }
        populateClubCompRole(cFeats, dlIso ? avMap : undefined);
      }
      featByGwPlayer.set(s, fMap);
    }

    for (const l2 of l2Grid) {
      let xiHitSum = 0;
      let clubEvalCount = 0;
      let logLossSum = 0;
      let playerEvalCount = 0;
      const wMapForCand = new Map<number, number[]>();

      for (let s = 3; s < targetGw; s++) {
        const wLogit = fitLogisticFromCachedFeatures(allPlayers, s, history, featByGwPlayer, l2, deadlines);
        wMapForCand.set(s, wLogit);
        const fMap = featByGwPlayer.get(s)!;
        const dlIso = deadlines?.[String(s)];

        for (const c of clubs) {
          const act = actualSidesByKey.get(`${s}_${c}`);
          if (!act) continue;
          const starterSet = new Set(act.starterIds);
          const cPlayers = playersByClub.get(c) || [];
          const scored: Array<{ id: number; pos: PositionType; pStart: number }> = [];
          const koMs = act.kickoffMs || history.eplKickoffMsByGwClub?.[`${s}_${c}`];
          const koIso = koMs ? new Date(koMs).toISOString() : undefined;

          for (const p of cPlayers) {
            const feat = fMap.get(p.id)!;
            const av = dlIso
              ? resolveCausalPlayerAvailability({
                  player: p,
                  targetGw: s,
                  mode: 'historical',
                  earliestKickoffIso: koIso,
                  gwDeadlineIso: dlIso,
                })
              : { avail: 1.0 };
            const prob = Math.min(0.999, Math.max(0.001, predictCalibratedStartProb(feat, wLogit) * av.avail));
            const y = starterSet.has(p.id) ? 1 : 0;
            logLossSum += -(y * Math.log(prob) + (1 - y) * Math.log(1 - prob));
            playerEvalCount++;
            scored.push({ id: p.id, pos: p.position as PositionType, pStart: prob });
          }

          const gks = scored.filter((x) => x.pos === 'GKP').sort((a, b) => b.pStart - a.pStart);
          const outs = scored.filter((x) => x.pos !== 'GKP').sort((a, b) => b.pStart - a.pStart);
          let hits = 0;
          if (gks[0] && starterSet.has(gks[0].id)) hits++;
          for (let i = 0; i < Math.min(10, outs.length); i++) {
            if (starterSet.has(outs[i].id)) hits++;
          }
          xiHitSum += hits / 11;
          clubEvalCount++;
        }
      }

      const avgXiAcc = clubEvalCount > 0 ? xiHitSum / clubEvalCount : 0;
      const avgLogLoss = playerEvalCount > 0 ? logLossSum / playerEvalCount : 0.35;
      const priorDist =
        Math.abs(fr.halfLifeDays - base.halfLifeDays) * 0.02 +
        Math.abs(l2 - base.l2) * 0.05;
      const obj = avgXiAcc - 0.18 * avgLogLoss - 0.015 * penaltyScale * priorDist;
      if (obj > bestCalibObj + 1e-9) {
        bestCalibObj = obj;
        bestCalibCand = { ...fr, l2 };
        bestFeatByGwPlayer = featByGwPlayer;
        bestWByS.clear();
        for (const [s, w] of wMapForCand.entries()) bestWByS.set(s, w);
      }
    }
  }

  const finalWLogit = fitLogisticFromCachedFeatures(
    allPlayers,
    targetGw,
    history,
    bestFeatByGwPlayer,
    bestCalibCand.l2,
    deadlines
  );

  // --- Stage 3: Sub_9 (All-Comp Bench Signal + RoleSquadPrior) ---
  const subCandidates: Array<
    Pick<
      HybridTuneParams,
      'subUseAllComp' | 'useRoleSquadPrior' | 'wSubBench' | 'wSubSquad' | 'wSubStart' | 'wSubRole' | 'subLift' | 'subStackPen' | 'subCov'
    >
  > = [
    { subUseAllComp: true, useRoleSquadPrior: false, wSubBench: 0.56, wSubSquad: 0.26, wSubStart: 0.04, wSubRole: 0.14, subLift: 0.20, subStackPen: 0.12, subCov: 0.40 },
    { subUseAllComp: true, useRoleSquadPrior: false, wSubBench: 0.48, wSubSquad: 0.28, wSubStart: 0.08, wSubRole: 0.16, subLift: 0.20, subStackPen: 0.12, subCov: 0.40 },
    { subUseAllComp: true, useRoleSquadPrior: true, wSubBench: 0.50, wSubSquad: 0.26, wSubStart: 0.08, wSubRole: 0.16, subLift: 0.25, subStackPen: 0.12, subCov: 0.50 },
  ];

  let bestSubCand = subCandidates[0];
  let bestSubObj = -Infinity;

  const evalPools: Array<{
    actBenchSet: Set<number>;
    actStartSet: Set<number>;
    backupGkpId?: number;
    remOutPool: Array<{ id: number; position: PositionType; feat: PlayerFeaturesAtGw; pStart: number; avail: number }>;
    slotsOut: CanonicalTacticalRole[];
  }> = [];

  for (let s = 3; s < targetGw; s++) {
    const fMap = bestFeatByGwPlayer.get(s)!;
    const wLogit = bestWByS.get(s)!;
    const dlIso = deadlines?.[String(s)];
    for (const c of clubs) {
      const act = actualSidesByKey.get(`${s}_${c}`);
      if (!act) continue;
      const cPlayers = playersByClub.get(c) || [];
      const koMs = act.kickoffMs || history.eplKickoffMsByGwClub?.[`${s}_${c}`];
      const koIso = koMs ? new Date(koMs).toISOString() : undefined;
      const scored = cPlayers.map((p) => {
        const feat = fMap.get(p.id)!;
        const av = dlIso
          ? resolveCausalPlayerAvailability({
              player: p,
              targetGw: s,
              mode: 'historical',
              earliestKickoffIso: koIso,
              gwDeadlineIso: dlIso,
            })
          : { avail: 1.0 };
        return {
          p,
          feat,
          avail: av.avail,
          pStart: predictCalibratedStartProb(feat, wLogit) * av.avail,
        };
      });
      const gks = scored.filter((x) => x.p.position === 'GKP' && x.avail > 0).sort((a, b) => b.pStart - a.pStart);
      const outs = scored.filter((x) => x.p.position !== 'GKP' && x.avail > 0).sort((a, b) => b.pStart - a.pStart);
      evalPools.push({
        actBenchSet: new Set([...act.subOnIds, ...act.unusedBenchIds]),
        actStartSet: new Set(act.starterIds),
        backupGkpId: gks[1]?.p.id,
        remOutPool: outs.slice(10).map((x) => ({
          id: x.p.id,
          position: x.p.position as PositionType,
          feat: x.feat,
          pStart: x.pStart,
          avail: x.avail,
        })),
        slotsOut: act.outfieldSlots || [],
      });
    }
  }

  for (const sc of subCandidates) {
    let subHitSum = 0;
    for (const ep of evalPools) {
      const chosen: number[] = [];
      if (ep.backupGkpId) chosen.push(ep.backupGkpId);
      const ranked = rankBenchCandidates(ep.remOutPool, ep.slotsOut, sc);
      for (const r of ranked) {
        if (chosen.length >= 9) break;
        chosen.push(r.id);
      }
      let hits = 0;
      for (const id of chosen) {
        if (ep.actBenchSet.has(id) && !ep.actStartSet.has(id)) hits++;
      }
      subHitSum += hits / 9;
    }
    const avgSub = evalPools.length > 0 ? subHitSum / evalPools.length : 0;
    const priorDist =
      (sc.useRoleSquadPrior ? 0.08 : 0) + Math.abs(sc.wSubBench - base.wSubBench) + Math.abs(sc.wSubStart - base.wSubStart);
    const obj = avgSub - 0.01 * penaltyScale * priorDist;
    if (obj > bestSubObj + 1e-9) {
      bestSubObj = obj;
      bestSubCand = sc;
    }
  }

  return {
    params: {
      ...base,
      ...bestFormCand,
      ...bestCalibCand,
      ...bestSubCand,
    },
    logitWeights: finalWLogit,
    targetFeatMap: bestFeatByGwPlayer.get(targetGw),
  };
}

function predictFormationInternal(
  clubShort: string,
  targetGw: number,
  isHome: boolean | undefined,
  history: HybridHistoryStore,
  _lambdaF: number,
  venueBoost: number,
  formHalfLifeDays: number = DEFAULT_HYBRID_PARAMS.formHalfLifeDays,
  targetCutoffMs?: number
): {
  label: string;
  outfieldSlots: CanonicalTacticalRole[];
  candidates: Array<{ label: string; outfieldSlots: CanonicalTacticalRole[]; priorScore: number }>;
} | null {
  const cutoffMs = resolveTargetCutoffMs(clubShort, targetGw, history, targetCutoffMs);
  // Protect formation accuracy: use EPL + Major comps (EU_CL, EU_UC, EU_CF, EN_FA, EN_FC); EXCLUDE EN_LC
  const sides = getCausalAllCompSides(history, clubShort, targetGw, cutoffMs).filter(
    (s) => s.compAbbr !== 'EN_LC' && s.formationLabel && s.outfieldSlots?.length === 10
  );
  if (sides.length === 0) return null;

  const bySig = new Map<string, { label: string; outfieldSlots: CanonicalTacticalRole[]; weight: number; latestMs: number }>();
  let totalWeight = 0;

  for (const s of sides) {
    const sideKo = s.kickoffMs && s.kickoffMs > 0 ? s.kickoffMs : resolveFallbackGwKickoffMs(s.gw);
    const daysAgo = Math.max(0, (cutoffMs - sideKo) / 86400_000);
    const cw = s.compWeight ?? CROSS_COMP_WEIGHTS[s.compAbbr || 'EN_PR'] ?? 0.65;
    const venueMod = isHome !== undefined && s.isHome === isHome ? 1 + venueBoost : 1.0;
    const w = Math.pow(0.5, daysAgo / Math.max(1, formHalfLifeDays)) * cw * venueMod;
    totalWeight += w;

    const sig = `${s.formationLabel}|${s.outfieldSlots!.join(',')}`;
    const prev = bySig.get(sig);
    if (prev) {
      prev.weight += w;
      if (sideKo > prev.latestMs) prev.latestMs = sideKo;
    } else {
      bySig.set(sig, {
        label: s.formationLabel!,
        outfieldSlots: s.outfieldSlots!,
        weight: w,
        latestMs: sideKo,
      });
    }
  }

  const candidates = Array.from(bySig.values())
    .map((c) => ({
      label: c.label,
      outfieldSlots: c.outfieldSlots,
      priorScore: totalWeight > 0 ? c.weight / totalWeight : 0,
      latestMs: c.latestMs,
    }))
    .sort((a, b) => b.priorScore - a.priorScore || b.latestMs - a.latestMs);

  const top = candidates[0];
  return top ? { label: top.label, outfieldSlots: top.outfieldSlots, candidates } : null;
}

function rankBenchCandidates(
  pool: Array<{
    id: number;
    position: PositionType;
    feat: PlayerFeaturesAtGw;
    pStart: number;
    avail: number;
  }>,
  starterSlotsFilled: CanonicalTacticalRole[],
  params: Pick<
    HybridTuneParams,
    'subUseAllComp' | 'useRoleSquadPrior' | 'wSubBench' | 'wSubSquad' | 'wSubStart' | 'wSubRole' | 'subLift' | 'subStackPen' | 'subCov'
  >
): Array<{ id: number; subScore: number }> {
  const starterLineCounts: Record<'DEF' | 'MID' | 'FWD', number> = { DEF: 0, MID: 0, FWD: 0 };
  for (const r of starterSlotsFilled) {
    const g = getLineGroup(r);
    if (g !== 'GK') starterLineCounts[g]++;
  }

  const scored = pool.map((cand) => {
    const f = cand.feat;
    const useAll = params.subUseAllComp;
    const bRate = useAll ? f.allBenchRate : f.benchAppRate;
    const sRate = useAll ? f.allCompStartRate : f.startRate;
    const sqRate = useAll ? f.inSquadAllRate : f.inSquadRate;
    const minAvg = useAll ? f.allCompMinAvg : f.minAvg;
    const ebRate = useAll ? f.allCompEbStartRate : f.ebStartRate;
    const bp1 = useAll ? f.benchPrev1Any : f.benchPrev1;
    const bp2 = useAll ? f.benchPrev2Any : f.benchPrev2;

    const condBenchGivenNotStart = Math.min(1.0, Math.max(0.01, bRate / Math.max(0.12, 1 - sRate + 0.10)));
    const benchMomentum = 0.65 * bp1 + 0.35 * bp2;
    const benchSignal = 0.55 * condBenchGivenNotStart + 0.25 * sqRate + 0.20 * benchMomentum;
    const squadAndMin = 0.55 * sqRate + 0.45 * Math.min(1.0, minAvg / 90);
    const overflowSignal = Math.max(cand.pStart, ebRate * 0.7);

    const coreUtility =
      params.wSubBench * benchSignal +
      params.wSubSquad * squadAndMin +
      params.wSubStart * overflowSignal +
      params.wSubRole * f.maxAffinity;

    const line = getLineGroup(f.topRole);
    const coverBoost =
      params.useRoleSquadPrior && line !== 'GK' && starterLineCounts[line] < (line === 'FWD' ? 2 : 4)
        ? params.subLift * 0.25
        : 0;

    const baseScore = (coreUtility + coverBoost) * cand.avail;
    return {
      id: cand.id,
      bestRole: f.topRole,
      line,
      baseScore,
      avail: cand.avail,
    };
  });

  const selected: Array<{ id: number; subScore: number }> = [];
  const remaining = [...scored];
  const benchRoleCounts = new Map<CanonicalTacticalRole, number>();
  const benchLineCounts: Record<'DEF' | 'MID' | 'FWD', number> = { DEF: 0, MID: 0, FWD: 0 };

  while (remaining.length > 0 && selected.length < 9) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i];
      const sameRoleCount = benchRoleCounts.get(item.bestRole) || 0;
      const stackPen = sameRoleCount * params.subStackPen * 0.25;
      const lineCover = item.line !== 'GK' && benchLineCounts[item.line] === 0 ? params.subCov * 0.05 : 0;
      const adj = item.baseScore - stackPen + lineCover;
      if (adj > bestScore) {
        bestScore = adj;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push({ id: chosen.id, subScore: chosen.baseScore });
    benchRoleCounts.set(chosen.bestRole, (benchRoleCounts.get(chosen.bestRole) || 0) + 1);
    if (chosen.line !== 'GK') benchLineCounts[chosen.line]++;
  }

  return selected;
}

export interface HybridClubPredictionInput {
  clubShort: string;
  targetGw: number;
  targetCutoffMs?: number;
  isHome?: boolean;
  players: DbPlayerStat[];
  availabilityById: Map<number, CausalAvailability>;
  history: HybridHistoryStore;
  pastMap: Record<string, PastSeasonMinutesRecord>;
  logitWeights: number[];
  params: HybridTuneParams;
  precomputedFeatMap?: Map<number, PlayerFeaturesAtGw>;
}

export interface HybridClubPredictionOutput {
  clubShort: string;
  predictedFormation: string | null;
  starterIds: number[];
  benchIds: number[];
  outIds: number[];
  slotAssignments: Array<{ slot: CanonicalTacticalRole; playerId: number; affinity: number }>;
  slotBattleIds: Set<number>;
  playerProbs: Map<number, { pStartBase: number; pStartAvail: number; baseSi: number; si: number; feat: PlayerFeaturesAtGw }>;
}

/**
 * Predicts Starting XI (1 GKP + 10 Outfield via Hungarian Assignment + 7-Comp Mild CoPlay Synergy),
 * predicted tactical formation (EN_LC excluded), 9-man Bench (`Sub_9`), Out-of-Squad, and calibrated `si` (%).
 */
export function predictHybridClubLineup(input: HybridClubPredictionInput): HybridClubPredictionOutput {
  const {
    clubShort,
    targetGw,
    targetCutoffMs: explicitCutoffMs,
    isHome,
    players,
    availabilityById,
    history,
    pastMap,
    logitWeights,
    params,
    precomputedFeatMap,
  } = input;

  const targetCutoffMs = resolveTargetCutoffMs(clubShort, targetGw, history, explicitCutoffMs);

  const featsList: PlayerFeaturesAtGw[] = [];
  const avAvailMap = new Map<number, number>();
  let allFoundPrecomputed = Boolean(precomputedFeatMap);
  for (const p of players) {
    const pre = precomputedFeatMap?.get(p.id);
    if (pre) {
      featsList.push(pre);
    } else {
      allFoundPrecomputed = false;
      featsList.push(
        extractPlayerFeaturesBeforeGw(
          p,
          targetGw,
          history,
          pastMap,
          params.decay,
          params.mShrink,
          params.kalmanGain,
          undefined,
          {
            halfLifeDays: params.halfLifeDays,
            roleDecayDays: params.roleDecayDays,
            rolePriorStrength: params.rolePriorStrength,
            targetCutoffMs,
          }
        )
      );
    }
    avAvailMap.set(p.id, availabilityById.get(p.id)?.avail ?? 1.0);
  }
  if (!allFoundPrecomputed) {
    populateClubCompRole(featsList, avAvailMap);
  }

  const rawProbs = new Map<number, { pStartBase: number; pStartAvail: number; feat: PlayerFeaturesAtGw }>();
  const outfieldIds: number[] = [];

  for (const feat of featsList) {
    const av = availabilityById.get(feat.id) ?? { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
    let pBase: number;
    if (targetGw <= 2 && feat.nClub === 0) {
      pBase = feat.priorRate;
    } else if (targetGw <= 2) {
      pBase = 0.55 * feat.allCompEbStartRate + 0.45 * feat.kalmanState;
    } else {
      pBase = predictCalibratedStartProb(feat, logitWeights);
    }
    pBase = Math.min(0.99, Math.max(0.01, pBase));
    const pAvail = Math.min(0.99, Math.max(0.0, pBase * av.avail));
    rawProbs.set(feat.id, { pStartBase: pBase, pStartAvail: pAvail, feat });
    if (feat.position !== 'GKP') outfieldIds.push(feat.id);
  }

  applyClubSumLogitShrinkage(rawProbs, outfieldIds, params.clubSumShrinkage ?? DEFAULT_HYBRID_PARAMS.clubSumShrinkage);

  const playerProbs = new Map<
    number,
    { pStartBase: number; pStartAvail: number; baseSi: number; si: number; feat: PlayerFeaturesAtGw }
  >();

  for (const feat of featsList) {
    const av = availabilityById.get(feat.id) ?? { avail: 1.0, absen: 0.0, status: 'a', chance: 100, expectedReturnDate: null };
    const r = rawProbs.get(feat.id)!;
    const baseSi = Math.min(99, Math.max(1, Math.round(r.pStartBase * 100)));
    const si = av.avail <= 0 ? 0 : Math.min(99, Math.max(1, Math.round(r.pStartAvail * 100)));
    playerProbs.set(feat.id, {
      pStartBase: r.pStartBase,
      pStartAvail: r.pStartAvail,
      baseSi,
      si,
      feat: r.feat,
    });
  }

  const sortedPlayers = [...players].sort((a, b) => {
    const pa = playerProbs.get(a.id)!;
    const pb = playerProbs.get(b.id)!;
    return pb.pStartAvail - pa.pStartAvail || pb.feat.startsCount - pa.feat.startsCount || pb.feat.nowCost - pa.feat.nowCost;
  });

  const availableGkps = sortedPlayers.filter((p) => p.position === 'GKP' && (availabilityById.get(p.id)?.avail ?? 1) > 0);
  const fitGkps = availableGkps.filter((p) => (availabilityById.get(p.id)?.avail ?? 1) > 0.5);
  const allGkps = sortedPlayers.filter((p) => p.position === 'GKP');
  const starterGkp = fitGkps[0] || availableGkps[0] || allGkps[0];

  const availableOutfields = sortedPlayers.filter((p) => p.position !== 'GKP' && (availabilityById.get(p.id)?.avail ?? 1) > 0);
  const fitOutfields = availableOutfields.filter((p) => (availabilityById.get(p.id)?.avail ?? 1) >= 0.5);
  const poolOutfields =
    fitOutfields.length >= 10
      ? fitOutfields
      : availableOutfields.length >= 10
      ? availableOutfields
      : sortedPlayers.filter((p) => p.position !== 'GKP');

  // 7-Competition Co-Play Synergy weighted by time & competition weight
  const clubSides = getCausalAllCompSides(history, clubShort, targetGw, targetCutoffMs);
  const coPlayCount = new Map<string, number>();
  let coPlayWeightTotal = 0;
  const coHalfLife = Math.max(1, params.coPlayHalfLifeDays ?? DEFAULT_HYBRID_PARAMS.coPlayHalfLifeDays);
  for (const s of clubSides) {
    const sideKo = s.kickoffMs && s.kickoffMs > 0 ? s.kickoffMs : resolveFallbackGwKickoffMs(s.gw);
    const daysAgo = Math.max(0, (targetCutoffMs - sideKo) / 86400_000);
    const cw = s.compWeight ?? CROSS_COMP_WEIGHTS[s.compAbbr || 'EN_PR'] ?? 0.5;
    const w = Math.pow(0.5, daysAgo / coHalfLife) * cw;
    coPlayWeightTotal += w;
    for (let i = 0; i < s.starterIds.length; i++) {
      for (let j = i + 1; j < s.starterIds.length; j++) {
        const a = s.starterIds[i];
        const b = s.starterIds[j];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        coPlayCount.set(key, (coPlayCount.get(key) || 0) + w);
      }
    }
  }
  const getCoPlay = (idA: number, idB: number): number => {
    if (coPlayWeightTotal <= 0 || idA === idB) return 0;
    const key = idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
    return (coPlayCount.get(key) || 0) / coPlayWeightTotal;
  };

  const formPred = predictFormationInternal(
    clubShort,
    targetGw,
    isHome,
    history,
    params.lambdaF,
    params.venueBoost,
    params.formHalfLifeDays,
    targetCutoffMs
  );
  let chosenForm = formPred ? { label: formPred.label, outfieldSlots: formPred.outfieldSlots } : null;

  const evalHungarianForSlots = (slots: CanonicalTacticalRole[], cands: DbPlayerStat[]) => {
    if (cands.length < 10) return null;
    const wMat1: number[][] = slots.map((slotRole) =>
      cands.map((c) => {
        const pr = playerProbs.get(c.id)!;
        const aff = pr.feat.roleAffinity[slotRole] ?? 0.08;
        return Math.log(Math.max(1e-4, pr.pStartAvail)) + params.wA * Math.log(Math.max(0.05, aff));
      })
    );
    const cols1 = solveMaxWeightAssignment(wMat1);
    if (cols1.length !== 10 || cols1.some((c) => c < 0)) return null;

    const coreIds = cols1.map((idx) => cands[idx].id);

    const wMat2: number[][] = slots.map((slotRole) =>
      cands.map((c) => {
        const pr = playerProbs.get(c.id)!;
        const aff = pr.feat.roleAffinity[slotRole] ?? 0.08;
        let synSum = 0;
        let synN = 0;
        for (const cid of coreIds) {
          if (cid !== c.id) {
            synSum += getCoPlay(c.id, cid);
            synN++;
          }
        }
        const synAvg = synN > 0 ? synSum / synN : 0;
        const baseTerm = Math.log(Math.max(1e-4, pr.pStartAvail)) + params.wA * Math.log(Math.max(0.05, aff));
        return baseTerm + params.wSyn * synAvg;
      })
    );
    const cols2 = solveMaxWeightAssignment(wMat2);
    if (cols2.length !== 10 || cols2.some((c) => c < 0)) return null;

    const totalScore = cols2.reduce((acc, colIdx, sIdx) => acc + wMat2[sIdx][colIdx], 0);
    return { cols: cols2, wMat: wMat2, totalScore };
  };

  let bestAssignment: ReturnType<typeof evalHungarianForSlots> = null;
  if (formPred && formPred.candidates.length > 0 && poolOutfields.length >= 10) {
    if (formPred.candidates.length === 1 || params.wV6 <= 0) {
      chosenForm = { label: formPred.candidates[0].label, outfieldSlots: formPred.candidates[0].outfieldSlots };
      bestAssignment = evalHungarianForSlots(chosenForm.outfieldSlots, poolOutfields);
    } else {
      const topCands = formPred.candidates.slice(0, 3);
      const evals = topCands.map((fc) => ({
        fc,
        res: evalHungarianForSlots(fc.outfieldSlots, poolOutfields),
      }));
      const maxJoint = Math.max(...evals.map((e) => e.res?.totalScore ?? -Infinity));
      let bestCombined = -Infinity;
      for (const e of evals) {
        const normJoint = isFinite(maxJoint) && e.res ? Math.exp(Math.max(-20, (e.res.totalScore - maxJoint) * 0.25)) : 0;
        const score = (1 - params.wV6) * e.fc.priorScore + params.wV6 * normJoint;
        if (score > bestCombined) {
          bestCombined = score;
          chosenForm = { label: e.fc.label, outfieldSlots: e.fc.outfieldSlots };
          bestAssignment = e.res;
        }
      }
    }
  }

  const starterIds: number[] = [];
  if (starterGkp) starterIds.push(starterGkp.id);
  const slotAssignments: Array<{ slot: CanonicalTacticalRole; playerId: number; affinity: number }> = [];
  if (starterGkp) {
    slotAssignments.push({ slot: 'GK', playerId: starterGkp.id, affinity: 1.0 });
  }

  const slotBattleIds = new Set<number>();

  if (chosenForm && bestAssignment) {
    const chosenSet = new Set(bestAssignment.cols);
    bestAssignment.cols.forEach((colIdx, sIdx) => {
      const cand = poolOutfields[colIdx];
      const slotRole = chosenForm!.outfieldSlots[sIdx];
      starterIds.push(cand.id);
      slotAssignments.push({
        slot: slotRole,
        playerId: cand.id,
        affinity: playerProbs.get(cand.id)!.feat.roleAffinity[slotRole] ?? 0.08,
      });

      const starterScore = bestAssignment!.wMat[sIdx][colIdx];
      let bestChallenger: { p: DbPlayerStat; score: number } | null = null;
      for (let cIdx = 0; cIdx < poolOutfields.length; cIdx++) {
        if (chosenSet.has(cIdx)) continue;
        const chall = poolOutfields[cIdx];
        const challAff = playerProbs.get(chall.id)!.feat.roleAffinity[slotRole] ?? 0;
        if (challAff < 0.65) continue;
        const sc = bestAssignment!.wMat[sIdx][cIdx];
        if (!bestChallenger || sc > bestChallenger.score) {
          bestChallenger = { p: chall, score: sc };
        }
      }
      if (bestChallenger && Math.abs(starterScore - bestChallenger.score) <= 0.35) {
        const sSi = playerProbs.get(cand.id)!.si;
        const cSi = playerProbs.get(bestChallenger.p.id)!.si;
        if (sSi >= 35 && cSi >= 35) {
          slotBattleIds.add(cand.id);
          slotBattleIds.add(bestChallenger.p.id);
        }
      }
    });
  } else {
    for (const p of poolOutfields) {
      if (starterIds.length >= 11) break;
      starterIds.push(p.id);
    }
  }

  const starterSet = new Set(starterIds);
  for (const p of sortedPlayers) {
    if (starterIds.length >= 11) break;
    if (!starterSet.has(p.id)) {
      starterIds.push(p.id);
      starterSet.add(p.id);
    }
  }

  const nonStarters = sortedPlayers.filter((p) => !starterSet.has(p.id));
  const availNonStarters = nonStarters.filter((p) => (availabilityById.get(p.id)?.avail ?? 1) > 0);
  const outNonStarters = nonStarters.filter((p) => (availabilityById.get(p.id)?.avail ?? 1) <= 0);

  const benchIds: number[] = [];
  const backupGkp = availNonStarters.find((p) => p.position === 'GKP') || nonStarters.find((p) => p.position === 'GKP');
  if (backupGkp) benchIds.push(backupGkp.id);

  const remAvailOutBench = availNonStarters.filter((p) => p.id !== backupGkp?.id && p.position !== 'GKP');
  const starterOutRoles = slotAssignments.filter((sa) => sa.slot !== 'GK').map((sa) => sa.slot);
  const rankedSubOuts = rankBenchCandidates(
    remAvailOutBench.map((p) => {
      const pr = playerProbs.get(p.id)!;
      return {
        id: p.id,
        position: p.position as PositionType,
        feat: pr.feat,
        pStart: pr.pStartAvail,
        avail: availabilityById.get(p.id)?.avail ?? 1,
      };
    }),
    starterOutRoles,
    params
  );

  for (const r of rankedSubOuts) {
    if (benchIds.length >= 9) break;
    benchIds.push(r.id);
  }

  const benchSet = new Set(benchIds);
  for (const p of [...availNonStarters, ...outNonStarters]) {
    if (benchIds.length >= 9) break;
    if (!benchSet.has(p.id)) {
      benchIds.push(p.id);
      benchSet.add(p.id);
    }
  }

  const outIds = nonStarters.filter((p) => !benchSet.has(p.id)).map((p) => p.id);

  return {
    clubShort,
    predictedFormation: chosenForm?.label ?? null,
    starterIds,
    benchIds,
    outIds,
    slotAssignments,
    slotBattleIds,
    playerProbs,
  };
}
