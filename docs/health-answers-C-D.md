# C1

Evidence:

- `ops-watcher/decision-brief.mjs:80-85` defines `validateDecisionBrief(input)` and rejects non-object briefs with all required slots missing.
- `ops-watcher/decision-brief.mjs:88-105` validates `pertanyaan` as a real question and requires at least one sourced `yang_sudah_ada` entry.
- `ops-watcher/decision-brief.mjs:203-208` calls `validateDecisionBrief` before building the persisted `[DECISION BRIEF]` comment body.
- `ops-watcher/ahmad-escalate.mjs:92-110` validates the brief before label work; `ops-watcher/ahmad-escalate.mjs:120-173` adds `OWNER_REQUIRED` only after that validation path and confirms the label by re-read; `ops-watcher/ahmad-escalate.mjs:194-212` posts the structured brief.
- `ops-watcher/raise-decision.mjs:87-100` validates before creating an issue; `ops-watcher/raise-decision.mjs:128-135` hands the created issue to `ahmad-escalate` with the validated brief.
- `ops-watcher/directive-runner.mjs:940-944` says this file adds `OWNER_REQUIRED` in two places: the plan-attempt cap and execution cap, and both build the same five slots.
- Plan-attempt cap: `ops-watcher/directive-runner.mjs:1532-1563` posts or reuses a brief before adding `OWNER_REQUIRED`; if the brief fails or does not land, it records an error and adds no bare card.
- Execution cap: `ops-watcher/directive-runner.mjs:1747-1764` calls `postGatedBrief` before the execution-cap label path and skips labeling if the brief is refused or not posted.
- `ops-watcher/escalation-sec.mjs:282-320` posts or reuses a gated brief before labeling; `ops-watcher/escalation-sec.mjs:322-338` ensures and patches `OWNER_REQUIRED` only after that gate.
- `ops-watcher/owner-gate.mjs:42-55` validates producer briefs with the same `validateDecisionBrief`; `ops-watcher/owner-gate.mjs:64-77` writes either the brief or an explicit refusal.

Verdict: PASS

# C2

Evidence:

- Command:

```text
node --input-type=module -e "import {buildMessageText} from './ops-watcher/telegram-notify.mjs'; const brief={pertanyaan:'Apakah Anda memilih rencana komisi bertingkat untuk Caveman?',yang_sudah_ada:[{kutipan:'Komisi lama belum punya keputusan final.',sumber:'PACKET test fixture'}],pilihan:[{key:'flat',label:'Komisi flat',konsekuensi:'Lebih sederhana.'},{key:'tiered',label:'Bertingkat 2-5%',konsekuensi:'Lebih presisi.'}],rekomendasi:{pilihan:'tiered',alasan:'Cocok dengan risiko bertahap.'},kalau_didiamkan:'Pekerjaan tetap tertahan dan angka lama terus dipakai.'}; console.log(buildMessageText({title:'Generic title'}, 'KOL-TEST', brief));"
```

- Output:

```text
Perlu keputusan Anda - KOL-TEST

Apakah Anda memilih rencana komisi bertingkat untuk Caveman?

*Saran:* Bertingkat 2-5%
Cocok dengan risiko bertahap.

*Kalau didiamkan:* Pekerjaan tetap tertahan dan angka lama terus dipakai.

2 pilihan - keadaan sekarang dan sumbernya ada di DETAIL.
```

- `ops-watcher/telegram-notify.mjs:203-222` renders the brief question, recommendation label/reason, cost of waiting, and only the count of choices plus a pointer to DETAIL.
- The rendered card does not carry the option labels or consequences themselves; they are only available through DETAIL.

Verdict: FAIL

# C3

Evidence:

- `ops-watcher/directive-runner.mjs:1098-1106` names the richer listener actions and states the plan card supports approving, revising, answering in the owner's own words, or declining.
- `ops-watcher/directive-runner.mjs:1107-1112` declares plan-card action flags: `allow_accept`, `allow_edit`, `allow_respond`, and `allow_ignore`.
- `ops-watcher/directive-runner.mjs:1117-1122` declares cap-escalation action flags with `allow_accept: false`, so the accept action is absent where accepting would rerun a failed plan.
- `ops-watcher/directive-runner.mjs:1124-1138` renders buttons only when the corresponding action flag is allowed, with DETAIL and DEFER always available.
- `ops-watcher/telegram-notify.mjs:121-142` first honors dynamic decision options, otherwise parses escalation action declarations and returns `buttonsForActions(shortId, actions)` instead of the default button set.
- `ops-watcher/telegram-listener.mjs:1404-1436` implements EDIT as a revision request, records it, removes SETUJUI, and leaves TOLAK/DETAIL/TUNDA.
- `ops-watcher/telegram-listener.mjs:1439-1455` implements RESPOND as a free-text owner reply path with no state change and keeps SETUJUI/TOLAK/DETAIL/TUNDA.
- `ops-watcher/telegram-listener.mjs:1298-1316` implements REJECT as status `cancelled` plus `OWNER_REJECTED`.
- `ops-watcher/telegram-listener.mjs:1471-1486` implements DEFER as a comment with no state change and then keeps SETUJUI/TOLAK/DETAIL.
- Regression evidence from `ops-watcher/escalation-actions.regression.test.mjs:102-103`: a card rendered from declared actions includes `SETUJUI`, `UBAH RENCANA`, `BALAS`, `DETAIL`, `TUNDA`, and excludes undeclared `TOLAK`.

Verdict: PASS

# C4

Evidence:

- The executor lock is `ops-watcher/directive-runner.lock`, defined at `ops-watcher/directive-runner.mjs:103-107`.
- `ops-watcher/directive-runner.mjs:1207-1211` states the whole sweep is single-instance: the lock is taken before any read, write, dispatch, or execution, and a concurrent invocation does no Paperclip read/write and no execution.
- `ops-watcher/directive-runner.mjs:1232-1245` acquires the lock and returns `{ lockRefused: true, pid }` when another sweep is already in progress.
- Command:

```text
node --input-type=module -e "import {runDirectiveSweepOnce} from './ops-watcher/directive-runner.mjs'; const r=await runDirectiveSweepOnce({acquireLock:async()=>({acquired:false,pid:4242}),releaseLock:async()=>{throw new Error('should not release')},isAlive:async()=>true,log:(m)=>console.log(m),base:'http://unused'}); console.log(JSON.stringify(r));"
```

- Output:

```text
directive-runner: REFUSING to run - another sweep is already in progress (pid=4242). Remove directive-runner.lock only if you are sure it is stale. No Paperclip reads/writes performed, no file changed.
{"lockRefused":true,"pid":4242,"errors":[]}
```

Verdict: PASS

# D3

Evidence:

- Required source command:

```text
Get-ChildItem -LiteralPath ops-watcher/lane-usage.jsonl -Force
```

- Output:

```text
Cannot find path 'D:\AI\worktrees\lane-corleone\ops-watcher\lane-usage.jsonl' because it does not exist.
```

- `ops-watcher/lane-usage.mjs:28-31` defines the default live log path as `ops-watcher/lane-usage.jsonl`.
- `ops-watcher/lane-usage-aggregate.mjs:65-93` would compute per-lane runs, ok count, timeout count, total duration, and wasted duration from run records, but the required input file is absent.
- A separate historical import exists: `state/import/lane-usage.jsonl` has 207 lines, from command `(Get-Content -LiteralPath state/import/lane-usage.jsonl | Measure-Object -Line).Lines`. That is not the required `ops-watcher/lane-usage.jsonl` source named in the packet.

Verdict: UNKNOWN

# D4

Evidence:

- `ops-watcher/lane-usage.mjs:12-15` says lane usage is count/pattern tracking, not correctness measurement.
- `ops-watcher/lane-usage.mjs:35-37` describes the original per-run fields as `ts`, `lane`, `promptLength`, `ok`, `timedOut`, `exitCode`, and `durationMs`.
- `ops-watcher/lane-usage-aggregate.mjs:69-72` derives lane identity, duration, `isOk` from `run.ok === true`, and timeout from `run.timedOut === true`.
- `ops-watcher/lane-usage-aggregate.mjs:129` renders the warning: `ok means exit 0 only.`
- `agents/CORLEONE-ROLE.md:94-96` says CORLEONE output is not self-verifying and must be read against the brief and mutation-checked before commit.
- `agents/SJAHRIR-ROLE.md:85-87` says SJAHRIR output is not self-verifying and must be checked by someone other than the lane that wrote it.
- `docs/prd/backlog-handover-2026-09-05.md:164-168` states that 65% of 236 recorded lane runs exited ok, but `ok` only means exit 0, two timed-out runs produced usable work, one CORLEONE success delivered only 2 of 7 requested guards, and the real correctness rate is lower and unmeasured.
- This matters because routing and unattended execution can otherwise treat exit-zero as useful work even when the work is incomplete or wrong.

Verdict: UNKNOWN
