import fs from 'fs';
import path from 'path';
import { NewsFormulaItem, NewsFormulaDramaConfig } from '../types.ts';

const CONFIG_STORAGE_PATH = path.join(process.cwd(), 'src/data/news_formulas_config.json');

/**
 * DEFAULT NEWS FORMULA REGISTRY
 * Simple, natural categories matching real FPL events:
 * 1. Gelar & Juara
 * 2. Klasemen & Peringkat
 * 3. Keputusan Manajer
 * 4. Chips & Transfer
 * 5. Pemain & Match
 */
export const DEFAULT_FORMULAS: NewsFormulaItem[] = [
  // ================= 1. GELAR & JUARA =================
  {
    id: 'SYS_CHAMP_GW',
    name: 'Juara Gameweek (Poin Tertinggi Pekan)',
    description: 'Menyoroti tim peraih poin tertinggi di Gameweek aktif. Saat Live menyajikan status memimpin sementara, saat Confirmed menyajikan penetapan juara resmi.',
    source: 'SYS',
    kategori: 'Gelar & Juara',
    sub_kategori: 'Juara Gameweek',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Garuda FC] memimpin perolehan poin sementara Juara Gameweek [N:9] dengan torehan [N:84 Poin].',
    example_confirmed_id: '[T:Garuda FC] resmi dinobatkan sebagai Juara Gameweek [N:9] dengan torehan [N:84 Poin] (hasil resmi).',
    example_live_en: '[T:Garuda FC] leads the provisional Gameweek [N:9] race with [N:84 Points].',
    example_confirmed_en: '[T:Garuda FC] is officially crowned Gameweek [N:9] champion with [N:84 Points] (official result).',
    drama_config: {
      base_score: 85,
      min_cap: 75,
      max_cap: 99,
      metric_name: 'margin_poin',
      metric_label: 'Keunggulan / Skor Poin (di atas 70)',
      metric_multiplier: 0.8,
      metric_default: 14,
      metric_min: 0,
      metric_max: 30,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_CHAMP_MOST_GW',
    name: 'Juara Terbanyak (Most GW)',
    description: 'Menyoroti tim pemegang rekor kemenangan mingguan terbanyak, termasuk klausul pelimpahan bila menempati 2 besar klasemen.',
    source: 'SYS',
    kategori: 'Gelar & Juara',
    sub_kategori: 'Juara Terbanyak',
    mentions_points_or_rank: true,
    allowed_phases: ['Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Nusantara United] memimpin perburuan gelar Juara Terbanyak sementara dengan [N:3] kemenangan mingguan.',
    example_confirmed_id: '[T:Nusantara United] resmi mengukuhkan posisi Juara Terbanyak dengan [N:3] kemenangan mingguan usai GW [N:9].',
    example_live_en: '[T:Nusantara United] provisionally leads the Most Gameweek Wins race with [N:3] weekly victories.',
    example_confirmed_en: '[T:Nusantara United] officially secures the Most Gameweek Wins title with [N:3] victories following GW [N:9].',
    drama_config: {
      base_score: 80,
      min_cap: 70,
      max_cap: 95,
      metric_name: 'win_count',
      metric_label: 'Jumlah Kemenangan Mingguan',
      metric_multiplier: 3.0,
      metric_default: 3,
      metric_min: 1,
      metric_max: 8,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_FOUR_CHAMPS',
    name: '4 Juara Resmi FNB League (Pilar Juara)',
    description: 'Menampilkan rangkuman penetapan 4 tim juara resmi liga saat Gameweek berstatus Confirmed.',
    source: 'SYS',
    kategori: 'Gelar & Juara',
    sub_kategori: '4 Juara Resmi',
    mentions_points_or_rank: true,
    allowed_phases: ['Confirmed'],
    example_live_id: '[T:Tim 1] memimpin sementara dalam persaingan 4 pilar juara FNB League.',
    example_confirmed_id: 'Hasil resmi Gameweek [N:9]: [T:Tim Puncak] (Peringkat 1), [T:Tim Kedua] (Runner-Up), [T:Tim Most GW] (Juara Terbanyak), dan [T:Tim GW] (Juara Pekan) resmi mengamankan 4 pilar juara!',
    example_live_en: '[T:Team 1] provisionally leads the 4 title pillars race of FNB League.',
    example_confirmed_en: 'Official Gameweek [N:9] results: [T:Summit Team] (1st), [T:Runner-Up Team] (2nd), [T:Most GW Team] (Most Wins), and [T:GW Champ] (GW Champion) officially claim the 4 championship pillars!',
    drama_config: {
      base_score: 95,
      min_cap: 90,
      max_cap: 100,
      metric_name: 'league_tier',
      metric_label: 'Prestise Gelar Liga',
      metric_multiplier: 1.0,
      metric_default: 4,
      metric_min: 1,
      metric_max: 5,
      metric_step: 1,
    },
  },

  // ================= 2. KLASEMEN & PERINGKAT =================
  {
    id: 'SYS_RANK_KUDETA',
    name: 'Kudeta Posisi Puncak Klasemen',
    description: 'Dipicu saat tim peringkat bawah berhasil menggulingkan pemuncak klasemen sebelumnya.',
    source: 'SYS',
    kategori: 'Klasemen & Peringkat',
    sub_kategori: 'Kudeta Puncak',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Kudeta takhta! [T:Elang Jawa] menggeser [T:Singa FC] dari posisi puncak klasemen sementara dengan selisih [N:3 Poin].',
    example_confirmed_id: 'Kudeta takhta sah! [T:Elang Jawa] resmi merebut posisi puncak klasemen FNB League dari [T:Singa FC] (hasil resmi).',
    example_live_en: 'Summit overthrow! [T:Elang Jawa] displaces [T:Singa FC] from the provisional top spot by [N:3 Points].',
    example_confirmed_en: 'Summit coup confirmed! [T:Elang Jawa] officially seizes rank 1 in FNB League from [T:Singa FC] (official result).',
    drama_config: {
      base_score: 90,
      min_cap: 82,
      max_cap: 100,
      metric_name: 'point_margin',
      metric_label: 'Margin Poin Kudeta',
      metric_multiplier: 1.2,
      metric_default: 4,
      metric_min: 1,
      metric_max: 15,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_RANK_DEFEND_SUMMIT',
    name: 'Mempertahankan Puncak Klasemen',
    description: 'Menyoroti konsistensi tim pemuncak yang sukses menjaga jarak dari kejaran pesaing terdekat.',
    source: 'SYS',
    kategori: 'Klasemen & Peringkat',
    sub_kategori: 'Puncak Klasemen',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Ksatria FC] kokoh mempertahankan posisi puncak klasemen sementara dengan keunggulan [N:8 Poin].',
    example_confirmed_id: '[T:Ksatria FC] resmi mempertahankan posisi puncak klasemen FNB League dengan keunggulan [N:8 Poin] atas pesaingnya.',
    example_live_en: '[T:Ksatria FC] resolutely maintains the provisional top spot holding an [N:8 Points] advantage.',
    example_confirmed_en: '[T:Ksatria FC] officially retains 1st place in FNB League holding an [N:8 Points] lead.',
    drama_config: {
      base_score: 82,
      min_cap: 72,
      max_cap: 92,
      metric_name: 'lead_margin',
      metric_label: 'Keunggulan Poin dari Peringkat 2',
      metric_multiplier: 0.6,
      metric_default: 6,
      metric_min: 1,
      metric_max: 20,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_MOVER_UP',
    name: 'Lonjakan Peringkat (Top Climber)',
    description: 'Menyoroti tim yang melakukan lompatan peringkat signifikan ke atas berkat raihan poin tinggi.',
    source: 'SYS',
    kategori: 'Klasemen & Peringkat',
    sub_kategori: 'Lonjakan Peringkat',
    mentions_points_or_rank: true,
    allowed_phases: ['Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Bintang Timur] melompat tajam naik [N:+5 Peringkat] ke posisi [N:4] klasemen sementara.',
    example_confirmed_id: '[T:Bintang Timur] resmi melonjak naik [N:+5 Peringkat] ke posisi [N:4] klasemen akhir pekan.',
    example_live_en: '[T:Bintang Timur] makes a massive leap, climbing [N:+5 Places] to provisional rank [N:4].',
    example_confirmed_en: '[T:Bintang Timur] officially rockets [N:+5 Places] up to rank [N:4] in the final Gameweek table.',
    drama_config: {
      base_score: 75,
      min_cap: 65,
      max_cap: 94,
      metric_name: 'rank_gain',
      metric_label: 'Kenaikan Peringkat (+Posisi)',
      metric_multiplier: 2.5,
      metric_default: 5,
      metric_min: 2,
      metric_max: 12,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_MOVER_DOWN',
    name: 'Penurunan Peringkat (Faller)',
    description: 'Menyoroti tim yang terjun bebas ke peringkat bawah akibat hasil minor atau kapten yang gagal.',
    source: 'SYS',
    kategori: 'Klasemen & Peringkat',
    sub_kategori: 'Penurunan Peringkat',
    mentions_points_or_rank: true,
    allowed_phases: ['Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Cendrawasih United] terjun bebas merosot [N:-6 Peringkat] ke posisi [N:11] klasemen sementara.',
    example_confirmed_id: '[T:Cendrawasih United] resmi anjlok [N:-6 Peringkat] ke posisi [N:11] klasemen usai pekan ini terkunci.',
    example_live_en: '[T:Cendrawasih United] freefalls [N:-6 Places] down to provisional rank [N:11].',
    example_confirmed_en: '[T:Cendrawasih United] officially slides [N:-6 Places] down to rank [N:11] as the Gameweek locks.',
    drama_config: {
      base_score: 75,
      min_cap: 65,
      max_cap: 94,
      metric_name: 'rank_drop',
      metric_label: 'Penurunan Peringkat (-Posisi)',
      metric_multiplier: 2.5,
      metric_default: 5,
      metric_min: 2,
      metric_max: 12,
      metric_step: 1,
    },
  },

  // ================= 3. KEPUTUSAN MANAJER =================
  {
    id: 'SYS_WHATIF_BENCH',
    name: 'Penyesalan Bangku Cadangan (Bench Points)',
    description: 'Menganalisis kehilangan poin ketika pemain di bench mendulang poin lebih tinggi daripada pemain starter seposisi.',
    source: 'SYS',
    kategori: 'Keputusan Manajer',
    sub_kategori: 'Bangku Cadangan',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Badak Perkasa] merugi mencadangkan [P:Palmer] yang mendulang [N:15 Poin] di bench sementara starter hanya meraih [N:2 Poin].',
    example_confirmed_id: '[T:Badak Perkasa] menyesal mencadangkan [P:Palmer] yang mengoleksi [N:15 Poin] di bangku cadangan.',
    example_live_en: '[T:Badak Perkasa] loses out by benching [P:Palmer] who delivers [N:15 Points] while a starter produced just [N:2 Points].',
    example_confirmed_en: '[T:Badak Perkasa] deeply regrets benching [P:Palmer] who collected [N:15 Points] on the bench.',
    drama_config: {
      base_score: 78,
      min_cap: 70,
      max_cap: 96,
      metric_name: 'bench_loss',
      metric_label: 'Selisih Poin Terbuang di Bench',
      metric_multiplier: 1.5,
      metric_default: 10,
      metric_min: 4,
      metric_max: 20,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_WHATIF_CAPTAIN',
    name: 'Perjudian Ban Kapten (Captain Gambit)',
    description: 'Menyoroti selisih poin ketika pilihan kapten gagal meledak dibanding gelandang/penyerang lain di skuad.',
    source: 'SYS',
    kategori: 'Keputusan Manajer',
    sub_kategori: 'Pilihan Kapten',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Rajawali Squad] kehilangan potensi [N:+12 Poin] akibat memilih kapten [P:Haaland] dibanding [P:Salah] yang membukukan poin lebih tinggi.',
    example_confirmed_id: '[T:Rajawali Squad] kehilangan potensi [N:+12 Poin] akibat memilih kapten [P:Haaland] dibanding [P:Salah].',
    example_live_en: '[T:Rajawali Squad] misses out on [N:+12 Points] by captaining [P:Haaland] instead of high-flying [P:Salah].',
    example_confirmed_en: '[T:Rajawali Squad] lost out on [N:+12 Points] due to selecting [P:Haaland] as captain over [P:Salah].',
    drama_config: {
      base_score: 77,
      min_cap: 68,
      max_cap: 95,
      metric_name: 'captain_delta',
      metric_label: 'Selisih Poin Kapten Alternatif',
      metric_multiplier: 1.6,
      metric_default: 8,
      metric_min: 3,
      metric_max: 18,
      metric_step: 1,
    },
  },
  {
    id: 'AI_RIVALRY_DUEL',
    name: 'Duel Panas Rivalitas Klasemen (Gemini AI)',
    description: 'Narasi jurnalisme AI Gemini mengulas pertarungan sengit antara dua tim rival yang bersaing ketat dengan margin poin tipis.',
    source: 'AI',
    kategori: 'Keputusan Manajer',
    sub_kategori: 'Rivalitas Tim',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Duel sengit! [T:Singa FC] dan [T:Harimau Jaya] hanya terpisah [N:2 Poin] di klasemen sementara, persaingan makin mendidih.',
    example_confirmed_id: 'Persaingan ketat berlanjut: [T:Singa FC] dan [T:Harimau Jaya] menutup pekan dengan margin tipis [N:2 Poin] di klasemen resmi.',
    example_live_en: 'Fierce rivalry! [T:Singa FC] and [T:Harimau Jaya] are separated by only [N:2 Points] in the provisional table.',
    example_confirmed_en: 'Tight contest continues: [T:Singa FC] and [T:Harimau Jaya] finish the round separated by [N:2 Points] in the official table.',
    drama_config: {
      base_score: 84,
      min_cap: 75,
      max_cap: 98,
      metric_name: 'rival_proximity',
      metric_label: 'Kedekatan Poin Rival (10 - Selisih Poin)',
      metric_multiplier: 1.4,
      metric_default: 7,
      metric_min: 1,
      metric_max: 10,
      metric_step: 1,
    },
  },
  {
    id: 'AI_TRANSFER_KARMA',
    name: 'Transfer Karma (Pemain Dijual Menggila)',
    description: 'Narasi AI Gemini mengisahkan ironi manajer yang baru saja menjual seorang pemain, namun pemain tersebut langsung mencetak haul besar.',
    source: 'AI',
    kategori: 'Keputusan Manajer',
    sub_kategori: 'Transfer Karma',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Karma transfer nyata! [T:Garuda FC] melego [P:Saka] pekan ini, yang seketika mencetak gol dan assist [N:14 Poin].',
    example_confirmed_id: 'Karma transfer menimpa [T:Garuda FC] usai menjual [P:Saka] yang membukukan [N:14 Poin] pekan ini.',
    example_live_en: 'Transfer karma strikes! [T:Garuda FC] sold [P:Saka] this week, who promptly hauled [N:14 Points].',
    example_confirmed_en: 'Transfer karma hits [T:Garuda FC] following the sale of [P:Saka] who delivered [N:14 Points] this round.',
    drama_config: {
      base_score: 83,
      min_cap: 72,
      max_cap: 97,
      metric_name: 'sold_player_haul',
      metric_label: 'Poin Pemain Yang Dijual',
      metric_multiplier: 1.2,
      metric_default: 11,
      metric_min: 6,
      metric_max: 20,
      metric_step: 1,
    },
  },

  // ================= 4. CHIPS & TRANSFER =================
  {
    id: 'SYS_CHIP_TRIPLE_CAPTAIN',
    name: 'Aktivasi Chip Triple Captain',
    description: 'Menyoroti keputusan manajer mengerahkan chip Triple Captain untuk melipatgandakan poin kapten 3x lipat.',
    source: 'SYS',
    kategori: 'Chips & Transfer',
    sub_kategori: 'Triple Captain',
    mentions_points_or_rank: false,
    allowed_phases: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Kuda Hitam] mengaktifkan chip Triple Captain untuk [P:Haaland] di Gameweek [N:9]!',
    example_confirmed_id: 'Hasil Triple Captain [T:Kuda Hitam]: [P:Haaland] menyumbang total [N:39 Poin] untuk tim pekan ini.',
    example_live_en: '[T:Kuda Hitam] deploys the Triple Captain chip on [P:Haaland] in Gameweek [N:9]!',
    example_confirmed_en: 'Triple Captain return for [T:Kuda Hitam]: [P:Haaland] contributes an immense [N:39 Points] this week.',
    drama_config: {
      base_score: 88,
      min_cap: 78,
      max_cap: 99,
      metric_name: 'captain_base_pts',
      metric_label: 'Poin Dasar Kapten',
      metric_multiplier: 0.9,
      metric_default: 10,
      metric_min: 2,
      metric_max: 20,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_CHIP_BENCH_BOOST',
    name: 'Aktivasi Chip Bench Boost',
    description: 'Menyoroti manajer yang mengaktifkan Bench Boost untuk menghitung seluruh 15 pemain skuad.',
    source: 'SYS',
    kategori: 'Chips & Transfer',
    sub_kategori: 'Bench Boost',
    mentions_points_or_rank: false,
    allowed_phases: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Chip Bench Boost aktif! [T:Jawara Nusantara] memaksimalkan seluruh 15 pemain skuad di Gameweek [N:9].',
    example_confirmed_id: 'Bench Boost sukses! Pemain cadangan [T:Jawara Nusantara] menyumbang total [N:24 Poin] tambahan berharga.',
    example_live_en: 'Bench Boost activated! [T:Jawara Nusantara] unleashes all 15 squad players in Gameweek [N:9].',
    example_confirmed_en: 'Bench Boost payoff! The bench of [T:Jawara Nusantara] contributes [N:24 Extra Points] this round.',
    drama_config: {
      base_score: 86,
      min_cap: 76,
      max_cap: 98,
      metric_name: 'bench_boost_pts',
      metric_label: 'Total Poin dari 4 Pemain Cadangan',
      metric_multiplier: 1.0,
      metric_default: 12,
      metric_min: 3,
      metric_max: 25,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_CHIP_WILDCARD',
    name: 'Aktivasi Chip Wildcard',
    description: 'Perombakan skuad total tanpa penalti poin transfer sebelum deadline.',
    source: 'SYS',
    kategori: 'Chips & Transfer',
    sub_kategori: 'Wildcard',
    mentions_points_or_rank: false,
    allowed_phases: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Revolusi skuad! [T:Merpati United] resmi mengaktifkan chip Wildcard untuk merombak susunan pemain di Gameweek [N:9].',
    example_confirmed_id: 'Era baru skuad [T:Merpati United] usai aktivasi Wildcard di Gameweek [N:9].',
    example_live_en: 'Total overhaul! [T:Merpati United] plays the Wildcard chip to reshape their squad for Gameweek [N:9].',
    example_confirmed_en: 'New era begins for [T:Merpati United] following their Gameweek [N:9] Wildcard activation.',
    drama_config: {
      base_score: 82,
      min_cap: 72,
      max_cap: 92,
      metric_name: 'transfers_count',
      metric_label: 'Jumlah Perubahan Pemain',
      metric_multiplier: 0.8,
      metric_default: 6,
      metric_min: 3,
      metric_max: 15,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_CHIP_FREE_HIT',
    name: 'Aktivasi Chip Free Hit',
    description: 'Pengerahan skuad darurat satu pekan untuk merespons jadwal tunda atau laga ganda.',
    source: 'SYS',
    kategori: 'Chips & Transfer',
    sub_kategori: 'Free Hit',
    mentions_points_or_rank: false,
    allowed_phases: ['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Strategi taktis! [T:Pendekar Biru] mengerahkan chip Free Hit untuk menghadapi dinamika Gameweek [N:9].',
    example_confirmed_id: 'Hasil manuver Free Hit [T:Pendekar Biru] di Gameweek [N:9] selesai dievaluasi.',
    example_live_en: 'Tactical play! [T:Pendekar Biru] activates Free Hit to navigate Gameweek [N:9].',
    example_confirmed_en: 'Free Hit gambit for [T:Pendekar Biru] concludes in Gameweek [N:9].',
    drama_config: {
      base_score: 82,
      min_cap: 72,
      max_cap: 92,
      metric_name: 'transfers_count',
      metric_label: 'Jumlah Perubahan Pemain',
      metric_multiplier: 0.8,
      metric_default: 6,
      metric_min: 3,
      metric_max: 15,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_TRANSFER_MINUS_HITS',
    name: 'Penalti Minus Hit Transfer (Liga Minus)',
    description: 'Menyoroti manajer yang mengambil pemotongan poin agresif (-4, -8, -12 dst.) demi merotasi skuad.',
    source: 'SYS',
    kategori: 'Chips & Transfer',
    sub_kategori: 'Penalti Minus Hit',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[T:Ksatria Malam] mengambil risiko tinggi dengan menanggung penalti [N:-8 Poin] untuk transfer agresif pekan ini.',
    example_confirmed_id: '[T:Ksatria Malam] resmi dipotong penalti [N:-8 Poin] akibat transfer tambahan di Gameweek [N:9].',
    example_live_en: '[T:Ksatria Malam] takes high risks absorbing a [N:-8 Points] hit penalty for aggressive transfers this week.',
    example_confirmed_en: '[T:Ksatria Malam] is officially deducted [N:-8 Points] for extra transfer hits in Gameweek [N:9].',
    drama_config: {
      base_score: 80,
      min_cap: 70,
      max_cap: 95,
      metric_name: 'minus_points',
      metric_label: 'Besar Penalti Poin (-Poin)',
      metric_multiplier: 1.5,
      metric_default: 8,
      metric_min: 4,
      metric_max: 24,
      metric_step: 4,
    },
  },

  // ================= 5. PEMAIN & MATCH =================
  {
    id: 'SYS_PLAYER_TOP_HAUL',
    name: 'Performa Bintang / Haul Raksasa',
    description: 'Menyoroti pemain yang mencetak torehan poin luar biasa (dua digit) dan menjadi pembeda klasemen.',
    source: 'SYS',
    kategori: 'Pemain & Match',
    sub_kategori: 'Top Performer',
    mentions_points_or_rank: true,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: '[P:Haaland] menggila di lapangan! Torehan [N:17 Poin] sementara melesatkan tim para pemiliknya.',
    example_confirmed_id: '[P:Haaland] resmi dinobatkan sebagai pemain terbaik Gameweek [N:9] dengan torehan [N:17 Poin].',
    example_live_en: '[P:Haaland] delivers a masterclass! [N:17 Provisional Points] catapults owning managers.',
    example_confirmed_en: '[P:Haaland] is officially crowned star of Gameweek [N:9] collecting [N:17 Points].',
    drama_config: {
      base_score: 80,
      min_cap: 72,
      max_cap: 98,
      metric_name: 'player_pts',
      metric_label: 'Poin Performa Pemain (di atas 10)',
      metric_multiplier: 1.4,
      metric_default: 14,
      metric_min: 10,
      metric_max: 25,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_GK_CLEANSHEET',
    name: 'Clean Sheet & Penyelamatan Kiper',
    description: 'Menyoroti kiper yang mengamankan nirbobol plus poin bonus saves kelipatan 3.',
    source: 'SYS',
    kategori: 'Pemain & Match',
    sub_kategori: 'Clean Sheet',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Tembok kokoh! [P:Raya] mengamankan clean sheet dan [N:6 Saves] krusial bagi timnya.',
    example_confirmed_id: '[P:Raya] resmi mengamankan nirbobol dan [N:6 Saves] di Gameweek [N:9].',
    example_live_en: 'Impenetrable wall! [P:Raya] secures a clean sheet and [N:6 Crucial Saves] for his side.',
    example_confirmed_en: '[P:Raya] officially secures a clean sheet and [N:6 Saves] in Gameweek [N:9].',
    drama_config: {
      base_score: 75,
      min_cap: 66,
      max_cap: 90,
      metric_name: 'saves_count',
      metric_label: 'Jumlah Penyelamatan (Saves)',
      metric_multiplier: 2.0,
      metric_default: 6,
      metric_min: 3,
      metric_max: 12,
      metric_step: 3,
    },
  },
  {
    id: 'SYS_DISCIPLINE_RED',
    name: 'Bencana Kartu Merah',
    description: 'Insiden kartu merah langsung atau 2 kartu kuning yang memangkas poin dan merugikan manajer.',
    source: 'SYS',
    kategori: 'Pemain & Match',
    sub_kategori: 'Kartu Merah',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match', 'Between Match', 'Provisional', 'Confirmed'],
    example_live_id: 'Bencana kartu merah! [P:Saliba] diusir keluar lapangan, memangkas poin tim pemiliknya.',
    example_confirmed_id: 'Hukuman kartu merah [P:Saliba] resmi berakibat penalti poin bagi para pemiliknya.',
    example_live_en: 'Red card disaster! [P:Saliba] is sent off, slashing points for owning managers.',
    example_confirmed_en: 'Red card penalty for [P:Saliba] is officially confirmed, reducing points for owners.',
    drama_config: {
      base_score: 87,
      min_cap: 80,
      max_cap: 98,
      metric_name: 'severity',
      metric_label: 'Tingkat Dampak Kartu Merah',
      metric_multiplier: 1.5,
      metric_default: 5,
      metric_min: 1,
      metric_max: 8,
      metric_step: 1,
    },
  },
  {
    id: 'SYS_MATCH_LIVE_SCORE',
    name: 'Skor Pertandingan Berjalan (Live Match)',
    description: 'Pembaruan skor langsung laga Premier League saat pertandingan sedang aktif berlangsung.',
    source: 'SYS',
    kategori: 'Pemain & Match',
    sub_kategori: 'Skor Laga',
    mentions_points_or_rank: false,
    allowed_phases: ['Live Match'],
    example_live_id: 'Live Match: [C:Arsenal] 2 - 1 [C:Chelsea] (Babak ke-2, Menit 74\'). Pertandingan berlangsung intensif.',
    example_confirmed_id: 'Laga tuntas: [C:Arsenal] 2 - 1 [C:Chelsea] (FT). Seluruh statistik laga telah diverifikasi.',
    example_live_en: 'Live Match: [C:Arsenal] 2 - 1 [C:Chelsea] (2nd Half, 74\'). Match is at peak intensity.',
    example_confirmed_en: 'Full Time: [C:Arsenal] 2 - 1 [C:Chelsea] (FT). Match statistics fully verified.',
    drama_config: {
      base_score: 72,
      min_cap: 60,
      max_cap: 85,
      metric_name: 'goal_count',
      metric_label: 'Total Gol dalam Laga',
      metric_multiplier: 2.5,
      metric_default: 3,
      metric_min: 0,
      metric_max: 7,
      metric_step: 1,
    },
  },
];

/**
 * Loads formulas from disk or falls back to DEFAULT_FORMULAS
 */
export function getRegisteredFormulas(): NewsFormulaItem[] {
  try {
    if (fs.existsSync(CONFIG_STORAGE_PATH)) {
      const raw = fs.readFileSync(CONFIG_STORAGE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge with defaults to ensure all fields exist
        return DEFAULT_FORMULAS.map((def) => {
          const custom = parsed.find((p: any) => p.id === def.id);
          if (custom) {
            return {
              ...def,
              ...custom,
              drama_config: {
                ...def.drama_config,
                ...(custom.drama_config || {}),
              },
            };
          }
          return def;
        });
      }
    }
  } catch (err: any) {
    console.warn('[NewsFormulaRegistry] Error loading custom config, using defaults:', err.message);
  }
  return DEFAULT_FORMULAS;
}

/**
 * Saves customized formula configurations to disk
 */
export function saveFormulasConfig(formulas: NewsFormulaItem[]): boolean {
  try {
    fs.writeFileSync(CONFIG_STORAGE_PATH, JSON.stringify(formulas, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[NewsFormulaRegistry] Failed to save config to disk:', err);
    return false;
  }
}

/**
 * Updates a specific formula's configuration
 */
export function updateFormulaConfig(
  formulaId: string,
  updates: Partial<NewsFormulaItem>
): NewsFormulaItem | null {
  const current = getRegisteredFormulas();
  const index = current.findIndex((f) => f.id === formulaId);
  if (index === -1) return null;

  const target = current[index];
  const updated: NewsFormulaItem = {
    ...target,
    ...updates,
    drama_config: {
      ...target.drama_config,
      ...(updates.drama_config || {}),
    },
  };

  current[index] = updated;
  saveFormulasConfig(current);
  return updated;
}

/**
 * Resets formulas back to defaults
 */
export function resetFormulasToDefault(): NewsFormulaItem[] {
  try {
    if (fs.existsSync(CONFIG_STORAGE_PATH)) {
      fs.unlinkSync(CONFIG_STORAGE_PATH);
    }
  } catch {}
  return DEFAULT_FORMULAS;
}

/**
 * Calculates dynamic drama score using formula config and given metric value
 */
export function calculateDynamicDramaScore(
  config: NewsFormulaDramaConfig,
  metricValue?: number
): number {
  const val = typeof metricValue === 'number' ? metricValue : (config.metric_default ?? 0);
  const multiplier = config.metric_multiplier ?? 1;
  const rawScore = Math.round(config.base_score + (val * multiplier));
  return Math.max(config.min_cap, Math.min(config.max_cap, rawScore));
}
