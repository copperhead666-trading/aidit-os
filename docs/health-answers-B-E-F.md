# Health diagnosis — answers for domains B, E and F

Answered 2026-09-05 at commit `f251044`, on LENOVO-BLACK. Domains A, C and D
are answered in `docs/health-answers-C-D.md` and in the handover; this file
finishes the question set in `docs/health-diagnosis-2026-09-05.md`.

Every verdict below is backed by a command that was actually run. Where a check
found a real defect, the fix (or the reason it is not mine to make) is named.

---

# B1 — Every self-check, and whether each finding is real

Commands and results:

```text
node ops-watcher/steward.mjs --once     -> 0 critical, 0 warning, 0 gap
node ops-watcher/reconcile.mjs --once   -> owner-surface OK (22/22)
                                           projection-vs-parser FAIL (1)
                                           fold-determinism OK
node ops-watcher/security-audit.mjs     -> adversarial harness 71 passed, 0 failed
node ops-watcher/repo-hygiene.regression.test.mjs -> 4 passed, 0 failed
```

Findings, one by one:

1. **steward: clean.** Earlier today it reported a CRITICAL every hour about a
   missing scheduled task named `FounderOS-Aidit-PM2-Resurrect`. The task that
   exists is `AiditOS-PM2-Resurrect` (State: Ready, action
   `D:\pm2home\pm2-boot.cmd`). The watchdog held a stale name — a false alarm,
   now fixed. Verified again in this pass: the task list still shows exactly
   that one task, Ready.
2. **reconcile `projection-vs-parser`: real, and narrow.** `KOL-81: fold=(absent)
   parser=new`. The fold has no state for KOL-81 while the parser derives one.
   KOL-81 is the venture directive that sits at the plan-attempt cap, so this is
   the same unfinished item as §6 of the proposal, seen from a second angle. It
   is one issue, not a class.
3. **security audit: one WARNING, and it is a stale expectation.**
   "watcher.mjs does NOT appear to use fs.appendFile for EVENTS_FILE — manual
   review needed". The audit's own adversarial harness passes 71/71, including
   "evidence write failure does not abort run or change returned evidence". The
   detector is pattern-matching for a call shape the file no longer uses.
4. **The suite itself was being misread.** `ops-watcher/run-all-tests.mjs`
   reported 77/79 all day. Measured at the same commit: system Node **v26.5.0 ->
   77/79**, pinned Node **v22.14.0 -> 80/80**. Node 26 on Windows crashes at
   process teardown (`UV_HANDLE_CLOSING`) *after* a suite's tests have passed,
   and the runner scores that as a failed suite. Two suites were called broken
   when the runtime, not the code, was at fault. The runner now says so, but
   only when a failure is printed and only when the running Node differs from
   the pinned one.

**Verdict: PASS with one open item** — the KOL-81 projection gap, which is the
same unfinished directive already tracked.

---

# B2 — Does the registry still describe machines that exist?

Every agent in `config/agent-registry.json` records `machine: "LENOVO-BLACK"`,
which matches `config/machine.json` (`machine_id: "LENOVO-BLACK"`). Runtimes
were each exercised live today rather than read: Ollama Cloud for HATTA, Codex
CLI for CORLEONE, Kimi for SJAHRIR, Hermes/Nous for GIBRAN, local Claude Code
for SOEKARNO.

What is stale is **historical narrative, not operative fields**: several
`known_pitfall` / `dispatch_mechanism` notes still describe ASUS paths such as
`C:\Users\ASUS\AppData\Local\hermes\config.yaml`. They are dated records of how
something was fixed, not instructions a dispatcher reads.

**Verdict: PASS.** Operative fields match reality; the ASUS text is archived
history and is labelled with its own date.

---

# B3 — Does any LIVE path still reference the ASUS?

It did, and this was the one real drift this domain found.

`ops-watcher/telegram-commands.mjs` and `ops-watcher/telegram-setup.mjs` both
hardcoded `https://asus-gray.tailc7b60e.ts.net/` as the cockpit address — the
`/cockpit` reply and the Telegram menu button. Meanwhile:

```text
tailscale status  -> asus-gray  ... offline, last seen 23m ago
tailscale funnel status -> https://lenovo-black.tailc7b60e.ts.net -> 127.0.0.1:4200
```

So every time the owner tapped Cockpit, he was handed a machine that is dark.
`config/machine.json` already held the correct value under
`cockpit.public_base`; nothing read it. Fixed at commit `f251044`: both call
sites now resolve through `ops-watcher/cockpit-url.mjs`, and the two tests that
had asserted the ASUS hostname — and therefore passed for as long as the bug
existed — now derive the expectation from `machine.json`.

Remaining ASUS mentions in code are comments recording history, plus
`config/project-layers.json`, whose evidence line still describes the tailnet
route as pointing at asus-gray. That is a document, not a code path.

**Verdict: FAIL, fixed today.** One user-visible defect, one commit, one test
that can no longer pass while the bug is present.

---

# B4 — Scheduled tasks and launchers pointing at paths that are gone

One relevant task exists:

```text
AiditOS-PM2-Resurrect | Ready | D:\pm2home\pm2-boot.cmd
```

The path exists. The historically dangerous one — the global `~/.paperclip`
launcher at `C:\Users\ASUS\.paperclip\paperclip-run.vbs`, which started the
WRONG Paperclip instance — is recorded in the registry as a past root cause and
is not present in this machine's task list.

**Verdict: PASS.**

---

# E1 — Is every writing lane isolated, for the process that actually writes?

Yes, at the process level. `ops-watcher/lane-worktree.mjs:71` `ensureLaneWorktree`
creates or reuses `D:\AI\worktrees\lane-<name>` and each dispatcher spawns its
CLI with `cwd: workspace.path` (for example `corleone-dispatch.mjs:311`). The
isolation is not advisory: it is the working directory of the child process, so
a lane that writes writes there.

When a worktree cannot be created the module returns the shared repo root with
`isolated:false` **and a reason the dispatcher prints to stderr** — deliberately
loud, because a silent fallback would rebuild the bug the module exists to
prevent.

**The limit, stated plainly:** the worktree is keyed by LANE NAME, one per lane.
Two concurrent dispatches to the SAME lane share one worktree and would write
over each other. Nothing today prevents that; what protects the system is that
dispatch is sequential. That is a property of the caller, not a guarantee of the
isolation.

**Verdict: PASS, with a named limit** — isolation is per lane, not per run.

---

# E2 — How big can a packet be before it is truncated or mangled?

Measured, not assumed. A prompt was built at several sizes containing double
quotes, single quotes, newlines, and the shell metacharacters `& | < > % $ \``,
with a unique marker at the very end; the lane was asked to return the marker.

```text
 2,090 chars | status=0    | 5,027ms | marker ARRIVED
16,090 chars | status=0    | 3,722ms | marker ARRIVED
64,090 chars | status=null |     2ms | marker LOST, no output at all
```

The boundary is the Windows command line itself, not the lane:

```text
30,000 -> ok      32,600 -> ok
32,700 -> ENAMETOOLONG    33,000 -> ENAMETOOLONG
```

So: **a packet arrives intact, quotes and newlines included, up to roughly 32 KB
of TOTAL command line** (the node path, the wrapper path and the prompt
together). Past that, `spawnSync` fails with `ENAMETOOLONG`, returns
`status: null`, and produces no output.

The dangerous part is not the limit — it is the SHAPE of the failure. There is
no truncation and no mangling; there is silence. A caller that does not inspect
`error.code` sees an empty answer and can easily record it as "the lane said
nothing" rather than "the packet was never delivered".

**Verdict: PASS on integrity, FAIL on failure reporting.** Nothing is silently
mangled, but an over-long packet fails silently. A guard belongs where the
prompt is handed to `spawn`, so the outcome is a stated reason instead of an
empty result.

---

# E3 — Do plan anchors point at real symbols, including in a venture repo?

Yes, and this was proven on a venture rather than on the OS repo. After KOL-82
was committed (`95445d5`) the venture graph for `caveman-trading-os` built with
**4,263 nodes**, stamped at the venture's own HEAD, and the content check
confirmed **10 of 10** sampled symbols exist in the file tree.

Two latent defects were found and fixed while proving it: the anchor emitter and
the content check were asking different questions (now one shared
`isIdentifierShapedLabel` / `verifyGraphContentSync` in
`ops-watcher/graphify-refresh.mjs`), and the venture route prefix did not map to
the venture's `sourceRoot`.

**Verdict: PASS.**

---

# E4 — What happens to a lane's work when it fails halfway?

Two different answers, and only one of them is good.

**Inside `executeApprovedDirective`: good.** The executor snapshots the plan's
files before dispatch and restores them on every failing branch — a scope
violation, a venture git write, a red VERIFY, a red full suite. A half-finished
edit does not survive the run.

**In the lane worktrees themselves: the mess is inherited.** Measured now:

```text
lane-corleone           | lane/corleone-measure2      | 7 dirty entries
lane-w2                 | lane/w2-corleone-dispatch   | 1
lane-w3                 | lane/w3-sjahrir-dispatch    | 1
lane-w4                 | lane/w4-anchors             | 1
worktrees/lane-corleone | lane/corleone               | 3
lane-hatta, lane-sjahrir, lane-harness                | 0
```

`ensureLaneWorktree` reuses an existing worktree as-is ("existing worktree
reused"). It does not reset, clean, or even report the dirt. So a lane that
timed out mid-edit hands its leftovers to the next dispatch of the same lane,
and the next lane's diff contains work nobody asked it to do. Today's CORLEONE
timeout is exactly this case: the run stopped at 480s with six files modified,
and those files are still there.

There is also a stray nested worktree, `D:\AI\worktrees\worktrees\lane-corleone`,
from an earlier path mistake.

**Verdict: FAIL.** Not data loss — every leftover is recoverable and none of it
reached `main` — but the next dispatch starts from an unknown state. The fix is
for `ensureLaneWorktree` to report the dirty state it is handing over, and for
the caller to decide, rather than for the dirt to be invisible.

---

# F1 — MCP servers: configured, connecting, and depended upon

Nothing in this repository registers an MCP server. `.mcp.json` does not exist,
`.claude/settings.json` has no `mcpServers` key, and the global `~/.claude.json`
`mcpServers` is empty. Every MCP server present in a session is an **account-level
claude.ai connector**, which means it belongs to the owner's account, not to
this checkout.

One fails on every session start:

```text
claude.ai n8n (404): "No MCP endpoint was found at the URL provided."
```

That is KOL-87, approved for removal (ledger D48), and it is the owner's to
execute: claude.ai -> Settings -> Connectors -> n8n -> Disconnect. It is the
only one of the six approvals still outstanding.

**Does any system path depend on an MCP server? No.** The lanes are spawned as
child processes through wrappers in `ops-watcher/`; the board is reached over
HTTP on `127.0.0.1:3110`. An MCP outage costs an interactive session
convenience, not the running system.

**Verdict: PASS, with one broken connector that only the owner can remove.**

---

# F2 — External CLIs, where they resolve from, and what a rebuild would need

```text
codex   -> D:\Development\npm-global\codex     (CORLEONE)
ollama  -> D:\Ollama\ollama                    (HATTA, via Ollama Cloud)
kimi    -> C:\Users\WIN10\.kimi-code\bin\kimi  (SJAHRIR)
hermes  -> D:\Development\npm-global\hermes    (GIBRAN)
claude  -> D:\Development\npm-global\claude    (AHMAD, SOEKARNO)
pm2     -> D:\Development\npm-global\pm2       (supervision)
node    -> C:\Program Files\nodejs\node        (system Node v26.5.0)
```

Note the last line against `config/machine.json`, which pins
`D:\aidit-node\node-v22.14.0-win-x64\node.exe`. The system Node on PATH is NOT
the pinned one, which is exactly how the suite came to be misread all day.

**If this machine were rebuilt tomorrow, five interactive logins would be
needed** — Codex (ChatGPT auth), Ollama Cloud (API key), Kimi (API key), Hermes
(Nous portal), Claude Code — plus the Telegram bot token, the Paperclip API key
and the GitHub token from `.env.local`. None of that is scripted, and none of it
can be scripted: they are human logins by design.

**Verdict: PASS on resolution, and a stated dependency on five manual logins.**

---

# F3 — What is backed up, and when was a restore last performed?

Blunt answer: **no restore has ever been performed, and the one backup target
that exists cannot be trusted.**

The 2TB flash drive (H:) was tested with a non-destructive write-and-verify pass
(the h2testw principle: unique random data, SHA-256 compared on read-back):
**4 GiB written, 0 verified, 4 mismatched.** Three of four files came back
different from what was written. The drive holds the owner's real archives
(`BACKUPPHONE`, `BUSINESS`, `CALEG`, `Backup3uTools`), so nothing on it has been
deleted and nothing was written over it.

What protects the repository today is GitHub: `main` is pushed, and the code and
its history are recoverable from the remote. That covers the code and nothing
else.

**Verdict: FAIL.** This is the largest single gap in the whole diagnosis. A
backup that has never been restored is a hypothesis, and this particular one has
already been measured as false.

---

# F4 — If the board were lost this hour, what has no second copy?

`.paperclip` is **70 MB** on this machine and is not in git (the repository
ignores it). What lives only there:

- the live state of 92 issues — which are open, blocked, done, waiting on the
  owner;
- **every decision comment**, including the six `OWNER MENYETUJUI via Telegram`
  records from today;
- every `[DECISION BRIEF]`, `[PLAN]`, and escalation-action declaration, which
  are the evidence trail behind the plans that ran.

Partial second copies exist and are worth naming honestly:
`config/decision-ledger.json` now holds the six decisions as records D44-D49,
`state/ledger.jsonl` holds derived ledger events, and
`state/import/paperclip-2026-09-03.json` is a two-day-old snapshot. None of them
reconstructs the board — they are the conclusions, not the record.

**Verdict: FAIL.** The canonical operational state has one copy on one disk.

---

# F5 — Is per-run lane evidence still confined to one disk?

Yes. `ops-watcher/lane-usage.jsonl` — 41 records, 14,021 bytes — sits beside the
code, is matched by `.gitignore:82` (`ops-watcher/*.jsonl`), and is therefore
not tracked in git and not pushed anywhere. Lose this disk and every measurement
of how the lanes have actually behaved is gone.

That is **KOL-79**, and the decision stays the owner's.

**Verdict: confirmed, unchanged, owner's call.**

---

# What these three domains change about the overall verdict

Fixed today, in this pass: the cockpit link that pointed at a dark machine (B3),
and the misread suite (B1) — the suite is green, 80/80, on the Node this
machine pins.

Still holding the system back, in the order that matters:

1. **No tested restore, and a backup drive that fails its own verification**
   (F3). Everything else is recoverable work; this one is not.
2. **The board has a single copy** (F4).
3. **A lane worktree hands its leftovers to the next run** (E4).
4. **An over-long packet fails silently** (E2).
5. **Correctness is still unmeasured**: 0 of 44 runs carry a measurement, and
   the report says `n/a` rather than pretending. The work to fill it is in
   flight in an isolated worktree.
