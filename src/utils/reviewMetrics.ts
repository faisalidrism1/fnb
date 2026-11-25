import { ActualMatchReviewEntry, PositionType, ProjectedFixtureOutcome } from '../types.ts';

export interface MaeRecapRowLike {
  gw: number;
  isFinished: boolean;
  matchesTotal: number;
  matchesFinished: number;
  teamGoalsMae: number;
  matchGoalsMae: number;
  outcomeHits: number;
  outcomeAccPct: number;
  exactScoreHits: number;
  exactScorePct: number;
  cleanSheetHits: number;
  cleanSheetPct: number;
  totalStartersPredicted: number;
  totalStartersHit: number;
  lineupAccPct: number;
  avgStartersPerClub: number;
  startersCount: number;
  startersXpMae: number;
  activeCount: number;
  activeXpMae: number;
  posMae?: Partial<Record<PositionType, number>>;
  totalProjPts?: number;
  totalRealPts?: number;
  ptsBias?: number;
  compositeScore: number;
  compositeGrade: string;
}

export interface MaeDiagnosticSummary {
  totalMatches: number;
  finishedGwsCount: number;
  seasonOutcomeAcc: number;
  seasonExactScore: number;
  seasonGoalMae: number;
  seasonLineupAcc: number;
  seasonAvgStarters: number;
  seasonStartersMae: number;
  seasonActiveMae: number;
  seasonComposite: number;
  seasonGrade: string;
  posMae: Record<PositionType, number>;
  totalProjPts: number;
  totalRealPts: number;
  ptsBias: number;
  weakestStage: 'lineup' | 'outcome' | 'goals' | 'xp';
  weakestPos: PositionType;
  recent3Composite: number | null;
}

export function computeMaeDiagnosticSummary(
  filteredRows: MaeRecapRowLike[],
  allRows: MaeRecapRowLike[] = filteredRows
): MaeDiagnosticSummary {
  let totalMatches = 0;
  let totalOutcomeHits = 0;
  let totalExactScoreHits = 0;
  let sumTeamGoalsDiff = 0;
  let sumStartersHit = 0;
  let sumStartersProj = 0;
  let sumStartersAbsDiff = 0;
  let sumStartersCount = 0;
  let sumActiveAbsDiff = 0;
  let sumActiveCount = 0;
  let finishedGwsCount = 0;
  let totalProjPts = 0;
  let totalRealPts = 0;

  const posWeightedSum: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const posGwCount: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };

  for (const row of filteredRows) {
    if (!row.isFinished && row.matchesFinished === 0) continue;
    finishedGwsCount += 1;
    totalMatches += row.matchesFinished;
    totalOutcomeHits += row.outcomeHits;
    totalExactScoreHits += row.exactScoreHits;
    sumTeamGoalsDiff += row.teamGoalsMae * (row.matchesFinished * 2);
    sumStartersHit += row.totalStartersHit;
    sumStartersProj += row.totalStartersPredicted;
    sumStartersAbsDiff += row.startersXpMae * row.startersCount;
    sumStartersCount += row.startersCount;
    sumActiveAbsDiff += row.activeXpMae * row.activeCount;
    sumActiveCount += row.activeCount;
    totalProjPts += Number(row.totalProjPts || 0);
    totalRealPts += Number(row.totalRealPts || 0);

    for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
      const val = row.posMae?.[pos];
      if (typeof val === 'number' && val > 0) {
        posWeightedSum[pos] += val;
        posGwCount[pos] += 1;
      }
    }
  }

  const seasonOutcomeAcc = totalMatches > 0 ? Math.round((totalOutcomeHits / totalMatches) * 1000) / 10 : 0;
  const seasonExactScore = totalMatches > 0 ? Math.round((totalExactScoreHits / totalMatches) * 1000) / 10 : 0;
  const seasonGoalMae = totalMatches > 0 ? Math.round((sumTeamGoalsDiff / (totalMatches * 2)) * 100) / 100 : 0;
  const seasonLineupAcc = sumStartersProj > 0 ? Math.round((sumStartersHit / sumStartersProj) * 1000) / 10 : 0;
  const seasonAvgStarters = finishedGwsCount > 0 ? Math.round((sumStartersHit / (finishedGwsCount * 20)) * 10) / 10 : 0;
  const seasonStartersMae = sumStartersCount > 0 ? Math.round((sumStartersAbsDiff / sumStartersCount) * 100) / 100 : 0;
  const seasonActiveMae = sumActiveCount > 0 ? Math.round((sumActiveAbsDiff / sumActiveCount) * 100) / 100 : 0;

  const goalScore = Math.max(0, Math.min(100, Math.round((1 - seasonGoalMae / 2.2) * 100)));
  const ptsScore = Math.max(0, Math.min(100, Math.round((1 - seasonStartersMae / 5.0) * 100)));
  const seasonComposite = Math.round(
    seasonLineupAcc * 0.35 + seasonOutcomeAcc * 0.30 + goalScore * 0.15 + ptsScore * 0.20
  );
  const seasonGrade =
    seasonComposite >= 82 ? 'A+' : seasonComposite >= 75 ? 'A' : seasonComposite >= 68 ? 'B+' : seasonComposite >= 60 ? 'B' : 'C';

  const posMae: Record<PositionType, number> = {
    GKP: posGwCount.GKP > 0 ? Math.round((posWeightedSum.GKP / posGwCount.GKP) * 100) / 100 : 0,
    DEF: posGwCount.DEF > 0 ? Math.round((posWeightedSum.DEF / posGwCount.DEF) * 100) / 100 : 0,
    MID: posGwCount.MID > 0 ? Math.round((posWeightedSum.MID / posGwCount.MID) * 100) / 100 : 0,
    FWD: posGwCount.FWD > 0 ? Math.round((posWeightedSum.FWD / posGwCount.FWD) * 100) / 100 : 0,
  };

  let weakestPos: PositionType = 'MID';
  let maxPosMae = -1;
  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as const) {
    if (posMae[pos] > maxPosMae) {
      maxPosMae = posMae[pos];
      weakestPos = pos;
    }
  }

  // Normalized component scores (0..100) to highlight weakest pipeline stage
  const pillarScores: Array<{ key: 'lineup' | 'outcome' | 'goals' | 'xp'; score: number }> = [
    { key: 'lineup', score: seasonLineupAcc },
    { key: 'outcome', score: seasonOutcomeAcc },
    { key: 'goals', score: goalScore },
    { key: 'xp', score: ptsScore },
  ];
  pillarScores.sort((a, b) => a.score - b.score);
  const weakestStage = pillarScores[0].key;

  const finishedAll = allRows.filter((r) => r.isFinished || r.matchesFinished > 0);
  let recent3Composite: number | null = null;
  if (finishedAll.length >= 4) {
    const last3 = finishedAll.slice(-3);
    recent3Composite = Math.round(last3.reduce((acc, r) => acc + r.compositeScore, 0) / last3.length);
  }

  return {
    totalMatches,
    finishedGwsCount,
    seasonOutcomeAcc,
    seasonExactScore,
    seasonGoalMae,
    seasonLineupAcc,
    seasonAvgStarters,
    seasonStartersMae,
    seasonActiveMae,
    seasonComposite,
    seasonGrade,
    posMae,
    totalProjPts: Math.round(totalProjPts * 10) / 10,
    totalRealPts: Math.round(totalRealPts * 10) / 10,
    ptsBias: Math.round((totalRealPts - totalProjPts) * 10) / 10,
    weakestStage,
    weakestPos,
    recent3Composite,
  };
}

export interface ScoreHorizonSummary {
  totalMatches: number;
  finishedMatches: number;
  wdlHits: number;
  wdlPct: number;
  exactHits: number;
  exactPct: number;
  teamGoalMae: number;
  csHits: number;
  csPct: number;
  projGoalsTotal: number;
  realGoalsTotal: number;
}

export function computeScoreHorizonSummary(
  horizonGWs: number[],
  scheduleByGw: Record<number, any[]>,
  actualMatchLookup: Record<string, ActualMatchReviewEntry[]>,
  projectFixture: (homeShort: string, awayShort: string, gw?: number) => ProjectedFixtureOutcome
): ScoreHorizonSummary {
  let totalMatches = 0;
  let finishedMatches = 0;
  let wdlHits = 0;
  let exactHits = 0;
  let teamGoalsAbsDiff = 0;
  let csHits = 0;
  let projGoalsTotal = 0;
  let realGoalsTotal = 0;

  for (const gw of horizonGWs) {
    const matches = scheduleByGw[gw] || [];
    for (const m of matches) {
      const hShort = m.home_team?.short_name || '';
      const aShort = m.away_team?.short_name || '';
      if (!hShort || !aShort) continue;
      totalMatches += 1;

      const proj = projectFixture(hShort, aShort, gw);
      const actualHList = actualMatchLookup[`${gw}_${hShort}`] || [];
      const actualH = actualHList.find((e) => e.isHome && e.oppShort === aShort) || actualHList[0];
      const isDone = Boolean(actualH && actualH.finished && actualH.teamScore !== null && actualH.oppScore !== null);
      if (!isDone || actualH.teamScore === null || actualH.oppScore === null) continue;

      finishedMatches += 1;
      const realH = actualH.teamScore;
      const realA = actualH.oppScore;

      projGoalsTotal += proj.homeGoals + proj.awayGoals;
      realGoalsTotal += realH + realA;
      teamGoalsAbsDiff += Math.abs(proj.homeGoals - realH) + Math.abs(proj.awayGoals - realA);

      if (proj.homeGoals === realH && proj.awayGoals === realA) {
        exactHits += 1;
      }
      const projRes = proj.homeGoals > proj.awayGoals ? 'H' : proj.homeGoals < proj.awayGoals ? 'A' : 'D';
      const realRes = realH > realA ? 'H' : realH < realA ? 'A' : 'D';
      if (projRes === realRes) {
        wdlHits += 1;
      }

      if ((proj.homeCsProb >= 40) === (realA === 0)) csHits += 1;
      if ((proj.awayCsProb >= 40) === (realH === 0)) csHits += 1;
    }
  }

  return {
    totalMatches,
    finishedMatches,
    wdlHits,
    wdlPct: finishedMatches > 0 ? Math.round((wdlHits / finishedMatches) * 1000) / 10 : 0,
    exactHits,
    exactPct: finishedMatches > 0 ? Math.round((exactHits / finishedMatches) * 1000) / 10 : 0,
    teamGoalMae: finishedMatches > 0 ? Math.round((teamGoalsAbsDiff / (finishedMatches * 2)) * 100) / 100 : 0,
    csHits,
    csPct: finishedMatches > 0 ? Math.round((csHits / (finishedMatches * 2)) * 1000) / 10 : 0,
    projGoalsTotal,
    realGoalsTotal,
  };
}

export interface PointsSliceSummary {
  evaluatedPlayers: number;
  avgProj: number;
  avgReal: number;
  avgBias: number;
  avgMae: number;
  posMae: Record<PositionType, number | null>;
}

export interface PointsReviewRowLike {
  position: PositionType;
  totalProj: number;
  totalReal: number;
  diff: number;
  mae: number;
  playedMatchCount: number;
  totalMins: number;
}

export function computePointsSliceSummary(rows: PointsReviewRowLike[]): PointsSliceSummary {
  let count = 0;
  let sumProj = 0;
  let sumReal = 0;
  let sumMae = 0;

  const posSumMae: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const posCounts: Record<PositionType, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };

  for (const r of rows) {
    if (r.playedMatchCount <= 0) continue;
    count += 1;
    sumProj += r.totalProj;
    sumReal += r.totalReal;
    sumMae += r.mae;
    if (r.position in posSumMae) {
      posSumMae[r.position] += r.mae;
      posCounts[r.position] += 1;
    }
  }

  const avgProj = count > 0 ? Math.round((sumProj / count) * 100) / 100 : 0;
  const avgReal = count > 0 ? Math.round((sumReal / count) * 100) / 100 : 0;
  const avgBias = count > 0 ? Math.round(((sumReal - sumProj) / count) * 100) / 100 : 0;
  const avgMae = count > 0 ? Math.round((sumMae / count) * 100) / 100 : 0;

  return {
    evaluatedPlayers: count,
    avgProj,
    avgReal,
    avgBias,
    avgMae,
    posMae: {
      GKP: posCounts.GKP > 0 ? Math.round((posSumMae.GKP / posCounts.GKP) * 100) / 100 : null,
      DEF: posCounts.DEF > 0 ? Math.round((posSumMae.DEF / posCounts.DEF) * 100) / 100 : null,
      MID: posCounts.MID > 0 ? Math.round((posSumMae.MID / posCounts.MID) * 100) / 100 : null,
      FWD: posCounts.FWD > 0 ? Math.round((posSumMae.FWD / posCounts.FWD) * 100) / 100 : null,
    },
  };
}
