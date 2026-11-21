import fs from 'fs';
import path from 'path';

const TABLE_PATH = path.join(process.cwd(), 'src/data/news_ticker_table.json');

export type LiveNewsroomTier = 'P1' | 'P2' | 'P3' | 'P4' | 'FALLBACK';

export interface CycleMeta {
  chance?: number;
  ownersCount?: number;
  cost?: number;
  specialRank?: number;
  pulseMatchId?: number;
  clockSecs?: number;
  detectedClockSecs?: number;
  isLmFallback?: boolean;
  maxOwnerPct?: number;
  isCsSub?: boolean;
  isHalfTime?: boolean;
  isFullTime?: boolean;
  isSecondHalf?: boolean;
  hasGoals?: boolean;
  hasRankChange?: boolean;
  rankDiff?: number;
  scoreSig?: string;
  matchKey?: string;
  newsroomTier?: LiveNewsroomTier;
  isPenaltyCancelled?: boolean;
  lastAiredAtMs?: number;
  lastAiredScoreSig?: string;
  lastAiredHeadline?: string;
  isUpcomingMatch?: boolean;
  kickoffTimeMs?: number;
  preKickoffPtsBaseline?: number;
}

export interface WaveSchedulableStory {
  id: string;
  kategori: string;
  sub_kategori?: string;
  drama_score?: number;
  poin_tayang?: number;
  timestamp_produksi?: string;
  gw?: number;
  newsroom_tier?: LiveNewsroomTier;
  score_sig?: string;
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

    surpriseLineupStories.sort(
      (a, b) =>
        (a.poin_tayang || 0) - (b.poin_tayang || 0) ||
        (b.drama_score || 0) - (a.drama_score || 0) ||
        parseTimestampMs(b.timestamp_produksi) - parseTimestampMs(a.timestamp_produksi)
    );

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
  for (const [parentId, items] of multiByTemplate.entries()) {
    const quota =
      parentId === 'BM_LINEUP_SURPRISE_BENCHED'
        ? items.length
        : getProportionalMultiQuota(items.length);
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

const LM_P1_BASE_IDS = new Set<string>([
  'LM_MATCH_VAR_REVIEW',
  'LM_MATCH_GOAL_MILESTONE',
  'LM_MATCH_GOAL_OPEN_PLAY',
  'LM_MATCH_PENALTY_GOAL',
  'LM_MATCH_GOAL_OWN',
  'LM_CAPTAIN_POPULAR_LIVE',
  'LM_MATCH_PENALTY_SAVED',
  'LM_MATCH_PENALTY_MISSED',
  'LM_MATCH_PENALTY_AWARDED',
  'LM_MATCH_CARD_STRAIGHT_RED',
  'LM_MATCH_CARD_SECOND_YELLOW',
]);

const LM_P2_BASE_IDS = new Set<string>([
  'LM_MATCH_SAVES_GOALKEEPER',
  'LM_MATCH_DEFENSIVE_CONTRIBUTION',
  'LM_LINEUP_SURPRISE_BENCHED',
  'LM_MATCH_PERIOD_START',
  'LM_MATCH_PERIOD_END',
]);

const LM_P1_ANCHOR_IDS = new Set<string>([
  'LM_MATCH_VAR_REVIEW',
  'LM_MATCH_GOAL_MILESTONE',
  'LM_MATCH_GOAL_OPEN_PLAY',
  'LM_MATCH_PENALTY_GOAL',
  'LM_MATCH_GOAL_OWN',
  'LM_MATCH_PENALTY_SAVED',
  'LM_MATCH_PENALTY_MISSED',
  'LM_MATCH_PENALTY_AWARDED',
  'LM_MATCH_CARD_STRAIGHT_RED',
  'LM_MATCH_CARD_SECOND_YELLOW',
]);

const LM_P1_FOLLOWER_IDS = new Set<string>([
  'LM_CAPTAIN_POPULAR_LIVE',
  'LM_MATCH_CLEAN_SHEET_LOST',
]);

export function getEffectiveLmLineupSurprisePts(row: WaveSchedulableStory): number {
  const rawPts = Math.max(0, Number(row.poin_tayang) || 0);
  const baseline = Math.max(0, Number(row.cycle_meta?.preKickoffPtsBaseline) || 0);
  return Math.max(0, rawPts - baseline);
}

export function classifyLiveMatchNewsroomTier(
  parentId: string,
  row: WaveSchedulableStory
): LiveNewsroomTier {
  if (LM_FALLBACK_NS_TEMPLATE_IDS.has(parentId) || row.cycle_meta?.isLmFallback) {
    return 'FALLBACK';
  }
  if (LM_P1_BASE_IDS.has(parentId)) {
    return 'P1';
  }
  if (parentId === 'LM_MATCH_CLEAN_SHEET_LOST') {
    const pct = row.cycle_meta?.maxOwnerPct;
    return pct === undefined || pct >= 10 ? 'P1' : 'P2';
  }
  if (parentId === 'LM_LINEUP_SURPRISE_BENCHED') {
    if (row.cycle_meta?.isUpcomingMatch && (Math.max(0, Number(row.poin_tayang) || 0) >= 2)) {
      return 'P3';
    }
    return 'P2';
  }
  if (LM_P2_BASE_IDS.has(parentId)) {
    return 'P2';
  }
  if (parentId === 'LM_MATCH_SUBSTITUTION') {
    return row.cycle_meta?.isCsSub ? 'P2' : 'P4';
  }
  if (parentId === 'LM_MATCH_SCORE_LIVE' || parentId === 'LM_STANDINGS_TITLE_RACE') {
    return 'P3';
  }
  if (parentId === 'LM_STANDINGS_RANK_MOVEMENT') {
    const rankDiff = row.cycle_meta?.rankDiff;
    const hasRankChange =
      row.cycle_meta?.hasRankChange ??
      (typeof rankDiff === 'number'
        ? rankDiff > 0
        : !String((row as any).headline_id || (row as any).text_berita || '').toLowerCase().includes('bertahan'));
    return hasRankChange ? 'P3' : 'P4';
  }
  if (parentId === 'LM_MATCH_CARD_YELLOW') {
    return 'P4';
  }
  return 'P2';
}

/**
 * Two-Lane Live Match Editorial Newsroom Scheduler:
 * - P1 (Breaking Instan): Goals, Pen, Red, VAR, Captain Live, CS Lost (>=10%).
 *   Bound as Impact Chains ([Goal/Pen/Red] -> [Captain] -> [CS Lost]) without Heartbeat interruption.
 *   Un-aired (poin=0) items lead immediately; replays (poin=1) follow only after P2 fresh items.
 * - P2 (Hidden FPL Value & Transitions): Saves, DefCon, CS Sub (60+/<60), Surprise Lineup, HT/FT.
 * - P3 (Contextual Heartbeat): Live Score (goal matches prioritized), Title Race, active Rank Movers.
 *   Yields during P1 bursts, recaps after P1 storms, and spaces every 2-3 normal events.
 * - P4 (Pelengkap Meja Redaksi): Kickoff, regular Subs/Yellows (high ownership >=10% first),
 *   stagnant Rank Hold — stays available during quiet moments without interrupting hot moments.
 * - FALLBACK (12 NS_*): Only fills calm windows when active LM stream < 8 items.
 */
const SCORE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const UPCOMING_LINEUP_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function selectLiveMatchCycleBatch<T extends WaveSchedulableStory>(
  activeRows: T[],
  knownTemplateIds: string[] = [],
  nowMs: number = Date.now()
): T[] {
  if (!Array.isArray(activeRows) || activeRows.length === 0) return [];

  const sortedKnownIds = [...knownTemplateIds].sort((a, b) => b.length - a.length);
  const getClockSecs = (r: T): number =>
    Number(r.cycle_meta?.clockSecs ?? (r as any).clockSecs ?? 0) || 0;
  const getMatchKey = (r: T): string => {
    if (r.cycle_meta?.matchKey) return r.cycle_meta.matchKey;
    const teams: string[] = Array.isArray((r as any).teams) ? (r as any).teams : [];
    if (teams.length >= 2) {
      return [...teams].map((t) => String(t).trim().toLowerCase()).sort().join('__');
    }
    const pm = Number(r.cycle_meta?.pulseMatchId ?? (r as any).pulseMatchId ?? 0) || 0;
    return pm ? `m_${pm}` : '';
  };

  type Wrapped = {
    row: T;
    parentId: string;
    tier: LiveNewsroomTier;
    originalIdx: number;
    matchKey: string;
  };

  const p1Fresh: Wrapped[] = [];
  const p1Replay: Wrapped[] = [];
  const p2Fresh: Wrapped[] = [];
  const p2Replay: Wrapped[] = [];
  const dueScores: Wrapped[] = [];
  const dueStandings: Wrapped[] = [];
  const dueUpcomingLineups: Wrapped[] = [];
  const p4Pool: Wrapped[] = [];
  const staticFillerPool: Wrapped[] = [];
  const retiredReplayPool: Wrapped[] = [];

  activeRows.forEach((row, originalIdx) => {
    const parentId = resolveParentTemplateId(row.id, sortedKnownIds);
    const tier = classifyLiveMatchNewsroomTier(parentId, row);
    const matchKey = getMatchKey(row);
    const wrapped: Wrapped = { row, parentId, tier, originalIdx, matchKey };
    const pts = Math.max(0, Number(row.poin_tayang) || 0);

    if (parentId === 'LM_LINEUP_SURPRISE_BENCHED') {
      if (row.cycle_meta?.isUpcomingMatch) {
        if (pts === 0) {
          p2Fresh.push(wrapped);
        } else if (pts < 2) {
          p2Replay.push(wrapped);
        } else {
          const lastAiredAt = Number(row.cycle_meta?.lastAiredAtMs || 0);
          if (lastAiredAt > 0 && nowMs - lastAiredAt >= UPCOMING_LINEUP_REFRESH_INTERVAL_MS) {
            dueUpcomingLineups.push(wrapped);
          } else {
            staticFillerPool.push(wrapped);
          }
        }
      } else {
        const effPts = getEffectiveLmLineupSurprisePts(row);
        if (effPts === 0) p2Fresh.push(wrapped);
        else if (effPts < 2) p2Replay.push(wrapped);
        else retiredReplayPool.push(wrapped);
      }
    } else if (tier === 'FALLBACK') {
      staticFillerPool.push(wrapped);
    } else if (tier === 'P1') {
      if (pts === 0) p1Fresh.push(wrapped);
      else if (pts < 2) p1Replay.push(wrapped);
      else retiredReplayPool.push(wrapped);
    } else if (tier === 'P2') {
      const maxP2Airings =
        parentId === 'LM_MATCH_PERIOD_END' || parentId === 'LM_MATCH_PERIOD_START' ? 1 : 2;
      if (pts === 0) p2Fresh.push(wrapped);
      else if (pts < maxP2Airings) p2Replay.push(wrapped);
      else retiredReplayPool.push(wrapped);
    } else if (tier === 'P3') {
      if (parentId === 'LM_MATCH_SCORE_LIVE') {
        const lastAiredAt = Number(row.cycle_meta?.lastAiredAtMs || 0);
        const curSig = String(row.cycle_meta?.scoreSig || '');
        const prevSig = String(row.cycle_meta?.lastAiredScoreSig || '');
        const scoreChanged = Boolean(curSig && prevSig && curSig !== prevSig);
        const isOver15Min = lastAiredAt > 0 && nowMs - lastAiredAt > SCORE_REFRESH_INTERVAL_MS;
        const isFirstAir = pts === 0;
        if (isFirstAir || scoreChanged || isOver15Min) {
          dueScores.push(wrapped);
        } else {
          // Within <= 15m and unchanged score -> demote to NS-equivalent static filler pool
          staticFillerPool.push(wrapped);
        }
      } else {
        // Title Race & Active Rank Movers: promoted only on state/text change; static otherwise
        const curHeadline = String((row as any).headline_id || (row as any).text_berita || '').trim();
        const prevHeadline = String(row.cycle_meta?.lastAiredHeadline || '').trim();
        const standingsChanged = pts === 0 || (Boolean(prevHeadline) && curHeadline !== prevHeadline);
        if (standingsChanged) {
          dueStandings.push(wrapped);
        } else {
          staticFillerPool.push(wrapped);
        }
      }
    } else {
      if (pts < 1) p4Pool.push(wrapped);
    }
  });

  const compareEvent = (a: Wrapped, b: Wrapped): number =>
    (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
    (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
    getClockSecs(b.row) - getClockSecs(a.row) ||
    parseTimestampMs(b.row.timestamp_produksi) - parseTimestampMs(a.row.timestamp_produksi) ||
    a.originalIdx - b.originalIdx;

  // Build atomic Impact Chains for P1: [Anchor Goal/Pen/Red/VAR] -> [Captain] -> [CS Lost]
  const buildImpactChains = (items: Wrapped[]): Wrapped[][] => {
    const anchors = items.filter((w) => LM_P1_ANCHOR_IDS.has(w.parentId)).sort(compareEvent);
    const followers = items.filter((w) => LM_P1_FOLLOWER_IDS.has(w.parentId)).sort(compareEvent);
    const others = items
      .filter((w) => !LM_P1_ANCHOR_IDS.has(w.parentId) && !LM_P1_FOLLOWER_IDS.has(w.parentId))
      .sort(compareEvent);

    const usedFollowers = new Set<string>();
    const chains: Wrapped[][] = [];

    for (const anchor of anchors) {
      const chain: Wrapped[] = [anchor];
      const aClock = getClockSecs(anchor.row);
      const matchingFollowers = followers.filter((f) => {
        if (usedFollowers.has(f.row.id)) return false;
        if (!anchor.matchKey || f.matchKey !== anchor.matchKey) return false;
        return Math.abs(getClockSecs(f.row) - aClock) <= 90;
      });
      matchingFollowers.sort((a, b) => {
        if (a.parentId === b.parentId) return (b.row.drama_score || 0) - (a.row.drama_score || 0);
        return a.parentId === 'LM_CAPTAIN_POPULAR_LIVE' ? -1 : 1;
      });
      for (const mf of matchingFollowers) {
        usedFollowers.add(mf.row.id);
        chain.push(mf);
      }
      chains.push(chain);
    }

    for (const f of followers) {
      if (!usedFollowers.has(f.row.id)) {
        chains.push([f]);
      }
    }
    for (const o of others) {
      chains.push([o]);
    }

    const remaining = [...chains];
    const orderedChains: Wrapped[][] = [];
    let lastMatch = '';
    while (remaining.length > 0) {
      let pickIdx = remaining.findIndex((c) => !lastMatch || c[0].matchKey !== lastMatch);
      if (pickIdx < 0) pickIdx = 0;
      const [picked] = remaining.splice(pickIdx, 1);
      orderedChains.push(picked);
      if (picked[0].matchKey) lastMatch = picked[0].matchKey;
    }
    return orderedChains;
  };

  const interleaveEvents = (items: Wrapped[], maxItems?: number): Wrapped[] => {
    const pool = [...items];
    const out: Wrapped[] = [];
    let prevCat = '';
    let prevMatch = '';
    const limit = maxItems ?? pool.length;

    while (pool.length > 0 && out.length < limit) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        const cat = String(cand.row.kategori || '').trim();
        const diffCat = prevCat && cat !== prevCat ? 2000 : 0;
        const diffMatch = prevMatch && cand.matchKey && cand.matchKey !== prevMatch ? 1000 : 0;
        const score = diffCat + diffMatch + (cand.row.drama_score || 75) - i * 2;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const [picked] = pool.splice(bestIdx, 1);
      out.push(picked);
      prevCat = String(picked.row.kategori || '').trim();
      if (picked.matchKey) prevMatch = picked.matchKey;
    }
    return out;
  };

  p2Fresh.sort(compareEvent);
  p2Replay.sort(compareEvent);

  // Sort due scores: goal/HT changes first, then oldest lastAiredAtMs (so all >15m overdue matches sweep cleanly)
  dueScores.sort((a, b) => {
    const aChanged =
      a.row.cycle_meta?.scoreSig &&
      a.row.cycle_meta?.lastAiredScoreSig &&
      a.row.cycle_meta.scoreSig !== a.row.cycle_meta.lastAiredScoreSig
        ? 1
        : 0;
    const bChanged =
      b.row.cycle_meta?.scoreSig &&
      b.row.cycle_meta?.lastAiredScoreSig &&
      b.row.cycle_meta.scoreSig !== b.row.cycle_meta.lastAiredScoreSig
        ? 1
        : 0;
    if (bChanged !== aChanged) return bChanged - aChanged;
    const aLast = Number(a.row.cycle_meta?.lastAiredAtMs || 0);
    const bLast = Number(b.row.cycle_meta?.lastAiredAtMs || 0);
    if (aLast !== bLast) return aLast - bLast;
    return (
      (b.row.cycle_meta?.hasGoals ? 1 : 0) - (a.row.cycle_meta?.hasGoals ? 1 : 0) ||
      (b.row.drama_score || 0) - (a.row.drama_score || 0)
    );
  });

  // Sort due standings changes (max 3 movers + Title Race)
  const cappedDueStandings = [
    ...dueStandings
      .filter((w) => w.parentId === 'LM_STANDINGS_TITLE_RACE'),
    ...dueStandings
      .filter((w) => w.parentId === 'LM_STANDINGS_RANK_MOVEMENT')
      .sort((a, b) => (b.row.drama_score || 0) - (a.row.drama_score || 0))
      .slice(0, 3),
  ].sort(
    (a, b) =>
      (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
      (b.row.drama_score || 0) - (a.row.drama_score || 0)
  );

  // Sort P4 minor: high ownership (>=10%) Subs/Yellows first, Rank Hold last
  p4Pool.sort((a, b) => {
    const aIsRankHold = a.parentId === 'LM_STANDINGS_RANK_MOVEMENT' ? 1 : 0;
    const bIsRankHold = b.parentId === 'LM_STANDINGS_RANK_MOVEMENT' ? 1 : 0;
    if (aIsRankHold !== bIsRankHold) return aIsRankHold - bIsRankHold;

    const aHighPct = (a.row.cycle_meta?.maxOwnerPct || 0) >= 10 ? 1 : 0;
    const bHighPct = (b.row.cycle_meta?.maxOwnerPct || 0) >= 10 ? 1 : 0;
    if (aHighPct !== bHighPct) return bHighPct - aHighPct;

    return (
      (b.row.cycle_meta?.maxOwnerPct || 0) - (a.row.cycle_meta?.maxOwnerPct || 0) ||
      compareEvent(a, b)
    );
  });

  const finalQueue: Wrapped[] = [];
  const usedIds = new Set<string>();
  const pushUnique = (w: Wrapped) => {
    if (!usedIds.has(w.row.id)) {
      usedIds.add(w.row.id);
      finalQueue.push(w);
    }
  };

  // 1. Urgent Important Breaking (P1 Fresh Impact Chains) — top priority, never interrupted
  const p1FreshChains = buildImpactChains(p1Fresh);
  for (const chain of p1FreshChains) {
    for (const item of chain) {
      pushUnique(item);
    }
  }

  // Optional 1-item Post-Drama Recap right after a P1 goal/drama burst if standings or score changed
  if (p1FreshChains.length > 0 && cappedDueStandings.length > 0) {
    const recap = cappedDueStandings.shift();
    if (recap) pushUnique(recap);
  }

  // 2. Remaining Important Queue (Fresh P2 -> P1 Replays -> P2 Replays)
  const p1ReplayItems = buildImpactChains(p1Replay).flat();
  const p2FreshLimit = Math.max(12, Math.min(20, p2Fresh.length));
  const cappedP2Fresh = interleaveEvents(p2Fresh, p2FreshLimit);
  const cappedP1Replays = p1ReplayItems.slice(0, 4);
  const cappedP2Replays = interleaveEvents(p2Replay, 6);

  for (const ev of [...cappedP2Fresh, ...cappedP1Replays, ...cappedP2Replays]) {
    if (finalQueue.length >= 26) break;
    pushUnique(ev);
  }

  // 3. Due Live Scoreboard Sweep (> 15m since last aired / score changed / first air), Changed Standings,
  // & Pre-Kickoff Upcoming Surprise Lineup Reminders (>= 10m cooldown, rotated by poin_tayang ASC).
  // Strictly BEHIND Important (P1/P2) and AHEAD of Unimportant (P4) & Filler (NS).
  for (const sc of dueScores) {
    if (finalQueue.length >= 28) break;
    pushUnique(sc);
  }
  for (const st of cappedDueStandings) {
    if (finalQueue.length >= 28) break;
    pushUnique(st);
  }
  dueUpcomingLineups.sort(
    (a, b) =>
      (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
      (Number(a.row.cycle_meta?.lastAiredAtMs || 0)) - (Number(b.row.cycle_meta?.lastAiredAtMs || 0)) ||
      (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
      a.originalIdx - b.originalIdx
  );
  for (const ul of dueUpcomingLineups) {
    if (finalQueue.length >= 28) break;
    pushUnique(ul);
  }

  // 4. Unified Static Filler Pool (P3 within <=15m unchanged + static Standings + recent pre-kickoff Lineups + 12 NS_*)
  // Demoted to NS level and rotated fairly by poin_tayang ASC
  let staticRankMoversSeen = 0;
  const normalizedFiller = staticFillerPool.filter((w) => {
    if (w.parentId === 'LM_STANDINGS_RANK_MOVEMENT') {
      staticRankMoversSeen++;
      return staticRankMoversSeen <= 3;
    }
    return true;
  });
  normalizedFiller.sort(
    (a, b) =>
      (a.row.poin_tayang || 0) - (b.row.poin_tayang || 0) ||
      (b.row.drama_score || 0) - (a.row.drama_score || 0) ||
      a.originalIdx - b.originalIdx
  );

  // Cold-start Guard: if zero Important (P1/P2) AND zero Due Scores/Standings, open with 1 Filler item
  // ahead of P4 minor yellow/sub so viewers don't immediately open onto a 1% yellow card.
  if (finalQueue.length === 0 && normalizedFiller.length > 0) {
    const leadFiller = normalizedFiller.shift();
    if (leadFiller) pushUnique(leadFiller);
  }

  // 5. Unimportant Queue (P4 Minor: Subs, Yellow Cards, Rank Hold)
  let rankHoldSeen = 0;
  const filteredP4 = p4Pool.filter((w) => {
    if (w.parentId === 'LM_STANDINGS_RANK_MOVEMENT') {
      rankHoldSeen++;
      return rankHoldSeen <= 2;
    }
    return true;
  });
  const cappedP4 = interleaveEvents(filteredP4, 8);
  for (const minor of cappedP4) {
    if (finalQueue.length >= 28) break;
    pushUnique(minor);
  }

  // 6. Fill quiet periods up to 12 items with Unified NS-equivalent Static Filler (score <=15m, static standings, 12 NS_*)
  if (finalQueue.length < 12 && normalizedFiller.length > 0) {
    const interleavedFiller = interleaveEvents(normalizedFiller, 12 - finalQueue.length);
    for (const fl of interleavedFiller) {
      if (finalQueue.length >= 12) break;
      pushUnique(fl);
    }
  }

  // Last-resort emergency fallback if still < 6
  if (finalQueue.length < 6 && retiredReplayPool.length > 0) {
    const needed = 6 - finalQueue.length;
    const sortedRetired = [...retiredReplayPool].sort(compareEvent);
    for (const ret of sortedRetired.slice(0, needed)) {
      pushUnique(ret);
    }
  }

  return finalQueue.map((w) => ({
    ...w.row,
    newsroom_tier: w.tier,
    ...(w.row.cycle_meta?.scoreSig ? { score_sig: w.row.cycle_meta.scoreSig } : {}),
  }));
}
