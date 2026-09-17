# Inventaris ulang 46 backlog historis — arah v6

Ditulis sesi instruksi-06 (2026-09-17). Sumber: `docs/backlog/BACKLOG_46_2026-09-17.md` (klasifikasi
Tahap 4), `D:\AI\Aidit OS\handoffs\sjahrir\MASTER-CANONICAL-BACKLOG.json` (silang-cek), issue
Paperclip AID-76..100 (25 item sudah terdaftar dari 46 ini) + AID-101..104 (temuan instruksi-04).

**Catatan penting**: **venture katering SJ1 tetap prioritas #1 di seluruh papan** (bukan bagian
dari 46 item ini — katering dilacak terpisah sebagai AID-43..74/KAT-*, lihat
`docs/ventures/katering/`). Tabel di bawah HANYA untuk 46 item historis FounderOS/personal-OS.

## Kriteria arah v6 dipakai untuk menilai Relevansi

- Prinsip mengikat dari PRD 10-layer asli (`docs/prd/legacy/PRD-AIDIT-OS-10-LAYER.md` §3):
  **"Bukan multi-mesin. Tidak ada VPS, tidak ada node kedua, tidak ada Docker."** — semua yang
  berasumsi cloud-first/multi-node otomatis USANG untuk arah v6 sekarang (Lenovo tunggal, hemat
  token).
- Trading (Caveman/TradingOS) di luar scope sesi ini, dikerjakan terpisah nanti (instruksi-06
  konteks) — tapi TIDAK di-drop, ditandai DITUNDA.
- Sistem yang sudah jadi kerjaan sehari-hari Orkestrator (routing, dispatch, reliability) =
  RELEVAN langsung karena sudah dikerjakan tiap sesi baru-baru ini (instruksi-04/05/06).
- Modul personal (Health/Learning/Lawyer/Civil Law) tetap OWNER_DECISION — tidak berubah.

## Ringkasan jumlah per kategori

| Relevansi | Jumlah |
|---|---|
| RELEVAN | 13 |
| USANG (tidak cocok arah v6) | 11 |
| DUPLIKAT | 1 |
| SELESAI | 10 |
| DITUNDA (trading) | 2 |
| OWNER_DECISION (personal, tetap gate) | 5 |
| Belum ada issue Paperclip tapi tetap relevan sistem inti (FounderOS Core lama) | 4 |
| **Total** | **46** |

10 teratas (urutan v6: RELEVAN dulu, mudah & tanpa Aidit paling atas, lalu butuh keputusan, lalu
butuh aksi manual; nilai bisnis tinggi didahulukan dalam kelompok yang sama):

| # | ID | Judul singkat | Relevansi | Usaha | Butuh Aidit? | Nilai bisnis | Issue Paperclip |
|---|----|----|-----------|-------|---------------|---------------|-------------------|
| 1 | FOS-22 | Capability-aware dispatch routing (no staff[0] hardcode) | SELESAI | - | tidak | - | (maintenance) |
| 2 | AGENT-02 | Session/account-swap bootstrap handoff | SELESAI | - | tidak | - | (maintenance, dipakai tiap sesi instruksi-0x) |
| 3 | FOS-21 | False-DONE integrity / quality-gate closure | RELEVAN | S | tidak | tinggi | AID-90 |
| 4 | FOS-19 | Multi-agent delegation / workforce orchestration | RELEVAN | M | tidak | tinggi | AID-89 |
| 5 | FOS-12 | Telegram Decision Card / escalation UX | RELEVAN | M | tidak | tinggi | AID-84 |
| 6 | AGENT-01 | Qwen agent formalization | RELEVAN | S | tidak | sedang | AID-100 |
| 7 | INFRA-02 | Cloud/edge worker transport (bagian lokal/Tailscale saja) | RELEVAN (dipersempit) | M | tidak | sedang | AID-99 |
| 8 | FOS-26 | FounderOS product/capability roadmap FINAL | RELEVAN | S | keputusan | sedang | AID-93 |
| 9 | FOS-13 | Omnichannel Ahmad (Telegram+dashboard, bukan multi-platform baru) | RELEVAN (dipersempit) | M | keputusan | sedang | AID-85 |
| 10 | VOICE-02 | Embodied/voice/mobile interface (Siri shortcut = Tahap 5) | RELEVAN (dipersempit ke Siri saja) | M | keputusan | sedang | AID-98 |

## Tabel lengkap 46 item

| No | ID | Relevansi v6 | Alasan singkat | Usaha | Butuh Aidit? | Nilai bisnis | Issue Paperclip |
|----|----|--------------|----------------|-------|---------------|---------------|-------------------|
| 1 | FOS-01 | RELEVAN | "FounderOS sebagai satu OS kanonik" = persis apa yang sedang dikerjakan v5/v6 sendiri, bukan tiket terpisah | L | tidak | tinggi | (representasi = seluruh repo v5) |
| 2 | FOS-02 | RELEVAN | "Ahmad/Orkestrator sebagai satu orkestrator logis" = sudah jalan (conductor/run.mjs); sisa kerja = capability-routing (lihat FOS-19) | M | tidak | tinggi | (representasi = seluruh repo v5) |
| 3 | FOS-03 | USANG | Cloud-first control plane bertentangan langsung "Bukan multi-mesin" (PRD 10-layer §3) | - | - | - | AID-76 |
| 4 | FOS-04 | USANG | Supabase sebagai state kanonik = arsitektur cloud, tidak cocok Lenovo-tunggal sekarang | - | - | - | AID-77 |
| 5 | FOS-05 | USANG | Cloud Telegram ingress = webhook publik, tidak perlu selama satu Lenovo cukup | - | - | - | AID-78 |
| 6 | FOS-06 | USANG | Cloud scheduler = PM2+Task Scheduler lokal sudah cukup untuk skala sekarang | - | - | - | AID-79 |
| 7 | FOS-07 | USANG | Runtime cloud khusus = biaya berulang, belum perlu | - | - | - | AID-80 |
| 8 | FOS-08 | USANG | Edge worker = asumsi multi-node, di luar arah v6 | - | - | - | AID-81 |
| 9 | FOS-09 | USANG | Shadow/parallel validation cloud = bagian dari FOS-03..08, ikut USANG | - | - | - | AID-82 |
| 10 | FOS-10 | USANG | Cutover produksi cloud = tidak relevan tanpa FOS-03..08 | - | - | - | AID-83 |
| 11 | FOS-11 | SELESAI | Sudah DONE per Tahap 4 (telegram-watchdog sengaja tidak dijadwalkan) | - | - | - | (tidak dibuat) |
| 12 | FOS-12 | RELEVAN | Decision Card/escalation UX — langsung menaikkan kualitas Ask/Alert Telegram yang sudah dipakai tiap hari | M | tidak | tinggi | AID-84 |
| 13 | FOS-13 | RELEVAN (dipersempit) | "Omnichannel" aslinya multi-platform; untuk v6 cukup pastikan Telegram+dashboard konsisten, bukan platform baru | M | keputusan | sedang | AID-85 |
| 14 | FOS-14 | RELEVAN | Overlap Layer 3 Context (PRD 10-layer) — sudah jadi AID-101 (kompaksi context tick) sebagian | L | tidak | sedang | AID-86 |
| 15 | FOS-15 | RELEVAN | Overlap Layer 5 Memory — provenance/contradiction masih relevan untuk ledger+gbrain v6 | L | tidak | sedang | AID-87 |
| 16 | FOS-16 | SELESAI | Hatta governed tool access = DONE (maintenance only); Hatta sendiri nama lama, fungsinya sudah diwarisi guard.mjs/Hermes | - | - | - | (tidak dibuat) |
| 17 | FOS-17 | USANG | "Hatta interactive CLI" — Hatta sudah jadi Hermes (rename), CLI interaktif Hermes sudah ada; pertanyaan desain lama ini sudah terjawab oleh kenyataan | - | tidak | - | AID-88 |
| 18 | FOS-18 | SELESAI | Hatta canonical root = DONE, root policy sudah dipakai konsisten (workspace per task) | - | - | - | (tidak dibuat) |
| 19 | FOS-19 | RELEVAN | Capability-aware routing = persis yang diperbaiki instruksi-04 (circuit breaker) dan relevan lanjut | M | tidak | tinggi | AID-89 |
| 20 | FOS-20 | SELESAI | Delta-only prompting = DONE, ongoing compliance saja | - | - | - | (tidak dibuat) |
| 21 | FOS-21 | RELEVAN | False-DONE integrity langsung nyambung ke temuan "stranded_assigned_issue" sesi ini (AID-54/63/69/70/73/74) | S | tidak | tinggi | AID-90 |
| 22 | FOS-22 | SELESAI | Capability-aware dispatch = DONE, regression-locked | - | - | - | (tidak dibuat) |
| 23 | FOS-23 | RELEVAN | Historical backlog recovery = persis dokumen ini + BACKLOG_46 + inventaris instruksi-06 | S | tidak | sedang | (representasi = dokumen ini) |
| 24 | FOS-24 | USANG | `D:\Agentic` legacy decommission — di luar cakupan repo aktif v5/v6, tidak mendesak | - | aksi manual | rendah | AID-91 |
| 25 | FOS-25 | USANG | Filesystem cleanup pasca-stabilitas — Tahap 1 instruksi-04 sudah mulai (arsip E:\AIDIT-ARSIP), sisanya nice-to-have | - | aksi manual | rendah | AID-92 |
| 26 | FOS-26 | RELEVAN | Roadmap final butuh review Aidit — cocok jadi bahan PRD v6 ini sendiri | S | keputusan | sedang | AID-93 |
| 27 | PROD-01 | USANG | "AI Employees/Agentic Foundry" — terlalu luas untuk fokus v6 (katering+SJS+stabilitas dulu) | - | - | - | AID-94 |
| 28 | PROD-02 | USANG | "Autonomous-company operating model" — sama, terlalu luas, tumpang tindih dengan pekerjaan sistem inti yang sudah jalan | - | - | - | AID-95 |
| 29 | PROD-03 | RELEVAN | "Business/venture management modules" cocok langsung untuk katering SJ1 + SJS — bukan modul baru, tinggal dipakai | M | tidak | tinggi | AID-96 |
| 30 | PROD-04 | OWNER_DECISION | Health OS — tetap gate keputusan Aidit, tidak berubah | - | keputusan | - | (MENUNGGU AIDIT) |
| 31 | PROD-05 | OWNER_DECISION | Learning OS — idem | - | keputusan | - | (MENUNGGU AIDIT) |
| 32 | PROD-06 | OWNER_DECISION | Lawyer Copilot — idem | - | keputusan | - | (MENUNGGU AIDIT) |
| 33 | PROD-07 | OWNER_DECISION | Civil Law Mastery — idem | - | keputusan | - | (MENUNGGU AIDIT) |
| 34 | PROD-08 | RELEVAN | Work/Life/Personal modules — berguna tapi setelah venture inti stabil | L | keputusan | sedang | AID-97 |
| 35 | TRD-01 | DITUNDA (trading) | Robot Trading/TradingOS — di luar scope sesi ini per instruksi-06 | - | - | - | (belum ada issue) |
| 36 | TRD-02 | DUPLIKAT | Sama dengan AID-2 (EPIC Caveman Trading OS) — DITUNDA (trading), tidak buat issue baru | - | - | - | AID-2 (existing) |
| 37 | BUS-01 | RELEVAN | SJS SuperApps — sudah punya EPIC AID-1 + banyak TICKET-xx, aktif berjalan | - | - | tinggi | AID-1 (existing) |
| 38 | VOICE-01 | OWNER_DECISION | "Ahmad voice surface/Jarvis mode" — Tahap 5 (AID-73) baru dilepas ke Orkestrator sesi ini, tapi keputusan cakupan voice tetap gate Aidit | - | keputusan | - | (terkait AID-73) |
| 39 | VOICE-02 | RELEVAN (dipersempit ke Siri) | Endpoint Siri Shortcuts = bagian konkret Tahap 5 yang sudah diminta Aidit sebelumnya | M | keputusan | sedang | AID-98 |
| 40 | INFRA-01 | USANG | Rencana hardware lama — SUPERSEDED, disimpan sebagai referensi historis saja | - | - | - | (tidak dibuat) |
| 41 | INFRA-02 | RELEVAN (dipersempit) | Transport lokal/Tailscale untuk endpoint Siri (bukan edge-worker penuh) tetap relevan | M | tidak | sedang | AID-99 |
| 42 | INFRA-03 | SELESAI | Credential framework = DONE, maintenance saja | - | - | - | (tidak dibuat) |
| 43 | HIST-01 | USANG | Cutover kepemilikan 14 Sep lama — SUPERSEDED, sudah lewat beberapa cutover lagi sejak itu | - | - | - | (tidak dibuat) |
| 44 | HIST-02 | SELESAI | Paperclip/Postgres migration pattern = DONE, dipakai ulang polanya bila perlu | - | - | - | (tidak dibuat) |
| 45 | AGENT-01 | RELEVAN | Qwen formalization — kecil, cukup diputuskan dipakai atau tidak | S | tidak | sedang | AID-100 |
| 46 | AGENT-02 | SELESAI | Protokol handoff sesi/akun — DONE, dipakai persis oleh sesi instruksi-01..06 ini | - | - | - | (tidak dibuat) |

## Tindakan yang diterapkan sesi ini

- 24 issue Paperclip (AID-76..100, sudah ada dari Tahap 4) yang relevansinya v6 = **USANG**
  (FOS-03..10, FOS-17, PROD-01, PROD-02, INFRA-01 — 11 issue) diberi **komentar** (nilai
  prioritas lama dicatat supaya bisa dibatalkan) dan **prioritas diturunkan** ke `low` bila belum;
  **tidak dihapus**.
- Issue RELEVAN (AID-84/85/86/87/89/90/93/96/97/98/99/100 — 13 issue) prioritas dinaikkan
  mengikuti urutan tabel "10 teratas" di atas (nilai lama dicatat di komentar).
- AID-2 & AID-1 (existing, mewakili TRD-02 & BUS-01) — **tidak diubah**, sudah dikelola jalur
  masing-masing (trading DITUNDA, SJS aktif).
- Item SELESAI/USANG-tanpa-issue (FOS-01/02/11/16/18/20/22/23/24/25/26 minus yang sudah
  bernomor, INFRA-03, HIST-01/02, AGENT-02) — tidak butuh aksi Paperclip, cukup dicatat di sini.
