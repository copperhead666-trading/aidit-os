# USULAN: INTAKE BRIEF — gate yang memaksa unknown disebut namanya

Status: **DISETUJUI ARAHNYA oleh pemilik, 2026-09-04.** Belum dijadwalkan, belum
dibangun. Ditulis di luar repo karena Lenovo adalah satu-satunya writer.

Ditulis setelah pemilik menilai sebuah PRD dibuat terburu-buru. Diagnosisnya
bukan "AHMAD kurang bertanya" — melainkan tidak ada gate yang memaksa unknown
disebut namanya sebelum kerja dimulai.

---

## 1. Cacat yang ditutup

Hari ini alur dari pesan pemilik ke kerja adalah:

```
pesan Telegram bebas -> issue Paperclip -> DIRECTIVE -> directive-runner -> lane
```

Tidak ada satu titik pun di rantai itu yang menolak permintaan karena scope-nya
belum diketahui. Lane menerima `buildExecutionPrompt` berisi OBJECTIVE, daftar
file, STEPS, VERIFY — semuanya sudah mengasumsikan seseorang tahu jawabannya.
Kalau pemilik menulis "bangun security scan untuk CCTV gua", yang tidak
diketahui bukan langkah implementasinya. Yang tidak diketahui adalah: kamera
siapa, jaringan siapa, boleh aktif atau harus pasif, dan apa yang dihitung
sebagai temuan. Sistem sekarang akan menebak keempatnya dan menyebut hasil
tebakan itu PRD.

## 2. Preseden di dalam repo ini — polanya sudah terbukti sekali

`ops-watcher/decision-brief.mjs` menutup cacat yang bentuknya identik di arah
sebaliknya. Komentar file itu sendiri yang menjelaskan:

> The fix is not a better prompt. A prompt is a request; this is a gate.

`REQUIRED_SLOTS` di sana ada lima: `pertanyaan`, `yang_sudah_ada`, `pilihan`,
`rekomendasi`, `kalau_didiamkan`. Escalation yang slotnya kosong DITOLAK, dan
penolakannya menyebut slot yang hilang. Ada juga daftar placeholder yang lolos
cek non-empty tapi tidak membawa isi — itu ditolak juga.

INTAKE BRIEF adalah cermin dari benda yang sama:

| | arah | siapa yang mengisi | kapan |
|---|---|---|---|
| DECISION BRIEF (sudah ada) | AHMAD menjawab sebelum mengganggu pemilik | AHMAD | sebelum eskalasi |
| INTAKE BRIEF (usulan) | AHMAD bertanya sebelum mulai kerja | pemilik | sebelum directive |

Konsekuensinya penting: ini bukan komponen baru yang berdiri sendiri. Ia
memakai ulang bentuk penyimpanan, bentuk penolakan, dan bentuk kartu yang sudah
terbukti jalan di repo ini.

## 3. Apa yang diadopsi, dan apa yang tidak

Aturan berdiri: `reuse-before-build-research-first`. Riset sudah dilakukan dan
diverifikasi langsung, bukan dari ingatan.

### github/spec-kit — DIADOPSI SEBAGIAN

Diverifikasi 2026-09-04 lewat GitHub API dan raw file:

- Lisensi **MIT** (SPDX: MIT). Boleh diadopsi.
- 133.425 stars. Bukan proyek eksperimen satu orang.
- `templates/commands/clarify.md` memuat taxonomy 9 kategori, batas **maksimal
  5 pertanyaan** per sesi, tiap pertanyaan harus bisa dijawab lewat pilihan
  ganda (2-5 opsi, disajikan sebagai tabel markdown) atau jawaban pendek
  (maksimal 5 kata), dengan satu opsi ditandai **Recommended**.
- Jawaban ditulis balik ke spec di bawah `## Clarifications` > `### Session
  YYYY-MM-DD` dalam bentuk `- Q: <pertanyaan> -> A: <jawaban>`, lalu
  diaplikasikan ke section yang relevan; teks lama yang bertentangan diganti.
- Klarifikasi boleh dilewati kalau pengguna menyatakannya eksplisit, dengan
  peringatan soal risiko rework.

Sembilan kategori taxonomy-nya (dipakai apa adanya sebagai tulang punggung):

1. Functional Scope & Behavior — tujuan, kriteria sukses, batas scope, peran user
2. Domain & Data Model — entitas, atribut, relasi, identitas, lifecycle, skala
3. Interaction & UX Flow — alur, error/empty state, aksesibilitas, lokalisasi
4. Non-Functional Quality Attributes — performa, skalabilitas, keandalan,
   observability, keamanan, kepatuhan
5. Integration & External Dependencies — layanan, API, mode gagal, format, versi
6. Edge Cases & Failure Handling — skenario negatif, rate limiting, resolusi konflik
7. Constraints & Tradeoffs — batas teknis, alternatif yang ditolak, tradeoff eksplisit
8. Terminology & Consistency — glosarium kanonik
9. Completion Signals — acceptance criteria yang bisa diuji, Definition of Done

**KOREKSI ATAS KLAIM SEBELUMNYA.** Di percakapan sebelumnya disebut bahwa
spec-kit punya aturan keras: spec dengan marker `[NEEDS CLARIFICATION]` tidak
boleh naik ke fase plan. **Itu tidak benar.** `templates/spec-template.md`
memuat markernya dan menerangkan kapan dipakai, tapi tidak menyatakan larangan
apa pun soal melanjutkan, dan tidak punya section acceptance gate sama sekali.
Jadi: markernya dipinjam, **gate-nya harus kita yang bangun.** Itu justru bagian
yang paling bernilai dan tidak tersedia untuk diadopsi.

**Yang TIDAK diadopsi:** CLI-nya, scaffolding agent-nya, dan asumsi dasarnya
bahwa ada coding agent interaktif di terminal yang menjawab dalam hitungan
detik. Transport kita asinkron — satu pemilik, membalas dari HP, mungkin enam
jam kemudian, mungkin separuh.

### Kandidat lain

- **superpowers `brainstorming`** (sudah terpasang lokal): disiplinnya bagus,
  bentuknya satu-pertanyaan-per-giliran di chat interaktif. Tidak cocok untuk
  transport asinkron. Dipinjam disiplinnya, bukan alurnya.
- **BMAD-METHOD**: punya menu elicitation bernomor, tapi berat dan opinionated
  soal persona agent — bentrok dengan roster lane yang sudah ada
  (HATTA/CORLEONE/SJAHRIR/SOEKARNO). Tidak diadopsi.

## 4. Desain

### 4.1 Trigger — kapan gate menyala

Kalau setiap "fix typo" memicu dua belas pertanyaan, pemilik akan mem-bypass
sistemnya sendiri dalam seminggu, dan gate yang di-bypass sama saja dengan gate
yang tidak ada.

| kondisi | hasil |
|---|---|
| pesan tidak memetakan ke `venture.id` mana pun di `config/ventures.json` | INTAKE penuh |
| venture baru atau capability baru | INTAKE penuh |
| kerja di dalam venture aktif yang sudah ada | lewati, langsung directive |
| pemilik menulis "skip intake" | dilewati, dengan satu peringatan risiko rework, dan fakta itu dicatat |

### 4.2 Slot yang wajib — cermin `REQUIRED_SLOTS`

Sebuah INTAKE BRIEF ditolak kalau salah satu kosong atau diisi placeholder:

- `permintaan_asli` — DIKUTIP dari pesan pemilik, tidak pernah diringkas.
  Aturan ini sudah tertulis di `config/ventures.json`: *"tujuan is QUOTED from a
  source, never summarised into an agent's own words."*
- `yang_sudah_diketahui` — apa yang benar-benar bisa disimpulkan dari pesan itu
  plus repo, dengan sumbernya.
- `yang_belum_diketahui` — daftar `[NEEDS CLARIFICATION: ...]`, tiap satu
  dipetakan ke satu dari sembilan kategori taxonomy.
- `pertanyaan` — maksimal 5, tiap satu wajib punya: kenapa penting (apa yang
  berubah kalau jawabannya lain), 2-5 pilihan, satu rekomendasi, dan satu
  default kalau pemilik diam.
- `arsitektur_kandidat` — sketsa yang secara eksplisit bergantung pada jawaban
  di atas, bukan yang berpura-pura sudah pasti.
- `kalau_ditebak` — biaya konkret dari menebak, bukan peringatan umum.

### 4.3 Aturan emas

**Hanya tanyakan yang mengubah bangunan.** Pertanyaan yang jawabannya tidak
mengubah arsitektur, scope, atau biaya: jangan ditanyakan, putuskan sendiri.
Inilah yang membedakan intake dari formulir pendaftaran. Batas 5 pertanyaan
spec-kit memaksa disiplin ini, bukan sekadar membatasi panjang.

### 4.4 Matrikulasi — bank pertanyaan per taskClass

`config/intake-matrix.json`: tulang punggung 9 kategori (universal) plus set
pertanyaan spesifik per `taskClass`. Field `taskClasses` sudah hidup di
`config/ventures.json` — nilai yang sudah dipakai: `trading-safety`,
`repo-analysis`, `backend-api`, `frontend-design`, `database-storage`.

Dua contoh dari pemilik sendiri:

**"Bangun security scan untuk CCTV gua"** — class `security-assessment` +
`network-hardware`. Pertanyaan wajib: kamera milik siapa dan izin tertulisnya
apa; jaringan siapa; scan aktif atau pasif saja; apa yang boleh disentuh; apa
yang dihitung sebagai temuan. Pertanyaan izin itu bukan formalitas — ia
menentukan apakah pekerjaannya sah.

**"Bangun Angel, personal assistant mirip Siri untuk pacar gua, hidup di iPhone
dan smartwatch Huawei"** — class `mobile-assistant` + `voice` + `privacy`.
Pertanyaan wajib: jalur iPhone yang mana (Shortcuts / app sendiri / App Intents —
tiga arsitektur yang sama sekali berbeda); jam tangan Huawei-nya HarmonyOS atau
Wear OS; suara diproses di device atau cloud; data pribadi orang lain disimpan
di mana dan siapa yang boleh membacanya; bahasa apa.

Pertanyaan HarmonyOS itu contoh terbaik kenapa gate ini ada. Kalau jawabannya
HarmonyOS, sebagian besar arsitektur yang dibayangkan tidak punya jalur sama
sekali. Menebaknya menghasilkan PRD fiksi — persis cacat yang ditegur pemilik.

### 4.5 Kendala asinkron — ini tekanan desain utamanya

Pemilik menjawab dari HP, mungkin berjam-jam kemudian, mungkin separuh. Maka:

- pertanyaan **di-batch**, tidak bergantian satu-satu
- state **resumable**; jawaban parsial tidak membatalkan apa pun
- **diam bukan kematian**: tiap pertanyaan punya default, dan pemilik boleh
  membalas "pakai default semua"
- **idempoten**: pesan yang sama tidak boleh melahirkan intake kedua

### 4.6 Penyimpanan dan permukaan

Ikuti konvensi yang sudah dipelajari dengan mahal oleh
`telegram-decision-options.mjs` dan didokumentasikan di `decision-brief.mjs`:
schema issue Paperclip tidak punya field bebas, dan `metadata` komentar
divalidasi ketat. Satu-satunya tempat data terstruktur selamat melewati round
trip adalah **body komentar di belakang sebuah marker**. Jadi INTAKE BRIEF =
satu baris marker `[INTAKE BRIEF]` plus satu objek JSON, persis seperti
`[DECISION BRIEF]` dan `[DECISION OPTIONS]`.

Permukaan: **Cockpit adalah pintunya** (memory `cockpit-is-the-single-door`).
Telegram tetap lonceng satu arah. Kartu pilihan sudah punya jalurnya.

Bahasa: Indonesia formal, pemilik disebut "Anda" — `decision-brief.mjs`
menegakkan ini dan alasannya bukan kosmetik: cockpit mereproduksi data sumber
apa adanya dan tidak pernah menerjemahkan.

### 4.7 Batas — intake TIDAK mendaftarkan venture

Intake menghasilkan **kandidat**. Pemilik menyetujui. Baru masuk
`config/ventures.json`. Transkrip intake menjadi `tujuan_sumber`, sehingga
`tujuan` tetap kutipan kata-kata pemilik sendiri. `metrik` tetap `null` sampai
pemilik menyebut angkanya — aturan itu sudah tertulis di file tersebut.

## 5. Bentuk kerja

```
I1  baca spec-kit: taxonomy, template, lisensi MIT      (riset, read-only) — SUDAH
I2  config/intake-matrix.json: 9 kategori + set per taskClass  (data, bukan kode)
I3  ops-watcher/intake-brief.mjs: gate + REQUIRED_SLOTS + penolakan bernama + test
I4  wiring: telegram-listener, kartu cockpit, kandidat venture
```

I2 sengaja data, bukan kode: bank pertanyaan akan sering berubah, dan perubahan
data tidak seharusnya menuntut perubahan kode.

## 6. Prioritas — jujur

Ini **tidak** mendahului deadline 2026-09-14. Kalau ASUS mati dan Aidit OS belum
berjalan sendiri di Lenovo, intake brief tidak menyelamatkan apa pun. Urutannya:
FIX 1 / W4, lalu cutover, baru ini.

## 7. Yang harus pemilik sadari sebelum ini dibangun

Gate ini akan **menolak permintaan pemilik sendiri**. Kalau pesan masuk dan
slotnya kosong, AHMAD membalas pertanyaan, bukan kerja. Itu memang yang diminta.
Tapi friksinya akan terasa justru di hari pemilik sedang buru-buru — dan hari
itulah gate ini paling berguna.

## 8. Yang masih terbuka

- Apakah batas 5 pertanyaan cukup untuk venture sebesar "Angel", atau perlu
  intake bertingkat (5 pertanyaan pembuka, lalu 5 lagi setelah dijawab).
- Apakah `taskClass` bisa disimpulkan otomatis dari pesan bebas, atau pemilik
  yang memilihnya dari kartu. Menyimpulkannya otomatis adalah tebakan lain lagi.
