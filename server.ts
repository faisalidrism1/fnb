import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { fetchAndTransformLeague, checkFplGwStatus, FplGwStatusCheck, fetchCompleteEventStatusBundle, CompleteEventStatusBundle } from './src/server/dataFetcher.ts';
import { fetchMatchesForGw, invalidateMatchesCache } from './src/server/matchesFetcher.ts';
import { TransformedLeagueData } from './src/types.ts';
import {
  initDatabase,
  executeSchemaSync,
  getOptimalDatabase,
  getGwSnapshot,
  getOptimalPlayerById,
  getOptimalManagerById,
  getDbStandings,
  getDbGameweekChampions,
  getDbOwnershipPlayers,
  getDbOwnershipClubs,
  getDbFansClubs,
  getDbTemplateSquads,
  getDbTransfers,
  getDbLigaMinus,
  getDbCaptainStats,
  getDbChipsUsed,
  getDbPlayerStats,
  getDbPlayerStatById,
  getDbSyncMeta,
  getDatabaseStats
} from './src/server/db.ts';
import {
  generateNewsTickerFeed,
  triggerBackgroundNewsUpdate,
  getCachedNewsFeed
} from './src/server/geminiNewsService.ts';

const app = express();

const PORT = 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');
const LEAGUE_PAST_SEASONS_PATH = path.join(process.cwd(), 'src/data/league_past_seasons.json');

let leaguePastSeasonsData: Record<string, Array<{ season_name: string; total_points: number; rank: number }>> = {};
if (fs.existsSync(LEAGUE_PAST_SEASONS_PATH)) {
  try {
    leaguePastSeasonsData = JSON.parse(fs.readFileSync(LEAGUE_PAST_SEASONS_PATH, 'utf-8'));
  } catch (err: any) {
    console.warn('[Server] Error reading league_past_seasons.json:', err.message);
  }
}

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

// Initialize the Optimal Pre-Aggregated Database Schema
initDatabase();

// In-Memory Micro-Cache with instant disk pre-seed for 0ms cold starts
let cachedData: TransformedLeagueData | null = null;
if (fs.existsSync(CACHE_PATH)) {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    cachedData = JSON.parse(raw);
    console.log('[Server] Pre-seeded cachedData from disk for instant sub-5ms boot response');
  } catch (e: any) {
    console.warn('[Server] Cache file read error:', e.message);
    cachedData = null;
  }
} else {
  console.log('[Server] Container started with EMPTY data cache (Published/Cold Start state). Waiting for first user request to trigger Action A.');
}
let isSyncing = false;
console.log('[Server] Initialized with Optimal Pre-Aggregated DB Schema & Deterministic Orchestrator (Action A, B, C)');

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

      cachedData = freshData;
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      const tempCachePath = `${CACHE_PATH}.tmp.${Date.now()}`;
      fs.writeFileSync(tempCachePath, JSON.stringify(freshData, null, 2));
      fs.renameSync(tempCachePath, CACHE_PATH);
      
      // Execute normalization and synchronization to 11-table database schema
      try {
        executeSchemaSync(freshData);
      } catch (dbErr: any) {
        console.error('[Server] DB Schema Sync error:', dbErr.message);
      }

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

      console.log(`[Server] FPL API & DB schema sync (${action}) completed successfully at`, new Date().toISOString());

      // Broadcast fresh data to all active clients immediately via Server-Sent Events (SSE)
      broadcastSyncComplete(freshData, action);

      // Trigger news ticker update in background whenever sync completes
      try {
        triggerBackgroundNewsUpdate();
      } catch (err: any) {
        console.warn('[Server] Background news update trigger caught error:', err.message);
      }

      return freshData;

    } catch (error: any) {
      console.error(`[Server] Sync (${action}) failed:`, error.message);
      if (cachedData) {
        console.log('[Server] Falling back to existing in-memory cached data');
        return cachedData;
      }
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
  const payload = JSON.stringify({
    type: 'SYNC_COMPLETE',
    action,
    data: freshData,
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
            if (!getCachedNewsFeed()) {
              triggerBackgroundNewsUpdate();
            }

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

    const targetGW = gwParam || (cachedData?.current_gw || 5);
    const dbPlayer = getDbPlayerStatById(id) || (cachedData?.player_stats?.find(p => p.id === id) as any) || null;

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

// Pre-warm all 20 Premier League club jerseys in RAM for instant 0ms modal opening
async function prewarmShirtCache() {
  const codes = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 14, 17, 31, 36, 40, 43, 54, 56, 88, 91, 94];
  const tasks: Promise<void>[] = [];
  
  for (const c of codes) {
    const outfieldKey = String(c);
    if (!shirtImageCache.has(outfieldKey)) {
      tasks.push((async () => {
        try {
          const resp = await fetch(`https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}-220.webp`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            shirtImageCache.set(outfieldKey, { buffer: buf, contentType: 'image/webp' });
          }
        } catch {}
      })());
    }

    if (c !== 0) {
      const gkKey = `${c}_1`;
      if (!shirtImageCache.has(gkKey)) {
        tasks.push((async () => {
          try {
            const resp = await fetch(`https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${c}_1-220.webp`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              shirtImageCache.set(gkKey, { buffer: buf, contentType: 'image/webp' });
            }
          } catch {}
        })());
      }
    }
  }

  await Promise.all(tasks);
  console.log(`[Server] Pre-warmed ${shirtImageCache.size} jerseys into RAM memory for instant 0ms team modal opening!`);
}

// Proxied Player Photos for 100% reliable same-origin loading without ISP/CORS/Adblock blocks
const playerPhotoCache = new Map<string, { buffer: Buffer; contentType: string }>();

app.get('/api/fpl-player-photo/:code', async (req, res) => {
  try {
    const rawCode = String(req.params.code).trim();
    if (!rawCode) return res.status(400).send('Invalid player code');
    const cleanCode = rawCode.replace(/^p/, '').replace(/\.(png|jpg|webp)$/, '');

    if (playerPhotoCache.has(cleanCode)) {
      const cached = playerPhotoCache.get(cleanCode)!;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.send(cached.buffer);
    }

    const candidates = [
      `https://resources.premierleague.com/premierleague25/photos/players/500x500/${cleanCode}.png`,
      `https://resources.premierleague.com/premierleague25/photos/players/110x140/${cleanCode}.png`,
      `https://resources.premierleague.com/premierleague/photos/players/250x250/p${cleanCode}.png`,
      `https://resources.premierleague.com/premierleague/photos/players/110x140/p${cleanCode}.png`
    ];

    for (const url of candidates) {
      try {
        const resp = await fetch(url, {
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
      } catch {
        // try next candidate
      }
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
  res.json({
    success: true,
    sync_status: cachedData?.sync_status || null,
    isSyncing,
    gw_status: cachedData?.gw_status || null,
    db_stats: getDatabaseStats()
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
        }
      }
    }
  } catch (err: any) {
    // Graceful silent error in background scheduler
  }
}, 20000);

// Optimal Pre-Aggregated / Indexed Database Endpoints (O(1) Instant Access < 1ms)
app.get('/api/db/optimal', (req, res) => {
  try {
    const data = getOptimalDatabase();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/gw/:gw', (req, res) => {
  try {
    const gw = Number(req.params.gw);
    const snapshot = getGwSnapshot(gw);
    if (!snapshot) {
      return res.status(404).json({ success: false, error: `Snapshot for Gameweek ${gw} not found` });
    }
    res.json({ success: true, data: snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/player/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const player = getOptimalPlayerById(id);
    if (!player) {
      return res.status(404).json({ success: false, error: `Player with ID ${id} not found` });
    }
    res.json({ success: true, data: player });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/manager/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const manager = getOptimalManagerById(id);
    if (!manager) {
      return res.status(404).json({ success: false, error: `Manager with ID ${id} not found` });
    }
    res.json({ success: true, data: manager });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Database Schema API Endpoints
app.get('/api/db/stats', (req, res) => {
  try {
    const stats = getDatabaseStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/standings', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const standings = getDbStandings(gw);
    res.json({ success: true, count: standings.length, data: standings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/gameweek-champions', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const data = getDbGameweekChampions(gw);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/ownership-players', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const data = getDbOwnershipPlayers(gw);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/ownership-clubs', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const data = getDbOwnershipClubs(gw);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/fans-clubs', (req, res) => {
  try {
    const filter = req.query.filter ? String(req.query.filter) : undefined;
    const data = getDbFansClubs(filter);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/template-squads', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const data = getDbTemplateSquads(gw);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/transfers', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const entryId = req.query.entryId ? Number(req.query.entryId) : undefined;
    const data = getDbTransfers(gw, entryId);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/liga-minus', (req, res) => {
  try {
    const data = getDbLigaMinus();
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/captain-stats', (req, res) => {
  try {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const data = getDbCaptainStats(gw);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/chips-used', (req, res) => {
  try {
    const entryId = req.query.entryId ? Number(req.query.entryId) : undefined;
    const data = getDbChipsUsed(entryId);
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/player-stats', (req, res) => {
  try {
    const position = req.query.position ? String(req.query.position) : undefined;
    const team = req.query.team ? String(req.query.team) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const data = getDbPlayerStats({ position, team, search, sortBy, limit });
    res.json({ success: true, count: data.length, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/player-stats/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const player = getDbPlayerStatById(id);
    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found in database' });
    }
    res.json({ success: true, data: player });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/db/sync-meta', (req, res) => {
  try {
    const data = getDbSyncMeta();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Direct execution of DB Schema Sync
const handleDbSync = async (req: express.Request, res: express.Response) => {
  try {
    console.log('[Server] /api/db/sync triggered - initiating fresh fetch and DB Schema execution');
    const freshData = await triggerSync();
    const stats = getDatabaseStats();
    res.json({
      success: true,
      message: 'DB Schema executed and synchronized successfully',
      stats,
      last_synced: stats.lastSynced,
      current_gw: stats.currentGw
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/db/sync', handleDbSync);
app.get('/api/db/sync', handleDbSync);

// Endpoint News Ticker Feed bertenaga Gemini AI
app.get('/api/news-ticker/feed', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const feed = await generateNewsTickerFeed(force);
    res.json(feed);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});





// Vite / static file serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          ignored: ['**/*'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] FPL Nusantara BERHADIAH running on port ${PORT}`);
    prewarmShirtCache().catch(() => {});
  });
}

startServer();
