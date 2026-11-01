import React, { useRef, useEffect } from 'react';
import { Trophy, Users, ArrowRightLeft, Crown, Zap } from 'lucide-react';
import { MainTab } from '../types.ts';
import defaultLogoImage from '../assets/images/fnb_league_logo_transparent.png';
import { scrollTabIntoView } from '../utils.ts';

interface HeaderProps {
  activeTab?: MainTab;
  onSelectTab?: (tab: MainTab) => void;
  syncStatus?: any;
  isSyncing?: boolean;
  onManualSync?: () => void;
  onOpenSyncModal?: () => void;
  currentGW?: number;
  availableGWs?: number[];
  selectedGW?: number;
  onSelectGW?: (gw: number) => void;
}

const TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: 'STANDINGS', label: 'STANDINGS', icon: <Trophy className="w-3.5 h-3.5" /> },
  { id: 'OWNERSHIP', label: 'OWNERSHIP', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'TRANSFER', label: 'TRANSFER', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
  { id: 'CAPTAIN', label: 'CAPTAIN', icon: <Crown className="w-3.5 h-3.5" /> },
  { id: 'CHIPS', label: 'CHIPS', icon: <Zap className="w-3.5 h-3.5" /> },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab = 'STANDINGS',
  onSelectTab,
  isSyncing = false,
  onOpenSyncModal,
}) => {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!navRef.current) return;
    const activeBtn = navRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeBtn) {
      scrollTabIntoView(navRef.current, activeBtn);
    }
  }, [activeTab]);

  return (
    <header className="bg-[#37003c] text-white border-b-2 border-[#00ff87]/40 shadow-lg sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between py-1.5 sm:py-2 gap-1.5 md:gap-4">
          {/* Logo & Application Name */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <img
              src="/logo.png?v=2"
              alt="FPL Nusantara BERHADIAH"
              className="w-10 h-10 sm:w-11 sm:h-11 object-contain shrink-0 select-none"
              onError={(e) => {
                e.currentTarget.src = defaultLogoImage;
              }}
            />

            <div className="flex flex-col justify-center gap-0.5">
              <h1 className="text-base sm:text-lg md:text-xl font-black tracking-tight leading-none">
                <span className="text-white">FPL </span>
                <span className="text-[#00ff87]">Nusantara </span>
                <span className="text-white">BERHADIAH</span>
              </h1>
              <span className="text-white/80 font-bold text-[10px] sm:text-xs tracking-wider leading-none">
                2026/2027
              </span>
            </div>
          </div>

          {/* Minimalist Tabs attached directly to header */}
          {onSelectTab && (
            <nav
              ref={navRef}
              className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none border-t border-white/10 md:border-t-0 pt-1.5 md:pt-0 scroll-smooth"
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
                    className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-extrabold tracking-wider uppercase transition-all whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-[#00ff87]/20 text-[#00ff87] ring-1 ring-[#00ff87]/40 shadow-xs'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className={isActive ? 'text-[#00ff87]' : 'text-white/40'}>
                      {tab.icon}
                    </span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};
