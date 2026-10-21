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
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import fnbLogo from '../assets/images/fnb_league_logo_transparent.png';
import { useLanguage } from '../utils/i18n.ts';

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
  subTab?: OwnershipSubTab;
  onSelectSubTab?: (subTab: OwnershipSubTab) => void;
}

export type { OwnershipSubTab };

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
  subTab: propSubTab,
  onSelectSubTab,
}) => {
  const { t, language } = useLanguage();
  const [internalSubTab, setInternalSubTab] = useState<OwnershipSubTab>('most-owned-players');
  const subTab = propSubTab !== undefined ? propSubTab : internalSubTab;
  const setSubTab = (val: OwnershipSubTab) => {
    if (onSelectSubTab) onSelectSubTab(val);
    else setInternalSubTab(val);
  };
  // Check if Season has at least 1 club with at least 1 manager
  const seasonFansClubGroups = fansClubs?.['all'] || [];
  const hasSeasonFans = seasonFansClubGroups.some((g) => (g.managers || []).length > 0);
  const defaultGWStr = String(
    availableGWs.includes(currentGW)
      ? currentGW
      : (availableGWs.length > 0 ? Math.max(...availableGWs) : currentGW)
  );

  // If Season has no qualifying clubs/managers, remove Season option and default to Current GW
  const [fansClubFilter, setFansClubFilter] = useState<string>(() => {
    return hasSeasonFans ? 'all' : defaultGWStr;
  });

  useEffect(() => {
    if (!hasSeasonFans && fansClubFilter === 'all') {
      setFansClubFilter(defaultGWStr);
    }
  }, [hasSeasonFans, fansClubFilter, defaultGWStr]);

  const effectiveFansClubFilter = !hasSeasonFans && fansClubFilter === 'all'
    ? defaultGWStr
    : fansClubFilter;

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
  const currentFansClubs = fansClubs[effectiveFansClubFilter] || [];
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
      {/* Direct Filter Row below sub tab */}
      <div className="flex items-center justify-between gap-2 py-0.5">
        {subTab !== 'fans-club' ? (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Gameweek Filter */}
            <CustomPopoverSelect
              id="ownership-gw-select"
              value={selectedGW}
              onChange={(val) => handleSelectGW(Number(val))}
              options={availableGWs.map((gw) => ({
                value: gw,
                label: `GW ${gw}`,
                sublabel: gw === currentGW ? 'Current' : undefined,
              }))}
            />

            {/* Filter Club & Pos di sebelah kanan filter GW untuk Most Owned Player */}
            {subTab === 'most-owned-players' && (
              <>
                <CustomPopoverSelect
                  id="ownership-club-select"
                  value={selectedClub}
                  onChange={(val) => setSelectedClub(String(val))}
                  options={[
                    { value: 'all', label: t('filter_all_clubs') },
                    ...availableClubs.map((club) => ({ value: club, label: club })),
                  ]}
                  searchable={false}
                />

                <CustomPopoverSelect
                  id="ownership-pos-select"
                  value={selectedPos}
                  onChange={(val) => setSelectedPos(String(val))}
                  options={[
                    { value: 'all', label: t('filter_all_pos') },
                    { value: 'GKP', label: 'GKP' },
                    { value: 'DEF', label: 'DEF' },
                    { value: 'MID', label: 'MID' },
                    { value: 'FWD', label: 'FWD' },
                  ]}
                />
              </>
            )}

            {/* Filter Pos di sebelah kanan filter GW untuk Most Owned Player by Club */}
            {subTab === 'most-owned-clubs' && (
              <CustomPopoverSelect
                id="club-ownership-pos-select"
                value={selectedClubPos}
                onChange={(val) => setSelectedClubPos(String(val))}
                options={[
                  { value: 'all', label: t('filter_all_pos') },
                  { value: 'GKP', label: 'GKP' },
                  { value: 'DEF', label: 'DEF' },
                  { value: 'MID', label: 'MID' },
                  { value: 'FWD', label: 'FWD' },
                ]}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CustomPopoverSelect
              id="fans-club-gw-select"
              value={effectiveFansClubFilter}
              onChange={(val) => setFansClubFilter(String(val))}
              options={[
                ...(hasSeasonFans ? [{ value: 'all', label: t('filter_season') }] : []),
                ...availableGWs.map((gw) => ({
                  value: String(gw),
                  label: `GW ${gw}`,
                  sublabel: gw === currentGW ? 'Current' : undefined,
                })),
              ]}
            />
          </div>
        )}

        {subTab === 'template-squad' && templateSquad && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Squad Cost Badge */}
            <div className="flex items-center gap-1.5 bg-[#37003c] text-white px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-2xs">
              <span className="text-[#00ff87]">{language === 'id' ? 'Nilai Skuad:' : 'Squad Cost:'}</span>
              <span>£{(templateSquad.total_cost / 10).toFixed(1)}m</span>
            </div>
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
                    {t('col_player')}
                  </th>
                  <th className="py-2 px-2 text-center w-12 min-w-[48px] border-b border-purple-900 leading-tight">
                    {t('col_club')}
                  </th>
                  <th className="py-2 px-1.5 text-center w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    {t('col_pos')}
                  </th>
                  <th className="py-2 px-1.5 text-right w-14 min-w-[54px] border-b border-purple-900 leading-tight">
                    {t('col_cost')}
                  </th>
                  {/* GW Pts - Wrapped Header */}
                  <th className="py-1.5 px-1.5 text-right w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    <div className="flex flex-col items-end leading-tight">
                      {language === 'id' ? (
                        <>
                          <span>Poin</span>
                          <span>GW</span>
                        </>
                      ) : (
                        <>
                          <span>GW</span>
                          <span>Pts</span>
                        </>
                      )}
                    </div>
                  </th>
                  {/* Total Pts - Wrapped Header */}
                  <th className="py-1.5 px-1.5 text-right w-11 min-w-[44px] border-b border-purple-900 leading-tight">
                    <div className="flex flex-col items-end leading-tight">
                      {language === 'id' ? (
                        <>
                          <span>Total</span>
                          <span>Poin</span>
                        </>
                      ) : (
                        <>
                          <span>Total</span>
                          <span>Pts</span>
                        </>
                      )}
                    </div>
                  </th>
                  <th className="py-2 px-2.5 text-right w-24 min-w-[96px] border-b border-purple-900 leading-tight">
                    {t('col_ownership')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 px-4 text-center text-slate-400 font-medium whitespace-nowrap border-b border-slate-100">
                      {t('ownership_empty_players')}
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
                            src={
                              player.element_type === 1
                                ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${player.team_code}_1-220.webp`
                                : `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${player.team_code}-220.webp`
                            }
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
                .filter((p) => {
                  if (p.team_short_name !== club.short_name) return false;
                  if (selectedClubPos !== 'all' && p.position !== selectedClubPos) return false;
                  return true;
                })
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

                    {/* Club Logo (Mandated: Official club badge vector SVG, NOT jersey) */}
                    <img
                      src={club.badge_url ? club.badge_url.replace(/(\/badges\/)(?:100\/|70\/|50\/|25\/)?(t\d+)\.(?:png|svg)/, '$1$2.svg') : ''}
                      alt={club.name}
                      className="w-11 h-11 object-contain shrink-0"
                      onError={(e) => {
                        if (e.currentTarget.src.endsWith('.svg')) {
                          e.currentTarget.src = e.currentTarget.src.replace('/badges/t', '/badges/100/t').replace('.svg', '.png');
                        } else if (e.currentTarget.src.includes('/100/')) {
                          e.currentTarget.src = e.currentTarget.src.replace('/badges/100/', '/badges/70/');
                        } else {
                          e.currentTarget.style.display = 'none';
                        }
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
                        <span className="text-slate-500 font-medium">{t('total_players_owned')}</span>
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
                      {clubPlayers.slice(0, 3).map((cp) => (
                        <button
                          key={cp.id}
                          onClick={() => handlePlayerClick(cp.id)}
                          className="inline-flex items-center gap-1 bg-slate-50 hover:bg-purple-100 hover:text-purple-950 text-slate-800 text-[10.5px] font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer border border-slate-200 hover:border-purple-400"
                          title={`Klik untuk melihat detail statistik ${cp.web_name}`}
                        >
                          <span>{cp.web_name}</span>
                          <span className="text-purple-700 text-[9.5px]">({cp.owned_count})</span>
                        </button>
                      ))}
                      {clubPlayers.length > 3 && (
                        <button
                          onClick={() => {
                            setSelectedClub(club.short_name);
                            if (selectedClubPos !== 'all') {
                              setSelectedPos(selectedClubPos);
                            }
                            setSubTab('most-owned-players');
                          }}
                          className="text-[10.5px] text-purple-700 hover:text-purple-950 font-bold hover:underline cursor-pointer ml-1"
                        >
                          +{clubPlayers.length - 3}
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
              <p className="font-bold text-slate-700">{t('fans_club_empty')}</p>
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
                  <div className="bg-slate-50/90 dark:bg-[#1f0d38] p-3.5 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={clubGroup.badge_url ? clubGroup.badge_url.replace(/(\/badges\/)(?:100\/|70\/|50\/|25\/)?(t\d+)\.(?:png|svg)/, '$1$2.svg') : ''}
                        alt={clubGroup.club_name}
                        className="w-8 h-8 object-contain"
                        onError={(e) => {
                          if (e.currentTarget.src.endsWith('.svg')) {
                            e.currentTarget.src = e.currentTarget.src.replace('/badges/t', '/badges/100/t').replace('.svg', '.png');
                          } else if (e.currentTarget.src.includes('/100/')) {
                            e.currentTarget.src = e.currentTarget.src.replace('/badges/100/', '/badges/70/');
                          } else {
                            e.currentTarget.style.display = 'none';
                          }
                        }}
                      />
                      <div>
                        <h3 className="font-black text-slate-900 text-sm">
                          {t('card_fans_club', { Club: clubGroup.club_name })}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {t('fans_club_sub', { N: clubGroup.managers.length })}
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
                        onClick={() => onSelectManager(mgr.entry_id, Number(effectiveFansClubFilter) || selectedGW)}
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
                            {t('fans_club_badge_players', { N: mgr.player_count })}
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
          {/* Compact Pitch Container */}
          <div className="p-1.5 sm:p-4 md:p-6 bg-slate-950 flex justify-center overflow-x-hidden">
            <div className="relative w-full max-w-3xl rounded-xl sm:rounded-2xl overflow-hidden border-2 sm:border-4 border-emerald-950 shadow-2xl bg-slate-900">
              {/* Top Cyan Goal Net & FNB League Sponsor Header Banner - Restored Height, Harmonized Colors & Centered Badges */}
              <div className="relative w-full h-8 sm:h-11 bg-gradient-to-r from-[#008be3] via-[#00c5ff] to-[#008be3] flex items-center select-none shadow-md">
                {/* Left Sponsor Badge: Centered between left border and goal post */}
                <div className="flex-1 flex justify-center items-center px-1">
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <img
                      src={fnbLogo}
                      alt="FNB League"
                      className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain shrink-0 drop-shadow-sm"
                      onError={(e) => {
                        e.currentTarget.src = '/logo.png';
                      }}
                    />
                    <span className="font-black text-[#37003c] text-xs sm:text-base md:text-xl tracking-tight leading-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.5)] whitespace-nowrap">
                      FNB League
                    </span>
                  </div>
                </div>

                {/* Center Goal Post & Matching Honeycomb Net */}
                <div className="shrink-0 w-24 sm:w-36 h-full flex justify-center items-end">
                  <div className="w-full h-6 sm:h-9 border-t-2 border-x-2 border-white rounded-t-sm bg-gradient-to-b from-[#007cc7] via-[#0099ee] to-[#00c0fa] relative overflow-hidden shadow-inner">
                    <svg className="w-full h-full opacity-65" width="100%" height="100%">
                      <defs>
                        <pattern id="fpl-goal-net" width="6" height="6" patternUnits="userSpaceOnUse">
                          <path d="M 0 0 L 6 6 M 6 0 L 0 6" fill="none" stroke="#ffffff" strokeWidth="0.8" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#fpl-goal-net)" />
                    </svg>
                  </div>
                </div>

                {/* Right Sponsor Badge: Centered between goal post and right border */}
                <div className="flex-1 flex justify-center items-center px-1">
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <img
                      src={fnbLogo}
                      alt="FNB League"
                      className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain shrink-0 drop-shadow-sm"
                      onError={(e) => {
                        e.currentTarget.src = '/logo.png';
                      }}
                    />
                    <span className="font-black text-[#37003c] text-xs sm:text-base md:text-xl tracking-tight leading-none drop-shadow-[0_1px_1px_rgba(255,255,255,0.5)] whitespace-nowrap">
                      FNB League
                    </span>
                  </div>
                </div>
              </div>

              {/* Pitch Green Surface: Plain Dark Grass Green (#00aa52) Outside Pitch, Alternating Striped Inside */}
              <div className="relative w-full pt-4 sm:pt-6 md:pt-8 pb-6 sm:pb-8 md:pb-10 px-1 sm:px-2 md:px-3 bg-[#00aa52] overflow-hidden">
                {/* 10 Alternating Horizontal Lawn Mowing Stripes - Clipped Strictly Inside Field Boundaries */}
                <div
                  className="absolute inset-0 flex flex-col pointer-events-none"
                  style={{ clipPath: 'polygon(7% 0%, 93% 0%, 98.5% 100%, 1.5% 100%)' }}
                >
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 w-full ${i % 2 === 0 ? 'bg-[#00c261]' : 'bg-[#00aa52]'}`}
                    />
                  ))}
                </div>

                {/* SVG True 1-Point Perspective Regulation Pitch Markings */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  preserveAspectRatio="none"
                  viewBox="0 0 1000 1200"
                >
                  {/* Top Goal Line */}
                  <line x1="70" y1="0" x2="930" y2="0" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

                  {/* Left & Right Touchlines (Converging to single vanishing point at 500, -9382) */}
                  <line x1="70" y1="0" x2="15" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />
                  <line x1="930" y1="0" x2="985" y2="1200" stroke="rgba(255,255,255,0.88)" strokeWidth="3.5" />

                  {/* Top Corner Arcs - 1/4 Lingkaran Penuh */}
                  <path d="M 68.2,40 A 40,40 0 0,0 110,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  <path d="M 931.8,40 A 40,40 0 0,1 890,0" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

                  {/* 18-Yard Penalty Area - Dibuat Lebih Pendek Vertikal Secara Proporsional */}
                  <polyline
                    points="245,0 239.8,190 760.2,190 755,0"
                    fill="none"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth="3.5"
                  />

                  {/* 6-Yard Goal Area - Proporsional Terhadap Kotak 18-Yard */}
                  <polyline
                    points="384.3,0 383.5,65 616.5,65 615.7,0"
                    fill="none"
                    stroke="rgba(255,255,255,0.88)"
                    strokeWidth="3"
                  />

                  {/* Penalty Spot - Proporsional Di Dalam Kotak Penalti */}
                  <circle cx="500" cy="127" r="4.5" fill="rgba(255,255,255,0.95)" />

                  {/* Penalty Arc (D-Shape) - Sesuai Titik & Garis Kotak Penalti Baru */}
                  <path
                    d="M 445,190 A 85,55 0 0,0 555,190"
                    fill="none"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth="3.5"
                  />

                  {/* Midfield Halfway Line */}
                  <line x1="23.25" y1="1020" x2="976.75" y2="1020" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />

                  {/* Center Circle Ellipse - Ditambah Ukuran Vertikal & Simetris 100% Atas/Bawah Garis Tengah */}
                  <ellipse cx="500" cy="1020" rx="145" ry="90" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" />
                  {/* Center Spot */}
                  <circle cx="500" cy="1020" r="5" fill="rgba(255,255,255,0.95)" />
                </svg>

                {/* 4 Rows on Pitch: 2 GKP, 5 DEF, 5 MID, 3 FWD - Jarak Vertikal Diatur Proporsional & Lega */}
                <div className="relative z-10 space-y-4 sm:space-y-6 md:space-y-8">
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
                    <div className="flex justify-center items-center gap-0.5 sm:gap-1.5 md:gap-2">
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
                    <div className="flex justify-center items-center gap-0.5 sm:gap-1.5 md:gap-2">
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
  // Ultra HD 220px jersey proxied locally for blazing fast load without CORS/ISP blocks
  const teamCode = player.team_code || 1;
  const proxyShirtUrl = `/api/fpl-shirt/${teamCode}${player.is_gk ? '_1' : ''}`;
  const directShirtUrl = player.is_gk
    ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}_1-220.webp`
    : `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-220.webp`;

  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center group cursor-pointer transition-transform hover:scale-105 select-none w-[66px] sm:w-[82px] md:w-[96px]"
      title={`Klik untuk melihat detail ${player.web_name}`}
    >
      {/* Club Jersey Image directly from official FPL CDN - HD 220px Resolution & 125% Enlarged */}
      <div className="relative z-0 w-[60px] h-[69px] sm:w-[78px] sm:h-[85px] md:w-[94px] md:h-[102px] flex items-center justify-center">
        <img
          src={proxyShirtUrl}
          alt={player.team_short_name || 'Jersey'}
          className="w-full h-full object-contain filter drop-shadow select-none"
          loading="eager"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const target = e.currentTarget;
            if (target.src.includes('/api/fpl-shirt/')) {
              target.src = directShirtUrl;
            } else if (!target.src.includes('shirt_0')) {
              target.src = 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_0-220.webp';
            } else {
              target.onerror = null;
              target.src = '/default_team_badge.png';
            }
          }}
        />
      </div>

      {/* Ramping Name and Price/Ownership Box: Overlapping on top of bottom 1/3 of the jersey */}
      <div className="relative z-10 -mt-[23px] sm:-mt-[28px] md:-mt-[34px] w-full text-center">
        {/* Web name in 1 row without wrap */}
        <div
          title={player.web_name}
          className="bg-[#37003c] group-hover:bg-purple-900 text-white text-[8.5px] sm:text-[10px] md:text-[11px] font-bold py-0.5 px-0.5 rounded-t truncate whitespace-nowrap shadow-sm border-x border-t border-purple-900 leading-tight transition-colors"
        >
          {player.web_name}
        </div>
        {/* Cost and ownership in 1 row */}
        <div className="bg-[#00ff87] group-hover:bg-[#34fab0] text-[#200024] text-[7.5px] sm:text-[8.5px] md:text-[9.5px] font-black py-0.5 px-1 rounded-b flex items-center justify-between shadow-sm whitespace-nowrap leading-tight transition-colors">
          <span>£{(player.now_cost / 10).toFixed(1)}</span>
          <span>{player.owned_percentage}%</span>
        </div>
      </div>
    </div>
  );
};
