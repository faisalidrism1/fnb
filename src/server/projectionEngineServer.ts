import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TransformedLeagueData,
  DbPlayerStat,
  PositionType,
  ScheduleTeamSummary,
  ScheduleFixtureSummary,
  ProjectedFixtureOutcome,
  ClubNextMatchEntry,
  ClubGwMatchProjectionItem,
  PlayerGwMatchDetail,
  PlayerGwProjectionCell,
  ProjectedSquadPlayer,
  ProjectedPlayerCoreItem,
  ServerProjectionCorePayload,
  ActualMatchReviewEntry,
  ActualPlayerReviewStat,
  ServerReviewBundlePayload,
  ServerScoutSquadsPayload,
} from '../types.ts';
import { getGameweekStatus } from '../utils/gwStatus.ts';
import {
  ClubSplitStats,
  PROJECTION_FORMULA_VERSION,
  buildClubSplitStatsMap,
  parseExpectedReturnDate,
  resolveDeadBallDuties,
} from '../utils/projectionModel.ts';
import {
  NonEplClubSideRecord,
  Stage1SnapshotForStage3,
  runFullSeasonStage3ProjectionEngine,
} from '../utils/playerXpModel.ts';
import {
  NonEplMatchScoreRecord,
  MatchScoreModelContext,
  Stage1BridgeTeamStats,
  Stage2FixtureProjection,
  StableV2SlateInput,
  fitCausalMatchScoreModel,
  predictDixonColesFixture,
  createStableV2State,
  assignStableV2SlateScores,
} from '../utils/matchScoreModel.ts';
import {
  CausalAvailability,
  HybridMatchClubSide,
  HybridTuneParams,
  PlayerFeaturesAtGw,
  buildHybridHistoryStore,
  predictHybridClubLineup,
  resolveCausalPlayerAvailability,
  selectCausalHybridParamsAndWeights,
} from '../utils/hybridLineupModel.ts';
import { getFplProvenStatus } from '../utils/fplProvenGuard.ts';
import { ALL_SEASON_FIXTURES } from '../data/allSeasonFixtures.ts';
import pastSeasonRaw from '../data/playersPastSeason2025_26.json' with { type: 'json' };
import precalculatedReviewDataRaw from '../data/precalculatedReviewMatches.json' with { type: 'json' };
import { PLAYER_EXPLOSIVE_CATALOG } from '../data/playerExplosiveCatalog.ts';
import {
  fetchAllSeasonFixturesSchedule,
  fetchMatchesForGw,
  getCachedMatchesForGw,
} from './matchesFetcher.ts';
import {
  isSpecificPulsePositionInfo,
  lookupPulsePlayerPosition,
} from './pulsePlayerPositions.ts';
import {
  getPulseAllCompHistoryDb,
  getPulseAllCompHistoryEpoch,
  getPulseAllCompScheduleDb,
} from './pulseAllCompDb.ts';

interface PastSeasonPlayerRecord {
  id: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
}

interface PrecalcMatch {
  gw: number;
  id: number;
  hShort: string;
  aShort: string;
  hScore: number | null;
  aScore: number | null;
  finished: boolean;
  kickoff: string;
}

interface PrecalcPlayerStat {
  pts: number;
  mins: number;
  wasStarter: boolean;
  wasSub: boolean;
}

interface PrecalcReviewData {
  matches: PrecalcMatch[];
  players: Record<string, Record<string, PrecalcPlayerStat>>;
}

const pastSeasonMap = pastSeasonRaw as Record<string, PastSeasonPlayerRecord>;
const precalculatedReviewData = precalculatedReviewDataRaw as PrecalcReviewData;

interface EngineClubMeta {
  id: number;
  name: string;
  short: string;
  badgeUrl: string;
}

const PREMIER_LEAGUE_CLUBS: EngineClubMeta[] = [
  { id: 1, name: 'Arsenal', short: 'ARS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t3.png' },
  { id: 2, name: 'Aston Villa', short: 'AVL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t7.png' },
  { id: 3, name: 'Bournemouth', short: 'BOU', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t91.png' },
  { id: 4, name: 'Brentford', short: 'BRE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t94.png' },
  { id: 5, name: 'Brighton', short: 'BHA', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t36.png' },
  { id: 6, name: 'Chelsea', short: 'CHE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t8.png' },
  { id: 7, name: 'Coventry City', short: 'COV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t9.png' },
  { id: 8, name: 'Crystal Palace', short: 'CRY', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t31.png' },
  { id: 9, name: 'Everton', short: 'EVE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t11.png' },
  { id: 10, name: 'Fulham', short: 'FUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t54.png' },
  { id: 11, name: 'Hull City', short: 'HUL', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t88.png' },
  { id: 12, name: 'Ipswich Town', short: 'IPS', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t40.png' },
  { id: 13, name: 'Leeds', short: 'LEE', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t2.png' },
  { id: 14, name: 'Liverpool', short: 'LIV', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t14.png' },
  { id: 15, name: 'Man City', short: 'MCI', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t43.png' },
  { id: 16, name: 'Man Utd', short: 'MUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t1.png' },
  { id: 17, name: 'Newcastle', short: 'NEW', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t4.png' },
  { id: 18, name: "Nott'm Forest", short: 'NFO', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t17.png' },
  { id: 19, name: 'Spurs', short: 'TOT', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t6.png' },
  { id: 20, name: 'Sunderland', short: 'SUN', badgeUrl: 'https://resources.premierleague.com/premierleague/badges/70/t56.png' },
];

const FORMULA_SOURCE_FILES = [
  'src/utils/projectionModel.ts',
  'src/utils/playerXpModel.ts',
  'src/utils/matchScoreModel.ts',
  'src/utils/fplProvenGuard.ts',
  'src/utils/tacticalLineupModel.ts',
  'src/utils/hybridLineupModel.ts',
  'src/utils/scoutNarratives.ts',
  'src/data/playerExplosiveCatalog.ts',
  'src/server/pulsePlayerPositions.ts',
  'src/server/projectionEngineServer.ts',
];

function buildPulsePositionInfoSeed(players: DbPlayerStat[]): Record<number, string> {
  const seed: Record<number, string> = {};
  for (const p of players) {
    const resolved = lookupPulsePlayerPosition({
      optaCode: (p as any).code || undefined,
      fplId: p.id,
      teamShort: p.teamShort,
      fullName: p.fullName,
      webName: p.webName,
      existingPositionInfo: p.pulsePositionInfo,
      existingPositionChar: p.pulsePosition,
    });
    if (resolved.positionInfo && (isSpecificPulsePositionInfo(resolved.positionInfo) || !seed[p.id])) {
      seed[p.id] = resolved.positionInfo;
    }
  }
  return seed;
}

function buildHybridExtraAllCompSides(): HybridMatchClubSide[] {
  const db = getPulseAllCompHistoryDb();
  const sides: HybridMatchClubSide[] = [];
  for (const m of Object.values(db.matches || {})) {
    if (!m || !m.finalized || m.compAbbr === 'EN_PR') continue;
    if (!m.kickoffMs || !Number.isFinite(m.kickoffMs)) continue;
    for (const s of m.sides || []) {
      if (!s?.clubShort || !Array.isArray(s.starterFplIds) || s.starterFplIds.length === 0) continue;
      const playerPosInfo: Record<number, string> = {};
      for (const p of [...(s.starters || []), ...(s.subs || [])]) {
        if (p?.fplId && p.fplId > 0 && p.positionInfo) {
          playerPosInfo[p.fplId] = p.positionInfo;
        }
      }
      sides.push({
        gw: m.eplGw ?? 0,
        eplGw: null,
        compAbbr: m.compAbbr,
        kickoffMs: m.kickoffMs,
        clubShort: s.clubShort,
        isHome: Boolean(s.isHome),
        oppShort: s.oppShort || '',
        formationLabel: s.formationLabel || undefined,
        outfieldSlots:
          Array.isArray(s.outfieldSlots) && s.outfieldSlots.length === 10
            ? s.outfieldSlots
            : undefined,
        starterIds: s.starterFplIds,
        starterRoles: s.starterRolesByFplId || {},
        subOnIds: s.subOnFplIds || [],
        unusedBenchIds: s.unusedBenchFplIds || [],
        minutesByPlayer: s.minutesByFplId || {},
        playerPosInfo,
      });
    }
  }
  return sides;
}

function buildNonEplMatchScoreRecords(): NonEplMatchScoreRecord[] {
  const db = getPulseAllCompHistoryDb();
  const records: NonEplMatchScoreRecord[] = [];
  for (const m of Object.values(db.matches || {})) {
    if (!m || !m.finalized || m.compAbbr === 'EN_PR') continue;
    if (!m.kickoffMs || !Number.isFinite(m.kickoffMs)) continue;
    for (const s of m.sides || []) {
      if (!s?.clubShort || s.teamScore === null || s.teamScore === undefined || s.oppScore === null || s.oppScore === undefined) {
        continue;
      }
      records.push({
        clubShort: s.clubShort,
        oppShort: s.oppShort || '',
        isHome: Boolean(s.isHome),
        teamScore: Number(s.teamScore),
        oppScore: Number(s.oppScore),
        kickoffMs: m.kickoffMs,
        compAbbr: m.compAbbr,
      });
    }
  }
  return records;
}

const DEFENSIVE_TACTICAL_ROLES = new Set([
  'GK',
  'RB',
  'RWB',
  'RCB',
  'CCB',
  'LCB',
  'LB',
  'LWB',
  'DM',
]);

function buildAllCompKickoffIndex(
  scheduleByGw: Record<number, ScheduleFixtureSummary[]>,
  matchesWithLineupsByGw: Record<number, any[]>
): Map<string, number[]> {
  const rawByClub = new Map<string, number[]>();
  const addKo = (clubShort: string | null | undefined, koMs: number) => {
    if (!clubShort || !Number.isFinite(koMs) || koMs <= 0) return;
    const list = rawByClub.get(clubShort) || [];
    list.push(koMs);
    rawByClub.set(clubShort, list);
  };

  const histDb = getPulseAllCompHistoryDb();
  for (const m of Object.values(histDb.matches || {})) {
    if (!m || !m.finalized || !Number.isFinite(m.kickoffMs) || m.kickoffMs <= 0) continue;
    for (const s of m.sides || []) {
      addKo(s?.clubShort, m.kickoffMs);
    }
  }

  const schedDb = getPulseAllCompScheduleDb();
  for (const f of schedDb.fixtures || []) {
    if (!f || !Number.isFinite(f.kickoffMs) || f.kickoffMs <= 0) continue;
    addKo(f.homeShort, f.kickoffMs);
    addKo(f.awayShort, f.kickoffMs);
  }

  for (const gwList of Object.values(scheduleByGw)) {
    for (const m of gwList || []) {
      const koMs = m?.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
      if (!Number.isFinite(koMs) || koMs <= 0) continue;
      addKo(m.home_team?.short_name, koMs);
      addKo(m.away_team?.short_name, koMs);
    }
  }

  for (const gwList of Object.values(matchesWithLineupsByGw)) {
    for (const m of gwList || []) {
      const koMs = m?.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
      if (!Number.isFinite(koMs) || koMs <= 0) continue;
      addKo(m.home_team?.short_name, koMs);
      addKo(m.away_team?.short_name, koMs);
    }
  }

  const deduped = new Map<string, number[]>();
  for (const [club, list] of rawByClub.entries()) {
    list.sort((a, b) => a - b);
    const out: number[] = [];
    for (const t of list) {
      if (out.length === 0 || t - out[out.length - 1] >= 6 * 3600_000) {
        out.push(t);
      }
    }
    deduped.set(club, out);
  }
  return deduped;
}

function resolveClubHoursRest(
  kickoffsByClub: Map<string, number[]>,
  clubShort: string,
  targetKoMs: number
): number {
  if (!Number.isFinite(targetKoMs) || targetKoMs <= 0) return 168;
  const list = kickoffsByClub.get(clubShort);
  if (!list || list.length === 0) return 168;
  let prevKo = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] < targetKoMs - 6 * 3600_000) {
      prevKo = list[i];
      break;
    }
  }
  if (prevKo <= 0) return 168;
  return Math.max(24, (targetKoMs - prevKo) / 3600_000);
}

interface PlayerGwMatchStatRecord {
  mins: number;
  goals: number;
  assists: number;
  cs: number;
  xgi: number;
}

function buildPlayerGwStatLookup(
  allPlayers: DbPlayerStat[],
  historicalMatchesByGw: Record<number, any[]>,
  maxGw: number
): Map<number, Map<number, PlayerGwMatchStatRecord>> {
  const byPlayer = new Map<number, Map<number, PlayerGwMatchStatRecord>>();
  for (const p of allPlayers) {
    const gMap = new Map<number, PlayerGwMatchStatRecord>();
    for (const h of p.gwHistory || []) {
      if (h.round <= maxGw) {
        const cur = gMap.get(h.round) || { mins: 0, goals: 0, assists: 0, cs: 0, xgi: 0 };
        cur.mins += Number(h.minutes || 0);
        cur.goals += Number(h.goals || 0);
        cur.assists += Number(h.assists || 0);
        cur.cs += Number(h.cleanSheets || 0);
        const hXgi = Number((h as any).expectedGoalInvolvements || 0) || (Number((h as any).expectedGoals || 0) + Number((h as any).expectedAssists || 0));
        cur.xgi += hXgi;
        gMap.set(h.round, cur);
      }
    }
    byPlayer.set(p.id, gMap);
  }

  for (let gw = 1; gw <= maxGw; gw++) {
    const matches = historicalMatchesByGw[gw] || [];
    const gwMatchAcc = new Map<number, PlayerGwMatchStatRecord>();
    for (const m of matches) {
      const hGoals = Number(m?.team_h_score ?? NaN);
      const aGoals = Number(m?.team_a_score ?? NaN);
      const addSide = (list: any[] | undefined, oppConceded: number) => {
        if (!Array.isArray(list)) return;
        for (const row of list) {
          const pid = Number(row?.id || 0);
          if (!pid) continue;
          const st = row?.stats || row;
          const mins = Number(st?.minutes ?? row?.minutes ?? 0);
          const goals = Number(st?.goals_scored ?? 0);
          const assists = Number(st?.assists ?? 0);
          const csRaw = st?.clean_sheets;
          const cs = csRaw !== undefined && csRaw !== null
            ? Number(csRaw)
            : (mins >= 60 && oppConceded === 0 ? 1 : 0);
          const xgi =
            Number(st?.expected_goal_involvements ?? 0) ||
            (Number(st?.expected_goals ?? 0) + Number(st?.expected_assists ?? 0));
          const cur = gwMatchAcc.get(pid) || { mins: 0, goals: 0, assists: 0, cs: 0, xgi: 0 };
          cur.mins += mins;
          cur.goals += goals;
          cur.assists += assists;
          cur.cs += cs;
          cur.xgi += xgi;
          gwMatchAcc.set(pid, cur);
        }
      };
      addSide(m?.home_lineup, Number.isFinite(aGoals) ? aGoals : 1);
      addSide(m?.home_bench, Number.isFinite(aGoals) ? aGoals : 1);
      addSide(m?.away_lineup, Number.isFinite(hGoals) ? hGoals : 1);
      addSide(m?.away_bench, Number.isFinite(hGoals) ? hGoals : 1);
    }
    for (const [pid, rec] of gwMatchAcc.entries()) {
      let gMap = byPlayer.get(pid);
      if (!gMap) {
        gMap = new Map();
        byPlayer.set(pid, gMap);
      }
      gMap.set(gw, rec);
    }
  }
  return byPlayer;
}

function buildCausalClubPlayerRateSnapshot(
  allPlayersByClub: Map<string, DbPlayerStat[]>,
  playerGwStats: Map<number, Map<number, PlayerGwMatchStatRecord>>,
  cutoffGw: number,
  playerPosSeed: Record<number, string>
): {
  ratesById: Map<number, { attRate: number; defScore: number; mins: number; isDefLike: boolean }>;
  clubBaseAtt: Map<string, number>;
  clubBaseDef: Map<string, number>;
} {
  const ratesById = new Map<number, { attRate: number; defScore: number; mins: number; isDefLike: boolean }>();
  const clubBaseAtt = new Map<string, number>();
  const clubBaseDef = new Map<string, number>();

  for (const [clubShort, squad] of allPlayersByClub.entries()) {
    const scoredList: Array<{ attRate: number; defScore: number; sortMins: number; isDefLike: boolean }> = [];
    for (const p of squad) {
      const gMap = playerGwStats.get(p.id);
      let mins = 0;
      let goals = 0;
      let assists = 0;
      let cs = 0;
      let xgi = 0;
      if (gMap && cutoffGw > 0) {
        for (const [g, rec] of gMap.entries()) {
          if (g <= cutoffGw) {
            mins += rec.mins;
            goals += rec.goals;
            assists += rec.assists;
            cs += rec.cs;
            xgi += rec.xgi;
          }
        }
      }

      const pos = p.position as PositionType;
      const past = pastSeasonMap[String(p.id)];
      const hasPast = Boolean(past && past.minutes >= 270);
      const posAttDef = pos === 'FWD' ? 0.42 : pos === 'MID' ? 0.25 : pos === 'DEF' ? 0.08 : 0.01;
      const posCsDef = pos === 'GKP' || pos === 'DEF' ? 0.28 : pos === 'MID' ? 0.22 : 0.14;

      const priorAtt = hasPast ? ((past!.goals_scored + past!.assists) / past!.minutes) * 90 : posAttDef;
      const priorCs = hasPast ? (past!.clean_sheets / past!.minutes) * 90 : posCsDef;

      const w = mins / (mins + 270);
      const sampleAtt = mins > 0 ? ((xgi > 0 ? xgi : goals + assists) / mins) * 90 : priorAtt;
      const sampleCs = mins > 0 ? (cs / mins) * 90 : priorCs;

      const isDefLike =
        pos === 'GKP' ||
        pos === 'DEF' ||
        /Defensive Midfielder/i.test(playerPosSeed[p.id] || '');
      const attRate = Math.max(0.01, Math.min(1.25, w * sampleAtt + (1 - w) * priorAtt));
      const defBase = pos === 'GKP' ? 0.36 : pos === 'DEF' ? 0.34 : isDefLike ? 0.20 : pos === 'MID' ? 0.09 : 0.03;
      const minsRel = cutoffGw > 0 ? Math.min(0.25, (mins / (cutoffGw * 90)) * 0.25) : 0.10;
      const defScore = Math.max(0.05, Math.min(1.15, defBase + (w * sampleCs + (1 - w) * priorCs) * 0.55 + minsRel));
      const sortMins = mins + (past?.minutes || 0) * 0.25;

      ratesById.set(p.id, { attRate, defScore, mins, isDefLike });
      scoredList.push({ attRate, defScore, sortMins, isDefLike });
    }

    scoredList.sort((a, b) => b.sortMins - a.sortMins || b.attRate - a.attRate);
    const baseXiAtt = scoredList.slice(0, 11).reduce((s, r) => s + r.attRate, 0);
    const defPool = scoredList.filter((r) => r.isDefLike);
    const baseXiDef = (defPool.length >= 5 ? defPool : scoredList).slice(0, 5).reduce((s, r) => s + r.defScore, 0);
    clubBaseAtt.set(clubShort, Math.max(0.45, baseXiAtt));
    clubBaseDef.set(clubShort, Math.max(0.45, baseXiDef));
  }

  return { ratesById, clubBaseAtt, clubBaseDef };
}

function deriveStage1BridgeStats(
  clubShort: string,
  pred: ReturnType<typeof predictHybridClubLineup>,
  snapshot: ReturnType<typeof buildCausalClubPlayerRateSnapshot>,
  hoursRest: number
): Stage1BridgeTeamStats {
  const baseAtt = snapshot.clubBaseAtt.get(clubShort) ?? 2.2;
  const baseDef = snapshot.clubBaseDef.get(clubShort) ?? 2.2;

  let xiAttSum = 0;
  let xiDefSum = 0;
  let defCount = 0;
  let fatSum = 0;

  for (const id of pred.starterIds) {
    const r = snapshot.ratesById.get(id);
    if (r) {
      xiAttSum += r.attRate;
      if (r.isDefLike && defCount < 6) {
        xiDefSum += r.defScore;
        defCount++;
      }
    }
    const pr = pred.playerProbs.get(id);
    if (pr && (pr.feat.fatigue72h || 0) > 0) {
      fatSum += 1;
    }
  }

  let defAffSum = 0;
  let defAffCnt = 0;
  for (const sa of pred.slotAssignments) {
    if (DEFENSIVE_TACTICAL_ROLES.has(sa.slot)) {
      defAffSum += sa.affinity;
      defAffCnt++;
    }
  }

  const xiAttDelta = Math.max(-0.35, Math.min(0.35, (xiAttSum - baseAtt) / Math.max(0.45, baseAtt)));
  const xiDefStrength = Math.max(-0.35, Math.min(0.35, (xiDefSum - baseDef) / Math.max(0.45, baseDef)));
  const minDefAff = defAffCnt > 0 ? defAffSum / defAffCnt : 0.88;
  const starterFatShare = pred.starterIds.length > 0 ? fatSum / pred.starterIds.length : 0;
  const isCongested72h = hoursRest <= 72;
  const fatigue72hShare = isCongested72h ? Math.max(starterFatShare, 0.35) : starterFatShare;

  return {
    xiAttDelta,
    xiDefStrength,
    minDefAff,
    fatigue72hShare,
    hoursRest,
    isCongested72h,
  };
}

let cachedFormulaFingerprint: string | null = null;
let lastFormulaStatCheckMs = 0;
let lastFormulaMtimesKey = '';

/**
 * Computes a deterministic short SHA-256 fingerprint across all projection/scout formula files.
 * Automatically detects code edits OR rollbacks (even if PROJECTION_FORMULA_VERSION stayed identical)
 * and invalidates in-memory server projection caches immediately.
 */
export function getProjectionFormulaFingerprint(): string {
  const now = Date.now();
  const isProd = process.env.NODE_ENV === 'production';
  if (cachedFormulaFingerprint && (isProd || now - lastFormulaStatCheckMs < 400)) {
    return cachedFormulaFingerprint;
  }
  lastFormulaStatCheckMs = now;

  try {
    const cwd = process.cwd();
    const mtimeParts: string[] = [];
    const existingFiles: string[] = [];

    for (const relPath of FORMULA_SOURCE_FILES) {
      const fullPath = path.join(cwd, relPath);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        mtimeParts.push(`${relPath}:${stat.mtimeMs}:${stat.size}`);
        existingFiles.push(fullPath);
      }
    }

    const mtimesKey = mtimeParts.join('|');
    if (cachedFormulaFingerprint && mtimesKey === lastFormulaMtimesKey) {
      return cachedFormulaFingerprint;
    }

    const hash = crypto.createHash('sha256');
    hash.update(PROJECTION_FORMULA_VERSION);
    for (const fullPath of existingFiles) {
      hash.update(path.basename(fullPath));
      hash.update(fs.readFileSync(fullPath));
    }

    const nextFingerprint = existingFiles.length > 0
      ? hash.digest('hex').slice(0, 10)
      : 'bundle';

    const prevFingerprint = cachedFormulaFingerprint;
    cachedFormulaFingerprint = nextFingerprint;
    lastFormulaMtimesKey = mtimesKey;

    if (prevFingerprint && prevFingerprint !== nextFingerprint) {
      invalidateProjectionEngine(`formula source changed (${prevFingerprint} -> ${nextFingerprint})`);
    }
    return nextFingerprint;
  } catch {
    if (!cachedFormulaFingerprint) {
      cachedFormulaFingerprint = 'static';
    }
    return cachedFormulaFingerprint;
  }
}

export interface ProjectionEpochInfo {
  epochKey: string;
  lifecycleStatus: string;
  isCurrentGwFinishedOrConfirmed: boolean;
  baseHistoricalGW: number;
  targetNextGW: number;
  maxReviewGW: number;
}

/**
 * Deterministic epoch key used to enforce STRICT sync only on:
 *   - Live -> Provisional (epochKey changes from `N-1:Confirmed:...` to `N:Provisional:...`)
 *   - Provisional -> Confirmed (epochKey changes from `N:Provisional:...` to `N:Confirmed:...`)
 *   - Projection/Scout formula edit or rollback (`formulaFingerprint` shifts immediately)
 *   - Cold start / full GW shift where cache is empty
 *
 * Notice:
 *   - During GW `N` Live ticks (every 30-60s): epoch stays `N-1:Confirmed:...` -> ZERO recompute!
 *   - When GW `N` Confirmed rolls over to GW `N+1` Not Started: epoch stays `N:Confirmed:...` -> ZERO recompute!
 *   - When GW `N+1` Not Started kicks off to Live: epoch stays `N:Confirmed:...` -> ZERO recompute!
 */
export function computeProjectionEpochInfo(cachedData: TransformedLeagueData | null | undefined): ProjectionEpochInfo {
  const available =
    Array.isArray(cachedData?.available_gws) && cachedData!.available_gws.length > 0
      ? cachedData!.available_gws
      : [1];
  const curr = cachedData?.current_gw || Math.max(...available, 1);
  const evStatus =
    cachedData?.events_status?.[curr] ||
    (cachedData?.gw_status?.event === curr ? cachedData.gw_status : undefined);

  const lifecycleStatus = getGameweekStatus(curr, curr, evStatus, cachedData?.sync_status).status;
  const isCurrentGwFinishedOrConfirmed =
    lifecycleStatus === 'Confirmed' || lifecycleStatus === 'Provisional';

  let baseHistoricalGW: number;
  if (isCurrentGwFinishedOrConfirmed) {
    baseHistoricalGW = Math.min(Math.max(...available, curr), 38);
  } else {
    const completed = available.filter((gw) => {
      const st = cachedData?.events_status?.[gw];
      return gw < curr || st?.status === 'Confirmed' || st?.finished === true;
    });
    baseHistoricalGW = completed.length > 0 ? Math.max(...completed) : Math.max(curr - 1, 1);
  }
  baseHistoricalGW = Math.min(Math.max(baseHistoricalGW, 1), 38);

  const maxReviewGW = baseHistoricalGW;
  const targetNextGW = Math.min(baseHistoricalGW + 1, 38);
  const effectiveEpochStatus =
    baseHistoricalGW === curr && lifecycleStatus === 'Provisional' ? 'Provisional' : 'Confirmed';
  const formulaFingerprint = getProjectionFormulaFingerprint();
  const allCompEpoch = getPulseAllCompHistoryEpoch();
  const epochKey = `${baseHistoricalGW}:${effectiveEpochStatus}:${PROJECTION_FORMULA_VERSION}:${formulaFingerprint}:ac${allCompEpoch}`;

  return {
    epochKey,
    lifecycleStatus,
    isCurrentGwFinishedOrConfirmed,
    baseHistoricalGW,
    targetNextGW,
    maxReviewGW,
  };
}

// ============================================================================
// SERVER MEMORY CACHES & IN-FLIGHT DEDUP
// ============================================================================
interface CoreRuntimeContext {
  epoch: ProjectionEpochInfo;
  corePayload: ServerProjectionCorePayload;
  matchesWithLineupsByGw: Record<number, any[]>;
  clubStatsMap: Record<string, ClubSplitStats>;
  leagueAvgHomeGoals: number;
  leagueAvgAwayGoals: number;
  playerPosSeed: Record<number, string>;
  playerTeamMap: Map<number, string>;
  extraAllCompSides: HybridMatchClubSide[];
  calibByGw: Map<number, { params: HybridTuneParams; logitWeights: number[]; targetFeatMap?: Map<number, PlayerFeaturesAtGw> }>;
}

let cachedCoreContext: CoreRuntimeContext | null = null;
let inFlightCoreBuild: { epochKey: string; promise: Promise<CoreRuntimeContext> } | null = null;

interface ReviewBaseCache {
  epochKey: string;
  actualMatchLookup: Record<string, ActualMatchReviewEntry[]>;
  actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>>;
  maeRecapRows: any[];
  lineupByGwCache: Map<number, { lineupReviewPerClub: Record<string, any[]>; lineupGwSummary: any }>;
}

let cachedReviewBase: ReviewBaseCache | null = null;
let inFlightReviewBuild: { epochKey: string; promise: Promise<ReviewBaseCache> } | null = null;
// Finished-GW MAE rows survive epoch bumps when GW <= N-1 and already Confirmed!
const confirmedMaeRowCache = new Map<number, { epochBaseGw: number; row: any }>();

let cachedScoutPayload: ServerScoutSquadsPayload | null = null;
let inFlightScoutBuild: { epochKey: string; promise: Promise<ServerScoutSquadsPayload> } | null = null;

export function hasProjectionCoreCache(): boolean {
  return cachedCoreContext !== null;
}

export function hasProjectionScoutCache(): boolean {
  return cachedScoutPayload !== null;
}

export function getProjectionCacheEpochKey(): string | null {
  return cachedCoreContext?.epoch.epochKey ?? null;
}

export function invalidateProjectionEngine(reason?: string): void {
  cachedCoreContext = null;
  inFlightCoreBuild = null;
  cachedReviewBase = null;
  inFlightReviewBuild = null;
  cachedScoutPayload = null;
  inFlightScoutBuild = null;
  confirmedMaeRowCache.clear();
  if (reason) {
    console.log(`[ProjectionEngine] Cache invalidated (${reason})`);
  }
}

export function warmProjectionEngineIfNeeded(cachedData: TransformedLeagueData | null): void {
  if (!cachedData) return;
  const epochInfo = computeProjectionEpochInfo(cachedData);
  const coreWarm = Boolean(cachedCoreContext && cachedCoreContext.epoch.epochKey === epochInfo.epochKey);
  const scoutWarm = Boolean(cachedScoutPayload && cachedScoutPayload.epochKey === epochInfo.epochKey);
  if (coreWarm && scoutWarm) {
    return;
  }
  const warmTask = coreWarm
    ? getServerScoutSquads(cachedData, false)
    : getOrBuildCoreContext(cachedData, false).then(() => getServerScoutSquads(cachedData, false));

  warmTask
    .then(() => {
      console.log(`[ProjectionEngine] Background warm completed (Core + Scout Squads) for epoch ${epochInfo.epochKey}`);
    })
    .catch((err: any) => {
      console.warn(`[ProjectionEngine] Background warm warning:`, err?.message || err);
    });
}

// ============================================================================
// CLUB METADATA & SCHEDULE UNIFICATION (DGW / BGW / LIVE RESCHEDULED AWARE)
// ============================================================================
function buildClubsList(
  cachedData: TransformedLeagueData,
  scheduleTeams?: ScheduleTeamSummary[]
): Array<{ id: number; name: string; short: string; badgeUrl: string }> {
  const fallbackByShort = new Map(PREMIER_LEAGUE_CLUBS.map((c) => [c.short, c]));
  const badgeByShort = new Map<string, string>();
  const badgeById = new Map<number, string>();

  for (const c of PREMIER_LEAGUE_CLUBS) {
    badgeByShort.set(c.short, c.badgeUrl);
    badgeById.set(c.id, c.badgeUrl);
  }
  if (cachedData?.ownership_clubs) {
    for (const gwClubs of Object.values(cachedData.ownership_clubs)) {
      if (!Array.isArray(gwClubs)) continue;
      for (const c of gwClubs) {
        if (c.badge_url) {
          if (c.short_name) badgeByShort.set(c.short_name, c.badge_url);
          if (c.club_id) badgeById.set(c.club_id, c.badge_url);
        }
      }
    }
  }

  const sourceTeams: Array<{ id: number; name: string; short_name: string }> =
    scheduleTeams && scheduleTeams.length >= 20
      ? scheduleTeams
      : PREMIER_LEAGUE_CLUBS.map((c) => ({ id: c.id, name: c.name, short_name: c.short }));

  return sourceTeams.map((t) => {
    const fb = fallbackByShort.get(t.short_name);
    return {
      id: t.id,
      name: t.name || fb?.name || t.short_name,
      short: t.short_name,
      badgeUrl: badgeByShort.get(t.short_name) || badgeById.get(t.id) || fb?.badgeUrl || '',
    };
  });
}

async function buildUnifiedScheduleAndLineups(
  cachedData: TransformedLeagueData,
  epoch: ProjectionEpochInfo,
  force: boolean
): Promise<{
  clubs: Array<{ id: number; name: string; short: string; badgeUrl: string }>;
  scheduleByGw: Record<number, ScheduleFixtureSummary[]>;
  matchesWithLineupsByGw: Record<number, any[]>;
}> {
  const maxDetailGw = Math.min(Math.max(epoch.targetNextGW, epoch.baseHistoricalGW), 38);
  const gwsToLoad = Array.from({ length: maxDetailGw }, (_, i) => i + 1);

  const [liveSchedule, ...gwMatchResults] = await Promise.all([
    fetchAllSeasonFixturesSchedule(force).catch(() => null),
    ...gwsToLoad.map(async (gw) => {
      if (!force) {
        const mem = getCachedMatchesForGw(gw);
        if (mem && mem.length > 0) return { gw, matches: mem };
      }
      const fetched = await fetchMatchesForGw(gw).catch(() => null);
      return { gw, matches: fetched || [] };
    }),
  ]);

  const clubs = buildClubsList(cachedData, liveSchedule?.teams);
  const clubInfoByShort = new Map(clubs.map((c) => [c.short, c]));

  const matchesWithLineupsByGw: Record<number, any[]> = {};
  for (const item of gwMatchResults) {
    if (item && Array.isArray(item.matches) && item.matches.length > 0) {
      matchesWithLineupsByGw[item.gw] = item.matches;
    }
  }

  // Merge sync_status.gw_fixtures for fast live overlay
  const syncFixByGw = new Map<number, Map<string, any>>();
  if (Array.isArray(cachedData?.sync_status?.gw_fixtures)) {
    for (const f of cachedData.sync_status.gw_fixtures) {
      const gw = Number(f?.event);
      if (!gw || !f.home_team || !f.away_team) continue;
      if (!syncFixByGw.has(gw)) syncFixByGw.set(gw, new Map());
      syncFixByGw.get(gw)!.set(`${f.home_team}_${f.away_team}`, f);
    }
  }

  const precalcByGw = new Map<number, PrecalcMatch[]>();
  for (const pm of precalculatedReviewData.matches) {
    if (!precalcByGw.has(pm.gw)) precalcByGw.set(pm.gw, []);
    precalcByGw.get(pm.gw)!.push(pm);
  }

  const scheduleByGw: Record<number, ScheduleFixtureSummary[]> = {};
  for (let gw = 1; gw <= 38; gw++) {
    const liveSchedList = liveSchedule?.matchesByGW?.[gw];
    const detailedList = matchesWithLineupsByGw[gw];

    let rawList: ScheduleFixtureSummary[] = [];

    if (liveSchedList) {
      // Live FPL /api/fixtures/ is the canonical schedule source (naturally handles postponed BGW & DGW)
      rawList = liveSchedList.map((f) => ({ ...f }));
    } else if (detailedList && detailedList.length > 0) {
      rawList = detailedList.map((m: any) => ({
        id: Number(m.id || 0),
        event: gw,
        kickoff_time: m.kickoff_time,
        started: Boolean(m.started),
        finished: Boolean(m.finished),
        finished_provisional: Boolean(m.finished_provisional),
        team_h_score: m.team_h_score ?? null,
        team_a_score: m.team_a_score ?? null,
        home_team: m.home_team,
        away_team: m.away_team,
      }));
    } else {
      const staticList = (ALL_SEASON_FIXTURES as Record<number, any[]>)[gw] || [];
      rawList = staticList.map((m: any) => ({
        id: Number(m.id || 0),
        event: gw,
        kickoff_time: m.kickoff_time,
        started: Boolean(m.started),
        finished: Boolean(m.finished),
        finished_provisional: Boolean(m.finished_provisional),
        team_h_difficulty: m.team_h_difficulty,
        team_a_difficulty: m.team_a_difficulty,
        team_h_score: m.team_h_score ?? null,
        team_a_score: m.team_a_score ?? null,
        home_team: {
          id: m.home_team?.id || clubInfoByShort.get(m.home_team?.short_name)?.id || 0,
          name: m.home_team?.name || clubInfoByShort.get(m.home_team?.short_name)?.name || m.home_team?.short_name || '',
          short_name: m.home_team?.short_name || '',
        },
        away_team: {
          id: m.away_team?.id || clubInfoByShort.get(m.away_team?.short_name)?.id || 0,
          name: m.away_team?.name || clubInfoByShort.get(m.away_team?.short_name)?.name || m.away_team?.short_name || '',
          short_name: m.away_team?.short_name || '',
        },
      }));
    }

    // Overlay authoritative detailed/sync/precalc scores onto schedule items
    const detailByKey = new Map<string, any>();
    if (detailedList) {
      for (const m of detailedList) {
        const hs = m.home_team?.short_name;
        const as = m.away_team?.short_name;
        if (hs && as) detailByKey.set(`${hs}_${as}`, m);
      }
    }
    const syncMap = syncFixByGw.get(gw);
    const precalcMap = new Map((precalcByGw.get(gw) || []).map((pm) => [`${pm.hShort}_${pm.aShort}`, pm]));

    for (const fix of rawList) {
      const key = `${fix.home_team.short_name}_${fix.away_team.short_name}`;
      const det = detailByKey.get(key);
      if (det) {
        fix.started = fix.started || Boolean(det.started);
        fix.finished = fix.finished || Boolean(det.finished);
        fix.finished_provisional = fix.finished_provisional || Boolean(det.finished_provisional);
        if (fix.team_h_score == null && det.team_h_score != null) fix.team_h_score = det.team_h_score;
        if (fix.team_a_score == null && det.team_a_score != null) fix.team_a_score = det.team_a_score;
        if (!fix.kickoff_time && det.kickoff_time) fix.kickoff_time = det.kickoff_time;
      }
      const sf = syncMap?.get(key);
      if (sf) {
        fix.started = fix.started || Boolean(sf.started);
        fix.finished = fix.finished || Boolean(sf.finished);
        fix.finished_provisional = fix.finished_provisional || Boolean(sf.finished_provisional);
        if (fix.team_h_score == null && sf.team_h_score != null) fix.team_h_score = sf.team_h_score;
        if (fix.team_a_score == null && sf.team_a_score != null) fix.team_a_score = sf.team_a_score;
        if (fix.team_h_difficulty == null && sf.team_h_difficulty != null) fix.team_h_difficulty = sf.team_h_difficulty;
        if (fix.team_a_difficulty == null && sf.team_a_difficulty != null) fix.team_a_difficulty = sf.team_a_difficulty;
      }
      const pm = precalcMap.get(key);
      if (pm && gw <= epoch.baseHistoricalGW) {
        fix.finished = fix.finished || Boolean(pm.finished);
        if (fix.team_h_score == null && pm.hScore != null) fix.team_h_score = pm.hScore;
        if (fix.team_a_score == null && pm.aScore != null) fix.team_a_score = pm.aScore;
        if (!fix.kickoff_time && pm.kickoff) fix.kickoff_time = pm.kickoff;
      }
    }

    rawList.sort((a, b) => {
      const ta = a.kickoff_time ? Date.parse(a.kickoff_time) : 0;
      const tb = b.kickoff_time ? Date.parse(b.kickoff_time) : 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    scheduleByGw[gw] = rawList;
  }

  return { clubs, scheduleByGw, matchesWithLineupsByGw };
}

// ============================================================================
// CORE ENGINE: PROJECTION CONTEXT (MATCHES, CLUB STATS, LINEUPS, PLAYER xP)
// ============================================================================
async function getOrBuildCoreContext(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<CoreRuntimeContext> {
  const epoch = computeProjectionEpochInfo(cachedData);

  if (!force && cachedCoreContext && cachedCoreContext.epoch.epochKey === epoch.epochKey) {
    return cachedCoreContext;
  }

  if (!force && inFlightCoreBuild && inFlightCoreBuild.epochKey === epoch.epochKey) {
    return inFlightCoreBuild.promise;
  }

  const buildPromise = (async (): Promise<CoreRuntimeContext> => {
    const startMs = Date.now();
    const { baseHistoricalGW, targetNextGW, isCurrentGwFinishedOrConfirmed } = epoch;

    const { clubs, scheduleByGw, matchesWithLineupsByGw } = await buildUnifiedScheduleAndLineups(
      cachedData,
      epoch,
      force
    );

    // 1. Build merged historical matches map for club stats (prefers Pulse/live, overlays schedule + precalc)
    const historicalMatchesForStats: Record<number, any[]> = {};
    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      if (matchesWithLineupsByGw[gw] && matchesWithLineupsByGw[gw].length > 0) {
        historicalMatchesForStats[gw] = matchesWithLineupsByGw[gw];
      } else if (scheduleByGw[gw] && scheduleByGw[gw].length > 0) {
        historicalMatchesForStats[gw] = scheduleByGw[gw];
      }
    }

    const { clubStatsMap, leagueAvgHomeGoals, leagueAvgAwayGoals } = buildClubSplitStatsMap(
      clubs,
      cachedData.player_stats || [],
      historicalMatchesForStats,
      baseHistoricalGW
    );

    // Build club next matches directly from scheduleByGw[targetNextGW] BEFORE Stage 1
    const clubNameByShort = new Map(clubs.map((c) => [c.short, c.name]));
    const clubNextMatchesMap: Record<string, ClubNextMatchEntry[]> = {};
    const clubGwMatchProjections: Record<string, ClubGwMatchProjectionItem[]> = {};
    for (const c of clubs) {
      clubNextMatchesMap[c.short] = [];
      for (let gw = 1; gw <= 38; gw++) {
        clubGwMatchProjections[`${c.short}_${gw}`] = [];
      }
    }
    for (const m of scheduleByGw[targetNextGW] || []) {
      const hShort = m.home_team?.short_name || '';
      const aShort = m.away_team?.short_name || '';
      if (!hShort || !aShort) continue;
      if (!clubNextMatchesMap[hShort]) clubNextMatchesMap[hShort] = [];
      if (!clubNextMatchesMap[aShort]) clubNextMatchesMap[aShort] = [];
      clubNextMatchesMap[hShort].push({
        fixtureId: m.id,
        opponentShort: aShort,
        opponentName: m.away_team?.name || clubNameByShort.get(aShort) || aShort,
        isHome: true,
        kickoffTime: m.kickoff_time || '',
      });
      clubNextMatchesMap[aShort].push({
        fixtureId: m.id,
        opponentShort: hShort,
        opponentName: m.home_team?.name || clubNameByShort.get(hShort) || hShort,
        isHome: false,
        kickoffTime: m.kickoff_time || '',
      });
    }

    // Extract matchday participation stats (GW 1..baseHistoricalGW) before Stage 1/3
    const pulsePlayerStats: Record<number, { starts: number; sub: number; unused: number; bench: number }> = {};
    const clubMatchCount: Record<string, number> = {};
    const liveCoveredMatchKeySet = new Set<string>();
    const liveCoveredPlayerGwSet = new Set<string>();
    const livePtsByPlayerGw = new Map<number, Map<number, number>>();

    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      const matches = matchesWithLineupsByGw[gw] || [];
      for (const m of matches) {
        const hShort = m.home_team?.short_name;
        const aShort = m.away_team?.short_name;
        const hasLineup = Array.isArray(m.home_lineup) && m.home_lineup.length > 0;
        if (!hasLineup) continue;

        if (m.id) liveCoveredMatchKeySet.add(`${gw}_${m.id}`);
        if (hShort && aShort) liveCoveredMatchKeySet.add(`${gw}_${hShort}_${aShort}`);
        if (hShort) clubMatchCount[hShort] = (clubMatchCount[hShort] || 0) + 1;
        if (aShort) clubMatchCount[aShort] = (clubMatchCount[aShort] || 0) + 1;

        for (const p of [...m.home_lineup, ...(Array.isArray(m.away_lineup) ? m.away_lineup : [])]) {
          if (!p?.id) continue;
          if (!pulsePlayerStats[p.id]) pulsePlayerStats[p.id] = { starts: 0, sub: 0, unused: 0, bench: 0 };
          pulsePlayerStats[p.id].starts += 1;
          liveCoveredPlayerGwSet.add(`${p.id}_${gw}`);

          const pts = typeof p.gw_points === 'number' ? p.gw_points : Number(p.stats?.total_points ?? 0);
          if (!livePtsByPlayerGw.has(p.id)) livePtsByPlayerGw.set(p.id, new Map());
          const gMap = livePtsByPlayerGw.get(p.id)!;
          gMap.set(gw, (gMap.get(gw) || 0) + pts);
        }

        for (const p of [
          ...(Array.isArray(m.home_bench) ? m.home_bench : []),
          ...(Array.isArray(m.away_bench) ? m.away_bench : []),
        ]) {
          if (!p?.id) continue;
          if (!pulsePlayerStats[p.id]) pulsePlayerStats[p.id] = { starts: 0, sub: 0, unused: 0, bench: 0 };
          const mins = p.stats?.minutes ?? p.minutes ?? 0;
          if (mins > 0) pulsePlayerStats[p.id].sub += 1;
          else pulsePlayerStats[p.id].unused += 1;
          pulsePlayerStats[p.id].bench += 1;
          liveCoveredPlayerGwSet.add(`${p.id}_${gw}`);

          const pts = typeof p.gw_points === 'number' ? p.gw_points : Number(p.stats?.total_points ?? 0);
          if (!livePtsByPlayerGw.has(p.id)) livePtsByPlayerGw.set(p.id, new Map());
          const gMap = livePtsByPlayerGw.get(p.id)!;
          gMap.set(gw, (gMap.get(gw) || 0) + pts);
        }
      }
    }

    const fallbackMatchGwSet = new Set<number>();
    for (const pm of precalculatedReviewData.matches) {
      if (pm.gw > baseHistoricalGW || !pm.finished) continue;
      if (
        liveCoveredMatchKeySet.has(`${pm.gw}_${pm.id}`) ||
        liveCoveredMatchKeySet.has(`${pm.gw}_${pm.hShort}_${pm.aShort}`)
      ) {
        continue;
      }
      fallbackMatchGwSet.add(pm.gw);
      clubMatchCount[pm.hShort] = (clubMatchCount[pm.hShort] || 0) + 1;
      clubMatchCount[pm.aShort] = (clubMatchCount[pm.aShort] || 0) + 1;
    }

    for (const [idStr, gws] of Object.entries(precalculatedReviewData.players)) {
      const pId = Number(idStr);
      for (const [gwStr, stat] of Object.entries(gws)) {
        const gw = Number(gwStr);
        if (gw > baseHistoricalGW || liveCoveredPlayerGwSet.has(`${pId}_${gw}`) || !fallbackMatchGwSet.has(gw)) {
          continue;
        }
        if (!pulsePlayerStats[pId]) pulsePlayerStats[pId] = { starts: 0, sub: 0, unused: 0, bench: 0 };
        if (stat.wasStarter) pulsePlayerStats[pId].starts += 1;
        else if (stat.wasSub) {
          pulsePlayerStats[pId].sub += 1;
          pulsePlayerStats[pId].bench += 1;
        } else {
          pulsePlayerStats[pId].unused += 1;
          pulsePlayerStats[pId].bench += 1;
        }
      }
    }

    for (const c of clubs) {
      if (!clubMatchCount[c.short]) {
        clubMatchCount[c.short] = clubStatsMap[c.short]?.totalMatches || baseHistoricalGW;
      }
    }

    // Dynamic Explosive Hauls per player
    const dynamicExplosiveById = new Map<number, { hauls: number; maxPts: number; haulRate: number }>();
    const allPlayers = (cachedData.player_stats || []).filter((p) => p.status !== 'u');

    for (const p of allPlayers) {
      const gwPts = new Map<number, number>();
      const liveMap = livePtsByPlayerGw.get(p.id);
      if (liveMap) {
        for (const [gw, pts] of liveMap.entries()) gwPts.set(gw, pts);
      }
      for (const h of p.gwHistory || []) {
        if (h.round <= baseHistoricalGW && !gwPts.has(h.round)) {
          gwPts.set(h.round, Number(h.points || 0));
        }
      }

      const expProfile = PLAYER_EXPLOSIVE_CATALOG[p.id];
      const earlyGwsMissing = Array.from({ length: Math.min(8, baseHistoricalGW) }, (_, i) => i + 1).some(
        (g) => !gwPts.has(g)
      );

      let hauls = 0;
      let maxPts = 0;
      let sampleGws = gwPts.size;

      if (earlyGwsMissing && expProfile) {
        hauls = expProfile.hauls;
        maxPts = expProfile.maxPts;
        let extraGws = 0;
        for (const [gw, pts] of gwPts.entries()) {
          if (gw > 8) {
            extraGws++;
            if (pts >= 10) hauls++;
            if (pts > maxPts) maxPts = pts;
          }
        }
        sampleGws = Math.max(8 + extraGws, baseHistoricalGW, 1);
      } else {
        for (const pts of gwPts.values()) {
          if (pts >= 10) hauls++;
          if (pts > maxPts) maxPts = pts;
        }
        hauls = Math.max(hauls, Number((p as any).doubleDigitHauls || 0));
        maxPts = Math.max(maxPts, Number((p as any).maxGwPoints || 0));
        sampleGws = Math.max(sampleGws, baseHistoricalGW, 1);
      }

      const haulRate =
        hauls > 0
          ? Math.round((hauls / Math.max(sampleGws, 1)) * 100)
          : (expProfile?.haulRate ?? Number((p as any).haulRate || 0));
      dynamicExplosiveById.set(p.id, { hauls, maxPts, haulRate });
    }

    // =========================================================================
    // STAGE 1 (STRICTLY UPSTREAM OF STAGE 2): HYBRID LINEUP, ROLES & <72H REST
    // =========================================================================
    const N = Math.max(baseHistoricalGW, 1);
    const deadlines = cachedData.sync_status?.deadlines;
    const playerPosSeed = buildPulsePositionInfoSeed(allPlayers);
    const playerTeamMap = new Map<number, string>(allPlayers.map((p) => [p.id, p.teamShort]));
    const extraAllCompSides = buildHybridExtraAllCompSides();
    const clubShorts = clubs.map((c) => c.short);
    const kickoffsByClub = buildAllCompKickoffIndex(scheduleByGw, matchesWithLineupsByGw);

    const allPlayersByClub = new Map<string, DbPlayerStat[]>();
    for (const p of allPlayers) {
      if (!allPlayersByClub.has(p.teamShort)) allPlayersByClub.set(p.teamShort, []);
      allPlayersByClub.get(p.teamShort)!.push(p);
    }

    const playerGwStatsLookup = buildPlayerGwStatLookup(allPlayers, historicalMatchesForStats, baseHistoricalGW);

    // 1A. Historical Walk-Forward Stage 1 (GW 1..baseHistoricalGW)
    const calibByGw = new Map<number, { params: HybridTuneParams; logitWeights: number[]; targetFeatMap?: Map<number, PlayerFeaturesAtGw> }>();
    const s1BridgeByGwClub = new Map<string, Stage1BridgeTeamStats>();
    const stage1ByGwClub = new Map<string, Stage1SnapshotForStage3>();

    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      const gwHistory = buildHybridHistoryStore(
        historicalMatchesForStats,
        gw - 1,
        playerPosSeed,
        precalculatedReviewData.players,
        playerTeamMap,
        extraAllCompSides
      );

      const gwMatchByClub = new Map<string, { kickoffIso?: string; kickoffMs: number; isHome: boolean }>();
      for (const m of scheduleByGw[gw] || []) {
        const koIso = m.kickoff_time || deadlines?.[String(gw)];
        const koMs = koIso ? Date.parse(koIso) : NaN;
        const resolvedMs = Number.isFinite(koMs) && koMs > 0 ? koMs : Date.now();
        const hs = m.home_team?.short_name;
        const as = m.away_team?.short_name;
        if (hs && !gwMatchByClub.has(hs)) gwMatchByClub.set(hs, { kickoffIso: m.kickoff_time, kickoffMs: resolvedMs, isHome: true });
        if (as && !gwMatchByClub.has(as)) gwMatchByClub.set(as, { kickoffIso: m.kickoff_time, kickoffMs: resolvedMs, isHome: false });
      }

      const gwTargetCutoffByClub: Record<string, number> = {};
      for (const c of clubs) {
        const rec = gwMatchByClub.get(c.short);
        const dlMs = deadlines?.[String(gw)] ? Date.parse(deadlines[String(gw)]) : NaN;
        if (rec?.kickoffMs) gwTargetCutoffByClub[c.short] = rec.kickoffMs;
        else if (Number.isFinite(dlMs) && dlMs > 0) gwTargetCutoffByClub[c.short] = dlMs;
      }

      const gwCalib = selectCausalHybridParamsAndWeights(
        allPlayers,
        clubShorts,
        gw,
        gwHistory,
        pastSeasonMap,
        deadlines,
        gwTargetCutoffByClub
      );
      calibByGw.set(gw, gwCalib);

      const rateSnapshot = buildCausalClubPlayerRateSnapshot(allPlayersByClub, playerGwStatsLookup, gw - 1, playerPosSeed);
      const dlIso = deadlines?.[String(gw)];

      for (const c of clubs) {
        const cPlayers = allPlayersByClub.get(c.short) || [];
        const mMeta = gwMatchByClub.get(c.short);
        const avMap = new Map<number, CausalAvailability>();
        for (const p of cPlayers) {
          avMap.set(
            p.id,
            resolveCausalPlayerAvailability({
              player: p,
              targetGw: gw,
              mode: 'historical',
              earliestKickoffIso: mMeta?.kickoffIso,
              gwDeadlineIso: dlIso,
            })
          );
        }

        const pred = predictHybridClubLineup({
          clubShort: c.short,
          targetGw: gw,
          targetCutoffMs: gwTargetCutoffByClub[c.short],
          isHome: mMeta?.isHome,
          players: cPlayers,
          availabilityById: avMap,
          history: gwHistory,
          pastMap: pastSeasonMap,
          logitWeights: gwCalib.logitWeights,
          params: gwCalib.params,
          precomputedFeatMap: gwCalib.targetFeatMap,
        });

        const koMs = gwTargetCutoffByClub[c.short] || 0;
        const hrsRest = resolveClubHoursRest(kickoffsByClub, c.short, koMs);
        s1BridgeByGwClub.set(`${gw}_${c.short}`, deriveStage1BridgeStats(c.short, pred, rateSnapshot, hrsRest));

        const siByPlayer = new Map<number, number>();
        const baseSiByPlayer = new Map<number, number>();
        const midweekProofByPlayer = new Map<number, boolean>();
        const nonEplMins7dByPlayer = new Map<number, number>();
        for (const [pid, info] of pred.playerProbs.entries()) {
          siByPlayer.set(pid, info.si);
          baseSiByPlayer.set(pid, info.baseSi);
          if (info.feat?.fatigue72h && info.feat.fatigue72h > 0) {
            nonEplMins7dByPlayer.set(pid, Math.round(info.feat.fatigue72h * 90));
          }
        }
        stage1ByGwClub.set(`${gw}_${c.short}`, {
          starterIds: new Set(pred.starterIds),
          benchIds: new Set(pred.benchIds),
          siByPlayer,
          baseSiByPlayer,
          midweekProofByPlayer,
          nonEplMins7dByPlayer,
          availabilityById: avMap,
        });
      }
    }

    // 1B. Target GW Stage 1 (targetNextGW: Club Squad Projections + Stage 1 Bridge Stats)
    const clubSquadProjections: Record<string, ProjectedSquadPlayer[]> = {};
    for (const c of clubs) {
      clubSquadProjections[c.short] = [];
    }

    const hybridHistory = buildHybridHistoryStore(
      historicalMatchesForStats,
      baseHistoricalGW,
      playerPosSeed,
      precalculatedReviewData.players,
      playerTeamMap,
      extraAllCompSides
    );

    const targetCutoffMsByClub: Record<string, number> = {};
    for (const c of clubs) {
      const koIso = clubNextMatchesMap[c.short]?.[0]?.kickoffTime || deadlines?.[String(targetNextGW)];
      const parsed = koIso ? Date.parse(koIso) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        targetCutoffMsByClub[c.short] = parsed;
      }
    }

    const {
      params: hybridParams,
      logitWeights: hybridWeights,
      targetFeatMap: hybridTargetFeatMap,
    } = selectCausalHybridParamsAndWeights(
      allPlayers,
      clubShorts,
      targetNextGW,
      hybridHistory,
      pastSeasonMap,
      deadlines,
      targetCutoffMsByClub
    );

    const targetRateSnapshot = buildCausalClubPlayerRateSnapshot(
      allPlayersByClub,
      playerGwStatsLookup,
      baseHistoricalGW,
      playerPosSeed
    );

    for (const c of clubs) {
      const cPlayers = allPlayersByClub.get(c.short) || [];
      const nextMatches = clubNextMatchesMap[c.short] || [];
      const earliestKickoff = nextMatches[0]?.kickoffTime;
      const isHomeNext = nextMatches[0]?.isHome;

      const availabilityById = new Map<number, CausalAvailability>();
      for (const p of cPlayers) {
        availabilityById.set(
          p.id,
          resolveCausalPlayerAvailability({
            player: p,
            targetGw: targetNextGW,
            mode: 'future',
            isCurrentGwFinishedOrConfirmed,
            earliestKickoffIso: earliestKickoff,
          })
        );
      }

      const hybridPred = predictHybridClubLineup({
        clubShort: c.short,
        targetGw: targetNextGW,
        targetCutoffMs: targetCutoffMsByClub[c.short],
        isHome: isHomeNext,
        players: cPlayers,
        availabilityById,
        history: hybridHistory,
        pastMap: pastSeasonMap,
        logitWeights: hybridWeights,
        params: hybridParams,
        precomputedFeatMap: hybridTargetFeatMap,
      });

      const koMs = targetCutoffMsByClub[c.short] || 0;
      const hrsRest = resolveClubHoursRest(kickoffsByClub, c.short, koMs);
      s1BridgeByGwClub.set(`${targetNextGW}_${c.short}`, deriveStage1BridgeStats(c.short, hybridPred, targetRateSnapshot, hrsRest));

      const targetSiByPlayer = new Map<number, number>();
      const targetBaseSiByPlayer = new Map<number, number>();
      const targetMwProofByPlayer = new Map<number, boolean>();
      const targetNonEplMins7dByPlayer = new Map<number, number>();
      for (const [pid, info] of hybridPred.playerProbs.entries()) {
        targetSiByPlayer.set(pid, info.si);
        targetBaseSiByPlayer.set(pid, info.baseSi);
        if (info.feat?.fatigue72h && info.feat.fatigue72h > 0) {
          targetNonEplMins7dByPlayer.set(pid, Math.round(info.feat.fatigue72h * 90));
        }
      }
      stage1ByGwClub.set(`${targetNextGW}_${c.short}`, {
        starterIds: new Set(hybridPred.starterIds),
        benchIds: new Set(hybridPred.benchIds),
        siByPlayer: targetSiByPlayer,
        baseSiByPlayer: targetBaseSiByPlayer,
        midweekProofByPlayer: targetMwProofByPlayer,
        nonEplMins7dByPlayer: targetNonEplMins7dByPlayer,
        availabilityById,
      });

      const slotIndexById = new Map<number, number>();
      hybridPred.starterIds.forEach((id, idx) => slotIndexById.set(id, idx));
      const starterIds = new Set(hybridPred.starterIds);
      const benchIds = new Set(hybridPred.benchIds);
      const predictedFormationLabel = hybridPred.predictedFormation || undefined;
      const clubMatchesPlayed = clubMatchCount[c.short] || N;

      const squad: ProjectedSquadPlayer[] = [];
      for (const p of cPlayers) {
        const av = availabilityById.get(p.id)!;
        const probInfo = hybridPred.playerProbs.get(p.id);
        const feat = probInfo?.feat;
        const pulseP = pulsePlayerStats[p.id];
        const startsCount = pulseP ? pulseP.starts : feat ? feat.startsCount : (p.starts || 0);
        const subCount = pulseP ? pulseP.sub : feat ? feat.subCount : 0;
        const unusedCount = pulseP ? pulseP.unused : feat ? feat.unusedCount : 0;
        const benchCount = pulseP ? pulseP.bench : subCount + unusedCount;
        const inSquadCount = startsCount + subCount + unusedCount;
        const outOfSquadCount = Math.max(clubMatchesPlayed - inSquadCount, 0);

        const dynExp = dynamicExplosiveById.get(p.id);
        const provenStatus = getFplProvenStatus({
          ...p,
          doubleDigitHauls: dynExp?.hauls ?? (p as any).doubleDigitHauls,
        } as any);

        const rawNews = p.news || '';
        const baseSi = probInfo?.baseSi ?? Math.min(99, Math.max(5, Math.round((startsCount / Math.max(clubMatchesPlayed, 1)) * 100)));
        const siVal = probInfo?.si ?? (av.avail <= 0 ? 0 : Math.round(av.avail * baseSi));
        const role: 'starting' | 'bench' | 'out' = starterIds.has(p.id)
          ? 'starting'
          : benchIds.has(p.id)
          ? 'bench'
          : 'out';

        squad.push({
          id: p.id,
          code: (p as any).code || p.id,
          webName: p.webName,
          fullName: p.fullName,
          position: p.position as PositionType,
          shirtNum: (p as any).shirtNum || (p as any).shirt_number || 0,
          teamShort: c.short,
          nowCost: (p.nowCost || 50) / 10,
          si: siVal,
          baseSi,
          isRotation5050: hybridPred.slotBattleIds.has(p.id),
          starts: startsCount,
          sub: subCount,
          unused: unusedCount,
          bench: benchCount,
          outOfSquad: outOfSquadCount,
          status: av.status,
          chance: av.chance,
          news: rawNews || (av.status === 's' ? 'SUS (0%)' : av.status === 'i' ? 'INJ (0%)' : ''),
          expectedReturnDate: av.expectedReturnDate,
          role,
          tacticalSlotIndex: slotIndexById.get(p.id),
          projectedFormation: predictedFormationLabel,
          doubleDigitHauls: dynExp?.hauls ?? (p as any).doubleDigitHauls ?? 0,
          maxGwPoints: dynExp?.maxPts ?? (p as any).maxGwPoints ?? 0,
          haulRate: dynExp?.haulRate ?? (p as any).haulRate ?? 0,
          explosiveIndex: (p as any).explosiveIndex || ((dynExp?.hauls ?? 0) * 22),
          proven: provenStatus,
          photo:
            (p as any).photo ||
            ((p as any).code
              ? `https://resources.premierleague.com/premierleague25/photos/players/500x500/${(p as any).code}.png`
              : ''),
        });
      }

      squad.sort((a, b) => b.si - a.si || b.starts - a.starts || b.bench - a.bench || b.nowCost - a.nowCost);
      for (let i = 0; i < squad.length - 1; i++) {
        if (squad[i].si >= 40 && squad[i].si <= 60 && Math.abs(squad[i].si - squad[i + 1].si) <= 10) {
          squad[i].isRotation5050 = true;
          squad[i + 1].isRotation5050 = true;
        }
      }
      clubSquadProjections[c.short] = squad;
    }

    // =========================================================================
    // STAGE 2 (DOWNSTREAM OF STAGE 1): CAUSAL S9 ENSEMBLE MATCH SCORE / xG / CS%
    // =========================================================================
    const nonEplScoreRecords = buildNonEplMatchScoreRecords();
    const resolveGwFirstKickoffMs = (gw: number, fallbackMs: number): number => {
      const list = (matchesWithLineupsByGw[gw]?.length ? matchesWithLineupsByGw[gw] : scheduleByGw[gw]) || [];
      let minMs = Infinity;
      for (const m of list) {
        const ms = m?.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
        if (Number.isFinite(ms) && ms > 0 && ms < minMs) minMs = ms;
      }
      if (Number.isFinite(minMs) && minMs < Infinity) return minMs;
      const dlIso = deadlines?.[String(gw)];
      const dlMs = dlIso ? Date.parse(dlIso) : NaN;
      return Number.isFinite(dlMs) && dlMs > 0 ? dlMs : fallbackMs;
    };

    const causalMatchModelsByGw = new Map<number, MatchScoreModelContext>();
    for (let gw = 1; gw <= baseHistoricalGW; gw++) {
      const gwCutoffMs = resolveGwFirstKickoffMs(gw, Date.now());
      causalMatchModelsByGw.set(
        gw,
        fitCausalMatchScoreModel({
          clubs,
          players: allPlayers,
          eplMatchesByGw: historicalMatchesForStats,
          nonEplRecords: nonEplScoreRecords,
          maxTrainGw: gw - 1,
          cutoffMs: gwCutoffMs,
        })
      );
    }

    const futureCutoffMs = resolveGwFirstKickoffMs(targetNextGW, Date.now());
    const futureMatchModel = fitCausalMatchScoreModel({
      clubs,
      players: allPlayers,
      eplMatchesByGw: historicalMatchesForStats,
      nonEplRecords: nonEplScoreRecords,
      maxTrainGw: baseHistoricalGW,
      cutoffMs: futureCutoffMs,
    });

    const withFixtureRest = (
      base: Stage1BridgeTeamStats | undefined,
      clubShort: string,
      kickoffIso?: string
    ): Stage1BridgeTeamStats | undefined => {
      const koMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
      if (!Number.isFinite(koMs) || koMs <= 0) return base;
      const hrsRest = resolveClubHoursRest(kickoffsByClub, clubShort, koMs);
      const isCongested72h = hrsRest <= 72;
      if (!base) {
        return {
          xiAttDelta: 0,
          xiDefStrength: 0,
          minDefAff: 0.88,
          fatigue72hShare: isCongested72h ? 0.35 : 0,
          hoursRest: hrsRest,
          isCongested72h,
        };
      }
      return {
        ...base,
        hoursRest: hrsRest,
        isCongested72h,
        fatigue72hShare: isCongested72h ? Math.max(base.fatigue72hShare, 0.35) : base.fatigue72hShare,
      };
    };

    const projectFixture = (
      homeShort: string,
      awayShort: string,
      gw: number = targetNextGW,
      kickoffIso?: string
    ): Stage2FixtureProjection => {
      if (gw <= baseHistoricalGW) {
        const causalModel = causalMatchModelsByGw.get(gw) || futureMatchModel;
        const homeS1 = withFixtureRest(s1BridgeByGwClub.get(`${gw}_${homeShort}`), homeShort, kickoffIso);
        const awayS1 = withFixtureRest(s1BridgeByGwClub.get(`${gw}_${awayShort}`), awayShort, kickoffIso);
        return predictDixonColesFixture(causalModel, homeShort, awayShort, {
          gw,
          baseHistoricalGW: gw - 1,
          homeStage1: homeS1,
          awayStage1: awayS1,
        });
      }
      const s1LookupGw = Math.min(gw, targetNextGW);
      const homeS1 = withFixtureRest(s1BridgeByGwClub.get(`${s1LookupGw}_${homeShort}`), homeShort, kickoffIso);
      const awayS1 = withFixtureRest(s1BridgeByGwClub.get(`${s1LookupGw}_${awayShort}`), awayShort, kickoffIso);
      return predictDixonColesFixture(futureMatchModel, homeShort, awayShort, {
        gw,
        baseHistoricalGW,
        homeStage1: homeS1,
        awayStage1: awayS1,
      });
    };

    const walkForwardStableState = createStableV2State();
    const futureStableState = createStableV2State();

    const fixtureProjectionsByKey: Record<string, ProjectedFixtureOutcome> = {};
    for (let gw = 1; gw <= 38; gw++) {
      const matches = scheduleByGw[gw] || [];
      const isHistorical = gw <= baseHistoricalGW;
      const dist = isHistorical ? 0 : Math.max(0, gw - (baseHistoricalGW + 1));

      const slateRows: Array<{
        m: ScheduleFixtureSummary;
        hShort: string;
        aShort: string;
        proj: Stage2FixtureProjection;
      }> = [];
      const slateInputs: StableV2SlateInput[] = [];

      for (const m of matches) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;

        const proj = projectFixture(hShort, aShort, gw, m.kickoff_time);
        slateRows.push({ m, hShort, aShort, proj });
        slateInputs.push({
          homeShort: hShort,
          awayShort: aShort,
          proj,
          dist,
        });
      }

      if (slateInputs.length > 0) {
        assignStableV2SlateScores(
          isHistorical ? walkForwardStableState : futureStableState,
          slateInputs
        );
      }

      for (const { m, hShort, aShort, proj } of slateRows) {
        const { scoreMatrix: _omitMatrix, ...cleanProj } = proj;
        fixtureProjectionsByKey[`${gw}_${hShort}_${aShort}`] = cleanProj;

        const fallbackDateIso = new Date(Date.UTC(2026, 9, 24 + (gw - targetNextGW) * 7)).toISOString();
        const kickoffTime = m.kickoff_time || fallbackDateIso;

        const hCsRaw = cleanProj.homeCsProbRaw ?? cleanProj.homeCsProb / 100;
        const aCsRaw = cleanProj.awayCsProbRaw ?? cleanProj.awayCsProb / 100;

        const hEntry: ClubGwMatchProjectionItem = {
          fixtureId: m.id,
          oppShort: aShort,
          oppName: m.away_team?.name || clubNameByShort.get(aShort) || aShort,
          isHome: true,
          kickoffTime,
          teamLambda: cleanProj.lambdaH,
          oppLambda: cleanProj.lambdaA,
          teamGoals: cleanProj.homeGoals,
          oppGoals: cleanProj.awayGoals,
          csProb: hCsRaw,
          csProbPct: cleanProj.homeCsProb,
          expGcPenalty: cleanProj.homeExpGcPenalty,
          winProb: cleanProj.homeWinProb,
          drawProb: cleanProj.drawProb,
          lossProb: cleanProj.awayWinProb,
          isCongested72h: cleanProj.homeCongested72h ?? cleanProj.isCongested72h,
          oppCongested72h: cleanProj.awayCongested72h,
        };
        const aEntry: ClubGwMatchProjectionItem = {
          fixtureId: m.id,
          oppShort: hShort,
          oppName: m.home_team?.name || clubNameByShort.get(hShort) || hShort,
          isHome: false,
          kickoffTime,
          teamLambda: cleanProj.lambdaA,
          oppLambda: cleanProj.lambdaH,
          teamGoals: cleanProj.awayGoals,
          oppGoals: cleanProj.homeGoals,
          csProb: aCsRaw,
          csProbPct: cleanProj.awayCsProb,
          expGcPenalty: cleanProj.awayExpGcPenalty,
          winProb: cleanProj.awayWinProb,
          drawProb: cleanProj.drawProb,
          lossProb: cleanProj.homeWinProb,
          isCongested72h: cleanProj.awayCongested72h ?? cleanProj.isCongested72h,
          oppCongested72h: cleanProj.homeCongested72h,
        };

        if (!clubGwMatchProjections[`${hShort}_${gw}`]) clubGwMatchProjections[`${hShort}_${gw}`] = [];
        if (!clubGwMatchProjections[`${aShort}_${gw}`]) clubGwMatchProjections[`${aShort}_${gw}`] = [];
        clubGwMatchProjections[`${hShort}_${gw}`].push(hEntry);
        clubGwMatchProjections[`${aShort}_${gw}`].push(aEntry);
      }
    }

    // =========================================================================
    // STAGE 3 (DOWNSTREAM OF STAGE 1 & STAGE 2): CAUSAL xMin_P7 + P10 ENSEMBLE
    // =========================================================================
    const squadPlayerById = new Map<number, ProjectedSquadPlayer>();
    for (const squad of Object.values(clubSquadProjections)) {
      for (const sp of squad) {
        squadPlayerById.set(sp.id, sp);
      }
    }

    const deadBallByPlayerId = new Map<number, ReturnType<typeof resolveDeadBallDuties>>();
    const provenByPlayerId = new Map<number, ReturnType<typeof getFplProvenStatus>>();
    const expectedReturnByPlayerId = new Map<number, Date | null>();

    for (const p of allPlayers) {
      const squadPlayer = squadPlayerById.get(p.id);
      const dynExp = dynamicExplosiveById.get(p.id);
      const hauls = dynExp?.hauls ?? (p as any).doubleDigitHauls ?? 0;
      deadBallByPlayerId.set(p.id, resolveDeadBallDuties(p.webName, p.fullName, p.teamShort, p));
      provenByPlayerId.set(p.id, getFplProvenStatus({ ...p, doubleDigitHauls: hauls } as any));
      expectedReturnByPlayerId.set(
        p.id,
        squadPlayer?.expectedReturnDate
          ? new Date(squadPlayer.expectedReturnDate)
          : parseExpectedReturnDate(p.news)
      );
    }

    const nonEplClubSides: NonEplClubSideRecord[] = extraAllCompSides.map((s) => ({
      kickoffMs: s.kickoffMs,
      compAbbr: s.compAbbr,
      clubShort: s.clubShort,
      starterIds: new Set(s.starterIds),
      subOnIds: new Set(s.subOnIds),
      minutesByPlayer: s.minutesByPlayer || {},
    }));

    const { playerGwMatchesMap } = runFullSeasonStage3ProjectionEngine({
      allPlayers,
      clubs,
      scheduleByGw,
      historicalMatchesForStats,
      clubGwMatchProjections,
      stage1ByGwClub,
      nonEplClubSides,
      pastSeasonMap,
      precalcPlayers: precalculatedReviewData.players,
      playerPosSeed,
      deadlines,
      deadBallByPlayerId,
      provenByPlayerId,
      expectedReturnByPlayerId,
      baseHistoricalGW,
      targetNextGW,
      isCurrentGwFinishedOrConfirmed,
    });

    const combineDgwQuantiles = (ladders: number[][]): number[] | undefined => {
      if (ladders.length === 0) return undefined;
      if (ladders.length === 1) return ladders[0];
      let acc = ladders[0];
      for (let idx = 1; idx < ladders.length; idx++) {
        const next = ladders[idx];
        const sums: number[] = [];
        for (let i = 0; i < acc.length; i++) {
          for (let j = 0; j < next.length; j++) {
            sums.push(acc[i] + next[j]);
          }
        }
        sums.sort((a, b) => a - b);
        const resampled: number[] = [];
        const targetBins = 16;
        for (let q = 0; q < targetBins; q++) {
          const posIdx = Math.min(sums.length - 1, Math.floor(((q + 0.5) / targetBins) * sums.length));
          resampled.push(Number(sums[posIdx].toFixed(2)));
        }
        acc = resampled;
      }
      return acc;
    };

    const allPlayerFullSeasonProjections: ProjectedPlayerCoreItem[] = allPlayers.map((p) => {
      const cShort = p.teamShort;
      const pos = p.position as PositionType;
      const costMil = (p.nowCost || 50) / 10;
      const squadPlayer = squadPlayerById.get(p.id);
      const startsCount = p.starts || 0;
      const fallbackBaseSi = Math.round((Math.max(startsCount, 1) / Math.max(baseHistoricalGW, 1)) * 80);

      const dynExp = dynamicExplosiveById.get(p.id);
      const doubleDigitHauls = dynExp?.hauls ?? (p as any).doubleDigitHauls ?? 0;
      const maxGwPoints = dynExp?.maxPts ?? (p as any).maxGwPoints ?? 0;
      const haulRate = dynExp?.haulRate ?? (p as any).haulRate ?? 0;

      const deadBall = deadBallByPlayerId.get(p.id)!;
      const provenStatus = provenByPlayerId.get(p.id)!;
      const pMatchesMap = playerGwMatchesMap.get(p.id);

      const fullSeasonPointsMap: Record<number, PlayerGwProjectionCell> = {};

      for (let gw = 1; gw <= 38; gw++) {
        const matchProjList = clubGwMatchProjections[`${cShort}_${gw}`] || [];
        const stage3Cells = pMatchesMap?.get(gw) || [];

        if (matchProjList.length === 0 || stage3Cells.length === 0) {
          fullSeasonPointsMap[gw] = {
            opp: '-',
            isHome: true,
            xp: 0,
            baseXp: 0,
            spikeMod: 0,
            xMin: 0,
            pStart: 0,
            pPlay60: 0,
            isBlank: true,
            matchCount: 0,
            matches: [],
          };
          continue;
        }

        const matchDetails: PlayerGwMatchDetail[] = [];
        let sumXp = 0;
        let sumBaseXp = 0;
        let sumSpikeMod = 0;
        let sumXMin = 0;
        let maxPStart = 0;
        let maxPPlay60 = 0;
        let sumQ85 = 0;
        let noHaulProbProduct = 1;
        const targetQuantileLadders: number[][] = [];

        for (const c of stage3Cells) {
          const out = c.output;
          sumXp += out.xp;
          sumBaseXp += out.baseXp;
          sumSpikeMod += out.spikeMod;
          sumXMin += out.xMin;
          if (out.pStart > maxPStart) maxPStart = out.pStart;
          if (out.pPlay60 > maxPPlay60) maxPPlay60 = out.pPlay60;
          sumQ85 += out.mcQ85;
          noHaulProbProduct *= 1 - Math.max(0, Math.min(1, out.mcPHaul10));
          if (gw === targetNextGW && out.mcQuantiles && out.mcQuantiles.length > 0) {
            targetQuantileLadders.push(out.mcQuantiles);
          }

          matchDetails.push({
            oppShort: c.oppShort,
            isHome: c.isHome,
            oppLabel: c.oppLabel,
            xp: Number(out.xp.toFixed(1)),
            baseXp: Number(out.baseXp.toFixed(1)),
            spikeMod: Number(out.spikeMod.toFixed(1)),
            xMin: Number(out.xMin.toFixed(1)),
            pStart: Number(out.pStart.toFixed(3)),
            pPlay60: Number(out.pPlay60.toFixed(3)),
            mcQ85: Number(out.mcQ85.toFixed(1)),
            mcPHaul10: Number(out.mcPHaul10.toFixed(3)),
            teamLambda: Number(c.teamLambda.toFixed(2)),
            oppLambda: Number(c.oppLambda.toFixed(2)),
            csProb: c.csProbPct,
            winProb: c.winProb,
            drawProb: c.drawProb,
            lossProb: c.lossProb,
            isCongested72h: c.isCongested72h,
          });
        }

        const combinedOpp = matchDetails.map((d) => d.oppLabel).join(' + ');
        const combinedPHaul10 = Number((1 - noHaulProbProduct).toFixed(3));
        const mcQuantiles = gw === targetNextGW ? combineDgwQuantiles(targetQuantileLadders) : undefined;

        fullSeasonPointsMap[gw] = {
          opp: combinedOpp,
          isHome: matchDetails[0]?.isHome ?? true,
          xp: Number(sumXp.toFixed(1)),
          baseXp: Number(sumBaseXp.toFixed(1)),
          spikeMod: Number(sumSpikeMod.toFixed(1)),
          xMin: Number(sumXMin.toFixed(1)),
          pStart: Number(maxPStart.toFixed(3)),
          pPlay60: Number(maxPPlay60.toFixed(3)),
          mcQ85: Number(sumQ85.toFixed(1)),
          mcPHaul10: combinedPHaul10,
          ...(mcQuantiles ? { mcQuantiles } : {}),
          isBlank: false,
          matchCount: matchDetails.length,
          matches: matchDetails,
        };
      }

      return {
        id: p.id,
        code: (p as any).code || p.id,
        webName: p.webName,
        fullName: p.fullName,
        teamShort: cShort,
        position: pos,
        nowCost: costMil,
        si: squadPlayer?.si ?? fallbackBaseSi,
        status: squadPlayer?.status ?? p.status ?? 'a',
        chance: squadPlayer?.chance ?? p.chanceOfPlayingNextRound ?? null,
        news: squadPlayer?.news ?? p.news ?? '',
        photo: squadPlayer?.photo ?? (p as any).photo ?? '',
        deadBall,
        proven: provenStatus,
        doubleDigitHauls,
        maxGwPoints,
        haulRate,
        explosiveIndex: (p as any).explosiveIndex || (doubleDigitHauls * 22),
        fullSeasonPointsMap,
      };
    });

    const corePayload: ServerProjectionCorePayload = {
      epochKey: epoch.epochKey,
      generatedAt: new Date().toISOString(),
      lifecycleStatus: epoch.lifecycleStatus,
      isCurrentGwFinishedOrConfirmed: epoch.isCurrentGwFinishedOrConfirmed,
      baseHistoricalGW,
      targetNextGW,
      maxReviewGW: epoch.maxReviewGW,
      clubs,
      scheduleByGw,
      fixtureProjectionsByKey,
      clubNextMatchesMap,
      clubGwMatchProjections,
      clubSquadProjections,
      allPlayerFullSeasonProjections,
    };

    const ctx: CoreRuntimeContext = {
      epoch,
      corePayload,
      matchesWithLineupsByGw,
      clubStatsMap,
      leagueAvgHomeGoals,
      leagueAvgAwayGoals,
      playerPosSeed,
      playerTeamMap,
      extraAllCompSides,
      calibByGw,
    };

    cachedCoreContext = ctx;
    console.log(
      `[ProjectionEngine] Built Core Context epoch=${epoch.epochKey} (${allPlayerFullSeasonProjections.length} players) in ${Date.now() - startMs}ms`
    );
    return ctx;
  })();

  inFlightCoreBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightCoreBuild?.promise === buildPromise) {
      inFlightCoreBuild = null;
    }
  }
}

export async function getServerProjectionCore(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ServerProjectionCorePayload> {
  const ctx = await getOrBuildCoreContext(cachedData, force);
  return ctx.corePayload;
}

// ============================================================================
// REVIEW ENGINE: ACTUALS + LINEUP REVIEW + FULL MAE RECAP (SERVER CACHED)
// ============================================================================
interface HybridReviewRuntimeCache {
  playerPosSeed: Record<number, string>;
  playerTeamMap: Map<number, string>;
  extraAllCompSides?: HybridMatchClubSide[];
  deadlines?: Record<string, string>;
  isCurrentGwFinishedOrConfirmed: boolean;
  calibByGw: Map<number, { params: HybridTuneParams; logitWeights: number[]; targetFeatMap?: Map<number, PlayerFeaturesAtGw> }>;
}

function buildLineupReviewForGw(
  gw: number,
  maxReviewGW: number,
  clubs: Array<{ id: number; name: string; short: string; badgeUrl: string }>,
  allPlayers: DbPlayerStat[],
  actualMatchLookup: Record<string, ActualMatchReviewEntry[]>,
  actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>>,
  matchesByGw: Record<number, any[]>,
  reviewRuntime?: HybridReviewRuntimeCache
): { lineupReviewPerClub: Record<string, any[]>; lineupGwSummary: { playedClubs: number; totalHit: number; avgHit: number; pct: number } } {
  const clubsData: Record<string, any[]> = {};
  const activePlayers = allPlayers.filter((p) => p.status !== 'u');
  const playerPosSeed = reviewRuntime?.playerPosSeed || buildPulsePositionInfoSeed(activePlayers);
  const playerTeamMap = reviewRuntime?.playerTeamMap || new Map<number, string>(activePlayers.map((p) => [p.id, p.teamShort]));
  const extraAllCompSides = reviewRuntime?.extraAllCompSides ?? buildHybridExtraAllCompSides();
  const deadlines = reviewRuntime?.deadlines;
  const isCurrConfirmed = reviewRuntime?.isCurrentGwFinishedOrConfirmed ?? true;

  const gwHistory = buildHybridHistoryStore(
    matchesByGw,
    gw - 1,
    playerPosSeed,
    precalculatedReviewData.players,
    playerTeamMap,
    extraAllCompSides
  );

  const clubShorts = clubs.map((c) => c.short);
  const targetCutoffMsByClub: Record<string, number> = {};
  for (const c of clubs) {
    const koIso = actualMatchLookup[`${gw}_${c.short}`]?.[0]?.kickoff || deadlines?.[String(gw)];
    const parsed = koIso ? Date.parse(koIso) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      targetCutoffMsByClub[c.short] = parsed;
    }
  }

  let calib = reviewRuntime?.calibByGw.get(gw);
  if (!calib) {
    calib = selectCausalHybridParamsAndWeights(
      activePlayers,
      clubShorts,
      gw,
      gwHistory,
      pastSeasonMap,
      deadlines,
      targetCutoffMsByClub
    );
    reviewRuntime?.calibByGw.set(gw, calib);
  }

  const actualPulseFormationMap = new Map<string, string>();
  for (const m of matchesByGw[gw] || []) {
    const hShort = m?.home_team?.short_name;
    const aShort = m?.away_team?.short_name;
    if (hShort && m?.home_formation && !actualPulseFormationMap.has(hShort)) {
      actualPulseFormationMap.set(hShort, String(m.home_formation));
    }
    if (aShort && m?.away_formation && !actualPulseFormationMap.has(aShort)) {
      actualPulseFormationMap.set(aShort, String(m.away_formation));
    }
  }

  const playersByClub = new Map<string, DbPlayerStat[]>();
  for (const p of activePlayers) {
    if (!playersByClub.has(p.teamShort)) playersByClub.set(p.teamShort, []);
    playersByClub.get(p.teamShort)!.push(p);
  }

  let playedClubs = 0;
  let totalHit = 0;

  const ROLE_ORDER: Record<string, number> = { starting: 1, bench: 2, out: 3 };
  const POS_ORDER: Record<string, number> = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
  const dlIso = deadlines?.[String(gw)];

  for (const c of clubs) {
    const squad = playersByClub.get(c.short) || [];
    const actualList = actualMatchLookup[`${gw}_${c.short}`] || [];
    const isMatchPlayed = actualList.some((m) => m.finished || m.teamScore !== null);
    const isHistoricalPast = gw < maxReviewGW || isMatchPlayed;
    const earliestKickoff = actualList[0]?.kickoff;
    const isHome = actualList[0]?.isHome;

    const availabilityById = new Map<number, CausalAvailability>();
    for (const p of squad) {
      availabilityById.set(
        p.id,
        resolveCausalPlayerAvailability(
          isHistoricalPast
            ? {
                player: p,
                targetGw: gw,
                mode: 'historical',
                earliestKickoffIso: earliestKickoff,
                gwDeadlineIso: dlIso,
              }
            : {
                player: p,
                targetGw: gw,
                mode: 'future',
                isCurrentGwFinishedOrConfirmed: isCurrConfirmed,
                earliestKickoffIso: earliestKickoff,
              }
        )
      );
    }

    const hybridPred = predictHybridClubLineup({
      clubShort: c.short,
      targetGw: gw,
      targetCutoffMs: targetCutoffMsByClub[c.short],
      isHome,
      players: squad,
      availabilityById,
      history: gwHistory,
      pastMap: pastSeasonMap,
      logitWeights: calib.logitWeights,
      params: calib.params,
      precomputedFeatMap: calib.targetFeatMap,
    });

    const starterIds = new Set(hybridPred.starterIds);
    const benchIds = new Set(hybridPred.benchIds);
    const projectedFormation = hybridPred.predictedFormation || undefined;
    const actualFormation = actualPulseFormationMap.get(c.short) || undefined;

    const scored = squad.map((p) => {
      const av = availabilityById.get(p.id)!;
      const probInfo = hybridPred.playerProbs.get(p.id);
      const siVal = probInfo?.si ?? (av.avail <= 0 ? 0 : 5);
      const role: 'starting' | 'bench' | 'out' = starterIds.has(p.id)
        ? 'starting'
        : benchIds.has(p.id)
        ? 'bench'
        : 'out';

      const realGw = actualPlayerStatsMap[p.id]?.[gw];
      const realStarted = Boolean(realGw && realGw.wasStarter);
      const realSub = Boolean(realGw && !realGw.wasStarter && realGw.mins > 0);
      const realUnusedSub = Boolean(realGw && !realGw.wasStarter && realGw.mins === 0);
      const realNotInSquad = !realGw;
      const realMins = realGw ? realGw.mins : 0;
      const realPts = realGw ? realGw.pts : 0;

      let isAccuracyMatch = false;
      let accuracyStatusLabel = '-';
      let accuracyBadgeColor = 'bg-slate-500/10 text-slate-400 border-slate-500/20';

      if (isMatchPlayed) {
        if (role === 'starting') isAccuracyMatch = realStarted;
        else if (role === 'bench') isAccuracyMatch = realSub || realUnusedSub;
        else isAccuracyMatch = realNotInSquad;

        if (isAccuracyMatch) {
          accuracyStatusLabel = '✓';
          accuracyBadgeColor = 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
        } else {
          accuracyStatusLabel = '✗';
          accuracyBadgeColor = 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30';
        }
      }

      return {
        id: p.id,
        webName: p.webName,
        fullName: p.fullName,
        position: p.position as PositionType,
        shirtNum: (p as any).shirtNum || 0,
        nowCost: (p.nowCost || 50) / 10,
        status: av.status,
        role,
        si: siVal,
        projectedFormation,
        actualFormation,
        isMatchPlayed,
        realStarted,
        realSub,
        realUnusedSub,
        realNotInSquad,
        realMins,
        realPts,
        isAccuracyMatch,
        accuracyStatusLabel,
        accuracyBadgeColor,
      };
    });

    scored.sort((a, b) => {
      const rDiff = (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99);
      if (rDiff !== 0) return rDiff;
      const pDiff = (POS_ORDER[a.position] || 99) - (POS_ORDER[b.position] || 99);
      if (pDiff !== 0) return pDiff;
      return b.si - a.si;
    });

    clubsData[c.short] = scored;
    if (isMatchPlayed) {
      playedClubs += 1;
      totalHit += scored.filter((p) => p.role === 'starting' && p.realStarted).length;
    }
  }

  const avgHit = playedClubs > 0 ? Math.round((totalHit / playedClubs) * 10) / 10 : 0;
  const pct = playedClubs > 0 ? Math.round((totalHit / (playedClubs * 11)) * 100) : 0;

  return {
    lineupReviewPerClub: clubsData,
    lineupGwSummary: { playedClubs, totalHit, avgHit, pct },
  };
}

async function getOrBuildReviewBase(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ReviewBaseCache> {
  const epoch = computeProjectionEpochInfo(cachedData);
  if (!force && cachedReviewBase && cachedReviewBase.epochKey === epoch.epochKey) {
    return cachedReviewBase;
  }
  if (!force && inFlightReviewBuild && inFlightReviewBuild.epochKey === epoch.epochKey) {
    return inFlightReviewBuild.promise;
  }

  const buildPromise = (async (): Promise<ReviewBaseCache> => {
    const startMs = Date.now();
    const coreCtx = await getOrBuildCoreContext(cachedData, force);
    const { corePayload, matchesWithLineupsByGw } = coreCtx;
    const maxReviewGW = corePayload.maxReviewGW;

    // 1. Actual Match Lookup keyed as `${gw}_${clubShort}` -> ActualMatchReviewEntry[] (full DGW support!)
    const actualMatchLookup: Record<string, ActualMatchReviewEntry[]> = {};
    const upsertActualMatch = (gw: number, clubShort: string, entry: ActualMatchReviewEntry) => {
      const key = `${gw}_${clubShort}`;
      if (!actualMatchLookup[key]) actualMatchLookup[key] = [];
      const existingIdx = actualMatchLookup[key].findIndex(
        (e) =>
          (entry.fixtureId && e.fixtureId === entry.fixtureId) ||
          (e.oppShort === entry.oppShort && e.isHome === entry.isHome)
      );
      if (existingIdx >= 0) {
        actualMatchLookup[key][existingIdx] = { ...actualMatchLookup[key][existingIdx], ...entry };
      } else {
        actualMatchLookup[key].push(entry);
      }
    };

    for (const pm of precalculatedReviewData.matches) {
      if (pm.gw > maxReviewGW) continue;
      const hScore = pm.hScore;
      const aScore = pm.aScore;
      const isDone = Boolean(pm.finished);

      let resH: 'W' | 'D' | 'L' | null = null;
      let resA: 'W' | 'D' | 'L' | null = null;
      if (isDone && hScore !== null && aScore !== null) {
        if (hScore > aScore) { resH = 'W'; resA = 'L'; }
        else if (hScore < aScore) { resH = 'L'; resA = 'W'; }
        else { resH = 'D'; resA = 'D'; }
      }

      upsertActualMatch(pm.gw, pm.hShort, {
        fixtureId: pm.id,
        gw: pm.gw,
        isHome: true,
        oppShort: pm.aShort,
        teamScore: hScore,
        oppScore: aScore,
        scoreText: isDone && hScore !== null && aScore !== null ? `${hScore} - ${aScore}` : isDone ? 'FT' : `vs ${pm.aShort}`,
        result: resH,
        cleanSheet: isDone && aScore === 0,
        finished: isDone,
        kickoff: pm.kickoff,
      });

      upsertActualMatch(pm.gw, pm.aShort, {
        fixtureId: pm.id,
        gw: pm.gw,
        isHome: false,
        oppShort: pm.hShort,
        teamScore: aScore,
        oppScore: hScore,
        scoreText: isDone && aScore !== null && hScore !== null ? `${aScore} - ${hScore}` : isDone ? 'FT' : `vs ${pm.hShort}`,
        result: resA,
        cleanSheet: isDone && hScore === 0,
        finished: isDone,
        kickoff: pm.kickoff,
      });
    }

    // Merge live/schedule matches cleanly without overwriting DGW siblings
    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const gwList = (matchesWithLineupsByGw[gw]?.length ? matchesWithLineupsByGw[gw] : corePayload.scheduleByGw[gw]) || [];
      for (const m of gwList) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;
        const hScore = m.team_h_score !== null && m.team_h_score !== undefined ? m.team_h_score : null;
        const aScore = m.team_a_score !== null && m.team_a_score !== undefined ? m.team_a_score : null;
        const isDone = Boolean(m.finished || m.finished_provisional || (hScore !== null && aScore !== null));

        let resH: 'W' | 'D' | 'L' | null = null;
        let resA: 'W' | 'D' | 'L' | null = null;
        if (isDone && hScore !== null && aScore !== null) {
          if (hScore > aScore) { resH = 'W'; resA = 'L'; }
          else if (hScore < aScore) { resH = 'L'; resA = 'W'; }
          else { resH = 'D'; resA = 'D'; }
        }

        upsertActualMatch(gw, hShort, {
          fixtureId: m.id,
          gw,
          isHome: true,
          oppShort: aShort,
          teamScore: hScore,
          oppScore: aScore,
          scoreText: isDone && hScore !== null && aScore !== null ? `${hScore} - ${aScore}` : isDone ? 'FT' : `vs ${aShort}`,
          result: resH,
          cleanSheet: isDone && aScore === 0,
          finished: isDone,
          kickoff: m.kickoff_time || '',
        });

        upsertActualMatch(gw, aShort, {
          fixtureId: m.id,
          gw,
          isHome: false,
          oppShort: hShort,
          teamScore: aScore,
          oppScore: hScore,
          scoreText: isDone && aScore !== null && hScore !== null ? `${aScore} - ${hScore}` : isDone ? 'FT' : `vs ${hShort}`,
          result: resA,
          cleanSheet: isDone && hScore === 0,
          finished: isDone,
          kickoff: m.kickoff_time || '',
        });
      }
    }

    for (const arr of Object.values(actualMatchLookup)) {
      arr.sort((a, b) => (a.kickoff ? Date.parse(a.kickoff) : 0) - (b.kickoff ? Date.parse(b.kickoff) : 0));
    }

    // 2. Actual Player Stats Map (sums points & mins across DGW fixtures!)
    const actualPlayerStatsMap: Record<number, Record<number, ActualPlayerReviewStat>> = {};
    for (const [idStr, gws] of Object.entries(precalculatedReviewData.players)) {
      const pId = Number(idStr);
      actualPlayerStatsMap[pId] = {};
      for (const [gwStr, stat] of Object.entries(gws)) {
        const gw = Number(gwStr);
        if (gw > maxReviewGW) continue;
        actualPlayerStatsMap[pId][gw] = {
          pts: stat.pts,
          mins: stat.mins,
          wasStarter: stat.wasStarter,
          wasSub: stat.wasSub,
        };
      }
    }

    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const matches = matchesWithLineupsByGw[gw];
      if (!Array.isArray(matches) || matches.length === 0) continue;

      const gwAccumulator = new Map<number, ActualPlayerReviewStat>();
      for (const m of matches) {
        for (const p of [
          ...(Array.isArray(m.home_lineup) ? m.home_lineup : []),
          ...(Array.isArray(m.away_lineup) ? m.away_lineup : []),
        ]) {
          if (!p?.id) continue;
          const cur = gwAccumulator.get(p.id) || { pts: 0, mins: 0, wasStarter: false, wasSub: false, matchCount: 0 };
          cur.pts += typeof p.gw_points === 'number' ? p.gw_points : (p.stats?.total_points || 0);
          cur.mins += p.stats?.minutes || 0;
          cur.wasStarter = true;
          cur.matchCount = (cur.matchCount || 0) + 1;
          gwAccumulator.set(p.id, cur);
        }
        for (const p of [
          ...(Array.isArray(m.home_bench) ? m.home_bench : []),
          ...(Array.isArray(m.away_bench) ? m.away_bench : []),
        ]) {
          if (!p?.id) continue;
          const mins = p.stats?.minutes || 0;
          const cur = gwAccumulator.get(p.id) || { pts: 0, mins: 0, wasStarter: false, wasSub: false, matchCount: 0 };
          cur.pts += typeof p.gw_points === 'number' ? p.gw_points : (p.stats?.total_points || 0);
          cur.mins += mins;
          if (!cur.wasStarter && mins > 0) cur.wasSub = true;
          cur.matchCount = (cur.matchCount || 0) + 1;
          gwAccumulator.set(p.id, cur);
        }
      }
      for (const [pId, stat] of gwAccumulator.entries()) {
        if (!actualPlayerStatsMap[pId]) actualPlayerStatsMap[pId] = {};
        actualPlayerStatsMap[pId][gw] = stat;
      }
    }

    // Also backfill from gwHistory if any GW wasn't covered by Pulse/Precalc
    for (const p of cachedData.player_stats || []) {
      for (const h of p.gwHistory || []) {
        if (h.round <= maxReviewGW && !actualPlayerStatsMap[p.id]?.[h.round]) {
          if (!actualPlayerStatsMap[p.id]) actualPlayerStatsMap[p.id] = {};
          actualPlayerStatsMap[p.id][h.round] = {
            pts: Number(h.points || 0),
            mins: Number(h.minutes || 0),
            wasStarter: Number(h.minutes || 0) >= 55,
            wasSub: Number(h.minutes || 0) > 0 && Number(h.minutes || 0) < 55,
          };
        }
      }
    }

    // 3. Precompute full MAE Recap Rows (GW 1..maxReviewGW) with confirmed-GW memoization
    const allPlayers = cachedData.player_stats || [];
    const projPlayers = corePayload.allPlayerFullSeasonProjections;
    const maeRecapRows: any[] = [];
    const lineupByGwCache = new Map<number, { lineupReviewPerClub: Record<string, any[]>; lineupGwSummary: { playedClubs: number; totalHit: number; avgHit: number; pct: number } }>();
    const reviewRuntime: HybridReviewRuntimeCache = {
      playerPosSeed: coreCtx.playerPosSeed,
      playerTeamMap: coreCtx.playerTeamMap,
      extraAllCompSides: coreCtx.extraAllCompSides,
      deadlines: cachedData.sync_status?.deadlines,
      isCurrentGwFinishedOrConfirmed: coreCtx.epoch.isCurrentGwFinishedOrConfirmed,
      calibByGw: coreCtx.calibByGw,
    };

    for (let gw = 1; gw <= maxReviewGW; gw++) {
      const canUseConfirmedCache =
        !force &&
        gw < maxReviewGW &&
        confirmedMaeRowCache.has(gw);

      if (canUseConfirmedCache) {
        maeRecapRows.push(confirmedMaeRowCache.get(gw)!.row);
        continue;
      }

      const matchesInGw = (matchesWithLineupsByGw[gw]?.length ? matchesWithLineupsByGw[gw] : corePayload.scheduleByGw[gw]) || [];
      const matchesDetail: any[] = [];
      let matchesFinished = 0;
      let teamGoalsSumDiff = 0;
      let matchGoalsSumDiff = 0;
      let outcomeHits = 0;
      let probOutcomeHits = 0;
      let exactScoreHits = 0;
      let cleanSheetHits = 0;
      let predXgTotal = 0;
      let actualGoalsTotal = 0;
      let expCsTotal = 0;
      let scoreCsTotal = 0;
      let actualCsTotal = 0;
      let congestedCount = 0;
      let congestedProbHits = 0;

      for (const m of matchesInGw) {
        const hShort = m.home_team?.short_name || '';
        const aShort = m.away_team?.short_name || '';
        if (!hShort || !aShort) continue;

        const proj: ProjectedFixtureOutcome = corePayload.fixtureProjectionsByKey[`${gw}_${hShort}_${aShort}`] || {
          homeGoals: 1,
          awayGoals: 1,
          homeWinProb: 0.42,
          drawProb: 0.27,
          awayWinProb: 0.31,
          homeCsProb: 30,
          awayCsProb: 25,
          lambdaH: 1.35,
          lambdaA: 1.15,
          homeExpGcPenalty: -0.35,
          awayExpGcPenalty: -0.45,
        };

        // Match exact fixture in DGW array (matches oppShort & isHome)
        const hActual = (actualMatchLookup[`${gw}_${hShort}`] || []).find(
          (e) => e.isHome && e.oppShort === aShort
        );
        const isDone = Boolean(hActual && hActual.finished && hActual.teamScore !== null && hActual.oppScore !== null);

        const realH = isDone ? hActual!.teamScore : null;
        const realA = isDone ? hActual!.oppScore : null;
        const projH = proj.homeGoals;
        const projA = proj.awayGoals;
        const hW = proj.homeWinProb ?? 0.42;
        const dP = proj.drawProb ?? 0.27;
        const aW = proj.awayWinProb ?? 0.31;
        const isCongested72h = Boolean(proj.isCongested72h);

        let projRes: 'W' | 'D' | 'L' = 'D';
        if (projH > projA) projRes = 'W';
        else if (projH < projA) projRes = 'L';

        let probRes: 'W' | 'D' | 'L' = 'D';
        if (hW >= aW && hW >= dP) probRes = 'W';
        else if (aW > hW && aW >= dP) probRes = 'L';

        let realRes: 'W' | 'D' | 'L' | null = null;
        let outcomeHit = false;
        let exactScoreHit = false;
        let homeCsHit = false;
        let awayCsHit = false;

        if (isDone && realH !== null && realA !== null) {
          matchesFinished += 1;
          if (realH > realA) realRes = 'W';
          else if (realH < realA) realRes = 'L';
          else realRes = 'D';

          outcomeHit = projRes === realRes;
          if (outcomeHit) outcomeHits += 1;
          const pHit = probRes === realRes;
          if (pHit) probOutcomeHits += 1;

          if (isCongested72h) {
            congestedCount += 1;
            if (pHit) congestedProbHits += 1;
          }

          exactScoreHit = projH === realH && projA === realA;
          if (exactScoreHit) exactScoreHits += 1;

          teamGoalsSumDiff += Math.abs(projH - realH) + Math.abs(projA - realA);
          matchGoalsSumDiff += Math.abs(projH + projA - (realH + realA));

          predXgTotal += (proj.lambdaH ?? 1.35) + (proj.lambdaA ?? 1.15);
          actualGoalsTotal += realH + realA;
          expCsTotal += (proj.homeCsProbRaw ?? proj.homeCsProb / 100) + (proj.awayCsProbRaw ?? proj.awayCsProb / 100);
          scoreCsTotal += (projA === 0 ? 1 : 0) + (projH === 0 ? 1 : 0);
          actualCsTotal += (realA === 0 ? 1 : 0) + (realH === 0 ? 1 : 0);

          const realHHasCs = realA === 0;
          const realAHasCs = realH === 0;
          const projHHasCs = proj.homeCsProb >= 40;
          const projAHasCs = proj.awayCsProb >= 40;
          homeCsHit = projHHasCs === realHHasCs;
          awayCsHit = projAHasCs === realAHasCs;
          if (homeCsHit) cleanSheetHits += 1;
          if (awayCsHit) cleanSheetHits += 1;
        }

        matchesDetail.push({
          homeShort: hShort,
          awayShort: aShort,
          projHomeGoals: projH,
          projAwayGoals: projA,
          realHomeGoals: realH,
          realAwayGoals: realA,
          lambdaH: Number((proj.lambdaH ?? 1.35).toFixed(2)),
          lambdaA: Number((proj.lambdaA ?? 1.15).toFixed(2)),
          homeCsProb: proj.homeCsProb,
          awayCsProb: proj.awayCsProb,
          homeWinProb: hW,
          drawProb: dP,
          awayWinProb: aW,
          isCongested72h,
          projResult: projRes,
          realResult: realRes,
          outcomeHit,
          exactScoreHit,
          homeCsHit,
          awayCsHit,
          finished: isDone,
        });
      }

      // Lineup accuracy evaluation for GW
      const gwLineupBuilt = buildLineupReviewForGw(
        gw,
        maxReviewGW,
        corePayload.clubs,
        allPlayers,
        actualMatchLookup,
        actualPlayerStatsMap,
        matchesWithLineupsByGw,
        reviewRuntime
      );
      lineupByGwCache.set(gw, gwLineupBuilt);

      let totalStartersHit = 0;
      let totalStartersPredicted = 0;
      const clubsLineupDetail: any[] = [];

      for (const club of corePayload.clubs) {
        const gwMatchList = actualMatchLookup[`${gw}_${club.short}`] || [];
        const isClubMatchPlayed = gwMatchList.some((m) => m.finished || m.teamScore !== null);
        if (!isClubMatchPlayed) continue;

        const squad = gwLineupBuilt.lineupReviewPerClub[club.short] || [];
        const starters = squad.filter((s) => s.role === 'starting');
        const clubStartersHit = starters.filter((s) => s.realStarted).length;
        const missedStarters = starters.filter((s) => !s.realStarted).map((s) => ({ id: s.id, name: s.webName, pos: s.position }));
        const unexpectedStarters = squad
          .filter((s) => s.role !== 'starting' && s.realStarted)
          .map((s) => ({ id: s.id, name: s.webName, pos: s.position }));

        totalStartersHit += clubStartersHit;
        totalStartersPredicted += 11;

        clubsLineupDetail.push({
          club,
          startersHit: clubStartersHit,
          startersTotal: 11,
          accuracyPct: Math.round((clubStartersHit / 11) * 100),
          missedStarters,
          unexpectedStarters,
        });
      }

      // Points MAE evaluation for GW
      let startersSumAbsDiff = 0;
      let startersCount = 0;
      let activeSumAbsDiff = 0;
      let activeCount = 0;
      const posDiffMap: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      const posCountMap: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      let totalProjPts = 0;
      let totalRealPts = 0;
      const playerPerformances: Array<{ id: number; webName: string; teamShort: string; pos: PositionType; xp: number; realPts: number; diff: number }> = [];

      for (const p of projPlayers) {
        const cShort = p.teamShort;
        const clubProjMatches = corePayload.clubGwMatchProjections[`${cShort}_${gw}`] || [];
        if (clubProjMatches.length === 0) continue;

        const realStat = actualPlayerStatsMap[p.id]?.[gw];
        if (!realStat) continue;

        const pos = p.position as PositionType;
        const projCell = p.fullSeasonPointsMap?.[gw];
        const xp = projCell ? projCell.xp ?? 0 : 0;

        const realPts = realStat.pts;
        const realMins = realStat.mins;
        const absDiff = Math.abs(realPts - xp);
        const diff = Math.round((realPts - xp) * 10) / 10;

        totalProjPts += xp;
        totalRealPts += realPts;

        if (realStat.wasStarter) {
          startersSumAbsDiff += absDiff;
          startersCount += 1;
          if (pos in posDiffMap) {
            posDiffMap[pos] += absDiff;
            posCountMap[pos] += 1;
          }
        }

        if (realMins > 0) {
          activeSumAbsDiff += absDiff;
          activeCount += 1;
          playerPerformances.push({
            id: p.id,
            webName: p.webName,
            teamShort: cShort,
            pos,
            xp,
            realPts,
            diff,
          });
        }
      }

      const topOverperformers = [...playerPerformances].sort((a, b) => b.diff - a.diff).slice(0, 5);
      const topUnderperformers = [...playerPerformances].sort((a, b) => a.diff - b.diff).slice(0, 5);

      const isFinished = matchesFinished >= Math.max(matchesInGw.length - 2, 1) || gw < maxReviewGW;
      const teamGoalsMae = matchesFinished > 0 ? Math.round((teamGoalsSumDiff / (matchesFinished * 2)) * 100) / 100 : 0;
      const matchGoalsMae = matchesFinished > 0 ? Math.round((matchGoalsSumDiff / matchesFinished) * 100) / 100 : 0;
      const outcomeAccPct = matchesFinished > 0 ? Math.round((outcomeHits / matchesFinished) * 1000) / 10 : 0;
      const exactScorePct = matchesFinished > 0 ? Math.round((exactScoreHits / matchesFinished) * 1000) / 10 : 0;
      const cleanSheetPct = matchesFinished > 0 ? Math.round((cleanSheetHits / (matchesFinished * 2)) * 1000) / 10 : 0;

      const lineupAccPct = totalStartersPredicted > 0 ? Math.round((totalStartersHit / totalStartersPredicted) * 1000) / 10 : 0;
      const avgStartersPerClub =
        clubsLineupDetail.length > 0 ? Math.round((totalStartersHit / clubsLineupDetail.length) * 10) / 10 : 0;

      const startersXpMae = startersCount > 0 ? Math.round((startersSumAbsDiff / startersCount) * 100) / 100 : 0;
      const activeXpMae = activeCount > 0 ? Math.round((activeSumAbsDiff / activeCount) * 100) / 100 : 0;

      const posMae = {
        GKP: posCountMap.GKP > 0 ? Math.round((posDiffMap.GKP / posCountMap.GKP) * 100) / 100 : 0,
        DEF: posCountMap.DEF > 0 ? Math.round((posDiffMap.DEF / posCountMap.DEF) * 100) / 100 : 0,
        MID: posCountMap.MID > 0 ? Math.round((posDiffMap.MID / posCountMap.MID) * 100) / 100 : 0,
        FWD: posCountMap.FWD > 0 ? Math.round((posDiffMap.FWD / posCountMap.FWD) * 100) / 100 : 0,
      };

      const goalScore = Math.max(0, Math.min(100, Math.round((1 - teamGoalsMae / 2.2) * 100)));
      const ptsScore = Math.max(0, Math.min(100, Math.round((1 - startersXpMae / 5.0) * 100)));
      const compositeScore = Math.round(lineupAccPct * 0.35 + outcomeAccPct * 0.30 + goalScore * 0.15 + ptsScore * 0.20);
      const compositeGrade =
        compositeScore >= 82 ? 'A+' : compositeScore >= 75 ? 'A' : compositeScore >= 68 ? 'B+' : compositeScore >= 60 ? 'B' : 'C';

      const row = {
        gw,
        isFinished,
        matchesTotal: matchesInGw.length,
        matchesFinished,
        teamGoalsMae,
        matchGoalsMae,
        outcomeHits,
        outcomeAccPct,
        probOutcomeHits,
        probOutcomeAccPct: matchesFinished > 0 ? Math.round((probOutcomeHits / matchesFinished) * 1000) / 10 : 0,
        predXgTotal: Math.round(predXgTotal * 10) / 10,
        actualGoalsTotal,
        expCsTotal: Math.round(expCsTotal * 10) / 10,
        scoreCsTotal,
        actualCsTotal,
        congestedCount,
        congestedProbHits,
        congestedAccPct: congestedCount > 0 ? Math.round((congestedProbHits / congestedCount) * 1000) / 10 : null,
        exactScoreHits,
        exactScorePct,
        cleanSheetHits,
        cleanSheetPct,
        matchesDetail,
        totalStartersPredicted,
        totalStartersHit,
        lineupAccPct,
        avgStartersPerClub,
        clubsLineupDetail,
        startersCount,
        startersXpMae,
        activeCount,
        activeXpMae,
        posMae,
        totalProjPts: Math.round(totalProjPts * 10) / 10,
        totalRealPts: Math.round(totalRealPts * 10) / 10,
        ptsBias: Math.round((totalRealPts - totalProjPts) * 10) / 10,
        topOverperformers,
        topUnderperformers,
        compositeScore,
        compositeGrade,
      };

      if (gw < maxReviewGW && isFinished) {
        confirmedMaeRowCache.set(gw, { epochBaseGw: maxReviewGW, row });
      }
      maeRecapRows.push(row);
    }

    const baseCache: ReviewBaseCache = {
      epochKey: epoch.epochKey,
      actualMatchLookup,
      actualPlayerStatsMap,
      maeRecapRows,
      lineupByGwCache,
    };

    cachedReviewBase = baseCache;
    console.log(
      `[ProjectionEngine] Built Review Base epoch=${epoch.epochKey} (${maeRecapRows.length} MAE GWs) in ${Date.now() - startMs}ms`
    );
    return baseCache;
  })();

  inFlightReviewBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightReviewBuild?.promise === buildPromise) {
      inFlightReviewBuild = null;
    }
  }
}

export async function getServerReviewBundle(
  cachedData: TransformedLeagueData,
  requestedLineupGw?: number,
  force: boolean = false
): Promise<ServerReviewBundlePayload> {
  const coreCtx = await getOrBuildCoreContext(cachedData, force);
  const reviewBase = await getOrBuildReviewBase(cachedData, force);
  const maxReviewGW = coreCtx.corePayload.maxReviewGW;
  const targetGw = Math.min(Math.max(Number(requestedLineupGw) || maxReviewGW, 1), maxReviewGW);

  let gwLineup = reviewBase.lineupByGwCache.get(targetGw);
  if (!gwLineup || force) {
    const allPlayers = cachedData.player_stats || [];
    gwLineup = buildLineupReviewForGw(
      targetGw,
      maxReviewGW,
      coreCtx.corePayload.clubs,
      allPlayers,
      reviewBase.actualMatchLookup,
      reviewBase.actualPlayerStatsMap,
      coreCtx.matchesWithLineupsByGw,
      {
        playerPosSeed: coreCtx.playerPosSeed,
        playerTeamMap: coreCtx.playerTeamMap,
        extraAllCompSides: coreCtx.extraAllCompSides,
        deadlines: cachedData.sync_status?.deadlines,
        isCurrentGwFinishedOrConfirmed: coreCtx.epoch.isCurrentGwFinishedOrConfirmed,
        calibByGw: coreCtx.calibByGw,
      }
    );
    reviewBase.lineupByGwCache.set(targetGw, gwLineup);
  }

  return {
    epochKey: coreCtx.epoch.epochKey,
    generatedAt: new Date().toISOString(),
    maxReviewGW,
    lineupGw: targetGw,
    actualMatchLookup: reviewBase.actualMatchLookup,
    actualPlayerStatsMap: reviewBase.actualPlayerStatsMap,
    lineupReviewPerClub: gwLineup.lineupReviewPerClub,
    lineupGwSummary: gwLineup.lineupGwSummary,
    maeRecapRows: reviewBase.maeRecapRows,
  };
}

// ============================================================================
// SCOUT ENGINE: DUAL-BUDGET FH & WC HILL-CLIMBING SOLVER (SERVER CACHED)
// ============================================================================
interface SolverPlayer {
  id: number;
  position: PositionType;
  teamShort: string;
  cost: number;
  pts: number;
  mins: number;
  status: string;
  fullSeasonPointsMap: Record<number, PlayerGwProjectionCell>;
  xP1: number;
  avgXp6: number;
}

function solveServerScoutForGwMode(
  players: SolverPlayer[],
  baseHistoricalGW: number,
  targetNextGW: number,
  targetGw: number,
  mode: 'FH' | 'WC',
  fastMode: boolean = false
) {
  const MAX_XI_BUDGET = 83.0;
  const MAX_SQUAD_BUDGET = 100.0;
  const completedGws = Math.max(baseHistoricalGW, 1);
  const isFH = mode === 'FH';

  if (players.length < 15) {
    return {
      starterIds: [] as number[],
      benchIds: [] as number[],
      xiCost: 0,
      xiBudget: MAX_XI_BUDGET,
      totalCost: 0,
      budget: MAX_SQUAD_BUDGET,
      xiXp: 0,
      formation: '3-4-3',
    };
  }

  const getPlayerGwXp = (p: SolverPlayer, gw: number): number => {
    if (gw === targetNextGW) {
      if (p.status === 'i' || p.status === 's' || p.status === 'u') return 0;
      return p.xP1;
    }
    const cell = p.fullSeasonPointsMap?.[gw];
    if (cell && typeof cell.xp === 'number') {
      return Math.round(cell.xp * 10) / 10;
    }
    return p.xP1;
  };

  const wcEndGw = Math.min(38, targetGw + 5);
  const avgWindowXp = (p: SolverPlayer, startGw: number, endGw: number) => {
    let sum = 0;
    let cnt = 0;
    for (let g = startGw; g <= endGw; g++) {
      sum += getPlayerGwXp(p, g);
      cnt++;
    }
    return cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : getPlayerGwXp(p, startGw);
  };

  const xpCache = new Map<number, number>();
  const tieCache = new Map<number, number>();
  for (const p of players) {
    const g1 = getPlayerGwXp(p, targetGw);
    const g6 =
      targetGw === targetNextGW && wcEndGw === Math.min(38, targetNextGW + 5)
        ? p.avgXp6
        : avgWindowXp(p, targetGw, wcEndGw);
    xpCache.set(p.id, isFH ? g1 : g6);
    tieCache.set(p.id, isFH ? g6 : g1);
  }

  const getXp = (p: SolverPlayer) => xpCache.get(p.id) ?? 0;
  const getTie = (p: SolverPlayer) => tieCache.get(p.id) ?? 0;
  const benchWeight = isFH ? 0.012 : 0.035;

  const minMins = Math.min(90, completedGws * 20);
  const fitCandidates = players.filter((p) => {
    if (targetGw === targetNextGW) return p.status === 'a' && p.mins >= minMins;
    return getPlayerGwXp(p, targetGw) > 0 && p.mins >= minMins;
  });
  const backupCandidates = players.filter((p) => {
    if (targetGw === targetNextGW) return p.status !== 'i' && p.status !== 'u';
    return getPlayerGwXp(p, targetGw) > 0 || (p.status !== 'i' && p.status !== 'u');
  });

  const posPool: Record<'GKP' | 'DEF' | 'MID' | 'FWD', SolverPlayer[]> = {
    GKP: [],
    DEF: [],
    MID: [],
    FWD: [],
  };

  const topN = fastMode ? 14 : 18;
  const valN = fastMode ? 8 : 12;
  const cheapN = fastMode ? 6 : 8;

  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
    const primary = fitCandidates.filter((p) => p.position === pos);
    const source = primary.length >= 6 ? primary : backupCandidates.filter((p) => p.position === pos);
    const fallback = source.length >= 5 ? source : players.filter((p) => p.position === pos);

    const topXp = [...fallback]
      .sort((a, b) => getXp(b) - getXp(a) || getTie(b) - getTie(a) || b.pts - a.pts || a.cost - b.cost)
      .slice(0, topN);
    const topValue = [...fallback]
      .sort((a, b) => getXp(b) / Math.max(b.cost, 3.8) - getXp(a) / Math.max(a.cost, 3.8))
      .slice(0, valN);
    const cheapPlaying = [...fallback]
      .filter((p) => p.mins / completedGws >= 35)
      .sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a))
      .slice(0, cheapN);
    const ultraCheap = [...fallback].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a)).slice(0, cheapN);

    const merged = new Map<number, SolverPlayer>();
    for (const item of [...topXp, ...topValue, ...cheapPlaying, ...ultraCheap]) {
      merged.set(item.id, item);
    }
    posPool[pos] = Array.from(merged.values());
  }

  const clubIdxMap = new Map<string, number>();
  let nextClubIdx = 0;
  const getClubIdx = (teamShort: string) => {
    let idx = clubIdxMap.get(teamShort);
    if (idx === undefined) {
      idx = nextClubIdx++;
      clubIdxMap.set(teamShort, idx);
    }
    return idx;
  };

  type PoolMeta = {
    p: SolverPlayer;
    id: number;
    posIdx: 0 | 1 | 2 | 3;
    cost: number;
    xp: number;
    tie: number;
    clubIdx: number;
  };

  const POS_TO_IDX: Record<'GKP' | 'DEF' | 'MID' | 'FWD', 0 | 1 | 2 | 3> = {
    GKP: 0,
    DEF: 1,
    MID: 2,
    FWD: 3,
  };

  const metaById = new Map<number, PoolMeta>();
  const posPoolMeta: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
  const posPoolByXpOnly: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];

  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
    const pIdx = POS_TO_IDX[pos];
    const metas = posPool[pos].map((p) => {
      const m: PoolMeta = {
        p,
        id: p.id,
        posIdx: pIdx,
        cost: p.cost,
        xp: getXp(p),
        tie: getTie(p),
        clubIdx: getClubIdx(p.teamShort),
      };
      metaById.set(p.id, m);
      return m;
    });
    posPoolByXpOnly[pIdx] = [...metas].sort((a, b) => b.xp - a.xp);
    posPoolMeta[pIdx] = [...metas].sort((a, b) => b.xp - a.xp || b.tie - a.tie);
  }
  const numClubs = Math.max(nextClubIdx, 1);

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

  const isDualBudgetValidNums = (xiCost: number, cost: number) =>
    xiCost <= MAX_XI_BUDGET + 0.001 && cost <= MAX_SQUAD_BUDGET + 0.001;
  const calcBudgetExcessNums = (xiCost: number, cost: number) =>
    Math.max(0, xiCost - MAX_XI_BUDGET) + Math.max(0, cost - MAX_SQUAD_BUDGET);
  const cmpMeta = (a: PoolMeta, b: PoolMeta) => (b.xp !== a.xp ? b.xp - a.xp : b.tie - a.tie);

  const scratchArr1: PoolMeta[] = new Array(5);
  const scratchArr2: PoolMeta[] = new Array(5);

  const evalGroup = (arr: PoolMeta[], sCount: number) => {
    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const evalReplaced1 = (arr: PoolMeta[], replaceIdx: number, inM: PoolMeta, sCount: number) => {
    const len = arr.length;
    let w = 0;
    let inserted = false;
    for (let i = 0; i < len; i++) {
      if (i === replaceIdx) continue;
      const cur = arr[i];
      if (!inserted && cmpMeta(cur, inM) > 0) {
        scratchArr1[w++] = inM;
        inserted = true;
      }
      scratchArr1[w++] = cur;
    }
    if (!inserted) scratchArr1[w++] = inM;

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr1[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const evalReplaced2Same = (
    arr: PoolMeta[],
    idx1: number,
    in1: PoolMeta,
    idx2: number,
    in2: PoolMeta,
    sCount: number
  ) => {
    const len = arr.length;
    const firstIn = cmpMeta(in1, in2) <= 0 ? in1 : in2;
    const secondIn = firstIn === in1 ? in2 : in1;
    let w = 0;
    let ins = 0;
    for (let i = 0; i < len; i++) {
      if (i === idx1 || i === idx2) continue;
      const cur = arr[i];
      if (ins === 0 && cmpMeta(cur, firstIn) > 0) {
        scratchArr2[w++] = firstIn;
        ins = 1;
      }
      if (ins === 1 && cmpMeta(cur, secondIn) > 0) {
        scratchArr2[w++] = secondIn;
        ins = 2;
      }
      scratchArr2[w++] = cur;
    }
    if (ins === 0) {
      scratchArr2[w++] = firstIn;
      scratchArr2[w++] = secondIn;
    } else if (ins === 1) {
      scratchArr2[w++] = secondIn;
    }

    let sXp = 0;
    let bXp = 0;
    let sCost = 0;
    let tCost = 0;
    for (let i = 0; i < len; i++) {
      const item = scratchArr2[i];
      tCost += item.cost;
      if (i < sCount) {
        sXp += item.xp;
        sCost += item.cost;
      } else {
        bXp += item.xp;
      }
    }
    return { sXp, bXp, sCost, tCost };
  };

  const optimizeForFormation = (seedSquad: SolverPlayer[], dCount: number, mCount: number, fCount: number) => {
    const sCounts: [number, number, number, number] = [1, dCount, mCount, fCount];
    const groups: [PoolMeta[], PoolMeta[], PoolMeta[], PoolMeta[]] = [[], [], [], []];
    const clubCounts = new Int32Array(numClubs);
    const currentIds = new Set<number>();

    for (const p of seedSquad) {
      const m = metaById.get(p.id);
      if (!m) return null;
      clubCounts[m.clubIdx]++;
      if (clubCounts[m.clubIdx] > 3) return null;
      groups[m.posIdx].push(m);
      currentIds.add(m.id);
    }
    for (let g = 0; g < 4; g++) groups[g].sort(cmpMeta);

    const gStats = [
      evalGroup(groups[0], sCounts[0]),
      evalGroup(groups[1], sCounts[1]),
      evalGroup(groups[2], sCounts[2]),
      evalGroup(groups[3], sCounts[3]),
    ];

    const getTotals = () => {
      let xiXp = 0;
      let benchXp = 0;
      let rawXiCost = 0;
      let rawCost = 0;
      for (let g = 0; g < 4; g++) {
        xiXp += gStats[g].sXp;
        benchXp += gStats[g].bXp;
        rawXiCost += gStats[g].sCost;
        rawCost += gStats[g].tCost;
      }
      return {
        xiXp,
        benchXp,
        xiCost: Math.round(rawXiCost * 10) / 10,
        cost: Math.round(rawCost * 10) / 10,
        obj: xiXp + benchWeight * benchXp,
      };
    };

    const applySwap1 = (posIdx: 0 | 1 | 2 | 3, slotIdx: number, inM: PoolMeta) => {
      const outM = groups[posIdx][slotIdx];
      currentIds.delete(outM.id);
      currentIds.add(inM.id);
      clubCounts[outM.clubIdx]--;
      clubCounts[inM.clubIdx]++;
      groups[posIdx][slotIdx] = inM;
      groups[posIdx].sort(cmpMeta);
      gStats[posIdx] = evalGroup(groups[posIdx], sCounts[posIdx]);
    };

    let baseTot = getTotals();
    let repairGuard = 0;
    while (calcBudgetExcessNums(baseTot.xiCost, baseTot.cost) > 0.001 && repairGuard < 36) {
      repairGuard++;
      const curExcess = calcBudgetExcessNums(baseTot.xiCost, baseTot.cost);
      let bestPos: 0 | 1 | 2 | 3 = 0;
      let bestSlot = -1;
      let bestIn: PoolMeta | null = null;
      let bestLossPerReduction = Infinity;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = baseTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = baseTot.benchXp - gStats[posIdx].bXp;
        const baseRawXiCost = gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost - gStats[posIdx].sCost;
        const baseRawTotalCost = gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.cost >= outM.cost - 0.05 || currentIds.has(inM.id)) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;
            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = Math.round((baseRawXiCost + rep.sCost) * 10) / 10;
            const nextCost = Math.round((baseRawTotalCost + rep.tCost) * 10) / 10;
            const reduction = curExcess - calcBudgetExcessNums(nextXiCost, nextCost);
            if (reduction <= 0.001) continue;
            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            const lossPerReduction = (baseTot.obj - nextObj) / reduction;
            if (lossPerReduction < bestLossPerReduction) {
              bestLossPerReduction = lossPerReduction;
              bestPos = posIdx;
              bestSlot = slotIdx;
              bestIn = inM;
            }
          }
        }
      }
      if (bestSlot === -1 || !bestIn) break;
      applySwap1(bestPos, bestSlot, bestIn);
      baseTot = getTotals();
    }

    if (!isDualBudgetValidNums(baseTot.xiCost, baseTot.cost)) return null;

    const swapCheapLimit = fastMode ? 4 : 8;
    const swapUpLimit = fastMode ? 3 : 6;
    const flatSlots: Array<{ posIdx: 0 | 1 | 2 | 3; slotIdx: number; m: PoolMeta }> = new Array(15);

    for (let iter = 0; iter < 40; iter++) {
      const stepTot = getTotals();
      const sumRawXiCost = gStats[0].sCost + gStats[1].sCost + gStats[2].sCost + gStats[3].sCost;
      const sumRawCost = gStats[0].tCost + gStats[1].tCost + gStats[2].tCost + gStats[3].tCost;

      let bestNextObj = stepTot.obj + 1e-6;
      let bestSwapKind: 0 | 1 | 2 = 0;
      let b1Pos: 0 | 1 | 2 | 3 = 0;
      let b1Slot = 0;
      let b1In: PoolMeta | null = null;
      let b2Pos: 0 | 1 | 2 | 3 = 0;
      let b2Slot = 0;
      let b2In: PoolMeta | null = null;

      for (let posIdx = 0 as 0 | 1 | 2 | 3; posIdx < 4; posIdx = (posIdx + 1) as 0 | 1 | 2 | 3) {
        const grp = groups[posIdx];
        const pool = posPoolMeta[posIdx];
        const sCnt = sCounts[posIdx];
        const otherXiXp = stepTot.xiXp - gStats[posIdx].sXp;
        const otherBenchXp = stepTot.benchXp - gStats[posIdx].bXp;
        const baseOtherRawXiCost = sumRawXiCost - gStats[posIdx].sCost;
        const baseOtherRawCost = sumRawCost - gStats[posIdx].tCost;

        for (let slotIdx = 0; slotIdx < grp.length; slotIdx++) {
          const outM = grp[slotIdx];
          for (const inM of pool) {
            if (inM.xp <= outM.xp) break;
            if (currentIds.has(inM.id)) continue;
            const nextCost = Math.round((stepTot.cost - outM.cost + inM.cost) * 10) / 10;
            if (nextCost > MAX_SQUAD_BUDGET + 0.001) continue;
            if (inM.clubIdx !== outM.clubIdx && clubCounts[inM.clubIdx] >= 3) continue;

            const rep = evalReplaced1(grp, slotIdx, inM, sCnt);
            const nextXiCost = Math.round((baseOtherRawXiCost + rep.sCost) * 10) / 10;
            const nextTotCost = Math.round((baseOtherRawCost + rep.tCost) * 10) / 10;
            if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

            const nextObj = otherXiXp + rep.sXp + benchWeight * (otherBenchXp + rep.bXp);
            if (nextObj > bestNextObj) {
              bestNextObj = nextObj;
              bestSwapKind = 1;
              b1Pos = posIdx;
              b1Slot = slotIdx;
              b1In = inM;
            }
          }
        }
      }

      if (bestSwapKind === 1 && b1In) {
        applySwap1(b1Pos, b1Slot, b1In);
        continue;
      }

      if (!fastMode || iter < 8) {
        let fIdx = 0;
        for (let p = 0 as 0 | 1 | 2 | 3; p < 4; p = (p + 1) as 0 | 1 | 2 | 3) {
          const grp = groups[p];
          for (let s = 0; s < grp.length; s++) flatSlots[fIdx++] = { posIdx: p, slotIdx: s, m: grp[s] };
        }

        const cheaperBySlot: PoolMeta[][] = new Array(15);
        const upgradesBySlot: PoolMeta[][] = new Array(15);
        for (let k = 0; k < 15; k++) {
          const slot = flatSlots[k];
          const outM = slot.m;
          const xpPool = posPoolByXpOnly[slot.posIdx];
          const cheapList: PoolMeta[] = [];
          const upList: PoolMeta[] = [];
          for (let idx = 0; idx < xpPool.length; idx++) {
            const cand = xpPool[idx];
            if (currentIds.has(cand.id)) continue;
            if (cand.cost < outM.cost - 0.05 && cheapList.length < swapCheapLimit) cheapList.push(cand);
            if (cand.xp > outM.xp) upList.push(cand);
          }
          cheaperBySlot[k] = cheapList;
          upgradesBySlot[k] = upList;
        }

        for (let i = 0; i < 15; i++) {
          const s1 = flatSlots[i];
          const out1 = s1.m;
          const cheaper1 = cheaperBySlot[i];
          if (cheaper1.length === 0) continue;

          for (let c1 = 0; c1 < cheaper1.length; c1++) {
            const in1 = cheaper1[c1];
            const remSquadBudget = MAX_SQUAD_BUDGET - (stepTot.cost - out1.cost + in1.cost);

            for (let j = 0; j < 15; j++) {
              if (j === i) continue;
              const s2 = flatSlots[j];
              const out2 = s2.m;
              const upAll = upgradesBySlot[j];
              let takenUp = 0;

              for (let u2 = 0; u2 < upAll.length && takenUp < swapUpLimit; u2++) {
                const in2 = upAll[u2];
                if (in2.id === in1.id || in2.cost - out2.cost > remSquadBudget + 0.001) continue;
                takenUp++;

                const oc1 = out1.clubIdx;
                const oc2 = out2.clubIdx;
                const ic1 = in1.clubIdx;
                const ic2 = in2.clubIdx;
                if (ic1 === ic2) {
                  const freed = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed + 2 > 3) continue;
                } else {
                  const freed1 = (oc1 === ic1 ? 1 : 0) + (oc2 === ic1 ? 1 : 0);
                  if (clubCounts[ic1] - freed1 + 1 > 3) continue;
                  const freed2 = (oc1 === ic2 ? 1 : 0) + (oc2 === ic2 ? 1 : 0);
                  if (clubCounts[ic2] - freed2 + 1 > 3) continue;
                }

                let nextXiXp: number;
                let nextBenchXp: number;
                let nextRawXiCost: number;
                let nextRawTotalCost: number;

                if (s1.posIdx === s2.posIdx) {
                  const grp = groups[s1.posIdx];
                  const rep = evalReplaced2Same(grp, s1.slotIdx, in1, s2.slotIdx, in2, sCounts[s1.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp + rep.sXp;
                  nextBenchXp = stepTot.benchXp - gStats[s1.posIdx].bXp + rep.bXp;
                  nextRawXiCost = sumRawXiCost - gStats[s1.posIdx].sCost + rep.sCost;
                  nextRawTotalCost = sumRawCost - gStats[s1.posIdx].tCost + rep.tCost;
                } else {
                  const rep1 = evalReplaced1(groups[s1.posIdx], s1.slotIdx, in1, sCounts[s1.posIdx]);
                  const rep2 = evalReplaced1(groups[s2.posIdx], s2.slotIdx, in2, sCounts[s2.posIdx]);
                  nextXiXp = stepTot.xiXp - gStats[s1.posIdx].sXp - gStats[s2.posIdx].sXp + rep1.sXp + rep2.sXp;
                  nextBenchXp = stepTot.benchXp - gStats[s1.posIdx].bXp - gStats[s2.posIdx].bXp + rep1.bXp + rep2.bXp;
                  nextRawXiCost = sumRawXiCost - gStats[s1.posIdx].sCost - gStats[s2.posIdx].sCost + rep1.sCost + rep2.sCost;
                  nextRawTotalCost = sumRawCost - gStats[s1.posIdx].tCost - gStats[s2.posIdx].tCost + rep1.tCost + rep2.tCost;
                }

                const nextXiCost = Math.round(nextRawXiCost * 10) / 10;
                const nextTotCost = Math.round(nextRawTotalCost * 10) / 10;
                if (!isDualBudgetValidNums(nextXiCost, nextTotCost)) continue;

                const nextObj = nextXiXp + benchWeight * nextBenchXp;
                if (nextObj > bestNextObj) {
                  bestNextObj = nextObj;
                  bestSwapKind = 2;
                  b1Pos = s1.posIdx;
                  b1Slot = s1.slotIdx;
                  b1In = in1;
                  b2Pos = s2.posIdx;
                  b2Slot = s2.slotIdx;
                  b2In = in2;
                }
              }
            }
          }
        }
      }

      if (bestSwapKind === 2 && b1In && b2In) {
        if (b1Pos === b2Pos) {
          const out1 = groups[b1Pos][b1Slot];
          const out2 = groups[b2Pos][b2Slot];
          currentIds.delete(out1.id);
          currentIds.delete(out2.id);
          currentIds.add(b1In.id);
          currentIds.add(b2In.id);
          clubCounts[out1.clubIdx]--;
          clubCounts[out2.clubIdx]--;
          clubCounts[b1In.clubIdx]++;
          clubCounts[b2In.clubIdx]++;
          groups[b1Pos][b1Slot] = b1In;
          groups[b2Pos][b2Slot] = b2In;
          groups[b1Pos].sort(cmpMeta);
          gStats[b1Pos] = evalGroup(groups[b1Pos], sCounts[b1Pos]);
        } else {
          applySwap1(b1Pos, b1Slot, b1In);
          applySwap1(b2Pos, b2Slot, b2In);
        }
      } else {
        break;
      }
    }

    const finalTot = getTotals();
    if (!isDualBudgetValidNums(finalTot.xiCost, finalTot.cost)) return null;

    const starterIds: number[] = [
      groups[0][0].id,
      ...groups[1].slice(0, dCount).map((m) => m.id),
      ...groups[2].slice(0, mCount).map((m) => m.id),
      ...groups[3].slice(0, fCount).map((m) => m.id),
    ];
    const benchOut = [
      ...groups[1].slice(dCount),
      ...groups[2].slice(mCount),
      ...groups[3].slice(fCount),
    ]
      .sort((a, b) => b.xp - a.xp)
      .map((m) => m.id);
    const benchIds: number[] = groups[0][1] ? [groups[0][1].id, ...benchOut] : benchOut;

    return {
      starterIds,
      benchIds,
      xiXp: finalTot.xiXp,
      xiCost: finalTot.xiCost,
      cost: finalTot.cost,
      obj: finalTot.obj,
      formation: `${dCount}-${mCount}-${fCount}`,
    };
  };

  const buildCheapestSeed = () => {
    const picked: SolverPlayer[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const quotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 2],
      ['DEF', 5],
      ['MID', 5],
      ['FWD', 3],
    ];
    for (const [pos, need] of quotas) {
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
          picked.push(p);
          used.add(p.id);
          cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
          taken++;
        }
      }
    }
    return picked;
  };

  const buildTopDownSeed = (dCount: number, mCount: number, fCount: number) => {
    const picked: SolverPlayer[] = [];
    const cc: Record<string, number> = {};
    const used = new Set<number>();
    const tryAdd = (p: SolverPlayer) => {
      if (!used.has(p.id) && (cc[p.teamShort] || 0) < 3) {
        picked.push(p);
        used.add(p.id);
        cc[p.teamShort] = (cc[p.teamShort] || 0) + 1;
        return true;
      }
      return false;
    };
    const starterQuotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 1],
      ['DEF', dCount],
      ['MID', mCount],
      ['FWD', fCount],
    ];
    for (const [pos, need] of starterQuotas) {
      const list = [...posPool[pos]].sort((a, b) => getXp(b) - getXp(a) || a.cost - b.cost);
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    const benchQuotas: Array<['GKP' | 'DEF' | 'MID' | 'FWD', number]> = [
      ['GKP', 1],
      ['DEF', 5 - dCount],
      ['MID', 5 - mCount],
      ['FWD', 3 - fCount],
    ];
    for (const [pos, need] of benchQuotas) {
      if (need <= 0) continue;
      const list = [...posPool[pos]].sort((a, b) => a.cost - b.cost || getXp(b) - getXp(a));
      let taken = 0;
      for (const p of list) {
        if (taken >= need) break;
        if (tryAdd(p)) taken++;
      }
    }
    return picked;
  };

  const cheapSeed = buildCheapestSeed();
  let bestOverall: ReturnType<typeof optimizeForFormation> = null;

  for (const [dCount, mCount, fCount] of FORMATIONS) {
    const seeds = [cheapSeed, buildTopDownSeed(dCount, mCount, fCount)];
    for (const seed of seeds) {
      if (seed.length !== 15) continue;
      const res = optimizeForFormation(seed, dCount, mCount, fCount);
      if (!res) continue;
      if (
        !bestOverall ||
        res.obj > bestOverall.obj + 1e-6 ||
        (Math.abs(res.obj - bestOverall.obj) <= 1e-6 && res.xiXp > bestOverall.xiXp)
      ) {
        bestOverall = res;
      }
    }
  }

  if (!bestOverall) {
    const s15 = cheapSeed.slice(0, 15);
    const gkps = s15.filter((p) => p.position === 'GKP');
    const defs = s15.filter((p) => p.position === 'DEF');
    const mids = s15.filter((p) => p.position === 'MID');
    const fwds = s15.filter((p) => p.position === 'FWD');
    const st = [gkps[0], ...defs.slice(0, 3), ...mids.slice(0, 4), ...fwds.slice(0, 3)].filter(Boolean);
    const bn = [gkps[1], ...defs.slice(3), ...mids.slice(4), ...fwds.slice(3)].filter(Boolean);
    return {
      starterIds: st.map((p) => p.id),
      benchIds: bn.map((p) => p.id),
      xiCost: Math.round(st.reduce((s, p) => s + p.cost, 0) * 10) / 10,
      xiBudget: MAX_XI_BUDGET,
      totalCost: Math.round(s15.reduce((s, p) => s + p.cost, 0) * 10) / 10,
      budget: MAX_SQUAD_BUDGET,
      xiXp: Math.round(st.reduce((s, p) => s + getXp(p), 0) * 10) / 10,
      formation: '3-4-3',
    };
  }

  return {
    starterIds: bestOverall.starterIds,
    benchIds: bestOverall.benchIds,
    xiCost: bestOverall.xiCost,
    xiBudget: MAX_XI_BUDGET,
    totalCost: bestOverall.cost,
    budget: MAX_SQUAD_BUDGET,
    xiXp: Math.round(bestOverall.xiXp * 10) / 10,
    formation: bestOverall.formation,
  };
}

export async function getServerScoutSquads(
  cachedData: TransformedLeagueData,
  force: boolean = false
): Promise<ServerScoutSquadsPayload> {
  const epoch = computeProjectionEpochInfo(cachedData);
  if (!force && cachedScoutPayload && cachedScoutPayload.epochKey === epoch.epochKey) {
    return cachedScoutPayload;
  }
  if (!force && inFlightScoutBuild && inFlightScoutBuild.epochKey === epoch.epochKey) {
    return inFlightScoutBuild.promise;
  }

  const buildPromise = (async (): Promise<ServerScoutSquadsPayload> => {
    const startMs = Date.now();
    const coreCtx = await getOrBuildCoreContext(cachedData, force);
    const { baseHistoricalGW, targetNextGW } = coreCtx.epoch;
    const rawById = new Map((cachedData.player_stats || []).map((p) => [p.id, p]));

    const solverPlayers: SolverPlayer[] = coreCtx.corePayload.allPlayerFullSeasonProjections.map((proj) => {
      const raw = rawById.get(proj.id);
      const cell1 = proj.fullSeasonPointsMap?.[targetNextGW];
      const xP1 = cell1?.xp ?? 0;

      const wcGws = [targetNextGW, targetNextGW + 1, targetNextGW + 2, targetNextGW + 3, targetNextGW + 4, targetNextGW + 5].filter(
        (g) => g <= 38
      );
      const sum6 = wcGws.reduce((s, g) => s + (proj.fullSeasonPointsMap?.[g]?.xp ?? xP1), 0);
      const avgXp6 = wcGws.length > 0 ? Number((sum6 / wcGws.length).toFixed(1)) : xP1;

      return {
        id: proj.id,
        position: proj.position,
        teamShort: proj.teamShort,
        cost: proj.nowCost,
        pts: raw?.totalPoints || 0,
        mins: Math.max(raw?.minutes || 0, 1),
        status: proj.status || 'a',
        fullSeasonPointsMap: proj.fullSeasonPointsMap,
        xP1: Number(xP1.toFixed(1)),
        avgXp6,
      };
    });

    const fhTarget = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, targetNextGW, 'FH', false);
    const wcTarget = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, targetNextGW, 'WC', false);

    const halfEndGW = targetNextGW >= 20 ? 38 : 19;
    const chipSetByGw: Record<number, { fhSquadIds: number[]; wcSquadIds: number[] }> = {};

    for (let g = targetNextGW; g <= halfEndGW; g++) {
      if (g === targetNextGW) {
        chipSetByGw[g] = {
          fhSquadIds: [...fhTarget.starterIds, ...fhTarget.benchIds],
          wcSquadIds: [...wcTarget.starterIds, ...wcTarget.benchIds],
        };
      } else {
        const fhRes = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, g, 'FH', true);
        const wcRes = solveServerScoutForGwMode(solverPlayers, baseHistoricalGW, targetNextGW, g, 'WC', true);
        chipSetByGw[g] = {
          fhSquadIds: [...fhRes.starterIds, ...fhRes.benchIds],
          wcSquadIds: [...wcRes.starterIds, ...wcRes.benchIds],
        };
      }
    }

    const payload: ServerScoutSquadsPayload = {
      epochKey: coreCtx.epoch.epochKey,
      generatedAt: new Date().toISOString(),
      targetNextGW,
      fhTarget,
      wcTarget,
      chipSetByGw,
    };

    cachedScoutPayload = payload;
    console.log(
      `[ProjectionEngine] Solved Scout FH/WC Squads epoch=${coreCtx.epoch.epochKey} (${Object.keys(chipSetByGw).length} GWs) in ${Date.now() - startMs}ms`
    );
    return payload;
  })();

  inFlightScoutBuild = { epochKey: epoch.epochKey, promise: buildPromise };
  try {
    return await buildPromise;
  } finally {
    if (inFlightScoutBuild?.promise === buildPromise) {
      inFlightScoutBuild = null;
    }
  }
}
