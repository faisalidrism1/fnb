export type MatchPeriod = '1H' | 'HT' | '2H' | 'FT';

export const DEFAULT_HALF_TIME_SECS = 15 * 60; // 900 seconds (standard 15-min Half-Time break)
export const MIN_HALF_TIME_SECS = 5 * 60;
export const MAX_HALF_TIME_SECS = 35 * 60;

export interface ParsedClockLabel {
  baseMin: number;
  addedMin: number;
  totalMin: number;
  secs: number;
  isPlus45: boolean;
  isHalfTimeLabel: boolean;
  isFullTimeLabel: boolean;
}

/**
 * Parses football clock strings such as "45+3'", "45+2'00", "69'", "90+4", "HT", "Half Time", "FT", "Full Time".
 */
export function parseClockLabelInfo(label?: string | null): ParsedClockLabel | null {
  if (!label) return null;
  const raw = String(label).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower === 'ht' || lower === 'half' || lower.includes('half time') || lower.includes('halftime')) {
    return {
      baseMin: 45,
      addedMin: 0,
      totalMin: 45,
      secs: 2700,
      isPlus45: false,
      isHalfTimeLabel: true,
      isFullTimeLabel: false,
    };
  }

  if (lower === 'ft' || lower.includes('full time') || lower.includes('fulltime')) {
    return {
      baseMin: 90,
      addedMin: 0,
      totalMin: 90,
      secs: 5400,
      isPlus45: false,
      isHalfTimeLabel: false,
      isFullTimeLabel: true,
    };
  }

  const plusMatch = raw.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    const baseMin = parseInt(plusMatch[1], 10);
    const addedMin = parseInt(plusMatch[2], 10);
    if (Number.isFinite(baseMin) && Number.isFinite(addedMin)) {
      const totalMin = baseMin + addedMin;
      return {
        baseMin,
        addedMin,
        totalMin,
        secs: totalMin * 60,
        isPlus45: baseMin === 45,
        isHalfTimeLabel: false,
        isFullTimeLabel: false,
      };
    }
  }

  const numMatch = raw.match(/^(\d+)/);
  if (numMatch) {
    const baseMin = parseInt(numMatch[1], 10);
    if (Number.isFinite(baseMin)) {
      return {
        baseMin,
        addedMin: 0,
        totalMin: baseMin,
        secs: baseMin * 60,
        isPlus45: false,
        isHalfTimeLabel: false,
        isFullTimeLabel: false,
      };
    }
  }

  return null;
}

/**
 * Normalizes any period/phase identifier into canonical '1H' | 'HT' | '2H' | 'FT'.
 */
export function normalizeMatchPeriod(
  rawPhase?: string | null,
  opts?: {
    isHalfTime?: boolean;
    isFullTime?: boolean;
    isSecondHalf?: boolean;
    clockLabel?: string | null;
    clockSecs?: number;
  }
): MatchPeriod {
  if (opts?.isFullTime) return 'FT';
  if (opts?.isHalfTime) return 'HT';

  const raw = String(rawPhase || '').trim().toUpperCase();
  if (raw === 'F' || raw === 'FT' || raw === 'FULLTIME' || raw === 'FULL_TIME' || raw === 'C') {
    return 'FT';
  }
  if (raw === 'HT' || raw === 'H' || raw === 'HALFTIME' || raw === 'HALF_TIME') {
    return 'HT';
  }
  if (
    raw === '2' ||
    raw === '2H' ||
    raw === 'SECONDHALF' ||
    raw === 'SECOND_HALF' ||
    raw === 'ET' ||
    raw === 'ET1' ||
    raw === 'ET2' ||
    raw === 'PEN'
  ) {
    return '2H';
  }
  if (raw === '1' || raw === '1H' || raw === 'FIRSTHALF' || raw === 'FIRST_HALF') {
    return '1H';
  }

  if (opts?.isSecondHalf) return '2H';

  const parsed = parseClockLabelInfo(opts?.clockLabel);
  if (parsed) {
    if (parsed.isFullTimeLabel) return 'FT';
    if (parsed.isHalfTimeLabel) return 'HT';
    if (parsed.isPlus45) return '1H';
    if (parsed.baseMin > 45) return '2H';
    if (parsed.baseMin > 0) return '1H';
  }

  const secs = Number(opts?.clockSecs || 0);
  if (secs > 2700) return '2H';
  return '1H';
}

/**
 * Resolves period and accurate match clock seconds from a MatchCardItem-like object.
 * Correctly accounts for 1H stoppage labels (e.g. "45+3'" -> 1H, 2880s) vs 2H ("46'" -> 2H, 2760s).
 */
export function resolveCardPeriodAndClockSecs(card: {
  phase?: string | null;
  minutes?: number | null;
  clock_label?: string | null;
  is_half_time?: boolean | null;
  finished?: boolean | null;
  finished_provisional?: boolean | null;
}): { period: MatchPeriod; clockSecs: number } {
  const parsed = parseClockLabelInfo(card.clock_label);
  const minsClockSecs = Math.max(0, Number(card.minutes) || 0) * 60;

  const isFt = Boolean(
    card.finished ||
      card.finished_provisional ||
      String(card.phase || '').toUpperCase() === 'FT' ||
      parsed?.isFullTimeLabel
  );
  if (isFt) {
    return {
      period: 'FT',
      clockSecs: Math.max(5400, minsClockSecs, parsed?.secs || 0),
    };
  }

  const isHt = Boolean(
    card.is_half_time ||
      String(card.phase || '').toUpperCase() === 'HT' ||
      parsed?.isHalfTimeLabel
  );
  if (isHt) {
    return {
      period: 'HT',
      clockSecs: Math.max(2700, parsed?.secs || 0, minsClockSecs),
    };
  }

  const phaseUpper = String(card.phase || '').trim().toUpperCase();
  let period: MatchPeriod = '1H';
  if (phaseUpper === '2H' || phaseUpper === '2') {
    period = '2H';
  } else if (phaseUpper === '1H' || phaseUpper === '1') {
    period = '1H';
  } else if (parsed?.isPlus45) {
    period = '1H';
  } else if ((parsed && parsed.baseMin > 45) || (Number(card.minutes) || 0) > 45) {
    period = '2H';
  }

  // Prefer clock_label numeric seconds when available so 1H stoppage ("45+3'") preserves added minutes
  // even if FPL `minutes` stops at 45; otherwise fall back to `minutes * 60`.
  const clockSecs =
    parsed && !parsed.isHalfTimeLabel && !parsed.isFullTimeLabel && parsed.secs > 0
      ? Math.max(parsed.secs, period === '2H' ? Math.max(2700, minsClockSecs) : minsClockSecs)
      : minsClockSecs;

  return { period, clockSecs };
}

export interface ContinuousClockContext {
  firstHalfEndSecs?: number;
  htDurationSecs?: number;
  secondHalfEndSecs?: number;
}

/**
 * Maps a (period, period-relative clockSecs, htOffsetSecs) onto a single monotonically increasing
 * real-match timeline in seconds starting from 1H 0':
 * - 1H: [0 .. firstHalfEndSecs] (includes 1H stoppage time, e.g. 45+3' = 2880s)
 * - HT: firstHalfEndSecs + clamp(htOffsetSecs, 0, htDurationSecs)
 * - 2H: firstHalfEndSecs + htDurationSecs + max(0, clockSecs - 2700)
 * - FT: firstHalfEndSecs + htDurationSecs + max(2700, secondHalfEndSecs - 2700)
 */
export function computeContinuousMatchSecs(
  period: MatchPeriod,
  clockSecs: number,
  htOffsetSecs = 0,
  ctx?: ContinuousClockContext
): number {
  const safeClock = Math.max(0, Number(clockSecs) || 0);
  const h1End = Math.max(2700, Number(ctx?.firstHalfEndSecs) || 2700);
  const htDur = Math.max(
    MIN_HALF_TIME_SECS,
    Math.min(MAX_HALF_TIME_SECS, Number(ctx?.htDurationSecs) || DEFAULT_HALF_TIME_SECS)
  );

  if (period === '1H') {
    return safeClock;
  }

  if (period === 'HT') {
    const safeHtOffset = Math.max(0, Math.min(htDur, Number(htOffsetSecs) || 0));
    return h1End + safeHtOffset;
  }

  if (period === '2H') {
    const secondHalfElapsed = Math.max(0, safeClock - 2700);
    return h1End + htDur + secondHalfElapsed;
  }

  // FT
  const h2End = Math.max(5400, Number(ctx?.secondHalfEndSecs) || 0, safeClock);
  return h1End + htDur + Math.max(2700, h2End - 2700);
}

/**
 * Computes true elapsed match-timeline seconds between an event and the current match state,
 * factoring in which half/period both occurred in, 1H stoppage time, and the Half-Time (HT) break.
 */
export function computeMatchElapsedSecs(params: {
  eventPeriod: MatchPeriod;
  eventClockSecs: number;
  eventHtOffsetSecs?: number;
  curPeriod: MatchPeriod;
  curClockSecs: number;
  curHtOffsetSecs?: number;
  firstHalfEndSecs?: number;
  htDurationSecs?: number;
  secondHalfEndSecs?: number;
}): number {
  const ctx: ContinuousClockContext = {
    firstHalfEndSecs: Math.max(
      2700,
      Number(params.firstHalfEndSecs) || 2700,
      params.eventPeriod === '1H' ? Number(params.eventClockSecs) || 0 : 0,
      params.curPeriod === '1H' ? Number(params.curClockSecs) || 0 : 0
    ),
    htDurationSecs: params.htDurationSecs,
    secondHalfEndSecs: params.secondHalfEndSecs,
  };

  const eventPos = computeContinuousMatchSecs(
    params.eventPeriod,
    params.eventClockSecs,
    params.eventHtOffsetSecs || 0,
    ctx
  );
  const curPos = computeContinuousMatchSecs(
    params.curPeriod,
    params.curClockSecs,
    params.curHtOffsetSecs || 0,
    ctx
  );

  return Math.max(0, curPos - eventPos);
}

export function periodSortRank(period: MatchPeriod): number {
  if (period === '1H') return 1;
  if (period === 'HT') return 2;
  if (period === '2H') return 3;
  return 4;
}

export function resolveStoryPeriodAndClock(
  story: {
    text_berita?: string;
    headline_id?: string;
    minute?: string;
    clockSecs?: number;
    cycle_meta?: {
      period?: MatchPeriod;
      detectedPeriod?: MatchPeriod;
      detectedClockSecs?: number;
      detectedHtOffsetSecs?: number;
      clockSecs?: number;
      continuousClockSecs?: number;
      firstHalfEndSecs?: number;
      htDurationSecs?: number;
      isHalfTime?: boolean;
      isFullTime?: boolean;
      isSecondHalf?: boolean;
    };
  },
  ctxOverride?: ContinuousClockContext
): {
  period: MatchPeriod;
  clockSecs: number;
  htOffsetSecs: number;
  continuousClockSecs: number;
} {
  const cm = story.cycle_meta || {};
  const rawClockSecs = Number(cm.detectedClockSecs ?? cm.clockSecs ?? story.clockSecs ?? 0) || 0;
  const headText = String(story.headline_id || story.text_berita || '').trim();
  const minTagMatch = headText.match(/^\[N:([^\]]+)\]/);
  const clockLabel = story.minute || (minTagMatch ? minTagMatch[1] : undefined);

  const period: MatchPeriod =
    cm.detectedPeriod ||
    cm.period ||
    normalizeMatchPeriod(undefined, {
      isHalfTime: cm.isHalfTime,
      isFullTime: cm.isFullTime,
      isSecondHalf: cm.isSecondHalf,
      clockLabel,
      clockSecs: rawClockSecs,
    });

  const htOffsetSecs = Number(cm.detectedHtOffsetSecs ?? 0) || 0;
  const effectiveCtx: ContinuousClockContext = ctxOverride
    ? {
        firstHalfEndSecs: Math.max(
          2700,
          Number(ctxOverride.firstHalfEndSecs) || 0,
          Number(cm.firstHalfEndSecs) || 0,
          period === '1H' ? rawClockSecs : 0
        ),
        htDurationSecs: ctxOverride.htDurationSecs ?? cm.htDurationSecs,
        secondHalfEndSecs: ctxOverride.secondHalfEndSecs,
      }
    : {
        firstHalfEndSecs: Math.max(2700, Number(cm.firstHalfEndSecs) || 0, period === '1H' ? rawClockSecs : 0),
        htDurationSecs: cm.htDurationSecs,
      };

  const continuousClockSecs =
    !ctxOverride &&
    typeof cm.continuousClockSecs === 'number' &&
    cm.continuousClockSecs >= 0 &&
    !cm.detectedPeriod
      ? cm.continuousClockSecs
      : computeContinuousMatchSecs(period, rawClockSecs, htOffsetSecs, effectiveCtx);

  return {
    period,
    clockSecs: rawClockSecs,
    htOffsetSecs,
    continuousClockSecs,
  };
}

