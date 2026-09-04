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

/**
 * The remote command. PowerShell reads the copied file as ONE argument, so the
 * prompt never passes through a shell parser.
 */
export function buildRemoteCommand(promptPath = REMOTE_PROMPT_PATH) {
  const p = promptPath.replace(/\//g, "\\");
  return [
    "powershell -NoProfile -Command",
    `"$p = Get-Content -Raw -LiteralPath '${p}'; claude -p $p"`,
  ].join(" ");
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
    _log(`soekarno-dispatch: skipped — ${reason}`);
    await logLaneUsage({
      lane: "soekarno",
      promptLength: prompt.length,
      ok: false,
      exitCode: 3,
      durationMs: 0,
      extra: { skipped: true, reason },
    });
    return { ok: false, skipped: true, reason, stdout: "", stderr: "" };
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
      await logLaneUsage({ lane: "soekarno", promptLength: prompt.length, ok: false, exitCode: 2, durationMs });
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
      await logLaneUsage({ lane: "soekarno", promptLength: prompt.length, ok: false, timedOut: true, exitCode: 1, durationMs });
      return { ok: false, stdout: r.stdout || "", stderr: r.stderr || "", timedOut: true };
    }
    if (r.error) {
      const stderr = r.error.message || String(r.error);
      _log(`soekarno-dispatch: failed to reach the Lenovo: ${stderr}`);
      await recordLaneOutcome("soekarno", { ok: false, stdout: "", stderr });
      await logLaneUsage({ lane: "soekarno", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
      return { ok: false, stdout: "", stderr, timedOut: false };
    }

    const exitCode = typeof r.status === "number" ? r.status : 1;
    await recordLaneOutcome("soekarno", { ok: exitCode === 0, stdout: r.stdout || "", stderr: r.stderr || "" });
    await logLaneUsage({ lane: "soekarno", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs });
    return { ok: exitCode === 0, stdout: r.stdout || "", stderr: r.stderr || "", timedOut: false, exitCode };
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
