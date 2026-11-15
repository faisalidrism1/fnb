import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { fetchMatchesForGw, getCachedMatchesForGw } from './matchesFetcher.ts';
import { getDbStandings, getOptimalDatabase, getGwSnapshot } from './db.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import type { MatchCardItem, MatchPlayerItem } from '../types.ts';

const PULSE_BASE = 'https://footballapi.pulselive.com/football';
const PULSE_HEADERS = {
  'Origin': 'https://www.premierleague.com',
  'Referer': 'https://www.premierleague.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*'
};

export interface LiveMatchStory {
  id: string;
  headline_id: string;
  headline_en: string;
  kategori: string;
  sub_kategori: string;
  drama_score: number;
  waktu_tayang: string[];
  gw: number;
  teams: string[];
  players: string[];
  sumber: 'Sys' | 'Bukan' | string;
  status_tayang: 'Y' | 'N';
  keterangan_tidak_tayang: string;
  timestamp_produksi?: string;
  poin_tayang?: number;
  pulseMatchId?: number;
  minute?: string;
  clockSecs?: number;
}

export interface FplPlayerLookup {
  id: number;
  webName: string;
  fullName: string;
  teamShort: string;
  clubName: string;
  position: string;
  ownershipPct: number;
  ownersCount: number;
  starterPct: number;
  starterCount: number;
  captainCount: number;
  isFit: boolean;
  nowCost: number;
}

/**
 * Normalizes strings by removing diacritics, accents, and non-alphanumeric characters.
 */
export function normalizeDiacritics(str: string): string {
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
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Loads the FPL player database and ownership data for the target gameweek.
 */
export function getFplPlayerDirectory(gw: number): {
  playersById: Map<number, FplPlayerLookup>;
  allPlayers: FplPlayerLookup[];
} {
  const playersById = new Map<number, FplPlayerLookup>();
  const allPlayers: FplPlayerLookup[] = [];

  try {
    const db = getOptimalDatabase();
    const snapshot = getGwSnapshot(gw);
    const totalTeams =
      (Array.isArray(snapshot?.standings) && snapshot.standings.length) ||
      Number(db.meta?.total_teams) ||
      0;
    const ownershipMap = new Map<
      number,
      { pct: number; count: number; starterCount: number; captainCount: number }
    >();

    if (snapshot && Array.isArray(snapshot.ownership_players)) {
      for (const op of snapshot.ownership_players) {
        if (op && op.id) {
          const ownersArr = Array.isArray(op.owners) ? op.owners : [];
          const starterCount = ownersArr.filter(
            (o: any) =>
              o.is_starter === true ||
              (o.position_in_squad != null && Number(o.position_in_squad) <= 11)
          ).length;
          const captainCount = ownersArr.filter((o: any) => Boolean(o.is_captain)).length;
          ownershipMap.set(op.id, {
            pct: typeof op.owned_percentage === 'number' ? Math.round(op.owned_percentage) : 0,
            count: Number(op.owned_count) || 0,
            starterCount,
            captainCount,
          });
        }
      }
    }

    if (db.players && typeof db.players === 'object') {
      for (const [idStr, p] of Object.entries(db.players as Record<string, any>)) {
        const id = Number(p.id) || Number(idStr);
        const own = ownershipMap.get(id);
        let starterCount = own?.starterCount ?? 0;
        let captainCount = own?.captainCount ?? 0;
        let ownersCount = own?.count ?? (p.league_ownership?.count || 0);
        if (!own && Array.isArray(p.league_ownership?.owners)) {
          const fallbackOwners = p.league_ownership.owners;
          starterCount = fallbackOwners.filter(
            (o: any) =>
              o.is_starter === true ||
              (o.position_in_squad != null && Number(o.position_in_squad) <= 11)
          ).length;
          captainCount = fallbackOwners.filter((o: any) => Boolean(o.is_captain)).length;
        }
        const ownershipPct =
          own?.pct ??
          (totalTeams > 0 ? Math.round((ownersCount / totalTeams) * 100) : 0);
        const starterPct =
          totalTeams > 0 ? Math.round((starterCount / totalTeams) * 100) : 0;
        const isFit =
          (p.status || 'a') === 'a' &&
          (p.chanceOfPlayingNextRound == null || Number(p.chanceOfPlayingNextRound) === 100) &&
          (p.chanceOfPlayingThisRound == null || Number(p.chanceOfPlayingThisRound) === 100);
        const clubName = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name, '');

        const entry: FplPlayerLookup = {
          id,
          webName: p.webName || p.web_name || '',
          fullName: p.fullName || p.full_name || p.webName || '',
          teamShort: p.teamShort || p.team_short_name || '',
          clubName,
          position: p.position || '',
          ownershipPct,
          ownersCount,
          starterPct,
          starterCount,
          captainCount,
          isFit,
          nowCost: Number(p.nowCost || p.cost || 0),
        };
        if (entry.webName) {
          playersById.set(id, entry);
          allPlayers.push(entry);
        }
      }
    }
  } catch (err: any) {
    console.warn('[Live Match Generator] Error loading FPL player directory:', err.message);
  }

  return { playersById, allPlayers };
}

export interface SurpriseLineupDetection {
  club: string;
  opponent: string;
  player: FplPlayerLookup;
  isBenched: boolean;
}

/**
 * Detects at most 1 fit popular starter (starterPct >= 15% or captained >= 3 teams)
 * who is omitted from a club's official starting XI (benched or missing from squad).
 */
export function detectSurpriseLineupForClub(
  club: string,
  opponent: string,
  starterFplIds: Set<number>,
  benchFplIds: Set<number>,
  starterCountRaw: number,
  allPlayers: FplPlayerLookup[],
  starterNamesNorm?: Set<string>,
  benchNamesNorm?: Set<string>
): SurpriseLineupDetection | null {
  if (!club || !opponent || starterCountRaw < 10) return null;

  const candidates = allPlayers
    .filter(
      (p) =>
        p.clubName === club &&
        p.isFit &&
        (p.starterPct >= 15 || p.captainCount >= 3)
    )
    .sort((a, b) => {
      if (b.starterPct !== a.starterPct) return b.starterPct - a.starterPct;
      if (b.captainCount !== a.captainCount) return b.captainCount - a.captainCount;
      if (b.ownersCount !== a.ownersCount) return b.ownersCount - a.ownersCount;
      return b.nowCost - a.nowCost;
    });

  for (const cand of candidates) {
    const webNorm = normalizeDiacritics(cand.webName);
    const fullNorm = normalizeDiacritics(cand.fullName);
    const isInStartingXi =
      starterFplIds.has(cand.id) ||
      Boolean(starterNamesNorm && ((webNorm && starterNamesNorm.has(webNorm)) || (fullNorm && starterNamesNorm.has(fullNorm))));
    if (isInStartingXi) continue;

    const isBenched =
      benchFplIds.has(cand.id) ||
      Boolean(benchNamesNorm && ((webNorm && benchNamesNorm.has(webNorm)) || (fullNorm && benchNamesNorm.has(fullNorm))));

    return {
      club,
      opponent,
      player: cand,
      isBenched,
    };
  }

  return null;
}

/**
 * Matches a Premier League Pulse person to our FPL player database.
 */
export function matchPulsePersonToFpl(
  pulsePerson: any,
  allFplPlayers: FplPlayerLookup[],
  teamHint?: string
): FplPlayerLookup | null {
  if (!pulsePerson) return null;

  const disp = pulsePerson.name?.display || '';
  const last = pulsePerson.name?.last || '';
  const first = pulsePerson.name?.first || '';

  const dispNorm = normalizeDiacritics(disp);
  const lastNorm = normalizeDiacritics(last);
  const firstNorm = normalizeDiacritics(first);

  // Filter candidate pool by team hint if available
  const pool = teamHint
    ? allFplPlayers.filter(p => !p.teamShort || p.teamShort.toUpperCase() === teamHint.toUpperCase())
    : allFplPlayers;

  // 1. Exact match on full name
  let matched = pool.find(p => normalizeDiacritics(p.fullName) === dispNorm);
  if (matched) return matched;

  // 2. Exact match on web name
  matched = pool.find(p => normalizeDiacritics(p.webName) === dispNorm || normalizeDiacritics(p.webName) === lastNorm);
  if (matched) return matched;

  // 3. Last name exact match and first name starts with same letter
  if (lastNorm.length >= 3) {
    matched = pool.find(p => {
      const pFull = normalizeDiacritics(p.fullName);
      const pWeb = normalizeDiacritics(p.webName);
      if (pWeb === lastNorm || pFull.includes(lastNorm)) {
        if (!firstNorm || pFull.includes(firstNorm.slice(0, 3))) return true;
      }
      return false;
    });
    if (matched) return matched;
  }

  // 4. Substring inclusion
  matched = pool.find(p => {
    const pFull = normalizeDiacritics(p.fullName);
    return dispNorm && (pFull.includes(dispNorm) || dispNorm.includes(pFull));
  });
  if (matched) return matched;

  // 5. Global search without team hint
  if (teamHint && !matched) {
    return matchPulsePersonToFpl(pulsePerson, allFplPlayers, undefined);
  }

  return null;
}

/**
 * Normalizes Premier League Pulse clock labels into clean user-facing labels:
 * e.g. "06'00" -> "6'", "45+3'00" -> "45+3'", "90+6'00" -> "90+6'"
 */
export function formatPulseClockLabel(label?: string): string {
  if (!label) return '';
  let str = label.trim();
  str = str.replace(/'[0-9]{2}$/, "'").replace(/:[0-9]{2}$/, "'");
  str = str.replace(/^0([0-9]')/, '$1');
  if (str === "00'") return "0'";
  return str;
}

/**
 * Replaces placeholders {variable} with corresponding values.
 */
function fillPlaceholders(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

/**
 * Resolves a conditional block template based on the condition header:
 * [Kondisi: ConditionName]
 */
function resolveConditionalBlock(template: string, conditionName: string, vars: Record<string, string | number>): string {
  if (!template) return '';
  if (!/\[Kondisi:\s*[^\]]+\]/i.test(template)) {
    return fillPlaceholders(template, vars);
  }
  const lines = template.split('\n');
  const sections: { header: string; lines: string[] }[] = [];
  let currentHeader = '';
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
    if (match) {
      if (currentHeader || currentLines.length > 0) {
        sections.push({ header: currentHeader, lines: currentLines });
      }
      currentHeader = match[1].trim();
      currentLines = [];
    } else if (line) {
      currentLines.push(rawLine);
    }
  }
  if (currentHeader || currentLines.length > 0) {
    sections.push({ header: currentHeader, lines: currentLines });
  }

  const targetLower = conditionName.toLowerCase();
  const matched =
    sections.find((s) => s.header.toLowerCase() === targetLower) ||
    sections.find((s) => s.header.toLowerCase().includes(targetLower));
  if (!matched) return '';
  const body = matched.lines.join('\n');
  return fillPlaceholders(body, vars);
}

/**
 * Fetches match commentary textstream (EN) from Pulse API to capture VAR decisions and Penalty Won events.
 */
export async function fetchPulseMatchTextstream(matchId: number): Promise<any[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${PULSE_BASE}/fixtures/${matchId}/textstream/EN?pageSize=250`, {
      headers: PULSE_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.events?.content)) {
        return data.events.content;
      }
      if (Array.isArray(data?.content)) {
        return data.content;
      }
    }
    return [];
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Pulse Match Generator] Failed to fetch textstream for match ${matchId}:`, err.message);
    return [];
  }
}

/**
 * Fetches match data from Pulse API by match ID, with disk cache fallback,
 * and enriches it with textstreamEvents (VAR & penalty won) when available.
 */
export async function fetchPulseMatch(matchId: number): Promise<any | null> {
  const localCachePath = path.join(process.cwd(), `src/data/pulse_match_${matchId}.json`);
  if (fs.existsSync(localCachePath)) {
    try {
      const cached = fs.readFileSync(localCachePath, 'utf-8');
      const parsed = JSON.parse(cached);
      if (parsed && parsed.id) {
        if (!Array.isArray(parsed.textstreamEvents)) {
          const tsEvents = await fetchPulseMatchTextstream(matchId);
          parsed.textstreamEvents = tsEvents;
          try {
            fs.writeFileSync(localCachePath, JSON.stringify(parsed, null, 2), 'utf-8');
          } catch {}
        }
        return parsed;
      }
    } catch {}
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${PULSE_BASE}/fixtures/${matchId}`, {
      headers: PULSE_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      const tsEvents = await fetchPulseMatchTextstream(matchId);
      if (tsEvents.length > 0) {
        data.textstreamEvents = tsEvents;
      }
      try {
        fs.writeFileSync(localCachePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch {}
      return data;
    }
    return null;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Pulse Match Generator] Failed to fetch match ${matchId}:`, err.message);
    return null;
  }
}

/**
 * Loads all active Live Match stories generated from the Subtab Editor Live Match templates.
 * Supports multi-match: scans all pulse_match_*.json files in src/data.
 */
export async function getAllLiveMatchStories(targetGw?: number): Promise<LiveMatchStory[]> {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];
  try {
    const dataDir = path.join(process.cwd(), 'src/data');
    const allStories: LiveMatchStory[] = [];
    if (fs.existsSync(dataDir)) {
      const matchFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('pulse_match_') && f.endsWith('.json'));
      for (const file of matchFiles) {
        try {
          const filePath = path.join(dataDir, file);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Number(content?.gameweek?.gameweek) === gw) {
            if (!Array.isArray(content.textstreamEvents) && content.id) {
              content.textstreamEvents = await fetchPulseMatchTextstream(Number(content.id));
              try {
                fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
              } catch {}
            }
            const stories = generateStoriesFromPulseMatch(content, gw);
            allStories.push(...stories);
          }
        } catch {}
      }
    }

    // Include live match statistical threshold events (LM_MATCH_SAVES_GOALKEEPER & LM_MATCH_DEFENSIVE_CONTRIBUTION)
    try {
      const statStories = await fetchAndGenerateLiveMatchStatStories(gw, false);
      allStories.push(...statStories);
    } catch {}

    // Include live team rank shift events (LM_STANDINGS_RANK_MOVEMENT) when matches are live
    try {
      const rankShiftStories = generateLiveTeamRankShiftStories(gw, { requireLiveMatch: true });
      allStories.push(...rankShiftStories);
    } catch {}

    // Include ongoing live match score snapshots (LM_MATCH_SCORE_LIVE)
    try {
      const scoreStories = generateLiveMatchScoreStories(gw);
      allStories.push(...scoreStories);
    } catch {}

    // Include live surprise lineup announcements (LM_LINEUP_SURPRISE_BENCHED)
    try {
      const existingIds = new Set(allStories.map((s) => s.id));
      const lineupStories = generateLiveLineupSurpriseStories(gw);
      for (const ls of lineupStories) {
        if (!existingIds.has(ls.id)) {
          allStories.push(ls);
        }
      }
    } catch {}

    return allStories;
  } catch (err: any) {
    console.warn('[Pulse Match Generator] Error in getAllLiveMatchStories:', err.message);
    return [];
  }
}

/**
 * Main generator function: Generates Live Match news stories from Pulse API data
 * using the official Phase 1 Live Match templates (No. 17 to 29).
 */
export function generateStoriesFromPulseMatch(
  pulseData: any,
  targetGw?: number
): LiveMatchStory[] {
  if (!pulseData) return [];
  const gw = targetGw || Number(pulseData?.gameweek?.gameweek) || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];

  const templates = getPhase1Templates();
  const tmplMap = new Map<string, Phase1TemplateItem>();
  for (const t of templates) {
    tmplMap.set(t.id, t);
  }

  const { allPlayers } = getFplPlayerDirectory(gw);

  const homeTeamRaw = pulseData.teams?.[0]?.team;
  const awayTeamRaw = pulseData.teams?.[1]?.team;
  const homeShort = homeTeamRaw?.club?.abbr || homeTeamRaw?.shortName || '';
  const awayShort = awayTeamRaw?.club?.abbr || awayTeamRaw?.shortName || '';
  const homeClub = resolveClubName(homeShort || homeTeamRaw?.name) || resolveClubName(homeTeamRaw?.name);
  const awayClub = resolveClubName(awayShort || awayTeamRaw?.name) || resolveClubName(awayTeamRaw?.name);
  if (!homeClub || !awayClub) return [];

  const venueName = pulseData.ground?.name || '';

  // Build person directory from teamLists
  const pulsePersons = new Map<number, { person: any; teamName: string; teamShort: string; teamId: number }>();
  if (Array.isArray(pulseData.teamLists)) {
    for (const tl of pulseData.teamLists) {
      const isHome = tl.teamId === homeTeamRaw?.id || (tl.teamId !== awayTeamRaw?.id && tl === pulseData.teamLists[0]);
      const tName = isHome ? homeClub : awayClub;
      const tShort = isHome ? homeShort : awayShort;
      const tId = tl.teamId || (isHome ? homeTeamRaw?.id : awayTeamRaw?.id) || 0;
      for (const p of [...(tl.lineup || []), ...(tl.substitutes || [])]) {
        if (p && p.id) {
          pulsePersons.set(p.id, { person: p, teamName: tName, teamShort: tShort, teamId: tId });
        }
      }
    }
  }

  const resolvePlayer = (personId?: number): {
    name: string;
    pct: number;
    club: string;
    fpl: FplPlayerLookup | null;
  } => {
    if (!personId) {
      return { name: '', pct: 0, club: '', fpl: null };
    }
    const pInfo = pulsePersons.get(personId);
    const matchedFpl = matchPulsePersonToFpl(pInfo?.person, allPlayers, pInfo?.teamShort);
    if (matchedFpl) {
      return {
        name: matchedFpl.webName,
        pct: matchedFpl.ownershipPct,
        club: pInfo?.teamName || resolveClubName(matchedFpl.teamShort),
        fpl: matchedFpl,
      };
    }
    const pulseName = pInfo?.person?.name?.last || pInfo?.person?.name?.display || '';
    return {
      name: pulseName,
      pct: 0,
      club: pInfo?.teamName || '',
      fpl: null,
    };
  };

  const stories: LiveMatchStory[] = [];
  const events = Array.isArray(pulseData.events) ? pulseData.events : [];
  const matchId = pulseData.id;
  if (!matchId) return [];

  // Track scorers up to current event (used for both Half Time and Full Time)
  const allScorersList: Array<{ name: string; pct: number; count: number; ogCount: number }> = [];

  const formatPeriodScorersList = (lang: 'id' | 'en'): string => {
    if (allScorersList.length === 0) return '';
    const tokens = allScorersList.map((s) => {
      if (s.ogCount > 0 && s.count === 0) {
        return lang === 'id'
          ? `[P:${s.name}] ([N:${s.pct}%]) [N:(GBD)]`
          : `[P:${s.name}] ([N:${s.pct}%]) [N:(OG)]`;
      }
      const totalG = s.count + s.ogCount;
      const countSuffix =
        totalG > 1
          ? lang === 'id'
            ? ` [N:(${totalG} Gol)]`
            : ` [N:(${totalG} Goals)]`
          : '';
      return `[P:${s.name}] ([N:${s.pct}%])${countSuffix}`;
    });
    const n = tokens.length;
    if (n === 1) return tokens[0];
    if (n === 2) return lang === 'id' ? `${tokens[0]} dan ${tokens[1]}` : `${tokens[0]} and ${tokens[1]}`;
    return lang === 'id'
      ? `${tokens.slice(0, -1).join(', ')}, dan ${tokens[n - 1]}`
      : `${tokens.slice(0, -1).join(', ')}, and ${tokens[n - 1]}`;
  };

  // Track active defensive players on pitch (per FPL rule, red-carded players stay subject to conceded-goal penalties)
  const homeTeamId = homeTeamRaw?.id;
  const awayTeamId = awayTeamRaw?.id;
  const homeActivePitchIds = new Set<number>();
  const awayActivePitchIds = new Set<number>();

  if (Array.isArray(pulseData.teamLists)) {
    for (const tl of pulseData.teamLists) {
      const isHome = tl.teamId === homeTeamId || (tl.teamId !== awayTeamId && tl === pulseData.teamLists[0]);
      const targetSet = isHome ? homeActivePitchIds : awayActivePitchIds;
      const starterFplIds = new Set<number>();
      const benchFplIds = new Set<number>();
      const starterNamesNorm = new Set<string>();
      const benchNamesNorm = new Set<string>();
      const teamShortHint = isHome ? homeShort : awayShort;
      const clubName = isHome ? homeClub : awayClub;
      const oppName = isHome ? awayClub : homeClub;

      for (const p of tl.lineup || []) {
        if (p?.id) targetSet.add(p.id);
        const fpl = matchPulsePersonToFpl(p, allPlayers, teamShortHint);
        if (fpl) starterFplIds.add(fpl.id);
        const dn = normalizeDiacritics(p?.name?.display || '');
        const ln = normalizeDiacritics(p?.name?.last || '');
        if (dn) starterNamesNorm.add(dn);
        if (ln) starterNamesNorm.add(ln);
      }
      for (const p of tl.substitutes || []) {
        const fpl = matchPulsePersonToFpl(p, allPlayers, teamShortHint);
        if (fpl) benchFplIds.add(fpl.id);
        const dn = normalizeDiacritics(p?.name?.display || '');
        const ln = normalizeDiacritics(p?.name?.last || '');
        if (dn) benchNamesNorm.add(dn);
        if (ln) benchNamesNorm.add(ln);
      }

      const tmplLineup = tmplMap.get('LM_LINEUP_SURPRISE_BENCHED');
      if (tmplLineup) {
        const surprise = detectSurpriseLineupForClub(
          clubName,
          oppName,
          starterFplIds,
          benchFplIds,
          (tl.lineup || []).length,
          allPlayers,
          starterNamesNorm,
          benchNamesNorm
        );
        if (surprise) {
          const cond = surprise.isBenched ? 'Dicadangkan' : 'Absen dari Skuad';
          const vars = {
            club: surprise.club,
            player: surprise.player.webName,
            starter_pct: surprise.player.starterPct,
            opponent: surprise.opponent,
          };
          const headlineId = resolveConditionalBlock(tmplLineup.template, cond, vars);
          const headlineEn = surprise.isBenched
            ? `[N:0'] [C:${surprise.club}] benches [P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) against [C:${surprise.opponent}].`
            : `[N:0'] [P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) misses out from [C:${surprise.club}]'s matchday squad against [C:${surprise.opponent}].`;
          const clubSlug = surprise.club.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const playerSlug = surprise.player.webName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          stories.push({
            id: `${tmplLineup.id}_${clubSlug}_${playerSlug}`,
            headline_id: headlineId,
            headline_en: headlineEn,
            kategori: tmplLineup.category,
            sub_kategori: tmplLineup.subcategory,
            drama_score: Math.min(93, 82 + Math.floor(surprise.player.starterPct / 10)),
            waktu_tayang: tmplLineup.gw_phase ? [tmplLineup.gw_phase] : ['Live Match'],
            gw: Number(tmplLineup.gw) || gw,
            teams: [homeClub, awayClub],
            players: [surprise.player.webName],
            sumber: (tmplLineup.source as any) || 'Sys',
            status_tayang: 'Y',
            keterangan_tidak_tayang: '',
            timestamp_produksi: tmplLineup.timestamp || tmplLineup.updated_at || new Date().toISOString(),
            pulseMatchId: matchId,
            minute: "0'",
            clockSecs: 0,
          });
        }
      }
    }
  }

  let runningHomeGoals = 0;
  let runningAwayGoals = 0;

  for (let idx = 0; idx < events.length; idx++) {
    const ev = events[idx];
    const clockLabel = formatPulseClockLabel(ev.clock?.label || ev.time?.label);
    const minuteStr = clockLabel ? `${clockLabel}` : "0'";
    const homeScore = ev.score?.homeScore ?? pulseData.teams?.[0]?.score ?? 0;
    const awayScore = ev.score?.awayScore ?? pulseData.teams?.[1]?.score ?? 0;
    
    // Determine player's actual club from teamLists directory
    const pInfo = ev.personId ? pulsePersons.get(ev.personId) : null;
    const eventTeamName = pInfo?.teamName || (ev.teamId === awayTeamRaw?.id ? awayClub : homeClub);

    const createLiveStory = (
      tmpl: Phase1TemplateItem,
      storyId: string,
      headlineId: string,
      headlineEn: string,
      dramaScore: number,
      teams: string[],
      players: string[],
      clockSecs: number
    ): LiveMatchStory => ({
      id: `${tmpl.id}_${storyId}`,
      headline_id: headlineId,
      headline_en: headlineEn,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: dramaScore,
      waktu_tayang: tmpl.gw_phase ? [tmpl.gw_phase] : ['Live Match'],
      gw: Number(tmpl.gw) || gw,
      teams,
      players,
      sumber: (tmpl.source as any) || 'Sys',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: tmpl.timestamp || tmpl.updated_at || new Date().toISOString(),
      pulseMatchId: matchId,
      minute: minuteStr,
      clockSecs,
    });

    // A. Period Start (PS)
    if (ev.type === 'PS') {
      const tmpl = tmplMap.get('LM_MATCH_PERIOD_START');
      if (tmpl) {
        const isSecondHalf = ev.phase === '2' || ev.phase === '2H';
        const cond = isSecondHalf ? 'Kickoff Babak 2' : 'Kickoff Babak 1';
        const vars = {
          minute: minuteStr,
          gw,
          venue: venueName,
          home_club: homeClub,
          away_club: awayClub,
          home_score: homeScore,
          away_score: awayScore,
        };
        const text = resolveConditionalBlock(tmpl.template, cond, vars);
        const headlineEn = isSecondHalf
          ? `[N:${minuteStr}] Second half kicks off between [C:${homeClub}] vs [C:${awayClub}] at [N:${venueName}]. Score: [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`
          : `[N:${minuteStr}] First half kicks off. Gameweek [N:${gw}] match between [C:${homeClub}] vs [C:${awayClub}] is underway at [N:${venueName}].`;
        
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_ps_${ev.phase || idx}`,
            text,
            headlineEn,
            85,
            [homeClub, awayClub],
            [],
            ev.clock?.secs ?? 0
          )
        );
      }
    }

    // B. Period End (PE)
    else if (ev.type === 'PE') {
      const tmpl = tmplMap.get('LM_MATCH_PERIOD_END');
      if (tmpl) {
        const isFt = ev.phase === '2' || ev.phase === '2H' || (ev.clock?.secs && ev.clock.secs >= 5400);
        const scorersStrId = formatPeriodScorersList('id');
        const scorersStrEn = formatPeriodScorersList('en');
        const hasGoals = (Number(homeScore) + Number(awayScore)) > 0 && Boolean(scorersStrId);

        const cond = isFt
          ? hasGoals
            ? 'Full Time (Dengan Gol)'
            : 'Full Time (Tanpa Gol)'
          : hasGoals
          ? 'Half Time (Dengan Gol)'
          : 'Half Time (Tanpa Gol)';

        const vars = {
          minute: minuteStr,
          venue: venueName,
          home_club: homeClub,
          away_club: awayClub,
          home_score: homeScore,
          away_score: awayScore,
          goalscorers_list: scorersStrId || 'tidak ada',
        };
        const text =
          resolveConditionalBlock(tmpl.template, cond, vars) ||
          resolveConditionalBlock(tmpl.template, isFt ? 'Full Time' : 'Half Time', vars);

        const headlineEn = isFt
          ? hasGoals
            ? `[N:${minuteStr}] Full time at [N:${venueName}]. [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}]. Goalscorers: ${scorersStrEn}.`
            : `[N:${minuteStr}] Full time at [N:${venueName}]. Goalless draw between [C:${homeClub}] [N:0] - [N:0] [C:${awayClub}].`
          : hasGoals
          ? `[N:${minuteStr}] Half time at [N:${venueName}]. [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}], goals scored by ${scorersStrEn}.`
          : `[N:${minuteStr}] Half time at [N:${venueName}]. Goalless first half between [C:${homeClub}] [N:0] - [N:0] [C:${awayClub}].`;

        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_pe_${ev.phase || idx}`,
            text,
            headlineEn,
            92,
            [homeClub, awayClub],
            allScorersList.map((s) => s.name).filter(Boolean),
            ev.clock?.secs ?? (isFt ? 5400 : 2700)
          )
        );
      }
    }

    // C. Goal: Open Play (G), Penalty Goal (P / G:PG), Own Goal (O / G:OG)
    else if (ev.type === 'G' || ev.type === 'P' || ev.type === 'O') {
      const isPenalty = ev.type === 'P' || ev.description === 'PG' || ev.subType === 'PENALTY_GOAL';
      const isOwnGoal = ev.type === 'O' || ev.description === 'OG' || ev.subType === 'OWN_GOAL';

      if (isPenalty) {
        const tmplPen = tmplMap.get('LM_MATCH_PENALTY_GOAL');
        const tmplMile = tmplMap.get('LM_MATCH_GOAL_MILESTONE');
        const scorer = resolvePlayer(ev.personId);
        // Track scorer
        let goalsCount = 1;
        const existingScorer = allScorersList.find((s) => s.name === scorer.name);
        if (existingScorer) {
          existingScorer.count++;
          goalsCount = existingScorer.count;
        } else if (scorer.name) {
          allScorersList.push({ name: scorer.name, pct: scorer.pct, count: 1, ogCount: 0 });
        }

        const vars = {
          scorer: scorer.name,
          scorer_pct: scorer.pct,
          player: scorer.name,
          player_pct: scorer.pct,
          club: scorer.club || eventTeamName,
          minute: minuteStr,
          goals_count: goalsCount,
          assist_clause: ' lewat penalti',
          home_club: homeClub,
          home_score: homeScore,
          away_score: awayScore,
          away_club: awayClub,
        };

        if (goalsCount >= 2 && tmplMile) {
          const cond = goalsCount >= 3 ? 'Hat-trick' : 'Brace';
          const text = resolveConditionalBlock(tmplMile.template, cond, vars);
          const enText =
            goalsCount >= 3
              ? `[N:${minuteStr}] Hat-trick! [P:${scorer.name}] ([N:${scorer.pct}%]) scores his [N:${goalsCount}] goal via penalty for [C:${vars.club}] — [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`
              : `[N:${minuteStr}] Brace! [P:${scorer.name}] ([N:${scorer.pct}%]) nets his second goal via penalty for [C:${vars.club}] — [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`;
          stories.push(
            createLiveStory(
              tmplMile,
              `pulse_${matchId}_goal_milestone_${goalsCount}_${idx}_${ev.personId}`,
              text,
              enText,
              goalsCount >= 3 ? 99 : 97,
              [homeClub, awayClub],
              [scorer.name],
              ev.clock?.secs ?? 0
            )
          );
        } else if (tmplPen) {
          const text = fillPlaceholders(tmplPen.template, vars);
          stories.push(
            createLiveStory(
              tmplPen,
              `pulse_${matchId}_goal_pen_${idx}_${ev.personId}`,
              text,
              `[N:${minuteStr}] Penalty goal. [P:${scorer.name}] ([N:${scorer.pct}%]) converts from the spot for [C:${vars.club}]. Score: [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`,
              96,
              [homeClub, awayClub],
              [scorer.name],
              ev.clock?.secs ?? 0
            )
          );
        }
      } else if (isOwnGoal) {
        const tmpl = tmplMap.get('LM_MATCH_GOAL_OWN');
        const scorer = resolvePlayer(ev.personId);
        const existingScorer = allScorersList.find((s) => s.name === scorer.name);
        if (existingScorer) existingScorer.ogCount++;
        else if (scorer.name) allScorersList.push({ name: scorer.name, pct: scorer.pct, count: 0, ogCount: 1 });

        if (tmpl) {
          const vars = {
            player: scorer.name,
            player_pct: scorer.pct,
            minute: minuteStr,
            home_club: homeClub,
            home_score: homeScore,
            away_score: awayScore,
            away_club: awayClub,
          };
          const text = fillPlaceholders(tmpl.template, vars);
          stories.push(
            createLiveStory(
              tmpl,
              `pulse_${matchId}_og_${idx}_${ev.personId}`,
              text,
              `[N:${minuteStr}] Own goal. [P:${scorer.name}] ([N:${scorer.pct}%]) puts the ball into his own net. Score: [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`,
              95,
              [homeClub, awayClub],
              [scorer.name],
              ev.clock?.secs ?? 0
            )
          );
        }
      } else {
        // Open Play Goal
        const tmpl = tmplMap.get('LM_MATCH_GOAL_OPEN_PLAY');
        const tmplMile = tmplMap.get('LM_MATCH_GOAL_MILESTONE');
        const scorer = resolvePlayer(ev.personId);
        const hasAssist = Boolean(ev.assistId);
        const assister = hasAssist ? resolvePlayer(ev.assistId) : null;
        const cond = hasAssist ? 'Dengan Assist' : 'Tanpa Assist';

        // Track scorer
        let goalsCount = 1;
        const existingScorer = allScorersList.find((s) => s.name === scorer.name);
        if (existingScorer) {
          existingScorer.count++;
          goalsCount = existingScorer.count;
        } else if (scorer.name) {
          allScorersList.push({ name: scorer.name, pct: scorer.pct, count: 1, ogCount: 0 });
        }

        const assistClauseId = assister ? ` dari assist [P:${assister.name}] ([N:${assister.pct}%])` : '';
        const assistClauseEn = assister ? ` assisted by [P:${assister.name}] ([N:${assister.pct}%])` : '';

        const vars = {
          club: scorer.club || eventTeamName,
          scorer: scorer.name,
          scorer_pct: scorer.pct,
          assister: assister ? assister.name : '',
          assister_pct: assister ? assister.pct : 0,
          minute: minuteStr,
          goals_count: goalsCount,
          assist_clause: assistClauseId,
          home_club: homeClub,
          home_score: homeScore,
          away_score: awayScore,
          away_club: awayClub,
        };

        if (goalsCount >= 2 && tmplMile) {
          const mileCond = goalsCount >= 3 ? 'Hat-trick' : 'Brace';
          const text = resolveConditionalBlock(tmplMile.template, mileCond, vars);
          const enText =
            goalsCount >= 3
              ? `[N:${minuteStr}] Hat-trick! [P:${scorer.name}] ([N:${scorer.pct}%]) reaches [N:${goalsCount} Goals] for [C:${vars.club}]${assistClauseEn} — [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`
              : `[N:${minuteStr}] Brace! [P:${scorer.name}] ([N:${scorer.pct}%]) scores his second goal for [C:${vars.club}]${assistClauseEn} — [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`;

          stories.push(
            createLiveStory(
              tmplMile,
              `pulse_${matchId}_goal_milestone_${goalsCount}_${idx}_${ev.personId}`,
              text,
              enText,
              goalsCount >= 3 ? 99 : 97,
              [homeClub, awayClub],
              assister ? [scorer.name, assister.name] : [scorer.name],
              ev.clock?.secs ?? 0
            )
          );
        } else if (tmpl) {
          const text = resolveConditionalBlock(tmpl.template, cond, vars);
          const enText = hasAssist
            ? `[N:${minuteStr}] Goal for [C:${vars.club}]. [P:${scorer.name}] ([N:${scorer.pct}%]) scores assisted by [P:${assister!.name}] ([N:${assister!.pct}%]). Score: [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`
            : `[N:${minuteStr}] Goal for [C:${vars.club}]. [P:${scorer.name}] ([N:${scorer.pct}%]) scores. Score: [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`;

          stories.push(
            createLiveStory(
              tmpl,
              `pulse_${matchId}_goal_${idx}_${ev.personId}`,
              text,
              enText,
              95,
              [homeClub, awayClub],
              assister ? [scorer.name, assister.name] : [scorer.name],
              ev.clock?.secs ?? 0
            )
          );
        }
      }

      // Emit LM_MATCH_CLEAN_SHEET_LOST (Clean Sheet Lost on 1st goal conceded, or -1 Pt penalty on every 2nd goal conceded)
      const prevH = runningHomeGoals;
      const prevA = runningAwayGoals;
      const evH = ev.score?.homeScore;
      const evA = ev.score?.awayScore;
      let homeScoredThisEvent = false;
      if (typeof evH === 'number' && typeof evA === 'number' && (evH !== prevH || evA !== prevA)) {
        homeScoredThisEvent = evH > prevH;
        runningHomeGoals = evH;
        runningAwayGoals = evA;
      } else {
        const scorerSideIsHome = (pInfo?.teamId ?? ev.teamId) === homeTeamId;
        homeScoredThisEvent = isOwnGoal ? !scorerSideIsHome : scorerSideIsHome;
        if (homeScoredThisEvent) runningHomeGoals++;
        else runningAwayGoals++;
      }

      const concedingSide: 'home' | 'away' = homeScoredThisEvent ? 'away' : 'home';
      const concedingClub = concedingSide === 'home' ? homeClub : awayClub;
      const scoringClub = concedingSide === 'home' ? awayClub : homeClub;
      const gcCount = concedingSide === 'home' ? runningAwayGoals : runningHomeGoals;

      const tmplCsLost = tmplMap.get('LM_MATCH_CLEAN_SHEET_LOST');
      if (tmplCsLost && (gcCount === 1 || (gcCount >= 2 && gcCount % 2 === 0))) {
        const activeIds = concedingSide === 'home' ? homeActivePitchIds : awayActivePitchIds;
        const activeDefs = Array.from(activeIds)
          .map((pid) => resolvePlayer(pid))
          .filter(
            (rp) =>
              rp.fpl &&
              (rp.fpl.position === 'DEF' || rp.fpl.position === 'GKP') &&
              rp.fpl.starterPct >= 15
          )
          .sort((a, b) => {
            if (b.fpl!.starterPct !== a.fpl!.starterPct) return b.fpl!.starterPct - a.fpl!.starterPct;
            if (b.fpl!.ownersCount !== a.fpl!.ownersCount) return b.fpl!.ownersCount - a.fpl!.ownersCount;
            return b.fpl!.nowCost - a.fpl!.nowCost;
          });

        const topDef = activeDefs[0];
        if (topDef?.fpl) {
          const isCsLost = gcCount === 1;
          const csCond = isCsLost ? 'Clean Sheet Hilang' : 'Penalti Kebobolan';
          const csText = resolveConditionalBlock(tmplCsLost.template, csCond, {
            minute: minuteStr,
            club: concedingClub,
            scoring_club: scoringClub,
            defender: topDef.name,
            defender_pct: topDef.pct,
            gc_count: gcCount,
          });
          const csEnText = isCsLost
            ? `[N:${minuteStr}] [C:${concedingClub}] fails to keep a clean sheet against [C:${scoringClub}] — [P:${topDef.name}] ([N:${topDef.pct}%]) loses [N:+4 Pts] potential.`
            : `[N:${minuteStr}] Goal conceded #[N:${gcCount}] against [C:${scoringClub}] hands [P:${topDef.name}] ([N:${topDef.pct}%]) a [N:-1 Pt] penalty.`;

          stories.push(
            createLiveStory(
              tmplCsLost,
              isCsLost
                ? `pulse_${matchId}_cs_lost_${concedingSide}_${topDef.fpl.id}`
                : `pulse_${matchId}_gc_pen_${gcCount}_${concedingSide}_${topDef.fpl.id}`,
              csText,
              csEnText,
              isCsLost ? 88 : 85,
              [homeClub, awayClub],
              [topDef.name],
              ev.clock?.secs ?? 0
            )
          );
        }
      }
    }

    // C2. Penalty Non-Goal Events: Saved (SP / MP with keeper), Missed (MP), Awarded/Overturned (PA)
    else if (
      ev.type === 'SP' ||
      (ev.type === 'MP' && Boolean(ev.keeperId || ev.description === 'SP' || ev.subType === 'PENALTY_SAVED'))
    ) {
      const tmpl = tmplMap.get('LM_MATCH_PENALTY_SAVED');
      if (tmpl) {
        // In real Pulse API, SP event's personId is the penalty taker; find opposing GK from teamLists if keeperId absent
        const takerId = ev.takerId || ev.personId;
        let keeperId = ev.keeperId || ev.opponentPersonId;
        if (!keeperId && Array.isArray(pulseData.teamLists)) {
          const takerTeamId = ev.teamId || pulsePersons.get(takerId)?.teamId;
          const oppTeamList = pulseData.teamLists.find((tl: any) => tl.teamId !== takerTeamId);
          const oppGk = (oppTeamList?.lineup || []).find((p: any) => p.info?.position === 'G' || p.matchPosition === 'G');
          if (oppGk?.id) keeperId = oppGk.id;
        }
        const keeper = resolvePlayer(keeperId);
        const taker = resolvePlayer(takerId);
        const vars = {
          minute: minuteStr,
          keeper: keeper.name || 'Kiper',
          keeper_pct: keeper.pct,
          taker: taker.name || 'Penendang',
          taker_pct: taker.pct,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_pen_saved_${idx}_${keeperId || takerId || idx}`,
            text,
            `[N:${minuteStr}] Penalty saved. [P:${vars.keeper}] ([N:${vars.keeper_pct}%]) denies [P:${vars.taker}] ([N:${vars.taker_pct}%]) from the spot.`,
            94,
            [homeClub, awayClub],
            [vars.keeper, vars.taker].filter(Boolean),
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'MP') {
      const tmpl = tmplMap.get('LM_MATCH_PENALTY_MISSED');
      if (tmpl) {
        const taker = resolvePlayer(ev.personId || ev.takerId);
        const clubName = taker.club || eventTeamName;
        const vars = {
          minute: minuteStr,
          taker: taker.name || 'Pemain',
          taker_pct: taker.pct,
          club: clubName,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_pen_missed_${idx}_${ev.personId || idx}`,
            text,
            `[N:${minuteStr}] Penalty missed. [P:${vars.taker}] ([N:${vars.taker_pct}%]) fails to convert from the spot for [C:${clubName}].`,
            92,
            [homeClub, awayClub],
            [vars.taker].filter(Boolean),
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'PA') {
      const tmpl = tmplMap.get('LM_MATCH_PENALTY_AWARDED');
      if (tmpl) {
        const isCancelled = Boolean(
          ev.isOverturned ||
          ev.description === 'CANCELLED' ||
          ev.subType === 'PENALTY_CANCELLED'
        );
        const cond = isCancelled ? 'Penalti Dibatalkan' : 'Hadiah Penalti';
        const fouled = resolvePlayer(ev.fouledPersonId || ev.personId);
        const clubName = fouled.club || eventTeamName;
        const vars = {
          minute: minuteStr,
          club: clubName,
          fouled_player: fouled.name || 'Pemain',
          fouled_player_pct: fouled.pct,
        };
        const text = resolveConditionalBlock(tmpl.template, cond, vars);
        const enText = isCancelled
          ? `[N:${minuteStr}] Penalty overturned. The spot-kick decision for [C:${clubName}] is cancelled by the referee.`
          : `[N:${minuteStr}] Penalty awarded to [C:${clubName}] after a foul on [P:${vars.fouled_player}] ([N:${vars.fouled_player_pct}%]).`;
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_pen_award_${idx}_${ev.personId || idx}`,
            text,
            enText,
            90,
            [homeClub, awayClub],
            !isCancelled && fouled.name ? [fouled.name] : [],
            ev.clock?.secs ?? 0
          )
        );
      }
    }

    // D. Disciplinary: Yellow Card (B:Y), Second Yellow (SY / B:YR), Straight Red (R / B:R)
    else if (ev.type === 'B' && ev.description === 'YR') {
      const tmpl = tmplMap.get('LM_MATCH_CARD_SECOND_YELLOW');
      if (tmpl) {
        const player = resolvePlayer(ev.personId);
        const vars = {
          club: player.club || eventTeamName,
          player: player.name,
          player_pct: player.pct,
          minute: minuteStr,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_card_sy_${idx}_${ev.personId}`,
            text,
            `[N:${minuteStr}] Second yellow card. [P:${player.name}] ([N:${player.pct}%]) from [C:${vars.club}] receives his second booking and is sent off.`,
            90,
            [homeClub, awayClub],
            [player.name],
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'B' && ev.description === 'R') {
      const tmpl = tmplMap.get('LM_MATCH_CARD_STRAIGHT_RED');
      if (tmpl) {
        const player = resolvePlayer(ev.personId);
        const vars = {
          club: player.club || eventTeamName,
          player: player.name,
          player_pct: player.pct,
          minute: minuteStr,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_card_r_${idx}_${ev.personId}`,
            text,
            `[N:${minuteStr}] Straight red card. [P:${player.name}] ([N:${player.pct}%]) from [C:${vars.club}] is sent off by the referee.`,
            94,
            [homeClub, awayClub],
            [player.name],
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'B') {
      const tmpl = tmplMap.get('LM_MATCH_CARD_YELLOW');
      if (tmpl) {
        const player = resolvePlayer(ev.personId);
        const vars = {
          club: player.club || eventTeamName,
          player: player.name,
          player_pct: player.pct,
          minute: minuteStr,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_card_b_${idx}_${ev.personId}`,
            text,
            `[N:${minuteStr}] Yellow card. The referee books [C:${vars.club}] player [P:${player.name}] ([N:${player.pct}%]).`,
            75,
            [homeClub, awayClub],
            [player.name],
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'SY') {
      const tmpl = tmplMap.get('LM_MATCH_CARD_SECOND_YELLOW');
      if (tmpl) {
        const player = resolvePlayer(ev.personId);
        const vars = {
          club: player.club || eventTeamName,
          player: player.name,
          player_pct: player.pct,
          minute: minuteStr,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_card_sy_${idx}_${ev.personId}`,
            text,
            `[N:${minuteStr}] Second yellow card. [P:${player.name}] ([N:${player.pct}%]) from [C:${vars.club}] receives his second booking and is sent off.`,
            90,
            [homeClub, awayClub],
            [player.name],
            ev.clock?.secs ?? 0
          )
        );
      }
    } else if (ev.type === 'R') {
      const tmpl = tmplMap.get('LM_MATCH_CARD_STRAIGHT_RED');
      if (tmpl) {
        const player = resolvePlayer(ev.personId);
        const vars = {
          club: player.club || eventTeamName,
          player: player.name,
          player_pct: player.pct,
          minute: minuteStr,
        };
        const text = fillPlaceholders(tmpl.template, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_card_r_${idx}_${ev.personId}`,
            text,
            `[N:${minuteStr}] Straight red card. [P:${player.name}] ([N:${player.pct}%]) from [C:${vars.club}] is sent off by the referee.`,
            94,
            [homeClub, awayClub],
            [player.name],
            ev.clock?.secs ?? 0
          )
        );
      }
    }

    // E. Substitutions (S)
    else if (ev.type === 'S' && ev.description === 'ON') {
      let offEv = events[idx + 1]?.type === 'S' && events[idx + 1]?.description === 'OFF' ? events[idx + 1] : null;
      if (!offEv) {
        offEv = events.find(
          (o: any, oIdx: number) => oIdx !== idx && o.type === 'S' && o.description === 'OFF' && o.clock?.secs === ev.clock?.secs
        );
      }
      const playerIn = resolvePlayer(ev.personId);
      const playerOut = resolvePlayer(offEv?.personId);

      // Update active pitch sets for Clean Sheet / Goals Conceded tracking
      const subTeamId = ev.teamId || pInfo?.teamId || (offEv?.personId ? pulsePersons.get(offEv.personId)?.teamId : undefined);
      const isAwaySub = subTeamId ? subTeamId === awayTeamId : playerIn.club === awayClub || playerOut.club === awayClub;
      const pitchSet = isAwaySub ? awayActivePitchIds : homeActivePitchIds;
      if (offEv?.personId) pitchSet.delete(offEv.personId);
      if (ev.personId) pitchSet.add(ev.personId);

      const tmpl = tmplMap.get('LM_MATCH_SUBSTITUTION');
      if (tmpl) {
        const isDefenderOrGk = playerOut.fpl?.position === 'DEF' || playerOut.fpl?.position === 'GKP';
        const mins = parseInt(minuteStr.replace(/\D/g, ''), 10) || 0;
        const concededBeforeSub = isAwaySub
          ? Number(ev.score?.homeScore ?? runningHomeGoals)
          : Number(ev.score?.awayScore ?? runningAwayGoals);
        const isCleanSheetLocked = isDefenderOrGk && mins >= 60 && concededBeforeSub === 0;

        const cond = isCleanSheetLocked
          ? 'Pemain Bertahan Keluar Menit >= 60 Saat Belum Kebobolan'
          : 'Pergantian Biasa';

        const vars = {
          club: playerIn.club || playerOut.club || eventTeamName,
          minute: minuteStr,
          player_on: playerIn.name,
          player_on_pct: playerIn.pct,
          player_off: playerOut.name,
          player_off_pct: playerOut.pct,
        };
        const text = resolveConditionalBlock(tmpl.template, cond, vars);
        const enText = isCleanSheetLocked
          ? `[N:${minuteStr}] Substitution for [C:${vars.club}]: [P:${playerOut.name}] ([N:${playerOut.pct}%]) is substituted for [P:${playerIn.name}] ([N:${playerIn.pct}%]) with clean sheet locked.`
          : `[N:${minuteStr}] Substitution for [C:${vars.club}]: [P:${playerIn.name}] ([N:${playerIn.pct}%]) comes on replacing [P:${playerOut.name}] ([N:${playerOut.pct}%]).`;

        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_sub_${idx}_${ev.personId}`,
            text,
            enText,
            70,
            [homeClub, awayClub],
            [playerIn.name, playerOut.name].filter(p => p !== 'Player'),
            ev.clock?.secs ?? 0
          )
        );
      }
    }

    // F. VAR Review (VAR)
    else if (ev.type === 'VAR') {
      const tmpl = tmplMap.get('LM_MATCH_VAR_REVIEW');
      if (tmpl) {
        const subType = ev.subType || ev.description || 'GOAL_AWARDED';
        let cond = 'Gol Dinyatakan Sah';
        if (subType === 'GOAL_DISALLOWED' || subType === 'GOAL_CANCELLED') cond = 'Gol Dibatalkan';
        else if (subType === 'GOAL_AWARDED') cond = 'Gol Dinyatakan Sah';
        else if (subType === 'PENALTY_AWARDED') cond = 'Penalti Diberikan';
        else if (subType === 'PENALTY_CANCELLED') cond = 'Penalti Dibatalkan';
        else if (subType === 'RED_CARD_GIVEN') cond = 'Kartu Merah Diberikan';
        else if (subType === 'RED_CARD_OVERTURNED') cond = 'Kartu Merah Dibatalkan';

        const player = resolvePlayer(ev.personId);
        const vars = {
          minute: minuteStr,
          player: player.name,
          player_pct: player.pct,
          club: player.club || eventTeamName,
          reason: ev.reason || 'Offside',
          home_club: homeClub,
          home_score: homeScore,
          away_score: awayScore,
          away_club: awayClub,
        };
        const text = resolveConditionalBlock(tmpl.template, cond, vars);
        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_var_${idx}_${ev.subType || 'rev'}`,
            text,
            `[N:${minuteStr}] VAR review: Decision ${cond} for [C:${vars.club}].`,
            95,
            [homeClub, awayClub],
            player.name !== 'Player' ? [player.name] : [],
            ev.clock?.secs ?? 0
          )
        );
      }
    }
  }

  // G. Textstream-sourced Live Events: VAR Decisions (LM_MATCH_VAR_REVIEW) & Penalty Awarded (LM_MATCH_PENALTY_AWARDED)
  const textEvents: any[] = Array.isArray(pulseData.textstreamEvents) ? pulseData.textstreamEvents : [];
  if (textEvents.length > 0) {
    const inferClubFromText = (txt: string): string => {
      const lower = String(txt || '').toLowerCase();
      const homeRawName = String(homeTeamRaw?.name || '').toLowerCase();
      const awayRawName = String(awayTeamRaw?.name || '').toLowerCase();
      if (homeClub && lower.includes(homeClub.toLowerCase())) return homeClub;
      if (awayClub && lower.includes(awayClub.toLowerCase())) return awayClub;
      if (homeRawName && lower.includes(homeRawName)) return homeClub;
      if (awayRawName && lower.includes(awayRawName)) return awayClub;
      return homeClub;
    };

    const getScoreForVar = (targetSecs: number, condName: string, txt: string): { h: number; a: number } => {
      // 1. Prefer explicit score in Pulse textstream (e.g. "VAR Decision: Goal Home 2-1 Away" or "Goal! Home 2, Away 1.")
      const dashMatch = /\b(?:No Goal|Goal)\s+.+?\s+(\d+)\s*-\s*(\d+)\s+/i.exec(txt);
      if (dashMatch) {
        return { h: Number(dashMatch[1]), a: Number(dashMatch[2]) };
      }
      const commaScoreMatch = /(?:Goal!|Own Goal by[^.]+\.)\s*[^,]+?\s+(\d+)\s*,\s*[^.]+?\s+(\d+)/i.exec(txt);
      if (commaScoreMatch) {
        return { h: Number(commaScoreMatch[1]), a: Number(commaScoreMatch[2]) };
      }

      // 2. Fallback to Pulse events[] score (allow +120s window for confirmed goals whose clock.secs lags textstream)
      const windowSecs = condName === 'Gol Dinyatakan Sah' ? targetSecs + 120 : targetSecs;
      let h = 0;
      let a = 0;
      for (const ev of events) {
        if ((ev.clock?.secs ?? 0) <= windowSecs && ev.score) {
          h = ev.score.homeScore ?? h;
          a = ev.score.awayScore ?? a;
        }
      }
      return { h, a };
    };

    const formatTextstreamMinute = (label?: string): string => {
      const raw = String(label || '').trim().replace(/'$/, '');
      if (!raw) return "0'";
      const cleaned = raw.replace(/^0+([0-9])/, '$1');
      return `${cleaned}'`;
    };

    const seenVarKeys = new Set<string>();
    const seenPenAwardKeys = new Set<string>();

    // Sort chronologically so 'VAR cancelled goal' / 'contentious referee decisions' deduplicate cleanly
    const sortedTextEvents = [...textEvents].sort(
      (a, b) => (a.time?.secs ?? 0) - (b.time?.secs ?? 0)
    );

    for (let tIdx = 0; tIdx < sortedTextEvents.length; tIdx++) {
      const tv = sortedTextEvents[tIdx];
      const tvType = String(tv.type || '');
      const tvText = String(tv.text || '');
      const tvSecs = Number(tv.time?.secs ?? 0);
      const minuteStr = formatTextstreamMinute(tv.time?.label);
      const primaryPid = Array.isArray(tv.playerIds) && tv.playerIds.length > 0 ? Number(tv.playerIds[0]) : undefined;
      const resolvedPlayer = resolvePlayer(primaryPid);
      let resolvedClub = resolvedPlayer.club || inferClubFromText(tvText);
      if (tvType === 'own goal' && resolvedPlayer.club) {
        resolvedClub = resolvedPlayer.club === homeClub ? awayClub : homeClub;
      }

      // 1. Penalty Won -> LM_MATCH_PENALTY_AWARDED (Hadiah Penalti)
      if (tvType === 'penalty won') {
        const tmplPen = tmplMap.get('LM_MATCH_PENALTY_AWARDED');
        if (tmplPen) {
          const dedupKey = `${Math.floor(tvSecs / 120)}_${resolvedClub}_${primaryPid || 0}`;
          if (seenPenAwardKeys.has(dedupKey)) continue;
          seenPenAwardKeys.add(dedupKey);

          const vars = {
            minute: minuteStr,
            club: resolvedClub,
            fouled_player: resolvedPlayer.name || 'Pemain',
            fouled_player_pct: resolvedPlayer.pct,
          };
          const text = resolveConditionalBlock(tmplPen.template, 'Hadiah Penalti', vars);
          const enText = `[N:${minuteStr}] Penalty awarded to [C:${resolvedClub}] after a foul on [P:${vars.fouled_player}] ([N:${vars.fouled_player_pct}%]).`;

          stories.push({
            id: `${tmplPen.id}_pulse_${matchId}_ts_pen_${tv.id || tIdx}`,
            headline_id: text,
            headline_en: enText,
            kategori: tmplPen.category,
            sub_kategori: tmplPen.subcategory,
            drama_score: 90,
            waktu_tayang: tmplPen.gw_phase ? [tmplPen.gw_phase] : ['Live Match'],
            gw: Number(tmplPen.gw) || gw,
            teams: [homeClub, awayClub],
            players: resolvedPlayer.name ? [resolvedPlayer.name] : [],
            sumber: (tmplPen.source as any) || 'Sys',
            status_tayang: 'Y',
            keterangan_tidak_tayang: '',
            timestamp_produksi: tmplPen.timestamp || tmplPen.updated_at || new Date().toISOString(),
            pulseMatchId: matchId,
            minute: minuteStr,
            clockSecs: tvSecs,
          });
        }
        continue;
      }

      // 2. VAR Decisions -> LM_MATCH_VAR_REVIEW
      const isVarEvent =
        tvType === 'VAR cancelled goal' ||
        (tvType === 'contentious referee decisions' && /\bVAR\b/i.test(tvText)) ||
        (/\bVAR\s+(?:Decision|Review)\b/i.test(tvText) && (tvType === 'goal' || tvType === 'own goal'));

      if (!isVarEvent) continue;

      const tmplVar = tmplMap.get('LM_MATCH_VAR_REVIEW');
      if (!tmplVar) continue;

      let cond = '';
      if (
        tvType === 'VAR cancelled goal' ||
        /VAR Decision:\s*No Goal\b/i.test(tvText) ||
        /GOAL OVERTURNED BY VAR/i.test(tvText) ||
        /ruled out after a VAR review/i.test(tvText)
      ) {
        cond = 'Gol Dibatalkan';
      } else if (
        /VAR Decision:\s*No Penalty\b/i.test(tvText) ||
        /Penalty\s+(?:overturned|cancelled)/i.test(tvText)
      ) {
        cond = 'Penalti Dibatalkan';
      } else if (/VAR Decision:\s*Penalty\b/i.test(tvText)) {
        cond = 'Penalti Diberikan';
      } else if (
        /VAR Decision:\s*(?:No Red Card|Card rescinded|Red Card overturned|Card downgraded)/i.test(tvText)
      ) {
        cond = 'Kartu Merah Dibatalkan';
      } else if (
        /VAR Decision:\s*(?:Card upgraded|Red Card)\b/i.test(tvText)
      ) {
        cond = 'Kartu Merah Diberikan';
      } else if (
        /VAR Decision:\s*Goal\b/i.test(tvText) ||
        /Goal\s+(?:confirmed|awarded)\s+following\s+VAR/i.test(tvText)
      ) {
        cond = 'Gol Dinyatakan Sah';
      }

      if (!cond) continue;

      // Deduplicate paired entries (e.g. 'VAR cancelled goal' + 'VAR Decision: No Goal' at same minute/player)
      const varKey = `${cond}_${Math.floor(tvSecs / 180)}_${primaryPid || resolvedClub}`;
      if (seenVarKeys.has(varKey)) continue;
      seenVarKeys.add(varKey);

      const { h: hScore, a: aScore } = getScoreForVar(tvSecs, cond, tvText);
      let reason = 'Offside';
      if (/handball/i.test(tvText)) reason = 'Handball';
      else if (/foul/i.test(tvText)) reason = 'Pelanggaran';

      const vars = {
        minute: minuteStr,
        player: resolvedPlayer.name || 'Pemain',
        player_pct: resolvedPlayer.pct,
        club: resolvedClub,
        reason,
        home_club: homeClub,
        home_score: hScore,
        away_score: aScore,
        away_club: awayClub,
      };
      const text = resolveConditionalBlock(tmplVar.template, cond, vars);
      if (!text) continue;

      stories.push({
        id: `${tmplVar.id}_pulse_${matchId}_ts_var_${tv.id || tIdx}`,
        headline_id: text,
        headline_en: `[N:${minuteStr}] VAR review: ${cond} for [C:${resolvedClub}].`,
        kategori: tmplVar.category,
        sub_kategori: tmplVar.subcategory,
        drama_score: 95,
        waktu_tayang: tmplVar.gw_phase ? [tmplVar.gw_phase] : ['Live Match'],
        gw: Number(tmplVar.gw) || gw,
        teams: [homeClub, awayClub],
        players: resolvedPlayer.name ? [resolvedPlayer.name] : [],
        sumber: (tmplVar.source as any) || 'Sys',
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
        timestamp_produksi: tmplVar.timestamp || tmplVar.updated_at || new Date().toISOString(),
        pulseMatchId: matchId,
        minute: minuteStr,
        clockSecs: tvSecs,
      });
    }
  }

  return stories;
}

/**
 * Generates live match FPL statistical stories (`LM_MATCH_SAVES_GOALKEEPER` and `LM_MATCH_DEFENSIVE_CONTRIBUTION`)
 * from MatchCardItem data (cached or provided).
 */
export function generateLiveMatchStatStories(
  targetGw?: number,
  options?: { includeFinished?: boolean; matchesOverride?: MatchCardItem[] }
): LiveMatchStory[] {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];

  const matches = options?.matchesOverride ?? getCachedMatchesForGw(gw) ?? [];
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const includeFinished = Boolean(options?.includeFinished);
  const templates = getPhase1Templates();
  const tmplSaves = templates.find((t) => t.id === 'LM_MATCH_SAVES_GOALKEEPER');
  const tmplDefcon = templates.find((t) => t.id === 'LM_MATCH_DEFENSIVE_CONTRIBUTION');
  if (!tmplSaves && !tmplDefcon) return [];

  const { playersById } = getFplPlayerDirectory(gw);
  const stories: LiveMatchStory[] = [];
  const nowIso = new Date().toISOString();

  for (const m of matches) {
    const isEligibleMatch = m.started && (includeFinished || (!m.finished && !m.finished_provisional));
    if (!isEligibleMatch) continue;

    const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
    const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
    if (!homeClub || !awayClub) continue;
    const minuteStr = m.clock_label || (m.minutes ? `${m.minutes}'` : 'Live');
    const clockSecs = (m.minutes || 0) * 60;

    const processTeamPlayers = (players: MatchPlayerItem[], clubName: string, opponentName: string) => {
      const seenIds = new Set<number>();
      for (const p of players) {
        if (!p || !p.id || seenIds.has(p.id)) continue;
        seenIds.add(p.id);

        const mins = p.stats?.minutes || 0;
        if (mins <= 0) continue;

        const dirPlayer = playersById.get(p.id);
        const playerPct = dirPlayer?.ownershipPct ?? 0;
        const playerName = dirPlayer?.webName || p.web_name;
        if (!playerName) continue;

        // 1. LM_MATCH_SAVES_GOALKEEPER (Goalkeeper saves >= 3 -> +1 pt per 3 saves)
        if (tmplSaves && p.position === 'GKP') {
          const saves = Number(p.stats?.saves || 0);
          if (saves >= 3) {
            const savesPts = Math.floor(saves / 3);
            const vars = {
              club: clubName,
              player: playerName,
              player_pct: playerPct,
              saves,
              saves_pts: savesPts,
              opponent: opponentName,
            };
            const headlineId = fillPlaceholders(tmplSaves.template, vars);
            const headlineEn = `Goalkeeper [P:${playerName}] ([N:${playerPct}%]) made [N:${saves} Saves] for [C:${clubName}] against [C:${opponentName}], earning [N:+${savesPts} Pts].`;
            stories.push({
              id: `${tmplSaves.id}_m${m.id}_p${p.id}`,
              headline_id: headlineId,
              headline_en: headlineEn,
              kategori: tmplSaves.category,
              sub_kategori: tmplSaves.subcategory,
              drama_score: Math.min(93, 80 + savesPts * 4),
              waktu_tayang: ['Live Match'],
              gw: Number(tmplSaves.gw) || gw,
              teams: [homeClub, awayClub],
              players: [playerName],
              sumber: (tmplSaves.source as any) || 'Sys',
              status_tayang: 'Y',
              keterangan_tidak_tayang: '',
              timestamp_produksi: tmplSaves.timestamp || tmplSaves.updated_at || nowIso,
              pulseMatchId: m.id,
              minute: minuteStr,
              clockSecs,
            });
          }
        }

        // 2. LM_MATCH_DEFENSIVE_CONTRIBUTION (DEF >= 10 CBIT, MID/FWD >= 12 CBIRT -> +2 pts)
        if (tmplDefcon) {
          const dc = Number(p.stats?.defensive_contribution || 0);
          const isEligible =
            (p.position === 'DEF' && dc >= 10) ||
            ((p.position === 'MID' || p.position === 'FWD') && dc >= 12);

          if (isEligible) {
            const vars = {
              player: playerName,
              player_pct: playerPct,
              dc_count: dc,
              club: clubName,
              opponent: opponentName,
            };
            const headlineId = fillPlaceholders(tmplDefcon.template, vars);
            const headlineEn = `[P:${playerName}] ([N:${playerPct}%]) has recorded [N:${dc} Defensive Actions] for [C:${clubName}] against [C:${opponentName}], securing [N:+2 Pts] Defensive Contribution.`;
            stories.push({
              id: `${tmplDefcon.id}_m${m.id}_p${p.id}`,
              headline_id: headlineId,
              headline_en: headlineEn,
              kategori: tmplDefcon.category,
              sub_kategori: tmplDefcon.subcategory,
              drama_score: Math.min(92, 82 + Math.floor(dc / 2)),
              waktu_tayang: ['Live Match'],
              gw: Number(tmplDefcon.gw) || gw,
              teams: [homeClub, awayClub],
              players: [playerName],
              sumber: (tmplDefcon.source as any) || 'Sys',
              status_tayang: 'Y',
              keterangan_tidak_tayang: '',
              timestamp_produksi: tmplDefcon.timestamp || tmplDefcon.updated_at || nowIso,
              pulseMatchId: m.id,
              minute: minuteStr,
              clockSecs,
            });
          }
        }
      }
    };

    const homePlayers = [...(m.home_lineup || []), ...(m.home_bench || [])];
    const awayPlayers = [...(m.away_lineup || []), ...(m.away_bench || [])];
    processTeamPlayers(homePlayers, homeClub, awayClub);
    processTeamPlayers(awayPlayers, awayClub, homeClub);
  }

  return stories;
}

/**
 * Async wrapper that ensures matches for the target GW are loaded before generating stat stories.
 */
export async function fetchAndGenerateLiveMatchStatStories(
  targetGw?: number,
  includeFinished = false
): Promise<LiveMatchStory[]> {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];
  try {
    let matches = getCachedMatchesForGw(gw);
    if (!matches || matches.length === 0) {
      matches = await fetchMatchesForGw(gw);
    }
    return generateLiveMatchStatStories(gw, {
      includeFinished,
      matchesOverride: matches || undefined,
    });
  } catch (err: any) {
    console.warn('[Pulse Match Generator] Error fetching live match stat stories:', err.message);
    return [];
  }
}

/**
 * Generates live match team rank shift stories (`LM_STANDINGS_RANK_MOVEMENT`)
 * from provisional/live standings while matches are in progress.
 */
export function generateLiveTeamRankShiftStories(
  targetGw?: number,
  options?: { requireLiveMatch?: boolean; matchesOverride?: MatchCardItem[] }
): LiveMatchStory[] {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];
  const templates = getPhase1Templates();
  const tmpl = templates.find((t) => t.id === 'LM_STANDINGS_RANK_MOVEMENT');
  if (!tmpl) return [];

  if (options?.requireLiveMatch !== false) {
    const matches = options?.matchesOverride ?? getCachedMatchesForGw(gw) ?? [];
    const hasLiveMatch = matches.some((m) => m.started && !m.finished && !m.finished_provisional);
    if (!hasLiveMatch) return [];
  }

  const standings = getDbStandings(gw);
  if (!Array.isArray(standings) || standings.length === 0) return [];

  const movers = standings
    .filter((s) => Math.abs(s.rank_change || 0) >= 1 || s.rank <= 3)
    .slice(0, 30);

  const nowIso = new Date().toISOString();
  const stories: LiveMatchStory[] = [];

  for (const team of movers) {
    const rankChange = Number(team.rank_change || 0);
    const currentRank = Number(team.rank || 0);
    const lastRank = Number(team.last_rank || currentRank);
    const gwPts = Number(team.event_points || 0);
    const totalPts = Number(team.total_points || 0);
    const rankDiff = Math.abs(rankChange);

    let cond = 'Bertahan Peringkat';
    let headlineEn = `[T:${team.entry_name}] held rank [N:${currentRank}] on the live table with [N:${gwPts} Pts].`;
    if (rankChange > 0) {
      cond = 'Naik Peringkat';
      headlineEn = `[T:${team.entry_name}] climbed [N:+${rankDiff} Places] from rank [N:${lastRank}] to [N:${currentRank}] on the live table with [N:${gwPts} Pts].`;
    } else if (rankChange < 0) {
      cond = 'Turun Peringkat';
      headlineEn = `[T:${team.entry_name}] dropped [N:-${rankDiff} Places] from rank [N:${lastRank}] to [N:${currentRank}] on the live table with [N:${gwPts} Pts].`;
    }

    const headlineId = resolveConditionalBlock(tmpl.template, cond, {
      team: team.entry_name,
      gw_pts: gwPts,
      gw,
      rank_diff: rankDiff,
      old_rank: lastRank,
      new_rank: currentRank,
      total_pts: totalPts,
    });

    stories.push({
      id: `${tmpl.id}_${team.entry_id}_gw${gw}`,
      headline_id: headlineId,
      headline_en: headlineEn,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: rankDiff >= 5 ? 90 : currentRank <= 3 ? 89 : 84,
      waktu_tayang: ['Live Match'],
      gw: Number(tmpl.gw) || gw,
      teams: [team.entry_name],
      players: [],
      sumber: (tmpl.source as any) || 'Sys',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: tmpl.timestamp || tmpl.updated_at || nowIso,
    });
  }

  return stories;
}

/**
 * Generates ongoing live match score snapshot stories (`LM_MATCH_SCORE_LIVE`)
 * for matches currently in progress (including 0-0 and Half Time states).
 */
export function generateLiveMatchScoreStories(
  targetGw?: number,
  options?: { includeFinished?: boolean; matchesOverride?: MatchCardItem[] }
): LiveMatchStory[] {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];
  const templates = getPhase1Templates();
  const tmpl = templates.find((t) => t.id === 'LM_MATCH_SCORE_LIVE');
  if (!tmpl) return [];

  const matches = options?.matchesOverride ?? getCachedMatchesForGw(gw) ?? [];
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const includeFinished = Boolean(options?.includeFinished);
  const { playersById } = getFplPlayerDirectory(gw);
  const nowIso = new Date().toISOString();
  const stories: LiveMatchStory[] = [];

  for (const m of matches) {
    const isEligible = m.started && (includeFinished || (!m.finished && !m.finished_provisional));
    if (!isEligible) continue;

    const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
    const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
    if (!homeClub || !awayClub) continue;
    const homeScore = m.team_h_score ?? 0;
    const awayScore = m.team_a_score ?? 0;
    const totalGoals = homeScore + awayScore;
    const minuteStr = m.clock_label || (m.minutes ? `${m.minutes}'` : 'Live');
    const isHT = Boolean(
      m.is_half_time ||
        minuteStr.toLowerCase().includes('half') ||
        minuteStr.toLowerCase() === 'ht'
    );

    const allPlayers = [
      ...(m.home_lineup || []),
      ...(m.home_bench || []),
      ...(m.away_lineup || []),
      ...(m.away_bench || []),
    ];

    const seenScorerIds = new Set<number>();
    const scorerItemsId: string[] = [];
    const scorerItemsEn: string[] = [];
    const scorerNames: string[] = [];

    for (const p of allPlayers) {
      if (!p || !p.id || seenScorerIds.has(p.id)) continue;
      const goals = Number(p.stats?.goals_scored || 0);
      const ownGoals = Number(p.stats?.own_goals || 0);
      if (goals <= 0 && ownGoals <= 0) continue;
      seenScorerIds.add(p.id);

      const dirPlayer = playersById.get(p.id);
      const name = dirPlayer?.webName || p.web_name;
      if (!name) continue;
      const pct = dirPlayer?.ownershipPct ?? 0;
      scorerNames.push(name);

      if (goals > 0) {
        const suffixId = goals > 1 ? ` [N:(${goals} Gol)]` : '';
        const suffixEn = goals > 1 ? ` [N:(${goals} Goals)]` : '';
        scorerItemsId.push(`[P:${name}] ([N:${pct}%])${suffixId}`);
        scorerItemsEn.push(`[P:${name}] ([N:${pct}%])${suffixEn}`);
      } else if (ownGoals > 0) {
        scorerItemsId.push(`[P:${name}] ([N:${pct}%]) [N:(GBD)]`);
        scorerItemsEn.push(`[P:${name}] ([N:${pct}%]) [N:(OG)]`);
      }
    }

    const joinHuman = (items: string[], conj: string): string => {
      if (items.length === 0) return '';
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
      return `${items.slice(0, -1).join(', ')}, ${conj} ${items[items.length - 1]}`;
    };

    const scorersListId = joinHuman(scorerItemsId, 'dan');
    const scorersListEn = joinHuman(scorerItemsEn, 'and');

    const hasScorers = totalGoals > 0 && Boolean(scorersListId);
    let cond = 'Skor 0-0 Berjalan';
    let headlineEn = `[C:${homeClub}] vs [C:${awayClub}] is underway at minute [N:${minuteStr}] with the score at [N:0 - 0].`;

    if (isHT) {
      if (hasScorers) {
        cond = 'Dengan Gol Half Time';
        headlineEn = `[C:${homeClub}] vs [C:${awayClub}] reaches Half Time with the score at [N:${homeScore} - ${awayScore}], goals scored by ${scorersListEn}.`;
      } else {
        cond = 'Skor 0-0 Half Time';
        headlineEn = `[C:${homeClub}] vs [C:${awayClub}] reaches Half Time with the score at [N:0 - 0].`;
      }
    } else if (hasScorers) {
      cond = 'Dengan Gol Berjalan';
      headlineEn = `[C:${homeClub}] vs [C:${awayClub}] is underway at minute [N:${minuteStr}] with the score at [N:${homeScore} - ${awayScore}], goals scored by ${scorersListEn}.`;
    }

    const headlineId = resolveConditionalBlock(tmpl.template, cond, {
      home_club: homeClub,
      away_club: awayClub,
      minute: minuteStr,
      home_score: homeScore,
      away_score: awayScore,
      scorers_list: scorersListId,
    });

    stories.push({
      id: `${tmpl.id}_m${m.id}`,
      headline_id: headlineId,
      headline_en: headlineEn,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: totalGoals >= 3 ? 91 : totalGoals > 0 ? 87 : 78,
      waktu_tayang: ['Live Match'],
      gw: Number(tmpl.gw) || gw,
      teams: [homeClub, awayClub],
      players: scorerNames,
      sumber: (tmpl.source as any) || 'Sys',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: tmpl.timestamp || tmpl.updated_at || nowIso,
      pulseMatchId: m.id,
      minute: minuteStr,
      clockSecs: (m.minutes || 0) * 60,
    });
  }

  return stories;
}

/**
 * Generates live surprise lineup stories (`LM_LINEUP_SURPRISE_BENCHED`)
 * from cached MatchCardItem data for live matches with official lineups.
 */
export function generateLiveLineupSurpriseStories(
  targetGw?: number,
  options?: { includeFinished?: boolean; matchesOverride?: MatchCardItem[] }
): LiveMatchStory[] {
  const gw = targetGw || Number(getOptimalDatabase()?.meta?.current_gw) || 0;
  if (!gw) return [];
  const templates = getPhase1Templates();
  const tmpl = templates.find((t) => t.id === 'LM_LINEUP_SURPRISE_BENCHED');
  if (!tmpl) return [];

  const matches = options?.matchesOverride ?? getCachedMatchesForGw(gw) ?? [];
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const includeFinished = Boolean(options?.includeFinished);
  const { allPlayers } = getFplPlayerDirectory(gw);
  const nowIso = new Date().toISOString();
  const stories: LiveMatchStory[] = [];

  for (const m of matches) {
    const isEligible = m.started && (includeFinished || (!m.finished && !m.finished_provisional));
    if (!isEligible || !m.has_lineup) continue;
    if ((m.home_lineup?.length || 0) < 10 || (m.away_lineup?.length || 0) < 10) continue;

    const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
    const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
    if (!homeClub || !awayClub) continue;

    const sides = [
      { club: homeClub, opponent: awayClub, lineup: m.home_lineup, bench: m.home_bench },
      { club: awayClub, opponent: homeClub, lineup: m.away_lineup, bench: m.away_bench },
    ];

    for (const side of sides) {
      const starterFplIds = new Set<number>(side.lineup.filter((p) => p.id > 0).map((p) => p.id));
      const benchFplIds = new Set<number>(side.bench.filter((p) => p.id > 0).map((p) => p.id));
      const starterNamesNorm = new Set<string>(side.lineup.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));
      const benchNamesNorm = new Set<string>(side.bench.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));

      const surprise = detectSurpriseLineupForClub(
        side.club,
        side.opponent,
        starterFplIds,
        benchFplIds,
        side.lineup.length,
        allPlayers,
        starterNamesNorm,
        benchNamesNorm
      );
      if (!surprise) continue;

      const cond = surprise.isBenched ? 'Dicadangkan' : 'Absen dari Skuad';
      const headlineId = resolveConditionalBlock(tmpl.template, cond, {
        club: surprise.club,
        player: surprise.player.webName,
        starter_pct: surprise.player.starterPct,
        opponent: surprise.opponent,
      });
      const headlineEn = surprise.isBenched
        ? `[N:0'] [C:${surprise.club}] benches [P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) against [C:${surprise.opponent}].`
        : `[N:0'] [P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) misses out from [C:${surprise.club}]'s matchday squad against [C:${surprise.opponent}].`;

      const clubSlug = surprise.club.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const playerSlug = surprise.player.webName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      stories.push({
        id: `${tmpl.id}_${clubSlug}_${playerSlug}`,
        headline_id: headlineId,
        headline_en: headlineEn,
        kategori: tmpl.category,
        sub_kategori: tmpl.subcategory,
        drama_score: Math.min(93, 82 + Math.floor(surprise.player.starterPct / 10)),
        waktu_tayang: ['Live Match'],
        gw: Number(tmpl.gw) || gw,
        teams: [homeClub, awayClub],
        players: [surprise.player.webName],
        sumber: (tmpl.source as any) || 'Sys',
        status_tayang: 'Y',
        keterangan_tidak_tayang: '',
        timestamp_produksi: tmpl.timestamp || tmpl.updated_at || nowIso,
        pulseMatchId: m.id,
        minute: "0'",
        clockSecs: 0,
      });
    }
  }

  return stories;
}




