# PACKET-MERGE-STEWARD-S1 — a steward that verifies a lane diff without a session

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

## WRITE PLAIN ASCII HYPHENS, NOT EM-DASHES

Use `-` and `--` in every comment and string you write. Do not type the em-dash
character. This is not style: your `apply_patch` tool failed twice today on files
containing em-dashes, reporting them as mojibake and refusing the edit, and both
of those runs then died at the 480-second wall retrying. Plain hyphens cost you
nothing and save the run.

---

## Why this exists

Three layers carry work in this system. Two already run without a Claude session:
decisions reach the owner on Telegram and come back, and `directive-runner`
plans, asks, executes and reverts on the heartbeat. The third does not. Verifying
a lane's diff and merging it to `main` still requires a person or a session, so
finished lane work waits.

This packet builds the verification half. It **reports**; it does not merge.
Merging is a write to `main` and stays gated. A steward that also merged would be
a second integrator nobody approved.

---

## Files you may create - and no others

- `ops-watcher/merge-steward.mjs` (NEW)
- `ops-watcher/merge-steward.regression.test.mjs` (NEW)

**Do not edit any existing file.** Not the heartbeat, not a dispatcher, not
`package.json`. Wiring this into the heartbeat is a later packet.

---

## What it must do

```
node ops-watcher/merge-steward.mjs --once            # human summary, exit 0
node ops-watcher/merge-steward.mjs --once --json     # one JSON object on stdout
```

### 1. Find the lane worktrees that are carrying work

Use `listLaneWorktrees()` from `ops-watcher/lane-worktree.mjs` - it already parses
`git worktree list --porcelain` and returns `[{ path, branch }]`, and it never
throws. For each worktree that is not the main checkout, gather:

- `branch`
- `uncommitted`: the count from `dirtyEntryCount(path)` in the same module
  (null means git could not be asked, which is different from zero and must stay
  different)
- `aheadOfMain`: how many commits the branch has that `origin/main` does not
- `changedFiles`: the paths changed against `origin/main`, including uncommitted
  ones

Every git call must go through `execFileSync` with `windowsHide: true` and must
begin with `-c safe.directory=<cwd>`, exactly as `lane-worktree.mjs` does it. A
lane worktree can be owned by a different user when a dispatcher ran under a
sandbox account, and without that flag `git status` refuses with "dubious
ownership" and dirt reads as invisible.

A worktree with no commits ahead and no uncommitted entries is reported as
`idle` and nothing further is run for it.

### 2. Run the checks, each one named and independent

Export each as a pure function so the suite can drive it with fixtures. Each
returns `{ name, ok, detail }` and NEVER throws.

| name | fails when |
|---|---|
| `syntax` | any changed `.mjs` fails `node --check` |
| `forbidden-paths` | the diff touches `.claude/settings.json`, any `.claude/**` hook or permission file, any `.env*`, or anything under `ventures/` |
| `tests-accompany-behaviour` | a non-test `.mjs` under `ops-watcher/` or `hatta/` changed and no `*.test.mjs` changed with it |
| `secret-shaped-literals` | an added line contains a long literal that looks like a credential (a 32+ character run of base64/hex, a `ghp_`/`sk-`/`pcp_` prefix, or an assignment to a name containing token/secret/key/password) |
| `suite` | the full suite does not pass in that worktree |

For `suite`, run the pinned Node explicitly:
`D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs`
with `cwd` set to the worktree. System Node v26 crashes at teardown AFTER the
tests pass and the runner counts that as a failed suite, so a steward that used
whatever `node` it found would report false failures forever. Parse the final
`SUITES: N/M passed` line; if that line is absent the check fails with a detail
saying the suite produced no verdict, never "passed".

The suite is the slow check. Run it LAST, and only when every other check
passed - there is no point paying three minutes to confirm a diff that already
touches `.env`.

### 3. The verdict

Per worktree: `verdict` is `"clean"` when every check passed, `"blocked"` when
any failed, `"idle"` when there was nothing to check. Include the check list so a
reader sees which one decided it.

Nothing in this module may run `git commit`, `git merge`, `git push`,
`git reset`, `git checkout`, `git clean`, or delete a file. Read and report only.

### 4. Honest failure

If git cannot be asked, or a worktree path is gone, that worktree is reported
with `verdict: "unknown"` and a reason. Never report "clean" for something that
could not be inspected: silence and success must not look the same.

---

## Tests - required

Nothing may run a real suite, spawn a real dispatcher, or touch a real worktree.
Inject `execFileSync` and the suite runner.

1. A worktree with no commits ahead and zero uncommitted entries is `idle`, and
   no suite run is attempted for it.
2. `dirtyEntryCount` returning null is NOT treated as clean; the worktree is
   `unknown`, with a reason.
3. `forbidden-paths` fails for `.claude/settings.json`, for `.env.local`, and for
   `ventures/caveman-trading-os/README.md`, and passes for `ops-watcher/x.mjs`.
4. `tests-accompany-behaviour` fails when `ops-watcher/foo.mjs` changed alone,
   passes when `ops-watcher/foo.mjs` and `ops-watcher/foo.regression.test.mjs`
   changed together, and passes when only a `.md` changed.
5. `secret-shaped-literals` fails on an added line assigning a 40-character hex
   run to a name containing `token`, and does not fire on ordinary code such as a
   long import path or a sha in a comment.
6. `suite` fails when the runner output contains no `SUITES:` line at all, with a
   detail saying no verdict was produced.
7. `suite` passes on `SUITES: 85/85 passed` and fails on `SUITES: 84/85 passed`.
8. The slow check is skipped entirely when an earlier check already failed:
   assert the injected suite runner was never called.
9. Every check returns a result rather than throwing when its input is hostile:
   null, undefined, a number, an array, an enormous string.
10. The module exports nothing that mutates: assert that the exported surface
    contains no function whose name matches `/merge|commit|push|reset|clean/i`.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 85/85 right now. It must be 86/86 after your new file.

## Budget

Your prompt carries a stated wall and nothing you have not written to disk
survives it. Two files, and you may not touch any existing one, so this should
fit. If it does not: land `merge-steward.mjs` with the checks and their tests,
say plainly that the worktree enumeration is not done, and stop.

## Deliver

1. What it checks and what it refuses to do, in a few sentences.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push. Do not edit an existing file.
