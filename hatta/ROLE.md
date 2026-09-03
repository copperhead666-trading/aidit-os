# HATTA — role spec

Created 2026-08-28 per explicit owner decision during the DELTA bootstrap mission.
Runtime corrected same day (see history below) — this file reflects the final,
current state only.

## Identity

HATTA is a new logical FounderOS agent, primary technical executor for the
`Active FounderOS-Aidit` workspace. It is not a rename of SOEHARTO and not a
repurposing of CORLEONE. It shares no credentials, workspace, or quota with
either.

## Runtime binding

- Runtime: **Ollama Cloud**, reached via the local Ollama daemon already
  running on this machine (`ollama.exe`, listening on `localhost:11434`),
  which proxies to `https://ollama.com` for an already-authenticated account.
- Primary model: `glm-5.3:cloud`. Also available on the same account:
  `kimi-k2.7-code:cloud`, `glm-5.1:cloud`, `gpt-oss:20b-cloud`.
- Machine: asus-control
- No new credential was created. Verified by reusing the existing session:
  `GET /api/tags` on the local daemon lists the four `:cloud` models with
  `remote_host: https://ollama.com` (only resolves when already signed in to
  Ollama Cloud), and a live `POST /api/chat` completion against
  `glm-5.2:cloud` succeeded 2026-08-28.
- Not yet built: a tool-execution harness (file read/write, shell) for Hatta
  in this workspace. Today Hatta can reason/chat live; it cannot yet act on
  the filesystem on its own. The legacy app's
  `D:\FounderOS-Aidit De Maestros\app\lib\dispatch\hatta.ts` +
  `tool-access/hatta-tools.ts` is a working reference pattern for that
  harness (system-prompt framing, tool-call loop, tool definitions) but is
  legacy-app-scoped code, not something this workspace reuses as-is.

## Workspace

`D:\AI\Active FounderOS-Aidit\hatta\workspace` — Hatta's scratch/working
directory for this project. Primary write scope is
`D:\AI\Active FounderOS-Aidit`. `D:\AI\Agentic` and
`D:\FounderOS-Aidit De Maestros` are read-only reference sources for
migration lookups only.

## Capacity / quota isolation

Hatta's Ollama Cloud Pro quota is a fully separate pool from Ahmad's
Anthropic Claude Code CLI quota, from Corleone's/OpenAI-Codex quota on
Lenovo, and from Soekarno's own account. Orchestration work done by Ahmad
must never consume or bottleneck on Hatta's execution capacity, and vice
versa. This isolation is a hard constraint from the mission brief.

## Review

No independent reviewer is currently assigned for Hatta's material changes.
Treat Hatta's own output as unreviewed until one is assigned.

## Runtime decision history

1. **2026-08-28 (initial):** Owner decided Hatta is a new agent, not a
   SOEHARTO rename or CORLEONE repurpose. Preferred initial runtime: Codex
   CLI on ASUS. Verified `codex-cli 0.149.0` authenticated via ChatGPT
   (`codex login status` → "Logged in using ChatGPT"). Ran one live
   `codex exec --sandbox workspace-write` dispatch that wrote a heartbeat
   file in `hatta/workspace/` — proved real end-to-end capability.
2. **2026-08-28 (correction, same day):** Owner corrected the runtime — Hatta
   must run on Ollama Cloud instead, as its own separate quota pool, not
   Codex. The Codex-labeled heartbeat file was deleted as stale/mislabeled.
   Ollama Cloud was inspected (found already authenticated and pulling
   `:cloud` models) and a live `glm-5.2:cloud` chat completion was run in its
   place as the current verification evidence.

## A note on a verification anomaly, and the real evidence instead

The live `glm-5.2:cloud` completion's internal reasoning trace once said
"I'm Claude, made by Anthropic" before correctly outputting the literal
string it was asked to echo. Per owner instruction, that kind of
model-generated text is explicitly NOT used as evidence of provider identity
either way here.

The actual quota-independence evidence is provider/runtime-level, captured
2026-08-28 (full detail in `config/agent-registry.json`'s
`HATTA.quota_independence_evidence`):

- **Distinct binary**: `ollama.exe` (PID 2764 at test time) vs `claude.exe`
  — separate vendor processes.
- **Distinct auth artifact**: an `~/.ollama/id_ed25519` keypair (existence
  confirmed, contents never read) vs AHMAD's Anthropic OAuth session — two
  unrelated identity systems.
- **Distinct live network destination**: during an actual `glm-5.2:cloud`
  call, `netstat` showed `ollama.exe` connected to `34.36.133.15:443`
  (external, consistent with Ollama's own `remote_host: https://ollama.com`
  metadata) while `claude.exe`'s own connections in the same snapshot went
  to entirely different IPs under a different PID. Zero overlap.

That's the evidence base for "Hatta never inherits Ahmad's Claude
quota/runtime" — not anything either model said about itself.

## Relationship to look-alike names elsewhere

- `D:\FounderOS-Aidit De Maestros\app\lib\dispatch\hatta.ts` — the legacy
  app's own "hatta" worker, also GLM-5.2 via Ollama Cloud, its "Kepala
  Project" lead role for the legacy app's own ventures. Same runtime family,
  but that file's code, system prompt, and tool harness are legacy-app-scoped
  and are a read-only reference, not reused as-is by this workspace's Hatta.
- `SOEHARTO` in `D:\AI\Agentic\config\agent-registry.json` — retired from the
  active roster by owner instruction. Not renamed into or merged with Hatta.
