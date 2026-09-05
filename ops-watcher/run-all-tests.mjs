// ops-watcher/run-all-tests.mjs
// Sequential regression-suite runner for ops-watcher.
//
//   node ops-watcher/run-all-tests.mjs
//   node ops-watcher/run-all-tests.mjs --json
//   node ops-watcher/run-all-tests.mjs --only <substring>

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SELF_TEST = "run-all-tests.regression.test.mjs";

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value) {
  if (typeof value === "string") return value;
  return new Date(toMs(value)).toISOString();
}

function cleanTail(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(-400);
}

function discoverSuiteNames(files, only) {
  const filtered = files
    .filter((name) => typeof name === "string" && name.endsWith(".test.mjs"))
    .filter((name) => name !== SELF_TEST)
    .filter((name) => !only || name.includes(only))
    .sort((a, b) => a.localeCompare(b));
  return filtered;
}

async function defaultListSuiteFiles() {
  return fs.readdir(__dirname);
}

function terminateTimedOutSuite(child, { platform = process.platform, spawnFn = spawn } = {}) {
  if (platform === "win32" && child && child.pid) {
    try {
      const killer = spawnFn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      if (killer && typeof killer.on === "function") killer.on("error", () => {});
      return;
    } catch {
      // Fall through to the ordinary kill attempt below.
    }
  }
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
}

async function defaultRunSuite(suite, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const suitePath = path.join(__dirname, suite);

  return new Promise((resolve) => {
    let combined = "";
    let timedOut = false;
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        suite,
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut,
        durationMs: Date.now() - started,
        tail: cleanTail(result.tail ?? combined),
      });
    };

    try {
      child = spawn(process.execPath, [suitePath], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      finish({
        ok: false,
        exitCode: null,
        tail: err && err.stack ? err.stack : String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateTimedOutSuite(child);
    }, timeoutMs);

    child.stdout.on("data", (d) => { combined += d.toString(); });
    child.stderr.on("data", (d) => { combined += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        exitCode: null,
        tail: err && err.stack ? err.stack : String(err),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 && !timedOut,
        exitCode: code,
        tail: combined,
      });
    });
  });
}

export function summarize(results) {
  const suites = Array.isArray(results) ? results : (results && Array.isArray(results.suites) ? results.suites : []);
  const startedAt = Array.isArray(results) ? null : (results.startedAt ?? null);
  const finishedAt = Array.isArray(results) ? null : (results.finishedAt ?? null);
  const total = suites.length;
  const passed = suites.filter((suite) => suite && suite.ok).length;
  const failed = total - passed;
  const failures = suites.filter((suite) => !suite.ok).map((suite) => suite.suite);
  const durationMs = Number.isFinite(results && results.durationMs)
    ? results.durationMs
    : (startedAt && finishedAt ? Math.max(0, toMs(finishedAt) - toMs(startedAt)) : suites.reduce((sum, suite) => sum + (Number(suite.durationMs) || 0), 0));

  return {
    startedAt,
    finishedAt,
    durationMs,
    total,
    passed,
    failed,
    failures,
    suites,
  };
}

export async function runAllTests(deps = {}) {
  const {
    listSuiteFiles = defaultListSuiteFiles,
    runSuite = defaultRunSuite,
    now = Date.now,
    log = () => {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    only,
  } = deps;

  const startedRaw = now();
  const startedAt = toIso(startedRaw);
  let names;

  try {
    names = discoverSuiteNames(await listSuiteFiles(), only);
  } catch (err) {
    const failedDiscovery = {
      suite: "<discovery>",
      ok: false,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      tail: cleanTail(err && err.stack ? err.stack : String(err)),
    };
    const finishedRaw = now();
    return summarize({ startedAt, finishedAt: toIso(finishedRaw), durationMs: Math.max(0, toMs(finishedRaw) - toMs(startedRaw)), suites: [failedDiscovery] });
  }

  const suites = [];
  for (const suite of names) {
    let result;
    const suiteStarted = now();
    try {
      result = await runSuite(suite, { timeoutMs });
    } catch (err) {
      const suiteFinished = now();
      result = {
        suite,
        ok: false,
        exitCode: null,
        timedOut: false,
        durationMs: Math.max(0, toMs(suiteFinished) - toMs(suiteStarted)),
        tail: cleanTail(err && err.stack ? err.stack : String(err)),
      };
    }

    result = {
      suite,
      ok: Boolean(result && result.ok),
      exitCode: result && Object.prototype.hasOwnProperty.call(result, "exitCode") ? result.exitCode : null,
      timedOut: Boolean(result && result.timedOut),
      durationMs: Math.max(0, Number(result && result.durationMs) || 0),
      tail: cleanTail(result && result.tail),
    };
    suites.push(result);
    if (log) log(`${result.ok ? "PASS" : "FAIL"} ${result.suite} ${result.durationMs}ms`);
  }

  const finishedRaw = now();
  return summarize({
    startedAt,
    finishedAt: toIso(finishedRaw),
    durationMs: Math.max(0, toMs(finishedRaw) - toMs(startedRaw)),
    suites,
  });
}

function parseArgs(argv) {
  const args = { json: false, only: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--json") {
      args.json = true;
    } else if (argv[i] === "--only") {
      args.only = argv[++i] || "";
    }
  }
  return args;
}

function exitCodeFor(results) {
  return results.failed === 0 ? 0 : 1;
}

// Node 26 on Windows crashes at process teardown (libuv UV_HANDLE_CLOSING)
// AFTER a suite's own tests have all passed, so this runner scores two green
// suites as failures. config/machine.json pins the Node that does not do this.
// Measured on this machine on 2026-09-05: system Node v26.5.0 -> 77/79, pinned
// Node v22.14.0 -> 80/80, same commit, same files.
//
// Only printed alongside a failure, and only when the running Node differs from
// the pinned one — a healthy run must not learn to carry a warning it can
// ignore. Never throws: an unreadable machine.json simply means no notice.
export function pinnedNodeNotice(deps = {}) {
  try {
    const readFile = deps.readFile || readFileSync;
    const machine = JSON.parse(readFile(path.join(ROOT, "config", "machine.json"), "utf8"));
    const pinned = machine && machine.node && machine.node.version;
    const bin = machine && machine.node && machine.node.bin;
    const running = (deps.version || process.version).replace(/^v/, "");
    if (!pinned || !bin || running === String(pinned)) return null;
    return `NOTE: this ran on Node v${running}, not the pinned v${pinned}. ` +
      `Node 26 on Windows crashes at teardown after tests pass, which this runner scores as a failed suite. ` +
      `Re-run with "${bin}" before treating a failure above as real.`;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const results = await runAllTests({
    only: args.only,
    log: args.json ? null : (line) => console.log(line),
  });

  if (args.json) {
    console.log(JSON.stringify(results));
  } else {
    console.log(`SUITES: ${results.passed}/${results.total} passed`);
    if (results.failed > 0) {
      console.log(`FAILURES: ${results.failures.join(", ")}`);
      const wrongNode = pinnedNodeNotice();
      if (wrongNode) console.log(wrongNode);
    }
  }
  process.exit(exitCodeFor(results));
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
    console.error("run-all-tests fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
