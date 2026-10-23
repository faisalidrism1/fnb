# Rencana Implementasi (Revisi 2): Jadwal Seluruh Gameweek (GW 1 - 38) di Tab Matches

## Catatan Perubahan Terkini Berdasarkan Masukan Pengguna
* **Default GW:** Tetap **Current GW** (Gameweek aktif saat ini) saat Tab Matches dibuka.
* **Dropdown GW:**
  * **Indikator Current:** Khusus pada baris Gameweek aktif saat ini (`gw === currentGW`), tetap munculkan sublabel **`Current`** (atau **`Terkini`** pada bahasa Indonesia).
  * **GW Lainnya:** Bersih dan rapi, hanya label nomor Gameweek (`GW 1`, `GW 2`, ...) tanpa label tambahan.
  * **Tinggi Dropdown:** Dibatasi sepanjang **~10 Gameweek** (`max-h-[320px] overflow-y-auto`) dan dapat di-scroll vertikal secara lancar ke atas dan bawah.
* **Navigasi Tombol `<` dan `>`:** Mendukung perpindahan Gameweek dari GW 1 hingga GW 38 dengan kontrol aktif yang presisi (tombol `<` nonaktif di GW 1, tombol `>` nonaktif di GW 38).

---

## Arsitektur & Efisiensi Data
1. **On-Demand Fetching:**
   * Data hanya dimuat saat Gameweek bersangkutan dibuka.
   * Ukuran jadwal masa depan sangat ringan (~3 - 8 KB) karena FPL belum memiliki data pemain/lineup.
2. **In-Memory Client Caching:**
   * Setiap Gameweek yang sudah dibuka disimpan di memori browser (`TabMatches.tsx`).
   * Berpindah bolak-balik antar Gameweek berkecepatan 0 ms dan tanpa konsumsi kuota ulang.

---

## Langkah Perubahan Kode

### 1. Tab Matches (`src/components/TabMatches.tsx`)
* **Daftar Penuh 38 Gameweek:**
  * Generate daftar Gameweek `1 s/d 38` (`Array.from({ length: 38 }, (_, i) => i + 1)`).
  * Default `activeGW` diinisialisasi ke `currentGW` (fallback 1).
* **Dropdown Bersih dengan Indikator Current:**
  * Konfigurasi opsi dropdown:
    ```ts
    options={all38GWs.map((gw) => ({
      value: gw,
      label: `GW ${gw}`,
      sublabel: gw === currentGW ? (language === 'id' ? 'Terkini' : 'Current') : undefined,
    }))}
    ```
  * Tambahkan `dropdownClassName="max-h-[320px] overflow-y-auto"` pada `CustomPopoverSelect` untuk membatasi tinggi tampilan setara 10 baris Gameweek dengan scrollbar vertikal.
* **Navigasi Tombol `<` dan `>`:**
  * Tombol `<` aktif untuk `activeGW > 1`.
  * Tombol `>` aktif untuk `activeGW < 38`.

### 2. Backend API (`src/server/matchesFetcher.ts`)
* Pastikan endpoint `/api/fpl-matches/:gw` menangani Gameweek 1 hingga 38 dengan stabil.
* Untuk Gameweek masa depan yang belum berjalan, kembalikan 10 pertandingan dengan kickoff time, klub kandang/tandang, status `Upcoming`, dan skor `vs`.

---

## Rencana Verifikasi
1. **Verifikasi Default:** Memastikan saat membuka Tab Matches, Gameweek yang aktif adalah Current GW.
2. **Verifikasi Dropdown:**
   * Memastikan opsi Current GW memiliki indikator "Current" / "Terkini", sedangkan opsi lainnya hanya "GW X".
   * Memastikan tinggi dropdown proporsional sepanjang ~10 baris dan dapat di-scroll hingga GW 38.
3. **Verifikasi Navigasi Tombol:** Menguji perpindahan tombol panah `<` dan `>` dari GW 1 sampai GW 38.
4. **Verifikasi Tampilan Laga Mendatang:** Memeriksa kartu laga masa depan menampilkan jam kickoff WIB, klub lawan, skor `vs`, status `Upcoming`, serta info rilis susunan pemain.
5. **Kompilasi & Lint:** Menjalankan `compile_applet` dan `lint_applet` untuk memastikan bebas kesalahan kode.
