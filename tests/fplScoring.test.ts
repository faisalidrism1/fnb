import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FPL_BREAKDOWN_ORDER_MAP,
  calculateMinutesPoints,
  calculateGoalPoints,
  calculateAssistPoints,
  calculateCleanSheetPoints,
  calculateSavesPoints,
  calculatePenaltySavedPoints,
  calculateDefensiveContributionPoints,
  calculateGoalsConcededPoints,
  calculateOwnGoalPoints,
  calculatePenaltyMissedPoints,
  calculateCardPoints,
  calculateTotalPlayerPoints,
  getPlayerPointBreakdown,
} from '../src/utils/fplScoring.ts';

test('calculateMinutesPoints follows 0 / 1-59 / 60+ FPL thresholds', () => {
  assert.equal(calculateMinutesPoints(0), 0);
  assert.equal(calculateMinutesPoints(1), 1);
  assert.equal(calculateMinutesPoints(59), 1);
  assert.equal(calculateMinutesPoints(60), 2);
  assert.equal(calculateMinutesPoints(90), 2);
});

test('calculateGoalPoints & calculateAssistPoints match FPL position matrix', () => {
  assert.equal(calculateGoalPoints('GKP', 1), 6);
  assert.equal(calculateGoalPoints('DEF', 2), 12);
  assert.equal(calculateGoalPoints('MID', 2), 10);
  assert.equal(calculateGoalPoints('FWD', 3), 12);
  assert.equal(calculateGoalPoints('FWD', 0), 0);
  assert.equal(calculateAssistPoints(0), 0);
  assert.equal(calculateAssistPoints(2), 6);
});

test('calculateCleanSheetPoints requires >= 60 minutes and respects position', () => {
  assert.equal(calculateCleanSheetPoints('GKP', 1, 59), 0);
  assert.equal(calculateCleanSheetPoints('DEF', 1, 59), 0);
  assert.equal(calculateCleanSheetPoints('MID', 1, 59), 0);
  assert.equal(calculateCleanSheetPoints('GKP', 1, 60), 4);
  assert.equal(calculateCleanSheetPoints('DEF', 1, 90), 4);
  assert.equal(calculateCleanSheetPoints('MID', 1, 60), 1);
  assert.equal(calculateCleanSheetPoints('FWD', 1, 90), 0);
});

test('calculateSavesPoints & calculatePenaltySavedPoints apply to GKP only', () => {
  assert.equal(calculateSavesPoints('GKP', 2), 0);
  assert.equal(calculateSavesPoints('GKP', 3), 1);
  assert.equal(calculateSavesPoints('GKP', 5), 1);
  assert.equal(calculateSavesPoints('GKP', 6), 2);
  assert.equal(calculateSavesPoints('DEF', 9), 0);

  assert.equal(calculatePenaltySavedPoints('GKP', 1), 5);
  assert.equal(calculatePenaltySavedPoints('GKP', 2), 10);
  assert.equal(calculatePenaltySavedPoints('DEF', 1), 0);
});

test('calculateDefensiveContributionPoints respects DEF>=10, MID/FWD>=12, GKP=0, capped at +2', () => {
  assert.equal(calculateDefensiveContributionPoints('GKP', 20), 0);
  assert.equal(calculateDefensiveContributionPoints('DEF', 9), 0);
  assert.equal(calculateDefensiveContributionPoints('DEF', 10), 2);
  assert.equal(calculateDefensiveContributionPoints('DEF', 24), 2);
  assert.equal(calculateDefensiveContributionPoints('MID', 11), 0);
  assert.equal(calculateDefensiveContributionPoints('MID', 12), 2);
  assert.equal(calculateDefensiveContributionPoints('FWD', 11), 0);
  assert.equal(calculateDefensiveContributionPoints('FWD', 12), 2);
});

test('calculateGoalsConcededPoints & negative events apply strictly', () => {
  assert.equal(calculateGoalsConcededPoints('GKP', 1), 0);
  assert.equal(calculateGoalsConcededPoints('GKP', 2), -1);
  assert.equal(calculateGoalsConcededPoints('DEF', 3), -1);
  assert.equal(calculateGoalsConcededPoints('DEF', 4), -2);
  assert.equal(calculateGoalsConcededPoints('MID', 5), 0);
  assert.equal(calculateGoalsConcededPoints('FWD', 6), 0);

  assert.equal(calculateOwnGoalPoints(1), -2);
  assert.equal(calculatePenaltyMissedPoints(1), -2);
  const yellowOnly = calculateCardPoints(1, 0);
  assert.equal(yellowOnly.yellowPoints, -1);
  assert.ok(yellowOnly.redPoints === 0);
  assert.equal(yellowOnly.total, -1);

  const redOnly = calculateCardPoints(0, 1);
  assert.ok(redOnly.yellowPoints === 0);
  assert.equal(redOnly.redPoints, -3);
  assert.equal(redOnly.total, -3);
});

test('calculateTotalPlayerPoints & getPlayerPointBreakdown sum identically and keep FPL hierarchy', () => {
  // Defender haul: 90m (+2), 1G (+6), 1A (+3), CS (+4), 11 DefCon (+2), 1 YC (-1), 3 BP (+3) = 19 pts
  const defStats = {
    minutes: 90,
    goals_scored: 1,
    assists: 1,
    clean_sheets: 1,
    defensive_contribution: 11,
    yellow_cards: 1,
    bonus: 3,
  };
  const defTotal = calculateTotalPlayerPoints('DEF', defStats);
  assert.equal(defTotal, 19);

  const breakdown = getPlayerPointBreakdown('DEF', defStats);
  assert.equal(
    breakdown.reduce((sum, item) => sum + item.points, 0),
    defTotal
  );
  assert.deepEqual(
    breakdown.map((b) => b.code),
    ['MP', 'GS', 'A', 'CS', 'DC', 'YC', 'BP']
  );
  for (let i = 1; i < breakdown.length; i++) {
    assert.ok(breakdown[i].order > breakdown[i - 1].order);
    assert.equal(breakdown[i].order, FPL_BREAKDOWN_ORDER_MAP[breakdown[i].code]);
  }

  // GKP nightmare match: 90m (+2), 6 saves (+2), 1 pen saved (+5), 4 GC (-2), 1 OG (-2) = 5 pts
  const gkpTotal = calculateTotalPlayerPoints('GKP', {
    minutes: 90,
    saves: 6,
    penalties_saved: 1,
    goals_conceded: 4,
    own_goals: 1,
  });
  assert.equal(gkpTotal, 5);

  // DNP fallback returns single MP=0 item
  assert.deepEqual(getPlayerPointBreakdown('MID', { minutes: 0 }), [
    { code: 'MP', value: 0, points: 0, order: FPL_BREAKDOWN_ORDER_MAP.MP },
  ]);
});
