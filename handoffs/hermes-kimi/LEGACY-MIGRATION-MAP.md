# LEGACY MIGRATION MAP (Phase G) — 2026-08-28. Planning only, nothing migrated.

Source: D:\FounderOS-Aidit De Maestros\app (LEGACY-BUT-LIVE, read-only).
Target: Active FounderOS-Aidit + Paperclip/Kolega Corp + GBrain.
Legacy ahmad-brain is NOT retired here (owner-gated stop condition).

## 1. Connectors (lib/connectors/*) — 27 files
| Connector | Migration treatment |
|---|---|
| gbrain.ts, graphify.ts | SUPERSEDED by real installs in Active workspace (GBRAIN.md). No code port; delete-by-non-port. |
| memory-archive.ts | Content source only — see §4 topics. |
| sjs.ts | Venture connector; migrate when STEWARD-SJS activates post-canonicalization. |
| email.ts, comms-* (comms.ts, comms-feed.ts, comms-gravity.ts, comms-lanes.ts) | Defer. Only migrate when an external comms channel is owner-activated (Telegram/headless is owner-gated). |
| payments.ts, bank.ts, bank-statements.ts (lib/) | Financial — owner-gated. Do not migrate without explicit ask. |
| notion/slack/gcal/ghl/attio/arcads/beehiiv/manychat/meta-ads/miro/obsidian/trakyo/webinarjam/whatsapp/wispr/zernio | Founder marketing/ops integrations — likely out of Active scope; catalog in GBrain, no port. |
| creds.ts | Pattern reference only (secret resolution). NEVER copy credentials. |

## 2. Queue/state (legacy SQLite DBs)
- data/founder-os.db (+wal), ledger.db, bank.db — live legacy state.
- Treatment: NOT bulk-imported. Snapshot schemas into GBrain; rows migrate only if
  owner asks for a specific entity (e.g., approval queue history).
- Old-plane task queue already staged as KOL-LEGACY-* issues (Phase 1).

## 3. Useful cockpit/Ahmad modules (lib/ahmad/*, lib/cockpit/*)
High-value patterns to port as needed (not now; port on demand per feature ask):
- wake-loop.ts + wake-loop-guard.ts — re-entrancy guard pattern (recent commits 0f57c21, 8ba91b8, ebe70f4 show P0 fixes; the GUARD pattern is the valuable part).
- queue-view.ts — Ahmad queue board read model.
- quality-gate.ts — pre-acceptance checks.
- reroute-handler.ts + reroute-guard.ts — worker rerouting on exhaustion (relevant to lane-takeover policy).
- kepala-project-delegate.ts / venture-roles.ts — Bennett precursor (Kepala Project = dept head).
- execute-decision.ts, decision-callback.ts — decision execution with callback.
- never-tier-guard.ts, degraded-mode.ts — safety degradation patterns.
- cockpit/status.ts, telegram-status.ts — status surfaces (telegram gated).

## 4. memory-archive topics
- Extract topic list only → GBrain (topic names, not bodies).
- Bodies migrate on demand to avoid noisy bulk ingest.

## 5. Pending backlog
- Already staged inactive in Paperclip (Phase 1, label MIGRATED_PENDING_REVALIDATION).
- Reactivation = owner decision (stop condition).

## Sequencing guidance
1. Now: nothing further — mapping recorded.
2. When a feature is wanted: port ONLY its module + tests into Active, GIBRAN reviews, Paperclip issue tracks it.
3. Legacy stays live until owner explicitly schedules retire of ahmad-brain.
