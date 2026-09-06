# Handover to Codex — 2026-09-07, adopsi FounderOS

Ditulis sesi integrator Claude sebelum kuota habis. Semua angka di sini diukur
di mesin ini, bukan dikutip dari laporan lane.

`origin/main` di `1e1dc01`. Suite **87/87**. Reconcile hijau pada ketiga
pemeriksaannya.

---

## 1. Keadaan lane saat serah terima

```
lane-hatta     branch lane/p0-probe        behind 3   kerja tak ter-commit: 0
lane-sjahrir   branch lane/p0-selfrepair   behind 3   kerja tak ter-commit: 0
lane-corleone  branch lane/hands           behind 2   kerja tak ter-commit: 0
```

Tidak ada pekerjaan lane yang menggantung. **Sinkronkan ketiganya sebelum
dispatch apa pun** -- `git -C <worktree> merge --ff-only origin/main`. Lane yang
kotor DAN basi sekarang ditolak tanpa spawn, dan penolakannya nyata sejak
`303f964`, bukan sekadar baris log.

Kuota: SJAHRIR (kimi CLI) terkunci jendela 5 jam, terakhir melaporkan sisa 58
menit sekitar pukul 22:46 UTC. HATTA (kimi lewat Ollama) dan CORLEONE (codex)
jalan. Kolam kuota SJAHRIR dan HATTA **berbeda** -- terukur: endpoint Ollama
menjawab 200 dalam 2,4 detik saat CLI mengembalikan 403 batas 5 jam.

---

## 2. Kesalahan saya yang harus Anda tahu lebih dulu

Saya memberi tahu pemilik bahwa repo Bennett "dashboard bisnis, bukan agentic
system". **Itu salah dan pemilik menolaknya dengan benar.**

Asalnya: survei C membaca `lib/ledger.ts`, `ventures.ts`, `db.ts` dan menemukan
-- dengan benar, dalam cakupannya -- bahwa `ledger.ts` adalah tabel mutasi bank.
Saya generalisasi temuan satu berkas itu ke seluruh repositori.

Yang tidak pernah dibuka siapa pun saat saya memberi vonis:

- `lib/connectors/` — 24 konektor, termasuk `llm.ts`, `gbrain.ts`, `local-stack.ts`
- `lib/agents/real.ts` — 531 baris roster agen
- `lib/sop-playbooks.ts` — 751 baris
- `lib/skills-catalog.ts` — 202 baris
- 42 rute API termasuk `agents/[id]/run`, `agents/broadcast`, `conductor/context`

Pelajarannya untuk Anda: **jangan pakai satu survei sebagai vonis atas repo.**
Survei A, B, C masing-masing benar dalam cakupannya dan salah sebagai gambaran
keseluruhan.

---

## 3. Tiga temuan yang belum ditindaklanjuti, dari header berkas

Sudah saya baca sendiri; belum ada yang mendalaminya.

**`lib/connectors/llm.ts` punya provider `stub` deterministik tanpa panggilan
jaringan** (`LLM_PROVIDER=stub`), "so the whole agent-chat stack is testable
offline". Ini kandidat paling berharga di seluruh repo untuk kita: tiap run lane
memakai kuota berbayar, dan dua dispatch semalam ditolak murni karena kuota.
Pertanyaan yang harus dijawab: di mana seam-nya upstream, dan apakah
`hatta/harness.mjs` punya seam setara atau harus dibuat.

**`lib/connectors/types.ts`**: `ConnectorState = 'connected' | 'not_configured' |
'error'`, dan headernya menyatakan status tetap jujur -- tanpa kunci berarti
`not_configured`, tidak pernah "connected" palsu. CLAUDE.md kita sudah menuntut
registered/configured/reachable/healthy/authorized sebagai lima fakta terpisah.
Periksa apakah `ops-watcher/mcp-probe.mjs` benar-benar menjawab kelimanya.

**`lib/connectors/gbrain.ts` memanggil biner `gbrain` yang sama dengan yang kita
pakai.** Titik integrasi langsung, bukan analogi. `GBRAIN_BIN` dan
`GBRAIN_STORE` dapat dikonfigurasi.

---

## 4. Yang siap dikirim, tinggal dispatch

Dua packet sudah ditulis, ter-commit, dan lane sudah bisa membacanya:

- `docs/packets/PACKET-ADOPT-D-HANDS.md` → **CORLEONE**. Lapis 05 Hands: 24
  konektor, `creds.ts`, lawan `mcp-probe.mjs` dan `.mcp.json`. Provider stub
  diminta jadi subbagian tersendiri.
- `docs/packets/PACKET-ADOPT-E-ROSTER.md` → **HATTA**. Roster, skills, SOP,
  lawan `specialists.mjs`. Pertanyaan intinya: apakah specialist kita versi
  sederhana dari SOP upstream, atau hal berbeda yang memakai kata yang sama.

Perintah dispatch, setelah sinkron:

```
node ops-watcher/corleone-dispatch.mjs "<baca PACKET-ADOPT-D-HANDS.md, kerjakan persis, READ ONLY kecuali docs/adoption/D-hands.md>"
node ops-watcher/hatta-dispatch.mjs    "<baca PACKET-ADOPT-E-ROSTER.md, kerjakan persis, READ ONLY kecuali docs/adoption/E-roster.md>"
```

---

## 5. Aturan routing lane, terukur bukan selera

Tercatat penuh di `docs/agent-roster-notes.md`. Ringkasnya: **hitung berapa
berkas yang harus DIBUKA packet itu.**

- Di atas ~6 berkas → **CORLEONE**. Codex membaca berkelompok; ia menyelesaikan
  survei enam-lawan-enam dalam satu giliran dan perubahan lima berkas berikut tes
  dalam satu run.
- Di bawah 3 berkas plus tes → **HATTA**. Plafonnya 40 panggilan alat; dua belas
  pembacaan berkas plus laporan tidak muat. Itu aritmetika, bukan kegagalan model.
- Di antaranya, atau satu modul plus berkas tes → **SJAHRIR**. Dindingnya waktu,
  480 detik, dan tiga run minggu ini kena dinding justru saat kerjanya sudah
  selesai dan suite sudah hijau.

Kesalahan saya di packet B: saya kirim tugas dua-belas-berkas ke HATTA. Ia
menghabiskan keempat puluh panggilannya tanpa menulis sebaris pun.

---

## 6. Yang sudah mendarat malam ini

Adopsi:

- `7870d07` — vendor `founderos-demo` (MIT, upstream `d5e565e`). **Masuk git,
  bukan digitignore**, karena lane bekerja di worktree masing-masing dan
  direktori terabaikan tidak terlihat di sana. `vendor/founderos-demo/VENDORED.md`
  mencatat provenans dan aturannya: tak ada yang disunting di tempat, berkas yang
  disalin keluar wajib membawa atribusi.
- Tiga survei di `docs/adoption/{A-orchestration,B-knowledge,C-state}.md`.
- `763bb46` — `ops-watcher/ventures-registry.mjs` + tes. Adopsi nyata pertama:
  pola batas-repositori Bennett diterapkan ke `config/ventures.json`, yang empat
  aturannya selama ini cuma prosa. **Sengaja belum disambungkan ke pemanggil
  mana pun** -- packet berikutnya yang menyambungkan; penulis setengah tersambung
  lebih buruk daripada tidak ada.
- HATTA pindah ke `kimi-k2.7-code:cloud` atas keputusan pemilik. Nilai benchmark
  `glm-5.1:cloud` ada di komentar; jalankan perbandingan dengan
  `OLLAMA_MODEL_HATTA=glm-5.1:cloud`.

Perbaikan rantai verifikasi (konteks penuh di `docs/handover-2026-09-07-morning.md`):
executor membandingkan isi bukan mtime; verifikasi jalan sebelum dan sesudah;
penolakan kotor-dan-basi dipatuhi dispatcher; penanda hasil/penolakan harus
membuka komentar; ledger dibedakan dari kerja lane; dua lubang kredensial
merge-steward.

---

## 7. Satu packet menganggur yang belum dikirim

`docs/packets/PACKET-VENDOR-IS-READ-ONLY.md`. Terukur: `checkForbiddenPaths`
**mengizinkan** tulisan ke `vendor/founderos-demo/lib/ledger.ts`, sementara
`.env.local` dan `ventures/` diblokir. Setiap packet adopsi melarang menyunting
`vendor/` dalam prosa, dan prosa bukan penjaga -- itu pelajaran yang berulang
sepanjang minggu ini. Ukurannya kecil, cocok untuk HATTA.

---

## 8. Yang masih milik pemilik, jangan diputuskan sendiri

1. **Pemangkasan worktree.** Tiga worktree bersarang di
   `D:/AI/worktrees/worktrees/` milik akun Windows `CodexSandboxOffline` --
   kemungkinan besar akun Anda sendiri, Codex. Ketiganya menyandera branch
   kanonik `lane/hatta`, `lane/sjahrir`, `lane/corleone`, dan itulah sebabnya
   worktree lane asli terdampar di branch nyasar dan sempat 10-151 commit basi.
   Semua branch `unmerged=0`; pemangkasan tidak menghilangkan commit. Classifier
   Claude memblokir saya melakukannya. **Anda mungkin bisa** -- tapi minta izin
   pemilik dulu.
2. **Lapis 04.** Hermes sebagai gateway loopback, atau tetap sekali-pakai per
   review. Saya tidak mengubahnya: satu konsumen saja, dan merombak arsitektur
   tanpa kebutuhan terukur bukan kesehatan.
3. **CCTV dan voice belum punya rute.** `classifyTaskClass` mengembalikan `null`
   untuk keduanya. Sengaja: aturan matrikulasi pemilik menaruh adopsi repo
   sebelum implementasi, dan kelas yang dibuat sebelum adopsi merutekan pekerjaan
   ke berkas specialist yang belum ditulis siapa pun.
4. **Cadangan papan Paperclip.** `.paperclip/` gitignored seluruhnya -- 100 issue
   berikut komentarnya, plus `decision-signing.key` dan `master.key`. Satu-satunya
   bagian Aidit OS tanpa salinan di luar mesin ini. Ia membawa kunci, jadi
   jawabannya milik pemilik.

---

## 9. Cara kerja yang berlaku di sini

- Integrator menulis packet, mengirim ke lane, **memverifikasi sendiri**,
  menggabungkan, melapor. Verifikasi berarti menjalankan suite dan mengukur
  perilakunya langsung, bukan menerima laporan lane. Malam ini dua lane
  melaporkan hal yang tidak benar: satu mengganti kasus tes yang gagal dengan
  yang lulus, satu melaporkan "2 pre-existing failures" yang tidak ada.
- Lane tidak pernah commit dan tidak pernah push. Integrator yang commit.
- Berkas packet ditaruh di `docs/packets/`, deskripsi issue Paperclip menunjuk ke
  sana -- Paperclip memotong deskripsi di 1200 karakter dan pemotongan itu sudah
  menggagalkan directive nyata.
- Node yang dipin: `D:\aidit-node\node-v22.14.0-win-x64\node.exe`.
- Jangan menulis apa pun di dalam `ventures/` atau `vendor/`.
- Jangan tambahkan trailer `Co-Authored-By` (aturan CLAUDE.md proyek ini).
