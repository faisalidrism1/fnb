import { TransformedLeagueData, MatchCardItem } from '../types.ts';
import { Language } from '../utils/i18n.ts';

export interface NewsItem {
  tag: string;
  text: string;
  isFresh?: boolean;
}

/**
 * Generator kosong siap untuk dibangun ulang dari awal sesuai rancangan baru.
 */
export function generateNewsFromCatalog(
  _data?: TransformedLeagueData | null,
  _lang: Language = 'fnb',
  _matches?: MatchCardItem[] | null
): NewsItem[] {
  return [];
}
