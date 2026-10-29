import React, { useState, useEffect } from 'react';
import { TransformedLeagueData } from '../types.ts';

interface NewsTickerProps {
  leagueData?: TransformedLeagueData | null;
  className?: string;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('fnb_setting_news_ticker');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handleSettingChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: boolean }>;
      if (customEvent.detail && customEvent.detail.key === 'news_ticker') {
        setIsVisible(Boolean(customEvent.detail.value));
      }
    };
    window.addEventListener('fnb:setting-changed', handleSettingChange);
    return () => window.removeEventListener('fnb:setting-changed', handleSettingChange);
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="News Ticker"
      className={`relative w-full overflow-hidden flex items-center h-7 py-[2px] sm:py-[2.5px] px-3 bg-[#161a22] border-t border-white/10 select-none ${className}`}
    >
      {/* Soft feather gradient edges */}
      <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[#161a22] to-transparent pointer-events-none z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-[#161a22] to-transparent pointer-events-none z-10" />

      {/* Baris container kosong */}
      <div className="flex-1 overflow-hidden relative flex items-center h-full" />
    </div>
  );
};
