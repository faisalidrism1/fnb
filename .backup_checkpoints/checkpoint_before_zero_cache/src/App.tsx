import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalLink, Clock } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { TabStandings } from './components/TabStandings.tsx';
import { TabOwnership } from './components/TabOwnership.tsx';
import { TabTransfer } from './components/TabTransfer.tsx';
import { TabCaptain } from './components/TabCaptain.tsx';
import { TabChips } from './components/TabChips.tsx';
import { SyncInfoModal } from './components/SyncInfoModal.tsx';
import { ManagerDetailModal } from './components/ManagerDetailModal.tsx';
import { PlayerDetailModal } from './components/PlayerDetailModal.tsx';
import { SmartLoadingScreen } from './components/SmartLoadingScreen.tsx';
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  isDataNewer,
  isDataStale,
  parseSyncTimestamp,
} from './storage.ts';
import { TransformedLeagueData, MainTab } from './types.ts';
import fallbackData from './data/cachedLeagueData.json';

function formatLastUpdated(isoString?: string): string {
  if (!isoString) return 'Just now';
  try {
    const ms = parseSyncTimestamp(isoString);
    const d = ms > 0 ? new Date(ms) : new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const dateFormatted = d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
    const timeFormatted = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Jakarta',
      hour12: false,
    });
    return `${dateFormatted}, ${timeFormatted} WIB`;
  } catch {
    return isoString;
  }
}

function deduplicateLeagueData(d: TransformedLeagueData): TransformedLeagueData {
  if (!d) return d;
  const clone = { ...d };

  // Deduplicate standings per GW
  if (clone.standings) {
    const newStandings: Record<number, any[]> = {};
    for (const gw of Object.keys(clone.standings)) {
      const numGW = Number(gw);
      const list = clone.standings[numGW];
      if (Array.isArray(list)) {
        const seen = new Set<number>();
        newStandings[numGW] = list.filter((r) => {
          if (r && r.entry_id) {
            if (seen.has(r.entry_id)) return false;
            seen.add(r.entry_id);
          }
          return true;
        });
      } else {
        newStandings[numGW] = list;
      }
    }
    clone.standings = newStandings;
  }

  // Deduplicate all_chips_used
  if (Array.isArray(clone.all_chips_used)) {
    const seen = new Set<number>();
    clone.all_chips_used = clone.all_chips_used.filter((c) => {
      if (c && c.entry_id) {
        if (seen.has(c.entry_id)) return false;
        seen.add(c.entry_id);
      }
      return true;
    });
  }

  // Deduplicate liga_minus
  if (Array.isArray(clone.liga_minus)) {
    const seen = new Set<number>();
    clone.liga_minus = clone.liga_minus.filter((l) => {
      if (l && l.entry_id) {
        if (seen.has(l.entry_id)) return false;
        seen.add(l.entry_id);
      }
      return true;
    });
  }

  // Deduplicate fans_clubs managers
  if (clone.fans_clubs) {
    const newFansClubs: Record<string, any[]> = {};
    for (const key of Object.keys(clone.fans_clubs)) {
      const groups = clone.fans_clubs[key];
      if (Array.isArray(groups)) {
        newFansClubs[key] = groups.map((g) => {
          if (g && Array.isArray(g.managers)) {
            const seen = new Set<number>();
            return {
              ...g,
              managers: g.managers.filter((m: any) => {
                if (m && m.entry_id) {
                  if (seen.has(m.entry_id)) return false;
                  seen.add(m.entry_id);
                }
                return true;
              }),
            };
          }
          return g;
        });
      } else {
        newFansClubs[key] = groups;
      }
    }
    clone.fans_clubs = newFansClubs;
  }

  return clone;
}

const getInitialData = (): TransformedLeagueData => {
  return deduplicateLeagueData(fallbackData as unknown as TransformedLeagueData);
};

export default function App() {
  const [data, setData] = useState<TransformedLeagueData>(getInitialData);
  const dataRef = useRef<TransformedLeagueData>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Smart Loading state: ALWAYS show loading transition screen on cold start / browser reopen until fresh API data is fetched
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [smartLoadingMessage, setSmartLoadingMessage] = useState<string>('Menyinkronkan data API FPL terbaru...');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<MainTab>('STANDINGS');
  const [selectedGW, setSelectedGW] = useState<number>(() => {
    const init = getInitialData();
    const gws = init.available_gws || [];
    return gws.length > 0 ? Math.max(...gws) : (init.current_gw || 5);
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedManager, setSelectedManager] = useState<{ id: number; gw?: number } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; gw?: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch data from server
  const fetchData = useCallback(async (isInitialBoot = false) => {
    try {
      const url = isInitialBoot ? '/api/fpl-data?sync=1' : '/api/fpl-data';
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.isSyncing) {
          setIsSyncing(true);
          // Poll again in 2s to get freshly completed sync data
          setTimeout(() => fetchData(isInitialBoot), 2000);
          return;
        } else {
          setIsSyncing(false);
        }

        if (json.data) {
          const cleanData = deduplicateLeagueData(json.data);

          // Update state with fresh API data
          setData(cleanData);
          dataRef.current = cleanData;
          await saveToIndexedDB(cleanData);

          // If server flagged cache as due for sync in background
          if (json.due_for_sync && !isInitialBoot) {
            setIsSyncing(true);
            setTimeout(() => fetchData(false), 3000);
          }
        }
      }
    } catch (e) {
      console.warn('[FetchData] Error fetching FPL league data:', e);
      // On network failure during initial boot, recover with cached data from IndexedDB
      if (isInitialBoot) {
        try {
          const localData = await loadFromIndexedDB();
          if (localData) {
            const cleanLocal = deduplicateLeagueData(localData);
            setData(cleanLocal);
            dataRef.current = cleanLocal;
          }
        } catch {}
      }
    } finally {
      if (isInitialBoot) {
        setIsInitializing(false);
      }
    }
  }, []);

  // Boot sequence: always sync with API on browser launch/reopen while showing transition screen
  useEffect(() => {
    let isMounted = true;

    async function bootApp() {
      setSmartLoadingMessage('Menghubungkan dan menyinkronkan data API FPL...');
      try {
        await fetchData(true);
      } catch (err) {
        console.warn('[BootApp] Boot sync error:', err);
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    bootApp();

    // Auto catch-up when returning to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  // Periodic polling when matchday is live (every 60 seconds)
  useEffect(() => {
    if (!data?.sync_status?.is_matchday_live) return;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData(false);
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [data?.sync_status?.is_matchday_live, fetchData]);

  // Manual Sync trigger
  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const cleanData = deduplicateLeagueData(json.data);
          setData(cleanData);
          dataRef.current = cleanData;
          await saveToIndexedDB(cleanData);
          showToast('✓ Successfully synced with Official FPL API!');
        } else {
          await fetchData(false);
          showToast('✓ Successfully synced with Official FPL API!');
        }
      } else {
        throw new Error('Sync endpoint returned error');
      }
    } catch (err: any) {
      console.error(err);
      showToast('⚠️ Sync failed or rate-limited. Retaining latest cached data.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans selection:bg-[#00ff87] selection:text-[#37003c]">
      {/* Smart Loading Screen: active only when data is stale on cold start to prevent flashing outdated dates */}
      {isInitializing && (
        <SmartLoadingScreen
          message={smartLoadingMessage}
        />
      )}
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#37003c] text-white px-4 py-3 rounded-xl shadow-2xl border-2 border-[#00ff87] flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-5">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Official Header with integrated minimalist tabs */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        syncStatus={data.sync_status}
        isSyncing={isSyncing}
        onManualSync={handleManualSync}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        currentGW={data.current_gw}
        availableGWs={data.available_gws}
      />

      {/* Main Content Area - Preserves mounted tab instances and user filters */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-2 sm:pt-2.5 pb-6">
        <div className={activeTab === 'STANDINGS' ? 'block' : 'hidden'}>
          <TabStandings
            standings={data.standings}
            gameweekChampions={data.gameweek_champions}
            mostGameweekChampions={data.most_gameweek_champions}
            ligaMinus={data.liga_minus}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            gwStatus={data.gw_status}
            eventsStatus={data.events_status}
            onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
            onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
          />
        </div>

        <div className={activeTab === 'OWNERSHIP' ? 'block' : 'hidden'}>
          <TabOwnership
            ownershipPlayers={data.ownership_players}
            ownershipClubs={data.ownership_clubs}
            fansClubs={data.fans_clubs}
            templateSquads={data.template_squads}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
            onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
          />
        </div>

        <div className={activeTab === 'TRANSFER' ? 'block' : 'hidden'}>
          <TabTransfer
            transfers={data.all_transfers}
            mostTransferredIn={data.transfers_in}
            mostTransferredOut={data.transfers_out}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
            onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
          />
        </div>

        <div className={activeTab === 'CAPTAIN' ? 'block' : 'hidden'}>
          <TabCaptain
            captains={data.captain_players}
            clubCaptains={data.captain_clubs}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
          />
        </div>

        <div className={activeTab === 'CHIPS' ? 'block' : 'hidden'}>
          <TabChips
            chips={data.all_chips_used}
            onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
          />
        </div>
      </main>

      {/* Official Footer */}
      <footer className="bg-white border-t border-slate-200 mt-auto py-2 sm:py-2.5 text-[11px] sm:text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col gap-0.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5 sm:gap-4">
            <div className="flex items-center gap-1.5 sm:gap-2 leading-none">
              <span className="font-extrabold text-slate-900">
                FPL Nusantara BERHADIAH 2026/2027
              </span>
              <span>•</span>
              <span>Mini League ID: 12356</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-slate-400 leading-none">
              <span>Official Premier League FPL Data Integration</span>
              <span>•</span>
              <a
                href="https://fantasy.premierleague.com/leagues/12356/standings/c"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#37003c] font-bold hover:underline flex items-center gap-1"
              >
                <span>FPL Official</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Human-readable Last Updated timestamp di paling bawah footer */}
          <div className="flex items-center gap-1.5 text-slate-400 leading-none">
            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
            <span>Last Updated:</span>
            <span className="font-bold text-slate-700">
              {formatLastUpdated(data?.sync_status?.last_synced)}
            </span>
          </div>
        </div>
      </footer>

      {/* Sync Rules Modal */}
      <SyncInfoModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        syncStatus={data.sync_status}
        onManualSync={handleManualSync}
        isSyncing={isSyncing}
      />

      {/* Manager Details Modal */}
      <ManagerDetailModal
        entryId={selectedManager?.id ?? null}
        onClose={() => setSelectedManager(null)}
        selectedGW={
          selectedManager?.gw ??
          (data.available_gws && data.available_gws.length > 0
            ? Math.max(...data.available_gws)
            : (data.current_gw || 5))
        }
        standings={data.standings}
        onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
      />

      {/* Player Details Modal */}
      {selectedPlayer && (
        <PlayerDetailModal
          playerId={selectedPlayer.id}
          initialGW={
            selectedPlayer.gw ??
            (data.available_gws && data.available_gws.length > 0
              ? Math.max(...data.available_gws)
              : (data.current_gw || 5))
          }
          availableGWs={data.available_gws || []}
          onClose={() => setSelectedPlayer(null)}
          onSelectManager={(id, gw) => {
            setSelectedPlayer(null);
            setSelectedManager({ id, gw });
          }}
          ownershipPlayers={data.ownership_players || {}}
        />
      )}
    </div>
  );
}
