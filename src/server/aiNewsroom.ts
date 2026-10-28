import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { TransformedLeagueData, MatchCardItem } from '../types.ts';
import { determineMatchdayPhase, NewsStory, NewsToken } from '../data/newsTickerEngine.ts';
import {
  readOnlyDatabaseToolDeclarations,
  executeReadOnlyDatabaseAction
} from './geminiDatabaseReader.ts';
import {
  getOptimalDatabase,
  getDbStandings,
  getGwSnapshot,
  getDbLigaMinus
} from './db.ts';


// Inisialisasi Google GenAI SDK (Server-Side)
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;


interface CacheEntry {
  timestamp: number;
  hash: string;
  stories: NewsStory[];
}

const memoryCache = new Map<string, CacheEntry>();

function cleanTeamToken(text: string): string {
  if (/^\s*Tim\s+/i.test(text) && !text.trim().toLowerCase().startsWith('tim holland')) {
    return text.replace(/^(\s*)Tim\s+/i, '$1');
  }
  return text;
}

function sanitizeStories(rawStories: any[], phase: string): NewsStory[] {
  return rawStories.map((s, sIdx) => {
    const tokens: NewsToken[] = (s.tokens || []).map((t: any) => {
      let text = String(t.text || '');
      const type = (['player', 'team', 'club', 'stat', 'plain'].includes(t.type) ? t.type : 'plain') as NewsToken['type'];

      if (type === 'team') {
        text = cleanTeamToken(text);
      }

      return { text, type };
    });

    const cleanTokens: NewsToken[] = tokens.filter(t => Boolean(t.text));

    // Normalisasi spasi antartoken agar kata tidak menempel saat dirender di running text
    const normalizedTokens: NewsToken[] = [];
    for (let i = 0; i < cleanTokens.length; i++) {
      let text = cleanTokens[i].text;
      const next = cleanTokens[i + 1];
      if (next) {
        const nextText = next.text;
        if (
          !text.endsWith(' ') &&
          !nextText.startsWith(' ') &&
          !/^[,.!?;:%)]/.test(nextText) &&
          !/^[(\[]/.test(text)
        ) {
          text = text + ' ';
        }
      }
      normalizedTokens.push({ text, type: cleanTokens[i].type });
    }

    const fullPlain = normalizedTokens.map(t => t.text).join('').trim() || (s.plainText || '').replace(/\bTim\s+(?!Holland\b)/gi, '');

    return {
      id: s.id || `ai_story_${Date.now()}_${sIdx}`,
      tokens: normalizedTokens,
      plainText: fullPlain,
      dramaScore: typeof s.dramaScore === 'number' ? Math.min(100, Math.max(40, s.dramaScore)) : 75,
      timestamp: Date.now(),
      phase: phase as NewsStory['phase']
    };
  });
}

function parseJsonArray(text: string): any[] {
  const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (match) {
    return JSON.parse(match[0]);
  }
  const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

function createMatchStateHash(
  data: TransformedLeagueData | null,
  matches: MatchCardItem[] | null,
  lang: string
): string {
  const gw = data?.current_gw || 1;
  const status = data?.gw_status?.status || 'live';
  const matchHash = (matches || [])
    .map(m => `${m.id}:${m.team_h_score ?? ''}-${m.team_a_score ?? ''}:${m.minutes ?? ''}:${m.phase ?? ''}`)
    .join('|');
  const standingsGw = data?.standings ? (data.standings[gw] || []) : [];
  const topTeams = standingsGw.slice(0, 3).map(s => `${s.entry_id}:${s.event_points}`).join(',');
  return `${gw}_${status}_${lang}_${matchHash}_${topTeams}`;
}

/**
 * 100% OTONOM: Gemini menyelidiki database container secara mandiri menggunakan tool-tool
 * pembaca database (Function Calling), menemukan dramanya sendiri, dan memproduksi berita berjalan.
 * TANPA JALUR UTAMA (injeksi teks fakta mentah manual) & TANPA FALLBACK.
 */
export async function generateAiNewsTicker(
  data: TransformedLeagueData | null,
  matches: MatchCardItem[] | null,
  lang: 'id' | 'en' = 'id',
  forceRefresh: boolean = false
): Promise<NewsStory[]> {
  const phase = determineMatchdayPhase(data, matches);
  const cacheKey = `${lang}_${phase}`;
  const currentHash = createMatchStateHash(data, matches, lang);

  // In-memory cache duration (60s live, 5 menit confirmed) agar server hemat resource
  const ttl = phase === 'live' ? 60 * 1000 : 300 * 1000;
  const cached = memoryCache.get(cacheKey);
  if (!forceRefresh && cached && cached.stories.length > 0 && (Date.now() - cached.timestamp < ttl) && cached.hash === currentHash) {
    return cached.stories;
  }

  if (!ai) {
    throw new Error('GEMINI_API_KEY belum disetel di container. Akses jurnalis otonom Gemini memerlukan API Key aktif.');
  }

  const isId = lang === 'id';
  const currentGw = data?.current_gw || 8;
  const nextGw = currentGw + 1;

  const systemInstruction = `Anda adalah Redaktur Utama & Jurnalis Olahraga Investigatif Resmi untuk liga fantasi "FPL Nusantara BERHADIAH" (FNB League).

KONTEKS GAMEWEEK MUTLAK:
- Gameweek yang baru saja usai di database saat ini adalah GW ${currentGw}. Seluruh aksi pemain, poin, juara pekan, dan pergeseran klasemen yang Anda laporkan WAJIB merujuk ke GW ${currentGw}.
- Gameweek berikutnya yang akan dihadapi manajer untuk deadline transfer adalah GW ${nextGw}.
- DILARANG KERAS MENYEBUT NOMOR GAMEWEEK LAIN! Dilarang mengarang GW 10, GW 11, dst. HANYA sebut GW ${currentGw} (untuk ulasan pekan ini) dan GW ${nextGw} (untuk persiapan deadline berikutnya).

SISTEM KERJA JURNALIS OTONOM:
1. PENYELIDIKAN DATABASE MANDIRI (FUNCTION CALLING):
   - Anda dibekali kumpulan fungsi tool pembaca database container (read_*).
   - UTAMAKAN MEMANGGIL 'read_matchday_intelligence' yang menyajikan fakta menyeluruh GW ${currentGw} dalam satu panggilan: performa nyata pemain di lapangan (gol, assist, CS, saves), diferensial pencetak poin tinggi (<5% owned), manajer korban transfer hit Liga Minus (-4), kapten, chip, dan persaingan tahta.
   - Jangan berasumsi atau mengarang data: semua angka poin, nama tim, nama manajer, dan statistik harus diperoleh langsung dari pemanggilan tool database Anda.

2. ATURAN MUTLAK VARIASI TOPIK (ANTI-LEAGUE TABLE MONOTONY):
   - DILARANG KERAS HANYA MEMBERITAKAN KLASEMEN / TABEL LIGA (Rank 1, 2, 3, 5, 8, 10)! Itu sangat membosankan dan monoton.
   - KOMPOSISI BERITA ANDA WAJIB SEIMBANG & BERAGAM:
     * MAKSIMAL 2 BERITA tentang klasemen / persaingan tahta puncak GW ${currentGw}.
     * MINIMAL 3 BERITA tentang AKSI NYATA PEMAIN di lapangan pada GW ${currentGw}: siapa mencetak gol/assist (misal Gabriel 17 pts, Konsa 14 pts, White 10 pts), kiper dengan saves spektakuler, pemain clean sheet, dan peraih BPS tertinggi.
     * MINIMAL 2 BERITA tentang ASET DIFERENSIAL (pemain yang dimiliki <= 5 tim di FNB yang panen poin besar di GW ${currentGw}, sebutkan nama tim yang memilikinya) VS derita manajer yang pemain bintang populernya blank (misal Palmer -1 pt, João Pedro 0 pts).
     * MINIMAL 1-2 BERITA tentang PERJUDIAN TRANSFER & LIGA MINUS: pembelian tersukses (Tavernier 10 pts) vs pemain yang dibuang bersama (Bruno Fernandes, Szoboszlai) serta rekor poin minus liga.
     * MINIMAL 1 BERITA tentang KAPTEN & CHIP: pilihan kapten dominan (Haaland 8x2 pts) vs jebakan kapten (João Pedro 0 pts, Palmer -1 pt).
     * 1 HEADLINE Pengingat Deadline GW ${nextGw} lengkap dengan jam WIB.

3. KEPATUHAN STATUS GAMEWEEK:
   - Status saat ini adalah [GW Final / Confirmed] (data_checked === true && leagues === "Updated"): Seluruh laga GW ${currentGw} usai dan poin sah terkunci mutlak. Sertakan 1 headline Pengingat Deadline GW ${nextGw}.

4. FORMAT OUTPUT AKHIR (TOKENISASI ENTITAS):
   - Di giliran akhir setelah data selesai Anda selidiki, berikan output HANYA berupa array JSON valid berisi 8 hingga 14 headline berita:
   [
     {
       "id": "story_1",
       "dramaScore": 95,
       "plainText": "Yuk Bisa Yuk FC resmi mengkudeta takhta...",
       "tokens": [
         { "text": "Yuk Bisa Yuk FC ", "type": "team" },
         { "text": "resmi mengkudeta takhta puncak klasemen dengan keunggulan ", "type": "plain" },
         { "text": "5 poin", "type": "stat" }
       ]
     }
   ]
   Tipe token:
   * 'player': Nama pemain FPL.
   * 'team': Nama tim manajer FNB League (tulis langsung tanpa awalan kata 'Tim ').
   * 'club': Nama klub Premier League.
   * 'stat': Angka skor, poin, peringkat, statistik mikro.
   * 'plain': Narasi jurnalisme yang luwes dan hidup.`;

  // Ekstrak tabel mentah lengkap tanpa filter kurasi opini dari container
  const db = getOptimalDatabase();
  const standings = getDbStandings(currentGw);
  const snap = getGwSnapshot(currentGw);
  const allPlayers = Object.values(db.players || {});

  const rawStandings = standings.map(s => ({
    rank: s.rank,
    lastRank: s.last_rank,
    rankChange: s.rank_change,
    team: s.entry_name,
    manager: s.player_name,
    gwPts: s.event_points,
    totalPts: s.total_points,
    hitPenalty: s.event_transfers_cost,
    chip: s.active_chip,
    captain: s.captain ? `${s.captain.name} (${s.captain.points} pts)` : null,
    viceCaptain: s.vice_captain ? `${s.vice_captain.name} (${s.vice_captain.points} pts)` : null
  }));

  const rawPlayers = allPlayers
    .filter(p => (p.minutes || 0) > 0 || (p.league_ownership?.count || 0) > 0)
    .map(p => ({
      name: p.webName,
      club: p.teamShort,
      pos: p.position,
      cost: (p.nowCost || 0) / 10,
      gwPts: p.eventPoints || 0,
      goals: p.goalsScored || 0,
      assists: p.assists || 0,
      cs: p.cleanSheets || 0,
      saves: p.saves || 0,
      penSaved: p.penaltiesSaved || 0,
      bps: p.bps || 0,
      fnbOwned: p.league_ownership?.count || 0,
      fnbOwners: (p.league_ownership?.count || 0) <= 5 ? (p.league_ownership?.owners || []).map((o: any) => o.entry_name) : undefined
    }));

  const rawDataPayload = {
    gameweek: currentGw,
    nextGameweek: nextGw,
    gameweekStatus: 'Confirmed (Final 100%)',
    totalManagers: rawStandings.length,
    standingsTableRaw: rawStandings,
    playerStatsRaw: rawPlayers,
    transfersInRaw: snap?.transfers_in || [],
    transfersOutRaw: snap?.transfers_out || [],
    ligaMinusHitsRaw: getDbLigaMinus().slice(0, 5)
  };

  const userPrompt = isId
    ? `Halo Redaktur! Berikut adalah SELURUH TABEL DATABASE MENTAH FPL Nusantara BERHADIAH GW ${currentGw} langsung dari container tanpa disunting atau dikurasi:
${JSON.stringify(rawDataPayload)}

TUGAS JURNALISTIK OTONOM:
Selidiki sendiri tabel-tabel mentah di atas tanpa intervensi kurasi server. Anda bebas menganalisis pertempuran puncak klasemen, juara pekan dengan skor tertinggi, pahlawan tak terduga, blunder kapten, tragedi bintang populer, hingga perjudian transfer. Hasilkan 8 hingga 14 headline berita berjalan (news ticker) yang sangat beragam dan faktual untuk GW ${currentGw} (serta deadline persiapan GW ${nextGw}) dalam format array JSON terstruktur.`
    : `Hello Chief Editor! Here is the COMPLETE UNCURATED RAW DATABASE of FPL Nusantara BERHADIAH GW ${currentGw} directly from the container:
${JSON.stringify(rawDataPayload)}

AUTONOMOUS JOURNALISM TASK:
Investigate these raw tables on your own without server-side curation. Autonomously analyze title race battles, top weekly champions, surprise differential heroes, captain blunders, and transfer hits. Produce 8 to 14 news ticker headlines strictly grounded in real GW ${currentGw} data (and GW ${nextGw} deadline reminder) in structured JSON format.`;

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
  };

  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let finalStories: NewsStory[] = [];
  let executionError: any = null;

  for (const model of candidateModels) {
    try {
      const contents: any[] = [
        { role: 'user', parts: [{ text: userPrompt }] }
      ];

      let turn = 0;
      const maxTurns = 5;

      while (turn < maxTurns) {
        turn++;
        console.log(`[AI Newsroom Autonomous] Querying model ${model} (Turn ${turn})...`);

        const config: any = {
          systemInstruction,
          temperature: 0.7,
        };
        if (turn === 1) {
          config.tools = [{ functionDeclarations: readOnlyDatabaseToolDeclarations }];
        }

        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents,
            config,
          }),
          25000
        );





        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {

          // CRITICAL: Gunakan langsung content lengkap dari model (candidates[0].content)
          // untuk mempertahankan thought_signature dan struktur thinking utuh.
          const modelContent = response.candidates?.[0]?.content;
          if (!modelContent) {
            throw new Error('Model produced function calls without candidate content.');
          }
          contents.push(modelContent);

          // Jalankan setiap pemanggilan tool secara mandiri ke database container
          const functionResponses: any[] = [];
          for (const fc of functionCalls) {
            console.log(`[AI Newsroom Autonomous] Executing tool '${fc.name}' with args:`, fc.args);
            const toolResult = await executeReadOnlyDatabaseAction(fc.name, fc.args || {});
            functionResponses.push({
              functionResponse: {
                name: fc.name,
                response: { result: toolResult },
                ...((fc as any).id ? { id: (fc as any).id } : {}),
              }
            });
          }

          // Kembalikan hasil pembacaan database ke Gemini
          contents.push({
            role: 'user',
            parts: functionResponses
          });
        } else {

          // Gemini telah selesai menyelidiki database dan memproduksi berita
          const responseText = response.text || '';
          if (!responseText) {
            throw new Error('Model produced empty text response.');
          }

          const rawArray = parseJsonArray(responseText);
          if (!Array.isArray(rawArray) || rawArray.length === 0) {
            throw new Error('Model response did not contain a valid JSON array of stories.');
          }

          finalStories = sanitizeStories(rawArray, phase);
          break;
        }
      }

      if (finalStories.length > 0) {
        break;
      }
    } catch (err: any) {
      console.warn(`[AI Newsroom Autonomous] Model ${model} encountered error:`, err.message);
      executionError = err;
    }
  }

  if (finalStories.length === 0) {
    throw executionError || new Error('Gagal menghasilkan berita otonom dari database.');
  }

  memoryCache.set(cacheKey, {
    timestamp: Date.now(),
    hash: currentHash,
    stories: finalStories
  });

  console.log(`[AI Newsroom Autonomous] Successfully produced ${finalStories.length} stories autonomously from container database.`);
  return finalStories;
}
