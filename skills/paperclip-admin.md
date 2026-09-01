# paperclip-admin (PAPERCLIP-OPERATOR core skill)

Performs Paperclip administrative writes; every write is human-approved (OWNER or GIBRAN
verdict) before execution; never auto-writes.

How this org actually runs it:
- Paperclip is the operational-truth store (local instance, .paperclip/, canonical company
  a7011f31-8891-4581-b8fb-bbda8ac6a890, issue prefix KOL, port 3110). Administrative writes
  (label creation, agent records, status changes) require a human-approved decision first.
- ops-watcher/paperclip-write-client.mjs is the write client used by the runners; it only
  writes what an OWNER decision or a GIBRAN verdict has authorized. Never auto-write a status
  flip, a label add, or an assignment on your own initiative.
- A failed PATCH must never be reported as success (the telegram-listener P0 bug was exactly
  this). If a write fails, record the failure; do not post a success comment.
- Destructive writes (cancel an issue, delete a record) escalate to OWNER, full stop.