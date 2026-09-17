# SPEC — "Bisa dipakai Aidit": Operasional Katering SJ1

Ditulis sesi instruksi-06 (2026-09-17). Definisi kriteria "siap dipakai", bukan rancangan teknis
baru — sistemnya sudah dibangun (lihat PRD lengkap: `state/workspaces/sj1-katering/*/PRD.md`,
sumber `E:\Business\Katering Harian ANP\Sederhana Jaya 1\PRD.md`). Minta konfirmasi Aidit.

## Siapa penggunanya

- **Aidit** (project manager SJ1): buka Google Sheet `SJ1 Ops – ANP` tiap hari untuk lihat
  pesanan, kas, piutang; approve/kirim dokumen (invoice, surat jalan, kwitansi) ke ANP; pegang
  HP untuk cek dashboard & ringkasan Telegram.
- **Pekerja kasual** (masak/packing/driver): scan QR code cetak sekali untuk daftar, scan lagi
  tiap datang kerja → absensi otomatis tercatat, tidak perlu isi form.
- **ANP Films (klien)**: terima dokumen jadi (PDF) — surat jalan tanda tangan basah saat terima
  barang, invoice, quotation, kwitansi, rekap termin mingguan.

## Alur harian (ringkas)

1. Pagi: Aidit/PIC isi baris di sheet `Pesanan` (tanggal, sesi, menu, pax) — atau sudah terisi
   dari pola rutin.
2. Sistem hitung otomatis: harga per paket, total, nomor surat jalan & invoice (script Apps
   Script, `LockService` supaya nomor tidak bentrok).
3. Pengiriman: surat jalan dicetak (PDF), driver bawa, ANP tanda tangan terima.
4. Pekerja scan QR di lokasi kerja → `Absensi` + `Roster` cocok otomatis; upah harian dihitung
   & dibayar hari itu juga (`slipUpahHarian`), `Kas Harian` update sendiri.
5. Jumat: `rekapTermin()` jalan, `Rekap Piutang` + PDF rekap untuk ANP dibuat; Aidit tagih.
6. Pembayaran ANP masuk → `catatPembayaran()` + `buatKwitansi()`.
7. Aidit cek `Dashboard`/ringkasan harian kapan saja tanpa harus buka semua sheet satu-satu.

## Output yang Aidit terima

- Dokumen PDF siap kirim: surat jalan, invoice, quotation, kwitansi, rekap termin, slip upah.
- Dashboard di Sheet (ringkasan hari ini: sesi, kas, piutang, peringatan) — **rapi** (bagian dari
  KAT-20, sedang dikerjakan ulang).
- Ringkasan harian singkat lewat Telegram (bila diaktifkan) — **tanpa** data keuangan/karyawan
  mentah, cuma ringkasan + path dokumen (garis merah instruksi-05/06).
- Web app absensi yang dipakai pekerja (tidak perlu Aidit sentuh, kecuali koreksi manual).

## Kriteria selesai ("bisa dipakai")

1. `node apps-script/check.mjs` dan `node apps-script/test-logic.mjs` di workspace venture lulus
   (0 gagal) — fungsional inti benar secara kode.
2. `?p=tes` (route web app berkunci) jalan nyata di Sheet live: semua kasus lulus, **tidak**
   meninggalkan sampah (baris `[TES]`, nomor dokumen terbakar) — ini KAT-21/AID-70.
3. Dokumen PDF (invoice, surat jalan, quotation, kwitansi, rekap, slip upah) rapi: logo & badge
   Halal proporsional, margin benar, tidak ada teks membungkus aneh, font Plus Jakarta Sans
   ter-embed (bukan fallback) — ini KAT-20/AID-69 & KAT-15/AID-63 poin font.
4. QA visual (`docs qa/LAPORAN.md`, rubrik `RUBRIK.md`) skor ≥ 8/10 tiap dokumen, atau daftar
   perbaikan konkret tersisa — ini KAT-8/AID-54.
5. Aidit sudah lihat minimal 1 dokumen contoh tiap jenis dan bilang "oke, ini bisa dipakai" —
   **konfirmasi manusia tetap wajib** sebelum dipakai ke transaksi nyata dengan ANP, karena ini
   pekerjaan pertama Sederhana Jaya 1 yang menyangkut uang & tanda tangan pihak luar.

## Yang BUKan cakupan sesi ini

Membangun ulang atau menambah fitur baru di luar 4 tiket (KAT-8/15/20/21) yang sudah dikerjakan.
Perubahan skema Sheet/PRD besar butuh keputusan baru dari Aidit, bukan diasumsikan.

## ASUMSI

- "Bisa dipakai" diartikan: **siap dipakai untuk pesanan nyata pertama**, bukan "sempurna 100%
  di semua edge case" — perbaikan kecil boleh menyusul selama sudah dipakai.
- Rincian aturan beban roster (maks shift/orang/hari dll.) mengikuti nilai default di `Master`
  sampai Aidit memberi angka pasti (PRD baris 28-29: "detail aturan menyusul dari Bapak").
