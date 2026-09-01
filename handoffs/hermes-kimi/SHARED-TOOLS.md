# SHARED TOOLS INVENTORY + AVAILABILITY (Phase E) — 2026-08-28

## Existing tool surfaces (verified on disk / in config)

### HATTA harness tools (hatta/harness.mjs)
- read_file, write_file, list_directory — workspace-scoped (D:\AI\Active FounderOS-Aidit only)
- run_command — allowlist: git, node, npm, bun, rg, dir, type, echo; shell=false; 30s timeout;
  deny: git push, --force, reset --hard, rm/del/Remove-Item/format/shutdown; path-escape guard.
- Endpoint guard: OLLAMA_HOST must be localhost.

### GBrain CLI (knowledge lane)
- put/capture/list/get/search/query/ask/import/export/sync — local, free (ollama nomic-embed-text).
- Shared read across roster; write via GBRAIN-CURATOR or task-packet-scoped writes.

### Graphify CLI (structural intelligence)
- query/path/explain/diagnose/tree over graphify-out/active + legacy graphs.
- Read-only by nature. GRAPHIFY-ANALYST is nominal owner but any role may query.

### Paperclip
- API 127.0.0.1:3101 (canonical) — issues, agents, projects, labels, comments, runs.
- CLI `paperclipai` (npm global): db:backup, heartbeat, token, agent/issue/project/goal ops.
- Write authority: PAPERCLIP-OPERATOR for admin/config; task-scoped writes for workers;
  verdict attribution for GIBRAN; Ahmad for orchestration state.

### Legacy read-only tool patterns (D:\AI\Agentic\scripts, do not rebuild)
- probe-worker.js — worker availability probe.
- lenovo-transport-adapter.js — SSH transport (scarce review lane).
- check-lenovo.ps1 — machine reachability.
- task-store.js, refresh-project-status.js — old task/status patterns (port as needed).
- dispatch-worker.js — reference for cheap-lane HTTP dispatch (kimi-free pattern).

### GIBRAN
- Distinct Paperclip agent id (ce433688-4e0d-4902-addd-b7d27eb081b7) for verdict attribution;
  spec at .paperclip/.../agents/gibran/AGENTS.md. No write tools beyond verdict recording.

## Availability policy
1. No raw secrets to any worker. Credentials resolve server-side only
   (Paperclip secrets dir, GBrain local, DB via env — never handed to agents).
2. Destructive/security/financial actions remain owner-gated
   (permission-model.md three tiers).
3. Runtime takeover: if one lane exhausts quota, another eligible lane takes the
   same role by lane re-binding in the task packet — never by silently switching
   identity. Record actual lane used in run evidence.
4. No bulk enabling of risky write actions: current allowlists stay as-is unless
   owner approves expansion.
5. New shared tools get added by (a) thin wrapper script under
   `D:\AI\Active FounderOS-Aidit\tools\` (new dir), (b) registration note in this
   file, (c) GBrain ingest.
