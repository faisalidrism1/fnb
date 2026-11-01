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

export default function App() {
  const [data, setData] = useState<TransformedLeagueData | null>(null);
  const dataRef = useRef<TransformedLeagueData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Smart Loading state: ALWAYS show loading transition screen on cold start / browser reopen until fresh API data is fetched
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [smartLoadingMessage, setSmartLoadingMessage] = useState<string>('Connecting to Premier League API...');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<MainTab>('STANDINGS');
  const [selectedGW, setSelectedGW] = useState<number>(5);
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
  const fetchData = useCallback(async (isInitialBoot = false, forceSync = false) => {
    try {
      if (!isInitialBoot) {
        setIsSyncing(true);
      }
      const shouldForce = isInitialBoot || forceSync;
      const url = shouldForce ? `/api/fpl-data?sync=1&_t=${Date.now()}` : `/api/fpl-data?_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const cleanData = deduplicateLeagueData(json.data);

          // Update state with fresh API data
          setData(cleanData);
          dataRef.current = cleanData;

          // Update selectedGW if default
          if (cleanData.available_gws && cleanData.available_gws.length > 0) {
            setSelectedGW(prev => {
              if (!cleanData.available_gws.includes(prev)) {
                return Math.max(...cleanData.available_gws);
              }
              return prev;
            });
          } else if (cleanData.current_gw) {
            setSelectedGW(cleanData.current_gw);
          }

          saveToIndexedDB(cleanData).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[FetchData] Error fetching FPL league data:', e);
      // On network failure during initial boot, recover with cached data from IndexedDB as emergency offline fallback
      if (isInitialBoot) {
        try {
          const localData = await loadFromIndexedDB();
          if (localData) {
            const cleanLocal = deduplicateLeagueData(localData);
            setData(cleanLocal);
            dataRef.current = cleanLocal;
            showToast('Offline Mode: Menampilkan data lokal terakhir.');
          }
        } catch {}
      }
    } finally {
      setIsSyncing(false);
      if (isInitialBoot) {
        setIsInitializing(false);
      }
    }
  }, []);

  // Boot sequence: always fetch live fresh data on browser launch/reopen
  useEffect(() => {
    let isMounted = true;

    async function bootApp() {
      setSmartLoadingMessage('Connecting to Premier League API...');
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

    // Auto catch-up when returning to tab: if data >= 60s old, refresh smoothly in background
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const lastSync = dataRef.current?.sync_status?.last_synced;
        const lastSyncMs = lastSync ? new Date(lastSync).getTime() : 0;
        if (Date.now() - lastSyncMs >= 60 * 1000) {
          console.log('[Tab Focus] Data is older than 60s, performing background auto-sync...');
          fetchData(false, true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  // Periodic Auto-Sync: Every 60 seconds (1 minute), automatically fetch fresh data from FPL API
  useEffect(() => {
    console.log('[AutoSync] 1-minute auto sync timer active.');
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        console.log('[AutoSync] 1-minute timer reached: refreshing live league data...');
        fetchData(false, true);
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchData]);

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
          saveToIndexedDB(cleanData).catch(() => {});
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
      showToast('⚠️ Sync failed or rate-limited. Retaining current data.');
    } finally {
      setIsSyncing(false);
    }
  };

  if (isInitializing || !data) {
    return (
      <SmartLoadingScreen
        message={smartLoadingMessage}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans selection:bg-[#00ff87] selection:text-[#37003c]">
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
