import { TransformedLeagueData } from './types.ts';

const DB_NAME = 'fpl_nusantara_storage_db';
const STORE_NAME = 'league_cache';
const KEY_NAME = 'latest_league_data';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Parses timestamp string (ISO or custom WIB format) to epoch milliseconds.
 */
export function parseSyncTimestamp(timestampStr?: string): number {
  if (!timestampStr) return 0;
  try {
    const parsed = Date.parse(timestampStr);
    if (!isNaN(parsed) && parsed > 0) return parsed;

    // Handle formats like "19 Sep 2026, 21.45.00 WIB"
    const cleaned = timestampStr.replace('WIB', '').replace(/\./g, ':').trim();
    const parsedCleaned = Date.parse(cleaned);
    if (!isNaN(parsedCleaned) && parsedCleaned > 0) return parsedCleaned;
  } catch {}
  return 0;
}

/**
 * Checks if incoming league data is strictly newer than current league data.
 */
export function isDataNewer(
  incoming: TransformedLeagueData | null | undefined,
  current: TransformedLeagueData | null | undefined
): boolean {
  if (!incoming) return false;
  if (!current) return true;

  const incomingTime = parseSyncTimestamp(incoming.sync_status?.last_synced);
  const currentTime = parseSyncTimestamp(current.sync_status?.last_synced);

  if (incomingTime > 0 && currentTime > 0) {
    return incomingTime > currentTime;
  }

  // If timestamps are identical or cannot be parsed, compare GWs or fallback to newer
  const incomingGW = incoming.current_gw || 0;
  const currentGW = current.current_gw || 0;
  if (incomingGW !== currentGW) {
    return incomingGW > currentGW;
  }

  return true;
}

/**
 * Checks if data is considered "stale" (older than 3 hours or older than current day).
 */
export function isDataStale(data: TransformedLeagueData | null | undefined): boolean {
  if (!data || !data.sync_status?.last_synced) return true;
  const syncTime = parseSyncTimestamp(data.sync_status.last_synced);
  if (!syncTime) return true;

  const now = Date.now();
  const diffHours = (now - syncTime) / (1000 * 60 * 60);

  // If older than 4 hours, consider stale
  if (diffHours >= 4) return true;

  // Check if sync was from a previous calendar day (UTC/local)
  const syncDate = new Date(syncTime).toDateString();
  const nowDate = new Date(now).toDateString();
  if (syncDate !== nowDate) return true;

  return false;
}

/**
 * Asynchronously save league data to persistent IndexedDB
 */
export async function saveToIndexedDB(data: TransformedLeagueData): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, KEY_NAME);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[SmartStorage] IndexedDB save failed, attempting localStorage fallback:', err);
    try {
      localStorage.setItem(KEY_NAME, JSON.stringify(data));
    } catch {}
  }
}

/**
 * Validates that cached data does not have corrupted or unaccumulated total points
 */
function validateLeagueDataCache(data: TransformedLeagueData | null): boolean {
  if (!data || !data.standings) return false;
  for (const [gwStr, rows] of Object.entries(data.standings)) {
    const gw = Number(gwStr);
    if (gw > 1 && Array.isArray(rows) && rows.length > 0) {
      const top1 = rows.find(r => r.rank === 1) || rows[0];
      // If leader in GW 2+ has total points less than 70, points failed to accumulate
      if (top1 && typeof top1.total_points === 'number' && top1.total_points < 70) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Asynchronously load league data from persistent IndexedDB with corruption validation
 */
export async function loadFromIndexedDB(): Promise<TransformedLeagueData | null> {
  try {
    const db = await openDB();
    const result = await new Promise<TransformedLeagueData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_NAME);

      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result as TransformedLeagueData);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });

    if (result && validateLeagueDataCache(result)) {
      return result;
    } else if (result) {
      console.warn('[SmartStorage] Cached data in IndexedDB failed validation (unaccumulated points). Purging...');
      clearIndexedDBCache().catch(() => {});
      return null;
    }
    return null;
  } catch (err) {
    console.warn('[SmartStorage] IndexedDB load failed, attempting localStorage fallback:', err);
    try {
      const saved = localStorage.getItem(KEY_NAME);
      if (saved) {
        const parsed = JSON.parse(saved) as TransformedLeagueData;
        if (validateLeagueDataCache(parsed)) {
          return parsed;
        } else {
          localStorage.removeItem(KEY_NAME);
        }
      }
    } catch {}
    return null;
  }
}

/**
 * Explicitly clears the local IndexedDB and localStorage cache
 */
export async function clearIndexedDBCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(KEY_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
  try {
    localStorage.removeItem(KEY_NAME);
  } catch {}
}
