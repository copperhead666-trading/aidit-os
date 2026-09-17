# TAHAP 0 — Persiapan (2026-09-17)

## Yang dikerjakan
1. Folder `docs/reports/` dan `docs/reports/backups/2026-09-17/` dibuat.
2. Prompt otonom disalin ke `docs/reports/PROMPT_OTONOM.md` (sumber: `C:\Users\WIN10\Downloads\PROMPT_OTONOM_AIDIT_OS_V5.md`).
3. Checkpoint dimulai: `docs/reports/_checkpoint.md`.
4. Batas iterasi Hermes: `agent.max_turns` sudah 150 (diubah di sesi sebelumnya sesuai Langkah 0 prompt Fase 0).
   - Bukti: `hermes config get agent.max_turns` → `150`.
   - Cadangan: `C:\Users\WIN10\AppData\Local\hermes\config.yaml.bak-2026-09-17`.
5. Branch `fix/v5-recovery` dibuat dari `v5` (commit 23d8a6d) dan di-checkout.
   - Bukti: `git branch --show-current` → `fix/v5-recovery`.

## Foto kondisi awal (±16.05 WIB)
| Item | Nilai |
|---|---|
| Disk C: | sisa 10,4 GB dari 80,2 GB |
| Disk D: | sisa 13,3 GB dari 192,7 GB |
| Disk E: | sisa 18,7 GB dari 192,7 GB |
| RAM | 7,1 GB terpakai dari 9,9 GB (72%) |
| node.exe | 11 proses |
| PM2 | aidit-v5 online · telegram online · paperclip-v5 online · pm2-logrotate online · conductor STOPPED · ops STOPPED |
| git status v5 | modified: AGENTS.md, CLAUDE.md · untracked: docs/audit, docs/reports, docs/verification, `nul` |
| worktree v5 | 11 internal (aid-5 s/d aid-56) di `state/workspaces/internal` |
| worktree v4 | `D:\AI\Aidit OS` (main cef55b2) + 12 lane/dept di `D:\AI\worktrees` + ±20 `_scratch-task-worktrees` |

## Catatan penting (ditemukan saat pengukuran)
- `D:\aidit-uv-tools` (178 MB) BUKAN cache uv biasa: itu venv tool `graphifyy` yang menyediakan `graphify-mcp` (dipakai `.mcp.json` v5, bukti: `uv-receipt.toml`). Jangan dihapus.
- `D:\AI\aidit-os-v5\.next` (230 MB) sedang dipakai app PM2 `aidit-v5` (`next start -p 4200`, bukti: `ops/pm2-launch-web.cjs` baris 10, port 4200 LISTENING PID 12628). Jangan dihapus.
- Ukuran kandidat arsip: v4 `_scratch-*` node_modules ±671 MB, `D:\AI\worktrees` 409 MB, `E:\Temp` 350 MB, sjs frontend nm 554 MB, cockpit nm 290 MB, aid-18 nm 374 MB, log PM2 lama 154 MB.

## Status
✅ Tahap 0 selesai. Lanjut Tahap 1.
