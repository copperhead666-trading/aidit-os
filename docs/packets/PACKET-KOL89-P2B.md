# PACKET-KOL89-P2B — tests only, for work that already exists

Role: CORLEONE. **Write tests. Do not change any implementation. Do not commit.**

---

## What already exists in your worktree

A previous run of yours built the implementation and hit the 480-second wall
before writing a single test. Everything below is already in your working tree,
uncommitted, and the full suite is **84/84 green** with it in place. **Do not
rebuild it. Do not "improve" it. Do not reformat it.**

`ops-watcher/lane-source-repo.mjs` (new, 82 lines):

```
export const REPO_ROOT
export function ventureIdFromPrompt(prompt)            -> string | null
export async function sourceRepoForPrompt(prompt, deps = {})
       -> { sourceRepo, ventureId, reason }
```

`sourceRepoForPrompt` returns, in this order:

| case | sourceRepo | reason |
|---|---|---|
| no `VENTURE_ID:` line | null | `not venture work` |
| registry read throws | null | `venture <id> could not be read from the registry` |
| id not in the registry | null | `unknown venture <id>` |
| `status !== "active"` | null | `venture <id> is not active` |
| empty `repoPath`, or a path resolving outside REPO_ROOT | null | `venture <id> repository is missing` |
| directory or `.git` absent | null | `venture <id> repository is missing` |
| otherwise | absolute path | `venture <id> repository selected` |

Injectable deps: `deps.ventureById`, `deps._fs` (needs `stat`), `deps.repoRoot`,
`deps.ventureDeps`.

The three dispatchers each now resolve the source repo before building the
workspace, in the same shape:

```js
let source;
try { source = await _sourceRepoForPrompt(prompt); }
catch (err) { source = { sourceRepo: null, ventureId: null, reason: `source repo resolver failed; treating as not venture work: ${msg}` }; ... }
if (!source || typeof source !== "object") source = { sourceRepo: null, ventureId: null, reason: "not venture work" };
const workspace = _ensureLaneWorktree("<lane>", source.sourceRepo ? { sourceRepo: source.sourceRepo } : {});
if (source.sourceRepo) stderr(`<lane>-dispatch: ${source.reason}; worktree ${workspace.path}\n`);
else if (source.ventureId) stderr(`<lane>-dispatch: ${source.reason}; continuing in Aidit OS\n`);
```

`hatta-dispatch.mjs` was additionally refactored so this is testable at all:
`main()` became `export async function dispatchHatta(prompt, deps = {})`, which
RETURNS `{ ok, timedOut, stdout, stderr, exitCode, runId }` instead of calling
`process.exit`. `main()` still exists, still reads `process.argv[2]`, and still
exits with `result.exitCode`. Injectable deps include `spawnSync`,
`guardLaneStart`, `recordLaneOutcome`, `logLaneUsage`, `ensureLaneWorktree`,
`sourceRepoForPrompt`, `harnessScriptFor`, `readHarnessEvidence`, `stdout`,
`stderr`, `now`, `timeoutMs`, `harnessBudgetMs`, `runId`.

`corleone-dispatch.mjs` and `sjahrir-dispatch.mjs` gained
`deps.sourceRepoForPrompt` and `deps.ensureLaneWorktree` alongside their
existing injectable deps.

---

## Files you may edit — no others

- `ops-watcher/lane-source-repo.regression.test.mjs` (NEW)
- `ops-watcher/corleone-dispatch.regression.test.mjs`
- `ops-watcher/sjahrir-dispatch.regression.test.mjs`
- `ops-watcher/hatta-dispatch.regression.test.mjs`

**If a test fails, report it. Do not fix the implementation to make it pass** —
a failing test here is a finding, and this packet is not authorised to change
behaviour. Say what failed and stop.

---

## Tests to write

Nothing may read the real `config/ventures.json`, touch a venture repository,
create a worktree, or spawn anything. Inject everything.

### `lane-source-repo.regression.test.mjs`

1. No `VENTURE_ID:` in the prompt → `sourceRepo: null`, reason `not venture work`.
2. `VENTURE_ID: caveman-trading-os` with an injected registry returning
   `{ id, status: "active", repoPath: "ventures/caveman-trading-os" }` and an
   injected `_fs` whose `stat` succeeds → `sourceRepo` equals
   `path.resolve(repoRoot, "ventures/caveman-trading-os")`.
3. An id absent from the registry → null, and the reason contains the id.
4. A venture with `status: "paused"` (and any other non-active value) → null,
   reason says not active. Assert this by status, explicitly — a venture
   directory is not consent to work on it, only the registry's status is.
5. `_fs.stat` rejecting for the repository, and rejecting for its `.git`, both →
   null with a "repository is missing" reason.
6. A `repoPath` of `"../outside"` → null. Assert the resolver refuses to point a
   lane outside REPO_ROOT.
7. Several `VENTURE_ID:` lines → the FIRST is used, no throw.
8. Hostile input: `""`, `null`, `undefined`, a number, a 100 000-character line,
   a value containing `\` and `/` and `..`. None throws; none returns a path
   outside REPO_ROOT.
9. A `ventureById` that throws → null, reason says the registry could not be
   read, and nothing propagates.

### Each dispatcher suite

10. A venture prompt reaches `ensureLaneWorktree` with
    `{ sourceRepo: <path> }`; assert on the recorded second argument of the
    injected `ensureLaneWorktree`.
11. A plain prompt reaches `ensureLaneWorktree` with an argument carrying **no**
    `sourceRepo` key at all. Today's behaviour must be provably unchanged.
12. An injected `sourceRepoForPrompt` that throws does not stop the dispatch:
    the lane still spawns, in the Aidit OS worktree.
13. (HATTA only) with a venture workspace, `harnessScriptFor` still reports
    `isolated: false` and a reason containing "writes the SHARED tree". A venture
    worktree has no `hatta/harness.mjs` in it, so the shared harness runs and
    jails to the shared tree — that warning is the only thing standing between a
    reader and a wrong assumption. Prove it is still there.
14. (HATTA only) `dispatchHatta` returns `exitCode: 3` with `skipped: true` when
    the lane guard says skip, and does not spawn. The refactor turned
    `process.exit(3)` into a return value; prove the code survived the change.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-source-repo.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 84/84 right now. It must be 85/85 after your new file, with every
suite passing.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. This packet
is tests only and should fit comfortably. If it does not, land
`lane-source-repo.regression.test.mjs` complete with its nine cases first, say
plainly that the dispatcher assertions are not written, and stop.

## Deliver

1. The exact test output, pasted.
2. Any test you wrote that FAILED, quoted, with no attempt to fix the code.

Do not commit. Do not push. Do not touch any implementation file.
