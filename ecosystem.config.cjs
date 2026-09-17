// PM2 ecosystem for Aidit OS v5 on Lenovo (Windows). Six-stack processes:
// web (cockpit 4200), paperclip-v5 (board 3120, system Node >= 24),
// conductor (30-minute JARVIS tick), telegram (owner door + reports),
// ops (lane probe, disk/RAM, cleanup, every 15 minutes).
//
// Identity rule (audit 2026-09-16, GIBRAN + Bennett comparison): PM2 apps have
// run as SYSTEM or WIN10 depending on who last restarted them, and every tool
// (claude, codex, hermes) then looked for its login in a different profile —
// the root of the 401 Codex storm, "hermes.cmd not found" and "session storage
// busy". So every app gets the SAME explicit tool homes and PATH below and
// never depends on the OS user again. Machine homes:
//   D:/aidit-claude-machine  claude (account pusatberasmurah; login Thu 06:00 via ops/claude-machine.cmd)
//   D:/aidit-codex-machine   codex  (ChatGPT plan; auth copied from the owner's ~/.codex 2026-09-16)
//   D:/aidit-hermes-machine  hermes (GLM via Ollama + fallbacks; Nous login)
const MACHINE_ENV = {
  CLAUDE_CONFIG_DIR: "D:/aidit-claude-machine",
  CODEX_HOME: "D:/aidit-codex-machine",
  HERMES_HOME: "D:/aidit-hermes-machine",
  OLLAMA_HOST: "http://127.0.0.1:11434",
  TEMP: "D:\\Temp",
  TMP: "D:\\Temp",
  PATH: [
    "D:\\aidit-node\\node-v22.14.0-win-x64",
    "D:\\Development\\npm-global",
    "C:\\Program Files\\nodejs",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\Git\\usr\\bin",
    "D:\\Ollama",
    "C:\\Users\\WIN10\\.local\\bin",
    "C:\\Windows\\system32",
    "C:\\Windows",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
  ].join(";"),
};
const node22 = (script) => ({ script: "ops/pm2-launch-node22.cjs", args: script, cwd: __dirname, autorestart: true, max_restarts: 50, restart_delay: 10000 });
module.exports = {
  apps: [
    { name: "aidit-v5", script: "ops/pm2-launch-web.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { ...MACHINE_ENV, NODE_ENV: "production" } },
    // paperclip-v5 spawns conductor/head.mjs (process adapter) — heads inherit MACHINE_ENV from here.
    { name: "paperclip-v5", script: "ops/pm2-launch-paperclip.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { ...MACHINE_ENV } },
    // Rename 2026-09-17 (keputusan owner): Conductor -> Orkestrator.
    // Folder kode tetap conductor/ agar state & referensi tidak putus.
    { name: "orkestrator", ...node22("conductor/run.mjs"), env: { ...MACHINE_ENV } },
    { name: "telegram", ...node22("conductor/telegram.mjs"), env: { ...MACHINE_ENV } },
    { name: "ops", ...node22("conductor/ops.mjs"), env: { ...MACHINE_ENV } },
  ],
};
// PRD v5.1 s4: `graphify watch` needs the Python `watchdog` package, which
// this machine's graphify.exe cannot see even after `pip install watchdog`
// into the python.exe PATH resolves to (bundled-interpreter mismatch,
// unresolved 2026-09-15) — so the graph is refreshed by head.mjs calling
// `graphify update` after each commit instead of a standing watch daemon.
