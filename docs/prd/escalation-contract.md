# PRD — The Escalation Contract

What has to be true before an autonomous system may interrupt its owner, and
before it may be trusted to work a venture unattended.

```
Drafted   2026-09-05
Host      Lenovo, post-cutover
Suite     74/74 on Node 22.14.0 at 5e72f09
Status    approved in direction by the owner; requirements not yet built
```

Every figure below was measured during the 2026-09-04 → 05 session. Anything not
verified in that window is marked as unverified in place.

---

## 1. The defect

Every decision that reaches the owner arrives as a title and four fixed buttons.
He has said plainly that he approves without knowing what he is approving. That
is not a UI complaint: an approval given without the content is not consent, and
every downstream guarantee in this system rests on it.

`ops-watcher/telegram-notify.mjs:160-168` — the card, when no brief exists:

```
⚠️ Perlu keputusan Anda

<judul>

Ketuk salah satu tombol di bawah untuk memutuskan.
```

The issue's `description` is never included. For KOL-66 that description reads
*"…Reply with one: commit them, discard them, or leave as-is for now."* The
options were written down. The card discarded them.

The DETAIL button does not rescue it. `ops-watcher/telegram-listener.mjs:1141`
returns the title, the status, the label IDs as raw UUIDs, the directive plan —
absent on a decision issue — and the **first line only** of four comments,
truncated at 120 characters. The description is dropped there too.

### The machinery already exists and never fires

- `decision-brief.mjs` validates five required slots — `pertanyaan`,
  `yang_sudah_ada`, `pilihan`, `rekomendasi`, `kalau_didiamkan` — and refuses an
  escalation that lacks them. Only **two** files route through it.
- `buildButtons()` renders one button per option, `o:<id>:<index>`, the moment an
  issue carries a `[DECISION OPTIONS]` comment. Nothing writes that comment for
  the issues the owner actually receives.

The buttons never change because nothing tells them to. The fix is not new
machinery; it is making the existing gate mandatory on every path that reaches
him.

---

## 2. Prior art — adopt the inbox model, not a template

Verified 2026-09-05 via the GitHub API and the repository's own README, not
recalled: **`langchain-ai/agent-inbox`** — MIT licence, 1,087 stars — is an inbox
UX for human-in-the-loop agents. Its contract answers the owner's question
directly, because the *sender* declares which actions are available on each
interrupt rather than a fixed template deciding for everyone.

| Action | Their definition | What it gives the owner here |
|---|---|---|
| `accept` | Accept the interrupt's arguments, or action | The approve he has today |
| `edit` | Edit the interrupt's arguments | **Missing today.** Change the plan, then approve it |
| `response` | Send a response; always a single string | **Missing today.** Disagree in his own words |
| `ignore` | Ignore the action; returns `null` for args | Decline without inventing a reason |

Their `HumanInterrupt` carries an `action_request` (`action`, `args`), a markdown
`description`, and a `config` block of four booleans — `allow_accept`,
`allow_edit`, `allow_respond`, `allow_ignore` — that decides which controls
appear.

**What we take:** the four action types, the per-interrupt config flags, and the
rule that a description travels *with* the interrupt.

**What we do not take:** their transport or UI. This system's surface is the
Cockpit with Telegram as a one-way bell, and its store is a marker comment in a
Paperclip issue body — the only place structured data survives a round trip
here.

---

## 3. Requirements

### E — Escalation

**E1. The card carries the content, always.**
When an issue has no `[DECISION BRIEF]`, the card includes the issue
`description`, trimmed to a readable length with truncation marked. A card that
shows only a title is a defect, not a fallback.

**E2. Four actions, declared per escalation.**
Adopt `accept` / `edit` / `response` / `ignore` with an `allow_*` flag each.
`response` reuses the existing reply-capture path — the listener already captures
a reply to a card as free text. `edit` returns the owner's revised arguments to
the issue as a new plan, and never executes the original.

**E3. No path reaches the owner without passing the brief gate.**
`ahmad-escalate.mjs` already refuses a brief with empty slots. Every other
producer — the planner, the listener's wrapping, manual board entries — must
route through the same validator. Where a producer genuinely cannot fill a slot,
it says so in the slot; it does not omit it.

**E4. DETAIL answers the question the card raised.**
Include the description, label *names* rather than UUIDs, the full brief when
present, and comment bodies rather than first lines. A truncation states what was
cut and where to read it.

### C — Cockpit

**C1. One decision queue, actionable in place.**
Nine issues currently hold `OWNER_REQUIRED`. The Cockpit lists them with brief,
options and the four actions, and records the decision the same way the Telegram
callback does — one decision record, two doors, never two schemes.

**C2. The night page states what ran.** — *built, 5e72f09*
`/night` must keep its three honest states: work done, nothing done, ledger
unreadable — and never report a refusal as work.

**C3. Telegram stays a bell.**
A notification names the decision and links to the Cockpit. Approving from
Telegram remains possible because the owner is often away from a desk, but the
Cockpit is where the content lives and the bell never becomes the record.

### D — Instrumentation

**D1. Measure cost per landed change, not tokens per call.**
Across 236 recorded lane runs, 65% exited ok and **44% of lane time produced
nothing at all**. Optimising packet size while a 480-second timeout burns a full
run is optimising the wrong end. `lane-usage.jsonl` already holds `ok` and
`durationMs`; nothing renders them.

**D2. The evidence must survive the machine.**
`lane-usage.jsonl` is untracked, so every per-run number lives on one disk.
Either commit a periodic aggregate or dump it on a schedule. This is KOL-79,
still open and the owner's.

### V — Venture execution

**V1. Anchors must name symbols, not prose.**
The venture graph holds 3,372 Python nodes located beyond `L1` across 174 files.
Only **966** carry an identifier-shaped label; **2,406** are docstrings —
`Return DASHBOARD_SECRET. Raises at start @ L23` is an anchor today. The content
check filters these; anchor emission does not. Apply the same filter at emission.

**V2. A test may not assert a number the owner is being asked to change.**
A live test asserts the venture has exactly five uncommitted files. KOL-82 asks
the owner to commit or discard them. Acting on the recommendation turns the suite
red. Assert the parsing contract against whatever `git status --porcelain`
returns, and skip cleanly where no venture is checked out. Keep the live read —
it is what caught the porcelain left-edge trimming bug.

**V3. The executor needs the lock every other sweep already has.**
`test-runner` (13 references), `review-runner` (15) and `venture-planner` (3) all
take a cross-process sweep lock. `directive-runner` — the only component that
changes files — takes **none**, while the heartbeat sweeps every five minutes
unattended.

### H — Headless

**H1. Nothing Aidit OS runs may put a window on the owner's screen.**
A standing rule, currently broken: `ops-watcher/lane-worktree.mjs:58` calls
`execFileSync("git", …)` with no `windowsHide`, and it runs on every lane
dispatch. Audit every spawn call **site** — not every file; a file that sets
`windowsHide` somewhere proves nothing about the call three functions down — and
add a test that fails when a new site omits it, or the rule decays again.

---

## 4. Sequence

| # | Work | Why here |
|---|---|---|
| 1 | V3 · executor sweep lock | Highest consequence, running unattended today |
| 2 | H1 · headless audit + test | A standing rule is being violated on his screen |
| 3 | E1, E4 · card and DETAIL carry content | Small, and changes what he sees on his phone today |
| 4 | V1, V2 · symbol filter, decouple the live test | Both must land **before** KOL-82 is put to him |
| 5 | E2, E3 · four actions, brief gate on every path | The structural fix; touches several producers |
| 6 | C1 · decision queue in the Cockpit | Needs E2's action model to exist first |
| 7 | D1, D2 · cost per landed change | Measurement, once the loop is worth measuring |

**Sequencing hazard.** KOL-82 triggers two latent problems at once. Clearing the
five uncommitted files turns the suite red (V2) and switches on docstring anchors
(V1). Both fixes come first, then the decision goes to the owner.

---

## 5. Boundaries

Named so no lane quietly decides them:

- **KOL-82** — the five uncommitted venture files. His since KOL-66.
- **KOL-79** — where per-run lane evidence lives once it must outlive one disk.
- **KOL-80** — which board becomes the single history. Measured: the Lenovo board
  is a strict superset by identifier, 84 against 82, with nothing on the ASUS the
  Lenovo lacks. Content-level equivalence unverified.
- Any write to a venture repository's remote, and anything touching real money,
  position sizing, risk limits, or leaving Phase 1 — the venture's own
  `owner_decision_required` in `config/ventures.json`.

Out of scope here: the INTAKE BRIEF gate (approved in direction, deliberately
scheduled after the cutover) and the paid-AI restructuring.

---

## 6. Acceptance

Finished when all of these are true at once, on the Lenovo:

1. A decision arriving on the owner's phone states the question, the options, the
   recommendation and the cost of waiting — without him opening anything else.
2. He can disagree in his own words, and edit a plan rather than only approve or
   reject it.
3. No escalation reaches him that failed the brief gate; a producer that cannot
   fill a slot says so in the slot.
4. A venture directive runs end to end with symbol-level anchors and lands a
   change he approves in the morning queue.
5. Nothing Aidit OS runs draws a window on his screen, and a test fails if that
   regresses.
6. The suite is green on Node 22 on the Lenovo, and stays green after he acts on
   KOL-82.
