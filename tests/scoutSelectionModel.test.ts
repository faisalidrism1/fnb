import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlayerGwProjectionCell, PositionType } from '../src/types.ts';
import {
  buildScoutTransferPrecomputedContext,
  getCellAtGw,
  runScoutTransferSearch,
  selectBestXiFrom15AtGw,
  solveScoutSquadForGwMode,
  type ScoutModelPlayerInput,
} from '../src/utils/scoutSelectionModel.ts';

function buildFullSeasonMap(
  baseXp: number,
  pStart = 0.9,
  xMin = 85,
  blankGws: number[] = []
): Record<number, PlayerGwProjectionCell> {
  const map: Record<number, PlayerGwProjectionCell> = {};
  const blanks = new Set(blankGws);
  for (let gw = 1; gw <= 15; gw++) {
    if (blanks.has(gw)) {
      map[gw] = {
        opp: 'BLANK',
        oppShort: 'BLANK',
        isHome: true,
        xp: 0,
        matchCount: 0,
        isBlank: true,
        xMin: 0,
        pStart: 0,
        mcQ85: 0,
        mcPHaul10: 0,
      };
    } else {
      map[gw] = {
        opp: 'OPP',
        oppShort: 'OPP',
        isHome: gw % 2 === 0,
        xp: baseXp,
        matchCount: 1,
        xMin,
        pStart,
        mcQ85: baseXp * 1.6,
        mcPHaul10: Math.min(0.45, Math.max(0.02, (baseXp - 3) / 10)),
      };
    }
  }
  return map;
}

function buildSyntheticScoutPool(): ScoutModelPlayerInput[] {
  const clubs = ['ARS', 'AVL', 'BOU', 'BRE', 'CHE', 'LIV', 'MCI', 'NEW'];
  const players: ScoutModelPlayerInput[] = [];
  let nextId = 1;

  // 8 GKPs (4 starters ~5.0m, 4 cheap ~4.0m)
  for (let i = 0; i < 8; i++) {
    const isFirst = i < 4;
    players.push({
      id: nextId++,
      position: 'GKP',
      teamShort: clubs[i % clubs.length],
      cost: isFirst ? 5.0 + i * 0.1 : 4.0,
      status: 'a',
      chanceOfPlaying: 100,
      fullSeasonPointsMap: buildFullSeasonMap(isFirst ? 4.4 - i * 0.2 : 0.6, isFirst ? 0.95 : 0.1, isFirst ? 90 : 5),
    });
  }

  // 14 DEFs (mix of premium, mid-price, and 4.0m bench)
  for (let i = 0; i < 14; i++) {
    const club = clubs[i % clubs.length];
    const cost = i < 4 ? 6.0 - i * 0.2 : i < 10 ? 4.8 : 4.0;
    const xp = i < 4 ? 5.2 - i * 0.2 : i < 10 ? 4.1 - (i - 4) * 0.15 : 1.5;
    players.push({
      id: nextId++,
      position: 'DEF',
      teamShort: club,
      cost,
      status: 'a',
      chanceOfPlaying: 100,
      fullSeasonPointsMap: buildFullSeasonMap(xp, i < 10 ? 0.9 : 0.4, i < 10 ? 84 : 30),
    });
  }

  // 14 MIDs
  for (let i = 0; i < 14; i++) {
    const club = clubs[i % clubs.length];
    const cost = i < 4 ? 9.5 - i * 0.6 : i < 10 ? 6.5 - (i - 4) * 0.2 : 4.5;
    const xp = i < 4 ? 6.8 - i * 0.35 : i < 10 ? 5.0 - (i - 4) * 0.2 : 1.8;
    players.push({
      id: nextId++,
      position: 'MID',
      teamShort: club,
      cost,
      status: 'a',
      chanceOfPlaying: 100,
      deadBall: i === 0 ? { isPrimaryPen: true } : undefined,
      fullSeasonPointsMap: buildFullSeasonMap(xp, i < 10 ? 0.92 : 0.45, i < 10 ? 82 : 35),
    });
  }

  // 10 FWDs
  for (let i = 0; i < 10; i++) {
    const club = clubs[i % clubs.length];
    const cost = i < 3 ? 10.5 - i * 1.2 : i < 7 ? 6.8 - (i - 3) * 0.3 : 4.5;
    const xp = i < 3 ? 7.2 - i * 0.4 : i < 7 ? 4.9 - (i - 3) * 0.25 : 1.7;
    players.push({
      id: nextId++,
      position: 'FWD',
      teamShort: club,
      cost,
      status: 'a',
      chanceOfPlaying: 100,
      deadBall: i === 0 ? { isPrimaryPen: true } : undefined,
      fullSeasonPointsMap: buildFullSeasonMap(xp, i < 7 ? 0.9 : 0.4, i < 7 ? 80 : 30),
    });
  }

  return players;
}

function assertValidSquad15(
  squadIds: number[],
  starterIds: number[],
  benchIds: number[],
  players: ScoutModelPlayerInput[]
) {
  const byId = new Map(players.map((p) => [p.id, p]));
  assert.equal(squadIds.length, 15);
  assert.equal(new Set(squadIds).size, 15);
  assert.equal(starterIds.length, 11);
  assert.equal(benchIds.length, 4);

  const posCounts: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const xiPosCounts: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCounts = new Map<string, number>();

  for (const id of squadIds) {
    const p = byId.get(id)!;
    assert.ok(p);
    posCounts[p.position]++;
    clubCounts.set(p.teamShort, (clubCounts.get(p.teamShort) || 0) + 1);
  }
  for (const id of starterIds) {
    const p = byId.get(id)!;
    xiPosCounts[p.position]++;
  }

  assert.deepEqual(posCounts, { GKP: 2, DEF: 5, MID: 5, FWD: 3 });
  assert.equal(xiPosCounts.GKP, 1);
  assert.ok(xiPosCounts.DEF >= 3);
  assert.ok(xiPosCounts.MID >= 2);
  assert.ok(xiPosCounts.FWD >= 1);
  for (const cnt of clubCounts.values()) {
    assert.ok(cnt <= 3, `Club cap exceeded: ${cnt}`);
  }
}

test('getCellAtGw zeroes ruled-out player at targetNextGW without corrupting historical calibration GWs', () => {
  const injuredPlayer: ScoutModelPlayerInput = {
    id: 999,
    position: 'MID',
    teamShort: 'ARS',
    cost: 8.0,
    status: 'i',
    chanceOfPlaying: 0,
    fullSeasonPointsMap: buildFullSeasonMap(6.2, 0.9, 85),
  };

  const historicalCell = getCellAtGw(injuredPlayer, 4, 8);
  assert.equal(historicalCell.xp, 6.2);
  assert.equal(historicalCell.pStart, 0.9);

  const targetCell = getCellAtGw(injuredPlayer, 8, 8);
  assert.equal(targetCell.xp, 0);
  assert.equal(targetCell.pStart, 0);
});

test('solveScoutSquadForGwMode enforces 15-man constraints, budget <= 100.0, XI <= 83.0, and excludes ruled-out players', () => {
  const players = buildSyntheticScoutPool();
  // Injure the highest xP striker so solver must exclude him at GW8
  const topFwd = players.find((p) => p.position === 'FWD')!;
  topFwd.status = 'i';
  topFwd.chanceOfPlaying = 0;

  for (const mode of ['FH', 'WC'] as const) {
    const res = solveScoutSquadForGwMode({
      players,
      targetNextGW: 8,
      targetGw: 8,
      mode,
    });

    const allIds = [...res.starterIds, ...res.benchIds];
    assertValidSquad15(allIds, res.starterIds, res.benchIds, players);
    assert.ok(res.totalCost <= 100.0 + 1e-6, `${mode} totalCost ${res.totalCost} > 100`);
    assert.ok(res.xiCost <= res.xiBudget + 1e-6, `${mode} xiCost ${res.xiCost} > ${res.xiBudget}`);
    assert.ok(!allIds.includes(topFwd.id), `${mode} must not pick ruled-out player`);
  }
});

test('selectBestXiFrom15AtGw chooses legal highest-xP formation', () => {
  const players = buildSyntheticScoutPool();
  const res = solveScoutSquadForGwMode({
    players,
    targetNextGW: 8,
    targetGw: 8,
    mode: 'WC',
  });
  const squad15 = [...res.starterIds, ...res.benchIds];
  const xi = selectBestXiFrom15AtGw(squad15, players, 8, 8);
  assertValidSquad15(squad15, xi.starterIds, xi.benchIds, players);
  assert.match(xi.formation, /^[3-5]-[2-5]-[1-3]$/);
});

test('buildScoutTransferPrecomputedContext produces exact search parity & obeys FT vs HIT penalties', () => {
  const players = buildSyntheticScoutPool();
  const baseSolved = solveScoutSquadForGwMode({
    players,
    targetNextGW: 8,
    targetGw: 8,
    mode: 'WC',
  });
  const squad15 = [...baseSolved.starterIds, ...baseSolved.benchIds];

  // Break 2 starters in squad15 so there are clearly worthwhile upgrades
  const brokenMidId = baseSolved.starterIds.find(
    (id) => players.find((p) => p.id === id)?.position === 'MID'
  )!;
  const brokenDefId = baseSolved.starterIds.find(
    (id) => players.find((p) => p.id === id)?.position === 'DEF'
  )!;
  const brokenMid = players.find((p) => p.id === brokenMidId)!;
  const brokenDef = players.find((p) => p.id === brokenDefId)!;
  brokenMid.status = 'i';
  brokenMid.chanceOfPlaying = 0;
  brokenDef.status = 'i';
  brokenDef.chanceOfPlaying = 0;

  // Give broken players higher selling price & generous bank so top replacements are affordable
  const bank = 4.0;

  // Parity check: precomputedContext vs direct search
  const ctx = buildScoutTransferPrecomputedContext({
    players,
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
  });
  const searchDirect = runScoutTransferSearch({
    players,
    squad15Ids: squad15,
    bank,
    ftAllowance: 1,
    transferMode: 'HIT',
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
  });
  const searchPrecomp = runScoutTransferSearch({
    players,
    squad15Ids: squad15,
    bank,
    ftAllowance: 1,
    transferMode: 'HIT',
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
    precomputedContext: ctx,
  });

  assert.deepEqual(searchPrecomp.moves, searchDirect.moves);
  assert.equal(searchPrecomp.bestScore, searchDirect.bestScore);
  assert.equal(searchPrecomp.endXI.xiXpH, searchDirect.endXI.xiXpH);
  assert.equal(searchPrecomp.endBank, searchDirect.endBank);
  assert.equal(searchPrecomp.endXI.formation, searchDirect.endXI.formation);

  // When replacement DEF only adds ~2.3 xP over bench, HIT mode sensibly declines taking a -4 hit
  assert.equal(searchPrecomp.moves.length, 1);
  assert.equal(searchPrecomp.hitCount, 0);
  assert.equal(searchPrecomp.hitCost, 0);

  // Now add an elite DGW-like DEF candidate (10.5 xP) from a fresh club so the 2nd transfer clearly beats -4 + hitSurplusMargin
  players.push({
    id: 9001,
    position: 'DEF',
    teamShort: 'TOT',
    cost: 5.5,
    status: 'a',
    chanceOfPlaying: 100,
    fullSeasonPointsMap: buildFullSeasonMap(10.5, 0.96, 90),
  });
  // Also ensure an elite available MID replacement (10.5 xP) exists from another fresh club
  players.push({
    id: 9002,
    position: 'MID',
    teamShort: 'MUN',
    cost: 8.5,
    status: 'a',
    chanceOfPlaying: 100,
    fullSeasonPointsMap: buildFullSeasonMap(10.5, 0.96, 90),
  });

  const ctxWithDgw = buildScoutTransferPrecomputedContext({
    players,
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
  });

  // FT mode still strictly obeys ftAllowance = 1 and hitCost = 0
  const searchFtOnly = runScoutTransferSearch({
    players,
    squad15Ids: squad15,
    bank: 6.0,
    ftAllowance: 1,
    transferMode: 'FT',
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
    precomputedContext: ctxWithDgw,
  });
  assert.ok(searchFtOnly.moves.length <= 1);
  assert.equal(searchFtOnly.hitCount, 0);
  assert.equal(searchFtOnly.hitCost, 0);

  // HIT mode now fixes both broken starters (2 moves => 1 hit = 4 pts hitCost)
  const searchHitDgw = runScoutTransferSearch({
    players,
    squad15Ids: squad15,
    bank: 6.0,
    ftAllowance: 1,
    transferMode: 'HIT',
    startGw: 8,
    targetNextGW: 8,
    horizonCount: 1,
    precomputedContext: ctxWithDgw,
  });
  assert.equal(searchHitDgw.moves.length, 2);
  assert.equal(searchHitDgw.hitCount, 1);
  assert.equal(searchHitDgw.hitCost, 4);
  assert.ok(searchHitDgw.netGain > 0);
});
