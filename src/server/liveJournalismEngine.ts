/**
 * Live Journalism Engine for FNB League (Non-AI Rule-Based Engine)
 * Strictly factual, zero-hyperbole, data-driven matchday news generator.
 * Covers:
 * 1. Live match scores, clock/minutes, goalscorers & assist providers.
 * 2. In-play player point-impact events (goals, assists, saves, DefCon, cards, penalties, own goals)
 *    with opponent, FNB League ownership %, captaincy, delta points (+-), and running points.
 * 3. Accumulated team points, active chips, transfer hits, and league table rank shifts.
 */

import { getOptimalDatabase, getDbStandings, getGwSnapshot, getDbOwnershipPlayers } from './db.ts';
import { fetchMatchesForGw } from './matchesFetcher.ts';
import { MatchCardItem, MatchPlayerItem } from '../types.ts';
import { cleanHeadlineBody, NewsTickerStory } from './geminiNewsService.ts';

export interface LiveJournalismOutput {
  liveScores: NewsTickerStory[];
  playerEvents: NewsTickerStory[];
  teamRankShifts: NewsTickerStory[];
  allStories: NewsTickerStory[];
}

export type PlayerActionType =
  | 'goal'
  | 'assist'
  | 'save'
  | 'defcon'
  | 'pen_saved'
  | 'pen_missed'
  | 'yellow_card'
  | 'red_card'
  | 'own_goal';

/**
 * Modular helper untuk memformat kejadian aksi pemain beserta poinnya.
 * Menyusun struktur [kata kerja] [jumlah] [kata benda] [poin].
 * Contoh:
 * - formatPlayerAction('goal', 1, 5) ->
 *   ID: "mencetak 1 gol (+5 Poin)"
 *   EN: "scored 1 goal (+5 Pts)"
 * - formatPlayerAction('assist', 2, 6) ->
 *   ID: "memberikan 2 assist (+6 Poin)"
 *   EN: "provided 2 assists (+6 Pts)"
 */
export function formatPlayerAction(
  type: PlayerActionType,
  count: number,
  deltaPts: number
): { id: string; en: string } {
  const ptsSign = deltaPts > 0 ? `+${deltaPts}` : `${deltaPts}`;
  const ptsId = `(${ptsSign} Poin)`;
  const ptsEn = `(${ptsSign} ${Math.abs(deltaPts) === 1 ? 'Pt' : 'Pts'})`;

  switch (type) {
    case 'goal': {
      const verbId = 'mencetak';
      const nounId = `${count} gol`;
      const verbEn = 'scored';
      const nounEn = count > 1 ? `${count} goals` : '1 goal';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'assist': {
      const verbId = 'memberikan';
      const nounId = `${count} assist`;
      const verbEn = 'provided';
      const nounEn = count > 1 ? `${count} assists` : '1 assist';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'save': {
      const verbId = 'melakukan';
      const nounId = `${count} penyelamatan`;
      const verbEn = 'made';
      const nounEn = `${count} saves`;
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'defcon': {
      const verbId = 'mencapai';
      const nounId = `${count} aksi defensif`;
      const verbEn = 'reached';
      const nounEn = `${count} defensive actions`;
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'pen_saved': {
      const verbId = 'menepis';
      const nounId = count > 1 ? `${count} penalti` : '1 penalti';
      const verbEn = 'saved';
      const nounEn = count > 1 ? `${count} penalties` : '1 penalty';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'pen_missed': {
      const verbId = 'gagal mengeksekusi';
      const nounId = count > 1 ? `${count} penalti` : '1 penalti';
      const verbEn = 'missed';
      const nounEn = count > 1 ? `${count} penalties` : '1 penalty';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'yellow_card': {
      const verbId = 'menerima';
      const nounId = count > 1 ? `${count} kartu kuning` : '1 kartu kuning';
      const verbEn = 'received';
      const nounEn = count > 1 ? `${count} yellow cards` : '1 yellow card';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'red_card': {
      const verbId = 'menerima';
      const nounId = count > 1 ? `${count} kartu merah` : 'kartu merah';
      const verbEn = 'received';
      const nounEn = count > 1 ? `${count} red cards` : 'a red card';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    case 'own_goal': {
      const verbId = 'mencetak';
      const nounId = count > 1 ? `${count} gol bunuh diri` : '1 gol bunuh diri';
      const verbEn = 'scored';
      const nounEn = count > 1 ? `${count} own goals` : '1 own goal';
      return {
        id: `${verbId} ${nounId} ${ptsId}`,
        en: `${verbEn} ${nounEn} ${ptsEn}`,
      };
    }
    default:
      return {
        id: `beraksi ${ptsId}`,
        en: `action ${ptsEn}`,
      };
  }
}

/**
 * Helper untuk menerjemahkan kode chip FPL ke nama resmi yang mudah dibaca
 */
export function formatChipName(chip?: string | null): string {
  if (!chip) return '';
  const c = chip.toLowerCase().trim();
  if (c === '3xc' || c === 'triple_captain' || c === 'triple captain') return 'Triple Captain';
  if (c === 'bboost' || c === 'bench_boost' || c === 'bench boost') return 'Bench Boost';
  if (c === 'freehit' || c === 'free_hit' || c === 'free hit') return 'Free Hit';
  if (c === 'wildcard') return 'Wildcard';
  return chip;
}

/**
 * Memformat daftar tim sesuai aturan baku:
 * - Jumlah tim <= 3: sebutkan semua nama tim ([T:A], [T:A] dan [T:B], [T:A], [T:B], dan [T:C])
 * - Jumlah tim > 3: sebutkan 2 dan n tim lainnya ([T:A], [T:B], dan [N:X] tim lainnya)
 */
export function formatTeamList(teams: string[], lang: 'id' | 'en' = 'id'): string {
  if (!teams || teams.length === 0) return '';
  const cleanTeams = teams
    .map((t) => t.replace(/^\[T:/, '').replace(/\]$/, '').trim())
    .filter(Boolean);
  const n = cleanTeams.length;
  if (n === 0) return '';
  if (n === 1) return `[T:${cleanTeams[0]}]`;
  if (n === 2) {
    return lang === 'id'
      ? `[T:${cleanTeams[0]}] dan [T:${cleanTeams[1]}]`
      : `[T:${cleanTeams[0]}] and [T:${cleanTeams[1]}]`;
  }
  if (n === 3) {
    return lang === 'id'
      ? `[T:${cleanTeams[0]}], [T:${cleanTeams[1]}], dan [T:${cleanTeams[2]}]`
      : `[T:${cleanTeams[0]}], [T:${cleanTeams[1]}], and [T:${cleanTeams[2]}]`;
  }
  // n > 3: sebutkan 2 dan n tim lainnya
  const remaining = n - 2;
  return lang === 'id'
    ? `[T:${cleanTeams[0]}], [T:${cleanTeams[1]}], dan [N:${remaining}] tim lainnya`
    : `[T:${cleanTeams[0]}], [T:${cleanTeams[1]}], and [N:${remaining}] other teams`;
}

/**
 * Generates purely factual matchday journalism stories without hyperbole or assumptions
 */
export async function generateLiveJournalismStories(gw: number): Promise<LiveJournalismOutput> {
  const db = getOptimalDatabase();
  const standings = getDbStandings(gw);
  const snapshot = getGwSnapshot(gw);
  const totalLeagueManagers = standings.length || 97;

  // 1. Fetch match cards for the gameweek
  let matchCards: MatchCardItem[] = [];
  try {
    matchCards = await fetchMatchesForGw(gw);
  } catch (err: any) {
    console.warn('[Live Journalism Engine] Error fetching match cards:', err.message);
  }

  const liveMatches = matchCards.filter((m) => m.started && !m.finished);

  // Maps to enrich player events with FNB League ownership
  const playerOwnershipMap = new Map<number, { count: number; pct: number; owners: string[] }>();

  const dbOwnershipList = getDbOwnershipPlayers(gw);
  for (const item of dbOwnershipList) {
    playerOwnershipMap.set(item.playerId, {
      count: item.ownedCount,
      pct: item.ownedPercentage,
      owners: (item.owners || []).map((o: any) => o.entry_name || o.entryName || ''),
    });
  }

  const liveScores: NewsTickerStory[] = [];
  const playerEvents: NewsTickerStory[] = [];
  const teamRankShifts: NewsTickerStory[] = [];

  // =========================================================================
  // KATEGORI 1: Update Skor Pertandingan yang Sedang Berjalan (Score & Clock)
  // =========================================================================
  for (const match of liveMatches) {
    const homeClub = match.home_team.name;
    const awayClub = match.away_team.name;
    const homeScore = match.team_h_score ?? 0;
    const awayScore = match.team_a_score ?? 0;
    const clock = match.clock_label || (match.minutes ? `${match.minutes}'` : 'Live');
    const isHT = match.is_half_time || clock.toLowerCase().includes('half') || clock.toLowerCase().includes('ht');

    // Extract scorers and assists from starters and bench
    const allHomePlayers = [...match.home_lineup, ...match.home_bench];
    const allAwayPlayers = [...match.away_lineup, ...match.away_bench];

    const homeScorers = allHomePlayers.filter((p) => (p.stats.goals_scored || 0) > 0);
    const homeAssisters = allHomePlayers.filter((p) => (p.stats.assists || 0) > 0);
    const awayScorers = allAwayPlayers.filter((p) => (p.stats.goals_scored || 0) > 0);
    const awayAssisters = allAwayPlayers.filter((p) => (p.stats.assists || 0) > 0);

    const totalGoals = homeScore + awayScore;

    let idText = '';
    let enText = '';

    if (totalGoals === 0) {
      if (isHT) {
        idText = `Pertandingan [C:${homeClub}] vs [C:${awayClub}] sedang berlangsung pada jeda babak pertama (Half Time) dengan skor [N:0 - 0].`;
        enText = `Match between [C:${homeClub}] and [C:${awayClub}] is currently at Half Time with the score at [N:0 - 0].`;
      } else {
        idText = `Pertandingan [C:${homeClub}] vs [C:${awayClub}] sedang berlangsung di menit [N:${clock}] dengan skor [N:0 - 0].`;
        enText = `Match between [C:${homeClub}] and [C:${awayClub}] is currently at [N:${clock}] with the score at [N:0 - 0].`;
      }
    } else {
      // Gather all scorers from both clubs
      const allScorers = [
        ...homeScorers.map((s) => ({ player: s, club: homeClub })),
        ...awayScorers.map((s) => ({ player: s, club: awayClub })),
      ];

      // Gather all assisters from both clubs
      const allAssisters = [
        ...homeAssisters.map((a) => ({ player: a, club: homeClub })),
        ...awayAssisters.map((a) => ({ player: a, club: awayClub })),
      ];

      const scorersIdList = allScorers.map((s) => {
        const count = s.player.stats.goals_scored || 1;
        const countSuffix = count > 1 ? ` (${count} gol)` : '';
        return `[P:${s.player.web_name}] ([C:${s.club}])${countSuffix}`;
      }).join(', ');

      const scorersEnList = allScorers.map((s) => {
        const count = s.player.stats.goals_scored || 1;
        const countSuffix = count > 1 ? ` (${count} goals)` : '';
        return `[P:${s.player.web_name}] ([C:${s.club}])${countSuffix}`;
      }).join(', ');

      const assistersList = allAssisters.map((a) => {
        const count = a.player.stats.assists || 1;
        const countSuffix = count > 1 ? ` (${count} assist)` : '';
        return `[P:${a.player.web_name}] ([C:${a.club}])${countSuffix}`;
      }).join(', ');

      const timeStatus = isHT ? 'pada jeda babak pertama (Half Time)' : `di menit [N:${clock}]`;
      const timeStatusEn = isHT ? 'at Half Time' : `at [N:${clock}]`;

      const golPartId = scorersIdList ? ` Gol: ${scorersIdList}.` : '';
      const assistPartId = assistersList ? ` Assist: ${assistersList}.` : '';

      const golPartEn = scorersEnList ? ` Goals: ${scorersEnList}.` : '';
      const assistPartEn = assistersList ? ` Assists: ${assistersList}.` : '';

      idText = `Pertandingan [C:${homeClub}] vs [C:${awayClub}] sedang berlangsung ${timeStatus} dengan skor [N:${homeScore} - ${awayScore}].${golPartId}${assistPartId}`.trim();
      enText = `Match between [C:${homeClub}] and [C:${awayClub}] is currently ${timeStatusEn} with the score at [N:${homeScore} - ${awayScore}].${golPartEn}${assistPartEn}`.trim();
    }

    liveScores.push({
      id: `live_score_${match.id}_${Date.now()}`,
      headline_id: cleanHeadlineBody(idText),
      headline_en: cleanHeadlineBody(enText),
      drama_score: 95,
    });
  }

  // =========================================================================
  // KATEGORI 2: Kejadian Lapangan Berpengaruh ke Poin Pemain
  // =========================================================================
  for (const match of liveMatches) {
    const homeClub = match.home_team.name;
    const awayClub = match.away_team.name;

    const checkPlayers = [
      ...match.home_lineup.map((p) => ({ player: p, isHome: true, club: homeClub, opponent: awayClub })),
      ...match.home_bench.map((p) => ({ player: p, isHome: true, club: homeClub, opponent: awayClub })),
      ...match.away_lineup.map((p) => ({ player: p, isHome: false, club: awayClub, opponent: homeClub })),
      ...match.away_bench.map((p) => ({ player: p, isHome: false, club: awayClub, opponent: homeClub })),
    ];

    for (const { player, opponent } of checkPlayers) {
      const st = player.stats;
      const own = playerOwnershipMap.get(player.id);
      const ownCount = own ? own.count : 0;
      const ownTextId = `[N:${ownCount} pemilik]`;
      const ownTextEn = `[N:${ownCount} ${ownCount === 1 ? 'owner' : 'owners'}]`;
      const pRefId = `[P:${player.web_name}] (${ownTextId})`;
      const pRefEn = `[P:${player.web_name}] (${ownTextEn})`;
      const totalPts = player.gw_points ?? st.total_points ?? 0;
      const totTextId = `Poin sementara: [N:${totalPts} Poin].`;
      const totTextEn = `Provisional points: [N:${totalPts} Pts].`;

      // Event A: Gol
      if (st.goals_scored > 0) {
        const count = st.goals_scored;
        const isDefOrGk = player.position === 'DEF' || player.position === 'GKP';
        const isMid = player.position === 'MID';
        const ptsPerGoal = isDefOrGk ? 6 : isMid ? 5 : 4;
        const deltaPts = ptsPerGoal * count;
        const action = formatPlayerAction('goal', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_goal_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 92,
        });
      }

      // Event B: Assist
      if (st.assists > 0) {
        const count = st.assists;
        const deltaPts = 3 * count;
        const action = formatPlayerAction('assist', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_assist_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 87,
        });
      }

      // Event C: Saves (Kiper >= 3 saves)
      if (player.position === 'GKP' && st.saves >= 3) {
        const count = st.saves;
        const deltaPts = Math.floor(count / 3);
        const action = formatPlayerAction('save', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_save_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 85,
        });
      }

      // Event D: Defensive Contribution (DefCon)
      const dcThreshold = player.position === 'DEF' ? 10 : 12;
      const cbiTotal = st.defensive_contribution || 0;
      if (player.position !== 'GKP' && cbiTotal >= dcThreshold) {
        const count = cbiTotal;
        const deltaPts = 2;
        const action = formatPlayerAction('defcon', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_defcon_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 84,
        });
      }

      // Event E: Penalti Ditepis (Penalty Saved)
      if (st.penalties_saved > 0) {
        const count = st.penalties_saved;
        const deltaPts = 5 * count;
        const action = formatPlayerAction('pen_saved', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_pensaved_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 95,
        });
      }

      // Event F: Penalti Gagal (Penalty Missed)
      if (st.penalties_missed > 0) {
        const count = st.penalties_missed;
        const deltaPts = -2 * count;
        const action = formatPlayerAction('pen_missed', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_penmissed_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 90,
        });
      }

      // Event G: Kartu Kuning
      if (st.yellow_cards > 0) {
        const count = st.yellow_cards;
        const deltaPts = -1 * count;
        const action = formatPlayerAction('yellow_card', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_yellow_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 75,
        });
      }

      // Event H: Kartu Merah
      if (st.red_cards > 0) {
        const count = st.red_cards;
        const deltaPts = -3 * count;
        const action = formatPlayerAction('red_card', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_redcard_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 91,
        });
      }

      // Event I: Gol Bunuh Diri (Own Goal)
      if (st.own_goals > 0) {
        const count = st.own_goals;
        const deltaPts = -2 * count;
        const action = formatPlayerAction('own_goal', count, deltaPts);

        const idStory = `${pRefId} ${action.id} vs [C:${opponent}]. ${totTextId}`;
        const enStory = `${pRefEn} ${action.en} vs [C:${opponent}]. ${totTextEn}`;

        playerEvents.push({
          id: `pe_owngoal_${player.id}_${match.id}`,
          headline_id: cleanHeadlineBody(idStory),
          headline_en: cleanHeadlineBody(enStory),
          drama_score: 86,
        });
      }
    }
  }

  // =========================================================================
  // KATEGORI 3: Akumulasi Poin Tim & Pergerakan Peringkat FNB League
  // =========================================================================
  const significantRankMovers = standings
    .filter((s) => Math.abs(s.rank_change || 0) >= 1 || s.rank <= 3 || s.active_chip || (s.event_transfers_cost || 0) < 0)
    .slice(0, 30);

  for (const team of significantRankMovers) {
    const rankChange = team.rank_change || 0;
    const currentRank = team.rank;
    const lastRank = team.last_rank || currentRank;
    const totalPts = team.total_points;
    const gwPts = team.event_points;
    const hitsPenalty = team.event_transfers_cost || 0;
    const chip = team.active_chip;
    const chipName = chip ? formatChipName(chip) : '';

    const chipText = chipName ? ` yang menggunakan [N:${chipName}]` : '';
    const chipTextEn = chipName ? ` using [N:${chipName}]` : '';

    const hitText = hitsPenalty < 0 ? ` [N:${hitsPenalty}]` : '';
    const hitTextEn = hitsPenalty < 0 ? ` [N:${hitsPenalty}]` : '';

    let idStory = '';
    let enStory = '';

    if (currentRank === 1 && rankChange === 0) {
      idStory = `[T:${team.entry_name}]${chipText} memperoleh [N:${gwPts}] poin${hitText} di GW [N:${gw}], dan bertahan di peringkat [N:1] klasemen sementara FNB League dengan total poin [N:${totalPts}].`;
      enStory = `[T:${team.entry_name}]${chipTextEn} scored [N:${gwPts}] points${hitTextEn} in GW [N:${gw}], and holds rank [N:1] in provisional FNB League table with [N:${totalPts}] total points.`;
    } else if (rankChange > 0) {
      idStory = `[T:${team.entry_name}]${chipText} memperoleh [N:${gwPts}] poin${hitText} di GW [N:${gw}], dan naik [N:${rankChange}] peringkat dari posisi [N:${lastRank}] ke peringkat [N:${currentRank}] sementara FNB League dengan total poin [N:${totalPts}].`;
      enStory = `[T:${team.entry_name}]${chipTextEn} scored [N:${gwPts}] points${hitTextEn} in GW [N:${gw}], and moved up [N:${rankChange}] places from position [N:${lastRank}] to rank [N:${currentRank}] in FNB League with [N:${totalPts}] total points.`;
    } else if (rankChange < 0) {
      const dropAmount = Math.abs(rankChange);
      idStory = `[T:${team.entry_name}]${chipText} memperoleh [N:${gwPts}] poin${hitText} di GW [N:${gw}], dan turun [N:${dropAmount}] peringkat dari posisi [N:${lastRank}] ke peringkat [N:${currentRank}] sementara FNB League dengan total poin [N:${totalPts}].`;
      enStory = `[T:${team.entry_name}]${chipTextEn} scored [N:${gwPts}] points${hitTextEn} in GW [N:${gw}], and dropped [N:${dropAmount}] places from position [N:${lastRank}] to rank [N:${currentRank}] in FNB League with [N:${totalPts}] total points.`;
    } else {
      idStory = `[T:${team.entry_name}]${chipText} memperoleh [N:${gwPts}] poin${hitText} di GW [N:${gw}], dan tertahan di peringkat [N:${currentRank}] sementara FNB League dengan total poin [N:${totalPts}].`;
      enStory = `[T:${team.entry_name}]${chipTextEn} scored [N:${gwPts}] points${hitTextEn} in GW [N:${gw}], and holds rank [N:${currentRank}] in provisional FNB League table with [N:${totalPts}] total points.`;
    }

    if (idStory) {
      teamRankShifts.push({
        id: `team_shift_${team.entry_id}_gw${gw}`,
        headline_id: cleanHeadlineBody(idStory),
        headline_en: cleanHeadlineBody(enStory),
        drama_score: 88,
      });
    }
  }

  const allStories = [...liveScores, ...playerEvents, ...teamRankShifts];

  return {
    liveScores,
    playerEvents,
    teamRankShifts,
    allStories,
  };
}
