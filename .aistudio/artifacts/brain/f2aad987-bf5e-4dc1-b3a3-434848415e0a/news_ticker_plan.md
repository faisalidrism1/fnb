# Rencana Arsitektur & Kurasi News Ticker (Running Text)
**FPL Nusantara BERHADIAH (FNB League)**

---

## 1. Filosofi Utama: "Cari Dramanya!" (Fantasy Drama Engine)

News Ticker FNB League bukan sekadar papan skor berjalan atau rekap statistik kaku. **Relevansi emosional dan dampak langsung terhadap manajer liga adalah inti dari setiap berita yang diterbitkan.**

Sistem tidak terpaku pada template kalimat baku yang dipaksakan. Sebaliknya, sistem bekerja seperti jurnalis siaran olahraga cerdas: **mendeteksi anomali, menghubungkan peristiwa lapangan dengan keputusan manajer di liga, dan mengangkatnya menjadi narasi dramatis.**

---

## 2. Format Tampilan Visual: Tanpa Tag & Pewarnaan Khusus Entitas (Entity Color-Coding)

### A. Tanpa Tag / Badge:
* Menghapus seluruh awalan label seperti `IMPACT:`, `MVP GW:`, `HITS:`, `DIFF:`, dsb.
* Berita mengalir sebagai satu kesatuan kalimat utuh yang elegan layaknya siaran berita olahraga televisi modern.

### B. Pewarnaan Khusus Entitas (*Syntax Highlighting* FPL):
Di atas latar gelap (`#161a22`), setiap entitas memiliki identitas warna khusus:
1. **Nama Pemain FPL:** Hijau Neon Fluorescent (`#00ff87` / `font-bold`).
2. **Nama Tim Manajer FNB League:** Biru Langit / Cyan (`#38bdf8` / `font-bold`).
3. **Nama Klub EPL:** Amber / Gold (`#fbbf24` / `font-semibold`).
4. **Angka Poin & Lonjakan Peringkat:** Putih Tebal / Bold Accent (`font-extrabold text-white`).
5. **Teks Narasi Penghubung:** *Off-White* lembut (`text-white/90 font-medium`).

---

## 3. Siklus Hidup Berita, Pengulangan & Eskalasi Milestone — *BARU*

### A. Eskalasi Nilai & Kejadian Terpisah (*Milestone Escalation*):
* Setiap kali terjadi perubahan nilai atau pencapaian baru (misal: **Gol 1 $\rightarrow$ Gol 2 (Brace) $\rightarrow$ Gol 3 (Hat-trick)**, atau **Assist 1 $\rightarrow$ Assist 2**, atau **Saves ke-3 $\rightarrow$ Saves ke-6**):
  * **Wajib terbit sebagai berita baru terpisah.**
  * Narasi meningkat (*escalates*) dengan intensitas drama yang jauh lebih tinggi:
    * *Gol 1 (Menit 24):* Sorot gol pembuka dan penyesalan manajer yang menjualnya.
    * *Gol 2 / Brace (Menit 58):* Muncul kembali sebagai berita baru yang menggandakan kepedihan lawan atau melipatgandakan euforia pemilik ban kapten.
    * *Gol 3 / Hat-trick:* Ledakan drama level tertinggi dalam gameweek tersebut.

### B. Cooldown Cycle & Frequency Cap (Batas Pengulangan):
* Berita yang belum ada pembaruan statistik diberi jeda (*cooldown*): minimal ada 4–5 berita lain yang melintas sebelum berita tersebut boleh muncul kembali.
* Batas maksimal putaran (*frequency cap*): maksimal 2–3 kali putaran sebelum diarsipkan (*retired*), digantikan oleh peristiwa yang lebih baru (*decay*).

### C. Evolusi Narasi (Tidak Mengulang Kalimat Persis):
* Jika sebuah peristiwa besar masih beredar di putaran kedua, mesin logika memvariasikan sudut pandangnya (misal dari fokus aksi gol bergeser ke akumulasi bonus BPS atau dampaknya ke klasemen live).

---

## 4. Arketipe Drama FPL yang Ditanamkan (The Drama Patterns)

### A. Drama Statistik Pertandingan (Saat Laga Tenang / Tanpa Gol Cepat)
* Pertandingan ketat tanpa gol diolah menjadi drama kecemasan manajer: xG tinggi vs kebuntuan gawang, atau rentetan penyelamatan kiper di bawah gempuran lawan.

### B. Kesabaran & Kesetiaan Manajer Terbayar Lunas (*Long-Term Lineup Faith*)
* Kepercayaan konsisten mempertahankan pemain di starting line-up selama berminggu-minggu akhirnya meledak dengan poin monster ($\ge 10-15$ poin).

### C. Dinamika Differential: Roket Peringkat vs Perjudian Buntung (*Differential Dynamics*)
* **Differential Meledak:** Menyoroti berapa peringkat tim pemiliknya melesat naik (`rank_change`) di klasemen liga berkat pemain pembeda tunggal.
* **Differential Gagal Total (*Failed Punt*):** Menyoroti perjudian berani yang berujung antiklimaks saat pemain pembedanya *blank*, membuat tim tertinggal jauh dari template liga.

### D. Sudut Pandang Terbalik: Derita & Pesta Non-Owner (*Inverted Template Angle*)
* **Pemain Template Meledak:** Sorot kepedihan segelintir manajer yang **TIDAK PUNYA** (*non-owners*) dan harus gigit jari melihat peringkat anjlok dihantam poin massal liga.
* **Pemain Template Gagal:** Pesta dan napas lega segelintir *non-owners* yang berhasil memangkas jarak poin.

### E. Duel Puncak & Perbedaan Aset (*Head-to-Head Differential Battle*)
* Persaingan ketat perebutan Peringkat #1 atau Juara GW dengan selisih poin tipis yang bergeser akibat aksi pemain pembeda di lapangan.

### F. Karma Transfer / Penyesalan Terbesar (*The Sold Asset Haul*)
* Pemain yang baru saja dilepas di GW aktif meledak dengan poin tinggi, sementara pemain masuk meraih poin minim (seperti kasus Jackson di GW 8).

### G. Dilema Bangku Cadangan & Tragedi Cameo Menit 89 (*Bench Agony & Cameo Curse*)
* Pemain bench meraih poin monster yang terbuang sia-sia atau terbunuh oleh cameo 1 menit starter di menit 89.

### H. Kutukan Pilihan Ban Kapten vs Wakil (*The VC Irony*)
* Kapten (C) blank 2 poin, sementara Wakil Kapten (VC) meledak dengan hat-trick / 15+ poin.

### I. Tragedi Menit Akhir & Batas 60 Menit Clean Sheet
* Kebobolan di menit $85'+$ atau ditarik keluar di menit 59 (kurang 60 detik menuju syarat sah clean sheet).

---

## 5. Logika Penentuan Nama Tim & Dwi-Bahasa

### A. Algoritma Kuantitas Tim (Nama Asli Tanpa Awalan Kata "Tim"):
* 1 Tim: `{A}`
* 2 Tim: `{A} & {B}`
* 3 Tim: `{A}, {B} & {C}`
* 4–5 Tim: `{A}, {B} dan {Sisa} tim lainnya`
* $\ge 6$ Tim: `14 tim FNB League (dipimpin {Kapten})` atau dibalik ke daftar nama minoritas *non-owners*.

### B. Dwi-Bahasa (Bilingual):
* Mendukung penuh bahasa Indonesia (`id`) dan bahasa Inggris (`fnb` / `en`).

---

## 6. Arsitektur Heuristic Story Engine & Penjadwalan Berita

1. **Continuous Production:** Sistem secara konstan mengevaluasi pertandingan, aksi transfer, dan statistik liga.
2. **Timeline + Drama Weight Scoring:**
   $$\text{Final Score} = \text{Drama Weight} \times \text{Recency Factor}$$
   * Peristiwa baru memiliki bobot tinggi dan segera masuk ke antrean secara **FIFO**.
   * Berita lama perlahan turun bobotnya seiring bergulirnya waktu (*decay*).
3. **Penyampaian Tanpa Henti (Zero Void & No Reset):**
   * Berita yang sedang melintas diselesaikan 100% sampai tuntas di kiri layar.
   * Jarak antar-berita konsisten 32px dengan pemisah dot bercahaya (`•`).

---

## 7. Segmentasi 5 Status (Konteks Munculnya Berita)

1. **`GW Confirmed` (Sebelum Deadline GW Baru / Pasca-Audit GW N):**
   * Pengesahan resmi, pesta juara mingguan, penguasa klasemen definitif, dan countdown deadline.
2. **`GW Not Started` (Setelah Deadline Lewat, Tim Terkunci, Belum Ada Kick-off Pertama):**
   * Kejutan susunan skuad, perjudian aset differential baru, perburuan kapten, dan risiko transfer hits.
3. **`Match Live` (Pertandingan Berlangsung di Lapangan):**
   * Panggung drama real-time: duel tahta, roket differential, derita non-owner, karma transfer, ancaman xG tinggi, saves kiper, dan kartu merah.
4. **`GW Live tapi Sedang Tidak Ada Match Live` (Jeda Antar-Laga / Intermission):**
   * Evaluasi laga sore, antisipasi laga malam, dan pergeseran klasemen sementara.
5. **`GW Provisional` (Seluruh 10 Laga Rampung, Menunggu Audit & Autosub FPL):**
   * Antisipasi penentuan: calon juara gameweek sementara yang menunggu audit Opta BPS dan autosub resmi FPL.

---

## 8. Status Eksekusi
* **STATUS: PERENCANAAN LENGKAP & DETAIL (MENUNGGU PERSETUJUAN EKSEKUSI).**
