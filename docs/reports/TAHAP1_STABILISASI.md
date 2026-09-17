# TAHAP 1 — Stabilisasi Mesin TANPA Menghapus (2026-09-17)

## Arsip dibuat di `E:\AIDIT-ARSIP\2026-09-17\` (semua lolos `tar -tzf`)
| Arsip | Ukuran | Isi | Verifikasi | Data sensitif? |
|---|---|---|---|---|
| aidit-os-v4.tar.gz | 840 MB | `D:\AI\Aidit OS` tanpa node_modules/.next/_scratch | ✅ 20.975 entri | YA (config v4, mungkin ada kredensial lokal) |
| scratch-v4.tar.gz | 576 MB | `_scratch-dispatch-gate`, `_scratch-task-worktrees` tanpa node_modules | ✅ | Tidak yakin |
| worktrees.tar.gz | 60 MB | `D:\AI\worktrees` (14 worktree lane/dept) tanpa node_modules | ✅ | Tidak |
| etemp.tar.gz | 75 MB | `E:\Temp` | ✅ (warning "file changed" — file temp aktif saat dibaca; arsip tetap valid) | Tidak |
| workspaces-internal-v5.tar.gz | 55 MB | `state\workspaces\internal` v5 (11 worktree aid-*) tanpa node_modules | ✅ | Tidak |
| pm2-logs-lama.tar.gz | 3,6 MB | log PM2 kecuali file aktif hari ini | ✅ | Tidak |

Catatan: TIDAK ADA yang dihapus (garis merah prompt otonom). Arsip ini siap di-backup manual oleh Aidit.
**Penting**: arsip berisi data bisnis sebaiknya dibungkus 7-Zip + password oleh Aidit sebelum diunggah ke Google Drive.

## Perubahan sistem (semua bisa dibatalkan)
1. **Startup dimatikan** (registry HKCU Run; cadangan: `docs/reports/backups/2026-09-17/hkcu-run.reg`): Discord, Notion, Edge auto-launch. GoogleDriveFS TETAP (dilarang disentuh). Cara membatalkan: double-click file .reg cadangan.
2. **Startup Ollama** (`Startup\Ollama.lnk`): TIDAK dihapus dari folder Startup karena folder Startup tidak punya cadangan registry; Ollama sudah tidak jalan anyway (port 11434 tidak listen). Tugas Aidit bila mau: hapus `Ollama.lnk` dari `shell:startup`.
3. **Defender exclusion ditambah** (admin tersedia, berhasil): `D:\AI\aidit-os-v5\node_modules`, `.next`, `state\workspaces`. Cara membatalkan: `Remove-MpPreference -ExclusionPath <path>`.
4. **Proses legacy dihentikan**: PID 13092 (`aidit.mjs daemon` v4 dari `_scratch-dispatch-gate`, induk cmd.exe 4392) — bukan milik PM2, daemon v4 yang tertinggal. node.exe: 11 → 9.
5. **git config user.name** repo v5 → `Aidit OS Orkestrator` (lokal saja; bukti: `git config user.name`). Email tidak diubah (belum diberi). Cara membatalkan: `git config user.name SOEKARNO`.

## node.exe tersisa (semua teridentifikasi, tidak ada zombie)
PM2 daemon + 5 app shim + next-4200 + paperclip + telegram + hermes (sesi ini) + paperclip-mcp.

## Disk & RAM (sebelum → sesudah Tahap 1)
- C: 10,4 → 11 GB bebas · D: 13,3 → 14 GB · E: 18,7 → 17,5 GB (turun karena +1,65 GB arsip).
- RAM 72% → ±65%.

## DAFTAR USULAN PENGHAPUSAN (TIDAK dieksekusi — keputusan Aidit)
| Path | Ukuran | Aman? | Cara membuat ulang |
|---|---|---|---|
| `D:\AI\Aidit OS\ventures\sjs-superapps\frontend\node_modules` | 554 MB | Ya | `npm install` (package.json ada) |
| `D:\AI\aidit-os-v5\state\workspaces\internal\aid-18\node_modules` | 374 MB | Ya | `npm install` |
| `D:\AI\Aidit OS\cockpit\node_modules` + salinan di `_scratch-*` | 871 MB | Ya | `npm install` |
| Log PM2 lama di `D:\pm2home\logs` (86 file, sudah diarsipkan) | 154 MB | Ya | tidak perlu |
| `E:\Temp` (sudah diarsipkan) | 350 MB | Ya | tidak perlu |
| `D:\AI\worktrees\*` (14 worktree v4, sudah diarsipkan) | 409 MB | Ya* | *pakai `git worktree remove` + prune dari repo v4 |
| Recycle Bin | ±1,4 GB | Hati-hati | TIDAK bisa dikembalikan setelah dikosongkan |
| **JANGAN**: `D:\aidit-uv-tools` | 178 MB | TIDAK | venv graphify-mcp yang dipakai .mcp.json v5 |
| **JANGAN**: `D:\AI\aidit-os-v5\.next` | 230 MB | TIDAK | dipakai app aidit-v5 port 4200 (PM2 online) |

Total potensi ruang bebas bila semua usulan dijalankan: ±3,7 GB (D: ±2 GB, E: ±0,35 GB, Recycle Bin ±1,4 GB di drive campur).

## PM2 tetap hidup (kriteria selesai)
pm2-logrotate, aidit-v5, telegram, paperclip-v5 online sepanjang Tahap 1 (bukti: `pm2 jlist` di checkpoint).
