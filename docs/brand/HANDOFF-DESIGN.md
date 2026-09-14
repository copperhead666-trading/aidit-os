# HANDOFF — Pengerjaan Desain Aidit OS (untuk sesi berikutnya)

Ditulis 2026-09-12 WIB. Konteks sesi ini penuh → lanjutkan dari sini.

## 0. Tujuan besar
Level-up hasil desain Aidit OS ke kelas premium (senior visual designer). Bikin: (1) **logo Aidit OS**, (2) **brand kit / brand guideline lengkap**, (3) nanti **logo SJS SuperApps**, lalu (4) wire design-pipeline ke Aidit OS, lalu (5) **deck presentasi 5 bagian**. Desain = **selera owner** → selalu tawarkan opsi, jangan maksa; owner remote lewat HP (kirim visual ke Telegram).

## 1. METODE (WAJIB — jangan diulang salahnya)
- **JANGAN gambar logo dengan SVG tangan** (LLM hand-code path) → hasilnya generik/jelek, owner menolak berkali-kali.
- **PAKAI Canva AI** (akun Pro owner, MCP `mcp__claude_ai_Canva__*` sudah connect di sesi claude.ai). Alur:
  1. `generate-design` (design_type `logo`) dengan **prompt kompleks art-directed** (lihat standar).
  2. `create-design-from-candidate` (job_id + candidate_id) → dapat `edit_url` (buat owner export SVG) + design id.
  3. `export-design` (png, 800–2000px) → dapat URL S3 **presigned publik** → `curl` download → **Read/lihat buat kurasi**.
  4. Thumbnail `design.canva.ai/...` = 403 (butuh login) → JANGAN curl; pakai jalur export di atas.
- **Dapat SVG**: (a) owner buka `edit_url` di Canva → Download → SVG (fitur Pro), atau (b) **vectorize sendiri**: export hi-res → crop mark → `scripts/vectorize.mjs` (imagetracer via Playwright) → SVG bersih. Kedua terbukti jalan.
- **Standar prompt**: `docs/brand/DESIGN-PROMPT-STANDARD.md` — semua desain pakai prompt kompleks (format, konsep, komposisi, detail, palet hex, tekstur, tipografi, visual language, AVOID, final art direction).
- **Tool lain**: FLUX/Together AI = **OFF** (butuh deposit; akun owner read-only; no-new-spend). Recraft(vektor)/Ideogram = paid, belum di-set. Local diffusion = tak feasible (GPU AMD).

## 2. YANG SUDAH TERKUNCI
- **Arah brand = "Direction D — Rooted Command Deck"**: dark-tech base + aksen heritage.
  - Palet: charcoal `#0A0B0E`, panel `#14171E`, emerald `#1E5A46`, champagne gold `#C6A860`, ivory `#EFE7D6`, terracotta `#B0603A` (warning).
  - Font: **Sora** (display), **Inter** (body), **JetBrains Mono** (data/label).
- **Logo Aidit OS = konsep "Gerbang yang terbangun"** = monogram arsitektural: **bingkai geometris emerald + arch/gerbang emas naik** (struktur/OS + gerbang/fajar + naungan; komando di tangan pemilik). Ini mark "kiri-bawah" dari sampler yang owner lingkari.
- **Logo SJS SuperApps = trefoil (bulir emas + daun)** versi **5 DAUN** (emak owner 5 bersaudara; Sederhana Jaya 5 cabang). BELUM dikerjakan.
- **Visi:** "Satu founder, sekelas institusi." (+ kedaulatan: menuju AI/LLM milik sendiri.)
- **Misi:** "Mengubah niat jadi hasil terverifikasi; dioperasikan founder, bukan cuma engineer."
- **5 Nilai:** Amanah (stewardship) · Ketelitian (precision) · Ketenangan (calm under load) · Kedaulatan (sovereignty) · Berakar (rooted).

## 3. STATUS SEKARANG (titik lanjut)
Menunggu keputusan owner: **pilih 1 dari 4 logo art-directed (a1–a4) + cara SVG**. Preview + link sudah dikirim ke Telegram.

Kandidat logo Aidit OS (Canva, prompt art-directed) — design id + edit_url:
- **a1** kotak+gerbang bersih — `DAHU94rtpD4` — canva.com/d/rwQxRhbQl2lDfcL
- **a2** rumah/atap+arch (family) — `DAHU9_unB-0` — canva.com/d/opFMLGg413QpwgI
- **a3** rumah berundak (ramai) — `DAHU9wJS8C0` — canva.com/d/8wfS9DOoBTYy0rK
- **a4** kotak minimal near-black — `DAHU94dqJL4` — canva.com/d/WZC4iyiYReQB8Lz
- Lean supervisor: **a1 / a4**.

Aset yang sudah ada:
- `docs/brand/aidit-os-logo-mark.svg` — hasil vectorize mark asli "kiri-bawah" (faithful; masih ada noise trace ringan, perlu cleanup warna/transparan).
- `docs/brand/aidit-os-brand-guideline-v1.html` + `.png` — brand kit v1 (visi/misi/nilai/arti-logo/warna/tipografi/sistem-logo/do-don't). **CATATAN: v1 masih pakai mark SVG-tangan yang jelek → REBUILD jadi v2 pakai logo final terpilih.**
- `docs/brand/DESIGN-PROMPT-STANDARD.md`.

## 4. LANGKAH BERIKUTNYA (urut)
1. Terima pilihan owner (a1–a4) → dapatkan SVG final (owner export ATAU vectorize sendiri via `scripts/vectorize.mjs`) → simpan `docs/brand/aidit-os-logo-<final>.svg`.
2. Bersihkan SVG: snap warna ke emerald/gold brand, bg transparan, rapikan node.
3. Bikin variasi: primary(dark)/inverse(ivory)/mono/favicon + lockup horizontal dengan wordmark "AIDIT OS" (Sora 800).
4. **Rebuild brand guideline v2** (`aidit-os-brand-guideline-v2.html`) pakai logo final — ganti semua mark SVG-tangan.
5. **Logo SJS SuperApps** (trefoil 5 daun) via Canva + prompt art-directed.
6. Wire design-pipeline ke Aidit OS gate (lane hasilkan brief→Canva/HTML→render→acceptance rubrik design; supervisor kurasi via vision).
7. **Deck presentasi 5 bagian** (permintaan owner sebelumnya): (1) kondisi Aidit OS hari ini, (2) 46 backlog + usul prioritas, (3) kondisi cockpit + UX buat user non-engineer, (4) rencana perbaikan, (5) roadmap v3–v4–v5.

## 5. PERKAKAS (di `_scratch-dispatch-gate/scripts/`)
- `render-design.mjs <html> <png> [w h scale]` — HTML→PNG (Playwright, viewport).
- `render-full.mjs <html> <png> [w]` — HTML→PNG full-page (dokumen panjang).
- `capture-motion.mjs <html> <png> <vidDir> [w h ms]` — still + video motion (webm).
- `crop.mjs <img> <out> <x y w h>` — crop (data-URI embed; file:// diblok setContent, sudah dihandle).
- `vectorize.mjs <img> <out.svg>` — raster→SVG (imagetracer CDN via Playwright).
- `svg2png.mjs <svg> <out> [bg]` — render SVG→PNG.
- Playwright + Chromium terpasang di Lenovo (`node_modules` di repo root; ms-playwright di-junction ke E:).
- **ffmpeg** Playwright minimal (cuma webm; tak bisa mp4/gif transcode).

## 6. KIRIM VISUAL KE OWNER (remote/HP)
- Telegram: token `TELEGRAM_AI_..` → var `TELEGRAM_BOT_TOKEN_AHMAD` di `D:\AI\AIdit OS\.env.local` (baca tanpa cetak), OWNER_CHAT_ID = `8987077084`.
- Pola: `fetch https://api.telegram.org/bot<token>/sendPhoto|sendDocument|sendMessage` (multipart FormData/Blob). Contoh skrip ada di scratchpad sesi ini (`tg-*.mjs`).
- Selalu juga `SendUserFile` biar muncul di interface HP.
- **Redact**: jangan pernah cetak nilai token/API key (sed `s/[0-9]{8,}:[A-Za-z0-9_-]{30,}/[TOKEN]/g`).

## 7. GUARDRAILS
- No new spend (uang). Canva = gratis (akun owner). Together/Recraft/Ideogram berbayar = jangan tanpa ACC.
- Desain = selera → tawarkan opsi, kurasi via vision (supervisor punya vision), jangan klaim "final" sebelum owner pilih.
- Jangan hand-SVG logo. Pakai Canva → (SVG via export owner / vectorize).
