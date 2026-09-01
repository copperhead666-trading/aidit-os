# PAPERCLIP MIGRATION MAP — Active FounderOS-Aidit → Paperclip (Kolega Corp)

Compiled 2026-08-28. PLANNING ONLY — nothing migrated, nothing modified.
Paperclip local instance verified running: `http://127.0.0.1:3102`,
external-postgres, backups on (`.paperclip\run-stdout.log`).

## Canonical boundary (from agent-registry.json, binding)

- Declarative identity/role specs stay in files:
  `config\agent-registry.json`, `hatta\ROLE.md`, `ahmad\` equivalents.
- Operational state (tasks, runs, heartbeats, budgets, queues, review state)
  moves INTO Paperclip. Paperclip = single canonical operational writer.
- `D:\AI\Agentic\config\agent-registry.json` = machine inventory, STALE,
  reference only.
- Legacy `lib\dispatch` registry = read-only historical reference.

## Entity mapping

| Current operational entity | Current location | Paperclip target (conceptual) | Notes |
|---|---|---|---|
| Agent roster (declarative) | `config\agent-registry.json` | STAYS in file; mirrored as read-only agent records in Paperclip | Do not let Paperclip become 2nd identity writer |
| Owner decisions | `config\decision-ledger.json` + `D:\AI\Agentic\owner\` | STAYS in files; indexed into GBrain; Paperclip links by id (D3…D28) | Owner truth never migrates; only references |
| Task queue (old plane) | `D:\AI\Agentic\tasks\{pending,running,failed,completed,archived,dispatch}` | Paperclip tasks | Old JSON task files (8 pending incl. TRADING-R0..R4, SJS baseline review) are import candidates AFTER owner decides which venture work resumes |
| Task packet standard | `D:\AI\Agentic\config\task-packet-standard.md` | Reused as Paperclip task template | Import as template, keep file as spec |
| Dispatch evidence / runs | old scripts' stdout + `tasks\completed\` reports | Paperclip runs/artifacts | New runs only; history not bulk-imported |
| Heartbeats / worker availability | probe-worker.js outputs (transient) | Paperclip heartbeats | Heartbeat already enabled in instance config (30s) |
| Status snapshots | `D:\AI\Agentic\config\status\*.json` (2 projects) | Paperclip project records (SJS, Caveman) + refresh via refresh-project-status.js pattern | Content current as of 2026-08-18; refresh before import |
| Budget/quota telemetry | none persisted today | Paperclip budget records | New capability; start fresh |
| Ahmad web/chat channel | old plane had Web Control UI; Telegram pending owner action | Paperclip chat/feed channel | Owner decision on Telegram unresolved — do not assume |

## Safe migration order (gated)

Phase 0 — FREEZE WRITE SOURCES (readiness)
- Confirm Paperclip backups actually restored once (verify, not assume).
- Declare freeze date for old-plane task writes.
Gate G0: owner approves migration start.

Phase 1 — IDENTITY MIRROR (low risk)
- Mirror agent roster + department structure (BENNETT-ORG-PROPOSAL) into
  Paperclip as agent/company records. Files remain authoritative.
Gate G1: Ahmad spot-checks 3 agents' records match files.

Phase 2 — PROJECTS + STATUS
- Import 2 project records (SJS_SUPERAPPS, CAVEMAN_TRADING) with refreshed
  snapshots (re-run refresh before import; current snapshots are 10 days stale).
Gate G2: status values match refreshed sources.

Phase 3 — TASK TEMPLATES + NEW WORK ONLY
- Create Paperclip task templates from task-packet-standard.md.
- ALL new tasks/runs/heartbeats write to Paperclip from this point.
- Old pending task JSONs remain in files (not yet imported).
Gate G3: one full task lifecycle completes in Paperclip with evidence.

Phase 4 — SELECTIVE HISTORY IMPORT (optional, reversible)
- Import only owner-approved pending tasks (likely the 8 in tasks\pending)
  with provenance annotations. Skip completed/archived history.
Gate G4: spot-verify every imported task against its source JSON.

Phase 5 — CUTOVER + OLD PLANE READ-ONLY
- Old-plane scripts that write task state are retired to read-only reference.
- registry note "Paperclip is the single canonical operational writer" becomes
  true in practice.
Gate G5: owner sign-off; rollback = revert to Phase 3 (dual-read era), files
untouched throughout, so rollback is cheap at every phase.

## Hard rules during migration

- Never write to `D:\AI\Agentic\` or legacy repo (read-only sources).
- Never move owner truth (decision ledger stays a file).
- Telegram/channel wiring requires separate owner action (was pending in old
  plane — confirm before assuming).
- Live trading gates unaffected: live/micro-live remain disabled throughout.
