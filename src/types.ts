export type PositionType = 'GKP' | 'DEF' | 'MID' | 'FWD';

export interface FPLTeam {
  id: number;
  name: string;
  short_name: string;
  code: number;
  badge_url: string;
  shirt_url: string;
  gk_shirt_url: string;
}

export interface FPLElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  team_code: number;
  team_short_name: string;
  element_type: number;
  position: PositionType;
  now_cost: number; // in £0.1m, e.g. 100 = £10.0m
  total_points: number;
  event_points: number;
}

export interface StandingsRow {
  rank: number;
  last_rank: number | null;
  rank_change: number; // positive = climbed up, negative = dropped, 0 = unchanged
  entry_id: number;
  entry_name: string;
  player_name: string;
  total_points: number;
  event_points: number;
  event_transfers_cost: number;
  total_transfers_cost?: number;
  total_transfers_count?: number;
  active_chip: string | null;
  captain: {
    id: number;
    name: string;
    club: string;
    points: number;
    multiplier: number;
  } | null;
  vice_captain: {
    id: number;
    name: string;
    club: string;
    points: number;
  } | null;
}

export interface GWChampionEntry {
  entry_id: number;
  player_name: string;
  entry_name: string;
  points: number;
  rank_at_gw: number;
  last_rank_at_gw?: number | null;
  rank_change_at_gw?: number;
}

export interface GWChampionRow {
  event: number;
  points: number;
  champions: GWChampionEntry[];
  is_finished?: boolean;
}

export interface MostGWChampionLeader {
  position: number;
  entry_id?: number;
  player_name: string;
  entry_name: string;
  win_count: number;
  gws_won: number[];
  current_rank: number;
}

export interface PlayerOwnerItem {
  entry_id: number;
  entry_name: string;
  player_name: string;
  position_in_squad: number; // 1-15
  is_starter: boolean; // 1-11
  is_captain: boolean;
  is_vice_captain: boolean;
  multiplier: number; // 0, 1, 2, 3
}

export interface PlayerOwnershipItem {
  id: number;
  code?: number;
  photo?: string;
  web_name: string;
  full_name: string;
  team_name: string;
  team_short_name: string;
  team_code: number;
  element_type: number;
  position: PositionType;
  now_cost: number;
  total_points: number;
  gw_points?: number;
  owned_count: number;
  owned_percentage: number;
  owners?: PlayerOwnerItem[];
}

export interface PlayerExplainStatItem {
  identifier: string;
  points: number;
  value: number;
}

export interface PlayerLiveStats {
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution?: number;
  total_points: number;
  opponent_short_name?: string;
  was_home?: boolean;
  team_h_score?: number;
  team_a_score?: number;
  explain?: PlayerExplainStatItem[];
  expected_goals?: number | string;
  expected_assists?: number | string;
  expected_goal_involvements?: number | string;
  expected_goals_conceded?: number | string;
  clearances_blocks_interceptions?: number;
  tackles?: number;
  recoveries?: number;
  influence?: number | string;
  creativity?: number | string;
  threat?: number | string;
  ict_index?: number | string;
  in_dreamteam?: boolean;
  played?: boolean;
  starts?: number;
}

export interface PlayerHistoryRound {
  element: number;
  round: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution?: number;
  opponent_team: number;
  opponent_short_name?: string;
  was_home: boolean;
  team_h_score: number;
  team_a_score: number;
  kickoff_time: string;
  expected_goals?: number | string;
  expected_assists?: number | string;
  expected_goal_involvements?: number | string;
  expected_goals_conceded?: number | string;
  clearances_blocks_interceptions?: number;
  tackles?: number;
  recoveries?: number;
  influence?: number | string;
  creativity?: number | string;
  threat?: number | string;
  ict_index?: number | string;
  in_dreamteam?: boolean;
  starts?: number;
  value?: number;
  transfers_balance?: number;
  selected?: number;
  transfers_in?: number;
  transfers_out?: number;
  fixture?: number;
  fixture_started?: boolean;
  fixture_finished?: boolean;
  fixture_finished_provisional?: boolean;
  fixture_minutes?: number;
  player_team?: number;
  player_team_short_name?: string;
  home_team_id?: number;
  away_team_id?: number;
  home_short_name?: string;
  away_short_name?: string;
}

export interface PlayerHistoryPast {
  season_name: string;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution?: number;
  expected_goals?: number | string;
  expected_assists?: number | string;
  expected_goal_involvements?: number | string;
  expected_goals_conceded?: number | string;
  clearances_blocks_interceptions?: number;
  tackles?: number;
  recoveries?: number;
  influence?: number | string;
  creativity?: number | string;
  threat?: number | string;
  ict_index?: number | string;
  starts?: number;
  start_cost?: number;
  end_cost?: number;
}

export interface PlayerSummaryDetail {
  id: number;
  gw: number;
  player_info?: DbPlayerStat | null;
  history: PlayerHistoryRound[];
  history_past?: PlayerHistoryPast[];
  fixtures?: any[];
  gw_fixtures?: any[];
  live_stats?: PlayerLiveStats | null;
  live_explain?: { fixture: number; stats: PlayerExplainStatItem[] }[];
}

export interface ClubOwnershipItem {
  club_id: number;
  name: string;
  short_name: string;
  code: number;
  badge_url: string;
  owned_count: number;
  owned_percentage: number;
}

export interface FansClubManager {
  entry_id: number;
  entry_name: string;
  player_name: string;
  player_count: number;
  players: string[];
}

export interface FansClubGroup {
  club_id: number;
  club_name: string;
  club_short_name: string;
  club_code: number;
  badge_url: string;
  managers: FansClubManager[];
}

export interface TemplateSquadPlayer {
  id: number;
  web_name: string;
  full_name: string;
  team_short_name: string;
  team_code: number;
  element_type: number;
  position: PositionType;
  slot_index: number;
  owned_count: number;
  owned_percentage: number;
  total_points: number;
  now_cost: number;
  is_gk: boolean;
  shirt_url: string;
}

export interface TemplateSquadData {
  gks: TemplateSquadPlayer[];
  defs: TemplateSquadPlayer[];
  mids: TemplateSquadPlayer[];
  fwds: TemplateSquadPlayer[];
  total_cost: number;
}

export interface TransferItem {
  id: string;
  time: string;
  formatted_time_wib?: string;
  event: number;
  entry_id: number;
  player_name: string;
  entry_name: string;
  element_in: {
    id: number;
    name: string;
    club: string;
    position?: PositionType;
    cost: number;
    gw_points?: number;
  };
  element_out: {
    id: number;
    name: string;
    club: string;
    position?: PositionType;
    cost: number;
    gw_points?: number;
  };
}

export interface MostTransferredItem {
  id: number;
  web_name: string;
  team_short_name: string;
  position: PositionType;
  now_cost: number;
  total_points: number;
  gw_points?: number;
  transfer_count: number;
}

export interface LigaMinusItem {
  entry_id: number;
  entry_name: string;
  player_name: string;
  total_minus_points: number;
  current_rank: number;
}

export interface CaptainPlayerItem {
  id: number;
  web_name: string;
  team_short_name: string;
  team_code?: number;
  position: PositionType;
  now_cost?: number;
  captain_count: number;
  captain_percentage: number;
  vice_count: number;
  vice_percentage?: number;
  total_points: number;
  gw_points: number;
}

export interface ClubCaptainItem {
  club_id: number;
  name: string;
  short_name: string;
  code: number;
  badge_url: string;
  captain_count: number;
  captain_percentage: number;
}

export interface ChipCellInfo {
  gw: number;
  points: number;
}

export interface ChipUsedRow {
  entry_id: number;
  entry_name: string;
  player_name: string;
  wc1: ChipCellInfo | null;
  tc1: ChipCellInfo | null;
  bb1: ChipCellInfo | null;
  fh1: ChipCellInfo | null;
  wc2: ChipCellInfo | null;
  tc2: ChipCellInfo | null;
  bb2: ChipCellInfo | null;
  fh2: ChipCellInfo | null;
}

export interface GwFixtureItem {
  id: number;
  event?: number;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  started?: boolean;
  finished?: boolean;
}

export interface EventDayStatusItem {
  date: string;
  day_name: string; // e.g. "Friday 18 Sep"
  status: 'Not started' | 'Live' | 'Provisional' | 'Confirmed';
  points: string; // "" | "l" | "p" | "r"
  bonus_added: boolean;
}

export interface GwEventStatus {
  event: number;
  status: 'Not started' | 'Live' | 'Provisional' | 'Confirmed';
  days: EventDayStatusItem[];
  leagues_status?: string;
  data_checked?: boolean;
  finished?: boolean;
}

export interface DbPlayerStat {
  id: number;
  webName: string;
  fullName: string;
  teamId: number;
  teamName: string;
  teamShort: string;
  position: PositionType | string;
  nowCost: number; // e.g. 150 = 15.0m
  status: string;
  chanceOfPlayingNextRound?: number | null;
  chanceOfPlayingThisRound?: number | null;
  news?: string;
  photo?: string;
  
  // Performance stats
  totalPoints: number;
  eventPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  bps: number;
  minutes: number;
  starts: number;
  
  // Advanced & Expected stats
  influence: number;
  creativity: number;
  threat: number;
  ictIndex: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalInvolvements: number;
  expectedGoalsConceded: number;
  
  // Form & Ratings
  form: number;
  pointsPerGame: number;
  selectedByPercent: number;
  transfersIn: number;
  transfersOut: number;

  gwHistory?: Array<{
    round: number;
    points: number;
    minutes: number;
    goals: number;
    assists: number;
    bps: number;
    bonus: number;
  }>;
}

export interface DatabaseStatsInfo {
  totalTables: number;
  recordCounts: Record<string, number>;
  lastSynced: string;
  nextSyncWib: string;
  isMatchdayLive: boolean;
  currentGw: number;
  leagueId?: number;
  leagueName?: string;
}

export interface SyncStatus {
  last_synced: string;
  last_checked?: string;
  next_sync_wib: string;
  next_deadline_time?: string;
  is_matchday_live: boolean;
  active_fixtures: string[];
  gw_fixtures?: GwFixtureItem[];
  current_gw: number;
  max_gw: number;
  total_teams: number;
  league_name: string;
  league_id: number;
  db_stats?: DatabaseStatsInfo;
}

export interface TransformedLeagueData {
  league_id: number;
  league_name: string;
  current_gw: number;
  available_gws: number[];
  sync_status: SyncStatus;
  gw_status?: GwEventStatus;
  events_status?: Record<number, GwEventStatus>;
  standings: Record<number, StandingsRow[]>; // key is GW
  gameweek_champions: GWChampionRow[];
  most_gameweek_champions: MostGWChampionLeader[];
  ownership_players: Record<number, PlayerOwnershipItem[]>;
  ownership_clubs: Record<number, ClubOwnershipItem[]>;
  fans_clubs: Record<string, FansClubGroup[]>; // key is "all" or gw number
  template_squads: Record<number, TemplateSquadData>;
  all_transfers: TransferItem[];
  transfers_in: Record<string, MostTransferredItem[]>; // "all" or gw
  transfers_out: Record<string, MostTransferredItem[]>; // "all" or gw
  liga_minus: LigaMinusItem[];
  captain_players: Record<number, CaptainPlayerItem[]>;
  captain_clubs: Record<number, ClubCaptainItem[]>;
  all_chips_used: ChipUsedRow[];
  player_stats?: DbPlayerStat[];
}

export type MainTab = 'STANDINGS' | 'MATCHES' | 'OWNERSHIP' | 'TRANSFER' | 'CAPTAIN' | 'CHIPS';

export type MatchStatMetric = 
  | 'pts'
  | 'st'
  | 'mp'
  | 'gs'
  | 'a'
  | 'xg'
  | 'xa'
  | 'xgi'
  | 'cs'
  | 'gc'
  | 'xgc'
  | 't'
  | 'cbi'
  | 'r'
  | 'dc'
  | 'og'
  | 'ps'
  | 'pm'
  | 'yc'
  | 'rc'
  | 's'
  | 'bp'
  | 'bps'
  | 'inf'
  | 'cre'
  | 'thr'
  | 'ii'
  | 'nt'
  | 'tsb'
  | 'cost'
  | 'points'
  | 'minutes'
  | 'goals_scored'
  | 'assists'
  | 'clean_sheets'
  | 'goals_conceded'
  | 'defensive_contribution'
  | 'saves'
  | 'penalties_saved'
  | 'penalties_missed'
  | 'yellow_cards'
  | 'red_cards'
  | 'own_goals'
  | 'bonus';

export interface MatchPlayerEvent {
  type: 'goal' | 'assist' | 'yellow_card' | 'red_card' | 'own_goal' | 'pen_missed' | 'pen_saved' | 'def_con' | 'bonus' | 'sub';
  count: number;
  bonusRank?: 1 | 2 | 3;
}

export interface MatchPlayerItem {
  id: number;
  code: number;
  web_name: string;
  full_name: string;
  position: PositionType;
  team: number;
  team_short_name: string;
  now_cost: number;
  gw_points: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    saves: number;
    bonus: number;
    bps: number;
    defensive_contribution: number;
    total_points?: number;
    starts?: number;
    expected_goals?: number;
    expected_assists?: number;
    expected_goal_involvements?: number;
    expected_goals_conceded?: number;
    tackles?: number;
    clearances_blocks_interceptions?: number;
    recoveries?: number;
    influence?: number;
    creativity?: number;
    threat?: number;
    ict_index?: number;
    net_transfers?: number;
    teams_selected_by?: number;
    price?: number;
    selected_by_percent?: number;
    transfers_balance?: number;
  };
  events: MatchPlayerEvent[];
}

export interface MatchCardItem {
  id: number;
  event: number;
  kickoff_time: string;
  started: boolean;
  finished: boolean;
  finished_provisional: boolean;
  minutes: number;
  home_team: {
    id: number;
    name: string;
    short_name: string;
    code: number;
    badge_url: string;
  };
  away_team: {
    id: number;
    name: string;
    short_name: string;
    code: number;
    badge_url: string;
  };
  team_h_score: number | null;
  team_a_score: number | null;
  has_lineup: boolean;
  home_lineup: MatchPlayerItem[];
  home_bench: MatchPlayerItem[];
  away_lineup: MatchPlayerItem[];
  away_bench: MatchPlayerItem[];
}

export type StandingsSubTab = 'status' | 'live-table' | 'gw-champions' | 'most-gw-champions' | 'chart' | 'liga-minus';
export type OwnershipSubTab = 'most-owned-players' | 'most-owned-clubs' | 'fans-club' | 'template-squad';
export type TransferSubTab = 'all-transfers' | 'transferred-in' | 'transferred-out';
export type CaptainSubTab = 'most-captained-player' | 'most-captained-club-players';

export interface GwSnapshot {
  gw: number;
  standings: StandingsRow[];
  champion: GWChampionRow | null;
  template_squad: TemplateSquadData | null;
  top_captains: CaptainPlayerItem[];
  captain_clubs: ClubCaptainItem[];
  ownership_players: PlayerOwnershipItem[];
  ownership_clubs: ClubOwnershipItem[];
  transfers_in: MostTransferredItem[];
  transfers_out: MostTransferredItem[];
  transfer_feed: TransferItem[];
}

export interface OptimalPlayerEntry extends DbPlayerStat {
  league_ownership?: {
    count: number;
    percentage: number;
    owners: PlayerOwnerItem[];
  };
}

export interface OptimalManagerEntry {
  entry_id: number;
  entry_name: string;
  player_name: string;
  chips_used: Record<string, { gw: number; points: number }>;
  gw_history: Record<number, {
    gw: number;
    points: number;
    total_points: number;
    rank: number;
    transfers_cost: number;
  }>;
}

export interface OptimalFplDatabaseSchema {
  meta: {
    league_id: number;
    league_name: string;
    current_gw: number;
    available_gws: number[];
    total_teams: number;
    last_synced: string;
    next_sync_wib: string;
    is_live: boolean;
  };
  gw_snapshots: Record<number, GwSnapshot>;
  players: Record<number, OptimalPlayerEntry>;
  managers: Record<number, OptimalManagerEntry>;
  league_analytics: {
    all_chips_used: ChipUsedRow[];
    fans_clubs: Record<string, FansClubGroup[]>;
    liga_minus: LigaMinusItem[];
    most_gameweek_champions: MostGWChampionLeader[];
    all_transfers: TransferItem[];
  };
  table_counts: Record<string, number>;
}

export interface DbStanding {
  gw: number;
  rank: number;
  lastRank: number | null;
  rankChange: number;
  entryId: number;
  entryName: string;
  playerName: string;
  totalPoints: number;
  eventPoints: number;
  eventTransfersCost: number;
  activeChip: string | null;
  captain: any;
  viceCaptain: any;
}

export interface DbGameweekChampion {
  gw: number;
  points: number;
  entryIds: number[];
  champions: GWChampionEntry[];
}

export interface DbOwnershipPlayer {
  gw: number;
  playerId: number;
  ownedCount: number;
  ownedPercentage: number;
  owners: PlayerOwnerItem[];
}

export interface DbOwnershipClub {
  gw: number;
  clubId: number;
  ownedCount: number;
  ownedPercentage: number;
}

export interface DbFansClub {
  gw: number | string;
  clubId: number;
  clubName: string;
  managers: FansClubManager[];
}

export interface DbTemplateSquad {
  gw: number;
  gks: TemplateSquadPlayer[];
  defs: TemplateSquadPlayer[];
  mids: TemplateSquadPlayer[];
  fwds: TemplateSquadPlayer[];
  totalCost: number;
}

export interface DbTransfer {
  gw: number;
  entryId: number;
  elementIn: number;
  elementOut: number;
  time: string;
}

export interface DbLigaMinus {
  entryId: number;
  entryName: string;
  playerName: string;
  totalMinusPoints: number;
  currentRank: number;
}

export interface DbCaptainStat {
  gw: number;
  playerId: number;
  captainCount: number;
  viceCount: number;
}

export interface DbChipUsed {
  entryId: number;
  entryName: string;
  playerName: string;
  chipName: string;
  gw: number;
  points: number;
}

export interface DbSyncMeta {
  lastSynced: string;
  nextSyncWib: string;
  isMatchdayLive: boolean;
  currentGw: number;
  leagueId: number;
  leagueName: string;
  totalTeams: number;
  tableCounts: Record<string, number>;
}

export interface FplDatabaseSchema {
  meta: DbSyncMeta;
  standings: DbStanding[];
  gameweekChampions: DbGameweekChampion[];
  ownershipPlayers: DbOwnershipPlayer[];
  ownershipClubs: DbOwnershipClub[];
  fansClubs: DbFansClub[];
  templateSquads: DbTemplateSquad[];
  transfers: DbTransfer[];
  ligaMinus: DbLigaMinus[];
  captainStats: DbCaptainStat[];
  chipsUsed: DbChipUsed[];
  players: DbPlayerStat[];
}

export type DataClass = 'History' | 'Live' | 'Final';

export interface DataClassContext {
  currentGW: number;
  isFinal: boolean;
}

/**
 * Resolves the Data Class classification for any row or entity deterministically.
 * Rules:
 * 1. Rows without a `gw` property are 'History'
 * 2. Rows with `gw < currentGW` are 'History'
 * 3. Rows with `gw === currentGW` are 'Final' (if isFinal is true) or 'Live' (if isFinal is false)
 */
export function resolveDataClass(
  gw: number | null | undefined,
  context: DataClassContext
): DataClass {
  if (gw === undefined || gw === null) {
    return 'History';
  }
  if (gw < context.currentGW) {
    return 'History';
  }
  if (gw === context.currentGW) {
    return context.isFinal ? 'Final' : 'Live';
  }
  return 'History';
}

