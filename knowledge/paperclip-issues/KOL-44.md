---
type: note
title: "KOL-44: heartbeat.mjs runStepReal: ReferenceError on spawn 'error' event (undefined `code`)"
tags: ["paperclip","KOL-44","DONE_VERIFIED"]
source_system: paperclip
issue_id: 61c4d585-8412-48be-bde9-a14c1ebcfd53
issue_identifier: KOL-44
issue_status: done
issue_labels: ["DONE_VERIFIED"]
exporter_version: 1
generated_at: 2026-08-29T08:03:09.895Z
---

# KOL-44: heartbeat.mjs runStepReal: ReferenceError on spawn 'error' event (undefined `code`)

- **Status:** done
- **Labels:** DONE_VERIFIED

## Description excerpt

Found during GIBRAN's review of KOL-43 (parallel CORLEONE + SJAHRIR dispatch). Pre-existing, unrelated to either of that dispatch's changes. In ops-watcher/heartbeat.mjs, `runStepReal`'s `child.on("er …[truncated]

## Final verdict / outcome

No VERDICT comment. Current state: status=done, labels=DONE_VERIFIED.

## Timestamps

- Created: 2026-08-29T05:31:25.938Z
- Updated: 2026-08-29T06:07:45.394Z
