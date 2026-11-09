import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';

const DB_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');
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
  sumber: 'Bukan';
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
  position: string;
  ownershipPct: number;
  ownersCount: number;
}

/**
 * Normalizes strings by removing diacritics, accents, and non-alphanumeric characters.
 */
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
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Loads the FPL player database and ownership data for the target gameweek.
 */
export function getFplPlayerDirectory(gw = 10): {
  playersById: Map<number, FplPlayerLookup>;
  allPlayers: FplPlayerLookup[];
} {
  const playersById = new Map<number, FplPlayerLookup>();
  const allPlayers: FplPlayerLookup[] = [];

  try {
    if (!fs.existsSync(DB_PATH)) return { playersById, allPlayers };
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);

    const snapshot = db.gw_snapshots?.[String(gw)] || db.gw_snapshots?.[gw];
    const ownershipMap = new Map<number, { pct: number; count: number }>();

    if (snapshot && Array.isArray(snapshot.ownership_players)) {
      for (const op of snapshot.ownership_players) {
        if (op && op.id) {
          ownershipMap.set(op.id, {
            pct: typeof op.owned_percentage === 'number' ? Math.round(op.owned_percentage) : 0,
            count: Number(op.owned_count) || 0,
          });
        }
      }
    }

    if (db.players && typeof db.players === 'object') {
      for (const [idStr, p] of Object.entries(db.players as Record<string, any>)) {
        const id = Number(p.id) || Number(idStr);
        const own = ownershipMap.get(id);
        const entry: FplPlayerLookup = {
          id,
          webName: p.webName || p.web_name || 'Player',
          fullName: p.fullName || p.full_name || p.webName || 'Player',
          teamShort: p.teamShort || p.team_short_name || '',
          position: p.position || 'MID',
          ownershipPct: own?.pct ?? 0,
          ownersCount: own?.count ?? 0,
        };
        playersById.set(id, entry);
        allPlayers.push(entry);
      }
    }
  } catch (err: any) {
    console.warn('[Live Match Generator] Error loading FPL player directory:', err.message);
  }

  return { playersById, allPlayers };
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

  const matched = sections.find(s => s.header.toLowerCase() === conditionName.toLowerCase());
  const body = matched ? matched.lines.join('\n') : (sections[0]?.lines.join('\n') || template);
  return fillPlaceholders(body, vars);
}

/**
 * Fetches match data from Pulse API by match ID, with disk cache fallback.
 */
export async function fetchPulseMatch(matchId: number): Promise<any | null> {
  const localCachePath = path.join(process.cwd(), `src/data/pulse_match_${matchId}.json`);
  if (fs.existsSync(localCachePath)) {
    try {
      const cached = fs.readFileSync(localCachePath, 'utf-8');
      const parsed = JSON.parse(cached);
      if (parsed && parsed.id) return parsed;
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
 */
export async function getAllLiveMatchStories(gw = 10): Promise<LiveMatchStory[]> {
  try {
    const pulseData = await fetchPulseMatch(129021);
    if (!pulseData) return [];
    return generateStoriesFromPulseMatch(pulseData, gw);
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
  gw = 10
): LiveMatchStory[] {
  if (!pulseData) return [];

  const templates = getPhase1Templates();
  const tmplMap = new Map<string, Phase1TemplateItem>();
  for (const t of templates) {
    tmplMap.set(t.id, t);
  }

  const { allPlayers } = getFplPlayerDirectory(gw);

  const homeTeamRaw = pulseData.teams?.[0]?.team;
  const awayTeamRaw = pulseData.teams?.[1]?.team;
  const homeClub = homeTeamRaw?.name || 'Home Club';
  const awayClub = awayTeamRaw?.name || 'Away Club';
  const homeShort = homeTeamRaw?.club?.abbr || homeTeamRaw?.shortName || 'HOM';
  const awayShort = awayTeamRaw?.club?.abbr || awayTeamRaw?.shortName || 'AWY';

  const venueName = pulseData.ground?.name || 'The City Ground';

  // Build person directory from teamLists
  const pulsePersons = new Map<number, { person: any; teamName: string; teamShort: string; teamId: number }>();
  if (Array.isArray(pulseData.teamLists)) {
    for (const tl of pulseData.teamLists) {
      const isHome = tl.teamId === homeTeamRaw?.id;
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
      return { name: 'Player', pct: 0, club: '', fpl: null };
    }
    const pInfo = pulsePersons.get(personId);
    const matchedFpl = matchPulsePersonToFpl(pInfo?.person, allPlayers, pInfo?.teamShort);
    if (matchedFpl) {
      return {
        name: matchedFpl.webName,
        pct: matchedFpl.ownershipPct,
        club: pInfo?.teamName || matchedFpl.teamShort,
        fpl: matchedFpl,
      };
    }
    const fallbackName = pInfo?.person?.name?.display || pInfo?.person?.name?.last || 'Player';
    return {
      name: fallbackName,
      pct: 0,
      club: pInfo?.teamName || '',
      fpl: null,
    };
  };

  const stories: LiveMatchStory[] = [];
  const events = Array.isArray(pulseData.events) ? pulseData.events : [];
  const matchId = pulseData.id || 129021;

  // Track scorers for Full Time summary
  const allScorersList: Array<{ name: string; pct: number; count: number }> = [];

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
      id: storyId,
      headline_id: headlineId,
      headline_en: headlineEn,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: dramaScore,
      waktu_tayang: tmpl.gw_phase ? [tmpl.gw_phase] : ['Live Match'],
      gw,
      teams,
      players,
      sumber: 'Bukan',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: new Date().toISOString(),
      pulseMatchId: matchId,
      minute: minuteStr,
      clockSecs,
    });

    // A. Period Start (PS)
    if (ev.type === 'PS') {
      const tmpl = tmplMap.get('LM_PERIOD_START');
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
      const tmpl = tmplMap.get('LM_PERIOD_END');
      if (tmpl) {
        const isFt = ev.phase === '2' || ev.phase === '2H' || (ev.clock?.secs && ev.clock.secs >= 5400);
        const cond = isFt ? 'Full Time' : 'Half Time';
        
        // Format scorers string for FT
        let scorersStr = '';
        if (allScorersList.length > 0) {
          scorersStr = allScorersList.map(s => {
            const countSuffix = s.count > 1 ? ` [N:(${s.count} Gol)]` : '';
            return `[P:${s.name}] ([N:${s.pct}%])${countSuffix}`;
          }).join(', ');
        } else {
          scorersStr = 'Tidak ada';
        }

        const vars = {
          minute: minuteStr,
          venue: venueName,
          home_club: homeClub,
          away_club: awayClub,
          home_score: homeScore,
          away_score: awayScore,
          goalscorers_list: scorersStr,
        };
        const text = resolveConditionalBlock(tmpl.template, cond, vars);
        const headlineEn = isFt
          ? `[N:${minuteStr}] Full time at [N:${venueName}]. [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}]. Goalscorers: ${scorersStr}.`
          : `[N:${minuteStr}] Half time at [N:${venueName}]. [C:${homeClub}] [N:${homeScore}] - [N:${awayScore}] [C:${awayClub}].`;

        stories.push(
          createLiveStory(
            tmpl,
            `pulse_${matchId}_pe_${ev.phase || idx}`,
            text,
            headlineEn,
            92,
            [homeClub, awayClub],
            [],
            ev.clock?.secs ?? 5400
          )
        );
      }
    }

    // C. Goal (G / PG / OG)
    else if (ev.type === 'G') {
      const isPenalty = ev.description === 'PG' || ev.subType === 'PENALTY_GOAL';
      const isOwnGoal = ev.description === 'OG' || ev.subType === 'OWN_GOAL';

      if (isPenalty) {
        const tmpl = tmplMap.get('LM_GOAL_PENALTY');
        if (tmpl) {
          const scorer = resolvePlayer(ev.personId);
          // Track scorer
          const existingScorer = allScorersList.find(s => s.name === scorer.name);
          if (existingScorer) existingScorer.count++;
          else allScorersList.push({ name: scorer.name, pct: scorer.pct, count: 1 });

          const vars = {
            player: scorer.name,
            player_pct: scorer.pct,
            club: scorer.club || eventTeamName,
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
        const tmpl = tmplMap.get('LM_OWN_GOAL');
        if (tmpl) {
          const scorer = resolvePlayer(ev.personId);
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
        const tmpl = tmplMap.get('LM_GOAL_OPEN_PLAY');
        if (tmpl) {
          const scorer = resolvePlayer(ev.personId);
          const hasAssist = Boolean(ev.assistId);
          const assister = hasAssist ? resolvePlayer(ev.assistId) : null;
          const cond = hasAssist ? 'Dengan Assist' : 'Tanpa Assist';

          // Track scorer
          const existingScorer = allScorersList.find(s => s.name === scorer.name);
          if (existingScorer) existingScorer.count++;
          else allScorersList.push({ name: scorer.name, pct: scorer.pct, count: 1 });

          const vars = {
            club: scorer.club || eventTeamName,
            scorer: scorer.name,
            scorer_pct: scorer.pct,
            assister: assister ? assister.name : '',
            assister_pct: assister ? assister.pct : 0,
            minute: minuteStr,
            home_club: homeClub,
            home_score: homeScore,
            away_score: awayScore,
            away_club: awayClub,
          };
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
    }

    // D. Disciplinary: Yellow Card (B), Second Yellow (SY), Straight Red (R)
    else if (ev.type === 'B') {
      const tmpl = tmplMap.get('LM_BOOKING_YELLOW');
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
      const tmpl = tmplMap.get('LM_CARD_SECOND_YELLOW');
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
      const tmpl = tmplMap.get('LM_CARD_RED_STRAIGHT');
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

      const tmpl = tmplMap.get('LM_SUBSTITUTION');
      if (tmpl) {
        const isDefenderOrGk = playerOut.fpl?.position === 'DEF' || playerOut.fpl?.position === 'GKP';
        const mins = parseInt(minuteStr.replace(/\D/g, ''), 10) || 0;
        const isCleanSheetLocked = isDefenderOrGk && mins >= 60;

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
      const tmpl = tmplMap.get('LM_VAR_REVIEW');
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

  return stories;
}
