/**
 * Convex Schema for FPL Nusantara BERHADIAH (Mini League 12356)
 * Defines only the transformed fields needed by the application.
 */

export const convexSchemaDefinition = {
  standings: {
    gw: "number",
    rank: "number",
    lastRank: "optional(number)",
    rankChange: "number",
    entryId: "number",
    entryName: "string",
    playerName: "string",
    totalPoints: "number",
    eventPoints: "number",
    eventTransfersCost: "number",
    activeChip: "optional(string)",
    captain: "optional(object)",
    viceCaptain: "optional(object)"
  },
  gameweekChampions: {
    gw: "number",
    points: "number",
    champions: "array"
  },
  ownershipPlayers: {
    gw: "number",
    elementId: "number",
    webName: "string",
    teamName: "string",
    position: "string",
    ownedCount: "number",
    ownedPercentage: "number",
    totalPoints: "number"
  },
  ownershipClubs: {
    gw: "number",
    clubId: "number",
    clubName: "string",
    ownedCount: "number",
    ownedPercentage: "number"
  },
  fansClubs: {
    filter: "string", // "all" or gw string
    clubId: "number",
    clubName: "string",
    managers: "array"
  },
  templateSquads: {
    gw: "number",
    gks: "array",
    defs: "array",
    mids: "array",
    fwds: "array",
    totalCost: "number"
  },
  transfers: {
    time: "string",
    event: "number",
    entryId: "number",
    playerName: "string",
    entryName: "string",
    elementIn: "object",
    elementOut: "object"
  },
  ligaMinus: {
    entryId: "number",
    entryName: "string",
    playerName: "string",
    totalMinusPoints: "number",
    currentRank: "number"
  },
  captainStats: {
    gw: "number",
    playerId: "number",
    webName: "string",
    captainCount: "number",
    captainPercentage: "number",
    viceCount: "number"
  },
  chipsUsed: {
    entryId: "number",
    entryName: "string",
    playerName: "string",
    wc1: "optional(object)",
    tc1: "optional(object)",
    bb1: "optional(object)",
    fh1: "optional(object)",
    wc2: "optional(object)",
    tc2: "optional(object)",
    bb2: "optional(object)",
    fh2: "optional(object)"
  },
  syncMeta: {
    lastSynced: "string",
    nextSyncWib: "string",
    isMatchdayLive: "boolean",
    currentGw: "number"
  }
};
