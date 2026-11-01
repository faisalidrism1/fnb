import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { fetchAndTransformLeague } from './src/server/dataFetcher.ts';
import { TransformedLeagueData } from './src/types.ts';
import {
  initDatabase,
  executeSchemaSync,
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

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

// Initialize the 11-table database schema
initDatabase();

// In-Memory Micro-Cache only (No persistent stale disk reliance)
let cachedData: TransformedLeagueData | null = null;
let isSyncing = false;
const MEMORY_CACHE_TTL_MS = 60 * 1000; // 60 seconds micro-cache to prevent API spam while guaranteeing fresh data

console.log('[Server] Initialized with DB Schema & Real-time FPL sync engine');

// Helper to determine the most recent scheduled sync time in WIB (07:00, 15:00, 16:00 WIB)
function getLatestScheduledSyncTime(now = new Date()): Date {
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWib = new Date(now.getTime() + wibOffset);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth();
  const d = nowWib.getUTCDate();
  
  const hours = [7, 15, 16];
  const candidates: Date[] = [];
  
  for (const dayOffset of [0, -1]) {
    for (const h of hours) {
      const targetWibTimestamp = Date.UTC(y, m, d + dayOffset, h, 0, 0);
      const targetUtcDate = new Date(targetWibTimestamp - wibOffset);
      if (targetUtcDate <= now) {
        candidates.push(targetUtcDate);
      }
    }
  }
  
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates[0] || new Date(now.getTime() - 24 * 3600 * 1000);
}

// Check if cache needs a sync (1-minute auto-sync interval & daily schedule)
function isCacheDueForSync(data: TransformedLeagueData | null): { due: boolean; reason: string } {
  if (!data || !data.sync_status?.last_synced) {
    return { due: true, reason: 'No cache or missing last_synced' };
  }

  const lastSyncedTime = new Date(data.sync_status.last_synced).getTime();
  const now = new Date();
  const nowMs = now.getTime();

  // 1. Check ALL fixtures for matchday window: 30 mins before kickoff until 150 mins after kickoff, or any match started & not finished
  if (Array.isArray(data.sync_status.gw_fixtures) && data.sync_status.gw_fixtures.length > 0) {
    for (const fix of data.sync_status.gw_fixtures) {
      if (!fix.kickoff_time) continue;
      const kickOff = new Date(fix.kickoff_time).getTime();
      const matchStartWindow = kickOff - 30 * 60 * 1000; // 30 minutes before kickoff
      const matchEndWindow = kickOff + 150 * 60 * 1000;  // 150 minutes after kickoff

      const isLiveFixture = (fix.started && !fix.finished) || (nowMs >= matchStartWindow && nowMs <= matchEndWindow && !fix.finished);

      // Is current time within the match window for this fixture?
      if (isLiveFixture) {
        // Pre-match initial catch-up: if never synced since the 30m window opened
        if (lastSyncedTime < matchStartWindow) {
          return {
            due: true,
            reason: `Matchday 30m pre-kickoff reached (${fix.home_team} vs ${fix.away_team})`
          };
        }
        // 1-minute interval catch-up during active match window so points stay live
        if (nowMs - lastSyncedTime >= 1 * 60 * 1000) {
          return {
            due: true,
            reason: `Matchday active live 1m interval (${fix.home_team} vs ${fix.away_team})`
          };
        }
      }
    }
  }

  // Fallback if is_matchday_live flag is true and >= 1 min
  if (data.sync_status.is_matchday_live && (nowMs - lastSyncedTime >= 1 * 60 * 1000)) {
    return { due: true, reason: 'Matchday active: 1m live sync interval reached' };
  }

  // Universal 1-minute auto sync rule: sync whenever data is >= 60 seconds old
  if (nowMs - lastSyncedTime >= 60 * 1000) {
    return { due: true, reason: '1-minute auto-sync interval reached' };
  }

  // 2. Check daily scheduled times: 07:00, 15:00, 16:00 WIB
  const latestScheduled = getLatestScheduledSyncTime(now);
  if (lastSyncedTime < latestScheduled.getTime()) {
    const scheduledWib = new Date(latestScheduled.getTime() + 7 * 3600 * 1000);
    const timeStr = `${String(scheduledWib.getUTCHours()).padStart(2, '0')}:00 WIB`;
    return { due: true, reason: `Missed scheduled sync for ${timeStr}` };
  }

  return { due: false, reason: 'Up to date' };
}

// Background sync runner with promise deduplication
let currentSyncPromise: Promise<TransformedLeagueData> | null = null;

async function triggerSync(): Promise<TransformedLeagueData> {
  if (currentSyncPromise) {
    return currentSyncPromise;
  }

  isSyncing = true;
  console.log('[Server] Starting FPL API sync for League 12356...');
  
  currentSyncPromise = (async () => {
    try {
      const freshData = await fetchAndTransformLeague(12356);
      cachedData = freshData;
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify(freshData, null, 2));
      
      // Execute normalization and synchronization to 11-table database schema
      try {
        executeSchemaSync(freshData);
      } catch (dbErr: any) {
        console.error('[Server] DB Schema Sync error:', dbErr.message);
      }

      console.log('[Server] FPL API & DB schema sync completed successfully at', new Date().toISOString());
      return freshData;
    } catch (error: any) {
      console.error('[Server] Sync failed:', error.message);
      if (cachedData) {
        console.log('[Server] Falling back to existing cached data');
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

// Check schedule every 30 seconds to catch 1-minute interval promptly
setInterval(async () => {
  if (isSyncing) return;
  const status = isCacheDueForSync(cachedData);
  if (status.due) {
    console.log(`[Scheduler] Auto-sync triggered: ${status.reason}`);
    try {
      await triggerSync();
    } catch (e) {
      console.warn('[Scheduler] Auto-sync error:', e);
    }
  }
}, 30 * 1000);

// API Endpoints
app.post('/api/upload-logo', (req, res) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'No dataUrl provided' });
    }
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: 'Invalid data URL format' });
    }
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    
    // Save to public/logo.png and public/logo.[ext]
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    fs.writeFileSync(path.join(publicDir, 'logo.png'), buffer);
    if (ext !== 'png') {
      fs.writeFileSync(path.join(publicDir, `logo.${ext}`), buffer);
    }
    
    const distDir = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      fs.writeFileSync(path.join(distDir, 'logo.png'), buffer);
    }

    const srcAssetDir = path.join(process.cwd(), 'src/assets/images');
    if (fs.existsSync(srcAssetDir)) {
      fs.writeFileSync(path.join(srcAssetDir, 'fnb_league_logo_transparent.png'), buffer);
    }
    
    console.log('[Server] New logo saved successfully to /public/logo.png and assets');
    res.json({ success: true, url: `/logo.png?t=${Date.now()}` });
  } catch (err: any) {
    console.error('[Server] Error saving uploaded logo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/fpl-data', async (req, res) => {
  try {
    const forceSync = req.query.sync === '1' || req.query.sync === 'true' || req.query.force === '1';
    const now = Date.now();
    const lastSyncMs = cachedData?.sync_status?.last_synced
      ? new Date(cachedData.sync_status.last_synced).getTime()
      : 0;
    const isMemoryFresh = cachedData && (now - lastSyncMs < MEMORY_CACHE_TTL_MS);

    // If memory is empty (server cold start), or older than 60 seconds, or user forced sync:
    // ALWAYS fetch and await fresh data from Premier League API
    if (!isMemoryFresh || forceSync) {
      console.log(`[Server] Fetching fresh FPL API data (memory empty: ${!cachedData}, age: ${Math.round((now - lastSyncMs)/1000)}s, force: ${forceSync})...`);
      try {
        await triggerSync();
      } catch (err: any) {
        console.error('[Server] Live FPL fetch error:', err.message);
        // If we have any memory data, we can provide it as emergency fallback; otherwise throw
        if (!cachedData) {
          throw err;
        }
      }
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      success: true,
      data: cachedData,
      cached: isMemoryFresh && !forceSync,
      isSyncing,
      freshness_seconds: Math.round((Date.now() - (cachedData?.sync_status?.last_synced ? new Date(cachedData.sync_status.last_synced).getTime() : Date.now())) / 1000)
    });
  } catch (err: any) {
    console.error('[Server] Error serving /api/fpl-data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let eventStatusCache: { data: any; timestamp: number } | null = null;
app.get('/api/fpl-event-status', async (req, res) => {
  try {
    const now = Date.now();
    if (eventStatusCache && now - eventStatusCache.timestamp < 30000) {
      return res.json({ success: true, data: eventStatusCache.data });
    }
    const response = await fetch('https://fantasy.premierleague.com/api/event-status/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (response.ok) {
      const data = await response.json();
      eventStatusCache = { data, timestamp: now };
      return res.json({ success: true, data });
    }
    res.status(502).json({ success: false, error: 'Failed to fetch event status from FPL' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const FPL_TEAM_SHORT_NAMES: Record<number, string> = {
  1: 'ARS', 2: 'AVL', 3: 'BOU', 4: 'BRE', 5: 'BHA', 6: 'CHE', 7: 'CRY', 8: 'EVE',
  9: 'FUL', 10: 'IPS', 11: 'LEI', 12: 'LIV', 13: 'MCI', 14: 'MUN', 15: 'NEW', 16: 'NFO',
  17: 'SOU', 18: 'TOT', 19: 'WHU', 20: 'WOL'
};

const playerSummaryCache = new Map<number, { data: any; timestamp: number }>();
const eventLiveCache = new Map<number, { data: any; timestamp: number }>();

app.get('/api/fpl-player-summary/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const gwParam = req.query.gw ? Number(req.query.gw) : null;
    if (!id) return res.status(400).json({ success: false, error: 'Invalid player ID' });

    const now = Date.now();
    let summaryData: any = null;
    const cachedSummary = playerSummaryCache.get(id);
    // Cache for 10 minutes to make modal opening blazing fast
    if (cachedSummary && now - cachedSummary.timestamp < 600000) {
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
    const dbPlayer = getDbPlayerStatById(id);

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
    if (cachedEventLive && now - cachedEventLive.timestamp < 120000) {
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

    const enrichedHistory = (summaryData.history || []).map((h: any) => ({
      ...h,
      opponent_short_name: FPL_TEAM_SHORT_NAMES[h.opponent_team] || `Team ${h.opponent_team}`
    }));

    res.json({
      success: true,
      data: {
        id,
        gw: targetGW,
        player_info: dbPlayer || null,
        history: enrichedHistory,
        fixtures: summaryData.fixtures || [],
        live_stats: liveStats,
        live_explain: liveExplain
      }
    });
  } catch (err: any) {
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
  const syncCheck = isCacheDueForSync(cachedData);
  res.json({
    success: true,
    sync_status: cachedData?.sync_status || null,
    isSyncing,
    due_for_sync: syncCheck.due,
    due_reason: syncCheck.reason,
    latest_scheduled_utc: getLatestScheduledSyncTime().toISOString(),
    db_stats: getDatabaseStats()
  });
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

// Vite / static file serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
  });
}

startServer();
