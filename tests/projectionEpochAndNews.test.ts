import test from 'node:test';
import assert from 'node:assert/strict';
import type { GwEventStatus, TransformedLeagueData } from '../src/types.ts';
import {
  computeProjectionEpochInfo,
  getProjectionFormulaFingerprint,
} from '../src/server/projectionEngineServer.ts';
import {
  getProportionalMultiQuota,
  resolveParentTemplateId,
  selectCycleBatchForPhase,
  type WaveSchedulableStory,
} from '../src/server/waveCycleScheduler.ts';

function makeLeagueState(params: {
  currentGw: number;
  availableGws: number[];
  evStatus: Partial<GwEventStatus>;
  fixtures: Array<{ id: number; started: boolean; finished: boolean; finished_provisional?: boolean }>;
  isMatchdayLive?: boolean;
}): TransformedLeagueData {
  const { currentGw, availableGws, evStatus, fixtures, isMatchdayLive = false } = params;
  const fullEv: GwEventStatus = {
    event: currentGw,
    status: 'Not started',
    days: [],
    data_checked: false,
    leagues_status: '',
    finished: false,
    ...evStatus,
  };
  return {
    league_id: 1,
    league_name: 'Test League',
    current_gw: currentGw,
    available_gws: availableGws,
    sync_status: {
      last_synced: '2026-10-01T12:00:00Z',
      next_sync_wib: '19:00 WIB',
      is_matchday_live: isMatchdayLive,
      active_fixtures: [],
      gw_fixtures: fixtures.map((f) => ({
        id: f.id,
        event: currentGw,
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        kickoff_time: '2026-10-01T14:00:00Z',
        started: f.started,
        finished: f.finished,
        finished_provisional: f.finished_provisional ?? false,
      })),
      current_gw: currentGw,
      max_gw: currentGw,
      total_teams: 20,
      league_name: 'Test League',
      league_id: 1,
    },
    gw_status: fullEv,
    events_status: {
      [currentGw]: fullEv,
    },
    standings: {},
    gameweek_champions: [],
    most_gameweek_champions: [],
    ownership_players: {},
    ownership_clubs: {},
    fans_clubs: {},
    template_squads: {},
    all_transfers: [],
    transfers_in: {},
    transfers_out: {},
    liga_minus: [],
    captain_players: {},
    captain_clubs: {},
    all_chips_used: [],
  };
}

test('computeProjectionEpochInfo keeps targetNextGW & epochKey stable during Live ticks and only advances on Live -> Provisional -> Confirmed', () => {
  const fp = getProjectionFormulaFingerprint();
  assert.ok(fp.length >= 8);

  // 1. GW 10 Not Started -> baseHistoricalGW = 9, targetNextGW = 10
  const gw10NotStarted = computeProjectionEpochInfo(
    makeLeagueState({
      currentGw: 10,
      availableGws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      evStatus: { status: 'Not started' },
      fixtures: [
        { id: 1, started: false, finished: false },
        { id: 2, started: false, finished: false },
      ],
    })
  );
  assert.equal(gw10NotStarted.lifecycleStatus, 'Not Started');
  assert.equal(gw10NotStarted.baseHistoricalGW, 9);
  assert.equal(gw10NotStarted.targetNextGW, 10);

  // 2. GW 10 Live -> MUST keep exact same baseHistoricalGW (9), targetNextGW (10), and epochKey!
  const gw10Live = computeProjectionEpochInfo(
    makeLeagueState({
      currentGw: 10,
      availableGws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      evStatus: { status: 'Live' },
      fixtures: [
        { id: 1, started: true, finished: true, finished_provisional: true },
        { id: 2, started: true, finished: false, finished_provisional: false },
      ],
      isMatchdayLive: true,
    })
  );
  assert.equal(gw10Live.lifecycleStatus, 'Live');
  assert.equal(gw10Live.baseHistoricalGW, 9);
  assert.equal(gw10Live.targetNextGW, 10);
  assert.equal(gw10Live.epochKey, gw10NotStarted.epochKey);

  // 3. GW 10 Live -> Provisional -> baseHistoricalGW shifts to 10, targetNextGW shifts to 11, epochKey shifts!
  const gw10Provisional = computeProjectionEpochInfo(
    makeLeagueState({
      currentGw: 10,
      availableGws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      evStatus: { status: 'Provisional', finished: true, data_checked: false, leagues_status: '' },
      fixtures: [
        { id: 1, started: true, finished: true, finished_provisional: true },
        { id: 2, started: true, finished: true, finished_provisional: true },
      ],
    })
  );
  assert.equal(gw10Provisional.lifecycleStatus, 'Provisional');
  assert.equal(gw10Provisional.baseHistoricalGW, 10);
  assert.equal(gw10Provisional.targetNextGW, 11);
  assert.notEqual(gw10Provisional.epochKey, gw10Live.epochKey);

  // 4. GW 10 Provisional -> Confirmed -> targetNextGW remains 11, epochKey shifts to Confirmed!
  const gw10Confirmed = computeProjectionEpochInfo(
    makeLeagueState({
      currentGw: 10,
      availableGws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      evStatus: { status: 'Confirmed', finished: true, data_checked: true, leagues_status: 'Updated' },
      fixtures: [
        { id: 1, started: true, finished: true },
        { id: 2, started: true, finished: true },
      ],
    })
  );
  assert.equal(gw10Confirmed.lifecycleStatus, 'Confirmed');
  assert.equal(gw10Confirmed.baseHistoricalGW, 10);
  assert.equal(gw10Confirmed.targetNextGW, 11);
  assert.notEqual(gw10Confirmed.epochKey, gw10Provisional.epochKey);

  // 5. Rollover to GW 11 Not Started -> baseHistoricalGW stays 10, targetNextGW stays 11, epochKey stays identical!
  const gw11NotStarted = computeProjectionEpochInfo(
    makeLeagueState({
      currentGw: 11,
      availableGws: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      evStatus: { status: 'Not started' },
      fixtures: [
        { id: 3, started: false, finished: false },
        { id: 4, started: false, finished: false },
      ],
    })
  );
  assert.equal(gw11NotStarted.baseHistoricalGW, 10);
  assert.equal(gw11NotStarted.targetNextGW, 11);
  assert.equal(gw11NotStarted.epochKey, gw10Confirmed.epochKey);
});

test('waveCycleScheduler proportional quotas and poin_tayang ASC prevent duplicate airing in odd-sized pools', () => {
  assert.equal(getProportionalMultiQuota(0), 0);
  assert.equal(getProportionalMultiQuota(3), 1);
  assert.equal(getProportionalMultiQuota(4), 2);
  assert.equal(getProportionalMultiQuota(7), 2);
  assert.equal(getProportionalMultiQuota(8), 3);

  assert.equal(
    resolveParentTemplateId('NS_PLAYER_AVAILABILITY_FLAGGED_1_saka', [
      'NS_PLAYER_AVAILABILITY_FLAGGED',
    ]),
    'NS_PLAYER_AVAILABILITY_FLAGGED'
  );

  // Odd pool of 5 flagged players where two items already aired once (poin_tayang = 1)
  // and three items have poin_tayang = 0. Slot 1 (chance ASC) & Slot 2 (chance DESC)
  // MUST both select from poin_tayang = 0, never picking an already-aired item or duplicating!
  const rows: WaveSchedulableStory[] = [
    {
      id: 'NS_MATCH_FIXTURE_OPENING',
      kategori: 'Matches',
      poin_tayang: 0,
      timestamp_produksi: '2026-10-01T10:00:00Z',
    },
    {
      id: 'NS_PLAYER_AVAILABILITY_FLAGGED_a',
      kategori: 'Player',
      poin_tayang: 1,
      timestamp_produksi: '2026-10-01T10:00:00Z',
      cycle_meta: { chance: 0, ownersCount: 20 },
    },
    {
      id: 'NS_PLAYER_AVAILABILITY_FLAGGED_b',
      kategori: 'Player',
      poin_tayang: 1,
      timestamp_produksi: '2026-10-01T10:00:00Z',
      cycle_meta: { chance: 75, ownersCount: 18 },
    },
    {
      id: 'NS_PLAYER_AVAILABILITY_FLAGGED_c',
      kategori: 'Player',
      poin_tayang: 0,
      timestamp_produksi: '2026-10-01T10:00:00Z',
      cycle_meta: { chance: 25, ownersCount: 12 },
    },
    {
      id: 'NS_PLAYER_AVAILABILITY_FLAGGED_d',
      kategori: 'Player',
      poin_tayang: 0,
      timestamp_produksi: '2026-10-01T10:00:00Z',
      cycle_meta: { chance: 50, ownersCount: 15 },
    },
    {
      id: 'NS_PLAYER_AVAILABILITY_FLAGGED_e',
      kategori: 'Player',
      poin_tayang: 0,
      timestamp_produksi: '2026-10-01T10:00:00Z',
      cycle_meta: { chance: 75, ownersCount: 10 },
    },
  ];

  const batch = selectCycleBatchForPhase(rows, 'Not started', 10, [
    'NS_MATCH_FIXTURE_OPENING',
    'NS_PLAYER_AVAILABILITY_FLAGGED',
  ]);
  const flaggedPicked = batch.filter((r) =>
    r.id.startsWith('NS_PLAYER_AVAILABILITY_FLAGGED_')
  );
  assert.equal(flaggedPicked.length, 2);
  assert.equal(flaggedPicked[0].id, 'NS_PLAYER_AVAILABILITY_FLAGGED_c'); // lowest chance among poin_tayang=0
  assert.equal(flaggedPicked[1].id, 'NS_PLAYER_AVAILABILITY_FLAGGED_e'); // highest chance among remaining poin_tayang=0
  assert.notEqual(flaggedPicked[0].id, flaggedPicked[1].id);
});
