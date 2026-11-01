/**
 * ============================================================================
 * FANTASY PREMIER LEAGUE (FPL) OFFICIAL SCORING RULES & CALCULATION ENGINE
 * ============================================================================
 * Reference: https://fantasy.premierleague.com/help/rules (Scoring Section)
 *
 * Dokumen & utility ini memuat seluruh konstanta, aturan akumulasi,
 * threshold, dan fungsi perhitungan poin resmi pemain FPL.
 */

export type FplPosition = 'GKP' | 'DEF' | 'MID' | 'FWD';

/**
 * Nilai poin dasar FPL per aksi / event pertandingan
 */
export const FPL_SCORING_TABLE = {
  // 1. Menit Bermain (Minutes Played)
  MINUTES: {
    UP_TO_60: 1,      // Bermain 1 - 59 menit (tidak termasuk injury time)
    AT_LEAST_60: 2,   // Bermain 60 menit atau lebih
  },

  // 2. Mencetak Gol (Goals Scored)
  GOAL_SCORED: {
    GKP: 6,
    DEF: 6,
    MID: 5,
    FWD: 4,
  },

  // 3. Assist (Goal Assists)
  ASSIST: 3,          // Diberikan untuk semua posisi

  // 4. Nirbobol (Clean Sheet) - Syarat: bermain minimal 60 menit
  CLEAN_SHEET: {
    GKP: 4,
    DEF: 4,
    MID: 1,
    FWD: 0,
  },

  // 5. Penyelamatan Kiper (Saves) - Akumulasi kelipatan 3
  SAVES: {
    THRESHOLD_PER_POINT: 3, // Setiap 3 shot saves = +1 poin
    POINTS: 1,
  },

  // 6. Menggagalkan Penalti (Penalty Saved)
  PENALTY_SAVED: 5,   // Khusus kiper yang menepis/menahan penalti

  // 7. Gagal Penalti (Penalty Missed)
  PENALTY_MISSED: -2, // Penendang penalti yang gagal/ditepis

  // 8. Kontribusi Bertahan (Defensive Contribution / DefCon / DC)
  // Diperkenalkan untuk mengapresiasi aksi defensif (Clearances, Blocks, Interceptions, Tackles, Recoveries)
  // Maksimal akumulasi per laga: 2 poin (Capped at 2 pts per match)
  DEFENSIVE_CONTRIBUTION: {
    POINTS: 2,
    THRESHOLDS: {
      DEF: 10,        // Bek: minimal 10 CBIT (Clearances + Blocks + Interceptions + Tackles)
      MID: 12,        // Gelandang: minimal 12 CBIRT (+ Recoveries)
      FWD: 12,        // Penyerang: minimal 12 CBIRT (+ Recoveries)
      GKP: Infinity,  // Kiper tidak mendapatkan poin DefCon
    },
  },

  // 9. Kebobolan (Goals Conceded) - Khusus GKP & DEF, akumulasi kelipatan 2
  GOALS_CONCEDED: {
    THRESHOLD_PER_POINT: 2, // Setiap 2 gol kebobolan saat pemain di lapangan = -1 poin
    POINTS_DEDUCTION: -1,
  },

  // 10. Kartu & Pelanggaran Disiplin
  YELLOW_CARD: -1,
  RED_CARD: -3,       // Kartu merah langsung maupun akumulasi dua kartu kuning

  // 11. Gol Bunuh Diri (Own Goal)
  OWN_GOAL: -2,

  // 12. Poin Bonus Pertandingan (Bonus Points System - BPS)
  BONUS: {
    RANK_1: 3,
    RANK_2: 2,
    RANK_3: 1,
  },
} as const;

/**
 * Aturan Bonus Points System (BPS) Opta
 */
export const FPL_BPS_METRICS = {
  PLAYING_UP_TO_60_MINS: 3,
  PLAYING_OVER_60_MINS: 6,
  GOAL_SCORED_FWD: 24,
  GOAL_SCORED_MID: 18,
  GOAL_SCORED_DEF_GKP: 12,
  ASSIST: 9,
  CLEAN_SHEET_GKP_DEF: 12,
  SAVING_PENALTY: 15,
  CONCEDING_PENALTY: -3,
  MISSING_PENALTY: -6,
  YELLOW_CARD: -3,
  RED_CARD: -9,
  OWN_GOAL: -6,
  PER_TWO_GOALS_CONCEDED_GKP_DEF: -4,
  PER_THREE_SAVES: 2,
  SUCCESSFUL_OPEN_PLAY_CROSS: 1,
  CREATING_BIG_CHANCE: 3,
  MISSING_BIG_CHANCE: -3,
  SHOT_ON_TARGET: 2,
  SUCCESSFUL_TACKLE: 2,
  PER_TWO_CBI: 1,         // Clearances, Blocks & Interceptions (setiap 2 aksi = +1 BPS)
  KEY_PASS: 1,
  PER_THREE_RECOVERIES: 1, // Ball recoveries (setiap 3 = +1 BPS)
  SUCCESSFUL_DRIBBLE: 1,
  ERROR_LEADING_TO_GOAL: -3,
  ERROR_LEADING_TO_ATTEMPT: -1,
  FOUL_CONCEDED: -1,
  OFFSIDE: -1,
  SHOT_OFF_TARGET: -1,
  MATCH_WINNING_GOAL: 3,
  PASS_COMPLETION: {
    MIN_ATTEMPTS: 30,
    RATE_70_TO_79: 2,
    RATE_80_TO_89: 4,
    RATE_90_PLUS: 6,
  },
} as const;

/**
 * Standar kode hierarki breakdown item poin FPL
 */
export const FPL_BREAKDOWN_ORDER_MAP: Record<string, number> = {
  MP: 1,   // Minutes Played
  GS: 2,   // Goals Scored
  A: 3,    // Assists
  CS: 4,   // Clean Sheet
  S: 5,    // Saves
  PS: 6,   // Penalties Saved
  DC: 7,   // Defensive Contribution
  GC: 8,   // Goals Conceded
  OG: 9,   // Own Goals
  PM: 10,  // Penalties Missed
  YC: 11,  // Yellow Cards
  RC: 12,  // Red Cards
  BP: 13,  // Bonus Points
};

export interface PlayerMatchStats {
  minutes?: number;
  goals_scored?: number;
  assists?: number;
  clean_sheets?: number;
  saves?: number;
  penalties_saved?: number;
  penalties_missed?: number;
  defensive_contribution?: number;
  goals_conceded?: number;
  own_goals?: number;
  yellow_cards?: number;
  red_cards?: number;
  bonus?: number;
  bps?: number;
}

export interface PointBreakdownItem {
  code: 'MP' | 'GS' | 'A' | 'CS' | 'S' | 'PS' | 'DC' | 'GC' | 'OG' | 'PM' | 'YC' | 'RC' | 'BP';
  value: number;
  points: number;
  order: number;
}

// ============================================================================
// FUNGSI-FUNGSI PERHITUNGAN POIN
// ============================================================================

/**
 * 1. Poin Menit Bermain (Minutes Played)
 * - 0 menit: 0 poin
 * - 1 - 59 menit: 1 poin
 * - >= 60 menit: 2 poin
 */
export function calculateMinutesPoints(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  return minutes >= 60 ? FPL_SCORING_TABLE.MINUTES.AT_LEAST_60 : FPL_SCORING_TABLE.MINUTES.UP_TO_60;
}

/**
 * 2. Poin Mencetak Gol (Goal Scored)
 * - GKP / DEF: 6 poin
 * - MID: 5 poin
 * - FWD: 4 poin
 */
export function calculateGoalPoints(position: FplPosition, goals: number): number {
  if (!goals || goals <= 0) return 0;
  const rate = FPL_SCORING_TABLE.GOAL_SCORED[position] || 4;
  return goals * rate;
}

/**
 * 3. Poin Assist
 * - Semua posisi: 3 poin per assist
 */
export function calculateAssistPoints(assists: number): number {
  if (!assists || assists <= 0) return 0;
  return assists * FPL_SCORING_TABLE.ASSIST;
}

/**
 * 4. Poin Clean Sheet (Nirbobol)
 * - Syarat mutlak: Bermain minimal 60 menit (minutes >= 60)
 * - GKP / DEF: 4 poin
 * - MID: 1 poin
 * - FWD: 0 poin
 */
export function calculateCleanSheetPoints(
  position: FplPosition,
  cleanSheets: number,
  minutes = 90
): number {
  if (!cleanSheets || cleanSheets <= 0) return 0;
  if (minutes < 60) return 0; // Tidak berhak jika < 60 menit
  const rate = FPL_SCORING_TABLE.CLEAN_SHEET[position] || 0;
  return cleanSheets * rate;
}

/**
 * 5. Poin Penyelamatan Kiper (Saves)
 * - Khusus GKP: Setiap 3 shot saves = 1 poin (kelipatan bawah)
 */
export function calculateSavesPoints(position: FplPosition, saves: number): number {
  if (position !== 'GKP' || !saves || saves < FPL_SCORING_TABLE.SAVES.THRESHOLD_PER_POINT) {
    return 0;
  }
  return Math.floor(saves / FPL_SCORING_TABLE.SAVES.THRESHOLD_PER_POINT) * FPL_SCORING_TABLE.SAVES.POINTS;
}

/**
 * 6. Poin Menggagalkan Penalti (Penalty Saved)
 * - Khusus kiper: 5 poin per penalti
 */
export function calculatePenaltySavedPoints(position: FplPosition, penaltiesSaved: number): number {
  if (position !== 'GKP' || !penaltiesSaved || penaltiesSaved <= 0) return 0;
  return penaltiesSaved * FPL_SCORING_TABLE.PENALTY_SAVED;
}

/**
 * 7. Poin Kontribusi Bertahan (Defensive Contribution / DefCon / DC)
 * - DEF: minimal 10 aksi CBIT -> +2 poin
 * - MID & FWD: minimal 12 aksi CBIRT -> +2 poin
 * - GKP: 0 poin
 * - Capped maksimal 2 poin per pertandingan
 */
export function calculateDefensiveContributionPoints(
  position: FplPosition,
  dcValue: number
): number {
  if (!dcValue || dcValue <= 0 || position === 'GKP') return 0;
  const threshold = FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.THRESHOLDS[position];
  if (dcValue >= threshold) {
    return FPL_SCORING_TABLE.DEFENSIVE_CONTRIBUTION.POINTS;
  }
  return 0;
}

/**
 * 8. Pengurangan Poin Kebobolan (Goals Conceded)
 * - Khusus GKP & DEF: Setiap 2 gol kebobolan saat pemain berada di lapangan = -1 poin
 * - MID & FWD tidak terkena penalti kebobolan
 */
export function calculateGoalsConcededPoints(
  position: FplPosition,
  goalsConceded: number
): number {
  if ((position !== 'GKP' && position !== 'DEF') || !goalsConceded || goalsConceded < 2) {
    return 0;
  }
  return Math.floor(goalsConceded / FPL_SCORING_TABLE.GOALS_CONCEDED.THRESHOLD_PER_POINT) *
    FPL_SCORING_TABLE.GOALS_CONCEDED.POINTS_DEDUCTION;
}

/**
 * 9. Pengurangan Poin Gol Bunuh Diri (Own Goal)
 * - -2 poin per gol bunuh diri
 */
export function calculateOwnGoalPoints(ownGoals: number): number {
  if (!ownGoals || ownGoals <= 0) return 0;
  return ownGoals * FPL_SCORING_TABLE.OWN_GOAL;
}

/**
 * 10. Pengurangan Poin Gagal Penalti (Penalty Missed)
 * - -2 poin per kegagalan penalti
 */
export function calculatePenaltyMissedPoints(penaltiesMissed: number): number {
  if (!penaltiesMissed || penaltiesMissed <= 0) return 0;
  return penaltiesMissed * FPL_SCORING_TABLE.PENALTY_MISSED;
}

/**
 * 11. Pengurangan Poin Kartu Kuning & Kartu Merah
 * - Kartu Kuning: -1 poin
 * - Kartu Merah: -3 poin
 */
export function calculateCardPoints(yellowCards: number, redCards: number) {
  const yellowPoints = (yellowCards || 0) * FPL_SCORING_TABLE.YELLOW_CARD;
  const redPoints = (redCards || 0) * FPL_SCORING_TABLE.RED_CARD;
  return {
    yellowPoints,
    redPoints,
    total: yellowPoints + redPoints,
  };
}

/**
 * Menghitung Total Poin Pemain dalam satu gameweek dari statistik mentah
 */
export function calculateTotalPlayerPoints(
  position: FplPosition,
  stats: PlayerMatchStats
): number {
  const minutes = stats.minutes || 0;
  const mp = calculateMinutesPoints(minutes);
  const gs = calculateGoalPoints(position, stats.goals_scored || 0);
  const a = calculateAssistPoints(stats.assists || 0);
  const cs = calculateCleanSheetPoints(position, stats.clean_sheets || 0, minutes);
  const s = calculateSavesPoints(position, stats.saves || 0);
  const ps = calculatePenaltySavedPoints(position, stats.penalties_saved || 0);
  const dc = calculateDefensiveContributionPoints(position, stats.defensive_contribution || 0);
  const gc = calculateGoalsConcededPoints(position, stats.goals_conceded || 0);
  const og = calculateOwnGoalPoints(stats.own_goals || 0);
  const pm = calculatePenaltyMissedPoints(stats.penalties_missed || 0);
  const { total: cards } = calculateCardPoints(stats.yellow_cards || 0, stats.red_cards || 0);
  const bp = stats.bonus || 0;

  return mp + gs + a + cs + s + ps + dc + gc + og + pm + cards + bp;
}

/**
 * Mengonversi statistik menjadi array breakdown poin resmi sesuai hierarki FPL
 */
export function getPlayerPointBreakdown(
  position: FplPosition,
  stats: PlayerMatchStats
): PointBreakdownItem[] {
  const items: PointBreakdownItem[] = [];
  const minutes = stats.minutes || 0;

  // 1. Minutes Played (MP)
  if (minutes > 0) {
    const pts = calculateMinutesPoints(minutes);
    items.push({ code: 'MP', value: minutes, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.MP });
  }

  // 2. Goals Scored (GS)
  if ((stats.goals_scored || 0) > 0) {
    const pts = calculateGoalPoints(position, stats.goals_scored!);
    items.push({ code: 'GS', value: stats.goals_scored!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.GS });
  }

  // 3. Assists (A)
  if ((stats.assists || 0) > 0) {
    const pts = calculateAssistPoints(stats.assists!);
    items.push({ code: 'A', value: stats.assists!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.A });
  }

  // 4. Clean Sheet (CS)
  if ((stats.clean_sheets || 0) > 0 && minutes >= 60) {
    const pts = calculateCleanSheetPoints(position, stats.clean_sheets!, minutes);
    if (pts > 0) {
      items.push({ code: 'CS', value: stats.clean_sheets!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.CS });
    }
  }

  // 5. Saves (S)
  if ((stats.saves || 0) > 0 && position === 'GKP') {
    const pts = calculateSavesPoints(position, stats.saves!);
    if (pts > 0) {
      items.push({ code: 'S', value: stats.saves!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.S });
    }
  }

  // 6. Penalties Saved (PS)
  if ((stats.penalties_saved || 0) > 0 && position === 'GKP') {
    const pts = calculatePenaltySavedPoints(position, stats.penalties_saved!);
    items.push({ code: 'PS', value: stats.penalties_saved!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.PS });
  }

  // 7. Defensive Contribution (DC)
  if ((stats.defensive_contribution || 0) > 0) {
    const pts = calculateDefensiveContributionPoints(position, stats.defensive_contribution!);
    if (pts > 0) {
      items.push({ code: 'DC', value: stats.defensive_contribution!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.DC });
    }
  }

  // 8. Goals Conceded (GC)
  if ((stats.goals_conceded || 0) >= 2 && (position === 'GKP' || position === 'DEF')) {
    const pts = calculateGoalsConcededPoints(position, stats.goals_conceded!);
    items.push({ code: 'GC', value: stats.goals_conceded!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.GC });
  }

  // 9. Own Goals (OG)
  if ((stats.own_goals || 0) > 0) {
    const pts = calculateOwnGoalPoints(stats.own_goals!);
    items.push({ code: 'OG', value: stats.own_goals!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.OG });
  }

  // 10. Penalties Missed (PM)
  if ((stats.penalties_missed || 0) > 0) {
    const pts = calculatePenaltyMissedPoints(stats.penalties_missed!);
    items.push({ code: 'PM', value: stats.penalties_missed!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.PM });
  }

  // 11. Yellow Cards (YC)
  if ((stats.yellow_cards || 0) > 0) {
    const pts = (stats.yellow_cards || 0) * FPL_SCORING_TABLE.YELLOW_CARD;
    items.push({ code: 'YC', value: stats.yellow_cards!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.YC });
  }

  // 12. Red Cards (RC)
  if ((stats.red_cards || 0) > 0) {
    const pts = (stats.red_cards || 0) * FPL_SCORING_TABLE.RED_CARD;
    items.push({ code: 'RC', value: stats.red_cards!, points: pts, order: FPL_BREAKDOWN_ORDER_MAP.RC });
  }

  // 13. Bonus Points (BP)
  if ((stats.bonus || 0) > 0) {
    items.push({ code: 'BP', value: stats.bonus!, points: stats.bonus!, order: FPL_BREAKDOWN_ORDER_MAP.BP });
  }

  // Fallback jika tidak bermain (0 menit)
  if (items.length === 0) {
    items.push({ code: 'MP', value: 0, points: 0, order: FPL_BREAKDOWN_ORDER_MAP.MP });
  }

  // Urutkan berdasarkan hierarki 1 s.d. 13
  return items.sort((a, b) => a.order - b.order);
}
