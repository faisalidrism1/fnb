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

  const isDataChecked = Boolean(gwStatusObj?.data_checked);
  const leaguesStatus = gwStatusObj?.leagues_status || (gwStatusObj?.status === 'Confirmed' ? 'Updated' : '');

  // 1. Confirmed (Rule 2.A: data_checked === true AND leagues === "Updated")
  if (
    (isDataChecked && leaguesStatus === 'Updated') ||
    (gwStatusObj?.status === 'Confirmed' && leaguesStatus === 'Updated')
  ) {
    return { status: 'Confirmed', isLiveOrProvisional: false };
  }

  // 2. Live: At least one match is currently in progress on the pitch
  const gwFixtures = syncStatus?.gw_fixtures;
  const hasActiveFixtureOnPitch = Array.isArray(gwFixtures) && gwFixtures.some(
    (f: any) => f.event === gw && f.started && !f.finished && !f.finished_provisional
  );
  const hasLiveDay = Boolean(
    gwStatusObj?.days?.some(d => d.status === 'Live' || (d as any).points === 'l')
  );
  const hasActiveFixturesInSync = Boolean(
    syncStatus?.is_matchday_live &&
    Array.isArray(syncStatus.active_fixtures) &&
    syncStatus.active_fixtures.length > 0
  );

  if (hasActiveFixtureOnPitch || hasLiveDay || hasActiveFixturesInSync || gwStatusObj?.status === 'Live') {
    return { status: 'Live', isLiveOrProvisional: true };
  }

  // 3. Not Started: No fixtures in this GW have started, and no live or provisional points exist
  const hasStartedFixture = Array.isArray(gwFixtures) && gwFixtures.some(
    (f: any) => f.event === gw && (f.started || f.finished || f.finished_provisional)
  );
  const hasAnyPointsOrProvisional = Boolean(
    gwStatusObj?.days?.some(
      d => d.status === 'Provisional' || d.status === 'Live' || (d as any).points === 'l' || (d as any).points === 'p' || (d as any).points === 'r'
    )
  );

  if (gwStatusObj?.status === 'Not started' && !hasStartedFixture && !hasAnyPointsOrProvisional) {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }
  if (!hasStartedFixture && !hasAnyPointsOrProvisional && !syncStatus?.is_matchday_live) {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }

  // 4. Provisional: Matches have been played / ended on pitch, or provisional audit ongoing, but leagues not yet Confirmed
  return { status: 'Provisional', isLiveOrProvisional: true };
}
