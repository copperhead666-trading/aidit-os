# INSTRUKSI-09 — Hasil sesi (2026-09-18, sesi interaktif panjang)

## 1. Ringkasan

Fase 1-2 instruksi-09 (Layer 7 Guardrails, L1/L2/L10) **selesai dan diverifikasi**. Fase 3
(katering AID-70/AID-54) **AID-70 selesai**, AID-54 **ditahan** menunggu Aidit (butuh Google Apps
Script API dinyalakan + GEMINI_API_KEY -- ask sudah terkirim 2026-09-16, belum dijawab). Fase 4
(audit Apps Script TSS/Central Kitchen) **ditahan** menunggu scriptId dari Aidit -- clasp sudah
login benar (pusatberasmurah@gmail.com) tapi tidak ada cara otomatis menemukan scriptId tanpa link
dari Aidit. Fase 5 (SJS) tetap hold sesuai instruksi. Fase 6-8 (L3/L5/L4/L8/L9, 13 backlog,
Caveman) **belum dikerjakan** -- sesi ini sudah sangat panjang, diserahkan ke sesi berikutnya
(lihat §6).

Selain fase-fase di atas, sesi ini menemukan dan memperbaiki **3 celah keamanan/harness serius**
yang tidak diminta instruksi-09 tapi ditemukan lewat review independen berulang -- lihat §3.

## 2. Tugas untuk Aidit

1. **Jawab 2 ask yang masih terbuka** (keduanya sudah 1-2 hari, menahan fase 4 & sebagian fase 3):
   - `sj1-google-wiring-2026-09-16` -- nyalakan Google Apps Script API + kirim GEMINI_API_KEY.
   - `tss-central-kitchen-scriptid` (baru, sesi ini) -- kirim link/scriptId Apps Script TSS &
     Central Kitchen (tidak ketemu otomatis, sudah dicek komputer ini + E:/Business).
   - `l7-guard-matcher-read` -- keputusan buka guard hook ke tool `Read` (Ya/Tidak), lihat §3.
   - `prd-sjs-v5-2026-09-17` -- tinjau PRD SJS SuperApps v5 (di luar scope instruksi-09, tapi
     masih menunggu).
2. Naikkan limit key OpenRouter sudah dilakukan Aidit sendiri hari ini (dari $5) -- **beres**,
   dispatch berbayar (`or-deepseek-flash`) sudah dites jalan normal.
3. Kalau mau lanjut setup ASUS sebagai node dispatch kedua: prompt lengkap sudah diberikan
   langsung di chat sesi ini (bukan file) -- copy-paste ke Claude Code baru di ASUS.
4. Task scheduler `AiditOS-PM2-Supervisor` (punya project lama `D:\AI\Aidit OS`, bukan v5) sudah
   di-**pause** (bukan dihapus) karena salah deteksi terus-menerus dan menyebabkan ~100 proses
   node.exe menumpuk (~1GB RAM sia-sia). Kalau masih perlu, perlu ditinjau kenapa deteksinya
   salah dulu sebelum diaktifkan lagi -- jangan langsung `Enable-ScheduledTask` begitu saja.

## 3. Temuan & perbaikan harness (di luar scope tiket, ditemukan lewat review)

### 3.1 Guard hook nol proteksi untuk Hermes/OpenRouter (KRITIS)
AID-105 (Layer 7 Guardrails) cuma pasang guard untuk lane `claude-cli`/`kimi-cli`. Lane
Hermes/OpenRouter -- yang dipakai untuk hampir semua dispatch coding hari ini -- **tidak punya
guard sama sekali**. Terbukti nyata 2x: file hasil AID-102 dan AID-108 ditulis langsung ke root
repo utama, bukan workspace terisolasinya masing-masing.
- Perbaikan 1: `conductor/guard.mjs` + `D:\aidit-hermes-machine\config.yaml` (blok `hooks:
  pre_tool_call` -> guard.mjs, `fail_closed: true`) -- menutup celah utama.
- Perbaikan 2 (susulan, celah masih ada setelah #1): Hermes defaultnya mengaktifkan toolset
  `code_execution`/`browser`/`computer_use` yang bisa menulis file/kontrol OS tanpa lewat
  `write_file`/`patch`/`terminal` sama sekali -- guard berbasis nama tool tidak pernah melihatnya.
  `conductor/lanes.mjs::runHermes()` sekarang selalu memaksa `-t
  terminal,file,web,memory,todo,skills` -- toolset berbahaya itu tidak pernah ditawarkan lagi ke
  lane manapun. Diverifikasi hidup lewat `hermes hooks test`.

### 3.2 Lane bisa melapor "selesai" padahal nol kerjaan nyata
AID-70 percobaan pertama (`or-nemotron-free`, gratis): laporan sangat detail (269 baris diubah,
136 tes lulus) tapi **tidak ada satu file pun berubah di disk** -- fabrikasi total, bukan cuma
file nyasar. `head.mjs` sebelumnya percaya `ok:true` dari lane tanpa cek apakah benar ada
perubahan yang di-commit.
- Perbaikan: `conductor/head.mjs` sekarang mendeteksi "klaim selesai tapi nol file di-commit" 
  sebagai kegagalan -- tidak dipindah ke `in_review`, komentar jujur ke Paperclip, tetap di
  antrian untuk dikerjakan ulang (lane lain di chain, biasanya berbayar, terbukti jauh lebih
  reliable hari ini).

### 3.3 PM2/RAM: proses zombie `pm2/lib/Daemon.js` menumpuk
`pm2 jlist` tanpa `PM2_HOME` eksplisit kadang gagal connect ke daemon yang sudah jalan (race
named-pipe Windows, makin parah kalau RAM sempit) dan diam-diam menyalakan daemon baru yang jadi
zombie -- ~100 proses numpuk dalam beberapa jam, menghabiskan RAM sampai bikin dispatch gagal
kehabisan memori.
- Perbaikan: `ops/deadman.mjs` + `conductor/status.mjs` pin `PM2_HOME` eksplisit; sesi lain
  (paralel, lihat catatan multi-agent) menambah pembersihan otomatis (catat PID sebelum/sesudah
  tiap `pm2 jlist`, matikan yang baru muncul). Ditemukan juga task scheduler lawas
  `AiditOS-PM2-Supervisor` (project `D:\AI\Aidit OS`, bukan v5) ikut berkontribusi -- lihat §2.4.

Semua perbaikan di atas: tes ulang mandiri (bukan cuma percaya laporan lane), `node --test
conductor/*.test.mjs` tetap 0 gagal setelah tiap perubahan.

## 4. Fase yang selesai (bukti singkat)

| Fase | Tiket | Status | Bukti |
|---|---|---|---|
| 1 | AID-105 (guard hook) | in_review, diterima 4/5 kategori | `guard.test.mjs` 16/16, `hermes hooks test` |
| 1 | AID-102 (gerbang PR) | in_review, diterima | 16/16 tes, belum merge (nunggu better-sqlite3) |
| 2 | AID-108 (trace.mjs) | in_review, diterima | 8/8 tes + cocok manual ke kronologi AID-105 nyata |
| 3 | AID-70 (higiene tes katering) | in_review, diterima (percobaan ke-2) | 134/134 tes, commit `83f010b` |

## 5. Belum dikerjakan (fase 4 dst.)

- Fase 4: audit Apps Script TSS/Central Kitchen -- **ditahan**, butuh scriptId dari Aidit.
- Fase 5: SJS SuperApps -- **hold sengaja**, tidak disentuh.
- Fase 6: L3 Context, L5 Memory, L4 Tool, L8 Evals, L9 HITL sisanya -- **belum dimulai**.
  Status/celah tiap layer sudah tercatat di `docs/ARCHITECTURE.md` §2, bisa langsung jadi tiket
  Paperclip + dispatch lewat pola yang sama (buat issue Prompt Matrix lengkap -> assign ke head
  departemen -> `node conductor/head.mjs --department X --issue Y` -> review independen lulus tes
  objektif dulu baru percaya laporan).
- Fase 7: 13 backlog v6 (`docs/backlog/BACKLOG_INVENTARIS_V6.md`) -- belum disentuh.
- Fase 8: Caveman riset jam-sesi + persona -- belum disentuh.

## 6. Cara lanjut sesi berikutnya

1. Baca laporan ini dulu, lalu `docs/ARCHITECTURE.md` §2 (status terbaru semua layer).
2. `node conductor/status.mjs` -- cek gate/lane/ask masih sama atau sudah berubah.
3. Kalau 2 ask di §2.1 sudah dijawab: lanjut fase 4 (clasp clone TSS) dan fase 3 (AID-54 QA).
4. Kalau belum dijawab: lanjut fase 6 -- pilih satu layer skor terendah (L8 Evals atau L4 Tool),
   buat tiket Prompt Matrix, dispatch, review independen (JANGAN percaya laporan lane tanpa cek
   `git log`/`git status` langsung di workspace-nya -- pola ini terbukti krusial hari ini, 2x
   fabrikasi ketemu dengan cara ini).
5. Ingat: `or-nemotron-free` (lane gratis) punya riwayat fabrikasi berulang hari ini -- jangan
   percaya "ok:true" begitu saja, terutama dari lane ini.
