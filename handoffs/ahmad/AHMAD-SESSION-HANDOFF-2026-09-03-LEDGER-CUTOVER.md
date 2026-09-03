# Handoff — kebenaran pindah ke file; gerbangnya sudah lulus, potongannya belum dilakukan

Tanggal: 2026-09-03 · Sesi: cockpit visual → core arsitek
Rencana induk: `C:\Users\ASUS\.claude\plans\engga-ada-yang-lebih-shimmering-bird.md`

---

## 1. Baca ini dulu: di mana pekerjaannya berhenti

Semua yang dibutuhkan untuk memindahkan kebenaran FounderOS dari Postgres
Paperclip ke file terlacak git **sudah dibangun dan sudah lulus gerbangnya.**
Yang belum dilakukan adalah **potongannya sendiri** — menulis ledger ke disk,
commit sebagai titik balik, dan membalik saklar.

Gerbang, dijalankan hidup terhadap papan hari ini:

```
node scripts/migrate-to-ledger.mjs --export --derive --compare --dry-run

export      78 perkara, 251 komentar  ->  state/import/paperclip-2026-09-03.json
derive     329 event bertipe (329 baru, 0 sudah ada)  — dry run, tidak menulis
compare     78 perkara, dihitung dua cara
            ZERO DIFFERENCES — safe to cut over
```

`classifyDirective` (cara lama: cocokkan ~25 string di badan komentar) dan
`foldDirectives` (cara baru: lipat event bertipe) **sepakat di seluruh 78
perkara.** Itu syarat mutlak yang ditetapkan owner untuk pindah sekali potong
tanpa masa dua-sumber.

Suite: **53/53 hijau** (`node ops-watcher/run-all-tests.mjs`).

---

## 2. Keputusan owner yang mengikat (jangan ditawar ulang)

| Pertanyaan | Jawaban owner |
|---|---|
| Kebenaran di mana | **File di repo** (`state/`). GitHub = hosting + Actions + papan, **bukan** GitHub Issues sebagai penyimpan |
| Cara pindah | **Sekali potong**, satu sesi, tanpa periode dua-sumber |
| Cakupan | **Semua state sekaligus** |
| Paperclip sesudahnya | **Disinkronkan satu arah** dari file; tetap jadi papan |
| 25 penanda teks | **Tetap ditulis sebagai jejak, nol pembaca** |
| 14 keputusan tertumpuk | **Satu ringkasan harian**; kartu satuan hanya untuk yang baru/mendesak |
| Pekerjaan venture pertama | **SJS SuperApps (KOL-62)**, bukan Caveman Trading (KOL-63) |

Batasan tetap dari owner: jangan subscribe/bayar apa pun tanpa dia; owner
non-engineer — laporkan dalam bahasa manusia, bukan istilah kode.

---

## 3. Yang sudah ada di disk

### Modul baru (belum di-commit, semuanya `??` di git status)

| Berkas | Peran | Status |
|---|---|---|
| `ops-watcher/ledger-schema.mjs` | kontrak bersama: 30 `KINDS`, `ACTORS`, `SOURCES`, `validateEvent`, `makeEvent` | siap |
| `ops-watcher/ledger.mjs` | **satu-satunya penulis** — `append`, `appendMany`, `readAll`, `readSince`, `lastSeq`; lock file + tulis atomik | siap, ada tes |
| `ops-watcher/projections.mjs` | `indexEvents`, `foldDirectives`, `foldDecisions`, `foldDelivery`, `project` | siap, 20 tes |
| `ops-watcher/needs-owner.mjs` | satu predikat "apakah menunggu owner?" — menggantikan dua aturan yang tidak sepakat | siap, 16 tes |
| `ops-watcher/owner-surface.mjs` | pemisah kartu-vs-ringkasan + `buildDigest`/`renderDigest` (bahasa Indonesia) | siap, ada tes |
| `scripts/migrate-to-ledger.mjs` | `--export --derive --compare`, `--dry-run` | siap, gerbang LULUS |

Tes regresi pendamping: `ledger.regression.test.mjs`,
`projections.regression.test.mjs`, `needs-owner.regression.test.mjs`,
`owner-surface.regression.test.mjs`, `migrate-to-ledger.regression.test.mjs`.

### Mutation-check (syarat repo: tes baru wajib bisa merah)

```
needs-owner        6/6 mutasi tertangkap
projections        6/6
migrate-to-ledger  7/7
ledger             8/8 (dilaporkan agen, belum diverifikasi ulang sendiri)
```

Skrip mutasinya ada di scratchpad sesi ini (`mutate-migrate.mjs` dkk) —
**hilang kalau scratchpad dibersihkan.** Kalau butuh lagi, polanya: tulis
mutasi ke sumber, jalankan suite, harus gagal, kembalikan sumber di `finally`.

### Ekspor yang sudah mendarat — `state/import/` (6,1 MB)

```
paperclip-2026-09-03.json    730 KB   78 isu + 251 komentar, verbatim
events.jsonl                 684 KB
heartbeat-steps.jsonl       4,59 MB   <-- 4,59 dari ambang rotasi 5 MB
lane-usage.jsonl              25 KB
pm2-supervisor-log.jsonl      56 KB
self-repair-log.jsonl        6,2 KB
directive-runner-state.json  1,7 KB
learning-os-state.json       1,6 KB
telegram-listener.state.json   68 B
```

Delapan sidecar itu **tidak punya salinan lain di mana pun**.
`heartbeat-steps.jsonl` tadinya di ujung dibuang oleh rotasi; salinan ini
menyelamatkannya. Jangan hapus `state/import/` sebelum ia masuk commit.

---

## 4. Koreksi terhadap rencana induk

**`.gitignore` tidak perlu diubah.** Rencana bilang cabut baris 78–82.
Diperiksa hari ini:

```
$ git check-ignore -v state/ledger.jsonl state/import/events.jsonl
(tidak ada keluaran — tidak diabaikan)
```

Baris 77–80 (`ops-watcher/*.lock`, `ops-watcher/*.jsonl`,
`ops-watcher/*-state.json`, `ops-watcher/*.state.json`) semuanya **berprefiks
`ops-watcher/`**, jadi tidak menyentuh `state/`. Langkah itu bisa dilewati.

---

## 5. Langkah potongan — persis urutannya

1. `pm2 stop heartbeat telegram-listener`  (Paperclip & cockpit tetap hidup)
2. `node scripts/migrate-to-ledger.mjs --export --derive` **tanpa** `--dry-run`
   → menulis `state/ledger.jsonl` (~329 event, seq 1..329)
3. Jalankan ulang gerbangnya terhadap ledger nyata:
   `node scripts/migrate-to-ledger.mjs --compare` → wajib **ZERO DIFFERENCES**
4. `git add state/ ops-watcher/{ledger*,projections*,needs-owner*,owner-surface*}.mjs scripts/migrate-to-ledger.mjs`
   lalu commit. **Ini titik balik** — pemulihan = `git revert` + balik saklar.
5. Buat `config/truth-source.json` → `{ "source": "files" }`
6. Arahkan pembaca ke proyeksi: `cockpit/lib/sources.ts`, `cockpit/lib/inbox.ts`,
   `ops-watcher/telegram-notify.mjs`
7. `pm2 start heartbeat telegram-listener`, awasi sapuan pertama —
   rekonsiliasi harus nol selisih

Owner sudah diberi tahu: **akan ada alarm PM2 saat proses dibekukan, dan itu
bukan kerusakan.**

---

## 6. Yang masih harus dibangun setelah potongan

| Berkas | Peran | Status |
|---|---|---|
| `ops-watcher/reconcile.mjs` | invariant yang berteriak: himpunan *butuh owner* vs *bisa dijangkau owner* | **belum ditulis** |
| `ops-watcher/paperclip-sync.mjs` | file → papan, satu arah | **belum ditulis** |
| `config/truth-source.json` | saklar pembatal | **belum ada** |

Lalu sambungkan `telegram-notify.mjs` ke `needs-owner.mjs` + ringkasan harian,
dan arahkan `cockpit/lib/{sources,inbox}.ts` ke proyeksi.

**Ukuran keberhasilannya satu angka.** Sebelum: *butuh owner 17, bisa dijangkau
3.* Sesudah harus: **17 dan 17**, dengan rekonsiliasi yang berteriak kalau
keduanya pernah berbeda lagi.

---

## 7. Perbaikan murah yang sudah terbukti salah, belum dikerjakan

- `directive-runner.mjs:913`/`:916` — `refused: 0` dideklarasikan dua kali di
  objek yang sama; dua penghitung saling menimpa
- `directive-runner.mjs:258` — `/\bREJECT(?:ED)?\b/i` dipakai juga pada komentar
  rencana; rencana yang memuat kata "rejected" menolak dirinya sendiri
- `directive-runner.mjs:245` — `commentsOldestFirst` diam-diam mengembalikan
  array asli kalau **satu** komentar timestampnya tidak valid; semua pembaca
  posisional di bawahnya lalu membaca terbalik (kelas bug KOL-73, jalur
  terdegradasi belum diperbaiki)
- `cockpit/lib/sources.ts:504` cocokkan `OWNER MENYETUJUI` tanpa `via Telegram`;
  `directive-runner.mjs:255` mewajibkannya — dua jawaban untuk komentar sama
- `cockpit/lib/inbox.ts:275` bandingkan ISO string dengan `>` alih-alih parse;
  `:132` kirim `identifier` ke endpoint yang pemanggil lain beri `id`
- 10 salinan hardcoded company id, 3 penemu port → satukan, baca
  `config/paperclip-endpoint.json`

---

## 8. Perbaikan yang sudah masuk sesi ini (belum di-commit)

**Cockpit `/decisions` menampilkan 3 dari 17.** `cockpit/lib/sources.ts`
menyaring pakai label saja. Diperlebar dengan `asksOwnerByTitle`. Catatan: ada
**dua** gerbang berurutan, bukan satu — memperbaiki yang pertama saja akan
membuang 8 perkara lagi di gerbang kedua.

**Login loop, cockpit tidak pernah sekalipun bisa dibuka.** Dua bug beruntun di
`cockpit/middleware.ts`:

1. `COCKPIT_ALLOWED_TELEGRAM_USER_IDS` tidak diset; rute sesi default ke owner,
   middleware menolak semua orang → tambah `DEFAULT_OWNER_TELEGRAM_USER_ID` yang
   cocok
2. Setelah itu 500: `crypto.subtle.verify` menolak ArrayBuffer dari realm Edge,
   dan `return` tanpa `await` membuat penolakannya lolos dari try/catch →
   `return await crypto.subtle.verify(...)` + sempitkan `base64UrlToBytes` ke
   `Uint8Array<ArrayBuffer>`

**Alat verifikasi visual baru:** `scripts/shoot-cockpit.mjs` (Playwright,
screenshot) dan `scripts/audit-cockpit.mjs` (overflow, target sentuh, kontras
terkomposit). Keduanya membuat cookie sesi memakai token bot sebagai kunci HMAC
dan **tidak pernah mencetaknya**.

---

## 9. Jebakan operasional — yang sudah menggigit sesi ini

- **Jangan `npm run build` selagi `next start` hidup.** Hash CSS berubah,
  halaman jadi telanjang tanpa error. Urutannya: stop → hapus `.next` → build →
  start. Owner sempat dua kali dikasih halaman rusak.
- **`cockpit/package.json` membuat `cockpit/` jadi project root sendiri.** Aturan
  `design-system-*` dari root diam-diam dilewati untuk setiap berkas di
  bawahnya, dan detektor melapor "0 findings" yang palsu. Sudah ditambal dengan
  `cockpit/DESIGN.md`.
- **Audit kontras harus mengomposit alpha.** Versi pertama membaca
  `rgba(255,106,38,0.11)` sebagai oranye pekat dan mengarang 2 kegagalan.
- **Tes yang terlalu baik hati.** T15 lolos sementara jalur asli melapor 78
  selisih hantu, karena tesnya menyediakan sendiri nomor urut yang seharusnya
  diproduksi kode yang diuji. Penggantinya, T16, menjalankan `main()` beneran.
  Pelajarannya berlaku umum: kalau tes menyediakan hal yang seharusnya
  dihasilkan kode, ia tidak menguji apa-apa.
- **Commit repo ini tidak memakai trailer `Co-Authored-By`** — tidak di satu
  commit pun. Jangan tambahkan.

---

## 10. Agent roster

28 agent agency-agents terpasang (18 kurasi + 10 divisi design), didokumentasikan
di `docs/agent-roster-notes.md` berikut pemicu untuk memasang divisi lain.

**Ini subagent Claude Code, bukan lane worker.** HATTA/CORLEONE/SJAHRIR/GIBRAN
adalah proses CLI terpisah dengan langganan model sendiri. Memasang persona
menambah prompting spesialis; **tidak** menambah kapasitas worker.

Biayanya berulang: ~1.620 token/giliran untuk 28 agent, vs ~19.100 kalau semua
274 dipasang.

---

## 11. Desain visual cockpit — diserahkan, bukan dibatalkan

Owner menolak tiga arah visual ("slop/generic") lalu berkata: *"handoff aja untuk
design visual dashboard nanti coba gua pake metode lain."* Semuanya ada di
`handoffs/ahmad/COCKPIT-VISUAL-HANDOFF-2026-09-03.md`.

Skinnya sudah dibuat murah untuk diganti: token `os.*` Tailwind → CSS var, jadi
re-skin penuh menyentuh 3 berkas. Arsitektur dan skin terpisah — owner secara
eksplisit mengoreksi ini ketika skinnya ikut dibekukan.

---

## 12. Perintah untuk memulai sesi berikutnya

```bash
cd "D:/AI/Active FounderOS-Aidit"
node ops-watcher/run-all-tests.mjs                                   # harus 53/53
node scripts/migrate-to-ledger.mjs --export --derive --compare --dry-run
# harus: ZERO DIFFERENCES — safe to cut over
```

Kalau keduanya hijau, lanjut ke §5 langkah 1. Kalau gerbangnya merah, **jangan
potong** — laporkan selisihnya ke owner.
