import fs from 'fs';
import path from 'path';
import { generatePhase1Stories } from './notStartedStoryGenerator.ts';
import { generateStoriesFromPulseMatch, generateLiveMatchStatStories, generateLiveTeamRankShiftStories, generateLiveMatchScoreStories, generateLiveLineupSurpriseStories, generateLiveTitleRaceStories } from './liveMatchStoryGenerator.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import { generateConfirmedStories } from './confirmedStoryGenerator.ts';
import { generateBetweenMatchStories } from './betweenMatchStoryGenerator.ts';
import { generateProvisionalStories } from './provisionalStoryGenerator.ts';
import { getPhase1Templates } from '../data/phase1Templates.ts';
import { getOptimalDatabase } from './db.ts';
import { checkLiveBetweenMatchPhase, isMatchCardRunning } from './liveBetweenMatchChecker.ts';
import { loadPulseMatchesForGw } from './pulseMatchSync.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import {
  resolveParentTemplateId,
  CycleMeta,
  LM_FALLBACK_NS_TEMPLATE_IDS,
} from './waveCycleScheduler.ts';
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

// Short-lived cache of Editor template IDs from TabAdminEditor (src/data/phase1Templates.ts)
let cachedEditorIds: { ids: Set<string>; loadedAt: number } | null = null;

function getEditorTemplateIdSet(): Set<string> {
  const now = Date.now();
  if (cachedEditorIds && now - cachedEditorIds.loadedAt < 2000) {
    return cachedEditorIds.ids;
  }
  const templates = getPhase1Templates();
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
  const db = getOptimalDatabase();
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
    const db = options?.dbOverride || getOptimalDatabase();
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
 * Backward-compatible helper to produce a single story record
 */
export function createCompleteStoryRecord(
  raw: any,
  defaultGw = 9,
  currentActivePhase?: string
): NewsTickerDbRow {
  const records = createStoryRecordsForPhases(raw, defaultGw, currentActivePhase);
  return records[0];
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
 * purely from Editor Table templates (src/data/phase1_templates.json).
 */
export function rebuildNewsTickerTable(
  phaseOverride?: string,
  options?: { clearExisting?: boolean }
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

    const db = getOptimalDatabase();
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
            if (existing.text_berita === r.text_berita && existing.timestamp_produksi) {
              r.timestamp_produksi = existing.timestamp_produksi;
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
        const p1Stories = generatePhase1Stories(feedGw);
        for (const p1 of p1Stories) {
          const records = createStoryRecordsForPhases({
            ...p1,
            sumber: (p1.sumber as any) || 'Sys',
            gw: p1.gw || feedGw,
          }, p1.gw || feedGw, currentActivePhase);
          addRows(records);
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning generating Not started stories:', err.message);
      }
    } else if (isPhaseActive('Live Match', currentActivePhase)) {
      // 3b. Live Match (LM_*) — KHUSUS FASE LM HARUS LIVE NEWSNYA:
      // Only process matches that are genuinely LIVE right now (exclude finished 'C' / FT and upcoming 'U' matches).
      try {
        const cachedMatches = getCachedMatchesForGw(feedGw);
        const pulseMatches = loadPulseMatchesForGw(feedGw).filter((pulseData) =>
          isPulseMatchCurrentlyLive(pulseData, cachedMatches)
        );

        for (const pulseData of pulseMatches) {
          try {
            const liveStories = generateStoriesFromPulseMatch(pulseData, feedGw);
            for (const ls of liveStories) {
              const records = createStoryRecordsForPhases({
                ...ls,
                sumber: (ls.sumber as any) || 'Sys',
                gw: ls.gw || feedGw,
              }, ls.gw || feedGw, currentActivePhase);
              addRows(records);
            }
          } catch (fileErr: any) {
            console.warn(`[News Table Service] Warning reading live Pulse match ${pulseData?.id}:`, fileErr.message);
          }
        }

        if (cachedMatches && cachedMatches.length > 0) {
          const liveStatStories = generateLiveMatchStatStories(feedGw, {
            includeFinished: false,
            matchesOverride: cachedMatches,
          });
          for (const ls of liveStatStories) {
            const records = createStoryRecordsForPhases({
              ...ls,
              sumber: (ls.sumber as any) || 'Sys',
              gw: ls.gw || feedGw,
            }, ls.gw || feedGw, currentActivePhase);
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
              gw: ls.gw || feedGw,
            }, ls.gw || feedGw, currentActivePhase);
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
              gw: ls.gw || feedGw,
            }, ls.gw || feedGw, currentActivePhase);
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
              gw: ls.gw || feedGw,
            }, ls.gw || feedGw, currentActivePhase);
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
              gw: ls.gw || feedGw,
            }, ls.gw || feedGw, currentActivePhase);
            addRows(records);
          }
        }

        // Also register the 12 post-deadline locked NS_* fallback items for quiet Live Match periods
        try {
          const fallbackNsStories = generatePhase1Stories(feedGw).filter((p1) =>
            LM_FALLBACK_NS_TEMPLATE_IDS.has(p1.id)
          );
          for (const fb of fallbackNsStories) {
            const records = createStoryRecordsForPhases({
              ...fb,
              sumber: (fb.sumber as any) || 'Sys',
              gw: fb.gw || feedGw,
              waktu_tayang: ['Live Match'],
              fase: 'Live Match',
              cycle_meta: {
                ...(fb.cycle_meta || {}),
                isLmFallback: true,
              },
            }, fb.gw || feedGw, currentActivePhase);
            addRows(records);
          }
        } catch (fbErr: any) {
          console.warn('[News Table Service] Warning generating LM NS fallback stories:', fbErr.message);
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
            gw: bm.gw || feedGw,
          }, bm.gw || feedGw, currentActivePhase);
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
            gw: pv.gw || feedGw,
          }, pv.gw || feedGw, currentActivePhase);
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
            gw: cs.gw || feedGw,
          }, cs.gw || feedGw, currentActivePhase);
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

