// SELF-REPAIR detector: fault detection, classification, and safety envelope.
//
// This module intentionally contains NO actuation of its own: no child
// processes, no lane dispatch, no Telegram, and no project-code edits. It only
// reads heartbeat sweep evidence, classifies repeated failures, records
// detector evidence, and maintains minimal detector bookkeeping.
//
// --scan runs the read-only detector only (prints + records faults, never
//    dispatches). Used by a human or a dry-run to inspect what the detector
//    sees right now.
// --once  runs runSelfRepairOnce: the BOUNDED repair sweep the heartbeat wires
//    in as step 14. It runs the detector, then for at most
//    MAX_REPAIRS_PER_SWEEP repairable faults delegates to the actuator's
//    attemptRepair (snapshot/rollback + two-stage verification), and escalates
//    to the owner only when an attempt ended `reverted`. It NEVER runs more
//    often than SCAN_MIN_INTERVAL_MS, never dispatches more than the per-sweep
//    cap, and always resolves (never throws) so it can never wedge the
//    heartbeat.
//
// Rationale for the bounds: the heartbeat runs every 5 minutes, a single
// repair costs a real lane call (a CORLEONE dispatch with a 12-minute timeout),
// and an UNBOUNDED repair loop is exactly the failure mode that killed the
// SJAHRIR quota — the detector kept firing, the dispatcher kept calling the
// lane, and the quota burned down to a hard lockout. So the 30-minute scan
// cadence (SCAN_MIN_INTERVAL_MS), the per-sweep repair cap
// (MAX_REPAIRS_PER_SWEEP = 1), and the actuator's per-step 6-hour cooldown
// (REPAIR_COOLDOWN_MS) are all deliberate, layered brakes. No single sweep may
// spend more than one lane call, and no step may be retried more than once per
// cooldown window even across sweeps.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The actuator is imported only for its default attemptRepair / escalate
// bindings, which are read lazily inside runSelfRepairOnce (at call time, not
// at module-eval time). This is a harmless live-binding cycle: the actuator
// imports pure helpers from this module, and this module references the
// actuator's functions only when a sweep actually runs, by which point both
// modules are fully evaluated.
import * as actuator from "./self-repair-actuator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STEP_LOG_FILE = path.join(__dirname, "heartbeat-steps.jsonl");
export const STATE_FILE = path.join(__dirname, "self-repair-state.json");
export const EVIDENCE_LOG_FILE = path.join(__dirname, "self-repair-log.jsonl");
export const CONSECUTIVE_FAILURES_TO_ACT = 3;
export const REPAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// Bounded --once sweep bounds. See the file header for the rationale.
// SCAN_MIN_INTERVAL_MS: the minimum gap between two attempt-sweeps. A sweep
//   fired sooner than this is skipped wholesale (no scan, no dispatch).
// MAX_REPAIRS_PER_SWEEP: the hard cap on lane-dispatching attempts in a single
//   sweep. Additional repairable faults are logged and left for the next sweep.
export const SCAN_MIN_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_REPAIRS_PER_SWEEP = 1;

const DEFAULT_SWEEP_LIMIT = 10;
const TAIL_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;

const HARD_DENY_STEPS = new Set([
  "heartbeat",
  "telegram-listener",
  "telegram-notify",
  "ahmad-dispatch",
  "ahmad-escalate",
  "steward",
]);

const QUOTA_RE = /usage limit|quota|auth_error|insufficient_quota|rate limit exceeded|429/i;
const RUNTIME_FAILURE_RE = /\b(Error|TypeError|ReferenceError|SyntaxError|ENOENT|EACCES)\b| at .+:\d+:\d+/;

async function readTailText(file, deps = {}) {
  const { readFile } = deps;
  if (typeof readFile === "function") {
    return await readFile(file, "utf8");
  }

  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const size = Number.isFinite(stat.size) ? stat.size : 0;
    if (size <= 0) return "";
    const bytesToRead = Math.min(size, MAX_TAIL_BYTES);
    const chunks = [];
    let remaining = bytesToRead;
    let position = size - bytesToRead;
    while (remaining > 0) {
      const thisRead = Math.min(TAIL_CHUNK_BYTES, remaining);
      const buffer = Buffer.allocUnsafe(thisRead);
      const result = await handle.read(buffer, 0, thisRead, position);
      if (!result.bytesRead) break;
      chunks.push(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
      remaining -= result.bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* best-effort close */ }
    }
  }
}

function parseJsonLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Malformed heartbeat evidence is skipped, never fatal.
    }
  }
  return out;
}

export async function readRecentSweeps(limit = DEFAULT_SWEEP_LIMIT, deps = {}) {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_SWEEP_LIMIT;
  const file = deps.file || STEP_LOG_FILE;
  let text;
  try {
    text = await readTailText(file, deps);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    return [];
  }
  return parseJsonLines(text).slice(-max);
}

function isFailingRecord(record) {
  return !!record && record.skipped !== true && record.ok === false;
}

export function detectFaultingSteps(sweeps, { minConsecutive = CONSECUTIVE_FAILURES_TO_ACT } = {}) {
  const needed = Number.isFinite(minConsecutive) && minConsecutive > 0 ? Math.floor(minConsecutive) : CONSECUTIVE_FAILURES_TO_ACT;
  const allSweeps = Array.isArray(sweeps) ? sweeps : [];
  if (allSweeps.length === 0) return [];

  const newest = allSweeps[allSweeps.length - 1];
  const newestSteps = Array.isArray(newest && newest.steps) ? newest.steps : [];
  const candidates = newestSteps.filter(isFailingRecord).map((record) => record.name).filter(Boolean);
  const out = [];

  for (const name of candidates) {
    const recordsNewestFirst = [];
    for (let i = allSweeps.length - 1; i >= 0; i--) {
      const steps = Array.isArray(allSweeps[i] && allSweeps[i].steps) ? allSweeps[i].steps : [];
      const record = steps.find((step) => step && step.name === name);
      if (!isFailingRecord(record)) break;
      recordsNewestFirst.push(record);
    }
    if (recordsNewestFirst.length >= needed) {
      out.push({
        name,
        consecutiveFailures: recordsNewestFirst.length,
        records: recordsNewestFirst.reverse(),
      });
    }
  }

  return out;
}

export function classifyFault(records) {
  const list = Array.isArray(records) ? records : [];
  const newest = list.length ? list[list.length - 1] : null;
  const newestExcerpt = String((newest && newest.excerpt) || "");

  if (QUOTA_RE.test(newestExcerpt)) {
    return { kind: "lane-quota", reason: "newest excerpt matched quota/auth/rate-limit text" };
  }
  if (newest && newest.timedOut === true) {
    return { kind: "timeout", reason: "newest record timed out" };
  }

  const exitCode = newest && (Object.prototype.hasOwnProperty.call(newest, "exitCode") ? newest.exitCode : newest.code);
  const failedExit = exitCode === null || (typeof exitCode === "number" && exitCode !== 0);
  if (failedExit && RUNTIME_FAILURE_RE.test(newestExcerpt)) {
    return { kind: "crash", reason: "newest record had failed exit and runtime-failure excerpt" };
  }

  return { kind: "unknown", reason: "fault did not match a known classifier" };
}

export function repairScopeFor(stepName) {
  if (typeof stepName !== "string" || !/^[a-z0-9-]+$/.test(stepName)) return null;
  // Safety envelope rationale: heartbeat is the supervisor itself, the Telegram
  // pair can message the owner, ahmad-dispatch/escalate can write to Paperclip,
  // and steward can restart PM2. None of those may be rewritten by automated repair.
  if (HARD_DENY_STEPS.has(stepName)) return null;
  return {
    stepName,
    files: [
      path.join(__dirname, `${stepName}.mjs`),
      path.join(__dirname, `${stepName}.regression.test.mjs`),
    ],
    suite: path.join(__dirname, `${stepName}.regression.test.mjs`),
  };
}

export function shouldAttemptRepair(state, stepName, nowMs, cooldownMs = REPAIR_COOLDOWN_MS) {
  try {
    const last = state && state.attempts && state.attempts[stepName] && state.attempts[stepName].lastAttemptMs;
    if (!Number.isFinite(last)) return true;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const cooldown = Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : REPAIR_COOLDOWN_MS;
    return now - last >= cooldown;
  } catch {
    return true;
  }
}

export async function appendEvidence(entry, deps = {}) {
  const appendFile = deps.appendFile || fs.appendFile;
  const file = deps.file || EVIDENCE_LOG_FILE;
  const now = deps.now || Date.now;
  try {
    const record = { ...(entry && typeof entry === "object" ? entry : { value: entry }) };
    if (record.ts === undefined || record.ts === null) record.ts = now();
    await appendFile(file, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Evidence is best-effort. Detection must never crash because logging failed.
  }
}

async function readState(deps = {}) {
  const readFile = deps.readFile || fs.readFile;
  const file = deps.stateFile || STATE_FILE;
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeState(state, deps = {}) {
  const writeFile = deps.writeFile || fs.writeFile;
  const file = deps.stateFile || STATE_FILE;
  try {
    await writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // Bookkeeping is useful but non-fatal; the scan result is still authoritative.
  }
}

function markFirstSeenFaults(state, faults, nowMs) {
  const next = state && typeof state === "object" ? { ...state } : {};
  const existingFaults = next.faults && typeof next.faults === "object" ? next.faults : {};
  const nextFaults = { ...existingFaults };
  let changed = false;
  for (const fault of faults) {
    if (!nextFaults[fault.name]) {
      nextFaults[fault.name] = {
        firstSeenMs: nowMs,
        name: fault.name,
        kind: fault.kind,
        consecutiveFailures: fault.consecutiveFailures,
      };
      changed = true;
    }
  }
  next.faults = nextFaults;
  if (!next.attempts || typeof next.attempts !== "object") next.attempts = {};
  return { state: next, changed };
}

function blockedByFor({ scope, state, name, nowMs, kind, cooldownMs }) {
  if (!scope) return "envelope";
  if (!shouldAttemptRepair(state, name, nowMs, cooldownMs)) return "cooldown";
  if (kind === "lane-quota") return kind;
  return null;
}

export async function runSelfRepairScan(deps = {}) {
  const {
    limit = DEFAULT_SWEEP_LIMIT,
    minConsecutive = CONSECUTIVE_FAILURES_TO_ACT,
    log = (message) => console.log(message),
    now = Date.now,
    cooldownMs = REPAIR_COOLDOWN_MS,
    stepLogFile = STEP_LOG_FILE,
    evidenceLogFile = EVIDENCE_LOG_FILE,
    stateFile = STATE_FILE,
  } = deps;

  const nowMs = now();
  const sweeps = await readRecentSweeps(limit, { ...deps, file: stepLogFile });
  const state = await readState({ ...deps, stateFile });
  const detected = detectFaultingSteps(sweeps, { minConsecutive });
  const faults = detected.map((fault) => {
    const classification = classifyFault(fault.records);
    const scope = repairScopeFor(fault.name);
    const blockedBy = blockedByFor({
      scope,
      state,
      name: fault.name,
      nowMs,
      kind: classification.kind,
      cooldownMs,
    });
    return {
      name: fault.name,
      kind: classification.kind,
      reason: classification.reason,
      consecutiveFailures: fault.consecutiveFailures,
      repairable: blockedBy === null,
      blockedBy,
    };
  });

  const marked = markFirstSeenFaults(state, faults, nowMs);
  if (marked.changed) await writeState(marked.state, { ...deps, stateFile });

  for (const fault of faults) {
    try {
      log(`self-repair: fault ${fault.name} kind=${fault.kind} consecutive=${fault.consecutiveFailures} repairable=${fault.repairable} blockedBy=${fault.blockedBy || "none"}`);
    } catch {
      // Logging is observational only.
    }
    await appendEvidence({ type: "fault", ...fault }, { ...deps, file: evidenceLogFile, now });
  }

  return { scannedSweeps: sweeps.length, faults };
}

// =====================================================================
// runSelfRepairOnce — the bounded repair sweep wired into heartbeat step 14.
//
// deps (all optional, all injectable so the regression suite is fully offline):
//   scan          : async (deps) => { scannedSweeps, faults }  (default: runSelfRepairScan)
//   attemptRepair : async (fault, deps) => { outcome, ... }    (default: actuator.attemptRepair)
//   escalate      : async (fault, evidence, deps) => {...}     (default: actuator.escalate)
//   now           : () => ms                                    (default: Date.now)
//   log           : (msg) => void                               (default: console.log)
//   readFile / writeFile / appendFile : injected fs (default: node:fs/promises)
//   stateFile / evidenceLogFile : paths (default: STATE_FILE / EVIDENCE_LOG_FILE)
//
// Returns one of:
//   { skipped: true }                                    — inside the scan cooldown
//   { skipped: false, scannedSweeps, faults, outcomes, attemptsMade } — ran
// Always resolves; never throws.
// =====================================================================
export async function runSelfRepairOnce(deps = {}) {
  const {
    scan = runSelfRepairScan,
    attemptRepair = actuator.attemptRepair,
    escalate = actuator.escalate,
    now = Date.now,
    log = (m) => console.log(m),
    readFile = fs.readFile,
    writeFile = fs.writeFile,
    stateFile = STATE_FILE,
    evidenceLogFile = EVIDENCE_LOG_FILE,
  } = deps;

  const nowMs = now();

  // 1. Cooldown gate: read the state file. If the last attempt-scan ran less
  //    than SCAN_MIN_INTERVAL_MS ago, skip the whole sweep — no scan, no
  //    dispatch — and tell the operator when the next run is eligible.
  let state = {};
  try {
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    state = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    state = {};
  }

  const lastScanMs = Number.isFinite(state && state.lastScanMs) ? state.lastScanMs : null;
  if (lastScanMs !== null && nowMs - lastScanMs < SCAN_MIN_INTERVAL_MS) {
    const nextIso = new Date(lastScanMs + SCAN_MIN_INTERVAL_MS).toISOString();
    try { log(`self-repair: skipped (next run after ${nextIso})`); } catch { /* observational */ }
    return { skipped: true };
  }

  // 2. Run the detector scan. A throwing scan is caught so the sweep still
  //    records lastScanMs and resolves; it never propagates.
  let scanResult;
  try {
    scanResult = await scan(deps);
  } catch (err) {
    try { log(`self-repair: scan threw — ${err && err.message ? err.message : String(err)}`); } catch { /* observational */ }
    scanResult = { scannedSweeps: 0, faults: [] };
  }

  // 3. Record lastScanMs so the cooldown gate can fire on the next invocation.
  //    This is independent of whether the scan found anything.
  const nextState = { ...(state && typeof state === "object" ? state : {}), lastScanMs: nowMs };
  try {
    await writeFile(stateFile, JSON.stringify(nextState, null, 2) + "\n", "utf8");
  } catch {
    // Bookkeeping is best-effort; the sweep still proceeds with what it has.
  }

  const faults = scanResult && Array.isArray(scanResult.faults) ? scanResult.faults : [];

  // 4. For at most MAX_REPAIRS_PER_SWEEP repairable faults, delegate to the
  //    actuator's attemptRepair. Faults the detector already blocked
  //    (envelope / cooldown / lane-quota) are repairable:false and are never
  //    handed to attemptRepair — they are logged and left for the next sweep.
  const outcomes = [];
  let attemptsMade = 0;
  for (const fault of faults) {
    if (!fault || fault.repairable !== true) {
      const blockedBy = (fault && fault.blockedBy) || "none";
      try { log(`self-repair: skipping ${fault ? fault.name : "unknown"} (blockedBy=${blockedBy})`); } catch { /* observational */ }
      continue;
    }
    if (attemptsMade >= MAX_REPAIRS_PER_SWEEP) {
      try { log(`self-repair: repairable fault ${fault.name} deferred (per-sweep cap ${MAX_REPAIRS_PER_SWEEP} reached)`); } catch { /* observational */ }
      continue;
    }
    attemptsMade += 1;

    let result;
    try {
      result = await attemptRepair(fault, deps);
    } catch (err) {
      // attemptRepair must never throw out of the sweep. Log and move on.
      try { log(`self-repair: attemptRepair threw for ${fault.name} — ${err && err.message ? err.message : String(err)}`); } catch { /* observational */ }
      outcomes.push({ name: fault.name, outcome: "error", error: String((err && err.message) || err) });
      continue;
    }

    const outcome = result && result.outcome ? result.outcome : "unknown";
    outcomes.push({ name: fault.name, outcome, result });

    if (outcome === "reverted") {
      // The system tried and could not fix itself — escalate so the owner
      // learns. escalate has its own 24h per-step cooldown, so this is safe to
      // call every sweep. A throwing escalate is caught, never propagated.
      try {
        await escalate(fault, outcomes, deps);
      } catch (err) {
        try { log(`self-repair: escalate threw for ${fault.name} — ${err && err.message ? err.message : String(err)}`); } catch { /* observational */ }
      }
    } else if (outcome === "repaired") {
      // A successful repair does NOT alert the owner. It appends one evidence
      // entry and logs a single line so the sweep is auditable.
      try { log(`self-repair: repaired ${fault.name}${result && result.suite ? " (" + result.suite + ")" : ""}`); } catch { /* observational */ }
      try {
        await appendEvidence({ type: "repair-success", name: fault.name, ...(result || {}) }, { ...deps, file: evidenceLogFile, now });
      } catch {
        // Evidence is best-effort.
      }
    }
  }

  return {
    skipped: false,
    scannedSweeps: scanResult && Number.isFinite(scanResult.scannedSweeps) ? scanResult.scannedSweeps : 0,
    faults,
    outcomes,
    attemptsMade,
  };
}

function usage() {
  return "usage: node ops-watcher/self-repair.mjs --scan | --once";
}

function printSummary(result) {
  console.log(`self-repair scan: scanned=${result.scannedSweeps} faults=${result.faults.length}`);
  for (const fault of result.faults) {
    console.log(`  [${fault.name}] ${fault.kind} consecutive=${fault.consecutiveFailures} repairable=${fault.repairable} blockedBy=${fault.blockedBy || "none"} - ${fault.reason}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--scan") {
    const result = await runSelfRepairScan();
    printSummary(result);
    process.exit(0);
  }
  if (argv.length === 1 && argv[0] === "--once") {
    await runSelfRepairOnce();
    // Exit code is 0 unless the module itself crashed (caught above). A skipped
    // or all-skipped sweep is still a successful bounded step.
    process.exit(0);
  }
  console.error(usage());
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
    console.error("self-repair scan fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}