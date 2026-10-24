import React, { useState, useEffect, useMemo } from 'react';
import { TransformedLeagueData, MatchCardItem } from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';
import {
  NewsItem,
  generateNewsFromCatalog,
} from '../data/newsTickerCatalog.ts';

export type { NewsItem };

// Backwards-compatible export
export const generateLeagueNewsItems = generateNewsFromCatalog;

interface NewsTickerProps {
  leagueData?: TransformedLeagueData | null;
  matches?: MatchCardItem[] | null;
  customText?: string[] | NewsItem[];
  className?: string;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({
  leagueData,
  matches: propMatches,
  customText,
  className = '',
}) => {
  const { language } = useLanguage();
  const [internalMatches, setInternalMatches] = useState<MatchCardItem[] | null>(null);

  const [isVisible, setIsVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fnb_setting_news_ticker') === 'true'; // Default OFF when not yet set
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleSettingChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: boolean }>;
      if (customEvent.detail && customEvent.detail.key === 'news_ticker') {
        const nextVal = Boolean(customEvent.detail.value);
        setTimeout(() => {
          setIsVisible(nextVal);
        }, 0);
      }
    };

    window.addEventListener('fnb:setting-changed', handleSettingChange);
    return () => {
      window.removeEventListener('fnb:setting-changed', handleSettingChange);
    };
  }, []);

  // Fetch live matches data automatically if not provided via props
  useEffect(() => {
    if (propMatches) return;
    const currentGW = leagueData?.current_gw || 1;
    const isMatchLive = Boolean(
      leagueData?.sync_status?.is_matchday_live || 
      leagueData?.gw_status?.status === 'Live' ||
      (leagueData?.sync_status?.gw_fixtures || []).some(f => f.started)
    );

    let isMounted = true;
    const fetchLiveMatches = async () => {
      try {
        const res = await fetch(`/api/fpl-matches/${currentGW}?_t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && isMounted) {
            setInternalMatches(json.data);
          }
        }
      } catch {}
    };

    fetchLiveMatches();

    let intervalId: any = null;
    if (isMatchLive) {
      intervalId = setInterval(fetchLiveMatches, 45000); // 45s periodic refresh during live matchday
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [
    leagueData?.current_gw,
    leagueData?.sync_status?.is_matchday_live,
    leagueData?.gw_status?.status,
    propMatches,
  ]);

  const activeMatches = propMatches || internalMatches;

  // Compute items from the centralized catalog or customText override
  const newsList = useMemo<NewsItem[]>(() => {
    if (customText && customText.length > 0) {
      return customText.map((item) => {
        if (typeof item === 'string') {
          if (item.includes(':')) {
            const [t, ...rest] = item.split(':');
            return { tag: t.trim(), text: rest.join(':').trim() };
          }
          return { tag: 'FNB', text: item };
        }
        return item;
      });
    }
    return generateNewsFromCatalog(leagueData, language, activeMatches);
  }, [leagueData, language, activeMatches, customText]);

  // Calculate calm, easily readable duration based on total character volume (~7-8 chars per second)
  const durationSeconds = useMemo(() => {
    const totalChars = newsList.reduce((acc, curr) => acc + curr.tag.length + curr.text.length + 15, 0);
    // At ~8 chars/sec, text moves at a calm, relaxed pace regardless of how many news items are loaded
    return Math.max(90, Math.round(totalChars / 8));
  }, [newsList]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="News Ticker"
      className={`relative w-full overflow-hidden flex items-center h-fit py-[2px] sm:py-[2.5px] bg-[#161a22] border-t border-white/10 select-none ${className}`}
    >
      {/* Soft feather edges at extreme sides (zero GPU cost) */}
      <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[#161a22] to-transparent pointer-events-none z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-[#161a22] to-transparent pointer-events-none z-10" />

      {/* Marquee Track: Full-width continuous scroll with 3D hardware compositing and pause-on-hover */}
      <div className="flex-1 overflow-hidden relative flex items-center group">
        <div
          style={{ animationDuration: `${durationSeconds}s` }}
          className="animate-marquee flex items-center group-hover:[animation-play-state:paused]"
        >
          {/* First loop instance */}
          <div className="flex items-center shrink-0 pr-10">
            {newsList.map((item, idx) => (
              <span
                key={`news-1-${idx}`}
                className="inline-flex items-center gap-1.5 text-[11px] sm:text-[12px] whitespace-nowrap mr-8 leading-[1.25]"
              >
                <span className="font-black text-[#00ff87] tracking-wider">
                  {item.tag}:
                </span>
                <span className="font-semibold text-white/95 tracking-wide">
                  {item.text}
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ff87] ml-4 shrink-0 shadow-[0_0_6px_rgba(0,255,135,0.7)]" />
              </span>
            ))}
          </div>

          {/* Second identical instance for seamless infinite scrolling */}
          <div className="flex items-center shrink-0 pr-10">
            {newsList.map((item, idx) => (
              <span
                key={`news-2-${idx}`}
                className="inline-flex items-center gap-1.5 text-[11px] sm:text-[12px] whitespace-nowrap mr-8 leading-[1.25]"
              >
                <span className="font-black text-[#00ff87] tracking-wider">
                  {item.tag}:
                </span>
                <span className="font-semibold text-white/95 tracking-wide">
                  {item.text}
                </span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ff87] ml-4 shrink-0 shadow-[0_0_6px_rgba(0,255,135,0.7)]" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
