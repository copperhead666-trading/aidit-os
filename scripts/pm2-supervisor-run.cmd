@echo off
rem Headless launcher so the scheduled task can be launched hidden through the .vbs.
cd /d "D:\AI\Active FounderOS-Aidit"
"C:\nvm4w\nodejs\node.exe" "D:\AI\Active FounderOS-Aidit\ops-watcher\pm2-supervisor.mjs" --once >> "D:\AI\Active FounderOS-Aidit\ops-watcher\pm2-supervisor-task.log" 2>&1
