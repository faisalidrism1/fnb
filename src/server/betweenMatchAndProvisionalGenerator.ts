import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { buildRawMatchdayPayload } from './newsAggregator.ts';
import { getCachedMatchesForGw } from './matchesFetcher.ts';
import { getFplPlayerDirectory, matchPulsePersonToFpl } from './pulseMatchStoryGenerator.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';

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

function isSameWibDate(isoA?: string, isoB?: string): boolean {
  if (!isoA || !isoB) return false;
  try {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
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

function loadContextData(targetGw?: number) {
  const dbData = getOptimalDatabase();
  const currentGw = targetGw || Number(dbData?.meta?.current_gw) || 0;
  const standings = currentGw ? getDbStandings(currentGw) : [];
  const snap = currentGw ? getGwSnapshot(currentGw) : null;
  const rawPayload = currentGw ? buildRawMatchdayPayload(currentGw) : null;

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

function finalizeStories(
  tmpl: Phase1TemplateItem,
  produced: EmittedStoryDraft[],
  gw: number,
  targetPhase: 'Between Match' | 'Provisional',
  nowIso: string
): GeneratedPhaseStory[] {
  const out: GeneratedPhaseStory[] = [];
  for (const item of produced) {
    if (!item.headlineId) continue;
    out.push({
      id: item.id,
      headline_id: item.headlineId,
      headline_en: item.headlineEn || item.headlineId,
      kategori: tmpl.category,
      sub_kategori: tmpl.subcategory,
      drama_score: item.dramaScore ?? 86,
      waktu_tayang: [targetPhase],
      gw,
      teams: extractTagNames(item.headlineId, 'T'),
      players: extractTagNames(item.headlineId, 'P'),
      sumber: 'Sys',
      status_tayang: 'Y',
      keterangan_tidak_tayang: '',
      timestamp_produksi: nowIso,
    });
  }
  return out;
}

/**
 * Generates real factual stories for all 15 Between Match templates (BM_*)
 */
export function generateBetweenMatchStories(targetGw?: number): GeneratedPhaseStory[] {
  const templates = getPhase1Templates().filter(
    (t) => (t.gw_phase || '').trim().toLowerCase() === 'between match'
  );
  if (templates.length === 0) return [];

  const ctx = loadContextData(targetGw);
  const { currentGw, dbData, standings, rawPayload, playerMap, ownershipList, fixtures, deadlines } = ctx;
  if (!currentGw) return [];
  const nowIso = new Date().toISOString();
  const stories: GeneratedPhaseStory[] = [];

  const finishedFixtures = fixtures.filter(
    (f: any) => f.finished || f.finished_provisional || (f.started && (f.minutes || 0) >= 90)
  );
  const upcomingFixtures = fixtures.filter((f: any) => !f.started);

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
  const pulseMatches: any[] = [];
  try {
    const dataDir = path.join(process.cwd(), 'src/data');
    if (fs.existsSync(dataDir)) {
      for (const file of fs.readdirSync(dataDir)) {
        if (file.startsWith('pulse_match_') && file.endsWith('.json')) {
          const pd = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
          if (Number(pd?.gameweek?.gameweek) === currentGw) {
            pulseMatches.push(pd);
          }
        }
      }
    }
  } catch {}

  const cachedMatches = (getCachedMatchesForGw(currentGw) || []).filter(
    (m) => m.finished || m.finished_provisional
  );

  const { allPlayers: fplDirPlayers } = getFplPlayerDirectory(currentGw);

  for (const tmpl of templates) {
    try {
      const produced: EmittedStoryDraft[] = [];

      switch (tmpl.id) {
        // 34. BM_MATCH_RESULT (Match Result)
        case 'BM_MATCH_RESULT': {
          for (const m of cachedMatches.slice(0, 5)) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            const venue = m.venue;
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
              const tokens = scorers.map((s) =>
                `[P:${s.name}] ([N:${s.pct}%])${
                  s.goals > 1
                    ? lang === 'id'
                      ? ` [N:(${s.goals} Gol)]`
                      : ` [N:(${s.goals} Goals)]`
                    : s.og
                    ? lang === 'id'
                      ? ' [N:(GBD)]'
                      : ' [N:(OG)]'
                    : ''
                }`
              );
              if (tokens.length === 1) return tokens[0];
              if (tokens.length === 2) return lang === 'id' ? `${tokens[0]} dan ${tokens[1]}` : `${tokens[0]} and ${tokens[1]}`;
              return lang === 'id'
                ? `${tokens.slice(0, -1).join(', ')}, dan ${tokens[tokens.length - 1]}`
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
                  ? `Match result at [N:${venue}]: [C:${homeClub}] and [C:${awayClub}] draw [N:${hs}] - [N:${as}], goals scored by ${scorersStrEn}.`
                  : `Match result at [N:${venue}]: [C:${homeClub}] and [C:${awayClub}] play out a goalless draw [N:0] - [N:0].`
                : `Match result at [N:${venue}]: [C:${winClub}] defeats [C:${loseClub}] [N:${winScore}] - [N:${loseScore}], goals scored by ${scorersStrEn}.`,
              dramaScore: 90,
            });
          }
          break;
        }

        // 35. BM_MATCH_FIXTURE
        case 'BM_MATCH_FIXTURE': {
          if (upcomingFixtures.length > 0) {
            const sortedUp = [...upcomingFixtures].sort(
              (a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
            );
            const nextKickoff = sortedUp[0].kickoff_time;
            const batch = sortedUp.filter((f: any) => f.kickoff_time === nextKickoff);
            const lastFinished = [...finishedFixtures].sort(
              (a: any, b: any) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()
            )[0];
            const isShortBreak = lastFinished ? isSameWibDate(lastFinished.kickoff_time, nextKickoff) : false;
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
              const matchesList = validBatch
                .map((p, idx) => {
                  const pair = `[C:${p.home}] vs [C:${p.away}]`;
                  return idx === validBatch.length - 1 ? `dan ${pair}` : pair;
                })
                .join(', ');
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

        // 37. BM_GOAL_CONTRIBUTORS
        case 'BM_GOAL_CONTRIBUTORS': {
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

          // Condition 2: Gol & Assist from Pulse Match events
          for (const pd of pulseMatches) {
            const homeRaw = pd.teams?.[0]?.team;
            const awayRaw = pd.teams?.[1]?.team;
            const homeClub = resolveClubName(homeRaw?.club?.abbr || homeRaw?.shortName || homeRaw?.name);
            const awayClub = resolveClubName(awayRaw?.club?.abbr || awayRaw?.shortName || awayRaw?.name);
            if (!homeClub || !awayClub) continue;
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

        // 38. BM_BONUS_POINTS_STAR
        case 'BM_BONUS_POINTS_STAR': {
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

        // 39. BM_PENALTY_SAVED
        case 'BM_PENALTY_SAVED': {
          for (const m of cachedMatches) {
            const homeClub = resolveClubName(m.home_team?.name || m.home_team?.short_name);
            const awayClub = resolveClubName(m.away_team?.name || m.away_team?.short_name);
            if (!homeClub || !awayClub) continue;
            const allP = [...(m.home_lineup || []), ...(m.away_lineup || [])];
            const gkSaver = allP.find((p) => Number(p.stats?.penalties_saved || 0) > 0);
            const taker = allP.find((p) => Number(p.stats?.penalties_missed || 0) > 0);
            if (gkSaver && taker) {
              const gkInfo = playerMap.get(gkSaver.id);
              const takerInfo = playerMap.get(taker.id);
              const gkName = gkInfo?.name || gkSaver.web_name;
              const takerName = takerInfo?.name || taker.web_name;
              if (!gkName || !takerName) continue;
              const isGkHome = (m.home_lineup || []).some((p) => p.id === gkSaver.id);
              const club = isGkHome ? homeClub : awayClub;
              const opp = isGkHome ? awayClub : homeClub;
              produced.push({
                id: `${tmpl.id}_m${m.id}_${toStorySlug(gkName)}`,
                headlineId: renderTemplate(tmpl.template, {
                  gk_name: gkName,
                  gk_pct: gkInfo?.ownershipPct ?? 0,
                  taker_name: takerName,
                  taker_pct: takerInfo?.ownershipPct ?? 0,
                  club,
                  opponent: opp,
                }),
                headlineEn: `Goalkeeper [P:${gkName}] saved a penalty from [P:${takerName}] in [C:${club}] vs [C:${opp}].`,
                dramaScore: 93,
              });
            }
          }
          break;
        }

        // 40. BM_PENALTY_MISSED
        case 'BM_PENALTY_MISSED': {
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

        // 41. BM_CARD_RED
        case 'BM_CARD_RED': {
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

        // 42. BM_INJURY_UPDATE
        case 'BM_INJURY_UPDATE': {
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

        // 43. BM_CAPTAIN_RETURN
        case 'BM_CAPTAIN_RETURN': {
          if (upcomingFixtures.length > 0) {
            const sortedUp = [...upcomingFixtures].sort(
              (a: any, b: any) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime()
            );
            const nextKickoff = sortedUp[0].kickoff_time;
            const lastFinished = [...finishedFixtures].sort(
              (a: any, b: any) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()
            )[0];
            const isShortBreak = lastFinished ? isSameWibDate(lastFinished.kickoff_time, nextKickoff) : false;
            const wibDay = formatWibDay(nextKickoff);
            const wibTime = formatWibTime(nextKickoff);
            if (!wibDay || !wibTime) break;

            const capPlayers: any[] = Array.isArray(ctx.snap?.top_captains) ? ctx.snap.top_captains : [];
            if (capPlayers.length > 0) {
              const topCap = capPlayers[0];
              const capName = topCap.web_name || topCap.name;
              if (!capName) break;
              const capCount = topCap.captain_count || topCap.count || 0;
              const capStats = topCap.id ? playerMap.get(topCap.id) : null;
              const capPts = capStats?.points ?? topCap.gw_points ?? 0;

              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, isShortBreak ? 'Jeda Pendek' : 'Jeda Panjang', {
                  captain: capName,
                  count: capCount,
                  pts: capPts * 2,
                  gw: currentGw,
                  wib_day: wibDay,
                  kickoff_time: wibTime,
                }),
                headlineEn: `Captain [P:${capName}] ([N:${capCount}] teams) returned [N:${capPts * 2} Pts] ahead of upcoming Gameweek [N:${currentGw}] fixtures.`,
                dramaScore: 88,
              });
            }
          }
          break;
        }

        // 44. BM_BENCH_REGRET
        case 'BM_BENCH_REGRET': {
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

        // 45. BM_AUTOSUB_WATCH
        case 'BM_AUTOSUB_WATCH': {
          const watches: { playerDnp: string; club: string; team: string; ownersCount: number }[] = [];
          const teamDnpSeen = new Set<string>();
          for (const op of ownershipList) {
            const pInfo = playerMap.get(op.id);
            if (!pInfo || pInfo.minutes > 0 || !finishedClubFixtureMap.has(pInfo.club)) continue;
            for (const o of op.owners || []) {
              if (!o.is_starter || teamDnpSeen.has(o.entry_name)) continue;
              teamDnpSeen.add(o.entry_name);
              watches.push({
                playerDnp: pInfo.name,
                club: pInfo.club,
                team: o.entry_name,
                ownersCount: pInfo.ownersCount,
              });
            }
          }
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
                headlineEn: `Starter [P:${w.playerDnp}] ([C:${w.club}]) played 0 minutes, putting [T:${w.team}] on autosub watch.`,
                dramaScore: 84,
              });
            });
          break;
        }

        // 46. BM_TOP_RIVALRY
        case 'BM_TOP_RIVALRY': {
          if (standings.length >= 2) {
            const sorted = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
            const r1 = sorted[0];
            const r2 = sorted[1];
            const margin = (r1.total_points || 0) - (r2.total_points || 0);
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team_1: r1.entry_name,
                margin,
                team_2: r2.entry_name,
              }),
              headlineEn: `In the provisional Gameweek [N:${currentGw}] standings, [T:${r1.entry_name}] leads [T:${r2.entry_name}] in 2nd place by [N:${margin} Pts].`,
              dramaScore: 91,
            });
          }
          break;
        }

        // 47. BM_GW_LEADER
        case 'BM_GW_LEADER': {
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
                headlineEn: `[T:${gwTop.entry_name}] leads the provisional Gameweek [N:${currentGw}] points table with [N:${gwTop.event_points} Pts].`,
                dramaScore: 89,
              });
            }
          }
          break;
        }

        // 48. BM_REMAINING_ASSETS
        case 'BM_REMAINING_ASSETS': {
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
                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(c.team)}`,
                  headlineId: renderTemplateBranch(tmpl.template, cond, {
                    gw: currentGw,
                    team: c.team,
                    remaining_count: c.remainingCount,
                    captain: c.captain?.name || c.featured.name,
                    captain_club: c.captain?.club || c.featured.club,
                    player: c.featured.name,
                    club: c.featured.club,
                  }),
                  headlineEn: `[T:${c.team}] still has [N:${c.remainingCount}] players yet to play in Gameweek [N:${currentGw}].`,
                  dramaScore: 86,
                });
              });
          }
          break;
        }
      }

      stories.push(...finalizeStories(tmpl, produced, currentGw, 'Between Match', nowIso));
    } catch (err: any) {
      console.warn(`[BetweenMatchGenerator] Error rendering ${tmpl.id}:`, err.message);
    }
  }

  return stories;
}

/**
 * Generates real factual stories for all 13 Provisional templates (PV_*)
 */
export function generateProvisionalStories(targetGw?: number): GeneratedPhaseStory[] {
  const templates = getPhase1Templates().filter(
    (t) => (t.gw_phase || '').trim().toLowerCase() === 'provisional'
  );
  if (templates.length === 0) return [];

  const ctx = loadContextData(targetGw);
  const { currentGw, dbData, standings, snap, rawPayload, playerMap, ownershipList, fixtures } = ctx;
  if (!currentGw) return [];
  const nowIso = new Date().toISOString();
  const stories: GeneratedPhaseStory[] = [];

  const topCaptains: any[] = Array.isArray(snap?.top_captains) ? snap.top_captains : [];

  for (const tmpl of templates) {
    try {
      const produced: EmittedStoryDraft[] = [];

      switch (tmpl.id) {
        // 49. PV_TOP_RIVALRY
        case 'PV_TOP_RIVALRY': {
          if (standings.length >= 2) {
            const sorted = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
            const r1 = sorted[0];
            const r2 = sorted[1];
            const margin = (r1.total_points || 0) - (r2.total_points || 0);
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team_1: r1.entry_name,
                pts_1: r1.total_points,
                margin,
                team_2: r2.entry_name,
                pts_2: r2.total_points,
              }),
              headlineEn: `After all Gameweek [N:${currentGw}] fixtures, [T:${r1.entry_name}] provisionally tops the table with [N:${r1.total_points} Pts], [N:${margin} Pts] ahead of [T:${r2.entry_name}] ([N:${r2.total_points} Pts]).`,
              dramaScore: 93,
            });
          }
          break;
        }

        // 50. PV_GW_LEADER
        case 'PV_GW_LEADER': {
          if (standings.length >= 2) {
            const byGw = [...standings].sort((a, b) => (b.event_points || 0) - (a.event_points || 0));
            const l1 = byGw[0];
            const l2 = byGw[1];
            if (l1 && l2 && l1.event_points > 0) {
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplate(tmpl.template, {
                  gw: currentGw,
                  team: l1.entry_name,
                  gw_pts: l1.event_points,
                  team_2: l2.entry_name,
                  gw_pts_2: l2.event_points,
                }),
                headlineEn: `[T:${l1.entry_name}] leads provisional Gameweek [N:${currentGw}] scoring with [N:${l1.event_points} Pts], ahead of [T:${l2.entry_name}] ([N:${l2.event_points} Pts]).`,
                dramaScore: 91,
              });
            }
          }
          break;
        }

        // 51. PV_TOP_SCORER_GW
        case 'PV_TOP_SCORER_GW': {
          const scored = Array.from(playerMap.values())
            .filter((p) => p.points > 0)
            .sort((a, b) => b.points - a.points || b.ownersCount - a.ownersCount);
          if (scored.length > 0) {
            const maxPts = scored[0].points;
            scored
              .filter((p) => p.points === maxPts)
              .slice(0, 3)
              .forEach((tp, idx, arr) => {
                produced.push({
                  id: arr.length === 1 ? tmpl.id : `${tmpl.id}_${idx + 1}_${toStorySlug(tp.name)}`,
                  headlineId: renderTemplate(tmpl.template, {
                    gw: currentGw,
                    player: tp.name,
                    club: tp.club,
                    points: tp.points,
                    goals: tp.goals,
                    assists: tp.assists,
                    owners_count: tp.ownersCount,
                  }),
                  headlineEn: `[P:${tp.name}] ([C:${tp.club}]) leads provisional Gameweek [N:${currentGw}] scoring with [N:${tp.points} Pts] ([N:${tp.goals} Goals], [N:${tp.assists} Assists]), owned by [N:${tp.ownersCount}] teams.`,
                  dramaScore: 90,
                });
              });
          }
          break;
        }

        // 52. PV_CAPTAIN_RECAP
        case 'PV_CAPTAIN_RECAP': {
          if (topCaptains.length >= 2) {
            const c1 = topCaptains[0];
            const c2 = topCaptains[1];
            const c1Info = c1.id ? playerMap.get(c1.id) : null;
            const c2Info = c2.id ? playerMap.get(c2.id) : null;
            const pts1 = c1Info?.points ?? c1.gw_points ?? 0;
            const pts2 = c2Info?.points ?? c2.gw_points ?? 0;
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                captain_1: c1.web_name || c1.name,
                count_1: c1.captain_count || c1.count || 0,
                pts_1: pts1 * 2,
                captain_2: c2.web_name || c2.name,
                count_2: c2.captain_count || c2.count || 0,
                pts_2: pts2 * 2,
              }),
              headlineEn: `Top Gameweek [N:${currentGw}] captains [P:${c1.web_name || c1.name}] ([N:${c1.captain_count || c1.count || 0}] teams) and [P:${c2.web_name || c2.name}] ([N:${c2.captain_count || c2.count || 0}] teams) delivered [N:${pts1 * 2} Pts] and [N:${pts2 * 2} Pts] provisionally.`,
              dramaScore: 87,
            });
          }
          break;
        }

        // 53. PV_VICE_CAPTAIN
        case 'PV_VICE_CAPTAIN': {
          if (rawPayload) {
            const vcSwaps: { team: string; dnpCap: string; vcName: string; vcPts: number }[] = [];
            const nameIdMap = new Map<string, IndexedPlayerGwStat>();
            for (const p of playerMap.values()) {
              nameIdMap.set(p.name.toLowerCase(), p);
            }

            for (const s of rawPayload.standingsTable) {
              const capStarter = (s.starters || []).find((st) => st.isC);
              const vcStarter = (s.starters || []).find((st) => st.isVC);
              if (!capStarter || !vcStarter) continue;
              const capStat = nameIdMap.get(capStarter.name.toLowerCase());
              const vcStat = nameIdMap.get(vcStarter.name.toLowerCase());
              if (capStat && capStat.minutes === 0 && vcStat && vcStat.minutes > 0) {
                vcSwaps.push({
                  team: s.team,
                  dnpCap: capStarter.name,
                  vcName: vcStarter.name,
                  vcPts: vcStat.points,
                });
              }
            }

            vcSwaps
              .sort((a, b) => b.vcPts - a.vcPts)
              .slice(0, 3)
              .forEach((v, idx) => {
                produced.push({
                  id: `${tmpl.id}_${idx + 1}_${toStorySlug(v.team)}`,
                  headlineId: renderTemplate(tmpl.template, {
                    team: v.team,
                    vice_captain: v.vcName,
                    vice_pts: v.vcPts,
                    captain_dnp: v.dnpCap,
                  }),
                  headlineEn: `[T:${v.team}] saw the captaincy pass to vice-captain [P:${v.vcName}] ([N:${v.vcPts} Pts]) as [P:${v.dnpCap}] did not play.`,
                  dramaScore: 89,
                });
              });
          }
          break;
        }

        // 54. PV_AUTOSUB_PENDING
        case 'PV_AUTOSUB_PENDING': {
          const pendingSubs: { team: string; dnp: string; bench: string; benchPts: number }[] = [];
          if (ownershipList.length > 0) {
            const teamStarters = new Map<string, { name: string; minutes: number }[]>();
            const teamBench = new Map<string, { name: string; minutes: number; points: number }[]>();

            for (const op of ownershipList) {
              const pInfo = playerMap.get(op.id);
              for (const o of op.owners || []) {
                if (o.is_starter) {
                  if (!teamStarters.has(o.entry_name)) teamStarters.set(o.entry_name, []);
                  teamStarters.get(o.entry_name)!.push({
                    name: op.web_name,
                    minutes: pInfo?.minutes || 0,
                  });
                } else {
                  if (!teamBench.has(o.entry_name)) teamBench.set(o.entry_name, []);
                  teamBench.get(o.entry_name)!.push({
                    name: op.web_name,
                    minutes: pInfo?.minutes || 0,
                    points: pInfo?.points || 0,
                  });
                }
              }
            }

            for (const [team, starters] of teamStarters.entries()) {
              const dnp = starters.find((s) => s.minutes === 0);
              const bench = (teamBench.get(team) || [])
                .filter((b) => b.minutes > 0 && b.points > 0)
                .sort((a, b) => b.points - a.points)[0];
              if (dnp && bench) {
                pendingSubs.push({ team, dnp: dnp.name, bench: bench.name, benchPts: bench.points });
              }
            }
          }

          pendingSubs
            .sort((a, b) => b.benchPts - a.benchPts)
            .slice(0, 3)
            .forEach((sub, idx) => {
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(sub.team)}`,
                headlineId: renderTemplate(tmpl.template, {
                  team: sub.team,
                  bench_player: sub.bench,
                  bench_pts: sub.benchPts,
                  player_dnp: sub.dnp,
                }),
                headlineEn: `[T:${sub.team}] awaits automatic substitution to bring [P:${sub.bench}] ([N:${sub.benchPts} Pts]) on for [P:${sub.dnp}].`,
                dramaScore: 86,
              });
            });
          break;
        }

        // 55. PV_BENCH_POINTS
        case 'PV_BENCH_POINTS': {
          if (rawPayload) {
            const topBenches = [...rawPayload.standingsTable]
              .filter((s) => s.benchPts > 0 && (s.bench || []).some((b) => b.pts > 0))
              .sort((a, b) => b.benchPts - a.benchPts)
              .slice(0, 3);

            topBenches.forEach((tb, idx) => {
              const topPlayer = [...tb.bench].sort((a, b) => b.pts - a.pts)[0];
              produced.push({
                id: `${tmpl.id}_${idx + 1}_${toStorySlug(tb.team)}`,
                headlineId: renderTemplate(tmpl.template, {
                  total_bench_pts: tb.benchPts,
                  team: tb.team,
                  gw: currentGw,
                  player: topPlayer.name,
                  player_pts: topPlayer.pts,
                }),
                headlineEn: `[T:${tb.team}] left [N:${tb.benchPts} Pts] on the bench in Gameweek [N:${currentGw}], led by [P:${topPlayer.name}] ([N:${topPlayer.pts} Pts]).`,
                dramaScore: 86,
              });
            });
          }
          break;
        }

        // 56. PV_CHIP_WILDCARD
        case 'PV_CHIP_WILDCARD': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let idx = 0;
          for (const entry of allChips) {
            const wc = entry.wc1?.gw === currentGw ? entry.wc1 : (entry.wc2?.gw === currentGw ? entry.wc2 : null);
            if (!wc) continue;
            idx++;
            const st = standings.find((s) => s.entry_name === entry.entry_name);
            const gwPts = wc.points ?? st?.event_points ?? 0;
            produced.push({
              id: `${tmpl.id}_${idx}_${toStorySlug(entry.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team: entry.entry_name,
                gw_pts: gwPts,
              }),
              headlineEn: `Activating [N:Wildcard] in Gameweek [N:${currentGw}], [T:${entry.entry_name}] collected [N:${gwPts} Pts] provisionally.`,
              dramaScore: 86,
            });
          }
          break;
        }

        // 57. PV_CHIP_FREEHIT
        case 'PV_CHIP_FREEHIT': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let idx = 0;
          for (const entry of allChips) {
            const fh = entry.fh1?.gw === currentGw ? entry.fh1 : (entry.fh2?.gw === currentGw ? entry.fh2 : null);
            if (!fh) continue;
            idx++;
            const st = standings.find((s) => s.entry_name === entry.entry_name);
            const gwPts = fh.points ?? st?.event_points ?? 0;
            produced.push({
              id: `${tmpl.id}_${idx}_${toStorySlug(entry.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team: entry.entry_name,
                gw_pts: gwPts,
              }),
              headlineEn: `Activating [N:Free Hit] in Gameweek [N:${currentGw}], [T:${entry.entry_name}] collected [N:${gwPts} Pts] provisionally.`,
              dramaScore: 86,
            });
          }
          break;
        }

        // 58. PV_CHIP_BENCH_BOOST
        case 'PV_CHIP_BENCH_BOOST': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let idx = 0;
          for (const entry of allChips) {
            const bb = entry.bb1?.gw === currentGw ? entry.bb1 : (entry.bb2?.gw === currentGw ? entry.bb2 : null);
            if (!bb) continue;
            idx++;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === entry.entry_name);
            const benchPts = typeof teamRow?.benchPts === 'number' ? teamRow.benchPts : (bb.points ?? 0);
            produced.push({
              id: `${tmpl.id}_${idx}_${toStorySlug(entry.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team: entry.entry_name,
                bench_pts: benchPts,
              }),
              headlineEn: `Activating [N:Bench Boost] in Gameweek [N:${currentGw}], [T:${entry.entry_name}] gained [N:${benchPts} Pts] provisionally from the bench.`,
              dramaScore: 88,
            });
          }
          break;
        }

        // 59. PV_CHIP_TRIPLE_CAPTAIN
        case 'PV_CHIP_TRIPLE_CAPTAIN': {
          const allChips: any[] = Array.isArray(dbData?.league_analytics?.all_chips_used)
            ? dbData.league_analytics.all_chips_used
            : [];
          let idx = 0;
          for (const entry of allChips) {
            const tc = entry.tc1?.gw === currentGw ? entry.tc1 : (entry.tc2?.gw === currentGw ? entry.tc2 : null);
            if (!tc) continue;
            const teamRow = rawPayload?.standingsTable?.find((s) => s.team === entry.entry_name);
            const teamStanding = standings.find((s) => s.entry_name === entry.entry_name);
            const capStarter = teamRow?.starters?.find((st) => st.isC);
            const capName = capStarter?.name || teamStanding?.captain?.name;
            if (!capName) continue;
            idx++;
            const totalPts = capStarter ? capStarter.pts : (tc.points ?? teamStanding?.event_points ?? 0);
            produced.push({
              id: `${tmpl.id}_${idx}_${toStorySlug(entry.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                gw: currentGw,
                team: entry.entry_name,
                total_pts: totalPts,
                captain: capName,
              }),
              headlineEn: `Activating [N:Triple Captain] in Gameweek [N:${currentGw}], [T:${entry.entry_name}] collected [N:${totalPts} Pts] provisionally from [P:${capName}].`,
              dramaScore: 89,
            });
          }
          break;
        }

        // 60. PV_HITS_EVALUATION
        case 'PV_HITS_EVALUATION': {
          const hitTeams = standings
            .filter((s) => (s.event_transfers_cost || 0) > 0)
            .sort((a, b) => (b.event_transfers_cost || 0) - (a.event_transfers_cost || 0))
            .slice(0, 3);

          const allGwTransfers = (dbData?.league_analytics?.all_transfers || []).filter(
            (tr: any) => Number(tr.event) === currentGw && tr.element_in?.name
          );

          hitTeams.forEach((ht, idx) => {
            const teamTransfers = allGwTransfers
              .filter((tr: any) => tr.entry_id === ht.entry_id || tr.entry_name === ht.entry_name)
              .sort((a: any, b: any) => (b.element_in?.gw_points || 0) - (a.element_in?.gw_points || 0));
            const bestIn = teamTransfers[0]?.element_in;
            if (!bestIn) return;

            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(ht.entry_name)}`,
              headlineId: renderTemplate(tmpl.template, {
                team: ht.entry_name,
                hits_pts: ht.event_transfers_cost,
                gw: currentGw,
                player_in: bestIn.name,
                player_pts: Number(bestIn.gw_points) || 0,
              }),
              headlineEn: `[T:${ht.entry_name}] faces a [N:-${ht.event_transfers_cost} Pts] hit deduction in Gameweek [N:${currentGw}], while new signing [P:${bestIn.name}] returned [N:${Number(bestIn.gw_points) || 0} Pts].`,
              dramaScore: 86,
            });
          });
          break;
        }

        // 61. PV_CLEAN_SHEET_RECAP
        case 'PV_CLEAN_SHEET_RECAP': {
          const csWins: { club: string; opponent: string; score: string }[] = [];
          for (const f of fixtures) {
            if (!f.finished && !f.finished_provisional) continue;
            const hs = Number(f.team_h_score ?? 0);
            const as = Number(f.team_a_score ?? 0);
            const home = resolveClubName(f.home_team);
            const away = resolveClubName(f.away_team);
            if (!home || !away) continue;
            if (hs > as && as === 0) {
              csWins.push({ club: home, opponent: away, score: `${hs} - ${as}` });
            } else if (as > hs && hs === 0) {
              csWins.push({ club: away, opponent: home, score: `${as} - ${hs}` });
            }
          }

          for (const cw of csWins) {
            const topDef = Array.from(playerMap.values())
              .filter(
                (p) =>
                  p.club === cw.club &&
                  (p.position === 'DEF' || p.position === 'GKP') &&
                  p.minutes >= 60 &&
                  p.ownersCount > 0
              )
              .sort((a, b) => b.ownersCount - a.ownersCount || b.points - a.points)[0];

            if (!topDef) continue;
            produced.push({
              id: `${tmpl.id}_${toStorySlug(cw.club)}_${toStorySlug(topDef.name)}`,
              headlineId: renderTemplate(tmpl.template, {
                club: cw.club,
                score: cw.score,
                opponent: cw.opponent,
                gw: currentGw,
                owners_count: topDef.ownersCount,
                defender: topDef.name,
              }),
              headlineEn: `[C:${cw.club}] kept a clean sheet in their [N:${cw.score}] win over [C:${cw.opponent}] in Gameweek [N:${currentGw}], rewarding [N:${topDef.ownersCount}] teams owning [P:${topDef.name}].`,
              dramaScore: 85,
            });
          }
          break;
        }
      }

      stories.push(...finalizeStories(tmpl, produced, currentGw, 'Provisional', nowIso));
    } catch (err: any) {
      console.warn(`[ProvisionalGenerator] Error rendering ${tmpl.id}:`, err.message);
    }
  }

  return stories;
}
