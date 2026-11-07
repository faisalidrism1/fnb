import fs from 'fs';
import path from 'path';

export interface Phase1TemplateItem {
  no: number;
  id: string;
  gw_phase: string;
  category: string;
  subcategory: string;
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
    id: 'P1_MATCH_FIXTURES',
    gw_phase: 'Not started',
    category: 'Match',
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
    id: 'P1_CHIP_WILDCARD',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Wildcard Use',
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
    id: 'P1_CHIP_FREEHIT',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Freehit Use',
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
    id: 'P1_CHIP_BENCH_BOOST',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Bench Boost Use',
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
    id: 'P1_CHIP_TRIPLE_CAPTAIN',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Triple Captain Use',
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
    id: 'P1_CHIP_RECAP',
    gw_phase: 'Not started',
    category: 'Chip',
    subcategory: 'Chip Recap',
    template: 'Hingga Gameweek [N:{gw}], akumulasi penggunaan chip FNB League tercatat: {chips_summary}.',
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
    id: 'P1_TRANSFER_IN',
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
    id: 'P1_TRANSFER_OUT',
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
    id: 'P1_CAPTAINCY_RECAP',
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
    id: 'P1_HITS_RECAP',
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
    id: 'P1_OWNERSHIP_MOST_OWNED',
    gw_phase: 'Not started',
    category: 'Ownership',
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
    id: 'P1_DIFFERENTIAL_XI',
    gw_phase: 'Not started',
    category: 'Starting XI',
    subcategory: 'Differential XI',
    template: `[Kondisi: 1 Pemain]
Pilihan taktis diambil [T:{team}] pada Gameweek [N:{gw}] dengan menurunkan [P:{player1}] ([N:{pct1}%] kepemilikan) sebagai pembeda di starting XI.

[Kondisi: 2 Pemain]
Pilihan taktis diambil [T:{team}] pada Gameweek [N:{gw}] dengan menurunkan [P:{player1}] ([N:{pct1}%] kepemilikan) dan [P:{player2}] ([N:{pct2}%] kepemilikan) sebagai pembeda di starting XI.`,
    example: 'Pilihan taktis diambil [T:Kuda Hitam] pada Gameweek [N:9] dengan menurunkan [P:Kluivert] ([N:3%] kepemilikan) dan [P:Welbeck] ([N:4%] kepemilikan) sebagai pembeda di starting XI.',
    code: `// 1 berita per masing-masing tim yang memiliki starting XI differential (< 5%)
const teamStories = [];
for (const team of allLeagueTeams) {
  const starters = getStartingXI(team.id, gw);
  const diffs = filterStartersUnder5Pct(starters);
  if (diffs.length === 0) continue;

  // Filter maksimal 2 pemain dengan point form tertinggi
  const topDiffs = pickTop2ByPointForm(diffs);

  if (topDiffs.length === 1) {
    teamStories.push(renderTemplate(template.single, {
      team: team.name,
      gw,
      player1: topDiffs[0].name,
      pct1: topDiffs[0].ownershipPct,
    }));
  } else {
    teamStories.push(renderTemplate(template.multi, {
      team: team.name,
      gw,
      player1: topDiffs[0].name,
      pct1: topDiffs[0].ownershipPct,
      player2: topDiffs[1].name,
      pct2: topDiffs[1].ownershipPct,
    }));
  }
}
return teamStories;`,
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
    id: 'P1_DIFFERENTIAL_CAPTAIN',
    gw_phase: 'Not started',
    category: 'Captain',
    subcategory: 'Differential Captain',
    template: `[Kondisi: Kapten Eksklusif (1 Tim)]
Langkah berani diambil [T:{team}] di Gameweek [N:{gw}], dengan menjadi satu-satunya tim di liga yang mempercayakan ban kapten kepada [P:{captain}].

[Kondisi: Kapten Differential (< 5%)]
Langkah berani diambil [T:{team}] di Gameweek [N:{gw}], dengan mempercayakan ban kapten kepada [P:{captain}] yang hanya dipilih oleh [N:{pickers_count}] tim di liga.`,
    example: 'Langkah berani diambil [T:Sunda Kelapa] di Gameweek [N:9], dengan menjadi satu-satunya tim di liga yang mempercayakan ban kapten kepada [P:Bowen].',
    code: `// 1 berita per masing-masing tim yang menunjuk kapten langka/eksklusif (< 5%)
const stories = [];
for (const team of allLeagueTeams) {
  const cap = getTeamCaptain(team.id, gw);
  const pickersCount = getCaptainPickersCount(cap.id, gw);

  if (!isDifferentialCaptain(pickersCount, totalTeams)) continue;

  if (pickersCount === 1) {
    stories.push(renderTemplate(template.exclusive, {
      team: team.name,
      captain: cap.name,
      gw,
    }));
  } else {
    stories.push(renderTemplate(template.differential, {
      team: team.name,
      captain: cap.name,
      pickers_count: pickersCount,
      gw,
    }));
  }
}
return stories;`,
    sample_data: {
      team: 'Sunda Kelapa',
      captain: 'Bowen',
      gw: '9',
      pickers_count: '2',
    },
  },
  {
    no: 14,
    id: 'P1_INJURY_UPDATE',
    gw_phase: 'Not started',
    category: 'Injury',
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
    id: 'P1_TOP_RIVALRY',
    gw_phase: 'Not started',
    category: 'Championship',
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
    id: 'P1_MOST_GW_RIVALRY',
    gw_phase: 'Not started',
    category: 'Championship',
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
];

export function getPhase1Templates(): Phase1TemplateItem[] {
  const baseDefaults = DEFAULT_PHASE1_TEMPLATES.map((def) => ({
    ...def,
    example: interpolateExample(def.template, def.sample_data),
  }));

  try {
    if (fs.existsSync(TEMPLATES_FILE_PATH)) {
      const raw = fs.readFileSync(TEMPLATES_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return baseDefaults.map((def) => {
          const custom = parsed.find((p: any) => p.id === def.id || p.no === def.no);
          if (custom) {
            const tmpl = custom.template || def.template;
            return {
              ...def,
              ...custom,
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
    fs.mkdirSync(path.dirname(TEMPLATES_FILE_PATH), { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE_PATH, JSON.stringify(items, null, 2), 'utf-8');
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
