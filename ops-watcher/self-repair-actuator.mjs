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

// The repo root is one level above ops-watcher; repair packets must print
// repo-relative paths so a repair lane never sees machine-specific prefixes.
const REPO_ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath || "node";
const ESCALATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DISPATCH_TIMEOUT_MS = 12 * 60 * 1000;

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

// Default repair dispatcher: spawns the CORLEONE relay with shell:false so the
// free-form packet is one argv element, a 12-minute timeout, captured
// stdout/stderr, and never throws.
function defaultDispatchRepair(packet) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    try {
      child = spawn(NODE, ["ops-watcher/corleone-dispatch.mjs", packet], {
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
}

// attemptRepair — the bounded repair attempt. Every branch appends exactly one
// evidence entry. Branches (c)–(h) record an attempt timestamp (they reached
// the lane); (a) and (b) do not. Never calls git, pm2, Paperclip or Telegram.
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
  const dispatchRepair = deps.dispatchRepair || defaultDispatchRepair;
  const snapshotFn = deps.snapshotFiles || snapshotFiles;
  const restoreFn = deps.restoreFiles || restoreFiles;
  const stepName = fault && fault.name;

  async function emit(result) {
    await appendEvidence({ type: "repair-attempt", name: stepName, ...result }, evidenceDeps);
    return result;
  }

  async function recordAttempt() {
    const fresh = await readStateRaw({ readFile: deps.readFile, stateFile });
    fresh.attempts = fresh.attempts || {};
    fresh.attempts[stepName] = { ...(fresh.attempts[stepName] || {}), lastAttemptMs: nowFn() };
    await writeStateRaw(fresh, { writeFile: deps.writeFile, stateFile });
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

  // (c) Lane guard skip: the corleone lane is not healthy right now.
  const guard = await guardLane("corleone", deps.guardLaneDeps || {});
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
  await recordOutcome("corleone", {
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
  try { postAlert(message); } catch { /* best-effort */ }
  state.escalations = { ...escalations, [stepName]: { lastAlertedMs: nowMs } };
  await writeStateRaw(state, { writeFile: deps.writeFile, stateFile });
  return { alerted: true };
}

// =====================================================================
// The drill CLI — the proof.
//   node ops-watcher/self-repair-actuator.mjs --drill [--dry]
// =====================================================================
async function runDrill({ dry }) {
  const realFsApi = realFs;
  const canaryFile = path.join(__dirname, "canary-step.mjs");
  const canaryTestFile = path.join(__dirname, "canary-step.regression.test.mjs");
  const suiteBasename = path.basename(canaryTestFile);

  let originalBytes = null;
  let snapshot = null;
  let intendedExit = 1;
  const v = {};

  try {
    // 1. Remember the canary's exact bytes.
    originalBytes = await realFsApi.readFile(canaryFile);
    v.beforeLen = originalBytes.length;
    const beforeMod = await import(pathToFileURL(canaryFile) + "?before=" + Date.now());
    v.beforeAdd = beforeMod.canaryAdd(2, 2);

    // 2. Snapshot the canary pair.
    snapshot = await snapshotFiles([canaryFile, canaryTestFile], { _fs: realFsApi, now: Date.now });
    if (!snapshot || snapshot.ok === false) {
      console.log("DRILL: snapshot failed — aborting before any corruption");
      intendedExit = 1;
      return;
    }

    // 3. Corrupt canary-step.mjs with a LOGIC fault (still parses).
    const originalText = originalBytes.toString("utf8");
    const corruptedText = originalText.replace("return a + b;", "return a + b + 1;");
    if (corruptedText === originalText) {
      console.log("DRILL ABORT: could not inject logic fault (canary source shape changed)");
      intendedExit = 1;
      return;
    }
    await realFsApi.writeFile(canaryFile, corruptedText);

    // 4. Assert the scoped suite now FAILS.
    const scopedCheck = await defaultRunSuite(suiteBasename);
    v.baselineState = scopedCheck.ok ? "green" : "red";
    if (scopedCheck.ok) {
      console.log("DRILL ABORT: canary test too weak to detect the injected fault (scoped suite still green after corruption)");
      intendedExit = 1;
      return;
    }

    // 5. Synthetic fault + attemptRepair. In --dry the dispatcher changes
    //    nothing but reports success, so the expected outcome is `reverted`
    //    (the rollback path). Without --dry the real CORLEONE dispatcher runs.
    const fault = {
      name: "canary-step",
      kind: "test-red",
      records: [{ name: "canary-step", excerpt: "AssertionError: canaryAdd(2,2) returned 5, expected 4" }],
    };
    const attemptDeps = dry
      ? {
          dispatchRepair: async () => ({ ok: true, stdout: "dry-run: no file change", stderr: "" }),
          recordOutcome: async () => ({ recorded: true }),
        }
      : {};
    const result = await attemptRepair(fault, attemptDeps);
    v.outcome = result.outcome + (result.reason ? ":" + result.reason : "");

    // 6. Verdict measurements.
    const finalCheck = await defaultRunSuite(suiteBasename);
    v.finalSuiteState = finalCheck.ok ? "green" : "red";
    const afterBytes = await realFsApi.readFile(canaryFile);
    v.afterLen = afterBytes.length;
    const afterMod = await import(pathToFileURL(canaryFile) + "?after=" + Date.now());
    v.afterAdd = afterMod.canaryAdd(2, 2);
    try {
      const logText = await realFsApi.readFile(EVIDENCE_LOG_FILE, "utf8");
      v.evidenceCount = String(logText || "").split(/\r?\n/)
        .filter((l) => l.trim() && l.includes("canary-step") && l.includes("repair-attempt")).length;
    } catch {
      v.evidenceCount = 0;
    }

    console.log("==== DRILL VERDICT ====");
    console.log(`mode: ${dry ? "dry" : "live"}`);
    console.log(`baseline suite: ${v.baselineState}`);
    console.log(`attempt outcome: ${v.outcome}`);
    console.log(`final suite: ${v.finalSuiteState}`);
    console.log(`canary bytes before: ${v.beforeLen}, after: ${v.afterLen}`);
    console.log(`canaryAdd(2,2) before: ${v.beforeAdd}, after: ${v.afterAdd}`);
    console.log(`evidence entries appended: ${v.evidenceCount}`);
    intendedExit = 0; // drill completed; finally still confirms the restore
  } catch (err) {
    console.log("DRILL ERROR:", err && err.stack ? err.stack : err);
    intendedExit = 1;
  } finally {
    // 7. ALWAYS restore the canary pair and verify byte-identity.
    if (snapshot && snapshot.ok && originalBytes) {
      try {
        await restoreFiles(snapshot, { _fs: realFsApi });
      } catch (e) {
        console.log("DRILL: restore threw:", e && e.message);
      }
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
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--drill") {
    const dry = argv.includes("--dry");
    const code = await runDrill({ dry });
    process.exit(code);
  }
  console.error("usage: node ops-watcher/self-repair-actuator.mjs --drill [--dry]");
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