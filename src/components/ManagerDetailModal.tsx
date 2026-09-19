import React from 'react';
import { X, Trophy, AlertTriangle, Zap, Crown, User, Shield } from 'lucide-react';
import { StandingsRow } from '../types.ts';

interface ManagerDetailModalProps {
  entryId: number | null;
  onClose: () => void;
  selectedGW: number;
  standings: Record<number, StandingsRow[]>;
}

export const ManagerDetailModal: React.FC<ManagerDetailModalProps> = ({
  entryId,
  onClose,
  selectedGW,
  standings,
}) => {
  if (!entryId) return null;

  const currentStanding = (standings[selectedGW] || []).find((s) => s.entry_id === entryId);

  // Collect history across all gameweeks
  const gwHistory = Object.entries(standings)
    .map(([gwStr, list]) => {
      const gw = Number(gwStr);
      const rowList = (list || []) as StandingsRow[];
      const item = rowList.find((s) => s.entry_id === entryId);
      return {
        gw,
        item,
      };
    })
    .filter((h) => h.item !== undefined)
    .sort((a, b) => a.gw - b.gw);

  if (!currentStanding) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-[#37003c] text-white p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#00ff87] text-[#24002b] text-[10px] font-black px-2 py-0.5 rounded">
                Rank #{currentStanding.rank}
              </span>
              <h3 className="font-black text-lg">{currentStanding.entry_name}</h3>
            </div>
            <p className="text-xs text-purple-200 mt-0.5">
              Manager: <strong className="text-white">{currentStanding.player_name}</strong> • Entry ID: {entryId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
          {/* Key Metrics for Selected GW */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Points</span>
              <span className="text-xl font-black text-slate-900 block mt-0.5">
                {currentStanding.total_points}
              </span>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
              <span className="text-[10px] text-purple-600 font-bold uppercase block">GW{selectedGW} Score</span>
              <span className="text-xl font-black text-[#37003c] block mt-0.5">
                {currentStanding.event_points}
              </span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">GW{selectedGW} Hits</span>
              <span className="text-xl font-black text-rose-700 block mt-0.5">
                -{currentStanding.event_transfers_cost}
              </span>
            </div>
          </div>

          {/* Captaincy for Selected GW */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
              <Crown className="w-4 h-4 text-amber-500" />
              <span>GW{selectedGW} Captaincy Decisions</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Captain (C)</span>
                  <p className="font-black text-slate-900">
                    {currentStanding.captain?.name || '-'}
                  </p>
                  <p className="text-[10px] text-slate-500">{currentStanding.captain?.club}</p>
                </div>
                <span className="font-black text-purple-900 text-sm">
                  {currentStanding.captain?.points || 0} pts
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Vice-Captain (V)</span>
                  <p className="font-black text-slate-900">
                    {currentStanding.vice_captain?.name || '-'}
                  </p>
                  <p className="text-[10px] text-slate-500">{currentStanding.vice_captain?.club}</p>
                </div>
                <span className="font-black text-slate-700 text-sm">
                  {currentStanding.vice_captain?.points || 0} pts
                </span>
              </div>
            </div>

            {currentStanding.active_chip && (
              <div className="mt-2 bg-[#37003c] text-[#00ff87] p-2 rounded-lg flex items-center justify-between">
                <span className="font-bold text-xs">Active Chip in GW{selectedGW}:</span>
                <span className="font-black text-xs uppercase px-2 py-0.5 bg-black/40 rounded">
                  {currentStanding.active_chip}
                </span>
              </div>
            )}
          </div>

          {/* Gameweek History Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 p-2.5 border-b border-slate-200 font-extrabold text-slate-900 text-xs">
              Gameweek-by-Gameweek Progression
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 text-[10px] uppercase font-extrabold">
                <tr>
                  <th className="py-2 px-3">GW</th>
                  <th className="py-2 px-3 text-right">Points</th>
                  <th className="py-2 px-3 text-right">Hits</th>
                  <th className="py-2 px-3 text-right">Rank</th>
                  <th className="py-2 px-3 text-center">Chip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gwHistory.map(({ gw, item }) => (
                  <tr
                    key={gw}
                    className={gw === selectedGW ? 'bg-purple-50/60 font-bold' : ''}
                  >
                    <td className="py-2 px-3 font-black text-slate-800">GW{gw}</td>
                    <td className="py-2 px-3 text-right font-black text-purple-900">
                      {item?.event_points}
                    </td>
                    <td className="py-2 px-3 text-right text-rose-700">
                      {item?.event_transfers_cost ? `-${item.event_transfers_cost}` : '0'}
                    </td>
                    <td className="py-2 px-3 text-right font-black text-slate-900">
                      #{item?.rank}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {item?.active_chip ? (
                        <span className="bg-[#37003c] text-[#00ff87] text-[10px] font-black px-1.5 py-0.5 rounded">
                          {item.active_chip}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
