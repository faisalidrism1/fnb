import fs from 'fs';
import path from 'path';
import { getRegisteredFormulas, calculateDynamicDramaScore } from '../data/newsFormulaRegistry.ts';
import { generatePhase1Stories } from './phase1StoryGenerator.ts';
import { generateStoriesFromPulseMatch } from './pulseMatchStoryGenerator.ts';
import { generateConfirmedStories } from './confirmedStoryGenerator.ts';
import { getPhase1Templates, interpolateExample } from '../data/phase1Templates.ts';

export interface NewsTickerDbRow {
  id: string;
  timestamp_produksi: string; // ISO string
  sumber: 'AI' | 'Sys' | 'Bukan' | string;
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
}

const TABLE_FILE_PATH = path.join(process.cwd(), 'src/data/news_ticker_table.json');
const FEED_CACHE_PATH = path.join(process.cwd(), 'src/data/news_ticker_feed.json');
const HISTORY_CACHE_PATH = path.join(process.cwd(), 'src/data/news_ticker_history.json');

// In-memory cache of the database table for instant sub-millisecond retrieval
let memoryTableCache: NewsTickerDbRow[] | null = null;

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

  // 5. WHAT-IF & KEPUTUSAN MANAJER (Bench, Captaincy, Transfer Karma, Lost Points)
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
      kategori: 'Keputusan Manajer',
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
      kategori: 'Keputusan Manajer',
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
      kategori: 'Keputusan Manajer',
      sub_kategori: 'Transfer Karma',
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
      kategori: 'Keputusan Manajer',
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

let cachedLeagueDataMem: any = null;
let cachedLeagueDataTime = 0;

function getCachedLeagueDataFast(): any {
  const now = Date.now();
  if (cachedLeagueDataMem && now - cachedLeagueDataTime < 5000) {
    return cachedLeagueDataMem;
  }
  try {
    const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');
    if (fs.existsSync(CACHE_PATH)) {
      cachedLeagueDataMem = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      cachedLeagueDataTime = now;
      return cachedLeagueDataMem;
    }
  } catch {}
  return null;
}

export function getCurrentGw(): number {
  const d = getCachedLeagueDataFast();
  if (d && d.current_gw) return Number(d.current_gw);

  try {
    const FEED_PATH = path.join(process.cwd(), 'src/data/news_ticker_feed.json');
    if (fs.existsSync(FEED_PATH)) {
      const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf-8'));
      if (feed && feed.gameweek) return Number(feed.gameweek);
    }
  } catch {}
  return 9;
}

export type GameweekPhase = 'Not started' | 'Live' | 'Provisional' | 'Confirmed';

/**
 * Returns the deterministic Gameweek phase based on RULE[AGENTS_md]
 */
export function getGameweekPhase(targetGw?: number): GameweekPhase {
  try {
    const d = getCachedLeagueDataFast();
    if (!d) return 'Confirmed';
    const currentGw = Number(d.current_gw) || 9;
    const gw = targetGw || currentGw;

    // Past Gameweeks (gw < currentGw) are 100% final and confirmed
    if (gw < currentGw) return 'Confirmed';
    // Future Gameweeks (gw > currentGw) are not started
    if (gw > currentGw) return 'Not started';

    const statusObj = d.gw_status;
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

    // Check fixtures
    const gwFixtures = (d.sync_status?.gw_fixtures || []).filter((f: any) => f.event === gw);
    if (gwFixtures.length > 0) {
      const allUpcoming = gwFixtures.every((f: any) => !f.started);
      if (allUpcoming) return 'Not started';

      const anyLive = gwFixtures.some((f: any) => f.started && !f.finished && !f.finished_provisional);
      if (anyLive) return 'Live';

      const allFinished = gwFixtures.every((f: any) => f.finished || f.finished_provisional);
      if (allFinished) {
        if (isDataChecked && isLeaguesUpdated) return 'Confirmed';
        return 'Provisional';
      }
      return 'Live';
    }

    if (statusStr === 'Provisional') return 'Provisional';
    if (statusStr === 'Live' || d.sync_status?.is_matchday_live) return 'Live';

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

    if (/Juara\s+Gameweek\s+\[N:\d+\]/i.test(id) && !/\bresmi\b/i.test(id)) {
      id = id.replace(/(Juara\s+Gameweek\s+\[N:\d+\])/gi, 'resmi sebagai $1 (hasil resmi)');
    }
  } else if (phase === 'Live' || phase === 'Provisional') {
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

    if (id.includes('posisi puncak klasemen') && !id.includes('posisi puncak klasemen sementara')) {
      id = id.replace(/posisi puncak klasemen/gi, 'posisi puncak klasemen sementara');
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
    if (/ke\s+posisi\s+\[N:\d+\]\s+klasemen\./i.test(id) && !id.includes('sementara')) {
      id = id.replace(/ke\s+posisi\s+(\[N:\d+\])\s+klasemen\./gi, 'ke posisi $1 klasemen sementara.');
    }
  }

  return { headlineId: id, headlineEn: en };
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
    sumber?: 'AI' | 'Sys' | 'Bukan' | string;
    status_tayang?: 'Y' | 'N';
    keterangan_tidak_tayang?: string;
    kategori?: string;
    sub_kategori?: string;
    fase?: string;
    waktu_tayang?: string[];
    gw?: number;
    teams?: string[];
    players?: string[];
  },
  defaultGw = 9,
  currentActivePhase?: string
): NewsTickerDbRow[] {
  const currentActiveGw = getCurrentGw();
  const rawId = String(raw.id || `story_${Date.now()}`);
  const baseId = rawId.split('__')[0];
  let textId = String(raw.headline_id || raw.text_berita || raw.headline || '').trim();
  let textEn = String(raw.headline_en || raw.text_berita_en || textId).trim();

  // Strip unnecessary word "chip" directly preceding [N:{chip}] per FPL convention
  textId = textId.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1');
  textEn = textEn.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1').replace(/(\[N:[^\]]+\])\s+chip\b/gi, '$1');

  // Identifikasi apakah berasal dari Template di Tabel Editor (P1_... dan LM_... atau sumber: 'Sys')
  const isEditorTemplate =
    baseId.startsWith('P1_') ||
    baseId.startsWith('p1_') ||
    baseId.startsWith('LM_') ||
    baseId.startsWith('lm_') ||
    raw.sumber === 'Sys';

  const isAi = raw.sumber === 'AI' || (baseId.startsWith('story_') && !baseId.startsWith('story_element_'));
  const resolvedSumber = isEditorTemplate ? 'Sys' : (raw.sumber ? raw.sumber : (isAi ? 'AI' : 'Bukan'));
  const timestamp = raw.timestamp_produksi || raw.timestamp || new Date().toISOString();
  const gw = extractGwFromStory(textId, textEn, baseId, Number(raw.gw) || defaultGw);
  const resolvedActivePhase = currentActivePhase || getGameweekPhase(gw);

  const fallbackClass = classifyNewsItem(textId, textEn, baseId);
  const kategori = raw.kategori || fallbackClass.kategori;
  const sub_kategori = raw.sub_kategori || fallbackClass.sub_kategori;

  // Dynamic drama score
  const registeredFormulas = getRegisteredFormulas();
  const matchedFormula = registeredFormulas.find(
    (f) =>
      (f.kategori === kategori && f.sub_kategori === sub_kategori) ||
      f.kategori === kategori
  );

  let dramaScore = Number(raw.drama_score);
  if (!dramaScore || dramaScore === 80) {
    if (matchedFormula) {
      let metricVal = matchedFormula.drama_config.metric_default ?? 5;
      const numMatch = textId.match(/\[N:([+-]?\d+)[^\]]*\]/);
      if (numMatch) {
        const parsed = Math.abs(parseInt(numMatch[1], 10));
        if (!isNaN(parsed)) {
          if (matchedFormula.id === 'SYS_CHAMP_GW') {
            metricVal = Math.max(0, parsed - 70);
          } else {
            metricVal = parsed;
          }
        }
      }
      dramaScore = calculateDynamicDramaScore(matchedFormula.drama_config, metricVal);
    } else {
      dramaScore = 80;
    }
  }

  const teams = Array.isArray(raw.teams) && raw.teams.length > 0 ? raw.teams : extractTags(textId, 'T');
  const players = Array.isArray(raw.players) && raw.players.length > 0 ? raw.players : extractTags(textId, 'P');

  // ATURAN BAKU: Semua berita yg diproduksi SELAIN dari template di tabel editor, metadata phase nya dikosongkan.
  if (!isEditorTemplate) {
    // Berita non-editor tidak memiliki fase terdefinisi (fase: ''), sehingga status_tayang dikunci ke 'N'
    // agar tidak muncul pada running news ticker fase aktif manapun
    const statusTayang = 'N';
    const keterangan = 'Bukan hasil produksi template editor (fase tidak terdefinisi)';

    return [{
      id: baseId,
      timestamp_produksi: timestamp,
      sumber: resolvedSumber,
      status_tayang: statusTayang,
      keterangan_tidak_tayang: keterangan,
      fase: '',
      waktu_tayang: [],
      kategori,
      sub_kategori,
      drama_score: dramaScore,
      poin_tayang: Math.max(0, Number(raw.poin_tayang) || 0),
      text_berita: textId,
      text_berita_en: textEn,
      gw,
      teams,
      players,
    }];
  }

  // KHUSUS TEMPLATE DI TABEL EDITOR: Gunakan fase & waktu tayang sesuai konfigurasi template
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
  const hasPointsOrRank = mentionsPointsOrRank(textId) || mentionsPointsOrRank(textEn);

  // Generate 1 distinct row per allowed phase
  return uniquePhases.map((targetPhase) => {
    const rowId = uniquePhases.length > 1
      ? `${baseId}__${phaseToSlug(targetPhase)}`
      : baseId;

    // Apply status perspective per phase
    let phaseTextId = textId;
    let phaseTextEn = textEn;
    if (hasPointsOrRank) {
      const phaseEnum: GameweekPhase = targetPhase === 'Confirmed'
        ? 'Confirmed'
        : (targetPhase === 'Live Match' ? 'Live' : (targetPhase === 'Not started' ? 'Not started' : 'Provisional'));
      const formatted = formatPointsAndRankStatus(phaseTextId, phaseTextEn, phaseEnum);
      phaseTextId = formatted.headlineId;
      phaseTextEn = formatted.headlineEn;
    }

    // Determine status_tayang & keterangan
    let statusTayang: 'Y' | 'N';
    let keterangan: string;

    if (gw !== currentActiveGw) {
      statusTayang = 'N';
      keterangan = raw.keterangan_tidak_tayang || `Bukan Gameweek aktif (Arsip Gameweek ${gw})`;
    } else if (!isPhaseActive(targetPhase, resolvedActivePhase)) {
      statusTayang = 'N';
      keterangan = `Fase saat ini (${resolvedActivePhase}) bukan ${targetPhase}`;
    } else {
      // Current Gameweek and matching current phase!
      if (isPhaseActive('Live Match', resolvedActivePhase)) {
        if (isAi) {
          statusTayang = 'N';
          keterangan = 'Hanya berita produksi Editor yang ditayangkan pada fase Live Match';
        } else {
          statusTayang = 'Y';
          keterangan = '';
        }
      } else if (isPhaseActive('Not started', resolvedActivePhase) && hasPointsOrRank) {
        statusTayang = 'N';
        keterangan = 'Poin dan peringkat belum berjalan pada fase Not started (jangan tampilkan saat not started)';
      } else {
        statusTayang = raw.status_tayang || 'Y';
        keterangan = raw.keterangan_tidak_tayang ?? (statusTayang === 'Y' ? '' : 'Diarsipkan (di luar kuota 1000 rotasi aktif)');
      }
    }

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
 * Rebuilds and synchronizes the news ticker database table in the container.
 * Scans both active feed (news_ticker_feed.json) and history cache (news_ticker_history.json).
 * Produces separate rows per phase for multi-phase news.
 */
export function rebuildNewsTickerTable(phaseOverride?: string): NewsTickerDbRow[] {
  try {
    const tableRows: NewsTickerDbRow[] = [];
    const seenIds = new Set<string>();

    // 0. Load existing table records to preserve poin_tayang and prevent overwrite resets
    const existingTableMap = new Map<string, NewsTickerDbRow>();
    if (fs.existsSync(TABLE_FILE_PATH)) {
      try {
        const rawExisting = fs.readFileSync(TABLE_FILE_PATH, 'utf-8');
        const parsedExisting = JSON.parse(rawExisting);
        if (Array.isArray(parsedExisting)) {
          parsedExisting.forEach((r: NewsTickerDbRow) => {
            if (r && r.id) existingTableMap.set(String(r.id), r);
          });
        }
      } catch {}
    }

    // Hitung baseline poin_tayang minimum dari berita aktif yang sudah ada
    // (Mencegah "Starvation" / monopoli nilai 0 saat berita baru lahir)
    let baselinePoinTayang = 0;
    const activeExistingPoints: number[] = [];
    for (const r of existingTableMap.values()) {
      if (r.status_tayang === 'Y' && r.poin_tayang > 0) {
        activeExistingPoints.push(r.poin_tayang);
      }
    }
    if (activeExistingPoints.length > 0) {
      baselinePoinTayang = Math.min(...activeExistingPoints);
    }

    const feedGw = getCurrentGw();
    const currentActivePhase = phaseOverride || getGameweekPhase(feedGw);

    // Helper to safely add rows while restoring poin_tayang
    const addRows = (rows: NewsTickerDbRow[]) => {
      for (const r of rows) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          const baseId = r.id.split('__')[0];
          const existing = existingTableMap.get(r.id) || existingTableMap.get(baseId);
          if (existing && existing.poin_tayang !== undefined) {
            r.poin_tayang = existing.poin_tayang;
          } else if (r.status_tayang === 'Y' && baselinePoinTayang > 0 && r.poin_tayang === 0) {
            r.poin_tayang = baselinePoinTayang;
          }
          tableRows.push(r);
        }
      }
    };

    // 1. Read active feed
    let activeFeedMap = new Map<string, any>();
    if (fs.existsSync(FEED_CACHE_PATH)) {
      try {
        const rawFeed = fs.readFileSync(FEED_CACHE_PATH, 'utf-8');
        const parsed = JSON.parse(rawFeed);
        if (parsed && Array.isArray(parsed.data)) {
          parsed.data.forEach((s: any) => {
            if (s && s.id) {
              activeFeedMap.set(String(s.id), s);
            }
          });
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning reading feed cache:', err.message);
      }
    }

    // 2. Read history cache
    let historyList: any[] = [];
    if (fs.existsSync(HISTORY_CACHE_PATH)) {
      try {
        const rawHist = fs.readFileSync(HISTORY_CACHE_PATH, 'utf-8');
        const parsedHist = JSON.parse(rawHist);
        if (Array.isArray(parsedHist)) {
          historyList = parsedHist;
        }
      } catch (err: any) {
        console.warn('[News Table Service] Warning reading history cache:', err.message);
      }
    }

    // 3. First Priority: Produce stories directly from matching Editor templates (Phase 1 & Live Match)
    // Inherit metadata from editor table (id, gw_phase, category, subcategory, template)
    // Pair with produced metadata (GW, TIMESTAMP, SOURCE)

    // 3a. Inject Phase 1 template stories for the active Gameweek
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
      console.warn('[News Table Service] Warning generating Phase 1 stories:', err.message);
    }

    // 3b. Inject Live Match template stories produced from Editor templates (No. 17-29)
    // Supports MULTI-MATCH: scans all running matches in src/data/pulse_match_*.json
    try {
      const dataDir = path.join(process.cwd(), 'src/data');
      if (fs.existsSync(dataDir)) {
        const matchFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('pulse_match_') && f.endsWith('.json'));
        for (const file of matchFiles) {
          try {
            const pulseFile = path.join(dataDir, file);
            const pulseData = JSON.parse(fs.readFileSync(pulseFile, 'utf-8'));
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
            console.warn(`[News Table Service] Warning reading match file ${file}:`, fileErr.message);
          }
        }
      }
    } catch (err: any) {
      console.warn('[News Table Service] Warning generating Live Match stories:', err.message);
    }

    // 3c. Inject Confirmed template stories produced from Editor templates (No. 54-63)
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

    // 4. Process remaining active feed stories using createStoryRecordsForPhases
    for (const [id, feedItem] of activeFeedMap.entries()) {
      const baseId = id.split('__')[0];
      const histMatch = historyList.find((h) => String(h.id) === id || String(h.id) === baseId);
      const headlineId = feedItem.headline_id || histMatch?.headline_id || '';
      const headlineEn = feedItem.headline_en || histMatch?.headline_en || headlineId;
      const gw = extractGwFromStory(headlineId, headlineEn, id, Number(histMatch?.gw) || Number(feedItem.gw) || feedGw);
      const timestamp = histMatch?.timestamp || new Date().toISOString();

      const records = createStoryRecordsForPhases({
        id: baseId,
        headline_id: headlineId,
        headline_en: headlineEn,
        timestamp_produksi: timestamp,
        sumber: feedItem.sumber || ((baseId.startsWith('story_') && !baseId.startsWith('story_element_')) ? 'AI' : 'Bukan'),
        gw,
        teams: histMatch?.teams || feedItem.teams,
        players: histMatch?.players || feedItem.players,
        drama_score: feedItem.drama_score || 80,
        kategori: feedItem.kategori,
        sub_kategori: feedItem.sub_kategori,
        fase: feedItem.fase,
        waktu_tayang: feedItem.waktu_tayang,
      }, gw, currentActivePhase);
      addRows(records);
    }

    // 5. Process remaining non-airing history stories (Status Tayang: N)
    for (const h of historyList) {
      if (!h || !h.id) continue;
      const baseId = String(h.id).split('__')[0];
      const headlineId = String(h.headline_id || '');
      const headlineEn = String(h.headline_en || headlineId);
      const gw = Number(h.gw) || extractGwFromStory(headlineId, headlineEn, baseId, feedGw);
      const timestamp = h.timestamp || new Date().toISOString();

      const records = createStoryRecordsForPhases({
        id: baseId,
        headline_id: headlineId,
        headline_en: headlineEn,
        timestamp_produksi: timestamp,
        sumber: (baseId.startsWith('story_') && !baseId.startsWith('story_element_')) ? 'AI' : 'Bukan',
        gw,
        teams: h.teams,
        players: h.players,
        drama_score: Number(h.drama_score) || 75,
        kategori: h.kategori,
        sub_kategori: h.sub_kategori,
        fase: h.fase,
        waktu_tayang: h.waktu_tayang,
        status_tayang: 'N',
        keterangan_tidak_tayang: gw !== feedGw ? `Bukan Gameweek aktif (Arsip Gameweek ${gw})` : 'Diarsipkan (di luar kuota 1000 rotasi aktif)',
      }, gw, currentActivePhase);
      addRows(records);
    }

    // Sort by: status_tayang 'Y' first, then timestamp descending
    tableRows.sort((a, b) => {
      if (a.status_tayang !== b.status_tayang) {
        return a.status_tayang === 'Y' ? -1 : 1;
      }
      return new Date(b.timestamp_produksi).getTime() - new Date(a.timestamp_produksi).getTime();
    });


    // Save to container file
    fs.writeFileSync(TABLE_FILE_PATH, JSON.stringify(tableRows, null, 2), 'utf-8');
    memoryTableCache = tableRows;
    console.log(`[News Table Service] Successfully synchronized container news table with ${tableRows.length} rows.`);

    return tableRows;
  } catch (err: any) {
    console.error('[News Table Service] Error rebuilding news ticker table:', err.message);
    return memoryTableCache || [];
  }
}

/**
 * Returns all news rows from memory or disk
 */
export function getNewsTickerTable(forceRefresh = false): NewsTickerDbRow[] {
  if (!forceRefresh && memoryTableCache && memoryTableCache.length > 0) {
    return memoryTableCache;
  }

  if (!forceRefresh && fs.existsSync(TABLE_FILE_PATH)) {
    try {
      const raw = fs.readFileSync(TABLE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryTableCache = parsed;
        return parsed;
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
  const allRows = getNewsTickerTable();

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
 * Increments poin_tayang by +1 when a news item enters the ticker queue per RULE[AGENTS_md]
 */
export function incrementPoinTayang(id: string): boolean {
  const rows = getNewsTickerTable();
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  row.poin_tayang = (row.poin_tayang || 0) + 1;
  try {
    fs.writeFileSync(TABLE_FILE_PATH, JSON.stringify(rows, null, 2), 'utf-8');
    memoryTableCache = rows;
    return true;
  } catch {
    return false;
  }
}

