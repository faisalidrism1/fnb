import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMaeDiagnosticSummary,
  computeScoreHorizonSummary,
  computePointsSliceSummary,
  MaeRecapRowLike,
  PointsReviewRowLike,
} from '../src/utils/reviewMetrics.ts';
import type { ActualMatchReviewEntry, ProjectedFixtureOutcome } from '../src/types.ts';

function makeMaeRow(overrides: Partial<MaeRecapRowLike> = {}): MaeRecapRowLike {
  return {
    gw: 1,
    isFinished: true,
    matchesTotal: 10,
    matchesFinished: 10,
    teamGoalsMae: 0.85,
    matchGoalsMae: 1.4,
    outcomeHits: 6,
    outcomeAccPct: 60,
    exactScoreHits: 2,
    exactScorePct: 20,
    cleanSheetHits: 12,
    cleanSheetPct: 60,
    totalStartersPredicted: 220,
    totalStartersHit: 198,
    lineupAccPct: 90,
    avgStartersPerClub: 9.9,
    startersCount: 220,
    startersXpMae: 2.1,
    activeCount: 280,
    activeXpMae: 2.25,
    posMae: { GKP: 1.9, DEF: 2.0, MID: 2.5, FWD: 1.8 },
    totalProjPts: 780,
    totalRealPts: 810,
    ptsBias: 30,
    compositeScore: 76,
    compositeGrade: 'A',
    ...overrides,
  };
}

test('computeMaeDiagnosticSummary computes weighted metrics, weakest stage/position, and last-3 trend', () => {
  const rows: MaeRecapRowLike[] = [
    makeMaeRow({ gw: 1, compositeScore: 70, outcomeHits: 4, outcomeAccPct: 40, teamGoalsMae: 1.2, posMae: { GKP: 1.8, DEF: 2.0, MID: 2.8, FWD: 1.9 }, totalProjPts: 750, totalRealPts: 770 }),
    makeMaeRow({ gw: 2, compositeScore: 74, outcomeHits: 5, outcomeAccPct: 50, teamGoalsMae: 1.0, posMae: { GKP: 1.7, DEF: 2.1, MID: 2.9, FWD: 2.0 }, totalProjPts: 760, totalRealPts: 790 }),
    makeMaeRow({ gw: 3, compositeScore: 80, outcomeHits: 6, outcomeAccPct: 60, teamGoalsMae: 0.9, posMae: { GKP: 1.6, DEF: 1.9, MID: 2.6, FWD: 1.8 }, totalProjPts: 790, totalRealPts: 800 }),
    makeMaeRow({ gw: 4, compositeScore: 83, outcomeHits: 7, outcomeAccPct: 70, teamGoalsMae: 0.7, posMae: { GKP: 1.5, DEF: 1.8, MID: 2.5, FWD: 1.7 }, totalProjPts: 800, totalRealPts: 820 }),
    makeMaeRow({ gw: 5, isFinished: false, matchesFinished: 0, compositeScore: 0 }),
  ];

  const summary = computeMaeDiagnosticSummary(rows, rows);
  assert.equal(summary.finishedGwsCount, 4);
  assert.equal(summary.totalMatches, 40);
  assert.equal(summary.seasonOutcomeAcc, 55); // (4+5+6+7)/40 = 55%
  assert.equal(summary.seasonLineupAcc, 90);
  assert.equal(summary.weakestPos, 'MID');
  assert.equal(summary.weakestStage, 'outcome'); // 55% is lowest pillar
  assert.equal(summary.recent3Composite, 79); // avg(74, 80, 83) = 79
  assert.equal(summary.totalProjPts, 3100);
  assert.equal(summary.totalRealPts, 3180);
  assert.equal(summary.ptsBias, 80);
});

test('computeScoreHorizonSummary aggregates finished fixtures only and computes WDL/Exact/GoalMAE/CS%', () => {
  const scheduleByGw: Record<number, any[]> = {
    1: [
      { home_team: { short_name: 'ARS' }, away_team: { short_name: 'WOL' } },
      { home_team: { short_name: 'MCI' }, away_team: { short_name: 'CHE' } },
      { home_team: { short_name: 'LIV' }, away_team: { short_name: 'EVE' } }, // unfinished
    ],
  };

  const actualMatchLookup: Record<string, ActualMatchReviewEntry[]> = {
    '1_ARS': [{ gw: 1, oppShort: 'WOL', isHome: true, finished: true, teamScore: 2, oppScore: 0, scoreText: '2-0', result: 'W', cleanSheet: true, kickoff: null }],
    '1_MCI': [{ gw: 1, oppShort: 'CHE', isHome: true, finished: true, teamScore: 1, oppScore: 1, scoreText: '1-1', result: 'D', cleanSheet: false, kickoff: null }],
    '1_LIV': [{ gw: 1, oppShort: 'EVE', isHome: true, finished: false, teamScore: null, oppScore: null, scoreText: 'vs', result: null, cleanSheet: false, kickoff: null }],
  };

  const projectFixture = (h: string, a: string): ProjectedFixtureOutcome => {
    if (h === 'ARS' && a === 'WOL') {
      return { homeGoals: 2, awayGoals: 0, homeCsProb: 52, awayCsProb: 12 } as ProjectedFixtureOutcome;
    }
    return { homeGoals: 2, awayGoals: 1, homeCsProb: 28, awayCsProb: 20 } as ProjectedFixtureOutcome;
  };

  const result = computeScoreHorizonSummary([1], scheduleByGw, actualMatchLookup, projectFixture);
  assert.equal(result.totalMatches, 3);
  assert.equal(result.finishedMatches, 2);
  assert.equal(result.exactHits, 1); // ARS 2-0 exact
  assert.equal(result.exactPct, 50);
  assert.equal(result.wdlHits, 1); // ARS H==H, MCI projected H vs real D
  assert.equal(result.wdlPct, 50);
  // Abs diff: |2-2|+|0-0| + |2-1|+|1-1| = 1 across 4 team-appearances => 0.25
  assert.equal(result.teamGoalMae, 0.25);
  // CS: ARS (52>=40 vs 0 -> hit), WOL (12<40 vs 2 -> hit), MCI (28<40 vs 1 -> hit), CHE (20<40 vs 1 -> hit) => 4/4 = 100%
  assert.equal(result.csHits, 4);
  assert.equal(result.csPct, 100);
});

test('computePointsSliceSummary ignores 0-match rows and returns null for missing positions', () => {
  const rows: PointsReviewRowLike[] = [
    { position: 'GKP', totalProj: 4.5, totalReal: 6.0, diff: 1.5, mae: 1.5, playedMatchCount: 1, totalMins: 90 },
    { position: 'MID', totalProj: 6.0, totalReal: 4.0, diff: -2.0, mae: 2.0, playedMatchCount: 1, totalMins: 75 },
    { position: 'FWD', totalProj: 5.0, totalReal: 0.0, diff: -5.0, mae: 5.0, playedMatchCount: 0, totalMins: 0 }, // ignored
  ];

  const summary = computePointsSliceSummary(rows);
  assert.equal(summary.evaluatedPlayers, 2);
  assert.equal(summary.avgProj, 5.25);
  assert.equal(summary.avgReal, 5);
  assert.equal(summary.avgBias, -0.25);
  assert.equal(summary.avgMae, 1.75);
  assert.equal(summary.posMae.GKP, 1.5);
  assert.equal(summary.posMae.MID, 2);
  assert.equal(summary.posMae.DEF, null);
  assert.equal(summary.posMae.FWD, null);
});
