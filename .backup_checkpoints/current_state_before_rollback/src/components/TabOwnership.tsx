import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Users, Shield, Award, Sparkles, Shirt } from 'lucide-react';
import {
  PlayerOwnershipItem,
  ClubOwnershipItem,
  FansClubGroup,
  TemplateSquadData,
  TemplateSquadPlayer,
} from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';

interface TabOwnershipProps {
  ownershipPlayers: Record<number, PlayerOwnershipItem[]>;
  ownershipClubs: Record<number, ClubOwnershipItem[]>;
  fansClubs: Record<string, FansClubGroup[]>;
  templateSquads: Record<number, TemplateSquadData>;
  currentGW: number;
  availableGWs: number[];
  selectedGW?: number;
  onSelectGW?: (gw: number) => void;
  onSelectManager: (entryId: number, gw?: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
}

type OwnershipSubTab = 'most-owned-players' | 'most-owned-clubs' | 'fans-club' | 'template-squad';

export const TabOwnership: React.FC<TabOwnershipProps> = ({
  ownershipPlayers,
  ownershipClubs,
  fansClubs,
  templateSquads,
  currentGW,
  availableGWs,
  selectedGW: propSelectedGW,
  onSelectGW,
  onSelectManager,
  onSelectPlayer,
}) => {
  const [subTab, setSubTab] = useState<OwnershipSubTab>('most-owned-players');
  const subTabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!subTabsRef.current) return;
    const activeBtn = subTabsRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(subTabsRef.current, activeBtn);
    }
  }, [subTab]);
  // Fans Club default filter must be "All GW" per prompt specification!
  const [fansClubFilter, setFansClubFilter] = useState<string>('all');
  // Most Owned Player filters
  const [selectedClub, setSelectedClub] = useState<string>('all');
  const [selectedPos, setSelectedPos] = useState<string>('all');
  // Most Owned Player by Club filters
  const [selectedClubPos, setSelectedClubPos] = useState<string>('all');

  // Internal independent GW filter to preserve user choice during session
  const [internalGW, setInternalGW] = useState<number>(() => {
    if (propSelectedGW !== undefined) return propSelectedGW;
    return availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW;
  });

  const activeGW = propSelectedGW !== undefined ? propSelectedGW : internalGW;
  const selectedGW = availableGWs.includes(activeGW)
    ? activeGW
    : (availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW);

  const handleSelectGW = (gw: number) => {
    setInternalGW(gw);
    onSelectGW?.(gw);
  };

  const players = ownershipPlayers[selectedGW] || [];
  const clubs = ownershipClubs[selectedGW] || [];
  const currentFansClubs = fansClubs[fansClubFilter] || [];
  const latestGW = availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW;
  const templateSquad = templateSquads[selectedGW] || templateSquads[latestGW] || Object.values(templateSquads)[0];

  const handlePlayerClick = (pId: number) => {
    if (onSelectPlayer) {
      onSelectPlayer(pId, selectedGW);
    }
  };

  const handlePlayerClickByName = (pName: string) => {
    let found = players.find(
      (p) =>
        p.web_name.toLowerCase() === pName.toLowerCase() ||
        p.full_name.toLowerCase().includes(pName.toLowerCase())
    );
    if (!found) {
      for (const gw of availableGWs) {
        const list = ownershipPlayers[gw] || [];
        found = list.find(
          (p) =>
            p.web_name.toLowerCase() === pName.toLowerCase() ||
            p.full_name.toLowerCase().includes(pName.toLowerCase())
        );
        if (found) break;
      }
    }
    if (found) {
      handlePlayerClick(found.id);
    }
  };

  // Available clubs derived across all GW ownership data (sorted alphabetically)
  const availableClubs = React.useMemo(() => {
    const clubSet = new Set<string>();
    (Object.values(ownershipPlayers) as PlayerOwnershipItem[][]).forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((p) => {
          if (p.team_short_name) clubSet.add(p.team_short_name);
        });
      }
    });
    return Array.from(clubSet).sort();
  }, [ownershipPlayers]);

  // Filtered players based on Club and Position
  const filteredPlayers = React.useMemo(() => {
    return players.filter((player) => {
      if (selectedClub !== 'all' && player.team_short_name !== selectedClub) {
        return false;
      }
      if (selectedPos !== 'all' && player.position !== selectedPos) {
        return false;
      }
      return true;
    });
  }, [players, selectedClub, selectedPos]);

  // Filtered clubs for Most Owned Player by Club based on Position
  const filteredClubs = React.useMemo(() => {
    if (selectedClubPos === 'all') {
      return clubs;
    }
    // Calculate ownership counts filtered by position
    const countsByClub = new Map<string, number>();
    players.forEach((p) => {
      if (p.position === selectedClubPos) {
        countsByClub.set(p.team_short_name, (countsByClub.get(p.team_short_name) || 0) + p.owned_count);
      }
    });

    return clubs
      .map((c) => {
        const count = countsByClub.get(c.short_name) || 0;
        // Total teams in league can be inferred or kept proportional
        // Using original ratio: count / (clubs[0].owned_count / clubs[0].owned_percentage)
        const totalEntries = clubs.length > 0 && clubs[0].owned_percentage > 0
          ? (clubs[0].owned_count / (clubs[0].owned_percentage / 100)) / 3
          : 97;
        const pct = totalEntries > 0 ? Number(((count / totalEntries / 3) * 100).toFixed(1)) : 0;
        return {
          ...c,
          owned_count: count,
          owned_percentage: pct,
        };
      })
      .sort((a, b) => b.owned_count - a.owned_count);
  }, [clubs, players, selectedClubPos]);

  return (
    <div className="space-y-2.5">
      {/* Minimalist Sub Tab Navigation - flush to top, no wrap, horizontal scrollable */}
      <div
        ref={subTabsRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 border-b border-slate-200/80 pb-1.5 scroll-smooth"
      >
        <button
          id="subtab-most-owned-players"
          data-active={subTab === 'most-owned-players' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('most-owned-players');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-owned-players'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Most Owned Player</span>
        </button>
        <button
          id="subtab-most-owned-clubs"
          data-active={subTab === 'most-owned-clubs' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('most-owned-clubs');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'most-owned-clubs'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Most Owned Player by Club</span>
        </button>
        <button
          id="subtab-fans-club"
          data-active={subTab === 'fans-club' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('fans-club');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'fans-club'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Award className="w-3.5 h-3.5 text-amber-500" />
          <span>Fans Club</span>
        </button>
        <button
          id="subtab-template-squad"
          data-active={subTab === 'template-squad' ? 'true' : 'false'}
          onClick={(e) => {
            setSubTab('template-squad');
            scrollTabIntoView(subTabsRef.current, e.currentTarget);
          }}
          className={`px-3 py-1 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            subTab === 'template-squad'
              ? 'bg-[#37003c] text-[#00ff87] shadow-2xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
          }`}
        >
          <Shirt className="w-3.5 h-3.5 text-emerald-500" />
          <span>Template Squad</span>
        </button>
      </div>

      {/* Direct Filter Row below sub tab */}
      <div className="flex items-center justify-between gap-2 py-0.5">
        {subTab !== 'fans-club' ? (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Gameweek Filter */}
            <div className="relative">
              <select
                id="ownership-gw-select"
                value={selectedGW}
                onChange={(e) => handleSelectGW(Number(e.target.value))}
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

            {/* Filter Club & Pos di sebelah kanan filter GW untuk Most Owned Player */}
            {subTab === 'most-owned-players' && (
              <>
                <div className="relative">
                  <select
                    id="ownership-club-select"
                    value={selectedClub}
                    onChange={(e) => setSelectedClub(e.target.value)}
                    className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
                  >
                    <option value="all">All Club</option>
                    {availableClubs.map((club) => (
                      <option key={club} value={club}>
                        {club}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                <div className="relative">
                  <select
                    id="ownership-pos-select"
                    value={selectedPos}
                    onChange={(e) => setSelectedPos(e.target.value)}
                    className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
                  >
                    <option value="all">All Pos</option>
                    <option value="GKP">GKP</option>
                    <option value="DEF">DEF</option>
                    <option value="MID">MID</option>
                    <option value="FWD">FWD</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </>
            )}

            {/* Filter Pos di sebelah kanan filter GW untuk Most Owned Player by Club */}
            {subTab === 'most-owned-clubs' && (
              <div className="relative">
                <select
                  id="club-ownership-pos-select"
                  value={selectedClubPos}
                  onChange={(e) => setSelectedClubPos(e.target.value)}
                  className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
                >
                  <option value="all">All Pos</option>
                  <option value="GKP">GKP</option>
                  <option value="DEF">DEF</option>
                  <option value="MID">MID</option>
                  <option value="FWD">FWD</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                id="fans-club-gw-select"
                value={fansClubFilter}
                onChange={(e) => setFansClubFilter(e.target.value)}
                className="appearance-none bg-white border border-slate-300 hover:border-purple-600 rounded-lg text-xs font-bold text-slate-800 py-1.5 pl-2.5 pr-7 shadow-2xs focus:outline-none focus:ring-1 focus:ring-[#37003c]"
              >
                <option value="all">Season</option>
                {availableGWs.map((gw) => (
                  <option key={gw} value={String(gw)}>
                    GW {gw} {gw === currentGW ? '(Current)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        )}

        {subTab === 'template-squad' && templateSquad && (
          <div className="flex items-center gap-1.5 bg-[#37003c] text-white px-3 py-1 rounded-lg text-xs font-bold shadow-2xs">
            <span className="text-[#00ff87]">Squad Cost:</span>
            <span>£{(templateSquad.total_cost / 10).toFixed(1)}m</span>
          </div>
        )}
      </div>

      {/* SUB TAB 1: Most Owned Player */}
      {subTab === 'most-owned-players' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden w-fit min-w-full sm:min-w-0 max-w-full">
          <div className="overflow-x-auto">
            <table className="text-left text-xs text-slate-700 w-auto border-separate border-spacing-0">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  {/* Frozen Rank/Index Column as # */}
                  <th className="sticky left-0 z-20 bg-[#37003c] py-2 px-1 text-center w-10 min-w-[40px] max-w-[40px] border-b border-purple-900 leading-tight">
                    #
                  </th>
                  {/* Frozen Player Column */}
                  <th className="sticky left-[40px] z-20 bg-[#37003c] py-2 px-2.5 whitespace-nowrap border-b border-purple-900 border-r border-purple-900/40 leading-tight">
                    Player
                  </th>
                  <th className="py-2 px-2 text-center w-12 min-w-[48px] border-b border-purple-900 leading-tight">
                    Club
                  </th>
                  <th className="py-2 px-1.5 text-center w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    Pos
                  </th>
                  <th className="py-2 px-1.5 text-right w-14 min-w-[54px] border-b border-purple-900 leading-tight">
                    Cost
                  </th>
                  {/* GW Pts - Wrapped Header */}
                  <th className="py-1.5 px-1.5 text-right w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    <div className="flex flex-col items-end leading-tight">
                      <span>GW</span>
                      <span>Pts</span>
                    </div>
                  </th>
                  {/* Total Pts - Wrapped Header */}
                  <th className="py-1.5 px-1.5 text-right w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    <div className="flex flex-col items-end leading-tight">
                      <span>Total</span>
                      <span>Pts</span>
                    </div>
                  </th>
                  <th className="py-2 px-2.5 text-right w-24 min-w-[96px] border-b border-purple-900 leading-tight">
                    Ownership
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-slate-400 font-medium whitespace-nowrap border-b border-slate-100">
                      No players match the selected Club / Pos filters.
                    </td>
                  </tr>
                ) : (
                  filteredPlayers.slice(0, 50).map((player, idx) => (
                    <tr key={player.id} className="group hover:bg-purple-50/40 transition-colors">
                      {/* Frozen # Column */}
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-purple-50/60 py-2 px-1 text-center whitespace-nowrap w-10 min-w-[40px] max-w-[40px] border-b border-slate-100 transition-colors">
                        <span className="font-bold text-slate-500 text-xs">{idx + 1}</span>
                      </td>
                      {/* Frozen Player Column */}
                      <td
                        onClick={() => handlePlayerClick(player.id)}
                        className="sticky left-[40px] z-10 bg-white group-hover:bg-purple-100/70 py-2 px-2.5 whitespace-nowrap border-b border-slate-100 border-r border-slate-200/80 transition-colors cursor-pointer"
                        title={`Klik untuk melihat detail ${player.web_name}`}
                      >
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <img
                            src={`https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${player.team_code}-66.webp`}
                            alt={player.team_short_name}
                            className="w-5 h-5 sm:w-6 sm:h-6 object-contain shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          <span className="font-black text-slate-900 group-hover:text-purple-900 group-hover:underline text-xs sm:text-sm whitespace-nowrap">
                            {player.web_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center whitespace-nowrap border-b border-slate-100">
                        <span className="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap">
                          {player.team_short_name}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 text-center whitespace-nowrap border-b border-slate-100">
                        <span
                          className={`font-black text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                            player.position === 'FWD'
                              ? 'bg-rose-100 text-rose-800'
                              : player.position === 'MID'
                              ? 'bg-amber-100 text-amber-800'
                              : player.position === 'DEF'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {player.position}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 text-right whitespace-nowrap font-mono text-slate-800 font-semibold text-xs border-b border-slate-100">
                        £{(player.now_cost / 10).toFixed(1)}m
                      </td>
                      {/* GW Pts Cell */}
                      <td className="py-2 px-1.5 text-right whitespace-nowrap font-bold text-slate-700 text-xs sm:text-sm border-b border-slate-100">
                        {player.gw_points !== undefined ? player.gw_points : '-'}
                      </td>
                      {/* Total Pts Cell */}
                      <td className="py-2 px-1.5 text-right whitespace-nowrap font-black text-slate-900 text-xs sm:text-sm border-b border-slate-100">
                        {player.total_points}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap border-b border-slate-100">
                        <div className="flex flex-col items-end">
                          <span className="font-black text-purple-900 text-xs sm:text-sm whitespace-nowrap">
                            {player.owned_count}{' '}
                            <span className="text-slate-400 font-medium text-[11px]">
                              ({player.owned_percentage}%)
                            </span>
                          </span>
                          <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-0.5">
                            <div
                              className="bg-[#00ff87] h-full rounded-full"
                              style={{ width: `${Math.min(player.owned_percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB TAB 2: Most Owned Player by Club */}
      {subTab === 'most-owned-clubs' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 p-4">
            {filteredClubs.map((club, idx) => {
              const clubPlayers = players
                .filter((p) => p.team_short_name === club.short_name)
                .sort((a, b) => b.owned_count - a.owned_count);

              return (
                <div
                  key={club.club_id}
                  className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between hover:border-purple-400 transition-colors shadow-2xs"
                >
                  <div className="flex items-center gap-3.5">
                    {/* Pos number */}
                    <span className="font-black text-slate-400 text-sm w-5 text-center shrink-0">
                      {idx + 1}
                    </span>

                    {/* Club Logo (Mandated: Official club badge, NOT jersey) */}
                    <img
                      src={club.badge_url}
                      alt={club.name}
                      className="w-11 h-11 object-contain shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />

                    {/* Club Info */}
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
                        <span className="text-slate-500 font-medium">Total Players Owned:</span>
                        <span className="font-black text-purple-900">
                          {club.owned_count} <span className="text-slate-400 text-[11px]">({club.owned_percentage}%)</span>
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1.5">
                        <div
                          className="bg-gradient-to-r from-purple-600 to-[#00ff87] h-full rounded-full"
                          style={{ width: `${Math.min(club.owned_percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Clickable Players belonging to this club */}
                  {clubPlayers.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase mr-0.5">
                        Pemain:
                      </span>
                      {clubPlayers.slice(0, 3).map((cp) => (
                        <button
                          key={cp.id}
                          onClick={() => handlePlayerClick(cp.id)}
                          className="inline-flex items-center gap-1 bg-slate-50 hover:bg-purple-100 hover:text-purple-950 text-slate-800 text-[10.5px] font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer border border-slate-200 hover:border-purple-400"
                          title={`Klik untuk melihat detail statistik ${cp.web_name}`}
                        >
                          <span>{cp.web_name}</span>
                          <span className="text-purple-700 text-[9.5px]">({cp.owned_percentage}%)</span>
                        </button>
                      ))}
                      {clubPlayers.length > 3 && (
                        <button
                          onClick={() => {
                            setSelectedClub(club.short_name);
                            setSubTab('most-owned-players');
                          }}
                          className="text-[10.5px] text-purple-700 hover:text-purple-950 font-bold hover:underline cursor-pointer ml-1"
                        >
                          +{clubPlayers.length - 3} lainnya
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB TAB 3: Fans Club */}
      {subTab === 'fans-club' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {currentFansClubs.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm">
              <p className="font-bold text-slate-700">No managers found for this Fans Club criteria.</p>
              <p className="text-xs mt-1">Try selecting a different gameweek filter above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              {currentFansClubs.map((clubGroup) => (
                <div
                  key={clubGroup.club_id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
                >
                  {/* Club Header */}
                  <div className="bg-slate-50/90 p-3.5 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={clubGroup.badge_url}
                        alt={clubGroup.club_name}
                        className="w-8 h-8 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div>
                        <h3 className="font-black text-slate-900 text-sm">
                          {clubGroup.club_name} Fans Club
                        </h3>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {clubGroup.managers.length} {clubGroup.managers.length === 1 ? 'Manager' : 'Managers'} with 3+ players
                        </p>
                      </div>
                    </div>
                    <span className="bg-[#37003c] text-[#00ff87] text-xs font-black px-2.5 py-1 rounded-full">
                      {clubGroup.managers.length}
                    </span>
                  </div>

                  {/* List of Managers */}
                  <div className="divide-y divide-slate-100 p-2 max-h-72 overflow-y-auto">
                    {clubGroup.managers.map((mgr, mIdx) => (
                      <div
                        key={`${mgr.entry_id}-${mIdx}`}
                        onClick={() => onSelectManager(mgr.entry_id, selectedGW)}
                        className="p-2.5 hover:bg-purple-50/40 rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-extrabold text-slate-900 text-xs">
                            {mgr.entry_name}
                          </p>
                          <p className="text-[11px] text-slate-500 font-medium">
                            {mgr.player_name}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {mgr.players.map((pName, pIdx) => (
                              <button
                                key={pIdx}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlayerClickByName(pName);
                                }}
                                className="bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-900 text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors cursor-pointer border border-transparent hover:border-purple-300"
                                title={`Klik untuk melihat detail statistik ${pName}`}
                              >
                                {pName}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="inline-flex items-center font-black text-xs text-purple-900 bg-purple-100 px-2 py-0.5 rounded">
                            {mgr.player_count} Players
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB TAB 4: Template Squad (Visual Pitch View with Club Jerseys) */}
      {subTab === 'template-squad' && templateSquad && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Compact Cropped Pitch Container (Directly after filters, No Bench, Cropped Bottom) */}
          <div className="p-1.5 sm:p-4 md:p-6 bg-slate-900 flex justify-center overflow-x-hidden">
            <div className="relative w-full max-w-3xl rounded-xl sm:rounded-2xl overflow-hidden border-2 sm:border-4 border-emerald-950 shadow-2xl bg-gradient-to-b from-[#0a7e3b] via-[#086f33] to-[#075f2c] pt-3 sm:pt-5 pb-4 sm:pb-6 px-1 sm:px-2 md:px-3">
              {/* Pitch Visual Markings */}
              <div className="absolute inset-0 pointer-events-none opacity-20">
                {/* Horizontal lawn stripes */}
                <div className="h-full w-full flex flex-col">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 ${i % 2 === 0 ? 'bg-black/15' : 'bg-white/10'}`}
                    />
                  ))}
                </div>
              </div>

              {/* Pitch boundary and markings (Cropped bottom, no bottom penalty box) */}
              <div className="absolute inset-2 sm:inset-3 border border-white/40 rounded-lg pointer-events-none">
                {/* Top penalty box */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 sm:w-44 h-12 sm:h-16 border-b border-x border-white/40" />
                {/* Top goal area */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 sm:w-20 h-5 sm:h-7 border-b border-x border-white/30" />
                {/* Top penalty spot */}
                <div className="absolute top-9 sm:top-12 left-1/2 w-1.5 h-1.5 -translate-x-1/2 bg-white/50 rounded-full" />
                {/* Subtle midfield line marker */}
                <div className="absolute bottom-1/3 left-0 right-0 h-px bg-white/20" />
                {/* Midfield circle arc */}
                <div className="absolute bottom-1/3 left-1/2 w-20 sm:w-28 h-10 sm:h-14 -translate-x-1/2 border-t border-x border-white/20 rounded-t-full pointer-events-none" />
              </div>

              {/* 4 Rows on Pitch: 2 GKP, 5 DEF, 5 MID, 3 FWD (Tanpa Bench) */}
              <div className="relative z-10 space-y-2.5 sm:space-y-4 md:space-y-5">
                {/* ROW 1: 2 Goalkeepers (1 Baris) */}
                <div>
                  <div className="flex justify-center items-center gap-6 sm:gap-12 md:gap-16">
                    {templateSquad.gks.slice(0, 2).map((p) => (
                      <TemplatePlayerCard
                        key={p.id}
                        player={p}
                        onClick={() => handlePlayerClick(p.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* ROW 2: 5 Defenders (1 Baris) */}
                <div>
                  <div className="flex justify-center items-center gap-1 sm:gap-1.5 md:gap-2.5">
                    {templateSquad.defs.slice(0, 5).map((p) => (
                      <TemplatePlayerCard
                        key={p.id}
                        player={p}
                        onClick={() => handlePlayerClick(p.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* ROW 3: 5 Midfielders (1 Baris) */}
                <div>
                  <div className="flex justify-center items-center gap-1 sm:gap-1.5 md:gap-2.5">
                    {templateSquad.mids.slice(0, 5).map((p) => (
                      <TemplatePlayerCard
                        key={p.id}
                        player={p}
                        onClick={() => handlePlayerClick(p.id)}
                      />
                    ))}
                  </div>
                </div>

                {/* ROW 4: 3 Forwards (1 Baris) */}
                <div>
                  <div className="flex justify-center items-center gap-3 sm:gap-6 md:gap-8">
                    {templateSquad.fwds.slice(0, 3).map((p) => (
                      <TemplatePlayerCard
                        key={p.id}
                        player={p}
                        onClick={() => handlePlayerClick(p.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TemplatePlayerCardProps {
  player: TemplateSquadPlayer;
  onClick?: () => void;
}

const TemplatePlayerCard: React.FC<TemplatePlayerCardProps> = ({ player, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center group cursor-pointer transition-transform hover:scale-105 select-none w-[58px] sm:w-[68px] md:w-[76px]"
      title={`Klik untuk melihat detail ${player.web_name}`}
    >
      {/* Club Jersey Image directly from official FPL CDN */}
      <div className="relative w-7 h-8 sm:w-9 sm:h-10 md:w-11 md:h-12 flex items-center justify-center">
        <img
          src={player.shirt_url}
          alt={player.team_short_name}
          className="w-full h-full object-contain filter drop-shadow"
          onError={(e) => {
            // Fallback shirt if team code shirt fails
            e.currentTarget.src = 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-66.webp';
          }}
        />
        {/* Team short code badge */}
        <span className="absolute -top-1 -right-1 bg-black/80 text-[#00ff87] text-[6.5px] sm:text-[7.5px] font-black px-0.5 rounded leading-tight">
          {player.team_short_name}
        </span>
      </div>

      {/* Ramping Name and Price/Ownership Box */}
      <div className="mt-0.5 w-full text-center">
        {/* Web name in 1 row without wrap */}
        <div
          title={player.web_name}
          className="bg-[#37003c] group-hover:bg-purple-900 text-white text-[8px] sm:text-[9.5px] md:text-[10.5px] font-bold py-0.5 px-0.5 rounded-t truncate whitespace-nowrap shadow-sm border-x border-t border-purple-900 leading-tight transition-colors"
        >
          {player.web_name}
        </div>
        {/* Cost and ownership in 1 row */}
        <div className="bg-[#00ff87] group-hover:bg-[#34fab0] text-[#200024] text-[7px] sm:text-[8px] md:text-[9px] font-black py-0.5 px-0.5 rounded-b flex items-center justify-between shadow-sm whitespace-nowrap leading-tight transition-colors">
          <span>£{(player.now_cost / 10).toFixed(1)}</span>
          <span>{player.owned_percentage}%</span>
        </div>
      </div>
    </div>
  );
};
