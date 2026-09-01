# RUNTIME ROUTING (Phase C) + WORKFLOW ENFORCEMENT (Phase D)
Approved architecture, definitions binding for all workers. 2026-08-28.

## C. Runtime lanes (independent from role identity)

| Lane ID | Purpose | Runtime | Quota source | Guardrail |
|---|---|---|---|---|
| conductor | AHMAD (single logical orchestrator) | Claude Code CLI (swap-capable) | Anthropic subscription | Protected — never consumed by execution work |
| technical | HATTA primary execution | Ollama Cloud glm-5.2:cloud via localhost:11434 | Ollama Cloud Pro | Alts on same account: kimi-k2.7-code, glm-5.1, gpt-oss:20b |
| heavy-context | HERMES/Kimi K3 migration/research/synthesis | Hermes CLI | this subscription | Default lane for thin specialists |
| review-scarce | GIBRAN material/safety reviews needing strongest independence | Claude Code CLI on Lenovo via SSH transport | separate Claude Pro — SCARCE | Batch, gate, never default |

Roles must bind lanes per task, not permanently. Adapter model: a role may be
served by different runtimes over time (e.g. GIBRAN today = Paperclip local
reviewer path; tomorrow = soekarno transport if material). Lanes above are the
canonical routing targets; identities are the logical roles in
`config/agent-registry.json` + Paperclip agent records.

## D. Operational flow

OWNER → AHMAD (conductor) → worker/specialist lane → GIBRAN verification →
canonical DONE written to Paperclip + GBrain.

Enforcement rules:
- Material HATTA change = any write outside `hatta/workspace`, any migration
  step, any change to `config/`, any Paperclip schema/state write. All
  material changes REQUIRE a recorded GIBRAN verdict before marked done.
- HATTA must not self-approve. Enforcement: (1) registry contract
  (`agents.HATTA.can_review=false`); (2) Paperclip: issues assigned to HATTA
  cannot be moved to DONE by HATTA's own agent id for material scopes;
  (3) GIBRAN is a distinct Paperclip agent id — verdict must be attributed to
  that id in the issue thread before status `done`.
- Acceptance evidence per completed item: real file/DB state read back after
  write; command output or API response captured; worker identity; timestamp.
  Agent self-report alone is never sufficient.
- Deterministic state transitions: Paperclip issue statuses + the labels
  `MIGRATED_PENDING_REVALIDATION` / `REVIEW_REQUIRED` / `DONE_VERIFIED`
  are the canonical markers. No free-text "done".
- Owner decisions stay owner decisions: destructive, spend, credentials,
  safety gates, Telegram activate, legacy brain retire, backlog activation —
  all owner-gated per `D:\AI\Agentic\owner\permission-model.md`.
