import fs from 'fs';
import path from 'path';

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
      kategori: 'Aktivitas Transfer',
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
      kategori: 'Jadwal Pertandingan',
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
      kategori: 'Pertandingan Langsung',
      sub_kategori: 'Skor Laga & Aksi Lapangan',
      waktu_tayang: ['Live Match'],
    };
  }

  // 4. PEREBUTAN JUARA (4 Kategori Gelar Juara FNB League)
  if (
    t.includes('juara gameweek') ||
    t.includes('juara pekan') ||
    t.includes('gameweek champion') ||
    t.includes('poin tertinggi gameweek') ||
    id.startsWith('champ_gw') ||
    id.startsWith('fb_champ_')
  ) {
    return {
      kategori: 'Perebutan Juara',
      sub_kategori: 'Juara Gameweek',
      waktu_tayang: ['Provisional', 'Confirmed'],
    };
  }

  if (
    t.includes('juara terbanyak') ||
    t.includes('most gw') ||
    t.includes('klausul pelimpahan') ||
    id.startsWith('fb_mg_')
  ) {
    return {
      kategori: 'Perebutan Juara',
      sub_kategori: 'Juara Terbanyak (Most GW)',
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
      kategori: 'Perebutan Juara',
      sub_kategori: 'Puncak Klasemen & Kudeta',
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
      kategori: 'Perebutan Juara',
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
      kategori: 'Perebutan Juara',
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
      kategori: 'What-If & Keputusan Manajer',
      sub_kategori: 'Bangku Cadangan (Bench)',
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
      kategori: 'What-If & Keputusan Manajer',
      sub_kategori: 'Kapten vs Naib Kapten',
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
      kategori: 'What-If & Keputusan Manajer',
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
      kategori: 'What-If & Keputusan Manajer',
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
      kategori: 'Pergerakan Peringkat',
      sub_kategori: 'Lonjakan Peringkat (Top Climber)',
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
      kategori: 'Pergerakan Peringkat',
      sub_kategori: 'Penurunan Peringkat (Faller)',
      waktu_tayang: ['Between Match', 'Provisional', 'Confirmed'],
    };
  }

  if (
    id.startsWith('team_shift_') ||
    t.includes('peringkat sementara') ||
    t.includes('places to rank')
  ) {
    return {
      kategori: 'Pergerakan Peringkat',
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
    if (t.includes('wildcard')) sub = 'Aktivasi Wildcard';
    else if (t.includes('free hit')) sub = 'Aktivasi Free Hit';
    else if (t.includes('triple captain')) sub = 'Aktivasi Triple Captain';
    else if (t.includes('bench boost')) sub = 'Aktivasi Bench Boost';
    else if (t.includes('penalti') || t.includes('hit') || t.includes('deduction')) sub = 'Penalti Minus Hit Transfer';

    return {
      kategori: 'Chips & Transfer Hits',
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
    let sub = 'Pemain Kunci & Pembeda Poin';
    if (t.includes('clean sheet') || t.includes('nirbobol')) sub = 'Clean Sheet Pertahanan';
    else if (t.includes('penyelamatan') || t.includes('saves') || t.includes('tepis penalti')) sub = 'Penyelamatan Kiper';

    return {
      kategori: 'Sorotan Bintang',
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
      kategori: 'Strategi Pra-Pekan',
      sub_kategori: 'Batas Waktu & Tren Transfer',
      waktu_tayang: ['Not started'],
    };
  }

  // Default Fallback
  return {
    kategori: 'Informasi Liga',
    sub_kategori: 'Kabar Umum Pekan',
    waktu_tayang: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
  };
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
  const id = String(raw.id || `story_${Date.now()}`);
  const textId = String(raw.headline_id || raw.text_berita || raw.headline || '').trim();
  const textEn = String(raw.headline_en || raw.text_berita_en || textId).trim();
  const isAi = raw.sumber === 'AI' || (id.startsWith('story_') && !id.startsWith('story_element_'));
  const timestamp = raw.timestamp_produksi || raw.timestamp || new Date().toISOString();
  const gw = Number(raw.gw) || extractGwFromStory(textId, textEn, id, defaultGw);

  const classification = classifyNewsItem(textId, textEn, id);
  const statusTayang = raw.status_tayang || 'Y';
  const keterangan = raw.keterangan_tidak_tayang ?? (statusTayang === 'Y' ? '' : 'Diarsipkan (di luar kuota 1000 rotasi aktif)');

  const teams = Array.isArray(raw.teams) && raw.teams.length > 0 ? raw.teams : extractTags(textId, 'T');
  const players = Array.isArray(raw.players) && raw.players.length > 0 ? raw.players : extractTags(textId, 'P');

  return {
    id,
    timestamp_produksi: timestamp,
    sumber: isAi ? 'AI' : 'Bukan',
    status_tayang: statusTayang,
    keterangan_tidak_tayang: keterangan,
    waktu_tayang: classification.waktu_tayang,
    kategori: classification.kategori,
    sub_kategori: classification.sub_kategori,
    drama_score: Number(raw.drama_score) || 80,
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
    let activeFeedMap = new Map<string, { drama_score: number; headline_id: string; headline_en: string }>();
    let feedGw = 9;

    if (fs.existsSync(FEED_CACHE_PATH)) {
      try {
        const rawFeed = fs.readFileSync(FEED_CACHE_PATH, 'utf-8');
        const parsed = JSON.parse(rawFeed);
        if (parsed && Array.isArray(parsed.data)) {
          feedGw = Number(parsed.gameweek) || 9;
          parsed.data.forEach((s: any) => {
            if (s && s.id) {
              activeFeedMap.set(String(s.id), {
                drama_score: Number(s.drama_score) || 80,
                headline_id: String(s.headline_id || ''),
                headline_en: String(s.headline_en || s.headline_id || ''),
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

    // 3. Process active feed stories first (Status Tayang: Y)
    for (const [id, feedItem] of activeFeedMap.entries()) {
      seenIds.add(id);

      const histMatch = historyList.find((h) => String(h.id) === id);
      const headlineId = feedItem.headline_id || histMatch?.headline_id || '';
      const headlineEn = feedItem.headline_en || histMatch?.headline_en || headlineId;
      const gw = extractGwFromStory(headlineId, headlineEn, id, Number(histMatch?.gw) || feedGw);
      const timestamp = histMatch?.timestamp || new Date().toISOString();

      const teams = Array.isArray(histMatch?.teams) && histMatch.teams.length > 0
        ? histMatch.teams
        : extractTags(headlineId, 'T');

      const players = Array.isArray(histMatch?.players) && histMatch.players.length > 0
        ? histMatch.players
        : extractTags(headlineId, 'P');

      const isAi = id.startsWith('story_') && !id.startsWith('story_element_');
      const classification = classifyNewsItem(headlineId, headlineEn, id);

      tableRows.push({
        id,
        timestamp_produksi: timestamp,
        sumber: isAi ? 'AI' : 'Bukan',
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
        waktu_tayang: classification.waktu_tayang,
        kategori: classification.kategori,
        sub_kategori: classification.sub_kategori,
        drama_score: feedItem.drama_score || 80,
        text_berita: headlineId,
        text_berita_en: headlineEn,
        gw,
        teams,
        players,
      });
    }

    // 4. Process non-airing history stories (Status Tayang: N)
    for (const h of historyList) {
      if (!h || !h.id) continue;
      const id = String(h.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const headlineId = String(h.headline_id || '');
      const headlineEn = String(h.headline_en || headlineId);
      const gw = extractGwFromStory(headlineId, headlineEn, id, Number(h.gw) || feedGw);
      const timestamp = h.timestamp || new Date().toISOString();

      const teams = Array.isArray(h.teams) && h.teams.length > 0
        ? h.teams
        : extractTags(headlineId, 'T');

      const players = Array.isArray(h.players) && h.players.length > 0
        ? h.players
        : extractTags(headlineId, 'P');

      const isAi = id.startsWith('story_') && !id.startsWith('story_element_');
      const classification = classifyNewsItem(headlineId, headlineEn, id);

      // Determine reason for not airing
      let reason = 'Diarsipkan (di luar kuota 1000 rotasi aktif)';
      if (gw < feedGw) {
        reason = `Arsip historis Gameweek ${gw}`;
      } else if (classification.waktu_tayang.length === 1 && classification.waktu_tayang[0] === 'Live Match') {
        reason = 'Pertandingan telah usai (Live Match phase berakhir)';
      }

      tableRows.push({
        id,
        timestamp_produksi: timestamp,
        sumber: isAi ? 'AI' : 'Bukan',
        status_tayang: 'N',
        keterangan_tidak_tayang: reason,
        waktu_tayang: classification.waktu_tayang,
        kategori: classification.kategori,
        sub_kategori: classification.sub_kategori,
        drama_score: Number(h.drama_score) || 75,
        text_berita: headlineId,
        text_berita_en: headlineEn,
        gw,
        teams,
        players,
      });
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
