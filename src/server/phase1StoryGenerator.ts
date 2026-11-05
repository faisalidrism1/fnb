import fs from 'fs';
import path from 'path';
import { getPhase1Templates, Phase1TemplateItem } from '../data/phase1Templates.ts';

const CACHE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

interface GeneratedPhase1Story {
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
}

/**
 * Extracts tagged entities from text
 */
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

/**
 * Formats ISO date to WIB time e.g. "18:30 WIB"
 */
function formatWibTime(isoString?: string): string {
  if (!isoString) return '18:30 WIB';
  try {
    const d = new Date(isoString);
    // WIB is UTC+7
    const utcHours = d.getUTCHours();
    const utcMinutes = d.getUTCMinutes();
    const wibHours = (utcHours + 7) % 24;
    const hh = String(wibHours).padStart(2, '0');
    const mm = String(utcMinutes).padStart(2, '0');
    return `${hh}:${mm} WIB`;
  } catch {
    return '18:30 WIB';
  }
}

/**
 * Parses and fills a template containing conditional blocks [Kondisi: ...] or simple template
 */
function renderTemplateBranch(
  rawTemplate: string,
  conditionKeyword: string,
  variables: Record<string, any>
): string {
  if (!rawTemplate) return '';

  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(rawTemplate);
  let targetBody = rawTemplate;

  if (hasConditions) {
    const lines = rawTemplate.split('\n');
    let matchingSection: string[] = [];
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
      // Fallback: pick first condition body if specific match not found
      const firstSection: string[] = [];
      let collectingFirst = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (/^\[Kondisi:/i.test(line)) {
          if (collectingFirst) break;
          collectingFirst = true;
        } else if (collectingFirst && line) {
          firstSection.push(rawLine);
        }
      }
      if (firstSection.length > 0) targetBody = firstSection.join('\n');
    }
  }

  let result = targetBody;
  for (const [k, v] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

/**
 * Generates ready-to-air news stories for all 13 Phase 1 templates based on real league data
 */
export function generatePhase1Stories(targetGw?: number): GeneratedPhase1Story[] {
  const templates = getPhase1Templates();
  let leagueData: any = null;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      leagueData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch {}

  const currentGw = targetGw || Number(leagueData?.current_gw) || 9;
  const isGwNotStarted = leagueData?.gw_status?.status === 'Not started' ||
    (leagueData?.sync_status?.gw_fixtures && leagueData.sync_status.gw_fixtures.filter((f: any) => f.event === currentGw).every((f: any) => !f.started));

  const stories: GeneratedPhase1Story[] = [];

  for (const tmpl of templates) {
    try {
      let filledHeadline = '';
      const sample = tmpl.sample_data || {};

      switch (tmpl.no) {
        // 1. Match Fixtures
        case 1: {
          const fixtures = (leagueData?.sync_status?.gw_fixtures || []).filter((f: any) => f.event === currentGw);
          if (fixtures.length > 0) {
            const earliestTime = fixtures[0].kickoff_time;
            const opening = fixtures.filter((f: any) => f.kickoff_time === earliestTime);
            const wibTime = formatWibTime(earliestTime);

            if (opening.length === 1) {
              const f = opening[0];
              filledHeadline = renderTemplateBranch(tmpl.template, '1 laga', {
                gw: currentGw,
                kickoff_time: wibTime,
                home_club: f.home_team || f.homeClub || sample.home_club,
                away_club: f.away_team || f.awayClub || sample.away_club,
              });
            } else {
              const listStr = opening.map((f: any, i: number) => {
                const pair = `[C:${f.home_team || f.homeClub}] vs [C:${f.away_team || f.awayClub}]`;
                return i === opening.length - 1 ? `dan ${pair}` : pair;
              }).join(', ');
              filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
                gw: currentGw,
                count: opening.length,
                kickoff_time: wibTime,
                matches_list: listStr,
              });
            }
          }
          if (!filledHeadline) {
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              gw: currentGw,
              kickoff_time: sample.kickoff_time || '18:30 WIB',
              count: sample.count || 5,
              matches_list: sample.matches_list,
            });
          }
          break;
        }

        // 2. Chip Wildcard
        case 2: {
          const rawWcTeams: string[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.wc1 && Number(row.wc1.gw) === currentGw) || (row.wc2 && Number(row.wc2.gw) === currentGw)) {
              rawWcTeams.push(row.entry_name);
            }
          }
          if (rawWcTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawWcTeams[0],
              teams: `[T:${rawWcTeams[0]}]`,
              gw: currentGw,
              player_in: sample.player_in || 'Palmer',
              player_out: sample.player_out || 'Saka',
            });
          } else if (rawWcTeams.length > 1) {
            const teamsStr = `${rawWcTeams.slice(0, -1).map(t => `[T:${t}]`).join(', ')} dan [T:${rawWcTeams[rawWcTeams.length - 1]}]`;
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawWcTeams[0],
              gw: currentGw,
              player_in: sample.player_in || 'Palmer',
              player_out: sample.player_out || 'Saka',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 3. Chip Free Hit
        case 3: {
          const rawFhTeams: string[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.fh1 && Number(row.fh1.gw) === currentGw) || (row.fh2 && Number(row.fh2.gw) === currentGw)) {
              rawFhTeams.push(row.entry_name);
            }
          }
          if (rawFhTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawFhTeams[0],
              teams: `[T:${rawFhTeams[0]}]`,
              gw: currentGw,
              player_in: sample.player_in || 'Salah',
              player_out: sample.player_out || 'Son',
            });
          } else if (rawFhTeams.length > 1) {
            const teamsStr = `${rawFhTeams.slice(0, -1).map(t => `[T:${t}]`).join(', ')} dan [T:${rawFhTeams[rawFhTeams.length - 1]}]`;
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawFhTeams[0],
              gw: currentGw,
              player_in: sample.player_in || 'Salah',
              player_out: sample.player_out || 'Son',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 4. Chip Bench Boost
        case 4: {
          const rawBbTeams: string[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.bb1 && Number(row.bb1.gw) === currentGw) || (row.bb2 && Number(row.bb2.gw) === currentGw)) {
              rawBbTeams.push(row.entry_name);
            }
          }
          if (rawBbTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawBbTeams[0],
              teams: `[T:${rawBbTeams[0]}]`,
              gw: currentGw,
              player_bench: sample.player_bench || 'Rogers',
            });
          } else if (rawBbTeams.length > 1) {
            const teamsStr = `${rawBbTeams.slice(0, -1).map(t => `[T:${t}]`).join(', ')} dan [T:${rawBbTeams[rawBbTeams.length - 1]}]`;
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawBbTeams[0],
              gw: currentGw,
              player_bench: sample.player_bench || 'Rogers',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 5. Chip Triple Captain
        case 5: {
          const rawTcTeams: string[] = [];
          for (const row of leagueData?.all_chips_used || []) {
            if ((row.tc1 && Number(row.tc1.gw) === currentGw) || (row.tc2 && Number(row.tc2.gw) === currentGw)) {
              rawTcTeams.push(row.entry_name);
            }
          }
          if (rawTcTeams.length === 1) {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              team: rawTcTeams[0],
              teams: `[T:${rawTcTeams[0]}]`,
              captain: sample.captain || 'Haaland',
              dominant_captain: sample.dominant_captain || sample.captain || 'Haaland',
              gw: currentGw,
              others_clause: '',
            });
          } else if (rawTcTeams.length > 1) {
            const teamsStr = `${rawTcTeams.slice(0, -1).map(t => `[T:${t}]`).join(', ')} dan [T:${rawTcTeams[rawTcTeams.length - 1]}]`;
            filledHeadline = renderTemplateBranch(tmpl.template, 'multi', {
              teams: teamsStr,
              team: rawTcTeams[0],
              captain: sample.captain || 'Haaland',
              dominant_captain: sample.dominant_captain || sample.captain || 'Haaland',
              gw: currentGw,
              others_clause: rawTcTeams.length > 2 ? `, sementara [N:${rawTcTeams.length - 2}] tim lainnya memilih opsi kapten berbeda` : '',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '1 tim', {
              ...sample,
              gw: currentGw,
            });
          }
          break;
        }

        // 6. Chip Recap
        case 6: {
          let wcCount = 0, fhCount = 0, bbCount = 0, tcCount = 0;
          let wcNew = 0, fhNew = 0, bbNew = 0, tcNew = 0;
          for (const row of leagueData?.all_chips_used || []) {
            if (row.wc1 && Number(row.wc1.gw) <= currentGw) { wcCount++; if (Number(row.wc1.gw) === currentGw) wcNew++; }
            if (row.wc2 && Number(row.wc2.gw) <= currentGw) { wcCount++; if (Number(row.wc2.gw) === currentGw) wcNew++; }
            if (row.fh1 && Number(row.fh1.gw) <= currentGw) { fhCount++; if (Number(row.fh1.gw) === currentGw) fhNew++; }
            if (row.fh2 && Number(row.fh2.gw) <= currentGw) { fhCount++; if (Number(row.fh2.gw) === currentGw) fhNew++; }
            if (row.bb1 && Number(row.bb1.gw) <= currentGw) { bbCount++; if (Number(row.bb1.gw) === currentGw) bbNew++; }
            if (row.bb2 && Number(row.bb2.gw) <= currentGw) { bbCount++; if (Number(row.bb2.gw) === currentGw) bbNew++; }
            if (row.tc1 && Number(row.tc1.gw) <= currentGw) { tcCount++; if (Number(row.tc1.gw) === currentGw) tcNew++; }
            if (row.tc2 && Number(row.tc2.gw) <= currentGw) { tcCount++; if (Number(row.tc2.gw) === currentGw) tcNew++; }
          }
          const wcStr = `[N:Wildcard] [N:${wcCount || 14}]${wcNew > 0 ? ` (+[N:${wcNew}] pekan ini)` : ''}`;
          const fhStr = `[N:Free Hit] [N:${fhCount || 8}]${fhNew > 0 ? ` (+[N:${fhNew}] pekan ini)` : ''}`;
          const bbStr = `[N:Bench Boost] [N:${bbCount || 6}]${bbNew > 0 ? ` (+[N:${bbNew}] pekan ini)` : ''}`;
          const tcStr = `[N:Triple Captain] [N:${tcCount || 12}]${tcNew > 0 ? ` (+[N:${tcNew}] pekan ini)` : ''}`;
          const summary = `${wcStr}, ${fhStr}, ${bbStr}, dan ${tcStr}`;

          filledHeadline = renderTemplateBranch(tmpl.template, '', {
            gw: currentGw,
            chips_summary: summary,
          });
          break;
        }

        // 7. Most Transferred In
        case 7: {
          const transfersInMap = new Map<string, number>();
          for (const tr of leagueData?.all_transfers || []) {
            if (Number(tr.event) === currentGw && tr.element_in?.name) {
              const name = tr.element_in.name;
              transfersInMap.set(name, (transfersInMap.get(name) || 0) + 1);
            }
          }
          const sortedIn = Array.from(transfersInMap.entries()).sort((a, b) => b[1] - a[1]);
          if (sortedIn.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              player1: sortedIn[0][0],
              count1: sortedIn[0][1],
              player2: sortedIn[1][0],
              count2: sortedIn[1][1],
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 8. Most Transferred Out
        case 8: {
          const transfersOutMap = new Map<string, number>();
          for (const tr of leagueData?.all_transfers || []) {
            if (Number(tr.event) === currentGw && tr.element_out?.name) {
              const name = tr.element_out.name;
              transfersOutMap.set(name, (transfersOutMap.get(name) || 0) + 1);
            }
          }
          const sortedOut = Array.from(transfersOutMap.entries()).sort((a, b) => b[1] - a[1]);
          if (sortedOut.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              player1: sortedOut[0][0],
              count1: sortedOut[0][1],
              player2: sortedOut[1][0],
              count2: sortedOut[1][1],
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 9. Captaincy Recap
        case 9: {
          const capStats = Array.isArray(leagueData?.captain_stats) ? leagueData.captain_stats : [];
          if (capStats.length >= 2) {
            const dominant = capStats[0];
            const second = capStats[1];
            const othersCount = capStats.slice(2).reduce((acc: number, c: any) => acc + (c.count || 1), 0);
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              gw: currentGw,
              dominant_captain: dominant.name || dominant.player_name || sample.dominant_captain,
              count1: dominant.count || sample.count1,
              second_clause: `, disusul [P:${second.name || second.player_name}] sebanyak [N:${second.count}] pemilih`,
              others_clause: othersCount > 0 ? `, sementara [N:${othersCount}] tim lainnya memilih kapten alternatif` : '',
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 10. Hits Recap
        case 10: {
          const minusTeams: string[] = [];
          for (const t of leagueData?.liga_minus || []) {
            if (t.event_transfers_cost && t.event_transfers_cost > 0) {
              minusTeams.push(`[T:${t.entry_name}] (-[N:${t.event_transfers_cost} Poin])`);
            }
          }
          if (minusTeams.length > 0) {
            const formatted = minusTeams.length <= 2 
              ? minusTeams.join(' dan ')
              : `${minusTeams.slice(0, 2).join(', ')}, serta [N:${minusTeams.length - 2}] tim lainnya`;
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              teams_with_hits: formatted,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 11. Ownership Most Owned
        case 11: {
          const ownPlayers = Array.isArray(leagueData?.ownership_players) ? leagueData.ownership_players : [];
          if (ownPlayers.length >= 2) {
            filledHeadline = renderTemplateBranch(tmpl.template, '', {
              player1: ownPlayers[0].name || sample.player1,
              pct1: ownPlayers[0].ownership || ownPlayers[0].percentage || sample.pct1,
              player2: ownPlayers[1].name || sample.player2,
              pct2: ownPlayers[1].ownership || ownPlayers[1].percentage || sample.pct2,
            });
          } else {
            filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          }
          break;
        }

        // 12. Differential Starting XI
        case 12: {
          filledHeadline = renderTemplateBranch(tmpl.template, '2 pemain', {
            team: sample.team || 'Kuda Hitam',
            gw: currentGw,
            player1: sample.player1 || 'Kluivert',
            pct1: sample.pct1 || '3',
            player2: sample.player2 || 'Welbeck',
            pct2: sample.pct2 || '4',
          });
          break;
        }

        // 13. Differential Captain
        case 13: {
          filledHeadline = renderTemplateBranch(tmpl.template, 'kapten eksklusif', {
            team: sample.team || 'Sunda Kelapa',
            captain: sample.captain || 'Bowen',
            gw: currentGw,
            pickers_count: sample.pickers_count || '2',
          });
          break;
        }

        default:
          filledHeadline = renderTemplateBranch(tmpl.template, '', sample);
          break;
      }

      if (filledHeadline) {
        const teams = extractTagNames(filledHeadline, 'T');
        const players = extractTagNames(filledHeadline, 'P');

        stories.push({
          id: `p1_${tmpl.id.toLowerCase()}_gw${currentGw}`,
          headline_id: filledHeadline,
          headline_en: filledHeadline, // Clean English/Indonesian format
          kategori: tmpl.category,
          sub_kategori: tmpl.subcategory,
          drama_score: 82 + (tmpl.no % 8),
          waktu_tayang: ['Not started'],
          gw: currentGw,
          teams,
          players,
          sumber: 'Bukan',
          status_tayang: isGwNotStarted ? 'Y' : 'N',
          keterangan_tidak_tayang: isGwNotStarted ? '' : 'Fase saat ini bukan Not started',
        });
      }
    } catch (err: any) {
      console.warn(`[Phase1StoryGenerator] Error generating template ${tmpl.id}:`, err.message);
    }
  }

  return stories;
}
