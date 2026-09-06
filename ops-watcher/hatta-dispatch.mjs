// ops-watcher/hatta-dispatch.mjs
// Thin node-wrapper relay around HATTA's harness for the DEFAULT HATTA lane
// (the model hatta/harness.mjs already uses when OLLAMA_MODEL_HATTA is unset —
// glm-5.3:cloud). This exists so the DEFAULT HATTA lane — the most heavily used
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
// hatta/harness.mjs falls back to its built-in default model (glm-5.3:cloud) the
// same way a direct `node hatta/harness.mjs` call always did. Point headless
// AHMAD at this wrapper instead of calling hatta/harness.mjs directly.
//
//   node ops-watcher/hatta-dispatch.mjs "<prompt>"

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";
import { ensureLaneWorktree } from "./lane-worktree.mjs";
import { guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";
import { mergeRufloLaneEnv, withRufloLanePrelude } from "./ruflo-lane-context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

// Exported so the regression suite can assert the LAYERING rather than restate
// the numbers: every budget here must end before the one that kills it.
export const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap

// The harness must finish BEFORE the spawn timeout kills it, not at the same
// instant. Until 2026-09-06 hatta/harness.mjs defaulted to 480000ms and this
// wrapper killed at 480000ms, so the two coincided by accident: a harness that
// used its whole budget was terminated mid-write with nothing to say for
// itself. TerminateProcess cannot be caught on Windows, so a harness killed
// that way never gets to print its verdict. This margin is the difference
// between a run that reports itself and one that vanishes.
export const HARNESS_TEARDOWN_MARGIN_MS = 30 * 1000;
export const HARNESS_BUDGET_MS = TIMEOUT_MS - HARNESS_TEARDOWN_MARGIN_MS;

// Where hatta/harness.mjs persists evidence after every iteration. Reading it is
// best-effort by design: a missing or half-written file must never turn a
// reported timeout into a crash.
//
// THE PATH FOLLOWS THE HARNESS, NOT THIS FILE. harness.mjs derives its own
// WORKSPACE_ROOT from its own location, so the isolated harness inside a lane
// worktree writes <worktree>/hatta/.harness-evidence.json. This wrapper used to
// read <repo>/hatta/.harness-evidence.json unconditionally — a different tree
// from the one the run happened in. Measured 2026-09-06: the real evidence of
// the 04:05 run (12 iterations, 19 tool calls, the file it wrote, the exact
// budget error) sat in the worktree, while the shared path held a leftover from
// the harness security suite. A timeout would have recovered that leftover and
// reported it as this run's evidence. Reporting someone else's run as your own
// is worse than reporting nothing.
export function harnessEvidenceFileFor(workspacePath) {
  const root = workspacePath ? path.resolve(workspacePath) : REPO_ROOT;
  return path.join(root, "hatta", ".harness-evidence.json");
}
const HARNESS_EVIDENCE_FILE = harnessEvidenceFileFor(REPO_ROOT);
export function readHarnessEvidence(file = HARNESS_EVIDENCE_FILE, _fs = fsSync) {
  try {
    const parsed = JSON.parse(_fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
const HARNESS_SCRIPT = path.resolve(REPO_ROOT, "hatta", "harness.mjs");

/**
 * The harness to run for a given workspace — the one INSIDE it.
 *
 * WHY THIS EXISTS. hatta/harness.mjs derives its path jail from its OWN
 * location (`WORKSPACE_ROOT = path.resolve(__harnessDir, "..")`), not from the
 * cwd it is given. So spawning the SHARED repository's harness with
 * `cwd: <worktree>` produced a lane that listed and wrote the SHARED tree while
 * every log line said it was isolated. Measured 2026-09-05: a HATTA dispatch
 * for a packet placed in the worktree failed with
 * `ENOENT: ... D:\AI\Aidit OS\PACKET-W9.md` and listed the main repository's
 * contents — worktree isolation that existed only in the cwd argument.
 *
 * Falls back to the shared harness, and says so, when the workspace has no
 * harness of its own (a non-isolated fallback workspace, or a worktree made
 * before the file existed). A silent fallback here would rebuild the exact bug
 * lane-worktree.mjs was written to prevent.
 */
export function harnessScriptFor(workspacePath, deps = {}) {
  const _fs = deps._fs || fsSync;
  const shared = deps.sharedHarness || HARNESS_SCRIPT;
  if (!workspacePath || path.resolve(workspacePath) === path.resolve(REPO_ROOT)) {
    return { script: shared, isolated: false, reason: "workspace is the shared repository root" };
  }
  const candidate = path.join(workspacePath, "hatta", "harness.mjs");
  if (_fs.existsSync(candidate)) return { script: candidate, isolated: true, reason: "harness inside the lane worktree" };
  return { script: shared, isolated: false, reason: `no harness at ${candidate} — falling back to the shared one, which writes the SHARED tree` };
}

/**
 * The harness prints ONE JSON evidence object on stdout when it exits normally.
 * Pull it back out so the wrapper can see what actually happened instead of
 * treating every non-zero exit as an undifferentiated failure.
 *
 * Takes the LAST JSON-looking line, not the first: the harness may print
 * progress before the final object, and the final object is the verdict.
 *
 * Best-effort and EXPORTED so the regression test exercises the real parser.
 * Never throws — a wrapper that crashes while logging is worse than one that
 * logs nothing.
 */
export function parseHarnessStdout(stdout) {
  try {
    const lines = String(stdout || "").split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {
        // Not the evidence line. Keep walking backwards.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The usage record for the NORMAL-EXIT path — the one where the inner timeout
 * leaked. EXPORTED and pure so the regression test can assert the WIRING, not
 * merely the parser: a test that only exercises parseHarnessStdout stays green
 * while the flag it produces is thrown away between the parser and the log,
 * which is precisely the bug being fixed here.
 *
 * @returns the exact object handed to logLaneUsage.
 */
export function buildNormalExitUsage({ prompt, stdout, stderr, exitCode, durationMs, runId }) {
  const evidence = parseHarnessStdout(stdout);
  // "Reached MAX_ITERATIONS" is NOT a timeout, and the two must stay
  // distinguishable or one blind spot has simply been swapped for another: a
  // run can exhaust the 4-iteration ceiling in 40 SECONDS, which is a
  // completely different failure from sitting at a 120s wall. Only the
  // harness's own typed flag counts; the error string is carried separately so
  // the distinction survives into the log.
  const timedOut = evidence?.timedOut === true;
  return {
    lane: "hatta",
    runId: typeof runId === "string" && runId.trim() ? runId : null,
    promptLength: typeof prompt === "string" ? prompt.length : null,
    ok: exitCode === 0,
    timedOut,
    exitCode,
    durationMs,
    turns: typeof evidence?.iterations === "number" ? evidence.iterations : null,
    stdout,
    stderr,
    cli: evidence
      ? {
          model: typeof evidence.model === "string" ? evidence.model : undefined,
          endpoint: typeof evidence.endpoint === "string" ? evidence.endpoint : undefined,
          toolCalls: Array.isArray(evidence.toolCalls) ? evidence.toolCalls.length : undefined,
          filesWritten: Array.isArray(evidence.filesWritten) ? evidence.filesWritten.length : undefined,
          error: typeof evidence.error === "string" ? evidence.error : undefined,
        }
      : null,
  };
}

async function main() {
  const prompt = process.argv[2];
  if (typeof prompt !== "string" || prompt.length === 0) {
    process.stderr.write('usage: node ops-watcher/hatta-dispatch.mjs "<prompt>"\n');
    process.exit(2);
  }
  const runId = typeof process.env.LANE_RUN_ID === "string" && process.env.LANE_RUN_ID.trim() ? process.env.LANE_RUN_ID : randomUUID();

  // Spawn `node hatta/harness.mjs "<prompt>"` with a plain process.env passthrough
  // — NO OLLAMA_MODEL_HATTA override (unlike hatta-flash-dispatch.mjs). This means
  // hatta/harness.mjs uses its built-in default model (glm-5.3:cloud), exactly as a
  // direct `node hatta/harness.mjs` call always did. process.execPath is the real
  // node binary, so this stays exe=node (consistent with the harness being a node
  // script, not a native binary).
  const guard = await guardLaneStart("hatta");
  if (guard.skip) {
    const reason = guard.reason || "unknown";
    const retryMinutes = Math.ceil(guard.remainingMs / 60000);
    process.stderr.write(`hatta-dispatch: lane skipped (${reason}), retry in ${retryMinutes}m — no spawn attempted\n`);
    await logLaneUsage({ lane: "hatta", runId, promptLength: prompt.length, ok: false, exitCode: 3, durationMs: 0, extra: { skipped: true, reason } });
    process.exit(3);
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
  const workspace = ensureLaneWorktree("hatta");
  if (!workspace.isolated) process.stderr.write(`hatta-dispatch: ${workspace.reason}\n`);
  // Isolation is not the only thing worth saying out loud. A reused worktree
  // may still hold an earlier run's files, and this lane's diff would then
  // contain work nobody asked it to do. Nothing is cleaned here: those files
  // are the only copy of work a lane already did.
  if (workspace.dirty > 0) process.stderr.write(`hatta-dispatch: ${workspace.reason}\n`);
  // The harness jails to its OWN location, so the isolated tree only isolates
  // anything when the harness that runs is the one inside it.
  const harness = harnessScriptFor(workspace.path);
  if (!harness.isolated) process.stderr.write(`hatta-dispatch: ${harness.reason}\n`);
  const t0 = Date.now();
  // The lane is TOLD its budget, and the harness is GIVEN the same number.
  // Neither was true before: the prelude existed for HATTA but no wrapper ever
  // applied it, and the harness read its budget from a default that happened to
  // equal this wrapper's kill timeout. A budget the model cannot see is an
  // ambush, and two layers agreeing by coincidence is not a design.
  const r = spawnSync(process.execPath, [harness.script, withRufloLanePrelude("hatta", prompt, { budgetMs: HARNESS_BUDGET_MS })], {
    cwd: workspace.path,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: mergeRufloLaneEnv({ ...process.env, HATTA_OUTER_RUN_BUDGET_MS: String(HARNESS_BUDGET_MS) }),
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
    const recovered = readHarnessEvidence(harnessEvidenceFileFor(workspace.path));
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
    await logLaneUsage({ lane: "hatta", runId, promptLength: prompt.length, ok: false, timedOut: true, exitCode: 1, durationMs });
    process.exit(1);
  }
  if (r.error) {
    process.stderr.write(`hatta-dispatch: failed to spawn harness: ${r.error && r.error.message ? r.error.message : r.error}\n`);
    await recordLaneOutcome("hatta", { ok: false, stdout: r.stdout, stderr: r.stderr });
    await logLaneUsage({ lane: "hatta", runId, promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  // THE NORMAL-EXIT PATH, AND THE PLACE THE INNER TIMEOUT LEAKED.
  //
  // The block above handles the OUTER wrapper timeout (spawnSync killed the
  // child) and correctly passes timedOut: true. But the harness also has its
  // OWN 120s per-call abort. When that fires, the harness does not hang: it
  // records "timedOut": true in the evidence JSON it prints and then exits
  // NORMALLY, arriving here. Nothing parsed that stdout, so an inner timeout was
  // logged as an ordinary failure.
  //
  // The baseline proves it: both recorded HATTA runs sat at p50 122,670ms —
  // 120s plus overhead, unmistakably the inner abort — and lane-usage.jsonl said
  // timedOut=0 for the lane. Under-reported in exactly the spot that was
  // supposed to have been fixed.
  const usage = buildNormalExitUsage({ prompt, stdout: r.stdout, stderr: r.stderr, exitCode, durationMs, runId });
  await recordLaneOutcome("hatta", { ok: exitCode === 0, stdout: r.stdout, stderr: r.stderr, timedOut: usage.timedOut });
  await logLaneUsage(usage);
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
