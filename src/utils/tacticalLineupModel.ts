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
