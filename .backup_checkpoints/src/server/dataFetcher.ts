import fs from 'fs';
import path from 'path';
import {
  TransformedLeagueData,
  StandingsRow,
  GWChampionRow,
  MostGWChampionLeader,
  PlayerOwnershipItem,
  PlayerOwnerItem,
  ClubOwnershipItem,
  FansClubGroup,
  TemplateSquadData,
  TransferItem,
  MostTransferredItem,
  LigaMinusItem,
  CaptainPlayerItem,
  ClubCaptainItem,
  ChipUsedRow,
  SyncStatus,
  PositionType,
  GwEventStatus,
  EventDayStatusItem
} from '../types.ts';

const LEAGUE_ID = 12356;
const FPL_BASE = 'https://fantasy.premierleague.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

const POSITION_MAP: Record<number, PositionType> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD'
};

export async function fetchWithRetry(url: string, retries = 3, delayMs = 600): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.ok) {
        return await res.json();
      }
      console.warn(`Fetch ${url} failed with status ${res.status}, retry ${i + 1}/${retries}`);
    } catch (e: any) {
      console.warn(`Fetch ${url} error: ${e.message}, retry ${i + 1}/${retries}`);
    }
    await new Promise(r => setTimeout(r, delayMs * (i + 1)));
  }
  return null;
}

export async function fetchAndTransformLeague(leagueId = LEAGUE_ID): Promise<TransformedLeagueData> {
  console.log(`[FPL Sync] Fetching bootstrap-static...`);
  const bootstrap = await fetchWithRetry(`${FPL_BASE}/bootstrap-static/`);
  if (!bootstrap) {
    throw new Error('Failed to fetch bootstrap-static from official FPL API');
  }

  const currentEventObj = bootstrap.events.find((e: any) => e.is_current) || bootstrap.events.find((e: any) => e.is_next) || bootstrap.events[0];
  const nextEventObj = bootstrap.events.find((e: any) => e.is_next);
  const currentGW = currentEventObj?.id || 1;
  const availableGWs: number[] = bootstrap.events
    .filter((e: any) => e.id <= currentGW)
    .map((e: any) => e.id);

  console.log(`[FPL Sync] Current GW: ${currentGW}, Next GW: ${nextEventObj?.id || 'none'}, Available GWs: ${availableGWs.join(', ')}`);

  console.log(`[FPL Sync] Fetching official event-status...`);
  const eventStatusRaw = await fetchWithRetry(`${FPL_BASE}/event-status/`);

  // Build GW status mapping for all events
  const eventsStatus: Record<number, GwEventStatus> = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (const ev of bootstrap.events) {
    const gwId = ev.id;
    if (gwId > currentGW) {
      eventsStatus[gwId] = {
        event: gwId,
        status: 'Not started',
        days: [],
        data_checked: false,
        finished: false
      };
      continue;
    }

    if (ev.finished && ev.data_checked) {
      eventsStatus[gwId] = {
        event: gwId,
        status: 'Confirmed',
        days: [],
        data_checked: true,
        finished: true
      };
      continue;
    }

    // Current or active GW: parse days from eventStatusRaw
    const rawDays = Array.isArray(eventStatusRaw?.status)
      ? eventStatusRaw.status.filter((s: any) => s.event === gwId)
      : [];

    const daysList: EventDayStatusItem[] = rawDays.map((dItem: any) => {
      let dayName = dItem.date;
      try {
        const dObj = new Date(dItem.date + 'T12:00:00Z');
        dayName = `${dayNames[dObj.getUTCDay()]} ${dObj.getUTCDate()} ${monthNames[dObj.getUTCMonth()]}`;
      } catch {}

      let dayStatus: 'Not started' | 'Provisional' | 'Confirmed' = 'Not started';
      if (dItem.points === 'r') {
        dayStatus = 'Confirmed';
      } else if (dItem.points === 'p') {
        dayStatus = 'Provisional';
      } else {
        dayStatus = 'Not started';
      }

      return {
        date: dItem.date,
        day_name: dayName,
        status: dayStatus,
        points: dItem.points || '',
        bonus_added: !!dItem.bonus_added
      };
    });

    let overallStatus: 'Not started' | 'Provisional' | 'Confirmed' = 'Not started';
    if (ev.finished && ev.data_checked) {
      overallStatus = 'Confirmed';
    } else if (daysList.length > 0) {
      const hasProvisional = daysList.some(d => d.status === 'Provisional');
      const allConfirmed = daysList.every(d => d.status === 'Confirmed');
      const allNotStarted = daysList.every(d => d.status === 'Not started');

      if (hasProvisional) {
        overallStatus = 'Provisional';
      } else if (allConfirmed) {
        overallStatus = 'Confirmed';
      } else if (allNotStarted) {
        overallStatus = 'Not started';
      } else {
        overallStatus = 'Provisional';
      }
    } else if (ev.is_current) {
      overallStatus = 'Provisional';
    }

    eventsStatus[gwId] = {
      event: gwId,
      status: overallStatus,
      days: daysList,
      leagues_status: eventStatusRaw?.leagues || '',
      data_checked: ev.data_checked,
      finished: ev.finished
    };
  }

  const currentGwStatus = eventsStatus[currentGW] || {
    event: currentGW,
    status: 'Provisional',
    days: []
  };

  // Map elements (players) and teams
  const teamMap = new Map<number, any>();
  for (const t of bootstrap.teams) {
    teamMap.set(t.id, {
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      code: t.code,
      badge_url: `https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png`,
      shirt_url: `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${t.code}-66.webp`,
      gk_shirt_url: `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${t.code}_1-66.webp`
    });
  }

  const elementMap = new Map<number, any>();
  for (const el of bootstrap.elements) {
    const t = teamMap.get(el.team);
    elementMap.set(el.id, {
      id: el.id,
      web_name: el.web_name,
      first_name: el.first_name,
      second_name: el.second_name,
      team: el.team,
      team_code: el.team_code,
      team_short_name: t ? t.short_name : 'UNK',
      team_name: t ? t.name : 'Unknown',
      element_type: el.element_type,
      position: POSITION_MAP[el.element_type] || 'MID',
      now_cost: el.now_cost,
      total_points: el.total_points,
      event_points: el.event_points || 0
    });
  }

  // Fetch live points for all available GWs
  const gwLivePointsMap = new Map<number, Map<number, number>>();
  for (const gw of availableGWs) {
    try {
      const liveData = await fetchWithRetry(`${FPL_BASE}/event/${gw}/live/`);
      if (liveData && liveData.elements) {
        const ptsMap = new Map<number, number>();
        for (const item of liveData.elements) {
          ptsMap.set(item.id, item.stats?.total_points || 0);
        }
        gwLivePointsMap.set(gw, ptsMap);
      }
    } catch (e) {
      console.warn(`Could not fetch live points for GW ${gw}:`, e);
    }
  }
  const liveElementPointsMap = gwLivePointsMap.get(currentGW) || new Map<number, number>();

  // Fetch fixtures for current GW and next GW (to ensure entire gameweek and upcoming matches are tracked)
  let activeFixtures: string[] = [];
  let isMatchdayLive = false;
  const gwFixtures: any[] = [];

  const targetFixtureEvents: number[] = [currentGW];
  if (nextEventObj && nextEventObj.id && !targetFixtureEvents.includes(nextEventObj.id)) {
    targetFixtureEvents.push(nextEventObj.id);
  }

  for (const ev of targetFixtureEvents) {
    try {
      const fixtures = await fetchWithRetry(`${FPL_BASE}/fixtures/?event=${ev}`);
      if (fixtures && Array.isArray(fixtures)) {
        const now = Date.now();
        for (const fix of fixtures) {
          if (!fix.kickoff_time) continue;
          const home = teamMap.get(fix.team_h)?.short_name || 'H';
          const away = teamMap.get(fix.team_a)?.short_name || 'A';
          
          gwFixtures.push({
            id: fix.id,
            event: ev,
            home_team: home,
            away_team: away,
            kickoff_time: fix.kickoff_time,
            started: Boolean(fix.started),
            finished: Boolean(fix.finished)
          });

          const kickOff = new Date(fix.kickoff_time).getTime();
          const startWindow = kickOff - 30 * 60 * 1000; // 30 mins before kickoff
          const endWindow = kickOff + 150 * 60 * 1000;  // 2.5 hours after kickoff
          if ((fix.started || (now >= startWindow && now <= endWindow)) && !fix.finished) {
            isMatchdayLive = true;
            activeFixtures.push(`${home} vs ${away}`);
          }
        }
      }
    } catch (e) {
      console.warn(`Could not fetch fixtures for GW ${ev}:`, e);
    }
  }

  // Fetch league standings across all pages (handling pagination for leagues with > 50 entries)
  console.log(`[FPL Sync] Fetching standings for league ${leagueId}...`);
  let leagueName = 'FPL Nusantara BERHADIAH';
  const allEntries: any[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    console.log(`[FPL Sync] Fetching page ${page} of standings for league ${leagueId}...`);
    const standingsData = await fetchWithRetry(`${FPL_BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`);
    if (!standingsData || !standingsData.standings?.results) {
      if (page === 1) {
        throw new Error(`Failed to fetch standings for league ${leagueId}`);
      }
      break;
    }

    if (standingsData.league?.name) {
      leagueName = standingsData.league.name;
    }

    const pageResults = standingsData.standings.results;
    allEntries.push(...pageResults);

    hasNext = Boolean(standingsData.standings.has_next) && pageResults.length > 0;
    page++;

    if (hasNext) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Deduplicate entries by entry ID to prevent duplicates if standings shifted across paginated queries
  const seenEntryIds = new Set<number>();
  const entries: any[] = [];
  for (const ent of allEntries) {
    const id = ent.entry ?? ent.entry_id ?? ent.id;
    if (id && !seenEntryIds.has(id)) {
      seenEntryIds.add(id);
      entries.push(ent);
    }
  }

  console.log(`[FPL Sync] Total ${entries.length} unique teams fetched across ${page - 1} page(s) in league (raw: ${allEntries.length})...`);

  // Fetch history, picks, and transfers for each entry
  // Concurrently with a batch limit to prevent rate limits
  const entryDetails = new Map<number, {
    entry_id: number;
    player_name: string;
    entry_name: string;
    history: any;
    picksByGW: Map<number, any>;
    transfers: any[];
  }>();

  const BATCH_SIZE = 5;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ent: any) => {
        const entryId = ent.entry;
        const [historyRes, transfersRes] = await Promise.all([
          fetchWithRetry(`${FPL_BASE}/entry/${entryId}/history/`),
          fetchWithRetry(`${FPL_BASE}/entry/${entryId}/transfers/`)
        ]);

        const picksByGW = new Map<number, any>();
        // Fetch picks for each available GW
        for (const gw of availableGWs) {
          const picksRes = await fetchWithRetry(`${FPL_BASE}/entry/${entryId}/event/${gw}/picks/`);
          if (picksRes) {
            picksByGW.set(gw, picksRes);
          }
        }

        entryDetails.set(entryId, {
          entry_id: entryId,
          player_name: ent.player_name,
          entry_name: ent.entry_name,
          history: historyRes,
          picksByGW,
          transfers: Array.isArray(transfersRes) ? transfersRes : []
        });
      })
    );
    // Small polite pause between batches
    if (i + BATCH_SIZE < entries.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Calculate Standings per GW
  // Rule: Current mini league rank (rank from sort total points desc and transfers cost asc accumulated GW1 to selected GW)
  // Last mini league rank (rank from sort total points desc and transfers cost asc accumulated GW1 to selected GW - 1)
  const standingsByGW: Record<number, StandingsRow[]> = {};

  for (const gw of availableGWs) {
    const eventObj = bootstrap.events.find((e: any) => e.id === gw);
    const isFinished = Boolean(eventObj?.finished && eventObj?.data_checked);
    const gwLiveMap = gwLivePointsMap.get(gw);

    const rowsForGW: any[] = [];

    for (const ent of entries) {
      const details = entryDetails.get(ent.entry);
      const historyList = details?.history?.current || [];
      const picks = details?.picksByGW.get(gw);
      
      // Calculate accumulated total points and transfers up to gw - 1
      let prevTotalPts = 0;
      let prevTransfersCost = 0;
      let prevTransfersCount = 0;

      for (const h of historyList) {
        if (h.event < gw) {
          prevTotalPts += (h.points - h.event_transfers_cost);
          prevTransfersCost += h.event_transfers_cost;
          prevTransfersCount += h.event_transfers;
        }
      }

      // Transfer hits and count for this gameweek
      const currentH = historyList.find((h: any) => h.event === gw);
      const gwTransfersCost = picks?.entry_history?.event_transfers_cost ?? currentH?.event_transfers_cost ?? 0;
      const gwTransfersCount = picks?.entry_history?.event_transfers ?? currentH?.event_transfers ?? 0;

      // Calculate GW points
      let livePicksSum = 0;
      let hasPicks = false;
      if (picks && Array.isArray(picks.picks) && picks.picks.length > 0) {
        hasPicks = true;
        for (const p of picks.picks) {
          const mult = p.multiplier ?? 0;
          if (mult > 0) {
            const elPts = gwLiveMap?.get(p.element) ?? 0;
            livePicksSum += elPts * mult;
          }
        }
      }

      const officialPoints = (currentH && typeof currentH.points === 'number') ? currentH.points : 0;

      let gwPoints = 0;
      if (isFinished && officialPoints > 0) {
        // GW is officially finalized with confirmed points (including autosubs & final bonus)
        gwPoints = Math.max(officialPoints, hasPicks ? livePicksSum : 0);
      } else {
        // GW is live / ongoing, or individual matches finished
        gwPoints = hasPicks ? livePicksSum : officialPoints;
        if (officialPoints > gwPoints) {
          gwPoints = officialPoints;
        }
      }

      const totalPtsUpToGW = prevTotalPts + (gwPoints - gwTransfersCost);
      const totalTransfersCostUpToGW = prevTransfersCost + gwTransfersCost;
      const totalTransfersCountUpToGW = prevTransfersCount + gwTransfersCount;

      const activeChip = picks?.active_chip || (details?.history?.chips?.find((c: any) => c.event === gw)?.name) || null;

      // Extract Captain & Vice Captain
      let captainInfo = null;
      let viceCaptainInfo = null;

      if (picks && picks.picks) {
        const cap = picks.picks.find((p: any) => p.is_captain);
        const vice = picks.picks.find((p: any) => p.is_vice_captain);
        if (cap) {
          const el = elementMap.get(cap.element);
          const livePts = gwLiveMap ? (gwLiveMap.get(cap.element) ?? 0) : (el?.event_points || 0);
          captainInfo = {
            id: cap.element,
            name: el?.web_name || 'Captain',
            club: el?.team_short_name || '',
            points: livePts * (cap.multiplier || 2),
            multiplier: cap.multiplier || 2
          };
        }
        if (vice) {
          const el = elementMap.get(vice.element);
          const livePts = gwLiveMap ? (gwLiveMap.get(vice.element) ?? 0) : (el?.event_points || 0);
          viceCaptainInfo = {
            id: vice.element,
            name: el?.web_name || 'Vice Captain',
            club: el?.team_short_name || '',
            points: livePts
          };
        }
      }

      rowsForGW.push({
        entry_id: ent.entry,
        player_name: ent.player_name,
        entry_name: ent.entry_name,
        total_points: totalPtsUpToGW,
        event_points: gwPoints,
        event_transfers_cost: gwTransfersCost,
        total_transfers_count: totalTransfersCountUpToGW,
        active_chip: activeChip ? formatChipName(activeChip) : null,
        captain: captainInfo,
        vice_captain: viceCaptainInfo
      });
    }

    // Sort to determine current rank at selected GW:
    // Sort total points DESC, then total transfers ASC
    rowsForGW.sort((a, b) => {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      return a.total_transfers_count - b.total_transfers_count;
    });

    // Compute last GW rank (rank at gw - 1)
    let lastRankMap = new Map<number, number>();
    if (gw > 1) {
      if (standingsByGW[gw - 1]) {
        // Direct exact match with previously calculated and finalized standing of gw - 1
        for (const prevRow of standingsByGW[gw - 1]) {
          lastRankMap.set(prevRow.entry_id, prevRow.rank);
        }
      } else {
        const prevGWRows: any[] = [];
        for (const ent of entries) {
          const details = entryDetails.get(ent.entry);
          const historyList = details?.history?.current || [];
          let totalPtsPrev = 0;
          let totalTransfersPrev = 0;
          for (const h of historyList) {
            if (h.event <= gw - 1) {
              totalPtsPrev += (h.points - h.event_transfers_cost);
              totalTransfersPrev += h.event_transfers;
            }
          }
          prevGWRows.push({
            entry_id: ent.entry,
            total_points: totalPtsPrev,
            total_transfers_count: totalTransfersPrev
          });
        }
        prevGWRows.sort((a, b) => {
          if (b.total_points !== a.total_points) {
            return b.total_points - a.total_points;
          }
          return a.total_transfers_count - b.total_transfers_count;
        });
        prevGWRows.forEach((r, idx) => {
          lastRankMap.set(r.entry_id, idx + 1);
        });
      }
    }

    const finalStandingsRows: StandingsRow[] = rowsForGW.map((row, idx) => {
      const currentRank = idx + 1;
      const lastRank = gw > 1 ? (lastRankMap.get(row.entry_id) || currentRank) : null;
      const rankChange = lastRank !== null ? (lastRank - currentRank) : 0;
      return {
        rank: currentRank,
        last_rank: lastRank,
        rank_change: rankChange,
        entry_id: row.entry_id,
        entry_name: row.entry_name,
        player_name: row.player_name,
        total_points: row.total_points,
        event_points: row.event_points,
        event_transfers_cost: row.event_transfers_cost,
        active_chip: row.active_chip,
        captain: row.captain,
        vice_captain: row.vice_captain
      };
    });

    standingsByGW[gw] = finalStandingsRows;
  }

  // Gameweek Champions Table (GW1 to current GW)
  const gameweekChampions: GWChampionRow[] = [];
  for (const gw of availableGWs) {
    const gwRows = standingsByGW[gw] || [];
    if (gwRows.length === 0) continue;

    // Find highest event_points in this GW
    const maxPoints = Math.max(...gwRows.map(r => r.event_points));
    const championsInGW = gwRows
      .filter(r => r.event_points === maxPoints)
      .map(r => ({
        entry_id: r.entry_id,
        player_name: r.player_name,
        entry_name: r.entry_name,
        points: r.event_points,
        rank_at_gw: r.rank,
        last_rank_at_gw: r.last_rank,
        rank_change_at_gw: r.rank_change
      }));

    const eventObj = bootstrap.events.find((e: any) => e.id === gw);
    const isFinished = Boolean(eventObj?.finished && eventObj?.data_checked);

    gameweekChampions.push({
      event: gw,
      points: maxPoints,
      champions: championsInGW,
      is_finished: isFinished
    });
  }

  // Most Gameweek Champions Leaderboard
  const winCountMap = new Map<number, {
    entry_id: number;
    player_name: string;
    entry_name: string;
    win_count: number;
    gws_won: number[];
  }>();

  for (const ent of entries) {
    winCountMap.set(ent.entry, {
      entry_id: ent.entry,
      player_name: ent.player_name,
      entry_name: ent.entry_name,
      win_count: 0,
      gws_won: []
    });
  }

  for (const gwRow of gameweekChampions) {
    // Include gameweek champions including live leader for ongoing GW
    for (const champ of gwRow.champions) {
      const item = winCountMap.get(champ.entry_id);
      if (item) {
        item.win_count += 1;
        item.gws_won.push(gwRow.event);
      }
    }
  }

  const latestStandings = standingsByGW[currentGW] || [];
  const latestRankMap = new Map<number, number>();
  latestStandings.forEach(s => latestRankMap.set(s.entry_id, s.rank));

  const allWinLeaders = Array.from(winCountMap.values())
    .map(w => ({
      ...w,
      current_rank: latestRankMap.get(w.entry_id) || 999
    }))
    .sort((a, b) => {
      if (b.win_count !== a.win_count) return b.win_count - a.win_count;
      return a.current_rank - b.current_rank;
    });

  // Assign position with ties sharing the same position
  let currentPosition = 1;
  const mostGameweekChampions: MostGWChampionLeader[] = [];
  for (let i = 0; i < allWinLeaders.length; i++) {
    if (i > 0 && allWinLeaders[i].win_count < allWinLeaders[i - 1].win_count) {
      currentPosition = i + 1;
    }
    mostGameweekChampions.push({
      position: currentPosition,
      entry_id: allWinLeaders[i].entry_id,
      player_name: allWinLeaders[i].player_name,
      entry_name: allWinLeaders[i].entry_name,
      win_count: allWinLeaders[i].win_count,
      gws_won: allWinLeaders[i].gws_won,
      current_rank: allWinLeaders[i].current_rank
    });
  }

  // Ownership Analytics
  const ownershipPlayersByGW: Record<number, PlayerOwnershipItem[]> = {};
  const ownershipClubsByGW: Record<number, ClubOwnershipItem[]> = {};
  const templateSquadsByGW: Record<number, TemplateSquadData> = {};

  for (const gw of availableGWs) {
    const playerCounts = new Map<number, number>();
    const clubCounts = new Map<number, number>();
    const playerOwnersMap = new Map<number, PlayerOwnerItem[]>();

    for (const ent of entries) {
      const details = entryDetails.get(ent.entry);
      const picks = details?.picksByGW.get(gw);
      if (picks && picks.picks) {
        for (const p of picks.picks) {
          playerCounts.set(p.element, (playerCounts.get(p.element) || 0) + 1);
          const el = elementMap.get(p.element);
          if (el) {
            clubCounts.set(el.team, (clubCounts.get(el.team) || 0) + 1);
          }

          let oList = playerOwnersMap.get(p.element);
          if (!oList) {
            oList = [];
            playerOwnersMap.set(p.element, oList);
          }
          oList.push({
            entry_id: ent.entry,
            entry_name: ent.entry_name,
            player_name: ent.player_name,
            position_in_squad: p.position,
            is_starter: p.position <= 11,
            is_captain: Boolean(p.is_captain),
            is_vice_captain: Boolean(p.is_vice_captain),
            multiplier: p.multiplier ?? (p.position <= 11 ? 1 : 0),
          });
        }
      }
    }

    // Most Owned Players
    // Tie-break: sort by player total season points (highest to lowest)
    const playerOwnershipList: PlayerOwnershipItem[] = [];
    const gwLiveMap = gwLivePointsMap.get(gw);
    for (const [elId, count] of playerCounts.entries()) {
      const el = elementMap.get(elId);
      if (el) {
        const gwPts = gwLiveMap ? (gwLiveMap.get(elId) ?? 0) : (gw === currentGW ? (el.event_points || 0) : 0);
        const rawOwners = playerOwnersMap.get(elId) || [];
        const sortedOwners = [...rawOwners].sort((a, b) => {
          if (b.multiplier !== a.multiplier) return b.multiplier - a.multiplier;
          if (a.is_starter !== b.is_starter) return a.is_starter ? -1 : 1;
          return a.entry_name.localeCompare(b.entry_name);
        });

        playerOwnershipList.push({
          id: el.id,
          web_name: el.web_name,
          full_name: `${el.first_name} ${el.second_name}`,
          team_name: el.team_name,
          team_short_name: el.team_short_name,
          team_code: el.team_code,
          element_type: el.element_type,
          position: el.position,
          now_cost: el.now_cost,
          total_points: el.total_points,
          gw_points: gwPts,
          owned_count: count,
          owned_percentage: Number(((count / entries.length) * 100).toFixed(1)),
          owners: sortedOwners
        });
      }
    }

    playerOwnershipList.sort((a, b) => {
      if (b.owned_count !== a.owned_count) return b.owned_count - a.owned_count;
      return b.total_points - a.total_points;
    });
    ownershipPlayersByGW[gw] = playerOwnershipList;

    // Most Owned Club Player
    // Ranking KLUB based on total ownership count of ALL players from that club (sum grouped by clubId)
    // Formula: % dihitung dari jumlah pemain club tersebut dibagi total jumlah tim peserta lalu dibagi 3
    const clubOwnershipList: ClubOwnershipItem[] = [];
    for (const t of bootstrap.teams) {
      const count = clubCounts.get(t.id) || 0;
      const percentage = Number(((count / entries.length / 3) * 100).toFixed(1));
      clubOwnershipList.push({
        club_id: t.id,
        name: t.name,
        short_name: t.short_name,
        code: t.code,
        badge_url: `https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png`,
        owned_count: count,
        owned_percentage: percentage
      });
    }
    clubOwnershipList.sort((a, b) => b.owned_count - a.owned_count);
    ownershipClubsByGW[gw] = clubOwnershipList;

    // Template Squad (2 GK, 5 DEF, 5 MID, 3 FWD)
    // Tie-break slot: (1) highest total points, (2) lowest nowCost, (3) smallest fplElementId
    const sortTemplateCandidates = (candidates: PlayerOwnershipItem[]) => {
      return [...candidates].sort((a, b) => {
        if (b.owned_count !== a.owned_count) return b.owned_count - a.owned_count;
        if (b.total_points !== a.total_points) return b.total_points - a.total_points;
        if (a.now_cost !== b.now_cost) return a.now_cost - b.now_cost;
        return a.id - b.id;
      });
    };

    const gks = sortTemplateCandidates(playerOwnershipList.filter(p => p.position === 'GKP')).slice(0, 2);
    const defs = sortTemplateCandidates(playerOwnershipList.filter(p => p.position === 'DEF')).slice(0, 5);
    const mids = sortTemplateCandidates(playerOwnershipList.filter(p => p.position === 'MID')).slice(0, 5);
    const fwds = sortTemplateCandidates(playerOwnershipList.filter(p => p.position === 'FWD')).slice(0, 3);

    const mapTemplateSlot = (p: PlayerOwnershipItem, idx: number, isGk: boolean) => ({
      id: p.id,
      web_name: p.web_name,
      full_name: p.full_name,
      team_short_name: p.team_short_name,
      team_code: p.team_code,
      element_type: p.element_type,
      position: p.position,
      slot_index: idx,
      owned_count: p.owned_count,
      owned_percentage: p.owned_percentage,
      total_points: p.total_points,
      now_cost: p.now_cost,
      is_gk: isGk,
      shirt_url: isGk
        ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${p.team_code}_1-66.webp`
        : `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${p.team_code}-66.webp`
    });

    const templateGks = gks.map((p, idx) => mapTemplateSlot(p, idx, true));
    const templateDefs = defs.map((p, idx) => mapTemplateSlot(p, idx, false));
    const templateMids = mids.map((p, idx) => mapTemplateSlot(p, idx, false));
    const templateFwds = fwds.map((p, idx) => mapTemplateSlot(p, idx, false));

    const totalCost = [...templateGks, ...templateDefs, ...templateMids, ...templateFwds]
      .reduce((sum, p) => sum + p.now_cost, 0);

    templateSquadsByGW[gw] = {
      gks: templateGks,
      defs: templateDefs,
      mids: templateMids,
      fwds: templateFwds,
      total_cost: totalCost
    };
  }

  // Fans Club
  // Per TIM/MANAJER individual: TIM/manajer having 3+ players from the same club in their 15-player squad
  // Filter GW includes "All GW" (having 3+ players from that club in EVERY GW)
  const fansClubsByFilter: Record<string, FansClubGroup[]> = {};

  for (const gw of availableGWs) {
    const clubManagersMap = new Map<number, any[]>();
    for (const ent of entries) {
      const details = entryDetails.get(ent.entry);
      const picks = details?.picksByGW.get(gw);
      if (picks && picks.picks) {
        // Group players by club
        const clubToPlayers = new Map<number, string[]>();
        for (const p of picks.picks) {
          const el = elementMap.get(p.element);
          if (el) {
            const list = clubToPlayers.get(el.team) || [];
            list.push(el.web_name);
            clubToPlayers.set(el.team, list);
          }
        }
        for (const [clubId, players] of clubToPlayers.entries()) {
          if (players.length >= 3) {
            const list = clubManagersMap.get(clubId) || [];
            list.push({
              entry_id: ent.entry,
              entry_name: ent.entry_name,
              player_name: ent.player_name,
              player_count: players.length,
              players
            });
            clubManagersMap.set(clubId, list);
          }
        }
      }
    }

    const groups: FansClubGroup[] = [];
    for (const t of bootstrap.teams) {
      const mgrs = clubManagersMap.get(t.id) || [];
      if (mgrs.length > 0) {
        groups.push({
          club_id: t.id,
          club_name: t.name,
          club_short_name: t.short_name,
          club_code: t.code,
          badge_url: `https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png`,
          managers: mgrs.sort((a, b) => b.player_count - a.player_count)
        });
      }
    }
    fansClubsByFilter[String(gw)] = groups.sort((a, b) => b.managers.length - a.managers.length);
  }

  // "All GW" Fans Club: tim/manajer having 3+ players from the same club in their squad in ALL available GWs
  const allGWClubManagersMap = new Map<number, any[]>();
  for (const ent of entries) {
    const details = entryDetails.get(ent.entry);
    // Find clubs that have 3+ players in EVERY gameweek
    const clubsWith3InAll = new Set<number>();
    for (const t of bootstrap.teams) {
      let isAlways3 = true;
      let lastPlayers: string[] = [];
      for (const gw of availableGWs) {
        const picks = details?.picksByGW.get(gw);
        if (!picks || !picks.picks) {
          isAlways3 = false;
          break;
        }
        const clubPlayers = picks.picks
          .map((p: any) => elementMap.get(p.element))
          .filter((el: any) => el && el.team === t.id)
          .map((el: any) => el.web_name);
        if (clubPlayers.length < 3) {
          isAlways3 = false;
          break;
        }
        lastPlayers = clubPlayers;
      }
      if (isAlways3 && availableGWs.length > 0) {
        const list = allGWClubManagersMap.get(t.id) || [];
        list.push({
          entry_id: ent.entry,
          entry_name: ent.entry_name,
          player_name: ent.player_name,
          player_count: lastPlayers.length,
          players: lastPlayers
        });
        allGWClubManagersMap.set(t.id, list);
      }
    }
  }

  const allGWGroups: FansClubGroup[] = [];
  for (const t of bootstrap.teams) {
    const mgrs = allGWClubManagersMap.get(t.id) || [];
    if (mgrs.length > 0) {
      allGWGroups.push({
        club_id: t.id,
        club_name: t.name,
        club_short_name: t.short_name,
        club_code: t.code,
        badge_url: `https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png`,
        managers: mgrs.sort((a, b) => b.player_count - a.player_count)
      });
    }
  }
  fansClubsByFilter['all'] = allGWGroups.sort((a, b) => b.managers.length - a.managers.length);

  // Transfers
  // All Transfers: sorted by transferTime newest first
  const allTransfers: TransferItem[] = [];
  for (const ent of entries) {
    const details = entryDetails.get(ent.entry);
    if (details && details.transfers) {
      for (const t of details.transfers) {
        const elIn = elementMap.get(t.element_in);
        const elOut = elementMap.get(t.element_out);
        allTransfers.push({
          id: `${ent.entry}-${t.event}-${t.time}-${t.element_in}`,
          time: t.time,
          event: t.event,
          entry_id: ent.entry,
          player_name: ent.player_name,
          entry_name: ent.entry_name,
          element_in: {
            id: t.element_in,
            name: elIn?.web_name || 'Player In',
            club: elIn?.team_short_name || '',
            cost: t.element_in_cost
          },
          element_out: {
            id: t.element_out,
            name: elOut?.web_name || 'Player Out',
            club: elOut?.team_short_name || '',
            cost: t.element_out_cost
          }
        });
      }
    }
  }
  allTransfers.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Most Transferred In / Out
  const transfersInByFilter: Record<string, MostTransferredItem[]> = {};
  const transfersOutByFilter: Record<string, MostTransferredItem[]> = {};

  const processTransfers = (filterKey: string, filteredTransfers: TransferItem[]) => {
    const inMap = new Map<number, number>();
    const outMap = new Map<number, number>();
    for (const t of filteredTransfers) {
      inMap.set(t.element_in.id, (inMap.get(t.element_in.id) || 0) + 1);
      outMap.set(t.element_out.id, (outMap.get(t.element_out.id) || 0) + 1);
    }

    const buildList = (counts: Map<number, number>, targetGW?: number) => {
      const list: MostTransferredItem[] = [];
      const gwLiveMap = targetGW ? gwLivePointsMap.get(targetGW) : undefined;
      for (const [id, count] of counts.entries()) {
        const el = elementMap.get(id);
        if (el) {
          const livePts = gwLiveMap
            ? (gwLiveMap.get(id) ?? 0)
            : (targetGW ? (targetGW === currentGW ? (el.event_points || 0) : 0) : (el.event_points || 0));
          list.push({
            id: el.id,
            web_name: el.web_name,
            team_short_name: el.team_short_name,
            position: el.position,
            now_cost: el.now_cost,
            total_points: el.total_points,
            gw_points: livePts,
            transfer_count: count
          });
        }
      }
      return list.sort((a, b) => {
        if (b.transfer_count !== a.transfer_count) return b.transfer_count - a.transfer_count;
        return b.total_points - a.total_points;
      });
    };

    transfersInByFilter[filterKey] = buildList(inMap, filterKey !== 'all' ? Number(filterKey) : currentGW);
    transfersOutByFilter[filterKey] = buildList(outMap, filterKey !== 'all' ? Number(filterKey) : currentGW);
  };

  processTransfers('all', allTransfers);
  for (const gw of availableGWs) {
    processTransfers(String(gw), allTransfers.filter(t => t.event === gw));
  }

  // Liga Minus
  // Diukur dari TOTAL POIN yang dikorbankan akibat hits sepanjang musim (akumulasi eventTransfersCost)
  // Hanya tampilkan tim/manajer yang point hitnya TIDAK 0
  // Tampilkan current mini liga rank, sort berdasarkan minus hits terbesar
  const ligaMinusList: LigaMinusItem[] = [];
  for (const ent of entries) {
    const details = entryDetails.get(ent.entry);
    const historyList = details?.history?.current || [];
    let totalHitCost = 0;
    for (const gw of availableGWs) {
      const standingRow = standingsByGW[gw]?.find((r) => r.entry_id === ent.entry);
      if (standingRow) {
        totalHitCost += (standingRow.event_transfers_cost || 0);
      } else {
        const h = historyList.find((item: any) => item.event === gw);
        totalHitCost += (h?.event_transfers_cost || 0);
      }
    }
    if (totalHitCost > 0) {
      ligaMinusList.push({
        entry_id: ent.entry,
        entry_name: ent.entry_name,
        player_name: ent.player_name,
        total_minus_points: totalHitCost,
        current_rank: latestRankMap.get(ent.entry) || 999
      });
    }
  }
  ligaMinusList.sort((a, b) => {
    if (b.total_minus_points !== a.total_minus_points) {
      return b.total_minus_points - a.total_minus_points;
    }
    return a.current_rank - b.current_rank;
  });

  // Captaincy Stats
  const captainPlayersByGW: Record<number, CaptainPlayerItem[]> = {};
  const captainClubsByGW: Record<number, ClubCaptainItem[]> = {};

  for (const gw of availableGWs) {
    const capMap = new Map<number, number>();
    const viceMap = new Map<number, number>();
    const clubCapMap = new Map<number, number>();

    for (const ent of entries) {
      const details = entryDetails.get(ent.entry);
      const picks = details?.picksByGW.get(gw);
      if (picks && picks.picks) {
        const cap = picks.picks.find((p: any) => p.is_captain);
        const vice = picks.picks.find((p: any) => p.is_vice_captain);
        if (cap) {
          capMap.set(cap.element, (capMap.get(cap.element) || 0) + 1);
          const el = elementMap.get(cap.element);
          if (el) {
            clubCapMap.set(el.team, (clubCapMap.get(el.team) || 0) + 1);
          }
        }
        if (vice) {
          viceMap.set(vice.element, (viceMap.get(vice.element) || 0) + 1);
        }
      }
    }

    const playerCapList: CaptainPlayerItem[] = [];
    const gwLiveMap = gwLivePointsMap.get(gw);
    for (const [id, count] of capMap.entries()) {
      const el = elementMap.get(id);
      if (el) {
        const livePts = gwLiveMap ? (gwLiveMap.get(id) ?? 0) : (gw === currentGW ? (el.event_points || 0) : 0);
        const viceCount = viceMap.get(id) || 0;
        playerCapList.push({
          id: el.id,
          web_name: el.web_name,
          team_short_name: el.team_short_name,
          team_code: el.team_code,
          position: el.position,
          now_cost: el.now_cost,
          captain_count: count,
          captain_percentage: Number(((count / entries.length) * 100).toFixed(1)),
          vice_count: viceCount,
          vice_percentage: Number(((viceCount / entries.length) * 100).toFixed(1)),
          total_points: el.total_points,
          gw_points: livePts
        });
      }
    }
    playerCapList.sort((a, b) => {
      if (b.captain_count !== a.captain_count) return b.captain_count - a.captain_count;
      return b.total_points - a.total_points;
    });
    captainPlayersByGW[gw] = playerCapList;

    const clubCapList: ClubCaptainItem[] = [];
    let totalCaptainsInGW = 0;
    for (const count of clubCapMap.values()) totalCaptainsInGW += count;

    for (const t of bootstrap.teams) {
      const count = clubCapMap.get(t.id) || 0;
      clubCapList.push({
        club_id: t.id,
        name: t.name,
        short_name: t.short_name,
        code: t.code,
        badge_url: `https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png`,
        captain_count: count,
        captain_percentage: totalCaptainsInGW > 0
          ? Number(((count / totalCaptainsInGW) * 100).toFixed(1))
          : 0
      });
    }
    clubCapList.sort((a, b) => b.captain_count - a.captain_count);
    captainClubsByGW[gw] = clubCapList;
  }

  // Chips Table
  // Columns: WC1, TC1, BB1, FH1, WC2, TC2, BB2, FH2 - sortable
  // Tampilkan SEMUA tim/manajer di liga (yang belum pakai chip ditandai dash)
  // Isi kolom = nomor GW saat chip dipakai (misal "GW15") dan di bawahnya poin GW tersebut
  const allChipsUsed: ChipUsedRow[] = [];

  for (const ent of entries) {
    const details = entryDetails.get(ent.entry);
    const historyList = details?.history?.current || [];
    const chipsList = [...(details?.history?.chips || [])];

    // Merge active chips from picks for all available GWs if not already present in history
    for (const gwNum of availableGWs) {
      const picks = details?.picksByGW.get(gwNum);
      if (picks?.active_chip && !chipsList.some((c: any) => c.event === gwNum)) {
        chipsList.push({ name: picks.active_chip, event: gwNum });
      }
    }

    const getGwPoints = (gwNum: number) => {
      const standingRow = standingsByGW[gwNum]?.find((r) => r.entry_id === ent.entry);
      if (standingRow) return standingRow.event_points;
      const h = historyList.find((item: any) => item.event === gwNum);
      return h ? h.points : 0;
    };

    let wc1: any = null;
    let tc1: any = null;
    let bb1: any = null;
    let fh1: any = null;
    let wc2: any = null;
    let tc2: any = null;
    let bb2: any = null;
    let fh2: any = null;

    for (const chip of chipsList) {
      const cName = chip.name?.toLowerCase();
      const gwNum = chip.event;
      const pts = getGwPoints(gwNum);

      if (cName === 'wildcard') {
        if (gwNum <= 19) wc1 = { gw: gwNum, points: pts };
        else wc2 = { gw: gwNum, points: pts };
      } else if (cName === '3xc') {
        if (gwNum <= 19) tc1 = { gw: gwNum, points: pts };
        else tc2 = { gw: gwNum, points: pts };
      } else if (cName === 'bboost') {
        if (gwNum <= 19) bb1 = { gw: gwNum, points: pts };
        else bb2 = { gw: gwNum, points: pts };
      } else if (cName === 'freehit') {
        if (gwNum <= 19) fh1 = { gw: gwNum, points: pts };
        else fh2 = { gw: gwNum, points: pts };
      }
    }

    allChipsUsed.push({
      entry_id: ent.entry,
      entry_name: ent.entry_name,
      player_name: ent.player_name,
      wc1,
      tc1,
      bb1,
      fh1,
      wc2,
      tc2,
      bb2,
      fh2
    });
  }

  // Calculate next sync time in WIB
  const nextSyncWIB = computeNextSyncWIB(isMatchdayLive, gwFixtures);

  const syncStatus: SyncStatus = {
    last_synced: new Date().toISOString(),
    next_sync_wib: nextSyncWIB,
    is_matchday_live: isMatchdayLive,
    active_fixtures: activeFixtures,
    gw_fixtures: gwFixtures,
    current_gw: currentGW,
    max_gw: 38,
    total_teams: entries.length,
    league_name: leagueName,
    league_id: leagueId
  };

  return {
    league_id: leagueId,
    league_name: leagueName,
    current_gw: currentGW,
    available_gws: availableGWs,
    sync_status: syncStatus,
    gw_status: currentGwStatus,
    events_status: eventsStatus,
    standings: standingsByGW,
    gameweek_champions: [...gameweekChampions].sort((a, b) => b.event - a.event),
    most_gameweek_champions: mostGameweekChampions,
    ownership_players: ownershipPlayersByGW,
    ownership_clubs: ownershipClubsByGW,
    fans_clubs: fansClubsByFilter,
    template_squads: templateSquadsByGW,
    all_transfers: allTransfers,
    transfers_in: transfersInByFilter,
    transfers_out: transfersOutByFilter,
    liga_minus: ligaMinusList,
    captain_players: captainPlayersByGW,
    captain_clubs: captainClubsByGW,
    all_chips_used: allChipsUsed
  };
}

function formatChipName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === '3xc') return 'TC';
  if (lower === 'bboost') return 'BB';
  if (lower === 'wildcard') return 'WC';
  if (lower === 'freehit') return 'FH';
  return raw.toUpperCase();
}

function computeNextSyncWIB(isMatchdayLive: boolean, gwFixtures: any[] = []): string {
  const now = new Date();
  const nowMs = now.getTime();
  const wibOffset = 7 * 60 * 60 * 1000;

  if (isMatchdayLive) {
    const next15 = new Date(nowMs + 15 * 60 * 1000);
    return `${next15.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (15m Matchday)`;
  }

  // Calculate upcoming candidate timestamps:
  const candidateDates: { date: Date; label: string }[] = [];

  // 1. Fixture pre-match window (30m before kickoff) for all upcoming fixtures
  for (const fix of gwFixtures) {
    if (!fix.kickoff_time || fix.finished) continue;
    const kickMs = new Date(fix.kickoff_time).getTime();
    const preMatchMs = kickMs - 30 * 60 * 1000;
    if (preMatchMs > nowMs) {
      candidateDates.push({
        date: new Date(preMatchMs),
        label: `Pre-match 30m (${fix.home_team} vs ${fix.away_team})`
      });
    }
  }

  // 2. Daily sync times (07:00, 15:00, 16:00 WIB)
  const nowWib = new Date(nowMs + wibOffset);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth();
  const d = nowWib.getUTCDate();
  for (const dayOffset of [0, 1]) {
    for (const h of [7, 15, 16]) {
      const targetWib = Date.UTC(y, m, d + dayOffset, h, 0, 0);
      const targetUtc = new Date(targetWib - wibOffset);
      if (targetUtc.getTime() > nowMs) {
        candidateDates.push({
          date: targetUtc,
          label: `${String(h).padStart(2, '0')}:00 WIB Daily`
        });
      }
    }
  }

  candidateDates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextTarget = candidateDates[0];
  if (nextTarget) {
    const targetWib = new Date(nextTarget.date.getTime() + wibOffset);
    const dateStr = `${String(targetWib.getUTCDate()).padStart(2, '0')}/${String(targetWib.getUTCMonth() + 1).padStart(2, '0')}`;
    const timeStr = `${String(targetWib.getUTCHours()).padStart(2, '0')}:${String(targetWib.getUTCMinutes()).padStart(2, '0')} WIB`;
    return `${dateStr} ${timeStr} (${nextTarget.label})`;
  }

  return 'Tomorrow 07:00 WIB';
}
