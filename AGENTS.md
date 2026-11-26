# Konvensi Status & Identifikasi Gameweek (FPL)

Dokumen ini mencatat konvensi dan definisi standar untuk mengidentifikasi status Gameweek dari API resmi Fantasy Premier League (FPL). Istilah ini digunakan sebagai acuan baku dalam instruksi dan perintah pengembangan.

---

## 1. `GW Aktif` (Current GW)
* **Definisi:** Nomor Gameweek yang sedang berlangsung saat ini atau yang paling dekat akan bergulir.
* **Kriteria API (`/api/bootstrap-static/`):**
  - Cari objek event di array `events`:
    - Prioritas utama: `e.is_current === true`
    - Fallback (sebelum musim dimulai / masa jeda antar-musim): `e.is_next === true`
  - **Nilai:** Nilai properti **`e.id`** (angka 1 sampai 38).

---

## 2. `GW Final` vs `GW Live` (Status Pengesahan Poin & Klasemen)

### A. `GW Final` (atau `GW Confirmed`)
* **Definisi:** Gameweek yang sudah **resmi selesai 100%, seluruh poin diaudit, dan klasemen liga telah dikunci secara permanen** oleh FPL.
* **Kriteria Mutlak (Keduanya Wajib Terpenuhi):**
  1. `event.data_checked === true` (pada `/api/bootstrap-static/`)
     - Memastikan seluruh pertandingan selesai, audit Opta selesai, gol/assist sah, dan bonus point (BPS 3, 2, 1) terkunci.
  2. `event_status.leagues === "Updated"` (pada `/api/event-status/`)
     - Memastikan proses autosub (pergantian otomatis), penetapan vice-captain, pengurangan penalti hit transfer, dan klasemen mini league selesai dihitung ulang.

### B. `GW Live` (atau `GW Provisional`)
* **Definisi:** Gameweek yang **masih berjalan, belum selesai seluruh laganya, atau poin/klasemennya masih berstatus sementara (provisional)**.
* **Kriteria:** 
  - `event.data_checked === false` **ATAU** `event_status.leagues !== "Updated"`

---

## 3. Klasifikasi Data (`Data Class`: History / Live / Final)

Setiap baris data dapat diidentifikasi klasifikasinya menggunakan aturan deterministik berikut tanpa perlu mengubah skema tabel fisik database:

### A. Data Historis (`History`)
1. Semua baris data pada tabel yang **tidak memiliki field `gw`** (misalnya data master profil manajer, master pemain, dsb.).
2. Baris data pada tabel yang memiliki field `gw`, di mana nilai `gw < GW_Aktif`.

### B. Data Live / Final (`Live` / `Final`)
Baris data pada tabel yang memiliki field `gw`, di mana nilai `gw === GW_Aktif`:
* **`Final`:** Jika status `GW Aktif` saat ini telah memenuhi kriteria **`GW Final`** (`data_checked === true` DAN `leagues === "Updated"`).
* **`Live`:** Jika status `GW Aktif` saat ini masih berstatus **`GW Live`** (`data_checked === false` ATAU `leagues !== "Updated"`).

---

## 4. Alur Sinkronisasi & Aksi Container Saat Diakses User

Ketika user membuka aplikasi / mengaktifkan tab:
1. Server melakukan pengecekan ringan (`checkFplGwStatus()`) ke API FPL:
   - Mencari **`GW Aktif API`**
   - Mencari status: **`Live`** atau **`Final`** (`data_checked === true && leagues === "Updated"`)
2. Evaluasi kondisi dan eksekusi aksi:
   - **Kondisi 1 (Cold Start / Data Kosong):** Jika container belum memiliki data $\rightarrow$ **Action A** (Download penuh seluruh GW 1 s/d GW Aktif).
   - **Kondisi 2 (Pergantian GW):** Jika `GW Aktif API !== GW Aktif Container` $\rightarrow$ **Action A** (Download penuh dari awal).
   - **Kondisi 3 (GW Sama & Status Masih Live):** Jika `GW Aktif API === GW Aktif Container` dan status masih `Live` $\rightarrow$ **Action B** (Hapus data GW aktif lama di container, unduh data GW aktif terbaru saja dari API, dan gabungkan dengan data historis).
   - **Kondisi 4 (GW Sama & Status Sudah Final):** Jika `GW Aktif API === GW Aktif Container` dan data berstatus `Final` $\rightarrow$ **Action C** (Zero download, langsung sajikan data container dalam < 5 ms, dijamin 100% tidak ada data yang miss).

---

## 5. Sistem Skor Resmi & Aturan Perhitungan Poin FPL (Scoring Rules Reference)
* **Sumber Resmi:** [FPL Rules / Scoring](https://fantasy.premierleague.com/help/rules)
* **Modul Kode:** `src/utils/fplScoring.ts`

### A. Tabel Poin Resmi FPL per Aksi & Posisi

| Aksi / Statistik | GKP | DEF | MID | FWD | Keterangan & Syarat Mutlak |
|---|:---:|:---:|:---:|:---:|---|
| **Minutes Played (1 - 59 menit)** | +1 | +1 | +1 | +1 | Bermain hingga menit ke-59 (tidak termasuk injury time). |
| **Minutes Played ($\ge$ 60 menit)** | +2 | +2 | +2 | +2 | Bermain 60 menit penuh atau lebih (tidak termasuk injury time). |
| **Goal Scored (Mencetak Gol)** | +6 | +6 | +5 | +4 | Gol sah oleh pemain sesuai posisinya. |
| **Assist (Umpan Gol)** | +3 | +3 | +3 | +3 | Sentuhan akhir / kreasi gol langsung, rebound, atau dilanggar berbuah penalti sah. |
| **Clean Sheet (Nirbobol)** | +4 | +4 | +1 | 0 | **Wajib bermain minimal 60 menit** tanpa timnya kebobolan saat pemain berada di lapangan. |
| **Saves (Penyelamatan)** | +1 | 0 | 0 | 0 | **Akumulasi kelipatan 3**: Tiap 3 saves = +1 poin (`Math.floor(saves / 3)`). |
| **Penalty Saved (Tepis Penalti)** | +5 | 0 | 0 | 0 | Kiper menepis/menahan tendangan penalti langsung. |
| **Defensive Contribution (DC / DefCon)** | 0 | +2 | +2 | +2 | **Akumulasi threshold (Cap 2 pts)**:<br>• **DEF:** $\ge 10$ CBIT (Clearances + Blocks + Interceptions + Tackles)<br>• **MID / FWD:** $\ge 12$ CBIRT (+ Recoveries) |
| **Goals Conceded (Kebobolan)** | -1 | -1 | 0 | 0 | **Akumulasi kelipatan 2**: Tiap 2 gol kebobolan saat pemain di lapangan = -1 poin (`-Math.floor(gc / 2)`). |
| **Penalty Missed (Gagal Penalti)** | -2 | -2 | -2 | -2 | Penendang penalti gagal mengeksekusi penalti (ditepis/keluar). |
| **Yellow Card (Kartu Kuning)** | -1 | -1 | -1 | -1 | Tiap 1 kartu kuning. |
| **Red Card (Kartu Merah)** | -3 | -3 | -3 | -3 | Kartu merah langsung maupun dua kartu kuning (total -3). |
| **Own Goal (Gol Bunuh Diri)** | -2 | -2 | -2 | -2 | Pemain mencetak gol ke gawang sendiri. |
| **Bonus Points (BPS 3, 2, 1)** | +3, +2, +1 | +3, +2, +1 | +3, +2, +1 | +3, +2, +1 | 3 pemain dengan skor BPS Opta tertinggi di laga tersebut. |

---

### B. Klasifikasi Statistik: Akumulasi (Threshold) vs Non-Akumulasi

1. **Statistik Terakumulasi (Wajib Capai Threshold/Kelipatan untuk Bernilai Poin):**
   * **Saves (S):** `Math.floor(saves / 3) * 1` poin.
   * **Goals Conceded (GC):** `-Math.floor(goals_conceded / 2) * 1` poin (Khusus DEF/GKP).
   * **Defensive Contribution (DC / DefCon):**
     - DEF: CBIT $\ge 10 \rightarrow +2$ poin.
     - MID/FWD: CBIRT $\ge 12 \rightarrow +2$ poin.
     - Maksimal 2 poin per pertandingan.
   * **Minutes Played (MP):** 1-59 menit $\rightarrow 1$ pt; $\ge 60$ menit $\rightarrow 2$ pts.
   * **Clean Sheet (CS):** Wajib minimal $\ge 60$ menit di lapangan.
   * **Bonus Points (BPS):** Akumulasi puluhan metrik Opta sepanjang 90 menit untuk menentukan peringkat 1, 2, 3.

2. **Statistik Non-Akumulasi (Langsung Bernilai Poin Seketika):**
   * Goals Scored (+6, +5, +4)
   * Assists (+3)
   * Penalties Saved (+5)
   * Penalties Missed (-2)
   * Yellow Cards (-1)
   * Red Cards (-3)
   * Own Goals (-2)

---

### C. Bonus Points System (BPS) & Aturan Tie-Break

* **Metrik BPS Positif:**
  * Bermain s.d. 60 menit: 3 BPS; > 60 menit: 6 BPS
  * Gol: FWD (24 BPS), MID (18 BPS), DEF/GKP (12 BPS)
  * Assist: 9 BPS
  * Clean Sheet (DEF/GKP): 12 BPS
  * Menepis Penalti: 15 BPS
  * Saves per 3 kali: 2 BPS
  * Open-play cross sukses: 1 BPS
  * Big chance created: 3 BPS
  * Shot on target: 2 BPS
  * Successful tackle: 2 BPS
  * Clearances, blocks & interceptions (CBI): 1 BPS per 2 CBI
  * Key pass: 1 BPS
  * Recoveries: 1 BPS per 3 recoveries
  * Dribble sukses: 1 BPS
  * Match winning goal: 3 BPS
  * Akurasi Umpan ($\ge 30$ passes): 70-79% (2 BPS), 80-89% (4 BPS), 90%+ (6 BPS)

* **Metrik BPS Negatif:**
  * Gagal penalti: -6 BPS
  * Melanggar berbuah penalti: -3 BPS
  * Kartu kuning: -3 BPS, Kartu merah: -9 BPS
  * Gol bunuh diri: -6 BPS
  * Kebobolan per 2 gol (DEF/GKP): -4 BPS
  * Big chance missed: -3 BPS
  * Error leading to goal: -3 BPS, to attempt: -1 BPS
  * Foul conceded: -1 BPS, Offside: -1 BPS, Shot off target: -1 BPS

* **Aturan Tie-Break Bonus Point:**
  * Imbang peringkat 1: Pemain 1 & 2 mendapat **3 poin**, Pemain 3 mendapat **1 poin**.
  * Imbang peringkat 2: Pemain 1 mendapat **3 poin**, Pemain 2 & 3 mendapat **2 poin**.
  * Imbang peringkat 3: Pemain 1 mendapat **3 poin**, Pemain 2 mendapat **2 poin**, Pemain 3 & 4 mendapat **1 poin**.
  * Imbang 3 arah di peringkat 1: Ketiga pemain mendapat **3 poin** (tidak ada poin 2 & 1).

---

### D. Peraturan Khusus Substitusi & Kartu Merah

1. **Clean Sheet:** Jika pemain diganti sebelum timnya kebobolan dan telah bermain $\ge 60$ menit, pemain tersebut **tetap berhak mendapatkan Clean Sheet**, meskipun timnya kebobolan setelah ia keluar lapangan.
2. **Kartu Merah & Kebobolan:** Jika seorang pemain terkena kartu merah, ia **tetap terkena penalti kebobolan (-1 pt per 2 gol)** untuk semua gol yang masuk ke gawang timnya setelah ia diusir keluar lapangan.

---

## 6. Konvensi Fase 'Not started' & Narasi Berita

* **Definisi:** Setelah transfer deadline terlewati, game FPL **SUDAH RESMI MASUK KE GAMEWEEK N**.
* Status **'Not started'** BUKAN berarti Gameweek N belum tiba secara kalender/game, melainkan berarti seluruh pilihan tim/transfer/chip/kapten sudah terkunci di Gameweek N, namun **BELUM ADA PERTANDINGAN YANG DIMULAI (KICKOFF)** di pekan tersebut.
* **Aturan Baku Bahasa Berita:**
  - **DILARANG KERAS** menggunakan kata *"menjelang"*, *"sebelum Gameweek N"*, atau frasa lain yang mengesankan Gameweek N belum dimulai.
  - **GUNAKAN** kata/frasa *"di Gameweek [N:{gw}]"* atau *"pada Gameweek [N:{gw}]"*.
  - Khusus tampilan berita, jumlah gelar juara mingguan yang dibawa manajer saat fase *Not started* dihitung murni dari **GW 1 s.d. GW $(n - 1)$**.
  - Pada berita Most GW Rivalry (`NS_STANDINGS_WEEKLY_WINS_MOST`), **KECUALIKAN peringkat 1 dan 2 di klasemen akhir GW $(n - 1)$** dari daftar tim yang dapat ditampilkan, sehingga sorotan calon juara mingguan terbanyak berfokus pada tim-tim di luar dua besar klasemen utama (menghindari duplikasi dengan `NS_STANDINGS_TITLE_RACE`).

---

## 7. Aturan Dasar Poin Tayang & Antrean Penayangan News (Berlaku di Semua Fase)

* **Definisi Poin Tayang (`poin_tayang`):**
  - Setiap baris berita saat dimasukkan ke dalam antrean tampilan (*news ticker queue*), otomatis diberi **+1 poin tayang**.
* **Kaidah Multi-Tier Sort Wajib:**
  - Setiap kali sistem melakukan sortir kandidat berita (misal: sort by peluang main asc, peluang main desc, margin poin, dsb.):
    1. **Prioritas Utama (Tier 1):** **`poin_tayang` ASC (SELALU ASCENDING)**.
       - Menjamin berita yang belum pernah tayang / memiliki poin tayang terendah diprioritaskan lebih dulu.
       - Mencegah berita yang sama muncul 2x dalam 1 siklus putaran (terutama saat jumlah berita ganjil atau saat pertemuan sort ASC dan DESC).
    2. **Kriteria Tematik (Tier 2):** Kriteria spesifik yang diminta (misal: `peluang_main` ASC untuk Gelombang 2, `peluang_main` DESC untuk Gelombang 4, dsb.).
    3. **Tie-Breaker Deterministik (Tier 3):** Jumlah pemilik terbanyak (`ownersCount` DESC), harga termahal (`nowCost` DESC), atau ID unik.

---

## 8. Aturan Dasar Penulisan Tabel Editor & News Ticker

Aturan baku berikut wajib diterapkan pada seluruh template di Tabel Editor maupun seluruh hasil produksi berita di News Ticker:

1. **Nama Klub (Penyebutan Langsung Tab Matches):**
   - Nama klub **WAJIB** ditampilkan sebagai penyebutan langsung yang sama persis dengan **Tab Matches** (berasal dari `team.name` resmi FPL, misal: `Arsenal`, `Chelsea`, `Man City`, `Man Utd`, `Spurs`, `Nott'm Forest`, `Ipswich Town`, `Coventry City`, `Hull City`, `Leeds`, `Sunderland`, dst.).
   - **DILARANG** menggunakan singkatan 3 huruf seperti `ARS`, `CHE`, `MCI`, `EVE`, `COV`, dll. maupun nama panjang eksternal yang berbeda dari Tab Matches (seperti `Manchester City` atau `Nottingham Forest`).
2. **Nama Pemain (FPL Web Name):**
   - Nama pemain **WAJIB** ditampilkan menggunakan **`web_name`** (`webName`) persis seperti di aplikasi resmi FPL (misal: `Haaland`, `Salah`, `João Pedro`, `B.Fernandes`, `Raya`), bukan nama lengkap (`first_name + second_name`).
3. **Entitas Tim & Penggunaan Kata "Tim" (Bukan Manajer):**
   - Saat narasi template menyebutkan entitas tim/manajer, **WAJIB** menyebut **Nama Tim** (`entry_name`), **BUKAN** nama pribadi manajer (`player_name`).
   - Pada teks narasi, **WAJIB** menggunakan kata **`tim`** (atau `Tim`), **DILARANG** menggunakan kata **`manajer`** / `manager`.
4. **Istilah Klasemen ("Peringkat", Bukan "Posisi"):**
   - Selalu gunakan kata **`peringkat`** untuk penyebutan urutan/posisi di klasemen, **DILARANG** menggunakan kata **`posisi`**.
   - Istilah deskriptif seperti **`pemuncak`**, **`papan atas`**, **`papan tengah`**, **`10 besar`**, **`dasar klasemen`**, dan sejenisnya tetap dapat digunakan.

---

## 9. Standar Baku Redaksional & Gaya Bahasa Berita FPL (International FPL Media Standard)

Seluruh template narasi (`src/data/news_templates.json`, `src/data/newsTemplates.ts`) serta generator berita mengacu pada standar gaya redaksional media FPL internasional (**Official FPL Scout**, **Fantasy Football Scout**, **The Athletic FPL**) yang diadaptasi ke bahasa Indonesia jurnalistik-fantasy modern:

### A. Prinsip Utama Kalimat & Struktur
1. **Subject-First (S-P-O) & Piramida Terbalik:** Pelaku utama (`[T:...]`, `[P:...]`, atau `[C:...]`) dan aksi/dampak FPL langsung diletakkan di awal kalimat. **Hindari pembuka lambat / keterangan waktu di depan** (*"Seluruh laga tuntas; ..."*, *"Usai Gameweek N, ..."*, *"Hingga Gameweek N, ..."*, *"Mengaktifkan Wildcard..., [T:...]"*, *"Persaingan ketat:"*).
2. **Konsistensi Struktur Lintas Fase:** Topik sejenis (Chip, Autosub, Kapten Terpopuler, Title Race, Bench Points) wajib memakai pola S-P-O yang seragam antar-fase (`Not started` $\rightarrow$ `Provisional` $\rightarrow$ `Confirmed`).
3. **Kalimat Aktif & Lugas:** Subjek pelaku langsung melakukan aksi. Hindari konstruksi pasif birokratis (*"dialami oleh"*, *"diambil oleh"*, *"terjadi lewat"*, *"diaktifkan oleh"*).
4. **Padat & Headline-Ready (1–2 Fakta Inti):** Maksimal 1–2 klausa singkat (hindari menumpuk 4–5 metrik dalam satu item ticker), tanpa kata pengisi (*filler*) dan tanpa pengulangan kata dalam satu kalimat.
5. **Penyebutan Gameweek (`GW`) Selektif:** Pada *news ticker*, seluruh berita berasal dari GW aktif sehingga angka `Gameweek [N:{gw}]` **TIDAK diulang** pada berita mikro/taktikal dalam pekan berjalan (chip individual, transfer/hit, differential, cedera, autosub, poin bangku cadangan, pergerakan peringkat harian). Penyebutan `Gameweek [N:{gw}]` **hanya dipertahankan** pada:
   - Berita pembuka/lanjutan fase pekan (`NS_MATCH_FIXTURE_OPENING`, `LM_MATCH_PERIOD_START` Babak 1, `BM_MATCH_FIXTURE_NEXT`, `BM_CAPTAIN_POPULAR_RETURN` jeda panjang).
   - Ringkasan akumulatif lintas pekan (`NS_CHIP_SUMMARY_USAGE`, `CF_STANDINGS_WEEKLY_WINS_MOST`).
   - Penobatan/hasil resmi akhir pekan (`CF_STANDINGS_GAMEWEEK_WINNER`, `CF_STANDINGS_TITLE_RACE`, `CF_PLAYER_TOP_PERFORMER_GW_SCORER`).
6. **Fantasy-First Impact:** Event laga berdampak poin langsung (gol bunuh diri `-2 Poin`, penalti gagal `-2 Poin`, penalti ditepis `+5 Poin` vs `-2 Poin`, kartu merah `-3 Poin`, sub bertahan `60+` menit mengunci *clean sheet*) harus menonjolkan implikasi poin FPL-nya.
7. **Netral Terhadap Haul vs Blank:** Untuk metrik poin kapten/rekrutan yang bisa bernilai tinggi maupun rendah, gunakan verba faktual netral seperti **`membukukan`**, **`mengoleksi`**, atau **`meraih`** (hindari kata *"menyumbang"* bila pemain berpotensi blank).
8. **Presisi Bench Boost:** Gunakan frasa *"dari bangku cadangannya"* (jangan mengunci jumlah *"keempat pemain"* karena ada kemungkinan pemain cadangan berstatus DNP).
9. **Pelestarian Tag & Variabel:** Perubahan redaksional **WAJIB mempertahankan seluruh tag entitas** (`[T:...]`, `[P:...]`, `[C:...]`, `[N:...]`), variabel `{...}`, dan header `[Kondisi: ...]` yang ada di masing-masing template.
10. **Hindari Kata Penyama & Kualifikasi Janggal:** Jangan gunakan **`sama-sama`**, **`kompak`**, atau frasa klise seperti **"poin bonus final"** (aneh jika pemain hanya meraih `4 Poin` tanpa bonus). Gunakan konstruksi langsung seperti *"masing-masing dipilih [N:...]"*, *"mengoleksi poin identik"*, atau *"menutup pekan dengan [N:{captain_pts} Poin]"*.
11. **Kontras Langsung (`alih-alih`):** Untuk perbandingan kapten aktual vs kapten alternatif dengan poin lebih tinggi, gunakan konjungsi **`alih-alih`** tanpa filler *"di starting XI mereka"*.

### B. Daftar Kata/Frasa Terlarang & Padanan Bakunya

| Dihindari (Non-FPL / Tabloid / Pasif / Bertele-tele) | Padanan Baku Media FPL |
|---|---|
| `kontra` | **`vs`** (jadwal, skor, duel head-to-head: `[C:Arsenal] vs [C:Chelsea]`, `[P:Haaland] vs [P:Salah]`) atau **`melawan` / `menghadapi`** (kalimat aksi dalam laga) |
| `kubu` | Sebut langsung nama tim/klub (`[T:{team}]`, `[C:{club}]`) |
| `tahta`, `sang pemuncak` | **`puncak klasemen`**, **`pemuncak klasemen`** |
| `mempercayakan / memercayakan ban kapten`, `mengemban tanggung jawab besar pada ban kapten yang disematkan di lengannya` | **`mengapteni`**, **`memilih [P:...] sebagai kapten`**, **`menunjuk [P:...] sebagai kapten`** |
| `dialami oleh`, `diambil oleh` | Kalimat aktif: **`paling banyak dijual`**, **`memasang`**, **`mengambil langkah`** |
| `bertumpu pada`, `berambisi menambah` | **`menjadikan ... sebagai penentu`**, **`demi menambah`** |
| `berujung pengurangan` | **`dan terkena [N:-2 Poin]` / `[N:-3 Poin]`** |
| `mengawali pekan ini dengan modal pengurangan poin` | **`mengambil transfer hit dan memulai pekan dengan penalti poin`** |
| `tidak menemui sasaran` (untuk penalti gagal) | **`gagal berbuah gol ([N:-2 Poin])`** |
| `berhasil mengeksekusi tendangan penalti` | **`menuntaskan eksekusi dari titik putih`** |
| `menerima umpan dari` | **`dari assist [P:...]`** |
| `sama-sama` / `kompak` / `poin bonus final` | **`masing-masing dipilih`**, **`poin identik`**, **`menutup pekan dengan [N:...]`** |
| `(+N pekan ini)` pada ringkasan chip | **`(+N)`** (`Penggunaan chip hingga Gameweek [N:{gw}]: ...`) |
| `memainkan` (untuk chip: Wildcard, Free Hit, Bench Boost, Triple Captain) | **`mengaktifkan`** atau **`menggunakan`** |

### C. Terminologi FPL Baku (Dipertahankan dalam Bentuk Asli)
Gunakan istilah internasional FPL tanpa terjemahan kaku: **`Gameweek`**, **`Wildcard`**, **`Free Hit`**, **`Bench Boost`**, **`Triple Captain`**, **`Clean sheet`**, **`Assist`**, **`BPS`**, **`Poin Bonus`**, **`Differential`**, **`Starting XI`**, **`Autosub`**, **`Transfer hit`**, **`Defensive Contribution`**.

### D. Referensi Konvensi Update News Ticker (Hasil Review Redaksional)
1. **Perburuan Gelar Mingguan (`NS_STANDINGS_WEEKLY_WINS_MOST`, `BM_STANDINGS_WEEKLY_WINS_MOST`):**
   - Koleksi berjalan ditulis **`([N:{titles}] gelar)`** (bukan *"kali juara"*), sedangkan target akhir yang diperebutkan ditulis **`juara Gameweek terbanyak`** secara konsisten di seluruh kondisi (termasuk duel chip dan manuver chip).
   - Pada fase `Between Match`, poin GW berjalan digabungkan dalam kurung yang sama dengan format **`([N:{titles}] gelar, [N:{gw_pts} Poin] live)`**.
   - Format duel kapten & differential disederhanakan menjadi **`... dengan kapten [P:{captain1}] vs [P:{captain2}].`** dan **`... dengan kapten [P:{captain}], penentu beralih ke [P:{diff_player1}] vs [P:{diff_player2}].`**
2. **Pemisahan Kata `"sementara"` (Kata Hubung vs Status Poin/Klasemen):**
   - Kata **"sementara"** yang berfungsi sebagai kata hubung kontras wajib diganti **`sedangkan`** (misal pada duel chip/kapten/transfer: *"...mengaktifkan Free Hit, sedangkan ..."*).
   - Untuk status poin/klasemen berjalan pada fase **`Live Match`** dan **`Between Match`**, arah penulisan menggunakan **`live`** (menggantikan `sementara` pada konteks berjalan, misalnya `[N:... Poin] live`), sedangkan status untuk fase **`Provisional`** (`sementara` / `provisional` / `live`) diselaraskan saat review item terkait.
3. **Standar Penyajian Review News Ticker:**
   - Review dilakukan bertahap dari berita dengan jumlah karakter terpanjang ke terpendek, dan selalu menyajikan **kalimat berita jadi** (tanpa tag `[T:]/[P:]/[C:]/[N:]` atau `{placeholder}`) agar mudah dievaluasi keterbacaannya.
4. **Hasil & Skor Pertandingan (`BM_MATCH_SCORE_RESULT`, `LM_MATCH_PERIOD_END`, `LM_MATCH_SCORE_LIVE`):**
   - Nama stadion dipertahankan **tanpa nama kota** (hapus akhiran `, Kota` agar tetap ringkas).
   - Gunakan **`OG`** (bukan `GBD`), **`Gol:`** (bukan `pencetak gol:`), **`Half Time` / `Full Time`** (bukan `Jeda babak pertama` / `Laga usai`), **`[N:{minute}] Live:`** untuk skor berjalan, dan hilangkan koma Oxford sebelum `"dan"` pada daftar pencetak gol.
