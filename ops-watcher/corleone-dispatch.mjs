// ops-watcher/corleone-dispatch.mjs
// Thin node-wrapper relay around the `codex` (CORLEONE) CLI. Exists because
// headless AHMAD's only execution tool (run_command in ahmad-mcp-server.mjs)
// requires exe === "node" + a fixed allowlisted .mjs script, so a bare `codex`
// binary can never be invoked directly. This wrapper keeps the existing
// node+allowlist security boundary intact (no widening exe to arbitrary
// binaries) while letting AHMAD actually reach CORLEONE.
//
//   node ops-watcher/corleone-dispatch.mjs "<prompt>"
//
// === Windows .cmd-shim handling (the bug this fixes) ===
// On this machine `codex` resolves to an npm-global `codex.cmd` batch shim (not a
// native .exe). Two naive fixes both fail:
//   1. spawnSync("codex", [...]) with NO shell -> spawnSync codex ENOENT
//      (CreateProcess does not search PATHEXT, so the bare name never reaches
//      the .cmd).
//   2. spawnSync("codex", [...]) with shell:true -> resolves the ENOENT, BUT on
//      Node v22.14.0 `shell:true` does NOT quote/escape args-array elements: it
//      naively joins them with spaces and hands the line to cmd.exe, which
//      WORD-SPLITS any arg containing spaces (verified live: a single
//      "Reply with exactly the text OK ..." arg arrived as 11 separate args)
//      and would also expand %VAR% / split on & | < >. For a FREE-FORM task
//      prompt that is unsafe and broken (codex rejects it with
//      "unexpected argument 'with'"). (routing.mjs's runSpawnReal uses shell:true
//      safely ONLY because it probes `codex --version` — a single token with no
//      spaces; that does not generalize to a multi-word prompt.)
// The robust fix: bypass the .cmd shim entirely. The npm shim just runs
// `node "<npm-global>\node_modules\@openai\codex\bin\codex.js" %*`; we resolve
// that codex.js entry from the .cmd, then spawn `process.execPath` (node)
// DIRECTLY on it with shell:false. With shell:false Node passes the args array
// VERBATIM to CreateProcess — no cmd.exe parsing at all, so a prompt with
// spaces / quotes / % / & is preserved exactly and safely. On non-Windows,
// `codex` is a real executable / shebang script, so we spawn it directly as
// before (shell defaults to false).

import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

const IS_WIN = process.platform === "win32";

// On Windows, find the real codex.js entry script that the npm `codex.cmd`
// shim wraps, so we can spawn node on it directly (bypassing cmd.exe). Returns
// an absolute path to codex.js, or null if not found (caller then falls back to
// spawning `codex` directly). Reads the .cmd and extracts the
// `node_modules\...\codex.js` path it invokes (adapts to package-name changes
// without hardcoding @openai/codex).
export function resolveCodexEntry() {
  if (!IS_WIN) return null;
  const dirs = (process.env.PATH || "").split(";");
  for (const dir of dirs) {
    if (!dir) continue;
    const cmd = path.join(dir, "codex.cmd");
    let txt;
    try { txt = fs.readFileSync(cmd, "utf8"); } catch { continue; }
    // npm's .cmd ends with: ... "%_prog%"  "%dp0%\node_modules\...\codex.js" %*
    const m = txt.match(/node_modules[\\/][^\s"]*\.js/i);
    if (!m) continue;
    const entry = path.join(dir, m[0]);
    try { fs.accessSync(entry); } catch { continue; }
    return entry;
  }
  return null;
}

export function buildCodexInvocation(prompt, deps = {}) {
  const codexJs = deps.codexJs === undefined ? resolveCodexEntry() : deps.codexJs;
  if (codexJs) {
    return {
      file: process.execPath,
      args: [codexJs, "exec", "-s", "workspace-write", prompt],
      options: {},
    };
  }
  return {
    file: "codex",
    args: ["exec", "-s", "workspace-write", prompt],
    options: {},
  };
}

export async function dispatchCorleone(prompt, deps = {}) {
  const _spawnSync = deps.spawnSync || spawnSync;
  const _guardLaneStart = deps.guardLaneStart || guardLaneStart;
  const _recordLaneOutcome = deps.recordLaneOutcome || recordLaneOutcome;
  const _logLaneUsage = deps.logLaneUsage || logLaneUsage;
  const _resolveCodexEntry = deps.resolveCodexEntry || resolveCodexEntry;
  const now = deps.now || Date.now;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;

  const guard = await _guardLaneStart("corleone");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    const diagnostic = `corleone-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`;
    await _logLaneUsage({ lane: "corleone", promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    return { ok: false, skipped: true, reason, stdout: "", stderr: "", diagnostic, exitCode: 3 };
  }

  // `-s workspace-write` allows Codex to write files within the repo without
  // interactive approval (confirmed via `codex exec --help`). Deliberately NOT
  // using --dangerously-bypass-approvals-and-sandbox (documented as extremely
  // dangerous, out of scope here).
  const { file, args } = buildCodexInvocation(prompt, { codexJs: _resolveCodexEntry() });
  const t0 = now();
  const r = _spawnSync(file, args, {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = now() - t0;
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    const diagnostic = `corleone-dispatch: codex timed out after ${timeoutMs}ms\n`;
    await _recordLaneOutcome("corleone", { ok: false, stdout, stderr, timedOut: true });
    await _logLaneUsage({ lane: "corleone", promptLength: prompt.length, ok: false, timedOut: true, exitCode: 1, durationMs, stdout, stderr });
    return { ok: false, stdout, stderr, timedOut: true, diagnostic, exitCode: 1 };
  }
  if (r.error) {
    const err = r.error && r.error.message ? r.error.message : String(r.error);
    const effectiveStderr = stderr || err;
    const diagnostic = `corleone-dispatch: failed to spawn codex: ${err}\n`;
    await _recordLaneOutcome("corleone", { ok: false, stdout, stderr: effectiveStderr });
    await _logLaneUsage({ lane: "corleone", promptLength: prompt.length, ok: false, exitCode: 1, durationMs, stdout, stderr: effectiveStderr });
    return { ok: false, stdout, stderr: effectiveStderr, timedOut: false, diagnostic, exitCode: 1 };
  }

  const exitCode = typeof r.status === "number" ? r.status : 1;
  await _recordLaneOutcome("corleone", { ok: exitCode === 0, stdout, stderr });
  await _logLaneUsage({ lane: "corleone", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs, stdout, stderr });
  return { ok: exitCode === 0, stdout, stderr, timedOut: false, exitCode };
}

async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/corleone-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }

  const result = await dispatchCorleone(prompt);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.diagnostic) process.stderr.write(result.diagnostic);
  const resultExitCode = typeof result.exitCode === "number" ? result.exitCode : result.ok ? 0 : 1;
  process.exit(resultExitCode);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) main();
