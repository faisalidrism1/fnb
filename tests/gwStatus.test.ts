import test from 'node:test';
import assert from 'node:assert/strict';
import { getGameweekStatus } from '../src/utils/gwStatus.ts';
import type { GwEventStatus, SyncStatus } from '../src/types.ts';

function makeSyncStatus(
  gw: number,
  fixtures: Array<{ id: number; started?: boolean; finished?: boolean; finished_provisional?: boolean }>,
  isMatchdayLive = false
): SyncStatus {
  return {
    last_synced: '2026-10-01T12:00:00Z',
    next_sync_wib: '19:00 WIB',
    is_matchday_live: isMatchdayLive,
    active_fixtures: [],
    current_gw: gw,
    max_gw: gw,
    total_teams: 20,
    league_name: 'Test League',
    league_id: 1,
    gw_fixtures: fixtures.map((f) => ({
      id: f.id,
      event: gw,
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      kickoff_time: '2026-10-01T14:00:00Z',
      started: f.started ?? false,
      finished: f.finished ?? false,
      finished_provisional: f.finished_provisional ?? false,
    })),
  };
}

function makeEventStatus(
  gw: number,
  overrides: Partial<GwEventStatus> = {}
): GwEventStatus {
  return {
    event: gw,
    status: 'Not started',
    days: [],
    data_checked: false,
    leagues_status: '',
    finished: false,
    ...overrides,
  };
}

test('future GW returns Not Started', () => {
  const res = getGameweekStatus(8, 7, null, null);
  assert.deepEqual(res, { status: 'Not Started', isLiveOrProvisional: false });
});

test('current GW with zero started matches returns Not Started', () => {
  const sync = makeSyncStatus(7, [
    { id: 1, started: false, finished: false },
    { id: 2, started: false, finished: false },
  ]);
  const ev = makeEventStatus(7, { status: 'Not started' });
  assert.deepEqual(getGameweekStatus(7, 7, ev, sync), {
    status: 'Not Started',
    isLiveOrProvisional: false,
  });
});

test('current GW remains Live between matchdays when some matches finished and others pending', () => {
  const sync = makeSyncStatus(
    7,
    [
      { id: 1, started: true, finished: true, finished_provisional: true },
      { id: 2, started: false, finished: false, finished_provisional: false },
    ],
    false
  );
  const ev = makeEventStatus(7, { status: 'Live', finished: false });
  assert.deepEqual(getGameweekStatus(7, 7, ev, sync), {
    status: 'Live',
    isLiveOrProvisional: true,
  });
});

test('current GW becomes Provisional once all matches finished but data_checked or leagues_status pending', () => {
  const sync = makeSyncStatus(7, [
    { id: 1, started: true, finished: true, finished_provisional: true },
    { id: 2, started: true, finished: false, finished_provisional: true },
  ]);
  // Case A: data_checked false
  const evA = makeEventStatus(7, {
    status: 'Provisional',
    finished: true,
    data_checked: false,
    leagues_status: '',
  });
  assert.deepEqual(getGameweekStatus(7, 7, evA, sync), {
    status: 'Provisional',
    isLiveOrProvisional: true,
  });

  // Case B: data_checked true, leagues_status still Updating
  const evB = makeEventStatus(7, {
    status: 'Provisional',
    finished: true,
    data_checked: true,
    leagues_status: 'Updating',
  });
  assert.deepEqual(getGameweekStatus(7, 7, evB, sync), {
    status: 'Provisional',
    isLiveOrProvisional: true,
  });
});

test('current GW becomes Confirmed only when both data_checked === true AND leagues_status === Updated', () => {
  const sync = makeSyncStatus(7, [
    { id: 1, started: true, finished: true },
    { id: 2, started: true, finished: true },
  ]);
  const ev = makeEventStatus(7, {
    status: 'Confirmed',
    finished: true,
    data_checked: true,
    leagues_status: 'Updated',
  });
  assert.deepEqual(getGameweekStatus(7, 7, ev, sync), {
    status: 'Confirmed',
    isLiveOrProvisional: false,
  });
});

test('historical GW (< currentGW) defaults to Confirmed', () => {
  assert.deepEqual(getGameweekStatus(5, 7, null, null), {
    status: 'Confirmed',
    isLiveOrProvisional: false,
  });
});
