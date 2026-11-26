import type { MatchCardItem, PositionType } from '../types.ts';

/**
 * Canonical tactical roles derived from Premier League Pulse API `formation.players`
 * where rows go Back -> Front and lateral indices within each row go Right -> Left.
 */
export type CanonicalTacticalRole =
  | 'GK'
  | 'RB'
  | 'RWB'
  | 'RCB'
  | 'CCB'
  | 'LCB'
  | 'LB'
  | 'LWB'
  | 'DM'
  | 'CM'
  | 'AM'
  | 'RW'
  | 'LW'
  | 'ST';

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
  'ST'
];

/**
 * Known Premier League Pulse formation shapes mapped explicitly to canonical roles
 * (following verified Pulse convention: index 0 = Team Right -> index last = Team Left).
 */
const EXPLICIT_FORMATION_ROLES: Record<string, CanonicalTacticalRole[][]> = {
  '4-2-3-1': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['DM', 'DM'],
    ['RW', 'AM', 'LW'],
    ['ST']
  ],
  '3-4-2-1': [
    ['GK'],
    ['RCB', 'CCB', 'LCB'],
    ['RWB', 'DM', 'DM', 'LWB'],
    ['AM', 'AM'],
    ['ST']
  ],
  '5-4-1': [
    ['GK'],
    ['RWB', 'RCB', 'CCB', 'LCB', 'LWB'],
    ['RW', 'CM', 'CM', 'LW'],
    ['ST']
  ],
  '4-1-4-1': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['DM'],
    ['RW', 'CM', 'CM', 'LW'],
    ['ST']
  ],
  '4-3-3': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['CM', 'DM', 'CM'],
    ['RW', 'ST', 'LW']
  ],
  '3-1-4-2': [
    ['GK'],
    ['RCB', 'CCB', 'LCB'],
    ['DM'],
    ['RWB', 'CM', 'CM', 'LWB'],
    ['ST', 'ST']
  ],
  '5-3-2': [
    ['GK'],
    ['RWB', 'RCB', 'CCB', 'LCB', 'LWB'],
    ['CM', 'DM', 'CM'],
    ['ST', 'ST']
  ],
  '4-4-2': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['RW', 'CM', 'CM', 'LW'],
    ['ST', 'ST']
  ],
  '4-3-2-1': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['CM', 'DM', 'CM'],
    ['AM', 'AM'],
    ['ST']
  ],
  '3-4-3': [
    ['GK'],
    ['RCB', 'CCB', 'LCB'],
    ['RWB', 'DM', 'DM', 'LWB'],
    ['RW', 'ST', 'LW']
  ],
  '3-5-2': [
    ['GK'],
    ['RCB', 'CCB', 'LCB'],
    ['RWB', 'CM', 'DM', 'CM', 'LWB'],
    ['ST', 'ST']
  ],
  '4-4-1-1': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['RW', 'CM', 'CM', 'LW'],
    ['AM'],
    ['ST']
  ],
  '4-5-1': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['RW', 'CM', 'DM', 'CM', 'LW'],
    ['ST']
  ],
  '4-2-2-2': [
    ['GK'],
    ['RB', 'RCB', 'LCB', 'LB'],
    ['DM', 'DM'],
    ['AM', 'AM'],
    ['ST', 'ST']
  ]
};

/**
 * Infers canonical tactical roles for any Pulse formation row structure dynamically,
 * using EXPLICIT_FORMATION_ROLES when available and graceful structural rules otherwise.
 */
export function getFormationRoleMatrix(
  label: string,
  rowLengths?: number[]
): CanonicalTacticalRole[][] {
  const cleanLabel = (label || '').trim();
  const explicit = EXPLICIT_FORMATION_ROLES[cleanLabel];
  if (explicit) {
    if (!rowLengths || (explicit.length === rowLengths.length && explicit.every((r, i) => r.length === rowLengths[i]))) {
      return explicit;
    }
  }

  // Dynamic fallback from formation label digits (e.g. "4-2-3-1" -> [1, 4, 2, 3, 1])
  const parsedLengths =
    rowLengths && rowLengths.length >= 3
      ? rowLengths
      : [
          1,
          ...cleanLabel
            .split('-')
            .map((n) => parseInt(n, 10))
            .filter((n) => !isNaN(n) && n > 0)
        ];

  if (parsedLengths.length < 3) {
    return EXPLICIT_FORMATION_ROLES['4-2-3-1'];
  }

  const totalRows = parsedLengths.length;
  return parsedLengths.map((len, rIdx) => {
    if (rIdx === 0) return ['GK'];

    // Defense line (row 1)
    if (rIdx === 1) {
      if (len === 5) return ['RWB', 'RCB', 'CCB', 'LCB', 'LWB'];
      if (len === 4) return ['RB', 'RCB', 'LCB', 'LB'];
      if (len === 3) return ['RCB', 'CCB', 'LCB'];
      return Array.from({ length: len }, () => 'CCB' as CanonicalTacticalRole);
    }

    // Forward line (last row)
    if (rIdx === totalRows - 1) {
      if (len === 3) return ['RW', 'ST', 'LW'];
      if (len === 2) return ['ST', 'ST'];
      return ['ST'];
    }

    // Attacking midfield / second-striker line (immediately before last row when >= 5 rows total)
    if (totalRows >= 5 && rIdx === totalRows - 2) {
      if (len === 3) return ['RW', 'AM', 'LW'];
      if (len === 2) return ['AM', 'AM'];
      if (len === 4) return ['RW', 'AM', 'AM', 'LW'];
      return ['AM'];
    }

    // Midfield / Wing-back line
    const backCount = parsedLengths[1] || 4;
    if (len === 1) return ['DM'];
    if (len === 2) return ['DM', 'DM'];
    if (len === 3) return ['CM', 'DM', 'CM'];
    if (len === 4) {
      return backCount === 3 ? ['RWB', 'DM', 'DM', 'LWB'] : ['RW', 'CM', 'CM', 'LW'];
    }
    if (len === 5) {
      return backCount === 3 ? ['RWB', 'CM', 'DM', 'CM', 'LWB'] : ['RW', 'CM', 'DM', 'CM', 'LW'];
    }
    return Array.from({ length: len }, () => 'CM' as CanonicalTacticalRole);
  });
}

export function getFormationOutfieldSlots(label: string, rowLengths?: number[]): CanonicalTacticalRole[] {
  const matrix = getFormationRoleMatrix(label, rowLengths);
  const slots: CanonicalTacticalRole[] = [];
  for (let r = 1; r < matrix.length; r++) {
    for (const role of matrix[r]) {
      slots.push(role);
    }
  }
  return slots;
}

/**
 * Soft role compatibility matrix: ROLE_COMPATIBILITY[observedOrNaturalRole][targetSlotRole].
 * Reflects realistic Premier League tactical interchangeability (e.g. inverted wingers RW<->LW,
 * full-backs <-> wing-backs, 3-4-2-1 AM <-> 4-2-3-1 RW/LW, ball-playing CB <-> FB/DM, False-9s).
 */
const ROLE_COMPATIBILITY: Record<CanonicalTacticalRole, Partial<Record<CanonicalTacticalRole, number>>> = {
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
  ST: { ST: 1.0, AM: 0.54, RW: 0.52, LW: 0.52, CM: 0.22 }
};

function getRolePairCompatibility(source: CanonicalTacticalRole, target: CanonicalTacticalRole): number {
  if (source === target) return 1.0;
  return ROLE_COMPATIBILITY[source]?.[target] ?? 0.08;
}

export interface ClubFormationRecord {
  gw: number;
  label: string;
  outfieldSlots: CanonicalTacticalRole[];
  oppShort: string;
  isHome: boolean;
}

export interface PlayerRoleObservation {
  gw: number;
  role: CanonicalTacticalRole;
  formationLabel: string;
}

export interface TacticalHistoryIndex {
  clubFormations: Record<string, ClubFormationRecord[]>;
  playerRoles: Record<number, PlayerRoleObservation[]>;
  playerPositionInfo: Record<number, string>;
  playerPulsePos: Record<number, 'G' | 'D' | 'M' | 'F'>;
}

/**
 * Extracts historical Pulse formation records and player tactical slot deployments
 * strictly from GWs <= upToGw (zero data leakage).
 */
export function buildTacticalHistoryIndex(
  matchesByGW: Record<number, MatchCardItem[] | any[]>,
  upToGw: number
): TacticalHistoryIndex {
  const clubFormations: Record<string, ClubFormationRecord[]> = {};
  const playerRoles: Record<number, PlayerRoleObservation[]> = {};
  const playerPositionInfo: Record<number, string> = {};
  const playerPulsePos: Record<number, 'G' | 'D' | 'M' | 'F'> = {};

  const ingestFormationSide = (
    gw: number,
    clubShort: string,
    oppShort: string,
    isHome: boolean,
    formationLabel: string | { label: string; rows: number[][] } | undefined,
    formationRows: number[][] | undefined,
    lineup?: any[],
    bench?: any[]
  ) => {
    for (const p of [...(lineup || []), ...(bench || [])]) {
      if (!p || !p.id) continue;
      const infoStr = p.pulse_position_info || p.position_info;
      if (infoStr) playerPositionInfo[p.id] = infoStr;
      if (p.pulse_position) playerPulsePos[p.id] = p.pulse_position;
    }

    const label = typeof formationLabel === 'string' ? formationLabel : formationLabel?.label;
    const rows = Array.isArray(formationRows)
      ? formationRows
      : (formationLabel && typeof formationLabel === 'object' ? formationLabel.rows : undefined);

    if (!label || !Array.isArray(rows) || rows.length < 3) {
      return;
    }

    const rowLengths = rows.map((r) => r.length);
    const roleMatrix = getFormationRoleMatrix(label, rowLengths);
    const outfieldSlots: CanonicalTacticalRole[] = [];

    rows.forEach((rowIds, rIdx) => {
      const roleRow = roleMatrix[rIdx] || [];
      rowIds.forEach((playerId, cIdx) => {
        const role = roleRow[cIdx] || (rIdx === 0 ? 'GK' : 'CM');
        if (rIdx > 0) {
          outfieldSlots.push(role);
        }
        if (playerId > 0) {
          if (!playerRoles[playerId]) playerRoles[playerId] = [];
          playerRoles[playerId].push({
            gw,
            role,
            formationLabel: label
          });
        }
      });
    });

    if (clubShort && outfieldSlots.length === 10) {
      if (!clubFormations[clubShort]) clubFormations[clubShort] = [];
      clubFormations[clubShort].push({
        gw,
        label,
        outfieldSlots,
        oppShort,
        isHome
      });
    }
  };

  for (let gw = 1; gw <= upToGw; gw++) {
    const matches = matchesByGW[gw];
    if (!Array.isArray(matches)) continue;
    for (const m of matches) {
      if (!m) continue;
      const hShort = m.home_team?.short_name || '';
      const aShort = m.away_team?.short_name || '';
      ingestFormationSide(gw, hShort, aShort, true, m.home_formation, m.home_formation_rows, m.home_lineup, m.home_bench);
      ingestFormationSide(gw, aShort, hShort, false, m.away_formation, m.away_formation_rows, m.away_lineup, m.away_bench);
    }
  }

  for (const recs of Object.values(clubFormations)) {
    recs.sort((a, b) => a.gw - b.gw);
  }
  for (const obs of Object.values(playerRoles)) {
    obs.sort((a, b) => a.gw - b.gw);
  }

  return {
    clubFormations,
    playerRoles,
    playerPositionInfo,
    playerPulsePos
  };
}

/**
 * Selects the most representative tactical formation (label + 10 outfield slots) for a club
 * entering `targetGw` using recency weighting (50% GW N-1, 30% GW N-2, 20% older matches).
 */
export function predictClubFormationSlots(
  clubShort: string,
  targetGw: number,
  tacticalIndex: TacticalHistoryIndex
): { label: string; outfieldSlots: CanonicalTacticalRole[] } | null {
  const records = (tacticalIndex.clubFormations[clubShort] || []).filter((r) => r.gw < targetGw);
  if (records.length === 0) return null;

  // Sort most recent first
  const desc = records.toSorted((a, b) => b.gw - a.gw);
  const scoreBySig = new Map<string, { weight: number; label: string; outfieldSlots: CanonicalTacticalRole[]; latestGw: number }>();

  const addRecord = (rec: ClubFormationRecord, weight: number) => {
    const sig = `${rec.label}|${rec.outfieldSlots.join(',')}`;
    const existing = scoreBySig.get(sig);
    if (existing) {
      existing.weight += weight;
      if (rec.gw > existing.latestGw) existing.latestGw = rec.gw;
    } else {
      scoreBySig.set(sig, {
        weight,
        label: rec.label,
        outfieldSlots: rec.outfieldSlots,
        latestGw: rec.gw
      });
    }
  };

  if (desc.length === 1) {
    addRecord(desc[0], 1.0);
  } else if (desc.length === 2) {
    addRecord(desc[0], 0.65);
    addRecord(desc[1], 0.35);
  } else {
    addRecord(desc[0], 0.50);
    addRecord(desc[1], 0.30);
    const olderCount = desc.length - 2;
    const eachOlderWeight = 0.20 / olderCount;
    for (let i = 2; i < desc.length; i++) {
      addRecord(desc[i], eachOlderWeight);
    }
  }

  let best: { weight: number; label: string; outfieldSlots: CanonicalTacticalRole[]; latestGw: number } | null = null;
  for (const cand of scoreBySig.values()) {
    if (!best || cand.weight > best.weight + 1e-6 || (Math.abs(cand.weight - best.weight) <= 1e-6 && cand.latestGw > best.latestGw)) {
      best = cand;
    }
  }

  return best ? { label: best.label, outfieldSlots: best.outfieldSlots } : null;
}

function parsePositionInfoPrior(
  posInfo: string | undefined,
  fplPosition: PositionType
): Partial<Record<CanonicalTacticalRole, number>> {
  const info = (posInfo || '').toLowerCase();

  if (info.includes('goalkeeper')) return { GK: 1.0 };
  if (info.includes('right full back') || info.includes('right back')) {
    return { RB: 0.96, RWB: 0.90, RCB: 0.65, RW: 0.50 };
  }
  if (info.includes('left full back') || info.includes('left back')) {
    return { LB: 0.96, LWB: 0.90, LCB: 0.65, LW: 0.50 };
  }
  if (info.includes('wing back')) {
    if (info.includes('right')) return { RWB: 0.96, RB: 0.90, RW: 0.68 };
    if (info.includes('left')) return { LWB: 0.96, LB: 0.90, LW: 0.68 };
    return { RWB: 0.85, LWB: 0.85, RB: 0.75, LB: 0.75 };
  }
  if (info.includes('central defender')) {
    if (info.includes('left')) return { LCB: 0.95, CCB: 0.90, RCB: 0.82, LB: 0.68 };
    if (info.includes('right')) return { RCB: 0.95, CCB: 0.90, LCB: 0.82, RB: 0.68 };
    return { CCB: 0.92, RCB: 0.92, LCB: 0.92, RB: 0.55, LB: 0.55, DM: 0.42 };
  }
  if (info.includes('defensive midfielder')) {
    return { DM: 0.96, CM: 0.84, AM: 0.52, RCB: 0.45, CCB: 0.45, LCB: 0.45 };
  }
  if (info.includes('attacking midfielder')) {
    if (info.includes('right')) return { AM: 0.92, RW: 0.88, LW: 0.72, CM: 0.72, ST: 0.55 };
    if (info.includes('left')) return { AM: 0.92, LW: 0.88, RW: 0.72, CM: 0.72, ST: 0.55 };
    return { AM: 0.95, CM: 0.78, RW: 0.76, LW: 0.76, ST: 0.55 };
  }
  if (info.includes('central midfielder')) {
    return { CM: 0.94, DM: 0.84, AM: 0.74, RW: 0.45, LW: 0.45 };
  }
  if (info.includes('winger')) {
    if (info.includes('left') && info.includes('right')) {
      return { RW: 0.90, LW: 0.90, AM: 0.80, ST: 0.55, RWB: 0.52, LWB: 0.52 };
    }
    if (info.includes('right')) return { RW: 0.96, LW: 0.80, AM: 0.80, ST: 0.55, RWB: 0.55 };
    if (info.includes('left')) return { LW: 0.96, RW: 0.80, AM: 0.80, ST: 0.55, LWB: 0.55 };
    return { RW: 0.88, LW: 0.88, AM: 0.78, ST: 0.52 };
  }
  if (info.includes('striker') || info.includes('forward')) {
    if (info.includes('second')) return { ST: 0.84, AM: 0.82, RW: 0.72, LW: 0.72 };
    return { ST: 0.96, AM: 0.52, RW: 0.50, LW: 0.50 };
  }

  // Fallback to FPL coarse position
  if (fplPosition === 'GKP') return { GK: 1.0 };
  if (fplPosition === 'DEF') {
    return { RCB: 0.78, CCB: 0.78, LCB: 0.78, RB: 0.72, LB: 0.72, RWB: 0.66, LWB: 0.66 };
  }
  if (fplPosition === 'MID') {
    return { DM: 0.74, CM: 0.78, AM: 0.78, RW: 0.72, LW: 0.72 };
  }
  return { ST: 0.94, AM: 0.50, RW: 0.48, LW: 0.48 };
}

/**
 * Computes recency-weighted Bayesian affinity (0..1) of a player for every canonical outfield role.
 * Blends observed Pulse slot appearances with Pulse `positionInfo` & FPL prior.
 */
export function computePlayerRoleAffinityMap(
  playerId: number,
  fplPosition: PositionType,
  targetGw: number,
  tacticalIndex: TacticalHistoryIndex
): Record<CanonicalTacticalRole, number> {
  const posInfo = tacticalIndex.playerPositionInfo[playerId];
  const priorRaw = parsePositionInfoPrior(posInfo, fplPosition);

  // Expand sparse prior through compatibility matrix so every role gets a smooth baseline
  const priorMap: Record<CanonicalTacticalRole, number> = {} as Record<CanonicalTacticalRole, number>;
  priorMap.GK = fplPosition === 'GKP' ? 1.0 : 0.0;
  for (const targetRole of ALL_OUTFIELD_ROLES) {
    let bestPrior = 0.08;
    for (const [srcKey, srcWeight] of Object.entries(priorRaw)) {
      const srcRole = srcKey as CanonicalTacticalRole;
      const compat = getRolePairCompatibility(srcRole, targetRole);
      bestPrior = Math.max(bestPrior, (srcWeight || 0) * compat);
    }
    priorMap[targetRole] = bestPrior;
  }

  const obsList = (tacticalIndex.playerRoles[playerId] || []).filter(
    (o) => o.gw < targetGw && o.role !== 'GK'
  );
  if (obsList.length === 0) {
    return priorMap;
  }

  // Weight recent observations slightly higher (exponential decay per GW distance)
  let totalWeight = 0;
  const roleWeightSum: Partial<Record<CanonicalTacticalRole, number>> = {};
  for (const obs of obsList) {
    const age = Math.max(1, targetGw - obs.gw);
    const w = age === 1 ? 1.6 : age === 2 ? 1.3 : 1.0;
    totalWeight += w;
    roleWeightSum[obs.role] = (roleWeightSum[obs.role] || 0) + w;
  }

  // Observed affinity for targetSlot = weighted expected compatibility across observed roles
  const observedMap: Record<CanonicalTacticalRole, number> = {} as Record<CanonicalTacticalRole, number>;
  observedMap.GK = fplPosition === 'GKP' ? 1.0 : 0.0;

  for (const targetRole of ALL_OUTFIELD_ROLES) {
    let weightedCompat = 0;
    for (const [obsRoleKey, wSum] of Object.entries(roleWeightSum)) {
      const obsRole = obsRoleKey as CanonicalTacticalRole;
      weightedCompat += ((wSum || 0) / totalWeight) * getRolePairCompatibility(obsRole, targetRole);
    }
    observedMap[targetRole] = weightedCompat;
  }

  // Bayesian shrinkage: more Pulse starts -> higher trust in actual on-pitch slot deployment
  const alpha = Math.min(0.88, obsList.length / (obsList.length + 1.5));
  const blended: Record<CanonicalTacticalRole, number> = {} as Record<CanonicalTacticalRole, number>;
  blended.GK = priorMap.GK;
  for (const targetRole of ALL_OUTFIELD_ROLES) {
    blended[targetRole] = alpha * observedMap[targetRole] + (1 - alpha) * priorMap[targetRole];
  }

  return blended;
}

/**
 * Exact Kuhn-Munkres (Hungarian) algorithm for rectangular max-weight bipartite matching.
 * Assigns each of `rows` slots (`rows <= cols`) to a unique candidate column maximizing total weight.
 */
export function solveMaxWeightAssignment(weights: number[][]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const m = weights[0].length;
  if (m < n) return [];

  let maxW = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (weights[i][j] > maxW) maxW = weights[i][j];
    }
  }
  if (!isFinite(maxW)) maxW = 0;

  // 1-indexed Kuhn-Munkres minimization over cost[i][j] = maxW - weights[i][j] >= 0
  const INF = 1e12;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const curCost = maxW - weights[i0 - 1][j - 1] - u[i0] - v[j];
          if (curCost < minv[j]) {
            minv[j] = curCost;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= m; j++) {
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

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      assignment[p[j] - 1] = j - 1;
    }
  }
  return assignment;
}

export interface TacticalCandidate {
  id: number;
  position: PositionType;
  si: number;
  starts: number;
  bench: number;
  nowCost: number;
  provenTier?: 'ELITE' | 'ESTABLISHED' | 'EMERGING' | 'NONE' | string;
}

export interface TacticalSelectionResult {
  starterOutfieldIds: number[];
  predictedFormationLabel: string;
  slotAssignments: Array<{ slot: CanonicalTacticalRole; playerId: number; affinity: number }>;
  slotBattleIds: Set<number>;
}

/**
 * Selects the optimal 10 outfield starters for a club by matching fit outfield candidates
 * against the club's recency-weighted Pulse tactical formation slots.
 * Returns `null` if no Pulse formation history exists for this club yet.
 */
export function selectTacticalOutfieldStarters(
  clubShort: string,
  targetGw: number,
  fitOutfields: TacticalCandidate[],
  tacticalIndex: TacticalHistoryIndex
): TacticalSelectionResult | null {
  const predictedFormation = predictClubFormationSlots(clubShort, targetGw, tacticalIndex);
  if (!predictedFormation || predictedFormation.outfieldSlots.length !== 10) {
    return null;
  }

  const slots = predictedFormation.outfieldSlots;

  // If <= 10 fit outfield candidates exist, all fit outfielders start (caller fills remainder from fallback)
  if (fitOutfields.length <= 10) {
    return {
      starterOutfieldIds: fitOutfields.map((c) => c.id),
      predictedFormationLabel: predictedFormation.label,
      slotAssignments: fitOutfields.map((c, idx) => ({
        slot: slots[idx] || 'CM',
        playerId: c.id,
        affinity: 1.0
      })),
      slotBattleIds: new Set()
    };
  }

  // Precompute Bayesian role affinities for all fit outfielders
  const affinitiesByPlayer = fitOutfields.map((cand) =>
    computePlayerRoleAffinityMap(cand.id, cand.position, targetGw, tacticalIndex)
  );

  // Build 10 x N score matrix: combines player Starter Index (SI), proven priority, and slot affinity
  // Formula: baseScore * (0.65 + 0.35 * affinity) + tiny deterministic tiebreak
  const weights: number[][] = slots.map((slotRole) =>
    fitOutfields.map((cand, colIdx) => {
      const affinity = affinitiesByPlayer[colIdx][slotRole] ?? 0.08;
      const provenBoost =
        cand.provenTier === 'ELITE' ? 8 : cand.provenTier === 'ESTABLISHED' ? 4 : 0;
      const baseScore = cand.si + provenBoost;
      const tieBreak =
        cand.starts * 0.002 + cand.bench * 0.0005 + cand.nowCost * 0.0001;
      return baseScore * (0.65 + 0.35 * affinity) + tieBreak;
    })
  );

  const chosenCols = solveMaxWeightAssignment(weights);
  if (chosenCols.length !== 10 || chosenCols.some((c) => c < 0)) {
    return null;
  }

  const chosenSet = new Set(chosenCols);
  const slotAssignments = chosenCols.map((colIdx, sIdx) => ({
    slot: slots[sIdx],
    playerId: fitOutfields[colIdx].id,
    affinity: affinitiesByPlayer[colIdx][slots[sIdx]] ?? 0.08
  }));

  // Detect direct slot battles (chosen starter vs strongest unselected challenger in that same tactical slot)
  const slotBattleIds = new Set<number>();
  for (let sIdx = 0; sIdx < slots.length; sIdx++) {
    const starterIdx = chosenCols[sIdx];
    const starter = fitOutfields[starterIdx];
    const starterSlotScore = weights[sIdx][starterIdx];

    let bestChallengerIdx = -1;
    let bestChallengerScore = -Infinity;
    for (let cIdx = 0; cIdx < fitOutfields.length; cIdx++) {
      if (chosenSet.has(cIdx)) continue;
      const aff = affinitiesByPlayer[cIdx][slots[sIdx]] ?? 0;
      if (aff < 0.65) continue;
      if (weights[sIdx][cIdx] > bestChallengerScore) {
        bestChallengerScore = weights[sIdx][cIdx];
        bestChallengerIdx = cIdx;
      }
    }

    if (bestChallengerIdx >= 0) {
      const challenger = fitOutfields[bestChallengerIdx];
      if (
        Math.abs(starterSlotScore - bestChallengerScore) <= 8.5 &&
        starter.si >= 35 &&
        challenger.si >= 35
      ) {
        slotBattleIds.add(starter.id);
        slotBattleIds.add(challenger.id);
      }
    }
  }

  return {
    starterOutfieldIds: chosenCols.map((colIdx) => fitOutfields[colIdx].id),
    predictedFormationLabel: predictedFormation.label,
    slotAssignments,
    slotBattleIds
  };
}
