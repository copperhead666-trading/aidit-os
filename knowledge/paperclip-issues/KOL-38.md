---
type: note
title: "KOL-38: GIBRAN REVIEW: stale test-import crash fix (review-runner.mjs / test-runner.mjs pure-helper exports)"
tags: ["paperclip","KOL-38","DONE_VERIFIED"]
source_system: paperclip
issue_id: 7bf9c1f1-2496-4cb6-8090-01520b43301a
issue_identifier: KOL-38
issue_status: done
issue_labels: ["DONE_VERIFIED"]
exporter_version: 1
generated_at: 2026-08-29T08:03:09.089Z
---

# KOL-38: GIBRAN REVIEW: stale test-import crash fix (review-runner.mjs / test-runner.mjs pure-helper exports)

- **Status:** done
- **Labels:** DONE_VERIFIED

## Description excerpt

Review request. Found via the full ops-watcher/*.regression.test.mjs battery: node ops-watcher/review-runner.regression.test.mjs and node ops-watcher/test-runner.regression.test.mjs both crashed at IM …[truncated]

## Final verdict / outcome

VERDICT review (GIBRAN via hermes — 2026-08-29T00:11:58.791Z):
VERDICT: PASS

Reasoning (hermes stdout):
GIBRAN REVIEW — KOL-38

**What the issue describes:**
Test files (`ops-watcher/review-runner.regression.test.mjs` and `test-runner.regression.test.mjs`) crash at IMPORT TIME with `SyntaxError: module does not provide an export named X`. Zero tests can run.

**Root cause confirmed by the issue:**
Tests import symbols that don't exist: `runReviewSweep`, `parseVerdict`, `verdictCategory`, `runTestSweep`, `parseTestCommand`, `TEST_COMMAND_ALLOWLIST`. The real production entrypoints are `runReviewOnce` and `runTestOnce` (used by `heartbeat.mjs`).

**The fix described:**
- Extracted inline verdict-parsing logic (VERDICT_RE etc.) into exported `parseVerdict(text)` / `verdictCategory(verdict)` in review-runner.mjs
- Extracted inline command-parsing/allowlist logic into exported `parseTestCommand(text)` / `TEST_COMMAND_ALLOWLIST` in test-runner.mjs
- Refactored `classifyVerdict` /
...[truncated 833 bytes]

## Timestamps

- Created: 2026-08-29T00:04:30.926Z
- Updated: 2026-08-29T00:12:00.023Z
