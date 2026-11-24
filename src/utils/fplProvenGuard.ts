import { DbPlayerStat, FplProvenStatus, FplProvenTier, PositionType } from '../types.ts';
import pastSeasonRaw from '../data/playersPastSeason2025_26.json';
import { PLAYER_EXPLOSIVE_CATALOG, PlayerExplosiveProfile } from '../data/playerExplosiveCatalog.ts';

export type { FplProvenTier, FplProvenStatus };

export interface PastSeasonPlayerRecord {
  id: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
}

const pastSeasonMap = pastSeasonRaw as Record<string, PastSeasonPlayerRecord>;

/**
 * Evaluates whether a player is "FPL Proven" based on their past season history
 * AND current season minutes / role security.
 *
 * CRITICAL RULE:
 * A player who had a good past season but has MINIMAL MINUTES in the current season
 * despite being fully fit (e.g. Marcos Senesi) is NOT considered FPL Proven.
 * Proven status is only applied to players who actively maintain a regular/starting role
 * in the current Premier League season, acting as a guard against temporary 2-GW blanks (like Haaland/Salah).
 */
export interface FplProvenCausalOptions {
  minGw?: number;
  maxGw?: number;
  strictCausal?: boolean;
}

export function getFplProvenStatus(
  player: Partial<DbPlayerStat>,
  options?: FplProvenCausalOptions
): FplProvenStatus {
  const id = player.id || 0;
  const webName = player.webName || '';
  const pos = (player.position || 'MID') as PositionType;
  const costMil = typeof player.nowCost === 'number'
    ? (player.nowCost > 20 ? player.nowCost / 10 : player.nowCost)
    : 5.0;

  const hasWindowFilter =
    Boolean(options?.strictCausal) ||
    options?.minGw !== undefined ||
    options?.maxGw !== undefined;
  const minGw = Math.max(1, options?.minGw ?? 1);
  const maxGw = Math.min(38, options?.maxGw ?? 38);

  const past = pastSeasonMap[String(id)];
  const expProfile: PlayerExplosiveProfile | undefined = PLAYER_EXPLOSIVE_CATALOG[id];

  const pastPts = past?.total_points || 0;
  const pastMins = past?.minutes || 0;

  // 1. Current Season Minutes & Role Verification (filtered to [minGw..maxGw] when causal bounds provided)
  const rawHistory = player.gwHistory || [];
  const gwHistory = hasWindowFilter
    ? rawHistory.filter((h) => {
        const r = Number(h?.round || 0);
        return r >= minGw && r <= maxGw;
      })
    : rawHistory;
  const completedGWsCount = Math.max(gwHistory.length, 1);
  const histMins = gwHistory.reduce((s, h) => s + Number(h.minutes || 0), 0);
  const histStarts = gwHistory.filter((h) => Number(h.minutes || 0) >= 55).length;
  const histPts = gwHistory.reduce((s, h) => s + Number(h.points || 0), 0);
  const histPlayed = gwHistory.filter((h) => Number(h.minutes || 0) > 0).length;

  const currentMins = options?.strictCausal
    ? (gwHistory.length > 0 ? histMins : Number(player.minutes || 0))
    : Number(player.minutes || 0);
  const currentStarts = options?.strictCausal
    ? (gwHistory.length > 0 ? histStarts : Number(player.starts || 0))
    : Number(player.starts || 0);
  const currentStatus = player.status || 'a';
  const currentPpg = options?.strictCausal
    ? (histPlayed > 0 ? Number((histPts / histPlayed).toFixed(1)) : Number(player.pointsPerGame || 0))
    : Number(player.pointsPerGame || 0);

  // Minutes per completed GW
  const minsPerGW = currentMins / completedGWsCount;
  const startRatio = currentStarts / completedGWsCount;

  // 2. Current Season GW History Returns
  let playedGWCount = 0;
  let returnGWCount = 0;

  for (const h of gwHistory) {
    if (h.minutes >= 30) {
      playedGWCount++;
      const hasReturn = pos === 'DEF' || pos === 'GKP'
        ? (h.goals > 0 || h.assists > 0 || (h.cleanSheets !== undefined && h.cleanSheets > 0) || h.points >= 6)
        : (h.goals > 0 || h.assists > 0 || h.points >= 5);
      if (hasReturn) returnGWCount++;
    }
  }

  const returnRate = playedGWCount > 0 ? Math.round((returnGWCount / playedGWCount) * 100) : 0;
  const historyHauls = gwHistory.filter((h) => Number(h.points || 0) >= 10).length;
  const causalCatalogHauls = expProfile
    ? hasWindowFilter
      ? (expProfile.haulGWs || []).filter((hw) => hw.gw >= minGw && hw.gw <= maxGw).length
      : (expProfile.hauls ?? 0)
    : 0;
  const doubleDigitHauls = options?.strictCausal
    ? Math.max(Number(player.doubleDigitHauls ?? 0), historyHauls)
    : Math.max(
        Number(player.doubleDigitHauls ?? 0),
        historyHauls,
        causalCatalogHauls
      );

  // HARD GATEWAY: Fit Benchwarmer Filter
  // If at least 3 GWs have elapsed, and player is fully fit ('a'),
  // but averages < 45 minutes per GW or has started < 35% of games,
  // or has an extremely low PPG (< 2.2 for DEF, < 2.5 for MID/FWD):
  // They are strictly NOT FPL Proven for current season projections (e.g. Senesi).
  if (completedGWsCount >= 3 && currentStatus === 'a') {
    if (minsPerGW < 45 || startRatio < 0.35 || (completedGWsCount >= 5 && currentMins < 270) || (completedGWsCount >= 5 && currentPpg < 2.2)) {
      return {
        playerId: id,
        webName,
        tier: 'REGULAR',
        isProven: false,
        score: 0,
        guardFactor: 0,
        maxBlankDropPenalty: -0.60,
        provenXpFloor: 0,
        badgeLabel: '',
        badgeClass: '',
        pastPoints: pastPts,
        pastMinutes: pastMins,
        returnRate,
        doubleDigitHauls,
        guardDescription: 'Regular: Menit bermain minim di musim berjalan meskipun fit.'
      };
    }
  }

  // ==========================================================================
  // COMPOSITE PROVEN SCORING (0 to 100)
  // Rebalanced: Current season role & minutes account for 40%, past output 30%, returns & caliber 30%
  // ==========================================================================
  let score = 0;

  // A. Current Season Minutes Security & Nailedness (Max 40 pts)
  if (minsPerGW >= 80) score += 40;
  else if (minsPerGW >= 70) score += 32;
  else if (minsPerGW >= 55) score += 20;
  else if (minsPerGW >= 45) score += 10;

  // B. Past Season Proven Pedigree (Max 30 pts)
  const pastPtsPer90 = pastMins >= 900 ? (pastPts / pastMins) * 90 : 0;
  if (pastPts >= 210 || (pastMins >= 1800 && pastPtsPer90 >= 6.8)) score += 30;
  else if (pastPts >= 180 || (pastMins >= 1800 && pastPtsPer90 >= 6.0)) score += 24;
  else if (pastPts >= 155 || (pastMins >= 1500 && pastPtsPer90 >= 5.2)) score += 18;
  else if (pastPts >= 135 || (pastMins >= 1500 && pastPtsPer90 >= 4.7)) score += 12;
  else if (pastPts >= 110) score += 6;

  // C. Current Season GW Returns & PPG (Max 20 pts)
  if (returnRate >= 50) score += 12;
  else if (returnRate >= 38) score += 8;
  else if (returnRate >= 25) score += 4;

  if (currentPpg >= 6.0) score += 8;
  else if (currentPpg >= 4.5) score += 5;
  else if (currentPpg >= 3.5) score += 2;

  // D. Explosiveness & Market Caliber (Max 10 pts)
  if (doubleDigitHauls >= 2) score += 6;
  else if (doubleDigitHauls === 1) score += 3;

  if (costMil >= 11.5) score += 4; // Haaland, Salah tier
  else if (costMil >= 9.0) score += 2; // Saka, Palmer, Son tier

  score = Math.min(100, Math.max(0, score));

  // ==========================================================================
  // TIER ASSIGNMENT & GUARD STRENGTH
  // ==========================================================================
  let tier: FplProvenTier = 'REGULAR';
  let guardFactor = 0;
  let maxBlankDropPenalty = -0.60;
  let provenXpFloor = 0;
  let badgeLabel = '';
  let badgeClass = '';
  let guardDescription = '';

  const hasElitePast = pastPts >= 170 || (pastMins >= 1800 && pastPtsPer90 >= 6.0);
  const hasEstablishedPast = pastPts >= 135 || (pastMins >= 1500 && pastPtsPer90 >= 4.7);

  // ELITE PROVEN:
  // Must have proven past pedigree AND active starter security (minsPerGW >= 65, PPG >= 4.5)
  const isEliteEligible = score >= 75 && hasElitePast && minsPerGW >= 65 && currentPpg >= 4.5;
  // ESTABLISHED PROVEN:
  // Must have established past pedigree AND active starter security (minsPerGW >= 55, PPG >= 3.2)
  const isEstablishedEligible = score >= 55 && hasEstablishedPast && minsPerGW >= 55 && currentPpg >= 3.2;

  if (isEliteEligible) {
    tier = 'ELITE';
    guardFactor = 0.70; // Cushions 70% of 2-GW blank drop
    maxBlankDropPenalty = -0.18; // Max negative form penalty is capped at -0.18 instead of -0.60
    provenXpFloor = pos === 'FWD' ? 5.2 : pos === 'MID' ? 4.8 : 4.0;
    badgeLabel = 'Elite Proven 🌟';
    badgeClass = 'bg-amber-500/15 text-amber-500 dark:text-amber-300 border-amber-500/40';
    guardDescription = 'Elite Proven: Dilindungi dari recency drop & mendapat bantalan reliabilitas xP.';
  } else if (isEstablishedEligible) {
    tier = 'ESTABLISHED';
    guardFactor = 0.45; // Cushions 45% of 2-GW blank drop
    maxBlankDropPenalty = -0.30;
    provenXpFloor = pos === 'FWD' ? 4.3 : pos === 'MID' ? 4.0 : 3.4;
    badgeLabel = 'FPL Proven 💎';
    badgeClass = 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/40';
    guardDescription = 'FPL Proven: Menit bermain reguler dan rekam jejak poin teruji.';
  } else {
    tier = 'REGULAR';
    guardFactor = 0;
    maxBlankDropPenalty = -0.60;
    provenXpFloor = 0;
    badgeLabel = '';
    badgeClass = '';
    guardDescription = 'Regular: Tidak ada bantalan proven.';
  }

  return {
    playerId: id,
    webName,
    tier,
    isProven: tier === 'ELITE' || tier === 'ESTABLISHED',
    score,
    guardFactor,
    maxBlankDropPenalty,
    provenXpFloor,
    badgeLabel,
    badgeClass,
    pastPoints: pastPts,
    pastMinutes: pastMins,
    returnRate,
    doubleDigitHauls,
    guardDescription
  };
}
