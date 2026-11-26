import fs from 'fs';
import path from 'path';
import type { PositionType } from '../types.ts';
import { getFplDatabase } from './db.ts';
import {
  PULSE_BASE,
  PULSE_HEADERS,
  fetchSdpNormalizedMatch,
  getCachedBootstrapStatic,
} from './matchesFetcher.ts';
import {
  lookupPulsePlayerPosition,
  mapPulseCharToFplPos,
  normalizePulsePersonKey,
  recordPulseFixturePositions,
} from './pulsePlayerPositions.ts';
import { CanonicalTacticalRole, getFormationRoleMatrix } from '../utils/tacticalLineupModel.ts';

const DATA_DIR = path.join(process.cwd(), 'src/data');
export const PULSE_ALL_COMP_SCHEDULE_PATH = path.join(DATA_DIR, 'pulseAllCompSchedule.json');
export const PULSE_ALL_COMP_HISTORY_PATH = path.join(DATA_DIR, 'pulseAllCompHistory.json');

// Official senior competitions relevant to EPL clubs (excludes friendlies/youth)
export const OFFICIAL_PULSE_COMP_IDS = [1, 2, 3, 2247, 4, 5, 492] as const;

export const COMP_META_BY_ID: Record<number, { abbr: string; desc: string; weight: number }> = {
  1: { abbr: 'EN_PR', desc: 'Premier League', weight: 1.0 },
  2: { abbr: 'EU_CL', desc: 'UEFA Champions League', weight: 0.9 },
  3: { abbr: 'EU_UC', desc: 'UEFA Europa League', weight: 0.85 },
  2247: { abbr: 'EU_CF', desc: 'UEFA Conference League', weight: 0.78 },
  4: { abbr: 'EN_FA', desc: 'FA Cup', weight: 0.72 },
  5: { abbr: 'EN_LC', desc: 'EFL Cup', weight: 0.6 },
  492: { abbr: 'EN_FC', desc: 'English Community Shield', weight: 0.65 },
};

const SCHEDULE_REFRESH_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DETAIL_FETCH_CONCURRENCY = 8;

export interface PulseCompSeasonMeta {
  compId: number;
  compAbbr: string;
  compDesc: string;
  seasonId: number;
  seasonLabel: string;
}

export interface PulseAllCompClubMeta {
  pulseTeamId: number;
  fplTeamId?: number;
  short: string;
  name: string;
}

export interface PulseAllCompFixtureRecord {
  pulseMatchId: number;
  optaCode: number | null;
  compId: number;
  compAbbr: string;
  compDesc: string;
  compSeasonId: number;
  eplGw: number | null;
  kickoffMs: number;
  kickoffIso: string;
  status: 'U' | 'L' | 'C';
  homePulseTeamId: number;
  awayPulseTeamId: number;
  homeShort: string | null;
  awayShort: string | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  outcome?: string;
  detailFinalized: boolean;
  detailHasLineup?: boolean;
  detailSyncedAt?: string;
}

export interface PulseAllCompScheduleDb {
  schemaVersion: 1;
  plSeasonId: number;
  plSeasonLabel: string;
  updatedAt: string;
  compSeasons: PulseCompSeasonMeta[];
  clubs: PulseAllCompClubMeta[];
  fixtures: PulseAllCompFixtureRecord[];
}

export interface PulseAllCompPlayerRecord {
  pulsePlayerId: number;
  optaCode: number | null;
  fplId: number | null;
  name: string;
  position: PositionType;
  positionInfo?: string;
  tacticalRole?: CanonicalTacticalRole;
  isStarter: boolean;
  minutes: number;
  subbedOnMinute?: number;
  subbedOffMinute?: number;
  redCardMinute?: number;
}

export interface PulseAllCompClubSide {
  clubShort: string;
  pulseTeamId: number;
  isHome: boolean;
  oppName: string;
  oppShort: string | null;
  teamScore: number | null;
  oppScore: number | null;
  formationLabel?: string;
  outfieldSlots?: CanonicalTacticalRole[];
  starters: PulseAllCompPlayerRecord[];
  subs: PulseAllCompPlayerRecord[];
  starterFplIds: number[];
  subOnFplIds: number[];
  unusedBenchFplIds: number[];
  starterRolesByFplId: Record<number, CanonicalTacticalRole>;
  minutesByFplId: Record<number, number>;
  nonFplStartersCount: number;
}

export interface PulseAllCompMatchRecord {
  pulseMatchId: number;
  optaCode: number | null;
  compId: number;
  compAbbr: string;
  compDesc: string;
  compWeight: number;
  eplGw: number | null;
  kickoffMs: number;
  kickoffIso: string;
  status: 'L' | 'C';
  finalized: boolean;
  durationMins: number;
  syncedAt: string;
  sides: PulseAllCompClubSide[];
}

export interface PulseAllCompHistorySummary {
  totalMatches: number;
  finalizedMatches: number;
  totalClubSides: number;
  byComp: Record<string, { matches: number; clubSides: number }>;
  mappedFplAppearances: number;
  unmappedAppearances: number;
}

export interface PulseAllCompHistoryDb {
  schemaVersion: 1;
  plSeasonId: number;
  updatedAt: string;
  summary: PulseAllCompHistorySummary;
  matches: Record<number, PulseAllCompMatchRecord>;
}

export interface SyncPulseAllCompResult {
  scheduleFixturesTotal: number;
  completedFixturesTotal: number;
  newlyFetchedMatches: number;
  skippedFinalized: number;
  failedMatches: number;
  durationMs: number;
  summary: PulseAllCompHistorySummary;
}

export type AllCompSyncWindowMode =
  | 'IDLE'
  | 'LINEUP_WINDOW'
  | 'FT_WINDOW'
  | 'CATCHUP_WINDOW'
  | 'SCHEDULE_REFRESH';

export interface AllCompSyncTargetFixture {
  pulseMatchId: number;
  compId: number;
  compAbbr: string;
  homeShort: string | null;
  awayShort: string | null;
  homeName: string;
  awayName: string;
  kickoffMs: number;
  kickoffIso: string;
  status: 'U' | 'L' | 'C';
  windowRole: 'LINEUP' | 'FT' | 'CATCHUP';
}

export interface AllCompSyncPlan {
  mode: AllCompSyncWindowMode;
  reason: string;
  nowIso: string;
  scheduleFresh: boolean;
  activeTargets: AllCompSyncTargetFixture[];
  nextWakeAtMs: number;
  nextWakeIso: string;
  nextWakeWib: string;
  nextWakeLabel: string;
  nextUpcomingNonPl?: {
    pulseMatchId: number;
    compAbbr: string;
    label: string;
    kickoffMs: number;
    kickoffIso: string;
    kickoffWib: string;
    lineupWindowStartMs: number;
    lineupWindowWib: string;
  } | null;
}

export interface EventDrivenAllCompTickResult {
  ran: boolean;
  mode: AllCompSyncWindowMode;
  scheduleRefreshed: boolean;
  lineupsCaptured: number;
  newlyFinalizedMatches: number;
  newlyFinalizedNonPlCount: number;
  durationMs: number;
  plan: AllCompSyncPlan;
}

// In-memory state & O(1) lookup indices
let scheduleDbState: PulseAllCompScheduleDb | null = null;
let historyDbState: PulseAllCompHistoryDb | null = null;
const clubFixturesIndex = new Map<string, PulseAllCompFixtureRecord[]>();
const clubSidesIndex = new Map<string, Array<{ match: PulseAllCompMatchRecord; side: PulseAllCompClubSide }>>();
let inFlightSync: Promise<SyncPulseAllCompResult> | null = null;
let inFlightEventTick: Promise<EventDrivenAllCompTickResult> | null = null;

// Event-driven cooldown timestamps
let lastLineupPollAtMs = 0;
let lastFtPollAtMs = 0;
let lastCatchupPollAtMs = 0;
let lastScheduleAttemptAtMs = 0;

const LINEUP_WINDOW_LEAD_MS = 65 * 60 * 1000;
const LINEUP_WINDOW_TAIL_MS = 10 * 60 * 1000;
const FT_WINDOW_START_MS = 100 * 60 * 1000;
const FT_WINDOW_END_MS = 210 * 60 * 1000;
const OVERDUE_CUTOFF_MS = 125 * 60 * 1000;
const LINEUP_POLL_COOLDOWN_MS = 60 * 1000;
const FT_POLL_COOLDOWN_MS = 90 * 1000;
const CATCHUP_POLL_COOLDOWN_MS = 5 * 60 * 1000;

function createEmptyScheduleDb(): PulseAllCompScheduleDb {
  return {
    schemaVersion: 1,
    plSeasonId: 841,
    plSeasonLabel: 'English Premier League Season 2026/2027',
    updatedAt: '',
    compSeasons: [],
    clubs: [],
    fixtures: [],
  };
}

function createEmptyHistoryDb(): PulseAllCompHistoryDb {
  return {
    schemaVersion: 1,
    plSeasonId: 841,
    updatedAt: '',
    summary: {
      totalMatches: 0,
      finalizedMatches: 0,
      totalClubSides: 0,
      byComp: {},
      mappedFplAppearances: 0,
      unmappedAppearances: 0,
    },
    matches: {},
  };
}

function writeJsonAtomic(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function rebuildScheduleIndices(db: PulseAllCompScheduleDb): void {
  clubFixturesIndex.clear();
  for (const fix of db.fixtures || []) {
    if (fix.homeShort) {
      const list = clubFixturesIndex.get(fix.homeShort) || [];
      list.push(fix);
      clubFixturesIndex.set(fix.homeShort, list);
    }
    if (fix.awayShort && fix.awayShort !== fix.homeShort) {
      const list = clubFixturesIndex.get(fix.awayShort) || [];
      list.push(fix);
      clubFixturesIndex.set(fix.awayShort, list);
    }
  }
  for (const list of clubFixturesIndex.values()) {
    list.sort((a, b) => a.kickoffMs - b.kickoffMs);
  }
}

function recomputeHistorySummary(db: PulseAllCompHistoryDb): PulseAllCompHistorySummary {
  const byComp: Record<string, { matches: number; clubSides: number }> = {};
  let totalMatches = 0;
  let finalizedMatches = 0;
  let totalClubSides = 0;
  let mappedFplAppearances = 0;
  let unmappedAppearances = 0;

  for (const match of Object.values(db.matches || {})) {
    if (!match.finalized) continue;
    totalMatches++;
    finalizedMatches++;
    const compKey = match.compAbbr || String(match.compId);
    if (!byComp[compKey]) byComp[compKey] = { matches: 0, clubSides: 0 };
    byComp[compKey].matches++;
    for (const side of match.sides || []) {
      totalClubSides++;
      byComp[compKey].clubSides++;
      for (const p of [...(side.starters || []), ...(side.subs || [])]) {
        if (p.fplId && p.fplId > 0) mappedFplAppearances++;
        else unmappedAppearances++;
      }
    }
  }

  return {
    totalMatches,
    finalizedMatches,
    totalClubSides,
    byComp,
    mappedFplAppearances,
    unmappedAppearances,
  };
}

function rebuildHistoryIndices(db: PulseAllCompHistoryDb): void {
  clubSidesIndex.clear();
  const sortedMatches = Object.values(db.matches || {})
    .filter((m) => Boolean(m?.finalized))
    .sort((a, b) => a.kickoffMs - b.kickoffMs);
  for (const match of sortedMatches) {
    for (const side of match.sides || []) {
      const key = side.clubShort.toUpperCase();
      const list = clubSidesIndex.get(key) || [];
      list.push({ match, side });
      clubSidesIndex.set(key, list);
    }
  }
}

export function initPulseAllCompDb(): void {
  if (!scheduleDbState) {
    if (fs.existsSync(PULSE_ALL_COMP_SCHEDULE_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(PULSE_ALL_COMP_SCHEDULE_PATH, 'utf-8')) as PulseAllCompScheduleDb;
        if (parsed && Array.isArray(parsed.fixtures)) {
          scheduleDbState = parsed;
          rebuildScheduleIndices(scheduleDbState);
        }
      } catch (err: any) {
        console.warn('[PulseAllCompDB] Failed reading schedule DB from disk:', err?.message || err);
      }
    }
    if (!scheduleDbState) {
      scheduleDbState = createEmptyScheduleDb();
    }
  }

  if (!historyDbState) {
    if (fs.existsSync(PULSE_ALL_COMP_HISTORY_PATH)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(PULSE_ALL_COMP_HISTORY_PATH, 'utf-8')) as PulseAllCompHistoryDb;
        if (parsed && parsed.matches && typeof parsed.matches === 'object') {
          historyDbState = parsed;
          rebuildHistoryIndices(historyDbState);
        }
      } catch (err: any) {
        console.warn('[PulseAllCompDB] Failed reading history DB from disk:', err?.message || err);
      }
    }
    if (!historyDbState) {
      historyDbState = createEmptyHistoryDb();
    }
  }
}

// Seed from disk immediately at module load (<5ms)
initPulseAllCompDb();

export function getPulseAllCompScheduleDb(): PulseAllCompScheduleDb {
  initPulseAllCompDb();
  return scheduleDbState!;
}

export function getPulseAllCompHistoryDb(): PulseAllCompHistoryDb {
  initPulseAllCompDb();
  return historyDbState!;
}

export function getClubAllCompSchedule(clubShort: string): PulseAllCompFixtureRecord[] {
  initPulseAllCompDb();
  return clubFixturesIndex.get(String(clubShort || '').toUpperCase()) || [];
}

export function getClubAllCompHistory(
  clubShort: string
): Array<{ match: PulseAllCompMatchRecord; side: PulseAllCompClubSide }> {
  initPulseAllCompDb();
  return clubSidesIndex.get(String(clubShort || '').toUpperCase()) || [];
}

export function formatWibTimeShort(ms: number): string {
  return new Date(ms).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatWibDateTimeShort(ms: number): string {
  const datePart = new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
  });
  return `${datePart} ${formatWibTimeShort(ms)} WIB`;
}

function formatCompBadgeLabel(compAbbr?: string): string {
  if (compAbbr === 'EU_CL') return 'UCL';
  if (compAbbr === 'EU_UC') return 'UEL';
  if (compAbbr === 'EU_CF') return 'UECL';
  if (compAbbr === 'EN_FA') return 'FA Cup';
  if (compAbbr === 'EN_LC') return 'EFL Cup';
  if (compAbbr === 'EN_FC') return 'Comm. Shield';
  if (compAbbr === 'EN_PR') return 'EPL';
  return compAbbr || 'Match';
}

function formatFixtureMatchLabel(fix: {
  compAbbr?: string;
  homeShort?: string | null;
  awayShort?: string | null;
  homeName: string;
  awayName: string;
}): string {
  const h = fix.homeShort || fix.homeName;
  const a = fix.awayShort || fix.awayName;
  return `${formatCompBadgeLabel(fix.compAbbr)}: ${h} vs ${a}`;
}

export function getPulseAllCompHistoryEpoch(): string {
  initPulseAllCompDb();
  const hist = historyDbState!;
  let nonPlFinalizedCount = 0;
  let maxNonPlKickoffMs = 0;
  for (const m of Object.values(hist.matches || {})) {
    if (!m?.finalized || m.compId === 1) continue;
    nonPlFinalizedCount++;
    if (m.kickoffMs > maxNonPlKickoffMs) maxNonPlKickoffMs = m.kickoffMs;
  }
  return `${nonPlFinalizedCount}:${maxNonPlKickoffMs}`;
}

export function getAllCompSyncPlan(nowMs: number = Date.now()): AllCompSyncPlan {
  initPulseAllCompDb();
  const sched = scheduleDbState!;
  const hist = historyDbState!;

  const updatedAtMs = sched.updatedAt ? Date.parse(sched.updatedAt) : NaN;
  const scheduleFresh =
    sched.fixtures.length > 0 &&
    Number.isFinite(updatedAtMs) &&
    nowMs - updatedAtMs < SCHEDULE_REFRESH_TTL_MS;

  const lineupTargets: AllCompSyncTargetFixture[] = [];
  const ftTargets: AllCompSyncTargetFixture[] = [];
  const catchupTargets: AllCompSyncTargetFixture[] = [];

  let nextUpcomingNonPlFix: PulseAllCompFixtureRecord | null = null;

  for (const fix of sched.fixtures || []) {
    const isFinalized = Boolean(hist.matches[fix.pulseMatchId]?.finalized || fix.detailFinalized);
    const hasLineup = Boolean(
      fix.detailHasLineup ||
        isFinalized ||
        (hist.matches[fix.pulseMatchId]?.sides?.length || 0) > 0
    );

    // Track upcoming/ongoing Non-EPL matches for schedule lookahead & event windows
    if (fix.compId !== 1) {
      if (!isFinalized && fix.kickoffMs > 0) {
        const diffFromKo = nowMs - fix.kickoffMs;

        // Window A: Pre-match Lineup Capture (T-65m .. T+10m) until lineup captured
        if (!hasLineup && diffFromKo >= -LINEUP_WINDOW_LEAD_MS && diffFromKo <= LINEUP_WINDOW_TAIL_MS) {
          lineupTargets.push({
            pulseMatchId: fix.pulseMatchId,
            compId: fix.compId,
            compAbbr: fix.compAbbr,
            homeShort: fix.homeShort,
            awayShort: fix.awayShort,
            homeName: fix.homeName,
            awayName: fix.awayName,
            kickoffMs: fix.kickoffMs,
            kickoffIso: fix.kickoffIso,
            status: fix.status,
            windowRole: 'LINEUP',
          });
        }
        // Window B: Full-Time Finalization (T+100m .. T+210m or actively marked Live)
        else if (
          fix.status === 'L' ||
          (diffFromKo >= FT_WINDOW_START_MS && diffFromKo <= FT_WINDOW_END_MS)
        ) {
          ftTargets.push({
            pulseMatchId: fix.pulseMatchId,
            compId: fix.compId,
            compAbbr: fix.compAbbr,
            homeShort: fix.homeShort,
            awayShort: fix.awayShort,
            homeName: fix.homeName,
            awayName: fix.awayName,
            kickoffMs: fix.kickoffMs,
            kickoffIso: fix.kickoffIso,
            status: fix.status,
            windowRole: 'FT',
          });
        }
        // Window C: Completed in schedule OR overdue past normal duration
        else if (fix.status === 'C' || diffFromKo > OVERDUE_CUTOFF_MS) {
          catchupTargets.push({
            pulseMatchId: fix.pulseMatchId,
            compId: fix.compId,
            compAbbr: fix.compAbbr,
            homeShort: fix.homeShort,
            awayShort: fix.awayShort,
            homeName: fix.homeName,
            awayName: fix.awayName,
            kickoffMs: fix.kickoffMs,
            kickoffIso: fix.kickoffIso,
            status: fix.status,
            windowRole: 'CATCHUP',
          });
        }

        if (fix.status === 'U' && !nextUpcomingNonPlFix && fix.kickoffMs > nowMs - LINEUP_WINDOW_TAIL_MS) {
          nextUpcomingNonPlFix = fix;
        }
      }
    } else if (fix.status === 'C' && !isFinalized) {
      // Catch up any completed EPL fixture missing from all-comp history DB
      catchupTargets.push({
        pulseMatchId: fix.pulseMatchId,
        compId: fix.compId,
        compAbbr: fix.compAbbr,
        homeShort: fix.homeShort,
        awayShort: fix.awayShort,
        homeName: fix.homeName,
        awayName: fix.awayName,
        kickoffMs: fix.kickoffMs,
        kickoffIso: fix.kickoffIso,
        status: fix.status,
        windowRole: 'CATCHUP',
      });
    }
  }

  let mode: AllCompSyncWindowMode = 'IDLE';
  let activeTargets: AllCompSyncTargetFixture[] = [];
  let reason = 'Tidak ada laga non-EPL di jendela sync aktif';
  let nextWakeAtMs = Number.isFinite(updatedAtMs)
    ? updatedAtMs + SCHEDULE_REFRESH_TTL_MS
    : nowMs + SCHEDULE_REFRESH_TTL_MS;
  let nextWakeLabel = `${formatWibDateTimeShort(nextWakeAtMs)} (Refresh Jadwal)`;

  if (ftTargets.length > 0) {
    mode = 'FT_WINDOW';
    activeTargets = ftTargets;
    reason = `${ftTargets.length} laga non-EPL masuk jendela Full-Time / Live`;
    nextWakeAtMs = nowMs + FT_POLL_COOLDOWN_MS;
    nextWakeLabel = `${formatWibTimeShort(nextWakeAtMs)} WIB (FT ${formatFixtureMatchLabel(ftTargets[0])})`;
  } else if (lineupTargets.length > 0) {
    mode = 'LINEUP_WINDOW';
    activeTargets = lineupTargets;
    reason = `${lineupTargets.length} laga non-EPL masuk jendela Lineup (T-65m)`;
    nextWakeAtMs = nowMs + LINEUP_POLL_COOLDOWN_MS;
    nextWakeLabel = `${formatWibTimeShort(nextWakeAtMs)} WIB (Lineup ${formatFixtureMatchLabel(lineupTargets[0])})`;
  } else if (catchupTargets.length > 0) {
    mode = 'CATCHUP_WINDOW';
    activeTargets = catchupTargets;
    reason = `${catchupTargets.length} laga selesai/overdue menunggu finalisasi detail`;
    nextWakeAtMs = nowMs + CATCHUP_POLL_COOLDOWN_MS;
    nextWakeLabel = `${formatWibTimeShort(nextWakeAtMs)} WIB (Catch-up ${formatFixtureMatchLabel(catchupTargets[0])})`;
  } else if (!scheduleFresh) {
    mode = 'SCHEDULE_REFRESH';
    reason = 'Indeks jadwal lintas kompetisi melewati TTL 6 jam';
    nextWakeAtMs = nowMs;
    nextWakeLabel = `${formatWibTimeShort(nowMs)} WIB (Refresh Jadwal)`;
  } else if (nextUpcomingNonPlFix) {
    const lineupAt = nextUpcomingNonPlFix.kickoffMs - LINEUP_WINDOW_LEAD_MS;
    const ftAt = nextUpcomingNonPlFix.kickoffMs + FT_WINDOW_START_MS;
    const targetWake = lineupAt > nowMs ? lineupAt : ftAt;
    const prefix = lineupAt > nowMs ? 'Lineup' : 'FT';
    if (targetWake < nextWakeAtMs) {
      nextWakeAtMs = targetWake;
      nextWakeLabel = `${formatWibDateTimeShort(targetWake)} (${prefix} ${formatFixtureMatchLabel(nextUpcomingNonPlFix)})`;
    }
  }

  const nextUpcomingNonPl = nextUpcomingNonPlFix
    ? {
        pulseMatchId: nextUpcomingNonPlFix.pulseMatchId,
        compAbbr: nextUpcomingNonPlFix.compAbbr,
        label: formatFixtureMatchLabel(nextUpcomingNonPlFix),
        kickoffMs: nextUpcomingNonPlFix.kickoffMs,
        kickoffIso: nextUpcomingNonPlFix.kickoffIso,
        kickoffWib: formatWibDateTimeShort(nextUpcomingNonPlFix.kickoffMs),
        lineupWindowStartMs: nextUpcomingNonPlFix.kickoffMs - LINEUP_WINDOW_LEAD_MS,
        lineupWindowWib: formatWibDateTimeShort(
          nextUpcomingNonPlFix.kickoffMs - LINEUP_WINDOW_LEAD_MS
        ),
      }
    : null;

  return {
    mode,
    reason,
    nowIso: new Date(nowMs).toISOString(),
    scheduleFresh,
    activeTargets,
    nextWakeAtMs,
    nextWakeIso: new Date(nextWakeAtMs).toISOString(),
    nextWakeWib: formatWibDateTimeShort(nextWakeAtMs),
    nextWakeLabel,
    nextUpcomingNonPl,
  };
}

export function getPulseAllCompDbStatus() {
  initPulseAllCompDb();
  const sched = scheduleDbState!;
  const hist = historyDbState!;

  const scheduleByCompStatus: Record<string, { U: number; L: number; C: number }> = {};
  for (const f of sched.fixtures || []) {
    const k = f.compAbbr || String(f.compId);
    if (!scheduleByCompStatus[k]) scheduleByCompStatus[k] = { U: 0, L: 0, C: 0 };
    scheduleByCompStatus[k][f.status] = (scheduleByCompStatus[k][f.status] || 0) + 1;
  }

  const completedFixturesCount = (sched.fixtures || []).filter((f) => f.status === 'C').length;
  const unfinalizedCompletedCount = (sched.fixtures || []).filter(
    (f) => f.status === 'C' && !hist.matches[f.pulseMatchId]?.finalized
  ).length;

  return {
    plSeasonId: sched.plSeasonId,
    plSeasonLabel: sched.plSeasonLabel,
    scheduleUpdatedAt: sched.updatedAt || null,
    historyUpdatedAt: hist.updatedAt || null,
    historyEpoch: getPulseAllCompHistoryEpoch(),
    clubsCount: sched.clubs.length,
    compSeasons: sched.compSeasons,
    scheduleTotalFixtures: sched.fixtures.length,
    completedFixturesCount,
    unfinalizedCompletedCount,
    scheduleByCompStatus,
    historySummary: hist.summary,
    syncPlan: getAllCompSyncPlan(),
    isSyncing: Boolean(inFlightSync || inFlightEventTick),
  };
}

async function fetchJsonSafe(url: string, retries = 2): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14000);
    try {
      const res = await fetch(url, { headers: PULSE_HEADERS, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        return await res.json();
      }
      if (attempt < retries && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 250 + attempt * 300 + Math.random() * 150));
        continue;
      }
      return null;
    } catch {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 + attempt * 300 + Math.random() * 150));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function extractSeasonYearToken(label?: string): string | null {
  const m = String(label || '').match(/(20\d{2}\s*\/\s*20\d{2})/);
  return m ? m[1].replace(/\s+/g, '') : null;
}

async function discoverActiveCompSeasons(): Promise<{
  plSeasonId: number;
  plSeasonLabel: string;
  compSeasons: PulseCompSeasonMeta[];
}> {
  const plData = await fetchJsonSafe(`${PULSE_BASE}/competitions/1/compseasons?page=0&pageSize=3`);
  const plTop = plData?.content?.[0];
  const plSeasonId = Number(plTop?.id) || 841;
  const plSeasonLabel = String(plTop?.label || 'English Premier League Season 2026/2027');
  const targetYear = extractSeasonYearToken(plSeasonLabel);

  const compSeasons: PulseCompSeasonMeta[] = [];
  const nonPlIds = OFFICIAL_PULSE_COMP_IDS.filter((id) => id !== 1);

  compSeasons.push({
    compId: 1,
    compAbbr: COMP_META_BY_ID[1].abbr,
    compDesc: COMP_META_BY_ID[1].desc,
    seasonId: plSeasonId,
    seasonLabel: plSeasonLabel,
  });

  const others = await mapWithConcurrency(nonPlIds, 6, async (compId) => {
    const csData = await fetchJsonSafe(`${PULSE_BASE}/competitions/${compId}/compseasons?page=0&pageSize=4`);
    const list: any[] = Array.isArray(csData?.content) ? csData.content : [];
    if (list.length === 0) return null;
    const matched =
      (targetYear
        ? list.find((s) => extractSeasonYearToken(s?.label) === targetYear)
        : null) || list[0];
    if (!matched?.id) return null;
    // Skip stale seasons from older years if targetYear is known
    if (targetYear) {
      const sy = extractSeasonYearToken(matched.label);
      if (sy && sy !== targetYear) return null;
    }
    const meta = COMP_META_BY_ID[compId] || { abbr: `COMP_${compId}`, desc: `Competition ${compId}`, weight: 0.7 };
    return {
      compId,
      compAbbr: meta.abbr,
      compDesc: meta.desc,
      seasonId: Number(matched.id),
      seasonLabel: String(matched.label || meta.desc),
    } satisfies PulseCompSeasonMeta;
  });

  for (const item of others) {
    if (item) compSeasons.push(item);
  }

  return { plSeasonId, plSeasonLabel, compSeasons };
}

async function resolvePlClubs(
  plSeasonId: number,
  bootstrapTeams?: any[]
): Promise<PulseAllCompClubMeta[]> {
  const teamsResp = await fetchJsonSafe(`${PULSE_BASE}/compseasons/${plSeasonId}/teams`);
  const pulseTeams: any[] = Array.isArray(teamsResp)
    ? teamsResp
    : Array.isArray(teamsResp?.content)
    ? teamsResp.content
    : [];

  const fplByShort = new Map<string, any>();
  const fplByName = new Map<string, any>();
  for (const t of bootstrapTeams || []) {
    if (t?.short_name) fplByShort.set(String(t.short_name).toUpperCase(), t);
    if (t?.name) fplByName.set(normalizePulsePersonKey(t.name), t);
  }

  const clubs: PulseAllCompClubMeta[] = [];
  for (const pt of pulseTeams) {
    const pulseTeamId = Number(pt?.id);
    if (!pulseTeamId) continue;
    const short = String(pt?.club?.abbr || pt?.shortName || '').toUpperCase();
    const name = String(pt?.name || pt?.club?.name || short);
    const fplMatch = fplByShort.get(short) || fplByName.get(normalizePulsePersonKey(name));
    clubs.push({
      pulseTeamId,
      ...(fplMatch?.id ? { fplTeamId: Number(fplMatch.id) } : {}),
      short: fplMatch?.short_name ? String(fplMatch.short_name).toUpperCase() : short,
      name,
    });
  }
  return clubs.sort((a, b) => a.short.localeCompare(b.short));
}

function normalizeTeamShort(rawTeam: any, clubByPulseId: Map<number, PulseAllCompClubMeta>): string | null {
  const pid = Number(rawTeam?.id);
  if (pid && clubByPulseId.has(pid)) {
    return clubByPulseId.get(pid)!.short;
  }
  const abbr = String(rawTeam?.club?.abbr || '').toUpperCase();
  if (abbr) {
    for (const c of clubByPulseId.values()) {
      if (c.short === abbr) return c.short;
    }
  }
  return null;
}

function parseEventMinute(ev: any): number {
  const secs = Number(ev?.clock?.secs);
  const phase = String(ev?.phase || '').trim().toUpperCase();
  if (!Number.isFinite(secs) || secs < 0) return 0;

  if (phase === '1' || phase === '1H') {
    return Math.max(1, Math.min(45, Math.round(secs / 60)));
  }
  if (phase === '2' || phase === '2H') {
    // Halftime sub has secs=2700 -> minute 45; stoppage time capped at 90 for regulation
    return Math.max(45, Math.min(90, Math.round(secs / 60)));
  }
  if (phase === '3' || phase === 'ET1') {
    return Math.max(91, Math.min(105, Math.round(secs / 60)));
  }
  if (phase === '4' || phase === 'ET2') {
    return Math.max(106, Math.min(120, Math.round(secs / 60)));
  }
  return Math.max(0, Math.min(120, Math.round(secs / 60)));
}

interface PlayerIndexMaps {
  byOptaCode: Map<number, any>;
  byClubAndNormName: Map<string, any[]>;
  byNormName: Map<string, any[]>;
  byPulsePersonId: Map<number, number>; // pulsePlayerId -> optaCode (enriched as we scan)
}

function buildFplPlayerIndices(elements: any[], teamIdToShort: Map<number, string>): PlayerIndexMaps {
  const byOptaCode = new Map<number, any>();
  const byClubAndNormName = new Map<string, any[]>();
  const byNormName = new Map<string, any[]>();
  const byPulsePersonId = new Map<number, number>();

  for (const el of elements || []) {
    if (!el?.id) continue;
    const code = Number(el.code);
    if (code > 0) {
      byOptaCode.set(code, el);
    }

    const short = teamIdToShort.get(Number(el.team)) || '';
    const full = `${el.first_name || ''} ${el.second_name || ''}`.trim();
    const nameKeys = new Set<string>([
      normalizePulsePersonKey(full),
      normalizePulsePersonKey(el.web_name),
      normalizePulsePersonKey(el.second_name),
    ]);
    for (const nk of nameKeys) {
      if (!nk) continue;
      if (short) {
        const ck = `${short}|${nk}`;
        const arr = byClubAndNormName.get(ck) || [];
        arr.push(el);
        byClubAndNormName.set(ck, arr);
      }
      const garr = byNormName.get(nk) || [];
      garr.push(el);
      byNormName.set(nk, garr);
    }
  }

  return { byOptaCode, byClubAndNormName, byNormName, byPulsePersonId };
}

function resolveFplElementForPulsePlayer(
  rawPlayer: any,
  clubShort: string,
  indices: PlayerIndexMaps
): { fplEl: any | null; optaCode: number | null } {
  let optaCode: number | null = null;
  if (rawPlayer?.altIds?.opta) {
    const parsed = parseInt(String(rawPlayer.altIds.opta).replace(/\D/g, ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) optaCode = parsed;
  }
  if (!optaCode && Number(rawPlayer?.id) > 0 && String(rawPlayer?.altIds?.opta || '') === `p${rawPlayer.id}`) {
    optaCode = Number(rawPlayer.id);
  }

  if (optaCode) {
    const direct = indices.byOptaCode.get(optaCode);
    if (direct) return { fplEl: direct, optaCode };
  }

  const disp = normalizePulsePersonKey(rawPlayer?.name?.display);
  const firstLast = normalizePulsePersonKey(
    `${rawPlayer?.name?.first || ''} ${rawPlayer?.name?.last || ''}`.trim()
  );
  const last = normalizePulsePersonKey(rawPlayer?.name?.last);

  for (const candidateKey of [firstLast, disp, last]) {
    if (!candidateKey) continue;
    const clubHits = indices.byClubAndNormName.get(`${clubShort}|${candidateKey}`);
    if (clubHits && clubHits.length === 1) {
      return { fplEl: clubHits[0], optaCode: optaCode || Number(clubHits[0].code) || null };
    }
    if (clubHits && clubHits.length > 1 && last) {
      const firstInit = normalizePulsePersonKey(rawPlayer?.name?.first).charAt(0);
      const narrowed = clubHits.find((el) => normalizePulsePersonKey(el.first_name).startsWith(firstInit));
      if (narrowed) {
        return { fplEl: narrowed, optaCode: optaCode || Number(narrowed.code) || null };
      }
    }
  }

  // Fallback across all FPL clubs (handles mid-season loan/transfer timing edge cases)
  for (const candidateKey of [firstLast, disp]) {
    if (!candidateKey) continue;
    const globalHits = indices.byNormName.get(candidateKey);
    if (globalHits && globalHits.length === 1) {
      return { fplEl: globalHits[0], optaCode: optaCode || Number(globalHits[0].code) || null };
    }
  }

  return { fplEl: null, optaCode };
}

function resolveStarterFormationRoles(
  rawFormation: any,
  rawLineup: any[],
  starters: PulseAllCompPlayerRecord[]
): { formationLabel?: string; outfieldSlots?: CanonicalTacticalRole[] } {
  const label =
    typeof rawFormation?.label === 'string'
      ? rawFormation.label.trim()
      : typeof rawFormation?.formation === 'string'
      ? rawFormation.formation.trim()
      : '';
  const grid: any[] | null = Array.isArray(rawFormation?.players)
    ? rawFormation.players
    : Array.isArray(rawFormation?.lineup)
    ? rawFormation.lineup
    : null;

  if (!label || !grid || grid.length < 2) {
    return label ? { formationLabel: label } : {};
  }

  const rowLengths = grid.map((r) => (Array.isArray(r) ? r.length : 0));
  const roleMatrix = getFormationRoleMatrix(label, rowLengths);

  const playerByMatchKey = new Map<string, PulseAllCompPlayerRecord>();
  rawLineup.forEach((rawP, idx) => {
    const rec = starters[idx];
    if (!rec) return;
    if (rawP?.id) playerByMatchKey.set(String(rawP.id), rec);
    if (rawP?.pulseId) playerByMatchKey.set(String(rawP.pulseId), rec);
    if (rec.optaCode) playerByMatchKey.set(String(rec.optaCode), rec);
  });

  const outfieldSlots: CanonicalTacticalRole[] = [];
  grid.forEach((rowIds, rIdx) => {
    if (!Array.isArray(rowIds)) return;
    const rolesRow = roleMatrix[rIdx] || [];
    rowIds.forEach((pid: any, cIdx: number) => {
      const role = rolesRow[cIdx] || (rIdx === 0 ? 'GK' : 'CM');
      if (role !== 'GK') {
        outfieldSlots.push(role);
      }
      const rec = playerByMatchKey.get(String(pid));
      if (rec) {
        rec.tacticalRole = role;
      }
    });
  });

  return {
    formationLabel: label,
    ...(outfieldSlots.length >= 9 ? { outfieldSlots } : {}),
  };
}

function buildClubSideFromPulsePayload(
  fixtureMeta: PulseAllCompFixtureRecord,
  payload: any,
  clubMeta: PulseAllCompClubMeta,
  isHome: boolean,
  durationMins: number,
  playerIndices: PlayerIndexMaps
): PulseAllCompClubSide | null {
  const teamLists: any[] = Array.isArray(payload?.teamLists) ? payload.teamLists : [];
  if (teamLists.length === 0) return null;

  const teamSideIdx = isHome ? 0 : 1;
  const tl =
    teamLists.find((item) => Number(item?.teamId) === clubMeta.pulseTeamId) ||
    teamLists[teamSideIdx];
  if (!tl || !Array.isArray(tl.lineup) || tl.lineup.length === 0) return null;

  const rawLineup: any[] = Array.isArray(tl.lineup) ? tl.lineup : [];
  const rawSubs: any[] = Array.isArray(tl.substitutes) ? tl.substitutes : [];

  // Map match events for substitutions & red cards keyed by both personId & optaCode
  const subOnMinMap = new Map<number, number>();
  const subOffMinMap = new Map<number, number>();
  const redCardMinMap = new Map<number, number>();

  for (const ev of payload?.events || []) {
    const pid = Number(ev?.personId);
    if (!pid) continue;
    const min = parseEventMinute(ev);
    if (ev.type === 'S') {
      if (ev.description === 'ON') {
        if (!subOnMinMap.has(pid)) subOnMinMap.set(pid, min);
      } else if (ev.description === 'OFF') {
        if (!subOffMinMap.has(pid)) subOffMinMap.set(pid, min);
      }
    } else if (ev.type === 'R' || ev.type === 'YR') {
      if (!redCardMinMap.has(pid)) redCardMinMap.set(pid, min);
    }
  }

  const mapPlayerRecord = (rawP: any, isStarter: boolean): PulseAllCompPlayerRecord => {
    const rawId = Number(rawP?.id) || 0;
    const { fplEl, optaCode } = resolveFplElementForPulsePlayer(rawP, clubMeta.short, playerIndices);
    const fplId = fplEl ? Number(fplEl.id) : null;

    const rawPosChar = rawP?.matchPosition || rawP?.info?.position;
    const rawPosInfo =
      typeof rawP?.info?.positionInfo === 'string' && rawP.info.positionInfo.trim()
        ? rawP.info.positionInfo.trim()
        : undefined;
    const resolvedPos = lookupPulsePlayerPosition({
      optaCode: optaCode || undefined,
      fplId: fplId || undefined,
      teamShort: clubMeta.short,
      fullName: rawP?.name?.display,
      webName: rawP?.name?.last,
      existingPositionInfo: rawPosInfo,
      existingPositionChar: rawPosChar,
    });

    let position: PositionType = 'MID';
    if (fplEl?.element_type === 1) position = 'GKP';
    else if (fplEl?.element_type === 2) position = 'DEF';
    else if (fplEl?.element_type === 3) position = 'MID';
    else if (fplEl?.element_type === 4) position = 'FWD';
    else position = mapPulseCharToFplPos(rawPosChar, resolvedPos.positionInfo || rawPosInfo) || 'MID';

    const lookupKeys = [rawId, Number(rawP?.pulseId) || 0, optaCode || 0].filter((k) => k > 0);
    let subOnMin: number | undefined;
    let subOffMin: number | undefined;
    let redMin: number | undefined;
    for (const k of lookupKeys) {
      if (subOnMin === undefined && subOnMinMap.has(k)) subOnMin = subOnMinMap.get(k);
      if (subOffMin === undefined && subOffMinMap.has(k)) subOffMin = subOffMinMap.get(k);
      if (redMin === undefined && redCardMinMap.has(k)) redMin = redCardMinMap.get(k);
    }

    let minutes = 0;
    if (isStarter) {
      if (subOffMin !== undefined) {
        minutes = Math.max(1, subOffMin);
      } else if (redMin !== undefined) {
        minutes = Math.max(1, redMin);
      } else {
        minutes = durationMins;
      }
    } else if (subOnMin !== undefined) {
      const endMin = subOffMin ?? redMin ?? durationMins;
      minutes = Math.max(1, endMin - subOnMin);
    }

    return {
      pulsePlayerId: Number(rawP?.pulseId) || rawId,
      optaCode,
      fplId,
      name: String(
        fplEl?.web_name ||
          rawP?.name?.display ||
          `${rawP?.name?.first || ''} ${rawP?.name?.last || ''}`.trim() ||
          'Player'
      ),
      position,
      ...(resolvedPos.positionInfo || rawPosInfo
        ? { positionInfo: resolvedPos.positionInfo || rawPosInfo }
        : {}),
      isStarter,
      minutes,
      ...(subOnMin !== undefined ? { subbedOnMinute: subOnMin } : {}),
      ...(subOffMin !== undefined ? { subbedOffMinute: subOffMin } : {}),
      ...(redMin !== undefined ? { redCardMinute: redMin } : {}),
    };
  };

  const starters = rawLineup.map((p) => mapPlayerRecord(p, true));
  const subs = rawSubs.map((p) => mapPlayerRecord(p, false));

  const { formationLabel, outfieldSlots } = resolveStarterFormationRoles(tl.formation, rawLineup, starters);

  const starterFplIds: number[] = [];
  const subOnFplIds: number[] = [];
  const unusedBenchFplIds: number[] = [];
  const starterRolesByFplId: Record<number, CanonicalTacticalRole> = {};
  const minutesByFplId: Record<number, number> = {};
  let nonFplStartersCount = 0;

  for (const st of starters) {
    if (st.fplId && st.fplId > 0) {
      starterFplIds.push(st.fplId);
      minutesByFplId[st.fplId] = st.minutes;
      if (st.tacticalRole) starterRolesByFplId[st.fplId] = st.tacticalRole;
    } else {
      nonFplStartersCount++;
    }
  }

  for (const sb of subs) {
    if (sb.fplId && sb.fplId > 0) {
      minutesByFplId[sb.fplId] = sb.minutes;
      if (sb.minutes > 0) subOnFplIds.push(sb.fplId);
      else unusedBenchFplIds.push(sb.fplId);
    }
  }

  return {
    clubShort: clubMeta.short,
    pulseTeamId: clubMeta.pulseTeamId,
    isHome,
    oppName: isHome ? fixtureMeta.awayName : fixtureMeta.homeName,
    oppShort: isHome ? fixtureMeta.awayShort : fixtureMeta.homeShort,
    teamScore: isHome ? fixtureMeta.homeScore : fixtureMeta.awayScore,
    oppScore: isHome ? fixtureMeta.awayScore : fixtureMeta.homeScore,
    ...(formationLabel ? { formationLabel } : {}),
    ...(outfieldSlots ? { outfieldSlots } : {}),
    starters,
    subs,
    starterFplIds,
    subOnFplIds,
    unusedBenchFplIds,
    starterRolesByFplId,
    minutesByFplId,
    nonFplStartersCount,
  };
}

function detectMatchDurationMins(payload: any): number {
  const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
  const hasEt = events.some((ev) => {
    const phase = String(ev?.phase || '').toUpperCase();
    return phase === '3' || phase === '4' || phase === 'ET1' || phase === 'ET2';
  });
  if (hasEt) return 120;
  const maxClockSecs = Math.max(
    Number(payload?.clock?.secs) || 0,
    ...events.map((ev) => Number(ev?.clock?.secs) || 0)
  );
  if (maxClockSecs >= 6300) return 120; // >105 mins clearly indicates Extra Time
  return 90;
}

async function fetchSingleMatchDetailForDb(fix: PulseAllCompFixtureRecord): Promise<any | null> {
  // Primary: Legacy Pulse 1-request endpoint (confirmed complete for PL, UCL, UEL, UECL, EFLC, FAC, CS)
  const pulseRaw = await fetchJsonSafe(`${PULSE_BASE}/fixtures/${fix.pulseMatchId}?altIds=true`, 2);
  if (pulseRaw && Array.isArray(pulseRaw.teamLists) && pulseRaw.teamLists.length >= 2) {
    const hasLineups = pulseRaw.teamLists.some(
      (tl: any) => Array.isArray(tl?.lineup) && tl.lineup.length >= 10
    );
    if (hasLineups) return pulseRaw;
  }

  // Fallback: SDP API (3-endpoint normalized match)
  if (fix.optaCode && fix.optaCode > 0) {
    const sdpRaw = await fetchSdpNormalizedMatch(
      fix.optaCode,
      fix.pulseMatchId,
      fix.eplGw ?? undefined
    );
    if (sdpRaw && Array.isArray(sdpRaw.teamLists) && sdpRaw.teamLists.length >= 2) {
      return sdpRaw;
    }
  }

  return pulseRaw;
}

/**
 * Fetches cross-competition Pulse fixtures (U/L/C) for all 20 EPL clubs,
 * updates `pulseAllCompSchedule.json`, and downloads/finalizes missing completed
 * match lineups + minutes into `pulseAllCompHistory.json`.
 */
export async function syncPulseAllCompDatabase(options?: {
  forceSchedule?: boolean;
  bootstrapData?: any;
  backfillLimit?: number;
}): Promise<SyncPulseAllCompResult> {
  if (inFlightSync) return inFlightSync;

  inFlightSync = (async () => {
    const startMs = Date.now();
    initPulseAllCompDb();
    const prevSchedule = scheduleDbState!;
    const hist = historyDbState!;

    // 1. Obtain FPL bootstrap elements & teams for 1:1 player/club mapping
    let bootstrap = options?.bootstrapData;
    if (!bootstrap || !Array.isArray(bootstrap.elements)) {
      bootstrap = await getCachedBootstrapStatic().catch(() => null);
    }
    let elements: any[] = Array.isArray(bootstrap?.elements) ? bootstrap.elements : [];
    const fplTeams: any[] = Array.isArray(bootstrap?.teams) ? bootstrap.teams : [];
    if (elements.length === 0) {
      const dbPlayers = Object.values(getFplDatabase()?.players || {});
      elements = dbPlayers.map((p) => ({
        id: p.id,
        code: (p as any).code || 0,
        web_name: p.webName,
        first_name: p.fullName.split(' ')[0] || p.webName,
        second_name: p.fullName.split(' ').slice(1).join(' ') || p.webName,
        team: p.teamId,
        element_type: p.position === 'GKP' ? 1 : p.position === 'DEF' ? 2 : p.position === 'MID' ? 3 : 4,
      }));
    }

    // 2. Refresh all-competition schedule DB if stale, empty, or forced
    const schedAgeMs = prevSchedule.updatedAt ? Date.now() - Date.parse(prevSchedule.updatedAt) : Infinity;
    const needsScheduleFetch =
      Boolean(options?.forceSchedule) ||
      prevSchedule.fixtures.length === 0 ||
      !Number.isFinite(schedAgeMs) ||
      schedAgeMs >= SCHEDULE_REFRESH_TTL_MS;

    let currentSchedule = prevSchedule;
    if (needsScheduleFetch) {
      const { plSeasonId, plSeasonLabel, compSeasons } = await discoverActiveCompSeasons();
      const clubs = await resolvePlClubs(plSeasonId, fplTeams);

      if (clubs.length > 0 && compSeasons.length > 0) {
        const teamIdsCsv = clubs.map((c) => c.pulseTeamId).join(',');
        const seasonIdsCsv = compSeasons.map((cs) => cs.seasonId).join(',');
        const clubByPulseId = new Map<number, PulseAllCompClubMeta>(clubs.map((c) => [c.pulseTeamId, c]));

        const allRawFixtures: any[] = [];
        let page = 0;
        let numPages = 1;
        while (page < numPages && page < 10) {
          const resp = await fetchJsonSafe(
            `${PULSE_BASE}/fixtures?teams=${teamIdsCsv}&compSeasons=${seasonIdsCsv}&statuses=U,L,C&page=${page}&pageSize=600&sort=asc&altIds=true`,
            2
          );
          if (!resp || !Array.isArray(resp.content)) break;
          allRawFixtures.push(...resp.content);
          numPages = Number(resp.pageInfo?.numPages) || 1;
          page++;
        }

        if (allRawFixtures.length > 0) {
          const seenMatchIds = new Set<number>();
          const fixtures: PulseAllCompFixtureRecord[] = [];
          for (const rawFix of allRawFixtures) {
            const pulseMatchId = Number(rawFix?.id);
            if (!pulseMatchId || seenMatchIds.has(pulseMatchId)) continue;
            seenMatchIds.add(pulseMatchId);

            const compObj = rawFix?.gameweek?.compSeason?.competition;
            const compId = Number(compObj?.id) || 1;
            const meta = COMP_META_BY_ID[compId];
            const compAbbr = String(compObj?.abbreviation || meta?.abbr || `COMP_${compId}`);
            const compDesc = String(compObj?.description || meta?.desc || compAbbr);
            const compSeasonId = Number(rawFix?.gameweek?.compSeason?.id) || 0;
            const eplGw = compId === 1 ? Number(rawFix?.gameweek?.gameweek) || null : null;
            const kickoffMs = Number(rawFix?.kickoff?.millis) || 0;
            const kickoffIso = kickoffMs > 0 ? new Date(kickoffMs).toISOString() : '';
            const rawStatus = String(rawFix?.status || 'U').toUpperCase();
            const status: 'U' | 'L' | 'C' =
              rawStatus === 'C' ? 'C' : rawStatus === 'L' ? 'L' : 'U';

            const t0 = rawFix?.teams?.[0];
            const t1 = rawFix?.teams?.[1];
            const homePulseTeamId = Number(t0?.team?.id) || 0;
            const awayPulseTeamId = Number(t1?.team?.id) || 0;
            const homeShort = normalizeTeamShort(t0?.team, clubByPulseId);
            const awayShort = normalizeTeamShort(t1?.team, clubByPulseId);

            // Keep only fixtures involving at least 1 current EPL club
            if (!homeShort && !awayShort) continue;

            const existingHist = hist.matches[pulseMatchId];
            fixtures.push({
              pulseMatchId,
              optaCode: rawFix?.altIds?.opta
                ? parseInt(String(rawFix.altIds.opta).replace(/\D/g, ''), 10) || null
                : null,
              compId,
              compAbbr,
              compDesc,
              compSeasonId,
              eplGw,
              kickoffMs,
              kickoffIso,
              status,
              homePulseTeamId,
              awayPulseTeamId,
              homeShort,
              awayShort,
              homeName: String(t0?.team?.name || homeShort || 'Home'),
              awayName: String(t1?.team?.name || awayShort || 'Away'),
              homeScore: typeof t0?.score === 'number' ? t0.score : null,
              awayScore: typeof t1?.score === 'number' ? t1.score : null,
              ...(typeof rawFix?.outcome === 'string' ? { outcome: rawFix.outcome } : {}),
              detailFinalized: Boolean(existingHist?.finalized),
              detailHasLineup: Boolean(
                existingHist?.finalized || (existingHist?.sides?.length || 0) > 0
              ),
              ...(existingHist?.syncedAt ? { detailSyncedAt: existingHist.syncedAt } : {}),
            });
          }

          fixtures.sort((a, b) => a.kickoffMs - b.kickoffMs || a.pulseMatchId - b.pulseMatchId);

          currentSchedule = {
            schemaVersion: 1,
            plSeasonId,
            plSeasonLabel,
            updatedAt: new Date().toISOString(),
            compSeasons,
            clubs,
            fixtures,
          };
          scheduleDbState = currentSchedule;
          rebuildScheduleIndices(currentSchedule);
          writeJsonAtomic(PULSE_ALL_COMP_SCHEDULE_PATH, currentSchedule);
          console.log(
            `[PulseAllCompDB] Schedule synced: ${fixtures.length} fixtures across ${compSeasons.length} competitions (${clubs.length} EPL clubs).`
          );
        }
      }
    }

    // 3. Diff completed ('C') fixtures against finalized History DB records
    const clubByShort = new Map<string, PulseAllCompClubMeta>(
      (currentSchedule.clubs || []).map((c) => [c.short, c])
    );
    const teamIdToShort = new Map<number, string>();
    for (const c of currentSchedule.clubs || []) {
      if (c.fplTeamId) teamIdToShort.set(c.fplTeamId, c.short);
    }
    for (const t of fplTeams) {
      if (t?.id && t?.short_name) teamIdToShort.set(Number(t.id), String(t.short_name).toUpperCase());
    }

    const playerIndices = buildFplPlayerIndices(elements, teamIdToShort);
    const elementByCodeMap = new Map<number, any>(playerIndices.byOptaCode.entries());

    const completedFixtures = (currentSchedule.fixtures || []).filter((f) => f.status === 'C');
    const missingCompleted = completedFixtures.filter((f) => !hist.matches[f.pulseMatchId]?.finalized);
    const toProcess =
      options?.backfillLimit && options.backfillLimit > 0
        ? missingCompleted.slice(0, options.backfillLimit)
        : missingCompleted;

    const skippedFinalized = completedFixtures.length - missingCompleted.length;
    let newlyFetchedMatches = 0;
    let failedMatches = 0;

    if (toProcess.length > 0) {
      console.log(
        `[PulseAllCompDB] Fetching ${toProcess.length} unfinalized completed match details across all competitions (skipping ${skippedFinalized} cached)...`
      );
      await mapWithConcurrency(toProcess, DETAIL_FETCH_CONCURRENCY, async (fix) => {
        try {
          const payload = await fetchSingleMatchDetailForDb(fix);
          if (!payload || !Array.isArray(payload.teamLists) || payload.teamLists.length === 0) {
            failedMatches++;
            return;
          }

          // Enrich shared Pulse position dictionary
          recordPulseFixturePositions(payload, elementByCodeMap);

          const durationMins = detectMatchDurationMins(payload);
          const sides: PulseAllCompClubSide[] = [];

          if (fix.homeShort && clubByShort.has(fix.homeShort)) {
            const hSide = buildClubSideFromPulsePayload(
              fix,
              payload,
              clubByShort.get(fix.homeShort)!,
              true,
              durationMins,
              playerIndices
            );
            if (hSide) sides.push(hSide);
          }
          if (fix.awayShort && clubByShort.has(fix.awayShort)) {
            const aSide = buildClubSideFromPulsePayload(
              fix,
              payload,
              clubByShort.get(fix.awayShort)!,
              false,
              durationMins,
              playerIndices
            );
            if (aSide) sides.push(aSide);
          }

          if (sides.length === 0) {
            failedMatches++;
            return;
          }

          const syncedAt = new Date().toISOString();
          const compWeight = COMP_META_BY_ID[fix.compId]?.weight ?? 0.7;
          const record: PulseAllCompMatchRecord = {
            pulseMatchId: fix.pulseMatchId,
            optaCode: fix.optaCode,
            compId: fix.compId,
            compAbbr: fix.compAbbr,
            compDesc: fix.compDesc,
            compWeight,
            eplGw: fix.eplGw,
            kickoffMs: fix.kickoffMs,
            kickoffIso: fix.kickoffIso,
            status: 'C',
            finalized: true,
            durationMins,
            syncedAt,
            sides,
          };

          hist.matches[fix.pulseMatchId] = record;
          fix.detailFinalized = true;
          fix.detailHasLineup = true;
          fix.detailSyncedAt = syncedAt;
          newlyFetchedMatches++;
        } catch (err: any) {
          failedMatches++;
          console.warn(`[PulseAllCompDB] Failed detail for match ${fix.pulseMatchId}:`, err?.message || err);
        }
      });

      hist.plSeasonId = currentSchedule.plSeasonId;
      hist.updatedAt = new Date().toISOString();
      hist.summary = recomputeHistorySummary(hist);
      historyDbState = hist;
      rebuildHistoryIndices(hist);

      writeJsonAtomic(PULSE_ALL_COMP_HISTORY_PATH, hist);
      writeJsonAtomic(PULSE_ALL_COMP_SCHEDULE_PATH, currentSchedule);
      const syncDetailNote =
        failedMatches > 0
          ? `${newlyFetchedMatches} newly synced, ${failedMatches} pending`
          : `${newlyFetchedMatches} newly synced`;
      console.log(
        `[PulseAllCompDB] History DB saved: ${hist.summary.finalizedMatches} matches, ${hist.summary.totalClubSides} club-sides, ${hist.summary.mappedFplAppearances} mapped FPL appearances (${syncDetailNote}).`
      );
    } else if (needsScheduleFetch) {
      hist.plSeasonId = currentSchedule.plSeasonId;
      if (!hist.updatedAt) hist.updatedAt = new Date().toISOString();
      hist.summary = recomputeHistorySummary(hist);
      writeJsonAtomic(PULSE_ALL_COMP_HISTORY_PATH, hist);
    }

    return {
      scheduleFixturesTotal: currentSchedule.fixtures.length,
      completedFixturesTotal: completedFixtures.length,
      newlyFetchedMatches,
      skippedFinalized,
      failedMatches,
      durationMs: Date.now() - startMs,
      summary: hist.summary,
    };
  })().finally(() => {
    inFlightSync = null;
  });

  return inFlightSync;
}

/**
 * Event-driven sync tick executed periodically by server.ts.
 * Zero Pulse HTTP requests when outside active match windows (`mode === 'IDLE'`).
 * During active Non-EPL match windows (`LINEUP_WINDOW`, `FT_WINDOW`, `CATCHUP_WINDOW`),
 * polls strictly the relevant fixtures with per-mode cooldowns and locks completed matches.
 */
export async function runEventDrivenAllCompSyncTick(options?: {
  nowMs?: number;
  force?: boolean;
}): Promise<EventDrivenAllCompTickResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const initialPlan = getAllCompSyncPlan(nowMs);

  if (!options?.force && initialPlan.mode === 'IDLE') {
    return {
      ran: false,
      mode: 'IDLE',
      scheduleRefreshed: false,
      lineupsCaptured: 0,
      newlyFinalizedMatches: 0,
      newlyFinalizedNonPlCount: 0,
      durationMs: 0,
      plan: initialPlan,
    };
  }

  // Enforce per-mode polling cooldowns so the 20s server heartbeat stays gentle on upstream Pulse API
  if (!options?.force) {
    if (initialPlan.mode === 'LINEUP_WINDOW' && nowMs - lastLineupPollAtMs < LINEUP_POLL_COOLDOWN_MS) {
      return {
        ran: false,
        mode: initialPlan.mode,
        scheduleRefreshed: false,
        lineupsCaptured: 0,
        newlyFinalizedMatches: 0,
        newlyFinalizedNonPlCount: 0,
        durationMs: 0,
        plan: initialPlan,
      };
    }
    if (initialPlan.mode === 'FT_WINDOW' && nowMs - lastFtPollAtMs < FT_POLL_COOLDOWN_MS) {
      return {
        ran: false,
        mode: initialPlan.mode,
        scheduleRefreshed: false,
        lineupsCaptured: 0,
        newlyFinalizedMatches: 0,
        newlyFinalizedNonPlCount: 0,
        durationMs: 0,
        plan: initialPlan,
      };
    }
    if (initialPlan.mode === 'CATCHUP_WINDOW' && nowMs - lastCatchupPollAtMs < CATCHUP_POLL_COOLDOWN_MS) {
      return {
        ran: false,
        mode: initialPlan.mode,
        scheduleRefreshed: false,
        lineupsCaptured: 0,
        newlyFinalizedMatches: 0,
        newlyFinalizedNonPlCount: 0,
        durationMs: 0,
        plan: initialPlan,
      };
    }
    if (initialPlan.mode === 'SCHEDULE_REFRESH' && nowMs - lastScheduleAttemptAtMs < 5 * 60 * 1000) {
      return {
        ran: false,
        mode: initialPlan.mode,
        scheduleRefreshed: false,
        lineupsCaptured: 0,
        newlyFinalizedMatches: 0,
        newlyFinalizedNonPlCount: 0,
        durationMs: 0,
        plan: initialPlan,
      };
    }
  }

  if (inFlightEventTick) return inFlightEventTick;
  if (inFlightSync) {
    return {
      ran: false,
      mode: initialPlan.mode,
      scheduleRefreshed: false,
      lineupsCaptured: 0,
      newlyFinalizedMatches: 0,
      newlyFinalizedNonPlCount: 0,
      durationMs: 0,
      plan: initialPlan,
    };
  }

  inFlightEventTick = (async (): Promise<EventDrivenAllCompTickResult> => {
    const tickStart = Date.now();
    let scheduleRefreshed = false;
    let lineupsCaptured = 0;
    let newlyFinalizedMatches = 0;
    let newlyFinalizedNonPlCount = 0;

    try {
      if (initialPlan.mode === 'LINEUP_WINDOW') lastLineupPollAtMs = nowMs;
      else if (initialPlan.mode === 'FT_WINDOW') lastFtPollAtMs = nowMs;
      else if (initialPlan.mode === 'CATCHUP_WINDOW') lastCatchupPollAtMs = nowMs;

      // Refresh lightweight 1-call schedule index when in SCHEDULE_REFRESH, FT_WINDOW, or CATCHUP_WINDOW
      const needsSchedPull =
        initialPlan.mode === 'SCHEDULE_REFRESH' ||
        initialPlan.mode === 'FT_WINDOW' ||
        initialPlan.mode === 'CATCHUP_WINDOW' ||
        Boolean(options?.force);

      if (needsSchedPull && (options?.force || nowMs - lastScheduleAttemptAtMs >= 60 * 1000)) {
        lastScheduleAttemptAtMs = nowMs;
        const syncRes = await syncPulseAllCompDatabase({ forceSchedule: true });
        scheduleRefreshed = true;
        newlyFinalizedMatches += syncRes.newlyFetchedMatches;
      }

      // Now inspect updated plan & fetch surgical target details for LINEUP / FT / CATCHUP windows
      const refreshedPlan = getAllCompSyncPlan(Date.now());
      const sched = scheduleDbState!;
      const hist = historyDbState!;

      if (refreshedPlan.activeTargets.length > 0 && sched.clubs.length > 0) {
        const bootstrap = await getCachedBootstrapStatic().catch(() => null);
        let elements: any[] = Array.isArray(bootstrap?.elements) ? bootstrap.elements : [];
        const fplTeams: any[] = Array.isArray(bootstrap?.teams) ? bootstrap.teams : [];
        if (elements.length === 0) {
          elements = Object.values(getFplDatabase()?.players || {}).map((p) => ({
            id: p.id,
            code: (p as any).code || 0,
            web_name: p.webName,
            first_name: p.fullName.split(' ')[0] || p.webName,
            second_name: p.fullName.split(' ').slice(1).join(' ') || p.webName,
            team: p.teamId,
            element_type: p.position === 'GKP' ? 1 : p.position === 'DEF' ? 2 : p.position === 'MID' ? 3 : 4,
          }));
        }

        const clubByShort = new Map<string, PulseAllCompClubMeta>(
          (sched.clubs || []).map((c) => [c.short, c])
        );
        const teamIdToShort = new Map<number, string>();
        for (const c of sched.clubs || []) {
          if (c.fplTeamId) teamIdToShort.set(c.fplTeamId, c.short);
        }
        for (const t of fplTeams) {
          if (t?.id && t?.short_name) teamIdToShort.set(Number(t.id), String(t.short_name).toUpperCase());
        }
        const playerIndices = buildFplPlayerIndices(elements, teamIdToShort);
        const elementByCodeMap = new Map<number, any>(playerIndices.byOptaCode.entries());
        const fixById = new Map<number, PulseAllCompFixtureRecord>(
          (sched.fixtures || []).map((f) => [f.pulseMatchId, f])
        );

        let mutatedDb = false;

        await mapWithConcurrency(refreshedPlan.activeTargets, 6, async (target) => {
          const fix = fixById.get(target.pulseMatchId);
          if (!fix || hist.matches[fix.pulseMatchId]?.finalized) return;

          const payload = await fetchSingleMatchDetailForDb(fix);
          if (!payload || !Array.isArray(payload.teamLists) || payload.teamLists.length === 0) {
            return;
          }

          const hasValidStarters = payload.teamLists.some(
            (tl: any) => Array.isArray(tl?.lineup) && tl.lineup.length >= 10
          );
          if (!hasValidStarters) return;

          recordPulseFixturePositions(payload, elementByCodeMap);

          const payloadStatus = String(payload?.status || fix.status).toUpperCase();
          const isPayloadFinal = payloadStatus === 'C';
          const durationMins = detectMatchDurationMins(payload);

          // Update fixture scores/status from payload if available
          const t0 = payload?.teams?.[0];
          const t1 = payload?.teams?.[1];
          if (typeof t0?.score === 'number') fix.homeScore = t0.score;
          if (typeof t1?.score === 'number') fix.awayScore = t1.score;
          if (isPayloadFinal) {
            fix.status = 'C';
            if (typeof payload?.outcome === 'string') fix.outcome = payload.outcome;
          } else if (payloadStatus === 'L' && fix.status === 'U') {
            fix.status = 'L';
          }

          const sides: PulseAllCompClubSide[] = [];
          if (fix.homeShort && clubByShort.has(fix.homeShort)) {
            const hSide = buildClubSideFromPulsePayload(
              fix,
              payload,
              clubByShort.get(fix.homeShort)!,
              true,
              durationMins,
              playerIndices
            );
            if (hSide) sides.push(hSide);
          }
          if (fix.awayShort && clubByShort.has(fix.awayShort)) {
            const aSide = buildClubSideFromPulsePayload(
              fix,
              payload,
              clubByShort.get(fix.awayShort)!,
              false,
              durationMins,
              playerIndices
            );
            if (aSide) sides.push(aSide);
          }
          if (sides.length === 0) return;

          const syncedAt = new Date().toISOString();
          const compWeight = COMP_META_BY_ID[fix.compId]?.weight ?? 0.7;
          const hadLineupBefore = Boolean(fix.detailHasLineup);

          hist.matches[fix.pulseMatchId] = {
            pulseMatchId: fix.pulseMatchId,
            optaCode: fix.optaCode,
            compId: fix.compId,
            compAbbr: fix.compAbbr,
            compDesc: fix.compDesc,
            compWeight,
            eplGw: fix.eplGw,
            kickoffMs: fix.kickoffMs,
            kickoffIso: fix.kickoffIso,
            status: isPayloadFinal ? 'C' : 'L',
            finalized: isPayloadFinal,
            durationMins,
            syncedAt,
            sides,
          };

          fix.detailHasLineup = true;
          fix.detailSyncedAt = syncedAt;
          if (isPayloadFinal) {
            fix.detailFinalized = true;
            newlyFinalizedMatches++;
            if (fix.compId !== 1) newlyFinalizedNonPlCount++;
          } else if (!hadLineupBefore) {
            lineupsCaptured++;
          }
          mutatedDb = true;
        });

        if (mutatedDb) {
          hist.plSeasonId = sched.plSeasonId;
          hist.updatedAt = new Date().toISOString();
          hist.summary = recomputeHistorySummary(hist);
          historyDbState = hist;
          rebuildHistoryIndices(hist);
          rebuildScheduleIndices(sched);

          writeJsonAtomic(PULSE_ALL_COMP_HISTORY_PATH, hist);
          writeJsonAtomic(PULSE_ALL_COMP_SCHEDULE_PATH, sched);

          console.log(
            `[PulseAllComp EventSync] Mode=${initialPlan.mode} | lineupsCaptured=${lineupsCaptured} | newlyFinalized=${newlyFinalizedMatches} (NonPL=${newlyFinalizedNonPlCount})`
          );
        }
      }

      const finalPlan = getAllCompSyncPlan(Date.now());
      return {
        ran: true,
        mode: initialPlan.mode,
        scheduleRefreshed,
        lineupsCaptured,
        newlyFinalizedMatches,
        newlyFinalizedNonPlCount,
        durationMs: Date.now() - tickStart,
        plan: finalPlan,
      };
    } finally {
      inFlightEventTick = null;
    }
  })();

  return inFlightEventTick;
}

