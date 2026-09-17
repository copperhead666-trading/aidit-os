# PRD — Aidit OS v5: Enam Stack Bennett di atas Sepuluh Layer

Tanggal: 2026-09-14 (WIB). Penulis: orkestrator (SOEKARNO) dari 8 putaran tanya-jawab dengan
owner sore ini. Status: **disetujui owner untuk dieksekusi malam ini** (owner: "tulis PRD-nya
lengkap, buat handoff dan prompt sesi baru"). Menggantikan PRD v3 (JARVIS) dan v4 (cockpit)
sebagai arah utama; PRD 10-Layer tetap sebagai standar kualitas per layer.

Sumber northstar: https://founderos-agent-stack.vercel.app (Bennett, "Founder OS — The Agent
Stack") dan repo https://github.com/Bennettxai/FounderOS-DEMO (MIT, vendored di
`vendor/founderos-demo`, commit d5e565e).

---

## 1. Masalah dan northstar

Aidit OS berprogres tetapi lambat dan belum menjadi alat owner untuk mengerjakan venture.
Perbandingan jujur 2026-09-14 terhadap enam layer Bennett:

| Layer Bennett | Bennett | Aidit OS hari ini | Jarak |
|---|---|---|---|
| 01 Orchestrator | Conductor + kepala departemen = Claude Code headless (OAuth), commit sendiri | Sesi interaktif orkestrator (hidup hanya saat terminal dibuka; idle 5 jam hari ini); headless hanya `integrator.mjs` deterministik | Besar |
| 02 Back office | Paperclip di belakang layar: org, tiket, heartbeat, budget | Paperclip mati; kerja nyata di `state/dispatch/tasks/*.json` gate buatan sendiri; dua sumber kerja | Rusak/ganda |
| 03 Model lanes | GLM 5.2/5.1/flash (Ollama Cloud) + Codex; milik pekerja | Sama + Kimi (Ollama) + Claude sub; hari ini Ollama 503/timeout 5×, Codex limit, Kimi mentok langkah; tanpa failover | Rapuh |
| 04 Worker pool | Hermes gateway di loopback + Tailscale, cron + MCP per karyawan | Hermes hanya GIBRAN (review). Pekerja = worktree git yang di-spawn gate + guard hook | Besar |
| 05 Hands | MCP: CRM, payments, Notion, Canva, transkrip, terminal; satu config diwarisi semua | `.mcp.json` hanya di sesi orkestrator; lane memakai tool custom | Besar |
| 06 Metal | Mac mini + Docker per pekerja / Railway; Tailscale satu pintu | Lenovo Windows + PM2, tanpa sandbox; Tailscale tailnet-only ✓; disk penuh tanpa alarm | Sedang |
| Seed = perusahaan | departemen, agen, funnel dalam satu file | 2 venture terdaftar, 0 pekerjaan venture berjalan | Inti masalah |

**Northstar v5**: enam stack persis seperti Bennett, di Lenovo, tanpa meter per-token, dan
hasilnya diukur dari venture: SJS SuperApps menjadi satu-satunya aplikasi operasional, Caveman
Trading OS modul pertama, 30 hari tanpa campur tangan teknis owner.

## 2. Keputusan owner yang mengikat (2026-09-14, 18:20–19:10 WIB)

1. **Basis kode**: fork `FounderOS-DEMO` menjadi tulang punggung (seed, board, conductor,
   cockpit). Dari Aidit lama hanya dibawa **suara** (VoiceBox/Piper masuk-keluar), **brand kit**
   (`docs/brand/**`), **departemen design** (Canva hand, deck). Semua yang lain dibuat ulang
   dari template agar tidak mewarisi bentuk Aidit lama.
2. **Lokasi**: `D:/AI/aidit-os-v5`; repo GitHub `copperhead666-trading/aidit-os` branch `v5`
   (menjadi `main` setelah lulus bukti). Repo/folder lama tetap utuh sebagai arsip.
3. **Orchestrator**: Conductor headless Claude (`claude -p`, OAuth) di PM2, bangun tiap
   30 menit. Opus hanya untuk keputusan (spec, prioritas, integrasi macet), maks 40 turn
   Opus/hari; heartbeat rutin di Sonnet/Haiku. Sesi interaktif orkestrator = supervisor.
4. **Back office**: Paperclip satu-satunya papan (org, tiket, heartbeat, budget). Reset bersih;
   tiket KOL lama diarsip ke gbrain. Dijalankan di WSL2/Docker dengan Postgres sendiri.
   Gate v5 = eksekutor yang menarik tiket Paperclip, bukan antrian sendiri.
5. **Model lanes & kepala departemen**: kepala Product dan Engineering = Claude; kepala lain =
   Kimi K3 via Kimi CLI. Karena Kimi Code 403 (kuota bulanan habis), sementara memakai
   GPT-6 Astra via Codex CLI (paket ChatGPT). Rantai fallback: Kimi K3 → GPT-6 Astra (Codex)
   → Claude → Ollama Cloud (runtime penalaran terbaik yang tersedia; K3 via Ollama dilarang).
   Pekerja: Codex, Kimi k2.7-code (Ollama), GLM 5.1/5.2/flash. Conductor: Opus untuk keputusan.
6. **Failover**: retry 1× di lane yang sama setelah 5 menit, lalu lane berikutnya di rantai;
   probe kuota tiap 15 menit, lane yang limit "istirahat" sampai reset; task besar dipecah
   otomatis saat mentok batas langkah; bila semua lane habis: tahan antrian + Alert, jangan
   paksa Claude.
7. **Worker pool**: Hermes gateway di loopback belakang Tailscale, di WSL2/Docker (Lenovo);
   lane dipindah bertahap ke dalamnya.
8. **Hands**: satu `.mcp.json` diwarisi semua lane: github, gbrain, canva, paperclip,
   telegram (dibuat sebagai MCP), web. Aksi keluar ke orang lain atau uang tetap di tangan owner.
9. **Metal**: semua di Lenovo (Windows: PM2 + Tailscale; WSL2/Docker: pool + Paperclip).
   ASUS = layar cockpit/terminal portabel saja. Lenovo dibersihkan: inventaris → satu Ask
   berisi daftar → SETUJU → eksekusi. Selalu dikecualikan: Telegram, WhatsApp, Google,
   browser, Tailscale, Node, Docker/WSL2, Ollama, CLI Codex/Kimi/Claude; dokumen
   pribadi/akademik/foto tidak pernah disentuh.
10. **Pintu owner**: Telegram utama (bot "Ahmad", token sama; nama tampil JARVIS; Indonesia
    formal "Bapak"). Cockpit = port FounderOS demo sebagai layar detail yang jarang dibuka;
    Cockpit Talk hari ini dilebur ke Conductor chat demo. Owner sering cek HP: Ask boleh
    kapan saja. `/pause` = tombol darurat menghentikan semua departemen.
11. **Departemen (8)**: Product/PM, Engineering, Design, QA/Review (gerbang merge),
    Ops/Infra (self-repair), Finance/Kuota, Marketing/Content, Research. Satu suara JARVIS
    (Conductor) yang merangkum; departemen tidak menghubungi owner langsung.
12. **Otonomi di repo venture** tanpa Ask: tulis kode + tes + PR; merge ke main bila tes + QA
    hijau; deploy staging (SJS: push `dev` → Netlify; migrasi Supabase staging; ubah setting
    Supabase/Netlify); desain/aset (Canva, logo, deck). **Produksi, uang, orang luar = Ask.**
13. **Self-improve/repair** tanpa Ask (Ask hanya uang/orang luar): restart layanan
    (PM2/Docker), bunuh lane macet, jalankan ulang task, hapus cache/temp/worktree lama saat
    disk < 10 %, rotasi log, ubah alokasi lane/model dari probe, restart Lenovo bila macet total.
14. **Venture**: repo GitHub terpisah (`copperhead666-trading/sjs-superapps`,
    `caveman-trading-os`); pekerja clone ke sandbox; Aidit OS menyimpan tiket + tautan.
    Orkestrator mengajukan PRD venture ke owner via Telegram → SETUJU/revisi. README/PRD
    per repo = tujuan & batasan owner; mesin memilih stack & memecah backlog; owner meninjau
    backlog lewat Ask (bebas, tidak dijadwalkan).
15. **Target**: SJS SuperApps = satu-satunya aplikasi operasional (menggantikan LOKA kasir dan
    aplikasi lain), **cutover 21 Sep** (agresif; risiko data/operator dicatat §12). Mesin
    menyiapkan impor data + panduan operator (video/GIF); owner/operator mengisi data nyata
    dan menguji; cutover saat owner SETUJU. Caveman modul pertama (tanpa uang nyata)
    **1 Okt**. 30 hari tanpa campur tangan teknis.
16. **Laporan**: satu Report 07:00 & 19:00 gabungan (≤ 5 baris + 1 baris per venture + tautan
    staging tailnet); video/GIF saat fitur venture selesai; deck PDF mingguan Minggu malam.
17. **Transisi**: Aidit OS lama dimatikan total (gelap) sampai v5 hidup.
18. **Bootstrap**: orkestrator (sesi Claude Code) menulis fondasi v5 sendiri — pengecualian
    aturan "orkestrator tidak menulis kode" sampai Conductor v5 hidup; setelah itu lane bekerja
    lewat gate v5 dan aturan berlaku kembali.
19. **Memori**: gbrain tetap memori dokumen kanonis (spec, keputusan, handoff).
20. **Caveman creds**: `MT5 Credentials.env` tidak pernah tercommit (diverifikasi); owner
    memindahkannya keluar repo; mesin dilarang membacanya.

## 3. Enam stack — target v5 dan peta ke 10 layer

### 3.1 Orchestrator (Layer 6 Orchestration, 2 Loop, 9 HITL)
- `conductor/run.mjs` (PM2 `conductor`): tiap 30 menit membaca Paperclip (tiket, heartbeat),
  ledger v5, `.mcp.json`; memutuskan dispatch ke departemen; menulis keputusan ke ledger;
  commit sendiri sebagai author `CONDUCTOR`.
- Dua tingkat model: rutin `claude -p --model sonnet` (atau haiku untuk probe/laporan);
  keputusan `--model opus` ≤ 40 turn/hari (`state/conductor-budget.json`, hari WIB).
- Kepala departemen = agen headless dengan system prompt departemen dan lane sesuai §2.5;
  bangun dari tiket yang ditugaskan Conductor.
- Kurungan: `claude -p --restricted` + hook PreToolUse (dibuat ulang ringkas dari pola
  `dispatch/claude-guard.mjs`), Bash hanya `node <skrip di workspace>`.

### 3.2 Back office (Layer 5 Memory, 10 Observability)
- Paperclip (paket `paperclipai`), Postgres sendiri, di Docker (WSL2). Sampai WSL2 terpasang
  (butuh admin + restart, owner hadir): native Windows dengan Postgres lokal 5433.
- Skema org: perusahaan Aidit OS → 2 venture → 8 departemen → agen (kepala + pekerja).
  Tiket: epic per venture, tiket per fitur, sub-tiket per PR. Budget: kuota per lane per hari.
- Heartbeat Paperclip membangunkan Conductor dan kepala departemen; tidak ada antrian lain.
- Ledger v5 = `lib/ledger.ts` demo (SQLite) sebagai jejak peristiwa + gbrain untuk dokumen.

### 3.3 Model lanes (Layer 1 Harness, 4 Tool)
- `config/lanes.json`: id, runtime (claude-cli | codex-cli | kimi-cli | ollama), model,
  pool kuota, kapabilitas, batas langkah, rantai fallback, jadwal probe.
- Rantai kepala non-Claude: `kimi-k3 (kimi-cli)` → `gpt-6-astra (codex-cli)` → `claude
  sonnet` → `ollama: kimi-k2.7-code / glm-5.2`. Rantai pekerja: `codex` → `kimi-k2.7-code`
  → `glm-5.1` → `glm-5.3-flash` (ringan).
- Probe kuota tiap 15 menit (health, containment, quota) → status `ready | resting(until) |
  disabled`; task ke lane `resting` dilarang.

### 3.4 Worker pool (Layer 7 Guardrails)
- Hermes gateway (Nous) di WSL2/Docker, bind 127.0.0.1, diekspos hanya via Tailscale serve;
  satu "karyawan" per departemen dengan chat, cron, MCP.
- Sampai Hermes terpasang: runner headless per lane di Windows (pola gate lama, ditulis
  ulang ringkas) dengan worktree/clone per tugas dan guard hook.
- Sandbox: Docker per pekerja untuk venture (clone repo venture di dalam kontainer);
  rahasia diberikan per tugas lewat env allowlist, bukan seluruh `.env.local`.

### 3.5 Hands (Layer 4 Tool Design)
- `.mcp.json` v5: `github` (biner lokal, token dari env), `gbrain`, `canva`, `paperclip`,
  `telegram` (server MCP kecil di atas Bot API: sendMessage/editMessage/sendVoice/getUpdates),
  `web`. Diwarisi Conductor, kepala, pekerja (Hermes membaca file yang sama).
- Tangan design dibawa: `scripts/design/*` (Canva hand, imagegen, render, deck).
- Tangan suara dibawa: VoiceBox/Piper (`voice-in`, `voice-out`) sebagai konektor.

### 3.6 Metal (Layer 7, 10)
- Lenovo: Windows (PM2: `aidit-v5` cockpit 4200, `conductor`, `telegram`, `heartbeat`),
  WSL2/Docker (Paperclip + Postgres, Hermes, sandbox pekerja). Tailscale serve tailnet-only,
  satu pintu. Node 22 pinned.
- Ops/Infra: alarm disk (< 10 %) dan RAM (< 1 GB) → tindakan otomatis (§2.13) + Alert;
  inventaris aplikasi Lenovo → Ask daftar → eksekusi.
- ASUS: hanya browser ke cockpit/tailnet.

### 3.7 Peta 10 layer → bukti v5
| Layer | Bukti v5 |
|---|---|
| 1 Harness | runner per lane dengan kurungan; probe 3/3 DENIED di luar workspace |
| 2 Loop | Conductor 30 menit + heartbeat Paperclip; retry/fallback otomatis |
| 3 Context | tiket + README venture + gbrain sebagai konteks; batas ukuran konteks per task |
| 4 Tool | `.mcp.json` tunggal; tangan design & suara |
| 5 Memory | Paperclip (state operasional), ledger v5 (peristiwa), gbrain (dokumen) |
| 6 Orchestration | Conductor → kepala → pekerja; satu writer per worktree |
| 7 Guardrails | Docker sandbox, guard hook, amplop otonomi §2.12–13, `/pause` |
| 8 Evals | QA/Review = gerbang merge; acceptance per tiket harus mengeksekusi kriteria (R1–R5) |
| 9 HITL | Telegram JARVIS: Report/Ask/Alert, lexicon, Indonesia formal, default bila diam |
| 10 Observability | ledger v5 + trace per tiket + Report; deck mingguan |

## 4. Organisasi dan seed (`lib/seed.ts` v5)

| Departemen | Kepala (lane) | Pekerja | Tugas inti |
|---|---|---|---|
| Product/PM | Claude (sonnet; opus untuk PRD) | Kimi/Codex | README/PRD venture → backlog tiket → prioritas; ajukan PRD ke owner |
| Engineering | Claude | Codex, Kimi k2.7, GLM 5.1 | kode, tes, PR, merge bila QA hijau, deploy staging |
| Design | Kimi K3 → Astra | Canva hand, imagegen | UI, aset, deck, video/GIF demo |
| QA/Review | Kimi K3 → Astra | GIBRAN (Hermes) + tes | gerbang merge; menolak PR tanpa tes/acceptance |
| Ops/Infra | Kimi K3 → Astra | skrip + GLM flash | self-repair, probe lane, disk/RAM, bersih-bersih Lenovo |
| Finance/Kuota | Kimi K3 → Astra | GLM flash | pemakaian Claude/Codex/Ollama/Kimi per hari & per venture; Ask hanya bila menyentuh uang |
| Marketing/Content | Kimi K3 → Astra | Canva hand, GLM | funnel & konten venture (setelah produk ada) |
| Research | Kimi K3 → Astra | GIBRAN_SURVEY + web | riset pasar/teknologi → gbrain |

Seed juga memuat: 2 venture (SJS, Caveman) dengan tautan repo, staging, dan status; budget
kuota per lane; persona JARVIS; lexicon; register Indonesia formal.

## 5. Alur kerja tiket

Owner (Telegram/README) → Product/PM membuat/menyusun tiket di Paperclip → Conductor menugaskan
departemen & lane (rantai + probe) → pekerja bekerja di sandbox (clone repo venture, branch,
tes) → PR → QA/Review (tes + acceptance + GIBRAN) → merge otomatis bila hijau → deploy staging
(SJS: `dev` → Netlify) → Design membuat GIF/video bila fitur selesai → JARVIS merangkum di
Report 07/19 dengan tautan staging. Setiap langkah = peristiwa ledger + komentar tiket.

## 6. Pintu owner (Telegram)

- Tiga jenis pesan: **Report** (07:00, 19:00; ≤ 5 baris + 1 baris/venture + tautan), **Ask**
  (kapan saja; tombol SETUJU / TOLAK / NANTI / JELASKAN; opsi A/B/C; kalimat wajib "Jika
  Bapak tidak menjawab dalam 24 jam, …"), **Alert** (darurat; apa yang terjadi, apa yang sudah
  dilakukan, perlu tindakan atau tidak).
- Register Indonesia formal, sapaan "Bapak", tanpa istilah teknis/nomor tiket (lexicon gate
  dibawa dari persona lama); suara: Report bersuara ≤ 2/hari (VoiceBox/Piper).
- `/pause` menghentikan semua departemen dan Conductor; `/resume` melanjutkan; `/status`
  ringkas; `/cockpit` tautan cockpit.
- Cockpit (port demo) = layar detail; tidak ada notifikasi dari cockpit.

## 7. Venture

### 7.1 SJS SuperApps — target cutover 21 Sep
- Repo `copperhead666-trading/sjs-superapps` (Next.js statis + Supabase + Netlify; 287 commit;
  `PRODUCT.md`, spec `docs/superpowers/specs/2026-08-13-erp-full-features-design.md`;
  `ERP-FINAL-READINESS-REPORT.md`: data 55 %, alur kasir PARTIAL, operator run pending).
- Definisi selesai (owner): SJS satu-satunya aplikasi operasional, tanpa LOKA kasir dan
  aplikasi lain.
- Jalan: (15 Sep) Product mengajukan PRD SJS v5 ke owner dari PRODUCT.md + spec + readiness →
  SETUJU; (15–18 Sep) Engineering menutup alur inti kasir shift→jual→tutup, stok, pembelian,
  kas, approval owner; QA + tes operator; (16–19 Sep) alat impor data master + panduan
  operator (GIF/video); owner/operator mengisi data nyata; (20 Sep) uji paralel dengan LOKA;
  (21 Sep) cutover saat owner SETUJU. Deploy staging otomatis; produksi = Ask.
- Risiko: data master (staf, AP/AR, BOM, Telur) bergantung owner; 7 hari sangat ketat.

### 7.2 Caveman Trading OS — modul pertama 1 Okt
- Repo `copperhead666-trading/caveman-trading-os` (fase 1: arsitektur/kontrak, tanpa kode
  trading). Owner menulis README (tujuan, batasan) → Product mengajukan PRD → SETUJU →
  modul pertama tanpa uang nyata (backtest/paper). Broker/kredensial tidak pernah disentuh mesin.

## 8. Metal & kebersihan Lenovo

- Prasyarat owner-hadir: WSL2 + Docker Desktop (admin, restart) → Paperclip, Hermes, sandbox.
  Sampai itu: native Windows (Paperclip via `paperclipai`, runner headless).
- Ops/Infra membuat inventaris aplikasi/proses Lenovo → Ask daftar matikan/hapus → eksekusi.
- Alarm disk/RAM; `TEMP` sudah di `E:\Temp`; cache/worktree lama dibersihkan otomatis.

## 9. Rantai model & failover (ringkas)

`lanes.json` mendefinisikan per peran rantai ordered; scheduler memilih lane `ready` pertama;
gagal (503/timeout/limit) → retry 1× setelah 5 menit → lane berikut; probe 15 menit menandai
`resting(until)`; task yang mentok batas langkah dipecah oleh Conductor (Opus) menjadi sub-tiket;
semua habis → antrian ditahan + Alert. Tidak ada meter per-token di mana pun.

## 10. Amplop otonomi & larangan

Boleh tanpa Ask: §2.12–13. Wajib Ask: produksi venture, uang, orang luar (email/DM/pembayaran),
perubahan amplop ini sendiri, pembelian. Dilarang mutlak: membaca kredensial broker, menghapus
dokumen pribadi, membuka port ke internet (hanya Tailscale), meter per-token tanpa persetujuan.

## 11. Bukti lulus per tahap

| Tanggal | Bukti |
|---|---|
| 15 Sep 07:00 | Report pertama dari JARVIS v5; v5 hidup di 4200 (brand); Paperclip 2 venture + 8 departemen; Conductor menulis keputusan pertama; sistem lama berhenti |
| 17 Sep | Stack lulus: 24 jam tanpa terminal, tiket bergerak sendiri, 1 pekerja Hermes (atau runner) menyelesaikan tiket, failover teruji, Report 07/19 tepat |
| 21 Sep | SJS: alur inti + impor data + panduan; cutover LOKA bila owner SETUJU |
| 28 Sep | Docker sandbox + Hermes penuh; deck mingguan pertama |
| 1 Okt | Caveman modul pertama (paper/backtest) |
| 14 Okt | 30 hari tanpa campur tangan teknis owner |

## 12. Risiko jujur

Kuota Claude (Conductor + kepala + SOEKARNO_CODE berbagi satu langganan; batas 40 turn Opus);
Ollama Cloud rapuh (503/timeout); Kimi Code 403 hingga reset (tanggal belum diketahui);
Codex kena limit hari ini; RAM Lenovo tipis (2,5 GB bebas) → Docker perlu ruang; WSL2 butuh
owner hadir; cutover SJS 21 Sep bergantung data & operator; bootstrap oleh orkestrator adalah
pengecualian aturan dan harus berakhir saat Conductor hidup; lane sering melewatkan typecheck →
aturan R1–R5 wajib di setiap acceptance.
