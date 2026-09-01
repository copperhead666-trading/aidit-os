# AHMAD Session Handoff — 2026-09-01 — The cockpit, and the loop that had gone silent

Read this first next session. Everything below was verified against the running system, not
inferred from tests. Where a claim rests on a test alone, it says so.

## Build stats

- 34 commits, 13:04 → 22:50 WIB.
- Regression suite: **42/42 suites green**. Heartbeat: **15/15 steps**, twelve consecutive clean runs.
- PM2: four processes online — heartbeat, paperclip, telegram-listener, **cockpit** (new).
- Cockpit: 11 routes, all rendering real state, reachable from a second tailnet device over HTTPS.
- Awaiting the owner: KOL-67, KOL-29, KOL-30, plus the paid-AI restructuring decision on 2026-09-13.

## What shipped

**Legacy migration — complete.** All seven approved items plus one the earlier audit missed
(`owner/aidit-principles.md`, the owner's canonical principles, its three ledger ids re-verified).
Two corrections to that audit are recorded in `handoffs/ahmad/LEGACY-REAUDIT-2026-09-01.md`.

**The cockpit** (`cockpit/`). The legacy folder turned out to be a working git clone of
`Bennettxai/FounderOS-DEMO` (MIT), so the ~47 KB shell was reused and the twelve demo business
routes dropped. `cockpit/lib/` is the only code that touches disk; every reader returns null rather
than throwing, and pages render an honest empty state naming the missing file. Read-only by
construction — no write call exists anywhere under `cockpit/`. Served on :4200 under PM2, published
tailnet-only at `https://asus-gray.tailc7b60e.ts.net/`.

**The loop between the owner and the work.** Three separate silences were closed:
- A refused directive repeated forever and never reached the owner. Refusals now count toward the
  attempt cap, and reaching the cap adds OWNER_REQUIRED plus a plain-Indonesian comment.
- That escalation was then found to be *unreachable*: the one-plan-per-sweep budget was checked
  first, so an issue at the cap was starved by the issues ahead of it. Cap check now runs first.
- A bare slash command became a doomed ticket. It now gets an honest reply naming what does work.

## What broke, and what it taught

Every defect below was found by rendering against real data or watching the live system. None was
caught by a passing test suite.

| Defect | How it presented |
|---|---|
| Heartbeat validator rejected `exitCode: null` | Page showed a 7-hour-old record as current, 13/13 vs the real 15/15 |
| Roadmap parser stripped `_` before matching | 15 of 46 backlog items shown; the backlog looked nearly clear |
| Inbox grouped failures by the timestamp in the comment | The three most stuck items rendered as "sedang dikerjakan" |
| Lane status ignored success rate | A lane at 0% success rendered `ok` |
| Escalation gated behind the plan budget | Feature committed and provably never fired |
| Cockpit named buttons that do not exist | The how-to page taught APPROVE/REJECT; the cards say SETUJUI/TOLAK |

The pattern is one thing: **a surface that looks calm while its source is broken.** Assume the next
one exists and go looking for it in the rendered output, not the code.

## Two lane defects worth remembering

A **timed-out** run was being classified as quota-exhausted, parking a healthy lane for six hours —
three times in one day. A real quota rejection returns immediately, so a timeout is by construction
not evidence of exhaustion. Fixed in `lane-guard.mjs`, with all four wrappers passing the flag.

The **cooldown ignored the provider**. Codex says "try again at 9:57 PM" and returns at 9:57 PM;
our flat six hours held it until 03:42. `parseRetryAtMs` in `routing.mjs` now reads that instant.
Messages naming no time — kimi's weekly limit — keep the six-hour default.

## Known gaps

- **Commands are not registered.** `setMyCommands` is unused, which is why typing `/pause` felt
  broken: in Telegram the slash IS the interface. Four read-only commands are being built; nothing
  that changes system state, because what `/pause` should pause is the owner's decision.
- **`config/agent-registry.json` declares four agents** while six lanes do real work. CORLEONE sits
  under `external_agents_not_owned_by_this_registry`; SOEKARNO is not an entry at all despite
  writing much of this cockpit. The Agents page states this rather than papering over it. Whether
  to add them is the owner's call.
- **KOL-64 says done while FOS-21 calls the same three rows unverified.** A real data contradiction
  between two sources, not a rendering bug.
- **The cockpit has no tests.** Its build and typecheck are the only gate, and neither runs in
  `run-all-tests.mjs`.
- **Five owner directives are stuck** (KOL-68, 69, 70, 36, and 33 in progress). They will now
  escalate to Telegram as they hit the cap rather than failing silently.

## How the owner uses it

Cockpit to look, Telegram to act — written out at `/how`. Tap SETUJUI or TOLAK on a card to decide;
reply to a card to attach a note; send a normal message to assign new work. `/inbox` is the morning
screen: what needs them, what is stuck and for how long.
