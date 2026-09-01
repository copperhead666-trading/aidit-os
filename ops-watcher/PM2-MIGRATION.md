# PM2 Migration — ops-watcher long-lived daemons

This workspace previously ran 3 long-lived Node daemons via **Windows Scheduled
Tasks** that directly executed `node.exe` with `LogonType=Interactive` and no
hidden-window wrapper. That is the source of the visible console windows that
kept popping up on the OWNER's desktop. We are migrating them to **PM2**
(v7.0.4, already installed) for headless supervision with centralized logs and
auto-restart.

PM2's own background "God" daemon manages children without a visible console
window on Windows by design — this is independent of the `windowsHide` fix
already applied to this workspace's own internal `spawn()` calls for
probe/step processes. Do **not** add `windowsHide` to the PM2 ecosystem file;
it is irrelevant to PM2's process model.

## The 3 apps

| # | PM2 name | Script | Purpose |
|---|---|---|---|
| 1 | `paperclip` | `C:\Users\ASUS\AppData\Roaming\npm\node_modules\paperclipai\dist\index.js` (npm-global CLI's underlying JS entry, run with `interpreter: "node"`) | Canonical Paperclip server for this workspace (kolega corp, company id `a7011f31-8891-4581-b8fb-bbda8ac6a890`). Args: `run --data-dir "D:\AI\Active FounderOS-Aidit\.paperclip" --instance default`. |
| 2 | `telegram-listener` | `ops-watcher/telegram-listener-daemon.mjs` (node) | The Telegram long-poll listener daemon, run **directly** under PM2. |
| 3 | `heartbeat` | `ops-watcher/heartbeat-daemon.mjs` (node) | Periodic supervisor for `heartbeat.mjs --once`. |

All three run with `cwd: D:\AI\Active FounderOS-Aidit`, `instances: 1`,
`exec_mode: "fork"`, `autorestart: true`, `watch: false` (these are hand-rolled
daemons, not dev servers — no file-watching restart). See
`ops-watcher/ecosystem.config.cjs` for the full config and inline justifications
(paperclipai resolution approach, restart policy bounds).

## Logging

This config sets **no** custom `out_file` / `error_file` paths. An earlier
version pointed them at an `ops-watcher/pm2-logs/` directory, and that **broke
stdio capture + process startup** for `telegram-listener` and `heartbeat` on
this machine: a real `pm2 start` reported both apps "online" but produced **0
bytes** of log output (both out and error files) and **no network activity**
(verified via netstat — a healthy listener should hold a connection to
Telegram's long-poll API) even after 90+ seconds. The identical script run
directly via `pm2 start <script> --name <app>` — letting PM2 use its own default
log location — worked immediately, with real log lines within 1 second. That
isolated the cause to the custom string-built absolute log paths. The pragmatic
fix is to let PM2 manage logs itself.

Logs therefore land in **PM2's own default log directory**
(`%USERPROFILE%\.pm2\logs\` — i.e. `C:\Users\ASUS\.pm2\logs\` on this
Windows/ASUS machine) as `<app-name>-out.log` / `<app-name>-error.log`. This is
simpler and already centralized — **all** PM2-managed daemons' logs live in one
place without this workspace having to manage log file paths itself. View them
with:

```cmd
pm2 logs <app-name>
pm2 logs paperclip --lines 50
pm2 logs telegram-listener --lines 50
pm2 logs heartbeat --lines 50
```

## Deploy — ACTUAL working method (AHMAD, live-verified 2026-08-29)

**`ops-watcher/ecosystem.config.cjs` does NOT work on this machine.** Live
testing found a real PM2 v7.0.4 + Windows bug: any app in an ecosystem file
whose `script` resolves under this workspace's path (both a relative
`"ops-watcher/..."` form AND an absolute `"D:\AI\Active FounderOS-Aidit\..."`
form were tried) gets its script path corrupted internally by PM2's
ecosystem-file loader — symptoms ranged from the app showing "online" with
`pid: N/A` and zero log output/network activity ever, to an explicit
`[PM2][ERROR] Script not found:` with a visibly mangled, duplicated path
string (e.g. `D:\AI\Active FounderOS-Aidit\AIActive FounderOS-Aidit\...`).
Eliminated as causes: custom log paths (already removed, see Logging above),
ESM vs CommonJS (a `.cjs` dynamic-`import()` shim was tried and still broke),
`cwd` overlap with `script`, and multi-app-simultaneous-start (`--only` single
app still broke). The **`paperclip`** app is the only one that ever worked via
the ecosystem file, and only because its script
(`C:\Users\ASUS\AppData\Roaming\npm\node_modules\paperclipai\dist\index.js`)
lives on a **different drive** than the workspace (`C:` vs `D:`) — every
script path actually rooted under `D:\AI\Active FounderOS-Aidit\` breaks when
loaded via the ecosystem file, regardless of relative/absolute form.
`ops-watcher/ecosystem.config.cjs` is kept as **documentation of intended
settings only** (restart policy, args) — do not `pm2 start` it directly.
`ops-watcher/pm2-launch-telegram-listener.cjs` and
`ops-watcher/pm2-launch-heartbeat.cjs` (the CJS import shims built to test the
ESM theory) are likewise dead/unused — left in place, harmless, not part of
the real deploy path.

**Actual deploy** (run from the repo root, individual `pm2 start` CLI
invocations — every one of these was live-tested and confirmed working, real
log output within 1 second, real Paperclip health checks, survives a full
`pm2 kill` + `pm2 resurrect` cycle):

```cmd
cd "D:\AI\Active FounderOS-Aidit"

pm2 start "C:\Users\ASUS\AppData\Roaming\npm\node_modules\paperclipai\dist\index.js" --name paperclip --interpreter node --max-restarts 10 --restart-delay 2000 -- run --data-dir "D:\AI\Active FounderOS-Aidit\.paperclip" --instance default

pm2 start ops-watcher/telegram-listener-daemon.mjs --name telegram-listener --max-restarts 10 --restart-delay 2000

pm2 start ops-watcher/heartbeat-daemon.mjs --name heartbeat --max-restarts 10 --restart-delay 2000

pm2 save
```

`pm2 save` persists this exact process list (script paths, args, restart
policy) to `C:\Users\ASUS\.pm2\dump.pm2`. Boot/logon recovery is handled by
the Scheduled Task **`FounderOS-Aidit-PM2-Resurrect`** (AtLogOn trigger, runs
`C:\nvm4w\nodejs\pm2.cmd resurrect`, confirmed via `which pm2` /
`where.exe pm2` — do not assume `pm2.cmd` lives under `%AppData%\npm\`, on
this machine it is an nvm4w-managed shim at `C:\nvm4w\nodejs\pm2.cmd`) — this
substitutes for PM2's own `pm2 startup` (no native Windows service-registration
support in this PM2 version). Live-tested: `pm2 kill` (full daemon + all apps
stopped) followed by `pm2.cmd resurrect` correctly restored all 3 processes
with their original commands, confirmed functional (real Telegram long-poll
log lines, real Paperclip health response) within 10 seconds.

**If restarting any single app after a config value changes** (e.g. a new
`max-restarts`), re-run its `pm2 start` line above (or `pm2 restart <name>`
for the same command) and `pm2 save` again — the ecosystem file is not
consulted.

**You must ALSO `pm2 restart <name>` after editing the .mjs source file a
running app imports.** `watch: false` (see "The 3 apps" above) means PM2
never auto-reloads on file change — a running app keeps executing whatever
was in memory at its last start, indefinitely, even after the file on disk
changes underneath it. This is not hypothetical: on 2026-08-29, a real fix to
`ops-watcher/heartbeat.mjs` (the `shouldRunTelegramListenerStepReal` gate
that skips the redundant one-shot `telegram-listener` step when the
persistent daemon is already healthy) was written to disk at 13:04, but the
running `heartbeat` PM2 process had started at 02:45 — over 10 hours
earlier — and was never restarted. It kept running the pre-fix code for the
next several hours, so the one-shot step fired on every single 5-minute
cycle, raced the persistent daemon's long-poll, and produced a continuous
live Telegram 409 Conflict storm that was silently accumulating in
`telegram-listener-out.log` the whole time. Found by manually comparing the
edited file's mtime against `pm2 jlist`'s `pm2_env.pm_uptime` for the app,
fixed with a single `pm2 restart heartbeat`. `ops-watcher/steward.mjs` is
being extended (FOS-11) with an automated check that diffs each PM2 app's
watched source file mtimes against its process start time and raises a
CRITICAL finding — "running stale code, restart required" — before this
kind of drift can go unnoticed again.

Verify:

```cmd
pm2 list
pm2 logs paperclip --lines 50
pm2 logs telegram-listener --lines 50
pm2 logs heartbeat --lines 50
```

## Scheduled Tasks that become redundant

Once PM2 owns all three daemons, disable these three Windows Scheduled Tasks
(they will now both duplicate PM2's supervision AND, for the interactive ones,
re-introduce the visible-console-window problem). A human/AHMAD disables these
separately — this task has no `schtasks` access:

- **`FounderOS-Aidit-Heartbeat`**
- **`FounderOS-Aidit-TelegramListener`**
- **`FounderOS-Aidit-Paperclip`**

## Dead code left in place (do NOT delete — rollback safety)

`ops-watcher/telegram-watchdog.mjs` and its own Scheduled Task +
`telegram-watchdog.lock` file become **dead code / unused** once
`telegram-listener-daemon.mjs` is managed by PM2 directly. The watchdog's entire
job — per its own header comment:

> "It does not process Telegram updates itself. It only ensures exactly one
> listener daemon is running, and restarts it when the daemon lock is missing
> or stale"

— is what PM2's `autorestart` + single-instance (`instances: 1`,
`exec_mode: "fork"`) already does natively.

**Do not delete** `telegram-watchdog.mjs` or its regression test
(`telegram-watchdog.regression.test.mjs`). Leave them in place, just documented
here as **superseded**. Deleting production code is out of scope for this task,
and someone may want to roll back to the watchdog if PM2 supervision turns out
to misbehave for this specific daemon.

The `FounderOS-Aidit-TelegramListener` Scheduled Task (above) historically
launched the watchdog, which in turn launched the listener daemon. Under PM2
that two-hop indirection collapses to PM2 → listener daemon directly.

## Rollback

If PM2 supervision needs to be reverted:

```cmd
pm2 delete all          # or: pm2 delete paperclip telegram-listener heartbeat
pm2 save
```

Then re-enable the three Scheduled Tasks listed above (`FounderOS-Aidit-Heartbeat`,
`FounderOS-Aidit-TelegramListener`, `FounderOS-Aidit-Paperclip`) and disable/delete
the `FounderOS-Aidit-PM2-Resurrect` task so a future logon doesn't resurrect
the deleted PM2 process list. `telegram-watchdog.mjs` and its lock file are
still present, so that path works again unchanged.