# recovery (AHMAD core skill)

Detects orphaned/zombie tasks and runs, performs P0/P1 reconciliation, wakes stalled
dispatches, enforces re-entrancy guards on wake ticks.

How this org actually runs it:
- ops-watcher/heartbeat.mjs runs the 6-step single sweep (--once) and must NEVER abort the
  whole sweep on one step's non-zero exit; a thrown/missing step is recorded, not fatal.
- Re-entrancy: ops-watcher/*runner.mjs use a Paperclip-derived idempotency guard (a verdict
  / marker comment already present) rather than trusting local state files, so a corrupted
  local state.json cannot cause a duplicate action.
- OWNER_REQUIRED on a Paperclip issue BLOCKS all automatic test/review action — check that
  label first, always, before waking any runner.
- Re-verify state from canonical sources (fresh Paperclip GET) after a wake tick; never trust
  a runner's own stdout to decide whether a stalled task is now done.