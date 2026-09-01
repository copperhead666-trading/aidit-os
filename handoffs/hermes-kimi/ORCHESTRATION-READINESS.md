# ORCHESTRATION READINESS — Active FounderOS-Aidit

Compiled 2026-08-28 by HERMES (Kimi K3 worker lane), read-only survey.
All paths absolute. Status labels: VERIFIED / STALE / UNKNOWN.

---

## 1. DONE (VERIFIED)

- **AHMAD identity + orchestration contract** — exists and current.
  `D:\AI\Active FounderOS-Aidit\config\agent-registry.json` (AHMAD block,
  `last_verified_at: 2026-08-28`). Declarative-only boundary explicitly written
  in `canonical_boundary_note` of that same file.
- **HATTA created, runtime bound, verified live (2026-08-28).**
  - Role spec: `D:\AI\Active FounderOS-Aidit\hatta\ROLE.md`
  - Harness: `D:\AI\Active FounderOS-Aidit\hatta\harness.mjs`
    (built by Codex as bootstrap, reviewed by Ahmad; selftest 4/4; live
    glm-5.2:cloud end-to-end run wrote `hatta\proof-of-life.md`; endpoint
    guard refuses non-localhost OLLAMA_HOST).
  - Docs: `D:\AI\Active FounderOS-Aidit\hatta\HARNESS.md`
  - Quota independence from Ahmad's Anthropic quota proven 3 ways (binary PID,
    auth artifact, live netstat) — see agent-registry.json
    `agents.HATTA.quota_independence_evidence`.
- **Owner decision ledger canonicalized** (15 canonical records:
  D3,D10,D11,D12,D13,D14,D16,D17,D18,D20,D24,D25,D26,D27,D28).
  `D:\AI\Active FounderOS-Aidit\config\decision-ledger.json`, canonicalized
  2026-08-28, authorized by Aidit. Non-canonical records left at source
  `D:\AI\Agentic\owner\aidit-decision-ledger.json` (not modified).
- **GBrain real and verified end-to-end.**
  `D:\AI\Active FounderOS-Aidit\knowledge\GBRAIN.md` + store at
  `knowledge\store\.gbrain\brain.pglite`. gbrain 0.47.3.0 (garrytan/gbrain via
  bun), local Ollama `nomic-embed-text`, no API keys, reranker disabled.
  Real semantic search verified 2-note test.
- **Paperclip local instance RUNNING today** (not just planned).
  `.paperclip\run-stdout.log`: server on `http://127.0.0.1:3102` (requested
  3100, took 3102), external-postgres mode, DB
  `postgres://paperclip_founderos_aidit@127.0.0.1:5433/...`, migrations
  applied, auth ready, heartbeat on, backups every 60m keep 30d.
  Config: `.paperclip\instances\default\config.json`.
- **Graphify outputs exist** for both trees:
  active: `graphify-out\active\graphify-out\` (.graphify_ast.json,
  .graphify_semantic.json, chunks); legacy:
  `graphify-out\legacy\graphify-out\` (10 chunks). Already used once to catch
  GBRAIN.md documentation drift.
- **Legacy worker inventory mapped.** New-app dispatch registry
  `D:\FounderOS-Aidit De Maestros\app\lib\dispatch\registry.ts` (8 workers:
  soeharto, soedirman, hatta, corleone, gibran, soekarno, thomas +
  venture-roles.ts with 2026-08-25 assignment: GLM-5.2 Kepala Project for both
  ventures; GLM-5.1/Kimi/Hermes staff; soeharto/soekarno/corleone resting).

## 2. INCOMPLETE

- **Paperclip NOT yet used as operational store.** Server runs but no
  agent/task/heartbeat state has been migrated or written to it (log shows
  `reaped:0`, plugins 0). The `canonical_boundary_note` says operational state
  lives in Paperclip "once that migration lands" — it has not landed.
  Owner decision required before cutover (see PAPERCLIP-MIGRATION-MAP.md).
- **No independent reviewer for HATTA's material changes.**
  Explicit gap in registry (`review_note`) and ROLE.md. Today HATTA output is
  unreviewed.
- **AHMAD runtime swap story pending.** Ahmad is runtime-swappable by
  decision; current session runs on Hermes/Kimi K3. No runtime-switch runbook
  or acceptance test for a swap yet.
- **GBrain store content thin** — only 2 notes
  (`aidit-project-overview.md`, `founderos-gbrain-local-setup.md`). Decision
  ledger, task packets, role specs not yet ingested.
- **Old-plane agent-registry (D:\AI\Agentic) STALE** — last_updated 2026-08-22,
  references retired SOEHARTO as "principal builder". Must not be read as
  current roster without the retired_reference_only override in the new
  registry.
- **Telegram/control channels**: D:\AI\Agentic project-registry has AHMAD
  status `WEB_LIVE_TELEGRAM_PENDING_OWNER_ACTION` (STALE, from old plane;
  confirm whether carried forward).

## 3. RUNTIME / CAPACITY LANES (as of 2026-08-28)

| Lane | Agent(s) | Runtime | Quota pool | State |
|---|---|---|---|---|
| Orchestrator | AHMAD | Claude Code CLI (swap-capable; this session: Hermes/Kimi K3) | Anthropic subscription (pusatberasmurah) | ACTIVE |
| Primary executor | HATTA | Ollama Cloud glm-5.2:cloud via local daemon :11434 (alts: kimi-k2.7-code, glm-5.1, gpt-oss:20b) | Ollama Cloud Pro (separate, 3-concurrent-model cap known from legacy notes) | ACTIVE, VERIFIED |
| Worker lane | HERMES / Kimi K3 (this agent) | Hermes CLI | per-subscription | ACTIVE (doing this pack) |
| Independent reviewer | (unassigned — candidate SOEKARNO) | Claude Code CLI on lenovo-trading via SSH transport | separate Claude Pro, SCARCE — preserve | DORMANT |
| Resting | CORLEONE (Codex, Lenovo), legacy SOEHARTO patterns | — | — | RESTING, do not activate |

Fixed-subscription policy: no PAYG fallback anywhere. USD 60–70/month hard
ceiling across all lanes.

## 4. BLOCKERS

1. Paperclip operational cutover not authorized (OWNER DECISION gate).
2. No reviewer lane for HATTA (org design gap, not owner-level; see proposal).
3. Ahmad runtime-swap acceptance criteria undefined (agent-level design task).
4. GBrain ingestion scope/schedule undefined (agent-level task).
5. Lenovo machine availability intermittent (Soekarno review capacity scarce).

## 5. EVIDENCE INDEX

- Roster/identity: `D:\AI\Active FounderOS-Aidit\config\agent-registry.json`
- Owner truth: `D:\AI\Active FounderOS-Aidit\config\decision-ledger.json`
  (+ source `D:\AI\Agentic\owner\`)
- HATTA: `hatta\ROLE.md`, `hatta\HARNESS.md`, `hatta\harness.mjs`,
  `hatta\proof-of-life.md`
- GBrain: `knowledge\GBRAIN.md`, `knowledge\store\`
- Paperclip runtime proof: `.paperclip\run-stdout.log`,
  `.paperclip\instances\default\config.json`
- Graphify: `graphify-out\active\`, `graphify-out\legacy\`
- Legacy worker map: `D:\FounderOS-Aidit De Maestros\app\lib\dispatch\`
  (registry.ts, venture-roles.ts — read-only reference)
- Old plane (STALE, reference): `D:\AI\Agentic\config\`, `D:\AI\Agentic\tasks\`,
  `D:\AI\Agentic\scripts\` (dispatch-worker.js, probe-worker.js,
  lenovo-transport-adapter.js)
