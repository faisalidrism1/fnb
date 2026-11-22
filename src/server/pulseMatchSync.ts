import fs from 'fs';
import path from 'path';
import { getOptimalDatabase } from './db.ts';
import {
  FPL_BASE,
  FPL_HEADERS,
  PULSE_BASE,
  PULSE_HEADERS,
  getPulseSeasonFixturesIndex,
  getOptaMatchCodeForPulseId,
  fetchSdpNormalizedMatch,
} from './matchesFetcher.ts';
import { recordPulseFixturePositions } from './pulsePlayerPositions.ts';

const DATA_DIR = path.join(process.cwd(), 'src/data');
export const PULSE_MATCHES_DIR = path.join(DATA_DIR, 'pulse_matches');

const LEGACY_PULSE_PREFIX = 'pulse_match_';

export interface PulseMatchFileMeta {
  id: number;
  gw: number;
  homeShort: string;
  awayShort: string;
  isFinal: boolean;
}

export interface SyncPulseMatchesResult {
  gw: number;
  totalFixtures: number;
  eligibleFixtures: number;
  synced: number;
  skippedFinal: number;
  failed: number;
  removedStale: number;
  files: string[];
}

function sanitizeTeamCode(raw?: string | null): string {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned || 'UNK';
}

export function ensurePulseMatchesDir(): void {
  if (!fs.existsSync(PULSE_MATCHES_DIR)) {
    fs.mkdirSync(PULSE_MATCHES_DIR, { recursive: true });
  }
}

export function buildPulseMatchFilename(
  gw: number | string,
  homeShort?: string | null,
  awayShort?: string | null,
  matchId?: number | string
): string {
  const safeGw = Number(gw) || 0;
  const home = sanitizeTeamCode(homeShort);
  const away = sanitizeTeamCode(awayShort);
  const safeId = Number(matchId) || 0;
  return `gw${safeGw}_${home}_vs_${away}_${safeId}.json`;
}

export function extractPulseMatchMeta(data: any): PulseMatchFileMeta | null {
  const id = Number(data?.id);
  if (!id) return null;
  const gw = Number(data?.gameweek?.gameweek) || 0;
  const homeTeam = data?.teams?.[0]?.team;
  const awayTeam = data?.teams?.[1]?.team;
  const homeShort = sanitizeTeamCode(homeTeam?.club?.abbr || homeTeam?.shortName || homeTeam?.name);
  const awayShort = sanitizeTeamCode(awayTeam?.club?.abbr || awayTeam?.shortName || awayTeam?.name);
  const isFinal = data?.status === 'C' && Array.isArray(data?.textstreamEvents);
  return { id, gw, homeShort, awayShort, isFinal };
}

function writeJsonAtomic(targetPath: string, data: any): void {
  ensurePulseMatchesDir();
  const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, targetPath);
}

/**
 * Migrates legacy `src/data/pulse_match_*.json` files into `src/data/pulse_matches/gw{GW}_{HOME}_vs_{AWAY}_{ID}.json`.
 */
export function migrateLegacyPulseMatchFiles(): number {
  if (!fs.existsSync(DATA_DIR)) return 0;
  let migrated = 0;

  try {
    const entries = fs.readdirSync(DATA_DIR);
    for (const file of entries) {
      const isLegacy =
        (file.startsWith(LEGACY_PULSE_PREFIX) || file.startsWith('pulse_gw')) &&
        file.endsWith('.json');
      if (!isLegacy) continue;

      const oldPath = path.join(DATA_DIR, file);
      try {
        const stat = fs.statSync(oldPath);
        if (!stat.isFile()) continue;

        const parsed = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
        const meta = extractPulseMatchMeta(parsed);
        if (!meta) continue;

        ensurePulseMatchesDir();
        const canonicalName = buildPulseMatchFilename(
          meta.gw,
          meta.homeShort,
          meta.awayShort,
          meta.id
        );
        const newPath = path.join(PULSE_MATCHES_DIR, canonicalName);
        if (!fs.existsSync(newPath)) {
          writeJsonAtomic(newPath, parsed);
        }
        fs.unlinkSync(oldPath);
        migrated++;
      } catch (err: any) {
        console.warn(`[Pulse Sync] Failed to migrate legacy file ${file}:`, err.message);
      }
    }
  } catch {}

  return migrated;
}

/**
 * Removes Pulse match files that do not belong to `activeGw` (or duplicate files for the same match ID).
 */
export function cleanupStalePulseMatchFiles(activeGw: number): number {
  ensurePulseMatchesDir();
  let removed = 0;
  try {
    const files = fs.readdirSync(PULSE_MATCHES_DIR).filter((f) => f.endsWith('.json'));
    const seenIds = new Map<number, string>();

    for (const file of files) {
      const filePath = path.join(PULSE_MATCHES_DIR, file);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const meta = extractPulseMatchMeta(parsed);
        if (!meta || (activeGw > 0 && meta.gw !== activeGw)) {
          fs.unlinkSync(filePath);
          removed++;
          continue;
        }

        const canonicalName = buildPulseMatchFilename(
          meta.gw,
          meta.homeShort,
          meta.awayShort,
          meta.id
        );
        if (file !== canonicalName) {
          const canonicalPath = path.join(PULSE_MATCHES_DIR, canonicalName);
          if (!fs.existsSync(canonicalPath)) {
            writeJsonAtomic(canonicalPath, parsed);
          }
          fs.unlinkSync(filePath);
          removed++;
          seenIds.set(meta.id, canonicalName);
        } else if (seenIds.has(meta.id)) {
          fs.unlinkSync(filePath);
          removed++;
        } else {
          seenIds.set(meta.id, file);
        }
      } catch {
        try {
          fs.unlinkSync(filePath);
          removed++;
        } catch {}
      }
    }
  } catch {}

  return removed;
}

/**
 * Clears all Pulse match cache files from disk (used on Cold Start / container clear).
 */
export function clearAllPulseMatchFiles(): number {
  let removed = 0;
  try {
    if (fs.existsSync(PULSE_MATCHES_DIR)) {
      for (const file of fs.readdirSync(PULSE_MATCHES_DIR)) {
        if (file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(PULSE_MATCHES_DIR, file));
            removed++;
          } catch {}
        }
      }
    }
    if (fs.existsSync(DATA_DIR)) {
      for (const file of fs.readdirSync(DATA_DIR)) {
        if ((file.startsWith(LEGACY_PULSE_PREFIX) || file.startsWith('pulse_gw')) && file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(DATA_DIR, file));
            removed++;
          } catch {}
        }
      }
    }
  } catch {}
  return removed;
}

/**
 * Loads all cached Pulse match objects strictly belonging to `targetGw`, sorted by kickoff time ascending.
 */
export function loadPulseMatchesForGw(targetGw?: number): any[] {
  migrateLegacyPulseMatchFiles();
  const gw = Number(targetGw || getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw || !fs.existsSync(PULSE_MATCHES_DIR)) return [];

  const matches: any[] = [];
  const seenIds = new Set<number>();

  try {
    const files = fs.readdirSync(PULSE_MATCHES_DIR).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(PULSE_MATCHES_DIR, file), 'utf-8'));
        const meta = extractPulseMatchMeta(parsed);
        if (!meta || meta.gw !== gw || seenIds.has(meta.id)) continue;
        seenIds.add(meta.id);
        matches.push(parsed);
      } catch {}
    }
  } catch {}

  matches.sort((a, b) => {
    const tA = Number(a?.kickoff?.millis) || 0;
    const tB = Number(b?.kickoff?.millis) || 0;
    if (tA !== tB) return tA - tB;
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });

  return matches;
}

export function findPulseMatchFileById(matchId: number): { filePath: string; data: any } | null {
  migrateLegacyPulseMatchFiles();
  if (!fs.existsSync(PULSE_MATCHES_DIR)) return null;
  const suffix = `_${matchId}.json`;

  try {
    const files = fs.readdirSync(PULSE_MATCHES_DIR).filter((f) => f.endsWith('.json'));
    const directMatch = files.find((f) => f.endsWith(suffix));
    const candidates = directMatch ? [directMatch, ...files.filter((f) => f !== directMatch)] : files;

    for (const file of candidates) {
      const filePath = path.join(PULSE_MATCHES_DIR, file);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Number(parsed?.id) === Number(matchId)) {
          return { filePath, data: parsed };
        }
      } catch {}
    }
  } catch {}

  return null;
}

/**
 * Fetches match commentary textstream (EN) from Pulse API to capture VAR decisions and Penalty Won events.
 * Paginates automatically if `numPages > 1` so late-match / stoppage-time events are never truncated.
 */
export async function fetchPulseMatchTextstream(matchId: number): Promise<any[]> {
  const fetchPage = async (page: number): Promise<any | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${PULSE_BASE}/fixtures/${matchId}/textstream/EN?pageSize=250&page=${page}`,
        {
          headers: PULSE_HEADERS,
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (page === 0) {
        console.warn(`[Pulse Sync] Failed to fetch textstream for match ${matchId}:`, err.message);
      }
      return null;
    }
  };

  const firstPage = await fetchPage(0);
  if (!firstPage) return [];

  const firstContent: any[] = Array.isArray(firstPage?.events?.content)
    ? firstPage.events.content
    : Array.isArray(firstPage?.content)
      ? firstPage.content
      : [];
  const numPages = Number(firstPage?.events?.pageInfo?.numPages ?? firstPage?.pageInfo?.numPages ?? 1) || 1;
  if (numPages <= 1) return firstContent;

  const extraPages = await Promise.all(
    Array.from({ length: Math.min(numPages - 1, 5) }, (_, idx) => fetchPage(idx + 1))
  );
  const combined = [...firstContent];
  const seenIds = new Set(firstContent.map((e: any) => e?.id).filter(Boolean));
  for (const pg of extraPages) {
    const items: any[] = Array.isArray(pg?.events?.content)
      ? pg.events.content
      : Array.isArray(pg?.content)
        ? pg.content
        : [];
    for (const item of items) {
      if (item?.id && seenIds.has(item.id)) continue;
      if (item?.id) seenIds.add(item.id);
      combined.push(item);
    }
  }
  return combined;
}

function normalizePersonKey(str?: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Attaches `pulseId` (matching `textstreamEvents[].playerIds`) onto SDP-normalized `teamLists` players
 * using Pulse fixture lineups matched by team index + shirt number or normalized name.
 */
function attachPulsePersonIdsFromFixture(sdpData: any, pulseFixture: any): void {
  if (!sdpData || !Array.isArray(sdpData.teamLists) || !Array.isArray(pulseFixture?.teamLists)) {
    return;
  }
  for (let i = 0; i < sdpData.teamLists.length; i++) {
    const sdpTl = sdpData.teamLists[i];
    const pulseTl = pulseFixture.teamLists[i];
    if (!sdpTl || !pulseTl) continue;

    const pulseRoster: any[] = [...(pulseTl.lineup || []), ...(pulseTl.substitutes || [])];
    const byShirt = new Map<number, any>();
    const byDisplay = new Map<string, any>();
    const byLast = new Map<string, any[]>();

    for (const pp of pulseRoster) {
      const pid = Number(pp?.id) || 0;
      if (!pid) continue;
      const shirt = Number(pp?.shirtNumber ?? pp?.info?.shirtNum) || 0;
      if (shirt > 0) byShirt.set(shirt, pp);
      const disp = normalizePersonKey(pp?.name?.display);
      if (disp) byDisplay.set(disp, pp);
      const last = normalizePersonKey(pp?.name?.last);
      if (last) {
        const list = byLast.get(last) || [];
        list.push(pp);
        byLast.set(last, list);
      }
    }

    for (const sp of [...(sdpTl.lineup || []), ...(sdpTl.substitutes || [])]) {
      if (!sp) continue;
      const disp = normalizePersonKey(sp?.name?.display);
      const last = normalizePersonKey(sp?.name?.last);
      const shirt = Number(sp?.shirtNumber ?? sp?.info?.shirtNum) || 0;

      let matchedPp: any = (disp && byDisplay.get(disp)) || null;
      if (!matchedPp && shirt > 0) {
        matchedPp = byShirt.get(shirt) || null;
      }
      if (!matchedPp && last) {
        const cands = byLast.get(last);
        if (cands && cands.length === 1) {
          matchedPp = cands[0];
        }
      }
      const matchedPulseId = Number(matchedPp?.id) || 0;
      if (matchedPulseId > 0) {
        sp.pulseId = matchedPulseId;
      }
      if (matchedPp?.info) {
        sp.info = {
          ...(sp.info || {}),
          ...(matchedPp.info.position ? { position: matchedPp.info.position } : {}),
          ...(matchedPp.info.positionInfo ? { positionInfo: matchedPp.info.positionInfo } : {}),
        };
      }
    }
  }
}

/**
 * Fetches match data + textstream from Pulse API by match ID and persists it
 * using the canonical filename `src/data/pulse_matches/gw{GW}_{HOME}_vs_{AWAY}_{ID}.json`.
 */
export async function fetchAndCachePulseMatch(
  matchId: number,
  options?: { forceRefresh?: boolean; fallbackGw?: number; homeShort?: string; awayShort?: string }
): Promise<any | null> {
  const existing = findPulseMatchFileById(matchId);
  const forceRefresh = Boolean(options?.forceRefresh);

  if (existing && !forceRefresh) {
    const meta = extractPulseMatchMeta(existing.data);
    if (meta?.isFinal) {
      return existing.data;
    }
    // If match was already marked finished ('C') but lacked textstreamEvents, enrich once and save
    if (existing.data?.status === 'C' && !Array.isArray(existing.data?.textstreamEvents)) {
      existing.data.textstreamEvents = await fetchPulseMatchTextstream(matchId);
      try {
        writeJsonAtomic(existing.filePath, existing.data);
      } catch {}
      return existing.data;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const [optaCode, tsEvents, pulseFixture] = await Promise.all([
      getOptaMatchCodeForPulseId(matchId).catch(() => null),
      fetchPulseMatchTextstream(matchId),
      fetchJsonSafe(`${PULSE_BASE}/fixtures/${matchId}`, PULSE_HEADERS, 8000),
    ]);
    clearTimeout(timeoutId);

    let data: any = null;
    if (optaCode) {
      data = await fetchSdpNormalizedMatch(optaCode, matchId, options?.fallbackGw);
    }

    if (pulseFixture) {
      recordPulseFixturePositions(pulseFixture);
    }

    if (data && pulseFixture) {
      attachPulsePersonIdsFromFixture(data, pulseFixture);
    }

    if (!data && pulseFixture) {
      data = pulseFixture;
    }

    if (data) {
      data.textstreamEvents = Array.isArray(tsEvents) ? tsEvents : [];
      const meta = extractPulseMatchMeta(data);
      const gw = meta?.gw || Number(options?.fallbackGw) || 0;
      const home = meta?.homeShort || sanitizeTeamCode(options?.homeShort);
      const away = meta?.awayShort || sanitizeTeamCode(options?.awayShort);
      const targetPath = path.join(
        PULSE_MATCHES_DIR,
        buildPulseMatchFilename(gw, home, away, matchId)
      );

      // Remove old filename if team/gw resolution changed
      if (existing && existing.filePath !== targetPath && fs.existsSync(existing.filePath)) {
        try {
          fs.unlinkSync(existing.filePath);
        } catch {}
      }

      writeJsonAtomic(targetPath, data);
      return data;
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Pulse Sync] Failed to fetch match ${matchId}:`, err.message);
  }

  return existing?.data || null;
}

async function fetchJsonSafe(url: string, headers: Record<string, string>, timeoutMs = 10000): Promise<any | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok ? await res.json() : null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Synchronizes Pulse match files for the active Gameweek:
 * - Migrates legacy `pulse_match_*.json` files to `pulse_matches/gw{GW}_{HOME}_vs_{AWAY}_{ID}.json`
 * - Removes stale files from previous GWs (when `cleanOldGws` is true)
 * - Syncs matches in `targetGw` that have started, finished, or kick off within 60 minutes
 * - Skips matches already stored in final state (`status === 'C'` + `textstreamEvents`)
 */
export async function syncPulseMatchesForActiveGw(
  targetGw?: number,
  options?: { cleanOldGws?: boolean; forceRefresh?: boolean }
): Promise<SyncPulseMatchesResult> {
  migrateLegacyPulseMatchFiles();
  const db = getOptimalDatabase();
  const gw = Number(targetGw || db?.meta?.current_gw) || 0;

  const emptyResult: SyncPulseMatchesResult = {
    gw,
    totalFixtures: 0,
    eligibleFixtures: 0,
    synced: 0,
    skippedFinal: 0,
    failed: 0,
    removedStale: 0,
    files: [],
  };

  if (!gw) return emptyResult;

  ensurePulseMatchesDir();
  const removedStale = options?.cleanOldGws ? cleanupStalePulseMatchFiles(gw) : 0;

  // Gather active GW fixtures (prefer DB sync_status, fall back to FPL fixtures API)
  let gwFixtures: Array<{
    event: number;
    homeShort: string;
    awayShort: string;
    kickoff_time?: string;
    started?: boolean;
    finished?: boolean;
    finished_provisional?: boolean;
  }> = [];

  const dbFixtures = (db?.meta?.sync_status?.gw_fixtures || []).filter(
    (f: any) => Number(f.event) === gw
  );

  if (dbFixtures.length > 0) {
    gwFixtures = dbFixtures.map((f: any) => ({
      event: gw,
      homeShort: sanitizeTeamCode(f.home_team),
      awayShort: sanitizeTeamCode(f.away_team),
      kickoff_time: f.kickoff_time,
      started: Boolean(f.started),
      finished: Boolean(f.finished),
      finished_provisional: Boolean(f.finished_provisional),
    }));
  } else {
    const [rawFixtures, bootstrap] = await Promise.all([
      fetchJsonSafe(`${FPL_BASE}/fixtures/?event=${gw}`, FPL_HEADERS),
      fetchJsonSafe(`${FPL_BASE}/bootstrap-static/`, FPL_HEADERS, 15000),
    ]);
    const teamShortMap = new Map<number, string>();
    for (const t of bootstrap?.teams || []) {
      teamShortMap.set(Number(t.id), sanitizeTeamCode(t.short_name));
    }
    if (Array.isArray(rawFixtures)) {
      gwFixtures = rawFixtures.map((f: any) => ({
        event: gw,
        homeShort: teamShortMap.get(Number(f.team_h)) || `T${f.team_h}`,
        awayShort: teamShortMap.get(Number(f.team_a)) || `T${f.team_a}`,
        kickoff_time: f.kickoff_time,
        started: Boolean(f.started),
        finished: Boolean(f.finished),
        finished_provisional: Boolean(f.finished_provisional),
      }));
    }
  }

  if (gwFixtures.length === 0) {
    return { ...emptyResult, removedStale };
  }

  const now = Date.now();
  const eligible = gwFixtures.filter((f) => {
    if (f.started || f.finished || f.finished_provisional) return true;
    if (f.kickoff_time) {
      const kickoffMs = new Date(f.kickoff_time).getTime();
      if (!isNaN(kickoffMs) && kickoffMs - now <= 90 * 60 * 1000) {
        return true;
      }
    }
    return false;
  });

  if (eligible.length === 0) {
    return {
      ...emptyResult,
      totalFixtures: gwFixtures.length,
      removedStale,
    };
  }

  const pulseIndex = await getPulseSeasonFixturesIndex();
  let synced = 0;
  let skippedFinal = 0;
  let failed = 0;

  const BATCH_SIZE = 4;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (fix) => {
        const pulseKey = `${gw}_${fix.homeShort}_${fix.awayShort}`;
        const pulseId = pulseIndex.get(pulseKey);
        if (!pulseId) {
          failed++;
          return;
        }

        const existing = findPulseMatchFileById(pulseId);
        const existingMeta = existing ? extractPulseMatchMeta(existing.data) : null;
        if (existingMeta?.isFinal && !options?.forceRefresh) {
          skippedFinal++;
          return;
        }

        const fetched = await fetchAndCachePulseMatch(pulseId, {
          forceRefresh: true,
          fallbackGw: gw,
          homeShort: fix.homeShort,
          awayShort: fix.awayShort,
        });
        if (fetched) {
          synced++;
        } else {
          failed++;
        }
      })
    );
  }

  const files = fs.existsSync(PULSE_MATCHES_DIR)
    ? fs.readdirSync(PULSE_MATCHES_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  const unmatchedNote = failed > 0 ? `, ${failed} unmatched` : '';
  console.log(
    `[Pulse Sync] GW ${gw}: ${synced} synced, ${skippedFinal} final cached${unmatchedNote}, ${removedStale} stale removed (${files.length} file(s) in pulse_matches).`
  );

  return {
    gw,
    totalFixtures: gwFixtures.length,
    eligibleFixtures: eligible.length,
    synced,
    skippedFinal,
    failed,
    removedStale,
    files,
  };
}

let lastLivePulseSync: { gw: number; at: number } | null = null;
let inFlightLivePulseSync: Promise<SyncPulseMatchesResult | null> | null = null;

/**
 * Ensures live Pulse match files for `targetGw` are synced during Live Match phase,
 * respecting a short cooldown (default 15s) to avoid redundant API calls unless forced.
 */
export async function ensureLivePulseMatchesSynced(
  targetGw?: number,
  options?: { force?: boolean; ttlMs?: number }
): Promise<SyncPulseMatchesResult | null> {
  const db = getOptimalDatabase();
  const gw = Number(targetGw || db?.meta?.current_gw) || 0;
  if (!gw) return null;

  const ttlMs = options?.ttlMs ?? 15000;
  const now = Date.now();
  if (
    !options?.force &&
    lastLivePulseSync &&
    lastLivePulseSync.gw === gw &&
    now - lastLivePulseSync.at < ttlMs
  ) {
    return null;
  }

  if (inFlightLivePulseSync) {
    return inFlightLivePulseSync;
  }

  inFlightLivePulseSync = (async () => {
    try {
      const result = await syncPulseMatchesForActiveGw(gw, {
        forceRefresh: Boolean(options?.force),
      });
      lastLivePulseSync = { gw, at: Date.now() };
      return result;
    } catch (err: any) {
      console.warn('[Pulse Sync] Live Pulse match sync warning:', err?.message || err);
      return null;
    } finally {
      inFlightLivePulseSync = null;
    }
  })();

  return inFlightLivePulseSync;
}

