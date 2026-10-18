import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import {
  MatchCardItem,
  MatchPlayerItem,
  MatchPlayerEvent,
  MatchStatMetric,
  PlayerOwnershipItem,
  TransferItem,
} from '../types.ts';
import { CustomPopoverSelect } from './CustomPopoverSelect.tsx';

interface TabMatchesProps {
  currentGW?: number;
  availableGWs?: number[];
  lastSynced?: string;
  isMatchLive?: boolean;
  isAppVisible?: boolean;
  ownershipPlayers?: Record<number, PlayerOwnershipItem[]>;
  transfers?: TransferItem[];
  onSelectPlayer?: (playerId: number, gw?: number) => void;
}

const MATCH_METRIC_OPTIONS: Array<{ value: MatchStatMetric; label: string }> = [
  { value: 'pts', label: 'Total Points' },
  { value: 'st', label: 'Starts' },
  { value: 'mp', label: 'Minutes Played' },
  { value: 'gs', label: 'Goals Scored' },
  { value: 'a', label: 'Assists' },
  { value: 'xg', label: 'Expected Goals (xG)' },
  { value: 'xa', label: 'Expected Assists (xA)' },
  { value: 'xgi', label: 'Expected Goal Involvement (xGI)' },
  { value: 'cs', label: 'Clean Sheets' },
  { value: 'gc', label: 'Goals Conceded' },
  { value: 'xgc', label: 'Expected Goals Conceded (xGC)' },
  { value: 't', label: 'Tackles' },
  { value: 'cbi', label: 'Clearances, Blocks & Interceptions (CBI)' },
  { value: 'r', label: 'Recoveries' },
  { value: 'dc', label: 'Defensive Contribution (DefCon)' },
  { value: 'og', label: 'Own Goals' },
  { value: 'ps', label: 'Penalties Saved' },
  { value: 'pm', label: 'Penalties Missed' },
  { value: 'yc', label: 'Yellow Cards' },
  { value: 'rc', label: 'Red Cards' },
  { value: 's', label: 'Saves' },
  { value: 'bp', label: 'Bonus Points' },
  { value: 'bps', label: 'Bonus Points System (BPS)' },
  { value: 'inf', label: 'Influence' },
  { value: 'cre', label: 'Creativity' },
  { value: 'thr', label: 'Threat' },
  { value: 'ii', label: 'ICT Index' },
  { value: 'nt', label: 'Net Transfers (FNB League)' },
  { value: 'tsb', label: 'Teams Selected By (FNB League)' },
  { value: 'cost', label: 'Player Price' },
];

/**
 * Format ISO Kickoff time into 1-line Indonesian date & time
 * Example: "Sabtu, 17 Agu 2024 • 18:30 WIB"
 */
function formatMatchKickoffWIB(isoString: string): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

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
 * Breakdown order mapping and calculation from player stats
 */
function buildPlayerBreakdownItems(player: MatchPlayerItem): Array<{ code: string; value: string | number; points: number }> {
  const isGkOrDef = player.position === 'GKP' || player.position === 'DEF';
  const isMid = player.position === 'MID';
  const goalPts = isGkOrDef ? 6 : isMid ? 5 : 4;
  const csPts = isGkOrDef ? 4 : isMid ? 1 : 0;
  const st = player.stats;

  const items: Array<{ code: string; value: string | number; points: number; order: number }> = [];

  if (st.minutes > 0) {
    const mPts = st.minutes >= 60 ? 2 : 1;
    items.push({ code: 'MP', value: st.minutes, points: mPts, order: 1 });
  }
  if (st.goals_scored > 0) {
    items.push({ code: 'GS', value: st.goals_scored, points: st.goals_scored * goalPts, order: 2 });
  }
  if (st.assists > 0) {
    items.push({ code: 'A', value: st.assists, points: st.assists * 3, order: 3 });
  }
  if (st.clean_sheets > 0 && csPts > 0) {
    items.push({ code: 'CS', value: st.clean_sheets, points: st.clean_sheets * csPts, order: 4 });
  }
  if (st.saves > 0 && player.position === 'GKP') {
    const sPts = Math.floor(st.saves / 3);
    if (sPts > 0) items.push({ code: 'S', value: st.saves, points: sPts, order: 5 });
  }
  if (st.penalties_saved > 0 && player.position === 'GKP') {
    items.push({ code: 'PS', value: st.penalties_saved, points: st.penalties_saved * 5, order: 6 });
  }
  if (st.defensive_contribution > 0) {
    const dcThreshold = player.position === 'DEF' ? 10 : 12;
    const dcPts = (player.position !== 'GKP' && st.defensive_contribution >= dcThreshold) ? 2 : 0;
    if (dcPts > 0) {
      items.push({ code: 'DC', value: st.defensive_contribution, points: dcPts, order: 7 });
    }
  }
  if (st.goals_conceded >= 2 && isGkOrDef) {
    const gcPts = -Math.floor(st.goals_conceded / 2);
    items.push({ code: 'GC', value: st.goals_conceded, points: gcPts, order: 8 });
  }
  if (st.own_goals > 0) {
    items.push({ code: 'OG', value: st.own_goals, points: st.own_goals * -2, order: 9 });
  }
  if (st.penalties_missed > 0) {
    items.push({ code: 'PM', value: st.penalties_missed, points: st.penalties_missed * -2, order: 10 });
  }
  if (st.yellow_cards > 0) {
    items.push({ code: 'YC', value: st.yellow_cards, points: st.yellow_cards * -1, order: 11 });
  }
  if (st.red_cards > 0) {
    items.push({ code: 'RC', value: st.red_cards, points: st.red_cards * -3, order: 12 });
  }
  if (st.bonus > 0) {
    items.push({ code: 'BP', value: st.bonus, points: st.bonus, order: 13 });
  }

  if (items.length === 0) {
    items.push({ code: 'MP', value: 0, points: 0, order: 1 });
  }

  items.sort((a, b) => a.order - b.order);
  return items;
}

/**
 * Universal SVG Renderers for the 10 Event Badges in Uniform Rounded Square Containers
 */
const MatchEventBadgeIcon: React.FC<{ event: MatchPlayerEvent }> = React.memo(({ event }) => {
  const { type, count, bonusRank } = event;

  const renderIconContent = () => {
    switch (type) {
      case 'goal':
        return (
          // Flashscore Authentic Soccer Ball
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 text-slate-800 dark:text-zinc-100 fill-current" fill="currentColor">
            <path d="m17 2.9c-3.9-3.9-10.2-3.9-14.1 0s-3.9 10.2 0 14.1c2.5 2.5 6.2 3.5 9.6 2.6s6.1-3.6 7-7c1-3.5 0-7.2-2.5-9.7zm.4 2.8c.6 1.1 1 2.2 1.1 3.4l-1.8-1zm-1.4-1.8c.1.1.3.3.4.4l-1.1 3.6-1.3.4-3.3-2.4v-1.4l3.2-2.2c.7.4 1.5.9 2.1 1.6zm-6-2.5c.8 0 1.6.1 2.3.3l-2.3 1.6-2.3-1.6c.7-.2 1.5-.3 2.3-.3zm-6.1 2.5c.6-.7 1.4-1.2 2.2-1.6l3.2 2.2v1.4l-3.3 2.4-1.4-.4-1.1-3.6c.1-.1.3-.3.4-.4zm-1.4 1.8.7 2.4-1.8 1c.1-1.2.5-2.4 1.1-3.4zm1.4 10.3c-.1-.1-.1-.2-.2-.2h2l.7 1.9c-1-.4-1.8-1-2.5-1.7zm2-1.6h-3.3c-.7-1.1-1.1-2.4-1.2-3.7l2.8-1.5 1.4.4 1.3 3.9zm6 3.9c-1.3.3-2.7.3-4 0l-1-3 1.1-1.1h3.8l1.1 1.1zm0-5.4h-3.9l-1.1-3.7 3.1-2.2 3.1 2.3zm4.1 3.1c-.7.7-1.5 1.3-2.4 1.7l.7-1.9h2c-.1.1-.2.2-.3.2zm-2-1.6-.9-.9 1.3-3.9 1.4-.4 2.8 1.5c-.1 1.3-.5 2.6-1.2 3.7z" />
          </svg>
        );

      case 'assist':
        return (
          // Flashscore Official Assist Symbol (from Flashscore incident pack)
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 text-slate-800 dark:text-zinc-100 fill-current" fill="currentColor">
            <path d="M13.66 9.28c0 .26-.22.48-.48.48H6.9c-.26 0-.48-.22-.48-.48V5.9c0-.28.22-.48.48-.48h6.28c.26 0 .48.2.48.48v3.38zm.281-6.001a.957.957 0 0 0-.68-.279H6.818c-.26 0-.5.1-.68.279L4.28 5.139a.947.947 0 0 0-.28.68v11.082c0 .06.04.099.1.099h2.22c.06 0 .1-.04.1-.1v-4.24c0-.278.22-.48.48-.48h6.28c.26 0 .48.202.48.48v4.24c0 .06.04.1.101.1h2.22c.04 0 .08-.04.08-.1V5.82c0-.26-.1-.5-.282-.68l-1.838-1.86z" />
          </svg>
        );

      case 'yellow_card':
        return (
          // Flashscore Official Chamfered Yellow Card
          <svg viewBox="0 0 13.1 20" className="w-2.5 h-3.5 shadow-2xs">
            <path d="m2.5 0-2.5 2.5v15.1l2.5 2.4h8.2l2.5-2.5v-15l-2.6-2.5z" fill="#ffcd00" stroke="#ca8a04" strokeWidth="0.6" />
          </svg>
        );

      case 'red_card':
        return (
          // Flashscore Official Chamfered Red Card
          <svg viewBox="0 0 13.1 20" className="w-2.5 h-3.5 shadow-2xs">
            <path d="m2.5 0-2.5 2.5v15.1l2.5 2.4h8.2l2.5-2.5v-15l-2.6-2.5z" fill="#dc0000" stroke="#991b1b" strokeWidth="0.6" />
          </svg>
        );

      case 'own_goal':
        return (
          // Flashscore Own Goal: Official Football in Red
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 text-rose-500 fill-current" fill="currentColor">
            <path d="m17 2.9c-3.9-3.9-10.2-3.9-14.1 0s-3.9 10.2 0 14.1c2.5 2.5 6.2 3.5 9.6 2.6s6.1-3.6 7-7c1-3.5 0-7.2-2.5-9.7zm.4 2.8c.6 1.1 1 2.2 1.1 3.4l-1.8-1zm-1.4-1.8c.1.1.3.3.4.4l-1.1 3.6-1.3.4-3.3-2.4v-1.4l3.2-2.2c.7.4 1.5.9 2.1 1.6zm-6-2.5c.8 0 1.6.1 2.3.3l-2.3 1.6-2.3-1.6c.7-.2 1.5-.3 2.3-.3zm-6.1 2.5c.6-.7 1.4-1.2 2.2-1.6l3.2 2.2v1.4l-3.3 2.4-1.4-.4-1.1-3.6c.1-.1.3-.3.4-.4zm-1.4 1.8.7 2.4-1.8 1c.1-1.2.5-2.4 1.1-3.4zm1.4 10.3c-.1-.1-.1-.2-.2-.2h2l.7 1.9c-1-.4-1.8-1-2.5-1.7zm2-1.6h-3.3c-.7-1.1-1.1-2.4-1.2-3.7l2.8-1.5 1.4.4 1.3 3.9zm6 3.9c-1.3.3-2.7.3-4 0l-1-3 1.1-1.1h3.8l1.1 1.1zm0-5.4h-3.9l-1.1-3.7 3.1-2.2 3.1 2.3zm4.1 3.1c-.7.7-1.5 1.3-2.4 1.7l.7-1.9h2c-.1.1-.2.2-.3.2zm-2-1.6-.9-.9 1.3-3.9 1.4-.4 2.8 1.5c-.1 1.3-.5 2.6-1.2 3.7z" />
          </svg>
        );

      case 'pen_missed':
        return (
          // Flashscore Football with Bold Red Cross ✕ extended to badge corners (+20% thickness)
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 overflow-visible" fill="none">
            <path d="m17 2.9c-3.9-3.9-10.2-3.9-14.1 0s-3.9 10.2 0 14.1c2.5 2.5 6.2 3.5 9.6 2.6s6.1-3.6 7-7c1-3.5 0-7.2-2.5-9.7zm.4 2.8c.6 1.1 1 2.2 1.1 3.4l-1.8-1zm-1.4-1.8c.1.1.3.3.4.4l-1.1 3.6-1.3.4-3.3-2.4v-1.4l3.2-2.2c.7.4 1.5.9 2.1 1.6zm-6-2.5c.8 0 1.6.1 2.3.3l-2.3 1.6-2.3-1.6c.7-.2 1.5-.3 2.3-.3zm-6.1 2.5c.6-.7 1.4-1.2 2.2-1.6l3.2 2.2v1.4l-3.3 2.4-1.4-.4-1.1-3.6c.1-.1.3-.3.4-.4zm-1.4 1.8.7 2.4-1.8 1c.1-1.2.5-2.4 1.1-3.4zm1.4 10.3c-.1-.1-.1-.2-.2-.2h2l.7 1.9c-1-.4-1.8-1-2.5-1.7zm2-1.6h-3.3c-.7-1.1-1.1-2.4-1.2-3.7l2.8-1.5 1.4.4 1.3 3.9zm6 3.9c-1.3.3-2.7.3-4 0l-1-3 1.1-1.1h3.8l1.1 1.1zm0-5.4h-3.9l-1.1-3.7 3.1-2.2 3.1 2.3zm4.1 3.1c-.7.7-1.5 1.3-2.4 1.7l.7-1.9h2c-.1.1-.2.2-.3.2zm-2-1.6-.9-.9 1.3-3.9 1.4-.4 2.8 1.5c-.1 1.3-.5 2.6-1.2 3.7z" fill="currentColor" className="text-slate-700 dark:text-zinc-200" />
            <line x1="1.5" y1="1.5" x2="18.5" y2="18.5" stroke="#ef4444" strokeWidth="3.36" strokeLinecap="round" />
            <line x1="18.5" y1="1.5" x2="1.5" y2="18.5" stroke="#ef4444" strokeWidth="3.36" strokeLinecap="round" />
          </svg>
        );

      case 'pen_saved':
        return (
          // Flashscore Football with Bold Green Cross ✕ extended to badge corners (+20% thickness)
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 overflow-visible" fill="none">
            <path d="m17 2.9c-3.9-3.9-10.2-3.9-14.1 0s-3.9 10.2 0 14.1c2.5 2.5 6.2 3.5 9.6 2.6s6.1-3.6 7-7c1-3.5 0-7.2-2.5-9.7zm.4 2.8c.6 1.1 1 2.2 1.1 3.4l-1.8-1zm-1.4-1.8c.1.1.3.3.4.4l-1.1 3.6-1.3.4-3.3-2.4v-1.4l3.2-2.2c.7.4 1.5.9 2.1 1.6zm-6-2.5c.8 0 1.6.1 2.3.3l-2.3 1.6-2.3-1.6c.7-.2 1.5-.3 2.3-.3zm-6.1 2.5c.6-.7 1.4-1.2 2.2-1.6l3.2 2.2v1.4l-3.3 2.4-1.4-.4-1.1-3.6c.1-.1.3-.3.4-.4zm-1.4 1.8.7 2.4-1.8 1c.1-1.2.5-2.4 1.1-3.4zm1.4 10.3c-.1-.1-.1-.2-.2-.2h2l.7 1.9c-1-.4-1.8-1-2.5-1.7zm2-1.6h-3.3c-.7-1.1-1.1-2.4-1.2-3.7l2.8-1.5 1.4.4 1.3 3.9zm6 3.9c-1.3.3-2.7.3-4 0l-1-3 1.1-1.1h3.8l1.1 1.1zm0-5.4h-3.9l-1.1-3.7 3.1-2.2 3.1 2.3zm4.1 3.1c-.7.7-1.5 1.3-2.4 1.7l.7-1.9h2c-.1.1-.2.2-.3.2zm-2-1.6-.9-.9 1.3-3.9 1.4-.4 2.8 1.5c-.1 1.3-.5 2.6-1.2 3.7z" fill="currentColor" className="text-slate-700 dark:text-zinc-200" />
            <line x1="1.5" y1="1.5" x2="18.5" y2="18.5" stroke="#10b981" strokeWidth="3.36" strokeLinecap="round" />
            <line x1="18.5" y1="1.5" x2="1.5" y2="18.5" stroke="#10b981" strokeWidth="3.36" strokeLinecap="round" />
          </svg>
        );

      case 'def_con':
        return (
          // Defensive Contribution Crest without checklist
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none">
            <path
              d="M10 2 L17 5 v5 c0 4.5 -3 8 -7 9 c-4 -1 -7 -4.5 -7 -9 v-5 Z"
              fill="#065f46"
              stroke="#34d399"
              strokeWidth="1.2"
            />
          </svg>
        );

      case 'bonus': {
        const bonusVal = bonusRank === 1 ? '3' : bonusRank === 2 ? '2' : bonusRank === 3 ? '1' : (count > 0 && count <= 3 ? String(count) : '3');
        return (
          // Bonus Points: Display clean number 1/2/3 matching assist 'A' size, bold dark font on cyan background
          <span className="text-[11px] sm:text-xs font-black text-slate-950 leading-none select-none flex items-center justify-center">
            {bonusVal}
          </span>
        );
      }

      case 'sub':
        return (
          // Flashscore Official Substitution: Dual Curved Circular Arrows
          <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none">
            <path d="M18.7371,4.2131 L17.4301,7.3681 C16.3871,4.2251 13.4281,2.0001 9.9991,2.0001 C6.6971,2.0001 3.7311,4.0861 2.6181,7.1931 L3.9041,7.6531 C4.8241,5.0891 7.2731,3.3671 9.9991,3.3671 C12.8881,3.3671 15.3741,5.2781 16.1851,7.9591 L12.9381,6.6151 L12.4161,7.8771 L17.7791,10.0981 L20.0001,4.7361 L18.7371,4.2131 Z" fill="#DC0000" />
            <path d="M10.0022,16.3088 C7.1122,16.3088 4.6262,14.3968 3.8152,11.7168 L7.0622,13.0628 L7.5852,11.7998 L2.2222,9.5788 L2.2212,9.5788 L1.9022,10.3488 L1.6982,10.8398 L1.6992,10.8398 L0.0002,14.9418 L1.2622,15.4648 L2.5702,12.3088 C3.6132,15.4528 6.5722,17.6758 10.0022,17.6758 C13.3032,17.6758 16.2692,15.5888 17.3812,12.4828 L16.0952,12.0228 C15.1762,14.5858 12.7282,16.3088 10.0022,16.3088" fill="#14DC4B" />
          </svg>
        );

      default:
        return null;
    }
  };

  const titleText =
    type === 'goal' ? `Goal (${count})` :
    type === 'assist' ? `Assist (${count})` :
    type === 'yellow_card' ? `Yellow Card (${count})` :
    type === 'red_card' ? 'Red Card' :
    type === 'own_goal' ? `Own Goal (${count})` :
    type === 'pen_missed' ? 'Penalty Missed' :
    type === 'pen_saved' ? 'Penalty Saved' :
    type === 'def_con' ? 'Defensive Contribution' :
    type === 'bonus' ? `Bonus Points (${bonusRank === 1 ? 3 : bonusRank === 2 ? 2 : 1} pts)` :
    'Substitution';

  return (
    <div
      title={titleText}
      className={`relative shrink-0 w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-[2px] border flex items-center justify-center select-none ${
        type === 'bonus'
          ? 'bg-cyan-400 dark:bg-cyan-400 border-cyan-500 dark:border-cyan-300 shadow-2xs'
          : 'bg-transparent border-slate-300 dark:border-zinc-700/80'
      }`}
    >
      {renderIconContent()}
      {/* Superscript counter badge at top-right corner if event count >= 2 */}
      {count >= 2 && (
        <span
          className="absolute -top-1 -right-1 bg-slate-700 dark:bg-zinc-700 border border-slate-600 dark:border-zinc-500 text-white text-[7.5px] font-bold rounded-[2px] px-0.5 leading-none shadow-xs select-none z-10 min-w-[9px] text-center"
        >
          {count}
        </span>
      )}
    </div>
  );
});

const POSITION_ORDER: Record<string, number> = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4
};

// Priority ordering for starting XI players (sub at the end)
const EVENT_ORDER_STARTER: Record<string, number> = {
  goal: 1,
  assist: 2,
  yellow_card: 3,
  red_card: 4,
  own_goal: 5,
  pen_missed: 6,
  pen_saved: 7,
  def_con: 8,
  bonus: 9,
  sub: 10,
};

// Priority ordering for bench substitutes (substitution badge first in order)
const EVENT_ORDER_BENCH: Record<string, number> = {
  sub: 1,
  goal: 2,
  assist: 3,
  yellow_card: 4,
  red_card: 5,
  own_goal: 6,
  pen_missed: 7,
  pen_saved: 8,
  def_con: 9,
  bonus: 10,
};

const sortPlayersByPosition = (players: MatchPlayerItem[]): MatchPlayerItem[] => {
  return [...players].sort((a, b) => {
    const pA = POSITION_ORDER[a.position] || 99;
    const pB = POSITION_ORDER[b.position] || 99;
    return pA - pB;
  });
};

export const TabMatches: React.FC<TabMatchesProps> = ({
  currentGW = 1,
  availableGWs = [1],
  lastSynced,
  isMatchLive = false,
  isAppVisible = true,
  ownershipPlayers = {},
  transfers = [],
  onSelectPlayer,
}) => {
  const [activeGW, setActiveGW] = useState<number>(currentGW);
  const [matches, setMatches] = useState<MatchCardItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeMetric, setActiveMetric] = useState<MatchStatMetric>('pts');

  // Memoized FNB League TSB (Ownership %) & Net Transfers for activeGW (identik dengan modal pemain)
  const fnbMetricsMap = useMemo(() => {
    const tsbMap = new Map<number, string>();
    const ntMap = new Map<number, string>();

    // 1. Teams Selected By (FNB League Ownership %) in activeGW
    const currentOwnershipList = ownershipPlayers?.[activeGW] || [];
    for (const p of currentOwnershipList) {
      if (p && p.id) {
        tsbMap.set(p.id, `${p.owned_percentage.toFixed(1)}%`);
      }
    }

    // 2. Net Transfers in FNB League for activeGW
    if (Array.isArray(transfers) && transfers.length > 0) {
      const netCountMap = new Map<number, number>();
      for (const t of transfers) {
        if (t.event === activeGW) {
          if (t.element_in?.id) {
            const id = t.element_in.id;
            netCountMap.set(id, (netCountMap.get(id) || 0) + 1);
          }
          if (t.element_out?.id) {
            const id = t.element_out.id;
            netCountMap.set(id, (netCountMap.get(id) || 0) - 1);
          }
        }
      }
      for (const [id, count] of netCountMap.entries()) {
        ntMap.set(id, count > 0 ? `+${count}` : `${count}`);
      }
    }

    return { tsbMap, ntMap };
  }, [ownershipPlayers, transfers, activeGW]);

  // Expanded panel state: set of match IDs currently expanded (default: collapsed all)
  const [expandedMatchIds, setExpandedMatchIds] = useState<Set<number>>(new Set());

  // Active breakdown popover: playerId_matchId
  const [activeBreakdownKey, setActiveBreakdownKey] = useState<string | null>(null);

  const isFetchingRef = useRef<boolean>(false);

  // Dynamic header offset measurement for sticky dropdown
  const [headerHeight, setHeaderHeight] = useState<number>(() => {
    const headerEl = typeof document !== 'undefined' ? document.querySelector('header') : null;
    return headerEl ? headerEl.offsetHeight : 94;
  });

  useEffect(() => {
    const headerEl = document.querySelector('header');
    if (!headerEl) return;

    const updateHeaderHeight = () => {
      setHeaderHeight(headerEl.offsetHeight);
    };

    updateHeaderHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    resizeObserver.observe(headerEl);

    window.addEventListener('resize', updateHeaderHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // Sync activeGW when currentGW prop updates
  useEffect(() => {
    if (currentGW && !availableGWs.includes(activeGW)) {
      setActiveGW(currentGW);
    }
  }, [currentGW, availableGWs]);

  // Fetch matches for activeGW with silent revalidation support (no UI flash, no state reset)
  const fetchMatches = useCallback(async (gw: number, silent: boolean = false, force: boolean = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const forceQuery = force ? '&force=1' : '';
      const res = await fetch(`/api/fpl-matches/${gw}?_t=${Date.now()}${forceQuery}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setMatches(json.data);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch matches for GW', gw, e);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  // GW Change: Load matches with initial loader and reset breakdown
  useEffect(() => {
    fetchMatches(activeGW, false, false);
    setActiveBreakdownKey(null);
  }, [activeGW, fetchMatches]);

  // Reactive Sync Trigger: When lastSynced changes (sync completed in background or manual sync),
  // automatically re-fetch the matches silently and update all match elements without page reload
  const isFirstMountRef = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    console.log('[TabMatches] lastSynced changed. Silently updating matchday elements with fresh sync data...');
    fetchMatches(activeGW, true, true);
  }, [lastSynced, activeGW, fetchMatches]);

  // Detect if any match in currently viewed GW is in-play (started and not full time)
  const hasLiveMatchInCurrentView = useMemo(() => {
    return matches.some((m) => m.started && !m.finished && !m.finished_provisional);
  }, [matches]);

  const isCurrentGwLive = Boolean(isMatchLive || hasLiveMatchInCurrentView);

  // Fast auto-update during live matches: 15 seconds cadence while tab is visible
  useEffect(() => {
    if (!isCurrentGwLive || isAppVisible === false) return;

    console.log(`[TabMatches] Live Matchday auto-poll active (15s cadence for GW ${activeGW})...`);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMatches(activeGW, true, false);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [isCurrentGwLive, isAppVisible, activeGW, fetchMatches]);

  // Window Focus & Visibility Change catch-up: silent refresh when user returns to window/tab
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && isCurrentGwLive) {
        fetchMatches(activeGW, true, false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [isCurrentGwLive, activeGW, fetchMatches]);

  // Click outside breakdown card to dismiss active breakdown
  useEffect(() => {
    if (!activeBreakdownKey) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-breakdown-card]')) {
        setActiveBreakdownKey(null);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [activeBreakdownKey]);

  // GW Navigation helpers
  const sortedGWs = useMemo(() => {
    const list = [...availableGWs];
    if (!list.includes(activeGW)) list.push(activeGW);
    return Array.from(new Set(list)).sort((a, b) => a - b);
  }, [availableGWs, activeGW]);

  const activeIndex = sortedGWs.indexOf(activeGW);
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < sortedGWs.length - 1;

  const handlePrevGW = () => {
    if (canGoPrev) setActiveGW(sortedGWs[activeIndex - 1]);
  };

  const handleNextGW = () => {
    if (canGoNext) setActiveGW(sortedGWs[activeIndex + 1]);
  };

  // Compute Gameweek Date Range: hari tanggal dan singkatan bulan pertandingan awal - akhir
  const gwDateRange = useMemo(() => {
    if (!matches || matches.length === 0) return '';
    const validTimes = matches
      .map((m) => new Date(m.kickoff_time).getTime())
      .filter((t) => !isNaN(t) && t > 0);
    if (validTimes.length === 0) return '';

    const minTime = Math.min(...validTimes);
    const maxTime = Math.max(...validTimes);
    const d1 = new Date(minTime);
    const d2 = new Date(maxTime);

    const formatPart = (d: Date) => {
      const dayName = d.toLocaleDateString('id-ID', { weekday: 'short', timeZone: 'Asia/Jakarta' });
      const dayNum = d.toLocaleDateString('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' });
      const mon = d.toLocaleDateString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' });
      return `${dayName}, ${dayNum} ${mon}`;
    };

    const s1 = formatPart(d1);
    const s2 = formatPart(d2);

    return s1 === s2 ? s1 : `${s1} - ${s2}`;
  }, [matches]);

  const toggleExpand = (matchId: number) => {
    setExpandedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  };

  // Check if all matches in active GW are expanded
  const isAllExpanded = useMemo(() => {
    if (matches.length === 0) return false;
    return matches.every((m) => expandedMatchIds.has(m.id));
  }, [matches, expandedMatchIds]);

  // Toggle expand / collapse all matches
  const handleToggleExpandAll = useCallback(() => {
    if (isAllExpanded) {
      setExpandedMatchIds(new Set());
    } else {
      setExpandedMatchIds(new Set(matches.map((m) => m.id)));
    }
  }, [isAllExpanded, matches]);

  /**
   * Helper to format value shown inside the capsule based on selected metric
   * Values match the exact formatting of the GW column in PlayerDetailModal.tsx
   */
  const formatMetricValue = (player: MatchPlayerItem, metric: MatchStatMetric): string => {
    const st = player.stats;
    switch (metric) {
      case 'pts':
      case 'points':
        return String(player.gw_points ?? 0);
      case 'st':
        return String(st.starts !== undefined ? st.starts : 0);
      case 'mp':
      case 'minutes':
        return `${st.minutes ?? 0}'`;
      case 'gs':
      case 'goals_scored':
        return String(st.goals_scored ?? 0);
      case 'a':
      case 'assists':
        return String(st.assists ?? 0);
      case 'xg':
        return (st.expected_goals ?? 0).toFixed(2);
      case 'xa':
        return (st.expected_assists ?? 0).toFixed(2);
      case 'xgi':
        return (st.expected_goal_involvements ?? 0).toFixed(2);
      case 'cs':
      case 'clean_sheets':
        return String(st.clean_sheets ?? 0);
      case 'gc':
      case 'goals_conceded':
        return String(st.goals_conceded ?? 0);
      case 'xgc':
        return (st.expected_goals_conceded ?? 0).toFixed(2);
      case 't':
        return String(st.tackles ?? 0);
      case 'cbi':
        return String(st.clearances_blocks_interceptions ?? 0);
      case 'r':
        return String(st.recoveries ?? 0);
      case 'dc':
      case 'defensive_contribution':
        return String(st.defensive_contribution ?? 0);
      case 'og':
      case 'own_goals':
        return String(st.own_goals ?? 0);
      case 'ps':
      case 'penalties_saved':
        return String(st.penalties_saved ?? 0);
      case 'pm':
      case 'penalties_missed':
        return String(st.penalties_missed ?? 0);
      case 'yc':
      case 'yellow_cards':
        return String(st.yellow_cards ?? 0);
      case 'rc':
      case 'red_cards':
        return String(st.red_cards ?? 0);
      case 's':
      case 'saves':
        return String(st.saves ?? 0);
      case 'bp':
      case 'bonus':
        return String(st.bonus ?? 0);
      case 'bps':
        return String(st.bps ?? 0);
      case 'inf':
        return (st.influence ?? 0).toFixed(1);
      case 'cre':
        return (st.creativity ?? 0).toFixed(1);
      case 'thr':
        return (st.threat ?? 0).toFixed(1);
      case 'ii':
        return (st.ict_index ?? 0).toFixed(1);
      case 'nt': {
        return fnbMetricsMap.ntMap.get(player.id) ?? '0';
      }
      case 'tsb': {
        return fnbMetricsMap.tsbMap.get(player.id) ?? '0.0%';
      }
      case 'cost': {
        const val = st.price ?? ((player.now_cost ?? 0) / 10);
        return `£${val.toFixed(1)}m`;
      }
      default:
        return String(player.gw_points ?? 0);
    }
  };

  /**
   * Renders a player row (Home or Away side)
   */
  const renderPlayerRow = (
    player: MatchPlayerItem,
    isHome: boolean,
    matchId: number,
    matchStatusStyle: 'upcoming' | 'live' | 'ft',
    isBench: boolean = false
  ) => {
    const capsuleVal = formatMetricValue(player, activeMetric);
    const breakdownKey = `${player.id}_${matchId}`;
    const isBreakdownOpen = activeBreakdownKey === breakdownKey;

    const capsuleColor =
      matchStatusStyle === 'live'
        ? 'bg-[#e90052] text-white border-rose-600 shadow-sm'
        : matchStatusStyle === 'ft'
        ? 'bg-[#00ff87] text-[#200024] border-[#00c968] font-black'
        : 'bg-slate-100 dark:bg-purple-950/70 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-purple-800/60 font-bold';

    const breakdownItems = buildPlayerBreakdownItems(player);

    // Sort event badges: for bench substitutes, 'sub' is displayed in 1st priority; for starters, normal priority
    const orderMap = isBench ? EVENT_ORDER_BENCH : EVENT_ORDER_STARTER;
    const orderedEvents = [...player.events].sort((a, b) => {
      const ordA = orderMap[a.type] || 99;
      const ordB = orderMap[b.type] || 99;
      return ordA - ordB;
    });

    return (
      <div
        key={player.id}
        data-breakdown-card={breakdownKey}
        className="relative flex items-center justify-between py-0.5 px-[3px] hover:bg-slate-100/60 dark:hover:bg-purple-900/20 rounded transition-colors text-xs"
      >
        {/* Breakdown Popover */}
        {isBreakdownOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute bottom-full mb-1.5 w-[140px] sm:w-[160px] bg-[#1a0528]/95 dark:bg-[#12001a]/98 backdrop-blur-md rounded shadow-2xl py-2 px-1 z-50 border border-purple-500/40 text-slate-100 ${
              isHome ? 'left-0' : 'right-0'
            }`}
          >
            <div className="flex items-center justify-between border-b border-purple-500/30 pb-1 mb-1.5">
              <span className="font-bold text-[11px] text-white truncate">{player.web_name}</span>
              <span className="font-black text-[11px] text-[#00ff87] font-mono">{player.gw_points} pts</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1 gap-y-1 text-[10px] font-mono leading-tight">
              {breakdownItems.map((item, idx, arr) => {
                const isLast = idx === arr.length - 1;
                const borderClass = isLast ? '' : 'border-b border-purple-900/30 pb-[1.5px]';
                return (
                  <React.Fragment key={item.code}>
                    <span className={`text-left font-black text-[#00ff87] min-w-[2ch] ${borderClass}`}>
                      {item.code}
                    </span>
                    <span className={`text-right font-bold text-slate-200 ${borderClass}`}>
                      {item.value}
                    </span>
                    <span
                      className={`text-right font-black min-w-[2.5ch] ${borderClass} ${
                        item.code === 'MP' && item.value === 0 && item.points === 0
                          ? 'invisible'
                          : item.points > 0
                          ? 'text-[#00ff87]'
                          : item.points < 0
                          ? 'text-rose-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {item.points > 0 ? `+${item.points}` : item.points}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* HOME ROW: [Capsule]  [Name + Badges...] */}
        {isHome ? (
          <div className="flex items-center gap-[3px] min-w-0 w-full">
            {/* Uniform Fixed-Width Capsule */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveBreakdownKey((prev) => (prev === breakdownKey ? null : breakdownKey));
              }}
              title="Click for points breakdown"
              className={`shrink-0 min-w-[30px] sm:min-w-[34px] px-0.5 h-5 rounded-[3px] border flex items-center justify-center font-mono text-[10px] sm:text-[10.5px] leading-none transition-transform active:scale-95 cursor-pointer ${capsuleColor}`}
            >
              {capsuleVal}
            </button>

            {/* Player Name & Attached Badges */}
            <div className="flex items-center gap-0.5 min-w-0">
              <button
                type="button"
                onClick={() => onSelectPlayer && onSelectPlayer(player.id, activeGW)}
                title={player.full_name}
                className="font-bold text-slate-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-[#00ff87] text-[11px] sm:text-xs truncate max-w-[85px] sm:max-w-[130px] text-left transition-colors cursor-pointer leading-none"
              >
                {player.web_name}
              </button>

              {/* Match Event Icons (attached to player name with gap-0.5) */}
              {orderedEvents.length > 0 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {orderedEvents.map((ev, i) => (
                    <MatchEventBadgeIcon key={`${ev.type}_${i}`} event={ev} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* AWAY ROW: [Badges... + Name]  [Capsule] */
          <div className="flex items-center gap-[3px] min-w-0 w-full justify-end">
            {/* Attached Badges & Player Name */}
            <div className="flex items-center gap-0.5 min-w-0 justify-end ml-auto">
              {/* Match Event Icons (rendered from right to left so 1st priority badge is nearest to name) */}
              {orderedEvents.length > 0 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {[...orderedEvents].reverse().map((ev, i) => (
                    <MatchEventBadgeIcon key={`${ev.type}_${i}`} event={ev} />
                  ))}
                </div>
              )}

              {/* Player Name */}
              <button
                type="button"
                onClick={() => onSelectPlayer && onSelectPlayer(player.id, activeGW)}
                title={player.full_name}
                className="font-bold text-slate-800 dark:text-slate-100 hover:text-purple-600 dark:hover:text-[#00ff87] text-[11px] sm:text-xs truncate max-w-[85px] sm:max-w-[130px] text-right transition-colors cursor-pointer leading-none"
              >
                {player.web_name}
              </button>
            </div>

            {/* Uniform Fixed-Width Capsule */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveBreakdownKey((prev) => (prev === breakdownKey ? null : breakdownKey));
              }}
              title="Click for points breakdown"
              className={`shrink-0 min-w-[30px] sm:min-w-[34px] px-0.5 h-5 rounded-[3px] border flex items-center justify-center font-mono text-[10px] sm:text-[10.5px] leading-none transition-transform active:scale-95 cursor-pointer ${capsuleColor}`}
            >
              {capsuleVal}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto pb-8">
      {/* ================= TOP CONTROLS: GW NAV & STATS SELECTOR ================= */}
      {/* Row 1: GW Navigator Header with < [GW Text + Date Range] > */}
      <div className="w-full flex items-center justify-between select-none relative px-1 py-0.5 mb-2">
        {/* Tombol < di ujung sekali kiri, persis seperti modal tim */}
        <button
          type="button"
          onClick={handlePrevGW}
          disabled={!canGoPrev}
          className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 hover:bg-slate-700 dark:hover:bg-purple-900 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center transition-all cursor-pointer disabled:opacity-20 disabled:pointer-events-none active:scale-95"
          title={canGoPrev ? `Lompat ke GW ${sortedGWs[activeIndex - 1]}` : undefined}
          aria-label="Previous Gameweek"
        >
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
        </button>

        {/* Center: Nomor GW dan Range Waktu di bawahnya. Klik memunculkan filter GW yang sama persis */}
        <div className="flex-1 flex items-center justify-center min-w-0 px-2">
          <CustomPopoverSelect
            id="matches-gw-filter"
            value={activeGW}
            onChange={(val) => setActiveGW(Number(val))}
            align="center"
            hideChevron={true}
            className="cursor-pointer group focus:outline-none transition-colors border-0 bg-transparent shadow-none p-0"
            options={sortedGWs.map((gw) => ({
              value: gw,
              label: `GW ${gw}`,
              sublabel: gw === currentGW ? 'Current' : undefined
            }))}
            customTrigger={() => (
              <div className="flex flex-col items-center justify-center text-center cursor-pointer select-none group">
                <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight leading-tight group-hover:text-purple-600 dark:group-hover:text-[#00ff87] transition-colors">
                  Gameweek {activeGW}
                </span>
                <span className="text-[10.5px] sm:text-xs font-semibold text-slate-500 dark:text-purple-300/80 leading-tight mt-0.5 group-hover:text-purple-600 dark:group-hover:text-purple-200 transition-colors">
                  {gwDateRange || (isLoading ? 'Memuat tanggal...' : `GW ${activeGW}`)}
                </span>
              </div>
            )}
          />
        </div>

        {/* Tombol > di ujung sekali kanan, persis seperti modal tim */}
        <button
          type="button"
          onClick={handleNextGW}
          disabled={!canGoNext}
          className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-800/85 dark:bg-purple-950/85 hover:bg-slate-700 dark:hover:bg-purple-900 border border-slate-600/70 dark:border-purple-600/70 text-white shadow-md flex items-center justify-center transition-all cursor-pointer disabled:opacity-20 disabled:pointer-events-none active:scale-95"
          title={canGoNext ? `Lompat ke GW ${sortedGWs[activeIndex + 1]}` : undefined}
          aria-label="Next Gameweek"
        >
          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
        </button>
      </div>

      {/* Row 2: Dropdown Statistics melayang sendiri tanpa panel latar belakang */}
      <div
        style={{ top: `${headerHeight + 6}px` }}
        className="sticky z-30 pointer-events-none w-fit mb-[-32px]"
      >
        <div className="pointer-events-auto flex">
          <CustomPopoverSelect
            id="matches-metric-filter"
            value={activeMetric}
            onChange={(val) => setActiveMetric(val as MatchStatMetric)}
            searchable={false}
            className="h-8 bg-white dark:bg-[#1a0c2c] border border-slate-300 dark:border-purple-800/80 hover:border-purple-600 dark:hover:border-[#00ff87] rounded-lg text-xs font-bold text-slate-900 dark:text-white px-2.5 shadow-md hover:shadow-lg flex items-center justify-between gap-1.5 cursor-pointer focus:outline-none transition-all max-w-[200px] sm:max-w-[260px]"
            options={MATCH_METRIC_OPTIONS.map((m) => ({
              value: m.value,
              label: m.label
            }))}
          />
        </div>
      </div>

      {/* Row 2: Expand / Collapse All (TIDAK melayang / non-sticky, sejajar rapat kanan, jarak vertikal ke panel match pertama = 20px via mb-5) */}
      <div className="flex items-center justify-end h-8 mb-5">
        <button
          type="button"
          onClick={handleToggleExpandAll}
          className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg bg-white dark:bg-[#1a0c2c] hover:bg-slate-100 dark:hover:bg-purple-950/70 border border-slate-300 dark:border-purple-800/60 text-xs font-bold text-slate-800 dark:text-purple-200 transition-all cursor-pointer shadow-2xs select-none active:scale-95 ml-auto"
          title={isAllExpanded ? "Tutup semua pertandingan" : "Buka semua pertandingan"}
        >
          {isAllExpanded ? (
            <>
              <span>Collapse All</span>
              <ChevronUp className="w-3.5 h-3.5 stroke-[2.5] text-purple-600 dark:text-[#00ff87]" />
            </>
          ) : (
            <>
              <span>Expand All</span>
              <ChevronDown className="w-3.5 h-3.5 stroke-[2.5] text-purple-600 dark:text-[#00ff87]" />
            </>
          )}
        </button>
      </div>

      {/* ================= MATCHES LIST CONTAINER ================= */}
      {isLoading ? (
        <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl p-8 flex flex-col items-center justify-center gap-2 shadow-2xs">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600 dark:text-[#00ff87]" />
          <span className="text-xs font-bold text-slate-500 dark:text-purple-300/80">
            Loading GW {activeGW} Matches...
          </span>
        </div>
      ) : matches.length === 0 ? (
        <div className="bg-white dark:bg-[#1a0c2c] border border-slate-200 dark:border-purple-900/60 rounded-xl p-8 text-center text-xs text-slate-500 dark:text-slate-400 font-semibold">
          No matches found for Gameweek {activeGW}.
        </div>
      ) : (
        <div className="space-y-5 sm:space-y-6">
          {matches.map((m) => {
            const isExpanded = expandedMatchIds.has(m.id);
            const isFt = Boolean(m.finished || m.finished_provisional);
            const isLive = Boolean(m.started && !isFt);
            const matchStatusStyle: 'upcoming' | 'live' | 'ft' = isFt ? 'ft' : isLive ? 'live' : 'upcoming';

            const kickoffIndo1Line = formatMatchKickoffWIB(m.kickoff_time);

            const scoreText = (m.team_h_score !== null && m.team_a_score !== null)
              ? `${m.team_h_score} - ${m.team_a_score}`
              : 'vs';

            const scoreColor = isFt
              ? 'text-slate-900 dark:text-white'
              : isLive
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-400 dark:text-slate-500';

            return (
              <div
                key={m.id}
                className="bg-white dark:bg-[#1a0c2c] border border-slate-200/90 dark:border-purple-900/60 rounded-xl overflow-hidden shadow-md transition-shadow hover:shadow-lg"
              >
                {/* MATCH CARD HEADER */}
                {/* MATCH CARD HEADER (Entire container is clickable to toggle expand/collapse) */}
                <div
                  onClick={() => toggleExpand(m.id)}
                  className="p-2 sm:p-2.5 relative cursor-pointer select-none bg-white dark:bg-[#1a0c2c] hover:bg-slate-50/80 dark:hover:bg-purple-950/20 min-h-[70px] sm:min-h-[74px] flex flex-col justify-center transition-colors border-b border-slate-100 dark:border-purple-900/40"
                >
                  {/* Top Line: Date & Time in Indonesian 1-line */}
                  <div className="text-center mb-1 leading-none">
                    <span className="text-[9.5px] sm:text-[11px] font-medium text-slate-500 dark:text-purple-300/80 tracking-tight whitespace-nowrap leading-none">
                      {kickoffIndo1Line}
                    </span>
                  </div>

                  {/* Main Row: [Home Name] <gap> [Home Logo] <gap> [Score] <gap> [Away Logo] <gap> [Away Name] */}
                  {/* Seluruh item vertikalnya middle secara vektor */}
                  <div className="flex items-center justify-center gap-2 sm:gap-2.5 w-full my-0.5">
                    
                    {/* HOME TEAM (Left, text right-aligned) */}
                    <div className="flex-1 flex items-center justify-end min-w-0">
                      <span className="font-black text-xs sm:text-sm text-slate-900 dark:text-white tracking-tight truncate text-right leading-none self-center">
                        {m.home_team.name}
                      </span>
                    </div>

                    {/* Home Club Logo */}
                    <div className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 flex items-center justify-center self-center">
                      <img
                        src={m.home_team.badge_url}
                        alt={m.home_team.short_name}
                        className="w-full h-full object-contain filter drop-shadow select-none self-center"
                        onError={(e) => {
                          e.currentTarget.src = '/default_team_badge.png';
                        }}
                      />
                    </div>

                    {/* Center Score: Horizontally & vertically aligned on the same row with equal distance */}
                    <div className="shrink-0 flex items-center justify-center min-w-[44px] sm:min-w-[54px] text-center self-center">
                      <span className={`text-base sm:text-lg font-black tracking-wider leading-none font-sans self-center ${scoreColor}`}>
                        {scoreText}
                      </span>
                    </div>

                    {/* Away Club Logo */}
                    <div className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 flex items-center justify-center self-center">
                      <img
                        src={m.away_team.badge_url}
                        alt={m.away_team.short_name}
                        className="w-full h-full object-contain filter drop-shadow select-none self-center"
                        onError={(e) => {
                          e.currentTarget.src = '/default_team_badge.png';
                        }}
                      />
                    </div>

                    {/* AWAY TEAM (Right, text left-aligned) */}
                    <div className="flex-1 flex items-center justify-start min-w-0">
                      <span className="font-black text-xs sm:text-sm text-slate-900 dark:text-white tracking-tight truncate text-left leading-none self-center">
                        {m.away_team.name}
                      </span>
                    </div>

                  </div>

                  {/* Bottom Line: Match Status Proper Text: "Upcoming" / [menit pertandingan] / "Full Time" */}
                  <div className="text-center mt-1 flex items-center justify-center leading-none">
                    {isLive ? (
                      <span className="text-[10px] sm:text-[11px] font-black text-rose-600 dark:text-rose-400 flex items-center gap-1 justify-center leading-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                        <span>{m.minutes >= 90 ? "90+'" : m.minutes > 0 ? `${m.minutes}'` : "1'"}</span>
                      </span>
                    ) : isFt ? (
                      <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-300 leading-none">
                        Full Time
                      </span>
                    ) : (
                      <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 dark:text-slate-400 leading-none">
                        Upcoming
                      </span>
                    )}
                  </div>

                  {/* EXPAND/COLLAPSE CHEVRON INDICATOR (at bottom-right corner of card) */}
                  <div
                    className="absolute bottom-1 right-1.5 p-1 text-slate-400 dark:text-purple-300/70 select-none pointer-events-none"
                    title={isExpanded ? 'Collapse match lineup' : 'Expand match lineup'}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 stroke-[2.5]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 stroke-[2.5]" />
                    )}
                  </div>
                </div>

                {/* EXPANDED LINEUP & BENCH SECTION */}
                {isExpanded && (
                  <div className="bg-white dark:bg-[#1a0c2c] py-2 sm:py-2.5 px-1 sm:px-1.5 animate-in fade-in duration-100">
                    {!m.has_lineup ? (
                      <div className="py-4 px-2 text-center text-xs sm:text-sm text-slate-500 dark:text-purple-300/80 font-medium leading-snug [text-wrap:balance] max-w-sm sm:max-w-md mx-auto">
                        Official line-up will be announced
                        <span className="block sm:inline"> ~60 minutes before kickoff</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* 1. STARTING LINEUPS (Proper text centered horizontally) */}
                        <div>
                          <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500 dark:text-purple-300/80 mb-1 px-1 border-b border-slate-100 dark:border-purple-900/30 pb-0.5 text-center">
                            Starting Lineups
                          </div>

                          <div className="grid grid-cols-2 gap-y-1 sm:gap-y-2 gap-x-0">
                            {/* Home Starting XI */}
                            <div className="space-y-[1px] border-r border-slate-200 dark:border-purple-900/40 pr-0.5 sm:pr-1">
                              {sortPlayersByPosition(m.home_lineup).map((pl) =>
                                renderPlayerRow(pl, true, m.id, matchStatusStyle, false)
                              )}
                            </div>

                            {/* Away Starting XI */}
                            <div className="space-y-[1px] pl-0.5 sm:pl-1">
                              {sortPlayersByPosition(m.away_lineup).map((pl) =>
                                renderPlayerRow(pl, false, m.id, matchStatusStyle, false)
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 2. SUBSTITUTES (Proper text centered horizontally) */}
                        {(m.home_bench.length > 0 || m.away_bench.length > 0) && (
                          <div className="pt-1.5 border-t border-slate-100 dark:border-purple-900/30">
                            <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500 dark:text-purple-300/80 mb-1 px-1 border-b border-slate-100 dark:border-purple-900/30 pb-0.5 text-center">
                              Substitutes
                            </div>

                            <div className="grid grid-cols-2 gap-y-1 sm:gap-y-2 gap-x-0">
                              {/* Home Bench */}
                              <div className="space-y-[1px] border-r border-slate-200 dark:border-purple-900/40 pr-0.5 sm:pr-1">
                                {sortPlayersByPosition(m.home_bench).map((pl) =>
                                  renderPlayerRow(pl, true, m.id, matchStatusStyle, true)
                                )}
                              </div>

                              {/* Away Bench */}
                              <div className="space-y-[1px] pl-0.5 sm:pl-1">
                                {sortPlayersByPosition(m.away_bench).map((pl) =>
                                  renderPlayerRow(pl, false, m.id, matchStatusStyle, true)
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
