@echo off
REM Log the MACHINE codex-cli account into its own isolated config dir,
REM separate from the orchestrator's own %USERPROFILE%\.codex. Mirrors
REM ops/claude-machine.cmd's pattern. Run by hand:
REM   ops\codex-machine.cmd
REM After login, paperclip-v5 and conductor PM2 processes pick up the same
REM CODEX_HOME from ecosystem.config.cjs automatically (commit d2c89bf) --
REM no restart needed for the login itself to take effect on the next call.
set CODEX_HOME=D:\aidit-codex-machine
codex login
echo.
echo Selesai. Cek dengan: set CODEX_HOME=D:\aidit-codex-machine ^&^& codex login status
