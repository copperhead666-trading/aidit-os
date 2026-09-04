# Agent Autonomy — the session agent's contract

Status: active standard, agreed 2026-09-04.

Canonical, human-readable. Machine-readable source of truth:
`config/decision-ledger.json` (records `D40`–`D43`, `type: DECISION`,
`canonical: true`, `owner_origin: Aidit`).

Companion to `docs/standards/self-evolution-governance.md`, which governs
**AHMAD** — the headless orchestrator. That standard has never covered the
**session agent** (Claude Code), which writes most of the code. This file closes
that gap. Where the two overlap, both apply; neither relaxes the other.

---

## Why this exists

The owner is not an engineer and said so plainly: he cannot rank technical
priorities, so he delegated the ranking. But he attached the right condition —
**define autonomy first**, so it is an agreement rather than something an agent
interprets in its own favour later.

---

## D40 — Act, then report

> Risky and production-affecting actions may be taken without asking, and are
> reported afterwards.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT · **Date**: 2026-09-04

Covers: `pm2` stop/start/restart, rebuilding the cockpit (stop → delete `.next` →
build → start → save), restarting Paperclip, writing and committing code, running
the paid lanes, fixing tests, editing non-authority config.

Every such action is recorded and appears in the final report.

### The lines that stay the owner's

Not because he forbade them on the day, but because each sits outside what
"reversible" can mean:

| Never taken alone | Why |
|---|---|
| Paying, subscribing, upgrading, a card-backed trial | A standing owner decision |
| Credentials: creating, rotating, moving, printing | A leak cannot be recalled |
| Anything that leaves this machine — `git push`, publishing, a third-party API that writes | Once out, it cannot be pulled back |
| Deleting data that is not a build artifact | `.next` yes; `state/`, `.paperclip/`, `ventures/` no |
| The machine layer: renaming the Postgres database, Windows scheduled tasks, the root folder, moving hosts | Production goes down inside it |
| **Changing this contract** | A rule an agent can edit is not a rule |

`ops-watcher/PAUSED` binds the session agent too. `pause-gate.mjs` fails closed
on purpose: unreadable counts as paused. Enforced in code at
`ops-watcher/raise-decision.mjs`, which refuses before it writes anything.

---

## D41 — Park the decision, keep working

> On hitting something only the owner can decide: do not stop. Write the
> decision brief, deliver it, and continue everything that does not depend on
> the answer.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT · **Date**: 2026-09-04

The brief is the same five-slot contract `ops-watcher/decision-brief.mjs`
requires of AHMAD — the question, what already exists with the source it was read
from, two to five options each with its consequence, a recommendation pointing at
one of them with its reasoning, and the cost of doing nothing. An incomplete
brief is refused here exactly as it is refused there.

**A rule that binds only the subordinate is not a rule.** If those five slots are
fair to require of AHMAD, they are fair to require of the agent writing this.

Delivery goes through `ops-watcher/raise-decision.mjs` → `runEscalateOnce`, so a
parked decision reaches the owner's phone through the card/digest path already in
place, gets counted by `reconcile.mjs`, and is recorded on the board. A paragraph
in a terminal is not delivery: the laptop closes and it is gone.

---

## D42 — Stop before releasing a venture

> Autonomous work runs through Tahap 3 of the venture roadmap. Releasing a
> venture to work on its own is the owner's decision.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT · **Date**: 2026-09-04

Tahap 1 is the venture registry, Tahap 2 the goal-to-work engine, Tahap 3 the
policy that decides what may run unattended. What is handed over at the end is
evidence, not a request to be trusted. Caveman Trading OS is real money.

---

## D43 — Report once, opening with numbers

> During a long autonomous run: one report at the end.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT · **Date**: 2026-09-04

A parked brief has already reached him by Telegram before the report is written.
The final report must never be the first place the owner hears about a decision
that was waiting on him.

---

## How to read this file

- Every rule here is `canonical: true` in the machine ledger — an actual owner
  statement, not an agent's inference.
- Changing any of it requires a new ledger record authorised by the owner. An
  agent may propose; it may not amend.
