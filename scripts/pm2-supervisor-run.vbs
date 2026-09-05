' FounderOS PM2 Supervisor headless launcher, mirrors C:\Users\ASUS\.founderos\founderos-run.vbs and C:\Users\ASUS\.paperclip\paperclip-run.vbs
' The 0 is the window style and is the whole point of this wrapper: it runs the
' .cmd with NO window. Path updated 2026-09-05 for the repository's move.
CreateObject("WScript.Shell").Run """D:\AI\Aidit OS\scripts\pm2-supervisor-run.cmd""", 0, False
