// ops-watcher/pm2-launch-telegram-listener.cjs
// CommonJS launcher shim for PM2 (see ops-watcher/ecosystem.config.cjs's
// "Logging / ESM-ecosystem-loader-compat" comment section for why this exists —
// PM2 v7's ecosystem-file loader on this machine cannot correctly fork-spawn
// a .mjs ES-module script directly, even though `pm2 start <file>.mjs` via
// bare CLI works fine; a CJS shim that dynamically import()s the real daemon
// sidesteps this). Runs the REAL telegram-listener-daemon.mjs unchanged via a
// dynamic import — no logic duplicated or reimplemented here.
const path = require("node:path");
const loadEnvLocal = require("./load-env-local.cjs");
const envLoad = loadEnvLocal();
console.log(`pm2-launch-telegram-listener: loaded ${envLoad.loaded.length} .env.local keys: ${envLoad.loaded.length ? envLoad.loaded.join(", ") : "(none)"}`);

// WHY argv IS RE-AIMED — see pm2-launch-heartbeat.cjs for the full account.
// telegram-listener-daemon.mjs guards its start the same way:
//   isEntry = path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
// With this shim as argv[1] the guard was false, the listener never polled, and
// the process exited 0 leaving an empty error log behind.
process.argv[1] = path.join(__dirname, "telegram-listener-daemon.mjs");

import("./telegram-listener-daemon.mjs").catch((err) => {
  console.error("pm2-launch-telegram-listener: failed to import real daemon:", err && err.stack || err);
  process.exit(1);
});
