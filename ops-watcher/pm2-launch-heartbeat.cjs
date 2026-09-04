// ops-watcher/pm2-launch-heartbeat.cjs
// CommonJS launcher shim for PM2 (see ops-watcher/ecosystem.config.cjs's
// "Logging / ESM-ecosystem-loader-compat" comment section for why this exists —
// PM2 v7's ecosystem-file loader on this machine cannot correctly fork-spawn
// a .mjs ES-module script directly, even though `pm2 start <file>.mjs` via
// bare CLI works fine; a CJS shim that dynamically import()s the real daemon
// sidesteps this). Runs the REAL heartbeat-daemon.mjs unchanged via a dynamic
// import — no logic duplicated or reimplemented here.
const path = require("node:path");
const loadEnvLocal = require("./load-env-local.cjs");
const envLoad = loadEnvLocal();
console.log(`pm2-launch-heartbeat: loaded ${envLoad.loaded.length} .env.local keys: ${envLoad.loaded.length ? envLoad.loaded.join(", ") : "(none)"}`);

// WHY argv IS RE-AIMED (bug reproduced 2026-09-04, the reason Aidit OS had
// never actually run under PM2 on this machine): heartbeat-daemon.mjs starts
// its loop only when it believes it IS the entry point —
//   isEntry = path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
// Under PM2 this shim is argv[1], so isEntry was false, main() was never
// called, the dynamic import resolved, and the process exited 0 in complete
// silence: an empty error log, a growing restart count, and no clue why.
//
// pm2-launch-cockpit.cjs already re-aims argv for exactly this reason. The
// lesson was written there and never applied here.
//
// Tests import heartbeat-daemon.mjs directly and never pass through this shim,
// so their import-without-starting behaviour is unchanged.
process.argv[1] = path.join(__dirname, "heartbeat-daemon.mjs");

import("./heartbeat-daemon.mjs").catch((err) => {
  console.error("pm2-launch-heartbeat: failed to import real daemon:", err && err.stack || err);
  process.exit(1);
});
