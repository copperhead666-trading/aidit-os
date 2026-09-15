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
    // HERMES_HOME: same reasoning as CODEX_HOME above -- paperclip-v5's child
    // head.mjs also calls hermes-cli directly for every GLM/Kimi lane (the
    // system's PRIMARY coding lane after 2026-09-15 night's lane rework).
    // hermes-cli defaults to %LOCALAPPDATA%\hermes, a per-OS-user path;
    // migrated the working WIN10 config into this dedicated dir and verified
    // a real call (`hermes chat -q "..." -m glm-5.3-flash:cloud`) succeeds
    // under it before wiring this in.
    { name: "paperclip-v5", script: "ops/pm2-launch-paperclip.cjs", cwd: __dirname, autorestart: true, max_restarts: 20, restart_delay: 5000, env: { CODEX_HOME: "D:/aidit-codex-machine", HERMES_HOME: "D:/aidit-hermes-machine" } },
    // CLAUDE_CONFIG_DIR: TEMPORARY as of 2026-09-16 morning, owner's own
    // explicit call -- the machine account (pusatberasmurah) is still logged
    // out (weekly reset 2026-09-17 06:00 WIB), and rather than let opus
    // decisions silently no-op until then, Conductor borrows the
    // orchestrator's own ~/.claude (adityainofficial) by simply NOT setting
    // this var (unset = claude-cli's own default). Real cost: this account's
    // quota is now shared between the interactive session and Conductor's
    // automated calls -- accepted knowingly, reverts tomorrow morning once
    // pusatberasmurah resets (switch this back to "D:/aidit-claude-machine"
    // then -- see ops/claude-machine.cmd for the one-time login).
    { name: "conductor", ...node22("conductor/run.mjs"), env: { CODEX_HOME: "D:/aidit-codex-machine" } },
    { name: "telegram", ...node22("conductor/telegram.mjs") },
    // HERMES_HOME here too: ops.mjs's tick calls `hermes cron tick` to fire
    // Hermes's own standing cron jobs (its "board employee" presence, per
    // Bennett's stack description -- 2026-09-15 night). conductor/run.mjs's
    // askGlm() does NOT need this: it hits Ollama's local HTTP API directly
    // (127.0.0.1:11434/api/chat), bypassing hermes-cli entirely.
    { name: "ops", ...node22("conductor/ops.mjs"), env: { HERMES_HOME: "D:/aidit-hermes-machine" } },
  ],
};
// PRD v5.1 s4: `graphify watch` needs the Python `watchdog` package, which
// this machine's graphify.exe cannot see even after `pip install watchdog`
// into the python.exe PATH resolves to (bundled-interpreter mismatch,
// unresolved 2026-09-15) — so the graph is refreshed by head.mjs calling
// `graphify update` after each commit instead of a standing watch daemon.
