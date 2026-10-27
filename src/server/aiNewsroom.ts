import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { TransformedLeagueData, MatchCardItem, StandingsRow } from '../types.ts';
import { determineMatchdayPhase, NewsStory, NewsToken } from '../data/newsTickerEngine.ts';

// Inisialisasi Google GenAI SDK (Server-Side)
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

interface CacheEntry {
  timestamp: number;
  hash: string;
  stories: NewsStory[];
}

const PERSISTENT_CACHE_PATH = path.join(process.cwd(), 'src/data/ai_news_cache.json');
const memoryCache = new Map<string, CacheEntry>();

// Pre-load persistent cache dari disk saat server boot
try {
  if (fs.existsSync(PERSISTENT_CACHE_PATH)) {
    const raw = fs.readFileSync(PERSISTENT_CACHE_PATH, 'utf-8');
    const diskStories: NewsStory[] = JSON.parse(raw);
    if (Array.isArray(diskStories) && diskStories.length > 0) {
      memoryCache.set('id_confirmed', { timestamp: Date.now(), hash: 'disk_preseed', stories: diskStories });
      memoryCache.set('en_confirmed', { timestamp: Date.now(), hash: 'disk_preseed', stories: diskStories });
      console.log(`[AI Newsroom] Pre-seeded ${diskStories.length} high-fidelity AI stories from persistent cache`);
    }
  }
} catch (e: any) {
  console.warn('[AI Newsroom] Could not read persistent cache:', e.message);
}

function persistAiStories(stories: NewsStory[]) {
  try {
    fs.writeFileSync(PERSISTENT_CACHE_PATH, JSON.stringify(stories, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[AI Newsroom] Failed to write persistent cache:', err.message);
  }
}

function cleanTeamToken(text: string): string {
  if (/^\s*Tim\s+/i.test(text) && !text.trim().toLowerCase().startsWith('tim holland')) {
    return text.replace(/^(\s*)Tim\s+/i, '$1');
  }
  return text;
}

function sanitizeStories(stories: NewsStory[]): NewsStory[] {
  return stories.map(s => {
    const tokens = (s.tokens || []).map(t => {
      if (t.type === 'team') {
        return { ...t, text: cleanTeamToken(t.text) };
      }
      return t;
    });
    const plainText = tokens.map(t => t.text).join('').trim() || (s.plainText || '').replace(/\bTim\s+(?!Holland\b)/gi, '');
    return {
      ...s,
      tokens,
      plainText
    };
  });
}

function getFallbackPersistentStories(phase: string): NewsStory[] {
  try {
    if (fs.existsSync(PERSISTENT_CACHE_PATH)) {
      const raw = fs.readFileSync(PERSISTENT_CACHE_PATH, 'utf-8');
      const diskStories: NewsStory[] = JSON.parse(raw);
      if (Array.isArray(diskStories) && diskStories.length > 0) {
        return sanitizeStories(diskStories);
      }
    }
  } catch {}

  const cached = memoryCache.get('id_confirmed') || memoryCache.get('id_live') || memoryCache.get('en_confirmed');
  if (cached && cached.stories.length > 0) {
    return sanitizeStories(cached.stories);
  }

  return [];
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
 * Kompilasi Fakta Mentah Lengkap FNB League dengan Pemahaman Konteks Penuh:
 * 1. FPL & FNB League rules, scoring table (RULE[AGENTS_md]), 4 tipe juara
 * 2. Seluruh Tampilan & Fitur Aplikasi (Klasemen, Subtab Status, Modal Pemain, Transfer, Kapten, Chips)
 * 3. Status Gameweek Mutlak (GW Final vs GW Provisional/Live)
 * 4. Histori dari GW ke GW (Perubahan posisi, lonjakan, coup pucuk)
 * 5. Statistik Mikro Modal Pemain (BPS, DefCon, Saves, Kartu, Penalti, Clean Sheet)
 */
function compileLeagueFacts(
  data: TransformedLeagueData | null,
  matches: MatchCardItem[] | null,
  phase: string
): string {
  if (!data) return 'Data liga belum tersedia.';

  const currentGw = data.current_gw || 1;
  const prevGw = currentGw > 1 ? currentGw - 1 : null;
  const standingsGw: StandingsRow[] = (data.standings && data.standings[currentGw]) || [];
  const prevStandingsGw: StandingsRow[] = (prevGw && data.standings && data.standings[prevGw]) || [];

  const lines: string[] = [];

  // ==========================================================================
  // A. DASAR ATURAN FPL & KONTEKS FNB LEAGUE
  // ==========================================================================
  lines.push(`=== PANDUAN DASAR FPL & FNB LEAGUE ===`);
  lines.push(`- FPL (Fantasy Premier League): Permainan simulasi manajer sepak bola berdasar laga Premier League nyata.`);
  lines.push(`- TUJUAN UTAMA: Meraih akumulasi poin setinggi-tingginya sepanjang musim.`);
  lines.push(`- MANAJER & STRATEGI:`);
  lines.push(`  * Manajer memiliki 1 Free Transfer gratis tiap GW. Tiap transfer tambahan dikenakan penalti potongan -4 poin (Transfer Hit / Liga Minus).`);
  lines.push(`  * Starting Lineup (11 pemain) vs Bangku Cadangan (Bench Order 1, 2, 3): Poin di bench hangus kecuali autosub resmi terjadi.`);
  lines.push(`  * Kapten (C): Poin dikali 2 (x2). Wakil Kapten (VC): Menggantikan kapten hanya jika kapten bermain 0 menit.`);
  lines.push(`  * Chips Spesial: Triple Captain (poin kapten x3), Bench Boost (poin bangku cadangan ikut dihitung), Free Hit (perombakan bebas 1 GW), Wildcard.`);
  lines.push(`- ATURAN SKOR RESMI (FPL SCORING TABLE):`);
  lines.push(`  * Menit Main: 1-59 mnt (+1 pt), >= 60 mnt (+2 pts).`);
  lines.push(`  * Gol: GKP/DEF (+6 pts), MID (+5 pts), FWD (+4 pts).`);
  lines.push(`  * Assist: +3 pts untuk semua posisi.`);
  lines.push(`  * Clean Sheet: DEF/GKP (+4 pts), MID (+1 pt) - Syarat mutlak: bermain minimal 60 menit saat timnya tidak kebobolan.`);
  lines.push(`  * Saves Kiper: Tiap 3 saves = +1 pt.`);
  lines.push(`  * Tepis Penalti: +5 pts (GKP).`);
  lines.push(`  * Kontribusi Bertahan (DefCon): Cap +2 pts jika DEF CBIT >= 10, atau MID/FWD CBIRT >= 12.`);
  lines.push(`  * Kebobolan: Tiap 2 gol kebobolan = -1 pt (khusus DEF/GKP).`);
  lines.push(`  * Penalti Gagal: -2 pts. Gol Bunuh Diri: -2 pts.`);
  lines.push(`  * Kartu Kuning: -1 pt. Kartu Merah: -3 pts (pemain kartu merah tetap terkena penalti kebobolan lanjutan).`);
  lines.push(`  * Bonus Points (BPS Opta): 3, 2, 1 poin bagi 3 pemain dengan performa statistik Opta terbaik di pertandingan.`);
  lines.push(`- FNB LEAGUE (FPL Nusantara BERHADIAH): Mini liga kompetitif bergengsi berhadiah dengan total 97 manajer.`);
  lines.push(`  * 4 TIPE JUARA FNB LEAGUE:`);
  lines.push(`    1. Overall Leader (Peringkat 1): Penguasa tahta akumulasi total poin tertinggi sepanjang musim.`);
  lines.push(`    2. Top Challenger (Peringkat 2): Runner-up yang terus membayangi dan menekan puncak klasemen.`);
  lines.push(`    3. Most GW Wins (Juara Terbanyak): Manajer peraih trofi mingguan terbanyak (jika bertengger di Posisi 1/2, dialihkan ke manajer eligible peringkat terbaik berikutnya).`);
  lines.push(`    4. Juara Gameweek: Manajer dengan perolehan skor GW tertinggi di pekan aktif, berhak atas hadiah mingguan.`);

  // ==========================================================================
  // B. IDENTIFIKASI STATUS GAMEWEEK (SESUAI KONVENSI RULE[AGENTS_md])
  // ==========================================================================
  const isDataChecked = Boolean(data.gw_status?.data_checked);
  const isLeaguesUpdated = data.gw_status?.leagues_status === 'Updated';
  const isGwFinal = isDataChecked && isLeaguesUpdated;

  const activeMatches = (matches || []).filter(m => m.event === currentGw || !m.event);
  const liveMatches = activeMatches.filter(m => m.started && !m.finished && !m.finished_provisional);
  const finishedMatches = activeMatches.filter(m => m.finished || m.finished_provisional);
  const allMatchesFinished = activeMatches.length > 0 && finishedMatches.length === activeMatches.length;

  // Deadline & Jadwal Gameweek Berikutnya
  const nextGw = currentGw + 1;
  const nextDeadlineIso = data.sync_status?.next_deadline_time;
  let deadlineFact = '';
  if (nextDeadlineIso) {
    try {
      const d = new Date(nextDeadlineIso);
      const dateStr = d.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Jakarta'
      });
      const timeStr = d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      });
      deadlineFact = `Deadline Gameweek ${nextGw}: ${dateStr} pukul ${timeStr} WIB`;
    } catch {
      deadlineFact = `Deadline Gameweek ${nextGw}: ${nextDeadlineIso}`;
    }
  }

  lines.push(`\n=== STATUS GAMEWEEK SAAT INI (RULE[AGENTS_md]) ===`);
  lines.push(`GW AKTIF: GW ${currentGw}`);

  if (isGwFinal) {
    lines.push(`STATUS KATEGORI: [GW FINAL / CONFIRMED]`);
    lines.push(`ATURAN REDAKSI STATUS: Seluruh pertandingan telah tuntas 100%, audit Opta BPS selesai, poin bonus terkunci, proses autosub selesai, penalti hit transfer terpotong, dan klasemen liga RESMI TERKUNCI PERMANEN.`);
    lines.push(`LARANGAN KERAS: DILARANG menggunakan kata-kata penantian atau spekulasi seperti "kita tunggu apakah...", "masih berpeluang bergeser", atau "menanti hasil akhir", karena semua laga sudah selesai dan klasemen telah dikunci mutlak. Sajikan semua nama juara dan poin sebagai fakta sah definitif.`);
    if (deadlineFact) {
      lines.push(`FAKTA DEADLINE RESMI: ${deadlineFact}.`);
      lines.push(`KEWAJIBAN STATUS CONFIRMED: WAJIB TERBITKAN 1 HEADLINE PENGINGAT DEADLINE (DEADLINE REMINDER) untuk GW ${nextGw}! Beritahukan tenggat waktu transfer dan susunan pemain (${deadlineFact}) agar para manajer bersiap mengatur skuad dan transfer gratis.`);
    }
  } else if (allMatchesFinished) {
    lines.push(`STATUS KATEGORI: [GW PROVISIONAL / SELURUH LAGA LAPANGAN RAMPUNG]`);
    lines.push(`ATURAN REDAKSI STATUS: Seluruh 10 laga di lapangan SUDAH SELESAI 100%. TIDAK ADA laga tersisa di lapangan.`);
    lines.push(`LARANGAN KERAS: JANGAN katakan "kita tunggu laga tersisa" atau "menanti pertandingan besok" karena lapangan sudah kosong. Namun BPS Opta dan proses autosub masih berstatus provisional menunggu audit pengesahan final FPL.`);
  } else if (liveMatches.length > 0) {
    lines.push(`STATUS KATEGORI: [GW LIVE / MATCHDAY BERLANGSUNG]`);
    lines.push(`ATURAN REDAKSI STATUS: Pertandingan EPL sedang bertanding di lapangan! Skor dan poin bergerak dinamis.`);
  } else if (finishedMatches.length > 0) {
    lines.push(`STATUS KATEGORI: [GW INTERMISSION / JEDA ANTAR-LAGA]`);
    lines.push(`ATURAN REDAKSI STATUS: Sebagian pertandingan rampung, pertandingan berikutnya dijadwalkan bertanding besok.`);
  } else {
    lines.push(`STATUS KATEGORI: [GW LOCKOUT / DEADLINE SELESAI]`);
    lines.push(`ATURAN REDAKSI STATUS: Tim terkunci, laga perdana segera dimulai.`);
  }

  // ==========================================================================
  // C. STRUKTUR SELURUH TAMPILAN APLIKASI
  // ==========================================================================
  lines.push(`\n=== SELURUH TAMPILAN APLIKASI FNB LEAGUE ===`);
  lines.push(`- Tab Klasemen: Menampilkan Rank (#), Nama Tim (contoh "Ciss"), Nama Manajer, Poin GW, Total Poin, Perubahan Peringkat, dan Potongan Transfer Minus.`);
  lines.push(`- Subtab Status (4 Pilar Juara): Kartu interaktif Overall Leader, Top Challenger, Most GW Wins, dan Juara Gameweek.`);
  lines.push(`- Tab Matches: Kartu skor pertandingan live, menit main, pencetak gol, assist, dan kartu.`);
  lines.push(`- Tab Transfer & Liga Minus: Menampilkan daftar transfer masuk/keluar serta daftar manajer dengan penalti poin minus.`);
  lines.push(`- Tab Kapten & Chips: Menampilkan persentase pemilihan kapten, vice-captain, dan chip aktif (TC, BB, FH, WC).`);
  lines.push(`- Tab Kepemilikan: Menampilkan persentase kepemilikan pemain di liga FNB.`);
  lines.push(`- Modal Detail Pemain: Statistik mikro: Menit Main, Gol, Assist, Clean Sheet, Saves Kiper, DefCon, Kebobolan, Kartu Kuning/Merah, Penalti Gagal/Tepis, BPS.`);
  lines.push(`- Modal Detail Manajer: Susunan starting XI, bangku cadangan, histori transfer mingguan, dan chip yang digunakan.`);

  // ==========================================================================
  // D. DATA 4 PILAR JUARA & STATISTIK KLASEMEN SAAT INI
  // ==========================================================================
  if (standingsGw.length > 0) {
    const rank1 = standingsGw.find(r => r.rank === 1) || standingsGw[0];
    const rank2 = standingsGw.find(r => r.rank === 2) || standingsGw[1];
    const top1Or2Ids = new Set<number>([rank1?.entry_id, rank2?.entry_id].filter(Boolean));

    const mostGwList = Array.isArray(data.most_gameweek_champions) ? data.most_gameweek_champions : [];
    const eligibleMostGw = mostGwList.find(m => m && m.win_count > 0 && !top1Or2Ids.has(m.entry_id || 0)) || mostGwList[0];

    const gwChampsList = Array.isArray(data.gameweek_champions) ? data.gameweek_champions : [];
    const gwNRow = gwChampsList.find(g => g && g.event === currentGw);
    const topGwNChamp = gwNRow?.champions?.[0];

    lines.push(`\n=== DATA 4 PILAR JUARA SAAT INI ===`);
    if (rank1) lines.push(`- Pilar 1: Peringkat 1 (Overall Leader): ${rank1.entry_name} (${rank1.player_name}) | Total: ${rank1.total_points} pts | GW${currentGw}: ${rank1.event_points} pts`);
    if (rank2) {
      const gap = (rank1?.total_points || 0) - rank2.total_points;
      lines.push(`- Pilar 2: Peringkat 2 (Top Challenger): ${rank2.entry_name} (${rank2.player_name}) | Total: ${rank2.total_points} pts | GW${currentGw}: ${rank2.event_points} pts | Gap: ${gap} poin ke puncak`);
    }
    if (eligibleMostGw) {
      lines.push(`- Pilar 3: Juara Terbanyak (Most GW Wins): ${eligibleMostGw.entry_name} (${eligibleMostGw.player_name}) | Memegang ${eligibleMostGw.win_count} piala mingguan`);
    }
    if (topGwNChamp) {
      lines.push(`- Pilar 4: Juara Gameweek ${currentGw}: ${topGwNChamp.entry_name} (${topGwNChamp.player_name}) | Skor: ${topGwNChamp.points} poin`);
    }

    // Analisis Kudeta & Pertarungan Puncak Klasemen (Title Race Battle & Differentials)
    if (rank1 && rank2 && prevStandingsGw.length > 0) {
      const prevRank1 = prevStandingsGw.find(r => r.rank === 1);
      const isCoup = prevRank1 && prevRank1.entry_id !== rank1.entry_id;
      const gap = (rank1.total_points || 0) - rank2.total_points;

      let prevStreak = 0;
      if (isCoup && prevGw) {
        for (let g = prevGw; g >= 1; g--) {
          const pastStandings = data.standings?.[g] || [];
          const pastTop = pastStandings.find(r => r.rank === 1);
          if (pastTop && pastTop.entry_id === prevRank1.entry_id) {
            prevStreak++;
          } else {
            break;
          }
        }
      }

      const op = data.ownership_players?.[currentGw] || [];
      const r1Diffs: Array<{ name: string; pts: number; team: string }> = [];
      const r2Diffs: Array<{ name: string; pts: number; team: string }> = [];

      for (const p of op) {
        const o1 = (p.owners || []).find(o => o.entry_id === rank1.entry_id && (o.is_starter || o.position_in_squad <= 11));
        const o2 = (p.owners || []).find(o => o.entry_id === rank2.entry_id && (o.is_starter || o.position_in_squad <= 11));
        if (o1 && !o2) r1Diffs.push({ name: p.web_name, pts: p.gw_points, team: p.team_short_name });
        if (o2 && !o1) r2Diffs.push({ name: p.web_name, pts: p.gw_points, team: p.team_short_name });
      }

      lines.push(`\n=== DRAMA PEREBUTAN JUARA / KUDETA PUNCAK KLASEMEN ===`);
      if (isCoup) {
        lines.push(`- STATUS: TERJADI KUDETA TAKHTA BESAR! ${rank1.entry_name} resmi MEREBUT Peringkat #1 dari ${prevRank1.entry_name}.`);
        lines.push(`- Kronologi: ${prevRank1.entry_name} yang telah memimpin klasemen liga selama ${prevStreak} pekan beruntun (dari GW${prevGw - prevStreak + 1} sampai GW${prevGw}) akhirnya lengser setelah hanya mencetak ${rank2.event_points} poin di GW${currentGw}, berbanding telak dengan ${rank1.entry_name} yang meledak dengan ${rank1.event_points} poin!`);
        lines.push(`- Gap Klasemen: Defisit sebelumnya berhasil dibalikkan menjadi keunggulan +${gap} poin untuk ${rank1.entry_name}.`);
        if (r1Diffs.length > 0 || r2Diffs.length > 0) {
          const r1DiffStr = r1Diffs.map(d => `${d.name} (${d.pts} pts)`).join(', ');
          const r2DiffStr = r2Diffs.map(d => `${d.name} (${d.pts} pts)`).join(', ');
          lines.push(`- Pertarungan Aset Diferensial Penentu Kudeta:`);
          lines.push(`  * Pembeda ${rank1.entry_name}: ${r1DiffStr}`);
          lines.push(`  * Pembeda ${rank2.entry_name}: ${r2DiffStr}`);
        }
      } else {
        lines.push(`- Persaingan Puncak: ${rank1.entry_name} menjaga keunggulan ${gap} poin dari ancaman ${rank2.entry_name}.`);
      }
    }

    const ptsList = standingsGw.map(r => Number(r.event_points)).filter(p => !isNaN(p));
    if (ptsList.length > 0) {
      const highestPts = Math.max(...ptsList);
      const lowestPts = Math.min(...ptsList);
      const avgPts = Math.round(ptsList.reduce((a, b) => a + b, 0) / ptsList.length);
      const topGwTeam = standingsGw.find(r => r.event_points === highestPts);
      const lowGwTeam = standingsGw.find(r => r.event_points === lowestPts);
      lines.push(`\n=== RANGKUMAN SKOR LIGA GW${currentGw} ===`);
      lines.push(`- Skor Tertinggi: ${highestPts} poin diraih ${topGwTeam?.entry_name || '-'}`);
      lines.push(`- Rata-rata Liga: ${avgPts} poin`);
      lines.push(`- Skor Terendah: ${lowestPts} poin dialami ${lowGwTeam?.entry_name || '-'}`);
    }
  }

  // ==========================================================================
  // E. HISTORI PERUBAHAN DARI GW KE GW (STANDINGS MOMENTUM)
  // ==========================================================================
  if (prevStandingsGw.length > 0 && standingsGw.length > 0) {
    const prevMap = new Map<number, StandingsRow>();
    prevStandingsGw.forEach(s => prevMap.set(s.entry_id, s));

    const movements = standingsGw.map(curr => {
      const prev = prevMap.get(curr.entry_id);
      const prevRank = prev ? prev.rank : curr.last_rank || curr.rank;
      const rankDiff = prevRank - curr.rank;
      return {
        entry_name: curr.entry_name,
        player_name: curr.player_name,
        current_rank: curr.rank,
        prev_rank: prevRank,
        rank_diff: rankDiff,
        event_points: curr.event_points,
        total_points: curr.total_points,
      };
    });

    const topClimbers = [...movements].filter(m => m.rank_diff > 0).sort((a, b) => b.rank_diff - a.rank_diff).slice(0, 3);
    const bigFallers = [...movements].filter(m => m.rank_diff < 0).sort((a, b) => a.rank_diff - b.rank_diff).slice(0, 3);

    lines.push(`\n=== HISTORI PERGESERAN KLASEMEN GW${prevGw} KE GW${currentGw} ===`);
    if (topClimbers.length > 0) {
      lines.push(`- Lonjakan Peringkat Terbesar:`);
      topClimbers.forEach(c => {
        lines.push(`  * ${c.entry_name} (${c.player_name}): Melesat naik +${c.rank_diff} posisi dari #${c.prev_rank} ke #${c.current_rank} berkat torehan ${c.event_points} poin!`);
      });
    }

    if (bigFallers.length > 0) {
      lines.push(`- Penurunan Paling Curam:`);
      bigFallers.forEach(f => {
        lines.push(`  * ${f.entry_name} (${f.player_name}): Anjlok ${Math.abs(f.rank_diff)} tingkat dari #${f.prev_rank} ke #${f.current_rank} setelah hanya mengumpulkan ${f.event_points} poin.`);
      });
    }
  }

  // ==========================================================================
  // F. STATISTIK MIKRO MODAL PEMAIN & DRAMA LAPANGAN
  // ==========================================================================
  const playerStatsList = Array.isArray(data.player_stats) ? data.player_stats : [];

  // DefCon Stars (DEF CBIT >= 10, MID/FWD CBIRT >= 12 -> +2 pts)
  const defConStars = playerStatsList.filter(p => {
    const isDef = p.position === 'DEF';
    const cbi = (p as any).clearances_blocks_interceptions || (p as any).cbi || 0;
    const tackles = (p as any).tackles || 0;
    const rec = (p as any).recoveries || 0;
    const defCon = (p as any).defensive_contribution || (p as any).defCon || 0;
    return defCon > 0 || (isDef && (cbi + tackles) >= 10) || (!isDef && (cbi + tackles + rec) >= 12);
  }).slice(0, 4);

  // Kiper Saves & Tepis Penalti
  const topSavesGk = playerStatsList.filter(p => p.position === 'GKP' && (p.saves || 0) >= 4)
    .sort((a, b) => (b.saves || 0) - (a.saves || 0)).slice(0, 3);
  const penaltySavers = playerStatsList.filter(p => (p.penaltiesSaved || 0) > 0);

  // Penalti Gagal & Kartu Merah
  const penaltyMissers = playerStatsList.filter(p => (p.penaltiesMissed || 0) > 0);
  const redCardPlayers = playerStatsList.filter(p => (p.redCards || 0) > 0);

  // Raja BPS Opta
  const bpsLeaders = [...playerStatsList].sort((a, b) => (b.bps || 0) - (a.bps || 0)).slice(0, 5);

  // Diferensial FNB League (hanya dimiliki <= 3 tim dan poin >= 9)
  const ownershipMap = new Map<number, number>();
  (data.ownership_players?.[currentGw] || []).forEach(o => ownershipMap.set(o.id, o.owned_count));
  const differentialHaulers = playerStatsList.filter(p => {
    const count = ownershipMap.get(p.id) || 0;
    return count > 0 && count <= 3 && (p.eventPoints || 0) >= 9;
  }).slice(0, 4);

  lines.push(`\n=== DETAIL STATISTIK MIKRO PEMAIN (DARI MODAL PLAYER) ===`);
  if (bpsLeaders.length > 0) {
    lines.push(`- Bintang BPS Opta:`);
    bpsLeaders.forEach(p => {
      lines.push(`  * ${p.webName} (${p.teamShort}): ${p.eventPoints} poin, ${p.bps} BPS, +${p.bonus || 0} bonus points`);
    });
  }

  if (defConStars.length > 0) {
    lines.push(`- Bonus DefCon (+2 Pts):`);
    defConStars.forEach(p => {
      lines.push(`  * ${p.webName} (${p.teamShort}, ${p.position}): Meraih bonus +2 pts DefCon berkat aksi defensif solid!`);
    });
  }

  if (topSavesGk.length > 0 || penaltySavers.length > 0) {
    lines.push(`- Kiper Tangguh & Rekor Penalti (AKUMULASI SEPANJANG MUSIM - BUKAN DI GW${currentGw}):`);
    topSavesGk.forEach(gk => {
      const savePts = Math.floor((gk.saves || 0) / 3);
      lines.push(`  * ${gk.webName} (${gk.teamShort}): Total ${gk.saves} saves sepanjang musim (+${savePts} pts saves musim ini)`);
    });
    penaltySavers.forEach(gk => {
      lines.push(`  * ${gk.webName} (${gk.teamShort}): Mengoleksi ${gk.penaltiesSaved || 1} tepisan penalti sepanjang musim ini (CATATAN KONTEKS: Ini adalah milestone musim berjalan, JANGAN sebut terjadi di GW${currentGw} terakhir).`);
    });
  }

  if (penaltyMissers.length > 0 || redCardPlayers.length > 0) {
    lines.push(`- Petaka Kartu & Penalti Gagal (AKUMULASI SEPANJANG MUSIM):`);
    penaltyMissers.forEach(p => lines.push(`  * ${p.webName} (${p.teamShort}): Mengoleksi ${p.penaltiesMissed} penalti gagal sepanjang musim`));
    redCardPlayers.forEach(p => lines.push(`  * ${p.webName} (${p.teamShort}): Mengoleksi ${p.redCards} kartu merah sepanjang musim berjalan`));
  }

  if (differentialHaulers.length > 0) {
    lines.push(`- Kartu As Diferensial FNB:`);
    differentialHaulers.forEach(p => {
      const owned = ownershipMap.get(p.id) || 1;
      lines.push(`  * ${p.webName} (${p.teamShort}): Mendulang ${p.eventPoints} poin, hanya dimiliki oleh ${owned} manajer di liga!`);
    });
  }

  // ==========================================================================
  // G. KAPTEN, CHIP & TRANSFER HIT
  // ==========================================================================
  const captainsGw = (data.captain_players && data.captain_players[currentGw]) || [];
  if (captainsGw.length > 0) {
    lines.push(`\n=== PILIHAN KAPTEN ===`);
    captainsGw.slice(0, 4).forEach(c => {
      lines.push(`- ${c.web_name} (${c.team_short_name}): Dipilih ${c.captain_count} tim (${c.captain_percentage}%), mengumpulkan ${c.gw_points} pts dasar (${c.gw_points * 2} pts kapten)`);
    });
  }

  const transferHitsThisGw = standingsGw.filter(s => (s.event_transfers_cost || 0) > 0)
    .sort((a, b) => b.event_transfers_cost - a.event_transfers_cost).slice(0, 3);
  if (transferHitsThisGw.length > 0) {
    lines.push(`\n=== TRANSFER HIT / LIGA MINUS ===`);
    transferHitsThisGw.forEach(s => {
      lines.push(`- ${s.entry_name} (${s.player_name}): Mengorbankan -${s.event_transfers_cost} poin demi rotasi ekstra`);
    });
  }

  return lines.join('\n');
}

/**
 * Hasilkan berita berjalan dinamis berbobot dengan pemahaman FPL komprehensif 100% BEBAS TEMPLATE
 */
export async function generateAiNewsTicker(
  data: TransformedLeagueData | null,
  matches: MatchCardItem[] | null,
  lang: 'id' | 'en' = 'id'
): Promise<NewsStory[]> {
  const phase = determineMatchdayPhase(data, matches);
  const cacheKey = `${lang}_${phase}`;
  const currentHash = createMatchStateHash(data, matches, lang);

  // Cache duration: 60s saat match live, 10 menit (600s) saat laga usai / confirmed
  const ttl = phase === 'live' ? 60 * 1000 : 600 * 1000;
  const cached = memoryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < ttl) && cached.hash === currentHash) {
    return cached.stories;
  }

  // Jika Gemini belum siap atau API key tidak disetel
  if (!ai) {
    console.log('[AI Newsroom] GEMINI_API_KEY is not set. Serving high-fidelity cached AI stories.');
    const fallback = getFallbackPersistentStories(phase);
    if (fallback.length > 0) {
      memoryCache.set(cacheKey, { timestamp: Date.now(), hash: currentHash, stories: fallback });
      return fallback;
    }
    return [];
  }

  const leagueFacts = compileLeagueFacts(data, matches, phase);
  const isId = lang === 'id';

  const systemInstruction = `Anda adalah Redaktur Utama & Jurnalis Olahraga Resmi untuk liga fantasi "FPL Nusantara BERHADIAH" (FNB League).
Tugas Anda: Menghasilkan 8 hingga 14 headline berita berjalan (news ticker) yang segar, cerdas, tajam, dramatis, dan sangat menarik.

PRINSIP WAJIB:
1. 100% BEBAS TEMPLATE DAN BEBAS KATALOG:
   - DILARANG menggunakan kalimat pembuka kaku yang berulang (misal "kokoh di puncak tahta", "terpuruk di dasar", "habis-habisan mengeluarkan chip", dsb).
   - DILARANG membuat susunan berita yang monoton atau formulaik.
   - Bertindaklah seperti redaktur olahraga kawakan: temukan drama unik, ironi keputusan transfer, pertaruhan ban kapten, dan dampak aksi lapangan terhadap klasemen liga!
2. AKURASI STATUS GAMEWEEK:
   - Patuhi status Gameweek dalam fakta.
   - Jika [GW FINAL]: Semua hasil, poin, dan klasemen sudah SAH dan MUTLAK TERKUNCI. DILARANG menggunakan kata menunggu, berspekulasi, atau mempertanyakan laga berikutnya. Nyatakan pemenang dan poin sebagai fakta sah definitif.
   - Jika [GW PROVISIONAL]: Seluruh pertandingan di lapangan sudah rampung 100%. DILARANG bilang "menunggu pertandingan tersisa" karena tidak ada laga lagi di lapangan. Sebutkan bahwa poin bonus BPS dan autosub sedang dalam antrean pengesahan audit akhir oleh FPL.
   - Jika [GW LIVE]: Pertandingan sedang bertanding langsung di lapangan saat ini.
3. HISTORI GW KE GW:
   - Sorot drama pergeseran klasemen: siapa manajer yang melonjak naik, siapa yang anjlok, dan bagaimana perebutan 4 pilar juara.
4. DRAMA STATISTIK MIKRO PEMAIN:
   - Manfaatkan detail statistik dari modal pemain: raihan +2 poin DefCon (Defensive Contribution) bek/gelandang, kegemilangan saves kiper, tepisan penalti, petaka kartu merah, hingga kartu as diferensial yang hanya dimiliki sedikit tim di liga.
5. FORMAT TOKENISASI & NAMA TIM:
   - Setiap berita dipecah menjadi token entitas:
     * 'player': Nama pemain FPL (contoh: "Mohamed Salah", "Erling Haaland", "Gabriel").
     * 'team': Nama tim manajer FNB League. Tuliskan nama asli tim secara langsung TANPA awalan kata "Tim " (contoh: "KERTAPATI FC", "Ciss").
     * 'club': Nama klub Premier League (contoh: "Arsenal", "Man City", "Liverpool").
     * 'stat': Angka statistik, poin, peringkat, skor, persentase (contoh: "83 poin", "#1", "+2 pts", "3-0").
     * 'plain': Narasi jurnalisme yang luwes, elegan, dan kaya diksi olahraga.
   - DILARANG KERAS menggunakan kurung kategori seperti [BREAKING], [HOT], [REKOR], atau awalan "Judul: Cerita". Langsung mulai narasi alami!
   - Pastikan spasi antartoken tetap rapi sehingga kata tidak menempel saat digabungkan.
6. Berikan 'dramaScore' (40-100) sesuai tingkat urgensi dan emosi berita.
7. PRIORITAS UTAMA - DRAMA KUDETA PUNCAK KLASEMEN (TITLE RACE COUP):
   - Jika terdapat fakta [KUDETA TAKHTA BESAR] atau perebutan posisi #1 vs #2, WAJIB buat minimal 1-2 headline utama dengan dramaScore tinggi (95-100). Ceritakan bagaimana sang penguasa lama yang telah memimpin berpekan-pekan akhirnya digulingkan oleh aset diferensial sang pemuncak baru!
8. PENGINGAT DEADLINE (DEADLINE REMINDER) SAAT STATUS CONFIRMED:
   - Saat status [GW FINAL / CONFIRMED], fokus manajer liga beralih ke persiapan pekan depan. WAJIB buat 1 headline Pengingat Deadline GW berikutnya yang menyebutkan batas waktu hari dan jam WIB secara jelas (misal: "Pengingat Deadline GW 9: Tenggat transfer dan susunan pemain ditutup pada Sabtu, 31 Oktober 2026 pukul 18:00 WIB. Selesaikan rotasi tim sebelum batas waktu!").
9. AKURASI KONTEKS STATISTIK (GW TERAKHIR VS REKOR SEPANJANG MUSIM):
   - DILARANG memberitakan rekor sepanjang musim (seperti tepisan penalti kiper Raya atau Tzolakis, total saves musim berjalan, atau kartu merah akumulasi) seolah-olah baru saja terjadi di pertandingan Gameweek terakhir!
   - Boleh memberitakan pencapaian tersebut, tetapi WAJIB sebutkan konteksnya secara tepat sebagai rekor/koleksi musim ini (contoh: "Raya dan Tzolakis tercatat sebagai dua kiper elite dengan rekor penyelamatan penalti musim ini", BUKAN "Raya sukses menepis penalti di GW 8").`;

  const userPrompt = `Fakta lengkap liga dan pertandingan saat ini:
${leagueFacts}

Bahasa: ${isId ? 'Bahasa Indonesia jurnalisme olahraga modern' : 'English sports journalism'}.
Tolong buat 8-14 headline berita ticker berjalan dengan tokenisasi entitas yang bervariasi dan memikat.`;

  // Menggunakan 'gemini-3.1-flash-lite' terlebih dahulu karena kuota gratisnya jauh lebih besar,
  // lalu fallback ke 'gemini-flash-latest'.
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let response: any = null;
  let lastModelError: any = null;

  for (const modelName of candidateModels) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.85,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            description: 'Daftar headline berita berjalan FNB League dengan token entitas',
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                dramaScore: { type: Type.INTEGER },
                plainText: { type: Type.STRING },
                tokens: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      type: {
                        type: Type.STRING,
                        enum: ['player', 'team', 'club', 'stat', 'plain']
                      }
                    },
                    required: ['text', 'type']
                  }
                }
              },
              required: ['id', 'dramaScore', 'plainText', 'tokens']
            }
          }
        }
      });
      if (response && response.text) {
        break;
      }
    } catch (e: any) {
      lastModelError = e;
      console.warn(`[AI Newsroom] Model ${modelName} warning: ${e.message}`);
    }
  }

  try {
    if (!response || !response.text) {
      throw lastModelError || new Error('All candidate models failed to return a response');
    }

    const responseText = response.text?.trim() || '';
    if (!responseText) throw new Error('Empty response from Gemini API');

    const rawStories = JSON.parse(responseText);
    if (!Array.isArray(rawStories) || rawStories.length === 0) {
      throw new Error('Invalid stories array from Gemini API');
    }

    const processedStories: NewsStory[] = rawStories.map((s, sIdx) => {
      const tokens: NewsToken[] = (s.tokens || []).map((t: any) => {
        let text = String(t.text || '');
        const type = (['player', 'team', 'club', 'stat', 'plain'].includes(t.type) ? t.type : 'plain') as NewsToken['type'];
        
        // Pastikan nama tim TIDAK diawali kata "Tim " (kecuali nama asli memang "Tim Holland")
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

    memoryCache.set(cacheKey, {
      timestamp: Date.now(),
      hash: currentHash,
      stories: processedStories
    });

    // Simpan ke file persistent agar kebal terhadap restart container atau limit kuota
    persistAiStories(processedStories);

    console.log(`[AI Newsroom] Successfully generated ${processedStories.length} zero-template AI stories for phase '${phase}' (lang: ${lang})`);
    return processedStories;
  } catch (err: any) {
    console.warn('[AI Newsroom] Gemini quota or network notice. Serving persistent high-fidelity AI cache:', err.message);
    const fallbackStories = getFallbackPersistentStories(phase);
    memoryCache.set(cacheKey, { timestamp: Date.now(), hash: currentHash, stories: fallbackStories });
    return fallbackStories;
  }
}
