// ops-watcher/soekarno-dispatch.mjs
//
// The SOEKARNO lane: a second machine, deliberately blind to this repo.
//
// WHY IT DID NOT EXIST. SOEKARNO has been in the roster since the Bennett
// role map (`handoffs/sjahrir/CANONICAL-ROLE-MAP.json:172`, "L5 SOEKARNO") but
// there was never a dispatch wrapper, so neither AHMAD nor directive-runner
// could call it. It was not an underused lane; it was an unusable one.
//
// WHAT IT IS: Claude Code on the Lenovo, in print mode (`claude -p`), reached
// over the Tailscale SSH path. Verified live 2026-09-04 — v2.1.258 answered.
//
// WHAT IT ACTUALLY BUYS. An earlier version of this comment said SOEKARNO was
// not extra quota because it ran on the owner's Claude account. That was wrong,
// and the owner corrected it: the Lenovo's Claude is signed in as
// pusatberasmurah@gmail.com, a DIFFERENT account from the one the ASUS session
// uses (adityainofficial@gmail.com) — verified in ~/.claude.json on that machine.
//
// So this lane is real additional capacity, not just concurrency. It should be
// loaded accordingly, and it is a live data point for the owner's standing
// question about how many paid accounts to keep. What it adds:
//   - a genuinely separate Claude subscription;
//   - a second machine, so its work runs concurrently with an ASUS lane;
//   - a reviewer that CANNOT see the repo. The Lenovo has no clone of it
//     (`Test-Path 'D:\AI\Active FounderOS-Aidit'` is False). A reviewer that
//     cannot quietly go and read the file it is reviewing has to reason from
//     what it was handed, which is most of why a second opinion is worth having;
//   - a clean context. It carries none of the session that produced the work,
//     so it cannot agree with itself.
//
// READ-ONLY BY CONSTRUCTION, not by instruction: there is no repo on that disk
// to write to. CLAUDE.md forbids two writers in one worktree, and this lane
// cannot become the second writer. Everything it needs must therefore travel
// inside the prompt — that is a constraint on the caller, not a limitation to
// work around.
//
// PROMPT DELIVERY. The prompt is written to a file and copied over, never
// interpolated into a remote command line. Two reasons, both already paid for
// in this repo: Windows spawn word-splits multi-word arguments (see
// hatta-flash-dispatch.mjs and corleone-dispatch.mjs headers), and an ssh
// command string is parsed a second time by the remote shell — a prompt with a
// quote in it would be silently mangled or would fail.
//
//   node ops-watcher/soekarno-dispatch.mjs "<read-only question or review task>"

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SOEKARNO_HOST = "WIN10@100.87.42.3";
export const REMOTE_PROMPT_PATH = "C:/Users/WIN10/.soekarno-prompt.txt";

// Same 8-minute ceiling as CORLEONE, and for the same reason: it must stay
// under ahmad-mcp-server.mjs's 9-minute RUN_TIMEOUT_MS or headless AHMAD sees a
// truncated run instead of a lane answer.
const TIMEOUT_MS = 8 * 60 * 1000;

// The Lenovo is a 2013 dual-core; ssh itself must not be what times out.
const SSH_OPTS = ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"];

// Standing role context for the lane, delivered via --append-system-prompt.
// Kept SHORT and deliberately free of apostrophes: the text is single-quoted
// inside the remote PowerShell command below, so a ' would break the exact
// quoting this file's header comment explains.
export const SOEKARNO_SYSTEM_PROMPT = "You are SOEKARNO: a read-only reviewer lane with no repository access. Work only from the material given in the prompt. Deliver printed text: analysis, review, or written deliverables. Do not attempt file writes or shell commands.";

// The narrowest tool set this lane actually needs, passed via --allowedTools.
// Everything the lane works from travels inside the prompt; there is no repo
// on the Lenovo to edit and no code to run. Read is the only tool kept, so a
// prompt that references a file copied alongside it can still be honored.
// A tool the lane is not given cannot be misused.
export const SOEKARNO_ALLOWED_TOOLS = ["Read"];

/**
 * The remote command. PowerShell reads the copied file as ONE argument, so the
 * prompt never passes through a shell parser. --output-format json replaces
 * prose scraping with a parseable result envelope; --allowedTools and
 * --append-system-prompt pin the lane to its read-only, printed-text role.
 */
export function buildRemoteCommand(promptPath = REMOTE_PROMPT_PATH) {
  const p = promptPath.replace(/\//g, "\\");
  return [
    "powershell -NoProfile -Command",
    `"$p = Get-Content -Raw -LiteralPath '${p}'; claude -p $p --output-format json --allowedTools "${SOEKARNO_ALLOWED_TOOLS.join('" "')}" --append-system-prompt '${SOEKARNO_SYSTEM_PROMPT}'"`,
  ].join(" ");
}

/**
 * Parse `claude -p --output-format json` stdout. The result envelope carries
 * the answer plus per-run numbers (num_turns, duration_ms, session_id, usage).
 *
 * Returns { ok: true, result, turns, cli, isError } for a valid JSON envelope,
 * or { ok: false, error } when the output is NOT valid JSON. That second case
 * is a REPORTED FAILURE, never a silent fallback to treating the raw text as
 * the answer — raw-prose scraping is exactly what this replaces. Never throws.
 */
export function parseClaudeJson(raw) {
  try {
    if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: "empty stdout" };
    let env;
    try {
      env = JSON.parse(raw);
    } catch {
      return { ok: false, error: "stdout was not valid JSON" };
    }
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      return { ok: false, error: "stdout was not a JSON object" };
    }
    const cli = {};
    const take = (key, value) => {
      if (typeof value === "number" || typeof value === "boolean") cli[key] = value;
      else if (typeof value === "string") cli[key] = value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
    };
    take("session_id", env.session_id);
    take("num_turns", env.num_turns);
    take("duration_ms", env.duration_ms);
    take("duration_api_ms", env.duration_api_ms);
    take("model", env.model);
    if (env.usage && typeof env.usage === "object") {
      for (const [k, v] of Object.entries(env.usage)) {
        if (typeof v === "number" || typeof v === "boolean") cli[`usage_${k}`] = v;
      }
    }
    return {
      ok: true,
      result: typeof env.result === "string" ? env.result : "",
      turns: Number.isFinite(env.num_turns) ? env.num_turns : null,
      cli: Object.keys(cli).length > 0 ? cli : null,
      isError: env.is_error === true,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

export function buildScpArgs(localPath, host = SOEKARNO_HOST, remotePath = REMOTE_PROMPT_PATH) {
  return [...SSH_OPTS, localPath, `${host}:${remotePath}`];
}

export function buildSshArgs(host = SOEKARNO_HOST, remoteCommand = buildRemoteCommand()) {
  return [...SSH_OPTS, host, remoteCommand];
}

export async function dispatchSoekarno(prompt, deps = {}) {
  const _spawn = deps.spawnSync || spawnSync;
  const _log = deps.log || ((m) => process.stderr.write(m + "\n"));
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;

  // guardLaneStart answers with `skip`, not `allowed`. Reading the wrong field
  // fails CLOSED — the lane silently never runs — which is exactly how this
  // first went wrong.
  const guard = await guardLaneStart("soekarno");
  if (guard.skip) {
    const reason = guard.reason || "lane guard";
    const msg = `soekarno-dispatch: skipped — ${reason}`;
    _log(msg);
    await logLaneUsage({
      lane: "soekarno",
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
    return { ok: false, skipped: true, reason, stdout: "", stderr: msg };
  }

  const dir = deps.tmpDir || mkdtempSync(path.join(os.tmpdir(), "soekarno-"));
  const localPath = path.join(dir, "prompt.txt");
  writeFileSync(localPath, prompt, "utf8");

  const started = Date.now();
  try {
    const copied = _spawn("scp", buildScpArgs(localPath), {
      encoding: "utf8",
      timeout: 60_000,
      shell: false,
      windowsHide: true,
    });
    if (copied.status !== 0) {
      const durationMs = Date.now() - started;
      const stderr = copied.stderr || (copied.error && copied.error.message) || "";
      _log(`soekarno-dispatch: could not copy the prompt to the Lenovo: ${stderr.trim()}`);
      await recordLaneOutcome("soekarno", { ok: false, stdout: "", stderr });
      await logLaneUsage({
        lane: "soekarno",
        promptLength: prompt.length,
        ok: false,
        exitCode: 2,
        durationMs,
        turns: null,
        stdout: "",
        stderr,
        cli: null,
      });
      return { ok: false, stdout: "", stderr, timedOut: false };
    }

    const r = _spawn("ssh", buildSshArgs(), {
      encoding: "utf8",
      timeout: timeoutMs,
      shell: false,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;

    if (r.error && r.error.code === "ETIMEDOUT") {
      _log(`soekarno-dispatch: timed out after ${timeoutMs}ms`);
      await recordLaneOutcome("soekarno", { ok: false, stdout: r.stdout || "", stderr: r.stderr || "", timedOut: true });
      await logLaneUsage({
        lane: "soekarno",
        promptLength: prompt.length,
        ok: false,
        timedOut: true,
        exitCode: 1,
        durationMs,
        turns: null,
        stdout: r.stdout,
        stderr: r.stderr,
        cli: null,
      });
      return { ok: false, stdout: r.stdout || "", stderr: r.stderr || "", timedOut: true };
    }
    if (r.error) {
      const stderr = r.error.message || String(r.error);
      _log(`soekarno-dispatch: failed to reach the Lenovo: ${stderr}`);
      await recordLaneOutcome("soekarno", { ok: false, stdout: "", stderr });
      await logLaneUsage({
        lane: "soekarno",
        promptLength: prompt.length,
        ok: false,
        exitCode: 1,
        durationMs,
        turns: null,
        stdout: "",
        stderr,
        cli: null,
      });
      return { ok: false, stdout: "", stderr, timedOut: false };
    }

    const exitCode = typeof r.status === "number" ? r.status : 1;
    const parsed = parseClaudeJson(r.stdout || "");
    if (!parsed.ok) {
      // Not valid JSON: a reported failure, NOT a silent fall back to raw
      // prose. The raw bytes still reach the usage record (as byte counts)
      // and the guard, but never the caller's stdout as if they were the
      // lane's answer.
      const msg = `soekarno-dispatch: claude did not return a JSON result (${parsed.error}); refusing to treat raw output as the answer`;
      _log(msg);
      await recordLaneOutcome("soekarno", { ok: false, stdout: r.stdout || "", stderr: r.stderr || "" });
      await logLaneUsage({
        lane: "soekarno",
        promptLength: prompt.length,
        ok: false,
        exitCode: 1,
        durationMs,
        turns: null,
        stdout: r.stdout,
        stderr: r.stderr,
        cli: null,
        extra: { invalidJson: true, parseError: parsed.error },
      });
      return { ok: false, stdout: "", stderr: msg, rawStdout: r.stdout || "", parseError: true, timedOut: false, exitCode: 1 };
    }

    const ok = exitCode === 0 && !parsed.isError;
    await recordLaneOutcome("soekarno", { ok, stdout: parsed.result, stderr: r.stderr || "" });
    await logLaneUsage({
      lane: "soekarno",
      promptLength: prompt.length,
      ok,
      exitCode,
      durationMs,
      turns: parsed.turns,
      stdout: r.stdout,
      stderr: r.stderr,
      cli: parsed.cli,
    });
    return { ok, stdout: parsed.result, stderr: r.stderr || "", timedOut: false, exitCode, turns: parsed.turns, cli: parsed.cli };
  } finally {
    try { unlinkSync(localPath); } catch { /* the temp dir goes with the process */ }
  }
}

// ---- CLI ----
async function main() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('usage: node ops-watcher/soekarno-dispatch.mjs "<read-only question or review task>"');
    process.exit(2);
  }
  const r = await dispatchSoekarno(prompt);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.ok ? 0 : 1);
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
    console.error("soekarno-dispatch fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
