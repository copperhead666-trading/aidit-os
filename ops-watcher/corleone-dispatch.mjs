// ops-watcher/corleone-dispatch.mjs
// Thin node-wrapper relay around the `codex` (CORLEONE) CLI. Exists because
// headless AHMAD's only execution tool (run_command in ahmad-mcp-server.mjs)
// requires exe === "node" + a fixed allowlisted .mjs script, so a bare `codex`
// binary can never be invoked directly. This wrapper keeps the existing
// node+allowlist security boundary intact (no widening exe to arbitrary
// binaries) while letting AHMAD actually reach CORLEONE.
//
//   node ops-watcher/corleone-dispatch.mjs "<prompt>" [--effort low|medium|high]
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
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { ensureLaneWorktree } from "./lane-worktree.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

const IS_WIN = process.platform === "win32";
const ALLOWED_REASONING_EFFORTS = new Set(["low", "medium", "high"]);
// Default to medium per invocation: global high has made every dispatch pay a
// large latency tax, while defaulting to low can under-think broad repo tasks
// in a way that costs more than the saved seconds. Callers can still override.
export const DEFAULT_REASONING_EFFORT = "medium";

function scalarOrNull(value) {
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return null;
}

function findScalarByKey(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScalarByKey(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const scalar = scalarOrNull(value[key]);
      if (scalar !== null) return scalar;
    }
  }
  for (const item of Object.values(value)) {
    const found = findScalarByKey(item, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function setIfReported(cli, field, value) {
  const scalar = scalarOrNull(value);
  if (scalar !== null) cli[field] = scalar;
}

function collectContentText(content, out) {
  if (typeof content === "string") {
    out.push(content);
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) collectContentText(item, out);
    return;
  }
  if (!content || typeof content !== "object") return;
  if (typeof content.text === "string" && (!content.type || content.type === "output_text" || content.type === "text")) {
    out.push(content.text);
  }
  if (content.content !== undefined) collectContentText(content.content, out);
}

function collectReadableText(event, out) {
  const type = typeof event.type === "string" ? event.type : "";
  if ((type.includes("message") || type === "final_answer") && typeof event.message === "string") {
    out.push(event.message);
  }
  if ((type.includes("message") || type === "final_answer") && event.content !== undefined) {
    collectContentText(event.content, out);
  }
  if (event.item && typeof event.item === "object" && event.item.type === "message") {
    collectContentText(event.item.content, out);
  }
  // codex-cli 0.153 emits the model's answer as
  //   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
  // and NOTHING above matches that shape: the item type is agent_message, not
  // message, and the text is a plain string, not a content array. So every
  // answer came back empty.
  //
  // Measured 2026-09-05: `dispatchCorleone("Reply with exactly: OBJECTIVE: test")`
  // returned { ok: true, stdoutLen: 0 } while the raw JSONL carried
  // "OBJECTIVE: test". File-writing packets never noticed — the files landed —
  // but every task whose DELIVERABLE IS TEXT silently returned nothing. That is
  // why directive planning failed as "plan is too short" on attempt after
  // attempt: the lane answered, and the wrapper dropped the answer.
  if (event.item && typeof event.item === "object" && event.item.type === "agent_message") {
    if (typeof event.item.text === "string" && event.item.text.trim()) out.push(event.item.text);
    else collectContentText(event.item.content, out);
  }
}

function nullCliDetail(effort = null) {
  return {
    reasoningEffort: effort,
    sessionId: null,
    model: null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
  };
}

export function parseCodexExecJsonl(stdout, options = {}) {
  const cli = nullCliDetail(options.effort ?? null);
  let turnStarted = 0;
  let turnCompleted = 0;
  let explicitTurns = null;
  const turnIds = new Set();
  const readable = [];

  for (const rawLine of String(stdout || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;

    const type = typeof event.type === "string" ? event.type : "";
    if (type === "turn.started") turnStarted++;
    if (type === "turn.completed") turnCompleted++;
    if (Number.isFinite(event.turns)) explicitTurns = event.turns;
    if (Number.isFinite(event.turn_count)) explicitTurns = event.turn_count;
    if (Number.isFinite(event.turnCount)) explicitTurns = event.turnCount;
    const turnId = findScalarByKey(event, ["turn_id", "turnId"]);
    if (turnId !== undefined) turnIds.add(String(turnId));

    setIfReported(cli, "sessionId", findScalarByKey(event, ["session_id", "sessionId", "thread_id", "conversation_id"]));
    setIfReported(cli, "model", findScalarByKey(event, ["model"]));
    setIfReported(cli, "inputTokens", findScalarByKey(event, ["input_tokens", "inputTokens"]));
    setIfReported(cli, "cachedInputTokens", findScalarByKey(event, ["cached_input_tokens", "cachedInputTokens"]));
    setIfReported(cli, "outputTokens", findScalarByKey(event, ["output_tokens", "outputTokens"]));
    setIfReported(cli, "reasoningOutputTokens", findScalarByKey(event, ["reasoning_output_tokens", "reasoningOutputTokens"]));
    setIfReported(cli, "totalTokens", findScalarByKey(event, ["total_tokens", "totalTokens"]));
    collectReadableText(event, readable);
  }

  const countedTurns = turnStarted || turnCompleted ? Math.max(turnStarted, turnCompleted) : null;
  const turns = explicitTurns ?? countedTurns ?? (turnIds.size > 0 ? turnIds.size : null);
  const readableStdout = readable.length > 0 ? `${readable.join("\n").replace(/\n*$/, "")}\n` : "";
  return { turns, cli, readableStdout };
}

export function normalizeReasoningEffort(effort) {
  const value = effort ?? DEFAULT_REASONING_EFFORT;
  return ALLOWED_REASONING_EFFORTS.has(value) ? value : null;
}

export function parseDispatchArgs(argv) {
  const [prompt, ...rest] = argv;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return { ok: false, exitCode: 2, diagnostic: 'usage: node ops-watcher/corleone-dispatch.mjs "<prompt>" [--effort low|medium|high]\n' };
  }

  let effort = DEFAULT_REASONING_EFFORT;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--effort") {
      effort = rest[++i];
    } else if (typeof arg === "string" && arg.startsWith("--effort=")) {
      effort = arg.slice("--effort=".length);
    } else {
      return { ok: false, exitCode: 2, diagnostic: `corleone-dispatch: unknown argument ${arg}\n` };
    }
  }

  if (!ALLOWED_REASONING_EFFORTS.has(effort)) {
    return { ok: false, exitCode: 2, diagnostic: `corleone-dispatch: invalid --effort ${effort}; expected low, medium, or high\n` };
  }
  return { ok: true, prompt, effort };
}

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
  const effort = normalizeReasoningEffort(deps.effort);
  const args = ["exec", "--json", "-c", `model_reasoning_effort=${effort}`, "-s", "workspace-write", prompt];
  if (codexJs) {
    return {
      file: process.execPath,
      args: [codexJs, ...args],
      options: {},
    };
  }
  return {
    file: "codex",
    args,
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
  const effort = normalizeReasoningEffort(deps.effort);

  if (!effort) {
    const diagnostic = `corleone-dispatch: invalid --effort ${deps.effort}; expected low, medium, or high\n`;
    return { ok: false, stdout: "", stderr: "", diagnostic, exitCode: 2 };
  }

  const runId = typeof deps.runId === "string" && deps.runId.trim()
    ? deps.runId
    : (typeof process.env.LANE_RUN_ID === "string" && process.env.LANE_RUN_ID.trim() ? process.env.LANE_RUN_ID : randomUUID());

  const guard = await _guardLaneStart("corleone");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    const diagnostic = `corleone-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`;
    await _logLaneUsage({ lane: "corleone", runId, promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    return { ok: false, skipped: true, reason, stdout: "", stderr: "", diagnostic, exitCode: 3, runId };
  }

  // `-s workspace-write` allows Codex to write files within the repo without
  // interactive approval (confirmed via `codex exec --help`). Deliberately NOT
  // using --dangerously-bypass-approvals-and-sandbox (documented as extremely
  // dangerous, out of scope here).
  const { file, args } = buildCodexInvocation(prompt, { codexJs: _resolveCodexEntry(), effort });
  // WORKTREE ISOLATION. Each writing lane runs in its OWN git worktree, never in
  // the shared repository root.
  //
  // CLAUDE.md has required this since it was written and it was never built: on
  // 2026-09-04 `grep -rn worktree` across ops-watcher/ and scripts/ returned one
  // line, and it was a comment. All three dispatchers used cwd: REPO_ROOT, so
  // every lane wrote into the same tree at the same time. Two deliberately
  // broken commits shipped that day because a commit landed in the middle of
  // another lane's mutation-check: the file changed under the check, the check
  // passed, and the wrong thing was committed.
  //
  // ensureLaneWorktree never throws. If a worktree cannot be created it returns
  // the shared root with isolated:false and a reason, which is logged rather
  // than swallowed — a silent fallback would rebuild the exact bug this
  // prevents, behind a module everyone assumes is protecting them.
  const workspace = (deps.ensureLaneWorktree || ensureLaneWorktree)("corleone");
  if (!workspace.isolated) process.stderr.write(`corleone-dispatch: ${workspace.reason}
`);
  const t0 = now();
  const r = _spawnSync(file, args, {
    cwd: workspace.path,
    windowsHide: true,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = now() - t0;
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  const parsed = parseCodexExecJsonl(stdout, { effort });
  const usageDetail = {
    lane: "corleone",
    runId,
    promptLength: prompt.length,
    durationMs,
    stdout,
    stderr,
    turns: parsed.turns,
    cli: parsed.cli,
  };

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    const diagnostic = `corleone-dispatch: codex timed out after ${timeoutMs}ms\n`;
    await _recordLaneOutcome("corleone", { ok: false, stdout, stderr, timedOut: true });
    await _logLaneUsage({ ...usageDetail, ok: false, timedOut: true, exitCode: 1 });
    return { ok: false, stdout: parsed.readableStdout, stderr, timedOut: true, diagnostic, exitCode: 1, turns: parsed.turns, cli: parsed.cli, runId };
  }
  if (r.error) {
    const err = r.error && r.error.message ? r.error.message : String(r.error);
    const effectiveStderr = stderr || err;
    const diagnostic = `corleone-dispatch: failed to spawn codex: ${err}\n`;
    await _recordLaneOutcome("corleone", { ok: false, stdout, stderr: effectiveStderr });
    await _logLaneUsage({ ...usageDetail, ok: false, exitCode: 1, stderr: effectiveStderr });
    return { ok: false, stdout: parsed.readableStdout, stderr: effectiveStderr, timedOut: false, diagnostic, exitCode: 1, turns: parsed.turns, cli: parsed.cli, runId };
  }

  const exitCode = typeof r.status === "number" ? r.status : 1;
  await _recordLaneOutcome("corleone", { ok: exitCode === 0, stdout, stderr });
  await _logLaneUsage({ ...usageDetail, ok: exitCode === 0, exitCode });
  return { ok: exitCode === 0, stdout: parsed.readableStdout, stderr, timedOut: false, exitCode, turns: parsed.turns, cli: parsed.cli, runId };
}

async function main() {
  const parsedArgs = parseDispatchArgs(process.argv.slice(2));
  if (!parsedArgs.ok) {
    process.stderr.write(parsedArgs.diagnostic);
    process.exit(parsedArgs.exitCode);
  }

  const result = await dispatchCorleone(parsedArgs.prompt, { effort: parsedArgs.effort });
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
if (isEntry) {
  main().catch((e) => {
    const err = e && e.message ? e.message : String(e);
    process.stderr.write(`corleone-dispatch: wrapper failed: ${err}\n`);
    process.exit(1);
  });
}
