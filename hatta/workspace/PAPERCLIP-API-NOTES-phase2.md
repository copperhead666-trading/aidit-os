# Paperclip API notes for Phase 2 (dispatch-runner build) — gathered by AHMAD 2026-08-28

Canonical Paperclip instance: http://127.0.0.1:3110 (see config/paperclip-endpoint.json for
discovery — do not hardcode the port in new code; import discoverPaperclipPort from
ops-watcher/watcher.mjs like the rest of this codebase already does).

Company: "kolega corp", id = a7011f31-8891-4581-b8fb-bbda8ac6a890 (issue prefix KOL).
Do NOT touch issue KOL-LEGACY-TRADING-R4-RISK-PRIVILEGE (status backlog, migrated legacy,
explicitly not-active work per its own description — leave it alone).

## Endpoints relevant to this task (verified live 2026-08-28 against the running instance)

- `GET /api/companies/{companyId}/issues` — list issues (array).
- `POST /api/companies/{companyId}/issues` — create an issue. Use this only to create a
  throwaway self-test issue for your own end-to-end verification; label it clearly
  (e.g. title prefix "SELFTEST:") so it's obviously not real backlog, and note in your
  final report whether you left it or cleaned it up.
- `GET /api/issues/{id}` / `PATCH /api/issues/{id}` — read/update an issue (status, labels,
  etc. — inspect the actual response shape from a GET first; do not guess field names).
- `GET /api/issues/{id}/comments`, `POST /api/issues/{id}/comments` — comment thread.
  POST body shape (from live OpenAPI spec, `GET /api/openapi.json`):
  `{ "body": <string|object>, "authorType": "user"|"agent"|"system", "onBehalfOfUserId"?: string }`.
  Comments authored by an agent should be posted using THAT AGENT's own API key (see
  `/api/agents/{id}/keys` GET/POST below) so the resulting comment is correctly attributed —
  do not fake attribution by just setting authorType:"agent" with an admin/owner token if a
  per-agent key mechanism exists; verify which actually works empirically and document it.
- `POST /api/companies/{companyId}/labels` — create a label: `{ "name": string, "color": "#rrggbb" }`.
  Check `GET /api/companies/{companyId}/labels` for what already exists before creating
  duplicates (TEST_REQUIRED / REVIEW_REQUIRED may or may not already exist).
- `GET /api/agents/{id}/keys`, `POST /api/agents/{id}/keys` — per-agent API key issuance.
  Real Paperclip agent ids already registered in this company (from `GET
  /api/companies/{companyId}/agents`, fetched live 2026-08-28):
  - GIBRAN: ce433688-4e0d-4902-addd-b7d27eb081b7 (status: active, adapterType: claude_local)
  - TEST-RUNNER: 86097684-137c-4d79-b853-94f903567486 (status: paused)
  - Ahmad (Paperclip's OWN internal CEO agent persona, NOT this session): cdea95bd-b9db-4035-854b-8ea677c1326e
    (status: error — "hit your session limit" — this is Paperclip's own claude_local heartbeat
    agent, separate from the live orchestrator session that dispatched you. Its
    runtimeConfig.heartbeat.enabled is currently false. Do not touch/enable it — flag any
    concern about it in your report, do not silently change it.)

## Known stale-config hazard (do not repeat this mistake)

The other ~11 specialist agents (TEST-RUNNER, GBRAIN-CURATOR, RETRIEVAL-ASSISTANT,
GRAPHIFY-ANALYST, STEWARD-SJS, STEWARD-CAVEMAN, TRADING-QUANT, AUDIT-CLERK, ESCALATION-SEC,
PAPERCLIP-OPERATOR, MIGRATION-SURVEYOR) were created by an earlier migration with
`"adapterType": "hermes_generic"`. That adapter type DOES NOT EXIST in the installed
paperclipai package (verified 2026-08-28: `grep -c hermes_generic` on the installed
package's dist/index.js returns 0; `claude_local` returns 5). Paperclip's own heartbeat
engine cannot and will not invoke these agents no matter what status they're set to — they
are inert metadata-only records today. Your dispatch-runner must NOT rely on Paperclip's
native heartbeat/adapter system to run HATTA/GIBRAN/TEST-RUNNER — those lanes are, and must
remain, EXTERNALLY driven (this is consistent with how GIBRAN has actually been dispatched
all session: a human/AHMAD-invoked `hermes -z ...` CLI call, never a Paperclip-internal
mechanism). Do not attempt to "fix" the adapterType to some other invented value — there is
no real native equivalent for external CLI-driven agents in this Paperclip version. If you
want to reduce future confusion, you may (optional, not required) PATCH those 11 agents'
`pauseReason` field via `PATCH /api/agents/{id}` to something like "Dispatched externally by
ops-watcher/dispatch-runner.mjs — adapterType hermes_generic is not implemented by this
Paperclip version, Paperclip's own heartbeat will never run this agent" — but do not change
`status` or `adapterType` on any agent you did not create.

## GIBRAN dispatch command (already proven working all session, reuse as-is)

    hermes -z "<prompt>" --provider nous -m "upstage/solar-pro4:free" --in "D:\AI\Active FounderOS-Aidit"

Nous Free is slow: real calls in this session have taken anywhere from ~70s to ~7 minutes.
Your runner must not assume a fast response — use a generous timeout (10 minutes is safe)
and must not block or crash on timeout; log and move on.

## Existing code to reuse, not duplicate

`ops-watcher/watcher.mjs` already exports `discoverPaperclipPort(injected)` and
`httpGet(url, {token})` — both are crash-proof (never throw, return `{networkError:true,...}`
on failure) and already handle 401/403 by resolving a bearer token from
`.paperclip/instances/default/secrets` via a local `resolvePaperclipToken()` helper (not
exported — you may need to export it, or write your own equivalent using the same secrets
dir pattern; check that function's implementation before reinventing token resolution).
`watcher.mjs`'s `detectReviewWaiting(snap)` already detects issues with a REVIEW_REQUIRED
label lacking a verdict comment (regex `/VERDICT\s*:/i` + an author_agent_id field on the
comment) — read it for the exact matching logic you should stay consistent with, but note
it is READ-ONLY (detect only, never dispatches or writes). Your new code is the part that
was missing: it actually calls GIBRAN/runs tests and writes the result back to Paperclip.
