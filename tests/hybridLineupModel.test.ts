import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbPlayerStat, PositionType } from '../src/types.ts';
import {
  buildHybridHistoryStore,
  createHybridCalibrationMemo,
  extractPlayerFeaturesBeforeGw,
  predictHybridClubLineup,
  resolveCausalPlayerAvailability,
  selectCausalHybridParamsAndWeights,
  type CausalAvailability,
  type PastSeasonMinutesRecord,
} from '../src/utils/hybridLineupModel.ts';

function makeClubPlayer(
  id: number,
  teamShort: string,
  position: PositionType,
  pulsePositionInfo: string,
  nowCost: number,
  overrides: Partial<DbPlayerStat> = {}
): DbPlayerStat {
  return {
    id,
    webName: `P${id}`,
    fullName: `Player ${id}`,
    teamId: teamShort === 'ARS' ? 1 : 2,
    teamName: teamShort === 'ARS' ? 'Arsenal' : 'Chelsea',
    teamShort,
    position,
    pulsePositionInfo,
    nowCost,
    status: 'a',
    chanceOfPlayingNextRound: 100,
    chanceOfPlayingThisRound: 100,
    news: '',
    newsAdded: null,
    totalPoints: 50,
    eventPoints: 5,
    goalsScored: 1,
    assists: 1,
    cleanSheets: 2,
    goalsConceded: 2,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 50,
    minutes: 360,
    starts: 4,
    influence: 50,
    creativity: 50,
    threat: 50,
    ictIndex: 15,
    expectedGoals: 1,
    expectedAssists: 1,
    expectedGoalInvolvements: 2,
    expectedGoalsConceded: 2,
    form: 5,
    pointsPerGame: 5,
    selectedByPercent: 10,
    transfersIn: 1000,
    transfersOut: 500,
    ...overrides,
  };
}

function createClubSquad(clubShort: string, baseId: number): DbPlayerStat[] {
  return [
    makeClubPlayer(baseId + 1, clubShort, 'GKP', 'Goalkeeper', 55),
    makeClubPlayer(baseId + 2, clubShort, 'GKP', 'Goalkeeper', 40),
    makeClubPlayer(baseId + 3, clubShort, 'DEF', 'Right Full Back', 55),
    makeClubPlayer(baseId + 4, clubShort, 'DEF', 'Central Defender', 60),
    makeClubPlayer(baseId + 5, clubShort, 'DEF', 'Central Defender', 58),
    makeClubPlayer(baseId + 6, clubShort, 'DEF', 'Left Full Back', 55),
    makeClubPlayer(baseId + 7, clubShort, 'DEF', 'Central Defender', 45),
    makeClubPlayer(baseId + 8, clubShort, 'MID', 'Defensive Midfielder', 60),
    makeClubPlayer(baseId + 9, clubShort, 'MID', 'Central Midfielder', 65),
    makeClubPlayer(baseId + 10, clubShort, 'MID', 'Attacking Midfielder', 80),
    makeClubPlayer(baseId + 11, clubShort, 'MID', 'Winger Right', 95),
    makeClubPlayer(baseId + 12, clubShort, 'MID', 'Winger Left', 75),
    makeClubPlayer(baseId + 13, clubShort, 'MID', 'Central Midfielder', 50),
    makeClubPlayer(baseId + 14, clubShort, 'FWD', 'Striker', 90),
    makeClubPlayer(baseId + 15, clubShort, 'FWD', 'Striker', 60),
  ];
}

function makeLineupSide(
  starterIndices: number[],
  benchIndices: number[],
  baseId: number,
  subOnIdx?: number
) {
  return {
    lineup: starterIndices.map((idx) => ({
      id: baseId + idx,
      stats: { minutes: 90 },
    })),
    bench: benchIndices.map((idx) => ({
      id: baseId + idx,
      stats: { minutes: idx === subOnIdx ? 20 : 0 },
    })),
    rows: [
      [baseId + starterIndices[0]],
      [baseId + starterIndices[1], baseId + starterIndices[2], baseId + starterIndices[3], baseId + starterIndices[4]],
      [baseId + starterIndices[5], baseId + starterIndices[6], baseId + starterIndices[7]],
      [baseId + starterIndices[8], baseId + starterIndices[9], baseId + starterIndices[10]],
    ],
  };
}

function buildSyntheticMatchDataset() {
  const arsPlayers = createClubSquad('ARS', 100);
  const chePlayers = createClubSquad('CHE', 200);
  const allPlayers = [...arsPlayers, ...chePlayers];

  const pastMap: Record<string, PastSeasonMinutesRecord> = {};
  for (const p of allPlayers) {
    pastMap[String(p.id)] = {
      id: p.id,
      minutes: p.nowCost >= 55 ? 2800 : 300,
    };
  }

  const seedPos: Record<number, string> = {};
  for (const p of allPlayers) {
    if (p.pulsePositionInfo) seedPos[p.id] = p.pulsePositionInfo;
  }

  const deadlines: Record<string, string> = {
    '1': '2026-08-15T10:00:00Z',
    '2': '2026-08-22T10:00:00Z',
    '3': '2026-08-29T10:00:00Z',
    '4': '2026-09-12T10:00:00Z',
    '5': '2026-09-19T10:00:00Z',
  };

  const arsFirstXI = [1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 12];
  const arsBench = [2, 7, 13, 15];
  const cheFirstXI = [1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 12];
  const cheBench = [2, 7, 13, 15];

  const makeMatch = (gw: number, koIso: string, arsStarters = arsFirstXI, arsB = arsBench, cheStarters = cheFirstXI, cheB = cheBench, form = '4-3-3') => {
    const h = makeLineupSide(arsStarters, arsB, 100, arsB[3]);
    const a = makeLineupSide(cheStarters, cheB, 200, cheB[3]);
    return {
      id: gw * 10 + 1,
      event: gw,
      kickoff_time: koIso,
      home_team: { id: 1, name: 'Arsenal', short_name: 'ARS' },
      away_team: { id: 2, name: 'Chelsea', short_name: 'CHE' },
      home_formation: form,
      away_formation: form,
      home_formation_rows: h.rows,
      away_formation_rows: a.rows,
      home_lineup: h.lineup,
      home_bench: h.bench,
      away_lineup: a.lineup,
      away_bench: a.bench,
    };
  };

  const matchesByGw: Record<number, any[]> = {
    1: [makeMatch(1, '2026-08-15T14:00:00Z')],
    2: [makeMatch(2, '2026-08-22T14:00:00Z')],
    3: [makeMatch(3, '2026-08-29T14:00:00Z')],
    4: [makeMatch(4, '2026-09-12T14:00:00Z')],
    5: [makeMatch(5, '2026-09-19T14:00:00Z')],
  };

  return { arsPlayers, chePlayers, allPlayers, pastMap, seedPos, deadlines, matchesByGw };
}

test('resolveCausalPlayerAvailability blocks future injury news from leaking into past deadlines', () => {
  const injuredLater = makeClubPlayer(114, 'ARS', 'FWD', 'Striker', 90, {
    status: 'i',
    chanceOfPlayingNextRound: 0,
    news: 'Hamstring injury - Unknown return',
    newsAdded: '2026-09-10T12:00:00Z',
  });

  // Historical GW3 deadline was Aug 29 — before newsAdded on Sep 10 -> MUST remain available!
  const histGw3 = resolveCausalPlayerAvailability({
    player: injuredLater,
    targetGw: 3,
    mode: 'historical',
    gwDeadlineIso: '2026-08-29T10:00:00Z',
    earliestKickoffIso: '2026-08-29T14:00:00Z',
  });
  assert.equal(histGw3.avail, 1.0);
  assert.equal(histGw3.status, 'a');

  // Historical GW4 deadline was Sep 12 — after newsAdded on Sep 10 -> MUST be unavailable!
  const histGw4 = resolveCausalPlayerAvailability({
    player: injuredLater,
    targetGw: 4,
    mode: 'historical',
    gwDeadlineIso: '2026-09-12T10:00:00Z',
    earliestKickoffIso: '2026-09-12T14:00:00Z',
  });
  assert.equal(histGw4.avail, 0.0);
  assert.equal(histGw4.status, 'i');
});

test('causal isolation: changing GW 4-5 match outcomes does not change GW 4 lineup prediction or calibration', () => {
  const dsA = buildSyntheticMatchDataset();
  const dsB = buildSyntheticMatchDataset();
  // Mutate GW 4 and GW 5 heavily in dataset B (bench all regular starters, swap formation)
  dsB.matchesByGw[4] = [
    {
      ...dsB.matchesByGw[4][0],
      home_formation: '3-5-2',
      home_lineup: [2, 7, 13, 15, 3, 4, 5, 6, 8, 9, 10].map((idx) => ({ id: 100 + idx, stats: { minutes: 90 } })),
      home_bench: [1, 11, 12, 14].map((idx) => ({ id: 100 + idx, stats: { minutes: 0 } })),
    },
  ];
  dsB.matchesByGw[5] = dsB.matchesByGw[4];

  const histA = buildHybridHistoryStore(dsA.matchesByGw, 3, dsA.seedPos);
  const histB = buildHybridHistoryStore(dsB.matchesByGw, 3, dsB.seedPos);

  const calA = selectCausalHybridParamsAndWeights(
    dsA.allPlayers,
    ['ARS', 'CHE'],
    4,
    histA,
    dsA.pastMap,
    dsA.deadlines,
    undefined,
    1
  );
  const calB = selectCausalHybridParamsAndWeights(
    dsB.allPlayers,
    ['ARS', 'CHE'],
    4,
    histB,
    dsB.pastMap,
    dsB.deadlines,
    undefined,
    1
  );

  assert.deepEqual(calA.params, calB.params);
  assert.deepEqual(calA.logitWeights, calB.logitWeights);

  const featA = extractPlayerFeaturesBeforeGw(
    dsA.arsPlayers[9],
    4,
    histA,
    dsA.pastMap,
    calA.params.decay,
    calA.params.mShrink,
    calA.params.kalmanGain
  );
  const featB = extractPlayerFeaturesBeforeGw(
    dsB.arsPlayers[9],
    4,
    histB,
    dsB.pastMap,
    calB.params.decay,
    calB.params.mShrink,
    calB.params.kalmanGain
  );
  assert.deepEqual(featA, featB);

  const availMap = new Map<number, CausalAvailability>();
  for (const p of dsA.arsPlayers) {
    availMap.set(p.id, { avail: 1, absen: 0, status: 'a', chance: 100, expectedReturnDate: null });
  }
  const predA = predictHybridClubLineup({
    clubShort: 'ARS',
    targetGw: 4,
    isHome: true,
    players: dsA.arsPlayers,
    availabilityById: availMap,
    history: histA,
    pastMap: dsA.pastMap,
    logitWeights: calA.logitWeights,
    params: calA.params,
    precomputedFeatMap: calA.targetFeatMap,
  });
  const predB = predictHybridClubLineup({
    clubShort: 'ARS',
    targetGw: 4,
    isHome: true,
    players: dsB.arsPlayers,
    availabilityById: availMap,
    history: histB,
    pastMap: dsB.pastMap,
    logitWeights: calB.logitWeights,
    params: calB.params,
    precomputedFeatMap: calB.targetFeatMap,
  });

  assert.equal(predA.predictedFormation, predB.predictedFormation);
  assert.deepEqual(predA.starterIds, predB.starterIds);
  assert.deepEqual(predA.benchIds, predB.benchIds);
});

test('memoized walk-forward calibration matches un-memoized calibration identically across GWs', () => {
  const ds = buildSyntheticMatchDataset();
  const fullHistory = buildHybridHistoryStore(ds.matchesByGw, 5, ds.seedPos);
  const sharedMemo = createHybridCalibrationMemo(1);

  for (const gw of [3, 4, 5]) {
    const withMemo = selectCausalHybridParamsAndWeights(
      ds.allPlayers,
      ['ARS', 'CHE'],
      gw,
      fullHistory,
      ds.pastMap,
      ds.deadlines,
      undefined,
      1,
      sharedMemo
    );
    const fresh = selectCausalHybridParamsAndWeights(
      ds.allPlayers,
      ['ARS', 'CHE'],
      gw,
      fullHistory,
      ds.pastMap,
      ds.deadlines,
      undefined,
      1
    );

    assert.deepEqual(withMemo.params, fresh.params);
    assert.deepEqual(withMemo.logitWeights, fresh.logitWeights);
    assert.equal(withMemo.targetFeatMap?.size, fresh.targetFeatMap?.size);
  }
});

test('predictHybridClubLineup outputs 11 unique starters, valid formation, and zeroes injured players', () => {
  const ds = buildSyntheticMatchDataset();
  const hist = buildHybridHistoryStore(ds.matchesByGw, 3, ds.seedPos);
  const cal = selectCausalHybridParamsAndWeights(
    ds.allPlayers,
    ['ARS', 'CHE'],
    4,
    hist,
    ds.pastMap,
    ds.deadlines
  );

  // Rule out main Striker (114) and main GK (101)
  const availMap = new Map<number, CausalAvailability>();
  for (const p of ds.arsPlayers) {
    if (p.id === 114 || p.id === 101) {
      availMap.set(p.id, { avail: 0, absen: 1, status: 'i', chance: 0, expectedReturnDate: null });
    } else {
      availMap.set(p.id, { avail: 1, absen: 0, status: 'a', chance: 100, expectedReturnDate: null });
    }
  }

  const pred = predictHybridClubLineup({
    clubShort: 'ARS',
    targetGw: 4,
    isHome: true,
    players: ds.arsPlayers,
    availabilityById: availMap,
    history: hist,
    pastMap: ds.pastMap,
    logitWeights: cal.logitWeights,
    params: cal.params,
  });

  assert.equal(pred.predictedFormation, '4-3-3');
  assert.equal(pred.starterIds.length, 11);
  assert.equal(new Set(pred.starterIds).size, 11);
  assert.equal(pred.slotAssignments.length, 11);
  // Ruled-out players must have si === 0 and not appear in starters
  assert.equal(pred.playerProbs.get(114)?.si, 0);
  assert.equal(pred.playerProbs.get(101)?.si, 0);
  assert.ok(!pred.starterIds.includes(114));
  assert.ok(!pred.starterIds.includes(101));
  // Backup GK (102) and backup Striker (115) step into Starting XI
  assert.ok(pred.starterIds.includes(102));
  assert.ok(pred.starterIds.includes(115));
  // No overlap across starter, bench, out
  const allAssigned = [...pred.starterIds, ...pred.benchIds, ...pred.outIds];
  assert.equal(new Set(allAssigned).size, ds.arsPlayers.length);
});
