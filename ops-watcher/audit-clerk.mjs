// ops-watcher/audit-clerk.mjs
// Read-only registry/ledger drift detector for FounderOS-Aidit.
//
//   node ops-watcher/audit-clerk.mjs --once
//
// AUDIT-CLERK has two independent checks:
//   1. orphaned allowlist entries in ahmad-mcp-server.mjs's ALLOWED_SCRIPTS
//   2. CORLEONE-dispatched fuzzy consistency comparison between
//      agent-registry.json and CANONICAL-ROLE-MAP.json. The kimi
//      (dispatchKimiReal) and legacy hermes (dispatchHermesReal) dispatchers
//      remain available as explicit alternate lanes.
//
// The orphaned-allowlist check is local and instant and runs EVERY cycle. The
// LLM-dispatched registry-drift check is throttled to at most once per
// DRIFT_MIN_INTERVAL_MS (6h) because its own canonical role-map trigger is
// "weekly cron / ledger write" and a per-5-minute CORLEONE dispatch was burning
// a paid lane's rate budget. Before dispatching, the lane guard is consulted;
// if the lane is unhealthy the dispatch is skipped entirely (the interval is
// NOT restarted because the lane was never called).
//
// ALERTING: any current finding can alert AHMAD, but the state file
// (audit-clerk-state.json) suppresses repeat alerts for the same key/detail for
// 24 hours. Alertable findings are bundled into one ahmad-notify spawn.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ALLOWED_SCRIPTS } from "./ahmad-mcp-server.mjs";
import { guardLaneStart, isUnusableModelOutput } from "./lane-guard.mjs";
import { deliverAlert } from "./alert-delivery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(__dirname, "audit-clerk-state.json");
const NODE = process.execPath || "node";

// The --in workspace handed to the hermes CLI. DERIVED from REPO_ROOT (declared
// above from this module's own location), never hardcoded: an absolute path here
// pointed the lane at a directory that does not exist once the checkout moves.
const HERMES_WORKSPACE = REPO_ROOT;
const HERMES_PROVIDER = "nous";
const HERMES_MODEL = "upstage/solar-pro4:free";
const HERMES_TIMEOUT_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// kimi (SJAHRIR) lane. `kimi` resolves to a real native kimi.exe on this
// machine (see the comment block in ops-watcher/sjahrir-dispatch.mjs), so we
// spawn it directly with shell:false — shell:true would word-split the
// free-form prompt across spaces/quotes and break `kimi -p`.
export const KIMI_TIMEOUT_MS = 10 * 60 * 1000;
export const CORLEONE_TIMEOUT_MS = 10 * 60 * 1000;

// Minimum interval between LLM-dispatched registry-drift checks. The
// orphaned-allowlist check is NOT affected by this and still runs every cycle.
// 6h bounds a paid CORLEONE lane to at most ~4 dispatches/day instead of ~288.
export const DRIFT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const REGISTRY_REL = "config/agent-registry.json";
const ROLE_MAP_REL = "handoffs/sjahrir/CANONICAL-ROLE-MAP.json";

const iso = () => new Date().toISOString();

// Pure helper: should the LLM-dispatched registry-drift check run now?
// Returns true when there is no recorded lastAttemptMs, or
// nowMs - lastAttemptMs >= minIntervalMs. A malformed/missing state object is
// treated as "should run" (never block a first/repair attempt on bad state).
export function shouldRunDriftCheck(state, nowMs, minIntervalMs = DRIFT_MIN_INTERVAL_MS) {
  try {
    if (!state || typeof state !== "object") return true;
    const dc = state.driftCheck;
    if (!dc || typeof dc !== "object") return true;
    const last = dc.lastAttemptMs;
    if (typeof last !== "number" || !Number.isFinite(last)) return true;
    return nowMs - last >= minIntervalMs;
  } catch {
    return true;
  }
}

async function defaultReadAllowedScripts() {
  return ALLOWED_SCRIPTS.slice();
}

async function defaultStatFile(repoRoot, relPath) {
  const st = await fs.stat(path.resolve(repoRoot, relPath));
  return st;
}

async function defaultReadFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function defaultReadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.alerts
      ? parsed
      : { alerts: {} };
  } catch {
    return { alerts: {} };
  }
}

async function defaultWriteState(stateFile, state) {
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // crash-proof: never throw on state write failure
  }
}

// ---- Hermes dispatch (real, LEGACY). Returns { ok, stdout, stderr, timedOut, error }. ----
// Mirrors review-runner.mjs/escalation-sec.mjs:
// hermes -z <prompt> --provider nous -m upstage/solar-pro4:free --in <workspace>
// Retained for backward compatibility and as an explicit alternate lane.
// Do NOT delete this.
export function dispatchHermesReal(prompt, { timeoutMs = HERMES_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const candidates = process.platform === "win32" ? ["hermes", "hermes.cmd"] : ["hermes"];
    let child = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const tryLaunch = (idx) => {
      if (idx >= candidates.length) {
        finish({ ok: false, stdout, stderr: stderr + `\nhermes executable not found (tried ${candidates.join(", ")})`, timedOut, error: "enoent" });
        return;
      }
      const exe = candidates[idx];
      try {
        child = spawn(exe, ["-z", prompt, "--provider", HERMES_PROVIDER, "-m", HERMES_MODEL, "--in", HERMES_WORKSPACE], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (err) {
        stderr += `\nspawn(${exe}) threw: ${err && err.message}`;
        tryLaunch(idx + 1);
        return;
      }
      let fallingBack = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (err) => {
        clearTimeout(timer);
        if (err && err.code === "ENOENT" && idx + 1 < candidates.length) {
          fallingBack = true;
          stderr += `\nspawn(${exe}) error: ${err.message}`;
          tryLaunch(idx + 1);
          return;
        }
        finish({ ok: false, stdout, stderr: stderr + String(err && err.message), timedOut, error: String((err && err.code) || (err && err.message)) });
      });
      child.on("close", (code) => {
        if (fallingBack) return;
        clearTimeout(timer);
        finish({ ok: code === 0 && !timedOut, stdout, stderr, timedOut, error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}` });
      });
    };
    tryLaunch(0);
  });
}

// ---- kimi (SJAHRIR) dispatch (real). Returns { ok, stdout, stderr, timedOut, error }. ----
// Mirrors dispatchHermesReal's structure and never-throw discipline:
//   kimi -p "<prompt>"   (cwd = repo root)
// `kimi` resolves to a real native .exe on this machine, so shell:false passes
// the args array verbatim via CreateProcess (no cmd.exe word-splitting).
export function dispatchKimiReal(prompt, { timeoutMs = KIMI_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      child = spawn("kimi", ["-p", prompt], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      finish({
        ok: false,
        stdout,
        stderr: stderr + `\nkimi spawn threw: ${err && err.message}`,
        timedOut,
        error: String((err && err.code) || (err && err.message)),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        stdout,
        stderr: stderr + String(err && err.message),
        timedOut,
        error: String((err && err.code) || (err && err.message)),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 && !timedOut,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}`,
      });
    });
  });
}

// ---- CORLEONE dispatch (real). Returns { ok, stdout, stderr, timedOut, error }. ----
// Node wrapper around codex; spawn NODE directly with shell:false so the
// free-form prompt remains one argv element.
export function dispatchCorleoneReal(prompt, { timeoutMs = CORLEONE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      child = spawn(NODE, ["ops-watcher/corleone-dispatch.mjs", prompt], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      finish({
        ok: false,
        stdout,
        stderr: stderr + `\ncorleone spawn threw: ${err && err.message}`,
        timedOut,
        error: String((err && err.code) || (err && err.message)),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        stdout,
        stderr: stderr + String(err && err.message),
        timedOut,
        error: String((err && err.code) || (err && err.message)),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 && !timedOut,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}`,
      });
    });
  });
}

export function spawnAlertReal(message) {
  const child = spawn(
    NODE,
    ["ops-watcher/ahmad-notify.mjs", message],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return { pid: child.pid };
}

export function buildRegistryDriftPrompt(registryRelPath, roleMapRelPath) {
  return [
    "You are AUDIT-CLERK, a read-only drift-detection worker for FounderOS-Aidit.",
    "You are running with --in pointed at the FounderOS-Aidit repository root.",
    "Read these two canonical documents yourself by relative path:",
    `- ${registryRelPath}`,
    `- ${roleMapRelPath}`,
    "Both documents describe the SAME set of agent roles/runtime lanes (HATTA, SJAHRIR, CORLEONE, GIBRAN, AHMAD, STEWARD, etc.).",
    "Find factual inconsistencies BETWEEN the two documents about the SAME role/lane - for example, one document says a lane is 'resting'/'dormant'/'not built yet' while the other says it is actively wired, tested, or has completed real work.",
    "List each inconsistency you find as a short bullet point naming the role/lane and quoting or paraphrasing the conflicting claims from each document.",
    "Report at most 10 inconsistencies, one bullet each, and keep every bullet under 30 words. Do not restate the documents.",
    "Disambiguation: the documents can describe two different kinds of object, and a claim about one is NOT a conflict with a claim about the other.",
    "- Paperclip agent record: a row inside the Paperclip app, with an adapterType, which Paperclip's engine may or may not invoke.",
    "- ops-watcher runtime lane / heartbeat step: a real .mjs script under ops-watcher/ executed by the PM2 heartbeat daemon.",
    "Specifically, agent-registry.json saying the 11 hermes_generic Paperclip agent records are inert/uninvokable is NOT in conflict with CANONICAL-ROLE-MAP.json saying same-named ops-watcher steps are KEEP/running/paused. Do not report that pairing.",
    "Only report a conflict when both documents make claims about the SAME object of the SAME kind, such as the same runtime lane's model/provider or built/not-built status, or the same Paperclip record's state, and those claims cannot both be true.",
    "If unsure which kind of object a statement is about, do NOT report it.",
    "If you find no inconsistencies, output ONLY this exact text with no trailing period or other punctuation: NO INCONSISTENCIES FOUND",
    "Output ONLY the findings list (or that exact phrase), no other commentary.",
  ].join("\n");
}

// Canonical definition of "unusable model output": lane-guard.mjs#isUnusableModelOutput.
// Thin wrapper: delegates the empty + truncation checks to the shared helper and
// maps its reasons onto the Indonesian strings this helper has always returned.
// classifyDriftOutput deliberately has NO quota/auth gate and uses a bullet-aware
// 40-char "tidak dikenali" threshold instead of the shared helper's 20-char
// "output too short" one, so those branches stay local.
export function classifyDriftOutput(stdout) {
  const text = String(stdout || "").trim();
  const shared = isUnusableModelOutput(text);
  if (shared.unusable) {
    if (shared.reason === "empty output") return { usable: false, reason: "output kosong" };
    if (shared.reason === "output truncated") return { usable: false, reason: "output terpotong" };
    // "lane quota/auth error" / "output too short": not this helper's policy —
    // fall through to the local bullet-aware length check below.
  }
  const hasBulletLikeLine = /^\s*(?:[-*•]|\d+[.)])(?:\s|$)/m.test(text);
  if (!hasBulletLikeLine && text.length < 40) {
    return { usable: false, reason: "output tidak dikenali" };
  }
  return { usable: true };
}

// Extract the usable drift answer from a kimi (SJAHRIR) stdout blob. kimi may
// print deliberation prose before the final bullets and appends a trailer line
// `To resume this session: kimi -r session_<id>`. This normalizes all of that
// away so the existing caller match and classifyDriftOutput keep working.
//
//   - Drop any trailing `To resume this session: kimi -r ...` line (and anything
//     after it).
//   - If any trimmed line matches the NO-INCONSISTENCIES phrase (case-insensitive,
//     optional trailing period), return exactly `NO INCONSISTENCIES FOUND`.
//   - Otherwise keep ONLY bullet lines (start with `-`, `*`, `•`, or a digit
//     followed by `.` or `)`), normalizing a leading `• - ` / `• ` / `* ` to
//     `- `. Join with `\n`.
//   - If no bullet lines survive, return the trimmed original text minus the
//     resume trailer (let classifyDriftOutput decide whether it is usable).
export function extractDriftAnswer(stdout) {
  let text = String(stdout || "");
  const resumeMarker = "To resume this session: kimi -r";
  const resumeIdx = text.indexOf(resumeMarker);
  if (resumeIdx >= 0) text = text.slice(0, resumeIdx);

  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    if (/^NO INCONSISTENCIES FOUND\.?$/i.test(raw.trim())) {
      return "NO INCONSISTENCIES FOUND";
    }
  }

  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^(?:[-*•]|\d+[.)])/.test(line)) continue;
    let m;
    if ((m = line.match(/^•\s*-\s+(.*)$/))) {
      kept.push(`- ${m[1].trim()}`);
    } else if ((m = line.match(/^•\s+(.*)$/))) {
      kept.push(`- ${m[1].trim()}`);
    } else if ((m = line.match(/^\*\s+(.*)$/))) {
      kept.push(`- ${m[1].trim()}`);
    } else {
      kept.push(line);
    }
  }
  if (kept.length > 0) return kept.join("\n");
  return text.trim();
}

function hermesFailureReason(h) {
  if (h && h.timedOut) return "timeout";
  if (h && h.error) return h.error;
  if (h && h.stderr && String(h.stderr).trim()) return String(h.stderr).trim().slice(0, 400);
  return "failed";
}

export function isQuotaExhaustedFailure(h) {
  const combined = `${h && h.stdout || ""}\n${h && h.stderr || ""}`;
  return /usage limit|quota|auth_error|insufficient_quota|rate limit exceeded/i.test(combined);
}

async function checkOrphanedAllowlist({ repoRoot, readAllowedScripts, statFile }) {
  const scripts = await readAllowedScripts();
  const findings = [];
  for (const relPath of Array.isArray(scripts) ? scripts : []) {
    try {
      const st = await statFile(repoRoot, relPath);
      if (st && typeof st.isFile === "function" && !st.isFile()) {
        findings.push({
          key: `orphaned-allowlist:${relPath}`,
          check: "orphaned-allowlist",
          severity: "WARNING",
          detail: `Entri ALLOWED_SCRIPTS tidak mengarah ke file yang ada di disk: ${relPath}`,
        });
      }
    } catch {
      findings.push({
        key: `orphaned-allowlist:${relPath}`,
        check: "orphaned-allowlist",
        severity: "WARNING",
        detail: `Entri ALLOWED_SCRIPTS tidak ada di disk: ${relPath}`,
      });
    }
  }
  return findings;
}

async function checkRegistryDrift({ dispatchDrift }) {
  try {
    const prompt = buildRegistryDriftPrompt(REGISTRY_REL, ROLE_MAP_REL);
    const h = await dispatchDrift(prompt);
    if (h && h.ok) {
      const extracted = extractDriftAnswer(h.stdout);
      if (extracted === "NO INCONSISTENCIES FOUND") {
        return [];
      }
      const classified = classifyDriftOutput(extracted);
      if (!classified.usable) {
        return [{
          key: "registry-drift-check-failed",
          check: "registry-drift",
          severity: "WARNING",
          detail: `AUDIT-CLERK tidak bisa menjalankan pemeriksaan konsistensi registry-drift pada sweep ini (hermes ${classified.reason}) - akan dicoba lagi pada sweep berikutnya.`,
        }];
      }
      return [{
        key: "registry-drift",
        check: "registry-drift",
        severity: "WARNING",
        detail: extracted,
      }];
    }
    if (isQuotaExhaustedFailure(h)) {
      return [{
        key: "registry-drift-quota",
        check: "registry-drift",
        severity: "WARNING",
        detail: "AUDIT-CLERK tidak bisa menjalankan pemeriksaan registry-drift: kuota lane eksekutor habis - pemeriksaan dilewati sampai kuota pulih (tidak ada fallback otomatis ke reasoner yang lebih lemah).",
      }];
    }
    return [{
      key: "registry-drift-check-failed",
      check: "registry-drift",
      severity: "WARNING",
      detail: `AUDIT-CLERK tidak bisa menjalankan pemeriksaan konsistensi registry-drift pada sweep ini (hermes ${hermesFailureReason(h)}) - akan dicoba lagi pada sweep berikutnya.`,
    }];
  } catch (err) {
    return [{
      key: "registry-drift-check-failed",
      check: "registry-drift",
      severity: "WARNING",
      detail: `AUDIT-CLERK tidak bisa menjalankan pemeriksaan konsistensi registry-drift pada sweep ini (hermes ${err && err.message || err}) - akan dicoba lagi pada sweep berikutnya.`,
    }];
  }
}

function toMillis(now) {
  const v = typeof now === "function" ? now() : now;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

function buildAlertMessage(findings) {
  const lines = [];
  lines.push("Peringatan drift registry/ledger AUDIT-CLERK");
  lines.push("");
  lines.push(`Temuan (${findings.length}):`);
  for (let i = 0; i < findings.length; i++) {
    lines.push(`  ${i + 1}. [${findings[i].severity}] [${findings[i].key}] ${findings[i].detail}`);
  }
  return lines.join("\n");
}

// Core, dependency-injected for tests. deps: { repoRoot, readAllowedScripts,
// statFile, readFile, dispatchDrift, dispatchHermes (legacy), readState,
// writeState, stateFile, postAlert, log, now, guardLane, driftMinIntervalMs }
//
// The drift dispatcher is selected as: deps.dispatchDrift if
// provided, else deps.dispatchHermes (legacy hermes lane) if provided, else the
// real dispatchCorleoneReal. This keeps older callers/tests that inject
// `dispatchHermes` working without silently spawning a real process, while new
// callers default to the CORLEONE lane.
//
// The LLM-dispatched registry-drift check is throttled by
// DRIFT_MIN_INTERVAL_MS via shouldRunDriftCheck and gated by the lane guard
// (deps.guardLane, defaulting to guardLaneStart("corleone")). The
// orphaned-allowlist check always runs every cycle. When the drift check is
// actually dispatched, driftCheck.lastAttemptMs is recorded in the state file
// (whether the check succeeded, failed, or hit a quota) so the paid lane is
// never called more than once per interval. When the check is skipped due to
// the interval OR an unhealthy lane, lastAttemptMs is NOT updated (the lane
// was never called, so the interval should not restart).
export async function runAuditClerkOnce(deps = {}) {
  const {
    repoRoot = REPO_ROOT,
    readAllowedScripts = defaultReadAllowedScripts,
    statFile = defaultStatFile,
    readFile = defaultReadFile,
    dispatchDrift,
    dispatchHermes,
    stateFile = STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
    postAlert = spawnAlertReal,
    log = (m) => console.log(m),
    now = Date.now,
    guardLane = guardLaneStart,
    driftMinIntervalMs = DRIFT_MIN_INTERVAL_MS,
  } = deps;

  const driftDispatcher = dispatchDrift || dispatchHermes || dispatchCorleoneReal;
  const nowMs = toMillis(now);

  // Read state up front so we can decide whether to dispatch the (paid,
  // throttled) drift check at all. The orphaned-allowlist check below stays
  // local and runs every cycle regardless of this decision.
  let state;
  try {
    state = await readState(stateFile);
  } catch {
    state = { alerts: {} };
  }
  if (!state || typeof state !== "object") state = { alerts: {} };
  if (!state.alerts || typeof state.alerts !== "object") state.alerts = {};
  const alerts = state.alerts;
  const existingDriftCheck =
    state.driftCheck && typeof state.driftCheck === "object" ? state.driftCheck : {};
  // driftCheck that will be persisted. Defaults to the existing entry; only
  // updated with a fresh lastAttemptMs when the lane is actually dispatched.
  let driftCheck = existingDriftCheck;

  const findings = [];

  try {
    findings.push(...await checkOrphanedAllowlist({ repoRoot, readAllowedScripts, statFile }));
  } catch (err) {
    findings.push({
      key: "orphaned-allowlist-check-failed",
      check: "orphaned-allowlist",
      severity: "WARNING",
      detail: `AUDIT-CLERK tidak bisa menjalankan pemeriksaan orphaned-allowlist pada sweep ini (${err && err.message || err}) - akan dicoba lagi pada sweep berikutnya.`,
    });
  }

  // ---- registry-drift: throttle + lane guard ----
  if (!shouldRunDriftCheck(state, nowMs, driftMinIntervalMs)) {
    const lastAttemptMs =
      typeof existingDriftCheck.lastAttemptMs === "number" ? existingDriftCheck.lastAttemptMs : 0;
    const nextMs = lastAttemptMs + driftMinIntervalMs;
    log(`audit-clerk: registry-drift check skipped (next run after ${new Date(nextMs).toISOString()})`);
  } else {
    // Consult the lane guard before spending a paid dispatch. A guard error is
    // treated as "no skip" so a guard hiccup never silently drops the check.
    let guard;
    try {
      guard = await guardLane("corleone");
    } catch {
      guard = { skip: false, reason: null, remainingMs: 0 };
    }
    if (guard && guard.skip) {
      if (guard.reason === "quota") {
        findings.push({
          key: "registry-drift-quota",
          check: "registry-drift",
          severity: "WARNING",
          detail: "AUDIT-CLERK tidak bisa menjalankan pemeriksaan registry-drift: kuota lane eksekutor habis - pemeriksaan dilewati sampai kuota pulih (tidak ada fallback otomatis ke reasoner yang lebih lemah).",
        });
      }
      log(`audit-clerk: registry-drift check skipped (lane ${guard.reason})`);
      // The lane was never called -> do NOT restart the interval. driftCheck
      // stays as existingDriftCheck (lastAttemptMs unchanged).
    } else {
      try {
        findings.push(...await checkRegistryDrift({ dispatchDrift: driftDispatcher }));
      } catch (err) {
        findings.push({
          key: "registry-drift-check-failed",
          check: "registry-drift",
          severity: "WARNING",
          detail: `AUDIT-CLERK tidak bisa menjalankan pemeriksaan konsistensi registry-drift pada sweep ini (hermes ${err && err.message || err}) - akan dicoba lagi pada sweep berikutnya.`,
        });
      }
      // Record the attempt whether the check succeeded, failed, or hit a
      // quota: the point is to bound how often the paid lane is called.
      driftCheck = { ...existingDriftCheck, lastAttemptMs: nowMs };
    }
  }

  const toAlert = [];
  for (const f of findings) {
    const prev = alerts[f.key];
    if (!prev || prev.finding !== f.detail) {
      toAlert.push(f);
    } else if (nowMs - (prev.lastAlertedAt || 0) >= COOLDOWN_MS) {
      toAlert.push(f);
    }
  }

  // Alert first, then record what actually happened. The dedupe state used to
  // be written before the alert was attempted, marking every finding as
  // alerted at nowMs; a spawn that failed was logged as "not relayed" and then
  // suppressed for the whole COOLDOWN_MS, so the finding was never retried.
  let alerted = false;
  let notifyPid = null;
  if (toAlert.length > 0) {
    const delivery = await deliverAlert(() => postAlert(buildAlertMessage(toAlert)));
    alerted = delivery.delivered;
    notifyPid = delivery.pid ?? null;
    if (alerted) {
      log(`audit-clerk: spawned ahmad-notify (pid=${notifyPid}) with ${toAlert.length} finding(s)`);
    } else {
      log(`audit-clerk: ahmad-notify spawn FAILED (${delivery.reason}) - findings not relayed, cooldown not advanced`);
    }
  } else {
    log(findings.length > 0
      ? `audit-clerk: ${findings.length} finding(s) suppressed (within ${COOLDOWN_MS / 3600000}h re-alert cooldown)`
      : "audit-clerk: no findings - no alert spawned");
  }

  const newAlerts = {};
  for (const f of findings) {
    const prev = alerts[f.key];
    // Only a finding that actually went out advances its cooldown. One that
    // did not keeps its previous stamp, so the next sweep tries again.
    if (alerted && toAlert.includes(f)) {
      newAlerts[f.key] = { lastAlertedAt: nowMs, finding: f.detail };
    } else if (prev) {
      newAlerts[f.key] = prev;
    }
  }
  try {
    await writeState(stateFile, { alerts: newAlerts, driftCheck });
  } catch (err) {
    log(`audit-clerk: state write threw (${err && err.message}) - dedupe may repeat on next run`);
  }

  return {
    results: findings,
    alerted,
    notifyPid,
    suppressedCount: findings.length - toAlert.length,
  };
}

function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/audit-clerk.mjs --once");
    process.exit(2);
  }
  const r = await runAuditClerkOnce({ log: (m) => console.log(m) });
  console.log(`audit-clerk --once: findings=${r.results.length} alerted=${r.alerted} suppressed=${r.suppressedCount}`);
  for (const f of r.results) console.log(`  - [${f.severity}] ${f.key}: ${f.detail}`);
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
    console.error("audit-clerk fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}