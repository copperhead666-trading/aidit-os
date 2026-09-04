# SJAHRIR — role spec

Written 2026-09-04, alongside `agents/CORLEONE-ROLE.md`, closing the gap where
only HATTA had a written role.

## Identity

SJAHRIR is the heavy-context lane: research, reading, and precise work on a
SMALL number of files. It is not the lane for a new module and its whole suite —
that is CORLEONE — and it is not the lane for a large file.

## Runtime binding

- Runtime: **Kimi Code CLI** (`kimi -p`).
- Wrapper: `ops-watcher/sjahrir-dispatch.mjs`. Always dispatch through the
  wrapper. It runs `--output-format stream-json` and parses the stream, which is
  the only reason this lane reports turns at all.
- Hard ceiling: 8 minutes (`TIMEOUT_MS`), under `ahmad-mcp-server.mjs`'s 9-minute
  cap.
- Weekly quota. It has been exhausted before; check before planning a long run.

## Measured behaviour, 2026-09-04

From `lane-usage.jsonl`, 8 real dispatches:

| | |
|---|---|
| p50 | 199,047 ms |
| p95 | 480,071 ms |
| ok | 5 / 8 |
| timed out | **3** |

That p95 is the 8-minute wall. Three failures in eight runs, every one of them a
timeout.

## THE FAILURE MODE, AND IT IS MEASURABLE

**All three timeouts were dispatches that required reading TWO ~450-line files.**

That is HATTA's disease in a different lane: the limit is the volume it must read
before it can start, not the difficulty of the work. It was found because a human
noticed the same shape across three separate reports — not by anything measuring
it, which is exactly why `turns` and byte counts now reach `lane-usage.jsonl`.

Concretely, on 2026-09-04:

- `venture-planner` guards: dispatched twice, both times required reading
  `venture-planner.mjs` (~450 lines) and its suite (~450 lines). Both timed out
  at 480s **having written nothing at all**. The same guard went to CORLEONE and
  landed first try.
- One packet came back reporting it had arrived **truncated mid-sentence** —
  "Guard A's spec came through complete, but the Guard B section never arrived".
  A long packet is not merely slow here; it can be silently cut.

Against that: when given ONE small file and one concern, it has been the most
reliable lane on this machine — the graph-staleness guard, the graph stamp
writer, and the cockpit PM2 shim all landed correctly on the first attempt.

## How to dispatch to it

- **One concern, one or two SMALL files.** This is not a style preference; it is
  the line between a first-attempt success and a 480s timeout that writes nothing.
- Never ask it to read two large files. If the work spans two ~450-line files,
  send it to CORLEONE instead.
- Keep the packet short. Long packets have arrived truncated, and it will act on
  the half it received without knowing the rest is missing.
- Quote the exact lines to change with their line numbers, and tell it to use
  `read_file` with `offset` and `limit` rather than reading whole files.

## What it does well

- A single precise edit with the text pre-computed.
- Writing a test file against an interface it has been handed.
- Research and reading, where the reading is the deliverable.

## Its other failure mode

Like CORLEONE, it under-delivers rather than reporting the shortfall: asked for
four test cases it has returned two, asked for eleven it has returned five. The
cases it does write have been correct and have caught their mutations. Check the
count against the brief.

## Review

SJAHRIR's output is NOT self-verifying. Every dispatch is read against its brief
and mutation-checked before it is committed, by someone other than the lane that
wrote it.

## Quota isolation

Kimi/Moonshot quota, separate from CORLEONE's Codex pool, HATTA's Ollama Cloud
pool, and the Anthropic quota AHMAD and SOEKARNO draw on.
