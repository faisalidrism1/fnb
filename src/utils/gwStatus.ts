import { GwEventStatus, SyncStatus } from '../types.ts';

export type GameweekLifecycleStatus = 'Not Started' | 'Live' | 'Provisional' | 'Confirmed';

/**
 * Deterministically computes the lifecycle status of a Gameweek according to:
 * 1. Confirmed / Final: data_checked === true AND leagues === "Updated"
 * 2. Live: Matches are ongoing right now (is_matchday_live === true OR provisional days with unchecked data)
 * 3. Provisional: Matches completed or in progress but not yet finalized/audited
 * 4. Not Started: Event has not begun yet
 */
export function getGameweekStatus(
  gw: number,
  currentGW: number,
  gwStatusObj?: GwEventStatus | null,
  syncStatus?: SyncStatus | null
): { status: GameweekLifecycleStatus; isLiveOrProvisional: boolean } {
  // If GW is in the future
  if (gw > currentGW) {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }

  // If GW is past historical, and no status obj indicates otherwise
  if (gw < currentGW && (!gwStatusObj || gwStatusObj.status === 'Confirmed')) {
    return { status: 'Confirmed', isLiveOrProvisional: false };
  }

  if (gwStatusObj) {
    const isDataChecked = Boolean(gwStatusObj.data_checked);
    const leaguesStatus = gwStatusObj.leagues_status || (gwStatusObj.status === 'Confirmed' ? 'Updated' : '');

    // 1. Confirmed (Rule 2.A: data_checked === true AND leagues === "Updated")
    if (
      (isDataChecked && leaguesStatus === 'Updated') ||
      (gwStatusObj.status === 'Confirmed' && leaguesStatus === 'Updated')
    ) {
      return { status: 'Confirmed', isLiveOrProvisional: false };
    }

    // 2. Explicit Live (status is Live, syncStatus matchday is live, or days have Live / 'l' points)
    if (
      gwStatusObj.status === 'Live' ||
      syncStatus?.is_matchday_live ||
      gwStatusObj.days?.some(d => d.status === 'Live' || (d as any).points === 'l')
    ) {
      return { status: 'Live', isLiveOrProvisional: true };
    }

    // 3. Not Started: Only if status is 'Not started' AND no live/provisional points exist AND not matchday live
    if (gwStatusObj.status === 'Not started') {
      const hasAnyPointsOrProvisional = gwStatusObj.days?.some(
        d => d.status === 'Provisional' || d.status === 'Live' || (d as any).points === 'l' || (d as any).points === 'p' || (d as any).points === 'r'
      );
      if (!hasAnyPointsOrProvisional && !syncStatus?.is_matchday_live) {
        return { status: 'Not Started', isLiveOrProvisional: false };
      }
    }

    // 4. Live if provisional days with unchecked data
    if (gwStatusObj.days?.some(d => d.status === 'Provisional' && !isDataChecked)) {
      return { status: 'Live', isLiveOrProvisional: true };
    }

    // 5. Provisional (Audit ongoing, bonus not locked, or leagues not yet updated)
    return { status: 'Provisional', isLiveOrProvisional: true };
  }

  // Fallback if no detailed status object is available
  if (syncStatus?.is_matchday_live) {
    return { status: 'Live', isLiveOrProvisional: true };
  }

  if (gw === currentGW) {
    return { status: 'Live', isLiveOrProvisional: true };
  }

  return { status: 'Confirmed', isLiveOrProvisional: false };
}
