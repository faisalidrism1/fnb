import React from 'react';
import { PlayerAvailabilityHighlight } from '../utils/playerAvailabilityHighlight.ts';

interface PlayerAvailabilityFlagProps {
  highlight: PlayerAvailabilityHighlight;
  className?: string;
}

export const PlayerAvailabilityFlag: React.FC<PlayerAvailabilityFlagProps> = ({
  highlight,
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 select-none align-middle ${className}`}
      title={highlight.tooltip}
      aria-label={highlight.tooltip}
    >
      <svg
        viewBox="0 0 16 16"
        className="w-[1.02em] h-[1.02em] block"
        aria-hidden="true"
      >
        <path
          d="M8.86 2.3a1 1 0 0 0-1.72 0L1.18 12.6A1 1 0 0 0 2.04 14.1h11.92a1 1 0 0 0 .86-1.5L8.86 2.3z"
          fill={highlight.hexColor}
          stroke={highlight.strokeColor}
          strokeWidth="0.6"
          strokeLinejoin="round"
        />
        <line
          x1="8"
          y1="5.4"
          x2="8"
          y2="9.35"
          stroke={highlight.iconColor}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.65" r="0.95" fill={highlight.iconColor} />
      </svg>
    </span>
  );
};
