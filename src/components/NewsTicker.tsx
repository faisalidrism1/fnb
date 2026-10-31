import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TransformedLeagueData } from '../types.ts';
import { useLanguage } from '../utils/i18n.ts';

export interface NewsTickerStory {
  id: string;
  headline_id: string;
  headline_en: string;
  drama_score: number;
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
  const handleIncomingStoriesRef = useRef<(newStories: NewsTickerStory[]) => void>(() => {});

  // Fetch news feed from backend
  useEffect(() => {
    let isMounted = true;
    const fetchFeed = async () => {
      try {
        const res = await fetch(`/api/news-ticker/feed?_t=${Date.now()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0 && isMounted) {
            handleIncomingStoriesRef.current(json.data);
          }
        }
      } catch (err) {
        console.warn('[News Ticker] Fetch error:', err);
      }
    };

    fetchFeed();

    // Re-fetch periodically (every 45s if live match, every 2 minutes otherwise)
    const isLive = Boolean(
      leagueData?.sync_status?.is_matchday_live ||
      leagueData?.gw_status?.status === 'Live'
    );
    const intervalTime = isLive ? 45000 : 120000;
    const intervalId = setInterval(fetchFeed, intervalTime);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [leagueData?.current_gw, leagueData?.gw_status?.status, leagueData?.sync_status?.is_matchday_live]);

  // DOM refs & Marquee control
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const currentXRef = useRef<number>(0);
  const isHoveredRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(0);
  const poolIdxRef = useRef<number>(0);
  const nextUidRef = useRef<number>(1);

  // Helper to get text based on current active language, stripping any title prefix (e.g. "Judul: Isi" -> "Isi")
  // and ensuring strictly NO exclamation marks and NO mention of "poin bersih" / "net"
  const getStoryText = useCallback(
    (story: NewsTickerStory): string => {
      let raw = (language === 'en' && story.headline_en)
        ? story.headline_en
        : (story.headline_id || story.headline_en || '');

      if (!raw) return '';

      // Look for a title prefix before colon (e.g. "Kudeta Tahta [N:GW 8]: ...", "Tragedi: ...")
      // Ensure colon is not part of markup tag like "[T:" or "[P:"
      const colonIdx = raw.indexOf(': ');
      if (colonIdx !== -1) {
        const prefix = raw.substring(0, colonIdx);
        const openBrackets = (prefix.match(/\[/g) || []).length;
        const closeBrackets = (prefix.match(/\]/g) || []).length;
        if (openBrackets === closeBrackets) {
          // Balanced brackets, so prefix was indeed a title header followed by ": "
          raw = raw.substring(colonIdx + 2).trim();
        }
      }

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

      return raw.trim();
    },
    [language]
  );

  // Memoized lists of known teams and players for entity highlighting
  const knownTeams = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(leagueData?.standings)) {
      leagueData.standings.forEach((s) => {
        if (s.entry_name) set.add(s.entry_name.trim());
      });
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
    (story: NewsTickerStory, uid: number): HTMLElement => {
      const span = document.createElement('span');
      span.className =
        'inline-flex items-center whitespace-nowrap pr-8 leading-[1.25] shrink-0 align-middle select-none';
      span.dataset.uid = String(uid);
      span.dataset.storyId = story.id;

      // Render entity highlighted content
      const content = renderFormattedStory(story);
      span.appendChild(content);

      // Minimalist bullet dot separator (NO ICONS / NO EMOJIS)
      const dot = document.createElement('span');
      dot.className = 'inline-block w-1.5 h-1.5 rounded-full ml-6 shrink-0 bg-[#00ff87]/70 align-middle';
      span.appendChild(dot);

      return span;
    },
    [renderFormattedStory]
  );

  // Get next story in round-robin sequence
  const getNextStory = useCallback((): NewsTickerStory => {
    const list = storiesRef.current;
    if (list.length === 0) {
      return {
        id: 'fallback_1',
        headline_id: 'FPL Nusantara BERHADIAH • Pantau klasemen dan perebutan 4 gelar juara liga',
        headline_en: 'FPL Nusantara BERHADIAH • Track standings and the race for 4 league championships',
        drama_score: 50,
      };
    }
    const item = list[poolIdxRef.current % list.length];
    poolIdxRef.current = (poolIdxRef.current + 1) % list.length;
    return item;
  }, []);

  // Initialize track buffer on cold start
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

  // Seamless transition when newly produced news arrives:
  // "Habiskan dulu tampilan 1 berita yang sedang tampil di layar. News baru tersebut tampil sebagai berita berikutnya tepat setelahnya."
  const handleIncomingStories = useCallback(
    (newStories: NewsTickerStory[]) => {
      if (!Array.isArray(newStories) || newStories.length === 0) return;

      const track = trackRef.current;
      const container = containerRef.current;

      const currentList = storiesRef.current;
      // Check if new news batch is genuinely different from current
      const isDifferent =
        currentList.length !== newStories.length ||
        newStories.some((item, idx) => {
          const curr = currentList[idx];
          return (
            !curr ||
            curr.id !== item.id ||
            curr.headline_id !== item.headline_id ||
            curr.headline_en !== item.headline_en
          );
        });

      // If stories are identical, continue running without any DOM mutation
      if (!isDifferent && currentList.length > 0) {
        return;
      }

      // Update memory reference & state
      storiesRef.current = newStories;
      setStories(newStories);

      // If track is not yet running or empty, perform initial fill
      if (!track || !container || track.children.length === 0) {
        fillTrackInitial();
        return;
      }

      // Marquee is already actively running on screen!
      // Keep whatever story is currently visible so it finishes completely without interruption
      const containerWidth = container.clientWidth || window.innerWidth || 1200;
      let currentPos = currentXRef.current;
      const visibleChildren: HTMLElement[] = [];

      for (let i = 0; i < track.children.length; i++) {
        const child = track.children[i] as HTMLElement;
        const childWidth = child.offsetWidth;
        const leftPos = currentPos;
        const rightPos = currentPos + childWidth;

        // Keep any element that is currently visible (even partially) on screen
        if (rightPos > 0 && leftPos < containerWidth) {
          visibleChildren.push(child);
        } else if (leftPos >= containerWidth) {
          // Beyond right edge: off-screen queue to be replaced
          break;
        }

        currentPos += childWidth;
      }

      const activeChildren =
        visibleChildren.length > 0
          ? visibleChildren
          : [track.firstElementChild as HTMLElement].filter(Boolean);

      // Remove obsolete off-screen queue elements that haven't entered the screen yet
      const keepSet = new Set(activeChildren);
      const toRemove: HTMLElement[] = [];
      for (let i = 0; i < track.children.length; i++) {
        const child = track.children[i] as HTMLElement;
        if (!keepSet.has(child)) {
          toRemove.push(child);
        }
      }
      toRemove.forEach((el) => track.removeChild(el));

      // Append newly produced news directly behind the active on-screen story
      const minWidth = containerWidth + 1200;
      let totalWidth = currentXRef.current;
      for (let i = 0; i < track.children.length; i++) {
        totalWidth += (track.children[i] as HTMLElement).offsetWidth;
      }

      let newStoryIdx = 0;
      let safetyCounter = 0;
      while (totalWidth < minWidth && safetyCounter < 25) {
        const nextStory = newStories[newStoryIdx % newStories.length];
        const el = createStoryElement(nextStory, nextUidRef.current++);
        track.appendChild(el);
        totalWidth += el.offsetWidth || 350;
        newStoryIdx++;
        safetyCounter++;
      }

      // Set round-robin index so next conveyor cycles continue seamlessly from new batch
      poolIdxRef.current = newStoryIdx % newStories.length;
      console.log(
        `[News Ticker] Successfully scheduled ${newStories.length} new stories directly following the active story.`
      );
    },
    [createStoryElement, fillTrackInitial]
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

  // Main 60 FPS Continuous Conveyor Loop (Translate3d, sub-pixel accuracy, pause on hover)
  useEffect(() => {
    if (!isVisible) return;

    if (!trackRef.current || trackRef.current.children.length === 0) {
      fillTrackInitial();
    }

    let animationFrameId: number;
    const speed = 48; // Comfortable readable reading speed (48 px/sec)

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
            // Atomic cycle in 1 frame:
            // 1. Remove left-most exited element
            track.removeChild(firstChild);
            // 2. Compensate offset by exact exited width (zero jitter, zero void)
            currentXRef.current += itemWidth;
            // 3. Append next story seamlessly to the right
            const nextStory = getNextStory();
            const nextEl = createStoryElement(nextStory, nextUidRef.current++);
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
