# MIGRATION STATUS — FounderOS-Aidit (HERMES/Kimi lead, 2026-08-28)

Single compact status file. Owner/Ahmad inspects this; workers append via me.

## Overall state
- Phase 1 (instance, backup, GBrain seed, GIBRAN, legacy staging): DONE — see AHMAD-DELTA-PHASE1.md
- Phases A–G: ALL DONE (details below)

## Phase A — Graphify (DONE 2026-08-28T13:2x)
- ACTIVE graph: `graphify-out/active/graph.json` — 265 nodes, 20 communities.
- LEGACY graph: `graphify-out/legacy/graph.json` — 3975 nodes, 7895 edges, 328 communities.
- Artifacts moved OUT of legacy tree (legacy tree now clean of derived graphify output, `git status` for that path is clear).
- Verified queries:
  - Ahmad wake/queue path: found `lib/ahmad/wake-loop.ts`, `ahmad-brain.ts`, `staff-delegation-loop.ts`, `queue-view.ts`, queue board.
  - HATTA legacy deps: `lib/dispatch/hatta.ts`, `tool-access/hatta-tools.ts (LEGACY_TOOL_NAMES)`, shared `schemas.ts`/`data.ts`/`db.ts`.
  - Paperclip integration points: `lib/paperclip-store.ts`, `lib/ahmad/reroute-handler.ts`, `kepala-project-delegate.ts`, `quality-gate.ts`, `execute-decision.ts`.
  - Cross-file impact: `registry.ts` ← `reroute-handler.ts` → `venture-roles.ts` (2 hops, undirected; directed path absent by design).
  - Isolation: zero overlapping source_file entries between active and legacy graphs.
- Worker: HERMES directly (graphify is deterministic, no HATTA spend needed).
- Risk: none. Legacy read-only constraint held.

## Phase B — Org (DONE)
- 5 departments as Paperclip projects: Executive-Governance, Engineering,
  Knowledge-Intelligence, Operations, Project-Stewards. IDs in Paperclip.
- 12 specialist/steward agents registered, all status=paused (dormant;
  pause_reason documents sparse/event activation). No warm loops created.
- Roles: AUDIT-CLERK, ESCALATION-SEC, TEST-RUNNER, MIGRATION-SURVEYOR,
  GRAPHIFY-ANALYST, GBRAIN-CURATOR, RETRIEVAL-ASSISTANT, OPS-WATCHER,
  PAPERCLIP-OPERATOR, STEWARD-SJS, STEWARD-CAVEMAN, TRADING-QUANT.
- Note: "dormant" was initially written then corrected to valid enum "paused".
  Verified via DB read-back.

## Phase C — Runtime routing (DONE)
- handoffs/hermes-kimi/RUNTIME-AND-WORKFLOW.md: 4 lanes (conductor, technical,
  heavy-context, review-scarce) decoupled from role identity; adapter model.

## Phase D — Workflow enforcement (DONE)
- Same doc: flow OWNER→AHMAD→worker→GIBRAN→canonical DONE; material HATTA
  changes require GIBRAN verdict attribution by distinct agent id; labels
  REVIEW_REQUIRED + DONE_VERIFIED created in Paperclip (verified in labels table).

## Phase E — Shared tools (DONE)
- handoffs/hermes-kimi/SHARED-TOOLS.md: harness/GBrain/Graphify/Paperclip/
  legacy-pattern inventories; no raw secrets to workers; destructive/financial
  actions owner-gated; lane takeover by task-packet re-binding (recorded).

## Phase F — GBrain expansion (DONE)
- Added: runtime-and-workflow, shared-tools, migration-status,
  paperclip-migration-map, ahmad-delta-phase1, legacy-migration-map (+8 earlier).
- Retrieval verified: top-ranked hits for workflow/GIBRAN, ledger D26,
  connectors queries. Total ~17 corpus pages.

## Phase G — Legacy migration mapping (DONE)
- handoffs/hermes-kimi/LEGACY-MIGRATION-MAP.md: 27 connectors triaged; queue/
  state DBs snapshot-only; 12 high-value lib/ahmad+cockpit modules named for
  on-demand port; memory-archive = topics only; backlog stays inactive.

## Workers used this DELTA
HERMES/Kimi only. HATTA/GIBRAN not spent (all work deterministic or
documentation). SOEKARNO/Codex untouched.

## Unresolved risks
- Ahmad CEO agent on Paperclip instance 3101 is in error state (session limit,
  resets 2:20pm) — cosmetic for migration, resolves on Ahmad's next real run.
- Stray Paperclip instance :3100 still running (0 companies). Owner decision B1.
- 8 KOL-LEGACY-* await owner revalidation (B2).
