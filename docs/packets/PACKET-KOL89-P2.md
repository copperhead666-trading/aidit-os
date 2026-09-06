# PACKET-KOL89-P2 — route a venture packet into a venture worktree

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

Depends on P1, which is already merged: `ensureLaneWorktree(lane, deps)` accepts
`deps.sourceRepo` and cuts the worktree from that repository, filing it under
`worktrees/<repo-directory-name>/lane-<lane>`. P1 built the capability and
deliberately wired nothing to it. This packet is the wiring.

---

## Why this exists

A lane can now be given a venture repository to work in, but nothing decides
when to give it one. Until something does, KOL-89 is only half closed: the
mechanism exists and every dispatch still lands in Aidit OS.

The signal already exists and is already carried. `venture-planner.mjs` embeds
two lines at the top of every venture directive body
(`ops-watcher/venture-planner.mjs`, in `buildDirectiveIssue`):

```
VENTURE_ID: caveman-trading-os
REPO: ventures/caveman-trading-os
```

and `config/ventures.json` maps an id to its `repoPath`, read by
`ops-watcher/ventures.mjs` (`ventureById`, `activeVentures`). Both venture
repositories are real directories under `ventures/` as of 2026-09-06.

---

## Files you may edit — no others

- `ops-watcher/lane-source-repo.mjs` (NEW)
- `ops-watcher/lane-source-repo.regression.test.mjs` (NEW)
- `ops-watcher/corleone-dispatch.mjs`
- `ops-watcher/sjahrir-dispatch.mjs`
- `ops-watcher/hatta-dispatch.mjs`
- the three matching `*.regression.test.mjs` files

Do not touch `ops-watcher/lane-worktree.mjs`, `ops-watcher/ventures.mjs`,
`config/ventures.json`, `ops-watcher/venture-planner.mjs`, or SOEKARNO.
SOEKARNO is read-only and already runs in the main checkout, where `ventures/`
is present; it needs nothing from this packet.

---

## Required behaviour

### 1. One resolver, in one place

Create `ops-watcher/lane-source-repo.mjs`. Three dispatchers must not each grow
their own copy of this rule — one predicate in three places is the disease this
repository keeps having to cure.

```js
export function ventureIdFromPrompt(prompt)          // -> string | null
export async function sourceRepoForPrompt(prompt, deps = {})
                                                     // -> { sourceRepo, ventureId, reason }
```

`ventureIdFromPrompt` reads the first `VENTURE_ID:` line in the prompt and
returns the id. No match, or an empty value, returns null.

`sourceRepoForPrompt` resolves that id through the registry and returns
`{ sourceRepo, ventureId, reason }` where `sourceRepo` is an absolute path, or
`null` when the packet is not venture work or the venture cannot be used.
`reason` always says which case happened, in one short sentence, because every
one of these is something a reader of the log will need to tell apart.

### 2. The registry decides, and only the registry

- No `VENTURE_ID:` in the prompt → `{ sourceRepo: null, reason: "not venture work" }`.
  This is the common case and must stay completely silent in the log.
- An id that is not in `config/ventures.json` → `sourceRepo: null`, and the
  reason names the unknown id.
- An id whose venture is present but **not `status: "active"`** → `sourceRepo:
  null`, and the reason says the venture is not active. A directory under
  `ventures/` is not consent to work on it; `ventures.mjs`'s own header says the
  registry and its status field are the only consent there is. Use
  `activeVentures` or check the status explicitly — do not infer it.
- An active venture whose `repoPath` does not exist on disk, or exists without a
  `.git`, → `sourceRepo: null`, and the reason says the repository is missing.
  A lane pointed at a path that is not a repository would fall back into that
  path and start writing loose files into it.
- Otherwise → `sourceRepo` = the absolute resolved `repoPath` under the repo
  root, with the reason naming the venture.

### 3. The three writing dispatchers use it

In `corleone-dispatch.mjs`, `sjahrir-dispatch.mjs` and `hatta-dispatch.mjs`,
resolve the source repo from the prompt before calling `ensureLaneWorktree`, and
pass it through:

```js
const source = await sourceRepoForPrompt(prompt);
const workspace = ensureLaneWorktree("<lane>", source.sourceRepo ? { sourceRepo: source.sourceRepo } : {});
```

- When a venture IS resolved, write one line to stderr naming the venture and
  the worktree path. A lane silently working in a different repository than the
  reader expects is exactly the class of bug worktree isolation exists to
  prevent, and the existing `isolated` / `dirty` lines set the precedent: say
  which tree you are in.
- When the prompt names a venture that cannot be used, write one line to stderr
  with the reason and continue in Aidit OS. Do not refuse the dispatch: the
  packet may still be legitimate work on the OS side, and a lane that will not
  start is worse than one that starts in the tree it has always started in.
- The resolver must not be able to fail the dispatch. If it throws for any
  reason, treat it as "not venture work", say so on stderr, and carry on.

### 4. HATTA has one extra step, and it matters

`hatta-dispatch.mjs` runs the harness **inside** the workspace
(`harnessScriptFor`), because `hatta/harness.mjs` derives its path jail from its
own location rather than from its cwd. A venture worktree contains the venture's
files, not Aidit OS's, so there is no `hatta/harness.mjs` inside it.
`harnessScriptFor` already handles this: it falls back to the shared harness and
says so loudly, with the words "writes the SHARED tree". Do not weaken that
warning and do not silence it. Add a test proving that a venture workspace still
produces the loud non-isolated fallback, so the day someone changes it, the test
says what is lost.

---

## Tests — required, not optional

Everything is injected; no test may create a real worktree, read the real
`config/ventures.json`, or touch a venture repository.

For `lane-source-repo.regression.test.mjs`:

1. A prompt with no `VENTURE_ID:` resolves to null and a "not venture work"
   reason.
2. A prompt containing `VENTURE_ID: caveman-trading-os` resolves to the absolute
   path of that venture's `repoPath`.
3. An unknown id resolves to null and the reason names the id.
4. A venture present in the registry with `status` other than `"active"`
   resolves to null. Assert this one explicitly and by status, not by absence.
5. A venture whose directory or `.git` is missing resolves to null with a reason
   that says so.
6. A prompt with several `VENTURE_ID:` lines uses the first and does not throw.
7. Hostile input — empty string, null, a very long line, a value containing
   path separators or `..` — never throws and never returns a path outside the
   repository root.

For each dispatcher suite:

8. A venture prompt reaches `ensureLaneWorktree` with `sourceRepo` set; a plain
   prompt reaches it with no `sourceRepo` at all, and today's behaviour is
   unchanged. Assert both, with the injected `ensureLaneWorktree` recording its
   arguments.
9. A resolver that throws does not stop the dispatch.
10. (HATTA only) a venture workspace yields `harnessScriptFor(...).isolated ===
    false` and a reason still containing "writes the SHARED tree".

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-source-repo.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The full suite is 84/84 plus whatever P1 added. It must be that number plus your
new file after your change, with no suite failing.

## Budget

Your prompt carries a stated time budget and it is a hard wall — nothing you
have not written to disk survives it. If you are past half the budget and still
exploring, stop and write. If this packet does not fit, land item 1 and item 2
with their tests, say plainly that the dispatcher wiring is not done, and stop.
A resolver with tests and no callers is a usable half; three half-wired
dispatchers are not.

## Deliver

1. What changed, in behaviour terms.
2. The exact test output, pasted.
3. Anything that contradicts this packet.

Do not commit. Do not push. Do not edit files outside the list above.
