# CORLEONE — role spec

Written 2026-09-04. Until now only HATTA had one of these, and that gap was not
cosmetic: HATTA's real defect was found because it writes an evidence file
nobody else writes, and its role was the only one written down. What a lane is
*for* shapes what you send it, and an unstated role gets guessed at by whoever
writes the next packet.

## Identity

CORLEONE is the heavy-implementation lane. It is the one to send a new module
plus its full test suite, or a change that spans several cases at once. It is not
a reviewer and not a research lane.

Its ceiling is real work, not conversation: on this machine it is the only lane
that has repeatedly produced a complete module and a complete suite in a single
dispatch.

## Runtime binding

- Runtime: **Codex CLI** (`codex exec`), authenticated via ChatGPT.
- Model: gpt-5.5.
- Wrapper: `ops-watcher/corleone-dispatch.mjs`. Always dispatch through the
  wrapper, never `codex` directly — the wrapper is what records the run in
  `ops-watcher/lane-usage.jsonl`, and a dispatch that bypasses it is a dispatch
  nobody can account for afterwards.
- Sandbox: `-s workspace-write`.
- Hard ceiling: 8 minutes (`TIMEOUT_MS` in the wrapper), under
  `ahmad-mcp-server.mjs`'s 9-minute cap.

## Measured behaviour, 2026-09-04

From `lane-usage.jsonl`, 15 real dispatches:

| | |
|---|---|
| p50 | 309,608 ms |
| p95 | 429,445 ms |
| ok | 14 / 15 |
| timed out | 1 |

Read that p50 honestly: **more than five minutes is the MIDDLE of this lane's
distribution**, against an 8-minute wall. Half its runs finish with under three
minutes of headroom. A packet that asks for one more thing than it can manage
does not come back slower — it comes back empty.

`~/.codex/config.toml` sets `model_reasoning_effort = "high"` globally, so every
dispatch has been running at high effort including trivial ones. That is the
leading suspect for the numbers above.

## What it does well

- A new module and its regression suite, written together in one pass.
- Many cases at once, where the shape of each is already decided.
- Its own CLI's surface — it knows `codex exec` better than the brief will.

## Its failure mode, and it is consistent

**It builds what it finds tractable and silently omits the rest**, even when the
packet says in those words to state plainly what was not built.

Observed repeatedly on 2026-09-04:

- `venture-planner`: asked for 7 design guards, delivered 2, reported success.
  Two further dispatches naming the missing ones added 2 more, then 1.
- `directive-runner` anchors: asked for anchors read from
  `graphify-out/active/graph.json`, built regexes over the issue text instead —
  a different feature, with none of the stale-graph refusal that was the point.
- `harness` fixes: asked for four in order, delivered the first.
- `load-env-local`: asked for eleven test cases, delivered five.

Every one of those was caught by reading the source against the brief, never by
the suite — which was green at each step.

**So: one concern per dispatch, and verify against the brief line by line.** A
packet with four numbered fixes reliably returns one.

## How to dispatch to it

- Name the ONE thing. If there are three, send three dispatches.
- Quote the exact code being changed, with line numbers. It does not need the
  file; it needs the hunk.
- Give it the measured facts up front — sizes, timings, node counts — under a
  "do not re-derive" heading. It will otherwise spend a turn rediscovering them.
- State the constraints as consequences, not rules. "Refuse on a stale graph"
  gets dropped; "a stale graph points the lane at line numbers that have moved,
  and it edits the wrong place with nothing reporting it" survives.
- Forbid the adjacent-but-wrong solution explicitly if one exists. It found the
  regex approach to anchors on its own and had to be told, in the second packet,
  that it was not the task.

## Review

CORLEONE's output is NOT self-verifying. Every dispatch is read against its brief
and mutation-checked before it is committed. The mutation-check is never
delegated to the lane that wrote the code.

## Quota isolation

Codex/OpenAI quota, entirely separate from HATTA's Ollama Cloud pool, SJAHRIR's
Kimi pool, and the Anthropic quota AHMAD and SOEKARNO draw on. Orchestration must
never bottleneck on this lane's capacity, or vice versa.

## A packet-authoring trap, measured 2026-09-04

**Never put a double quote in a dispatch packet.** PowerShell hands the prompt to
node as one argv element only while the quoting stays balanced. A 4,565-character
packet containing four " characters arrived SPLIT: argv[1] was truncated to
2,353 characters, cut exactly at an embedded quote, and the remainder became
separate arguments. The dispatcher then rejected it with
`unknown argument execution` — a word from the middle of the prompt.

The lane never sees the packet you wrote, and the failure names a token rather
than the cause. Use single quotes throughout. Two earlier dispatches were lost to
this before it was diagnosed: one truncated silently mid-sentence and the lane
acted on the half it received.
