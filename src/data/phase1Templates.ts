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
    id: 'NS_MATCH_FIXTURE',
    gw_phase: 'Not started',
    category: 'Match Event',
    subcategory: 'Fixture',
    template: `[Kondisi: 1 Laga]
Laga pembuka Gameweek [N:{gw}] pada pukul [N:{kickoff_time}] menyajikan duel antara [C:{home_club}] vs [C:{away_club}].

[Kondisi: Multi Laga]
Gameweek [N:{gw}] dibuka serentak oleh {count} pertandingan pada pukul [N:{kickoff_time}], mempertemukan {matches_list}.`,
    example: '',
    code: `const fixtures = getUpcomingOpeningFixtures(gw);
if (fixtures.length === 1) {
  const f = fixtures[0];
  return renderTemplate(template.single, {
    gw,
    kickoff_time: f.kickoffTime,
    home_club: f.homeClub,
    away_club: f.awayClub,
  });
}
const listStr = fixtures.map((f, i) => {
  const pair = \`[C:\${f.homeClub}] vs [C:\${f.awayClub}]\`;
  return i === fixtures.length - 1 ? \`dan \${pair}\` : pair;
}).join(', ');

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
      matches_list: '[C:Leicester] vs [C:Nott\'m Forest], [C:Aston Villa] vs [C:Bournemouth], [C:Brentford] vs [C:Ipswich], [C:Brighton] vs [C:Wolves], dan [C:Man City] vs [C:Southampton]',
    },
  },
  {
    no: 2,
    id: 'NS_CHIP_WILDCARD',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Wildcard',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Wildcard] pada Gameweek [N:{gw}], dengan mendatangkan [P:{player_in}] dan melepas [P:{player_out}].

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Wildcard] pada Gameweek [N:{gw}], dengan [P:{player_in}] menjadi pemain yang paling banyak didatangkan dan [P:{player_out}] paling banyak dilepas.`,
    example: '',
    code: `const wcTeams = getManagersUsingChip(gw, 'wildcard');
if (wcTeams.length === 0) return null;

const topIn = getMostTransferredInByTeams(wcTeams, gw);
const topOut = getMostTransferredOutByTeams(wcTeams, gw);

if (wcTeams.length === 1) {
  return renderTemplate(template.single, {
    team: wcTeams[0].name,
    gw,
    player_in: topIn.name,
    player_out: topOut.name,
  });
}

const teamsStr = formatTeamList(wcTeams.map(t => t.name));
return renderTemplate(template.multi, {
  teams: teamsStr,
  gw,
  player_in: topIn.name,
  player_out: topOut.name,
});`,
    sample_data: {
      team: 'Thor',
      teams: '[T:Garuda FC] dan [T:Bintang Timur]',
      gw: '9',
      player_in: 'Isak',
      player_out: 'João Pedro',
    },
  },
  {
    no: 3,
    id: 'NS_CHIP_FREEHIT',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Free Hit',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Free Hit] pada Gameweek [N:{gw}], dengan memboyong [P:{player_in}] dan melepas [P:{player_out}].

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Free Hit] pada Gameweek [N:{gw}], dengan [P:{player_in}] menjadi pemain yang paling banyak didatangkan dan [P:{player_out}] paling banyak dilepas.`,
    example: '',
    code: `const fhTeams = getManagersUsingChip(gw, 'freehit');
if (fhTeams.length === 0) return null;

const topIn = getMostTransferredInByTeams(fhTeams, gw);
const topOut = getMostTransferredOutByTeams(fhTeams, gw);

if (fhTeams.length === 1) {
  return renderTemplate(template.single, {
    team: fhTeams[0].name,
    gw,
    player_in: topIn.name,
    player_out: topOut.name,
  });
}

const teamsStr = formatTeamList(fhTeams.map(t => t.name));
return renderTemplate(template.multi, {
  teams: teamsStr,
  gw,
  player_in: topIn.name,
  player_out: topOut.name,
});`,
    sample_data: {
      team: 'Singa FC',
      teams: '[T:Singa FC] dan [T:Harimau Jaya]',
      gw: '9',
      player_in: 'Salah',
      player_out: 'Son',
    },
  },
  {
    no: 4,
    id: 'NS_CHIP_BENCH_BOOST',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Bench Boost',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Bench Boost] pada Gameweek [N:{gw}], dengan mengandalkan [P:{player_bench}] di bangku cadangan.

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Bench Boost] pada Gameweek [N:{gw}], dengan [P:{player_bench}] menjadi pilihan terbanyak di bangku cadangan.`,
    example: '',
    code: `const bbTeams = getManagersUsingChip(gw, 'bboost');
if (bbTeams.length === 0) return null;

if (bbTeams.length === 1) {
  const topBench = getTopBenchPlayer(bbTeams[0], gw, ['cost', 'total_points', 'form']);
  return renderTemplate(template.single, {
    team: bbTeams[0].name,
    gw,
    player_bench: topBench.name,
  });
}

const teamsStr = formatTeamList(bbTeams.map(t => t.name));
const topBenchPlayer = getMostBenchedPlayerAcrossTeams(bbTeams, gw);
return renderTemplate(template.multi, {
  teams: teamsStr,
  gw,
  player_bench: topBenchPlayer.name,
});`,
    sample_data: {
      team: 'Sumber Bahagia Motor',
      teams: '[T:Sumber Bahagia Motor] dan [T:Petrikor]',
      gw: '9',
      player_bench: 'Groß',
    },
  },
  {
    no: 5,
    id: 'NS_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Triple Captain',
    template: `[Kondisi: 1 Tim]
[T:{team}] mengaktifkan [N:Triple Captain] pada Gameweek [N:{gw}], dengan mempercayakan ban kapten kepada [P:{captain}].

[Kondisi: Multi Tim]
{teams} mengaktifkan [N:Triple Captain] pada Gameweek [N:{gw}] dengan mengandalkan [P:{dominant_captain}]{others_clause}.`,
    example: '',
    code: `const tcTeams = getManagersUsingChip(gw, '3xc');
if (tcTeams.length === 0) return null;

if (tcTeams.length === 1) {
  const cap = getTeamCaptain(tcTeams[0].id, gw);
  return renderTemplate(template.single, {
    team: tcTeams[0].name,
    captain: cap.name,
    gw,
  });
}

const captainDistribution = getCaptainDistribution(tcTeams, gw);
const dominant = captainDistribution[0];
const dominantTeams = tcTeams.filter(t => t.captainId === dominant.playerId);
const othersCount = tcTeams.length - dominantTeams.length;

const teamsStr = formatTeamList(dominantTeams.map(t => t.name));
const othersClause = othersCount > 0 
  ? formatOthersCaptainSummary(othersCount) 
  : '';

return renderTemplate(template.multi, {
  teams: teamsStr,
  dominant_captain: dominant.playerName,
  gw,
  others_clause: othersClause,
});`,
    sample_data: {
      team: 'cilukba',
      captain: 'Haaland',
      teams: '[T:Elang Jawa] dan [T:Badak Perkasa]',
      dominant_captain: 'Haaland',
      gw: '9',
      others_clause: ', sementara [N:2] tim lainnya memilih opsi kapten berbeda',
    },
  },
  {
    no: 6,
    id: 'NS_CHIP_RECAP',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Chip Recap',
    template: 'Hingga Gameweek [N:{gw}], akumulasi penggunaan chip FNB League mencakup {chips_summary}.',
    example: '',
    code: `const recap = getSeasonChipUsageStats(gw);
const summary = buildChipAccumulationSummary(recap);

return renderTemplate(template, {
  gw,
  chips_summary: summary,
});`,
    sample_data: {
      gw: '9',
      chips_summary: '[N:Wildcard] [N:14] (+[N:2] pekan ini), [N:Free Hit] [N:8] (+[N:1] pekan ini), [N:Bench Boost] [N:6], dan [N:Triple Captain] [N:12] (+[N:3] pekan ini)',
    },
  },
  {
    no: 7,
    id: 'NS_TRANSFER_IN',
    gw_phase: 'Not started',
    category: 'Transfer',
    subcategory: 'Most Transferred In',
    template: 'Aktivitas transfer masuk pada Gameweek [N:{gw}] didominasi oleh [P:{player1}] dengan [N:{count1}] pembelian, dan [P:{player2}] dengan [N:{count2}] pembelian.',
    example: 'Aktivitas transfer masuk pada Gameweek [N:9] didominasi oleh [P:Palmer] dengan [N:12] pembelian, dan [P:Saka] dengan [N:8] pembelian.',
    code: `const topIn = getTopTransferredInPlayers(gw, 2);
if (topIn.length < 2) return null;

return renderTemplate(template, {
  gw,
  player1: topIn[0].name,
  count1: topIn[0].count,
  player2: topIn[1].name,
  count2: topIn[1].count,
});`,
    sample_data: {
      gw: '9',
      player1: 'Palmer',
      count1: '12',
      player2: 'Saka',
      count2: '8',
    },
  },
  {
    no: 8,
    id: 'NS_TRANSFER_OUT',
    gw_phase: 'Not started',
    category: 'Transfer',
    subcategory: 'Most Transferred Out',
    template: 'Pelepasan pemain terbanyak pada Gameweek [N:{gw}] dialami oleh [P:{player1}] dan [P:{player2}], yang masing-masing dilepas oleh [N:{count1}] dan [N:{count2}] tim.',
    example: 'Pelepasan pemain terbanyak pada Gameweek [N:9] dialami oleh [P:Son] dan [P:Isak], yang masing-masing dilepas oleh [N:9] dan [N:7] tim.',
    code: `const topOut = getTopTransferredOutPlayers(gw, 2);
if (topOut.length < 2) return null;

return renderTemplate(template, {
  gw,
  player1: topOut[0].name,
  count1: topOut[0].count,
  player2: topOut[1].name,
  count2: topOut[1].count,
});`,
    sample_data: {
      gw: '9',
      player1: 'Son',
      count1: '9',
      player2: 'Isak',
      count2: '7',
    },
  },
  {
    no: 9,
    id: 'NS_CAPTAIN_RECAP',
    gw_phase: 'Not started',
    category: 'Captain',
    subcategory: 'Most Captained',
    template: '[P:{dominant_captain}] mengemban tanggung jawab besar pada ban kapten yang disematkan di lengannya oleh [N:{count1}] tim{second_clause}{others_clause}.',
    example: '[P:Haaland] mengemban tanggung jawab besar pada ban kapten yang disematkan di lengannya oleh [N:10] tim, disusul [P:Saka] dengan [N:7] tim, sementara [N:4] tim lainnya memilih kapten alternatif.',
    code: `const capStats = getLeagueCaptaincyStats(gw);
if (capStats.length === 0) return null;

const dominant = capStats[0];
const second = capStats[1];
const othersCount = capStats.slice(2).reduce((sum, item) => sum + item.count, 0);

return renderTemplate(template, {
  gw,
  dominant_captain: dominant.playerName,
  count1: dominant.count,
  second_clause: second ? \`, disusul [P:\${second.playerName}] dengan [N:\${second.count}] tim\` : '',
  others_clause: othersCount > 0 ? \`, sementara [N:\${othersCount}] tim lainnya memilih kapten alternatif\` : '',
});`,
    sample_data: {
      gw: '9',
      dominant_captain: 'Haaland',
      count1: '10',
      player2: 'Saka',
      count2: '7',
      count_others: '4',
      second_clause: ', disusul [P:Saka] dengan [N:7] tim',
      others_clause: ', sementara [N:4] tim lainnya memilih kapten alternatif',
    },
  },
  {
    no: 10,
    id: 'NS_HITS_RECAP',
    gw_phase: 'Not started',
    category: 'Hits',
    subcategory: 'Most Hits',
    template: 'Langkah agresif di bursa transfer diambil {teams_with_hits} yang rela mengawali pekan ini dengan modal pengurangan poin.',
    example: 'Langkah agresif di bursa transfer diambil [T:Garuda FC] (-[N:8 Poin]), [T:Bintang Timur] (-[N:4 Poin]), dan [N:3] tim lainnya yang rela mengawali pekan ini dengan modal pengurangan poin.',
    code: `const teamsWithHits = getTeamsWithTransferHits(gw);
if (teamsWithHits.length === 0) return null;

// Format daftar tim dengan penalti minus poin masing-masing (serta diganti dan)
const teamsFormatted = formatTeamsListWithPointsDeduction(teamsWithHits);

return renderTemplate(template, {
  teams_with_hits: teamsFormatted,
});`,
    sample_data: {
      teams_with_hits: '[T:Garuda FC] (-[N:8 Poin]), [T:Bintang Timur] (-[N:4 Poin]), dan [N:3] tim lainnya',
    },
  },
  {
    no: 11,
    id: 'NS_MOST_OWNED',
    gw_phase: 'Not started',
    category: 'Player',
    subcategory: 'Most Owned',
    template: '[P:{player1}] menjadi pemain dengan kepemilikan tertinggi di FNB League saat ini dengan [N:{pct1}%] kepemilikan. Disusul oleh [P:{player2}] dengan [N:{pct2}%] kepemilikan.',
    example: '[P:Haaland] menjadi pemain dengan kepemilikan tertinggi di FNB League saat ini dengan [N:88%] kepemilikan. Disusul oleh [P:Saka] dengan [N:74%] kepemilikan.',
    code: `const topOwned = getLeagueOwnershipList(gw, 2);
if (topOwned.length < 2) return null;

return renderTemplate(template, {
  player1: topOwned[0].name,
  pct1: topOwned[0].ownershipPercentage,
  player2: topOwned[1].name,
  pct2: topOwned[1].ownershipPercentage,
});`,
    sample_data: {
      player1: 'Haaland',
      pct1: '88',
      player2: 'Saka',
      pct2: '74',
    },
  },
  {
    no: 12,
    id: 'NS_DIFFERENTIAL_XI',
    gw_phase: 'Not started',
    category: 'Starting XI',
    subcategory: 'Differential XI',
    template: `[Kondisi: 1 Pemain]
Pilihan taktis diambil [T:{team}] pada Gameweek [N:{gw}] dengan menurunkan [P:{player1}] ([N:{pct1}%] kepemilikan) sebagai pembeda di starting XI.

[Kondisi: 2 Pemain]
Pilihan taktis diambil [T:{team}] pada Gameweek [N:{gw}] dengan menurunkan [P:{player1}] ([N:{pct1}%] kepemilikan) dan [P:{player2}] ([N:{pct2}%] kepemilikan) sebagai pembeda di starting XI.`,
    example: 'Pilihan taktis diambil [T:Kuda Hitam] pada Gameweek [N:9] dengan menurunkan [P:Kluivert] ([N:3%] kepemilikan) dan [P:Welbeck] ([N:4%] kepemilikan) sebagai pembeda di starting XI.',
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
    gw,
    player1: topDiffs[0].name,
    pct1: topDiffs[0].ownershipPct,
  });
}
return renderTemplate(template.multi, {
  team: topTeam.name,
  gw,
  player1: topDiffs[0].name,
  pct1: topDiffs[0].ownershipPct,
  player2: topDiffs[1].name,
  pct2: topDiffs[1].ownershipPct,
});`,
    sample_data: {
      team: 'Kuda Hitam',
      gw: '9',
      player1: 'Kluivert',
      pct1: '3',
      player2: 'Welbeck',
      pct2: '4',
    },
  },
  {
    no: 13,
    id: 'NS_DIFFERENTIAL_CAPTAIN',
    gw_phase: 'Not started',
    category: 'Captain',
    subcategory: 'Differential Captain',
    template: `[Kondisi: Kapten Eksklusif (1 Tim)]
Langkah berani diambil [T:{team}] di Gameweek [N:{gw}], dengan menjadi satu-satunya tim di liga yang mempercayakan ban kapten kepada [P:{captain}].

[Kondisi: Kapten Differential (< 5%)]
Langkah berani diambil [T:{team}] di Gameweek [N:{gw}], dengan mempercayakan ban kapten kepada [P:{captain}] yang hanya dipilih oleh [N:{pickers_count}] tim di liga.`,
    example: 'Langkah berani diambil [T:Sunda Kelapa] di Gameweek [N:9], dengan menjadi satu-satunya tim di liga yang mempercayakan ban kapten kepada [P:Bowen].',
    code: `// Single News: Pilih 1 tim dengan kapten paling langka (< 5%), seleksi via Opsi B (Least Featured)
const diffCaptains = getDifferentialCaptains(gw, 0.05);
if (diffCaptains.length === 0) return null;

// Urutkan kapten terlangka (count terkecil, cost termahal)
const topCap = diffCaptains[0];
const candidateTeams = getTeamsCaptainPickers(topCap.id, gw);
const selectedTeam = sortByLeastFeaturedTeam(candidateTeams)[0];

if (topCap.pickersCount === 1) {
  return renderTemplate(template.exclusive, {
    team: selectedTeam.name,
    captain: topCap.name,
    gw,
  });
}
return renderTemplate(template.differential, {
  team: selectedTeam.name,
  captain: topCap.name,
  pickers_count: topCap.pickersCount,
  gw,
});`,
    sample_data: {
      team: 'Sunda Kelapa',
      captain: 'Bowen',
      gw: '9',
      pickers_count: '2',
    },
  },
  {
    no: 14,
    id: 'NS_INJURY_UPDATE',
    gw_phase: 'Not started',
    category: 'Player',
    subcategory: 'Flagged Players',
    template: `[Kondisi: Dipastikan Absen]
Kabar buruk bagi [N:{owners_count}] tim pemilik [P:{player}] ([C:{club}]). Sang pemain dipastikan absen pada Gameweek [N:{gw}] akibat {injury_desc}.

[Kondisi: Meragukan]
Kekhawatiran melanda [N:{owners_count}] tim pemilik [P:{player}] ([C:{club}]). Sang pemain mengalami {injury_desc} dan diragukan tampil pada Gameweek [N:{gw}].`,
    example: 'Kabar buruk bagi [N:35] tim pemilik [P:João Pedro] ([C:CHE]). Sang pemain dipastikan absen pada Gameweek [N:9] akibat cedera paha.',
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
  gw,
});`,
    sample_data: {
      owners_count: '35',
      player: 'João Pedro',
      club: 'CHE',
      injury_desc: 'cedera paha',
      gw: '9',
    },
  },
  {
    no: 15,
    id: 'NS_TOP_RIVALRY',
    gw_phase: 'Not started',
    category: 'Standings',
    subcategory: 'Top Rivalry',
    template: `[Kondisi: Kapten Berbeda]
Persaingan di puncak klasemen pada Gameweek [N:{gw}]. Sang pemuncak [T:{team1}] memimpin dengan keunggulan [N:{margin} Poin] atas [T:{team2}], di mana duel taktis terjadi lewat perbedaan pilihan kapten antara [P:{captain1}] kontra [P:{captain2}].

[Kondisi: Kapten Sama]
Perebutan posisi puncak klasemen pada Gameweek [N:{gw}]. [T:{team1}] berupaya menjaga keunggulan [N:{margin} Poin] dari kejaran [T:{team2}], saat kedua manajer sama-sama mempercayakan ban kapten kepada [P:{captain}]. Persaingan ditentukan oleh pembeda starting XI, bertumpu pada [P:{diff_player1}] di kubu [T:{team1}] kontra [P:{diff_player2}] di kubu [T:{team2}].

[Kondisi: Manuver Chip]
Manuver krusial perebutan tahta puncak klasemen pada Gameweek [N:{gw}]. [T:{team_chip}] mengaktifkan [N:{chip}] guna {target_clause} selisih [N:{margin} Poin] dengan [T:{team_rival}].`,
    example: 'Persaingan di puncak klasemen pada Gameweek [N:9]. Sang pemuncak [T:Sunda Kelapa] memimpin dengan keunggulan [N:14 Poin] atas [T:Bintang Timur], di mana duel taktis terjadi lewat perbedaan pilihan kapten antara [P:Haaland] kontra [P:Salah].',
    code: `const standings = getStandings(gw > 1 ? gw - 1 : gw);
if (standings.length < 2) return null;

const leader = standings[0];
const chaser = standings[1];
const margin = Math.abs(leader.totalPoints - chaser.totalPoints);

const chipLeader = getActiveChip(leader.id, gw);
const chipChaser = getActiveChip(chaser.id, gw);

if (chipLeader || chipChaser) {
  const isLeaderChip = !!chipLeader;
  const chipTeam = isLeaderChip ? leader : chaser;
  const rivalTeam = isLeaderChip ? chaser : leader;
  const chipName = chipLeader || chipChaser;
  return renderTemplate(template.chip, {
    gw,
    team_chip: chipTeam.name,
    chip: chipName,
    target_clause: isLeaderChip ? 'memperlebar' : 'memangkas',
    margin,
    team_rival: rivalTeam.name,
  });
}

const capLeader = getTeamCaptain(leader.id, gw);
const capChaser = getTeamCaptain(chaser.id, gw);

if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    gw,
    team1: leader.name,
    margin,
    team2: chaser.name,
    captain1: capLeader.name,
    captain2: capChaser.name,
  });
}

const diffStarters = getTopDifferingStarters(leader.id, chaser.id, gw);

return renderTemplate(template.same_captain, {
  gw,
  team1: leader.name,
  margin,
  team2: chaser.name,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      gw: '9',
      team1: 'Sunda Kelapa',
      team2: 'Bintang Timur',
      margin: '14',
      captain1: 'Haaland',
      captain2: 'Salah',
      captain: 'Haaland',
      diff_player1: 'Palmer',
      diff_player2: 'Mbeumo',
      team_chip: 'Bintang Timur',
      chip: 'Free Hit',
      target_clause: 'memangkas',
      team_rival: 'Sunda Kelapa',
    },
  },
  {
    no: 16,
    id: 'NS_MOST_GW_RIVALRY',
    gw_phase: 'Not started',
    category: 'Standings',
    subcategory: 'Most GW Rivalry',
    template: `[Kondisi: Kapten Berbeda]
Persaingan koleksi gelar juara mingguan pada Gameweek [N:{gw}]. [T:{team1}] ([N:{titles1} Gelar]) dan [T:{team2}] ([N:{titles2} Gelar]) mengadu strategi lewat perbedaan pilihan kapten antara [P:{captain1}] kontra [P:{captain2}].

[Kondisi: Kapten Sama]
Rivalitas perburuan trofi juara mingguan pada Gameweek [N:{gw}]. [T:{team1}] ([N:{titles1} Gelar]) dan [T:{team2}] ([N:{titles2} Gelar]) sama-sama memercayakan ban kapten kepada [P:{captain}], dengan pembeda starting XI bertumpu pada [P:{diff_player1}] di kubu [T:{team1}] kontra [P:{diff_player2}] di kubu [T:{team2}].

[Kondisi: Manuver Chip]
Berambisi menambah koleksi trofi juara mingguan pada Gameweek [N:{gw}], [T:{team_chip}] mengaktifkan [N:{chip}] untuk mengungguli para pesaingnya.`,
    example: 'Persaingan koleksi gelar juara mingguan pada Gameweek [N:9]. [T:Blackswann] ([N:1 Gelar]) dan [T:rdwndvsn] ([N:1 Gelar]) mengadu strategi lewat perbedaan pilihan kapten antara [P:Haaland] kontra [P:Salah].',
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

if (chipLeader || chipChaser) {
  const chipTeam = chipLeader ? leader : chaser;
  const rivalTeam = chipLeader ? chaser : leader;
  const chipName = chipLeader || chipChaser;
  return renderTemplate(template.chip, {
    gw,
    team_chip: chipTeam.name,
    chip: chipName,
    team_rival: rivalTeam.name,
  });
}

const capLeader = getTeamCaptain(leader.id, gw);
const capChaser = getTeamCaptain(chaser.id, gw);

if (capLeader.name !== capChaser.name) {
  return renderTemplate(template.different_captains, {
    gw,
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
  gw,
  team1: leader.name,
  titles1: leader.titles,
  team2: chaser.name,
  titles2: chaser.titles,
  captain: capLeader.name,
  diff_player1: diffStarters.player1,
  diff_player2: diffStarters.player2,
});`,
    sample_data: {
      gw: '9',
      team1: 'Blackswann',
      team2: 'rdwndvsn',
      titles1: '1',
      titles2: '1',
      captain1: 'Haaland',
      captain2: 'Salah',
      captain: 'Haaland',
      diff_player1: 'Mbeumo',
      diff_player2: 'Palmer',
      team_chip: 'Blackswann',
      chip: 'Free Hit',
      team_rival: 'rdwndvsn',
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
    id: 'LM_PERIOD_START',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Period Start',
    template: `[Kondisi: Kickoff Babak 1]
[N:{minute}] Kickoff babak pertama. Pertandingan Gameweek [N:{gw}] antara [C:{home_club}] menghadapi [C:{away_club}] resmi dimulai di [N:{venue}].

[Kondisi: Kickoff Babak 2]
[N:{minute}] Kickoff babak kedua di [N:{venue}], kedudukan [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
    example: '',
    code: `if (event.period === '1') {
  return renderTemplate(template.first_half, {
    minute: "0'",
    gw,
    home_club: match.homeTeam.name,
    away_club: match.awayTeam.name,
    venue: match.ground.name,
  });
}
return renderTemplate(template.second_half, {
  minute: "45'",
  venue: match.ground.name,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
});`,
    sample_data: {
      minute: '0\'',
      gw: '10',
      home_club: 'Nott\'m Forest',
      away_club: 'Man City',
      venue: 'The City Ground',
      home_score: '2',
      away_score: '0',
    },
  },
  {
    no: 18,
    id: 'LM_PERIOD_END',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Period End',
    template: `[Kondisi: Half Time]
[N:{minute}] Peluit jeda babak pertama di [N:{venue}], kedudukan [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Full Time]
[N:{minute}] Peluit panjang akhir laga di [N:{venue}], dengan skor akhir [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}], gol dicetak oleh {goalscorers_list}.`,
    example: '',
    code: `if (event.period === '1') {
  return renderTemplate(template.half_time, {
    minute: event.clock.label || "45+3'",
    venue: match.ground.name,
    home_club: match.homeTeam.name,
    home_score: match.teams[0].score,
    away_score: match.teams[1].score,
    away_club: match.awayTeam.name,
  });
}
const scorersStr = formatScorersWithLeaguePct(getMatchScorers(match.id));
return renderTemplate(template.full_time, {
  minute: event.clock.label || "90+6'",
  venue: match.ground.name,
  home_club: match.homeTeam.name,
  home_score: match.teams[0].score,
  away_score: match.teams[1].score,
  away_club: match.awayTeam.name,
  goalscorers_list: scorersStr,
});`,
    sample_data: {
      minute: '90+6\'',
      venue: 'The City Ground',
      home_club: 'Nott\'m Forest',
      home_score: '3',
      away_score: '1',
      away_club: 'Man City',
      goalscorers_list: '[P:Jair Cunha] ([N:2%]), [P:Delap] ([N:12%]) [N:(2 Gol)], dan [P:Cherki] ([N:4%])',
    },
  },

  // B. Gol & Poin Serangan (Scoring Events)
  {
    no: 19,
    id: 'LM_GOAL_OPEN_PLAY',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Goal',
    template: `[Kondisi: Dengan Assist]
[N:{minute}] Gol untuk [C:{club}]. [P:{scorer}] ([N:{scorer_pct}%]) mencetak gol setelah menerima umpan dari [P:{assister}] ([N:{assister_pct}%]), mengubah skor menjadi [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Tanpa Assist]
[N:{minute}] Gol untuk [C:{club}]. [P:{scorer}] ([N:{scorer_pct}%]) mencetak gol, mengubah skor menjadi [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
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
    id: 'LM_GOAL_PENALTY',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Penalty Goal',
    template: `[N:{minute}] Gol penalti untuk [C:{club}]. [P:{scorer}] ([N:{scorer_pct}%]) berhasil mengeksekusi tendangan penalti, mengubah skor menjadi [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
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
    id: 'LM_OWN_GOAL',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Own Goal',
    template: `[N:{minute}] Gol bunuh diri. Bola masuk ke gawang sendiri setelah mengenai [P:{player}] ([N:{player_pct}%]), mengubah skor menjadi [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].`,
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
    id: 'LM_PENALTY_MISSED',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Penalty Missed',
    template: `[N:{minute}] Eksekusi penalti gagal. Tendangan penalti dari [P:{taker}] ([N:{taker_pct}%]) untuk [C:{club}] tidak menemui sasaran.`,
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
    id: 'LM_PENALTY_SAVED',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Penalty Saved',
    template: `[N:{minute}] Penalti digagalkan. Kiper [P:{keeper}] ([N:{keeper_pct}%]) menepis eksekusi tendangan penalti yang dilepaskan oleh [P:{taker}] ([N:{taker_pct}%]).`,
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
    id: 'LM_PENALTY_AWARDED',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Penalty Awarded',
    template: `[Kondisi: Hadiah Penalti]
[N:{minute}] Hadiah penalti. Wasit menunjuk titik putih untuk [C:{club}] setelah pelanggaran terhadap [P:{fouled_player}] ([N:{fouled_player_pct}%]).

[Kondisi: Penalti Dibatalkan]
[N:{minute}] Penalti dibatalkan. Putusan hadiah penalti untuk [C:{club}] resmi dibatalkan oleh wasit.`,
    example: '',
    code: `if (event.isOverturned) {
  return renderTemplate(template.overturned, {
    minute: event.clock.label,
    club: event.team.name,
  });
}
const fouled = getPlayerFromPulse(event.fouledPersonId);
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
    id: 'LM_CARD_YELLOW',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Yellow Card',
    template: `[N:{minute}] Kartu kuning. Wasit memberikan kartu kuning kepada pemain [C:{club}], [P:{player}] ([N:{player_pct}%]).`,
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
    id: 'LM_CARD_SECOND_YELLOW',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Second Yellow',
    template: `[N:{minute}] Kartu merah akumulasi. [P:{player}] ([N:{player_pct}%]) dari [C:{club}] menerima kartu kuning kedua dan harus meninggalkan lapangan.`,
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
    id: 'LM_CARD_RED_STRAIGHT',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Straight Red Card',
    template: `[N:{minute}] Kartu merah. [P:{player}] ([N:{player_pct}%]) dari [C:{club}] menerima kartu merah langsung dari wasit.`,
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
    id: 'LM_SUBSTITUTION',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Substitution',
    template: `[Kondisi: Pergantian Biasa]
[N:{minute}] Pergantian pemain [C:{club}], [P:{player_on}] ([N:{player_on_pct}%]) masuk menggantikan [P:{player_off}] ([N:{player_off_pct}%]).

[Kondisi: Pemain Bertahan Keluar Menit >= 60 Saat Belum Kebobolan]
[N:{minute}] Pergantian pemain [C:{club}], [P:{player_off}] ([N:{player_off_pct}%]) ditarik keluar dan digantikan oleh [P:{player_on}] ([N:{player_on_pct}%]) setelah mencatat 60 menit bermain tanpa kebobolan.`,
    example: '',
    code: `const pOn = getPlayerFromPulse(event.personIdOn);
const pOff = getPlayerFromPulse(event.personIdOff);
const isDefenderOrGk = ['DEF', 'GKP'].includes(pOff.element_type);
const isCleanSheetLocked = isDefenderOrGk && event.clock.min >= 60 && match.concededBeforeSub === 0;

if (isCleanSheetLocked) {
  return renderTemplate(template.cs_locked, {
    minute: event.clock.label,
    club: event.team.name,
    player_off: pOff.web_name,
    player_off_pct: getLeagueOwnershipPct(pOff.id),
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
  player_off_pct: getLeagueOwnershipPct(pOff.id),
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
    id: 'LM_VAR_REVIEW',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'VAR Decision',
    template: `[Kondisi: Gol Dibatalkan]
[N:{minute}] Gol dari [P:{player}] ([N:{player_pct}%]) untuk [C:{club}] dianulir VAR ({reason}), skor tetap [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Gol Dinyatakan Sah]
[N:{minute}] Gol dari [P:{player}] ([N:{player_pct}%]) untuk [C:{club}] disahkan VAR, skor menjadi [C:{home_club}] [N:{home_score}] - [N:{away_score}] [C:{away_club}].

[Kondisi: Penalti Diberikan]
[N:{minute}] Hadiah penalti diberikan kepada [C:{club}] setelah tinjauan VAR atas pelanggaran di kotak terlarang.

[Kondisi: Penalti Dibatalkan]
[N:{minute}] Hadiah penalti untuk [C:{club}] resmi dibatalkan setelah tinjauan VAR.

[Kondisi: Kartu Merah Diberikan]
[N:{minute}] Wasit mengeluarkan kartu merah langsung untuk [P:{player}] ([N:{player_pct}%]) ([C:{club}]) setelah tinjauan VAR atas pelanggaran serius.

[Kondisi: Kartu Merah Dibatalkan]
[N:{minute}] Hukuman kartu merah untuk [P:{player}] ([N:{player_pct}%]) ([C:{club}]) dibatalkan setelah tinjauan VAR.`,
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
      reason: event.reason || 'Offside',
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
      reason: 'Offside',
      home_club: 'Nott\'m Forest',
      home_score: '2',
      away_score: '0',
      away_club: 'Man City',
    },
  },

  // G. Statistik Live FPL (Goalkeeper Saves & Defensive Contribution)
  {
    no: 30,
    id: 'LM_GK_SAVES',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Goalkeeper Saves',
    output: 'MULTI-NEWS',
    template: `Kiper [C:{club}], [P:{player}] ([N:{player_pct}%]), mencatatkan [N:{saves} Penyelamatan] dan menyumbang [N:+{saves_pts} Poin] kontra [C:{opponent}].`,
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
    id: 'LM_DEFCON_BONUS',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Defensive Contribution',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{player_pct}%]) mencatatkan [N:{dc_count} Aksi Defensif] untuk [C:{club}] kontra [C:{opponent}] dan mengamankan [N:+2 Poin] Defensive Contribution.`,
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
    id: 'LM_TEAM_RANK_SHIFT',
    gw_phase: 'Live Match',
    category: 'Standings',
    subcategory: 'Rank Shift',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Naik Peringkat]
[T:{team}] mengumpulkan [N:{gw_pts} Poin] sementara di Gameweek [N:{gw}], naik [N:+{rank_diff} Posisi] dari peringkat [N:{old_rank}] ke peringkat [N:{new_rank}] klasemen sementara dengan total [N:{total_pts} Poin].

[Kondisi: Turun Peringkat]
[T:{team}] mengumpulkan [N:{gw_pts} Poin] sementara di Gameweek [N:{gw}], turun [N:-{rank_diff} Posisi] dari peringkat [N:{old_rank}] ke peringkat [N:{new_rank}] klasemen sementara dengan total [N:{total_pts} Poin].

[Kondisi: Bertahan Peringkat]
[T:{team}] mengumpulkan [N:{gw_pts} Poin] sementara di Gameweek [N:{gw}] dan bertahan di peringkat [N:{new_rank}] klasemen sementara dengan total [N:{total_pts} Poin].`,
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
    id: 'LM_MATCH_SCORE',
    gw_phase: 'Live Match',
    category: 'Match Event',
    subcategory: 'Live Score',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Skor 0-0 Berjalan]
Pertandingan [C:{home_club}] kontra [C:{away_club}] sedang berlangsung di menit [N:{minute}] dengan skor sementara [N:0 - 0].

[Kondisi: Dengan Gol Berjalan]
Pertandingan [C:{home_club}] kontra [C:{away_club}] sedang berlangsung di menit [N:{minute}] dengan skor sementara [N:{home_score} - {away_score}], gol dicetak oleh {scorers_list}.

[Kondisi: Skor 0-0 Half Time]
Pertandingan [C:{home_club}] kontra [C:{away_club}] memasuki jeda babak pertama (Half Time) dengan skor sementara [N:0 - 0].

[Kondisi: Dengan Gol Half Time]
Pertandingan [C:{home_club}] kontra [C:{away_club}] memasuki jeda babak pertama (Half Time) dengan skor sementara [N:{home_score} - {away_score}], gol dicetak oleh {scorers_list}.`,
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
  return renderTemplate(totalGoals === 0 || !scorersList ? template.ht_zero : template.ht_goals, vars);
}
return renderTemplate(totalGoals === 0 || !scorersList ? template.live_zero : template.live_goals, vars);`,
    sample_data: {
      home_club: 'Arsenal',
      away_club: 'Chelsea',
      minute: '74\'',
      home_score: '2',
      away_score: '1',
      scorers_list: '[P:Saka] ([N:68%]), [P:Havertz] ([N:14%]), dan [P:Palmer] ([N:45%])',
    },
  },

  // ============================================================================
  // FASE 3: BETWEEN MATCH TEMPLATES (Jeda Antar-Laga / Interval)
  // ============================================================================
  {
    no: 34,
    id: 'BM_MATCH_FULL_TIME',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Result',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Kemenangan]
Full Time di [N:{venue}], [C:{winning_club}] menang [N:{home_score}] - [N:{away_score}] atas [C:{losing_club}], dengan gol dicetak oleh {goalscorers_list}.

[Kondisi: Imbang]
Full Time di [N:{venue}], laga antara [C:{home_club}] kontra [C:{away_club}] berakhir imbang [N:{home_score}] - [N:{away_score}], dengan gol dicetak oleh {goalscorers_list}.`,
    example: '',
    code: `if (match.home_score === match.away_score) {
  return renderTemplate(template.draw, {
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
  home_score: match.home_score,
  away_score: match.away_score,
  goalscorers_list: formatScorers(match.scorers),
});`,
    sample_data: {
      venue: 'The City Ground',
      winning_club: 'Nott\'m Forest',
      losing_club: 'Man City',
      home_club: 'Nott\'m Forest',
      away_club: 'Man City',
      home_score: '3',
      away_score: '1',
      goalscorers_list: '[P:Jair Cunha] ([N:2%]) dan [P:Delap] ([N:12%]) [N:(2 Gol)]',
    },
  },
  {
    no: 35,
    id: 'BM_MATCH_FIXTURE',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Fixture',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Jeda Pendek - 1 Laga]
Laga berikutnya Gameweek [N:{gw}] bergulir pukul [N:{kickoff_time}], mempertemukan [C:{home_club}] kontra [C:{away_club}].

[Kondisi: Jeda Pendek - Multi Laga]
Gameweek [N:{gw}] berlanjut dengan {count} pertandingan serentak pukul [N:{kickoff_time}], mempertemukan {matches_list}.

[Kondisi: Jeda Panjang - 1 Laga]
Lanjutan Gameweek [N:{gw}] bergulir hari {wib_day} pukul [N:{kickoff_time}], mempertemukan [C:{home_club}] kontra [C:{away_club}].

[Kondisi: Jeda Panjang - Multi Laga]
Lanjutan Gameweek [N:{gw}] bergulir hari {wib_day} pukul [N:{kickoff_time}], menyajikan {count} pertandingan meliputi {matches_list}.`,
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
    category: 'Match Event',
    subcategory: 'Clean Sheet',
    output: 'MULTI-NEWS',
    template: `[C:{club}] mencatatkan clean sheet kontra [C:{opponent}], menghasilkan [N:+4 Poin] nirbobol bagi [P:{defender}] ([N:{ownership_pct}%]).`,
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
    id: 'BM_GOAL_CONTRIBUTORS',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Goal',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Gol & Assist]
[P:{scorer}] ([N:{scorer_pct}%]) mencetak gol untuk [C:{club}] melalui assist [P:{assister}] ([N:{assister_pct}%]) pada laga kontra [C:{opponent}].

[Kondisi: Multi Gol]
[P:{scorer}] ([N:{scorer_pct}%]) mencetak [N:{goals_count} Gol] untuk [C:{club}] pada laga kontra [C:{opponent}].`,
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
    id: 'BM_BONUS_POINTS_STAR',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Bonus Points',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{ownership_pct}%]) mencatatkan skor BPS tertinggi ([N:{bps} BPS]) dan mengoleksi [N:{points} Poin] pada laga [C:{club}] kontra [C:{opponent}].`,
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
    id: 'BM_PENALTY_SAVED',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Penalty Saved',
    output: 'MULTI-NEWS',
    template: `Kiper [P:{gk_name}] ([N:{gk_pct}%]) menepis tendangan penalti [P:{taker_name}] ([N:{taker_pct}%]) pada laga [C:{club}] kontra [C:{opponent}].`,
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
    id: 'BM_PENALTY_MISSED',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Penalty Missed',
    output: 'MULTI-NEWS',
    template: `Eksekusi penalti [P:{taker_name}] ([N:{taker_pct}%]) tidak membuahkan gol pada laga [C:{club}] kontra [C:{opponent}], tercatat penalti [N:-2 Poin].`,
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
    id: 'BM_CARD_RED',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Red Card',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{player_pct}%]) menerima kartu merah pada laga [C:{club}] kontra [C:{opponent}], tercatat penalti [N:-3 Poin].`,
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
    id: 'BM_INJURY_UPDATE',
    gw_phase: 'Between Match',
    category: 'Match Event',
    subcategory: 'Match Injury',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([N:{ownership_pct}%]) ditarik keluar lapangan pada menit [N:{minute}] akibat cedera saat memperkuat [C:{club}] kontra [C:{opponent}].`,
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
      minute: '65\'',
      club: 'Arsenal',
      opponent: 'Chelsea',
    },
  },
  {
    no: 43,
    id: 'BM_CAPTAIN_RETURN',
    gw_phase: 'Between Match',
    category: 'Captain',
    subcategory: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `[Kondisi: Jeda Pendek]
Kapten [P:{captain}] yang dipilih oleh [N:{count}] tim menyumbang [N:{pts} Poin] di laga tadi, sementara rival menantikan pemainnya pada laga pukul [N:{kickoff_time}].

[Kondisi: Jeda Panjang]
Sebanyak [N:{count}] tim mengandalkan kapten [P:{captain}] pada pertandingan lanjutan Gameweek [N:{gw}] hari {wib_day} pukul [N:{kickoff_time}].`,
    example: '',
    code: `const isShortBreak = nextFixture.dateUK === lastFinishedMatch.dateUK;
if (isShortBreak) {
  return renderTemplate(template.short, {
    captain: dominantCaptain.web_name,
    count: dominantCaptain.pickers_count,
    pts: dominantCaptain.points,
    kickoff_time: nextFixture.kickoffWIB,
  });
}
return renderTemplate(template.long, {
  count: upcomingCaptain.pickers_count,
  captain: upcomingCaptain.web_name,
  gw,
  wib_day: nextFixture.wibDay,
  kickoff_time: nextFixture.kickoffWIB,
});`,
    sample_data: {
      captain: 'Haaland',
      count: '10',
      pts: '13',
      kickoff_time: '23:30 WIB',
      gw: '10',
      wib_day: 'Minggu',
    },
  },
  {
    no: 44,
    id: 'BM_BENCH_REGRET',
    gw_phase: 'Between Match',
    category: 'Starting XI',
    subcategory: 'Bench Regret',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mencadangkan [P:{player}] yang mencetak [N:{bench_pts} Poin] di bangku cadangan pada laga yang telah selesai.`,
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
    id: 'BM_AUTOSUB_WATCH',
    gw_phase: 'Between Match',
    category: 'Starting XI',
    subcategory: 'Autosub Watch',
    output: 'MULTI-NEWS',
    template: `Starter [P:{player_dnp}] tidak bermain (0 menit) untuk [C:{club}], membuka antrean pergantian otomatis pemain cadangan [T:{team}].`,
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
    id: 'BM_TOP_RIVALRY',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Top Rivalry',
    output: 'SINGLE-NEWS',
    template: `Pada klasemen sementara Gameweek [N:{gw}], [T:{team_1}] memimpin di peringkat 1 dengan keunggulan [N:{margin} Poin] atas [T:{team_2}] di peringkat 2.`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  team_1: rank1.name,
  margin: rank1.total_points - rank2.total_points,
  team_2: rank2.name,
});`,
    sample_data: {
      gw: '10',
      team_1: 'Sunda Kelapa',
      margin: '4',
      team_2: 'Bintang Timur',
    },
  },
  {
    no: 47,
    id: 'BM_GW_LEADER',
    gw_phase: 'Between Match',
    category: 'Standings',
    subcategory: 'Gameweek Leader',
    output: 'SINGLE-NEWS',
    template: `Pada perolehan poin sementara Gameweek [N:{gw}], [T:{team}] memimpin perolehan poin pekan ini dengan koleksi [N:{gw_pts} Poin].`,
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
    id: 'BM_REMAINING_ASSETS',
    gw_phase: 'Between Match',
    category: 'Starting XI',
    subcategory: 'Remaining Assets',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Dengan Kapten Tersisa]
Di jeda pertandingan Gameweek [N:{gw}], [T:{team}] masih memiliki [N:{remaining_count}] pemain tersisa yang belum bertanding, termasuk kapten [P:{captain}] ([C:{captain_club}]).

[Kondisi: Tanpa Kapten Tersisa]
Di jeda pertandingan Gameweek [N:{gw}], [T:{team}] masih memiliki [N:{remaining_count}] pemain tersisa yang belum bertanding, antara lain [P:{player}] ([C:{club}]).`,
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

  // ============================================================================
  // FASE 4: PROVISIONAL TEMPLATES (Seluruh Laga FT, Audit Opta/FPL Berjalan)
  // ============================================================================
  {
    no: 49,
    id: 'PV_TOP_RIVALRY',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Top Rivalry',
    output: 'SINGLE-NEWS',
    template: `Pada klasemen sementara Gameweek [N:{gw}] usai seluruh pertandingan selesai, [T:{team_1}] menempati peringkat 1 ([N:{pts_1} Poin]), unggul [N:{margin} Poin] atas [T:{team_2}] di peringkat 2 ([N:{pts_2} Poin]).`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  team_1: rank1.name,
  pts_1: rank1.total_points,
  margin: rank1.total_points - rank2.total_points,
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
    id: 'PV_GW_LEADER',
    gw_phase: 'Provisional',
    category: 'Standings',
    subcategory: 'Gameweek Leader',
    output: 'SINGLE-NEWS',
    template: `Pada perolehan poin sementara Gameweek [N:{gw}], [T:{team}] memimpin dengan torehan [N:{gw_pts} Poin], disusul [T:{team_2}] dengan [N:{gw_pts_2} Poin] sebelum proses audit poin dan autosub tuntas.`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  team: leader1.name,
  gw_pts: leader1.gw_points,
  team_2: leader2.name,
  gw_pts_2: leader2.gw_points,
});`,
    sample_data: {
      gw: '10',
      team: 'Elang Jawa',
      gw_pts: '78',
      team_2: 'Garuda FC',
      gw_pts_2: '74',
    },
  },
  {
    no: 51,
    id: 'PV_TOP_SCORER_GW',
    gw_phase: 'Provisional',
    category: 'Player',
    subcategory: 'Top Performer',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([C:{club}]) menjadi pemain dengan perolehan poin tertinggi di Gameweek [N:{gw}] usai mencatatkan [N:{points} Poin] ([N:{goals} Gol], [N:{assists} Assist]), dimiliki oleh [N:{owners_count}] tim di liga.`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  player: topPlayer.web_name,
  club: topPlayer.club,
  points: topPlayer.points,
  goals: topPlayer.goals,
  assists: topPlayer.assists,
  owners_count: topPlayer.owners_count,
});`,
    sample_data: {
      gw: '10',
      player: 'Palmer',
      club: 'Chelsea',
      points: '18',
      goals: '2',
      assists: '1',
      owners_count: '12',
    },
  },
  {
    no: 52,
    id: 'PV_CAPTAIN_RECAP',
    gw_phase: 'Provisional',
    category: 'Captain',
    subcategory: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `Pada rekap poin kapten terpopuler Gameweek [N:{gw}], [P:{captain_1}] ([N:{count_1}] tim) menghasilkan [N:{pts_1} Poin], sedangkan [P:{captain_2}] ([N:{count_2}] tim) menghasilkan [N:{pts_2} Poin].`,
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
      pts_1: '13',
      captain_2: 'Salah',
      count_2: '7',
      pts_2: '8',
    },
  },
  {
    no: 53,
    id: 'PV_VICE_CAPTAIN',
    gw_phase: 'Provisional',
    category: 'Captain',
    subcategory: 'Vice Captain',
    output: 'MULTI-NEWS',
    template: `Ban kapten pada [T:{team}] dialihkan ke wakil kapten [P:{vice_captain}] yang mengoleksi [N:{vice_pts} Poin], setelah kapten utama [P:{captain_dnp}] tidak bermain (0 menit).`,
    example: '',
    code: `return renderTemplate(template, {
  team: manager.name,
  captain_dnp: manager.captain.web_name,
  vice_captain: manager.vice_captain.web_name,
  vice_pts: manager.vice_captain.points,
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
    id: 'PV_AUTOSUB_PENDING',
    gw_phase: 'Provisional',
    category: 'Starting XI',
    subcategory: 'Autosub Watch',
    output: 'MULTI-NEWS',
    template: `Antrean pergantian otomatis [T:{team}] menunggu masuknya pemain cadangan pertama [P:{bench_player}] yang mengoleksi [N:{bench_pts} Poin], menggantikan starter [P:{player_dnp}] yang tidak bermain (0 menit).`,
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
    id: 'PV_BENCH_POINTS',
    gw_phase: 'Provisional',
    category: 'Starting XI',
    subcategory: 'Bench Points',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mencatatkan total [N:{total_bench_pts} Poin] tertahan di bangku cadangan pada Gameweek [N:{gw}], termasuk [P:{player}] yang mengemas [N:{player_pts} Poin].`,
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
    output: 'MULTI-NEWS',
    template: `Aktivasi sementara Wildcard [T:{team}] pada Gameweek [N:{gw}] mengumpulkan total [N:{gw_pts} Poin].`,
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
    id: 'PV_CHIP_FREEHIT',
    gw_phase: 'Provisional',
    category: 'Chip',
    subcategory: 'Free Hit',
    output: 'MULTI-NEWS',
    template: `Aktivasi sementara Free Hit [T:{team}] pada Gameweek [N:{gw}] mengumpulkan total [N:{gw_pts} Poin].`,
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
    output: 'MULTI-NEWS',
    template: `Aktivasi Bench Boost [T:{team}] menghasilkan total [N:{bench_pts} Poin] tambahan dari empat pemain cadangan pada Gameweek [N:{gw}].`,
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
    output: 'MULTI-NEWS',
    template: `Aktivasi Triple Captain [T:{team}] menghasilkan total [N:{total_pts} Poin] lewat kapten [P:{captain}] pada Gameweek [N:{gw}].`,
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
    id: 'PV_HITS_EVALUATION',
    gw_phase: 'Provisional',
    category: 'Hits',
    subcategory: 'Most Hits',
    output: 'MULTI-NEWS',
    template: `[T:{team}] menanggung penalti [N:-{hits_pts} Poin] transfer di Gameweek [N:{gw}], dengan pemain baru yang didatangkan, [P:{player_in}], mencatatkan [N:{player_pts} Poin].`,
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
    id: 'PV_CLEAN_SHEET_RECAP',
    gw_phase: 'Provisional',
    category: 'Match Event',
    subcategory: 'Clean Sheet',
    output: 'MULTI-NEWS',
    template: `[C:{club}] mencatatkan clean sheet di Gameweek [N:{gw}] usai menang [N:{score}] kontra [C:{opponent}], menghasilkan poin nirbobol bagi [N:{owners_count}] pemilik [P:{defender}].`,
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

  // ============================================================================
  // FASE 5: CONFIRMED TEMPLATES (Poin & Klasemen Resmi Tervalidasi 100%)
  // ============================================================================
  {
    no: 62,
    id: 'CF_FOUR_CHAMPS',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Four Champions',
    output: 'SINGLE-NEWS',
    template: `Hasil resmi Gameweek [N:{gw}] menetapkan 4 juara pekan ini, yaitu Juara 1 [T:{champ_1}] ([N:{pts_1} Poin]), Juara 2 [T:{champ_2}] ([N:{pts_2} Poin]), Juara 3 [T:{champ_3}] ([N:{pts_3} Poin]), dan Juara 4 [T:{champ_4}] ([N:{pts_4} Poin]).`,
    example: '',
    code: `const champs = getOfficialGwChampions(gw);
return renderTemplate(template, {
  gw,
  champ_1: champs[0].name,
  pts_1: champs[0].points,
  champ_2: champs[1].name,
  pts_2: champs[1].points,
  champ_3: champs[2].name,
  pts_3: champs[2].points,
  champ_4: champs[3].name,
  pts_4: champs[3].points,
});`,
    sample_data: {
      gw: '10',
      champ_1: 'Elang Jawa',
      pts_1: '82',
      champ_2: 'Garuda FC',
      pts_2: '79',
      champ_3: 'Sunda Kelapa',
      pts_3: '76',
      champ_4: 'Bintang Timur',
      pts_4: '75',
    },
  },
  {
    no: 63,
    id: 'CF_GW_CHAMPION',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Gameweek Leader',
    output: 'SINGLE-NEWS',
    template: `[T:{team}] resmi keluar sebagai Juara Gameweek [N:{gw}] dengan torehan [N:{gw_pts} Poin], unggul [N:{margin} Poin] atas pesaing terdekatnya [T:{runner_up}].`,
    example: '',
    code: `const leader = getOfficialGwLeader(gw);
const runnerUp = getOfficialGwRunnerUp(gw);
return renderTemplate(template, {
  gw,
  team: leader.name,
  gw_pts: leader.points,
  margin: leader.points - runnerUp.points,
  runner_up: runnerUp.name,
});`,
    sample_data: {
      gw: '10',
      team: 'Elang Jawa',
      gw_pts: '82',
      margin: '3',
      runner_up: 'Garuda FC',
    },
  },
  {
    no: 64,
    id: 'CF_TOP_RIVALRY',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Top Rivalry',
    output: 'SINGLE-NEWS',
    template: `Klasemen resmi Gameweek [N:{gw}] menempatkan [T:{team_1}] di puncak klasemen dengan total [N:{pts_1} Poin], memimpin keunggulan [N:{margin} Poin] dari [T:{team_2}] di peringkat 2.`,
    example: '',
    code: `const standings = getOfficialStandings(gw);
return renderTemplate(template, {
  gw,
  team_1: standings[0].name,
  pts_1: standings[0].total_points,
  margin: standings[0].total_points - standings[1].total_points,
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
    no: 65,
    id: 'CF_MOST_GW_RIVALRY',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Most GW Rivalry',
    output: 'SINGLE-NEWS',
    template: `Hingga Gameweek [N:{gw}], daftar perolehan gelar juara mingguan dipimpin oleh [T:{team_1}] ([N:{titles_1} Gelar]), ditempel ketat oleh [T:{team_2}] ([N:{titles_2} Gelar]).`,
    example: '',
    code: `const leaders = getMostGwChampionsLeaders(gw);
return renderTemplate(template, {
  gw,
  team_1: leaders[0].name,
  titles_1: leaders[0].titles,
  team_2: leaders[1].name,
  titles_2: leaders[1].titles,
});`,
    sample_data: {
      gw: '10',
      team_1: 'Blackswann',
      titles_1: '3',
      team_2: 'rdwndvsn',
      titles_2: '2',
    },
  },
  {
    no: 66,
    id: 'CF_RANK_CLIMBER',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Rank Climber',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mencatatkan kenaikan peringkat tertinggi di Gameweek [N:{gw}], melesat naik [N:+{rank_climb} Posisi] dari peringkat [N:{old_rank}] ke peringkat [N:{new_rank}].`,
    example: '',
    code: `const climber = getTopRankClimber(gw);
return renderTemplate(template, {
  gw,
  team: climber.name,
  rank_climb: climber.rank_diff,
  old_rank: climber.prev_rank,
  new_rank: climber.current_rank,
});`,
    sample_data: {
      gw: '10',
      team: 'Kuda Hitam',
      rank_climb: '6',
      old_rank: '14',
      new_rank: '8',
    },
  },
  {
    no: 67,
    id: 'CF_PLAYER_OF_THE_GW',
    gw_phase: 'Confirmed',
    category: 'Player',
    subcategory: 'Top Performer',
    output: 'MULTI-NEWS',
    template: `[P:{player}] ([C:{club}]) dinobatkan sebagai pemain terbaik resmi Gameweek [N:{gw}] dengan torehan [N:{points} Poin], berkat kontribusi [N:{goals} Gol], [N:{assists} Assist], dan [N:{bps_pts} Poin Bonus].`,
    example: '',
    code: `const topPlayer = getOfficialTopPlayer(gw);
return renderTemplate(template, {
  gw,
  player: topPlayer.web_name,
  club: topPlayer.club,
  points: topPlayer.total_points,
  goals: topPlayer.goals,
  assists: topPlayer.assists,
  bps_pts: topPlayer.bonus,
});`,
    sample_data: {
      gw: '10',
      player: 'Palmer',
      club: 'Chelsea',
      points: '18',
      goals: '2',
      assists: '1',
      bps_pts: '3',
    },
  },
  {
    no: 68,
    id: 'CF_AUTOSUB_OFFICIAL',
    gw_phase: 'Confirmed',
    category: 'Starting XI',
    subcategory: 'Autosub Watch',
    output: 'MULTI-NEWS',
    template: `Pergantian otomatis resmi Gameweek [N:{gw}] memasukkan [P:{bench_player}] ([N:+{bench_pts} Poin]) ke susunan pemain inti [T:{team}], menggantikan [P:{player_dnp}] yang tidak bermain.`,
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
    no: 69,
    id: 'CF_CAPTAIN_OFFICIAL',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Most Captained',
    output: 'SINGLE-NEWS',
    template: `Pilihan kapten terbanyak di liga pada Gameweek [N:{gw}], [P:{captain}] ([N:{count}] tim), menyumbangkan [N:{captain_pts} Poin] ganda usai pengesahan poin bonus.`,
    example: '',
    code: `const cap = getOfficialMostCaptained(gw);
return renderTemplate(template, {
  gw,
  captain: cap.web_name,
  count: cap.owners_count,
  captain_pts: cap.points * 2,
});`,
    sample_data: {
      gw: '10',
      captain: 'Haaland',
      count: '10',
      captain_pts: '26',
    },
  },
  {
    no: 70,
    id: 'CF_CHIP_WILDCARD',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Wildcard',
    output: 'MULTI-NEWS',
    template: `Aktivasi resmi Wildcard [T:{team}] pada Gameweek [N:{gw}] menghasilkan total [N:{gw_pts} Poin].`,
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
    no: 71,
    id: 'CF_CHIP_FREEHIT',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Free Hit',
    output: 'MULTI-NEWS',
    template: `Aktivasi resmi Free Hit [T:{team}] pada Gameweek [N:{gw}] menghasilkan total [N:{gw_pts} Poin].`,
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
    no: 72,
    id: 'CF_CHIP_BENCH_BOOST',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Bench Boost',
    output: 'MULTI-NEWS',
    template: `Aktivasi resmi Bench Boost [T:{team}] pada Gameweek [N:{gw}] mendulang total [N:{bench_pts} Poin] dari kontribusi empat pemain bangku cadangan.`,
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
    no: 73,
    id: 'CF_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Confirmed',
    category: 'Chip',
    subcategory: 'Triple Captain',
    output: 'MULTI-NEWS',
    template: `Aktivasi resmi Triple Captain [T:{team}] pada Gameweek [N:{gw}] mendulang total [N:{total_pts} Poin] berkat performa kapten [P:{captain}].`,
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
    no: 74,
    id: 'CF_HITS_DEDUCTED',
    gw_phase: 'Confirmed',
    category: 'Hits',
    subcategory: 'Most Hits',
    output: 'MULTI-NEWS',
    template: `Pengurangan poin transfer resmi Gameweek [N:{gw}] memotong [N:-{hits_pts} Poin] dari total skor [T:{team}] usai melakukan [N:{transfers_count} Transfer].`,
    example: '',
    code: `return renderTemplate(template, {
  gw,
  hits_pts: manager.hits_cost,
  team: manager.name,
  transfers_count: manager.transfers_made,
});`,
    sample_data: {
      gw: '10',
      hits_pts: '8',
      team: 'Bintang Timur',
      transfers_count: '2',
    },
  },
  {
    no: 75,
    id: 'CF_TRANSFER_KARMA',
    gw_phase: 'Confirmed',
    category: 'Transfer',
    subcategory: 'Transfer Karma',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] melepas [P:{player}] ([C:{club}]) yang resmi mengemas [N:{points} Poin] di Gameweek [N:{gw}], sementara penggantinya [P:{player_in}] hanya meraih [N:{in_points} Poin].

[Kondisi: Multi Tim]
{teams} sama-sama melepas [P:{player}] ([C:{club}]) yang resmi menorehkan [N:{points} Poin] di Gameweek [N:{gw}].`,
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
    no: 76,
    id: 'CF_CAPTAIN_REGRET',
    gw_phase: 'Confirmed',
    category: 'Captain',
    subcategory: 'Captain Regret',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] mempercayakan ban kapten kepada [P:{actual_captain}] ([N:{captain_pts} Poin]) di Gameweek [N:{gw}], sedangkan [P:{player}] ([C:{club}]) di susunan pemain inti tim tersebut meraih [N:{points} Poin].

[Kondisi: Multi Tim]
{teams} tidak mengkaptenkan [P:{player}] ([C:{club}]) yang resmi mencetak [N:{points} Poin] pada Gameweek [N:{gw}].`,
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
    no: 77,
    id: 'CF_RANK_FALLER',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Rank Faller',
    output: 'MULTI-NEWS',
    template: `[T:{team}] mencatatkan penurunan peringkat tajam di klasemen resmi Gameweek [N:{gw}], merosot [N:-{rank_drop} Posisi] dari peringkat [N:{old_rank}] ke peringkat [N:{new_rank}] setelah meraih [N:{gw_pts} Poin].`,
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
    no: 78,
    id: 'CF_SUMMIT_COUP',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Summit Coup',
    output: 'SINGLE-NEWS',
    template: `Kudeta puncak klasemen resmi terjadi pada Gameweek [N:{gw}] setelah [T:{new_leader}] naik dari peringkat [N:{old_rank}] ke peringkat 1, menggeser [T:{former_leader}] ke peringkat [N:{former_new_rank}] dengan selisih [N:{margin} Poin].`,
    example: '',
    code: `if (!titleBattle.coupOccurred) return null;
return renderTemplate(template, {
  gw,
  new_leader: rank1.team,
  old_rank: rank1.lastRank,
  former_leader: formerLeader.team,
  former_new_rank: formerLeader.rank,
  margin: rank1.totalPts - rank2.totalPts,
});`,
    sample_data: {
      gw: '10',
      new_leader: 'Garuda FC',
      old_rank: '2',
      former_leader: 'Sunda Kelapa',
      former_new_rank: '2',
      margin: '4',
    },
  },
  {
    no: 79,
    id: 'CF_RIVALRY_DUEL',
    gw_phase: 'Confirmed',
    category: 'Standings',
    subcategory: 'Rivalry Duel',
    output: 'MULTI-NEWS',
    template: `[Kondisi: Selisih Poin]
Persaingan ketat terjadi di papan klasemen resmi Gameweek [N:{gw}] antara peringkat [N:{rank_1}] [T:{team_1}] ([N:{pts_1} Poin]) dan peringkat [N:{rank_2}] [T:{team_2}] ([N:{pts_2} Poin]) yang hanya terpaut [N:{gap} Poin].

[Kondisi: Poin Sama]
Persaingan ketat terjadi di papan klasemen resmi Gameweek [N:{gw}] antara peringkat [N:{rank_1}] [T:{team_1}] dan peringkat [N:{rank_2}] [T:{team_2}] yang sama-sama mengoleksi [N:{pts_1} Poin].`,
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
    no: 80,
    id: 'CF_BENCH_POINTS',
    gw_phase: 'Confirmed',
    category: 'Starting XI',
    subcategory: 'Bench Regret',
    output: 'MULTI-NEWS',
    template: `[Kondisi: 1 Tim]
[T:{team}] menyimpan [P:{player}] ([C:{club}]) di bangku cadangan meski meraih [N:{points} Poin] pada laga resmi Gameweek [N:{gw}].

[Kondisi: Multi Tim]
{teams} sama-sama mencadangkan [P:{player}] ([C:{club}]) yang resmi menyumbang [N:{points} Poin] di bangku cadangan pada Gameweek [N:{gw}].`,
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
];

export function getPhase1Templates(): Phase1TemplateItem[] {
  const defaultTimestamp = new Date().toISOString();
  const baseDefaults = DEFAULT_PHASE1_TEMPLATES.map((def) => ({
    ...def,
    gw: def.gw || 10,
    timestamp: def.timestamp || def.updated_at || defaultTimestamp,
    source: def.source || 'Sys',
    output: def.output || ((def.gw_phase === 'Live Match' || def.id === 'NS_INJURY_UPDATE' || def.subcategory === 'Flagged Players') ? 'MULTI-NEWS' : 'SINGLE-NEWS'),
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
            const resolvedOutput = isLive
              ? 'MULTI-NEWS'
              : (custom.output || def.output || ((def.id === 'NS_INJURY_UPDATE' || def.subcategory === 'Flagged Players') ? 'MULTI-NEWS' : 'SINGLE-NEWS'));

            return {
              ...def,
              ...custom,
              id: def.id,
              no: def.no,
              gw_phase: gwPhase,
              output: resolvedOutput,
              gw: Number(custom.gw) || def.gw || 10,
              timestamp: custom.timestamp || custom.updated_at || def.timestamp || defaultTimestamp,
              source: custom.source || def.source || 'Sys',
              template: tmpl,
              example: custom.example || interpolateExample(tmpl, custom.sample_data || def.sample_data),
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

export function savePhase1Templates(items: Phase1TemplateItem[]): boolean {
  try {
    const saveTime = new Date().toISOString();
    const enriched = items.map((item) => {
      const isLive = (item.gw_phase || '').trim().toLowerCase() === 'live match';
      return {
        ...item,
        output: isLive ? 'MULTI-NEWS' : (item.output || 'SINGLE-NEWS'),
        gw: Number(item.gw) || 10,
        timestamp: item.timestamp || item.updated_at || saveTime,
        source: item.source || 'Sys',
        updated_at: saveTime,
      };
    });
    fs.mkdirSync(path.dirname(TEMPLATES_FILE_PATH), { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE_PATH, JSON.stringify(enriched, null, 2), 'utf-8');
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
