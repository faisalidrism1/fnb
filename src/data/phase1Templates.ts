import fs from 'fs';
import path from 'path';

export interface Phase1TemplateItem {
  no: number;
  gw?: number;
  id: string;
  timestamp?: string;
  source?: 'Bukan' | 'Sys' | string;
  gw_phase: string;
  category: string;
  subcategory: string;
  title?: string;
  output?: 'SINGLE-NEWS' | 'MULTI-NEWS' | string;
  template: string; // Teks template narasi (mendukung varian kondisi bila ada)
  example: string;  // Otomatis ter-update mengikuti template
  code: string;     // Murni logika teknis tanpa hardcoded narasi
  sample_data: Record<string, string | number>; // Data sampel realistis untuk preview example
  updated_at?: string;
}

/**
 * ============================================================================
 * KONVENSI FPL & STATUS GAMEWEEK:
 * Setelah transfer deadline terlewati, game FPL SUDAH RESMI MASUK KE GAMEWEEK N.
 * Status 'Not started' BUKAN berarti Gameweek N belum dimulai secara game/kalender,
 * melainkan berarti seluruh manajer sudah terkunci di GW N, tetapi BELUM ADA
 * PERTANDINGAN YANG DIMULAI (kickoff) di pekan tersebut.
 * 
 * ATURAN BAKU NARASI BERITA (FASE NOT STARTED):
 * - JANGAN gunakan kata "menjelang", "sebelum Gameweek [N:{gw}]", atau frasa
 *   sejenis yang mengesankan Gameweek N belum tiba.
 * - Gunakan frasa: "di Gameweek [N:{gw}]", "pada Gameweek [N:{gw}]", dsb.,
 *   karena kondisi tim dan pilihan manajer sudah resmi aktif di Gameweek N.
 * ============================================================================
 */

const TEMPLATES_FILE_PATH = path.join(process.cwd(), 'src/data/phase1_templates.json');

/**
 * Interpolates variables inside template with sample data to generate Example dynamically.
 * If template contains multiple [Kondisi: ...], renders each branch with its header!
 */
export function interpolateExample(template: string, sampleData: Record<string, any>): string {
  if (!template) return '';
  if (!sampleData) return template;

  const hasConditions = /\[Kondisi:[^\]]+\]/i.test(template);

  if (hasConditions) {
    const lines = template.split('\n');
    let currentCondition = '';
    const renderedSections: { header: string; lines: string[] }[] = [];
    let currentLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = /^\[Kondisi:\s*([^\]]+)\]$/i.exec(line);
      if (match) {
        if (currentCondition || currentLines.length > 0) {
          renderedSections.push({ header: currentCondition, lines: currentLines });
        }
        currentCondition = match[0];
        currentLines = [];
      } else if (line) {
        currentLines.push(rawLine);
      }
    }

    if (currentCondition || currentLines.length > 0) {
      renderedSections.push({ header: currentCondition, lines: currentLines });
    }

    return renderedSections.map((sec) => {
      let body = sec.lines.join('\n');
      for (const [k, v] of Object.entries(sampleData)) {
        const regex = new RegExp(`\\{${k}\\}`, 'g');
        body = body.replace(regex, String(v));
      }
      return sec.header ? `${sec.header}\n${body}` : body;
    }).join('\n\n').trim();
  }

  let result = template;
  for (const [k, v] of Object.entries(sampleData)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    result = result.replace(regex, String(v));
  }
  return result.trim();
}

export const DEFAULT_PHASE1_TEMPLATES: Phase1TemplateItem[] = [
  {
    no: 1,
    id: 'NS_MATCH_FIXTURE_OPENING',
    gw_phase: 'Not started',
    category: 'Match',
    subcategory: 'Fixture',
    title: 'Opening Fixture',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Laga]
Gameweek [N:{gw}] diawali oleh pertandingan antara [C:{home_club}] dan [C:{away_club}] pada pukul [N:{kickoff_time}].

[Kondisi: Multi Laga]
Gameweek [N:{gw}] diawali oleh [N:{count}] pertandingan serentak pada pukul [N:{kickoff_time}]: {matches_list}.`,
    example: '',
    code: `const fixtures = getUpcomingOpeningFixtures(gw)
  .sort((a, b) => new Date(a.kickoffTimeRaw).getTime() - new Date(b.kickoffTimeRaw).getTime());
if (fixtures.length === 1) {
  const f = fixtures[0];
  return renderTemplate(template.single, {
    gw,
    kickoff_time: f.kickoffTime,
    home_club: f.homeClub,
    away_club: f.awayClub,
  });
}
const pairs = fixtures.map((f) => \`[C:\${f.homeClub}] vs [C:\${f.awayClub}]\`);
const listStr = pairs.length > 1
  ? \`\${pairs.slice(0, -1).join(', ')} dan \${pairs[pairs.length - 1]}\`
  : (pairs[0] || '');

return renderTemplate(template.multi, {
  gw,
  count: fixtures.length,
  kickoff_time: fixtures[0].kickoffTime,
  matches_list: listStr,
});`,
    sample_data: {
      gw: '9',
      kickoff_time: '18:30 WIB',
      home_club: 'Leicester',
      away_club: 'Nott\'m Forest',
      count: '5',
      matches_list: '[C:Leicester] vs [C:Nott\'m Forest], [C:Aston Villa] vs [C:Bournemouth], [C:Brentford] vs [C:Ipswich Town], [C:Brighton] vs [C:Wolves] dan [C:Man City] vs [C:Southampton]',
    },
  },
  {
    no: 2,
    id: 'NS_CHIP_WILDCARD',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Wildcard',
    title: 'Wildcard',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Wildcard] dengan merekrut [P:{player_in}] dan melepas [P:{player_out}].

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Wildcard], dengan [P:{player_in}] menjadi rekrutan terbanyak dan [P:{player_out}] paling banyak dilepas.`,
    example: '',
    code: `const wcTeams = getManagersUsingChip(gw, 'wildcard');
if (wcTeams.length === 0) return null;

const netTransfers = getNetTransfersSummary(wcTeams, gw);
if (!netTransfers) return null;

if (wcTeams.length === 1) {
  return renderTemplate(template.single, {
    team: wcTeams[0].name,
    player_in: netTransfers.player_in,
    player_out: netTransfers.player_out,
  });
}

const teamsStr = formatTeamList(wcTeams.map(t => t.name));
return renderTemplate(template.multi, {
  teams: teamsStr,
  player_in: netTransfers.player_in,
  player_out: netTransfers.player_out,
});`,
    sample_data: {
      team: 'blue one',
      teams: '[T:Garuda FC] dan [T:Bintang Timur]',
      player_in: 'Isak',
      player_out: 'Cherki',
    },
  },
  {
    no: 3,
    id: 'NS_CHIP_FREE_HIT',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Free Hit',
    title: 'Free Hit',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Free Hit] dengan mendatangkan [P:{player_in}] serta melepas [P:{player_out}].

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Free Hit], dengan [P:{player_in}] paling banyak didatangkan dan [P:{player_out}] paling banyak dilepas.`,
    example: '',
    code: `const fhTeams = getManagersUsingChip(gw, 'freehit');
if (fhTeams.length === 0) return null;

const netTransfers = getNetTransfersSummary(fhTeams, gw);
if (!netTransfers) return null;

if (fhTeams.length === 1) {
  return renderTemplate(template.single, {
    team: fhTeams[0].name,
    player_in: netTransfers.player_in,
    player_out: netTransfers.player_out,
  });
}

const teamsStr = formatTeamList(fhTeams.map(t => t.name));
return renderTemplate(template.multi, {
  teams: teamsStr,
  player_in: netTransfers.player_in,
  player_out: netTransfers.player_out,
});`,
    sample_data: {
      team: 'Tim Holland',
      teams: '[T:Singa FC] dan [T:Harimau Jaya]',
      player_in: 'Isak',
      player_out: 'Cherki',
    },
  },
  {
    no: 4,
    id: 'NS_CHIP_BENCH_BOOST',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Bench Boost',
    title: 'Bench Boost',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Bench Boost] dengan menempatkan {bench_players} di bangku cadangan.

[Kondisi: Multi Tim - Pemain Sama]
{teams} mengaktifkan [N:Bench Boost], dengan [P:{player_bench}] paling banyak ditempatkan di bangku cadangan.

[Kondisi: Multi Tim - Semua Berbeda]
{teams} mengaktifkan [N:Bench Boost], dengan [P:{player_bench}] menjadi sorotan utama di bangku cadangan.`,
    example: '',
    code: `const bbTeams = getManagersUsingChip(gw, 'bboost');
if (bbTeams.length === 0) return null;

const bbSummary = getBenchBoostSummaryForTeams(bbTeams.map(t => t.id));
if (!bbSummary) return null;

if (bbTeams.length === 1) {
  return renderTemplate(template.single, {
    team: bbTeams[0].name,
    bench_players: bbSummary.benchPlayersList,
  });
}

const teamsStr = formatTeamList(bbTeams.map(t => t.name));
if (!teamsStr) return null;

if (bbSummary.maxCount >= 2) {
  return renderTemplate(template.multiSame, {
    teams: teamsStr,
    player_bench: bbSummary.topPlayer,
  });
}

return renderTemplate(template.multiDiff, {
  teams: teamsStr,
  player_bench: bbSummary.topPlayer,
});`,
    sample_data: {
      team: 'Sumber Bahagia Motor',
      bench_players: '[P:Verbruggen], [P:Calafiori], [P:Gakpo] dan [P:Van Hecke]',
      teams: '[T:FornasPengawasan], [T:TELUR DADAR] dan [T:ehajrakab fc]',
      player_bench: 'Van Hecke',
    },
  },
  {
    no: 5,
    id: 'NS_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Triple Captain',
    title: 'Triple Captain',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Triple Captain] dengan menunjuk [P:{captain}] sebagai kapten.

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Triple Captain] dengan menunjuk [P:{dominant_captain}] sebagai kapten{others_clause}.`,
    example: '',
    code: `const tcTeams = getManagersUsingChip(gw, '3xc');
if (tcTeams.length === 0) return null;

if (tcTeams.length === 1) {
  const cap = getTeamCaptain(tcTeams[0].id, gw);
  if (!cap?.name) return null;
  return renderTemplate(template.single, {
    team: tcTeams[0].name,
    captain: cap.name,
  });
}

const captainDistribution = getCaptainDistribution(tcTeams, gw);
if (captainDistribution.length === 0) return null;
const dominant = captainDistribution[0];
const dominantTeams = tcTeams.filter(t => t.captainId === dominant.playerId);
const othersCount = tcTeams.length - dominantTeams.length;

const teamsStr = formatTeamList(dominantTeams.map(t => t.name));
if (!teamsStr) return null;
const othersClause = othersCount > 0 
  ? formatOthersCaptainSummary(othersCount) 
  : '';

return renderTemplate(template.multi, {
  teams: teamsStr,
  dominant_captain: dominant.playerName,
  others_clause: othersClause,
});`,
    sample_data: {
      team: 'cilukba',
      captain: 'Haaland',
      teams: '[T:Anti Koruptor Laknat]',
      dominant_captain: 'Isak',
      others_clause: ', sementara [T:Rajo\'s Team] mengapteni [P:De Cuyper]',
    },
  },
  {
    no: 6,
    id: 'NS_CHIP_SUMMARY_USAGE',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Summary',
    title: 'Chip Usage Summary',
    output: 'SINGLE-NEWS',
    template: `Total penggunaan chip di FNB League hingga Gameweek [N:{gw}]: {chips_summary}.`,
    example: '',
    code: `const recap = getSeasonChipUsageStats(gw);
if (!recap || recap.total === 0) return null;
const summary = buildChipAccumulationSummary(recap);
if (!summary) return null;

return renderTemplate(template, {
  gw,
  chips_summary: summary,
});`,
    sample_data: {
      gw: '10',
      chips_summary: '[N:Wildcard] [N:59] ([N:+1]), [N:Free Hit] [N:16] ([N:+1]), [N:Bench Boost] [N:30] ([N:+3]) dan [N:Triple Captain] [N:31] ([N:+2])',
    },
  },
  {
    no: 7,
    id: 'NS_TRANSFER_IN_MOST_BOUGHT',
    gw_phase: 'Not started',
    category: 'Transfer',
    subcategory: 'Transfers In',
    title: 'Most Bought',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Terbanyak Tunggal]
[P:{player1}] memuncaki daftar transfer masuk setelah direkrut [N:{count1}] tim, diikuti [P:{player2}] ([N:{count2}] tim).

[Kondisi: Seri di Puncak]
[P:{player1}] dan [P:{player2}] memuncaki daftar transfer masuk setelah {keduanya} direkrut [N:{count1}] tim.`,
    example: '',
    code: `// Bruto transfer masuk GW N: grouping pakai element_in.id, tampilkan element_in.name (web_name)
const topIn = getTopTransferredInPlayersByElementId(gw, 2);
if (topIn.length < 2) return null;

if (topIn[0].count === topIn[1].count) {
  return renderTemplate(template.tied, {
    player1: topIn[0].name,
    player2: topIn[1].name,
    count1: topIn[0].count,
    keduanya: 'keduanya',
  });
}

return renderTemplate(template.single, {
  player1: topIn[0].name,
  count1: topIn[0].count,
  player2: topIn[1].name,
  count2: topIn[1].count,
});`,
    sample_data: {
      player1: 'Van Hecke',
      count1: '15',
      player2: 'Evanilson',
      count2: '14',
      keduanya: 'keduanya',
    },
  },
  {
    no: 8,
    id: 'NS_TRANSFER_OUT_MOST_SOLD',
    gw_phase: 'Not started',
    category: 'Transfer',
    subcategory: 'Transfers Out',
    title: 'Most Sold',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Terbanyak Tunggal]
[P:{player1}] menempati urutan teratas transfer keluar setelah dilepas [N:{count1}] tim, diikuti [P:{player2}] ([N:{count2}] tim).

[Kondisi: Seri di Puncak]
[P:{player1}] dan [P:{player2}] menempati urutan teratas transfer keluar setelah {keduanya} dilepas [N:{count1}] tim.`,
    example: '',
    code: `// Bruto transfer keluar GW N: grouping pakai element_out.id, tampilkan element_out.name (web_name)
const topOut = getTopTransferredOutPlayersByElementId(gw, 2);
if (topOut.length < 2) return null;

if (topOut[0].count === topOut[1].count) {
  return renderTemplate(template.tied, {
    player1: topOut[0].name,
    player2: topOut[1].name,
    count1: topOut[0].count,
    keduanya: 'keduanya',
  });
}

return renderTemplate(template.single, {
  player1: topOut[0].name,
  count1: topOut[0].count,
  player2: topOut[1].name,
  count2: topOut[1].count,
});`,
    sample_data: {
      player1: 'João Pedro',
      count1: '14',
      player2: 'Cherki',
      count2: '11',
      keduanya: 'keduanya',
    },
  },
  {
    no: 9,
    id: 'NS_CAPTAIN_POPULAR_MOST_CAPTAINED',
    gw_phase: 'Not started',
    category: 'Captain',
    subcategory: 'Popular',
    title: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `[P:{dominant_captain}] memuncaki daftar kapten terpopuler setelah dipilih [N:{count1}] tim{second_clause}{others_clause}.`,
    example: '',
    code: `const capStats = getLeagueCaptaincyStats(gw);
if (capStats.length === 0) return null;

const dominant = capStats[0];
const second = capStats[1];
const othersCount = capStats.slice(2).reduce((sum, item) => sum + item.count, 0);

return renderTemplate(template, {
  dominant_captain: dominant.playerName,
  count1: dominant.count,
  second_clause: second ? \`, diikuti [P:\${second.playerName}] ([N:\${second.count}] tim)\` : '',
  others_clause: othersCount > 0 ? \`, sementara [N:\${othersCount}] tim memilih kapten lain\` : '',
});`,
    sample_data: {
      dominant_captain: 'Haaland',
      count1: '65',
      second_clause: ', diikuti [P:Isak] ([N:9] tim)',
      others_clause: ', sementara [N:23] tim memilih kapten lain',
    },
  },
  {
    no: 10,
    id: 'NS_TRANSFER_HITS_MOST',
    gw_phase: 'Not started',
    category: 'Transfer',
    subcategory: 'Hits',
    title: 'Most Hits',
    output: 'SINGLE-NEWS',
    template: `{teams_with_hits} memulai pekan dengan penalti poin akibat aktivitas transfer berlebih.`,
    example: '',
    code: `const teamsWithHits = getTeamsWithTransferHits(gw);
if (teamsWithHits.length === 0) return null;

// Format daftar tim dengan penalti minus poin masing-masing (tanpa koma sebelum dan)
const teamsFormatted = formatTeamsListWithPointsDeduction(teamsWithHits);

return renderTemplate(template, {
  teams_with_hits: teamsFormatted,
});`,
    sample_data: {
      teams_with_hits: '[T:asoy banget] ([N:-24 Poin]), [T:Sunnah Rasul FC] ([N:-12 Poin]) dan [N:13] tim lainnya',
    },
  },
  {
    no: 11,
    id: 'NS_PLAYER_OWNERSHIP_MOST_OWNED',
    gw_phase: 'Not started',
    category: 'Player',
    subcategory: 'Ownership',
    title: 'Most Owned',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Terbanyak Tunggal]
[P:{player1}] menjadi pemain dengan kepemilikan tertinggi sebesar [N:{pct1}%], mengungguli [P:{player2}] ([N:{pct2}%]).

[Kondisi: Seri di Puncak]
[P:{player1}] dan [P:{player2}] menjadi pemain dengan kepemilikan tertinggi setelah {keduanya} mencatat [N:{pct1}%].`,
    example: '',
    code: `const topOwned = getLeagueOwnershipList(gw, 2);
if (topOwned.length < 2) return null;

const pct1 = Math.round(topOwned[0].ownershipPercentage);
const pct2 = Math.round(topOwned[1].ownershipPercentage);

if (pct1 === pct2) {
  return renderTemplate(template.tied, {
    player1: topOwned[0].name,
    player2: topOwned[1].name,
    pct1,
    keduanya: 'keduanya',
  });
}

return renderTemplate(template.single, {
  player1: topOwned[0].name,
  pct1,
  player2: topOwned[1].name,
  pct2,
});`,
    sample_data: {
      player1: 'Haaland',
      pct1: '96',
      player2: 'De Cuyper',
      pct2: '79',
      keduanya: 'keduanya',
    },
  },
  {
    no: 12,
    id: 'NS_LINEUP_DIFFERENTIAL_XI',
    gw_phase: 'Not started',
    category: 'Lineup',
    subcategory: 'Differential',
    title: 'Differential XI',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Pemain]
[T:{team}] mengandalkan [P:{player1}] ([N:{pct1}%]) sebagai differential di susunan pemain inti.

[Kondisi: 2 Pemain]
[T:{team}] menyertakan dua pemain differential, [P:{player1}] ([N:{pct1}%]) dan [P:{player2}] ([N:{pct2}%]), di susunan pemain inti.`,
    example: '',
    code: `// Single News: Pilih 1 tim dengan starting XI paling unik (< 5%), seleksi via Opsi B (Least Featured)
const candidates = getTeamsWithDifferentialStarters(gw, 0.05);
if (candidates.length === 0) return null;

// Sort by count differential desc, lalu Opsi B
const sortedTeams = sortByLeastFeaturedTeam(candidates);
const topTeam = sortedTeams[0];
const topDiffs = pickTop2ByPointForm(topTeam.diffStarters);

if (topDiffs.length === 1) {
  return renderTemplate(template.single, {
    team: topTeam.name,
    player1: topDiffs[0].name,
    pct1: topDiffs[0].ownershipPct,
  });
}
return renderTemplate(template.multi, {
  team: topTeam.name,
  player1: topDiffs[0].name,
  pct1: topDiffs[0].ownershipPct,
  player2: topDiffs[1].name,
  pct2: topDiffs[1].ownershipPct,
});`,
    sample_data: {
      team: 'Wayolo FC',
      player1: 'Wirtz',
      pct1: '1',
      player2: 'Jacquet',
      pct2: '4',
    },
  },
  {
    no: 13,
    id: 'NS_CAPTAIN_DIFFERENTIAL',
    gw_phase: 'Not started',
    category: 'Captain',
    subcategory: 'Differential',
    title: 'Differential Captain',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Eksklusif (1 Tim)]
[T:{team}] menjadi satu-satunya tim yang menunjuk [P:{captain}] sebagai kapten.

[Kondisi: Kapten Differential (< 5%)]
{teams} menunjuk [P:{captain}] sebagai kapten differential dengan total hanya [N:{pickers_count}] pemilih.`,
    example: '',
    code: `// Single News: Pilih kapten terlangka (< 5%), cocokkan tim via captain.id
const diffCaptains = getDifferentialCaptains(gw, 0.05);
if (diffCaptains.length === 0) return null;

// Urutkan kapten terlangka (count terkecil, cost termahal)
const topCap = diffCaptains[0];
const candidateTeams = sortByLeastFeaturedTeam(getTeamsCaptainPickers(topCap.id, gw));

if (topCap.pickersCount === 1) {
  return renderTemplate(template.exclusive, {
    team: candidateTeams[0].name,
    captain: topCap.name,
  });
}

const teamsStr = formatTeamList(candidateTeams.map(t => t.name));
return renderTemplate(template.differential, {
  teams: teamsStr,
  captain: topCap.name,
  pickers_count: topCap.pickersCount,
});`,
    sample_data: {
      team: 'BERCELANA',
      teams: '[T:Persigundul] dan [T:Tolyam074]',
      captain: 'B.Fernandes',
      pickers_count: '2',
    },
  },
  {
    no: 14,
    id: 'NS_PLAYER_AVAILABILITY_FLAGGED',
    gw_phase: 'Not started',
    category: 'Player',
    subcategory: 'Availability',
    title: 'Flagged Players',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dipastikan Absen]
[P:{player}] ([C:{club}]) dipastikan absen akibat {injury_desc} sehingga berdampak bagi [N:{owners_count}] pemiliknya.

[Kondisi: Meragukan]
[P:{player}] ([C:{club}]) diragukan tampil akibat {injury_desc} sehingga menimbulkan tanda tanya bagi [N:{owners_count}] pemiliknya.`,
    example: '',
    code: `const prevDeadline = getPreviousGwDeadline(gw);
const flagged = getFlaggedPlayersUpdatedAfter(prevDeadline, gw);
if (flagged.length === 0) return null;

const top = flagged[0];
const isOut = top.status === 'i' || top.chanceOfPlaying === 0;

return renderTemplate(isOut ? template.out : template.doubtful, {
  owners_count: top.ownersCount,
  player: top.name,
  club: top.club,
  injury_desc: top.injuryDesc,
});`,
    sample_data: {
      owners_count: '12',
      player: 'Manzambi',
      club: 'Aston Villa',
      injury_desc: 'cedera betis',
    },
  },
  {
    no: 15,
    id: 'NS_STANDINGS_TITLE_RACE',
    gw_phase: 'Not started',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Title Race',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Berbeda]
Pemuncak klasemen [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] di peringkat kedua, dengan [T:{team1}] menunjuk [P:{captain1}] sebagai kapten sementara [T:{team2}] memilih [P:{captain2}].

[Kondisi: Kapten Sama]
Pemuncak klasemen [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] dengan keduanya menunjuk [P:{captain}] sebagai kapten, sehingga penentu selisih poin beralih ke [P:{diff_player1}] dan [P:{diff_player2}].

[Kondisi: Duel Chip Berbeda]
[T:{team1}] mengaktifkan [N:{chip1}] sementara [T:{team2}] mengaktifkan [N:{chip2}] dalam persaingan puncak klasemen{margin_clause}.

[Kondisi: Chip Sama]
[T:{team1}] dan [T:{team2}] mengaktifkan [N:{chip}] dalam persaingan puncak klasemen{margin_clause}.

[Kondisi: Manuver Chip]
[T:{team_chip}] mengaktifkan [N:{chip}] untuk {target_clause} [T:{team_rival}] dalam persaingan puncak klasemen.`,
    example: '',
    code: `const standings = getStandings(gw > 1 ? gw - 1 : gw);
if (standings.length < 2) return null;

const leader = standings[0];
const chaser = standings[1];
const margin = Math.abs(leader.totalPoints - chaser.totalPoints);

const chipLeader = getActiveChip(leader.id, gw);
const chipChaser = getActiveChip(chaser.id, gw);
const marginClause = margin === 0
  ? ' dengan poin identik'
  : \` dengan keduanya terpaut [N:\${margin} Poin]\`;

if (chipLeader && chipChaser) {
  if (chipLeader === chipChaser) {
    return renderTemplate(template.same_chip, {
      team1: leader.name,
      team2: chaser.name,
      chip: chipLeader,
      margin_clause: marginClause,
    });
  }
  return renderTemplate(template.dual_chips, {
    team1: leader.name,
    team2: chaser.name,
    chip1: chipLeader,
    chip2: chipChaser,
    margin_clause: marginClause,
  });
}

if (chipLeader || chipChaser) {
  const isLeaderChip = !!chipLeader;
  const chipTeam = isLeaderChip ? leader : chaser;
  const rivalTeam = isLeaderChip ? chaser : leader;
  const chipName = chipLeader || chipChaser;
  const targetClause = margin === 0
    ? 'memecah kebuntuan poin identik melawan'
    : isLeaderChip
      ? \`memperlebar keunggulan [N:\${margin} Poin] atas\`
      : \`memangkas jarak [N:\${margin} Poin] dari\`;
  return renderTemplate(template.chip, {
    team_chip: chipTeam.name,
    chip: chipName,
    target_clause: targetClause,
    team_rival: rivalTeam.name,
  });
}

const capLeader = getTeamCaptain(leader.id, gw);
const capChaser = getTeamCaptain(chaser.id, gw);

if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    team1: leader.name,
    margin,
    team2: chaser.name,
    captain1: capLeader.name,
    captain2: capChaser.name,
  });
}

const diffStarters = getTopDifferingStarters(leader.id, chaser.id, gw);

return renderTemplate(template.same_captain, {
  team1: leader.name,
  margin,
  team2: chaser.name,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      team1: 'Yuk Bisa Yuk FC',
      team2: 'PSIS FC',
      margin: '15',
      captain1: 'Haaland',
      captain2: 'Isak',
      captain: 'Haaland',
      diff_player1: 'Palmer',
      diff_player2: 'Mbeumo',
      chip1: 'Free Hit',
      chip2: 'Wildcard',
      margin_clause: ' dengan keduanya terpaut [N:15 Poin]',
      team_chip: 'PSIS FC',
      chip: 'Free Hit',
      target_clause: 'memangkas jarak [N:15 Poin] dari',
      team_rival: 'Yuk Bisa Yuk FC',
    },
  },
  {
    no: 16,
    id: 'NS_STANDINGS_WEEKLY_WINS_MOST',
    gw_phase: 'Not started',
    category: 'Standings',
    subcategory: 'Weekly Wins',
    title: 'Most GW Wins',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Berbeda]
[T:{team1}] ([N:{titles1}] kali juara) dan [T:{team2}] ([N:{titles2}] kali juara) bersaing memperebutkan status peraih juara Gameweek terbanyak, dengan [T:{team1}] menunjuk [P:{captain1}] sebagai kapten sementara [T:{team2}] memilih [P:{captain2}].

[Kondisi: Kapten Sama]
[T:{team1}] ([N:{titles1}] kali juara) dan [T:{team2}] ([N:{titles2}] kali juara) keduanya menunjuk [P:{captain}] sebagai kapten dalam persaingan juara Gameweek terbanyak, sehingga penentu selisih poin beralih ke [P:{diff_player1}] dan [P:{diff_player2}].

[Kondisi: Duel Chip Berbeda]
[T:{team1}] ([N:{titles1}] kali juara) mengaktifkan [N:{chip1}] sementara [T:{team2}] ([N:{titles2}] kali juara) mengaktifkan [N:{chip2}] dalam persaingan juara Gameweek terbanyak.

[Kondisi: Chip Sama]
[T:{team1}] ([N:{titles1}] kali juara) dan [T:{team2}] ([N:{titles2}] kali juara) mengaktifkan [N:{chip}] dalam persaingan juara Gameweek terbanyak.

[Kondisi: Manuver Chip]
[T:{team_chip}] mengaktifkan [N:{chip}] untuk mengejar status peraih juara Gameweek terbanyak.`,
    example: '',
    code: `// Khusus tampilan news: gelar juara GW dihitung dari GW 1 s.d. GW n-1.
// Peringkat 1 dan 2 klasemen akhir GW n-1 wajib dikecualikan agar tidak bentrok dengan Top Rivalry.
const standingsPrev = getStandings(gw - 1);
const excludedIds = [standingsPrev[0]?.id, standingsPrev[1]?.id];
const leaders = getMostGwChampionsLeaders(gw - 1).filter(t => !excludedIds.includes(t.id));
if (leaders.length < 2) return null;

const leader = leaders[0];
const chaser = leaders[1];

const chipLeader = getActiveChip(leader.id, gw);
const chipChaser = getActiveChip(chaser.id, gw);

if (chipLeader && chipChaser) {
  if (chipLeader === chipChaser) {
    return renderTemplate(template.same_chip, {
      team1: leader.name,
      titles1: leader.titles,
      team2: chaser.name,
      titles2: chaser.titles,
      chip: chipLeader,
    });
  }
  return renderTemplate(template.dual_chips, {
    team1: leader.name,
    titles1: leader.titles,
    team2: chaser.name,
    titles2: chaser.titles,
    chip1: chipLeader,
    chip2: chipChaser,
  });
}

if (chipLeader || chipChaser) {
  const chipTeam = chipLeader ? leader : chaser;
  const chipName = chipLeader || chipChaser;
  return renderTemplate(template.chip, {
    team_chip: chipTeam.name,
    chip: chipName,
  });
}

const capLeader = getTeamCaptain(leader.id, gw);
const capChaser = getTeamCaptain(chaser.id, gw);

if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    team1: leader.name,
    titles1: leader.titles,
    team2: chaser.name,
    titles2: chaser.titles,
    captain1: capLeader.name,
    captain2: capChaser.name,
  });
}

const diffStarters = getTopDifferingStarters(leader.id, chaser.id, gw);

return renderTemplate(template.same_captain, {
  team1: leader.name,
  titles1: leader.titles,
  team2: chaser.name,
  titles2: chaser.titles,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      team1: 'Blackswann',
      team2: 'rdwndvsn',
      titles1: '1',
      titles2: '1',
      captain1: 'Haaland',
      captain2: 'Salah',
      captain: 'Haaland',
      diff_player1: 'Kudus',
      diff_player2: 'Raya',
      chip1: 'Free Hit',
      chip2: 'Wildcard',
      team_chip: 'Blackswann',
      chip: 'Free Hit',
    },
  },
  {
    no: 81,
    id: 'NS_LINEUP_SURPRISE_BENCHED',
    gw_phase: 'Not started',
    category: 'Lineup',
    subcategory: 'Surprise',
    title: 'Surprise Lineup',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dicadangkan]
[C:{club}] mencadangkan [P:{player}] ([N:{starter_pct}%] starter) saat menghadapi [C:{opponent}].

[Kondisi: Absen dari Skuad]
[P:{player}] ([N:{starter_pct}%] starter) tidak masuk daftar skuad [C:{club}] saat menghadapi [C:{opponent}].`,
    example: '',
    code: `// Syarat wajib: lineup resmi terbit (>= 10 starter), pemain 100% fit (status === 'a', chance === null/100), starter_pct >= 15% (atau kapten >= 3 tim), maks 1 pemain per klub per laga.
const popularFit = getFitPopularClubPlayers(gw, { minStarterPct: 15, minCaptainCount: 3 });
const topMissing = popularFit[club]?.find(p => !starters.has(p.id));
if (!topMissing) return null;
const cond = bench.has(topMissing.id) ? template.benched : template.absent;
return renderTemplate(cond, {
  club,
  player: topMissing.web_name,
  starter_pct: topMissing.starterPct,
  opponent,
});`,
    sample_data: {
      club: 'Arsenal',
      player: 'Saka',
      starter_pct: '68',
      opponent: 'Chelsea',
    },
  },

  // =========================================================================
  // FASE LIVE MATCH (PREMIER LEAGUE PULSE API x FPL LEAGUE DATA)
  // Jurnalisme olahraga faktual, objektif, tanpa asumsi dan hiperbola.
  // Setiap nama pemain disertai ([N:{pct}%]) kepemilikan riil di FNB League.
  // Kategori & Sub Kategori 100% selaras dengan Kamus Tipe Kejadian Pertandingan.
  // =========================================================================

  // A. Alur Waktu & Babak (Period Control)
  {
    no: 17,
    id: 'LM_MATCH_PERIOD_START',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Period',
    title: 'Period Start',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kickoff Babak 1]
[N:{minute}] Babak pertama dimulai di [N:{venue}]: [C:{home_club}] vs [C:{away_club}].

[Kondisi: Kickoff Babak 2]
[N:45'] Babak kedua dimulai di [N:{venue}], skor sementara [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `if (event.period === '1') {
  return renderTemplate(template.first_half, {
    minute: "0'",
    home_club: match.homeTeam.name,
    away_club: match.awayTeam.name,
    venue: match.ground.name,
  });
}
return renderTemplate(template.second_half, {
  venue: match.ground.name,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '0\'',
      home_club: 'Nott\'m Forest',
      away_club: 'Man City',
      venue: 'The City Ground',
      home_score: '2',
      away_score: '0',
    },
  },
  {
    no: 18,
    id: 'LM_MATCH_PERIOD_END',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Period',
    title: 'Period End',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Half Time (Dengan Gol)]
[N:{ht_minute}] Jeda babak pertama di [N:{venue}]: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}] — pencetak gol: {goalscorers_list}.

[Kondisi: Half Time (Tanpa Gol)]
[N:{ht_minute}] Jeda babak pertama di [N:{venue}]: [C:{home_club}] [N:0] - [N:0] [C:{away_club}].

[Kondisi: Full Time (Dengan Gol)]
[N:{ft_minute}] Laga usai di [N:{venue}]: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}] — pencetak gol: {goalscorers_list}.

[Kondisi: Full Time (Tanpa Gol)]
[N:{ft_minute}] Laga usai di [N:{venue}]: [C:{home_club}] [N:0] - [N:0] [C:{away_club}].`,
    example: '',
    code: `const scorersStr = formatScorersWithLeaguePct(getMatchScorersUntilEvent(match.id, event));
const hasGoals = (match.teams[0].score + match.teams[1].score) > 0 && Boolean(scorersStr);
if (event.period === '1') {
  return renderTemplate(hasGoals ? template.half_time_goals : template.half_time_zero, {
    ht_minute: event.clock.label || "45+3'",
    venue: match.ground.name,
    home_club: match.homeTeam.name,
    home_score: match.teams[0].score,
    away_score: match.teams[1].score,
    away_club: match.awayTeam.name,
    goalscorers_list: scorersStr,
  });
}
return renderTemplate(hasGoals ? template.full_time_goals : template.full_time_zero, {
  ft_minute: event.clock.label || "90+6'",
  venue: match.ground.name,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
  goalscorers_list: scorersStr,
});`,
    sample_data: {
      ht_minute: '45+3\'',
      ft_minute: '90+6\'',
      venue: 'The City Ground',
      home_club: 'Nott\'m Forest',
      home_score: '3',
      away_score: '1',
      away_club: 'Man City',
      goalscorers_list: '[P:Jair Cunha] ([N:2%]), [P:Delap] ([N:12%], [N:2 Gol]) dan [P:Cherki] ([N:4%])',
    },
  },

  // B. Gol & Poin Serangan (Scoring Events)
  {
    no: 19,
    id: 'LM_MATCH_GOAL_OPEN_PLAY',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Goal',
    title: 'Open Play Goal',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dengan Assist]
[N:{minute}] GOL [C:{club}]! [P:{scorer}] ([N:{scorer_pct}%]) mencetak gol dari assist [P:{assister}] ([N:{assister_pct}%]) — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Tanpa Assist]
[N:{minute}] GOL [C:{club}]! [P:{scorer}] ([N:{scorer_pct}%]) menjebol gawang lawan — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `const scorer = getPlayerFromPulse(event.personId);
const scorerPct = getLeagueOwnershipPct(scorer.id);
const assister = event.assistId ? getPlayerFromPulse(event.assistId) : null;

if (assister) {
  const assisterPct = getLeagueOwnershipPct(assister.id);
  return renderTemplate(template.with_assist, {
    minute: event.clock.label,
    club: event.team.name,
    scorer: scorer.web_name,
    scorer_pct: scorerPct,
    assister: assister.web_name,
    assister_pct: assisterPct,
    home_club: match.homeTeam.name,
    home_score: match.teams[0].score,
    away_score: match.teams[1].score,
    away_club: match.awayTeam.name,
  });
}

return renderTemplate(template.solo, {
  minute: event.clock.label,
  club: event.team.name,
  scorer: scorer.web_name,
  scorer_pct: scorerPct,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '18\'',
      club: 'Nott\'m Forest',
      scorer: 'Delap',
      scorer_pct: '12',
      assister: 'Schlager',
      assister_pct: '1',
      home_club: 'Nott\'m Forest',
      home_score: '2',
      away_score: '0',
      away_club: 'Man City',
    },
  },
  {
    no: 20,
    id: 'LM_MATCH_PENALTY_GOAL',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Goal',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] GOL PENALTI [C:{club}]! [P:{scorer}] ([N:{scorer_pct}%]) menuntaskan eksekusi dari titik putih — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `const scorer = getPlayerFromPulse(event.personId);
const scorerPct = getLeagueOwnershipPct(scorer.id);

return renderTemplate(template, {
  minute: event.clock.label,
  club: event.team.name,
  scorer: scorer.web_name,
  scorer_pct: scorerPct,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '34\'',
      club: 'Man City',
      scorer: 'Haaland',
      scorer_pct: '74',
      home_club: 'Nott\'m Forest',
      home_score: '2',
      away_score: '1',
      away_club: 'Man City',
    },
  },
  {
    no: 21,
    id: 'LM_MATCH_GOAL_OWN',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Goal',
    title: 'Own Goal',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] GOL BUNUH DIRI! [P:{player}] ([N:{player_pct}%]) mencetak gol ke gawang sendiri ([N:-2 Poin]) — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `const player = getPlayerFromPulse(event.personId);
const playerPct = getLeagueOwnershipPct(player.id);

return renderTemplate(template, {
  minute: event.clock.label,
  player: player.web_name,
  player_pct: playerPct,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '41\'',
      player: 'Murillo',
      player_pct: '8',
      home_club: 'Nott\'m Forest',
      home_score: '1',
      away_score: '1',
      away_club: 'Man City',
    },
  },

  // C. Insiden Penalti (Penalty Incidents)
  {
    no: 22,
    id: 'LM_MATCH_PENALTY_MISSED',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Missed',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] PENALTI GAGAL! Eksekusi [P:{taker}] ([N:{taker_pct}%]) untuk [C:{club}] gagal berbuah gol ([N:-2 Poin]).`,
    example: '',
    code: `const taker = getPlayerFromPulse(event.personId);

return renderTemplate(template, {
  minute: event.clock.label,
  taker: taker.web_name,
  taker_pct: getLeagueOwnershipPct(taker.id),
  club: event.team.name,
});`,
    sample_data: {
      minute: '55\'',
      taker: 'Cherki',
      taker_pct: '4',
      club: 'Man City',
    },
  },
  {
    no: 23,
    id: 'LM_MATCH_PENALTY_SAVED',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Saved',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] PENALTI DITEPIS! Kiper [P:{keeper}] ([N:{keeper_pct}%]) meraih [N:+5 Poin] usai menggagalkan penalti [P:{taker}] ([N:{taker_pct}%], [N:-2 Poin]).`,
    example: '',
    code: `const keeper = getPlayerFromPulse(event.keeperId || event.personId);
const taker = getPlayerFromPulse(event.takerId || event.opponentPersonId);

return renderTemplate(template, {
  minute: event.clock.label,
  keeper: keeper.web_name,
  keeper_pct: getLeagueOwnershipPct(keeper.id),
  taker: taker.web_name,
  taker_pct: getLeagueOwnershipPct(taker.id),
});`,
    sample_data: {
      minute: '28\'',
      keeper: 'Sels',
      keeper_pct: '15',
      taker: 'Haaland',
      taker_pct: '74',
    },
  },
  {
    no: 24,
    id: 'LM_MATCH_PENALTY_AWARDED',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Awarded',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Hadiah Penalti]
[N:{minute}] PENALTI untuk [C:{club}] setelah pelanggaran terhadap [P:{fouled_player}] ([N:{fouled_player_pct}%]) di kotak terlarang.

[Kondisi: Hadiah Penalti (Umum)]
[N:{minute}] PENALTI untuk [C:{club}] setelah wasit menunjuk titik putih di kotak terlarang.

[Kondisi: Penalti Dibatalkan]
[N:{minute}] PENALTI DIBATALKAN! Wasit mencabut hadiah penalti untuk [C:{club}].`,
    example: '',
    code: `if (event.isOverturned) {
  return renderTemplate(template.overturned, {
    minute: event.clock.label,
    club: event.team.name,
  });
}
const fouled = event.fouledPersonId ? getPlayerFromPulse(event.fouledPersonId) : null;
if (!fouled?.web_name) {
  return renderTemplate(template.awarded_general, {
    minute: event.clock.label,
    club: event.team.name,
  });
}
return renderTemplate(template.awarded, {
  minute: event.clock.label,
  club: event.team.name,
  fouled_player: fouled.web_name,
  fouled_player_pct: getLeagueOwnershipPct(fouled.id),
});`,
    sample_data: {
      minute: '33\'',
      club: 'Man City',
      fouled_player: 'Doku',
      fouled_player_pct: '18',
    },
  },

  // D. Disiplin & Pelanggaran (Disciplinary Events)
  {
    no: 25,
    id: 'LM_MATCH_CARD_YELLOW',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Card',
    title: 'Yellow Card',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] Kartu kuning untuk [P:{player}] ([N:{player_pct}%]) dari [C:{club}] ([N:-1 Poin]).`,
    example: '',
    code: `const player = getPlayerFromPulse(event.personId);

return renderTemplate(template, {
  minute: event.clock.label,
  club: event.team.name,
  player: player.web_name,
  player_pct: getLeagueOwnershipPct(player.id),
});`,
    sample_data: {
      minute: '64\'',
      club: 'Nott\'m Forest',
      player: 'McAtee',
      player_pct: '2',
    },
  },
  {
    no: 26,
    id: 'LM_MATCH_CARD_SECOND_YELLOW',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Card',
    title: 'Second Yellow',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] KARTU MERAH! [P:{player}] ([C:{club}], [N:{player_pct}%]) menerima kartu kuning kedua dan diusir keluar lapangan ([N:-3 Poin]).`,
    example: '',
    code: `const player = getPlayerFromPulse(event.personId);

return renderTemplate(template, {
  minute: event.clock.label,
  player: player.web_name,
  player_pct: getLeagueOwnershipPct(player.id),
  club: event.team.name,
});`,
    sample_data: {
      minute: '82\'',
      player: 'Yates',
      player_pct: '3',
      club: 'Nott\'m Forest',
    },
  },
  {
    no: 27,
    id: 'LM_MATCH_CARD_STRAIGHT_RED',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Card',
    title: 'Straight Red Card',
    output: 'MULTI-NEWS',
    template: `[N:{minute}] KARTU MERAH LANGSUNG! [P:{player}] ([C:{club}], [N:{player_pct}%]) diusir wasit ([N:-3 Poin]).`,
    example: '',
    code: `const player = getPlayerFromPulse(event.personId);

return renderTemplate(template, {
  minute: event.clock.label,
  player: player.web_name,
  player_pct: getLeagueOwnershipPct(player.id),
  club: event.team.name,
});`,
    sample_data: {
      minute: '71\'',
      player: 'Khusanov',
      player_pct: '1',
      club: 'Man City',
    },
  },

  // E. Taktik & Substitusi (Substitutions)
  {
    no: 28,
    id: 'LM_MATCH_SUBSTITUTION',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Substitution',
    title: 'Substitution',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Pergantian Biasa]
[N:{minute}] Pergantian [C:{club}]: [P:{player_on}] ([N:{player_on_pct}%]) masuk menggantikan [P:{player_off}] ([N:{player_off_pct}%]).

[Kondisi: Pemain Bertahan Keluar Menit >= 60 Saat Belum Kebobolan]
[N:{minute}] Clean sheet aman! [P:{player_off}] ([N:{player_off_pct}%]) ditarik keluar setelah 60+ menit nirbobol bagi [C:{club}], digantikan [P:{player_on}] ([N:{player_on_pct}%]).

[Kondisi: Pemain Bertahan Keluar < 60 Menit]
[N:{minute}] [P:{player_off}] ([N:{player_off_pct}%]) ditarik keluar sebelum menit ke-60 sehingga gagal mengunci clean sheet [C:{club}], digantikan [P:{player_on}] ([N:{player_on_pct}%]).`,
    example: '',
    code: `const pOn = getPlayerFromPulse(event.personIdOn);
const pOff = getPlayerFromPulse(event.personIdOff);
const isDefenderOrGk = ['DEF', 'GKP'].includes(pOff.element_type);
const baseMin = parseInt(String(event.clock.label || '').split('+')[0], 10) || 0;
const offPct = getLeagueOwnershipPct(pOff.id);

if (isDefenderOrGk && baseMin >= 60 && match.concededBeforeSub === 0) {
  return renderTemplate(template.cs_locked, {
    minute: event.clock.label,
    club: event.team.name,
    player_off: pOff.web_name,
    player_off_pct: offPct,
    player_on: pOn.web_name,
    player_on_pct: getLeagueOwnershipPct(pOn.id),
  });
}

if (isDefenderOrGk && baseMin < 60 && match.concededBeforeSub === 0 && offPct >= 10) {
  return renderTemplate(template.cs_missed_early, {
    minute: event.clock.label,
    club: event.team.name,
    player_off: pOff.web_name,
    player_off_pct: offPct,
    player_on: pOn.web_name,
    player_on_pct: getLeagueOwnershipPct(pOn.id),
  });
}

return renderTemplate(template.regular, {
  minute: event.clock.label,
  club: event.team.name,
  player_on: pOn.web_name,
  player_on_pct: getLeagueOwnershipPct(pOn.id),
  player_off: pOff.web_name,
  player_off_pct: offPct,
});`,
    sample_data: {
      minute: '65\'',
      club: 'Nott\'m Forest',
      player_on: 'Ndoye',
      player_on_pct: '3',
      player_off: 'McAtee',
      player_off_pct: '2',
    },
  },

  // F. Intervensi VAR (Video Assistant Referee)
  {
    no: 29,
    id: 'LM_MATCH_VAR_REVIEW',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'VAR',
    title: 'VAR Review',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Gol Dibatalkan]
[N:{minute}] VAR ANULIR GOL! Gol [P:{player}] ([N:{player_pct}%]) untuk [C:{club}] dibatalkan ({reason}) — skor tetap [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Gol Dibatalkan (Tanpa Nama Pemain)]
[N:{minute}] VAR ANULIR GOL! Gol [C:{club}] dibatalkan ({reason}) — skor tetap [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Gol Dinyatakan Sah]
[N:{minute}] VAR SAHKAN GOL! Gol [P:{player}] ([N:{player_pct}%]) untuk [C:{club}] dinyatakan sah — skor [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Gol Dinyatakan Sah (Tanpa Nama Pemain)]
[N:{minute}] VAR SAHKAN GOL! Gol [C:{club}] dinyatakan sah — skor [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Penalti Diberikan]
[N:{minute}] VAR BERI PENALTI! [C:{club}] mendapat hadiah penalti usai tinjauan insiden di kotak terlarang.

[Kondisi: Penalti Dibatalkan]
[N:{minute}] VAR BATALKAN PENALTI! Hadiah penalti untuk [C:{club}] dicabut.

[Kondisi: Kartu Merah Diberikan]
[N:{minute}] VAR KARTU MERAH! Wasit mengusir [P:{player}] ([C:{club}], [N:{player_pct}%]) setelah tinjauan pelanggaran serius ([N:-3 Poin]).

[Kondisi: Kartu Merah Diberikan (Tanpa Nama Pemain)]
[N:{minute}] VAR KARTU MERAH! Pemain [C:{club}] diusir wasit setelah tinjauan pelanggaran serius ([N:-3 Poin]).

[Kondisi: Kartu Merah Dibatalkan]
[N:{minute}] VAR BATALKAN KARTU MERAH! Hukuman kartu merah [P:{player}] ([C:{club}], [N:{player_pct}%]) dicabut.

[Kondisi: Kartu Merah Dibatalkan (Tanpa Nama Pemain)]
[N:{minute}] VAR BATALKAN KARTU MERAH! Hukuman kartu merah pemain [C:{club}] dicabut.`,
    example: '',
    code: `const player = event.personId ? getPlayerFromPulse(event.personId) : null;
const playerPct = player ? getLeagueOwnershipPct(player.id) : 0;

switch (event.subType) {
  case 'GOAL_DISALLOWED':
    return renderTemplate(template.goal_disallowed, {
      minute: event.clock.label,
      player: player?.web_name,
      player_pct: playerPct,
      club: event.team.name,
      reason: event.reason || 'offside',
      home_club: match.homeTeam.name,
      home_score: match.teams[0].score,
      away_score: match.teams[1].score,
      away_club: match.awayTeam.name,
    });
  case 'GOAL_AWARDED':
    return renderTemplate(template.goal_awarded, {
      minute: event.clock.label,
      player: player?.web_name,
      player_pct: playerPct,
      club: event.team.name,
      home_club: match.homeTeam.name,
      home_score: match.teams[0].score,
      away_score: match.teams[1].score,
      away_club: match.awayTeam.name,
    });
  case 'PENALTY_AWARDED':
    return renderTemplate(template.penalty_awarded, {
      minute: event.clock.label,
      club: event.team.name,
    });
  case 'PENALTY_CANCELLED':
    return renderTemplate(template.penalty_cancelled, {
      minute: event.clock.label,
      club: event.team.name,
    });
  case 'RED_CARD_GIVEN':
    return renderTemplate(template.red_card_given, {
      minute: event.clock.label,
      player: player?.web_name,
      player_pct: playerPct,
      club: event.team.name,
    });
  case 'RED_CARD_OVERTURNED':
    return renderTemplate(template.red_card_overturned, {
      minute: event.clock.label,
      player: player?.web_name,
      player_pct: playerPct,
      club: event.team.name,
    });
  default:
    return null;
}`,
    sample_data: {
      minute: '38\'',
      player: 'Haaland',
      player_pct: '74',
      club: 'Man City',
      reason: 'offside',
      home_club: 'Nott\'m Forest',
      home_score: '2',
      away_score: '0',
      away_club: 'Man City',
    },
  },

  // G. Statistik Live FPL (Goalkeeper Saves & Defensive Contribution)
  {
    no: 30,
    id: 'LM_MATCH_SAVES_GOALKEEPER',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Saves',
    title: 'Goalkeeper Saves',
    output: 'MULTI-NEWS',
    template: `Kiper [P:{player}] ([N:{player_pct}%]) membukukan [N:{saves} Penyelamatan] untuk [C:{club}] melawan [C:{opponent}] dan mengantongi [N:+{saves_pts} Poin].`,
    example: '',
    code: `const gkPlayers = getLivePlayersByPosition(match, 'GKP').filter(p => p.stats.saves >= 3);
return gkPlayers.map(gk => renderTemplate(template, {
  club: gk.clubName,
  player: gk.web_name,
  player_pct: getLeagueOwnershipPct(gk.id),
  saves: gk.stats.saves,
  saves_pts: Math.floor(gk.stats.saves / 3),
  opponent: gk.opponentClubName,
}));`,
    sample_data: {
      club: 'Everton',
      player: 'Pickford',
      player_pct: '12',
      saves: '6',
      saves_pts: '2',
      opponent: 'Arsenal',
    },
  },
  {
    no: 31,
    id: 'LM_MATCH_DEFENSIVE_CONTRIBUTION',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Defensive',
    title: 'Defensive Contribution',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{player_pct}%]) mencatat [N:{dc_count} Aksi Defensif] untuk [C:{club}] melawan [C:{opponent}] dan mengamankan [N:+2 Poin] Defensive Contribution.`,
    example: '',
    code: `const defConPlayers = getLivePlayers(match).filter(p => {
  const dc = p.stats.defensive_contribution || 0;
  return (p.position === 'DEF' && dc >= 10) || ((p.position === 'MID' || p.position === 'FWD') && dc >= 12);
});
return defConPlayers.map(p => renderTemplate(template, {
  player: p.web_name,
  player_pct: getLeagueOwnershipPct(p.id),
  dc_count: p.stats.defensive_contribution,
  club: p.clubName,
  opponent: p.opponentClubName,
}));`,
    sample_data: {
      player: 'Branthwaite',
      player_pct: '8',
      dc_count: '11',
      club: 'Everton',
      opponent: 'Bournemouth',
    },
  },
  {
    no: 32,
    id: 'LM_STANDINGS_RANK_MOVEMENT',
    gw_phase: 'Live Match',
    category: 'Standings',
    subcategory: 'Rank',
    title: 'Rank Movement',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Merebut Puncak Klasemen]
[T:{team}] merebut puncak klasemen sementara usai naik [N:+{rank_diff} Peringkat] ke peringkat [N:1] berkat [N:{gw_pts} Poin].

[Kondisi: Naik Peringkat]
[T:{team}] naik [N:+{rank_diff} Peringkat] dari [N:{old_rank}] ke [N:{new_rank}] klasemen sementara berkat [N:{gw_pts} Poin].

[Kondisi: Turun Peringkat]
[T:{team}] turun [N:-{rank_diff} Peringkat] dari [N:{old_rank}] ke [N:{new_rank}] klasemen sementara dengan [N:{gw_pts} Poin].

[Kondisi: Bertahan Peringkat]
[T:{team}] bertahan di peringkat [N:{new_rank}] klasemen sementara dengan [N:{gw_pts} Poin].`,
    example: '',
    code: `const rankChange = team.rank_change || 0;
const vars = {
  team: team.entry_name,
  gw_pts: team.event_points,
  gw,
  rank_diff: Math.abs(rankChange),
  old_rank: team.last_rank || team.rank,
  new_rank: team.rank,
  total_pts: team.total_points,
};
if (team.rank === 1 && rankChange > 0) return renderTemplate(template.take_lead, vars);
if (rankChange > 0) return renderTemplate(template.up, vars);
if (rankChange < 0) return renderTemplate(template.down, vars);
return renderTemplate(template.hold, vars);`,
    sample_data: {
      team: 'Garuda FC',
      gw_pts: '48',
      gw: '10',
      rank_diff: '5',
      old_rank: '11',
      new_rank: '6',
      total_pts: '618',
    },
  },
  {
    no: 33,
    id: 'LM_MATCH_SCORE_LIVE',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Score',
    title: 'Live Score',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Skor 0-0 Berjalan]
Live menit [N:{minute}]: [C:{home_club}] [N:0] - [N:0] [C:{away_club}] masih imbang tanpa gol.

[Kondisi: Dengan Gol Berjalan]
Live menit [N:{minute}]: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}] — pencetak gol: {scorers_list}.

[Kondisi: Dengan Gol Berjalan (Tanpa Pencetak)]
Live menit [N:{minute}]: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Skor 0-0 Half Time]
Half Time: [C:{home_club}] [N:0] - [N:0] [C:{away_club}] masih imbang tanpa gol.

[Kondisi: Dengan Gol Half Time]
Half Time: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}] — pencetak gol: {scorers_list}.

[Kondisi: Dengan Gol Half Time (Tanpa Pencetak)]
Half Time: [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `const scorersList = formatLiveMatchScorers(match);
const totalGoals = (match.team_h_score ?? 0) + (match.team_a_score ?? 0);
const vars = {
  home_club: match.home_team.name,
  away_club: match.away_team.name,
  minute: match.clock_label || \`\${match.minutes}'\`,
  home_score: match.team_h_score ?? 0,
  away_score: match.team_a_score ?? 0,
  scorers_list: scorersList,
};
if (match.is_half_time) {
  if (totalGoals === 0) return renderTemplate(template.ht_zero, vars);
  return renderTemplate(scorersList ? template.ht_goals : template.ht_goals_plain, vars);
}
if (totalGoals === 0) return renderTemplate(template.live_zero, vars);
return renderTemplate(scorersList ? template.live_goals : template.live_goals_plain, vars);`,
    sample_data: {
      home_club: 'Arsenal',
      away_club: 'Chelsea',
      minute: '74\'',
      home_score: '2',
      away_score: '1',
      scorers_list: '[P:Saka] ([N:68%], [N:2 Gol]) dan [P:Palmer] ([N:45%])',
    },
  },
  {
    no: 80,
    id: 'LM_MATCH_GOAL_MILESTONE',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Goal',
    title: 'Goal Milestone',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Brace (2 Gol)]
[N:{minute}] BRACE! [P:{scorer}] ([N:{scorer_pct}%]) mencetak gol keduanya bagi [C:{club}]{assist_clause} — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Hat-trick (3+ Gol)]
[N:{minute}] HAT-TRICK! [P:{scorer}] ([N:{scorer_pct}%]) membukukan [N:{goals_count} Gol] bagi [C:{club}]{assist_clause} — [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `const goalsCount = getScorerGoalCountInMatch(match, scorer.id);
if (goalsCount < 2) return null;
const cond = goalsCount >= 3 ? template.hattrick : template.brace;
return renderTemplate(cond, {
  minute: event.clock.label,
  club: event.team.name,
  scorer: scorer.web_name,
  scorer_pct: scorerPct,
  goals_count: goalsCount,
  assist_clause: assistClause,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '68\'',
      club: 'Nott\'m Forest',
      scorer: 'Delap',
      scorer_pct: '12',
      goals_count: '3',
      assist_clause: ' dari assist [P:Schlager] ([N:2%])',
      home_club: 'Nott\'m Forest',
      home_score: '3',
      away_score: '1',
      away_club: 'Man City',
    },
  },
  {
    no: 83,
    id: 'LM_LINEUP_SURPRISE_BENCHED',
    gw_phase: 'Live Match',
    category: 'Lineup',
    subcategory: 'Surprise',
    title: 'Surprise Lineup',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dicadangkan]
[N:0'] [C:{club}] mencadangkan [P:{player}] ([N:{starter_pct}%] starter) saat menghadapi [C:{opponent}].

[Kondisi: Absen dari Skuad]
[N:0'] [P:{player}] ([N:{starter_pct}%] starter) tidak masuk daftar skuad [C:{club}] saat menghadapi [C:{opponent}].`,
    example: '',
    code: `// Syarat wajib: lineup resmi terbit (>= 10 starter), pemain 100% fit (status === 'a', chance === null/100), starter_pct >= 15% (atau kapten >= 3 tim), maks 1 pemain per klub per laga.
const popularFit = getFitPopularClubPlayers(gw, { minStarterPct: 15, minCaptainCount: 3 });
const topMissing = popularFit[club]?.find(p => !starters.has(p.id));
if (!topMissing) return null;
const cond = bench.has(topMissing.id) ? template.benched : template.absent;
return renderTemplate(cond, {
  club,
  player: topMissing.web_name,
  starter_pct: topMissing.starterPct,
  opponent,
});`,
    sample_data: {
      club: 'Arsenal',
      player: 'Saka',
      starter_pct: '68',
      opponent: 'Chelsea',
    },
  },
  {
    no: 84,
    id: 'LM_MATCH_CLEAN_SHEET_LOST',
    gw_phase: 'Live Match',
    category: 'Match',
    subcategory: 'Clean Sheet',
    title: 'Clean Sheet Lost',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Clean Sheet Hilang]
[N:{minute}] [C:{club}] gagal menjaga nirbobol melawan [C:{scoring_club}] — [P:{defender}] ([N:{defender_pct}%]) kehilangan potensi [N:+4 Poin].

[Kondisi: Penalti Kebobolan]
[N:{minute}] Kebobolan ke-[N:{gc_count}] [C:{club}] melawan [C:{scoring_club}] membuat [P:{defender}] ([N:{defender_pct}%]) terkena [N:-1 Poin].`,
    example: '',
    code: `// Pilih 1 bek/kiper aktif di lapangan (atau terkena kartu merah) dengan starter_pct >= 15% tertinggi di klub yang kebobolan.
const topDef = getTopActiveDefender(concedingClub, onPitchIds, { minStarterPct: 15 });
if (!topDef) return null;
if (goalsConceded === 1) {
  return renderTemplate(template.cs_lost, {
    minute: event.clock.label,
    club: concedingClub,
    scoring_club: scoringClub,
    defender: topDef.web_name,
    defender_pct: topDef.ownershipPct,
  });
}
if (goalsConceded >= 2 && goalsConceded % 2 === 0) {
  return renderTemplate(template.gc_penalty, {
    minute: event.clock.label,
    club: concedingClub,
    gc_count: goalsConceded,
    scoring_club: scoringClub,
    defender: topDef.web_name,
    defender_pct: topDef.ownershipPct,
  });
}`,
    sample_data: {
      minute: '6\'',
      club: 'Man City',
      scoring_club: 'Nott\'m Forest',
      defender: 'Gvardiol',
      defender_pct: '22',
      gc_count: '2',
    },
  },
  {
    no: 104,
    id: 'LM_STANDINGS_TITLE_RACE',
    gw_phase: 'Live Match',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Title Race',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Berbeda]
Pemuncak klasemen sementara [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] di peringkat kedua, dengan [T:{team1}] menunjuk [P:{captain1}] sebagai kapten sementara [T:{team2}] memilih [P:{captain2}].

[Kondisi: Kapten Sama]
Pemuncak klasemen sementara [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] dengan keduanya menunjuk [P:{captain}] sebagai kapten, sehingga penentu selisih poin sementara beralih ke [P:{diff_player1}] dan [P:{diff_player2}].

[Kondisi: Duel Chip Berbeda]
[T:{team1}] mengaktifkan [N:{chip1}] sementara [T:{team2}] mengaktifkan [N:{chip2}] dalam persaingan puncak klasemen sementara{margin_clause}.

[Kondisi: Chip Sama]
[T:{team1}] dan [T:{team2}] mengaktifkan [N:{chip}] dalam persaingan puncak klasemen sementara{margin_clause}.

[Kondisi: Manuver Chip]
[T:{team_chip}] mengaktifkan [N:{chip}] untuk {target_clause} [T:{team_rival}] dalam persaingan puncak klasemen sementara.

[Kondisi: Poin Sama]
[T:{team1}] dan [T:{team2}] mengoleksi poin sementara identik di dua teratas klasemen.`,
    example: '',
    code: `// Sorot duel peringkat 1 vs 2 klasemen sementara selama ada laga Live Match berlangsung.
const margin = Math.abs(rank1.total_points - rank2.total_points);
const marginClause = margin === 0 ? ' dengan poin identik' : \` dengan keduanya terpaut [N:\${margin} Poin]\`;
if (chipLeader && chipChaser) {
  if (chipLeader === chipChaser) {
    return renderTemplate(template.same_chip, {
      team1: rank1.name,
      team2: rank2.name,
      chip: chipLeader,
      margin_clause: marginClause,
    });
  }
  return renderTemplate(template.dual_chips, {
    team1: rank1.name,
    team2: rank2.name,
    chip1: chipLeader,
    chip2: chipChaser,
    margin_clause: marginClause,
  });
}
if (chipLeader || chipChaser) {
  const isLeaderChip = !!chipLeader;
  const chipTeam = isLeaderChip ? rank1 : rank2;
  const rivalTeam = isLeaderChip ? rank2 : rank1;
  const chipName = chipLeader || chipChaser;
  const targetClause = margin === 0
    ? 'memecah kebuntuan poin identik melawan'
    : isLeaderChip
      ? \`memperlebar keunggulan [N:\${margin} Poin] atas\`
      : \`memangkas jarak [N:\${margin} Poin] dari\`;
  return renderTemplate(template.chip, {
    team_chip: chipTeam.name,
    chip: chipName,
    target_clause: targetClause,
    team_rival: rivalTeam.name,
  });
}
if (margin === 0) {
  return renderTemplate(template.tied, {
    team1: rank1.name,
    team2: rank2.name,
  });
}
if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    team1: rank1.name,
    margin,
    team2: rank2.name,
    captain1: capLeader.name,
    captain2: capChaser.name,
  });
}
const diffStarters = getTopDifferingStarters(rank1.id, rank2.id);
return renderTemplate(template.same_captain, {
  team1: rank1.name,
  margin,
  team2: rank2.name,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      team1: 'Sunda Kelapa',
      margin: '4',
      team2: 'Bintang Timur',
      captain1: 'Haaland',
      captain2: 'Isak',
      captain: 'Haaland',
      diff_player1: 'Palmer',
      diff_player2: 'Mbeumo',
      chip1: 'Free Hit',
      chip2: 'Wildcard',
      chip: 'Free Hit',
      margin_clause: ' dengan keduanya terpaut [N:4 Poin]',
      team_chip: 'Bintang Timur',
      target_clause: 'memangkas jarak [N:4 Poin] dari',
      team_rival: 'Sunda Kelapa',
    },
  },
  {
    no: 105,
    id: 'LM_CAPTAIN_POPULAR_LIVE',
    gw_phase: 'Live Match',
    category: 'Captain',
    subcategory: 'Popular',
    title: 'Live Captain Action',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Cetak Gol]
[N:{minute}] Kapten populer [P:{captain}] (dipilih [N:{count}] tim) mencetak gol bagi [C:{club}] — sudah membukukan [N:{pts} Poin] bagi pemilihnya.

[Kondisi: Assist]
[N:{minute}] Kapten populer [P:{captain}] (dipilih [N:{count}] tim) mencatat assist bagi [C:{club}] — kini mengoleksi [N:{pts} Poin] bagi pemilihnya.

[Kondisi: Penalti Gagal]
[N:{minute}] Kapten populer [P:{captain}] (dipilih [N:{count}] tim) gagal menuntaskan penalti untuk [C:{club}] dan terkena penalti kapten ([N:-4 Poin]).

[Kondisi: Kartu Merah]
[N:{minute}] Kapten populer [P:{captain}] (dipilih [N:{count}] tim) menerima kartu merah untuk [C:{club}] dan terkena penalti kapten ([N:-6 Poin]).`,
    example: '',
    code: `// Terpicu saat pemain yang dikapteni >= 5 tim (atau 3 kapten terpopuler liga dengan >= 3 pemilih) mencetak gol, assist, gagal penalti, atau kartu merah pada laga berjalan.
if (!isPopularCaptain(player.id, gw)) return null;
return renderTemplate(cond, {
  minute: event.clock.label,
  captain: player.web_name,
  count: player.captainCount,
  club: event.team.name,
  pts: livePlayerPoints * 2,
});`,
    sample_data: {
      minute: '23\'',
      captain: 'Haaland',
      count: '42',
      club: 'Man City',
      pts: '14',
    },
  },

  // ============================================================================
  // FASE 3: BETWEEN MATCH TEMPLATES (Jeda Antar-Laga / Interval)
  // ============================================================================
  {
    no: 34,
    id: 'BM_MATCH_SCORE_RESULT',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Score',
    title: 'Match Result',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kemenangan]
Hasil akhir di [N:{venue}]: [C:{winning_club}] menundukkan [C:{losing_club}] [N:{winning_score}] - [N:{losing_score}] — pencetak gol: {goalscorers_list}.

[Kondisi: Imbang (Dengan Gol)]
Hasil akhir di [N:{venue}]: [C:{home_club}] dan [C:{away_club}] berbagi poin [N:{home_score}] - [N:{away_score}] — pencetak gol: {goalscorers_list}.

[Kondisi: Imbang (Tanpa Gol)]
Hasil akhir di [N:{venue}]: [C:{home_club}] dan [C:{away_club}] bermain imbang [N:0] - [N:0].`,
    example: '',
    code: `if (match.home_score === match.away_score) {
  const isZero = match.home_score === 0 && match.away_score === 0;
  return renderTemplate(isZero ? template.draw_zero : template.draw_goals, {
    venue: match.ground,
    home_club: match.home_club,
    away_club: match.away_club,
    home_score: match.home_score,
    away_score: match.away_score,
    goalscorers_list: formatScorers(match.scorers),
  });
}
return renderTemplate(template.win, {
  venue: match.ground,
  winning_club: match.winner,
  losing_club: match.loser,
  winning_score: Math.max(match.home_score, match.away_score),
  losing_score: Math.min(match.home_score, match.away_score),
  goalscorers_list: formatScorers(match.scorers),
});`,
    sample_data: {
      venue: 'The City Ground',
      winning_club: 'Nott\'m Forest',
      losing_club: 'Man City',
      winning_score: '3',
      losing_score: '1',
      home_club: 'Nott\'m Forest',
      away_club: 'Man City',
      home_score: '1',
      away_score: '1',
      goalscorers_list: '[P:Jair Cunha] ([N:2%]) dan [P:Delap] ([N:12%], [N:2 Gol])',
    },
  },
  {
    no: 35,
    id: 'BM_MATCH_FIXTURE_NEXT',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Fixture',
    title: 'Next Fixture',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Jeda Pendek - 1 Laga]
Gameweek [N:{gw}] berlanjut lewat pertandingan antara [C:{home_club}] dan [C:{away_club}] pada pukul [N:{kickoff_time}].

[Kondisi: Jeda Pendek - Multi Laga]
Gameweek [N:{gw}] berlanjut lewat [N:{count}] pertandingan serentak pada pukul [N:{kickoff_time}]: {matches_list}.

[Kondisi: Jeda Panjang - 1 Laga]
Gameweek [N:{gw}] berlanjut hari {wib_day} lewat pertandingan antara [C:{home_club}] dan [C:{away_club}] pada pukul [N:{kickoff_time}].

[Kondisi: Jeda Panjang - Multi Laga]
Gameweek [N:{gw}] berlanjut hari {wib_day} lewat [N:{count}] pertandingan serentak pada pukul [N:{kickoff_time}]: {matches_list}.`,
    example: '',
    code: `const isShortBreak = nextFixture.dateUK === lastFinishedMatch.dateUK;
if (fixtures.length === 1) {
  const f = fixtures[0];
  return renderTemplate(isShortBreak ? template.short_single : template.long_single, {
    gw,
    wib_day: f.wibDay,
    kickoff_time: f.kickoffWIB,
    home_club: f.homeClub,
    away_club: f.awayClub,
  });
}
return renderTemplate(isShortBreak ? template.short_multi : template.long_multi, {
  gw,
  wib_day: fixtures[0].wibDay,
  count: fixtures.length,
  kickoff_time: fixtures[0].kickoffWIB,
  matches_list: formatMatches(fixtures),
});`,
    sample_data: {
      gw: '10',
      wib_day: 'Minggu',
      kickoff_time: '21:00 WIB',
      home_club: 'Arsenal',
      away_club: 'Chelsea',
      count: '2',
      matches_list: '[C:Arsenal] vs [C:Chelsea] dan [C:Liverpool] vs [C:Aston Villa]',
    },
  },
  {
    no: 36,
    id: 'BM_MATCH_CLEAN_SHEET',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Clean Sheet',
    title: 'Clean Sheet',
    output: 'MULTI-NEWS',
    template: `[C:{club}] mengamankan clean sheet melawan [C:{opponent}], menghadirkan [N:+4 Poin] bagi [P:{defender}] ([N:{ownership_pct}%]).`,
    example: '',
    code: `return renderTemplate(template, {
  club: team.name,
  opponent: opponent.name,
  defender: player.web_name,
  ownership_pct: getLeagueOwnershipPct(player.id),
});`,
    sample_data: {
      club: 'Arsenal',
      opponent: 'Chelsea',
      defender: 'Saliba',
      ownership_pct: '42',
    },
  },
  {
    no: 37,
    id: 'BM_MATCH_GOAL_CONTRIBUTORS',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Goal',
    title: 'Goal Contributors',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Gol & Assist]
[P:{scorer}] ([N:{scorer_pct}%]) mencetak gol bagi [C:{club}] dari assist [P:{assister}] ([N:{assister_pct}%]) melawan [C:{opponent}].

[Kondisi: Multi Gol]
[P:{scorer}] ([N:{scorer_pct}%]) memborong [N:{goals_count} Gol] saat [C:{club}] menghadapi [C:{opponent}].`,
    example: '',
    code: `if (scorer.goals > 1) {
  return renderTemplate(template.multi_goals, {
    scorer: scorer.web_name,
    scorer_pct: getLeagueOwnershipPct(scorer.id),
    goals_count: scorer.goals,
    club: match.team.name,
    opponent: match.opponent.name,
  });
}
return renderTemplate(template.goal_assist, {
  scorer: scorer.web_name,
  scorer_pct: getLeagueOwnershipPct(scorer.id),
  assister: assister.web_name,
  assister_pct: getLeagueOwnershipPct(assister.id),
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      club: 'Nott\'m Forest',
      opponent: 'Man City',
      scorer: 'Delap',
      scorer_pct: '12',
      assister: 'Schlager',
      assister_pct: '1',
      goals_count: '2',
    },
  },
  {
    no: 38,
    id: 'BM_MATCH_BONUS_POINTS',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Bonus',
    title: 'Bonus Points',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{ownership_pct}%]) memuncaki BPS ([N:{bps} BPS]) dan mengoleksi [N:{points} Poin] saat [C:{club}] menghadapi [C:{opponent}].`,
    example: '',
    code: `return renderTemplate(template, {
  player: topBpsPlayer.web_name,
  ownership_pct: getLeagueOwnershipPct(topBpsPlayer.id),
  bps: topBpsPlayer.bps,
  points: topBpsPlayer.total_points,
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      player: 'Palmer',
      ownership_pct: '64',
      bps: '42',
      points: '14',
      club: 'Chelsea',
      opponent: 'Arsenal',
    },
  },
  {
    no: 39,
    id: 'BM_MATCH_PENALTY_SAVED',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Saved',
    output: 'MULTI-NEWS',
    template: `Kiper [P:{gk_name}] ([N:{gk_pct}%]) meraih [N:+5 Poin] usai menepis penalti [P:{taker_name}] ([N:{taker_pct}%]) pada laga [C:{club}] vs [C:{opponent}].`,
    example: '',
    code: `return renderTemplate(template, {
  gk_name: gk.web_name,
  gk_pct: getLeagueOwnershipPct(gk.id),
  taker_name: taker.web_name,
  taker_pct: getLeagueOwnershipPct(taker.id),
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      gk_name: 'Sels',
      gk_pct: '15',
      taker_name: 'Haaland',
      taker_pct: '74',
      club: 'Nott\'m Forest',
      opponent: 'Man City',
    },
  },
  {
    no: 40,
    id: 'BM_MATCH_PENALTY_MISSED',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Penalty',
    title: 'Penalty Missed',
    output: 'MULTI-NEWS',
    template: `[P:{taker_name}] ([N:{taker_pct}%]) gagal menuntaskan penalti pada laga [C:{club}] vs [C:{opponent}] dan terkena [N:-2 Poin].`,
    example: '',
    code: `return renderTemplate(template, {
  taker_name: taker.web_name,
  taker_pct: getLeagueOwnershipPct(taker.id),
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      taker_name: 'Cherki',
      taker_pct: '4',
      club: 'Man City',
      opponent: 'Nott\'m Forest',
    },
  },
  {
    no: 41,
    id: 'BM_MATCH_CARD_RED',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Card',
    title: 'Red Card',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{player_pct}%]) menerima kartu merah pada laga [C:{club}] vs [C:{opponent}] dan terkena [N:-3 Poin].`,
    example: '',
    code: `return renderTemplate(template, {
  player: player.web_name,
  player_pct: getLeagueOwnershipPct(player.id),
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      player: 'Khusanov',
      player_pct: '1',
      club: 'Man City',
      opponent: 'Nott\'m Forest',
    },
  },
  {
    no: 42,
    id: 'BM_MATCH_INJURY',
    gw_phase: 'Between Match',
    category: 'Match',
    subcategory: 'Injury',
    title: 'Match Injury',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{ownership_pct}%]) ditarik keluar pada menit ke-[N:{minute}] akibat cedera saat [C:{club}] menghadapi [C:{opponent}].`,
    example: '',
    code: `return renderTemplate(template, {
  player: injuredPlayer.web_name,
  ownership_pct: getLeagueOwnershipPct(injuredPlayer.id),
  minute: injuredPlayer.offMinute,
  club: match.team.name,
  opponent: match.opponent.name,
});`,
    sample_data: {
      player: 'Saka',
      ownership_pct: '68',
      minute: '65',
      club: 'Arsenal',
      opponent: 'Chelsea',
    },
  },
  {
    no: 43,
    id: 'BM_CAPTAIN_POPULAR_RETURN',
    gw_phase: 'Between Match',
    category: 'Captain',
    subcategory: 'Popular',
    title: 'Captain Return',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Jeda Pendek - Sudah Main]
[P:{captain}], kapten terpopuler yang dipilih [N:{count}] tim, membukukan [N:{pts} Poin] sebelum laga berikutnya dimulai pada pukul [N:{kickoff_time}].

[Kondisi: Jeda Panjang - Sudah Main]
[P:{captain}], kapten terpopuler yang dipilih [N:{count}] tim, membukukan [N:{pts} Poin] sebelum Gameweek [N:{gw}] berlanjut hari {wib_day} pada pukul [N:{kickoff_time}].

[Kondisi: Jeda Pendek - Belum Main]
[P:{captain}], kapten terpopuler yang dipilih [N:{count}] tim, bersiap membela [C:{club}] melawan [C:{opponent}] pada pukul [N:{kickoff_time}].

[Kondisi: Jeda Panjang - Belum Main]
[P:{captain}], kapten terpopuler yang dipilih [N:{count}] tim, bersiap membela [C:{club}] melawan [C:{opponent}] pada hari {wib_day} pukul [N:{kickoff_time}].`,
    example: '',
    code: `const targetFixture = hasCaptainPlayed ? nextFixture : captainUpcomingFixture;
const isShortBreak = targetFixture.dateUK === lastFinishedMatch.dateUK;
const cond = hasCaptainPlayed
  ? (isShortBreak ? 'Jeda Pendek - Sudah Main' : 'Jeda Panjang - Sudah Main')
  : (isShortBreak ? 'Jeda Pendek - Belum Main' : 'Jeda Panjang - Belum Main');
return renderTemplate(template[cond], {
  captain: dominantCaptain.web_name,
  count: dominantCaptain.pickers_count,
  pts: dominantCaptain.points * 2,
  gw,
  wib_day: targetFixture.wibDay,
  kickoff_time: targetFixture.kickoffWIB,
  club: dominantCaptain.club,
  opponent: dominantCaptain.opponent,
});`,
    sample_data: {
      captain: 'Haaland',
      count: '10',
      pts: '26',
      kickoff_time: '23:30 WIB',
      gw: '10',
      wib_day: 'Minggu',
      club: 'Man City',
      opponent: 'Arsenal',
    },
  },
  {
    no: 44,
    id: 'BM_LINEUP_BENCH_POINTS',
    gw_phase: 'Between Match',
    category: 'Lineup',
    subcategory: 'Bench',
    title: 'Points on Bench',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mencadangkan [P:{player}] yang mendulang [N:{bench_pts} Poin] pada laga yang baru berakhir.`,
    example: '',
    code: `return renderTemplate(template, {
  team: regretManager.name,
  player: benchedPlayer.web_name,
  bench_pts: benchedPlayer.points,
});`,
    sample_data: {
      team: 'Garuda FC',
      player: 'Delap',
      bench_pts: '12',
    },
  },
  {
    no: 45,
    id: 'BM_LINEUP_AUTOSUB_ALERT',
    gw_phase: 'Between Match',
    category: 'Lineup',
    subcategory: 'Autosub',
    title: 'Autosub Alert',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menanti autosub setelah starter [P:{player_dnp}] ([C:{club}]) absen bermain (0 menit).`,
    example: '',
    code: `return renderTemplate(template, {
  player_dnp: dnpPlayer.web_name,
  club: dnpPlayer.club,
  team: manager.name,
});`,
    sample_data: {
      player_dnp: 'Foden',
      club: 'Man City',
      team: 'Sunda Kelapa',
    },
  },
  {
    no: 46,
    id: 'BM_STANDINGS_TITLE_RACE',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Title Race',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Berbeda]
Pemuncak klasemen sementara [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] di peringkat kedua, dengan [T:{team1}] menunjuk [P:{captain1}] sebagai kapten sementara [T:{team2}] memilih [P:{captain2}].

[Kondisi: Kapten Sama]
Pemuncak klasemen sementara [T:{team1}] unggul [N:{margin} Poin] atas [T:{team2}] dengan keduanya menunjuk [P:{captain}] sebagai kapten, sehingga penentu selisih poin sementara beralih ke [P:{diff_player1}] dan [P:{diff_player2}].

[Kondisi: Duel Chip Berbeda]
[T:{team1}] mengaktifkan [N:{chip1}] sementara [T:{team2}] mengaktifkan [N:{chip2}] dalam persaingan puncak klasemen sementara{margin_clause}.

[Kondisi: Chip Sama]
[T:{team1}] dan [T:{team2}] mengaktifkan [N:{chip}] dalam persaingan puncak klasemen sementara{margin_clause}.

[Kondisi: Manuver Chip]
[T:{team_chip}] mengaktifkan [N:{chip}] untuk {target_clause} [T:{team_rival}] dalam persaingan puncak klasemen sementara.

[Kondisi: Poin Sama]
[T:{team1}] dan [T:{team2}] mengoleksi poin sementara identik di dua teratas klasemen.`,
    example: '',
    code: `const margin = Math.abs(rank1.total_points - rank2.total_points);
const chipLeader = getActiveChip(rank1.id, gw);
const chipChaser = getActiveChip(rank2.id, gw);
const marginClause = margin === 0
  ? ' dengan poin identik'
  : \` dengan keduanya terpaut [N:\${margin} Poin]\`;

if (chipLeader && chipChaser) {
  if (chipLeader === chipChaser) {
    return renderTemplate(template.same_chip, {
      team1: rank1.name,
      team2: rank2.name,
      chip: chipLeader,
      margin_clause: marginClause,
    });
  }
  return renderTemplate(template.dual_chips, {
    team1: rank1.name,
    team2: rank2.name,
    chip1: chipLeader,
    chip2: chipChaser,
    margin_clause: marginClause,
  });
}

if (chipLeader || chipChaser) {
  const isLeaderChip = !!chipLeader;
  const chipTeam = isLeaderChip ? rank1 : rank2;
  const rivalTeam = isLeaderChip ? rank2 : rank1;
  const chipName = chipLeader || chipChaser;
  const targetClause = margin === 0
    ? 'memecah kebuntuan poin identik melawan'
    : isLeaderChip
      ? \`memperlebar keunggulan [N:\${margin} Poin] atas\`
      : \`memangkas jarak [N:\${margin} Poin] dari\`;
  return renderTemplate(template.chip, {
    team_chip: chipTeam.name,
    chip: chipName,
    target_clause: targetClause,
    team_rival: rivalTeam.name,
  });
}

if (margin === 0) {
  return renderTemplate(template.tied, {
    team1: rank1.name,
    team2: rank2.name,
  });
}

if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    team1: rank1.name,
    margin,
    team2: rank2.name,
    captain1: capLeader.name,
    captain2: capChaser.name,
  });
}

const diffStarters = getTopDifferingStarters(rank1.id, rank2.id);
return renderTemplate(template.same_captain, {
  team1: rank1.name,
  margin,
  team2: rank2.name,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      team1: 'Sunda Kelapa',
      team2: 'Bintang Timur',
      margin: '4',
      captain1: 'Haaland',
      captain2: 'Isak',
      captain: 'Haaland',
      diff_player1: 'Palmer',
      diff_player2: 'Mbeumo',
      chip1: 'Free Hit',
      chip2: 'Wildcard',
      margin_clause: ' dengan keduanya terpaut [N:4 Poin]',
      team_chip: 'Bintang Timur',
      chip: 'Free Hit',
      target_clause: 'memangkas jarak [N:4 Poin] dari',
      team_rival: 'Sunda Kelapa',
    },
  },
  {
    no: 47,
    id: 'BM_STANDINGS_GAMEWEEK_LEADER',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Gameweek',
    title: 'GW Leader',
    output: 'SINGLE-NEWS',
    template: `[T:{team}] memimpin perolehan poin sementara dengan [N:{gw_pts} Poin].`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  team: gwLeader.name,
  gw_pts: gwLeader.gw_points,
});`,
    sample_data: {
      gw: '10',
      team: 'Elang Jawa',
      gw_pts: '58',
    },
  },
  {
    no: 48,
    id: 'BM_LINEUP_REMAINING_ASSETS',
    gw_phase: 'Between Match',
    category: 'Lineup',
    subcategory: 'Remaining',
    title: 'Remaining Assets',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dengan Kapten Tersisa]
[T:{team}] masih menyisakan [N:{remaining_count}] pemain yang belum bertanding, termasuk kapten [P:{captain}] ([C:{captain_club}]).

[Kondisi: Tanpa Kapten Tersisa]
[T:{team}] masih menyisakan [N:{remaining_count}] pemain yang belum bertanding, termasuk [P:{player}] ([C:{club}]).`,
    example: '',
    code: `const remaining = getRemainingStartingAssets(manager, fixtures);
if (remaining.length === 0) return null;
if (remaining.some((p) => p.isCaptain)) {
  const cap = remaining.find((p) => p.isCaptain)!;
  return renderTemplate(template.with_captain, {
    gw,
    team: manager.name,
    remaining_count: remaining.length,
    captain: cap.web_name,
    captain_club: cap.club,
  });
}
const featured = remaining[0];
return renderTemplate(template.without_captain, {
  gw,
  team: manager.name,
  remaining_count: remaining.length,
  player: featured.web_name,
  club: featured.club,
});`,
    sample_data: {
      gw: '10',
      team: 'Sunda Kelapa',
      remaining_count: '4',
      captain: 'Haaland',
      captain_club: 'Man City',
      player: 'Palmer',
      club: 'Chelsea',
    },
  },
  {
    no: 82,
    id: 'BM_LINEUP_SURPRISE_BENCHED',
    gw_phase: 'Between Match',
    category: 'Lineup',
    subcategory: 'Surprise',
    title: 'Surprise Lineup',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dicadangkan]
[C:{club}] mencadangkan [P:{player}] ([N:{starter_pct}%] starter) saat menghadapi [C:{opponent}].

[Kondisi: Absen dari Skuad]
[P:{player}] ([N:{starter_pct}%] starter) tidak masuk daftar skuad [C:{club}] saat menghadapi [C:{opponent}].`,
    example: '',
    code: `// Syarat wajib: lineup resmi laga berikutnya terbit (>= 10 starter), pemain 100% fit (status === 'a', chance === null/100), starter_pct >= 15% (atau kapten >= 3 tim), maks 1 pemain per klub per laga.
const popularFit = getFitPopularClubPlayers(gw, { minStarterPct: 15, minCaptainCount: 3 });
const topMissing = popularFit[club]?.find(p => !starters.has(p.id));
if (!topMissing) return null;
const cond = bench.has(topMissing.id) ? template.benched : template.absent;
return renderTemplate(cond, {
  club,
  player: topMissing.web_name,
  starter_pct: topMissing.starterPct,
  opponent,
});`,
    sample_data: {
      club: 'Arsenal',
      player: 'Saka',
      starter_pct: '68',
      opponent: 'Chelsea',
    },
  },
  {
    no: 85,
    id: 'BM_STANDINGS_RANK_MOVEMENT',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Rank',
    title: 'Rank Movement',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Naik Peringkat]
[T:{team}] naik [N:+{rank_diff} Peringkat] sementara dari [N:{old_rank}] ke [N:{new_rank}] usai mengoleksi [N:{gw_pts} Poin].

[Kondisi: Turun Peringkat]
[T:{team}] turun [N:-{rank_diff} Peringkat] sementara dari [N:{old_rank}] ke [N:{new_rank}] dengan [N:{gw_pts} Poin] sejauh ini.`,
    example: '',
    code: `// Sorot lonjakan tertinggi & penurunan terdalam sementara (minimal bergeser >= 3 peringkat) usai laga berjalan.
const climbers = standings.filter(s => (s.last_rank - s.rank) >= 3).sort((a, b) => (b.last_rank - b.rank) - (a.last_rank - a.rank)).slice(0, 2);
const fallers = standings.filter(s => (s.rank - s.last_rank) >= 3).sort((a, b) => (b.rank - b.last_rank) - (a.rank - a.last_rank)).slice(0, 2);`,
    sample_data: {
      team: 'Elang Jawa',
      rank_diff: '5',
      old_rank: '14',
      new_rank: '9',
      gw_pts: '54',
    },
  },
  {
    no: 86,
    id: 'BM_CAPTAIN_VICE_CAPTAIN',
    gw_phase: 'Between Match',
    category: 'Captain',
    subcategory: 'Vice-Captain',
    title: 'Vice-Captain',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Wakil Kapten Sudah Main]
[T:{team}] beralih mengandalkan wakil kapten [P:{vice_captain}] ([N:{vice_pts} Poin]) setelah kapten utama [P:{captain_dnp}] absen bermain.

[Kondisi: Menanti Wakil Kapten]
[T:{team}] kini bergantung pada wakil kapten [P:{vice_captain}] ([C:{vice_club}]) setelah kapten utama [P:{captain_dnp}] tercatat 0 menit.`,
    example: '',
    code: `// Terpicu jika klub kapten utama sudah selesai bertanding dengan 0 menit bermain.
if (capClubFinished && capStat.minutes === 0) {
  const vcPlayed = vcClubFinished && vcStat.minutes > 0;
  return renderTemplate(vcPlayed ? template.vc_played : template.vc_waiting, {
    team: manager.entry_name,
    vice_captain: vcStat.name,
    vice_pts: vcStat.points,
    vice_club: vcStat.club,
    captain_dnp: capStat.name,
  });
}`,
    sample_data: {
      team: 'Sunda Kelapa',
      vice_captain: 'Saka',
      vice_pts: '12',
      vice_club: 'Arsenal',
      captain_dnp: 'Palmer',
    },
  },
  {
    no: 87,
    id: 'BM_CHIP_PROGRESS',
    gw_phase: 'Between Match',
    category: 'Chip',
    subcategory: 'Chip Progress',
    title: 'Chip Progress',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Triple Captain]
[T:{team}] mengaktifkan [N:Triple Captain] dan membukukan [N:{total_pts} Poin] sementara dari kapten [P:{captain}].

[Kondisi: Bench Boost]
[T:{team}] mengaktifkan [N:Bench Boost] dan mengoleksi [N:{bench_pts} Poin] sementara dari bangku cadangannya.

[Kondisi: Wildcard]
[T:{team}] mengaktifkan [N:Wildcard] dan mengoleksi [N:{gw_pts} Poin] sementara dengan [N:{remaining_count}] pemain tersisa.

[Kondisi: Free Hit]
[T:{team}] mengaktifkan [N:Free Hit] dan mengoleksi [N:{gw_pts} Poin] sementara dengan [N:{remaining_count}] pemain tersisa.`,
    example: '',
    code: `// Terpicu hanya jika pemain/kapten terkait chip sudah selesai bertanding di GW berjalan.
if (chip === 'TC' && capClubFinished) return renderTemplate(template.tc, { team, captain, total_pts });
if (chip === 'BB' && finishedBenchCount > 0) return renderTemplate(template.bb, { team, bench_pts });
if ((chip === 'WC' || chip === 'FH') && finishedStarterCount > 0 && remainingCount > 0) {
  return renderTemplate(chip === 'WC' ? template.wc : template.fh, { team, gw_pts, remaining_count });
}`,
    sample_data: {
      team: 'Kuda Hitam',
      captain: 'Haaland',
      total_pts: '39',
      bench_pts: '18',
      gw_pts: '56',
      remaining_count: '4',
    },
  },
  {
    no: 88,
    id: 'BM_TRANSFER_HITS_EVALUATION',
    gw_phase: 'Between Match',
    category: 'Transfer',
    subcategory: 'Hits',
    title: 'Hits Evaluation',
    output: 'MULTI-NEWS',
    template: `[T:{team}] memulai pekan dengan penalti poin [N:-{hits_pts} Poin], sementara rekrutan barunya [P:{player_in}] ([C:{club}]) membukukan [N:{player_pts} Poin] pada laga yang sudah tuntas.`,
    example: '',
    code: `// Ambil tim dengan penalti hit (> 0) yang rekrutan barunya sudah menyelesaikan laga di GW berjalan.
if (manager.event_transfers_cost > 0 && finishedSignings.length > 0) {
  const bestIn = finishedSignings[0];
  return renderTemplate(template, {
    team: manager.entry_name,
    hits_pts: manager.event_transfers_cost,
    player_in: bestIn.name,
    club: bestIn.club,
    player_pts: bestIn.points,
  });
}`,
    sample_data: {
      team: 'Bintang Timur',
      hits_pts: '4',
      player_in: 'Cunha',
      club: 'Wolves',
      player_pts: '9',
    },
  },
  {
    no: 89,
    id: 'BM_CAPTAIN_DIFFERENTIAL_RETURN',
    gw_phase: 'Between Match',
    category: 'Captain',
    subcategory: 'Differential',
    title: 'Differential Captain Return',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kapten Eksklusif (1 Tim)]
[T:{team}] sebagai satu-satunya tim yang menunjuk [P:{captain}] ([C:{club}]) sebagai kapten membukukan [N:{pts} Poin] usai laga melawan [C:{opponent}].

[Kondisi: Kapten Differential (< 5%)]
[T:{team}] yang menunjuk [P:{captain}] ([C:{club}]) sebagai kapten differential membukukan [N:{pts} Poin] usai laga melawan [C:{opponent}].`,
    example: '',
    code: `// Sorot kapten differential (< 5% atau <= 2 pemilih) yang sudah selesai main dengan >= 8 poin dasar.
if (cap.isDiff && capClubFinished && capStat.points >= 8) {
  const cond = cap.pickersCount === 1 ? template.exclusive : template.differential;
  return renderTemplate(cond, {
    team: manager.entry_name,
    pts: capStat.points * (chip === 'TC' ? 3 : 2),
    captain: capStat.name,
    club: capStat.club,
    opponent: fixInfo.opponent,
  });
}`,
    sample_data: {
      team: 'Garuda FC',
      pts: '22',
      captain: 'Palmer',
      club: 'Chelsea',
      opponent: 'Arsenal',
    },
  },
  {
    no: 102,
    id: 'BM_PLAYER_AVAILABILITY_FLAGGED',
    gw_phase: 'Between Match',
    category: 'Player',
    subcategory: 'Availability',
    title: 'Flagged Players',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dipastikan Absen]
[P:{player}] ([C:{club}]) dipastikan absen melawan [C:{opponent}] akibat {injury_desc} sehingga berdampak bagi [N:{owners_count}] pemiliknya.

[Kondisi: Meragukan]
[P:{player}] ([C:{club}]) diragukan tampil melawan [C:{opponent}] akibat {injury_desc} sehingga menimbulkan tanda tanya bagi [N:{owners_count}] pemiliknya.`,
    example: '',
    code: `// Pemain berstatus flagged (status !== 'a', newsAdded >= deadline sebelumnya) yang klubnya belum kickoff di GW berjalan.
const flaggedUpcoming = getFlaggedPlayersForUpcomingMatches(gw);
return flaggedUpcoming.map(item => renderTemplate(item.isOut ? template.out : template.doubt, {
  player: item.web_name,
  club: item.club,
  opponent: item.opponent,
  injury_desc: item.injury_desc,
  owners_count: item.owners_count,
}));`,
    sample_data: {
      player: 'Manzambi',
      club: 'Aston Villa',
      opponent: 'Bournemouth',
      injury_desc: 'cedera betis',
      owners_count: '12',
    },
  },
  {
    no: 103,
    id: 'BM_STANDINGS_WEEKLY_WINS_MOST',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Weekly Wins',
    title: 'Most GW Wins',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Berbeda]
[T:{team1}] ([N:{titles1}] kali juara, [N:{gw_pts1} Poin] sementara) dan [T:{team2}] ([N:{titles2}] kali juara, [N:{gw_pts2} Poin] sementara) bersaing memperebutkan status peraih juara Gameweek terbanyak, dengan [T:{team1}] menunjuk [P:{captain1}] sebagai kapten sementara [T:{team2}] memilih [P:{captain2}].

[Kondisi: Kapten Sama]
[T:{team1}] ([N:{titles1}] kali juara, [N:{gw_pts1} Poin] sementara) dan [T:{team2}] ([N:{titles2}] kali juara, [N:{gw_pts2} Poin] sementara) keduanya menunjuk [P:{captain}] sebagai kapten dalam persaingan juara Gameweek terbanyak, sehingga penentu selisih poin sementara beralih ke [P:{diff_player1}] dan [P:{diff_player2}].

[Kondisi: Duel Chip Berbeda]
[T:{team1}] ([N:{titles1}] kali juara, [N:{gw_pts1} Poin] sementara) mengaktifkan [N:{chip1}] sementara [T:{team2}] ([N:{titles2}] kali juara, [N:{gw_pts2} Poin] sementara) mengaktifkan [N:{chip2}] dalam persaingan juara Gameweek terbanyak.

[Kondisi: Chip Sama]
[T:{team1}] ([N:{titles1}] kali juara, [N:{gw_pts1} Poin] sementara) dan [T:{team2}] ([N:{titles2}] kali juara, [N:{gw_pts2} Poin] sementara) mengaktifkan [N:{chip}] dalam persaingan juara Gameweek terbanyak.

[Kondisi: Manuver Chip]
[T:{team_chip}] ([N:{titles_chip}] kali juara, [N:{gw_pts_chip} Poin] sementara) mengaktifkan [N:{chip}] untuk mengejar status peraih juara Gameweek terbanyak.`,
    example: '',
    code: `// Gelar juara GW dihitung dari GW 1 s.d. GW n-1; peringkat 1 & 2 klasemen sementara dikecualikan agar tidak bentrok dengan Title Race.
const excludedIds = [standings[0]?.id, standings[1]?.id];
const leaders = getMostGwChampionsLeaders(gw - 1).filter(t => !excludedIds.includes(t.id));
if (leaders.length < 2) return null;

const leader = leaders[0];
const chaser = leaders[1];
const chipLeader = getActiveChip(leader.id, gw);
const chipChaser = getActiveChip(chaser.id, gw);

if (chipLeader && chipChaser) {
  if (chipLeader === chipChaser) {
    return renderTemplate(template.same_chip, {
      team1: leader.name,
      titles1: leader.titles,
      gw_pts1: leader.gw_points,
      team2: chaser.name,
      titles2: chaser.titles,
      gw_pts2: chaser.gw_points,
      chip: chipLeader,
    });
  }
  return renderTemplate(template.dual_chips, {
    team1: leader.name,
    titles1: leader.titles,
    gw_pts1: leader.gw_points,
    team2: chaser.name,
    titles2: chaser.titles,
    gw_pts2: chaser.gw_points,
    chip1: chipLeader,
    chip2: chipChaser,
  });
}

if (chipLeader || chipChaser) {
  const chipTeam = chipLeader ? leader : chaser;
  const chipName = chipLeader || chipChaser;
  return renderTemplate(template.chip, {
    team_chip: chipTeam.name,
    titles_chip: chipTeam.titles,
    gw_pts_chip: chipTeam.gw_points,
    chip: chipName,
  });
}`,
    sample_data: {
      team1: 'Blackswann',
      team2: 'rdwndvsn',
      titles1: '1',
      titles2: '1',
      gw_pts1: '48',
      gw_pts2: '44',
      captain1: 'Haaland',
      captain2: 'Salah',
      captain: 'Haaland',
      diff_player1: 'Kudus',
      diff_player2: 'Raya',
      chip1: 'Free Hit',
      chip2: 'Wildcard',
      team_chip: 'Blackswann',
      titles_chip: '1',
      gw_pts_chip: '48',
      chip: 'Free Hit',
    },
  },

  // ============================================================================
  // FASE 4: PROVISIONAL TEMPLATES (Seluruh Laga FT, Audit Opta/FPL Berjalan)
  // ============================================================================
  {
    no: 49,
    id: 'PV_STANDINGS_TITLE_RACE',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Title Race',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Unggul Poin]
[T:{team_1}] memuncaki klasemen sementara dengan [N:{pts_1} Poin], unggul [N:{margin} Poin] atas [T:{team_2}] ([N:{pts_2} Poin]) setelah seluruh laga tuntas.

[Kondisi: Poin Sama]
[T:{team_1}] dan [T:{team_2}] mengoleksi poin sementara identik ([N:{pts_1} Poin]) di puncak klasemen setelah seluruh laga tuntas.`,
    example: '',
    code: `const margin = rank1.total_points - rank2.total_points;
return renderTemplate(margin === 0 ? template.tied : template.lead, {
  gw,
  team_1: rank1.name,
  pts_1: rank1.total_points,
  margin,
  team_2: rank2.name,
  pts_2: rank2.total_points,
});`,
    sample_data: {
      gw: '10',
      team_1: 'Sunda Kelapa',
      pts_1: '642',
      margin: '8',
      team_2: 'Bintang Timur',
      pts_2: '634',
    },
  },
  {
    no: 50,
    id: 'PV_STANDINGS_GAMEWEEK_LEADER',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Gameweek',
    title: 'GW Leader',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Pemimpin Tunggal]
[T:{team}] memimpin perolehan poin sementara dengan [N:{gw_pts} Poin], unggul atas [T:{team_2}] ([N:{gw_pts_2} Poin]) sebelum pengesahan autosub dan poin bonus.

[Kondisi: Poin Sama]
{teams_list} mengoleksi poin sementara tertinggi ([N:{gw_pts} Poin]) sebelum pengesahan autosub dan poin bonus.`,
    example: '',
    code: `if (tiedLeaders.length > 1) {
  return renderTemplate(template.tied, {
    gw,
    teams_list: formatTeamList(tiedLeaders.map(l => l.name)),
    gw_pts: tiedLeaders[0].gw_points,
  });
}
return renderTemplate(template.single, {
  gw,
  team: leader1.name,
  gw_pts: leader1.gw_points,
  team_2: leader2.name,
  gw_pts_2: leader2.gw_points,
});`,
    sample_data: {
      gw: '10',
      team: 'Elang Jawa',
      teams_list: '[T:Elang Jawa] dan [T:Garuda FC]',
      gw_pts: '78',
      team_2: 'Garuda FC',
      gw_pts_2: '74',
    },
  },
  {
    no: 51,
    id: 'PV_PLAYER_TOP_PERFORMER',
    gw_phase: 'Provisional',
    category: 'Player',
    subcategory: 'Top Performer',
    title: 'Top Performer',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Pemain Tunggal]
[P:{player}] ([C:{club}]) memuncaki daftar poin sementara lewat [N:{points} Poin] ([N:{goals} Gol], [N:{assists} Assist]), dimiliki [N:{owners_count}] tim.

[Kondisi: Poin Sama]
{players_list} berbagi status peraih poin tertinggi sementara dengan [N:{points} Poin].`,
    example: '',
    code: `const topPlayers = getProvisionalTopPlayers(gw); // all players tied at max points
if (topPlayers.length === 1) {
  const p = topPlayers[0];
  return renderTemplate(template.single, {
    gw,
    player: p.web_name,
    club: p.club,
    points: p.points,
    goals: p.goals,
    assists: p.assists,
    owners_count: p.owners_count,
  });
}
return renderTemplate(template.tied, {
  gw,
  players_list: formatPlayerClubList(topPlayers),
  points: topPlayers[0].points,
});`,
    sample_data: {
      gw: '10',
      player: 'Palmer',
      club: 'Chelsea',
      points: '18',
      goals: '2',
      assists: '1',
      owners_count: '12',
      players_list: '[P:Alysson] ([C:Aston Villa]) dan [P:Barry] ([C:Everton])',
    },
  },
  {
    no: 52,
    id: 'PV_CAPTAIN_POPULAR_MOST_CAPTAINED',
    gw_phase: 'Provisional',
    category: 'Captain',
    subcategory: 'Popular',
    title: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `[P:{captain_1}] ([N:{count_1}] tim) dan [P:{captain_2}] ([N:{count_2}] tim) menjadi kapten terpopuler, masing-masing meraih [N:{pts_1} Poin] dan [N:{pts_2} Poin] sementara.`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  captain_1: cap1.web_name,
  count_1: cap1.count,
  pts_1: cap1.points,
  captain_2: cap2.web_name,
  count_2: cap2.count,
  pts_2: cap2.points,
});`,
    sample_data: {
      gw: '10',
      captain_1: 'Haaland',
      count_1: '10',
      pts_1: '26',
      captain_2: 'Salah',
      count_2: '7',
      pts_2: '16',
    },
  },
  {
    no: 53,
    id: 'PV_CAPTAIN_VICE_CAPTAIN',
    gw_phase: 'Provisional',
    category: 'Captain',
    subcategory: 'Vice-Captain',
    title: 'Vice-Captain',
    output: 'MULTI-NEWS',
    template: `[T:{team}] beralih mengandalkan wakil kapten [P:{vice_captain}] ([N:{vice_pts} Poin]) setelah kapten utama [P:{captain_dnp}] absen bermain.`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  captain_dnp: manager.captain.web_name,
  vice_captain: manager.vice_captain.web_name,
  vice_pts: manager.vice_captain.points * (isTc ? 3 : 2),
});`,
    sample_data: {
      team: 'Singa FC',
      captain_dnp: 'Saka',
      vice_captain: 'Palmer',
      vice_pts: '14',
    },
  },
  {
    no: 54,
    id: 'PV_LINEUP_AUTOSUB_PENDING',
    gw_phase: 'Provisional',
    category: 'Lineup',
    subcategory: 'Autosub',
    title: 'Pending Autosubs',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menanti autosub untuk memasukkan [P:{bench_player}] ([N:{bench_pts} Poin]) menggantikan [P:{player_dnp}] yang absen.`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  player_dnp: dnpPlayer.web_name,
  bench_player: benchPlayer.web_name,
  bench_pts: benchPlayer.points,
});`,
    sample_data: {
      team: 'Badak FC',
      player_dnp: 'Foden',
      bench_player: 'Delap',
      bench_pts: '12',
    },
  },
  {
    no: 55,
    id: 'PV_LINEUP_BENCH_TOTAL',
    gw_phase: 'Provisional',
    category: 'Lineup',
    subcategory: 'Bench',
    title: 'Total Bench Points',
    output: 'MULTI-NEWS',
    template: `[T:{team}] meninggalkan total [N:{total_bench_pts} Poin] di bangku cadangan, dipimpin [P:{player}] ([N:{player_pts} Poin]).`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  total_bench_pts: manager.bench_total,
  gw,
  player: topBenchPlayer.web_name,
  player_pts: topBenchPlayer.points,
});`,
    sample_data: {
      team: 'Garuda FC',
      total_bench_pts: '19',
      gw: '10',
      player: 'Wood',
      player_pts: '12',
    },
  },
  {
    no: 56,
    id: 'PV_CHIP_WILDCARD',
    gw_phase: 'Provisional',
    category: 'Chip',
    subcategory: 'Wildcard',
    title: 'Wildcard',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengemas [N:{gw_pts} Poin] sementara lewat [N:Wildcard].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  gw_pts: manager.event_points,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      gw_pts: '72',
    },
  },
  {
    no: 57,
    id: 'PV_CHIP_FREE_HIT',
    gw_phase: 'Provisional',
    category: 'Chip',
    subcategory: 'Free Hit',
    title: 'Free Hit',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengemas [N:{gw_pts} Poin] sementara lewat [N:Free Hit].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  gw_pts: manager.event_points,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      gw_pts: '68',
    },
  },
  {
    no: 58,
    id: 'PV_CHIP_BENCH_BOOST',
    gw_phase: 'Provisional',
    category: 'Chip',
    subcategory: 'Bench Boost',
    title: 'Bench Boost',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengantongi tambahan [N:{bench_pts} Poin] sementara dari bangku cadangannya lewat [N:Bench Boost].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  bench_pts: manager.bench_total,
  gw,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      bench_pts: '22',
      gw: '10',
    },
  },
  {
    no: 59,
    id: 'PV_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Provisional',
    category: 'Chip',
    subcategory: 'Triple Captain',
    title: 'Triple Captain',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengantongi [N:{total_pts} Poin] sementara dari kapten [P:{captain}] lewat [N:Triple Captain].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  captain: manager.captain.web_name,
  total_pts: manager.captain.points * 3,
  gw,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      captain: 'Haaland',
      total_pts: '39',
      gw: '10',
    },
  },
  {
    no: 60,
    id: 'PV_TRANSFER_HITS_EVALUATION',
    gw_phase: 'Provisional',
    category: 'Transfer',
    subcategory: 'Hits',
    title: 'Hits Evaluation',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menanggung penalti hit [N:-{hits_pts} Poin], sementara rekrutan barunya [P:{player_in}] mengemas [N:{player_pts} Poin] sementara.`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  hits_pts: manager.hits_cost,
  gw,
  player_in: playerIn.web_name,
  player_pts: playerIn.points,
});`,
    sample_data: {
      team: 'Bintang Timur',
      hits_pts: '8',
      gw: '10',
      player_in: 'Palmer',
      player_pts: '14',
    },
  },
  {
    no: 61,
    id: 'PV_MATCH_CLEAN_SHEET',
    gw_phase: 'Provisional',
    category: 'Match',
    subcategory: 'Clean Sheet',
    title: 'Clean Sheet',
    output: 'MULTI-NEWS',
    template: `[C:{club}] mengunci clean sheet saat menghadapi [C:{opponent}] ([N:{score}]), menghadirkan poin sementara bagi [N:{owners_count}] pemilik [P:{defender}].`,
    example: '',
    code: `return renderTemplate(template, {
  club: team.name,
  gw,
  score: match.score,
  opponent: opponent.name,
  owners_count: defenderOwners,
  defender: defender.web_name,
});`,
    sample_data: {
      club: 'Arsenal',
      gw: '10',
      score: '2 - 0',
      opponent: 'Chelsea',
      owners_count: '14',
      defender: 'Saliba',
    },
  },
  {
    no: 90,
    id: 'PV_STANDINGS_RANK_MOVEMENT',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Rank',
    title: 'Rank Movement',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Naik Peringkat]
[T:{team}] naik [N:+{rank_diff} Peringkat] sementara dari [N:{old_rank}] ke [N:{new_rank}] usai mengemas [N:{gw_pts} Poin].

[Kondisi: Turun Peringkat]
[T:{team}] turun [N:-{rank_diff} Peringkat] sementara dari [N:{old_rank}] ke [N:{new_rank}] dengan [N:{gw_pts} Poin].`,
    example: '',
    code: `// Sorot lonjakan tertinggi & penurunan terdalam sementara (minimal bergeser >= 3 peringkat) setelah 10 laga tuntas.
const climbers = standings.filter(s => (s.last_rank - s.rank) >= 3).sort((a, b) => (b.last_rank - b.rank) - (a.last_rank - a.rank)).slice(0, 2);
const fallers = standings.filter(s => (s.rank - s.last_rank) >= 3).sort((a, b) => (b.rank - b.last_rank) - (a.rank - a.last_rank)).slice(0, 2);`,
    sample_data: {
      team: 'Elang Jawa',
      rank_diff: '6',
      old_rank: '14',
      new_rank: '8',
      gw_pts: '74',
    },
  },
  {
    no: 91,
    id: 'PV_STANDINGS_TITLE_RACE_LEAD_CHANGE',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Lead Change',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Unggul Poin]
[T:{new_leader}] naik dari peringkat [N:{old_rank}] untuk memimpin klasemen sementara, menggeser [T:{former_leader}] ke peringkat [N:{former_new_rank}] dengan keunggulan [N:{margin} Poin].

[Kondisi: Poin Sama]
[T:{new_leader}] naik dari peringkat [N:{old_rank}] ke puncak klasemen sementara dengan poin identik ([N:{total_pts} Poin]), menggeser [T:{former_leader}] ke peringkat [N:{former_new_rank}].`,
    example: '',
    code: `if (!titleBattle.coupOccurred) return null;
const margin = rank1.totalPts - rank2.totalPts;
return renderTemplate(margin === 0 ? template.tied : template.lead, {
  gw,
  new_leader: rank1.team,
  old_rank: rank1.lastRank,
  former_leader: formerLeader.team,
  former_new_rank: formerLeader.rank,
  margin,
  total_pts: rank1.totalPts,
});`,
    sample_data: {
      gw: '10',
      new_leader: 'Garuda FC',
      old_rank: '2',
      former_leader: 'Sunda Kelapa',
      former_new_rank: '2',
      margin: '4',
      total_pts: '642',
    },
  },
  {
    no: 92,
    id: 'PV_TRANSFER_OUT_SOLD_HAULERS',
    gw_phase: 'Provisional',
    category: 'Transfer',
    subcategory: 'Transfers Out',
    title: 'Sold Haulers',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] melepas [P:{player}] ([C:{club}]) yang mengoleksi [N:{points} Poin] sementara, sedangkan penggantinya [P:{player_in}] membukukan [N:{in_points} Poin].

[Kondisi: Multi Tim]
{teams} melepas [P:{player}] ([C:{club}]) sebelum sang pemain mengoleksi [N:{points} Poin] sementara.`,
    example: '',
    code: `// Konsolidasi lintas-tim untuk pemain yang dijual di GW N saat seluruh laga usai (poin pemain tidak dikalikan jumlah tim)
if (group.teamCount >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(group.teams),
    player: group.player,
    club: group.club,
    points: group.playerPts,
    gw,
  });
}
return renderTemplate(template.single, {
  team: singleTransfer.team,
  player: singleTransfer.playerOut,
  club: singleTransfer.club,
  points: singleTransfer.outPts,
  gw,
  player_in: singleTransfer.playerIn,
  in_points: singleTransfer.inPts,
});`,
    sample_data: {
      team: 'TELUR DADAR',
      teams: '[T:Garuda FC], [T:Sunda Kelapa], dan [N:9] tim lainnya',
      player: 'Cherki',
      club: 'Man City',
      points: '9',
      gw: '10',
      player_in: 'Saka',
      in_points: '2',
    },
  },
  {
    no: 93,
    id: 'PV_CAPTAIN_ALTERNATIVE_MISSED_HAUL',
    gw_phase: 'Provisional',
    category: 'Captain',
    subcategory: 'Alternative',
    title: 'Missed Captain Haul',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] menunjuk [P:{actual_captain}] ([N:{captain_pts} Poin]) sebagai kapten alih-alih [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin] sementara.

[Kondisi: Multi Tim]
{teams} menurunkan [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin] sementara, namun tidak menjadikannya kapten.`,
    example: '',
    code: `// Hanya membandingkan alternatif kapten dari posisi MID dan FWD (tidak pernah GKP/DEF)
if (group.teamCount >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(group.teams),
    player: group.player,
    club: group.club,
    points: group.playerPts,
    gw,
  });
}
return renderTemplate(template.single, {
  team: regret.team,
  actual_captain: regret.actualCaptain,
  captain_pts: regret.actualCaptainBasePts,
  gw,
  player: regret.alternativePlayer,
  club: regret.club,
  points: regret.alternativePts,
});`,
    sample_data: {
      team: 'Singa FC',
      teams: '[T:Elang Jawa], [T:Badak FC], dan [N:24] tim lainnya',
      actual_captain: 'Haaland',
      captain_pts: '4',
      player: 'N.Jackson',
      club: 'Aston Villa',
      points: '11',
      gw: '10',
    },
  },

  // ============================================================================
  // FASE 5: CONFIRMED TEMPLATES (Poin & Klasemen Resmi Tervalidasi 100%)
  // ============================================================================
  {
    no: 62,
    id: 'CF_STANDINGS_GAMEWEEK_WINNER',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Gameweek',
    title: 'GW Winner',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Pemenang Tunggal]
[T:{team}] menjuarai Gameweek [N:{gw}] dengan [N:{gw_pts} Poin], unggul [N:{margin} Poin] atas [T:{runner_up}] di peringkat kedua.

[Kondisi: Poin Sama]
{teams_list} berbagi gelar juara Gameweek [N:{gw}] dengan koleksi [N:{gw_pts} Poin].`,
    example: '',
    code: `if (tiedWinners.length > 1) {
  return renderTemplate(template.tied, {
    gw,
    teams_list: formatTeamList(tiedWinners.map(w => w.name)),
    gw_pts: tiedWinners[0].points,
  });
}
return renderTemplate(template.single, {
  gw,
  team: leader.name,
  gw_pts: leader.points,
  margin: leader.points - runnerUp.points,
  runner_up: runnerUp.name,
});`,
    sample_data: {
      gw: '10',
      team: 'Elang Jawa',
      teams_list: '[T:Elang Jawa] dan [T:Garuda FC]',
      gw_pts: '82',
      margin: '3',
      runner_up: 'Garuda FC',
    },
  },
  {
    no: 63,
    id: 'CF_STANDINGS_TITLE_RACE',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Title Race',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Unggul Poin]
[T:{team_1}] memimpin klasemen liga usai Gameweek [N:{gw}] dengan [N:{pts_1} Poin], unggul [N:{margin} Poin] atas [T:{team_2}] di peringkat kedua.

[Kondisi: Poin Sama]
[T:{team_1}] dan [T:{team_2}] mengoleksi poin identik ([N:{pts_1} Poin]) di puncak klasemen usai Gameweek [N:{gw}].`,
    example: '',
    code: `const standings = getOfficialStandings(gw);
const margin = standings[0].total_points - standings[1].total_points;
return renderTemplate(margin === 0 ? template.tied : template.lead, {
  gw,
  team_1: standings[0].name,
  pts_1: standings[0].total_points,
  margin,
  team_2: standings[1].name,
});`,
    sample_data: {
      gw: '10',
      team_1: 'Sunda Kelapa',
      pts_1: '654',
      margin: '11',
      team_2: 'Bintang Timur',
    },
  },
  {
    no: 64,
    id: 'CF_STANDINGS_WEEKLY_WINS_MOST',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Weekly Wins',
    title: 'Most GW Wins',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Pemimpin Tunggal]
[T:{team_1}] (peringkat [N:{rank_1}]) memuncaki daftar juara mingguan hingga Gameweek [N:{gw}] dengan [N:{titles_1} Gelar], diikuti [T:{team_2}] (peringkat [N:{rank_2}], [N:{titles_2} Gelar]).

[Kondisi: Jumlah Kemenangan Sama]
[T:{team_1}] (peringkat [N:{rank_1}]) memimpin daftar juara mingguan hingga Gameweek [N:{gw}] dengan [N:{titles} Gelar], unggul peringkat atas {challengers}.`,
    example: '',
    code: `// Kondisi sementara s.d. GW N untuk gelar Juara GW Terbanyak Semusim:
// Peringkat 1 & 2 klasemen FNB League tidak berhak meraih gelar ini; jika win_count sama, peringkat klasemen lebih tinggi menang.
const standings = getOfficialStandings(gw);
const excludedIds = new Set([standings[0]?.id, standings[1]?.id]);
const eligible = getMostGwChampionsLeaders(gw)
  .filter(m => !excludedIds.has(m.id) && m.win_count > 0)
  .sort((a, b) => (b.win_count - a.win_count) || (a.current_rank - b.current_rank));
if (eligible.length === 0) return null;

const leader = eligible[0];
const maxWins = leader.win_count;
const topTied = eligible.filter(m => m.win_count === maxWins);
if (topTied.length > 1) {
  const others = topTied.slice(1);
  return renderTemplate(template.tied, {
    gw,
    team_1: leader.name,
    rank_1: leader.current_rank,
    titles: maxWins,
    challengers: formatRankedChallengers(others),
  });
}

const runnerUp = eligible[1];
return renderTemplate(template.single, {
  gw,
  team_1: leader.name,
  rank_1: leader.current_rank,
  titles_1: maxWins,
  team_2: runnerUp.name,
  rank_2: runnerUp.current_rank,
  titles_2: runnerUp.win_count,
});`,
    sample_data: {
      gw: '10',
      team_1: 'Blackswann',
      rank_1: '4',
      titles_1: '3',
      team_2: 'rdwndvsn',
      rank_2: '5',
      titles_2: '2',
      titles: '1',
      challengers: '[T:rdwndvsn] (peringkat [N:5]) dan [N:7] tim lainnya',
    },
  },
  {
    no: 65,
    id: 'CF_STANDINGS_RANK_BIGGEST_RISE',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Rank',
    title: 'Biggest Rise',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Tim Tunggal]
[T:{team}] mencatat lonjakan tertinggi dengan naik [N:+{rank_climb} Peringkat] dari [N:{old_rank}] ke [N:{new_rank}].

[Kondisi: Lonjakan Peringkat Sama]
{teams_climbers} mencatat lonjakan tertinggi dengan kenaikan [N:+{rank_climb} Peringkat].`,
    example: '',
    code: `const topClimbers = getTopRankClimbers(gw); // all teams tied at max rank_diff
if (topClimbers.length === 1) {
  const c = topClimbers[0];
  return renderTemplate(template.single, {
    gw,
    team: c.name,
    rank_climb: c.rank_diff,
    old_rank: c.prev_rank,
    new_rank: c.current_rank,
  });
}
return renderTemplate(template.tied, {
  gw,
  teams_climbers: formatClimberList(topClimbers),
  rank_climb: topClimbers[0].rank_diff,
});`,
    sample_data: {
      gw: '10',
      team: 'Kuda Hitam',
      rank_climb: '6',
      old_rank: '14',
      new_rank: '8',
      teams_climbers: '[T:Garuda FC] ([N:14] ke [N:8]) dan [T:Bintang Timur] ([N:19] ke [N:13])',
    },
  },
  {
    no: 66,
    id: 'CF_PLAYER_TOP_PERFORMER_GW_SCORER',
    gw_phase: 'Confirmed',
    category: 'Player',
    subcategory: 'Top Performer',
    title: 'GW Top Scorer',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Pemain Tunggal]
[P:{player}] ([C:{club}]) menjadi pencetak poin tertinggi Gameweek [N:{gw}] dengan [N:{points} Poin] ([N:{goals} Gol], [N:{assists} Assist], [N:{bps_pts} Poin Bonus]).

[Kondisi: Poin Sama]
{players_list} berbagi status peraih poin tertinggi Gameweek [N:{gw}] dengan [N:{points} Poin].`,
    example: '',
    code: `const topPlayers = getOfficialTopPlayers(gw); // all players tied at max points
if (topPlayers.length === 1) {
  const p = topPlayers[0];
  return renderTemplate(template.single, {
    gw,
    player: p.web_name,
    club: p.club,
    points: p.total_points,
    goals: p.goals,
    assists: p.assists,
    bps_pts: p.bonus,
  });
}
return renderTemplate(template.tied, {
  gw,
  players_list: formatPlayerClubList(topPlayers),
  points: topPlayers[0].total_points,
});`,
    sample_data: {
      gw: '10',
      player: 'Palmer',
      club: 'Chelsea',
      points: '18',
      goals: '2',
      assists: '1',
      bps_pts: '3',
      players_list: '[P:Alysson] ([C:Aston Villa]) dan [P:Barry] ([C:Everton])',
    },
  },
  {
    no: 67,
    id: 'CF_LINEUP_AUTOSUB_CONFIRMED',
    gw_phase: 'Confirmed',
    category: 'Lineup',
    subcategory: 'Autosub',
    title: 'Confirmed Autosubs',
    output: 'MULTI-NEWS',
    template: `[T:{team}] meraih [N:+{bench_pts} Poin] lewat autosub [P:{bench_player}] yang masuk menggantikan [P:{player_dnp}].`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  bench_player: sub.bench_player.web_name,
  bench_pts: sub.bench_player.points,
  team: sub.team_name,
  player_dnp: sub.starter_dnp.web_name,
});`,
    sample_data: {
      gw: '10',
      bench_player: 'Delap',
      bench_pts: '12',
      team: 'Badak FC',
      player_dnp: 'Foden',
    },
  },
  {
    no: 68,
    id: 'CF_CAPTAIN_POPULAR_MOST_CAPTAINED',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Popular',
    title: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Kapten Terbanyak Tunggal]
[P:{captain}] menjadi kapten terpopuler ([N:{count}] tim) dan menutup pekan dengan [N:{captain_pts} Poin].

[Kondisi: Jumlah Pemilih Sama]
{captains_list} menjadi kapten terpopuler setelah masing-masing dipilih [N:{count}] tim.`,
    example: '',
    code: `const topCaptains = getOfficialMostCaptainedList(gw); // all players tied at max captain_count
if (topCaptains.length === 1) {
  const cap = topCaptains[0];
  return renderTemplate(template.single, {
    gw,
    captain: cap.web_name,
    count: cap.owners_count,
    captain_pts: cap.points * 2,
  });
}
return renderTemplate(template.tied, {
  gw,
  captains_list: formatCaptainListWithPts(topCaptains),
  count: topCaptains[0].owners_count,
});`,
    sample_data: {
      gw: '10',
      captain: 'Haaland',
      count: '10',
      captain_pts: '26',
      captains_list: '[P:Haaland] ([N:4 Poin]) dan [P:Salah] ([N:24 Poin])',
    },
  },
  {
    no: 69,
    id: 'CF_CHIP_WILDCARD',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Wildcard',
    title: 'Wildcard',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menutup pekan dengan [N:{gw_pts} Poin] lewat [N:Wildcard].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  gw_pts: manager.event_points,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      gw_pts: '72',
    },
  },
  {
    no: 70,
    id: 'CF_CHIP_FREE_HIT',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Free Hit',
    title: 'Free Hit',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menutup pekan dengan [N:{gw_pts} Poin] lewat [N:Free Hit].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  gw_pts: manager.event_points,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      gw_pts: '68',
    },
  },
  {
    no: 71,
    id: 'CF_CHIP_BENCH_BOOST',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Bench Boost',
    title: 'Bench Boost',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengantongi tambahan [N:{bench_pts} Poin] dari bangku cadangannya lewat [N:Bench Boost].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  bench_pts: manager.bench_total,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      bench_pts: '22',
    },
  },
  {
    no: 72,
    id: 'CF_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Triple Captain',
    title: 'Triple Captain',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mengantongi [N:{total_pts} Poin] dari kapten [P:{captain}] lewat [N:Triple Captain].`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  gw,
  total_pts: manager.captain.points * 3,
  captain: manager.captain.web_name,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '10',
      total_pts: '39',
      captain: 'Haaland',
    },
  },
  {
    no: 73,
    id: 'CF_TRANSFER_HITS_DEDUCTED',
    gw_phase: 'Confirmed',
    category: 'Transfer',
    subcategory: 'Hits',
    title: 'Hits Deducted',
    output: 'MULTI-NEWS',
    template: `[T:{team}] terkena penalti transfer hit [N:-{hits_pts} Poin].`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  hits_pts: manager.hits_cost,
  team: manager.name,
});`,
    sample_data: {
      gw: '10',
      hits_pts: '8',
      team: 'Bintang Timur',
    },
  },
  {
    no: 74,
    id: 'CF_TRANSFER_OUT_SOLD_HAULERS',
    gw_phase: 'Confirmed',
    category: 'Transfer',
    subcategory: 'Transfers Out',
    title: 'Sold Haulers',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] melepas [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin], sementara penggantinya [P:{player_in}] meraih [N:{in_points} Poin].

[Kondisi: Multi Tim]
{teams} melepas [P:{player}] ([C:{club}]) sebelum sang pemain mengemas [N:{points} Poin].`,
    example: '',
    code: `// Konsolidasi lintas-tim untuk pemain yang dijual di GW N (poin pemain tidak dikalikan jumlah tim)
if (group.teamCount >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(group.teams),
    player: group.player,
    club: group.club,
    points: group.playerPts,
    gw,
  });
}
return renderTemplate(template.single, {
  team: singleTransfer.team,
  player: singleTransfer.playerOut,
  club: singleTransfer.club,
  points: singleTransfer.outPts,
  gw,
  player_in: singleTransfer.playerIn,
  in_points: singleTransfer.inPts,
});`,
    sample_data: {
      team: 'TELUR DADAR',
      teams: '[T:Garuda FC], [T:Sunda Kelapa], dan [N:9] tim lainnya',
      player: 'Cherki',
      club: 'Man City',
      points: '9',
      gw: '10',
      player_in: 'Saka',
      in_points: '2',
    },
  },
  {
    no: 75,
    id: 'CF_CAPTAIN_ALTERNATIVE_MISSED_HAUL',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Alternative',
    title: 'Missed Captain Haul',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] menunjuk [P:{actual_captain}] ([N:{captain_pts} Poin]) sebagai kapten alih-alih [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin].

[Kondisi: Multi Tim]
{teams} menurunkan [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin], namun tidak menjadikannya kapten.`,
    example: '',
    code: `// Hanya membandingkan alternatif kapten dari posisi MID dan FWD (tidak pernah GKP/DEF)
if (group.teamCount >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(group.teams),
    player: group.player,
    club: group.club,
    points: group.playerPts,
    gw,
  });
}
return renderTemplate(template.single, {
  team: regret.team,
  actual_captain: regret.actualCaptain,
  captain_pts: regret.actualCaptainBasePts,
  gw,
  player: regret.alternativePlayer,
  club: regret.club,
  points: regret.alternativePts,
});`,
    sample_data: {
      team: 'Singa FC',
      teams: '[T:Elang Jawa], [T:Badak FC], dan [N:24] tim lainnya',
      actual_captain: 'Haaland',
      captain_pts: '4',
      player: 'N.Jackson',
      club: 'Aston Villa',
      points: '11',
      gw: '10',
    },
  },
  {
    no: 76,
    id: 'CF_STANDINGS_RANK_BIGGEST_DROP',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Rank',
    title: 'Biggest Drop',
    output: 'MULTI-NEWS',
    template: `[T:{team}] merosot [N:-{rank_drop} Peringkat] dari [N:{old_rank}] ke [N:{new_rank}] usai mengemas [N:{gw_pts} Poin].`,
    example: '',
    code: `const fallers = getTopRankFallers(gw).filter(f => f.rankDrop >= 5);
return fallers.map(f => renderTemplate(template, {
  team: f.team,
  gw,
  rank_drop: f.rankDrop,
  old_rank: f.oldRank,
  new_rank: f.newRank,
  gw_pts: f.gwPts,
}));`,
    sample_data: {
      team: "A2N's Team",
      gw: '10',
      rank_drop: '21',
      old_rank: '56',
      new_rank: '77',
      gw_pts: '28',
    },
  },
  {
    no: 77,
    id: 'CF_STANDINGS_TITLE_RACE_LEAD_CHANGE',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Lead Change',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Unggul Poin]
[T:{new_leader}] naik dari peringkat [N:{old_rank}] untuk merebut puncak klasemen, menggusur [T:{former_leader}] ke peringkat [N:{former_new_rank}] dengan keunggulan [N:{margin} Poin].

[Kondisi: Poin Sama]
[T:{new_leader}] naik dari peringkat [N:{old_rank}] ke puncak klasemen dengan poin identik ([N:{total_pts} Poin]), menggusur [T:{former_leader}] ke peringkat [N:{former_new_rank}].`,
    example: '',
    code: `if (!titleBattle.coupOccurred) return null;
const margin = rank1.totalPts - rank2.totalPts;
return renderTemplate(margin === 0 ? template.tied : template.lead, {
  gw,
  new_leader: rank1.team,
  old_rank: rank1.lastRank,
  former_leader: formerLeader.team,
  former_new_rank: formerLeader.rank,
  margin,
  total_pts: rank1.totalPts,
});`,
    sample_data: {
      gw: '10',
      new_leader: 'Garuda FC',
      old_rank: '2',
      former_leader: 'Sunda Kelapa',
      former_new_rank: '2',
      margin: '4',
      total_pts: '654',
    },
  },
  {
    no: 78,
    id: 'CF_STANDINGS_TITLE_RACE_POINTS_GAP',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Title Race',
    title: 'Points Gap',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Selisih Poin]
[T:{team_1}] (peringkat [N:{rank_1}], [N:{pts_1} Poin]) hanya unggul [N:{gap} Poin] atas [T:{team_2}] (peringkat [N:{rank_2}], [N:{pts_2} Poin]).

[Kondisi: Poin Sama]
[T:{team_1}] (peringkat [N:{rank_1}]) dan [T:{team_2}] (peringkat [N:{rank_2}]) mengoleksi poin identik ([N:{pts_1} Poin]).`,
    example: '',
    code: `const duels = getTightStandingDuels(gw, { maxRank: 20, maxGap: 3, excludeTop2Pair: true });
return duels.map(d => renderTemplate(d.gap === 0 ? template.tied : template.gap, {
  gw,
  rank_1: d.team1.rank,
  team_1: d.team1.name,
  pts_1: d.team1.totalPts,
  rank_2: d.team2.rank,
  team_2: d.team2.name,
  pts_2: d.team2.totalPts,
  gap: d.gap,
}));`,
    sample_data: {
      gw: '10',
      rank_1: '3',
      team_1: 'Always Ready',
      pts_1: '699',
      rank_2: '4',
      team_2: 'Blackswann',
      pts_2: '697',
      gap: '2',
    },
  },
  {
    no: 79,
    id: 'CF_LINEUP_BENCH_POINTS',
    gw_phase: 'Confirmed',
    category: 'Lineup',
    subcategory: 'Bench',
    title: 'Points on Bench',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mencadangkan [P:{player}] ([C:{club}]) saat sang pemain mendulang [N:{points} Poin].

[Kondisi: Multi Tim]
{teams} mencadangkan [P:{player}] ([C:{club}]) yang mengemas [N:{points} Poin].`,
    example: '',
    code: `if (group.teamCount >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(group.teams),
    player: group.player,
    club: group.club,
    points: group.playerPts,
    gw,
  });
}
return renderTemplate(template.single, {
  team: singleBench.team,
  player: singleBench.player,
  club: singleBench.club,
  points: singleBench.playerPts,
  gw,
});`,
    sample_data: {
      team: 'Garuda FC',
      teams: '[T:Sunda Kelapa], [T:Bintang Timur], dan [N:6] tim lainnya',
      player: 'Muharemović',
      club: 'Leeds',
      points: '10',
      gw: '10',
    },
  },
  {
    no: 94,
    id: 'CF_CAPTAIN_VICE_CAPTAIN',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Vice-Captain',
    title: 'Vice-Captain',
    output: 'MULTI-NEWS',
    template: `[T:{team}] resmi menerima pengalihan poin kapten dari wakil kapten [P:{vice_captain}] ([N:{vice_pts} Poin]) setelah [P:{captain_dnp}] absen bermain.`,
    example: '',
    code: `if (capStat.minutes === 0 && vcStat.minutes > 0) {
  return renderTemplate(template, {
    team: manager.entry_name,
    vice_captain: vcStat.name,
    vice_pts: vcStat.points * (isTc ? 3 : 2),
    captain_dnp: capStat.name,
  });
}`,
    sample_data: {
      team: 'AHAY JEBRET',
      vice_captain: 'Haaland',
      vice_pts: '4',
      captain_dnp: 'João Pedro',
    },
  },
  {
    no: 95,
    id: 'CF_CAPTAIN_DIFFERENTIAL_RETURN',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Differential',
    title: 'Differential Captain Return',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kapten Eksklusif (1 Tim)]
[T:{team}] mengoleksi [N:{pts} Poin] dari [P:{captain}] ([C:{club}]) sebagai satu-satunya tim yang menjadikannya kapten.

[Kondisi: Kapten Differential]
[T:{team}] mengoleksi [N:{pts} Poin] dari kapten differential [P:{captain}] ([C:{club}]) yang hanya dipilih [N:{pickers_count}] tim.`,
    example: '',
    code: `// Sorot kapten differential (< 5% atau <= 2 pemilih) yang menutup pekan dengan >= 8 poin dasar.
if (cap.isDiff && capStat.points >= 8) {
  const tmplBranch = pickersCount === 1 ? template.exclusive : template.differential;
  return renderTemplate(tmplBranch, {
    team: manager.entry_name,
    pts: capStat.points * (isTc ? 3 : 2),
    captain: capStat.name,
    club: capStat.club,
    pickers_count: pickersCount,
  });
}`,
    sample_data: {
      team: 'Bintang Timur',
      pts: '22',
      captain: 'N.Jackson',
      club: 'Aston Villa',
      pickers_count: '2',
    },
  },
  {
    no: 96,
    id: 'CF_TRANSFER_IN_MOST_BOUGHT',
    gw_phase: 'Confirmed',
    category: 'Transfer',
    subcategory: 'Transfers In',
    title: 'Most Bought',
    output: 'SINGLE-NEWS',
    template: `[P:{player1}] ([N:{count1}] pembelian) menutup pekan dengan [N:{pts1} Poin], sementara rekrutan terpopuler kedua [P:{player2}] ([N:{count2}] pembelian) meraih [N:{pts2} Poin].`,
    example: '',
    code: `const topIn = snap.transfers_in.slice(0, 2);
return renderTemplate(template, {
  player1: topIn[0].web_name,
  count1: topIn[0].transfer_count,
  pts1: getFinalPts(topIn[0].id),
  player2: topIn[1].web_name,
  count2: topIn[1].transfer_count,
  pts2: getFinalPts(topIn[1].id),
});`,
    sample_data: {
      player1: 'Van Hecke',
      count1: '15',
      pts1: '4',
      player2: 'Evanilson',
      count2: '14',
      pts2: '9',
    },
  },
  {
    no: 97,
    id: 'CF_MATCH_CLEAN_SHEET',
    gw_phase: 'Confirmed',
    category: 'Match',
    subcategory: 'Clean Sheet',
    title: 'Clean Sheet',
    output: 'MULTI-NEWS',
    template: `[C:{club}] mengunci clean sheet saat menghadapi [C:{opponent}] ([N:{score}]), menghadirkan poin resmi bagi [N:{owners_count}] pemilik [P:{defender}].`,
    example: '',
    code: `return renderTemplate(template, {
  club: match.club,
  opponent: match.opponent,
  score: match.score,
  owners_count: topDef.ownersCount,
  defender: topDef.name,
});`,
    sample_data: {
      club: 'Arsenal',
      opponent: 'Hull City',
      score: '1 - 0',
      owners_count: '28',
      defender: 'Calafiori',
    },
  },
  {
    no: 98,
    id: 'CF_LINEUP_DIFFERENTIAL_RETURN',
    gw_phase: 'Confirmed',
    category: 'Lineup',
    subcategory: 'Differential',
    title: 'Differential XI Return',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] menuai [N:{points} Poin] dari starter differential [P:{player}] ([C:{club}], kepemilikan [N:{ownership_pct}%]).

[Kondisi: Multi Tim]
{teams} menuai [N:{points} Poin] dari starter differential [P:{player}] ([C:{club}], kepemilikan [N:{ownership_pct}%]).`,
    example: '',
    code: `// Sorot starter differential (< 5% kepemilikan) yang meraih >= 8 poin resmi.
if (starterOwners.length >= 2) {
  return renderTemplate(template.multi, {
    teams: formatTeamList(starterOwners),
    points: player.points,
    player: player.name,
    club: player.club,
    ownership_pct: player.ownershipPct,
  });
}
return renderTemplate(template.single, {
  team: starterOwners[0],
  points: player.points,
  player: player.name,
  club: player.club,
  ownership_pct: player.ownershipPct,
});`,
    sample_data: {
      team: 'Garuda FC',
      teams: '[T:Sunda Kelapa], [T:Bintang Timur], dan [N:2] tim lainnya',
      points: '13',
      player: 'Wirtz',
      club: 'Liverpool',
      ownership_pct: '1',
    },
  },
  {
    no: 99,
    id: 'CF_MATCH_BONUS_POINTS',
    gw_phase: 'Confirmed',
    category: 'Match',
    subcategory: 'Bonus',
    title: 'Bonus Points',
    output: 'SINGLE-NEWS',
    template: `[P:{player}] ([C:{club}]) mencatat skor tertinggi [N:{bps} BPS] pada Gameweek [N:{gw}] dan mengunci [N:+3 Poin Bonus] resmi ([N:{points} Poin]) bagi [N:{owners_count}] tim.`,
    example: '',
    code: `const topBps = getHighestBpsPlayer(gw);
return renderTemplate(template, {
  player: topBps.name,
  club: topBps.club,
  bps: topBps.bps,
  gw,
  points: topBps.points,
  owners_count: topBps.ownersCount,
});`,
    sample_data: {
      player: 'Barry',
      club: 'Everton',
      bps: '59',
      gw: '10',
      points: '16',
      owners_count: '9',
    },
  },
  {
    no: 100,
    id: 'CF_MATCH_DEFENSIVE_CONTRIBUTION',
    gw_phase: 'Confirmed',
    category: 'Match',
    subcategory: 'Defensive',
    title: 'Defensive Contribution',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: 1 Pemain]
[P:{player}] ([C:{club}]) resmi mengamankan [N:+2 Poin] Defensive Contribution lewat [N:{dc_count} Aksi Defensif] bagi [N:{owners_count}] pemilik.

[Kondisi: Multi Pemain]
Sebanyak [N:{count}] pemain, dipimpin [P:{player}] ([C:{club}], [N:{dc_count} Aksi Defensif]), resmi meraih [N:+2 Poin] Defensive Contribution pada Gameweek [N:{gw}].`,
    example: '',
    code: `const dcQualifiers = getOfficialDcBonusQualifiers(gw);
if (dcQualifiers.length === 1) {
  const p = dcQualifiers[0];
  return renderTemplate(template.single, {
    player: p.name,
    club: p.club,
    dc_count: p.dcCount,
    owners_count: p.ownersCount,
  });
}
const leader = dcQualifiers[0];
return renderTemplate(template.multi, {
  count: dcQualifiers.length,
  player: leader.name,
  club: leader.club,
  dc_count: leader.dcCount,
  gw,
});`,
    sample_data: {
      player: 'Branthwaite',
      club: 'Everton',
      dc_count: '14',
      owners_count: '8',
      count: '12',
      gw: '10',
    },
  },
  {
    no: 101,
    id: 'CF_PLAYER_AVAILABILITY_IMPACT',
    gw_phase: 'Confirmed',
    category: 'Player',
    subcategory: 'Availability',
    title: 'Suspensions & Injuries',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kartu Merah & Suspensi]
[P:{player}] ([C:{club}]) menerima kartu merah ([N:-3 Poin]) saat menghadapi [C:{opponent}] dan terancam sanksi larangan bermain bagi [N:{owners_count}] pemilik.

[Kondisi: Cedera]
[P:{player}] ([C:{club}]) mengalami cedera saat melawan [C:{opponent}], berdampak ke [N:{owners_count}] pemilik menuju pekan berikutnya.`,
    example: '',
    code: `// Sorot pemain pemilik liga yang mendapat kartu merah/suspensi atau cedera pada GW berjalan.
return renderTemplate(isRed ? template.red : template.injury, {
  player: item.name,
  club: item.club,
  opponent: item.opponent,
  owners_count: item.ownersCount,
});`,
    sample_data: {
      player: 'Thiago',
      club: 'Brentford',
      opponent: 'Brighton',
      owners_count: '4',
    },
  },
];

export function getPhase1Templates(): Phase1TemplateItem[] {
  const defaultTimestamp = new Date().toISOString();
  const baseDefaults = DEFAULT_PHASE1_TEMPLATES.map((def) => ({
    ...def,
    title: String(def.title || '').trim(),
    gw: def.gw || 10,
    timestamp: def.timestamp || def.updated_at || defaultTimestamp,
    source: def.source || 'Sys',
    output: def.output || ((def.gw_phase === 'Live Match' || def.id === 'NS_PLAYER_AVAILABILITY_FLAGGED' || def.title === 'Flagged Players' || def.subcategory === 'Flagged Players') ? 'MULTI-NEWS' : 'SINGLE-NEWS'),
    example: interpolateExample(def.template, def.sample_data),
  }));

  try {
    if (fs.existsSync(TEMPLATES_FILE_PATH)) {
      const raw = fs.readFileSync(TEMPLATES_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const canFallbackMatchByNo = parsed.length === baseDefaults.length;
        return baseDefaults.map((def) => {
          const custom = parsed.find((p: any) => p.id === def.id || (canFallbackMatchByNo && p.no === def.no));
          if (custom) {
            const tmpl = custom.template || def.template;
            const gwPhase = custom.gw_phase || def.gw_phase;
            const isLive = (gwPhase || '').trim().toLowerCase() === 'live match';
            const resolvedOutput = String(
              custom.output ||
              def.output ||
              (isLive || def.id === 'NS_PLAYER_AVAILABILITY_FLAGGED' || def.title === 'Flagged Players' || def.subcategory === 'Flagged Players'
                ? 'MULTI-NEWS'
                : 'SINGLE-NEWS')
            ).trim();

            return {
              ...def,
              ...custom,
              id: def.id,
              no: def.no,
              gw_phase: String(gwPhase).trim(),
              category: String(custom.category || def.category).trim(),
              subcategory: String(custom.subcategory || def.subcategory).trim(),
              title: String(custom.title ?? def.title ?? '').trim(),
              output: resolvedOutput,
              gw: Number(custom.gw) || def.gw || 10,
              timestamp: custom.timestamp || custom.updated_at || def.timestamp || defaultTimestamp,
              source: custom.source || def.source || 'Sys',
              template: tmpl,
              example: interpolateExample(tmpl, custom.sample_data || def.sample_data),
            };
          }
          return def;
        });
      }
    }
  } catch (err: any) {
    console.warn('[Phase1Templates] Error reading custom templates:', err.message);
  }
  return baseDefaults;
}

function escapeTemplateLiteral(val: string): string {
  return String(val || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function syncTemplatesToSourceTs(items: Phase1TemplateItem[]): void {
  try {
    const sourceTsPath = path.join(process.cwd(), 'src/data/phase1Templates.ts');
    if (!fs.existsSync(sourceTsPath)) return;
    let source = fs.readFileSync(sourceTsPath, 'utf-8');
    if (!source.includes('export const DEFAULT_PHASE1_TEMPLATES')) return;

    let changed = false;
    for (const item of items) {
      if (!item?.id) continue;
      const escapedId = item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blockRegex = new RegExp(
        `(\\{\\s*no:\\s*\\d+,\\s*id:\\s*'${escapedId}'[\\s\\S]*?\\n\\s*example:)`,
        'm'
      );
      const match = blockRegex.exec(source);
      if (!match) continue;

      let block = match[1];
      const origBlock = block;

      block = block.replace(/(\bgw_phase:\s*)(['"`])[\s\S]*?\2/, `$1'${String(item.gw_phase || '').trim().replace(/'/g, "\\'")}'`);
      block = block.replace(/(\bcategory:\s*)(['"`])[\s\S]*?\2/, `$1'${String(item.category || '').trim().replace(/'/g, "\\'")}'`);
      block = block.replace(/(\bsubcategory:\s*)(['"`])[\s\S]*?\2/, `$1'${String(item.subcategory || '').trim().replace(/'/g, "\\'")}'`);

      const titleVal = String(item.title || '').trim().replace(/'/g, "\\'");
      if (/\btitle:\s*/.test(block)) {
        block = block.replace(/(\btitle:\s*)(['"`])[\s\S]*?\2/, `$1'${titleVal}'`);
      } else {
        block = block.replace(/(\bsubcategory:\s*[^\n]+,\n)/, `$1    title: '${titleVal}',\n`);
      }

      const outVal = String(item.output || 'SINGLE-NEWS').trim().replace(/'/g, "\\'");
      if (/\boutput:\s*/.test(block)) {
        block = block.replace(/(\boutput:\s*)(['"`])[\s\S]*?\2/, `$1'${outVal}'`);
      } else {
        block = block.replace(/(\btitle:\s*[^\n]+,\n)/, `$1    output: '${outVal}',\n`);
      }

      const escapedTmpl = escapeTemplateLiteral(item.template || '');
      block = block.replace(
        /(\btemplate:\s*)(?:`(?:\\[\s\S]|[^`])*`|'(?:\\[\s\S]|[^'])*'|"(?:\\[\s\S]|[^"])*")/,
        `$1\`${escapedTmpl}\``
      );

      if (block !== origBlock) {
        source = source.slice(0, match.index) + block + source.slice(match.index + match[1].length);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(sourceTsPath, source, 'utf-8');
    }
  } catch (err: any) {
    console.warn('[Phase1Templates] Could not sync edits to phase1Templates.ts:', err.message);
  }
}

export function savePhase1Templates(items: Phase1TemplateItem[]): boolean {
  try {
    const saveTime = new Date().toISOString();
    const defaultsById = new Map(DEFAULT_PHASE1_TEMPLATES.map((d) => [d.id, d]));
    const enriched = items.map((item) => {
      const def = defaultsById.get(item.id);
      const gwPhase = String(item.gw_phase || def?.gw_phase || 'Not started').trim();
      const isLive = gwPhase.toLowerCase() === 'live match';
      const tmplText = String(item.template ?? def?.template ?? '').replace(/\r\n/g, '\n');
      const sampleData = item.sample_data || def?.sample_data || {};
      return {
        ...def,
        ...item,
        gw_phase: gwPhase,
        category: String(item.category || def?.category || '').trim(),
        subcategory: String(item.subcategory || def?.subcategory || '').trim(),
        title: String(item.title ?? def?.title ?? '').trim(),
        output: String(item.output || def?.output || (isLive ? 'MULTI-NEWS' : 'SINGLE-NEWS')).trim(),
        gw: Number(item.gw) || def?.gw || 10,
        timestamp: item.timestamp || item.updated_at || saveTime,
        source: item.source || def?.source || 'Sys',
        template: tmplText,
        example: interpolateExample(tmplText, sampleData),
        sample_data: sampleData,
        updated_at: saveTime,
      };
    });
    fs.mkdirSync(path.dirname(TEMPLATES_FILE_PATH), { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE_PATH, JSON.stringify(enriched, null, 2), 'utf-8');
    syncTemplatesToSourceTs(enriched);
    return true;
  } catch (err: any) {
    console.error('[Phase1Templates] Failed to save templates:', err);
    return false;
  }
}

export function resetPhase1Templates(): Phase1TemplateItem[] {
  try {
    if (fs.existsSync(TEMPLATES_FILE_PATH)) {
      fs.unlinkSync(TEMPLATES_FILE_PATH);
    }
  } catch {}
  return DEFAULT_PHASE1_TEMPLATES;
}
