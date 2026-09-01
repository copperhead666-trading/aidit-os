# Phase 7 — Security + Observability Audit Report
### Active FounderOS-Aidit agent org — 2026-08-28

**Scope:** bounded, local, FREE-ONLY. No paid tooling installed or recommended
(no Promptfoo/Langfuse purchase, no new subscriptions). Telegram, the cockpit,
and core runner logic behavior were NOT modified — changes were read-only or
strictly additive. No Paperclip agent record was created for HATTA.

**How to reproduce every check:**
```bash
node ops-watcher/security-audit.mjs                       # full audit (CLI)
node ops-watcher/security-audit.regression.test.mjs       # secret-matcher unit tests
node hatta/harness.security.test.mjs                      # adversarial guard tests
node hatta/harness.mjs --selftest                         # harness path-escape selftest
```

---

## 1. Secrets hygiene — RESULT: clean (0 REAL unmanaged secrets)

Real, executable scan of 76 text files across `ops-watcher/`, `hatta/`, `config/`,
`handoffs/` for token-shaped patterns (Telegram bot-token, `pcp_` Paperclip key,
`github_pat_`, `ntn_`, `cfut_`, `sb_publishable_`, `sk-`/`sk-kimi-`, JWT).

| Verdict | Count | Meaning |
|---|---|---|
| FAKE | 11 | Known documented fake/example tokens (telegram-client.mjs comment + 2 selftest fakes), echoed in test files. Confirmed fake. |
| INFO_NOT_SECRET | 1 | A JWT in the regression test that decodes to JSON session metadata, not a credential. |
| REAL_BUT_IGNORED | 1 | `ops-watcher/gibran-api.key` → real `pcp_…` Paperclip API key, in a `*.key` file that IS gitignored (see §2). Intended credential store, NOT a leak. |
| REAL | **0** | None. |

Real secrets DO exist on disk in `.env.local` (Supabase service-role JWT, GitHub
PAT, Telegram bot token, Notion/Ollama/Cloudflare/Kimi keys). They were inspected
directly. They are **not** a finding because `.env.local` is gitignored by
`.env.*` and is **not** git-tracked (`git ls-files` confirms). They are also
outside the four scanned source dirs (root-level), so the source scan correctly
never sees them.

**The `pcp_` key in `gibran-api.key`** is the GIBRAN Paperclip API key minted in
Phase 2 (per `config/agent-registry.json`). It is a real secret on disk, properly
covered by the `*.key` gitignore rule and untracked. No action; just never commit.

**Classifier limitation, stated honestly:** the JWT classifier decodes the header
and marks anything that parses to JSON as `INFO_NOT_SECRET`. A real Supabase
service-role JWT is itself a signed JWT whose header also decodes to JSON, so the
classifier cannot distinguish a real signed key from a Paperclip session blob by
content alone. This is not a silent gap: the audit's defense-in-depth for `.env`
files is the `.gitignore .env.*` rule verified in §2, not content classification.
This is documented in the regression test.

## 2. .gitignore coverage — RESULT: complete

Read the real `.gitignore` and ran `git check-ignore -v` on every sensitive-ish
file actually on disk.

- Required patterns **all present**: `*.key`, `*secret*`, `*credential*`,
  `*password*`, `.env`. `.env.*` (env-var files) is covered.
- `ops-watcher/gibran-api.key` → **IGNORED** by `*.key`. ✓
- `.env.local` → **IGNORED** by `.env.*`. ✓
- `ops-watcher/security-audit.last-run.json` (new generated artifact) →
  **IGNORED** (added this run, see "changes made"). ✓

Per-file judgment calls (real, not assumed):
- `env.local..txt` → NOT ignored, but the file is **empty** and untracked. Not
  sensitive. The odd name is harmless cruft; optionally delete it. No gitignore
  change needed.
- `ops-watcher/state.json`, `review-runner.state.json` → NOT ignored. Both are
  **empty operational dedupe state** (`{"attempts":{}}`, `{\"cursor\":0,\"seen\":[],…}`),
  untracked, containing no secrets. Safe to track or ignore; judgment: **safe as
  operational state, no action**.
- `ops-watcher/events.jsonl` → NOT ignored. Append-only routing log, no secrets
  (verified content). Safe.

## 3. Audit trail completeness — RESULT: confirmed (route gap now FIXED)

**`ops-watcher/events.jsonl`**: append-only NDJSON, 0 malformed. Each line
carries `ts`/`detector`/`target_role`/`payload`. Append-only mechanism verified by
reading `watcher.mjs`'s own source: it uses `fs.appendFile(EVENTS_FILE, …)` with
no overwrite/truncate path — append-only by construction, not assumed.

**Paperclip comment audit trail — live spot-check (REAL, not hypothetical):**
Paperclip canonical instance is live on **port 3110** (fingerprint-matched via
`discoverPaperclipPort`). Inspected 12 issues; **7 carry comments**. Every
comment on every comment-bearing issue carries a real `createdAt` timestamp and
real authorship (`authorAgentId` / `authorType`):

| Issue | Comments | ts? | author? | VERDICT marker? | sample authorType | sample createdAt |
|---|---|---|---|---|---|---|
| KOL-10 | 2 | ✓ | ✓ | **yes** | agent | 2026-08-28T09:10:49.801Z |
| KOL-2  | 5 | ✓ | ✓ | **yes** | agent | 2026-08-28T09:16:59.203Z |
| KOL-1  | 4 | ✓ | ✓ | no  | agent | 2026-08-28T09:06:18.567Z |
| KOL-6  | 1 | ✓ | ✓ | no  | agent | 2026-08-28T09:07:34.977Z |
| KOL-12 | 1 | ✓ | ✓ | no  | user  | 2026-08-28T09:43:54.003Z |
| KOL-11 | 1 | ✓ | ✓ | no  | user  | 2026-08-28T09:40:47.315Z |
| KOL-5  | 1 | ✓ | ✓ | no  | agent | 2026-08-28T09:05:13.451Z |

KOL-10 and KOL-2's VERDICT comments are attributed to `authorAgentId`
`ce433688-4e0d-4902-addd-b7d27eb081b7` — GIBRAN's real Paperclip agent id. This
**confirms live** that Paperclip's comment history is a real, queryable audit
trail for material actions (TEST RESULT / VERDICT / OWNER decision records), with
real timestamps and authorship.

### ⚠ FLAGGED GAP — NOW FIXED (Phase 7 audit follow-up landed)

While probing the live API to complete this check, I discovered
`ops-watcher/watcher.mjs` fetched `` `${base}/issues` `` (bare route),
`` `${base}/issues/${id}/comments` `` (missing `/api` prefix), and
`` `${base}/issues/${id}/labels` `` (an endpoint that **does not exist** — 404
live + absent from the OpenAPI spec). On the live Paperclip instance the bare
`/issues` route returns the **SPA HTML shell**, not JSON, so `issue_count` was
silently always 0 and the `stuck-running` / `blocked-unnotified` /
`review-waiting` detectors could never fire against the live instance. This was
the single highest-impact item in the audit.

**FIX LANDED.** Verified against the live OpenAPI spec
(`GET http://127.0.0.1:3110/api/openapi.json`) and live curl by AHMAD, and
re-verified independently this session:

1. Issue list → `GET /api/companies/{companyId}/issues` (was bare `/issues`).
2. Issue comments → `GET /api/issues/{id}/comments` (was missing the `/api`
   prefix).
3. Issue labels → there is **no** `/api/issues/{id}/labels` endpoint. Labels are
   embedded directly on each issue object as `labelIds` (array of ids) AND
   `labels` (array of `{id,name,color,…}` objects). `fetchIssueLabels` was
   rewritten as a pure synchronous `deriveIssueLabels(it)` that reads off the
   issue object already in scope — zero network calls.

**Real before/after evidence (live `node ops-watcher/watcher.mjs --once`):**

`ops-watcher/events.jsonl` heartbeat payloads — same watcher, same live instance,
only the route fix between them:

```
# BEFORE (old, broken routes):
{"ts":1787898776252,"detector":"watcher-heartbeat",...,"payload":{...,"issue_count":0,"errors":[]}}

# AFTER (fixed routes):
{"ts":1787911872605,"detector":"watcher-heartbeat",...,"payload":{...,"paperclip_port":3110,...,"issue_count":19,"errors":[]}}
```

`issue_count` went from **0 → 19** (the real issue count, confirmed independently
via `GET /api/companies/a7011f31-…/issues` → 19-element JSON array). The sweep
now sees real issues, so the `stuck-running` / `blocked-unnotified` /
`review-waiting` detectors are no longer structurally dead.

**Cross-check (step 7 of the fix task):** the same wrong-route bug was searched
for in `paperclip-write-client.mjs`, `test-runner.mjs`, `review-runner.mjs`,
`cockpit-status.mjs`, `telegram-notify.mjs`, `telegram-listener.mjs`, and
`security-audit.mjs` by reading their actual route construction. **All of them
already use the correct `/api/...` routes** — AHMAD's belief was correct. The bug
was isolated to `watcher.mjs` alone (the only file that used bare `/issues`).
`paperclip-write-client.mjs`'s `listIssues`/`postComment`/`patchIssue`/`listLabels`
all use `/api/companies/{id}/issues`, `/api/issues/{id}/comments`, etc., and the
other runners route through those helpers (or construct the same `/api/...`
strings directly). No second file needed a route fix.

## 4. Adversarial guard test — RESULT: 9 blocked, 0 bypass (FIX LANDED)

`hatta/harness.mjs`'s `run_command` guard (`validateCommand` /
`hasForbiddenGitArgs` / `argContainsDeniedText` / `resolveWorkspacePath`) was
previously verified only by direct code review — never by actually trying to
trick it. This phase closes that with real, executable tests in
`hatta/harness.security.test.mjs` that call the **exported pure guard functions
directly** (no live Ollama dispatch spent). Real run output AFTER the fix:

```
PASS  | blocked  | git push --force origin main
PASS  | blocked  | git reset --hard HEAD~3
PASS  | blocked  | echo with sneaked 'rm ' fragment
PASS  | blocked  | argContainsDeniedText catches 'rm ' mid-string
PASS  | blocked  | path escape ../../Windows/System32
PASS  | blocked  | path escape absolute D:\Windows\System32
PASS  | blocked  | non-allowlisted command: curl
PASS  | blocked  | node -e fs.rmSync recursive (interpreter escape)
PASS  | blocked  | node -e base64-encoded 'rm -rf hatta' (encoding defeat)
SUMMARY: 9 blocked, 0 NOT blocked (bypass).   exit code: 0
```

### The 2 previously-confirmed bypasses — NOW BLOCKED

1. **Interpreter escape via `node -e` + `fs.rmSync`:**
   `validateCommand(\"node\", [\"-e\",\"require('fs').rmSync('hatta',{recursive:true,force:true})\"])`
   previously returned `{ok:true}` — `fs.rmSync` contains \"rm\" but not `\"rm \"`
   (no trailing space), so it slipped past the denylist, and the arg had no
   path-like characters. **Now blocked**: when `command` is `node` or `bun`, any
   args array containing `-e`/`--eval`/`-p`/`--print` is rejected.
2. **Encoding defeat via `node -e` + base64:**
   `validateCommand(\"node\", [\"-e\",\"require('child_process').execSync(Buffer.from('cm0gLXJmIGhhdHRh','base64').toString())\"])`
   previously returned `{ok:true}` — no banned literal in the arg. **Now blocked**
   by the same inline-eval flag rejection (`-e` is present).

**The fix (one bounded, additive mitigation):** added `hasInlineEvalFlag(args)`
and a check in `validateCommand` — when the command is `node` or `bun`, reject
any args containing `-e`/`--eval`/`-p`/`--print`. These flags are NEVER needed for
this harness's actual legitimate use, which is always
`node <script-file>.mjs [args]` (confirmed by inspection of every `run_command`
invocation across this codebase and every external script call — none use
`node -e`). So normal usage is unaffected.

**HONEST SCOPE LIMITATION (preserved, not erased):** this does NOT claim to make
the guard fully safe against arbitrary code execution. A substring denylist
cannot fully sandbox a general-purpose interpreter, and a script FILE can still
do anything Node can do once written and run — that has always been true and is
an accepted property of this harness, not a new gap. This fix specifically closes
the "smuggle arbitrary code past the denylist via inline eval" vector that
`harness.security.test.mjs` demonstrated; it is one bounded mitigation, not a
complete sandbox.

**Secondary finding, FIXED earlier (additive):** the guard functions were
previously not exported from `hatta/harness.mjs`, and `main()` ran
unconditionally on import — so direct unit testing was impossible without
triggering a live Ollama dispatch. Added `export` to the pure guard functions and
an `isEntry` guard around `main()` (mirroring the existing pattern in
`telegram-client.mjs` / `watcher.mjs`). CLI behavior is unchanged
(`node hatta/harness.mjs --selftest` still passes 4/4; importing now exposes the
functions with no dispatch).

## 5. Telemetry usefulness — RESULT: now capable of carrying signal (route fix landed)

Real content of `ops-watcher/events.jsonl`: heartbeats confirm the watcher
process is alive (liveness). With the §3 route fix landed, the heartbeat now
carries `issue_count: 19` (was 0), so the `stuck-running`, `blocked-unnotified`,
and `review-waiting` detectors are no longer structurally dead — they can now
emit actionable routing events when real issue state warrants. The log is
structurally sound (valid NDJSON, append-only, deterministic keys, dedupe,
restart recovery) and is now also *capable* of producing signal, not merely
confirming liveness.

---

## Changes made (all additive / read-only; no core runner behavior change beyond the two bounded fixes)

| File | Change | Why |
|---|---|---|
| `ops-watcher/watcher.mjs` | **FIX 1** — added `CANONICAL_COMPANY_ID` (documented deliberate duplicate of the constant in `paperclip-write-client.mjs`; not imported back to avoid a circular import); issue-list fetch → `/api/companies/{id}/issues`; `fetchIssueComments` → `/api/issues/{id}/comments` (added `/api`); replaced network-calling `fetchIssueLabels` with synchronous `deriveIssueLabels(it)` that reads `labels`/`labelIds` off the issue object (no `/api/issues/{id}/labels` endpoint exists). | Closes the highest-impact audit finding: watcher issue ingestion + review-waiting were non-functional live (`issue_count` always 0). Live before/after: 0 → 19 issues. |
| `ops-watcher/watcher.route-fix.test.mjs` | **NEW** — 5 offline tests for the route/labels fix (canonical-route vs bare-route mock, company-id drift detector, `deriveIssueLabels` inline/labelIds/empty). | Locks down FIX 1 so it cannot silently regress; `watcher.regression.test.mjs` stays at its existing 5/5. |
| `hatta/harness.mjs` | **FIX 2** — added `hasInlineEvalFlag` + a `validateCommand` check rejecting `-e`/`--eval`/`-p`/`--print` for `node`/`bun`. Honest scope-limitation comment preserved at the fix site. | Closes the 2 demonstrated inline-eval bypasses (9/9 blocked now). Normal `node <script>.mjs [args]` usage unaffected. |
| `hatta/harness.security.test.mjs` | (unchanged) — the 2 `bypassProbe` cases now report PASS (blocked) instead of FAIL. | The intentionally-red file is now green: the bypasses it demonstrated are closed. |
| `ops-watcher/SECURITY-AUDIT-REPORT.md` | Updated findings (§3, §4, §5, problems-found) to reflect both fixes landed, with real before/after evidence and the honest scope caveat preserved. | Keep the report's verdicts in sync with reality. |
| `hatta/harness.mjs` (earlier) | Added `export` to pure guard functions + `isEntry` guard + `fileURLToPath` import | Enables direct unit testing of the guard without a live dispatch. CLI behavior identical (selftest still 4/4). |
| `hatta/harness.security.test.mjs` (earlier) | **NEW** — 9 adversarial cases against the real exported guard functions | Closes the "verified only by code review, never by trying to trick it" gap. Now 9/9 blocked. |
| `ops-watcher/security-audit.mjs` (earlier) | **NEW** — read-only audit CLI (secrets, gitignore, audit trail, guard test, telemetry) + `isEntry` guard | Single entry point for the whole audit; every check real/executable. |
| `ops-watcher/security-audit.regression.test.mjs` (earlier) | **NEW** — 13 unit tests for the pure secret-matcher + a self-cleanliness guard | Meaningful pure logic (matcher/classifier) is unit-tested; I/O checks are run via the CLI directly. |
| `.gitignore` (earlier) | Appended `ops-watcher/security-audit.last-run.json` | Generated audit artifact echoes audit output; never track. |

## Problems found — fixed vs flagged

**FIXED:**
- **FIX 1 — `watcher.mjs` Paperclip route bug (was the highest-impact flagged
  item):** bare `/issues`, missing-`/api`-prefix `/issues/{id}/comments`, and a
  nonexistent `/issues/{id}/labels` endpoint → corrected to
  `/api/companies/{id}/issues`, `/api/issues/{id}/comments`, and a synchronous
  `deriveIssueLabels` off the issue object. Live `issue_count` 0 → 19. Cross-check
  confirmed no other file had the same bug.
- **FIX 2 — `hatta/harness.mjs` `run_command` inline-eval bypasses (were the 2
  confirmed bypasses):** `node -e`/`bun -e` with `fs.rmSync` or base64 payloads
  now rejected via `hasInlineEvalFlag`. 9/9 adversarial cases blocked. Honest
  scope-limitation caveat preserved (not a complete sandbox).
- Harness guard functions not exported + import triggered a live dispatch →
  exports + `isEntry` guard (additive, verified).
- `security-audit.mjs` import triggered its own `main()` (live Paperclip probe) →
  `isEntry` guard.
- Audit scanning its own stale generated artifact (recursive false positives) →
  `SKIP_NAMES` exclusion + gitignored the artifact.
- **Self-inflicted, caught by the audit's own self-scan guard:** the regression
  test's first draft embedded *real* secrets (the actual Telegram/GitHub/Notion/
  Cloudflare/pcp tokens from `.env.local`) into a tracked test file. The
  self-cleanliness test failed loudly, I replaced every real value with synthetic
  concatenated tokens (no contiguous regex match in source), and the guard now
  enforces zero REAL findings in the test file going forward.

**FLAGGED (not fixed — out of scope):**
- (none remaining from this audit's original findings. The two previously-flagged
  items — the watcher route bug and the harness inline-eval bypass — are both now
  FIXED above. The harness's general "a written script file can do anything Node
  can do" property remains an accepted, documented limitation, not a flagged gap.)

## What was deliberately NOT done

- Did **not** touch Telegram, the cockpit, or core runner logic behavior beyond
  the two bounded, specified fixes (FIX 1 watcher routes + labels; FIX 2 harness
  inline-eval flag rejection). No other runner behavior changed.
- Did **not** attempt to make the harness `run_command` guard a complete sandbox
  against arbitrary code execution — that is architecturally impossible with a
  substring denylist over general-purpose interpreters, and the fix honestly
  scopes itself to closing the two demonstrated inline-eval bypasses only.
- Did **not** install or recommend any paid tooling (no Promptfoo/Langfuse
  purchase, no new subscriptions). Everything is local Node, dependency-free.
- Did **not** create a Paperclip agent record for HATTA.
- Did **not** spend a live Ollama model dispatch on adversarial testing — used
  direct unit calls against the exported pure guard functions instead (per the
  task's explicit instruction).
- Did **not** fabricate evidence: the one check that is live-only (Paperclip
  comment spot-check + the watcher `--once` smoke) was completed for real against
  the live :3110 instance; the before/after `issue_count` 0 → 19 is real output
  from `ops-watcher/events.jsonl`, not invented.

## Verification commands (all run during this audit / fix, all green)

```
node hatta/harness.mjs --selftest                         → ok=true, 4/4 path-escape pass
node hatta/harness.security.test.mjs                      → 9 blocked, 0 bypass (exit 0)
node ops-watcher/security-audit.regression.test.mjs       → 13 passed, 0 failed
node ops-watcher/security-audit.mjs                       → 0 REAL secrets; audit trail confirmed live
node ops-watcher/watcher.mjs --selftest                   → SELFTEST OK (incl. deriveIssueLabels assertions)
node ops-watcher/watcher.regression.test.mjs              → 5 passed, 0 failed (unchanged)
node ops-watcher/watcher.route-fix.test.mjs               → 5 passed, 0 failed (NEW coverage for FIX 1)
node ops-watcher/watcher.mjs --once                       → issue_count 19 (was 0) — live, real
```