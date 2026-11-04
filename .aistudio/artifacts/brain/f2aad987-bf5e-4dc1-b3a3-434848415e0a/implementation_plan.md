# Rencana Implementasi: Klasifikasi Formula Berita & Manajemen Drama Score

Dokumen ini menguraikan arsitektur dan langkah implementasi untuk mengklasifikasikan seluruh formula pembentuk berita (**SYS** dan **AI**) ke dalam kategori dan sub-kategori tematik, menentukan waktu tayang berdasarkan siklus Gameweek (*Live Match / Provisional* vs *Confirmed / Resmi*), serta mengkalibrasi *drama score* berbasis metrik dinamis dengan batas (*cap*) per kategori. Rencana ini juga mencakup pembuatan modul konfigurasi terpusat dan penambahan subtab baru **"Formula & Drama"** pada Tab Admin.

---

## User Review Required

> [!IMPORTANT]
> **Hal Penting yang Perlu Diperhatikan:**
> 1. **Taksonomi Tematik vs Siklus Waktu:** Klasifikasi utama didasarkan pada **Subjek Tematik** (misal: *Perebutan Juara*, *Dinamika Klasemen & Rivalitas*, *Sorotan Bintang*, *What-If & Penyesalan Manajer*, *Aktivitas Transfer & Chip*). Di dalam subjek yang sama, formula memiliki cabang variasi teks dan aturan tayang spesifik untuk fase **Live/Provisional** (hasil sementara) dan fase **Confirmed/Final** (hasil resmi).
> 2. **Model Drama Score Dinamis Berbatas (*Bounded Metric*):** Tiap kategori memiliki *Base Score*, *Bobot Metrik Dinamis* (contoh: margin poin tipis, lompatan peringkat $\ge 5$, chip aktif, penalti minus transfer, selisih poin cadangan), serta batas minimum dan maksimum (*Cap Min-Max*) agar berita tidak melampaui rentang wajar.
> 3. **Subtab Baru Admin ("Formula & Drama"):** Memungkinkan peninjauan katalog seluruh formula (SYS & AI), simulasi perhitungan drama score secara interaktif, filter berdasarkan subjek dan generator, serta ekspor konfigurasi JSON.

---

## Proposed Changes

### 1. Fondasi Tipe Data & Skema Konfigurasi Terpusat

#### [NEW] `/src/server/newsFormulaRegistry.ts` & `/src/data/newsFormulaRegistry.ts`
- Membuat katalog master formula berita yang mencakup semua generator SYS dan generator AI Gemini.
- Struktur setiap entri formula:
  - `id`: Kode unik formula (e.g., `SYS_CHAMP_GW`, `SYS_CHAMP_MOST_GW`, `SYS_RANK_SUMMIT_KUDETA`, `SYS_CHIP_BENCH_BOOST`, `AI_RIVALRY_DUEL`, `AI_BENCH_REGRET`, `AI_TRANSFER_KARMA`).
  - `generator_type`: `'SYS'` | `'AI'`.
  - `kategori_tematik`: Subjek tematik utama (misal: `Perebutan Juara`, `Dinamika Klasemen`, `Sorotan Bintang`, `What-If & Keputusan`, `Strategi Chip & Transfer`).
  - `sub_kategori`: Detail topik (misal: `Juara Gameweek`, `Kudeta Puncak Klasemen`, `Penyesalan Bangku Cadangan`).
  - `waktu_tayang`: Array fase yang diizinkan (`['Not started', 'Live Match', 'Between Match', 'Provisional', 'Confirmed']`).
  - `variasi_siklus`:
    - `live_provisional`: Template/aturan teks bertanda "sementara" / "memimpin perolehan poin sementara".
    - `confirmed`: Template/aturan teks bertanda "resmi" / "resmi dinobatkan".
    - `not_started`: Aturan larangan tayang bila menyebut poin/rank.
  - `drama_model`:
    - `base_score`: Skor dasar (misal 70 atau 85).
    - `min_cap`: Batas minimal (misal 60).
    - `max_cap`: Batas maksimal (misal 100).
    - `metric_factors`: Bobot tambahan (e.g., margin poin $\le 2$ pts $\rightarrow +15$; kudeta peringkat 1 $\rightarrow +20$; chip aktif $\rightarrow +10$; bench poin $\ge 12 \rightarrow +15$).

---

### 2. Integrasi Engine Ticker & Penghitung Drama Score

#### [MODIFY] `/src/server/newsTickerTableService.ts`
- Menghubungkan fungsi `classifyNewsItem()` dan `createCompleteStoryRecord()` dengan `newsFormulaRegistry.ts`.
- Menerapkan kalkulasi drama score berbasis metrik dinamis otomatis sesuai formula terdaftar, menggantikan skor fallback statis `80`.
- Menyediakan endpoint API baru `/api/admin/news-formulas` untuk menyajikan daftar seluruh formula terdaftar beserta metrik batasnya ke frontend.

#### [MODIFY] `/src/server/liveJournalismEngine.ts` & `/src/server/geminiNewsService.ts`
- Menyinkronkan prompt AI dan generator fallback sistem agar metadata kategori, sub-kategori, dan bobot drama score selalu merujuk pada `newsFormulaRegistry.ts`.

---

### 3. Penambahan Subtab Baru di Tab Admin

#### [MODIFY] `/src/types.ts`
- Memperluas tipe `AdminSubTab`:
  ```ts
  export type AdminSubTab = 'news-ticker' | 'news-formula';
  ```

#### [MODIFY] `/src/components/Header.tsx`
- Menambahkan tombol subtab kedua di navigasi Admin:
  ```ts
  { id: 'news-ticker', label: 'News Ticker' },
  { id: 'news-formula', label: 'Formula & Drama' }
  ```

#### [NEW] `/src/components/TabAdminNewsFormula.tsx`
- Komponen tampilan untuk Subtab **"Formula & Drama"**:
  - **Filter Interaktif:** Filter berdasarkan Kategori Tematik, Sub-kategori, Generator (SYS vs AI), dan Siklus Waktu Tayang (Live vs Confirmed).
  - **Katalog Kartu & Tabel Formula:** Menampilkan ID formula, nama subjek, aturan teks sementara vs resmi, dan parameter drama score.
  - **Simulator Drama Score:** Panel interaktif di mana admin dapat memasukkan metrik sampel (misal: margin poin, selisih rank, bench points) dan melihat kalkulasi skor instan beserta pemotongan batas (*cap*).
  - **Pratinjau Variasi Teks:** Komparasi teks saat fase Live (hasil sementara) vs Confirmed (hasil resmi).

#### [MODIFY] `/src/components/TabAdmin.tsx`
- Mengintegrasikan navigasi subtab antara tampilan database `NewsTicker` yang sudah ada dengan komponen baru `TabAdminNewsFormula`.

---

## Verification Plan

### Automated Verification
1. **Pemeriksaan Lint & Sintaks:**
   - Jalankan `compile_applet` untuk memastikan seluruh file TypeScript, komponen React, tipe `AdminSubTab`, dan endpoint server lulus build tanpa error.
2. **Uji Perhitungan Drama Score:**
   - Menjalankan unit kalkulasi metrik dengan berbagai skenario (margin tipis, blowout, kudeta rank 1, bangku cadangan poin tinggi) guna memvalidasi batas *min_cap* dan *max_cap*.

### Manual Verification
1. **Navigasi Subtab Admin:**
   - Buka tab Admin, verifikasi adanya dua subtab: **News Ticker** dan **Formula & Drama**.
   - Beralih antar subtab dan pastikan state filter tetap tersimpan tanpa reload.
2. **Review Formula Tematik & Waktu Tayang:**
   - Periksa apakah formula Juara Gameweek menampilkan variasi teks sementara (Live) dan teks resmi (Confirmed).
   - Pastikan aturan larangan tayang poin/peringkat pada status `Not started` tertera dengan jelas.
3. **Pengujian Simulator Drama Score:**
   - Ubah slider/input metrik pada simulator di subtab Formula & Drama dan pastikan skor dinamis terhitung otomatis serta tidak pernah menembus batas kategori.
