import { getNewsTemplates, NewsTemplateItem } from '../data/newsTemplates.ts';
import { getFplDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { buildMatchdaySnapshotPayload } from './matchdaySnapshotBuilder.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import { loadPulseMatchesForGw } from './pulseMatchSync.ts';
import { findValidBetweenMatchAutosubWatches } from './fplAutosub.ts';
import {
  getFplPlayerDirectory,
  matchPulsePersonToFpl,
  detectSurpriseLineupsForClub,
  normalizeDiacritics,
  buildMatchKey,
  getPulseUpcomingLineupSides,
} from './liveMatchStoryGenerator.ts';
import {
  formatInjuryDescription,
  getHistoricalMostGwLeaders,
  getTopDifferingStarters,
} from './notStartedStoryGenerator.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import { scheduleStoriesIntoWaves } from './waveCycleScheduler.ts';

export interface GeneratedPhaseStory {
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
  poin_tayang?: number;
  timestamp_produksi?: string;
  cycle_meta?: {
    chance?: number;
    ownersCount?: number;
    cost?: number;
    specialRank?: number;
  };
}

interface EmittedStoryDraft {
  id: string;
  headlineId: string;
  headlineEn: string;
  dramaScore?: number;
}

function toStorySlug(val: string): string {
  return (val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';
}

function extractTagNames(text: string, type: 'T' | 'P'): string[] {
  const regex = new RegExp(`\\[${type}:([^\\]]+)\\]`, 'g');
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (!result.includes(m[1].trim())) {
      result.push(m[1].trim());
    }
  }
  return result;
}

function renderTemplate(rawTemplate: string, variables: Record<string, string | number>): string {
  if (!rawTemplate) return '';
  let result = rawTemplate;
  for (const [k, v] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

function renderTemplateBranch(
  rawTemplate: string,
  conditionKeyword: string,
  variables: Record<string, string | number>
): string {
  if (!rawTemplate) return '';

  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(rawTemplate);
  let targetBody = rawTemplate;

  if (hasConditions) {
    const lines = rawTemplate.split('\n');
    const matchingSection: string[] = [];
    let isCurrentMatch = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
      if (match) {
        const condName = match[1].toLowerCase();
        isCurrentMatch = condName.includes(conditionKeyword.toLowerCase());
      } else if (isCurrentMatch && line) {
        matchingSection.push(rawLine);
      }
    }

    if (matchingSection.length > 0) {
      targetBody = matchingSection.join('\n');
    } else {
      return '';
    }
  }

  return renderTemplate(targetBody, variables);
}

function formatWibTime(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const utcHours = d.getUTCHours();
    const utcMinutes = d.getUTCMinutes();
    const wibHours = (utcHours + 7) % 24;
    return `${String(wibHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')} WIB`;
  } catch {
    return '';
  }
}

function formatWibDay(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }) || '';
  } catch {
    return '';
  }
}

function isSameUkDate(isoA?: string, isoB?: string): boolean {
  if (!isoA || !isoB) return false;
  try {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    return fmt(isoA) === fmt(isoB);
  } catch {
    return false;
  }
}

interface IndexedPlayerGwStat {
  id: number;
  name: string;
  club: string;
  position: string;
  ownershipPct: number;
  ownersCount: number;
  minutes: number;
  points: number;
  goals: number;
  assists: number;
  bps: number;
  bonus: number;
  status: string;
  newsAdded: string;
}

function loadBetweenMatchContext(targetGw?: number) {
  const dbData = getFplDatabase();
  const currentGw = targetGw || Number(dbData?.meta?.current_gw) || 0;
  const standings = currentGw ? getDbStandings(currentGw) : [];
  const snap = currentGw ? getGwSnapshot(currentGw) : null;
  const rawPayload = currentGw ? buildMatchdaySnapshotPayload(currentGw) : null;

  const dbPlayersArr: any[] = Object.values(dbData?.players || {});
  const deadlines: Record<string, string> = (dbData?.meta?.deadlines as Record<string, string>) || {};
  const ownershipList: any[] = Array.isArray(snap?.ownership_players) ? snap.ownership_players : [];

  const ownershipById = new Map<number, { pct: number; count: number }>();
  for (const op of ownershipList) {
    if (op?.id) {
      ownershipById.set(op.id, {
        pct: Math.round(Number(op.owned_percentage ?? op.ownership ?? 0)),
        count: Number(op.owned_count ?? 0),
      });
    }
  }

  const totalTeams = standings.length || Number(dbData?.meta?.total_teams) || 0;
  const playerMap = new Map<number, IndexedPlayerGwStat>();

  for (const p of dbPlayersArr) {
    const h = (p.gwHistory || []).find((x: any) => Number(x.round) === currentGw);
    const name = p.webName || p.web_name;
    const club = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name);
    if (!p?.id || !name || !club) continue;

    const ownFromList = ownershipById.get(p.id);
    const ownersCount = ownFromList?.count ?? (p.league_ownership?.count || 0);
    const ownershipPct = ownFromList?.pct ?? (totalTeams > 0 ? Math.round((ownersCount / totalTeams) * 100) : 0);
    playerMap.set(p.id, {
      id: p.id,
      name,
      club,
      position: p.position || 'MID',
      ownershipPct,
      ownersCount,
      minutes: h?.minutes || 0,
      points: h?.points || 0,
      goals: h?.goalsScored ?? h?.goals ?? 0,
      assists: h?.assists || 0,
      bps: h?.bps || 0,
      bonus: h?.bonus || 0,
      status: p.status || 'a',
      newsAdded: p.newsAdded || '',
    });
  }

  const fixtures = (dbData?.meta?.sync_status?.gw_fixtures || []).filter(
    (f: any) => Number(f.event) === currentGw
  );

  return {
    currentGw,
    dbData,
    standings,
    snap,
    rawPayload,
    playerMap,
    ownershipList,
    fixtures,
    deadlines,
  };
}

function finalizeBetweenMatchStories(
  tmpl: NewsTemplateItem,
  produced: EmittedStoryDraft[],
  gw: number,
  nowIso: string
): GeneratedPhaseStory[] {
  const out: GeneratedPhaseStory[] = [];
  produced.forEach((item, idx) => {
    if (!item.headlineId) return;
    out.push({
      id: item.id,
      headline_id: item.headlineId,
      headline_en: item.headlineEn || item.headlineId,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: item.dramaScore ?? 86,
      waktu_tayang: ['Between Match'],
      gw,
      teams: extractTagNames(item.headlineId, 'T'),
      players: extractTagNames(item.headlineId, 'P'),
      sumber: 'Sys',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: nowIso,
      cycle_meta: {
        specialRank: idx,
      },
    });
  });
  return out;
}

/**
 * Generates real factual stories for all 15 Between Match templates (BM_*)
 */
export function generateBetweenMatchStories(targetGw?: number): GeneratedPhaseStory[] {
  const templates = getNewsTemplates().filter(
    (t) => (t.gw_phase || '').trim().toLowerCase() === 'between match'
  );
  if (templates.length === 0) return [];

  const ctx = loadBetweenMatchContext(targetGw);
  const { currentGw, dbData, standings, snap, rawPayload, playerMap, ownershipList, fixtures, deadlines } = ctx;
  if (!currentGw) return [];
  const nowIso = new Date().toISOString();
  const stories: GeneratedPhaseStory[] = [];

  const allCachedMatches = getCachedMatchesForGw(currentGw) || [];
  const cachedMatches = allCachedMatches.filter(
    (m) => m.finished || m.finished_provisional || m.phase === 'FT'
  );

  // Overlay fresh live match-card states & player stats onto DB fixtures / playerMap
  // so LM -> BM transitions work immediately even before a full Action B league sync completes.
  const cachedByFixId = new Map<number, (typeof allCachedMatches)[number]>();
  const cachedByClubs = new Map<string, (typeof allCachedMatches)[number]>();
  for (const m of allCachedMatches) {
    if (m.id) cachedByFixId.set(Number(m.id), m);
    const hc = resolveClubName(m.home_team?.name || m.home_team?.short_name, '');
    const ac = resolveClubName(m.away_team?.name || m.away_team?.short_name, '');
    if (hc && ac) cachedByClubs.set(`${hc}__${ac}`, m);
  }

  const effectiveFixtures: any[] = [];
  const seenFixKeys = new Set<string>();
  for (const f of fixtures) {
    const hClub = resolveClubName(f.home_team, '');
    const aClub = resolveClubName(f.away_team, '');
    const cm = (f.id ? cachedByFixId.get(Number(f.id)) : undefined) || (hClub && aClub ? cachedByClubs.get(`${hClub}__${aClub}`) : undefined);
    if (cm) {
      const isCmFinished = Boolean(cm.finished || cm.finished_provisional || cm.phase === 'FT');
      effectiveFixtures.push({
        ...f,
        started: Boolean(cm.started || isCmFinished || f.started),
        finished: Boolean(cm.finished || f.finished),
        finished_provisional: Boolean(cm.finished_provisional || isCmFinished || f.finished_provisional),
        minutes: isCmFinished ? Math.max(Number(cm.minutes) || 0, 90) : (cm.minutes ?? f.minutes ?? 0),
        team_h_score: cm.team_h_score ?? f.team_h_score,
        team_a_score: cm.team_a_score ?? f.team_a_score,
        kickoff_time: cm.kickoff_time || f.kickoff_time,
      });
    } else {
      effectiveFixtures.push(f);
    }
    if (hClub && aClub) seenFixKeys.add(`${hClub}__${aClub}`);
  }
  for (const m of allCachedMatches) {
    const hc = resolveClubName(m.home_team?.name || m.home_team?.short_name, '');
    const ac = resolveClubName(m.away_team?.name || m.away_team?.short_name, '');
    if (!hc || !ac || seenFixKeys.has(`${hc}__${ac}`)) continue;
    const isCmFinished = Boolean(m.finished || m.finished_provisional || m.phase === 'FT');
    effectiveFixtures.push({
      id: m.id,
      event: currentGw,
      home_team: hc,
      away_team: ac,
      started: Boolean(m.started || isCmFinished),
      finished: Boolean(m.finished),
      finished_provisional: Boolean(m.finished_provisional || isCmFinished),
      minutes: isCmFinished ? Math.max(Number(m.minutes) || 0, 90) : (m.minutes || 0),
      team_h_score: m.team_h_score ?? 0,
      team_a_score: m.team_a_score ?? 0,
      kickoff_time: m.kickoff_time || '',
    });
  }

  for (const m of allCachedMatches) {
    const isCmFinished = Boolean(m.finished || m.finished_provisional || m.phase === 'FT');
    if (!m.started && !isCmFinished) continue;
    for (const mp of [
      ...(m.home_lineup || []),
      ...(m.home_bench || []),
      ...(m.away_lineup || []),
      ...(m.away_bench || []),
    ]) {
      if (!mp?.id || !mp?.stats) continue;
      const existing = playerMap.get(Number(mp.id));
      if (!existing) continue;
      const liveMins = Number(mp.stats.minutes) || 0;
      if (isCmFinished || liveMins >= existing.minutes) {
        existing.minutes = liveMins;
        existing.points = Number(mp.stats.total_points ?? existing.points ?? 0);
        existing.goals = Number(mp.stats.goals_scored ?? existing.goals ?? 0);
        existing.assists = Number(mp.stats.assists ?? existing.assists ?? 0);
        existing.bps = Number(mp.stats.bps ?? existing.bps ?? 0);
        existing.bonus = Number(mp.stats.bonus ?? existing.bonus ?? 0);
      }
    }
  }

  const finishedFixtures = effectiveFixtures.filter(
    (f: any) => f.finished || f.finished_provisional || (f.started && (f.minutes || 0) >= 90)
  );
  const upcomingFixtures = effectiveFixtures.filter((f: any) => !f.started && !f.finished && !f.finished_provisional);

  // Build club -> fixture map for finished matches
  const finishedClubFixtureMap = new Map<string, {
    club: string;
    opponent: string;
    goalsConceded: number;
    scoreStr: string;
    kickoffTime: string;
  }>();

  for (const f of finishedFixtures) {
    const home = resolveClubName(f.home_team);
    const away = resolveClubName(f.away_team);
    if (!home || !away) continue;
    const hs = Number(f.team_h_score ?? 0);
    const as = Number(f.team_a_score ?? 0);
    finishedClubFixtureMap.set(home, {
      club: home,
      opponent: away,
      goalsConceded: as,
      scoreStr: `${hs} - ${as}`,
      kickoffTime: f.kickoff_time || '',
    });
    finishedClubFixtureMap.set(away, {
      club: away,
      opponent: home,
      goalsConceded: hs,
      scoreStr: `${as} - ${hs}`,
      kickoffTime: f.kickoff_time || '',
    });
  }

  // Load Pulse match files strictly matching currentGw for granular goal+assist events
  const pulseMatches: any[] = loadPulseMatchesForGw(currentGw);

  const upcomingLineupMatches = allCachedMatches.filter(
    (m) =>
      !m.started &&
      m.has_lineup &&
      (m.home_lineup?.length || 0) >= 10 &&
      (m.away_lineup?.length || 0) >= 10
  );

  const { allPlayers: fplDirPlayers } = getFplPlayerDirectory(currentGw);

  for (const tmpl of templates) {
    try {
      const produced: EmittedStoryDraft[] = [];

      switch (tmpl.id) {
        // 34. BM_MATCH_SCORE_RESULT (Match Result)
        case 'BM_MATCH_SCORE_RESULT': {
          const sortedFinishedMatches = [...cachedMatches].sort(
            (a, b) => new Date(b.kickoff_time || 0).getTime() - new Date(a.kickoff_time || 0).getTime()
          );
          for (const m of sortedFinishedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            const venue = String(m.venue || '').replace(/,\s*[^,]+$/, '').trim();
            if (!homeClub || !awayClub || !venue) continue;
            const hs = Number(m.team_h_score ?? 0);
            const as = Number(m.team_a_score ?? 0);

            const allP = [...(m.home_lineup || []), ...(m.home_bench || []), ...(m.away_lineup || []), ...(m.away_bench || [])];
            const scorerMap = new Map<string, { name: string; pct: number; goals: number; og: boolean }>();
            for (const p of allP) {
              const g = Number(p.stats?.goals_scored || 0);
              const og = Number(p.stats?.own_goals || 0);
              if (g <= 0 && og <= 0) continue;
              const info = playerMap.get(p.id);
              const name = info?.name || p.web_name;
              if (!name) continue;
              const pct = info?.ownershipPct ?? 0;
              if (!scorerMap.has(name)) {
                scorerMap.set(name, { name, pct, goals: g, og: og > 0 && g === 0 });
              }
            }
            const scorers = Array.from(scorerMap.values());
            if (hs + as > 0 && scorers.length === 0) continue;

            const formatBMList = (lang: 'id' | 'en') => {
              if (scorers.length === 0) return '';
              const tokens = scorers.map((s) => {
                if (s.goals > 1) {
                  return lang === 'id'
                    ? `[P:${s.name}] ([N:${s.pct}%], [N:${s.goals} Gol])`
                    : `[P:${s.name}] ([N:${s.pct}%], [N:${s.goals} Goals])`;
                }
                if (s.og) {
                  return `[P:${s.name}] ([N:${s.pct}%], OG)`;
                }
                return `[P:${s.name}] ([N:${s.pct}%])`;
              });
              if (tokens.length === 1) return tokens[0];
              if (tokens.length === 2) return lang === 'id' ? `${tokens[0]} dan ${tokens[1]}` : `${tokens[0]} and ${tokens[1]}`;
              return lang === 'id'
                ? `${tokens.slice(0, -1).join(', ')} dan ${tokens[tokens.length - 1]}`
                : `${tokens.slice(0, -1).join(', ')}, and ${tokens[tokens.length - 1]}`;
            };

            const scorersStrId = formatBMList('id');
            const scorersStrEn = formatBMList('en');

            const isDraw = hs === as;
            const hasGoals = hs + as > 0 && scorers.length > 0;
            const winClub = hs > as ? homeClub : awayClub;
            const loseClub = hs > as ? awayClub : homeClub;
            const winScore = Math.max(hs, as);
            const loseScore = Math.min(hs, as);

            const cond = !isDraw
              ? 'Kemenangan'
              : hasGoals
              ? 'Imbang (Dengan Gol)'
              : 'Imbang (Tanpa Gol)';

            const vars = {
              venue,
              winning_club: winClub,
              losing_club: loseClub,
              winning_score: winScore,
              losing_score: loseScore,
              home_club: homeClub,
              away_club: awayClub,
              home_score: hs,
              away_score: as,
              goalscorers_list: scorersStrId || 'tanpa gol',
            };

            const headlineId =
              renderTemplateBranch(tmpl.template, cond, vars) ||
              (isDraw ? renderTemplateBranch(tmpl.template, 'Imbang', vars) : '');

            produced.push({
              id: `${tmpl.id}_m${m.id}`,
              headlineId,
              headlineEn: isDraw
                ? hasGoals
                  ? `Match result at [N:${venue}]: [C:${homeClub}] and [C:${awayClub}] draw [N:${hs}] - [N:${as}] — goalscorers: ${scorersStrEn}.`
                  : `Match result at [N:${venue}]: [C:${homeClub}] and [C:${awayClub}] play out a goalless draw [N:0] - [N:0].`
                : `Match result at [N:${venue}]: [C:${winClub}] defeats [C:${loseClub}] [N:${winScore}] - [N:${loseScore}] — goalscorers: ${scorersStrEn}.`,
              dramaScore: 90,
            });
          }
          break;
        }

        // 35. BM_MATCH_FIXTURE_NEXT
        case 'BM_MATCH_FIXTURE_NEXT': {
          if (upcomingFixtures.length > 0) {
            const sortedUp = [...upcomingFixtures].sort(
              (a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
            );
            const nextKickoff = sortedUp[0].kickoff_time;
            const batch = sortedUp.filter((f: any) => f.kickoff_time === nextKickoff);
            const lastFinished = [...finishedFixtures].sort(
              (a: any, b: any) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()
            )[0];
            const isShortBreak = lastFinished ? isSameUkDate(lastFinished.kickoff_time, nextKickoff) : false;
            const wibTime = formatWibTime(nextKickoff);
            const wibDay = formatWibDay(nextKickoff);

            if (!wibTime || !wibDay) break;

            if (batch.length === 1) {
              const f = batch[0];
              const home = resolveClubName(f.home_team);
              const away = resolveClubName(f.away_team);
              if (!home || !away) break;
              const cond = isShortBreak ? 'Jeda Pendek - 1 Laga' : 'Jeda Panjang - 1 Laga';
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, cond, {
                  gw: currentGw,
                  wib_day: wibDay,
                  kickoff_time: wibTime,
                  home_club: home,
                  away_club: away,
                }),
                headlineEn: `Next in Gameweek [N:${currentGw}]: [C:${home}] vs [C:${away}] at [N:${wibTime}].`,
                dramaScore: 85,
              });
            } else {
              const validBatch = batch
                .map((f: any) => ({
                  home: resolveClubName(f.home_team),
                  away: resolveClubName(f.away_team),
                }))
                .filter((p) => p.home && p.away);
              if (validBatch.length === 0) break;
              const matchPairs = validBatch.map((p) => `[C:${p.home}] vs [C:${p.away}]`);
              const matchesList =
                matchPairs.length === 1
                  ? matchPairs[0]
                  : matchPairs.length === 2
                    ? `${matchPairs[0]} dan ${matchPairs[1]}`
                    : `${matchPairs.slice(0, -1).join(', ')} dan ${matchPairs[matchPairs.length - 1]}`;
              const cond = isShortBreak ? 'Jeda Pendek - Multi Laga' : 'Jeda Panjang - Multi Laga';
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, cond, {
                  gw: currentGw,
                  wib_day: wibDay,
                  kickoff_time: wibTime,
                  count: validBatch.length,
                  matches_list: matchesList,
                }),
                headlineEn: `Gameweek [N:${currentGw}] continues with ${validBatch.length} matches at [N:${wibTime}]: ${matchesList}.`,
                dramaScore: 86,
              });
            }
          }
          break;
        }

        // 36. BM_MATCH_CLEAN_SHEET
        case 'BM_MATCH_CLEAN_SHEET': {
          const csMatches = Array.from(finishedClubFixtureMap.values()).filter(
            (m) => m.goalsConceded === 0
          );
          for (const cm of csMatches.slice(0, 4)) {
            const topDef = Array.from(playerMap.values())
              .filter(
                (p) =>
                  p.club === cm.club &&
                  (p.position === 'DEF' || p.position === 'GKP') &&
                  p.minutes >= 60
              )
              .sort((a, b) => b.ownersCount - a.ownersCount || b.points - a.points)[0];
            if (!topDef) continue;

            produced.push({
              id: `${tmpl.id}_${toStorySlug(cm.club)}_${toStorySlug(topDef.name)}`,
              headlineId: renderTemplate(tmpl.template, {
                club: cm.club,
                opponent: cm.opponent,
                defender: topDef.name,
                ownership_pct: topDef.ownershipPct,
              }),
              headlineEn: `[C:${cm.club}] kept a clean sheet against [C:${cm.opponent}], earning [N:+4 Pts] for [P:${topDef.name}] ([N:${topDef.ownershipPct}%]).`,
              dramaScore: 85,
            });
          }
          break;
        }

        // 37. BM_MATCH_GOAL_CONTRIBUTORS
        case 'BM_MATCH_GOAL_CONTRIBUTORS': {
          const seenPair = new Set<string>();
          // Condition 1: Multi Gol from GW stats
          const multiScorers = Array.from(playerMap.values())
            .filter((p) => p.goals >= 2 && finishedClubFixtureMap.has(p.club))
            .sort((a, b) => b.goals - a.goals || b.ownersCount - a.ownersCount)
            .slice(0, 2);

          for (const ms of multiScorers) {
            const fixInfo = finishedClubFixtureMap.get(ms.club)!;
            const key = `multi_${ms.name}`;
            if (seenPair.has(key)) continue;
            seenPair.add(key);
            produced.push({
              id: `${tmpl.id}_multi_${toStorySlug(ms.name)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Gol', {
                scorer: ms.name,
                scorer_pct: ms.ownershipPct,
                goals_count: ms.goals,
                club: ms.club,
                opponent: fixInfo.opponent,
              }),
              headlineEn: `[P:${ms.name}] ([N:${ms.ownershipPct}%]) scored [N:${ms.goals} Goals] for [C:${ms.club}] against [C:${fixInfo.opponent}].`,
              dramaScore: 91,
            });
          }

          // Condition 2: Gol & Assist from Pulse Match events (finished matches only)
          for (const pd of pulseMatches) {
            const homeRaw = pd.teams?.[0]?.team;
            const awayRaw = pd.teams?.[1]?.team;
            const homeClub = resolveClubName(homeRaw?.club?.abbr || homeRaw?.shortName || homeRaw?.name);
            const awayClub = resolveClubName(awayRaw?.club?.abbr || awayRaw?.shortName || awayRaw?.name);
            if (!homeClub || !awayClub) continue;
            if (pd.status !== 'C' && !finishedClubFixtureMap.has(homeClub)) continue;
            const persons = new Map<number, { person: any; teamName: string; teamShort: string }>();
            for (const tl of pd.teamLists || []) {
              const isHome = tl.teamId === homeRaw?.id;
              const tName = isHome ? homeClub : awayClub;
              const tShort = isHome ? (homeRaw?.club?.abbr || '') : (awayRaw?.club?.abbr || '');
              for (const p of [...(tl.lineup || []), ...(tl.substitutes || [])]) {
                if (p?.id) persons.set(p.id, { person: p, teamName: tName, teamShort: tShort });
              }
            }

            for (const ev of pd.events || []) {
              if (produced.length >= 4) break;
              if (ev.type === 'G' && ev.assistId && ev.description !== 'PG' && ev.description !== 'OG') {
                const sInfo = persons.get(ev.personId);
                const aInfo = persons.get(ev.assistId);
                const sFpl = matchPulsePersonToFpl(sInfo?.person, fplDirPlayers, sInfo?.teamShort);
                const aFpl = matchPulsePersonToFpl(aInfo?.person, fplDirPlayers, aInfo?.teamShort);
                const scorerName = sFpl?.webName || sInfo?.person?.name?.last;
                const assisterName = aFpl?.webName || aInfo?.person?.name?.last;
                if (!scorerName || !assisterName) continue;

                const clubName = sInfo?.teamName || homeClub;
                const oppName = clubName === homeClub ? awayClub : homeClub;
                const key = `ga_${scorerName}_${assisterName}`;
                if (seenPair.has(key)) continue;
                seenPair.add(key);

                produced.push({
                  id: `${tmpl.id}_ga_${toStorySlug(scorerName)}_${toStorySlug(assisterName)}`,
                  headlineId: renderTemplateBranch(tmpl.template, 'Gol & Assist', {
                    scorer: scorerName,
                    scorer_pct: sFpl?.ownershipPct ?? 0,
                    assister: assisterName,
                    assister_pct: aFpl?.ownershipPct ?? 0,
                    club: clubName,
                    opponent: oppName,
                  }),
                  headlineEn: `[P:${scorerName}] ([N:${sFpl?.ownershipPct ?? 0}%]) scored for [C:${clubName}] assisted by [P:${assisterName}] ([N:${aFpl?.ownershipPct ?? 0}%]) against [C:${oppName}].`,
                  dramaScore: 88,
                });
              }
            }
          }
          break;
        }

        // 38. BM_MATCH_BONUS_POINTS
        case 'BM_MATCH_BONUS_POINTS': {
          const topBps = Array.from(playerMap.values())
            .filter((p) => p.minutes > 0 && p.bps > 0 && finishedClubFixtureMap.has(p.club))
            .sort((a, b) => b.bps - a.bps || b.points - a.points)
            .slice(0, 3);

          for (const star of topBps) {
            const fixInfo = finishedClubFixtureMap.get(star.club)!;
            produced.push({
              id: `${tmpl.id}_${toStorySlug(star.name)}`,
              headlineId: renderTemplate(tmpl.template, {
                player: star.name,
                ownership_pct: star.ownershipPct,
                bps: star.bps,
                points: star.points,
                club: star.club,
                opponent: fixInfo.opponent,
              }),
              headlineEn: `[P:${star.name}] ([N:${star.ownershipPct}%]) topped the BPS chart ([N:${star.bps} BPS]) with [N:${star.points} Pts] in [C:${star.club}] vs [C:${fixInfo.opponent}].`,
              dramaScore: 86,
            });
          }
          break;
        }

        // 39. BM_MATCH_PENALTY_SAVED
        case 'BM_MATCH_PENALTY_SAVED': {
          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;

            const homePlayers = [...(m.home_lineup || []), ...(m.home_bench || [])];
            const awayPlayers = [...(m.away_lineup || []), ...(m.away_bench || [])];
            const pairings = [
              { gkSide: homePlayers, oppSide: awayPlayers, club: homeClub, opp: awayClub },
              { gkSide: awayPlayers, oppSide: homePlayers, club: awayClub, opp: homeClub },
            ];

            for (const pair of pairings) {
              const gkSavers = pair.gkSide.filter((p) => Number(p.stats?.penalties_saved || 0) > 0);
              const oppTakers = pair.oppSide.filter((p) => Number(p.stats?.penalties_missed || 0) > 0);
              if (gkSavers.length === 0 || oppTakers.length === 0) continue;

              gkSavers.forEach((gkSaver, idx) => {
                const taker = oppTakers[Math.min(idx, oppTakers.length - 1)];
                const gkInfo = playerMap.get(gkSaver.id);
                const takerInfo = playerMap.get(taker.id);
                const gkName = gkInfo?.name || gkSaver.web_name;
                const takerName = takerInfo?.name || taker.web_name;
                if (!gkName || !takerName) return;

                produced.push({
                  id: `${tmpl.id}_m${m.id}_${toStorySlug(gkName)}_${gkSaver.id}`,
                  headlineId: renderTemplate(tmpl.template, {
                    gk_name: gkName,
                    gk_pct: gkInfo?.ownershipPct ?? 0,
                    taker_name: takerName,
                    taker_pct: takerInfo?.ownershipPct ?? 0,
                    club: pair.club,
                    opponent: pair.opp,
                  }),
                  headlineEn: `Goalkeeper [P:${gkName}] saved a penalty from [P:${takerName}] in [C:${pair.club}] vs [C:${pair.opp}].`,
                  dramaScore: 93,
                });
              });
            }
          }
          break;
        }

        // 40. BM_MATCH_PENALTY_MISSED
        case 'BM_MATCH_PENALTY_MISSED': {
          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;
            for (const side of [
              { list: m.home_lineup || [], club: homeClub, opp: awayClub },
              { list: m.away_lineup || [], club: awayClub, opp: homeClub },
            ]) {
              for (const p of side.list) {
                if (Number(p.stats?.penalties_missed || 0) > 0) {
                  const info = playerMap.get(p.id);
                  const takerName = info?.name || p.web_name;
                  if (!takerName) continue;
                  produced.push({
                    id: `${tmpl.id}_m${m.id}_${toStorySlug(takerName)}`,
                    headlineId: renderTemplate(tmpl.template, {
                      taker_name: takerName,
                      taker_pct: info?.ownershipPct ?? 0,
                      club: side.club,
                      opponent: side.opp,
                    }),
                    headlineEn: `[P:${takerName}] missed a penalty in [C:${side.club}] vs [C:${side.opp}], suffering [N:-2 Pts].`,
                    dramaScore: 90,
                  });
                }
              }
            }
          }
          break;
        }

        // 41. BM_MATCH_CARD_RED
        case 'BM_MATCH_CARD_RED': {
          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;
            for (const side of [
              { list: [...(m.home_lineup || []), ...(m.home_bench || [])], club: homeClub, opp: awayClub },
              { list: [...(m.away_lineup || []), ...(m.away_bench || [])], club: awayClub, opp: homeClub },
            ]) {
              for (const p of side.list) {
                if (Number(p.stats?.red_cards || 0) > 0) {
                  const info = playerMap.get(p.id);
                  const pName = info?.name || p.web_name;
                  if (!pName) continue;
                  produced.push({
                    id: `${tmpl.id}_m${m.id}_${toStorySlug(pName)}`,
                    headlineId: renderTemplate(tmpl.template, {
                      player: pName,
                      player_pct: info?.ownershipPct ?? 0,
                      club: side.club,
                      opponent: side.opp,
                    }),
                    headlineEn: `[P:${pName}] received a red card in [C:${side.club}] vs [C:${side.opp}] ([N:-3 Pts]).`,
                    dramaScore: 91,
                  });
                }
              }
            }
          }
          break;
        }

        // 42. BM_MATCH_INJURY
        case 'BM_MATCH_INJURY': {
          const prevDeadline = deadlines[String(currentGw - 1)] || '';
          const flaggedSubbed = Array.from(playerMap.values())
            .filter(
              (p) =>
                p.minutes > 0 &&
                p.minutes < 60 &&
                (p.status === 'i' || p.status === 'd') &&
                p.ownersCount > 0 &&
                (!prevDeadline || p.newsAdded >= prevDeadline) &&
                finishedClubFixtureMap.has(p.club)
            )
            .sort((a, b) => b.ownersCount - a.ownersCount)
            .slice(0, 3);

          for (const fp of flaggedSubbed) {
            const fixInfo = finishedClubFixtureMap.get(fp.club)!;
            produced.push({
              id: `${tmpl.id}_${toStorySlug(fp.name)}`,
              headlineId: renderTemplate(tmpl.template, {
                player: fp.name,
                ownership_pct: fp.ownershipPct,
                minute: fp.minutes,
                club: fp.club,
                opponent: fixInfo.opponent,
              }),
              headlineEn: `[P:${fp.name}] ([N:${fp.ownershipPct}%]) was forced off injured at minute [N:${fp.minutes}] for [C:${fp.club}] against [C:${fixInfo.opponent}].`,
              dramaScore: 87,
            });
          }
          break;
        }

        // 43. BM_CAPTAIN_POPULAR_RETURN
        case 'BM_CAPTAIN_POPULAR_RETURN': {
          if (upcomingFixtures.length > 0) {
            const sortedUp = [...upcomingFixtures].sort(
              (a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
            );
            const nextKickoff = sortedUp[0].kickoff_time;
            const lastFinished = [...finishedFixtures].sort(
              (a: any, b: any) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()
            )[0];

            const upcomingClubFixtureMap = new Map<string, { club: string; opponent: string; kickoffTime: string }>();
            for (const f of sortedUp) {
              const home = resolveClubName(f.home_team);
              const away = resolveClubName(f.away_team);
              if (!home || !away) continue;
              if (!upcomingClubFixtureMap.has(home)) {
                upcomingClubFixtureMap.set(home, { club: home, opponent: away, kickoffTime: f.kickoff_time || '' });
              }
              if (!upcomingClubFixtureMap.has(away)) {
                upcomingClubFixtureMap.set(away, { club: away, opponent: home, kickoffTime: f.kickoff_time || '' });
              }
            }

            const capPlayers: any[] = Array.isArray(ctx.snap?.top_captains) ? ctx.snap.top_captains : [];
            if (capPlayers.length > 0) {
              const topCap = capPlayers[0];
              const capName = topCap.web_name || topCap.name;
              if (!capName) break;
              const capCount = topCap.captain_count || topCap.count || 0;
              const capStats = topCap.id ? playerMap.get(topCap.id) : null;
              const capClub = capStats?.club || resolveClubName(topCap.team_short_name || topCap.team_name) || '';
              const finishedCapMatch = capClub ? finishedClubFixtureMap.get(capClub) : undefined;
              const upcomingCapMatch = capClub ? upcomingClubFixtureMap.get(capClub) : undefined;
              const hasCaptainPlayed = Boolean(finishedCapMatch || (capStats && capStats.minutes > 0));
              const capPts = capStats?.points ?? topCap.gw_points ?? 0;

              if (!hasCaptainPlayed && (!capClub || !upcomingCapMatch?.opponent)) break;

              const targetKickoff = hasCaptainPlayed
                ? nextKickoff
                : (upcomingCapMatch?.kickoffTime || nextKickoff);
              const isShortBreak = lastFinished ? isSameUkDate(lastFinished.kickoff_time, targetKickoff) : false;
              const wibDay = formatWibDay(targetKickoff);
              const wibTime = formatWibTime(targetKickoff);
              if (!wibDay || !wibTime) break;

              const cond = hasCaptainPlayed
                ? (isShortBreak ? 'Jeda Pendek - Sudah Main' : 'Jeda Panjang - Sudah Main')
                : (isShortBreak ? 'Jeda Pendek - Belum Main' : 'Jeda Panjang - Belum Main');

              const headlineEn = hasCaptainPlayed
                ? `[P:${capName}] (captained by [N:${capCount}] teams) returned [N:${capPts * 2} Pts] ahead of upcoming fixtures.`
                : `[N:${capCount}] teams await captain [P:${capName}] ([C:${capClub}]) against [C:${upcomingCapMatch!.opponent}] at [N:${wibTime}].`;

              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, cond, {
                  captain: capName,
                  count: capCount,
                  pts: capPts * 2,
                  gw: currentGw,
                  wib_day: wibDay,
                  kickoff_time: wibTime,
                  club: capClub,
                  opponent: upcomingCapMatch?.opponent || finishedCapMatch?.opponent || '',
                }),
                headlineEn,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // 44. BM_LINEUP_BENCH_POINTS
        case 'BM_LINEUP_BENCH_POINTS': {
          if (rawPayload) {
            const benchAlerts: { team: string; player: string; pts: number }[] = [];
            for (const s of rawPayload.standingsTable) {
              for (const b of s.bench || []) {
                const club = resolveClubName(b.club);
                if (b.pts >= 6 && finishedClubFixtureMap.has(club)) {
                  benchAlerts.push({ team: s.team, player: b.name, pts: b.pts });
                }
              }
            }
            benchAlerts
              .sort((a, b) => b.pts - a.pts)
              .slice(0, 3)
              .forEach((ba, idx) => {
                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(ba.team)}`,
                  headlineId: renderTemplate(tmpl.template, {
                    team: ba.team,
                    player: ba.player,
                    bench_pts: ba.pts,
                  }),
                  headlineEn: `[T:${ba.team}] left [P:${ba.player}] on the bench with [N:${ba.pts} Pts] from a completed match.`,
                  dramaScore: 85,
                });
              });
          }
          break;
        }

        // 45. BM_LINEUP_AUTOSUB_ALERT
        case 'BM_LINEUP_AUTOSUB_ALERT': {
          const watches = ownershipList.length > 0
            ? findValidBetweenMatchAutosubWatches(
                ownershipList,
                standings,
                (id, op) => {
                  const pInfo = playerMap.get(id);
                  if (!pInfo) return undefined;
                  return {
                    id,
                    name: op.web_name || pInfo.name,
                    club: pInfo.club,
                    position: op.position || pInfo.position,
                    minutes: pInfo.minutes,
                    points: pInfo.points,
                    ownersCount: pInfo.ownersCount,
                  };
                },
                finishedClubFixtureMap
              )
            : [];
          watches
            .sort((a, b) => b.ownersCount - a.ownersCount)
            .slice(0, 3)
            .forEach((w, idx) => {
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplate(tmpl.template, {
                  player_dnp: w.playerDnp,
                  club: w.club,
                  team: w.team,
                }),
                headlineEn: `[T:${w.team}] awaits an autosub after starter [P:${w.playerDnp}] ([C:${w.club}]) played 0 minutes.`,
                dramaScore: 84,
              });
            });
          break;
        }

        // 46. BM_STANDINGS_TITLE_RACE
        case 'BM_STANDINGS_TITLE_RACE': {
          if (standings.length >= 2) {
            const sorted = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
            const r1 = sorted[0];
            const r2 = sorted[1];
            const margin = Math.abs((r1.total_points || 0) - (r2.total_points || 0));
            const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
              ? dbData.league_analytics.all_chips_used
              : [];

            const resolveTeamChip = (entryId: number, activeChipRaw?: string): string => {
              const row = allChips.find((c: any) => Number(c.entry_id) === Number(entryId));
              if (row) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) return 'Wildcard';
                if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) return 'Free Hit';
                if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) return 'Bench Boost';
                if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) return 'Triple Captain';
              }
              const c = String(activeChipRaw || '').toLowerCase();
              if (c === 'wc' || c === 'wildcard') return 'Wildcard';
              if (c === 'fh' || c === 'freehit') return 'Free Hit';
              if (c === 'bb' || c === 'bboost') return 'Bench Boost';
              if (c === 'tc' || c === '3xc') return 'Triple Captain';
              return '';
            };

            const resolveTeamCaptain = (entryObj: any): string => {
              if (entryObj?.captain?.name) return entryObj.captain.name;
              const row = rawPayload?.standingsTable?.find((s) => s.team === entryObj?.entry_name);
              return row?.starters?.find((st) => st.isC)?.name || '';
            };

            const chip1 = resolveTeamChip(r1.entry_id, r1.active_chip);
            const chip2 = resolveTeamChip(r2.entry_id, r2.active_chip);
            const cap1 = resolveTeamCaptain(r1);
            const cap2 = resolveTeamCaptain(r2);
            const marginClause =
              margin === 0 ? ' dengan poin identik' : ` dengan keduanya terpaut [N:${margin} Poin]`;

            let headlineId = '';
            let headlineEn = '';

            if (chip1 && chip2) {
              if (chip1 === chip2) {
                headlineId = renderTemplateBranch(tmpl.template, 'chip sama', {
                  team1: r1.entry_name,
                  team2: r2.entry_name,
                  chip: chip1,
                  margin_clause: marginClause,
                });
                headlineEn = `[T:${r1.entry_name}] and [T:${r2.entry_name}] both activated [N:${chip1}] in the provisional title race${margin === 0 ? ' while level on points' : ` separated by [N:${margin} Pts]`}.`;
              } else {
                headlineId = renderTemplateBranch(tmpl.template, 'duel chip berbeda', {
                  team1: r1.entry_name,
                  team2: r2.entry_name,
                  chip1,
                  chip2,
                  margin_clause: marginClause,
                });
                headlineEn = `[T:${r1.entry_name}] activated [N:${chip1}] while [T:${r2.entry_name}] activated [N:${chip2}] in the provisional title race.`;
              }
            } else if (chip1 || chip2) {
              const chipTeam = chip1 ? r1.entry_name : r2.entry_name;
              const rivalTeam = chip1 ? r2.entry_name : r1.entry_name;
              const chipName = chip1 || chip2;
              const targetClause =
                margin === 0
                  ? 'memecah kebuntuan poin identik melawan'
                  : chip1
                    ? `memperlebar keunggulan [N:${margin} Poin] atas`
                    : `memangkas jarak [N:${margin} Poin] dari`;
              headlineId = renderTemplateBranch(tmpl.template, 'manuver chip', {
                team_chip: chipTeam,
                chip: chipName,
                target_clause: targetClause,
                team_rival: rivalTeam,
              });
              headlineEn = `[T:${chipTeam}] activated [N:${chipName}] against [T:${rivalTeam}] in the provisional title race.`;
            } else if (margin === 0) {
              headlineId = renderTemplateBranch(tmpl.template, 'poin sama', {
                team1: r1.entry_name,
                team2: r2.entry_name,
              });
              headlineEn = `[T:${r1.entry_name}] and [T:${r2.entry_name}] are level on provisional points at the top of the table.`;
            } else if (cap1 && cap2 && cap1 !== cap2) {
              headlineId = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                team1: r1.entry_name,
                margin,
                team2: r2.entry_name,
                captain1: cap1,
                captain2: cap2,
              });
              headlineEn = `Provisional leader [T:${r1.entry_name}] leads [T:${r2.entry_name}] by [N:${margin} Pts], with [P:${cap1}] captained vs [P:${cap2}].`;
            } else if (cap1 && cap2 && cap1 === cap2) {
              const diffStarters = getTopDifferingStarters(r1.entry_id, r2.entry_id);
              if (diffStarters) {
                headlineId = renderTemplateBranch(tmpl.template, 'kapten sama', {
                  team1: r1.entry_name,
                  margin,
                  team2: r2.entry_name,
                  captain: cap1,
                  diff_player1: diffStarters.player1,
                  diff_player2: diffStarters.player2,
                });
                headlineEn = `Provisional leader [T:${r1.entry_name}] leads [T:${r2.entry_name}] by [N:${margin} Pts] with both captaining [P:${cap1}]; differentials turn to [P:${diffStarters.player1}] and [P:${diffStarters.player2}].`;
              }
            }

            if (headlineId) {
              produced.push({
                id: tmpl.id,
                headlineId,
                headlineEn,
                dramaScore: 91,
              });
            }
          }
          break;
        }

        // 47. BM_STANDINGS_GAMEWEEK_LEADER
        case 'BM_STANDINGS_GAMEWEEK_LEADER': {
          if (standings.length > 0) {
            const gwTop = [...standings].sort((a, b) => (b.event_points || 0) - (a.event_points || 0))[0];
            if (gwTop && gwTop.event_points > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: gwTop.entry_name,
                  gw_pts: gwTop.event_points,
                }),
                headlineEn: `[T:${gwTop.entry_name}] leads the live scoring table with [N:${gwTop.event_points} Pts].`,
                dramaScore: 89,
              });
            }
          }
          break;
        }

        // 48. BM_LINEUP_REMAINING_ASSETS
        case 'BM_LINEUP_REMAINING_ASSETS': {
          if (upcomingFixtures.length > 0 && rawPayload) {
            const upcomingClubSet = new Set<string>();
            for (const f of upcomingFixtures) {
              upcomingClubSet.add(resolveClubName(f.home_team, ''));
              upcomingClubSet.add(resolveClubName(f.away_team, ''));
            }
            const candidates: {
              team: string;
              remainingCount: number;
              captain?: { name: string; club: string };
              featured: { name: string; club: string };
            }[] = [];

            for (const s of rawPayload.standingsTable) {
              const remStarters = (s.starters || []).filter((st) =>
                upcomingClubSet.has(resolveClubName(st.club, ''))
              );
              if (remStarters.length === 0) continue;
              const remCap = remStarters.find((st) => st.isC);
              candidates.push({
                team: s.team,
                remainingCount: remStarters.length,
                captain: remCap ? { name: remCap.name, club: resolveClubName(remCap.club) } : undefined,
                featured: { name: remStarters[0].name, club: resolveClubName(remStarters[0].club) },
              });
            }

            candidates
              .sort((a, b) => b.remainingCount - a.remainingCount)
              .slice(0, 3)
              .forEach((c, idx) => {
                const cond = c.captain ? 'Dengan Kapten Tersisa' : 'Tanpa Kapten Tersisa';
                let headlineId = renderTemplateBranch(tmpl.template, cond, {
                  gw: currentGw,
                  team: c.team,
                  remaining_count: c.remainingCount,
                  captain: c.captain?.name || c.featured.name,
                  captain_club: c.captain?.club || c.featured.club,
                  player: c.featured.name,
                  club: c.featured.club,
                });
                if (c.remainingCount === 1) {
                  headlineId = headlineId.replace(', termasuk ', ', yakni ');
                }
                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(c.team)}`,
                  headlineId,
                  headlineEn: `[T:${c.team}] still has [N:${c.remainingCount}] ${c.remainingCount === 1 ? 'player' : 'players'} yet to play.`,
                  dramaScore: 86,
                });
              });
          }
          break;
        }

        // 82. BM_LINEUP_SURPRISE_BENCHED
        case 'BM_LINEUP_SURPRISE_BENCHED': {
          const coveredMatchKeys = new Set<string>();
          const startedOrFinishedKeys = new Set<string>();
          for (const cm of allCachedMatches) {
            if (cm.started || cm.finished || cm.finished_provisional) {
              const hc = resolveClubName(cm.home_team?.name || cm.home_team?.short_name);
              const ac = resolveClubName(cm.away_team?.name || cm.away_team?.short_name);
              if (hc && ac) startedOrFinishedKeys.add(buildMatchKey(hc, ac));
            }
          }

          const pushBmSurprises = (
            sideClub: string,
            sideOpp: string,
            starterFplIds: Set<number>,
            benchFplIds: Set<number>,
            starterCount: number,
            starterNamesNorm: Set<string>,
            benchNamesNorm: Set<string>
          ) => {
            const surprises = detectSurpriseLineupsForClub(
              sideClub,
              sideOpp,
              starterFplIds,
              benchFplIds,
              starterCount,
              fplDirPlayers,
              starterNamesNorm,
              benchNamesNorm
            );
            for (const surprise of surprises) {
              const cond = surprise.isBenched ? 'Dicadangkan' : 'Absen dari Skuad';
              const headlineId = renderTemplateBranch(tmpl.template, cond, {
                club: surprise.club,
                player: surprise.player.webName,
                starter_pct: surprise.player.starterPct,
                opponent: surprise.opponent,
              });
              if (!headlineId) continue;

              const headlineEn = surprise.isBenched
                ? `[C:${surprise.club}] benches [P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) against [C:${surprise.opponent}].`
                : `[P:${surprise.player.webName}] ([N:${surprise.player.starterPct}%] starter) misses out from [C:${surprise.club}]'s matchday squad against [C:${surprise.opponent}].`;

              produced.push({
                id: `${tmpl.id}_${toStorySlug(surprise.club)}_${toStorySlug(surprise.player.webName)}_${surprise.player.id}`,
                headlineId,
                headlineEn,
                dramaScore: Math.min(92, 82 + Math.floor(surprise.player.starterPct / 10)),
              });
            }
          };

          for (const m of upcomingLineupMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;
            coveredMatchKeys.add(buildMatchKey(homeClub, awayClub));

            const sides = [
              { club: homeClub, opponent: awayClub, lineup: m.home_lineup, bench: m.home_bench },
              { club: awayClub, opponent: homeClub, lineup: m.away_lineup, bench: m.away_bench },
            ];

            for (const side of sides) {
              const starterFplIds = new Set<number>(side.lineup.filter((p) => p.id > 0).map((p) => p.id));
              const benchFplIds = new Set<number>(side.bench.filter((p) => p.id > 0).map((p) => p.id));
              const starterNamesNorm = new Set<string>(side.lineup.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));
              const benchNamesNorm = new Set<string>(side.bench.map((p) => normalizeDiacritics(p.web_name)).filter(Boolean));
              pushBmSurprises(
                side.club,
                side.opponent,
                starterFplIds,
                benchFplIds,
                side.lineup.length,
                starterNamesNorm,
                benchNamesNorm
              );
            }
          }

          const excludeKeys = new Set<string>([...coveredMatchKeys, ...startedOrFinishedKeys]);
          const pulseUpcoming = getPulseUpcomingLineupSides(currentGw, excludeKeys, fplDirPlayers);
          for (const pm of pulseUpcoming) {
            for (const side of pm.sides) {
              pushBmSurprises(
                side.club,
                side.opponent,
                side.starterFplIds,
                side.benchFplIds,
                side.starterCount,
                side.starterNamesNorm,
                side.benchNamesNorm
              );
            }
          }
          break;
        }

        // 85. BM_STANDINGS_RANK_MOVEMENT
        case 'BM_STANDINGS_RANK_MOVEMENT': {
          if (finishedFixtures.length > 0 && standings.length > 0) {
            const valid = standings.filter(
              (s: any) => Number(s.last_rank || 0) > 0 && Number(s.rank || 0) > 0
            );
            const climbers = valid
              .map((s: any) => ({ s, diff: Number(s.last_rank) - Number(s.rank) }))
              .filter((x) => x.diff >= 3)
              .sort((a, b) => b.diff - a.diff || (b.s.event_points || 0) - (a.s.event_points || 0))
              .slice(0, 2);

            const fallers = valid
              .map((s: any) => ({ s, diff: Number(s.rank) - Number(s.last_rank) }))
              .filter((x) => x.diff >= 3)
              .sort((a, b) => b.diff - a.diff || (a.s.event_points || 0) - (b.s.event_points || 0))
              .slice(0, 2);

            for (const c of climbers) {
              const headlineId = renderTemplateBranch(tmpl.template, 'Naik Peringkat', {
                team: c.s.entry_name,
                rank_diff: c.diff,
                old_rank: c.s.last_rank,
                new_rank: c.s.rank,
                gw_pts: c.s.event_points || 0,
              });
              if (!headlineId) continue;
              produced.push({
                id: `${tmpl.id}_up_${toStorySlug(c.s.entry_name)}`,
                headlineId,
                headlineEn: `[T:${c.s.entry_name}] climbs [N:+${c.diff} Places] provisionally from [N:${c.s.last_rank}] to [N:${c.s.rank}] on [N:${c.s.event_points || 0} Pts].`,
                dramaScore: Math.min(90, 82 + Math.floor(c.diff / 3)),
              });
            }

            for (const f of fallers) {
              const headlineId = renderTemplateBranch(tmpl.template, 'Turun Peringkat', {
                team: f.s.entry_name,
                rank_diff: f.diff,
                old_rank: f.s.last_rank,
                new_rank: f.s.rank,
                gw_pts: f.s.event_points || 0,
              });
              if (!headlineId) continue;
              produced.push({
                id: `${tmpl.id}_down_${toStorySlug(f.s.entry_name)}`,
                headlineId,
                headlineEn: `[T:${f.s.entry_name}] drops [N:-${f.diff} Places] provisionally from [N:${f.s.last_rank}] to [N:${f.s.rank}] on [N:${f.s.event_points || 0} Pts] so far.`,
                dramaScore: Math.min(89, 81 + Math.floor(f.diff / 3)),
              });
            }
          }
          break;
        }

        // 86. BM_CAPTAIN_VICE_CAPTAIN
        case 'BM_CAPTAIN_VICE_CAPTAIN': {
          if (rawPayload) {
            const findPlayerStat = (name: string, clubRaw?: string): IndexedPlayerGwStat | undefined => {
              const lower = (name || '').toLowerCase();
              const club = clubRaw ? resolveClubName(clubRaw, '') : '';
              for (const p of playerMap.values()) {
                if (p.name.toLowerCase() === lower && (!club || p.club === club)) return p;
              }
              for (const p of playerMap.values()) {
                if (p.name.toLowerCase() === lower) return p;
              }
              return undefined;
            };

            const vcCases: {
              team: string;
              dnpCap: string;
              vcName: string;
              vcClub: string;
              vcPts: number;
              vcPlayed: boolean;
              rank: number;
            }[] = [];

            for (const s of rawPayload.standingsTable) {
              const capStarter = (s.starters || []).find((st) => st.isC);
              const vcStarter = (s.starters || []).find((st) => st.isVC);
              if (!capStarter || !vcStarter) continue;

              const capStat = findPlayerStat(capStarter.name, capStarter.club);
              const vcStat = findPlayerStat(vcStarter.name, vcStarter.club);
              if (!capStat || !vcStat) continue;

              // Trigger only when captain's club has already finished with 0 minutes played
              if (!finishedClubFixtureMap.has(capStat.club) || capStat.minutes > 0) continue;

              const vcPlayed = finishedClubFixtureMap.has(vcStat.club) && vcStat.minutes > 0;
              // Skip if VC also finished with 0 minutes
              if (finishedClubFixtureMap.has(vcStat.club) && vcStat.minutes === 0) continue;

              const stMatch = standings.find((st: any) => st.entry_name === s.team);
              const chipLower = String(s.chip || stMatch?.active_chip || '').toLowerCase();
              const isTc = chipLower === 'tc' || chipLower === '3xc' || chipLower.includes('triple');
              const vcCaptainPts = vcStat.points * (isTc ? 3 : 2);

              vcCases.push({
                team: s.team,
                dnpCap: capStat.name,
                vcName: vcStat.name,
                vcClub: vcStat.club,
                vcPts: vcCaptainPts,
                vcPlayed,
                rank: s.rank || 999,
              });
            }

            vcCases
              .sort((a, b) => {
                if (a.vcPlayed !== b.vcPlayed) return a.vcPlayed ? -1 : 1;
                if (b.vcPts !== a.vcPts) return b.vcPts - a.vcPts;
                return a.rank - b.rank;
              })
              .slice(0, 3)
              .forEach((v, idx) => {
                const cond = v.vcPlayed ? 'Wakil Kapten Sudah Main' : 'Menanti Wakil Kapten';
                const headlineId = renderTemplateBranch(tmpl.template, cond, {
                  team: v.team,
                  vice_captain: v.vcName,
                  vice_pts: v.vcPts,
                  vice_club: v.vcClub,
                  captain_dnp: v.dnpCap,
                });
                if (!headlineId) return;
                const headlineEn = v.vcPlayed
                  ? `[T:${v.team}] turns to vice-captain [P:${v.vcName}] ([N:${v.vcPts} Pts]) after captain [P:${v.dnpCap}] missed out.`
                  : `[T:${v.team}] now relies on vice-captain [P:${v.vcName}] ([C:${v.vcClub}]) after captain [P:${v.dnpCap}] played 0 minutes.`;

                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(v.team)}`,
                  headlineId,
                  headlineEn,
                  dramaScore: 89,
                });
              });
          }
          break;
        }

        // 87. BM_CHIP_PROGRESS
        case 'BM_CHIP_PROGRESS': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          const chipActivations = new Map<string, 'TC' | 'BB' | 'WC' | 'FH'>();

          for (const entry of allChips) {
            if (!entry?.entry_name) continue;
            if (entry.tc1?.gw === currentGw || entry.tc2?.gw === currentGw) chipActivations.set(entry.entry_name, 'TC');
            else if (entry.bb1?.gw === currentGw || entry.bb2?.gw === currentGw) chipActivations.set(entry.entry_name, 'BB');
            else if (entry.wc1?.gw === currentGw || entry.wc2?.gw === currentGw) chipActivations.set(entry.entry_name, 'WC');
            else if (entry.fh1?.gw === currentGw || entry.fh2?.gw === currentGw) chipActivations.set(entry.entry_name, 'FH');
          }
          for (const s of standings as any[]) {
            if (!s?.entry_name || !s?.active_chip || chipActivations.has(s.entry_name)) continue;
            const c = String(s.active_chip).toLowerCase();
            if (c === 'tc' || c === '3xc') chipActivations.set(s.entry_name, 'TC');
            else if (c === 'bb' || c === 'bboost') chipActivations.set(s.entry_name, 'BB');
            else if (c === 'wc' || c === 'wildcard') chipActivations.set(s.entry_name, 'WC');
            else if (c === 'fh' || c === 'freehit') chipActivations.set(s.entry_name, 'FH');
          }

          const upcomingClubSet = new Set<string>();
          for (const f of upcomingFixtures) {
            const h = resolveClubName(f.home_team, '');
            const a = resolveClubName(f.away_team, '');
            if (h) upcomingClubSet.add(h);
            if (a) upcomingClubSet.add(a);
          }

          let chipIdx = 0;
          for (const [teamName, chipCode] of chipActivations.entries()) {
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === teamName);
            const teamStanding = standings.find((s: any) => s.entry_name === teamName);

            if (chipCode === 'TC') {
              const capStarter = teamRow?.starters?.find((st) => st.isC);
              const capClub = capStarter ? resolveClubName(capStarter.club, '') : '';
              if (!capStarter || !capClub || !finishedClubFixtureMap.has(capClub)) continue;
              chipIdx++;
              const totalPts = capStarter.pts;
              const headlineId = renderTemplateBranch(tmpl.template, 'Triple Captain', {
                team: teamName,
                captain: capStarter.name,
                total_pts: totalPts,
              });
              if (headlineId) {
                produced.push({
                  id: `${tmpl.id}_tc_${chipIdx}_${toStorySlug(teamName)}`,
                  headlineId,
                  headlineEn: `[T:${teamName}] provisionally holds [N:${totalPts} Pts] from captain [P:${capStarter.name}] via [N:Triple Captain].`,
                  dramaScore: 89,
                });
              }
            } else if (chipCode === 'BB') {
              if (!teamRow) continue;
              const finishedBench = (teamRow.bench || []).filter((b) =>
                finishedClubFixtureMap.has(resolveClubName(b.club, ''))
              );
              if (finishedBench.length === 0) continue;
              chipIdx++;
              const benchPts = finishedBench.reduce((sum, b) => sum + (Number(b.pts) || 0), 0);
              const headlineId = renderTemplateBranch(tmpl.template, 'Bench Boost', {
                team: teamName,
                bench_pts: benchPts,
              });
              if (headlineId) {
                produced.push({
                  id: `${tmpl.id}_bb_${chipIdx}_${toStorySlug(teamName)}`,
                  headlineId,
                  headlineEn: `[T:${teamName}] has collected [N:${benchPts} Pts] from the bench via [N:Bench Boost] so far.`,
                  dramaScore: 87,
                });
              }
            } else if (chipCode === 'WC' || chipCode === 'FH') {
              if (!teamRow) continue;
              const finishedStarters = (teamRow.starters || []).filter((st) =>
                finishedClubFixtureMap.has(resolveClubName(st.club, ''))
              );
              const remainingStarters = (teamRow.starters || []).filter((st) =>
                upcomingClubSet.has(resolveClubName(st.club, ''))
              );
              if (finishedStarters.length === 0 || remainingStarters.length === 0) continue;
              chipIdx++;
              const gwPts = teamStanding?.event_points ?? teamRow.gwPts ?? 0;
              const condName = chipCode === 'WC' ? 'Wildcard' : 'Free Hit';
              const headlineId = renderTemplateBranch(tmpl.template, condName, {
                team: teamName,
                gw_pts: gwPts,
                remaining_count: remainingStarters.length,
              });
              if (headlineId) {
                produced.push({
                  id: `${tmpl.id}_${chipCode.toLowerCase()}_${chipIdx}_${toStorySlug(teamName)}`,
                  headlineId,
                  headlineEn: `[T:${teamName}] sits on [N:${gwPts} Pts] provisionally via [N:${condName}] with [N:${remainingStarters.length}] players remaining.`,
                  dramaScore: 86,
                });
              }
            }
          }
          break;
        }

        // 88. BM_TRANSFER_HITS_EVALUATION
        case 'BM_TRANSFER_HITS_EVALUATION': {
          const allGwTransfers = (dbData?.league_analytics?.all_transfers || []).filter(
            (tr: any) => Number(tr.event) === currentGw && tr.element_in?.name
          );
          const hitTeams = standings
            .filter((s: any) => (s.event_transfers_cost || 0) > 0)
            .sort((a: any, b: any) => (b.event_transfers_cost || 0) - (a.event_transfers_cost || 0));

          const evaluated: {
            team: string;
            hitsPts: number;
            playerIn: string;
            club: string;
            playerPts: number;
          }[] = [];

          for (const ht of hitTeams) {
            const finishedSignings = allGwTransfers
              .filter((tr: any) => tr.entry_id === ht.entry_id || tr.entry_name === ht.entry_name)
              .map((tr: any) => {
                const stat = tr.element_in?.id ? playerMap.get(Number(tr.element_in.id)) : undefined;
                const club = stat?.club || resolveClubName(tr.element_in.club, '');
                const pts = stat?.points ?? (Number(tr.element_in.gw_points) || 0);
                return {
                  name: stat?.name || tr.element_in.name,
                  club,
                  pts,
                };
              })
              .filter((x: any) => x.name && x.club && finishedClubFixtureMap.has(x.club))
              .sort((a: any, b: any) => b.pts - a.pts);

            if (finishedSignings.length === 0) continue;
            const bestIn = finishedSignings[0];
            evaluated.push({
              team: ht.entry_name,
              hitsPts: Number(ht.event_transfers_cost) || 0,
              playerIn: bestIn.name,
              club: bestIn.club,
              playerPts: bestIn.pts,
            });
          }

          evaluated.slice(0, 3).forEach((evItem, idx) => {
            const headlineId = renderTemplate(tmpl.template, {
              team: evItem.team,
              hits_pts: evItem.hitsPts,
              player_in: evItem.playerIn,
              club: evItem.club,
              player_pts: evItem.playerPts,
            });
            if (!headlineId) return;
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(evItem.team)}`,
              headlineId,
              headlineEn: `[T:${evItem.team}] took a [N:-${evItem.hitsPts} Pts] hit while new signing [P:${evItem.playerIn}] ([C:${evItem.club}]) recorded [N:${evItem.playerPts} Pts] in a completed match.`,
              dramaScore: 86,
            });
          });
          break;
        }

        // 89. BM_CAPTAIN_DIFFERENTIAL_RETURN
        case 'BM_CAPTAIN_DIFFERENTIAL_RETURN': {
          const capPlayers: any[] = Array.isArray(snap?.top_captains) ? snap.top_captains : [];
          const diffCaps = capPlayers.filter(
            (c: any) =>
              (c.captain_percentage != null && c.captain_percentage < 5) ||
              (c.captain_count != null && c.captain_count <= 2)
          );

          const diffStories: {
            team: string;
            pts: number;
            captain: string;
            club: string;
            opponent: string;
            pickersCount: number;
          }[] = [];

          for (const dc of diffCaps) {
            const stat = dc.id ? playerMap.get(Number(dc.id)) : undefined;
            if (!stat || stat.points < 8) continue;
            const fixInfo = finishedClubFixtureMap.get(stat.club);
            if (!fixInfo) continue;

            const pickers = standings.filter(
              (s: any) => s.captain?.id === stat.id || s.captain?.name === stat.name
            );
            for (const picker of pickers) {
              const isTc =
                String(picker.active_chip || '').toLowerCase() === 'tc' ||
                String(picker.active_chip || '').toLowerCase() === '3xc';
              diffStories.push({
                team: picker.entry_name,
                pts: stat.points * (isTc ? 3 : 2),
                captain: stat.name,
                club: stat.club,
                opponent: fixInfo.opponent,
                pickersCount: Number(dc.captain_count ?? pickers.length) || 1,
              });
            }
          }

            diffStories
            .sort((a, b) => b.pts - a.pts || a.pickersCount - b.pickersCount)
            .slice(0, 3)
            .forEach((ds, idx) => {
              const cond = ds.pickersCount === 1 ? 'Kapten Eksklusif' : 'Kapten Differential';
              const headlineId = renderTemplateBranch(tmpl.template, cond, {
                team: ds.team,
                pts: ds.pts,
                captain: ds.captain,
                club: ds.club,
                opponent: ds.opponent,
              });
              if (!headlineId) return;
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(ds.team)}`,
                headlineId,
                headlineEn: `[T:${ds.team}] collected [N:${ds.pts} Pts] from differential captain [P:${ds.captain}] ([C:${ds.club}]) after facing [C:${ds.opponent}].`,
                dramaScore: 88,
              });
            });
          break;
        }

        // 102. BM_PLAYER_AVAILABILITY_FLAGGED
        case 'BM_PLAYER_AVAILABILITY_FLAGGED': {
          if (upcomingFixtures.length > 0) {
            const upcomingClubMap = new Map<string, string>();
            for (const f of upcomingFixtures) {
              const h = resolveClubName(f.home_team, '');
              const a = resolveClubName(f.away_team, '');
              if (h && a) {
                if (!upcomingClubMap.has(h)) upcomingClubMap.set(h, a);
                if (!upcomingClubMap.has(a)) upcomingClubMap.set(a, h);
              }
            }

            const prevDeadline = currentGw > 1 ? deadlines[String(currentGw - 1)] : undefined;
            const prevDeadlineMs = prevDeadline ? new Date(prevDeadline).getTime() : NaN;
            const totalTeams = standings.length || Number(dbData?.meta?.total_teams) || 0;
            const ownershipById = new Map<number, number>();
            for (const op of ownershipList) {
              if (op?.id) ownershipById.set(op.id, Number(op.owned_count ?? 0));
            }

            const flaggedUpcoming: {
              id: number;
              name: string;
              club: string;
              opponent: string;
              injuryDesc: string;
              ownersCount: number;
              cost: number;
              isOut: boolean;
            }[] = [];

            for (const p of Object.values(dbData?.players || {}) as any[]) {
              if (!p?.status || p.status === 'a' || !p.news || !p.newsAdded) continue;
              if (Number.isFinite(prevDeadlineMs)) {
                const newsAddedMs = new Date(p.newsAdded).getTime();
                if (!Number.isFinite(newsAddedMs) || newsAddedMs < prevDeadlineMs) continue;
              }
              const club = resolveClubName(p.teamName || p.team_name || p.teamShort || p.team_short_name, '');
              const opponent = club ? upcomingClubMap.get(club) : undefined;
              if (!club || !opponent) continue;

              const ownersCount = ownershipById.get(p.id) ?? (p.league_ownership?.count || 0);
              if (ownersCount <= 0 || totalTeams === 0) continue;

              const isOut =
                p.status === 'i' ||
                p.status === 's' ||
                p.status === 'n' ||
                p.chanceOfPlayingNextRound === 0 ||
                p.chanceOfPlayingThisRound === 0;

              flaggedUpcoming.push({
                id: p.id,
                name: p.webName || p.web_name || '',
                club,
                opponent,
                injuryDesc: formatInjuryDescription(p.news),
                ownersCount,
                cost: Number(p.nowCost || p.cost || 0),
                isOut,
              });
            }

            const selectedFlagged = flaggedUpcoming
              .filter((x) => x.name)
              .sort((a, b) => {
                if (a.isOut !== b.isOut) return a.isOut ? -1 : 1;
                if (b.ownersCount !== a.ownersCount) return b.ownersCount - a.ownersCount;
                return b.cost - a.cost;
              })
              .slice(0, 5);
            const bmSlugCounts = new Map<string, number>();
            for (const item of selectedFlagged) {
              const s = toStorySlug(item.name);
              bmSlugCounts.set(s, (bmSlugCounts.get(s) || 0) + 1);
            }
            selectedFlagged.forEach((item) => {
              const cond = item.isOut ? 'Dipastikan Absen' : 'Meragukan';
              const headlineId = renderTemplateBranch(tmpl.template, cond, {
                player: item.name,
                club: item.club,
                opponent: item.opponent,
                injury_desc: item.injuryDesc,
                owners_count: item.ownersCount,
              });
              if (!headlineId) return;
              const slug = toStorySlug(item.name);
              const uniqueSuffix = (bmSlugCounts.get(slug) || 0) > 1 ? `${slug}_${item.id}` : slug;
              produced.push({
                id: `${tmpl.id}_${uniqueSuffix}`,
                headlineId,
                headlineEn: item.isOut
                  ? `[P:${item.name}] ([C:${item.club}]) is ruled out against [C:${item.opponent}] (${item.injuryDesc}), impacting [N:${item.ownersCount}] owners.`
                  : `[P:${item.name}] ([C:${item.club}]) is doubtful against [C:${item.opponent}] (${item.injuryDesc}), leaving [N:${item.ownersCount}] owners waiting.`,
                dramaScore: item.isOut ? 87 : 83,
              });
            });
          }
          break;
        }

        // 103. BM_STANDINGS_WEEKLY_WINS_MOST
        case 'BM_STANDINGS_WEEKLY_WINS_MOST': {
          const sortedLive = [...standings].sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999));
          const liveTop2Ids = new Set(sortedLive.slice(0, 2).map((s: any) => Number(s.entry_id)));
          const mostGwLeaders = getHistoricalMostGwLeaders(currentGw).filter(
            (t) => !liveTop2Ids.has(Number(t.entry_id))
          );

          if (mostGwLeaders.length >= 2) {
            const team1 = mostGwLeaders[0];
            const team2 = mostGwLeaders[1];
            const st1 = standings.find((s: any) => Number(s.entry_id) === Number(team1.entry_id));
            const st2 = standings.find((s: any) => Number(s.entry_id) === Number(team2.entry_id));
            const gwPts1 = Number(st1?.event_points ?? 0);
            const gwPts2 = Number(st2?.event_points ?? 0);

            const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
              ? dbData.league_analytics.all_chips_used
              : [];

            const resolveTeamChip = (entryId: number, activeChipRaw?: string): string => {
              const row = allChips.find((c: any) => Number(c.entry_id) === Number(entryId));
              if (row) {
                if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) return 'Wildcard';
                if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) return 'Free Hit';
                if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) return 'Bench Boost';
                if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) return 'Triple Captain';
              }
              const c = String(activeChipRaw || '').toLowerCase();
              if (c === 'wc' || c === 'wildcard') return 'Wildcard';
              if (c === 'fh' || c === 'freehit') return 'Free Hit';
              if (c === 'bb' || c === 'bboost') return 'Bench Boost';
              if (c === 'tc' || c === '3xc') return 'Triple Captain';
              return '';
            };

            const resolveTeamCaptain = (entryObj: any, entryName: string): string => {
              if (entryObj?.captain?.name) return entryObj.captain.name;
              const row = rawPayload?.standingsTable?.find((s) => s.team === entryName);
              return row?.starters?.find((st) => st.isC)?.name || '';
            };

            const chip1 = resolveTeamChip(team1.entry_id, st1?.active_chip);
            const chip2 = resolveTeamChip(team2.entry_id, st2?.active_chip);
            const cap1 = resolveTeamCaptain(st1, team1.entry_name);
            const cap2 = resolveTeamCaptain(st2, team2.entry_name);

            let headlineId = '';
            let headlineEn = '';

            if (chip1 && chip2) {
              if (chip1 === chip2) {
                headlineId = renderTemplateBranch(tmpl.template, 'chip sama', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  gw_pts1: gwPts1,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  gw_pts2: gwPts2,
                  chip: chip1,
                });
                headlineEn = `[T:${team1.entry_name}] ([N:${team1.titles}] titles, [N:${gwPts1} Pts] live) and [T:${team2.entry_name}] ([N:${team2.titles}] titles, [N:${gwPts2} Pts] live) activated [N:${chip1}] in the Most GW Wins race.`;
              } else {
                headlineId = renderTemplateBranch(tmpl.template, 'duel chip berbeda', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  gw_pts1: gwPts1,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  gw_pts2: gwPts2,
                  chip1,
                  chip2,
                });
                headlineEn = `[T:${team1.entry_name}] ([N:${team1.titles}] titles, [N:${gwPts1} Pts] live) activated [N:${chip1}], while [T:${team2.entry_name}] ([N:${team2.titles}] titles, [N:${gwPts2} Pts] live) activated [N:${chip2}] in the Most GW Wins race.`;
              }
            } else if (chip1 || chip2) {
              const chipTeam = chip1 ? team1 : team2;
              const chipPts = chip1 ? gwPts1 : gwPts2;
              const chipName = chip1 || chip2;
              headlineId = renderTemplateBranch(tmpl.template, 'manuver chip', {
                team_chip: chipTeam.entry_name,
                titles_chip: chipTeam.titles,
                gw_pts_chip: chipPts,
                chip: chipName,
              });
              headlineEn = `[T:${chipTeam.entry_name}] ([N:${chipTeam.titles}] titles, [N:${chipPts} Pts] live) activated [N:${chipName}] to chase the Most GW Wins crown.`;
            } else if (cap1 && cap2 && cap1 !== cap2) {
              headlineId = renderTemplateBranch(tmpl.template, 'kapten berbeda', {
                team1: team1.entry_name,
                titles1: team1.titles,
                gw_pts1: gwPts1,
                team2: team2.entry_name,
                titles2: team2.titles,
                gw_pts2: gwPts2,
                captain1: cap1,
                captain2: cap2,
              });
              headlineEn = `[T:${team1.entry_name}] ([N:${team1.titles}] titles, [N:${gwPts1} Pts] live) and [T:${team2.entry_name}] ([N:${team2.titles}] titles, [N:${gwPts2} Pts] live) chase the Most GW Wins crown with captains [P:${cap1}] vs [P:${cap2}].`;
            } else if (cap1 && cap2 && cap1 === cap2) {
              const diffStarters = getTopDifferingStarters(team1.entry_id, team2.entry_id);
              if (diffStarters) {
                headlineId = renderTemplateBranch(tmpl.template, 'kapten sama', {
                  team1: team1.entry_name,
                  titles1: team1.titles,
                  gw_pts1: gwPts1,
                  team2: team2.entry_name,
                  titles2: team2.titles,
                  gw_pts2: gwPts2,
                  captain: cap1,
                  diff_player1: diffStarters.player1,
                  diff_player2: diffStarters.player2,
                });
                headlineEn = `[T:${team1.entry_name}] ([N:${team1.titles}] titles, [N:${gwPts1} Pts] live) and [T:${team2.entry_name}] ([N:${team2.titles}] titles, [N:${gwPts2} Pts] live) chase the Most GW Wins crown with captain [P:${cap1}], turning to [P:${diffStarters.player1}] vs [P:${diffStarters.player2}].`;
              }
            }

            if (headlineId) {
              produced.push({
                id: tmpl.id,
                headlineId,
                headlineEn,
                dramaScore: 84,
              });
            }
          }
          break;
        }
      }

      stories.push(...finalizeBetweenMatchStories(tmpl, produced, currentGw, nowIso));
    } catch (err: any) {
      console.warn(`[BetweenMatchGenerator] Error rendering ${tmpl.id}:`, err.message);
    }
  }

  return scheduleStoriesIntoWaves(
    stories,
    'Between Match',
    currentGw,
    templates.map((t) => t.id)
  );
}
