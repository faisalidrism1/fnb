import fs from 'fs';
import path from 'path';
import type {
  DbLigaMinus,
  DbChipUsed,
  GwSnapshot,
  OptimalPlayerEntry,
  OptimalManagerEntry,
  OptimalFplDatabaseSchema,
  StandingsRow,
  TransformedLeagueData
} from '../types.ts';

const DB_FILE_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');

// In-Memory Database and Ultra-Fast O(1) Lookup Indices
let optimalDatabaseState: OptimalFplDatabaseSchema | null = null;

// High-speed O(1) In-Memory Hash Maps for Sub-Millisecond Response
const indexedSnapshots = new Map<number, GwSnapshot>();
const indexedPlayers = new Map<number, OptimalPlayerEntry>();
const indexedStandingsByGw = new Map<number, StandingsRow[]>();

/**
 * Creates an empty optimal database matching the schema
 */
function createEmptyOptimalDatabase(): OptimalFplDatabaseSchema {
  return {
    meta: {
      league_id: 12356,
      league_name: 'FPL Nusantara BERHADIAH',
      current_gw: 1,
      available_gws: [1],
      total_teams: 0,
      last_synced: new Date().toISOString(),
      next_sync_wib: '07:00 WIB',
      is_live: false
    },
    gw_snapshots: {},
    players: {},
    managers: {},
    league_analytics: {
      all_chips_used: [],
      fans_clubs: {},
      liga_minus: [],
      most_gameweek_champions: [],
      all_transfers: []
    },
    table_counts: {}
  };
}

/**
 * Populate fast O(1) in-memory indices from the optimal database
 */
function populateMemoryIndices(optDb: OptimalFplDatabaseSchema) {
  indexedSnapshots.clear();
  indexedPlayers.clear();
  indexedStandingsByGw.clear();

  // Index GW Snapshots
  for (const [gwStr, snapshot] of Object.entries(optDb.gw_snapshots || {})) {
    const gw = Number(gwStr);
    indexedSnapshots.set(gw, snapshot);
    if (Array.isArray(snapshot.standings)) {
      indexedStandingsByGw.set(gw, snapshot.standings);
    }
  }

  // Index Players O(1)
  for (const [idStr, player] of Object.entries(optDb.players)) {
    indexedPlayers.set(Number(idStr), player);
  }

  console.log(`[Database Indices] Populated: ${indexedSnapshots.size} GW snapshots, ${indexedPlayers.size} players, ${Object.keys(optDb.managers || {}).length} managers.`);
}

/**
 * Transform TransformedLeagueData into the Optimal Pre-Aggregated Database Schema
 */
export function transformToOptimalDbSchema(fplData: TransformedLeagueData): OptimalFplDatabaseSchema {
  const availableGws = fplData.available_gws && fplData.available_gws.length > 0
    ? fplData.available_gws
    : [fplData.current_gw || 1];

  // 1. Build Player Dictionary & Ownership Maps
  const playersDict: Record<number, OptimalPlayerEntry> = {};
  
  // Seed with base player stats if available
  if (Array.isArray(fplData.player_stats)) {
    for (const p of fplData.player_stats) {
      playersDict[p.id] = {
        ...p,
        league_ownership: {
          count: 0,
          percentage: 0,
          owners: []
        }
      };
    }
  }

  // Enrich with league ownership data per GW
  if (fplData.ownership_players) {
    for (const [gwStr, playerList] of Object.entries(fplData.ownership_players)) {
      const gw = Number(gwStr);
      if (Array.isArray(playerList)) {
        for (const p of playerList) {
          if (!playersDict[p.id]) {
            playersDict[p.id] = {
              id: p.id,
              webName: p.web_name,
              fullName: p.full_name,
              teamId: p.team_code || 0,
              teamName: p.team_name,
              teamShort: p.team_short_name,
              position: p.position,
              nowCost: p.now_cost || 0,
              status: 'a',
              totalPoints: p.total_points || 0,
              eventPoints: 0,
              goalsScored: 0,
              assists: 0,
              cleanSheets: 0,
              goalsConceded: 0,
              ownGoals: 0,
              penaltiesSaved: 0,
              penaltiesMissed: 0,
              yellowCards: 0,
              redCards: 0,
              saves: 0,
              bonus: 0,
              bps: 0,
              minutes: 0,
              starts: 0,
              influence: 0,
              creativity: 0,
              threat: 0,
              ictIndex: 0,
              expectedGoals: 0,
              expectedAssists: 0,
              expectedGoalInvolvements: 0,
              expectedGoalsConceded: 0,
              form: 0,
              pointsPerGame: 0,
              selectedByPercent: p.owned_percentage || 0,
              transfersIn: 0,
              transfersOut: 0
            };
          }
          if (gw === fplData.current_gw) {
            playersDict[p.id].league_ownership = {
              count: p.owned_count,
              percentage: p.owned_percentage,
              owners: (p.owners || []).map(o => ({
                entry_id: o.entry_id,
                entry_name: o.entry_name,
                player_name: o.player_name,
                is_captain: o.is_captain,
                is_vice_captain: o.is_vice_captain,
                multiplier: o.multiplier,
                position_in_squad: o.position_in_squad,
                is_starter: o.is_starter
              }))
            };
          }
        }
      }
    }
  }

  // 2. Build Manager Dictionary & History Maps
  const managersDict: Record<number, OptimalManagerEntry> = {};
  if (fplData.standings) {
    for (const [gwStr, rows] of Object.entries(fplData.standings)) {
      const gw = Number(gwStr);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!managersDict[r.entry_id]) {
            managersDict[r.entry_id] = {
              entry_id: r.entry_id,
              entry_name: r.entry_name,
              player_name: r.player_name,
              chips_used: {},
              gw_history: {}
            };
          }
          managersDict[r.entry_id].gw_history[gw] = {
            gw,
            points: r.event_points,
            total_points: r.total_points,
            rank: r.rank,
            transfers_cost: r.event_transfers_cost
          };
          if (r.active_chip) {
            managersDict[r.entry_id].chips_used[r.active_chip] = {
              gw,
              points: r.event_points
            };
          }
        }
      }
    }
  }

  // 3. Build Pre-Aggregated Gameweek Snapshots (O(1) access per GW)
  const gwSnapshots: Record<number, GwSnapshot> = {};
  let totalStandingsCount = 0;

  for (const gw of availableGws) {
    const rawStandings = fplData.standings?.[gw] || [];
    totalStandingsCount += rawStandings.length;

    gwSnapshots[gw] = {
      gw,
      standings: rawStandings,
      champion: (fplData.gameweek_champions || []).find(c => c.event === gw) || null,
      template_squad: fplData.template_squads?.[gw] || null,
      top_captains: fplData.captain_players?.[gw] || [],
      captain_clubs: fplData.captain_clubs?.[gw] || [],
      ownership_players: fplData.ownership_players?.[gw] || [],
      ownership_clubs: fplData.ownership_clubs?.[gw] || [],
      transfers_in: fplData.transfers_in?.[gw] || fplData.transfers_in?.['all'] || [],
      transfers_out: fplData.transfers_out?.[gw] || fplData.transfers_out?.['all'] || [],
      transfer_feed: (fplData.all_transfers || []).filter(t => t.event === gw)
    };
  }

  // 4. League Analytics counts
  let totalChipsCount = 0;
  for (const chip of fplData.all_chips_used || []) {
    for (const key of ['wc1', 'tc1', 'bb1', 'fh1', 'wc2', 'tc2', 'bb2', 'fh2'] as const) {
      const cell = chip[key];
      if (cell && typeof cell === 'object' && 'gw' in cell && 'points' in cell) {
        totalChipsCount++;
      }
    }
  }

  const tableCounts = {
    gwSnapshots: Object.keys(gwSnapshots).length,
    indexedPlayers: Object.keys(playersDict).length,
    indexedManagers: Object.keys(managersDict).length,
    standings: totalStandingsCount,
    transfers: (fplData.all_transfers || []).length,
    chipsUsed: totalChipsCount,
    ligaMinus: (fplData.liga_minus || []).length
  };

  return {
    meta: {
      league_id: fplData.league_id || 12356,
      league_name: fplData.league_name || 'FPL Nusantara BERHADIAH',
      current_gw: fplData.current_gw || 1,
      available_gws: availableGws,
      total_teams: fplData.sync_status?.total_teams || Object.keys(managersDict).length || 0,
      last_synced: fplData.sync_status?.last_synced || new Date().toISOString(),
      next_sync_wib: fplData.sync_status?.next_sync_wib || '',
      is_live: !!fplData.sync_status?.is_matchday_live,
      deadlines: fplData.sync_status?.deadlines || {},
      sync_status: fplData.sync_status,
      gw_status: fplData.gw_status,
      events_status: fplData.events_status
    },
    gw_snapshots: gwSnapshots,
    players: playersDict,
    managers: managersDict,
    league_analytics: {
      all_chips_used: fplData.all_chips_used || [],
      fans_clubs: fplData.fans_clubs || {},
      liga_minus: fplData.liga_minus || [],
      most_gameweek_champions: fplData.most_gameweek_champions || [],
      gameweek_champions: fplData.gameweek_champions || [],
      all_transfers: fplData.all_transfers || [],
      transfers_in: fplData.transfers_in || {},
      transfers_out: fplData.transfers_out || {}
    },
    table_counts: tableCounts
  };
}

/**
 * Execute synchronization of fresh FPL data into the database schema
 */
export function executeSchemaSync(fplData: TransformedLeagueData): OptimalFplDatabaseSchema {
  console.log('[Database] Executing Optimal Pre-Aggregated DB Schema transformation...');
  const optimal = transformToOptimalDbSchema(fplData);
  optimalDatabaseState = optimal;

  // Populate lightning-fast in-memory maps
  populateMemoryIndices(optimal);

  try {
    fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
    // Atomic write to single source of truth database file
    const tempPath = `${DB_FILE_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(optimal, null, 2), 'utf-8');
    fs.renameSync(tempPath, DB_FILE_PATH);
    console.log('[Database] Optimal DB Schema persisted to', DB_FILE_PATH);
  } catch (err: any) {
    console.error('[Database] Failed to write database to disk:', err.message);
  }

  return optimal;
}

/**
 * Initialize database on server startup strictly from the single truth source (fpl_database.json)
 */
export function initDatabase(): OptimalFplDatabaseSchema {
  if (optimalDatabaseState) {
    return optimalDatabaseState;
  }

  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if ((parsed.gw_snapshots || parsed.gwSnapshots) && parsed.players) {
        optimalDatabaseState = parsed as OptimalFplDatabaseSchema;
        populateMemoryIndices(optimalDatabaseState);
        console.log('[Database] Successfully loaded Optimal Database from disk.');
        return optimalDatabaseState;
      }
    } catch (err: any) {
      console.warn('[Database] Error reading fpl_database.json:', err.message);
    }
  }

  console.log('[Database] Initializing fresh empty database (Cold Start).');
  optimalDatabaseState = createEmptyOptimalDatabase();
  populateMemoryIndices(optimalDatabaseState);
  return optimalDatabaseState;
}

/**
 * Reconstructs TransformedLeagueData directly from the single truth source (Optimal DB)
 */
export function getTransformedLeagueDataFromDb(): TransformedLeagueData | null {
  const opt = getOptimalDatabase();
  const snapshotEntries = Object.entries(opt.gw_snapshots || {});
  if (snapshotEntries.length === 0 || Object.keys(opt.managers || {}).length === 0) {
    return null;
  }

  const standings: Record<number, StandingsRow[]> = {};
  const ownership_players: TransformedLeagueData['ownership_players'] = {};
  const ownership_clubs: TransformedLeagueData['ownership_clubs'] = {};
  const template_squads: TransformedLeagueData['template_squads'] = {};
  const captain_players: TransformedLeagueData['captain_players'] = {};
  const captain_clubs: TransformedLeagueData['captain_clubs'] = {};
  const gameweekChampionsFromSnaps: TransformedLeagueData['gameweek_champions'] = [];
  const transfersInFallback: Record<string, any[]> = {};
  const transfersOutFallback: Record<string, any[]> = {};

  for (const [gwStr, snap] of snapshotEntries) {
    const gw = Number(gwStr);
    standings[gw] = snap.standings || [];
    ownership_players[gw] = snap.ownership_players || [];
    ownership_clubs[gw] = snap.ownership_clubs || [];
    if (snap.template_squad) template_squads[gw] = snap.template_squad;
    captain_players[gw] = snap.top_captains || [];
    captain_clubs[gw] = snap.captain_clubs || [];
    if (snap.champion) gameweekChampionsFromSnaps.push(snap.champion);
    if (Array.isArray(snap.transfers_in)) transfersInFallback[gwStr] = snap.transfers_in;
    if (Array.isArray(snap.transfers_out)) transfersOutFallback[gwStr] = snap.transfers_out;
  }

  return {
    league_id: opt.meta.league_id,
    league_name: opt.meta.league_name,
    current_gw: opt.meta.current_gw,
    available_gws: opt.meta.available_gws,
    sync_status: opt.meta.sync_status || {
      last_synced: opt.meta.last_synced,
      next_sync_wib: opt.meta.next_sync_wib,
      deadlines: opt.meta.deadlines,
      is_matchday_live: opt.meta.is_live,
      active_fixtures: [],
      gw_fixtures: [],
      current_gw: opt.meta.current_gw,
      max_gw: 38,
      total_teams: opt.meta.total_teams,
      league_name: opt.meta.league_name,
      league_id: opt.meta.league_id
    },
    gw_status: opt.meta.gw_status,
    events_status: opt.meta.events_status,
    standings,
    gameweek_champions: opt.league_analytics?.gameweek_champions || gameweekChampionsFromSnaps.sort((a, b) => b.event - a.event),
    most_gameweek_champions: opt.league_analytics?.most_gameweek_champions || [],
    ownership_players,
    ownership_clubs,
    fans_clubs: opt.league_analytics?.fans_clubs || {},
    template_squads,
    all_transfers: opt.league_analytics?.all_transfers || [],
    transfers_in: opt.league_analytics?.transfers_in || transfersInFallback,
    transfers_out: opt.league_analytics?.transfers_out || transfersOutFallback,
    liga_minus: opt.league_analytics?.liga_minus || [],
    captain_players,
    captain_clubs,
    all_chips_used: opt.league_analytics?.all_chips_used || [],
    player_stats: Object.values(opt.players || {})
  };
}

/**
 * Get current optimal database state
 */
export function getOptimalDatabase(): OptimalFplDatabaseSchema {
  if (!optimalDatabaseState) {
    return initDatabase();
  }
  return optimalDatabaseState;
}

// =========================================================================
// ULTRA-FAST O(1) ACCESSORS FOR INSTANT USER RESPONSES (< 1ms)
// =========================================================================

/**
 * Get pre-computed Gameweek Snapshot in O(1) time (< 1ms)
 */
export function getGwSnapshot(gw: number): GwSnapshot | null {
  if (!optimalDatabaseState) initDatabase();
  return indexedSnapshots.get(Number(gw)) || null;
}

export function getDbStandings(gw?: number): any[] {
  if (!optimalDatabaseState) initDatabase();
  if (gw !== undefined) {
    return indexedStandingsByGw.get(Number(gw)) || [];
  }
  const all: any[] = [];
  for (const list of indexedStandingsByGw.values()) {
    all.push(...list);
  }
  return all;
}

export function getDbLigaMinus(): DbLigaMinus[] {
  const opt = getOptimalDatabase();
  return (opt.league_analytics?.liga_minus as any) || [];
}

export function getDbChipsUsed(entryId?: number): DbChipUsed[] {
  const opt = getOptimalDatabase();
  const all = (opt.league_analytics?.all_chips_used as any) || [];
  if (entryId !== undefined) {
    return all.filter((c: any) => c.entryId === Number(entryId) || c.entry_id === Number(entryId));
  }
  return all;
}

export function getDbPlayerStatById(id: number): OptimalPlayerEntry | null {
  if (!optimalDatabaseState) initDatabase();
  return indexedPlayers.get(Number(id)) || null;
}

export function getDatabaseStats() {
  const opt = getOptimalDatabase();
  return {
    architecture: 'Optimal Pre-Aggregated / Indexed Materialized Views',
    recordCounts: opt.table_counts,
    indexedSnapshots: indexedSnapshots.size,
    indexedPlayers: indexedPlayers.size,
    indexedManagers: Object.keys(opt.managers || {}).length,
    lastSynced: opt.meta.last_synced,
    nextSyncWib: opt.meta.next_sync_wib,
    isMatchdayLive: opt.meta.is_live,
    currentGw: opt.meta.current_gw,
    leagueId: opt.meta.league_id,
    leagueName: opt.meta.league_name
  };
}

export function resetDatabaseState(): void {
  optimalDatabaseState = null;
  indexedSnapshots.clear();
  indexedPlayers.clear();
  indexedStandingsByGw.clear();
  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      fs.unlinkSync(DB_FILE_PATH);
    } catch {}
  }
  console.log('[Database] Reset optimal database state to empty Cold Start.');
}


