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

export interface NewsTickerStory {
  id: string;
  headline_id: string;
  headline_en: string;
  drama_score: number;
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

// In-memory microcache for instant (< 1 ms) API response
let memoryFeedCache: NewsTickerFeedResponse | null = null;
let lastProcessedDataHash = '';

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

  // Strip title prefix (e.g. "Judul Berita: Isi...")
  const colonIdx = cleaned.indexOf(': ');
  if (colonIdx !== -1) {
    const prefix = cleaned.substring(0, colonIdx);
    const openBrackets = (prefix.match(/\[/g) || []).length;
    const closeBrackets = (prefix.match(/\]/g) || []).length;
    if (openBrackets === closeBrackets) {
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

  // Ensure trailing punctuation is not exclamation
  cleaned = cleaned.replace(/\s*!+$/g, '.');

  return cleaned.trim();
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
 * Generates news ticker stories using Google Gemini AI
 */
export async function generateNewsTickerFeed(force = false): Promise<NewsTickerFeedResponse> {
  const payload = buildRawMatchdayPayload();
  const currentHash = computeStateHash(payload);

  // Return cached result if data hasn't changed and not forced
  if (!force && memoryFeedCache && memoryFeedCache.data.length > 0) {
    if (lastProcessedDataHash === '' || lastProcessedDataHash === currentHash) {
      lastProcessedDataHash = currentHash;
      return memoryFeedCache;
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini News Service] GEMINI_API_KEY is not set. Returning cached or fallback feed.');
    if (memoryFeedCache) return memoryFeedCache;
    throw new Error('GEMINI_API_KEY is required to generate fresh autonomous news stories.');
  }

  const ai = new GoogleGenAI({ apiKey });

  // Extract entities from previous cache to avoid repetition across runs
  const cachedEntities = extractEntitiesFromFeed(memoryFeedCache);

  const systemInstruction = `Anda adalah Redaktur Utama & Jurnalis Olahraga Investigatif Resmi untuk liga fantasi "FPL Nusantara BERHADIAH" (FNB League).

${FPL_OFFICIAL_RULES_TEXT}

### 4 KATEGORI JUARA FNB LEAGUE (TUJUAN AKHIR SELURUH TIM LIGA):
1. Peringkat 1 Klasemen (Rank 1): Juara Utama Akumulasi Poin Musim.
2. Peringkat 2 Klasemen (Rank 2): Runner-up Utama Liga.
3. Juara Terbanyak (Most GW Champion): Kolektor kemenangan pekan terbanyak (dengan klausul pelimpahan resmi: jika pemegang memuncaki Rank 1 atau 2, status pemenang dilimpahkan ke peringkat berikutnya pada tabel Most GW).
4. Juara Gameweek (GW Champion): Top scorer peraih poin pekan ini tertinggi di liga.

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
     c. Dimensi Transfer: Tim kehilangan potensi poin karena keputusan menjual pemain tertentu dan menggantinya dengan pemain baru yang hanya mendapat perolehan poin lebih rendah.
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

8. RELASI NAMA PEMAIN DAN KLUB:
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

9. STRUKTUR & PANTANGAN PENULISAN:
   - Kalimat berita langsung menyajikan substansi informasi tanpa menambahkan kata pengantar, label kategori, atau judul berita di bagian awal.
   - Gaya penulisan menggunakan tanda titik (.) sebagai penutup dan melarang keras penggunaan tanda seru (!).
   - Penyebutan selisih angka hasil kalkulasi alternatif hanya menggunakan kata 'poin' atau 'tambahan poin' di mana nilai numeriknya telah mencerminkan hasil bersih tanpa menyertakan kata 'bersih'.
   - Hasilkan 8 hingga 12 headline berita dwibahasa simultan dalam format JSON array valid.`;

  const userPrompt = `Berikut adalah data mentah lengkap GW ${payload.gameweek} FNB League beserta tabel What-If Opportunities dan Data Historis Peringkat Klasemen yang telah dihitung secara presisi:
${JSON.stringify({
  gameweek: payload.gameweek,
  nextGameweek: payload.nextGameweek,
  gameweekPhase: payload.gameweekPhase,
  phaseDescription: payload.phaseDescription,
  leagueStats: payload.leagueStats,
  championshipStatus: payload.championshipStatus,
  standingsHistoricalContext: payload.standingsHistoricalContext,
  whatIfOpportunities: payload.whatIfOpportunities,
  transfersIn: payload.transfersIn,
  transfersOut: payload.transfersOut,
  chipsActive: payload.chipsActive,
  topStandings: payload.standingsTable.slice(0, 20),
  standingsMovers: payload.standingsTable.filter((s) => Math.abs(s.rankChange) >= 5),
  activePlayersTable: payload.activePlayersTable.slice(0, 30),
})}

PANDUAN EKSEKUSI JURNALISTIK:
1. Pahami konteks pergerakan klasemen secara historis dengan membandingkan peringkat pekan sebelumnya ('lastRank') terhadap peringkat pekan berjalan ('rank') untuk menangkap dinamika perubahan posisi yang nyata.
2. Evaluasi tingkat drama secara objektif berdasarkan kombinasi nilai angka relatif dan dampak keputusan manajerial terhadap perburuan 4 gelar juara.
3. Terapkan diversifikasi ketat: Setiap entitas [P:Pemain] dan [T:Tim] hanya muncul maksimal 1 kali dalam seluruh batch berita.
4. Skenario keputusan alternatif (what-if) WAJIB disajikan dari sudut pandang fakta riil: Tim kehilangan potensi sejumlah poin karena mencadangkan pemain, mengkaptenkan pemain, atau menjual pemain dan menggantinya dengan pemain lain yang hanya mendapat perolehan poin lebih rendah. DILARANG menggunakan kata pengandaian (seperti 'Andai', 'Seandainya', 'Jika saja', 'Had they', 'If').
5. Gunakan nilai selisih bersih matematis dari tabel whatIfOpportunities tanpa menyebutkan kata 'bersih', cukup sebutkan kata 'poin' atau 'tambahan poin'.
6. Mulai kalimat langsung pada substansi berita tanpa judul atau awalan berkategori.
7. Akhiri setiap kalimat dengan tanda titik (.), tanpa tanda seru (!).
8. Format penyebutan klub pemain menggunakan tanda kurung tanpa kata 'dari': [P:Pemain] ([C:Klub]).
9. Buat 8 hingga 12 berita dwibahasa simultan dengan format JSON array valid:
[
  {
    "id": "story_1",
    "headline_id": "...",
    "headline_en": "...",
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

  const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let stories: NewsTickerStory[] = [];
  let executionError: any = null;

  for (const model of candidateModels) {
    try {
      console.log(`[Gemini News Service] Querying model ${model} for autonomous news ticker...`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      });

      const rawText = response.text || '';
      const parsed = parseStoriesFromRaw(rawText);
      if (parsed && parsed.length > 0) {
        // Enforce intra-batch entity uniqueness & strip any residual title prefix
        const seenPlayers = new Set<string>();
        const seenTeams = new Set<string>();
        const filteredStories: NewsTickerStory[] = [];

        for (const item of parsed) {
          const headlineId = cleanHeadlineBody(String(item.headline_id || item.headline || ''));
          const headlineEn = cleanHeadlineBody(String(item.headline_en || item.headline || item.headline_id || ''));
          const combined = `${headlineId} ${headlineEn}`;

          // Extract players
          const pMatches = combined.match(/\[P:([^\]]+)\]/g) || [];
          const playerNames = pMatches.map((m) => m.replace(/^\[P:|\]$/g, '').trim().toLowerCase());

          // Check if any player in this headline was already featured in an earlier headline of this batch
          const duplicatePlayer = playerNames.find((p) => seenPlayers.has(p));
          if (duplicatePlayer) {
            console.log(`[Gemini News Service] Skipping duplicate player in batch: ${duplicatePlayer}`);
            continue;
          }

          // Extract teams
          const tMatches = combined.match(/\[T:([^\]]+)\]/g) || [];
          const teamNames = tMatches.map((m) => m.replace(/^\[T:|\]$/g, '').trim().toLowerCase());
          const duplicateTeam = teamNames.find((t) => seenTeams.has(t) && !t.includes('yuk bisa yuk'));
          if (duplicateTeam) {
            console.log(`[Gemini News Service] Skipping duplicate team in batch: ${duplicateTeam}`);
            continue;
          }

          // Register seen entities
          playerNames.forEach((p) => seenPlayers.add(p));
          teamNames.forEach((t) => seenTeams.add(t));

          filteredStories.push({
            id: String(item.id || `story_${filteredStories.length + 1}`),
            headline_id: headlineId,
            headline_en: headlineEn,
            drama_score: Number(item.drama_score) || 80,
          });
        }

        // If filtering retained at least 6 diverse stories, use them; otherwise use parsed directly
        const finalStories = filteredStories.length >= 6 ? filteredStories : parsed.map((item, idx) => ({
          id: String(item.id || `story_${idx + 1}`),
          headline_id: cleanHeadlineBody(String(item.headline_id || item.headline || '')),
          headline_en: cleanHeadlineBody(String(item.headline_en || item.headline || item.headline_id || '')),
          drama_score: Number(item.drama_score) || 80,
        }));

        stories = finalStories;
        console.log(`[Gemini News Service] Successfully generated ${stories.length} diverse stories with ${model}`);
        break;
      }
    } catch (e: any) {
      console.warn(`[Gemini News Service] Model ${model} failed:`, e.message);
      executionError = e;
    }
  }

  if (stories.length === 0) {
    if (memoryFeedCache && memoryFeedCache.data.length > 0) {
      console.log('[Gemini News Service] Returning existing memory cache due to generation failure.');
      return memoryFeedCache;
    }
    throw new Error(`Failed to generate autonomous news feed: ${executionError?.message || 'Unknown error'}`);
  }

  const feedResponse: NewsTickerFeedResponse = {
    success: true,
    gameweek: payload.gameweek,
    nextGameweek: payload.nextGameweek,
    gameweekPhase: payload.gameweekPhase,
    lastUpdated: new Date().toISOString(),
    count: stories.length,
    data: stories,
  };

  // Update memory cache and state hash
  memoryFeedCache = feedResponse;
  lastProcessedDataHash = currentHash;

  // Persist to disk atomically
  try {
    fs.writeFileSync(FEED_CACHE_PATH, JSON.stringify(feedResponse, null, 2), 'utf-8');
    console.log('[Gemini News Service] Successfully persisted news feed to disk cache.');
  } catch (e: any) {
    console.warn('[Gemini News Service] Disk cache write error:', e.message);
  }

  return feedResponse;
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
