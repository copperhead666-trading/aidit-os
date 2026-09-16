# OpenRouter sebagai pool pekerja Aidit OS — alur yang benar (riset 2026-09-16 13:00 WIB)

Sumber: openrouter.ai/docs (limits, provider-routing, model-routing) dan `GET /api/v1/models` live.
Keputusan owner: top-up prabayar $10 (2026-09-16). Aturan lama "tidak ada meter per-token" direvisi
untuk pool ini saja, dengan pagar keras di bawah.

## 1. Akun, kunci, pagar

1. Buat kunci di openrouter.ai/keys. Saat membuat, isi **Credit limit** pada kunci (mis. $5) — ini pagar
   pertama: kunci berhenti sendiri walau saldo masih ada. Buat kunci terpisah untuk Aidit (`aidit-worker`).
2. Di Settings → Credits pastikan **auto top-up OFF** (prabayar murni). Saldo negatif → semua model
   (termasuk gratis) jawab `402`; isi ulang manual.
3. Kunci disimpan di `D:/AI/aidit-os-v5/.env.local` sebagai `OPENROUTER_API_KEY` (gitignored), tidak
   pernah dicetak. Cek saldo/pemakaian kapan saja: `GET https://openrouter.ai/api/v1/key` (Bearer) →
   `limit_remaining`, pemakaian harian/mingguan/bulanan.

## 2. Tahap gratis (`:free`)

- 20 model varian `:free` (mis. `z-ai/glm-5.2:free`, konteks 32K). Batas: **20 permintaan/menit**;
  harian **50** untuk akun tanpa pembelian, **1.000/hari setelah pernah beli ≥ $10** — Bapak sudah di
  tier ini.
- Gratis = penyedia boleh memakai prompt untuk pelatihan (kebijakan data). Untuk tiket venture yang
  tidak rahasia boleh; untuk data pribadi/kredensial jangan (dan Aidit memang tidak pernah mengirim
  `.env`/kredensial ke lane). Kalau ingin ketat: `provider.data_collection: "deny"` — tetapi banyak
  penyedia gratis tersingkir, jadi pakai `deny` hanya di lane berbayar.
- Kena 429 (limit) → OpenRouter tidak otomatis pindah ke model berbayar; **kita** yang mengatur
  fallback lewat `models: [...]`.

## 3. Tahap berbayar (kredit)

- Harga per juta token (live 16 Sep, input/output): `deepseek/deepseek-v4-flash` $0.09/$0.18;
  `z-ai/glm-5.3-flash` $0.10/$0.33; `qwen/qwen3-coder-next` $0.12/$0.80; `qwen/qwen3-coder` $0.30/$1;
  `moonshotai/kimi-k2.7-code` $0.71/$3.21; `z-ai/glm-5.1` $0.97/$3.04; `z-ai/glm-5.2` $1.40/$4.40.
- Satu tiket KAT (±200–400 K token) ≈ **$0,05–0,15** di kelas flash, ≈ $0,5–1,5 di kelas Kimi/GLM-5.2.
  $10 ≈ 70–150 tiket kelas flash. Hari seberat 16 Sep (±13 tiket) ≈ $1–2 di flash, ≈ $10 di Kimi.
- Setiap respons bisa memuat biaya: kirim `"usage": {"include": true}` → `usage.cost` → dicatat ke
  ledger per run (`costUsd`), dijumlah per hari untuk Report 19:00.

## 4. Routing yang dipakai Aidit (satu permintaan, OpenAI-compatible)

```json
POST https://openrouter.ai/api/v1/chat/completions
{
  "models": ["z-ai/glm-5.2:free", "deepseek/deepseek-v4-flash", "z-ai/glm-5.3-flash", "qwen/qwen3-coder-next"],
  "messages": [...],
  "provider": { "sort": "price", "allow_fallbacks": true, "max_price": { "prompt": 1, "completion": 3.5 } },
  "usage": { "include": true }
}
```
- `models` = rantai fallback per permintaan (gratis dulu, lalu murah, lalu lebih kuat).
- `sort: price` + `max_price` = pagar harga per token; permintaan ditolak bila hanya penyedia mahal.
- Sufiks: `:free` gratis, `:floor` termurah, `:nitro` tercepat (lebih mahal).
- Header `HTTP-Referer` / `X-Title: Aidit OS` opsional (muncul di dashboard).

## 5. Integrasi Aidit (tanpa harness baru)

- Hermes punya slot **OpenRouter** bawaan (`hermes status` menampilkannya): `OPENROUTER_API_KEY` di env
  Hermes (`D:/aidit-hermes-machine`), lalu `hermes model` → provider OpenRouter, model default
  `deepseek/deepseek-v4-flash`; `hermes fallback add` → `z-ai/glm-5.3-flash`, `qwen/qwen3-coder-next`.
- `config/lanes.json`: pool `openrouter` dengan lane `or-free` (glm-5.2:free, tugas ≤ 32K), `or-flash`
  (deepseek-v4-flash), `or-coder` (qwen3-coder-next), `or-kimi` (kimi-k2.7-code, hanya berat);
  `dailyUsd` pagu (mis. $1,5/hari) — probe `ops.mjs` membaca `/api/v1/key` tiap 15 menit; lewat pagu →
  `resting` sampai 00:00 WIB.
- Peran: OpenRouter = **pekerja utama** (selalu tersedia), Codex = pekerja kedua (kualitas), Claude =
  otak. Ollama Cloud dan Kimi Code **tidak diperpanjang** bulan depan (hemat ±$40).

## 6. Urutan pemasangan (setelah kunci diterima)

1. Simpan kunci → `curl /api/v1/key` → catat `limit_remaining`.
2. Uji 1 panggilan `z-ai/glm-5.2:free` ("PONG") dan 1 panggilan `deepseek/deepseek-v4-flash` → biaya
   tercatat.
3. Hermes: provider + fallback; `hermes -z "tulis satu fungsi" --in <scratch>` → sukses.
4. `lanes.json` + probe pagu; KAT-13/14 dijalankan lewat lane `or-flash` sebagai uji nyata pertama.
5. Report 19:00 menampilkan "OpenRouter hari ini: $x,xx (sisa $y,yy)".
