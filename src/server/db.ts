import fs from 'fs';
import path from 'path';
import type {
  DbStanding,
  DbGameweekChampion,
  DbOwnershipPlayer,
  DbOwnershipClub,
  DbFansClub,
  DbTemplateSquad,
  DbTransfer,
  DbLigaMinus,
  DbCaptainStat,
  DbChipUsed,
  DbPlayerStat,
  DbSyncMeta,
  GwSnapshot,
  OptimalPlayerEntry,
  OptimalManagerEntry,
  OptimalFplDatabaseSchema,
  FplDatabaseSchema,
  StandingsRow,
  TransformedLeagueData
} from '../types.ts';

const DB_FILE_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');
const CACHE_FILE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

// In-Memory Database and Ultra-Fast O(1) Lookup Indices
let optimalDatabaseState: OptimalFplDatabaseSchema | null = null;
let legacyDatabaseState: FplDatabaseSchema | null = null;

// High-speed O(1) In-Memory Hash Maps for Sub-Millisecond Response
const indexedSnapshots = new Map<number, GwSnapshot>();
const indexedPlayers = new Map<number, OptimalPlayerEntry>();
const indexedManagers = new Map<number, OptimalManagerEntry>();
const indexedStandingsByGw = new Map<number, StandingsRow[]>();
const indexedTransfersByGw = new Map<number, DbTransfer[]>();

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
  indexedManagers.clear();
  indexedStandingsByGw.clear();
  indexedTransfersByGw.clear();

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

  // Index Managers O(1)
  for (const [idStr, manager] of Object.entries(optDb.managers)) {
    indexedManagers.set(Number(idStr), manager);
  }

  console.log(`[Database Indices] Populated: ${indexedSnapshots.size} GW snapshots, ${indexedPlayers.size} players, ${indexedManagers.size} managers.`);
}

/**
 * Transform TransformedLeagueData into the Optimal Pre-Aggregated Database Schema
 */
export function transformToOptimalDbSchema(fplData: TransformedLeagueData): {
  optimal: OptimalFplDatabaseSchema;
  legacy: FplDatabaseSchema;
} {
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
  const allStandingsLegacy: DbStanding[] = [];
  const allTransfersLegacy: DbTransfer[] = [];

  for (const gw of availableGws) {
    // Standings for this GW
    const rawStandings = fplData.standings?.[gw] || [];
    const dbStandings: DbStanding[] = rawStandings.map(r => ({
      gw,
      rank: r.rank,
      lastRank: r.last_rank,
      rankChange: r.rank_change,
      entryId: r.entry_id,
      entryName: r.entry_name,
      playerName: r.player_name,
      totalPoints: r.total_points,
      eventPoints: r.event_points,
      eventTransfersCost: r.event_transfers_cost,
      activeChip: r.active_chip || null,
      captain: r.captain || null,
      viceCaptain: r.vice_captain || null
    }));
    allStandingsLegacy.push(...dbStandings);

    // Champion for this GW
    const champRow = (fplData.gameweek_champions || []).find(c => c.event === gw);
    const dbChampion: DbGameweekChampion | null = champRow ? {
      gw,
      points: champRow.points,
      entryIds: (champRow.champions || []).map(c => c.entry_id),
      champions: (champRow.champions || []).map(c => ({
        entry_id: c.entry_id,
        player_name: c.player_name,
        entry_name: c.entry_name,
        points: c.points,
        rank_at_gw: c.rank_at_gw
      }))
    } : null;

    // Template Squad for this GW
    const squad = fplData.template_squads?.[gw];
    const dbTemplateSquad: DbTemplateSquad | null = squad ? {
      gw,
      gks: squad.gks || [],
      defs: squad.defs || [],
      mids: squad.mids || [],
      fwds: squad.fwds || [],
      totalCost: squad.total_cost || 0
    } : null;

    // Top Captains for this GW
    const rawCaptains = fplData.captain_players?.[gw] || [];
    const dbCaptains: DbCaptainStat[] = rawCaptains.map(c => ({
      gw,
      playerId: c.id,
      webName: c.web_name,
      captainCount: c.captain_count,
      captainPercentage: c.captain_percentage,
      viceCount: c.vice_count
    }));

    // Ownership Players for this GW
    const rawOwnershipPlayers = fplData.ownership_players?.[gw] || [];
    const dbOwnershipPlayers: DbOwnershipPlayer[] = rawOwnershipPlayers.map(p => ({
      gw,
      elementId: p.id,
      playerId: p.id,
      webName: p.web_name,
      teamName: p.team_name,
      position: p.position,
      ownedCount: p.owned_count,
      ownedPercentage: p.owned_percentage,
      totalPoints: p.total_points,
      owners: p.owners || []
    }));

    // Ownership Clubs for this GW
    const rawOwnershipClubs = fplData.ownership_clubs?.[gw] || [];
    const dbOwnershipClubs: DbOwnershipClub[] = rawOwnershipClubs.map(c => ({
      gw,
      clubId: c.club_id,
      clubName: c.name,
      ownedCount: c.owned_count,
      ownedPercentage: c.owned_percentage
    }));

    // Transfers for this GW
    const rawTransfers = (fplData.all_transfers || []).filter(t => t.event === gw);
    const dbTransfers: DbTransfer[] = rawTransfers.map(t => ({
      gw: t.event,
      time: t.time,
      entryId: t.entry_id,
      elementIn: t.element_in.id,
      elementOut: t.element_out.id
    }));
    allTransfersLegacy.push(...dbTransfers);

    gwSnapshots[gw] = {
      gw,
      standings: fplData.standings?.[gw] || [],
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

  // 4. League Analytics
  const allChipsUsed: DbChipUsed[] = (fplData.all_chips_used || []).flatMap(chip => {
    const list: DbChipUsed[] = [];
    const keys: Array<keyof typeof chip> = ['wc1', 'tc1', 'bb1', 'fh1', 'wc2', 'tc2', 'bb2', 'fh2'];
    for (const key of keys) {
      const cell = chip[key];
      if (cell && typeof cell === 'object' && 'gw' in cell && 'points' in cell) {
        list.push({
          entryId: chip.entry_id,
          entryName: chip.entry_name,
          playerName: chip.player_name,
          chipName: String(key).toUpperCase(),
          gw: cell.gw,
          points: cell.points
        });
      }
    }
    return list;
  });

  const fansClubsDict: Record<string, DbFansClub[]> = {};
  if (fplData.fans_clubs) {
    for (const [filterKey, groups] of Object.entries(fplData.fans_clubs)) {
      fansClubsDict[filterKey] = (groups || []).map(group => ({
        gw: fplData.current_gw || 1,
        clubId: group.club_id,
        clubName: group.club_name,
        managers: group.managers || []
      }));
    }
  }

  const ligaMinus: DbLigaMinus[] = (fplData.liga_minus || []).map(m => ({
    entryId: m.entry_id,
    entryName: m.entry_name,
    playerName: m.player_name,
    totalMinusPoints: m.total_minus_points,
    currentRank: m.current_rank
  }));

  const tableCounts = {
    gwSnapshots: Object.keys(gwSnapshots).length,
    indexedPlayers: Object.keys(playersDict).length,
    indexedManagers: Object.keys(managersDict).length,
    standings: allStandingsLegacy.length,
    transfers: allTransfersLegacy.length,
    chipsUsed: allChipsUsed.length,
    ligaMinus: ligaMinus.length
  };

  const optimal: OptimalFplDatabaseSchema = {
    meta: {
      league_id: fplData.league_id || 12356,
      league_name: fplData.league_name || 'FPL Nusantara BERHADIAH',
      current_gw: fplData.current_gw || 1,
      available_gws: availableGws,
      total_teams: fplData.sync_status?.total_teams || Object.keys(managersDict).length || 97,
      last_synced: fplData.sync_status?.last_synced || new Date().toISOString(),
      next_sync_wib: fplData.sync_status?.next_sync_wib || '07:00 WIB',
      is_live: !!fplData.sync_status?.is_matchday_live
    },
    gw_snapshots: gwSnapshots,
    players: playersDict,
    managers: managersDict,
    league_analytics: {
      all_chips_used: fplData.all_chips_used || [],
      fans_clubs: fplData.fans_clubs || {},
      liga_minus: fplData.liga_minus || [],
      most_gameweek_champions: fplData.most_gameweek_champions || [],
      all_transfers: fplData.all_transfers || []
    },
    table_counts: tableCounts
  };

  // Construct legacy relational structure for backwards compatibility
  const legacy: FplDatabaseSchema = {
    standings: allStandingsLegacy,
    gameweekChampions: (fplData.gameweek_champions || []).map(c => ({
      gw: c.event,
      points: c.points,
      entryIds: (c.champions || []).map(champ => champ.entry_id),
      champions: (c.champions || []).map(champ => ({
        entry_id: champ.entry_id,
        player_name: champ.player_name,
        entry_name: champ.entry_name,
        points: champ.points,
        rank_at_gw: champ.rank_at_gw
      }))
    })),
    ownershipPlayers: Object.values(gwSnapshots).flatMap(s => (s.ownership_players || []) as any),
    ownershipClubs: Object.values(gwSnapshots).flatMap(s => (s.ownership_clubs || []) as any),
    fansClubs: Object.values(fansClubsDict).flat() as any,
    templateSquads: Object.values(gwSnapshots).map(s => s.template_squad).filter(Boolean) as any,
    transfers: allTransfersLegacy,
    ligaMinus,
    captainStats: Object.values(gwSnapshots).flatMap(s => (s.top_captains || []) as any),
    chipsUsed: allChipsUsed,
    players: Object.values(playersDict) as any,
    meta: {
      lastSynced: optimal.meta.last_synced,
      nextSyncWib: optimal.meta.next_sync_wib,
      isMatchdayLive: optimal.meta.is_live,
      currentGw: optimal.meta.current_gw,
      leagueId: optimal.meta.league_id,
      leagueName: optimal.meta.league_name,
      totalTeams: optimal.meta.total_teams,
      tableCounts
    }
  };

  return { optimal, legacy };
}

/**
 * Execute synchronization of fresh FPL data into the database schema
 */
export function executeSchemaSync(fplData: TransformedLeagueData): OptimalFplDatabaseSchema {
  console.log('[Database] Executing Optimal Pre-Aggregated DB Schema transformation...');
  const { optimal, legacy } = transformToOptimalDbSchema(fplData);
  optimalDatabaseState = optimal;
  legacyDatabaseState = legacy;

  // Populate lightning-fast in-memory maps
  populateMemoryIndices(optimal);

  try {
    fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
    // Write formatted JSON to database file
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(optimal, null, 2), 'utf-8');
    console.log('[Database] Optimal DB Schema persisted to', DB_FILE_PATH);
  } catch (err: any) {
    console.error('[Database] Failed to write database to disk:', err.message);
  }

  return optimal;
}

/**
 * Initialize database on server startup
 */
export function initDatabase(): OptimalFplDatabaseSchema {
  if (optimalDatabaseState) {
    return optimalDatabaseState;
  }

  // 1. Try reading fpl_database.json
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
      console.warn('[Database] Error reading fpl_database.json, falling back to cache:', err.message);
    }
  }

  // 2. If database doesn't exist yet, seed it from cachedLeagueData.json
  if (fs.existsSync(CACHE_FILE_PATH)) {
    try {
      const cacheRaw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      const cached = JSON.parse(cacheRaw) as TransformedLeagueData;
      console.log('[Database] Initializing and migrating database from cachedLeagueData.json...');
      return executeSchemaSync(cached);
    } catch (err: any) {
      console.error('[Database] Failed to seed database from cached data:', err.message);
    }
  }

  // 3. Fallback to empty database
  console.log('[Database] Initializing fresh empty database.');
  optimalDatabaseState = createEmptyOptimalDatabase();
  populateMemoryIndices(optimalDatabaseState);
  return optimalDatabaseState;
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

/**
 * Backward compatibility: get legacy database state
 */
export function getDatabase(): FplDatabaseSchema {
  if (!legacyDatabaseState) {
    initDatabase();
  }
  return legacyDatabaseState || {
    standings: [],
    gameweekChampions: [],
    ownershipPlayers: [],
    ownershipClubs: [],
    fansClubs: [],
    templateSquads: [],
    transfers: [],
    ligaMinus: [],
    captainStats: [],
    chipsUsed: [],
    players: [],
    meta: {
      lastSynced: new Date().toISOString(),
      nextSyncWib: '07:00 WIB',
      isMatchdayLive: false,
      currentGw: 1,
      leagueId: 12356,
      leagueName: 'FPL Nusantara BERHADIAH',
      totalTeams: 0,
      tableCounts: {}
    }
  };
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

/**
 * Get player by ID in O(1) time (< 1ms) for instantaneous modal opening
 */
export function getOptimalPlayerById(id: number): OptimalPlayerEntry | null {
  if (!optimalDatabaseState) initDatabase();
  return indexedPlayers.get(Number(id)) || null;
}

/**
 * Get manager by Entry ID in O(1) time (< 1ms)
 */
export function getOptimalManagerById(entryId: number): OptimalManagerEntry | null {
  if (!optimalDatabaseState) initDatabase();
  return indexedManagers.get(Number(entryId)) || null;
}

// =========================================================================
// BACKWARD COMPATIBLE ACCESSORS WITH O(1) / INDEX ACCELERATION
// =========================================================================

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

export function getDbGameweekChampions(gw?: number): DbGameweekChampion[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.gameweekChampions.filter(c => c.gw === Number(gw));
  }
  return db.gameweekChampions;
}

export function getDbOwnershipPlayers(gw?: number): DbOwnershipPlayer[] {
  if (gw !== undefined) {
    const snap = getGwSnapshot(gw);
    return snap ? (snap.ownership_players as any) : [];
  }
  const db = getDatabase();
  return db.ownershipPlayers;
}

export function getDbOwnershipClubs(gw?: number): DbOwnershipClub[] {
  if (gw !== undefined) {
    const snap = getGwSnapshot(gw);
    return snap ? (snap.ownership_clubs as any) : [];
  }
  const db = getDatabase();
  return db.ownershipClubs;
}

export function getDbFansClubs(filter?: string): DbFansClub[] {
  const db = getDatabase();
  if (filter !== undefined) {
    return db.fansClubs.filter(f => String(f.gw) === String(filter));
  }
  return db.fansClubs;
}

export function getDbTemplateSquads(gw?: number): DbTemplateSquad[] {
  if (gw !== undefined) {
    const snap = getGwSnapshot(gw);
    return snap && snap.template_squad ? [(snap.template_squad as any)] : [];
  }
  const db = getDatabase();
  return db.templateSquads;
}

export function getDbTransfers(gw?: number, entryId?: number): DbTransfer[] {
  if (!optimalDatabaseState) initDatabase();
  let list = gw !== undefined ? (indexedTransfersByGw.get(Number(gw)) || []) : getDatabase().transfers;
  if (entryId !== undefined) {
    list = list.filter(t => t.entryId === Number(entryId));
  }
  return list;
}

export function getDbLigaMinus(): DbLigaMinus[] {
  const opt = getOptimalDatabase();
  return (opt.league_analytics?.liga_minus as any) || [];
}

export function getDbCaptainStats(gw?: number): DbCaptainStat[] {
  if (gw !== undefined) {
    const snap = getGwSnapshot(gw);
    return snap ? (snap.top_captains as any) : [];
  }
  const db = getDatabase();
  return db.captainStats;
}

export function getDbChipsUsed(entryId?: number): DbChipUsed[] {
  const opt = getOptimalDatabase();
  const all = (opt.league_analytics?.all_chips_used as any) || [];
  if (entryId !== undefined) {
    return all.filter((c: any) => c.entryId === Number(entryId) || c.entry_id === Number(entryId));
  }
  return all;
}

export function getDbPlayerStats(query?: {
  position?: string;
  team?: string;
  search?: string;
  sortBy?: string;
  limit?: number;
}): OptimalPlayerEntry[] {
  if (!optimalDatabaseState) initDatabase();
  let list = Array.from(indexedPlayers.values());
  if (query?.position) {
    const pos = query.position.toUpperCase();
    list = list.filter(p => p.position === pos);
  }
  if (query?.team) {
    const t = query.team.toLowerCase();
    list = list.filter(p => p.teamShort.toLowerCase() === t || p.teamName.toLowerCase().includes(t));
  }
  if (query?.search) {
    const s = query.search.toLowerCase();
    list = list.filter(p => p.webName.toLowerCase().includes(s) || p.fullName.toLowerCase().includes(s));
  }
  if (query?.sortBy) {
    const field = query.sortBy as keyof OptimalPlayerEntry;
    list = [...list].sort((a, b) => {
      const valA = (a[field] as number) || 0;
      const valB = (b[field] as number) || 0;
      return valB - valA;
    });
  }
  if (query?.limit && query.limit > 0) {
    list = list.slice(0, query.limit);
  }
  return list;
}

export function getDbPlayerStatById(id: number): OptimalPlayerEntry | null {
  return getOptimalPlayerById(id);
}

export function getDbSyncMeta(): DbSyncMeta {
  const opt = getOptimalDatabase();
  return {
    lastSynced: opt.meta.last_synced,
    nextSyncWib: opt.meta.next_sync_wib,
    isMatchdayLive: opt.meta.is_live,
    currentGw: opt.meta.current_gw,
    leagueId: opt.meta.league_id,
    leagueName: opt.meta.league_name,
    totalTeams: opt.meta.total_teams,
    tableCounts: opt.table_counts
  };
}

export function getDatabaseStats() {
  const opt = getOptimalDatabase();
  return {
    architecture: 'Optimal Pre-Aggregated / Indexed Materialized Views',
    totalTables: 12,
    recordCounts: opt.table_counts,
    indexedSnapshots: indexedSnapshots.size,
    indexedPlayers: indexedPlayers.size,
    indexedManagers: indexedManagers.size,
    lastSynced: opt.meta.last_synced,
    nextSyncWib: opt.meta.next_sync_wib,
    isMatchdayLive: opt.meta.is_live,
    currentGw: opt.meta.current_gw,
    leagueId: opt.meta.league_id,
    leagueName: opt.meta.league_name
  };
}
