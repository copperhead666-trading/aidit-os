# BENNETT-FAITHFUL ORG PROPOSAL — Active FounderOS-Aidit (Kolega Corp)

Compiled 2026-08-28. Planning only — roster is a draft for owner/agent review,
not a commitment. Bennett principles applied: departments with named heads,
thin specialists, event-triggered sparse activation, shared GBrain / shared
tools / Paperclip state, orchestrator stays out of execution.

## Design constraints honored

- AHMAD = single logical orchestrator, runtime-swappable (not a department).
- HATTA = primary executor (Engineering dept head, lane already provisioned).
- Sparse activation: every specialist activates on an explicit trigger, does
  its unit of work, writes state to Paperclip + knowledge to GBrain, sleeps.
- No new paid subscriptions. USD 60–70/mo ceiling already covered by existing:
  Anthropic sub (Ahmad), Ollama Cloud Pro (HATTA + GLM alternates),
  Soekarno's scarce Claude Pro (review only), Codex resting.
- Roster size NOT artificially limited — but roster cost is ~zero because
  inactive agents are definitions, not running processes.

## Departments

### 1. Executive / Governance — Head: AHMAD (ex officio thin)
Purpose: owner interface, decision routing, audit.
- R01 AUDIT-CLERK — ledger consistency checks (decision-ledger.json vs
  source D:\AI\Agentic\owner\), drift detection. Trigger: weekly cron or on
  owner-decision write. Lane: Hermes/Kimi (cheap reads). Reusable: none
  existing; thin prompt + jq/python. NEW.
- R02 ESCALATION-SECRETARY — maintains WAITING_FOR_OWNER queue in Paperclip.
  Trigger: any agent writes owner-blocker state. Lane: Hermes/Kimi. NEW.

### 2. Engineering — Head: HATTA (role exists, verified)
Purpose: all implementation in Active FounderOS-Aidit.
- R03 HATTA-EXEC — the existing executor (harness.mjs). Reuse AS-IS.
- R04 TEST-RUNNER — runs npm test/typecheck/build on demand for a scoped
  change; reports pass/fail + failing diff excerpt. Trigger: HATTA writes
  code-changing artifact. Lane: HATTA runtime (run_command already allowlisted)
  OR Hermes/Kimi cheap lane as separate process for independence. NEW (thin).
- R05 REVIEWER-SCARCE — SOEKARNO adapter, material/safety-critical review
  only. Reuse: `D:\AI\Agentic\scripts\lenovo-transport-adapter.js` +
  probe-worker.js as-is. Trigger: safety-flagged change only. Autonomy: low.
  Preserve quota.
- R06 REVIEWER-DAILY — default independent reviewer for non-critical HATTA
  changes (closes the current "no reviewer" gap). Lane: Hermes/Kimi K3 (this
  lane) or glm-5.1:cloud alternate on HATTA's account — but NOT same model+same
  prompt context as the maker, to keep review meaningful. NEW role, no new cost.
- R07 MIGRATION-SURVEYOR — read-only extraction of facts from legacy trees
  (D:\FounderOS-Aidit De Maestros, D:\AI\Agentic) into structured notes for
  GBrain. Uses graphify-out where present. Trigger: migration tasks. NEW (thin).

### 3. Knowledge / Intelligence — Head: R08 GBRAIN-CURATOR
- R08 GBRAIN-CURATOR (head) — owns ingestion schedule: decision ledger, task
  packets, role specs, handoffs → knowledge/store. Trigger: on canonical write
  or daily cron. Lane: Hermes/Kimi (local embeddings are free). NEW.
- R09 GRAPHIFY-ANALYST — structural/multi-hop code questions only,
  queries existing graphify-out JSON first, refreshes only when stale.
  Trigger: orchestrator asks structural question. NEW (thin).
- R10 RETRIEVAL-ASSISTANT — answers "what do we know about X" for Ahmad
  pre-dispatch, against GBrain. Trigger: Ahmad dispatch prep. NEW (thin).

### 4. Operations / Runtime Ops — Head: R11 OPS-WATCHER
- R11 OPS-WATCHER (head) — Paperclip health, heartbeat reaping, backup
  verification, port/machine reachability (Lenovo check via check-lenovo.ps1),
  worker availability probes (probe-worker.js pattern ported). Trigger: cron +
  pre-dispatch. Lane: Hermes/Kimi. Reuses old-plane scripts read-only. NEW.
- R12 PAPERCLIP-OPERATOR — the only role allowed write access to Paperclip
  admin operations (instances config, schema ops). Human-agent pairing:
  proposes, owner/agent approves. Trigger: migration phases only. NEW.

### 5. Project Stewards (ventures) — Heads: per-project steward, thin
FounderOS orchestrates multiple ventures (SJS SuperApps, Caveman Trading).
Stewards are the Bennett "Kepala Project" continuation from the legacy
venture-roles.ts design — one accountable thin role per venture.
- R13 STEWARD-SJS — tracks SJS status snapshot, blockers, owner questions.
  Inactive until SJS canonicalization authorized (currently
  CANDIDATE_NOT_YET_APPROVED). Lane: Hermes/Kimi. Reuses
  D:\AI\Agentic\config\status\sjs-superapps.json contract.
- R14 STEWARD-CAVEMAN — tracks trading project state; hard rule: live/micro-live
  remain disabled, risk changes are owner-gated. Watches remediation queue
  (R0–R4) state only; no execution. Lane: Hermes/Kimi.
- R15 TRADING-QUANT — future specialist for remediation implementation when
  queue unblocks and owner authorizes. Trigger: explicit task packet. Lane:
  SOEKARNO (67 trading skills installed on Lenovo) — scarce, gated. DORMANT NOW.

## Reuse matrix (existing → proposal)

| Existing asset | Disposition |
|---|---|
| HATTA + harness.mjs | Reuse as R03, unchanged |
| SOEKARNO + SSH transport + probe scripts | Reuse as R05, gated, scarce |
| Ahmad (Claude Code CLI lane) | Orchestrator, unchanged |
| Hermes/Kimi this session | Generalization into cheap worker lane (R01,R02,R04,R06,R08-R11,R13,R14) |
| CORLEONE (Codex, Lenovo) | Resting — reserve fallback for R06 if both cheap lanes exhausted. Do not activate by default |
| Legacy dispatch-worker.js, task-store.js, refresh-project-status.js | Read-only reference patterns for R08/R11 implementations |
| lib/dispatch/* worker pattern files | Read-only reference for new-role tool harnesses |
| graphify-out (active+legacy) | Consumed by R09, no regeneration needed now |

## New roles genuinely needed

R01, R02, R04, R06, R07, R08, R09, R10, R11, R12, R13, R14 — all thin
(prompt + scoped toolset + Paperclip/GBrain IO contract). Only R01, R04, R06,
R08, R11 are near-term (needed to run the plane). R07, R09, R10 activate during
Paperclip migration. R13/R14 activate on venture re-engagement. R15 dormant.

## Activation model

- Trigger sources: cron tick (OPS-WATCHER, GBRAIN-CURATOR, AUDIT-CLERK),
  Paperclip state event (ESC-SECRETARY, REVIEWER-*), Ahmad dispatch
  (everything else).
- No agent polls. No agent holds a warm session. Cost floor = orchestrator
  turns only.

## Ahmad involvement budget

Ahmad touches: dispatch packets, review of delegated output, owner escalation.
Ahmad does NOT touch: ingestion, probing, testing loops, retrieval prep,
steward bookkeeping. That is the whole point of departments 3–5.
