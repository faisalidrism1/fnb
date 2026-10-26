import { GoogleGenAI, Type } from '@google/genai';
import { TransformedLeagueData, MatchCardItem, StandingsRow } from '../types.ts';
import { generateDynamicNewsStories, determineMatchdayPhase, NewsStory, NewsToken } from '../data/newsTickerEngine.ts';

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

const memoryCache = new Map<string, CacheEntry>();

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
 * 1. Status Gameweek (GW Final vs GW Live/Provisional) sesuai RULE[AGENTS_md]
 * 2. Seluruh Tampilan & Fitur Aplikasi (Klasemen, 4 Tipe Juara, Modal Pemain, Transfer, Kapten, Chips)
 * 3. Histori dari GW ke GW (Lonjakan peringkat, penurunan drastis, dinamika perebutan juara)
 * 4. Statistik Lengkap Modal Pemain (BPS, DefCon, Saves, Kartu, Penalti, Clean Sheet)
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
  // A. STATUS GAMEWEEK & POSTUR REDAKSI (SESUAI RULE[AGENTS_md])
  // ==========================================================================
  const isDataChecked = Boolean(data.gw_status?.data_checked);
  const isLeaguesUpdated = data.gw_status?.leagues_status === 'Updated';
  const isGwFinal = isDataChecked && isLeaguesUpdated;

  const activeMatches = (matches || []).filter(m => m.event === currentGw || !m.event);
  const liveMatches = activeMatches.filter(m => m.started && !m.finished && !m.finished_provisional);
  const finishedMatches = activeMatches.filter(m => m.finished || m.finished_provisional);
  const allMatchesFinished = activeMatches.length > 0 && finishedMatches.length === activeMatches.length;

  lines.push(`=== FPL NUSANTARA BERHADIAH (FNB LEAGUE) ===`);
  lines.push(`GAMEWEEK: GW ${currentGw}`);
  lines.push(`TOTAL MANAJER TERDAFTAR: ${standingsGw.length} Tim`);

  if (isGwFinal) {
    lines.push(`STATUS GAMEWEEK: [GW FINAL / 100% RESMI TERKUNCI]`);
    lines.push(`PANDUAN REDAKSI STATUS: Seluruh pertandingan telah selesai, audit Opta rampung, BPS 3-2-1 bonus poin permanen, autosub tuntas, hit transfer sudah dipotong, dan klasemen liga RESMI TERKUNCI. JANGAN gunakan frasa penantian atau spekulasi seperti "kita tunggu apakah...", "masih berpeluang bergeser", atau "menanti hasil akhir". Seluruh poin dan pemenang pekan ini dinyatakan sebagai fakta mutlak dan resmi.`);
  } else if (allMatchesFinished) {
    lines.push(`STATUS GAMEWEEK: [GW PROVISIONAL / SELURUH LAGA LAPANGAN SUDAH SELESAI]`);
    lines.push(`PANDUAN REDAKSI STATUS: Seluruh 10 pertandingan di lapangan SUDAH SELESAI 100%. TIDAK ADA pertandingan tersisa di lapangan, jadi DILARANG berkata "kita tunggu laga berikutnya" atau "masih ada pertandingan tersisa". Namun, poin bonus BPS dan klasemen masih berstatus PROVISIONAL menunggu audit akhir dan pengesahan FPL (autosub & bonus finalisasi). Jangan sebut sah terkunci permanen.`);
  } else if (liveMatches.length > 0) {
    lines.push(`STATUS GAMEWEEK: [GW LIVE MATCHDAY / SEDANG BERTANDING DI LAPANGAN]`);
    lines.push(`PANDUAN REDAKSI STATUS: Pertandingan EPL sedang berlangsung secara langsung di lapangan! Poin, BPS, dan posisi klasemen bergerak dinamis secara real-time. Sorot drama menit per menit di lapangan.`);
  } else if (finishedMatches.length > 0) {
    lines.push(`STATUS GAMEWEEK: [GW INTERMISSION / JEDA ANTAR-HARI PERTANDINGAN]`);
    lines.push(`PANDUAN REDAKSI STATUS: Sebagian pertandingan sudah selesai, namun masih ada pertandingan yang dijadwalkan bertanding di hari/jam berikutnya.`);
  } else {
    lines.push(`STATUS GAMEWEEK: [GW LOCKOUT / DEADLINE DITUTUP]`);
    lines.push(`PANDUAN REDAKSI STATUS: Deadline transfer telah ditutup, formasi tim terkunci, laga perdana segera dimulai.`);
  }

  // ==========================================================================
  // B. ARSITEKTUR TAMPILAN APLIKASI (UI CONTEXT)
  // ==========================================================================
  lines.push(`\n[STRUKTUR TAMPILAN APLIKASI YANG DILIHAT PENGGUNA]:`);
  lines.push(`- Tab Klasemen: Menampilkan Peringkat (#), Nama Tim (diawali "Tim "), Nama Manajer, Poin GW, Total Poin, Perubahan Peringkat (naik/turun), dan Poin Minus Transfer.`);
  lines.push(`- Subtab Status (4 Pilar Juara FNB League):`);
  lines.push(`  1. Overall Leader (Peringkat 1): Pemuncak klasemen total poin tertinggi sepanjang musim.`);
  lines.push(`  2. Top Challenger (Peringkat 2): Runner-up yang terus mengancam puncak.`);
  lines.push(`  3. Most GW Wins (Juara Terbanyak): Manajer peraih piala mingguan terbanyak (jika di Rank 1/2, dialihkan ke manajer eligible peringkat terbaik berikutnya).`);
  lines.push(`  4. Juara Gameweek: Peraih skor tertinggi di GW ini, berhak atas hadiah pekanan.`);
  lines.push(`- Modal Detail Pemain: Menampilkan statistik mikro: Menit main, Gol, Assist, Clean Sheet (CS), Saves kiper, DefCon (Defensive Contribution), Gol Kebobolan (GC), Kartu Kuning/Merah, Penalti, dan Bonus Point System (BPS).`);
  lines.push(`- Tab Transfer & Minus: Menampilkan aktivitas jual/beli dan daftar manajer dengan penalti transfer hit (minus 4 poin per transfer ekstra).`);
  lines.push(`- Tab Kapten & Chips: Menampilkan pilihan ban kapten (poin x2), vice-captain, dan chip aktif (Triple Captain, Bench Boost, Wildcard, Free Hit).`);

  // ==========================================================================
  // C. 4 PILAR JUARA & STATISTIK SKOR FNB LEAGUE SAAT INI
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

    lines.push('\n[DATA 4 PILAR JUARA FNB LEAGUE]:');
    if (rank1) lines.push(`- Pilar 1: Peringkat 1 (Overall Leader): Tim ${rank1.entry_name} (${rank1.player_name}) | Total: ${rank1.total_points} pts | GW${currentGw}: ${rank1.event_points} pts`);
    if (rank2) {
      const gap = (rank1?.total_points || 0) - rank2.total_points;
      lines.push(`- Pilar 2: Peringkat 2 (Top Challenger): Tim ${rank2.entry_name} (${rank2.player_name}) | Total: ${rank2.total_points} pts | GW${currentGw}: ${rank2.event_points} pts | Selisih jarak ke puncak: ${gap} poin`);
    }
    if (eligibleMostGw) {
      lines.push(`- Pilar 3: Juara Terbanyak (Most GW Wins): Tim ${eligibleMostGw.entry_name} (${eligibleMostGw.player_name}) | Memegang ${eligibleMostGw.win_count} gelar juara mingguan sepanjang musim`);
    }
    if (topGwNChamp) {
      lines.push(`- Pilar 4: Juara Gameweek ${currentGw}: Tim ${topGwNChamp.entry_name} (${topGwNChamp.player_name}) | Skor GW: ${topGwNChamp.points} poin`);
    }

    // Skor Poin GW: Tertinggi, Rata-rata, Terendah
    const ptsList = standingsGw.map(r => Number(r.event_points)).filter(p => !isNaN(p));
    if (ptsList.length > 0) {
      const highestPts = Math.max(...ptsList);
      const lowestPts = Math.min(...ptsList);
      const avgPts = Math.round(ptsList.reduce((a, b) => a + b, 0) / ptsList.length);
      const topGwTeam = standingsGw.find(r => r.event_points === highestPts);
      const lowGwTeam = standingsGw.find(r => r.event_points === lowestPts);
      lines.push(`\n[STATISTIK SKOR GAMEWEEK ${currentGw}]:`);
      lines.push(`- Skor Tertinggi Pekan Ini: ${highestPts} poin diraih Tim ${topGwTeam?.entry_name || '-'}`);
      lines.push(`- Rata-rata Skor Liga: ${avgPts} poin`);
      lines.push(`- Skor Terendah Pekan Ini: ${lowestPts} poin dialami Tim ${lowGwTeam?.entry_name || '-'}`);
    }
  }

  // ==========================================================================
  // D. HISTORI DARI GW KE GW (STANDINGS MOVEMENT & MOMENTUM)
  // ==========================================================================
  if (prevStandingsGw.length > 0 && standingsGw.length > 0) {
    const prevMap = new Map<number, StandingsRow>();
    prevStandingsGw.forEach(s => prevMap.set(s.entry_id, s));

    const movements = standingsGw.map(curr => {
      const prev = prevMap.get(curr.entry_id);
      const prevRank = prev ? prev.rank : curr.last_rank || curr.rank;
      const rankDiff = prevRank - curr.rank; // positif = naik peringkat, negatif = turun
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

    lines.push(`\n[DINAMIKA & HISTORI KLASEMEN GW${prevGw} KE GW${currentGw}]:`);
    if (topClimbers.length > 0) {
      lines.push(`- Lonjakan Peringkat Terbesar (Top Climbers):`);
      topClimbers.forEach(c => {
        lines.push(`  * Tim ${c.entry_name} (${c.player_name}): Melesat naik +${c.rank_diff} tingkat dari posisi #${c.prev_rank} ke #${c.current_rank} berkat torehan ${c.event_points} poin!`);
      });
    }

    if (bigFallers.length > 0) {
      lines.push(`- Penurunan Peringkat Paling Curam (Big Fallers):`);
      bigFallers.forEach(f => {
        lines.push(`  * Tim ${f.entry_name} (${f.player_name}): Merosot drastis ${Math.abs(f.rank_diff)} tingkat dari #${f.prev_rank} ke #${f.current_rank} setelah hanya meraup ${f.event_points} poin.`);
      });
    }

    // Perubahan Pucuk Klasemen (Kudeta Tahta)
    const prevLeader = prevStandingsGw.find(s => s.rank === 1);
    const currLeader = standingsGw.find(s => s.rank === 1);
    if (prevLeader && currLeader) {
      if (prevLeader.entry_id !== currLeader.entry_id) {
        lines.push(`- KUDETA TAKHTA: Terjadi pergantian pemimpin! Tim ${currLeader.entry_name} sukses mengkudeta Tim ${prevLeader.entry_name} dari puncak klasemen FNB League!`);
      } else {
        const prevGap = (prevStandingsGw[1] ? prevLeader.total_points - prevStandingsGw[1].total_points : 0);
        const currGap = (standingsGw[1] ? currLeader.total_points - standingsGw[1].total_points : 0);
        lines.push(`- KONSISTENSI PEMUNCAK: Tim ${currLeader.entry_name} mempertahankan posisi #1. Jarak ke peringkat 2 berubah dari ${prevGap} poin pekan lalu menjadi ${currGap} poin saat ini.`);
      }
    }
  }

  // ==========================================================================
  // E. STATISTIK MIKRO MODAL PEMAIN & DRAMA DI LAPANGAN
  // ==========================================================================
  const playerStatsList = Array.isArray(data.player_stats) ? data.player_stats : [];

  // 1. DefCon Heroes (Defensive Contribution: Bek CBIT >= 10, MID/FWD CBIRT >= 12 -> +2 pts)
  const defConStars = playerStatsList.filter(p => {
    const isDef = p.position === 'DEF';
    const cbi = p.clearances_blocks_interceptions || 0;
    const tackles = p.tackles || 0;
    const rec = p.recoveries || 0;
    return (isDef && (cbi + tackles) >= 10) || (!isDef && (cbi + tackles + rec) >= 12);
  }).slice(0, 4);

  // 2. Kiper Tembok Kokoh (Saves & Tepis Penalti)
  const topSavesGk = playerStatsList.filter(p => p.position === 'GKP' && (p.saves || 0) >= 4)
    .sort((a, b) => (b.saves || 0) - (a.saves || 0)).slice(0, 3);
  const penaltySavers = playerStatsList.filter(p => (p.penalties_saved || 0) > 0);

  // 3. Petaka Penalti Gagal & Kartu Merah
  const penaltyMissers = playerStatsList.filter(p => (p.penalties_missed || 0) > 0);
  const redCardPlayers = playerStatsList.filter(p => (p.red_cards || 0) > 0);

  // 4. BPS Kings (Opta Bonus Points 3, 2, 1)
  const bpsLeaders = [...playerStatsList].sort((a, b) => (b.bps || 0) - (a.bps || 0)).slice(0, 5);

  // 5. Diferensial FNB League (Pemain berpoin tinggi yang hanya dimiliki sedikit manajer)
  const ownershipMap = new Map<number, number>();
  (data.ownership_players?.[currentGw] || []).forEach(o => ownershipMap.set(o.id, o.owned_count));
  const differentialHaulers = playerStatsList.filter(p => {
    const count = ownershipMap.get(p.id) || 0;
    return count > 0 && count <= 3 && (p.eventPoints || 0) >= 9;
  }).slice(0, 4);

  lines.push(`\n[STATISTIK MIKRO PEMAIN & DRAMA LAPANGAN]:`);
  if (bpsLeaders.length > 0) {
    lines.push(`- Raja BPS Opta:`);
    bpsLeaders.forEach(p => {
      lines.push(`  * ${p.webName} (${p.teamShort}): ${p.eventPoints} poin, ${p.bps} BPS, +${p.bonus || 0} bonus points`);
    });
  }

  if (defConStars.length > 0) {
    lines.push(`- Pahlawan Kontribusi Bertahan (DefCon +2 Poin):`);
    defConStars.forEach(p => {
      lines.push(`  * ${p.webName} (${p.teamShort}, ${p.position}): Meraih bonus +2 pts DefCon berkat aksi defensif militan!`);
    });
  }

  if (topSavesGk.length > 0 || penaltySavers.length > 0) {
    lines.push(`- Tembok Penjaga Gawang:`);
    topSavesGk.forEach(gk => {
      const savePts = Math.floor((gk.saves || 0) / 3);
      lines.push(`  * ${gk.webName} (${gk.teamShort}): Melakukan ${gk.saves} penyelamatan (+${savePts} save points)!`);
    });
    penaltySavers.forEach(gk => {
      lines.push(`  * ${gk.webName} (${gk.teamShort}): Menepis tendangan penalti langsung (+5 poin heroik)!`);
    });
  }

  if (penaltyMissers.length > 0 || redCardPlayers.length > 0) {
    lines.push(`- Petaka & Mimpi Buruk:`);
    penaltyMissers.forEach(p => lines.push(`  * ${p.webName} (${p.teamShort}): Gagal mengeksekusi penalti (-2 poin petaka)!`));
    redCardPlayers.forEach(p => lines.push(`  * ${p.webName} (${p.teamShort}): Diusir wasit dengan kartu merah (-3 poin dan tetap kena penalti kebobolan lanjutan)!`));
  }

  if (differentialHaulers.length > 0) {
    lines.push(`- Kartu As Diferensial Komunitas FNB:`);
    differentialHaulers.forEach(p => {
      const owned = ownershipMap.get(p.id) || 1;
      lines.push(`  * ${p.webName} (${p.teamShort}): Meledak membukukan ${p.eventPoints} poin, padahal hanya dimiliki oleh ${owned} tim di liga!`);
    });
  }

  // ==========================================================================
  // F. PILIHAN KAPTEN, CHIP & TRANSFER HIT
  // ==========================================================================
  const captainsGw = (data.captain_players && data.captain_players[currentGw]) || [];
  if (captainsGw.length > 0) {
    lines.push(`\n[ANALISIS BAN KAPTEN]:`);
    captainsGw.slice(0, 4).forEach(c => {
      lines.push(`- ${c.web_name} (${c.team_short_name}): Dipilih oleh ${c.captain_count} tim (${c.captain_percentage}%), mengumpulkan ${c.gw_points} poin dasar (bernilai ${c.gw_points * 2} poin bagi para kapten)`);
    });
  }

  // Chip Aktif
  if (data.all_chips_used && data.all_chips_used.length > 0) {
    const activeChips: string[] = [];
    data.all_chips_used.forEach(row => {
      if (row.tc1?.gw === currentGw || row.tc2?.gw === currentGw) activeChips.push(`Tim ${row.entry_name} (Triple Captain)`);
      if (row.bb1?.gw === currentGw || row.bb2?.gw === currentGw) activeChips.push(`Tim ${row.entry_name} (Bench Boost)`);
      if (row.fh1?.gw === currentGw || row.fh2?.gw === currentGw) activeChips.push(`Tim ${row.entry_name} (Free Hit)`);
      if (row.wc1?.gw === currentGw || row.wc2?.gw === currentGw) activeChips.push(`Tim ${row.entry_name} (Wildcard)`);
    });
    if (activeChips.length > 0) {
      lines.push(`\n[CHIP AKTIF GW${currentGw}]:`);
      activeChips.slice(0, 6).forEach(c => lines.push(`- ${c}`));
    }
  }

  // Liga Minus (Transfer Hit)
  const transferHitsThisGw = standingsGw.filter(s => (s.event_transfers_cost || 0) > 0)
    .sort((a, b) => b.event_transfers_cost - a.event_transfers_cost).slice(0, 3);
  if (transferHitsThisGw.length > 0) {
    lines.push(`\n[TRANSFER HIT / LIGA MINUS GW${currentGw}]:`);
    transferHitsThisGw.forEach(s => {
      lines.push(`- Tim ${s.entry_name} (${s.player_name}): Rela memotong -${s.event_transfers_cost} poin demi perombakan transfer ekstra pekan ini`);
    });
  }

  // Hasil Pertandingan EPL
  if (activeMatches.length > 0) {
    lines.push(`\n[HASIL / SKOR PERTANDINGAN EPL GW${currentGw}]:`);
    activeMatches.forEach(m => {
      const home = m.home_team?.name || m.home_team?.short_name || 'Home';
      const away = m.away_team?.name || m.away_team?.short_name || 'Away';
      const score = m.started ? `${m.team_h_score ?? 0}–${m.team_a_score ?? 0}` : 'vs';
      const status = m.finished ? 'FT' : m.started ? `Menit ${m.minutes || m.clock_label || 'Live'}` : 'Mendatang';
      lines.push(`- ${home} ${score} ${away} [${status}]`);
    });
  }

  return lines.join('\n');
}

/**
 * Hasilkan berita berjalan dinamis berbobot dengan pemahaman FPL komprehensif
 */
export async function generateAiNewsTicker(
  data: TransformedLeagueData | null,
  matches: MatchCardItem[] | null,
  lang: 'id' | 'en' = 'id'
): Promise<NewsStory[]> {
  const phase = determineMatchdayPhase(data, matches);
  const cacheKey = `${lang}_${phase}`;
  const currentHash = createMatchStateHash(data, matches, lang);

  // TTL: Jika live 60s, jika tidak 300s (5 menit) untuk efisiensi kuota
  const ttl = phase === 'live' ? 60 * 1000 : 300 * 1000;
  const cached = memoryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < ttl) && cached.hash === currentHash) {
    return cached.stories;
  }

  if (!ai) {
    console.log('[AI Newsroom] GEMINI_API_KEY is not set. Using dynamic context engine fallback.');
    const fallbackStories = generateDynamicNewsStories(data, lang, matches);
    memoryCache.set(cacheKey, { timestamp: Date.now(), hash: currentHash, stories: fallbackStories });
    return fallbackStories;
  }

  const leagueFacts = compileLeagueFacts(data, matches, phase);
  const isId = lang === 'id';

  const systemInstruction = `Anda adalah Redaktur Utama & Jurnalis Olahraga Resmi untuk liga fantasi "FPL Nusantara BERHADIAH" (FNB League).
Tugas Anda: Menghasilkan 8 hingga 14 headline berita berjalan (news ticker) yang segar, cerdas, tajam, dramatis, dan sangat menarik.

PRINSIP UTAMA:
1. 100% BEBAS TEMPLATE DAN BEBAS KATALOG:
   - DILARANG menggunakan kalimat pembuka kaku yang berulang (seperti "kokoh di puncak tahta", "terpuruk di dasar", "habis-habisan mengeluarkan chip", dsb).
   - DILARANG membuat susunan berita yang monoton seperti daftar urut.
   - Bertindaklah seperti redaktur olahraga kawakan: pilih sudut berita (angle) paling dramatis, unik, dan menghibur dari fakta yang disediakan!
2. AKURASI STATUS GAMEWEEK:
   - Patuhi status Gameweek yang diberikan dalam fakta.
   - Jika status [GW FINAL]: Nyatakan bahwa semua hasil, poin, dan klasemen sudah SAH dan MUTLAK terkunci. JANGAN gunakan frasa menunggu/spekulasi.
   - Jika status [GW PROVISIONAL]: Seluruh pertandingan di lapangan sudah selesai (FT). JANGAN bilang "kita tunggu pertandingan tersisa" karena tidak ada laga lagi di lapangan. Namun sebutkan bahwa poin bonus BPS dan autosub sedang dalam antrean pengesahan audit akhir oleh FPL.
   - Jika status [GW LIVE]: Pertandingan sedang berjalan di lapangan secara real-time.
3. HISTORI GW KE GW:
   - Sorot drama pergeseran klasemen: siapa manajer yang melonjak naik berkat performa gemilang, siapa yang terjun bebas, dan bagaimana dinamika persaingan juara.
4. DRAMA STATISTIK MIKRO PEMAIN:
   - Manfaatkan detail statistik dari modal pemain: raihan +2 poin DefCon (Defensive Contribution) bek/gelandang, kegemilangan saves kiper, tepisan penalti, petaka kartu merah, hingga kartu as diferensial yang hanya dimiliki sedikit tim di liga.
5. FORMAT TOKENISASI & NAMA TIM:
   - Setiap berita dipecah menjadi token entitas:
     * 'player': Nama pemain FPL (contoh: "Mohamed Salah", "Erling Haaland", "Gabriel").
     * 'team': Nama tim manajer FNB League. WAJIB selalu diawali kata "Tim " (contoh: "Tim Yuk Bisa Yuk FC", "Tim Garuda Sakti").
     * 'club': Nama klub Premier League (contoh: "Arsenal", "Man City", "Liverpool").
     * 'stat': Angka statistik, poin, peringkat, skor, persentase (contoh: "14 poin", "#1", "+2 pts", "3-0").
     * 'plain': Narasi jurnalisme yang luwes, elegan, dan kaya diksi olahraga.
   - DILARANG KERAS menggunakan kurung kategori seperti [BREAKING], [HOT], [REKOR], atau awalan "Judul: Cerita". Langsung mulai narasi alami!
   - Pastikan spasi antartoken tetap rapi sehingga kata tidak menempel saat digabungkan.
6. Berikan 'dramaScore' (40-100) sesuai tingkat urgensi dan emosi berita.`;

  const userPrompt = `Fakta lengkap liga dan pertandingan saat ini:
${leagueFacts}

Bahasa: ${isId ? 'Bahasa Indonesia jurnalisme olahraga modern' : 'English sports journalism'}.
Tolong buat 8-14 headline berita ticker berjalan dengan tokenisasi entitas yang bervariasi dan memikat.`;

  // Model cascade: 'gemini-3.1-flash-lite' terlebih dahulu karena kuotanya terbukti aktif dan tidak terkena rate limit,
  // lalu fallback ke 'gemini-flash-latest' dan 'gemini-3.8-flash'.
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
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
      console.warn(`[AI Newsroom] Model ${modelName} failed (${e.message}), trying next model...`);
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
        
        // Pastikan nama tim selalu memiliki prefix "Tim "
        if (type === 'team' && !text.trim().startsWith('Tim ')) {
          text = text.replace(/^(\s*)(.*)$/, '$1Tim $2');
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

      const fullPlain = s.plainText || normalizedTokens.map(t => t.text).join('');

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

    console.log(`[AI Newsroom] Successfully generated ${processedStories.length} zero-template AI stories for phase '${phase}' (lang: ${lang})`);
    return processedStories;
  } catch (err: any) {
    console.warn('[AI Newsroom] Gemini fallback triggered:', err.message);
    const fallbackStories = generateDynamicNewsStories(data, lang, matches);
    memoryCache.set(cacheKey, { timestamp: Date.now(), hash: currentHash, stories: fallbackStories });
    return fallbackStories;
  }
}

