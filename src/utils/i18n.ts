import { useState, useEffect } from 'react';

export type Language = 'fnb' | 'en' | 'id';

export const LANGUAGE_STORAGE_KEY = 'fnb_setting_language';

export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'id' || saved === 'fnb') {
      return saved;
    }
  } catch {}
  return 'fnb'; // Default is FNB Default
}

export function setSavedLanguage(lang: Language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('fnb:setting-changed', {
          detail: { key: 'language', value: lang },
        })
      );
    }, 0);
  } catch {}
}

export interface Translations {
  // 1. Header & Menu Navigasi Utama
  brand_title: string;
  brand_subtitle: string;
  tooltip_settings: string;
  tab_standings: string;
  tab_matches: string;
  tab_ownership: string;
  tab_transfer: string;
  tab_captain: string;
  tab_chips: string;

  // 2. Tab STANDINGS
  // Subtabs
  subtab_status: string;
  subtab_league_table: string;
  subtab_live_league_table: string;
  subtab_gw_champions: string;
  subtab_most_gw_champions: string;
  subtab_chart: string;
  subtab_liga_minus: string;

  // Status subtab
  deadline_title: string;
  countdown_days: string;
  countdown_hours: string;
  countdown_minutes: string;
  countdown_seconds: string;
  gw_status_label: string;
  status_not_started: string;
  status_live: string;
  status_provisional: string;
  status_confirmed: string;
  highlight_rank_1: string;
  highlight_rank_2: string;
  highlight_most_wins: string;
  highlight_gw_champ: string;
  no_data_available: string;
  points_highest: string;
  points_average: string;
  points_lowest: string;

  // League Table & Live Table
  search_team_manager: string;
  col_rank: string;
  col_team_manager: string;
  col_total_pts: string;
  col_gw_pts: string;
  col_hits: string;
  col_chip: string;
  col_captain_vice: string;

  // GW Champions
  col_gw: string;
  col_pts: string;
  tooltip_sort_gw: string;
  tooltip_sort_pts: string;

  // Most GW Champions
  col_wins: string;
  tooltip_open_team_gw: string;

  // Chart
  chart_last_rank: string;
  chart_gw_rank: string;
  chart_total_pts: string;
  chart_gw_pts: string;
  chart_filter_by_rank: string;
  chart_select_individual: string;
  chart_all: string;
  chart_clear: string;
  chart_all_clear: string;
  chart_search_team: string;
  chart_teams_shown: string;
  chart_done: string;
  chart_reset: string;
  chart_chips: string;
  chart_hits: string;
  chart_captains: string;
  chart_toggle_controls: string;

  // Liga Minus
  minus_empty_1: string;
  minus_empty_2: string;

  // 3. Tab MATCHES
  matches_toggle_all_open: string;
  matches_toggle_all_close: string;
  match_status_upcoming: string;
  match_status_halftime: string;
  match_status_fulltime: string;

  // 4. Tab OWNERSHIP
  subtab_most_owned_player: string;
  subtab_most_owned_by_club: string;
  subtab_fans_club: string;
  subtab_template_squad: string;
  filter_all_clubs: string;
  filter_all_pos: string;
  filter_season: string;
  squad_cost_label: string;
  col_player: string;
  col_club: string;
  col_pos: string;
  col_cost: string;
  col_ownership: string;
  ownership_empty_players: string;
  total_players_owned: string;
  card_fans_club: string;
  fans_club_sub: string;
  fans_club_badge_players: string;
  fans_club_empty: string;

  // 5. Tab TRANSFER
  subtab_all_transfers: string;
  subtab_most_transferred_in: string;
  subtab_most_transferred_out: string;
  filter_all_teams: string;
  search_player_team: string;
  col_player_in: string;
  col_player_out: string;
  col_time_wib: string;
  col_transfers: string;
  transfers_empty: string;

  // 6. Tab CAPTAIN
  subtab_most_captained_player: string;
  subtab_most_captained_by_club: string;
  col_c: string;
  col_vc: string;
  card_captain_armbands: string;

  // 7. Tab CHIPS
  search_manager_team: string;
  tooltip_chip_cell: string;
  tooltip_chip_team: string;

  // 8. MODAL: Settings
  modal_settings_title: string;
  modal_settings_subtitle: string;
  tooltip_close_settings: string;
  settings_profile_label: string;
  settings_profile_badge?: string | null;
  settings_profile_desc?: string | null;
  settings_profile_placeholder: string;
  settings_profile_active: string;
  settings_display_heading: string;
  settings_keep_awake_title: string;
  settings_keep_awake_desc: string;
  settings_keep_awake_active: string;
  settings_keep_awake_unsupported: string;
  settings_news_ticker_title: string;
  settings_news_ticker_desc: string;
  settings_language_heading: string;
  settings_language_desc: string;
  settings_lang_fnb_label: string;
  settings_lang_fnb_sub: string;
  settings_lang_en_label: string;
  settings_lang_en_sub: string;
  settings_lang_id_label: string;
  settings_lang_id_sub: string;
  settings_admin_heading: string;
  settings_admin_title: string;
  settings_admin_badge: string;
  settings_admin_desc?: string | null;
  settings_admin_notice?: string | null;
  settings_footer_brand: string;
  btn_close: string;

  // 9. MODAL: Detail Manajer
  modal_mgr_tab_squad: string;
  modal_mgr_tab_history: string;
  tooltip_close_modal: string;
  modal_mgr_box_points: string;
  modal_mgr_box_hits: string;
  modal_mgr_box_total: string;
  modal_mgr_bench: string;
  modal_mgr_tooltip_breakdown: string;
  modal_mgr_transfers_gw: string;
  modal_mgr_transfer_time: string;
  modal_mgr_transfer_empty: string;
  modal_mgr_col_season: string;
  modal_mgr_col_overall_rank: string;
  modal_mgr_col_total_points: string;

  // 10. MODAL: Detail Pemain
  modal_plyr_tab_overview: string;
  modal_plyr_tab_owners: string;
  modal_plyr_tab_history: string;
  tooltip_close_player_modal: string;
  modal_plyr_match_result: string;
  modal_plyr_match_points: string;
  modal_plyr_did_not_play: string;
  modal_plyr_col_team_manager: string;
  modal_plyr_col_squad_status: string;
  modal_plyr_col_captain: string;
  modal_plyr_col_owners_header: string;
  modal_plyr_col_history_header: string;

  // 11. Footer Aplikasi
  footer_league_name: string;
  footer_league_id: string;
  footer_integration: string;
  footer_fpl_official: string;
  footer_last_updated: string;
}

export const TRANSLATIONS: Record<Language, Translations> = {
  // ================= 1. FNB DEFAULT =================
  fnb: {
    // 1. Header
    brand_title: 'FPL Nusantara BERHADIAH',
    brand_subtitle: '2026/2027',
    tooltip_settings: 'Settings',
    tab_standings: 'STANDINGS',
    tab_matches: 'MATCHES',
    tab_ownership: 'OWNERSHIP',
    tab_transfer: 'TRANSFER',
    tab_captain: 'CAPTAIN',
    tab_chips: 'CHIPS',

    // 2. Standings Subtabs
    subtab_status: 'Status',
    subtab_league_table: 'League Table',
    subtab_live_league_table: 'Live League Table',
    subtab_gw_champions: 'GW Champions',
    subtab_most_gw_champions: 'Most GW Champions',
    subtab_chart: 'Chart',
    subtab_liga_minus: 'Liga Minus',

    // Status Subtab
    deadline_title: 'Gameweek {N} Deadline',
    countdown_days: 'Days',
    countdown_hours: 'Hours',
    countdown_minutes: 'Minutes',
    countdown_seconds: 'Seconds',
    gw_status_label: 'Gameweek {N} Status',
    status_not_started: 'Not Started',
    status_live: 'Live',
    status_provisional: 'Provisional',
    status_confirmed: 'Confirmed',
    highlight_rank_1: 'Peringkat 1',
    highlight_rank_2: 'Peringkat 2',
    highlight_most_wins: 'Juara Terbanyak',
    highlight_gw_champ: 'Juara Gameweek {N}',
    no_data_available: 'Belum ada data',
    points_highest: 'Highest',
    points_average: 'Average',
    points_lowest: 'Lowest',

    // League Table & Live Table
    search_team_manager: 'Search team or manager...',
    col_rank: '#',
    col_team_manager: 'Team & Manager',
    col_total_pts: 'Total Pts',
    col_gw_pts: 'GW Pts',
    col_hits: 'Hits',
    col_chip: 'Chip',
    col_captain_vice: 'Captain & Vice',

    // GW Champions
    col_gw: 'GW',
    col_pts: 'Pts',
    tooltip_sort_gw: 'Sort berdasarkan Gameweek',
    tooltip_sort_pts: 'Sort berdasarkan GW Poin',

    // Most GW Champions
    col_wins: 'Wins',
    tooltip_open_team_gw: 'Buka tim di GW {gw}',

    // Chart
    chart_last_rank: 'Last Rank',
    chart_gw_rank: 'GW Rank',
    chart_total_pts: 'Total Pts',
    chart_gw_pts: 'GW Pts',
    chart_filter_by_rank: 'Filter by Rank',
    chart_select_individual: 'Select Individual Teams',
    chart_all: 'All',
    chart_clear: 'Clear',
    chart_all_clear: 'All • Clear',
    chart_search_team: 'Search team...',
    chart_teams_shown: '{N} teams shown',
    chart_done: 'Done',
    chart_reset: 'Reset',
    chart_chips: 'Chips',
    chart_hits: 'Hits',
    chart_captains: 'Captains',
    chart_toggle_controls: 'Chips • Hits • Captains',

    // Liga Minus
    minus_empty_1: 'No managers have taken transfer hits so far this season!',
    minus_empty_2: 'Check back after the next gameweek deadline.',

    // 3. Tab Matches
    matches_toggle_all_open: 'Buka semua pertandingan',
    matches_toggle_all_close: 'Tutup semua pertandingan',
    match_status_upcoming: 'Upcoming',
    match_status_halftime: 'Half Time',
    match_status_fulltime: 'Full Time',

    // 4. Tab Ownership
    subtab_most_owned_player: 'Most Owned Player',
    subtab_most_owned_by_club: 'Most Owned by Club',
    subtab_fans_club: 'Fans Club',
    subtab_template_squad: 'Template Squad',
    filter_all_clubs: 'All Clubs',
    filter_all_pos: 'All Pos',
    filter_season: 'Season',
    squad_cost_label: 'Squad Cost: £{N}m',
    col_player: 'Player',
    col_club: 'Club',
    col_pos: 'Pos',
    col_cost: 'Cost',
    col_ownership: 'Ownership',
    ownership_empty_players: 'No players match the selected Club / Pos filters.',
    total_players_owned: 'Total Players Owned:',
    card_fans_club: '{Club} Fans Club',
    fans_club_sub: '{N} Managers with 3+ players',
    fans_club_badge_players: '{N} Players',
    fans_club_empty: 'No managers found for this Fans Club criteria.',

    // 5. Tab Transfer
    subtab_all_transfers: 'All Transfers',
    subtab_most_transferred_in: 'Most Transferred In',
    subtab_most_transferred_out: 'Most Transferred Out',
    filter_all_teams: 'All Teams',
    search_player_team: 'Search player or team...',
    col_player_in: 'Player In',
    col_player_out: 'Player Out',
    col_time_wib: 'Time (WIB)',
    col_transfers: 'Transfers',
    transfers_empty: 'No transfers found matching your filters.',

    // 6. Tab Captain
    subtab_most_captained_player: 'Most Captained Player',
    subtab_most_captained_by_club: 'Most Captained by Club',
    col_c: '(C)',
    col_vc: '(VC)',
    card_captain_armbands: 'Captain Armbands:',

    // 7. Tab Chips
    search_manager_team: 'Search manager or team...',
    tooltip_chip_cell: 'Buka tim GW {gw}',
    tooltip_chip_team: 'Buka tim {entry_name} (GW {gw})',

    // 8. Settings Modal
    modal_settings_title: 'Settings',
    modal_settings_subtitle: 'Pengaturan Aplikasi & Preferensi',
    tooltip_close_settings: 'Tutup Pengaturan',
    settings_profile_label: 'Profile',
    settings_profile_badge: 'FNB League ({N} Tim)',
    settings_profile_desc: 'Pilih nama tim dan manajer FNB League Anda. Profil ini akan ditandai secara khusus saat melihat klasemen & transfer.',
    settings_profile_placeholder: 'Pilih Tim & Manajer FNB League...',
    settings_profile_active: 'Profil aktif: {team} ({manager})',
    settings_display_heading: 'Display & Live View',
    settings_keep_awake_title: 'Keep Screen Awake',
    settings_keep_awake_desc: 'Mencegah layar HP/laptop redup atau terkunci saat matchday live',
    settings_keep_awake_active: 'Kuncian layar aktif — Layar akan tetap menyala selama tab ini dibuka.',
    settings_keep_awake_unsupported: 'Browser ini belum mendukung Screen Wake Lock API.',
    settings_news_ticker_title: 'News Ticker',
    settings_news_ticker_desc: 'Tampilkan baris running text berita atau pemberitahuan penting liga',
    settings_language_heading: 'Language',
    settings_language_desc: 'Pilih bahasa pengantar antarmuka sistem',
    settings_lang_fnb_label: 'FNB Default',
    settings_lang_fnb_sub: 'Tampilan Bawaan FNB',
    settings_lang_en_label: 'English',
    settings_lang_en_sub: 'English (UK)',
    settings_lang_id_label: 'Indonesia',
    settings_lang_id_sub: 'Bahasa Indonesia',
    settings_admin_heading: 'Administration',
    settings_admin_title: 'Admin Area',
    settings_admin_badge: 'Restricted',
    settings_admin_desc: 'Akses kontrol sinkronisasi, data liga, dan pengelolaan sistem',
    settings_admin_notice: 'Admin Area akan segera hadir pada tahap pengembangan berikutnya.',
    settings_footer_brand: 'FPL Nusantara 2026/2027',
    btn_close: 'Tutup',

    // 9. Manager Detail Modal
    modal_mgr_tab_squad: 'Gameweek Squad',
    modal_mgr_tab_history: 'Season History',
    tooltip_close_modal: 'Tutup Modal',
    modal_mgr_box_points: 'Points',
    modal_mgr_box_hits: 'Hits',
    modal_mgr_box_total: 'Total Points',
    modal_mgr_bench: 'BENCH',
    modal_mgr_tooltip_breakdown: 'Klik kotak nama / angka poin untuk melihat breakdown poin pemain',
    modal_mgr_transfers_gw: 'Transfers in Gameweek {N}',
    modal_mgr_transfer_time: 'Waktu: {jam}',
    modal_mgr_transfer_empty: 'No Transfer.',
    modal_mgr_col_season: 'Season',
    modal_mgr_col_overall_rank: 'Overall Rank',
    modal_mgr_col_total_points: 'Total Points',

    // 10. Player Detail Modal
    modal_plyr_tab_overview: 'GW Overview',
    modal_plyr_tab_owners: 'Owners ({N})',
    modal_plyr_tab_history: 'History',
    tooltip_close_player_modal: 'Close Modal',
    modal_plyr_match_result: 'Result • Points',
    modal_plyr_match_points: 'Points',
    modal_plyr_did_not_play: 'Did not play in this Gameweek (0 pts).',
    modal_plyr_col_team_manager: 'Team & Manager',
    modal_plyr_col_squad_status: 'Squad Status',
    modal_plyr_col_captain: 'Captain',
    modal_plyr_col_owners_header: 'Team & Manager • Squad Status • Captain',
    modal_plyr_col_history_header: 'GW, Opponent, Result, Pts, ST, MP, GS, A, CS',

    // 11. Footer
    footer_league_name: 'FPL Nusantara BERHADIAH 2026/2027',
    footer_league_id: 'Mini League ID: 12356',
    footer_integration: 'Official Premier League FPL Data Integration',
    footer_fpl_official: 'FPL Official',
    footer_last_updated: 'Last Updated: {datetime} WIB',
  },

  // ================= 2. BAHASA INGGRIS (ENGLISH) =================
  en: {
    // 1. Header
    brand_title: 'FPL Nusantara BERHADIAH',
    brand_subtitle: '2026/2027',
    tooltip_settings: 'Settings',
    tab_standings: 'STANDINGS',
    tab_matches: 'MATCHES',
    tab_ownership: 'OWNERSHIP',
    tab_transfer: 'TRANSFER',
    tab_captain: 'CAPTAIN',
    tab_chips: 'CHIPS',

    // 2. Standings Subtabs
    subtab_status: 'Status',
    subtab_league_table: 'League Table',
    subtab_live_league_table: 'Live League Table',
    subtab_gw_champions: 'GW Champions',
    subtab_most_gw_champions: 'Most GW Champions',
    subtab_chart: 'Chart',
    subtab_liga_minus: 'Minus League',

    // Status Subtab
    deadline_title: 'Gameweek {N} Deadline',
    countdown_days: 'Days',
    countdown_hours: 'Hours',
    countdown_minutes: 'Minutes',
    countdown_seconds: 'Seconds',
    gw_status_label: 'Gameweek {N} Status',
    status_not_started: 'Not Started',
    status_live: 'Live',
    status_provisional: 'Provisional',
    status_confirmed: 'Confirmed',
    highlight_rank_1: '1st Place',
    highlight_rank_2: '2nd Place',
    highlight_most_wins: 'Most GW Champions',
    highlight_gw_champ: 'Gameweek {N} Champion',
    no_data_available: 'No data available',
    points_highest: 'Highest',
    points_average: 'Average',
    points_lowest: 'Lowest',

    // League Table & Live Table
    search_team_manager: 'Search team or manager...',
    col_rank: '#',
    col_team_manager: 'Team & Manager',
    col_total_pts: 'Total Pts',
    col_gw_pts: 'GW Pts',
    col_hits: 'Hits',
    col_chip: 'Chip',
    col_captain_vice: 'Captain & Vice',

    // GW Champions
    col_gw: 'GW',
    col_pts: 'Pts',
    tooltip_sort_gw: 'Sort by Gameweek',
    tooltip_sort_pts: 'Sort by GW Points',

    // Most GW Champions
    col_wins: 'Wins',
    tooltip_open_team_gw: 'Open Team in GW {gw}',

    // Chart
    chart_last_rank: 'Last Rank',
    chart_gw_rank: 'GW Rank',
    chart_total_pts: 'Total Pts',
    chart_gw_pts: 'GW Pts',
    chart_filter_by_rank: 'Filter by Rank',
    chart_select_individual: 'Select Individual Teams',
    chart_all: 'All',
    chart_clear: 'Clear',
    chart_all_clear: 'All • Clear',
    chart_search_team: 'Search Team...',
    chart_teams_shown: '{N} teams shown',
    chart_done: 'Done',
    chart_reset: 'Reset',
    chart_chips: 'Chips',
    chart_hits: 'Hits',
    chart_captains: 'Captains',
    chart_toggle_controls: 'Chips • Hits • Captains',

    // Liga Minus
    minus_empty_1: 'No managers have taken transfer hits so far this season.',
    minus_empty_2: 'Check back after the next gameweek deadline.',

    // 3. Tab Matches
    matches_toggle_all_open: 'Expand all',
    matches_toggle_all_close: 'Collapse all',
    match_status_upcoming: 'Upcoming',
    match_status_halftime: 'Half Time',
    match_status_fulltime: 'Full Time',

    // 4. Tab Ownership
    subtab_most_owned_player: 'Most Owned Player',
    subtab_most_owned_by_club: 'Most Owned by Club',
    subtab_fans_club: 'Fans Club',
    subtab_template_squad: 'Template Squad',
    filter_all_clubs: 'All Clubs',
    filter_all_pos: 'All Pos',
    filter_season: 'Season / GW {N}',
    squad_cost_label: 'Squad Cost: £{N}m',
    col_player: 'Player',
    col_club: 'Club',
    col_pos: 'Pos',
    col_cost: 'Cost',
    col_ownership: 'Ownership',
    ownership_empty_players: 'No players match the selected criteria.',
    total_players_owned: 'Total Players Owned:',
    card_fans_club: '{Club} Fans Club',
    fans_club_sub: '{N} Managers with 3+ players',
    fans_club_badge_players: '{N} Players',
    fans_club_empty: 'No managers found for this Fans Club criteria.',

    // 5. Tab Transfer
    subtab_all_transfers: 'All Transfers',
    subtab_most_transferred_in: 'Most Transferred In',
    subtab_most_transferred_out: 'Most Transferred Out',
    filter_all_teams: 'All Teams',
    search_player_team: 'Search player or team...',
    col_player_in: 'Player In',
    col_player_out: 'Player Out',
    col_time_wib: 'Time (WIB)',
    col_transfers: 'Transfers',
    transfers_empty: 'No transfers found matching your filters.',

    // 6. Tab Captain
    subtab_most_captained_player: 'Most Captained Player',
    subtab_most_captained_by_club: 'Most Captained by Club',
    col_c: '(C)',
    col_vc: '(VC)',
    card_captain_armbands: 'Captain Armbands:',

    // 7. Tab Chips
    search_manager_team: 'Search manager or team...',
    tooltip_chip_cell: 'Open Team in GW {gw}',
    tooltip_chip_team: 'Open Team {entry_name} (GW {gw})',

    // 8. Settings Modal
    modal_settings_title: 'Settings',
    modal_settings_subtitle: 'App Settings & Preferences',
    tooltip_close_settings: 'Close',
    settings_profile_label: 'Profile',
    settings_profile_badge: null, // [Dihapus] per user table
    settings_profile_desc: null, // [Dihapus] per user table
    settings_profile_placeholder: 'Select Team & Manager...',
    settings_profile_active: 'Active profile: {team} ({manager})',
    settings_display_heading: 'Display',
    settings_keep_awake_title: 'Keep Screen Awake',
    settings_keep_awake_desc: 'Prevent screen from dimming or locking during live matchday',
    settings_keep_awake_active: 'Screen lock active — Display will stay awake while this tab is open.',
    settings_keep_awake_unsupported: 'This browser does not support Screen Wake Lock API.',
    settings_news_ticker_title: 'News Ticker',
    settings_news_ticker_desc: 'Display running news ticker and important league updates',
    settings_language_heading: 'Language',
    settings_language_desc: 'Select the display language for the app.',
    settings_lang_fnb_label: 'FNB Default',
    settings_lang_fnb_sub: 'FNB Default View',
    settings_lang_en_label: 'English',
    settings_lang_en_sub: 'English UK',
    settings_lang_id_label: 'Indonesian',
    settings_lang_id_sub: 'Bahasa Indonesia',
    settings_admin_heading: 'Administration',
    settings_admin_title: 'Admin Area',
    settings_admin_badge: 'Restricted',
    settings_admin_desc: null, // [Dihapus] per user table
    settings_admin_notice: null, // [Dihapus] per user table
    settings_footer_brand: 'FPL Nusantara BERHADIAH 2026/2027',
    btn_close: 'Close',

    // 9. Manager Detail Modal
    modal_mgr_tab_squad: 'Gameweek Squad',
    modal_mgr_tab_history: 'Season History',
    tooltip_close_modal: 'Close',
    modal_mgr_box_points: 'Points',
    modal_mgr_box_hits: 'Hits',
    modal_mgr_box_total: 'Total Points',
    modal_mgr_bench: 'BENCH',
    modal_mgr_tooltip_breakdown: 'Click player name or points box to view points breakdown',
    modal_mgr_transfers_gw: 'Gameweek {N} Transfers',
    modal_mgr_transfer_time: 'Time: {time}',
    modal_mgr_transfer_empty: 'No Transfer.',
    modal_mgr_col_season: 'Season',
    modal_mgr_col_overall_rank: 'Overall Rank',
    modal_mgr_col_total_points: 'Total Points',

    // 10. Player Detail Modal
    modal_plyr_tab_overview: 'GW Overview',
    modal_plyr_tab_owners: 'Owners ({N})',
    modal_plyr_tab_history: 'History',
    tooltip_close_player_modal: 'Close',
    modal_plyr_match_result: 'Result • Points',
    modal_plyr_match_points: 'Points',
    modal_plyr_did_not_play: 'Did not play in this Gameweek (0 pts).',
    modal_plyr_col_team_manager: 'Team & Manager',
    modal_plyr_col_squad_status: 'Squad Status',
    modal_plyr_col_captain: 'Captain',
    modal_plyr_col_owners_header: 'Team & Manager • Squad Status • Captain',
    modal_plyr_col_history_header: 'GW, Opponent, Result, Pts, ST, MP, GS, A, CS',

    // 11. Footer
    footer_league_name: 'FPL Nusantara BERHADIAH 2026/2027',
    footer_league_id: 'Mini League ID: 12356',
    footer_integration: 'Official Premier League Data Integration',
    footer_fpl_official: 'FPL Official',
    footer_last_updated: 'Last Updated: {datetime} WIB',
  },

  // ================= 3. BAHASA INDONESIA =================
  id: {
    // 1. Header
    brand_title: 'FPL Nusantara BERHADIAH',
    brand_subtitle: '2026/2027',
    tooltip_settings: 'Pengaturan',
    tab_standings: 'KLASEMEN',
    tab_matches: 'PERTANDINGAN',
    tab_ownership: 'KEPEMILIKAN',
    tab_transfer: 'TRANSFER',
    tab_captain: 'KAPTEN',
    tab_chips: 'CHIPS',

    // 2. Standings Subtabs
    subtab_status: 'Status',
    subtab_league_table: 'Klasemen Liga',
    subtab_live_league_table: 'Klasemen Liga Live',
    subtab_gw_champions: 'Juara Gameweek',
    subtab_most_gw_champions: 'Juara Terbanyak',
    subtab_chart: 'Grafik',
    subtab_liga_minus: 'Liga Minus',

    // Status Subtab
    deadline_title: 'Batas Waktu Gameweek {N}',
    countdown_days: 'Hari',
    countdown_hours: 'Jam',
    countdown_minutes: 'Menit',
    countdown_seconds: 'Detik',
    gw_status_label: 'Status Gameweek {N}',
    status_not_started: 'Belum Dimulai',
    status_live: 'Live',
    status_provisional: 'Sementara',
    status_confirmed: 'Terkonfirmasi',
    highlight_rank_1: 'Peringkat 1',
    highlight_rank_2: 'Peringkat 2',
    highlight_most_wins: 'Juara Terbanyak',
    highlight_gw_champ: 'Juara Gameweek {N}',
    no_data_available: 'Belum ada data',
    points_highest: 'Tertinggi',
    points_average: 'Rata-Rata',
    points_lowest: 'Terendah',

    // League Table & Live Table
    search_team_manager: 'Cari tim atau manajer...',
    col_rank: '#',
    col_team_manager: 'Tim & Manajer',
    col_total_pts: 'Total Poin',
    col_gw_pts: 'Poin GW',
    col_hits: 'Hits',
    col_chip: 'Chip',
    col_captain_vice: 'Kapten & Wakil',

    // GW Champions
    col_gw: 'GW',
    col_pts: 'Poin',
    tooltip_sort_gw: 'Urutkan berdasarkan Gameweek',
    tooltip_sort_pts: 'Urutkan berdasarkan Poin GW',

    // Most GW Champions
    col_wins: 'Juara',
    tooltip_open_team_gw: 'Buka Tim di GW {gw}',

    // Chart
    chart_last_rank: 'Peringkat Akhir',
    chart_gw_rank: 'Peringkat GW',
    chart_total_pts: 'Total Poin',
    chart_gw_pts: 'Poin GW',
    chart_filter_by_rank: 'Filter berdasarkan Peringkat',
    chart_select_individual: 'Pilih Tim Tertentu',
    chart_all: 'Semua',
    chart_clear: 'Kosongkan',
    chart_all_clear: 'Semua • Kosongkan',
    chart_search_team: 'Cari Tim...',
    chart_teams_shown: '{N} tim ditampilkan',
    chart_done: 'Selesai',
    chart_reset: 'Reset',
    chart_chips: 'Chips',
    chart_hits: 'Hits',
    chart_captains: 'Kapten',
    chart_toggle_controls: 'Chips • Hits • Kapten',

    // Liga Minus
    minus_empty_1: 'Belum ada manajer yang mengambil penalti transfer musim ini.',
    minus_empty_2: 'Periksa kembali setelah batas waktu Gameweek berikutnya.',

    // 3. Tab Matches
    matches_toggle_all_open: 'Buka semua',
    matches_toggle_all_close: 'Tutup semua',
    match_status_upcoming: 'Belum Dimulai',
    match_status_halftime: 'Paruh Waktu',
    match_status_fulltime: 'Selesai',

    // 4. Tab Ownership
    subtab_most_owned_player: 'Terbanyak Dimiliki',
    subtab_most_owned_by_club: 'Terbanyak per Klub',
    subtab_fans_club: 'Fans Club',
    subtab_template_squad: 'Tim Template',
    filter_all_clubs: 'Semua Klub',
    filter_all_pos: 'Semua Posisi',
    filter_season: 'Musim / GW {N}',
    squad_cost_label: 'Nilai Skuad: £{N}m',
    col_player: 'Pemain',
    col_club: 'Klub',
    col_pos: 'Posisi',
    col_cost: 'Harga',
    col_ownership: 'Kepemilikan',
    ownership_empty_players: 'Tidak ada pemain yang cocok dengan kriteria yang dipilih.',
    total_players_owned: 'Total Pemain Dimiliki:',
    card_fans_club: 'Fans Club {Club}',
    fans_club_sub: '{N} Manajer dengan 3+ pemain',
    fans_club_badge_players: '{N} Pemain',
    fans_club_empty: 'Tidak ada manajer yang memenuhi kriteria Fans Club ini.',

    // 5. Tab Transfer
    subtab_all_transfers: 'Semua Transfer',
    subtab_most_transferred_in: 'Terbanyak Dibeli',
    subtab_most_transferred_out: 'Terbanyak Dijual',
    filter_all_teams: 'Semua Tim',
    search_player_team: 'Cari pemain atau tim...',
    col_player_in: 'Pemain Masuk',
    col_player_out: 'Pemain Keluar',
    col_time_wib: 'Waktu (WIB)',
    col_transfers: 'Transfer',
    transfers_empty: 'Tidak ada riwayat transfer yang sesuai dengan filter.',

    // 6. Tab Captain
    subtab_most_captained_player: 'Terbanyak Dikaptenkan',
    subtab_most_captained_by_club: 'Terbanyak per Klub',
    col_c: '(C)',
    col_vc: '(VC)',
    card_captain_armbands: 'Dikaptenkan:',

    // 7. Tab Chips
    search_manager_team: 'Cari manajer atau tim...',
    tooltip_chip_cell: 'Buka Tim di GW {gw}',
    tooltip_chip_team: 'Buka Tim {entry_name} (GW {gw})',

    // 8. Settings Modal
    modal_settings_title: 'Pengaturan',
    modal_settings_subtitle: 'Pengaturan Aplikasi & Preferensi',
    tooltip_close_settings: 'Tutup',
    settings_profile_label: 'Profil',
    settings_profile_badge: null, // [Dihapus] per user table
    settings_profile_desc: null, // [Dihapus] per user table
    settings_profile_placeholder: 'Pilih Tim & Manajer...',
    settings_profile_active: 'Profil aktif: {team} ({manager})',
    settings_display_heading: 'Tampilan',
    settings_keep_awake_title: 'Layar Tetap Menyala',
    settings_keep_awake_desc: 'Mencegah layar HP/laptop redup atau terkunci saat matchday live',
    settings_keep_awake_active: 'Kuncian layar aktif — Layar akan tetap menyala selama tab ini dibuka.',
    settings_keep_awake_unsupported: 'Browser ini belum mendukung Screen Wake Lock API.',
    settings_news_ticker_title: 'Berita',
    settings_news_ticker_desc: 'Tampilkan baris running text berita atau pemberitahuan penting liga',
    settings_language_heading: 'Bahasa',
    settings_language_desc: 'Pilih bahasa yang digunakan untuk tampilan aplikasi.',
    settings_lang_fnb_label: 'FNB Default',
    settings_lang_fnb_sub: 'Tampilan Bawaan FNB',
    settings_lang_en_label: 'Inggris',
    settings_lang_en_sub: 'English UK',
    settings_lang_id_label: 'Indonesia',
    settings_lang_id_sub: 'Bahasa Indonesia',
    settings_admin_heading: 'Administrasi',
    settings_admin_title: 'Area Admin',
    settings_admin_badge: 'Terbatas',
    settings_admin_desc: null, // [Dihapus] per user table
    settings_admin_notice: null, // [Dihapus] per user table
    settings_footer_brand: 'FPL Nusantara BERHADIAH 2026/2027',
    btn_close: 'Tutup',

    // 9. Manager Detail Modal
    modal_mgr_tab_squad: 'Susunan Skuad GW',
    modal_mgr_tab_history: 'Riwayat Musim',
    tooltip_close_modal: 'Tutup',
    modal_mgr_box_points: 'Poin',
    modal_mgr_box_hits: 'Hits',
    modal_mgr_box_total: 'Total Poin',
    modal_mgr_bench: 'CADANGAN',
    modal_mgr_tooltip_breakdown: 'Klik kotak nama / angka poin untuk melihat breakdown poin pemain',
    modal_mgr_transfers_gw: 'Transfer pada Gameweek {N}',
    modal_mgr_transfer_time: 'Waktu: {jam}',
    modal_mgr_transfer_empty: 'Tidak Ada Transfer.',
    modal_mgr_col_season: 'Musim',
    modal_mgr_col_overall_rank: 'Peringkat Dunia',
    modal_mgr_col_total_points: 'Total Poin',

    // 10. Player Detail Modal
    modal_plyr_tab_overview: 'Ringkasan GW',
    modal_plyr_tab_owners: 'Pemilik ({N})',
    modal_plyr_tab_history: 'Riwayat',
    tooltip_close_player_modal: 'Tutup',
    modal_plyr_match_result: 'Hasil • Poin',
    modal_plyr_match_points: 'Poin',
    modal_plyr_did_not_play: 'Tidak bermain pada Gameweek ini (0 poin).',
    modal_plyr_col_team_manager: 'Tim & Manajer',
    modal_plyr_col_squad_status: 'Status Skuad',
    modal_plyr_col_captain: 'Kapten',
    modal_plyr_col_owners_header: 'Tim & Manajer • Status Skuad • Kapten',
    modal_plyr_col_history_header: 'GW, Lawan, Hasil, Poin, Starter, Menit, Gol, Assist, CS',

    // 11. Footer
    footer_league_name: 'FPL Nusantara BERHADIAH 2026/2027',
    footer_league_id: 'ID Mini League: 12356',
    footer_integration: 'Integrasi Data Resmi Premier League',
    footer_fpl_official: 'Situs Resmi FPL',
    footer_last_updated: 'Terakhir Diperbarui: {datetime} WIB',
  },
};

/**
 * Hook to read and subscribe to language changes across the app
 */
export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(getSavedLanguage);

  useEffect(() => {
    const handleSettingChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: any }>;
      if (customEvent.detail && customEvent.detail.key === 'language') {
        setLanguageState(customEvent.detail.value);
      }
    };

    window.addEventListener('fnb:setting-changed', handleSettingChange);
    return () => {
      window.removeEventListener('fnb:setting-changed', handleSettingChange);
    };
  }, []);

  const changeLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    setSavedLanguage(newLang);
  };

  const t = (key: keyof Translations, params?: Record<string, string | number>): string => {
    const currentDict = TRANSLATIONS[language] || TRANSLATIONS.fnb;
    let text = (currentDict[key] as string) || (TRANSLATIONS.fnb[key] as string) || '';
    if (params) {
      const p = { ...params };
      if (p.time !== undefined && p.jam === undefined) p.jam = p.time;
      if (p.jam !== undefined && p.time === undefined) p.time = p.jam;
      Object.entries(p).forEach(([paramKey, paramVal]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
      });
    }
    return text;
  };

  return {
    language,
    setLanguage: changeLanguage,
    t,
  };
}

/**
 * Direct translator function
 */
export function t(
  key: keyof Translations,
  lang: Language = getSavedLanguage(),
  params?: Record<string, string | number>
): string {
  const currentDict = TRANSLATIONS[lang] || TRANSLATIONS.fnb;
  let text = (currentDict[key] as string) || (TRANSLATIONS.fnb[key] as string) || '';
  if (params) {
    const p = { ...params };
    if (p.time !== undefined && p.jam === undefined) p.jam = p.time;
    if (p.jam !== undefined && p.time === undefined) p.time = p.jam;
    Object.entries(p).forEach(([paramKey, paramVal]) => {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
    });
  }
  return text;
}

/**
 * Format deadline string based on selected language
 */
export function formatDeadlineByLanguage(
  targetDeadlineMs: number,
  lang: Language
): string {
  const wibDate = new Date(targetDeadlineMs + 7 * 60 * 60 * 1000);
  const wibDateNum = wibDate.getUTCDate();
  const wibYear = wibDate.getUTCFullYear();
  const wibHour = String(wibDate.getUTCHours()).padStart(2, '0');
  const wibMinute = String(wibDate.getUTCMinutes()).padStart(2, '0');

  if (lang === 'en') {
    const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNamesEn = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const day = dayNamesEn[wibDate.getUTCDay()];
    const month = monthNamesEn[wibDate.getUTCMonth()];
    return `${day}, ${wibDateNum} ${month} ${wibYear}, ${wibHour}:${wibMinute} WIB`;
  }

  // Both 'fnb' and 'id' use Indonesian day and month names
  const dayNamesId = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthNamesId = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const day = dayNamesId[wibDate.getUTCDay()];
  const month = monthNamesId[wibDate.getUTCMonth()];

  if (lang === 'fnb') {
    return `${day}, ${wibDateNum} ${month} ${wibYear}, ${wibHour}.${wibMinute} WIB`;
  }

  return `${day}, ${wibDateNum} ${month} ${wibYear}, ${wibHour}:${wibMinute} WIB`;
}

/**
 * Format Kickoff date and time based on selected language
 */
export function formatKickoffByLanguage(
  isoString: string,
  lang: Language
): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    if (lang === 'en') {
      const weekdayStr = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Jakarta' });
      const day = d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Jakarta' });
      const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Asia/Jakarta' });
      const year = d.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'Asia/Jakarta' });
      const hours = d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      });
      return `${weekdayStr}, ${day} ${month} ${year} • ${hours} WIB`;
    }

    // Both 'fnb' and 'id' use Indonesian format
    const weekdayStr = d.toLocaleDateString('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' });
    const day = d.toLocaleDateString('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' });
    const month = d.toLocaleDateString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' });
    const year = d.toLocaleDateString('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' });
    const hours = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta'
    });
    return `${weekdayStr}, ${day} ${month} ${year} • ${hours} WIB`;
  } catch {
    return isoString;
  }
}

/**
 * Format GW date range for TabMatches
 * FNB Default: Sab, 17 Agu - Min, 18 Agu
 * English: Saturday, 17 Aug - Sunday, 18 Aug
 * Indonesia: Sabtu, 17 Agu - Minggu, 18 Agu
 */
export function formatGwDateRangeByLanguage(
  minTime: number,
  maxTime: number,
  lang: Language
): string {
  const d1 = new Date(minTime);
  const d2 = new Date(maxTime);

  const isEn = lang === 'en';
  const isId = lang === 'id';
  const locale = isEn ? 'en-GB' : 'id-ID';
  const weekdayStyle: 'long' | 'short' = (isEn || isId) ? 'long' : 'short';

  const formatPart = (d: Date) => {
    const dayName = d.toLocaleDateString(locale, { weekday: weekdayStyle, timeZone: 'Asia/Jakarta' });
    const dayNum = d.toLocaleDateString(locale, { day: 'numeric', timeZone: 'Asia/Jakarta' });
    const mon = d.toLocaleDateString(locale, { month: 'short', timeZone: 'Asia/Jakarta' });
    return `${dayName}, ${dayNum} ${mon}`;
  };

  const s1 = formatPart(d1);
  const s2 = formatPart(d2);
  return s1 === s2 ? s1 : `${s1} - ${s2}`;
}

/**
 * Indonesian translations for 30 FPL match metrics in TabMatches
 */
export const MATCH_METRIC_LABELS_ID: Record<string, string> = {
  pts: 'Total Poin',
  st: 'Starter',
  mp: 'Menit Bermain',
  gs: 'Gol',
  a: 'Umpan Gol (Assist)',
  xg: 'Peluang Gol (xG)',
  xa: 'Peluang Assist (xA)',
  xgi: 'Kontribusi Gol (xGI)',
  cs: 'Nirbobol (Clean Sheet)',
  gc: 'Kebobolan',
  xgc: 'Peluang Kebobolan (xGC)',
  t: 'Tekel',
  cbi: 'Sapuan, Blok & Intersep (CBI)',
  r: 'Pemulihan Bola (Recoveries)',
  dc: 'Kontribusi Bertahan (DefCon)',
  og: 'Gol Bunuh Diri',
  ps: 'Penalti Ditepis',
  pm: 'Gagal Penalti',
  yc: 'Kartu Kuning',
  rc: 'Kartu Merah',
  s: 'Penyelamatan (Saves)',
  bp: 'Poin Bonus',
  bps: 'Sistem Poin Bonus (BPS)',
  inf: 'Pengaruh (Influence)',
  cre: 'Kreativitas (Creativity)',
  thr: 'Ancaman (Threat)',
  ii: 'Indeks ICT',
  nt: 'Transfer Bersih (FNB League)',
  tsb: 'Dipilih Tim (FNB League)',
  cost: 'Harga Pemain',
};
