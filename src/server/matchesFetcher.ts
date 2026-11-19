import { MatchCardItem, MatchPlayerItem, MatchPlayerEvent, PositionType } from '../types.ts';

export const FPL_BASE = 'https://fantasy.premierleague.com/api';
export const FPL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://fantasy.premierleague.com/'
};

export const PULSE_BASE = 'https://footballapi.pulselive.com/football';
export const SDP_PULSE_BASE = 'https://sdp-prem-prod.premier-league-prod.pulselive.com';
export const PULSE_HEADERS = {
  'Origin': 'https://www.premierleague.com',
  'Referer': 'https://www.premierleague.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*'
};

const POSITION_MAP: Record<number, PositionType> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD'
};

const POSITION_SORT_ORDER: Record<string, number> = {
  GKP: 1,
  G: 1,
  DEF: 2,
  D: 2,
  MID: 3,
  M: 3,
  FWD: 4,
  F: 4
};

// In-memory cache for transformed matches by GW
const matchesGwCache = new Map<number, { data: MatchCardItem[]; time: number; isAllFinished: boolean; isFuture?: boolean }>();

// Cache for FPL bootstrap-static (2.5MB) to prevent redundant heavy network downloads on every GW transition
let cachedBootstrapStatic: { data: any; time: number } | null = null;

async function getCachedBootstrapStatic(force: boolean = false): Promise<any> {
  const now = Date.now();
  if (!force && cachedBootstrapStatic && now - cachedBootstrapStatic.time < 3600000 * 2) { // 2 hours TTL
    return cachedBootstrapStatic.data;
  }
  const data = await fetchJson(`${FPL_BASE}/bootstrap-static/`, FPL_HEADERS);
  if (data && Array.isArray(data.teams) && Array.isArray(data.elements)) {
    cachedBootstrapStatic = { data, time: now };
    return data;
  }
  return cachedBootstrapStatic?.data || null;
}

// Cache for Pulse compSeason ID (e.g. 841 for 2026/2027)
let cachedCompSeason: { id: number; label: string; time: number } | null = null;

// Cache for all season fixtures index: `${gw}_${homeShort}_${awayShort}` -> pulseMatchId
let pulseSeasonFixturesCache: {
  seasonId: number;
  fixtures: any[];
  indexByGwAndTeams: Map<string, number>;
  optaByPulseId: Map<number, number>;
  time: number;
} | null = null;

// Cache for individual Pulse match details (lineups & events)
const pulseMatchDetailsCache = new Map<number, { data: any; time: number; isFinished: boolean }>();

/**
 * Synchronously returns cached matches for a GW if already loaded in memory
 */
export function getCachedMatchesForGw(gw: number): MatchCardItem[] | null {
  return matchesGwCache.get(gw)?.data || null;
}

/**
 * Clear matches cache to force fresh live fetch on next request or after sync
 */
export function invalidateMatchesCache(gw?: number): void {
  if (typeof gw === 'number') {
    matchesGwCache.delete(gw);
  } else {
    matchesGwCache.clear();
    cachedBootstrapStatic = null;
  }
  for (const [id, item] of pulseMatchDetailsCache.entries()) {
    if (!item.isFinished) {
      pulseMatchDetailsCache.delete(id);
    }
  }
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Dynamically resolves the latest Premier League compSeason ID from Pulse API.
 * Never hardcodes outdated season IDs; automatically picks the latest active season (e.g. 2026/2027 = 841).
 */
async function getLatestPulseCompSeason(): Promise<{ id: number; label: string }> {
  const now = Date.now();
  if (cachedCompSeason && now - cachedCompSeason.time < 3600000 * 6) { // 6 hours TTL
    return cachedCompSeason;
  }

  try {
    const data = await fetchJson(`${PULSE_BASE}/competitions/1/compseasons`, PULSE_HEADERS);
    if (data && Array.isArray(data.content) && data.content.length > 0) {
      const topSeason = data.content[0];
      if (topSeason.id) {
        cachedCompSeason = {
          id: topSeason.id,
          label: topSeason.label || 'Premier League',
          time: now
        };
        return cachedCompSeason;
      }
    }
  } catch (err: any) {
    console.warn('[Pulse API] Failed to fetch latest compSeason:', err.message);
  }

  // Fallback to active 2026/2027 season ID if API temporary glitch
  return { id: 841, label: 'English Premier League Season 2026/2027' };
}

/**
 * Fetches all fixtures for the current season from Pulse API and builds a lookup index:
 * Key format: `${gw}_${homeShort}_${awayShort}` -> pulseMatchId
 */
export async function getPulseSeasonFixturesIndex(): Promise<Map<string, number>> {
  const now = Date.now();
  const season = await getLatestPulseCompSeason();

  if (pulseSeasonFixturesCache && pulseSeasonFixturesCache.seasonId === season.id && now - pulseSeasonFixturesCache.time < 3600000) { // 1 hour TTL
    return pulseSeasonFixturesCache.indexByGwAndTeams;
  }

  const index = new Map<string, number>();
  const optaByPulseId = new Map<number, number>();
  try {
    const data = await fetchJson(`${PULSE_BASE}/fixtures?comps=1&compSeasons=${season.id}&page=0&pageSize=400&altIds=true`, PULSE_HEADERS);
    if (data && Array.isArray(data.content)) {
      for (const fix of data.content) {
        const gw = fix.gameweek?.gameweek;
        const homeShort = fix.teams?.[0]?.team?.club?.abbr || fix.teams?.[0]?.team?.shortName;
        const awayShort = fix.teams?.[1]?.team?.club?.abbr || fix.teams?.[1]?.team?.shortName;
        if (gw && homeShort && awayShort && fix.id) {
          index.set(`${gw}_${homeShort}_${awayShort}`, fix.id);
        }
        if (fix.id && fix.altIds?.opta) {
          const optaCode = parseInt(String(fix.altIds.opta).replace(/\D/g, ''), 10);
          if (!isNaN(optaCode) && optaCode > 0) {
            optaByPulseId.set(Number(fix.id), optaCode);
          }
        }
      }
      pulseSeasonFixturesCache = {
        seasonId: season.id,
        fixtures: data.content,
        indexByGwAndTeams: index,
        optaByPulseId,
        time: now
      };
      return index;
    }
  } catch (err: any) {
    console.warn('[Pulse API] Failed to fetch season fixtures index:', err.message);
  }

  return pulseSeasonFixturesCache?.indexByGwAndTeams || index;
}

export async function getOptaMatchCodeForPulseId(pulseId: number): Promise<number | null> {
  if (!pulseId) return null;
  if (!pulseSeasonFixturesCache) {
    await getPulseSeasonFixturesIndex();
  }
  return pulseSeasonFixturesCache?.optaByPulseId.get(Number(pulseId)) || null;
}

function mapSdpPosChar(posStr?: string): string {
  const p = String(posStr || '').toLowerCase();
  if (p.includes('goalkeeper') || p === 'g') return 'G';
  if (p.includes('defender') || p === 'd') return 'D';
  if (p.includes('forward') || p.includes('striker') || p === 'f') return 'F';
  return 'M';
}

function mapSdpPlayerToPulse(p: any): any {
  const isSub = p?.position === 'Substitute';
  const effectivePos = isSub ? (p?.subPosition || 'Midfielder') : p?.position;
  const posChar = mapSdpPosChar(effectivePos);
  const numId = Number(p?.id) || 0;
  const first = String(p?.firstName || '').trim();
  const last = String(p?.lastName || '').trim();
  const display = `${first} ${last}`.trim() || last || first || 'Player';
  return {
    id: numId,
    altIds: numId ? { opta: `p${numId}` } : undefined,
    name: {
      first,
      last: last || display,
      display
    },
    matchPosition: posChar,
    info: {
      position: posChar,
      shirtNum: Number(p?.shirtNum) || 0
    },
    captain: Boolean(p?.isCaptain),
    shirtNumber: Number(p?.shirtNum) || 0
  };
}

function mapSdpPeriodToPhase(period?: string): string {
  if (period === 'FirstHalf') return '1';
  if (period === 'SecondHalf') return '2';
  if (period === 'HalfTime') return 'HT';
  if (period === 'FullTime') return 'F';
  return '1';
}

function parseSdpClockToLabelAndSecs(clock?: string | number | null): { label: string; secs: number } | undefined {
  if (clock === undefined || clock === null || clock === '') return undefined;
  const raw = String(clock).trim();
  const plusMatch = raw.match(/^(\d+)\+(\d+)$/);
  if (plusMatch) {
    const mins = parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10);
    return { label: `${raw}'`, secs: mins * 60 };
  }
  const num = parseInt(raw, 10);
  if (!isNaN(num)) {
    return { label: `${num}'`, secs: num * 60 };
  }
  return { label: raw, secs: 0 };
}

/**
 * Fetches match lineups, events, and live status from Premier League SDP API
 * and normalizes into the standard Pulse match payload shape.
 */
export async function fetchSdpNormalizedMatch(
  optaMatchCode: number,
  pulseMatchId?: number | null,
  gwHint?: number
): Promise<any | null> {
  if (!optaMatchCode || optaMatchCode <= 0) return null;

  try {
    const [lineups, sdpEvents, matchV2] = await Promise.all([
      fetchJson(`${SDP_PULSE_BASE}/api/v3/matches/${optaMatchCode}/lineups`, PULSE_HEADERS),
      fetchJson(`${SDP_PULSE_BASE}/api/v1/matches/${optaMatchCode}/events`, PULSE_HEADERS),
      fetchJson(`${SDP_PULSE_BASE}/api/v2/matches/${optaMatchCode}`, PULSE_HEADERS)
    ]);

    if (!lineups && !matchV2 && !sdpEvents) {
      return null;
    }

    const period = String(matchV2?.period || '');
    const isFt = period === 'FullTime';
    const isHt = period === 'HalfTime';
    const isFirstHalf = period === 'FirstHalf';
    const isSecondHalf =
      period === 'SecondHalf' ||
      period === 'ExtraTime' ||
      period === 'ExtraTimeFirstHalf' ||
      period === 'ExtraTimeSecondHalf' ||
      period === 'Penalties';
    const isLive = isFirstHalf || isSecondHalf || isHt;

    const homeScore = matchV2?.homeTeam?.score ?? null;
    const awayScore = matchV2?.awayTeam?.score ?? null;
    let outcome: string | undefined;
    if (isFt && homeScore !== null && awayScore !== null) {
      outcome = homeScore > awayScore ? 'H' : awayScore > homeScore ? 'A' : 'D';
    }

    const homeRawPlayers: any[] = Array.isArray(lineups?.home_team?.players) ? lineups.home_team.players : [];
    const awayRawPlayers: any[] = Array.isArray(lineups?.away_team?.players) ? lineups.away_team.players : [];

    const homeStarters = homeRawPlayers.filter((p) => p?.position !== 'Substitute').map(mapSdpPlayerToPulse);
    const homeSubs = homeRawPlayers.filter((p) => p?.position === 'Substitute').map(mapSdpPlayerToPulse);
    const awayStarters = awayRawPlayers.filter((p) => p?.position !== 'Substitute').map(mapSdpPlayerToPulse);
    const awaySubs = awayRawPlayers.filter((p) => p?.position === 'Substitute').map(mapSdpPlayerToPulse);

    const homeTeamId = Number(lineups?.home_team?.teamId || matchV2?.homeTeam?.id) || 0;
    const awayTeamId = Number(lineups?.away_team?.teamId || matchV2?.awayTeam?.id) || 0;

    const normalizedEvents: any[] = [];
    for (const side of [sdpEvents?.homeTeam, sdpEvents?.awayTeam]) {
      if (!side) continue;
      for (const s of side.subs || []) {
        const phase = mapSdpPeriodToPhase(s.period);
        const clock = parseSdpClockToLabelAndSecs(s.time);
        if (s.playerOnId) {
          normalizedEvents.push({
            type: 'S',
            personId: Number(s.playerOnId),
            description: 'ON',
            phase,
            clock
          });
        }
        if (s.playerOffId) {
          normalizedEvents.push({
            type: 'S',
            personId: Number(s.playerOffId),
            description: 'OFF',
            phase,
            clock
          });
        }
      }
      for (const g of side.goals || []) {
        const gtLower = String(g.goalType || '').toLowerCase();
        normalizedEvents.push({
          type: gtLower.includes('own') ? 'O' : gtLower.includes('pen') ? 'P' : 'G',
          personId: Number(g.playerId),
          assistId: g.assistPlayerId ? Number(g.assistPlayerId) : undefined,
          phase: mapSdpPeriodToPhase(g.period),
          clock: parseSdpClockToLabelAndSecs(g.time)
        });
      }
      for (const c of side.cards || []) {
        normalizedEvents.push({
          type: c.type === 'Yellow' ? 'Y' : c.type === 'SecondYellow' ? 'YR' : 'R',
          personId: Number(c.playerId),
          phase: mapSdpPeriodToPhase(c.period),
          clock: parseSdpClockToLabelAndSecs(c.time)
        });
      }
    }

    if (isFirstHalf || isHt || isSecondHalf || isFt) {
      normalizedEvents.push({ type: 'PS', phase: '1', clock: { secs: 0, label: "1'" } });
    }
    if (isHt || isSecondHalf || isFt) {
      normalizedEvents.push({ type: 'PE', phase: '1', clock: { secs: 2700, label: "45'" } });
    }
    if (isSecondHalf || isFt) {
      normalizedEvents.push({ type: 'PS', phase: '2', clock: { secs: 2700, label: "45'" } });
    }
    if (isFt) {
      normalizedEvents.push({ type: 'PE', phase: '2', clock: { secs: 5400, label: "90'" } });
    }

    const kickoffStr = matchV2?.kickoff ? String(matchV2.kickoff).replace(' ', 'T') + 'Z' : '';
    const kickoffMillis = kickoffStr ? Date.parse(kickoffStr) : 0;

    return {
      id: pulseMatchId || optaMatchCode,
      altIds: { opta: `g${optaMatchCode}` },
      gameweek: {
        gameweek: Number(matchV2?.matchWeek || gwHint) || 0
      },
      kickoff: kickoffMillis > 0 ? { millis: kickoffMillis, label: String(matchV2?.kickoff || '') } : undefined,
      ground: matchV2?.ground ? { name: String(matchV2.ground) } : undefined,
      status: isFt ? 'C' : isLive ? 'L' : 'U',
      phase: isFt ? 'F' : isHt ? 'HT' : isFirstHalf ? '1' : isSecondHalf ? '2' : 'U',
      outcome,
      clock: isFt
        ? { label: 'Full Time', secs: 5400 }
        : isHt
        ? { label: 'HT', secs: 2700 }
        : parseSdpClockToLabelAndSecs(matchV2?.clock),
      teams: [
        {
          team: {
            id: homeTeamId,
            name: matchV2?.homeTeam?.name || '',
            shortName: matchV2?.homeTeam?.shortName || '',
            club: { abbr: matchV2?.homeTeam?.abbr || '' }
          },
          score: homeScore
        },
        {
          team: {
            id: awayTeamId,
            name: matchV2?.awayTeam?.name || '',
            shortName: matchV2?.awayTeam?.shortName || '',
            club: { abbr: matchV2?.awayTeam?.abbr || '' }
          },
          score: awayScore
        }
      ],
      teamLists:
        homeStarters.length > 0 || awayStarters.length > 0
          ? [
              {
                teamId: homeTeamId,
                formation: lineups?.home_team?.formation,
                lineup: homeStarters,
                substitutes: homeSubs
              },
              {
                teamId: awayTeamId,
                formation: lineups?.away_team?.formation,
                lineup: awayStarters,
                substitutes: awaySubs
              }
            ]
          : [],
      events: normalizedEvents
    };
  } catch (err: any) {
    console.warn(`[SDP Pulse API] Failed to fetch match ${optaMatchCode}:`, err?.message || err);
    return null;
  }
}

/**
 * Fetches detailed match data (official starting XI, substitutes, and match events)
 * Primary: Premier League SDP API (using Opta match code `fix.code`).
 * Fallback: Legacy Pulse API `/fixtures/${pulseMatchId}`.
 */
async function fetchPulseMatchDetails(
  pulseMatchId: number | null,
  isMatchFinished: boolean,
  optaMatchCode?: number | null,
  gwHint?: number
): Promise<any | null> {
  const cacheKey = Number(optaMatchCode || pulseMatchId || 0);
  if (!cacheKey) return null;

  const now = Date.now();
  const cached = pulseMatchDetailsCache.get(cacheKey);

  // If match was already finished and cached, keep it for 24 hours
  if (cached) {
    const ttl = cached.isFinished ? 3600000 * 24 : 15000;
    if (now - cached.time < ttl) {
      return cached.data;
    }
  }

  try {
    let data: any = null;
    if (optaMatchCode && optaMatchCode > 0) {
      data = await fetchSdpNormalizedMatch(optaMatchCode, pulseMatchId, gwHint);
    }
    if (!data && pulseMatchId && pulseMatchId > 0) {
      data = await fetchJson(`${PULSE_BASE}/fixtures/${pulseMatchId}`, PULSE_HEADERS);
    }
    if (data) {
      const isFinished = Boolean(isMatchFinished || data.status === 'C');
      pulseMatchDetailsCache.set(cacheKey, {
        data,
        time: now,
        isFinished
      });
      return data;
    }
  } catch (err: any) {
    console.warn(`[Pulse API] Failed to fetch match details for match ${cacheKey}:`, err.message);
  }

  return cached?.data || null;
}

function normalizeDiacritics(str: string): string {
  if (!str) return '';
  return str
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ß]/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Normalizes Premier League Pulse clock labels into clean user-facing labels
 * e.g. "00'00" -> "0'", "06'00" -> "6'", "45+2'00" -> "45+2'", "HT" -> "Half Time"
 */
function formatPulseClock(label?: string): string {
  if (!label) return '';
  let str = label.trim();
  str = str.replace(/'[0-9]{2}$/, "'").replace(/:[0-9]{2}$/, "'");
  str = str.replace(/^0([0-9]')/, '$1');
  if (str === "00'") return "0'";
  return str;
}

/**
 * Main export: fetches matches for a given Gameweek with official lineups from Premier League Pulse API
 * and official FPL scoring/stats/points.
 */
export async function fetchMatchesForGw(gw: number): Promise<MatchCardItem[]> {
  const now = Date.now();
  const cachedGw = matchesGwCache.get(gw);
  if (cachedGw) {
    const ttl = cachedGw.isAllFinished
      ? 3600000 * 24 // 24 hours for past finished GWs
      : cachedGw.isFuture
      ? 1800000 // 30 minutes for future unstarted GWs
      : 15000; // 15 seconds during live matches
    if (now - cachedGw.time < ttl) {
      return cachedGw.data;
    }
  }

  // Fetch FPL fixtures for this GW and retrieve cached bootstrap-static (instant RAM retrieval)
  const [fixturesRaw, bootstrapRaw] = await Promise.all([
    fetchJson(`${FPL_BASE}/fixtures/?event=${gw}`, FPL_HEADERS),
    getCachedBootstrapStatic()
  ]);

  if (!fixturesRaw || !Array.isArray(fixturesRaw) || !bootstrapRaw) {
    return cachedGw ? cachedGw.data : [];
  }

  // Build team dictionary
  const teamMap = new Map<number, any>();
  for (const t of bootstrapRaw.teams || []) {
    teamMap.set(t.id, {
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      code: t.code,
      badge_url: `https://resources.premierleague.com/premierleague/badges/t${t.code}.svg`
    });
  }

  // FAST-PATH for Future Gameweeks (GW N+1 s.d. 38):
  // When no matches have started AND no matches are kicking off within 90 minutes,
  // skip heavy live stats and Pulse API calls.
  const hasStartedAny = fixturesRaw.some((f: any) => Boolean(f.started));
  const hasUpcomingSoon = fixturesRaw.some((f: any) => {
    if (!f.kickoff_time) return false;
    const kickoffMs = new Date(f.kickoff_time).getTime();
    return (kickoffMs - now) <= 90 * 60 * 1000;
  });

  if (!hasStartedAny && !hasUpcomingSoon) {
    const futureCards: MatchCardItem[] = fixturesRaw.map((fix: any) => {
      const homeTeam = teamMap.get(fix.team_h) || {
        id: fix.team_h,
        name: `Team ${fix.team_h}`,
        short_name: 'HOM',
        code: 0,
        badge_url: '/default_team_badge.png'
      };
      const awayTeam = teamMap.get(fix.team_a) || {
        id: fix.team_a,
        name: `Team ${fix.team_a}`,
        short_name: 'AWY',
        code: 0,
        badge_url: '/default_team_badge.png'
      };
      return {
        id: fix.id,
        event: gw,
        kickoff_time: fix.kickoff_time,
        started: false,
        finished: false,
        finished_provisional: false,
        minutes: 0,
        clock_label: '',
        phase: 'UPCOMING',
        is_half_time: false,
        home_team: homeTeam,
        away_team: awayTeam,
        team_h_score: null,
        team_a_score: null,
        has_lineup: false,
        home_lineup: [],
        home_bench: [],
        away_lineup: [],
        away_bench: []
      };
    });

    matchesGwCache.set(gw, {
      data: futureCards,
      time: now,
      isAllFinished: false,
      isFuture: true
    });

    return futureCards;
  }

  // Live / Finished Gameweek: Fetch live stats and Pulse season index in parallel
  const [liveRaw, pulseIndex] = await Promise.all([
    fetchJson(`${FPL_BASE}/event/${gw}/live/`, FPL_HEADERS),
    getPulseSeasonFixturesIndex()
  ]);

  // Build element dictionaries:
  // 1. By element id
  const elementMap = new Map<number, any>();
  // 2. By element code (Opta ID: p{code}) -> 100% direct match with Pulse API altIds.opta!
  const elementByCodeMap = new Map<number, any>();
  for (const el of bootstrapRaw.elements || []) {
    elementMap.set(el.id, el);
    elementByCodeMap.set(el.code, el);
  }

  // Build live elements map for this GW
  const liveStatsMap = new Map<number, any>();
  for (const item of liveRaw?.elements || []) {
    liveStatsMap.set(item.id, {
      points: item.stats?.total_points || 0,
      stats: item.stats || {}
    });
  }

  // Identify Pulse match IDs for all fixtures of this GW
  const fixturePulseIds: Array<{ fix: any; pulseId: number | null }> = fixturesRaw.map((fix: any) => {
    const homeTeam = teamMap.get(fix.team_h);
    const awayTeam = teamMap.get(fix.team_a);
    const pulseKey = `${gw}_${homeTeam?.short_name}_${awayTeam?.short_name}`;
    const pulseId = pulseIndex.get(pulseKey) || null;
    return { fix, pulseId };
  });

  // Fetch Pulse/SDP match details for all matches in parallel (using Opta match code `fix.code` + Pulse ID)
  const pulseMatchDetailsResults = await Promise.all(
    fixturePulseIds.map(async ({ fix, pulseId }) => {
      const optaCode = Number(fix.code) || null;
      if (!pulseId && !optaCode) return null;
      const isFt = Boolean(fix.finished || fix.finished_provisional);
      return await fetchPulseMatchDetails(pulseId, isFt, optaCode, gw);
    })
  );

  let allMatchesFinished = true;
  const matchCards: MatchCardItem[] = [];

  for (let idx = 0; idx < fixturePulseIds.length; idx++) {
    const { fix } = fixturePulseIds[idx];
    const pulseMatchData = pulseMatchDetailsResults[idx];

    const kickoffMs = fix.kickoff_time ? new Date(fix.kickoff_time).getTime() : 0;
    const elapsedMinutes = kickoffMs > 0 ? (now - kickoffMs) / (60 * 1000) : 0;

    const pulseEvents: any[] = Array.isArray(pulseMatchData?.events) ? pulseMatchData.events : [];

    // Precise event-based markers from Premier League Opta / Pulse feed:
    // 'PS' = Period Start ('1' = 1st half kickoff, '2' = 2nd half kickoff)
    // 'PE' = Period End   ('1' = 1st half whistle / Half Time, '2' = 2nd half whistle / Full Time)
    // CRITICAL: At the start of the 2nd half, Pulse API injects an empty skeleton placeholder PE event:
    // { phase: '2', type: 'PE', score: { ... } } with NO clock and NO time!
    // A genuine Period End event from referee final whistle ALWAYS has valid clock (secs >= 5400 for FT) or valid time millis.
    const hasFirstHalfEnd = pulseEvents.some((e: any) =>
      e.type === 'PE' &&
      (e.phase === '1' || e.phase === '1H') &&
      (Boolean(e.clock?.secs && e.clock.secs >= 2400) || Boolean(e.time?.millis && elapsedMinutes >= 40))
    );
    const hasSecondHalfStart = pulseEvents.some((e: any) =>
      e.type === 'PS' && (e.phase === '2' || e.phase === '2H')
    ) || Boolean(pulseMatchData && (pulseMatchData.phase === '2' || pulseMatchData.phase === '2H'));

    const hasSecondHalfEnd = pulseEvents.some((e: any) =>
      e.type === 'PE' &&
      (e.phase === '2' || e.phase === '2H') &&
      (
        Boolean(e.clock?.secs && e.clock.secs >= 5400) ||
        Boolean(e.time?.millis && elapsedMinutes >= 85)
      )
    );

    // Active Live Match Guard:
    // Pulse status 'L' means LIVE in-play match. Phase '1' or '2' indicates actively playing 1st or 2nd half.
    const isPulseLive = Boolean(
      pulseMatchData && (
        pulseMatchData.status === 'L' ||
        pulseMatchData.phase === '1' ||
        pulseMatchData.phase === '1H' ||
        pulseMatchData.phase === '2' ||
        pulseMatchData.phase === '2H'
      )
    );

    // Accurate Full Time Detection:
    // 1. FPL finished or finished_provisional
    // 2. Pulse match event Period End for phase 2 (hasSecondHalfEnd: final whistle blown by referee with clock >= 5400s)
    // 3. Pulse status 'C' (Complete) or phase 'F' / 'FT' (Full Time)
    // 4. Pulse outcome declared
    // 5. Pulse clock label explicitly includes 'full' or 'ft'
    // Live Guard: If Pulse actively reports match as live (status === 'L') and clock is under 90 mins (5400s),
    // it MUST NOT be considered finished.
    const isPulseFinished = pulseMatchData ? Boolean(
      (
        hasSecondHalfEnd ||
        pulseMatchData.status === 'C' ||
        pulseMatchData.phase === 'F' ||
        pulseMatchData.phase === 'FT' ||
        (typeof pulseMatchData.outcome === 'string' && pulseMatchData.outcome.length > 0) ||
        (typeof pulseMatchData.clock?.label === 'string' && (
          pulseMatchData.clock.label.toLowerCase().includes('full') ||
          pulseMatchData.clock.label.trim().toUpperCase() === 'FT'
        ))
      ) &&
      // Strict guard against false positives during live play:
      !(pulseMatchData.status === 'L' && (pulseMatchData.clock?.secs ?? 0) < 5400)
    ) : false;

    // Time-based fallback: match started, reached 90 mins, and elapsed >= 105 mins from kickoff
    // Guarded: Never override if Pulse is actively reporting the match as Live
    const isTimeFinished = Boolean(
      fix.started &&
      !isPulseLive &&
      (
        ((fix.minutes >= 90 || (pulseMatchData?.clock?.secs && pulseMatchData.clock.secs >= 5400)) && elapsedMinutes >= 105) ||
        elapsedMinutes >= 125
      )
    );

    const isFt = Boolean(fix.finished || fix.finished_provisional || isPulseFinished || isTimeFinished);
    if (!isFt) allMatchesFinished = false;

    // Accurate Half Time Detection:
    // A match is ONLY in Half Time if:
    // 1. It has started and is NOT finished.
    // 2. Second half has NOT started yet (!hasSecondHalfStart && pulseMatchData?.phase !== '2' && pulseMatchData?.phase !== '2H').
    // 3. Match has played at least ~40 minutes OR is explicitly declared HT by Pulse API status/clock.
    // CRITICAL NOTE: In Pulse API, `halfTimeScore` is an object (e.g. { homeScore: 0, awayScore: 0 } or running score)
    // returned on EVERY match from kickoff. It MUST NOT be used alone as a condition for Half Time!
    const isFirstHalfActive = pulseMatchData ? (pulseMatchData.phase === '1' || pulseMatchData.phase === '1H') : false;

    const isPulseHalfTimeExplicit = pulseMatchData ? Boolean(
      pulseMatchData.status === 'HT' ||
      pulseMatchData.phase === 'HT' ||
      pulseMatchData.phase === 'H' ||
      pulseMatchData.phase === 'HALFTIME' ||
      (typeof pulseMatchData.clock?.label === 'string' && (
        pulseMatchData.clock.label.toUpperCase().includes('HT') ||
        pulseMatchData.clock.label.toUpperCase().includes('HALF')
      ))
    ) : false;

    // Minimum duration required before a match can physically reach half-time (at least ~40 minutes)
    const hasEnoughTimeForHalfTime = elapsedMinutes >= 40 || fix.minutes >= 40 || Boolean(pulseMatchData?.clock?.secs && pulseMatchData.clock.secs >= 2400);

    const isPulseHalfTimeByEvent = Boolean(
      hasFirstHalfEnd &&
      !hasSecondHalfStart &&
      hasEnoughTimeForHalfTime &&
      !isFirstHalfActive
    );

    const isClockFrozenAtHalf = pulseMatchData ? Boolean(
      typeof pulseMatchData.clock?.label === 'string' &&
      (pulseMatchData.clock.label.startsWith('45+') || pulseMatchData.clock.label.startsWith("45'") || pulseMatchData.clock.label.startsWith('45:')) &&
      !hasSecondHalfStart &&
      pulseMatchData.phase !== '2' &&
      pulseMatchData.phase !== '2H' &&
      elapsedMinutes >= 48 &&
      elapsedMinutes <= 75
    ) : false;

    const isEstimatedHalfTime = Boolean(
      fix.started &&
      !isFt &&
      !hasSecondHalfStart &&
      !isFirstHalfActive &&
      (pulseMatchData ? (pulseMatchData.phase !== '2' && pulseMatchData.phase !== '2H') : true) &&
      (fix.minutes === 45 || (pulseMatchData?.clock?.secs && pulseMatchData.clock.secs >= 2700 && pulseMatchData.clock.secs <= 3600)) &&
      elapsedMinutes >= 48 &&
      elapsedMinutes <= 75
    );

    const isHalfTime = Boolean(
      fix.started &&
      !isFt &&
      !hasSecondHalfStart &&
      (
        isPulseHalfTimeExplicit ||
        (hasEnoughTimeForHalfTime && (
          isPulseHalfTimeByEvent ||
          isClockFrozenAtHalf ||
          isEstimatedHalfTime
        ))
      )
    );

    let clockLabel = '';
    if (isFt) {
      clockLabel = 'Full Time';
    } else if (isHalfTime) {
      clockLabel = 'Half Time';
    } else if (fix.started && pulseMatchData?.clock?.label) {
      const formatted = formatPulseClock(pulseMatchData.clock.label);
      if (formatted.toUpperCase().includes('HT') || formatted.toUpperCase().includes('HALF')) {
        clockLabel = 'Half Time';
      } else if (formatted.toUpperCase().includes('FT') || formatted.toUpperCase().includes('FULL')) {
        clockLabel = 'Full Time';
      } else {
        clockLabel = formatted;
      }
    } else if (fix.started && fix.minutes >= 90) {
      clockLabel = "90+'";
    } else if (fix.started && fix.minutes > 0) {
      clockLabel = `${fix.minutes}'`;
    } else if (fix.started) {
      clockLabel = "0'";
    }

    const matchPhase = isFt
      ? 'FT'
      : isHalfTime
      ? 'HT'
      : !fix.started
      ? 'UPCOMING'
      : (hasSecondHalfStart || fix.minutes > 45 || pulseMatchData?.phase === '2' || pulseMatchData?.phase === '2H')
      ? '2H'
      : '1H';

    const homeTeam = teamMap.get(fix.team_h) || {
      id: fix.team_h,
      name: `Team ${fix.team_h}`,
      short_name: 'HOM',
      code: 0,
      badge_url: '/default_team_badge.png'
    };

    const awayTeam = teamMap.get(fix.team_a) || {
      id: fix.team_a,
      name: `Team ${fix.team_a}`,
      short_name: 'AWY',
      code: 0,
      badge_url: '/default_team_badge.png'
    };

    // Index official match events from FPL fix.stats
    const fixStatEventsMap = new Map<number, {
      goals: number;
      assists: number;
      yellows: number;
      reds: number;
      ownGoals: number;
      penMissed: number;
      penSaved: number;
      bonus: number;
    }>();

    for (const st of fix.stats || []) {
      const iden = st.identifier;
      const combined = [...(st.h || []), ...(st.a || [])];
      for (const entry of combined) {
        const elId = entry.element;
        if (!elId) continue;
        if (!fixStatEventsMap.has(elId)) {
          fixStatEventsMap.set(elId, {
            goals: 0,
            assists: 0,
            yellows: 0,
            reds: 0,
            ownGoals: 0,
            penMissed: 0,
            penSaved: 0,
            bonus: 0
          });
        }
        const rec = fixStatEventsMap.get(elId)!;
        if (iden === 'goals_scored') rec.goals += entry.value;
        else if (iden === 'assists') rec.assists += entry.value;
        else if (iden === 'yellow_cards') rec.yellows += entry.value;
        else if (iden === 'red_cards') rec.reds += entry.value;
        else if (iden === 'own_goals') rec.ownGoals += entry.value;
        else if (iden === 'penalties_missed') rec.penMissed += entry.value;
        else if (iden === 'penalties_saved') rec.penSaved += entry.value;
        else if (iden === 'bonus') rec.bonus += entry.value;
      }
    }

    // Helper to build a MatchPlayerItem
    const buildMatchPlayer = (
      fplEl: any | null,
      pulsePlayer: any | null,
      isHome: boolean,
      isSubbedOn = false,
      isSubbedOff = false
    ): MatchPlayerItem => {
      const elId = fplEl ? fplEl.id : (pulsePlayer?.id ? -Math.abs(Number(pulsePlayer.id)) : 0);
      const live = fplEl ? liveStatsMap.get(fplEl.id) : null;
      const fixEvents = fplEl ? fixStatEventsMap.get(fplEl.id) : null;
      const statsObj = live?.stats || {};
      const gwPoints = live?.points || 0;

      // Position resolution: prefer FPL element_type, fallback to Pulse matchPosition / info.position
      let pos: PositionType = 'MID';
      if (fplEl && fplEl.element_type && POSITION_MAP[fplEl.element_type]) {
        pos = POSITION_MAP[fplEl.element_type];
      } else if (pulsePlayer) {
        const rawPos = pulsePlayer.matchPosition || pulsePlayer.info?.position || 'M';
        if (rawPos === 'G') pos = 'GKP';
        else if (rawPos === 'D') pos = 'DEF';
        else if (rawPos === 'F') pos = 'FWD';
        else pos = 'MID';
      }

      // DefCon calculation per official rule: DEF >= 10, MID/FWD >= 12
      const dcVal = statsObj.defensive_contribution || 0;
      const isDefConEligible = (pos === 'DEF' && dcVal >= 10) || ((pos === 'MID' || pos === 'FWD') && dcVal >= 12);

      const eventBadges: MatchPlayerEvent[] = [];
      const goalsCount = fixEvents?.goals || statsObj.goals_scored || 0;
      if (goalsCount > 0) {
        eventBadges.push({ type: 'goal', count: goalsCount });
      }

      const assistsCount = fixEvents?.assists || statsObj.assists || 0;
      if (assistsCount > 0) {
        eventBadges.push({ type: 'assist', count: assistsCount });
      }

      const yellowsCount = fixEvents?.yellows || statsObj.yellow_cards || 0;
      if (yellowsCount > 0) {
        eventBadges.push({ type: 'yellow_card', count: yellowsCount });
      }

      const redsCount = fixEvents?.reds || statsObj.red_cards || 0;
      if (redsCount > 0) {
        eventBadges.push({ type: 'red_card', count: redsCount });
      }

      const ogCount = fixEvents?.ownGoals || statsObj.own_goals || 0;
      if (ogCount > 0) {
        eventBadges.push({ type: 'own_goal', count: ogCount });
      }

      const pmCount = fixEvents?.penMissed || statsObj.penalties_missed || 0;
      if (pmCount > 0) {
        eventBadges.push({ type: 'pen_missed', count: pmCount });
      }

      const psCount = fixEvents?.penSaved || statsObj.penalties_saved || 0;
      if (psCount > 0) {
        eventBadges.push({ type: 'pen_saved', count: psCount });
      }

      if (isDefConEligible) {
        eventBadges.push({ type: 'def_con', count: 1 });
      }

      const bonusPts = fixEvents?.bonus || statsObj.bonus || 0;
      if (bonusPts > 0) {
        const bonusRank: 1 | 2 | 3 = bonusPts === 3 ? 1 : bonusPts === 2 ? 2 : 3;
        eventBadges.push({ type: 'bonus', count: 1, bonusRank });
      }

      if (isSubbedOn) {
        eventBadges.unshift({ type: 'sub', count: 1 });
      } else if (isSubbedOff) {
        eventBadges.push({ type: 'sub', count: 1 });
      }

      // Name resolution
      const webName = fplEl ? fplEl.web_name : (pulsePlayer?.name?.last || pulsePlayer?.name?.display || 'Player');
      const fullName = fplEl
        ? `${fplEl.first_name} ${fplEl.second_name}`.trim()
        : (pulsePlayer?.name?.display || `${pulsePlayer?.name?.first || ''} ${pulsePlayer?.name?.last || ''}`.trim());

      // Assign team corresponding to this match (handles transferred players like Ndiaye correctly)
      const assignedTeamId = isHome ? homeTeam.id : awayTeam.id;
      const assignedTeamShort = isHome ? homeTeam.short_name : awayTeam.short_name;

      const playerCode = fplEl ? fplEl.code : (pulsePlayer?.id || 0);
      const nowCost = fplEl ? fplEl.now_cost : 0;

      return {
        id: elId,
        code: playerCode,
        web_name: webName,
        full_name: fullName,
        position: pos,
        team: assignedTeamId,
        team_short_name: assignedTeamShort,
        now_cost: nowCost,
        gw_points: gwPoints,
        stats: {
          total_points: gwPoints,
          starts: statsObj.starts !== undefined ? Number(statsObj.starts) : (statsObj.minutes > 0 ? 1 : 0),
          minutes: statsObj.minutes || 0,
          goals_scored: goalsCount,
          assists: assistsCount,
          expected_goals: statsObj.expected_goals !== undefined ? parseFloat(String(statsObj.expected_goals)) : 0,
          expected_assists: statsObj.expected_assists !== undefined ? parseFloat(String(statsObj.expected_assists)) : 0,
          expected_goal_involvements: statsObj.expected_goal_involvements !== undefined ? parseFloat(String(statsObj.expected_goal_involvements)) : 0,
          clean_sheets: statsObj.clean_sheets || 0,
          goals_conceded: statsObj.goals_conceded || 0,
          expected_goals_conceded: statsObj.expected_goals_conceded !== undefined ? parseFloat(String(statsObj.expected_goals_conceded)) : 0,
          tackles: statsObj.tackles || 0,
          clearances_blocks_interceptions: statsObj.clearances_blocks_interceptions || 0,
          recoveries: statsObj.recoveries || 0,
          defensive_contribution: dcVal,
          own_goals: ogCount,
          penalties_saved: psCount,
          penalties_missed: pmCount,
          yellow_cards: yellowsCount,
          red_cards: redsCount,
          saves: statsObj.saves || 0,
          bonus: bonusPts,
          bps: statsObj.bps || 0,
          influence: statsObj.influence !== undefined ? parseFloat(String(statsObj.influence)) : 0,
          creativity: statsObj.creativity !== undefined ? parseFloat(String(statsObj.creativity)) : 0,
          threat: statsObj.threat !== undefined ? parseFloat(String(statsObj.threat)) : 0,
          ict_index: statsObj.ict_index !== undefined ? parseFloat(String(statsObj.ict_index)) : 0,
          net_transfers: fplEl ? (fplEl.transfers_in_event || 0) - (fplEl.transfers_out_event || 0) : 0,
          teams_selected_by: fplEl ? parseFloat(fplEl.selected_by_percent || '0') : 0,
          price: nowCost ? nowCost / 10 : 0,
          selected_by_percent: fplEl ? parseFloat(fplEl.selected_by_percent || '0') : 0,
          transfers_balance: fplEl ? (fplEl.transfers_in_event || 0) - (fplEl.transfers_out_event || 0) : 0
        },
        events: eventBadges
      };
    };

    let homeLineup: MatchPlayerItem[] = [];
    let homeBench: MatchPlayerItem[] = [];
    let awayLineup: MatchPlayerItem[] = [];
    let awayBench: MatchPlayerItem[] = [];
    let hasLineup = false;

    // Build lineup from official Pulse API if available
    const teamLists = pulseMatchData?.teamLists;
    if (teamLists && Array.isArray(teamLists) && teamLists.length >= 2 && teamLists[0] && teamLists[1]) {
      const homeTl = teamLists[0];
      const awayTl = teamLists[1];
      const rawHomeStarters = homeTl.lineup || [];
      const rawHomeBench = homeTl.substitutes || [];
      const rawAwayStarters = awayTl.lineup || [];
      const rawAwayBench = awayTl.substitutes || [];

      if (rawHomeStarters.length >= 10 && rawAwayStarters.length >= 10) {
        hasLineup = true;

        // Map substitution events from pulseMatchData.events by personId
        const subEventsByPersonId = new Map<number, { on?: boolean; off?: boolean }>();
        for (const ev of pulseMatchData.events || []) {
          if (ev.type === 'S' && ev.personId) {
            if (!subEventsByPersonId.has(ev.personId)) {
              subEventsByPersonId.set(ev.personId, {});
            }
            const s = subEventsByPersonId.get(ev.personId)!;
            if (ev.description === 'ON') s.on = true;
            if (ev.description === 'OFF') s.off = true;
          }
        }

        // Helper to match a Pulse player to an FPL element
        const matchPulsePlayerToFpl = (p: any): any | null => {
          // 1. Primary: Opta ID match (altIds.opta: 'p500040' -> code 500040)
          if (p.altIds?.opta) {
            const optaNum = parseInt(String(p.altIds.opta).replace(/\D/g, ''), 10);
            if (!isNaN(optaNum)) {
              const matched = elementByCodeMap.get(optaNum);
              if (matched) return matched;
            }
          }

          // 2. Fallback: Name matching against bootstrap elements
          const cleanPulseDisp = normalizeDiacritics(p.name?.display || '');
          const cleanPulseLast = normalizeDiacritics(p.name?.last || '');
          const cleanPulseFirst = normalizeDiacritics(p.name?.first || '');

          for (const el of bootstrapRaw.elements || []) {
            const cleanWeb = normalizeDiacritics(el.web_name);
            const cleanSec = normalizeDiacritics(el.second_name);
            const cleanFirst = normalizeDiacritics(el.first_name);

            if (cleanWeb === cleanPulseLast || cleanSec === cleanPulseLast) {
              if (!cleanPulseFirst || cleanFirst.startsWith(cleanPulseFirst.charAt(0))) {
                return el;
              }
            }
            if (cleanPulseDisp && `${cleanFirst} ${cleanSec}` === cleanPulseDisp) {
              return el;
            }
          }

          return null;
        };

        // Build Home Starters
        homeLineup = rawHomeStarters.map((p: any) => {
          const fplEl = matchPulsePlayerToFpl(p);
          const subInfo = subEventsByPersonId.get(p.id);
          return buildMatchPlayer(fplEl, p, true, false, Boolean(subInfo?.off));
        });

        // Tactical sort for home starters: GKP -> DEF -> MID -> FWD
        homeLineup.sort((a, b) => {
          const ordA = POSITION_SORT_ORDER[a.position] || 3;
          const ordB = POSITION_SORT_ORDER[b.position] || 3;
          return ordA - ordB;
        });

        // Build Home Bench
        homeBench = rawHomeBench.map((p: any) => {
          const fplEl = matchPulsePlayerToFpl(p);
          const subInfo = subEventsByPersonId.get(p.id);
          return buildMatchPlayer(fplEl, p, true, Boolean(subInfo?.on), false);
        });

        // Tactical sort for home bench: GKP -> DEF -> MID -> FWD
        homeBench.sort((a, b) => {
          const ordA = POSITION_SORT_ORDER[a.position] || 3;
          const ordB = POSITION_SORT_ORDER[b.position] || 3;
          return ordA - ordB;
        });

        // Build Away Starters
        awayLineup = rawAwayStarters.map((p: any) => {
          const fplEl = matchPulsePlayerToFpl(p);
          const subInfo = subEventsByPersonId.get(p.id);
          return buildMatchPlayer(fplEl, p, false, false, Boolean(subInfo?.off));
        });

        // Tactical sort for away starters: GKP -> DEF -> MID -> FWD
        awayLineup.sort((a, b) => {
          const ordA = POSITION_SORT_ORDER[a.position] || 3;
          const ordB = POSITION_SORT_ORDER[b.position] || 3;
          return ordA - ordB;
        });

        // Build Away Bench
        awayBench = rawAwayBench.map((p: any) => {
          const fplEl = matchPulsePlayerToFpl(p);
          const subInfo = subEventsByPersonId.get(p.id);
          return buildMatchPlayer(fplEl, p, false, Boolean(subInfo?.on), false);
        });

        // Tactical sort for away bench: GKP -> DEF -> MID -> FWD
        awayBench.sort((a, b) => {
          const ordA = POSITION_SORT_ORDER[a.position] || 3;
          const ordB = POSITION_SORT_ORDER[b.position] || 3;
          return ordA - ordB;
        });
      }
    }

    // Safety net fallback: if match is live/finished and Pulse lineup was not yet fetched
    if (!hasLineup && (fix.started || isFt)) {
      const allHomeTeamElements = (bootstrapRaw.elements || []).filter((e: any) => e.team === fix.team_h);
      const allAwayTeamElements = (bootstrapRaw.elements || []).filter((e: any) => e.team === fix.team_a);

      const buildFallback = (allTeamElements: any[], isHome: boolean) => {
        const rawStarters = allTeamElements.filter((el: any) => {
          const live = liveStatsMap.get(el.id);
          return live?.stats?.starts === 1;
        });
        const rawSubsPlayed = allTeamElements.filter((el: any) => {
          const live = liveStatsMap.get(el.id);
          return live?.stats?.starts !== 1 && (live?.stats?.minutes || 0) > 0;
        });

        const starters = rawStarters
          .sort((a: any, b: any) => a.element_type - b.element_type)
          .map((el: any) => {
            const live = liveStatsMap.get(el.id);
            const mins = live?.stats?.minutes || 0;
            return buildMatchPlayer(el, null, isHome, false, mins > 0 && mins < 90);
          });

        const bench = rawSubsPlayed
          .sort((a: any, b: any) => a.element_type - b.element_type)
          .map((el: any) => buildMatchPlayer(el, null, isHome, true, false));

        return { starters, bench, has: starters.length > 0 };
      };

      const hFb = buildFallback(allHomeTeamElements, true);
      const aFb = buildFallback(allAwayTeamElements, false);

      if (hFb.has && aFb.has) {
        hasLineup = true;
        homeLineup = hFb.starters;
        homeBench = hFb.bench;
        awayLineup = aFb.starters;
        awayBench = aFb.bench;
      }
    }

    matchCards.push({
      id: fix.id,
      event: gw,
      kickoff_time: fix.kickoff_time,
      started: Boolean(fix.started),
      finished: isFt,
      finished_provisional: Boolean(fix.finished_provisional || isPulseFinished),
      minutes: fix.minutes || 0,
      clock_label: clockLabel,
      phase: matchPhase,
      is_half_time: isHalfTime,
      venue: pulseMatchData?.ground?.name || undefined,
      home_team: homeTeam,
      away_team: awayTeam,
      team_h_score: fix.team_h_score ?? (pulseMatchData?.teams?.[0]?.score ?? null),
      team_a_score: fix.team_a_score ?? (pulseMatchData?.teams?.[1]?.score ?? null),
      has_lineup: hasLineup,
      home_lineup: homeLineup,
      home_bench: homeBench,
      away_lineup: awayLineup,
      away_bench: awayBench
    });
  }

  // Save to cache
  matchesGwCache.set(gw, {
    data: matchCards,
    time: now,
    isAllFinished: allMatchesFinished
  });

  return matchCards;
}
