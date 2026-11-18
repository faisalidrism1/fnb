export interface AutosubPlayerStat {
  id?: number;
  name: string;
  club?: string;
  position: string;
  minutes: number;
  points: number;
  ownersCount?: number;
}

export interface ValidFplAutosub {
  team: string;
  dnp: string;
  bench: string;
  benchPts: number;
}

export interface BetweenMatchAutosubWatch {
  playerDnp: string;
  club: string;
  team: string;
  ownersCount: number;
}

interface SquadPickNode {
  id: number;
  name: string;
  club: string;
  position: string;
  slot: number;
  isStarter: boolean;
  minutes: number;
  points: number;
  ownersCount: number;
}

function normalizePosition(pos?: string): 'GKP' | 'DEF' | 'MID' | 'FWD' {
  const upper = String(pos || '').trim().toUpperCase();
  if (upper === 'GKP' || upper === 'GK') return 'GKP';
  if (upper === 'DEF') return 'DEF';
  if (upper === 'FWD') return 'FWD';
  return 'MID';
}

function isOutfieldReplacementFeasible(
  activeCounts: Record<'DEF' | 'MID' | 'FWD', number>,
  candidatePos: 'DEF' | 'MID' | 'FWD',
  remainingDnpSlotsAfterThis: number,
  remainingBenchPool: SquadPickNode[]
): boolean {
  const nextCounts = {
    DEF: activeCounts.DEF + (candidatePos === 'DEF' ? 1 : 0),
    MID: activeCounts.MID + (candidatePos === 'MID' ? 1 : 0),
    FWD: activeCounts.FWD + (candidatePos === 'FWD' ? 1 : 0),
  };

  const defDeficit = Math.max(0, 3 - nextCounts.DEF);
  const midDeficit = Math.max(0, 2 - nextCounts.MID);
  const fwdDeficit = Math.max(0, 1 - nextCounts.FWD);
  const totalDeficit = defDeficit + midDeficit + fwdDeficit;

  if (totalDeficit > remainingDnpSlotsAfterThis) return false;

  const availDef = remainingBenchPool.filter((p) => p.position === 'DEF').length;
  const availMid = remainingBenchPool.filter((p) => p.position === 'MID').length;
  const availFwd = remainingBenchPool.filter((p) => p.position === 'FWD').length;

  return defDeficit <= availDef && midDeficit <= availMid && fwdDeficit <= availFwd;
}

function buildTeamSquads(
  ownershipList: any[],
  getPlayerStat: (playerId: number, op: any) => AutosubPlayerStat | undefined
): Map<string, SquadPickNode[]> {
  const teamSquads = new Map<string, SquadPickNode[]>();

  for (const op of ownershipList) {
    const stat = getPlayerStat(Number(op.id), op);
    const pos = normalizePosition(op.position || stat?.position);
    const name = stat?.name || op.web_name || '';
    const club = stat?.club || '';
    const minutes = Number(stat?.minutes ?? 0);
    const points = Number(stat?.points ?? 0);
    const ownersCount = Number(stat?.ownersCount ?? op.owned_count ?? 0);

    for (const o of op.owners || []) {
      const team = String(o.entry_name || '').trim();
      if (!team || !name) continue;
      const isStarter = o.is_starter === true || (o.position_in_squad != null && Number(o.position_in_squad) <= 11);
      const slot = Number(o.position_in_squad ?? (isStarter ? 1 : 12));

      if (!teamSquads.has(team)) teamSquads.set(team, []);
      teamSquads.get(team)!.push({
        id: Number(op.id),
        name,
        club,
        position: pos,
        slot,
        isStarter,
        minutes,
        points,
        ownersCount,
      });
    }
  }

  return teamSquads;
}

function getBenchBoostTeams(standings: any[]): Set<string> {
  const bboost = new Set<string>();
  for (const s of standings || []) {
    if (s?.active_chip === 'bboost' && s?.entry_name) {
      bboost.add(String(s.entry_name).trim());
    }
  }
  return bboost;
}

/**
 * Computes valid FPL autosubs (Provisional / Confirmed):
 * - Bench Boost teams never trigger autosubs.
 * - Bench GKP (slot 12) can ONLY replace a DNP Starting GKP (slot 1).
 * - Outfield bench (slots 13, 14, 15 in order) can ONLY replace DNP Outfield starters
 *   while preserving a valid FPL formation (DEF >= 3, MID >= 2, FWD >= 1).
 */
export function computeValidFplAutosubs(
  ownershipList: any[],
  standings: any[],
  getPlayerStat: (playerId: number, op: any) => AutosubPlayerStat | undefined
): ValidFplAutosub[] {
  const results: ValidFplAutosub[] = [];
  const bboostTeams = getBenchBoostTeams(standings);
  const teamSquads = buildTeamSquads(ownershipList, getPlayerStat);

  for (const [team, squad] of teamSquads.entries()) {
    if (bboostTeams.has(team)) continue;
    squad.sort((a, b) => a.slot - b.slot);

    const starters = squad.filter((p) => p.isStarter);
    const bench = squad.filter((p) => !p.isStarter);

    // 1. GKP autosub (GKP can ONLY replace GKP)
    const dnpGkp = starters.find((p) => p.position === 'GKP' && p.minutes === 0);
    const benchGkp = bench.find((p) => p.position === 'GKP' && p.minutes > 0);
    if (dnpGkp && benchGkp && benchGkp.points > 0) {
      results.push({
        team,
        dnp: dnpGkp.name,
        bench: benchGkp.name,
        benchPts: benchGkp.points,
      });
    }

    // 2. Outfield autosubs in strict bench priority order (slots 13, 14, 15)
    const activeCounts: Record<'DEF' | 'MID' | 'FWD', number> = { DEF: 0, MID: 0, FWD: 0 };
    const dnpOutfield: SquadPickNode[] = [];
    for (const s of starters) {
      if (s.position === 'GKP') continue;
      if (s.minutes > 0) {
        activeCounts[s.position as 'DEF' | 'MID' | 'FWD']++;
      } else {
        dnpOutfield.push(s);
      }
    }

    if (dnpOutfield.length === 0) continue;

    const playingOutfieldBench = bench.filter((p) => p.position !== 'GKP' && p.minutes > 0);
    let dnpIdx = 0;

    for (let i = 0; i < playingOutfieldBench.length && dnpIdx < dnpOutfield.length; i++) {
      const candidate = playingOutfieldBench[i];
      const remainingBench = playingOutfieldBench.slice(i + 1);
      const remainingDnpAfter = dnpOutfield.length - (dnpIdx + 1);
      const candidatePos = candidate.position as 'DEF' | 'MID' | 'FWD';

      if (isOutfieldReplacementFeasible(activeCounts, candidatePos, remainingDnpAfter, remainingBench)) {
        const replacedStarter = dnpOutfield[dnpIdx];
        dnpIdx++;
        activeCounts[candidatePos]++;
        if (candidate.points > 0) {
          results.push({
            team,
            dnp: replacedStarter.name,
            bench: candidate.name,
            benchPts: candidate.points,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Finds valid Between-Match autosub alerts:
 * - Starter's match has finished with 0 minutes.
 * - Team is not on Bench Boost.
 * - At least one position-compatible bench replacement either played > 0 mins OR still has an unfinished match.
 */
export function findValidBetweenMatchAutosubWatches(
  ownershipList: any[],
  standings: any[],
  getPlayerStat: (playerId: number, op: any) => AutosubPlayerStat | undefined,
  finishedClubFixtureMap: Map<string, any>
): BetweenMatchAutosubWatch[] {
  const watches: BetweenMatchAutosubWatch[] = [];
  const bboostTeams = getBenchBoostTeams(standings);
  const teamSquads = buildTeamSquads(ownershipList, getPlayerStat);

  for (const [team, squad] of teamSquads.entries()) {
    if (bboostTeams.has(team)) continue;
    squad.sort((a, b) => a.slot - b.slot);

    const starters = squad.filter((p) => p.isStarter);
    const bench = squad.filter((p) => !p.isStarter);

    // Check GKP starter DNP
    const dnpGkp = starters.find(
      (p) => p.position === 'GKP' && p.minutes === 0 && finishedClubFixtureMap.has(p.club)
    );
    const benchGkpEligible = bench.some(
      (b) => b.position === 'GKP' && (b.minutes > 0 || !finishedClubFixtureMap.has(b.club))
    );
    if (dnpGkp && benchGkpEligible) {
      watches.push({
        playerDnp: dnpGkp.name,
        club: dnpGkp.club,
        team,
        ownersCount: dnpGkp.ownersCount,
      });
      continue;
    }

    // Check Outfield starter DNP with at least one eligible outfield bench candidate
    const dnpOutfield = starters.filter(
      (p) => p.position !== 'GKP' && p.minutes === 0 && finishedClubFixtureMap.has(p.club)
    );
    if (dnpOutfield.length === 0) continue;

    const activeOrPendingCounts: Record<'DEF' | 'MID' | 'FWD', number> = { DEF: 0, MID: 0, FWD: 0 };
    for (const s of starters) {
      if (s.position === 'GKP') continue;
      if (s.minutes > 0 || !finishedClubFixtureMap.has(s.club)) {
        activeOrPendingCounts[s.position as 'DEF' | 'MID' | 'FWD']++;
      }
    }

    const eligibleOutfieldBench = bench.filter(
      (b) => b.position !== 'GKP' && (b.minutes > 0 || !finishedClubFixtureMap.has(b.club))
    );
    const canSubOutfield = eligibleOutfieldBench.some((b, idx) =>
      isOutfieldReplacementFeasible(
        activeOrPendingCounts,
        b.position as 'DEF' | 'MID' | 'FWD',
        dnpOutfield.length - 1,
        eligibleOutfieldBench.slice(idx + 1)
      )
    );

    if (canSubOutfield) {
      const targetDnp = [...dnpOutfield].sort((a, b) => b.ownersCount - a.ownersCount)[0];
      watches.push({
        playerDnp: targetDnp.name,
        club: targetDnp.club,
        team,
        ownersCount: targetDnp.ownersCount,
      });
    }
  }

  return watches;
}
