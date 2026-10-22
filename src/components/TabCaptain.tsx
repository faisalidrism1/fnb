import React, { useState, useRef, useEffect } from 'react';
import { Crown, Shield } from 'lucide-react';
import { CaptainPlayerItem, ClubCaptainItem } from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';
import { useLanguage } from '../utils/i18n.ts';

interface TabCaptainProps {
  captains: Record<number, CaptainPlayerItem[]>;
  clubCaptains: Record<number, ClubCaptainItem[]>;
  currentGW: number;
  availableGWs: number[];
  selectedGW?: number;
  onSelectGW?: (gw: number) => void;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  subTab?: CaptainSubTab;
  onSelectSubTab?: (subTab: CaptainSubTab) => void;
}

export type { CaptainSubTab };

type CaptainSubTab = 'most-captained-player' | 'most-captained-club-players';

const TEAM_CODE_MAP: Record<string, number> = {
  ARS: 3,
  AVL: 7,
  BOU: 91,
  BRE: 94,
  BHA: 36,
  CHE: 8,
  CRY: 31,
  EVE: 11,
  FUL: 54,
  IPS: 40,
  LEI: 13,
  LEE: 2,
  LIV: 14,
  MCI: 43,
  MUN: 1,
  NEW: 4,
  NFO: 17,
  SOU: 20,
  TOT: 6,
  WHU: 21,
  WOL: 39,
  SUN: 56,
  COV: 9,
  HUL: 88,
};

export const TabCaptain: React.FC<TabCaptainProps> = ({
  captains,
  clubCaptains,
  currentGW,
  availableGWs,
  selectedGW: propSelectedGW,
  onSelectGW,
  onSelectPlayer,
  subTab: propSubTab,
  onSelectSubTab,
}) => {
  const { t, language } = useLanguage();
  const [internalSubTab, setInternalSubTab] = useState<CaptainSubTab>('most-captained-player');
  const subTab = propSubTab !== undefined ? propSubTab : internalSubTab;
  const setSubTab = (val: CaptainSubTab) => {
    if (onSelectSubTab) onSelectSubTab(val);
    else setInternalSubTab(val);
  };

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

  const playerCaptains = captains[selectedGW] || [];
  const clubCaptainList = clubCaptains[selectedGW] || [];

  return (
    <div className="space-y-2.5">
      {/* Direct Filter Row below sub tab */}
      <div className="flex items-center gap-2 py-0.5">
        <CustomPopoverSelect
          id="captain-gw-select"
          value={selectedGW}
          onChange={(val) => handleSelectGW(Number(val))}
          options={availableGWs.map((gw) => ({
            value: gw,
            label: `GW ${gw}`,
            sublabel: gw === currentGW ? (language === 'id' ? 'Terkini' : 'Current') : undefined,
          }))}
        />
      </div>

      {/* SUB TAB 1: Most Captained Player */}
      {subTab === 'most-captained-player' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 border-separate border-spacing-0">
              <thead className="bg-[#37003c] text-white text-[11px] tracking-wider font-extrabold select-none">
                <tr>
                  {/* Frozen # Column */}
                  <th className="sticky left-0 z-30 bg-[#37003c] py-2 px-1 text-center w-11 min-w-[44px] max-w-[44px] border-b border-purple-900 border-r border-purple-900/60 leading-tight">
                    #
                  </th>
                  {/* Frozen Player Column */}
                  <th className="sticky left-[44px] z-30 bg-[#37003c] py-2 px-3 whitespace-nowrap border-b border-purple-900 border-r border-purple-900/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.25)] leading-tight">
                    {t('col_player')}
                  </th>
                  <th className="py-2 px-2 text-center border-b border-purple-900 leading-tight">{t('col_club')}</th>
                  <th className="py-2 px-2 text-center border-b border-purple-900 leading-tight">{t('col_pos')}</th>
                  <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">{t('col_cost')}</th>
                  {/* GW Pts added to the left of Total Pts */}
                  <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">{t('col_gw_pts')}</th>
                  <th className="py-2 px-2.5 text-right border-b border-purple-900 leading-tight">{t('col_total_pts')}</th>
                  {/* Swapped: (C) first, then (VC) */}
                  <th className="py-2 px-3 text-right border-b border-purple-900 leading-tight">{t('col_c')}</th>
                  <th className="py-2 px-3 text-right border-b border-purple-900 leading-tight">{t('col_vc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {playerCaptains.map((p, idx) => {
                  const teamCode = p.team_code || TEAM_CODE_MAP[p.team_short_name] || 1;
                  const isGk = p.position === 'GKP';
                  const proxyJerseyUrl = `/api/fpl-shirt/${teamCode}${isGk ? '_1' : ''}`;
                  const fallbackJerseyUrl = `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${teamCode}-220.webp`;

                  return (
                    <tr key={p.id} className="hover:bg-purple-50/30 transition-colors group">
                      {/* Frozen # Column */}
                      <td className="sticky left-0 z-20 bg-white group-hover:bg-purple-50/50 py-2 px-1 text-center whitespace-nowrap border-r border-slate-100 w-11 min-w-[44px] max-w-[44px]">
                        <span className="font-bold text-slate-500">{idx + 1}</span>
                      </td>

                      {/* Frozen Player Column - with jersey image */}
                      <td
                        onClick={() => {
                          if (onSelectPlayer) {
                            onSelectPlayer(p.id, selectedGW);
                          }
                        }}
                        className={`sticky left-[44px] z-20 bg-white group-hover:bg-purple-100/70 py-2 px-3 whitespace-nowrap border-r border-slate-200/80 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] transition-colors ${
                          onSelectPlayer ? 'cursor-pointer' : ''
                        }`}
                        title={onSelectPlayer ? (language === 'id' ? `Klik untuk melihat detail ${p.web_name}` : `Click to view details for ${p.web_name}`) : undefined}
                      >
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <img
                            src={proxyJerseyUrl}
                            alt={p.team_short_name}
                            className="w-6 h-6 object-contain shrink-0 select-none"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src.includes('/api/fpl-shirt/')) {
                                target.src = fallbackJerseyUrl;
                              } else {
                                target.onerror = null;
                                target.src = '/default_team_badge.png';
                              }
                            }}
                          />
                          <span className="font-black text-slate-900 group-hover:text-purple-900 group-hover:underline text-xs sm:text-sm whitespace-nowrap">
                            {p.web_name}
                          </span>
                        </div>
                      </td>

                      {/* Club */}
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        <span className="font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap">
                          {p.team_short_name}
                        </span>
                      </td>

                      {/* Pos */}
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        <span
                          className={`font-black text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                            p.position === 'FWD'
                              ? 'bg-rose-100 text-rose-800'
                              : p.position === 'MID'
                              ? 'bg-amber-100 text-amber-800'
                              : p.position === 'DEF'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {p.position}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="py-2 px-2.5 text-right whitespace-nowrap font-mono">
                        £{((p.now_cost || 0) / 10).toFixed(1)}m
                      </td>

                      {/* GW Pts */}
                      <td className="py-2 px-2.5 text-right whitespace-nowrap font-black text-purple-900">
                        {p.gw_points || 0}
                      </td>

                      {/* Total Pts */}
                      <td className="py-2 px-2.5 text-right whitespace-nowrap font-black text-slate-900">
                        {p.total_points}
                      </td>

                      {/* (C) - Captain picks with progress bar */}
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end whitespace-nowrap">
                          <span className="font-black text-purple-900 text-xs whitespace-nowrap">
                            {p.captain_count}{' '}
                            <span className="text-slate-400 font-medium text-[10px] sm:text-[11px]">
                              ({p.captain_percentage}%)
                            </span>
                          </span>
                          <div className="w-16 sm:w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-0.5">
                            <div
                              className="bg-amber-400 h-full rounded-full"
                              style={{ width: `${Math.min(p.captain_percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* (VC) - Vice captain styled identical to (C) */}
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end whitespace-nowrap">
                          <span className="font-black text-purple-900 text-xs whitespace-nowrap">
                            {p.vice_count}{' '}
                            <span className="text-slate-400 font-medium text-[10px] sm:text-[11px]">
                              ({p.vice_percentage || 0}%)
                            </span>
                          </span>
                          <div className="w-16 sm:w-20 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-0.5">
                            <div
                              className="bg-purple-400 h-full rounded-full"
                              style={{ width: `${Math.min(p.vice_percentage || 0, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB TAB 2: Most Captained Player by Club */}
      {subTab === 'most-captained-club-players' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5">
            {clubCaptainList.map((club, idx) => (
              <div
                key={club.club_id}
                className="bg-white border border-slate-200/90 rounded-xl p-3 flex items-center gap-3 hover:border-purple-400 transition-colors shadow-2xs"
              >
                {/* Pos */}
                <span className="font-black text-slate-400 text-xs sm:text-sm w-5 text-center shrink-0">
                  {idx + 1}
                </span>

                {/* Club Badge (Official Premier League Vector SVG) */}
                <img
                  src={club.badge_url ? club.badge_url.replace(/(\/badges\/)(?:100\/|70\/|50\/|25\/)?(t\d+)\.(?:png|svg)/, '$1$2.svg') : ''}
                  alt={club.name}
                  className="w-10 h-10 object-contain shrink-0"
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

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-900 text-xs sm:text-sm truncate">
                      {club.name}
                    </h3>
                    <span className="text-[11px] font-bold text-slate-400 font-mono">
                      {club.short_name}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-1 text-xs">
                    <span className="text-slate-500 font-medium">{t('card_captain_armbands')}</span>
                    <span className="font-black text-purple-900">
                      {club.captain_count}{' '}
                      <span className="text-slate-400 text-[10px] sm:text-[11px]">
                        ({club.captain_percentage}%)
                      </span>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
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
