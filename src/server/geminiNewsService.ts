/**
 * Gemini AI Newsroom Service for FNB League
 * Powers autonomous sports journalism using unedited official FPL rules,
 * the 8-Step Causal Reasoning Framework, Maximum Causal Span, Multi-Stage Fact Density,
 * Strict Intra-batch & Inter-batch Entity Diversification, Mathematically Accurate What-If Net Gain,
 * and Pure Factual Loss Perspective: "Tim kehilangan potensi n poin karena mencadangkan/mengkaptenkan/menjual B dan menggantinya dengan C yang hanya mendapat n2 poin."
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FPL_OFFICIAL_RULES_TEXT } from './fplOfficialRules.ts';
import { buildRawMatchdayPayload, RawMatchdayPayload } from './newsAggregator.ts';
import { formatChipName } from './liveJournalismEngine.ts';
import {
  rebuildNewsTickerTable,
  createCompleteStoryRecord,
  extractGwFromStory,
  NewsTickerDbRow,
  getGameweekPhase,
  mentionsPointsOrRank,
  formatPointsAndRankStatus,
  GameweekPhase,
} from './newsTickerTableService.ts';
import { generatePhase1Stories } from './phase1StoryGenerator.ts';

export interface NewsTickerStory {
  id: string;
  headline_id: string;
  headline_en: string;
  drama_score: number;
  timestamp_produksi?: string;
  sumber?: 'AI' | 'Bukan';
  status_tayang?: 'Y' | 'N';
  keterangan_tidak_tayang?: string;
  waktu_tayang?: string[];
  kategori?: string;
  sub_kategori?: string;
  text_berita?: string;
  text_berita_en?: string;
  gw?: number;
  teams?: string[];
  players?: string[];
}

export function toNewsTickerStory(
  raw: {
    id: string;
    headline_id?: string;
    headline_en?: string;
    text_berita?: string;
    text_berita_en?: string;
    headline?: string;
    drama_score?: number;
    timestamp_produksi?: string;
    timestamp?: string;
    sumber?: 'AI' | 'Bukan';
    status_tayang?: 'Y' | 'N';
    keterangan_tidak_tayang?: string;
    gw?: number;
    teams?: string[];
    players?: string[];
  },
  defaultGw = 9
): NewsTickerStory {
  const row = createCompleteStoryRecord(raw, defaultGw);
  return {
    ...row,
    headline_id: row.text_berita,
    headline_en: row.text_berita_en,
  };
}

export interface NewsTickerFeedResponse {
  success: boolean;
  gameweek: number;
  nextGameweek: number;
  gameweekPhase: string;
  lastUpdated: string;
  count: number;
  data: NewsTickerStory[];
}

const FEED_CACHE_PATH = path.join(process.cwd(), 'src/data/news_ticker_feed.json');
const HISTORY_CACHE_PATH = path.join(process.cwd(), 'src/data/news_ticker_history.json');

// In-memory microcache for instant (< 1 ms) API response
let memoryFeedCache: NewsTickerFeedResponse | null = null;
let lastProcessedDataHash = '';
let quotaCooldownUntil = 0;

export interface PastNewsRecord extends Partial<NewsTickerDbRow> {
  id: string;
  gw: number;
  headline_id: string;
  headline_en: string;
  teams?: string[];
  players?: string[];
  timestamp: string;
}

/**
 * Extracts tagged entity values from text (e.g. [T:Team], [P:Player])
 */
export function extractTags(text: string, tagType: 'T' | 'P' | 'C' | 'N'): string[] {
  const regex = new RegExp(`\\[${tagType}:([^\\]]+)\\]`, 'g');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

/**
 * Loads the persistent news production history across previous runs
 */
export function loadNewsHistory(): PastNewsRecord[] {
  try {
    if (fs.existsSync(HISTORY_CACHE_PATH)) {
      const raw = fs.readFileSync(HISTORY_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((r) => r && r.headline_id && typeof r.headline_id === 'string' && r.headline_id.includes(' ') && !r.headline_id.startsWith('what_if_') && !r.headline_id.startsWith('rank_') && !r.headline_id.startsWith('chip_') && !r.headline_id.startsWith('title_') && !r.headline_id.startsWith('bench_') && r.headline_id.length > 20)
          .map((r) => ({
            ...r,
            headline_id: cleanHeadlineBody(r.headline_id),
            headline_en: cleanHeadlineBody(r.headline_en || r.headline_id),
          }));
      }
    }
  } catch (err: any) {
    console.warn('[Gemini News Service] Failed to read history cache:', err.message);
  }

  // Fallback: populate from current memoryFeedCache if history file doesn't exist yet
  if (memoryFeedCache && Array.isArray(memoryFeedCache.data)) {
    return memoryFeedCache.data.map((item) => ({
      id: item.id,
      gw: memoryFeedCache!.gameweek,
      headline_id: cleanHeadlineBody(item.headline_id),
      headline_en: cleanHeadlineBody(item.headline_en),
      teams: extractTags(item.headline_id, 'T'),
      players: extractTags(item.headline_id, 'P'),
      timestamp: memoryFeedCache!.lastUpdated || new Date().toISOString(),
    }));
  }

  return [];
}

/**
 * Appends freshly generated stories into the sliding window history cache (retains last 40)
 */
export function saveNewsHistory(newStories: NewsTickerStory[], gw: number): void {
  try {
    const existing = loadNewsHistory();
    const newRecords: PastNewsRecord[] = newStories.map((s) => {
      const full = toNewsTickerStory(s, gw);
      return {
        ...full,
        gw: full.gw || gw,
        timestamp: full.timestamp_produksi,
      };
    });

    // Merge and deduplicate by exact headline_id
    const combined = [...existing];
    for (const rec of newRecords) {
      if (!combined.some((c) => c.headline_id === rec.headline_id)) {
        combined.push(rec);
      }
    }

    // Keep sliding window of latest 1000 stories for long rotation
    const trimmed = combined.slice(-1000);
    fs.writeFileSync(HISTORY_CACHE_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
    console.log(`[Gemini News Service] Updated history cache with ${trimmed.length} records (max 1000 pool).`);
  } catch (err: any) {
    console.warn('[Gemini News Service] Failed to save history cache:', err.message);
  }
}

/**
 * Sanitizes headline text:
 * 1. Strips any title prefixes (e.g., "Judul: Isi Berita" -> "Isi Berita")
 * 2. Replaces all exclamation marks (!) with period (.)
 * 3. Formats player and club as "[P:Player] ([C:Club])" strictly without the word "dari"
 * 4. Ensures what-if decisions are framed from the factual loss perspective (no hypothetical conditionals)
 * 5. Removes forbidden phrases ("poin bersih", "selisih bersih", "tambahan bersih", "keuntungan bersih", "net points", "net")
 *    so only the word "poin" or "tambahan poin" remains while keeping the net numerical value clean.
 */
export function cleanHeadlineBody(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip title prefix (e.g. "Judul Berita: Isi...") only if colon is within the first 35 chars
  // and does not contain entity tags [T: or [P: or opening parenthesis
  const colonIdx = cleaned.indexOf(': ');
  if (colonIdx !== -1 && colonIdx <= 35) {
    const prefix = cleaned.substring(0, colonIdx);
    const openBrackets = (prefix.match(/\[/g) || []).length;
    const closeBrackets = (prefix.match(/\]/g) || []).length;
    if (openBrackets === closeBrackets && !prefix.includes('[T:') && !prefix.includes('[P:') && !prefix.includes('(')) {
      cleaned = cleaned.substring(colonIdx + 2).trim();
    }
  }

  // Replace any exclamation marks with period
  cleaned = cleaned.replace(/!+/g, '.');

  // Convert any stray conditional/hypothetical phrasing into factual loss perspective
  cleaned = cleaned
    .replace(/^Andai\s+(\[T:[^\]]+\])\s+memasang\s+/gi, '$1 kehilangan potensi poin karena menempatkan ')
    .replace(/^Andai\s+(\[T:[^\]]+\])\s+memilih\s+/gi, '$1 kehilangan potensi poin karena memilih ')
    .replace(/^Andai\s+/gi, 'Keputusan ')
    .replace(/\bandai\s+memilih\b/gi, 'dibanding')
    .replace(/\bandai\s+memasang\b/gi, 'dibanding')
    .replace(/^Had\s+(\[T:[^\]]+\])\s+started\s+/gi, '$1 lost potential points by benching ')
    .replace(/^Had\s+/gi, 'The decision by ');

  // Format player and club as "[P:Player] ([C:Club])" without the word "dari" or English possessives
  cleaned = cleaned
    .replace(/\[P:([^\]]+)\]\s+dari\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])')
    .replace(/\[P:([^\]]+)\]\s+dari\s+klub\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])')
    .replace(/\[C:([^\]]+)\]'s\s+\[P:([^\]]+)\]/gi, '[P:$2] ([C:$1])')
    .replace(/\bfrom\s+\[C:([^\]]+)\](?:\s+(?:defender|midfielder|forward|striker|goalkeeper))?\s+\[P:([^\]]+)\]/gi, '[P:$2] ([C:$1])')
    .replace(/\[P:([^\]]+)\]\s+(?:of|from)\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])');

  // Strip forbidden words: "poin bersih", "selisih bersih", "tambahan bersih", "keuntungan bersih", "net points", "net"
  cleaned = cleaned
    .replace(/\b(?:poin|selisih|tambahan|keuntungan)\s+bersih\b/gi, (match) => {
      const lower = match.toLowerCase();
      if (lower.startsWith('poin')) return 'poin';
      if (lower.startsWith('selisih')) return 'selisih';
      if (lower.startsWith('tambahan')) return 'tambahan';
      return 'potensi';
    })
    .replace(/\[N:\+?(\d+)\s*(?:poin|pts|points)\s+bersih\]/gi, '[N:+$1 Poin]')
    .replace(/\bnet\s+points?\b/gi, 'points')
    .replace(/\bnet\s+(\[N:[^\]]+\])/gi, '$1')
    .replace(/\bnet\s+(\d+)/gi, '$1');

  // Enforce singular entity rule for 1 team:
  // 1 tim adalah entitas tunggal, tidak boleh dideskripsikan sebagai "mereka" (atau "they/them/their").
  // Jika dalam 1 headline hanya merujuk 1 tim, ubah rujukan jamak menjadi rujukan entitas tunggal.
  const teamMatches = cleaned.match(/\[T:[^\]]+\]/g) || [];
  const isMultipleTeams = teamMatches.length > 1 || /\b(?:kedua|semua|para|antar|beberapa)\s+tim\b/i.test(cleaned) || /\bboth\s+teams\b/i.test(cleaned);

  if (!isMultipleTeams) {
    // Indonesian: ubah kata ganti jamak "mereka" untuk 1 tim tunggal
    cleaned = cleaned
      .replace(/\bposisi\s+mereka\b/gi, 'posisinya')
      .replace(/\bpoin\s+mereka\b/gi, 'poin tim tersebut')
      .replace(/\bskuad\s+mereka\b/gi, 'skuadnya')
      .replace(/\blangkah\s+mereka\b/gi, 'langkahnya')
      .replace(/\bupaya\s+mereka\b/gi, 'upayanya')
      .replace(/\bpeluang\s+mereka\b/gi, 'peluangnya')
      .replace(/\bambisi\s+mereka\b/gi, 'ambisinya')
      .replace(/\bkeunggulan\s+mereka\b/gi, 'keunggulannya')
      .replace(/\bperforma\s+mereka\b/gi, 'performanya')
      .replace(/\bkeberhasilan\s+mereka\b/gi, 'keberhasilannya')
      .replace(/\bkemenangan\s+mereka\b/gi, 'kemenangannya')
      .replace(/\bbagi\s+mereka\b/gi, 'bagi tim tersebut')
      .replace(/\buntuk\s+mereka\b/gi, 'untuk tim tersebut')
      .replace(/\boleh\s+mereka\b/gi, 'oleh tim tersebut')
      .replace(/\bmembuat\s+mereka\b/gi, 'membuat tim tersebut')
      .replace(/\bmembawa\s+mereka\b/gi, 'membawa tim tersebut')
      .replace(/\bmengantar\s+mereka\b/gi, 'mengantar tim tersebut')
      .replace(/\bmenempatkan\s+mereka\b/gi, 'menempatkan tim tersebut')
      .replace(/\bmelesatkan\s+mereka\b/gi, 'melesatkan tim tersebut')
      .replace(/\bmengangkat\s+mereka\b/gi, 'mengangkat tim tersebut')
      .replace(/\bmendorong\s+mereka\b/gi, 'mendorong tim tersebut')
      .replace(/\bmereka\b/gi, 'tim tersebut');

    // English: replace "they/them/their" when referring to a single team
    cleaned = cleaned
      .replace(/\btheir\s+hold\b/gi, 'its hold')
      .replace(/\btheir\s+position\b/gi, 'its position')
      .replace(/\btheir\s+rank\b/gi, 'its rank')
      .replace(/\btheir\s+squad\b/gi, 'its squad')
      .replace(/\btheir\s+points\b/gi, 'its points')
      .replace(/\btheir\s+chances?\b/gi, 'its chance')
      .replace(/\btheir\s+lead\b/gi, 'its lead')
      .replace(/\btheir\s+pursuit\b/gi, 'its pursuit')
      .replace(/\btheir\s+bid\b/gi, 'its bid')
      .replace(/\btheir\s+campaign\b/gi, 'its campaign')
      .replace(/\btheir\b/gi, 'its')
      .replace(/\bfor\s+them\b/gi, 'for the team')
      .replace(/\bto\s+them\b/gi, 'to the team')
      .replace(/\bby\s+them\b/gi, 'by the team')
      .replace(/\bpropels?\s+them\b/gi, 'propels the team')
      .replace(/\blifts?\s+them\b/gi, 'lifts the team')
      .replace(/\bvaults?\s+them\b/gi, 'vaults the team')
      .replace(/\bpushes?\s+them\b/gi, 'pushes the team')
      .replace(/\bhelps?\s+them\b/gi, 'helps the team')
      .replace(/\bthem\b/gi, 'the team')
      .replace(/\bas\s+they\b/gi, 'as the team')
      .replace(/\bwhile\s+they\b/gi, 'while the team')
      .replace(/\bwhere\s+they\b/gi, 'where the team')
      .replace(/\bbefore\s+they\b/gi, 'before the team')
      .replace(/\bafter\s+they\b/gi, 'after the team')
      .replace(/\bthey\b/gi, 'the team');
  }

  // Strip hyperbole, assumptions, and emotional exaggeration
  cleaned = cleaned
    .replace(/kokoh mempertahankan singgasana/gi, 'menempati')
    .replace(/mempertahankan singgasana/gi, 'menempati')
    .replace(/\bsinggasana\b/gi, 'posisi puncak')
    .replace(/\bmeroket(?:\s+naik)?\b/gi, 'naik')
    .replace(/\bterjun\s+(?:bebas|tajam)\b/gi, 'turun')
    .replace(/\bmerangsek\s+naik\b/gi, 'naik')
    .replace(/\bduel\s+sengit\b/gi, 'pertandingan')
    .replace(/\blaga\s+sengit\b/gi, 'pertandingan')
    .replace(/\bpertarungan\s+sengit\b/gi, 'pertandingan')
    .replace(/\btembok\s+kokoh\b/gi, 'lini pertahanan')
    .replace(/\bpenyelamatan\s+heroik\b/gi, 'penyelamatan')
    .replace(/\btampil\s+heroik\b/gi, 'tampil')
    .replace(/\bkudeta\s+tahta\b/gi, 'merebut peringkat 1')
    .replace(/\btahta\b/gi, 'peringkat 1')
    .replace(/\bpahlawan\b/gi, 'pemain kunci')
    .replace(/\bsoliditas\s+pertahanan\s+kokoh\b/gi, 'pertahanan')
    .replace(/\bsurged\b/gi, 'moved up')
    .replace(/\bplummeted\b/gi, 'moved down')
    .replace(/\bheroic\b/gi, '')
    .replace(/\bfierce\s+clash\b/gi, 'match')
    .replace(/\bholds?\s+firm\s+at\s+the\s+summit\b/gi, 'holds rank 1')
    .replace(/\bsummit\b/gi, '1st place');

  // Ensure trailing punctuation is not exclamation
  cleaned = cleaned.replace(/\s*!+$/g, '.');

  // Remove erroneous aggregated loss tags such as "sama-sama merugi [N:344 Poin]" or "sama-sama merugi [N:44 poin]"
  // Player points should only be attached to the player (e.g. "[P:Palmer] yang meraih [N:8] poin")
  cleaned = cleaned.replace(/sama-sama\s+merugi\s+\[N:\+?\d+\s*(?:Poin|poin|pts|points)?\]/gi, 'sama-sama merugi');

  return cleaned.trim();
}

export type StoryCategory = 'TITLE_OR_CHAMP' | 'RANK_MOVER' | 'WHAT_IF' | 'CHIP_OR_HIT' | 'STAR_HERO' | 'OTHER';

export function classifyStory(story: NewsTickerStory): StoryCategory {
  const t = `${story.headline_id} ${story.headline_en}`.toLowerCase();

  // 1. What-If (Missed opportunities, benching, captaincy, transfer loss)
  if (
    t.includes('kehilangan potensi') ||
    t.includes('mencadangkan') ||
    t.includes('mengkaptenkan') ||
    t.includes('menjual') ||
    t.includes('missed out') ||
    t.includes('benching') ||
    t.includes('captaining') ||
    t.includes('menyesali') ||
    t.includes('what-if')
  ) {
    return 'WHAT_IF';
  }

  // 2. Title & Championship
  if (
    t.includes('kudeta') ||
    t.includes('tahta') ||
    t.includes('puncak klasemen') ||
    t.includes('peringkat 1') ||
    t.includes('peringkat 2') ||
    t.includes('juara terbanyak') ||
    t.includes('juara gameweek') ||
    t.includes('juara pekan') ||
    t.includes('dethroned') ||
    t.includes('champion') ||
    t.includes('summit') ||
    t.includes('commands the summit')
  ) {
    return 'TITLE_OR_CHAMP';
  }

  // 3. Rank Climbers & Fallers
  if (
    t.includes('lonjakan') ||
    t.includes('melompat') ||
    t.includes('terjun') ||
    t.includes('penurunan') ||
    t.includes('naik') ||
    t.includes('turun') ||
    t.includes('climbs') ||
    t.includes('plummets') ||
    t.includes('surge') ||
    t.includes('jumped') ||
    t.includes('places to rank')
  ) {
    return 'RANK_MOVER';
  }

  // 4. Chips and Transfer Hits
  if (
    t.includes('chip') ||
    t.includes('penalti') ||
    t.includes('wildcard') ||
    t.includes('free hit') ||
    t.includes('bench boost') ||
    t.includes('triple captain') ||
    t.includes('deduction')
  ) {
    return 'CHIP_OR_HIT';
  }

  // 5. Star / Key Player Spotlight
  if (
    t.includes('performa gemilang') ||
    t.includes('clean sheet') ||
    t.includes('poin pekan') ||
    t.includes('outstanding') ||
    t.includes('brilliant') ||
    t.includes('solid') ||
    t.includes('mengamankan')
  ) {
    return 'STAR_HERO';
  }

  return 'OTHER';
}

/**
 * Interleaves stories so that no two consecutive stories share the same category (especially prevents what-if clustering).
 */
export function interleaveStoriesByContext(stories: NewsTickerStory[]): NewsTickerStory[] {
  if (stories.length <= 2) return stories;

  const buckets: Record<StoryCategory, NewsTickerStory[]> = {
    TITLE_OR_CHAMP: [],
    RANK_MOVER: [],
    WHAT_IF: [],
    CHIP_OR_HIT: [],
    STAR_HERO: [],
    OTHER: [],
  };

  for (const s of stories) {
    buckets[classifyStory(s)].push(s);
  }

  const result: NewsTickerStory[] = [];
  let lastCategory: StoryCategory | null = null;

  // Interleave cycle prioritizing journalistic balance:
  const cycle: StoryCategory[] = ['TITLE_OR_CHAMP', 'WHAT_IF', 'RANK_MOVER', 'STAR_HERO', 'CHIP_OR_HIT'];

  let remainingCount = stories.length;
  while (remainingCount > 0) {
    let addedThisRound = false;

    for (const cat of cycle) {
      if (buckets[cat].length > 0 && cat !== lastCategory) {
        const story = buckets[cat].shift()!;
        result.push(story);
        lastCategory = cat;
        remainingCount--;
        addedThisRound = true;
      }
    }

    // If strict cycle couldn't advance because categories are exhausted or same as lastCategory
    if (!addedThisRound) {
      const otherCat = (Object.keys(buckets) as StoryCategory[]).find(
        (c) => buckets[c].length > 0 && c !== lastCategory
      );

      if (otherCat) {
        const story = buckets[otherCat].shift()!;
        result.push(story);
        lastCategory = otherCat;
        remainingCount--;
      } else {
        // Only one category left with items
        const remainingCat = (Object.keys(buckets) as StoryCategory[]).find((c) => buckets[c].length > 0);
        if (remainingCat) {
          result.push(...buckets[remainingCat]);
          buckets[remainingCat] = [];
          remainingCount = 0;
        }
        break;
      }
    }
  }

  return result;
}

// Load existing disk cache on startup if available
if (fs.existsSync(FEED_CACHE_PATH)) {
  try {
    const raw = fs.readFileSync(FEED_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.data)) {
      parsed.data = parsed.data.map((item: any) => ({
        ...item,
        headline_id: cleanHeadlineBody(item.headline_id || ''),
        headline_en: cleanHeadlineBody(item.headline_en || ''),
      }));
    }
    memoryFeedCache = parsed;
    console.log('[Gemini News Service] Pre-seeded memory cache from disk for instant boot response.');
  } catch (e: any) {
    console.warn('[Gemini News Service] Could not read disk cache:', e.message);
  }
}

/**
 * Extracts entities (teams, players, clubs) already covered in a previous feed
 */
export function extractEntitiesFromFeed(feed: NewsTickerFeedResponse | null): {
  teams: string[];
  players: string[];
  clubs: string[];
} {
  const teams = new Set<string>();
  const players = new Set<string>();
  const clubs = new Set<string>();

  if (!feed || !feed.data) return { teams: [], players: [], clubs: [] };

  for (const s of feed.data) {
    const text = `${s.headline_id} ${s.headline_en}`;
    const tMatches = text.match(/\[T:([^\]]+)\]/g) || [];
    for (const m of tMatches) teams.add(m.replace(/^\[T:|\]$/g, '').trim());

    const pMatches = text.match(/\[P:([^\]]+)\]/g) || [];
    for (const m of pMatches) players.add(m.replace(/^\[P:|\]$/g, '').trim());

    const cMatches = text.match(/\[C:([^\]]+)\]/g) || [];
    for (const m of cMatches) clubs.add(m.replace(/^\[C:|\]$/g, '').trim());
  }

  return {
    teams: Array.from(teams),
    players: Array.from(players),
    clubs: Array.from(clubs),
  };
}

/**
 * Creates a deterministic state hash of the matchday reality to avoid redundant AI calls
 */
function computeStateHash(payload: RawMatchdayPayload): string {
  const essentialState = {
    gw: payload.gameweek,
    phase: payload.gameweekPhase,
    rank1: payload.championshipStatus.rank1,
    rank2: payload.championshipStatus.rank2,
    gwChamp: payload.championshipStatus.gwChampionLeader,
    topScore: payload.leagueStats.highestScore,
    avgScore: payload.leagueStats.averageScore,
    teamScores: payload.standingsTable.map((s) => `${s.team}:${s.gwPts}:${s.rank}`),
  };
  return crypto.createHash('sha256').update(JSON.stringify(essentialState)).digest('hex');
}

/**
 * Blends real-time live match journalism stories into the news ticker feed.
 * Deduplicates overlapping entities (preferring AI unless AI is unavailable).
 */
export async function fuseLiveStories(baseStories: NewsTickerStory[], gw: number): Promise<NewsTickerStory[]> {
  try {
    const { generateLiveJournalismStories } = await import('./liveJournalismEngine.ts');
    const liveOutput = await generateLiveJournalismStories(gw);
    if (!liveOutput || liveOutput.allStories.length === 0) return baseStories;

    const aiEntities = new Set<string>();
    for (const s of baseStories) {
      extractTags(s.headline_id, 'T').forEach((t) => aiEntities.add(t.toLowerCase()));
      extractTags(s.headline_id, 'P').forEach((p) => aiEntities.add(p.toLowerCase()));
    }

    const nonAiUniqueStories: NewsTickerStory[] = [];
    for (const liveStory of liveOutput.allStories) {
      // Live match score headlines are real-time minute-by-minute updates, always include them
      if (liveStory.id.startsWith('live_score_')) {
        nonAiUniqueStories.push(liveStory);
        continue;
      }

      const teams = extractTags(liveStory.headline_id, 'T').map((t) => t.toLowerCase());
      const players = extractTags(liveStory.headline_id, 'P').map((p) => p.toLowerCase());

      // De-duplicate: if AI already covers this entity, prefer AI story unless baseStories is empty
      const coveredByAi = players.some((p) => aiEntities.has(p)) || (teams.length > 0 && teams.every((t) => aiEntities.has(t)));
      if (!coveredByAi || baseStories.length === 0) {
        nonAiUniqueStories.push(liveStory);
      }
    }

    const liveScores = nonAiUniqueStories.filter((s) => s.id.startsWith('live_score_'));
    const otherLive = nonAiUniqueStories.filter((s) => !s.id.startsWith('live_score_'));

    // Hybrid mix: live scores first, then alternating AI stories and other live events
    const mixed: NewsTickerStory[] = [...liveScores];
    let aiIdx = 0;
    let liveIdx = 0;
    while (aiIdx < baseStories.length || liveIdx < otherLive.length) {
      if (aiIdx < baseStories.length) mixed.push(baseStories[aiIdx++]);
      if (liveIdx < otherLive.length) mixed.push(otherLive[liveIdx++]);
    }
    return mixed.length > 0 ? mixed : baseStories;
  } catch (err: any) {
    console.warn('[Gemini News Service] Error fusing live journalism stories:', err.message);
    return baseStories;
  }
}

/**
 * Assembles the full rotating pool of up to 1000 items, merging live match stories,
 * newly generated stories, and factual historical league records.
 */
async function assembleAndCacheFeed(
  activeStories: NewsTickerStory[],
  payload: RawMatchdayPayload,
  currentHash: string
): Promise<NewsTickerFeedResponse> {
  // 1. Hybrid Fusion: Blend real-time live match journalism stories
  const fused = await fuseLiveStories(activeStories, payload.gameweek);

  // 2. Save newly produced stories to history cache
  if (fused.length > 0) {
    saveNewsHistory(fused, payload.gameweek);
  }

  // 3. Ensure historical pool is populated up to 1000 items
  seedHistoricalNewsPool();

  // 4. Assemble the complete rotating pool (up to 1000 stories) to serve to the client ticker
  const historyRecords = loadNewsHistory();
  const seenHeadlines = new Set<string>();
  const freshScores: NewsTickerStory[] = [];
  const otherStories: NewsTickerStory[] = [];

  // 4a. When Gameweek is Confirmed, ALWAYS ensure the 4 official champions lead the news ticker
  const officialChampions: NewsTickerStory[] = [];
  if (payload.gameweekPhase === 'Confirmed') {
    const champStories = buildOfficialChampionsStories(payload);
    for (const cs of champStories) {
      if (!seenHeadlines.has(cs.headline_id)) {
        seenHeadlines.add(cs.headline_id);
      }
      officialChampions.push(cs);
    }
  }

  // A. Fresh / live match stories first
  for (const s of fused) {
    if (!seenHeadlines.has(s.headline_id)) {
      seenHeadlines.add(s.headline_id);
      const full = toNewsTickerStory({
        ...s,
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
      }, payload.gameweek);
      if (s.id.startsWith('live_score_')) {
        freshScores.push(full);
      } else {
        otherStories.push(full);
      }
    }
  }

  // B. Persistent historical stories up to 1000 items
  for (let i = historyRecords.length - 1; i >= 0; i--) {
    if (seenHeadlines.size >= 1000) break;
    const rec = historyRecords[i];
    if (!seenHeadlines.has(rec.headline_id)) {
      seenHeadlines.add(rec.headline_id);
      const recGw = rec.gw || extractGwFromStory(rec.headline_id, rec.headline_en, rec.id, payload.gameweek);
      const isCurrentGw = (recGw === payload.gameweek);
      otherStories.push(toNewsTickerStory({
        ...rec,
        gw: recGw,
        status_tayang: isCurrentGw ? 'Y' : 'N',
        keterangan_tidak_tayang: isCurrentGw ? '' : `Bukan Gameweek aktif (Arsip Gameweek ${recGw})`,
      }, recGw));
    }
  }

  // Interleave the stories across all 5 categories (Title/Champions, What-If, Rank Movers, Star Heroes, Chips/Hits)
  const interleaved = interleaveStoriesByContext(otherStories);
  // Put official champions at the very front of the rotation when confirmed
  const remainingInterleaved = interleaved.filter((s) => !officialChampions.some((oc) => oc.headline_id === s.headline_id));
  const fullRotatingPool: NewsTickerStory[] = [...freshScores, ...officialChampions, ...remainingInterleaved].slice(0, 1000);

  const feedResponse: NewsTickerFeedResponse = {
    success: true,
    gameweek: payload.gameweek,
    nextGameweek: payload.nextGameweek,
    gameweekPhase: payload.gameweekPhase,
    lastUpdated: new Date().toISOString(),
    count: fullRotatingPool.length,
    data: fullRotatingPool,
  };

  memoryFeedCache = feedResponse;
  lastProcessedDataHash = currentHash;

  try {
    fs.writeFileSync(FEED_CACHE_PATH, JSON.stringify(feedResponse, null, 2), 'utf-8');
    console.log(`[Gemini News Service] Successfully persisted news feed with ${fullRotatingPool.length} stories (1000 pool).`);
    rebuildNewsTickerTable();
  } catch (e: any) {
    console.warn('[Gemini News Service] Disk cache write error:', e.message);
  }

  return feedResponse;
}

/**
 * Generates news ticker stories using Google Gemini AI
 */
export async function generateNewsTickerFeed(force = false): Promise<NewsTickerFeedResponse> {
  const payload = buildRawMatchdayPayload();
  const currentHash = computeStateHash(payload);

  // Return cached result if data hasn't changed and not forced
  if (!force && memoryFeedCache && memoryFeedCache.data.length >= 900) {
    if (lastProcessedDataHash === '' || lastProcessedDataHash === currentHash) {
      lastProcessedDataHash = currentHash;
      return memoryFeedCache;
    }
  }

  // If Gemini API quota is currently in cooldown, serve full rotating pool with fallback stories immediately
  if (Date.now() < quotaCooldownUntil) {
    if (!force && memoryFeedCache && memoryFeedCache.gameweek === payload.gameweek && memoryFeedCache.data.length >= 900) {
      lastProcessedDataHash = currentHash;
      return memoryFeedCache;
    }
    const fallbackStories = buildFallbackStories(payload);
    return await assembleAndCacheFeed(fallbackStories, payload, currentHash);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini News Service] GEMINI_API_KEY is not set. Returning full rotating pool with fallback stories.');
    const fallbackStories = buildFallbackStories(payload);
    return await assembleAndCacheFeed(fallbackStories, payload, currentHash);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: 60000,
    },
  });

  // Load persistent history across previous production cycles
  const pastHistory = loadNewsHistory();
  const recentHistory = pastHistory.slice(-20);
  const pastHeadlinesFormatted = recentHistory.length > 0
    ? recentHistory
        .map((h, idx) => `[Riwayat ${idx + 1}] ID: ${h.headline_id} | EN: ${h.headline_en}`)
        .join('\n')
    : '(Belum ada riwayat produksi berita sebelumnya)';

  // Set of past covered (Team + Player) pairs to prevent repetition
  const pastCoveredPairs = new Set<string>();
  recentHistory.forEach((h) => {
    const teams = (h.teams || []).map((t) => t.toLowerCase());
    const players = (h.players || []).map((p) => p.toLowerCase());
    teams.forEach((t) => {
      players.forEach((p) => {
        pastCoveredPairs.add(`${t}::${p}`);
      });
    });
  });

  const isLiveMatchActive = Boolean(payload.matchesOverview && payload.matchesOverview.liveCount > 0);

  const quantityInstruction = isLiveMatchActive
    ? 'Hasilkan 8 hingga 12 headline berita dwibahasa simultan yang terfokus pada aksi laga live di lapangan dalam format JSON array valid.'
    : 'ATURAN JUMLAH BERITA KETIKA TIDAK ADA MATCH LIVE: JANGAN BATASI JUMLAH BERITA YANG DIPRODUKSI! Selama ada drama untuk diberitakan, beritakan SELURUHNYA tanpa batasan angka 8-12. Telusuri seluruh data yang ada: laporkan seluruh perebutan tahta, semua pergerakan peringkat tajam, semua kerugian poin what-if di tabel whatIfOpportunities, penggunaan chip, penalti minus hit transfer, serta performa pemain kunci. Hasilkan seluruhnya dalam format JSON array valid.';

  const systemInstruction = `Anda adalah Redaktur Utama & Jurnalis Olahraga Investigatif Resmi untuk liga fantasi "FPL Nusantara BERHADIAH" (FNB League).

${FPL_OFFICIAL_RULES_TEXT}

### 4 KATEGORI JUARA FNB LEAGUE (TUJUAN AKHIR SELURUH TIM LIGA):
1. Peringkat 1 Klasemen (Rank 1): Juara Utama Akumulasi Poin Musim.
2. Peringkat 2 Klasemen (Rank 2): Runner-up Utama Liga.
3. Juara Terbanyak (Most GW Champion): Kolektor kemenangan pekan terbanyak (dengan klausul pelimpahan resmi: jika pemegang memuncaki Rank 1 atau 2, status pemenang dilimpahkan ke peringkat berikutnya pada tabel Most GW).
4. Juara Gameweek (GW Champion): Top scorer peraih poin pekan ini tertinggi di liga saat status Final.
   ATURAN MUTLAK JUARA GAMEWEEK:
   - DILARANG menyebutkan penalti minus poin transfer.
   - Wajib sebutkan chip yang digunakan jika ada (contoh: "yang menggunakan [N:Triple Captain]"), dan kosongkan jika tidak menggunakan chip.
   - DILARANG menyebutkan ban kapten tim.
   - Wajib sebutkan pemain dengan perolehan poin tertinggi (raw points tanpa multiplier) di starting XI tim tersebut: "ditopang [P:Nama Pemain] yang menyumbang [N:XX] poin."

### KERANGKA BERPIKIR KAUSAL 8 TAHAP (THE 8-STEP CAUSAL REASONING FRAMEWORK):
Analisis Anda wajib mengalir mengikuti hukum sebab-akibat 8 tahap kompetisi:
1. Tahap 1: Keputusan transfer OUT dan transfer IN, pengorbanan poin hits (-4, -8), aktivasi chip WC/FH, dan korelasi dengan ownership rate pemain di liga.
2. Tahap 2: Keputusan aktivasi chip TC/BB, penyusunan 11 pemain Starting XI dan urutan 4 pemain di Bench, penetapan Kapten (2x) dan Wakil Kapten (VC), serta captaincy rate liga.
3. Tahap 3: Batas waktu terlewati (Deadline Passed) - seluruh susunan pemain dan keputusan terkunci permanen.
4. Tahap 4: Live match - pemain EPL (baik yang dimiliki tim FNB maupun tidak dimiliki) menghasilkan poin nyata di lapangan.
5. Tahap 5: Akumulasi poin tim FNB League (termasuk pengganda kapten 2x/3x, poin bench jika BB aktif atau ada autosub, dan pengurangan penalti hit transfer).
6. Tahap 6: Pergerakan klasemen dan dampaknya terhadap perburuan 4 jenis juara.
7. Tahap 7: GW Provisional - seluruh laga usai, menunggu audit resmi Opta untuk BPS (3, 2, 1), kalkulasi autosub, dan update liga.
8. Tahap 8: GW Confirmed / Final - seluruh poin dan klasemen dikunci mutlak 100% oleh FPL, 4 jenis juara disahkan resmi.

### PRINSIP PEMAHAMAN KONTEKS JURNALISTIK & EVALUASI DRAMA:

1. PEMAHAMAN KONTEKS HISTORIS PERINGKAT KLASEMEN:
   Peringkat klasemen dipahami sebagai representasi dinamis perjalanan kompetisi antar-pekan, bukan sekadar angka posisi statis. Analisis terhadap posisi tim wajib memperhitungkan relasi antara peringkat pekan berjalan ('rank') dengan peringkat pekan sebelumnya ('lastRank'):
   - Arah dan magnitudo perpindahan posisi mencerminkan dampak kumulatif performa tim di pekan tersebut.
   - Pergeseran pada pemegang posisi puncak mencerminkan dinamika pergantian kekuasaan tahta klasemen antar-rival langsung.
   - Perubahan posisi dengan rentang perpindahan yang lebar mencerminkan akselerasi lonjakan performa atau sebaliknya keparahan penurunan posisi tim secara signifikan.
   - Ketiadaan pergeseran posisi di tengah ketatnya selisih angka mencerminkan stabilitas dan konsistensi daya tahan tim dalam mempertahankan posisi kompetitifnya.
   - Seluruh narasi yang menyinggung klasemen wajib berpijak pada fakta perbandingan historis ini untuk membangun kedalaman konteks yang berbobot tanpa membuat klaim tanpa dasar.

2. EVALUASI TINGKAT DRAMA BERDASARKAN NILAI DAN PENGAMBILAN KEPUTUSAN:
   Tingkat drama sebuah peristiwa ditentukan secara objektif oleh kombinasi nilai angka yang dihasilkan dan konsekuensi strategis dari keputusan yang diambil.
   - Evaluasi nilai dilakukan dengan membandingkannya terhadap distribusi statistik seluruh elemen sejenis pada pekan yang sama.
   - Peristiwa dengan deviasi angka ekstrem, ketidakterdugaan capaian terhadap ekspektasi posisi pemain, serta keputusan manajerial yang secara langsung mengubah peta perebutan 4 kategori juara liga memiliki bobot signifikansi drama tertinggi.
   - Penilaian drama tidak dibentuk melalui gaya bahasa berlebihan, melainkan terpancar dari ketajaman perbandingan angka faktual dan dampak nyata keputusan tersebut terhadap nasib tim.

3. PEMAHAMAN SKENARIO KEPUTUSAN ALTERNATIF DARI SUDUT PANDANG FAKTA KEHILANGAN POTENSI POIN:
   Analisis skenario alternatif (what-if) dipahami dan disajikan murni dari sudut pandang fakta kerugian atau kehilangan peluang riil yang dialami tim akibat tindakan yang diambil, BUKAN sebagai kalimat pengandaian:
   - Pola narasi berpusat pada subjek tim yang menanggung konsekuensi:
     "Tim kehilangan potensi sejumlah poin karena tindakan manajerial yang diambil (baik mencadangkan pemain, mengkaptenkan pemain, atau menjual pemain) dan menggantinya dengan opsi lain yang hanya mendapat perolehan poin lebih rendah."
   - 3 Dimensi Keputusan Faktual:
     a. Dimensi Bangku Cadangan: Tim kehilangan potensi poin karena keputusan mencadangkan pemain tertentu dan memainkan pemain starter yang hanya mendapat perolehan poin lebih rendah di lapangan.
     b. Dimensi Ban Kapten: Tim kehilangan potensi poin karena keputusan mengkaptenkan pemain tertentu dibanding opsi pemain lain di skuad yang meraih perolehan poin lebih tinggi.
        ATURAN MUTLAK IRONI KAPTEN: Kiper (GKP) dan Bek (DEF) TIDAK LAZIM dijadikan kapten dalam FPL. DILARANG KERAS menjadikan bek atau kiper berpoin besar sebagai bahan perbandingan ironi kegagalan kapten! Alternatif pembanding kapten HANYA BOLEH berasal dari pemain menyerang (Gelandang/MID atau Penyerang/FWD).
     c. Dimensi Transfer (Karma Transfer / The Sold Asset Haul): Tim kehilangan potensi poin karena keputusan menjual pemain tertentu dan menggantinya dengan pemain baru yang hanya mendapat perolehan poin lebih rendah.
        ATURAN MUTLAK POIN KARMA TRANSFER (DILARANG MENGALIKAN DENGAN JUMLAH TIM):
        - Poin pemain yang dijual TETAP DITAMPILKAN SESUAI POIN ASLI PERORANGAN PEMAIN TERSEBUT DI LAPANGAN ([N:playerPts] poin).
        - DILARANG KERAS MENGALIKAN POIN PEMAIN DENGAN JUMLAH TIM YANG MENJUAL / KENA KARMA!
        - Baik untuk 1 tim maupun konsolidasi banyak tim, angka poin yang disebut adalah poin murni perorangan pemain tersebut (contoh: "[P:Verbruggen] yang meraih [N:11] poin"), BUKAN akumulasi perkalian tim!
   - DILARANG KERAS menggunakan kata-kata pengandaian (seperti "Andai", "Seandainya", "Jika saja", "Jikalau", "Had they", "If only", "Would have earned").
   - Nilai selisih potensi angka merupakan selisih bersih matematis yang akurat dari tabel whatIfOpportunities data mentah, dan hanya disebut 'poin' atau 'tambahan poin' tanpa menyertakan kata 'bersih'.

4. PRINSIP RENTANG KAUSALITAS TERJAUH (MAXIMUM CAUSAL SPAN):
   Kedalaman berita dicapai dengan menarik benang merah kausalitas pada jarak terjauh antar-tahap kompetisi:
   - Menghubungkan keputusan manajerial pra-deadline paling awal (Tahap 1 atau Tahap 2) dengan pengesahan resmi posisi juara di akhir pekan (Tahap 8).
   - Menghubungkan pertaruhan taktik awal dengan ketegangan status sementara menunggu audit data (Tahap 7).
   - Hindari narasi dangkal dengan rentang kausalitas pendek yang hanya memotret skor pertandingan tanpa kaitan terhadap keputusan manajer dan implikasi klasemen.

5. PRINSIP KEPADATAN FAKTA MULTI-TAHAP (MULTI-STAGE FACT DENSITY):
   Bobot berita ditentukan oleh kekayaan fakta konkret yang saling terhubung dalam satu narasi. Rajut fakta-fakta relevan dari tahapan perantara (poin individu, kontribusi defensif, status audit bonus, penalti transfer, serta pergeseran posisi) ke dalam struktur kalimat yang mengalir profesional.

6. DIVERSIFIKASI ENTITAS MUTLAK (ANTI-REPETISI):
   - Diversifikasi dalam satu batch: Setiap entitas pemain ([P:...]) dan tim ([T:...]) hanya boleh muncul maksimal 1 kali dalam seluruh paket berita yang dihasilkan. Hindari pemusatan liputan pada figur atau tim yang sama agar menyajikan dinamika menyeluruh dari seluruh peserta liga.
   - Diversifikasi antar-batch: Hindari mengulang figur pemain atau tim yang baru saja diliput pada siklus produksi sebelumnya berdasarkan data histori cache.

7. FORMAT PENANDAAN VISUAL ENTITAS:
   Gunakan tanda kurung siku untuk klasifikasi tipe entitas teks:
   - [T:Nama Tim] untuk nama tim peserta liga.
   - [P:Nama Pemain] untuk nama pemain Premier League.
   - [C:Nama Klub] untuk nama klub Premier League.
   - [N:Angka/Poin/Peringkat] untuk angka poin, selisih skor, atau posisi peringkat.

8. PEMAHAMAN STATUS PERTANDINGAN (MATCH STATUS AWARENESS):
   Anda wajib memahami status 10 laga di Gameweek ini yang terbagi menjadi 3 kategori nyata:
   a. PERTANDINGAN SUDAH SELESAI (Finished / FT):
      - 90 menit telah tuntas, skor akhir final, dan poin pemain dari kedua klub telah terkunci pasti.
      - Tim yang seluruh 11 pemain starternya berstatus selesai (0 pemain tersisa) tidak bisa menambah poin lagi dan rentan terkejar oleh rival di bawahnya.
   b. PERTANDINGAN SEDANG BERJALAN (Live / In Progress):
      - Laga sedang aktif bergulir di lapangan nyata saat ini (menit berjalan, babak 1, HT, babak 2).
      - Panggung drama real-time utama: gol, assist, saves, kartu, dan bonus BPS bergerak dinamis mengubah skor tim secara live.
   c. PERTANDINGAN BELUM DIMAINKAN (Upcoming / Belum Kickoff):
      - Laga belum dimulai (tertera jam kickoff WIB).
      - Pemain dari klub yang belum bertanding MASIH MENYIMPAN POTENSI POIN PENUH (poin masih 0 murni karena belum bermain, DILARANG menyebutnya gagal meraih poin atau blank!).
      - FOKUS JURNALISTIK: Sorot tim-tim yang tertinggal namun masih memiliki 'amunisi simpanan' (pemain starter atau kapten yang belum bertanding) untuk mengejar dan mengguncang tahta juara.

9. RELASI NAMA PEMAIN DAN KLUB:
   - Nama klub pemain wajib merujuk persis pada data relasi resmi di tabel database:
     * Konsa ([C:Arsenal])
     * João Pedro ([C:Chelsea])
     * Rogers ([C:Chelsea])
     * Haaland ([C:Man City])
     * Gabriel ([C:Arsenal])
     * Schade ([C:Brentford])
     * Tavernier ([C:Bournemouth])
     * Palmer ([C:Chelsea])
     * Kinsky ([C:Spurs])
     * Isak ([C:Liverpool])
     * Muharemović ([C:Leeds])
     * Ouattara ([C:Ipswich Town])
     * Enciso ([C:Ipswich Town])
     * Cherki ([C:Man City])
   - Format penyebutan klub pemain dituliskan berdampingan menggunakan tanda kurung siku tanpa kata penghubung 'dari': [P:Nama Pemain] ([C:Nama Klub]).

10. STRUKTUR & PANTANGAN PENULISAN:
   - Kalimat berita langsung menyajikan substansi informasi tanpa menambahkan kata pengantar, label kategori, atau judul berita di bagian awal.
   - Gaya penulisan menggunakan tanda titik (.) sebagai penutup dan melarang keras penggunaan tanda seru (!).
   - Penyebutan selisih angka hasil kalkulasi alternatif hanya menggunakan kata 'poin' atau 'tambahan poin' di mana nilai numeriknya telah mencerminkan hasil bersih tanpa menyertakan kata 'bersih'.

11. ATURAN KATA GANTI ENTITAS TIM (TUNGGAL VS JAMAK):
   - 1 TIM ADALAH ENTITAS TUNGGAL: DILARANG KERAS mendeskripsikan 1 tim sebagai "mereka" (dalam Bahasa Indonesia) atau "they/them/their" (dalam Bahasa Inggris).
   - Gunakan rujukan tunggal: "tim tersebut", "skuad tersebut", "tim ini", atau akhiran "-nya" (contoh: "posisinya", "upayanya", "skornya", "pemainnya"). Dalam Bahasa Inggris gunakan "the team", "it", atau "its" (bukan "they/their").
   - Kata "mereka" / "they / them / their" HANYA boleh digunakan jika secara eksplisit merujuk pada LEBIH DARI 1 TIM (jamak, misalnya: "kedua tim", "tim-tim papan bawah", "[T:Tim A] dan [T:Tim B]").

12. ${quantityInstruction}

13. ATURAN BAKU PENYEBUTAN DAFTAR TIM (AI & NON-AI):
    - Wajib menerapkan aturan kuantitas berikut setiap kali menyebutkan daftar tim:
      * Jika jumlah tim <= 3: Wajib sebutkan SEMUA nama tim secara lengkap:
        - 1 tim: [T:A]
        - 2 tim: [T:A] dan [T:B] (EN: [T:A] and [T:B])
        - 3 tim: [T:A], [T:B], dan [T:C] (EN: [T:A], [T:B], and [T:C])
      * Jika jumlah tim > 3: Sebutkan 2 nama tim pertama dan sisa n tim lainnya:
        - Contoh 4 tim: [T:A], [T:B], dan [N:2] tim lainnya (EN: [T:A], [T:B], and [N:2] other teams)
        - Contoh 5 tim: [T:A], [T:B], dan [N:3] tim lainnya (EN: [T:A], [T:B], and [N:3] other teams)
        - Contoh 8 tim: [T:A], [T:B], dan [N:6] tim lainnya (EN: [T:A], [T:B], and [N:6] other teams)
    - Jika suatu pemain menjadi sumber drama di lebih dari 1 tim (seperti tertera di tabel crossTeamPlayerDrama), TAMPILKAN DALAM 1 BERITA TUNGGAL (konsolidasi lintas-tim) dengan aturan penyebutan tim di atas:
      * ATURAN MUTLAK POIN KARMA TRANSFER & WHAT-IF LINTAS-TIM (DILARANG MENGALIKAN DENGAN JUMLAH TIM):
        - Poin pemain yang ditampilkan WAJIB SESUAI POIN ASLI PERORANGAN PEMAIN TERSEBUT DI LAPANGAN ([N:playerPts] poin). DILARANG KERAS mengalikannya dengan jumlah tim yang terlibat!
        - Contoh Karma Transfer (2 tim): "[T:A2N's Team] dan [T:Mooy Pablo] sama-sama merugi setelah menjual [P:Verbruggen] ([C:Brighton]) yang meraih [N:11] poin di pekan ini." (Angka 11 adalah poin asli Verbruggen, DILARANG dikalikan menjadi 22 poin!).
        - Contoh Karma Transfer (>3 tim): "[T:Carbela FC], [T:Bolakbalik], dan [N:2] tim lainnya sama-sama merugi setelah menjual [P:Palmer] ([C:Chelsea]) yang mencetak [N:8] poin di pekan ini." (Angka 8 adalah poin asli Palmer, DILARANG dikalikan menjadi 32 poin!).
        - Contoh Bangku Cadangan: "[T:Yuk Bisa Yuk FC], [T:Sumber Bahagia Motor], dan [N:26] tim lainnya sama-sama menyesali keputusan mencadangkan [P:Verbruggen] ([C:Brighton]) yang menyumbang [N:11] poin dari bangku cadangan." (Bukan 297 poin!).
        - Contoh Ban Kapten: "[T:Persigundul], [T:Long Moo Long FC], dan [N:59] tim lainnya sama-sama kehilangan potensi poin karena tidak memilih [P:Rogers] ([C:Chelsea]) yang meraih [N:7] poin sebagai kapten di pekan ini." (Bukan 435 poin!).

14. ATURAN ROTASI KONTEKS & ANTI-CLUSTER BERTURUT-TURUT:
    - DILARANG KERAS menyajikan berita dengan konteks yang sama secara berturut-turut (TERUTAMA DILARANG MENAMPILKAN WHAT-IF SECARA BERUNTUN!).
    - Setiap headline yang berdampingan WAJIB memiliki kategori sudut pandang yang berbeda.
    - Wajib lakukan rotasi pola konteks:
      (a) Perebutan Tahta / Gelar Juara (Kudeta Tahta, Rank 1 vs 2, Most GW, Juara Pekan)
      (b) Lonjakan / Kejatuhan Peringkat Klasemen (Tim-tim yang melompat naik atau terjun tajam)
      (c) Drama What-If / Keputusan Manajer (Konsolidasi lintas-tim)
      (d) Perjudian Chip & Hits Transfer (Aktivasi Wildcard/BB/TC, penalti hits transfer agresif)
      (e) Sorotan Bintang / Pemain Kunci (Pahlawan poin pembeda, panen bonus BPS, CS heroik)
    - Ulangi siklus dengan sudut yang bervariasi sehingga pembaca tidak mengalami kebosanan akibat konteks yang sama berulang-ulang!

15. ATURAN BAKU PENYEBUTAN POIN & PERINGKAT KLASEMEN BERDASARKAN STATUS GAMEWEEK (MUTLAK):
    - STATUS 'Not started' (Pra-Gameweek):
      * JANGAN PERNAH menampilkan atau memproduksi berita yang menyebutkan perolehan poin atau pergerakan peringkat klasemen Gameweek ini!
      * Belum ada pertandingan dimulai dan belum ada poin/rank berjalan. Berita HANYA fokus pada jadwal laga mendatang, tren transfer pemain masuk/keluar, kepemilikan pemain, dan aktivasi chip pra-pekan.
    - STATUS 'Confirmed' (GW Final / Disahkan Resmi 100%):
      * Tampilkan poin dan peringkat sebagai HASIL RESMI yang sudah ditetapkan dan dikunci permanen oleh FPL.
      * TAMPILKAN 4 TIM JUARA RESMI DI NEWS TICKER: Juara Gameweek Resmi, Juara 1 Liga Resmi, Juara 2 Liga Resmi (Runner-Up), dan Juara Terbanyak Mingguan Resmi (dengan klausul pelimpahan resmi jika berlaku).
      * Wajib gunakan terminologi resmi: "klasemen resmi", "peringkat resmi", "poin resmi", "resmi dinobatkan", "resmi mengunci peringkat [N:X]", "hasil resmi yang sudah ditetapkan". (EN: "official standings", "official rank", "officially confirmed points", "officially crowned", "officially confirmed result").
    - STATUS SELAIN ITU ('Live', 'Provisional', atau Jeda Antar-Laga):
      * Tampilkan poin dan peringkat sebagai HASIL SEMENTARA karena pertandingan masih berjalan atau proses audit Opta/klasemen liga belum selesai.
      * Wajib gunakan terminologi sementara: "klasemen sementara", "peringkat sementara", "poin sementara", "hasil sementara", "memimpin sementara". (EN: "provisional standings", "provisional rank", "temporary points", "provisional points", "temporarily leading"). DILARANG menyebutnya resmi atau permanen!`;

  // Streamline payload to keep token size concise, prevent 504 Deadline Exceeded, and emphasize top drama
  const cleanStandingsList = (list: any[]) => list.map((t) => ({
    rank: t.rank,
    lastRank: t.lastRank,
    rankChange: t.rankChange,
    rankContext: t.rankContext,
    team: t.team,
    gwPts: t.gwPts,
    totalPts: t.totalPts,
    hitPenalty: t.hitPenalty,
    chip: t.chip,
    captain: t.captain,
    viceCaptain: t.viceCaptain,
    benchPts: t.benchPts,
  }));

  const topWhatIf = [...payload.whatIfOpportunities]
    .sort((a, b) => b.netDeltaPts - a.netDeltaPts)
    .slice(0, 18);

  const topPlayers = [...payload.activePlayersTable]
    .sort((a, b) => (b.gwPts || 0) - (a.gwPts || 0))
    .slice(0, 25)
    .map((p) => ({
      name: p.name,
      club: p.club,
      pos: p.pos,
      gwPts: p.gwPts,
      mins: p.mins,
      matchStatus: p.matchStatus,
      goals: p.goals,
      assists: p.assists,
      cs: p.cs,
      bps: p.bps,
      bonus: p.bonus,
      fnbOwned: p.fnbOwned,
    }));

  const promptData = {
    gameweek: payload.gameweek,
    nextGameweek: payload.nextGameweek,
    gameweekPhase: payload.gameweekPhase,
    phaseDescription: payload.phaseDescription,
    matchesOverview: payload.matchesOverview,
    leagueStats: payload.leagueStats,
    championshipStatus: payload.championshipStatus,
    standingsHistoricalContext: payload.standingsHistoricalContext,
    crossTeamPlayerDrama: payload.crossTeamPlayerDrama.slice(0, 15),
    whatIfOpportunities: topWhatIf,
    transfersIn: payload.transfersIn,
    transfersOut: payload.transfersOut,
    chipsActive: payload.chipsActive,
    topStandings: cleanStandingsList(isLiveMatchActive ? payload.standingsTable.slice(0, 20) : payload.standingsTable.slice(0, 25)),
    standingsMovers: cleanStandingsList(payload.standingsTable.filter((s) => Math.abs(s.rankChange) >= (isLiveMatchActive ? 5 : 3)).slice(0, 15)),
    activePlayersTable: topPlayers,
  };

  const userPrompt = `Berikut adalah data mentah lengkap GW ${payload.gameweek} FNB League beserta Data Pertandingan (Finished, Live, Upcoming), Tabel What-If Opportunities, Tabel Drama Pemain Lintas-Tim (Cross-Team Player Drama), dan Data Historis Peringkat Klasemen yang telah dihitung secara presisi:
${JSON.stringify(promptData)}

### RIWAYAT BERITA HASIL PRODUKSI-PRODUKSI SEBELUMNYA (WAJIB DIPERIKSA AGAR TIDAK DIULANG):
${pastHeadlinesFormatted}

PANDUAN EKSEKUSI JURNALISTIK & AUDIT ANTI-PENGULANGAN MUTLAK:
1. PAHAMI STATUS FASE PEKAN & 10 LAGA:
   - Jika fase 'Not started': Seluruh laga belum dimainkan (Upcoming). DILARANG mengulas skor pemain atau klasemen akhir. Fokus berita pada strategi pra-pekan: pemain terpopuler yang ditransfer masuk/keluar, aktivasi chip (WC, FH, BB, TC), pilihan ban kapten favorit/diferensial, dan penalti minus hits yang diambil para manajer.
   - Jika fase 'Live' tetapi sedang JEDA ANTAR-PERTANDINGAN (0 laga aktif di lapangan, sebagian laga FT dan sebagian Upcoming): JANGAN buat laporan menit berjalan karena bola sedang tidak bergulir. Fokus liputan pada rekapitulasi poin laga yang telah usai (FT) vs tim-tim di bawah yang masih menyimpan amunisi pemain/kapten di laga berikutnya (Upcoming) untuk melakukan kudeta tahta.
   - Pada laga yang sedang aktif bergulir (Live): Sorot menit berjalan dan aksi dinamis yang sedang mengubah perolehan tim di lapangan.
   - Pada laga yang belum dimainkan (Upcoming): Sorot tim-tim yang masih menyimpan amunisi pemain/kapten untuk mengejar ketertinggalan poin. Jangan sebut mereka 'blank' atau gagal.
   - Pada laga yang selesai (FT): Sorot poin pasti yang berhasil diamankan atau poin yang hilang akibat keputusan susunan skuad.
2. PERIKSA RIWAYAT SEBELUMNYA DENGAN CERMAT: Jangan sampai memproduksi berita yang mengulang topik, kejadian, atau substansi drama yang sama persis dengan berita-berita di atas!
3. ENTITAS PEMAIN LINTAS-TIM DITAMPILKAN DALAM 1 BERITA: Manfaatkan tabel crossTeamPlayerDrama. Jika pemain yang sama melibatkan lebih dari 1 tim (misal Konsa, Gabriel, Haaland, Bijol), gabungkan seluruh tim tersebut ke dalam 1 berita konsolidasi.
   ATURAN MUTLAK POIN KARMA & WHAT-IF: Poin pemain TETAP DITAMPILKAN SESUAI POIN ASLI PEMAIN TERSEBUT DI LAPANGAN, TANPA DIKALIKAN JUMLAH TIM YANG KENA KARMA! (Contoh: jika pemain meraih 8 poin, sebutkan 8 poin, jangan dikalikan dengan 4 tim menjadi 32 poin).
4. ROTASI KONTEKS & ANTI-CLUSTER BERTURUT-TURUT: DILARANG MENAMPILKAN WHAT-IF SECARA BERUNTUN! Wajib selingi setiap berita dengan kategori berbeda (Perebutan Gelar -> Lonjakan/Kejatuhan Peringkat -> What-If Konsolidasi -> Chip/Hits -> Spotlight Pemain Bintang).
5. Skenario keputusan alternatif (what-if) WAJIB disajikan dari sudut pandang fakta riil: Tim kehilangan potensi sejumlah poin karena mencadangkan pemain, mengkaptenkan pemain, atau menjual pemain dan menggantinya dengan pemain lain yang hanya mendapat perolehan poin lebih rendah. DILARANG menggunakan kata pengandaian (seperti 'Andai', 'Seandainya', 'Jika saja', 'Had they', 'If').
6. Gunakan nilai selisih bersih matematis dari tabel whatIfOpportunities tanpa menyebutkan kata 'bersih', cukup sebutkan kata 'poin' atau 'tambahan poin'.
7. Mulai kalimat langsung pada substansi berita tanpa judul atau awalan berkategori.
8. Akhiri setiap kalimat dengan tanda titik (.), tanpa tanda seru (!).
9. Format penyebutan klub pemain menggunakan tanda kurung tanpa kata 'dari': [P:Pemain] ([C:Klub]).
10. ATURAN ENTITAS TIM TUNGGAL: 1 tim adalah entitas tunggal dan DILARANG dideskripsikan sebagai 'mereka' (atau 'they/them/their'). Gunakan 'tim tersebut', 'skuad tersebut', atau akhiran '-nya' (dalam EN: 'the team', 'its'). Kata 'mereka' hanya boleh jika merujuk lebih dari 1 tim.
11. MAKSIMALKAN STRATEGI SINGLE BATCH: Buat 20 hingga 30 berita dwibahasa simultan yang kaya dan bervariasi dengan rotasi konteks yang seimbang (selingi antara peringkat, what-if lintas-tim, chip/hits, dan pemain kunci) dalam format JSON array valid:
[
  {
    "id": "story_1",
    "headline_id": "Tuliskan kalimat berita LENGKAP dalam Bahasa Indonesia (WAJIB berupa kalimat utuh, BUKAN kode/id slug) memuat fakta dan tag entitas seperti [T:Nama Tim], [P:Nama Pemain] ([C:Klub]), [N:Angka].",
    "headline_en": "Write complete headline sentence in English with factual data and entity tags.",
    "drama_score": 90
  }
]`;

function parseStoriesFromRaw(rawText: string): any[] | null {
  const clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const direct = JSON.parse(clean);
    if (Array.isArray(direct)) return direct;
  } catch {}

  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(clean.substring(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

  // Primary model (gemini-3.8-flash workhorse) and robust fallbacks
  const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let stories: NewsTickerStory[] = [];
  let executionError: any = null;

  for (const model of candidateModels) {
    try {
      console.log(`[Gemini News Service] Querying model ${model} for autonomous news ticker (liveMatchActive: ${isLiveMatchActive})...`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.5,
          maxOutputTokens: 4096,
        },
      });

      const rawText = response.text || '';
      const parsed = parseStoriesFromRaw(rawText);
      if (parsed && parsed.length > 0) {
        // Enforce intra-batch entity uniqueness & strip any residual title prefix
        const playerCounts = new Map<string, number>();
        const seenTeams = new Set<string>();
        const maxPlayerPerBatch = isLiveMatchActive ? 1 : 5;
        const filteredStories: NewsTickerStory[] = [];

        for (const item of parsed) {
          const rawId = String(item.headline_id || item.headline || '').trim();
          const rawEn = String(item.headline_en || item.headline || '').trim();

          // Reject raw slug or non-sentence
          if (!rawId.includes(' ') || rawId.length < 15 || rawId.startsWith('chip_') || rawId.startsWith('title_') || rawId.startsWith('bench_') || rawId.startsWith('what_if_')) {
            continue;
          }

          const headlineId = cleanHeadlineBody(rawId);
          const headlineEn = cleanHeadlineBody(rawEn || rawId);
          const combined = `${headlineId} ${headlineEn}`;

          // Extract players
          const pMatches = combined.match(/\[P:([^\]]+)\]/g) || [];
          const playerNames = pMatches.map((m) => m.replace(/^\[P:|\]$/g, '').trim().toLowerCase());

          // Extract teams
          const tMatches = combined.match(/\[T:([^\]]+)\]/g) || [];
          const teamNames = tMatches.map((m) => m.replace(/^\[T:|\]$/g, '').trim().toLowerCase());

          // Check if any player exceeded max appearances in batch
          const overusedPlayer = playerNames.find((p) => (playerCounts.get(p) || 0) >= maxPlayerPerBatch);
          if (overusedPlayer) {
            console.log(`[Gemini News Service] Skipping headline exceeding player quota (${overusedPlayer}): ${headlineId}`);
            continue;
          }

          // Check if any team in this headline was already featured in this batch (allow Yuk Bisa Yuk FC if context differs)
          const duplicateTeam = teamNames.find((t) => seenTeams.has(t) && !t.includes('yuk bisa yuk'));
          if (duplicateTeam) {
            console.log(`[Gemini News Service] Skipping duplicate team in batch: ${duplicateTeam}`);
            continue;
          }

          // Register seen entities
          playerNames.forEach((p) => playerCounts.set(p, (playerCounts.get(p) || 0) + 1));
          teamNames.forEach((t) => seenTeams.add(t));

          filteredStories.push(toNewsTickerStory({
            id: String(item.id || `story_${filteredStories.length + 1}`),
            headline_id: headlineId,
            headline_en: headlineEn,
            drama_score: Number(item.drama_score) || 80,
            sumber: 'AI',
            status_tayang: 'Y',
          }, payload.gameweek));
        }

        // If filtering retained at least 6 diverse stories, use them; otherwise use parsed directly
        const finalStories = filteredStories.length >= 6
          ? filteredStories
          : parsed.map((item, idx) => toNewsTickerStory({
              id: String(item.id || `story_${idx + 1}`),
              headline_id: cleanHeadlineBody(String(item.headline_id || item.headline || '')),
              headline_en: cleanHeadlineBody(String(item.headline_en || item.headline || item.headline_id || '')),
              drama_score: Number(item.drama_score) || 80,
              sumber: 'AI',
              status_tayang: 'Y',
            }, payload.gameweek));

        stories = interleaveStoriesByContext(finalStories);
        console.log(`[Gemini News Service] Successfully generated and interleaved ${stories.length} diverse stories with ${model}`);
        break;
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      const is503 = Boolean(
        e?.status === 503 ||
        e?.code === 503 ||
        errMsg.includes('503') ||
        errMsg.includes('high demand') ||
        errMsg.includes('UNAVAILABLE')
      );
      const is504 = Boolean(
        e?.status === 504 ||
        e?.code === 504 ||
        errMsg.includes('504') ||
        errMsg.includes('DEADLINE_EXCEEDED') ||
        errMsg.includes('Deadline expired') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('timeout')
      );

      if (is504) {
        console.warn(`[Gemini News Service] Model ${model} timed out or exceeded deadline (504). Failing over to next model candidate...`);
        executionError = e;
        continue;
      }

      if (is503) {
        console.warn(`[Gemini News Service] Model ${model} is experiencing temporary high demand (503). Failing over to next model candidate...`);
        executionError = e;
        continue;
      }

      const isQuotaError = Boolean(
        e?.status === 'RESOURCE_EXHAUSTED' ||
        e?.code === 429 ||
        errMsg.includes('429') ||
        errMsg.includes('quota') ||
        errMsg.includes('RESOURCE_EXHAUSTED')
      );

      if (isQuotaError) {
        let cooldownMs = 60 * 60 * 1000; // 1 hour default
        const hMatch = errMsg.match(/retry in\s+([0-9]+)h/i);
        const mMatch = errMsg.match(/retry in\s+([0-9]+)m/i);
        const sMatch = errMsg.match(/retryDelay":"([0-9]+)s"/i);
        if (hMatch) cooldownMs = parseInt(hMatch[1], 10) * 3600 * 1000;
        else if (mMatch) cooldownMs = parseInt(mMatch[1], 10) * 60 * 1000;
        else if (sMatch) cooldownMs = parseInt(sMatch[1], 10) * 1000;

        quotaCooldownUntil = Date.now() + cooldownMs;
        console.warn(`[Gemini News Service] Free-tier daily quota reached on Gemini. Entering cooldown until ${new Date(quotaCooldownUntil).toISOString()}.`);
        executionError = new Error('Daily quota limit reached on Free Tier.');
        break; // Stop querying subsequent models to avoid compounding 429 error logs
      } else {
        console.warn(`[Gemini News Service] Model ${model} failed:`, errMsg.substring(0, 100));
        executionError = e;
      }
    }
  }

  if (stories.length === 0) {
    if (executionError && (executionError?.status === 503 || executionError?.code === 503 || String(executionError?.message).includes('503'))) {
      quotaCooldownUntil = Date.now() + 30000; // 30s short cooldown during global Gemini high demand
    }
    console.log(`[Gemini News Service] Activating deterministic rule-based fallback stories for GW${payload.gameweek}.`);
    stories = buildFallbackStories(payload);
  }

  return await assembleAndCacheFeed(stories, payload, currentHash);
}

/**
 * Seeds purely factual historical stories from cachedLeagueData.json
 * to maintain a rich rotating pool of up to 1000 factual headlines.
 */
export function seedHistoricalNewsPool(forceReset = false): void {
  try {
    const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');
    if (!fs.existsSync(CACHE_PATH)) return;
    const d = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));

    const existingHistory = loadNewsHistory();
    if (!forceReset && existingHistory.length >= 950) return; // Already well-seeded

    const seen = new Set<string>();
    const pool: NewsTickerStory[] = [];

    const currentActiveGw = Number(d.current_gw) || 9;

    if (!forceReset) {
      existingHistory.forEach((h) => {
        seen.add(h.headline_id);
        const storyGw = Number(h.gw) || currentActiveGw;
        const isCurrent = (storyGw === currentActiveGw);
        pool.push(toNewsTickerStory({
          id: h.id,
          headline_id: h.headline_id,
          headline_en: h.headline_en,
          drama_score: h.drama_score || 80,
          gw: storyGw,
          timestamp: h.timestamp,
          teams: h.teams,
          players: h.players,
          sumber: h.sumber,
          status_tayang: isCurrent ? (h.status_tayang || 'Y') : 'N',
          keterangan_tidak_tayang: isCurrent ? (h.keterangan_tidak_tayang || '') : `Bukan Gameweek aktif (Arsip Gameweek ${storyGw})`,
        }, storyGw));
      });
    }

    const addStory = (id: string, idText: string, enText: string, storyGw?: number) => {
      if (pool.length >= 1000) return;
      const cleanId = cleanHeadlineBody(idText);
      const cleanEn = cleanHeadlineBody(enText);
      if (seen.has(cleanId)) return;
      seen.add(cleanId);
      const gwNum = storyGw || currentActiveGw;
      const isCurrent = (gwNum === currentActiveGw);
      pool.push(toNewsTickerStory({
        id,
        headline_id: cleanId,
        headline_en: cleanEn,
        drama_score: 80,
        gw: gwNum,
        sumber: 'Bukan',
        status_tayang: isCurrent ? 'Y' : 'N',
        keterangan_tidak_tayang: isCurrent ? '' : `Bukan Gameweek aktif (Arsip Gameweek ${gwNum})`,
      }, gwNum));
    };

    // 1. GW Champions across all Gameweeks (hasil resmi yang sudah ditetapkan)
    for (const row of d.gameweek_champions || []) {
      for (const c of row.champions || []) {
        addStory(
          `champ_gw${row.event}_${c.entry_id}`,
          `[T:${c.entry_name}] resmi dinobatkan sebagai Juara Gameweek [N:${row.event}] FNB League dengan raihan [N:${c.points} Poin] (hasil resmi yang sudah ditetapkan).`,
          `[T:${c.entry_name}] is officially crowned FNB League Gameweek [N:${row.event}] Champion with [N:${c.points} Pts] (officially confirmed result).`,
          Number(row.event)
        );
      }
    }

    // 1b. Most GW Champions Leader with pass-down rule (hasil resmi yang sudah ditetapkan)
    const mostGwList = Array.isArray(d.most_gameweek_champions) ? d.most_gameweek_champions : [];
    const validMostGw = mostGwList.filter((m: any) => m && m.win_count > 0);
    if (validMostGw.length > 0) {
      const top1 = d.standings?.[currentActiveGw]?.find((s: any) => s.rank === 1);
      const top2 = d.standings?.[currentActiveGw]?.find((s: any) => s.rank === 2);
      const topIds = new Set<number>();
      if (top1?.entry_id) topIds.add(top1.entry_id);
      if (top2?.entry_id) topIds.add(top2.entry_id);
      const eligible = validMostGw.find((m: any) => !topIds.has(m.entry_id)) || validMostGw[0];
      const rawTop = validMostGw[0];
      const isPassed = Boolean(eligible && rawTop && (eligible.entry_id !== rawTop.entry_id || eligible.entry_name !== rawTop.entry_name));
      addStory(
        `most_gw_official_lead`,
        `[T:${eligible.entry_name}] resmi memegang gelar Juara Terbanyak Mingguan FNB League dengan koleksi [N:${eligible.win_count}] kemenangan mingguan${isPassed ? ` (pelimpahan hak dari [T:${rawTop.entry_name}])` : ''} (hasil resmi yang sudah ditetapkan).`,
        `[T:${eligible.entry_name}] officially holds Most Gameweek Champion title in FNB League with [N:${eligible.win_count}] weekly wins${isPassed ? ` (pass-down from [T:${rawTop.entry_name}])` : ''} (officially confirmed result).`,
        currentActiveGw
      );
    }

    // 2. Chips used across season
    const CHIP_LABELS: Record<string, string> = {
      wc1: 'Wildcard', wc2: 'Wildcard',
      tc1: 'Triple Captain', tc2: 'Triple Captain',
      bb1: 'Bench Boost', bb2: 'Bench Boost',
      fh1: 'Free Hit', fh2: 'Free Hit',
    };
    for (const row of d.all_chips_used || []) {
      for (const [key, label] of Object.entries(CHIP_LABELS)) {
        const val = (row as any)[key];
        if (val && val.gw) {
          addStory(
            `chip_${row.entry_id}_${key}`,
            `[T:${row.entry_name}] mengaktifkan [N:${label}] di Gameweek [N:${val.gw}] dan meraih [N:${val.points} Poin].`,
            `[T:${row.entry_name}] played [N:${label}] in Gameweek [N:${val.gw}] and earned [N:${val.points} Pts].`,
            Number(val.gw)
          );
        }
      }
    }

    // 3. Standings rank movers and official leaders across all confirmed GWs (recent GWs first)
    const revGws = [...(d.available_gws || [])].reverse();
    for (const gw of revGws) {
      const rows = d.standings?.[gw] || [];
      const r1Team = rows.find((s: any) => s.rank === 1);
      const r2Team = rows.find((s: any) => s.rank === 2);
      const gwChRow = (d.gameweek_champions || []).find((g: any) => g && g.event === gw);
      const topGwCh = gwChRow?.champions?.[0];

      // 3a. Combined 4 Official Champions summary headline per confirmed GW
      if (topGwCh && r1Team && r2Team && validMostGw.length > 0) {
        const topIds = new Set<number>([r1Team.entry_id, r2Team.entry_id]);
        const eligible = validMostGw.find((m: any) => !topIds.has(m.entry_id)) || validMostGw[0];
        addStory(
          `summary_4champions_gw${gw}`,
          `4 Tim Juara Resmi FNB League Gameweek [N:${gw}] (hasil resmi yang sudah ditetapkan): Juara Gameweek [T:${topGwCh.entry_name}] ([N:${topGwCh.points}] poin), Juara 1 [T:${r1Team.entry_name}] ([N:${r1Team.total_points}] poin), Juara 2 [T:${r2Team.entry_name}] ([N:${r2Team.total_points}] poin), dan Juara Terbanyak Mingguan [T:${eligible.entry_name}] ([N:${eligible.win_count}] gelar).`,
          `4 Official Champions of FNB League Gameweek [N:${gw}] (officially confirmed results): Gameweek Champion [T:${topGwCh.entry_name}] ([N:${topGwCh.points}] pts), 1st Place [T:${r1Team.entry_name}] ([N:${r1Team.total_points}] pts), 2nd Place [T:${r2Team.entry_name}] ([N:${r2Team.total_points}] pts), and Most Gameweek Champion [T:${eligible.entry_name}] ([N:${eligible.win_count}] titles).`,
          Number(gw)
        );
      }

      for (const r of rows) {
        if (r.rank === 1) {
          addStory(
            `rank1_gw${gw}_${r.entry_id}`,
            `[T:${r.entry_name}] resmi mengunci posisi Juara 1 klasemen resmi FNB League Gameweek [N:${gw}] dengan total [N:${r.total_points} Poin] (hasil resmi yang sudah ditetapkan).`,
            `[T:${r.entry_name}] officially secures 1st Place on the official FNB League table for Gameweek [N:${gw}] with [N:${r.total_points} Pts] (officially confirmed result).`,
            Number(gw)
          );
        } else if (r.rank === 2) {
          addStory(
            `rank2_gw${gw}_${r.entry_id}`,
            `[T:${r.entry_name}] resmi mengamankan posisi Juara 2 (Runner-Up) klasemen resmi FNB League Gameweek [N:${gw}] dengan total [N:${r.total_points} Poin] (hasil resmi yang sudah ditetapkan).`,
            `[T:${r.entry_name}] officially secures 2nd Place (Runner-Up) on the official FNB League table for Gameweek [N:${gw}] with [N:${r.total_points} Pts] (officially confirmed result).`,
            Number(gw)
          );
        } else if (r.rank <= 3) {
          addStory(
            `top_gw${gw}_${r.entry_id}`,
            `[T:${r.entry_name}] menempati peringkat [N:${r.rank}] klasemen di Gameweek [N:${gw}] dengan total [N:${r.total_points} Poin].`,
            `[T:${r.entry_name}] held rank [N:${r.rank}] in Gameweek [N:${gw}] with [N:${r.total_points} Pts].`,
            Number(gw)
          );
        } else if (r.rank_change && Math.abs(r.rank_change) >= 1) {
          const verb = r.rank_change > 0 ? `naik [N:+${r.rank_change}] peringkat` : `turun [N:${r.rank_change}] peringkat`;
          const verbEn = r.rank_change > 0 ? `moved up [N:+${r.rank_change}] places` : `moved down [N:${r.rank_change}] places`;
          addStory(
            `mover_gw${gw}_${r.entry_id}`,
            `[T:${r.entry_name}] ${verb} ke posisi [N:${r.rank}] di Gameweek [N:${gw}] dengan total [N:${r.total_points} Poin].`,
            `[T:${r.entry_name}] ${verbEn} to rank [N:${r.rank}] in Gameweek [N:${gw}] with [N:${r.total_points} Pts].`,
            Number(gw)
          );
        }
      }
    }

    // 4. Transfer penalties across season
    for (const t of d.liga_minus || []) {
      if (t.total_minus && t.total_minus < 0) {
        addStory(
          `minus_${t.entry_id}`,
          `[T:${t.entry_name}] memiliki total penalti transfer [N:${t.total_minus} Poin] sepanjang musim ini.`,
          `[T:${t.entry_name}] carries a total transfer penalty of [N:${t.total_minus} Pts] this season.`,
          Number(d.current_gw || 9)
        );
      }
    }

    // 5. Significant transfers across season
    for (const tr of d.all_transfers || []) {
      if (tr.element_in && tr.element_out) {
        addStory(
          `tr_${tr.entry_id}_${tr.event}_${tr.element_in.id}`,
          `[T:${tr.entry_name}] mentransfer masuk [P:${tr.element_in.name}] ([C:${tr.element_in.club}]) menggantikan [P:${tr.element_out.name}] ([C:${tr.element_out.club}]) di Gameweek [N:${tr.event}].`,
          `[T:${tr.entry_name}] transferred in [P:${tr.element_in.name}] ([C:${tr.element_in.club}]) for [P:${tr.element_out.name}] ([C:${tr.element_out.club}]) in Gameweek [N:${tr.event}].`,
          Number(tr.event)
        );
      }
    }

    if (pool.length > 0) {
      const records: PastNewsRecord[] = pool.map((s) => ({
        ...s,
        gw: s.gw,
        timestamp: s.timestamp_produksi,
      }));
      fs.writeFileSync(HISTORY_CACHE_PATH, JSON.stringify(records, null, 2), 'utf-8');
      console.log(`[Gemini News Service] Seeded historical pool with ${records.length} factual stories (pool now has ${records.length} records).`);
    }
  } catch (err: any) {
    console.warn('[Gemini News Service] Error seeding historical news pool:', err.message);
  }
}

/**
 * Builds the 4 official champions headlines (plus 4-in-1 combined headline)
 * for Gameweek Confirmed / Final status:
 * 1. Combined 4 Champions Headline (Hasil resmi yang sudah ditetapkan)
 * 2. Juara Gameweek Resmi
 * 3. Juara 1 Liga Resmi
 * 4. Juara 2 Liga Resmi (Runner-Up)
 * 5. Juara Terbanyak Mingguan Resmi (dengan klausul pelimpahan hak)
 */
export function buildOfficialChampionsStories(payload: RawMatchdayPayload): NewsTickerStory[] {
  const gw = payload.gameweek || 1;
  const cs = payload.championshipStatus;
  if (!cs) return [];

  const r1 = cs.rank1;
  const r2 = cs.rank2;
  const mg = cs.mostGwLeader;
  const gwc = cs.gwChampionLeader;
  const gap = cs.titleRaceGapPts;

  const rival = r2?.team ? ` [T:${r2.team}]` : ' pesaing terdekatnya';
  const gapText = gap > 0 ? `, unggul [N:${gap}] poin atas${rival}` : '';
  const gapTextEn = gap > 0 ? `, leading by [N:${gap}] points over${rival}` : '';

  const leader = r1?.team ? ` [T:${r1.team}]` : ' posisi puncak';
  const r2GapText = gap > 0 ? `, terpaut [N:${gap}] poin dari${leader}` : '';
  const r2GapTextEn = gap > 0 ? `, trailing${leader} by [N:${gap}] points` : '';

  const chipFormatted = gwc?.chip ? formatChipName(gwc.chip) : '';
  const chipText = chipFormatted ? ` yang menggunakan [N:${chipFormatted}]` : '';
  const chipTextEn = chipFormatted ? ` using [N:${chipFormatted}]` : '';

  const topPlayerText = gwc?.topPlayer
    ? `, ditopang [P:${gwc.topPlayer.name}] yang menyumbang [N:${gwc.topPlayer.rawPts}] poin`
    : '';
  const topPlayerTextEn = gwc?.topPlayer
    ? `, led by [P:${gwc.topPlayer.name}] who contributed [N:${gwc.topPlayer.rawPts}] points`
    : '';

  const passDownTextId = mg?.isPassedDown && mg.originalLeaderTeam
    ? ` melalui klausul pelimpahan hak resmi dari [T:${mg.originalLeaderTeam}]`
    : '';
  const passDownTextEn = mg?.isPassedDown && mg.originalLeaderTeam
    ? ` via official pass-down rule from [T:${mg.originalLeaderTeam}]`
    : '';

  const stories: NewsTickerStory[] = [];

  // 1. Ringkasan Gabungan 4 Tim Juara Resmi
  if (r1?.team && r2?.team && mg?.team && gwc?.team) {
    stories.push(toNewsTickerStory({
      id: `confirmed_4champions_gw${gw}`,
      headline_id: `4 Tim Juara Resmi FNB League Gameweek [N:${gw}] (hasil resmi yang sudah ditetapkan): Juara Gameweek [T:${gwc.team}] ([N:${gwc.gwPts}] poin), Juara 1 [T:${r1.team}] ([N:${r1.totalPts}] poin), Juara 2 [T:${r2.team}] ([N:${r2.totalPts}] poin), dan Juara Terbanyak Mingguan [T:${mg.team}] ([N:${mg.winCount}] gelar).`,
      headline_en: `4 Official Champions of FNB League Gameweek [N:${gw}] (officially confirmed results): Gameweek Champion [T:${gwc.team}] ([N:${gwc.gwPts}] pts), 1st Place [T:${r1.team}] ([N:${r1.totalPts}] pts), 2nd Place [T:${r2.team}] ([N:${r2.totalPts}] pts), and Most Gameweek Champion [T:${mg.team}] ([N:${mg.winCount}] titles).`,
      drama_score: 100,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    }, gw));
  }

  // 2. Juara Gameweek Resmi
  if (gwc?.team && gwc.gwPts > 0) {
    stories.push(toNewsTickerStory({
      id: `confirmed_gwc_gw${gw}`,
      headline_id: `[T:${gwc.team}]${chipText} resmi dinobatkan sebagai Juara Gameweek [N:${gw}] FNB League dengan raihan resmi [N:${gwc.gwPts}] poin${topPlayerText} (hasil resmi yang sudah ditetapkan).`,
      headline_en: `[T:${gwc.team}]${chipTextEn} is officially crowned FNB League Gameweek [N:${gw}] Champion with [N:${gwc.gwPts}] confirmed points${topPlayerTextEn} (officially confirmed result).`,
      drama_score: 99,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    }, gw));
  }

  // 3. Juara 1 Liga Resmi
  if (r1?.team) {
    stories.push(toNewsTickerStory({
      id: `confirmed_r1_gw${gw}`,
      headline_id: `[T:${r1.team}] resmi mengunci posisi Juara 1 klasemen resmi FNB League Gameweek [N:${gw}] dengan total resmi [N:${r1.totalPts}] poin${gapText} (hasil resmi yang sudah ditetapkan).`,
      headline_en: `[T:${r1.team}] officially secures 1st Place Champion on the official FNB League table for Gameweek [N:${gw}] with [N:${r1.totalPts}] confirmed points${gapTextEn} (officially confirmed result).`,
      drama_score: 98,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    }, gw));
  }

  // 4. Juara 2 Liga Resmi (Runner-Up)
  if (r2?.team) {
    stories.push(toNewsTickerStory({
      id: `confirmed_r2_gw${gw}`,
      headline_id: `[T:${r2.team}] resmi mengamankan posisi Juara 2 (Runner-Up) klasemen resmi FNB League Gameweek [N:${gw}] dengan total resmi [N:${r2.totalPts}] poin${r2GapText} (hasil resmi yang sudah ditetapkan).`,
      headline_en: `[T:${r2.team}] officially secures 2nd Place (Runner-Up) Champion on the official FNB League table for Gameweek [N:${gw}] with [N:${r2.totalPts}] confirmed points${r2GapTextEn} (officially confirmed result).`,
      drama_score: 97,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    }, gw));
  }

  // 5. Juara Terbanyak Mingguan Resmi
  if (mg?.team) {
    stories.push(toNewsTickerStory({
      id: `confirmed_mg_gw${gw}`,
      headline_id: `[T:${mg.team}] resmi memegang gelar Juara Terbanyak Mingguan FNB League hingga Gameweek [N:${gw}] dengan [N:${mg.winCount}] kemenangan${passDownTextId} (hasil resmi yang sudah ditetapkan).`,
      headline_en: `[T:${mg.team}] officially holds the Most Gameweek Champion title of FNB League through Gameweek [N:${gw}] with [N:${mg.winCount}] wins${passDownTextEn} (officially confirmed result).`,
      drama_score: 96,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
    }, gw));
  }

  return stories;
}

/**
 * Generates resilient, strictly factual fallback headlines honoring status rules:
 * - 'Not started': NEVER mentions points or rank (only upcoming matches, chips active, transfer trends)
 * - 'Confirmed': Mentions points and rank as official confirmed results ('klasemen resmi', 'peringkat resmi', 'poin resmi', 'hasil resmi')
 * - 'Live' / 'Provisional': Mentions points and rank as temporary / provisional results ('klasemen sementara', 'peringkat sementara', 'poin sementara', 'hasil sementara')
 */
export function buildFallbackStories(payload: RawMatchdayPayload): NewsTickerStory[] {
  const stories: NewsTickerStory[] = [];
  const gw = payload.gameweek || 1;
  const phase = payload.gameweekPhase || getGameweekPhase(gw);
  const isConfirmed = phase === 'Confirmed';
  const isNotStarted = phase === 'Not started';

  // ATURAN MUTLAK USER: Saat menyebutkan poin dan rank, deteksi status GW.
  // JANGAN PERNAH tampilkan news tersebut saat 'Not started'!
  if (isNotStarted) {
    const p1Stories = generatePhase1Stories(gw);
    for (const p1 of p1Stories) {
      stories.push({
        id: p1.id,
        headline_id: p1.headline_id,
        headline_en: p1.headline_en,
        drama_score: p1.drama_score,
        kategori: p1.kategori,
        sub_kategori: p1.sub_kategori,
        waktu_tayang: p1.waktu_tayang,
        sumber: 'Bukan',
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
      });
    }

    const completeStories = stories.map((s) => toNewsTickerStory(s, gw));
    return interleaveStoriesByContext(completeStories);
  }

  // STATUS 'Confirmed': WAJIB tampilkan 4 tim juara resmi di news ticker
  if (isConfirmed) {
    const officialChamps = buildOfficialChampionsStories(payload);
    stories.push(...officialChamps);
  } else {
    // STATUS 'Live' / 'Provisional' (Hasil Sementara)
    // 1. Rank 1 leader (Sementara)
    if (payload.championshipStatus?.rank1) {
      const r1 = payload.championshipStatus.rank1;
      const r2 = payload.championshipStatus.rank2;
      const gap = payload.championshipStatus.titleRaceGapPts;
      const rival = r2?.team ? ` [T:${r2.team}]` : ' pesaing terdekatnya';
      const gapText = gap > 0 ? `, unggul [N:${gap}] poin atas${rival}` : '';
      const gapTextEn = gap > 0 ? `, leading by [N:${gap}] points over${rival}` : '';

      stories.push({
        id: `fb_r1_gw${gw}`,
        headline_id: `[T:${r1.team}] menempati peringkat [N:1] klasemen sementara FNB League hingga GW [N:${gw}] saat ini dengan total sementara [N:${r1.totalPts}] poin${gapText} (hasil sementara).`,
        headline_en: `[T:${r1.team}] holds provisional rank [N:1] on the FNB League table through GW [N:${gw}] with [N:${r1.totalPts}] temporary points${gapTextEn}.`,
        drama_score: 92,
      });
    }

    // 2. Rank 2 runner-up (Sementara)
    if (payload.championshipStatus?.rank2) {
      const r1 = payload.championshipStatus.rank1;
      const r2 = payload.championshipStatus.rank2;
      const gap = payload.championshipStatus.titleRaceGapPts;
      const leader = r1?.team ? ` [T:${r1.team}]` : ' posisi puncak';
      const gapText = gap > 0 ? `, terpaut [N:${gap}] poin dari${leader}` : '';
      const gapTextEn = gap > 0 ? `, trailing${leader} by [N:${gap}] points` : '';

      stories.push({
        id: `fb_r2_gw${gw}`,
        headline_id: `[T:${r2.team}] menempati peringkat [N:2] klasemen sementara FNB League hingga GW [N:${gw}] saat ini dengan raihan sementara [N:${r2.totalPts}] poin${gapText} (hasil sementara).`,
        headline_en: `[T:${r2.team}] holds provisional rank [N:2] on the FNB League table through GW [N:${gw}] with [N:${r2.totalPts}] temporary points${gapTextEn}.`,
        drama_score: 85,
      });
    }

    // 3. Most GW Champion (Sementara)
    if (payload.championshipStatus?.mostGwLeader) {
      const mg = payload.championshipStatus.mostGwLeader;
      const idText = mg.isPassedDown && mg.originalLeaderTeam
        ? `[T:${mg.team}] memegang status Juara Terbanyak FNB League ([N:${mg.winCount}] gelar) melalui klausul pelimpahan resmi, karena [T:${mg.originalLeaderTeam}] berada di posisi dua teratas klasemen.`
        : `[T:${mg.team}] memimpin perburuan Juara Terbanyak FNB League dengan koleksi [N:${mg.winCount}] kemenangan mingguan hingga GW [N:${gw}].`;
      const enText = mg.isPassedDown && mg.originalLeaderTeam
        ? `[T:${mg.team}] holds the FNB League Most GW Champions spot ([N:${mg.winCount}] titles) via the official pass-down rule, as [T:${mg.originalLeaderTeam}] occupies the top two overall standings.`
        : `[T:${mg.team}] leads the Most GW Champions race in FNB League with [N:${mg.winCount}] weekly titles through GW [N:${gw}].`;

      stories.push({
        id: `fb_mg_gw${gw}`,
        headline_id: idText,
        headline_en: enText,
        drama_score: 88,
      });
    }

    // 4. GW Champion (Sementara)
    if (payload.championshipStatus?.gwChampionLeader && payload.championshipStatus.gwChampionLeader.gwPts > 0) {
      const gwc = payload.championshipStatus.gwChampionLeader;
      const chipFormatted = gwc.chip ? formatChipName(gwc.chip) : '';
      const chipText = chipFormatted ? ` yang menggunakan [N:${chipFormatted}]` : '';
      const chipTextEn = chipFormatted ? ` using [N:${chipFormatted}]` : '';

      const topPlayerText = gwc.topPlayer
        ? `, ditopang [P:${gwc.topPlayer.name}] yang menyumbang [N:${gwc.topPlayer.rawPts}] poin.`
        : '.';
      const topPlayerTextEn = gwc.topPlayer
        ? `, led by [P:${gwc.topPlayer.name}] who contributed [N:${gwc.topPlayer.rawPts}] points.`
        : '.';

      stories.push({
        id: `fb_gwc_gw${gw}`,
        headline_id: `[T:${gwc.team}]${chipText} memimpin perolehan poin sementara Juara Gameweek [N:${gw}] FNB League dengan raihan sementara [N:${gwc.gwPts}] poin${topPlayerText} (hasil sementara).`,
        headline_en: `[T:${gwc.team}]${chipTextEn} leads the provisional Gameweek [N:${gw}] Champion race with [N:${gwc.gwPts}] temporary points${topPlayerTextEn}`,
        drama_score: 95,
      });
    }
  }

  // 5. Top player of the week
  if (payload.activePlayersTable && payload.activePlayersTable.length > 0 && payload.activePlayersTable[0].gwPts > 0) {
    const topPlayer = payload.activePlayersTable[0];
    const ptsLabel = isConfirmed ? 'poin resmi' : 'poin sementara';
    const ptsLabelEn = isConfirmed ? 'confirmed points' : 'provisional points';
    stories.push({
      id: `fb_player_gw${gw}`,
      headline_id: `[P:${topPlayer.name}] ([C:${topPlayer.club}]) mengumpulkan [N:${topPlayer.gwPts}] ${ptsLabel} di Gameweek [N:${gw}].`,
      headline_en: `[P:${topPlayer.name}] ([C:${topPlayer.club}]) collected [N:${topPlayer.gwPts}] ${ptsLabelEn} in Gameweek [N:${gw}].`,
      drama_score: 80,
    });
  }

  // 5b. Upcoming match highlight if matches are upcoming
  const upcomingMatches = payload.matchesOverview?.upcomingMatches || [];
  if (upcomingMatches.length > 0) {
    const nextMatch = upcomingMatches[0];
    stories.push({
      id: `fb_upcoming_gw${gw}`,
      headline_id: `Jadwal Gameweek [N:${gw}]: [T:${nextMatch.homeTeam}] melawan [T:${nextMatch.awayTeam}].`,
      headline_en: `Gameweek [N:${gw}] fixture: [T:${nextMatch.homeTeam}] vs [T:${nextMatch.awayTeam}].`,
      drama_score: 87,
    });
  }

  // 6. Bench points lost
  const benchRegret = payload.standingsTable?.find((t) => t.benchPts >= 8);
  if (benchRegret) {
    const topBenchPlayer = benchRegret.bench?.[0];
    const playerTxt = topBenchPlayer ? `[P:${topBenchPlayer.name}] ([C:${topBenchPlayer.club}])` : 'pemain cadangan';
    stories.push({
      id: `fb_bench_gw${gw}`,
      headline_id: `[T:${benchRegret.team}] memiliki [N:${benchRegret.benchPts}] poin di bangku cadangan dari ${playerTxt}.`,
      headline_en: `[T:${benchRegret.team}] has [N:${benchRegret.benchPts}] points on the bench from ${playerTxt}.`,
      drama_score: 86,
    });
  }

  // 7. Hit penalty
  const hitTeam = payload.standingsTable?.find((t) => t.hitPenalty <= -8);
  if (hitTeam) {
    stories.push({
      id: `fb_hit_gw${gw}`,
      headline_id: `[T:${hitTeam.team}] memiliki penalti transfer [N:${hitTeam.hitPenalty} Poin].`,
      headline_en: `[T:${hitTeam.team}] has a transfer penalty of [N:${hitTeam.hitPenalty} Pts].`,
      drama_score: 78,
    });
  }

  // When no live matches are active
  const isNoLiveMatch = !payload.matchesOverview || payload.matchesOverview.liveCount === 0;
  if (isNoLiveMatch) {
    const statusWord = isConfirmed ? 'klasemen resmi (hasil resmi)' : 'klasemen sementara';
    const statusWordEn = isConfirmed ? 'official standings' : 'provisional standings';

    // Rank climbers
    const climbers = payload.standingsHistoricalContext?.topRankClimbers || [];
    for (const c of climbers) {
      if (c.climbSteps >= 4 && !stories.some((s) => s.headline_id.includes(`[T:${c.team}]`))) {
        stories.push({
          id: `fb_climb_${c.team}_gw${gw}`,
          headline_id: `[T:${c.team}] naik [N:+${c.climbSteps} Peringkat] ke posisi [N:${c.toRank}] ${statusWord}.`,
          headline_en: `[T:${c.team}] moved up [N:+${c.climbSteps} Places] to rank [N:${c.toRank}] in ${statusWordEn}.`,
          drama_score: 85,
        });
      }
    }

    // Rank fallers
    const fallers = payload.standingsHistoricalContext?.topRankFallers || [];
    for (const f of fallers) {
      if (f.fallSteps >= 4 && !stories.some((s) => s.headline_id.includes(`[T:${f.team}]`))) {
        stories.push({
          id: `fb_fall_${f.team}_gw${gw}`,
          headline_id: `[T:${f.team}] turun [N:-${f.fallSteps} Peringkat] ke posisi [N:${f.toRank}] ${statusWord}.`,
          headline_en: `[T:${f.team}] moved down [N:-${f.fallSteps} Places] to rank [N:${f.toRank}] in ${statusWordEn}.`,
          drama_score: 86,
        });
      }
    }

    // Active chips
    for (const ch of payload.chipsActive || []) {
      if (!stories.some((s) => s.headline_id.includes(`[T:${ch.team}]`))) {
        stories.push({
          id: `fb_chip_${ch.team}_gw${gw}`,
          headline_id: `[T:${ch.team}] mengaktifkan [N:${ch.chip}].`,
          headline_en: `[T:${ch.team}] played [N:${ch.chip}].`,
          drama_score: 82,
        });
      }
    }
  }

  if (stories.length < 3) {
    const progressWord = isConfirmed ? 'telah disahkan secara resmi' : 'sedang berlangsung (hasil sementara)';
    const progressWordEn = isConfirmed ? 'has concluded with officially confirmed results' : 'is currently underway (provisional results)';
    stories.push({
      id: `fb_status_gw${gw}`,
      headline_id: `Gameweek [N:${gw}] FPL Nusantara BERHADIAH ${progressWord}.`,
      headline_en: `Gameweek [N:${gw}] of FPL Nusantara BERHADIAH ${progressWordEn}.`,
      drama_score: 75,
    });
  }

  const completeStories = stories.map((s) => toNewsTickerStory(s, gw));
  return interleaveStoriesByContext(completeStories);
}

/**
 * Ensures news ticker is updated in the background without blocking the caller
 */
export function triggerBackgroundNewsUpdate(force = false): void {
  generateNewsTickerFeed(force).catch((err) => {
    console.warn('[Gemini News Service] Background news update error:', err.message);
  });
}

/**
 * Returns current news ticker feed from memory (sub-1ms)
 */
export function getCachedNewsFeed(): NewsTickerFeedResponse | null {
  return memoryFeedCache;
}

/**
 * Clears news ticker memory cache and persisted files
 */
export function clearNewsMemoryCache(): void {
  memoryFeedCache = null;
  lastProcessedDataHash = '';
  if (fs.existsSync(FEED_CACHE_PATH)) {
    try {
      fs.unlinkSync(FEED_CACHE_PATH);
    } catch {}
  }
  if (fs.existsSync(HISTORY_CACHE_PATH)) {
    try {
      fs.unlinkSync(HISTORY_CACHE_PATH);
    } catch {}
  }
  console.log('[Gemini News Service] Cleared news ticker cache and history.');
}

/**
 * Initializes the news ticker service: guarantees 1000 items in history and feed on startup
 */
export function initNewsTicker(): void {
  try {
    seedHistoricalNewsPool(false);
    if (fs.existsSync(FEED_CACHE_PATH)) {
      const raw = fs.readFileSync(FEED_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length >= 900) {
        memoryFeedCache = parsed;
        console.log(`[Gemini News Service] Pre-warmed news feed cache with ${parsed.data.length} stories.`);
        rebuildNewsTickerTable();
        return;
      }
    }
    // If not on disk, generate now
    generateNewsTickerFeed(true).catch((e) => {
      console.warn('[Gemini News Service] Initial feed generation warning:', e.message);
    });
  } catch (err: any) {
    console.warn('[Gemini News Service] Init error:', err.message);
  }
}
