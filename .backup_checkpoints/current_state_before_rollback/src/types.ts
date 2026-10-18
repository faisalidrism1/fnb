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
}

export interface PlayerSummaryDetail {
  id: number;
  gw: number;
  player_info?: DbPlayerStat | null;
  history: PlayerHistoryRound[];
  fixtures?: any[];
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
  };
  element_out: {
    id: number;
    name: string;
    club: string;
    position?: PositionType;
    cost: number;
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
  status: 'Not started' | 'Provisional' | 'Confirmed';
  points: string; // "" | "p" | "r"
  bonus_added: boolean;
}

export interface GwEventStatus {
  event: number;
  status: 'Not started' | 'Provisional' | 'Confirmed';
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

export type MainTab = 'STANDINGS' | 'OWNERSHIP' | 'TRANSFER' | 'CAPTAIN' | 'CHIPS';
