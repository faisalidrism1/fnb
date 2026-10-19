import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalLink, Clock } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { TabStandings } from './components/TabStandings.tsx';
import { TabMatches } from './components/TabMatches.tsx';
import { TabOwnership } from './components/TabOwnership.tsx';
import { TabTransfer } from './components/TabTransfer.tsx';
import { TabCaptain } from './components/TabCaptain.tsx';
import { TabChips } from './components/TabChips.tsx';
import { ManagerDetailModal } from './components/ManagerDetailModal.tsx';
import { PlayerDetailModal } from './components/PlayerDetailModal.tsx';
import { SmartLoadingScreen } from './components/SmartLoadingScreen.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  parseSyncTimestamp,
} from './storage.ts';
import {
  TransformedLeagueData,
  MainTab,
  StandingsSubTab,
  OwnershipSubTab,
  TransferSubTab,
  CaptainSubTab,
} from './types.ts';
import { getGameweekStatus } from './utils/gwStatus.ts';

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

  // Loading state when container is empty on initial publish/boot
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [smartLoadingMessage, setSmartLoadingMessage] = useState<string>('Connecting to Premier League API...');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<MainTab>('STANDINGS');
  const [standingsSubTab, setStandingsSubTab] = useState<StandingsSubTab>('live-table');
  const hasSetInitialSubTabRef = useRef<boolean>(false);
  const [ownershipSubTab, setOwnershipSubTab] = useState<OwnershipSubTab>('most-owned-players');
  const [transferSubTab, setTransferSubTab] = useState<TransferSubTab>('all-transfers');
  const [captainSubTab, setCaptainSubTab] = useState<CaptainSubTab>('most-captained-player');
  const [selectedGW, setSelectedGW] = useState<number>(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastCheckedTime, setLastCheckedTime] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font', "'Plus Jakarta Sans', sans-serif");
    document.documentElement.style.setProperty('--font-sans', "'Plus Jakarta Sans', sans-serif");
    document.body.style.fontFamily = "'Plus Jakarta Sans', sans-serif";

    // System dark mode listener to sync with user device preference dynamically
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    updateTheme(mediaQuery);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(updateTheme);
      return () => mediaQuery.removeListener(updateTheme);
    }
  }, []);

  // Modals
  const [selectedManager, setSelectedManager] = useState<{ id: number; gw?: number } | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; gw?: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch data from server with defensive timeout (longer for Action A initial full sync)
  const fetchData = useCallback(async (isInitialBoot = false, forceSync = false) => {
    const controller = new AbortController();
    const timeoutMs = isInitialBoot ? 120000 : 35000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (!isInitialBoot) {
        setIsSyncing(true);
      }
      const url = forceSync ? `/api/fpl-data?sync=1&_t=${Date.now()}` : `/api/fpl-data?_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const checkedAt = json.checked_at || json.data?.sync_status?.last_checked || new Date().toISOString();
        setLastCheckedTime(checkedAt);

        if (json.data) {
          const cleanData = deduplicateLeagueData(json.data);

          // Update state with fresh API data
          setData(cleanData);
          dataRef.current = cleanData;

          // Default subtab aktif saat pertama kali dibuka:
          // jika gameweek status confirmed -> subtab "Status", selain itu -> "League Table/Live League table"
          if (!hasSetInitialSubTabRef.current) {
            hasSetInitialSubTabRef.current = true;
            const gw = cleanData.current_gw || 1;
            const gwStatusObj = cleanData.events_status?.[gw] || cleanData.gw_status;
            const { status } = getGameweekStatus(gw, gw, gwStatusObj, cleanData.sync_status);
            if (status === 'Confirmed') {
              setStandingsSubTab('status');
            } else {
              setStandingsSubTab('live-table');
            }
          }

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

          // Broadcast to entire application (all tabs, subtabs, modals, and popups)
          window.dispatchEvent(
            new CustomEvent('fpl:data-synced', {
              detail: {
                lastSynced: cleanData.sync_status?.last_synced,
                currentGW: cleanData.current_gw,
                data: cleanData,
              },
            })
          );
        }
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.warn('[FetchData] Error or timeout fetching FPL league data:', e.message || e);
      // On network failure during initial boot, recover with cached data from IndexedDB as emergency offline fallback
      if (isInitialBoot) {
        try {
          const localData = await loadFromIndexedDB();
          if (localData) {
            const cleanLocal = deduplicateLeagueData(localData);
            setData(cleanLocal);
            dataRef.current = cleanLocal;
            if (!hasSetInitialSubTabRef.current) {
              hasSetInitialSubTabRef.current = true;
              const gw = cleanLocal.current_gw || 1;
              const gwStatusObj = cleanLocal.events_status?.[gw] || cleanLocal.gw_status;
              const { status } = getGameweekStatus(gw, gw, gwStatusObj, cleanLocal.sync_status);
              if (status === 'Confirmed') {
                setStandingsSubTab('status');
              } else {
                setStandingsSubTab('live-table');
              }
            }
            showToast('Offline Mode: Menampilkan data cache lokal.');
          } else {
            setTimeout(() => {
              fetchData(true, false);
            }, 3000);
          }
        } catch {
          setTimeout(() => {
            fetchData(true, false);
          }, 3000);
        }
      }
    } finally {
      setIsSyncing(false);
      setIsInitializing(false);
    }
  }, []);

  // Real-Time Server-Sent Events (SSE) Stream:
  // Instantaneous push from server as soon as sync & calculations finish (<50ms)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: any = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/events');

        eventSource.addEventListener('sync_complete', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload && payload.data) {
              console.log('[SSE Stream] Server sync finished. Instantly updating entire application state...');
              const cleanData = deduplicateLeagueData(payload.data);
              setData(cleanData);
              dataRef.current = cleanData;
              setLastCheckedTime(payload.checked_at || new Date().toISOString());
              saveToIndexedDB(cleanData).catch(() => {});

              // Simultaneously broadcast to all mounted components, active tabs, subtabs, modals, and popups
              window.dispatchEvent(
                new CustomEvent('fpl:data-synced', {
                  detail: {
                    lastSynced: cleanData.sync_status?.last_synced,
                    currentGW: cleanData.current_gw,
                    data: cleanData,
                  },
                })
              );
            }
          } catch (err) {
            console.warn('[SSE] Error processing sync_complete:', err);
          }
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSSE, 4000);
        };
      } catch {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSSE, 4000);
      }
    };

    connectSSE();

    return () => {
      clearTimeout(reconnectTimer);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  // Boot sequence: Trigger Action A on initial boot and catch up when returning to tab
  useEffect(() => {
    fetchData(true, false);

    // Auto catch-up when returning to tab: if data >= 25s old, refresh smoothly in background
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const lastSync = dataRef.current?.sync_status?.last_synced;
        const lastSyncMs = lastSync ? new Date(lastSync).getTime() : 0;
        if (Date.now() - lastSyncMs >= 25 * 1000) {
          console.log('[Tab Focus] Data is older than 25s, performing background auto-sync...');
          fetchData(false, false);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  // Periodic Auto-Sync: 30s during live matches / provisional GW, 60s during confirmed
  const isMatchLive = Boolean(data?.sync_status?.is_matchday_live || (data?.gw_status && data?.gw_status?.status !== 'Confirmed'));
  useEffect(() => {
    const syncIntervalMs = isMatchLive ? 30 * 1000 : 60 * 1000;
    console.log(`[AutoSync] Auto sync timer active (${syncIntervalMs / 1000}s cadence, isLive: ${isMatchLive}).`);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        console.log('[AutoSync] Timer reached: checking status and refreshing live data if needed...');
        fetchData(false, false);
      }
    }, syncIntervalMs);

    return () => clearInterval(interval);
  }, [fetchData, isMatchLive]);

  // Manual Sync trigger
  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        const checkedAt = json.checked_at || json.last_synced || new Date().toISOString();
        setLastCheckedTime(checkedAt);
        if (json.data) {
          const cleanData = deduplicateLeagueData(json.data);
          setData(cleanData);
          dataRef.current = cleanData;
          saveToIndexedDB(cleanData).catch(() => {});
          window.dispatchEvent(
            new CustomEvent('fpl:data-synced', {
              detail: {
                lastSynced: cleanData.sync_status?.last_synced,
                currentGW: cleanData.current_gw,
                data: cleanData,
              },
            })
          );
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

  if (!data) {
    return (
      <SmartLoadingScreen
        message={smartLoadingMessage}
      />
    );
  }

  return (
    <div
      style={{ fontFamily: 'var(--app-font)' }}
      className="min-h-screen bg-[#f8fafc] dark:bg-[#0b0413] text-slate-800 dark:text-slate-100 flex flex-col selection:bg-[#00ff87] selection:text-[#37003c]"
    >
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
        currentGW={data.current_gw}
        availableGWs={data.available_gws}
        gwStatus={data.gw_status}
        eventsStatus={data.events_status}
        standingsSubTab={standingsSubTab}
        onSelectStandingsSubTab={setStandingsSubTab}
        ownershipSubTab={ownershipSubTab}
        onSelectOwnershipSubTab={setOwnershipSubTab}
        transferSubTab={transferSubTab}
        onSelectTransferSubTab={setTransferSubTab}
        captainSubTab={captainSubTab}
        onSelectCaptainSubTab={setCaptainSubTab}
      />

      {/* Main Content Area - Preserves mounted tab instances and user filters */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-2 sm:pt-2.5 pb-6">
        <ErrorBoundary>
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
              syncStatus={data.sync_status}
              subTab={standingsSubTab}
              onSelectSubTab={setStandingsSubTab}
              onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
              onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
            />
          </div>

          <div className={activeTab === 'MATCHES' ? 'block' : 'hidden'}>
            <TabMatches
              currentGW={data.current_gw}
              availableGWs={data.available_gws}
              lastSynced={data.sync_status?.last_synced}
              isMatchLive={isMatchLive}
              isAppVisible={activeTab === 'MATCHES'}
              ownershipPlayers={data.ownership_players}
              transfers={data.all_transfers}
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
              subTab={ownershipSubTab}
              onSelectSubTab={setOwnershipSubTab}
              onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
              onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
            />
          </div>

          <div className={activeTab === 'TRANSFER' ? 'block' : 'hidden'}>
            <TabTransfer
              transfers={data.all_transfers}
              mostTransferredIn={data.transfers_in}
              mostTransferredOut={data.transfers_out}
              ownershipPlayers={data.ownership_players}
              currentGW={data.current_gw}
              availableGWs={data.available_gws}
              subTab={transferSubTab}
              onSelectSubTab={setTransferSubTab}
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
              subTab={captainSubTab}
              onSelectSubTab={setCaptainSubTab}
              onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
            />
          </div>

          <div className={activeTab === 'CHIPS' ? 'block' : 'hidden'}>
            <TabChips
              chips={data.all_chips_used}
              currentGW={data.current_gw}
              onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
            />
          </div>
        </ErrorBoundary>
      </main>

      {/* Official Footer */}
      <footer className="bg-white dark:bg-[#140822] border-t border-slate-200 dark:border-purple-950/80 mt-auto py-2 sm:py-2.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col gap-0.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5 sm:gap-4">
            <div className="flex items-center gap-1.5 sm:gap-2 leading-none">
              <span className="font-extrabold text-slate-900 dark:text-white">
                FPL Nusantara BERHADIAH 2026/2027
              </span>
              <span>•</span>
              <span>Mini League ID: 12356</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-slate-400 dark:text-slate-500 leading-none">
              <span>Official Premier League FPL Data Integration</span>
              <span>•</span>
              <a
                href="https://fantasy.premierleague.com/leagues/12356/standings/c"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#37003c] dark:text-[#00ff87] font-bold hover:underline flex items-center gap-1"
              >
                <span>FPL Official</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Human-readable Last Updated timestamp di paling bawah footer */}
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 leading-none">
            <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
            <span>Last Updated: {formatLastUpdated(data?.sync_status?.last_synced)}</span>
          </div>
        </div>
      </footer>

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
        availableGWs={data.available_gws || []}
        standings={data.standings || {}}
        ownershipPlayers={data.ownership_players || {}}
        transfers={data.all_transfers || []}
        onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
        lastSynced={data.sync_status?.last_synced}
        playerStats={data.player_stats || []}
        gwFixtures={data.sync_status?.gw_fixtures || []}
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
          playerStats={data.player_stats || []}
          standings={data.standings || {}}
          transfers={data.all_transfers || []}
          lastSynced={data.sync_status?.last_synced}
          currentGW={data.current_gw}
          gwFixtures={data.sync_status?.gw_fixtures}
          gwStatus={data.gw_status}
          eventsStatus={data.events_status}
          syncStatus={data.sync_status}
        />
      )}
    </div>
  );
}
