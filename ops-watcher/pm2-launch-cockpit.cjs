// ops-watcher/pm2-launch-cockpit.cjs
// CommonJS launcher shim for PM2 that runs the cockpit's REAL Next.js CLI
// unchanged — same shim pattern as pm2-launch-telegram-listener.cjs and
// pm2-launch-heartbeat.cjs (see ecosystem.config.cjs's "Logging /
// ESM-ecosystem-loader-compat" section for why the ecosystem loader needs a
// CJS entry point).
//
// WHY THIS SHIM EXISTS (bug reproduced 2026-09-04): cockpit/middleware.ts and
// cockpit/app/api/session/route.ts read process.env.TELEGRAM_BOT_TOKEN_AHMAD,
// and there is no cockpit/.env.local. The token lives ONLY in the repo root's
// .env.local, but the PM2 cockpit app runs with cwd = <repo>/cockpit, and
// Next.js only auto-loads .env files from the PROJECT directory (cwd). So the
// token silently never reached the cockpit process and every page rendered the
// Masuk (login) fallback. This shim loads <repo>/.env.local into process.env
// BEFORE Next starts, then hands control to Next's own CLI entry point
// (cockpit/node_modules/next/dist/bin/next) in-process — no Next logic is
// duplicated or reimplemented here.
//
// Env-loading semantics follow the dotenv convention: KEY=VALUE lines, #
// comments and blank lines skipped, surrounding quotes stripped, and an
// already-set process.env key is NEVER overridden (explicit env — e.g. from
// the PM2 app `env` block or the machine — wins over the file).
const fs = require("node:fs");
const path = require("node:path");
const loadEnvLocal = require("./load-env-local.cjs");

const ROOT = path.resolve(__dirname, "..");
const COCKPIT_DIR = path.join(ROOT, "cockpit");
const NEXT_BIN = path.join(COCKPIT_DIR, "node_modules", "next", "dist", "bin", "next");
const envLoad = loadEnvLocal();
console.log(`pm2-launch-cockpit: loaded ${envLoad.loaded.length} .env.local keys: ${envLoad.loaded.length ? envLoad.loaded.join(", ") : "(none)"}`);

// Missing on machines where the owner never created it / in fresh checkouts —
// that is not this shim's problem to fix, so load only if present.

// Fail loudly by name rather than letting PM2 report a generic spawn failure
// or the cockpit silently come up without its build output.
if (!fs.existsSync(NEXT_BIN)) {
  console.error(
    `pm2-launch-cockpit: Next CLI entry not found at ${NEXT_BIN} — ` +
    `run "npm install" (and "npm run build") in ${COCKPIT_DIR} before starting this app.`,
  );
  process.exit(1);
}

// Next resolves next.config and .next from cwd, which must be the cockpit
// project dir (PM2 already sets it; chdir makes direct runs work too).
process.chdir(COCKPIT_DIR);

// Re-aim argv from [node, this-shim, ...pm2Args] to [node, next-bin, ...pm2Args]
// so Next's CLI parser sees its real entry point and the args PM2 passed
// (currently "start -p 4200", defined in ecosystem.config.cjs).
process.argv = [process.execPath, NEXT_BIN, ...process.argv.slice(2)];
require(NEXT_BIN);
