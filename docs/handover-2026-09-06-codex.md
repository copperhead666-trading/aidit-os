# Handover — Aidit OS terhadap benchmark FounderOS 6 lapis

Ditulis 2026-09-06 oleh sesi Claude Code yang kehabisan kuota. Ditujukan untuk
sesi Codex yang melanjutkan. Baca seluruhnya sebelum menyentuh apa pun.

Rencana lengkap ada di `C:\Users\WIN10\.claude\plans\adaptive-foraging-forest.md`.
Berkas ini adalah keadaan terkini plus perintah berikutnya.

---

## Peranmu

Kamu **integrator**, bukan pelaksana. Owner sudah menyatakan berkali-kali:
jangan kerjakan implementasi sendiri, pakai lane yang sudah ia bayar. Kamu
menulis packet, mengirim ke lane, memverifikasi hasilnya, menggabungkan, dan
melapor. Satu penulis per berkas.

Lane yang tersedia, semuanya terbukti hidup 2026-09-06:

| Lane | Perintah | Untuk apa | Catatan terukur |
|---|---|---|---|
| CORLEONE | `node ops-watcher/corleone-dispatch.mjs "<prompt>" --effort high` | implementasi berat | 40 run, 80% berhasil, 20% timeout |
| SJAHRIR | `node ops-watcher/sjahrir-dispatch.mjs "<prompt>"` | analisis, rancangan | 38% timeout kalau diberi implementasi; **beri analisis saja** |
| HATTA | `node ops-watcher/hatta-dispatch.mjs "<prompt>"` | suntingan kecil | ~4 detik untuk tugas satu baris |
| SOEKARNO | `node ops-watcher/soekarno-dispatch.mjs "<prompt>"` | **baca-saja**, tool-nya hanya Read | satu-satunya yang bisa melihat `ventures/` |
| GIBRAN | lewat `ops-watcher/review-runner.mjs` | review | gratis |

Tiap lane menulis di worktree-nya sendiri di `D:\AI\worktrees\lane-<nama>`.
Alur bakunya:

```
cd "D:/AI/worktrees/lane-corleone"
git fetch -q origin main && git reset -q --hard origin/main
cp <packet>.md .
cd "D:/AI/Aidit OS"
node ops-watcher/corleone-dispatch.mjs "Baca <packet>.md ... Jangan commit." --effort high
```

Lalu verifikasi, commit **atas nama lane**, merge ke main, jalankan suite, push.

---

## Aturan keras — jangan dilanggar

1. **Node yang dipin, bukan node sistem.** Selalu:
   `D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs`
   Node sistem (v26) crash saat teardown SETELAH tes lulus, dan runner
   menghitungnya sebagai suite gagal. Sasaran saat ini **81/81**.
2. **`windowsHide: true` pada tiap spawn.** Owner menyatakan ulang hari ini:
   layarnya tidak boleh dipenuhi jendela konsol. `node ops-watcher/windows-hide.mjs`
   mengaudit ini; sekarang 67 call site + 4 aplikasi PM2, nol yang kurang.
3. **Jangan menulis atau mendorong ke remote venture.** Itu keputusan owner.
4. **Jangan menyunting berkas izin/hook** (`.claude/settings.json` bagian
   permissions atau hooks, `~/.claude/settings.json`). Classifier akan menolak,
   dan memang seharusnya.
5. **Komentar kode berbahasa Inggris**, walaupun packet ditulis Indonesia.
6. **Jangan merge perubahan perilaku tanpa tes.** Sudah terjadi sekali hari ini
   dan saya kembalikan lane-nya untuk menulis tes.
7. **`pm2 reload` merusak Paperclip.** Verb yang benar `restart`, dan ia butuh
   ~3 menit karena menjalankan doctor saat start. Sabar, jangan simpulkan rusak.

---

## Yang sudah selesai hari ini

Semua sudah di `main` dan sudah di-push. HEAD: `548e783`.

| Perbaikan | Bukti |
|---|---|
| Ledger beku sejak 2026-09-04 karena 401 ditelan | ledger menulis lagi, mengejar 34 event |
| Alarm drift reconcile tiap 5 menit | heartbeat **18/18** stabil berjam-jam |
| Fault tak tersembuhkan tidak pernah dilaporkan | eskalasi sekali lalu diam; 6 tes |
| Probe lane 4 s membunuh lane sehat | 12 s; lima lane UP stabil |
| Cockpit terbit ke internet publik | tailnet saja (`tailscale serve`) |
| PM2 tanpa `windowsHide` | keempat app `windowsHide=true`, terverifikasi hidup |
| `edit_file` HATTA tidak bisa menyunting berkas CRLF | bisa; HATTA lalu menyelesaikan tugas yang tadi gagal |
| gbrain tidak punya mesin | G-Brain nyata: 10 berkas, 40 potongan, query hibrida |
| Executor hanya bisa memilih 2 dari 5 lane | kelima lane bisa dipilih; skill-matrix yang memilih |
| SOEKARNO tidak ada di `ALLOWED_SCRIPTS` | masuk |
| Papan penuh artefak uji | 43 → 35 issue terbuka; OWNER_REQUIRED 10 → 7 |
| **Status line membocorkan ~92 MB per render** | 32 yatim, 3,0 GB, dibersihkan; jalur `npx` dihapus |

Kebocoran status line itu penyebab mesin owner kehabisan memori dan membunuh
tugas latar. Lajunya satu proses tiap 20–30 detik. Kalau melihat proses
`npx ... hooks statusline` beryatim muncul lagi, kebocorannya kembali.

---

## SEDANG BERJALAN saat handover ini ditulis

Satu dispatch CORLEONE aktif di worktree `D:\AI\worktrees\lane-corleone`,
branch `lane/hands`, mengerjakan `PACKET-HANDS.md` (lapis 05 benchmark).
Sudah menghasilkan:

- `ops-watcher/mcp-probe.mjs`
- `ops-watcher/mcp-probe.regression.test.mjs`

**Langkah pertamamu:** periksa apakah dispatch itu selesai.

```
git -C "D:/AI/worktrees/lane-corleone" status --porcelain
```

Kalau `.mcp.json` sudah ada dan tesnya lulus, verifikasi lalu merge. Kalau
CORLEONE kena batas 480 detik sebelum selesai (sering terjadi hari ini,
20% run), lanjutkan dengan packet susulan yang menyebut apa yang sudah ada —
jangan mengulang dari nol.

Isi packet-nya ada di `PACKET-HANDS.md` di worktree itu. Ringkasnya: satu
`.mcp.json` di akar repo, berisi GitHub (owner sudah menyetujui, 2026-09-06),
memakai `GITHUB_TOKEN` yang sudah ada di `.env.local` — **jangan pernah menulis
nilai token ke berkas yang masuk git**. Plus `mcp-probe.mjs` yang melaporkan
tiap server sebagai terdaftar / terkonfigurasi / terjangkau secara terpisah.

---

## Urutan pekerjaan berikutnya

### 1. Selesaikan lapis 05 (sedang berjalan)
Seperti di atas.

### 2. KOL-89 — lane buta terhadap repo venture (PENGHALANG TERBESAR)

Tidak satu pun lane penulis bisa membaca `ventures/`. Terukur: ada di checkout
utama, tidak ada di ketiga worktree lane. Sebabnya `.gitignore` baris 70
mengabaikan `ventures/`, dan worktree git hanya memuat berkas terlacak.

Selama ini belum diperbaiki, **"Aidit OS mengerjakan ventures" tidak mungkin** —
hanya checkout utama dan SOEKARNO yang bisa melihat venture.

Rancangan SJAHRIR sudah tercatat lengkap di komentar KOL-89. Ringkasnya:
- tambah `deps.sourceRepo` pada `ensureLaneWorktree` (`ops-watcher/lane-worktree.mjs`),
  default tetap `REPO_ROOT` sehingga perilaku hari ini tidak berubah;
- saat `sourceRepo` ada, pisahkan path: `worktrees/<nama-repo>/lane-<lane>`,
  supaya worktree venture dan worktree OS untuk lane yang sama tidak bertabrakan;
- sinyalnya sudah ada: `VENTURE_ID:` yang disematkan `venture-planner.mjs`,
  `ventureId` di `autonomy-policy.mjs`, dan `ventureById`/`repoPath` di
  `ops-watcher/ventures.mjs` + `config/ventures.json`.

Kirim ke CORLEONE sebagai packet implementasi. Wajib ada tes.

### 3. Buktikan satu directive nyata berjalan sampai mendarat

Kolom `measured` di `node ops-watcher/lane-cost-report.mjs` masih **0 dari 63**.
Bukan karena rusak — sinyal kebenaran hanya terisi lewat
`executeApprovedDirective`, dan semua dispatch hari ini dijalankan manual oleh
integrator. Ia baru berangka saat directive nyata berjalan. Ini bukti terakhir
yang owner tunggu untuk menyebut sistemnya siap.

### 4. KOL-90 — lapis 04, ingatan antar-dispatch

Analisis SJAHRIR sudah di komentar KOL-90. Kesimpulannya: ingatan per
(lane, issueId) disimpan **di luar** worktree, dan **jangan** membuat jadwal per
lane — heartbeat global sudah cukup. Ingatan hanya boleh ditulis **setelah**
hasil terverifikasi; ingatan yang salah lebih berbahaya daripada tidak ada.

### 5. Batas wrapper 480 detik terlalu ketat

p95 CORLEONE = 480.038 ms, persis batas. Seperlima run mati di dinding, dan tiga
kali hari ini pekerjaannya sudah selesai lalu mati sebelum sempat menjalankan
suite. 45% dari seluruh waktu lane terbuang. Naikkan batasnya, atau perkecil
packet. Ini bukan alasan memangkas langganan.

---

## Keputusan yang milik owner, jangan diambil sendiri

- **KOL-87** cabut connector n8n (hanya bisa dari akun claude.ai miliknya).
- **KOL-79** catatan biaya lane hanya di satu disk.
- **KOL-80** dua papan, mana yang jadi riwayat tunggal. Catatan penting:
  **jangan hapus disk ASUS** sebelum ini diputuskan — papan lamanya masih di sana.
- **Cadangan**: ditunda ke 13 September, menunggu keputusan Google AI Plus.
- **Pemangkasan langganan**: juga 13 September. Angka pendukung ada di
  Bagian 4 rencana. Kandidat: langganan Claude kedua (SOEKARNO) dan Kimi
  (SJAHRIR). Tapi angka pemakaian mereka rendah **karena executor baru hari ini
  bisa memilihnya** — jangan memangkas atas dasar angka yang mencerminkan bug.
- **Funnel Tailscale**: sudah dimatikan atas perintahnya. Konsekuensi yang sudah
  disampaikan: cockpit hanya terbuka dari perangkat tailnet, dan iPhone-nya
  tercatat offline 2 hari. Ia belum memilih antara menyalakan Tailscale di HP
  atau menghidupkan funnel lagi.
- **CI venture merah sejak 31 Agustus**: workflow `Contracts` gagal karena lima
  galat ruff di dua berkas (`src/caveman_monitor/notify.py` dan
  `tests/unit/test_retraining_job.py`), empat bisa diperbaiki otomatis. Sudah
  didiagnosis, **tidak disentuh** — menulis ke repo venture adalah keputusannya.

---

## Cara memverifikasi bahwa sistem masih sehat

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs   # 81/81
node ops-watcher/reconcile.mjs --once                                        # tiga OK
node ops-watcher/steward.mjs --once                                          # 0 critical
node ops-watcher/windows-hide.mjs                                            # 0 tanpa windowsHide
node ops-watcher/lane-cost-report.mjs                                        # measured masih 0
node ops-watcher/gbrain.mjs query "<pertanyaan>"                             # fallback:false
```

Heartbeat harus melaporkan 18/18. Kalau 17/18, baca langkah mana yang gagal di
`ops-watcher/heartbeat-steps.jsonl` — jangan menebak.
