# TAHAP 2 — Hidupkan Orkestrator (2026-09-17)

## Diagnosa exit 1 (penyebab pasti, ada bukti)
`D:\pm2home\logs\conductor-error.log` (16 Sep 08:22):
```
Error: claude.cmd tidak ditemukan di PATH
    at resolveClaudeBin (conductor/lib.mjs:183)
    at async askClaude (conductor/claude.mjs:16)
    at async tick (conductor/run.mjs:263)
```
Dua lapis masalah:
1. `resolveClaudeBin()` melempar error saat `where claude.cmd` gagal di env PM2.
2. Tick PERTAMA di `main()` tidak dibungkus try/catch — error apa pun langsung `process.exit(1)`.

## Perbaikan (branch fix/v5-recovery, commit a195cd3)
1. `conductor/lib.mjs`: fallback jalur absolut `D:/Development/npm-global/node_modules/@anthropic-ai/claude-code/bin/claude.exe` (terverifikasi ada di mesin).
2. `conductor/run.mjs`: tick pertama dibungkus try/catch — error dicatat ke ledger, loop tetap jalan.
3. `conductor/lanes.mjs` (probe): lane `or-*` (provider openrouter) kini diprobe ke `https://openrouter.ai/api/v1/models`, BUKAN ke Ollama 127.0.0.1:11434. Ini akar temuan audit "lane or-* memanggil ollama.com": probe menyamaratakan semua lane hermes-cli ke Ollama.
4. `conductor/claude.mjs` (askGlm): fallback OpenRouter (`z-ai/glm-5.2:free`, chat/completions + json_schema) bila Ollama gagal — Ollama lokal terbukti MATI (port 11434 tidak listen; `curl` timeout). Key dari env `WORKER_POOL_OPENROUTER_API_KEY` (tidak pernah ditampilkan).
5. `config/lanes.json`: glm-52, glm-51, glm-53-flash → `disabled` + alasan (Ollama mati & akan dilepas owner). gpt-6-astra & kimi sudah disabled sebelumnya (tetap).

## Runtime Node
PM2 shim (`ops/pm2-launch-node22.cjs`) sudah memakai `D:/aidit-node/node-v22.14.0-win-x64/node.exe` untuk semua app conductor/telegram/ops — tidak perlu perubahan. Node v26 sistem tidak di-uninstall.

## DNS/internet
- `openrouter.ai` → 104.18.2.115, HTTPS 200 (bukti: curl).
- `ollama.com` → 34.36.133.15 (resolusi OK; error 16 Sep adalah koneksi abort, bukan DNS).
- Ollama LOKAL mati: port 11434 tidak listen.

## Rename
- PM2 app `conductor` → **`orkestrator`** (ecosystem.config.cjs; `pm2 delete conductor` + start baru; `pm2 save`). Folder kode tetap `conductor/` agar state/log tidak putus — dicatat sebagai utang kosmetik Fase 1.
- Ahmad → **Jarvis**: persona di config/company.json sudah `JARVIS`; satu-satunya "Ahmad" tersisa adalah `botUsername: ahmadsuperbot` (username Telegram asli, bukan nama tampilan) dan nama env `TELEGRAM_BOT_TOKEN_AHMAD` (sengaja TIDAK diubah — garis merah secret). Nama tampilan bot diubah Aidit via BotFather.

## Dead-man switch (commit 49b6bc5 + gate)
- `ops/deadman.mjs` — deterministik, non-LLM. Cek tiap jalan: Orkestrator online di PM2, disk C/D/E ≥ 10%. Alert Telegram max 1/masalah/jam (`state/deadman-alerts.json`). ChatId fallback dari company.json (env kosong).
- Scheduled task Windows `AiditOS-DeadmanSwitch` tiap 5 menit (bukti: `schtasks /Query` → Ready, next run 17:04).
- Worker gate: saat Orkestrator mati, deadman menulis `state/orkestrator-down.flag`; `runOnLane()` menolak semua tugas baru dengan `orkestrator down: worker gate closed`.
- **TES NYATA DILAKUKAN**: `pm2 stop conductor` → deadman mendeteksi, alert Telegram TERKIRIM (sent:1), flag dibuat, `runOnLane('or-gemma-free')` ditolak gate. `pm2 start` → status online, flag hilang, cooldown mencegah spam (sent:0 untuk masalah sama). 

## Status akhir PM2 (pm2 save sudah)
orkestrator ONLINE (restarts 0), ops ONLINE, telegram, paperclip-v5, aidit-v5, pm2-logrotate ONLINE.
Probe ops terbaru: claude-sonnet/opus ready, gpt-5.5 ready, semua or-* ready, glm-* disabled. Disk free 13,3 GB, dashboard 200.

## Verifikasi
- `node conductor/run.mjs --once --dry` → ok:true, keputusan terbaca.
- `npm test` (Node 22): 970/972 lulus; 2 gagal di run penuh karena timeout 5s saat HDD sibuk — keduanya LULUS saat dijalankan terpisah. `npm run typecheck` bersih.

## Tindak lanjut protokol
Tahap 3–7 didaftarkan ke Paperclip sebagai issue AID-71..AID-75 (project internal, status backlog, deskripsi Prompt Matrix 8 unsur).
