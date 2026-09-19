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

## 7. Update 2026-09-19 pagi (sesi lanjutan sebelum Aidit keluar kota)

**STATUS SISTEM SEKARANG: PAUSED.** Aidit minta stop total pagi ini (`state/pause.json`
`paused:true`, `by: owner-request-2026-09-19-pagi`). PM2 juga kosong (nol app jalan -- entah
kenapa mati sendiri semalam, ditemukan begini pagi ini, bukan dimatikan sengaja sebelum permintaan
pause). **Sesi berikutnya: JANGAN nyalakan ulang / `pm2 resurrect` / `setPaused(false)` tanpa
konfirmasi Aidit dulu** -- dia yang minta berhenti, kemungkinan karena mau pergi dan belum tentu
mau sistem jalan sendiri tanpa pengawasan.

**Fase 4 (audit TSS/Central Kitchen) TIDAK LAGI BLOCKED** -- Aidit kirim scriptId:
`1a5L8BJQnWNyQyTK6_4IaIRzzATZWCIC9ZCV8xTIH8VJKkFzKbU4l2Spa` (spreadsheet "Buku Toko dan Central
Kitchen", ditemukan lewat Drive API search di ASUS, diverifikasi Aidit sendiri lewat browser).
Sudah di-clone (read-only, belum ada yang diubah) ke
`state/workspaces/tss-central-kitchen/audit/` (gitignored, bukan bagian repo). Audit awal:
- 4 file: `Code.js` (2881 baris, inti sistem), `Index.html` (2071 baris, UI web app), `Migrasi.js`
  (utilitas migrasi manual, ada mode uji coba, tidak otomatis), `appsscript.json`.
- 4 trigger waktu otomatis: `rekapHarian`, `kirimPOMalam`, `hitungRingkasLoka` (jam 20:00),
  `cekHarianKas` (jam 07:00).
- Web app: akses `ANYONE` (publik), jalan sebagai `USER_DEPLOYING`. `doGet()` cuma nyajiin shell
  HTML kosong; aksi/data asli lewat fungsi server dijaga PIN (`_siapa(pin)`, `_boleh(...)`) --
  bukan celah terbuka, tapi model keamanannya ringan (PIN doang, bukan OAuth/allowlist).
- 3 deployment ada (1 @HEAD + 2 versi "3.0") -- belum dikonfirmasi Aidit yang mana persis dipakai
  staf sehari-hari.
- **Belum lanjut ke langkah berikut instruksi-09 fase 4** (bandingkan versi lama vs rencana
  konsolidasi ARCHITECTURE.md §5) -- baru audit awal, dihentikan karena mau handoff sesi.

**Akses ASUS dikonfirmasi jalan penuh** (buat sesi berikutnya kalau perlu): Tailscale ping OK
(`asus-gray` 100.113.151.82), SSH key-based login jalan tanpa password
(`~/.ssh/id_ed25519_asus`, user `asus`, **akun admin**). Aidit sudah pasang clasp + Antigravity di
ASUS sendiri, login sebagai pusatberasmurah@gmail.com (sama dengan Lenovo).

**MCP untuk clasp -- DIPUTUSKAN SKIP.** Dicoba 2 package: `gas-clasp-mcp` (rusak/tidak
respons sama sekali, setahun tidak di-update) dan `@shivaduke28/google-apps-script-mcp` (perlu
setup GCP OAuth project baru dari nol, bukan tinggal pasang). Keputusan Aidit: cukup pakai `clasp`
CLI langsung (sudah terbukti jalan penuh buat clone+audit TSS di atas, tidak butuh MCP tambahan).
**Jangan coba pasang MCP clasp lagi kecuali Aidit minta ulang dan sudah siap bikin GCP project.**

**Ethernet Lenovo bermasalah** (di luar scope v6, dicatat biar tidak bingung lain kali): kabel LAN
nyambung fisik (1Gbps) tapi gagal dapat IP dari DHCP (`169.254.x.x`/APIPA) -- sudah dicoba lewat
extender TL-WA850RE (gagal) dan langsung ke router (masih gagal juga). Root cause belum ketemu
(bukan software Windows, sudah dicoba reset adapter). Internet jalan normal lewat WiFi, tidak
memblokir kerjaan apa pun -- cuma dicatat kalau Aidit tanya lagi nanti.

## 8. Cara lanjut sesi berikutnya (diperbarui)

1. Baca laporan ini dulu (semua, termasuk §7), lalu `docs/ARCHITECTURE.md` §2.
2. **Cek `state/pause.json` dulu.** Kalau masih `paused:true`, JANGAN resume sendiri -- tanya
   Aidit eksplisit dulu, dia yang minta stop.
3. Setelah (kalau) di-resume: `node conductor/status.mjs` -- cek gate/lane/ask.
4. Fase 4 (TSS/Central Kitchen) sekarang bisa lanjut lebih dalam -- scriptId + audit awal sudah
   ada di §7, tinggal lanjut ke rencana konsolidasi ARCHITECTURE.md §5 atau tunggu arahan spesifik
   Aidit soal script ini (belum ada instruksi "boleh ubah apa" untuk TSS, baru "audit dulu").
5. Fase 3 (AID-54 QA) dan sisa fase 6-8: sama seperti kemarin, cek §2/§5 di atas -- ask
   `sj1-google-wiring-2026-09-16` (Apps Script API + Gemini key) masih menahan AID-54.
6. Ingat: `or-nemotron-free` (lane gratis) punya riwayat fabrikasi berulang -- jangan percaya
   "ok:true" tanpa cek `git log`/`git status` langsung di workspace-nya.
7. ASUS bisa dipakai lagi (§7) kalau Aidit nyalakan lagi dan minta lanjut setup node dispatch
   kedua -- prompt aslinya ada di transkrip sesi 2026-09-18 (chat, bukan file tersimpan).
