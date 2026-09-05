---
title: Escalation Contract Requirements
type: note
tags: [escalation, requirements, kol-83]
---

# Escalation Contract Requirements

## E - Escalation

- **E1. The card carries the content, always.** "When an issue has no `[DECISION BRIEF]`, the card includes the issue `description`, trimmed to a readable length with truncation marked."
- **E2. Four actions, declared per escalation.** "Adopt `accept` / `edit` / `response` / `ignore` with an `allow_*` flag each."
- **E3. No path reaches the owner without passing the brief gate.** "`ahmad-escalate.mjs` already refuses a brief with empty slots."
- **E4. DETAIL answers the question the card raised.** "Include the description, label *names* rather than UUIDs, the full brief when present, and comment bodies rather than first lines."

## C - Cockpit

- **C1. One decision queue, actionable in place.** "Nine issues currently hold `OWNER_REQUIRED`."
- **C2. The night page states what ran.** "`/night` must keep its three honest states: work done, nothing done, ledger unreadable — and never report a refusal as work."
- **C3. Telegram stays a bell.** "A notification names the decision and links to the Cockpit."

## D - Instrumentation

- **D1. Measure cost per landed change, not tokens per call.** "Across 236 recorded lane runs, 65% exited ok and **44% of lane time produced nothing at all**."
- **D2. The evidence must survive the machine.** "`lane-usage.jsonl` is untracked, so every per-run number lives on one disk."

## V - Venture execution

- **V1. Anchors must name symbols, not prose.** "The venture graph holds 3,372 Python nodes located beyond `L1` across 174 files."
- **V2. A test may not assert a number the owner is being asked to change.** "A live test asserts the venture has exactly five uncommitted files."
- **V3. The executor needs the lock every other sweep already has.** "`test-runner` (13 references), `review-runner` (15) and `venture-planner` (3) all take a cross-process sweep lock."

## H - Headless

- **H1. Nothing Aidit OS runs may put a window on the owner's screen.** "A standing rule, currently broken: `ops-watcher/lane-worktree.mjs:58` calls `execFileSync("git", ...)` with no `windowsHide`, and it runs on every lane dispatch."

## Sumber

- `docs/prd/escalation-contract.md` - dibaca 2026-09-05
