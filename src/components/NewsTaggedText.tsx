import React from 'react';

interface NewsTaggedTextProps {
  text: string;
  size?: 'xs' | 'sm';
  supportConditions?: boolean;
  isLiveMatch?: boolean;
  resolvePlayerId?: (webName: string) => number | null;
  onSelectPlayer?: (playerId: number, gw?: number) => void;
  targetGw?: number;
}

export const NewsTaggedText: React.FC<NewsTaggedTextProps> = ({
  text,
  size = 'xs',
  supportConditions = false,
  isLiveMatch = false,
  resolvePlayerId,
  onSelectPlayer,
  targetGw,
}) => {
  if (!text) return null;

  const teamBadgeClass =
    size === 'sm'
      ? 'inline-flex items-center px-1 rounded font-extrabold text-[12px] leading-tight bg-purple-100 dark:bg-purple-950/80 text-[#37003c] dark:text-[#00ff87] border border-purple-200 dark:border-purple-800/60'
      : 'inline-flex items-center px-1 rounded font-extrabold text-[11px] leading-tight bg-purple-100 dark:bg-purple-950/80 text-[#37003c] dark:text-[#00ff87] border border-purple-200 dark:border-purple-800/60';
  const playerTextSize = size === 'sm' ? 'text-[12px]' : 'text-[11px]';
  const clubBadgeClass =
    size === 'sm'
      ? 'inline-flex items-center px-1 rounded font-semibold text-[12px] leading-tight bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
      : 'inline-flex items-center px-1 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700';

  const renderLineWithTags = (line: string, lineKey: string) => {
    const parts: React.ReactNode[] = [];
    const regex = /\[([TPCN]):([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }

      const tagType = match[1];
      const tagContent = match[2];
      const key = `${lineKey}-${match.index}-${tagType}-${tagContent}`;

      switch (tagType) {
        case 'T':
          parts.push(
            <span key={key} className={teamBadgeClass}>
              {tagContent}
            </span>
          );
          break;
        case 'P': {
          const resolvedPlayerId =
            resolvePlayerId && onSelectPlayer ? resolvePlayerId(tagContent) : null;
          if (resolvedPlayerId && onSelectPlayer) {
            parts.push(
              <button
                key={key}
                type="button"
                onClick={() => onSelectPlayer(resolvedPlayerId, targetGw)}
                className={`inline-flex items-center px-1 rounded font-bold ${playerTextSize} leading-tight bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 hover:underline hover:brightness-110 cursor-pointer`}
                title={`Klik untuk detail ${tagContent}`}
              >
                {tagContent}
              </button>
            );
          } else {
            parts.push(
              <span
                key={key}
                className={`inline-flex items-center px-1 rounded font-bold ${playerTextSize} leading-tight bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60`}
              >
                {tagContent}
              </span>
            );
          }
          break;
        }
        case 'C':
          parts.push(
            <span key={key} className={clubBadgeClass}>
              {tagContent}
            </span>
          );
          break;
        case 'N': {
          const isLiveMin = isLiveMatch && /^\d+(?:\s*\+\s*\d*)?'$/.test(tagContent.trim());
          const numberClass = isLiveMin
            ? 'inline-flex items-center px-1 rounded font-black text-[11px] bg-[#ff2851]/10 dark:bg-[#ff2851]/15 text-[#ff2851] border border-[#ff2851]/30'
            : size === 'sm'
              ? 'inline-flex items-center px-1 rounded font-black text-[12px] leading-tight bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
              : 'inline-flex items-center px-1 rounded font-black text-[11px] bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60';
          parts.push(
            <span key={key} className={numberClass}>
              {tagContent}
            </span>
          );
          break;
        }
        default:
          parts.push(tagContent);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }

    return parts;
  };

  if (!supportConditions) {
    return <span>{renderLineWithTags(text, 'single')}</span>;
  }

  const lines = text.split('\n');
  return (
    <>
      {lines.map((rawLine, idx) => {
        const trimmed = rawLine.trim();
        const condMatch = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(trimmed);
        if (condMatch) {
          return (
            <div
              key={`cond-${idx}`}
              className="text-[12px] font-black uppercase tracking-wider text-purple-700 dark:text-[#00ff87] mt-1.5 first:mt-0 mb-0.5 leading-relaxed"
            >
              Kondisi: {condMatch[1].trim()}
            </div>
          );
        }
        if (!trimmed) {
          return <div key={`sp-${idx}`} className="h-1" />;
        }
        return (
          <div key={`line-${idx}`} className="text-[12px] leading-relaxed">
            {renderLineWithTags(rawLine, `l${idx}`)}
          </div>
        );
      })}
    </>
  );
};
