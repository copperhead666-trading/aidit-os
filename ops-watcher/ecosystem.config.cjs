// ops-watcher/ecosystem.config.cjs
//
// PM2 ecosystem config for the 3 long-lived Node daemons this workspace used to
// run via Windows Scheduled Tasks (which executed node.exe with
// LogonType=Interactive and no hidden-window wrapper — the source of the
// visible console windows popping up on the OWNER's desktop). PM2's own "God"
// background daemon supervises these children headlessly with no visible
// console window, centralized logs, and auto-restart, replacing BOTH the raw
// Scheduled Tasks AND ops-watcher/telegram-watchdog.mjs (a hand-rolled
// supervisor whose entire job — keep exactly one listener alive and restart it
// on a missing/stale lock — PM2 already does natively via autorestart + 
// instances:1 + exec_mode:"fork").
//
// Why .cjs: this workspace's .mjs files are ES modules by package-less
// convention. PM2's ecosystem file format requires `module.exports`, which in
// an ESM context (or a file PM2 loads as ESM) is not available. Using the .cjs
// extension forces CommonJS loading without needing a package.json "type"
// override this workspace intentionally does not have.
//
// Logging: this config does NOT set out_file/error_file. An earlier version set
// custom absolute paths (ops-watcher/pm2-logs/<app>-out.log) and that BROKE
// stdio capture + process startup for telegram-listener and heartbeat on this
// machine (real `pm2 start` showed the apps "online" but produced 0 bytes of
// log output and no network activity after 90+ seconds; the same script run
// directly via `pm2 start <script> --name <app>` with PM2's DEFAULT log
// location worked immediately). Root cause was not debugged deeper into PM2's
// Windows log-stream handling — the pragmatic, empirically-verified fix is to
// let PM2 manage logs itself. Logs land in PM2's own default log directory
// (%USERPROFILE%\.pm2\logs\<app-name>-out.log / -error.log on this Windows/ASUS
// machine, i.e. C:\Users\ASUS\.pm2\logs\) — viewable via `pm2 logs <app-name>`.
// That also centralizes ALL PM2-managed daemons' logs in one place without this
// workspace managing log file paths itself.
//
// --- Logging / ESM-ecosystem-loader-compat (PM2 v7.0.4 on this Windows machine) ---
// EMPIRICALLY ISOLATED BUG (reproduced 4+ times, root-caused by elimination, not
// hypothesized): when an app in THIS ecosystem file points `script` directly at
// an ES-module .mjs file, `pm2 start ops-watcher/ecosystem.config.cjs` reports
// the app as "online" in `pm2 list` but it NEVER actually runs — zero log output
// ever, `pm2 list` pid shows "N/A" (no real process handle), zero network
// activity, lock files never touched. This is SPECIFIC to the ecosystem-file
// code path, NOT PM2 in general:
//   * `pm2 start ops-watcher/telegram-listener-daemon.mjs --name tl-test`
//     (bare CLI, the SAME exact .mjs file, no ecosystem file) works PERFECTLY
//     every time — immediate real log output, real pid, real network
//     connections. So PM2's CLI-argument code path can fork-spawn a .mjs file
//     fine; only the ecosystem-file loader code path cannot.
//   * Unrelated to which options are set: a minimal ecosystem entry with ONLY
//     name/script/cwd still breaks.
//   * Unrelated to multi-app simultaneous start: `--only <app>` isolating a
//     single app still breaks.
//   * The "paperclip" app in THIS SAME ecosystem file works fine because its
//     `script` is a plain .js CommonJS file (dist/index.js), NOT a .mjs file —
//     the file extension of the script is the real differentiator. PM2's
//     ecosystem-file loader on this machine/version cannot properly
//     fork-spawn a .mjs ES-module script, even though its own CLI-argument code
//     path can.
// FIX (additive, no daemon logic touched): each ESM daemon now has a tiny
// CommonJS launcher shim in ops-watcher/ (pm2-launch-telegram-listener.cjs and
// pm2-launch-heartbeat.cjs) that PM2's ecosystem loader CAN handle correctly
// (matching the working "paperclip" pattern of a real .js/.cjs entry point),
// each of which dynamically `import()`s the REAL .mjs daemon so its actual code
// runs completely unchanged. Dynamic `import()` inside a .cjs file is valid
// Node.js (CommonJS files CAN use the dynamic import() function even though
// they cannot use static `import` syntax) — the shim FILE is CJS (satisfying
// whatever PM2's ecosystem loader needs), but its single line of code uses the
// universally-available dynamic import() to load and execute the real ESM
// module, which runs exactly as it always has (top-level await, ESM imports
// inside the .mjs daemons themselves are completely unaffected — only the
// OUTER PM2-facing entry point changes). The "paperclip" app does NOT need
// this shim because its script is already a plain .js CommonJS file.
//
// Deploy (run from the repo root, D:\AI\Active FounderOS-Aidit):
//   pm2 start ops-watcher/ecosystem.config.cjs
//   pm2 save
// See ops-watcher/PM2-MIGRATION.md for the full cutover + which Scheduled
// Tasks to disable afterward.
//
// --- paperclipai resolution approach ---
// paperclipai is installed globally via npm. On Windows, `npm i -g` drops a
// generated shim at  %AppData%\npm\<name>.cmd  (here
// C:\Users\ASUS\AppData\Roaming\npm\paperclipai.cmd). The FIRST attempt here
// pointed `script` at that .cmd shim's ABSOLUTE path with
// `interpreter: "none"`, the idea being that PM2 would exec the shim directly
// as a native binary (its documented pattern for non-JS executables). That was
// tried for real with `pm2 start ops-watcher/ecosystem.config.cjs` and FAILED:
// the paperclip app errored out with `[PM2][ERROR] Process failed to launch
// spawn EINVAL` (telegram-listener and heartbeat started fine). Root cause: a
// .cmd file is a Windows *shell* script, not a native executable — it requires
// cmd.exe to interpret it. `interpreter: "none"` tells PM2 to exec the script
// directly with no shell wrapping, and Windows' spawn() returns EINVAL when
// the target is a .cmd/.bat file rather than a real PE binary.
//
// FIX: point `script` directly at the paperclipai package's REAL underlying
// JS entry point — the same JS file the .cmd shim itself ultimately invokes
// node against. That path was confirmed live on this machine via a running
// process's actual command line (not guessed):
//   C:\Users\ASUS\AppData\Roaming\npm\node_modules\paperclipai\dist\index.js
// and set `interpreter: "node"` (not "none") so PM2 spawns `node <dist/index.js>
// <args>` exactly like any other node script it manages. This sidesteps the
// .cmd-shell-interpretation problem entirely and lets PM2 supervise the
// process as a normal node child.
//
// Why this over the bare name "paperclipai":
//   * PM2's default interpreter is `node`. With `script: "paperclipai"` PM2
//     would spawn `node paperclipai ...`, which fails — `paperclipai` is not a
//     .js file node can resolve (it is a shell shim on Windows).
//   * Relying on PM2 to resolve a bare CLI name through PATH is fragile on
//     Windows: PM2's child spawn does not always inherit the interactive
//     user's full PATH / shim resolution the way cmd.exe does, and the
//     behavior differs across PM2 point releases.
//   * The .cmd-shim + interpreter:"none" approach was the previous plan and
//     is now ruled out empirically (EINVAL on real `pm2 start`). Pointing at
//     the package's dist JS entry is the empirically-working path on this
//     machine. Caveat: the dist JS path is an internal package detail that can
//     move across versions; if a future `npm i -g paperclipai` upgrade changes
//     it, this absolute path must be re-confirmed (e.g. via the running
//     process's command line) and updated here. The .cmd shim name/path is the
//     stable public contract, but it is not directly spawnable without a
//     shell, so it cannot be used under `interpreter: "none"`.
// A human should sanity-check the dist path exists
// (`dir C:\Users\ASUS\AppData\Roaming\npm\node_modules\paperclipai\dist\index.js`)
// before first `pm2 start`; this file could not be probed directly from this
// task's sandbox (filesystem access is workspace-scoped, and `npm config` is
// outside the allowlist), but the path was confirmed live via the running
// process's command line in the task context.

// Repository root, DERIVED. This file lives in <repo>/ops-watcher/, and being a
// .cjs file it gets a real __dirname for free. The previous hardcoded
// "D:\AI\Active FounderOS-Aidit" made every `cwd` below point at a directory
// that does not exist once the checkout moves or the folder is renamed, and PM2
// reports that as a generic spawn failure rather than a bad path.
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

// The ONE thing here that genuinely cannot be derived: paperclipai is installed
// globally, outside the checkout, at a location that differs per machine and per
// npm prefix. config/machine.json is the only file allowed to know it.
const MACHINE = require(path.join(ROOT, "config", "machine.json"));
const PAPERCLIP_CLI_ENTRY = MACHINE?.paperclip?.cli_entry;
if (!PAPERCLIP_CLI_ENTRY) {
  // Fail loudly and by key name. A silent fallback here would start PM2 with a
  // broken paperclip app and leave every board read failing for an unrelated
  // reason.
  throw new Error(
    "config/machine.json is missing paperclip.cli_entry — PM2 cannot resolve the paperclipai dist entry to spawn. Set it to this machine's <npm global root>/paperclipai/dist/index.js.",
  );
}

// --- restart policy justification ---
// max_restarts: 10 — NOT Infinity. A daemon that crash-loops forever burning
// CPU and filling logs is its own problem: if a child cannot stay up for
// `min_uptime` (10s) and crashes 10 times, that is unambiguously a systemic
// failure (bad config, missing dependency, port conflict, broken code path
// reached on every boot) that auto-restart will not fix. Bounding it at 10
// lets PM2 surface a clear "errored" state a human can investigate instead of
// silently thrashing. 10 is high enough that a single transient hiccup never
// trips it, but low enough to stop a hot loop within ~20s.
// min_uptime: "10s" — a daemon that exits faster than this is treated as a
// crash for restart-counting purposes (matches these daemons' real steady-state
// behavior: they loop indefinitely, so <10s uptime means a boot crash).
// restart_delay: 2000 — 2s backoff between restarts to avoid hammering
// downstream services (Paperclip, Telegram long-poll) on a crash burst.

module.exports = {
  apps: [
    // 1. paperclip — canonical Paperclip server for this workspace
    //    (kolega corp, company id a7011f31-8891-4581-b8fb-bbda8ac6a890).
    //    No ESM-ecosystem-loader shim needed here: this app's script is already
    //    a plain .js CommonJS file (dist/index.js), which PM2's ecosystem-file
    //    loader handles correctly on this machine (see the "Logging /
    //    ESM-ecosystem-loader-compat" section at the top of this file).
    {
      name: "paperclip",
      script: PAPERCLIP_CLI_ENTRY,
      interpreter: "node",
      // --data-dir DERIVED from ROOT. A stale literal here is worse than a crash:
      // paperclipai would happily create a brand-new empty instance at the old
      // path (or fail) instead of opening the board with 78 issues.
      args: `run --data-dir "${path.join(ROOT, ".paperclip")}" --instance default`,
      cwd: ROOT,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {},
    },

    // 2. telegram-listener — runs the listener daemon DIRECTLY under PM2.
    //    NOT via ops-watcher/telegram-watchdog.mjs: that watchdog's whole job
    //    ("ensure exactly one listener is running, restart it when the daemon
    //    lock is missing or stale") is exactly PM2's autorestart + single
    //    instance (instances:1, exec_mode:"fork"). Once PM2 owns this daemon,
    //    the watchdog and its Scheduled Task + lock file are dead code (left
    //    in place for rollback; see PM2-MIGRATION.md).
    //
    //    ESM-ecosystem-loader-compat: `script` points at the CommonJS launcher
    //    shim ops-watcher/pm2-launch-telegram-listener.cjs (NOT directly at the
    //    real telegram-listener-daemon.mjs). PM2 v7's ecosystem-file loader on
    //    this machine cannot fork-spawn a .mjs ES-module script directly (the
    //    app shows "online" but never runs — pid "N/A", zero logs). The shim is
    //    a plain .cjs file (same pattern as paperclip's .js entry, which works)
    //    that dynamically import()s the REAL telegram-listener-daemon.mjs, so
    //    the daemon's logic runs completely unchanged. See the "Logging /
    //    ESM-ecosystem-loader-compat" section at the top of this file.
    {
      name: "telegram-listener",
      script: "ops-watcher/pm2-launch-telegram-listener.cjs",
      interpreter: "node",
      cwd: ROOT,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {},
    },

    // 3. heartbeat — periodic supervisor for heartbeat.mjs --once.
    //    ESM-ecosystem-loader-compat: `script` points at the CommonJS launcher
    //    shim ops-watcher/pm2-launch-heartbeat.cjs (NOT directly at the real
    //    heartbeat-daemon.mjs), for the same reason as telegram-listener above
    //    (PM2 v7's ecosystem-file loader on this machine cannot fork-spawn a
    //    .mjs ES-module script directly). The shim is a plain .cjs file that
    //    dynamically import()s the REAL heartbeat-daemon.mjs, so the daemon's
    //    logic runs completely unchanged. See the "Logging /
    //    ESM-ecosystem-loader-compat" section at the top of this file.
    {
      name: "heartbeat",
      script: "ops-watcher/pm2-launch-heartbeat.cjs",
      interpreter: "node",
      cwd: ROOT,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {},
    },

    // 4. cockpit — the Next.js owner cockpit on port 4200, the surface the owner
    //    opens from his phone through Tailscale Funnel.
    //
    //    WHY IT IS HERE AT ALL: ops-watcher/pm2-supervisor.mjs has listed
    //    cockpit in EXPECTED_PROCESSES since it was written, but this file
    //    never defined one. The supervisor therefore reported a missing cockpit
    //    on every single sweep, forever — an alert that is always on is an alert
    //    nobody reads, and it also meant the cockpit did not come back after a
    //    reboot the way the other three did.
    //
    //    ESM-ecosystem-loader-compat: `script` points at Next's own CLI entry
    //    inside cockpit/node_modules rather than at `npm start`. PM2 spawns
    //    `node <script>`, and `npm`/`next` on Windows are .cmd shims that node
    //    cannot resolve — the same problem paperclip's dist entry solves. cwd is
    //    the cockpit directory because cockpit/ is its own project root.
    //
    //    NEVER `npm run build` while this app is live: the CSS hash changes and
    //    the page renders naked with no error. Order is stop, delete .next,
    //    build, start.
    {
      name: "cockpit",
      // ABSOLUTE script path, because cwd is the cockpit directory and PM2
      // resolves a relative `script` against cwd: "cockpit/node_modules/..."
      // under a cwd that IS the cockpit directory resolves to
      // <repo>/cockpit/cockpit/node_modules/... and PM2 reports it as a generic
      // spawn failure.
      script: path.join(ROOT, "cockpit", "node_modules", "next", "dist", "bin", "next"),
      // -p 4200 is NOT optional. Next defaults to 3000, and the Tailscale Funnel
      // that puts this on the owner's phone proxies 4200. Without the flag the
      // cockpit comes up healthy on a port nothing is pointed at.
      args: "start -p 4200",
      interpreter: "node",
      // cockpit/ is its own project root - repo-root rules do not apply there,
      // and Next resolves its config and .next build output from cwd.
      cwd: path.join(ROOT, "cockpit"),
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {},
    },
  ],
};
