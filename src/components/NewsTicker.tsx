import React, { useState, useEffect, useMemo } from 'react';
import { TransformedLeagueData } from '../types.ts';
import { useLanguage, Language } from '../utils/i18n.ts';

export interface NewsItem {
  tag: string;
  text: string;
}

interface NewsTickerProps {
  leagueData?: TransformedLeagueData | null;
  customText?: string[] | NewsItem[];
  className?: string;
}

const DEFAULT_NEWS_BY_LANG: Record<Language, NewsItem[]> = {
  fnb: [
    { tag: '⚡ FPL NUSANTARA', text: 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes' },
    { tag: '📊 LIVE TRACKING', text: 'Real-time standings, provisional bonus points (BPS), and autosubs calculated automatically' },
    { tag: '🏆 CHAMPION RACE', text: 'Track the race for the league championship and Gameweek Champion crowns' },
    { tag: '👑 SQUAD TRENDS', text: 'Explore most captained picks, template squads, and top transfer movements' },
    { tag: '⚽ MATCHDAY PULSE', text: 'Good luck to all FNB managers in this Gameweek!' },
  ],
  en: [
    { tag: '⚡ FPL NUSANTARA', text: 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes' },
    { tag: '📊 LIVE TRACKING', text: 'Real-time standings, provisional bonus points (BPS), and autosubs calculated automatically' },
    { tag: '🏆 CHAMPION RACE', text: 'Track the race for the league championship and Gameweek Champion crowns' },
    { tag: '👑 SQUAD TRENDS', text: 'Explore most captained picks, template squads, and top transfer movements' },
    { tag: '⚽ MATCHDAY PULSE', text: 'Good luck to all FNB managers in this Gameweek!' },
  ],
  id: [
    { tag: '⚡ FPL NUSANTARA', text: 'Mini League Resmi 12356 • Musim 2026/2027 Berhadiah Uang Tunai Mingguan & Akhir Musim' },
    { tag: '📊 PANTAUAN LIVE', text: 'Klasemen real-time, poin bonus sementara (BPS), dan pergantian otomatis dihitung langsung' },
    { tag: '🏆 PEREBUTAN JUARA', text: 'Pantau persaingan gelar juara liga dan mahkota Juara Gameweek mingguan' },
    { tag: '👑 TREN SKUAD', text: 'Eksplorasi pilihan kapten terpopuler, tim template, dan pergerakan transfer pemain' },
    { tag: '⚽ SELAMAT BERTANDING', text: 'Semoga sukses untuk seluruh manajer FNB di Gameweek ini!' },
  ],
};

/**
 * Generates dynamic news items extracting all available values from official league data based on language
 */
export function generateLeagueNewsItems(
  data?: TransformedLeagueData | null,
  lang: Language = 'fnb'
): NewsItem[] {
  const isId = lang === 'id';
  const defaultItems = DEFAULT_NEWS_BY_LANG[lang] || DEFAULT_NEWS_BY_LANG.fnb;
  if (!data) return defaultItems;
  const items: NewsItem[] = [];
  const currentGW = data.current_gw || 1;

  // 1. League Welcome / Identity Banner
  items.push({
    tag: '⚡ FPL NUSANTARA',
    text: isId
      ? 'Mini League Resmi 12356 • Musim 2026/2027 Berhadiah Uang Tunai Mingguan & Akhir Musim'
      : 'Official Mini League 12356 • Season 2026/2027 with Weekly & Season Cash Prizes',
  });

  // 2. Matchday & Gameweek Lifecycle Status
  const isLive = Boolean(data.sync_status?.is_matchday_live || data.gw_status?.status === 'Live');
  const isProvisional = data.gw_status?.status === 'Provisional';
  const isConfirmed = data.gw_status?.status === 'Confirmed';

  if (isLive) {
    const fixtures = data.sync_status?.gw_fixtures || [];
    const finishedCount = fixtures.filter(f => f.finished || Boolean((f as any).finished_provisional)).length;
    const totalCount = fixtures.length || 10;
    items.push({
      tag: isId ? `🔴 GW ${currentGW} LANGSUNG` : `🔴 GW ${currentGW} LIVE`,
      text: isId
        ? `${finishedCount} dari ${totalCount} laga selesai • Poin bonus BPS live dan autosub dihitung real-time`
        : `${finishedCount} of ${totalCount} matches played • Live bonus points (BPS) and autosubs calculating in real-time`,
    });
  } else if (isProvisional) {
    items.push({
      tag: isId ? `⏳ GW ${currentGW} SEMENTARA` : `⏳ GW ${currentGW} PROVISIONAL`,
      text: isId
        ? 'Semua laga selesai • Menunggu audit final BPS Opta dan verifikasi autosub'
        : 'All matches concluded • Awaiting final Opta bonus point audit and autosub verification',
    });
  } else if (isConfirmed) {
    items.push({
      tag: isId ? `🔒 GW ${currentGW} TERKONFIRMASI` : `🔒 GW ${currentGW} CONFIRMED`,
      text: isId
        ? 'Seluruh poin, bonus points, dan klasemen liga 100% sah dan dikunci oleh FPL'
        : 'All points, bonus points, and league standings are 100% verified and locked by FPL',
    });
  }

  // 3. League Leader (Rank 1 in Standings)
  const gwStandings = data.standings?.[currentGW] || [];
  if (gwStandings.length > 0 && gwStandings[0]) {
    const leader = gwStandings[0];
    items.push({
      tag: isId ? '🏆 PIMPINAN KLASEMEN' : '🏆 LEAGUE LEADER',
      text: isId
        ? `${leader.entry_name} (${leader.player_name}) memimpin klasemen dengan ${leader.total_points} poin`
        : `${leader.entry_name} (${leader.player_name}) sits atop the table with ${leader.total_points} pts`,
    });
  }

  // 4. Gameweek Champion
  const gwChamps = data.gameweek_champions || [];
  const currentGwChampRow = gwChamps.find(c => c.event === currentGW) || gwChamps[gwChamps.length - 1];
  if (currentGwChampRow && Array.isArray(currentGwChampRow.champions) && currentGwChampRow.champions.length > 0) {
    const champNames = currentGwChampRow.champions.map(c => `${c.entry_name} (${c.player_name})`).join(', ');
    items.push({
      tag: isId ? `🎖️ JUARA GW ${currentGwChampRow.event}` : `🎖️ GW ${currentGwChampRow.event} CHAMPION`,
      text: isId
        ? `${champNames} meraih gelar juara Gameweek dengan torehan ${currentGwChampRow.points} poin!`
        : `${champNames} claimed the Gameweek title with an outstanding ${currentGwChampRow.points} pts!`,
    });
  }

  // 5. Most Gameweek Champion Titles Leader
  if (Array.isArray(data.most_gameweek_champions) && data.most_gameweek_champions.length > 0) {
    const topLeader = data.most_gameweek_champions[0];
    if (topLeader.win_count > 0) {
      items.push({
        tag: isId ? '👑 JUARA GW TERBANYAK' : '👑 MOST GW TITLES',
        text: isId
          ? `${topLeader.entry_name} (${topLeader.player_name}) memimpin dengan ${topLeader.win_count} gelar Juara Gameweek`
          : `${topLeader.entry_name} (${topLeader.player_name}) leads with ${topLeader.win_count} Gameweek Champion crown${topLeader.win_count > 1 ? 's' : ''}`,
      });
    }
  }

  // 6. Top Climber (Biggest Rank Mover in current GW)
  const climbers = gwStandings
    .filter(s => typeof s.rank_change === 'number' && s.rank_change > 0)
    .sort((a, b) => b.rank_change - a.rank_change);
  if (climbers.length > 0 && climbers[0].rank_change > 0) {
    const topClimber = climbers[0];
    items.push({
      tag: isId ? '🚀 LONJAKAN TERBESAR' : '🚀 TOP CLIMBER',
      text: isId
        ? `${topClimber.entry_name} melesat naik +${topClimber.rank_change} posisi ke Peringkat #${topClimber.rank} (${topClimber.event_points} poin GW ini)`
        : `${topClimber.entry_name} surged +${topClimber.rank_change} spot${topClimber.rank_change > 1 ? 's' : ''} to Rank #${topClimber.rank} (${topClimber.event_points} pts this GW)`,
    });
  }

  // 7. Most Captained Player in FNB League
  const gwCaptains = data.captain_players?.[currentGW] || [];
  if (gwCaptains.length > 0 && gwCaptains[0]) {
    const cap1 = gwCaptains[0];
    const cap2 = gwCaptains[1];
    let cap2Snippet = '';
    if (cap2) {
      cap2Snippet = isId
        ? `, disusul ${cap2.web_name} (${cap2.captain_count} tim, ${cap2.captain_percentage.toFixed(0)}%)`
        : `, followed by ${cap2.web_name} (${cap2.captain_count} teams, ${cap2.captain_percentage.toFixed(0)}%)`;
    }
    items.push({
      tag: isId ? '👑 PILIHAN KAPTEN' : '👑 CAPTAINCY BATTLE',
      text: isId
        ? `${cap1.web_name} menjadi kapten terpopuler (#1) dipilih ${cap1.captain_count} tim (${cap1.captain_percentage.toFixed(0)}%)${cap2Snippet}`
        : `${cap1.web_name} is the #1 captain pick with ${cap1.captain_count} teams (${cap1.captain_percentage.toFixed(0)}%)${cap2Snippet}`,
    });
  }

  // 8. Most Owned Player (League Template King)
  const gwOwnership = data.ownership_players?.[currentGW] || [];
  if (gwOwnership.length > 0 && gwOwnership[0]) {
    const topOwned = gwOwnership[0];
    items.push({
      tag: isId ? '💎 KEPEMILIKAN TERTINGGI' : '💎 HIGHEST OWNERSHIP',
      text: isId
        ? `${topOwned.web_name} (${topOwned.team_short_name}) dimiliki oleh ${topOwned.owned_percentage.toFixed(0)}% manajer FNB (${topOwned.owned_count} skuad)`
        : `${topOwned.web_name} (${topOwned.team_short_name}) is selected by ${topOwned.owned_percentage.toFixed(0)}% of FNB managers (${topOwned.owned_count} squads)`,
    });
  }

  // 9. Top Transfers In & Out
  const transfersInList = data.transfers_in?.[String(currentGW)] || data.transfers_in?.['all'] || [];
  const transfersOutList = data.transfers_out?.[String(currentGW)] || data.transfers_out?.['all'] || [];
  if (transfersInList.length > 0 || transfersOutList.length > 0) {
    const topIn = transfersInList[0];
    const topOut = transfersOutList[0];
    let inPart = '';
    let outPart = '';
    if (topIn) {
      inPart = isId ? `Paling banyak dibeli: ${topIn.web_name} (+${topIn.transfer_count})` : `Most bought: ${topIn.web_name} (+${topIn.transfer_count})`;
    }
    if (topOut) {
      outPart = isId ? `Paling banyak dijual: ${topOut.web_name} (-${topOut.transfer_count})` : `Most sold: ${topOut.web_name} (-${topOut.transfer_count})`;
    }
    const combined = [inPart, outPart].filter(Boolean).join(' • ');
    if (combined) {
      items.push({
        tag: isId ? '🔄 TREN TRANSFER' : '🔄 TRANSFER TRENDS',
        text: combined,
      });
    }
  }

  // 10. Chips Activated in Current Gameweek
  const chipCounts: Record<string, number> = {};
  gwStandings.forEach(s => {
    if (s.active_chip) {
      const chipName = s.active_chip.toUpperCase();
      chipCounts[chipName] = (chipCounts[chipName] || 0) + 1;
    }
  });
  const chipParts = Object.entries(chipCounts).map(([chip, count]) => `${count} ${chip}`);
  if (chipParts.length > 0) {
    items.push({
      tag: isId ? '🃏 CHIP DIAKTIFKAN' : '🃏 CHIPS IN PLAY',
      text: isId
        ? `${chipParts.join(', ')} diaktifkan oleh manajer FNB pada GW ${currentGW}`
        : `${chipParts.join(', ')} activated by FNB managers in GW ${currentGW}`,
    });
  }

  // 11. Transfer Hits / Points Penalty (Liga Minus)
  const hitTakers = gwStandings
    .filter(s => typeof s.event_transfers_cost === 'number' && s.event_transfers_cost > 0)
    .sort((a, b) => b.event_transfers_cost - a.event_transfers_cost);
  if (hitTakers.length > 0) {
    const topHit = hitTakers[0];
    const totalHitTakers = hitTakers.length;
    items.push({
      tag: isId ? '💀 PENALTI TRANSFER' : '💀 TRANSFER HITS',
      text: isId
        ? `${topHit.entry_name} mengambil penalti transfer -${topHit.event_transfers_cost} poin • Total ${totalHitTakers} manajer terkena penalti poin GW ini`
        : `${topHit.entry_name} took a -${topHit.event_transfers_cost} pts hit • Total ${totalHitTakers} manager${totalHitTakers > 1 ? 's' : ''} took points penalties this GW`,
    });
  }

  // 12. Top Scoring Premier League Player This Gameweek
  if (gwOwnership.length > 0) {
    const topScorer = [...gwOwnership].sort((a, b) => (b.gw_points || 0) - (a.gw_points || 0))[0];
    if (topScorer && typeof topScorer.gw_points === 'number' && topScorer.gw_points > 0) {
      items.push({
        tag: isId ? '🔥 PEMAIN TERBAIK GW' : '🔥 GW TOP PERFORMER',
        text: isId
          ? `${topScorer.web_name} (${topScorer.team_short_name}) mencetak ${topScorer.gw_points} poin di Gameweek ${currentGW}`
          : `${topScorer.web_name} (${topScorer.team_short_name}) delivered ${topScorer.gw_points} pts in Gameweek ${currentGW}`,
      });
    }
  }

  // 13. Upcoming Deadline Countdown
  if (data.sync_status?.next_deadline_time) {
    try {
      const deadlineDate = new Date(data.sync_status.next_deadline_time);
      if (!isNaN(deadlineDate.getTime())) {
        const locale = isId ? 'id-ID' : 'en-GB';
        const formattedDate = deadlineDate.toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Jakarta',
        });
        const formattedTime = deadlineDate.toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta',
          hour12: false,
        });
        const nextGw = currentGW < 38 ? currentGW + 1 : 38;
        items.push({
          tag: isId ? '⏳ BATAS WAKTU' : '⏳ NEXT DEADLINE',
          text: isId
            ? `Batas waktu Gameweek ${nextGw}: ${formattedDate} pukul ${formattedTime} WIB • Pastikan susunan tim & kapten terkunci`
            : `Gameweek ${nextGw} deadline: ${formattedDate} at ${formattedTime} WIB • Lock in squad & captain before cutoff`,
        });
      }
    } catch {}
  }

  return items.length > 0 ? items : defaultItems;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({
  leagueData,
  customText,
  className = '',
}) => {
  const { language } = useLanguage();
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

  // Compute dynamic items from league data or customText
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
    return generateLeagueNewsItems(leagueData, language);
  }, [leagueData, customText, language]);

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
