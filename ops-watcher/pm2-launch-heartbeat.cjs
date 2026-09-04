// ops-watcher/pm2-launch-heartbeat.cjs
// CommonJS launcher shim for PM2 (see ops-watcher/ecosystem.config.cjs's
// "Logging / ESM-ecosystem-loader-compat" comment section for why this exists —
// PM2 v7's ecosystem-file loader on this machine cannot correctly fork-spawn
// a .mjs ES-module script directly, even though `pm2 start <file>.mjs` via
// bare CLI works fine; a CJS shim that dynamically import()s the real daemon
// sidesteps this). Runs the REAL heartbeat-daemon.mjs unchanged via a dynamic
// import — no logic duplicated or reimplemented here.
const loadEnvLocal = require("./load-env-local.cjs");
const envLoad = loadEnvLocal();
console.log(`pm2-launch-heartbeat: loaded ${envLoad.loaded.length} .env.local keys: ${envLoad.loaded.length ? envLoad.loaded.join(", ") : "(none)"}`);

import("./heartbeat-daemon.mjs").catch((err) => {
  console.error("pm2-launch-heartbeat: failed to import real daemon:", err && err.stack || err);
  process.exit(1);
});
