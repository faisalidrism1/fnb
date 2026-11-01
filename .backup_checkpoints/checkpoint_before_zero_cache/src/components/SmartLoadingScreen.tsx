import React from 'react';
import { RefreshCw } from 'lucide-react';

interface SmartLoadingScreenProps {
  message?: string;
}

export const SmartLoadingScreen: React.FC<SmartLoadingScreenProps> = ({
  message = 'Loading latest FNB League data...'
}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#37003c] text-white px-4 select-none">
      {/* Background ambient glow */}
      <div className="absolute w-72 h-72 rounded-full bg-[#00ff87]/10 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col items-center text-center max-w-sm mx-auto space-y-4">
        {/* Animated Emblem */}
        <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-white/5 border border-white/10 shadow-2xl p-4">
          <img
            src="/logo.png"
            alt="FPL Nusantara"
            className="w-12 h-12 object-contain"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <div className="absolute -bottom-1 -right-1 bg-[#00ff87] text-[#37003c] p-1.5 rounded-full shadow-lg animate-spin">
            <RefreshCw className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Title & Single Status Message */}
        <div className="space-y-2">
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>FPL</span>
            <span className="text-[#00ff87]">Nusantara</span>
            <span>BERHADIAH</span>
          </h2>
          <p className="text-sm font-medium text-slate-200">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
};

