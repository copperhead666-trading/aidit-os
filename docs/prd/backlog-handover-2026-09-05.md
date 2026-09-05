# Backlog handover — everything the ASUS session established

The owner is done relaying between two agents. This file is the whole backlog
that lived in the ASUS Claude session, written where the lanes can read it, so
SOEKARNO can work it without a human in the middle.

Read this, then `docs/prd/escalation-contract.md`, then start at the top of §2.

```
Written    2026-09-05, from the ASUS, which no longer runs anything
Repo       d94f194 at time of writing
Suite      74/74 on Node 22.14.0, verified on the Lenovo
Live       Lenovo: paperclip :3110, cockpit :4200, telegram-listener, heartbeat
           all four PM2-supervised, pm2 save done, boot task verified
```

Every figure here was measured during the 2026-09-04 → 05 session. Anything not
verified in that window says so.

---

## 1. Standing context you need before touching anything

**The ASUS is dark and stays dark.** All four PM2 apps stopped and confirmed. It
fetches the repo and does not run it. The Claude account on it lapses
2026-09-14. The Lenovo is now both the running host and the writer.

**Two commits came from the ASUS, by the owner's explicit instruction, while you
were idle or rate-limited:** `36fd461` (the PM2 launcher argv fix, without which
nothing ran on the Lenovo) and `d94f194`/this file. That was a one-time
exception to "the Lenovo is the only writer", not a new rule.

**The owner's pre-authorization for unattended venture work**, in his words:

> Scope: caveman-trading-os only. Allowed without per-item approval: directives
> that pass `validatePlanScope`, violate no venture hardStop, and touch nothing
> in `owner_decision_required`. Nightly ceiling 6. Nothing leaves the machine —
> no push to the venture remote, no commit to its main branch. Do not touch the
> five uncommitted files. Stop and wait for morning if two directives fail in a
> row, a lane quota is exhausted, a plan touches real money / position sizing /
> risk limits / leaving Phase 1, or `run-all-tests` goes red.

**A standing rule that is currently being violated:** nothing Aidit OS runs may
draw a window on his screen. See W2.

---

## 2. The work, in dependency order

Items carry the requirement ID from `docs/prd/escalation-contract.md` where one
exists. Do them in this order; the reasons are in the "why here" column of that
document's §4.

### W1 — `directive-runner` has no sweep lock  *(spec V3)*
`ops-watcher/directive-runner.mjs`

Measured lock references: `test-runner` 13, `review-runner` 15,
`venture-planner` 3, **`directive-runner` 0**. The only component that changes
files is the only one without a cross-process sweep lock, and the heartbeat
sweeps every five minutes unattended. Use the lock shape the other three already
use; do not invent a fourth.

### W2 — the headless rule is broken  *(spec H1)*
`ops-watcher/lane-worktree.mjs` and every other spawn site

`lane-worktree.mjs:58` calls `execFileSync("git", args, { cwd, encoding,
maxBuffer })` with no `windowsHide`, and it runs on every lane dispatch. The
owner sees the flashes.

Audit every spawn/exec **call site**, not every file — a file that sets
`windowsHide` somewhere proves nothing about the call three functions down. Add
a test that fails when a new call site omits it, or this decays again the way
the argv lesson did.

### W3 — the card must carry its content  *(spec E1)*
`ops-watcher/telegram-notify.mjs:160-168`

The no-brief branch sends the title and "tap a button" and drops
`issue.description`. KOL-66's description is literally the list of options the
owner was asking for. Include it, trimmed, truncation marked.

### W4 — DETAIL must answer the card  *(spec E4)*
`ops-watcher/telegram-listener.mjs:1141`

Returns title, status, label IDs as raw UUIDs, the directive plan (absent on a
decision issue), and the **first line only** of four comments cut at 120
characters. Add the description and the full brief when present; render label
names; show comment bodies; state what was truncated.

### W5 — the two latent problems KOL-82 triggers  *(spec V1, V2)*

Both must land **before** KOL-82 is put to the owner.

- `ops-watcher/directive-runner.mjs` — the venture graph holds 3,372 Python
  nodes beyond `L1` across 174 files, but only **966** have identifier-shaped
  labels; **2,406** are docstrings. `Return DASHBOARD_SECRET. Raises at start
  @ L23` is an anchor today. The content check filters these; anchor *emission*
  does not. Same filter, both places.
- `ops-watcher/venture-gate.regression.test.mjs` — the live test asserts the
  venture has exactly **five** uncommitted files. KOL-82 asks the owner to clear
  them, which makes it zero and turns the suite red. Assert the parsing contract
  against whatever `git status --porcelain` returns; skip cleanly when no
  venture is checked out. Keep the live read — it is what caught the porcelain
  left-edge trimming bug.

### W6 — four actions, declared per escalation  *(spec E2)*

```
accept    approve as proposed              exists today
edit      revise the arguments, then approve   MISSING
response  reply in the owner's own words       MISSING
ignore    decline without inventing a reason
```

Each escalation declares `allow_accept` / `allow_edit` / `allow_respond` /
`allow_ignore`, and the card renders only what is allowed. That is why
`langchain-ai/agent-inbox`'s buttons change and ours do not: the **sender**
declares the actions. Reuse what exists — the listener already captures a reply
to a card as free text, and `ACTION_LETTERS` already maps `d` and `z`. `edit`
returns the revised plan to the issue as a *new* plan and never executes the
original.

### W7 — no path reaches the owner without the brief gate  *(spec E3)*

`decision-brief.mjs` validates five slots and refuses what is empty. Only **two**
files route through it — `ahmad-escalate.mjs` and `raise-decision.mjs`.
Everything else lands on his surface unchecked, which is why he sees bare titles
and static buttons. Every producer goes through the same validator; one that
genuinely cannot fill a slot writes that fact *in* the slot.

### W8 — the reader still trusts the stamp alone
`ops-watcher/directive-runner.mjs`

`verifyGraphContent` exists in `graphify-refresh.mjs` and runs at refresh time,
so it protects the **writer**. `graphFreshnessForAnchors` in `directive-runner`
still compares stamp against HEAD only — `grep verifyGraphContent
directive-runner.mjs` returns nothing.

Reproduced on the ASUS at `dbbec88`: with the stamp forced to HEAD over stale
content, `buildExecutionPrompt` emitted **6 anchors**, all with line numbers
that had moved. Both known bad writers are fixed; the bug was found *because* an
unanticipated writer existed. Have the reader call `verifyGraphContent`, cached
per stamp.

### W9 — SOEKARNO dials itself
`ops-watcher/soekarno-dispatch.mjs:56`

`SOEKARNO_HOST = "WIN10@100.87.42.3"` is still hardcoded. That address is the
Lenovo, which is now the host everything runs on, so the lane ssh's to itself and
fails with "Host key verification failed". On this host the lane needs no ssh at
all — a local `claude -p` is the same call. One branch: if the target host is
this machine, run locally. The owner deferred this until after the cutover; the
cutover is done.

### W10 — the per-run evidence lives on one disk  *(spec D2, and KOL-79)*

`ops-watcher/lane-usage.jsonl` is untracked, so the DoD table and the CORLEONE
p50 exist only on the Lenovo. **Owner decision, raised as KOL-79 — do not
decide it.** Prepare the aggregate writer so whichever option he picks is a
config change, not a build.

### W11 — cost per landed change  *(spec D1)*

Across 236 recorded lane runs: 65% exited ok, and **44% of lane time produced
nothing at all** (sjahrir 92% wasted, hatta 57%, corleone 36%). `ok` only means
exit 0 — two runs that TIMED OUT produced usable work, and CORLEONE once
reported success having delivered 2 of 7 requested guards, so the real
correctness rate is lower and nothing measures it.

Optimising packet size while a 480-second timeout burns a whole run is
optimising the wrong end. The data is already in `lane-usage.jsonl`; nothing
renders it.

### W12 — KOL-81, the first venture directive

Failed at planning: CORLEONE returned a plan too short to parse, attempt 1 of 2.
It will retry on a heartbeat. Note that it dispatched twice because
`directive-runner` has no sweep lock — W1 closes that.

`reconcile` reports one real difference, `KOL-81: fold=(absent) parser=new`: a
newly created issue with no classifiable comments derives no ledger event. It
should clear once the directive gets a plan.

---

## 3. Approved in direction, deliberately not started

**INTAKE BRIEF** — `docs/prd/intake-brief.md`. A gate that makes AHMAD ask before
working, mirroring `decision-brief.mjs` in the opposite direction: that one makes
AHMAD *answer* before interrupting; this one makes him *ask* before starting. The
owner approved the direction on 2026-09-04. It is scheduled after the cutover and
after the escalation work above — the document says so itself.

---

## 4. Owner-only. Do not decide these.

- **KOL-82** — the five uncommitted venture files. His since KOL-66. Do not put
  it to him until W5 is done.
- **KOL-79** — where per-run lane evidence lives.
- **KOL-80** — which board becomes the single history. Measured: the Lenovo board
  is a strict superset by identifier, 84 against 82, with nothing on the ASUS the
  Lenovo lacks. Content-level equivalence unverified.
- Any write to a venture repository's remote; anything touching real money,
  position sizing, risk limits, or leaving Phase 1.
- Subscriptions, credentials, and anything that leaves the machine.

---

## 5. Loose facts worth carrying

- **PM2's log directory is empty** on the Lenovo — the bug the ecosystem file
  already documents. The apps work; their logs do not. Do not debug through
  `pm2 logs` and conclude a daemon is silent.
- **Node 26 scores 68/70** on this suite because of a teardown crash after the
  tests pass. It is pinned around, not fixed. `paperclipai` requires `>=24.11`,
  so the Lenovo genuinely needs both runtimes and `ecosystem.config.cjs` names an
  interpreter per app.
- **The repo has an off-machine remote** — `github.com/copperhead666-trading/aidit-os`.
  Older handoff documents still claim it has none; they are wrong.
- **`handoffs/sjahrir/*` is a 2026-08-28 snapshot** and attaches the lapsing
  Claude account to the wrong machine. Do not trust it on accounts.
- **Lane authentication on the Lenovo**, probed 2026-09-04 with one live call
  each: GIBRAN (hermes/nous) ok, CORLEONE (codex) ok, HATTA
  (ollama glm-5.3:cloud) ok, SJAHRIR (kimi 0.38.0) ok — its weekly quota has
  reset. SOEKARNO blocked by W9.
- **Independent verification is the habit that pays.** Every real correction in
  this session came from reading the code or running it, never from reading a
  report: a declared-and-unused cap, a fresh stamp over stale content, three
  consecutive CORLEONE failures, and a silent argv bug that had kept the whole
  system from ever running on this machine.
