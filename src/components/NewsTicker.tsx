import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TransformedLeagueData } from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';

export type LiveNewsroomTier = 'P1' | 'P2' | 'P3' | 'P4' | 'FALLBACK';

export interface NewsTickerStory {
  id: string;
  headline_id: string;
  headline_en: string;
  drama_score: number;
  sumber?: string;
  status_tayang?: 'Y' | 'N';
  fase?: string;
  gw?: number;
  newsroom_tier?: LiveNewsroomTier;
  score_sig?: string;
}

const EDITOR_TEMPLATE_PREFIXES = ['NS_', 'LM_', 'BM_', 'PV_', 'CF_'];

function normalizePhaseName(phase?: string | null): string {
  const p = (phase || '').trim().toLowerCase();
  if (p === 'live') return 'live match';
  if (p === 'pre-deadline') return 'not started';
  return p;
}

function isEditorSourcedStory(story: any): boolean {
  if (!story || typeof story.id !== 'string') return false;
  if (story.status_tayang !== 'Y') return false;
  if (story.sumber !== 'Sys') return false;
  const upperId = story.id.trim().toUpperCase();
  return EDITOR_TEMPLATE_PREFIXES.some((prefix) => upperId.startsWith(prefix));
}

function isStoryMatchingPhase(story: NewsTickerStory, activePhase?: string | null): boolean {
  if (!activePhase) return true;
  if (!story.fase || !story.fase.trim()) return false;
  return normalizePhaseName(story.fase) === normalizePhaseName(activePhase);
}

function isStoryMatchingGw(story: NewsTickerStory, activeGw?: number | null): boolean {
  if (!activeGw) return true;
  const storyGw = Number(story.gw);
  return Number.isFinite(storyGw) && storyGw === activeGw;
}

interface NewsTickerProps {
  leagueData?: TransformedLeagueData | null;
  className?: string;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({
  leagueData,
  className = '',
}) => {
  const { language } = useLanguage();

  // Visibility state from user preference
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

  // Stories feed state
  const [stories, setStories] = useState<NewsTickerStory[]>([]);
  const storiesRef = useRef<NewsTickerStory[]>([]);
  storiesRef.current = stories;
  const activePhaseRef = useRef<string | null>(null);
  const activeGwRef = useRef<number | null>(null);
  const handleIncomingStoriesRef = useRef<(newStories: NewsTickerStory[], incomingPhase?: string | null, incomingGw?: number | null, isCycleRotation?: boolean) => void>(() => {});
  const fetchFeedRef = useRef<(forceRefresh?: boolean) => Promise<void>>(async () => {});
  const cycleRefreshPendingRef = useRef<boolean>(false);
  const cycleRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAirPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const fetchSeqRef = useRef<number>(0);

  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        broadcastChannelRef.current = new BroadcastChannel('fnb_news_ticker_sync');
      }
    } catch {}
    return () => {
      try {
        broadcastChannelRef.current?.close();
      } catch {}
      broadcastChannelRef.current = null;
    };
  }, []);

  const reportStoryAired = useCallback((storyId: string) => {
    if (!storyId) return;
    // Multi-tab protection 1: do not trigger from hidden/background browser tabs
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }

    // Multi-tab protection 2: shared same-browser lock so duplicate tabs don't double-POST
    const lockKey = `fnb_ticker_aired_lock_${storyId}`;
    const now = Date.now();
    try {
      const prevTs = Number(localStorage.getItem(lockKey) || 0);
      if (prevTs > 0 && now - prevTs < 25000) {
        return;
      }
      localStorage.setItem(lockKey, String(now));
    } catch {}

    const cycleSize = Math.max(1, storiesRef.current.length);
    const req = fetch('/api/admin/news-ticker/increment-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: storyId, cycleSize }),
      keepalive: true,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && json.success && typeof json.poin_tayang === 'number') {
          const detail = {
            id: String(json.id || storyId),
            poin_tayang: json.poin_tayang,
          };
          window.dispatchEvent(
            new CustomEvent('fnb:news-ticker-point-incremented', { detail })
          );
          try {
            broadcastChannelRef.current?.postMessage({
              type: 'point-incremented',
              ...detail,
            });
          } catch {}
        }
      })
      .catch(() => {});
    lastAirPromiseRef.current = req;
  }, []);

  // Fetch news feed from backend
  useEffect(() => {
    let isMounted = true;
    const fetchFeed = async (forceRefresh = false) => {
      // Avoid racing a background poll while a cycle rotation refresh is pending/in-flight
      if (!forceRefresh && cycleRefreshPendingRef.current) {
        return;
      }
      const seq = ++fetchSeqRef.current;
      try {
        if (forceRefresh) {
          // Ensure the final story's increment-point POST has settled (up to 800ms) before reading next cycle
          await Promise.race([
            lastAirPromiseRef.current,
            new Promise<void>((resolve) => setTimeout(resolve, 800)),
          ]);
        }
        if (!isMounted) return;
        const refreshParam = forceRefresh ? '&refresh=1' : '';
        const res = await fetch(`/api/news-ticker/feed?_t=${Date.now()}${refreshParam}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          // Ignore stale out-of-order responses if a newer request has started
          if (seq !== fetchSeqRef.current) return;
          if (json.success && Array.isArray(json.data) && isMounted) {
            const incomingPhase = typeof json.gameweekPhase === 'string' ? json.gameweekPhase.trim() : null;
            const parsedGw = Number(json.gameweek ?? leagueData?.current_gw);
            const incomingGw = Number.isFinite(parsedGw) && parsedGw > 0 ? parsedGw : null;
            const editorOnly = json.data
              .filter(isEditorSourcedStory)
              .filter((s: NewsTickerStory) => isStoryMatchingGw(s, incomingGw))
              .filter((s: NewsTickerStory) => isStoryMatchingPhase(s, incomingPhase));
            handleIncomingStoriesRef.current(editorOnly, incomingPhase, incomingGw, forceRefresh);
          }
        }
      } catch (err) {
        console.warn('[News Ticker] Fetch error:', err);
      } finally {
        if (forceRefresh) {
          cycleRefreshPendingRef.current = false;
        }
      }
    };
    fetchFeedRef.current = fetchFeed;

    fetchFeed(false);

    // Immediately re-fetch whenever templates are saved in Tabel Editor
    const handleTickerUpdated = () => {
      fetchFeed(false);
    };
    window.addEventListener('fnb:news-ticker-updated', handleTickerUpdated);

    // Re-fetch periodically (every 15s during Live Match, every 2 minutes otherwise)
    const isLive = Boolean(
      leagueData?.sync_status?.is_matchday_live ||
      leagueData?.gw_status?.status === 'Live'
    );
    const intervalTime = isLive ? 15000 : 120000;
    const intervalId = setInterval(() => fetchFeed(false), intervalTime);

    return () => {
      isMounted = false;
      if (cycleRefreshTimerRef.current) {
        clearTimeout(cycleRefreshTimerRef.current);
        cycleRefreshTimerRef.current = null;
      }
      cycleRefreshPendingRef.current = false;
      window.removeEventListener('fnb:news-ticker-updated', handleTickerUpdated);
      clearInterval(intervalId);
    };
  }, [
    leagueData?.current_gw,
    leagueData?.gw_status?.status,
    leagueData?.sync_status?.is_matchday_live,
    leagueData?.sync_status?.last_synced,
  ]);

const POOL_IDX_STORAGE_KEY = 'fnb_news_ticker_pool_index';

const getSavedPoolIdx = (): number => {
  try {
    const val = sessionStorage.getItem(POOL_IDX_STORAGE_KEY);
    if (val !== null) {
      const parsed = parseInt(val, 10);
      return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
    }
  } catch {}
  return 0;
};

  // DOM refs & Marquee control
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const currentXRef = useRef<number>(0);
  const isHoveredRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(0);
  const poolIdxRef = useRef<number>(getSavedPoolIdx());
  const nextUidRef = useRef<number>(1);
  const lastAiredP3Ref = useRef<Map<string, { ts: number; text: string }>>(new Map());
  const lastQueuedStoryIdRef = useRef<string | null>(null);

  // Helper to get text based on current active language, stripping any title prefix (e.g. "Judul: Isi" -> "Isi")
  // and ensuring strictly NO exclamation marks and NO mention of "poin bersih" / "net"
  const getStoryText = useCallback(
    (story: NewsTickerStory): string => {
      let raw = (language === 'en' && story.headline_en)
        ? story.headline_en
        : (story.headline_id || story.headline_en || '');

      if (!raw) return '';

      // Replace all exclamation marks with period
      raw = raw.replace(/!+/g, '.');

      // Convert any stray conditional/hypothetical phrasing into factual perspective
      raw = raw
        .replace(/^Andai\s+(\[T:[^\]]+\])\s+memasang\s+/gi, 'Keputusan $1 menempatkan ')
        .replace(/^Andai\s+(\[T:[^\]]+\])\s+memilih\s+/gi, 'Keputusan $1 memilih ')
        .replace(/^Andai\s+/gi, 'Keputusan ')
        .replace(/\bandai\s+memilih\b/gi, 'dibanding')
        .replace(/\bandai\s+memasang\b/gi, 'dibanding')
        .replace(/^Had\s+(\[T:[^\]]+\])\s+started\s+/gi, 'Leaving ')
        .replace(/^Had\s+/gi, 'The decision by ');

      // Format player and club as "[P:Player] ([C:Club])" strictly without the word "dari"
      raw = raw
        .replace(/\[P:([^\]]+)\]\s+dari\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])')
        .replace(/\[P:([^\]]+)\]\s+dari\s+klub\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])')
        .replace(/\[C:([^\]]+)\]'s\s+\[P:([^\]]+)\]/gi, '[P:$2] ([C:$1])')
        .replace(/\bfrom\s+\[C:([^\]]+)\](?:\s+(?:defender|midfielder|forward|striker|goalkeeper))?\s+\[P:([^\]]+)\]/gi, '[P:$2] ([C:$1])')
        .replace(/\[P:([^\]]+)\]\s+(?:of|from)\s+\[C:([^\]]+)\]/gi, '[P:$1] ([C:$2])');

      // Strip forbidden words: "poin bersih", "selisih bersih", "tambahan bersih", "keuntungan bersih", "net points", "net"
      raw = raw
        .replace(/\b(?:poin|selisih|tambahan|keuntungan)\s+bersih\b/gi, (match) => {
          const lower = match.toLowerCase();
          if (lower.startsWith('poin')) return 'poin';
          if (lower.startsWith('selisih')) return 'selisih';
          if (lower.startsWith('tambahan')) return 'tambahan';
          return 'potensi';
        })
        .replace(/\[N:\+?(\d+)\s*(?:poin|pts|points)\s+bersih\]/gi, '[N:+$1 Poin]')
        .replace(/\bnet\s+points?\b/gi, 'points')
        .replace(/\bnet\s+(\[N:[^\]]+\])/gi, '$1')
        .replace(/\bnet\s+(\d+)/gi, '$1');

      // Enforce singular entity rule for 1 team:
      // 1 tim adalah entitas tunggal, tidak boleh dideskripsikan sebagai "mereka" (atau "they/them/their").
      // Jika dalam 1 headline hanya merujuk 1 tim, ubah rujukan jamak menjadi rujukan entitas tunggal.
      const teamMatches = raw.match(/\[T:[^\]]+\]/g) || [];
      const isMultipleTeams = teamMatches.length > 1 || /\b(?:kedua|semua|para|antar|beberapa)\s+tim\b/i.test(raw) || /\bboth\s+teams\b/i.test(raw);

      if (!isMultipleTeams) {
        // Indonesian: ubah kata ganti jamak "mereka" untuk 1 tim tunggal
        raw = raw
          .replace(/\bposisi\s+mereka\b/gi, 'posisinya')
          .replace(/\bpoin\s+mereka\b/gi, 'poin tim tersebut')
          .replace(/\bskuad\s+mereka\b/gi, 'skuadnya')
          .replace(/\blangkah\s+mereka\b/gi, 'langkahnya')
          .replace(/\bupaya\s+mereka\b/gi, 'upayanya')
          .replace(/\bpeluang\s+mereka\b/gi, 'peluangnya')
          .replace(/\bambisi\s+mereka\b/gi, 'ambisinya')
          .replace(/\bkeunggulan\s+mereka\b/gi, 'keunggulannya')
          .replace(/\bperforma\s+mereka\b/gi, 'performanya')
          .replace(/\bkeberhasilan\s+mereka\b/gi, 'keberhasilannya')
          .replace(/\bkemenangan\s+mereka\b/gi, 'kemenangannya')
          .replace(/\bbagi\s+mereka\b/gi, 'bagi tim tersebut')
          .replace(/\buntuk\s+mereka\b/gi, 'untuk tim tersebut')
          .replace(/\boleh\s+mereka\b/gi, 'oleh tim tersebut')
          .replace(/\bmembuat\s+mereka\b/gi, 'membuat tim tersebut')
          .replace(/\bmembawa\s+mereka\b/gi, 'membawa tim tersebut')
          .replace(/\bmengantar\s+mereka\b/gi, 'mengantar tim tersebut')
          .replace(/\bmenempatkan\s+mereka\b/gi, 'menempatkan tim tersebut')
          .replace(/\bmelesatkan\s+mereka\b/gi, 'melesatkan tim tersebut')
          .replace(/\bmengangkat\s+mereka\b/gi, 'mengangkat tim tersebut')
          .replace(/\bmendorong\s+mereka\b/gi, 'mendorong tim tersebut')
          .replace(/\bmereka\b/gi, 'tim tersebut');

        // English: replace "they/them/their" when referring to a single team
        raw = raw
          .replace(/\btheir\s+hold\b/gi, 'its hold')
          .replace(/\btheir\s+position\b/gi, 'its position')
          .replace(/\btheir\s+rank\b/gi, 'its rank')
          .replace(/\btheir\s+squad\b/gi, 'its squad')
          .replace(/\btheir\s+points\b/gi, 'its points')
          .replace(/\btheir\s+chances?\b/gi, 'its chance')
          .replace(/\btheir\s+lead\b/gi, 'its lead')
          .replace(/\btheir\s+pursuit\b/gi, 'its pursuit')
          .replace(/\btheir\s+bid\b/gi, 'its bid')
          .replace(/\btheir\s+campaign\b/gi, 'its campaign')
          .replace(/\btheir\b/gi, 'its')
          .replace(/\bfor\s+them\b/gi, 'for the team')
          .replace(/\bto\s+them\b/gi, 'to the team')
          .replace(/\bby\s+them\b/gi, 'by the team')
          .replace(/\bpropels?\s+them\b/gi, 'propels the team')
          .replace(/\blifts?\s+them\b/gi, 'lifts the team')
          .replace(/\bvaults?\s+them\b/gi, 'vaults the team')
          .replace(/\bpushes?\s+them\b/gi, 'pushes the team')
          .replace(/\bhelps?\s+them\b/gi, 'helps the team')
          .replace(/\bthem\b/gi, 'the team')
          .replace(/\bas\s+they\b/gi, 'as the team')
          .replace(/\bwhile\s+they\b/gi, 'while the team')
          .replace(/\bwhere\s+they\b/gi, 'where the team')
          .replace(/\bbefore\s+they\b/gi, 'before the team')
          .replace(/\bafter\s+they\b/gi, 'after the team')
          .replace(/\bthey\b/gi, 'the team');
      }

      // Remove any leftover multiplied / collective loss tag like "sama-sama merugi [N:344 Poin]" or "sama-sama merugi [N:44 poin]"
      raw = raw.replace(/sama-sama\s+merugi\s+\[N:\+?\d+\s*(?:Poin|poin|pts|points)?\]/gi, 'sama-sama merugi');

      return raw.trim();
    },
    [language]
  );

  // Memoized lists of known teams and players for entity highlighting
  const knownTeams = useMemo(() => {
    const set = new Set<string>();
    if (leagueData?.standings) {
      if (Array.isArray(leagueData.standings)) {
        leagueData.standings.forEach((s) => {
          if (s.entry_name) set.add(s.entry_name.trim());
        });
      } else if (typeof leagueData.standings === 'object') {
        Object.values(leagueData.standings).forEach((list: any) => {
          if (Array.isArray(list)) {
            list.forEach((s: any) => {
              if (s?.entry_name) set.add(String(s.entry_name).trim());
            });
          }
        });
      }
    }
    return Array.from(set).sort((a, b) => b.length - a.length);
  }, [leagueData?.standings]);

  const knownPlayers = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(leagueData?.ownership_players)) {
      leagueData.ownership_players.forEach((p) => {
        if (p.web_name) set.add(p.web_name.trim());
      });
    }
    return Array.from(set).sort((a, b) => b.length - a.length);
  }, [leagueData?.ownership_players]);

  // Helper to parse formatted text with entity highlighting (teams, players, clubs, points/ranks)
  const renderFormattedStory = useCallback(
    (story: NewsTickerStory): HTMLElement => {
      const container = document.createElement('span');
      container.className =
        'inline-flex items-center text-slate-200 font-medium text-[11px] sm:text-[12px] whitespace-nowrap leading-[1.25] shrink-0 align-middle';

      const rawText = getStoryText(story);

      // Check if text has [X:...] tags
      if (/\[(?:T|P|C|N):[^\]]+\]/.test(rawText)) {
        const parts = rawText.split(/(\[(?:T|P|C|N):[^\]]+\])/g);
        for (const part of parts) {
          if (!part) continue;
          const match = part.match(/^\[(T|P|C|N):([^\]]+)\]$/);
          if (match) {
            const type = match[1];
            const val = match[2];
            const node = document.createElement('span');
            if (type === 'T') {
              // Team name: Sky Blue / Cyan (#38bdf8, font-bold)
              node.className = 'text-[#38bdf8] font-bold mx-0.5';
            } else if (type === 'P') {
              // Player name: Neon Green (#00ff87, font-bold)
              node.className = 'text-[#00ff87] font-bold mx-0.5';
            } else if (type === 'C') {
              // EPL Club: Gold / Amber (#fbbf24, font-semibold)
              node.className = 'text-[#fbbf24] font-semibold mx-0.5';
            } else if (type === 'N') {
              // Points / Ranks / Numbers: Pure White Extrabold
              node.className = 'text-white font-extrabold tracking-tight mx-0.5';
            }
            node.textContent = val;
            container.appendChild(node);
          } else {
            const textNode = document.createTextNode(part);
            container.appendChild(textNode);
          }
        }
      } else {
        // Fallback for untagged text: auto-highlight entities using regex patterns
        const eplClubs = [
          'Manchester City', 'Man City', 'Manchester United', 'Man Utd',
          'Aston Villa', 'Crystal Palace', "Nott'm Forest", 'Nottingham Forest',
          'West Ham', 'Arsenal', 'Bournemouth', 'Brentford', 'Brighton', 'Chelsea',
          'Everton', 'Fulham', 'Ipswich Town', 'Ipswich', 'Leicester', 'Liverpool', 'Newcastle',
          'Southampton', 'Spurs', 'Tottenham', 'Wolves', 'Coventry City', 'Coventry',
          'Hull City', 'Hull', 'Leeds', 'Sunderland'
        ];

        interface MatchToken {
          start: number;
          end: number;
          text: string;
          type: 'T' | 'P' | 'C' | 'N';
        }

        const matches: MatchToken[] = [];

        // 1. Numbers / Points / Ranks pattern
        const numRegex = /(?:-?\b\d+\s*(?:poin|pts|points|angka)\b|\b(?:peringkat|posisi|rank)\s*(?:\d+|pertama|kedua)\b|\b(?:top\s*\d+|\d+\s*besar)\b|\bselisih\s*\d+\s*(?:poin|pts)?\b|\b(?:GW|Gameweek)\s*\d+\b)/gi;
        let m: RegExpExecArray | null;
        while ((m = numRegex.exec(rawText)) !== null) {
          matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'N' });
        }

        // 2. Clubs
        for (const club of eplClubs) {
          const clubRegex = new RegExp(`\\b${club.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi');
          while ((m = clubRegex.exec(rawText)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'C' });
          }
        }

        // 3. Known teams
        for (const team of knownTeams) {
          if (team.length < 3) continue;
          const teamRegex = new RegExp(`\\b${team.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi');
          while ((m = teamRegex.exec(rawText)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'T' });
          }
        }

        // 4. Known players
        for (const player of knownPlayers) {
          if (player.length < 3) continue;
          const pRegex = new RegExp(`\\b${player.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'gi');
          while ((m = pRegex.exec(rawText)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], type: 'P' });
          }
        }

        matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
        const nonOverlapping: MatchToken[] = [];
        let lastEnd = 0;
        for (const match of matches) {
          if (match.start >= lastEnd) {
            nonOverlapping.push(match);
            lastEnd = match.end;
          }
        }

        let cursor = 0;
        for (const token of nonOverlapping) {
          if (token.start > cursor) {
            container.appendChild(document.createTextNode(rawText.substring(cursor, token.start)));
          }
          const node = document.createElement('span');
          if (token.type === 'T') {
            node.className = 'text-[#38bdf8] font-bold mx-0.5';
          } else if (token.type === 'P') {
            node.className = 'text-[#00ff87] font-bold mx-0.5';
          } else if (token.type === 'C') {
            node.className = 'text-[#fbbf24] font-semibold mx-0.5';
          } else if (token.type === 'N') {
            node.className = 'text-white font-extrabold tracking-tight mx-0.5';
          }
          node.textContent = token.text;
          container.appendChild(node);
          cursor = token.end;
        }
        if (cursor < rawText.length) {
          container.appendChild(document.createTextNode(rawText.substring(cursor)));
        }
      }

      return container;
    },
    [getStoryText, knownTeams, knownPlayers]
  );

  // Helper to create a single story DOM item (pure typography with entity color-coding, strictly NO icons)
  const createStoryElement = useCallback(
    (story: NewsTickerStory, uid: number, isCycleEnd = false): HTMLElement => {
      const span = document.createElement('span');
      span.className =
        'inline-flex items-center whitespace-nowrap pr-8 leading-[1.25] shrink-0 align-middle select-none';
      span.dataset.uid = String(uid);
      span.dataset.storyId = story.id;
      span.dataset.storySig = `${story.id}::${story.headline_id}|${story.headline_en}`;
      if (isCycleEnd) {
        span.dataset.cycleEnd = '1';
      }

      // Render entity highlighted content
      const content = renderFormattedStory(story);
      span.appendChild(content);

      // Minimalist bullet dot separator (NO ICONS / NO EMOJIS)
      // Official champions receive golden accent dot (#fbbf24) for visual prestige
      const isOfficialChamp =
        story.id.startsWith('CF_') ||
        story.headline_id.includes('Juara Resmi') ||
        story.headline_id.includes('hasil resmi yang sudah ditetapkan');
      const dot = document.createElement('span');
      dot.className = isOfficialChamp
        ? 'inline-block w-1.5 h-1.5 rounded-full ml-6 shrink-0 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] align-middle'
        : 'inline-block w-1.5 h-1.5 rounded-full ml-6 shrink-0 bg-[#00ff87]/70 align-middle';
      span.appendChild(dot);

      return span;
    },
    [renderFormattedStory]
  );

  // Get next story in sequence with persistent index, consecutive-duplicate guard,
  // and 90-second identical-text P3 Heartbeat re-air guard (gracefully falling back when pool is tiny).
  // Note: poin_tayang increment is triggered only when the element physically finishes scrolling off the left edge.
  const getNextStory = useCallback((): { story: NewsTickerStory; isCycleEnd: boolean } | null => {
    const list = storiesRef.current;
    if (list.length === 0) {
      return null;
    }

    const startIdx = poolIdxRef.current % list.length;
    const now = Date.now();
    const isThrottledP3 = (s: NewsTickerStory): boolean => {
      if (s.newsroom_tier !== 'P3') return false;
      const prev = lastAiredP3Ref.current.get(s.id);
      if (!prev) return false;
      const sigText = `${s.headline_id}|${s.headline_en}`;
      return prev.text === sigText && now - prev.ts < 90000;
    };

    let pickedIdx = -1;
    // Pass 1: respect both consecutive-duplicate guard and 90s P3 re-air guard
    for (let offset = 0; offset < list.length; offset++) {
      const idx = (startIdx + offset) % list.length;
      const cand = list[idx];
      if (list.length > 1 && cand.id === lastQueuedStoryIdRef.current) continue;
      if (isThrottledP3(cand)) continue;
      pickedIdx = idx;
      break;
    }

    // Pass 2 fallback: respect at least consecutive-duplicate guard if all P3s are within cooldown
    if (pickedIdx === -1) {
      for (let offset = 0; offset < list.length; offset++) {
        const idx = (startIdx + offset) % list.length;
        if (list.length > 1 && list[idx].id === lastQueuedStoryIdRef.current) continue;
        pickedIdx = idx;
        break;
      }
    }

    if (pickedIdx === -1) {
      pickedIdx = startIdx;
    }

    const item = list[pickedIdx];
    const nextIdx = (pickedIdx + 1) % list.length;
    const wrappedCycle = nextIdx === 0 || pickedIdx < startIdx;
    poolIdxRef.current = nextIdx;
    lastQueuedStoryIdRef.current = item.id;
    try {
      sessionStorage.setItem(POOL_IDX_STORAGE_KEY, String(poolIdxRef.current));
    } catch {}

    return {
      story: item,
      isCycleEnd: wrappedCycle,
    };
  }, []);

  // Initialize track buffer from Editor-sourced stories only
  const fillTrackInitial = useCallback(() => {
    const track = trackRef.current;
    const container = containerRef.current;
    if (!track || !container) return;

    track.innerHTML = '';
    currentXRef.current = 0;
    track.style.transform = 'translate3d(0, 0, 0)';
    lastQueuedStoryIdRef.current = null;

    if (storiesRef.current.length === 0) {
      return;
    }

    const minWidth = (container.clientWidth || window.innerWidth || 1200) + 1200;
    let currentWidth = 0;
    let safetyCounter = 0;

    while (currentWidth < minWidth && safetyCounter < 25) {
      const next = getNextStory();
      if (!next) break;
      const el = createStoryElement(next.story, nextUidRef.current++, next.isCycleEnd);
      track.appendChild(el);
      currentWidth += el.offsetWidth || 350;
      safetyCounter++;
    }
  }, [getNextStory, createStoryElement]);

  const reportStoryAiredRef = useRef(reportStoryAired);
  reportStoryAiredRef.current = reportStoryAired;
  const getNextStoryRef = useRef(getNextStory);
  getNextStoryRef.current = getNextStory;
  const createStoryElementRef = useRef(createStoryElement);
  createStoryElementRef.current = createStoryElement;
  const fillTrackInitialRef = useRef(fillTrackInitial);
  fillTrackInitialRef.current = fillTrackInitial;

  // Seamless transition when newly produced news arrives or phase changes:
  // "Habiskan dulu tampilan 1 berita yang sedang tampil di layar. News baru tersebut tampil sebagai berita berikutnya tepat setelahnya."
  const handleIncomingStories = useCallback(
    (newStories: NewsTickerStory[], incomingPhase?: string | null, incomingGw?: number | null, isCycleRotationArg = false) => {
      const track = trackRef.current;
      const container = containerRef.current;
      const prevPhase = activePhaseRef.current;
      const prevGw = activeGwRef.current;
      const isGwChanged = Boolean(
        prevGw !== null &&
        incomingGw !== null &&
        incomingGw !== undefined &&
        prevGw !== incomingGw
      );
      const isPhaseChanged = Boolean(
        prevPhase &&
        incomingPhase &&
        normalizePhaseName(prevPhase) !== normalizePhaseName(incomingPhase)
      );
      if (incomingPhase) {
        activePhaseRef.current = incomingPhase;
      }
      if (incomingGw !== null && incomingGw !== undefined) {
        activeGwRef.current = incomingGw;
      }

      if (!Array.isArray(newStories) || newStories.length === 0) {
        storiesRef.current = [];
        setStories([]);
        if (isPhaseChanged || isGwChanged) {
          poolIdxRef.current = 0;
          lastAiredP3Ref.current.clear();
          lastQueuedStoryIdRef.current = null;
          try {
            sessionStorage.setItem(POOL_IDX_STORAGE_KEY, '0');
          } catch {}
        }
        if (track) {
          track.innerHTML = '';
          currentXRef.current = 0;
          track.style.transform = 'translate3d(0, 0, 0)';
        }
        return;
      }

      // On Gameweek transition, purge all previous-GW items immediately so zero old-GW news leaks
      if (isGwChanged) {
        storiesRef.current = newStories;
        setStories(newStories);
        poolIdxRef.current = 0;
        lastAiredP3Ref.current.clear();
        lastQueuedStoryIdRef.current = null;
        try {
          sessionStorage.setItem(POOL_IDX_STORAGE_KEY, '0');
        } catch {}
        if (track && container) {
          fillTrackInitial();
        }
        return;
      }

      const currentList = storiesRef.current;

      // Initial load: when we had no stories before
      if (currentList.length === 0) {
        storiesRef.current = newStories;
        setStories(newStories);
        if (isPhaseChanged) {
          poolIdxRef.current = 0;
          lastAiredP3Ref.current.clear();
          lastQueuedStoryIdRef.current = null;
          try {
            sessionStorage.setItem(POOL_IDX_STORAGE_KEY, '0');
          } catch {}
        }
        if (track && container) {
          fillTrackInitial();
        }
        return;
      }

      // Check for genuinely new breaking stories OR material score/breaking updates.
      // Live Match rules:
      // - Only P1 & P2 can trigger mid-cycle interrupt; P3, P4, FALLBACK never interrupt.
      // - LM_MATCH_SCORE_LIVE interrupts ONLY when score_sig changes (actual goal or HT transition), NOT on minute ticks.
      // - Incremental DC counts (e.g. 10->11->12) and Standings updates do NOT re-interrupt.
      const isLiveMatchIncoming = normalizePhaseName(incomingPhase || prevPhase) === 'live match';
      const isLiveScoreStory = (s: NewsTickerStory) => s.id.startsWith('LM_MATCH_SCORE_LIVE');
      const isInterruptibleTier = (s: NewsTickerStory): boolean => {
        if (!isLiveMatchIncoming) return !isLiveScoreStory(s);
        if (s.newsroom_tier) {
          return s.newsroom_tier === 'P1' || s.newsroom_tier === 'P2';
        }
        return !isLiveScoreStory(s);
      };

      const prevById = new Map<string, NewsTickerStory>(currentList.map((s) => [s.id, s]));
      const newIds = new Set(newStories.map((s) => s.id));
      const freshStories = newStories.filter((s) => !prevById.has(s.id) && isInterruptibleTier(s));
      const updatedStories = newStories.filter((s) => {
        const prev = prevById.get(s.id);
        if (!prev) return false;
        if (isLiveMatchIncoming) {
          if (isLiveScoreStory(s)) {
            return Boolean(s.score_sig && prev.score_sig && s.score_sig !== prev.score_sig);
          }
          if (
            s.id.startsWith('LM_MATCH_DEFENSIVE_CONTRIBUTION') ||
            s.id.startsWith('LM_STANDINGS_')
          ) {
            return false;
          }
          if (!isInterruptibleTier(s)) return false;
        } else if (isLiveScoreStory(s)) {
          return false;
        }
        return prev.headline_id !== s.headline_id || prev.headline_en !== s.headline_en;
      });
      const hasRemovals = currentList.some((s) => !newIds.has(s.id));

      // Always update stored reference to latest data
      storiesRef.current = newStories;
      setStories(newStories);

      const isCycleRotation = Boolean(isCycleRotationArg && !isPhaseChanged && !isGwChanged);

      // If neither phase change, cycle rotation, interrupt-eligible breaking IDs/updates, nor removals occurred:
      // DO NOT reset queue or playback position! Let the continuous conveyor keep scrolling uninterrupted.
      if (!isPhaseChanged && !isCycleRotation && freshStories.length === 0 && updatedStories.length === 0 && !hasRemovals) {
        return;
      }

      if (!track || !container) return;

      const containerWidth = container.clientWidth || window.innerWidth || 1200;
      let currentPos = currentXRef.current;
      let keepEndIndex = -1;

      // Preserve EVERY element from index 0 up through the rightmost element currently
      // visible inside [0, containerWidth) so NO visible headline is ever cut off mid-scroll
      // and currentXRef.current stays 100% aligned with track.children[0].
      for (let i = 0; i < track.children.length; i++) {
        const child = track.children[i] as HTMLElement;
        const childWidth = child.offsetWidth;
        const leftPos = currentPos;

        if (leftPos < containerWidth) {
          keepEndIndex = i;
        } else {
          break;
        }

        currentPos += childWidth;
      }

      if (keepEndIndex < 0 && track.children.length > 0) {
        keepEndIndex = 0;
      }

      const activeChildren: HTMLElement[] = [];
      for (let i = 0; i <= keepEndIndex; i++) {
        activeChildren.push(track.children[i] as HTMLElement);
      }

      const keepSet = new Set(activeChildren);
      const toRemove: HTMLElement[] = [];
      for (let i = 0; i < track.children.length; i++) {
        const child = track.children[i] as HTMLElement;
        if (!keepSet.has(child)) {
          toRemove.push(child);
        }
      }
      toRemove.forEach((el) => track.removeChild(el));

      const lastRetainedId =
        activeChildren.length > 0
          ? activeChildren[activeChildren.length - 1]?.dataset?.storyId || null
          : null;
      lastQueuedStoryIdRef.current = lastRetainedId;

      if (isPhaseChanged || isCycleRotation) {
        // Clear any stale cycleEnd marker on retained items so they don't re-trigger cycle refresh early
        for (const ac of activeChildren) {
          if (ac.dataset.cycleEnd === '1') {
            delete ac.dataset.cycleEnd;
          }
        }

        let nextCycleStartIdx = 0;
        if (isPhaseChanged) {
          lastAiredP3Ref.current.clear();
        } else if (isCycleRotation && newStories.length > activeChildren.length + 1) {
          // Skip leading stories of the new cycle that are already visibly airing on screen right now
          const activeSigs = new Set(
            activeChildren.map((el) => el.dataset.storySig || el.dataset.storyId || '')
          );
          while (
            nextCycleStartIdx < newStories.length - 1 &&
            activeSigs.has(
              `${newStories[nextCycleStartIdx].id}::${newStories[nextCycleStartIdx].headline_id}|${newStories[nextCycleStartIdx].headline_en}`
            )
          ) {
            nextCycleStartIdx++;
          }
        }

        poolIdxRef.current = nextCycleStartIdx;
        try {
          sessionStorage.setItem(POOL_IDX_STORAGE_KEY, String(nextCycleStartIdx));
        } catch {}
      } else {
        // Same phase mid-cycle: keep poolIdx aligned with removed off-screen buffer items so none get skipped
        let restoredIdx = -1;
        for (const el of toRemove) {
          const sid = el.dataset.storyId;
          if (!sid) continue;
          const found = newStories.findIndex((s) => s.id === sid);
          if (found !== -1) {
            restoredIdx = found;
            break;
          }
        }
        if (restoredIdx !== -1) {
          poolIdxRef.current = restoredIdx;
        } else if (lastRetainedId) {
          const lastIdx = newStories.findIndex((s) => s.id === lastRetainedId);
          poolIdxRef.current =
            lastIdx !== -1
              ? (lastIdx + 1) % newStories.length
              : poolIdxRef.current % newStories.length;
        } else {
          poolIdxRef.current = poolIdxRef.current % newStories.length;
        }

        // Inject P1/P2 interrupts right after visible items, transferring cycleEnd marker if present
        const priorityQueue = [...freshStories, ...updatedStories].slice(0, 14);
        if (priorityQueue.length > 0) {
          let transferredCycleEnd = false;
          for (const ac of activeChildren) {
            if (ac.dataset.cycleEnd === '1') {
              delete ac.dataset.cycleEnd;
              transferredCycleEnd = true;
            }
          }
          priorityQueue.forEach((storyItem, pIdx) => {
            const isLastInjected = pIdx === priorityQueue.length - 1;
            const el = createStoryElement(
              storyItem,
              nextUidRef.current++,
              transferredCycleEnd && isLastInjected
            );
            track.appendChild(el);
            lastQueuedStoryIdRef.current = storyItem.id;
          });
        }
      }

      // Fill track buffer up to minWidth continuing sequence from newStories pool
      const minWidth = containerWidth + 1200;
      let totalWidth = currentXRef.current;
      for (let i = 0; i < track.children.length; i++) {
        totalWidth += (track.children[i] as HTMLElement).offsetWidth;
      }

      let safety = 0;
      while (totalWidth < minWidth && safety < 25) {
        const next = getNextStory();
        if (!next) break;
        const el = createStoryElement(next.story, nextUidRef.current++, next.isCycleEnd);
        track.appendChild(el);
        totalWidth += el.offsetWidth || 350;
        safety++;
      }

      console.log(
        `[News Ticker] ${isPhaseChanged ? `Phase transition (${prevPhase} -> ${incomingPhase})` : isCycleRotation ? 'Wave cycle rotated' : 'Stories updated'}; kept ${activeChildren.length} airing item(s), queued ${newStories.length} items for phase "${incomingPhase || 'current'}".`
      );
    },
    [createStoryElement, fillTrackInitial, getNextStory]
  );
  handleIncomingStoriesRef.current = handleIncomingStories;

  // Smooth in-place text update when user switches language without resetting track position
  useEffect(() => {
    const track = trackRef.current;
    if (!track || track.children.length === 0) return;

    for (let i = 0; i < track.children.length; i++) {
      const child = track.children[i] as HTMLElement;
      const storyId = child.dataset.storyId;
      if (storyId) {
        const story = storiesRef.current.find((s) => s.id === storyId);
        if (story && child.firstElementChild) {
          const newContent = renderFormattedStory(story);
          child.replaceChild(newContent, child.firstElementChild);
        }
      }
    }
  }, [language, renderFormattedStory]);

  const hasStories = stories.length > 0;

  // Main 60 FPS Continuous Conveyor Loop (Translate3d, sub-pixel accuracy, pause on hover)
  // Decoupled from prop/state changes so the ticker continuously rolls across Editor-sourced items
  useEffect(() => {
    if (!isVisible || !hasStories) return;

    if (!trackRef.current || trackRef.current.children.length === 0) {
      fillTrackInitialRef.current();
    }

    let animationFrameId: number;
    const speed = 48; // Comfortable readable reading speed (48 px/sec)

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const deltaSec = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      const track = trackRef.current;
      const container = containerRef.current;

      if (
        !isHoveredRef.current &&
        track &&
        container &&
        container.clientWidth > 0 &&
        storiesRef.current.length > 0
      ) {
        currentXRef.current -= speed * deltaSec;

        const firstChild = track.firstElementChild as HTMLElement;
        if (firstChild) {
          const itemWidth = firstChild.offsetWidth;
          if (itemWidth > 0 && -currentXRef.current >= itemWidth) {
            const exitedStoryId = firstChild.dataset.storyId || '';
            const exitedCycleEnd = firstChild.dataset.cycleEnd === '1';

            // Atomic cycle in 1 frame:
            // 1. Remove left-most exited element
            track.removeChild(firstChild);
            // 2. Compensate offset by exact exited width (zero jitter, zero void)
            currentXRef.current += itemWidth;
            // 3. Increment poin_tayang and record P3 Heartbeat cooldown strictly when story finishes scrolling on screen
            if (exitedStoryId) {
              const exitedStory = storiesRef.current.find((s) => s.id === exitedStoryId);
              if (exitedStory && exitedStory.newsroom_tier === 'P3') {
                lastAiredP3Ref.current.set(exitedStoryId, {
                  ts: Date.now(),
                  text: `${exitedStory.headline_id}|${exitedStory.headline_en}`,
                });
              }
              reportStoryAiredRef.current(exitedStoryId);
            }
            // 4. When last item of a managed cycle (NS/LM/BM/PV/CF) exits, fetch next cycle batch
            const normPhase = normalizePhaseName(activePhaseRef.current);
            const isCycleManagedPhase =
              normPhase === 'not started' ||
              normPhase === 'live match' ||
              normPhase === 'between match' ||
              normPhase === 'provisional' ||
              normPhase === 'confirmed';
            if (
              exitedCycleEnd &&
              isCycleManagedPhase &&
              storiesRef.current.length > 1 &&
              !cycleRefreshPendingRef.current
            ) {
              cycleRefreshPendingRef.current = true;
              if (cycleRefreshTimerRef.current) {
                clearTimeout(cycleRefreshTimerRef.current);
              }
              cycleRefreshTimerRef.current = setTimeout(() => {
                cycleRefreshTimerRef.current = null;
                fetchFeedRef.current(true);
              }, 200);
            }
            // 5. Append next story seamlessly to the right from ongoing round-robin pool
            const next = getNextStoryRef.current();
            if (next) {
              const nextEl = createStoryElementRef.current(
                next.story,
                nextUidRef.current++,
                next.isCycleEnd
              );
              track.appendChild(nextEl);
            }
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
  }, [isVisible, hasStories]);

  if (!isVisible || !hasStories) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="News Ticker"
      className={`relative w-full overflow-hidden flex items-center h-7 py-[2px] sm:py-[2.5px] px-3 bg-[#161a22] border-t border-white/10 select-none ${className}`}
      onMouseEnter={() => {
        isHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
      }}
      onTouchStart={() => {
        isHoveredRef.current = true;
      }}
      onTouchEnd={() => {
        isHoveredRef.current = false;
      }}
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
