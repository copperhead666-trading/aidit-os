# Transisi akun Claude — Orkestrator (bahasa awam)

Ditulis sesi instruksi-06 (2026-09-17). Tujuan: supaya dua akun Claude Anda tidak rebutan kuota,
dan Orkestrator tetap punya akun sendiri yang jelas.

## Ringkasan situasi

Anda punya 2 akun Claude Pro:
- **pusatberasmurah** — kuota baru reset Kamis 17 September pagi, jadi segar sekarang.
- **adityainofficial** — aktif sampai **12 Oktober 2026**.

Rencananya: **pusatberasmurah berhenti langganan 20 September**. Supaya Orkestrator (yang jalan
24 jam di latar belakang) tidak ikut mati kehabisan akun, dia perlu tahu kapan harus pindah akun.

## Sekarang sampai 20 September

- **Orkestrator** (proses latar belakang, PM2) pakai profil khusus `D:\aidit-claude-machine`,
  login akun **pusatberasmurah**.
- **Sesi Anda sendiri** di terminal (`C:\Users\WIN10\.claude`, profil biasa) pakai akun
  **adityainofficial**.
- Dengan begini, dua akun jalan bersamaan tanpa rebutan kuota satu sama lain.

**Catatan penting**: hasil sesi instruksi-04 sebelumnya sempat mengarahkan Orkestrator ke profil
sesi Anda (`C:\Users\WIN10\.claude`) karena saat itu profil khusus belum pernah login sama
sekali. Sekarang rencananya dibalik lagi ke aturan asli di atas begitu profil khusus sudah login.

### Langkah Anda sekarang (bila belum dilakukan)

Buka PowerShell **baru** (bukan dari sesi Claude Code biasa Anda), lalu:

```powershell
$env:CLAUDE_CONFIG_DIR = "D:\aidit-claude-machine"
claude
```

Login dengan akun **pusatberasmurah** di jendela yang terbuka (`/login` bila belum otomatis
diminta). Setelah berhasil, tutup jendela itu — tidak perlu dibiarkan terbuka.

## 20 September — hari langganan pusatberasmurah berhenti

1. Login ulang profil khusus dengan akun **adityainofficial** (akun ini yang bertahan lebih lama,
   sampai 12 Oktober):
   ```powershell
   $env:CLAUDE_CONFIG_DIR = "D:\aidit-claude-machine"
   claude
   ```
   Jalankan `/login`, pilih/masuk dengan akun **adityainofficial**.

2. **Kembalikan konfigurasi Orkestrator ke profil khusus** (instruksi-04 sebelumnya sempat
   mengarahkannya ke profil sesi Anda sebagai jalan pintas sementara — sekarang waktunya
   dikembalikan). **JANGAN jalankan langkah ini sebelum langkah 1 di atas selesai** (login
   adityainofficial ke profil khusus) — kalau dijalankan lebih dulu, Orkestrator akan mencoba
   pakai profil yang belum login dan berhenti bekerja.

   Buka `D:\AI\aidit-os-v5\ecosystem.config.cjs`, cari baris:
   ```js
   CLAUDE_CONFIG_DIR: "C:/Users/WIN10/.claude",
   ```
   ganti jadi:
   ```js
   CLAUDE_CONFIG_DIR: "D:/aidit-claude-machine",
   ```
   Simpan, lalu di PowerShell biasa:
   ```powershell
   pm2 restart orkestrator ops
   ```

3. Cek berhasil: `node conductor/status.mjs` di folder `D:\AI\aidit-os-v5` — baris `claude:`
   seharusnya menunjukkan `D:/aidit-claude-machine (mesin)=adityainofficial@...` (bukan lagi
   `logged out`).

## Setelah 20 September — hanya ada satu akun Claude

Mulai titik ini, **adityainofficial** dipakai berdua: sesi interaktif Anda DAN Orkestrator latar
belakang. Ini artinya kuota lebih gampang habis kalau dipakai berlebihan.

- **Batasi Orkestrator**: keputusan rutin tetap pakai Sonnet (murah), Opus hanya untuk keputusan
  penting, tetap dibatasi sesuai batas yang sudah ada di `config/company.json`
  (`conductor.opusTurnsPerDay`, sekarang 5/hari) — **jangan dinaikkan** tanpa alasan kuat.
- **Jangan** membuka banyak sesi interaktif Claude Code sekaligus di mesin yang sama sambil
  Orkestrator jalan — keduanya berbagi kuota mingguan yang sama sekarang.
- Bila kuota terasa cepat habis, Orkestrator sudah otomatis pindah ke fallback
  `deepseek-v4-flash` (OpenRouter, murah) untuk kerja rutin — Anda tidak perlu campur tangan.

## Aturan umum: satu akun, satu fungsi

Tiap akun dipakai untuk **fungsi masing-masing** secara konsisten (Orkestrator = satu akun,
sesi Anda = akun lain, sampai 20 September) — **bukan** untuk bergantian menghindari limit
("akun ini abis, coba pindah ke akun itu"). Kalau dipakai bergantian begitu, dua-duanya cepat
mentok bersamaan dan sulit dilacak akun mana yang menyebabkan apa.

## Pengingat otomatis yang dipasang

Telegram akan mengirim pengingat pada tanggal berikut (lihat `docs/reports/INSTRUKSI06_HASIL.md`
untuk detail mekanismenya):
- **19 September** — siapkan login adityainofficial untuk Orkestrator (langkah di atas).
- **20 September pagi** — berhenti langganan pusatberasmurah + pastikan sudah login profil
  khusus dengan adityainofficial.
- **21 September** — berhenti langganan Ollama bila belum.
- **26 September** — Kimi ditagih besok (27 Sep).
- **3 Oktober** — ChatGPT Plus (Codex) diperpanjang besok (4 Okt).
- **10 Oktober** — akun Claude adityainofficial berakhir 12 Oktober — putuskan langkah
  selanjutnya (perpanjang / ganti akun / lainnya).
