// PM2 ecosystem for Aidit OS v5 on Lenovo (Windows). Six-stack processes:
// web (cockpit 4200), paperclip-v5 (board 3120, system Node >= 24),
// conductor (30-minute JARVIS tick), telegram (owner door + reports),
// ops (lane probe, disk/RAM, cleanup, every 15 minutes).
const node22 = (script) => ({ script: "ops/pm2-launch-node22.cjs", args: script, cwd: __dirname, autorestart: true, max_restarts: 50, restart_delay: 10000 });
module.exports = {
  apps: [
    { name: "aidit-v5", script: "ops/pm2-launch-web.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { NODE_ENV: "production" } },
    { name: "paperclip-v5", script: "ops/pm2-launch-paperclip.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000 },
    { name: "conductor", ...node22("conductor/run.mjs") },
    { name: "telegram", ...node22("conductor/telegram.mjs") },
    { name: "ops", ...node22("conductor/ops.mjs") },
  ],
};
// PRD v5.1 s4: `graphify watch` needs the Python `watchdog` package, which
// this machine's graphify.exe cannot see even after `pip install watchdog`
// into the python.exe PATH resolves to (bundled-interpreter mismatch,
// unresolved 2026-09-15) — so the graph is refreshed by head.mjs calling
// `graphify update` after each commit instead of a standing watch daemon.
