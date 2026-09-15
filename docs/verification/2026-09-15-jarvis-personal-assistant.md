# JARVIS Personal Assistant — 2026-09-15 11:46 WIB

Built and shipped live in one session, on top of the already-running v5.1
harness. Plan: `C:\Users\WIN10\.claude\plans\untuk-telegram-gimana-untuk-witty-frog.md`.

## What's live now

1. **Chat, two channels, stateless by design** (`conductor/chat.mjs`,
   `chatReply()`): Telegram free text now gets a real answer (was a canned
   "noted" before); dashboard has a chat box at `/orchestrator`. Each
   message is a fresh one-shot (status snapshot + a budgeted graphify/gbrain
   lookup only when the message needs it) — no growing transcript, per the
   owner's explicit context-bloat concern. `chatHistoryTurns: 0` in
   `company.json` is the on/off switch if a short rolling window is wanted
   later. GLM by default; Sonnet escalation capped 5/day.
2. **Dashboard shows real data**: new `/orchestrator` page — board counts,
   lane health, today's usage per pool, open Asks, JARVIS score — all read
   from the live conductor state, not the seeded FounderOS DB. Works on
   phone width (Sidebar goes off-canvas below 768px, hamburger toggle in
   Topbar) and is already reachable from the owner's phone over the existing
   Tailscale link.
3. **Spoken reports**: 07:00/19:00 now also send a Telegram voice note
   (Piper TTS, already installed, both languages present) alongside the
   text. English/"Sir" is deliberate — `config/persona/register.yaml`'s
   `spoken:` block already specified this before today; the text report
   stays Indonesian/"Bapak".
4. **JARVIS score**: `conductor/score.mjs`, deterministic, no LLM calls.
   First real score: **72/100** (orchestrator 52, personal assistant 92).
   Shown on `/orchestrator` and the 19:00 report.

## Real bugs found and fixed along the way

- **tsconfig.json** was scanning `state/` (gitignored git worktrees —
  the SJS SuperApps clone and per-ticket worktrees of this same app),
  producing ~230 cascading type errors once `.next`'s cache was cleared.
  Added `state` to `exclude`; `npm run typecheck` is now genuinely clean.
- **`npm run build`/`test` must use the pinned Node 22**
  (`D:/aidit-node/node-v22.14.0-win-x64/node.exe`), not whatever `node` is
  first on PATH — `better-sqlite3`'s native binary is compiled against
  Node 22's ABI and silently fails to prerender under this shell's default
  Node 26. No code changes needed, just noting it here so a future session
  doesn't lose time to it.
- **A second, different 422** on the head.mjs → in_review transition
  (distinct from the PRD v5.1 s7 fix): intermittently rejected, then
  succeeded on a plain retry (reproduced manually). Fixed with a 3x
  backoff retry in `head.mjs` instead of letting it crash the whole head
  process. Found by the score system itself flagging it as the top drag —
  the score proved its worth before it was even wired into a UI.

## Verification

- `npm run typecheck`: clean (0 errors, confirmed after the tsconfig fix).
- `npm test`: **965/965 tests passing** (2 pre-existing Windows EBUSY
  file-lock flakes in unrelated `afterAll` teardown — not real failures,
  not caused by this work).
- Live, not simulated: `--report` sent a real text message and a real
  ~24kB voice note to Telegram (ledger: `owner.report ok:true`,
  `voice.report ok:true`); `/orchestrator` and
  `/api/orchestrator/status` return real board/lane/usage/score data on
  both `localhost:4200` and the real Tailscale URL
  (`https://lenovo-black.tailc7b60e.ts.net/orchestrator`, HTTP 200);
  `chat.mjs --stdin` answered three different real questions correctly
  (status, a code question via graphify, a "we don't know that" honest
  answer via gbrain) with clean, jargon-free replies.

## Commits (this session, in order)

`60ac3e7` chat backend · `712db39` Telegram wiring · `caddf4a` dashboard
connector · `d863058` dashboard page/mobile/chat/voice · `f70749b` head.mjs
422 retry fix · `e186800` JARVIS score.

## Known gaps / not built (by design, per the plan)

- Chat has no rolling history window yet (stateless-only, on purpose,
  pending the owner's call).
- Codex and Kimi token accounting still not wired into the ledger (a v5.1
  gap, unrelated to this build).
- **Two-way interactive phone calls** are explicitly a future roadmap item,
  not part of this build — needs its own PRD and Ask (telephony
  integration, per-minute cost, a phone number).
- Score thresholds are a documented first cut, not calibrated against a
  real baseline yet — recalibrate once a few days of real data exist.
