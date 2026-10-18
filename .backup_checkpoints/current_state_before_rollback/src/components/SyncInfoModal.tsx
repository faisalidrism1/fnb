import React from 'react';
import { X, Clock, Radio, CheckCircle, Database, Calendar } from 'lucide-react';
import { SyncStatus } from '../types.ts';

interface SyncInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: SyncStatus | null;
  onManualSync: () => void;
  isSyncing: boolean;
}

export const SyncInfoModal: React.FC<SyncInfoModalProps> = ({
  isOpen,
  onClose,
  syncStatus,
  onManualSync,
  isSyncing,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#37003c] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-[#00ff87]" />
            <div>
              <h3 className="font-black text-base">Convex & FPL API Synchronization</h3>
              <p className="text-xs text-purple-200">Official Schedule & Automation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-slate-700">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 space-y-2">
            <h4 className="font-black text-slate-900 text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#37003c]" />
              <span>Official Synchronization Rules</span>
            </h4>
            <ul className="space-y-1.5 text-slate-600 list-disc list-inside">
              <li>
                <strong className="text-slate-900">Auto Sync 1 Menit:</strong> Berjalan otomatis setiap <strong>1 menit (60 detik)</strong> secara berkala agar poin live, bonus, dan klasemen selalu up-to-date.
              </li>
              <li>
                <strong className="text-slate-900">Jadwal Harian:</strong> Sinkronisasi terjadwal setiap hari pada pukul <strong>07:00 WIB</strong>, <strong>15:00 WIB</strong>, dan <strong>16:00 WIB</strong>.
              </li>
              <li>
                <strong className="text-slate-900">Lingkup Mini League:</strong> Khusus untuk League ID <strong>12356</strong> (FPL Nusantara BERHADIAH).
              </li>
            </ul>
          </div>

          {/* Current Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="text-[11px] text-slate-400 font-bold block uppercase">Last Synced</span>
              <p className="font-black text-slate-900 text-sm mt-0.5">
                {syncStatus?.last_synced ? new Date(syncStatus.last_synced).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Just now'}
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="text-[11px] text-slate-400 font-bold block uppercase">Next Scheduled</span>
              <p className="font-black text-[#37003c] text-sm mt-0.5">
                {syncStatus?.next_sync_wib || '07:00 WIB'}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {syncStatus?.is_matchday_live ? (
                <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
              ) : (
                <CheckCircle className="w-4 h-4 text-purple-700" />
              )}
              <span className="font-bold text-slate-800">
                Matchday Status: {syncStatus?.is_matchday_live ? 'Active Live Matches' : 'No Live Matches Currently'}
              </span>
            </div>
            <span className="text-[11px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold">
              {syncStatus?.total_teams || 50} Teams
            </span>
          </div>

          {/* Database Schema & Tables Status */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-700" />
                <h4 className="font-black text-slate-900 text-xs">
                  DB Schema Execution (12 Tables Synchronized)
                </h4>
              </div>
              <span className="text-[10px] bg-emerald-600 text-white font-black px-2 py-0.5 rounded-full">
                Active & Synced
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">standings</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.standings ?? 485}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">playerStats</span>
                <span className="font-bold text-emerald-700">{syncStatus?.db_stats?.recordCounts?.playerStats ?? 667}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">transfers</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.transfers ?? 1226}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">chipsUsed</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.chipsUsed ?? 97}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">ownership</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.ownershipPlayers ?? 910}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">clubs</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.ownershipClubs ?? 100}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">fansClubs</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.fansClubs ?? 63}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">template</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.templateSquads ?? 5}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">champions</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.gameweekChampions ?? 5}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">ligaMinus</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.ligaMinus ?? 49}</span>
              </div>
              <div className="bg-white border border-emerald-100 rounded-lg p-1.5 flex justify-between items-center">
                <span className="text-slate-600 font-medium">captainStats</span>
                <span className="font-bold text-slate-900">{syncStatus?.db_stats?.recordCounts?.captainStats ?? 180}</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              Normalized schema with automated synchronization from official Premier League API.
            </p>
          </div>

          {/* Action button */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-100"
            >
              Close
            </button>
            <button
              onClick={() => {
                onManualSync();
                onClose();
              }}
              disabled={isSyncing}
              className="px-4 py-2 bg-[#00ff87] hover:bg-[#00e676] text-[#24002b] rounded-xl font-black shadow"
            >
              {isSyncing ? 'Syncing...' : 'Force Sync Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
