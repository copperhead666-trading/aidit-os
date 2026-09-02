// ops-watcher/hatta-dispatch.mjs
// Thin node-wrapper relay around HATTA's harness for the DEFAULT HATTA lane
// (the model hatta/harness.mjs already uses when OLLAMA_MODEL_HATTA is unset —
// glm-5.2:cloud). This exists so the DEFAULT HATTA lane — the most heavily used
// one, the one headless AHMAD's cold-start prompt previously told it to run via
// `node hatta/harness.mjs "<prompt>"` directly — is ALSO usage-tracked by the
// logLaneUsage system (ops-watcher/lane-usage.mjs / lane-usage-report.mjs).
// Previously only the Flash / SJAHRIR / CORLEONE lanes were tracked, because
// headless AHMAD called `hatta/harness.mjs` directly for the default lane,
// bypassing any wrapper — so the majority of actual dispatch activity was
// invisible to `node ops-watcher/lane-usage-report.mjs`. This wrapper closes
// that gap: same structural shape as hatta-flash-dispatch.mjs, sjahrir-dispatch.mjs,
// and corleone-dispatch.mjs, but WITHOUT any environment override — the child is
// spawned with a plain `...process.env` passthrough (nothing added or removed), so
// hatta/harness.mjs falls back to its built-in default model (glm-5.2:cloud) the
// same way a direct `node hatta/harness.mjs` call always did. Point headless
// AHMAD at this wrapper instead of calling hatta/harness.mjs directly.
//
//   node ops-watcher/hatta-dispatch.mjs "<prompt>"

import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

// Where hatta/harness.mjs persists evidence after every iteration. Reading it is
// best-effort by design: a missing or half-written file must never turn a
// reported timeout into a crash.
const HARNESS_EVIDENCE_FILE = path.join(REPO_ROOT, "hatta", ".harness-evidence.json");
export function readHarnessEvidence(file = HARNESS_EVIDENCE_FILE, _fs = fsSync) {
  try {
    const parsed = JSON.parse(_fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
const HARNESS_SCRIPT = path.resolve(REPO_ROOT, "hatta", "harness.mjs");

async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/hatta-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }

  // Spawn `node hatta/harness.mjs "<prompt>"` with a plain process.env passthrough
  // — NO OLLAMA_MODEL_HATTA override (unlike hatta-flash-dispatch.mjs). This means
  // hatta/harness.mjs uses its built-in default model (glm-5.2:cloud), exactly as a
  // direct `node hatta/harness.mjs` call always did. process.execPath is the real
  // node binary, so this stays exe=node (consistent with the harness being a node
  // script, not a native binary).
  const guard = await guardLaneStart("hatta");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    process.stderr.write(`hatta-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`);
    await logLaneUsage({ lane: "hatta", promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    process.exit(3);
  }

  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HARNESS_SCRIPT, prompt], {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env },
  });
  const durationMs = Date.now() - t0;

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    //
    // The harness prints its evidence only when runTask returns, so a timeout
    // used to destroy the whole record of the run: eight minutes of paid model
    // time reported as one line. The harness now also persists evidence after
    // every iteration, and on Windows that FILE is the only thing that survives
    // — spawnSync's kill goes through TerminateProcess, which no SIGTERM handler
    // in the child can catch, so the child's own signal handler never fires.
    // Read the file here, where the run is being reported.
    const recovered = readHarnessEvidence();
    if (recovered) {
      process.stdout.write(JSON.stringify({ ...recovered, timedOut: true, recoveredFrom: "evidence-file" }) + "\n");
      process.stderr.write(
        `hatta-dispatch: harness timed out after ${TIMEOUT_MS}ms — recovered partial evidence ` +
        `(iterations=${recovered.iterations ?? "?"}, toolCalls=${(recovered.toolCalls || []).length}, ` +
        `filesWritten=${(recovered.filesWritten || []).length})\n`,
      );
    } else {
      process.stderr.write(`hatta-dispatch: harness timed out after ${TIMEOUT_MS}ms — no evidence file to recover\n`);
    }
    await recordLaneOutcome("hatta", { ok: false, stdout: r.stdout, stderr: r.stderr, timedOut: true });
    await logLaneUsage({ lane: "hatta", promptLength: prompt.length, ok: false, timedOut: true, exitCode: 1, durationMs });
    process.exit(1);
  }
  if (r.error) {
    process.stderr.write(`hatta-dispatch: failed to spawn harness: ${r.error && r.error.message ? r.error.message : r.error}\n`);
    await recordLaneOutcome("hatta", { ok: false, stdout: r.stdout, stderr: r.stderr });
    await logLaneUsage({ lane: "hatta", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  await recordLaneOutcome("hatta", { ok: exitCode === 0, stdout: r.stdout, stderr: r.stderr });
  await logLaneUsage({ lane: "hatta", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs });
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