# Paperclip Roster Canonicalization — SJAHRIR (2026-08-28)

## Scope
Reconcile live Paperclip (`kolega corp`) agent roster against the canonical FounderOS workforce defined in:
- `handoffs/sjahrir/CANONICAL-ROLE-MAP.json`
- `config/agent-registry.json`
- `handoffs/ahmad/AHMAD-SESSION-HANDOFF-2026-08-28.md`

No organizational redesign. No deletions of built-ins/legacy. No new fake executable adapters.

## BEFORE → AFTER

| # | Name | Before status | Before adapter | Before title | After status | After adapter | After title | Classification |
|---|------|---------------|----------------|--------------|--------------|---------------|-------------|----------------|
| 1 | Reflection Coach | paused | claude_local | Reflection Coach | paused | claude_local | Reflection Coach | BUILT-IN |
| 2 | TEST-RUNNER | paused | hermes_generic | Scoped test/typecheck/build runner | paused | hermes_generic | Scoped test/typecheck/build runner | DORMANT |
| 3 | MIGRATION-SURVEYOR | paused | hermes_generic | Read-only legacy extraction to structured notes | paused | hermes_generic | Read-only legacy extraction to structured notes | DORMANT |
| 4 | GRAPHIFY-ANALYST | paused | hermes_generic | Structural code queries against graphify-out graphs | paused | hermes_generic | Structural code queries against graphify-out graphs | DORMANT |
| 5 | GBRAIN-CURATOR | paused | hermes_generic | Ingestion schedule + quality of canonical knowledge | paused | hermes_generic | Ingestion schedule + quality of canonical knowledge | DORMANT |
| 6 | RETRIEVAL-ASSISTANT | paused | hermes_generic | Pre-dispatch knowledge answer prep | paused | hermes_generic | Pre-dispatch knowledge answer prep | DORMANT |
| 7 | OPS-WATCHER | paused | hermes_generic | Paperclip health, backups, reachability, probes | paused | hermes_generic | Paperclip health, backups, reachability, probes | DORMANT |
| 8 | PAPERCLIP-OPERATOR | paused | hermes_generic | Paperclip admin ops, gated per phase | paused | hermes_generic | Paperclip admin ops, gated per phase | DORMANT |
| 9 | STEWARD-SJS | paused | hermes_generic | SJS SuperApps status bookkeeping (dormant until canonicalization authorized) | paused | hermes_generic | SJS SuperApps status bookkeeping (dormant until canonicalization authorized) | DORMANT |
| 10 | Ahmad | idle | claude_local | (none) | idle | claude_local | Paperclip built-in CEO persona (NOT canonical AHMAD) | BUILT-IN |
| 11 | GIBRAN | idle | claude_local | Review / acceptance for HATTA material changes | idle | claude_local | Independent reviewer (external runner: Hermes/Nous Free) | CANONICAL |
| 12 | STEWARD-CAVEMAN | paused | hermes_generic | Caveman Trading state watch; live trading stays disabled | paused | hermes_generic | Caveman Trading state watch; live trading stays disabled | DORMANT |
| 13 | TRADING-QUANT | paused | hermes_generic | Future trading remediation implementation (dormant, owner-gated) | paused | hermes_generic | Future trading remediation implementation (dormant, owner-gated) | DORMANT |
| 14 | AUDIT-CLERK | paused | hermes_generic | Ledger consistency + drift audit | paused | hermes_generic | Ledger consistency + drift audit | DORMANT |
| 15 | ESCALATION-SEC | paused | hermes_generic | WAITING_FOR_OWNER queue maintenance | paused | hermes_generic | WAITING_FOR_OWNER queue maintenance | DORMANT |
| 16 | Summarizer | paused | claude_local | Summarizer | paused | claude_local | Summarizer | BUILT-IN |
| 17 | Rama | idle | claude_local | Founding Engineer | idle | claude_local | Built-in demo engineer (not canonical FounderOS role) | BUILT-IN |

**Roster count:** 17 before, 17 after.

## Records changed
All 17 existing records received updated `capabilities`, `metadata.canonical_classification`, and `adapterConfig.external_runner_path` (where applicable). Specific material metadata fixes:
- **GIBRAN**: title and capabilities now truthfully describe the Hermes/Nous Free external runner path; claude_local adapter is identified as Paperclip attribution-only.
- **Ahmad (Paperclip built-in CEO)**: title and capabilities explicitly disambiguate from the canonical AHMAD orchestrator (Claude Code CLI).
- **Rama**: title/capabilities clarified as Paperclip demo persona, not a canonical FounderOS role.
- **11 thin specialists**: capabilities state they are canonical FounderOS roles that are DORMANT and that `adapterType: hermes_generic` is inert (no engine implementation).
- **Reflection Coach / Summarizer**: capabilities tagged as Paperclip built-ins.

## Records intentionally left alone
- **No new Paperclip agent records created** for HATTA, SJAHRIR, CORLEONE, or HERMES. Paperclip has no honest engine-backed adapter for external runners; any adapter string would be as fake as `hermes_generic` (see `config/agent-registry.json` hazard_2).
- **No deletions**: built-ins (Reflection Coach, Summarizer, Ahmad, Rama) and legacy trading issues remain.
- **No status changes on built-ins**: Ahmad and Rama remain `idle` because their heartbeats are already disabled; pausing them was not required and could risk UI confusion. Reflection Coach and Summarizer remain `paused`.
- **No adapterType changes**: all `hermes_generic` records kept their inert adapter type; no executable fake adapter was introduced.
- **HATTA harness/security, Telegram daemon, Corleone hardening scope, credentials, TradingOS, SOEKARNO quota** untouched.

## GIBRAN verdict
**PASS WITH NOTES** (KOL-15, comment author `ce433688-4e0d-4902-addd-b7d27eb081b7`).

Key points from the review:
- Changes are internally consistent with the architecture and canonical sources.
- Critical disambiguation of Paperclip built-in CEO persona vs canonical AHMAD orchestrator is correct.
- DORMANT thin-specialist classification matches the registry pattern.
- Notes: verify no truncation in issue text; consider whether any DORMANT specialists have pending wake-up triggers that need registry reflection.

## Validation performed live
- `GET /api/companies/{companyId}/agents` returns 17 records.
- All statuses/roles/adapterTypes match intended classification.
- Zero records with a fake adapter are enabled/running; all `hermes_generic` records are `paused`.
- GIBRAN review-runner posted attributed verdict and transitioned KOL-15 to `done` + `DONE_VERIFIED`.

## Remaining ambiguity
1. **HATTA representation in Paperclip**: still no honest adapter. HATTA identity remains declarative in `config/agent-registry.json` only. Any future Paperclip issue assignment to HATTA must be by name in text, not by `assigneeAgentId`.
2. **DORMANT specialists wake-up triggers**: the canonical role map says some are "KEEP (paused)" with trigger notes; the Paperclip records document external runner paths but do not encode cron/event triggers.
3. **OPS-WATCHER**: its live runner (`ops-watcher/watcher.mjs`) is deterministic and running conceptually, but the Paperclip record remains inert. This is honest but operationally split.
4. **Built-in CEO persona status**: left `idle`/heartbeat-disabled per prior hazard decision; if anyone re-enables its heartbeat, it will collide with the real AHMAD's Anthropic quota.

## Artifacts
- `handoffs/sjahrir/paperclip_roster_snapshot.json` — pre-change live roster.
- `handoffs/sjahrir/paperclip_roster_snapshot_after.json` — post-change live roster.
- `handoffs/sjahrir/roster_canonicalize_patch.mjs` — idempotent patch script used.
- `handoffs/sjahrir/create_review_issue.mjs` — review issue creation script.
