import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Shield,
  Crown,
  Zap,
  Users,
  Calendar,
  Award,
  TrendingUp,
  Search,
  ChevronRight,
  ExternalLink,
  Activity,
  AlertCircle
} from 'lucide-react';
import {
  PlayerOwnershipItem,
  PlayerOwnerItem,
  PlayerSummaryDetail,
  PlayerHistoryRound,
  PlayerExplainStatItem
} from '../types.ts';

interface PlayerDetailModalProps {
  playerId: number | null;
  initialGW: number;
  availableGWs: number[];
  onClose: () => void;
  onSelectManager?: (entryId: number, gw?: number) => void;
  ownershipPlayers: Record<number, PlayerOwnershipItem[]>;
}

type ModalTab = 'breakdown' | 'owners' | 'history';

const STAT_IDENTIFIER_LABELS: Record<string, string> = {
  minutes: 'Minutes Played',
  goals_scored: 'Goals Scored',
  assists: 'Assists',
  clean_sheets: 'Clean Sheets',
  goals_conceded: 'Goals Conceded',
  own_goals: 'Own Goals',
  penalties_saved: 'Penalties Saved',
  penalties_missed: 'Penalties Missed',
  yellow_cards: 'Yellow Cards',
  red_cards: 'Red Cards',
  saves: 'Saves',
  bonus: 'Bonus Points',
  defensive_contribution: 'Defensive Contribution (DefCon)'
};

export const PlayerDetailModal: React.FC<PlayerDetailModalProps> = ({
  playerId,
  initialGW,
  availableGWs,
  onClose,
  onSelectManager,
  ownershipPlayers
}) => {
  const [activeGW, setActiveGW] = useState<number>(initialGW);
  const [activeTab, setActiveTab] = useState<ModalTab>('breakdown');
  const [ownerSearch, setOwnerSearch] = useState<string>('');
  const [loadingSummary, setLoadingSummary] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<PlayerSummaryDetail | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Sync initialGW if changed from props
  useEffect(() => {
    setActiveGW(initialGW);
  }, [initialGW]);

  // Find player metadata in ownershipPlayers across GWs
  const playerMeta = useMemo(() => {
    if (!playerId) return null;
    // Look first in activeGW, then fall back to any available GW
    const currentList = ownershipPlayers[activeGW] || [];
    let found = currentList.find((p) => p.id === playerId);
    if (!found) {
      for (const gw of availableGWs) {
        const list = ownershipPlayers[gw] || [];
        found = list.find((p) => p.id === playerId);
        if (found) break;
      }
    }
    return found || null;
  }, [playerId, activeGW, ownershipPlayers, availableGWs]);

  // Fetch player official history & live stats when playerId or activeGW changes
  useEffect(() => {
    if (!playerId) return;
    let isCancelled = false;
    setLoadingSummary(true);
    setFetchError(null);

    fetch(`/api/fpl-player-summary/${playerId}?gw=${activeGW}`)
      .then((res) => {
        if (!res.ok) throw new Error('Gagal mengambil data statistik FPL');
        return res.json();
      })
      .then((json) => {
        if (!isCancelled && json.success) {
          setSummaryData(json.data);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn('Player summary fetch error:', err);
          setFetchError(err.message || 'Gagal memuat statistik FPL');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoadingSummary(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [playerId, activeGW]);

  // Owners in activeGW
  const currentGWPlayer = playerId
    ? (ownershipPlayers[activeGW] || []).find((p) => p.id === playerId)
    : undefined;
  const owners: PlayerOwnerItem[] = useMemo(() => {
    return currentGWPlayer?.owners || playerMeta?.owners || [];
  }, [currentGWPlayer, playerMeta]);

  const filteredOwners = useMemo(() => {
    if (!ownerSearch.trim()) return owners;
    const q = ownerSearch.toLowerCase();
    return owners.filter(
      (o) =>
        o.entry_name.toLowerCase().includes(q) ||
        o.player_name.toLowerCase().includes(q)
    );
  }, [owners, ownerSearch]);

  if (!playerId) return null;

  // Selected GW Round stats from history
  const roundHistory = summaryData?.history?.find((h) => h.round === activeGW);

  // Live stats or fallback to round history
  const liveStats = summaryData?.live_stats;
  const explainList: PlayerExplainStatItem[] = summaryData?.live_explain?.[0]?.stats || [];

  // Effective GW stats
  const minutesPlayed = liveStats?.minutes ?? roundHistory?.minutes ?? 0;
  const goalsScored = liveStats?.goals_scored ?? roundHistory?.goals_scored ?? 0;
  const assists = liveStats?.assists ?? roundHistory?.assists ?? 0;
  const cleanSheets = liveStats?.clean_sheets ?? roundHistory?.clean_sheets ?? 0;
  const defCon = liveStats?.defensive_contribution ?? roundHistory?.defensive_contribution ?? 0;
  const goalsConceded = liveStats?.goals_conceded ?? roundHistory?.goals_conceded ?? 0;
  const yellowCards = liveStats?.yellow_cards ?? roundHistory?.yellow_cards ?? 0;
  const redCards = liveStats?.red_cards ?? roundHistory?.red_cards ?? 0;
  const saves = liveStats?.saves ?? roundHistory?.saves ?? 0;
  const penaltiesSaved = liveStats?.penalties_saved ?? roundHistory?.penalties_saved ?? 0;
  const penaltiesMissed = liveStats?.penalties_missed ?? roundHistory?.penalties_missed ?? 0;
  const ownGoals = liveStats?.own_goals ?? roundHistory?.own_goals ?? 0;
  const bonus = liveStats?.bonus ?? roundHistory?.bonus ?? 0;
  const bps = liveStats?.bps ?? roundHistory?.bps ?? 0;

  // Effective GW Points: prefer liveStats, then roundHistory, then playerMeta.gw_points
  const effectiveGWPoints =
    liveStats?.total_points ?? roundHistory?.total_points ?? playerMeta?.gw_points ?? 0;

  const shirtUrl = playerMeta?.team_code
    ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${playerMeta.team_code}-66.webp`
    : 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-66.webp';

  const positionBg =
    playerMeta?.position === 'GKP'
      ? 'bg-amber-400 text-amber-950'
      : playerMeta?.position === 'DEF'
      ? 'bg-emerald-500 text-white'
      : playerMeta?.position === 'MID'
      ? 'bg-sky-500 text-white'
      : 'bg-purple-600 text-white';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in duration-200">
        {/* Header */}
        <div className="bg-[#37003c] text-white p-3.5 sm:p-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            {/* Player basic info */}
            <div className="flex items-center gap-3">
              <div className="relative w-11 h-13 sm:w-13 sm:h-15 flex items-center justify-center bg-white/10 rounded-xl p-1 shrink-0 border border-white/15 shadow-inner">
                <img
                  src={shirtUrl}
                  alt={playerMeta?.team_short_name || 'Jersey'}
                  className="w-full h-full object-contain filter drop-shadow"
                  onError={(e) => {
                    e.currentTarget.src =
                      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-66.webp';
                  }}
                />
              </div>

              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded leading-none ${positionBg}`}
                  >
                    {playerMeta?.position || 'PL'}
                  </span>
                  <span className="bg-white/20 text-[#00ff87] text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded leading-none">
                    {playerMeta?.team_short_name || ''}
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-purple-200 font-semibold">
                    £{playerMeta ? (playerMeta.now_cost / 10).toFixed(1) : '-'}m
                  </span>
                </div>

                <h3 className="font-black text-base sm:text-lg text-white leading-tight mt-0.5">
                  {playerMeta?.web_name || 'Player Details'}
                </h3>
                <p className="text-[11px] text-purple-200/90 truncate max-w-[240px] sm:max-w-sm">
                  {playerMeta?.full_name || playerMeta?.team_name || ''}
                </p>
              </div>
            </div>

            {/* GW Switcher and Close Button */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-black/40 rounded-lg p-1 border border-white/10">
                <span className="text-[10px] text-purple-300 font-bold px-1 hidden sm:inline">
                  GW:
                </span>
                <select
                  value={activeGW}
                  onChange={(e) => setActiveGW(Number(e.target.value))}
                  className="bg-[#24002b] text-[#00ff87] text-xs font-black px-2 py-1 rounded border border-purple-500/40 focus:outline-none focus:ring-1 focus:ring-[#00ff87] cursor-pointer"
                >
                  {availableGWs.map((gw) => (
                    <option key={gw} value={gw}>
                      GW {gw} {gw === initialGW ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-purple-800/60 text-center">
            <div className="bg-black/25 rounded-lg py-1 px-2 border border-white/5">
              <span className="text-[9.5px] text-purple-200/80 font-bold uppercase block leading-none">
                GW {activeGW} Pts
              </span>
              <span className="text-base sm:text-lg font-black text-[#00ff87] block mt-0.5 leading-none">
                {effectiveGWPoints} pts
              </span>
            </div>
            <div className="bg-black/25 rounded-lg py-1 px-2 border border-white/5">
              <span className="text-[9.5px] text-purple-200/80 font-bold uppercase block leading-none">
                Total Pts
              </span>
              <span className="text-base sm:text-lg font-black text-white block mt-0.5 leading-none">
                {playerMeta?.total_points ?? '-'} pts
              </span>
            </div>
            <div className="bg-black/25 rounded-lg py-1 px-2 border border-white/5">
              <span className="text-[9.5px] text-purple-200/80 font-bold uppercase block leading-none">
                League Ownership
              </span>
              <span className="text-base sm:text-lg font-black text-amber-300 block mt-0.5 leading-none">
                {currentGWPlayer?.owned_percentage ?? playerMeta?.owned_percentage ?? 0}%
              </span>
            </div>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-3 shrink-0">
          <button
            onClick={() => setActiveTab('breakdown')}
            className={`py-2 px-3 sm:px-4 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'breakdown'
                ? 'border-purple-800 text-purple-900 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>GW {activeGW} Breakdown</span>
          </button>

          <button
            onClick={() => setActiveTab('owners')}
            className={`py-2 px-3 sm:px-4 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'owners'
                ? 'border-purple-800 text-purple-900 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              League Owners ({owners.length})
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-3 sm:px-4 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'border-purple-800 text-purple-900 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Gameweek History</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-slate-700 grow">
          {/* TAB 1: BREAKDOWN POIN GW */}
          {activeTab === 'breakdown' && (
            <div className="space-y-4">
              {/* Fixture & Outcome Banner */}
              {roundHistory && (
                <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-extrabold text-[#37003c]">
                      GW {activeGW} Fixture:
                    </span>
                    <span className="bg-[#37003c] text-white px-2 py-0.5 rounded font-black text-[11px]">
                      vs {roundHistory.opponent_short_name || `Team ${roundHistory.opponent_team}`}{' '}
                      ({roundHistory.was_home ? 'H' : 'A'})
                    </span>
                    <span className="text-slate-600 font-bold">
                      Score: {roundHistory.team_h_score} - {roundHistory.team_a_score}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-extrabold text-purple-900">
                      {minutesPlayed > 0 ? `${minutesPlayed} Mins` : 'Did Not Play'}
                    </span>
                  </div>
                </div>
              )}

              {/* Key Statistics Grid */}
              <div className="space-y-1.5">
                <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-purple-800" />
                  <span>GW {activeGW} Key Statistics</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Minutes Played
                    </span>
                    <span className="text-lg font-black text-slate-900 block mt-0.5">
                      {minutesPlayed}'
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Goals Scored
                    </span>
                    <span className="text-lg font-black text-emerald-600 block mt-0.5">
                      {goalsScored}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Assists
                    </span>
                    <span className="text-lg font-black text-sky-600 block mt-0.5">
                      {assists}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Clean Sheets
                    </span>
                    <span className="text-lg font-black text-purple-700 block mt-0.5">
                      {cleanSheets}
                    </span>
                  </div>

                  <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-purple-700 font-bold uppercase block">
                      DefCon
                    </span>
                    <span className="text-lg font-black text-[#37003c] block mt-0.5">
                      {defCon}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Goals Conceded
                    </span>
                    <span className="text-lg font-black text-slate-700 block mt-0.5">
                      {goalsConceded}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Saves
                    </span>
                    <span className="text-lg font-black text-slate-700 block mt-0.5">
                      {saves}
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">
                      Bonus & BPS
                    </span>
                    <span className="text-lg font-black text-amber-600 block mt-0.5">
                      {bonus} <span className="text-xs text-slate-400 font-bold">({bps} BPS)</span>
                    </span>
                  </div>
                </div>

                {/* Secondary stats (Cards, penalties, own goals) if applicable */}
                {(yellowCards > 0 || redCards > 0 || penaltiesSaved > 0 || penaltiesMissed > 0 || ownGoals > 0) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {yellowCards > 0 && (
                      <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                        🟨 {yellowCards} {yellowCards > 1 ? 'Yellow Cards' : 'Yellow Card'} (-{yellowCards} pt)
                      </span>
                    )}
                    {redCards > 0 && (
                      <span className="bg-rose-100 text-rose-900 border border-rose-300 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                        🟥 {redCards} {redCards > 1 ? 'Red Cards' : 'Red Card'} (-{redCards * 3} pts)
                      </span>
                    )}
                    {penaltiesSaved > 0 && (
                      <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                        🧤 {penaltiesSaved} {penaltiesSaved > 1 ? 'Penalties Saved' : 'Penalty Saved'} (+{penaltiesSaved * 5} pts)
                      </span>
                    )}
                    {penaltiesMissed > 0 && (
                      <span className="bg-rose-100 text-rose-900 border border-rose-300 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                        ❌ {penaltiesMissed} {penaltiesMissed > 1 ? 'Penalties Missed' : 'Penalty Missed'} (-{penaltiesMissed * 2} pts)
                      </span>
                    )}
                    {ownGoals > 0 && (
                      <span className="bg-rose-100 text-rose-900 border border-rose-300 text-[10.5px] font-bold px-2 py-0.5 rounded-md">
                        ⚽ {ownGoals} {ownGoals > 1 ? 'Own Goals' : 'Own Goal'} (-{ownGoals * 2} pts)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Official Points Breakdown (Explain) */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-extrabold text-slate-900 text-xs">
                    FPL Points Breakdown
                  </span>
                  <span className="text-[11px] font-black text-purple-900 bg-purple-100 px-2 py-0.5 rounded">
                    Total: {effectiveGWPoints} pts
                  </span>
                </div>

                {explainList.length > 0 ? (
                  <div className="divide-y divide-slate-100 text-xs">
                    {explainList.map((stat, idx) => {
                      const label = STAT_IDENTIFIER_LABELS[stat.identifier] || stat.identifier;
                      return (
                        <div
                          key={idx}
                          className="px-3.5 py-2 flex items-center justify-between hover:bg-slate-50/80"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-800 font-semibold">{label}</span>
                            <span className="text-[10.5px] text-slate-400 font-medium">
                              (value: {stat.value})
                            </span>
                          </div>
                          <span
                            className={`font-black text-xs ${
                              stat.points > 0
                                ? 'text-emerald-600'
                                : stat.points < 0
                                ? 'text-rose-600'
                                : 'text-slate-500'
                            }`}
                          >
                            {stat.points > 0 ? `+${stat.points}` : stat.points} pts
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-slate-500">
                    {minutesPlayed === 0 ? (
                      <p className="text-slate-400 italic">
                        Player did not play in Gameweek {activeGW} (0 pts).
                      </p>
                    ) : (
                      <p className="text-slate-400">
                        Total {effectiveGWPoints} pts recorded for Gameweek {activeGW}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DAFTAR PEMILIK DI LIGA */}
          {activeTab === 'owners' && (
            <div className="space-y-3">
              {/* Summary and Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="text-xs text-slate-600 font-medium">
                  Owned by <strong className="text-purple-950 font-black">{owners.length}</strong>{' '}
                  {owners.length === 1 ? 'manager' : 'managers'} in GW {activeGW} (
                  {currentGWPlayer?.owned_percentage ?? playerMeta?.owned_percentage ?? 0}%)
                </div>

                {owners.length > 5 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search team or manager..."
                      value={ownerSearch}
                      onChange={(e) => setOwnerSearch(e.target.value)}
                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-600 w-full sm:w-56"
                    />
                  </div>
                )}
              </div>

              {/* Owners List Table */}
              {filteredOwners.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-600 text-[10px] font-extrabold sticky top-0 z-10">
                        <tr>
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Team & Manager</th>
                          <th className="py-2 px-3 text-center">Squad Status</th>
                          <th className="py-2 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredOwners.map((owner, idx) => (
                          <tr
                            key={owner.entry_id}
                            className="hover:bg-purple-50/50 transition-colors"
                          >
                            <td className="py-2 px-3 text-slate-400 font-bold text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-black text-slate-900 leading-tight">
                                {owner.entry_name}
                              </div>
                              <div className="text-[10.5px] text-slate-500">
                                {owner.player_name}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                {owner.is_captain && (
                                  <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-900 border border-amber-300 font-black text-[9.5px] px-1.5 py-0.2 rounded">
                                    <Crown className="w-3 h-3 text-amber-600" />
                                    <span>C ({owner.multiplier}x)</span>
                                  </span>
                                )}
                                {owner.is_vice_captain && (
                                  <span className="inline-flex items-center gap-0.5 bg-slate-100 text-slate-700 border border-slate-300 font-black text-[9.5px] px-1.5 py-0.2 rounded">
                                    <Shield className="w-3 h-3 text-slate-500" />
                                    <span>V</span>
                                  </span>
                                )}
                                {owner.is_starter ? (
                                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[9.5px] px-1.5 py-0.2 rounded">
                                    Starter (XI)
                                  </span>
                                ) : (
                                  <span className="bg-slate-100 text-slate-500 font-medium text-[9.5px] px-1.5 py-0.2 rounded">
                                    Bench ({owner.position_in_squad})
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {onSelectManager && (
                                <button
                                  onClick={() => onSelectManager(owner.entry_id, activeGW)}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 hover:text-purple-950 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-md transition-colors cursor-pointer"
                                  title="View manager profile"
                                >
                                  <span>View Team</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
                  <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-bold text-slate-700">
                    No managers found
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {ownerSearch
                      ? `No results matching "${ownerSearch}"`
                      : `No managers in the league own this player in GW ${activeGW}`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: HISTORI GW BY GW */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 font-medium">
                Gameweek-by-gameweek performance history for 2026/2027 season:
              </div>

              {summaryData?.history && summaryData.history.length > 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-600 text-[10px] font-extrabold sticky top-0">
                        <tr>
                          <th className="py-2 px-2.5">GW</th>
                          <th className="py-2 px-2.5">Opponent</th>
                          <th className="py-2 px-2.5 text-center">Score</th>
                          <th className="py-2 px-2 text-right">Mins</th>
                          <th className="py-2 px-2.5 text-right font-black text-purple-900 bg-purple-50/50">
                            GW Pts
                          </th>
                          <th className="py-2 px-2 text-center">G</th>
                          <th className="py-2 px-2 text-center">A</th>
                          <th className="py-2 px-2 text-center">CS</th>
                          <th className="py-2 px-2 text-center">DefCon</th>
                          <th className="py-2 px-2 text-center">Bonus</th>
                          <th className="py-2 px-2 text-center">BPS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {summaryData.history.map((h) => {
                          const isCurrent = h.round === activeGW;
                          return (
                            <tr
                              key={h.round}
                              onClick={() => setActiveGW(h.round)}
                              className={`transition-colors cursor-pointer ${
                                isCurrent
                                  ? 'bg-purple-100/70 font-bold border-l-4 border-l-purple-800'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2 px-2.5 font-black text-slate-900 whitespace-nowrap">
                                GW {h.round}
                                {isCurrent && (
                                  <span className="ml-1 text-[9px] bg-[#37003c] text-[#00ff87] px-1 py-0.2 rounded">
                                    Current
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2.5 whitespace-nowrap">
                                <span className="font-black text-slate-900">
                                  {h.opponent_short_name || `Team ${h.opponent_team}`}
                                </span>{' '}
                                <span className="text-[10px] text-slate-500 font-semibold">
                                  ({h.was_home ? 'H' : 'A'})
                                </span>
                              </td>
                              <td className="py-2 px-2.5 text-center text-slate-600 whitespace-nowrap">
                                {h.team_h_score} - {h.team_a_score}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {h.minutes}'
                              </td>
                              <td className="py-2 px-2.5 text-right font-black text-purple-950 bg-purple-50/60">
                                {h.total_points}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-emerald-600">
                                {h.goals_scored || '-'}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-sky-600">
                                {h.assists || '-'}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-purple-700">
                                {h.clean_sheets || '-'}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-slate-800">
                                {h.defensive_contribution || '-'}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-amber-600">
                                {h.bonus || '-'}
                              </td>
                              <td className="py-2 px-2 text-center text-slate-500 text-[11px]">
                                {h.bps}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-xs text-slate-500">
                  {loadingSummary ? 'Loading performance history...' : 'No history available.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-400">
            Source: Official Premier League FPL API
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
