// ops-watcher/telegram-watchdog.mjs
// Windows-friendly supervisor for telegram-listener-daemon.mjs.
// It does not process Telegram updates itself. It only ensures exactly one
// listener daemon is running, and restarts it when the daemon lock is missing or
// stale after a hard kill that Task Scheduler may not notice.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DAEMON_SCRIPT = path.join(__dirname, "telegram-listener-daemon.mjs");
const DAEMON_LOCK_FILE = path.join(__dirname, "telegram-listener-daemon.lock");
const WATCHDOG_LOCK_FILE = path.join(__dirname, "telegram-watchdog.lock");
const DEFAULT_INTERVAL_MS = 10_000;

const iso = () => new Date().toISOString();

export async function readJsonFile(file, _fs = fs) {
  try {
    return { ok: true, value: JSON.parse(await _fs.readFile(file, "utf8")) };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

export function startDaemonReal({
  nodePath = process.execPath,
  daemonScript = DAEMON_SCRIPT,
  cwd = ROOT,
  log = () => {},
} = {}) {
  const child = spawn(nodePath, [daemonScript], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log(`telegram-watchdog: started daemon pid=${child.pid}`);
  return { ok: true, pid: child.pid };
}

export async function inspectDaemon({
  daemonLockFile = DAEMON_LOCK_FILE,
  readLock = readJsonFile,
  isAlive = isPidAliveReal,
} = {}) {
  const lock = await readLock(daemonLockFile);
  if (!lock.ok) return { running: false, reason: lock.code === "ENOENT" ? "missing-lock" : "unreadable-lock", lock };
  const pid = Number(lock.value && lock.value.pid);
  if (!Number.isFinite(pid)) return { running: false, reason: "invalid-lock", lock };
  if (!isAlive(pid)) return { running: false, reason: "stale-lock", pid, lock };
  return { running: true, reason: "alive", pid, lock };
}

// deps: intervalMs, maxRuntimeMs, once, daemonLockFile, watchdogLockFile,
//       readLock, isAlive, startDaemon, acquireLock, releaseLock, sleep, now, log
export async function runWatchdog(deps = {}) {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    maxRuntimeMs = null,
    once = false,
    daemonLockFile = DAEMON_LOCK_FILE,
    watchdogLockFile = WATCHDOG_LOCK_FILE,
    readLock = readJsonFile,
    isAlive = isPidAliveReal,
    startDaemon = startDaemonReal,
    acquireLock: _acquireLock = acquireLock,
    releaseLock: _releaseLock = releaseLock,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = (m) => console.log(m),
  } = deps;

  const lock = await _acquireLock({ lockFile: watchdogLockFile, pid: process.pid, isAlive, now, _fs: fs });
  if (!lock.acquired) {
    log(`telegram-watchdog: REFUSING to start — another watchdog is already running (pid=${lock.pid})`);
    return { refused: true, pid: lock.pid, starts: 0, checks: 0 };
  }

  const deadline = maxRuntimeMs ? now() + maxRuntimeMs : Infinity;
  let starts = 0;
  let checks = 0;
  log(`telegram-watchdog: start ${iso()} intervalMs=${intervalMs} maxRuntimeMs=${maxRuntimeMs || "none"}`);

  try {
    while (now() < deadline) {
      checks += 1;
      const status = await inspectDaemon({ daemonLockFile, readLock, isAlive });
      if (status.running) {
        log(`telegram-watchdog: daemon healthy pid=${status.pid}`);
      } else {
        log(`telegram-watchdog: daemon not running (${status.reason}) -> starting`);
        const started = await startDaemon({ log });
        if (started && started.ok) starts += 1;
      }
      if (once) break;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await sleep(Math.min(intervalMs, remaining));
    }
  } finally {
    await _releaseLock({ lockFile: watchdogLockFile, _fs: fs });
  }

  log(`telegram-watchdog: stop ${iso()} checks=${checks} starts=${starts}`);
  return { refused: false, starts, checks };
}

function parseArgs(argv) {
  const out = { once: false, intervalMs: DEFAULT_INTERVAL_MS, maxRuntimeMs: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--interval-ms") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.intervalMs = n;
    } else if (a === "--max-runtime-ms") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.maxRuntimeMs = n;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const r = await runWatchdog(args);
  if (r.refused) process.exit(3);
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
    console.error("telegram-watchdog fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
