# PACKET-KOL89-P1 — `sourceRepo` for lane worktrees (mechanism only)

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

You are working inside your own git worktree. The integrator commits and merges,
not you.

---

## Why this exists

No writing lane can read `ventures/`. Every lane runs inside a git worktree cut
from the Aidit OS repository, and a worktree only contains tracked files.
`ventures/` is gitignored on purpose — the ventures are separate git
repositories with their own history — so their contents never come along.
CORLEONE, HATTA and SJAHRIR are therefore structurally blind to the ventures
they are supposed to work on. That is KOL-89, and it is the largest blocker in
the system.

As of 2026-09-06 both venture repositories are real directories inside
`ventures/`, each with its own `.git`, moved there on the owner's instruction:

```
ventures/caveman-trading-os   git repo, branch main,              no lane/* branches yet
ventures/sjs-superapps        git repo, branch feature/agentic-v1, no lane/* branches yet
```

The fix is that a lane worktree should be able to be cut from a **venture**
repository instead of from Aidit OS. This packet builds only that mechanism.
Nothing calls it yet — the wiring that decides *which* repo a packet belongs to
is a separate packet. Build the capability; do not wire it up.

---

## Files you may edit — no others

- `ops-watcher/lane-worktree.mjs`
- `ops-watcher/lane-worktree.regression.test.mjs`

Do not touch any dispatcher, `config/ventures.json`, `ops-watcher/ventures.mjs`,
`.gitignore`, or `CLAUDE.md`.

---

## Required behaviour

### 1. `worktreePathFor(lane, opts)` learns about a source repo

Today it returns `<root>/lane-<lane>`. Add an optional `sourceRepo` to its
options object. When `sourceRepo` is given, the path becomes:

```
<root>/<repo-directory-name>/lane-<lane>
```

`<repo-directory-name>` is the LAST path segment of `sourceRepo`, sanitised
exactly the way a lane name is sanitised today — lowercased, and every character
outside `[a-z0-9_-]` replaced with `-`. That sanitising is a boundary, not
cosmetics: a raw path segment must never be able to introduce a separator or a
`..` and walk out of `WORKTREE_ROOT`.

When `sourceRepo` is absent, the returned path is **byte-identical to today's**:
`<root>/lane-<lane>`. This is the single most important property in the packet.

### 2. `ensureLaneWorktree(lane, deps)` accepts `deps.sourceRepo`

- Resolve the repository the worktree is cut from as
  `path.resolve(deps.sourceRepo || deps.repoRoot || REPO_ROOT)`.
  With no `sourceRepo`, behaviour is unchanged.
- Pass that resolved path as the `cwd` of the `git worktree add` call, so the
  worktree is cut from the venture repository, not from Aidit OS.
- Compute the target with the repo-specific path from item 1, so a venture
  worktree and an Aidit OS worktree for the SAME lane cannot collide in one
  directory.
- The branch name stays `lane/<lane>`. Do **not** put the repo name in the
  branch. A venture's `lane/corleone` and Aidit OS's `lane/corleone` are branches
  in two different repositories and cannot collide.
- The failure fallback path must be the **resolved source repo**, not
  `REPO_ROOT`. A venture lane that cannot get a worktree must fall back into the
  venture, not silently land in the Aidit OS checkout and start editing the
  wrong repository. Keep `isolated: false` and keep saying why in `reason`.
- Keep `ensureLaneWorktree`'s NEVER THROWS contract exactly as it is.
- Keep the `-c safe.directory=<cwd>` prefix on every git call. It is there
  because lane worktrees can be owned by a different user when the dispatcher
  runs under a sandbox account, and without it `git status` refuses with
  "dubious ownership" and dirt reads as invisible.

### 3. A `sourceRepo` that is not usable must degrade honestly

A path that does not exist, or exists but is not a git repository, must produce
the same visible fallback as any other failure: `isolated: false`, `path` set to
the resolved source repo, and a `reason` that names what went wrong. It must not
throw, and it must not quietly fall back to Aidit OS — a silent fallback here
would put a lane in the wrong repository with no trace in the log, which is
worse than no isolation at all.

---

## Tests — required, not optional

Add to `ops-watcher/lane-worktree.regression.test.mjs`. Every git call in that
file is already injected; nothing there creates, moves or deletes a real
worktree, and your additions must keep it that way. **Do not create a real
worktree in a venture from a test** — those are the owner's repositories with
their own remotes.

Cover at least:

1. **No `sourceRepo` changes nothing.** `worktreePathFor("corleone")` and
   `ensureLaneWorktree("corleone", ...)` produce exactly the path they produce
   today, and the git call still uses the Aidit OS root as its cwd. Assert the
   old path literally, so a future change cannot move it unnoticed.
2. `worktreePathFor("corleone", { sourceRepo: "D:\\AI\\Aidit OS\\ventures\\caveman-trading-os" })`
   resolves under `<root>/caveman-trading-os/lane-corleone`.
3. The `git worktree add` invocation runs with the **source repo** as cwd, not
   `REPO_ROOT`. Assert on the recorded cwd of the injected exec.
4. The branch argument is still `lane/corleone` when a `sourceRepo` is given.
5. When worktree creation fails with a `sourceRepo` given, the returned `path`
   is the resolved source repo, `isolated` is `false`, and `reason` is
   non-empty.
6. A `sourceRepo` whose last segment contains characters outside `[a-z0-9_-]`
   (for example a path ending in `SJS Super Apps`, or one ending in `..`) still
   yields a single safe directory segment, and the resolved target stays inside
   `<root>`. Assert containment, not just the string.
7. Every git call still begins with `-c safe.directory=`.

Prior art, take it or leave it: an earlier HATTA run started this and got as far
as one helper before it ran out of clock. Its shape was a
`sourceRepoDirectoryName(sourceRepo)` function that splits on `[\\/]+`, takes the
last non-empty segment, and applies the same sanitising as a lane name. You are
free to use that shape or a better one; the requirement is the behaviour above,
not the helper.

---

## Verify, and paste what you actually saw

Use the pinned Node, not system Node. System Node v26 crashes at teardown AFTER
tests pass, and the runner counts that as a failed suite.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-worktree.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The full suite is **84/84** before your change. It must still be 84/84 after,
with your new cases inside the lane-worktree suite.

---

## Budget

Your prompt now carries a stated time budget, and it is real: the wrapper kills
this run at that wall and nothing you have not written to disk survives. This
packet is deliberately one module and its suite, sized to land inside it. If you
find yourself past half the budget still exploring, stop and write.

## Deliver

1. What changed, in behaviour terms, in a few sentences.
2. The exact test output — both commands, pasted, not summarised.
3. Anything you found that contradicts this packet. If the packet is wrong, say
   so instead of working around it silently.

Do not commit. Do not push. Do not edit files outside the two listed above.
