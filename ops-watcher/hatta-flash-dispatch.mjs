// ops-watcher/hatta-flash-dispatch.mjs
// Thin node-wrapper relay around HATTA's harness that FORCES the cheap/fast
// Flash-tier model (glm-5.3-flash:cloud) instead of HATTA's default heavier
// model (glm-5.2:cloud). Exists for the same reason sjahrir-dispatch.mjs and
// corleone-dispatch.mjs exist: headless AHMAD's only execution tool (run_command
// in ahmad-mcp-server.mjs) requires exe === "node" + a fixed allowlisted .mjs
// script, AND it cannot set environment variables when calling
// `node hatta/harness.mjs` directly. HATTA's harness already reads its model
// from process.env.OLLAMA_MODEL_HATTA (hatta/harness.mjs line 16:
// `const MODEL = process.env.OLLAMA_MODEL_HATTA || "glm-5.2:cloud";`), so this
// wrapper simply spawns the harness with the child environment overriding that
// one key to "glm-5.3-flash:cloud" while spreading the rest of process.env
// (so other inherited vars the harness needs, e.g. OLLAMA_HOST, are preserved).
// This mirrors the origin FounderOS design's 4-tier model-lanes layer
// (heavy, code, Flash-lightweight, secondary-CLI) that this fork was missing
// the "Flash" tier of.
//
//   node ops-watcher/hatta-flash-dispatch.mjs "<prompt>"

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap
const HARNESS_SCRIPT = path.resolve(REPO_ROOT, "hatta", "harness.mjs");
const FLASH_MODEL = "glm-5.3-flash:cloud";

async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/hatta-flash-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }

  // Spawn `node hatta/harness.mjs "<prompt>"` with the child environment
  // overriding OLLAMA_MODEL_HATTA to the Flash model. We spread ...process.env
  // first so every other inherited env var the harness might need (OLLAMA_HOST,
  // HATTA_MAX_ITER, etc.) is preserved; only the one model-selection key is
  // overridden. process.execPath is the real node binary, so this stays exe=node
  // (consistent with the harness being a node script, not a native binary).
  const guard = await guardLaneStart("hatta-flash");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    process.stderr.write(`hatta-flash-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`);
    await logLaneUsage({ lane: "hatta-flash", promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    process.exit(3);
  }

  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HARNESS_SCRIPT, prompt], {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, OLLAMA_MODEL_HATTA: FLASH_MODEL },
  });
  const durationMs = Date.now() - t0;

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    process.stderr.write(`hatta-flash-dispatch: harness timed out after ${TIMEOUT_MS}ms\n`);
    await recordLaneOutcome("hatta-flash", { ok: false, stdout: r.stdout, stderr: r.stderr, timedOut: true });
    await logLaneUsage({ lane: "hatta-flash", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  if (r.error) {
    process.stderr.write(`hatta-flash-dispatch: failed to spawn harness: ${r.error && r.error.message ? r.error.message : r.error}\n`);
    await recordLaneOutcome("hatta-flash", { ok: false, stdout: r.stdout, stderr: r.stderr });
    await logLaneUsage({ lane: "hatta-flash", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  await recordLaneOutcome("hatta-flash", { ok: exitCode === 0, stdout: r.stdout, stderr: r.stderr });
  await logLaneUsage({ lane: "hatta-flash", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs });
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