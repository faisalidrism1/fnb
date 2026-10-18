import React from 'react';

interface SmartLoadingScreenProps {
  message?: string;
}

export const SmartLoadingScreen: React.FC<SmartLoadingScreenProps> = ({
  message = 'Connecting to Premier League API...'
}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#37003c] text-white px-4 select-none overflow-hidden">
      {/* Soft Ambient Radial Background */}
      <div className="absolute w-[450px] h-[450px] rounded-full bg-radial from-[#00ff87]/15 to-transparent blur-2xl pointer-events-none" />

      <div className="relative flex flex-col items-center text-center max-w-sm mx-auto space-y-6 z-10">
        {/* Pristine Original Logo without artificial outer rings */}
        <div className="relative flex items-center justify-center w-[220px] h-[220px]">
          <img
            src="/logo.png"
            alt="FPL Nusantara"
            className="w-[220px] h-[220px] object-contain drop-shadow-[0_12px_30px_rgba(0,0,0,0.65)] select-none pointer-events-none"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>

        {/* Minimalist, Sleek Loading Bar */}
        <div className="w-48 flex flex-col items-center gap-3">
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 bg-gradient-to-r from-[#00ff87] via-[#00e5ff] to-[#00ff87] rounded-full w-2/5 animate-[shimmerSweep_1.5s_infinite_linear]" />
          </div>
          <p className="text-xs font-semibold text-slate-300 tracking-wider uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff87] animate-pulse" />
            <span>{message}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
