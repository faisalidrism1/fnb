# Dokumentasi Master Sistem News Ticker (Running Text)
**FPL Nusantara BERHADIAH (FNB League)**

Dokumen ini merupakan panduan dan spesifikasi baku sistem News Ticker FNB League yang mencakup seluruh aspek operasional, standar format redaksional (non-teknis), hingga arsitektur rekayasa perangkat lunak (teknis).

---

## 1. Filosofi & Pendekatan Produk (Non-Teknis)

News Ticker FNB League berfungsi sebagai siaran berita berjalan layaknya *sports news channel* modern yang menyajikan realitas kompetisi manajer secara faktual, dinamis, dan relevan.

### Prinsip Utama:
1. **Relevansi Emosional & Dampak Nyata:**
   Setiap peristiwa lapangan EPL selalu dihubungkan dengan dampaknya terhadap klasemen dan nasib tim-tim manajer di FNB League (kepemilikan, perolehan poin, transfer, dan perebutan tahta).
2. **Zero-Hyperbole & Faktual (Anti-AI Slop):**
   Dilarang menggunakan kata-kata bombastis yang tidak berpijak pada data (seperti *"meroket tajam"*, *"terjun bebas"*, *"singgasana suci"*, atau tanda seru `!`). Seluruh bobot drama dibangun dari kontras angka konkret dan konsekuensi manajerial.
3. **Perspektif Kehilangan Potensi Riil (Anti-Hypothetical):**
   Dilarang menggunakan kata pengandaian (seperti *"Andai"*, *"Seandainya"*, *"Jika saja"*). Analisis keputusan alternatif disajikan dari sudut pandang fakta kerugian atau kehilangan potensi poin riil yang dialami tim.

---

## 2. Format Tampilan Visual & Syntax Highlighting

Berita disajikan mengalir secara horizontal di atas latar gelap tanpa badge/label awalan kaku (`IMPACT:`, `MVP:`, dll.), dengan pewarnaan entitas otomatis (*Entity Syntax Highlighting*):

| Tipe Entitas | Kode Tag | Tampilan Warna di UI | Keterangan |
|---|:---:|:---:|---|
| **Tim Manajer Liga** | `[T:Nama Tim]` | Cyan / Sky Blue (`#38bdf8`, `font-bold`) | Nama tim peserta FNB League |
| **Pemain EPL** | `[P:Nama Pemain]` | Hijau Neon (`#00ff87` / `text-emerald-400`, `font-bold`) | Nama pemain resmi FPL |
| **Klub EPL** | `[C:Nama Klub]` | Kuning Emas (`#fbbf24`, `font-semibold`) | Nama klub Premier League |
| **Angka / Poin / Peringkat** | `[N:Nilai]` | Amber / Emerald Badge (`font-extrabold`) | Skor, poin, selisih, chip, atau peringkat |
| **Teks Narasi Penghubung** | Teks biasa | Putih Halus (`text-slate-200 / font-medium`) | Kalimat narasi pendukung |

* **Pemisah Antar-Berita:** Bullet bercahaya `•` dengan jarak margin horizontal proporsional (`mx-5`).

---

## 3. Aturan Universal Kuantitas Tim (AI & Non-AI)

Berlaku secara mutlak di seluruh modul pembuatan berita saat menyebutkan daftar tim:

* **Jumlah Tim $\le 3$ (Wajib Sebutkan SEMUA Nama Tim):**
  * 1 Tim: `[T:Nama Tim]`
  * 2 Tim: `[T:Tim A] dan [T:Tim B]` *(EN: `[T:Tim A] and [T:Tim B]`)*
  * 3 Tim: `[T:Tim A], [T:Tim B], dan [T:Tim C]` *(EN: `[T:Tim A], [T:Tim B], and [T:Tim C]`)*
* **Jumlah Tim $> 3$ (Sebutkan 2 Nama Tim Pertama & Sisa $n$ Tim Lainnya):**
  * 4 Tim: `[T:Tim A], [T:Tim B], dan [N:2] tim lainnya` *(EN: `[T:Tim A], [T:Tim B], and [N:2] other teams`)*
  * 5 Tim: `[T:Tim A], [T:Tim B], dan [N:3] tim lainnya` *(EN: `[T:Tim A], [T:Tim B], and [N:3] other teams`)*
  * 8 Tim: `[T:Tim A], [T:Tim B], dan [N:6] tim lainnya` *(EN: `[T:Tim A], [T:Tim B], and [N:6] other teams`)*

---

## 4. Spesifikasi 5 Kategori Berita Baku

### KATEGORI 1: Update Skor Pertandingan Berjalan (Match Live)
* **Karakteristik:** Berasal dari mesin live journalism deterministik (non-AI), diperbarui secara realtime tiap menit.
* **Format:**
  * **ID:** `Pertandingan [C:Klub1] vs [C:Klub2] sedang berlangsung di menit [N:XX'] dengan skor [N:X - X]. Gol: [P:Pencetak1] ([C:Klub1]), [P:Pencetak2] ([C:Klub2]). Assist: [P:Pembuat1] ([C:Klub1]).`
  * **EN:** `Match between [C:Club1] and [C:Club2] is currently at [N:XX'] with the score at [N:X - X]. Goals: [P:Scorer1] ([C:Club1]), [P:Scorer2] ([C:Club2]). Assists: [P:Assister1] ([C:Club1]).`
* *(Catatan: Saat jeda babak pertama, keterangan menit digantikan keterangan `pada jeda babak pertama (Half Time)` / `at Half Time`).*

---

### KATEGORI 2: Kejadian Lapangan Berpengaruh ke Poin Pemain
* **Karakteristik:**
  * Menghilangkan penyebutan klub dan kapten pada header pemain.
  * Kepemilikan tim liga menggunakan istilah `pemilik` (EN: `owners`, atau `1 owner`).
  * Perubahan poin instan disandingkan langsung dengan kata aksi kejadian menggunakan helper modular `formatPlayerAction(type, count, deltaPts)`.
  * Diakhiri informasi poin sementara: `Poin sementara: [N:X Poin].` (EN: `Provisional points: [N:X Pts].`).
* **9 Event Lapangan:**
  1. **Gol:**
     * `[P:Pemain] ([N:X pemilik]) mencetak 1 gol (+Y Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].` *(atau `2 gol (+2Y Poin)` jika $\ge 2$ gol)*
  2. **Assist:**
     * `[P:Pemain] ([N:X pemilik]) memberikan 1 assist (+3 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].` *(atau `2 assist (+6 Poin)`)*
  3. **Saves Kiper ($\ge 3$ saves):**
     * `[P:Pemain] ([N:X pemilik]) melakukan 6 penyelamatan (+2 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  4. **Defensive Contribution (DefCon):**
     * `[P:Pemain] ([N:X pemilik]) mencapai 10 aksi defensif (+2 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  5. **Penalti Ditepis:**
     * `[P:Pemain] ([N:X pemilik]) menepis 1 penalti (+5 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  6. **Penalti Gagal:**
     * `[P:Pemain] ([N:X pemilik]) gagal mengeksekusi 1 penalti (-2 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  7. **Kartu Kuning:**
     * `[P:Pemain] ([N:X pemilik]) menerima 1 kartu kuning (-1 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  8. **Kartu Merah:**
     * `[P:Pemain] ([N:X pemilik]) menerima kartu merah (-3 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`
  9. **Gol Bunuh Diri:**
     * `[P:Pemain] ([N:X pemilik]) mencetak 1 gol bunuh diri (-2 Poin) vs [C:Lawan]. Poin sementara: [N:Z Poin].`

---

### KATEGORI 3: Performa Tim Mingguan & Pergerakan Klasemen FNB League
* **Karakteristik:**
  * Memuat nama tim, klausa chip (jika aktif), raihan poin gameweek, penalti transfer `[N:-4]` (jika ada), nomor GW, pergerakan posisi klasemen, dan total poin akumulatif.
  * Nama chip menggunakan nama resmi: `formatChipName()` (`Triple Captain`, `Bench Boost`, `Free Hit`, `Wildcard`).
* **Format:**
  * **Naik Peringkat:**
    * **ID:** `[T:Nama Tim] [yang menggunakan [N:Chip]] memperoleh [N:X] poin [N:-Y] di GW [N:Z], dan naik [N:A] peringkat dari posisi [N:B] ke peringkat [N:C] sementara FNB League dengan total poin [N:T].`
    * **EN:** `[T:Team] [using [N:Chip]] scored [N:X] points [N:-Y] in GW [N:Z], and moved up [N:A] places from position [N:B] to rank [N:C] in FNB League with [N:T] total points.`
  * **Turun Peringkat:**
    * **ID:** `[T:Nama Tim] [yang menggunakan [N:Chip]] memperoleh [N:X] poin [N:-Y] di GW [N:Z], dan turun [N:A] peringkat dari posisi [N:B] ke peringkat [N:C] sementara FNB League dengan total poin [N:T].`
    * **EN:** `[T:Team] [using [N:Chip]] scored [N:X] points [N:-Y] in GW [N:Z], and dropped [N:A] places from position [N:B] to rank [N:C] in FNB League with [N:T] total points.`
  * **Peringkat 1 Bertahan:**
    * **ID:** `[T:Nama Tim] [yang menggunakan [N:Chip]] memperoleh [N:X] poin [N:-Y] di GW [N:Z], dan bertahan di peringkat [N:1] klasemen sementara FNB League dengan total poin [N:T].`
    * **EN:** `[T:Team] [using [N:Chip]] scored [N:X] points [N:-Y] in GW [N:Z], and holds rank [N:1] in provisional FNB League table with [N:T] total points.`
  * **Peringkat Lain Tertahan:**
    * **ID:** `[T:Nama Tim] [yang menggunakan [N:Chip]] memperoleh [N:X] poin [N:-Y] di GW [N:Z], dan tertahan di peringkat [N:C] sementara FNB League dengan total poin [N:T].`
    * **EN:** `[T:Team] [using [N:Chip]] scored [N:X] points [N:-Y] in GW [N:Z], and holds rank [N:C] in provisional FNB League table with [N:T] total points.`

---

### KATEGORI 4: 4 Kategori Juara FNB League (Status GW Final / Confirmed)
Hanya terbit ketika Gameweek telah resmi berstatus **`GW Final`** (`data_checked === true` DAN `event_status.leagues === "Updated"`):

1. **Juara Gameweek (GW Champion):**
   * *Aturan Khusus:* Tidak menyebutkan penalti minus, sebutkan chip (bila ada), tidak menyebutkan kapten, dan wajib menyebutkan pemain dengan poin tertinggi di starting XI (raw points tanpa multiplier).
   * **ID:** `[T:FC Kancil] [yang menggunakan [N:Triple Captain]] resmi dinobatkan sebagai Juara Gameweek [N:9] FNB League dengan raihan [N:88] poin, ditopang [P:Palmer] yang menyumbang [N:15] poin.`
   * **EN:** `[T:FC Kancil] [using [N:Triple Captain]] is officially crowned FNB League Gameweek [N:9] Champion with [N:88] points, led by [P:Palmer] who contributed [N:15] points.`

2. **Peringkat 1 Klasemen (Calon Juara Umum Musim):**
   * *Aturan Khusus:* Langsung menyebutkan nama tim pesaing peringkat 2 (tanpa frasa umum *"pesaing terdekatnya"*).
   * **ID:** `[T:Sunda Kelapa] menempati peringkat [N:1] klasemen sementara FNB League hingga GW [N:9] dengan total [N:542] poin, unggul [N:14] poin atas [T:Bintang Timur].`
   * **EN:** `[T:Sunda Kelapa] holds rank [N:1] on the FNB League table through GW [N:9] with [N:542] points, leading by [N:14] points over [T:Bintang Timur].`

3. **Peringkat 2 Klasemen (Calon Runner-Up Umum Musim):**
   * *Aturan Khusus:* Langsung menyebutkan nama tim pemuncak peringkat 1 (tanpa frasa umum *"posisi puncak"*).
   * **ID:** `[T:Bintang Timur] menempati peringkat [N:2] klasemen sementara FNB League hingga GW [N:9] dengan raihan [N:528] poin, terpaut [N:14] poin dari [T:Sunda Kelapa].`
   * **EN:** `[T:Bintang Timur] holds rank [N:2] on the FNB League table through GW [N:9] with [N:528] points, trailing [T:Sunda Kelapa] by [N:14] points.`

4. **Juara Terbanyak (Most GW Champion):**
   * *Klausul Pelimpahan Resmi:* Jika tim pemegang rekor kemenangan terbanyak berada di Peringkat 1 atau 2 klasemen umum, hak gelar dialihkan ke tim di bawahnya pada tabel Most GW.
   * **Format Tanpa Pelimpahan:**
     * **ID:** `[T:Kuda Hitam] memimpin perburuan Juara Terbanyak FNB League dengan koleksi [N:3] kemenangan mingguan hingga GW [N:9].`
     * **EN:** `[T:Kuda Hitam] leads the Most GW Champions race in FNB League with [N:3] weekly titles through GW [N:9].`
   * **Format Dengan Pelimpahan:**
     * **ID:** `[T:Garuda FPL] memegang status Juara Terbanyak FNB League ([N:2] gelar) melalui klausul pelimpahan resmi, karena [T:Sunda Kelapa] berada di posisi dua teratas klasemen.`
     * **EN:** `[T:Garuda FPL] holds the FNB League Most GW Champions spot ([N:2] titles) via the official pass-down rule, as [T:Sunda Kelapa] occupies the top two overall standings.`

---

### KATEGORI 5: What-If Keputusan Manajer (AI Newsroom)

* **Aturan Mutlak Ironi Ban Kapten:**
  * Kiper (GKP) dan Bek (DEF) **TIDAK LAZIM** dijadikan kapten dalam FPL. Dilarang keras menjadikan bek atau kiper berpoin besar sebagai bahan perbandingan ironi kegagalan kapten.
  * Pembanding kapten alternatif **HANYA BOLEH berasal dari pemain menyerang (Gelandang/MID atau Penyerang/FWD)** yang ada di starting XI tim tersebut.

* **Format Ironi Ban Kapten (Khusus MID & FWD):**
  * **ID:** `[T:Nama Tim] kehilangan potensi [N:X] poin di GW [N:GW] karena mengkaptenkan [P:Kapten] dibanding [P:Pemain Menyerang] yang meraih poin lebih tinggi di skuad.`
  * **EN:** `[T:Team] missed out on [N:X] potential points in GW [N:GW] by captaining [P:Captain] over [P:Attacking Player] who scored higher in the squad.`

* **Format Karma Transfer (The Sold Asset Haul):**
  * **ID:** `[T:Nama Tim] kehilangan potensi [N:X] poin di GW [N:GW] akibat melepas [P:Pemain Keluar] ([N:A] poin) dan menggantikannya dengan [P:Pemain Masuk] ([N:B] poin).`
  * **EN:** `[T:Team] missed out on [N:X] potential points in GW [N:GW] after selling [P:Player Out] ([N:A] pts) for [P:Player In] ([N:B] pts).`

* **Format Penyesalan Bangku Cadangan (Bench Agony):**
  * *(Hanya terbit jika starter di posisi terkait bermain $\ge 1$ menit, tidak terbit jika starter 0 menit karena poin bench akan masuk via autosub).*
  * **ID:** `[T:Nama Tim] kehilangan potensi [N:X] poin di GW [N:GW] karena mencadangkan [P:Pemain Bench] ([N:A] poin) dan memilih memainkan [P:Pemain Starter] ([N:B] poin).`
  * **EN:** `[T:Team] missed out on [N:X] potential points in GW [N:GW] by benching [P:Bench Player] ([N:A] pts) in favor of [P:Starter] ([N:B] pts).`

---

## 5. Siklus Hidup Penayangan Berita (5 Status Gameweek)

```
[1. Not Started]  ──>  [2. Match Live]  ──>  [3. Jeda Antar-Laga]  ──>  [4. Provisional]  ──>  [5. Confirmed/Final]
```

1. **`GW Not Started` (Setelah Deadline Lewat, Tim Terkunci, Belum Ada Kick-off Pertama):**
   * Fokus liputan strategi pra-pekan: pemain transfer favorit, aktivasi chip, perburuan kapten, penalti transfer hits. Dilarang mengulas hasil pertandingan karena laga belum dimulai.
2. **`Match Live` (Pertandingan Sedang Berlangsung di Lapangan):**
   * Menu utama: Update skor dan menit berjalan (Kategori 1), peristiwa aksi pemain (Kategori 2), pergerakan klasemen instan (Kategori 3).
3. **`Jeda Antar-Pertandingan` (Laga Selesai & Laga Berikutnya Belum Kick-off):**
   * Menu utama: Evaluasi hasil laga FT, pergeseran klasemen sementara, serta puncak penayangan Karma Transfer dan What-If keputusan manajer.
4. **`GW Provisional` (Seluruh 10 Laga Usai FT, Menunggu Audit Opta):**
   * Menu utama: Calon peraih gelar mingguan sementara, antisipasi autosub dan pengesahan BPS bonus point.
5. **`GW Confirmed / Final` (Resmi Diaudit 100%):**
   * Menu utama: Pengesahan resmi 4 Kategori Juara FNB League (Kategori 4) dan rekap performa final pekan tersebut.

---

## 6. Arsitektur Teknis & Backend Engine

### A. Modul & File Arsitektur:
1. `/src/server/liveJournalismEngine.ts`:
   * Mesin jurnalisme non-AI deterministik.
   * Menghasilkan Kategori 1 (Match Live Scores), Kategori 2 (9 Event Pemain), dan Kategori 3 (Performa Tim Mingguan).
   * Menyediakan fungsi reusable: `formatPlayerAction()`, `formatChipName()`, dan `formatTeamList()`.
2. `/src/server/newsAggregator.ts`:
   * Mengagregasi data mentah tabel liga dan pertandingan.
   * Menghitung nilai what-if matematis bersih (`netDeltaPts`), menyaring alternatif kapten khusus `MID` dan `FWD`, serta mengonsolidasikan drama pemain lintas-tim (`crossTeamPlayerDrama`).
3. `/src/server/geminiNewsService.ts`:
   * Mesin AI Newsroom autonomous menggunakan Google GenAI SDK.
   * Memproses instruksi redaksional bertingkat 8-tahap kausalitas dan anti-repetisi.
   * Mengelola *Failover Chain Model*: `['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest']`.
   * Menangani *graceful error recovery* untuk status 503 (*high demand*) dan 429 (*quota*).
   * Menyediakan `buildFallbackStories()` deterministik jika API AI mengalami kendala.
   * Menggabungkan berita live non-AI dan cerita AI (`fuseLiveStories()`).

### B. Penyimpanan Cache & Pool Berita:
* **Memory Microcache:** Respons instan (< 1 ms) saat data hash tidak berubah.
* **Persistent Disk Cache:**
  * `src/data/news_ticker_feed.json`: Cache feed aktif.
  * `src/data/news_ticker_history.json`: Riwayat sliding-window hingga 1.000 berita rotasi aktif tanpa duplikasi.
* **API Endpoint:** `GET /api/news-ticker/feed`
  * Respons payload JSON terstruktur memuat status gameweek, fase pertandingan, dan array objek berita dwibahasa (`headline_id`, `headline_en`, `drama_score`).

---

## 7. Komponen Frontend & Mesin Marquee (`NewsTicker.tsx`)

### A. Polling Data Realtime:
* Saat ada pertandingan aktif bergulir di lapangan (*live match*): Polling berkala setiap **45 detik**.
* Saat tidak ada pertandingan aktif (*jeda / non-live*): Polling berkala setiap **120 detik**.

### B. Mesin Marquee & Animasi:
* Menggunakan rendering DOM dinamis berbasis `requestAnimationFrame` untuk pergerakan running text yang mulus tanpa patah-patah (*zero-stutter*).
* **Fitur Hover-Pause:** Kecepatan marquee melambat / berhenti sementara saat kursor pengguna berada di atas ticker bar, dan kembali berjalan saat kursor keluar (*unhover*).
* **Zero Void (Tanpa Jeda Kosong):** Ticker mengalir bersambung tanpa layar kosong di akhir putaran.

### C. Pengaturan Pengguna (User Preferences):
* Opsi visibilitas News Ticker dapat diaktifkan/dinonaktifkan oleh pengguna melalui modal Pengaturan (*Settings Modal*).
* Status tersimpan secara persisten di browser (`localStorage.getItem('fnb_setting_news_ticker')`).
* Sinkronisasi realtime antar-komponen memanfaatkan custom event browser `fnb:setting-changed`.

### D. Dukungan Dwi-Bahasa (Bilingual):
* Ticker terhubung langsung dengan context bahasa aktif (`useLanguage()`):
  * Jika user memilih Bahasa Indonesia (`id`): menampilkan `headline_id`.
  * Jika user memilih Bahasa Inggris (`en`): menampilkan `headline_en`.

---

## 8. Status Verifikasi Sistem
* **Kompilasi & Linting:** 100% Lulus (`compile_applet` & `lint_applet` lolos tanpa error).
* **Endpoint API:** Teruji aktif dan mengembalikan status HTTP 200 dengan muatan 1.000 berita rotasi siap saji.
