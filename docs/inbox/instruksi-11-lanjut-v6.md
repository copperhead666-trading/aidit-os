# INSTRUKSI-11 — Lanjut Aidit OS v6 (wawancara Apps Script dulu, lalu otonom)

## Sebelum mulai
1. Baca `docs/reports/INSTRUKSI09_HASIL.md` **seluruhnya** dulu (termasuk §7-8, paling baru) --
   itu laporan serah-terima sesi sebelumnya, jangan ulangi kerjaan yang sudah selesai di situ.
2. Cek `state/pause.json`. Kemungkinan besar masih `paused:true` (Aidit minta stop 2026-09-19
   pagi sebelum keluar kota). **JANGAN resume sendiri** -- itu bagian dari wawancara di bawah.
3. `node conductor/status.mjs` -- lihat kondisi board/lane/ask sekarang (bisa sudah beda dari
   laporan kemarin).

## Peran sesi ini
**Wawancara dulu soal Apps Script TSS/Central Kitchen, baru eksekutor + reviewer independen
otonom** -- lanjutan langsung instruksi-09 (dokumen `docs/inbox/instruksi-09-eksekusi-v6.md`
masih berlaku sebagai acuan urutan fase & aturan mengikat, instruksi ini cuma menambah langkah
wawancara di depan + menegaskan mode otonom).

## Langkah 1 -- WAWANCARA (wajib sebelum menyentuh kode Apps Script)
Fase 4 instruksi-09 (audit Apps Script TSS & Central Kitchen) sudah sampai tahap: scriptId
ketemu (`1a5L8BJQnWNyQyTK6_4IaIRzzATZWCIC9ZCV8xTIH8VJKkFzKbU4l2Spa`, spreadsheet "Buku Toko dan
Central Kitchen"), sudah di-clone read-only ke `state/workspaces/tss-central-kitchen/audit/`,
dan audit awal (isi file, 4 trigger, model keamanan PIN, 3 deployment) sudah tercatat di
`INSTRUKSI09_HASIL.md` §7. **Belum ada arahan Aidit soal mau diapain script ini** -- tanya
lewat Telegram (`conductor/owner.mjs` `ask()`), bukan diputuskan sendiri. Pertanyaan inti:

1. **Tujuan**: script ini mau diperbaiki (bug fix minor), dirapikan/dikonsolidasi (pola sama
   seperti katering SJ1 -- lihat `docs/ARCHITECTURE.md` §5 "Konsolidasi akun Google"), atau
   dibiarkan (cuma diaudit, tidak disentuh dulu)?
2. **Prioritas vs katering**: katering SJ1 (AID-54/70 dst.) masih jalan paralel -- TSS ini
   prioritas berapa dibanding itu?
3. **Deployment mana yang aktif**: 3 deployment ketemu (1 @HEAD + 2 versi "3.0") -- yang mana
   dipakai staf sehari-hari sekarang (link `/exec` yang di-bookmark staf)?
4. **Batasan spesifik**: ada bagian yang HARUS tidak disentuh (data transaksi live, dll.) selain
   garis merah umum di bawah?

Jangan lanjut ke perubahan kode Apps Script APA PUN sampai ini terjawab. Kalau Aidit tidak
jawab dalam waktu wajar, kerjakan fase lain (§2 di bawah) dulu -- jangan menunggu diam, sesuai
prinsip "jangan tanya ulang hal yang sudah dijawab" instruksi-09.

## Langkah 2 -- lanjutkan otonom (mode yang sudah disetujui Aidit 2026-09-18)
Setelah wawancara terkirim (terjawab atau tidak), lanjut **sepenuhnya otonom** sampai instruksi-09
selesai (fase 4 sisa -> fase 6 [L3/L5/L4/L8/L9] -> fase 7 [13 backlog] -> fase 8 [riset Caveman]),
dengan aturan main yang sudah dikonfirmasi Aidit langsung sesi sebelumnya:

- **Jangan minta konfirmasi buat lanjut ke fase berikutnya.** Jalan terus sendiri.
- **Blocker teknis apa pun -- benerin sendiri**, termasuk edit langsung ke kode harness
  (`conductor/*.mjs`, `ops/*.mjs`) kalau memang itu akar masalahnya -- ini sudah terjadi berkali-
  kali sesi lalu (guard hook Hermes, false-success detection, PM2 zombie, protected hours) dan
  disetujui eksplisit. Jangan tanya izin buat fix teknis, kecuali menyentuh sesuatu yang benar-
  benar tidak jelas cakupannya (tanya lewat Ask kalau ragu, jangan tebak).
- **KECUALI keputusan uang** -- upgrade paket, beli kredit, naikkan limit key, dll. -- itu WAJIB
  lapor/tanya Aidit dulu lewat Telegram, tidak pernah diputuskan sendiri.
- **Review independen tetap wajib** untuk setiap hasil dispatch Hermes/OpenRouter -- JANGAN
  percaya laporan lane cuma dari teks komentarnya. Cek `git log`/`git status --porcelain`
  LANGSUNG di workspace-nya sebelum menerima apa pun sebagai selesai. Pola ini menemukan 2
  fabrikasi total dari lane gratis (`or-nemotron-free`) sesi lalu -- jangan ulangi kesalahan
  percaya begitu saja.
- **Laporan ke Aidit**: kirim laporan checkpoint (Telegram, `report()`) di titik-titik wajar
  (bukan tiap langkah kecil) -- dan **laporan akhir lengkap** kalau instruksi-09 benar-benar
  selesai semua fase, atau kalau sesi terpaksa berhenti (kuota/turn budget) sebelum selesai --
  **selalu update `docs/reports/INSTRUKSI09_HASIL.md`** (atau buat `INSTRUKSI11_HASIL.md` baru
  kalau lebih rapi) sebagai jejak buat sesi berikutnya, jangan berhenti tanpa jejak.
- **Hormati "waktu terlindungi"** (22.00-05.00 WIB + akhir pekan sampai 10.00) -- sudah
  diimplementasi (`conductor/lib.mjs::isProtectedHours()`, dipakai `owner.mjs`), otomatis diam,
  tidak perlu ditangani manual.

## Garis merah (tidak berubah dari instruksi-08/09)
- Tidak ada eksekusi live/micro-live Caveman.
- `E:\Business\` hanya dibaca.
- Tidak login/logout akun apa pun tanpa izin baru dari Aidit.
- Task tanpa `acceptance_test` ditolak masuk queue.
- Satu task, satu workspace -- tidak ada dua agent menulis tempat sama.
- Semua keputusan keuangan, PRD baru, rilis staf, komunikasi keluar = wajib Ask.
- Update `docs/DECISIONS.md`/`docs/ARCHITECTURE.md` §2 tiap ada bukti baru -- jangan naikkan
  skor layer tanpa bukti uji terlampir.

## Referensi cepat
- Status/lane/board: `node conductor/status.mjs`
- Trace per-task: `node conductor/trace.mjs <id>` (AID-108, sudah live di v5)
- Dispatch: `node conductor/head.mjs --department <id> --issue <id>` (`--dry` dulu buat cek packet)
- Departemen: `product|engineering|design|qa|ops|finance|marketing|research|platform`
- ASUS (kalau perlu, cek dulu nyala/tidak): Tailscale `asus-gray` 100.113.151.82, SSH
  `~/.ssh/id_ed25519_asus` user `asus` (admin, tanpa password).
