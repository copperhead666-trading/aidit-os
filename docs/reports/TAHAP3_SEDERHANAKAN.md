# TAHAP 3 — Sederhanakan (2026-09-17)

## Lane jadi 4 aktif
**Keputusan owner**: (1) Claude Sonnet/Opus (keputusan & review), (2) gpt-5.5 Codex (coding rutin), (3) or-deepseek-flash (harian murah), (4) or-nemotron-free (cadangan gratis stabil).

Lane lain (`or-laguna-free`, `or-gemma-free`, `or-glm52-free`, `or-glm53-flash`, `or-qwen-coder`, `or-kimi-k27`) → `disabled` + alasan. Tidak dihapus. File `config/lanes.json`. Probe terbaru: 4 lane active ready.

## Prompt Matrix
- `docs/standards/PROMPT_MATRIX.md` — 8 unsur wajib (Peran, Tujuan, Konteks, Batasan, Langkah, Format output, Kriteria selesai, Eskalasi) + template + contoh.
- `conductor/guard.mjs`: `validatePromptMatrix(text)` — export fungsi validasi; cek 8 marker.
- `conductor/lanes.mjs` `runOnChain()`: tolak packet yang missing salah satu unsur (ledger `prompt-matrix.reject`). Packet head.mjs yang ada lolos karena mengandung marker yang match.

## Paperclip dobel
Hanya SATU instance Paperclip di port 3120 (PID 1488). Yang dianggap "dobel" di audit adalah app web aidit-v5 di port 4200. Tidak ada duplikat yang perlu dinonaktifkan.

## Rotasi ledger
- `conductor/lib.mjs`: `ledgerTail(n)` baca 256 KB terakhir saja (bukan file penuh). `ledgerRotate(maxBytes)` potong dan kompres .gz bila melewati threshold.
- `conductor/ops.mjs tick()`: panggil rotasi tiap siklus ops (ledger saat ini 627 KB < 5 MB, belum trigger).

## Ruflo/Claude-flow MCP dinonaktifkan
Blok `claude-flow` dipindah dari `mcpServers` ke `_disabledMcpServers` di `.mcp.json`. Dokumentasi disimpan di `docs/standards/MCP_RUFLO_ARCHIVE.md`. Alasan: daemon tidak jalan, versi @latest tidak di-pin, npx berisiko.

## Skill duplication (dicatat, tidak dihapus)
Skills terpasang di Hermes: superpowers (framework, masuk akal), impeccable, caveman, ruflo+ruflo-doctor (tapi MCP ruflo sudah dimatikan). Tumpang tindih kecil; hanya ruflo/ruflo-doctor patut dievaluasi. Diusulkan di laporan, tidak dihapus di tahap ini.

## Orkestrator tick berfungsi
Rantai fallback model: glm-5.2:free (429) → deepseek-v4-flash (paid, cheap, OK) → nemotron-free → gemma-4-free. Tick pertama gagal karena code lama di cache, tick kedua setelah PM2 restart sukses (ok:true). URL routineModel menjadi deepseek/deepseek-v4-flash sebagai fallback berbayar.

## AGENTS.md & CLAUDE.md
Tidak diubah (terproteksi, persetujuan timeout). Diusulkan di laporan agar Aidit menambahkan 1 baris rujukan ke PROMPT_MATRIX.md.

## Type check & test
972/972 lulus (Node 22). Typecheck bersih.

## Status
- Paperclip tetap online.
- Bot Telegram tetap online.
- PM2: orkestrator, ops, aidit-v5, paperclip-v5, telegram, pm2-logrotate online.