# Handover 2026-09-06 (B) — setelah sesi Codex

Ditulis oleh sesi Claude Code yang kehabisan konteks, setelah memeriksa dan
memverifikasi pekerjaan sesi Codex. Menggantikan
`docs/handover-2026-09-06-codex.md`, yang isinya sekarang usang di bagian
"SEDANG BERJALAN". Bagian **Peranmu**, **Aturan keras**, dan **Keputusan yang
milik owner** di berkas lama masih berlaku penuh — baca keduanya.

HEAD saat handover ini: `2a96f1c`, sudah di-push ke `origin/main`.

---

## Apa yang dikerjakan sesi Codex, dan hasil verifikasinya

Tiga commit, semuanya sudah saya periksa dan uji, semuanya saya terima.

### `8922125` Stabilize lane git status under sandbox user

`ops-watcher/lane-worktree.mjs` menyisipkan `-c safe.directory=<cwd>` pada tiap
panggilan git. Sebabnya nyata: worktree lane dimiliki user lain saat dispatcher
berjalan di sandbox, dan `git status` menolak dengan "dubious ownership" —
`dirtyEntryCount` lalu mengembalikan `null`, sehingga worktree kotor terbaca
sebagai "tidak bisa dilihat". Tesnya menegaskan tiap panggilan git dimulai
dengan `-c safe.directory=`, jadi regresi ini tidak bisa kembali diam-diam.
Ikut memperbaiki `hatta/harness.mjs` di jalur yang sama. **Diterima.**

### `1682687` Add Ruflo lane context wiring

Berkas baru `ops-watcher/ruflo-lane-context.mjs`. Menyuntikkan prelude
`[RUFLO LANE CONTEXT]` ke prompt lane dan dua variabel env. Yang penting: tiap
prelude **mempersempit** wewenang, tidak melebarkan — HATTA diberitahu ia tidak
punya MCP native, GIBRAN diberitahu ia review-only, semuanya dilarang menyalakan
daemon, memasang paket, atau melebarkan akses tool. Sejalan dengan aturan
"anak boleh melepas kapabilitas, tidak boleh menambah". **Diterima.**

### `2a96f1c` Add verified GitHub MCP hand layer

**Ini lapis 05 benchmark, dan sekarang SELESAI.**

- `.mcp.json` di akar repo, satu daftar server yang diwarisi semua lane.
- Satu koneksi: GitHub, lewat biner native
  `D:\AI\tools\github-mcp-server\github-mcp-server.exe` (v1.12.0, ada checksum).
- Token **tidak** ditulis ke berkas: isinya `"${GITHUB_TOKEN}"`, nilainya tetap
  di `.env.local`. Saya periksa langsung; tidak ada rahasia yang masuk git.
- `GITHUB_READ_ONLY: "1"`, toolset dibatasi `repos,issues,pull_requests,users`.
- `_handsPolicy` membatasi pemakaian ke `copperhead666-trading/aidit-os` dan
  `copperhead666-trading/caveman-trading-os`, dan melarang tegas dipakai untuk
  kredensial broker atau akses sisi trading.
- `.gitignore` **membuang** baris yang mengabaikan `.mcp.json`. Ini disengaja
  dan aman justru **karena** berkasnya tidak memuat nilai token. Kalau nanti ada
  server yang butuh rahasia harfiah, aturan itu harus dikembalikan.
- `ops-watcher/mcp-probe.mjs` + 218 baris tes.

**Bukti lapis 05 hidup, dijalankan hari ini:**

```
node ops-watcher/mcp-probe.mjs
  server: github
    registered: yes   configured: yes   reachable: yes
    tools: 23
    reason: initialize and tools/list succeeded
    secret GITHUB_TOKEN: present (length 93)
```

Probe melaporkan panjang token, bukan nilainya. Benchmark menuntut "one honest
connection beats ten fake ones" — sekarang ada satu, dan kejujurannya terukur.

---

## Keadaan sistem, terukur hari ini

| Yang diperiksa | Hasil |
|---|---|
| Suite di Node yang dipin | **82/82** (naik dari 81; +1 dari mcp-probe) |
| Heartbeat | **18/18**, nol gagal, stabil beberapa sweep berturut |
| `steward --once` | 0 critical, 0 warning, 0 gap |
| `reconcile --once` | tiga OK |
| `windows-hide.mjs` | 4 aplikasi PM2, **0 tanpa `windowsHide`** |
| `mcp-probe.mjs` | github: registered/configured/reachable, 23 tool |
| Papan | 94 issue |

Sembilan berkas nol-byte hasil kecelakaan kutip shell sudah saya hapus. Saya
memverifikasi tiap berkas benar-benar kosong sebelum menghapus; tidak ada berkas
berisi yang disentuh.

---

## Skor terhadap benchmark FounderOS 6 lapis

| Lapis | Keadaan |
|---|---|
| 01 Orchestrator | ada — Claude Code headless, OAuth |
| 02 Back Office | ada — Paperclip :3110, heartbeat 18/18 |
| 03 Model Lanes | ada — lima lane hidup, skill matrix yang merutekan |
| 04 Worker Pool | **bentuk berbeda, belum lengkap** — worktree + Paperclip ada; yang kurang ingatan antar-dispatch (KOL-90) |
| 05 The Hands | **SELESAI hari ini** — satu koneksi terverifikasi |
| 06 The Metal | ada — Node 22.14.0 dipin, tailnet-only |

Sisa jarak ke benchmark tinggal **lapis 04**.

---

## Urutan kerja berikutnya

### 1. KOL-89 — lane buta terhadap repo venture (PENGHALANG TERBESAR)

Belum tersentuh. Tidak satu pun lane penulis bisa membaca `ventures/`: berkas itu
diabaikan `.gitignore`, dan worktree git hanya memuat berkas terlacak. Selama ini
belum diperbaiki, **"Aidit OS mengerjakan ventures" tidak mungkin**.

Rancangan SJAHRIR sudah lengkap di komentar KOL-89. Ringkasnya: tambah
`deps.sourceRepo` pada `ensureLaneWorktree` (default tetap `REPO_ROOT` sehingga
perilaku sekarang tidak berubah); saat `sourceRepo` ada, pisahkan path menjadi
`worktrees/<nama-repo>/lane-<lane>`. Sinyalnya sudah tersedia: `VENTURE_ID:` dari
`venture-planner.mjs`, `ventureId` di `autonomy-policy.mjs`, dan
`ventureById`/`repoPath` di `ops-watcher/ventures.mjs`.

Kirim ke CORLEONE sebagai packet implementasi. Wajib ada tes.

### 2. Buktikan satu directive nyata berjalan sampai mendarat

`node ops-watcher/lane-cost-report.mjs` masih berkata:
**"0 runs carry a correctness measurement and 77 do not."**

Bukan kerusakan — kolom itu hanya terisi lewat `executeApprovedDirective`, dan
semua dispatch sejauh ini dijalankan manual oleh integrator. Ini bukti terakhir
yang owner tunggu sebelum sistemnya boleh disebut siap.

Catatan dari heartbeat hari ini: `directive-runner` melaporkan
`KOL-81 reached plan attempt cap (2/2)`. KOL-81 berlabel OWNER_REQUIRED, jadi ia
memang macet menunggu owner — bukan kandidat untuk pembuktian ini. Pilih
directive yang tidak owner-blocked.

### 3. KOL-90 — lapis 04, ingatan antar-dispatch

Analisis SJAHRIR ada di komentar KOL-90. Ingatan per (lane, issueId) disimpan
**di luar** worktree. **Jangan** membuat jadwal per lane — heartbeat global sudah
cukup. Ingatan hanya boleh ditulis **setelah** hasil terverifikasi; ingatan yang
salah lebih berbahaya daripada tidak ada.

### 4. Batas wrapper 480 detik masih mencekik

Angka hari ini: **77 run, 43% waktu terbuang, 16% timeout**. Sepuluh run terlama
semuanya persis ~480.0 detik — artinya mereka dibunuh dinding, bukan selesai.
SJAHRIR 20% timeout, dan kalau diberi implementasi jauh lebih buruk. Naikkan
batasnya, atau perkecil packet. **Ini bukan alasan memangkas langganan** — angka
pemakaian lane yang rendah mencerminkan bug yang baru diperbaiki, bukan lane yang
tidak berguna.

---

## Satu hal yang menunggu keputusan, jangan diputuskan sendiri

`.claude/settings.json` **kotor di working tree** dan sengaja saya biarkan.
Isinya penulisan ulang 11 hook dari `cmd /c "IF EXIST ..."` menjadi `node ...`
langsung — pekerjaan owner sendiri lewat terminalnya, untuk menghentikan jendela
terminal berkedip. Saya tidak meng-commit-nya: menyunting berkas izin/hook adalah
hal yang tidak boleh dilakukan agen atas dirinya sendiri, dan classifier memang
menolaknya. **Tanyakan pada owner** apakah ia mau perubahan itu di-commit, lalu
biarkan ia yang menjalankan perintahnya.

---

## Cara memverifikasi sistem masih sehat

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs   # 82/82
node ops-watcher/mcp-probe.mjs                                               # github reachable
node ops-watcher/reconcile.mjs --once                                        # tiga OK
node ops-watcher/steward.mjs --once                                          # 0 critical
node ops-watcher/windows-hide.mjs                                            # 0 tanpa windowsHide
node ops-watcher/lane-cost-report.mjs                                        # measured masih 0
```

Heartbeat harus 18/18. Kalau 17/18, baca langkah mana yang gagal di
`ops-watcher/heartbeat-steps.jsonl` — jangan menebak.
