import { TransformedLeagueData, MatchCardItem, TransferItem } from '../types.ts';
import type { Language } from '../utils/i18n.ts';

/**
 * Tipe entitas untuk syntax highlighting di running text:
 * - 'plain': Narasi jurnalisme olahraga (putih lembut)
 * - 'player': Nama pemain FPL (neon fluorescent green #00ff87)
 * - 'team': Nama tim manajer FNB League (vibrant cyan #38bdf8)
 * - 'club': Nama klub EPL (amber / gold #fbbf24)
 * - 'stat': Poin / peringkat / statistik mikro (bold white)
 */
export type EntityType = 'plain' | 'player' | 'team' | 'club' | 'stat';

export interface NewsToken {
  text: string;
  type: EntityType;
}

export interface NewsStory {
  id: string;
  tokens: NewsToken[];
  plainText: string;
  dramaScore: number;
  timestamp: number;
  phase: 'confirmed' | 'lockout' | 'live' | 'intermission' | 'provisional';
  isFresh?: boolean;
}

// ============================================================================
// DETERMINISTIC GAMEWEEK & MATCHDAY PHASE (SESUAI RULE[AGENTS_md])
// ============================================================================
export function determineMatchdayPhase(
  data?: TransformedLeagueData | null,
  matches?: MatchCardItem[] | null
): 'confirmed' | 'lockout' | 'live' | 'intermission' | 'provisional' {
  if (!data) return 'confirmed';

  const gw = data.current_gw || 1;
  const gwStatus = data.gw_status?.status;
  const isChecked = Boolean(data.gw_status?.data_checked);
  const leaguesUpdated = data.gw_status?.leagues_status === 'Updated';

  // 1. GW Confirmed / Final: Selesai 100%, data diaudit Opta, poin bonus & klasemen terkunci mutlak
  if (gwStatus === 'Confirmed' || (isChecked && leaguesUpdated)) {
    return 'confirmed';
  }

  // Cek kondisi pertandingan aktif
  const activeMatches = (matches || []).filter(m => m.event === gw || !m.event);
  const ongoing = activeMatches.filter(m => m.started && !m.finished && !m.finished_provisional);
  const finished = activeMatches.filter(m => m.finished || m.finished_provisional);

  let hasLive = ongoing.length > 0;
  let hasFinished = finished.length > 0;
  let allFinished = activeMatches.length > 0 && finished.length === activeMatches.length;

  if (activeMatches.length === 0) {
    const fixtures = (data.sync_status?.gw_fixtures || []).filter(f => f.event === gw);
    hasLive = fixtures.some(f => f.started && !f.finished && !(f as any).finished_provisional);
    hasFinished = fixtures.some(f => f.finished || Boolean((f as any).finished_provisional));
    allFinished = fixtures.length > 0 && fixtures.every(f => f.finished || Boolean((f as any).finished_provisional));
  }

  // 2. Match Live: Minimal ada 1 laga sedang bertanding di lapangan
  if (hasLive || data.sync_status?.is_matchday_live) {
    return 'live';
  }

  // 3. GW Provisional: Seluruh 10 laga di lapangan tuntas, menunggu audit Opta BPS & autosub resmi FPL
  if (allFinished) {
    return 'provisional';
  }

  // 4. GW Live Intermission: Ada laga yang sudah selesai hari ini, menunggu laga besok/berikutnya
  if (hasFinished) {
    return 'intermission';
  }

  // 5. GW Lockout: Deadline transfer ditutup, susunan tim terkunci, laga pembuka belum kick-off
  return 'lockout';
}

// ============================================================================
// HELPER FORMAT NAMA TIM DINAMIS
// ============================================================================
export function formatTeamNames(
  teamNames: string[],
  maxToName: number = 3,
  isId: boolean = true
): NewsToken[] {
  if (!teamNames || teamNames.length === 0) return [];

  const unique = Array.from(new Set(teamNames));
  const count = unique.length;

  if (count === 1) {
    return [{ text: unique[0], type: 'team' as EntityType }];
  }

  if (count === 2) {
    return [
      { text: unique[0], type: 'team' as EntityType },
      { text: ' & ', type: 'plain' as EntityType },
      { text: unique[1], type: 'team' as EntityType },
    ];
  }

  if (count === 3 && maxToName >= 3) {
    return [
      { text: unique[0], type: 'team' as EntityType },
      { text: ', ', type: 'plain' as EntityType },
      { text: unique[1], type: 'team' as EntityType },
      { text: ' & ', type: 'plain' as EntityType },
      { text: unique[2], type: 'team' as EntityType },
    ];
  }

  const firstTwo = unique.slice(0, 2);
  const remaining = count - 2;
  return [
    { text: firstTwo[0], type: 'team' as EntityType },
    { text: ', ', type: 'plain' as EntityType },
    { text: firstTwo[1], type: 'team' as EntityType },
    {
      text: isId ? ` dan ${remaining} tim lainnya` : ` and ${remaining} other teams`,
      type: 'plain' as EntityType,
    },
  ];
}

// Helper penggabung token ke string teks polos
export function tokensToPlainText(tokens: NewsToken[]): string {
  return tokens.map(t => t.text).join('');
}

/**
 * Generator Berita Organik Ringan (Zero-Template Fallback)
 * HANYA digunakan jika server AI dan cache persistent sedang tidak dapat dijangkau.
 * TIDAK MENGGUNAKAN TEMPLATE KAKU ATAU FORMULA KALIMAT REPETITIF.
 * Mengalirkan fakta faktual liga langsung ke format token running text.
 */
export function generateDynamicNewsStories(
  data?: TransformedLeagueData | null,
  lang: Language = 'fnb',
  matches?: MatchCardItem[] | null
): NewsStory[] {
  if (!data) return [];

  const isId = lang === 'id';
  const gw = data.current_gw || 1;
  const phase = determineMatchdayPhase(data, matches);
  const stories: NewsStory[] = [];
  const now = Date.now();

  const standings = data.standings?.[gw] || [];
  const isGwFinal = phase === 'confirmed';

  // 1. Puncak Tahta & Juara Pekan Ini
  if (standings.length > 0) {
    const leader = standings[0];
    const runnerUp = standings[1];

    if (isGwFinal) {
      const champTokens: NewsToken[] = [
        { text: leader.entry_name, type: 'team' as EntityType },
        { text: isId ? ' memimpin klasemen akhir Gameweek ' : ' leads the final standings for Gameweek ', type: 'plain' as EntityType },
        { text: `${gw}`, type: 'stat' as EntityType },
        { text: isId ? ' dengan torehan ' : ' with ', type: 'plain' as EntityType },
        { text: `${leader.total_points} poin`, type: 'stat' as EntityType },
        ...(runnerUp ? [
          { text: isId ? ', unggul ' : ', ahead by ', type: 'plain' as EntityType },
          { text: `${leader.total_points - runnerUp.total_points} poin`, type: 'stat' as EntityType },
          { text: isId ? ' dari ' : ' over ', type: 'plain' as EntityType },
          { text: runnerUp.entry_name, type: 'team' as EntityType }
        ] : []),
      ];

      stories.push({
        id: `fb_leader_${gw}`,
        tokens: champTokens,
        plainText: tokensToPlainText(champTokens),
        dramaScore: 92,
        timestamp: now,
        phase: 'confirmed',
      });

      if (data.sync_status?.next_deadline_time) {
        try {
          const d = new Date(data.sync_status.next_deadline_time);
          const dateStr = d.toLocaleDateString(isId ? 'id-ID' : 'en-US', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'Asia/Jakarta'
          });
          const timeStr = d.toLocaleTimeString(isId ? 'id-ID' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Asia/Jakarta'
          });
          const deadlineTokens: NewsToken[] = [
            { text: isId ? `Pengingat Deadline GW ${gw + 1}: ` : `GW ${gw + 1} Deadline Reminder: `, type: 'plain' },
            { text: `${dateStr}, ${timeStr} WIB`, type: 'stat' },
            { text: isId ? ' • Pastikan susunan tim dan rotasi transfer selesai sebelum batas waktu!' : ' • Finalize transfers and starting XI before cutoff!', type: 'plain' }
          ];
          stories.push({
            id: `fb_deadline_${gw + 1}`,
            tokens: deadlineTokens,
            plainText: tokensToPlainText(deadlineTokens),
            dramaScore: 86,
            timestamp: now,
            phase: 'confirmed'
          });
        } catch {}
      }
    }

    // Skor GW Tertinggi
    const sortedByGwPts = [...standings].sort((a, b) => b.event_points - a.event_points);
    const topScorer = sortedByGwPts[0];
    if (topScorer) {
      const gwChampTokens: NewsToken[] = [
        { text: topScorer.entry_name, type: 'team' },
        { text: isId ? ' membukukan rekor skor tertinggi Gameweek ' : ' records highest score in Gameweek ', type: 'plain' },
        { text: `${gw}`, type: 'stat' },
        { text: isId ? ' dengan raihan spektakuler ' : ' with a stellar ', type: 'plain' },
        { text: `${topScorer.event_points} poin`, type: 'stat' },
      ];

      stories.push({
        id: `fb_gw_scorer_${gw}`,
        tokens: gwChampTokens,
        plainText: tokensToPlainText(gwChampTokens),
        dramaScore: 94,
        timestamp: now,
        phase,
      });
    }
  }

  // 2. Pemain Bintang Poin Tertinggi & DefCon
  const playerStats = Array.isArray(data.player_stats) ? data.player_stats : [];
  const topPlayer = [...playerStats].sort((a, b) => (b.eventPoints || 0) - (a.eventPoints || 0))[0];
  if (topPlayer && (topPlayer.eventPoints || 0) >= 10) {
    const starTokens: NewsToken[] = [
      { text: `${topPlayer.webName}`, type: 'player' },
      { text: isId ? ' menyumbang poin terbesar pekan ini dengan torehan ' : ' delivers the highest individual score this week with ', type: 'plain' },
      { text: `${topPlayer.eventPoints} poin`, type: 'stat' },
      { text: isId ? ` bersama ` : ` with `, type: 'plain' },
      { text: `${topPlayer.teamShort || 'EPL'}`, type: 'club' },
    ];

    stories.push({
      id: `fb_star_${topPlayer.id}_${gw}`,
      tokens: starTokens,
      plainText: tokensToPlainText(starTokens),
      dramaScore: 88,
      timestamp: now,
      phase,
    });
  }

  // 3. Status Gameweek FNB
  if (phase === 'provisional') {
    const auditTokens: NewsToken[] = [
      { text: isId ? 'Seluruh laga Gameweek ' : 'All matches for Gameweek ', type: 'plain' },
      { text: `${gw}`, type: 'stat' },
      { text: isId ? ' telah tuntas • Menunggu audit BPS Opta, autosub, dan pengesahan klasemen resmi FPL' : ' concluded • Awaiting Opta BPS audit, autosubs and official FPL league lock', type: 'plain' }
    ];
    stories.push({
      id: `fb_provisional_${gw}`,
      tokens: auditTokens,
      plainText: tokensToPlainText(auditTokens),
      dramaScore: 90,
      timestamp: now,
      phase: 'provisional',
    });
  }

  return stories;
}
