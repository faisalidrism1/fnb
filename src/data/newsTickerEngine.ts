import { TransformedLeagueData, MatchCardItem, TransferItem } from '../types.ts';
import type { Language } from '../utils/i18n.ts';

/**
 * Tipe entitas untuk syntax highlighting di running text:
 * - 'plain': Narasi umum (putih lembut)
 * - 'player': Nama pemain FPL (neon fluorescent green #00ff87)
 * - 'team': Nama tim manajer FNB League (vibrant cyan #38bdf8)
 * - 'club': Nama klub EPL (amber / gold #fbbf24)
 * - 'stat': Poin / peringkat / menit (bold white)
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
// HELPER PENENTUAN FASE MATCHDAY (DETERMINISTIC)
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

  // 1. GW Confirmed: Selesai 100% dan dikunci permanen
  if (gwStatus === 'Confirmed' || (isChecked && leaguesUpdated)) {
    return 'confirmed';
  }

  // Cek laga aktif
  const activeMatches = (matches || []).filter(m => m.event === gw || !m.event);
  const ongoing = activeMatches.filter(m => m.started && !m.finished && !m.finished_provisional);
  const finished = activeMatches.filter(m => m.finished || m.finished_provisional);

  // Fallback ke sync_status.gw_fixtures jika match-cards belum termuat
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

  // 3. GW Provisional: Seluruh 10 laga selesai tapi belum audit final FPL
  if (allFinished) {
    return 'provisional';
  }

  // 4. GW Live tapi sedang tidak ada match live (Jeda antarlaga)
  if (hasFinished) {
    return 'intermission';
  }

  // 5. GW Not Started / Lockout: Deadline lewat tapi belum kick-off laga pertama
  return 'lockout';
}

// ============================================================================
// HELPER FORMAT NAMA TIM DINAMIS (DYNAMIC TEAM ATTRIBUTION)
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
    return [{ text: `Tim ${unique[0]}`, type: 'team' as EntityType }];
  }

  if (count === 2) {
    return [
      { text: `Tim ${unique[0]}`, type: 'team' as EntityType },
      { text: ' & ', type: 'plain' as EntityType },
      { text: `Tim ${unique[1]}`, type: 'team' as EntityType },
    ];
  }

  if (count === 3 && maxToName >= 3) {
    return [
      { text: `Tim ${unique[0]}`, type: 'team' as EntityType },
      { text: ', ', type: 'plain' as EntityType },
      { text: `Tim ${unique[1]}`, type: 'team' as EntityType },
      { text: ' & ', type: 'plain' as EntityType },
      { text: `Tim ${unique[2]}`, type: 'team' as EntityType },
    ];
  }

  // 4 atau lebih: sebut 2 teratas + sisa
  const firstTwo = unique.slice(0, 2);
  const remaining = count - 2;
  return [
    { text: `Tim ${firstTwo[0]}`, type: 'team' as EntityType },
    { text: ', ', type: 'plain' as EntityType },
    { text: `Tim ${firstTwo[1]}`, type: 'team' as EntityType },
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

// ============================================================================
// THE HEURISTIC STORY ENGINE (AI LOGIKA BEBAS KUOTA)
// ============================================================================
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

  const ownershipList = data.ownership_players?.[gw] || [];
  const ownershipMap = new Map<number, any>();
  ownershipList.forEach(p => ownershipMap.set(p.id, p));

  const standings = data.standings?.[gw] || [];
  const allTeamsCount = standings.length || 20;

  // Map riwayat transfer keluar di GW aktif
  const allTransfers: TransferItem[] = (data.all_transfers || []).filter(t => t.event === gw);
  const transfersOutMap = new Map<number, { entry_names: string[]; totalOut: number; inPlayers: any[] }>();
  allTransfers.forEach(t => {
    if (t.element_out && t.element_out.id) {
      const pId = t.element_out.id;
      const current = transfersOutMap.get(pId) || { entry_names: [], totalOut: 0, inPlayers: [] };
      current.entry_names.push(t.entry_name);
      current.totalOut++;
      if (t.element_in) current.inPlayers.push(t.element_in);
      transfersOutMap.set(pId, current);
    }
  });

  // --------------------------------------------------------------------------
  // SIKLUS 1: GW CONFIRMED (Sebelum Deadline GW Baru / Pasca-Audit GW Selesai)
  // --------------------------------------------------------------------------
  if (phase === 'confirmed') {
    // 1. Juara Gameweek Resmi
    const champs = data.gameweek_champions || [];
    const latestChamp = champs.find(c => c.event === gw) || champs[champs.length - 1];
    if (latestChamp && Array.isArray(latestChamp.champions) && latestChamp.champions.length > 0) {
      const champTokens = formatTeamNames(latestChamp.champions.map(c => c.entry_name), 3, isId);
      const isCo = latestChamp.champions.length > 1;

      const tokens: NewsToken[] = isId
        ? [
            { text: isCo ? 'Selamat kepada Juara Bersama ' : 'Selamat kepada Juara Resmi ', type: 'plain' as EntityType },
            ...champTokens,
            { text: ` atas raihan Mahkota Juara Gameweek ${latestChamp.event} dengan koleksi `, type: 'plain' as EntityType },
            { text: `${latestChamp.points} poin`, type: 'stat' as EntityType },
            { text: '!', type: 'plain' as EntityType },
          ]
        : [
            { text: isCo ? 'Congratulations to Co-Champions ' : 'Congratulations to Official Champion ', type: 'plain' as EntityType },
            ...champTokens,
            { text: ` for claiming the Gameweek ${latestChamp.event} Crown with `, type: 'plain' as EntityType },
            { text: `${latestChamp.points} points`, type: 'stat' as EntityType },
            { text: '!', type: 'plain' as EntityType },
          ];

      stories.push({
        id: `confirmed_champ_${latestChamp.event}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 95,
        timestamp: now,
        phase: 'confirmed',
      });
    }

    // 2. Pemuncak Klasemen Sah (League Leader)
    if (standings.length > 0 && standings[0]) {
      const leader = standings[0];
      const runnerUp = standings[1];
      const gap = runnerUp ? leader.total_points - runnerUp.total_points : 0;

      const tokens: NewsToken[] = isId
        ? [
            { text: `Tim ${leader.entry_name}`, type: 'team' as EntityType },
            { text: ' bertengger kokoh di puncak tahta FNB League dengan koleksi ', type: 'plain' as EntityType },
            { text: `${leader.total_points} poin`, type: 'stat' as EntityType },
            ...(runnerUp
              ? [
                  { text: ' (unggul ', type: 'plain' as EntityType },
                  { text: `${gap} poin`, type: 'stat' as EntityType },
                  { text: ' atas ', type: 'plain' as EntityType },
                  { text: `Tim ${runnerUp.entry_name}`, type: 'team' as EntityType },
                  { text: ')', type: 'plain' as EntityType },
                ]
              : []),
          ]
        : [
            { text: `Tim ${leader.entry_name}`, type: 'team' as EntityType },
            { text: ' commands the top spot with ', type: 'plain' as EntityType },
            { text: `${leader.total_points} cumulative points`, type: 'stat' as EntityType },
            ...(runnerUp
              ? [
                  { text: ' (holding a ', type: 'plain' as EntityType },
                  { text: `${gap}-point lead`, type: 'stat' as EntityType },
                  { text: ' over ', type: 'plain' as EntityType },
                  { text: `Tim ${runnerUp.entry_name}`, type: 'team' as EntityType },
                  { text: ')', type: 'plain' as EntityType },
                ]
              : []),
          ];

      stories.push({
        id: `confirmed_leader_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 90,
        timestamp: now,
        phase: 'confirmed',
      });
    }

    // 3. Rekor Juara GW Terbanyak (Most GW Titles)
    const mostWins = data.most_gameweek_champions || [];
    if (mostWins.length > 0 && mostWins[0].win_count > 0) {
      const topWins = mostWins[0].win_count;
      const leadersWithTopWins = mostWins.filter(m => m.win_count === topWins);
      const teamTokens = formatTeamNames(leadersWithTopWins.map(m => m.entry_name), 3, isId);

      const tokens: NewsToken[] = isId
        ? [
            ...teamTokens,
            { text: ' memimpin perolehan gelar juara mingguan terbanyak musim ini dengan ', type: 'plain' as EntityType },
            { text: `${topWins} trofi`, type: 'stat' as EntityType },
          ]
        : [
            ...teamTokens,
            { text: ' leads the season campaign with ', type: 'plain' as EntityType },
            { text: `${topWins} Gameweek Champion titles`, type: 'stat' as EntityType },
          ];

      stories.push({
        id: `confirmed_most_wins_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 82,
        timestamp: now,
        phase: 'confirmed',
      });
    }
  }

  // --------------------------------------------------------------------------
  // SIKLUS 2: GW NOT STARTED / LOCKOUT (Deadline Lewat, Tim Terkunci, Belum Kick-off)
  // --------------------------------------------------------------------------
  if (phase === 'lockout') {
    // 1. Bursa Kapten: Dominasi vs Perpecahan Pilihan
    const captains = data.captain_players?.[gw] || [];
    if (captains.length >= 2) {
      const c1 = captains[0];
      const c2 = captains[1];
      const pct1 = Math.round((c1.captain_count / allTeamsCount) * 100);

      // Dominasi mutlak (>= 50%)
      if (pct1 >= 50) {
        const tokens: NewsToken[] = isId
          ? [
              { text: 'Bursa Kapten Mutlak: ', type: 'plain' as EntityType },
              { text: c1.web_name, type: 'player' as EntityType },
              { text: ' kuasai kepercayaan mayoritas liga dengan ', type: 'plain' as EntityType },
              { text: `${c1.captain_count} tim (${pct1}%)`, type: 'stat' as EntityType },
              { text: ', sementara ', type: 'plain' as EntityType },
              { text: c2.web_name, type: 'player' as EntityType },
              { text: ` menjadi pilihan pembeda utama (${c2.captain_count} tim)`, type: 'plain' as EntityType },
            ]
          : [
              { text: 'Consensus Armband: ', type: 'plain' as EntityType },
              { text: c1.web_name, type: 'player' as EntityType },
              { text: ' commands absolute league trust across ', type: 'plain' as EntityType },
              { text: `${c1.captain_count} teams (${pct1}%)`, type: 'stat' as EntityType },
              { text: ', leaving ', type: 'plain' as EntityType },
              { text: c2.web_name, type: 'player' as EntityType },
              { text: ` as the top differential alternative (${c2.captain_count} teams)`, type: 'plain' as EntityType },
            ];

        stories.push({
          id: `lockout_captain_dominance_gw${gw}`,
          tokens,
          plainText: tokensToPlainText(tokens),
          dramaScore: 92,
          timestamp: now,
          phase: 'lockout',
        });
      } else {
        // Duel Kapten Ketat
        const tokens: NewsToken[] = isId
          ? [
              { text: 'Perang Ban Kapten: Pilihan liga terpecah sengit antara ', type: 'plain' as EntityType },
              { text: c1.web_name, type: 'player' as EntityType },
              { text: ` (${c1.captain_count} tim) dan `, type: 'plain' as EntityType },
              { text: c2.web_name, type: 'player' as EntityType },
              { text: ` (${c2.captain_count} tim) menjelang sepak mula pertama`, type: 'plain' as EntityType },
            ]
          : [
              { text: 'Armband Duopoly: League captaincy divided between ', type: 'plain' as EntityType },
              { text: c1.web_name, type: 'player' as EntityType },
              { text: ` (${c1.captain_count} teams) and `, type: 'plain' as EntityType },
              { text: c2.web_name, type: 'player' as EntityType },
              { text: ` (${c2.captain_count} teams) ahead of kick-off`, type: 'plain' as EntityType },
            ];

        stories.push({
          id: `lockout_captain_duel_gw${gw}`,
          tokens,
          plainText: tokensToPlainText(tokens),
          dramaScore: 88,
          timestamp: now,
          phase: 'lockout',
        });
      }
    }

    // 2. Agresivitas Penalti Hits (Transfer Minus)
    const hitTakers = standings
      .filter(s => typeof s.event_transfers_cost === 'number' && s.event_transfers_cost > 0)
      .sort((a, b) => b.event_transfers_cost - a.event_transfers_cost);

    if (hitTakers.length > 0) {
      const count = hitTakers.length;
      const totalCost = hitTakers.reduce((sum, h) => sum + h.event_transfers_cost, 0);
      const topHit = hitTakers[0];
      const secondHit = hitTakers[1];

      const tokens: NewsToken[] = isId
        ? [
            { text: 'Agresivitas Bursa: Sebanyak ', type: 'plain' as EntityType },
            { text: `${count} manajer`, type: 'stat' as EntityType },
            { text: ' nekat mengambil penalti transfer (total ', type: 'plain' as EntityType },
            { text: `-${totalCost} poin`, type: 'stat' as EntityType },
            { text: ') • ', type: 'plain' as EntityType },
            { text: `Tim ${topHit.entry_name}`, type: 'team' as EntityType },
            { text: ' mengambil minus terbesar dengan ', type: 'plain' as EntityType },
            { text: `-${topHit.event_transfers_cost} poin`, type: 'stat' as EntityType },
            ...(secondHit && secondHit.event_transfers_cost < topHit.event_transfers_cost
              ? [
                  { text: ', disusul ', type: 'plain' as EntityType },
                  { text: `Tim ${secondHit.entry_name}`, type: 'team' as EntityType },
                  { text: ` (-${secondHit.event_transfers_cost} poin)`, type: 'stat' as EntityType },
                ]
              : []),
          ]
        : [
            { text: 'Market Aggression: A total of ', type: 'plain' as EntityType },
            { text: `${count} managers`, type: 'stat' as EntityType },
            { text: ' take point deductions (total ', type: 'plain' as EntityType },
            { text: `-${totalCost} pts`, type: 'stat' as EntityType },
            { text: ') • ', type: 'plain' as EntityType },
            { text: `Tim ${topHit.entry_name}`, type: 'team' as EntityType },
            { text: ' incurs the heaviest hit with ', type: 'plain' as EntityType },
            { text: `-${topHit.event_transfers_cost} pts`, type: 'stat' as EntityType },
            ...(secondHit && secondHit.event_transfers_cost < topHit.event_transfers_cost
              ? [
                  { text: ', followed by ', type: 'plain' as EntityType },
                  { text: `Tim ${secondHit.entry_name}`, type: 'team' as EntityType },
                  { text: ` (-${secondHit.event_transfers_cost} pts)`, type: 'stat' as EntityType },
                ]
              : []),
          ];

      stories.push({
        id: `lockout_hits_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 86,
        timestamp: now,
        phase: 'lockout',
      });
    }

    // 3. Aset Paling Banyak Dilepas (Top Sell Exodus)
    const transfersOut = data.transfers_out?.[String(gw)] || data.transfers_out?.['all'] || [];
    if (transfersOut.length > 0 && transfersOut[0].transfer_count >= 2) {
      const topSell = transfersOut[0];
      const countSold = topSell.transfer_count;
      const teamShort = topSell.team_short_name || '';

      const tokens: NewsToken[] = isId
        ? [
            { text: 'Pelepasan Massal: ', type: 'plain' as EntityType },
            { text: topSell.web_name, type: 'player' as EntityType },
            ...(teamShort ? [{ text: ` (${teamShort})`, type: 'club' as EntityType }] : []),
            { text: ' jadi aset paling banyak dilepas manajer pekan ini (dijual ', type: 'plain' as EntityType },
            { text: `${countSold} tim`, type: 'stat' as EntityType },
            { text: ') menjelang batas waktu GW ', type: 'plain' as EntityType },
            { text: `${gw}`, type: 'stat' as EntityType },
          ]
        : [
            { text: 'Mass Exodus: ', type: 'plain' as EntityType },
            { text: topSell.web_name, type: 'player' as EntityType },
            ...(teamShort ? [{ text: ` (${teamShort})`, type: 'club' as EntityType }] : []),
            { text: ' suffers the biggest drop this round (offloaded by ', type: 'plain' as EntityType },
            { text: `${countSold} teams`, type: 'stat' as EntityType },
            { text: ') heading into GW ', type: 'plain' as EntityType },
            { text: `${gw}`, type: 'stat' as EntityType },
          ];

      stories.push({
        id: `lockout_top_sell_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 84,
        timestamp: now,
        phase: 'lockout',
      });
    }
  }

  // --------------------------------------------------------------------------
  // SIKLUS 3: MATCH LIVE (Pertandingan Sedang Berlangsung di Lapangan)
  // Menemukan & Mengangkat Seluruh Drama Nyata!
  // --------------------------------------------------------------------------
  if (phase === 'live') {
    const ongoingMatches = (matches || []).filter(
      m => m.started && !m.finished && !m.finished_provisional
    );

    for (const m of ongoingMatches) {
      const homeName = m.home_team.short_name || 'H';
      const awayName = m.away_team.short_name || 'A';
      const scoreH = m.team_h_score ?? 0;
      const scoreA = m.team_a_score ?? 0;
      const clock = m.clock_label || (m.minutes ? `${m.minutes}'` : "LIVE");
      const matchLabel = `${homeName} vs ${awayName}`;

      const allPlayers = [...(m.home_lineup || []), ...(m.away_lineup || [])];

      // DRAMA 1: KARMA TRANSFER / PENYESALAN PELEPASAN (Seperti kasus Jackson di GW 8!)
      for (const p of allPlayers) {
        const pPts = p.gw_points || p.stats?.total_points || 0;
        const goals = p.stats?.goals_scored || 0;

        const soldInfo = transfersOutMap.get(p.id);
        if (soldInfo && soldInfo.totalOut > 0 && (pPts >= 7 || goals >= 1)) {
          const sellerTokens = formatTeamNames(soldInfo.entry_names, 3, isId);
          const currentFnb = ownershipMap.get(p.id);
          const currentOwnedPct = currentFnb?.owned_percentage ?? 0;

          const tokens: NewsToken[] = isId
            ? [
                { text: 'Karma transfer langsung terbukti! ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ` (${p.team_short_name || (m.home_lineup?.includes(p) ? homeName : awayName)}) meledak dengan `, type: 'plain' as EntityType },
                { text: `${pPts} poin`, type: 'stat' as EntityType },
                { text: goals > 1 ? ` (${goals} gol)` : goals === 1 ? ' (1 gol)' : '', type: 'plain' as EntityType },
                { text: ' tepat setelah dilepas oleh ', type: 'plain' as EntityType },
                ...sellerTokens,
                ...(currentOwnedPct === 0
                  ? [{ text: ' — kini menyisakan 0% kepemilikan di FNB League!', type: 'plain' as EntityType }]
                  : [{ text: ' menjelang batas waktu!', type: 'plain' as EntityType }]),
              ]
            : [
                { text: 'Instant transfer regret as ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' hauls ', type: 'plain' as EntityType },
                { text: `${pPts} points`, type: 'stat' as EntityType },
                { text: goals > 1 ? ` (${goals} goals)` : goals === 1 ? ' (1 goal)' : '', type: 'plain' as EntityType },
                { text: ' right after being ditched by ', type: 'plain' as EntityType },
                ...sellerTokens,
                ...(currentOwnedPct === 0
                  ? [{ text: ' — leaving zero ownership across FNB League!', type: 'plain' as EntityType }]
                  : [{ text: ' ahead of the deadline!', type: 'plain' as EntityType }]),
              ];

          stories.push({
            id: `live_karma_${p.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 98,
            timestamp: now,
            phase: 'live',
            isFresh: true,
          });
        }
      }

      // DRAMA 2: SUDUT PANDANG TERBALIK / DERITA NON-OWNER (High Ownership Haul)
      for (const p of allPlayers) {
        const pPts = p.gw_points || p.stats?.total_points || 0;
        const goals = p.stats?.goals_scored || 0;
        const fnbInfo = ownershipMap.get(p.id);

        if (fnbInfo && fnbInfo.owned_percentage >= 65 && (goals >= 1 || pPts >= 8)) {
          const nonOwners = standings
            .map(s => s.entry_name)
            .filter(name => !fnbInfo.owners?.some((o: any) => o.entry_name === name));

          if (nonOwners.length > 0 && nonOwners.length <= 6) {
            const nonOwnerTokens = formatTeamNames(nonOwners, 3, isId);

            const tokens: NewsToken[] = isId
              ? [
                  { text: 'Aksi gemilang ', type: 'plain' as EntityType },
                  { text: p.web_name, type: 'player' as EntityType },
                  { text: ` (${pPts} poin) menghadirkan kepanikan bagi `, type: 'plain' as EntityType },
                  ...nonOwnerTokens,
                  { text: ' yang tidak memilikinya dalam skuad pekan ini!', type: 'plain' as EntityType },
                ]
              : [
                  { text: 'Masterclass performance from ', type: 'plain' as EntityType },
                  { text: p.web_name, type: 'player' as EntityType },
                  { text: ` (${pPts} pts) piles massive pressure on non-owners `, type: 'plain' as EntityType },
                  ...nonOwnerTokens,
                  { text: '!', type: 'plain' as EntityType },
                ];

            stories.push({
              id: `live_nonowner_agony_${p.id}_gw${gw}`,
              tokens,
              plainText: tokensToPlainText(tokens),
              dramaScore: 94,
              timestamp: now,
              phase: 'live',
              isFresh: true,
            });
          }
        }
      }

      // DRAMA 3: DIFFERENTIAL MELEDAK & ROKET PERINGKAT (Low Ownership Hero)
      for (const p of allPlayers) {
        const pPts = p.gw_points || p.stats?.total_points || 0;
        const fnbInfo = ownershipMap.get(p.id);

        if (fnbInfo && fnbInfo.owned_count >= 1 && fnbInfo.owned_count <= 2 && pPts >= 7) {
          const ownerTokens = formatTeamNames(fnbInfo.owners?.map((o: any) => o.entry_name), 2, isId);

          const tokens: NewsToken[] = isId
            ? [
                { text: 'Pertaruhan pembeda berhasil manis! ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' meraup ', type: 'plain' as EntityType },
                { text: `${pPts} poin`, type: 'stat' as EntityType },
                { text: ' di laga ', type: 'plain' as EntityType },
                { text: matchLabel, type: 'club' as EntityType },
                { text: ' — jackpot eksklusif yang dipanen ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: ' di FNB League!', type: 'plain' as EntityType },
              ]
            : [
                { text: 'Brilliant differential dividend as ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' delivers ', type: 'plain' as EntityType },
                { text: `${pPts} points`, type: 'stat' as EntityType },
                { text: ' in ', type: 'plain' as EntityType },
                { text: matchLabel, type: 'club' as EntityType },
                { text: ' — exclusive jackpot enjoyed by ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: ' in FNB League!', type: 'plain' as EntityType },
              ];

          stories.push({
            id: `live_diff_hero_${p.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 92,
            timestamp: now,
            phase: 'live',
            isFresh: true,
          });
        }
      }

      // DRAMA 4: BENCANA LAPANGAN (KARTU MERAH & OWN GOAL)
      for (const p of allPlayers) {
        const redCards = p.stats?.red_cards || 0;
        const ownGoals = p.stats?.own_goals || 0;
        const fnbInfo = ownershipMap.get(p.id);

        if (fnbInfo && fnbInfo.owned_count > 0 && redCards > 0) {
          const ownerTokens = formatTeamNames(fnbInfo.owners?.map((o: any) => o.entry_name), 3, isId);

          const tokens: NewsToken[] = isId
            ? [
                { text: 'Hukuman kartu merah langsung untuk ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' (', type: 'plain' as EntityType },
                { text: '-3 poin', type: 'stat' as EntityType },
                { text: ') menjadi pukulan telak yang merugikan skuad ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: '!', type: 'plain' as EntityType },
              ]
            : [
                { text: 'Costly dismissal as ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' is sent off (', type: 'plain' as EntityType },
                { text: '-3 pts', type: 'stat' as EntityType },
                { text: '), penalizing squads of ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: '!', type: 'plain' as EntityType },
              ];

          stories.push({
            id: `live_red_card_${p.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 96,
            timestamp: now,
            phase: 'live',
            isFresh: true,
          });
        }

        if (fnbInfo && fnbInfo.owned_count > 0 && ownGoals > 0) {
          const ownerTokens = formatTeamNames(fnbInfo.owners?.map((o: any) => o.entry_name), 3, isId);

          const tokens: NewsToken[] = isId
            ? [
                { text: 'Sentuhan nahas ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' berujung gol bunuh diri (', type: 'plain' as EntityType },
                { text: '-2 poin', type: 'stat' as EntityType },
                { text: '), memangkas pundi poin milik ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: '!', type: 'plain' as EntityType },
              ]
            : [
                { text: 'Unfortunate own goal by ', type: 'plain' as EntityType },
                { text: p.web_name, type: 'player' as EntityType },
                { text: ' (', type: 'plain' as EntityType },
                { text: '-2 pts', type: 'stat' as EntityType },
                { text: ') dents the matchday tally of ', type: 'plain' as EntityType },
                ...ownerTokens,
                { text: '!', type: 'plain' as EntityType },
              ];

          stories.push({
            id: `live_own_goal_${p.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 93,
            timestamp: now,
            phase: 'live',
            isFresh: true,
          });
        }
      }

      // DRAMA 5: PUPUS NIRBOBOL MENIT AKHIR
      const matchMin = Number(m.minutes || 0);
      if (matchMin >= 70 && (scoreH > 0 || scoreA > 0)) {
        if (scoreA > 0) {
          const homeDefs = (m.home_lineup || []).filter(
            p => (p.position === 'DEF' || p.position === 'GKP') && (ownershipMap.get(p.id)?.owned_count ?? 0) >= 2
          );
          if (homeDefs.length > 0) {
            const popularDef = homeDefs[0];
            const defOwners = ownershipMap.get(popularDef.id);
            const ownerTokens = formatTeamNames(defOwners?.owners?.map((o: any) => o.entry_name), 2, isId);

            const tokens: NewsToken[] = isId
              ? [
                  { text: 'Kebobolan vs ', type: 'plain' as EntityType },
                  { text: awayName, type: 'club' as EntityType },
                  { text: ` (${clock}) melenyapkan poin Clean Sheet milik `, type: 'plain' as EntityType },
                  { text: popularDef.web_name, type: 'player' as EntityType },
                  { text: ', membuyarkan potensi poin bagi ', type: 'plain' as EntityType },
                  ...ownerTokens,
                  { text: '!', type: 'plain' as EntityType },
                ]
              : [
                  { text: 'Conceding against ', type: 'plain' as EntityType },
                  { text: awayName, type: 'club' as EntityType },
                  { text: ` (${clock}) wipes out Clean Sheet points for `, type: 'plain' as EntityType },
                  { text: popularDef.web_name, type: 'player' as EntityType },
                  { text: ', frustrating ', type: 'plain' as EntityType },
                  ...ownerTokens,
                  { text: '!', type: 'plain' as EntityType },
                ];

            stories.push({
              id: `live_cs_wipeout_home_${m.id}_gw${gw}`,
              tokens,
              plainText: tokensToPlainText(tokens),
              dramaScore: 89,
              timestamp: now,
              phase: 'live',
            });
          }
        }
      }

      // DRAMA 6: DRAMA STATISTIK (Saat Laga Minim Gol Tapi Tekanan Ekstrem)
      if (scoreH === 0 && scoreA === 0) {
        const threats = allPlayers
          .filter(p => Number(p.stats?.expected_goals || 0) >= 0.45)
          .sort((a, b) => Number(b.stats?.expected_goals || 0) - Number(a.stats?.expected_goals || 0));

        if (threats.length > 0) {
          const topThreat = threats[0];
          const xGVal = Number(topThreat.stats?.expected_goals).toFixed(2);
          const fnbInfo = ownershipMap.get(topThreat.id);
          const ownerTokens = formatTeamNames(fnbInfo?.owners?.map((o: any) => o.entry_name), 2, isId);

          const tokens: NewsToken[] = isId
            ? [
                { text: topThreat.web_name, type: 'player' as EntityType },
                { text: ' membukukan ancaman serangan tinggi (', type: 'plain' as EntityType },
                { text: `${xGVal} xG`, type: 'stat' as EntityType },
                { text: `) di laga ${matchLabel} (${clock}), membuat `, type: 'plain' as EntityType },
                ...(ownerTokens.length > 0 ? ownerTokens : [{ text: 'manajer liga', type: 'plain' as EntityType }]),
                { text: ' berdebar menanti gol pemecah kebuntuan!', type: 'plain' as EntityType },
              ]
            : [
                { text: topThreat.web_name, type: 'player' as EntityType },
                { text: ' registers high attacking threat (', type: 'plain' as EntityType },
                { text: `${xGVal} xG`, type: 'stat' as EntityType },
                { text: `) in ${matchLabel} (${clock}), keeping `, type: 'plain' as EntityType },
                ...(ownerTokens.length > 0 ? ownerTokens : [{ text: 'league managers', type: 'plain' as EntityType }]),
                { text: ' waiting on the edge of their seats for a breakthrough!', type: 'plain' as EntityType },
              ];

          stories.push({
            id: `live_xg_drama_${topThreat.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 85,
            timestamp: now,
            phase: 'live',
          });
        }

        const keepers = allPlayers.filter(p => p.position === 'GKP' && (p.stats?.saves || 0) >= 3);
        if (keepers.length > 0) {
          const gkp = keepers[0];
          const saves = gkp.stats.saves;
          const fnbInfo = ownershipMap.get(gkp.id);
          const ownerTokens = formatTeamNames(fnbInfo?.owners?.map((o: any) => o.entry_name), 2, isId);

          const tokens: NewsToken[] = isId
            ? [
                { text: gkp.web_name, type: 'player' as EntityType },
                { text: ' tampil bak tembok kokoh dengan mengamankan ', type: 'plain' as EntityType },
                { text: `${saves} penyelamatan krusial`, type: 'stat' as EntityType },
                { text: ' demi menyelamatkan poin pertahanan milik ', type: 'plain' as EntityType },
                ...(ownerTokens.length > 0 ? ownerTokens : [{ text: 'skuad liga', type: 'plain' as EntityType }]),
              ]
            : [
                { text: gkp.web_name, type: 'player' as EntityType },
                { text: ' stands tall with ', type: 'plain' as EntityType },
                { text: `${saves} vital saves`, type: 'stat' as EntityType },
                { text: ' to preserve defensive points for ', type: 'plain' as EntityType },
                ...(ownerTokens.length > 0 ? ownerTokens : [{ text: 'league squads', type: 'plain' as EntityType }]),
              ];

          stories.push({
            id: `live_saves_drama_${gkp.id}_gw${gw}`,
            tokens,
            plainText: tokensToPlainText(tokens),
            dramaScore: 83,
            timestamp: now,
            phase: 'live',
          });
        }
      }

      // KABAR SKOR DASAR LAGA LIVE
      const scorers = allPlayers
        .filter(p => p.stats?.goals_scored && p.stats.goals_scored > 0)
        .map(p => `${p.web_name}${p.stats.goals_scored > 1 ? ` (${p.stats.goals_scored})` : ''}`);

      if (scorers.length > 0) {
        const tokens: NewsToken[] = isId
          ? [
              { text: `${homeName} `, type: 'club' as EntityType },
              { text: `${scoreH}–${scoreA} `, type: 'stat' as EntityType },
              { text: `${awayName} (${clock}) • Gol: `, type: 'plain' as EntityType },
              { text: scorers.join(', '), type: 'player' as EntityType },
            ]
          : [
              { text: `${homeName} `, type: 'club' as EntityType },
              { text: `${scoreH}–${scoreA} `, type: 'stat' as EntityType },
              { text: `${awayName} (${clock}) • Goals: `, type: 'plain' as EntityType },
              { text: scorers.join(', '), type: 'player' as EntityType },
            ];

        stories.push({
          id: `live_score_${m.id}_gw${gw}`,
          tokens,
          plainText: tokensToPlainText(tokens),
          dramaScore: 80,
          timestamp: now,
          phase: 'live',
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // SIKLUS 4: GW LIVE TAPI SEDANG TIDAK ADA MATCH LIVE (Intermission)
  // --------------------------------------------------------------------------
  if (phase === 'intermission') {
    // 1. Rekap Hasil Akhir (Full Time) Laga yang Baru Selesai & Bintangnya
    const finishedMatches = (matches || []).filter(m => m.finished || m.finished_provisional);
    for (const m of [...finishedMatches].reverse().slice(0, 3)) {
      const home = m.home_team.short_name || 'H';
      const away = m.away_team.short_name || 'A';
      const scoreH = m.team_h_score ?? 0;
      const scoreA = m.team_a_score ?? 0;

      const allPlayers = [...(m.home_lineup || []), ...(m.away_lineup || [])];
      const star = allPlayers
        .map(p => ({ p, pts: p.gw_points || p.stats?.total_points || 0 }))
        .sort((a, b) => b.pts - a.pts)[0];

      const starPlayer = star?.p;
      const starPts = star?.pts || 0;
      const fnbInfo = starPlayer ? ownershipMap.get(starPlayer.id) : null;
      const ownerTokens = formatTeamNames(fnbInfo?.owners?.map((o: any) => o.entry_name), 2, isId);

      const tokens: NewsToken[] = isId
        ? [
            { text: `Peluit panjang berbunyi, `, type: 'plain' as EntityType },
            { text: `${home} `, type: 'club' as EntityType },
            { text: `${scoreH}–${scoreA} `, type: 'stat' as EntityType },
            { text: `${away}`, type: 'club' as EntityType },
            ...(starPlayer && starPts >= 6
              ? [
                  { text: ' • Penampil terbaik ', type: 'plain' as EntityType },
                  { text: starPlayer.web_name, type: 'player' as EntityType },
                  { text: ` (${starPts} poin)`, type: 'stat' as EntityType },
                  ...(ownerTokens.length > 0
                    ? [{ text: ' sumbang poin penting bagi ', type: 'plain' as EntityType }, ...ownerTokens]
                    : []),
                ]
              : []),
          ]
        : [
            { text: `Full-time whistle: `, type: 'plain' as EntityType },
            { text: `${home} `, type: 'club' as EntityType },
            { text: `${scoreH}–${scoreA} `, type: 'stat' as EntityType },
            { text: `${away}`, type: 'club' as EntityType },
            ...(starPlayer && starPts >= 6
              ? [
                  { text: ' • Key standout ', type: 'plain' as EntityType },
                  { text: starPlayer.web_name, type: 'player' as EntityType },
                  { text: ` (${starPts} pts)`, type: 'stat' as EntityType },
                  ...(ownerTokens.length > 0
                    ? [{ text: ' delivering vital tallies for ', type: 'plain' as EntityType }, ...ownerTokens]
                    : []),
                ]
              : []),
          ];

      stories.push({
        id: `intermission_ft_${m.id}_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 88,
        timestamp: now,
        phase: 'intermission',
      });
    }

    // 2. Pemain Poin Tertinggi GW Sementara (MVP GW) — Superlatif Tunggal!
    const topScorers = [...ownershipList]
      .filter(p => typeof p.gw_points === 'number' && p.gw_points >= 8)
      .sort((a, b) => (b.gw_points || 0) - (a.gw_points || 0));

    if (topScorers.length > 0) {
      const p1 = topScorers[0];
      const p2 = topScorers[1];

      if (p2 && p1.gw_points === p2.gw_points) {
        const tokens: NewsToken[] = isId
          ? [
              { text: p1.web_name, type: 'player' as EntityType },
              { text: ' & ', type: 'plain' as EntityType },
              { text: p2.web_name, type: 'player' as EntityType },
              { text: ' bersama-sama puncaki perolehan poin sementara Gameweek dengan torehan masing-masing ', type: 'plain' as EntityType },
              { text: `${p1.gw_points} poin`, type: 'stat' as EntityType },
            ]
          : [
              { text: p1.web_name, type: 'player' as EntityType },
              { text: ' & ', type: 'plain' as EntityType },
              { text: p2.web_name, type: 'player' as EntityType },
              { text: ' jointly top provisional Gameweek scoring charts with ', type: 'plain' as EntityType },
              { text: `${p1.gw_points} points each`, type: 'stat' as EntityType },
            ];

        stories.push({
          id: `intermission_mvp_tie_gw${gw}`,
          tokens,
          plainText: tokensToPlainText(tokens),
          dramaScore: 86,
          timestamp: now,
          phase: 'intermission',
        });
      } else {
        const tokens: NewsToken[] = isId
          ? [
              { text: p1.web_name, type: 'player' as EntityType },
              { text: ' puncaki perolehan poin sementara Gameweek ', type: 'plain' as EntityType },
              { text: `${gw}`, type: 'stat' as EntityType },
              { text: ' dengan torehan ', type: 'plain' as EntityType },
              { text: `${p1.gw_points} poin`, type: 'stat' as EntityType },
              ...(p2 && p2.gw_points
                ? [
                    { text: ', diikuti ', type: 'plain' as EntityType },
                    { text: p2.web_name, type: 'player' as EntityType },
                    { text: ` (${p2.gw_points} poin) di urutan kedua`, type: 'stat' as EntityType },
                  ]
                : []),
            ]
          : [
              { text: p1.web_name, type: 'player' as EntityType },
              { text: ' tops provisional Gameweek ', type: 'plain' as EntityType },
              { text: `${gw}`, type: 'stat' as EntityType },
              { text: ' scoring charts with ', type: 'plain' as EntityType },
              { text: `${p1.gw_points} points`, type: 'stat' as EntityType },
              ...(p2 && p2.gw_points
                ? [
                    { text: ', followed by ', type: 'plain' as EntityType },
                    { text: p2.web_name, type: 'player' as EntityType },
                    { text: ` (${p2.gw_points} pts) in second place`, type: 'stat' as EntityType },
                  ]
                : []),
            ];

        stories.push({
          id: `intermission_mvp_single_gw${gw}`,
          tokens,
          plainText: tokensToPlainText(tokens),
          dramaScore: 86,
          timestamp: now,
          phase: 'intermission',
        });
      }
    }

    // 3. Lonjakan Peringkat Sementara Tertinggi (Top Mover)
    const climbers = standings
      .filter(s => typeof s.rank_change === 'number' && s.rank_change > 0)
      .sort((a, b) => b.rank_change - a.rank_change);

    if (climbers.length > 0) {
      const c1 = climbers[0];
      const c2 = climbers[1];

      const tokens: NewsToken[] = isId
        ? [
            { text: `Tim ${c1.entry_name}`, type: 'team' as EntityType },
            { text: ' mencatat lompatan terbesar dengan melesat naik ', type: 'plain' as EntityType },
            { text: `+${c1.rank_change} peringkat`, type: 'stat' as EntityType },
            { text: ` ke posisi #${c1.rank} (${c1.event_points} poin GW ini)`, type: 'plain' as EntityType },
            ...(c2 && c2.rank_change >= 2 && c2.rank_change < c1.rank_change
              ? [
                  { text: ', disusul ', type: 'plain' as EntityType },
                  { text: `Tim ${c2.entry_name}`, type: 'team' as EntityType },
                  { text: ` (+${c2.rank_change} peringkat ke #${c2.rank})`, type: 'stat' as EntityType },
                ]
              : []),
          ]
        : [
            { text: `Tim ${c1.entry_name}`, type: 'team' as EntityType },
            { text: ' records the biggest leap, climbing ', type: 'plain' as EntityType },
            { text: `+${c1.rank_change} spots`, type: 'stat' as EntityType },
            { text: ` to Rank #${c1.rank} (${c1.event_points} pts this round)`, type: 'plain' as EntityType },
            ...(c2 && c2.rank_change >= 2 && c2.rank_change < c1.rank_change
              ? [
                  { text: ', followed by ', type: 'plain' as EntityType },
                  { text: `Tim ${c2.entry_name}`, type: 'team' as EntityType },
                  { text: ` (+${c2.rank_change} spots to #${c2.rank})`, type: 'stat' as EntityType },
                ]
              : []),
          ];

      stories.push({
        id: `intermission_mover_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 84,
        timestamp: now,
        phase: 'intermission',
      });
    }
  }

  // --------------------------------------------------------------------------
  // SIKLUS 5: GW PROVISIONAL (Seluruh Laga Rampung, Menunggu Audit Opta & FPL)
  // --------------------------------------------------------------------------
  if (phase === 'provisional') {
    const tokensAudit: NewsToken[] = isId
      ? [
          { text: 'Seluruh laga tuntas • Menunggu audit final poin bonus Opta BPS, autosub & pengesahan klasemen resmi FPL', type: 'plain' as EntityType },
        ]
      : [
          { text: 'All matches concluded • Awaiting final Opta BPS audits, autosubs & official FPL league lock', type: 'plain' as EntityType },
        ];

    stories.push({
      id: `provisional_audit_status_gw${gw}`,
      tokens: tokensAudit,
      plainText: tokensToPlainText(tokensAudit),
      dramaScore: 94,
      timestamp: now,
      phase: 'provisional',
    });

    const sortedGw = [...standings].sort((a, b) => b.event_points - a.event_points);
    if (sortedGw.length > 0) {
      const topPts = sortedGw[0].event_points;
      const topChamps = sortedGw.filter(s => s.event_points === topPts);
      const teamTokens = formatTeamNames(topChamps.map(s => s.entry_name), 3, isId);

      const tokens: NewsToken[] = isId
        ? [
            ...teamTokens,
            { text: ' berada di ambang juara Gameweek pekan ini dengan torehan impresif ', type: 'plain' as EntityType },
            { text: `${topPts} poin`, type: 'stat' as EntityType },
            { text: ' sembari menanti audit final poin bonus!', type: 'plain' as EntityType },
          ]
        : [
            ...teamTokens,
            { text: ' is on track to seal the Gameweek title with an impressive ', type: 'plain' as EntityType },
            { text: `${topPts} points`, type: 'stat' as EntityType },
            { text: ' ahead of final audit lock!', type: 'plain' as EntityType },
          ];

      stories.push({
        id: `provisional_champ_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 92,
        timestamp: now,
        phase: 'provisional',
      });
    }

    if (standings.length > 0 && standings[0]) {
      const leader = standings[0];
      const tokens: NewsToken[] = isId
        ? [
            { text: `Tim ${leader.entry_name}`, type: 'team' as EntityType },
            { text: ' kokoh mengawal singgasana klasemen sementara FNB League dengan akumulasi ', type: 'plain' as EntityType },
            { text: `${leader.total_points} poin`, type: 'stat' as EntityType },
          ]
        : [
            { text: `Tim ${leader.entry_name}`, type: 'team' as EntityType },
            { text: ' commands the league top spot with ', type: 'plain' as EntityType },
            { text: `${leader.total_points} points`, type: 'stat' as EntityType },
          ];

      stories.push({
        id: `provisional_leader_gw${gw}`,
        tokens,
        plainText: tokensToPlainText(tokens),
        dramaScore: 89,
        timestamp: now,
        phase: 'provisional',
      });
    }
  }

  stories.sort((a, b) => b.dramaScore - a.dramaScore);

  if (stories.length === 0) {
    const fallbackTokens: NewsToken[] = isId
      ? [
          { text: 'FPL Nusantara BERHADIAH • Kampanye Musim 2026/2027', type: 'plain' as EntityType },
        ]
      : [
          { text: 'FPL Nusantara BERHADIAH • 2026/2027 Season Campaign', type: 'plain' as EntityType },
        ];
    return [
      {
        id: 'fallback_story',
        tokens: fallbackTokens,
        plainText: tokensToPlainText(fallbackTokens),
        dramaScore: 50,
        timestamp: now,
        phase: 'confirmed',
      },
    ];
  }

  return stories;
}
