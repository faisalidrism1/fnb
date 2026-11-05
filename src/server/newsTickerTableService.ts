import fs from 'fs';
import path from 'path';
import { getRegisteredFormulas, calculateDynamicDramaScore } from '../data/newsFormulaRegistry.ts';
import { generatePhase1Stories } from './phase1StoryGenerator.ts';

export interface NewsTickerDbRow {
  id: string;
  timestamp_produksi: string; // ISO string
  sumber: 'AI' | 'Bukan';
  status_tayang: 'Y' | 'N';
  keterangan_tidak_tayang: string; // empty string if status_tayang === 'Y'
  waktu_tayang: string[]; // e.g. ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed']
  kategori: string;
  sub_kategori: string;
  drama_score: number;
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

  // 3. PERTANDINGAN LANGSUNG (Live Match Score)
  if (
    id.startsWith('live_score_') ||
    t.includes('sedang berlangsung') ||
    t.includes('babak pertama') ||
    t.includes('babak kedua') ||
    t.includes('(menit') ||
    t.includes('menit ke-')
  ) {
    return {
      kategori: 'Pemain & Match',
      sub_kategori: 'Skor Laga',
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
 * Creates a complete news story record containing all database fields right at production time.
 */
export function createCompleteStoryRecord(
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
): NewsTickerDbRow {
  const currentActiveGw = getCurrentGw();
  const id = String(raw.id || `story_${Date.now()}`);
  let textId = String(raw.headline_id || raw.text_berita || raw.headline || '').trim();
  let textEn = String(raw.headline_en || raw.text_berita_en || textId).trim();

  // Strip unnecessary word "chip" directly preceding [N:{chip}] per FPL convention
  textId = textId.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1');
  textEn = textEn.replace(/\bchip\s+(\[N:[^\]]+\])/gi, '$1').replace(/(\[N:[^\]]+\])\s+chip\b/gi, '$1');

  const isAi = raw.sumber === 'AI' || (id.startsWith('story_') && !id.startsWith('story_element_'));
  const timestamp = raw.timestamp_produksi || raw.timestamp || new Date().toISOString();
  const gw = extractGwFromStory(textId, textEn, id, Number(raw.gw) || defaultGw);

  const gwPhase = id.startsWith('confirmed_') ? 'Confirmed' : getGameweekPhase(gw);
  const hasPointsOrRank = mentionsPointsOrRank(textId) || mentionsPointsOrRank(textEn);

  // Apply status perspective formatting for points and rank:
  // Confirmed -> Hasil Resmi | Live / Provisional -> Hasil Sementara
  if (hasPointsOrRank) {
    const formatted = formatPointsAndRankStatus(textId, textEn, gwPhase);
    textId = formatted.headlineId;
    textEn = formatted.headlineEn;
  }

  const fallbackClass = classifyNewsItem(textId, textEn, id);
  const classification = {
    kategori: (raw as any).kategori || fallbackClass.kategori,
    sub_kategori: (raw as any).sub_kategori || fallbackClass.sub_kategori,
    waktu_tayang: (raw as any).waktu_tayang || fallbackClass.waktu_tayang,
  };

  // ATURAN STATUS & TAYANG:
  // 1. GW selain Current GW statusnya N
  // 2. Saat menyebutkan poin dan rank, deteksi status GW: JANGAN PERNAH tampilkan news tersebut saat 'Not started'!
  let statusTayang: 'Y' | 'N';
  let keterangan: string;

  if (gw !== currentActiveGw) {
    statusTayang = 'N';
    keterangan = raw.keterangan_tidak_tayang || `Bukan Gameweek aktif (Arsip Gameweek ${gw})`;
  } else if (gwPhase === 'Not started' && hasPointsOrRank) {
    statusTayang = 'N';
    keterangan = 'Poin dan peringkat belum berjalan pada fase Not started (jangan tampilkan saat not started)';
  } else {
    statusTayang = raw.status_tayang || 'Y';
    keterangan = raw.keterangan_tidak_tayang ?? (statusTayang === 'Y' ? '' : 'Diarsipkan (di luar kuota 1000 rotasi aktif)');
  }

  const teams = Array.isArray(raw.teams) && raw.teams.length > 0 ? raw.teams : extractTags(textId, 'T');
  const players = Array.isArray(raw.players) && raw.players.length > 0 ? raw.players : extractTags(textId, 'P');

  // Resolve formula from registry for dynamic drama score calculation & configured airing phases
  const registeredFormulas = getRegisteredFormulas();
  const matchedFormula = registeredFormulas.find(
    (f) =>
      (f.kategori === classification.kategori && f.sub_kategori === classification.sub_kategori) ||
      f.kategori === classification.kategori
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

  // Use configured allowed phases from formula registry if available
  const waktuTayang = matchedFormula && Array.isArray(matchedFormula.allowed_phases) && matchedFormula.allowed_phases.length > 0
    ? matchedFormula.allowed_phases
    : classification.waktu_tayang;

  return {
    id,
    timestamp_produksi: timestamp,
    sumber: isAi ? 'AI' : 'Bukan',
    status_tayang: statusTayang,
    keterangan_tidak_tayang: keterangan,
    waktu_tayang: waktuTayang,
    kategori: classification.kategori,
    sub_kategori: classification.sub_kategori,
    drama_score: dramaScore,
    text_berita: textId,
    text_berita_en: textEn,
    gw,
    teams,
    players,
  };
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
 */
export function rebuildNewsTickerTable(): NewsTickerDbRow[] {
  try {
    const tableRows: NewsTickerDbRow[] = [];
    const seenIds = new Set<string>();

    // 1. Read active feed
    let activeFeedMap = new Map<string, { drama_score: number; headline_id: string; headline_en: string; gw?: number }>();
    let feedGw = getCurrentGw();

    if (fs.existsSync(FEED_CACHE_PATH)) {
      try {
        const rawFeed = fs.readFileSync(FEED_CACHE_PATH, 'utf-8');
        const parsed = JSON.parse(rawFeed);
        if (parsed && Array.isArray(parsed.data)) {
          feedGw = Number(parsed.gameweek) || feedGw;
          parsed.data.forEach((s: any) => {
            if (s && s.id) {
              activeFeedMap.set(String(s.id), {
                drama_score: Number(s.drama_score) || 80,
                headline_id: String(s.headline_id || ''),
                headline_en: String(s.headline_en || s.headline_id || ''),
                gw: Number(s.gw) || undefined,
              });
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

    // 3. Process active feed stories using createCompleteStoryRecord
    for (const [id, feedItem] of activeFeedMap.entries()) {
      seenIds.add(id);

      const histMatch = historyList.find((h) => String(h.id) === id);
      const headlineId = feedItem.headline_id || histMatch?.headline_id || '';
      const headlineEn = feedItem.headline_en || histMatch?.headline_en || headlineId;
      const gw = extractGwFromStory(headlineId, headlineEn, id, Number(histMatch?.gw) || Number(feedItem.gw) || feedGw);
      const timestamp = histMatch?.timestamp || new Date().toISOString();

      const record = createCompleteStoryRecord({
        id,
        headline_id: headlineId,
        headline_en: headlineEn,
        timestamp_produksi: timestamp,
        sumber: (id.startsWith('story_') && !id.startsWith('story_element_')) ? 'AI' : 'Bukan',
        gw,
        teams: histMatch?.teams,
        players: histMatch?.players,
        drama_score: feedItem.drama_score || 80,
        status_tayang: (gw === feedGw) ? 'Y' : 'N',
      }, gw);

      tableRows.push(record);
    }

    // 4. Process non-airing history stories (Status Tayang: N) using createCompleteStoryRecord
    for (const h of historyList) {
      if (!h || !h.id) continue;
      const id = String(h.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const headlineId = String(h.headline_id || '');
      const headlineEn = String(h.headline_en || headlineId);
      const gw = Number(h.gw) || extractGwFromStory(headlineId, headlineEn, id, feedGw);
      const timestamp = h.timestamp || new Date().toISOString();

      const record = createCompleteStoryRecord({
        id,
        headline_id: headlineId,
        headline_en: headlineEn,
        timestamp_produksi: timestamp,
        sumber: (id.startsWith('story_') && !id.startsWith('story_element_')) ? 'AI' : 'Bukan',
        gw,
        teams: h.teams,
        players: h.players,
        drama_score: Number(h.drama_score) || 75,
        status_tayang: 'N',
        keterangan_tidak_tayang: gw !== feedGw ? `Bukan Gameweek aktif (Arsip Gameweek ${gw})` : 'Diarsipkan (di luar kuota 1000 rotasi aktif)',
      }, gw);

      tableRows.push(record);
    }

    // 5. Inject all 13 Phase 1 template stories for the active Gameweek
    try {
      const p1Stories = generatePhase1Stories(feedGw);
      for (const p1 of p1Stories) {
        if (!seenIds.has(p1.id)) {
          seenIds.add(p1.id);
          const p1Record = createCompleteStoryRecord({
            id: p1.id,
            headline_id: p1.headline_id,
            headline_en: p1.headline_en,
            timestamp_produksi: new Date().toISOString(),
            sumber: 'Bukan',
            gw: p1.gw,
            teams: p1.teams,
            players: p1.players,
            drama_score: p1.drama_score,
            status_tayang: p1.status_tayang,
            keterangan_tidak_tayang: p1.keterangan_tidak_tayang,
            kategori: p1.kategori,
            sub_kategori: p1.sub_kategori,
            waktu_tayang: p1.waktu_tayang,
          } as any, p1.gw);
          tableRows.push(p1Record);
        }
      }
    } catch (err: any) {
      console.warn('[News Table Service] Warning generating Phase 1 stories:', err.message);
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

  // 4. Filter by waktu tayang
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
