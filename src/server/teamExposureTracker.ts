import fs from 'fs';
import path from 'path';

/**
 * Counts the historical appearances of each team name across news_ticker_table.json
 */
export function getTeamAppearanceCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    const tablePath = path.join(process.cwd(), 'src/data/news_ticker_table.json');
    if (fs.existsSync(tablePath)) {
      const table = JSON.parse(fs.readFileSync(tablePath, 'utf-8'));
      for (const row of table) {
        for (const t of row.teams || []) {
          const clean = t.replace(/^\[T:/, '').replace(/\]$/, '').trim();
          if (clean) counts[clean] = (counts[clean] || 0) + 1;
        }
      }
    }
  } catch {}
  return counts;
}

/**
 * Sorts teams by least featured (Opsi B: Least Featured Queue).
 * Teams that have appeared least frequently in the news ticker are placed first.
 * If tied (e.g. 0 appearances), sorted deterministically via localeCompare.
 */
export function sortTeamsByLeastFeatured(teams: string[]): string[] {
  if (!teams || teams.length <= 1) return teams;
  const counts = getTeamAppearanceCounts();
  return [...teams].sort((a, b) => {
    const cleanA = a.replace(/^\[T:/, '').replace(/\]$/, '').trim();
    const cleanB = b.replace(/^\[T:/, '').replace(/\]$/, '').trim();
    const countA = counts[cleanA] || 0;
    const countB = counts[cleanB] || 0;
    if (countA !== countB) return countA - countB;
    return cleanA.localeCompare(cleanB);
  });
}

/**
 * Sorts any array of objects by least featured team name (Opsi B).
 */
export function sortObjectsByLeastFeaturedTeam<T>(
  items: T[],
  getTeamName: (item: T) => string
): T[] {
  if (!items || items.length <= 1) return items;
  const counts = getTeamAppearanceCounts();
  return [...items].sort((a, b) => {
    const cleanA = getTeamName(a).replace(/^\[T:/, '').replace(/\]$/, '').trim();
    const cleanB = getTeamName(b).replace(/^\[T:/, '').replace(/\]$/, '').trim();
    const countA = counts[cleanA] || 0;
    const countB = counts[cleanB] || 0;
    if (countA !== countB) return countA - countB;
    return cleanA.localeCompare(cleanB);
  });
}

