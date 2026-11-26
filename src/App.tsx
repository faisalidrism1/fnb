import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
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
import { SettingsModal } from './components/SettingsModal.tsx';
import { AppLoadingScreen } from './components/AppLoadingScreen.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { useSeasonProjections } from './hooks/useSeasonProjections.ts';
import { clearLegacyAdminStorage, isAdminAuthenticated, setAdminToken } from './utils/adminSession.ts';
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  parseSyncTimestamp,
} from './utils/indexedDbCache.ts';
import {
  TransformedLeagueData,
  MainTab,
  StandingsSubTab,
  OwnershipSubTab,
  TransferSubTab,
  CaptainSubTab,
  ProjectionSubTab,
  ScoutSubTab,
  AdminSubTab,
} from './types.ts';
import { getGameweekStatus } from './utils/gwStatus.ts';
import { requestWakeLock, releaseWakeLock } from './utils/wakeLock.ts';
import { useLanguage, Language } from './utils/i18n.ts';

function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  retries = 3
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await importer();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  });
}

const TabProjection = lazyWithRetry(() => import('./components/TabProjection.tsx').then((m) => ({ default: m.TabProjection })));
const TabScout = lazyWithRetry(() => import('./components/TabScout.tsx').then((m) => ({ default: m.TabScout })));
const TabAdmin = lazyWithRetry(() => import('./components/TabAdmin.tsx').then((m) => ({ default: m.TabAdmin })));

function TabLoadingFallback() {
  return (
    <div className="bg-white dark:bg-[#1a0f2e] rounded-2xl border border-slate-200 dark:border-white/10 p-8 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#37003c] dark:border-[#00ff87] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function formatLastUpdated(isoString: string | undefined, lang: Language): string {
  if (!isoString) return lang === 'id' ? 'Baru saja' : 'Just now';
  try {
    const ms = parseSyncTimestamp(isoString);
    const d = ms > 0 ? new Date(ms) : new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const locale = lang === 'en' ? 'en-GB' : 'id-ID';
    const dateFormatted = d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
    const timeFormatted = d.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Jakarta',
      hour12: false,
    });
    return `${dateFormatted}, ${timeFormatted}`;
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
  const { language, t } = useLanguage();
  const [data, setData] = useState<TransformedLeagueData | null>(null);
  const dataRef = useRef<TransformedLeagueData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const [activeTab, setActiveTab] = useState<MainTab>('STANDINGS');
  const [visitedTabs, setVisitedTabs] = useState<Set<MainTab>>(() => new Set(['STANDINGS']));
  const [standingsSubTab, setStandingsSubTab] = useState<StandingsSubTab>('live-table');
  const hasSetInitialSubTabRef = useRef<boolean>(false);
  const [ownershipSubTab, setOwnershipSubTab] = useState<OwnershipSubTab>('most-owned-players');
  const [transferSubTab, setTransferSubTab] = useState<TransferSubTab>('all-transfers');
  const [captainSubTab, setCaptainSubTab] = useState<CaptainSubTab>('most-captained-player');
  const [projectionSubTab, setProjectionSubTab] = useState<ProjectionSubTab>('line-up');
  const [scoutSubTab, setScoutSubTab] = useState<ScoutSubTab>('picks');
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('editor');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const showProjectionAndScout = true;

  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    clearLegacyAdminStorage();
    return isAdminAuthenticated();
  });

  const handleSelectTab = useCallback((tab: MainTab) => {
    if (!showProjectionAndScout && (tab === 'PROJECTION' || tab === 'SCOUT')) {
      setActiveTab('STANDINGS');
      return;
    }
    if (!isAdminUnlocked && tab === 'ADMIN') {
      setActiveTab('STANDINGS');
      return;
    }
    setActiveTab(tab);
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [showProjectionAndScout, isAdminUnlocked]);

  useEffect(() => {
    const handleAdminUnlocked = () => {
      setIsAdminUnlocked(true);
    };
    const handleAdminLocked = () => {
      setIsAdminUnlocked(false);
      setActiveTab((prev) => (prev === 'ADMIN' ? 'STANDINGS' : prev));
    };
    window.addEventListener('fnb:admin-unlocked', handleAdminUnlocked);
    window.addEventListener('fnb:admin-locked', handleAdminLocked);
    return () => {
      window.removeEventListener('fnb:admin-unlocked', handleAdminUnlocked);
      window.removeEventListener('fnb:admin-locked', handleAdminLocked);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-font', "'Plus Jakarta Sans', sans-serif");
    document.documentElement.style.setProperty('--font-sans', "'Plus Jakarta Sans', sans-serif");
    document.body.style.fontFamily = "'Plus Jakarta Sans', sans-serif";

    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const getStoredThemePreference = (): 'system' | 'light' | 'dark' => {
      try {
        const saved = localStorage.getItem('fnb_setting_theme');
        if (saved === 'light' || saved === 'dark') return saved;
      } catch {}
      return 'system';
    };

    const applyThemeToDocument = (preference: 'system' | 'light' | 'dark') => {
      const isDark =
        preference === 'dark' ||
        (preference === 'system' && Boolean(mediaQuery?.matches));
      document.documentElement.classList.toggle('dark', isDark);
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) {
        meta.setAttribute(
          'content',
          preference === 'system' ? 'light dark' : preference
        );
      }
    };

    const syncThemeFromStorage = () => {
      applyThemeToDocument(getStoredThemePreference());
    };

    syncThemeFromStorage();

    const handleSystemThemeChange = () => {
      if (getStoredThemePreference() === 'system') {
        applyThemeToDocument('system');
      }
    };

    const handleThemeSettingChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ key?: string; value?: unknown }>;
      if (customEvent.detail?.key === 'theme') {
        const val = customEvent.detail.value;
        if (val === 'light' || val === 'dark' || val === 'system') {
          applyThemeToDocument(val);
        } else {
          syncThemeFromStorage();
        }
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fnb_setting_theme' || e.key === null) {
        syncThemeFromStorage();
      }
    };

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleSystemThemeChange);
      }
    }
    window.addEventListener('fnb:setting-changed', handleThemeSettingChanged);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleSystemThemeChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(handleSystemThemeChange);
        }
      }
      window.removeEventListener('fnb:setting-changed', handleThemeSettingChanged);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Keep Screen Awake Manager (Screen Wake Lock API lifecycle)
  useEffect(() => {
    const applyWakeLockIfEnabled = async () => {
      const isEnabled = localStorage.getItem('fnb_setting_keep_awake') === 'true';
      if (isEnabled && document.visibilityState === 'visible') {
        await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    };

    applyWakeLockIfEnabled();

    // Re-acquire on visibility change (standard browser behavior: auto-released when tab is hidden)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const isEnabled = localStorage.getItem('fnb_setting_keep_awake') === 'true';
        if (isEnabled) {
          await requestWakeLock();
        }
      } else {
        await releaseWakeLock();
      }
    };

    // React immediately when setting is toggled from SettingsModal
    const handleSettingChanged = (e: any) => {
      if (e.detail?.key === 'keep_awake') {
        if (e.detail.value && document.visibilityState === 'visible') {
          requestWakeLock();
        } else {
          releaseWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('fnb:setting-changed', handleSettingChanged);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('fnb:setting-changed', handleSettingChanged);
      releaseWakeLock();
    };
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
    const timeoutMs = isInitialBoot ? 120000 : 35000;

    try {
      const url = forceSync ? `/api/fpl-data?sync=1&_t=${Date.now()}` : `/api/fpl-data?_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });

      if (res.ok) {
        const json = await res.json();

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
            showToast(t('toast_offline'));
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

        eventSource.addEventListener('connected', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            const serverEpochKey = payload?.projection_epoch_key;
            const currentEpochKey = dataRef.current?.sync_status?.projection_epoch_key;
            if (serverEpochKey && dataRef.current && serverEpochKey !== currentEpochKey) {
              console.log(`[SSE Connected] Server projection epoch changed (${currentEpochKey ?? 'none'} -> ${serverEpochKey}). Refreshing...`);
              setData((prev) => {
                if (!prev) return prev;
                const nextData: TransformedLeagueData = {
                  ...prev,
                  sync_status: {
                    ...(prev.sync_status || ({} as any)),
                    projection_epoch_key: serverEpochKey,
                  },
                };
                dataRef.current = nextData;
                saveToIndexedDB(nextData).catch(() => {});
                return nextData;
              });
              window.dispatchEvent(
                new CustomEvent('fpl:formula-updated', {
                  detail: {
                    projection_epoch_key: serverEpochKey,
                    changed_files: [],
                    timestamp: payload?.checked_at,
                  },
                })
              );
              fetchData(false, false);
            }
          } catch {}
        });

        eventSource.addEventListener('projection_formula_updated', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            const nextEpochKey = payload?.projection_epoch_key;
            console.log(
              `[Dev HotReload] Projection formula updated (${(payload?.changed_files || []).join(', ')}), syncing tabs -> ${nextEpochKey}`
            );
            if (nextEpochKey) {
              setData((prev) => {
                if (!prev) return prev;
                const nextData: TransformedLeagueData = {
                  ...prev,
                  sync_status: {
                    ...(prev.sync_status || ({} as any)),
                    projection_epoch_key: nextEpochKey,
                  },
                };
                dataRef.current = nextData;
                saveToIndexedDB(nextData).catch(() => {});
                return nextData;
              });
            }
            window.dispatchEvent(
              new CustomEvent('fpl:formula-updated', {
                detail: {
                  projection_epoch_key: nextEpochKey,
                  changed_files: payload?.changed_files || [],
                  timestamp: payload?.timestamp,
                },
              })
            );
          } catch (err) {
            console.warn('[SSE] Error processing projection_formula_updated:', err);
          }
        });

        eventSource.addEventListener('sync_complete', (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload && payload.data) {
              console.log('[SSE Stream] Server sync finished. Instantly updating entire application state...');
              const cleanData = deduplicateLeagueData(payload.data);
              setData(cleanData);
              dataRef.current = cleanData;
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

  const seasonEngine = useSeasonProjections({
    leagueData: data ?? undefined,
    currentGW: data?.current_gw,
    availableGWs: data?.available_gws,
    gwStatus: data?.gw_status,
    eventsStatus: data?.events_status,
    syncStatus: data?.sync_status,
    enabled: Boolean(data) && (showProjectionAndScout || isAdminUnlocked),
  });

  // Preload lazy Projection & Scout chunks right after league data renders so tab switches are instant
  useEffect(() => {
    if (!data || !showProjectionAndScout) return;
    const timer = setTimeout(() => {
      import('./components/TabProjection.tsx').catch(() => {});
      import('./components/TabScout.tsx').catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [Boolean(data), showProjectionAndScout]);

  if (!data) {
    return (
      <AppLoadingScreen
        message={t('loading_connecting')}
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

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#00ff87] focus:text-[#37003c] focus:text-xs focus:font-extrabold focus:shadow-lg"
      >
        {language === 'id' ? 'Langsung ke konten utama' : 'Skip to main content'}
      </a>
      {/* Official Header with integrated minimalist tabs */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        syncStatus={data.sync_status}
        currentGW={data.current_gw}
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
        projectionSubTab={projectionSubTab}
        onSelectProjectionSubTab={setProjectionSubTab}
        scoutSubTab={scoutSubTab}
        onSelectScoutSubTab={setScoutSubTab}
        adminSubTab={adminSubTab}
        onSelectAdminSubTab={setAdminSubTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        leagueData={data}
        isAdminUnlocked={isAdminUnlocked}
        showProjectionAndScout={showProjectionAndScout}
      />

      {/* Main Content Area - Preserves mounted tab instances and user filters */}
      <main id="main-content" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-2 sm:pt-2.5 pb-6 focus:outline-none">
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
              playerStats={data.player_stats || []}
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
              playerStats={data.player_stats || []}
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
              playerStats={data.player_stats || []}
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
              standings={data.standings}
              playerStats={data.player_stats || []}
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

          {showProjectionAndScout && visitedTabs.has('PROJECTION') && (
            <div className={activeTab === 'PROJECTION' ? 'block' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <TabProjection
                  leagueData={data}
                  currentGW={data.current_gw}
                  availableGWs={data.available_gws}
                  subTab={projectionSubTab}
                  onSelectSubTab={setProjectionSubTab}
                  onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
                  onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
                  gwStatus={data.gw_status}
                  eventsStatus={data.events_status}
                  syncStatus={data.sync_status}
                  sharedEngine={seasonEngine}
                />
              </Suspense>
            </div>
          )}

          {showProjectionAndScout && visitedTabs.has('SCOUT') && (
            <div className={activeTab === 'SCOUT' ? 'block' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <TabScout
                  leagueData={data}
                  currentGW={data.current_gw}
                  availableGWs={data.available_gws}
                  subTab={scoutSubTab}
                  onSelectSubTab={setScoutSubTab}
                  onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
                  onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
                  gwStatus={data.gw_status}
                  eventsStatus={data.events_status}
                  syncStatus={data.sync_status}
                  active={activeTab === 'SCOUT'}
                  sharedEpochKey={seasonEngine.targetEpochKey}
                  sharedClubs={seasonEngine.clubs}
                  sharedBaseHistoricalGW={seasonEngine.baseHistoricalGW}
                  sharedTargetNextGW={seasonEngine.targetNextGW}
                  sharedClubNextMatchesMap={seasonEngine.clubNextMatchesMap}
                  sharedScheduleByGw={seasonEngine.scheduleByGw}
                  sharedClubGwMatchProjections={seasonEngine.clubGwMatchProjections}
                  playerProjections={seasonEngine.allPlayerFullSeasonProjections}
                  sharedProjectFixture={seasonEngine.projectFixture}
                  sharedScoutSquads={seasonEngine.scoutSquadsPayload}
                  isLoadingSharedScoutSquads={seasonEngine.isLoadingScoutSquads}
                />
              </Suspense>
            </div>
          )}

          {isAdminUnlocked && visitedTabs.has('ADMIN') && (
            <div className={activeTab === 'ADMIN' ? 'block' : 'hidden'}>
              <Suspense fallback={<TabLoadingFallback />}>
                <TabAdmin
                  subTab={adminSubTab}
                  onSelectSubTab={setAdminSubTab}
                  leagueData={data}
                  currentGW={data.current_gw}
                  availableGWs={data.available_gws}
                  gwStatus={data.gw_status}
                  eventsStatus={data.events_status}
                  syncStatus={data.sync_status}
                  active={activeTab === 'ADMIN'}
                  onSelectManager={(id, gw) => setSelectedManager({ id, gw })}
                  onSelectPlayer={(id, gw) => setSelectedPlayer({ id, gw })}
                  sharedEpochKey={seasonEngine.targetEpochKey}
                  sharedMaxReviewGW={seasonEngine.maxReviewGW}
                  sharedClubs={seasonEngine.clubs}
                  sharedScheduleByGw={seasonEngine.scheduleByGw}
                  sharedClubGwMatchProjections={seasonEngine.clubGwMatchProjections}
                  sharedProjectFixture={seasonEngine.projectFixture}
                  playerProjections={seasonEngine.allPlayerFullSeasonProjections}
                />
              </Suspense>
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* Official Footer */}
      <footer className="bg-white dark:bg-[#140822] border-t border-slate-200 dark:border-purple-950/80 mt-auto py-2 sm:py-2.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col gap-0.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-0.5 sm:gap-4">
            <div className="flex items-center gap-1.5 sm:gap-2 leading-none">
              <span className="font-extrabold text-slate-900 dark:text-white">
                {t('footer_league_name')}
              </span>
              <span>•</span>
              <span>{t('footer_league_id')}</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-slate-400 dark:text-slate-500 leading-none">
              <span>{t('footer_integration')}</span>
              <span>•</span>
              <a
                href="https://fantasy.premierleague.com/leagues/12356/standings/c"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#37003c] dark:text-[#00ff87] font-bold hover:underline flex items-center gap-1"
              >
                <span>{t('footer_fpl_official')}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Human-readable Last Updated timestamp di paling bawah footer */}
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 leading-none">
            <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
            <span>{t('footer_last_updated', { datetime: formatLastUpdated(data?.sync_status?.last_synced, language) })}</span>
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
        currentGW={data.current_gw}
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

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        standings={data?.standings}
        transfers={data?.all_transfers}
        isAdminUnlocked={isAdminUnlocked}
        onUnlockAdmin={() => setIsAdminUnlocked(true)}
        onLockAdmin={() => {
          setAdminToken(null);
          setIsAdminUnlocked(false);
          setActiveTab((prev) => (prev === 'ADMIN' ? 'STANDINGS' : prev));
        }}
      />
    </div>
  );
}
