/**
 * ============================================================================
 * FPL NUSANTARA (FNB) - KATALOG NEWS TICKER (RUNNING TEXT)
 * ============================================================================
 * File ini merupakan katalog terpusat untuk seluruh konten running text pada News Ticker.
 * Anda dapat dengan mudah:
 * 1. Menyalakan / mematikan item tertentu: ubah `enabled: true` menjadi `false`.
 * 2. Mengubah kata-kata/teks & tag: edit langsung teks pada objek item di bawah.
 * 3. Mengatur urutan tampil: ubah angka `order`.
 * 4. Menambahkan pengumuman kustom: tambahkan ke array `CUSTOM_ANNOUNCEMENTS`.
 * ============================================================================
 */

import {
  TransformedLeagueData,
  MatchCardItem,
  PlayerOwnershipItem,
  PlayerOwnerItem,
  CaptainPlayerItem,
} from '../types.ts';
import { Language } from '../utils/i18n.ts';

/**
 * Helper untuk memformat daftar manajer & tim dengan gaya jurnalistik FPL:
 * contoh output:
 * - 1 tim: "Garuda FC (Budi)"
 * - 2 tim: "Garuda FC (Budi) & Kopi Senja (Andi)"
 * - > 2 tim: "Garuda FC (Budi), Kopi Senja (Andi), dkk."
 */
export function formatOwnersSnippet(
  owners?: PlayerOwnerItem[],
  maxNames: number = 2,
  isId: boolean = true
): string {
  if (!owners || owners.length === 0) return '';

  const names = owners.slice(0, maxNames).map(o => `${o.entry_name} (${o.player_name})`);
  const remaining = owners.length - maxNames;

  if (remaining <= 0) {
    if (names.length === 1) return names[0];
    return `${names[0]} & ${names[1]}`;
  }

  return `${names.join(', ')} ${isId ? 'dkk.' : '& others'}`;
}

export function formatCaptainsSnippet(
  owners?: PlayerOwnerItem[],
  maxNames: number = 2,
  isId: boolean = true
): string {
  if (!owners) return '';
  const captains = owners.filter(o => o.is_captain || o.multiplier > 1);
  return formatOwnersSnippet(captains, maxNames, isId);
}

export interface NewsItem {
  tag: string;
  text: string;
}

export type NewsCategory =
  | 'identity'     // Identitas & Pengumuman Liga
  | 'live_match'   // Skor Pertandingan Live Real-Time
  | 'match_impact' // Kombinasi Live Match & Dampaknya ke Liga FNB
  | 'differential' // Pemain Differential Meledak
  | 'defensive'    // Clean Sheet, CS Wipeout, DefCon, Saves
  | 'discipline'   // Kartu Merah, Penalti Gagal / Tepis, Gol Bunuh Diri
  | 'status'       // Status Siklus Gameweek (Live / Provisional / Confirmed)
  | 'standings'    // Pimpinan Klasemen Liga
  | 'champion'     // Juara Gameweek & Rekor Gelar
  | 'performance'  // Lonjakan Terbesar & Pemain Skor Tertinggi
  | 'trends'       // Pilihan Kapten & Kepemilikan Tertinggi Liga
  | 'transfers'    // Tren Transfer & Penalti Poin (Hits)
  | 'chips'        // Chip yang sedang diaktifkan
  | 'deadline'     // Batas Waktu Gameweek Berikutnya
  | 'announcement' // Pengumuman Tambahan / Kustom Admin
  | 'fallback';    // Konten cadangan saat data kosong

export type MatchFilterCondition = 'any' | 'has_live_matches' | 'no_live_matches';
export type GwStatusType = 'Not started' | 'Live' | 'Provisional' | 'Confirmed';

export interface DynamicNewsRule {
  id: string;
  title: string;
  category: NewsCategory;
  enabled: boolean;
  order: number;
  description: string;
  /**
   * Filter pemilahan kondisi penayangan:
   * - gwStatuses: daftar status GW yang diizinkan ('Not started', 'Live', 'Provisional', 'Confirmed').
   * - matchCondition:
   *     'any': Tampil tanpa mempermasalahkan ada/tidaknya laga live saat ini.
   *     'has_live_matches': Hanya tampil jika detik ini sedang ada laga Premier League yang berjalan.
   *     'no_live_matches': Hanya tampil jika saat ini TIDAK ADA laga yang sedang berjalan (jeda laga / jeda pekan).
   */
  conditions?: {
    gwStatuses?: GwStatusType[];
    matchCondition?: MatchFilterCondition;
  };
  generate: (
    data: TransformedLeagueData,
    lang: Language,
    matches?: MatchCardItem[] | null
  ) => NewsItem | NewsItem[] | null;
}

export interface CustomAnnouncementItem {
  id: string;
  title: string;
  enabled: boolean;
  order: number;
  tags: Record<Language, string>;
  texts: Record<Language, string>;
}

// ============================================================================
// 1. PENGUMUMAN KUSTOM / STATIS (Bisa Ditambah / Diedit Kapan Saja)
// ============================================================================
export const CUSTOM_ANNOUNCEMENTS: CustomAnnouncementItem[] = [
  {
    id: 'league_prizes',
    title: 'Informasi Hadiah Liga FNB',
    enabled: false, // Ubah ke true jika ingin menampilkan informasi hadiah
    order: 20,
    tags: {
      fnb: '💰 PRIZE POOL',
      en: '💰 PRIZE POOL',
      id: '💰 HADIAH LIGA',
    },
    texts: {
      fnb: 'Weekly Gameweek Champion bonus cash + Grand Prize end of season podium rewards!',
      en: 'Weekly Gameweek Champion bonus cash + Grand Prize end of season podium rewards!',
      id: 'Hadiah uang tunai mingguan untuk Juara Gameweek + Hadiah Podium Utama di akhir musim!',
    },
  },
  {
    id: 'fair_play_rules',
    title: 'Aturan Kompetisi & Fair Play',
    enabled: false, // Ubah ke true jika ingin menampilkan pengumuman aturan
    order: 21,
    tags: {
      fnb: '🛡️ FAIR PLAY',
      en: '🛡️ FAIR PLAY',
      id: '🛡️ ATURAN RESMI',
    },
    texts: {
      fnb: 'Strict 1 manager 1 team rule. Points deductions and autosubs follow official FPL rules.',
      en: 'Strict 1 manager 1 team rule. Points deductions and autosubs follow official FPL rules.',
      id: 'Wajib 1 manajer 1 tim. Pengurangan poin hit transfer dan pergantian autosub mengikuti aturan resmi FPL.',
    },
  },
  {
    id: 'community_group',
    title: 'Grup Komunitas & Admin',
    enabled: false, // Ubah ke true jika ingin menampilkan info komunitas
    order: 22,
    tags: {
      fnb: '💬 COMMUNITY',
      en: '💬 COMMUNITY',
      id: '💬 KOMUNITAS FNB',
    },
    texts: {
      fnb: 'Join our official WhatsApp & Discord community for matchday banter and discussion.',
      en: 'Join our official WhatsApp & Discord community for matchday banter and discussion.',
      id: 'Bergabung di grup resmi WhatsApp diskusi manajer FNB untuk info jadwal & seru-seruan matchday.',
    },
  },
];

// ============================================================================
// 2. KATALOG KONTEN CADANGAN / FALLBACK (Saat Data Belum Terunduh / Offline)
// ============================================================================
export const FALLBACK_NEWS_CATALOG: Record<Language, NewsItem[]> = {
  fnb: [
    {
      tag: '⚡ FPL NUSANTARA',
      text: 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes',
    },
    {
      tag: '📊 LIVE TRACKING',
      text: 'Real-time standings, provisional bonus points (BPS), and autosubs calculated automatically',
    },
    {
      tag: '🏆 CHAMPION RACE',
      text: 'Track the race for the league championship and Gameweek Champion crowns',
    },
    {
      tag: '👑 SQUAD TRENDS',
      text: 'Explore most captained picks, template squads, and top transfer movements',
    },
    {
      tag: '⚽ MATCHDAY PULSE',
      text: 'Good luck to all FNB managers in this Gameweek!',
    },
  ],
  en: [
    {
      tag: '⚡ FPL NUSANTARA',
      text: 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes',
    },
    {
      tag: '📊 LIVE TRACKING',
      text: 'Real-time standings, provisional bonus points (BPS), and autosubs calculated automatically',
    },
    {
      tag: '🏆 CHAMPION RACE',
      text: 'Track the race for the league championship and Gameweek Champion crowns',
    },
    {
      tag: '👑 SQUAD TRENDS',
      text: 'Explore most captained picks, template squads, and top transfer movements',
    },
    {
      tag: '⚽ MATCHDAY PULSE',
      text: 'Good luck to all FNB managers in this Gameweek!',
    },
  ],
  id: [
    {
      tag: '⚡ FPL NUSANTARA',
      text: 'Mini League Resmi 12356 • Musim 2026/2027 Berhadiah Uang Tunai Mingguan & Akhir Musim',
    },
    {
      tag: '📊 PANTAUAN LIVE',
      text: 'Klasemen real-time, poin bonus sementara (BPS), dan pergantian otomatis dihitung langsung',
    },
    {
      tag: '🏆 PEREBUTAN JUARA',
      text: 'Pantau persaingan gelar juara liga dan mahkota Juara Gameweek mingguan',
    },
    {
      tag: '👑 TREN SKUAD',
      text: 'Eksplorasi pilihan kapten terpopuler, tim template, dan pergerakan transfer pemain',
    },
    {
      tag: '⚽ SELAMAT BERTANDING',
      text: 'Semoga sukses untuk seluruh manajer FNB di Gameweek ini!',
    },
  ],
};

// ============================================================================
// 3. KATALOG ATURAN DINAMIS (Dihasilkan Otomatis Berdasarkan Data FPL Terkini)
// ============================================================================
export const DYNAMIC_NEWS_CATALOG: DynamicNewsRule[] = [
  // --------------------------------------------------------------------------
  // ITEM 1: Identitas Resmi Liga & Musim
  // --------------------------------------------------------------------------
  {
    id: 'league_identity',
    title: 'Identitas & Banner Liga FNB',
    category: 'identity',
    enabled: true,
    order: 1,
    description: 'Menampilkan nama mini league, ID liga resmi, dan pengumuman musim berjalan.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (_data, lang) => {
      const isId = lang === 'id';
      return {
        tag: '⚡ FPL NUSANTARA',
        text: isId
          ? 'Mini League Resmi 12356 • Musim 2026/2027 Berhadiah Uang Tunai Mingguan & Akhir Musim'
          : 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes',
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 2: SKOR LIVE PERTANDINGAN (Real-time Live Match Scoreboard)
  // --------------------------------------------------------------------------
  {
    id: 'live_match_scores',
    title: 'Skor Pertandingan Live Real-Time',
    category: 'live_match',
    enabled: true,
    order: 2,
    description: 'Menampilkan skor terkini laga Premier League yang sedang berlangsung beserta menit bermain.',
    conditions: {
      gwStatuses: ['Live'],
      matchCondition: 'has_live_matches', // Hanya tampil jika sedang ada laga yang berjalan
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;

      // 1. Cek dari detailed matches jika tersedia
      const ongoingFromMatches = (matches || []).filter(
        m => m.started && !m.finished && !m.finished_provisional
      );

      if (ongoingFromMatches.length > 0) {
        const items: NewsItem[] = [];
        for (const m of ongoingFromMatches.slice(0, 3)) {
          const homeName = m.home_team.short_name || 'H';
          const awayName = m.away_team.short_name || 'A';
          const scoreH = m.team_h_score ?? 0;
          const scoreA = m.team_a_score ?? 0;
          const clock = m.clock_label || (m.minutes ? `${m.minutes}'` : 'LIVE');

          // Cari pencetak gol di laga ini jika ada
          const allPlayers = [...(m.home_lineup || []), ...(m.away_lineup || [])];
          const scorers = allPlayers
            .filter(p => p.stats?.goals_scored && p.stats.goals_scored > 0)
            .map(p => `${p.web_name}${p.stats.goals_scored > 1 ? ` (${p.stats.goals_scored}⚽)` : ''}`);

          const scorerSnippet = scorers.length > 0 ? ` • Gol: ${scorers.join(', ')}` : '';

          items.push({
            tag: isId ? `🔴 LIVE ${clock}` : `🔴 LIVE ${clock}`,
            text: `${homeName} ${scoreH} - ${scoreA} ${awayName} (${clock})${scorerSnippet}`,
          });
        }
        return items.length > 0 ? items : null;
      }

      // 2. Fallback ke data.sync_status?.gw_fixtures jika detailed matches belum terunduh
      const gwFixtures = data.sync_status?.gw_fixtures || [];
      const ongoingFixtures = gwFixtures.filter(
        f => f.event === currentGW && f.started && !f.finished && !f.finished_provisional
      );

      if (ongoingFixtures.length > 0) {
        const items: NewsItem[] = [];
        for (const f of ongoingFixtures.slice(0, 3)) {
          const clock = f.minutes ? `${f.minutes}'` : 'LIVE';
          const scoreH = f.team_h_score ?? 0;
          const scoreA = f.team_a_score ?? 0;
          items.push({
            tag: isId ? `🔴 LIVE ${clock}` : `🔴 LIVE ${clock}`,
            text: `${f.home_team} ${scoreH} - ${scoreA} ${f.away_team} (${clock}) • Pertandingan sedang berlangsung di GW ${currentGW}`,
          });
        }
        return items.length > 0 ? items : null;
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 3: KOMBINASI LIVE MATCH DENGAN LIGA FNB (Match Impact on FNB League)
  // --------------------------------------------------------------------------
  {
    id: 'live_match_league_impact',
    title: 'Kombinasi Live Match & Dampaknya ke Liga FNB',
    category: 'match_impact',
    enabled: true,
    order: 3,
    description: 'Menghubungkan gol/assist/poin di laga live dengan berapa banyak manajer FNB yang memilikinya dan menjadikannya kapten.',
    conditions: {
      gwStatuses: ['Live'],
      matchCondition: 'has_live_matches', // Hanya tampil jika sedang ada laga yang berjalan
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const captainList = data.captain_players?.[currentGW] || [];

      // Peta kepemilikan dan kapten
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      const captainMap = new Map<number, CaptainPlayerItem>();
      captainList.forEach(c => captainMap.set(c.id, c));

      // 1. Jika ada matches detail dan ada laga live yang sedang berlangsung
      const ongoingMatches = (matches || []).filter(
        m => m.started && !m.finished && !m.finished_provisional
      );

      if (ongoingMatches.length > 0) {
        const impactNews: NewsItem[] = [];

        for (const m of ongoingMatches) {
          const allPlayers = [...(m.home_lineup || []), ...(m.away_lineup || [])];

          // Cari pemain yang mencetak gol / assist / BPS tinggi dan dimiliki manajer FNB
          const keyPerformers = allPlayers
            .filter(p => {
              const fnbInfo = ownershipMap.get(p.id);
              const playerPts = p.gw_points || p.stats?.total_points || 0;
              const hasImpact = (p.stats?.goals_scored && p.stats.goals_scored > 0) ||
                                (p.stats?.assists && p.stats.assists > 0) ||
                                playerPts >= 6;
              return hasImpact && fnbInfo && fnbInfo.owned_count > 0;
            })
            .sort((a, b) => {
              const ptsA = a.gw_points || a.stats?.total_points || 0;
              const ptsB = b.gw_points || b.stats?.total_points || 0;
              return ptsB - ptsA;
            });

          if (keyPerformers.length > 0) {
            const star = keyPerformers[0];
            const starPts = star.gw_points || star.stats?.total_points || 0;
            const fnbOwner = ownershipMap.get(star.id);
            const fnbCap = captainMap.get(star.id);
            const ownedCount = fnbOwner?.owned_count || 0;
            const capCount = fnbCap?.captain_count || 0;

            const actions: string[] = [];
            if (star.stats?.goals_scored) actions.push(`${star.stats.goals_scored} Gol`);
            if (star.stats?.assists) actions.push(`${star.stats.assists} Assist`);
            const actionText = actions.length > 0 ? ` (${actions.join(', ')})` : '';

            // Cantumkan nama tim & manajer yang menjadikannya kapten
            const capSnippet = formatCaptainsSnippet(fnbOwner?.owners, 2, isId);
            let capSuffix = '';
            if (capSnippet) {
              capSuffix = isId
                ? ` • Ban Kapten (x2 poin) dipanen oleh ${capSnippet}!`
                : ` • Captaincy (2x pts) claimed by ${capSnippet}!`;
            } else if (capCount > 0) {
              capSuffix = isId
                ? ` termasuk ${capCount} tim yang menjadikannya Kapten (x2 poin)!`
                : ` including ${capCount} teams who captained him (2x pts)!`;
            }

            // Cantumkan nama tim & manajer pemilik
            const ownersSnippet = formatOwnersSnippet(fnbOwner?.owners, 2, isId);
            const ownersPart = ownersSnippet
              ? (isId ? ` • Milik: ${ownersSnippet}` : ` • Owned by: ${ownersSnippet}`)
              : (isId ? ` • Menopang ${ownedCount} tim manajer FNB` : ` • Boosting ${ownedCount} FNB teams`);

            impactNews.push({
              tag: isId ? '⚡ DAMPAK LIVE MATCH' : '⚡ LIVE LEAGUE IMPACT',
              text: isId
                ? `${star.web_name} tampil impresif${actionText} mengantongi ${starPts} pts di laga ${m.home_team.short_name} vs ${m.away_team.short_name}${ownersPart}${capSuffix}`
                : `${star.web_name} starring${actionText} with ${starPts} pts in ${m.home_team.short_name} vs ${m.away_team.short_name}${ownersPart}${capSuffix}`,
            });
          }
        }

        if (impactNews.length > 0) return impactNews;
      }

      // 2. Jika tidak ada matches detail tapi matchday sedang live, kombinasikan dari pemain berpoin tertinggi GW ini
      const isLive = Boolean(data.sync_status?.is_matchday_live || data.gw_status?.status === 'Live');
      if (isLive && ownershipList.length > 0) {
        // Cari pemain yang sedang bermain dan memiliki event points tertinggi
        const topPerformer = [...ownershipList]
          .filter(p => typeof p.gw_points === 'number' && p.gw_points >= 6 && p.owned_count > 0)
          .sort((a, b) => (b.gw_points || 0) - (a.gw_points || 0))[0];

        if (topPerformer) {
          const capSnippet = formatCaptainsSnippet(topPerformer.owners, 2, isId);
          const ownersSnippet = formatOwnersSnippet(topPerformer.owners, 2, isId);
          const ownerPart = ownersSnippet ? ` • Skuad: ${ownersSnippet}` : ` • ${topPerformer.owned_count} tim`;
          const capPart = capSnippet ? (isId ? ` (Kapten x2: ${capSnippet})` : ` (Captain: ${capSnippet})`) : '';

          return {
            tag: isId ? '⚡ DAMPAK MATCHDAY LIVE' : '⚡ LIVE MATCHDAY IMPACT',
            text: isId
              ? `${topPerformer.web_name} (${topPerformer.team_short_name}) telah menyumbang ${topPerformer.gw_points} poin${ownerPart}${capPart}!`
              : `${topPerformer.web_name} (${topPerformer.team_short_name}) has bagged ${topPerformer.gw_points} pts${ownerPart}${capPart}!`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 4: DIFFERENTIAL EMAS (Differential Heroes with Big Points)
  // --------------------------------------------------------------------------
  {
    id: 'live_differential_hero',
    title: 'Pemain Differential yang Meledak Poinnya',
    category: 'differential',
    enabled: true,
    order: 4,
    description: 'Menyorot pemain dengan kepemilikan rendah di liga (≤ 15%) yang menghasilkan poin besar (gol/assist/defcon/bps tinggi).',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      if (ownershipList.length === 0) return null;

      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      // 1. Cari dari match lineup langsung jika ada data pertandingan
      if (matches && matches.length > 0) {
        const liveOrRecentMatches = matches.filter(m => m.started);
        for (const m of liveOrRecentMatches) {
          const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
          const diffs = players
            .filter(p => {
              const fnbInfo = ownershipMap.get(p.id);
              const pts = p.gw_points || p.stats?.total_points || 0;
              return fnbInfo && fnbInfo.owned_count > 0 && fnbInfo.owned_percentage <= 15 && pts >= 6;
            })
            .sort((a, b) => {
              const ptsA = a.gw_points || a.stats?.total_points || 0;
              const ptsB = b.gw_points || b.stats?.total_points || 0;
              return ptsB - ptsA;
            });

          if (diffs.length > 0) {
            const star = diffs[0];
            const starPts = star.gw_points || star.stats?.total_points || 0;
            const fnbInfo = ownershipMap.get(star.id)!;
            const reasons: string[] = [];
            if (star.stats?.goals_scored) reasons.push(`${star.stats.goals_scored} Gol`);
            if (star.stats?.assists) reasons.push(`${star.stats.assists} Assist`);
            if (star.stats?.clean_sheets) reasons.push(`Clean Sheet`);
            if (star.stats?.defensive_contribution) reasons.push(`DefCon`);
            const reasonStr = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';

            // Sebutkan nama manajer & tim yang memasangnya!
            const managerNames = formatOwnersSnippet(fnbInfo.owners, 2, isId);
            const managerSnippet = managerNames ? ` oleh ${managerNames}` : ` oleh ${fnbInfo.owned_count} manajer FNB`;

            return {
              tag: isId ? '💎 DIFFERENTIAL EMAS' : '💎 DIFFERENTIAL MASTERCLASS',
              text: isId
                ? `Punt brilian! ${star.web_name} (${star.team_short_name}) meledak dengan ${starPts} poin${reasonStr} • Dipetik${managerSnippet} (${fnbInfo.owned_percentage.toFixed(0)}% liga), mendongkrak peringkat secara masif!`
                : `Masterclass punt! ${star.web_name} (${star.team_short_name}) delivers a huge ${starPts} pts${reasonStr} • Picked${managerSnippet} (${fnbInfo.owned_percentage.toFixed(0)}% of league), fueling a major rank leap!`,
            };
          }
        }
      }

      // 2. Fallback dari ownership_players jika gw_points tinggi dan kepemilikan rendah
      const diffCandidates = [...ownershipList]
        .filter(p => p.owned_count > 0 && p.owned_percentage <= 15 && (p.gw_points || 0) >= 7)
        .sort((a, b) => (b.gw_points || 0) - (a.gw_points || 0));

      if (diffCandidates.length > 0) {
        const topDiff = diffCandidates[0];
        const managerNames = formatOwnersSnippet(topDiff.owners, 2, isId);
        const managerSnippet = managerNames ? ` bagi ${managerNames}` : ` bagi ${topDiff.owned_count} manajer FNB`;

        return {
          tag: isId ? '💎 DIFFERENTIAL EMAS' : '💎 DIFFERENTIAL MASTERCLASS',
          text: isId
            ? `Pilihan jeli! ${topDiff.web_name} (${topDiff.team_short_name}) menyumbang ${topDiff.gw_points} poin • Pembeda emas${managerSnippet} (${topDiff.owned_percentage.toFixed(0)}% liga)!`
            : `Sharp pick! ${topDiff.web_name} (${topDiff.team_short_name}) hauls ${topDiff.gw_points} pts • Golden differential${managerSnippet} (${topDiff.owned_percentage.toFixed(0)}% of league)!`,
        };
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 5: KREASI ASSIST & PLAYMAKER LIVE (Live Assists & Creators)
  // --------------------------------------------------------------------------
  {
    id: 'live_assist_playmakers',
    title: 'Kreasi Assist & Playmaker Pertandingan',
    category: 'match_impact',
    enabled: true,
    order: 5,
    description: 'Menampilkan pemain yang mencetak assist (+3 poin FPL) serta jumlah manajer FNB yang memilikinya.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      const activeMatches = matches.filter(m => m.started);
      for (const m of activeMatches) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
        const assistPlayers = players.filter(p => p.stats?.assists && p.stats.assists > 0);

        if (assistPlayers.length > 0) {
          const assistStar = assistPlayers[0];
          const fnbInfo = ownershipMap.get(assistStar.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const assistCount = assistStar.stats.assists;
          const ownersStr = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const targetStr = ownersStr
            ? (isId ? ` • Mengalirkan poin ke skuad ${ownersStr}` : ` • Pumping points into ${ownersStr}`)
            : (ownedCount > 0 ? (isId ? ` • Mengalirkan poin bagi ${ownedCount} skuad manajer FNB` : ` • Rewarding ${ownedCount} FNB manager(s)`) : '');

          return {
            tag: isId ? '🎯 KREASI ASSIST' : '🎯 PLAYMAKER ALERT',
            text: isId
              ? `Visi umpan matang! ${assistStar.web_name} (${assistStar.team_short_name}) membukukan ${assistCount > 1 ? `${assistCount} assist` : 'assist sah'} (+${assistCount * 3} pts FPL)${targetStr}!`
              : `Visionary craft! ${assistStar.web_name} (${assistStar.team_short_name}) provides ${assistCount > 1 ? `${assistCount} assists` : 'an assist'} (+${assistCount * 3} FPL pts)${targetStr}!`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 6: PUPUS NIRBOBOL (Clean Sheet Wipeout Alert)
  // --------------------------------------------------------------------------
  {
    id: 'live_cs_wipeout',
    title: 'Pupus Nirbobol (Clean Sheet Wipeout)',
    category: 'defensive',
    enabled: true,
    order: 6,
    description: 'Menyoroti kebobolan yang membatalkan potensi +4 poin clean sheet bagi bek dan kiper populer di liga FNB.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      // Cari match yang sudah berjalan dan ada tim yang kebobolan (score lawan > 0)
      for (const m of matches.filter(m => m.started)) {
        const homeConceded = (m.team_a_score ?? 0) > 0;
        const awayConceded = (m.team_h_score ?? 0) > 0;

        // Cek bek/kiper populer tuan rumah yang CS-nya wipeout
        if (homeConceded) {
          const homeDefs = (m.home_lineup || []).filter(
            p => (p.position === 'DEF' || p.position === 'GKP') && (ownershipMap.get(p.id)?.owned_count ?? 0) >= 3
          );
          if (homeDefs.length > 0) {
            const topDef = homeDefs[0];
            const fnbInfo = ownershipMap.get(topDef.id)!;
            const clock = m.clock_label || (m.minutes ? `${m.minutes}'` : 'FT');
            const ownersStr = formatOwnersSnippet(fnbInfo.owners, 2, isId);
            const affectedStr = ownersStr
              ? (isId ? ` • Kekecewaan bagi ${ownersStr}` : ` • Bitter blow for ${ownersStr}`)
              : (isId ? ` (${fnbInfo.owned_count} tim manajer FNB terdampak)` : ` (${fnbInfo.owned_count} FNB squads affected)`);

            return {
              tag: isId ? '🚫 CS WIPEOUT' : '🚫 CS WIPEOUT',
              text: isId
                ? `Nirbobol musnah! Gol ke gawang ${m.home_team.short_name} (${clock}) membatalkan potensi +4 clean sheet poin untuk ${topDef.web_name}${affectedStr}.`
                : `Clean sheet wiped! Conceding against ${m.away_team.short_name} (${clock}) wipes the +4 clean sheet bonus for ${topDef.web_name}${affectedStr}.`,
            };
          }
        }

        // Cek bek/kiper populer tim tamu yang CS-nya wipeout
        if (awayConceded) {
          const awayDefs = (m.away_lineup || []).filter(
            p => (p.position === 'DEF' || p.position === 'GKP') && (ownershipMap.get(p.id)?.owned_count ?? 0) >= 3
          );
          if (awayDefs.length > 0) {
            const topDef = awayDefs[0];
            const fnbInfo = ownershipMap.get(topDef.id)!;
            const clock = m.clock_label || (m.minutes ? `${m.minutes}'` : 'FT');
            const ownersStr = formatOwnersSnippet(fnbInfo.owners, 2, isId);
            const affectedStr = ownersStr
              ? (isId ? ` • Kekecewaan bagi ${ownersStr}` : ` • Bitter blow for ${ownersStr}`)
              : (isId ? ` (${fnbInfo.owned_count} tim manajer FNB terdampak)` : ` (${fnbInfo.owned_count} FNB squads affected)`);

            return {
              tag: isId ? '🚫 CS WIPEOUT' : '🚫 CS WIPEOUT',
              text: isId
                ? `Nirbobol musnah! Gol ke gawang ${m.away_team.short_name} (${clock}) membatalkan potensi +4 clean sheet poin untuk ${topDef.web_name}${affectedStr}.`
                : `Clean sheet wiped! Conceding against ${m.home_team.short_name} (${clock}) wipes the +4 clean sheet bonus for ${topDef.web_name}${affectedStr}.`,
            };
          }
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 7: KONTRIBUSI BERTAHAN (Defensive Contribution / DefCon Cap +2 Poin)
  // --------------------------------------------------------------------------
  {
    id: 'live_defcon_achieved',
    title: 'Kontribusi Bertahan (DefCon +2 Poin)',
    category: 'defensive',
    enabled: true,
    order: 7,
    description: 'Menampilkan pemain bertahan/tengah yang mencapai threshold aksi defensif (DEF >= 10 CBIT, MID/FWD >= 12 CBIRT) untuk bonus +2 poin resmi.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      for (const m of matches.filter(m => m.started)) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
        const defconStars = players.filter(p => {
          const dc = p.stats?.defensive_contribution || 0;
          const cbi = p.stats?.clearances_blocks_interceptions || 0;
          const t = p.stats?.tackles || 0;
          const r = p.stats?.recoveries || 0;
          const cbit = cbi + t;
          const cbirt = cbit + r;
          const hitThreshold = p.position === 'DEF' ? cbit >= 10 : cbirt >= 12;
          return dc > 0 || hitThreshold;
        });

        if (defconStars.length > 0) {
          const star = defconStars[0];
          const fnbInfo = ownershipMap.get(star.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const ownersStr = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const rewardStr = ownersStr
            ? (isId ? ` • Tambahan poin bagi skuad ${ownersStr}` : ` • Points boost for ${ownersStr}`)
            : (ownedCount > 0 ? (isId ? ` • Menguntungkan ${ownedCount} skuad manajer FNB` : ` • Rewarding ${ownedCount} FNB squads`) : '');

          return {
            tag: isId ? '🛡️ TEMBOK DEFCON' : '🛡️ DEFCON SECURED',
            text: isId
              ? `Tembok kokoh! ${star.web_name} (${star.team_short_name}) mengunci threshold kontribusi bertahan DefCon (+2 poin FPL) berkat dominasi tekel dan intersep di lapangan${rewardStr}.`
              : `Defensive shield! ${star.web_name} (${star.team_short_name}) locks in the +2 DefCon bonus via relentless tackles and interceptions${rewardStr}.`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 8: DRAMA PENALTI (Penalty Heroics & Heartbreak)
  // --------------------------------------------------------------------------
  {
    id: 'live_penalty_drama',
    title: 'Drama Penalti (Tepis Penalti & Gagal Penalti)',
    category: 'discipline',
    enabled: true,
    order: 8,
    description: 'Menampilkan penyelamatan penalti oleh kiper (+5 poin) atau kegagalan eksekutor penalti (-2 poin).',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      for (const m of matches.filter(m => m.started)) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];

        // 1. Cek Kiper Menepis Penalti (+5 poin)
        const penSaver = players.find(p => p.stats?.penalties_saved && p.stats.penalties_saved > 0);
        if (penSaver) {
          const fnbInfo = ownershipMap.get(penSaver.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const saverOwners = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const savedTarget = saverOwners
            ? (isId ? ` • Keberkahan besar bagi ${saverOwners}` : ` • Huge reward for ${saverOwners}`)
            : (ownedCount > 0 ? (isId ? ` • Keberkahan besar bagi ${ownedCount} manajer FNB` : ` • Massive boost for ${ownedCount} FNB manager(s)`) : '');

          return {
            tag: isId ? '🧤 PAHLAWAN PENALTI' : '🧤 PENALTY HERO',
            text: isId
              ? `Aksi heroik 12 pas! ${penSaver.web_name} (${penSaver.team_short_name}) menepis tendangan penalti langsung (+5 poin FPL)!${savedTarget}.`
              : `Penalty stop heroics! ${penSaver.web_name} (${penSaver.team_short_name}) denies the spot-kick (+5 FPL pts)!${savedTarget}.`,
          };
        }

        // 2. Cek Eksekutor Gagal Penalti (-2 poin)
        const penMisser = players.find(p => p.stats?.penalties_missed && p.stats.penalties_missed > 0);
        if (penMisser) {
          const fnbInfo = ownershipMap.get(penMisser.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const misserOwners = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const missedTarget = misserOwners
            ? (isId ? ` • Pukulan pahit bagi ${misserOwners}` : ` • Painful blow for ${misserOwners}`)
            : (ownedCount > 0 ? (isId ? ` • Mengecewakan ${ownedCount} manajer FNB` : ` • Denting tallies for ${ownedCount} FNB manager(s)`) : '');

          return {
            tag: isId ? '❌ GAGAL PENALTI' : '❌ PENALTY HEARTBREAK',
            text: isId
              ? `Peluang emas pupus! Eksekusi penalti ${penMisser.web_name} (${penMisser.team_short_name}) gagal berbuah gol (-2 poin FPL)${missedTarget}.`
              : `Agony from the spot! ${penMisser.web_name} (${penMisser.team_short_name}) misses a penalty (-2 FPL pts)${missedTarget}.`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 9: PETAKA KARTU MERAH (Red Card Drama)
  // --------------------------------------------------------------------------
  {
    id: 'live_red_card_drama',
    title: 'Petaka Kartu Merah Langsung & Pengurangan Poin',
    category: 'discipline',
    enabled: true,
    order: 9,
    description: 'Menampilkan pemain yang diusir keluar lapangan (-3 poin FPL) dan tetap menanggung risiko kebobolan tim.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      for (const m of matches.filter(m => m.started)) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
        const redCardPlayer = players.find(p => p.stats?.red_cards && p.stats.red_cards > 0);

        if (redCardPlayer) {
          const fnbInfo = ownershipMap.get(redCardPlayer.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const redOwners = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const redTarget = redOwners
            ? (isId ? ` • Pukulan pahit bagi skuad ${redOwners}` : ` • Painful blow for squad of ${redOwners}`)
            : (ownedCount > 0 ? (isId ? ` • Peringatan untuk ${ownedCount} manajer FNB` : ` • Liable for ${ownedCount} FNB owner(s)`) : '');

          return {
            tag: isId ? '🟥 PETAKA KARTU MERAH' : '🟥 RED CARD DISASTER',
            text: isId
              ? `Malam kelam! ${redCardPlayer.web_name} (${redCardPlayer.team_short_name}) diganjar kartu merah (-3 poin FPL)${redTarget} (penalti kebobolan tim tetap dihitung)!`
              : `Marching orders! ${redCardPlayer.web_name} (${redCardPlayer.team_short_name}) sent off with a red card (-3 FPL pts)${redTarget} (still liable for subsequent goals conceded)!`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 10: PEREBUTAN POIN BONUS OPTA LIVE (Live BPS Battle 3, 2, 1)
  // --------------------------------------------------------------------------
  {
    id: 'live_bps_battle',
    title: 'Perebutan Poin Bonus Opta (Live BPS Race 3, 2, 1)',
    category: 'performance',
    enabled: true,
    order: 10,
    description: 'Menampilkan 3 pemain dengan skor BPS tertinggi di pertandingan live yang memegang proyeksi +3, +2, +1 bonus points.',
    conditions: {
      gwStatuses: ['Live', 'Provisional'],
      matchCondition: 'any',
    },
    generate: (_data, lang, matches) => {
      const isId = lang === 'id';
      if (!matches || matches.length === 0) return null;

      const activeMatches = matches.filter(m => m.started);
      for (const m of activeMatches) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
        const topBps = players
          .filter(p => (p.stats?.bps || 0) >= 15)
          .sort((a, b) => (b.stats?.bps || 0) - (a.stats?.bps || 0))
          .slice(0, 3);

        if (topBps.length >= 2) {
          const p1 = topBps[0];
          const p2 = topBps[1];
          const p3 = topBps[2];

          const p3Snippet = p3 ? `, ${p3.web_name} (${p3.stats.bps} BPS / +1 pt)` : '';
          const matchLabel = `${m.home_team.short_name} vs ${m.away_team.short_name}`;

          return {
            tag: isId ? '⭐ PEREBUTAN BONUS BPS' : '⭐ OPTA BPS RACE',
            text: isId
              ? `Proyeksi bonus poin di ${matchLabel}: ${p1.web_name} memimpin (${p1.stats.bps} BPS / +3 pts), disusul ${p2.web_name} (${p2.stats.bps} BPS / +2 pts)${p3Snippet}.`
              : `Projected bonus points in ${matchLabel}: ${p1.web_name} leads (${p1.stats.bps} BPS / +3 pts), followed by ${p2.web_name} (${p2.stats.bps} BPS / +2 pts)${p3Snippet}.`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 11: AKSI PENYELAMATAN KIPER (Goalkeeper Saves Milestone)
  // --------------------------------------------------------------------------
  {
    id: 'live_goalkeeper_saves',
    title: 'Penyelamatan Kiper (Saves Milestone Kelipatan 3)',
    category: 'defensive',
    enabled: true,
    order: 11,
    description: 'Menampilkan kiper yang mencatatkan minimal 3 saves (+1 poin per 3 saves) membendung gempuran tembakan lawan.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      for (const m of matches.filter(m => m.started)) {
        const keepers = [...(m.home_lineup || []), ...(m.away_lineup || [])].filter(
          p => p.position === 'GKP' && (p.stats?.saves || 0) >= 3
        );

        if (keepers.length > 0) {
          const gkp = keepers[0];
          const saves = gkp.stats.saves;
          const savePts = Math.floor(saves / 3);
          const fnbInfo = ownershipMap.get(gkp.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const gkpOwners = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const gkpTarget = gkpOwners
            ? (isId ? ` • Membahagiakan benteng skuad ${gkpOwners}` : ` • Solid defense for ${gkpOwners}`)
            : (ownedCount > 0 ? (isId ? ` untuk ${ownedCount} skuad manajer FNB` : ` for ${ownedCount} FNB manager(s)`) : '');

          return {
            tag: isId ? '🧱 AKSI TERBANG KIPER' : '🧱 SHOT STOPPER HERO',
            text: isId
              ? `Tembok baja di bawah mistar! ${gkp.web_name} (${gkp.team_short_name}) membukukan ${saves} saves krusial (+${savePts} poin penyelamatan FPL)${gkpTarget}!`
              : `Defying the barrage! ${gkp.web_name} (${gkp.team_short_name}) registers ${saves} vital saves (+${savePts} FPL save points)${gkpTarget}!`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 12: PETAKA GOL BUNUH DIRI (Own Goal Agony)
  // --------------------------------------------------------------------------
  {
    id: 'live_own_goal_disaster',
    title: 'Petaka Gol Bunuh Diri (Own Goal -2 Poin)',
    category: 'discipline',
    enabled: true,
    order: 12,
    description: 'Menampilkan pemain yang mengalami nasib sial mencetak gol bunuh diri (-2 poin FPL).',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      if (!matches || matches.length === 0) return null;

      for (const m of matches.filter(m => m.started)) {
        const players = [...(m.home_lineup || []), ...(m.away_lineup || [])];
        const ogPlayer = players.find(p => p.stats?.own_goals && p.stats.own_goals > 0);

        if (ogPlayer) {
          const fnbInfo = ownershipMap.get(ogPlayer.id);
          const ownedCount = fnbInfo?.owned_count || 0;
          const ogOwners = formatOwnersSnippet(fnbInfo?.owners, 2, isId);
          const ogTarget = ogOwners
            ? (isId ? ` memangkas poin skuad ${ogOwners}` : ` denting ${ogOwners}`)
            : (ownedCount > 0 ? (isId ? ` memangkas poin ${ownedCount} skuad manajer FNB` : ` denting ${ownedCount} FNB squad(s)`) : '');

          return {
            tag: isId ? '🤦 GOL BUNUH DIRI' : '🤦 OWN GOAL AGONY',
            text: isId
              ? `Nasib sial! Sentuhan fatal ${ogPlayer.web_name} (${ogPlayer.team_short_name}) berujung gol bunuh diri (-2 poin penalti FPL)${ogTarget ? ` • ${ogTarget}` : ''}.`
              : `Cruel deflection! ${ogPlayer.web_name} (${ogPlayer.team_short_name}) suffers an own goal (-2 FPL pts penalty)${ogTarget ? ` • ${ogTarget}` : ''}.`,
          };
        }
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 13: HASIL PERTANDINGAN SELESAI & BINTANG LIGA (Recent Finished Match Recap)
  // --------------------------------------------------------------------------
  {
    id: 'recent_match_league_impact',
    title: 'Hasil Laga yang Baru Selesai & Pengaruhnya di Liga',
    category: 'match_impact',
    enabled: true,
    order: 13,
    description: 'Menampilkan hasil akhir pertandingan (FT) dan pemain kunci yang memberikan poin bagi manajer liga FNB.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang, matches) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const ownershipList = data.ownership_players?.[currentGW] || [];
      const ownershipMap = new Map<number, PlayerOwnershipItem>();
      ownershipList.forEach(p => ownershipMap.set(p.id, p));

      // Ambil laga yang baru selesai
      const finishedMatches = (matches || []).filter(
        m => m.finished || m.finished_provisional
      );

      if (finishedMatches.length > 0) {
        // Ambil match yang paling baru selesai
        const latestMatch = finishedMatches[finishedMatches.length - 1];
        const allPlayers = [...(latestMatch.home_lineup || []), ...(latestMatch.away_lineup || [])];
        const topScorerInMatch = allPlayers
          .map(p => ({ player: p, pts: p.gw_points || p.stats?.total_points || 0 }))
          .filter(x => x.pts > 0)
          .sort((a, b) => b.pts - a.pts)[0];

        let playerImpactSnippet = '';
        if (topScorerInMatch) {
          const { player, pts } = topScorerInMatch;
          const fnbOwner = ownershipMap.get(player.id);
          const starOwners = formatOwnersSnippet(fnbOwner?.owners, 2, isId);
          if (starOwners) {
            playerImpactSnippet = isId
              ? ` • Bintang laga: ${player.web_name} (${pts} pts) • Dimiliki: ${starOwners}`
              : ` • Star of the match: ${player.web_name} (${pts} pts) • Owned by: ${starOwners}`;
          } else if (fnbOwner && fnbOwner.owned_count > 0) {
            playerImpactSnippet = isId
              ? ` • Bintang laga: ${player.web_name} (${pts} pts, dimiliki ${fnbOwner.owned_count} tim FNB)`
              : ` • Star of the match: ${player.web_name} (${pts} pts, owned by ${fnbOwner.owned_count} FNB teams)`;
          }
        }

        return {
          tag: isId ? '🏁 HASIL LAGA SELESAI' : '🏁 FULL-TIME RECAP',
          text: `${latestMatch.home_team.short_name} ${latestMatch.team_h_score ?? 0} - ${latestMatch.team_a_score ?? 0} ${latestMatch.away_team.short_name} (FT)${playerImpactSnippet}`,
        };
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 14: Status Siklus Gameweek (Live / Provisional / Confirmed)
  // --------------------------------------------------------------------------
  {
    id: 'gw_status_lifecycle',
    title: 'Status Siklus Pertandingan Gameweek',
    category: 'status',
    enabled: true,
    order: 14,
    description: 'Menampilkan progres matchday (jumlah laga selesai), audit poin BPS Opta, dan autosub.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const isId = lang === 'id';
      const currentGW = data.current_gw || 1;
      const isLive = Boolean(data.sync_status?.is_matchday_live || data.gw_status?.status === 'Live');
      const isProvisional = data.gw_status?.status === 'Provisional';
      const isConfirmed = data.gw_status?.status === 'Confirmed';

      if (isLive) {
        const fixtures = data.sync_status?.gw_fixtures || [];
        const finishedCount = fixtures.filter(f => f.finished || Boolean((f as any).finished_provisional)).length;
        const totalCount = fixtures.length || 10;
        return {
          tag: isId ? `🔴 GW ${currentGW} LANGSUNG` : `🔴 GW ${currentGW} LIVE`,
          text: isId
            ? `${finishedCount} dari ${totalCount} laga selesai • Poin bonus BPS live dan autosub dihitung real-time`
            : `${finishedCount} of ${totalCount} matches played • Live bonus points (BPS) and autosubs calculating in real-time`,
        };
      }

      if (isProvisional) {
        return {
          tag: isId ? `⏳ GW ${currentGW} SEMENTARA` : `⏳ GW ${currentGW} PROVISIONAL`,
          text: isId
            ? 'Semua laga selesai • Menunggu audit final BPS Opta dan verifikasi autosub'
            : 'All matches concluded • Awaiting final Opta bonus point audit and autosub verification',
        };
      }

      if (isConfirmed) {
        return {
          tag: isId ? `🔒 GW ${currentGW} TERKONFIRMASI` : `🔒 GW ${currentGW} CONFIRMED`,
          text: isId
            ? 'Seluruh poin, bonus points, dan klasemen liga 100% sah dan dikunci oleh FPL'
            : 'All points, bonus points, and league standings are 100% verified and locked by FPL',
        };
      }

      return null;
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 15: Pimpinan Klasemen Liga (Rank 1)
  // --------------------------------------------------------------------------
  {
    id: 'league_leader',
    title: 'Pimpinan Klasemen Liga Saat Ini',
    category: 'standings',
    enabled: true,
    order: 15,
    description: 'Menampilkan nama tim dan manajer yang sedang memuncaki klasemen umum.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwStandings = data.standings?.[currentGW] || [];
      if (gwStandings.length === 0 || !gwStandings[0]) return null;

      const leader = gwStandings[0];
      const isId = lang === 'id';
      const isConfirmed = data.gw_status?.status === 'Confirmed';

      return {
        tag: isConfirmed
          ? (isId ? '🏆 PIMPINAN KLASEMEN' : '🏆 LEAGUE LEADER')
          : (isId ? '🏆 PIMPINAN SEMENTARA' : '🏆 PROVISIONAL LEADER'),
        text: isId
          ? `${leader.entry_name} (${leader.player_name}) memimpin klasemen ${isConfirmed ? '' : 'sementara '}dengan ${leader.total_points} poin`
          : `${leader.entry_name} (${leader.player_name}) sits atop the table ${isConfirmed ? '' : 'provisionally '}with ${leader.total_points} pts`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 16: Juara Gameweek (GW Champion)
  // --------------------------------------------------------------------------
  {
    id: 'gw_champion',
    title: 'Pemenang Gameweek (GW Champion)',
    category: 'champion',
    enabled: true,
    order: 16,
    description: 'Menampilkan manajer yang meraih poin tertinggi pada Gameweek berjalan/terbaru.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwChamps = data.gameweek_champions || [];
      const currentGwChampRow = gwChamps.find(c => c.event === currentGW) || gwChamps[gwChamps.length - 1];
      if (!currentGwChampRow || !Array.isArray(currentGwChampRow.champions) || currentGwChampRow.champions.length === 0) {
        return null;
      }

      const isId = lang === 'id';
      const isConfirmed = data.gw_status?.status === 'Confirmed';
      const champNames = currentGwChampRow.champions.map(c => `${c.entry_name} (${c.player_name})`).join(', ');

      if (isConfirmed) {
        return {
          tag: isId ? `🎖️ JUARA GW ${currentGwChampRow.event}` : `🎖️ GW ${currentGwChampRow.event} CHAMPION`,
          text: isId
            ? `${champNames} resmi meraih gelar juara Gameweek dengan torehan ${currentGwChampRow.points} poin!`
            : `${champNames} officially claimed the Gameweek title with an outstanding ${currentGwChampRow.points} pts!`,
        };
      } else {
        return {
          tag: isId ? `⏳ PIMPINAN SEMENTARA GW ${currentGwChampRow.event}` : `⏳ GW ${currentGwChampRow.event} PROVISIONAL LEADER`,
          text: isId
            ? `${champNames} memimpin Gameweek sementara dengan ${currentGwChampRow.points} poin (menunggu audit final)`
            : `${champNames} provisionally leads this Gameweek with ${currentGwChampRow.points} pts (awaiting final audit)`,
        };
      }
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 17: Pemegang Gelar Juara GW Terbanyak (Most GW Titles)
  // --------------------------------------------------------------------------
  {
    id: 'most_gw_titles',
    title: 'Kolektor Gelar Juara Gameweek Terbanyak',
    category: 'champion',
    enabled: true,
    order: 17,
    description: 'Menampilkan manajer dengan rekor kemenangan Juara Gameweek terbanyak musim ini.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'no_live_matches', // Sembunyikan saat ada laga live agar tidak memadati layar
    },
    generate: (data, lang) => {
      if (!Array.isArray(data.most_gameweek_champions) || data.most_gameweek_champions.length === 0) {
        return null;
      }

      const topLeader = data.most_gameweek_champions[0];
      if (!topLeader || topLeader.win_count <= 0) return null;

      const isId = lang === 'id';
      return {
        tag: isId ? '👑 JUARA GW TERBANYAK' : '👑 MOST GW TITLES',
        text: isId
          ? `${topLeader.entry_name} (${topLeader.player_name}) memimpin dengan ${topLeader.win_count} gelar Juara Gameweek`
          : `${topLeader.entry_name} (${topLeader.player_name}) leads with ${topLeader.win_count} Gameweek Champion crown${topLeader.win_count > 1 ? 's' : ''}`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 18: Lonjakan Peringkat Terbesar (Top Climber)
  // --------------------------------------------------------------------------
  {
    id: 'top_climber',
    title: 'Lonjakan Posisi Terbesar (Top Climber)',
    category: 'performance',
    enabled: true,
    order: 18,
    description: 'Menampilkan manajer yang naik peringkat paling banyak pada Gameweek ini.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwStandings = data.standings?.[currentGW] || [];
      const climbers = gwStandings
        .filter(s => typeof s.rank_change === 'number' && s.rank_change > 0)
        .sort((a, b) => b.rank_change - a.rank_change);

      if (climbers.length === 0 || climbers[0].rank_change <= 0) return null;

      const topClimber = climbers[0];
      const isId = lang === 'id';
      const isConfirmed = data.gw_status?.status === 'Confirmed';

      return {
        tag: isConfirmed
          ? (isId ? '🚀 LONJAKAN TERBESAR' : '🚀 TOP CLIMBER')
          : (isId ? '🚀 LONJAKAN SEMENTARA' : '🚀 PROVISIONAL TOP CLIMBER'),
        text: isId
          ? `${topClimber.entry_name} (${topClimber.player_name}) melesat naik +${topClimber.rank_change} posisi ke Peringkat #${topClimber.rank} (${topClimber.event_points} poin GW ini)`
          : `${topClimber.entry_name} (${topClimber.player_name}) surged +${topClimber.rank_change} spot${topClimber.rank_change > 1 ? 's' : ''} to Rank #${topClimber.rank} (${topClimber.event_points} pts this GW)`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 19: Persaingan Ban Kapten Terpopuler (Captaincy Battle)
  // --------------------------------------------------------------------------
  {
    id: 'captaincy_battle',
    title: 'Pilihan Kapten Terpopuler di Liga FNB',
    category: 'trends',
    enabled: true,
    order: 19,
    description: 'Menampilkan pemain Premier League yang paling banyak dipercaya sebagai kapten.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwCaptains = data.captain_players?.[currentGW] || [];
      if (gwCaptains.length === 0 || !gwCaptains[0]) return null;

      const cap1 = gwCaptains[0];
      const cap2 = gwCaptains[1];
      const isId = lang === 'id';

      // Cari tim teratas yang memilih kapten 1
      const cap1PlayerInfo = data.ownership_players?.[currentGW]?.find(p => p.id === cap1.id);
      const cap1Owners = cap1PlayerInfo?.owners?.filter(o => o.is_captain || o.multiplier > 1);
      const cap1Snippet = formatOwnersSnippet(cap1Owners, 2, isId);
      const pickedByStr = cap1Snippet ? (isId ? ` (seperti ${cap1Snippet})` : ` (including ${cap1Snippet})`) : '';

      let cap2Snippet = '';
      if (cap2) {
        cap2Snippet = isId
          ? `, disusul ${cap2.web_name} (${cap2.captain_count} tim, ${cap2.captain_percentage.toFixed(0)}%)`
          : `, followed by ${cap2.web_name} (${cap2.captain_count} teams, ${cap2.captain_percentage.toFixed(0)}%)`;
      }

      return {
        tag: isId ? '👑 PILIHAN KAPTEN' : '👑 CAPTAINCY BATTLE',
        text: isId
          ? `${cap1.web_name} menjadi kapten terpopuler (#1) dipilih ${cap1.captain_count} tim${pickedByStr}${cap2Snippet}`
          : `${cap1.web_name} is the #1 captain pick with ${cap1.captain_count} teams${pickedByStr}${cap2Snippet}`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 20: Pemain Kepemilikan Tertinggi (Template King)
  // --------------------------------------------------------------------------
  {
    id: 'highest_ownership',
    title: 'Pemain dengan Kepemilikan Tertinggi',
    category: 'trends',
    enabled: true,
    order: 20,
    description: 'Menampilkan pemain yang paling banyak dimiliki oleh manajer FNB.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'no_live_matches', // Sembunyikan saat laga live berlangsung
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwOwnership = data.ownership_players?.[currentGW] || [];
      if (gwOwnership.length === 0 || !gwOwnership[0]) return null;

      const topOwned = gwOwnership[0];
      const isId = lang === 'id';
      return {
        tag: isId ? '💎 KEPEMILIKAN TERTINGGI' : '💎 HIGHEST OWNERSHIP',
        text: isId
          ? `${topOwned.web_name} (${topOwned.team_short_name}) dimiliki oleh ${topOwned.owned_percentage.toFixed(0)}% manajer FNB (${topOwned.owned_count} skuad)`
          : `${topOwned.web_name} (${topOwned.team_short_name}) is selected by ${topOwned.owned_percentage.toFixed(0)}% of FNB managers (${topOwned.owned_count} squads)`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 21: Tren Transfer Masuk & Keluar (Transfer Trends)
  // --------------------------------------------------------------------------
  {
    id: 'transfer_trends',
    title: 'Tren Bursa Transfer (Paling Banyak Dibeli & Dijual)',
    category: 'transfers',
    enabled: true,
    order: 21,
    description: 'Menampilkan pemain paling laris dibeli dan pemain yang paling banyak dilepas.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'no_live_matches', // Sembunyikan saat laga live
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const transfersInList = data.transfers_in?.[String(currentGW)] || data.transfers_in?.['all'] || [];
      const transfersOutList = data.transfers_out?.[String(currentGW)] || data.transfers_out?.['all'] || [];

      if (transfersInList.length === 0 && transfersOutList.length === 0) return null;

      const isId = lang === 'id';
      const topIn = transfersInList[0];
      const topOut = transfersOutList[0];

      let inPart = '';
      let outPart = '';
      if (topIn) {
        inPart = isId
          ? `Paling banyak dibeli: ${topIn.web_name} (+${topIn.transfer_count})`
          : `Most bought: ${topIn.web_name} (+${topIn.transfer_count})`;
      }
      if (topOut) {
        outPart = isId
          ? `Paling banyak dijual: ${topOut.web_name} (-${topOut.transfer_count})`
          : `Most sold: ${topOut.web_name} (-${topOut.transfer_count})`;
      }

      const combined = [inPart, outPart].filter(Boolean).join(' • ');
      if (!combined) return null;

      return {
        tag: isId ? '🔄 TREN TRANSFER' : '🔄 TRANSFER TRENDS',
        text: combined,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 22: Chip yang Sedang Diaktifkan (Chips in Play)
  // --------------------------------------------------------------------------
  {
    id: 'chips_in_play',
    title: 'Chip yang Diaktifkan di Gameweek Ini',
    category: 'chips',
    enabled: true,
    order: 22,
    description: 'Menampilkan nama tim dan manajer yang mengaktifkan chip (Wildcard, Free Hit, Triple Captain, atau Bench Boost).',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwStandings = data.standings?.[currentGW] || [];
      const activeChipUsers = gwStandings
        .filter(s => s.active_chip)
        .map(s => `${s.entry_name} (${s.player_name}): ${s.active_chip?.toUpperCase()}`);

      if (activeChipUsers.length === 0) return null;

      const isId = lang === 'id';
      const sampleUsers = activeChipUsers.slice(0, 3).join(' • ');
      const remainingCount = activeChipUsers.length - 3;
      const suffix = remainingCount > 0 ? (isId ? ` dkk. (total ${activeChipUsers.length} tim)` : ` and others (total ${activeChipUsers.length} teams)`) : '';

      return {
        tag: isId ? '🃏 CHIP DIAKTIFKAN' : '🃏 CHIPS IN PLAY',
        text: isId
          ? `Kartu chip aktif GW ${currentGW}: ${sampleUsers}${suffix}`
          : `Active chips in GW ${currentGW}: ${sampleUsers}${suffix}`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 23: Penalti Poin Transfer / Hit (Transfer Hits)
  // --------------------------------------------------------------------------
  {
    id: 'transfer_hits',
    title: 'Penalti Poin Transfer (Transfer Hits / Minus)',
    category: 'transfers',
    enabled: true,
    order: 23,
    description: 'Menampilkan manajer yang mengambil penalti transfer paling besar dan total manajer yang terkena hit.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwStandings = data.standings?.[currentGW] || [];
      const hitTakers = gwStandings
        .filter(s => typeof s.event_transfers_cost === 'number' && s.event_transfers_cost > 0)
        .sort((a, b) => b.event_transfers_cost - a.event_transfers_cost);

      if (hitTakers.length === 0) return null;

      const topHit = hitTakers[0];
      const otherHits = hitTakers.slice(1, 3).map(h => `${h.entry_name} (-${h.event_transfers_cost})`).join(', ');
      const otherPart = otherHits ? (lang === 'id' ? `, disusul ${otherHits}` : `, followed by ${otherHits}`) : '';
      const totalHitTakers = hitTakers.length;
      const isId = lang === 'id';

      return {
        tag: isId ? '💀 PENALTI TRANSFER' : '💀 TRANSFER HITS',
        text: isId
          ? `${topHit.entry_name} (${topHit.player_name}) mengambil penalti transfer -${topHit.event_transfers_cost} poin${otherPart} • Total ${totalHitTakers} manajer hit GW ini`
          : `${topHit.entry_name} (${topHit.player_name}) took a -${topHit.event_transfers_cost} pts hit${otherPart} • Total ${totalHitTakers} manager${totalHitTakers > 1 ? 's' : ''} took penalties this GW`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 24: Pemain dengan Poin Tertinggi di Gameweek Ini (GW Top Performer)
  // --------------------------------------------------------------------------
  {
    id: 'gw_top_performer',
    title: 'Pemain dengan Skor Tertinggi di Gameweek Ini',
    category: 'performance',
    enabled: true,
    order: 24,
    description: 'Menampilkan pemain Premier League dengan raihan poin tertinggi di Gameweek ini.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'any',
    },
    generate: (data, lang) => {
      const currentGW = data.current_gw || 1;
      const gwOwnership = data.ownership_players?.[currentGW] || [];
      if (gwOwnership.length === 0) return null;

      const topScorer = [...gwOwnership].sort((a, b) => (b.gw_points || 0) - (a.gw_points || 0))[0];
      if (!topScorer || typeof topScorer.gw_points !== 'number' || topScorer.gw_points <= 0) {
        return null;
      }

      const isId = lang === 'id';
      return {
        tag: isId ? '🔥 PEMAIN TERBAIK GW' : '🔥 GW TOP PERFORMER',
        text: isId
          ? `${topScorer.web_name} (${topScorer.team_short_name}) mencetak ${topScorer.gw_points} poin di Gameweek ${currentGW}`
          : `${topScorer.web_name} (${topScorer.team_short_name}) delivered ${topScorer.gw_points} pts in Gameweek ${currentGW}`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // ITEM 25: Hitung Mundur Batas Waktu Gameweek Berikutnya (Next Deadline)
  // --------------------------------------------------------------------------
  {
    id: 'next_deadline',
    title: 'Batas Waktu Gameweek Berikutnya (Deadline Alert)',
    category: 'deadline',
    enabled: true,
    order: 25,
    description: 'Menampilkan jadwal batas waktu transfer dan penguncian susunan tim serta kapten.',
    conditions: {
      gwStatuses: ['Live', 'Provisional', 'Confirmed'],
      matchCondition: 'no_live_matches', // Sembunyikan saat sedang ada pertandingan live
    },
    generate: (data, lang) => {
      if (!data.sync_status?.next_deadline_time) return null;

      try {
        const deadlineDate = new Date(data.sync_status.next_deadline_time);
        if (isNaN(deadlineDate.getTime())) return null;

        const currentGW = data.current_gw || 1;
        const isId = lang === 'id';
        const locale = isId ? 'id-ID' : 'en-GB';

        const formattedDate = deadlineDate.toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Jakarta',
        });

        const formattedTime = deadlineDate.toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta',
          hour12: false,
        });

        const nextGw = currentGW < 38 ? currentGW + 1 : 38;
        return {
          tag: isId ? '⏳ BATAS WAKTU' : '⏳ NEXT DEADLINE',
          text: isId
            ? `Batas waktu Gameweek ${nextGw}: ${formattedDate} pukul ${formattedTime} WIB • Pastikan susunan tim & kapten terkunci`
            : `Gameweek ${nextGw} deadline: ${formattedDate} at ${formattedTime} WIB • Lock in squad & captain before cutoff`,
        };
      } catch {
        return null;
      }
    },
  },
];

// ============================================================================
// 4. GENERATOR UTAMA (Menghasilkan Daftar Running Text Berdasarkan Katalog)
// ============================================================================
export function generateNewsFromCatalog(
  data?: TransformedLeagueData | null,
  lang: Language = 'fnb',
  matches?: MatchCardItem[] | null
): NewsItem[] {
  const fallbackList = FALLBACK_NEWS_CATALOG[lang] || FALLBACK_NEWS_CATALOG.fnb;
  if (!data) return fallbackList;

  // 1. Identifikasi status GW saat ini ('Not started', 'Live', 'Provisional', atau 'Confirmed')
  const currentGwStatus: GwStatusType =
    data.gw_status?.status || (data.sync_status?.is_matchday_live ? 'Live' : 'Confirmed');

  // 2. Evaluasi apakah saat ini sedang ada match Premier League yang live berjalan
  const hasLiveMatches =
    (matches || []).some(m => m.started && !m.finished && !m.finished_provisional) ||
    Boolean(
      data.sync_status?.gw_fixtures?.some(
        f => f.event === data.current_gw && f.started && !f.finished && !(f as any).finished_provisional
      )
    );

  const results: { order: number; item: NewsItem }[] = [];

  // A. Kumpulkan item dinamis yang berstatus aktif (enabled: true) & lolos filter kondisi
  DYNAMIC_NEWS_CATALOG
    .filter(rule => rule.enabled)
    .forEach(rule => {
      // Filter 1: Validasi Status Gameweek
      if (rule.conditions?.gwStatuses && !rule.conditions.gwStatuses.includes(currentGwStatus)) {
        return;
      }

      // Filter 2: Validasi Kondisi Match Live
      if (rule.conditions?.matchCondition === 'has_live_matches' && !hasLiveMatches) {
        return;
      }
      if (rule.conditions?.matchCondition === 'no_live_matches' && hasLiveMatches) {
        return;
      }

      try {
        const generated = rule.generate(data, lang, matches);
        if (generated) {
          if (Array.isArray(generated)) {
            generated.forEach((item, subIdx) => {
              if (item && item.tag && item.text) {
                results.push({ order: rule.order + subIdx * 0.01, item });
              }
            });
          } else if (generated.tag && generated.text) {
            results.push({ order: rule.order, item: generated });
          }
        }
      } catch (err) {
        console.warn(`[NewsTickerCatalog] Error generating dynamic rule "${rule.id}":`, err);
      }
    });

  // B. Kumpulkan pengumuman kustom yang aktif (enabled: true)
  // Sembunyikan saat ada laga live agar running text tidak terlalu sesak dan memprioritaskan laga
  if (!hasLiveMatches) {
    CUSTOM_ANNOUNCEMENTS
      .filter(announcement => announcement.enabled)
      .forEach(announcement => {
        const tag = announcement.tags[lang] || announcement.tags.fnb || announcement.tags.en;
        const text = announcement.texts[lang] || announcement.texts.fnb || announcement.texts.en;
        if (tag && text) {
          results.push({
            order: announcement.order,
            item: { tag, text },
          });
        }
      });
  }

  // C. Urutkan berdasarkan nilai `order`
  results.sort((a, b) => a.order - b.order);

  const finalItems = results.map(r => r.item);
  return finalItems.length > 0 ? finalItems : fallbackList;
}
