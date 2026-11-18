import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';
import { getOptimalDatabase, getGwSnapshot, getDbStandings } from './db.ts';
import { buildRawMatchdayPayload } from './newsAggregator.ts';
import { formatTeamList } from './teamExposureTracker.ts';
import { resolveClubName } from '../utils/clubNameResolver.ts';
import { computeValidFplAutosubs } from './fplAutosub.ts';

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
  template: string,
  conditionKeyword: string,
  vars: Record<string, string | number>
): string {
  if (template.includes('[Kondisi:')) {
    const sections = template.split(/\[Kondisi:\s*([^\]]+)\]/i);
    for (let i = 1; i < sections.length; i += 2) {
      const condName = sections[i].trim().toLowerCase();
      const body = sections[i + 1]?.trim() || '';
      if (condName.includes(conditionKeyword.toLowerCase())) {
        return renderTemplate(body, vars);
      }
    }
    return '';
  }
  return renderTemplate(template, vars);
}

function formatPlayerClubList(
  players: Array<{ name: string; club: string }>,
  lang: 'id' | 'en' = 'id'
): string {
  const tags = players.map((p) => `[P:${p.name}] ([C:${p.club}])`);
  const n = tags.length;
  if (n === 0) return '';
  if (n === 1) return tags[0];
  if (n === 2) return lang === 'id' ? `${tags[0]} dan ${tags[1]}` : `${tags[0]} and ${tags[1]}`;
  if (n === 3) return lang === 'id' ? `${tags[0]}, ${tags[1]}, dan ${tags[2]}` : `${tags[0]}, ${tags[1]}, and ${tags[2]}`;
  const remaining = n - 2;
  return lang === 'id'
    ? `${tags[0]}, ${tags[1]}, dan [N:${remaining}] pemain lainnya`
    : `${tags[0]}, ${tags[1]}, and [N:${remaining}] other players`;
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

function loadProvisionalContext(targetGw?: number) {
  const dbData = getOptimalDatabase();
  const currentGw = targetGw || Number(dbData?.meta?.current_gw) || 0;
  const standings = currentGw ? getDbStandings(currentGw) : [];
  const snap = currentGw ? getGwSnapshot(currentGw) : null;
  const rawPayload = currentGw ? buildRawMatchdayPayload(currentGw) : null;

  const dbPlayersArr: any[] = Object.values(dbData?.players || {});
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
  };
}

function finalizeProvisionalStories(
  tmpl: Phase1TemplateItem,
  produced: EmittedStoryDraft[],
  gw: number,
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
      waktu_tayang: ['Provisional'],
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
 * Generates real factual stories for all 17 Provisional templates (PV_*)
 */
export function generateProvisionalStories(targetGw?: number): GeneratedPhaseStory[] {
  const templates = getPhase1Templates().filter(
    (t) => (t.gw_phase || '').trim().toLowerCase() === 'provisional'
  );
  if (templates.length === 0) return [];

  const ctx = loadProvisionalContext(targetGw);
  const { currentGw, dbData, standings, snap, rawPayload, playerMap, ownershipList, fixtures } = ctx;
  if (!currentGw) return [];
  const nowIso = new Date().toISOString();
  const stories: GeneratedPhaseStory[] = [];

  const topCaptains: any[] = Array.isArray(snap?.top_captains) ? snap.top_captains : [];

  for (const tmpl of templates) {
    try {
      const produced: EmittedStoryDraft[] = [];

      switch (tmpl.id) {
        // 49. PV_STANDINGS_TITLE_RACE
        case 'PV_STANDINGS_TITLE_RACE': {
          if (standings.length >= 2) {
            const sorted = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
            const r1 = sorted[0];
            const r2 = sorted[1];
            const margin = (r1.total_points || 0) - (r2.total_points || 0);
            const isTied = margin === 0;
            produced.push({
              id: tmpl.id,
              headlineId: renderTemplateBranch(tmpl.template, isTied ? 'Poin Sama' : 'Unggul Poin', {
                gw: currentGw,
                team_1: r1.entry_name,
                pts_1: r1.total_points,
                margin,
                team_2: r2.entry_name,
                pts_2: r2.total_points,
              }),
              headlineEn: isTied
                ? `[T:${r1.entry_name}] and [T:${r2.entry_name}] are tied provisionally on [N:${r1.total_points} Pts] at the top after all fixtures.`
                : `[T:${r1.entry_name}] provisionally tops the table with [N:${r1.total_points} Pts], [N:${margin} Pts] ahead of [T:${r2.entry_name}] ([N:${r2.total_points} Pts]) after all fixtures.`,
              dramaScore: 93,
            });
          }
          break;
        }

        // 50. PV_STANDINGS_GAMEWEEK_LEADER
        case 'PV_STANDINGS_GAMEWEEK_LEADER': {
          if (standings.length >= 2) {
            const byGw = [...standings].sort((a, b) => (b.event_points || 0) - (a.event_points || 0));
            const l1 = byGw[0];
            const l2 = byGw[1];
            if (l1 && l2 && l1.event_points > 0) {
              const maxPts = l1.event_points;
              const tiedLeaders = byGw.filter((s) => (s.event_points || 0) === maxPts);
              if (tiedLeaders.length > 1) {
                const teamsId = formatTeamList(tiedLeaders.map((t) => t.entry_name), 'id', false);
                const teamsEn = formatTeamList(tiedLeaders.map((t) => t.entry_name), 'en', false);
                produced.push({
                  id: tmpl.id,
                  headlineId: renderTemplateBranch(tmpl.template, 'Poin Sama', {
                    gw: currentGw,
                    teams_list: teamsId,
                    gw_pts: maxPts,
                  }),
                  headlineEn: `${teamsEn} share the provisional Gameweek scoring lead with [N:${maxPts} Pts].`,
                  dramaScore: 91,
                });
              } else {
                produced.push({
                  id: tmpl.id,
                  headlineId: renderTemplateBranch(tmpl.template, 'Pemimpin Tunggal', {
                    gw: currentGw,
                    team: l1.entry_name,
                    gw_pts: l1.event_points,
                    team_2: l2.entry_name,
                    gw_pts_2: l2.event_points,
                  }),
                  headlineEn: `[T:${l1.entry_name}] leads provisional scoring with [N:${l1.event_points} Pts], ahead of [T:${l2.entry_name}] ([N:${l2.event_points} Pts]).`,
                  dramaScore: 91,
                });
              }
            }
          }
          break;
        }

        // 51. PV_PLAYER_TOP_PERFORMER (SINGLE-NEWS: 1 pemain atau beberapa pemain dengan poin tertinggi sama)
        case 'PV_PLAYER_TOP_PERFORMER': {
          const scored = Array.from(playerMap.values())
            .filter((p) => p.points > 0)
            .sort((a, b) => b.points - a.points || b.ownersCount - a.ownersCount || b.goals - a.goals || b.assists - a.assists);
          if (scored.length > 0) {
            const maxPts = scored[0].points;
            const topPlayers = scored.filter((p) => p.points === maxPts);
            if (topPlayers.length === 1) {
              const tp = topPlayers[0];
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Pemain Tunggal', {
                  gw: currentGw,
                  player: tp.name,
                  club: tp.club,
                  points: tp.points,
                  goals: tp.goals,
                  assists: tp.assists,
                  owners_count: tp.ownersCount,
                }),
                headlineEn: `[P:${tp.name}] ([C:${tp.club}]) leads provisional scoring with [N:${tp.points} Pts] ([N:${tp.goals} Goals], [N:${tp.assists} Assists]), owned by [N:${tp.ownersCount}] teams.`,
                dramaScore: 90,
              });
            } else {
              const playersId = formatPlayerClubList(topPlayers, 'id');
              const playersEn = formatPlayerClubList(topPlayers, 'en');
              produced.push({
                id: tmpl.id,
                headlineId: renderTemplateBranch(tmpl.template, 'Poin Sama', {
                  gw: currentGw,
                  players_list: playersId,
                  points: maxPts,
                }),
                headlineEn: `${playersEn} share the provisional top-scoring player honor with [N:${maxPts} Pts] each.`,
                dramaScore: 90,
              });
            }
          }
          break;
        }

        // 52. PV_CAPTAIN_POPULAR_MOST_CAPTAINED
        case 'PV_CAPTAIN_POPULAR_MOST_CAPTAINED': {
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
              headlineEn: `[P:${c1.web_name || c1.name}] ([N:${c1.captain_count || c1.count || 0}] teams) and [P:${c2.web_name || c2.name}] ([N:${c2.captain_count || c2.count || 0}] teams) lead the captaincy picks with [N:${pts1 * 2} Pts] and [N:${pts2 * 2} Pts] provisionally.`,
              dramaScore: 87,
            });
          }
          break;
        }

        // 53. PV_CAPTAIN_VICE_CAPTAIN
        case 'PV_CAPTAIN_VICE_CAPTAIN': {
          if (rawPayload) {
            const findPlayerStatByNameClub = (name: string, clubRaw?: string): IndexedPlayerGwStat | undefined => {
              const lower = (name || '').trim().toLowerCase();
              const club = clubRaw ? resolveClubName(clubRaw, '') : '';
              for (const p of playerMap.values()) {
                if (p.name.toLowerCase() === lower && (!club || p.club === club)) return p;
              }
              for (const p of playerMap.values()) {
                if (p.name.toLowerCase() === lower) return p;
              }
              return undefined;
            };

            const vcSwaps: { team: string; dnpCap: string; vcName: string; vcPts: number }[] = [];
            for (const s of rawPayload.standingsTable) {
              const capStarter = (s.starters || []).find((st) => st.isC);
              const vcStarter = (s.starters || []).find((st) => st.isVC);
              if (!capStarter || !vcStarter) continue;
              const capStat = findPlayerStatByNameClub(capStarter.name, capStarter.club);
              const vcStat = findPlayerStatByNameClub(vcStarter.name, vcStarter.club);
              if (capStat && capStat.minutes === 0 && vcStat && vcStat.minutes > 0) {
                const stMatch = standings.find((st: any) => st.entry_name === s.team);
                const chipLower = String(s.chip || stMatch?.active_chip || '').toLowerCase();
                const isTc = chipLower === 'tc' || chipLower === '3xc' || chipLower.includes('triple');
                vcSwaps.push({
                  team: s.team,
                  dnpCap: capStat.name,
                  vcName: vcStat.name,
                  vcPts: vcStat.points * (isTc ? 3 : 2),
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

        // 54. PV_LINEUP_AUTOSUB_PENDING
        case 'PV_LINEUP_AUTOSUB_PENDING': {
          const pendingSubs = ownershipList.length > 0
            ? computeValidFplAutosubs(ownershipList, standings, (id, op) => {
                const pInfo = playerMap.get(id);
                if (!pInfo) return undefined;
                return {
                  id,
                  name: op.web_name || pInfo.name,
                  club: pInfo.club,
                  position: op.position || pInfo.position,
                  minutes: pInfo.minutes,
                  points: pInfo.points,
                };
              })
            : [];

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

        // 55. PV_LINEUP_BENCH_TOTAL
        case 'PV_LINEUP_BENCH_TOTAL': {
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
                headlineEn: `[T:${tb.team}] left [N:${tb.benchPts} Pts] on the bench, led by [P:${topPlayer.name}] ([N:${topPlayer.pts} Pts]).`,
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
              headlineEn: `[T:${entry.entry_name}] collected [N:${gwPts} Pts] provisionally via [N:Wildcard].`,
              dramaScore: 86,
            });
          }
          break;
        }

        // 57. PV_CHIP_FREE_HIT
        case 'PV_CHIP_FREE_HIT': {
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
              headlineEn: `[T:${entry.entry_name}] collected [N:${gwPts} Pts] provisionally via [N:Free Hit].`,
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
              headlineEn: `[T:${entry.entry_name}] gained [N:${benchPts} Pts] provisionally from the bench via [N:Bench Boost].`,
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
              headlineEn: `[T:${entry.entry_name}] collected [N:${totalPts} Pts] provisionally from captain [P:${capName}] via [N:Triple Captain].`,
              dramaScore: 89,
            });
          }
          break;
        }

        // 60. PV_TRANSFER_HITS_EVALUATION
        case 'PV_TRANSFER_HITS_EVALUATION': {
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
              headlineEn: `[T:${ht.entry_name}] faces a [N:-${ht.event_transfers_cost} Pts] hit deduction, while new signing [P:${bestIn.name}] returned [N:${Number(bestIn.gw_points) || 0} Pts].`,
              dramaScore: 86,
            });
          });
          break;
        }

        // 61. PV_MATCH_CLEAN_SHEET
        case 'PV_MATCH_CLEAN_SHEET': {
          const csWins: { club: string; opponent: string; score: string }[] = [];
          for (const f of fixtures) {
            if (!f.finished && !f.finished_provisional) continue;
            const hs = Number(f.team_h_score ?? 0);
            const as = Number(f.team_a_score ?? 0);
            const home = resolveClubName(f.home_team);
            const away = resolveClubName(f.away_team);
            if (!home || !away) continue;
            if (as === 0) {
              csWins.push({ club: home, opponent: away, score: `${hs} - ${as}` });
            }
            if (hs === 0) {
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
              headlineEn: `[C:${cw.club}] locked in a clean sheet against [C:${cw.opponent}] ([N:${cw.score}]), delivering provisional points for [N:${topDef.ownersCount}] owners of [P:${topDef.name}].`,
              dramaScore: 85,
            });
          }
          break;
        }

        // 90. PV_STANDINGS_RANK_MOVEMENT
        case 'PV_STANDINGS_RANK_MOVEMENT': {
          if (standings.length > 0) {
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
                headlineEn: `[T:${c.s.entry_name}] climbed [N:+${c.diff} Places] provisionally from [N:${c.s.last_rank}] to [N:${c.s.rank}] after scoring [N:${c.s.event_points || 0} Pts].`,
                dramaScore: Math.min(91, 83 + Math.floor(c.diff / 3)),
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
                headlineEn: `[T:${f.s.entry_name}] dropped [N:-${f.diff} Places] provisionally from [N:${f.s.last_rank}] to [N:${f.s.rank}] on [N:${f.s.event_points || 0} Pts].`,
                dramaScore: Math.min(90, 82 + Math.floor(f.diff / 3)),
              });
            }
          }
          break;
        }

        // 91. PV_STANDINGS_TITLE_RACE_LEAD_CHANGE
        case 'PV_STANDINGS_TITLE_RACE_LEAD_CHANGE': {
          const sortedStandings = [...standings].sort((a, b) => (a.rank || 0) - (b.rank || 0));
          const rank1 = sortedStandings[0];
          const rank2 = sortedStandings[1];
          const r1LastRank = rank1 ? Number(rank1.last_rank || rank1.rank || 1) : 1;
          const coupOccurred = Boolean(rank1 && r1LastRank > 1);

          if (coupOccurred && rank1 && rank2) {
            const formerLeader =
              sortedStandings.find((s) => Number(s.last_rank) === 1 && s.entry_name !== rank1.entry_name) || rank2;
            const margin = (rank1.total_points || 0) - (rank2.total_points || 0);
            const isTied = margin === 0;

            produced.push({
              id: tmpl.id,
              headlineId: renderTemplateBranch(tmpl.template, isTied ? 'Poin Sama' : 'Unggul Poin', {
                gw: currentGw,
                new_leader: rank1.entry_name,
                old_rank: r1LastRank,
                former_leader: formerLeader.entry_name,
                former_new_rank: formerLeader.rank,
                margin,
                total_pts: rank1.total_points || 0,
              }),
              headlineEn: isTied
                ? `[T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to join the provisional top spot on [N:${rank1.total_points || 0} Pts], displacing [T:${formerLeader.entry_name}] to rank [N:${formerLeader.rank}].`
                : `[T:${rank1.entry_name}] climbed from rank [N:${r1LastRank}] to take the provisional lead, overtaking [T:${formerLeader.entry_name}] (now rank [N:${formerLeader.rank}]) by [N:${margin} Pts].`,
              dramaScore: 97,
            });
          }
          break;
        }

        // 92. PV_TRANSFER_OUT_SOLD_HAULERS
        case 'PV_TRANSFER_OUT_SOLD_HAULERS': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Transfer' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            const clubResolved = resolveClubName(grp.club);
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: clubResolved,
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} sold [P:${grp.player}] ([C:${clubResolved}]), who went on to score [N:${grp.playerPts} Pts] provisionally.`,
              dramaScore: Math.min(95, 84 + Math.min(8, grp.teamCount) + Math.min(4, Math.floor(grp.playerPts / 3))),
            });
          });

          if (produced.length < 3) {
            const allGwTransfers = (dbData?.league_analytics?.all_transfers || []).filter(
              (tr: any) => Number(tr.event) === currentGw && tr.element_out && tr.element_in
            );
            const singleCandidates = allGwTransfers
              .map((tr: any) => ({
                team: tr.entry_name,
                playerOut: tr.element_out.name,
                club: resolveClubName(tr.element_out.club),
                outPts: Number(tr.element_out.gw_points) || 0,
                playerIn: tr.element_in.name,
                inPts: Number(tr.element_in.gw_points) || 0,
                delta: (Number(tr.element_out.gw_points) || 0) - (Number(tr.element_in.gw_points) || 0),
              }))
              .filter((c: any) => c.delta >= 6 && !coveredPlayers.has(String(c.playerOut || '').toLowerCase()))
              .sort((a: any, b: any) => b.delta - a.delta);

            const seenSingleKey = new Set<string>();
            for (const c of singleCandidates) {
              if (produced.length >= 3) break;
              const k = `${c.team}::${c.playerOut}`;
              if (seenSingleKey.has(k)) continue;
              seenSingleKey.add(k);
              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(c.playerOut)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: c.team,
                  player: c.playerOut,
                  club: c.club,
                  points: c.outPts,
                  gw: currentGw,
                  player_in: c.playerIn,
                  in_points: c.inPts,
                }),
                headlineEn: `[T:${c.team}] sold [P:${c.playerOut}] ([C:${c.club}]) who scored [N:${c.outPts} Pts] provisionally, while replacement [P:${c.playerIn}] earned [N:${c.inPts} Pts].`,
                dramaScore: Math.min(91, 82 + Math.floor(c.delta / 2)),
              });
            }
          }
          break;
        }

        // 93. PV_CAPTAIN_ALTERNATIVE_MISSED_HAUL
        case 'PV_CAPTAIN_ALTERNATIVE_MISSED_HAUL': {
          if (!rawPayload) break;
          const multiGroups = (rawPayload.crossTeamPlayerDrama || [])
            .filter((d) => d.category === 'Captaincy' && d.teamCount >= 2)
            .slice(0, 3);
          const coveredPlayers = new Set(multiGroups.map((g) => g.player.toLowerCase()));

          multiGroups.forEach((grp, idx) => {
            const teamsId = formatTeamList(grp.teams, 'id');
            const teamsEn = formatTeamList(grp.teams, 'en');
            const clubResolved = resolveClubName(grp.club);
            produced.push({
              id: `${tmpl.id}_${idx + 1}_${toStorySlug(grp.player)}`,
              headlineId: renderTemplateBranch(tmpl.template, 'Multi Tim', {
                teams: teamsId,
                player: grp.player,
                club: clubResolved,
                points: grp.playerPts,
                gw: currentGw,
              }),
              headlineEn: `${teamsEn} fielded [P:${grp.player}] ([C:${clubResolved}]) who scored [N:${grp.playerPts} Pts] provisionally, without captaining him.`,
              dramaScore: Math.min(95, 84 + Math.min(8, Math.floor(grp.teamCount / 3)) + Math.min(4, Math.floor(grp.playerPts / 3))),
            });
          });

          if (produced.length < 3) {
            const singleRegrets = (rawPayload.whatIfOpportunities || [])
              .filter(
                (w) =>
                  w.category === 'Captaincy' &&
                  w.netDeltaPts >= 6 &&
                  !coveredPlayers.has(String(w.player || '').toLowerCase())
              )
              .slice(0, 3 - produced.length);

            for (const w of singleRegrets) {
              const teamEntry = rawPayload.standingsTable.find((s) => s.team === w.team);
              const capStarter = teamEntry?.starters?.find((st) => st.isC);
              const actualCaptainName = capStarter?.name || w.realChoice.split(' (')[0];
              const actualCaptainBasePts = w.realBasePts;
              const clubResolved = resolveClubName(w.club);
              if (!actualCaptainName || !clubResolved) continue;

              produced.push({
                id: `${tmpl.id}_s_${produced.length + 1}_${toStorySlug(w.team)}`,
                headlineId: renderTemplateBranch(tmpl.template, '1 Tim', {
                  team: w.team,
                  actual_captain: actualCaptainName,
                  captain_pts: actualCaptainBasePts,
                  gw: currentGw,
                  player: w.player,
                  club: clubResolved,
                  points: w.alternativePts,
                }),
                headlineEn: `[T:${w.team}] captained [P:${actualCaptainName}] ([N:${actualCaptainBasePts} Pts]) instead of [P:${w.player}] ([C:${clubResolved}]) who scored [N:${w.alternativePts} Pts] provisionally.`,
                dramaScore: Math.min(90, 82 + Math.floor(w.netDeltaPts / 2)),
              });
            }
          }
          break;
        }
      }

      stories.push(...finalizeProvisionalStories(tmpl, produced, currentGw, nowIso));
    } catch (err: any) {
      console.warn(`[ProvisionalGenerator] Error rendering ${tmpl.id}:`, err.message);
    }
  }

  return stories;
}
