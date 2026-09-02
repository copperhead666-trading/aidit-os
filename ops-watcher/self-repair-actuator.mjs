// ops-watcher/self-repair-actuator.mjs
//
// Actuation layer for self-repair. The detector (self-repair.mjs) decides WHAT
// is faulting and whether it is safe to act; this module decides HOW a repair
// lane is briefed and how files are snapshotted/restored around a drill.
//
// Part 1 exports ONLY the pure packet builder and the snapshot/restore helpers.
// Part 2 adds attemptRepair (the bounded repair attempt), escalate (the owner
// alert with its own 24h cooldown), and the --drill CLI proof. The actuator
// never calls git, pm2, Paperclip or Telegram directly; every external effect
// (lane dispatch, alert) is injectable so the regression suite stays offline.

import { promises as realFs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { deliverAlert } from "./alert-delivery.mjs";

import {
  repairScopeFor,
  appendEvidence,
  STATE_FILE,
  EVIDENCE_LOG_FILE,
  REPAIR_COOLDOWN_MS,
  shouldAttemptRepair,
} from "./self-repair.mjs";
import { runAllTests as defaultRunAllTests } from "./run-all-tests.mjs";
import {
  guardLaneStart as defaultGuardLaneStart,
  recordLaneOutcome as defaultRecordLaneOutcome,
} from "./lane-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export {
  repairScopeFor,
  appendEvidence,
  STATE_FILE,
  EVIDENCE_LOG_FILE,
  REPAIR_COOLDOWN_MS,
  shouldAttemptRepair,
};

export const BACKUP_DIR = path.join(__dirname, ".self-repair-backups");

// =====================================================================
// Repair lane registry. Each entry maps a lane name to the node-wrapper relay
// a real dispatch spawns through (`wrapper`, repo-relative) and the lane-guard
// identity (`guardName`) used by guardLaneStart / recordLaneOutcome. The
// default lane is CORLEONE; a drill may select HATTA when CORLEONE is
// quota-blocked, because a real end-to-end repair must run on whichever lane is
// actually alive.
// =====================================================================
export const REPAIR_LANES = {
  corleone: { wrapper: "ops-watcher/corleone-dispatch.mjs", guardName: "corleone" },
  hatta:    { wrapper: "ops-watcher/hatta-dispatch.mjs",    guardName: "hatta" },
};
export const DEFAULT_REPAIR_LANE = "corleone";

// The repo root is one level above ops-watcher; repair packets must print
// repo-relative paths so a repair lane never sees machine-specific prefixes.
const REPO_ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath || "node";
const ESCALATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DISPATCH_TIMEOUT_MS = 12 * 60 * 1000;

// The canary step used by drills. Its per-step attempt bookkeeping is cleared
// at the start of every drill so a drill is never blocked by a previous drill's
// recorded attempt. Production steps are NEVER cleared this way.
const DRILL_STEP_NAME = "canary-step";

function toRepoRelative(file) {
  const rel = path.relative(REPO_ROOT, file);
  // Normalize Windows backslashes to forward slashes for deterministic output.
  return rel.split(path.sep).join("/");
}

function newestExcerpt(fault) {
  if (!fault) return "";
  if (Array.isArray(fault.records) && fault.records.length) {
    const rec = fault.records[fault.records.length - 1];
    return String((rec && rec.excerpt) || "").trim();
  }
  return String(fault.excerpt || fault.error || "").trim();
}

// =====================================================================
// buildRepairPacket — PURE. Returns the exact task text a repair lane receives.
// Same inputs always produce the same string.
// =====================================================================
export function buildRepairPacket(fault, scope, evidence) {
  const stepName = (fault && fault.name) || (scope && scope.stepName) || "unknown";
  const excerpt = newestExcerpt(fault) || "(no excerpt available)";

  const files = (scope && Array.isArray(scope.files)) ? scope.files : [];
  const relFiles = files.map(toRepoRelative);
  const fileLines = relFiles.length
    ? relFiles.map((f) => `  - ${f}`).join("\n")
    : "  - (none — no scope files)";

  const suiteBasename = scope && scope.suite
    ? path.basename(scope.suite)
    : (relFiles.find((f) => f.endsWith(".test.mjs")) || `${stepName}.regression.test.mjs`);

  const command = `node ops-watcher/run-all-tests.mjs --only ${suiteBasename}`;

  const evidenceLine = Array.isArray(evidence) && evidence.length
    ? `evidence log: ${evidence.length} prior record(s) recorded by the detector`
    : "evidence log: no prior detector records";

  return [
    `SELF-REPAIR TASK: ${stepName}`,
    ``,
    `A heartbeat step is failing repeatedly and the detector has cleared it for an automated repair drill. Your job is to make the failing step's regression suite pass again WITHOUT weakening safety.`,
    ``,
    `FAILING STEP: ${stepName}`,
    `NEWEST ERROR EXCERPT:`,
    `  ${excerpt}`,
    ``,
    `THE ONLY TWO FILES YOU MAY EDIT (do not touch anything else):`,
    fileLines,
    ``,
    `THE EXACT COMMAND THAT MUST PASS AFTER YOUR EDIT:`,
    `  ${command}`,
    ``,
    `HARD STOPS — violating any of these aborts the drill and escalates to a human:`,
    `  - No other file may be created, edited, renamed, or deleted besides the two listed above.`,
    `  - No pm2, no git, no shell, no child processes, no lane calls.`,
    `  - No network, no HTTP, no Telegram, no Paperclip.`,
    `  - No new dependencies; only Node built-ins and existing local modules.`,
    `  - Do NOT weaken, skip, comment out, or delete assertions to make the suite pass.`,
    `  - Do NOT change the suite's pass/fail contract; the assertions are the safety guarantee.`,
    `  - Do NOT broaden the scope; if the fix needs another file, stop and report instead.`,
    ``,
    `WHEN DONE: run the exact command above. If it exits 0, the drill is complete. If you cannot fix it within the scope, leave the files untouched and report what you found.`,
    ``,
    evidenceLine,
  ].join("\n");
}

// =====================================================================
// snapshotFiles — copies each file's bytes into <dir>/<timestamp>/ preserving
// basenames. Never throws; returns { ok: false, error } on any failure.
// =====================================================================
export async function snapshotFiles(files, { dir = BACKUP_DIR, now = Date.now, _fs } = {}) {
  const fsApi = _fs || realFs;
  const list = Array.isArray(files) ? files : [];
  try {
    const stamp = String(now());
    const stampDir = path.join(dir, stamp);
    await fsApi.mkdir(stampDir, { recursive: true });
    const entries = [];
    for (const file of list) {
      const raw = await fsApi.readFile(file);
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const base = path.basename(file);
      const backup = path.join(stampDir, base);
      await fsApi.writeFile(backup, buf);
      entries.push({ file, backup, bytes: buf.length });
    }
    return { ok: true, dir: stampDir, entries };
  } catch (error) {
    return { ok: false, error };
  }
}

// =====================================================================
// restoreFiles — writes each backup's bytes back over its original path.
// A snapshot with ok: false restores nothing and returns { ok: false }.
// Never throws.
// =====================================================================
export async function restoreFiles(snapshot, { _fs } = {}) {
  if (!snapshot || snapshot.ok === false) {
    return { ok: false, restored: 0 };
  }
  const fsApi = _fs || realFs;
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  let restored = 0;
  try {
    for (const entry of entries) {
      const raw = await fsApi.readFile(entry.backup);
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      await fsApi.writeFile(entry.file, buf);
      restored++;
    }
    return { ok: true, restored };
  } catch (error) {
    return { ok: false, restored, error };
  }
}

// =====================================================================
// Part 2: bounded repair attempt, escalation, and the drill CLI.
// =====================================================================

// Normalize a suite result to a boolean. Accepts either an explicit { ok } or
// the runAllTests summary shape { total, failed }.
function suiteOk(r) {
  if (!r) return false;
  if (typeof r.ok === "boolean") return r.ok;
  if (typeof r.failed === "number" && typeof r.total === "number") {
    return r.total > 0 && r.failed === 0;
  }
  return false;
}

async function readStateRaw({ readFile, stateFile }) {
  const rf = readFile || realFs.readFile;
  const file = stateFile || STATE_FILE;
  try {
    const raw = await rf(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStateRaw(state, { writeFile, stateFile }) {
  const wf = writeFile || realFs.writeFile;
  const file = stateFile || STATE_FILE;
  try {
    await wf(file, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // Bookkeeping is best-effort; a repair decision is never blocked by it.
  }
}

// resetCanaryStepBookkeeping — DRILL PATH ONLY. Removes only the canary step's
// attempt bookkeeping from the state file so a drill is never blocked by a
// previous drill's recorded attempt. Every other step's bookkeeping (attempts,
// escalations, faults) is left untouched. Does NOT change shouldAttemptRepair
// or REPAIR_COOLDOWN_MS; production steps keep their full cooldown.
export async function resetCanaryStepBookkeeping({ readFile, writeFile, stateFile } = {}) {
  const state = await readStateRaw({ readFile, stateFile });
  const attempts = (state && state.attempts && typeof state.attempts === "object") ? state.attempts : null;
  if (attempts && Object.prototype.hasOwnProperty.call(attempts, DRILL_STEP_NAME)) {
    const nextAttempts = { ...attempts };
    delete nextAttempts[DRILL_STEP_NAME];
    const next = { ...state, attempts: nextAttempts };
    await writeStateRaw(next, { writeFile, stateFile });
    return { cleared: true, stepName: DRILL_STEP_NAME };
  }
  return { cleared: false, stepName: DRILL_STEP_NAME };
}

// Default scoped-suite runner: delegates to runAllTests with --only set and
// normalizes the summary to { ok, summary }.
function makeDefaultRunSuite(runAllTestsFn) {
  return async (suiteBasename) => {
    const summary = await runAllTestsFn({ only: suiteBasename });
    return { ok: suiteOk(summary), summary };
  };
}

async function defaultRunSuite(suiteBasename) {
  return makeDefaultRunSuite(defaultRunAllTests)(suiteBasename);
}

// Default repair dispatcher factory: builds a dispatcher that spawns the
// lane's node-wrapper relay with shell:false so the free-form packet is one
// argv element, a 12-minute timeout, captured stdout/stderr, and never throws.
// The wrapper path is repo-relative (e.g. "ops-watcher/corleone-dispatch.mjs"
// or "ops-watcher/hatta-dispatch.mjs"), so a real drill can run on whichever
// implementation lane is actually alive.
function makeDefaultDispatchRepair(wrapperRel) {
  return function defaultDispatchRepair(packet) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let child;
      const finish = (r) => { if (settled) return; settled = true; resolve(r); };
      try {
        child = spawn(NODE, [wrapperRel, packet], {
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          shell: false,
        });
      } catch (err) {
        finish({ ok: false, stdout: "", stderr: String((err && err.message) || err) });
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch { /* best-effort */ }
      }, DISPATCH_TIMEOUT_MS);
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => {
        clearTimeout(timer);
        finish({ ok: false, stdout, stderr: stderr + String((err && err.message) || err) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish({ ok: code === 0 && !timedOut, stdout, stderr });
      });
    });
  };
}

// attemptRepair — the bounded repair attempt. Every branch appends exactly one
// evidence entry. Branches (c)–(h) record an attempt timestamp (they reached
// the lane); (a), (b), and the unknown-lane refusal do not. Never calls git,
// pm2, Paperclip or Telegram.
//
// deps.lane selects the repair lane (default DEFAULT_REPAIR_LANE). The guard,
// dispatch wrapper, and lane-outcome recording all use that lane's guardName /
// wrapper; the lane name is carried in the evidence entry and the returned
// object. An unknown lane is refused before anything else.
export async function attemptRepair(fault, deps = {}) {
  const nowFn = deps.now || Date.now;
  const startedAt = nowFn();
  const stateFile = deps.stateFile || STATE_FILE;
  const evidenceDeps = {
    appendFile: deps.appendFile,
    file: deps.evidenceLogFile || EVIDENCE_LOG_FILE,
    now: nowFn,
  };
  const runAllTestsFn = deps.runAllTests || defaultRunAllTests;
  const runSuiteFn = deps.runSuite || makeDefaultRunSuite(runAllTestsFn);
  const guardLane = deps.guardLane || defaultGuardLaneStart;
  const recordOutcome = deps.recordOutcome || defaultRecordLaneOutcome;
  const snapshotFn = deps.snapshotFiles || snapshotFiles;
  const restoreFn = deps.restoreFiles || restoreFiles;
  const stepName = fault && fault.name;
  const laneName = deps.lane || DEFAULT_REPAIR_LANE;
  const lane = REPAIR_LANES[laneName];
  const makeDispatchRepairFn = deps.makeDispatchRepair || makeDefaultDispatchRepair;
  const dispatchRepair = deps.dispatchRepair || makeDispatchRepairFn(lane && lane.wrapper);

  async function emit(result) {
    await appendEvidence({ type: "repair-attempt", name: stepName, ...result, lane: laneName }, evidenceDeps);
    return { ...result, lane: laneName };
  }

  async function recordAttempt() {
    const fresh = await readStateRaw({ readFile: deps.readFile, stateFile });
    fresh.attempts = fresh.attempts || {};
    fresh.attempts[stepName] = { ...(fresh.attempts[stepName] || {}), lastAttemptMs: nowFn() };
    await writeStateRaw(fresh, { writeFile: deps.writeFile, stateFile });
  }

  // (0) Unknown lane: reject before doing anything else.
  if (!lane) {
    return emit({ outcome: "refused", reason: "unknown-lane" });
  }

  // (a) Envelope: deny-listed / unscoped step.
  const scope = repairScopeFor(stepName);
  if (!scope) {
    return emit({ outcome: "refused", reason: "envelope" });
  }

  // (b) Cooldown: a recent attempt for this step is still within the window.
  const state = await readStateRaw({ readFile: deps.readFile, stateFile });
  if (!shouldAttemptRepair(state, stepName, nowFn())) {
    return emit({ outcome: "skipped", reason: "cooldown" });
  }

  const suiteBasename = path.basename(scope.suite);

  // (c) Lane guard skip: the chosen lane is not healthy right now.
  const guard = await guardLane(lane.guardName, deps.guardLaneDeps || {});
  if (guard && guard.skip) {
    await recordAttempt();
    return emit({ outcome: "skipped", reason: "lane-" + (guard.reason || "unknown") });
  }

  // (d) Baseline: the scoped suite already passes — fault not reproducible.
  const baseline = await runSuiteFn(suiteBasename);
  if (suiteOk(baseline)) {
    await recordAttempt();
    return emit({ outcome: "not-reproducible" });
  }

  // (e) Snapshot the scoped files before any edit. No snapshot -> no dispatch.
  const snapshot = await snapshotFn(scope.files, {
    dir: deps.snapshotDir || BACKUP_DIR,
    now: nowFn,
    _fs: deps._fs,
  });
  if (!snapshot || snapshot.ok === false) {
    await recordAttempt();
    return emit({ outcome: "aborted", reason: "snapshot-failed" });
  }

  // (f) Dispatch the repair packet to the lane, then record the lane outcome.
  const evidence = Array.isArray(fault.records) ? fault.records : [];
  const packet = buildRepairPacket(fault, scope, evidence);
  const dispatch = await dispatchRepair(packet);
  await recordOutcome(lane.guardName, {
    ok: !!(dispatch && dispatch.ok),
    stdout: dispatch && dispatch.stdout,
    stderr: dispatch && dispatch.stderr,
  }, deps.recordOutcomeDeps || {});

  // (g) Verify scoped suite first. Still red -> roll back.
  const scopedAfter = await runSuiteFn(suiteBasename);
  if (!suiteOk(scopedAfter)) {
    await restoreFn(snapshot, { _fs: deps._fs });
    await recordAttempt();
    return emit({ outcome: "reverted", reason: "scoped-suite-red" });
  }

  // (h) Verify the FULL suite (no filter). Red -> roll back.
  const fullSummary = await runAllTestsFn({});
  if (!suiteOk(fullSummary)) {
    await restoreFn(snapshot, { _fs: deps._fs });
    await recordAttempt();
    return emit({ outcome: "reverted", reason: "full-suite-red" });
  }

  await recordAttempt();
  return emit({ outcome: "repaired", suite: suiteBasename, durationMs: nowFn() - startedAt });
}

// escalate — one owner alert in professional Bahasa Indonesia, with a 24-hour
// per-step cooldown stored in the state file. Never called by any test path.
function buildEscalationMessage(fault) {
  const name = (fault && fault.name) || "unknown";
  const kind = (fault && fault.kind) || "unknown";
  return [
    `SELF-REPAIR gagal memperbaiki step ${name} secara otomatis (${kind}).`,
    `Percobaan terakhir dikembalikan ke kondisi semula (rollback berhasil).`,
    `Bukti: ops-watcher/self-repair-log.jsonl.`,
    `Perlu keputusan/penanganan manual.`,
  ].join(" ");
}

// Default alert: spawn ahmad-notify.mjs detached exactly the way audit-clerk.mjs
// spawns it. Never throws.
function defaultPostAlert(message) {
  try {
    const child = spawn(NODE, ["ops-watcher/ahmad-notify.mjs", message], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { pid: child.pid };
  } catch (err) {
    return { pid: null, error: String((err && err.message) || err) };
  }
}

export async function escalate(fault, _evidence, deps = {}) {
  const nowFn = deps.now || Date.now;
  const stateFile = deps.stateFile || STATE_FILE;
  const postAlert = deps.postAlert || defaultPostAlert;
  const nowMs = nowFn();
  const stepName = fault && fault.name;
  const state = await readStateRaw({ readFile: deps.readFile, stateFile });
  const escalations = (state.escalations && typeof state.escalations === "object") ? state.escalations : {};
  const prev = escalations[stepName];
  if (prev && Number.isFinite(prev.lastAlertedMs) && nowMs - prev.lastAlertedMs < ESCALATION_COOLDOWN_MS) {
    return { alerted: false, reason: "cooldown" };
  }
  const message = buildEscalationMessage(fault);
  // postAlert never throws: it catches its own spawn failure and reports it in
  // the return value, so the old `try { postAlert(m) } catch {}` caught nothing
  // and `alerted: true` was unconditional. Writing lastAlertedMs after a failed
  // alert was the worse half — the cooldown above then suppressed every retry,
  // turning one undelivered escalation into a permanently silent channel.
  const delivery = await deliverAlert(() => postAlert(message));
  if (!delivery.delivered) {
    return { alerted: false, reason: `escalation alert failed: ${delivery.reason}` };
  }
  state.escalations = { ...escalations, [stepName]: { lastAlertedMs: nowMs } };
  await writeStateRaw(state, { writeFile: deps.writeFile, stateFile });
  return { alerted: true, pid: delivery.pid ?? null };
}

// =====================================================================
// evaluateDrillChecks — PURE. The dry-drill success criteria evaluator.
//
// A dry drill PASSES only when ALL FIVE of these hold:
//   1. baseline suite red          (the injected logic fault is detected)
//   2. attempt outcome             (\"reverted:scoped-suite-red\")
//   3. rollback by attemptRepair   (the rollback ran inside attemptRepair,
//                                    not only via the outer safety net)
//   4. matchesCorrupted            (immediately after attemptRepair the canary
//                                    is byte-identical to the CORRUPTED content
//                                    the drill injected — the rollback restored
//                                    the pre-repair state exactly and the
//                                    lane's no-op changes were undone)
//   5. matchesOriginal + finalSuiteGreen
//                                  (after the outer try/finally restore the
//                                    canary is byte-identical to its ORIGINAL
//                                    content, canaryAdd(2,2)===4, and the
//                                    canary suite is green)
//
// Returns { ok, checks, failedCheck }. `checks` is the five {name,pass} entries
// in order; `failedCheck` is the name of the first failing check, or null.
// =====================================================================
export function evaluateDrillChecks({
  baselineRed,
  outcome,
  rollbackByAttempt,
  matchesCorrupted,
  matchesOriginal,
  finalSuiteGreen,
} = {}) {
  const checks = [
    { name: "baseline suite red", pass: baselineRed === true },
    { name: "attempt outcome reverted:scoped-suite-red", pass: outcome === "reverted:scoped-suite-red" },
    { name: "rollback by attemptRepair", pass: rollbackByAttempt === true },
    { name: "canary byte-identical to corrupted content after attemptRepair", pass: matchesCorrupted === true },
    { name: "canary byte-identical to original and suite green after outer restore", pass: matchesOriginal === true && finalSuiteGreen === true },
  ];
  const failed = checks.filter((c) => !c.pass);
  const ok = failed.length === 0;
  return { ok, checks, failedCheck: ok ? null : failed[0].name };
}

// =====================================================================
// The drill CLI — the proof.
//   node ops-watcher/self-repair-actuator.mjs --drill [--dry] [--lane <corleone|hatta>]
//
// `--lane` selects the repair lane for the drill (default corleone). In --dry
// mode the lane is still recorded and printed, but the dispatcher and guard
// stay stubbed as they are today. For a REAL drill (no --dry) a real lane is
// expected to actually fix the canary, so the success checks differ (see the
// live verdict below). The acceptable non-success result is a clean rollback.
// Exit 1 happens ONLY when a SAFETY property breaks: the canary is left
// corrupted, the rollback did not happen when it should have, or the outer
// restore failed.
// =====================================================================
async function runDrill({ dry, lane }) {
  if (!REPAIR_LANES[lane]) {
    console.error(`unknown lane: ${lane} (valid: ${Object.keys(REPAIR_LANES).join(", ")})`);
    return 1;
  }

  const realFsApi = realFs;
  const canaryFile = path.join(__dirname, "canary-step.mjs");
  const canaryTestFile = path.join(__dirname, "canary-step.regression.test.mjs");
  const suiteBasename = path.basename(canaryTestFile);

  let originalBytes = null;
  let corruptedBytes = null;
  let snapshot = null;
  let intendedExit = 1;
  // v collects every measurement the verdict needs. `aborted` is set whenever
  // the drill bails before reaching attemptRepair; in that case the verdict is
  // skipped (there is nothing to evaluate) and we exit 1.
  const v = { rollbackByAttempt: false, aborted: null };

  try {
    // 1. Remember the canary's exact bytes.
    originalBytes = await realFsApi.readFile(canaryFile);
    v.beforeLen = originalBytes.length;
    const beforeMod = await import(pathToFileURL(canaryFile) + "?before=" + Date.now());
    v.beforeAdd = beforeMod.canaryAdd(2, 2);

    // 2. Snapshot the canary pair. This is the OUTER safety net, taken BEFORE
    //    any corruption. It is distinct from the snapshot attemptRepair takes
    //    (which is taken after corruption, i.e. of the corrupted file).
    snapshot = await snapshotFiles([canaryFile, canaryTestFile], { _fs: realFsApi, now: Date.now });
    if (!snapshot || snapshot.ok === false) {
      v.aborted = "snapshot failed — aborting before any corruption";
      return;
    }

    // 3. Corrupt canary-step.mjs with a LOGIC fault (still parses).
    const originalText = originalBytes.toString("utf8");
    const corruptedText = originalText.replace("return a + b;", "return a + b + 1;");
    if (corruptedText === originalText) {
      v.aborted = "could not inject logic fault (canary source shape changed)";
      return;
    }
    await realFsApi.writeFile(canaryFile, corruptedText);
    corruptedBytes = Buffer.from(corruptedText, "utf8");

    // 4. Assert the scoped suite now FAILS (check 1).
    const scopedCheck = await defaultRunSuite(suiteBasename);
    v.baselineState = scopedCheck.ok ? "green" : "red";
    if (scopedCheck.ok) {
      v.aborted = "canary test too weak to detect the injected fault (scoped suite still green after corruption)";
      return;
    }

    // 4b. Drill path only: clear the canary step's own attempt bookkeeping so a
    //     previous drill's recorded attempt never blocks this one. Production
    //     steps are untouched. (Real attemptRepair calls never do this.)
    await resetCanaryStepBookkeeping({});

    // 5. Synthetic fault + attemptRepair. In --dry the lane is simulated healthy
    //    and the dispatcher changes nothing but reports success, so the expected
    //    outcome is `reverted` (the rollback path inside attemptRepair). Without
    //    --dry the real lane dispatcher and lane guard run for the chosen lane.
    const fault = {
      name: "canary-step",
      kind: "test-red",
      records: [{ name: "canary-step", excerpt: "AssertionError: canaryAdd(2,2) returned 5, expected 4" }],
    };
    const attemptDeps = dry
      ? {
          lane,
          dispatchRepair: async () => ({ ok: true, stdout: "dry-run: no file change", stderr: "" }),
          recordOutcome: async () => ({ recorded: true }),
          guardLane: async () => ({ skip: false, reason: null, remainingMs: 0, laneKey: "codex" }),
          restoreFiles: async (snap, opts) => {
            v.rollbackByAttempt = true;
            return restoreFiles(snap, opts);
          },
        }
      : { lane };
    const result = await attemptRepair(fault, attemptDeps);
    v.outcome = result.outcome + (result.reason ? ":" + result.reason : "");
    v.lane = result.lane || lane;

    // 6. Immediately after attemptRepair: prove the rollback restored the
    //    PRE-REPAIR (corrupted) state byte-for-byte. attemptRepair snapshots the
    //    files as they are when the repair begins — which, in a drill, is the
    //    deliberately corrupted canary — so rolling back restores the corrupted
    //    content. That is exactly correct: a rollback undoes the repair
    //    attempt's edits; it does not magically fix the original fault.
    const afterAttemptBytes = await realFsApi.readFile(canaryFile);
    v.afterAttemptLen = afterAttemptBytes.length;
    v.matchesCorrupted = !!(corruptedBytes && afterAttemptBytes.equals(corruptedBytes));
    const afterAttemptMod = await import(pathToFileURL(canaryFile) + "?afterattempt=" + Date.now());
    v.afterAttemptAdd = afterAttemptMod.canaryAdd(2, 2);

    // Live-only: the scoped suite state immediately after the attempt (real
    // check 4). In dry mode this is unnecessary — the dry verdict does not use
    // it — so it is skipped to keep the dry path byte-for-byte unchanged.
    if (!dry) {
      try {
        const scopedAfter = await defaultRunSuite(suiteBasename);
        v.scopedGreenAfter = !!scopedAfter.ok;
      } catch {
        v.scopedGreenAfter = false;
      }
    }

    // Evidence count (best-effort; the log may not exist).
    try {
      const logText = await realFsApi.readFile(EVIDENCE_LOG_FILE, "utf8");
      v.evidenceCount = String(logText || "").split(/\r?\n/)
        .filter((l) => l.trim() && l.includes("canary-step") && l.includes("repair-attempt")).length;
    } catch {
      v.evidenceCount = 0;
    }

    // NOTE: the final suite state and original-content identity are measured
    // AFTER the outer restore, in the finally block below. Measuring them here
    // (before the outer restore) would read "red" / "5" because the rollback
    // correctly left the canary in its corrupted pre-repair state.
  } catch (err) {
    console.log("DRILL ERROR:", err && err.stack ? err.stack : err);
    v.aborted = "drill threw: " + (err && err.message ? err.message : String(err));
    intendedExit = 1;
  } finally {
    // 7. ALWAYS restore the canary pair via the OUTER safety net. This is
    //    distinct from any rollback attemptRepair performed: this snapshot was
    //    taken before corruption, so it restores the ORIGINAL content.
    if (snapshot && snapshot.ok && originalBytes) {
      try {
        await restoreFiles(snapshot, { _fs: realFsApi });
      } catch (e) {
        console.log("DRILL: outer restore threw:", e && e.message);
      }
    }

    // Abort path: the drill bailed before attemptRepair ran. Nothing to
    // evaluate; just confirm the outer restore (if anything was corrupted) and
    // exit 1.
    if (v.aborted) {
      console.log("DRILL ABORT:", v.aborted);
      if (snapshot && snapshot.ok && originalBytes) {
        try {
          const restored = await realFsApi.readFile(canaryFile);
          if (restored.equals(originalBytes)) {
            console.log(`DRILL SAFETY: canary restored byte-identical (${canaryFile}, ${restored.length} bytes)`);
          } else {
            console.log(`DRILL SAFETY FAILURE: could not restore ${canaryFile}`);
            intendedExit = 1;
          }
        } catch (e) {
          console.log(`DRILL SAFETY FAILURE: could not verify restored ${canaryFile}: ${e && e.message}`);
          intendedExit = 1;
        }
      }
      return intendedExit;
    }

    // 8. After the outer restore: the canary must be byte-identical to its
    //    ORIGINAL content, canaryAdd(2,2)===4, and the canary suite green.
    let matchesOriginal = false;
    let finalSuiteGreen = false;
    let restoredLen = null;
    let restoredAdd = null;
    try {
      const restoredBytes = await realFsApi.readFile(canaryFile);
      restoredLen = restoredBytes.length;
      matchesOriginal = !!originalBytes && restoredBytes.equals(originalBytes);
      const restoredMod = await import(pathToFileURL(canaryFile) + "?restored=" + Date.now());
      restoredAdd = restoredMod.canaryAdd(2, 2);
      const finalCheck = await defaultRunSuite(suiteBasename);
      finalSuiteGreen = !!finalCheck.ok;
    } catch (e) {
      console.log("DRILL: post-restore measurement threw:", e && e.message);
    }

    // =====================================================================
    // DRY verdict — unchanged five-check block, with the lane printed.
    // =====================================================================
    if (dry) {
      const verdict = evaluateDrillChecks({
        baselineRed: v.baselineState === "red",
        outcome: v.outcome,
        rollbackByAttempt: v.rollbackByAttempt === true,
        matchesCorrupted: v.matchesCorrupted === true,
        matchesOriginal,
        finalSuiteGreen,
      });

      console.log("==== DRILL VERDICT ====");
      console.log(`mode: dry`);
      console.log(`lane: ${v.lane || lane}`);
      console.log(`baseline suite: ${v.baselineState}`);
      console.log(`attempt outcome: ${v.outcome}`);
      console.log(`canary bytes before: ${v.beforeLen}, after attemptRepair: ${v.afterAttemptLen}, after restore: ${restoredLen}`);
      console.log(`canaryAdd(2,2) before: ${v.beforeAdd}, after attemptRepair: ${v.afterAttemptAdd}, after restore: ${restoredAdd}`);
      console.log(`rollback by attempt: ${v.rollbackByAttempt ? "yes" : "no"}`);
      console.log(`evidence entries appended: ${v.evidenceCount}`);
      console.log(`final suite (after outer restore): ${finalSuiteGreen ? "green" : "red"}`);
      console.log(`--- dry-drill checks ---`);
      for (const c of verdict.checks) {
        console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
      }

      if (verdict.ok) {
        console.log("DRILL OK: all five checks passed");
        intendedExit = 0;
      } else {
        console.log(`DRILL FAILURE: ${verdict.failedCheck}`);
        intendedExit = 1;
      }
      return intendedExit;
    }

    // =====================================================================
    // LIVE verdict — a real lane is expected to actually fix the canary.
    // The five success checks:
    //   1. baseline suite red
    //   2. attempt outcome `repaired`
    //   3. rollback NOT performed by attemptRepair
    //   4. after the attempt, canaryAdd(2,2) === 4 and the scoped suite green
    //   5. after the outer restore, canary byte-identical to ORIGINAL and suite
    //      still green
    // If the lane fails to fix it, the expected-and-acceptable outcome is
    // `reverted` with a clean rollback -> exit 0. Exit 1 ONLY when a SAFETY
    // property breaks: the canary is left corrupted, the rollback did not
    // happen when it should have, or the outer restore failed.
    // =====================================================================
    const isRepaired = v.outcome === "repaired";
    const isReverted = typeof v.outcome === "string" && v.outcome.startsWith("reverted");
    const scopedGreenAfter = v.scopedGreenAfter === true;
    const safetyRestored = matchesOriginal && finalSuiteGreen;

    const liveChecks = [
      { name: "baseline suite red", pass: v.baselineState === "red" },
      { name: "attempt outcome repaired", pass: isRepaired },
      { name: "rollback NOT performed by attemptRepair", pass: v.matchesCorrupted === false },
      { name: "canaryAdd(2,2)===4 and scoped suite green after attempt", pass: v.afterAttemptAdd === 4 && scopedGreenAfter },
      { name: "canary byte-identical to original and suite green after outer restore", pass: matchesOriginal && finalSuiteGreen },
    ];
    const allSuccessChecksPass = liveChecks.every((c) => c.pass);

    console.log("==== DRILL VERDICT ====");
    console.log(`mode: live`);
    console.log(`lane: ${v.lane || lane}`);
    console.log(`baseline suite: ${v.baselineState}`);
    console.log(`attempt outcome: ${v.outcome}`);
    console.log(`canary bytes before: ${v.beforeLen}, after attemptRepair: ${v.afterAttemptLen}, after restore: ${restoredLen}`);
    console.log(`canaryAdd(2,2) before: ${v.beforeAdd}, after attemptRepair: ${v.afterAttemptAdd}, after restore: ${restoredAdd}`);
    console.log(`rollback by attempt: ${v.matchesCorrupted ? "yes (canary matches corrupted pre-repair state)" : "no"}`);
    console.log(`scoped suite after attempt: ${scopedGreenAfter ? "green" : "red"}`);
    console.log(`evidence entries appended: ${v.evidenceCount}`);
    console.log(`final suite (after outer restore): ${finalSuiteGreen ? "green" : "red"}`);
    console.log(`--- drill checks ---`);
    for (const c of liveChecks) {
      console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
    }

    if (allSuccessChecksPass) {
      console.log("DRILL OK: all five checks passed");
      return 0;
    }

    // The lane could not fix it. A clean rollback is a valid, honest result.
    if (isReverted) {
      const rollbackClean = v.matchesCorrupted === true && safetyRestored;
      if (rollbackClean) {
        console.log("DRILL RESULT: lane could not repair, rollback clean");
        return 0;
      }
      // Rollback did not happen when it should have, or the outer restore failed.
      console.log("DRILL SAFETY FAILURE: rollback not clean or outer restore failed");
      return 1;
    }

    // Any other outcome (skipped / refused / aborted / not-reproducible): no
    // repair was attempted or completed. That is not itself a safety break; the
    // only thing that matters is that the canary was left whole.
    if (safetyRestored) {
      console.log(`DRILL RESULT: ${v.outcome} — no safety break, canary restored`);
      return 0;
    }
    console.log("DRILL SAFETY FAILURE: canary corrupted or outer restore failed");
    return 1;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--drill") {
    const dry = argv.includes("--dry");
    let lane = DEFAULT_REPAIR_LANE;
    const laneIdx = argv.indexOf("--lane");
    if (laneIdx !== -1 && argv[laneIdx + 1]) {
      lane = argv[laneIdx + 1];
    }
    const code = await runDrill({ dry, lane });
    process.exit(code);
  }
  console.error("usage: node ops-watcher/self-repair-actuator.mjs --drill [--dry] [--lane <corleone|hatta>]");
  process.exit(2);
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
    console.error("self-repair-actuator fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}