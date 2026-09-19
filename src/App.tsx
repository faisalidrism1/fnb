import React, { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Clock } from 'lucide-react';
import { Header } from './components/Header.tsx';
import { TabStandings } from './components/TabStandings.tsx';
import { TabOwnership } from './components/TabOwnership.tsx';
import { TabTransfer } from './components/TabTransfer.tsx';
import { TabCaptain } from './components/TabCaptain.tsx';
import { TabChips } from './components/TabChips.tsx';
import { SyncInfoModal } from './components/SyncInfoModal.tsx';
import { ManagerDetailModal } from './components/ManagerDetailModal.tsx';
import { TransformedLeagueData, MainTab } from './types.ts';
import fallbackData from './data/cachedLeagueData.json';

function formatLastUpdated(isoString?: string): string {
  if (!isoString) return 'Just now';
  try {
    const d = new Date(isoString);
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

export default function App() {
  const [data, setData] = useState<TransformedLeagueData>(fallbackData as unknown as TransformedLeagueData);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<MainTab>('STANDINGS');
  const [selectedGW, setSelectedGW] = useState<number>(fallbackData.current_gw || 4);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/fpl-data');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setData(json.data);
          setSelectedGW((prev) => (json.data.available_gws.includes(prev) ? prev : json.data.current_gw));
        }
      }
    } catch (e) {
      console.warn('Using embedded cached FPL league data:', e);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Auto catch-up when returning to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchData]);

  // Periodic polling when matchday is live (every 60 seconds)
  useEffect(() => {
    if (!data?.sync_status?.is_matchday_live) return;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData();
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
          setData(json.data);
          setSelectedGW(json.data.current_gw);
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
        selectedGW={selectedGW}
        onSelectGW={setSelectedGW}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-2 sm:pt-2.5 pb-6">
        {activeTab === 'STANDINGS' && (
          <TabStandings
            standings={data.standings}
            gameweekChampions={data.gameweek_champions}
            mostGameweekChampions={data.most_gameweek_champions}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            selectedGW={selectedGW}
            onSelectGW={setSelectedGW}
            onSelectManager={(id) => setSelectedManagerId(id)}
          />
        )}

        {activeTab === 'OWNERSHIP' && (
          <TabOwnership
            ownershipPlayers={data.ownership_players}
            ownershipClubs={data.ownership_clubs}
            fansClubs={data.fans_clubs}
            templateSquads={data.template_squads}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            selectedGW={selectedGW}
            onSelectGW={setSelectedGW}
            onSelectManager={(id) => setSelectedManagerId(id)}
          />
        )}

        {activeTab === 'TRANSFER' && (
          <TabTransfer
            transfers={data.all_transfers}
            mostTransferredIn={data.transfers_in}
            mostTransferredOut={data.transfers_out}
            ligaMinus={data.liga_minus}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            onSelectManager={(id) => setSelectedManagerId(id)}
          />
        )}

        {activeTab === 'CAPTAIN' && (
          <TabCaptain
            captains={data.captain_players}
            clubCaptains={data.captain_clubs}
            currentGW={data.current_gw}
            availableGWs={data.available_gws}
            selectedGW={selectedGW}
            onSelectGW={setSelectedGW}
          />
        )}

        {activeTab === 'CHIPS' && (
          <TabChips
            chips={data.all_chips_used}
            onSelectManager={(id) => setSelectedManagerId(id)}
          />
        )}
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
        entryId={selectedManagerId}
        onClose={() => setSelectedManagerId(null)}
        selectedGW={selectedGW}
        standings={data.standings}
      />
    </div>
  );
}
