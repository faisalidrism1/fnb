import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TransformedLeagueData, MatchCardItem } from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';
import {
  NewsStory,
  NewsToken,
  EntityType,
  generateDynamicNewsStories,
} from '../data/newsTickerEngine.ts';

export type { NewsStory, NewsToken, EntityType };

interface NewsTickerProps {
  leagueData?: TransformedLeagueData | null;
  matches?: MatchCardItem[] | null;
  className?: string;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({
  leagueData,
  matches: propMatches,
  className = '',
}) => {
  const { language } = useLanguage();
  const [internalMatches, setInternalMatches] = useState<MatchCardItem[] | null>(null);

  // Status tampilan dari setting
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fnb_setting_news_ticker') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleSettingChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: boolean }>;
      if (customEvent.detail && customEvent.detail.key === 'news_ticker') {
        const nextVal = Boolean(customEvent.detail.value);
        setIsVisible(nextVal);
      }
    };
    window.addEventListener('fnb:setting-changed', handleSettingChange);
    return () => window.removeEventListener('fnb:setting-changed', handleSettingChange);
  }, []);

  // Polling data laga live otomatis (setiap 15 detik saat matchday live)
  useEffect(() => {
    if (propMatches) return;
    const currentGW = leagueData?.current_gw || 1;
    const isMatchLive = Boolean(
      leagueData?.sync_status?.is_matchday_live || 
      leagueData?.gw_status?.status === 'Live' ||
      (leagueData?.sync_status?.gw_fixtures || []).some(f => f.event === currentGW && f.started)
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
      intervalId = setInterval(fetchLiveMatches, 15000);
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

  // Hasilkan daftar berita dramatis melalui Heuristic Story Engine
  const storiesList = useMemo<NewsStory[]>(() => {
    return generateDynamicNewsStories(leagueData, language, activeMatches);
  }, [leagueData, language, activeMatches]);

  // DOM Container & Track
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const nextUidRef = useRef<number>(1);

  // Pool cerita dan antrean prioritas FIFO kejadian live baru
  const poolRef = useRef<NewsStory[]>([]);
  const poolIdxRef = useRef<number>(0);
  const priorityQueueRef = useRef<NewsStory[]>([]);
  const seenStoryIdsRef = useRef<Set<string>>(new Set());
  const isInitialRunRef = useRef<boolean>(true);

  // Animasi & kontrol posisi
  const currentXRef = useRef<number>(0);
  const isHoveredRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(0);

  // Helper untuk membuat elemen DOM cerita berita dengan Entity Syntax Highlighting
  const createStoryElement = useCallback((story: NewsStory, uid: number): HTMLElement => {
    const span = document.createElement('span');
    span.className = 'inline-flex items-center text-[11px] sm:text-[12px] whitespace-nowrap pr-8 leading-[1.25] shrink-0';
    span.dataset.uid = String(uid);

    // Render setiap token entitas dengan warna khususnya
    story.tokens.forEach(token => {
      const tokenEl = document.createElement('span');
      tokenEl.textContent = token.text;

      switch (token.type) {
        case 'player':
          tokenEl.className = 'text-[#00ff87] font-bold';
          break;
        case 'team':
          tokenEl.className = 'text-[#38bdf8] font-bold';
          break;
        case 'club':
          tokenEl.className = 'text-[#fbbf24] font-semibold';
          break;
        case 'stat':
          tokenEl.className = 'text-white font-extrabold';
          break;
        case 'plain':
        default:
          tokenEl.className = 'text-white/90 font-medium';
          break;
      }

      span.appendChild(tokenEl);
    });

    // Dot pemisah bercahaya hijau di sisi kanan setiap berita
    const dot = document.createElement('span');
    dot.className = story.isFresh
      ? 'inline-block w-1.5 h-1.5 rounded-full ml-4 shrink-0 bg-[#00ff87] shadow-[0_0_8px_rgba(0,255,135,1)] animate-ping'
      : 'inline-block w-1.5 h-1.5 rounded-full ml-4 shrink-0 bg-[#00ff87] shadow-[0_0_6px_rgba(0,255,135,0.7)]';
    span.appendChild(dot);

    return span;
  }, []);

  // Helper mengambil cerita berikutnya (Strict FIFO: kejadian baru keluar lebih dulu, antrean tertib)
  const getNextStory = useCallback((): NewsStory => {
    if (priorityQueueRef.current.length > 0) {
      return priorityQueueRef.current.shift()!;
    }
    const pool = poolRef.current;
    if (pool.length === 0) {
      return {
        id: 'empty_fallback',
        tokens: [{ text: 'FPL Nusantara BERHADIAH • Musim 2026/2027', type: 'plain' }],
        plainText: 'FPL Nusantara BERHADIAH • Musim 2026/2027',
        dramaScore: 50,
        timestamp: Date.now(),
        phase: 'confirmed',
      };
    }
    const story = pool[poolIdxRef.current % pool.length];
    poolIdxRef.current = (poolIdxRef.current + 1) % pool.length;
    return story;
  }, []);

  // Sinkronisasi pool berita dan deteksi kejadian live baru ke antrean FIFO
  useEffect(() => {
    poolRef.current = storiesList;
    if (storiesList.length === 0) return;

    if (isInitialRunRef.current) {
      storiesList.forEach(s => seenStoryIdsRef.current.add(s.id));
      isInitialRunRef.current = false;
      return;
    }

    // Kejadian live baru yang terdeteksi masuk ke antrean FIFO
    storiesList.forEach(s => {
      if (!seenStoryIdsRef.current.has(s.id)) {
        seenStoryIdsRef.current.add(s.id);
        priorityQueueRef.current.push({ ...s, isFresh: true });
      }
    });
  }, [storiesList]);

  // Inisialisasi track padat tanpa jeda kosong
  const fillTrackInitial = useCallback(() => {
    const track = trackRef.current;
    const container = containerRef.current;
    if (!track || !container) return;

    track.innerHTML = '';
    currentXRef.current = 0;
    track.style.transform = 'translate3d(0, 0, 0)';

    const minWidth = (container.clientWidth || window.innerWidth || 1200) + 1200;
    let currentWidth = 0;
    let safetyCounter = 0;

    while (currentWidth < minWidth && safetyCounter < 25) {
      const story = getNextStory();
      const el = createStoryElement(story, nextUidRef.current++);
      track.appendChild(el);
      currentWidth += el.offsetWidth || 350;
      safetyCounter++;
    }
  }, [getNextStory, createStoryElement]);

  // Main 60 FPS Continuous Conveyor Loop (Atomic DOM recycling, zero visual reset, zero void)
  useEffect(() => {
    if (!isVisible) return;

    fillTrackInitial();

    let animationFrameId: number;
    const speed = 48; // Kecepatan tenang dan nyaman dibaca (48 px/detik)

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const deltaSec = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      const track = trackRef.current;
      const container = containerRef.current;

      if (!isHoveredRef.current && track && container) {
        currentXRef.current -= speed * deltaSec;

        const firstChild = track.firstElementChild as HTMLElement;
        if (firstChild) {
          const itemWidth = firstChild.offsetWidth;
          if (-currentXRef.current >= itemWidth) {
            // Operasi atomik dalam 1 frame:
            // 1. Lepas elemen kiri yang selesai dibaca
            track.removeChild(firstChild);
            // 2. Kompensasikan offset persis sebesar lebar item yang keluar (zero subpixel jump!)
            currentXRef.current += itemWidth;
            // 3. Ambil berita berikutnya (FIFO kejadian baru atau rotasi pool)
            const nextStory = getNextStory();
            const nextEl = createStoryElement(nextStory, nextUidRef.current++);
            // 4. Sambung di kanan track secara mulus
            track.appendChild(nextEl);
          }
        }

        track.style.transform = `translate3d(${currentXRef.current}px, 0, 0)`;
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isVisible, fillTrackInitial, getNextStory, createStoryElement]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="News Ticker"
      className={`relative w-full overflow-hidden flex items-center h-7 py-[2px] sm:py-[2.5px] px-3 bg-[#161a22] border-t border-white/10 select-none ${className}`}
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
      onTouchStart={() => { isHoveredRef.current = true; }}
      onTouchEnd={() => { isHoveredRef.current = false; }}
    >
      {/* Soft feather gradient edges */}
      <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[#161a22] to-transparent pointer-events-none z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-[#161a22] to-transparent pointer-events-none z-10" />

      {/* Marquee Track Container */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative flex items-center h-full">
        <div
          ref={trackRef}
          className="flex items-center whitespace-nowrap will-change-transform"
          style={{ transform: 'translate3d(0, 0, 0)' }}
        />
      </div>
    </div>
  );
};
