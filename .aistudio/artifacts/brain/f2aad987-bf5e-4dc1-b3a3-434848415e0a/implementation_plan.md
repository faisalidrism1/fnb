# Konsep Kerja & Arsitektur News Ticker FNB League bertenaga Gemini AI

Dokumen perencanaan ini merumuskan konsep kerja, struktur data, dan rekayasa prompt (prompt engineering) Gemini AI untuk menghasilkan berita berjalan (*news ticker*) berkualitas tinggi. Seluruh narasi berpusat pada drama nyata di balik keputusan manajer dan implikasinya terhadap perebutan 4 kategori juara FNB League.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Keputusan Kunci yang Telah Dikonfirmasi (Berdasarkan Klarifikasi Pengguna):**
> 1. **Persona & Gaya Bahasa:** Jurnalis olahraga resmi yang lugas, faktual, dan mendalam, berani mengungkap fakta berdasarkan drama yang terjadi di lapangan—baik drama positif (kemenangan spektakuler, keputusan jitu) maupun drama negatif (penyesalan transfer, blunder kapten, derita non-owner).
> 2. **Fokus Psikologis & Narasi:** Menghubungkan sebab-akibat antara keputusan manajer (transfer IN/OUT, start vs bench, kapten & VC, chip, penalti hit -4/-8, kepemilikan pemain) dengan poin pertandingan di lapangan, serta dampaknya terhadap **4 Kategori Juara FNB League** (Peringkat 1 Klasemen, Peringkat 2 Klasemen, Juara Terbanyak / Most GW Champion, dan Juara Gameweek).
> 3. **Kedalaman Konteks Liga:** Menghindari berita umum yang sekadar menyebut skor ("Haaland mencetak gol"). Berita wajib menggali sudut pandang drama relasional antar-manajer liga.

---

## 1. Overview & Core Concept

### A. Apa yang Dibangun?
Sistem **Editorial News Engine FNB League** yang memanfaatkan model **Gemini AI (`gemini-3.8-flash`)** di sisi server untuk mengamati seluruh data liga (14 tim manajer, susunan skuad 15 pemain, transfer, kapten, bangku cadangan, perolehan poin live, dan klasemen), mengekstraksi titik-titik drama paling emosional, dan merangkai berita berjalan layaknya *breaking news ticker* stasiun televisi olahraga terkemuka.

### B. Siapa Audiens & Apa Tujuannya?
* **Audiens:** Seluruh manajer tim peserta FNB League (Liga 12356).
* **Tujuan Utama:** Setiap kali manajer membaca teks berjalan di layar, mereka langsung merasa *relate*, emosional, dan terhubung secara personal—baik tersenyum puas karena kejeniusan taktisnya disorot, maupun gigit jari melihat keputusan transfer rival yang berbuah petaka atau berkah.

### C. 4 Medan Tempur Juara (The 4 Championship Battlegrounds)
Setiap berita selalu dikaitkan dengan dampaknya pada salah satu atau kombinasi dari 4 kategori gelar juara:
1. **Tahta Peringkat 1 (Rank 1):** Mahkota tertinggi akumulasi poin liga sepanjang 38 pekan.
2. **Zona Peringkat 2 (Rank 2):** Perebutan posisi runner-up yang kerap sengit dengan jarak tipis dari peringkat 3 ke bawah.
3. **Juara Terbanyak (Most GW Champion):** Koleksi trofi kemenangan pekan terbanyak sepanjang musim (dengan klausul pelimpahan bila pemegang sudah di Rank 1/2).
4. **Juara Gameweek (GW Champion):** Perburuan gelar raja poin pekan aktif (top scorer pekan ini).

---

## 2. Metodologi Penghasil Berita Berkualitas: The Drama Extraction Framework

Agar berita yang dihasilkan Gemini AI tidak generik, alur kerja dibagi menjadi 4 tahap logis:

```
┌────────────────────────────────┐     ┌────────────────────────────────┐
│   1. Fact & Delta Aggregator   │     │  2. Conflict & Stake Analyzer  │
│  • Poin Pemain EPL (Live/Final)│ ──> │ • Siapa yang untung & buntung? │
│  • Lineup 14 Tim (C, VC, Bench)│     │ • Keputusan mana yang fatal?   │
│  • Transfer IN/OUT & Biaya Hit │     │ • Efek ke 4 Kategori Juara     │
└────────────────────────────────┘     └────────────────────────────────┘
                                                       │
                                                       ▼
┌────────────────────────────────┐     ┌────────────────────────────────┐
│ 4. News Ticker Presentation    │     │ 3. Gemini AI Journalist Engine │
│ • Entity Color-Coding          │ <── │ • Persona Jurnalis Resmi       │
│ • No-Lag Smooth Continuous Flow│     │ • Prompt Anti-Generik          │
│ • Bilingual (ID & EN)          │     │ • Output JSON Terstruktur      │
└────────────────────────────────┘     └────────────────────────────────┘
```

### A. 6 Arketipe Drama Keputusan Manajer (Decision vs Outcome)
Gemini AI disuplai dengan variabel keputusan konkret sebelum menulis narasi:

1. **Karma Transfer (The Transfer Backfire & Masterclass):**
   * *Drama Negatif:* Manajer menjual pemain X di pekan ini demi pemain Y, namun pemain X mencetak gol/assist (2 digit poin), sementara pemain Y blank atau kartu kuning.
   * *Drama Positif:* Transfer cerdas tepat sebelum deadline yang langsung menghasilkan gol pembuka dan mendongkrak peringkat ke puncak.
2. **Kutukan Ban Kapten vs Penyesalan Wakil (Captaincy Dilemma & The VC Irony):**
   * *The VC Irony:* Kapten utama (C) hanya meraih 2 poin (4 poin ganda), sementara Wakil Kapten (VC) membukukan hat-trick 17 poin yang tidak digandakan.
   * *Differential Captaincy:* Manajer berani memilih kapten non-populer yang berhasil memangkas defisit puluhan poin dari sang pemuncak klasemen.
3. **Tragedi Bangku Cadangan (Bench Agony & Cameo Curse):**
   * Pemain cadangan urutan ke-2 atau ke-3 meraih 10+ poin, namun tidak masuk lapangan karena pemain starter bermain 1 menit cameo di menit 89.
   * Autosub clutch: Pemain starter absen (0 menit) dan digantikan oleh bek cadangan yang membawa bonus clean sheet + assist.
4. **Pertaruhan Chip & Beban Biaya Hit (-4 / -8 Poin):**
   * Manajer melakukan transfer agresif dengan penalti hit -8 poin demi merombak tim; apakah perjudian tersebut berhasil melampaui biaya penalti atau justru menggagalkan ambisi Juara GW?
   * Efektivitas penggunaan Chip (Free Hit, Triple Captain, Bench Boost) terhadap pergeseran klasemen.
5. **Perang Kepemilikan (Template vs Differential Warfare):**
   * *Derita Non-Owner:* Saat pemain berkepemilikan 90% meledak, sorot manajer minoritas yang tidak memilikinya dan harus menerima kenyataan peringkatnya anjlok.
   * *Pesta Non-Owner:* Saat pemain template gagal mencetak penalti atau terkena kartu merah, sorot keuntungan bagi tim yang berani tampil beda.
6. **Pergeseran Peta 4 Juara Liga (Championship Shift Impact):**
   * Selisih poin antara Rank 1 dan Rank 2 yang menyempit menjadi di bawah 5 poin.
   * Kemunculan tim kejutan dari papan tengah yang tiba-tiba memimpin klasemen Juara Gameweek dengan torehan poin tertinggi sementara.

---

## 3. Desain Visual & Pengalaman Pengguna (News Ticker UI)

### A. Visual Style & Entity Highlighting (Pewarnaan Entitas FPL)
Sesuai standar siaran resmi, teks berita mengalir tanpa label tag kaku (`IMPACT:`, `NEWS:` dihapus total), menggunakan tipografi elegan di atas latar gelap bertekstur halus:

* **Nama Pemain:** Hijau Neon Fluorescent (`#00ff87`, font-bold).
* **Nama Tim Manajer:** Biru Langit / Cyan (`#38bdf8`, font-bold).
* **Nama Klub EPL:** Amber Emas (`#fbbf24`, font-semibold).
* **Angka Poin / Selisih / Peringkat:** Putih Bersih Tebal (`text-white`, font-extrabold).
* **Narasi Penghubung:** Abu-abu terang / Off-White (`text-slate-200`, font-medium).
* **Pemisah Antar Berita:** Dot bercahaya lembut (`•`) dengan jarak konsisten 32px.

### B. Perilaku Ticker (Continuous Loop & Anti-Jitter)
* Berita berjalan secara mulus dari kanan ke kiri menggunakan animasi CSS berbasis transformasi hardware-accelerated (`translateX`).
* Fitur jeda otomatis saat kursor berada di atas ticker (*pause on hover*), memberi waktu pengguna membaca berita penting dengan tenang.
* Toggle setting di menu preferensi untuk menyalakan/mematikan news ticker kapan saja.

---

## 4. Arsitektur Teknis & Rekayasa Prompt Gemini AI

### A. Pemilihan Model & Konfigurasi Server-Side
* **Model:** `gemini-3.8-flash` (cepat, hemat biaya, penalaran kontekstual tinggi, output JSON konsisten).
* **SDK:** `@google/genai` resmi di server Express (`server.ts`).
* **Header Telemetry:** `'User-Agent': 'aistudio-build'` pada `httpOptions`.
* **Keamanan Kunci API:** Diambil langsung dari `process.env.GEMINI_API_KEY` di server; tidak pernah diekspos ke klien.

### B. Payload Konteks yang Diberikan ke Gemini AI
Server menyiapkan data agregat ringkas (bukan JSON raksasa) untuk menghemat token dan mempercepat respons:
1. **Status Gameweek & Fase Pertandingan:** (Not Started, Live laga berjalan menit X, Provisional menunggu audit Opta BPS, Confirmed pasca penguncian).
2. **Kondisi 4 Juara Terkini:**
   - Siapa pemuncak Rank 1 & Rank 2 beserta selisih poinnya.
   - Siapa pemegang Juara Terbanyak (Most GW Champion) saat ini.
   - Siapa calon Juara Gameweek saat ini dan torehan poinnya.
3. **Daftar Peristiwa Kunci (Top 3-5 Hotspots):**
   - Pemain dengan poin tertinggi di laga yang baru saja/sedang berjalan.
   - Manajer mana yang mengapteni pemain tersebut vs manajer yang tidak memilikinya.
   - Kasus penyesalan transfer nyata (pemain yang dijual mencetak poin lebih banyak dari pemain yang dibeli).
   - Kasus poin tinggi tersangkut di bangku cadangan.
   - Pemanfaatan chip dan pengurangan poin hit.

### C. System Instruction Gemini AI (Karakter Jurnalis Olahraga Resmi)
```
Anda adalah jurnalis olahraga resmi FPL Nusantara BERHADIAH (FNB League).
Tugas Anda adalah merangkai teks siaran berita berjalan (news ticker) yang bernas, tajam, faktual, dan mendalam.

Aturan Penulisan Mutlak:
1. FOKUS PADA AKIBAT KEPUTUSAN: Jangan hanya melaporkan gol/assist pemain. Selalu hubungkan dengan keputusan manajer (transfer in/out, start vs bench, kapten/VC, hits, kepemilikan).
2. KAITKAN DENGAN 4 GELAR JUARA: Sorot bagaimana setiap peristiwa mengancam atau memperkuat posisi tim menuju: Peringkat 1, Peringkat 2, Juara Terbanyak, atau Juara Gameweek.
3. PERSONA RESMI & OBJEKTIF: Gunakan nada jurnalis investigatif siaran berita resmi. Lugas dalam mengabarkan keberhasilan taktik maupun blunder fatal.
4. STRUKTUR ENTITAS: Tandai entitas dalam teks dengan format khusus agar dapat di-highlight warna oleh frontend:
   [P:Nama Pemain], [T:Nama Tim], [C:Klub EPL], [N:Angka/Poin/Peringkat].
5. DUA BAHASA: Buat versi Bahasa Indonesia (id) dan Bahasa Inggris (en) untuk setiap butir berita.
```

### D. Skema Output JSON (Response Schema)
```json
{
  "news_items": [
    {
      "id": "news_gw9_01",
      "category": "captaincy_irony",
      "headline_id": "Pilihan berani [T:Garuda FC] memasang [P:Mbeumo] sebagai kapten berbuah [N:15 Poin], memperlebar jarak [N:12 Poin] di puncak [N:Peringkat 1] dari kejaran [T:Banteng United].",
      "headline_en": "[T:Garuda FC]'s bold captaincy punt on [P:Mbeumo] pays off with [N:15 Points], stretching their lead to [N:12 Points] at [N:Rank 1] over [T:Banteng United].",
      "target_championship": "rank_1",
      "urgency": "high"
    }
  ]
}
```

---

## 5. Rencana Eksekusi Bertahap

1. **Tahap 1: Backend Data Aggregator (`src/server/newsAggregator.ts`)**
   * Membuat fungsi ekstraktor fakta cerdas yang mendeteksi:
     - 4 pemegang posisi juara (Rank 1, Rank 2, Most GW, GW Champion).
     - Delta poin live dan pergeseran peringkat sementara.
     - Perbandingan poin kapten vs wakil kapten untuk tiap tim.
     - Poin pemain bench vs starter.
     - Pemain keluar vs masuk pada histori transfer pekan aktif.
2. **Tahap 2: Integrasi Gemini AI Service (`src/server/geminiNewsService.ts`)**
   * Menginisialisasi `GoogleGenAI` dengan model `gemini-3.8-flash`.
   * Menyiapkan prompt berbasis skema terstruktur dengan caching pintar berbasis status laga/audit agar tidak melakukan pemanggilan API yang sia-sia saat tidak ada perubahan data pertandingan.
   * Endpoint API: `GET /api/fnb-news-ticker`.
3. **Tahap 3: Penyempurnaan Tampilan Frontend (`src/components/NewsTicker.tsx`)**
   * Mengimplementasikan parser entitas `[P:...]`, `[T:...]`, `[C:...]`, `[N:...]` menjadi elemen ber-syntax highlighting warna neon khas FPL.
   * Mengintegrasikan dengan animasi infinite loop scrolling marquee tanpa jeda kosong.
   * Menghubungkan tombol aktivasi pada `SettingsModal.tsx` dan integrasi bahasa (`useLanguage()`).
4. **Tahap 4: Verifikasi & Audit**
   * Menjalankan `compile_applet` dan `lint_applet`.
   * Memastikan kualitas narasi berita sesuai harapan dan merefleksikan seluruh dinamika liga secara akurat.
