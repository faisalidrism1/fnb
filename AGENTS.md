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


