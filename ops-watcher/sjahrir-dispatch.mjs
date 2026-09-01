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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/sjahrir-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }

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
  const guard = await guardLaneStart("sjahrir");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    process.stderr.write(`sjahrir-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`);
    await logLaneUsage({ lane: "sjahrir", promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    process.exit(3);
  }

  const t0 = Date.now();
  const r = spawnSync("kimi", ["-p", prompt], {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - t0;

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    process.stderr.write(`sjahrir-dispatch: kimi timed out after ${TIMEOUT_MS}ms\n`);
    await recordLaneOutcome("sjahrir", { ok: false, stdout: r.stdout, stderr: r.stderr });
    await logLaneUsage({ lane: "sjahrir", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  if (r.error) {
    process.stderr.write(`sjahrir-dispatch: failed to spawn kimi: ${r.error && r.error.message ? r.error.message : r.error}\n`);
    await recordLaneOutcome("sjahrir", { ok: false, stdout: r.stdout, stderr: r.stderr });
    await logLaneUsage({ lane: "sjahrir", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  await recordLaneOutcome("sjahrir", { ok: exitCode === 0, stdout: r.stdout, stderr: r.stderr });
  await logLaneUsage({ lane: "sjahrir", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs });
  process.exit(exitCode);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) main();
