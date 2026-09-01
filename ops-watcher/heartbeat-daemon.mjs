// ops-watcher/heartbeat-daemon.mjs
// Periodic supervisor for heartbeat.mjs --once. It keeps the existing reviewed
// six-step heartbeat pipeline intact, but runs it unattended with a single
// instance lock so OWNER approvals can resume test/review flow without a human
// terminal sweep.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHeartbeatOnce } from "./heartbeat.mjs";
import { acquireLock, releaseLock, isPidAliveReal } from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCK_FILE = path.join(__dirname, "heartbeat-daemon.lock");
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const iso = () => new Date().toISOString();

export async function runHeartbeatDaemon(deps = {}) {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    maxRuntimeMs = null,
    once = false,
    lockFile = LOCK_FILE,
    runHeartbeat = runHeartbeatOnce,
    acquireLock: _acquireLock = acquireLock,
    releaseLock: _releaseLock = releaseLock,
    isAlive = isPidAliveReal,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = (m) => console.log(m),
  } = deps;

  const lock = await _acquireLock({ lockFile, pid: process.pid, isAlive, now, _fs: fs });
  if (!lock.acquired) {
    log(`heartbeat-daemon: REFUSING to start — another instance is already running (pid=${lock.pid})`);
    return { refused: true, pid: lock.pid, sweeps: 0, failedSweeps: 0 };
  }

  const deadline = maxRuntimeMs ? now() + maxRuntimeMs : Infinity;
  let sweeps = 0;
  let failedSweeps = 0;
  log(`heartbeat-daemon: start ${iso()} intervalMs=${intervalMs} maxRuntimeMs=${maxRuntimeMs || "none"}`);
  try {
    while (now() < deadline) {
      sweeps += 1;
      try {
        const r = await runHeartbeat({ log: (m) => log(`heartbeat-daemon: ${m}`), now });
        if (r.failed > 0) failedSweeps += 1;
      } catch (err) {
        failedSweeps += 1;
        log(`heartbeat-daemon: sweep threw but daemon continues: ${err && err.stack ? err.stack : err}`);
      }
      if (once) break;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await sleep(Math.min(intervalMs, remaining));
    }
  } finally {
    await _releaseLock({ lockFile, _fs: fs });
  }
  log(`heartbeat-daemon: stop ${iso()} sweeps=${sweeps} failedSweeps=${failedSweeps}`);
  return { refused: false, sweeps, failedSweeps };
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
  const r = await runHeartbeatDaemon(parseArgs(process.argv));
  if (r.refused) process.exit(3);
}

const isEntry = (() => {
  try { return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (isEntry) main().catch((err) => { console.error("heartbeat-daemon fatal:", err && err.stack ? err.stack : err); process.exit(1); });
