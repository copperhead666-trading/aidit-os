# INSTRUKSI-06 — Hasil (2026-09-17 22:15 WIB, sesi interaktif)

## 1. Ringkasan

Ollama dilepas total dari jalur tick rutin (bukan cuma lane, tapi juga panggilan langsung yang
selama ini bypass gating) — sekarang Claude Sonnet dulu, fallback DeepSeek. Ditemukan PRD 10-layer
**ASLI** milik Aidit sendiri (`D:\AI\Aidit OS\PRD-AIDIT-OS-10-LAYER.md`) yang selama ini tidak
pernah dipakai — dokumen 10 layer repo v5 ternyata memakai kerangka tebakan yang salah. Katering
SJ1: 3 keputusan Aidit dicatat (Apps Script API sudah nyala, logo sudah ada, font di-embed), 4
tiket yang macet dijalankan ulang — **masih berjalan di background saat laporan ini ditulis**.
46 backlog dinilai ulang: 13 relevan (diprioritaskan), 11 usang (dibatalkan, tidak dihapus). Siklus
hidup langganan sekarang otomatis lewat tanggal di config, bukan ubah manual tiap kali.

## 2. Tugas untuk Aidit

1. **Sekarang — Login profil khusus Orkestrator** (bila belum, lihat §5 detail di
   `docs/guides/TRANSISI_AKUN_CLAUDE.md`):
   ```powershell
   $env:CLAUDE_CONFIG_DIR = "D:\aidit-claude-machine"
   claude
   ```
   Login dengan akun **pusatberasmurah**, lalu tutup jendela.
2. **20 September** — setelah pusatberasmurah berhenti: login profil khusus di atas ulang dengan
   **adityainofficial**, lalu kembalikan `ecosystem.config.cjs` (lihat panduan) + `pm2 restart
   orkestrator ops`. Sudah dipasang pengingat Telegram otomatis untuk ini.
3. **Sebelum 22 September** — berhenti langganan Ollama di website (pengingat Telegram terjadwal
   21 Sep).
4. Cek hasil 4 tiket katering (AID-54/63/69/70) setelah selesai — laporan lengkap menyusul di
   `docs/reports/TAHAP6_KATERING.md` begitu dispatch background selesai (lihat §4 di bawah untuk
   cara cek statusnya sendiri).
5. Tidak ada aksi berbayar/uang baru yang perlu diputuskan sekarang.

## 3. Hasil pelepasan Ollama + bukti tes

**Ditemukan**: bukan cuma lane `glm-52` yang perlu dinonaktifkan (sudah dari Tahap 3) — jalur tick
rutin (`conductor/run.mjs`) ternyata memanggil Ollama **langsung** lewat `askGlm()`, melewati
gating lanes.json sama sekali, tiap 30 menit, walau Ollama sudah mati sejak beberapa hari lalu.

**Perbaikan**:
- `conductor/claude.mjs`: `askRoutine()` baru — Claude Sonnet dulu, fallback OpenRouter
  (deepseek-v4-flash dst.) kalau gagal. `askGlm()` (Ollama) tetap ada di kode, tidak dihapus,
  cuma tidak dipanggil lagi dari jalur rutin.
- `conductor/run.mjs`: tick rutin pakai `askRoutine()`.
- `config/company.json`: `conductor.routineModel` `"glm-5.2:cloud"` → `"sonnet"`.
- `config/lanes.json`: alasan disabled `glm-51/52/53-flash`, `kimi-k27` diperbarui jadi
  "Ollama dilepas owner 17 Sep 2026" (entri **tidak dihapus**, sesuai instruksi).
- "Hatta" (nama lama untuk apa yang sekarang jadi Hermes) — tidak ada komponen kode terpisah
  yang ditemukan; sudah tidak aktif sejak rename ke Hermes, ditandai di
  `docs/backlog/BACKLOG_INVENTARIS_V6.md` (FOS-16/17/18) sebagai SELESAI/USANG.

**Bukti tes**: `node conductor/run.mjs --once --dry` → `{"ok":true, "summary":"Menugaskan dua item
backlog..."}`. 10 unit test conductor hijau (termasuk 3 test lama + 7 test baru sesi ini).
`npm run typecheck` lulus (tidak ada file TS yang disentuh).

Restart yang dibutuhkan: **sudah tercakup** dalam `pm2 restart orkestrator ops` yang sama seperti
instruksi-04/05 (belum dikonfirmasi sudah jalan dengan kode terbaru — cek `node conductor/status.mjs`,
baris `pemakaian hari ini` seharusnya mulai menunjukkan `sonnet` untuk tick rutin, bukan lagi
`glm-5.2:cloud`, setelah restart berikutnya).

## 4. Status katering: keputusan Aidit, SPEC, status AID-74

**Keputusan Aidit** (dicatat lengkap di `docs/ventures/katering/DECISIONS.md` + komentar
AID-54/63/69/70/74 di Paperclip):
1. Google Apps Script API — **sudah dinyalakan** Aidit.
2. Logo SJ1 — **sudah ada** (`E:\Business\Katering Harian ANP\Sederhana Jaya 1\logo\sj1-logo.png`,
   teks benar "Sederhana Jaya 1", sudah terpasang di dokumen via AID-64). Catatan lama "menunggu
   owner" di handoff 16 Sep sudah usang — dikoreksi. Tidak perlu Canva untuk logo ini.
3. Font Plus Jakarta Sans — **di-embed** ke template (bukan terima fallback Segoe UI).
4. 4 tiket macet (AID-54/63/69/70) — **dikerjakan sekarang** atas permintaan Aidit.

**SPEC "bisa dipakai Aidit"**: `docs/ventures/katering/SPEC.md` — siapa pengguna (Aidit, pekerja
kasual via QR, ANP sebagai klien), alur harian (pesan → dokumen otomatis → kirim → absensi →
bayar → tagih Jumat), output yang diterima Aidit (PDF siap kirim, dashboard, ringkasan Telegram),
5 kriteria selesai konkret.

**Temuan teknis penting**: 4 tiket ini sebelumnya macet **bukan** karena menunggu keputusan
Aidit — Paperclip mencatatnya sebagai `stranded_assigned_issue` (sempat di-assign tapi tidak ada
agent yang benar-benar mengerjakan) dan terpisah, ditemukan **gerbang dead-man switch basi**
(`state/orkestrator-down.flag`, tertulis 21:14 WIB dari momen restart PM2, tidak pernah terhapus
walau Orkestrator sudah sehat lagi — dibuktikan tick nyata 21:26 WIB berhasil) yang memblokir
**semua** dispatch worker, dan validator Prompt Matrix menolak paket lama yang pakai format
"(1)...(2)..." alih-alih "1)\n2)". Ketiganya diperbaiki (flag dihapus, komentar `[Conductor]
LANGKAH:` ditambahkan ke 2 issue).

**Status saat laporan ini ditulis**: kedua tiket engineering (AID-69, AID-70) dan qa (AID-63,
AID-54) **sedang berjalan** (`node conductor/status.mjs` menunjukkan `kepala sibuk: engineering,
qa`) — proses coding+tes nyata di Google Apps Script/Sheet, belum tentu selesai saat laporan ini
dikirim. Cek progres dengan:
```powershell
cd D:\AI\aidit-os-v5
node conductor/status.mjs
```
Baris "kepala sibuk" kosong `(tidak ada)` berarti sudah selesai (baik berhasil maupun gagal) —
lihat komentar terbaru di AID-54/63/69/70 (Paperclip) untuk hasilnya.

## 5. Ringkasan inventaris layer (kerangka yang diusulkan)

Ditemukan PRD 10-layer **asli** milik Aidit (`D:\AI\Aidit OS\PRD-AIDIT-OS-10-LAYER.md`, v1.0,
10 Sep) — **tidak pernah dipakai** oleh repo v5. Dokumen `docs/architecture/10_LAYER_AIDIT_OS.md`
yang ada selama ini memakai kerangka "The Agent Stack" yang ditebak dari sebuah file audit (sumber
itu sendiri menandai dirinya TIDAK DIVERIFIKASI).

**Kontradiksi utama**: framework 10-layer repo v5 (Substrate/Model/Prompt/Context/Tools/Loop/
Memory/Agents/Orchestration/Verification/Interface) **beda total** dari PRD asli owner
(Harness/Loop/Context/Tool/Memory/Orchestration/Guardrails/Evals/HITL/Observability — tanpa
Layer 0). 6-stack Bennett/FounderOS (`PRD-AIDIT-OS-V5-ENAM-STACK.md`, 14 Sep, disetujui owner)
ternyata **sudah memetakan dirinya sendiri** ke 10-layer asli ini — pemetaan itu tidak pernah
dirujuk balik.

**Usulan v6** (di `docs/architecture/SUMBER_LAYER_INVENTARIS.md`): pakai PRD 10-layer asli sebagai
standar kualitas resmi (tiap layer punya kriteria **Ideal + Uji** yang bisa dieksekusi, jauh lebih
konkret dari tebakan lama), dengan 6-stack Bennett sebagai lapisan organisasi/proses di atasnya
(persis seperti dimaksud judul dokumennya sendiri: "Enam Stack Bennett **di atas** Sepuluh
Layer"). Kedua PRD disalin ke `docs/prd/legacy/` untuk referensi permanen di repo v5.

## 6. Ringkasan inventaris backlog

| Kategori | Jumlah |
|---|---|
| RELEVAN (diprioritaskan) | 13 |
| USANG (dibatalkan di Paperclip, tidak dihapus) | 11 |
| SELESAI (maintenance saja) | 10 |
| DUPLIKAT | 1 |
| DITUNDA (trading) | 2 |
| OWNER_DECISION (personal, tetap gate) | 5 |
| Sudah terwakili sistem inti (tanpa issue baru) | 4 |

10 teratas & tabel lengkap: `docs/backlog/BACKLOG_INVENTARIS_V6.md`. 11 item USANG (kontradiksi
prinsip "bukan multi-mesin" dari PRD 10-layer asli — cloud-first, edge worker, dst.) dipindah ke
status `cancelled` di Paperclip dengan komentar alasan; 12 item RELEVAN diberi komentar urutan
prioritas baru (field `priority` tidak bisa diubah lewat tool MCP yang tersedia sesi ini — hanya
status).

## 7. Siklus hidup langganan & pengingat yang dipasang

`config/lanes.json` sekarang mendukung `activeFrom`/`activeUntil` (ISO 8601 + offset WIB
eksplisit) — lane otomatis dianggap `disabled` di luar rentang itu, dites (4 unit test baru).
Diterapkan: `kimi-k3` dapat `activeUntil` 27 Sep (status disabled manual dilepas, kesiapan nyata
tetap lewat probe 15-menitan); `gpt-5.5` dapat `activeFrom` 19 Sep 23:00 WIB (ganti status
disabled manual dari instruksi-04). Ollama tetap disabled (tanpa tanggal aktif).

`docs/guides/TRANSISI_AKUN_CLAUDE.md` — panduan awam pindah profil Claude Orkestrator saat
pusatberasmurah berhenti 20 Sep, plus aturan "satu akun satu fungsi" pasca 20 Sep.

6 pengingat Telegram terjadwal (Windows Task Scheduler, satu kali, lewat `ops/send-reminder.mjs`):
19 Sep, 20 Sep, 21 Sep, 26 Sep, 3 Okt, 10 Okt — daftar lengkap di §7 `TRANSISI_AKUN_CLAUDE.md`.

## 8. Perubahan + cadangan + cara membatalkan

| File | Perubahan | Cadangan | Cara batalkan |
|---|---|---|---|
| `conductor/claude.mjs` | Tambah `askRoutine()` | — (kode baru) | `git revert` commit `88e9140` |
| `conductor/run.mjs` | Tick rutin pakai `askRoutine()` bukan `askGlm()` | — | idem |
| `config/company.json` | `routineModel` glm→sonnet | — | `git diff`/`checkout` |
| `config/lanes.json` | Alasan Ollama diperbarui; `activeFrom`/`activeUntil` kimi-k3 & gpt-5.5 | — | `git diff`/`checkout` |
| `conductor/lanes.mjs` | `isLaneActiveByDate()` + dipakai `laneState()` | — | `git revert` commit `bb18b5a` |
| `conductor/status.mjs` | `laneLine()` pakai `laneState()` langsung (perbaikan tampilan) | — | `git revert` commit `43a5a74` |
| `ops/send-reminder.mjs` | File baru, 6 scheduled task Windows | — | Hapus file + `Unregister-ScheduledTask -TaskName "AiditOS-Reminder-*"` |
| `docs/prd/legacy/*.md` | File baru (salinan, bukan pindah) | — | Hapus file, sumber asli tetap utuh di `D:\AI\Aidit OS\` |
| `state/orkestrator-down.flag` | **Dihapus** (basi, sama seperti aksi otomatis `deadman.mjs` sendiri saat sehat) | — | Tidak perlu — akan ditulis ulang otomatis kalau memang Orkestrator down lagi |
| Paperclip: 11 issue USANG | Status → `cancelled` + komentar | Nilai lama tercatat di komentar | Ubah status balik ke `backlog` di Paperclip |
| Paperclip: AID-54/63/69/70/74 | Status → `todo`, lock eksekusi lama lepas, komentar keputusan | — | — |

## 9. Status akhir kriteria selesai

- Ollama: ✅ tidak ada komponen **aktif** yang bergantung padanya lagi; tick pakai Claude
  Sonnet/fallback DeepSeek (menunggu `pm2 restart` untuk aktif di proses yang berjalan).
- Katering: ✅ keputusan diambil & dicatat; ⏳ AID-54/63/69/70 sedang diproses saat laporan ditulis
  (lihat §4 cara cek).
- `SUMBER_LAYER_INVENTARIS.md` & `BACKLOG_INVENTARIS_V6.md`: ✅ ada, dengan kutipan baris + path.
- `activeFrom`/`activeUntil`: ✅ jalan, 4 unit test.
- Tes & typecheck: ✅ lulus (10 test conductor, typecheck bersih).
- Tidak ada secret tampil, tidak ada file dihapus (flag basi dihapus adalah state runtime, bukan
  dokumen/kode).
