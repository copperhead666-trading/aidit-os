# 10 Layer Aidit OS — Perbandingan dengan Sumber Valid

## Sumber yang digunakan

| Sumber | Status akses | Catatan |
|--------|-------------|---------|
| The Agent Stack (ai-agents-cybersecurity/agent-stack) | TIDAK DIVERIFIKASI | Repository (interactive map) tidak bisa di-extract API (403). Struktur layer dari PRD ENAM-STACK dan nama L0-L10 selaras dengan referensi umum agent-stack. |
| Anthropic "Building Effective Agents" | TERVERIFIKASI | Web search sukses. Bukan layer stack — arsitektural pattern: augmented LLM → prompt chaining/routing/parallel/orchestrator-workers/evaluator-optimizer → autonomous agent loop. |
| Anthropic "Effective Context Engineering" | TIDAK DIVERIFIKASI | Akses ditolak (http_error). |
| 12-Factor Agents (HumanLayer) | TERVERIFIKASI | 12 prinsip desain agent yang andal — bukan layer stack, melainkan prinsip lintas-layer. |
| FounderOS (Bennett) | TERVERIFIKASI | PRD ENAM-STACK lokal + web thefounderos.com. 6-layer + 4-layer dari situs FounderOS. |

---

## Tabel perbandingan per layer

Revisi 2026-09-17 (instruksi-02 bagian C): tabel di bawah sebelumnya menyebut
"Layer PRD diambil dari `AUDIT_AIDIT_OS_2026-09-17.md` bagian 12" — itu audit,
bukan PRD. **Tidak ada file PRD "10 layer" tersendiri** di `docs/prd/`; satu-satunya
PRD di sana, `docs/prd/PRD-AIDIT-OS-V5.1-HEMAT.md` §2 "Peta enam layer Bennett →
v5.1" (baris 33-42), mendefinisikan **6 layer** (01 Orchestrator, 02 Back office,
03 Model lanes, 04 Worker pool, 05 Hands, 06 Metal) — bukan 10. Struktur L0-L10
di tabel ini tetap berasal dari kerangka "The Agent Stack" (belum terverifikasi,
lihat tabel Sumber di atas) yang dipetakan manual ke 6 layer PRD tersebut; kutipan
PRD langsung ditambahkan di kolom "Padanan" untuk tiap baris yang punya padanan.

| # | Nama layer (PRD) | Padanan di sumber valid | Definisi final (bahasa awam) | Implementasi di Aidit OS (setelah pemulihan Tahap 0-5) | Status | Prioritas (1-3) | Celah | Rekomendasi (tidak dieksekusi) |
|---|------------------|------------------------|-----------------------------|--------------------------------------------------------|--------|:---:|-------|-------------------------------|
| L0 | **Substrate** — OS, hardware, network, fondasi fisik | FounderOS L6 Metal (PRD-AIDIT-OS-V5.1-HEMAT.md:42 "06 Metal"), The Agent Stack L0 Substrate | Komputer fisik + OS + jaringan yang menjalankan semuanya. Kayak fondasi rumah. | Lenovo B40-70 Windows 10, i5-4210U, RAM 10 GB, HDD 500 GB. PM2 daemon. Tailscale mesh. Tanpa Docker/WSL2. | SEBAGIAN | 3 | HDD tua, RAM minimal, tanpa sandbox Docker. Disk C: 11 GB free rentan penuh. | Upgrade ke SSD + RAM 16 GB jangka pendek; Docker/WSL2 untuk sandbox worker. |
| L1 | **Model** — AI model provider yang memasok model ke seluruh stack | FounderOS L3 Model Lanes (PRD-AIDIT-OS-V5.1-HEMAT.md:39 "03 Model lanes"), 12-Factor F4, Anthropic augmented LLM | Langganan/token API model AI (Claude, GPT, OpenRouter) yang "nyala" dan bisa dipakai. | OpenRouter (free + paid deepseek-v4-flash), Claude Pro, Codex gpt-5.5. Ollama mati/dilepas. Orkestrator jalankan rutin via deepseek. | SEBAGIAN | 1 | instruksi-04 (2026-09-17): profil `CLAUDE_CONFIG_DIR` Orkestrator (`D:/aidit-claude-machine`) ternyata **tidak pernah login** (bukan cuma expired) — dicek langsung, tidak ada file kredensial. PRD (baris 47-51, ditulis 15 Sep) mengasumsikan akun `pusatberasmurah` = mesin dan `adityainofficial` = sesi owner; keadaan nyata hari ini terbalik dari itu: `~/.claude` (profil default, dipakai sesi ini) login sebagai **pusatberasmurah@gmail.com** dengan kredensial baru (dites nyata, balas "OK"). ecosystem.config.cjs sudah diubah agar Orkestrator memakai profil yang sama dengan sesi ini (`C:/Users/WIN10/.claude`) — **menunggu `pm2 restart orkestrator`** oleh Aidit karena sesi ini tidak bisa konek ke pipe PM2 (`EPERM \\.\pipe\rpc.sock`). Codex: bukan 401 lagi, akun kena usage limit sampai 19 Sep (lane gpt-5.5 dinonaktifkan sementara, config/lanes.json). | Aidit jalankan `pm2 restart orkestrator ops` dari PowerShell miliknya sendiri (sesi ini tidak bisa). Setelah itu verifikasi ulang `node conductor/status.mjs`. |
| L2+L3 | **Prompt & Context** — System prompt, persona, manajemen context window (digabung — lihat AID-104) | FounderOS L1 Context (4-layer), 12-Factor F2 (own prompts, SEBAGIAN) + F3 (own context window), Anthropic context engineering | Teks instruksi yang memberitahu AI siapa dia (CLAUDE.md, Prompt Matrix) **dan** cara AI mengingat percakapan/kode sebelumnya tanpa overload (kompaksi, ringkasan, retrieval) — dua hal ini praktiknya tak terpisah, lihat catatan tumpang-tindih di bawah. | Prompt: AGENTS.md, CLAUDE.md, Prompt Matrix (docs/standards/PROMPT_MATRIX.md) dengan validator `validatePromptMatrix` di guard.mjs. Context: `ledgerTail()` baca 256 KB terakhir ledger (bukan full file) + graphify untuk knowledge graph query. | SEBAGIAN | 1 | Prompt: validator baru mengecek **penanda kata** 8 unsur (regex/keyword), bukan isi/kualitasnya — jadi F2 "Penuh" di ringkasan lama itu berlebihan, direvisi jadi SEBAGIAN. Context: `ledgerTail()` sudah ADA (bukan TIDAK ADA seperti versi lama dokumen ini) tapi itu cuma truncation ledger — tick conductor tetap memasukkan JSON state Paperclip + machine health tanpa batas ukuran, tanpa kompaksi/RAG. Lihat issue AID-101. | AID-101 (kompaksi state tick) + AID-104 (gabung layer ini resmi di dokumen). Validator Prompt Matrix cek isi tiap unsur, bukan cuma keberadaan kata kunci. |
| L4 | **Tools** — MCP, function calling: akses ke data/sistem, guard | FounderOS L5 Hands (PRD-AIDIT-OS-V5.1-HEMAT.md:41 "05 Hands"), The Agent Stack L4 Tools, 12-Factor F1, F4 | Alat yang **disediakan sistem** ke AI: MCP server, API eksternal, integrasi luar. Diawasi guard. (Batas tegas vs L7: lihat AID-104 — L4 = alat, L7 = kemampuan/konfigurasi agent yang memakai alat itu.) | .mcp.json v5: graphify, gbrain, paperclip, web, github, canva. Guard hook di guard.mjs untuk batasi Bash/file tool. | ADA | 3 | Ruflo MCP dinonaktifkan (tidak ada salahnya). .mcp.json belum punya MCP Telegram atau MCP custom untuk venture. | Tambah MCP Telegram untuk dispatch sendMessage langsung. Pin versi MCP. |
| L5 | **Loop** — Agent loop: retry, timeout, resting, fallback chain | Anthropic agent loop, 12-Factor F8 (own your control flow), F9 (compact errors) | Mekanisme coba-ulang kalau AI gagal/gangguan. Resting, fallback ke lane/model lain. Dead-man switch. | lanes.mjs: retry 3x (5/15/45 detik) untuk hermes-cli, resting 60 menit, fallback chain per role. Dead-man switch: scheduled task 5 menit + worker gate. **Baru (instruksi-02 A.2, 2026-09-17)**: `recordLaneFailure`/`recordLaneSuccess` di lanes.mjs — circuit breaker deterministik, 3x gagal 429/401 berturut-turut (tanpa sukses di antaranya) baru resting 60 menit; error dengan jam reset eksplisit tetap langsung resting. Diuji `conductor/lanes.test.mjs` (3 test, hijau). | SEBAGIAN | 2 | Circuit breaker baru **ditulis, belum aktif** di proses Orkestrator yang berjalan — `conductor/run.mjs` proses panjang (setInterval), kode baru baru kepakai setelah `pm2 restart orkestrator`. Retry 5/15/45 detik cuma untuk hermes-cli lanes. Tidak ada exponential backoff lintas-role. | Setelah restart PM2, pantau 2-3 tick untuk pastikan circuit breaker jalan nyata (bukan cuma lolos unit test). |
| L6 | **Memory** — State, knowledge base, ledger, dokumen | FounderOS L2 Back office/Paperclip (PRD-AIDIT-OS-V5.1-HEMAT.md:38 "02 Back office"), 12-Factor F5 (unify execution & business state), The Agent Stack L6 Memory | Data yang "diingat" sistem: state pekerjaan, knowledge base, file bisnis. Basis untuk pengambilan keputusan. | Paperclip (issue board, 104 issue setelah instruksi-02 D), ledger.jsonl (event log), graphify-out/graph.json (knowledge graph), docs/, config/. Gbrain di v4 belum dipindah. | SEBAGIAN | 2 | Gbrain di v4, belum dimigrasi ke v5 (rencana migrasi didaftarkan AID-103, belum dieksekusi). Tidak ada RAG pipeline. Ledger tidak ada rotasi terjadwal otomatis (rotasi manual Tahap 3). | AID-103 (rencana migrasi gbrain). Implementasi RAG pipeline untuk knowledge retrieval; Paperclip sebagai SSOT. |
| L7 | **Agents** — Definisi agent per department, lane, pool | FounderOS L4 Worker Pool (PRD-AIDIT-OS-V5.1-HEMAT.md:40 "04 Worker pool"), 12-Factor F10 (small, focused agents), Anthropic orchestrator-workers | Agent AI yang terdefinisi: punya peran, lane, pool, **kemampuan/konfigurasi** (model, maxTurns, capabilities) — bukan alat itu sendiri (itu L4). Karyawan digital. | company.json: 9 departemen, 17 lane (setelah Tahap 3: 4 aktif + disabled, gpt-5.5 baru dinonaktifkan lagi 2026-09-17 karena usage limit). Capabilities per lane di config/lanes.json. Pool semaphore. | ADA | 3 | Banyak lane disabled (penyederhanaan Tahap 3 + limit Codex). Agent "Hermes" hanya idle. Tidak ada monitoring pemakaian per agent otomatis. | Ukur efektivitas per lane aktif tiap minggu (AID-76..100 beberapa terkait ini). |
| L8 | **Orchestration** — Conductor/Orkestrator: scheduler, dispatch, tick | FounderOS L1 Orchestrator (PRD-AIDIT-OS-V5.1-HEMAT.md:37 "01 Orchestrator"), Anthropic orchestrator-workers pattern, 12-Factor F6 | Otak sistem yang menjadwalkan kerja, assign task ke departemen, dan memonitor kemajuan tiap 30 menit. | PM2 app "orkestrator" (ex-conductor): tick tiap 30 mnt (setInterval, proses panjang), OpenRouter deepseek untuk rutin, Claude Opus/Sonnet untuk keputusan. Head dispatch via Paperclip wake-on-assign. v5 sudah di-merge dari fix/v5-recovery (commit ff6672f) + 21 commit lanjutan sampai 6eab091. | ✅ HIDUP (SEBAGIAN keputusan Claude) | 1 | Jalur Claude untuk keputusan baru diperbaiki di config (menunggu restart PM2, lihat L1). Dead-man sudah aktif. `pm2 ls`/`pm2 restart` dari sesi Claude Code ini gagal `EPERM \\.\pipe\rpc.sock` — kemungkinan daemon PM2 berjalan di sesi Windows berbeda dari terminal ini; Aidit perlu jalankan restart dari PowerShell miliknya. | Aidit jalankan `pm2 restart orkestrator ops`. Prioritaskan paid model (deepseek) untuk stabilitas tick rutin, Claude untuk keputusan saja. |
| L9 | **Verification** — Test, review, QA gate | FounderOS QA/Review department (bag. dari 6-layer, bukan layer terpisah), 12-Factor F7 (contact humans with tool calls — dipetakan ke L10, bukan L9), Anthropic evaluator-optimizer pattern | Pemeriksaan kualitas sebelum kode diterima: test suite, review, approval. Gerbang merge. | Test suite: Node 22, 972 tes + typecheck (dijalankan manual/on-demand). Review policy di company.json ("gerbang merge" sebagai kebijakan, bukan gerbang teknis). Guard hook membatasi tool saat runtime. | SEBAGIAN | 1 | 972 tes + typecheck **ada dan jalan** (bukan TIDAK ADA seperti versi lama dokumen ini) — yang belum ada adalah **gerbang otomatis**: tidak ada yang memaksa test/typecheck lulus sebelum merge ke v5 (merge masih manual `git merge`). Issue AID-48 (401 historis) masih backlog, kini stale karena situasi Codex sudah berubah (usage limit, bukan 401). | AID-102 (gerbang otomatis: Task Scheduler/git hook, test+typecheck wajib lulus sebelum merge). |
| L10 | **Interface** — Telegram, web, voice: pintu owner | FounderOS Telegram + dashboard (bag. dari 6-layer), 12-Factor F7 (contact humans) + F11 (trigger from anywhere) | Cara Aidit bicara sama sistem: Telegram, web dashboard, (nanti) suara. F7 12-Factor (contact humans) dipetakan konsisten ke sini, bukan L9, karena "contact humans" = jalur komunikasi owner, bukan QA. | Telegram bot (PM2 "telegram" online). Dashboard Next.js port 4200 (aidit-v5 PM2 online). Voice belum. | SEBAGIAN | 2 | Jarvis briefing (pagi/malam/biaya) terdaftar di scheduled task (AiditOS-Jarvis-Pagi/Malam/Biaya, "Ready") tapi progress AID-73 masih blocked. Voice belum ada. Hanya 1 pintu owner (Telegram) yang aktif. | Cek kenapa AID-73 blocked (lihat status di bawah). Rancang endpoint Siri (Tahap 5, di luar cakupan sesi ini). |

---

## Layer PRD yang kabur, tumpang tindih, atau tidak punya padanan

| Masalah | Layer | Penjelasan |
|---------|-------|-----------|
| **Tumpang tindih L2 (Prompt) & L3 (Context)** | L2 ↔ L3 | Dalam praktik, prompt engineering dan context engineering tidak bisa dipisah tegas — keduanya soal "apa yang dikasih ke LLM". FounderOS 4-layer menggabung keduanya jadi "L1 Context". 12-Factor punya F2 (own prompts) dan F3 (own context window) sebagai prinsip terpisah. Saran: gabung L2+L3 jadi **L2 Prompt & Context** karena implementasi di Aidit OS sulit dipisah. |
| **L9 (Verification) tidak punya padanan eksplisit di FounderOS 6-layer** | L9 | FounderOS 6-layer tidak punya layer Verification terpisah — QA termasuk di dalam organisasi departemen (company.json ada departemen QA/Review). The Agent Stack 10-layer memisahkannya sebagai layer kesembilan. Ini perbedaan filosofi: QA sebagai fungsi vs QA sebagai layer. Implementasi Aidit OS masih lemah di sini. |
| **L0 (Substrate) tumpang tindih dengan FounderOS L6 Metal** | L0 ↔ FOS L6 | Keduanya tentang hardware/OS. FounderOS menyebutnya "Metal", 10-layer menyebutnya "Substrate". Saran: pertahankan "L0 Substrate" untuk konsistensi dengan 10-layer. |
| **L5 (Loop) tidak eksplisit di FounderOS** | L5 | FounderOS menyandarkan loop/retry ke behavior bawaan Claude Code CLI, bukan layer terpisah. 10-layer lebih eksplisit soal mekanisme retry/resting. Implementasi Aidit OS sudah punya lanes.mjs yang menangani ini. |
| **L8 (Orchestration) vs FounderOS L1 Orchestrator** | L8 ↔ FOS L1 | FounderOS menjadikan Orchestration sebagai prioritas utama (layer 1). 10-layer menempatkannya di L8. Ini perbedaan urutan prioritas, bukan substansi. Implementasi Aidit OS sudah sesuai keduanya. |
| **L4 (Tools) Kabur batasnya dengan Agent capabilities** | L4 | MCP server vs tool bawaan agent (read_file, write_file, bash) — mana yang termasuk L4? PRD dan antropik mendefinisikan Tools sebagai MCP + function calling. Capabilities lane (decide/code/write) termasuk L7 (Agents). Perlu pemisahan tegas: L4 = alat yang disediakan sistem (MCP, API), L7 = kemampuan agent (model, maxTurns). |

---

## Ringkasan perbandingan dengan FounderOS (6-layer)

| FounderOS Layer | Padanan 10-layer PRD | Kecocokan |
|----------------|---------------------|-----------|
| L1 Orchestrator | L8 Orchestration | ✅ Cocok. PM2 app orkestrator setelah Tahap 2. |
| L2 Back Office (Paperclip) | L6 Memory (state) + L7 Agents (definition) | ⚠️ Sebagian. Paperclip = board (L6), tapi definisi agent di company.json = L7. |
| L3 Model Lanes | L1 Model | ✅ Cocok. Config lanes.json. |
| L4 Worker Pool | L4 Tools + L7 Agents | ⚠️ Sebagian. Worker = L7 Agent yang jalan, tapi pool semaphore = L5 Loop. |
| L5 Hands (MCP) | L4 Tools | ✅ Cocok. .mcp.json. |
| L6 Metal | L0 Substrate | ✅ Cocok. Lenovo + PM2 + Tailscale. |

## Ringkasan perbandingan dengan 12-Factor Agents

| 12-Factor | Layer PRD terkait | Catatan |
|-----------|------------------|---------|
| F1 Natural Language to Tool Calls | L4 Tools | Sudah di implementasi packetText + guard. |
| F2 Own Your Prompts | L2+L3 Prompt & Context | SEBAGIAN (revisi 2026-09-17: validator Prompt Matrix baru mengecek penanda kata 8 unsur, bukan isi/kualitasnya — bukan "Penuh"). |
| F3 Own Your Context Window | L2+L3 Prompt & Context | SEBAGIAN (revisi 2026-09-17: `ledgerTail()` ADA untuk truncation ledger — bukan "Tidak ada" — tapi state tick Paperclip/machine health masih tanpa batas, lihat AID-101). |
| F4 Tools Are Structured Outputs | L4 Tools | Sudah (packet format). |
| F5 Unify State | L6 Memory | Sebagian (ledger unified, Paperclip belum fully). |
| F6 Launch/Pause/Resume | L8 Orchestration | Pause flag ada. Resume manual. |
| F7 Contact Humans | L10 Interface | Telegram owner ask. |
| F8 Own Your Control Flow | L5 Loop | lanes.mjs tick + fallback chain. |
| F9 Compact Errors | L5 Loop | Error disimpan ke ledger, tapi tidak dikompaksi ke context. |
| F10 Small, Focused Agents | L7 Agents | Lane terdefinisi. Tapi beberapa agent masih terlalu besar scope-nya. |
| F11 Trigger Anywhere | L10 Interface | Telegram + scheduled task. |
| F12 Stateless Reducer | L6 Memory | Belum (state di file). |

---

## Kesimpulan

1. **Layer paling kuat**: L4 Tools (MCP), L7 Agents (definisi lane), L8 Orchestration (✅ hidup).
2. **Layer paling lemah**: L3 Context (TIDAK ADA), L9 Verification (TIDAK ADA), L0 Substrate (HDD rapuh).
3. **Layer yang kabur/tumpang tindih**: L2 ↔ L3 (Prompt vs Context), L4 ↔ L7 (Tools vs Agent capabilities). Saran: gabung L2+L3, pisahkan L4+L7 dengan definisi lebih tegas.
4. **Celah kritis**: Tidak ada mekanisme kompaksi context (L2+L3) — state tick bisa meledak (AID-101). Tidak ada automated QA gate (L9) — kode bisa merge tanpa tes (AID-102). Profil Claude Orkestrator sudah dikoreksi di config, menunggu restart PM2 oleh Aidit (L1/L8).
5. **Prioritas setelah fase ini**: (1) Aidit restart PM2 agar profil Claude aktif dan circuit breaker terpakai; (2) AID-102 gerbang otomatis; (3) AID-101 kompaksi context, AID-103 rencana migrasi gbrain, AID-104 rapikan definisi layer.

---

## Riwayat revisi

| Tanggal | Perubahan | Oleh |
|---------|-----------|------|
| 2026-09-17 (instruksi-02 bagian C, lewat instruksi-04) | Koreksi klaim sumber ("diambil dari AUDIT" → PRD 6-layer dikutip langsung dari `docs/prd/PRD-AIDIT-OS-V5.1-HEMAT.md:33-42`, tidak ada file PRD "10 layer"). Kalibrasi status: L3→SEBAGIAN (ledgerTail ada), L9→SEBAGIAN (972 tes+typecheck ada, gerbang otomatis belum), F2→SEBAGIAN (validator cuma cek penanda kata), F7 dipetakan eksplisit ke L10. Gabung L2+L3 jadi "Prompt & Context" (baris tabel; penggabungan resmi tetap didaftarkan sebagai AID-104). Tambah kolom Prioritas (1-3). Update L1/L8/L5 dengan temuan instruksi-04 (profil Claude, circuit breaker baru, status Codex). Daftarkan AID-101..104 di Paperclip (instruksi-02 bagian D). | Claude Code (sesi instruksi-04) |
4. **Celah kritis**: Tidak ada mekanisme kompaksi context (L3) — state tick bisa meledak. Tidak ada automated QA gate (L9) — kode bisa merge tanpa tes. Profil Claude Orkestrator belum login (L1/L8).
5. **Prioritas setelah fase ini**: Login profil Claude → perbaiki context management → setup automated testing gate.