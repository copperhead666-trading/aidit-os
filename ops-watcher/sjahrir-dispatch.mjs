// ops-watcher/sjahrir-dispatch.mjs
// Thin node-wrapper relay around the `kimi` (SJAHRIR) CLI. Exists because
// headless AHMAD's only execution tool (run_command in ahmad-mcp-server.mjs)
// requires exe === "node" + a fixed allowlisted .mjs script, so a bare `kimi`
// binary can never be invoked directly. This wrapper keeps the existing
// node+allowlist security boundary intact (no widening exe to arbitrary
// binaries) while letting AHMAD actually reach SJAHRIR.
//
//   node ops-watcher/sjahrir-dispatch.mjs "<prompt>"

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { ensureLaneWorktree } from "./lane-worktree.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";
import { mergeRufloLaneEnv, withRufloLanePrelude } from "./ruflo-lane-context.mjs";
import { sourceRepoForPrompt } from "./lane-source-repo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

/**
 * argv for the kimi invocation. `--output-format stream-json` makes the
 * child emit one JSON object per stdout line (parseKimiStream) instead of
 * prose, so per-run numbers (turns, model, usage) reach the usage log.
 * `-m/--model` is deliberately NOT set: the lane uses the machine's
 * configured default model.
 */
export function buildKimiArgs(prompt, { budgetMs } = {}) {
  return ["-p", withRufloLanePrelude("sjahrir", prompt, { budgetMs }), "--output-format", "stream-json"];
}

/**
 * Parse `kimi -p --output-format stream-json` stdout into { turns, cli, text }.
 *
 * DEFENSIVE by contract: every line is parsed independently — an unparseable
 * line, a non-object line, or a line with a shape we do not know is SKIPPED,
 * never fatal. A stream that yields nothing usable returns
 * { turns: null, cli: null, text: "" } so the caller still logs a COMPLETE
 * usage record with nulls where nothing was reported (never invented numbers).
 *
 * `turns` prefers an explicit numeric turn/iteration counter when the stream
 * carries one; otherwise it counts Assistant messages (one assistant message
 * == one model turn in this stream). `text` is the assistant text recovered
 * from the stream so the wrapper can relay something human-readable instead
 * of raw JSONL. Never throws.
 */
export function parseKimiStream(raw) {
  const out = { turns: null, cli: null, text: "" };
  try {
    if (typeof raw !== "string" || raw.trim() === "") return out;
    const cli = {};
    let explicitTurns = null;
    let assistantTurns = 0;
    const texts = [];
    const takeScalar = (key, value) => {
      if (typeof value === "number" || typeof value === "boolean") cli[key] = value;
      else if (typeof value === "string" && value.length <= 500) cli[key] = value;
    };
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let ev;
      try { ev = JSON.parse(trimmed); } catch { continue; } // malformed line: skip, not fatal
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) continue;
      const role = typeof ev.role === "string" ? ev.role : ev.type;
      if (role === "assistant") {
        assistantTurns++;
        if (typeof ev.content === "string") {
          texts.push(ev.content);
        } else if (Array.isArray(ev.content)) {
          for (const block of ev.content) {
            if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
              texts.push(block.text);
            }
          }
        }
      }
      for (const key of ["turns", "turn", "num_turns", "iteration"]) {
        const v = ev[key];
        if (Number.isFinite(v) && v >= 0 && (explicitTurns === null || v > explicitTurns)) {
          explicitTurns = Math.floor(v);
        }
      }
      takeScalar("model", ev.model);
      if (typeof ev.session_id === "string") cli.session_id = ev.session_id;
      else if (typeof ev.sessionId === "string") cli.session_id = ev.sessionId;
      if (ev.usage && typeof ev.usage === "object") {
        for (const [k, v] of Object.entries(ev.usage)) {
          if (typeof v === "number" || typeof v === "boolean") cli[`usage_${k}`] = v;
        }
      }
    }
    out.turns = explicitTurns !== null ? explicitTurns : assistantTurns > 0 ? assistantTurns : null;
    if (Object.keys(cli).length > 0) out.cli = cli;
    out.text = texts.join("\n");
  } catch {
    // Never throw: a parse failure must not break the dispatch.
  }
  return out;
}

export async function dispatchSjahrir(prompt, deps = {}) {
  const _spawn = deps.spawnSync || spawnSync;
  const _log = deps.log || ((m) => process.stderr.write(m + "\n"));
  const _guardLaneStart = deps.guardLaneStart || guardLaneStart;
  const _recordLaneOutcome = deps.recordLaneOutcome || recordLaneOutcome;
  const _logLaneUsage = deps.logLaneUsage || logLaneUsage;
  const _ensureLaneWorktree = deps.ensureLaneWorktree || ensureLaneWorktree;
  const _sourceRepoForPrompt = deps.sourceRepoForPrompt || sourceRepoForPrompt;
  const now = deps.now || Date.now;
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const t0 = now();
  const runId = typeof deps.runId === "string" && deps.runId.trim()
    ? deps.runId
    : (typeof process.env.LANE_RUN_ID === "string" && process.env.LANE_RUN_ID.trim() ? process.env.LANE_RUN_ID : randomUUID());
  try {
    // `kimi` resolves to a native kimi.exe on this machine, so we spawn it
    // directly with shell:false (the safe default). shell:false passes the args
    // array VERBATIM via CreateProcess — no cmd.exe parsing — so a free-form
    // prompt containing spaces / quotes / % / & is preserved exactly. Deliberately
    // NOT adding shell:true here: on Node v22.14.0 shell:true does NOT quote
    // args-array elements (verified live) — cmd.exe would word-split "Reply with
    // exactly the text OK ..." into ~11 separate args and break `kimi -p`. The
    // current shell:false invocation is already correct and robust for the native
    // .exe case. If `kimi` ever becomes a .cmd shim in the future, the right fix
    // is the same bypass-the-shim approach used in corleone-dispatch.mjs (spawn
    // node on the underlying entry script with shell:false), NOT shell:true.
    const guard = await _guardLaneStart("sjahrir");
    if (guard.skip) {
      const reason = guard.reason || "unknown";
      const retryMinutes = Math.ceil(guard.remainingMs / 60000);
      const msg = `sjahrir-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted`;
      _log(msg);
      await _logLaneUsage({
        lane: "sjahrir",
        runId,
        promptLength: prompt.length,
        ok: false,
        exitCode: 3,
        durationMs: 0,
        turns: null,
        stdout: "",
        stderr: msg,
        cli: null,
        extra: { skipped: true, reason },
      });
      return { ok: false, skipped: true, reason, stdout: "", stderr: msg, exitCode: 3, runId };
    }

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
    let source;
    try {
      source = await _sourceRepoForPrompt(prompt);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      source = { sourceRepo: null, ventureId: null, reason: `source repo resolver failed; treating as not venture work: ${msg}` };
      process.stderr.write(`sjahrir-dispatch: ${source.reason}\n`);
    }
    if (!source || typeof source !== "object") source = { sourceRepo: null, ventureId: null, reason: "not venture work" };
    const workspace = _ensureLaneWorktree("sjahrir", source.sourceRepo ? { sourceRepo: source.sourceRepo } : {});
    if (source.sourceRepo) process.stderr.write(`sjahrir-dispatch: ${source.reason}; worktree ${workspace.path}\n`);
    else if (source.ventureId) process.stderr.write(`sjahrir-dispatch: ${source.reason}; continuing in Aidit OS\n`);
    if (!workspace.isolated) process.stderr.write(`sjahrir-dispatch: ${workspace.reason}
`);
    // Isolation is not the only thing worth saying out loud. A reused worktree
    // may still hold an earlier run's files, and this lane's diff would then
    // contain work nobody asked it to do. Nothing is cleaned here: those files
    // are the only copy of work a lane already did.
    if (workspace.dirty > 0) process.stderr.write(`sjahrir-dispatch: ${workspace.reason}\n`);
    const r = _spawn("kimi", buildKimiArgs(prompt, { budgetMs: timeoutMs }), {
      cwd: workspace.path,
      windowsHide: true,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: mergeRufloLaneEnv(process.env),
    });
    const durationMs = now() - t0;
    const stdout = typeof r.stdout === "string" ? r.stdout : "";
    const stderr = typeof r.stderr === "string" ? r.stderr : "";
    const parsed = parseKimiStream(stdout);

    // Human-readable relay: emit the assistant text recovered from the JSON
    // stream, NOT raw JSONL — AHMAD and humans read this wrapper's stdout.
    // If the stream yielded nothing usable, fall back to the raw stdout so a
    // failed run still shows whatever came back.
    const readable = parsed.text !== "" ? parsed.text : stdout;

    if (r.signal === "SIGTERM" && r.status === null) {
      // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
      const msg = `sjahrir-dispatch: kimi timed out after ${timeoutMs}ms`;
      _log(msg);
      await _recordLaneOutcome("sjahrir", { ok: false, stdout, stderr, timedOut: true });
      await _logLaneUsage({
        lane: "sjahrir",
        runId,
        promptLength: prompt.length,
        ok: false,
        timedOut: true,
        exitCode: 1,
        durationMs,
        turns: parsed.turns,
        stdout,
        stderr,
        cli: parsed.cli,
      });
      return { ok: false, timedOut: true, stdout: readable, stderr: stderr ? `${stderr}\n${msg}` : msg, exitCode: 1, runId };
    }
    if (r.error) {
      const msg = `sjahrir-dispatch: failed to spawn kimi: ${r.error && r.error.message ? r.error.message : r.error}`;
      _log(msg);
      await _recordLaneOutcome("sjahrir", { ok: false, stdout, stderr });
      await _logLaneUsage({
        lane: "sjahrir",
        runId,
        promptLength: prompt.length,
        ok: false,
        exitCode: 1,
        durationMs,
        turns: null,
        stdout,
        stderr: stderr ? `${stderr}\n${msg}` : msg,
        cli: null,
      });
      return { ok: false, timedOut: false, stdout: readable, stderr: stderr ? `${stderr}\n${msg}` : msg, exitCode: 1, runId };
    }
    const exitCode = typeof r.status === "number" ? r.status : 1;
    await _recordLaneOutcome("sjahrir", { ok: exitCode === 0, stdout, stderr });
    await _logLaneUsage({
      lane: "sjahrir",
      runId,
      promptLength: prompt.length,
      ok: exitCode === 0,
      exitCode,
      durationMs,
      turns: parsed.turns,
      stdout,
      stderr,
      cli: parsed.cli,
    });
    return { ok: exitCode === 0, timedOut: false, stdout: readable, stderr, exitCode, runId };
  } catch (err) {
    // Never throw out of the wrapper: headless AHMAD calls this and a crash
    // is worse than a reported failure.
    const msg = `sjahrir-dispatch: unexpected failure: ${err && err.message ? err.message : err}`;
    _log(msg);
    try { await _recordLaneOutcome("sjahrir", { ok: false, stdout: "", stderr: msg }); } catch { /* guard must not break the lane either */ }
    try {
      await _logLaneUsage({
        lane: "sjahrir",
        runId,
        promptLength: prompt.length,
        ok: false,
        exitCode: 1,
        durationMs: now() - t0,
        turns: null,
        stdout: "",
        stderr: msg,
        cli: null,
      });
    } catch { /* logging must never break the dispatch */ }
    return { ok: false, timedOut: false, stdout: "", stderr: msg, exitCode: 1, runId };
  }
}

// ---- CLI ----
async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/sjahrir-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }
  const r = await dispatchSjahrir(prompt);
  if (r.stdout) process.stdout.write(r.stdout.endsWith("\n") ? r.stdout : r.stdout + "\n");
  if (r.stderr) process.stderr.write(r.stderr.endsWith("\n") ? r.stderr : r.stderr + "\n");
  process.exit(r.exitCode);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("sjahrir-dispatch fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
