# Handover — health first, then real work, then automation

Written 2026-09-05 on the Lenovo, at the end of the session that finished the
ASUS cutover. The owner set the order himself and it is the right one:

    diagnose and repair until healthy
      -> prove the system on real work
        -> only then automate

Read `docs/health-diagnosis-2026-09-05.md` first: it is the question set, and
three of its six domains are still unanswered.

---

## 1. What this session actually changed

Every item below was verified here, not taken from a lane's report.

**The lane's answer was being thrown away.** codex-cli 0.153 returns the model's
answer as `item.completed` with `item.type: "agent_message"` and a plain string.
No branch matched it, so `dispatchCorleone` returned `stdoutLen: 0` while the raw
JSONL carried the text. File-writing packets never noticed because the files
landed; anything whose deliverable was TEXT came back empty. **That is why every
directive plan failed as "plan is too short", KOL-81 included.** Fixed, with a
test on the real event shape.

**The drift alarm was false.** steward looked for a scheduled task named
`FounderOS-Aidit-PM2-Resurrect`; the machine has `AiditOS-PM2-Resurrect`, Ready,
running as SYSTEM. The owner got a CRITICAL on Telegram every hour about a
healthy machine. Now `steward --once: 0 critical, 0 warning, 0 gap`.

**HATTA's worktree isolation was fictional.** The dispatcher set `cwd` to the
lane worktree, but `hatta/harness.mjs` derives its jail from its own location, so
the lane read and wrote the SHARED tree while the logs said isolated.

**The venture graph exists and can now refresh itself.** KOL-82 was approved and
committed (`95445d5`), the tree went clean, and the graph built: 4,263 nodes,
stamped at the venture's own HEAD, content check 10/10. `refreshVentureGraphsIfStale`
rebuilds at most one stale venture per sweep, skips a dirty tree, and holds a
thirty-minute floor.

**Venture files could never receive anchors.** The plan names
`ventures/<id>/src/x.py`; the venture graph says `src/x.py`. Nothing matched, and
the W8 content check read the venture's files under the Aidit OS root where they
do not exist. Both fixed; a venture file line now carries real symbols.

**The card lost its options.** It showed "2 pilihan … ada di DETAIL" — a count is
not the options, and the owner's own acceptance criterion says he must be able to
decide without opening anything else. The card now lists each option and marks
the recommended one.

**The specialist resolver was silent on this system's own work.** Nine classes,
none covering regression tests or venture metrics — the two most common tasks
here. Now `test-regression` and `venture-metrics` classify, inside the packet
budget.

Machine changes the owner approved: PM2 log rotation (10 MB, retain 5,
compressed, daily) and TEMP/TMP moved to `D:\Temp`.

---

## 2. What is NOT done, in the order it should be done

### 2.1 Finish the diagnosis (domains B, E, F)

C and D are answered in `docs/health-answers-C-D.md`. Still open:

- **B — drift**: run every self-check and decide, per finding, whether it is a
  real defect or a watchdog holding a stale expectation. steward is clean now;
  reconcile still reports `KOL-81: fold=(absent) parser=new`.
- **E — worker lanes and packets**: what is the measured limit before a packet is
  truncated or mangled, and what happens to a lane's tree when it fails halfway.
- **F — tools, MCP, backup and recovery**: which MCP servers actually connect,
  and **has a restore ever been performed?** As of today the answer is no. The
  ASUS archives and the H: backup have never been restored even once.

### 2.2 The correctness signal — belongs to health, not to automation

Nothing in this system measures whether a lane's work was CORRECT. `ok` means
exit 0 and nothing more: two runs that timed out today delivered usable work, and
CORLEONE once reported success having delivered 2 of 7 requested guards.

Until this exists, "prove it on real work" cannot be evaluated and automation
cannot be trusted. The cheapest honest version: record, per run, whether the
plan's VERIFY command passed and whether the files the plan named actually
changed. Both facts are already available at execution time.

### 2.3 Prove one venture directive end to end

KOL-81 sits at the plan-attempt cap with `OWNER_REQUIRED`. Its planning failed
for a reason that is now fixed, so it deserves one clean retry: plan → owner
approves → execute → verify → land, with nobody intervening mid-flight. Until
that has happened once, autonomy has no evidence behind it.

### 2.4 The worker fleet is one lane

Measured over three days, 31 runs: CORLEONE 22 runs, 95% exit-0, 15% of its time
wasted. HATTA 3 runs, 0% — it reached MAX_ITERATIONS twice today having written
nothing. SJAHRIR 3 runs, 80% wasted, one 480-second timeout. SOEKARNO works but
is read-only by design.

**This is an owner decision and it is not taken here:** either invest in making
HATTA useful, or accept a single writing lane and lower the nightly execution
ceiling from 6 to something one lane can actually deliver.

---

## 3. Owner-only, still open

- **KOL-79** — where per-run lane evidence lives. `lane-usage.jsonl` is still on
  one disk. W10 prepared the aggregate writer so his choice is a config change.
- **KOL-80** — which board becomes the single history. Less urgent now: the ASUS
  board is archived at `D:\Archive-ASUS-2026-09-05\asus-paperclip-board.zip`.
- The fleet decision in 2.4.
- Any write to a venture remote, real money, position sizing, risk limits, or
  leaving Phase 1.

## 4. Cleanup in flight

Backup to `H:\Backup-Lenovo-2026-09-05\` was still running when this was written:
about 1.5 GB of roughly 30 GB, `aidit dan ann` (29.4 GB) being the long pole.

**Nothing has been deleted, and nothing should be until every group verifies.**
The verification script compares file count and byte total per group; it already
caught an incomplete copy once, which is exactly why deletion waits for it. Re-run
it with:

    powershell -File <scratchpad>\verify-backup.ps1

Every line must read MATCH before a single source folder is removed.

## 5. Do not repeat these mistakes

- **Do not delete after "backup done".** Delete after MATCH. The first backup run
  reported success having copied 1.1 GB of 30 GB.
- **Do not run steward from a lane worktree.** The daemon lock files live in the
  main repo; from a worktree it reports the daemons dead and sends the owner a
  false CRITICAL. That happened today.
- **Do not hand a lane an inventory that is missing half the truth.** The
  adoption shortlist was built against 37 skills when the Lenovo actually had 147
  counting plugins, so seven of its ten proposals were things we already had.
- **Do not send HATTA a task that needs more than about four tool calls.** Its
  MAX_ITERATIONS is derived from 480s/120s and is correct; the packet has to fit
  it, not the other way round.
