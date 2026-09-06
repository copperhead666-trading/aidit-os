# Handover 2026-09-06 (D) — malam, setelah loop directive berjalan untuk pertama kalinya

Menggantikan `docs/handover-2026-09-06-c.md`. Bagian **Peranmu** dan **Aturan
keras** di `docs/handover-2026-09-06-codex.md` masih berlaku, dengan satu
pengecualian yang disebut di bawah.

HEAD saat handover ini: `209c2b0`, sudah di-push ke `origin/main`.

---

## Keadaan, terukur saat menulis ini

| Yang diperiksa | Hasil |
|---|---|
| Suite ops-watcher (Node dipin) | **86/86** (82 di awal hari) |
| Suite adversarial harness | 85/85 |
| Heartbeat | **19/19**, `merge-steward` langkah ke-19 |
| `reconcile --once` | **tiga OK** |
| `merge-steward --once --no-suite` | 7,2 detik (sebelumnya 85) |
| Papan | 96 issue |
| `measured` di lane-cost-report | **masih 0** |

---

## Langkah pertamamu

Tiga directive menunggu ketukan owner di Telegram: **KOL-81, KOL-93, KOL-94**.
Jangan menunggunya. Kamu integrator — kirim pekerjaannya langsung ke lane,
verifikasi, merge. Kartu persetujuan tetap ada untuk owner, tetapi bukan
penghalang bagimu. Owner menyatakan itu tegas pada 2026-09-06 malam: keputusan
teknis milik integrator, dan ia ingin menerima sistem yang sudah jadi.

Isi masing-masing ada di `docs/packets/DIRECTIVE-KOL-93.md` dan
`DIRECTIVE-KOL-94.md`. KOL-81 rencananya ada di komentar issue-nya.

---

## Yang berubah malam ini

### KOL-89 tertutup, kedua paruh

Lane penulis sekarang bisa dipotong dari repo venture, dan packet yang menyebut
`VENTURE_ID:` merutekan lane-nya ke sana lewat `ops-watcher/lane-source-repo.mjs`.
Dibuktikan terhadap repo asli: worktree sekali pakai dari
`ventures/caveman-trading-os` memuat pohon venture, tanpa `ops-watcher/`.
Worktree dan branch bukti sudah dihapus.

### Verifikasi diff tidak lagi menunggu sesi

`ops-watcher/merge-steward.mjs` berjalan sebagai langkah heartbeat ke-19. Ia
melaporkan `idle` / `clean` / `unverified` / `blocked` / `unknown` per worktree
lane dan **tidak pernah menggabungkan apa pun**. Sifat baca-sajanya dipagari tes:
permukaan ekspornya diuji tidak memuat fungsi bernama merge, commit, push, reset,
atau clean.

Jalur heartbeat memakai `--no-suite`. Worktree yang suite-nya dilewati dilaporkan
`unverified`, **bukan** `clean` — tidak boleh ada verdict yang diam-diam
menjatuhkan pemeriksaan yang tidak pernah ia jalankan.

### Ledger akhirnya mencatat transisi rencana

`reconcile` gagal sejak loop directive pertama kali bekerja, karena
`ledger-writer` tidak pernah memancarkan `directive.plan_posted` maupun
`directive.plan_refused` walaupun skema mendefinisikannya dan lipatan
memakannya. Sekarang dipancarkan, dan penandanya **diimpor** dari
`directive-runner` supaya tidak bisa desinkron diam-diam.

Cara memverifikasi hal semacam ini: suite yang lulus hanya membuktikan writer
memancarkan jenis yang benar. Jalankan `ledger-writer --once` lalu
`reconcile --once` di `main` dan lihat `projection-vs-parser` berubah dari FAIL
ke OK. Itu barisnya.

### Gerbang venture jadi presisi, batasnya tidak bergerak

`checkPlanForVentureGitWrites` menolak KOL-92 karena polanya mencocokkan kata
`merge` di dalam nama modul `merge-steward`. Sekarang memakai lookaround yang
menolak kata kerja yang menjadi bagian identifier bertanda hubung. Tujuh kasus
penolakan diuji satu per satu. **Larangan menulis ke venture tidak berubah** —
itu batas milik owner, dan `compareVentureGitPosition` tetap utuh.

### Kedipan terminal di layar owner

Bukan `windowsHide` yang hilang; audit 72 call site bersih. Penyebabnya
`merge-steward` men-spawn satu `node --check` per berkas berubah, dan menghitung
berkas berubah terhadap `origin/main` alih-alih HEAD worktree sendiri. Branch tua
mewarisi tiap berkas yang main geser: `lane-w2` melapor 145, padahal 1.

**447 spawn per sapuan, 441 di antaranya untuk worktree yang lane-nya tidak
pernah sentuh.** Setelah diperbaiki: `lane-w2` melapor 1, sapuan 7,2 detik,
`conhost` per menit turun 80 → 24.

---

## Roster lane: catatan lama sudah terbantah

Owner meminta beban disebar supaya cacat tiap lane ketemu. Terbayar dalam semalam.

| Lane | Malam ini | Catatan lama |
|---|---|---|
| SJAHRIR | **2 dari 3** — 214 s / 9 turn, 355 s / 27 turn, satu dinding 480 s | "38% timeout kalau diberi implementasi, beri analisis saja" — **jangan pakai ini untuk merutekan** |
| CORLEONE | 2 mendarat, 3 dinding | masih andal, bukan satu-satunya |
| HATTA | **0 dari 1**, nol berkas ditulis | satu panggilan model **81 detik**, pagi ini 13–33 |

SJAHRIR mengerjakan perbaikan gerbang keamanan dan dua perubahan steward. HATTA
gagal pada pasangan berkas 8 KB + 14,6 KB, jadi batasnya bukan sekadar ukuran
berkas — itu belum terjelaskan dan layak diselidiki.

---

## Kebiasaan yang terbukti menghemat, pakai ini

**Taruh koordinat di packet.** Sebutkan nomor baris dan suruh lane membaca dengan
offset dan limit. HATTA pernah menghabiskan 20 iterasi membaca satu berkas 67 KB
utuh lalu mati tanpa menulis apa pun. Satu grep olehmu menghapus itu.

**Tulis tanda hubung ASCII di packet, jangan em-dash.** `apply_patch` codex gagal
berulang pada em-dash; dua run mati di dinding 480 detik karenanya. Setelah
instruksi ini dipasang, run berikutnya mendarat di bawah dinding.

**`gbrain query` untuk dokumen, `grep` untuk lokasi kode.** gbrain hanya
mengindeks `knowledge/store/notes/*.md` — ia tidak tahu apa-apa soal kode.
`graphify-analyst.mjs` bisa menjawab pertanyaan struktural kode tetapi
**men-dispatch SJAHRIR**, jadi satu pertanyaan sama dengan satu run berbayar.
Jangan bayar lane untuk mencari nomor baris.

---

## Jebakan yang memakan waktu, tercatat supaya tidak diulang

**Deskripsi issue Paperclip terpotong di 1200 karakter.** `directive-runner`
merencanakan dari judul dan deskripsi saja; ia tidak membaca komentar. Directive
yang lebih panjang menyerahkan setengah tugas tanpa ada yang tahu. Taruh badan
lengkap di `docs/packets/` dan biarkan deskripsi menunjuknya.

**Komentar `PLAN_REFUSED` bersifat terminal.** Issue-nya diklasifikasikan
`rejected` selamanya dan tidak pernah direncanakan ulang, berapa pun hitungan
percobaan yang tertulis di komentar penolakan. Kalau sebuah directive ditolak
karena kata-katanya, buat penggantinya; jangan menunggu percobaan kedua.

**`--only` menyaring nama dasar berkas.** `--only lane-worktree` bekerja;
`--only ops-watcher/lane-worktree.regression.test.mjs` memilih **nol** suite dan
tetap mencetak `passed`. Hijau tanpa menguji apa pun lebih buruk daripada merah.
Sebuah rencana directive pernah menulis bentuk yang salah itu.

**Git Bash Windows.** `git show origin/main:<path>` diubah jadi
`origin\main;<path>`; pakai `MSYS_NO_PATHCONV=1`. Dan `node -e` dengan kurung di
dalam perintah bash membuat berkas nol-byte bernama `{for(const` di akar repo —
periksa `git status` setelahnya.

---

## Yang masih terbuka

1. **`measured` masih 0 dari 90.** Bukan bug: `logLaneOutcome` hanya dipanggil
   dari `executeApprovedDirective`, dan belum ada directive yang dieksekusi.
   Butuh satu directive disetujui owner lalu dijalankan loop.
2. **KOL-90**, ingatan antar-dispatch. Analisis ada di komentarnya.
3. **HATTA belum terjelaskan.** Nol dari satu pada berkas kecil setelah harness
   diperbaiki. Panggilan 81 detik menunjuk model atau endpoint, bukan harness.
4. **Panjang token Telegram berganti antar sapuan** — 46 pada sebagian, 51 pada
   sebagian lain. `.env.local` satu-satunya sumber dan ditolak aturan izin, jadi
   belum diperiksa. Kalau ada kartu tidak sampai, mulai dari sini.
5. **`D:/AI/worktrees/worktrees/`** bersarang satu tingkat terlalu dalam, dan
   `lane-hatta` di dalamnya dimiliki user sandbox. Belum disentuh.
6. **Lima worktree lane sudah mati** — w2, w3, w4, harness, corleone-vp.
   Mereka memicu seluruh masalah kedipan. Diperiksa 2026-09-06 malam: kelimanya
   **0 commit di depan main dan nol pekerjaan belum di-commit**, jadi tidak ada
   yang hilang kalau worktree-nya dihapus. Branch-nya tetap disimpan.

7. **Ada pekerjaan belum di-merge di `D:/AI/worktrees/worktrees/lane-corleone`,
   dan hampir hilang.** 128 baris `graphAnchorRelevanceScore` plus 86 baris tes,
   belum di-commit, di worktree bersarang yang terlupakan. Main TIDAK memuatnya.
   Sudah diselamatkan ke `docs/packets/RESCUED-graph-anchor-relevance.patch`
   supaya pembersihan tidak bisa menghapusnya.

   **Jangan langsung menerapkannya.** Main sudah punya peringkat anchor sendiri
   lewat `anchorLabelParts` (directive-runner.mjs:2142) — pendekatan yang
   berbeda. Yang diselamatkan ini lulus 141/141 di pohonnya sendiri, tetapi
   pohonnya berbasis commit lama. Pertanyaannya bukan "apakah jalan", melainkan
   pendekatan mana yang lebih baik, dan itu belum dijawab siapa pun.

---

## Cara memverifikasi sistem masih sehat

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs   # 86/86
D:\aidit-node\node-v22.14.0-win-x64\node.exe hatta/harness.security.test.mjs # 85/85
node ops-watcher/reconcile.mjs --once                                        # tiga OK
node ops-watcher/steward.mjs --once                                          # 0 critical
node ops-watcher/merge-steward.mjs --once --no-suite                          # ~7 detik
node ops-watcher/windows-hide.mjs                                            # 0 tanpa windowsHide
node ops-watcher/owner-answer-watch.mjs --once --all-history                  # jawaban owner
```

Heartbeat harus 19/19. Kalau 18/19, baca langkah mana yang gagal di
`ops-watcher/heartbeat-steps.jsonl` — jangan menebak.
