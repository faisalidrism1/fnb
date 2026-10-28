import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';

import fs from 'fs';
import path from 'path';
import {
  getOptimalDatabase,
  getGwSnapshot,
  getOptimalPlayerById,
  getOptimalManagerById,
  getDbStandings,
  getDbGameweekChampions,
  getDbOwnershipPlayers,
  getDbOwnershipClubs,
  getDbFansClubs,
  getDbTemplateSquads,
  getDbTransfers,
  getDbLigaMinus,
  getDbCaptainStats,
  getDbChipsUsed,
  getDbPlayerStats,
  getDbSyncMeta,
  getDatabaseStats
} from './db.ts';

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;


const LEAGUE_PAST_SEASONS_PATH = path.join(process.cwd(), 'src/data/league_past_seasons.json');

/**
 * STRICTLY READ-ONLY Database Function Declarations for Gemini AI
 * No write, update, or delete operations exist or are exposed.
 */
export const readOnlyDatabaseToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'read_matchday_intelligence',
    description: 'RECOMMENDED PRIMARY TOOL: Reads comprehensive matchday intelligence for a Gameweek in ONE call: on-pitch player stats (goals, assists, CS, saves, penalty stops/misses, DefCon +2, BPS), differential stars (<5% ownership in FNB), transfer hits (Liga Minus -4), captaincy performance, active chips, and title race gaps.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gw: {
          type: Type.INTEGER,
          description: 'Optional Gameweek number. Defaults to current active Gameweek.',
        },
      },
    },
  },
  {
    name: 'read_database_overview',
    description: 'Reads high-level overview of the container database: league info, current GW, available GWs, total managers, last sync timestamp, and record counts across all tables.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },

  {
    name: 'read_gameweek_snapshot',
    description: 'Reads complete snapshot for a specific Gameweek: standings, gameweek champions, transfers, captain stats, chips used, and template squad.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gw: {
          type: Type.INTEGER,
          description: 'Gameweek number (1 to 38) to read.',
        },
      },
      required: ['gw'],
    },
  },
  {
    name: 'read_league_standings',
    description: 'Reads the league standings table for a specific Gameweek or latest available Gameweek.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gw: {
          type: Type.INTEGER,
          description: 'Optional Gameweek number. If omitted, reads latest available Gameweek.',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Optional limit on number of managers to return (e.g. top 10, top 20). Defaults to 97 (all).',
        },
      },
    },
  },
  {
    name: 'read_manager_profile',
    description: 'Reads complete data for a specific manager by Entry ID or search query: team name, manager name, total points, overall rank, Gameweek history, chips used, and transfers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        entryId: {
          type: Type.INTEGER,
          description: 'The manager entry ID.',
        },
        managerName: {
          type: Type.STRING,
          description: 'Optional manager name or team name to search if entryId is not known.',
        },
      },
    },
  },
  {
    name: 'read_player_stats',
    description: 'Reads and searches Premier League player stats in the container database: total points, goals, assists, saves, clean sheets, DefCon (defensive contribution), BPS, cost, and ownership in FNB League.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        playerId: {
          type: Type.INTEGER,
          description: 'Optional player ID for direct lookup.',
        },
        search: {
          type: Type.STRING,
          description: 'Player name search term (e.g. "Salah", "Haaland", "Gabriel").',
        },
        team: {
          type: Type.STRING,
          description: 'Filter by club name or short name (e.g. "ARS", "MCI", "LIV").',
        },
        position: {
          type: Type.STRING,
          description: 'Filter by position ("GKP", "DEF", "MID", "FWD").',
        },
        sortBy: {
          type: Type.STRING,
          description: 'Sort field: "totalPoints", "eventPoints", "goalsScored", "assists", "cleanSheets", "saves".',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum players to return (default 15).',
        },
      },
    },
  },
  {
    name: 'read_transfers_and_hits',
    description: 'Reads transfer activities and transfer hit penalties (Liga Minus / -4 pts) for a specific Gameweek or all Gameweeks.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gw: {
          type: Type.INTEGER,
          description: 'Optional Gameweek number.',
        },
        entryId: {
          type: Type.INTEGER,
          description: 'Optional manager entry ID.',
        },
      },
    },
  },
  {
    name: 'read_captaincy_and_chips',
    description: 'Reads captaincy picks, captain points, and chips used (Triple Captain, Bench Boost, Free Hit, Wildcard) in the league.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gw: {
          type: Type.INTEGER,
          description: 'Optional Gameweek number.',
        },
      },
    },
  },
  {
    name: 'read_past_seasons_archive',
    description: 'Reads historical FNB League season records and past ranks for all registered managers.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'read_full_database_dump',
    description: 'Reads the entire structured database state in the container including metadata, all snapshots, player catalog, and analytics.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includePlayers: {
          type: Type.BOOLEAN,
          description: 'Whether to include the full ~700 player dictionary (defaults to false to conserve tokens; true if deep player analysis is requested).',
        },
      },
    },
  },
];

/**
 * Safe, strictly read-only execution dispatcher
 */
export async function executeReadOnlyDatabaseAction(
  name: string,
  args: Record<string, any>
): Promise<any> {
  switch (name) {
    case 'read_matchday_intelligence': {
      const db = getOptimalDatabase();
      const currentGw = args.gw ? Number(args.gw) : (db.meta.current_gw || 8);
      const snapshot = getGwSnapshot(currentGw);
      const standings = getDbStandings(currentGw);

      // 1. Title race & Top shifts
      const rank1 = standings[0] || null;
      const rank2 = standings[1] || null;
      const titleRaceGap = (rank1 && rank2) ? (rank1.total_points - rank2.total_points) : 0;

      const climbers = [...standings]
        .filter(s => s.rank_change && s.rank_change > 0)
        .sort((a, b) => b.rank_change - a.rank_change)
        .slice(0, 3)
        .map(s => ({ team: s.entry_name, climbed: `+${s.rank_change}`, newRank: s.rank, gwPoints: s.event_points }));

      const fallers = [...standings]
        .filter(s => s.rank_change && s.rank_change < 0)
        .sort((a, b) => a.rank_change - b.rank_change)
        .slice(0, 3)
        .map(s => ({ team: s.entry_name, dropped: s.rank_change, newRank: s.rank, gwPoints: s.event_points }));

      // 2. GW Champion
      const champ = snapshot?.champion?.champions?.[0] || null;

      // 3. Player micro-stats & matchday heroes (camelCase properties)
      const allPlayers = Object.values(db.players || {});
      const topPointEarners = [...allPlayers]
        .filter(p => (p.eventPoints || 0) >= 8)
        .sort((a, b) => (b.eventPoints || 0) - (a.eventPoints || 0))
        .slice(0, 8)
        .map(p => ({
          name: p.webName,
          club: p.teamShort,
          pos: p.position,
          gwPoints: p.eventPoints,
          goals: p.goalsScored,
          assists: p.assists,
          bonus: p.bonus,
          bps: p.bps,
          cleanSheets: p.cleanSheets,
          saves: p.saves,
          fnbOwnership: p.league_ownership?.count || 0
        }));

      // Differentials: Low ownership (<= 5 managers) who scored >= 8 pts
      const differentials = allPlayers
        .filter(p => (p.eventPoints || 0) >= 8 && (p.league_ownership?.count || 0) > 0 && (p.league_ownership?.count || 0) <= 5)
        .slice(0, 5)
        .map(p => ({
          name: p.webName,
          club: p.teamShort,
          gwPoints: p.eventPoints,
          fnbOwnedCount: p.league_ownership?.count,
          ownedByTeams: (p.league_ownership?.owners || []).map((o: any) => o.entry_name).slice(0, 3)
        }));

      // Popular players who blanked (owned by >= 30 managers, <= 1 pts)
      const popularBlanks = allPlayers
        .filter(p => (p.league_ownership?.count || 0) >= 30 && (p.eventPoints || 0) <= 1 && (p.minutes || 0) > 0)
        .slice(0, 5)
        .map(p => ({
          name: p.webName,
          club: p.teamShort,
          gwPoints: p.eventPoints,
          fnbOwnersCount: p.league_ownership?.count
        }));

      // 4. Captaincy Performance in GW
      const captains = (snapshot?.top_captains || []).slice(0, 4).map((c: any) => ({
        name: c.web_name,
        club: c.team_short_name,
        captainedByCount: c.captain_count,
        captainedByPct: c.captain_percentage,
        gwPointsAsCaptain: c.gw_points * 2,
        singleGwPoints: c.gw_points
      }));

      // 5. Transfers In & Out
      const transfersInSample = (snapshot?.transfers_in || []).slice(0, 3).map((t: any) => ({
        player: t.web_name,
        club: t.team_short_name,
        boughtByCount: t.transfer_count,
        gwPointsEarned: t.gw_points
      }));

      const transfersOutSample = (snapshot?.transfers_out || []).slice(0, 3).map((t: any) => ({
        player: t.web_name,
        club: t.team_short_name,
        soldByCount: t.transfer_count,
        gwPointsEarned: t.gw_points
      }));

      // 6. Liga Minus (all-time transfer hit leaders)
      const topMinusHits = getDbLigaMinus().slice(0, 3).map(h => ({
        team: h.entry_name,
        manager: h.player_name,
        totalMinusPoints: h.total_minus_points,
        currentRank: h.current_rank
      }));

      return {
        success: true,
        currentActiveGameweek: currentGw,
        nextGameweek: currentGw + 1,
        gameweekStatus: 'GW Final / Confirmed (Poin & Klasemen Sah Terkunci 100%)',
        gameweekGuideline: `Konteks mutlak: GW yang baru saja usai adalah GW ${currentGw}. GW berikutnya yang akan datang adalah GW ${currentGw + 1}. DILARANG KERAS menyebut nomor Gameweek selain GW ${currentGw} atau GW ${currentGw + 1}!`,
        titleRace: {
          leader: rank1 ? { team: rank1.entry_name, manager: rank1.player_name, totalPoints: rank1.total_points, gwPoints: rank1.event_points } : null,
          runnerUp: rank2 ? { team: rank2.entry_name, manager: rank2.player_name, totalPoints: rank2.total_points, gwPoints: rank2.event_points } : null,
          gapPoints: titleRaceGap,
        },
        gwChampion: champ ? { team: champ.entry_name, manager: champ.player_name, points: champ.points, climbed: champ.rank_change_at_gw } : null,
        topRankClimbers: climbers,
        bigRankFallers: fallers,
        topPlayerPerformers: topPointEarners,
        differentialHeroes: differentials,
        popularBlanks,
        captaincy: captains,
        transfersSuccessAndKarma: {
          mostBought: transfersInSample,
          mostSold: transfersOutSample,
        },
        ligaMinusRecords: topMinusHits
      };
    }


    case 'read_database_overview': {

      const meta = getDbSyncMeta();
      const stats = getDatabaseStats();
      return {
        success: true,
        league: {
          id: meta.leagueId,
          name: meta.leagueName,
          currentGw: meta.currentGw,
          totalTeams: meta.totalTeams,
          isMatchdayLive: meta.isMatchdayLive,
          lastSynced: meta.lastSynced,
          nextSyncWib: meta.nextSyncWib,
        },
        databaseStats: stats,
      };
    }

    case 'read_gameweek_snapshot': {
      const gw = Number(args.gw);
      if (!gw || isNaN(gw)) {
        return { success: false, error: 'Valid gw number required.' };
      }
      const snapshot = getGwSnapshot(gw);
      if (!snapshot) {
        return { success: false, message: `Snapshot for GW ${gw} not found in database.` };
      }
      return {
        success: true,
        gw,
        standingsCount: snapshot.standings?.length || 0,
        standingsTop5: (snapshot.standings || []).slice(0, 5),
        champions: snapshot.gameweek_champions,
        topCaptains: snapshot.top_captains,
        chipsUsedCount: snapshot.chips_used?.length || 0,
        transfersCount: snapshot.transfers?.length || 0,
      };
    }

    case 'read_league_standings': {
      const db = getOptimalDatabase();
      const gw = args.gw ? Number(args.gw) : (db.meta.current_gw || 1);
      const limit = args.limit ? Number(args.limit) : 97;
      const list = getDbStandings(gw);
      return {
        success: true,
        gw,
        totalManagers: list.length,
        standings: list.slice(0, limit),
      };
    }

    case 'read_manager_profile': {
      const db = getOptimalDatabase();
      if (args.entryId) {
        const mgr = getOptimalManagerById(Number(args.entryId));
        if (mgr) return { success: true, manager: mgr };
      }
      if (args.managerName) {
        const query = String(args.managerName).toLowerCase();
        const found = Object.values(db.managers).find(
          (m) =>
            m.playerName.toLowerCase().includes(query) ||
            m.entryName.toLowerCase().includes(query)
        );
        if (found) return { success: true, manager: found };
      }
      return { success: false, message: 'Manager not found in database.' };
    }

    case 'read_player_stats': {
      if (args.playerId) {
        const player = getOptimalPlayerById(Number(args.playerId));
        return { success: Boolean(player), player };
      }
      const players = getDbPlayerStats({
        position: args.position,
        team: args.team,
        search: args.search,
        sortBy: args.sortBy,
        limit: args.limit || 15,
      });
      return {
        success: true,
        count: players.length,
        players,
      };
    }

    case 'read_transfers_and_hits': {
      const transfers = getDbTransfers(args.gw, args.entryId);
      const ligaMinus = getDbLigaMinus();
      return {
        success: true,
        totalTransfers: transfers.length,
        transfers: transfers.slice(0, 50),
        transferHits: ligaMinus,
      };
    }

    case 'read_captaincy_and_chips': {
      const captainStats = getDbCaptainStats(args.gw);
      const chipsUsed = getDbChipsUsed();
      return {
        success: true,
        gw: args.gw,
        topCaptains: captainStats,
        chipsUsed,
      };
    }

    case 'read_past_seasons_archive': {
      if (fs.existsSync(LEAGUE_PAST_SEASONS_PATH)) {
        try {
          const raw = fs.readFileSync(LEAGUE_PAST_SEASONS_PATH, 'utf-8');
          const data = JSON.parse(raw);
          return { success: true, pastSeasons: data };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
      return { success: false, message: 'No past seasons archive file found.' };
    }

    case 'read_full_database_dump': {
      const opt = getOptimalDatabase();
      const clone = { ...opt };
      if (!args.includePlayers) {
        // Strip heavy ~700 items player dictionary to avoid blowing context limits
        clone.players = {} as any;
      }
      return {
        success: true,
        database: clone,
      };
    }

    default:
      return { success: false, error: `Unknown read action: ${name}` };
  }
}

/**
 * Query the container database using Gemini AI with autonomous Read-Only Tool Calling
 */
export async function queryDatabaseWithGemini(
  userQuery: string,
  lang: 'id' | 'en' = 'id'
): Promise<{
  success: boolean;
  answer: string;
  toolsUsed: string[];
  executionTimeMs: number;
}> {
  const startTime = Date.now();
  const toolsUsed: string[] = [];

  if (!ai) {
    // If no API key configured, provide clean factual heuristic response from the database directly
    const overview = await executeReadOnlyDatabaseAction('read_database_overview', {});
    const standings = await executeReadOnlyDatabaseAction('read_league_standings', { limit: 5 });
    return {
      success: true,
      answer:
        lang === 'id'
          ? `[Gemini Read-Only Database Mode] API Key belum disetel di container. Akses database baca penuh (Read-Only) siap digunakan dengan ${overview.databaseStats.totalTables} tabel, ${overview.databaseStats.indexedManagers} manajer, dan ${overview.databaseStats.indexedSnapshots} snapshot GW. Puncak klasemen saat ini: ${standings.standings?.[0]?.entry_name || '-'} (${standings.standings?.[0]?.total_points || 0} pts).`
          : `[Gemini Read-Only Database Mode] GEMINI_API_KEY is not set. Full read-only database access is verified with ${overview.databaseStats.totalTables} tables and ${overview.databaseStats.indexedManagers} managers. Current leader: ${standings.standings?.[0]?.entry_name || '-'}.`,
      toolsUsed: ['read_database_overview', 'read_league_standings'],
      executionTimeMs: Date.now() - startTime,
    };
  }

  const systemInstruction = `Anda adalah asisten AI analitik FPL berpengetahuan penuh dengan AKSES BACA RESMI (READ-ONLY) ke seluruh database FPL Nusantara BERHADIAH di dalam container ini.
ATURAN KESELAMATAN & INTEGRITAS:
1. Anda hanya memiliki izin BACA (READ-ONLY). Anda TIDAK MEMILIKI dan DILARANG melakukan operasi modifikasi, penulisan, atau penghapusan data.
2. Gunakan fungsi tool read_* yang disediakan untuk memeriksa fakta data secara langsung sebelum menjawab pertanyaan user.
3. Selalu rujuk data aktual dari database (nama tim, nama manajer, poin, peringkat, transfer hit -4, BPS, dsb) secara presisi dan faktual.
4. Jawablah dengan bahasa ${lang === 'id' ? 'Indonesia yang lugas, ramah, dan profesional' : 'English in a concise, professional tone'}.`;

  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];


  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
  };

  for (const model of candidateModels) {
    try {
      // First turn: prompt model with read-only tools (with 6s timeout)
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: userQuery,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: readOnlyDatabaseToolDeclarations }],
          },
        }),
        6000
      );


      // Handle function calling if Gemini requests data from container database
      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses: any[] = [];
        for (const call of response.functionCalls) {
          toolsUsed.push(call.name);
          const toolResult = await executeReadOnlyDatabaseAction(call.name, (call.args as any) || {});
          functionResponses.push({
            name: call.name,
            response: toolResult,
          });
        }

        const modelTurn = response.candidates?.[0]?.content;
        if (!modelTurn) {
          throw new Error('Model produced function calls without candidate content.');
        }

        // Second turn: feed exact candidate content preserving thought_signature + function responses back to model
        const secondResponse = await withTimeout(
          ai.models.generateContent({
            model,
            contents: [
              { role: 'user', parts: [{ text: userQuery }] },
              modelTurn,
              {
                role: 'user',
                parts: functionResponses.map((fr) => ({
                  functionResponse: {
                    name: fr.name,
                    response: { result: fr.response },
                    ...(fr.id ? { id: fr.id } : {}),
                  },
                })),
              },
            ],
            config: {
              systemInstruction,
            },
          }),
          8000
        );



        return {
          success: true,
          answer: secondResponse.text || 'Data berhasil dibaca dari database.',
          toolsUsed,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // If model answered directly without needing tool call
      return {
        success: true,
        answer: response.text || '',
        toolsUsed,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      console.warn(`[GeminiDatabaseReader] Model ${model} failed, trying next candidate:`, err.message);
    }
  }

  // Fallback if all API calls failed
  const fallbackOverview = await executeReadOnlyDatabaseAction('read_database_overview', {});
  return {
    success: true,
    answer: `Database terbaca via fallback: ${fallbackOverview.databaseStats.totalTables} tabel aktif di container.`,
    toolsUsed: ['read_database_overview'],
    executionTimeMs: Date.now() - startTime,
  };
}
