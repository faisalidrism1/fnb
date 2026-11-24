import express from 'express';
import path from 'path';
import fs from 'fs';
import { fetchAndTransformLeague, checkFplGwStatus, FplGwStatusCheck, fetchCompleteEventStatusBundle, CompleteEventStatusBundle, computeNextSyncWIB } from './src/server/dataFetcher.ts';
import { fetchMatchesForGw, getCachedMatchesForGw, invalidateMatchesCache, prewarmMatchesCache, invalidateFixturesScheduleCache, getCachedBootstrapStatic } from './src/server/matchesFetcher.ts';
import crypto from 'node:crypto';
import * as staticProjectionEngine from './src/server/projectionEngineServer.ts';
type ProjectionEngineModule = typeof import('./src/server/projectionEngineServer.ts');

let hotProjectionEngine: ProjectionEngineModule | null = null;
let resolveDevEngineInit!: (engine: ProjectionEngineModule) => void;
const devEngineInitPromise: Promise<ProjectionEngineModule> =
  process.env.NODE_ENV !== 'production'
    ? new Promise<ProjectionEngineModule>((resolve) => {
        resolveDevEngineInit = resolve;
      })
    : Promise.resolve(staticProjectionEngine);

function getProjectionEngine(): ProjectionEngineModule {
  return hotProjectionEngine || staticProjectionEngine;
}

async function getDevProjectionEngine(): Promise<ProjectionEngineModule> {
  if (process.env.NODE_ENV === 'production') {
    return staticProjectionEngine;
  }
  if (hotProjectionEngine) {
    return hotProjectionEngine;
  }
  return devEngineInitPromise;
}
import { TransformedLeagueData } from './src/types.ts';
import {
  initDatabase,
  executeSchemaSync,
  getOptimalDatabase,
  getDbPlayerStatById,
  getDatabaseStats,
  resetDatabaseState,
  getTransformedLeagueDataFromDb
} from './src/server/db.ts';
import {
  queryNewsTickerTable,
  rebuildNewsTickerTable,
  getNewsTickerTable,
  incrementPoinTayang,
  getCurrentGw,
  getGameweekPhase,
  isPhaseActive,
  isEditorTemplateId,
  clearNewsTickerMemoryCache,
  clearNewsTickerTable,
  getNewsTickerLastBuiltAt,
  getNewsTickerBuiltState,
  checkLiveBetweenMatchPhase,
  ensureLiveMatchesAndCheckPhase,
  isLiveStatRowForFinishedMatch
} from './src/server/newsTickerTableService.ts';
import {
  syncPulseMatchesForActiveGw,
  ensureLivePulseMatchesSynced,
  loadPulseMatchesForGw,
  migrateLegacyPulseMatchFiles,
  clearAllPulseMatchFiles,
} from './src/server/pulseMatchSync.ts';
import {
  initPulseAllCompDb,
  syncPulseAllCompDatabase,
  getPulseAllCompDbStatus,
  getClubAllCompSchedule,
  getClubAllCompHistory,
  runEventDrivenAllCompSyncTick,
} from './src/server/pulseAllCompDb.ts';
import {
  getPhase1Templates,
  savePhase1Templates,
  resetPhase1Templates
} from './src/data/phase1Templates.ts';
import { generatePhase1Stories } from './src/server/notStartedStoryGenerator.ts';
import { generateConfirmedStories } from './src/server/confirmedStoryGenerator.ts';
import { generateBetweenMatchStories } from './src/server/betweenMatchStoryGenerator.ts';
import { generateProvisionalStories } from './src/server/provisionalStoryGenerator.ts';
import {
  selectCycleBatchForPhase,
  selectLiveMatchCycleBatch,
  BatchCyclePhase,
} from './src/server/waveCycleScheduler.ts';

async function ensureNextGwFixtureMetaIfMissing(currentGw: number): Promise<void> {
  if (!currentGw || currentGw >= 38) return;
  const nextGw = currentGw + 1;
  try {
    const db = getOptimalDatabase();
    const gwFixtures: any[] = Array.isArray(db?.meta?.sync_status?.gw_fixtures)
      ? db.meta.sync_status.gw_fixtures
      : [];
    const nextFixes = gwFixtures.filter((f: any) => Number(f.event) === nextGw);
    const needsEnrich =
      nextFixes.length === 0 ||
      nextFixes.some(
        (f: any) =>
          f.team_h_difficulty == null ||
          f.team_a_difficulty == null ||
          f.home_pos == null ||
          f.away_pos == null
      );
    if (!needsEnrich) return;

    const [bsRes, fixRes] = await Promise.all([
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/'),
      fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${nextGw}`),
    ]);
    if (!bsRes.ok || !fixRes.ok) return;
    const bs = await bsRes.json();
    const fixes = await fixRes.json();
    if (!Array.isArray(bs?.teams) || !Array.isArray(fixes)) return;

    const teamInfoMap = new Map<number, any>(bs.teams.map((t: any) => [Number(t.id), t]));
    const fixById = new Map<number, any>(fixes.map((f: any) => [Number(f.id), f]));

    if (nextFixes.length === 0) {
      for (const fix of fixes) {
        if (!fix?.kickoff_time) continue;
        const hTeam = teamInfoMap.get(Number(fix.team_h));
        const aTeam = teamInfoMap.get(Number(fix.team_a));
        gwFixtures.push({
          id: fix.id,
          event: nextGw,
          home_team: hTeam?.short_name || 'H',
          away_team: aTeam?.short_name || 'A',
          team_h: fix.team_h,
          team_a: fix.team_a,
          team_h_score: fix.team_h_score ?? null,
          team_a_score: fix.team_a_score ?? null,
          team_h_difficulty: fix.team_h_difficulty ?? null,
          team_a_difficulty: fix.team_a_difficulty ?? null,
          home_pos: hTeam?.position ?? null,
          away_pos: aTeam?.position ?? null,
          kickoff_time: fix.kickoff_time,
          started: Boolean(fix.started),
          finished: Boolean(fix.finished),
          finished_provisional: Boolean(fix.finished_provisional),
          minutes: fix.minutes || 0,
        });
      }
      if (db.meta?.sync_status) {
        db.meta.sync_status.gw_fixtures = gwFixtures;
      }
    } else {
      for (const f of nextFixes) {
        const raw = fixById.get(Number(f.id));
        const hTeam = teamInfoMap.get(Number(raw?.team_h ?? f.team_h));
        const aTeam = teamInfoMap.get(Number(raw?.team_a ?? f.team_a));
        if (raw) {
          f.team_h_difficulty = raw.team_h_difficulty ?? f.team_h_difficulty ?? null;
          f.team_a_difficulty = raw.team_a_difficulty ?? f.team_a_difficulty ?? null;
        }
        if (hTeam) f.home_pos = hTeam.position ?? f.home_pos ?? null;
        if (aTeam) f.away_pos = aTeam.position ?? f.away_pos ?? null;
      }
    }

    // Persist patched fpl_database.json atomically
    const dbPath = path.join(process.cwd(), 'src/data/fpl_database.json');
    if (fs.existsSync(dbPath)) {
      const tmp = `${dbPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
      fs.renameSync(tmp, dbPath);
    }
  } catch (err: any) {
    console.warn('[Fixture Meta] Could not enrich next GW fixture meta:', err.message);
  }
}

const app = express();

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const p = Number(args[i + 1]);
      if (Number.isFinite(p) && p > 0) return p;
    } else if (args[i].startsWith('--port=')) {
      const p = Number(args[i].split('=')[1]);
      if (Number.isFinite(p) && p > 0) return p;
    }
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
  if (process.env.NODE_ENV !== 'production' && envPort && nginxPort && envPort === nginxPort) {
    return defaultAppPort;
  }
  return envPort || defaultAppPort;
}

function resolveServerHost(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
      return args[i + 1];
    } else if (args[i].startsWith('--host=')) {
      return args[i].split('=')[1] || '0.0.0.0';
    }
  }
  return process.env.HOST || '0.0.0.0';
}

const PORT = resolveServerPort();
const HOST = resolveServerHost();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Instant healthcheck endpoint (responds immediately even while background DB/Vite init completes)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

const LEAGUE_PAST_SEASONS_PATH = path.join(process.cwd(), 'src/data/league_past_seasons.json');

let leaguePastSeasonsData: Record<string, Array<{ season_name: string; total_points: number; rank: number }>> = {};

function calculateFnbRank(seasonName: string, globalRank: number): number {
  const ranksInSeason: number[] = [];
  for (const seasons of Object.values(leaguePastSeasonsData)) {
    const s = seasons.find((x) => x.season_name === seasonName);
    if (s && typeof s.rank === 'number') {
      ranksInSeason.push(s.rank);
    }
  }
  if (!ranksInSeason.includes(globalRank)) {
    ranksInSeason.push(globalRank);
  }
  ranksInSeason.sort((a, b) => a - b);
  const pos = ranksInSeason.indexOf(globalRank);
  return pos >= 0 ? pos + 1 : 1;
}

// In-Memory view hydrated asynchronously right after server port binds
let cachedData: TransformedLeagueData | null = null;
let isSyncing = false;

let resolveDbReady!: () => void;
const dbReadyPromise = new Promise<void>((resolve) => {
  resolveDbReady = resolve;
});

function initializeDatabaseState() {
  try {
    if (fs.existsSync(LEAGUE_PAST_SEASONS_PATH)) {
      try {
        leaguePastSeasonsData = JSON.parse(fs.readFileSync(LEAGUE_PAST_SEASONS_PATH, 'utf-8'));
      } catch (err: any) {
        console.warn('[Server] Error reading league_past_seasons.json:', err.message);
      }
    }

    initDatabase();
    initPulseAllCompDb();
    migrateLegacyPulseMatchFiles();

    cachedData = getTransformedLeagueDataFromDb();
    if (cachedData) {
      if (cachedData.sync_status) {
        cachedData.sync_status.next_sync_wib = computeNextSyncWIB(
          Boolean(cachedData.sync_status.is_matchday_live),
          cachedData.sync_status.gw_fixtures || []
        );
      }
      console.log('[Server] Hydrated view directly from Single Truth Source (fpl_database.json) for instant sub-5ms boot response');
    } else {
      console.log('[Server] Container started with EMPTY database (Cold Start state). Waiting for first user request to trigger Action A.');
    }
    console.log('[Server] Initialized with Single Truth Source (Optimal DB Schema) & Deterministic Orchestrator (Action A, B, C)');
  } catch (err: any) {
    console.error('[Server] Database initialization warning:', err?.message || err);
  } finally {
    resolveDbReady();
  }
}

// Ensure every API route waits for initial DB hydration (takes ~0ms once hydrated)
app.use('/api', async (_req, _res, next) => {
  await dbReadyPromise;
  next();
});

// Background sync runner with promise deduplication
let currentSyncPromise: Promise<TransformedLeagueData> | null = null;

export type SyncActionType = 'A_FULL' | 'B_PARTIAL' | 'C_SERVE';

async function triggerSync(action: 'A_FULL' | 'B_PARTIAL' = 'A_FULL', targetGW?: number): Promise<TransformedLeagueData> {
  if (currentSyncPromise) {
    return currentSyncPromise;
  }

  isSyncing = true;
  console.log(`[Server] Starting FPL API sync (${action}, targetGW: ${targetGW ?? 'all'}) for League 12356...`);
  
  currentSyncPromise = (async () => {
    try {
      const engine = getProjectionEngine();
      const prevEpochKey = cachedData ? engine.computeProjectionEpochInfo(cachedData).epochKey : engine.getProjectionCacheEpochKey();
      let freshData: TransformedLeagueData;
      if (action === 'B_PARTIAL' && targetGW && cachedData) {
        // Action B: Download active GW only and merge with historical data in container
        console.log(`[Server Action B] Fetching active GW ${targetGW} data only and merging with cached history...`);
        freshData = await fetchAndTransformLeague(12356, targetGW, cachedData);
      } else {
        // Action A: Full clean download of all data
        console.log(`[Server Action A] Full sync of all GWs from FPL API...`);
        freshData = await fetchAndTransformLeague(12356);
      }

      // Persist strictly to the Single Truth Source (fpl_database.json)
      executeSchemaSync(freshData);
      cachedData = getTransformedLeagueDataFromDb() || freshData;

      // Invalidate matches cache so that matches data reflects the latest sync
      try {
        invalidateMatchesCache(targetGW);
      } catch (mErr: any) {
        console.warn('[Server] Error invalidating matches cache:', mErr.message);
      }

      // Invalidate all live stats, fixtures, and event status bundle caches
      try {
        playerSummaryCache.clear();
        eventLiveCache.clear();
        fixturesCache.clear();
        eventStatusBundleCache = null;
      } catch (cErr: any) {
        console.warn('[Server] Error clearing live caches:', cErr.message);
      }

      // Refresh live match status, sync Pulse match event files (Action A/B), and rebuild News Ticker table
      try {
        if (action === 'A_FULL') {
          clearNewsTickerTable();
        }
        const activeGwForPulse = targetGW || getCurrentGw();
        await Promise.all([
          fetchMatchesForGw(activeGwForPulse).catch(() => null),
          ensureLiveMatchesAndCheckPhase(activeGwForPulse).catch(() => null),
          syncPulseMatchesForActiveGw(activeGwForPulse, { cleanOldGws: action === 'A_FULL' }).catch((pErr: any) => {
            console.warn('[Server] Warning syncing Pulse match files:', pErr.message);
            return null;
          }),
          action === 'A_FULL'
            ? syncPulseAllCompDatabase({ forceSchedule: true }).catch((acErr: any) => {
                console.warn('[Server] Warning syncing Pulse all-comp DB:', acErr?.message || acErr);
                return null;
              })
            : Promise.resolve(null),
        ]);
        rebuildNewsTickerTable(undefined, { clearExisting: action === 'A_FULL' });
      } catch (ntErr: any) {
        console.warn('[Server] Error rebuilding news ticker table after sync:', ntErr.message);
      }

      console.log(`[Server] FPL API & DB schema sync (${action}) completed successfully at`, new Date().toISOString());

      // Broadcast fresh data to all active clients immediately via Server-Sent Events (SSE)
      broadcastSyncComplete(freshData, action);

      // Strict Epoch Sync Rule: ONLY invalidate/warm Projection/Review/Scout caches on:
      //   1. Cold Start / Action A full download
      //   2. Epoch shift (Live -> Provisional OR Provisional -> Confirmed)
      // During ongoing Live auto-sync ticks (prevEpochKey === nextEpochKey), do ZERO invalidation or recompute!
      const engineForEpoch = getProjectionEngine();
      const nextEpochKey = engineForEpoch.computeProjectionEpochInfo(cachedData).epochKey;
      const shouldWarmProjections =
        action === 'A_FULL' ||
        !engineForEpoch.hasProjectionCoreCache() ||
        !engineForEpoch.hasProjectionScoutCache() ||
        prevEpochKey !== nextEpochKey;

      if (shouldWarmProjections) {
        if (action === 'A_FULL' || (prevEpochKey && prevEpochKey !== nextEpochKey)) {
          invalidateFixturesScheduleCache();
          engineForEpoch.invalidateProjectionEngine(`Epoch shift ${prevEpochKey ?? 'cold'} -> ${nextEpochKey}`);
        }
        engineForEpoch.warmProjectionEngineIfNeeded(cachedData);
        setTimeout(() => {
          prewarmMatchesCache(freshData.current_gw || getCurrentGw()).catch(() => {});
        }, 100);
      }

      return freshData;

    } catch (error: any) {
      console.error(`[Server] Sync (${action}) failed:`, error.message);
      throw error;
    } finally {
      isSyncing = false;
      currentSyncPromise = null;
    }
  })();

  return currentSyncPromise;
}

// Active Server-Sent Events (SSE) connections
const sseClients = new Set<express.Response>();

function broadcastSyncComplete(freshData: TransformedLeagueData, action: string) {
  if (sseClients.size === 0) return;
  const projectionEpochKey = getProjectionEngine().computeProjectionEpochInfo(cachedData || freshData).epochKey;
  const enrichedData = freshData?.sync_status
    ? {
        ...freshData,
        sync_status: {
          ...freshData.sync_status,
          projection_epoch_key: projectionEpochKey,
        },
      }
    : freshData;
  const payload = JSON.stringify({
    type: 'SYNC_COMPLETE',
    action,
    data: enrichedData,
    projection_epoch_key: projectionEpochKey,
    last_synced: freshData.sync_status?.last_synced,
    checked_at: new Date().toISOString()
  });

  const message = `event: sync_complete\ndata: ${payload}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
  console.log(`[Server SSE] Broadcasted SYNC_COMPLETE (${action}) to ${sseClients.size} active client(s).`);
}

function broadcastProjectionFormulaUpdated(projectionEpochKey: string, changedFiles: string[]) {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify({
    type: 'PROJECTION_FORMULA_UPDATED',
    projection_epoch_key: projectionEpochKey,
    changed_files: changedFiles,
    timestamp: new Date().toISOString(),
  });
  const message = `event: projection_formula_updated\ndata: ${payload}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
  console.log(
    `[Dev HotReload] Broadcasted PROJECTION_FORMULA_UPDATED (${projectionEpochKey}) [${changedFiles.join(', ')}] to ${sseClients.size} active client(s).`
  );
}

// Keep-alive heartbeat every 15s to keep connections alive across proxies and firewalls
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': keep-alive\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 15000);

// API Endpoints
app.get('/api/fpl-data', async (req, res) => {
  try {
    const forceSync = req.query.sync === '1' || req.query.sync === 'true' || req.query.force === '1';
    let executedAction: SyncActionType = 'C_SERVE';
    let gwStatusInfo: FplGwStatusCheck | null = null;

    if (!cachedData || forceSync) {
      // Condition 1: Container empty OR explicit force sync -> Action A
      console.log(`[Sync Orchestrator] Condition 1 met (container empty: ${!cachedData}, force: ${forceSync}) -> Action A (Full Sync)`);
      executedAction = 'A_FULL';
      await triggerSync('A_FULL');
    } else {
      // Container has data. Check official FPL API for active GW & Live/Final status
      try {
        gwStatusInfo = await checkFplGwStatus();
        const apiActiveGW = gwStatusInfo.currentGW;
        const cachedActiveGW = cachedData.current_gw;

        console.log(`[Sync Orchestrator] API Active GW: ${apiActiveGW} (${gwStatusInfo.statusText}), Container Active GW: ${cachedActiveGW}`);

        if (apiActiveGW !== cachedActiveGW) {
          // Condition 2: Active GW does not match -> Action A (Full Sync)
          console.log(`[Sync Orchestrator] Condition 2 met: GW changed (${cachedActiveGW} -> ${apiActiveGW}) -> Action A (Full Sync)`);
          executedAction = 'A_FULL';
          await triggerSync('A_FULL');
        } else if (!gwStatusInfo.isFinal) {
          // Condition 3: Active GW matches AND status is still Live -> Action B (Partial Sync: active GW only)
          console.log(`[Sync Orchestrator] Condition 3 met: GW ${apiActiveGW} is Live -> Action B (Refresh active GW ${apiActiveGW})`);
          executedAction = 'B_PARTIAL';
          await triggerSync('B_PARTIAL', apiActiveGW);
        } else {
          // Condition 4: API says GW is Final / Confirmed
          // Check if container data was already sealed as Confirmed or still has old Live data
          const isContainerAlreadyFinal = cachedData.gw_status?.status === 'Confirmed' &&
            Boolean(cachedData.gw_status?.data_checked) &&
            cachedData.gw_status?.leagues_status === 'Updated';

          if (!isContainerAlreadyFinal) {
            // TRANSITION SEAL: API is Confirmed, but container still holds Live data.
            // Execute Action B ONE LAST TIME to absorb official autosubs, bonus points, and minus hits.
            console.log(`[Sync Orchestrator] Condition 4a met: API turned Confirmed but container was still Live -> Executing Final Action B seal...`);
            executedAction = 'B_PARTIAL';
            await triggerSync('B_PARTIAL', apiActiveGW);
          } else {
            // Condition 4b: Both API and Container are Confirmed -> Action C (Zero Sync, serve instantly)
            console.log(`[Sync Orchestrator] Condition 4b met: GW ${apiActiveGW} is Final & container already sealed -> Action C (Serve cached data instantly)`);
            executedAction = 'C_SERVE';
          }
        }
      } catch (checkErr: any) {
        console.warn('[Sync Orchestrator] Quick GW status check failed, serving memory cache with silent background sync:', checkErr.message);
        // Fallback: serve memory cache and trigger background sync if not already syncing
        if (!isSyncing) {
          triggerSync('B_PARTIAL', cachedData.current_gw).catch(err => {
            console.warn('[Sync Orchestrator] Background fallback sync caught error:', err.message);
          });
        }
      }
    }

    const nowIso = new Date().toISOString();
    if (cachedData && cachedData.sync_status) {
      cachedData.sync_status.last_checked = nowIso;
      cachedData.sync_status.next_sync_wib = computeNextSyncWIB(
        Boolean(cachedData.sync_status.is_matchday_live),
        cachedData.sync_status.gw_fixtures || []
      );
      cachedData.sync_status.projection_epoch_key = getProjectionEngine().computeProjectionEpochInfo(cachedData).epochKey;
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      success: true,
      data: cachedData,
      action: executedAction,
      gw_check: gwStatusInfo,
      cached: executedAction === 'C_SERVE',
      isSyncing,
      checked_at: nowIso,
      freshness_seconds: Math.round((Date.now() - (cachedData?.sync_status?.last_synced ? new Date(cachedData.sync_status.last_synced).getTime() : Date.now())) / 1000)
    });
  } catch (err: any) {
    console.error('[Server] Error serving /api/fpl-data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let eventStatusBundleCache: { bundle: CompleteEventStatusBundle; timestamp: number } | null = null;
app.get('/api/fpl-event-status', async (req, res) => {
  try {
    const forceRefresh = Boolean(req.query.force || req.query._t);
    const now = Date.now();
    const eventStatusTTL = forceRefresh ? 0 : 15000;
    if (!forceRefresh && eventStatusBundleCache && now - eventStatusBundleCache.timestamp < eventStatusTTL) {
      return res.json({
        success: true,
        data: eventStatusBundleCache.bundle.rawEventStatus,
        ...eventStatusBundleCache.bundle
      });
    }

    const bundle = await fetchCompleteEventStatusBundle();
    eventStatusBundleCache = { bundle, timestamp: now };

    return res.json({
      success: true,
      data: bundle.rawEventStatus,
      ...bundle
    });
  } catch (err: any) {
    console.error('[Server] Failed to fetch complete event status bundle:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const FPL_TEAM_SHORT_NAMES: Record<number, string> = {
  1: 'ARS', 2: 'AVL', 3: 'BOU', 4: 'BRE', 5: 'BHA', 6: 'CHE', 7: 'COV', 8: 'CRY',
  9: 'EVE', 10: 'FUL', 11: 'HUL', 12: 'IPS', 13: 'LEE', 14: 'LIV', 15: 'MCI', 16: 'MUN',
  17: 'NEW', 18: 'NFO', 19: 'TOT', 20: 'SUN'
};

const playerSummaryCache = new Map<number, { data: any; timestamp: number }>();
const eventLiveCache = new Map<number, { data: any; timestamp: number }>();
const fixturesCache = new Map<number, { data: any; timestamp: number }>();

// Cache for all 380 official Premier League fixtures of the season
// Enables O(1) instant resolution of transferred players historical clubs without extra network roundtrips
let allSeasonFixturesCache: { map: Map<number, any>; timestamp: number } | null = null;

async function getAllSeasonFixturesMap(): Promise<Map<number, any>> {
  const now = Date.now();
  if (allSeasonFixturesCache && now - allSeasonFixturesCache.timestamp < 3600000 * 6) { // 6 hours TTL
    return allSeasonFixturesCache.map;
  }
  try {
    const resp = await fetch('https://fantasy.premierleague.com/api/fixtures/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (resp.ok) {
      const arr = await resp.json();
      const map = new Map<number, any>();
      if (Array.isArray(arr)) {
        for (const f of arr) {
          map.set(f.id, f);
        }
      }
      allSeasonFixturesCache = { map, timestamp: now };
      return map;
    }
  } catch (err: any) {
    console.warn('[Server] Failed to fetch all season fixtures:', err.message);
  }
  return allSeasonFixturesCache?.map || new Map();
}

app.get('/api/fpl-player-summary/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const gwParam = req.query.gw ? Number(req.query.gw) : null;
    if (!id) return res.status(400).json({ success: false, error: 'Invalid player ID' });

    const forceRefresh = Boolean(req.query.force || req.query._t);
    const now = Date.now();
    let summaryData: any = null;
    const cachedSummary = playerSummaryCache.get(id);
    const summaryTTL = forceRefresh ? 0 : 20000; // 20s TTL for real-time match stats, 0 on force/bypass
    if (!forceRefresh && cachedSummary && now - cachedSummary.timestamp < summaryTTL) {
      summaryData = cachedSummary.data;
    } else {
      try {
        const resp = await fetch(`https://fantasy.premierleague.com/api/element-summary/${id}/`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        if (resp.ok) {
          summaryData = await resp.json();
          playerSummaryCache.set(id, { data: summaryData, timestamp: now });
        }
      } catch (fetchErr: any) {
        console.warn(`[PlayerSummary] External fetch failed for player ${id}:`, fetchErr.message);
      }
    }

    const targetGW = gwParam || (cachedData?.current_gw || 0);
    const dbPlayer = getDbPlayerStatById(id) || null;

    if (!summaryData) {
      // Fallback directly to Database Player Statistics!
      if (dbPlayer) {
        const synthHistory = (dbPlayer.gwHistory || []).map(gh => ({
          round: gh.round,
          total_points: gh.points,
          minutes: gh.minutes,
          goals_scored: gh.goals,
          assists: gh.assists,
          bps: gh.bps,
          bonus: gh.bonus,
          opponent_short_name: 'GW' + gh.round
        }));

        return res.json({
          success: true,
          from_database: true,
          data: {
            id,
            gw: targetGW,
            player_info: dbPlayer,
            history: synthHistory,
            fixtures: [],
            live_stats: {
              total_points: dbPlayer.eventPoints || 0,
              goals_scored: dbPlayer.goalsScored || 0,
              assists: dbPlayer.assists || 0,
              minutes: dbPlayer.minutes || 0,
              bonus: dbPlayer.bonus || 0,
              bps: dbPlayer.bps || 0
            },
            live_explain: []
          }
        });
      }
      return res.status(502).json({ success: false, error: 'Failed to fetch player summary from FPL' });
    }

    let eventLiveData: any = null;
    const cachedEventLive = eventLiveCache.get(targetGW);
    // During live matches, allow fresh refresh every 15s (or immediately on forceRefresh)
    if (!forceRefresh && cachedEventLive && now - cachedEventLive.timestamp < 15000) {
      eventLiveData = cachedEventLive.data;
    } else {
      try {
        const liveResp = await fetch(`https://fantasy.premierleague.com/api/event/${targetGW}/live/`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        if (liveResp.ok) {
          eventLiveData = await liveResp.json();
          eventLiveCache.set(targetGW, { data: eventLiveData, timestamp: now });
        }
      } catch (e) {
        console.warn(`Could not fetch live data for GW ${targetGW}:`, e);
      }
    }

    let liveStats: any = null;
    let liveExplain: any[] = [];
    if (eventLiveData && Array.isArray(eventLiveData.elements)) {
      const elLive = eventLiveData.elements.find((e: any) => e.id === id);
      if (elLive) {
        liveStats = elLive.stats;
        liveExplain = elLive.explain || [];
      }
    }

    let fixturesData: any[] = [];
    const cachedFixtures = fixturesCache.get(targetGW);
    if (!forceRefresh && cachedFixtures && now - cachedFixtures.timestamp < 15000) {
      fixturesData = cachedFixtures.data;
    } else {
      try {
        const fixResp = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${targetGW}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        if (fixResp.ok) {
          fixturesData = await fixResp.json();
          fixturesCache.set(targetGW, { data: fixturesData, timestamp: now });
        }
      } catch (e: any) {
        console.warn(`Could not fetch fixtures for GW ${targetGW}:`, e.message);
      }
    }

    const fixturesMap = new Map<number, any>();
    if (Array.isArray(fixturesData)) {
      for (const f of fixturesData) {
        fixturesMap.set(f.id, f);
      }
    }

    const allSeasonMap = await getAllSeasonFixturesMap();

    let targetGwMatchesMap = new Map<number, any>();
    try {
      const matchCards = await fetchMatchesForGw(targetGW);
      if (Array.isArray(matchCards)) {
        for (const m of matchCards) {
          targetGwMatchesMap.set(m.id, m);
        }
      }
    } catch (e: any) {
      console.warn(`Could not get matchCards for GW ${targetGW}:`, e.message);
    }

    const enrichedHistory = (summaryData.history || []).map((h: any) => {
      const fix = (h.fixture ? fixturesMap.get(h.fixture) : null) || (h.fixture ? allSeasonMap.get(h.fixture) : null);
      const matchCard = h.fixture ? targetGwMatchesMap.get(h.fixture) : null;
      
      let playerTeamId: number | undefined;
      let homeTeamId: number | undefined;
      let awayTeamId: number | undefined;

      if (fix && fix.team_h && fix.team_a) {
        homeTeamId = fix.team_h;
        awayTeamId = fix.team_a;
        playerTeamId = h.was_home ? fix.team_h : fix.team_a;
      } else {
        homeTeamId = h.was_home ? undefined : h.opponent_team;
        awayTeamId = h.was_home ? h.opponent_team : undefined;
      }

      return {
        ...h,
        player_team: playerTeamId,
        player_team_short_name: playerTeamId ? FPL_TEAM_SHORT_NAMES[playerTeamId] : undefined,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        home_short_name: homeTeamId ? FPL_TEAM_SHORT_NAMES[homeTeamId] : undefined,
        away_short_name: awayTeamId ? FPL_TEAM_SHORT_NAMES[awayTeamId] : undefined,
        opponent_short_name: FPL_TEAM_SHORT_NAMES[h.opponent_team] || `Team ${h.opponent_team}`,
        fixture_started: matchCard ? matchCard.started : (fix ? fix.started : undefined),
        fixture_finished: matchCard ? matchCard.finished : (fix ? fix.finished : undefined),
        fixture_finished_provisional: matchCard ? matchCard.finished_provisional : (fix ? fix.finished_provisional : undefined),
        fixture_minutes: matchCard ? matchCard.minutes : (fix ? fix.minutes : undefined),
        fixture_phase: matchCard?.phase,
        fixture_clock_label: matchCard?.clock_label,
        fixture_is_half_time: matchCard?.is_half_time
      };
    });

    const enrichedGwFixtures = fixturesData.map((f: any) => {
      const m = targetGwMatchesMap.get(f.id);
      return {
        ...f,
        started: m ? m.started : f.started,
        finished: m ? m.finished : f.finished,
        finished_provisional: m ? m.finished_provisional : f.finished_provisional,
        phase: m?.phase,
        clock_label: m?.clock_label,
        is_half_time: m?.is_half_time
      };
    });

    res.json({
      success: true,
      data: {
        id,
        gw: targetGW,
        player_info: dbPlayer || null,
        history: enrichedHistory,
        history_past: summaryData?.history_past || [],
        fixtures: summaryData?.fixtures || [],
        gw_fixtures: enrichedGwFixtures,
        live_stats: liveStats,
        live_explain: liveExplain
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const shirtImageCache = new Map<string, { buffer: Buffer; contentType: string }>();

app.get('/api/fpl-shirt/:code', async (req, res) => {
  try {
    const rawCode = String(req.params.code).trim();
    const cleanCode = rawCode.replace(/^shirt_/, '').replace(/-220\.(webp|png)$/, '');
    const cacheKey = cleanCode;

    if (shirtImageCache.has(cacheKey)) {
      const cached = shirtImageCache.get(cacheKey)!;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(cached.buffer);
    }

    const candidates = [
      `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${cleanCode}-220.webp`,
      `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${cleanCode}-220.png`,
      `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${cleanCode}-110.webp`,
      `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-220.webp`
    ];

    for (const url of candidates) {
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/png,image/*;q=0.8'
          }
        });
        if (resp.ok) {
          const arrBuf = await resp.arrayBuffer();
          const buffer = Buffer.from(arrBuf);
          const contentType = resp.headers.get('content-type') || (url.endsWith('.png') ? 'image/png' : 'image/webp');
          shirtImageCache.set(cacheKey, { buffer, contentType });
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          return res.send(buffer);
        }
      } catch {
        // try next candidate
      }
    }

    // High quality vector SVG fallback jersey
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 290" width="220" height="290">
      <path d="M50,45 L85,25 L135,25 L170,45 L195,95 L165,115 L155,90 L155,250 L65,250 L65,90 L55,115 L25,95 Z" fill="#37003c" stroke="#00ff87" stroke-width="3"/>
      <path d="M85,25 Q110,50 135,25" fill="none" stroke="#00ff87" stroke-width="3"/>
    </svg>`);
  } catch (err: any) {
    res.status(500).send('Error');
  }
});

// Pre-warm all 20 Premier League club jerseys in RAM in small batches with request timeouts
async function prewarmShirtCache() {
  const codes = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 14, 17, 31, 36, 40, 43, 54, 56, 88, 91, 94];
  const jobs: Array<{ key: string; url: string }> = [];

  for (const c of codes) {
    const outfieldKey = String(c);
    if (!shirtImageCache.has(outfieldKey)) {
      jobs.push({
        key: outfieldKey,
        url: `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}-220.webp`,
      });
    }

    if (c !== 0) {
      const gkKey = `${c}_1`;
      if (!shirtImageCache.has(gkKey)) {
        jobs.push({
          key: gkKey,
          url: `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}_1-220.webp`,
        });
      }
    }
  }

  const CONCURRENCY = 6;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (job) => {
        try {
          const resp = await fetch(job.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(8000),
          });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            shirtImageCache.set(job.key, { buffer: buf, contentType: 'image/webp' });
          }
        } catch {}
      })
    );
  }
  console.log(`[Server] Pre-warmed ${shirtImageCache.size} jerseys into RAM memory for instant 0ms team modal opening!`);
}

// Proxied Player Photos for 100% reliable same-origin loading without ISP/CORS/Adblock blocks
// Strictly 1 primary source (Premier League 2025/2026 500x500) with zero fallbacks
const playerPhotoCache = new Map<string, { buffer: Buffer; contentType: string }>();

app.get('/api/fpl-player-photo/:code', async (req, res) => {
  try {
    const rawCode = String(req.params.code).trim();
    if (!rawCode) return res.status(400).send('Invalid player code');
    const cleanCode = rawCode.replace(/^p/, '').replace(/\.(png|jpg|webp)$/, '');
    if (!/^\d+$/.test(cleanCode)) return res.status(400).send('Invalid player code');

    if (playerPhotoCache.has(cleanCode)) {
      const cached = playerPhotoCache.get(cleanCode)!;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(cached.buffer);
    }

    const primaryPhotoUrl = `https://resources.premierleague.com/premierleague25/photos/players/500x500/${cleanCode}.png`;

    const resp = await fetch(primaryPhotoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/png,image/webp,image/*;q=0.8'
      }
    });

    if (resp.ok) {
      const arrBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrBuf);
      const contentType = resp.headers.get('content-type') || 'image/png';
      playerPhotoCache.set(cleanCode, { buffer, contentType });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(buffer);
    }

    res.status(404).send('Player photo not found');
  } catch (err: any) {
    res.status(500).send('Error');
  }
});

const managerDetailCache = new Map<number, { data: any; timestamp: number }>();

app.get('/api/fpl-manager-detail/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid manager ID' });

    const forceRefresh = Boolean(req.query.force || req.query._t);
    const now = Date.now();
    const cached = managerDetailCache.get(id);
    const managerTTL = forceRefresh ? 0 : 30000; // 30s TTL for live ranking updates
    if (!forceRefresh && cached && now - cached.timestamp < managerTTL) {
      return res.json({ success: true, data: cached.data });
    }

    const [entryRes, historyRes] = await Promise.all([
      fetch(`https://fantasy.premierleague.com/api/entry/${id}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      }).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`https://fantasy.premierleague.com/api/entry/${id}/history/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    ]);

    const resultData = {
      id,
      name: entryRes?.name || '',
      player_name: `${entryRes?.player_first_name || ''} ${entryRes?.player_last_name || ''}`.trim(),
      club_badge_src: entryRes?.club_badge_src || null,
      favourite_team: entryRes?.favourite_team || null,
      summary_overall_points: entryRes?.summary_overall_points || 0,
      summary_overall_rank: entryRes?.summary_overall_rank || 0,
      last_deadline_bank: entryRes?.last_deadline_bank != null ? (entryRes.last_deadline_bank / 10).toFixed(1) : '0.0',
      last_deadline_value: entryRes?.last_deadline_value != null ? (entryRes.last_deadline_value / 10).toFixed(1) : '0.0',
      past_seasons: (historyRes?.past || []).map((s: any) => ({
        ...s,
        fnb_rank: calculateFnbRank(s.season_name, s.rank)
      })),
      current_history: historyRes?.current || [],
      chips: historyRes?.chips || []
    };

    managerDetailCache.set(id, { data: resultData, timestamp: now });
    res.json({ success: true, data: resultData });
  } catch (err: any) {
    console.error(`Error in /api/fpl-manager-detail/${req.params.id}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Match Center API: Returns 10 matches for the given Gameweek with Pulse Live lineups and event badges
app.get('/api/fpl-matches/:gw', async (req, res) => {
  try {
    const gw = Number(req.params.gw) || (cachedData?.current_gw || 1);
    if (req.query.force === '1' || req.query.sync === '1') {
      invalidateMatchesCache(gw);
    }
    const matches = await fetchMatchesForGw(gw);
    res.json({
      success: true,
      gw,
      count: matches.length,
      data: matches
    });
  } catch (err: any) {
    console.error(`Error in /api/fpl-matches/${req.params.gw}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch Match Center API: Returns matches map { [gw]: MatchCardItem[] } for multiple GWs at once
app.get('/api/fpl-matches-batch', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.sync === '1';
    let targetGws: number[] = [];

    if (typeof req.query.gws === 'string' && req.query.gws.trim()) {
      targetGws = req.query.gws
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 38);
    } else {
      const maxGw = Math.min(Math.max(Number(req.query.max) || (cachedData?.current_gw || 1), 1), 38);
      targetGws = Array.from({ length: maxGw }, (_, i) => i + 1);
    }

    targetGws = Array.from(new Set(targetGws)).sort((a, b) => a - b);

    const results: Record<number, any[]> = {};
    await Promise.all(
      targetGws.map(async (gw) => {
        if (force) invalidateMatchesCache(gw);
        results[gw] = await fetchMatchesForGw(gw).catch(() => []);
      })
    );

    res.json({
      success: true,
      count: targetGws.length,
      data: results
    });
  } catch (err: any) {
    console.error('Error in /api/fpl-matches-batch:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SERVER-SIDE PROJECTION, REVIEW & SCOUT SOLVER ENDPOINTS
// Computed & cached strictly by GW lifecycle epoch (Live -> Provisional, Provisional -> Confirmed)
// ============================================================================
app.get('/api/projections-core', async (req, res) => {
  try {
    if (!cachedData) {
      return res.status(503).json({ success: false, error: 'Database not initialized yet' });
    }
    const engine = await getDevProjectionEngine();
    const force = req.query.force === '1' || req.query.sync === '1';
    if (force) {
      invalidateFixturesScheduleCache();
      engine.invalidateProjectionEngine('manual force');
    }
    const payload = await engine.getServerProjectionCore(cachedData, force);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('Error in /api/projections-core:', err);
    res.status(500).json({ success: false, error: err?.message || 'Projection core error' });
  }
});

app.get('/api/projections-review', async (req, res) => {
  try {
    if (!cachedData) {
      return res.status(503).json({ success: false, error: 'Database not initialized yet' });
    }
    const engine = await getDevProjectionEngine();
    const force = req.query.force === '1' || req.query.sync === '1';
    const gwParam = req.query.gw ? Number(req.query.gw) : undefined;
    const payload = await engine.getServerReviewBundle(cachedData, gwParam, force);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('Error in /api/projections-review:', err);
    res.status(500).json({ success: false, error: err?.message || 'Review bundle error' });
  }
});

app.get('/api/projections-scout-squads', async (req, res) => {
  try {
    if (!cachedData) {
      return res.status(503).json({ success: false, error: 'Database not initialized yet' });
    }
    const engine = await getDevProjectionEngine();
    const force = req.query.force === '1' || req.query.sync === '1';
    const payload = await engine.getServerScoutSquads(cachedData, force);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('Error in /api/projections-scout-squads:', err);
    res.status(500).json({ success: false, error: err?.message || 'Scout solver error' });
  }
});

app.get('/api/scout-manager-analysis', async (req, res) => {
  try {
    if (!cachedData) {
      return res.status(503).json({ success: false, error: 'Database not initialized yet' });
    }
    const rawEntryId = typeof req.query.entryId === 'string' ? req.query.entryId.trim() : '';
    let entryId: number | undefined;
    if (rawEntryId) {
      const parsed = Number(rawEntryId);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 100_000_000) {
        return res.status(400).json({ success: false, error: 'Invalid entryId' });
      }
      entryId = parsed;
    }

    const rawSection = typeof req.query.section === 'string' ? req.query.section.trim() : 'all';
    const section: 'chips' | 'transfer' | 'all' =
      rawSection === 'chips' || rawSection === 'transfer' ? rawSection : 'all';

    const rawMode = typeof req.query.transferMode === 'string' ? req.query.transferMode.trim().toUpperCase() : 'FT';
    const transferMode: 'FT' | 'HIT' = rawMode === 'HIT' ? 'HIT' : 'FT';

    const rawHorizon = Number(req.query.transferHorizon);
    const transferHorizon: 1 | 3 | 6 = rawHorizon === 3 || rawHorizon === 6 ? rawHorizon : 1;

    const rawLang = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase() : 'id';
    const lang: 'id' | 'en' = rawLang === 'en' ? 'en' : 'id';

    const force = req.query.force === '1' || req.query.sync === '1';

    const engine = await getDevProjectionEngine();
    const payload = await engine.getServerScoutManagerAnalysis(cachedData, {
      entryId,
      section,
      transferMode,
      transferHorizon,
      lang,
      force,
    });
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('Error in /api/scout-manager-analysis:', err);
    res.status(500).json({ success: false, error: err?.message || 'Scout manager analysis error' });
  }
});


// Support both GET and POST so external cron services (cron-job.org, Cloud Scheduler, uptime bots) can easily trigger sync
const handleSyncRequest = async (req: express.Request, res: express.Response) => {
  try {
    console.log(`[Server] Manual/External sync request received via ${req.method} from ${req.ip}`);
    const data = await triggerSync();
    res.json({
      success: true,
      message: 'Sync completed successfully',
      data: data,
      last_synced: data.sync_status.last_synced,
      next_sync_wib: data.sync_status.next_sync_wib
    });
  } catch (err: any) {
    console.error('[Server] Sync request error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/sync', handleSyncRequest);
app.get('/api/sync', handleSyncRequest);

app.get('/api/sync-status', (req, res) => {
  if (cachedData?.sync_status) {
    cachedData.sync_status.next_sync_wib = computeNextSyncWIB(
      Boolean(cachedData.sync_status.is_matchday_live),
      cachedData.sync_status.gw_fixtures || []
    );
    cachedData.sync_status.projection_epoch_key = getProjectionEngine().computeProjectionEpochInfo(cachedData).epochKey;
  }
  res.json({
    success: true,
    sync_status: cachedData?.sync_status || null,
    isSyncing,
    gw_status: cachedData?.gw_status || null,
    db_stats: getDatabaseStats(),
    pulse_all_comp_stats: getPulseAllCompDbStatus(),
  });
});

app.get('/api/pulse-all-comp/status', (_req, res) => {
  res.json({
    success: true,
    data: getPulseAllCompDbStatus(),
  });
});

app.get('/api/pulse-all-comp/club/:short', (req, res) => {
  const clubShort = String(req.params.short || '').trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(clubShort)) {
    return res.status(400).json({ success: false, error: 'Invalid club short code' });
  }
  const schedule = getClubAllCompSchedule(clubShort);
  const history = getClubAllCompHistory(clubShort);
  res.json({
    success: true,
    data: {
      clubShort,
      scheduleCount: schedule.length,
      historyCount: history.length,
      schedule,
      history: history.map(({ match, side }) => ({
        pulseMatchId: match.pulseMatchId,
        compId: match.compId,
        compAbbr: match.compAbbr,
        compDesc: match.compDesc,
        eplGw: match.eplGw,
        kickoffIso: match.kickoffIso,
        durationMins: match.durationMins,
        ...side,
      })),
    },
  });
});

app.post('/api/pulse-all-comp/sync', async (_req, res) => {
  try {
    const result = await syncPulseAllCompDatabase({ forceSchedule: true });
    res.json({
      success: true,
      result,
      status: getPulseAllCompDbStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Pulse all-comp sync failed' });
  }
});

app.post('/api/pulse-all-comp/tick', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true' || Boolean(req.body?.force);
    const tick = await runEventDrivenAllCompSyncTick({ force });
    if (tick.newlyFinalizedNonPlCount > 0 && cachedData) {
      await getCachedBootstrapStatic(true).catch(() => null);
      const engine = getProjectionEngine();
      engine.invalidateProjectionEngine('Manual all-comp tick finalized non-PL match');
      if (cachedData.sync_status) {
        cachedData.sync_status.next_sync_wib = computeNextSyncWIB(
          Boolean(cachedData.sync_status.is_matchday_live),
          cachedData.sync_status.gw_fixtures || []
        );
        cachedData.sync_status.projection_epoch_key = engine.computeProjectionEpochInfo(cachedData).epochKey;
      }
      engine.warmProjectionEngineIfNeeded(cachedData);
      broadcastSyncComplete(cachedData, 'ALL_COMP_EVENT');
    }
    res.json({
      success: true,
      tick,
      status: getPulseAllCompDbStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Pulse all-comp tick failed' });
  }
});

// Endpoint to completely empty the container cache (Cold Start state)
app.all('/api/container/clear', (req, res) => {
  console.log('[Server] Request received to completely empty container cache...');
  cachedData = null;
  resetDatabaseState();
  clearNewsTickerTable();
  clearAllPulseMatchFiles();
  invalidateMatchesCache();
  invalidateFixturesScheduleCache();
  getProjectionEngine().invalidateProjectionEngine('container cleared');
  playerSummaryCache.clear();
  eventLiveCache.clear();
  fixturesCache.clear();
  eventStatusBundleCache = null;

  // Broadcast sync clear to SSE clients
  const payload = JSON.stringify({ action: 'CLEARED', timestamp: new Date().toISOString() });
  const message = `event: sync_cleared\ndata: ${payload}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(message);
    } catch {}
  });

  console.log('[Server] Container completely emptied. Returned to Cold Start state.');
  res.json({
    success: true,
    message: 'Container berhasil dikosongkan. Sistem kini berada dalam status Cold Start (Data Kosong). Akses berikutnya akan memicu Action A (Download penuh seluruh GW dari FPL API).',
    timestamp: new Date().toISOString()
  });
});

// Real-Time Server-Sent Events (SSE) Stream
// Pushes fresh data immediately upon sync completion to all active browser sessions
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({
    type: 'CONNECTED',
    sync_status: cachedData?.sync_status || null,
    projection_epoch_key: cachedData ? getProjectionEngine().computeProjectionEpochInfo(cachedData).epochKey : null,
    last_synced: cachedData?.sync_status?.last_synced || null,
    checked_at: new Date().toISOString()
  })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Periodic background sync checker (runs autonomously on server)
// Guarantees data remains fresh and automatically pushes updates via SSE without user clicks
setInterval(async () => {
  if (isSyncing) return;
  if (!cachedData) return;

  try {
    // 1. Event-driven cross-competition scheduler (0 HTTP calls when IDLE)
    const acTick = await runEventDrivenAllCompSyncTick().catch(() => null);
    if (acTick?.ran) {
      if (cachedData.sync_status) {
        cachedData.sync_status.next_sync_wib = computeNextSyncWIB(
          Boolean(cachedData.sync_status.is_matchday_live),
          cachedData.sync_status.gw_fixtures || []
        );
      }
      if (acTick.newlyFinalizedNonPlCount > 0) {
        console.log(
          `[Autonomous AllCompSync] ${acTick.newlyFinalizedNonPlCount} Non-EPL match finalized (${acTick.mode}). Refreshing bootstrap & projection epoch...`
        );
        await getCachedBootstrapStatic(true).catch(() => null);
        const engine = getProjectionEngine();
        engine.invalidateProjectionEngine('All-Comp midweek FT finalized');
        if (cachedData.sync_status) {
          cachedData.sync_status.projection_epoch_key = engine.computeProjectionEpochInfo(cachedData).epochKey;
        }
        engine.warmProjectionEngineIfNeeded(cachedData);
        broadcastSyncComplete(cachedData, 'ALL_COMP_EVENT');
      } else if (acTick.lineupsCaptured > 0) {
        console.log(
          `[Autonomous AllCompSync] Captured ${acTick.lineupsCaptured} Non-EPL starting lineup(s) (${acTick.mode}).`
        );
      }
    }

    const isLive = Boolean(cachedData.sync_status?.is_matchday_live || (cachedData.gw_status && cachedData.gw_status.status !== 'Confirmed'));
    const lastSyncTime = cachedData.sync_status?.last_synced ? new Date(cachedData.sync_status.last_synced).getTime() : 0;
    const elapsed = Date.now() - lastSyncTime;

    // During live matches: auto-check and refresh every 30s
    // Outside live matches: auto-check every 90s
    const threshold = isLive ? 30000 : 90000;
    if (elapsed >= threshold) {
      const gwStatusInfo = await checkFplGwStatus();
      const apiActiveGW = gwStatusInfo.currentGW;
      const cachedActiveGW = cachedData.current_gw;

      if (apiActiveGW !== cachedActiveGW) {
        console.log(`[Autonomous Sync] GW changed (${cachedActiveGW} -> ${apiActiveGW}). Triggering Action A...`);
        await triggerSync('A_FULL');
      } else if (!gwStatusInfo.isFinal) {
        console.log(`[Autonomous Sync] Live GW ${apiActiveGW} ongoing. Triggering Action B...`);
        await triggerSync('B_PARTIAL', apiActiveGW);
      } else {
        const isContainerAlreadyFinal = cachedData.gw_status?.status === 'Confirmed' &&
          Boolean(cachedData.gw_status?.data_checked) &&
          cachedData.gw_status?.leagues_status === 'Updated';
        if (!isContainerAlreadyFinal) {
          console.log(`[Autonomous Sync] Transition seal for GW ${apiActiveGW}. Triggering Action B...`);
          await triggerSync('B_PARTIAL', apiActiveGW);
        } else if (cachedData.sync_status) {
          // Keep next_sync_wib synchronized cleanly when Confirmed IDLE
          cachedData.sync_status.next_sync_wib = computeNextSyncWIB(false, cachedData.sync_status.gw_fixtures || []);
        }
      }
    }
  } catch (err: any) {
    // Graceful silent error in background scheduler
  }
}, 20000);

// Dedicated Checker Endpoint: Live Match (LM) vs Between Match (BM) when GW status is Live
// NOTE: Strictly inspects whether any match is currently running for News Ticker phase resolution;
// does NOT mutate application GW status.
app.get('/api/news-ticker/phase-check', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const currentGw = getCurrentGw();
    if (force) {
      invalidateMatchesCache(currentGw);
    }
    const checkResult = await ensureLiveMatchesAndCheckPhase(currentGw);
    const newsTickerPhase = getGameweekPhase(currentGw);

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({
      success: true,
      newsTickerPhase,
      ...checkResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

let lastBmAutoSyncAt = 0;
let lastBmPulseSealAt = 0;

async function ensureBetweenMatchSyncCatchup(currentGw: number, prevBuiltPhase: string | null): Promise<boolean> {
  const now = Date.now();
  const cachedMatches = getCachedMatchesForGw(currentGw) || [];
  const db = getOptimalDatabase();
  const dbFixtures: any[] = Array.isArray(db?.meta?.sync_status?.gw_fixtures)
    ? db.meta.sync_status.gw_fixtures.filter((f: any) => Number(f.event) === currentGw)
    : [];

  const cachedFinishedCount = cachedMatches.filter(
    (m) => m.finished || m.finished_provisional || m.phase === 'FT'
  ).length;
  const dbFinishedCount = dbFixtures.filter(
    (f: any) => f.finished || f.finished_provisional
  ).length;

  const justLeftLiveMatch = Boolean(prevBuiltPhase && isPhaseActive('Live Match', prevBuiltPhase));
  const hasNewFinishedMatch = cachedFinishedCount > dbFinishedCount;
  let pulseSealed = false;

  if ((justLeftLiveMatch || hasNewFinishedMatch) && now - lastBmPulseSealAt >= 45000) {
    lastBmPulseSealAt = now;
    const sealRes = await ensureLivePulseMatchesSynced(currentGw, { force: true }).catch(() => null);
    pulseSealed = Boolean(sealRes && sealRes.synced > 0);
  }

  if ((justLeftLiveMatch || hasNewFinishedMatch) && !isSyncing && cachedData && now - lastBmAutoSyncAt >= 45000) {
    lastBmAutoSyncAt = now;
    console.log(
      `[Server LM->BM] Detected transition/newly finished match (cachedFT=${cachedFinishedCount}, dbFT=${dbFinishedCount}); triggering background Action B sync for GW ${currentGw}...`
    );
    triggerSync('B_PARTIAL', currentGw).catch((err: any) => {
      console.warn('[Server LM->BM] Background Action B catch-up failed:', err?.message || err);
    });
  }

  return pulseSealed;
}

function hasUpcomingMatchWithin95mOrLineup(currentGw: number): boolean {
  const cached = getCachedMatchesForGw(currentGw);
  const nowMs = Date.now();
  const windowMs = 95 * 60 * 1000;
  if (Array.isArray(cached) && cached.length > 0) {
    return cached.some((m) => {
      if (m.started || m.finished || m.finished_provisional) return false;
      if (m.has_lineup) return true;
      const koMs = m.kickoff_time ? Date.parse(m.kickoff_time) : NaN;
      return Number.isFinite(koMs) && koMs - nowMs <= windowMs;
    });
  }
  const db = getOptimalDatabase();
  const fixtures: any[] = Array.isArray(db?.meta?.sync_status?.gw_fixtures)
    ? db.meta.sync_status.gw_fixtures
    : [];
  return fixtures.some((f) => {
    if (Number(f.event) !== currentGw || f.started || f.finished) return false;
    const koMs = f.kickoff_time ? Date.parse(f.kickoff_time) : NaN;
    return Number.isFinite(koMs) && koMs - nowMs <= windowMs;
  });
}

// Endpoint News Ticker Feed (Directly served from database container)
app.get('/api/news-ticker/feed', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const phase = req.query.phase ? String(req.query.phase) : undefined;
    const currentGw = getCurrentGw();
    const prevBuiltState = getNewsTickerBuiltState();

    // When GW status is Live (or fixtures are mid-GW), run the dedicated LM vs BM checker
    // with fresh match states BEFORE resolving News Ticker phase and reading the container table.
    const liveMatchCheck = await ensureLiveMatchesAndCheckPhase(currentGw).catch(() =>
      checkLiveBetweenMatchPhase(currentGw)
    );
    const currentPhase = phase || getGameweekPhase(currentGw);

    let livePulseSynced = false;
    const preKickoffWindowActive = hasUpcomingMatchWithin95mOrLineup(currentGw);
    if (isPhaseActive('Live Match', currentPhase)) {
      if (force) {
        invalidateMatchesCache(currentGw);
      }
      const [, pulseSyncResult] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        ensureLivePulseMatchesSynced(currentGw, { force }).catch(() => null),
      ]);
      livePulseSynced = Boolean(pulseSyncResult && pulseSyncResult.synced > 0);
    } else if (isPhaseActive('Between Match', currentPhase)) {
      if (force) {
        invalidateMatchesCache(currentGw);
      }
      const [, upcomingPulseSync] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        preKickoffWindowActive
          ? ensureLivePulseMatchesSynced(currentGw, { force, ttlMs: 30000 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const bmCatchupSynced = await ensureBetweenMatchSyncCatchup(currentGw, prevBuiltState.phase);
      livePulseSynced =
        bmCatchupSynced || Boolean(upcomingPulseSync && upcomingPulseSync.synced > 0);
    } else if (isPhaseActive('Not started', currentPhase)) {
      if (force) {
        invalidateMatchesCache(currentGw);
      }
      const [, nsPulseSync] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        preKickoffWindowActive
          ? ensureLivePulseMatchesSynced(currentGw, { force, ttlMs: 30000 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      livePulseSynced = Boolean(nsPulseSync && nsPulseSync.synced > 0);
    } else if (isPhaseActive('Confirmed', currentPhase) && (!getCachedMatchesForGw(currentGw) || force)) {
      if (force) {
        invalidateMatchesCache(currentGw);
      }
      await fetchMatchesForGw(currentGw).catch(() => null);
    }

    if (isPhaseActive('Confirmed', currentPhase)) {
      await ensureNextGwFixtureMetaIfMissing(currentGw).catch(() => null);
    }

    const builtState = getNewsTickerBuiltState();
    const gwChanged = builtState.gw !== null && builtState.gw !== currentGw;
    const phaseChanged =
      builtState.phase !== null && !isPhaseActive(builtState.phase, currentPhase);
    const liveNeedsRefresh =
      isPhaseActive('Live Match', currentPhase) &&
      (livePulseSynced || Date.now() - getNewsTickerLastBuiltAt() >= 15000);
    const bmNeedsRefresh =
      isPhaseActive('Between Match', currentPhase) &&
      (livePulseSynced ||
        Date.now() - getNewsTickerLastBuiltAt() >= (preKickoffWindowActive ? 30000 : 60000));
    const nsNeedsRefresh =
      isPhaseActive('Not started', currentPhase) &&
      (livePulseSynced ||
        (preKickoffWindowActive && Date.now() - getNewsTickerLastBuiltAt() >= 30000));

    let containerRows = getNewsTickerTable();
    const hasFinishedStatRowsStillActive =
      isPhaseActive('Live Match', currentPhase) &&
      containerRows.some((r) => r.status_tayang === 'Y' && isLiveStatRowForFinishedMatch(r, currentGw));
    if (
      force ||
      phase ||
      gwChanged ||
      phaseChanged ||
      liveNeedsRefresh ||
      bmNeedsRefresh ||
      nsNeedsRefresh ||
      hasFinishedStatRowsStillActive ||
      containerRows.length === 0 ||
      containerRows.some(
        (r) =>
          !r.gw ||
          Number(r.gw) !== currentGw ||
          !r.fase ||
          !isPhaseActive(r.fase, currentPhase)
      )
    ) {
      containerRows = rebuildNewsTickerTable(phase);
    }

    // Active airing stories from db container:
    // ATURAN MUTLAK: Jangan tayangkan apapun selain yang bersumber dari tabel editor & strictly GW aktif
    const activeRows = containerRows.filter((r) => {
      if (r.status_tayang !== 'Y') return false;
      if (r.sumber !== 'Sys' || !isEditorTemplateId(r.id)) return false;
      if (!r.gw || Number(r.gw) !== currentGw) return false;
      if (!r.fase || r.fase.trim() === '' || r.fase === '-') return false;
      if (isPhaseActive('Live Match', currentPhase) && isLiveStatRowForFinishedMatch(r, currentGw)) return false;
      return isPhaseActive(r.fase, currentPhase);
    });

    const storiesWithMeta = activeRows.map((r) => ({
      id: r.id,
      headline_id: r.text_berita,
      headline_en: r.text_berita_en,
      headline: r.text_berita,
      drama_score: r.drama_score,
      poin_tayang: r.poin_tayang,
      timestamp_produksi: r.timestamp_produksi,
      sumber: r.sumber,
      status_tayang: r.status_tayang,
      keterangan_tidak_tayang: r.keterangan_tidak_tayang,
      fase: r.fase,
      waktu_tayang: r.waktu_tayang,
      kategori: r.kategori,
      sub_kategori: r.sub_kategori,
      gw: r.gw,
      teams: r.teams,
      players: r.players,
      cycle_meta: r.cycle_meta,
    }));

    // For Live Match: micro-cycle scheduler (Snapshot Inti + Breaking Events + strict minor cap + 12 NS fallback when < 10).
    // For NS, BM, PV, CF: dynamic 1-cycle proportional batch selection using poin_tayang ASC without mutating status_tayang.
    const knownPhaseTemplateIds = getPhase1Templates().map((t) => t.id);
    let scheduledStories: typeof storiesWithMeta;
    if (isPhaseActive('Live Match', currentPhase)) {
      scheduledStories = selectLiveMatchCycleBatch(storiesWithMeta, knownPhaseTemplateIds);
    } else {
      const batchPhase: BatchCyclePhase = isPhaseActive('Not started', currentPhase)
        ? 'Not started'
        : isPhaseActive('Between Match', currentPhase)
          ? 'Between Match'
          : isPhaseActive('Provisional', currentPhase)
            ? 'Provisional'
            : 'Confirmed';
      scheduledStories = selectCycleBatchForPhase(
        storiesWithMeta,
        batchPhase,
        currentGw,
        knownPhaseTemplateIds
      );
    }

    const stories = scheduledStories.map(({ cycle_meta: _cycleMeta, ...rest }) => rest);

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    res.json({
      success: true,
      gameweek: currentGw,
      gameweekPhase: currentPhase,
      liveMatchCheck,
      lastUpdated: new Date().toISOString(),
      count: stories.length,
      data: stories,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint Admin: News Ticker Database Table in Container
app.get('/api/admin/news-ticker', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const phase = req.query.phase ? String(req.query.phase) : undefined;
    const currentGw = getCurrentGw();
    const prevBuiltState = getNewsTickerBuiltState();
    if (!phase) {
      await ensureLiveMatchesAndCheckPhase(currentGw).catch(() => null);
    }
    const currentPhase = phase || getGameweekPhase(currentGw);
    let livePulseSynced = false;
    const preKickoffWindowActive = hasUpcomingMatchWithin95mOrLineup(currentGw);
    if (isPhaseActive('Live Match', currentPhase)) {
      if (forceRefresh) {
        invalidateMatchesCache(currentGw);
      }
      const [, pulseSyncResult] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        ensureLivePulseMatchesSynced(currentGw, { force: forceRefresh }).catch(() => null),
      ]);
      livePulseSynced = Boolean(pulseSyncResult && pulseSyncResult.synced > 0);
    } else if (isPhaseActive('Between Match', currentPhase)) {
      if (forceRefresh) {
        invalidateMatchesCache(currentGw);
      }
      const [, upcomingPulseSync] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        preKickoffWindowActive
          ? ensureLivePulseMatchesSynced(currentGw, { force: forceRefresh, ttlMs: 30000 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const bmCatchupSynced = await ensureBetweenMatchSyncCatchup(currentGw, prevBuiltState.phase);
      livePulseSynced =
        bmCatchupSynced || Boolean(upcomingPulseSync && upcomingPulseSync.synced > 0);
    } else if (isPhaseActive('Not started', currentPhase)) {
      if (forceRefresh) {
        invalidateMatchesCache(currentGw);
      }
      const [, nsPulseSync] = await Promise.all([
        fetchMatchesForGw(currentGw).catch(() => null),
        preKickoffWindowActive
          ? ensureLivePulseMatchesSynced(currentGw, { force: forceRefresh, ttlMs: 30000 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      livePulseSynced = Boolean(nsPulseSync && nsPulseSync.synced > 0);
    } else if (
      isPhaseActive('Confirmed', currentPhase) &&
      (!getCachedMatchesForGw(currentGw) || forceRefresh)
    ) {
      if (forceRefresh) {
        invalidateMatchesCache(currentGw);
      }
      await fetchMatchesForGw(currentGw).catch(() => null);
    }

    if (isPhaseActive('Confirmed', currentPhase)) {
      await ensureNextGwFixtureMetaIfMissing(currentGw).catch(() => null);
    }

    const builtState = getNewsTickerBuiltState();
    const gwChanged = builtState.gw !== null && builtState.gw !== currentGw;
    const phaseChanged =
      builtState.phase !== null && !isPhaseActive(builtState.phase, currentPhase);
    const liveNeedsRefresh =
      isPhaseActive('Live Match', currentPhase) &&
      (livePulseSynced || Date.now() - getNewsTickerLastBuiltAt() >= 15000);
    const bmNeedsRefresh =
      isPhaseActive('Between Match', currentPhase) &&
      (livePulseSynced ||
        Date.now() - getNewsTickerLastBuiltAt() >= (preKickoffWindowActive ? 30000 : 60000));
    const nsNeedsRefresh =
      isPhaseActive('Not started', currentPhase) &&
      (livePulseSynced ||
        (preKickoffWindowActive && Date.now() - getNewsTickerLastBuiltAt() >= 30000));

    if (forceRefresh || phase || gwChanged || phaseChanged || liveNeedsRefresh || bmNeedsRefresh || nsNeedsRefresh) {
      rebuildNewsTickerTable(phase);
    }

    const search = req.query.search ? String(req.query.search) : undefined;
    const kategori = req.query.kategori ? String(req.query.kategori) : undefined;
    const sumber = req.query.sumber ? String(req.query.sumber) : undefined;
    const status_tayang = req.query.status_tayang ? String(req.query.status_tayang) : undefined;
    const waktu_tayang = req.query.waktu_tayang ? String(req.query.waktu_tayang) : undefined;
    const fase = req.query.fase ? String(req.query.fase) : (req.query.phase ? String(req.query.phase) : undefined);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = queryNewsTickerTable({
      search,
      kategori,
      sumber,
      status_tayang,
      waktu_tayang,
      fase,
      limit,
      offset
    });

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint Admin: Increment poin tayang
app.post('/api/admin/news-ticker/increment-point', (req, res) => {
  try {
    const { id, cycleSize } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'ID is required' });
    const parsedCycleSize = Number(cycleSize);
    const result = incrementPoinTayang(
      String(id),
      Number.isFinite(parsedCycleSize) && parsedCycleSize > 0 ? parsedCycleSize : undefined
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= PHASE 1 TEMPLATES API =================
// 1. Get all Phase 1 templates
app.get('/api/admin/phase1-templates', (req, res) => {
  try {
    const templates = getPhase1Templates();
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, count: templates.length, data: templates });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. Get Real League Data Preview for Phase 1 & Live Match templates
app.get('/api/admin/phase1-templates/real-preview', async (req, res) => {
  try {
    const currentGw = getCurrentGw();
    const stories = generatePhase1Stories(currentGw);
    
    // Also include live match preview stories from Pulse API + live stats (LM_MATCH_SAVES_GOALKEEPER, LM_MATCH_DEFENSIVE_CONTRIBUTION)
    try {
      const {
        generateStoriesFromPulseMatch,
        fetchAndGenerateLiveMatchStatStories,
        generateLiveLineupSurpriseStories,
      } = await import('./src/server/liveMatchStoryGenerator.ts');
      const pulseList = loadPulseMatchesForGw(currentGw);
      for (const pulseData of pulseList) {
        const liveStories = generateStoriesFromPulseMatch(pulseData, currentGw);
        for (const ls of liveStories) {
          stories.push({
            id: ls.id,
            headline_id: ls.headline_id,
            headline_en: ls.headline_en,
            kategori: ls.kategori,
            sub_kategori: ls.sub_kategori,
            drama_score: ls.drama_score,
            waktu_tayang: ls.waktu_tayang,
            gw: ls.gw,
            teams: ls.teams,
            players: ls.players,
            sumber: ls.sumber,
            status_tayang: ls.status_tayang,
            keterangan_tidak_tayang: ls.keterangan_tidak_tayang,
          } as any);
        }
      }

      const statStories = await fetchAndGenerateLiveMatchStatStories(currentGw, true);
      for (const ss of statStories) {
        stories.push({
          id: ss.id,
          headline_id: ss.headline_id,
          headline_en: ss.headline_en,
          kategori: ss.kategori,
          sub_kategori: ss.sub_kategori,
          drama_score: ss.drama_score,
          waktu_tayang: ss.waktu_tayang,
          gw: ss.gw,
          teams: ss.teams,
          players: ss.players,
          sumber: ss.sumber,
          status_tayang: ss.status_tayang,
          keterangan_tidak_tayang: ss.keterangan_tidak_tayang,
        } as any);
      }

      const liveLineupStories = generateLiveLineupSurpriseStories(currentGw, { includeFinished: true });
      for (const lls of liveLineupStories) {
        stories.push({
          id: lls.id,
          headline_id: lls.headline_id,
          headline_en: lls.headline_en,
          kategori: lls.kategori,
          sub_kategori: lls.sub_kategori,
          drama_score: lls.drama_score,
          waktu_tayang: lls.waktu_tayang,
          gw: lls.gw,
          teams: lls.teams,
          players: lls.players,
          sumber: lls.sumber,
          status_tayang: lls.status_tayang,
          keterangan_tidak_tayang: lls.keterangan_tidak_tayang,
        } as any);
      }
    } catch (err: any) {
      console.warn('[Admin Editor] Could not fetch Pulse match preview:', err.message);
    }

    // Include Between Match & Provisional phase stories generated from Editor templates (BM_*, PV_*)
    try {
      const bmStories = generateBetweenMatchStories(currentGw);
      for (const bms of bmStories) {
        stories.push(bms as any);
      }
      const pvStories = generateProvisionalStories(currentGw);
      for (const pvs of pvStories) {
        stories.push(pvs as any);
      }
    } catch (err: any) {
      console.warn('[Admin Editor] Could not generate Between Match/Provisional preview:', err.message);
    }

    // Also include Confirmed phase stories generated from Editor templates (CF_*)
    try {
      await ensureNextGwFixtureMetaIfMissing(currentGw).catch(() => null);
      const confStories = generateConfirmedStories(currentGw);
      for (const cs of confStories) {
        stories.push(cs as any);
      }
    } catch (err: any) {
      console.warn('[Admin Editor] Could not generate Confirmed preview:', err.message);
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.json({ success: true, count: stories.length, data: stories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Update a Phase 1 template
app.put('/api/admin/phase1-templates/:id', (req, res) => {
  try {
    const templateId = req.params.id;
    const updates = req.body;
    const current = getPhase1Templates();
    const idx = current.findIndex(t => t.id === templateId || t.no === Number(templateId));
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Template ${templateId} not found` });
    }
    current[idx] = { ...current[idx], ...updates, updated_at: new Date().toISOString() };
    const savedOk = savePhase1Templates(current);
    if (!savedOk) {
      return res.status(500).json({ success: false, error: 'Gagal menulis file template ke disk' });
    }
    clearNewsTickerMemoryCache();
    rebuildNewsTickerTable();
    const updatedList = getPhase1Templates();
    const updatedRow = updatedList.find(t => t.id === current[idx].id) || current[idx];
    res.json({ success: true, message: `Template ${templateId} updated`, data: updatedRow });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Bulk update all Phase 1 templates (Save whole table at once)
app.put('/api/admin/phase1-templates', (req, res) => {
  try {
    const newItems = req.body;
    if (!Array.isArray(newItems)) {
      return res.status(400).json({ success: false, error: 'Expected array of templates' });
    }
    const savedOk = savePhase1Templates(newItems);
    if (!savedOk) {
      return res.status(500).json({ success: false, error: 'Gagal menulis perubahan template ke disk' });
    }
    clearNewsTickerMemoryCache();
    rebuildNewsTickerTable();
    const freshTemplates = getPhase1Templates();
    res.json({ success: true, message: 'Seluruh template berhasil disimpan dan diterapkan', data: freshTemplates });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Reset Phase 1 templates to defaults
app.post('/api/admin/phase1-templates/reset', (req, res) => {
  try {
    const defaults = resetPhase1Templates();
    clearNewsTickerMemoryCache();
    rebuildNewsTickerTable();
    res.json({ success: true, message: 'Phase 1 templates reset to default standards', data: defaults });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/api/container/status', (req, res) => {
  const hasDatabase = fs.existsSync(path.join(process.cwd(), 'src/data/fpl_database.json'));
  res.json({
    success: true,
    isColdStart: cachedData === null,
    hasMemoryCache: cachedData !== null,
    hasDiskCache: hasDatabase,
    hasDatabase,
    currentGw: cachedData?.current_gw ?? null,
    timestamp: new Date().toISOString()
  });
});







const DEV_FORMULA_WATCH_FILES = [
  'src/utils/projectionModel.ts',
  'src/utils/matchScoreModel.ts',
  'src/utils/playerXpModel.ts',
  'src/utils/fplProvenGuard.ts',
  'src/utils/tacticalLineupModel.ts',
  'src/utils/hybridLineupModel.ts',
  'src/utils/scoutSelectionModel.ts',
  'src/utils/scoutNarratives.ts',
  'src/data/playerExplosiveCatalog.ts',
  'src/server/pulsePlayerPositions.ts',
  'src/server/scoutServerEngine.ts',
  'src/server/projectionEngineServer.ts',
];

function computeDevFileSha256(absPath: string): string {
  try {
    if (!fs.existsSync(absPath)) return 'missing';
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return 'error';
  }
}

function setupDevFormulaWatcher(vite: any) {
  const cwd = process.cwd();
  const hashByRel = new Map<string, string>();
  const mtimeByRel = new Map<string, string>();

  for (const rel of DEV_FORMULA_WATCH_FILES) {
    const abs = path.join(cwd, rel);
    hashByRel.set(rel, computeDevFileSha256(abs));
    try {
      const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
      mtimeByRel.set(rel, st ? `${st.mtimeMs}:${st.size}` : 'missing');
    } catch {
      mtimeByRel.set(rel, 'missing');
    }
  }

  let isReloading = false;
  let pendingReload = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const runFormulaReload = async () => {
    if (isReloading) {
      pendingReload = true;
      return;
    }
    isReloading = true;
    try {
      const changedFiles: string[] = [];
      for (const rel of DEV_FORMULA_WATCH_FILES) {
        const abs = path.join(cwd, rel);
        let mtimeKey = 'missing';
        try {
          const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
          mtimeKey = st ? `${st.mtimeMs}:${st.size}` : 'missing';
        } catch {}

        const prevMtime = mtimeByRel.get(rel);
        const nextHash = computeDevFileSha256(abs);
        const prevHash = hashByRel.get(rel);
        mtimeByRel.set(rel, mtimeKey);
        if (nextHash !== prevHash || (prevMtime && prevMtime !== mtimeKey && nextHash === 'error')) {
          hashByRel.set(rel, nextHash);
          changedFiles.push(rel);
        }
      }

      if (changedFiles.length === 0) return;

      const nowTs = Date.now();
      const urlsToInvalidate = new Set<string>([
        '/src/server/projectionEngineServer.ts',
        ...changedFiles.map((rel) => `/${rel.replace(/^\/+/, '')}`),
      ]);

      for (const url of urlsToInvalidate) {
        try {
          const modByUrl = await vite.moduleGraph.getModuleByUrl(url);
          if (modByUrl) {
            vite.moduleGraph.invalidateModule(modByUrl, new Set(), nowTs, false);
          }
        } catch {}
        try {
          const absPath = path.join(cwd, url.replace(/^\/+/, ''));
          const modsByFile = vite.moduleGraph.getModulesByFile(absPath);
          if (modsByFile) {
            for (const m of modsByFile) {
              vite.moduleGraph.invalidateModule(m, new Set(), nowTs, false);
            }
          }
        } catch {}
      }

      const prevEngine = hotProjectionEngine;
      const nextEngine = (await vite.ssrLoadModule('/src/server/projectionEngineServer.ts')) as ProjectionEngineModule;
      try {
        prevEngine?.invalidateProjectionEngine?.('dev formula hot-reload');
      } catch {}
      hotProjectionEngine = nextEngine;

      await dbReadyPromise;
      const nextEpochInfo = nextEngine.computeProjectionEpochInfo(cachedData);
      if (cachedData?.sync_status) {
        cachedData.sync_status.projection_epoch_key = nextEpochInfo.epochKey;
      }
      if (cachedData) {
        nextEngine.warmProjectionEngineIfNeeded(cachedData);
      }

      console.log(
        `[Dev HotReload] Formula change detected (${changedFiles.join(', ')}) -> reloaded engine, new epoch ${nextEpochInfo.epochKey}`
      );
      broadcastProjectionFormulaUpdated(nextEpochInfo.epochKey, changedFiles);
    } catch (err: any) {
      console.error('[Dev HotReload] Failed to reload projection formula:', err?.message || err);
    } finally {
      isReloading = false;
      if (pendingReload) {
        pendingReload = false;
        scheduleReload();
      }
    }
  };

  const scheduleReload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runFormulaReload().catch(() => {});
    }, 120);
  };

  const watchedDirs = new Set(DEV_FORMULA_WATCH_FILES.map((rel) => path.dirname(path.join(cwd, rel))));
  for (const dirPath of watchedDirs) {
    try {
      const targetBasenames = new Set(
        DEV_FORMULA_WATCH_FILES
          .filter((rel) => path.dirname(path.join(cwd, rel)) === dirPath)
          .map((rel) => path.basename(rel))
      );
      const watcher = fs.watch(dirPath, { persistent: false }, (_eventType, filename) => {
        if (!filename || targetBasenames.has(String(filename))) {
          scheduleReload();
        }
      });
      watcher.on('error', () => {});
    } catch {}
  }

  // Lightweight stat safety-net poll in case OS/container drops fs.watch during atomic saves
  const safetyTimer = setInterval(() => {
    for (const rel of DEV_FORMULA_WATCH_FILES) {
      const abs = path.join(cwd, rel);
      let mtimeKey = 'missing';
      try {
        const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
        mtimeKey = st ? `${st.mtimeMs}:${st.size}` : 'missing';
      } catch {}
      if (mtimeKey !== mtimeByRel.get(rel)) {
        scheduleReload();
        break;
      }
    }
  }, 1200);
  safetyTimer.unref?.();
}

// Vite / static file serving — bind port 3000 immediately so dev server readiness succeeds quickly,
// while incoming frontend/API requests cleanly await initialization promises if they arrive during boot.
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const viteMiddlewarePromise = (async () => {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          ws: false,
          allowedHosts: true,
          watch: {
            ignored: ['**/*'],
          },
        },
        appType: 'spa',
      });
      // Load hot-reloadable projection engine asynchronously so GET / and Vite client assets never block on SSR module eval
      void (async () => {
        try {
          const loadedEngine = (await vite.ssrLoadModule('/src/server/projectionEngineServer.ts')) as ProjectionEngineModule;
          hotProjectionEngine = loadedEngine;
          resolveDevEngineInit(loadedEngine);
          setupDevFormulaWatcher(vite);
        } catch (ssrErr: any) {
          console.warn('[Dev HotReload] Falling back to static projection engine on init error:', ssrErr?.message || ssrErr);
          resolveDevEngineInit(staticProjectionEngine);
        }
      })();
      return vite.middlewares;
    })().catch((err) => {
      console.error('[Server] Vite middleware initialization failed:', err);
      resolveDevEngineInit(staticProjectionEngine);
      throw err;
    });

    app.use(async (req, res, next) => {
      try {
        const mw = await viteMiddlewarePromise;
        mw(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`[Server] FPL Nusantara BERHADIAH running on port ${PORT}`);

    setTimeout(() => {
      initializeDatabaseState();
    }, 50);

    setTimeout(() => {
      dbReadyPromise.then(() => {
        try {
          if (cachedData) {
            getNewsTickerTable();
          }
        } catch (err: any) {
          console.warn('[Server] Initial Editor news table warm warning:', err.message);
        }
      });
    }, 1500);

    setTimeout(() => {
      prewarmShirtCache().catch(() => {});
      Promise.all([dbReadyPromise, getDevProjectionEngine()]).then(([, engine]) => {
        const allCompStatus = getPulseAllCompDbStatus();
        if (allCompStatus.scheduleTotalFixtures === 0 || allCompStatus.unfinalizedCompletedCount > 0) {
          syncPulseAllCompDatabase().catch((err: any) => {
            console.warn('[Server] Background PulseAllCompDB warm failed:', err?.message || err);
          });
        }
        const scheduleWarm = () => {
          setTimeout(() => {
            if (cachedData) {
              engine.warmProjectionEngineIfNeeded(cachedData);
            }
          }, 3500);
        };
        if (cachedData?.current_gw) {
          prewarmMatchesCache(cachedData.current_gw)
            .catch(() => {})
            .finally(scheduleWarm);
        } else if (cachedData) {
          scheduleWarm();
        }
      });
    }, 300);
  });

  httpServer.on('error', (err: any) => {
    console.error(`[Server] Failed to listen on ${HOST}:${PORT}:`, err?.message || err);
    process.exit(1);
  });
}

startServer();
