import fs from 'fs';
import path from 'path';

const TABLE_PATH = path.join(process.cwd(), 'src/data/news_ticker_table.json');

export interface CycleMeta {
  chance?: number;
  ownersCount?: number;
  cost?: number;
  specialRank?: number;
  pulseMatchId?: number;
  clockSecs?: number;
  isLmFallback?: boolean;
}

export interface WaveSchedulableStory {
  id: string;
  kategori: string;
  sub_kategori?: string;
  drama_score?: number;
  poin_tayang?: number;
  timestamp_produksi?: string;
  gw?: number;
  cycle_meta?: CycleMeta;
  [key: string]: any;
}

export type WaveScheduledPhase = 'Between Match' | 'Provisional' | 'Confirmed';
export type BatchCyclePhase = 'Not started' | WaveScheduledPhase;

const PHASE_WAVE_COUNT: Record<WaveScheduledPhase, number> = {
  'Between Match': 5,
  Provisional: 5,
  Confirmed: 5,
};

/**
 * Explicit SINGLE-NEWS wave assignments per phase.
 * Guarantee: Within every wave, NO two SINGLE-NEWS share the same category.
 */
const SINGLE_NEWS_WAVE_SLOTS: Record<WaveScheduledPhase, string[][]> = {
  'Between Match': [
    ['BM_STANDINGS_GAMEWEEK_LEADER'],
    ['BM_MATCH_FIXTURE_NEXT'],
    ['BM_STANDINGS_TITLE_RACE'],
    ['BM_CAPTAIN_POPULAR_RETURN'],
    ['BM_STANDINGS_WEEKLY_WINS_MOST'],
  ],
  Provisional: [
    ['PV_STANDINGS_GAMEWEEK_LEADER'],
    ['PV_PLAYER_TOP_PERFORMER'],
    ['PV_STANDINGS_TITLE_RACE'],
    ['PV_CAPTAIN_POPULAR_MOST_CAPTAINED'],
    ['PV_STANDINGS_TITLE_RACE_LEAD_CHANGE'],
  ],
  Confirmed: [
    ['CF_STANDINGS_GAMEWEEK_WINNER', 'CF_PLAYER_TOP_PERFORMER_GW_SCORER', 'CF_MATCH_NEXT_DEADLINE'],
    ['CF_STANDINGS_TITLE_RACE', 'CF_CAPTAIN_POPULAR_MOST_CAPTAINED', 'CF_MATCH_BONUS_POINTS'],
    ['CF_STANDINGS_WEEKLY_WINS_MOST', 'CF_TRANSFER_IN_MOST_BOUGHT', 'CF_MATCH_DEFENSIVE_CONTRIBUTION'],
    ['CF_STANDINGS_RANK_BIGGEST_RISE'],
    ['CF_STANDINGS_TITLE_RACE_LEAD_CHANGE'],
  ],
};

/**
 * Templates whose generated items follow an intentional special order (kickoff, bps, rankDiff, pts, etc.).
 * Templates NOT in this set rely on `poin_tayang ASC -> timestamp_produksi DESC`.
 */
const TEMPLATES_WITH_SPECIAL_SORT = new Set<string>([
  'NS_PLAYER_AVAILABILITY_FLAGGED',
  'BM_MATCH_SCORE_RESULT',
  'BM_MATCH_BONUS_POINTS',
  'BM_MATCH_INJURY',
  'BM_LINEUP_BENCH_POINTS',
  'BM_LINEUP_AUTOSUB_ALERT',
  'BM_LINEUP_REMAINING_ASSETS',
  'BM_STANDINGS_RANK_MOVEMENT',
  'BM_CAPTAIN_VICE_CAPTAIN',
  'BM_TRANSFER_HITS_EVALUATION',
  'BM_CAPTAIN_DIFFERENTIAL_RETURN',
  'BM_PLAYER_AVAILABILITY_FLAGGED',
  'PV_CAPTAIN_VICE_CAPTAIN',
  'PV_LINEUP_AUTOSUB_PENDING',
  'PV_LINEUP_BENCH_TOTAL',
  'PV_TRANSFER_HITS_EVALUATION',
  'PV_STANDINGS_RANK_MOVEMENT',
  'PV_TRANSFER_OUT_SOLD_HAULERS',
  'PV_CAPTAIN_ALTERNATIVE_MISSED_HAUL',
  'CF_LINEUP_AUTOSUB_CONFIRMED',
  'CF_TRANSFER_HITS_DEDUCTED',
  'CF_TRANSFER_OUT_SOLD_HAULERS',
  'CF_CAPTAIN_ALTERNATIVE_MISSED_HAUL',
  'CF_STANDINGS_RANK_BIGGEST_DROP',
  'CF_STANDINGS_TITLE_RACE_POINTS_GAP',
  'CF_LINEUP_BENCH_POINTS',
  'CF_CAPTAIN_VICE_CAPTAIN',
  'CF_CAPTAIN_DIFFERENTIAL_RETURN',
  'CF_LINEUP_DIFFERENTIAL_RETURN',
  'CF_PLAYER_AVAILABILITY_IMPACT',
  'CF_MATCH_NEXT_GW_FIXTURES',
]);

const NS_SINGLE_IDS = new Set<string>([
  'NS_MATCH_FIXTURE_OPENING',
  'NS_STANDINGS_TITLE_RACE',
  'NS_CAPTAIN_POPULAR_MOST_CAPTAINED',
  'NS_CHIP_WILDCARD',
  'NS_TRANSFER_HITS_MOST',
  'NS_CHIP_FREE_HIT',
  'NS_CAPTAIN_DIFFERENTIAL',
  'NS_STANDINGS_WEEKLY_WINS_MOST',
  'NS_CHIP_TRIPLE_CAPTAIN',
  'NS_TRANSFER_IN_MOST_BOUGHT',
  'NS_LINEUP_DIFFERENTIAL_XI',
  'NS_CHIP_BENCH_BOOST',
  'NS_TRANSFER_OUT_MOST_SOLD',
  'NS_CHIP_SUMMARY_USAGE',
  'NS_PLAYER_OWNERSHIP_MOST_OWNED',
]);

function readExistingPoinTayangMap(targetGw: number, phase: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    if (!fs.existsSync(TABLE_PATH)) return map;
    const raw = fs.readFileSync(TABLE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return map;
    const targetLower = phase.toLowerCase();
    for (const r of parsed) {
      if (!r || !r.id || typeof r.poin_tayang !== 'number') continue;
      if (targetGw && Number(r.gw) !== targetGw) continue;
      if (r.fase && String(r.fase).trim().toLowerCase() !== targetLower) continue;
      map.set(String(r.id), r.poin_tayang);
    }
  } catch {}
  return map;
}

function getAllSingleTemplateIdsForPhase(phase: WaveScheduledPhase): Set<string> {
  const set = new Set<string>();
  for (const waveIds of SINGLE_NEWS_WAVE_SLOTS[phase]) {
    for (const id of waveIds) set.add(id);
  }
  return set;
}

/**
 * Extracts parent template ID from a generated story ID.
 * E.g. "CF_MATCH_NEXT_GW_FIXTURES_1_man_city_fulham" -> "CF_MATCH_NEXT_GW_FIXTURES"
 */
export function resolveParentTemplateId(storyId: string, knownTemplateIds: string[]): string {
  const baseId = String(storyId || '').split('__')[0].trim();
  for (const tid of knownTemplateIds) {
    if (baseId === tid || baseId.startsWith(`${tid}_`)) {
      return tid;
    }
  }
  return baseId;
}

/**
 * Proportional cycle quota based on actual produced count per MULTI-NEWS template:
 * - 1..3 produced -> 1 per cycle
 * - 4..7 produced -> 2 per cycle
 * - >= 8 produced -> 3 per cycle
 */
export function getProportionalMultiQuota(producedCount: number): number {
  if (producedCount >= 8) return 3;
  if (producedCount >= 4) return 2;
  if (producedCount >= 1) return 1;
  return 0;
}

function parseTimestampMs(iso?: string): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Sorts candidates within a MULTI-NEWS pool for cycle batch selection:
 * 1. poin_tayang ASC (not aired / fewest aired first)
 * 2. Template's special sort order (if template defines one via cycle_meta.specialRank or generation index)
 * 3. timestamp_produksi DESC (newest produced story wins ties)
 */
function comparePoolCandidates(
  a: { story: WaveSchedulableStory; originalIdx: number; parentTemplateId: string },
  b: { story: WaveSchedulableStory; originalIdx: number; parentTemplateId: string }
): number {
  const poinDiff = (a.story.poin_tayang || 0) - (b.story.poin_tayang || 0);
  if (poinDiff !== 0) return poinDiff;

  if (TEMPLATES_WITH_SPECIAL_SORT.has(a.parentTemplateId)) {
    const rankA = a.story.cycle_meta?.specialRank ?? a.originalIdx;
    const rankB = b.story.cycle_meta?.specialRank ?? b.originalIdx;
    if (rankA !== rankB) return rankA - rankB;
  }

  const tsDiff = parseTimestampMs(b.story.timestamp_produksi) - parseTimestampMs(a.story.timestamp_produksi);
  if (tsDiff !== 0) return tsDiff;

  return a.originalIdx - b.originalIdx;
}

/**
 * Schedules BM, PV, or CF stories into balanced 5-wave sequence ensuring:
 * 1. SINGLE-NEWS category uniqueness within every wave (zero duplicate SINGLE-NEWS category per wave).
 * 2. Even distribution of MULTI-NEWS templates & produced counts across all 5 waves.
 * 3. Interleaving within and across waves (and wrap-around) so zero adjacent items share the same category.
 */
export function scheduleStoriesIntoWaves<T extends WaveSchedulableStory>(
  stories: T[],
  phase: WaveScheduledPhase,
  targetGw: number,
  knownTemplateIds: string[] = []
): T[] {
  if (!Array.isArray(stories) || stories.length <= 1) return stories;

  const waveCount = PHASE_WAVE_COUNT[phase];
  const slotDefs = SINGLE_NEWS_WAVE_SLOTS[phase];
  const singleIdSet = getAllSingleTemplateIdsForPhase(phase);
  const sortedKnownIds = [...knownTemplateIds].sort((a, b) => b.length - a.length);
  const existingPoints = readExistingPoinTayangMap(targetGw, phase);

  const prepared = stories.map((s, originalIdx) => ({
    story: {
      ...s,
      poin_tayang: s.poin_tayang ?? existingPoints.get(s.id) ?? 0,
    } as T,
    originalIdx,
    parentTemplateId: resolveParentTemplateId(s.id, sortedKnownIds),
    category: String(s.kategori || 'Other').trim(),
  }));

  type Entry = (typeof prepared)[number] & { isSingle: boolean };

  interface WaveBucket {
    items: Entry[];
    catCounts: Map<string, number>;
    singleCats: Set<string>;
    tmplCounts: Map<string, number>;
  }

  const waves: WaveBucket[] = Array.from({ length: waveCount }, () => ({
    items: [],
    catCounts: new Map<string, number>(),
    singleCats: new Set<string>(),
    tmplCounts: new Map<string, number>(),
  }));

  const addToWave = (wIdx: number, entry: Entry) => {
    const w = waves[wIdx];
    w.items.push(entry);
    w.catCounts.set(entry.category, (w.catCounts.get(entry.category) || 0) + 1);
    w.tmplCounts.set(entry.parentTemplateId, (w.tmplCounts.get(entry.parentTemplateId) || 0) + 1);
    if (entry.isSingle) {
      w.singleCats.add(entry.category);
    }
  };

  const singleSlotLookup = new Map<string, number>();
  slotDefs.forEach((ids, wIdx) => {
    for (const id of ids) singleSlotLookup.set(id, wIdx);
  });

  const multiByTemplate = new Map<string, Entry[]>();
  const unassignedSingles: Entry[] = [];

  for (const p of prepared) {
    const isSingle = singleIdSet.has(p.story.id) || singleIdSet.has(p.parentTemplateId);
    const entry: Entry = { ...p, isSingle };

    if (isSingle) {
      const targetWave = singleSlotLookup.get(p.story.id) ?? singleSlotLookup.get(p.parentTemplateId);
      if (targetWave !== undefined && !waves[targetWave].singleCats.has(entry.category)) {
        addToWave(targetWave, entry);
      } else {
        unassignedSingles.push(entry);
      }
    } else {
      if (!multiByTemplate.has(entry.parentTemplateId)) {
        multiByTemplate.set(entry.parentTemplateId, []);
      }
      multiByTemplate.get(entry.parentTemplateId)!.push(entry);
    }
  }

  for (const sEntry of unassignedSingles) {
    let bestWave = 0;
    let bestScore = Infinity;
    for (let wIdx = 0; wIdx < waveCount; wIdx++) {
      const w = waves[wIdx];
      const hasSingleCat = w.singleCats.has(sEntry.category) ? 10000 : 0;
      const catCount = w.catCounts.get(sEntry.category) || 0;
      const score = hasSingleCat + catCount * 100 + w.items.length;
      if (score < bestScore) {
        bestScore = score;
        bestWave = wIdx;
      }
    }
    addToWave(bestWave, sEntry);
  }

  const templateGroups = Array.from(multiByTemplate.entries()).map(([tid, list]) => {
    const sorted = [...list].sort(comparePoolCandidates);
    return { tid, category: sorted[0].category, list: sorted };
  });

  templateGroups.sort((a, b) => a.list.length - b.list.length || a.tid.localeCompare(b.tid));

  templateGroups.forEach((group, groupIdx) => {
    const startOffset = groupIdx % waveCount;
    group.list.forEach((entry, itemIdx) => {
      let bestWave = startOffset;
      let bestScore = Infinity;

      for (let step = 0; step < waveCount; step++) {
        const wIdx = (startOffset + step + itemIdx) % waveCount;
        const w = waves[wIdx];
        const catCount = w.catCounts.get(entry.category) || 0;
        const sameTmplCount = w.tmplCounts.get(entry.parentTemplateId) || 0;
        const singlePenalty = w.singleCats.has(entry.category) ? 25 : 0;
        const score =
          catCount * 1000 +
          sameTmplCount * 200 +
          singlePenalty +
          w.items.length * 10;

        if (score < bestScore) {
          bestScore = score;
          bestWave = wIdx;
        }
      }

      addToWave(bestWave, entry);
    });
  });

  const wave1AnchorCat = waves[0].items.find((e) => e.isSingle)?.category || '';
  const finalOrdered: T[] = [];
  let prevCategory = '';

  for (let wIdx = 0; wIdx < waveCount; wIdx++) {
    const pool = [...waves[wIdx].items];
    if (pool.length === 0) continue;

    const remCatCount = new Map<string, number>();
    for (const item of pool) {
      remCatCount.set(item.category, (remCatCount.get(item.category) || 0) + 1);
    }

    if (wIdx === 0) {
      const anchorIdx = pool.findIndex((e) => e.isSingle);
      if (anchorIdx >= 0) {
        const [anchor] = pool.splice(anchorIdx, 1);
        remCatCount.set(anchor.category, (remCatCount.get(anchor.category) || 1) - 1);
        finalOrdered.push(anchor.story);
        prevCategory = anchor.category;
      }
    }

    while (pool.length > 0) {
      const isLastWave = wIdx === waveCount - 1;
      let bestIdx = 0;
      let bestPriority = -Infinity;

      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        const notSameAsPrev = cand.category !== prevCategory ? 10000 : 0;
        const remForCat = remCatCount.get(cand.category) || 0;

        const boundaryPenalty =
          isLastWave && pool.length === 1 && wave1AnchorCat && cand.category === wave1AnchorCat
            ? -500
            : isLastWave && pool.length > 1 && wave1AnchorCat && cand.category === wave1AnchorCat
              ? 50
              : 0;

        const singleLeadBonus = cand.isSingle ? 25 : 0;
        const priority =
          notSameAsPrev +
          remForCat * 100 +
          boundaryPenalty +
          singleLeadBonus +
          (cand.story.drama_score || 80) * 0.01 -
          cand.originalIdx * 0.0001;

        if (priority > bestPriority) {
          bestPriority = priority;
          bestIdx = i;
        }
      }

      const [picked] = pool.splice(bestIdx, 1);
      remCatCount.set(picked.category, Math.max(0, (remCatCount.get(picked.category) || 1) - 1));
      finalOrdered.push(picked.story);
      prevCategory = picked.category;
    }
  }

  return finalOrdered;
}

/**
 * Selects the active 1-cycle feed batch WITHOUT mutating `status_tayang`.
 * All valid stories stay `status_tayang: 'Y'` in the DB table; `poin_tayang` alone
 * governs which MULTI-NEWS stories appear in the current cycle:
 * - SINGLE-NEWS: 100% included every cycle
 * - MULTI-NEWS: quota per template = 1 (if 1..3), 2 (if 4..7), 3 (if >= 8)
 *   chosen by: poin_tayang ASC -> special sort (if any) -> timestamp_produksi DESC
 * - NS_PLAYER_AVAILABILITY_FLAGGED preserves its special Wave 2 (chance ASC),
 *   Wave 4 (chance DESC), and Wave 3 (if quota=3) placement without category duplicates.
 */
export function selectCycleBatchForPhase<T extends WaveSchedulableStory>(
  activeRows: T[],
  phase: BatchCyclePhase,
  targetGw: number,
  knownTemplateIds: string[] = []
): T[] {
  if (!Array.isArray(activeRows) || activeRows.length === 0) return [];

  const sortedKnownIds = [...knownTemplateIds].sort((a, b) => b.length - a.length);

  if (phase === 'Not started') {
    const byId = new Map<string, T>();
    const surpriseLineupStories: T[] = [];
    const flaggedPool: T[] = [];

    for (const row of activeRows) {
      const parentId = resolveParentTemplateId(row.id, sortedKnownIds);
      if (parentId === 'NS_PLAYER_AVAILABILITY_FLAGGED') {
        flaggedPool.push(row);
      } else if (parentId === 'NS_LINEUP_SURPRISE_BENCHED') {
        surpriseLineupStories.push(row);
      } else if (NS_SINGLE_IDS.has(parentId) || NS_SINGLE_IDS.has(row.id)) {
        byId.set(parentId, row);
      } else {
        surpriseLineupStories.push(row);
      }
    }

    const flaggedQuota = getProportionalMultiQuota(flaggedPool.length);
    const getChance = (r: T): number => {
      if (typeof r.cycle_meta?.chance === 'number') return r.cycle_meta.chance;
      const text = String((r as any).text_berita || r.headline_id || '').toLowerCase();
      return text.includes('dipastikan absen') ? 0 : 50;
    };
    const getOwners = (r: T): number => r.cycle_meta?.ownersCount ?? 0;

    let slot1: T | undefined;
    let slot2: T | undefined;
    let slot3: T | undefined;
    const pickedIds = new Set<string>();

    // Slot 1 (Gelombang 2): poin_tayang ASC -> peluang_main ASC -> ownersCount DESC -> timestamp DESC
    if (flaggedQuota >= 1 && flaggedPool.length > 0) {
      const sortedAsc = [...flaggedPool].sort(
        (a, b) =>
          (a.poin_tayang || 0) - (b.poin_tayang || 0) ||
          getChance(a) - getChance(b) ||
          getOwners(b) - getOwners(a) ||
          parseTimestampMs(b.timestamp_produksi) - parseTimestampMs(a.timestamp_produksi)
      );
      slot1 = sortedAsc[0];
      if (slot1) pickedIds.add(slot1.id);
    }

    // Slot 2 (Gelombang 4): exclude Slot 1 -> poin_tayang ASC -> peluang_main DESC -> ownersCount DESC -> timestamp DESC
    if (flaggedQuota >= 2) {
      const rem2 = flaggedPool.filter((r) => !pickedIds.has(r.id));
      if (rem2.length > 0) {
        const sortedDesc = [...rem2].sort(
          (a, b) =>
            (a.poin_tayang || 0) - (b.poin_tayang || 0) ||
            getChance(b) - getChance(a) ||
            getOwners(b) - getOwners(a) ||
            parseTimestampMs(b.timestamp_produksi) - parseTimestampMs(a.timestamp_produksi)
        );
        slot2 = sortedDesc[0];
        if (slot2) pickedIds.add(slot2.id);
      }
    }

    // Slot 3 (Gelombang 3 — avoids Gelombang 5 Player duplicate): poin_tayang ASC -> ownersCount DESC -> timestamp DESC
    if (flaggedQuota >= 3) {
      const rem3 = flaggedPool.filter((r) => !pickedIds.has(r.id));
      if (rem3.length > 0) {
        const sortedOwners = [...rem3].sort(
          (a, b) =>
            (a.poin_tayang || 0) - (b.poin_tayang || 0) ||
            getOwners(b) - getOwners(a) ||
            parseTimestampMs(b.timestamp_produksi) - parseTimestampMs(a.timestamp_produksi)
        );
        slot3 = sortedOwners[0];
        if (slot3) pickedIds.add(slot3.id);
      }
    }

    const wave1 = [
      byId.get('NS_MATCH_FIXTURE_OPENING'),
      byId.get('NS_STANDINGS_TITLE_RACE'),
      byId.get('NS_CAPTAIN_POPULAR_MOST_CAPTAINED'),
      byId.get('NS_CHIP_WILDCARD'),
      ...surpriseLineupStories,
    ].filter(Boolean) as T[];

    const wave2 = [
      byId.get('NS_TRANSFER_HITS_MOST'),
      byId.get('NS_CHIP_FREE_HIT'),
      byId.get('NS_CAPTAIN_DIFFERENTIAL'),
      slot1,
    ].filter(Boolean) as T[];

    const wave3 = [
      byId.get('NS_STANDINGS_WEEKLY_WINS_MOST'),
      byId.get('NS_CHIP_TRIPLE_CAPTAIN'),
      byId.get('NS_TRANSFER_IN_MOST_BOUGHT'),
      slot3,
    ].filter(Boolean) as T[];

    const wave4 = [
      byId.get('NS_LINEUP_DIFFERENTIAL_XI'),
      byId.get('NS_CHIP_BENCH_BOOST'),
      byId.get('NS_TRANSFER_OUT_MOST_SOLD'),
      slot2,
    ].filter(Boolean) as T[];

    const wave5 = [
      byId.get('NS_CHIP_SUMMARY_USAGE'),
      byId.get('NS_PLAYER_OWNERSHIP_MOST_OWNED'),
    ].filter(Boolean) as T[];

    return [...wave1, ...wave2, ...wave3, ...wave4, ...wave5];
  }

  // Between Match, Provisional, Confirmed
  const singleIdSet = getAllSingleTemplateIdsForPhase(phase);
  const selectedSingles: T[] = [];
  const multiByTemplate = new Map<string, { story: T; originalIdx: number; parentTemplateId: string }[]>();

  activeRows.forEach((row, originalIdx) => {
    const parentId = resolveParentTemplateId(row.id, sortedKnownIds);
    const isSingle = singleIdSet.has(row.id) || singleIdSet.has(parentId);
    if (isSingle) {
      selectedSingles.push(row);
    } else {
      if (!multiByTemplate.has(parentId)) {
        multiByTemplate.set(parentId, []);
      }
      multiByTemplate.get(parentId)!.push({
        story: row,
        originalIdx,
        parentTemplateId: parentId,
      });
    }
  });

  const selectedMulti: T[] = [];
  for (const [, items] of multiByTemplate.entries()) {
    const quota = getProportionalMultiQuota(items.length);
    const sorted = [...items].sort(comparePoolCandidates);
    for (const picked of sorted.slice(0, quota)) {
      selectedMulti.push(picked.story);
    }
  }

  return scheduleStoriesIntoWaves([...selectedSingles, ...selectedMulti], phase, targetGw, sortedKnownIds);
}

/**
 * 12 post-deadline locked NS_* templates that remain 100% factual during Live Match
 * and serve strictly as fallback filler when LM active stories < 10.
 */
export const LM_FALLBACK_NS_TEMPLATE_IDS = new Set<string>([
  'NS_CHIP_WILDCARD',
  'NS_CHIP_FREE_HIT',
  'NS_CHIP_BENCH_BOOST',
  'NS_CHIP_TRIPLE_CAPTAIN',
  'NS_CHIP_SUMMARY_USAGE',
  'NS_CAPTAIN_POPULAR_MOST_CAPTAINED',
  'NS_CAPTAIN_DIFFERENTIAL',
  'NS_TRANSFER_IN_MOST_BOUGHT',
  'NS_TRANSFER_OUT_MOST_SOLD',
  'NS_TRANSFER_HITS_MOST',
  'NS_PLAYER_OWNERSHIP_MOST_OWNED',
  'NS_LINEUP_DIFFERENTIAL_XI',
]);

const LM_GROUP_A_ALWAYS_FULL = new Set<string>([
  'LM_STANDINGS_TITLE_RACE',
  'LM_MATCH_SCORE_LIVE',
]);

const LM_GROUP_A_QUOTA_CAPS: Record<string, number> = {
  LM_STANDINGS_RANK_MOVEMENT: 3,
  LM_MATCH_SAVES_GOALKEEPER: 2,
  LM_MATCH_DEFENSIVE_CONTRIBUTION: 2,
  LM_LINEUP_SURPRISE_BENCHED: 2,
};

const LM_GROUP_B_BREAKING = new Set<string>([
  'LM_MATCH_GOAL_MILESTONE',
  'LM_CAPTAIN_POPULAR_LIVE',
  'LM_MATCH_PENALTY_GOAL',
  'LM_MATCH_GOAL_OPEN_PLAY',
  'LM_MATCH_GOAL_OWN',
  'LM_MATCH_VAR_REVIEW',
  'LM_MATCH_PENALTY_SAVED',
  'LM_MATCH_PENALTY_MISSED',
  'LM_MATCH_CARD_STRAIGHT_RED',
  'LM_MATCH_CARD_SECOND_YELLOW',
  'LM_MATCH_PENALTY_AWARDED',
  'LM_MATCH_CLEAN_SHEET_LOST',
  'LM_MATCH_PERIOD_END',
]);

const LM_GROUP_C_MINOR = new Set<string>([
  'LM_MATCH_PERIOD_START',
  'LM_MATCH_CARD_YELLOW',
  'LM_MATCH_SUBSTITUTION',
]);

/**
 * Selects and interleaves a compact micro-cycle (~10–22 items) for Live Match:
 * - Group A (Snapshot Inti): Title Race & Live Scores 100%, Rank/Saves/DefCon/Lineup capped proportionally.
 * - Group B (Breaking Events): Breaking new items (poin=0) fast-tracked, retired from feed at poin >= 3.
 * - Group C (Minor Events): Strictly capped (1–2 per micro-cycle) and retired at poin >= 1 (or >= 2 for Kickoff / CS-impacting Subs).
 * - Group D (12 NS Fallback): Pulled strictly by poin_tayang ASC ONLY when total active LM picks < 10.
 * - Last-resort fallback: if total < 6 even after NS fallback, pulls retired Group B items by poin_tayang ASC.
 */
export function selectLiveMatchCycleBatch<T extends WaveSchedulableStory>(
  activeRows: T[],
  knownTemplateIds: string[] = []
): T[] {
  if (!Array.isArray(activeRows) || activeRows.length === 0) return [];

  const sortedKnownIds = [...knownTemplateIds].sort((a, b) => b.length - a.length);
  const getClockSecs = (r: T): number =>
    Number(r.cycle_meta?.clockSecs ?? (r as any).clockSecs ?? 0) || 0;
  const getMatchId = (r: T): number =>
    Number(r.cycle_meta?.pulseMatchId ?? (r as any).pulseMatchId ?? 0) || 0;

  type Wrapped = { row: T; parentId: string; originalIdx: number };

  const groupAFull: Wrapped[] = [];
  const groupAQuotaMap = new Map<string, Wrapped[]>();
  const groupBByTmpl = new Map<string, Wrapped[]>();
  const expiredGroupB: Wrapped[] = [];
  const groupCByTmpl = new Map<string, Wrapped[]>();
  const groupDFallback: Wrapped[] = [];

  activeRows.forEach((row, originalIdx) => {
    const parentId = resolveParentTemplateId(row.id, sortedKnownIds);
    const wrapped: Wrapped = { row, parentId, originalIdx };

    if (LM_FALLBACK_NS_TEMPLATE_IDS.has(parentId) || row.cycle_meta?.isLmFallback) {
      groupDFallback.push(wrapped);
      return;
    }

    if (LM_GROUP_A_ALWAYS_FULL.has(parentId)) {
      groupAFull.push(wrapped);
      return;
    }

    if (LM_GROUP_A_QUOTA_CAPS[parentId] !== undefined) {
      if (!groupAQuotaMap.has(parentId)) groupAQuotaMap.set(parentId, []);
      groupAQuotaMap.get(parentId)!.push(wrapped);
      return;
    }

    if (LM_GROUP_B_BREAKING.has(parentId)) {
      if ((row.poin_tayang || 0) < 3) {
        if (!groupBByTmpl.has(parentId)) groupBByTmpl.set(parentId, []);
        groupBByTmpl.get(parentId)!.push(wrapped);
      } else {
        expiredGroupB.push(wrapped);
      }
      return;
    }

    if (LM_GROUP_C_MINOR.has(parentId)) {
      const pts = row.poin_tayang || 0;
      const drama = row.drama_score || 0;
      const isEligible =
        parentId === 'LM_MATCH_PERIOD_START'
          ? pts < 2
          : parentId === 'LM_MATCH_CARD_YELLOW'
            ? pts < 1
            : drama >= 80
              ? pts < 2
              : pts < 1;

      if (isEligible) {
        if (!groupCByTmpl.has(parentId)) groupCByTmpl.set(parentId, []);
        groupCByTmpl.get(parentId)!.push(wrapped);
      }
      return;
    }

    // Any other custom LM_* template treated gracefully as capped snapshot
    if (!groupAQuotaMap.has(parentId)) groupAQuotaMap.set(parentId, []);
    groupAQuotaMap.get(parentId)!.push(wrapped);
  });

  const compareSnapshot = (a: Wrapped, b: Wrapped): number =>
    (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
    (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
    parseTimestampMs(b.row.timestamp_produksi) - parseTimestampMs(a.row.timestamp_produksi) ||
    a.originalIdx - b.originalIdx;

  const compareEvent = (a: Wrapped, b: Wrapped): number =>
    (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
    (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
    getClockSecs(b.row) - getClockSecs(a.row) ||
    parseTimestampMs(b.row.timestamp_produksi) - parseTimestampMs(a.row.timestamp_produksi) ||
    a.originalIdx - b.originalIdx;

  const freshBreaking: Wrapped[] = [];
  const mainBody: Wrapped[] = [];

  // 1. Group A Full (Title Race + all Live Scores)
  mainBody.push(...[...groupAFull].sort(compareSnapshot));

  // 2. Group A Capped Snapshots
  for (const [tid, list] of groupAQuotaMap.entries()) {
    const cap = LM_GROUP_A_QUOTA_CAPS[tid] ?? 2;
    const quota = Math.min(cap, getProportionalMultiQuota(list.length));
    const sorted = [...list].sort(compareSnapshot);
    mainBody.push(...sorted.slice(0, quota));
  }

  // 3. Group B Breaking Events (poin = 0 fast-tracked up to 8 total across matches, else proportional 1..3)
  let freshBreakingRemaining = 8;
  const allGroupBFreshCandidates: Wrapped[] = [];
  const groupBSeenIds = new Set<string>();

  for (const list of groupBByTmpl.values()) {
    for (const w of list) {
      if ((w.row.poin_tayang || 0) === 0) {
        allGroupBFreshCandidates.push(w);
      }
    }
  }
  allGroupBFreshCandidates.sort(compareEvent);
  for (const w of allGroupBFreshCandidates) {
    if (freshBreakingRemaining <= 0) break;
    freshBreaking.push(w);
    groupBSeenIds.add(w.row.id);
    freshBreakingRemaining--;
  }

  for (const list of groupBByTmpl.values()) {
    const remaining = list.filter((w) => !groupBSeenIds.has(w.row.id)).sort(compareEvent);
    if (remaining.length === 0) continue;
    const pickedFromTmplAlready = list.filter((w) => groupBSeenIds.has(w.row.id)).length;
    const targetQuota = getProportionalMultiQuota(list.length);
    const needed = Math.max(0, targetQuota - pickedFromTmplAlready);
    if (needed > 0) {
      mainBody.push(...remaining.slice(0, needed));
    }
  }

  // 4. Group C Minor Events (strict 1–2 cap)
  for (const [tid, list] of groupCByTmpl.entries()) {
    const quota =
      tid === 'LM_MATCH_CARD_YELLOW'
        ? list.length >= 4
          ? 2
          : 1
        : Math.min(2, getProportionalMultiQuota(list.length));
    const sorted = [...list].sort(compareEvent);
    mainBody.push(...sorted.slice(0, quota));
  }

  const pickedLmCount = freshBreaking.length + mainBody.length;

  // 5. Group D 12 NS Fallback (STRICTLY only if picked LM < 10)
  if (pickedLmCount < 10 && groupDFallback.length > 0) {
    const needed = 10 - pickedLmCount;
    const sortedFallback = [...groupDFallback].sort(
      (a, b) =>
        (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
        parseTimestampMs(b.row.timestamp_produksi) - parseTimestampMs(a.row.timestamp_produksi) ||
        (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
        a.originalIdx - b.originalIdx
    );
    mainBody.push(...sortedFallback.slice(0, needed));
  }

  // 6. Last-resort fallback if still < 6 items (very quiet single match without chip fallback)
  if (freshBreaking.length + mainBody.length < 6 && expiredGroupB.length > 0) {
    const needed = 6 - (freshBreaking.length + mainBody.length);
    const sortedExpired = [...expiredGroupB].sort(compareEvent);
    mainBody.push(...sortedExpired.slice(0, needed));
  }

  // Interleave sequence so consecutive items avoid repeating the same category or match when alternatives exist
  const interleavePool = (poolInput: Wrapped[], startPrevCat = '', startPrevMatchId = 0): Wrapped[] => {
    const pool = [...poolInput];
    const out: Wrapped[] = [];
    let prevCat = startPrevCat;
    let prevMatchId = startPrevMatchId;

    while (pool.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        const cat = String(cand.row.kategori || '').trim();
        const matchId = getMatchId(cand.row);

        const diffCatScore = prevCat && cat !== prevCat ? 10000 : 0;
        const diffMatchScore = prevMatchId && matchId && matchId !== prevMatchId ? 2000 : 0;
        const freshBonus = (cand.row.poin_tayang || 0) === 0 ? 500 : 0;
        const score =
          diffCatScore +
          diffMatchScore +
          freshBonus +
          (cand.row.drama_score || 80) * 1 -
          i * 0.01;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const [picked] = pool.splice(bestIdx, 1);
      out.push(picked);
      prevCat = String(picked.row.kategori || '').trim();
      const pickedMatchId = getMatchId(picked.row);
      if (pickedMatchId) prevMatchId = pickedMatchId;
    }

    return out;
  };

  const orderedBreaking = interleavePool(freshBreaking);
  const lastBreaking = orderedBreaking[orderedBreaking.length - 1];
  const orderedBody = interleavePool(
    mainBody,
    lastBreaking ? String(lastBreaking.row.kategori || '').trim() : '',
    lastBreaking ? getMatchId(lastBreaking.row) : 0
  );

  return [...orderedBreaking, ...orderedBody].map((w) => w.row);
}
