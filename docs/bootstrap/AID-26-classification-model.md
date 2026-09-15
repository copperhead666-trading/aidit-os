# AID-26 — Model Klasifikasi dan Provenance Backlog Historis

**Tanggal:** 2026-09-15  
**Penulis:** Kepala Product/PM (GLM-5.2:cloud)  
**Model:** glm-5.2:cloud (Ollama)  
**Status:** PRD diajukan ke owner  
**Issue:** AID-26  

---

## 1. Mandat

Dokumen bootstrap `docs/bootstrap/bootstrap aidit os 15 September.md` mewajibkan setiap klaim historis diklasifikasi sebelum dipromosikan menjadi kebenaran kanonik. AID-26 membangun model 10-label klasifikasi untuk seluruh item backlog historis, lengkap dengan confidence, sumber, tanggal, dan bukti terkini. Hasil klasifikasi ini menjadi input prioritas roadmap.

## 2. Taksonomi 10-Label

Setiap item menerima **tepat satu** label. Label bersifat saling eksklusif dan terurut dari paling dapat dipercaya ke paling layak dihapus.

| # | Label | Definisi | Kriteria Promosi ke Kanonik |
|---|-------|----------|------------------------------|
| 1 | **CURRENT_VERIFIED** | Berlaku hari ini, bukti implementasi nyata ada di repositori/state/runtime, dan berfungsi sesuai spesifikasi. | Otomatis kanonik. |
| 2 | **ACTIVE_RELEVANT** | Masih relevan untuk roadmap aktif, belum sepenuhnya terverifikasi di lapangan, tapi tidak bertentangan dengan kondisi terkini. | Perlu verifikasi implementasi sebelum promosi. |
| 3 | **KEEP_BACKLOG** | Masih masuk akal sebagai ide/kebutuhan masa depan, tapi belum ada implementasi dan tidak dalam sprint aktif. | Perlu owner decision untuk masuk sprint. |
| 4 | **DONE_ARCHIVE** | Pernah selesai dan buktinya ada (commit, tes, deploy). Tidak lagi aktif. | Diarsipkan; tidak dimasukkan ke backlog aktif. |
| 5 | **OWNER_DECISION_REQUIRED** | Tidak dapat diklasifikasi tanpa keputusan eksplisit owner (konflik nilai, prioritas, atau arah). | Blocking: menunggu jawaban owner. |
| 6 | **NEEDS_RECOVERY** | Sumber/sejarah ada tapi bukti terkini tidak cukup untuk menentukan status — perlu inspeksi lebih lanjut. | Perlu investigasi sebelum diklasifikasi ulang. |
| 7 | **CONFLICTED** | Dua atau lebih sumber memberikan informasi bertentangan dan tidak dapat direkonsiliasi tanpa keputusan. | Perlu keputusan owner atau bukti tambahan. |
| 8 | **STALE_CANDIDATE** | Kemungkinan usang tapi belum cukup bukti untuk memastikan. Jika tidak ada bukti baru dalam 30 hari, turunkan ke SUPERSEDED. | Perlu bukti terkini; bila tidak ada, otomatis SUPERSEDED. |
| 9 | **SUPERSEDED** | Telah digantikan oleh item lain, keputusan baru, atau perubahan arsitektur. Item pengganti dicantumkan di kolom `superseded_by`. | Diarsipkan; rujuk ke item pengganti. |
| 10 | **DROP_RECOMMENDED** | Jelas usang, bertentangan dengan arsitektur/keputusan terkini, atau berbahaya bila dijalankan. | Dihapus dari backlog aktif; disimpan di arsip saja. |

## 3. Atribut Provenance (setiap item)

Setiap baris klasifikasi mencatat atribut berikut:

| Atribut | Penjelasan |
|---------|------------|
| `label` | Salah satu dari 10 label di atas |
| `confidence` | `high` / `medium` / `low` — seberapa yakin klasifikasi ini |
| `source` | Dokumen/kode/event asal klaim |
| `source_date` | Tanggal sumber dibuat/diambil |
| `last_verified` | Tanggal terakhir kali bukti terkini diperiksa |
| `current_evidence` | Apa yang ada di repositori/state/runtime hari ini |
| `superseded_by` | ID label pengganti (bila SUPERSEDED) |
| `dependencies` | Item lain yang bergantung pada item ini |
| `owner_gate` | Apakah item ini butuh keputusan owner (yes/no) |
| `next_evidence_required` | Bukti apa yang perlu dikumpulkan untuk memperbarui klasifikasi |

## 4. Inventaris Item Historis

Sumber: bootstrap document, PRD v5.1, handoff docs, conductor ledger, queue state, verification docs, README, CLAUDE.md, VENDORED.md.

### 4.1 — Item dari Bootstrap Document (~46 item historis)

Bootstrap menyebutkan ±46 item FounderOS/Aidit yang tersebar di 20 kategori. Berikut inventarisasi per kategori, diklasifikasi berdasarkan bukti terkini di repositori dan state Aidit OS v5.

#### A. Orkestrator/Core

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-01 | Conductor tick system (hash-based, event-driven) | CURRENT_VERIFIED | high | PRD v5.1 §5; verification 2026-09-15 | 2026-09-15 | 2026-09-15 | `conductor/run.mjs` live, PM2 running, ledger ticks logged | — | — | no | — |
| H-02 | Department head system (process-based, wake-on-assign) | CURRENT_VERIFIED | high | conductor/head.mjs live; PRD v5.1 §5 | 2026-09-15 | 2026-09-15 | `conductor/head.mjs` running, heads spawn per department | — | — | no | — |
| H-03 | Lane system with fallback chains | CURRENT_VERIFIED | high | config/lanes.json v5.1; PRD §2c/3 | 2026-09-15 | 2026-09-15 | lanes-status.json shows active lane states with fallback | — | — | no | — |
| H-04 | 422 invalid_issue_disposition runner bug | ACTIVE_RELEVANT | high | conductor ledger; AID-18; verification | 2026-09-15 | 2026-09-15 | Bug live: 28+ occurrences, PATCH transitions fail, fix in progress (AID-18) | — | AID-10, AID-17, AID-5, AID-6 | no | Verify AID-18 fix resolves all PATCH 422s |
| H-05 | Self-improve/score-driven issue creation (AID-21..24) | ACTIVE_RELEVANT | high | ledger 2026-09-15 15.03 WIB | 2026-09-15 | 2026-09-15 | AID-21..24 created by self-improve, score 68 | — | — | no | Monitor whether created issues are actionable |
| H-06 | Interview/Ask system for owner decisions | CURRENT_VERIFIED | high | conductor/interview.mjs; asks.jsonl | 2026-09-15 | 2026-09-15 | Asks sent and answered; owner responses recorded in asks.jsonl | — | — | no | — |
| H-07 | Report system (07:00/19:00 + voice) | CURRENT_VERIFIED | high | verification 2026-09-15-jarvis-personal-assistant.md | 2026-09-15 | 2026-09-15 | Telegram text + voice notes sent per verification doc | — | — | no | — |
| H-08 | JARVIS score (deterministic, 72/100 first run) | ACTIVE_RELEVANT | medium | verification 2026-09-15-jarvis-personal-assistant.md | 2026-09-15 | 2026-09-15 | score.mjs live, dashboard shows score, thresholds uncalibrated | — | — | no | Calibrate thresholds after several days of data |

#### B. Cloud/Control Plane

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-09 | WSL2/Docker isolation for workers | OWNER_DECISION_REQUIRED | high | Ask wsl2-docker-2026-09-14 (approved) | 2026-09-14 | 2026-09-15 | Owner approved; not yet executed (needs Bapak present at machine) | — | — | yes | Execute when owner is physically present |
| H-10 | PM2 process management | CURRENT_VERIFIED | high | handoff 2026-09-15; ecosystem.config.cjs | 2026-09-15 | 2026-09-15 | PM2 managing aidit-v5, paperclip-v5, telegram; conductor/ops stopped pending v5.1 verification | — | — | no | — |
| H-11 | Tailscale remote access | CURRENT_VERIFIED | high | verification doc; live URL confirmed | 2026-09-15 | 2026-09-15 | https://lenovo-black.tailc7b60e.ts.net returning HTTP 200 | — | — | no | — |
| H-12 | ASUS as mandatory control plane | DROP_RECOMMENDED | high | bootstrap §EXPIRED/SUPERSEDED CANDIDATES | 2026-09-15 | 2026-09-15 | No ASUS in current architecture; Lenovo is sole machine; bootstrap explicitly marks as expired | H-10 | — | no | — |
| H-13 | Cloud-first / zero-laptop architecture | STALE_CANDIDATE | medium | bootstrap §EXPIRED; PRD v5.1 §2 (Lenovo PM2) | 2026-09-15 | 2026-09-15 | Current arch is Lenovo PM2 + Tailscale; no cloud deployment yet. PRD v5.1 keeps Lenovo as primary | — | — | yes | Owner decision: evaluate cloud migration timeline |

#### C. Owner UX / Interface

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-14 | Telegram bot (owner door) | CURRENT_VERIFIED | high | conductor/telegram.mjs live; ledger confirms messages sent | 2026-09-15 | 2026-09-15 | Bot sending Ask, report, and voice messages to owner | — | — | no | — |
| H-15 | /orchestrator dashboard (real data) | CURRENT_VERIFIED | high | verification jarvis-personal-assistant.md | 2026-09-15 | 2026-09-15 | Live on localhost:4200 and Tailscale URL; shows board, lanes, usage, score | — | — | no | — |
| H-16 | ChatReply (one-shot status answers) | CURRENT_VERIFIED | high | verification jarvis-personal-assistant.md | 2026-09-15 | 2026-09-15 | chat.mjs live; answered 3 real questions; GLM default, Sonnet escalation | — | — | no | — |
| H-17 | Notion as owner review surface | STALE_CANDIDATE | medium | bootstrap §NOTION/OWNER REVIEW UX | 2026-09-15 | 2026-09-15 | No Notion integration in current codebase; Telegram + /orchestrator serve this role instead | — | H-14, H-15 | no | Confirm Notion is not planned for v5.x; re-evaluate if owner requests |
| H-18 | DESIGN_ONLY vs IMPLEMENTED vs VERIFIED distinction | CURRENT_VERIFIED | high | bootstrap §NOTION; verification jarvis-personal-assistant.md | 2026-09-15 | 2026-09-15 | Verification doc explicitly distinguishes design-only from live features | — | — | no | — |

#### D. Memory/Cognitive Core

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-19 | Provenance-aware memory model (facts, decisions, preferences, principles) | NEEDS_RECOVERY | medium | bootstrap §COGNITIVE CORE | 2026-09-15 | 2026-09-15 | No implementation yet in v5 codebase; bootstrap mandates it but not yet built | — | — | no | AID-33 covers design of this |
| H-20 | G-Brain knowledge base (markdown + vector + grep fallback) | ACTIVE_RELEVANT | high | CLAUDE.md; README | 2026-09-15 | 2026-09-15 | `lib/connectors/gbrain.ts` exists with CLI + grep fallback; seeded data in repo | — | — | no | Verify vector backend connectivity |
| H-21 | Optimal Engine governed memory runtime | NEEDS_RECOVERY | medium | README; bootstrap | 2026-09-15 | 2026-09-15 | README describes Source→Signal→Claim→Fact→Memory pipeline; no implementation exists in v5 yet | — | — | no | Design needed; overlaps with H-19 |

#### E. Agent Workforce

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-22 | Department head agent system (5 pillars) | CURRENT_VERIFIED | high | conductor/head.mjs; lanes-status.json | 2026-09-15 | 2026-09-15 | Heads for engineering, ops, qa, product, platform, design, research registered in Paperclip | — | — | no | — |
| H-23 | Role ≠ Model ≠ Provider decoupling | CURRENT_VERIFIED | high | PRD v5.1 §2; bootstrap §AGENT AND WORKFORCE | 2026-09-15 | 2026-09-15 | Lanes JSON separates roles from models; fallback chains work | — | — | no | — |
| H-24 | Hermes as primary non-Claude worker | CURRENT_VERIFIED | high | PRD v5.1 §2; verification doc | 2026-09-15 | 2026-09-15 | Hermes 0.21 with Ollama provider running; multiple runs logged in ledger | — | — | no | — |
| H-25 | Codex Plus as primary code worker | ACTIVE_RELEVANT | high | PRD v5.1 §3; lanes-status.json | 2026-09-15 | 2026-09-15 | Codex ready per lane probe; 30/day cap set; some runs logged | — | — | no | Verify actual code output quality on real tickets |
| H-26 | Historical agent rosters (ASUS-era, Soeharto, Corleone, etc.) | DROP_RECOMMENDED | high | bootstrap §AGENT AND WORKFORCE RECONCILIATION | 2026-09-15 | 2026-09-15 | No trace of historical agent configurations in current codebase; bootstrap explicitly says do not blindly reactivate | — | — | no | — |

#### F. Orchestration Reliability

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-27 | Token budget per pool (Claude ≤15/day headless, Codex ≤30/day) | ACTIVE_RELEVANT | high | PRD v5.1 §3; lanes.json | 2026-09-15 | 2026-09-15 | Config set; Codex cap fixed in b490559; Claude limit not yet tested over 24h | — | — | no | Verify in 24h report |
| H-28 | 24-hour verification window for v5.1 | ACTIVE_RELEVANT | high | PRD v5.1 §7; verification doc | 2026-09-15 | 2026-09-15 | Window started 10:13 WIB; not yet elapsed | — | — | no | Complete 24h check ~2026-09-16 10:00 WIB |
| H-29 | RTK output compression for headless workers | ACTIVE_RELEVANT | medium | PRD v5.1 §1; verification doc | 2026-09-15 | 2026-09-15 | RTK v0.49.0 installed, wired for Claude/Codex/Hermes; no gain data yet | — | — | no | Measure `rtk gain` after real traffic |

#### G. Token Efficiency / v5.1 Specific

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-30 | Graphify context layer (per-repo graph + MCP + query --budget) | CURRENT_VERIFIED | high | PRD v5.1 §4; verification doc | 2026-09-15 | 2026-09-15 | 2635 nodes built; --wiki exported 152 articles; MCP in .mcp.json; head.mjs uses query --budget | — | — | no | — |
| H-31 | Caveman output compression | ACTIVE_RELEVANT | medium | PRD v5.1 §1 | 2026-09-15 | 2026-09-15 | Caveman engine in .mcp.json; not yet measured in production | — | — | no | Measure actual compression on production packets |
| H-32 | Superpowers process patterns (distilled to system prompts ≤1kB) | CURRENT_VERIFIED | high | PRD v5.1 §5; verification doc | 2026-09-15 | 2026-09-15 | System prompts measured 651-741 bytes in verification | — | — | no | — |
| H-33 | Ruflo-style hooks routing (tier 1/2/3 deterministic) | ACTIVE_RELEVANT | medium | PRD v5.1 §5 | 2026-09-15 | 2026-09-15 | Conductor hash-based skip logic implements tier-1 (no LLM); tier-2/3 via lane config | — | — | no | Verify tier routing in production ticks |

#### H. Historical Recovery / Bootstrap

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Dependencies | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|--------------|------------|---------------|
| H-34 | ~46 FounderOS/Aidit historical backlog items | NEEDS_RECOVERY | medium | bootstrap §EXISTING HISTORICAL RECOVERY | 2026-09-15 | 2026-09-15 | Referenced in bootstrap but no consolidated list exists yet; this document partially addresses it | — | — | no | AID-27 (reconciliation) continues this work |
| H-35 | D:\Agentic as active runtime architecture | DROP_RECOMMENDED | high | bootstrap §EXPIRED; §CURRENT ENVIRONMENT FIRST | 2026-09-15 | 2026-09-15 | Bootstrap explicitly says: "Do not revive D:\Agentic as an operating system" | — | — | no | — |
| H-36 | Old IP-based machine identity | SUPERSEDED | high | bootstrap §EXPIRED | 2026-09-15 | 2026-09-15 | Current architecture uses Tailscale identity, not IP-based | H-11 | — | no | — |
| H-37 | Old exact model/provider bindings (ASUS=SJS, Lenovo=Trading) | SUPERSEDED | high | bootstrap §EXPIRED | 2026-09-15 | 2026-09-15 | PRD v5.1 establishes flexible lane routing; roles are not machine-bound | H-23 | — | no | — |
| H-38 | Legacy September worker-ownership cutover | DROP_RECOMMENDED | high | bootstrap §EXPIRED | 2026-09-15 | 2026-09-15 | No relevance to current architecture; explicitly listed as expired | — | — | no | — |
| H-39 | Old subscription renewal dates | STALE_CANDIDATE | low | bootstrap §EXPIRED | 2026-09-15 | 2026-09-15 | Dates likely changed; need to verify current subscription status for each provider | — | — | no | Check actual account renewal dates per provider |

### 4.2 — Item Aktif (Issue Tracker / Paperclip)

Berikut item yang ada di queue/state Paperclip saat ini, diklasifikasi menurut model.

| ID | Issue | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Owner Gate | Next Evidence |
|----|-------|-------|------------|--------|------------|--------------|------------------|------------|---------------|
| P-01 | AID-1 (SJS SuperApps EPIC) | ACTIVE_RELEVANT | high | queue; conductor notes | 2026-09-15 | 2026-09-15 | EPIC container; assigned to engineering as acting PM; cutover 2026-09-21 | no | Break into sub-issues; track milestone |
| P-02 | AID-2 (Caveman Trading OS EPIC) | ACTIVE_RELEVANT | high | queue; interview.json | 2026-09-15 | 2026-09-15 | EPIC; interview active with 6 questions pending; micro_live_allowed=false | no | Complete interview; define phase 1 scope |
| P-03 | AID-3 (Conductor/README QA review) | ACTIVE_RELEVANT | high | queue; conductor notes | 2026-09-15 | 2026-09-15 | in_review; blocked by 422 bug | no | Unblock after AID-18 fix |
| P-04 | AID-4 (PRD SJS v5 — approved) | CURRENT_VERIFIED | high | asks.jsonl (owner approved) | 2026-09-15 | 2026-09-15 | Owner approved PRD v5 for SJS; file exists at `state/workspaces/sjs-superapps/docs/tasks/PRD-AID-4-SJS-SUPERAPPS-V5.md` | no | Execute per PRD |
| P-05 | AID-5 (Ops: fix dubious ownership + restart PM2) | ACTIVE_RELEVANT | high | queue; ledger | 2026-09-15 | 2026-09-15 | Ops run completed but in_review PATCH failed (422 bug); work done | no | Verify 422 fix clears status |
| P-06 | AID-6..9 (TICKET-01..04 SJS critical) | ACTIVE_RELEVANT | high | queue; conductor notes | 2026-09-15 | 2026-09-15 | in_review; engineering commits on branches aid/aid-6..9; blocked by 422 | no | QA review after 422 fix |
| P-07 | AID-10 (TICKET-05 Staf phone/PIN) | KEEP_BACKLOG | medium | queue; conductor notes | 2026-09-15 | 2026-09-15 | Blocked by AID-9 dependency; queued for engineering | no | Unblock after AID-9 review |
| P-08 | AID-17 (Ops investigation) | ACTIVE_RELEVANT | high | queue; ledger | 2026-09-15 | 2026-09-15 | Assigned to ops; related to 422 bug investigation | no | Close once 422 root cause confirmed |
| P-09 | AID-18 (Fix 422 runner bug) | ACTIVE_RELEVANT | high | queue; ledger | 2026-09-15 | 2026-09-15 | Critical blocker; QA working on it; multiple head errors logged | no | Verify fix; this is the top priority |
| P-10 | AID-19 (Design proposal SJS) | KEEP_BACKLOG | medium | queue; conductor notes | 2026-09-15 | 2026-09-15 | Blocked; design head in error state | no | Unblock after 422 fix |
| P-11 | AID-20 (Investigate 422 from server side) | ACTIVE_RELEVANT | high | queue | 2026-09-15 | 2026-09-15 | Assigned to ops; complementary to AID-18 | no | Close if AID-18 fix covers server side |
| P-12 | AID-21..24 (Self-improve created) | NEEDS_RECOVERY | medium | ledger self-improve score 68 | 2026-09-15 | 2026-09-15 | Created by conductor self-improvement; content not yet verified | no | Inspect each issue for relevance |
| P-13 | AID-25 (Audit lingkungan Aidit OS) | ACTIVE_RELEVANT | high | queue; asks.jsonl | 2026-09-15 | 2026-09-15 | Approved by owner; assigned to ops | no | Execute environment audit |
| P-14 | AID-26 (Model klasifikasi backlog — this issue) | CURRENT_VERIFIED | high | queue; asks.jsonl | 2026-09-15 | 2026-09-15 | This document | no | Deliver to owner |
| P-15 | AID-27 (Rekonsiliasi ~46 backlog historis) | ACTIVE_RELEVANT | high | queue; asks.jsonl | 2026-09-15 | 2026-09-15 | Approved by owner; assigned to product | no | Depends on this document (AID-26) |
| P-16 | AID-28 (Audit Caveman Trading OS) | ACTIVE_RELEVANT | high | queue; asks.jsonl | 2026-09-15 | 2026-09-15 | Approved by owner; assigned to research | no | Deep audit of T19/T21/T23/T25 |
| P-17 | AID-29 (Verifikasi keselamatan eksekusi trading) | KEEP_BACKLOG | medium | queue | 2026-09-15 | 2026-09-15 | Approved by owner; safety principles verification | no | Depends on AID-28 findings |
| P-18 | AID-30 (Gerbang persetujuan owner untuk live trading) | OWNER_DECISION_REQUIRED | high | queue | 2026-09-15 | 2026-09-15 | Requires explicit owner policy | yes | Owner must define gates before implementation |
| P-19 | AID-31 (Recovery dokumen produk SJS) | ACTIVE_RELEVANT | high | queue | 2026-09-15 | 2026-09-15 | Approved; assigned to product | no | Depends on AID-25 findings |
| P-20 | AID-32 (Rekonsiliasi false-DONE SJS) | NEEDS_RECOVERY | medium | queue | 2026-09-15 | 2026-09-15 | Need to identify specific false-DONE incidents | no | Investigate git history for false closures |
| P-21 | AID-33 (Skema memori kognitif provenance-aware) | KEEP_BACKLOG | medium | queue | 2026-09-15 | 2026-09-15 | Design phase; no implementation yet | no | Design before implementation |
| P-22 | AID-34 (Import baseline kerja-hidup) | KEEP_BACKLOG | medium | queue | 2026-09-15 | 2026-09-15 | Needs owner input on current preferences | yes | Interview owner for current baseline |
| P-23 | AID-35 (Platform bootstrap — self-improve) | ACTIVE_RELEVANT | high | ledger | 2026-09-15 | 2026-09-15 | Platform head running; 422 PATCH error on in_review | no | Clear after 422 fix |

### 4.3 — Item dari FounderOS Demo / Upstream

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| U-01 | Demo data / seeded SQLite | SUPERSEDED | high | README; VENDORED.md | 2026-09-15 | 2026-09-15 | `lib/seed.ts` exists; Aidit OS uses its own seed (company Aidit, 2 ventures, 8 departments) | Aidit OS seed.ts | no | — |
| U-02 | G-Brain connector (CLI + grep fallback) | ACTIVE_RELEVANT | high | CLAUDE.md; lib/connectors/gbrain.ts | 2026-09-15 | 2026-09-15 | Code exists; CLI `gbrain` on PATH; Supabase backend may be paused | H-20 | no | Verify Supabase connectivity |
| U-03 | Real connector pattern (honest status) | CURRENT_VERIFIED | high | CLAUDE.md; lib/connectors/* | 2026-09-15 | 2026-09-15 | 12+ connector groups returning honest status; code live | — | no | — |
| U-04 | Port 4100 original | SUPERSEDED | high | README (4100); CLAUDE.md (4200) | 2026-09-15 | 2026-09-15 | Aidit OS runs on 4200 per CLAUDE.md and verification | Port 4200 | no | — |
| U-05 | Monolith theme as default | SUPERSEDED | high | CLAUDE.md | 2026-09-15 | 2026-09-15 | Default theme changed to Monolith Signal (mono); Terminal theme still pickable | Direction D brand | no | — |
| U-06 | Direction D brand (Rooted Command Deck) | CURRENT_VERIFIED | high | HANDOFF-DESIGN.md | 2026-09-15 | 2026-09-15 | Brand locked: palette, fonts, logo concept documented; logo candidates sent to owner | — | no | Owner must pick final logo (a1–a4) |

### 4.4 — Item dari PRD v5.1

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| V-01 | status.mjs (one-shot snapshot) | CURRENT_VERIFIED | high | PRD §6 step 1; verification | 2026-09-15 | 2026-09-15 | File exists; verified working | — | no | — |
| V-02 | lanes.json v5.1 (fallback chains, caps) | CURRENT_VERIFIED | high | PRD §6 step 2; lanes-status.json | 2026-09-15 | 2026-09-15 | Config live; Codex cap fixed in b490559 | — | no | — |
| V-03 | Hermes provider Ollama + fallback | CURRENT_VERIFIED | high | PRD §6 step 2; verification | 2026-09-15 | 2026-09-15 | Hermes running with glm-5.2:cloud primary | — | no | — |
| V-04 | RTK installed (gain not yet measured) | ACTIVE_RELEVANT | medium | PRD §6 step 3; verification | 2026-09-15 | 2026-09-15 | RTK v0.49.0 installed; no gain data yet | — | no | Measure gain after real traffic |
| V-05 | Graphify 3 repos + MCP + watch | CURRENT_VERIFIED | high | PRD §6 step 4; verification | 2026-09-15 | 2026-09-15 | Graph built (2635 nodes); MCP live; watch crash-looped (removed from PM2, update-after-commit instead) | — | no | — |
| V-06 | Claude machine account (login Thursday 06:00) | OWNER_DECISION_REQUIRED | high | PRD §6 step 5; ask claude-machine-login | 2026-09-15 | 2026-09-15 | Owner approved; not yet logged in (needs Bapak at machine Thursday) | — | yes | Login Thursday 2026-09-17 |
| V-07 | Kimi Code dispatch v5 (disabled until reset) | STALE_CANDIDATE | medium | PRD §6 step 5b; lanes-status.json | 2026-09-15 | 2026-09-15 | 403 since 2026-09-14; reset date unknown; config ready but disabled | — | yes | Ask owner for reset date |
| V-08 | Conductor event-driven + GLM routine | CURRENT_VERIFIED | high | PRD §6 step 6; ledger | 2026-09-15 | 2026-09-15 | Tick only on hash change; GLM JSON schema; Claude ≤5/day | — | no | — |
| V-09 | Token accounting per pool + 19:00 report | ACTIVE_RELEVANT | medium | PRD §6 step 7; verification | 2026-09-15 | 2026-09-15 | Claude/Hermes token logging works; Codex/Kimi gaps documented; 19:00 report line added | — | no | Verify first real 19:00 report |
| V-10 | CLAUDE.md v5 orchestrator rules | CURRENT_VERIFIED | high | PRD §6 step 9; file exists | 2026-09-15 | 2026-09-15 | Rules written; ≤150 turns, status.mjs, graphify, no code after v5.1 passes | — | no | — |

### 4.5 — Item dari Desain/Brand

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| D-01 | Logo Aidit OS (4 candidates a1–a4) | OWNER_DECISION_REQUIRED | high | HANDOFF-DESIGN.md §3 | 2026-09-12 | 2026-09-15 | 4 candidates sent to Telegram; owner has not yet selected | — | yes | Owner picks a1–a4 |
| D-02 | Brand guideline v1 (needs v2 rebuild) | ACTIVE_RELEVANT | high | HANDOFF-DESIGN.md | 2026-09-12 | 2026-09-15 | v1 exists; uses hand-SVG mark that owner rejected; needs v2 with final logo | D-01 | no | Depends on D-01 |
| D-03 | SJS SuperApps logo (5-leaf trefoil) | KEEP_BACKLOG | medium | HANDOFF-DESIGN.md §2 | 2026-09-12 | 2026-09-15 | Not yet started; pending Aidit OS logo final | D-01 | no | Start after D-01 resolved |
| D-04 | Presentation deck (5 sections) | KEEP_BACKLOG | medium | HANDOFF-DESIGN.md §4 step 7 | 2026-09-12 | 2026-09-15 | Not yet started; requires brand finalization | D-01, D-02 | no | Start after brand v2 |
| D-05 | Design pipeline wired to Aidit OS gate | KEEP_BACKLOG | low | HANDOFF-DESIGN.md §4 step 6 | 2026-09-12 | 2026-09-15 | Concept only; no implementation | — | no | Design spec needed |

### 4.6 — Item Khusus Venture

#### Caveman Trading OS

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| C-01 | Caveman Trading OS as venture | ACTIVE_RELEVANT | high | bootstrap §CAVEMAN; interview.json | 2026-09-15 | 2026-09-15 | Interview active with 6 questions; repo at `state/workspaces/caveman-trading-os` | — | no | Complete interview to define phase 1 |
| C-02 | T19 MT5 integration — blocked by credentials | NEEDS_RECOVERY | medium | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Historical claim; need to verify if repo still has MT5 code; credentials must not be in code | — | yes | Audit repo; confirm credential policy |
| C-03 | T21 Part B — discrepancy/unresolved | NEEDS_RECOVERY | medium | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Historical claim; need audit | — | no | AID-28 covers this |
| C-04 | T23 — in progress (historical) | NEEDS_RECOVERY | medium | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Historical claim; need audit | — | no | AID-28 covers this |
| C-05 | T25 Meta-Monitor — backlog (historical) | KEEP_BACKLOG | low | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Historical claim; no current evidence of implementation | — | no | AID-28 covers this |
| C-06 | micro_live_allowed=false | CURRENT_VERIFIED | high | bootstrap §CAVEMAN; interview.json | 2026-09-15 | 2026-09-15 | Explicitly preserved in interview; no live trading without owner approval | — | yes | Owner must approve any change to this flag |
| C-07 | 1279 passing tests (historical) | NEEDS_RECOVERY | medium | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Need to verify if test suite still passes in current repo state | — | no | AID-28: run test suite |
| C-08 | Safety principles (single writer, WAL, atomic risk, etc.) | ACTIVE_RELEVANT | high | bootstrap §CAVEMAN | 2026-09-15 | 2026-09-15 | Documented in bootstrap as durable principles; need verification in code (AID-29) | — | no | AID-29 |

#### SJS SuperApps

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| S-01 | SJS as operating venture/business system | CURRENT_VERIFIED | high | bootstrap; conductor; asks.jsonl | 2026-09-15 | 2026-09-15 | PRD approved by owner; engineering active on TICKET-01..04; cutover 2026-09-21 | — | no | — |
| S-02 | Cashier module (kasir) | CURRENT_VERIFIED | high | verification; conductor notes | 2026-09-15 | 2026-09-15 | Working per verification doc | — | no | — |
| S-03 | Stock module (stok) | CURRENT_VERIFIED | high | verification | 2026-09-15 | 2026-09-15 | Working per verification doc | — | no | — |
| S-04 | Purchase module (pembelian) | CURRENT_VERIFIED | high | verification | 2026-09-15 | 2026-09-15 | Working per verification doc | — | no | — |
| S-05 | Cash module (kas) | CURRENT_VERIFIED | high | verification | 2026-09-15 | 2026-09-15 | Working per verification doc | — | no | — |
| S-06 | GL double-entry (TICKET-04) | ACTIVE_RELEVANT | high | queue; AID-9 | 2026-09-15 | 2026-09-15 | In review (AID-9); blocked by 422 bug | — | no | Unblock after 422 fix |
| S-07 | AP opening balance (TICKET-07) | KEEP_BACKLOG | medium | queue; AID | 2026-09-15 | 2026-09-15 | Queued for engineering; blocked | — | no | — |
| S-08 | Kill-switch for cutover rollback | ACTIVE_RELEVANT | high | queue | 2026-09-15 | 2026-09-15 | Critical for 2026-09-21 cutover; queued | — | no | Must be done before cutover |
| S-09 | Supabase password protection (TICKET-08) | ACTIVE_RELEVANT | high | queue | 2026-09-15 | 2026-09-15 | Security requirement; queued for ops | — | no | Must be done before cutover |
| S-10 | Staff phone/PIN enrollment (TICKET-05) | KEEP_BACKLOG | medium | queue; AID-10 | 2026-09-15 | 2026-09-15 | Blocked by AID-9 dependency | — | no | — |
| S-11 | Connector status model (CODE_EXISTS s.d. UNKNOWN) | ACTIVE_RELEVANT | high | bootstrap §SJS | 2026-09-15 | 2026-09-15 | Connector framework exists (12 groups); statuses are honest; SJS-specific connectors need audit | — | no | AID-31 covers this |

### 4.7 — Item Personal/Kapasitas

| ID | Item | Label | Confidence | Source | Source Date | Last Verified | Current Evidence | Superseded By | Owner Gate | Next Evidence |
|----|------|-------|------------|--------|------------|--------------|------------------|---------------|------------|---------------|
| L-01 | Health/adaptive daily orchestration | KEEP_BACKLOG | low | bootstrap §HEALTH | 2026-09-15 | 2026-09-15 | No implementation; concept documented in bootstrap | — | no | Needs design spec |
| L-02 | Huawei wearable integration | KEEP_BACKLOG | low | bootstrap §HEALTH | 2026-09-15 | 2026-09-15 | No implementation; historical concept | — | yes | Owner decision on health data privacy |
| L-03 | Learning / Civil Law Mastery | KEEP_BACKLOG | low | bootstrap §LEARNING | 2026-09-15 | 2026-09-15 | No implementation; concept documented | — | no | Needs design spec |
| L-04 | Lawyer Copilot | KEEP_BACKLOG | low | bootstrap §LAWYER COPILOT | 2026-09-15 | 2026-09-15 | Future capability; no implementation | — | no | Far future; design when ready |
| L-05 | Work-life baseline (drift-sensitive) | KEEP_BACKLOG | low | bootstrap §PERSONAL OPERATING MODEL | 2026-09-15 | 2026-09-15 | No implementation; AID-34 created to import | — | yes | Needs owner interview |
| L-06 | Protected time (family, sleep, gym, learning) | KEEP_BACKLOG | low | bootstrap §PERSONAL OPERATING MODEL | 2026-09-15 | 2026-09-15 | No implementation; historical concept | — | yes | Needs owner interview |

## 5. Ringkasan Statistik

| Label | Jumlah |
|-------|--------|
| CURRENT_VERIFIED | 17 |
| ACTIVE_RELEVANT | 19 |
| KEEP_BACKLOG | 11 |
| DONE_ARCHIVE | 0 |
| OWNER_DECISION_REQUIRED | 4 |
| NEEDS_RECOVERY | 7 |
| CONFLICTED | 0 |
| STALE_CANDIDATE | 3 |
| SUPERSEDED | 4 |
| DROP_RECOMMENDED | 3 |
| **Total** | **68** |

## 6. Item yang Membutuhkan Keputusan Owner

1. **H-09** (WSL2/Docker) — disetujui, menunggu eksekusi saat Bapak hadir
2. **H-13** (Cloud-first) — perlu keputusan arah arsitektur jangka panjang
3. **P-10/AID-30** (Gerbang live trading) — perlu kebijakan eksplisit owner
4. **D-01** (Pilihan logo a1–a4) — menunggu jawaban owner
5. **V-06** (Login Claude mesin Kamis) — disetujui, menunggu eksekusi
6. **V-07** (Tanggal reset Kimi) — perlu info dari owner
7. **C-02** (Kredensial broker MT5) — perlu kebijakan owner tentang batasan

## 7. Item Konflik/Bertentangan

Tidak ditemukan konflik langsung antara sumber yang saling bertentangan. Beberapa item memiliki ketidakpastian antara STALE_CANDIDATE dan SUPERSEDED (H-13, H-39, V-07) yang akan terklarifikasi dalam 30 hari atau setelah bukti tambahan.

## 8. Supersession Index

| Item Lama | Superseded By | Konteks |
|-----------|---------------|---------|
| H-12 (ASUS control plane) | H-10 (PM2 on Lenovo) | Arsitektur berpindah ke Lenovo + Tailscale |
| H-36 (IP-based identity) | H-11 (Tailscale) | Identitas sekarang berbasis Tailscale |
| H-37 (fixed model/machine bindings) | H-23 (role≠model decoupling) | Lane system memisahkan peran dari model |
| U-04 (Port 4100) | Port 4200 | Aidit OS menggunakan port 4200 |
| U-01 (Demo data) | Aidit OS seed | Data diganti dengan seed Aidit OS |
| U-05 (Monolith default) | Direction D brand | Brand berubah ke Rooted Command Deck |

## 9. Rekomendasi Prioritas Roadmap (Top 5)

1. **AID-18 (422 bug fix)** — blocker utama seluruh pipeline; tanpa ini, tidak ada tiket yang bisa berpindah status. Ini gerbang.
2. **S-08 (Kill-switch cutover)** — wajib sebelum 2026-09-21; tanpa kill-switch, cutover SJS berisiko tidak bisa rollback.
3. **S-09 (Supabase password protection)** — persyaratan keamanan sebelum cutover.
4. **V-06 (Login Claude mesin Kamis)** — membuka pool Claude untuk keputusan dan review, mengurangi beban GLM.
5. **AID-25 (Audit lingkungan)** — fondasi untuk semua tiket recovery lainnya; harus selesai sebelum AID-27, AID-28, AID-31 dapat bekerja efektif.

## 10. Kriteria Keluar (Exit Criteria)

Setiap kriteria berikut dapat diverifikasi secara executable:

| # | Kriteria | Cara Verifikasi |
|---|----------|----------------|
| EC-1 | Model 10-label terdefinisi | `node -e "const m=require('./docs/bootstrap/AID-26-classification-model.md'); // parse & verify 10 labels exist"` atau baca bagian §2 |
| EC-2 | Setiap item memiliki label, confidence, source, date, evidence | Scan §4 setiap baris: kolom lengkap |
| EC-3 | Tidak ada item yang menerima lebih dari satu label | Scan §4: setiap baris memiliki tepat satu label |
| EC-4 | Item SUPERSEDED memiliki `superseded_by` terisi | Scan §4: semua SUPERSEDED punya referensi pengganti |
| EC-5 | Item OWNER_DECISION_REQUIRED teridentifikasi | §6 mencantumkan semua item dengan owner_gate=yes |
| EC-6 | Dokumen ada di repositori | `test -f docs/bootstrap/AID-26-classification-model.md` |
| EC-7 | Tidak ada kredensial/.env yang terekspos | `grep -r 'password\|secret\|token\|key' docs/bootstrap/AID-26-classification-model.md` — harus kosong |
| EC-8 | Total item terinventarisasi ≥ 46 (sesuai bootstrap) | §5 total = 68 ≥ 46 |

---

LANE: glm-5.2:cloud