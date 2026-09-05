---
title: Lane Roster and Shapes
type: note
tags: [lanes, roster, runtime, kol-83]
---

# Lane Roster and Shapes

## Roster dari registry

- **AHMAD**: role "primary owner-facing orchestrator for Active FounderOS-Aidit — plans, inventories, delegates, reviews delegated output, escalates genuine owner decisions. Does not personally perform bulk implementation work."; machine "LENOVO-BLACK"; runtime "Claude Code CLI (claude.exe, this session's runtime)"; provider "anthropic".
- **HATTA**: role "primary technical executor for Active FounderOS-Aidit — implementation, file edits, research/build tasks delegated by Ahmad"; machine "LENOVO-BLACK"; runtime "Ollama Cloud, via the local Ollama daemon already running on this machine (`ollama.exe`, port 11434) proxying to https://ollama.com"; provider "ollama-cloud"; model "glm-5.3:cloud (primary); kimi-k2.7-code:cloud, glm-5.1:cloud, gpt-oss:20b-cloud also pulled and available as alternates on the same account".
- **GIBRAN**: role "Independent reviewer — verifies HATTA's material changes and other bounded evaluation tasks before they're marked done. Distinct Paperclip agent record (id ce433688, role reviewer, active) is the operational identity; this block documents its runtime binding."; machine "LENOVO-BLACK"; runtime "Hermes CLI, Nous Free lane (Nous Portal auth, model upstage/solar-pro4:free, inference endpoint https://inference-api.nousresearch.com/v1)"; provider "nous".
- **SJAHRIR**: role "strong implementation and analysis lane; K2.7 Code for normal coding/implementation; K3-256K only when heavier context/reasoning is genuinely required; AHMAD remains orchestrator."; machine "LENOVO-BLACK"; runtime "Kimi Code CLI (managed:kimi-code), direct/native — separate installation from HERMES's Nous-Free config"; provider "moonshot-kimi-code".
- **CORLEONE**: role "strong Codex CLI lane for implementation and review work dispatched by AHMAD; first-class Active FounderOS-Aidit agent as of the owner decision on 2026-09-01."; machine "LENOVO-BLACK"; runtime "Codex CLI, reached through `node ops-watcher/corleone-dispatch.mjs \"<prompt>\"`; the wrapper resolves the Windows npm `codex.cmd` shim to the real codex.js entry and spawns `node` directly with shell:false."; provider "openai"; model "gpt-5.5".
- **SOEKARNO**: role "Lenovo Claude Code lane for printed-text deliverables and review/analysis dispatched by AHMAD; first-class Active FounderOS-Aidit agent as of the owner decision on 2026-09-01."; machine "LENOVO-BLACK"; runtime "Claude Code CLI on the Lenovo (LENOVO-BLACK), run LOCALLY: soekarno-dispatch resolves the claude executable on this machine and spawns it directly. The Tailscale SSH route it used before the cutover is kept only for the case where the target host is a different machine."; provider "anthropic"; model "not recorded in this registry entry; runtime is Claude Code 2.1.252".

## Angka terukur dari handover

- "Measured over three days, 31 runs: CORLEONE 22 runs, 95% exit-0, 15% of its time wasted."
- "HATTA 3 runs, 0% — it reached MAX_ITERATIONS twice today having written nothing."
- "SJAHRIR 3 runs, 80% wasted, one 480-second timeout."
- "SOEKARNO works but is read-only by design."

## Sumber

- `config/agent-registry.json` - dibaca 2026-09-05
- `docs/handover-2026-09-05-health-first.md` - dibaca 2026-09-05 dari git history commit `eecf92d`
