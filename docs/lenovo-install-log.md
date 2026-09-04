# Lenovo install log

Everything installed on LENOVO-BLACK to make Aidit OS run here, with the version,
where it landed, and how to undo it. The owner allowed installs outside `D:\AI`
on the condition that every one of them is written down. An entry that cannot be
undone says so instead of pretending.

Machine: LENOVO-BLACK, Windows 10 Home 19045.6466, Tailscale `lenovo-black.tailc7b60e.ts.net`.
Started 2026-09-04 by SOEKARNO.

---

## Already present before this session (not installed by me, recorded for completeness)

| What | Version | Where |
|---|---|---|
| Node (system default) | v26.5.0 | `C:\Program Files\nodejs\node.exe` |
| Node (pinned for this repo) | v22.14.0 | `D:\aidit-node\node-v22.14.0-win-x64\node.exe` |
| Python | 3.12 | `C:\Users\WIN10\AppData\Local\Programs\Python\Python312` |
| uv | 0.12.4 | `C:\Users\WIN10\.local\bin\uv.exe` |
| Ollama | 0.33.2 | `D:\Ollama\ollama.exe` |
| Tailscale | — | `C:\Program Files\Tailscale` |
| GitHub CLI | — | `C:\Program Files\GitHub CLI` |
| codex CLI | — | `D:\Development\npm-global\codex` |
| claude CLI | — | `D:\Development\npm-global\claude` |
| chocolatey | — | `C:\ProgramData\chocolatey` |
| winget | — | `C:\Users\WIN10\AppData\Local\Microsoft\WindowsApps` |

npm global prefix on this machine is **`D:\Development\npm-global`**, not the
usual `%APPDATA%\npm`. That matters: `config/machine.json` points PM2 at
`D:\Development\npm-global\node_modules\paperclipai\dist\index.js`, and the
ASUS's path (`C:\Users\ASUS\AppData\Roaming\npm\...`) is wrong here.

**Why Node 22 is pinned.** Node v26 on Windows crashes at process teardown
(libuv `UV_HANDLE_CLOSING`) *after* the tests have already passed, so
`ops-watcher/run-all-tests.mjs` scores a passing suite as a failure. Measured on
this machine: v26 gave 59/62, v22.14.0 gave 62/62. Always invoke the repo's
scripts with the absolute v22 path.

---

## Installed during this session

### 1. PostgreSQL 16.15-3

| | |
|---|---|
| Why | Paperclip's board lives in Postgres. The ASUS runs 16, so the version must match for `pg_restore` to be clean. |
| How | EnterpriseDB installer, downloaded directly and run unattended. |
| Version | 16.15 (`psql (PostgreSQL) 16.15`) |
| Install prefix | `D:\PostgreSQL\16` |
| Data directory | `D:\PostgreSQL\16\data` |
| Port | **5433** (not the default 5432 — `config/paperclip-endpoint.json` expects 5433, matching the ASUS) |
| Service | `postgresql-x64-16`, StartType **Automatic**, so it survives a reboot with nobody logged in |
| Components | server + commandlinetools only. pgAdmin and StackBuilder deliberately disabled. |
| Installer kept at | `D:\AI\_installers\postgresql-16-x64.exe` (365,026,728 bytes) |

Commands:

```powershell
# winget's own download 403s from EDB, so fetch the installer directly
Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-16.15-3-windows-x64.exe" `
  -OutFile "D:\AI\_installers\postgresql-16-x64.exe" -UseBasicParsing

D:\AI\_installers\postgresql-16-x64.exe --mode unattended --unattendedmodeui none `
  --superpassword <see below> --serverport 5433 `
  --enable-components server,commandlinetools --disable-components pgAdmin,stackbuilder `
  --prefix "D:\PostgreSQL\16" --datadir "D:\PostgreSQL\16\data"
```

Two attempts failed before this one; recorded so nobody repeats them:

* `choco install postgresql16` — **the package does not exist** on the community
  feed. `postgresql16 not installed. The package was not found with the source(s) listed.`
* `winget install PostgreSQL.PostgreSQL.16` — resolves the package, then dies on
  the download: `Download request status is not success. 0x80190193 : Forbidden (403).`
  EDB refuses winget's request. The direct `Invoke-WebRequest` above works.

**Passwords.** Two were generated on this machine and are stored *only* here, in
files the repo's `.gitignore` already excludes via its `*password*` rule
(verified with `git check-ignore`):

* `config/postgres-superuser-password.local.txt` — the `postgres` superuser
* `config/paperclip-db-password.local.txt` — the `paperclip_founderos_aidit` role

Neither is committed, neither is in `.env.local`, and neither came from the ASUS.
If these files are lost the role password can be reset with
`ALTER ROLE ... PASSWORD`, but the Paperclip instance config that embeds it must
be updated at the same time.

**Undo:** `D:\PostgreSQL\16\uninstall-postgresql.exe --mode unattended`, then
delete `D:\PostgreSQL\16`. That destroys the restored board — take a `pg_dump`
first.

#### Database restored

`D:\paperclip.dump` (3,255,877 bytes, pg_dump custom format, dumped 2026-09-04
13:36 from `paperclip_founderos_aidit` on PostgreSQL 16.15).

```bash
psql -h 127.0.0.1 -p 5433 -U postgres \
  -c "CREATE ROLE paperclip_founderos_aidit LOGIN PASSWORD '<generated>' CREATEDB;"
psql -h 127.0.0.1 -p 5433 -U postgres \
  -c "CREATE DATABASE paperclip_founderos_aidit OWNER paperclip_founderos_aidit;"
pg_restore -h 127.0.0.1 -p 5433 -U postgres -d paperclip_founderos_aidit \
  --no-owner --role=paperclip_founderos_aidit --exit-on-error "D:\paperclip.dump"
```

Exit 0, no errors. **The database name was deliberately NOT renamed** to
`paperclip_aidit_os`: the dump carries `paperclip_founderos_aidit`, renaming buys
nothing, and it adds a way for the restore to half-succeed.
`config/paperclip-endpoint.json` still names `paperclip_founderos_aidit` and is
therefore consistent.

Row counts verified after restore, not assumed:

| table | rows |
|---|---|
| issues | **82** |
| issue_comments | 269 |
| agent_wakeup_requests | 35,190 |
| activity_log | 800 |
| heartbeat_run_events | 288 |
| heartbeat_runs | 65 |
| documents | 22 |
| agents | 17 |
| labels | 10 |
| companies | 1 (`kolega corp`, `a7011f31-8891-4581-b8fb-bbda8ac6a890` — matches `config/paperclip-endpoint.json`) |

Issue statuses: 32 done, 20 backlog, 16 todo, 12 cancelled, 1 in_review,
1 in_progress. **KOL-66 and KOL-78 both survived the restore** and were checked
by identifier, not inferred from the count.

The briefing said 78 issues; the restore holds 82. That is the ASUS's board
having moved on between the briefing and the dump, not a restore fault — the dump
header timestamp is later than the briefing.

### 2. graphify (Python CLI) — REPAIRED, not freshly installed

`graphify.exe` was already on PATH at `C:\Users\WIN10\.local\bin\graphify.exe`
but was a **broken uv trampoline**: every invocation, including `--version`,
answered `error: uv trampoline failed to canonicalize script path`. Its backing
environment was gone (`C:\Users\WIN10\.local\share\uv\tools\` did not exist and
`uv tool list` showed only `skillspector`).

```bash
uv tool install --force --upgrade graphifyy
```

Version now **0.9.53** (was pinned to a dead 0.9.43 environment). Heartbeat
step 15 depends on this, and the graph build depends on it, so this was blocking
rather than cosmetic.

`uv tool install` without `--force` refuses with
`error: Executables already exist: graphify-mcp.exe, graphify.exe`; `--force` is
required to overwrite the orphaned trampolines.

Two warnings it now prints, left alone deliberately (they touch skills outside
this repo):

```
warning: skill at C:\Users\WIN10\.claude\skills\graphify is from graphify 0.9.43, package is 0.9.53.
warning: skill at C:\Users\WIN10\.agents\skills\graphify is from graphify 0.9.43, package is 0.9.53.
```

**Undo:** `uv tool uninstall graphifyy`.

**Known gap, not closed:** 2 `.sql` files contribute nothing to the graph because
`tree_sitter_sql` is missing. `pip install "graphifyy[sql]"` would fix it. Left
undone because nothing in the current dispatch path scopes to `.sql`.

### 3. npm global packages

```bash
npm install -g pm2 paperclipai hermes-agent @ast-grep/cli
```

Landing in `D:\Development\npm-global\node_modules`.

| package | why |
|---|---|
| `pm2` | supervises the three long-lived daemons; `ops-watcher/ecosystem.config.cjs` is its config |
| `paperclipai` | the board server itself |
| `hermes-agent` | the GIBRAN lane. Before this, `probeLaneAvailability("nous")` reported `exit_1 binary not responsive`, a real failure that looked like a lane outage |
| `@ast-grep/cli` | AST-based search **and rewrite**, so structural edits stop being sent to a lane at all |

**Undo:** `npm uninstall -g <name>`.

### 4. SOPS 3.13.3 and age

```powershell
winget install --id SecretsOPerationS.SOPS -e --silent
winget install --id FiloSottile.age -e --silent
```

Both land as shims in `C:\Users\WIN10\AppData\Local\Microsoft\WinGet\Links`.
`sops --version` reports `sops 3.13.3 (latest)`; `age` and `age-keygen` are both
present.

Recorded honestly: **the binaries are installed, the practice is not adopted.**
There is no `.sops.yaml`, no age key at `~/.config/sops/age/keys.txt`, and no
secret in this repository is encrypted. Adopting SOPS means encrypting the
owner's Telegram bot token into the repo, and credentials are explicitly his
line, not an agent's. It is raised for him rather than done.

A dead end worth recording: the winget id is **`SecretsOPerationS.SOPS`**.
`Mozilla.SOPS` — the name most documentation still uses — returns
`No package found matching input criteria`; the project moved out of Mozilla.

### 5. bun 1.4.0 and gbrain 0.48.2.0

`gbrain`'s own documentation says to install it with bun and explicitly *not*
with `npm install -g gbrain`, so bun came first.

```powershell
winget install --id Oven-sh.Bun -e --silent
bun install -g github:garrytan/gbrain     # 188 packages, ~415s
```

bun lands in the WinGet Links shim directory; gbrain lands at
`C:\Users\WIN10\.bun\bin\gbrain.exe`. bun warned that its global bin folder was
not on PATH — see the PATH section below, which fixes that for good.

`bun pm -g untrusted` reports 1 blocked postinstall. Left blocked: nothing so far
needs it, and unblocking a postinstall is a decision, not a default.

### 6. `ollama pull nomic-embed-text`

The embedding model the gbrain-curator heartbeat step uses. 274 MB,
id `0a109f422b47`. Pulled into the existing Ollama at `D:\Ollama`.

Note: `ollama list` was EMPTY before this. HATTA's `glm-5.3:cloud` is a *cloud*
model served through the Ollama daemon, so it never appears in `ollama list` and
its absence there is not a fault. It was verified working by a real one-shot chat
call against `http://localhost:11434/api/chat`, not by reading the list.

### 7. GitHub Actions self-hosted runner 2.337.0, as a Windows service

```powershell
# registration token, scoped and short-lived
gh api -X POST repos/copperhead666-trading/aidit-os/actions/runners/registration-token --jq .token

cd C:\actions-runner
.\config.cmd --unattended --url https://github.com/copperhead666-trading/aidit-os `
  --token <token> --name lenovo-black --labels self-hosted,windows,x64,lenovo-black `
  --work _work --runasservice --windowslogonaccount "NT AUTHORITY\NETWORK SERVICE" --replace
```

| | |
|---|---|
| Install dir | `C:\actions-runner` |
| Zip kept at | `D:\AI\_installers\actions-runner-win-x64-2.337.0.zip` |
| Service | `actions.runner.copperhead666-trading-aidit-os.lenovo-black` |
| Runs as | `NT AUTHORITY\NETWORK SERVICE`, delayed automatic start |
| Labels | `self-hosted`, `Windows`, `X64`, `lenovo-black` |

Verified from GitHub's side, not just locally:
`lenovo-black | online | busy=false | self-hosted,Windows,X64,lenovo-black`.

**Undo:** `cd C:\actions-runner && .\config.cmd remove --token <a fresh removal
token>`. That removes the Windows service and de-registers the runner. Delete
`C:\actions-runner` afterwards.

### 8. PM2 boot persistence

The daemons must come back after a reboot **with nobody logged in**, so PM2 is
resurrected by a scheduled task running as SYSTEM rather than by a user login.

| | |
|---|---|
| `PM2_HOME` | `D:\pm2home`, set **machine-wide** so the SYSTEM daemon and an interactive `pm2` see the same state |
| Boot script | `D:\pm2home\pm2-boot.cmd` (sets PM2_HOME, cd to the repo, `pm2 resurrect`) |
| Task | `AiditOS-PM2-Resurrect`, AtStartup, `SYSTEM` / ServiceAccount / Highest |
| Restart policy | 3 retries, 1 minute apart; no execution time limit |

Proven, not assumed: the task was run once on demand and reported
`LastTaskResult 0`. It was a deliberate no-op — there is no `dump.pm2` yet,
because **nothing has been `pm2 save`d**. That is the ordering rule: PM2 must not
start locally until the owner has shut the ASUS down, since one Telegram bot
token cannot serve two long-pollers (both get HTTP 409). Registering the task now
starts nothing.

**Undo:** `Unregister-ScheduledTask -TaskName "AiditOS-PM2-Resurrect"`, then
remove the machine-wide `PM2_HOME` variable and delete `D:\pm2home`.

### 9. Machine-wide PATH additions

This one is easy to miss and would have broken the reboot proof silently. Every
tool the daemons call was on the **user** PATH only, and a task running as SYSTEM
does not get the interactive user's PATH. The heartbeat's gbrain-curator step
would have failed with "gbrain not found" after every reboot, and the GIBRAN lane
probe would have reported a false outage.

Appended to the **Machine** PATH:

```
C:\Users\WIN10\.bun\bin                              (bun, gbrain)
D:\Development\npm-global                            (pm2, paperclipai, hermes, ast-grep)
D:\Ollama                                            (ollama)
D:\PostgreSQL\16\bin                                 (psql, pg_dump, pg_restore)
C:\Users\WIN10\AppData\Local\Microsoft\WinGet\Links  (sops, age)
C:\Users\WIN10\.local\bin                            (graphify, uv)
D:\aidit-node\node-v22.14.0-win-x64                  (the pinned Node 22)
```

**Undo:** remove those seven entries from the Machine PATH. Nothing else on the
machine depends on them being there — they were all user-PATH-only before.

### 10. Claude Code skills

Only two, deliberately: **graphify** and **impeccable**. Every installed skill is
billed on every turn, which is why this list is small on purpose and must stay
small.

---

## Not installed, and why

Listed so the gap is visible rather than discovered later.

* **`tree_sitter_sql`** for graphify — see the graphify entry above. 2 `.sql`
  files contribute nothing to the graph without it.
* **SOPS adoption** (as opposed to the binary) — see entry 4. Encrypting the
  owner's credentials into the repo is his decision, not an agent's.

---

## Reversal order

If this machine has to be returned to how it was found, undo in this order so
nothing is left pointing at something that no longer exists:

1. `tailscale funnel --https=443 off` — stop publishing the cockpit to the
   internet BEFORE stopping the thing behind it, so nothing is ever exposed
   pointing at a dead port
2. `Unregister-ScheduledTask -TaskName "AiditOS-PM2-Resurrect"` — otherwise the
   next boot tries to resurrect processes whose files are about to be removed
3. `pm2 delete all && pm2 kill` (stop the daemons before removing what they run)
4. GitHub Actions runner:
   `cd C:\actions-runner && .\config.cmd remove --token <a fresh removal token>`
   (removes the Windows service and de-registers the runner), then delete
   `C:\actions-runner`
5. `npm uninstall -g pm2 paperclipai hermes-agent @ast-grep/cli`
6. `uv tool uninstall graphifyy`, `bun uninstall -g gbrain`
7. `winget uninstall SecretsOPerationS.SOPS`, `winget uninstall FiloSottile.age`,
   `winget uninstall Oven-sh.Bun`
8. `ollama rm nomic-embed-text`
9. `pg_dump` the board first, then
   `D:\PostgreSQL\16\uninstall-postgresql.exe --mode unattended`, then delete
   `D:\PostgreSQL\16`
10. Remove the seven Machine PATH entries listed in section 9, and the
    machine-wide `PM2_HOME` variable
11. Delete `D:\AI\_installers`, `D:\AI\worktrees`, `D:\pm2home`, and the two
    `config/*password*.local.txt` files
12. Leave `.env.local` alone — it is the only copy of the Telegram bot token on
    this machine and it is gitignored, so nothing can restore it
