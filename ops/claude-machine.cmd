@echo off
REM PRD v5.1 s2b/s3/s6 step 6: log the MACHINE Claude account
REM (pusatberasmurah@gmail.com, weekly reset Thu 2026-09-17 06:00 WIB) into
REM its own isolated config dir, separate from the orchestrator's ~/.claude
REM (adityainofficial@gmail.com, fresh). Run this by hand Thursday morning:
REM   ops\claude-machine.cmd
REM It only sets the env var for this process and calls `claude auth login`
REM interactively — after login, conductor/ops PM2 processes pick up the
REM same CLAUDE_CONFIG_DIR from ecosystem.config.cjs automatically.
set CLAUDE_CONFIG_DIR=D:\aidit-claude-machine
claude auth login
echo.
echo Selesai. Cek dengan: set CLAUDE_CONFIG_DIR=D:\aidit-claude-machine ^&^& claude auth status
