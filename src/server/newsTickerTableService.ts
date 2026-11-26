import fs from 'fs';
import path from 'path';
import { generateNotStartedStories } from './notStartedStoryGenerator.ts';
import {
  generateStoriesFromPulseMatch,
  generateLiveMatchStatStories,
  generateLiveTeamRankShiftStories,
  generateLiveMatchScoreStories,
  generateLiveLineupSurpriseStories,
  generateLiveTitleRaceStories,
  extractPulseClockContext,
  buildMatchKey,
} from './liveMatchStoryGenerator.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import { generateConfirmedStories } from './confirmedStoryGenerator.ts';
import { generateBetweenMatchStories } from './betweenMatchStoryGenerator.ts';
import { generateProvisionalStories } from './provisionalStoryGenerator.ts';
import { getNewsTemplates } from '../data/newsTemplates.ts';
import { getFplDatabase } from './db.ts';
import { checkLiveBetweenMatchPhase, isMatchCardRunning, isMatchCardFinished } from './liveBetweenMatchChecker.ts';
import { loadPulseMatchesForGw } from './pulseMatchSync.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import {
  resolveParentTemplateId,
  classifyLiveMatchNewsroomTier,
  getEffectiveLmLineupSurprisePts,
  CycleMeta,
  LM_FALLBACK_NS_TEMPLATE_IDS,
} from './waveCycleScheduler.ts';
import {
  MatchPeriod,
  DEFAULT_HALF_TIME_SECS,
  MIN_HALF_TIME_SECS,
  MAX_HALF_TIME_SECS,
  resolveCardPeriodAndClockSecs,
  computeContinuousMatchSecs,
  computeMatchElapsedSecs,
  resolveStoryPeriodAndClock,
  periodSortRank,
} from '../utils/matchClock.ts';
import type { MatchCardItem } from '../types.ts';

export { checkLiveBetweenMatchPhase, ensureLiveMatchesAndCheckPhase } from './liveBetweenMatchChecker.ts';

export interface NewsTickerDbRow {
  id: string;
  timestamp_produksi: string; // ISO string
  sumber: 'Sys' | string;
  status_tayang: 'Y' | 'N';
  keterangan_tidak_tayang: string; // empty string if status_tayang === 'Y'
  fase: string; // 'Not started' | 'Live Match' | 'Between Match' | 'Provisional' | 'Confirmed'
  waktu_tayang: string[]; // e.g. [fase]
  kategori: string;
  sub_kategori: string;
  drama_score: number;
  poin_tayang: number;
  text_berita: string; // Indonesian headline with entity tags
  text_berita_en: string; // English headline with entity tags
  gw: number;
  teams: string[];
  players: string[];
  cycle_meta?: CycleMeta;
}

const TABLE_FILE_PATH = path.join(process.cwd(), 'src/data/news_ticker_table.json');

// In-memory cache of the database table for instant sub-millisecond retrieval
let memoryTableCache: NewsTickerDbRow[] | null = null;
let lastBuiltGw: number | null = null;
let lastBuiltPhase: string | null = null;
let lastBuiltAt = 0;

// Server-side cooldown registry to prevent multi-tab / multi-device duplicate +1 increments within the same cycle
const lastIncrementByRowKey = new Map<string, number>();

interface HtTimingTracker {
  firstHalfEndSecs: number;
  htStartMs: number;
  htEndMs: number;
}
const htTimingByMatchKey = new Map<string, HtTimingTracker>();

export function clearNewsTickerMemoryCache(): void {
  memoryTableCache = null;
  lastBuiltGw = null;
  lastBuiltPhase = null;
  lastBuiltAt = 0;
}

/**
 * Menghapus semua baris news di container (memori + file news_ticker_table.json).
 * Dipanggil saat terdeteksi Action A, perubahan GW, perubahan fase, atau reset container.
 */
export function clearNewsTickerTable(): void {
  clearNewsTickerMemoryCache();
  lastIncrementByRowKey.clear();
  htTimingByMatchKey.clear();
  try {
    const dir = path.dirname(TABLE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TABLE_FILE_PATH, '[]', 'utf-8');
  } catch (err: any) {
    console.warn('[News Table Service] Warning clearing container news table:', err?.message || err);
  }
}

export function getNewsTickerLastBuiltAt(): number {
  return lastBuiltAt;
}

export function getNewsTickerBuiltState(): {
  gw: number | null;
  phase: string | null;
  builtAt: number;
} {
  return {
    gw: lastBuiltGw,
    phase: lastBuiltPhase,
    builtAt: lastBuiltAt,
  };
}

// Short-lived cache of Editor template IDs from AdminNewsTemplateEditor (src/data/newsTemplates.ts)
let cachedEditorIds: { ids: Set<string>; loadedAt: number } | null = null;

function getEditorTemplateIdSet(): Set<string> {
  const now = Date.now();
  if (cachedEditorIds && now - cachedEditorIds.loadedAt < 2000) {
    return cachedEditorIds.ids;
  }
  const templates = getNewsTemplates();
  const ids = new Set(
    templates
      .map((t) => String(t.id || '').trim())
      .filter(Boolean)
  );
  cachedEditorIds = { ids, loadedAt: now };
  return ids;
}

export function invalidateEditorTemplateIdCache(): void {
  cachedEditorIds = null;
}

/**
 * Returns true ONLY if the story ID matches a template registered in the Editor table
 * (either exact match `tmpl.id` or multi-news variant `${tmpl.id}_...`).
 */
export function isEditorTemplateId(rawId: string): boolean {
  const baseId = String(rawId || '').split('__')[0].trim();
  if (!baseId) return false;
  const editorIds = getEditorTemplateIdSet();
  if (editorIds.has(baseId)) return true;
  for (const tmplId of editorIds) {
    if (baseId.startsWith(`${tmplId}_`)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts tagged entity values from text (e.g. [T:Team], [P:Player])
 */
function extractTags(text: string, tagType: 'T' | 'P' | 'C' | 'N'): string[] {
  const regex = new RegExp(`\\[${tagType}:([^\\]]+)\\]`, 'g');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const val = m[1].trim();
    if (!matches.includes(val)) {
      matches.push(val);
    }
  }
  return matches;
}

/**
 * Determines Category, Sub-Category, and valid Airing Phases based on news text and ID
 */
export function classifyNewsItem(
  headlineId: string,
  headlineEn: string,
  id: string
): {
  kategori: string;
  sub_kategori: string;
  waktu_tayang: string[];
} {
  const t = `${headlineId} ${headlineEn} ${id}`.toLowerCase();

  // 1. AKTIVITAS BURSA TRANSFER (Player Transfers IN & OUT)
  if (
    id.startsWith('tr_') ||
    t.includes('mentransfer masuk') ||
    t.includes('mentransfer') ||
    t.includes('transfer masuk') ||
    t.includes('transfer keluar') ||
    t.includes('transferred in') ||
    t.includes('transferred out') ||
    (t.includes('menggantikan [p:') && t.includes('mentransfer'))
  ) {
    return {
      kategori: 'Chips & Transfer',
      sub_kategori: 'Transfer Pemain',
      waktu_tayang: ['Not started'],
    };
  }

  // 2. JADWAL & PERTANDINGAN MENDATANG (Upcoming Match Fixtures)
  if (
    id.startsWith('fb_upcoming_') ||
    t.includes('melawan [t:') ||
    t.includes('menjamu [t:') ||
    t.includes('bertandang ke') ||
    t.includes('upcoming match')
  ) {
    return {
      kategori: 'Pemain & Match',
      sub_kategori: 'Laga Mendatang',
      waktu_tayang: ['Not started', 'Between Match'],
    };
  }

  // 3. PERTANDINGAN LANGSUNG & EVENT PULSE MATCH (Live Match Score, Period Control & Match Events)
  if (
    id.startsWith('live_score_') ||
    id.startsWith('pulse_') ||
    id.startsWith('LM_') ||
    id.startsWith('lm_') ||
    t.includes('peluit panjang') ||
    t.includes('peluit akhir') ||
    t.includes('full time') ||
    t.includes('half time') ||
    t.includes('sedang berlangsung') ||
    t.includes('babak pertama') ||
    t.includes('babak kedua') ||
    t.includes('(menit') ||
    t.includes('menit ke-')
  ) {
    const isPeriodControl =
      id.includes('_pe_') ||
      id.includes('_ps_') ||
      t.includes('peluit') ||
      t.includes('full time') ||
      t.includes('half time');
    return {
      kategori: isPeriodControl ? 'Period Control' : 'Pemain & Match',
      sub_kategori: isPeriodControl ? 'Period End' : 'Skor Laga',
      waktu_tayang: ['Live Match'],
    };
  }

  // 4. GELAR & JUARA & KLASEMEN
  if (
    t.includes('4 pilar juara') ||
    t.includes('4 juara resmi') ||
    t.includes('4 tim juara') ||
    id.startsWith('four_champs') ||
    id.startsWith('fb_4champs')
  ) {
    return {
      kategori: 'Gelar & Juara',
      sub_kategori: '4 Juara Resmi',
      waktu_tayang: ['Confirmed'],
    };
  }

  if (
    t.includes('juara gameweek') ||
    t.includes('juara pekan') ||
    t.includes('gameweek champion') ||
    t.includes('poin tertinggi gameweek') ||
    id.startsWith('champ_gw') ||
    id.startsWith('fb_champ_')
  ) {
    return {
      kategori: 'Gelar & Juara',
      sub_kategori: 'Juara Gameweek',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('juara terbanyak') ||
    t.includes('most gw') ||
    t.includes('klausul pelimpahan') ||
    id.startsWith('fb_mg_')
  ) {
    return {
      kategori: 'Gelar & Juara',
      sub_kategori: 'Juara Terbanyak',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    id.startsWith('fb_r1_') ||
    t.includes('mempertahankan posisi puncak') ||
    t.includes('peringkat [n:1]') ||
    t.includes('posisi puncak klasemen') ||
    t.includes('posisi puncak') ||
    t.includes('kudeta') ||
    t.includes('rank [n:1]') ||
    t.includes('summit')
  ) {
    return {
      kategori: 'Klasemen & Peringkat',
      sub_kategori: t.includes('kudeta') ? 'Kudeta Puncak' : 'Puncak Klasemen',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    id.startsWith('fb_r2_') ||
    t.includes('peringkat [n:2]') ||
    t.includes('peringkat 2') ||
    t.includes('posisi kedua') ||
    t.includes('runner-up') ||
    t.includes('rank [n:2]')
  ) {
    return {
      kategori: 'Gelar & Juara',
      sub_kategori: 'Runner-Up Klasemen',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('peringkat 3') ||
    t.includes('peringkat [n:3]') ||
    t.includes('3 besar') ||
    t.includes('top 3')
  ) {
    return {
      kategori: 'Klasemen & Peringkat',
      sub_kategori: 'Persaingan 3 Besar',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  // 5. WHAT-IF & KEPUTUSAN TIM (Bench, Captaincy, Transfer Karma, Lost Points)
  if (
    id.startsWith('fb_bench_') ||
    id.startsWith('what_if_bench_') ||
    t.includes('bangku cadangan') ||
    t.includes('mencadangkan') ||
    t.includes('cadangan') ||
    t.includes('benching') ||
    t.includes('bench')
  ) {
    return {
      kategori: 'Keputusan Tim',
      sub_kategori: 'Bangku Cadangan',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('kapten') ||
    t.includes('captain') ||
    t.includes('mengkaptenkan') ||
    t.includes('ban kapten') ||
    t.includes('wakil kapten') ||
    t.includes('vice captain') ||
    t.includes('captaining')
  ) {
    return {
      kategori: 'Keputusan Tim',
      sub_kategori: 'Pilihan Kapten',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('menjual') ||
    t.includes('karma') ||
    t.includes('merugi setelah menjual') ||
    t.includes('sold')
  ) {
    return {
      kategori: 'Keputusan Tim',
      sub_kategori: 'Sold Haulers',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('kehilangan potensi') ||
    t.includes('menyesali') ||
    t.includes('missed out') ||
    t.includes('what-if') ||
    id.startsWith('what_if_')
  ) {
    return {
      kategori: 'Keputusan Tim',
      sub_kategori: 'Peluang Poin Hilang',
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  // 6. PERGERAKAN PERINGKAT KLASEMEN (Top Climbers & Fallers)
  if (
    t.includes('naik') ||
    t.includes('melompat') ||
    t.includes('lonjakan') ||
    t.includes('moved up') ||
    t.includes('climbs') ||
    t.includes('surge') ||
    t.includes('melesat') ||
    (id.startsWith('mover_') && (t.includes('naik') || t.includes('moved up')))
  ) {
    return {
      kategori: 'Klasemen & Peringkat',
      sub_kategori: 'Lonjakan Peringkat',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('turun') ||
    t.includes('terjun') ||
    t.includes('penurunan') ||
    t.includes('moved down') ||
    t.includes('plummets') ||
    t.includes('merosot') ||
    id.startsWith('fb_fall_') ||
    (id.startsWith('mover_') && (t.includes('turun') || t.includes('moved down')))
  ) {
    return {
      kategori: 'Klasemen & Peringkat',
      sub_kategori: 'Penurunan Peringkat',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    id.startsWith('team_shift_') ||
    t.includes('peringkat sementara') ||
    t.includes('places to rank')
  ) {
    return {
      kategori: 'Klasemen & Peringkat',
      sub_kategori: 'Pergeseran Klasemen',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  // 7. CHIPS & TRANSFER HITS
  if (
    id.startsWith('chip_') ||
    id.startsWith('fb_chip_') ||
    t.includes('wildcard') ||
    t.includes('free hit') ||
    t.includes('triple captain') ||
    t.includes('bench boost') ||
    t.includes('chip') ||
    t.includes('penalti') ||
    t.includes('minus hit') ||
    t.includes('deduction')
  ) {
    let sub = 'Strategi Chip';
    if (t.includes('wildcard')) sub = 'Wildcard';
    else if (t.includes('free hit')) sub = 'Free Hit';
    else if (t.includes('triple captain')) sub = 'Triple Captain';
    else if (t.includes('bench boost')) sub = 'Bench Boost';
    else if (t.includes('penalti') || t.includes('hit') || t.includes('deduction')) sub = 'Penalti Minus Hit';

    return {
      kategori: 'Chips & Transfer',
      sub_kategori: sub,
      waktu_tayang: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  // 8. SOROTAN BINTANG & PEMAIN KUNCI
  if (
    t.includes('clean sheet') ||
    t.includes('nirbobol') ||
    t.includes('penyelamatan') ||
    t.includes('saves') ||
    t.includes('tepis penalti') ||
    t.includes('pemain kunci') ||
    t.includes('performa gemilang') ||
    t.includes('outstanding') ||
    t.includes('poin pekan') ||
    t.includes('solid') ||
    t.includes('mengamankan') ||
    t.includes('sumbangan [n:') ||
    t.includes('menyumbang [n:')
  ) {
    let sub = 'Top Performer';
    if (t.includes('clean sheet') || t.includes('nirbobol')) sub = 'Clean Sheet';
    else if (t.includes('penyelamatan') || t.includes('saves') || t.includes('tepis penalti')) sub = 'Penyelamatan Kiper';

    return {
      kategori: 'Pemain & Match',
      sub_kategori: sub,
      waktu_tayang: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    };
  }

  // 9. STRATEGI PRA-PEKAN
  if (
    t.includes('deadline') ||
    t.includes('batas waktu') ||
    t.includes('pra-pekan') ||
    t.includes('upcoming deadline')
  ) {
    return {
      kategori: 'Chips & Transfer',
      sub_kategori: 'Transfer Pemain',
      waktu_tayang: ['Not started'],
    };
  }

  // Default Fallback
  return {
    kategori: 'Klasemen & Peringkat',
    sub_kategori: 'Pergeseran Klasemen',
    waktu_tayang: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
  };
}

export function getCurrentGw(): number {
  const db = getFplDatabase();
  return Number(db?.meta?.current_gw) || 0;
}

export type GameweekPhase = 'Not started' | 'Live Match' | 'Between Match' | 'Live' | 'Provisional' | 'Confirmed';

/**
 * Returns the deterministic News Ticker phase based on RULE[AGENTS_md] strictly from db.ts
 * and the dedicated Live Match (LM) vs Between Match (BM) running-match checker.
 * NOTE: Never alters application GW status (db.meta.gw_status).
 */
export function getGameweekPhase(
  targetGw?: number,
  options?: { matchesOverride?: MatchCardItem[] | null; dbOverride?: any }
): GameweekPhase {
  try {
    const db = options?.dbOverride || getFplDatabase();
    const currentGw = Number(db?.meta?.current_gw) || 0;
    const gw = targetGw || currentGw;
    if (!currentGw || !gw) return 'Not started';

    // Past Gameweeks (gw < currentGw) are 100% final and confirmed
    if (gw < currentGw) return 'Confirmed';
    // Future Gameweeks (gw > currentGw) are not started
    if (gw > currentGw) return 'Not started';

    const statusObj = db.meta?.gw_status;
    const isDataChecked = Boolean(statusObj?.data_checked);
    const isLeaguesUpdated = statusObj?.leagues_status === 'Updated';
    const statusStr = statusObj?.status || '';

    // GW Confirmed / Final: (data_checked === true && leagues === 'Updated') OR status === 'Confirmed'
    if ((isDataChecked && isLeaguesUpdated) || statusStr === 'Confirmed') {
      return 'Confirmed';
    }

    if (statusStr === 'Not started') {
      return 'Not started';
    }

    if (statusStr === 'Provisional') {
      return 'Provisional';
    }

    // Dedicated LM vs BM checker when GW status is 'Live' (or fixtures are in progress):
    // Checks whether any match in the active GW is currently running.
    const lmBmCheck = checkLiveBetweenMatchPhase(gw, {
      matchesOverride: options?.matchesOverride,
      dbOverride: db,
    });

    if (lmBmCheck.allMatchesFinished) {
      if (isDataChecked && isLeaguesUpdated) return 'Confirmed';
      return 'Provisional';
    }

    if (lmBmCheck.allMatchesUpcoming && statusStr !== 'Live') {
      return 'Not started';
    }

    if (lmBmCheck.isGwStatusLive && lmBmCheck.resolvedTickerPhase) {
      return lmBmCheck.resolvedTickerPhase;
    }

    return 'Provisional';
  } catch {
    return 'Provisional';
  }
}

/**
 * Checks whether the text mentions points or rankings
 */
export function mentionsPointsOrRank(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();

  const hasRank =
    t.includes('peringkat') ||
    t.includes('klasemen') ||
    t.includes('juara gameweek') ||
    t.includes('juara pekan') ||
    t.includes('gameweek champion') ||
    t.includes('runner-up') ||
    t.includes('posisi [n:') ||
    t.includes('ke posisi [n:') ||
    t.includes('posisi puncak') ||
    t.includes('rank [n:') ||
    t.includes('places to rank') ||
    /\b(?:naik|turun|melompat|terjun|merosot)\s+\[n:[+-]?\d+/i.test(t);

  const hasPoints =
    t.includes('poin') ||
    t.includes('pts') ||
    t.includes('points') ||
    /\[n:\+?\d+\s*(?:poin|pts|points)?\]/i.test(t);

  return hasRank || hasPoints;
}

/**
 * Enforces status perspective on headlines mentioning points and rank:
 * - Confirmed: Must be presented as officially confirmed results ('resmi', 'hasil resmi', 'klasemen resmi', 'peringkat resmi')
 * - Live / Provisional: Must be presented as provisional / temporary results ('sementara', 'klasemen sementara', 'peringkat sementara', 'poin sementara', 'hasil sementara')
 */
export function formatPointsAndRankStatus(
  headlineId: string,
  headlineEn: string,
  phase: GameweekPhase
): { headlineId: string; headlineEn: string } {
  let id = headlineId;
  let en = headlineEn;

  if (phase === 'Confirmed') {
    // 1. Confirmed / Final: Official results
    id = id
      .replace(/\bklasemen\s+sementara\b/gi, 'klasemen resmi')
      .replace(/\bperingkat\s+sementara\b/gi, 'peringkat resmi')
      .replace(/\bpoin\s+sementara\b/gi, 'poin resmi')
      .replace(/\bhasil\s+sementara\b/gi, 'hasil resmi')
      .replace(/\bmemimpin\s+sementara\b/gi, 'resmi memimpin')
      .replace(/\bsementara\s+FNB\s+League\b/gi, 'resmi FNB League')
      .replace(/\bmemimpin\s+perolehan\s+poin\s+sementara\s+Juara\s+Gameweek\b/gi, 'resmi dinobatkan sebagai Juara Gameweek');

    en = en
      .replace(/\bprovisional\s+standings\b/gi, 'official standings')
      .replace(/\bprovisional\s+table\b/gi, 'official table')
      .replace(/\bprovisional\s+rank\b/gi, 'official rank')
      .replace(/\bprovisional\s+points\b/gi, 'officially confirmed points')
      .replace(/\btemporary\s+points\b/gi, 'officially confirmed points')
      .replace(/\bprovisional\s+result\b/gi, 'officially confirmed result')
      .replace(/\bprovisional\s+FNB\s+League\s+table\b/gi, 'official FNB League table')
      .replace(/\bleads\s+the\s+provisional\s+Gameweek\b/gi, 'is officially crowned Gameweek');
  } else if (phase === 'Live' || phase === 'Live Match' || phase === 'Between Match' || phase === 'Provisional') {
    // 2. Live / Provisional ("Selain itu"): Provisional results
    id = id
      .replace(/\bresmi\s+dinobatkan\s+sebagai\s+Juara\s+Gameweek\b/gi, 'memimpin perolehan poin sementara Juara Gameweek')
      .replace(/\bresmi\s+dinobatkan\b/gi, 'memimpin perolehan poin sementara')
      .replace(/\bresmi\s+ditetapkan\s+sebagai\s+Juara\s+Gameweek\b/gi, 'memimpin perolehan poin sementara Juara Gameweek')
      .replace(/\bresmi\s+ditetapkan\b/gi, 'ditetapkan sementara')
      .replace(/\bsecara\s+resmi\b/gi, 'sementara')
      .replace(/\bklasemen\s+resmi\b/gi, 'klasemen sementara')
      .replace(/\bperingkat\s+resmi\b/gi, 'peringkat sementara')
      .replace(/\bpoin\s+resmi\b/gi, 'poin sementara')
      .replace(/\bhasil\s+resmi\s+yang\s+sudah\s+ditetapkan\b/gi, 'hasil sementara')
      .replace(/\bhasil\s+resmi\b/gi, 'hasil sementara')
      .replace(/\bresmi\s+mengamankan\s+peringkat\b/gi, 'mengamankan peringkat sementara')
      .replace(/\bresmi\s+menempati\s+peringkat\b/gi, 'menempati peringkat sementara');

    en = en
      .replace(/\bis\s+officially\s+crowned\s+FNB\s+League\s+Gameweek\b/gi, 'leads the provisional FNB League Gameweek')
      .replace(/\bis\s+officially\s+crowned\s+Gameweek\b/gi, 'leads the provisional Gameweek')
      .replace(/\bis\s+officially\s+crowned\b/gi, 'leads the provisional race as')
      .replace(/\bofficial\s+standings\b/gi, 'provisional standings')
      .replace(/\bofficial\s+table\b/gi, 'provisional table')
      .replace(/\bofficial\s+rank\b/gi, 'provisional rank')
      .replace(/\bofficially\s+confirmed\s+points\b/gi, 'provisional points')
      .replace(/\bofficially\s+confirmed\s+result\b/gi, 'provisional result')
      .replace(/\bofficially\s+confirmed\b/gi, 'provisional')
      .replace(/\bofficially\s+crowned\b/gi, 'provisionally leading')
      .replace(/\bofficially\s+holds\s+rank\b/gi, 'holds provisional rank')
      .replace(/\bofficially\s+secures\s+rank\b/gi, 'provisionally holds rank');

    if (id.includes('peringkat teratas klasemen') && !id.includes('peringkat teratas klasemen sementara')) {
      id = id.replace(/peringkat teratas klasemen/gi, 'peringkat teratas klasemen sementara');
    }
    if (id.includes('peringkat [N:1] klasemen') && !id.includes('peringkat [N:1] klasemen sementara')) {
      id = id.replace(/peringkat \[N:1\] klasemen/gi, 'peringkat [N:1] klasemen sementara');
    }
    if (id.includes('peringkat [N:2] klasemen') && !id.includes('peringkat [N:2] klasemen sementara')) {
      id = id.replace(/peringkat \[N:2\] klasemen/gi, 'peringkat [N:2] klasemen sementara');
    }
    if (id.includes('peringkat [N:3] klasemen') && !id.includes('peringkat [N:3] klasemen sementara')) {
      id = id.replace(/peringkat \[N:3\] klasemen/gi, 'peringkat [N:3] klasemen sementara');
    }
    if (/ke\s+peringkat\s+\[N:\d+\]\s+klasemen\./i.test(id) && !id.includes('sementara')) {
      id = id.replace(/ke\s+peringkat\s+(\[N:\d+\])\s+klasemen\./gi, 'ke peringkat $1 klasemen sementara.');
    }
  }

  return { headlineId: id, headlineEn: en };
}

export function normalizeTickerPhase(phase?: string | null): GameweekPhase {
  const p = String(phase || '').trim().toLowerCase();
  if (p === 'live' || p === 'live match') return 'Live Match';
  if (p === 'not started' || p === 'pre-deadline') return 'Not started';
  if (p === 'between match') return 'Between Match';
  if (p === 'provisional') return 'Provisional';
  if (p === 'confirmed') return 'Confirmed';
  return 'Not started';
}

/**
 * Checks whether a Pulse match JSON represents a match that is currently LIVE (in play or Half Time),
 * strictly excluding finished ('C' / FT) and upcoming ('U') matches.
 */
export function isPulseMatchCurrentlyLive(
  pulseData: any,
  cachedMatches?: MatchCardItem[] | null
): boolean {
  if (!pulseData) return false;

  const status = String(pulseData?.status || '').trim().toUpperCase();
  const phase = String(pulseData?.phase || '').trim().toUpperCase();
  const clockLabel = String(pulseData?.clock?.label || '').trim().toUpperCase();
  const clockSecs = Number(pulseData?.clock?.secs) || 0;
  const hasOutcome = typeof pulseData?.outcome === 'string' && pulseData.outcome.trim().length > 0;
  const events: any[] = Array.isArray(pulseData?.events) ? pulseData.events : [];
  const hasSecondHalfEnd = events.some(
    (e: any) =>
      e?.type === 'PE' &&
      (e?.phase === '2' || e?.phase === '2H') &&
      (Boolean(e?.clock?.secs && Number(e.clock.secs) >= 5400) || Boolean(e?.time?.millis))
  );

  const isExplicitlyLiveAndUnder90 = status === 'L' && clockSecs < 5400;
  const isFinished =
    (status === 'C' ||
      phase === 'F' ||
      phase === 'FT' ||
      hasOutcome ||
      hasSecondHalfEnd ||
      clockLabel === 'FT' ||
      clockLabel.includes('FULL')) &&
    !isExplicitlyLiveAndUnder90;

  if (isFinished) return false;
  if (status === 'U' || phase === 'U') return false;

  // Cross-check against fresh MatchCardItem state when available
  if (Array.isArray(cachedMatches) && cachedMatches.length > 0) {
    const pHomeRaw =
      pulseData?.teams?.[0]?.team?.shortName ||
      pulseData?.teams?.[0]?.team?.club?.shortName ||
      pulseData?.teams?.[0]?.team?.club?.abbr ||
      pulseData?.teams?.[0]?.team?.name ||
      '';
    const pAwayRaw =
      pulseData?.teams?.[1]?.team?.shortName ||
      pulseData?.teams?.[1]?.team?.club?.shortName ||
      pulseData?.teams?.[1]?.team?.club?.abbr ||
      pulseData?.teams?.[1]?.team?.name ||
      '';
    const pHome = resolveClubName(pHomeRaw).toLowerCase();
    const pAway = resolveClubName(pAwayRaw).toLowerCase();

    if (pHome && pAway) {
      const matchedCard = cachedMatches.find((m) => {
        const mHome = resolveClubName(m.home_team?.name || m.home_team?.short_name).toLowerCase();
        const mAway = resolveClubName(m.away_team?.name || m.away_team?.short_name).toLowerCase();
        return mHome === pHome && mAway === pAway;
      });
      if (matchedCard) {
        return isMatchCardRunning(matchedCard);
      }
    }
  }

  return Boolean(
    status === 'L' ||
      status === 'I' ||
      status === 'HT' ||
      phase === '1' ||
      phase === '1H' ||
      phase === '2' ||
      phase === '2H' ||
      phase === 'HT'
  );
}

/**
 * Checks if a phase candidate matches the currently active phase
 */
export function isPhaseActive(phaseCandidate: string, currentPhase: string): boolean {
  const pc = (phaseCandidate || '').trim().toLowerCase();
  const cp = (currentPhase || '').trim().toLowerCase();
  if (pc === cp) return true;
  if ((pc === 'live match' || pc === 'live') && (cp === 'live match' || cp === 'live')) return true;
  if ((pc === 'not started' || pc === 'pre-deadline') && (cp === 'not started' || cp === 'pre-deadline')) return true;
  return false;
}

/**
 * Converts phase name to a clean identifier slug
 */
export function phaseToSlug(phase: string): string {
  return (phase || 'all').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Creates one or more complete news story records (one distinct row per allowed phase).
 * Directly pairs metadata from editor/input with produced metadata (GW, TIMESTAMP, SOURCE).
 */
export function createStoryRecordsForPhases(
  raw: {
    id: string;
    headline_id?: string;
    headline_en?: string;
    text_berita?: string;
    text_berita_en?: string;
    headline?: string;
    drama_score?: number;
    poin_tayang?: number;
    timestamp_produksi?: string;
    timestamp?: string;
    sumber?: 'Sys' | string;
    status_tayang?: 'Y' | 'N';
    keterangan_tidak_tayang?: string;
    kategori?: string;
    sub_kategori?: string;
    fase?: string;
    waktu_tayang?: string[];
    gw?: number;
    teams?: string[];
    players?: string[];
    pulseMatchId?: number;
    clockSecs?: number;
    cycle_meta?: CycleMeta;
  },
  defaultGw = 9,
  currentActivePhase?: string
): NewsTickerDbRow[] {
  const currentActiveGw = getCurrentGw();
  const rawId = String(raw.id || '').trim();
  const baseId = rawId.split('__')[0];

  // ATURAN MUTLAK: Hanya produksi berita yang berasal dari Tabel Editor
  if (!isEditorTemplateId(baseId)) {
    return [];
  }

  let textId = String(raw.headline_id || raw.text_berita || raw.headline || '').trim();
  let textEn = String(raw.headline_en || raw.text_berita_en || textId).trim();

  // Strip unnecessary word "chip" directly preceding [N:{chip}] per FPL convention
  textId = textId.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1');
  textEn = textEn.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1').replace(/(\[N:[^\]]+\])\s+chip\b/gi, '$1');

  const resolvedSumber = 'Sys';
  const timestamp = raw.timestamp_produksi || raw.timestamp || new Date().toISOString();
  const explicitGw = Number(raw.gw) || 0;
  const gw = explicitGw > 0
    ? explicitGw
    : extractGwFromStory(textId, textEn, baseId, defaultGw);
  const resolvedActivePhase = currentActivePhase || getGameweekPhase(gw);

  const fallbackClass = classifyNewsItem(textId, textEn, baseId);
  const kategori = raw.kategori || fallbackClass.kategori;
  const sub_kategori = raw.sub_kategori || fallbackClass.sub_kategori;
  const dramaScore = Number(raw.drama_score) || 80;

  const teams = Array.isArray(raw.teams) && raw.teams.length > 0 ? raw.teams : extractTags(textId, 'T');
  const players = Array.isArray(raw.players) && raw.players.length > 0 ? raw.players : extractTags(textId, 'P');

  // Gunakan fase & waktu tayang sesuai konfigurasi template di Tabel Editor
  let phases: string[] = [];
  if (raw.fase) {
    phases = raw.fase.split(',').map((p) => p.trim()).filter(Boolean);
  }
  if (phases.length === 0 && Array.isArray(raw.waktu_tayang) && raw.waktu_tayang.length > 0) {
    phases = raw.waktu_tayang;
  }
  if (phases.length === 0) {
    phases = fallbackClass.waktu_tayang;
  }
  if (phases.length === 0) {
    phases = ['Live Match'];
  }

  // Normalize phase names
  const validPhaseNames = ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'];
  const normalizedPhases = phases.map((p) => {
    const pl = p.toLowerCase().trim();
    if (pl === 'live') return 'Live Match';
    if (pl === 'pre-deadline') return 'Not started';
    const match = validPhaseNames.find((vp) => vp.toLowerCase() === pl);
    return match || p;
  });

  const uniquePhases = Array.from(new Set(normalizedPhases));
  const activePhases = uniquePhases.filter(
    (targetPhase) => gw === currentActiveGw && isPhaseActive(targetPhase, resolvedActivePhase)
  );
  if (activePhases.length === 0) {
    return [];
  }

  const hasPointsOrRank = mentionsPointsOrRank(textId) || mentionsPointsOrRank(textEn);

  // Generate strictly for the active GW and active phase
  return activePhases.map((targetPhase) => {
    const rowId = uniquePhases.length > 1
      ? `${baseId}__${phaseToSlug(targetPhase)}`
      : baseId;

    // Apply status perspective per phase
    let phaseTextId = textId;
    let phaseTextEn = textEn;
    if (hasPointsOrRank) {
      const phaseEnum: GameweekPhase = targetPhase === 'Confirmed'
        ? 'Confirmed'
        : (targetPhase === 'Live Match' ? 'Live Match' : (targetPhase === 'Between Match' ? 'Between Match' : (targetPhase === 'Not started' ? 'Not started' : 'Provisional')));
      const formatted = formatPointsAndRankStatus(phaseTextId, phaseTextEn, phaseEnum);
      phaseTextId = formatted.headlineId;
      phaseTextEn = formatted.headlineEn;
    }

    const statusTayang: 'Y' | 'N' = raw.status_tayang || 'Y';
    const keterangan = raw.keterangan_tidak_tayang ?? (statusTayang === 'Y' ? '' : 'Tidak ditayangkan');

    const mergedCycleMeta: CycleMeta | undefined =
      raw.cycle_meta || raw.pulseMatchId !== undefined || raw.clockSecs !== undefined
        ? {
            ...(raw.cycle_meta || {}),
            ...(raw.pulseMatchId !== undefined ? { pulseMatchId: raw.pulseMatchId } : {}),
            ...(raw.clockSecs !== undefined ? { clockSecs: raw.clockSecs } : {}),
          }
        : undefined;

    return {
      id: rowId,
      timestamp_produksi: timestamp,
      sumber: resolvedSumber,
      status_tayang: statusTayang,
      keterangan_tidak_tayang: keterangan,
      fase: targetPhase,
      waktu_tayang: [targetPhase],
      kategori,
      sub_kategori,
      drama_score: dramaScore,
      poin_tayang: Math.max(0, Number(raw.poin_tayang) || 0),
      text_berita: phaseTextId,
      text_berita_en: phaseTextEn,
      gw,
      teams,
      players,
      ...(mergedCycleMeta ? { cycle_meta: mergedCycleMeta } : {}),
    };
  });
}

/**
 * Accurately extracts the Gameweek number from headline text, ID, or fallback
 */
export function extractGwFromStory(headlineId: string, headlineEn: string, id: string, defaultGw: number): number {
  const combined = `${id} ${headlineId} ${headlineEn}`;
  
  // 1. Check ID like champ_gw9_..., mover_gw8_..., fb_r1_gw9
  const idMatch = id.match(/gw(\d+)/i);
  if (idMatch) return parseInt(idMatch[1], 10);

  // 2. Check Gameweek [N:X] or GW [N:X] in text
  const tagMatch = combined.match(/(?:gameweek|gw)\s*\[n:(\d+)\]/i);
  if (tagMatch) return parseInt(tagMatch[1], 10);

  // 3. Check plain Gameweek X or GW X in text
  const plainMatch = combined.match(/(?:gameweek|gw)\s+(\d+)/i);
  if (plainMatch) return parseInt(plainMatch[1], 10);

  return defaultGw;
}

/**
 * Rebuilds and synchronizes the news ticker database table in the container
 * purely from Editor Table templates (src/data/news_templates.json).
 */
export function rebuildNewsTickerTable(
  phaseOverride?: string,
  options?: { clearExisting?: boolean; nowMs?: number; matchesOverride?: MatchCardItem[] | null }
): NewsTickerDbRow[] {
  try {
    invalidateEditorTemplateIdCache();
    const tableRows: NewsTickerDbRow[] = [];
    const seenIds = new Set<string>();

    const LEGACY_TEMPLATE_ID_MAP: Record<string, string> = {
      // Very old P1_* / PROV_* / CONF_* prefixes
      P1_MATCH_FIXTURES: 'NS_MATCH_FIXTURE_OPENING',
      P1_CHIP_WILDCARD: 'NS_CHIP_WILDCARD',
      P1_CHIP_FREEHIT: 'NS_CHIP_FREE_HIT',
      P1_CHIP_BENCH_BOOST: 'NS_CHIP_BENCH_BOOST',
      P1_CHIP_TRIPLE_CAPTAIN: 'NS_CHIP_TRIPLE_CAPTAIN',
      P1_CHIP_RECAP: 'NS_CHIP_SUMMARY_USAGE',
      P1_TRANSFER_IN: 'NS_TRANSFER_IN_MOST_BOUGHT',
      P1_TRANSFER_OUT: 'NS_TRANSFER_OUT_MOST_SOLD',
      P1_CAPTAINCY_RECAP: 'NS_CAPTAIN_POPULAR_MOST_CAPTAINED',
      P1_HITS_RECAP: 'NS_TRANSFER_HITS_MOST',
      P1_OWNERSHIP_MOST_OWNED: 'NS_PLAYER_OWNERSHIP_MOST_OWNED',
      P1_DIFFERENTIAL_XI: 'NS_LINEUP_DIFFERENTIAL_XI',
      P1_DIFFERENTIAL_CAPTAIN: 'NS_CAPTAIN_DIFFERENTIAL',
      P1_INJURY_UPDATE: 'NS_PLAYER_AVAILABILITY_FLAGGED',
      P1_TOP_RIVALRY: 'NS_STANDINGS_TITLE_RACE',
      P1_MOST_GW_RIVALRY: 'NS_STANDINGS_WEEKLY_WINS_MOST',
      LM_BOOKING_YELLOW: 'LM_MATCH_CARD_YELLOW',
      BM_MATCH_FULL_TIME: 'BM_MATCH_SCORE_RESULT',
      BM_DISCIPLINARY_RED: 'BM_MATCH_CARD_RED',
      BM_CHAMP_RIVALRY: 'BM_STANDINGS_TITLE_RACE',
      PROV_CHAMP_RIVALRY: 'PV_STANDINGS_TITLE_RACE',
      PROV_TOP_RIVALRY: 'PV_STANDINGS_TITLE_RACE',
      PROV_GW_LEADER: 'PV_STANDINGS_GAMEWEEK_LEADER',
      PROV_TOP_SCORER_GW: 'PV_PLAYER_TOP_PERFORMER',
      PROV_CAPTAIN_RECAP: 'PV_CAPTAIN_POPULAR_MOST_CAPTAINED',
      PROV_VICE_CAPTAIN: 'PV_CAPTAIN_VICE_CAPTAIN',
      PROV_AUTOSUB_PENDING: 'PV_LINEUP_AUTOSUB_PENDING',
      PROV_BENCH_POINTS: 'PV_LINEUP_BENCH_TOTAL',
      PROV_CHIP_RETURN: 'PV_CHIP_RETURN',
      PROV_HITS_EVALUATION: 'PV_TRANSFER_HITS_EVALUATION',
      PROV_CLEAN_SHEET_RECAP: 'PV_MATCH_CLEAN_SHEET',
      CONF_TABLE_SUMMIT: 'CF_STANDINGS_TITLE_RACE',
      CONF_MOST_GW_TITLES: 'CF_STANDINGS_WEEKLY_WINS_MOST',
      CONF_GW_CHAMPION: 'CF_STANDINGS_GAMEWEEK_WINNER',
      CONF_TOP_RIVALRY: 'CF_STANDINGS_TITLE_RACE',
      CONF_MOST_GW_RIVALRY: 'CF_STANDINGS_WEEKLY_WINS_MOST',
      CONF_RANK_CLIMBER: 'CF_STANDINGS_RANK_BIGGEST_RISE',
      CONF_PLAYER_OF_THE_GW: 'CF_PLAYER_TOP_PERFORMER_GW_SCORER',
      CONF_AUTOSUB_OFFICIAL: 'CF_LINEUP_AUTOSUB_CONFIRMED',
      CONF_CAPTAIN_OFFICIAL: 'CF_CAPTAIN_POPULAR_MOST_CAPTAINED',
      CONF_CHIP_OFFICIAL: 'CONF_CHIP_OFFICIAL',
      CONF_HITS_DEDUCTED: 'CF_TRANSFER_HITS_DEDUCTED',
      // Pre-alignment template IDs -> aligned Category/Subcategory/Title IDs
      NS_MATCH_FIXTURE: 'NS_MATCH_FIXTURE_OPENING',
      NS_CHIP_FREEHIT: 'NS_CHIP_FREE_HIT',
      NS_CHIP_RECAP: 'NS_CHIP_SUMMARY_USAGE',
      NS_TRANSFER_IN: 'NS_TRANSFER_IN_MOST_BOUGHT',
      NS_TRANSFER_OUT: 'NS_TRANSFER_OUT_MOST_SOLD',
      NS_CAPTAIN_RECAP: 'NS_CAPTAIN_POPULAR_MOST_CAPTAINED',
      NS_HITS_RECAP: 'NS_TRANSFER_HITS_MOST',
      NS_MOST_OWNED: 'NS_PLAYER_OWNERSHIP_MOST_OWNED',
      NS_DIFFERENTIAL_XI: 'NS_LINEUP_DIFFERENTIAL_XI',
      NS_DIFFERENTIAL_CAPTAIN: 'NS_CAPTAIN_DIFFERENTIAL',
      NS_INJURY_UPDATE: 'NS_PLAYER_AVAILABILITY_FLAGGED',
      NS_TOP_RIVALRY: 'NS_STANDINGS_TITLE_RACE',
      NS_MOST_GW_RIVALRY: 'NS_STANDINGS_WEEKLY_WINS_MOST',
      LM_PERIOD_START: 'LM_MATCH_PERIOD_START',
      LM_PERIOD_END: 'LM_MATCH_PERIOD_END',
      LM_GOAL_OPEN_PLAY: 'LM_MATCH_GOAL_OPEN_PLAY',
      LM_GOAL_PENALTY: 'LM_MATCH_PENALTY_GOAL',
      LM_OWN_GOAL: 'LM_MATCH_GOAL_OWN',
      LM_PENALTY_MISSED: 'LM_MATCH_PENALTY_MISSED',
      LM_PENALTY_SAVED: 'LM_MATCH_PENALTY_SAVED',
      LM_PENALTY_AWARDED: 'LM_MATCH_PENALTY_AWARDED',
      LM_CARD_YELLOW: 'LM_MATCH_CARD_YELLOW',
      LM_CARD_SECOND_YELLOW: 'LM_MATCH_CARD_SECOND_YELLOW',
      LM_CARD_RED_STRAIGHT: 'LM_MATCH_CARD_STRAIGHT_RED',
      LM_SUBSTITUTION: 'LM_MATCH_SUBSTITUTION',
      LM_VAR_REVIEW: 'LM_MATCH_VAR_REVIEW',
      LM_GK_SAVES: 'LM_MATCH_SAVES_GOALKEEPER',
      LM_DEFCON_BONUS: 'LM_MATCH_DEFENSIVE_CONTRIBUTION',
      LM_TEAM_RANK_SHIFT: 'LM_STANDINGS_RANK_MOVEMENT',
      LM_MATCH_SCORE: 'LM_MATCH_SCORE_LIVE',
      BM_MATCH_RESULT: 'BM_MATCH_SCORE_RESULT',
      BM_MATCH_FIXTURE: 'BM_MATCH_FIXTURE_NEXT',
      BM_GOAL_CONTRIBUTORS: 'BM_MATCH_GOAL_CONTRIBUTORS',
      BM_BONUS_POINTS_STAR: 'BM_MATCH_BONUS_POINTS',
      BM_PENALTY_SAVED: 'BM_MATCH_PENALTY_SAVED',
      BM_PENALTY_MISSED: 'BM_MATCH_PENALTY_MISSED',
      BM_CARD_RED: 'BM_MATCH_CARD_RED',
      BM_INJURY_UPDATE: 'BM_MATCH_INJURY',
      BM_CAPTAIN_RETURN: 'BM_CAPTAIN_POPULAR_RETURN',
      BM_BENCH_REGRET: 'BM_LINEUP_BENCH_POINTS',
      BM_AUTOSUB_WATCH: 'BM_LINEUP_AUTOSUB_ALERT',
      BM_TOP_RIVALRY: 'BM_STANDINGS_TITLE_RACE',
      BM_GW_LEADER: 'BM_STANDINGS_GAMEWEEK_LEADER',
      BM_REMAINING_ASSETS: 'BM_LINEUP_REMAINING_ASSETS',
      PV_TOP_RIVALRY: 'PV_STANDINGS_TITLE_RACE',
      PV_GW_LEADER: 'PV_STANDINGS_GAMEWEEK_LEADER',
      PV_TOP_SCORER_GW: 'PV_PLAYER_TOP_PERFORMER',
      PV_CAPTAIN_RECAP: 'PV_CAPTAIN_POPULAR_MOST_CAPTAINED',
      PV_VICE_CAPTAIN: 'PV_CAPTAIN_VICE_CAPTAIN',
      PV_AUTOSUB_PENDING: 'PV_LINEUP_AUTOSUB_PENDING',
      PV_BENCH_POINTS: 'PV_LINEUP_BENCH_TOTAL',
      PV_CHIP_FREEHIT: 'PV_CHIP_FREE_HIT',
      PV_HITS_EVALUATION: 'PV_TRANSFER_HITS_EVALUATION',
      PV_CLEAN_SHEET_RECAP: 'PV_MATCH_CLEAN_SHEET',
      CF_GW_CHAMPION: 'CF_STANDINGS_GAMEWEEK_WINNER',
      CF_TOP_RIVALRY: 'CF_STANDINGS_TITLE_RACE',
      CF_MOST_GW_RIVALRY: 'CF_STANDINGS_WEEKLY_WINS_MOST',
      CF_RANK_CLIMBER: 'CF_STANDINGS_RANK_BIGGEST_RISE',
      CF_PLAYER_OF_THE_GW: 'CF_PLAYER_TOP_PERFORMER_GW_SCORER',
      CF_AUTOSUB_OFFICIAL: 'CF_LINEUP_AUTOSUB_CONFIRMED',
      CF_CAPTAIN_OFFICIAL: 'CF_CAPTAIN_POPULAR_MOST_CAPTAINED',
      CF_CHIP_FREEHIT: 'CF_CHIP_FREE_HIT',
      CF_HITS_DEDUCTED: 'CF_TRANSFER_HITS_DEDUCTED',
      CF_TRANSFER_KARMA: 'CF_TRANSFER_OUT_SOLD_HAULERS',
      CF_CAPTAIN_REGRET: 'CF_CAPTAIN_ALTERNATIVE_MISSED_HAUL',
      CF_RANK_FALLER: 'CF_STANDINGS_RANK_BIGGEST_DROP',
      CF_SUMMIT_COUP: 'CF_STANDINGS_TITLE_RACE_LEAD_CHANGE',
      CF_RIVALRY_DUEL: 'CF_STANDINGS_TITLE_RACE_POINTS_GAP',
      CF_BENCH_POINTS: 'CF_LINEUP_BENCH_POINTS',
    };

    const sortedLegacyEntries = Object.entries(LEGACY_TEMPLATE_ID_MAP).sort(
      (a, b) => b[0].length - a[0].length
    );

    const normalizeLegacyRowId = (rawId: string): string => {
      for (const [legacyPrefix, canonicalPrefix] of sortedLegacyEntries) {
        if (rawId === legacyPrefix) return canonicalPrefix;
        if (rawId.startsWith(`${legacyPrefix}_`) || rawId.startsWith(`${legacyPrefix}__`)) {
          return canonicalPrefix + rawId.slice(legacyPrefix.length);
        }
      }
      return rawId;
    };

    const db = getFplDatabase();
    const hasPopulatedDb =
      Boolean(db?.meta?.total_teams) &&
      Object.keys(db?.gw_snapshots || {}).length > 0;
    const feedGw = getCurrentGw();
    if (!hasPopulatedDb || !feedGw) {
      clearNewsTickerTable();
      return [];
    }
    const currentActivePhase = normalizeTickerPhase(phaseOverride || getGameweekPhase(feedGw));

    // Read current container rows on disk to detect GW change or Phase change
    let diskRows: NewsTickerDbRow[] = [];
    if (fs.existsSync(TABLE_FILE_PATH)) {
      try {
        const rawExisting = fs.readFileSync(TABLE_FILE_PATH, 'utf-8');
        const parsedExisting = JSON.parse(rawExisting);
        if (Array.isArray(parsedExisting)) {
          diskRows = parsedExisting;
        }
      } catch {}
    }

    const isGwChangedInMemory = lastBuiltGw !== null && lastBuiltGw !== feedGw;
    const isPhaseChangedInMemory = lastBuiltPhase !== null && !isPhaseActive(lastBuiltPhase, currentActivePhase);
    const hasDifferentGwOnDisk = diskRows.some((r) => !r || Number(r.gw) !== feedGw);
    const hasDifferentPhaseOnDisk = diskRows.some((r) => !r || !r.fase || !isPhaseActive(r.fase, currentActivePhase));

    const shouldPurgeContainer = Boolean(
      options?.clearExisting ||
      isGwChangedInMemory ||
      isPhaseChangedInMemory ||
      hasDifferentGwOnDisk ||
      hasDifferentPhaseOnDisk
    );

    // 0. On Action A, GW change, or Phase change: delete ALL existing rows in container BEFORE regenerating
    const existingTableMap = new Map<string, NewsTickerDbRow>();
    if (shouldPurgeContainer) {
      console.log(
        `[News Table Service] Purging container news rows (clearExisting=${Boolean(options?.clearExisting)}, gwChanged=${isGwChangedInMemory || hasDifferentGwOnDisk}, phaseChanged=${isPhaseChangedInMemory || hasDifferentPhaseOnDisk}) -> GW ${feedGw}, Phase: ${currentActivePhase}`
      );
      clearNewsTickerTable();
    } else {
      diskRows.forEach((r: NewsTickerDbRow) => {
        if (r && r.id && Number(r.gw) === feedGw && r.fase && isPhaseActive(r.fase, currentActivePhase)) {
          const rawKey = String(r.id);
          const normalizedKey = normalizeLegacyRowId(rawKey);
          if (isEditorTemplateId(rawKey)) {
            existingTableMap.set(rawKey, r);
          }
          if (normalizedKey !== rawKey && isEditorTemplateId(normalizedKey) && !existingTableMap.has(normalizedKey)) {
            existingTableMap.set(normalizedKey, r);
          }
        }
      });
    }

    // Hitung minimum poin_tayang per parent template dari pool aktif ('Y') yang sudah ada di GW & fase aktif
    // (Berita baru yang lahir di tengah fase mewarisi nilai minimum pool template-nya masing-masing)
    const sortedEditorTemplateIds = Array.from(getEditorTemplateIdSet()).sort(
      (a, b) => b.length - a.length
    );
    const minPoinByTemplate = new Map<string, number>();
    for (const r of existingTableMap.values()) {
      if (r.status_tayang === 'Y' && Number(r.gw) === feedGw && isPhaseActive(r.fase, currentActivePhase)) {
        const parentTid = resolveParentTemplateId(r.id, sortedEditorTemplateIds);
        const curPoin = Math.max(0, Number(r.poin_tayang) || 0);
        const prevMin = minPoinByTemplate.get(parentTid);
        if (prevMin === undefined || curPoin < prevMin) {
          minPoinByTemplate.set(parentTid, curPoin);
        }
      }
    }

    const isLiveMatchPhase = isPhaseActive('Live Match', currentActivePhase);

    // Helper to safely add rows strictly for feedGw and currentActivePhase while restoring poin_tayang & original timestamp
    const addRows = (rows: NewsTickerDbRow[]) => {
      for (const r of rows) {
        if (Number(r.gw) !== feedGw) continue;
        if (!r.fase || !isPhaseActive(r.fase, currentActivePhase)) continue;
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          const baseId = r.id.split('__')[0];
          const existing = existingTableMap.get(r.id) || existingTableMap.get(baseId);
          if (existing) {
            if (existing.poin_tayang !== undefined) {
              r.poin_tayang = existing.poin_tayang;
            }
            const preserveTimestampOnLiveUpdate =
              existing.text_berita === r.text_berita ||
              r.id.startsWith('LM_MATCH_DEFENSIVE_CONTRIBUTION') ||
              r.id.startsWith('LM_MATCH_SAVES_GOALKEEPER') ||
              r.id.startsWith('LM_MATCH_SCORE_LIVE') ||
              r.id.startsWith('LM_STANDINGS_RANK_MOVEMENT') ||
              r.id.startsWith('LM_STANDINGS_TITLE_RACE');
            if (preserveTimestampOnLiveUpdate && existing.timestamp_produksi) {
              r.timestamp_produksi = existing.timestamp_produksi;
            }
            const transitionedFromUpcoming =
              Boolean(existing.cycle_meta?.isUpcomingMatch) && r.cycle_meta?.isUpcomingMatch === false;
            const resolvedBaseline =
              existing.cycle_meta?.preKickoffPtsBaseline !== undefined
                ? existing.cycle_meta.preKickoffPtsBaseline
                : transitionedFromUpcoming
                  ? Math.max(0, Number(existing.poin_tayang) || 0)
                  : undefined;

            if (existing.cycle_meta || resolvedBaseline !== undefined) {
              r.cycle_meta = {
                ...(r.cycle_meta || {}),
                ...(existing.cycle_meta?.detectedClockSecs !== undefined
                  ? { detectedClockSecs: existing.cycle_meta.detectedClockSecs }
                  : {}),
                ...(existing.cycle_meta?.detectedPeriod !== undefined
                  ? { detectedPeriod: existing.cycle_meta.detectedPeriod }
                  : {}),
                ...(existing.cycle_meta?.detectedHtOffsetSecs !== undefined
                  ? { detectedHtOffsetSecs: existing.cycle_meta.detectedHtOffsetSecs }
                  : {}),
                ...(existing.cycle_meta?.firstHalfEndSecs !== undefined
                  ? { firstHalfEndSecs: existing.cycle_meta.firstHalfEndSecs }
                  : {}),
                ...(existing.cycle_meta?.htDurationSecs !== undefined
                  ? { htDurationSecs: existing.cycle_meta.htDurationSecs }
                  : {}),
                ...(existing.cycle_meta?.lastAiredAtMs !== undefined
                  ? { lastAiredAtMs: existing.cycle_meta.lastAiredAtMs }
                  : {}),
                ...(existing.cycle_meta?.lastAiredScoreSig !== undefined
                  ? { lastAiredScoreSig: existing.cycle_meta.lastAiredScoreSig }
                  : {}),
                ...(existing.cycle_meta?.lastAiredHeadline !== undefined
                  ? { lastAiredHeadline: existing.cycle_meta.lastAiredHeadline }
                  : {}),
                ...(resolvedBaseline !== undefined ? { preKickoffPtsBaseline: resolvedBaseline } : {}),
              };
            }
          } else if (!isLiveMatchPhase && r.status_tayang === 'Y' && r.poin_tayang === 0) {
            // Untuk fase non-LM, berita baru di tengah fase mewarisi poin_tayang minimum pool template-nya.
            // Untuk fase Live Match, event baru tetap mulai dari 0 agar gol/kejadian baru langsung prioritas.
            const parentTid = resolveParentTemplateId(r.id, sortedEditorTemplateIds);
            const poolMin = minPoinByTemplate.get(parentTid);
            if (poolMin !== undefined && poolMin > 0) {
              r.poin_tayang = poolMin;
            }
          }
          tableRows.push(r);
        }
      }
    };

    // 1. Produce stories STRICTLY for the active GW and active phase ONLY.
    if (isPhaseActive('Not started', currentActivePhase)) {
      // 3a. Not started (NS_*)
      try {
        const notStartedStories = generateNotStartedStories(feedGw);
        for (const ns of notStartedStories) {
          const records = createStoryRecordsForPhases({
            ...ns,
            sumber: (ns.sumber as any) || 'Sys',
            gw: feedGw,
          }, feedGw, currentActivePhase);
          addRows(records);
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Not started stories:', err.message);
      }
    } else if (isPhaseActive('Live Match', currentActivePhase)) {
      // 3b. Live Match (LM_*) — Two-Lane Editorial Newsroom with Match-Clock TTL & Post-FT Grace Window:
      // Production is never throttled at source; all events land in Meja Redaksi (news_ticker_table.json),
      // while finished matches stay eligible for an 8-minute Post-FT Grace Window so FT / 85'+ / Saves / DC can finish airing.
      try {
        const POST_FT_GRACE_MS = 8 * 60 * 1000;
        const nowMs = typeof options?.nowMs === 'number' && Number.isFinite(options.nowMs)
          ? options.nowMs
          : Date.now();
        const cachedMatches =
          options?.matchesOverride !== undefined
            ? options.matchesOverride
            : getCachedMatchesForGw(feedGw);
        const allPulseMatches = loadPulseMatchesForGw(feedGw);

        interface LiveMatchClockState {
          period: MatchPeriod;
          currentClockSecs: number;
          firstHalfEndSecs: number;
          htDurationSecs: number;
          htOffsetSecs: number;
          continuousClockSecs: number;
          isHalfTime: boolean;
          isSecondHalfStarted: boolean;
          isFinished: boolean;
          finishedAtMs: number;
          isRunning: boolean;
          isStarted: boolean;
        }
        const matchStateByKey = new Map<string, LiveMatchClockState>();
        const finishedMatchKeys = new Set<string>();
        const finishedMatchIds = new Set<number>();
        const runningStatMatchKeys = new Set<string>();

        // Seed first-seen FT timestamps & active match keys from previously saved table rows
        // so already-finished matches from earlier kickoffs are NEVER falsely treated as newly finished.
        const existingFtSeenAtByMatchKey = new Map<string, number>();
        const liveTrackedMatchKeysInExistingTable = new Set<string>();
        for (const existingRow of existingTableMap.values()) {
          const mKey =
            existingRow.cycle_meta?.matchKey ||
            (Array.isArray(existingRow.teams) && existingRow.teams.length >= 2
              ? buildMatchKey(existingRow.teams[0], existingRow.teams[1])
              : '');
          if (!mKey) continue;

          const isFullTimeRow =
            existingRow.id.startsWith('LM_MATCH_PERIOD_END') &&
            (existingRow.cycle_meta?.isFullTime || /\bFull\s*Time\b/i.test(existingRow.text_berita || ''));

          if (existingRow.cycle_meta?.isUpcomingMatch !== true && !isFullTimeRow) {
            liveTrackedMatchKeysInExistingTable.add(mKey);
          }

          if (isFullTimeRow) {
            const tsMs = Date.parse(existingRow.timestamp_produksi || '');
            if (Number.isFinite(tsMs) && tsMs > 0) {
              const prev = existingFtSeenAtByMatchKey.get(mKey);
              if (prev === undefined || tsMs < prev) {
                existingFtSeenAtByMatchKey.set(mKey, tsMs);
              }
            }
          }
        }

        const ftEventMillisByMatchKey = new Map<string, number>();
        for (const pulseData of allPulseMatches) {
          const pHomeRaw =
            pulseData?.teams?.[0]?.team?.shortName ||
            pulseData?.teams?.[0]?.team?.club?.shortName ||
            pulseData?.teams?.[0]?.team?.club?.abbr ||
            pulseData?.teams?.[0]?.team?.name ||
            '';
          const pAwayRaw =
            pulseData?.teams?.[1]?.team?.shortName ||
            pulseData?.teams?.[1]?.team?.club?.shortName ||
            pulseData?.teams?.[1]?.team?.club?.abbr ||
            pulseData?.teams?.[1]?.team?.name ||
            '';
          const pHome = resolveClubName(pHomeRaw);
          const pAway = resolveClubName(pAwayRaw);
          const mKey = buildMatchKey(pHome, pAway);
          if (!mKey) continue;

          const events: any[] = Array.isArray(pulseData?.events) ? pulseData.events : [];
          const pulseClockCtx = extractPulseClockContext(pulseData);
          const status = String(pulseData?.status || '').trim().toUpperCase();
          const phase = String(pulseData?.phase || '').trim().toUpperCase();
          const clockLabel = String(pulseData?.clock?.label || '').trim().toUpperCase();
          const hasHalfTimeEnd = events.some(
            (e: any) => e?.type === 'PE' && (e?.phase === '1' || e?.phase === '1H')
          );
          const hasSecondHalfStart =
            phase === '2' ||
            phase === '2H' ||
            events.some((e: any) => e?.type === 'PS' && (e?.phase === '2' || e?.phase === '2H'));
          const ftEvent = events.find(
            (e: any) => e?.type === 'PE' && (e?.phase === '2' || e?.phase === '2H')
          );
          const rawTopClockSecs = Number(pulseData?.clock?.secs) || 0;
          const isExplicitlyLiveAndUnder90 = status === 'L' && rawTopClockSecs < 5400 && phase !== 'F' && phase !== 'FT';
          const isPulseFinished =
            !isExplicitlyLiveAndUnder90 &&
            (status === 'C' ||
              phase === 'F' ||
              phase === 'FT' ||
              (typeof pulseData?.outcome === 'string' && pulseData.outcome.trim().length > 0) ||
              Boolean(ftEvent && (Number(ftEvent.clock?.secs) >= 5400 || Boolean(ftEvent.time?.millis))) ||
              clockLabel === 'FT' ||
              clockLabel.includes('FULL'));
          const isPulseRunning = isPulseMatchCurrentlyLive(pulseData, cachedMatches);
          const isHalfTimeNow = Boolean(
            !isPulseFinished &&
              !hasSecondHalfStart &&
              (status === 'HT' || phase === 'HT' || phase === 'H' || (hasHalfTimeEnd && phase !== '1' && phase !== '1H'))
          );
          const pulsePeriod: MatchPeriod =
            isPulseFinished && !isPulseRunning
              ? 'FT'
              : hasSecondHalfStart
                ? '2H'
                : isHalfTimeNow
                  ? 'HT'
                  : '1H';

          // Measure clock strictly within the active half so 1H stoppage (e.g. 45+4' = 2940s)
          // never freezes a 2H 46' (2760s) clock back at 2940s.
          let samePeriodMaxEventClockSecs = 0;
          for (const ev of events) {
            const evPh = String(ev?.phase || '').trim().toUpperCase();
            const clk = Number(ev?.clock?.secs) || 0;
            if (pulsePeriod === '1H' && (evPh === '1' || evPh === '1H')) {
              samePeriodMaxEventClockSecs = Math.max(samePeriodMaxEventClockSecs, clk);
            } else if ((pulsePeriod === '2H' || pulsePeriod === 'FT') && (evPh === '2' || evPh === '2H')) {
              samePeriodMaxEventClockSecs = Math.max(samePeriodMaxEventClockSecs, clk);
            }
          }

          const pulseClockSecs =
            pulsePeriod === 'HT'
              ? pulseClockCtx.firstHalfEndSecs
              : pulsePeriod === '2H'
                ? Math.max(2700, rawTopClockSecs, samePeriodMaxEventClockSecs)
                : pulsePeriod === 'FT'
                  ? Math.max(5400, rawTopClockSecs, samePeriodMaxEventClockSecs)
                  : Math.max(rawTopClockSecs, samePeriodMaxEventClockSecs);

          const htTracker = htTimingByMatchKey.get(mKey) || {
            firstHalfEndSecs: pulseClockCtx.firstHalfEndSecs,
            htStartMs: 0,
            htEndMs: 0,
          };
          htTracker.firstHalfEndSecs = Math.max(htTracker.firstHalfEndSecs, pulseClockCtx.firstHalfEndSecs);
          if (pulsePeriod === 'HT') {
            const hasPlausiblePulseHtStart =
              pulseClockCtx.firstHalfEndMs > 0 &&
              Math.abs(nowMs - pulseClockCtx.firstHalfEndMs) <= 3 * 60 * 60 * 1000;
            if (hasPlausiblePulseHtStart) {
              htTracker.htStartMs = pulseClockCtx.firstHalfEndMs;
            } else if (!htTracker.htStartMs) {
              htTracker.htStartMs = nowMs;
            }
          } else if (pulsePeriod === '2H' || pulsePeriod === 'FT') {
            if (htTracker.htStartMs > 0 && !htTracker.htEndMs) {
              htTracker.htEndMs = nowMs;
            }
          }
          htTimingByMatchKey.set(mKey, htTracker);

          let htDurationSecs = pulseClockCtx.htDurationSecs;
          if (
            htDurationSecs === DEFAULT_HALF_TIME_SECS &&
            htTracker.htStartMs > 0 &&
            htTracker.htEndMs > htTracker.htStartMs
          ) {
            const wallHtDiff = Math.round((htTracker.htEndMs - htTracker.htStartMs) / 1000);
            if (wallHtDiff >= MIN_HALF_TIME_SECS && wallHtDiff <= MAX_HALF_TIME_SECS) {
              htDurationSecs = wallHtDiff;
            }
          }
          const htOffsetSecs =
            pulsePeriod === 'HT' && htTracker.htStartMs > 0
              ? Math.min(htDurationSecs, Math.max(0, Math.round((nowMs - htTracker.htStartMs) / 1000)))
              : 0;
          const continuousClockSecs = computeContinuousMatchSecs(
            pulsePeriod,
            pulseClockSecs,
            htOffsetSecs,
            { firstHalfEndSecs: htTracker.firstHalfEndSecs, htDurationSecs }
          );

          const ftEventMs = Number(ftEvent?.time?.millis || 0);
          if (ftEventMs > 0) {
            ftEventMillisByMatchKey.set(mKey, ftEventMs);
          }
          const kickoffMs = Number(pulseData?.kickoff?.millis || 0);
          const estimatedFinishedMs =
            kickoffMs > 0 ? Math.min(nowMs, kickoffMs + 115 * 60 * 1000) : 1;
          const isFinalPulseFinished = isPulseFinished && !isPulseRunning;
          const finishedAtMs = isFinalPulseFinished
            ? ftEventMs > 0
              ? ftEventMs
              : existingFtSeenAtByMatchKey.get(mKey) ??
                (liveTrackedMatchKeysInExistingTable.has(mKey) ? nowMs : estimatedFinishedMs)
            : 0;
          const isPulseStarted =
            status === 'L' ||
            status === 'HT' ||
            status === 'C' ||
            pulseClockSecs > 0 ||
            hasHalfTimeEnd ||
            hasSecondHalfStart ||
            isPulseFinished ||
            isPulseRunning;

          if (isFinalPulseFinished) {
            finishedMatchKeys.add(mKey);
            if (Number(pulseData?.id) > 0) finishedMatchIds.add(Number(pulseData.id));
          }

          matchStateByKey.set(mKey, {
            period: pulsePeriod,
            currentClockSecs: pulseClockSecs,
            firstHalfEndSecs: htTracker.firstHalfEndSecs,
            htDurationSecs,
            htOffsetSecs,
            continuousClockSecs,
            isHalfTime: pulsePeriod === 'HT',
            isSecondHalfStarted: Boolean(hasSecondHalfStart),
            isFinished: isFinalPulseFinished,
            finishedAtMs,
            isRunning: isPulseRunning && !isFinalPulseFinished,
            isStarted: isPulseStarted,
          });
        }

        if (Array.isArray(cachedMatches)) {
          for (const card of cachedMatches) {
            const cHome = resolveClubName(card.home_team?.name || card.home_team?.short_name);
            const cAway = resolveClubName(card.away_team?.name || card.away_team?.short_name);
            const mKey = buildMatchKey(cHome, cAway);
            if (!mKey) continue;

            const cardRunning = isMatchCardRunning(card);
            const cardFinished = isMatchCardFinished(card);
            const { period: cardPeriod, clockSecs: cardClockSecs } = resolveCardPeriodAndClockSecs(card);
            const prev = matchStateByKey.get(mKey);
            const isFinished = cardFinished || Boolean(prev?.isFinished && !cardRunning);
            const cardKickoffMs = card.kickoff_time ? Date.parse(card.kickoff_time) : 0;
            const estimatedCardFtMs =
              Number.isFinite(cardKickoffMs) && cardKickoffMs > 0
                ? Math.min(nowMs, cardKickoffMs + 115 * 60 * 1000)
                : 1;
            const finishedAtMs = isFinished
              ? prev?.finishedAtMs ||
                existingFtSeenAtByMatchKey.get(mKey) ||
                (liveTrackedMatchKeysInExistingTable.has(mKey) ? nowMs : estimatedCardFtMs)
              : 0;

            const mergedPeriod: MatchPeriod = isFinished
              ? 'FT'
              : prev && periodSortRank(prev.period) > periodSortRank(cardPeriod)
                ? prev.period
                : cardPeriod;

            const htTracker = htTimingByMatchKey.get(mKey) || {
              firstHalfEndSecs: prev?.firstHalfEndSecs || 2700,
              htStartMs: 0,
              htEndMs: 0,
            };
            if (cardPeriod === '1H' && cardClockSecs > htTracker.firstHalfEndSecs) {
              htTracker.firstHalfEndSecs = cardClockSecs;
            }
            if (mergedPeriod === 'HT') {
              if (!htTracker.htStartMs) htTracker.htStartMs = nowMs;
            } else if (mergedPeriod === '2H' || mergedPeriod === 'FT') {
              if (htTracker.htStartMs > 0 && !htTracker.htEndMs) {
                htTracker.htEndMs = nowMs;
              }
            }
            htTimingByMatchKey.set(mKey, htTracker);

            let htDurationSecs = prev?.htDurationSecs || DEFAULT_HALF_TIME_SECS;
            if (
              htDurationSecs === DEFAULT_HALF_TIME_SECS &&
              htTracker.htStartMs > 0 &&
              htTracker.htEndMs > htTracker.htStartMs
            ) {
              const wallHtDiff = Math.round((htTracker.htEndMs - htTracker.htStartMs) / 1000);
              if (wallHtDiff >= MIN_HALF_TIME_SECS && wallHtDiff <= MAX_HALF_TIME_SECS) {
                htDurationSecs = wallHtDiff;
              }
            }
            const htOffsetSecs =
              mergedPeriod === 'HT'
                ? prev?.htOffsetSecs ||
                  (htTracker.htStartMs > 0
                    ? Math.min(htDurationSecs, Math.max(0, Math.round((nowMs - htTracker.htStartMs) / 1000)))
                    : 0)
                : 0;

            const mergedClockSecs =
              mergedPeriod === 'HT'
                ? htTracker.firstHalfEndSecs
                : prev && prev.period === mergedPeriod
                  ? Math.max(prev.currentClockSecs, cardClockSecs)
                  : prev && periodSortRank(prev.period) > periodSortRank(cardPeriod)
                    ? prev.currentClockSecs
                    : cardClockSecs;

            const continuousClockSecs = computeContinuousMatchSecs(
              mergedPeriod,
              mergedClockSecs,
              htOffsetSecs,
              { firstHalfEndSecs: htTracker.firstHalfEndSecs, htDurationSecs }
            );

            if (isFinished) {
              finishedMatchKeys.add(mKey);
              if (Number(card.id) > 0) finishedMatchIds.add(Number(card.id));
            } else if (cardRunning) {
              finishedMatchKeys.delete(mKey);
              runningStatMatchKeys.add(mKey);
            }

            matchStateByKey.set(mKey, {
              period: mergedPeriod,
              currentClockSecs: mergedClockSecs,
              firstHalfEndSecs: htTracker.firstHalfEndSecs,
              htDurationSecs,
              htOffsetSecs,
              continuousClockSecs,
              isHalfTime: mergedPeriod === 'HT',
              isSecondHalfStarted: mergedPeriod === '2H' || mergedPeriod === 'FT' || Boolean(prev?.isSecondHalfStarted),
              isFinished,
              finishedAtMs,
              isRunning: cardRunning && !isFinished,
              isStarted: Boolean(card.started || cardFinished || cardRunning || prev?.isStarted),
            });
          }
        }

        // Cross-check DB synced gw_fixtures so any finished fixture with missing/stale cache is still detected as finished
        const dbFixtures = Array.isArray(db?.meta?.sync_status?.gw_fixtures)
          ? db.meta.sync_status.gw_fixtures
          : [];
        for (const f of dbFixtures) {
          if (Number(f?.event) !== feedGw) continue;
          const isDbFt = Boolean(f?.finished || f?.finished_provisional);
          if (!isDbFt) continue;
          const fHome = resolveClubName(String(f?.home_team || ''));
          const fAway = resolveClubName(String(f?.away_team || ''));
          const mKey = fHome && fAway ? buildMatchKey(fHome, fAway) : '';
          const prev = mKey ? matchStateByKey.get(mKey) : undefined;
          // Only respect DB FT when cachedMatches did not actively report this match as running
          if (mKey && !runningStatMatchKeys.has(mKey)) {
            finishedMatchKeys.add(mKey);
            if (Number(f?.id) > 0) finishedMatchIds.add(Number(f.id));
            if (prev && !prev.isFinished) {
              matchStateByKey.set(mKey, {
                ...prev,
                period: 'FT',
                isHalfTime: false,
                isFinished: true,
                isRunning: false,
                finishedAtMs: prev.finishedAtMs || existingFtSeenAtByMatchKey.get(mKey) || nowMs,
              });
            }
          }
        }

        const isMatchCurrentlyLive = (mKey: string, pulseData?: any, card?: MatchCardItem): boolean => {
          if (mKey && finishedMatchKeys.has(mKey)) return false;
          const state = mKey ? matchStateByKey.get(mKey) : undefined;
          if (state?.isFinished) return false;
          if (card) return isMatchCardRunning(card);
          if (pulseData) return isPulseMatchCurrentlyLive(pulseData, cachedMatches);
          return Boolean(state?.isRunning);
        };

        const shouldEmitFullTimeBannerOnly = (mKey: string): boolean => {
          const state = mKey ? matchStateByKey.get(mKey) : undefined;
          if (!state?.isFinished || state.isRunning) return false;
          if (!state.finishedAtMs || nowMs - state.finishedAtMs > POST_FT_GRACE_MS) return false;
          const ftMs = ftEventMillisByMatchKey.get(mKey) || 0;
          const hasRecentRealFtEvent = ftMs > 0 && nowMs - ftMs <= POST_FT_GRACE_MS;
          return (
            liveTrackedMatchKeysInExistingTable.has(mKey) ||
            existingFtSeenAtByMatchKey.has(mKey) ||
            hasRecentRealFtEvent
          );
        };

        for (const pulseData of allPulseMatches) {
          const pHome = resolveClubName(
            pulseData?.teams?.[0]?.team?.shortName ||
              pulseData?.teams?.[0]?.team?.club?.shortName ||
              pulseData?.teams?.[0]?.team?.club?.abbr ||
              pulseData?.teams?.[0]?.team?.name ||
              ''
          );
          const pAway = resolveClubName(
            pulseData?.teams?.[1]?.team?.shortName ||
              pulseData?.teams?.[1]?.team?.club?.shortName ||
              pulseData?.teams?.[1]?.team?.club?.abbr ||
              pulseData?.teams?.[1]?.team?.name ||
              ''
          );
          const mKey = buildMatchKey(pHome, pAway);
          const matchLive = isMatchCurrentlyLive(mKey, pulseData);
          const emitFtOnly = !matchLive && shouldEmitFullTimeBannerOnly(mKey);
          if (!matchLive && !emitFtOnly) continue;

          try {
            const liveStories = generateStoriesFromPulseMatch(pulseData, feedGw);
            for (const ls of liveStories) {
              if (emitFtOnly) {
                const isFullTimeStory =
                  ls.id.startsWith('LM_MATCH_PERIOD_END') && Boolean(ls.cycle_meta?.isFullTime);
                if (!isFullTimeStory) continue;
              }
              const records = createStoryRecordsForPhases({
                ...ls,
                sumber: (ls.sumber as any) || 'Sys',
                gw: feedGw,
              }, feedGw, currentActivePhase);
              addRows(records);
            }
          } catch (fileErr: any) {
            console.warn(`[News Table Service] Warning reading live Pulse match ${pulseData?.id}:`, fileErr.message);
          }
        }

        if (cachedMatches && cachedMatches.length > 0) {
          const statEligibleMatches = cachedMatches.filter((m) => {
            if (isMatchCardFinished(m)) return false;
            const mKey = buildMatchKey(
              resolveClubName(m.home_team?.name || m.home_team?.short_name),
              resolveClubName(m.away_team?.name || m.away_team?.short_name)
            );
            return isMatchCurrentlyLive(mKey, undefined, m);
          });

          const liveStatStories = generateLiveMatchStatStories(feedGw, {
            includeFinished: false,
            matchesOverride: statEligibleMatches,
          });
          for (const ls of liveStatStories) {
            const records = createStoryRecordsForPhases({
              ...ls,
              sumber: (ls.sumber as any) || 'Sys',
              gw: feedGw,
            }, feedGw, currentActivePhase);
            addRows(records);
          }

          const liveRankShiftStories = generateLiveTeamRankShiftStories(feedGw, {
            requireLiveMatch: true,
            matchesOverride: cachedMatches,
          });
          for (const ls of liveRankShiftStories) {
            const records = createStoryRecordsForPhases({
              ...ls,
              sumber: (ls.sumber as any) || 'Sys',
              gw: feedGw,
            }, feedGw, currentActivePhase);
            addRows(records);
          }

          const liveScoreStories = generateLiveMatchScoreStories(feedGw, {
            includeFinished: false,
            matchesOverride: cachedMatches,
          });
          for (const ls of liveScoreStories) {
            const records = createStoryRecordsForPhases({
              ...ls,
              sumber: (ls.sumber as any) || 'Sys',
              gw: feedGw,
            }, feedGw, currentActivePhase);
            addRows(records);
          }

          const liveLineupStories = generateLiveLineupSurpriseStories(feedGw, {
            includeFinished: false,
            matchesOverride: cachedMatches,
          });
          for (const ls of liveLineupStories) {
            const records = createStoryRecordsForPhases({
              ...ls,
              sumber: (ls.sumber as any) || 'Sys',
              gw: feedGw,
            }, feedGw, currentActivePhase);
            addRows(records);
          }

          const liveTitleRaceStories = generateLiveTitleRaceStories(feedGw, {
            requireLiveMatch: true,
            matchesOverride: cachedMatches,
          });
            for (const ls of liveTitleRaceStories) {
              const records = createStoryRecordsForPhases({
                ...ls,
                sumber: (ls.sumber as any) || 'Sys',
                gw: feedGw,
              }, feedGw, currentActivePhase);
              addRows(records);
            }
          } else {
            // Guard against transient empty matches cache (e.g. during invalidateMatchesCache + failed/in-flight fetch):
            // Never resurrect LM_MATCH_SAVES_GOALKEEPER / LM_MATCH_DEFENSIVE_CONTRIBUTION / LM_MATCH_SCORE_LIVE
            // for matches already finished or no longer running.
            const preservedCachedMatchRows = Array.from(existingTableMap.values()).filter((er) => {
              const pid = resolveParentTemplateId(er.id, sortedEditorTemplateIds);
              if (
                pid === 'LM_MATCH_SAVES_GOALKEEPER' ||
                pid === 'LM_MATCH_DEFENSIVE_CONTRIBUTION' ||
                pid === 'LM_MATCH_SCORE_LIVE'
              ) {
                const erKey =
                  er.cycle_meta?.matchKey ||
                  (Array.isArray(er.teams) && er.teams.length >= 2
                    ? buildMatchKey(er.teams[0], er.teams[1])
                    : '');
                const erMatchId = Number(er.cycle_meta?.pulseMatchId || 0);
                if (!erKey || finishedMatchKeys.has(erKey) || (erMatchId > 0 && finishedMatchIds.has(erMatchId))) {
                  return false;
                }
                const st = matchStateByKey.get(erKey);
                if (!st || st.isFinished || !st.isRunning) {
                  return false;
                }
                return true;
              }
              return (
                pid === 'LM_LINEUP_SURPRISE_BENCHED' ||
                pid === 'LM_STANDINGS_RANK_MOVEMENT' ||
                pid === 'LM_STANDINGS_TITLE_RACE'
              );
            });
            if (preservedCachedMatchRows.length > 0) {
              addRows(preservedCachedMatchRows.map((row) => ({ ...row })));
            }
          }

        // Also register the 12 post-deadline locked NS_* fallback items for quiet Live Match periods
        try {
          const fallbackNsStories = generateNotStartedStories(feedGw).filter((ns) =>
            LM_FALLBACK_NS_TEMPLATE_IDS.has(ns.id)
          );
          for (const fb of fallbackNsStories) {
            const records = createStoryRecordsForPhases({
              ...fb,
              sumber: (fb.sumber as any) || 'Sys',
              gw: feedGw,
              waktu_tayang: ['Live Match'],
              fase: 'Live Match',
              cycle_meta: {
                ...(fb.cycle_meta || {}),
                isLmFallback: true,
              },
            }, feedGw, currentActivePhase);
            addRows(records);
          }
        } catch (fbErr: any) {
          console.warn('[News Table Service] Warning generating LM NS fallback stories:', fbErr.message);
        }

        // Stamp live HT offset onto newly detected stat rows detected during Half Time
        for (const r of tableRows) {
          if (r.cycle_meta?.detectedPeriod === 'HT' && r.cycle_meta.detectedHtOffsetSecs === undefined) {
            const mKey =
              r.cycle_meta.matchKey ||
              (Array.isArray(r.teams) && r.teams.length >= 2 ? buildMatchKey(r.teams[0], r.teams[1]) : '');
            const st = mKey ? matchStateByKey.get(mKey) : undefined;
            if (st && st.period === 'HT') {
              r.cycle_meta = {
                ...r.cycle_meta,
                detectedHtOffsetSecs: st.htOffsetSecs,
                firstHalfEndSecs: st.firstHalfEndSecs,
                htDurationSecs: st.htDurationSecs,
              };
            }
          }
        }

        // Apply Two-Lane Live Match Editorial Newsroom TTL & Supersede Expiry rules.
        // Rows remain stored in Meja Redaksi with status_tayang='N' + descriptive reason so nothing is silently deleted.
        const executedPenClocksByMatch = new Map<string, number[]>();
        for (const r of tableRows) {
          const parentId = resolveParentTemplateId(r.id, sortedEditorTemplateIds);
          if (
            parentId === 'LM_MATCH_PENALTY_GOAL' ||
            parentId === 'LM_MATCH_PENALTY_MISSED' ||
            parentId === 'LM_MATCH_PENALTY_SAVED'
          ) {
            const mKey =
              r.cycle_meta?.matchKey ||
              (Array.isArray(r.teams) && r.teams.length >= 2 ? buildMatchKey(r.teams[0], r.teams[1]) : '');
            if (mKey) {
              const st = matchStateByKey.get(mKey);
              const contClk = resolveStoryPeriodAndClock(
                r,
                st ? { firstHalfEndSecs: st.firstHalfEndSecs, htDurationSecs: st.htDurationSecs } : undefined
              ).continuousClockSecs;
              const arr = executedPenClocksByMatch.get(mKey) || [];
              arr.push(contClk);
              executedPenClocksByMatch.set(mKey, arr);
            }
          }
        }

        const markExpired = (row: NewsTickerDbRow, reason: string) => {
          row.status_tayang = 'N';
          row.keterangan_tidak_tayang = reason;
        };

        for (const row of tableRows) {
          if (row.status_tayang !== 'Y') continue;
          const parentId = resolveParentTemplateId(row.id, sortedEditorTemplateIds);
          const tier = classifyLiveMatchNewsroomTier(parentId, row);

          // P3 Heartbeat & NS Fallback stay evergreen while Live Match phase runs
          if (tier === 'P3' || tier === 'FALLBACK') continue;

          const mKey =
            row.cycle_meta?.matchKey ||
            (Array.isArray(row.teams) && row.teams.length >= 2
              ? buildMatchKey(row.teams[0], row.teams[1])
              : '');
          const mState = mKey ? matchStateByKey.get(mKey) : undefined;
          const pts = Math.max(0, Number(row.poin_tayang) || 0);

          // 0. Strict FT suppression for live stats (Saves & Defensive Contribution):
          // Never display once their own match finishes, preventing carry-over into subsequent matches' LM phase.
          if (
            parentId === 'LM_MATCH_SAVES_GOALKEEPER' ||
            parentId === 'LM_MATCH_DEFENSIVE_CONTRIBUTION'
          ) {
            const rowMatchId = Number(row.cycle_meta?.pulseMatchId || 0);
            const isStatMatchFinished =
              Boolean(mState?.isFinished) ||
              (Boolean(mKey) && finishedMatchKeys.has(mKey)) ||
              (rowMatchId > 0 && finishedMatchIds.has(rowMatchId)) ||
              (Array.isArray(cachedMatches) &&
                cachedMatches.length > 0 &&
                Boolean(mKey) &&
                !runningStatMatchKeys.has(mKey));
            if (isStatMatchFinished) {
              markExpired(row, 'Expired: Laga sudah selesai (FT)');
              continue;
            }
          }

          const matchCtx = mState
            ? { firstHalfEndSecs: mState.firstHalfEndSecs, htDurationSecs: mState.htDurationSecs }
            : {
                firstHalfEndSecs: row.cycle_meta?.firstHalfEndSecs ?? 2700,
                htDurationSecs: row.cycle_meta?.htDurationSecs ?? DEFAULT_HALF_TIME_SECS,
              };
          const resolvedEventClock = resolveStoryPeriodAndClock(row, matchCtx);
          const curClock = mState?.currentClockSecs ?? resolvedEventClock.clockSecs;
          const elapsedSecs = mState
            ? computeMatchElapsedSecs({
                eventPeriod: resolvedEventClock.period,
                eventClockSecs: resolvedEventClock.clockSecs,
                eventHtOffsetSecs: resolvedEventClock.htOffsetSecs,
                curPeriod: mState.period,
                curClockSecs: mState.currentClockSecs,
                curHtOffsetSecs: mState.htOffsetSecs,
                firstHalfEndSecs: mState.firstHalfEndSecs,
                htDurationSecs: mState.htDurationSecs,
              })
            : 0;

          // 1. Half Time / Full Time (LM_MATCH_PERIOD_END) — cukup 1x tayang
          if (parentId === 'LM_MATCH_PERIOD_END') {
            const isFullTime = Boolean(
              row.cycle_meta?.isFullTime || /\bFull\s*Time\b/i.test(row.text_berita || '')
            );
            if (isFullTime) {
              if (pts >= 1) {
                markExpired(row, 'Expired: Full Time sudah tayang');
              } else if (mState?.isFinished && mState.finishedAtMs > 0 && nowMs - mState.finishedAtMs > POST_FT_GRACE_MS) {
                markExpired(row, 'Expired: Jendela pasca-FT melewati 8 menit');
              }
            } else {
              if (pts >= 1) {
                markExpired(row, 'Expired: Half Time sudah tayang');
              } else if (mState?.isFinished || mState?.isSecondHalfStarted) {
                markExpired(row, 'Expired: Babak 2 sudah dimulai / laga usai');
              }
            }
            continue;
          }

          // 2. Kickoff (LM_MATCH_PERIOD_START) — measure strictly against its own half kickoff (1H: 0s, 2H: 2700s + HT)
          // so accessing mid-half never resurrects 0' kickoff news and 1H stoppage / HT never corrupt 2H kickoff TTL.
          if (parentId === 'LM_MATCH_PERIOD_START') {
            const isSecondHalfKo = Boolean(row.cycle_meta?.isSecondHalf);
            const kickoffPeriod: MatchPeriod = isSecondHalfKo ? '2H' : '1H';
            const kickoffClock =
              Number(row.cycle_meta?.clockSecs ?? (isSecondHalfKo ? 2700 : 0)) || 0;
            const kickoffElapsed = mState
              ? computeMatchElapsedSecs({
                  eventPeriod: kickoffPeriod,
                  eventClockSecs: kickoffClock,
                  curPeriod: mState.period,
                  curClockSecs: mState.currentClockSecs,
                  curHtOffsetSecs: mState.htOffsetSecs,
                  firstHalfEndSecs: mState.firstHalfEndSecs,
                  htDurationSecs: mState.htDurationSecs,
                })
              : 0;
            if (pts >= 1) {
              markExpired(row, 'Expired: Kickoff sudah tayang');
            } else if (mState?.isFinished) {
              markExpired(row, 'Expired: Laga sudah usai');
            } else if (
              !isSecondHalfKo &&
              (mState?.isHalfTime || mState?.isSecondHalfStarted || kickoffElapsed > 600)
            ) {
              markExpired(row, 'Expired: Kickoff Babak 1 melewati TTL 10 menit');
            } else if (isSecondHalfKo && kickoffElapsed > 600) {
              markExpired(row, 'Expired: Kickoff Babak 2 melewati TTL 10 menit');
            }
            continue;
          }

          // 3. Surprise Lineup (LM_LINEUP_SURPRISE_BENCHED)
          // Dual rule:
          // - Pre-kickoff (!matchStarted): stays active ('Y') across 10-minute reminder cycles until kickoff.
          // - Started match (matchStarted): existing LM rule (max 2x post-kickoff airings, expires at effPts >= 2 or minute 15).
          if (parentId === 'LM_LINEUP_SURPRISE_BENCHED') {
            const matchStarted =
              row.cycle_meta?.isUpcomingMatch === false ||
              Boolean(
                mState?.isStarted ||
                  mState?.isRunning ||
                  mState?.isFinished ||
                  mState?.isSecondHalfStarted ||
                  curClock > 0
              );
            if (!matchStarted) {
              continue;
            }
            if (row.cycle_meta?.isUpcomingMatch) {
              row.cycle_meta = {
                ...row.cycle_meta,
                isUpcomingMatch: false,
                preKickoffPtsBaseline: row.cycle_meta.preKickoffPtsBaseline ?? pts,
              };
            }
            const effPts = getEffectiveLmLineupSurprisePts(row);
            if (effPts >= 2) {
              markExpired(row, 'Expired: Lineup kejutan sudah tayang 2x');
            } else if (mState?.isFinished || (mState ? mState.continuousClockSecs >= 900 : curClock >= 900)) {
              markExpired(row, 'Expired: Lineup kejutan melewati menit 15');
            }
            continue;
          }

          // 4. Penalty Awarded (supersede immediately once executed, using continuous timeline so halves never collide)
          if (parentId === 'LM_MATCH_PENALTY_AWARDED' && !row.cycle_meta?.isPenaltyCancelled) {
            const execClocks = mKey ? executedPenClocksByMatch.get(mKey) : undefined;
            if (execClocks && execClocks.some((execContClk) => execContClk >= resolvedEventClock.continuousClockSecs - 30)) {
              markExpired(row, 'Expired: Eksekusi penalti sudah selesai');
              continue;
            }
          }

          // 5. Immediately expire ALL on-pitch events from any finished match (do not carry finished-match events into running matches)
          if (mState?.isFinished) {
            markExpired(row, 'Expired: Laga sudah selesai (FT)');
            continue;
          }

          // 6. General Two-Tier Match-Clock TTL & Max-Airings (accounting for period & HT break)
          if (tier === 'P4') {
            if (pts >= 1) {
              markExpired(row, 'Expired: Berita minor (P4) sudah tayang 1x');
            } else {
              const ttlSecs = (row.cycle_meta?.maxOwnerPct || 0) >= 10 ? 300 : 180;
              if (elapsedSecs > ttlSecs) {
                markExpired(row, `Expired: Berita minor melewati TTL ${ttlSecs / 60} menit`);
              }
            }
          } else {
            // P1 & P2
            if (pts >= 2) {
              markExpired(row, 'Expired: Batas maksimal 2x tayang tercapai');
            } else if (pts >= 1 && elapsedSecs > 300) {
              markExpired(row, 'Expired: Replay P1/P2 melewati TTL 5 menit');
            } else if (pts === 0) {
              const ttlSecs = tier === 'P1' ? 720 : 600;
              if (elapsedSecs > ttlSecs) {
                markExpired(row, `Expired: Antrean padat melewati TTL ${ttlSecs / 60} menit`);
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Live Match stories:', err.message);
      }
    } else if (isPhaseActive('Between Match', currentActivePhase)) {
      // 3d. Between Match (BM_*)
      try {
        const bmStories = generateBetweenMatchStories(feedGw);
        for (const bm of bmStories) {
          const records = createStoryRecordsForPhases({
            ...bm,
            sumber: (bm.sumber as any) || 'Sys',
            gw: feedGw,
          }, feedGw, currentActivePhase);
          addRows(records);
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Between Match stories:', err.message);
      }
    } else if (isPhaseActive('Provisional', currentActivePhase)) {
      // 3e. Provisional (PV_*)
      try {
        const pvStories = generateProvisionalStories(feedGw);
        for (const pv of pvStories) {
          const records = createStoryRecordsForPhases({
            ...pv,
            sumber: (pv.sumber as any) || 'Sys',
            gw: feedGw,
          }, feedGw, currentActivePhase);
          addRows(records);
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Provisional stories:', err.message);
      }
    } else if (isPhaseActive('Confirmed', currentActivePhase)) {
      // 3c. Confirmed (CF_*)
      try {
        const confStories = generateConfirmedStories(feedGw);
        for (const cs of confStories) {
          const records = createStoryRecordsForPhases({
            ...cs,
            sumber: (cs.sumber as any) || 'Sys',
            gw: feedGw,
          }, feedGw, currentActivePhase);
          addRows(records);
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Confirmed stories:', err.message);
      }
    }

    // Sort by: status_tayang 'Y' first; preserve wave-cycle order for NS/BM/PV/CF, timestamp descending for Live Match
    tableRows.sort((a, b) => {
      if (a.status_tayang !== b.status_tayang) {
        return a.status_tayang === 'Y' ? -1 : 1;
      }
      if (!isPhaseActive('Live Match', currentActivePhase)) {
        return 0;
      }
      return new Date(b.timestamp_produksi).getTime() - new Date(a.timestamp_produksi).getTime();
    });

    // Save to container file
    fs.writeFileSync(TABLE_FILE_PATH, JSON.stringify(tableRows, null, 2), 'utf-8');
    memoryTableCache = tableRows;
    lastBuiltGw = feedGw;
    lastBuiltPhase = currentActivePhase;
    lastBuiltAt = Date.now();
    console.log(`[News Table Service] Successfully synchronized container news table with ${tableRows.length} rows (GW ${feedGw}, Phase: ${currentActivePhase}).`);

    return tableRows;
  } catch (err: any) {
    console.error('[News Table Service] Error rebuilding news ticker table:', err.message);
    return memoryTableCache || [];
  }
}

function isTableStaleForCurrentState(rows: NewsTickerDbRow[]): boolean {
  const currentGw = getCurrentGw();
  const currentPhase = normalizeTickerPhase(getGameweekPhase(currentGw));

  if (lastBuiltGw !== null && (lastBuiltGw !== currentGw || !isPhaseActive(lastBuiltPhase || '', currentPhase))) {
    return true;
  }

  for (const r of rows) {
    if (!r.gw || Number(r.gw) !== currentGw) {
      return true;
    }
    if (!r.fase || !isPhaseActive(r.fase, currentPhase)) {
      return true;
    }
    if (!isEditorTemplateId(r.id)) {
      return true;
    }
    if (
      r.status_tayang !== 'Y' &&
      typeof r.keterangan_tidak_tayang === 'string' &&
      r.keterangan_tidak_tayang.startsWith('Fase saat ini')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a live match stat story (LM_MATCH_SAVES_GOALKEEPER or LM_MATCH_DEFENSIVE_CONTRIBUTION)
 * belongs to a match that has already finished (or is no longer running when live matches cache exists).
 */
export function isLiveStatRowForFinishedMatch(
  row: NewsTickerDbRow,
  targetGw?: number,
  matchesOverride?: MatchCardItem[] | null
): boolean {
  const id = String(row?.id || '');
  if (
    !id.startsWith('LM_MATCH_SAVES_GOALKEEPER') &&
    !id.startsWith('LM_MATCH_DEFENSIVE_CONTRIBUTION')
  ) {
    return false;
  }

  const gw = Number(targetGw || row.gw || getCurrentGw()) || 0;
  if (!gw) return false;

  const mKey =
    row.cycle_meta?.matchKey ||
    (Array.isArray(row.teams) && row.teams.length >= 2
      ? buildMatchKey(row.teams[0], row.teams[1])
      : '');
  const rowMatchId = Number(row.cycle_meta?.pulseMatchId || 0);

  const cachedMatches =
    matchesOverride !== undefined ? matchesOverride : getCachedMatchesForGw(gw);
  if (Array.isArray(cachedMatches) && cachedMatches.length > 0) {
    const matchedCard = cachedMatches.find((m) => {
      if (rowMatchId > 0 && Number(m.id) === rowMatchId) return true;
      if (!mKey) return false;
      const cKey = buildMatchKey(
        resolveClubName(m.home_team?.name || m.home_team?.short_name),
        resolveClubName(m.away_team?.name || m.away_team?.short_name)
      );
      return cKey === mKey;
    });
    if (!matchedCard) return true;
    return isMatchCardFinished(matchedCard) || !isMatchCardRunning(matchedCard);
  }

  const db = getFplDatabase();
  const dbFixtures = Array.isArray(db?.meta?.sync_status?.gw_fixtures)
    ? db.meta.sync_status.gw_fixtures
    : [];
  const matchedFix = dbFixtures.find((f: any) => {
    if (Number(f?.event) !== gw) return false;
    if (rowMatchId > 0 && Number(f?.id) === rowMatchId) return true;
    if (!mKey) return false;
    const fHome = resolveClubName(String(f?.home_team || ''));
    const fAway = resolveClubName(String(f?.away_team || ''));
    return Boolean(fHome && fAway && buildMatchKey(fHome, fAway) === mKey);
  });
  if (matchedFix && (matchedFix.finished || matchedFix.finished_provisional)) {
    return true;
  }

  return false;
}

/**
 * Returns all news rows from memory or disk
 */
export function getNewsTickerTable(forceRefresh = false): NewsTickerDbRow[] {
  if (!forceRefresh && memoryTableCache && memoryTableCache.length > 0) {
    if (!isTableStaleForCurrentState(memoryTableCache)) {
      return memoryTableCache;
    }
    return rebuildNewsTickerTable();
  }

  if (!forceRefresh && fs.existsSync(TABLE_FILE_PATH)) {
    try {
      const raw = fs.readFileSync(TABLE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (!isTableStaleForCurrentState(parsed)) {
          memoryTableCache = parsed;
          lastBuiltGw = getCurrentGw();
          lastBuiltPhase = normalizeTickerPhase(getGameweekPhase(lastBuiltGw));
          if (!lastBuiltAt) {
            lastBuiltAt = Date.now();
          }
          return parsed;
        }
      }
    } catch {}
  }

  return rebuildNewsTickerTable();
}

/**
 * Returns filtered and queried news items with summary statistics
 */
export function queryNewsTickerTable(params: {
  search?: string;
  kategori?: string;
  sumber?: string;
  status_tayang?: string;
  waktu_tayang?: string;
  fase?: string;
  phase?: string;
  limit?: number;
  offset?: number;
}) {
  const currentGw = getCurrentGw();
  const allRows = getNewsTickerTable().filter((r) => Number(r.gw) === currentGw);

  let filtered = allRows;

  // 1. Filter by status tayang (Y / N)
  if (params.status_tayang && params.status_tayang !== 'ALL') {
    const st = params.status_tayang.toUpperCase();
    filtered = filtered.filter((r) => r.status_tayang === st);
  }

  // 2. Filter by sumber (AI / Bukan)
  if (params.sumber && params.sumber !== 'ALL') {
    const src = params.sumber.toLowerCase();
    filtered = filtered.filter((r) => r.sumber.toLowerCase() === src);
  }

  // 3. Filter by kategori
  if (params.kategori && params.kategori !== 'ALL') {
    filtered = filtered.filter((r) => r.kategori.toLowerCase() === params.kategori!.toLowerCase());
  }

  // 4. Filter by fase / phase
  const filterPhase = params.fase || params.phase;
  if (filterPhase && filterPhase !== 'ALL') {
    filtered = filtered.filter((r) => r.fase && r.fase.toLowerCase() === filterPhase.toLowerCase());
  }

  // 5. Filter by waktu tayang
  if (params.waktu_tayang && params.waktu_tayang !== 'ALL') {
    filtered = filtered.filter((r) =>
      r.waktu_tayang.some((w) => w.toLowerCase() === params.waktu_tayang!.toLowerCase())
    );
  }

  // 5. Search query across headline, ID, teams, players
  if (params.search && params.search.trim()) {
    const q = params.search.toLowerCase().trim();
    filtered = filtered.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.text_berita.toLowerCase().includes(q) ||
        r.text_berita_en.toLowerCase().includes(q) ||
        r.sub_kategori.toLowerCase().includes(q) ||
        r.teams.some((t) => t.toLowerCase().includes(q)) ||
        r.players.some((p) => p.toLowerCase().includes(q))
    );
  }

  // Global counts for KPI dashboard cards
  const activeCount = allRows.filter((r) => r.status_tayang === 'Y').length;
  const inactiveCount = allRows.filter((r) => r.status_tayang === 'N').length;
  const aiCount = allRows.filter((r) => r.sumber === 'AI').length;
  const nonAiCount = allRows.filter((r) => r.sumber === 'Bukan').length;

  const categoryCounts: Record<string, number> = {};
  for (const r of allRows) {
    categoryCounts[r.kategori] = (categoryCounts[r.kategori] || 0) + 1;
  }

  const offset = params.offset || 0;
  const limit = params.limit || filtered.length;
  const paginatedData = filtered.slice(offset, offset + limit);

  return {
    success: true,
    total: filtered.length,
    totalAll: allRows.length,
    stats: {
      total: allRows.length,
      active_count: activeCount,
      inactive_count: inactiveCount,
      ai_count: aiCount,
      non_ai_count: nonAiCount,
      categories: categoryCounts,
    },
    data: paginatedData,
  };
}

/**
 * Increments poin_tayang by +1 when a news item actually finishes airing on screen,
 * guarded by a server-side per-row cooldown so multiple open tabs/devices cannot
 * double-increment the same story within the same airing cycle.
 */
export function incrementPoinTayang(
  id: string,
  cycleSizeHint?: number
): { success: boolean; deduped?: boolean; id?: string; poin_tayang?: number } {
  const rows = getNewsTickerTable();
  const row = rows.find((r) => r.id === id);
  if (!row) return { success: false };

  const rowKey = `${row.gw}:${row.fase}:${row.id}`;
  const now = Date.now();
  const cooldownMs = isPhaseActive('Live Match', row.fase)
    ? 45000
    : Math.max(45000, Math.min(180000, Math.max(10, Number(cycleSizeHint) || 15) * 5000));

  const lastTs = lastIncrementByRowKey.get(rowKey) || 0;
  if (now - lastTs < cooldownMs) {
    return {
      success: true,
      deduped: true,
      id: row.id,
      poin_tayang: row.poin_tayang || 0,
    };
  }

  row.poin_tayang = (row.poin_tayang || 0) + 1;
  row.cycle_meta = {
    ...(row.cycle_meta || {}),
    lastAiredAtMs: now,
    ...(row.cycle_meta?.scoreSig ? { lastAiredScoreSig: row.cycle_meta.scoreSig } : {}),
    lastAiredHeadline: String(row.text_berita || '').trim(),
  };
  lastIncrementByRowKey.set(rowKey, now);

  try {
    fs.writeFileSync(TABLE_FILE_PATH, JSON.stringify(rows, null, 2), 'utf-8');
    memoryTableCache = rows;
    return {
      success: true,
      deduped: false,
      id: row.id,
      poin_tayang: row.poin_tayang,
    };
  } catch {
    return { success: false };
  }
}

