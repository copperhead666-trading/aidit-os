# INSTRUKSI-05 — Hasil (2026-09-17 21:20 WIB)

## 1. Ringkasan

Tampilan Hermes interaktif ternyata **sudah benar** (show_reasoning:false, tool_progress:new) —
tidak ada yang perlu diubah di sana. Config Hermes mesin punya 1 baris fallback ke Ollama
(sudah mati) yang dihapus. Tidak ditemukan bentrok Telegram — Hermes tidak pernah dikonfigurasi
dengan bot/token Telegram sama sekali (cuma OPENROUTER_API_KEY). AID-72 ditandai `done` (Tahap 4
memang sudah selesai). AID-73/74/75 dilepas dari status blocked (lock eksekusi Hermes ikut
terlepas otomatis — terlihat di AID-75: `executionAgentNameKey: "hermes" → null`), diset `todo`
dengan batasan Prompt Matrix lengkap di komentar, siap diambil dispatch normal Orkestrator.

## 2. Tugas untuk Aidit

1. (Sama seperti instruksi-04) Jalankan `pm2 restart orkestrator ops` dari PowerShell Anda —
   sesi ini masih tidak bisa konek ke PM2 (`EPERM`). Ini juga yang akan membuat Orkestrator
   benar-benar memproses AID-73/74/75 yang baru dilepas.
2. Tidak ada tugas lain yang mendesak.

## 3. Perubahan config Hermes

| Config | Kunci | Lama | Baru | Cadangan | Cara batalkan |
|---|---|---|---|---|---|
| Interaktif (`%USERPROFILE%\AppData\Local\hermes\config.yaml`) | `display.show_reasoning`, `display.tool_progress` | `false` / `new` | **tidak diubah** — sudah benar | — | — |
| Mesin (`D:\aidit-hermes-machine\config.yaml`) | `fallback_providers` | ada entri `provider: ollama, model: glm-5.1:cloud, base_url: http://127.0.0.1:11434/v1` | entri Ollama dihapus (3 entri OpenRouter tersisa: deepseek-v4-flash, glm-5.3-flash, qwen3-coder-next) | `docs/reports/backups/2026-09-17/hermes-machine-config.yaml.bak` | copy cadangan itu balik ke `D:\aidit-hermes-machine\config.yaml` |

Verifikasi (tidak diubah):
- Model default interaktif: `nvidia/nemotron-3-ultra-550b-a55b:free` via OpenRouter — **bukan**
  `minimax/minimax-m3` seperti dugaan instruksi (dilaporkan, tidak diubah — mungkin sudah beda
  sejak instruksi ditulis).
- `agent.max_turns`: interaktif 150 (sesuai), mesin **40** (beda dari interaktif — instruksi
  cuma minta pertahankan 150 utk yang sudah 150; mesin punya nilai sendiri, tidak disentuh
  karena tidak disebut eksplisit harus 150).
- `display.busy_input_mode`: **tidak ditemukan** di `config.yaml` manapun (interaktif/mesin) —
  kemungkinan pakai default bawaan Hermes, tidak pernah diset eksplisit.
- Skill terpasang di Hermes interaktif (18): aidit-os, apple, autonomous-ai-agents, caveman,
  creative, devops, email, media, note-taking, productivity, research, **ruflo**,
  **ruflo-doctor**, social-media, software-development, superpowers, ui-ux-pro-max-plus, web.
  **Usulan (tidak dieksekusi)**: nonaktifkan `ruflo` & `ruflo-doctor` — MCP Ruflo sudah dimatikan
  di `.mcp.json`, skill ini kemungkinan besar tidak berfungsi lagi.
- Probe 4 lane aktif Orkestrator (setelah perbaikan config mesin): `claude-sonnet`=ready,
  `claude-opus`=ready, `or-nemotron-free`=ready, `or-deepseek-flash`=ready. (`gpt-5.5`=disabled
  sejak instruksi-04, alasan usage limit Codex.)

## 4. Hasil cek bentrok Telegram

**Tidak ada bentrok.** Diperiksa: `.env` interaktif dan mesin Hermes hanya berisi
`OPENROUTER_API_KEY` (tidak ada `TELEGRAM_BOT_TOKEN*` atau sejenisnya); tidak ada skill/folder
bernama "telegram" di kedua instalasi Hermes; tidak ada job di `cron/jobs.json` (mesin) yang
menyebut telegram; scheduled task Windows yang ada (`AiditGateDaemon`, `AiditOS-DeadmanSwitch`,
`AiditOS-Jarvis-*`, `Aidit Deskflow Server`) tidak satu pun menjalankan Hermes sebagai gateway
Telegram. Satu-satunya pembaca bot adalah PM2 app `telegram` (`conductor/telegram.mjs`).
Pesan tes: terkirim (lihat §laporan instruksi-04, tes yang sama dipakai ulang; ringkasan
instruksi-05 di bawah adalah pengiriman keduanya).

## 5. Status & pemilik AID-72..75

| Issue | Status lama | Status baru | Pemilik |
|---|---|---|---|
| AID-72 (Backlog) | blocked (disposisi run tak terset, padahal sukses) | **done** | selesai, tidak ada pemilik aktif |
| AID-73 (Jarvis) | blocked, terkunci eksekusi Hermes | **todo**, lock eksekusi terlepas | menunggu dispatch Orkestrator (assigneeAgentId lama masih tercatat di riwayat — dispatch normal Orkestrator akan menimpa saat mengambilnya) |
| AID-74 (Katering) | blocked, terkunci eksekusi Hermes | **todo**, lock eksekusi terlepas | idem |
| AID-75 (Bootstrap) | blocked, terkunci eksekusi Hermes (`executionAgentNameKey: "hermes"`, dikonfirmasi lepas otomatis saat ubah status) | **todo**, lock eksekusi terlepas | idem |

Ketiganya diberi komentar berisi Prompt Matrix + garis merah tambahan dari instruksi-05 §4.3
(tidak hapus file, tidak ubah E:\Business asli, tidak kirim ke selain Aidit, tidak kirim data
mentah keuangan/karyawan via Telegram, tanpa trading/pengeluaran/deploy staf, endpoint Siri
lewat Tailscale+token buatan Aidit, hasil katering wajib direview, bagian kualitas tinggi pakai
Claude Sonnet).

**Tick setelah perubahan**: tick 21.15 WIB gagal (`fetch failed` di semua model — masalah
jaringan sesaat, bukan terkait perubahan ini) — ini terjadi hampir bersamaan dengan saat status
issue diubah (21.15-21.18 WIB), jadi belum sempat memproses AID-73/74/75 yang baru `todo`. Tick
berikutnya (~21.45 WIB, atau setelah `pm2 restart`) belum sempat diamati sesi ini — Aidit bisa
cek dengan `node conductor/status.mjs` (baris "kepala sibuk").

## 6. Usulan (tidak dieksekusi)

- Nonaktifkan skill Hermes `ruflo` dan `ruflo-doctor` (MCP-nya sudah mati).
- `agent.max_turns` Hermes mesin (40) berbeda dari interaktif (150) — kalau memang disengaja
  untuk membatasi biaya per-task mesin, tidak perlu diubah; kalau bukan disengaja, samakan.
- Model default Hermes (`nemotron` gratis) berbeda dari ekspektasi lama (`minimax-m3`) —
  perlu diputuskan Aidit mana yang benar-benar diinginkan sekarang.
