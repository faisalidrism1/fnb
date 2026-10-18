import React, { useRef, useEffect } from 'react';
import {
  MainTab,
  StandingsSubTab,
  OwnershipSubTab,
  TransferSubTab,
  CaptainSubTab,
  GwEventStatus,
  SyncStatus,
} from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';
import { getGameweekStatus } from '../utils/gwStatus.ts';

const defaultLogoImage = '/logo.png';

interface HeaderProps {
  activeTab?: MainTab;
  onSelectTab?: (tab: MainTab) => void;
  syncStatus?: SyncStatus | any;
  isSyncing?: boolean;
  onManualSync?: () => void;
  currentGW?: number;
  availableGWs?: number[];
  selectedGW?: number;
  onSelectGW?: (gw: number) => void;
  gwStatus?: GwEventStatus;
  eventsStatus?: Record<number, GwEventStatus>;
  // Sub-tabs props
  standingsSubTab?: StandingsSubTab;
  onSelectStandingsSubTab?: (sub: StandingsSubTab) => void;
  ownershipSubTab?: OwnershipSubTab;
  onSelectOwnershipSubTab?: (sub: OwnershipSubTab) => void;
  transferSubTab?: TransferSubTab;
  onSelectTransferSubTab?: (sub: TransferSubTab) => void;
  captainSubTab?: CaptainSubTab;
  onSelectCaptainSubTab?: (sub: CaptainSubTab) => void;
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'STANDINGS', label: 'STANDINGS' },
  { id: 'MATCHES', label: 'MATCHES' },
  { id: 'OWNERSHIP', label: 'OWNERSHIP' },
  { id: 'TRANSFER', label: 'TRANSFER' },
  { id: 'CAPTAIN', label: 'CAPTAIN' },
  { id: 'CHIPS', label: 'CHIPS' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab = 'STANDINGS',
  onSelectTab,
  syncStatus,
  currentGW,
  availableGWs,
  gwStatus,
  eventsStatus,
  standingsSubTab = 'live-table',
  onSelectStandingsSubTab,
  ownershipSubTab = 'most-owned-players',
  onSelectOwnershipSubTab,
  transferSubTab = 'all-transfers',
  onSelectTransferSubTab,
  captainSubTab = 'most-captained-player',
  onSelectCaptainSubTab,
}) => {
  const navRef = useRef<HTMLElement>(null);
  const subNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!navRef.current) return;
    const activeBtn = navRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(navRef.current, activeBtn);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!subNavRef.current) return;
    const activeBtn = subNavRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(subNavRef.current, activeBtn);
    }
  }, [activeTab, standingsSubTab, ownershipSubTab, transferSubTab, captainSubTab]);

  // Determine current active Gameweek status (Not Started, Live, Provisional, Confirmed)
  const effectiveGW = currentGW || 1;
  const activeGwStatusObj = eventsStatus?.[effectiveGW] || gwStatus;
  const { status: activeGwLifecycleStatus, isLiveOrProvisional } = getGameweekStatus(
    effectiveGW,
    effectiveGW,
    activeGwStatusObj,
    syncStatus
  );

  // If status is Live or Provisional -> "Live League Table" with pulsing red dot
  // If status is Confirmed or Not Started -> "League Table" without red dot
  const isTableLive = isLiveOrProvisional || Boolean(syncStatus?.is_matchday_live);
  const leagueTableLabel = isTableLive ? 'Live League Table' : 'League Table';
  const showLiveDot = isTableLive;

  // Determine subtabs based on active main tab
  interface SubTabItem {
    id: string;
    label: string;
    onClick: () => void;
    isActive: boolean;
    hasDot?: boolean;
  }

  let subTabs: SubTabItem[] = [];

  if (activeTab === 'STANDINGS') {
    subTabs = [
      {
        id: 'status',
        label: 'Status',
        onClick: () => onSelectStandingsSubTab?.('status'),
        isActive: standingsSubTab === 'status',
      },
      {
        id: 'live-table',
        label: leagueTableLabel,
        onClick: () => onSelectStandingsSubTab?.('live-table'),
        isActive: standingsSubTab === 'live-table',
        hasDot: showLiveDot,
      },
      {
        id: 'gw-champions',
        label: 'GW Champions',
        onClick: () => onSelectStandingsSubTab?.('gw-champions'),
        isActive: standingsSubTab === 'gw-champions',
      },
      {
        id: 'most-gw-champions',
        label: 'Most GW Champions',
        onClick: () => onSelectStandingsSubTab?.('most-gw-champions'),
        isActive: standingsSubTab === 'most-gw-champions',
      },
      {
        id: 'chart' as const,
        label: 'Chart',
        onClick: () => onSelectStandingsSubTab?.('chart'),
        isActive: standingsSubTab === 'chart',
      },
      {
        id: 'liga-minus',
        label: 'Liga Minus',
        onClick: () => onSelectStandingsSubTab?.('liga-minus'),
        isActive: standingsSubTab === 'liga-minus',
      },
    ];
  } else if (activeTab === 'OWNERSHIP') {
    subTabs = [
      {
        id: 'most-owned-players',
        label: 'Most Owned Player',
        onClick: () => onSelectOwnershipSubTab?.('most-owned-players'),
        isActive: ownershipSubTab === 'most-owned-players',
      },
      {
        id: 'most-owned-clubs',
        label: 'Most Owned by Club',
        onClick: () => onSelectOwnershipSubTab?.('most-owned-clubs'),
        isActive: ownershipSubTab === 'most-owned-clubs',
      },
      {
        id: 'fans-club',
        label: 'Fans Club',
        onClick: () => onSelectOwnershipSubTab?.('fans-club'),
        isActive: ownershipSubTab === 'fans-club',
      },
      {
        id: 'template-squad',
        label: 'Template Squad',
        onClick: () => onSelectOwnershipSubTab?.('template-squad'),
        isActive: ownershipSubTab === 'template-squad',
      },
    ];
  } else if (activeTab === 'TRANSFER') {
    subTabs = [
      {
        id: 'all-transfers',
        label: 'All Transfers',
        onClick: () => onSelectTransferSubTab?.('all-transfers'),
        isActive: transferSubTab === 'all-transfers',
      },
      {
        id: 'transferred-in',
        label: 'Most Transferred In',
        onClick: () => onSelectTransferSubTab?.('transferred-in'),
        isActive: transferSubTab === 'transferred-in',
      },
      {
        id: 'transferred-out',
        label: 'Most Transferred Out',
        onClick: () => onSelectTransferSubTab?.('transferred-out'),
        isActive: transferSubTab === 'transferred-out',
      },
    ];
  } else if (activeTab === 'CAPTAIN') {
    subTabs = [
      {
        id: 'most-captained-player',
        label: 'Most Captained Player',
        onClick: () => onSelectCaptainSubTab?.('most-captained-player'),
        isActive: captainSubTab === 'most-captained-player',
      },
      {
        id: 'most-captained-club-players',
        label: 'Most Captained by Club',
        onClick: () => onSelectCaptainSubTab?.('most-captained-club-players'),
        isActive: captainSubTab === 'most-captained-club-players',
      },
    ];
  }

  return (
    <header className="bg-[#37003c] text-white sticky top-0 z-40 shadow-xl">
      {/* Brand Bar: Logo & Application Name */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-[56px] sm:h-[62px] flex items-center">
        <div className="w-full flex items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <img
              src="/logo.png?v=2"
              alt="FPL Nusantara BERHADIAH"
              className="w-[52px] h-[52px] sm:w-[58px] sm:h-[58px] object-contain shrink-0 select-none"
              onError={(e) => {
                e.currentTarget.src = defaultLogoImage;
              }}
            />

            <div className="flex flex-col justify-center">
              <h1 className="text-base sm:text-lg md:text-xl font-black tracking-tight leading-none">
                <span className="text-white">FPL </span>
                <span className="text-[#00ff87]">Nusantara </span>
                <span className="text-white">BERHADIAH</span>
              </h1>
              <span className="text-white/80 font-bold text-[10px] sm:text-xs tracking-wider leading-none mt-0.5">
                2026/2027
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab & Sub-tab Navigation Container: Styled exactly like reference image */}
      <div className="max-w-7xl mx-auto px-1 sm:px-4">
        <div className="rounded-t-xl sm:rounded-t-2xl overflow-hidden shadow-2xl border-t border-x border-white/10">
          {/* Tier 1: Main Tabs (Obsidian Purple background, uppercase, green active text & green indicator bar) */}
          {onSelectTab && (
            <div className="bg-[#140722] border-b border-black/50">
              <nav
                ref={navRef}
                className="flex items-center overflow-x-auto scrollbar-none px-2 sm:px-4 scroll-smooth"
              >
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      id={`nav-tab-${tab.id.toLowerCase()}`}
                      data-active={isActive ? 'true' : 'false'}
                      onClick={(e) => {
                        onSelectTab(tab.id);
                        scrollTabIntoView(navRef.current, e.currentTarget);
                      }}
                      className={`relative py-2.5 sm:py-3 px-3 sm:px-4 shrink-0 transition-colors cursor-pointer select-none text-[11.5px] sm:text-[13px] tracking-wider uppercase leading-none font-bold ${
                        isActive
                          ? 'text-[#00ff87] font-black'
                          : 'text-white hover:text-white/80'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {/* Active green indicator underline */}
                      {isActive && (
                        <span className="absolute bottom-0 left-2.5 sm:left-3 right-2.5 sm:right-3 h-[3px] bg-[#00ff87] rounded-full shadow-[0_0_8px_rgba(0,255,135,0.7)]" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Tier 2: Sub-Nav Bar (Dark Slate Charcoal background, white active text & white indicator bar, red dot for Live) */}
          {subTabs.length > 0 && (
            <div className="bg-[#22262d] border-b border-[#30353f]">
              <nav
                ref={subNavRef}
                className="flex items-center overflow-x-auto scrollbar-none px-2 sm:px-4 scroll-smooth"
              >
                {subTabs.map((sub) => {
                  const hasPulsingDot = sub.hasDot === true;
                  return (
                    <button
                      key={sub.id}
                      id={`subtab-${sub.id}`}
                      data-active={sub.isActive ? 'true' : 'false'}
                      onClick={(e) => {
                        sub.onClick();
                        scrollTabIntoView(subNavRef.current, e.currentTarget);
                      }}
                      className={`relative py-2 sm:py-2.5 px-3 sm:px-4 shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer select-none text-[11px] sm:text-[12.5px] leading-none ${
                        sub.isActive
                          ? 'text-white font-bold'
                          : 'text-[#9da3af] hover:text-white font-medium'
                      }`}
                    >
                      {hasPulsingDot && (
                        <span className="w-2 h-2 rounded-full bg-[#ff2851] shrink-0 animate-pulse shadow-[0_0_6px_rgba(255,40,81,0.8)]" />
                      )}
                      <span>{sub.label}</span>
                      {/* Active white indicator underline */}
                      {sub.isActive && (
                        <span className="absolute bottom-0 left-2 sm:left-3 right-2 sm:right-3 h-[2.5px] bg-white rounded-t-sm shadow-[0_0_5px_rgba(255,255,255,0.7)]" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
