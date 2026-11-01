import { GwEventStatus, SyncStatus } from '../types.ts';

export type GameweekLifecycleStatus = 'Not Started' | 'Live' | 'Provisional' | 'Confirmed';

/**
 * Deterministically computes the lifecycle status of a Gameweek:
 *
 * 1. Confirmed / Final:
 *    - All matches in the Gameweek have finished.
 *    - Official audit is 100% complete (data_checked === true).
 *    - League tables, autosubs, hits, and rank recalculations are locked (leagues === "Updated").
 *
 * 2. Provisional (Wait-for-Audit / League Updating):
 *    - ALL matches in the Gameweek (all 10 matches) have FINISHED on the pitch.
 *    - BUT points or leagues are NOT yet Confirmed (data_checked === false OR leagues !== "Updated").
 *    - This is the post-round audit window before permanent lock.
 *
 * 3. Live:
 *    - At least one match in the Gameweek has started/finished.
 *    - BUT NOT ALL matches in the Gameweek have finished (matches remain to be played).
 *    - Remains LIVE across days/nights between matches (e.g. Friday night match finished, Saturday matches upcoming).
 *
 * 4. Not Started:
 *    - No match in this Gameweek has kicked off yet.
 */
export function getGameweekStatus(
  gw: number,
  currentGW: number,
  gwStatusObj?: GwEventStatus | null,
  syncStatus?: SyncStatus | null
): { status: GameweekLifecycleStatus; isLiveOrProvisional: boolean } {
  // 1. If GW is in the future
  if (gw > currentGW) {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }

  const isDataChecked = Boolean(gwStatusObj?.data_checked);
  const leaguesStatus = gwStatusObj?.leagues_status || (gwStatusObj?.status === 'Confirmed' ? 'Updated' : '');

  // 2. Confirmed (Rule 2.A in RULE[AGENTS_md]: data_checked === true AND leagues === "Updated")
  if (
    (isDataChecked && leaguesStatus === 'Updated') ||
    (gwStatusObj?.status === 'Confirmed' && leaguesStatus === 'Updated')
  ) {
    return { status: 'Confirmed', isLiveOrProvisional: false };
  }

  // If GW is past historical, default to Confirmed unless explicitly active
  if (gw < currentGW && (!gwStatusObj || gwStatusObj.status === 'Confirmed')) {
    return { status: 'Confirmed', isLiveOrProvisional: false };
  }

  // 3. Inspect Fixtures for this specific GW
  const allFixtures = syncStatus?.gw_fixtures;
  const gwFixtures = Array.isArray(allFixtures)
    ? allFixtures.filter((f: any) => f.event === gw)
    : [];

  const hasAnyFixturesData = gwFixtures.length > 0;
  const hasStartedFixture = hasAnyFixturesData && gwFixtures.some(
    (f: any) => f.started || f.finished || f.finished_provisional
  );
  const allFixturesFinished = hasAnyFixturesData && gwFixtures.every(
    (f: any) => f.finished || f.finished_provisional
  );
  const hasActiveFixtureOnPitch = hasAnyFixturesData && gwFixtures.some(
    (f: any) => f.started && !f.finished && !f.finished_provisional
  );

  const hasDayPointsActivity = Boolean(
    gwStatusObj?.days?.some(
      d => d.status === 'Live' || d.status === 'Provisional' || d.status === 'Confirmed' ||
           (d as any).points === 'l' || (d as any).points === 'p' || (d as any).points === 'r'
    )
  );

  const isEventMarkedFinished = Boolean(gwStatusObj?.finished);

  // 4. Check if Gameweek has started
  const isStarted =
    hasStartedFixture ||
    hasActiveFixtureOnPitch ||
    hasDayPointsActivity ||
    Boolean(syncStatus?.is_matchday_live) ||
    gwStatusObj?.status === 'Live';

  if (!isStarted && gwStatusObj?.status === 'Not started') {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }
  if (!isStarted) {
    return { status: 'Not Started', isLiveOrProvisional: false };
  }

  // 5. Check if ALL matches in this Gameweek are finished
  // A Gameweek is ONLY Provisional when all matches of the round are completed, but audit is still pending.
  const isAllMatchesFinished =
    allFixturesFinished ||
    (isEventMarkedFinished && (!hasAnyFixturesData || allFixturesFinished));

  if (isAllMatchesFinished) {
    return { status: 'Provisional', isLiveOrProvisional: true };
  }

  // 6. If matches have started, but NOT ALL matches in the GW are finished:
  // Status is LIVE (even during the gap between matchdays when no ball is rolling right now).
  return { status: 'Live', isLiveOrProvisional: true };
}
