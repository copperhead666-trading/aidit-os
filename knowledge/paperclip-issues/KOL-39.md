---
type: note
title: "KOL-39: GIBRAN REVIEW: KOL-37/KOL-38 duplicate-verdict incident fix (review-runner/test-runner locks) + test-hygiene fix (no more real spawns from regression tests)"
tags: ["paperclip","KOL-39","DONE_VERIFIED"]
source_system: paperclip
issue_id: afa4657c-185d-4767-849e-30af8c5234f5
issue_identifier: KOL-39
issue_status: done
issue_labels: ["DONE_VERIFIED"]
exporter_version: 1
generated_at: 2026-08-29T08:03:08.179Z
---

# KOL-39: GIBRAN REVIEW: KOL-37/KOL-38 duplicate-verdict incident fix (review-runner/test-runner locks) + test-hygiene fix (no more real spawns from regression tests)

- **Status:** done
- **Labels:** DONE_VERIFIED

## Description excerpt

Review request for two related fixes, both delegated to HATTA, both independently re-verified by AHMAD. LIVE INCIDENT: KOL-37 got 8 duplicate GIBRAN verdict comments, KOL-38 got 11 -- confirmed direct …[truncated]

## Final verdict / outcome

VERDICT review (GIBRAN via hermes — 2026-08-29T00:27:28.592Z):
VERDICT: PASS WITH NOTES

Reasoning (hermes stdout):
VERDICT: PASS WITH NOTES

Reasoning:
- Root cause correctly diagnosed: unlocked check-then-act guard in review-runner.mjs + real detached heartbeat.mjs spawns from regression tests racing with live daemon and manual review-runner calls. The duplicate-verdict counts (8 for KOL-37, 11 for KOL-38) are concrete and API-verifiable.
- FIX A is sound: atomic PID-based lock (acquireLock/releaseLock/isPidAliveReal, already hardened with fs.writeFile {flag:"wx"}) wrapped around the whole sweep, separate lock files per runner. Mirrors the proven KOL-33/ahmad-dispatch.mjs fix from earlier today — same pattern, same lock primitives.
- FIX B addresses the trigger: regression tests must not spawn real detached children against the live Paperclip instance. Cutting that off eliminates the race source.
- Independent re-verification by AHMAD is noted in the issue.

Notes:
- Passing
...[truncated 348 bytes]

## Timestamps

- Created: 2026-08-29T00:26:40.263Z
- Updated: 2026-08-29T00:27:29.047Z
