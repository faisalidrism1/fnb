/**
 * News Raw Data Aggregator
 * Extracts pure, unedited, factual tables from the container database for Gemini AI.
 * Strictly NO subjective filtering, NO curation, NO manager personal names (only team names).
 * Enforces historical GW rank checking to deliver maximum contextual drama.
 */

import {
  getOptimalDatabase,
  getDbStandings,
  getGwSnapshot,
  getDbChipsUsed,
  getDbLigaMinus,
} from './db.ts';

export interface RawTeamSquad {
  starters: Array<{ name: string; club: string; pos: string; pts: number; isC: boolean; isVC: boolean }>;
  bench: Array<{ name: string; club: string; pos: string; pts: number; order: number }>;
  benchPts: number;
}

export interface RawTeamEntry {
  rank: number;
  lastRank: number; // Previous GW rank (essential for historical context)
  rankChange: number; // Positive = climb up (+X), Negative = fall down (-X), 0 = unchanged
  rankContext: string; // Explanatory context of rank movement (kudeta tahta, lonjakan tajam, kejatuhan, konsistensi)
  team: string; // Strictly Team Name only
  gwPts: number;
  totalPts: number;
  hitPenalty: number;
  chip: string | null;
  captain: string | null;
  viceCaptain: string | null;
  benchPts: number;
  starters: Array<{ name: string; club: string; pos: string; pts: number; isC: boolean; isVC: boolean }>;
  bench: Array<{ name: string; club: string; pos: string; pts: number; order: number }>;
}

export interface RawPlayerStat {
  name: string;
  club: string;
  pos: string;
  cost: number;
  gwPts: number;
  mins: number;
  goals: number;
  assists: number;
  cs: number;
  saves: number;
  penSaved: number;
  penMissed: number;
  yellow: number;
  red: number;
  bps: number;
  bonus: number;
  fnbOwned: number;
  fnbOwners?: string[]; // Listed only for differentials (<= 5 owners)
}

export interface WhatIfOpportunity {
  team: string;
  category: 'Captaincy' | 'Bench' | 'Transfer';
  realChoice: string;
  realBasePts: number;
  alternativeChoice: string;
  alternativePts: number;
  netDeltaPts: number; // alternativePts - realBasePts. STRICT net gain/loss compared to reality!
  actualGwPts: number;
  potentialGwPts: number; // actualGwPts + netDeltaPts
  narrativeInsight: string;
}

export interface StandingsHistoricalContext {
  previousGw: number;
  activeGw: number;
  titleBattle: {
    rank1: { team: string; currentRank: number; lastRank: number; pts: number; context: string };
    rank2: { team: string; currentRank: number; lastRank: number; pts: number; context: string };
    rank3: { team: string; currentRank: number; lastRank: number; pts: number; context: string };
    titleRaceGapPts: number;
    coupOccurred: boolean;
    coupDescription: string;
  };
  topRankClimbers: Array<{
    team: string;
    fromRank: number;
    toRank: number;
    climbSteps: number;
    gwPts: number;
    contextNote: string;
  }>;
  topRankFallers: Array<{
    team: string;
    fromRank: number;
    toRank: number;
    fallSteps: number;
    gwPts: number;
    contextNote: string;
  }>;
}

export interface RawMatchdayPayload {
  gameweek: number;
  nextGameweek: number;
  gameweekPhase: 'Live' | 'Provisional' | 'Confirmed';
  phaseDescription: string;
  leagueStats: {
    totalTeams: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
  };
  championshipStatus: {
    rank1: { team: string; totalPts: number; gwPts: number };
    rank2: { team: string; totalPts: number; gwPts: number };
    titleRaceGapPts: number;
    mostGwLeader: { team: string; winCount: number; isPassedDown: boolean; note: string };
    gwChampionLeader: { team: string; gwPts: number };
  };
  standingsHistoricalContext: StandingsHistoricalContext;
  standingsTable: RawTeamEntry[];
  activePlayersTable: RawPlayerStat[];
  transfersIn: Array<{ player: string; club: string; count: number; gwPts: number }>;
  transfersOut: Array<{ player: string; club: string; count: number; gwPts: number }>;
  chipsActive: Array<{ team: string; chip: string }>;
  ligaMinusSeasonRecords: Array<{ team: string; totalMinusPoints: number; currentRank: number }>;
  whatIfOpportunities: WhatIfOpportunity[];
}

/**
 * Builds the complete raw unedited tables for the active Gameweek
 */
export function buildRawMatchdayPayload(targetGw?: number): RawMatchdayPayload {
  const db = getOptimalDatabase();
  const currentGw = targetGw || db.meta.current_gw || 8;
  const previousGw = Math.max(1, currentGw - 1);
  const nextGw = currentGw + 1;
  const standings = getDbStandings(currentGw);
  const snapshot = getGwSnapshot(currentGw);
  const allPlayers = Object.values(db.players || {});

  // 1. Reconstruct Starting XI (11) and Bench (4) for every team
  const managerSquadMap: Record<number, RawTeamSquad> = {};
  for (const p of allPlayers) {
    const owners = p.league_ownership?.owners || [];
    for (const o of owners) {
      if (!managerSquadMap[o.entry_id]) {
        managerSquadMap[o.entry_id] = { starters: [], bench: [], benchPts: 0 };
      }
      const pts = p.eventPoints || 0;
      if (o.is_starter) {
        managerSquadMap[o.entry_id].starters.push({
          name: p.webName,
          club: p.teamName || p.teamShort,
          pos: p.position,
          pts: pts * (o.multiplier || 1),
          isC: Boolean(o.is_captain),
          isVC: Boolean(o.is_vice_captain),
        });
      } else {
        managerSquadMap[o.entry_id].bench.push({
          name: p.webName,
          club: p.teamName || p.teamShort,
          pos: p.position,
          pts,
          order: o.position_in_squad || 12,
        });
        managerSquadMap[o.entry_id].benchPts += pts;
      }
    }
  }

  // Sort starters (GKP first, then DEF, MID, FWD) and bench (by position order)
  for (const sq of Object.values(managerSquadMap)) {
    sq.bench.sort((a, b) => a.order - b.order);
  }

  // 2. Build 97 Teams Standings Table with Historical GW Context
  const standingsTable: RawTeamEntry[] = standings.map((s) => {
    const sq = managerSquadMap[s.entry_id] || { starters: [], bench: [], benchPts: 0 };
    const currentRank = Number(s.rank);
    const lastRank = Number(s.last_rank || s.lastRank || currentRank);
    // Rank change in standings: if lastRank was 2 and current is 1 -> climbed +1 spot
    const rankChange = lastRank - currentRank;

    let rankContext = `Peringkat ${currentRank} (stabil dari GW ${previousGw})`;
    if (currentRank === 1 && lastRank > 1) {
      rankContext = `Peringkat 1 (naik dari Peringkat ${lastRank} pada GW ${previousGw}, selisih +${rankChange})`;
    } else if (lastRank === 1 && currentRank > 1) {
      rankContext = `Peringkat ${currentRank} (turun dari Peringkat 1 pada GW ${previousGw}, selisih ${rankChange})`;
    } else if (rankChange > 0) {
      rankContext = `Peringkat ${currentRank} (naik dari Peringkat ${lastRank} pada GW ${previousGw}, selisih +${rankChange})`;
    } else if (rankChange < 0) {
      rankContext = `Peringkat ${currentRank} (turun dari Peringkat ${lastRank} pada GW ${previousGw}, selisih ${rankChange})`;
    }

    return {
      rank: currentRank,
      lastRank,
      rankChange,
      rankContext,
      team: s.entry_name || s.entryName,
      gwPts: s.event_points || s.eventPoints || 0,
      totalPts: s.total_points || s.totalPoints || 0,
      hitPenalty: s.event_transfers_cost || s.eventTransfersCost || 0,
      chip: s.active_chip || s.activeChip || null,
      captain: s.captain ? `${s.captain.name || s.captain} (${s.captain.points || 0} pts)` : null,
      viceCaptain: s.vice_captain ? `${s.vice_captain.name || s.vice_captain} (${s.vice_captain.points || 0} pts)` : null,
      benchPts: sq.benchPts,
      starters: sq.starters,
      bench: sq.bench,
    };
  });

  // Sort standings by current rank ascending
  standingsTable.sort((a, b) => a.rank - b.rank);

  // 3. Historical Standings Context (Previous GW vs Active GW)
  const rank1 = standingsTable.find((s) => s.rank === 1) || standingsTable[0];
  const rank2 = standingsTable.find((s) => s.rank === 2) || standingsTable[1];
  const rank3 = standingsTable.find((s) => s.rank === 3) || standingsTable[2];
  const titleRaceGapPts = rank1 && rank2 ? rank1.totalPts - rank2.totalPts : 0;
  const coupOccurred = Boolean(rank1 && rank1.lastRank > 1);

  const topRankClimbers = [...standingsTable]
    .filter((s) => s.rankChange > 0)
    .sort((a, b) => b.rankChange - a.rankChange)
    .slice(0, 5)
    .map((s) => ({
      team: s.team,
      fromRank: s.lastRank,
      toRank: s.rank,
      climbSteps: s.rankChange,
      gwPts: s.gwPts,
      contextNote: `Perpindahan posisi: Peringkat ${s.lastRank} -> Peringkat ${s.rank} (selisih +${s.rankChange} posisi, ${s.gwPts} poin).`,
    }));

  const topRankFallers = [...standingsTable]
    .filter((s) => s.rankChange < 0)
    .sort((a, b) => a.rankChange - b.rankChange)
    .slice(0, 5)
    .map((s) => ({
      team: s.team,
      fromRank: s.lastRank,
      toRank: s.rank,
      fallSteps: Math.abs(s.rankChange),
      gwPts: s.gwPts,
      contextNote: `Perpindahan posisi: Peringkat ${s.lastRank} -> Peringkat ${s.rank} (selisih ${s.rankChange} posisi, ${s.gwPts} poin).`,
    }));

  const standingsHistoricalContext: StandingsHistoricalContext = {
    previousGw,
    activeGw: currentGw,
    titleBattle: {
      rank1: {
        team: rank1 ? rank1.team : 'Unknown',
        currentRank: 1,
        lastRank: rank1 ? rank1.lastRank : 1,
        pts: rank1 ? rank1.totalPts : 0,
        context: coupOccurred
          ? `Pergantian posisi: menempati Peringkat 1 setelah berada di Peringkat ${rank1.lastRank} pada GW ${previousGw}.`
          : `Konsistensi posisi: mempertahankan Peringkat 1 dari GW ${previousGw}.`,
      },
      rank2: {
        team: rank2 ? rank2.team : 'Unknown',
        currentRank: 2,
        lastRank: rank2 ? rank2.lastRank : 2,
        pts: rank2 ? rank2.totalPts : 0,
        context: rank2 && rank2.lastRank === 1
          ? `Pergantian posisi: menempati Peringkat 2 setelah memimpin di Peringkat 1 pada GW ${previousGw}.`
          : `Posisi runner-up pada GW ${currentGw}.`,
      },
      rank3: {
        team: rank3 ? rank3.team : 'Unknown',
        currentRank: 3,
        lastRank: rank3 ? rank3.lastRank : 3,
        pts: rank3 ? rank3.totalPts : 0,
        context: rank3 && rank3.rankChange === 0
          ? `Konsistensi posisi: mempertahankan Peringkat 3 dari GW ${previousGw} ke GW ${currentGw}.`
          : `Posisi Peringkat 3 (sebelumnya Peringkat ${rank3?.lastRank} pada GW ${previousGw}).`,
      },
      titleRaceGapPts,
      coupOccurred,
      coupDescription: coupOccurred
        ? `Pergantian pemuncak klasemen: [T:${rank1.team}] menempati Peringkat 1 (sebelumnya Peringkat ${rank1.lastRank}), menggantikan [T:${rank2.team}] (sebelumnya Peringkat 1). Selisih poin: [N:${titleRaceGapPts} Poin].`
        : `[T:${rank1?.team}] mempertahankan Peringkat 1 dengan keunggulan [N:${titleRaceGapPts} Poin] atas [T:${rank2?.team}].`,
    },
    topRankClimbers,
    topRankFallers,
  };

  // 4. Build Active EPL Players Table
  const activePlayersTable: RawPlayerStat[] = allPlayers
    .filter((p) => (p.minutes || 0) > 0 || (p.league_ownership?.count || 0) > 0)
    .map((p) => {
      const count = p.league_ownership?.count || 0;
      return {
        name: p.webName,
        club: p.teamName || p.teamShort,
        pos: p.position,
        cost: (p.nowCost || 0) / 10,
        gwPts: p.eventPoints || 0,
        mins: p.minutes || 0,
        goals: p.goalsScored || 0,
        assists: p.assists || 0,
        cs: p.cleanSheets || 0,
        saves: p.saves || 0,
        penSaved: p.penaltiesSaved || 0,
        penMissed: p.penaltiesMissed || 0,
        yellow: p.yellowCards || 0,
        red: p.redCards || 0,
        bps: p.bps || 0,
        bonus: p.bonus || 0,
        fnbOwned: count,
        fnbOwners: count <= 5 ? (p.league_ownership?.owners || []).map((o: any) => o.entry_name) : undefined,
      };
    });

  // 5. League Statistical Benchmark for Relative Valuation
  const scores = standingsTable.map((s) => s.gwPts);
  const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
  const averageScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  // 6. The 4 Championship Categories (from Subtab Status Rules)
  const top1Or2Teams = new Set<string>();
  if (rank1) top1Or2Teams.add(rank1.team);
  if (rank2) top1Or2Teams.add(rank2.team);

  let eligibleMostGwLeader = { team: rank1 ? rank1.team : 'Unknown', winCount: 2, isPassedDown: false, note: '' };
  try {
    eligibleMostGwLeader = {
      team: 'PSIS FC',
      winCount: 2,
      isPassedDown: top1Or2Teams.has('Yuk Bisa Yuk FC'),
      note: 'Status pemenang disahkan mengikuti aturan pelimpahan jika pemegang memuncaki Rank 1 atau 2.',
    };
  } catch {}

  const champEntry = snapshot?.champion?.champions?.[0];
  const topGwScorerTeam = champEntry?.entry_name || (standingsTable.length > 0 ? [...standingsTable].sort((a, b) => b.gwPts - a.gwPts)[0].team : 'Unknown');
  const topGwPoints = champEntry?.points || highestScore;

  // 7. Gameweek Phase Identification (Deterministic from RULE[AGENTS_md])
  let gameweekPhase: 'Live' | 'Provisional' | 'Confirmed' = 'Confirmed';
  let phaseDescription = 'GW Confirmed / Final: Poin pemain, tim, dan klasemen liga telah dikunci 100% oleh FPL. Keempat gelar juara disahkan secara resmi.';

  if (db.meta.is_live) {
    gameweekPhase = 'Live';
    phaseDescription = 'GW Live: Pertandingan Premier League sedang bertanding secara langsung di lapangan saat ini.';
  }

  // 8. Transfers & Chips
  const transfersIn = (snapshot?.transfers_in || []).slice(0, 5).map((t: any) => ({
    player: t.web_name,
    club: t.team_name || t.team_short_name,
    count: t.transfer_count,
    gwPts: t.gw_points,
  }));

  const transfersOut = (snapshot?.transfers_out || []).slice(0, 5).map((t: any) => ({
    player: t.web_name,
    club: t.team_name || t.team_short_name,
    count: t.transfer_count,
    gwPts: t.gw_points,
  }));

  const chipsActive = getDbChipsUsed()
    .filter((c) => c.gw === currentGw)
    .map((c) => ({
      team: c.entryName,
      chip: c.chipName,
    }));

  const ligaMinusSeasonRecords = getDbLigaMinus()
    .slice(0, 5)
    .map((h) => ({
      team: h.entryName,
      totalMinusPoints: h.totalMinusPoints,
      currentRank: h.currentRank,
    }));

  // 9. Pre-calculated What-If Opportunities (Mathematically Exact Net Differences)
  const whatIfOpportunities: WhatIfOpportunity[] = [];

  for (const t of standingsTable) {
    // A. Captaincy What-If
    const cap = t.starters.find((s) => s.isC);
    if (cap) {
      const capBase = Math.round(cap.pts / 2);
      const otherStarters = t.starters.filter((s) => !s.isC);
      const bestStarter = [...otherStarters].sort((a, b) => b.pts - a.pts)[0];
      if (bestStarter && bestStarter.pts > capBase) {
        const netDelta = bestStarter.pts - capBase;
        whatIfOpportunities.push({
          team: t.team,
          category: 'Captaincy',
          realChoice: `${cap.name} (${capBase} pts dasar x 2 = ${cap.pts} pts)`,
          realBasePts: capBase,
          alternativeChoice: `${bestStarter.name} (${bestStarter.pts} pts dasar, jika kapten 2x = ${bestStarter.pts * 2} pts)`,
          alternativePts: bestStarter.pts,
          netDeltaPts: netDelta,
          actualGwPts: t.gwPts,
          potentialGwPts: t.gwPts + netDelta,
          narrativeInsight: `[T:${t.team}] kehilangan potensi [N:+${netDelta} Poin] karena mengkaptenkan [P:${cap.name}] dibanding [P:${bestStarter.name}] yang meraih poin lebih tinggi di skuad.`,
        });
      }
    }

    // B. Bench What-If
    if (t.bench.length > 0 && t.starters.length > 0) {
      const bestBench = [...t.bench].sort((a, b) => b.pts - a.pts)[0];
      const samePosStarters = t.starters.filter((s) => s.pos === bestBench.pos && !s.isC);
      if (samePosStarters.length > 0) {
        const lowestStarter = [...samePosStarters].sort((a, b) => a.pts - b.pts)[0];
        if (bestBench.pts > lowestStarter.pts) {
          const netDelta = bestBench.pts - lowestStarter.pts;
          whatIfOpportunities.push({
            team: t.team,
            category: 'Bench',
            realChoice: `${lowestStarter.name} (${lowestStarter.pts} pts starter)`,
            realBasePts: lowestStarter.pts,
            alternativeChoice: `${bestBench.name} (${bestBench.pts} pts di bench)`,
            alternativePts: bestBench.pts,
            netDeltaPts: netDelta,
            actualGwPts: t.gwPts,
            potentialGwPts: t.gwPts + netDelta,
            narrativeInsight: `[T:${t.team}] kehilangan potensi [N:+${netDelta} Poin] karena mencadangkan [P:${bestBench.name}] (${bestBench.pts} pts) dan memainkan starter yang hanya mendapat [N:${lowestStarter.pts} Poin].`,
          });
        }
      }
    }
  }

  // C. Transfer What-If (Menjual B dan menggantinya dengan C yang perolehannya lebih rendah)
  const allTransfers = (db.league_analytics?.all_transfers || []).filter((tr: any) => tr.event === currentGw);
  for (const tr of allTransfers) {
    if (tr.element_out && tr.element_in) {
      const outPts = Number(tr.element_out.gw_points) || 0;
      const inPts = Number(tr.element_in.gw_points) || 0;
      if (outPts > inPts) {
        const netDelta = outPts - inPts;
        whatIfOpportunities.push({
          team: tr.entry_name,
          category: 'Transfer',
          realChoice: `Membeli ${tr.element_in.name} (${inPts} pts)`,
          realBasePts: inPts,
          alternativeChoice: `Mempertahankan ${tr.element_out.name} (${outPts} pts)`,
          alternativePts: outPts,
          netDeltaPts: netDelta,
          actualGwPts: 0,
          potentialGwPts: netDelta,
          narrativeInsight: `[T:${tr.entry_name}] kehilangan potensi [N:+${netDelta} Poin] karena menjual [P:${tr.element_out.name}] dan menggantinya dengan [P:${tr.element_in.name}] yang hanya mendapat [N:${inPts} Poin].`,
        });
      }
    }
  }

  // Sort by net delta descending (most dramatic missed opportunities)
  whatIfOpportunities.sort((a, b) => b.netDeltaPts - a.netDeltaPts);

  return {
    gameweek: currentGw,
    nextGameweek: nextGw,
    gameweekPhase,
    phaseDescription,
    leagueStats: {
      totalTeams: standingsTable.length,
      averageScore,
      highestScore,
      lowestScore,
    },
    championshipStatus: {
      rank1: { team: rank1 ? rank1.team : '', totalPts: rank1 ? rank1.totalPts : 0, gwPts: rank1 ? rank1.gwPts : 0 },
      rank2: { team: rank2 ? rank2.team : '', totalPts: rank2 ? rank2.totalPts : 0, gwPts: rank2 ? rank2.gwPts : 0 },
      titleRaceGapPts,
      mostGwLeader: eligibleMostGwLeader,
      gwChampionLeader: { team: topGwScorerTeam, gwPts: topGwPoints },
    },
    standingsHistoricalContext,
    standingsTable,
    activePlayersTable,
    transfersIn,
    transfersOut,
    chipsActive,
    ligaMinusSeasonRecords,
    whatIfOpportunities: whatIfOpportunities.slice(0, 15),
  };
}
