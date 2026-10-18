import React from 'react';

interface SmartLoadingScreenProps {
  message?: string;
}

export const SmartLoadingScreen: React.FC<SmartLoadingScreenProps> = ({
  message = 'Connecting to Premier League API...'
}) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#37003c] text-white px-4 select-none overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-[#00ff87]/15 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col items-center text-center max-w-md mx-auto space-y-6">
        {/* Central Logo (250% larger: 280px vs 112px) with Rotating Ring in FRONT */}
        <div className="relative flex items-center justify-center w-[280px] h-[280px]">
          {/* 1. Center Logo (Behind ring: z-0) */}
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <img
              src="/logo.png"
              alt="FPL Nusantara"
              className="w-[280px] h-[280px] object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)] select-none pointer-events-none"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          {/* 2. Rotating Rings placed directly IN FRONT of the logo (z-20) */}
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
            {/* Subtle Track Ring in front */}
            <div className="absolute inset-0 rounded-full border-2 border-white/15 shadow-[0_0_15px_rgba(0,255,135,0.2)]" />

            {/* Main Glowing Rotating Ring in front */}
            <div 
              className="absolute inset-0 rounded-full border-[3.5px] border-transparent border-t-[#00ff87] border-r-[#00e5ff] shadow-[0_0_20px_rgba(0,255,135,0.4)] animate-spin"
              style={{ animationDuration: '1.8s', animationTimingFunction: 'linear' }}
            />

            {/* Secondary Accent Counter-Rotating Ring in front */}
            <div 
              className="absolute -inset-1.5 rounded-full border-2 border-transparent border-b-[#00ff87]/60 border-l-[#00e5ff]/40 animate-spin"
              style={{ animationDuration: '3.2s', animationDirection: 'reverse', animationTimingFunction: 'linear' }}
            />
          </div>
        </div>

        {/* Title & Status Message */}
        <div className="space-y-2 z-10">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>FPL</span>
            <span className="text-[#00ff87]">Nusantara</span>
            <span className="text-white/90">BERHADIAH</span>
          </h2>
          <p className="text-sm font-semibold text-slate-100 tracking-wide">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
};
