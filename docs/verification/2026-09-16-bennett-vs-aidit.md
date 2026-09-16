# Bennett FounderOS vs Aidit OS v5 — perbandingan rancangan (2026-09-16 07:10 WIB)

Dasar: audit GIBRAN `2026-09-16-gibran-audit.md` (angka 24 jam terakhir), spot-check orkestrator,
riset Bennett `../../../AIdit OS/vendor/RESEARCH-2026-09-11-FOUNDEROS-BENCHMARK.md` dan
`GAP-2026-09-11-AIDIT-VS-FOUNDEROS.md`, kode demo `vendor/founderos-demo`. Ditulis orkestrator
(SOEKARNO) tanpa mengubah kode.

Kriteria verdict (ditetapkan sebelum melihat angka): **Efektif** = tiket/percobaan selesai ≥ 70 %.
**Efisien** = Claude ≤ 10 panggilan/hari, tidak ada run > 25 menit, kepala non-Claude tidak
memakai lane Claude. **Sesuai** = tidak ada mekanisme yang tidak ada di rancangan Bennett.

## Tabel per layer

| Layer | Rancangan Bennett | Aidit OS v5 hari ini (bukti audit) | Beda rancangan? | Efektif? | Efisien? | Sesuai? |
|---|---|---|---|---|---|---|
| 01 Orchestrator | Claude Code **headless**, langganan, satu proses; memunculkan department head, commit sendiri; tidak ada sesi manusia panjang | Conductor headless ada (`conductor/run.mjs`, 8 `claude.call`/24 jam, pause dihormati: 3 tick `paused`). Tetapi: proses `conductor` restart 25× dalam 20 menit; Conductor memakai akun Claude Bapak (`~/.claude` 7/8 panggilan); diberi wewenang menulis `config/lanes.json` (`edit_lane_config`, belum pernah terpicu); `interview.mjs` menulis `config/company.json` saat runtime; sesi manusia Sonnet 15–16 Sep menambah 4.740 baris dalam sehari | **Ya** — Bennett tidak punya orkestrator yang mengubah konfigurasinya sendiri, dan tidak punya sesi manusia yang ikut menulis kode | Tidak dinilai (Conductor sedang jeda) | **Ya** untuk Claude (8 ≤ 10) | **Tidak** (self-editing config, akun tercampur, crash loop) |
| 02 Back office | Paperclip: agen bangun lewat heartbeat, tarik kerja, lapor; papan = keadaan operasional | Paperclip 3120 hidup, wake-on-assign jalan. Papan: 44 tiket — **33 blocked**, 2 done, 5 in_review, 2 in_progress. Tiket blocked bukan karena "gagal di semua lane" (0 komentar cocok) melainkan governance Paperclip memblokir otomatis setelah run gagal, lalu tidak ada yang membuka kembali. `heartbeat` **v4 lama masih hidup** (SYSTEM, 20 restart) di samping v5 | **Sebagian** — struktur sama, tetapi dua sistem (v4 heartbeat + v5) hidup bersamaan dan tidak ada langkah "unblock/re-triage" seperti board Bennett yang bergerak sendiri | **Tidak** (2/44 done = 4,5 %) | — | **Tidak** (v4 belum gelap; 75 % papan macet) |
| 03 Model lanes | GLM-5.2 berat / 5.1 kode / flash ringan + Codex jalur kedua; dua paket flat; **tanpa harness sendiri** | GLM = 162/186 run (87 %), gagal 35–36 %; Codex 18 run **100 % gagal 401** (auth profil SYSTEM, bukan kuota) lalu **dimatikan total**; kimi-k3/k27 disabled; 22 baris Ollama 429 dalam 24 jam; timeout keras 25 menit di `lanes.mjs:100,204`; "exit null" 46× = 63 % kegagalan (proses dibunuh, tidak ada checkpoint) | **Ya** — Bennett memakai Codex sebagai jalur kedua yang hidup; di sini jalur kedua mati dan GLM memikul semua termasuk yang mestinya Codex | **Tidak** (39 % lane gagal; head.done 89 ok vs 212 gagal = 29,6 %) | **Sebagian** (kepala tidak pernah ke Claude ✓; tetapi 46 run terbuang ≥ 25 menit) | **Tidak** (Codex mati karena bug auth, bukan keputusan rancangan) |
| 04 Worker pool | Hermes = "karyawan" di board dengan chat, cron, MCP; gateway loopback di balik Tailscale | Hermes benar dipakai (110 run ok dari 168 GLM), terdaftar sebagai agent Paperclip, cron heartbeat 15 menit. Tetapi `hermes.cmd tidak ditemukan di PATH` 6× dan "session storage busy" 6× karena proses berjalan sebagai SYSTEM vs WIN10 bergantian; HERMES_HOME dipindah ke `D:/aidit-hermes-machine` tetapi PATH biner belum | **Tidak** (rancangan sama) | **Sebagian** (66 % run Hermes ok) | Ya | **Sebagian** — bentuknya Bennett, tetapi identitas proses belum stabil |
| 05 Hands | Satu `.mcp.json` diwarisi seluruh organisasi | `.mcp.json` v5 ter-track, dibaca Hermes; graphify dipakai di paket (`graphHint`, `query --budget`). Tetapi `packet_bytes` tidak pernah dicatat, RTK tidak ada jejak (0 baris) — dua bukti PRD v5.1 §7 tidak terukur | **Tidak** | Ya | Tidak terukur | **Sebagian** (hands ada; pengukuran hemat token tidak dipasang) |
| 06 Metal | Satu host, Docker sandbox, Tailscale satu-satunya pintu | Lenovo + PM2 + Tailscale ✓. Tetapi: proses PM2 berjalan campur SYSTEM/WIN10 → auth Claude/Codex/Hermes putus bergantian (akar 401 dan `hermes.cmd`); disk D: sempat 0 GB berulang (penyebab di luar Aidit belum diketahui); WSL2/Docker belum (Ask SETUJU, belum dieksekusi) | **Sebagian** — Bennett satu identitas proses, satu sandbox | — | — | **Tidak** (identitas proses tidak stabil = akar sebagian besar kegagalan lane) |
| Token/kuota (lintas layer) | "No per-token meter anywhere"; flat plans; headless pendek | Claude 8 panggilan/hari ✓. Tetapi audit ini sendiri memakan 614 K token GLM (Ollama) untuk satu laporan; `cache-read` Claude tidak dicatat; `rtk gain`, `packet_bytes`, langkah per run tidak dicatat → efisiensi **tidak bisa dibuktikan**, hanya diklaim | Ya | — | **Tidak terbukti** | **Tidak** (klaim "v5.1 lulus" tanpa 6 dari 11 kriteria terukur) |

## Tiga perbedaan rancangan terbesar

1. **Orkestrator yang mengubah dirinya sendiri.** Bennett: Conductor memutuskan siapa mengerjakan
   apa; konfigurasi lane adalah keputusan manusia (flat plans). Aidit: Conductor boleh menulis
   `config/lanes.json` (`edit_lane_config`) dan `interview.mjs` menulis `config/company.json` —
   ditambah sesi manusia yang menulis 4.740 baris/hari. Hasilnya arah berubah 5× dalam semalam
   (riwayat `config/lanes.json`: codex masuk-keluar tiga kali).
2. **Jalur kedua mati, satu pool memikul semua.** Bennett: GLM + Codex, dua paket flat, keduanya
   hidup. Aidit: Codex 100 % gagal 401 (profil SYSTEM tidak login) lalu dimatikan sebagai "kuota
   0 %" tanpa verifikasi; GLM memikul 87 % run dengan 36 % gagal, 22× 429 Ollama, timeout keras
   25 menit tanpa checkpoint → 63 % kegagalan adalah proses yang dibunuh.
3. **Dua sistem hidup bersamaan dan papan tidak pernah dibuka kembali.** Bennett: satu board,
   agen bangun-tarik-lapor. Aidit: `heartbeat` v4 masih hidup, v5 di sampingnya; Paperclip
   memblokir 33/44 tiket setelah run gagal dan tidak ada mekanisme re-triage → papan tampak
   "bekerja" (89 head.done ok) tetapi hanya 2 tiket selesai.

## Verdict keseluruhan

- **Beda rancangan**: ya, pada Layer 01 (self-editing + sesi manusia menulis kode), 03 (jalur
  kedua mati), 02/06 (dua sistem, identitas proses campur).
- **Efektif**: **tidak** — 2/44 tiket done (4,5 %), head.done 29,6 % ok, lane 61 % ok.
- **Efisien**: **tidak terbukti** — Claude memang hemat (8 panggilan/hari), tetapi GLM/Ollama
  boros oleh timeout dan run terbuang (46 × ≥ 25 menit), dan alat ukur hemat (RTK, packet_bytes,
  langkah, cache-read) tidak pernah dipasang meski PRD v5.1 mensyaratkannya. Klaim "v5.1 lulus"
  dibuat dengan 6 dari 11 kriteria **tidak diukur** dan 1 gagal.
- **Sesuai Bennett**: **belum** — bentuk luar (Paperclip, Conductor headless, Hermes, `.mcp.json`,
  Tailscale) sudah sama; yang menyimpang adalah perilaku: orkestrator mengubah konfigurasi sendiri,
  sesi manusia ikut membangun, v4 belum gelap, jalur kedua mati, dan verifikasi diklaim tanpa ukuran.

## Keputusan untuk Bapak (bukan pekerjaan yang langsung dikerjakan orkestrator)

1. **Bekukan dulu**: `pm2 stop conductor ops heartbeat` (heartbeat = v4). Kepala yang sedang jalan
   dibiarkan selesai. Paperclip, cockpit, telegram tetap hidup (tanpa model).
2. **Kembalikan akun**: `CLAUDE_CONFIG_DIR=D:/aidit-claude-machine` untuk conductor di ecosystem;
   login `pusatberasmurah` Kamis 06:00; sampai itu Conductor tetap jeda.
3. **Satu identitas proses PM2** (WIN10 saja, atau SYSTEM saja dengan HOME/PATH eksplisit) —
   ini akar 401 Codex, `hermes.cmd` hilang, dan "session storage busy". Tanpa ini, lane apa pun
   akan gagal bergantian.
4. **Hidupkan kembali Codex sebagai jalur kedua** setelah (3): login sekali lewat `ops/codex-machine.cmd`,
   verifikasi kuota dari dashboard OpenAI, bukan dari pesan 401.
5. **Cabut wewenang self-edit**: Conductor tidak menulis `config/*.json`; perubahan lane = keputusan
   Bapak lewat Ask. `interview.mjs`/`chat.mjs`/`score.mjs`/katering = di luar PRD → dibekukan
   sampai ada PRD-nya, atau dihapus.
6. **Ukur sebelum mengklaim**: pasang pencatatan `packet_bytes`, langkah per run, `rtk gain`,
   cache-read Claude; timeout adaptif + checkpoint sebelum kill; Paperclip re-triage tiket blocked
   (bukan dibiarkan). Baru setelah 24 jam angka nyata, PRD §7 boleh dinyatakan lulus.
7. **Pengerjaan** butir 3–6 oleh lane (Codex/GLM via Hermes) lewat tiket Paperclip, satu tiket satu
   butir, dengan acceptance yang dieksekusi — bukan oleh sesi orkestrator.
