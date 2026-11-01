// Utility for managing Screen Wake Lock API across the application
let wakeLockSentinel: any = null;

export const isWakeLockSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
};

export const requestWakeLock = async (): Promise<boolean> => {
  if (!isWakeLockSupported()) return false;
  try {
    if (wakeLockSentinel !== null && !wakeLockSentinel.released) {
      return true;
    }
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (err) {
    wakeLockSentinel = null;
    return false;
  }
};

export const releaseWakeLock = async (): Promise<void> => {
  if (wakeLockSentinel !== null) {
    try {
      await wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
  }
};

export const isWakeLockActive = (): boolean => {
  return wakeLockSentinel !== null && !wakeLockSentinel.released;
};
