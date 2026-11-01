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
                <strong className="text-slate-900">Daily Sync:</strong> Automatically triggered 3 times every day at <strong>07:00 WIB</strong>, <strong>15:00 WIB</strong>, and <strong>16:00 WIB</strong>.
              </li>
              <li>
                <strong className="text-slate-900">Live Matchday Sync:</strong> Every <strong>15 minutes</strong> while Premier League fixtures are actively taking place (starting 1 hour before kickoff through 2.5 hours after kickoff).
              </li>
              <li>
                <strong className="text-slate-900">Mini League Scope:</strong> Filtered strictly for League ID <strong>12356</strong>. Only transformed fields are stored in Convex.
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
