// ops-watcher/pm2-supervisor.mjs
// Out-of-PM2 supervisor for FounderOS-Aidit (FOS-11).
//
// WHY: on 2026-09-01 the PM2 God daemon itself vanished between 12:53 and 13:05,
// taking heartbeat, paperclip and telegram-listener with it. Nothing noticed
// for twelve minutes because every watchdog in this system runs INSIDE PM2.
// This module is the last line of defence: it runs OUTSIDE PM2, polls the
// daemon, and (within strict cooldowns) runs `pm2 resurrect` + `pm2 save` and
// alerts the OWNER. It never starts individual apps and never touches the
// legacy Windows scheduled tasks — PM2 is the single source of truth for
// process supervision in this workspace, and the legacy per-app tasks are
// deliberately disabled.
//
//   node ops-watcher/pm2-supervisor.mjs --once     # bounded supervisor loop
//   node ops-watcher/pm2-supervisor.mjs --check     # read-only diagnose + print
//
// Everything is dependency-injected so the regression test exercises the full
// loop with NO real pm2, NO real network, NO real fs writes, NO real alerts.
//
// === THREE-STATE MODEL ===
//   reachable: true   — `pm2 jlist` parsed successfully; the process list is
//                        AUTHORITATIVE. (An empty array still counts: it means
//                        the daemon is up but manages zero processes, which
//                        diagnose flags as critical/all-missing and makes
//                        resurrect eligible.)
//   reachable: false  — the daemon ANSWERED that it is not running, or jlist
//                        returned a clean, recognized PM2 "daemon not running"
//                        signal. This IS evidence the daemon is down, so
//                        resurrect is safe.
//   unknown: true     — we could NOT get an authoritative answer: the pm2 entry
//                        could not be located/parsed, spawn returned ENOENT,
//                        the command timed out, or jlist output was unparseable
//                        / not an array. This is NOT evidence of anything.
//
//   *** Resurrect may ONLY run when reachable:true shows a required process
//       missing/not-online, OR reachable:false shows the daemon down. It must
//       NEVER run on an unknown state — never act on an unknown state. ***
//
// === Windows .cmd-shim handling (Defect 1) ===
// On this machine `pm2` on PATH resolves to a forwarder .cmd at
// C:\nvm4w\nodejs\pm2.cmd which points at C:\Users\ASUS\AppData\Roaming\npm\pm2.cmd,
// whose body references "%dp0%\node_modules\pm2\bin\pm2". The REAL Node entry
// point is C:\Users\ASUS\AppData\Roaming\npm\node_modules\pm2\bin\pm2.
// resolvePm2Entry locates that JS entry by, in order: the APPDATA path, then a
// PATH-dir node_modules/pm2/bin/pm2, then by following a pm2.cmd forwarder one
// level. Callers then spawn process.execPath (node) DIRECTLY on that .js with
// shell:false, windowsHide:true — never the .cmd shim, never shell:true.

import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverPaperclipPort } from "./watcher.mjs";
import { pauseBanner, readPause } from "./pause-gate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath || "node";

// The set of PM2-managed processes the supervisor watches for. The cockpit
// (the owner's only visual surface, served on :4200 over Tailscale) is watched
// here at process-level presence only — a dead cockpit reported as a healthy
// stack is exactly the failure this module exists to prevent. No port/HTTP
// health check is performed for the cockpit; that is a separate decision.
export const EXPECTED_PROCESSES = ["heartbeat", "paperclip", "telegram-listener", "cockpit"];
export const STATE_FILE = path.join(__dirname, "pm2-supervisor-state.json");
export const EVIDENCE_FILE = path.join(__dirname, "pm2-supervisor-log.jsonl");
export const RESURRECT_COOLDOWN_MS = 10 * 60 * 1000;   // do not thrash
export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;       // one owner alert per hour, max

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- resolvePm2Entry (Defect 1) ----
// Locate the real PM2 Node entry point and return { ok, entry }. Callers then
// spawn `process.execPath` with `[entry, ...subcommand]`, shell:false,
// windowsHide:true — bypassing the .cmd shim entirely.
//
// Tries, in this exact order, returning the FIRST path that exists:
//   1. env.APPDATA/npm/node_modules/pm2/bin/pm2      (when APPDATA is set)
//   2. <each PATH dir>/node_modules/pm2/bin/pm2
//   3. <each PATH dir>/pm2.cmd  — read its body; if it quotes another .cmd path
//      (a forwarder), read THAT file too (one level deep); then extract the
//      quoted path ending in node_modules\pm2\bin\pm2 and use it (resolving
//      %dp0% to the directory of the .cmd whose body we read).
//
// Returns:
//   { ok: true,  entry }   — spawn process.execPath with [entry, ...args].
//   { ok: false, error }   — nothing matched; never throws.
//
// Inject { platform, env, _fs } for tests. _fs must provide readFileSync and
// accessSync (node:fs sync API). Pure apart from the injected _fs checks.
export function resolvePm2Entry({ platform = process.platform, env = process.env, _fs } = {}) {
  const f = _fs || fsSync;
  const e = env != null ? env : process.env;
  const tried = [];

  const exists = (p) => {
    try { f.accessSync(p); return true; } catch { return false; }
  };
  const read = (p) => {
    try { return f.readFileSync(p, "utf8"); } catch { return null; }
  };

  // Step 1: env.APPDATA/npm/node_modules/pm2/bin/pm2
  if (e && e.APPDATA) {
    const p = path.join(e.APPDATA, "npm", "node_modules", "pm2", "bin", "pm2");
    tried.push(p);
    if (exists(p)) return { ok: true, entry: p };
  }

  // Step 2: each PATH dir / node_modules/pm2/bin/pm2
  const dirs = String((e && e.PATH) || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, "node_modules", "pm2", "bin", "pm2");
    tried.push(p);
    if (exists(p)) return { ok: true, entry: p };
  }

  // Step 3: each PATH dir / pm2.cmd — follow forwarder one level, extract entry
  for (const dir of dirs) {
    const cmdPath = path.join(dir, "pm2.cmd");
    if (!exists(cmdPath)) continue;
    const body = read(cmdPath);
    if (body == null) continue;
    // Try extracting the entry directly from this body.
    let entry = extractPm2EntryFromBody(body, dir);
    if (entry && exists(entry)) return { ok: true, entry };
    // If the body is a forwarder (quotes another .cmd path), follow ONE level.
    const target = findForwarderTarget(body);
    if (target) {
      const body2 = read(target);
      if (body2 != null) {
        // %dp0% in the real shim resolves to the directory of THAT shim file.
        entry = extractPm2EntryFromBody(body2, path.dirname(target));
        if (entry && exists(entry)) return { ok: true, entry };
      }
    }
  }

  return {
    ok: false,
    error: `pm2 entry not found (tried ${tried.length} candidates: ${tried.join("; ")})`,
  };
}

// Extract a quoted path ending in node_modules\pm2\bin\pm2 from a .cmd body,
// resolving %dp0% / %~dp0% to baseDir (the directory of the .cmd whose body this
// is). Returns the absolute path string or null.
function extractPm2EntryFromBody(body, baseDir) {
  if (!body) return null;
  const m = body.match(/"([^"]*node_modules[\\/]pm2[\\/]bin[\\/]pm2)"/i);
  if (!m) return null;
  let entry = m[1];
  // Resolve %dp0% / %~dp0% to the directory of the .cmd file we read this from.
  entry = entry.replace(/%[~]?dp0%/gi, baseDir);
  return entry;
}

// If a .cmd body quotes another .cmd path (a forwarder) that is NOT the pm2
// entry itself, return that quoted path so the caller can read it one level
// deep. Returns null otherwise.
function findForwarderTarget(body) {
  if (!body) return null;
  const m = body.match(/"([^"]*\.cmd)"/i);
  if (m && !/node_modules[\\/]pm2[\\/]bin/i.test(m[1])) return m[1];
  return null;
}

// default resolver: uses the real platform/env/fs. Used as the default inject
// in readPm2State / resurrect / runSupervisorOnce.
function defaultResolveEntry() {
  return resolvePm2Entry();
}

// ---- Injectable command runner (never throws) ----
// Runs an external command with shell:false, windowsHide:true and a bounded
// timeout. Resolves to { ok, stdout, stderr, error } — never rejects.
export function defaultRunCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = (opts && opts.timeoutMs) || 30000;
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    let child;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      finish({ ok: false, stdout: "", stderr: String(err && err.message), error: String((err && err.code) || (err && err.message)) });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGTERM"); } catch { /* ignore */ } }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr: stderr + String(err && err.message), error: String((err && err.code) || (err && err.message)) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0 && !timedOut, stdout, stderr, error: timedOut ? "timeout" : (code === 0 ? null : `exit_${code}`) });
    });
  });
}

// Recognize a clean PM2 "daemon not running" signal in jlist output/stderr.
// When the daemon is actually down, `pm2 jlist` prints a recognizable message
// (not random garbage) — that IS evidence the daemon is down, so we map it to
// reachable:false (resurrect-safe). Anything else unparseable -> unknown.
function isDaemonDownSignal(text) {
  const s = String(text || "");
  if (!s) return false;
  return /(could not connect|god daemon|daemon[^.]*not\s*(running|reachable|existing)|ECONNREFUSED|no daemon|pm2.*daemon.*(down|not))/i.test(s);
}

// ---- readPm2State ----
// Runs `pm2 jlist` through an injectable runCommand + resolveEntry and returns
// one of the three states (see header). Never throws.
//
//   { reachable: true,  processes: [{ name, status, pid, restarts }] }
//   { reachable: false, processes: [], error? }
//   { unknown: true,    processes: [], error?, resolveError? }
//
// NOTE: `pm2 jlist` on this machine contains duplicate keys differing only in
// case, so we parse with plain JSON.parse (which keeps both as distinct props)
// and read fields defensively — NEVER a case-insensitive object merge.
export async function readPm2State(deps = {}) {
  const {
    runCommand = defaultRunCommand,
    resolveEntry = defaultResolveEntry,
  } = deps;

  // Step 1: resolve the pm2 entry. Failure here is UNKNOWN, not "dead".
  let resolved;
  try {
    resolved = resolveEntry();
  } catch (err) {
    return { unknown: true, processes: [], resolveError: String((err && err.message) || err) };
  }
  if (!resolved || !resolved.ok) {
    return {
      unknown: true,
      processes: [],
      resolveError: (resolved && resolved.error) || "resolvePm2Entry failed",
    };
  }
  // Callers spawn process.execPath with [entry, ...args], shell:false,
  // windowsHide:true.
  const cmd = NODE;
  const entryArg = resolved.entry;

  // Step 2: run `pm2 jlist` via the resolved entry.
  let r;
  try {
    r = await runCommand(cmd, [entryArg, "jlist"], { timeoutMs: 30000 });
  } catch (err) {
    return { unknown: true, processes: [], error: String((err && err.message) || err) };
  }

  if (!r) {
    return { unknown: true, processes: [], error: "runCommand returned no result" };
  }

  const errStr = String((r.error != null ? r.error : "") || (r.stderr && String(r.stderr).trim()) || "");
  const stdout = String((r && r.stdout) || "").trim();

  // spawn-level failure (ENOENT / timeout) -> we could not ASK -> unknown.
  if (!r.ok) {
    if (errStr === "timeout" || /timeout/i.test(errStr)) {
      return { unknown: true, processes: [], error: errStr || "timeout" };
    }
    if (/ENOENT/i.test(errStr)) {
      return { unknown: true, processes: [], error: errStr || "ENOENT" };
    }
    // The command failed but produced a recognized PM2 "daemon down" message ->
    // the daemon ANSWERED that it is not running -> reachable:false (resurrect-safe).
    const combined = stdout + "\n" + String((r && r.stderr) || "");
    if (isDaemonDownSignal(combined)) {
      return { reachable: false, processes: [], error: errStr || "pm2 daemon down" };
    }
    // Any other failure: we could not get an authoritative answer -> unknown.
    return { unknown: true, processes: [], error: errStr || "pm2 jlist failed" };
  }

  // Step 3: parse jlist stdout.
  if (!stdout) {
    // ok:true but empty stdout — not an authoritative answer. Treat as unknown
    // (a healthy daemon returns at least `[]`).
    return { unknown: true, processes: [], error: "pm2 jlist returned empty output" };
  }
  let arr;
  try {
    arr = JSON.parse(stdout);
  } catch (err) {
    // Unparseable output. If it is a recognized daemon-down message, that is a
    // clean "daemon not running" signal -> reachable:false. Otherwise unknown.
    if (isDaemonDownSignal(stdout)) {
      return { reachable: false, processes: [], error: `jlist daemon-down: ${(err && err.message) || err}` };
    }
    return { unknown: true, processes: [], error: `jlist parse failed: ${(err && err.message) || err}` };
  }
  if (!Array.isArray(arr)) {
    // Daemon answered but with an unexpected shape — not authoritative.
    return { unknown: true, processes: [], error: "jlist output is not an array" };
  }

  const processes = arr.map((p) => {
    if (!p || typeof p !== "object") return { name: null, status: null, pid: null, restarts: 0 };
    const name = p.name != null ? p.name : (p.Name != null ? p.Name : (p.NAME != null ? p.NAME : null));
    const env = (p.pm2_env && typeof p.pm2_env === "object") ? p.pm2_env : {};
    const status = env.status != null ? env.status
      : (p.status != null ? p.status
        : (env.Status != null ? env.Status : null));
    const pid = p.pid != null ? p.pid : (p.PID != null ? p.PID : null);
    let restarts = env.restart_time != null ? env.restart_time
      : (p.restart_time != null ? p.restart_time
        : (env.unstable_restarts != null ? env.unstable_restarts : 0));
    restarts = typeof restarts === "number" ? restarts : (Number(restarts) || 0);
    return { name, status, pid, restarts };
  });
  return { reachable: true, processes };
}

// ---- diagnose (PURE) ----
// Returns { healthy, severity, missing, notOnline, reasons }.
//   unknown:  pm2State is unknown — we could not ask the daemon. NEVER act.
//   critical: daemon answered down (reachable:false) OR any expected process
//             missing / not online (reachable:true). Resurrect is eligible.
//   warning:  everything online but paperclipPort is null (app up, not serving)
//   healthy:  severity:null, healthy:true otherwise
// reasons is a short array of human strings in Bahasa Indonesia.
export function diagnose(pm2State, paperclipPort, { expected = EXPECTED_PROCESSES } = {}) {
  const reasons = [];

  // ---- unknown: could not get an authoritative answer -> NEVER act ----
  if (!pm2State || pm2State.unknown) {
    return {
      healthy: false, severity: "unknown",
      missing: [], notOnline: [],
      reasons: ["Tidak bisa memastikan status PM2 (pm2 tidak dapat dijalankan dari sini) — tidak ada tindakan otomatis."],
    };
  }

  // ---- critical: daemon answered that it is not running ----
  if (!pm2State.reachable) {
    return {
      healthy: false, severity: "critical",
      missing: expected.slice(), notOnline: expected.slice(),
      reasons: ["Daemon PM2 tidak aktif (tidak berjalan) — seluruh proses (heartbeat, paperclip, telegram-listener, cockpit) perlu dipulihkan via `pm2 resurrect`."],
    };
  }

  // ---- reachable:true — the process list is authoritative ----
  const procs = Array.isArray(pm2State.processes) ? pm2State.processes : [];
  const byName = new Map();
  for (const p of procs) if (p && p.name != null) byName.set(p.name, p);
  const missing = [];
  const notOnline = [];
  for (const name of expected) {
    const p = byName.get(name);
    if (!p) {
      missing.push(name);
      reasons.push(`Proses "${name}" tidak ditemukan dalam daftar PM2.`);
      continue;
    }
    // Read status defensively: support both normalized ({status}) and raw jlist
    // ({pm2_env.status}) shapes, so diagnose is robust either way.
    let st = p.status;
    if (st == null && p.pm2_env && typeof p.pm2_env === "object") {
      st = p.pm2_env.status != null ? p.pm2_env.status : p.pm2_env.Status;
    }
    const stLow = String(st == null ? "" : st).toLowerCase();
    if (stLow !== "online") {
      notOnline.push(name);
      reasons.push(`Proses "${name}" berstatus "${st}" (bukan online).`);
    }
  }
  if (missing.length || notOnline.length) {
    return { healthy: false, severity: "critical", missing, notOnline, reasons };
  }
  if (paperclipPort == null) {
    reasons.push("Seluruh proses PM2 online, namun port kesehatan Paperclip tidak ditemukan — aplikasi tidak melayani permintaan.");
    return { healthy: false, severity: "warning", missing: [], notOnline: [], reasons };
  }
  return { healthy: true, severity: null, missing: [], notOnline: [], reasons: [] };
}

// ---- resurrect ----
// Runs `pm2 resurrect` then `pm2 save` through the injectable runCommand +
// resolveEntry and returns { ok, stdout, stderr, error }. Never throws. It
// NEVER starts the individual apps directly and NEVER touches the legacy
// Windows scheduled tasks — PM2 is the single source of truth for process
// supervision.
//
// SAFETY: resurrect may ONLY be called from runSupervisorOnce when the state
// is reachable:true (a required process missing/not-online) or reachable:false
// (daemon down). It must NEVER be called on an unknown state.
export async function resurrect(deps = {}) {
  const {
    runCommand = defaultRunCommand,
    resolveEntry = defaultResolveEntry,
  } = deps;
  const out = { ok: false, stdout: "", stderr: "", error: null };

  const resolved = resolveEntry();
  if (!resolved || !resolved.ok) {
    out.error = (resolved && resolved.error) || "resolvePm2Entry failed";
    out.stderr = out.error;
    return out;
  }
  const cmd = NODE;
  const entryArg = resolved.entry;

  let r1;
  try {
    r1 = await runCommand(cmd, [entryArg, "resurrect"], { timeoutMs: 60000 });
  } catch (err) {
    out.error = String((err && err.message) || err);
    out.stderr = out.error;
    return out;
  }
  let r2;
  try {
    r2 = await runCommand(cmd, [entryArg, "save"], { timeoutMs: 60000 });
  } catch (err) {
    out.stdout = (r1 && r1.stdout) || "";
    out.stderr = ((r1 && r1.stderr) || "") + "\n--- pm2 save ---\n" + String((err && err.message) || err);
    out.error = String((err && err.message) || err);
    return out;
  }
  out.ok = !!(r1 && r1.ok) && !!(r2 && r2.ok);
  out.stdout = ((r1 && r1.stdout) || "") + "\n--- pm2 save ---\n" + ((r2 && r2.stdout) || "");
  out.stderr = ((r1 && r1.stderr) || "") + "\n--- pm2 save ---\n" + ((r2 && r2.stderr) || "");
  out.error = (r1 && r1.error) || (r2 && r2.error) || null;
  return out;
}

// ---- alert message builders (Bahasa Indonesia) ----
function buildCriticalAlert(diag, resurrect) {
  const lines = [];
  lines.push("PERINGATAN KRITIS — Supervisor PM2 (FounderOS-Aidit)");
  lines.push("");
  lines.push("Daemon/proses PM2 tidak dapat dipulihkan secara otomatis setelah `pm2 resurrect`.");
  lines.push("Alasan diagnosa:");
  for (const r of (diag.reasons || [])) lines.push(`  - ${r}`);
  if (diag.missing && diag.missing.length) lines.push(`Proses hilang: ${diag.missing.join(", ")}`);
  if (diag.notOnline && diag.notOnline.length) lines.push(`Proses tidak online: ${diag.notOnline.join(", ")}`);
  lines.push("");
  lines.push("Tindakan manual diperlukan: jalankan `pm2 resurrect` lalu `pm2 save`, kemudian periksa ~/.pm2/pm2.log.");
  if (resurrect && resurrect.error) lines.push(`Hasil resurrect terakhir: ${resurrect.error}`);
  return lines.join("\n");
}

function buildWarningAlert(diag) {
  const lines = [];
  lines.push("PERINGATAN — Supervisor PM2 (FounderOS-Aidit)");
  lines.push("");
  lines.push("Seluruh proses PM2 online, namun Paperclip tidak melayani pada port yang diharapkan.");
  for (const r of (diag.reasons || [])) lines.push(`  - ${r}`);
  lines.push("");
  lines.push("Periksa proses paperclip dan konfigurasi port Paperclip (ops-watcher/watcher.mjs).");
  return lines.join("\n");
}

function buildUnknownAlert(diag) {
  const lines = [];
  lines.push("PERINGATAN — Supervisor PM2 (FounderOS-Aidit)");
  lines.push("");
  lines.push("Tidak bisa memastikan status PM2 (pm2 tidak dapat dijalankan dari sini) — tidak ada tindakan otomatis.");
  for (const r of (diag.reasons || [])) lines.push(`  - ${r}`);
  lines.push("");
  lines.push("Periksa instalasi pm2 / PATH dan jalankan `pm2 jlist` secara manual untuk memastikan.");
  return lines.join("\n");
}

// ---- default injected helpers (real fs / real spawn, but defensive) ----
async function defaultReadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}
async function defaultWriteState(state) {
  try { await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8"); } catch { /* never throw */ }
}
async function defaultAppendEvidence(line) {
  try { await fs.appendFile(EVIDENCE_FILE, line + "\n", "utf8"); } catch { /* never throw */ }
}
function defaultPostAlert(message) {
  try {
    const child = spawn(NODE, ["ops-watcher/ahmad-notify.mjs", message], {
      cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true,
    });
    child.unref();
    return { pid: child.pid };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}
async function defaultDiscoverPort() {
  try { return await discoverPaperclipPort(undefined, { attempts: 3, retryDelayMs: 1500 }); }
  catch { return null; }
}

// ---- runSupervisorOnce ----
// The whole bounded loop. Never throws. Always appends exactly one evidence
// line per run. deps: { runCommand, resolveEntry, discoverPort, readState,
// writeState, appendEvidence, postAlert, log, now, sleep }.
//
// SAFETY RULE (in plain words): resurrect may ONLY run when a successfully
// parsed jlist shows the daemon down (reachable:false) or a required process
// missing/not-online (reachable:true + missing/notOnline). On an unknown
// state we take NO recovery action, append one evidence line, and alert the
// owner at most once per ALERT_COOLDOWN_MS. NEVER act on an unknown state.
export async function runSupervisorOnce(deps = {}) {
  const {
    runCommand = defaultRunCommand,
    resolveEntry = defaultResolveEntry,
    discoverPort = defaultDiscoverPort,
    readState = defaultReadState,
    writeState = defaultWriteState,
    appendEvidence = defaultAppendEvidence,
    postAlert = defaultPostAlert,
    log = (m) => console.log(m),
    now = Date.now,
    sleep = defaultSleep,
    checkPause = readPause,
  } = deps;
  const nowMs = typeof now === "function" ? now() : now;

  // Emergency stop comes first. This module can `pm2 resurrect` and message the
  // OWNER, so while FounderOS is paused it must do neither — restarting the very
  // processes the owner just stopped would defeat the stop button. Fails closed:
  // readPause() already reports PAUSED when it cannot read the flag, and a throw
  // here is treated as paused too.
  let pauseState;
  try {
    pauseState = checkPause();
  } catch (err) {
    pauseState = { paused: true, reason: `pause state unreadable: ${(err && err.message) || err}` };
  }
  if (pauseState && pauseState.paused) {
    const banner = pauseBanner(pauseState) || "FounderOS PAUSED.";
    log(`pm2-supervisor: ${banner} — tidak resurrect, tidak alert.`);
    try {
      await appendEvidence(JSON.stringify({
        ts: nowMs,
        outcome: "paused",
        severity: "paused",
        reason: pauseState.reason || null,
      }));
    } catch { /* never throw */ }
    return { outcome: "paused", banner };
  }

  let state;
  try { state = await readState(); } catch { state = {}; }
  if (!state || typeof state !== "object") state = {};
  if (typeof state.lastResurrectAt !== "number") state.lastResurrectAt = 0;
  if (typeof state.lastAlertAt !== "number") state.lastAlertAt = 0;
  if (typeof state.warningStreak !== "number") state.warningStreak = 0;

  const writeEvidence = async (outcome, diag, extra = {}) => {
    const line = JSON.stringify({
      ts: nowMs, outcome, severity: diag.severity,
      missing: diag.missing, notOnline: diag.notOnline, reasons: diag.reasons,
      ...extra,
    });
    try { await appendEvidence(line); } catch { /* never throw */ }
  };

  const maybeAlert = async (message) => {
    if (nowMs - state.lastAlertAt < ALERT_COOLDOWN_MS) {
      return { alerted: false, reason: "alert-cooldown" };
    }
    try {
      await postAlert(message);
      state.lastAlertAt = nowMs;
      return { alerted: true };
    } catch (err) {
      return { alerted: false, reason: String((err && err.message) || err) }
    }
  };

  const assess = async () => {
    const pm2State = await readPm2State({ runCommand, resolveEntry });
    let port = null;
    try { port = await discoverPort(); } catch { port = null; }
    const diag = diagnose(pm2State, port);
    return { pm2State, port, diag };
  };

  try {
    const { diag } = await assess();

    // ---- healthy ----
    if (diag.healthy) {
      state.warningStreak = 0;
      await writeEvidence("healthy", diag);
      await writeState(state);
      log("pm2-supervisor: healthy");
      return { outcome: "healthy" };
    }

    // ---- unknown: NEVER act. One evidence line, at most one alert. ----
    // Resurrect must NEVER run on an unknown state.
    if (diag.severity === "unknown") {
      const res = await maybeAlert(buildUnknownAlert(diag));
      await writeEvidence("unknown", diag, { alerted: res.alerted });
      await writeState(state);
      log("pm2-supervisor: unknown PM2 state — no recovery action, owner alerted at most once per cooldown");
      return { outcome: "unknown", alerted: res.alerted };
    }

    // ---- critical: daemon down OR a required process missing/not online ----
    // This is the ONLY path that may resurrect, and only outside cooldown.
    if (diag.severity === "critical") {
      const eligible = (nowMs - state.lastResurrectAt) >= RESURRECT_COOLDOWN_MS;
      if (!eligible) {
        await writeEvidence("cooldown", diag, { lastResurrectAt: state.lastResurrectAt });
        await writeState(state);
        log("pm2-supervisor: critical but within resurrect cooldown — no action");
        return { outcome: "cooldown" };
      }
      const r = await resurrect({ runCommand, resolveEntry });
      await sleep(5000);
      const reassess = await assess();
      state.lastResurrectAt = nowMs;
      if (reassess.diag.healthy) {
        state.warningStreak = 0;
        await writeEvidence("recovered", reassess.diag, { resurrect: { ok: r.ok, error: r.error } });
        await writeState(state);
        log("pm2-supervisor: recovered after resurrect (no owner alert — self-healed)");
        return { outcome: "recovered" };
      }
      // still broken -> one owner alert
      await writeEvidence("unrecovered", reassess.diag, { resurrect: { ok: r.ok, error: r.error } });
      await maybeAlert(buildCriticalAlert(reassess.diag, r));
      await writeState(state);
      log("pm2-supervisor: unrecovered after resurrect — owner alerted");
      return { outcome: "unrecovered" };
    }

    // ---- warning: all online but Paperclip port not serving ----
    if (diag.severity === "warning") {
      state.warningStreak = (state.warningStreak || 0) + 1;
      let alerted = false;
      if (state.warningStreak >= 2) {
        const res = await maybeAlert(buildWarningAlert(diag));
        alerted = res.alerted;
      }
      await writeEvidence("warning", diag, { warningStreak: state.warningStreak, alerted });
      await writeState(state);
      log(`pm2-supervisor: warning (streak=${state.warningStreak})`);
      return { outcome: "warning", warningStreak: state.warningStreak, alerted };
    }

    // Should be unreachable (all severities handled above). Treat defensively
    // as unknown — never act.
    await writeEvidence("unknown", diag);
    await writeState(state);
    log("pm2-supervisor: unhandled severity — treated as unknown, no action");
    return { outcome: "unknown" };
  } catch (err) {
    const errDiag = { severity: "error", missing: [], notOnline: [], reasons: [String((err && err.message) || err)] };
    try { await writeEvidence("error", errDiag, { error: String((err && err.message) || err) }); } catch { /* ignore */ }
    try { await writeState(state); } catch { /* ignore */ }
    log(`pm2-supervisor: error — ${(err && err.message) || err}`);
    return { outcome: "error", error: String((err && err.message) || err) };
  }
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false, check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--check") out.check = true;
    else return null;
  }
  if (!(out.once || out.check)) return null;
  return out;
}

async function runCheck() {
  // Resolve the entry first so we can report it explicitly (transparency
  // for the Windows .cmd-shim situation).
  const resolved = defaultResolveEntry();
  const pm2State = await readPm2State();
  let port = null;
  try { port = await defaultDiscoverPort(); } catch { port = null; }
  const diag = diagnose(pm2State, port);
  const summary = {
    ts: new Date().toISOString(),
    pm2Resolved: resolved && resolved.ok ? {
      entry: resolved.entry || null,
    } : null,
    pm2ResolveError: resolved && !resolved.ok ? resolved.error : null,
    reachable: pm2State && pm2State.reachable === true ? true : (pm2State && pm2State.reachable === false ? false : undefined),
    unknown: !!(pm2State && pm2State.unknown),
    paperclipPort: port,
    healthy: diag.healthy,
    severity: diag.severity,
    missing: diag.missing,
    notOnline: diag.notOnline,
    reasons: diag.reasons,
    processes: (pm2State && pm2State.processes || []).map((p) => ({ name: p.name, status: p.status, pid: p.pid, restarts: p.restarts })),
  };
  console.log(JSON.stringify(summary, null, 2));
  return diag.healthy ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) {
    console.error("usage: node ops-watcher/pm2-supervisor.mjs --once | --check");
    process.exit(2);
  }
  if (args.check) {
    process.exit(await runCheck());
  }
  // --once
  const r = await runSupervisorOnce();
  console.log(`pm2-supervisor --once: outcome=${r.outcome}`);
  if (r.outcome === "unrecovered" || r.outcome === "error") process.exit(1);
  process.exit(0);
}

const isEntry = (() => {
  try { return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("pm2-supervisor fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}