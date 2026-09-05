@echo off
rem Headless launcher so the scheduled task can be launched hidden through the .vbs.
rem Paths updated 2026-09-05: the repository moved to D:\AI\Aidit OS and
rem C:\nvm4w\nodejs\node.exe no longer exists on this machine. Both old paths
rem were dead, so this launcher would have opened a console on a path that is
rem not there — the node binary below is the one the boot task already uses.
cd /d "D:\AI\Aidit OS"
"D:\aidit-node\node-v22.14.0-win-x64\node.exe" "D:\AI\Aidit OS\ops-watcher\pm2-supervisor.mjs" --once >> "D:\AI\Aidit OS\ops-watcher\pm2-supervisor-task.log" 2>&1
