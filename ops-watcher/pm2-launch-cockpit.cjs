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

const ROOT = path.resolve(__dirname, "..");
const COCKPIT_DIR = path.join(ROOT, "cockpit");
const NEXT_BIN = path.join(COCKPIT_DIR, "node_modules", "next", "dist", "bin", "next");
const ENV_FILE = path.join(ROOT, ".env.local");

// Missing on machines where the owner never created it / in fresh checkouts —
// that is not this shim's problem to fix, so load only if present.
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

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
