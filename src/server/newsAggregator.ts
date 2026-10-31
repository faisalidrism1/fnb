/**
 * News Raw Data Aggregator
 * Extracts pure, unedited, factual tables from the container database for Gemini AI.
 * Strictly NO subjective filtering, NO curation, NO manager personal names (only team names).
 * Enforces historical GW rank checking to deliver maximum contextual drama.
 */

import fs from 'fs';
import path from 'path';
import {
  getOptimalDatabase,
  getDbStandings,
  getGwSnapshot,
  getDbChipsUsed,
  getDbLigaMinus,
} from './db.ts';

export interface RawSquadPlayer {
  name: string;
  club: string;
  pos: string;
  pts: number;
  isC: boolean;
  isVC: boolean;
  matchStatus: 'Finished' | 'Live' | 'Upcoming';
  matchLabel: string; // e.g. "Selesai (FT)" | "Live (68')" | "Belum Main (Kickoff 23:30 WIB)"
  fixture: string; // e.g. "Arsenal 2 - 0 Everton (FT)"
}

export interface RawBenchPlayer {
  name: string;
  club: string;
  pos: string;
  pts: number;
  order: number;
  matchStatus: 'Finished' | 'Live' | 'Upcoming';
  matchLabel: string;
  fixture: string;
}

export interface RawTeamSquad {
  starters: RawSquadPlayer[];
  bench: RawBenchPlayer[];
  benchPts: number;
}

export interface RawFixtureMatchInfo {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffWib: string;
  status: 'Finished' | 'Live' | 'Upcoming';
  statusLabel: string;
  minutes: number;
  scoreDisplay: string;
}

export interface ClubMatchStatusEntry {
  club: string;
  status: 'Finished' | 'Live' | 'Upcoming';
  statusLabel: string;
  fixture: string;
  opponent: string;
}

export interface MatchesOverview {
  totalMatches: number;
  finishedCount: number;
  liveCount: number;
  upcomingCount: number;
  statusSummary: string;
  finishedMatches: RawFixtureMatchInfo[];
  liveMatches: RawFixtureMatchInfo[];
  upcomingMatches: RawFixtureMatchInfo[];
  allMatches: RawFixtureMatchInfo[];
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
  starters: RawSquadPlayer[];
  bench: RawBenchPlayer[];
}

export interface RawPlayerStat {
  name: string;
  club: string;
  pos: string;
  cost: number;
  gwPts: number;
  mins: number;
  matchStatus: 'Finished' | 'Live' | 'Upcoming';
  matchLabel: string;
  fixture: string;
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

export interface ChipDecisionAnalysis {
  team: string;
  chipType: 'TC' | 'BB' | 'WC' | 'FH';
  chipSet: 1 | 2;
  gw: number;
  totalTeamPts: number;
  chipNetGainPts: number;
  decisionEvaluation: string;
  isAll15Scored?: boolean;
  benchPoints?: number;
  zeroScorers?: string[];
  captainName?: string;
  captainBasePts?: number;
}

export interface OwnershipInsights {
  highOwnedTemplate: Array<{
    player: string;
    club: string;
    ownedPercentage: string;
    ownedCount: number;
    gwPts: number;
    impactOutcome: 'Exploded' | 'Flop' | 'Decent';
    insight: string;
  }>;
  lowOwnedDifferentials: Array<{
    player: string;
    club: string;
    ownedPercentage: string;
    ownedCount: number;
    gwPts: number;
    owners: string[];
    insight: string;
  }>;
  notOwnedHighScorers: Array<{
    player: string;
    club: string;
    position: string;
    gwPts: number;
    insight: string;
  }>;
}

export interface PlayerTransferCounterpartRecord {
  managerTeam: string;
  transferType: 'BOUGHT_IN' | 'SOLD_OUT';
  counterpartName: string;
  counterpartClub: string;
  counterpartPosition: string;
  counterpartGwPts: number;
  counterpartCost: number;
  pointDelta: number; // For BOUGHT_IN: (player.gwPts - counterpart.gwPts); For SOLD_OUT: (counterpart.gwPts - player.gwPts)
  narrative: string;
}

export interface InvestigativePlayerDossier {
  player: string;
  club: string;
  position: string;
  cost: number;
  gwPts: number;
  ownershipPercentage: string;
  ownershipCount: number;
  starterCount: number;
  benchCount: number;
  captainCount: number;
  viceCaptainCount: number;
  chipsInvolvingPlayer: string[];
  transfersInCount: number;
  transfersOutCount: number;
  transferCounterparts: PlayerTransferCounterpartRecord[];
  recentRoundPoints: Array<{ round: number; points: number }>;
  keyStats: {
    minutes: number;
    goals: number;
    assists: number;
    cleanSheet: number;
    saves: number;
    penaltiesSaved: number;
    penaltiesMissed: number;
    defensiveContribution?: string;
    yellowCards: number;
    redCards: number;
    bps: number;
    bonus: number;
  };
  investigativeSummary: string;
}

export interface TeamTransferSwapDossier {
  playerIn: {
    name: string;
    club: string;
    position: string;
    gwPts: number;
    cost: number;
  };
  playerOut: {
    name: string;
    club: string;
    position: string;
    gwPts: number;
    cost: number;
  };
  netPointDelta: number; // inPts - outPts
  swapOutcome: 'PROFIT' | 'LOSS' | 'NEUTRAL';
  finding: string;
}

export interface InvestigativeTeamDossier {
  team: string;
  rankTrajectory: {
    currentRank: number;
    lastRank: number;
    rankChange: number;
    trend: 'CLIMBED' | 'FELL' | 'STEADY';
    gapToRank1Pts: number;
    gapToNextRankPts: number;
    trajectoryDescription: string;
  };
  transfers: {
    hitPenalty: number;
    totalSwapsThisGw: number;
    swaps: TeamTransferSwapDossier[];
  };
  ownershipProfile: {
    templateCount: number;
    differentialCount: number;
    templateNames: string[];
    differentialNames: string[];
  };
  lineupDecisions: {
    startersCount: number;
    benchCount: number;
    benchPointsLeft: number;
    topScorerInSquad: { name: string; pts: number; role: 'STARTER' | 'BENCH' };
    lowestStarter: { name: string; pts: number };
    highestBench: { name: string; pts: number } | null;
    benchLossPts: number;
  };
  captaincyDecision: {
    captainName: string;
    captainBasePts: number;
    captainTotalPts: number;
    alternativeBestStarter: { name: string; pts: number };
    missedCaptainPotentialPts: number;
    evaluation: string;
  };
  chipStatus: {
    activeChip: 'TC' | 'BB' | 'WC' | 'FH' | null;
    chipSet?: 1 | 2;
    netGainPts?: number;
    evaluation?: string;
  };
  keyPlayerPerformances: Array<{
    name: string;
    pts: number;
    role: 'STARTER' | 'BENCH' | 'CAPTAIN';
    highlight: string;
  }>;
  investigativeSummary: string;
}

export interface RawMatchdayPayload {
  gameweek: number;
  nextGameweek: number;
  gameweekPhase: 'Not started' | 'Live' | 'Provisional' | 'Confirmed';
  phaseDescription: string;
  clubMatchStatusTable: ClubMatchStatusEntry[];
  matchesOverview: MatchesOverview;
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
  chipDecisions: ChipDecisionAnalysis[];
  ownershipInsights: OwnershipInsights;
  ligaMinusSeasonRecords: Array<{ team: string; totalMinusPoints: number; currentRank: number }>;
  whatIfOpportunities: WhatIfOpportunity[];
  investigativeDossiers: {
    players: InvestigativePlayerDossier[];
    teams: InvestigativeTeamDossier[];
  };
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

  // 1. Load 10 Gameweek Fixtures and map each club's exact match details first
  const CACHE_FILE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');
  let rawCache: any = null;
  let rawGwFixtures: any[] = [];
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      rawCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
      rawGwFixtures = rawCache?.sync_status?.gw_fixtures || [];
    }
  } catch (err: any) {
    console.warn('[News Aggregator] Could not read gw_fixtures from cache:', err.message);
  }

  const EPL_CLUB_NAMES: Record<string, string> = {
    ARS: 'Arsenal', AVL: 'Aston Villa', BOU: 'Bournemouth', BRE: 'Brentford',
    BHA: 'Brighton', CHE: 'Chelsea', CRY: 'Crystal Palace', EVE: 'Everton',
    FUL: 'Fulham', IPS: 'Ipswich Town', LEI: 'Leicester', LIV: 'Liverpool',
    MCI: 'Man City', MUN: 'Man Utd', NEW: 'Newcastle', NFO: "Nott'm Forest",
    SOU: 'Southampton', TOT: 'Spurs', WHU: 'West Ham', WOL: 'Wolves',
  };

  interface ClubFixtureInfo {
    status: 'Finished' | 'Live' | 'Upcoming';
    matchLabel: string;
    fixture: string;
    opponent: string;
  }
  const clubDetailMap = new Map<string, ClubFixtureInfo>();

  const allMatches: RawFixtureMatchInfo[] = rawGwFixtures
    .filter((f) => f.event === currentGw || !f.event)
    .map((fix) => {
      const homeName = EPL_CLUB_NAMES[fix.home_team] || fix.home_team || 'Home';
      const awayName = EPL_CLUB_NAMES[fix.away_team] || fix.away_team || 'Away';
      const isFt = Boolean(fix.finished || fix.finished_provisional || (fix.minutes && fix.minutes >= 90));
      const isStarted = Boolean(fix.started);
      const isLive = Boolean(isStarted && !isFt);

      let status: 'Finished' | 'Live' | 'Upcoming' = 'Upcoming';
      let statusLabel = 'Belum Dimainkan';
      let scoreDisplay = `${homeName} vs ${awayName}`;

      let kickoffWib = '';
      if (fix.kickoff_time) {
        try {
          const d = new Date(fix.kickoff_time);
          kickoffWib = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
        } catch {}
      }

      if (isFt) {
        status = 'Finished';
        statusLabel = 'Selesai (FT)';
        scoreDisplay = `${homeName} ${fix.team_h_score ?? 0} - ${fix.team_a_score ?? 0} ${awayName} (FT)`;
      } else if (isLive) {
        status = 'Live';
        const minStr = fix.minutes ? `Menit ${fix.minutes}` : 'Live';
        statusLabel = `Live (${minStr})`;
        scoreDisplay = `${homeName} ${fix.team_h_score ?? 0} - ${fix.team_a_score ?? 0} ${awayName} (${minStr})`;
      } else {
        status = 'Upcoming';
        statusLabel = kickoffWib ? `Belum Dimainkan (${kickoffWib})` : 'Belum Dimainkan';
        scoreDisplay = `${homeName} vs ${awayName} (${statusLabel})`;
      }

      const homeInfo: ClubFixtureInfo = {
        status,
        matchLabel: statusLabel,
        fixture: scoreDisplay,
        opponent: awayName,
      };
      const awayInfo: ClubFixtureInfo = {
        status,
        matchLabel: statusLabel,
        fixture: scoreDisplay,
        opponent: homeName,
      };

      clubDetailMap.set(homeName.toLowerCase(), homeInfo);
      clubDetailMap.set(awayName.toLowerCase(), awayInfo);
      if (fix.home_team) clubDetailMap.set(String(fix.home_team).toLowerCase(), homeInfo);
      if (fix.away_team) clubDetailMap.set(String(fix.away_team).toLowerCase(), awayInfo);

      return {
        id: fix.id,
        homeTeam: homeName,
        awayTeam: awayName,
        homeScore: fix.team_h_score ?? null,
        awayScore: fix.team_a_score ?? null,
        kickoffWib,
        status,
        statusLabel,
        minutes: fix.minutes || 0,
        scoreDisplay,
      };
    });

  const clubMatchStatusTable: ClubMatchStatusEntry[] = [];
  const registeredClubs = new Set<string>();
  for (const m of allMatches) {
    if (!registeredClubs.has(m.homeTeam)) {
      registeredClubs.add(m.homeTeam);
      clubMatchStatusTable.push({
        club: m.homeTeam,
        status: m.status,
        statusLabel: m.statusLabel,
        fixture: m.scoreDisplay,
        opponent: m.awayTeam,
      });
    }
    if (!registeredClubs.has(m.awayTeam)) {
      registeredClubs.add(m.awayTeam);
      clubMatchStatusTable.push({
        club: m.awayTeam,
        status: m.status,
        statusLabel: m.statusLabel,
        fixture: m.scoreDisplay,
        opponent: m.homeTeam,
      });
    }
  }

  function getClubMatchInfo(clubName: string): ClubFixtureInfo {
    const norm = (clubName || '').toLowerCase().trim();
    return (
      clubDetailMap.get(norm) || {
        status: 'Finished',
        matchLabel: 'Selesai (FT)',
        fixture: `${clubName} (FT)`,
        opponent: '',
      }
    );
  }

  const finishedMatches = allMatches.filter((m) => m.status === 'Finished');
  const liveMatches = allMatches.filter((m) => m.status === 'Live');
  const upcomingMatches = allMatches.filter((m) => m.status === 'Upcoming');

  const statusSummary =
    allMatches.length > 0
      ? `${finishedMatches.length} selesai (FT), ${liveMatches.length} sedang berjalan (Live), ${upcomingMatches.length} belum dimainkan (Upcoming)`
      : 'Seluruh 10 laga pekan ini telah selesai dipertandingkan (100% FT).';

  const matchesOverview: MatchesOverview = {
    totalMatches: allMatches.length,
    finishedCount: finishedMatches.length,
    liveCount: liveMatches.length,
    upcomingCount: upcomingMatches.length,
    statusSummary,
    finishedMatches,
    liveMatches,
    upcomingMatches,
    allMatches,
  };

  // 2. Reconstruct Starting XI (11) and Bench (4) for every team with direct match status on each player
  const managerSquadMap: Record<number, RawTeamSquad> = {};
  for (const p of allPlayers) {
    const owners = p.league_ownership?.owners || [];
    const clubName = p.teamName || p.teamShort;
    const matchInfo = getClubMatchInfo(clubName);

    for (const o of owners) {
      if (!managerSquadMap[o.entry_id]) {
        managerSquadMap[o.entry_id] = { starters: [], bench: [], benchPts: 0 };
      }
      const pts = p.eventPoints || 0;
      if (o.is_starter) {
        managerSquadMap[o.entry_id].starters.push({
          name: p.webName,
          club: clubName,
          pos: p.position,
          pts: pts * (o.multiplier || 1),
          isC: Boolean(o.is_captain),
          isVC: Boolean(o.is_vice_captain),
          matchStatus: matchInfo.status,
          matchLabel: matchInfo.matchLabel,
          fixture: matchInfo.fixture,
        });
      } else {
        managerSquadMap[o.entry_id].bench.push({
          name: p.webName,
          club: clubName,
          pos: p.position,
          pts,
          order: o.position_in_squad || 12,
          matchStatus: matchInfo.status,
          matchLabel: matchInfo.matchLabel,
          fixture: matchInfo.fixture,
        });
        managerSquadMap[o.entry_id].benchPts += pts;
      }
    }
  }

  // Sort starters (GKP first, then DEF, MID, FWD) and bench (by position order)
  for (const sq of Object.values(managerSquadMap)) {
    sq.bench.sort((a, b) => a.order - b.order);
  }

  // 3. Build 97 Teams Standings Table with Historical GW Context
  const standingsTable: RawTeamEntry[] = standings.map((s) => {
    const sq = managerSquadMap[s.entry_id] || { starters: [], bench: [], benchPts: 0 };
    const currentRank = Number(s.rank);
    const lastRank = Number(s.last_rank || s.lastRank || currentRank);
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
      const clubName = p.teamName || p.teamShort || '';
      const matchInfo = getClubMatchInfo(clubName);
      return {
        name: p.webName,
        club: clubName,
        pos: p.position,
        cost: (p.nowCost || 0) / 10,
        gwPts: p.eventPoints || 0,
        mins: p.minutes || 0,
        matchStatus: matchInfo.status,
        matchLabel: matchInfo.matchLabel,
        fixture: matchInfo.fixture,
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
  const top1Or2EntryIds = new Set<number>();
  const top1Or2Teams = new Set<string>();
  if (rank1) top1Or2Teams.add(rank1.team);
  if (rank2) top1Or2Teams.add(rank2.team);

  const r1Entry = standings.find((s) => s.rank === 1);
  const r2Entry = standings.find((s) => s.rank === 2);
  if (r1Entry?.entry_id) top1Or2EntryIds.add(r1Entry.entry_id);
  if (r2Entry?.entry_id) top1Or2EntryIds.add(r2Entry.entry_id);

  const rawMostGwList: any[] = db.league_analytics?.most_gameweek_champions || [];
  const mostGwWithWins = rawMostGwList.filter((m: any) => m && m.win_count > 0);
  const rawTopLeader = mostGwWithWins[0];

  const eligibleLeader = mostGwWithWins.find((m: any) => {
    if (m.entry_id && top1Or2EntryIds.has(m.entry_id)) return false;
    if (m.entry_name && top1Or2Teams.has(m.entry_name)) return false;
    return true;
  }) || rawTopLeader;

  const isPassedDown = Boolean(
    eligibleLeader &&
    rawTopLeader &&
    (eligibleLeader.entry_id !== rawTopLeader.entry_id || eligibleLeader.entry_name !== rawTopLeader.entry_name)
  );

  const eligibleMostGwLeader = {
    team: eligibleLeader?.entry_name || (rank1 ? rank1.team : 'Unknown'),
    winCount: eligibleLeader?.win_count || 0,
    isPassedDown,
    originalLeaderTeam: rawTopLeader?.entry_name || '',
    note: isPassedDown
      ? `Pelimpahan hak: Peringkat teratas Most GW (${rawTopLeader?.entry_name}) menempati Peringkat 1 atau 2 klasemen, sehingga status Juara Terbanyak dilimpahkan ke ${eligibleLeader?.entry_name} (${eligibleLeader?.win_count} kemenangan mingguan).`
      : `Memimpin Most GW dengan koleksi ${eligibleLeader?.win_count || 0} kemenangan mingguan.`,
  };

  const champEntry = snapshot?.champion?.champions?.[0];
  const topGwScorerTeam = champEntry?.entry_name || (standingsTable.length > 0 ? [...standingsTable].sort((a, b) => b.gwPts - a.gwPts)[0].team : 'Unknown');
  const topGwPoints = champEntry?.points || highestScore;

  // 7. Gameweek Phase Identification (Deterministic from RULE[AGENTS_md])
  let gameweekPhase: 'Not started' | 'Live' | 'Provisional' | 'Confirmed' = 'Confirmed';
  let phaseDescription = 'GW Confirmed / Final: Poin pemain, tim, dan klasemen liga telah dikunci 100% oleh FPL. Keempat gelar juara disahkan secara resmi.';

  const isAllUpcoming = allMatches.length > 0 && finishedMatches.length === 0 && liveMatches.length === 0;
  const isAllFinished = allMatches.length > 0 && finishedMatches.length === allMatches.length;

  if (rawCache?.gw_status?.status === 'Not started' || isAllUpcoming) {
    gameweekPhase = 'Not started';
    phaseDescription = `GW Not started (Pra-Gameweek): Belum ada pertandingan yang dimainkan di pekan ini (seluruh ${upcomingMatches.length} laga berstatus Upcoming). Fokus berita adalah strategi susunan pemain manajer: transfer in/out terpopuler, aktivasi chip, pemilihan kapten, dan penalti hits sebelum kickoff pembuka.`;
  } else if (liveMatches.length > 0) {
    gameweekPhase = 'Live';
    phaseDescription = `GW Live (Pertandingan Berlangsung): Ada ${liveMatches.length} laga sedang bergulir langsung di lapangan saat ini. Fokus berita adalah menit berjalan dan aksi langsung pemain yang sedang mengubah skor tim secara live.`;
  } else if (finishedMatches.length > 0 && upcomingMatches.length > 0) {
    gameweekPhase = 'Live';
    phaseDescription = `GW Live (Jeda Antar-Pertandingan / Inter-Match): ${finishedMatches.length} laga telah tuntas dan ${upcomingMatches.length} laga belum dimainkan, dengan 0 laga aktif di lapangan saat ini. Fokus berita adalah evaluasi hasil laga yang sudah usai (FT) vs tim-tim di bawah yang masih menyimpan amunisi pemain/kapten di laga berikutnya untuk melakukan kudeta tahta.`;
  } else if (isAllFinished && (rawCache?.gw_status?.status === 'Provisional' || rawCache?.gw_status?.data_checked === false || rawCache?.gw_status?.leagues_status !== 'Updated')) {
    gameweekPhase = 'Provisional';
    phaseDescription = 'GW Provisional: Seluruh 10 laga pekan ini telah selesai 90 menit (FT). Poin masih bersifat sementara menunggu audit resmi Opta untuk BPS (3, 2, 1), kalkulasi autosub, dan pemotongan penalti hit transfer.';
  } else if (db.meta.is_live) {
    gameweekPhase = 'Live';
    phaseDescription = 'GW Live: Pekan kompetisi sedang aktif berlangsung.';
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

  // 8. Chips & Chip Effectiveness Analysis (2 Set Chip: TC, BB, WC, FH Decision Matrix)
  const allChipsList = (db.league_analytics?.all_chips_used || rawCache?.all_chips_used || []) as any[];
  const chipDecisions: ChipDecisionAnalysis[] = [];
  const chipsActive: Array<{ team: string; chip: string }> = [];

  for (const s of standingsTable) {
    if (s.chip) {
      chipsActive.push({ team: s.team, chip: s.chip });
      const chipCode = String(s.chip).toUpperCase();
      let chipSet: 1 | 2 = 1;

      // Identify whether Set 1 or Set 2 was used
      const userChipRec = allChipsList.find((c: any) => c.entry_name === s.team);
      if (userChipRec) {
        if (chipCode === 'BB') chipSet = userChipRec.bb2?.gw === currentGw ? 2 : 1;
        else if (chipCode === 'TC') chipSet = userChipRec.tc2?.gw === currentGw ? 2 : 1;
        else if (chipCode === 'FH') chipSet = userChipRec.fh2?.gw === currentGw ? 2 : 1;
        else if (chipCode === 'WC') chipSet = userChipRec.wc2?.gw === currentGw ? 2 : 1;
      }

      if (chipCode === 'BB') {
        const benchPoints = s.benchPts;
        const zeroScorers = [...s.starters, ...s.bench].filter((p) => (p.pts || 0) === 0).map((p) => p.name);
        const isAll15Scored = zeroScorers.length === 0;
        chipDecisions.push({
          team: s.team,
          chipType: 'BB',
          chipSet,
          gw: currentGw,
          totalTeamPts: s.gwPts,
          chipNetGainPts: benchPoints,
          benchPoints,
          isAll15Scored,
          zeroScorers,
          decisionEvaluation: isAll15Scored
            ? `Seluruh 15 pemain menyumbang poin (net gain +${benchPoints} poin dari bangku cadangan).`
            : `Menghasilkan net gain +${benchPoints} poin dari bangku cadangan, namun ${zeroScorers.length} pemain membukukan 0 poin (${zeroScorers.join(', ')}).`,
        });
      } else if (chipCode === 'TC') {
        const cap = s.starters.find((p) => p.isC);
        const basePts = cap ? Math.round(cap.pts / 3) : 0;
        const netGain = basePts;
        chipDecisions.push({
          team: s.team,
          chipType: 'TC',
          chipSet,
          gw: currentGw,
          totalTeamPts: s.gwPts,
          chipNetGainPts: netGain,
          captainName: cap?.name || 'Unknown',
          captainBasePts: basePts,
          decisionEvaluation: basePts >= 8
            ? `Kapten tepat pada [P:${cap?.name}]: meraup ${cap?.pts} poin total (net gain ekstra +${netGain} poin).`
            : `Pertaruhan kapten pada [P:${cap?.name}] minim hasil: hanya menghasilkan ${cap?.pts} poin total (net gain ekstra +${netGain} poin).`,
        });
      } else if (chipCode === 'FH') {
        const netAdvantage = Math.max(0, s.gwPts - averageScore);
        chipDecisions.push({
          team: s.team,
          chipType: 'FH',
          chipSet,
          gw: currentGw,
          totalTeamPts: s.gwPts,
          chipNetGainPts: netAdvantage,
          decisionEvaluation: s.gwPts > averageScore
            ? `Skuad sewa 1 pekan Free Hit mengumpulkan ${s.gwPts} poin (+${netAdvantage} poin di atas rata-rata liga).`
            : `Free Hit hanya meraup ${s.gwPts} poin di tengah kebutuhan darurat pekan ini.`,
        });
      } else if (chipCode === 'WC') {
        const netAdvantage = Math.max(0, s.gwPts - averageScore);
        chipDecisions.push({
          team: s.team,
          chipType: 'WC',
          chipSet,
          gw: currentGw,
          totalTeamPts: s.gwPts,
          chipNetGainPts: netAdvantage,
          decisionEvaluation: `Perombakan permanen Wildcard menghasilkan ${s.gwPts} poin awal di klasemen.`,
        });
      }
    }
  }

  // 9. Ownership Intelligence: High Owned (Template), Low Owned (Differentials), Not Owned (0% Owned Potential Gain)
  const ownershipPlayersRaw: any[] = snapshot?.ownership_players || rawCache?.ownership_players?.[currentGw] || [];
  
  // A. High Owned Template (>= 40% kepemilikan di liga)
  const highOwnedTemplate = ownershipPlayersRaw
    .filter((p: any) => (p.owned_percentage || 0) >= 40)
    .sort((a: any, b: any) => (b.owned_percentage || 0) - (a.owned_percentage || 0))
    .slice(0, 8)
    .map((p: any) => {
      const gwPts = Number(p.gw_points) || 0;
      let impactOutcome: 'Exploded' | 'Flop' | 'Decent' = 'Decent';
      if (gwPts >= 8) impactOutcome = 'Exploded';
      else if (gwPts <= 2) impactOutcome = 'Flop';
      return {
        player: p.web_name,
        club: p.team_short_name || p.team_name,
        ownedPercentage: `${p.owned_percentage}%`,
        ownedCount: p.owned_count || 0,
        gwPts,
        impactOutcome,
        insight: impactOutcome === 'Flop'
          ? `Perangkap template liga: dimiliki ${p.owned_percentage}% manajer (${p.owned_count} tim) namun hanya menghasilkan ${gwPts} poin.`
          : impactOutcome === 'Exploded'
          ? `Pilar template mengamankan poin: dimiliki ${p.owned_percentage}% manajer (${p.owned_count} tim) dengan torehan ${gwPts} poin.`
          : `Aset template standar: dimiliki ${p.owned_percentage}% tim dengan ${gwPts} poin.`,
      };
    });

  // B. Low Owned Differentials (<= 5% kepemilikan di liga dengan poin >= 7)
  const lowOwnedDifferentials = ownershipPlayersRaw
    .filter((p: any) => (p.owned_percentage || 0) <= 5 && (p.gw_points || 0) >= 7)
    .sort((a: any, b: any) => (b.gw_points || 0) - (a.gw_points || 0))
    .slice(0, 8)
    .map((p: any) => {
      const ownerNames = (p.owners || []).map((o: any) => o.entry_name).slice(0, 4);
      return {
        player: p.web_name,
        club: p.team_short_name || p.team_name,
        ownedPercentage: `${p.owned_percentage}%`,
        ownedCount: p.owned_count || 0,
        gwPts: p.gw_points || 0,
        owners: ownerNames,
        insight: `Permata diferensial langka: hanya dimiliki ${p.owned_percentage}% manajer (${ownerNames.join(', ')}) dan mendulang ${p.gw_points} poin.`,
      };
    });

  // C. Not Owned High Scorers (0% kepemilikan di FNB League dengan poin >= 10)
  const ownedPlayerIds = new Set(ownershipPlayersRaw.map((p: any) => p.id));
  const allPlayerStats: any[] = rawCache?.player_stats || [];
  const notOwnedHighScorers = allPlayerStats
    .filter((p: any) => !ownedPlayerIds.has(p.id) && (p.eventPoints || 0) >= 10)
    .sort((a: any, b: any) => (b.eventPoints || 0) - (a.eventPoints || 0))
    .slice(0, 8)
    .map((p: any) => ({
      player: p.webName,
      club: p.teamShort || p.teamName,
      position: p.position,
      gwPts: p.eventPoints || 0,
      insight: `Potential gain yang luput dari radar seluruh liga: mencetak ${p.eventPoints} poin di Premier League namun memiliki 0% kepemilikan (tidak dimiliki satu pun tim di liga).`,
    }));

  const ownershipInsights: OwnershipInsights = {
    highOwnedTemplate,
    lowOwnedDifferentials,
    notOwnedHighScorers,
  };

  const ligaMinusSeasonRecords = getDbLigaMinus()
    .slice(0, 5)
    .map((h) => ({
      team: h.entryName,
      totalMinusPoints: h.totalMinusPoints,
      currentRank: h.currentRank,
    }));

  // 10. Pre-calculated What-If Opportunities (Mathematically Exact Net Differences)
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

  // 11. Build Comprehensive Investigative Player & Team Dossiers
  const teamTransfersMap = new Map<string, any[]>();
  const playerTransfersInMap = new Map<string, any[]>();
  const playerTransfersOutMap = new Map<string, any[]>();

  for (const tr of allTransfers) {
    const tName = tr.entry_name;
    if (!teamTransfersMap.has(tName)) teamTransfersMap.set(tName, []);
    teamTransfersMap.get(tName)!.push(tr);

    if (tr.element_in?.name) {
      const pIn = tr.element_in.name;
      if (!playerTransfersInMap.has(pIn)) playerTransfersInMap.set(pIn, []);
      playerTransfersInMap.get(pIn)!.push(tr);
    }
    if (tr.element_out?.name) {
      const pOut = tr.element_out.name;
      if (!playerTransfersOutMap.has(pOut)) playerTransfersOutMap.set(pOut, []);
      playerTransfersOutMap.get(pOut)!.push(tr);
    }
  }

  // Pre-index player roles across all teams
  const playerStarterCountMap = new Map<string, number>();
  const playerBenchCountMap = new Map<string, number>();
  const playerCaptainCountMap = new Map<string, number>();
  const playerViceCaptainCountMap = new Map<string, number>();
  const playerChipsMap = new Map<string, string[]>();

  for (const s of standingsTable) {
    for (const starter of s.starters) {
      playerStarterCountMap.set(starter.name, (playerStarterCountMap.get(starter.name) || 0) + 1);
      if (starter.isC) {
        playerCaptainCountMap.set(starter.name, (playerCaptainCountMap.get(starter.name) || 0) + 1);
        if (s.chip && String(s.chip).toUpperCase() === 'TC') {
          if (!playerChipsMap.has(starter.name)) playerChipsMap.set(starter.name, []);
          playerChipsMap.get(starter.name)!.push(`TC (Triple Captain) oleh [T:${s.team}]`);
        }
      }
      if (starter.isVC) {
        playerViceCaptainCountMap.set(starter.name, (playerViceCaptainCountMap.get(starter.name) || 0) + 1);
      }
    }
    for (const b of s.bench) {
      playerBenchCountMap.set(b.name, (playerBenchCountMap.get(b.name) || 0) + 1);
      if (s.chip && String(s.chip).toUpperCase() === 'BB') {
        if (!playerChipsMap.has(b.name)) playerChipsMap.set(b.name, []);
        playerChipsMap.get(b.name)!.push(`BB (Bench Boost) oleh [T:${s.team}]`);
      }
    }
    if (s.chip && (String(s.chip).toUpperCase() === 'WC' || String(s.chip).toUpperCase() === 'FH')) {
      const chipCode = String(s.chip).toUpperCase();
      const teamSwaps = teamTransfersMap.get(s.team) || [];
      for (const sw of teamSwaps) {
        if (sw.element_in?.name) {
          if (!playerChipsMap.has(sw.element_in.name)) playerChipsMap.set(sw.element_in.name, []);
          playerChipsMap.get(sw.element_in.name)!.push(`${chipCode} oleh [T:${s.team}]`);
        }
      }
    }
  }

  // Build candidate player names
  const candidatePlayerNames = new Set<string>();
  activePlayersTable.filter((p) => p.gwPts >= 6).forEach((p) => candidatePlayerNames.add(p.name));
  transfersIn.slice(0, 10).forEach((t) => candidatePlayerNames.add(t.player));
  transfersOut.slice(0, 10).forEach((t) => candidatePlayerNames.add(t.player));
  highOwnedTemplate.forEach((t) => candidatePlayerNames.add(t.player));
  lowOwnedDifferentials.forEach((d) => candidatePlayerNames.add(d.player));
  notOwnedHighScorers.forEach((n) => candidatePlayerNames.add(n.player));
  for (const [pName, cCount] of playerCaptainCountMap.entries()) {
    if (cCount >= 2) candidatePlayerNames.add(pName);
  }

  const investigativePlayerDossiers: InvestigativePlayerDossier[] = [];
  for (const pName of candidatePlayerNames) {
    const pStat = allPlayerStats.find((p: any) => p.webName === pName) || allPlayers.find((p) => p.webName === pName);
    const activeP = activePlayersTable.find((p) => p.name === pName);

    const clubName = pStat?.teamShort || pStat?.teamName || activeP?.club || '';
    const pos = pStat?.position || activeP?.pos || 'MID';
    const cost = (pStat?.nowCost || 0) / 10 || activeP?.cost || 0;
    const gwPts = pStat?.eventPoints ?? (activeP?.gwPts || 0);

    const ownRec = ownershipPlayersRaw.find((p: any) => p.web_name === pName);
    const ownedPct = ownRec ? `${ownRec.owned_percentage}%` : (pStat?.selectedByPercent ? `${pStat.selectedByPercent}%` : '0%');
    const ownedCount = ownRec ? ownRec.owned_count : (pStat?.league_ownership?.count || 0);

    const transferCounterparts: PlayerTransferCounterpartRecord[] = [];
    const inTrs = playerTransfersInMap.get(pName) || [];
    for (const tr of inTrs) {
      if (tr.element_out) {
        const outPts = Number(tr.element_out.gw_points) || 0;
        const delta = gwPts - outPts;
        transferCounterparts.push({
          managerTeam: tr.entry_name,
          transferType: 'BOUGHT_IN',
          counterpartName: tr.element_out.name,
          counterpartClub: tr.element_out.club,
          counterpartPosition: tr.element_out.position,
          counterpartGwPts: outPts,
          counterpartCost: (tr.element_out.cost || 0) / 10,
          pointDelta: delta,
          narrative: `Ditransfer masuk oleh [T:${tr.entry_name}] menggantikan [P:${tr.element_out.name}] ([C:${tr.element_out.club}], ${outPts} pts). Selisih poin: ${delta >= 0 ? '+' : ''}${delta}.`,
        });
      }
    }

    const outTrs = playerTransfersOutMap.get(pName) || [];
    for (const tr of outTrs) {
      if (tr.element_in) {
        const inPts = Number(tr.element_in.gw_points) || 0;
        const delta = inPts - gwPts;
        transferCounterparts.push({
          managerTeam: tr.entry_name,
          transferType: 'SOLD_OUT',
          counterpartName: tr.element_in.name,
          counterpartClub: tr.element_in.club,
          counterpartPosition: tr.element_in.position,
          counterpartGwPts: inPts,
          counterpartCost: (tr.element_in.cost || 0) / 10,
          pointDelta: delta,
          narrative: `Dijual oleh [T:${tr.entry_name}] demi merekrut [P:${tr.element_in.name}] ([C:${tr.element_in.club}], ${inPts} pts). Selisih poin: ${delta >= 0 ? '+' : ''}${delta}.`,
        });
      }
    }

    const recentRoundPoints = (pStat?.gwHistory || []).slice(-4).map((h: any) => ({
      round: h.round,
      points: h.points,
    }));

    const minutes = pStat?.minutes ?? activeP?.mins ?? 0;
    const goals = pStat?.goalsScored ?? activeP?.goals ?? 0;
    const assists = pStat?.assists ?? activeP?.assists ?? 0;
    const cleanSheet = pStat?.cleanSheets ?? activeP?.cs ?? 0;
    const saves = pStat?.saves ?? activeP?.saves ?? 0;
    const penaltiesSaved = pStat?.penaltiesSaved ?? activeP?.penSaved ?? 0;
    const penaltiesMissed = pStat?.penaltiesMissed ?? activeP?.penMissed ?? 0;
    const yellowCards = pStat?.yellowCards ?? activeP?.yellow ?? 0;
    const redCards = pStat?.redCards ?? activeP?.red ?? 0;
    const bps = pStat?.bps ?? activeP?.bps ?? 0;
    const bonus = pStat?.bonus ?? activeP?.bonus ?? 0;

    let defConNote: string | undefined;
    if (pos === 'DEF' && cleanSheet > 0) {
      defConNote = 'Nirbobol solid (CS terkunci)';
    } else if (saves >= 3) {
      defConNote = `${saves} penyelamatan penting (${Math.floor(saves / 3)} poin saves)`;
    }

    const starterCount = playerStarterCountMap.get(pName) || 0;
    const benchCount = playerBenchCountMap.get(pName) || 0;
    const captainCount = playerCaptainCountMap.get(pName) || 0;
    const viceCaptainCount = playerViceCaptainCountMap.get(pName) || 0;
    const chipsInvolving = playerChipsMap.get(pName) || [];

    let summary = `[P:${pName}] ([C:${clubName}]): ${gwPts} poin, kepemilikan ${ownedPct} (${ownedCount} tim). Dimainkan starter oleh ${starterCount} tim, dicadangkan oleh ${benchCount} tim, dijadikan kapten oleh ${captainCount} tim.`;
    if (transferCounterparts.length > 0) {
      const topSwap = transferCounterparts[0];
      summary += ` Riwayat transfer: ${topSwap.narrative}`;
    }

    investigativePlayerDossiers.push({
      player: pName,
      club: clubName,
      position: pos,
      cost,
      gwPts,
      ownershipPercentage: ownedPct,
      ownershipCount: ownedCount,
      starterCount,
      benchCount,
      captainCount,
      viceCaptainCount,
      chipsInvolvingPlayer: chipsInvolving,
      transfersInCount: inTrs.length,
      transfersOutCount: outTrs.length,
      transferCounterparts: transferCounterparts.slice(0, 5),
      recentRoundPoints,
      keyStats: {
        minutes,
        goals,
        assists,
        cleanSheet,
        saves,
        penaltiesSaved,
        penaltiesMissed,
        defensiveContribution: defConNote,
        yellowCards,
        redCards,
        bps,
        bonus,
      },
      investigativeSummary: summary,
    });
  }

  investigativePlayerDossiers.sort((a, b) => b.gwPts - a.gwPts);

  // Construct InvestigativeTeamDossier list
  const investigativeTeamDossiers: InvestigativeTeamDossier[] = [];
  const candidateTeamNames = new Set<string>();
  standingsTable.slice(0, 15).forEach((t) => candidateTeamNames.add(t.team));
  chipsActive.forEach((c) => candidateTeamNames.add(c.team));
  topRankClimbers.forEach((c) => candidateTeamNames.add(c.team));
  topRankFallers.forEach((f) => candidateTeamNames.add(f.team));
  for (const tr of allTransfers.slice(0, 10)) {
    if (tr.entry_name) candidateTeamNames.add(tr.entry_name);
  }

  for (const tName of candidateTeamNames) {
    const s = standingsTable.find((st) => st.team === tName);
    if (!s) continue;

    const rankTrajectory = {
      currentRank: s.rank,
      lastRank: s.lastRank,
      rankChange: s.rankChange,
      trend: (s.rankChange > 0 ? 'CLIMBED' : s.rankChange < 0 ? 'FELL' : 'STEADY') as 'CLIMBED' | 'FELL' | 'STEADY',
      gapToRank1Pts: rank1 ? Math.max(0, rank1.totalPts - s.totalPts) : 0,
      gapToNextRankPts: s.rank > 1 ? (standingsTable[s.rank - 2]?.totalPts || 0) - s.totalPts : 0,
      trajectoryDescription: s.rankContext,
    };

    const teamTrs = teamTransfersMap.get(tName) || [];
    const swaps: TeamTransferSwapDossier[] = [];
    for (const tr of teamTrs) {
      if (tr.element_in && tr.element_out) {
        const inPts = Number(tr.element_in.gw_points) || 0;
        const outPts = Number(tr.element_out.gw_points) || 0;
        const delta = inPts - outPts;
        const outcome = (delta > 0 ? 'PROFIT' : delta < 0 ? 'LOSS' : 'NEUTRAL') as 'PROFIT' | 'LOSS' | 'NEUTRAL';
        const finding = delta > 0
          ? `Pembelian sukses: mendatangkan [P:${tr.element_in.name}] (${inPts} pts) menggantikan [P:${tr.element_out.name}] (${outPts} pts), surplus +${delta} poin.`
          : delta < 0
          ? `Kehilangan potensi: menjual [P:${tr.element_out.name}] (${outPts} pts) dan menggantinya dengan [P:${tr.element_in.name}] (${inPts} pts), defisit -${Math.abs(delta)} poin.`
          : `Pertukaran netral: [P:${tr.element_in.name}] dan [P:${tr.element_out.name}] sama-sama meraih ${inPts} poin.`;

        swaps.push({
          playerIn: {
            name: tr.element_in.name,
            club: tr.element_in.club || '',
            position: tr.element_in.position || '',
            gwPts: inPts,
            cost: (tr.element_in.cost || 0) / 10,
          },
          playerOut: {
            name: tr.element_out.name,
            club: tr.element_out.club || '',
            position: tr.element_out.position || '',
            gwPts: outPts,
            cost: (tr.element_out.cost || 0) / 10,
          },
          netPointDelta: delta,
          swapOutcome: outcome,
          finding,
        });
      }
    }

    const squadPlayers = [...s.starters, ...s.bench];
    const templateNames: string[] = [];
    const differentialNames: string[] = [];
    for (const p of squadPlayers) {
      const ownRec = ownershipPlayersRaw.find((op: any) => op.web_name === p.name);
      const pct = ownRec ? ownRec.owned_percentage : 0;
      if (pct >= 40) templateNames.push(p.name);
      else if (pct <= 5) differentialNames.push(p.name);
    }

    const sortedStarters = [...s.starters].sort((a, b) => b.pts - a.pts);
    const sortedBench = [...s.bench].sort((a, b) => b.pts - a.pts);
    const topStarter = sortedStarters[0] || { name: 'None', pts: 0 };
    const lowestStarter = sortedStarters[sortedStarters.length - 1] || { name: 'None', pts: 0 };
    const highestBench = sortedBench[0] || null;
    const topScorerInSquad = highestBench && highestBench.pts > topStarter.pts
      ? { name: highestBench.name, pts: highestBench.pts, role: 'BENCH' as const }
      : { name: topStarter.name, pts: topStarter.pts, role: 'STARTER' as const };
    const benchLossPts = highestBench && lowestStarter && highestBench.pts > lowestStarter.pts
      ? highestBench.pts - lowestStarter.pts
      : 0;

    const cap = s.starters.find((p) => p.isC);
    const capBase = cap ? Math.round(cap.pts / 2) : 0;
    const capTotal = cap ? cap.pts : 0;
    const bestAltStarter = s.starters.filter((p) => !p.isC).sort((a, b) => b.pts - a.pts)[0] || { name: 'None', pts: 0 };
    const missedCapPts = Math.max(0, bestAltStarter.pts - capBase);
    const capEvaluation = missedCapPts > 0
      ? `Kehilangan potensi [N:+${missedCapPts} Poin] karena mengkaptenkan [P:${cap?.name}] (${capBase} pts) dibanding [P:${bestAltStarter.name}] (${bestAltStarter.pts} pts).`
      : `Pilihan kapten optimal pada [P:${cap?.name}] (${capBase} pts x 2 = ${capTotal} pts).`;

    const chipRecord = chipDecisions.find((c) => c.team === tName);
    const chipStatus = {
      activeChip: s.chip ? (String(s.chip).toUpperCase() as 'TC' | 'BB' | 'WC' | 'FH') : null,
      chipSet: chipRecord?.chipSet,
      netGainPts: chipRecord?.chipNetGainPts,
      evaluation: chipRecord?.decisionEvaluation,
    };

    const keyPlayerPerformances = sortedStarters.slice(0, 3).map((p) => ({
      name: p.name,
      pts: p.pts,
      role: (p.isC ? 'CAPTAIN' : 'STARTER') as 'STARTER' | 'BENCH' | 'CAPTAIN',
      highlight: `${p.pts} poin`,
    }));

    let summary = `[T:${tName}]: ${s.rankContext}, mendulang ${s.gwPts} poin (total ${s.totalPts} poin).`;
    if (swaps.length > 0) {
      summary += ` Transfer: ${swaps.map((sw) => sw.finding).join(' ')}`;
    }
    if (chipStatus.activeChip) {
      summary += ` Mengaktifkan chip ${chipStatus.activeChip} (Set ${chipStatus.chipSet}): ${chipStatus.evaluation}`;
    }
    if (benchLossPts > 0) {
      summary += ` Bangku cadangan menyisakan ${s.benchPts} poin (kehilangan potensi +${benchLossPts} poin dari [P:${highestBench?.name}]).`;
    }

    investigativeTeamDossiers.push({
      team: tName,
      rankTrajectory,
      transfers: {
        hitPenalty: s.hitPenalty,
        totalSwapsThisGw: teamTrs.length,
        swaps,
      },
      ownershipProfile: {
        templateCount: templateNames.length,
        differentialCount: differentialNames.length,
        templateNames,
        differentialNames,
      },
      lineupDecisions: {
        startersCount: s.starters.length,
        benchCount: s.bench.length,
        benchPointsLeft: s.benchPts,
        topScorerInSquad,
        lowestStarter: { name: lowestStarter.name, pts: lowestStarter.pts },
        highestBench: highestBench ? { name: highestBench.name, pts: highestBench.pts } : null,
        benchLossPts,
      },
      captaincyDecision: {
        captainName: cap?.name || 'None',
        captainBasePts: capBase,
        captainTotalPts: capTotal,
        alternativeBestStarter: { name: bestAltStarter.name, pts: bestAltStarter.pts },
        missedCaptainPotentialPts: missedCapPts,
        evaluation: capEvaluation,
      },
      chipStatus,
      keyPlayerPerformances,
      investigativeSummary: summary,
    });
  }

  return {
    gameweek: currentGw,
    nextGameweek: nextGw,
    gameweekPhase,
    phaseDescription,
    matchesOverview,
    clubMatchStatusTable,
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
    chipDecisions,
    ownershipInsights,
    ligaMinusSeasonRecords,
    whatIfOpportunities: whatIfOpportunities.slice(0, 15),
    investigativeDossiers: {
      players: investigativePlayerDossiers,
      teams: investigativeTeamDossiers,
    },
  };
}
