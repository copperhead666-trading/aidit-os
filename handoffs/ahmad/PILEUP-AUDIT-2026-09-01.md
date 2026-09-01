# Pileup audit — which heartbeat steps can pile up

Date: 2026-09-01
Scope: read-only audit of `ops-watcher/heartbeat.mjs` and the 15 step modules it
spawns. No code changed, no ops-watcher script executed.

## The STEPS list (authoritative)

From `ops-watcher/heartbeat.mjs` `STEPS` (lines 184–201), in order. The heartbeat
itself has **no concurrency guard**: `runHeartbeatOnce` (line 388) runs the 15
steps sequentially with no lock, and `STEP_TIMEOUT_MS = 10 * 60 * 1000` (line 162)
is *longer* than the 5-minute PM2 interval — so a slow step lets the next
heartbeat start before the previous finishes. There is no `acquireLock` anywhere
in `heartbeat.mjs` (verified: `rg acquireLock ops-watcher/heartbeat.mjs` → no
match). That is the pileup's root mechanism; the per-step table below is what
each overlapping copy can actually break.

| Step | Module | Guard? | Evidence | Overlap risk |
|------|--------|--------|----------|--------------|
| 1 watcher | ops-watcher/watcher.mjs | NONE | No `acquireLock` import. State read-modify-write `STATE_FILE` (line 27), `saveState` (line 219, writeJson last-writer-wins), `appendFile(EVENTS_FILE…)` (line 236); `runOnce` calls `saveState` (line 499). Dedupe is an in-process `seenSet`, not shared between processes. | Two copies each load `state.json` independently, both see an event key absent from their `seenSet`, both append it to `events.jsonl` → duplicate routing events. `state.json` last-write-wins can drop one copy's `seen` set so an event re-emits next sweep. Harmless to the owner (events.jsonl is a downstream-read log; no Paperclip write, no Telegram). |
| 2 test-runner | ops-watcher/test-runner.mjs | LOCK FILE | `LOCK_FILE = …test-runner.lock` (line 139); `acquireLock` in `runTestSweep` (line 314) and `runTestOnce` (line 509); "REFUSING to run — another sweep is in progress" (lines 323, 516). | A second copy refuses cleanly, no Paperclip read/write. Safe. |
| 3 review-runner | ops-watcher/review-runner.mjs | LOCK FILE | `LOCK_FILE = …review-runner.lock` (line 159); `acquireLock` in `runReviewOnce` (line 485) and `runReviewSweep` (line 646); "REFUSING to run — another sweep is in progress" (lines 494, 655). | A second copy refuses cleanly. Safe. |
| 4 telegram-notify | ops-watcher/telegram-notify.mjs | NONE | No `acquireLock` import. Dedupe is a check-then-act on a marker comment: `SENT_MARKER` (line 79), `alreadySent = comments.some(c => c.body…startsWith(SENT_MARKER))` (lines 214–216), then `_sendMessage` then post marker — no lock between the GET and the send. | Two copies both GET comments, both see no `[TELEGRAM SENT]` marker, both call `_sendMessage` → **duplicate decision-card Telegram messages to the owner**, then both post marker comments. This is the trust-erosion outcome: the owner sees two cards for one decision. |
| 5 telegram-listener | ops-watcher/telegram-listener.mjs | NONE | No `acquireLock` in `runListenerOnce`. Offset is read from `STATE_FILE` (line 172) into `offset` (lines 691–694) and only persisted *after* all updates are processed (line 754). The heartbeat step-5 gate (`heartbeat.mjs` `shouldRunTelegramListenerStepReal`, line 373; `skippedHealthy` set at line 428) only skips when the PM2 daemon lock + live pid confirm healthy — it fails OPEN to running when the daemon is down, which is exactly when queued heartbeats overlap. | Two copies both `getUpdates` with the *same* offset (Telegram does not advance the server cursor until offset+1 is confirmed), so both receive the same updates. Outcomes: (a) text-ingress path creates a **duplicate DIRECTIVE Paperclip issue** for the same owner message; (b) APPROVE/REJECT/DETAIL/DEFER each fire twice → duplicate confirmation comments, duplicate DETAIL follow-up messages to the owner, duplicate label/status PATCHes; (c) **each text-ingress and each APPROVE calls `_spawnHeartbeat()` again** (telegram-listener.mjs `spawnHeartbeatReal`, imported at the `--once` entry) — so two overlapping copies each spawn another `heartbeat --once`, compounding the pileup. This is the multiplier shape behind the 1839 zombies. |
| 6 cockpit-status | ops-watcher/cockpit-status.mjs | NONE | No `acquireLock`. Read-only `buildCockpitStatus`; only write is `fs.writeFile(args.htmlPath, html)` in `main` (the `--html` path). | Two copies both write `ops-watcher/cockpit-snapshot.html` — last-writer-wins, one stale snapshot survives. No Paperclip, no Telegram. Harmless. |
| 7 ahmad-dispatch | ops-watcher/ahmad-dispatch.mjs | LOCK FILE | `LOCK_FILE = …ahmad-dispatch.lock` (line 159); `acquireLock` in `runAhmadDispatchOnce` (line 457); "REFUSING to run — another --once sweep is already in progress" (line 466). Layer-2 marker-comment guard is cross-run idempotency (lines 507, 559), not the concurrency guard. | A second copy refuses cleanly. Safe. |
| 8 steward | ops-watcher/steward.mjs | LOCK FILE | `LOCK_FILE = …steward.lock` (line 87); `acquireLock` in `runStewardOnce` (line 607); "REFUSING to run — another STEWARD sweep is already in progress" (line 615). | A second copy refuses cleanly. Safe. |
| 9 steward-sjs | ops-watcher/steward-sjs.mjs | LOCK FILE | `LOCK_FILE = …steward-sjs.lock` (line 66); `acquireLock` in `runStewardSjsOnce` (line 572); "REFUSING to run — another STEWARD-SJS sweep is already in progress" (line 580). | A second copy refuses cleanly. Safe. |
| 10 steward-caveman | ops-watcher/steward-caveman.mjs | LOCK FILE | `LOCK_FILE = …steward-caveman.lock` (line 28); `acquireLock` in `runStewardCavemanOnce` (line 529); "REFUSING to run - another STEWARD-CAVEMAN sweep is already in progress" (line 537). | A second copy refuses cleanly. Safe. |
| 11 escalation-sec | ops-watcher/escalation-sec.mjs | NONE | No `acquireLock` import. Dedupe is a check-then-act on a marker comment: `NOTIFIED_MARKER` (line 27), `markerPresent(comments)` (line 131, used at line 187), then `_dispatchHermes` → add OWNER_REQUIRED → post marker → set `blockedOwnerNotifiedAt`. No lock between the GET and the dispatch. | Two copies both GET comments, both see no `ESCALATION-SEC NOTIFIED` marker, both `_dispatchHermes` (**duplicate hermes lane dispatch — burns real nous quota**), both PATCH OWNER_REQUIRED onto the issue (idempotent), both post marker comments, both set `blockedOwnerNotifiedAt`. Adding OWNER_REQUIRED then makes step 4 (telegram-notify) send the owner a decision card — and step 4 is itself unguarded, so the owner can get duplicate escalation cards. |
| 12 gbrain-curator | ops-watcher/gbrain-curator.mjs | NONE (incidental DB-lock check) | No single-instance lock for the curator sweep. It reads an *external* lock: `GBRAIN_LOCK_FILE` (line 42) via `readGbrainLockHolder` (line 140, checked at line 378) and defers if a live pid holds the GBrain DB lock. But two curators checking concurrently both see no holder before either spawns `gbrain capture`; the DB's own internal lock then serializes the captures (one wins, one fails → recorded as a failure counting toward backoff). State file `gbrain-curator-state.json` is read-modify-write, last-writer-wins. | Wasted `gbrain capture` spawn (one fails on the DB lock) and a possible state-file race that could re-ingest an unchanged source next sweep. No owner-facing effect; the GBrain DB lock incidentally prevents true double-write. Low risk. |
| 13 audit-clerk | ops-watcher/audit-clerk.mjs | THROTTLE ONLY | No `acquireLock`. The LLM drift check is gated by `shouldRunDriftCheck(state, nowMs, DRIFT_MIN_INTERVAL_MS=6h)` (line 64, used at line 588) plus a lane guard `guardLane("corleone")` (line 598). Both are **throttles, not concurrency guards**: two copies starting the same moment both read the same stale `driftCheck.lastAttemptMs` and both proceed to `dispatchCorleoneReal` (line 243). The orphaned-allowlist check is local/read-only. Alert dedup is a state-file 24h cooldown — also a throttle (two copies both read old state, both `spawnAlertReal`). | Two copies both dispatch CORLEONE for the drift check (**duplicate paid-lane dispatch — burns quota**) and both spawn `ahmad-notify` with the same findings (**duplicate owner alerts**) before either writes the cooldown state. |
| 14 self-repair | ops-watcher/self-repair.mjs | THROTTLE ONLY | No `acquireLock`. The whole sweep is gated by `SCAN_MIN_INTERVAL_MS = 30min` via `state.lastScanMs` (lines 55, 378–380) — a state-file throttle, not a lock: two copies both read the same `lastScanMs` and both proceed. Per-fault `REPAIR_COOLDOWN_MS` (6h, `shouldAttemptRepair`) and `MAX_REPAIRS_PER_SWEEP=1` are likewise per-process state checks, not cross-process guards. `attemptRepair` delegates to a real lane (CORLEONE) via the actuator. | Two copies both pass the throttle gate, both detect the same fault, both pass the per-fault cooldown (same stale state), and both call `attemptRepair` → **duplicate repair lane dispatch — burns quota**. `MAX_REPAIRS_PER_SWEEP=1` bounds each *process* to one dispatch, but two processes = two dispatches for the same fault. |
| 15 directive-runner | ops-watcher/directive-runner.mjs | THROTTLE ONLY | No `acquireLock`. The `--once` path is gated by `SWEEP_MIN_INTERVAL_MS = 15min` via `state.lastSweepMs` (line 76, read at line 585, checked at line 587) — a state-file throttle, not a lock: two copies both read the same `lastSweepMs` and both proceed. Planning dispatches CORLEONE (`dispatchPlanReal`), posts a plan comment, and sends a Telegram decision card; execution dispatches a lane and mutates files. | Two copies both pass the throttle, both plan the same directive → **duplicate CORLEONE plan dispatch (quota)**, duplicate plan comments, **duplicate decision cards to the owner**, and for an already-approved directive both can execute → **duplicate execution lane dispatch (quota)** and two snapshot/dispatch/verify cycles against the same files (one's rollback can clobber the other's write). |

## Worst first — unguarded steps that do real harm if doubled

Duplicate **lane dispatches** (quota burn) and duplicate **owner messages** (trust
erosion) are the two outcomes that matter. Ranked worst first:

1. **Step 5 — telegram-listener (NONE).** This is the pileup *multiplier*: each
   overlapping copy, on text-ingress and on APPROVE, calls `_spawnHeartbeat()` to
   fire another `heartbeat --once` (telegram-listener.mjs `spawnHeartbeatReal`).
   Two overlapping copies each re-spawn the heartbeat, so the queued-work storm
   feeds itself — the exact shape of the 1839 zombies. It also creates duplicate
   DIRECTIVE issues for the same owner message and duplicate decision PATCHes /
   DETAIL follow-ups to the owner.

2. **Step 4 — telegram-notify (NONE).** Pure duplicate owner messages: two copies
   both see no `[TELEGRAM SENT]` marker, both send a decision card. Every doubled
   alert makes the owner trust the next alert less — the stated second-worst
   outcome.

3. **Step 11 — escalation-sec (NONE).** Two copies both `dispatchHermes` (duplicate
   nous lane call — quota) and both add OWNER_REQUIRED, which then drives the
   unguarded step 4 to send duplicate escalation cards. Compounds both outcomes.

4. **Step 15 — directive-runner (THROTTLE ONLY).** Two copies both pass the 15-min
   throttle, both dispatch CORLEONE to plan (quota), both send a decision card
   (owner messages), and for an approved directive both execute (quota + double
   file mutation with clobbering rollbacks).

5. **Step 13 — audit-clerk (THROTTLE ONLY).** Two copies both pass the 6h throttle,
   both dispatch CORLEONE for the drift check (quota), both `ahmad-notify` the
   same findings (owner messages).

6. **Step 14 — self-repair (THROTTLE ONLY).** Two copies both pass the 30-min
   throttle, both dispatch a repair lane call for the same fault (quota).
   `MAX_REPAIRS_PER_SWEEP=1` bounds each process, not the pair.

Lower priority (unguarded but harmless): step 1 watcher (duplicate events in a
log + recoverable state-file race, no owner-facing effect), step 6 cockpit-status
(last-writer-wins HTML file), step 12 gbrain-curator (wasted capture, DB lock
serializes the real write).

## Recommendation

The single highest-leverage change is to wrap the **whole** `runHeartbeatOnce`
sweep in `ops-watcher/heartbeat.mjs` (line 388) in the same PID-based
`acquireLock`/`releaseLock` already reused by the six guarded modules (imported
from `telegram-listener-daemon.mjs`), on a new `ops-watcher/heartbeat.lock`,
acquired before the step loop and released in a `finally` after the step log
append. Because every overlap originates from *two `heartbeat --once` processes
running at once* — the PM2 5-min timer plus telegram-listener's event-driven and
text-ingress spawns, all converging on this one entrypoint — making the sweep
mutually exclusive eliminates the concurrent-copy class for **all 15 steps at
once**, including the nine unguarded ones, for one acquire/release pair reusing
an already-tested primitive. It does not by itself stop a single step taking
longer than the 5-minute interval (that needs per-step guards or a shorter
`STEP_TIMEOUT_MS`), but the concurrent-sweep class is the pileup's actual
mechanism, and a heartbeat-level lock is the least change that closes it.