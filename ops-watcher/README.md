# ops-watcher

A dependency-free, deterministic, **read-only** watcher for the Active
FounderOS-Aidit operational surface. It polls Paperclip, HATTA (via the local
Ollama daemon), the GBrain store, and the Graphify graph outputs, detects a
small set of well-defined conditions, and appends routing events to an
append-only NDJSON log. It makes **no LLM calls**, dispatches **no work**,
marks **no issues done**, and writes **nothing** to Paperclip issue state
(labels/comments included — those are a separate gated mechanism this watcher
does not implement).

## Run

```bash
# One sweep, then exit (good for cron / scheduled task):
node ops-watcher/watcher.mjs --once

# Continuous poll, default 60s:
node ops-watcher/watcher.mjs

# Custom poll interval (seconds):
node ops-watcher/watcher.mjs --interval 120

# Offline assertion run against canned fixtures (no network):
node ops-watcher/watcher.mjs --selftest
```

Requires Node 18+ (uses global `fetch`). No npm install needed.

## What it reads (read-only GETs only)

| Source | Endpoint / path | Purpose |
|---|---|---|
| Paperclip | `GET http://127.0.0.1:3101/api/health` | Liveness |
| Paperclip | `GET http://127.0.0.1:3101/issues` | Issue list (status, `executionLockedAt`, `blockedOwnerNotifiedAt`) |
| Paperclip | `GET /issues/:id/comments`, `GET /issues/:id/labels` | Per-issue, only when a `REVIEW_REQUIRED` candidate is found |
| HATTA (Ollama) | `GET http://localhost:11434/api/tags` | Confirms `glm-5.3:cloud` is served |
| GBrain | `knowledge/store/.gbrain/brain.pglite` | File existence + mtime |
| Graphify | `graphify-out/active/graph.json`, `graphify-out/legacy/graph.json` | File existence |

### Auth

If Paperclip returns `401`/`403`, the watcher resolves a bearer token **only**
from `D:\AI\Active FounderOS-Aidit\.paperclip\instances\default\secrets\` (it
prefers a filename containing `token`, otherwise the first readable file in
that dir). Tokens are **never hardcoded** and never read from environment
variables. If no token is resolvable, the sweep records the auth gap in the
heartbeat event and continues.

## Detectors

1. **stuck-running** → `AHMAD`
   Issue with `status = "in_progress"` whose `executionLockedAt` is older than
   45 minutes (default). Fresh locks and locks without a timestamp are skipped.

2. **blocked-unnotified** → `ESCALATION-SEC`
   Issue with `status = "blocked"` and `blockedOwnerNotifiedAt IS NULL`.
   Routed to the ESCALATION-SEC queue lane for owner-facing triage.

3. **review-waiting** → `GIBRAN`
   Issue carrying the `REVIEW_REQUIRED` label with no verdict comment (a
   comment whose body matches `/VERDICT\s*:/i` and is attributed to an agent
   author). Routed to GIBRAN — the watcher does **not** write the verdict.

4. **worker-lane-unavailable** → `AHMAD**
   HATTA technical lane is degraded: either Ollama at `localhost:11434` is
   unreachable, or `glm-5.3:cloud` is absent from `/api/tags`.

5. **paperclip-unreachable** → `AHMAD`
   `/api/health` did not return a body.

6. **gbrain-store-missing** / **graphify-active-missing** /
   **graphify-legacy-missing** → `AHMAD`
   Connector degradation: a required store/graph file is absent.

7. **watcher-heartbeat** → `OPS-WATCHER`
   One per sweep, summarizing reachability + error list. This is the
   self-restart recovery signal: its presence in `events.jsonl` confirms the
   watcher is alive; its absence longer than ~2× the poll interval means it
   died and should be restarted.

## Restart recovery (dedupe)

`ops-watcher/state.json` persists:

```json
{ "cursor": <epochMs last sweep>, "seen": [<event-key>...], "seenSet": {...} }
```

Each emitted event has a deterministic key
`${detector}|${target_role}|${issueId|key|target}`. On restart the watcher
loads `state.json` and skips any candidate whose key is already in `seen`, so
a crash + restart never re-emits the same event. The `seen` list is capped at
5000 entries (oldest dropped). The heartbeat event's key is cleared each
sweep so it emits exactly once per sweep even under dedupe.

`cursor` is the timestamp of the last successful sweep — useful for an
external supervisor to detect a stalled watcher.

## Output: `ops-watcher/events.jsonl`

Append-only NDJSON. One JSON object per line:

```jsonc
{
  "ts": 1787390000000,          // epoch ms
  "detector": "stuck-running",  // which detector fired
  "target_role": "AHMAD",       // logical lane/role routed to (never an LLM dispatch)
  "payload": {                  // detector-specific, always plain JSON
    "issueId": "i-stuck",
    "identifier": "PAP-101",
    "execution_locked_at": "2026-08-28T03:00:00.000Z",
    "stale_minutes": 92
  }
}
```

`target_role` values: `AHMAD`, `ESCALATION-SEC`, `GIBRAN`, `OPS-WATCHER`.

> **Field-casing note.** The Paperclip **API** returns these fields on each
> issue object in camelCase (`executionLockedAt`, `blockedOwnerNotifiedAt`,
> `unblockDescriptor`) — the watcher reads them in that shape. The emitted
> event **payload** keys are kept snake_case (`execution_locked_at`,
> `unblock_descriptor`) as the downstream-consumer contract; only the reads
> off the Paperclip issue object are camelCase.

### Payload shapes by detector

| detector | payload fields |
|---|---|
| `stuck-running` | `issueId`, `identifier`, `execution_locked_at`, `stale_minutes` |
| `blocked-unnotified` | `issueId`, `identifier`, `unblock_descriptor` |
| `review-waiting` | `issueId`, `identifier`, `comment_count` |
| `worker-lane-unavailable` | `lane`, `role`, `ollama_reachable`, `model_present`, `expected_model`, `available_models` |
| `paperclip-unreachable` | `base`, `auth_required` |
| `gbrain-store-missing` | `path` |
| `graphify-active-missing` | `path` |
| `graphify-legacy-missing` | `path` |
| `watcher-heartbeat` | `sweep`, `paperclip_reachable`, `ollama_reachable`, `gbrain_exists`, `graphify_active`, `graphify_legacy`, `issue_count`, `errors` |

## Selftest

`node ops-watcher/watcher.mjs --selftest` loads `ops-watcher/fixtures/state.json`
(a canned snapshot with a stuck run, a fresh run, a no-lock run, a new block,
an already-notified block, a pending review, and a completed review) plus
`ops-watcher/fixtures/expect.json` and asserts each detector's output matches
the expected issue ids. No network is touched. Exits non-zero on any mismatch.

## Hard guarantees

- No `POST`/`PUT`/`PATCH`/`DELETE` to Paperclip, ever.
- No LLM / chat-completion calls anywhere in the file.
- No secrets hardcoded; tokens resolve only from the Paperclip secrets dir.
- The watcher never marks issues done and never writes labels/comments.
- All file writes are confined to `ops-watcher/` (`state.json`, `events.jsonl`).