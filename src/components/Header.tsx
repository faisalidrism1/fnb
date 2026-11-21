import React, { useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import {
  MainTab,
  StandingsSubTab,
  OwnershipSubTab,
  TransferSubTab,
  CaptainSubTab,
  AdminSubTab,
  ProjectionSubTab,
  ScoutSubTab,
  GwEventStatus,
  SyncStatus,
  TransformedLeagueData,
} from '../types.ts';
import { scrollTabIntoView } from '../utils.ts';
import { getGameweekStatus } from '../utils/gwStatus.ts';
import { NewsTicker } from './NewsTicker.tsx';
import { useLanguage } from '../utils/i18n.ts';

const defaultLogoImage = '/logo.png';

interface HeaderProps {
  activeTab?: MainTab;
  onSelectTab?: (tab: MainTab) => void;
  syncStatus?: SyncStatus | any;
  currentGW?: number;
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
  projectionSubTab?: ProjectionSubTab;
  onSelectProjectionSubTab?: (sub: ProjectionSubTab) => void;
  scoutSubTab?: ScoutSubTab;
  onSelectScoutSubTab?: (sub: ScoutSubTab) => void;
  adminSubTab?: AdminSubTab;
  onSelectAdminSubTab?: (sub: AdminSubTab) => void;
  onOpenSettings?: () => void;
  leagueData?: TransformedLeagueData | null;
  isAdminUnlocked?: boolean;
  showProjectionAndScout?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab = 'STANDINGS',
  onSelectTab,
  syncStatus,
  currentGW,
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
  projectionSubTab = 'line-up',
  onSelectProjectionSubTab,
  scoutSubTab = 'picks',
  onSelectScoutSubTab,
  adminSubTab = 'news-ticker',
  onSelectAdminSubTab,
  onOpenSettings,
  leagueData,
  isAdminUnlocked = false,
  showProjectionAndScout = !import.meta.env.PROD,
}) => {
  const { t } = useLanguage();
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
  }, [activeTab, standingsSubTab, ownershipSubTab, transferSubTab, captainSubTab, projectionSubTab, scoutSubTab, adminSubTab]);

  // Determine current active Gameweek status (Not Started, Live, Provisional, Confirmed)
  const effectiveGW = currentGW || 1;
  const activeGwStatusObj = eventsStatus?.[effectiveGW] || gwStatus;
  const { isLiveOrProvisional } = getGameweekStatus(
    effectiveGW,
    effectiveGW,
    activeGwStatusObj,
    syncStatus
  );

  // If status is Live or Provisional -> "Live League Table" with pulsing red dot
  // If status is Confirmed or Not Started -> "League Table" without red dot
  const isTableLive = isLiveOrProvisional || Boolean(syncStatus?.is_matchday_live);
  const leagueTableLabel = isTableLive ? t('subtab_live_league_table') : t('subtab_league_table');
  const showLiveDot = isTableLive;

  // Tabs list with translations
  const tabsList: { id: MainTab; label: string }[] = [
    { id: 'STANDINGS', label: t('tab_standings') },
    { id: 'MATCHES', label: t('tab_matches') },
    { id: 'OWNERSHIP', label: t('tab_ownership') },
    { id: 'TRANSFER', label: t('tab_transfer') },
    { id: 'CAPTAIN', label: t('tab_captain') },
    { id: 'CHIPS', label: t('tab_chips') },
  ];

  if (showProjectionAndScout) {
    tabsList.push(
      { id: 'PROJECTION', label: t('tab_projection') },
      { id: 'SCOUT', label: t('tab_scout') }
    );
  }

  if (isAdminUnlocked) {
    tabsList.push({ id: 'ADMIN', label: 'ADMIN' });
  }

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
        label: t('subtab_status'),
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
        label: t('subtab_gw_champions'),
        onClick: () => onSelectStandingsSubTab?.('gw-champions'),
        isActive: standingsSubTab === 'gw-champions',
      },
      {
        id: 'most-gw-champions',
        label: t('subtab_most_gw_champions'),
        onClick: () => onSelectStandingsSubTab?.('most-gw-champions'),
        isActive: standingsSubTab === 'most-gw-champions',
      },
      {
        id: 'chart' as const,
        label: t('subtab_chart'),
        onClick: () => onSelectStandingsSubTab?.('chart'),
        isActive: standingsSubTab === 'chart',
      },
      {
        id: 'liga-minus',
        label: t('subtab_liga_minus'),
        onClick: () => onSelectStandingsSubTab?.('liga-minus'),
        isActive: standingsSubTab === 'liga-minus',
      },
    ];
  } else if (activeTab === 'OWNERSHIP') {
    subTabs = [
      {
        id: 'most-owned-players',
        label: t('subtab_most_owned_player'),
        onClick: () => onSelectOwnershipSubTab?.('most-owned-players'),
        isActive: ownershipSubTab === 'most-owned-players',
      },
      {
        id: 'most-owned-clubs',
        label: t('subtab_most_owned_by_club'),
        onClick: () => onSelectOwnershipSubTab?.('most-owned-clubs'),
        isActive: ownershipSubTab === 'most-owned-clubs',
      },
      {
        id: 'fans-club',
        label: t('subtab_fans_club'),
        onClick: () => onSelectOwnershipSubTab?.('fans-club'),
        isActive: ownershipSubTab === 'fans-club',
      },
      {
        id: 'template-squad',
        label: t('subtab_template_squad'),
        onClick: () => onSelectOwnershipSubTab?.('template-squad'),
        isActive: ownershipSubTab === 'template-squad',
      },
    ];
  } else if (activeTab === 'TRANSFER') {
    subTabs = [
      {
        id: 'all-transfers',
        label: t('subtab_all_transfers'),
        onClick: () => onSelectTransferSubTab?.('all-transfers'),
        isActive: transferSubTab === 'all-transfers',
      },
      {
        id: 'transferred-in',
        label: t('subtab_most_transferred_in'),
        onClick: () => onSelectTransferSubTab?.('transferred-in'),
        isActive: transferSubTab === 'transferred-in',
      },
      {
        id: 'transferred-out',
        label: t('subtab_most_transferred_out'),
        onClick: () => onSelectTransferSubTab?.('transferred-out'),
        isActive: transferSubTab === 'transferred-out',
      },
    ];
  } else if (activeTab === 'CAPTAIN') {
    subTabs = [
      {
        id: 'most-captained-player',
        label: t('subtab_most_captained_player'),
        onClick: () => onSelectCaptainSubTab?.('most-captained-player'),
        isActive: captainSubTab === 'most-captained-player',
      },
      {
        id: 'most-captained-club-players',
        label: t('subtab_most_captained_by_club'),
        onClick: () => onSelectCaptainSubTab?.('most-captained-club-players'),
        isActive: captainSubTab === 'most-captained-club-players',
      },
    ];
  } else if (showProjectionAndScout && activeTab === 'PROJECTION') {
    subTabs = [
      { id: 'line-up', label: t('subtab_projection_lineup'), onClick: () => onSelectProjectionSubTab?.('line-up'), isActive: projectionSubTab === 'line-up' },
      { id: 'score', label: t('subtab_projection_score'), onClick: () => onSelectProjectionSubTab?.('score'), isActive: projectionSubTab === 'score' },
      { id: 'points', label: t('subtab_projection_points'), onClick: () => onSelectProjectionSubTab?.('points'), isActive: projectionSubTab === 'points' },
    ];
  } else if (showProjectionAndScout && activeTab === 'SCOUT') {
    subTabs = [
      { id: 'picks', label: 'Picks', onClick: () => onSelectScoutSubTab?.('picks'), isActive: scoutSubTab === 'picks' },
      { id: 'captain', label: 'Captain', onClick: () => onSelectScoutSubTab?.('captain'), isActive: scoutSubTab === 'captain' },
      { id: 'differential', label: 'Differential', onClick: () => onSelectScoutSubTab?.('differential'), isActive: scoutSubTab === 'differential' },
      { id: 'chips', label: 'Chips', onClick: () => onSelectScoutSubTab?.('chips'), isActive: scoutSubTab === 'chips' },
      { id: 'transfer', label: 'Transfer', onClick: () => onSelectScoutSubTab?.('transfer'), isActive: scoutSubTab === 'transfer' },
    ];
  } else if (activeTab === 'ADMIN') {
    subTabs = [
      {
        id: 'editor',
        label: 'Editor',
        onClick: () => onSelectAdminSubTab?.('editor'),
        isActive: adminSubTab === 'editor',
      },
      {
        id: 'news-ticker',
        label: 'News Ticker',
        onClick: () => onSelectAdminSubTab?.('news-ticker'),
        isActive: adminSubTab === 'news-ticker',
      },
      {
        id: 'line-up',
        label: t('subtab_projection_lineup'),
        onClick: () => onSelectAdminSubTab?.('line-up'),
        isActive: adminSubTab === 'line-up',
      },
      {
        id: 'score',
        label: t('subtab_projection_score'),
        onClick: () => onSelectAdminSubTab?.('score'),
        isActive: adminSubTab === 'score',
      },
      {
        id: 'points',
        label: t('subtab_projection_points'),
        onClick: () => onSelectAdminSubTab?.('points'),
        isActive: adminSubTab === 'points',
      },
      {
        id: 'mae',
        label: t('subtab_review_mae'),
        onClick: () => onSelectAdminSubTab?.('mae'),
        isActive: adminSubTab === 'mae',
      },
    ];
  }

  return (
    <header className="bg-[#37003c] text-white sticky top-0 z-40 shadow-xl relative">
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

          {/* Right Action: Settings Button (Icon only without text) */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              id="header-settings-button"
              onClick={onOpenSettings}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/25 text-white/90 hover:text-[#00ff87] border border-white/10 hover:border-[#00ff87]/50 transition-all cursor-pointer shadow-sm active:scale-95 focus:outline-none flex items-center justify-center group"
              title={t('tooltip_settings')}
              aria-label={t('tooltip_settings')}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-300 group-hover:rotate-45" />
            </button>
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
                {tabsList.map((tab) => {
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

          {/* Tier 3: News Ticker directly attached beneath subtab (or main tab when there are no subtabs) */}
          <NewsTicker leagueData={leagueData} />
        </div>
      </div>
    </header>
  );
};
