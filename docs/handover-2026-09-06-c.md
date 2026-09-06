# Handover 2026-09-06 (C) — setelah sesi perbaikan harness dan lapis keputusan

Menggantikan `docs/handover-2026-09-06-b.md` untuk bagian "SEDANG BERJALAN" dan
"Urutan kerja berikutnya". Bagian **Peranmu**, **Aturan keras**, dan **Keputusan
yang milik owner** di `docs/handover-2026-09-06-codex.md` masih berlaku penuh —
baca ketiganya.

HEAD saat handover ini: `4cbc9cb`, sudah di-push ke `origin/main`.

---

## Langkah pertamamu

CORLEONE kehabisan kuota jendela 5 jam pada 2026-09-06 dan pulih pukul **14:52
WIB**. Kalau sekarang sudah lewat itu, kerjakan ini lebih dulu, tanpa menunggu
apa pun:

```
cd "D:/AI/worktrees/lane-corleone"
git fetch -q origin main && git reset -q --hard origin/main
cp "D:/AI/Aidit OS/docs/packets/PACKET-KOL89-P1.md" .
cd "D:/AI/Aidit OS"
node ops-watcher/corleone-dispatch.mjs "Baca PACKET-KOL89-P1.md di direktori kerjamu dan kerjakan persis seperti yang tertulis. Jangan commit. Jangan push." --effort high
```

Lalu verifikasi, commit atas nama lane, merge, jalankan suite, push. Setelah P1
mendarat, kirim `docs/packets/PACKET-KOL89-P2.md` dengan cara yang sama.

Cara memeriksa kuota CORLEONE tanpa membakar satu run pun:

```
grep -o '"rate_limits":{[^}]*}' \
  "$(ls -t "C:/Users/WIN10/.codex/sessions/2026/09/"*/rollout-*.jsonl | head -1)" | tail -1
```

`primary.used_percent` adalah jendela 5 jam, `secondary` jendela 7 hari,
`resets_at` epoch detik.

---

## Yang berubah hari ini, dan mengapa

### Repo venture pindah ke dalam `ventures/` (atas perintah owner)

```
D:/Development/Caveman Trading OS -> ventures/caveman-trading-os
D:/Development/SJS Super Apps     -> ventures/sjs-superapps
```

Sebelumnya `ventures/caveman-trading-os` hanyalah **junction** ke
`D:/Development`, dan `sjs-superapps` tidak terjangkau sama sekali dari checkout
ini meskipun registry menyebutnya `active`. Keduanya sekarang direktori nyata
dengan `.git` masing-masing. Riwayat utuh: caveman membawa commit `95445d5` yang
belum di-push dan satu stash, sjs membawa tiga berkas yang belum di-commit.

**Konsekuensi yang belum ditangani:** `.venv` milik caveman rusak setelah
pindah — isinya path absolut. Harus dibuat ulang sebelum ada pekerjaan Python di
venture itu. Owner sudah diberi tahu.

Commit: `3569db6`.

### Tujuh cacat wrapper lane, semuanya diperbaiki dengan tes

Ditemukan dengan mengaudit wrapper sebelum mengirim apa pun ke lane. Rinciannya
ada di pesan commit `288c164`; ringkasnya:

1. Tidak satu pun lane diberi tahu jatah waktunya. Sepuluh run terlama berakhir
   persis 480,0 detik — itu bentuk dibunuh, bukan bentuk selesai.
2. Prelude HATTA ada di `PRELUDES` tapi tidak pernah dipakai; CORLEONE dan
   SOEKARNO tidak punya entri sama sekali.
3. Jatah harness sama persis dengan timeout yang membunuhnya — tanpa margin.
4. Cadangan jam adalah kasus terburuk yang ditagih setiap kali: 120 detik
   dipotong tanpa syarat padahal panggilan model terukur 13–33 detik.
5. Suite tes menimpa berkas bukti harness yang asli.
6. Dispatcher membaca bukti dari pohon yang tidak dipakai run itu.
7. Timeout GIBRAN (10 menit) lebih panjang dari lapis yang membunuhnya (9 menit).

Susunan waktunya sekarang, dan harus tetap bersarang:

```
heartbeat STEP_TIMEOUT_MS      600.000 ms
ahmad-mcp-server RUN_TIMEOUT_MS 540.000 ms
wrapper lane TIMEOUT_MS         480.000 ms   (keempat lane, termasuk GIBRAN)
HATTA HARNESS_BUDGET_MS         450.000 ms   (480.000 − margin 30.000)
```

Lanjutannya di `4cbc9cb`: tiap panggilan model kini dibatasi sisa anggaran, jadi
harness yang mengakhiri run-nya sendiri, bukan dibunuh wrapper. Itu penting
karena `TerminateProcess` di Windows tidak bisa ditangkap.

### Lapis keputusan: pilihan dalam brief akhirnya jadi tombol

`decision-brief.mjs` sejak awal mewajibkan 2–5 `pilihan` berikut konsekuensinya,
tetapi `telegram-notify.mjs` hanya membaca komentar bertanda
`[DECISION OPTIONS]`, dan tidak ada jalur eskalasi yang pernah menulisnya. Jadi
setiap keputusan yang dinaikkan lewat gate yang benar tiba sebagai
SETUJUI/TOLAK/DETAIL/TUNDA generik. Sekarang `ahmad-escalate.mjs` menuliskannya.

`ops-watcher/owner-answer-watch.mjs` (baru) mencetak satu baris begitu owner
menjawab. Baca-saja. Himpunan yang diawasi bersifat **lengket**: menjawab adalah
hal yang *menghapus* label OWNER_REQUIRED, jadi watcher yang menghitung ulang
himpunannya dari label akan berhenti mengawasi tepat pada sapuan yang menjawab.

```
node ops-watcher/owner-answer-watch.mjs --follow --interval-ms 30000
```

Commit: `1de4600`.

**Terbukti hidup ujung ke ujung hari ini.** KOL-91 dinaikkan pukul 14:04,
kartunya sampai ke Telegram setelah ~240 detik (dua sapuan heartbeat) dengan
empat tombol kontekstual, owner menjawab 14:10, watcher memberi tahu sesi ini
dalam hitungan detik, dan keputusannya dijalankan pada 14:14. Enam menit dari
pertanyaan sampai tindakan.

### KOL-91 selesai

Owner memilih "Commit, lalu salin helper terbaru ke D:\AI". Dijalankan di
`df983a9`: 11 hook di-commit, 42 helper di `D:/AI/.claude/helpers` disinkronkan
dari repo, direktori lama disimpan di
`D:/AI/.claude/helpers.bak-2026-09-06-pre-sync`.

**Yang belum selesai:** dua salinan helper masih ada, jadi selisihnya akan
tumbuh lagi. Inventarisnya sekarang bersih (tidak ada berkas unik di `D:/AI`
selain cadangan), sehingga opsi junction terbuka kalau owner mau menutupnya.

### Kebocoran status line kembali, dari berkas lain

Perbaikan 2026-09-06 masuk ke `D:/AI/Aidit OS/.claude/helpers/statusline.cjs`,
tetapi sesi berjalan dengan `CLAUDE_PROJECT_DIR=D:/AI`, dan salinan di sana masih
memakai jalur `npx`. Terukur: 7 proses yatim, 719 MB, bertambah ±1 per menit.
Sudah dimatikan dan berkasnya diganti atas izin owner.

**Kalau proses `npx ... hooks statusline` yatim muncul lagi, periksa SALINAN MANA
yang dipakai lebih dulu**, bukan hanya yang di dalam repo.

---

## Keadaan sistem, terukur pada handover ini

| Yang diperiksa | Hasil |
|---|---|
| Suite ops-watcher (Node dipin) | **84/84** (82 di awal sesi) |
| Suite adversarial harness | **85/85** (79 lulus + 1 gagal di awal sesi) |
| harness-history | 11/11 |
| Heartbeat | 18/18 |
| `steward --once` | 0 critical, 0 warning, 0 gap |
| `reconcile --once` | tiga OK |
| `windows-hide.mjs` | 4 aplikasi PM2, 0 tanpa `windowsHide` |
| `mcp-probe.mjs` | github registered/configured/reachable, 23 tool |
| graphify | **9.917 node**, 695+ berkas, distempel `df983a9` |
| gbrain | `fallback:false`, hybrid, `nomic-embed-text` |
| Papan | 95 issue |

Catatan: `hatta/harness.security.test.mjs` **tidak** ikut dalam hitungan 84 —
`run-all-tests.mjs` hanya memindai `ops-watcher/*.test.mjs`. Jalankan terpisah.

---

## Pakai graphify lebih dulu, jangan buka berkas satu per satu

Owner menegur ini hari ini dan teguran itu benar. Indeksnya sudah segar sekarang.

```
node ops-watcher/gbrain.mjs query "<pertanyaan>"        # fallback harus false
node ops-watcher/graphify-refresh.mjs --once --force    # ~94 detik
```

Batasnya jujur: untuk membandingkan konstanta persis pada berkas yang sedang
diubah, baca berkasnya — indeks berumur sehari akan memberi angka kemarin. Untuk
orientasi ("di mana X dicatat", "apa yang sudah ditulis soal Y"), query dulu.

---

## Urutan kerja berikutnya

### 1. KOL-89 — lane buta terhadap `ventures/` (MASIH PENGHALANG TERBESAR)

Belum selesai. Dua packet sudah ditulis dan ada di repo:

- `docs/packets/PACKET-KOL89-P1.md` — `sourceRepo` di `lane-worktree.mjs` saja.
- `docs/packets/PACKET-KOL89-P2.md` — penyambungan `VENTURE_ID:` di tiga
  dispatcher, lewat satu resolver bersama `lane-source-repo.mjs`.

Dipecah dua karena CORLEONE 20% timeout dan HATTA sudah mati sekali pada packet
P1 utuh (2026-09-06 04:05 UTC, 396 detik, 12 turn, 19 tool call, satu berkas
ditulis, lalu kehabisan jam). Sisa pekerjaan HATTA itu masih ada di
`D:/AI/worktrees/lane-hatta` — 15 baris, satu fungsi `sourceRepoDirectoryName`,
tanpa tes. Packet P1 menyebutnya sebagai bahan yang boleh dipakai atau dibuang.

Owner sudah **mengizinkan** `git worktree add` di dalam repo venture: branch
`lane/*` lokal, tanpa commit ke main venture, tanpa push. Belum ada branch
`lane/*` di kedua repo venture.

### 2. Buktikan satu directive nyata berjalan sampai mendarat

`node ops-watcher/lane-cost-report.mjs` masih **0 dari 77**. Sudah diperiksa:
ini bukan bug. `logLaneOutcome` hanya dipanggil dari `executeApprovedDirective`
di `directive-runner.mjs`, dan tidak ada baris `kind:"outcome"` di
`ops-watcher/lane-usage.jsonl`. Angkanya jujur — belum pernah terjadi.

Rantai penuhnya: directive → rencana (CORLEONE) → kartu persetujuan Telegram →
ketukan owner → eksekusi (lane). Dua run lane dan satu ketukan. Jangan pilih
KOL-81: berlabel OWNER_REQUIRED dan sudah kena plafon rencana 2/2.

### 3. KOL-90 — lapis 04, ingatan antar-dispatch

Analisis SJAHRIR ada di komentar KOL-90. Ingatan per (lane, issueId) disimpan
**di luar** worktree. Jangan membuat jadwal per lane. Ingatan hanya ditulis
**setelah** hasil terverifikasi.

### 4. Batas 480 detik

Sebagian sudah ditangani: tiap lane sekarang **diberi tahu** jatahnya, yang
adalah tuas terbesar dan termurah. Menaikkan plafonnya sendiri masih terbuka —
ada 60 detik menganggur antara wrapper 480 dan ahmad 540. Ukur ulang setelah
beberapa run dengan prelude anggaran sebelum memutuskan; angka lama mencerminkan
lane yang tidak tahu ia sedang dikejar waktu.

---

## Hal-hal yang tidak boleh dilakukan, dipelajari hari ini

**Jangan jadikan SJAHRIR (atau lane mana pun) orkestrator.** Bukan soal
kebijakan saja: SJAHRIR hidup di dalam satu `spawnSync` berdinding 480 detik,
dan CORLEONE yang harus diawasinya punya dinding yang sama. Orkestrator akan
mati sebelum delegasi pertamanya kembali. `CLAUDE.md` juga melarangnya —
"a child may drop capabilities but cannot add tools, network, secrets, spend,
concurrency, namespaces, or delegation depth". Yang membawa pekerjaan melewati
batas sesi adalah handover, packet di repo, dan papan.

**Hati-hati dengan tanda kutip shell di Git Bash Windows.** Sesi ini berulang
kali membuat berkas nol-byte bernama `{for(const`, `0)`, `prefix` di akar repo
karena `node -e` dengan kurung di dalam perintah bash. Sesi sebelumnya menghapus
sembilan berkas serupa. Periksa `git status` setelah tiap perintah `node -e`.

**`git show origin/main:<path>` di Git Bash Windows** diubah menjadi
`origin\main;<path>` oleh MSYS. Pakai `MSYS_NO_PATHCONV=1`.

**Sisa yang belum ditelusuri:** panjang token Telegram berganti-ganti antar sweep
heartbeat — 46 pada 36 sapuan, 51 pada 4 sapuan. `.env.local` adalah satu-satunya
sumber (tidak ada di env User/Machine/Process), dan berkas itu ditolak aturan izin
sehingga tidak saya periksa. Kalau ada kartu yang tidak sampai, mulai dari sini.

**Direktori aneh:** `D:/AI/worktrees/worktrees/lane-corleone` dan `lane-hatta`
ada, bersarang satu tingkat terlalu dalam, dan `lane-hatta` dimiliki user
`CodexSandboxOffline` sehingga git menolaknya dengan "dubious ownership".
`worktrees/lane-corleone` memuat perubahan `directive-runner.mjs` yang belum
di-commit. Belum saya sentuh — periksa isinya sebelum membersihkan.

---

## Cara memverifikasi sistem masih sehat

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs   # 84/84
D:\aidit-node\node-v22.14.0-win-x64\node.exe hatta/harness.security.test.mjs # 85/85
node ops-watcher/mcp-probe.mjs                                               # github reachable
node ops-watcher/reconcile.mjs --once                                        # tiga OK
node ops-watcher/steward.mjs --once                                          # 0 critical
node ops-watcher/windows-hide.mjs                                            # 0 tanpa windowsHide
node ops-watcher/lane-cost-report.mjs                                        # measured masih 0
node ops-watcher/gbrain.mjs query "lane worktree isolation"                   # fallback:false
```

Heartbeat harus 18/18. Kalau 17/18, baca langkah mana yang gagal di
`ops-watcher/heartbeat-steps.jsonl` — jangan menebak.
