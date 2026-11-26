import { DbPlayerStat } from '../types.ts';

export type AvailabilityHighlightTier = '75' | '25_50' | 'out';

export interface PlayerAvailabilityHighlight {
  tier: AvailabilityHighlightTier;
  status: string;
  chance: number | null;
  news: string;
  /** Exact Solid Official FPL hex matching PlayerDetailModal availabilityBannerTheme */
  hexColor: string;
  /** Contrasting exclamation mark color inside the colored triangle */
  iconColor: string;
  /** Subtle outer border stroke color so the triangle remains crisp on any background */
  strokeColor: string;
  /** Exact Solid Official FPL colors matching PlayerDetailModal availabilityBannerTheme */
  colorClass: string;
  tooltip: string;
}

export interface AvailabilityLikePlayer {
  id?: number;
  status?: string | null;
  chanceOfPlayingNextRound?: number | null;
  chance_of_playing_next_round?: number | null;
  chanceOfPlayingThisRound?: number | null;
  chance_of_playing_this_round?: number | null;
  chance?: number | null;
  news?: string | null;
}

function parseChanceFromNews(news: string): number | null {
  if (!news) return null;
  const m = news.match(/\b(0|25|50|75)\s*%\s*chance/i);
  if (m) return Number(m[1]);
  return null;
}

export function resolvePlayerAvailabilityHighlight(
  player: AvailabilityLikePlayer | DbPlayerStat | null | undefined,
  language: 'id' | 'en' = 'id'
): PlayerAvailabilityHighlight | null {
  if (!player) return null;

  const status = String(player.status || 'a').toLowerCase().trim();
  const news = String(player.news || '').trim();

  const rawNext =
    (player as any).chanceOfPlayingNextRound ??
    (player as any).chance_of_playing_next_round;
  const rawThis =
    (player as any).chanceOfPlayingThisRound ??
    (player as any).chance_of_playing_this_round;
  const rawGeneric = (player as any).chance;

  let chance: number | null = null;
  if (rawNext !== undefined && rawNext !== null) {
    chance = Number(rawNext);
  } else if (rawThis !== undefined && rawThis !== null) {
    chance = Number(rawThis);
  } else if (rawGeneric !== undefined && rawGeneric !== null) {
    chance = Number(rawGeneric);
  } else if (status === 'd') {
    chance = parseChanceFromNews(news) ?? 75;
  }

  // Available players (status 'a') are never highlighted
  const isFlaggedStatus = status === 'd' || status === 'i' || status === 's' || status === 'u';
  if (!isFlaggedStatus) {
    return null;
  }

  let tier: AvailabilityHighlightTier;
  let hexColor: string;
  let iconColor: string;
  let strokeColor: string;
  let colorClass: string;
  if (chance === 75) {
    tier = '75';
    hexColor = '#ffd700';
    iconColor = '#37003c';
    strokeColor = '#d4ad00';
    colorClass = 'bg-[#ffd700] text-[#37003c]';
  } else if (chance === 50 || chance === 25) {
    tier = '25_50';
    hexColor = '#ff6900';
    iconColor = '#ffffff';
    strokeColor = '#d95800';
    colorClass = 'bg-[#ff6900] text-white';
  } else {
    tier = 'out';
    hexColor = '#e90052';
    iconColor = '#ffffff';
    strokeColor = '#c20044';
    colorClass = 'bg-[#e90052] text-white';
  }

  let statusText: string;
  if (status === 's') {
    statusText = language === 'id' ? 'Sanksi (0%)' : 'Suspended (0%)';
  } else if (status === 'i') {
    statusText = language === 'id' ? 'Cedera (0%)' : 'Injured (0%)';
  } else if (status === 'u') {
    statusText = language === 'id' ? 'Tidak tersedia (0%)' : 'Unavailable (0%)';
  } else {
    const pct = chance ?? 75;
    statusText = language === 'id' ? `Diragukan (${pct}% peluang main)` : `Doubtful (${pct}% chance of playing)`;
  }

  const tooltip = news || statusText;

  return {
    tier,
    status,
    chance,
    news,
    hexColor,
    iconColor,
    strokeColor,
    colorClass,
    tooltip,
  };
}
