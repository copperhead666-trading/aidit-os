# Is Aidit OS healthy enough to be trusted unattended?

The question the owner actually asked, on 2026-09-05: not "does it run" but
"is it sound end to end — no drift, no regression — across infrastructure, the
orchestrator, the model lanes, the worker lanes, tools and MCP, and backup and
recovery."

This file is the question set. Every question below is written so that only
EVIDENCE can answer it: a command and its output, a file and its contents, a
number that was measured. A question answered from memory, from a report, or
from what the code appears to intend is not answered.

Two rules make this useful rather than decorative:

- **A "yes" needs a receipt.** Name the command, quote the decisive line.
- **An unknown is an answer.** "Nobody has ever measured this" is a finding, and
  a more valuable one than a guess dressed as a fact.

## Why these six domains

They are the chain a venture directive actually travels: the machine holds the
processes, the orchestrator decides, a model lane plans, a worker lane edits,
tools and MCP are what it reaches for, and backup is what makes any of it
survivable. A break anywhere makes autonomy a liability rather than a feature.

---

## A. Infrastructure — the machine and its processes

A1. Are all four PM2 apps online right now, and how long have they been up
without a restart? A restart loop is invisible in a snapshot.

A2. If the Lenovo rebooted this minute, would every app come back by itself,
with nobody logged in? Name the mechanism and show that it is enabled.

A3. Which Node runtime does each app actually run under, and does any app run
under a runtime the suite is not green on?

A4. How much free space is on each drive the system writes to, and at the
current rate of growth, when does the smallest one fill?

A5. Does anything Aidit OS runs draw a window on the owner's screen? The
call-site audit answers the code; name what answers the scheduled tasks and the
launchers.

## B. Drift — is the system's picture of itself still true?

B1. Run every self-check the repository has (steward, reconcile, security
audit, repo hygiene). For each finding: is it a real defect, or a watchdog
holding a stale expectation? Say which, and give the evidence that decides it.

B2. Does `config/agent-registry.json` still describe the machines, runtimes and
dispatch commands that exist today? Every `machine`, `runtime` and
`dispatch_command_pattern` field must match reality.

B3. Does any live code path still reference the ASUS — by hostname, IP, user
profile path, or an ssh route? Archived history does not count; a live path
does.

B4. Are there scheduled tasks, launchers or config files pointing at paths that
no longer exist on this machine?

## C. The orchestrator — the decision path to the owner

C1. Can a decision reach the owner without passing the brief gate? Enumerate
every code path that adds `OWNER_REQUIRED` and show, for each, where its brief
is validated.

C2. Does the card he receives carry the question, the options, the
recommendation and the cost of waiting — or a title and four buttons? Render a
real one and show it.

C3. Can he disagree? Show the four actions, and show that a card renders only
what its escalation declared.

C4. If two sweeps run at once, can the executor act twice on one directive?
Name the lock and show it refusing a second sweep.

## D. Model lanes — the ones that think

D1. For each lane (CORLEONE, HATTA, SJAHRIR, GIBRAN, SOEKARNO): is it reachable
and authenticated on this machine right now? One real call each, and the
version or answer it returned.

D2. Does each lane's answer actually reach the caller? A lane that runs, costs
tokens and returns an empty string is worse than one that is down: it looks
like a refusal and it fails silently. Prove the return path per lane.

D3. What does the recorded evidence say about each lane's usefulness — runs,
exit-0 rate, wasted time, timeout rate? Numbers from `lane-usage.jsonl`, not
impressions.

D4. Does anything in the system measure whether a lane's work was CORRECT, as
opposed to exiting zero? If not, say so plainly: it is the largest measurement
gap in the system.

## E. Worker lanes and the packets they receive

E1. Is every writing lane isolated to its own worktree, and does the isolation
hold for the process that actually writes — not just the working directory it
was given?

E2. Can a packet reach a lane intact? A quoted string, a long prompt, a
multi-line block: what is the measured limit before something is truncated or
mangled?

E3. When a plan is produced, does the anchor block point at real symbols in the
file being changed, including for a venture repository?

E4. What happens to a lane's work when it fails halfway — is the tree left
dirty, is the branch left behind, does the next dispatch inherit the mess?

## F. Tools, MCP, backup and recovery

F1. Which MCP servers are configured, which actually connect, and does any
system path depend on one that does not?

F2. Which external CLIs does the system depend on, where does each resolve
from, and would a fresh login be needed if the machine were rebuilt tomorrow?

F3. What is backed up today, where does it live, and when was the last time a
restore was actually performed rather than assumed?

F4. If the board (`.paperclip`) were lost this hour, what would be
unrecoverable? Name the data with no second copy.

F5. Is the per-run lane evidence (`lane-usage.jsonl`) still confined to one
disk? That is KOL-79, the owner's decision, and it stays his — but the answer
belongs in this diagnosis.

---

## The verdict this must end in

One of three, with the evidence that forced it:

- **SIAP OTOMASI** — a venture directive may run unattended overnight.
- **SIAP PAKAI, BELUM OTOMASI** — safe with a human watching each decision.
- **BELUM SIAP** — something in the chain is broken or unmeasured.

The honest default is the middle one until a full venture directive has gone
plan → approve → execute → verify → land, at least once, with nobody
intervening.
