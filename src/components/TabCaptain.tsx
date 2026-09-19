import React, { useState } from 'react';
import { Crown, Shield, ChevronDown, Award } from 'lucide-react';
import { CaptainPlayerItem, ClubCaptainItem } from '../types.ts';

interface TabCaptainProps {
  captains: Record<number, CaptainPlayerItem[]>;
  clubCaptains: Record<number, ClubCaptainItem[]>;
  currentGW: number;
  availableGWs: number[];
  selectedGW: number;
  onSelectGW: (gw: number) => void;
}

type CaptainSubTab = 'most-captained-player' | 'most-captained-club-players';

export const TabCaptain: React.FC<TabCaptainProps> = ({
  captains,
  clubCaptains,
  currentGW,
  availableGWs,
  selectedGW,
  onSelectGW,
}) => {
  const [subTab, setSubTab] = useState<CaptainSubTab>('most-captained-player');

  const playerCaptains = captains[selectedGW] || [];
  const clubCaptainList = clubCaptains[selectedGW] || [];

  return (
    <div className="space-y-2.5">
      {/* Minimalist Sub Tab Navigation - flush to top, no wrap, horizontal scrollable */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5">
        <button
          id="subtab-most-captained-player"
          onClick={() => setSubTab('most-captained-player')}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-captained-player'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          <span>Most Captained Player</span>
        </button>
        <button
          id="subtab-most-captained-club-players"
          onClick={() => setSubTab('most-captained-club-players')}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-captained-club-players'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Shield className="w-3.5 h-3.5 text-[#00ff87]" />
          <span>Most Captained Club Players</span>
        </button>
      </div>

      {/* Direct Filter Row below sub tab */}
      <div className="flex items-center gap-2 py-0.5">
        <div className="relative">
          <select
            id="captain-gw-select"
            value={selectedGW}
            onChange={(e) => onSelectGW(Number(e.target.value))}
            className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
          >
            {availableGWs.map((gw) => (
              <option key={gw} value={gw}>
                GW {gw} {gw === currentGW ? '(Current)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* SUB TAB 1: Most Captained Player */}
      {subTab === 'most-captained-player' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-[#37003c] text-white text-[11px] uppercase tracking-wider font-extrabold">
                <tr>
                  <th className="py-3 px-4 w-16">Rank</th>
                  <th className="py-3 px-4">Player</th>
                  <th className="py-3 px-4">Club</th>
                  <th className="py-3 px-4 text-center">Pos</th>
                  <th className="py-3 px-4 text-right">Cost</th>
                  <th className="py-3 px-4 text-right">Season Pts</th>
                  <th className="py-3 px-4 text-center">Vice Captain (V)</th>
                  <th className="py-3 px-4 text-right">Captain (C) Picks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {playerCaptains.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-purple-50/30 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-bold text-slate-500">{idx + 1}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${p.team_code || 0}-66.webp`}
                          alt={p.team_short_name}
                          className="w-6 h-6 object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <span className="font-black text-slate-900 text-xs sm:text-sm">
                          {p.web_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        {p.team_short_name}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <span className="font-bold text-[10px] bg-slate-100 px-2 py-0.5 rounded">
                        {p.position}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap font-mono">
                      £{((p.now_cost || 0) / 10).toFixed(1)}m
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap font-black text-slate-900">
                      {p.total_points}
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <span className="text-slate-600 font-medium">
                        {p.vice_count} ({p.vice_percentage || 0}%)
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className="font-black text-purple-900 text-xs sm:text-sm">
                          {p.captain_count} <span className="text-slate-400 font-medium text-[11px]">({p.captain_percentage}%)</span>
                        </span>
                        <div className="w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                          <div
                            className="bg-amber-400 h-full rounded-full"
                            style={{ width: `${Math.min(p.captain_percentage, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB TAB 2: Most Captained Club Players */}
      {subTab === 'most-captained-club-players' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 p-4">
            {clubCaptainList.map((club, idx) => (
              <div
                key={club.club_id}
                className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3.5 hover:border-purple-400 transition-colors shadow-2xs"
              >
                {/* Pos */}
                <span className="font-black text-slate-400 text-sm w-5 text-center shrink-0">
                  {idx + 1}
                </span>

                {/* Club Badge */}
                <img
                  src={club.badge_url}
                  alt={club.name}
                  className="w-11 h-11 object-contain shrink-0"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-900 text-sm truncate">
                      {club.name}
                    </h3>
                    <span className="text-xs font-bold text-slate-400 font-mono">
                      {club.short_name}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-1 text-xs">
                    <span className="text-slate-500 font-medium">Captain Armbands:</span>
                    <span className="font-black text-purple-900">
                      {club.captain_count} <span className="text-slate-400 text-[11px]">({club.captain_percentage}%)</span>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1.5">
                    <div
                      className="bg-gradient-to-r from-amber-400 to-amber-600 h-full rounded-full"
                      style={{ width: `${Math.min(club.captain_percentage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
