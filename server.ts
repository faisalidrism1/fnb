import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { fetchAndTransformLeague } from './src/server/dataFetcher.ts';
import { TransformedLeagueData } from './src/types.ts';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

let cachedData: TransformedLeagueData | null = null;
let isSyncing = false;

// Load initial cache from disk if available
try {
  if (fs.existsSync(CACHE_PATH)) {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    cachedData = JSON.parse(raw);
    console.log('[Server] Initialized cache from disk for league:', cachedData?.league_name);
  }
} catch (e) {
  console.error('[Server] Could not read cache from disk:', e);
}

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

// Check if cache needs a sync (daily: 07:00, 15:00, 16:00 WIB | matchday: 15m from kickoff-30m to kickoff+150m)
function isCacheDueForSync(data: TransformedLeagueData | null): { due: boolean; reason: string } {
  if (!data || !data.sync_status?.last_synced) {
    return { due: true, reason: 'No cache or missing last_synced' };
  }

  const lastSyncedTime = new Date(data.sync_status.last_synced).getTime();
  const now = new Date();
  const nowMs = now.getTime();

  // 1. Check ALL fixtures for matchday window: 30 mins before kickoff until 150 mins after kickoff
  if (Array.isArray(data.sync_status.gw_fixtures) && data.sync_status.gw_fixtures.length > 0) {
    for (const fix of data.sync_status.gw_fixtures) {
      if (!fix.kickoff_time) continue;
      const kickOff = new Date(fix.kickoff_time).getTime();
      const matchStartWindow = kickOff - 30 * 60 * 1000; // 30 minutes before kickoff
      const matchEndWindow = kickOff + 150 * 60 * 1000;  // 150 minutes after kickoff

      // Is current time within the match window for this fixture?
      if (nowMs >= matchStartWindow && nowMs <= matchEndWindow) {
        // A. Pre-match initial catch-up: if never synced since the 30m window opened
        if (lastSyncedTime < matchStartWindow) {
          return {
            due: true,
            reason: `Matchday 30m pre-kickoff reached (${fix.home_team} vs ${fix.away_team})`
          };
        }
        // B. 15-minute interval catch-up during the match window
        if (nowMs - lastSyncedTime >= 15 * 60 * 1000) {
          return {
            due: true,
            reason: `Matchday active 15m interval (${fix.home_team} vs ${fix.away_team})`
          };
        }
      }
    }
  }

  // Fallback if is_matchday_live flag is true and >= 15 mins
  if (data.sync_status.is_matchday_live && (nowMs - lastSyncedTime >= 15 * 60 * 1000)) {
    return { due: true, reason: 'Matchday active: 15m sync interval reached' };
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

// Background sync runner
async function triggerSync(): Promise<TransformedLeagueData> {
  if (isSyncing) {
    if (cachedData) return cachedData;
    throw new Error('Sync is currently in progress');
  }

  isSyncing = true;
  console.log('[Server] Starting FPL API sync for League 12356...');
  try {
    const freshData = await fetchAndTransformLeague(12356);
    cachedData = freshData;
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(freshData, null, 2));
    console.log('[Server] FPL API sync completed successfully at', new Date().toISOString());
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
  }
}

// Check schedule every minute (when container is active)
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
}, 60 * 1000);

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
    if (!cachedData) {
      console.log('[Server] No cache in memory, fetching first-time data...');
      await triggerSync();
    } else {
      // Check if cache missed a scheduled sync time or matchday is live
      const status = isCacheDueForSync(cachedData);
      if (status.due && !isSyncing) {
        console.log(`[Server] Data request detected stale cache (${status.reason}). Triggering background catch-up sync...`);
        // Trigger background sync non-blocking
        triggerSync().catch(err => {
          console.warn('[Server] Background catch-up sync error:', err.message);
        });
      }
    }

    res.json({
      success: true,
      data: cachedData,
      cached: true,
      isSyncing
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
    latest_scheduled_utc: getLatestScheduledSyncTime().toISOString()
  });
});

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
