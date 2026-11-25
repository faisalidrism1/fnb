import {
  ActualPlayerReviewStat,
  DeadBallDutyStatus,
  PlayerGwProjectionCell,
  PositionType,
  ScoutArticlePickRenderedItem,
  ScoutChipStatusItem,
  ScoutEditorialParagraph,
  ScoutPlayerCardItem,
  ScoutSelectionPolicy,
  ServerProjectionCorePayload,
  ServerScoutChipsAnalysis,
  ServerScoutSquadsPayload,
  ServerScoutTransferAnalysis,
  ServerScoutTransferMove,
  SolvedScoutSquadResult,
  StandingsRow,
  TransformedLeagueData,
} from '../types.ts';
import {
  DEFAULT_SCOUT_SELECTION_POLICY,
  ScoutModelPlayerInput,
  getCellAtGw,
  isScoutPlayerEligibleAtGw,
  runScoutTransferSearch,
  scoreCaptainAtGw,
  scoreDifferentialAtGw,
} from '../utils/scoutSelectionModel.ts';
import {
  MatchProjInput,
  ScoutNarrativeInput,
  generateCaptainArticlePicks,
  generateDifferentialArticlePicks,
  resolveClubName,
} from '../utils/scoutNarratives.ts';
import { getFplProvenStatus } from '../utils/fplProvenGuard.ts';

export const SCOUT_FORMING_MIN_GW = 3;

export interface ServerScoutPoolPlayer extends ScoutNarrativeInput {
  position: PositionType;
  clubName: string;
  influence: number;
  bps: number;
  bonus: number;
  starts: number;
  yellowCards: number;
  cleanSheets: number;
  goalsConceded: number;
  deadBall: DeadBallDutyStatus;
  hauls: number;
  maxGwPoints: number;
  status: string;
  chanceOfPlaying: number | null;
  news: string;
  photo: string;
  isBlankTarget: boolean;
  xP1: number;
  avgXp3: number;
  avgXp6: number;
  totalXp6: number;
  fixtures1: Array<{ gw: number; opp: string; isHome: boolean; xp: number; isBlank?: boolean; isDgw?: boolean }>;
  fixtures6: Array<{ gw: number; opp: string; isHome: boolean; xp: number; isBlank?: boolean; isDgw?: boolean }>;
  fullSeasonPointsMap: Record<number, PlayerGwProjectionCell>;
  captainScore: number;
  diffScore: number;
  modelInput: ScoutModelPlayerInput;
}

export interface ServerScoutRuntimeContext {
  epochKey: string;
  baseHistoricalGW: number;
  minFormingGW: number;
  maxFormingGW: number;
  targetNextGW: number;
  effectiveStandingsGW: number;
  effectiveOwnershipGW: number;
  clubNameMap: Record<string, string>;
  targetGwMatchProjections: Map<string, MatchProjInput>;
  playerPool: ServerScoutPoolPlayer[];
  playerPoolById: Map<number, ServerScoutPoolPlayer>;
  policy: ScoutSelectionPolicy;
}

const FPL_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const MANAGER_FINANCE_CACHE_MAX = 250;
const MANAGER_FINANCE_TTL_MS = 30_000;
const HISTORICAL_PRICE_TTL_MS = 6 * 60 * 60 * 1000;
const managerFinanceCache = new Map<
  number,
  { timestamp: number; bank: number; history: any[]; chips: any[]; transfers: any[]; entryName?: string }
>();
let bootstrapStartPriceCache: { timestamp: number; startCostTenthsById: Map<number, number> } | null = null;
const elementRoundPriceCache = new Map<
  number,
  { timestamp: number; roundValueTenths: Map<number, number> }
>();

export function clearScoutManagerFinanceCache(): void {
  managerFinanceCache.clear();
  bootstrapStartPriceCache = null;
  elementRoundPriceCache.clear();
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function resolvePopulatedGwKey<T>(
  record: Record<number, T[]> | undefined,
  preferredPrimary: number,
  preferredSecondary: number,
  maxAllowedGw: number
): number {
  if (preferredPrimary <= maxAllowedGw && record?.[preferredPrimary]?.length) return preferredPrimary;
  if (preferredSecondary <= maxAllowedGw && record?.[preferredSecondary]?.length) return preferredSecondary;
  const keys = Object.keys(record || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n <= maxAllowedGw && (record?.[n]?.length || 0) > 0);
  return keys.length > 0 ? Math.max(...keys) : Math.min(preferredSecondary, maxAllowedGw);
}

export function buildServerScoutContext(params: {
  cachedData: TransformedLeagueData;
  corePayload: ServerProjectionCorePayload;
  actualPlayerStatsMap?: Record<number, Record<number, ActualPlayerReviewStat>>;
  matchesWithLineupsByGw?: Record<number, any[]>;
  policy?: ScoutSelectionPolicy;
}): ServerScoutRuntimeContext {
  const {
    cachedData,
    corePayload,
    actualPlayerStatsMap,
    matchesWithLineupsByGw,
    policy = DEFAULT_SCOUT_SELECTION_POLICY,
  } = params;

  const targetNextGW = Math.min(38, Math.max(1, corePayload.targetNextGW || (corePayload.baseHistoricalGW || 0) + 1));
  const minFormingGW = SCOUT_FORMING_MIN_GW;
  const maxFormingGW = Math.max(0, Math.min(corePayload.baseHistoricalGW || 0, targetNextGW - 1));
  const baseHistoricalGW = maxFormingGW;
  const currentGW = Math.min(cachedData.current_gw || targetNextGW, targetNextGW);

  const effectiveStandingsGW = resolvePopulatedGwKey(cachedData.standings, currentGW, baseHistoricalGW, targetNextGW);
  const effectiveOwnershipGW = resolvePopulatedGwKey(
    cachedData.ownership_players,
    currentGW,
    baseHistoricalGW,
    targetNextGW
  );

  const standingsList = cachedData.standings?.[effectiveStandingsGW] || [];
  const totalManagersCount = standingsList.length > 0 ? standingsList.length : 97;

  const fnbOwnershipMap = new Map<number, number>();
  const ownershipList = cachedData.ownership_players?.[effectiveOwnershipGW] || [];
  for (const p of ownershipList) {
    const count = p.owners ? p.owners.length : p.owned_count || 0;
    const pct = (count / totalManagersCount) * 100;
    fnbOwnershipMap.set(p.id, round1(pct));
  }

  const clubNameMap: Record<string, string> = {};
  for (const c of corePayload.clubs || []) {
    if (c?.short && c?.name) clubNameMap[c.short] = c.name;
  }

  const targetGwMatchProjections = new Map<string, MatchProjInput>();
  const suffix = `_${targetNextGW}`;
  for (const [key, list] of Object.entries(corePayload.clubGwMatchProjections || {})) {
    if (!key.endsWith(suffix) || !Array.isArray(list)) continue;
    const clubShort = key.slice(0, key.length - suffix.length);
    if (!clubShort) continue;
    if (list.length === 0) {
      targetGwMatchProjections.set(clubShort, {
        oppShort: 'Blank',
        isHome: true,
        teamLambda: 0,
        oppLambda: 0,
        csProb: 0,
        isBlank: true,
        matches: [],
      });
      continue;
    }
    const first = list[0];
    const sumTeamLambda = list.reduce((s, item) => s + Number(item.teamLambda || 0), 0);
    const sumOppLambda = list.reduce((s, item) => s + Number(item.oppLambda || 0), 0);
    const maxCsPct = Math.max(
      ...list.map((item) =>
        typeof item.csProbPct === 'number' ? item.csProbPct : Math.round(Number(item.csProb || 0) * 100)
      )
    );
    targetGwMatchProjections.set(clubShort, {
      oppShort: list.length >= 2 ? list.map((m) => m.oppShort).join(' + ') : first.oppShort,
      isHome: first.isHome,
      teamLambda: Number(sumTeamLambda.toFixed(2)),
      oppLambda: Number(sumOppLambda.toFixed(2)),
      csProb: maxCsPct,
      isBlank: false,
      matches: list.map((item) => ({
        oppShort: item.oppShort,
        isHome: item.isHome,
        teamLambda: item.teamLambda,
        oppLambda: item.oppLambda,
        csProb: typeof item.csProbPct === 'number' ? item.csProbPct : Math.round(Number(item.csProb || 0) * 100),
      })),
    });
  }

  for (const [clubShort, entries] of Object.entries(corePayload.clubNextMatchesMap || {})) {
    if (targetGwMatchProjections.has(clubShort) || !Array.isArray(entries)) continue;
    if (entries.length === 0) {
      targetGwMatchProjections.set(clubShort, {
        oppShort: 'Blank',
        isHome: true,
        teamLambda: 0,
        oppLambda: 0,
        csProb: 0,
        isBlank: true,
        matches: [],
      });
    } else {
      const first = entries[0];
      targetGwMatchProjections.set(clubShort, {
        oppShort: entries.length >= 2 ? entries.map((e) => e.opponentShort).join(' + ') : first.opponentShort,
        isHome: first.isHome,
        teamLambda: 1.4,
        oppLambda: 1.2,
        csProb: 28,
        isBlank: false,
        matches: entries.map((e) => ({ oppShort: e.opponentShort, isHome: e.isHome })),
      });
    }
  }

  const projById = new Map(corePayload.allPlayerFullSeasonProjections.map((p) => [p.id, p]));
  const rawPlayers = cachedData.player_stats || [];

  const wildcardGWs = [
    targetNextGW,
    targetNextGW + 1,
    targetNextGW + 2,
    targetNextGW + 3,
    targetNextGW + 4,
    targetNextGW + 5,
  ].filter((g) => g <= 38);

  // Index match-level stats strictly within [minFormingGW..maxFormingGW] (GW 3..n-1)
  type WindowMatchStat = {
    mins: number;
    pts: number;
    goals: number;
    assists: number;
    cs: number;
    gc: number;
    bps: number;
    bonus: number;
    starts: number;
    yc: number;
    xG: number;
    xA: number;
    xGI: number;
    threat: number;
    creativity: number;
    influence: number;
  };
  const matchStatByPlayerGw = new Map<number, Map<number, WindowMatchStat>>();
  if (matchesWithLineupsByGw) {
    for (let gw = minFormingGW; gw <= maxFormingGW; gw++) {
      const mList = matchesWithLineupsByGw[gw] || [];
      for (const m of mList) {
        const ingestSide = (list: any[] | undefined, isStarter: boolean) => {
          if (!Array.isArray(list)) return;
          for (const item of list) {
            const pid = Number(item?.id || 0);
            if (!pid) continue;
            const st = item?.stats || {};
            const mMins = Number(st.minutes ?? item?.minutes ?? 0);
            const mPts = Number(typeof item?.gw_points === 'number' ? item.gw_points : (st.total_points ?? 0));
            const mXg = Number(st.expected_goals ?? 0);
            const mXa = Number(st.expected_assists ?? 0);
            const mXgi = Number(st.expected_goal_involvements ?? (mXg + mXa));

            let pMap = matchStatByPlayerGw.get(pid);
            if (!pMap) {
              pMap = new Map();
              matchStatByPlayerGw.set(pid, pMap);
            }
            const cur = pMap.get(gw) || {
              mins: 0,
              pts: 0,
              goals: 0,
              assists: 0,
              cs: 0,
              gc: 0,
              bps: 0,
              bonus: 0,
              starts: 0,
              yc: 0,
              xG: 0,
              xA: 0,
              xGI: 0,
              threat: 0,
              creativity: 0,
              influence: 0,
            };
            cur.mins += mMins;
            cur.pts += mPts;
            cur.goals += Number(st.goals_scored ?? 0);
            cur.assists += Number(st.assists ?? 0);
            cur.cs += Number(st.clean_sheets ?? 0);
            cur.gc += Number(st.goals_conceded ?? 0);
            cur.bps += Number(st.bps ?? 0);
            cur.bonus += Number(st.bonus ?? 0);
            cur.starts += isStarter ? 1 : 0;
            cur.yc += Number(st.yellow_cards ?? 0);
            cur.xG += mXg;
            cur.xA += mXa;
            cur.xGI += mXgi;
            cur.threat += Number(st.threat ?? 0);
            cur.creativity += Number(st.creativity ?? 0);
            cur.influence += Number(st.influence ?? 0);
            pMap.set(gw, cur);
          }
        };
        ingestSide(m?.home_lineup, true);
        ingestSide(m?.home_bench, false);
        ingestSide(m?.away_lineup, true);
        ingestSide(m?.away_bench, false);
      }
    }
  }

  const playerPool: ServerScoutPoolPlayer[] = rawPlayers.map((p: any) => {
    const proj = projById.get(p.id);
    const cost = proj
      ? proj.nowCost
      : typeof p.nowCost === 'number'
      ? p.nowCost > 20
        ? p.nowCost / 10
        : p.nowCost
      : (p.now_cost || 50) / 10;

    // Strictly windowed GW history: ONLY [minFormingGW..maxFormingGW] (GW 3..n-1)
    const rawHistory = Array.isArray(p.gwHistory) ? p.gwHistory : [];
    const causalHistory = rawHistory.filter((h: any) => {
      const r = Number(h?.round || 0);
      return r >= minFormingGW && r <= maxFormingGW;
    });
    const histByGw = new Map<number, any>();
    for (const h of causalHistory) {
      histByGw.set(Number(h.round), h);
    }

    const pMatchMap = matchStatByPlayerGw.get(p.id);
    const causalActualGws = actualPlayerStatsMap?.[p.id];

    // Reconstruct ALL forming stats strictly from GW 3..maxFormingGW (never read raw bootstrap aggregates!)
    let sumMins = 0;
    let pts = 0;
    let goals = 0;
    let assists = 0;
    let cleanSheets = 0;
    let goalsConceded = 0;
    let bps = 0;
    let bonus = 0;
    let starts = 0;
    let yellowCards = 0;
    let xG = 0;
    let xA = 0;
    let xGI = 0;
    let threat = 0;
    let creativity = 0;
    let influence = 0;
    let playedCausal = 0;
    const roundPtsList: Array<{ gw: number; pts: number }> = [];
    let causalHauls = 0;
    let causalMaxPts = 0;

    for (let g = minFormingGW; g <= maxFormingGW; g++) {
      const ms = pMatchMap?.get(g);
      const h = histByGw.get(g);
      const act = causalActualGws?.[g];

      if (!ms && !h && !act) continue;

      const gMins = ms ? ms.mins : Number(h?.minutes ?? act?.mins ?? 0);
      const gPts = ms ? ms.pts : Number(h?.points ?? act?.pts ?? 0);
      const gGoals = ms ? ms.goals : Number(h?.goals ?? 0);
      const gAssists = ms ? ms.assists : Number(h?.assists ?? 0);
      const gCs = ms ? ms.cs : Number(h?.cleanSheets ?? 0);
      const gGc = ms ? ms.gc : Number(h?.goalsConceded ?? 0);
      const gBps = ms ? ms.bps : Number(h?.bps ?? 0);
      const gBonus = ms ? ms.bonus : Number(h?.bonus ?? 0);
      const gStarts = ms ? ms.starts : act ? (act.wasStarter ? 1 : 0) : gMins >= 55 ? 1 : 0;
      const gYc = ms ? ms.yc : Number(h?.yellowCards ?? 0);
      const gXg = ms ? ms.xG : Number(h?.expectedGoals ?? gGoals);
      const gXa = ms ? ms.xA : Number(h?.expectedAssists ?? gAssists);
      const gXgi = ms ? ms.xGI : Number(h?.expectedGoalInvolvements ?? gXg + gXa);
      const gThreat = ms ? ms.threat : Number(h?.threat ?? gGoals * 22);
      const gCreativity = ms ? ms.creativity : Number(h?.creativity ?? gAssists * 20);
      const gInfluence = ms ? ms.influence : Number(h?.influence ?? Math.max(0, gPts * 4));

      sumMins += gMins;
      pts += gPts;
      goals += gGoals;
      assists += gAssists;
      cleanSheets += gCs;
      goalsConceded += gGc;
      bps += gBps;
      bonus += gBonus;
      starts += gStarts;
      yellowCards += gYc;
      xG += gXg;
      xA += gXa;
      xGI += gXgi;
      threat += gThreat;
      creativity += gCreativity;
      influence += gInfluence;

      if (gMins > 0) playedCausal++;
      roundPtsList.push({ gw: g, pts: gPts });
      if (gPts >= 10) causalHauls++;
      if (gPts > causalMaxPts) causalMaxPts = gPts;
    }

    const mins = Math.max(sumMins, 1);
    xG = round2(xG);
    xA = round2(xA);
    xGI = round2(xGI);
    threat = round1(threat);
    creativity = round1(creativity);
    influence = round1(influence);

    const recentRounds = roundPtsList.slice(-4);
    const form =
      recentRounds.length > 0
        ? round1(recentRounds.reduce((s, r) => s + r.pts, 0) / recentRounds.length)
        : 0;
    const ppg = playedCausal > 0 ? round1(pts / playedCausal) : 0;
    const hauls = causalHauls;
    const maxGwPoints = causalMaxPts;

    const cShort = proj?.teamShort || p.teamShort || p.team_short_name || '';

    // Filter fullSeasonPointsMap: omit gw < minFormingGW (GW 1..2); for gw >= targetNextGW keep projection fields only
    const rawFullMap = (proj?.fullSeasonPointsMap || {}) as Record<number, PlayerGwProjectionCell>;
    const fullSeasonPointsMap: Record<number, PlayerGwProjectionCell> = {};
    for (const [gwStr, cell] of Object.entries(rawFullMap)) {
      const gNum = Number(gwStr);
      if (!Number.isFinite(gNum) || gNum < minFormingGW) continue;
      if (gNum >= targetNextGW) {
        fullSeasonPointsMap[gNum] = {
          opp: cell.opp,
          isHome: cell.isHome,
          xp: cell.xp,
          baseXp: cell.baseXp,
          spikeMod: cell.spikeMod,
          xMin: cell.xMin,
          pStart: cell.pStart,
          pPlay60: cell.pPlay60,
          mcQ85: cell.mcQ85,
          mcPHaul10: cell.mcPHaul10,
          ...(cell.mcQuantiles ? { mcQuantiles: cell.mcQuantiles } : {}),
          isBlank: cell.isBlank,
          isDgw: cell.isDgw,
          matchCount: cell.matchCount,
          matches: cell.matches,
        };
      } else {
        fullSeasonPointsMap[gNum] = cell;
      }
    }

    const deadBall: DeadBallDutyStatus = proj?.deadBall || {
      isPrimaryPen: p.penaltiesOrder === 1 || p.penalties_order === 1,
      isSecondaryPen: p.penaltiesOrder === 2 || p.penalties_order === 2,
      isFkTaker: (p.directFreekicksOrder ?? p.direct_freekicks_order ?? 99) <= 2,
      isCornerTaker: (p.cornersAndIndirectFreekicksOrder ?? p.corners_and_indirect_freekicks_order ?? 99) <= 2,
    };

    const status = proj?.status || p.status || 'a';
    const chanceOfPlaying =
      proj?.chance ?? p.chanceOfPlayingNextRound ?? p.chanceOfPlayingThisRound ?? p.chance_of_playing_next_round ?? null;
    const news = proj?.news || p.news || '';
    const fnbOwn = fnbOwnershipMap.get(p.id) || 0;

    const targetCell = fullSeasonPointsMap[targetNextGW];
    const matchProj = targetGwMatchProjections.get(cShort);
    const isBlankTarget = Boolean(targetCell?.isBlank || (!targetCell && matchProj?.isBlank));

    const targetOpp = isBlankTarget
      ? 'Blank'
      : targetCell?.opp
      ? targetCell.opp
      : matchProj?.oppShort && !matchProj.isBlank
      ? `${matchProj.oppShort} (${matchProj.isHome ? 'H' : 'A'})`
      : '-';
    const targetIsHome = targetCell?.isHome ?? matchProj?.isHome ?? true;

    const xP1 = isBlankTarget
      ? 0
      : targetCell?.xp !== undefined
      ? Number(targetCell.xp.toFixed(1))
      : Number((form * 0.55 + ppg * 0.35 + xGI * 0.4).toFixed(1));

    let sum6 = 0;
    const fixtures6: Array<{
      gw: number;
      opp: string;
      isHome: boolean;
      xp: number;
      isBlank?: boolean;
      isDgw?: boolean;
    }> = [];

    for (const g of wildcardGWs) {
      const cell = fullSeasonPointsMap[g];
      const cellBlank = Boolean(cell?.isBlank);
      const gXp = cellBlank ? 0 : cell?.xp !== undefined ? Number(cell.xp.toFixed(1)) : xP1;
      const gOpp = cellBlank ? 'Blank' : cell?.opp ? cell.opp : g === targetNextGW ? targetOpp : '-';
      const gHome = cell?.isHome ?? (g === targetNextGW ? targetIsHome : true);
      sum6 += gXp;
      fixtures6.push({
        gw: g,
        opp: gOpp,
        isHome: gHome,
        xp: gXp,
        isBlank: cellBlank,
        isDgw: Boolean(cell?.isDgw),
      });
    }

    const avgXp6 = wildcardGWs.length > 0 ? Number((sum6 / wildcardGWs.length).toFixed(1)) : xP1;
    const totalXp6 = Number(sum6.toFixed(1));
    const fixtures1 =
      fixtures6.length > 0
        ? [fixtures6[0]]
        : [
            {
              gw: targetNextGW,
              opp: targetOpp,
              isHome: targetIsHome,
              xp: xP1,
              isBlank: isBlankTarget,
              isDgw: Boolean(targetCell?.isDgw),
            },
          ];

    const fixtures3 = fixtures6.slice(0, 3);
    const avgXp3 =
      fixtures3.length > 0
        ? Number((fixtures3.reduce((s, f) => s + f.xp, 0) / fixtures3.length).toFixed(1))
        : xP1;

    const position = (proj?.position || p.position || 'MID') as PositionType;
    const causalProven = getFplProvenStatus(
      {
        id: p.id,
        webName: proj?.webName || p.webName || p.web_name || 'Player',
        position,
        nowCost: cost * 10,
        status,
        minutes: sumMins,
        starts,
        pointsPerGame: ppg,
        doubleDigitHauls: hauls,
        gwHistory: causalHistory,
      },
      { minGw: minFormingGW, maxGw: maxFormingGW, strictCausal: true }
    );

    const modelInput: ScoutModelPlayerInput = {
      id: p.id,
      position,
      teamShort: cShort,
      cost,
      status,
      chanceOfPlaying,
      deadBall,
      fullSeasonPointsMap,
    };

    const captainScore = scoreCaptainAtGw(modelInput, targetNextGW, targetNextGW, policy);
    const diffScore = scoreDifferentialAtGw(modelInput, targetNextGW, targetNextGW, policy);

    return {
      id: p.id,
      webName: proj?.webName || p.webName || p.web_name || 'Player',
      fullName: proj?.fullName || p.fullName || p.full_name || p.webName || 'Player',
      position,
      teamShort: cShort,
      clubName: resolveClubName(cShort, clubNameMap),
      cost,
      form,
      ppg,
      xG,
      xA,
      xGI,
      threat,
      creativity,
      influence,
      bps,
      bonus,
      starts,
      yellowCards,
      cleanSheets,
      goalsConceded,
      deadBall,
      hauls,
      maxGwPoints,
      gwHistory: causalHistory,
      pts,
      goals,
      assists,
      mins,
      status,
      chanceOfPlaying,
      news,
      fnbOwn,
      photo: proj?.photo || p.photo || '',
      isBlankTarget,
      xP1,
      avgXp3,
      avgXp6,
      totalXp6,
      fixtures1,
      fixtures6,
      fullSeasonPointsMap,
      captainScore,
      diffScore,
      proven: causalProven,
      modelInput,
    };
  });

  const playerPoolById = new Map(playerPool.map((p) => [p.id, p]));

  return {
    epochKey: corePayload.epochKey,
    baseHistoricalGW,
    minFormingGW,
    maxFormingGW,
    targetNextGW,
    effectiveStandingsGW,
    effectiveOwnershipGW,
    clubNameMap,
    targetGwMatchProjections,
    playerPool,
    playerPoolById,
    policy,
  };
}

export function hydrateSolvedSquadWithCards(
  raw: SolvedScoutSquadResult,
  playerPoolById: Map<number, ServerScoutPoolPlayer>
): SolvedScoutSquadResult {
  const toCard = (id: number): ScoutPlayerCardItem | null => {
    const p = playerPoolById.get(id);
    if (!p) return null;
    return {
      id: p.id,
      webName: p.webName,
      teamShort: p.teamShort,
      position: p.position,
      cost: p.cost,
      xP1: p.xP1,
      avgXp6: p.avgXp6,
      photo: p.photo,
    };
  };

  return {
    ...raw,
    starters: raw.starterIds.map(toCard).filter((x): x is ScoutPlayerCardItem => Boolean(x)),
    bench: raw.benchIds.map(toCard).filter((x): x is ScoutPlayerCardItem => Boolean(x)),
  };
}

export const CAPTAIN_ADAPTIVE_PARAMS = {
  minCandidates: 3,
  maxCandidates: 10,
  minPStart: 0.65,
  minXMin: 55,
  minXp: 5.0,
  maxXpGapFromTop1: 2.0,
  minScoreRatioToTop1: 0.78,
  minHaulProb: 0.10,
  minQ85Ceiling: 9.5,
} as const;

export function computeServerCaptainAndDifferentialPicks(
  ctx: ServerScoutRuntimeContext,
  excludedPicksPlayerIds?: Iterable<number>
): Pick<ServerScoutSquadsPayload, 'captainPicks' | 'differentialPicks' | 'differentialPicksAll'> {
  const { playerPool, targetNextGW, targetGwMatchProjections, clubNameMap, policy } = ctx;

  // 1. Adaptive Captain Candidates (3..10 slots controlled by strict gate, ceiling, and relative dropoff from #1)
  const capSort = (a: ServerScoutPoolPlayer, b: ServerScoutPoolPlayer) =>
    b.captainScore - a.captainScore || b.xP1 - a.xP1 || a.id - b.id;

  const strictCapCandidates = playerPool
    .filter((p) => {
      const cell = p.modelInput.fullSeasonPointsMap?.[targetNextGW];
      if (!cell || cell.isBlank) return false;
      if (
        !isScoutPlayerEligibleAtGw({
          player: p.modelInput,
          gw: targetNextGW,
          targetNextGW,
          minPStart: Math.max(policy.captain.minPStart, CAPTAIN_ADAPTIVE_PARAMS.minPStart),
          minXMin: CAPTAIN_ADAPTIVE_PARAMS.minXMin,
        })
      ) {
        return false;
      }
      if (p.xP1 < CAPTAIN_ADAPTIVE_PARAMS.minXp) return false;
      const haulProb = cell.mcPHaul10 ?? 0;
      const q85 = cell.mcQ85 ?? p.xP1;
      return (
        haulProb >= CAPTAIN_ADAPTIVE_PARAMS.minHaulProb ||
        q85 >= CAPTAIN_ADAPTIVE_PARAMS.minQ85Ceiling
      );
    })
    .sort(capSort);

  // Relaxed fallback pool only used if strict pool cannot satisfy CAPTAIN_ADAPTIVE_PARAMS.minCandidates (e.g. heavy BGW)
  const relaxedCapPool = (() => {
    const standardEligible = playerPool
      .filter((p) =>
        isScoutPlayerEligibleAtGw({
          player: p.modelInput,
          gw: targetNextGW,
          targetNextGW,
          minPStart: policy.captain.minPStart,
          minXMin: 25,
        })
      )
      .sort(capSort);
    if (standardEligible.length >= CAPTAIN_ADAPTIVE_PARAMS.minCandidates) {
      return standardEligible;
    }
    return playerPool
      .filter((p) => p.status !== 'i' && p.status !== 's' && p.status !== 'u' && p.xP1 > 0)
      .sort(capSort);
  })();

  const orderedBaseCap: ServerScoutPoolPlayer[] = [...strictCapCandidates];
  if (orderedBaseCap.length < CAPTAIN_ADAPTIVE_PARAMS.minCandidates) {
    const seenIds = new Set(orderedBaseCap.map((p) => p.id));
    for (const p of relaxedCapPool) {
      if (!seenIds.has(p.id)) {
        orderedBaseCap.push(p);
        seenIds.add(p.id);
      }
      if (orderedBaseCap.length >= CAPTAIN_ADAPTIVE_PARAMS.minCandidates) break;
    }
  }

  let selectedCapCandidates: ServerScoutPoolPlayer[] = [];
  let capRatingFloorScore: number | undefined;
  if (orderedBaseCap.length > 0) {
    const top1 = orderedBaseCap[0];
    const minXpCutoff = top1.xP1 - CAPTAIN_ADAPTIVE_PARAMS.maxXpGapFromTop1;
    const minScoreCutoff = top1.captainScore * CAPTAIN_ADAPTIVE_PARAMS.minScoreRatioToTop1;
    capRatingFloorScore = minScoreCutoff;

    const dynamicFiltered = strictCapCandidates.filter(
      (p) => p.xP1 >= minXpCutoff && p.captainScore >= minScoreCutoff
    );
    if (dynamicFiltered.length >= CAPTAIN_ADAPTIVE_PARAMS.minCandidates) {
      selectedCapCandidates = dynamicFiltered.slice(0, CAPTAIN_ADAPTIVE_PARAMS.maxCandidates);
    } else {
      selectedCapCandidates = orderedBaseCap.slice(0, CAPTAIN_ADAPTIVE_PARAMS.minCandidates);
    }
  }

  const toRenderedPick = (
    item: ServerScoutPoolPlayer & { rank: number; rating: number; narrative: string }
  ): ScoutArticlePickRenderedItem => ({
    id: item.id,
    webName: item.webName,
    teamShort: item.teamShort,
    clubName: item.clubName || resolveClubName(item.teamShort, clubNameMap),
    position: item.position,
    cost: item.cost,
    fnbOwn: item.fnbOwn,
    rank: item.rank,
    rating: item.rating,
    narrative: item.narrative,
  });

  const capId = generateCaptainArticlePicks(
    selectedCapCandidates,
    targetGwMatchProjections,
    targetNextGW,
    true,
    playerPool,
    clubNameMap,
    capRatingFloorScore
  ).map((x) => toRenderedPick(x as any));
  const capEn = generateCaptainArticlePicks(
    selectedCapCandidates,
    targetGwMatchProjections,
    targetNextGW,
    false,
    playerPool,
    clubNameMap,
    capRatingFloorScore
  ).map((x) => toRenderedPick(x as any));

  // 2. Differential Top 3 (both Exclude Picks & Captain default + All <5% mode)
  const maxOwn = policy.differential.maxFnbOwn;
  const selectTop3Diff = (excludedIds?: Set<number>): ServerScoutPoolPlayer[] => {
    const isAllowed = (p: ServerScoutPoolPlayer) => !excludedIds || !excludedIds.has(p.id);
    const nonBlank = playerPool.filter(
      (p) =>
        isAllowed(p) &&
        p.fnbOwn < maxOwn &&
        isScoutPlayerEligibleAtGw({
          player: p.modelInput,
          gw: targetNextGW,
          targetNextGW,
          minPStart: policy.differential.minPStart,
          minXMin: 25,
        })
    );
    const list =
      nonBlank.length >= 3
        ? [...nonBlank]
        : playerPool.filter(
            (p) =>
              isAllowed(p) &&
              p.fnbOwn < maxOwn &&
              p.status !== 'i' &&
              p.status !== 's' &&
              p.status !== 'u' &&
              p.xP1 > 0
          );
    list.sort((a, b) => b.diffScore - a.diffScore || b.xP1 - a.xP1 || a.id - b.id);
    return list.slice(0, 3);
  };

  const excludedDiffIds = new Set<number>([
    ...(excludedPicksPlayerIds || []),
    ...selectedCapCandidates.map((c) => c.id),
  ]);

  const top3DiffAll = selectTop3Diff();
  let top3DiffExcluded = selectTop3Diff(excludedDiffIds);
  if (top3DiffExcluded.length < 3) {
    const seen = new Set(top3DiffExcluded.map((p) => p.id));
    for (const p of top3DiffAll) {
      if (!seen.has(p.id)) {
        top3DiffExcluded.push(p);
        seen.add(p.id);
      }
      if (top3DiffExcluded.length >= 3) break;
    }
  }

  const diffId = generateDifferentialArticlePicks(
    top3DiffExcluded,
    targetGwMatchProjections,
    targetNextGW,
    true,
    playerPool,
    clubNameMap
  ).map((x) => toRenderedPick(x as any));
  const diffEn = generateDifferentialArticlePicks(
    top3DiffExcluded,
    targetGwMatchProjections,
    targetNextGW,
    false,
    playerPool,
    clubNameMap
  ).map((x) => toRenderedPick(x as any));

  const diffAllId = generateDifferentialArticlePicks(
    top3DiffAll,
    targetGwMatchProjections,
    targetNextGW,
    true,
    playerPool,
    clubNameMap
  ).map((x) => toRenderedPick(x as any));
  const diffAllEn = generateDifferentialArticlePicks(
    top3DiffAll,
    targetGwMatchProjections,
    targetNextGW,
    false,
    playerPool,
    clubNameMap
  ).map((x) => toRenderedPick(x as any));

  return {
    captainPicks: { id: capId, en: capEn },
    differentialPicks: { id: diffId, en: diffEn },
    differentialPicksAll: { id: diffAllId, en: diffAllEn },
  };
}

export function resolveManagerAndSquadForScout(
  cachedData: TransformedLeagueData,
  ctx: ServerScoutRuntimeContext,
  requestedEntryId?: number
): {
  activeManager: StandingsRow | null;
  activeSquadIds: number[];
} {
  const standingsList = cachedData.standings?.[ctx.effectiveStandingsGW] || [];
  if (standingsList.length === 0) {
    return { activeManager: null, activeSquadIds: [] };
  }

  let activeManager: StandingsRow | null = null;
  if (requestedEntryId && Number.isInteger(requestedEntryId) && requestedEntryId > 0) {
    activeManager = standingsList.find((m) => m.entry_id === requestedEntryId) || null;
  }
  if (!activeManager) {
    activeManager = standingsList[0] || null;
  }
  if (!activeManager) {
    return { activeManager: null, activeSquadIds: [] };
  }

  const ownershipList = cachedData.ownership_players?.[ctx.effectiveOwnershipGW] || [];
  const matched: Array<{ id: number; posInSquad: number }> = [];
  for (const p of ownershipList) {
    if (!Array.isArray(p.owners)) continue;
    const owner = p.owners.find((o) => o.entry_id === activeManager!.entry_id);
    if (owner) {
      matched.push({ id: p.id, posInSquad: owner.position_in_squad });
    }
  }
  matched.sort((a, b) => a.posInSquad - b.posInSquad);

  return {
    activeManager,
    activeSquadIds: matched.map((m) => m.id),
  };
}

export function computeDbEstimatedFtAllowance(
  cachedData: TransformedLeagueData,
  entryId: number,
  baseHistoricalGW: number,
  targetNextGW?: number
): number {
  if (!entryId) return 1;
  const maxPreTarget = targetNextGW !== undefined ? Math.max(0, targetNextGW - 1) : baseHistoricalGW;
  const upToGw = Math.min(Math.max(baseHistoricalGW, 1), maxPreTarget);
  if (upToGw < 2) return 1;

  const chipRow = cachedData.all_chips_used?.find((c) => c.entry_id === entryId);
  const preserveFtGws = new Set<number>();
  if (chipRow) {
    if (chipRow.wc1?.gw && chipRow.wc1.gw <= upToGw) preserveFtGws.add(chipRow.wc1.gw);
    if (chipRow.wc2?.gw && chipRow.wc2.gw <= upToGw) preserveFtGws.add(chipRow.wc2.gw);
    if (chipRow.fh1?.gw && chipRow.fh1.gw <= upToGw) preserveFtGws.add(chipRow.fh1.gw);
    if (chipRow.fh2?.gw && chipRow.fh2.gw <= upToGw) preserveFtGws.add(chipRow.fh2.gw);
  }

  const transferCountByGw = new Map<number, number>();
  for (const tr of cachedData.all_transfers || []) {
    if (tr.entry_id === entryId && tr.event <= upToGw) {
      transferCountByGw.set(tr.event, (transferCountByGw.get(tr.event) || 0) + 1);
    }
  }

  let ft = 1;
  for (let gw = 2; gw <= upToGw; gw++) {
    const standingRow = cachedData.standings?.[gw]?.find((r) => r.entry_id === entryId);
    const chipName = (standingRow?.active_chip || '').toLowerCase();
    if (preserveFtGws.has(gw) || chipName.includes('wildcard') || chipName.includes('free')) {
      ft = Math.max(1, Math.min(5, ft));
      continue;
    }
    const made = transferCountByGw.get(gw) || 0;
    const hitCost = Number(standingRow?.event_transfers_cost || 0);
    const hits = Math.round(hitCost / 4);
    const freeUsed = Math.max(0, made - hits);
    const effectiveBefore = Math.max(ft, freeUsed);
    const remaining = Math.max(0, effectiveBefore - freeUsed);
    ft = Math.min(5, remaining + 1);
  }
  return ft;
}

export async function fetchServerManagerFinances(params: {
  cachedData: TransformedLeagueData;
  entryId: number;
  baseHistoricalGW: number;
  targetNextGW?: number;
  force?: boolean;
}): Promise<{ bankBalance: number; ftAllowance: number; transfers: any[]; chips: any[] }> {
  const { cachedData, entryId, baseHistoricalGW, targetNextGW, force = false } = params;
  const dbFt = computeDbEstimatedFtAllowance(cachedData, entryId, baseHistoricalGW, targetNextGW);

  if (!Number.isInteger(entryId) || entryId <= 0 || entryId >= 100_000_000) {
    return { bankBalance: 0, ftAllowance: dbFt, transfers: [], chips: [] };
  }

  const now = Date.now();
  let detail = managerFinanceCache.get(entryId);
  if (force || !detail || now - detail.timestamp >= MANAGER_FINANCE_TTL_MS) {
    const fetchJsonWithTimeout = async (url: string): Promise<any | null> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      try {
        const res = await fetch(url, { headers: FPL_HEADERS, signal: controller.signal });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const [entryRes, historyRes, transfersRes] = await Promise.all([
      fetchJsonWithTimeout(`https://fantasy.premierleague.com/api/entry/${entryId}/`),
      fetchJsonWithTimeout(`https://fantasy.premierleague.com/api/entry/${entryId}/history/`),
      fetchJsonWithTimeout(`https://fantasy.premierleague.com/api/entry/${entryId}/transfers/`),
    ]);

    if (entryRes || historyRes || transfersRes) {
      const bankRaw = entryRes?.last_deadline_bank != null ? entryRes.last_deadline_bank / 10 : 0;
      detail = {
        timestamp: now,
        bank: Math.max(0, round1(Number(bankRaw || 0))),
        history: Array.isArray(historyRes?.current) ? historyRes.current : [],
        chips: Array.isArray(historyRes?.chips) ? historyRes.chips : [],
        transfers: Array.isArray(transfersRes) ? transfersRes : [],
        entryName: entryRes?.name || undefined,
      };
      if (managerFinanceCache.size >= MANAGER_FINANCE_CACHE_MAX) {
        const firstKey = managerFinanceCache.keys().next().value;
        if (firstKey !== undefined) managerFinanceCache.delete(firstKey);
      }
      managerFinanceCache.set(entryId, detail);
    }
  }

  if (!detail) {
    return { bankBalance: 0, ftAllowance: dbFt, transfers: [], chips: [] };
  }

  const history = [...detail.history].sort((a: any, b: any) => Number(a.event || 0) - Number(b.event || 0));
  if (history.length === 0) {
    return { bankBalance: detail.bank, ftAllowance: dbFt, transfers: detail.transfers, chips: detail.chips };
  }

  const maxPreTarget = targetNextGW !== undefined ? Math.max(0, targetNextGW - 1) : baseHistoricalGW;
  const upToGw = Math.min(Math.max(baseHistoricalGW, 1), maxPreTarget);

  const preserveFtGws = new Set<number>(
    detail.chips
      .filter((c: any) => {
        const nm = String(c.name || '').toLowerCase();
        const ev = Number(c.event || 0);
        return ev > 0 && ev <= upToGw && (nm.includes('wildcard') || nm === 'wc' || nm.includes('freehit') || nm === 'fh');
      })
      .map((c: any) => Number(c.event))
  );

  let ft = 1;
  for (const h of history) {
    const gw = Number(h.event || 0);
    if (gw < 2 || gw > upToGw) continue;
    if (preserveFtGws.has(gw)) {
      ft = Math.max(1, Math.min(5, ft));
      continue;
    }
    const made = Number(h.event_transfers || 0);
    const hits = Math.round(Number(h.event_transfers_cost || 0) / 4);
    const freeUsed = Math.max(0, made - hits);
    const effectiveBefore = Math.max(ft, freeUsed);
    const remaining = Math.max(0, effectiveBefore - freeUsed);
    ft = Math.min(5, remaining + 1);
  }

  return {
    bankBalance: detail.bank,
    ftAllowance: ft,
    transfers: detail.transfers,
    chips: detail.chips,
  };
}

export async function resolveManagerSellingPrices(params: {
  cachedData: TransformedLeagueData;
  entryId: number;
  activeSquadIds: number[];
  upToGw: number;
  playerPoolById: Map<number, ServerScoutPoolPlayer>;
  transfersFromApi?: any[];
  chipsFromApi?: any[];
}): Promise<Map<number, number>> {
  const {
    cachedData,
    entryId,
    activeSquadIds,
    upToGw,
    playerPoolById,
    transfersFromApi,
    chipsFromApi,
  } = params;
  const sellingPriceById = new Map<number, number>();
  if (!entryId || entryId <= 0 || activeSquadIds.length === 0) return sellingPriceById;

  const wcGwsSet = new Set<number>();
  const fhGwsSet = new Set<number>();

  for (const c of chipsFromApi || []) {
    const ev = Number(c?.event || 0);
    const nm = String(c?.name || '').toLowerCase();
    if (ev >= 1 && ev <= upToGw) {
      if (nm.includes('wildcard') || nm === 'wc') wcGwsSet.add(ev);
      if (nm.includes('freehit') || nm === 'fh') fhGwsSet.add(ev);
    }
  }
  const chipRow = cachedData.all_chips_used?.find((c) => c.entry_id === entryId);
  if (chipRow) {
    if (chipRow.wc1?.gw && chipRow.wc1.gw <= upToGw) wcGwsSet.add(chipRow.wc1.gw);
    if (chipRow.wc2?.gw && chipRow.wc2.gw <= upToGw) wcGwsSet.add(chipRow.wc2.gw);
    if (chipRow.fh1?.gw && chipRow.fh1.gw <= upToGw) fhGwsSet.add(chipRow.fh1.gw);
    if (chipRow.fh2?.gw && chipRow.fh2.gw <= upToGw) fhGwsSet.add(chipRow.fh2.gw);
  }
  for (let g = 1; g <= upToGw; g++) {
    const st = cachedData.standings?.[g]?.find((r) => r.entry_id === entryId);
    const chipNm = String(st?.active_chip || '').toLowerCase();
    if (chipNm.includes('wildcard') || chipNm === 'wc') wcGwsSet.add(g);
    if (chipNm.includes('free') || chipNm === 'fh') fhGwsSet.add(g);
  }

  const wcGwsAsc = Array.from(wcGwsSet).sort((a, b) => a - b);
  const wcGwsDesc = [...wcGwsAsc].reverse();

  // Build per-GW squad sets for this manager from ownership_players
  const gwSquadSetMap = new Map<number, Set<number>>();
  let earliestOwnedGw = upToGw;
  for (let g = 1; g <= upToGw; g++) {
    const list = cachedData.ownership_players?.[g];
    if (!Array.isArray(list) || list.length === 0) continue;
    const set = new Set<number>();
    for (const p of list) {
      if (Array.isArray(p.owners) && p.owners.some((o) => o.entry_id === entryId)) {
        set.add(p.id);
      }
    }
    if (set.size > 0) {
      gwSquadSetMap.set(g, set);
      if (g < earliestOwnedGw) earliestOwnedGw = g;
    }
  }

  type NormTransfer = {
    event: number;
    timeMs: number;
    inId: number;
    inCostTenths: number;
    outId: number;
  };
  const rawTransfers: NormTransfer[] = [];
  if (Array.isArray(transfersFromApi) && transfersFromApi.length > 0) {
    for (const t of transfersFromApi) {
      const ev = Number(t?.event || 0);
      if (ev < 1 || ev > upToGw) continue;
      rawTransfers.push({
        event: ev,
        timeMs: Date.parse(String(t?.time || '')) || 0,
        inId: Number(t?.element_in || 0),
        inCostTenths: Number(t?.element_in_cost || 0),
        outId: Number(t?.element_out || 0),
      });
    }
  } else {
    for (const t of cachedData.all_transfers || []) {
      if (t.entry_id !== entryId || t.event < 1 || t.event > upToGw) continue;
      rawTransfers.push({
        event: Number(t.event),
        timeMs: Date.parse(String(t.time || '')) || 0,
        inId: Number(t.element_in?.id || 0),
        inCostTenths: Number(t.element_in?.cost || 0),
        outId: Number(t.element_out?.id || 0),
      });
    }
  }
  rawTransfers.sort((a, b) => a.event - b.event || a.timeMs - b.timeMs);

  const purchaseCostTenthsById = new Map<number, number>();
  const neededAcquiredGwById = new Map<number, number>();

  for (const playerId of activeSquadIds) {
    let lastIn: NormTransfer | null = null;
    let lastOut: NormTransfer | null = null;
    for (const tr of rawTransfers) {
      if (tr.inId === playerId) lastIn = tr;
      if (tr.outId === playerId) lastOut = tr;
    }

    let stayedSinceLastIn =
      Boolean(lastIn) &&
      lastIn!.inCostTenths > 0 &&
      (!lastOut ||
        lastOut.event < lastIn!.event ||
        (lastOut.event === lastIn!.event && lastOut.timeMs < lastIn!.timeMs));

    if (stayedSinceLastIn && lastIn) {
      for (const wcGw of wcGwsAsc) {
        if (wcGw > lastIn.event && gwSquadSetMap.has(wcGw) && !gwSquadSetMap.get(wcGw)!.has(playerId)) {
          stayedSinceLastIn = false;
          break;
        }
      }
    }

    if (stayedSinceLastIn && lastIn) {
      purchaseCostTenthsById.set(playerId, lastIn.inCostTenths);
      continue;
    }

    let acquiredGw = earliestOwnedGw;
    for (const wcGw of wcGwsDesc) {
      const wcSet = gwSquadSetMap.get(wcGw);
      if (!wcSet || !wcSet.has(playerId)) continue;
      let prevGw: number | undefined;
      for (let g = wcGw - 1; g >= 1; g--) {
        if (!fhGwsSet.has(g) && gwSquadSetMap.has(g)) {
          prevGw = g;
          break;
        }
      }
      if (prevGw === undefined || !gwSquadSetMap.get(prevGw)!.has(playerId)) {
        acquiredGw = wcGw;
        break;
      }
    }

    if (fhGwsSet.has(upToGw)) {
      let prevGw: number | undefined;
      for (let g = upToGw - 1; g >= 1; g--) {
        if (!fhGwsSet.has(g) && gwSquadSetMap.has(g)) {
          prevGw = g;
          break;
        }
      }
      if (prevGw !== undefined && !gwSquadSetMap.get(prevGw)!.has(playerId)) {
        acquiredGw = upToGw;
      }
    }

    neededAcquiredGwById.set(playerId, acquiredGw);
  }

  const fetchJsonQuick = async (url: string): Promise<any | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { headers: FPL_HEADERS, signal: controller.signal });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const now = Date.now();
  const needsStartPrices = Array.from(neededAcquiredGwById.values()).some((gw) => gw <= 1);
  if (
    needsStartPrices &&
    (!bootstrapStartPriceCache || now - bootstrapStartPriceCache.timestamp >= HISTORICAL_PRICE_TTL_MS)
  ) {
    const boot = await fetchJsonQuick('https://fantasy.premierleague.com/api/bootstrap-static/');
    if (Array.isArray(boot?.elements)) {
      const startMap = new Map<number, number>();
      for (const el of boot.elements) {
        const id = Number(el?.id || 0);
        const nowC = Number(el?.now_cost || 0);
        const delta = Number(el?.cost_change_start || 0);
        if (id > 0 && nowC > 0) {
          startMap.set(id, Math.max(35, nowC - delta));
        }
      }
      bootstrapStartPriceCache = { timestamp: now, startCostTenthsById: startMap };
    }
  }

  const playersNeedingElementSummary: number[] = [];
  for (const [playerId, acqGw] of neededAcquiredGwById.entries()) {
    if (acqGw <= 1) {
      const startCost = bootstrapStartPriceCache?.startCostTenthsById.get(playerId);
      if (startCost && startCost > 0) {
        purchaseCostTenthsById.set(playerId, startCost);
        continue;
      }
    }
    const cachedEl = elementRoundPriceCache.get(playerId);
    if (!cachedEl || now - cachedEl.timestamp >= HISTORICAL_PRICE_TTL_MS) {
      playersNeedingElementSummary.push(playerId);
    }
  }

  if (playersNeedingElementSummary.length > 0) {
    await Promise.all(
      playersNeedingElementSummary.map(async (playerId) => {
        const summary = await fetchJsonQuick(
          `https://fantasy.premierleague.com/api/element-summary/${playerId}/`
        );
        const roundMap = new Map<number, number>();
        if (Array.isArray(summary?.history)) {
          for (const h of summary.history) {
            const r = Number(h?.round || 0);
            const v = Number(h?.value || 0);
            if (r > 0 && v > 0) roundMap.set(r, v);
          }
        }
        elementRoundPriceCache.set(playerId, { timestamp: now, roundValueTenths: roundMap });
      })
    );
  }

  for (const [playerId, acqGw] of neededAcquiredGwById.entries()) {
    if (purchaseCostTenthsById.has(playerId)) continue;
    const roundMap = elementRoundPriceCache.get(playerId)?.roundValueTenths;
    if (roundMap && roundMap.size > 0) {
      let matched = roundMap.get(acqGw);
      if (!matched) {
        // Fallback for Blank GW or late arrival: nearest prior GW, then earliest subsequent GW
        let bestLower = -1;
        let bestHigher = Infinity;
        for (const r of roundMap.keys()) {
          if (r < acqGw && r > bestLower) bestLower = r;
          if (r > acqGw && r < bestHigher) bestHigher = r;
        }
        if (bestLower > 0) matched = roundMap.get(bestLower);
        else if (bestHigher < Infinity) matched = roundMap.get(bestHigher);
      }
      if (matched && matched > 0) {
        purchaseCostTenthsById.set(playerId, matched);
      }
    }
  }

  for (const playerId of activeSquadIds) {
    const poolP = playerPoolById.get(playerId);
    if (!poolP) continue;
    const nowCostTenths = Math.round(poolP.cost * 10);
    const purchaseTenths = purchaseCostTenthsById.get(playerId) ?? nowCostTenths;
    const sellingTenths =
      nowCostTenths <= purchaseTenths
        ? nowCostTenths
        : purchaseTenths + Math.floor((nowCostTenths - purchaseTenths) / 2);
    sellingPriceById.set(playerId, round1(sellingTenths / 10));
  }

  return sellingPriceById;
}

function getPoolPlayerGwXp(p: ServerScoutPoolPlayer, gw: number, targetNextGW: number): number {
  if (gw === targetNextGW) {
    if (p.status === 'i' || p.status === 's' || p.status === 'u') return 0;
    return p.xP1;
  }
  const cell = p.fullSeasonPointsMap?.[gw];
  if (cell && typeof cell.xp === 'number') {
    return Math.round(cell.xp * 10) / 10;
  }
  return p.xP1;
}

const FORMATIONS: Array<[number, number, number]> = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 3, 2],
  [5, 4, 1],
  [5, 2, 3],
];

export function computeServerChipsAnalysis(params: {
  cachedData: TransformedLeagueData;
  ctx: ServerScoutRuntimeContext;
  scoutPayload: ServerScoutSquadsPayload;
  activeManager: StandingsRow | null;
  activeSquadIds: number[];
  ftAllowance: number;
  lang: 'id' | 'en';
}): ServerScoutChipsAnalysis {
  const { cachedData, ctx, scoutPayload, activeManager, activeSquadIds, ftAllowance, lang } = params;
  const isId = lang !== 'en';
  const { targetNextGW, effectiveStandingsGW, playerPoolById, policy } = ctx;

  const isSecondHalf = targetNextGW >= 20;
  const halfStartGW = isSecondHalf ? 20 : 1;
  const halfEndGW = isSecondHalf ? 38 : 19;

  const chipRow = activeManager
    ? cachedData.all_chips_used?.find((c) => c.entry_id === activeManager.entry_id)
    : undefined;

  const resolveFallbackActiveChip = (
    chipKeyword: string,
    currentUsed: { gw: number; points: number } | null | undefined
  ) => {
    if (currentUsed && currentUsed.gw <= targetNextGW) {
      return currentUsed.gw < targetNextGW ? currentUsed : { gw: currentUsed.gw, points: 0 };
    }
    if (!activeManager || effectiveStandingsGW > targetNextGW) return null;
    const standingInHalf = isSecondHalf ? effectiveStandingsGW >= 20 : effectiveStandingsGW < 20;
    const activeChipName = (activeManager.active_chip || '').toLowerCase();
    if (standingInHalf && activeChipName.includes(chipKeyword)) {
      return {
        gw: effectiveStandingsGW,
        points: effectiveStandingsGW < targetNextGW ? activeManager.event_points || 0 : 0,
      };
    }
    return null;
  };

  const wcUsed = resolveFallbackActiveChip('wildcard', isSecondHalf ? chipRow?.wc2 : chipRow?.wc1);
  const tcUsed = resolveFallbackActiveChip('3xc', isSecondHalf ? chipRow?.tc2 : chipRow?.tc1);
  const bbUsed = resolveFallbackActiveChip('bboost', isSecondHalf ? chipRow?.bb2 : chipRow?.bb1);
  const fhUsed = resolveFallbackActiveChip('freehit', isSecondHalf ? chipRow?.fh2 : chipRow?.fh1);

  const chipSet: ScoutChipStatusItem[] = [
    { key: 'WC', name: 'Wildcard', short: isSecondHalf ? 'WC2' : 'WC1', used: wcUsed },
    { key: 'TC', name: 'Triple Captain', short: isSecondHalf ? 'TC2' : 'TC1', used: tcUsed },
    { key: 'BB', name: 'Bench Boost', short: isSecondHalf ? 'BB2' : 'BB1', used: bbUsed },
    { key: 'FH', name: 'Free Hit', short: isSecondHalf ? 'FH2' : 'FH1', used: fhUsed },
  ];

  const managerSquad15 = activeSquadIds
    .map((id) => playerPoolById.get(id))
    .filter((p): p is ServerScoutPoolPlayer => Boolean(p));

  if (!activeManager || managerSquad15.length === 0 || ctx.playerPool.length === 0) {
    return {
      needChip: false,
      chipName: null,
      gain: 0,
      reason: '',
      chipSet,
      isSecondHalf,
      halfStartGW,
      halfEndGW,
      currentFT: ftAllowance,
      openingNarrative: '',
      chipParagraphs: [],
      allUsed: false,
    };
  }

  const availableChips = chipSet.filter((c) => !c.used);
  if (availableChips.length === 0) {
    return {
      needChip: false,
      chipName: null,
      gain: 0,
      reason: '',
      chipSet,
      isSecondHalf,
      halfStartGW,
      halfEndGW,
      currentFT: ftAllowance,
      openingNarrative: isId
        ? `Seluruh chip pada ${
            isSecondHalf ? 'paruh kedua musim (GW 20–38)' : 'paruh pertama musim (GW 1–19)'
          } sudah habis terpakai. Fokus penuh pekan ini cukup diarahkan ke penyusunan Starting XI terbaik dan pemanfaatan ${ftAllowance} Free Transfer yang ada.`
        : `All four chips for ${
            isSecondHalf ? 'the second half of the season (GW 20–38)' : 'the first half of the season (GW 1–19)'
          } have already been played. Focus on optimizing your Starting XI and managing your ${ftAllowance} Free Transfers.`,
      chipParagraphs: [],
      allUsed: true,
    };
  }

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const quantileSorted = (sorted: number[], q: number, fallback: number): number => {
    if (sorted.length === 0) return fallback;
    const pos = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : lerp(sorted[lo], sorted[hi], pos - lo);
  };

  const evalXiCache = new Map<string, ReturnType<typeof computeXiAtGw>>();
  function computeXiAtGw(squad15: ServerScoutPoolPlayer[], gw: number) {
    const sortFn = (a: ServerScoutPoolPlayer, b: ServerScoutPoolPlayer) => {
      const xpDiff = getPoolPlayerGwXp(b, gw, targetNextGW) - getPoolPlayerGwXp(a, gw, targetNextGW);
      if (xpDiff !== 0) return xpDiff;
      const capDiff =
        scoreCaptainAtGw(b.modelInput, gw, targetNextGW, policy) -
        scoreCaptainAtGw(a.modelInput, gw, targetNextGW, policy);
      if (capDiff !== 0) return capDiff;
      return (
        getCellAtGw(b.modelInput, gw, targetNextGW).pStart -
        getCellAtGw(a.modelInput, gw, targetNextGW).pStart
      );
    };

    const gkps = squad15.filter((p) => p.position === 'GKP').sort(sortFn);
    const defs = squad15.filter((p) => p.position === 'DEF').sort(sortFn);
    const mids = squad15.filter((p) => p.position === 'MID').sort(sortFn);
    const fwds = squad15.filter((p) => p.position === 'FWD').sort(sortFn);

    let bestStarters: ServerScoutPoolPlayer[] = [];
    let bestBench: ServerScoutPoolPlayer[] = [];
    let bestXiXp = -1;
    let bestMaxStarterXp = -1;
    let bestBenchXp = -1;

    for (const [d, m, f] of FORMATIONS) {
      if (gkps.length < 1 || defs.length < d || mids.length < m || fwds.length < f) continue;
      const starters = [gkps[0], ...defs.slice(0, d), ...mids.slice(0, m), ...fwds.slice(0, f)];
      const starterIds = new Set(starters.map((p) => p.id));
      const bench = squad15.filter((p) => !starterIds.has(p.id));
      const xiXp = starters.reduce((s, p) => s + getPoolPlayerGwXp(p, gw, targetNextGW), 0);
      const maxStarterXp = starters.reduce(
        (mx, p) => Math.max(mx, getPoolPlayerGwXp(p, gw, targetNextGW)),
        0
      );
      const benchXp = bench.reduce((s, p) => s + getPoolPlayerGwXp(p, gw, targetNextGW), 0);

      if (
        xiXp > bestXiXp + 1e-6 ||
        (Math.abs(xiXp - bestXiXp) <= 1e-6 &&
          (maxStarterXp > bestMaxStarterXp + 1e-6 ||
            (Math.abs(maxStarterXp - bestMaxStarterXp) <= 1e-6 && benchXp > bestBenchXp)))
      ) {
        bestStarters = starters;
        bestBench = bench;
        bestXiXp = xiXp;
        bestMaxStarterXp = maxStarterXp;
        bestBenchXp = benchXp;
      }
    }

    if (bestStarters.length === 0) {
      const sortedAll = [...squad15].sort(sortFn);
      bestStarters = sortedAll.slice(0, 11);
      bestBench = sortedAll.slice(11);
      bestXiXp = bestStarters.reduce((s, p) => s + getPoolPlayerGwXp(p, gw, targetNextGW), 0);
      bestBenchXp = bestBench.reduce((s, p) => s + getPoolPlayerGwXp(p, gw, targetNextGW), 0);
    }

    const bestStarter = [...bestStarters].sort(sortFn)[0] || null;
    const capXp = bestStarter ? getPoolPlayerGwXp(bestStarter, gw, targetNextGW) : 0;

    const getTcScore = (p: ServerScoutPoolPlayer) => {
      const c = getCellAtGw(p.modelInput, gw, targetNextGW);
      return (
        c.xp * (1 - policy.chips.tcReliabilityAlpha + policy.chips.tcReliabilityAlpha * c.pStart) +
        policy.chips.tcTailWeight * Math.max(0, c.mcQ85 - c.xp)
      );
    };
    const tcRanked = [...squad15].sort((a, b) => getTcScore(b) - getTcScore(a) || sortFn(a, b));
    const tcCandidate = tcRanked[0] || bestStarter;
    const tcXp = tcCandidate ? getPoolPlayerGwXp(tcCandidate, gw, targetNextGW) : 0;
    const tcEffScore = tcCandidate ? getTcScore(tcCandidate) : 0;
    const tcCellRaw = tcCandidate?.fullSeasonPointsMap?.[gw];
    const tcIsDgw = Boolean(tcCellRaw?.isDgw || (tcCellRaw?.matchCount ?? 0) >= 2);

    let activeBenchCount = 0;
    let benchIsDgwCount = 0;
    const reliableBenchXp = bestBench.reduce((sum, bp) => {
      const c = getCellAtGw(bp.modelInput, gw, targetNextGW);
      const rawCell = bp.fullSeasonPointsMap?.[gw];
      if (!c.isBlank && (rawCell?.isDgw || (rawCell?.matchCount ?? 0) >= 2)) {
        benchIsDgwCount++;
      }
      if (c.pStart < policy.chips.bbMinPStart || c.isBlank) return sum;
      const xpVal = getPoolPlayerGwXp(bp, gw, targetNextGW);
      if (xpVal > 0) activeBenchCount++;
      const rel = 1 - policy.chips.bbReliabilityAlpha + policy.chips.bbReliabilityAlpha * c.pStart;
      return sum + xpVal * rel;
    }, 0);

    let activeStarterCount = 0;
    for (const st of bestStarters) {
      const c = getCellAtGw(st.modelInput, gw, targetNextGW);
      if (!c.isBlank && c.pStart >= 0.25 && getPoolPlayerGwXp(st, gw, targetNextGW) > 0) {
        activeStarterCount++;
      }
    }

    return {
      starters: bestStarters,
      bench: bestBench,
      xiXp: round1(bestXiXp),
      benchXp: round1(bestBenchXp),
      reliableBenchXp: round1(reliableBenchXp),
      activeBenchCount,
      benchIsDgwCount,
      activeStarterCount,
      bestStarter,
      capXp: round1(capXp),
      xiPlusCap: round1(bestXiXp + capXp),
      tcCandidate,
      tcXp: round1(tcXp),
      tcEffScore: round1(tcEffScore),
      tcIsDgw,
    };
  }

  const getOptimalXiAtGw = (squad15: ServerScoutPoolPlayer[], gw: number, squadKey?: string) => {
    if (!squadKey) return computeXiAtGw(squad15, gw);
    const cacheKey = `${squadKey}:${gw}`;
    let res = evalXiCache.get(cacheKey);
    if (!res) {
      res = computeXiAtGw(squad15, gw);
      evalXiCache.set(cacheKey, res);
    }
    return res;
  };

  const gwRange: number[] = [];
  for (let g = targetNextGW; g <= halfEndGW; g++) gwRange.push(g);

  const maxEvalGw = isSecondHalf ? 38 : Math.min(38, halfEndGW + 5);
  for (let g = targetNextGW; g <= maxEvalGw; g++) {
    getOptimalXiAtGw(managerSquad15, g, 'team');
  }

  // Data-driven league benchmarks across remaining half-season GWs (zero arbitrary hardcoding)
  const activeStarterXps = ctx.playerPool
    .map((p) => {
      const c = getCellAtGw(p.modelInput, targetNextGW, targetNextGW);
      return !c.isBlank && c.pStart >= 0.60 && p.xP1 > 0 ? p.xP1 : -1;
    })
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const medianStarterXp = quantileSorted(activeStarterXps, 0.50, 3.5);

  const leagueTopCapByGw = new Map<number, number>();
  const gwHasDgwMap = new Map<number, boolean>();
  for (const g of gwRange) {
    let topCap = 0;
    let hasDgw = false;
    for (const p of ctx.playerPool) {
      const c = getCellAtGw(p.modelInput, g, targetNextGW);
      if (c.isBlank || c.pStart < 0.55) continue;
      const rawCell = p.fullSeasonPointsMap?.[g];
      if (rawCell?.isDgw || (rawCell?.matchCount ?? 0) >= 2) hasDgw = true;
      const tcS =
        c.xp * (1 - policy.chips.tcReliabilityAlpha + policy.chips.tcReliabilityAlpha * c.pStart) +
        policy.chips.tcTailWeight * Math.max(0, c.mcQ85 - c.xp);
      if (tcS > topCap) topCap = tcS;
    }
    leagueTopCapByGw.set(g, topCap);
    gwHasDgwMap.set(g, hasDgw);
  }
  const sortedTopCaps = Array.from(leagueTopCapByGw.values()).filter((v) => v > 0).sort((a, b) => a - b);
  const typicalCapScore = quantileSorted(sortedTopCaps, 0.50, medianStarterXp * 2);
  const p75CapScore = quantileSorted(sortedTopCaps, 0.75, typicalCapScore * 1.15);

  const waitFraction = (g: number): number => {
    const remAfter = Math.max(0, halfEndGW - g);
    if (remAfter === 0) return 0;
    const span = Math.max(1, Math.min(8, halfEndGW - halfStartGW));
    return Math.min(1, Math.sqrt(remAfter / span));
  };

  const hasFutureDgwAfter = (g: number): { exists: boolean; peakCapScore: number } => {
    let exists = false;
    let peakCapScore = 0;
    for (const k of gwRange) {
      if (k <= g) continue;
      if (gwHasDgwMap.get(k)) {
        exists = true;
        peakCapScore = Math.max(peakCapScore, leagueTopCapByGw.get(k) || 0);
      }
    }
    return { exists, peakCapScore };
  };

  const scoutChipSetSimByGw = new Map<
    number,
    {
      fhSquad15: ServerScoutPoolPlayer[];
      wcSquad15: ServerScoutPoolPlayer[];
      wcBbNextSquad15: ServerScoutPoolPlayer[];
    }
  >();
  for (const [gwKey, val] of Object.entries(scoutPayload.chipSetByGw || {})) {
    const gwNum = Number(gwKey);
    if (isNaN(gwNum)) continue;
    scoutChipSetSimByGw.set(gwNum, {
      fhSquad15: (val.fhSquadIds || [])
        .map((id) => playerPoolById.get(id))
        .filter((p): p is ServerScoutPoolPlayer => Boolean(p)),
      wcSquad15: (val.wcSquadIds || [])
        .map((id) => playerPoolById.get(id))
        .filter((p): p is ServerScoutPoolPlayer => Boolean(p)),
      wcBbNextSquad15: (val.wcBbNextSquadIds || [])
        .map((id) => playerPoolById.get(id))
        .filter((p): p is ServerScoutPoolPlayer => Boolean(p)),
    });
  }

  type ChipKey = 'WC' | 'TC' | 'BB' | 'FH';
  type TcGwInfo = {
    gw: number;
    gain: number;
    scheduleValue: number;
    eligible: boolean;
    playerName: string;
    opp: string;
    isDgw: boolean;
  };
  type BbGwInfo = {
    gw: number;
    gain: number;
    scheduleValue: number;
    eligible: boolean;
    activeBenchCount: number;
    benchDetails: Array<{ name: string; xp: number; opp: string }>;
  };
  type FhGwInfo = {
    gw: number;
    gain: number;
    scheduleValue: number;
    eligible: boolean;
    fhScore: number;
    teamScore: number;
    fhCapName: string;
    teamCapName: string;
    diffNames: string[];
  };
  type WcVariant = 'normal' | 'bb_next';
  type WcGwInfo = {
    gw: number;
    variant: WcVariant;
    gain: number;
    discountedGain: number;
    horizonEnd: number;
    horizonLen: number;
    diffStarters: number;
    heldByFt: boolean;
    eligible: boolean;
    comboEligibleWithBb: boolean;
    keyAdditions: string[];
    squad15: ServerScoutPoolPlayer[];
    squadKey: string;
  };

  const evalTcAtGw = (squad15: ServerScoutPoolPlayer[], squadKey: string, g: number): TcGwInfo => {
    const opt = getOptimalXiAtGw(squad15, g, squadKey);
    const tcCand = opt.tcCandidate;
    const tcOpp = tcCand?.fullSeasonPointsMap?.[g]?.opp || '-';
    const wf = waitFraction(g);
    const futDgw = hasFutureDgwAfter(g);
    const tcMin =
      wf === 0
        ? 0.1
        : Math.max(typicalCapScore * (1 + 0.14 * wf), lerp(0.1, p75CapScore, wf));
    const blockedByFutureDgw =
      !opt.tcIsDgw && futDgw.exists && g < halfEndGW && opt.tcEffScore < futDgw.peakCapScore;
    const eligible = opt.tcXp > 0 && !blockedByFutureDgw && opt.tcEffScore >= tcMin;
    return {
      gw: g,
      gain: opt.tcXp,
      scheduleValue: round1(opt.tcEffScore),
      eligible,
      playerName: tcCand?.webName || '-',
      opp: tcOpp,
      isDgw: opt.tcIsDgw,
    };
  };

  const evalBbAtGw = (squad15: ServerScoutPoolPlayer[], squadKey: string, g: number): BbGwInfo => {
    const opt = getOptimalXiAtGw(squad15, g, squadKey);
    const gain = opt.reliableBenchXp > 0 ? opt.reliableBenchXp : opt.benchXp;
    const wf = waitFraction(g);
    const minActiveBench = wf >= 0.45 ? 3 : wf > 0 ? 2 : 1;
    const bbRef = 4 * medianStarterXp;
    const bbMin = wf === 0 ? 0.1 : lerp(0.1, bbRef * 0.90, wf);
    const eligible =
      gain > 0 &&
      opt.activeBenchCount >= minActiveBench &&
      (opt.benchIsDgwCount >= 2 || gain >= bbMin);
    const benchDetails = [...opt.bench]
      .sort((a, b) => getPoolPlayerGwXp(b, g, targetNextGW) - getPoolPlayerGwXp(a, g, targetNextGW))
      .map((b) => ({
        name: b.webName,
        xp: getPoolPlayerGwXp(b, g, targetNextGW),
        opp: b.fullSeasonPointsMap?.[g]?.opp || '-',
      }));
    return {
      gw: g,
      gain,
      scheduleValue: round1(gain),
      eligible,
      activeBenchCount: opt.activeBenchCount,
      benchDetails,
    };
  };

  const evalFhAtGw = (
    baseSquad15: ServerScoutPoolPlayer[],
    baseKey: string,
    fhSquad15: ServerScoutPoolPlayer[],
    g: number
  ): FhGwInfo => {
    const baseAtG = getOptimalXiAtGw(baseSquad15, g, baseKey);
    const fhAtG = getOptimalXiAtGw(fhSquad15, g, `fh:${g}`);
    const fhGain = round1(fhAtG.xiPlusCap - baseAtG.xiPlusCap);
    const wf = waitFraction(g);
    const isCrisis = baseAtG.activeStarterCount < 11;
    const fhMin =
      wf === 0
        ? 0.1
        : isCrisis
        ? lerp(0.1, 0.55 * medianStarterXp, wf)
        : lerp(0.1, 1.35 * medianStarterXp, wf);
    const baseStarterIds = new Set(baseAtG.starters.map((p) => p.id));
    const diffNames = fhAtG.starters
      .filter((p) => !baseStarterIds.has(p.id))
      .sort((a, b) => getPoolPlayerGwXp(b, g, targetNextGW) - getPoolPlayerGwXp(a, g, targetNextGW))
      .slice(0, 3)
      .map((p) => p.webName);
    return {
      gw: g,
      gain: fhGain,
      scheduleValue: fhGain,
      eligible: fhGain > 0 && fhGain >= fhMin,
      fhScore: fhAtG.xiPlusCap,
      teamScore: baseAtG.xiPlusCap,
      fhCapName: fhAtG.bestStarter?.webName || '-',
      teamCapName: baseAtG.bestStarter?.webName || '-',
      diffNames,
    };
  };

  const evalWcVariantAtGw = (
    wcSquad15: ServerScoutPoolPlayer[],
    squadKey: string,
    variant: WcVariant,
    g: number
  ): WcGwInfo => {
    const teamAtG = getOptimalXiAtGw(managerSquad15, g, 'team');
    const teamStarterIds = new Set(teamAtG.starters.map((p) => p.id));
    const horizonEnd = Math.min(38, g + 5);
    const horizonLen = horizonEnd - g + 1;
    let diffSum = 0;
    let discountedSum = 0;
    for (let k = g; k <= horizonEnd; k++) {
      const wcAtK = getOptimalXiAtGw(wcSquad15, k, squadKey);
      const teamAtK = getOptimalXiAtGw(managerSquad15, k, 'team');
      const delta = wcAtK.xiPlusCap - teamAtK.xiPlusCap;
      diffSum += delta;
      discountedSum += Math.pow(0.88, k - g) * delta;
    }
    const avgGain = round1(diffSum / horizonLen);
    const discountedGain = round1(discountedSum);
    const wcAtG = getOptimalXiAtGw(wcSquad15, g, squadKey);
    const diffStarterPlayers = wcAtG.starters.filter((p) => !teamStarterIds.has(p.id));
    const diffStarters = diffStarterPlayers.length;
    const heldByFt = diffStarters <= ftAllowance;
    const keyAdditions = diffStarterPlayers
      .sort((a, b) => getPoolPlayerGwXp(b, g, targetNextGW) - getPoolPlayerGwXp(a, g, targetNextGW))
      .slice(0, 3)
      .map((p) => p.webName);

    const wf = waitFraction(g);
    const wcMinAvg = wf === 0 ? 0.05 : lerp(0.05, 0.28 * medianStarterXp, wf);
    const wcMinDisc = wf === 0 ? 0.2 : lerp(0.2, 1.15 * medianStarterXp, wf);
    const eligible = !heldByFt && avgGain >= wcMinAvg && discountedGain >= wcMinDisc;
    const comboEligibleWithBb = !heldByFt && avgGain > 0 && discountedGain > 0;

    return {
      gw: g,
      variant,
      gain: avgGain,
      discountedGain,
      horizonEnd,
      horizonLen,
      diffStarters,
      heldByFt,
      eligible,
      comboEligibleWithBb,
      keyAdditions,
      squad15: wcSquad15,
      squadKey,
    };
  };

  const tcPreWcByGw = new Map<number, TcGwInfo>();
  const bbPreWcByGw = new Map<number, BbGwInfo>();
  const fhPreWcByGw = new Map<number, FhGwInfo>();
  const wcNormalByGw = new Map<number, WcGwInfo>();
  const wcBbNextByGw = new Map<number, WcGwInfo>();

  for (const g of gwRange) {
    tcPreWcByGw.set(g, evalTcAtGw(managerSquad15, 'team', g));
    bbPreWcByGw.set(g, evalBbAtGw(managerSquad15, 'team', g));

    const simG = scoutChipSetSimByGw.get(g);
    if (simG && simG.fhSquad15.length > 0) {
      fhPreWcByGw.set(g, evalFhAtGw(managerSquad15, 'team', simG.fhSquad15, g));
    }
    if (simG && simG.wcSquad15.length > 0) {
      wcNormalByGw.set(g, evalWcVariantAtGw(simG.wcSquad15, `wc:${g}`, 'normal', g));
    }
    if (simG && simG.wcBbNextSquad15.length > 0 && g < halfEndGW) {
      wcBbNextByGw.set(g, evalWcVariantAtGw(simG.wcBbNextSquad15, `wcbb:${g}`, 'bb_next', g));
    }
  }

  const availableSet = new Set<ChipKey>(availableChips.map((c) => c.key));
  const hasWcAvail = availableSet.has('WC');
  const hasBbAvail = availableSet.has('BB');
  const hasFhAvail = availableSet.has('FH');
  const hasTcAvail = availableSet.has('TC');

  type ScheduledChipPlacement = {
    key: ChipKey;
    gw: number;
    gain: number;
    scheduleValue: number;
    wcVariant?: WcVariant;
    wcInfo?: WcGwInfo;
    fhInfo?: FhGwInfo;
    bbInfo?: BbGwInfo;
    tcInfo?: TcGwInfo;
  };

  // Build candidate WC options (both normal WC and WC BB-setup paired with BB at w+1)
  const wcCandidates: WcGwInfo[] = [];
  if (hasWcAvail) {
    const normalElig = Array.from(wcNormalByGw.values())
      .filter((v) => v.eligible)
      .sort((a, b) => b.discountedGain - a.discountedGain || a.gw - b.gw);
    const chosenNormal = normalElig.slice(0, 6);
    const targetNorm = wcNormalByGw.get(targetNextGW);
    if (targetNorm?.eligible && !chosenNormal.some((x) => x.gw === targetNextGW)) {
      chosenNormal.push(targetNorm);
    }
    wcCandidates.push(...chosenNormal);

    if (hasBbAvail) {
      const bbComboCands: WcGwInfo[] = [];
      for (const wcBb of wcBbNextByGw.values()) {
        if (!wcBb.comboEligibleWithBb || wcBb.gw + 1 > halfEndGW) continue;
        const bbNext = evalBbAtGw(wcBb.squad15, wcBb.squadKey, wcBb.gw + 1);
        const wf = waitFraction(wcBb.gw);
        const combinedMin =
          wf === 0 ? 0.3 : lerp(0.3, (1.15 + 4 * 0.90) * medianStarterXp, wf);
        if (bbNext.eligible && wcBb.discountedGain + bbNext.scheduleValue >= combinedMin) {
          bbComboCands.push(wcBb);
        }
      }
      bbComboCands.sort((a, b) => {
        const bbA = evalBbAtGw(a.squad15, a.squadKey, a.gw + 1).scheduleValue;
        const bbB = evalBbAtGw(b.squad15, b.squadKey, b.gw + 1).scheduleValue;
        return b.discountedGain + bbB - (a.discountedGain + bbA) || a.gw - b.gw;
      });
      const chosenBbCombo = bbComboCands.slice(0, 5);
      const targetBb = bbComboCands.find((x) => x.gw === targetNextGW);
      if (targetBb && !chosenBbCombo.some((x) => x.gw === targetNextGW)) {
        chosenBbCombo.push(targetBb);
      }
      wcCandidates.push(...chosenBbCombo);
    }
  }

  let bestAssignment = new Map<ChipKey, ScheduledChipPlacement>();
  let bestTotalScheduleValue = -Infinity;
  let bestCountPlaced = -1;
  let bestEarlinessScore = -Infinity;

  const usedGws = new Set<number>();
  const currentAssignment = new Map<ChipKey, ScheduledChipPlacement>();

  const recordIfBest = (sumVal: number, countPlaced: number, earliness: number) => {
    if (
      sumVal > bestTotalScheduleValue + 1e-6 ||
      (Math.abs(sumVal - bestTotalScheduleValue) <= 1e-6 &&
        (countPlaced > bestCountPlaced ||
          (countPlaced === bestCountPlaced && earliness > bestEarlinessScore)))
    ) {
      bestTotalScheduleValue = sumVal;
      bestCountPlaced = countPlaced;
      bestEarlinessScore = earliness;
      bestAssignment = new Map(currentAssignment);
    }
  };

  const searchTc = (
    wcChoice: WcGwInfo | null,
    sumVal: number,
    countPlaced: number,
    earliness: number
  ) => {
    if (!hasTcAvail) {
      recordIfBest(sumVal, countPlaced, earliness);
      return;
    }
    const cands: TcGwInfo[] = [];
    for (const g of gwRange) {
      if (usedGws.has(g)) continue;
      const info =
        wcChoice && g > wcChoice.gw
          ? evalTcAtGw(wcChoice.squad15, wcChoice.squadKey, g)
          : tcPreWcByGw.get(g)!;
      if (info.eligible) cands.push(info);
    }
    cands.sort((a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw);
    const topCands = cands.slice(0, 5);
    const targetCand = cands.find((c) => c.gw === targetNextGW);
    if (targetCand && !topCands.some((c) => c.gw === targetNextGW)) topCands.push(targetCand);

    for (const tc of topCands) {
      usedGws.add(tc.gw);
      currentAssignment.set('TC', {
        key: 'TC',
        gw: tc.gw,
        gain: tc.gain,
        scheduleValue: tc.scheduleValue,
        tcInfo: tc,
      });
      recordIfBest(sumVal + tc.scheduleValue, countPlaced + 1, earliness - tc.gw);
      currentAssignment.delete('TC');
      usedGws.delete(tc.gw);
    }

    // Explicit Hold option when no week passes threshold or saving chip is optimal
    recordIfBest(sumVal, countPlaced, earliness);
  };

  const searchBb = (
    wcChoice: WcGwInfo | null,
    sumVal: number,
    countPlaced: number,
    earliness: number
  ) => {
    if (!hasBbAvail) {
      searchTc(wcChoice, sumVal, countPlaced, earliness);
      return;
    }

    // When testing WC BB-Setup at GW w, BB must pair at w + 1
    if (wcChoice?.variant === 'bb_next') {
      const targetBbGw = wcChoice.gw + 1;
      if (targetBbGw <= halfEndGW && !usedGws.has(targetBbGw)) {
        const bb = evalBbAtGw(wcChoice.squad15, wcChoice.squadKey, targetBbGw);
        if (bb.eligible) {
          usedGws.add(bb.gw);
          currentAssignment.set('BB', {
            key: 'BB',
            gw: bb.gw,
            gain: bb.gain,
            scheduleValue: bb.scheduleValue,
            bbInfo: bb,
          });
          searchTc(wcChoice, sumVal + bb.scheduleValue, countPlaced + 1, earliness - bb.gw);
          currentAssignment.delete('BB');
          usedGws.delete(bb.gw);
        }
      }
      return;
    }

    const cands: BbGwInfo[] = [];
    for (const g of gwRange) {
      if (usedGws.has(g)) continue;
      const info =
        wcChoice && g > wcChoice.gw
          ? evalBbAtGw(wcChoice.squad15, wcChoice.squadKey, g)
          : bbPreWcByGw.get(g)!;
      if (info.eligible) cands.push(info);
    }
    cands.sort((a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw);
    const topCands = cands.slice(0, 5);
    const targetCand = cands.find((c) => c.gw === targetNextGW);
    if (targetCand && !topCands.some((c) => c.gw === targetNextGW)) topCands.push(targetCand);

    for (const bb of topCands) {
      usedGws.add(bb.gw);
      currentAssignment.set('BB', {
        key: 'BB',
        gw: bb.gw,
        gain: bb.gain,
        scheduleValue: bb.scheduleValue,
        bbInfo: bb,
      });
      searchTc(wcChoice, sumVal + bb.scheduleValue, countPlaced + 1, earliness - bb.gw);
      currentAssignment.delete('BB');
      usedGws.delete(bb.gw);
    }

    // Explicit Hold option for BB
    searchTc(wcChoice, sumVal, countPlaced, earliness);
  };

  const searchFh = (
    wcChoice: WcGwInfo | null,
    sumVal: number,
    countPlaced: number,
    earliness: number
  ) => {
    if (!hasFhAvail) {
      searchBb(wcChoice, sumVal, countPlaced, earliness);
      return;
    }

    const cands: FhGwInfo[] = [];
    for (const g of gwRange) {
      if (usedGws.has(g)) continue;
      if (wcChoice?.variant === 'bb_next' && g === wcChoice.gw + 1) continue;
      const simG = scoutChipSetSimByGw.get(g);
      if (!simG || simG.fhSquad15.length === 0) continue;
      const info =
        wcChoice && g > wcChoice.gw
          ? evalFhAtGw(wcChoice.squad15, wcChoice.squadKey, simG.fhSquad15, g)
          : fhPreWcByGw.get(g);
      if (info && info.eligible) cands.push(info);
    }
    cands.sort((a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw);
    const topCands = cands.slice(0, 5);
    const targetCand = cands.find((c) => c.gw === targetNextGW);
    if (targetCand && !topCands.some((c) => c.gw === targetNextGW)) topCands.push(targetCand);

    for (const fh of topCands) {
      usedGws.add(fh.gw);
      currentAssignment.set('FH', {
        key: 'FH',
        gw: fh.gw,
        gain: fh.gain,
        scheduleValue: fh.scheduleValue,
        fhInfo: fh,
      });
      searchBb(wcChoice, sumVal + fh.scheduleValue, countPlaced + 1, earliness - fh.gw);
      currentAssignment.delete('FH');
      usedGws.delete(fh.gw);
    }

    // Explicit Hold option for FH
    searchBb(wcChoice, sumVal, countPlaced, earliness);
  };

  if (hasWcAvail) {
    for (const wc of wcCandidates) {
      usedGws.add(wc.gw);
      currentAssignment.set('WC', {
        key: 'WC',
        gw: wc.gw,
        gain: wc.gain,
        scheduleValue: wc.discountedGain,
        wcVariant: wc.variant,
        wcInfo: wc,
      });
      searchFh(wc, wc.discountedGain, 1, -wc.gw);
      currentAssignment.delete('WC');
      usedGws.delete(wc.gw);
    }
  }
  // Explicit Hold option for WC (or start directly when WC already used)
  searchFh(null, 0, 0, 0);

  let activeChipAtTarget: ScheduledChipPlacement | null = null;
  for (const chip of availableChips) {
    const assigned = bestAssignment.get(chip.key);
    if (assigned && assigned.gw === targetNextGW) {
      activeChipAtTarget = assigned;
      break;
    }
  }

  // Detect consecutive WC -> BB / TC sequential plan when WC is recommended at targetNextGW
  const winningWc = bestAssignment.get('WC');
  const activeWcContext = winningWc?.wcInfo || null;
  let comboPlan: ServerScoutChipsAnalysis['comboPlan'] = undefined;
  if (activeChipAtTarget?.key === 'WC' && activeWcContext) {
    const bbAssigned = bestAssignment.get('BB');
    const tcAssigned = bestAssignment.get('TC');
    const nextSequential =
      bbAssigned && bbAssigned.gw === targetNextGW + 1
        ? { key: 'BB' as const, name: 'Bench Boost', item: bbAssigned }
        : tcAssigned && tcAssigned.gw === targetNextGW + 1
        ? { key: 'TC' as const, name: 'Triple Captain', item: tcAssigned }
        : bbAssigned && bbAssigned.gw === targetNextGW + 2
        ? { key: 'BB' as const, name: 'Bench Boost', item: bbAssigned }
        : tcAssigned && tcAssigned.gw === targetNextGW + 2
        ? { key: 'TC' as const, name: 'Triple Captain', item: tcAssigned }
        : null;
    if (nextSequential) {
      comboPlan = {
        nextChipKey: nextSequential.key,
        nextChipName: nextSequential.name,
        nextGw: nextSequential.item.gw,
        nextGain: nextSequential.item.gain,
        combinedGain: round1(activeChipAtTarget.scheduleValue + nextSequential.item.scheduleValue),
      };
    }
  }

  const fmt = (n: number) => n.toFixed(1);
  const fmtSigned = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  const setShortLabel = isSecondHalf ? 'paruh kedua musim (GW 20–38)' : 'paruh pertama musim (GW 1–19)';
  const setShortLabelEn = isSecondHalf
    ? 'the second half of the season (GW 20–38)'
    : 'the first half of the season (GW 1–19)';

  const rawChipParagraphs: Array<ScoutEditorialParagraph & { sortGw: number; peakGw: number }> = [];
  const rawFutureChipSummaries: Array<{ label: string; gw: number }> = [];

  for (const chip of availableChips) {
    const assigned = bestAssignment.get(chip.key) || null;
    const isNow = assigned?.gw === targetNextGW;

    if (chip.key === 'TC') {
      const cur = tcPreWcByGw.get(targetNextGW);
      const rawSorted = Array.from(tcPreWcByGw.values()).sort(
        (a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw
      );
      const peak = rawSorted[0] || null;
      const opt = assigned?.tcInfo || null;
      const curGain = cur?.gain ?? 0;
      const postWcNote =
        opt && activeWcContext && opt.gw > activeWcContext.gw
          ? isId
            ? ` (memaksimalkan target kapten baru pasca-Wildcard GW ${activeWcContext.gw})`
            : ` (captaining your upgraded post-Wildcard GW ${activeWcContext.gw} squad)`
          : '';

      if (opt && !isNow) rawFutureChipSummaries.push({ label: `Triple Captain (GW ${opt.gw})`, gw: opt.gw });

      const clashClause =
        !isNow && opt && peak && peak.gw !== opt.gw && peak.eligible
          ? isId
            ? ` Meski GW ${peak.gw} juga menyentuh ${fmt(peak.gain)} xP, slot pekan itu lebih maksimal dipakai oleh chip lain.`
            : ` While GW ${peak.gw} reaches ${fmt(peak.gain)} xP, that week delivers greater overall value with another chip.`
          : '';

      const text = opt
        ? isNow
          ? isId
            ? `layak langsung diarahkan kepada ${opt.playerName} saat menghadapi ${opt.opp} di GW ${opt.gw}. Proyeksi +${fmt(opt.gain)} xP tambahannya${opt.isDgw ? ' pada Double Gameweek ini' : ''} merupakan peluang kapten paling meyakinkan hingga GW ${halfEndGW}.${clashClause}`
            : `stands out for ${opt.playerName} against ${opt.opp} in GW ${opt.gw}. His +${fmt(opt.gain)} xP extra projection${opt.isDgw ? ' in this Double Gameweek' : ''} clears the value bar through GW ${halfEndGW}.${clashClause}`
          : isId
          ? `lebih bijak disimpan hingga GW ${opt.gw}, saat ${opt.playerName} menghadapi ${opt.opp} dengan proyeksi +${fmt(opt.gain)} xP${postWcNote} — unggul di atas opsi terbaik pekan ini, ${cur?.playerName || '-'} (${cur?.opp || '-'}, ${fmt(curGain)} xP).${clashClause}`
          : `is better saved for GW ${opt.gw}, when ${opt.playerName} faces ${opt.opp} at +${fmt(opt.gain)} xP${postWcNote} — beating your GW ${targetNextGW} option ${cur?.playerName || '-'} (${cur?.opp || '-'}, ${fmt(curGain)} xP).${clashClause}`
        : peak && peak.gain > 0
        ? isId
          ? `sebaiknya ditahan dulu di GW ${targetNextGW}. Kandidat terkuat sementara baru ${peak.playerName} di GW ${peak.gw} (${peak.opp}, ${fmt(peak.gain)} xP), yang belum cukup ekstrem untuk membakar Triple Captain selagi masih ada ${halfEndGW - targetNextGW} pekan menuju GW ${halfEndGW}.`
          : `should be held for now. Your highest current projection is ${peak.playerName} in GW ${peak.gw} (${peak.opp}, ${fmt(peak.gain)} xP), which doesn't clear the threshold to spend Triple Captain with ${halfEndGW - targetNextGW} weeks left before GW ${halfEndGW}.`
        : isId
        ? `belum menemukan kandidat kapten yang cukup menonjol di sisa ${setShortLabel}.`
        : `lacks a standout captaincy ceiling across the rest of ${setShortLabelEn}.`;

      rawChipParagraphs.push({
        chipKey: 'TC',
        chipLead: 'Triple Captain',
        text,
        sortGw: opt ? opt.gw : Number.MAX_SAFE_INTEGER,
        peakGw: peak?.gw ?? Number.MAX_SAFE_INTEGER,
      });
    } else if (chip.key === 'BB') {
      const cur = bbPreWcByGw.get(targetNextGW);
      const rawSorted = Array.from(bbPreWcByGw.values()).sort(
        (a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw
      );
      const peak = rawSorted[0] || null;
      const opt = assigned?.bbInfo || null;
      const curGain = cur?.gain ?? 0;

      if (opt && !isNow) rawFutureChipSummaries.push({ label: `Bench Boost (GW ${opt.gw})`, gw: opt.gw });

      const benchText = opt ? opt.benchDetails.map((b) => `${b.name} ${fmt(b.xp)}`).join(', ') : '';
      const isPostWcCombo = Boolean(opt && activeWcContext && opt.gw > activeWcContext.gw);
      const postWcLeadId =
        activeWcContext?.variant === 'bb_next'
          ? `disiapkan berurutan tepat sesudah Wildcard GW ${activeWcContext.gw}: ke-15 pemain skuad baru Anda siap tempur dengan total bangku ${fmt(opt?.gain || 0)} xP (${benchText})`
          : activeWcContext
          ? `berkolaborasi dengan skuad baru hasil Wildcard GW ${activeWcContext.gw}, membuat empat penghuni bangku memproyeksikan ${fmt(opt?.gain || 0)} xP (${benchText})`
          : `mencapai ${fmt(opt?.gain || 0)} xP (${benchText})`;
      const postWcLeadEn =
        activeWcContext?.variant === 'bb_next'
          ? `pairs sequentially right after your GW ${activeWcContext.gw} Wildcard, setting up a full 15-starter squad worth ${fmt(opt?.gain || 0)} xP on the bench (${benchText})`
          : activeWcContext
          ? `benefits from your upgraded GW ${activeWcContext.gw} Wildcard squad, lifting bench output to ${fmt(opt?.gain || 0)} xP (${benchText})`
          : `combines for ${fmt(opt?.gain || 0)} xP (${benchText})`;

      const clashClause =
        !isNow && opt && peak && peak.gw !== opt.gw && peak.eligible && !isPostWcCombo
          ? isId
            ? ` Pekan GW ${peak.gw} sebenarnya menyentuh ${fmt(peak.gain)} xP, tetapi dialihkan agar tidak bertabrakan dengan jadwal chip lain.`
            : ` GW ${peak.gw} hits ${fmt(peak.gain)} xP, but yields that slot to maximize combined chip-set points.`
          : '';

      const text = opt
        ? isNow
          ? isId
            ? `menemukan pekan idealnya sekarang. Bangku cadangan Anda aktif menyumbang poin dengan total ${fmt(opt.gain)} xP (${benchText}) — kedalaman bangku terkuat hingga GW ${halfEndGW}.${clashClause}`
            : `hits its sweet spot right now, with your bench combining for ${fmt(opt.gain)} xP (${benchText}) — your strongest bench return through GW ${halfEndGW}.${clashClause}`
          : isId
          ? `belum perlu dipakai pekan ini karena bangku cadangan saat ini baru memproyeksikan ${fmt(curGain)} xP. Momen terbaiknya hadir di GW ${opt.gw}, saat kuartet bangku ${postWcLeadId}.${clashClause}`
          : `can wait this week with your current bench projecting ${fmt(curGain)} xP. Its ideal window lands in GW ${opt.gw}, where it ${postWcLeadEn}.${clashClause}`
        : peak && peak.gain > 0
        ? isId
          ? `sebaiknya tetap disimpan karena proyeksi bangku terbaik skuad saat ini baru ${fmt(peak.gain)} xP di GW ${peak.gw} — belum cukup tinggi untuk mengorbankan chip selagi masih tersisa ${halfEndGW - targetNextGW} pekan menuju GW ${halfEndGW}.`
          : `should be saved for now: your current squad's highest bench outlook is only ${fmt(peak.gain)} xP in GW ${peak.gw}, below the threshold with ${halfEndGW - targetNextGW} weeks left before GW ${halfEndGW}.`
        : isId
        ? `belum layak diaktifkan karena proyeksi poin bangku cadangan masih 0.0 xP.`
        : `offers no return yet with bench projections sitting at 0.0 xP.`;

      rawChipParagraphs.push({
        chipKey: 'BB',
        chipLead: 'Bench Boost',
        text,
        sortGw: opt ? opt.gw : Number.MAX_SAFE_INTEGER,
        peakGw: peak?.gw ?? Number.MAX_SAFE_INTEGER,
      });
    } else if (chip.key === 'FH') {
      const cur = fhPreWcByGw.get(targetNextGW);
      const rawSorted = Array.from(fhPreWcByGw.values()).sort(
        (a, b) => b.scheduleValue - a.scheduleValue || a.gw - b.gw
      );
      const peak = rawSorted[0] || null;
      const opt = assigned?.fhInfo || null;
      const curGain = cur?.gain ?? 0;

      if (opt && !isNow) rawFutureChipSummaries.push({ label: `Free Hit (GW ${opt.gw})`, gw: opt.gw });

      const diffStr = opt?.diffNames.length ? opt.diffNames.join(', ') : '-';
      const clashClause =
        !isNow && opt && peak && peak.gw !== opt.gw && peak.eligible
          ? isId
            ? ` GW ${peak.gw} sempat mencatat +${fmt(peak.gain)} xP, namun digeser demi memaksimalkan perolehan total seluruh chip.`
            : ` GW ${peak.gw} showed +${fmt(peak.gain)} xP, shifted to maximize overall chip-set gains.`
          : '';

      const text = opt
        ? isNow
          ? isId
            ? `memberi lompatan instan di GW ${opt.gw}, mengangkat proyeksi Starting XI plus kapten dari ${fmt(opt.teamScore)} xP menjadi ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP). Kehadiran pembeda seperti ${diffStr} menutup celah jadwal skuad saat ini.${clashClause}`
            : `provides an immediate GW ${opt.gw} surge, lifting your best XI plus captain from ${fmt(opt.teamScore)} xP to ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) behind key picks like ${diffStr}.${clashClause}`
          : isId
          ? `belum perlu tergesa-gesa dipakai pekan ini karena selisihnya baru ${fmtSigned(curGain)} xP (${fmt(cur?.fhScore || 0)} vs ${fmt(cur?.teamScore || 0)} xP). Lonjakan nyatanya muncul di GW ${opt.gw}, mendongkrak proyeksi dari ${fmt(opt.teamScore)} menjadi ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) lewat ${diffStr}.${clashClause}`
          : `can wait with GW ${targetNextGW} offering only ${fmtSigned(curGain)} xP (${fmt(cur?.fhScore || 0)} vs ${fmt(cur?.teamScore || 0)} xP). The real swing lands in GW ${opt.gw}, lifting your XI plus captain from ${fmt(opt.teamScore)} to ${fmt(opt.fhScore)} xP (+${fmt(opt.gain)} xP) via ${diffStr}.${clashClause}`
        : isId
        ? `sebaiknya ditahan untuk Blank/Double Gameweek atau situasi darurat skuad, karena selisih terbaik di pekan tersisa baru ${peak ? `${fmtSigned(peak.gain)} xP di GW ${peak.gw}` : '0.0 xP'} — terlalu tipis untuk membakar Free Hit.`
        : `should be held for a Blank/Double Gameweek or injury crisis, as the best one-week delta ahead is only ${peak ? `${fmtSigned(peak.gain)} xP in GW ${peak.gw}` : '0.0 xP'} — too thin to spend Free Hit.`;

      rawChipParagraphs.push({
        chipKey: 'FH',
        chipLead: 'Free Hit',
        text,
        sortGw: opt ? opt.gw : Number.MAX_SAFE_INTEGER,
        peakGw: peak?.gw ?? Number.MAX_SAFE_INTEGER,
      });
    } else {
      const cur = wcNormalByGw.get(targetNextGW);
      const rawSorted = Array.from(wcNormalByGw.values()).sort(
        (a, b) => b.discountedGain - a.discountedGain || a.gw - b.gw
      );
      const peak = rawSorted[0] || null;
      const opt = assigned?.wcInfo || null;
      const curDiff = cur?.diffStarters ?? 0;

      if (!opt) {
        const allHeldByFt =
          rawSorted.length > 0 && rawSorted.every((v) => v.heldByFt || v.gain <= 0);
        const text =
          allHeldByFt || curDiff <= ftAllowance
            ? isId
              ? `sebaiknya ditahan karena kerangka Starting XI Anda hanya terpaut ${curDiff} pemain dari komposisi idealnya — masih terjangkau dengan ${ftAllowance} Free Transfer yang dimiliki tanpa perlu menghabiskan chip.`
              : `should be held since your Starting XI differs by only ${curDiff} players — easily manageable with your ${ftAllowance} Free Transfers.`
            : isId
            ? `belum mendesak diaktifkan karena margin perombakan terbaiknya (${peak ? `+${fmt(peak.gain)} xP/GW di GW ${peak.gw}` : 'tipis'}) belum cukup lebar dibanding pemakaian Free Transfer bertahap.`
            : `isn't urgent yet as the best rebuild margin (${peak ? `+${fmt(peak.gain)} xP/GW in GW ${peak.gw}` : 'marginal'}) doesn't clear the bar over rolling Free Transfers.`;
        rawChipParagraphs.push({
          chipKey: 'WC',
          chipLead: 'Wildcard',
          text,
          sortGw: Number.MAX_SAFE_INTEGER,
          peakGw: peak?.gw ?? Number.MAX_SAFE_INTEGER,
        });
        continue;
      }

      if (!isNow) rawFutureChipSummaries.push({ label: `Wildcard (GW ${opt.gw})`, gw: opt.gw });
      const keyAdds = opt.keyAdditions.length ? opt.keyAdditions.join(', ') : '-';
      const seqNoteId =
        isNow && comboPlan
          ? ` Sekaligus, perombakan ini menyiapkan skuad penuh untuk mengaktifkan ${comboPlan.nextChipName} di GW ${comboPlan.nextGw} (+${fmt(comboPlan.nextGain)} xP).`
          : '';
      const seqNoteEn =
        isNow && comboPlan
          ? ` Crucially, this rebuild also primes your squad for a consecutive ${comboPlan.nextChipName} in GW ${comboPlan.nextGw} (+${fmt(comboPlan.nextGain)} xP).`
          : '';
      const clashClause =
        !isNow && peak && peak.gw !== opt.gw && peak.eligible
          ? isId
            ? ` Jendela GW ${peak.gw} sebenarnya memproyeksikan +${fmt(peak.gain)} xP/GW, namun pekan tersebut diprioritaskan untuk chip lain.`
            : ` GW ${peak.gw} projected +${fmt(peak.gain)} xP/GW, but that week is reserved for another chip.`
          : '';

      let text = '';
      if (isNow) {
        text = isId
          ? `paling masuk akal diaktifkan di GW ${opt.gw} untuk merombak struktur tim menghadapi rentang GW ${opt.gw}–${opt.horizonEnd}. Ada ${opt.diffStarters} perubahan pada Starting XI terbaik yang melampaui jangkauan ${ftAllowance} Free Transfer saat ini, dengan tambahan rata-rata +${fmt(opt.gain)} xP per pekan lewat pilar seperti ${keyAdds}.${seqNoteId}${clashClause}`
          : `makes sense now in GW ${opt.gw} to reshape your core for GW ${opt.gw}–${opt.horizonEnd}. With ${opt.diffStarters} Starting XI upgrades beyond your ${ftAllowance} Free Transfers, it adds +${fmt(opt.gain)} xP per week behind targets like ${keyAdds}.${seqNoteEn}${clashClause}`;
      } else if (cur?.heldByFt) {
        text = isId
          ? `belum perlu disentuh di GW ${targetNextGW} karena perbedaan Starting XI terbaiknya hanya ${cur.diffStarters} pemain — masih sanggup dibereskan dengan ${ftAllowance} Free Transfer yang Anda pegang. Perombakan menyeluruh baru terasa dampaknya mulai GW ${opt.gw} (horizon GW ${opt.gw}–${opt.horizonEnd}) dengan ${opt.diffStarters} perubahan XI dan dorongan rata-rata +${fmt(opt.gain)} xP per pekan lewat ${keyAdds}.${clashClause}`
          : `isn't needed in GW ${targetNextGW} with only ${cur.diffStarters} Starting XI differences — easily fixed using your ${ftAllowance} Free Transfers. A full rebuild pays off starting in GW ${opt.gw} (GW ${opt.gw}–${opt.horizonEnd}), bringing ${opt.diffStarters} XI upgrades worth +${fmt(opt.gain)} xP/GW led by ${keyAdds}.${clashClause}`;
      } else {
        text = isId
          ? `memang menjanjikan ${cur ? `+${fmt(cur.gain)}` : '+0.0'} xP/GW bila ditarik pekan ini, tetapi jendela GW ${opt.gw}–${opt.horizonEnd} memberi dorongan lebih kuat sebesar +${fmt(opt.gain)} xP per pekan dengan ${opt.diffStarters} perubahan inti seperti ${keyAdds}.${clashClause}`
          : `offers ${cur ? `+${fmt(cur.gain)}` : '+0.0'} xP/GW now, yet GW ${opt.gw}–${opt.horizonEnd} delivers a stronger +${fmt(opt.gain)} xP/GW lift across ${opt.diffStarters} XI changes featuring ${keyAdds}.${clashClause}`;
      }

      rawChipParagraphs.push({
        chipKey: 'WC',
        chipLead: 'Wildcard',
        text,
        sortGw: opt.gw,
        peakGw: peak?.gw ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  rawChipParagraphs.sort((a, b) => a.sortGw - b.sortGw || a.peakGw - b.peakGw);
  const chipParagraphs: ScoutEditorialParagraph[] = rawChipParagraphs.map(
    ({ chipKey, chipLead, text }) => ({ chipKey, chipLead, text })
  );

  rawFutureChipSummaries.sort((a, b) => a.gw - b.gw);
  const futureChipSummaries = rawFutureChipSummaries.map((item) => item.label);

  const joinNatural = (items: string[]) => {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return isId ? `${items[0]} dan ${items[1]}` : `${items[0]} and ${items[1]}`;
    return isId
      ? `${items.slice(0, -1).join(', ')}, dan ${items[items.length - 1]}`
      : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  };

  const availListText = joinNatural(availableChips.map((c) => c.name));
  const futureChipText = joinNatural(futureChipSummaries);
  const chipNameByKey: Record<ChipKey, string> = {
    WC: 'Wildcard',
    TC: 'Triple Captain',
    BB: 'Bench Boost',
    FH: 'Free Hit',
  };
  const activeChipName = activeChipAtTarget ? chipNameByKey[activeChipAtTarget.key] : null;
  let openingNarrative = '';
  if (activeChipAtTarget && activeChipName) {
    const comboClauseId = comboPlan
      ? ` Strategi ini sekaligus menyiapkan skuad untuk lanjut mengaktifkan ${comboPlan.nextChipName} di GW ${comboPlan.nextGw} (+${fmt(comboPlan.nextGain)} xP).`
      : '';
    const comboClauseEn = comboPlan
      ? ` This also sets up a sequential ${comboPlan.nextChipName} in GW ${comboPlan.nextGw} (+${fmt(comboPlan.nextGain)} xP).`
      : '';
    const remainingFuture = futureChipSummaries.filter(
      (s) => !comboPlan || !s.startsWith(`${comboPlan.nextChipName} (GW ${comboPlan.nextGw})`)
    );
    const remainingFutureText = joinNatural(remainingFuture);
    const restFutureText = remainingFuture.length
      ? isId
        ? ` Sisa chip lainnya paling ideal disimpan untuk ${remainingFutureText}.`
        : ` Your other remaining chips line up best at ${remainingFutureText}.`
      : '';
    openingNarrative = isId
      ? `GW ${targetNextGW} menjadi titik paling menguntungkan untuk mengaktifkan ${activeChipName} (+${fmt(activeChipAtTarget.gain)} xP${activeChipAtTarget.key === 'WC' ? '/GW' : ''}) di sisa ${setShortLabel}, mempertimbangkan ${availableChips.length} chip yang masih Anda pegang (${availListText}).${comboClauseId}${restFutureText}`
      : `GW ${targetNextGW} stands out as the prime week to play ${activeChipName} (+${fmt(activeChipAtTarget.gain)} xP${activeChipAtTarget.key === 'WC' ? '/GW' : ''}) across the rest of ${setShortLabelEn}, factoring in your remaining chips (${availListText}).${comboClauseEn}${restFutureText}`;
  } else {
    const waitWindowText = futureChipSummaries.length
      ? isId
        ? ` Untuk ${availableChips.length} chip yang masih tersedia (${availListText}), jendela terbaiknya baru muncul di pekan mendatang (${futureChipText}).`
        : ` Across your available chips (${availListText}), stronger peaks arrive later in the set (${futureChipText}).`
      : isId
      ? ` Belum ada satu pun dari chip yang tersisa (${availListText}) yang menembus ambang nilai optimal di GW ${targetNextGW}.`
      : ` None of your remaining chips (${availListText}) clear the value threshold in GW ${targetNextGW}.`;
    openingNarrative = isId
      ? `Belum ada alasan kuat untuk membakar chip di GW ${targetNextGW}.${waitWindowText} Langkah paling bijak pekan ini adalah menjaga amunisi chip dan memoles skuad lewat ${ftAllowance} Free Transfer yang Anda miliki.`
      : `There is no pressing reason to trigger a chip in GW ${targetNextGW}.${waitWindowText} Holding your chips and shaping the squad with your ${ftAllowance} Free Transfers is the smart play this week.`;
  }

  const activePlanText = activeChipAtTarget
    ? chipParagraphs.find((p) => p.chipKey === activeChipAtTarget?.key)?.text || ''
    : '';

  return {
    needChip: Boolean(activeChipAtTarget),
    chipName: activeChipName,
    gain: activeChipAtTarget ? activeChipAtTarget.gain : 0,
    reason: activePlanText,
    chipSet,
    isSecondHalf,
    halfStartGW,
    halfEndGW,
    currentFT: ftAllowance,
    openingNarrative,
    chipParagraphs,
    allUsed: false,
    ...(comboPlan ? { comboPlan } : {}),
  };
}

export function computeServerTransferAnalysis(params: {
  ctx: ServerScoutRuntimeContext;
  activeManager: StandingsRow | null;
  activeSquadIds: number[];
  ftAllowance: number;
  bankBalance: number;
  transferMode: 'FT' | 'HIT';
  transferHorizon: 1 | 3 | 6;
  lang: 'id' | 'en';
  quantilesByPlayerGw?: Map<number, Map<number, number[]>>;
  sellingPriceById?: Map<number, number>;
}): ServerScoutTransferAnalysis {
  const {
    ctx,
    activeManager,
    activeSquadIds,
    ftAllowance,
    bankBalance,
    transferMode,
    transferHorizon,
    lang,
    quantilesByPlayerGw,
    sellingPriceById,
  } = params;
  const isId = lang !== 'en';
  const { baseHistoricalGW, minFormingGW, maxFormingGW, targetNextGW, playerPool, playerPoolById, policy } = ctx;

  const completedGws = Math.max(maxFormingGW >= minFormingGW ? maxFormingGW - minFormingGW + 1 : 1, 1);
  const horizonCount = Math.min(transferHorizon, Math.max(1, 38 - targetNextGW + 1));
  const horizonEndGw = Math.min(targetNextGW + horizonCount - 1, 38);
  const horizonLabel = horizonCount === 1 ? `GW${targetNextGW}` : `${horizonCount} GW`;

  const currentSquad15 = activeSquadIds
    .map((id) => playerPoolById.get(id))
    .filter((p): p is ServerScoutPoolPlayer => Boolean(p));

  if (!activeManager || currentSquad15.length < 11 || playerPool.length === 0) {
    return {
      needTransfer: false,
      moves: [],
      netGain: 0,
      hitCount: 0,
      hitCost: 0,
      ftUsed: 0,
      reason: '',
      reasonParagraphs: [],
      startXiXpH: 0,
      endXiXpH: 0,
      startBank: round1(bankBalance),
      endBank: round1(bankBalance),
      startFormation: '3-4-3',
      endFormation: '3-4-3',
      horizonCount,
      horizonEndGw,
      horizonLabel,
    };
  }

  const currentIds15 = currentSquad15.map((p) => p.id);
  const searchRes = runScoutTransferSearch({
    players: playerPool.map((p) => p.modelInput),
    squad15Ids: currentIds15,
    bank: round1(bankBalance),
    ftAllowance,
    transferMode,
    startGw: targetNextGW,
    targetNextGW,
    horizonCount,
    policy,
    quantilesByPlayerGw,
    sellingPriceById,
    maxHitDepth: 15,
    beamWidth: 10,
    candidateTopN: 18,
  });

  const hydrateMoveSide = (
    p: ServerScoutPoolPlayer,
    effXp1: number,
    effXpH: number,
    flags?: { isOutStatus?: boolean; isBenchFodder?: boolean; isDoubt?: boolean; sellingPrice?: number }
  ) => {
    const sampleMins = Math.max(p.mins, 90);
    return {
      p,
      minsPerGw: Math.round(p.mins / completedGws),
      isOutStatus: Boolean(flags?.isOutStatus),
      isBenchFodder: Boolean(flags?.isBenchFodder),
      isDoubt: Boolean(flags?.isDoubt),
      sellingPrice: flags?.sellingPrice ?? round1(p.cost),
      effXp1,
      effXpH,
      horizonFixtures: (p.fixtures6 || []).slice(0, horizonCount),
      xGi90: round2((p.xGI / sampleMins) * 90),
      threat90: round1((p.threat / sampleMins) * 90),
      creat90: round1((p.creativity / sampleMins) * 90),
    };
  };

  const hydratedMoves = searchRes.moves
    .map((m) => {
      const outP = playerPoolById.get(m.outId);
      const inP = playerPoolById.get(m.inId);
      if (!outP || !inP) return null;
      return {
        out: hydrateMoveSide(outP, m.effXp1Out, m.effXpHOut, {
          isOutStatus: m.isOutStatusOut,
          isBenchFodder: m.isBenchFodderOut,
          isDoubt: m.isDoubtOut,
          sellingPrice: m.sellingPriceOut ?? sellingPriceById?.get(outP.id) ?? round1(outP.cost),
        }),
        in: hydrateMoveSide(inP, m.effXp1In, m.effXpHIn),
        bankBefore: m.bankBefore,
        bankAfter: m.bankAfter,
        isHit: m.isHit,
        stepNum: m.stepNum,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const bestState = {
    moves: hydratedMoves,
    xi: searchRes.endXI,
    xiGainH: round1(searchRes.endXI.xiXpH - searchRes.startXI.xiXpH),
    hitCount: searchRes.hitCount,
    hitCost: searchRes.hitCost,
    bank: searchRes.endBank,
  };
  const baseXI = searchRes.startXI;
  const needTransfer = searchRes.needTransfer && hydratedMoves.length > 0;
  const ftUsed = searchRes.ftUsed;
  const savedFt = Math.max(0, ftAllowance - ftUsed);
  const netGain = searchRes.netGain;
  const isHitMode = transferMode === 'HIT';

  const formatFixturesText = (eff: ReturnType<typeof hydrateMoveSide>) => {
    const list = eff.horizonFixtures;
    if (list.length <= 3) {
      return list.map((f) => `${f.opp} (${f.xp.toFixed(1)} xP)`).join(', ');
    }
    const head = list.slice(0, 3).map((f) => `${f.opp} (${f.xp.toFixed(1)} xP)`).join(', ');
    const tail = list.slice(3).map((f) => f.opp).join(', ');
    return `${head}, ${tail}`;
  };

  const windowPhraseId =
    horizonCount === 1
      ? `menatap GW${targetNextGW}`
      : `untuk ${horizonCount} pekan ke depan (GW${targetNextGW}–GW${horizonEndGw})`;
  const windowPhraseEn =
    horizonCount === 1
      ? `heading into GW${targetNextGW}`
      : `across the next ${horizonCount} Gameweeks (GW${targetNextGW}–GW${horizonEndGw})`;

  const baseSeed = Math.abs(
    (activeManager.entry_id || 1) * 31 + targetNextGW * 17 + horizonCount * 13 + bestState.moves.length * 7
  );

  const reasonParagraphs: string[] = [];
  if (needTransfer) {
    const formChanged = baseXI.formation !== bestState.xi.formation;
    const formTxtId = formChanged
      ? `mengubah skema menjadi ${bestState.xi.formation}`
      : `menjaga kerangka ${bestState.xi.formation}`;
    const formTxtEn = formChanged
      ? `reshaping into ${bestState.xi.formation}`
      : `keeping a ${bestState.xi.formation} shape`;
    const bankMoved = Math.abs(round1(bankBalance) - bestState.bank) >= 0.1;
    const bankNoteId = bankMoved
      ? `sisa dana bergeser dari £${round1(bankBalance).toFixed(1)}m ke £${bestState.bank.toFixed(1)}m`
      : `dana bank tetap rapi di £${bestState.bank.toFixed(1)}m`;
    const bankNoteEn = bankMoved
      ? `leaving £${bestState.bank.toFixed(1)}m in the bank (from £${round1(bankBalance).toFixed(1)}m)`
      : `keeping £${bestState.bank.toFixed(1)}m in the bank`;

    if (bestState.hitCount > 0) {
      const hitOpenersId = [
        `Mengambil ${bestState.hitCount}x hit (-${bestState.hitCost} pts) mendampingi ${ftUsed} FT terhitung agresif namun rasional ${windowPhraseId}. Dengan ${formTxtId}, proyeksi Starting XI melonjak dari ${baseXI.xiXpH.toFixed(1)} ke ${bestState.xi.xiXpH.toFixed(1)} pts (+${bestState.xiGainH.toFixed(1)} pts kotor)—cukup lebar untuk menutup penalti dan mengantongi surplus +${netGain.toFixed(1)} pts (${bankNoteId}).`,
        `Penalti -${bestState.hitCost} pts dari ${bestState.hitCount}x hit bukan halangan ${windowPhraseId} karena lonjakan poinnya sangat terasa. Skuad inti (${bestState.xi.formation}) naik kelas dari ${baseXI.xiXpH.toFixed(1)} menjadi ${bestState.xi.xiXpH.toFixed(1)} pts, menyisakan untung bersih +${netGain.toFixed(1)} pts dengan ${bankNoteId}.`,
        `Kombinasi ${ftUsed} FT plus ${bestState.hitCount}x hit (-${bestState.hitCost} pts) jadi jalan tercepat menambal celah tim ${windowPhraseId}. Rombakan ini mengangkat estimasi Starting XI ke ${bestState.xi.xiXpH.toFixed(1)} pts dari semula ${baseXI.xiXpH.toFixed(1)} pts—net +${netGain.toFixed(1)} pts setelah dipotong biaya hit, sekaligus membuat ${bankNoteId}.`,
        `Daripada membiarkan titik lemah menggerus poin ${windowPhraseId}, memakai ${ftUsed} FT beserta ${bestState.hitCount}x hit (-${bestState.hitCost} pts) memberi imbal balik yang jelas. Skema ${bestState.xi.formation} menghasilkan kenaikan Starting XI +${bestState.xiGainH.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) atau +${netGain.toFixed(1)} pts bersih (${bankNoteId}).`,
      ];
      const hitOpenersEn = [
        `Taking ${bestState.hitCount}x hit (-${bestState.hitCost} pts) alongside ${ftUsed} FT is an aggressive yet calculated call ${windowPhraseEn}. By ${formTxtEn}, projected Starting XI output climbs from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts, clearing the penalty for a +${netGain.toFixed(1)} pts net edge while ${bankNoteEn}.`,
        `Paying a -${bestState.hitCost} pts hit (${bestState.hitCount}x) pays off ${windowPhraseEn}: moving into ${bestState.xi.formation} boosts Starting XI expectation from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts, leaving +${netGain.toFixed(1)} pts in net profit and ${bankNoteEn}.`,
        `Pairing ${ftUsed} FT with ${bestState.hitCount}x hit (-${bestState.hitCost} pts) fixes key weak spots immediately ${windowPhraseEn}. Your XI rises by +${bestState.xiGainH.toFixed(1)} pts gross (+${netGain.toFixed(1)} pts net) while ${bankNoteEn}.`,
        `Rather than carrying deadweight ${windowPhraseEn}, investing ${ftUsed} FT and ${bestState.hitCount}x hit (-${bestState.hitCost} pts) transforms the XI to ${bestState.xi.xiXpH.toFixed(1)} pts (up from ${baseXI.xiXpH.toFixed(1)}) for a +${netGain.toFixed(1)} pts net gain, ${bankNoteEn}.`,
      ];
      reasonParagraphs.push(
        isId ? hitOpenersId[baseSeed % hitOpenersId.length] : hitOpenersEn[baseSeed % hitOpenersEn.length]
      );
    } else {
      const rollClauseId = savedFt > 0 ? ` sembari menabung ${savedFt} FT untuk pekan depan` : '';
      const rollClauseEn = savedFt > 0 ? ` while rolling ${savedFt} FT into next week` : '';
      const ftOpenersId = [
        `Mengaktifkan ${ftUsed} dari ${ftAllowance} Free Transfer${rollClauseId} adalah manuver paling efisien ${windowPhraseId}. Selain ${formTxtId}, proyeksi Starting XI terdongkrak dari ${baseXI.xiXpH.toFixed(1)} ke ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts bersih) dan ${bankNoteId}.`,
        `Tanpa perlu mengambil penalti poin, ${ftUsed} FT${rollClauseId} sudah cukup untuk mempertajam skuad ${windowPhraseId}. Estimasi Starting XI bergerak naik dari ${baseXI.xiXpH.toFixed(1)} menuju ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts) lewat skema ${bestState.xi.formation}, dengan ${bankNoteId}.`,
        `Peluang peningkatan poin paling bersih ${windowPhraseId} datang dari pemakaian ${ftUsed} FT${savedFt > 0 ? ` (sisa ${savedFt} FT tetap aman)` : ''}. Susunan inti ${bestState.xi.formation} kini memproyeksikan ${bestState.xi.xiXpH.toFixed(1)} pts—unggul +${netGain.toFixed(1)} pts dari skuad awal—sementara ${bankNoteId}.`,
        `Fokus utama ${windowPhraseId} adalah memaksimalkan ${ftUsed} dari ${ftAllowance} jatah FT yang tersedia${rollClauseId}. Pergerakan ini langsung menaikkan angka harapan Starting XI sebesar +${netGain.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) dengan ${bankNoteId}.`,
      ];
      const ftOpenersEn = [
        `Deploying ${ftUsed} of ${ftAllowance} Free Transfers${rollClauseEn} is the sharpest move ${windowPhraseEn}. Beyond ${formTxtEn}, your Starting XI rises from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts net), ${bankNoteEn}.`,
        `Without taking a single hit, using ${ftUsed} FT${rollClauseEn} meaningfully upgrades the XI ${windowPhraseEn}—lifting output from ${baseXI.xiXpH.toFixed(1)} to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts) while ${bankNoteEn}.`,
        `The cleanest value play ${windowPhraseEn} uses ${ftUsed} FT${savedFt > 0 ? ` (keeping ${savedFt} FT in reserve)` : ''}, raising XI expectation to ${bestState.xi.xiXpH.toFixed(1)} pts (+${netGain.toFixed(1)} pts gain) and ${bankNoteEn}.`,
        `Putting ${ftUsed} of ${ftAllowance} FTs to work${rollClauseEn} boosts Starting XI potential by +${netGain.toFixed(1)} pts (${baseXI.xiXpH.toFixed(1)} → ${bestState.xi.xiXpH.toFixed(1)}) ${windowPhraseEn}, ${bankNoteEn}.`,
      ];
      reasonParagraphs.push(
        isId ? ftOpenersId[baseSeed % ftOpenersId.length] : ftOpenersEn[baseSeed % ftOpenersEn.length]
      );
    }

    bestState.moves.forEach((m, moveIdx) => {
      const outP = m.out.p;
      const inP = m.in.p;
      const outSellPrice = m.out.sellingPrice;
      const hasSellDiscount = outSellPrice < outP.cost - 0.05;
      const outPriceMetaId = hasSellDiscount
        ? `£${outP.cost.toFixed(1)}m, jual £${outSellPrice.toFixed(1)}m`
        : `£${outP.cost.toFixed(1)}m`;
      const outPriceMetaEn = hasSellDiscount
        ? `£${outP.cost.toFixed(1)}m, sells £${outSellPrice.toFixed(1)}m`
        : `£${outP.cost.toFixed(1)}m`;
      const xpDiff = round1(m.in.effXpH - m.out.effXpH);
      const outFixStr = formatFixturesText(m.out) || '-';
      const inFixStr = formatFixturesText(m.in) || '-';

      let outSentenceId = '';
      let outSentenceEn = '';
      if (m.out.isOutStatus) {
        const stTextId =
          outP.status === 's' ? 'terkena suspensi' : outP.status === 'i' ? 'dibekap cedera' : 'diragukan berat tampil';
        const chanceId = outP.chanceOfPlaying !== null ? ` (${outP.chanceOfPlaying}% peluang main)` : '';
        const newsNote = outP.news ? ` — "${outP.news}"` : '';
        const outVariantsId = [
          `Mengandalkan ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) terlalu berisiko setelah ia ${stTextId}${chanceId}${newsNote}, membuat proyeksinya mentok di ${m.out.effXpH.toFixed(1)} pts melawan ${outFixStr}.`,
          `Kabar terbaru memaksa kita mencoret ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) yang sedang ${stTextId}${chanceId}${newsNote}; menghadapi ${outFixStr}, ekspektasi poinnya turun ke ${m.out.effXpH.toFixed(1)} pts.`,
          `Slot ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) butuh penanganan cepat karena statusnya ${stTextId}${chanceId}${newsNote}, sehingga potensi poinnya hanya ${m.out.effXpH.toFixed(1)} pts pada laga ${outFixStr}.`,
        ];
        const stTextEn = outP.status === 's' ? 'suspended' : outP.status === 'i' ? 'injured' : 'a major doubt';
        const chanceEn = outP.chanceOfPlaying !== null ? ` (${outP.chanceOfPlaying}% chance)` : '';
        const outVariantsEn = [
          `Holding ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) carries too much risk while he is ${stTextEn}${chanceEn}${newsNote}, leaving him at just ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
          `Availability concerns force an exit for ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}), currently ${stTextEn}${chanceEn}${newsNote} with only ${m.out.effXpH.toFixed(1)} pts projected versus ${outFixStr}.`,
          `${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) needs replacing immediately after being flagged ${stTextEn}${chanceEn}${newsNote}, capping his output at ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
        ];
        const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
        outSentenceId = outVariantsId[outIdx];
        outSentenceEn = outVariantsEn[outIdx];
      } else if (m.out.isBenchFodder) {
        const outVariantsId = [
          `Slot ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) praktis menganggur karena baru mengumpulkan ${outP.mins} menit (${m.out.minsPerGw} mnt/GW, ${outP.starts} starter), dengan proyeksi hanya ${m.out.effXpH.toFixed(1)} pts saat meladeni ${outFixStr}.`,
          `Minimnya jam terbang ${outP.webName} (${outP.clubName}, ${outPriceMetaId})—cuma ${outP.mins} menit dari ${outP.starts} kali starter—membuat nilainya tertahan di ${m.out.effXpH.toFixed(1)} pts di laga ${outFixStr}.`,
          `Mempertahankan ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) sulit memberi kontribusi nyata mengingat menit bermainnya baru ${outP.mins} mnt (rata-rata ${m.out.minsPerGw} mnt/GW) dan proyeksi ${m.out.effXpH.toFixed(1)} pts menghadapi ${outFixStr}.`,
        ];
        const outVariantsEn = [
          `${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) has become deadwood at just ${outP.mins} minutes (${m.out.minsPerGw}/GW, ${outP.starts} starts), projecting only ${m.out.effXpH.toFixed(1)} pts versus ${outFixStr}.`,
          `Lack of pitch time makes ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) an easy sell—only ${outP.mins} mins across ${outP.starts} starts leaves him at ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
          `Keeping ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) wastes a squad spot while he sits on ${outP.mins} mins (${m.out.minsPerGw}/GW) and ${m.out.effXpH.toFixed(1)} projected pts for ${outFixStr}.`,
        ];
        const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
        outSentenceId = outVariantsId[outIdx];
        outSentenceEn = outVariantsEn[outIdx];
      } else if (m.out.isDoubt) {
        const newsNote = outP.news ? `, "${outP.news}"` : '';
        const outVariantsId = [
          `Status ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) yang masih abu-abu (${outP.chanceOfPlaying ?? 50}% peluang tampil${newsNote}) memangkas ekspektasinya menjadi ${m.out.effXpH.toFixed(1)} pts menghadapi ${outFixStr}.`,
          `Dengan kondisi kebugaran ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) belum 100% (${outP.chanceOfPlaying ?? 50}%${newsNote}), proyeksi poinnya menyusut ke ${m.out.effXpH.toFixed(1)} pts melawan ${outFixStr}.`,
        ];
        const outVariantsEn = [
          `With ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) flagged doubtful (${outP.chanceOfPlaying ?? 50}% chance${newsNote}), his projection drops to ${m.out.effXpH.toFixed(1)} pts against ${outFixStr}.`,
          `Fitness uncertainty around ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) (${outP.chanceOfPlaying ?? 50}%${newsNote}) pulls his expectation down to ${m.out.effXpH.toFixed(1)} pts versus ${outFixStr}.`,
        ];
        const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
        outSentenceId = outVariantsId[outIdx];
        outSentenceEn = outVariantsEn[outIdx];
      } else {
        const isOutDef = outP.position === 'DEF' || outP.position === 'GKP';
        const outStatId = isOutDef
          ? `${outP.pts} pts, ${outP.cleanSheets} clean sheet, Form ${outP.form.toFixed(1)}`
          : `${outP.pts} pts (${outP.goals}G/${outP.assists}A), Form ${outP.form.toFixed(1)}, ${m.out.xGi90.toFixed(2)} xGI/90'`;
        const outVariantsId = [
          `Meski ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) mengantongi ${outStatId}, lajunya tertahan jadwal ${outFixStr} yang cuma menjanjikan ${m.out.effXpH.toFixed(1)} pts sehingga dananya layak dialihkan.`,
          `Melepas ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) memang tak mudah menilik catatan ${outStatId}, namun benturan lawan ${outFixStr} membatasi proyeksinya di ${m.out.effXpH.toFixed(1)} pts.`,
          `Di atas kertas ${outP.webName} (${outP.clubName}, ${outPriceMetaId}) cukup solid (${outStatId}), tetapi menghadapi ${outFixStr} plafon poinnya melandai ke ${m.out.effXpH.toFixed(1)} pts—membuka ruang untuk opsi yang lebih tajam.`,
          `Dana jual £${outSellPrice.toFixed(1)}m dari ${outP.webName} (${outP.clubName}) mulai kurang maksimal; kendati mencatat ${outStatId}, duel ${outFixStr} hanya memberinya proyeksi ${m.out.effXpH.toFixed(1)} pts.`,
        ];
        const outStatEn = isOutDef
          ? `${outP.pts} pts, ${outP.cleanSheets} clean sheets, Form ${outP.form.toFixed(1)}`
          : `${outP.pts} pts (${outP.goals}G/${outP.assists}A), Form ${outP.form.toFixed(1)}, ${m.out.xGi90.toFixed(2)} xGI/90'`;
        const outVariantsEn = [
          `Although ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) holds ${outStatEn}, a tougher schedule (${outFixStr}) caps him at ${m.out.effXpH.toFixed(1)} pts and opens an upgrade route.`,
          `Parting with ${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) comes despite ${outStatEn}, as ${outFixStr} suppresses his projection to ${m.out.effXpH.toFixed(1)} pts.`,
          `${outP.webName} (${outP.clubName}, ${outPriceMetaEn}) has delivered ${outStatEn}, yet ${outFixStr} limits his ceiling to ${m.out.effXpH.toFixed(1)} pts when better fixtures beckon elsewhere.`,
          `Reallocating £${outSellPrice.toFixed(1)}m from ${outP.webName} (${outP.clubName}, ${outStatEn}) makes tactical sense with ${outFixStr} yielding just ${m.out.effXpH.toFixed(1)} pts.`,
        ];
        const outIdx = (baseSeed + moveIdx) % outVariantsId.length;
        outSentenceId = outVariantsId[outIdx];
        outSentenceEn = outVariantsEn[outIdx];
      }

      const isInDef = inP.position === 'DEF' || inP.position === 'GKP';
      const hitTagId = m.isHit ? ' lewat Hit (-4)' : '';
      const hitTagEn = m.isHit ? ' (for a -4 hit)' : '';
      const ownTagId =
        inP.fnbOwn < 6
          ? `masih berstatus pembeda langka (${inP.fnbOwn.toFixed(1)}% kepemilikan liga)`
          : inP.fnbOwn > 35
          ? `menjadi aset populer (${inP.fnbOwn.toFixed(1)}% kepemilikan liga) untuk melindungi peringkat`
          : `berada di kepemilikan ${inP.fnbOwn.toFixed(1)}% tim liga`;
      const ownTagEn =
        inP.fnbOwn < 6
          ? `acting as a crisp differential (${inP.fnbOwn.toFixed(1)}% league ownership)`
          : inP.fnbOwn > 35
          ? `covering a key rank threat (${inP.fnbOwn.toFixed(1)}% league ownership)`
          : `owned by ${inP.fnbOwn.toFixed(1)}% of league squads`;

      const haulTxtId =
        inP.hauls >= 2
          ? `sudah ${inP.hauls} kali meledak dua digit (puncak ${inP.maxGwPoints} pts)`
          : inP.hauls === 1
          ? `sempat mencetak skor puncak ${inP.maxGwPoints} pts`
          : `memiliki skor pekan tertinggi ${inP.maxGwPoints} pts`;
      const haulTxtEn =
        inP.hauls >= 2
          ? `already boasting ${inP.hauls} double-digit hauls (peak ${inP.maxGwPoints} pts)`
          : inP.hauls === 1
          ? `having already hit a ${inP.maxGwPoints}-pt ceiling`
          : `with a season-best ${inP.maxGwPoints} pts`;

      const deadBallNotesId: string[] = [];
      if (inP.deadBall?.isPrimaryPen) deadBallNotesId.push('algojo penalti utama');
      else if (inP.deadBall?.isSecondaryPen) deadBallNotesId.push('penendang penalti cadangan');
      if (inP.deadBall?.isCornerTaker || inP.deadBall?.isFkTaker) deadBallNotesId.push('eksekutor bola mati');
      const dbClauseId =
        deadBallNotesId.length > 0 ? ` Statusnya sebagai ${deadBallNotesId.join(' & ')} memberi jalur poin ekstra.` : '';

      const deadBallNotesEn: string[] = [];
      if (inP.deadBall?.isPrimaryPen) deadBallNotesEn.push('primary penalties');
      else if (inP.deadBall?.isSecondaryPen) deadBallNotesEn.push('backup penalties');
      if (inP.deadBall?.isCornerTaker || inP.deadBall?.isFkTaker) deadBallNotesEn.push('set-piece duties');
      const dbClauseEn =
        deadBallNotesEn.length > 0 ? ` Added ${deadBallNotesEn.join(' & ')} bolster his weekly floor.` : '';

      const attackProfileId = isInDef
        ? `${inP.cleanSheets} clean sheet${inP.goals + inP.assists > 0 ? ` ditambah ${inP.goals} gol & ${inP.assists} assist` : ''}, serta xGI ${inP.xGI.toFixed(2)} (${m.in.xGi90.toFixed(2)}/90')`
        : `${inP.goals} gol & ${inP.assists} assist dari xGI ${inP.xGI.toFixed(2)} (${m.in.xGi90.toFixed(2)}/90'), Threat ${m.in.threat90.toFixed(1)}/90', dan Creativity ${m.in.creat90.toFixed(1)}/90'`;

      const attackProfileEn = isInDef
        ? `${inP.cleanSheets} clean sheets${inP.goals + inP.assists > 0 ? ` plus ${inP.goals}G/${inP.assists}A` : ''} and ${inP.xGI.toFixed(2)} xGI (${m.in.xGi90.toFixed(2)}/90')`
        : `${inP.goals}G/${inP.assists}A from ${inP.xGI.toFixed(2)} xGI (${m.in.xGi90.toFixed(2)}/90'), ${m.in.threat90.toFixed(1)} Threat/90', and ${m.in.creat90.toFixed(1)} Creativity/90'`;

      const inVariantsId = [
        `Beralih ke ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} langsung memberi selisih +${xpDiff.toFixed(1)} pts lewat proyeksi ${m.in.effXpH.toFixed(1)} pts saat menghadapi ${inFixStr}. Ia datang bermodal ${inP.pts} poin (Form ${inP.form.toFixed(1)}, ${inP.ppg.toFixed(1)} PPG) dengan ${attackProfileId}, sekaligus ${ownTagId}.${dbClauseId}`,
        `Sebagai pengganti${hitTagId}, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m) tampil sangat menjanjikan dengan angka harapan ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts lebih tinggi) melawan ${inFixStr}. Menit bermain reguler (${inP.mins} mnt, ${inP.starts} starter) terkonversi rapi menjadi ${attackProfileId} dan ${haulTxtId}.${dbClauseId}`,
        `Kandidat paling tepat untuk mengisi slot tersebut${hitTagId} adalah ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m), yang diproyeksikan mengemas ${m.in.effXpH.toFixed(1)} pts di laga ${inFixStr}. Konsistensinya terjaga di Form ${inP.form.toFixed(1)} (${inP.ppg.toFixed(1)} PPG, total ${inP.pts} poin), ${haulTxtId}, dan kini ${ownTagId}.${dbClauseId}`,
        `Dari kacamata statistik mendasar, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} sulit dilewatkan: ${attackProfileId}. Ditopang ${inP.mins} menit tampil (${inP.starts} starter) serta Form ${inP.form.toFixed(1)}, jadwal ${inFixStr} memberinya proyeksi ${m.in.effXpH.toFixed(1)} pts—unggul +${xpDiff.toFixed(1)} pts.${dbClauseId}`,
        `Merekrut ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagId} menghadirkan kombinasi jadwal ramah (${inFixStr}) dan produktivitas tinggi (${inP.pts} pts, ${inP.ppg.toFixed(1)} PPG). Proyeksinya menyentuh ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts di atas ${outP.webName}), didukung ${haulTxtId} sambil tetap ${ownTagId}.${dbClauseId}`,
      ];

      const inVariantsEn = [
        `Switching to ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn} delivers a +${xpDiff.toFixed(1)} pts swing at ${m.in.effXpH.toFixed(1)} projected pts against ${inFixStr}. He arrives on ${inP.pts} total pts (Form ${inP.form.toFixed(1)}, ${inP.ppg.toFixed(1)} PPG) with ${attackProfileEn}, ${ownTagEn}.${dbClauseEn}`,
        `Coming in${hitTagEn}, ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m) stands out at ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts better) facing ${inFixStr}. Nailed minutes (${inP.mins} mins, ${inP.starts} starts) fuel ${attackProfileEn}, ${haulTxtEn}.${dbClauseEn}`,
        `The standout target${hitTagEn} is ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m), rated for ${m.in.effXpH.toFixed(1)} pts over ${inFixStr}. Steady Form ${inP.form.toFixed(1)} (${inP.ppg.toFixed(1)} PPG, ${inP.pts} pts), ${haulTxtEn}, while ${ownTagEn}.${dbClauseEn}`,
        `Underlying numbers strongly back ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn}: ${attackProfileEn}. Backed by ${inP.mins} mins (${inP.starts} starts) and Form ${inP.form.toFixed(1)}, ${inFixStr} lifts him to ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} pts gain).${dbClauseEn}`,
        `Bringing in ${inP.webName} (${inP.clubName}, £${inP.cost.toFixed(1)}m)${hitTagEn} pairs inviting fixtures (${inFixStr}) with proven output (${inP.pts} pts, ${inP.ppg.toFixed(1)} PPG), projecting ${m.in.effXpH.toFixed(1)} pts (+${xpDiff.toFixed(1)} over ${outP.webName}) while ${ownTagEn}.${dbClauseEn}`,
      ];

      const inIdx = (baseSeed + moveIdx) % inVariantsId.length;
      const inSentenceId = inVariantsId[inIdx];
      const inSentenceEn = inVariantsEn[inIdx];

      reasonParagraphs.push(isId ? `${outSentenceId} ${inSentenceId}` : `${outSentenceEn} ${inSentenceEn}`);
    });
  } else {
    const holdVariantsId = [
      `Skuad Anda sudah berada di posisi solid ${windowPhraseId}: ${baseXI.safeStarterCount} dari 11 starter (${baseXI.formation}) punya menit bermain aman dengan total proyeksi ${baseXI.xiXpH.toFixed(1)} pts dan dana cadangan £${round1(bankBalance).toFixed(1)}m. Menyimpan jatah ${ftAllowance} FT jauh lebih menguntungkan ketimbang memaksakan transfer yang margin keuntungannya tipis${isHitMode ? ' atau harus menebus penalti -4' : ''}.`,
      `Belum ada alasan mendesak untuk membongkar tim ${windowPhraseId}. Formasi ${baseXI.formation} sudah diisi ${baseXI.safeStarterCount}/11 pemain inti reguler yang memproyeksikan ${baseXI.xiXpH.toFixed(1)} pts dengan Bank £${round1(bankBalance).toFixed(1)}m, jadi menabung ${ftAllowance} FT memberi fleksibilitas jauh lebih besar ke depan.`,
      `Kesabaran adalah keputusan terbaik ${windowPhraseId}. Sebelas starter terbaik Anda (${baseXI.formation}, ${baseXI.xiXpH.toFixed(1)} pts proyeksi) tidak memiliki celah berarti—mengamankan ${ftAllowance} FT hari ini membuat ruang manuver di GW berikutnya kian leluasa.`,
    ];
    const holdVariantsEn = [
      `Your squad is already well positioned ${windowPhraseEn}: ${baseXI.safeStarterCount} of 11 starters (${baseXI.formation}) hold secure minutes projecting ${baseXI.xiXpH.toFixed(1)} pts with £${round1(bankBalance).toFixed(1)}m in the bank. Rolling your ${ftAllowance} FT is more valuable than forcing a marginal move${isHitMode ? ' or paying a -4 hit' : ''}.`,
      `There is no urgent fire to put out ${windowPhraseEn}. Your ${baseXI.formation} XI packs ${baseXI.safeStarterCount}/11 regular starters projecting ${baseXI.xiXpH.toFixed(1)} pts alongside £${round1(bankBalance).toFixed(1)}m ITB, making ${ftAllowance} banked FT the smart play.`,
      `Patience pays best ${windowPhraseEn}. With ${baseXI.xiXpH.toFixed(1)} projected pts from a healthy ${baseXI.formation} lineup, rolling your ${ftAllowance} FT preserves maximum flexibility for future weeks.`,
    ];
    reasonParagraphs.push(
      isId ? holdVariantsId[baseSeed % holdVariantsId.length] : holdVariantsEn[baseSeed % holdVariantsEn.length]
    );
  }

  const movesForClient: ServerScoutTransferMove[] = bestState.moves.map((m) => ({
    out: {
      id: m.out.p.id,
      webName: m.out.p.webName,
      cost: m.out.p.cost,
      sellingPrice: m.out.sellingPrice,
      effXpH: m.out.effXpH,
    },
    in: {
      id: m.in.p.id,
      webName: m.in.p.webName,
      cost: m.in.p.cost,
      effXpH: m.in.effXpH,
    },
    isHit: m.isHit,
    stepNum: m.stepNum,
  }));

  return {
    needTransfer,
    moves: movesForClient,
    netGain,
    hitCount: bestState.hitCount,
    hitCost: bestState.hitCost,
    ftUsed,
    reason: reasonParagraphs.join('\n\n'),
    reasonParagraphs,
    startXiXpH: baseXI.xiXpH,
    endXiXpH: bestState.xi.xiXpH,
    startBank: round1(bankBalance),
    endBank: round1(bestState.bank),
    startFormation: baseXI.formation,
    endFormation: bestState.xi.formation,
    horizonCount,
    horizonEndGw,
    horizonLabel,
  };
}
