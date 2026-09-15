# PRD — Aidit OS v5.1: stack Bennett pada anggaran ±$100/bulan (hemat token)

Tanggal: 2026-09-15 (WIB). Penulis: orkestrator (SOEKARNO) dari audit pagi ini dan 4 keputusan
owner (AskUserQuestion 15 Sep). Status: **disetujui owner untuk dieksekusi oleh sesi baru**.
Menggantikan cara kerja lane di PRD v5 (`../../../AIdit OS/docs/prd/PRD-AIDIT-OS-V5-ENAM-STACK.md`);
selebihnya PRD v5 tetap berlaku (organisasi, venture, pintu owner, bukti lulus).

## Context

Northstar = Bennett FounderOS (MIT) tetapi ia membayar ±$300/bulan. Kondisi owner: Claude Pro ×2,
Codex Plus ×1, Ollama Cloud ×1, Kimi Code ×1 (≈ $100/bulan). Audit 15 Sep membuktikan boros
bukan karena model, tetapi karena (a) harness buatan sendiri, (b) konteks gemuk dan eksplorasi
bebas, (c) sesi orkestrator interaktif 1.200 turn. Angka: Claude orkestrator 864 juta cache-read
/ 2 hari; lane Claude headless 20–40 juta/run; Kimi 22,6 juta (94 % cache-read); GLM/Kimi via
harness HATTA 61 juta dengan 48/68 gagal; Codex 70 K/tugas, 90 % sukses.

v5.1 = v5 yang sama (Paperclip, Conductor, kepala, Telegram, cockpit) dengan lapisan hemat token
dan penempatan kuota yang tepat. Tidak ada belanja baru; tidak ada meter per-token.

## 1. Riset alat hemat token (apa yang dipakai, apa yang tidak)

| Alat | Menghemat apa | Bukti/klaim | Keputusan v5.1 |
|---|---|---|---|
| **graphify** (Graphify-Labs, terpasang) | token *masuk*: mengganti sapuan Glob/Grep/Read dengan `query --budget` dari graf lokal; `--mcp`, `--watch`, `--wiki` | sudah dipakai repo lama; "replaces multi-step discovery sweeps" | **inti**: graf per repo, MCP hand bersama, paket tugas ≤ 8 kB |
| **RTK** (rtk-ai/rtk, Rust, Apache-2, biner Windows) | token *masuk*: memampatkan output shell/tool (test, git, tsc, grep) 60–90 % sebelum masuk konteks | klaim repo; `rtk gain` mengukur | **inti**: dipasang untuk Claude headless, Codex, Hermes (wrapper `rtk`) |
| **caveman** (JuliusBrussee, terpasang) | token *keluar*: prosa model dipadatkan; `caveman-compress` untuk CLAUDE.md/skill; engine MCP `caveman_compress/retrieve` lokal gratis; Caveman Cloud berbayar (tidak) | klaim 65 % ditarik; proxy −33 % input rata-rata 18 kasus | **inti untuk output** (system prompt lane + sesi); proxy dicoba di Hermes saja; Cloud tidak |
| **superpowers** (obra, terpasang) | bukan token; disiplin proses: brainstorming → writing-plans → subagent-driven-development → TDD → verification-before-completion | tidak ada angka; interaktif, plugin Claude Code | **dipakai sebagai pola**, bukan plugin: kepala Product = brainstorming+writing-plans; Engineering = TDD+verification; QA = requesting-code-review; disuling ke system prompt headless ≤ 1 kB, tanpa memuat plugin |
| **ruflo / claude-flow** (terpasang) | bukan token per se: hooks pre/post-task, memory HNSW lokal, 3-tier routing, worker daemon | tidak ada angka hemat; butuh API key untuk mode penuh (tidak) | **ditiru polanya**: `hooks route` sebelum tugas (tier 1 Edit langsung / tier 2 ringan / tier 3 berat), memory pola operasional; daemon AI worker tetap mati |
| context-mode / Probe / Serena | data berat di luar konteks; pencarian AST | opsional | nanti, bila graphify kurang untuk SJS |
| claude-mem / OpenWiki | memori lintas sesi | tumpang tindih gbrain + wiki graphify | tidak |
| ccusage / cc-budget | melihat pemakaian sesi Claude | lokal, gratis | **ya** untuk Finance/Kuota (baca `~/.claude/projects`), sudah ada skrip audit |

## 2. Peta enam layer Bennett → v5.1

| Layer | Bennett ($) | v5.1 (kuota yang ada) |
|---|---|---|
| 01 Orchestrator | Claude Code headless, langganan | Claude Code headless **akun #1 (mesin, `~/.claude`)**: Conductor keputusan + review Engineering/QA. Sesi manusia/orkestrator = **akun #2 (Bapak)** via `CLAUDE_CONFIG_DIR=D:aidit-claude-machine` (mesin), Sonnet, ≤ 150 turn |
| 02 Back office | Paperclip | Paperclip 3120 ✓ (heartbeat/wake-on-assign saja) |
| 03 Model lanes | GLM-5.2 berat / 5.1 kode / flash ringan (paket GLM) + Codex | **sama**, GLM lewat Ollama Cloud (flat $20) + Codex Plus; Kimi Code = lane konteks besar (disabled sampai reset); kimi via Ollama dimatikan (jaga kuota Ollama) |
| 04 Worker pool | Hermes, cron, MCP, loopback+Tailscale | Hermes 0.21 ✓ (provider Ollama, `fallback` GLM-5.2→5.1→flash→Nous free); semua pekerja + kepala non-Claude |
| 05 Hands | satu `.mcp.json` | `.mcp.json` v5: github, gbrain, paperclip, canva, telegram, **graphify --mcp**, **caveman engine**; diwarisi Hermes/Codex/Claude |
| 06 Metal | Mac mini + Docker + Tailscale | Lenovo PM2 + Tailscale ✓; Docker menunggu Ask WSL2 |

## 2b. Keputusan owner 15 Sep pagi (mengikat)

- Urutan: **v5.1 dulu**, baru tiket SJS jalan lagi (Conductor tetap dijeda; Codex boleh 2–3 tiket SJS kritis manual).
- Akun Claude: **#1 (yang login di mesin sekarang, `~/.claude`) = mesin** (Conductor, QA, review);
  **#2 = Bapak** untuk sesi manusia/orkestrator lewat `CLAUDE_CONFIG_DIR=D:\aidit-claude-owner`
  (login sekali; launcher `ops/claude-machine.cmd`). Kedua login hidup bersamaan; PM2 memakai default.
- Kimi Code: **pekerja kode** (rantai kode: Codex → Kimi → GLM-5.1) — tetapi hanya setelah semua
  harness dibetulkan (Kimi, Codex, Ollama, Claude). Sampai reset: `disabled`.
- Instal alat gratis tanpa Ask: RTK, caveman engine MCP, Hermes provider Ollama, graphify watch.
- Semua Ask semalam SETUJU: AID-1 ke Engineering, WSL2/Docker, PRD SJS, bersih-bersih Lenovo.

## 2c. Fallback saat pool habis (status `ready | resting(until) | disabled`)

| Pool habis | Deteksi | Istirahat sampai | Pindah ke |
|---|---|---|---|
| Claude (mesin) | "usage limit … resets at HH:MM" | jam di pesan | GLM-5.2 untuk keputusan rutin; keputusan sulit **tahan + Alert** |
| Codex | "hit your usage limit … try again at HH:MM" | jam di pesan | Kimi (bila aktif) → GLM-5.1 via Hermes → tahan antrian kode |
| Ollama | 429/503/reset | retry 3× (5/15/45 s), lalu 15 menit | Codex (kode) / Kimi (berat) / Nous free via Hermes (ringan) |
| Kimi Code | 403 | tanggal reset bulanan | Codex → GLM-5.1 |
| Semua | rantai kosong | — | antrian ditahan; Conductor tetap jalan tanpa LLM; satu Alert; lanjut otomatis saat ada `ready` |

Rantai per peran: otak = Claude → GLM-5.2; kode = Codex → Kimi → GLM-5.1; berat = GLM-5.2 → GLM-5.1
→ Codex → Kimi → Nous; ringan = flash → GLM-5.1 → Nous.

## 3. Alokasi kuota

| Pool | Untuk | Pagu harian | Pemisahan |
|---|---|---|---|
| Claude Pro #1 (mesin) | Conductor keputusan (sonnet ≤ 5/hari, opus 0), QA review diff (≤ 8 turn), Engineering review | ≤ 15 panggilan headless | `~/.claude` default; `--setting-sources ""` |
| Claude Pro #2 (Bapak) | sesi manusia/orkestrator (Sonnet) | ≤ 150 turn/sesi, wakeup 60 menit | `CLAUDE_CONFIG_DIR=D:\aidit-claude-owner`, launcher `ops/claude-machine.cmd` |
| Codex Plus | pekerja kode utama | 30 tugas tersebar; limit → resting sampai jam reset dari pesan | `--ephemeral` |
| Ollama Cloud | GLM-5.2 kepala/berat, GLM-5.1 kode cadangan, flash ringan + Conductor rutin | semaphore 2 run serentak; 503 → retry 3× | via Hermes |
| Kimi Code | pekerja kode kedua (Codex → Kimi → GLM-5.1) setelah harness dibetulkan; sampai reset `disabled` | 10 tugas/hari saat aktif | `kimi-home` v5: `max_context_size 65536`, tanpa `always_thinking`, 40 langkah, tanpa retry, paket ≤ 8 kB |

## 4. Skema graphify (lapisan konteks)

1. Graf per repo: `graphify D:/AI/aidit-os-v5 --wiki`, klone SJS, klone Caveman; PM2 `graphify-watch`
   (`--watch`, tanpa LLM); `--update` dipanggil integrator setelah merge.
2. `graphify --mcp` di `.mcp.json` v5 → `query/path/explain` untuk Hermes, Codex, Claude headless.
3. Conductor: ringkasan deterministik ≤ 1,5 kB + `query "<judul tiket>" --budget 600` hanya untuk tiket baru.
4. Kepala/pekerja: paket ≤ 8 kB = tiket + `query --budget 1500` + kriteria lulus; larang `list_directory`/Glob
   di luar daftar; butuh lebih → `query`. Claude ≤ 20 turn; Hermes ≤ 40 langkah.
5. QA: `path "<file>" "<modul>"` untuk cakupan review. 6. Sesi orkestrator: jawab dari `query` + `status.mjs`.
7. Wiki graphify diindeks gbrain sebagai dokumen kanonis ringkas.

## 5. Conductor & proses (pola superpowers + ruflo, headless)

- Tick hanya bila hash (tiket + lock + lanes-status) berubah; routing deterministik dulu (`hooks route`
  ala ruflo: tier 1 = tanpa LLM, tier 2 = flash, tier 3 = GLM-5.2/Claude); LLM hanya untuk tiket tanpa
  departemen, macet, atau Ask. `nudgeHeads` dihapus (heartbeat Paperclip saja).
- System prompt kepala ≤ 1 kB berisi pola superpowers yang relevan (Product: brainstorm→plan; Engineering:
  TDD→verify; QA: review checklist) + aturan caveman untuk output.
- Retry hanya untuk error transien; mentok langkah → kembali ke Conductor untuk dipecah.
- Pemakaian per pool dicatat ke ledger (Claude `usage`, Codex "tokens used", Hermes `--usage-file`,
  Kimi `wire.jsonl`) → Report 19:00 satu baris per pool (Finance/Kuota).

## 6. Urutan kerja

1. `conductor/status.mjs` + `lanes.json` v5.1 (§3) + `.mcp.json` v5.
2. Hermes provider Ollama + fallback; runtime `hermes-cli` di `lanes.mjs`; hapus `runOllama`; uji 1 tiket.
3. RTK terpasang; wrapper untuk Claude headless (`Bash` → `rtk`), Codex, Hermes; ukur `rtk gain`.
4. Graphify 3 repo + `--wiki` + `--mcp` + PM2 watch; `head.mjs`/`run.mjs` memakai `query --budget`.
5. Akun Claude: `ops/claude-machine.cmd` (set `CLAUDE_CONFIG_DIR=D:\aidit-claude-owner` lalu `claude`);
   Bapak login akun #2 di situ sekali (2 menit). Mesin (`~/.claude`, akun #1) dipakai Conductor/QA.
   Harness Claude headless: `--setting-sources ""`, `--max-turns 20`, RTK, paket graphify.
5b. Harness Kimi: `dispatch/kimi-home` v5 (`max_context_size 65536`, tanpa `always_thinking`, hook guard,
   40 langkah, tanpa retry); runtime `kimi-cli` di `lanes.mjs` membaca `wire.jsonl` untuk token; tetap
   `disabled` sampai reset. Harness Codex: `--ephemeral`, `-o` last message, deteksi jam reset dari pesan.
6. Conductor event-driven + rutin GLM; Claude decision ≤ 5/hari; system prompt superpowers-suling.
7. Pencatatan token per pool + Report 19:00.
8. Codex pagu/semaphore/resting; Kimi `kimi-home` v5 (disabled sampai reset; Ask tanggal reset).
9. `CLAUDE.md` v5: aturan sesi orkestrator (Sonnet, ≤ 150 turn, status.mjs, graphify, tidak menulis kode).

## 7. Verifikasi

- 24 jam: Claude Pro #1 cache-read < 40 juta/hari; Pro #2 ≤ 15 panggilan; tidak ada sesi > 150 turn.
- Kepala non-Claude: `lane.run.tried` tanpa `claude-*`; ≥ 3 tiket selesai via Hermes/GLM ≤ 40 langkah.
- `rtk gain` ≥ 50 % pada output tool; paket tugas ≤ 8 kB (`packet_bytes` di ledger).
- Tidak ada `timed out after 120000ms`; 503 → retry; Codex 0 usage-limit pada ≤ 30 tugas.
- Report 19:00 memuat pemakaian per pool; Finance/Kuota membaca `~/.claude/projects` (skrip audit).

Sumber riset: [caveman](https://github.com/JuliusBrussee/caveman), [superpowers](https://github.com/obra/superpowers),
[claude-flow/ruflo](https://github.com/ruvnet/claude-flow), [RTK](https://github.com/rtk-ai/rtk),
[tokenwar tool map](https://github.com/oratelecom/tokenwar), [graphify](https://github.com/Graphify-Labs/graphify),
[FounderOS benchmark internal](../../../AIdit%20OS/vendor/RESEARCH-2026-09-11-FOUNDEROS-BENCHMARK.md).
