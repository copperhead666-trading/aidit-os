# Semua yang belum jelas, dan usulan saya untuk tiap satunya

Ditulis 2026-09-05. Owner meminta hal yang benar: berhenti menggantung. Setiap
baris di bawah ini punya usulan konkret, jadi Anda cukup menjawab ya, tidak,
atau angka — bukan diminta memikirkan teknisnya.

Aturan yang saya pegang: **tidak ada yang saya kerjakan diam-diam kalau itu
menyangkut uang, kredensial, atau data yang keluar dari mesin ini.**

---

## 1. Peran tiap lapis — koreksi yang harus dicatat

Saya sempat menulis di slide bahwa Paperclip adalah satu-satunya sumber
kebenaran. Itu salah, dan Anda benar mengoreksinya. Yang benar tiga lapis:

| Lapis | Kebenaran tentang apa | Buktinya |
|---|---|---|
| **git / GitHub** | kode dan sejarahnya | remote `copperhead666-trading/aidit-os`, suite regresi 79 berkas |
| **Paperclip** | keadaan operasional **saat ini**: issue mana jalan, apa yang menunggu Anda | KOL-34 menyebutnya `canonical operational state / current truth` |
| **gbrain** | dokumen kanonik bisnis: backlog, ledger, handoff, spec | CLAUDE.md: dua indeks yang sama-sama mengaku sumber kebenaran lebih buruk daripada satu |

**Usulan 1.** Tulis pembagian ini sebagai aturan di `CLAUDE.md`, supaya tidak
ada agen yang mengulang kekeliruan saya. *Butuh: persetujuan Anda saja.*

---

## 2. Lapis yang belum tersambung — ini akar banyak kemacetan

**Kondisi terukur hari ini:**
- `knowledge/store` (gbrain) berisi **6 KB**: satu README dan satu folder notes.
  Praktis kosong.
- Graphify hidup dan berguna: graph Aidit OS aktif, graph venture 4.263 node.
- Paperclip hidup: 86 issue.
- **Tidak ada satu jalur pun yang menyambungkan ketiganya.**

Itu persis isi **KOL-34** — "P1 COGNITIVE CORE V1 — minimum vertical slice
(GBrain + Graphify + Paperclip)" — status **blocked**, anak dari **KOL-33** yang
juga blocked menunggu vonis SOAK.

**Usulan 2.** Lepaskan KOL-34 dari ketergantungan SOAK dan kerjakan sekarang,
tapi versi terkecilnya saja: satu jalur `niat owner → konteks relevan → packet`,
dengan syarat keras yang sudah tertulis di issue-nya (tiap potongan konteks
membawa sumber dan waktu; konflik bukti dinyatakan, bukan dipilih diam-diam;
keadaan hidup Paperclip menang atas catatan lama).
*Butuh keputusan Anda: lepas dari SOAK, ya atau tidak.*

**Usulan 3.** Isi gbrain dulu sebelum menyambungkannya. Retrieval di atas 6 KB
tidak akan menghasilkan apa pun. Kandidat isi yang sudah ada di repo: PRD
escalation-contract, handover hari ini, backlog handover, decision ledger,
standar di `docs/standards/`. *Butuh: persetujuan Anda saja.*

---

## 3. Agen dan model — siapa memakai AI apa

Terbaca dari `config/agent-registry.json`, dan semuanya sudah saya uji hidup
hari ini kecuali yang disebut:

| Agen | Peran | Terhubung ke |
|---|---|---|
| AHMAD | orkestrator menghadap owner | Anthropic (Claude) |
| CORLEONE | implementasi | OpenAI, codex CLI, `gpt-5.5` |
| HATTA | eksekutor teknis, edit kecil | Ollama Cloud, `glm-5.3:cloud` |
| SJAHRIR | analisis dan implementasi | Moonshot, kimi-code |
| GIBRAN | reviewer independen | Nous, hermes, model gratis |
| SOEKARNO | keluaran berupa teks, baca saja | Anthropic, Claude Code lokal |

**Yang belum jelas:** registry mencatat `model_if_known` kosong untuk AHMAD,
GIBRAN, SJAHRIR, dan SOEKARNO. Artinya kalau salah satu provider mengganti
model diam-diam, tidak ada yang tahu.

**Usulan 4.** Catat model yang benar-benar dipakai tiap lane, diambil dari
jawaban CLI-nya sendiri, bukan diketik manual — dan jadikan bagian dari sapuan
kesehatan supaya perubahan model terdeteksi sebagai drift.
*Butuh: persetujuan Anda saja.*

---

## 4. Specialist tipis — sudah sehat, satu hal belum

21 persona di `agents/specialists/`, resolver bekerja, ukuran seksi 1,8–2,4 KB.
Hari ini saya tambahkan dua kelas yang hilang: `test-regression` dan
`venture-metrics`.

**Yang belum jelas:** specialist hanya menyuntikkan SUARA ke packet. Tidak ada
aturan yang mengatakan lane mana yang cocok untuk kelas tugas mana, padahal
`config/skill-matrix.json` sudah punya kolom maker dan reviewer yang tidak
dibaca siapa pun saat dispatch.

**Usulan 5.** Sambungkan skill-matrix ke pemilihan lane: kelas tugas menentukan
lane, berdasarkan angka nyata (CORLEONE 96% untuk implementasi, SJAHRIR untuk
analisis kecil, HATTA untuk edit kecil, GIBRAN untuk review).
*Butuh: persetujuan Anda saja.*

---

## 5. Integrasi luar — apa yang ada, apa yang menganggur

Kredensial yang ada di mesin ini (nama saja, nilainya tidak pernah saya baca
atau salin):

| Kredensial | Dipakai untuk | Status hari ini |
|---|---|---|
| `TELEGRAM_BOT_TOKEN_AHMAD`, `TELEGRAM_OWNER_CHAT_ID` | kartu keputusan ke Anda | **aktif, terbukti** |
| `PAPERCLIP_BASE_URL`, `PAPERCLIP_API_KEY` | papan operasional | **aktif** |
| `GITHUB_TOKEN` | remote repo | **aktif** |
| `OLLAMA_API_KEY`, `KIMI_API_KEY` | lane HATTA dan SJAHRIR | **aktif** |
| `GBRAIN_BASE_URL`, `GBRAIN_API_KEY` | lapis dokumen kanonik | ada, **hampir tidak terpakai** |
| `NOTION_TOKEN`, `NOTION_API_KEY`, `NOTION_PAPERCLIP_DATABASE_ID` | `learning-os-notion-sync.mjs`, `notion-probe.mjs` | kode ada, **belum jelas dipakai rutin** |
| `SJS_SUPABASE_URL`, `SJS_SUPABASE_SERVICE_ROLE_KEY` | venture SJS superapps | **tidak ada kode ops-watcher yang memakainya** |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | tidak ditemukan pemakainya | **menganggur** |

**Usulan 6 — Notion.** Putuskan perannya: (a) tempat Anda membaca hasil di luar
Telegram, (b) hanya untuk Learning OS, atau (c) dimatikan. Kode sinkronisasinya
sudah ada; yang tidak ada adalah keputusan Anda.

**Usulan 7 — Supabase.** Kunci `SERVICE_ROLE` adalah kunci paling berbahaya di
Supabase: melewati semua aturan baris. Ia duduk di berkas yang sama dengan
kredensial lain, dan tidak ada kode Aidit OS yang memakainya. Usul saya:
**cabut dari mesin ini** sampai ada pekerjaan SJS yang benar-benar
membutuhkannya, lalu simpan terpisah dari kredensial operasional.

**Usulan 8 — Cloudflare.** Tidak ada pemakainya. Usul: **cabut**, atau katakan
rencananya supaya saya catat sebagai pekerjaan, bukan sebagai kunci menganggur.

**Usulan 9 — n8n.** Server MCP-nya terdaftar tapi gagal tersambung sepanjang
sesi ini (404). Usul: perbaiki atau hapus dari konfigurasi. Server yang selalu
gagal membuat setiap sesi memulai dengan satu kegagalan.

---

## 6. Yang menahan vonis "sehat"

Ini bukan usulan, ini fakta yang harus lunas dulu:

1. **Belum ada satu pun putaran directive yang tuntas** dari rencana sampai
   mendarat. Penyebab utamanya baru hilang hari ini.
2. **Nol dari 37 run membawa pengukuran kebenaran.** Kolomnya sudah dibuat dan
   berbunyi `n/a` dengan jujur; executor belum disambungkan untuk mengisinya.
3. **Cadangan belum pernah diuji restore.** Dan flashdisk 2TB itu terbukti
   mengembalikan isi yang rusak — tiga dari empat berkas gagal dibandingkan
   hash-nya.
4. **KOL-33 dan KOL-34 masih blocked**, jadi lapis kognitifnya belum tersambung.

---

## Yang saya kerjakan tanpa menunggu Anda

Karena tidak menyangkut uang, kredensial, atau data yang keluar dari mesin:
menyelesaikan diagnosis domain B, E, dan F; menyambungkan executor ke kolom
pengukuran kebenaran; dan menuntaskan uji flashdisk.

Yang **tidak** saya sentuh tanpa jawaban Anda: mencabut kredensial apa pun,
melepas KOL-34 dari SOAK, mematikan integrasi Notion, dan menghapus berkas
sumber mana pun setelah backup.
