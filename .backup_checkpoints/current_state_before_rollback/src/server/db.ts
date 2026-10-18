import fs from 'fs';
import path from 'path';
import type {
  FplDatabaseSchema,
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
  DbSyncMeta
} from '../../convex/schema.ts';
import { TransformedLeagueData } from '../types.ts';

const DB_FILE_PATH = path.join(process.cwd(), 'src/data/fpl_database.json');
const CACHE_FILE_PATH = path.join(process.cwd(), 'src/data/cachedLeagueData.json');

// In-memory database instance
let databaseState: FplDatabaseSchema | null = null;

/**
 * Creates an empty database matching the schema
 */
function createEmptyDatabase(): FplDatabaseSchema {
  return {
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
    playerStats: [],
    syncMeta: {
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

/**
 * Transform TransformedLeagueData to the normalized 11-table Database Schema
 */
export function transformToDbSchema(fplData: TransformedLeagueData): FplDatabaseSchema {
  // 1. Standings
  const standings: DbStanding[] = [];
  if (fplData.standings) {
    for (const [gwStr, rows] of Object.entries(fplData.standings)) {
      const gw = Number(gwStr);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          standings.push({
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
          });
        }
      }
    }
  }

  // 2. Gameweek Champions
  const gameweekChampions: DbGameweekChampion[] = [];
  if (Array.isArray(fplData.gameweek_champions)) {
    for (const champ of fplData.gameweek_champions) {
      gameweekChampions.push({
        gw: champ.event,
        points: champ.points,
        champions: (champ.champions || []).map(c => ({
          entryId: c.entry_id,
          playerName: c.player_name,
          entryName: c.entry_name,
          points: c.points,
          rankAtGw: c.rank_at_gw
        }))
      });
    }
  }

  // 3. Ownership Players
  const ownershipPlayers: DbOwnershipPlayer[] = [];
  if (fplData.ownership_players) {
    for (const [gwStr, items] of Object.entries(fplData.ownership_players)) {
      const gw = Number(gwStr);
      if (Array.isArray(items)) {
        for (const item of items) {
          ownershipPlayers.push({
            gw,
            elementId: item.id,
            webName: item.web_name,
            teamName: item.team_name,
            position: item.position,
            ownedCount: item.owned_count,
            ownedPercentage: item.owned_percentage,
            totalPoints: item.total_points
          });
        }
      }
    }
  }

  // 4. Ownership Clubs
  const ownershipClubs: DbOwnershipClub[] = [];
  if (fplData.ownership_clubs) {
    for (const [gwStr, items] of Object.entries(fplData.ownership_clubs)) {
      const gw = Number(gwStr);
      if (Array.isArray(items)) {
        for (const club of items) {
          ownershipClubs.push({
            gw,
            clubId: club.club_id,
            clubName: club.name,
            ownedCount: club.owned_count,
            ownedPercentage: club.owned_percentage
          });
        }
      }
    }
  }

  // 5. Fans Clubs
  const fansClubs: DbFansClub[] = [];
  if (fplData.fans_clubs) {
    for (const [filterKey, groups] of Object.entries(fplData.fans_clubs)) {
      if (Array.isArray(groups)) {
        for (const group of groups) {
          fansClubs.push({
            filter: filterKey,
            clubId: group.club_id,
            clubName: group.club_name,
            managers: group.managers || []
          });
        }
      }
    }
  }

  // 6. Template Squads
  const templateSquads: DbTemplateSquad[] = [];
  if (fplData.template_squads) {
    for (const [gwStr, squad] of Object.entries(fplData.template_squads)) {
      const gw = Number(gwStr);
      if (squad) {
        templateSquads.push({
          gw,
          gks: squad.gks || [],
          defs: squad.defs || [],
          mids: squad.mids || [],
          fwds: squad.fwds || [],
          totalCost: squad.total_cost || 0
        });
      }
    }
  }

  // 7. Transfers
  const transfers: DbTransfer[] = [];
  if (Array.isArray(fplData.all_transfers)) {
    for (const t of fplData.all_transfers) {
      transfers.push({
        time: t.time,
        event: t.event,
        entryId: t.entry_id,
        playerName: t.player_name,
        entryName: t.entry_name,
        elementIn: {
          id: t.element_in.id,
          name: t.element_in.name,
          club: t.element_in.club,
          cost: t.element_in.cost
        },
        elementOut: {
          id: t.element_out.id,
          name: t.element_out.name,
          club: t.element_out.club,
          cost: t.element_out.cost
        }
      });
    }
  }

  // 8. Liga Minus
  const ligaMinus: DbLigaMinus[] = [];
  if (Array.isArray(fplData.liga_minus)) {
    for (const lm of fplData.liga_minus) {
      ligaMinus.push({
        entryId: lm.entry_id,
        entryName: lm.entry_name,
        playerName: lm.player_name,
        totalMinusPoints: lm.total_minus_points,
        currentRank: lm.current_rank
      });
    }
  }

  // 9. Captain Stats
  const captainStats: DbCaptainStat[] = [];
  if (fplData.captain_players) {
    for (const [gwStr, items] of Object.entries(fplData.captain_players)) {
      const gw = Number(gwStr);
      if (Array.isArray(items)) {
        for (const item of items) {
          captainStats.push({
            gw,
            playerId: item.id,
            webName: item.web_name,
            captainCount: item.captain_count,
            captainPercentage: item.captain_percentage,
            viceCount: item.vice_count
          });
        }
      }
    }
  }

  // 10. Chips Used
  const chipsUsed: DbChipUsed[] = [];
  if (Array.isArray(fplData.all_chips_used)) {
    for (const chip of fplData.all_chips_used) {
      chipsUsed.push({
        entryId: chip.entry_id,
        entryName: chip.entry_name,
        playerName: chip.player_name,
        wc1: chip.wc1 || null,
        tc1: chip.tc1 || null,
        bb1: chip.bb1 || null,
        fh1: chip.fh1 || null,
        wc2: chip.wc2 || null,
        tc2: chip.tc2 || null,
        bb2: chip.bb2 || null,
        fh2: chip.fh2 || null
      });
    }
  }

  // 11. Player Stats (Comprehensive season & advanced stats for Premier League players)
  const playerStats: DbPlayerStat[] = [];
  if (Array.isArray(fplData.player_stats)) {
    for (const p of fplData.player_stats) {
      playerStats.push(p);
    }
  }

  const tableCounts = {
    standings: standings.length,
    gameweekChampions: gameweekChampions.length,
    ownershipPlayers: ownershipPlayers.length,
    ownershipClubs: ownershipClubs.length,
    fansClubs: fansClubs.length,
    templateSquads: templateSquads.length,
    transfers: transfers.length,
    ligaMinus: ligaMinus.length,
    captainStats: captainStats.length,
    chipsUsed: chipsUsed.length,
    playerStats: playerStats.length
  };

  // 12. Sync Meta
  const syncMeta: DbSyncMeta = {
    lastSynced: fplData.sync_status?.last_synced || new Date().toISOString(),
    nextSyncWib: fplData.sync_status?.next_sync_wib || '07:00 WIB',
    isMatchdayLive: !!fplData.sync_status?.is_matchday_live,
    currentGw: fplData.current_gw || 1,
    leagueId: fplData.league_id || 12356,
    leagueName: fplData.league_name || 'FPL Nusantara BERHADIAH',
    totalTeams: fplData.sync_status?.total_teams || 97,
    tableCounts
  };

  return {
    standings,
    gameweekChampions,
    ownershipPlayers,
    ownershipClubs,
    fansClubs,
    templateSquads,
    transfers,
    ligaMinus,
    captainStats,
    chipsUsed,
    playerStats,
    syncMeta
  };
}

/**
 * Execute synchronization of fresh FPL data into the database schema
 */
export function executeSchemaSync(fplData: TransformedLeagueData): FplDatabaseSchema {
  console.log('[Database] Executing DB Schema transformation & sync...');
  const newDb = transformToDbSchema(fplData);
  databaseState = newDb;

  try {
    fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
    // Write formatted JSON to database file
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(newDb, null, 2), 'utf-8');
    console.log('[Database] DB Schema sync successfully persisted to', DB_FILE_PATH);
    console.log('[Database] Records summary:', JSON.stringify(newDb.syncMeta.tableCounts));
  } catch (err: any) {
    console.error('[Database] Failed to write database to disk:', err.message);
  }

  return newDb;
}

/**
 * Initialize database on server startup
 */
export function initDatabase(): FplDatabaseSchema {
  if (databaseState) {
    return databaseState;
  }

  // 1. Try reading fpl_database.json
  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      databaseState = JSON.parse(raw) as FplDatabaseSchema;
      console.log('[Database] Successfully loaded database from disk.');
      return databaseState;
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
      databaseState = executeSchemaSync(cached);
      return databaseState;
    } catch (err: any) {
      console.error('[Database] Failed to seed database from cached data:', err.message);
    }
  }

  // 3. Fallback to empty database
  console.log('[Database] Initializing fresh empty database.');
  databaseState = createEmptyDatabase();
  return databaseState;
}

/**
 * Get current database state
 */
export function getDatabase(): FplDatabaseSchema {
  if (!databaseState) {
    return initDatabase();
  }
  return databaseState;
}

// Table Query Selectors
export function getDbStandings(gw?: number): DbStanding[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.standings.filter(s => s.gw === Number(gw));
  }
  return db.standings;
}

export function getDbGameweekChampions(gw?: number): DbGameweekChampion[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.gameweekChampions.filter(c => c.gw === Number(gw));
  }
  return db.gameweekChampions;
}

export function getDbOwnershipPlayers(gw?: number): DbOwnershipPlayer[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.ownershipPlayers.filter(p => p.gw === Number(gw));
  }
  return db.ownershipPlayers;
}

export function getDbOwnershipClubs(gw?: number): DbOwnershipClub[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.ownershipClubs.filter(c => c.gw === Number(gw));
  }
  return db.ownershipClubs;
}

export function getDbFansClubs(filter?: string): DbFansClub[] {
  const db = getDatabase();
  if (filter !== undefined) {
    return db.fansClubs.filter(f => f.filter === String(filter));
  }
  return db.fansClubs;
}

export function getDbTemplateSquads(gw?: number): DbTemplateSquad[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.templateSquads.filter(t => t.gw === Number(gw));
  }
  return db.templateSquads;
}

export function getDbTransfers(gw?: number, entryId?: number): DbTransfer[] {
  const db = getDatabase();
  let list = db.transfers;
  if (gw !== undefined) {
    list = list.filter(t => t.event === Number(gw));
  }
  if (entryId !== undefined) {
    list = list.filter(t => t.entryId === Number(entryId));
  }
  return list;
}

export function getDbLigaMinus(): DbLigaMinus[] {
  const db = getDatabase();
  return db.ligaMinus;
}

export function getDbCaptainStats(gw?: number): DbCaptainStat[] {
  const db = getDatabase();
  if (gw !== undefined) {
    return db.captainStats.filter(c => c.gw === Number(gw));
  }
  return db.captainStats;
}

export function getDbChipsUsed(entryId?: number): DbChipUsed[] {
  const db = getDatabase();
  if (entryId !== undefined) {
    return db.chipsUsed.filter(c => c.entryId === Number(entryId));
  }
  return db.chipsUsed;
}

export function getDbPlayerStats(query?: {
  position?: string;
  team?: string;
  search?: string;
  sortBy?: string;
  limit?: number;
}): DbPlayerStat[] {
  const db = getDatabase();
  let list = db.playerStats || [];
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
    const field = query.sortBy as keyof DbPlayerStat;
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

export function getDbPlayerStatById(id: number): DbPlayerStat | null {
  const db = getDatabase();
  return (db.playerStats || []).find(p => p.id === Number(id)) || null;
}

export function getDbSyncMeta(): DbSyncMeta {
  const db = getDatabase();
  return db.syncMeta;
}

export function getDatabaseStats() {
  const db = getDatabase();
  return {
    totalTables: 12,
    recordCounts: db.syncMeta.tableCounts || {
      standings: db.standings.length,
      gameweekChampions: db.gameweekChampions.length,
      ownershipPlayers: db.ownershipPlayers.length,
      ownershipClubs: db.ownershipClubs.length,
      fansClubs: db.fansClubs.length,
      templateSquads: db.templateSquads.length,
      transfers: db.transfers.length,
      ligaMinus: db.ligaMinus.length,
      captainStats: db.captainStats.length,
      chipsUsed: db.chipsUsed.length,
      playerStats: (db.playerStats || []).length
    },
    lastSynced: db.syncMeta.lastSynced,
    nextSyncWib: db.syncMeta.nextSyncWib,
    isMatchdayLive: db.syncMeta.isMatchdayLive,
    currentGw: db.syncMeta.currentGw,
    leagueId: db.syncMeta.leagueId,
    leagueName: db.syncMeta.leagueName
  };
}
