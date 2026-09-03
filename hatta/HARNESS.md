# Hatta Harness

`hatta/harness.mjs` is a dependency-free Node.js ESM runner for Hatta. It uses Node 22 built-ins only and is scoped to:

```text
D:\AI\Active FounderOS-Aidit
```

## Run

Run a task:

```sh
node hatta/harness.mjs "<prompt>"
```

Run the security self-test without contacting Ollama:

```sh
node hatta/harness.mjs --selftest
```

Runtime defaults:

- Endpoint: `http://localhost:11434/api/chat`
- Endpoint override: `OLLAMA_HOST`
- Model: `glm-5.3:cloud`
- Model override: `OLLAMA_MODEL_HATTA`
- Iteration cap: `40`
- Iteration cap override: `HATTA_MAX_ITER`

## Tools

Hatta exposes four tools to the local Ollama chat endpoint:

- `read_file(path)`: reads a UTF-8 file relative to the workspace root.
- `write_file(path, content)`: writes a UTF-8 file relative to the workspace root and creates parent directories.
- `list_directory(path = ".")`: lists entries relative to the workspace root.
- `run_command(command, args)`: runs an allowlisted command with the working directory pinned to the workspace root.

All file paths are resolved against the workspace root. Paths outside the root return `ok:false`.

## Command Policy

Allowed top-level commands:

```text
git, node, npm, bun, rg, dir, type, echo
```

Denied behavior:

- Any command outside the allowlist.
- `git push`.
- `git --force`.
- `git reset --hard`.
- Any argument containing `rm `, `del `, `Remove-Item`, `format`, or `shutdown`.
- Any path-like argument resolving outside `D:\AI\Active FounderOS-Aidit`.

External commands run through `execFile` with `shell:false`, a 30 second timeout, and stdout/stderr truncated to 4000 characters in tool results. The Windows-style `dir`, `type`, and `echo` commands are handled internally so the harness never needs a shell for them.

## Evidence Schema

Every run prints exactly one JSON object as its final stdout line:

```json
{
  "ok": true,
  "iterations": 1,
  "model": "glm-5.3:cloud",
  "endpoint": "http://localhost:11434/api/chat",
  "toolCalls": [
    {
      "name": "read_file",
      "ok": true,
      "argsSummary": "{\"path\":\"README.md\"}",
      "resultSummary": "{\"path\":\"README.md\",\"contentLength\":1234}"
    }
  ],
  "filesWritten": ["hatta/example.txt"],
  "finalMessage": "Done.",
  "error": null,
  "startedAt": "2026-08-28T00:00:00.000Z",
  "finishedAt": "2026-08-28T00:00:01.000Z"
}
```

The caller should verify outcomes from this JSON evidence, especially `ok`, `toolCalls`, `filesWritten`, and `error`.

## Governance Boundary

This harness is Hatta's standalone local Ollama runtime. It must never touch Anthropic or Claude credentials, SDKs, CLIs, quotas, or endpoints. It must also never call OpenAI or Codex paths. Codex and Hatta are separate runtimes in this project.
