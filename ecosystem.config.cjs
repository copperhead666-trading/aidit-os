// PM2 ecosystem for Aidit OS v5 on Lenovo (Windows). Six-stack processes:
// web (cockpit 4200), paperclip-v5 (board 3120, system Node >= 24),
// conductor (30-minute JARVIS tick), telegram (owner door + reports),
// ops (lane probe, disk/RAM, cleanup, every 15 minutes).
const node22 = (script) => ({ script: "ops/pm2-launch-node22.cjs", args: script, cwd: __dirname, autorestart: true, max_restarts: 50, restart_delay: 10000 });
module.exports = {
  apps: [
    { name: "aidit-v5", script: "ops/pm2-launch-web.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { NODE_ENV: "production" } },
    // CODEX_HOME: paperclip-v5 spawns conductor/head.mjs as its child (per
    // ops/paperclip-bootstrap.mjs's adapterConfig) -- head.mjs is what
    // actually shells out to codex-cli for gpt-5.5/codex/gpt-6-astra lanes.
    // Found live 2026-09-15: both PM2 and its children run as Windows user
    // SYSTEM, whose own %USERPROFILE%\.codex had no auth.json at all (never
    // logged in) -- a session-wide 401 on every codex-family call. Patched
    // that night by copying a working auth.json into SYSTEM's profile, but
    // that's fragile (tied to an OS-account identity, not explicit). This
    // env var redirects codex-cli to its own dedicated, explicit config dir
    // instead -- same pattern as CLAUDE_CONFIG_DIR below. Log in once with:
    //   $env:CODEX_HOME="D:\aidit-codex-machine"; codex login
    { name: "paperclip-v5", script: "ops/pm2-launch-paperclip.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { CODEX_HOME: "D:/aidit-codex-machine" } },
    // CLAUDE_CONFIG_DIR: the conductor-decision/review Claude calls run as the
    // MACHINE account (pusatberasmurah), never the orchestrator's ~/.claude
    // (adityainofficial) — see ops/claude-machine.cmd. Until that account logs
    // in there (Thu 2026-09-17), claude-cli calls here fail "not logged in"
    // and the lane rests to its GLM fallback (PRD v5.1 s2c) — the intended
    // state, not a bug, for the rest of this v5.1 session (log in early with
    // ops/claude-machine.cmd if you want it sooner).
    { name: "conductor", ...node22("conductor/run.mjs"), env: { CLAUDE_CONFIG_DIR: "D:/aidit-claude-machine", CODEX_HOME: "D:/aidit-codex-machine" } },
    { name: "telegram", ...node22("conductor/telegram.mjs") },
    { name: "ops", ...node22("conductor/ops.mjs") },
  ],
};
// PRD v5.1 s4: `graphify watch` needs the Python `watchdog` package, which
// this machine's graphify.exe cannot see even after `pip install watchdog`
// into the python.exe PATH resolves to (bundled-interpreter mismatch,
// unresolved 2026-09-15) — so the graph is refreshed by head.mjs calling
// `graphify update` after each commit instead of a standing watch daemon.
