import fs from 'fs';
import path from 'path';
import type { MatchCardItem, MatchPlayerItem, PositionType } from '../types.ts';

const PULSE_BASE = 'https://footballapi.pulselive.com/football';
const PULSE_HEADERS = {
  'Origin': 'https://www.premierleague.com',
  'Referer': 'https://www.premierleague.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*'
};

const CACHE_FILE_PATH = path.join(process.cwd(), 'src/data/pulsePlayerPositionsCache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours; static player profile labels rarely change

export type PulsePosChar = 'G' | 'D' | 'M' | 'F';

export interface PulsePlayerPositionRecord {
  pulseId?: number;
  optaCode?: number;
  fplId?: number;
  teamShort?: string;
  name?: string;
  position?: PulsePosChar;
  positionInfo: string;
  source: 'fixture' | 'staff';
  updatedAt: string;
}

interface PulsePlayerPositionsDiskSchema {
  seasonId: number;
  syncedAt: string;
  byOptaCode: Record<string, PulsePlayerPositionRecord>;
  byFplId: Record<string, PulsePlayerPositionRecord>;
  byClubAndName: Record<string, PulsePlayerPositionRecord>;
}

const GENERIC_OUTFIELD_LABELS = new Set([
  'defender',
  'midfielder',
  'forward',
  'starter',
  'substitute',
]);

export function isSpecificPulsePositionInfo(info?: string | null): boolean {
  const clean = String(info || '').trim();
  if (!clean) return false;
  return !GENERIC_OUTFIELD_LABELS.has(clean.toLowerCase());
}

export function normalizePulsePersonKey(str?: string | null): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapPulseCharToFplPos(posChar?: string | null, posInfo?: string | null): PositionType | undefined {
  const c = String(posChar || '').trim().toUpperCase();
  if (c === 'G' || c === 'GKP') return 'GKP';
  if (c === 'D' || c === 'DEF') return 'DEF';
  if (c === 'M' || c === 'MID') return 'MID';
  if (c === 'F' || c === 'FWD') return 'FWD';
  const info = String(posInfo || '').toLowerCase();
  if (!info) return undefined;
  if (info.includes('goalkeeper')) return 'GKP';
  if (info.includes('defender') || info.includes('full back') || info.includes('wing back')) return 'DEF';
  if (info.includes('striker') || info.includes('forward')) return 'FWD';
  if (info.includes('midfielder') || info.includes('winger')) return 'MID';
  return undefined;
}

export function mapFplPosToPulseChar(pos?: string | null): PulsePosChar | undefined {
  const p = String(pos || '').trim().toUpperCase();
  if (p === 'G' || p === 'GKP') return 'G';
  if (p === 'D' || p === 'DEF') return 'D';
  if (p === 'M' || p === 'MID') return 'M';
  if (p === 'F' || p === 'FWD') return 'F';
  return undefined;
}

// In-memory O(1) lookup stores
const byOptaCode = new Map<number, PulsePlayerPositionRecord>();
const byFplId = new Map<number, PulsePlayerPositionRecord>();
const byClubAndName = new Map<string, PulsePlayerPositionRecord>();
let lastStaffSyncedAtMs = 0;
let cachedSeasonId = 841;
let persistTimer: NodeJS.Timeout | null = null;
let inFlightStaffSync: Promise<number> | null = null;

function shouldReplaceRecord(existing: PulsePlayerPositionRecord | undefined, incoming: PulsePlayerPositionRecord): boolean {
  if (!existing) return true;
  const exSpec = isSpecificPulsePositionInfo(existing.positionInfo);
  const inSpec = isSpecificPulsePositionInfo(incoming.positionInfo);
  if (inSpec && !exSpec) return true;
  if (!inSpec && exSpec) return false;
  // Prefer fixture source when both specific (fixture includes altIds.opta), or newer update
  if (incoming.source === 'fixture' && existing.source !== 'fixture') return true;
  if (!existing.pulseId && incoming.pulseId) return true;
  if (!existing.optaCode && incoming.optaCode) return true;
  return incoming.updatedAt > existing.updatedAt;
}

function upsertRecord(rec: PulsePlayerPositionRecord): boolean {
  let changed = false;
  if (rec.optaCode && rec.optaCode > 0) {
    const prev = byOptaCode.get(rec.optaCode);
    if (shouldReplaceRecord(prev, rec)) {
      byOptaCode.set(rec.optaCode, { ...prev, ...rec });
      changed = true;
    }
  }
  if (rec.fplId && rec.fplId > 0) {
    const prev = byFplId.get(rec.fplId);
    if (shouldReplaceRecord(prev, rec)) {
      byFplId.set(rec.fplId, { ...prev, ...rec });
      changed = true;
    }
  }
  if (rec.teamShort && rec.name) {
    const key = `${rec.teamShort.toUpperCase()}|${normalizePulsePersonKey(rec.name)}`;
    if (!key.endsWith('|')) {
      const prev = byClubAndName.get(key);
      if (shouldReplaceRecord(prev, rec)) {
        byClubAndName.set(key, { ...prev, ...rec });
        changed = true;
      }
    }
  }
  return changed;
}

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) return;
    const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PulsePlayerPositionsDiskSchema>;
    if (parsed.seasonId) cachedSeasonId = Number(parsed.seasonId) || 841;
    if (parsed.syncedAt) {
      const t = Date.parse(parsed.syncedAt);
      if (Number.isFinite(t)) lastStaffSyncedAtMs = t;
    }
    for (const [k, rec] of Object.entries(parsed.byOptaCode || {})) {
      const code = Number(k);
      if (code > 0 && rec?.positionInfo) byOptaCode.set(code, rec);
    }
    for (const [k, rec] of Object.entries(parsed.byFplId || {})) {
      const id = Number(k);
      if (id > 0 && rec?.positionInfo) byFplId.set(id, rec);
    }
    for (const [k, rec] of Object.entries(parsed.byClubAndName || {})) {
      if (k && rec?.positionInfo) byClubAndName.set(k, rec);
    }
  } catch (err: any) {
    console.warn('[PulsePositions] Failed to load disk cache:', err?.message || err);
  }
}

loadFromDisk();

export function flushPulsePlayerPositionsToDisk(): void {
  try {
    const out: PulsePlayerPositionsDiskSchema = {
      seasonId: cachedSeasonId,
      syncedAt: lastStaffSyncedAtMs > 0 ? new Date(lastStaffSyncedAtMs).toISOString() : new Date().toISOString(),
      byOptaCode: Object.fromEntries(byOptaCode.entries()),
      byFplId: Object.fromEntries(byFplId.entries()),
      byClubAndName: Object.fromEntries(byClubAndName.entries()),
    };
    fs.mkdirSync(path.dirname(CACHE_FILE_PATH), { recursive: true });
    const tmpPath = `${CACHE_FILE_PATH}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(out), 'utf-8');
    fs.renameSync(tmpPath, CACHE_FILE_PATH);
  } catch (err: any) {
    console.warn('[PulsePositions] Disk persist failed:', err?.message || err);
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPulsePlayerPositionsToDisk();
  }, 400);
}

/**
 * Extracts `info.positionInfo` & `info.position` from any already-fetched Legacy Pulse fixture
 * with zero extra HTTP requests.
 */
export function recordPulseFixturePositions(
  pulseFixture: any,
  elementByCodeMap?: Map<number, any>
): number {
  if (!pulseFixture || !Array.isArray(pulseFixture.teamLists)) return 0;
  const nowIso = new Date().toISOString();
  let updatedCount = 0;

  for (let i = 0; i < pulseFixture.teamLists.length; i++) {
    const tl = pulseFixture.teamLists[i];
    if (!tl) continue;
    const teamMeta = pulseFixture.teams?.[i]?.team;
    const teamShort = String(teamMeta?.club?.abbr || teamMeta?.shortName || '').trim().toUpperCase();
    const roster = [...(tl.lineup || []), ...(tl.substitutes || [])];

    for (const pp of roster) {
      if (!pp) continue;
      const posInfo = typeof pp?.info?.positionInfo === 'string' ? pp.info.positionInfo.trim() : '';
      if (!posInfo) continue;

      const rawPos = String(pp?.info?.position || pp?.matchPosition || '').trim().toUpperCase();
      const posChar: PulsePosChar | undefined =
        rawPos === 'G' || rawPos === 'D' || rawPos === 'M' || rawPos === 'F' ? rawPos : undefined;
      const optaRaw = pp?.altIds?.opta ? parseInt(String(pp.altIds.opta).replace(/\D/g, ''), 10) : 0;
      const optaCode = optaRaw > 0 ? optaRaw : undefined;
      const pulseId = Number(pp?.id || pp?.pulseId) || undefined;
      const displayName = String(pp?.name?.display || `${pp?.name?.first || ''} ${pp?.name?.last || ''}`.trim()).trim();
      const fplEl = optaCode && elementByCodeMap ? elementByCodeMap.get(optaCode) : undefined;

      const changed = upsertRecord({
        pulseId,
        optaCode,
        fplId: fplEl?.id ? Number(fplEl.id) : undefined,
        teamShort: teamShort || undefined,
        name: displayName || undefined,
        position: posChar,
        positionInfo: posInfo,
        source: 'fixture',
        updatedAt: nowIso,
      });
      if (changed) updatedCount++;
    }
  }

  if (updatedCount > 0) {
    schedulePersist();
  }
  return updatedCount;
}

/**
 * O(1) lookup for a player's Pulse profile position (`positionInfo` & `position`).
 * Never overwrites an already-specific label with a coarse fallback label.
 */
export function lookupPulsePlayerPosition(params: {
  optaCode?: number | null;
  fplId?: number | null;
  teamShort?: string | null;
  fullName?: string | null;
  webName?: string | null;
  existingPositionInfo?: string | null;
  existingPositionChar?: string | null;
}): { position?: PositionType; positionInfo?: string } {
  const existingInfo = String(params.existingPositionInfo || '').trim();
  const existingPos = mapPulseCharToFplPos(params.existingPositionChar, existingInfo);
  if (isSpecificPulsePositionInfo(existingInfo)) {
    return {
      ...(existingPos ? { position: existingPos } : {}),
      positionInfo: existingInfo,
    };
  }

  let hit: PulsePlayerPositionRecord | undefined;
  const opta = Number(params.optaCode);
  if (opta > 0) {
    hit = byOptaCode.get(opta);
  }
  if (!hit && params.fplId && Number(params.fplId) > 0) {
    hit = byFplId.get(Number(params.fplId));
  }
  if (!hit && params.teamShort) {
    const abbr = String(params.teamShort).trim().toUpperCase();
    for (const candidateName of [params.fullName, params.webName]) {
      const nk = normalizePulsePersonKey(candidateName);
      if (nk) {
        const direct = byClubAndName.get(`${abbr}|${nk}`);
        if (direct) {
          hit = direct;
          break;
        }
      }
    }
  }

  if (hit && (isSpecificPulsePositionInfo(hit.positionInfo) || !existingInfo)) {
    const resolvedPos = mapPulseCharToFplPos(hit.position, hit.positionInfo) || existingPos;
    return {
      ...(resolvedPos ? { position: resolvedPos } : {}),
      positionInfo: hit.positionInfo,
    };
  }

  return {
    ...(existingPos ? { position: existingPos } : {}),
    ...(existingInfo ? { positionInfo: existingInfo } : {}),
  };
}

function matchBootstrapElementToStaffPlayers(el: any, teamStaff: any[]): any | null {
  if (!el || !Array.isArray(teamStaff) || teamStaff.length === 0) return null;
  const full = normalizePulsePersonKey(`${el.first_name || ''} ${el.second_name || ''}`);
  const web = normalizePulsePersonKey(el.web_name || '');
  const first = normalizePulsePersonKey(el.first_name || '');
  const sec = normalizePulsePersonKey(el.second_name || '');
  const webClean = web.replace(/\b(jr|sr)\b/g, '').trim();

  const staffNormalized = teamStaff.map((sp) => {
    const disp = normalizePulsePersonKey(typeof sp?.name === 'string' ? sp.name : (sp?.name?.display || ''));
    const pFirst = normalizePulsePersonKey(sp?.name?.first || '');
    const pLast = normalizePulsePersonKey(sp?.name?.last || '');
    const tokens = disp.split(' ').filter(Boolean);
    return { sp, disp, pFirst, pLast, tokens };
  });

  // 1. Exact full display name match
  let hit = staffNormalized.find((x) => x.disp === full || (web && x.disp === web));
  if (hit) return hit.sp;

  // 2. Reversed order (e.g. "Tanaka Ao" vs "Ao Tanaka")
  const fullTokens = full.split(' ').filter(Boolean);
  if (fullTokens.length === 2) {
    const rev = `${fullTokens[1]} ${fullTokens[0]}`;
    hit = staffNormalized.find((x) => x.disp === rev);
    if (hit) return hit.sp;
  }

  // 3. Last name + first name prefix (e.g. "Sindre Walle Egeli" vs "Sindre Egeli", "Robert Lynch Sánchez" vs "Robert Sánchez")
  const secTokens = sec.split(' ').filter(Boolean);
  const firstToken = first.split(' ')[0] || '';
  if (secTokens.length > 0 && firstToken.length >= 2) {
    const fplAllTokens = new Set([...fullTokens, ...webClean.split(' ').filter(Boolean)]);
    const candidates = staffNormalized.filter((x) => {
      const sharesFirst =
        (x.pFirst && (x.pFirst.startsWith(firstToken.slice(0, 3)) || firstToken.startsWith(x.pFirst.slice(0, 3)))) ||
        x.tokens.some((t) => t.startsWith(firstToken.slice(0, 3)));
      if (!sharesFirst) return false;
      return x.tokens.some((t) => t.length >= 3 && (secTokens.includes(t) || fplAllTokens.has(t)));
    });
    if (candidates.length === 1) return candidates[0].sp;
  }

  // 4. Unique surname / web_name token match inside the club (e.g. "Abdul Fatawu Issahaku" vs "Abdul Fatawu")
  for (const probe of [webClean, secTokens[0] || '', secTokens[secTokens.length - 1] || '']) {
    if (!probe || probe.length < 4) continue;
    const probeMatches = staffNormalized.filter(
      (x) => x.disp.includes(probe) && (x.tokens.includes(probe) || probe.split(' ').every((pt) => x.tokens.includes(pt)))
    );
    if (probeMatches.length === 1) return probeMatches[0].sp;
  }

  return null;
}

async function fetchPulseJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: PULSE_HEADERS, signal: controller.signal });
    clearTimeout(tid);
    return res.ok ? await res.json() : null;
  } catch {
    clearTimeout(tid);
    return null;
  }
}

/**
 * Fetches all 20 Premier League club squads from Legacy Pulse API (`/teams/{id}/compseasons/{season}/staff`)
 * ONLY when cache is stale (>24h), empty, or forced (~21 small HTTP calls once).
 */
export async function syncPulsePlayerPositionsFromStaff(options?: {
  force?: boolean;
  bootstrapElements?: any[];
  bootstrapTeams?: any[];
  compSeasonId?: number;
}): Promise<number> {
  const now = Date.now();
  const hasCache = byClubAndName.size >= 300;
  const isFresh = lastStaffSyncedAtMs > 0 && now - lastStaffSyncedAtMs < CACHE_TTL_MS;

  if (!options?.force && hasCache && isFresh) {
    // Still opportunistically link any unlinked bootstrap elements in O(n) memory (0 network calls)
    if (Array.isArray(options?.bootstrapElements) && Array.isArray(options?.bootstrapTeams)) {
      linkBootstrapElementsInMemory(options.bootstrapElements, options.bootstrapTeams);
    }
    return byOptaCode.size;
  }

  if (inFlightStaffSync) {
    return inFlightStaffSync;
  }

  inFlightStaffSync = (async () => {
    try {
      let seasonId = Number(options?.compSeasonId) || cachedSeasonId || 841;
      if (!options?.compSeasonId) {
        const compRes = await fetchPulseJson(`${PULSE_BASE}/competitions/1/compseasons?page=0&pageSize=2`);
        const topId = Number(compRes?.content?.[0]?.id);
        if (topId > 0) seasonId = topId;
      }
      cachedSeasonId = seasonId;

      const teamsRes = await fetchPulseJson(`${PULSE_BASE}/compseasons/${seasonId}/teams?pageSize=30`);
      const teams: any[] = Array.isArray(teamsRes) ? teamsRes : (teamsRes?.content || []);
      if (teams.length === 0) {
        return byOptaCode.size;
      }

      const staffByAbbr = new Map<string, any[]>();
      const BATCH_SIZE = 5;
      for (let i = 0; i < teams.length; i += BATCH_SIZE) {
        const batch = teams.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (t) => {
            const abbr = String(t?.club?.abbr || t?.shortName || '').trim().toUpperCase();
            if (!t?.id || !abbr) return;
            const d = await fetchPulseJson(`${PULSE_BASE}/teams/${t.id}/compseasons/${seasonId}/staff`);
            if (Array.isArray(d?.players)) {
              staffByAbbr.set(abbr, d.players);
            }
          })
        );
      }

      const nowIso = new Date().toISOString();
      for (const [abbr, players] of staffByAbbr.entries()) {
        for (const sp of players) {
          const posInfo = typeof sp?.info?.positionInfo === 'string' ? sp.info.positionInfo.trim() : '';
          if (!posInfo) continue;
          const rawPos = String(sp?.info?.position || '').trim().toUpperCase();
          const posChar: PulsePosChar | undefined =
            rawPos === 'G' || rawPos === 'D' || rawPos === 'M' || rawPos === 'F' ? rawPos : undefined;
          const displayName = String(sp?.name?.display || `${sp?.name?.first || ''} ${sp?.name?.last || ''}`.trim()).trim();
          const optaRaw = sp?.altIds?.opta ? parseInt(String(sp.altIds.opta).replace(/\D/g, ''), 10) : 0;

          upsertRecord({
            pulseId: Number(sp?.id) || undefined,
            optaCode: optaRaw > 0 ? optaRaw : undefined,
            teamShort: abbr,
            name: displayName,
            position: posChar,
            positionInfo: posInfo,
            source: 'staff',
            updatedAt: nowIso,
          });
        }
      }

      if (Array.isArray(options?.bootstrapElements) && Array.isArray(options?.bootstrapTeams)) {
        const teamMap = new Map<number, any>(options.bootstrapTeams.map((t: any) => [Number(t.id), t]));
        for (const el of options.bootstrapElements) {
          const team = teamMap.get(Number(el.team));
          const abbr = String(team?.short_name || '').trim().toUpperCase();
          if (!abbr) continue;
          const staffList = staffByAbbr.get(abbr);
          if (!staffList) continue;

          const matchedSp = matchBootstrapElementToStaffPlayers(el, staffList);
          if (!matchedSp?.info?.positionInfo) continue;

          const rawPos = String(matchedSp?.info?.position || '').trim().toUpperCase();
          const posChar: PulsePosChar | undefined =
            rawPos === 'G' || rawPos === 'D' || rawPos === 'M' || rawPos === 'F' ? rawPos : undefined;
          const displayName = String(matchedSp?.name?.display || `${el.first_name} ${el.second_name}`).trim();
          const optaCode = Number(el.code) || undefined;

          upsertRecord({
            pulseId: Number(matchedSp.id) || undefined,
            optaCode,
            fplId: Number(el.id) || undefined,
            teamShort: abbr,
            name: displayName,
            position: posChar,
            positionInfo: String(matchedSp.info.positionInfo).trim(),
            source: 'staff',
            updatedAt: nowIso,
          });
        }
      }

      lastStaffSyncedAtMs = Date.now();
      flushPulsePlayerPositionsToDisk();
      console.log(
        `[PulsePositions] Synced Legacy Pulse squad labels (${byOptaCode.size} by Opta, ${byFplId.size} by FPL ID, ${byClubAndName.size} by Club+Name).`
      );
      return byOptaCode.size;
    } catch (err: any) {
      console.warn('[PulsePositions] Failed staff sync:', err?.message || err);
      return byOptaCode.size;
    } finally {
      inFlightStaffSync = null;
    }
  })();

  return inFlightStaffSync;
}

function linkBootstrapElementsInMemory(elements: any[], teams: any[]): void {
  const teamMap = new Map<number, string>(teams.map((t: any) => [Number(t.id), String(t.short_name || '').toUpperCase()]));
  const nowIso = new Date().toISOString();
  let linked = 0;

  for (const el of elements) {
    const fplId = Number(el.id);
    const optaCode = Number(el.code);
    if (!fplId && !optaCode) continue;
    const existing = (optaCode && byOptaCode.get(optaCode)) || (fplId && byFplId.get(fplId));
    if (existing && isSpecificPulsePositionInfo(existing.positionInfo)) continue;

    const abbr = teamMap.get(Number(el.team)) || '';
    const res = lookupPulsePlayerPosition({
      optaCode,
      fplId,
      teamShort: abbr,
      fullName: `${el.first_name || ''} ${el.second_name || ''}`.trim(),
      webName: el.web_name,
    });
    if (res.positionInfo && isSpecificPulsePositionInfo(res.positionInfo)) {
      const changed = upsertRecord({
        optaCode: optaCode || undefined,
        fplId: fplId || undefined,
        teamShort: abbr || undefined,
        name: `${el.first_name || ''} ${el.second_name || ''}`.trim(),
        position: mapFplPosToPulseChar(res.position),
        positionInfo: res.positionInfo,
        source: 'staff',
        updatedAt: nowIso,
      });
      if (changed) linked++;
    }
  }
  if (linked > 0) schedulePersist();
}

/**
 * Enriches an existing MatchCardItem's players in memory using the O(1) Legacy Pulse registry.
 * Returns true if any player's position label was upgraded.
 */
export function enrichMatchCardWithPulsePositions(match: MatchCardItem): boolean {
  if (!match) return false;
  let upgraded = false;

  const enrichList = (list: MatchPlayerItem[] | undefined, teamShort: string) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (!p) continue;
      if (isSpecificPulsePositionInfo(p.pulse_position_info)) continue;
      const resolved = lookupPulsePlayerPosition({
        optaCode: p.code > 0 ? p.code : undefined,
        fplId: p.id > 0 ? p.id : undefined,
        teamShort: p.team_short_name || teamShort,
        fullName: p.full_name,
        webName: p.web_name,
        existingPositionInfo: p.pulse_position_info,
        existingPositionChar: p.pulse_position,
      });
      if (resolved.positionInfo && resolved.positionInfo !== p.pulse_position_info) {
        p.pulse_position_info = resolved.positionInfo;
        upgraded = true;
      }
      if (resolved.position && !p.pulse_position) {
        p.pulse_position = resolved.position;
        upgraded = true;
      }
    }
  };

  enrichList(match.home_lineup, match.home_team?.short_name || '');
  enrichList(match.home_bench, match.home_team?.short_name || '');
  enrichList(match.away_lineup, match.away_team?.short_name || '');
  enrichList(match.away_bench, match.away_team?.short_name || '');
  return upgraded;
}
