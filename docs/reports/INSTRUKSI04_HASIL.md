# INSTRUKSI-04 — Hasil (2026-09-17 21:10 WIB)

## 1. Ringkasan

Profil Claude Orkestrator (`D:/aidit-claude-machine`) memang belum pernah login (bukan cuma
kedaluwarsa) — dicek langsung, tidak ada file kredensial. Config PM2 sudah diubah supaya
Orkestrator memakai profil sesi ini (`C:/Users/WIN10/.claude`, akun pusatberasmurah@gmail.com,
kuota segar) — dites nyata, berhasil. Codex ternyata bukan 401 lagi: sudah login, tapi akun kena
limit sampai 19 September. Lane `gpt-5.5` dinonaktifkan sementara. Circuit breaker 3x-gagal
sudah ditambahkan ke lanes.mjs (diuji, hijau). `fix/v5-recovery` sudah merge ke `v5` sejak
sebelumnya + 21 commit lanjutan. Dokumen 10 Layer direvisi dengan kutipan PRD asli, status
dikoreksi, kolom Prioritas ditambah. 4 issue arsitektur didaftarkan ke Paperclip (backlog).
**Satu langkah tersisa untuk Aidit: restart PM2 orkestrator+ops** — sesi ini tidak bisa
konek ke PM2 daemon (`EPERM`), jadi perubahan config belum aktif di proses yang berjalan.

## 2. Tugas untuk Aidit

1. Buka PowerShell biasa (bukan dari sesi Claude Code ini), jalankan:
   ```powershell
   pm2 restart orkestrator ops
   pm2 ls
   ```
   Ini mengaktifkan profil Claude baru dan circuit breaker yang sudah ditulis di config/kode.
2. (Opsional, tidak mendesak) Bila mau pakai Codex lagi sebelum 19 September: cek
   https://chatgpt.com/codex/settings/usage — beli kredit tambahan atau upgrade paket, lalu
   set `"status"` di `config/lanes.json` lane `gpt-5.5` kembali ke `ready` (hapus baris status).
3. Tidak ada tugas mendesak lain — sistem tetap jalan (tick rutin pakai GLM/deepseek) sambil
   menunggu langkah 1.

## 3. Peta profil Claude/Codex

| Proses | CLAUDE_CONFIG_DIR | CODEX_HOME | HOME/USERPROFILE |
|---|---|---|---|
| PM2 `orkestrator`/`ops`/dll (ecosystem.config.cjs, MACHINE_ENV) | ~~`D:/aidit-claude-machine`~~ → **`C:/Users/WIN10/.claude`** (diubah sesi ini) | `D:/aidit-codex-machine` | tidak diset eksplisit — mewarisi punya OS user yang menjalankan PM2 daemon (WIN10) |
| Sesi Claude Code ini | tidak diset → default `~/.claude` = `C:\Users\WIN10\.claude` | — | `C:\Users\WIN10` |

Status login (dicek keberadaan+tanggal file kredensial, isi tidak dibuka):
- `C:\Users\WIN10\.claude\.credentials.json` — ADA, diubah 2026-09-17 20:56 WIB (baru). Akun: pu***@gmail.com (dikonfirmasi `claude auth status` via status.mjs, dan tes panggilan nyata `claude -p "Balas OK"` → balas "OK").
- `D:\aidit-claude-machine` — **tidak ada file kredensial sama sekali** (belum pernah login), bukan cuma expired seperti dugaan sebelumnya.
- `D:\aidit-codex-machine\auth.json` — ADA, diubah 2026-09-16 07:12. Tes nyata (`codex exec`, CODEX_HOME=machine): **berhasil autentikasi**, tapi balasan "You've hit your usage limit ... try again at Sep 19th, 2026 10:59 PM" — jadi bukan masalah login, tapi kuota habis.
- `~/.codex` (default) juga ADA, diubah 2026-09-14 13:38 — tidak diuji (bukan yang dipakai Orkestrator).

Catatan: dokumen PRD lama (`docs/prd/PRD-AIDIT-OS-V5.1-HEMAT.md:47-51`, ditulis 15 Sep) mencatat
`~/.claude` = akun `adityainofficial` dan `pusatberasmurah` = akun mesin. Keadaan hari ini (dites
langsung) terbalik dari catatan itu: `~/.claude` sekarang berisi akun pusatberasmurah dengan
kuota segar (PRD sendiri mencatat pusatberasmurah reset Kamis 06:00 WIB — hari ini). Sesi ini
mengikuti instruksi-04 secara harfiah: pakai profil sesi ini (yang login barusan), bukan nama
akun di PRD lama.

## 4. Perubahan yang dibuat

| File | Perubahan | Cadangan | Cara batalkan |
|---|---|---|---|
| `ecosystem.config.cjs` | `MACHINE_ENV.CLAUDE_CONFIG_DIR`: `D:/aidit-claude-machine` → `C:/Users/WIN10/.claude` | `docs/reports/backups/2026-09-17/ecosystem.config.cjs.bak` | `copy` cadangan itu balik ke `ecosystem.config.cjs`, lalu `pm2 restart orkestrator ops` |
| `config/lanes.json` | Lane `gpt-5.5`: tambah `"status": "disabled"` + alasan (usage limit sampai 19 Sep) | (perubahan kecil, tidak perlu file cadangan terpisah — lihat git diff/history) | `git diff config/lanes.json` lalu hapus baris `"status": "disabled"` pada lane `gpt-5.5`, atau `git checkout -- config/lanes.json` sebelum commit ini |
| `conductor/lanes.mjs` | Tambah `recordLaneFailure`/`recordLaneSuccess` (circuit breaker 3x-gagal deterministik, instruksi-02 A.2); `LIMIT_RE` tambah literal `401` | — (kode baru, tidak menghapus apa pun) | `git checkout -- conductor/lanes.mjs` sebelum commit ini |
| `conductor/lanes.test.mjs` | File baru: 3 unit test circuit breaker (hijau) | — | hapus file bila tidak diinginkan |
| `docs/architecture/10_LAYER_AIDIT_OS.md` | Revisi instruksi-02 bagian C (lihat §6) | — (dokumentasi, riwayat ada di bagian "Riwayat revisi" file itu sendiri) | `git diff`/`git checkout` file itu |
| Paperclip | 4 issue baru: AID-101, AID-102, AID-103, AID-104 (status backlog) | — | edit/close manual di Paperclip bila tidak diinginkan |

**Tidak ada** `pm2 restart` yang berhasil dijalankan sesi ini — lihat §5.

## 5. Hasil tes

- **Claude** (profil baru, `CLAUDE_CONFIG_DIR=C:/Users/WIN10/.claude`, model Sonnet, non-interaktif): `claude -p "Balas OK"` → **berhasil**, balasan "OK".
- **Codex** (profil machine, `CODEX_HOME=D:/aidit-codex-machine`): `codex exec "Balas OK"` → **auth OK, tapi kena usage limit** sampai 19 Sep 2026 22:59 (bukan 401 lagi).
- **PM2**: `pm2 ls` / `pm2 restart` dari sesi ini **gagal** — `Error: connect EPERM \\.\pipe\rpc.sock`. Kemungkinan penyebab: PM2 daemon (`pm2_home=D:\pm2home`) berjalan di sesi Windows yang berbeda dari terminal sesi ini (aplikasi tetap online — dead-man switch & scheduled task WIN10 masih jalan — tapi named pipe RPC-nya tidak bisa dikonek dari sini). **Tidak dicoba `pm2 kill`/restart daemon** karena berisiko mematikan app yang sedang hidup tanpa kepastian bisa dihidupkan lagi dari sesi ini. Perlu Aidit jalankan dari PowerShell miliknya (lihat §2.1).
- **Tick** (5 tick nyata terakhir dari `state/ledger.jsonl`, SEBELUM restart — kode/config baru belum aktif):

  | Waktu WIB | Model | OK | Catatan |
  |---|---|---|---|
  | 18.45 | glm-5.2:cloud | ya | menunggu keputusan katering |
  | 19.15 | glm-5.2:cloud | ya | idem |
  | 19.45 | glm-5.2:cloud | ya | idem, ada catatan re: gpt-5.5 resting |
  | 20.15 | glm-5.2:cloud | ya | idem |
  | 20.45 | glm-5.2:cloud | ya | idem |

  Catatan: tick keputusan memakai `glm-5.2:cloud` (Hermes), bukan Claude — karena profil Claude
  machine belum login (sebelum perbaikan sesi ini). Ganjil: `config/lanes.json` menandai lane
  `glm-52` **disabled** sejak Tahap 3, tapi jalur keputusan tick (`company.json` decisionModel,
  bukan chain `or-*`) tetap memakainya secara terpisah — di luar cakupan instruksi ini untuk
  diperbaiki, sekadar dicatat sebagai temuan.

## 6. Status instruksi-02

- **A (stabilitas tick)**: A.1 (urutan fallback deepseek→nemotron→gemma) sudah benar sejak
  commit `e6f9460` — tidak perlu diubah. A.2 (circuit breaker 3x) — **baru ditambahkan** sesi
  ini (lihat §4), menunggu restart PM2 untuk aktif. A.3 (pantau tick) — lihat tabel §5 (data
  sebelum restart). A.4 (merge `fix/v5-recovery`→`v5`) — **sudah merge** sebelumnya (commit
  `ff6672f`), `v5` sekarang di commit `6eab091` (21 commit setelah merge itu).
- **C (revisi 10_LAYER_AIDIT_OS.md)**: selesai — kutipan PRD langsung ditambahkan
  (`docs/prd/PRD-AIDIT-OS-V5.1-HEMAT.md:33-42`, satu-satunya PRD di `docs/prd/`, isinya 6 layer
  Bennett, BUKAN 10 layer — koreksi klaim lama "diambil dari AUDIT"), status L3/L9 dikalibrasi
  jadi SEBAGIAN, kolom Prioritas ditambah, bagian "Riwayat revisi" ditambah.
- **D (backlog arsitektur)**: selesai — AID-101 (L3 kompaksi context), AID-102 (L9 gerbang
  otomatis), AID-103 (L6 rencana migrasi gbrain), AID-104 (rapikan L2+L3/L4 vs L7). Semua
  status `backlog`, tidak dikerjakan.

## 7. Status AID-73..75

Semua **`blocked`**, `assigneeAgentId` sama (`0018929a-e3c7-4a05-8b29-24c3177ff1dd` — kemungkinan
Hermes), `blockedTransitionAt` ~18.44 WIB hari ini. Tidak disentuh sesuai batasan instruksi-04.
(Ada `docs/inbox/instruksi-05-claude.md` yang baru masuk — isinya justru meminta ini dipindah
kepemilikannya ke Orkestrator; akan dikerjakan setelah laporan ini selesai, sebagai sesi/instruksi
terpisah.)
