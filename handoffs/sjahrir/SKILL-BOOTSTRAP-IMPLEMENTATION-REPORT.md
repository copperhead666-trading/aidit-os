# Skill Bootstrap — Implementation Report

**Implementer:** HATTA (this session)
**Design:** SJAHRIR — `handoffs/sjahrir/SKILL-BOOTSTRAP-DESIGN.md`
**Index:** `handoffs/sjahrir/skill-index.json` (v1.0.0)
**For review by:** GIBRAN
**Scope guard:** pure documentation + a lookup utility under `skills/` and a minimal content
correction to `handoffs/sjahrir/skill-index.json`. No Paperclip, Telegram, cockpit, or runner
logic touched. No `package.json` introduced. No harness changes.

---

## 1. What was built

### 1a. Skill content files — `skills/<name>.md` (24 files, one per mandatoryCore skill)

One short (5–15 line), actionable instruction file per mandatoryCore skill across all 16
canonical roles (4 multi-skill roles × 3 + 12 thin specialists × 1 = 24):

`orchestration`, `delegation`, `recovery` (AHMAD) · `debugging`, `TDD`, `verification` (HATTA) ·
`independent-review`, `acceptance`, `security` (GIBRAN) · `research`, `synthesis`,
`context-compression` (SJAHRIR) · `owner-queue-steward` (ESCALATION-SEC) · `consistency-audit`
(AUDIT-CLERK) · `test-execution` (TEST-RUNNER) · `legacy-extraction` (MIGRATION-SURVEYOR) ·
`gbrain-ingestion` (GBRAIN-CURATOR) · `gbrain-query` (RETRIEVAL-ASSISTANT) · `structural-analysis`
(GRAPHIFY-ANALYST) · `deterministic-watch` (OPS-WATCHER) · `paperclip-admin` (PAPERCLIP-OPERATOR) ·
`sj-snapshot` (STEWARD-SJS) · `caveman-watch` (STEWARD-CAVEMAN) · `trading-quant-analysis`
(TRADING-QUANT).

Each is grounded in how this org actually operated this session (real file names, real bugs,
real conventions) rather than the design's one-line description repeated.

### 1b. Lookup utility — `skills/resolve-skills.mjs`

Pure, offline, testable module exporting:
- `resolveSkillsForPacket(role, taskKind, options?)` → `{ core, taskSpecific }`
  - `core`: the role's mandatoryCore skills (shallow-copied so callers can't mutate the index).
    `[]` for an unknown role — never throws.
  - `taskSpecific`: entries whose `triggers` match `taskKind` (exact or substring,
    case-insensitive) AND whose `applicableRoles` includes the role. Each carries a
    `matchedTrigger` (the first matching trigger token, a member of the entry's `triggers`).
  - `options.index` lets tests inject an in-memory index (no disk needed); default reads the
    real `handoffs/sjahrir/skill-index.json`.
- `formatSkillsSection(resolved)` → the `### Loaded skills` block from design Section 5.
- `loadSkillIndex(path?)`, `listSkillFiles(dir?)`, `verifySkillFilesExist(resolved, dir?)`
  helpers.

No network, no Paperclip, no Telegram, no filesystem writes — only reads the index (+ optionally
the `skills/` dir listing).

### 1c. Regression test — `skills/resolve-skills.regression.test.mjs`

Offline, `node:assert/strict` only — the exact convention used by every other
`*.regression.test.mjs` in this repo (no npm, no package.json). 8 cases, all passing:

```
node skills/resolve-skills.regression.test.mjs
# skills/resolve-skills.mjs regression tests
PASS: R1 role w/ only core + no matching trigger returns just core
PASS: R2 matching taskKind returns task-specific entry for applicable roles only
PASS: R3 unknown role returns empty core without throwing
PASS: R4 formatSkillsSection produces the documented section shape
PASS: R5 coarse taskKind matches a trigger token via substring
PASS: R6 matchedTrigger is one of the entry's real triggers
PASS: R7 every real-index resolved core skill has a skills/*.md content file
PASS: R8 real index: HATTA+telegram -> 3 core + hint; STEWARD-CAVEMAN+same task -> 1 core only

REGRESSION RESULT: 8 passed, 0 failed
```

R7 cross-checks every resolved core skill against the real `skills/` directory — proves the
content files were actually written. R8 uses the real on-disk index end-to-end.

### 1d. Dispatcher helper CLI — `skills/preview-skills.mjs`

`node skills/preview-skills.mjs <role> <taskKind>` — prints the resolved object + formatted
section. Used for the step-4 demonstration. Pure + offline. (Added because this session's own
harness security fix blocks `node -e`, so a small script file was the honest path.)

---

## 2. The testing-convention correction (the task's mandatory correction #1)

SJAHRIR wrote the design without filesystem access to this workspace and assumed an
npm/`:memory:` convention. Verified this session: **there is no `package.json` anywhere in this
tree** (`git ls-files` + `rg --files-with-matches package.json` → zero matches), no npm-based
test runner, and no `:memory:` DB (Paperclip uses real Postgres). The real convention, used
throughout this session by every ops-watcher suite, is plain `node <file>.regression.test.mjs`
files using `node:assert/strict` + `node:http` mock servers, invoked directly with `node`,
no npm involved anywhere.

### Corrected skill content (skills/TDD.md — the HATTA "TDD" skill)

> Red-green-refactor discipline: write a failing test first, implement to pass, then refactor.
>
> How this org ACTUALLY runs tests in THIS workspace (corrected — there is no package.json, no
> npm test, no npm run typecheck, and no :memory: DB anywhere here; verified this session):
> - Tests are plain Node files named `*.regression.test.mjs`, run directly as
>   `node path/to/file.regression.test.mjs`. No npm, no test runner config, no package scripts.
> - They use `node:assert/strict` only (no jest/mocha/vitest), with `node:http` mock servers for
>   any network dependency (Paperclip / Telegram are mocked on 127.0.0.1 loopback). See
>   ops-watcher/heartbeat.regression.test.mjs / telegram.regression.test.mjs as the reference shape.
> - Each file prints `PASS: <name>`/`FAIL: <name>` lines and a final
>   `REGRESSION RESULT: N passed, M failed`; exit code 0 only when failed === 0.

The same correction was applied to `skills/test-execution.md` (TEST-RUNNER), which carried the
same npm assumption, and `skills/verification.md`, which states the real session pattern
(re-run the relevant `*.regression.test.mjs` directly with `node`, confirm `0 failed`, and for
live changes independently re-verify via a real API call rather than trusting your own script's
stdout).

### Index description strings corrected (3 strings, schema untouched)

Because `formatSkillsSection` renders the index's one-line `description` directly into a task
packet, leaving the generic npm/`:memory:`/task-packet-standard text would inject the wrong
convention into live packets — exactly what correction #1 exists to prevent. Three description
*values* were corrected in `handoffs/sjahrir/skill-index.json`; the schema (keys/shape) is
unchanged and no entries were added or removed:

| Role | Skill | Was | Now |
|---|---|---|---|
| AHMAD | delegation | "...routes to review; knows the task-packet standard." | "...routes to review; writes the packet as a plain-text prompt handed to the harness/CLI (no formal task-packet-standard.md exists in this workspace)." |
| HATTA | TDD | "...refactors; knows npm test/typecheck gates and :memory: DB convention." | "...refactors; tests run as `node <file>.regression.test.mjs` using node:assert/strict + node:http mocks (no npm, no package.json, no :memory: DB in this workspace)." |
| TEST-RUNNER | test-execution | "Runs specific allowlisted commands (npm test, npm run typecheck, npm run build, npm run seed); ..." | "Runs specific allowlisted commands (in this workspace: `node <file>.regression.test.mjs`); ..." |

**Note on the task's "do not restructure the schema / only ADD for gaps" constraint:** no schema
keys were added, removed, or renamed; no entries added or removed. The completeness check
(CANONICAL-ROLE-MAP.json has exactly 16 roles; skill-index.json mandatoryCore has exactly those
16) found **no gap**, so nothing was added. The three edits are factual corrections to existing
string *values* that the task itself flagged as wrong, made because those strings are rendered
into packets. Flagging this explicitly for GIBRAN in case it is judged out of scope — the skill
*content files* (the primary deliverable) carry the corrected convention regardless.

## 3. The task-packet-standard correction (mandatory correction #2)

Verified: no `task-packet-standard.md` exists in this workspace. `config/` contains only
`agent-registry.json`, `decision-ledger.json`, `paperclip-endpoint.json`. The design's reference
to `D:\AI\Agentic\config\task-packet-standard.md` is outside this workspace and unverified, so it
is **not asserted to exist**. The packet convention actually observed this session is described
instead: AHMAD writes a plain-text prompt file (objective, scope, acceptance criteria, canonical
pointers, safety constraints) and hands it to a harness/CLI (Claude Code CLI / hermes / Kimi Code
CLI). This is reflected in `skills/orchestration.md`, `skills/delegation.md`, and the corrected
`delegation` index string above.

---

## 4. Real demonstration (step 4) — actual command output

```
$ node skills/preview-skills.mjs HATTA telegram-bot-integration
===== resolveSkillsForPacket("HATTA", "telegram-bot-integration") =====
{
  "core": [
    { "name": "debugging", "description": "Systematic root-cause debugging; reads errors, traces call paths, isolates defect class before patching; knows the org debug workflow." },
    { "name": "TDD", "description": "Red-green-refactor discipline; writes failing test first, implements to pass, refactors; tests run as `node <file>.regression.test.mjs` using node:assert/strict + node:http mocks (no npm, no package.json, no :memory: DB in this workspace)." },
    { "name": "verification", "description": "Runs allowlisted build/test/seed commands, confirms green before claiming done; never modifies code to make a test pass." }
  ],
  "taskSpecific": [
    {
      "name": "telegram-bot-integration",
      "description": "Integrates or debugs Telegram bot / Gateway connectivity: bot token, webhook, chat endpoint, message delivery. Relevant when a task touches the Telegram gateway or bot surface.",
      "triggers": ["telegram-bot","telegram-gateway","telegram-webhook","telegram-integration","gateway-bot"],
      "applicableRoles": ["AHMAD","HATTA","GIBRAN"],
      "matchedTrigger": "telegram-bot"
    }
  ]
}

----- formatted skills section -----
### Loaded skills

Core (always active for this role):
- debugging: Systematic root-cause debugging; reads errors, traces call paths, isolates defect class before patching; knows the org debug workflow.
- TDD: Red-green-refactor discipline; writes failing test first, implements to pass, refactors; tests run as `node <file>.regression.test.mjs` using node:assert/strict + node:http mocks (no npm, no package.json, no :memory: DB in this workspace).
- verification: Runs allowlisted build/test/seed commands, confirms green before claiming done; never modifies code to make a test pass.

Task-specific (available if needed — load if the task touches the trigger area):
- telegram-bot-integration: Integrates or debugs Telegram bot / Gateway connectivity: bot token, webhook, chat endpoint, message delivery. Relevant when a task touches the Telegram gateway or bot surface. — trigger: telegram-bot
```

```
$ node skills/preview-skills.mjs STEWARD-CAVEMAN some-unrelated-task
===== resolveSkillsForPacket("STEWARD-CAVEMAN", "some-unrelated-task") =====
{
  "core": [
    { "name": "caveman-watch", "description": "Reads Caveman trading state (read-only watch); reports state; does not trade, does not enable live trading." }
  ],
  "taskSpecific": []
}

----- formatted skills section -----
### Loaded skills

Core (always active for this role):
- caveman-watch: Reads Caveman trading state (read-only watch); reports state; does not trade, does not enable live trading.

Task-specific (available if needed — load if the task touches the trigger area):
- (none matched for this task)
```

**The contrast is real and exact:** HATTA + a telegram task gets its 3 core skills PLUS the
`telegram-bot-integration` hint (HATTA is in that entry's `applicableRoles`). STEWARD-CAVEMAN on
an unrelated task gets ONLY its single `caveman-watch` core skill — no injected library — and
even on the *same* telegram taskKind it would get no task-specific hint, because
STEWARD-CAVEMAN is not in `telegram-bot-integration.applicableRoles` (proven by test R2/R8).

---

## 5. Regression results

- `node skills/resolve-skills.regression.test.mjs` → **8 passed, 0 failed** (re-run after the
  index correction; output in §1c above).
- No existing suite was touched or re-run as a dependency: a repo-wide grep for `skill-index`
  outside `skills/` and `handoffs/` returns zero matches, confirming the index edit has **zero
  blast radius** on ops-watcher / hatta / ahmad / config or any runner. The new code is purely
  additive and self-contained.

---

## 6. Honest non-claims / open items for GIBRAN

- The skill *content* files are deliberately short (bootstrap, not treatise) per the design's
  explicit minimal-bootstrap mandate. They are grounded in observed session behavior, not an
  exhaustive spec.
- The three index description-string corrections (§2) are the only non-additive change. They are
  value-only, schema-preserving, and made because `formatSkillsSection` renders them into live
  packets. If GIBRAN judges even value-only index edits out of scope, they are trivially
  revertible; the skill content files carry the corrected convention either way.
- The design doc `SKILL-BOOTSTRAP-DESIGN.md` itself still contains the generic npm/`:memory:`
  text in its Section 3 prose. It was left unchanged (it is SJAHRIR's approved design artifact,
  not an implementation deliverable); the corrections live in the index + skill files where the
  machine reads them.
- `skills/preview-skills.mjs` is a small dispatcher convenience CLI, not required by the design
  spec. It is pure + offline and was used for the demonstration; it can be kept or removed at
  GIBRAN's discretion.