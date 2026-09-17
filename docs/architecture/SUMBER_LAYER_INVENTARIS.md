# Inventaris sumber "10 layer" & "6 stack Bennett/FounderOS" — Aidit OS

Ditulis sesi instruksi-06 (2026-09-17), read-only terhadap `D:\AI\Aidit OS\` dan `D:\AI\`.
Bahan utama untuk PRD Aidit OS v6.

## Temuan utama (ringkas)

**Dokumen "10 layer" resmi yang selama ini dipakai di `docs/architecture/10_LAYER_AIDIT_OS.md`
(repo v5) SALAH SUMBER.** Ada PRD 10-layer asli, dibuat owner sendiri (`Owner: Aidit`, versi 1.0,
10 Sep 2026) di `D:\AI\Aidit OS\PRD-AIDIT-OS-10-LAYER.md` — dan isinya **beda total** dari
framework yang dipakai repo v5 sekarang. Repo v5 malah menebak 10 layer dari kerangka publik "The
Agent Stack" (sendiri ditandai TIDAK DIVERIFIKASI) lewat sebuah file audit, bukan dari PRD asli
owner. Dokumen 6-stack Bennett juga ada, lebih baru (14 Sep), dan **sudah memetakan dirinya sendiri
ke 10 layer PRD asli** — pemetaan ini juga tidak pernah dirujuk oleh repo v5.

## Dokumen sumber ditemukan

### 1. `D:\AI\Aidit OS\PRD-AIDIT-OS-10-LAYER.md` — **PRD 10-layer ASLI, paling otoritatif**
- Tanggal ubah: 10 Sep 2026, 09:18. Versi 1.0. Owner: Aidit. Status: "untuk dieksekusi".
- Ringkasan: PRD gerbang-dispatch + 10 layer agentic-system engineering (bukan 6-stack Bennett).
  Tiap layer punya definisi **Ideal** + **Uji** (cara verifikasi otomatis) + Definition of Done
  eksplisit. Jauh lebih rinci & bisa diverifikasi dibanding versi tebakan repo v5.
- **Kutipan daftar layer apa adanya** (baris 60-109):
  - L60-63: **Layer 1 — Harness Engineering**: "setiap task berjalan di git worktree sendiri
    dengan path allowlist..."
  - L64-67: **Layer 2 — Loop Engineering**: "setiap run punya tiga batas eksplisit: max steps,
    max wall-clock, max cost/token..."
  - L68-71: **Layer 3 — Context Engineering**: "Graphify meng-cover 100% repo aktif..."
  - L72-75: **Layer 4 — Tool Design**: "setiap tool punya schema input/output, klasifikasi efek
    samping (read/write/destructive), dan mode dry-run..."
  - L76-82: **Layer 5 — Memory Architecture**: "tiga tingkat memori dengan aturan lupa eksplisit
    — task memory, project memory, system memory..."
  - L83-86: **Layer 6 — Orchestration Patterns**: "satu orkestrator + N worker dari registry...
    quota pool berbeda boleh jalan bersamaan..."
  - L87-90: **Layer 7 — Guardrails & Permissions**: "allowlist perintah shell; protected paths;
    semua perubahan lewat branch+PR; kill switch dari Telegram dan CLI..."
  - L91-94: **Layer 8 — Evals for Agents**: "acceptance test ditulis SEBELUM task dieksekusi...
    task tanpa acceptance test ditolak masuk queue..."
  - L95-106: **Layer 9 — Human-in-the-Loop Design**: "eskalasi ke owner HANYA untuk keputusan
    fundamental... keputusan teknis 100% didelegasikan..."
  - L107-110: **Layer 10 — Observability & Tracing**: "satu trace ID per task, log terstruktur per
    step... `aidit trace <id>`..."
  - Catatan: **tidak ada Layer 0**. Layer dimulai dari 1.
- Prinsip mengikat lain yang relevan (baris 34-52): "orkestrator tidak menulis kode" (4.4),
  "paralelisme dibatasi quota pool" (4.2), "satu task satu workspace" (4.3), "registry sumber
  kebenaran" (4.6) — semua ini masih relevan langsung untuk v6.

### 2. `D:\AI\Aidit OS\docs\prd\PRD-AIDIT-OS-V5-ENAM-STACK.md` — 6-stack Bennett, **memetakan diri ke #1**
- Tanggal ubah: 14 Sep 2026, 19:34 (lebih baru dari PRD 10-layer). Status: "disetujui owner untuk
  dieksekusi malam ini". Judul asli: **"Enam Stack Bennett di atas Sepuluh Layer"** — sudah eksplisit
  bahwa 6-stack ini dimaksudkan sebagai overlay di ATAS 10-layer #1, bukan pengganti.
- Northstar: https://founderos-agent-stack.vercel.app (Bennett, "Founder OS — The Agent Stack") +
  repo `github.com/Bennettxai/FounderOS-DEMO` (MIT, vendored `vendor/founderos-demo`, commit d5e565e).
- **Kutipan daftar 6 stack** (baris 100-149, dengan pemetaan ke layer 10-layer di kurung):
  - §3.1 **Orchestrator** (Layer 6 Orchestration, 2 Loop, 9 HITL)
  - §3.2 **Back office** (Layer 5 Memory, 10 Observability)
  - §3.3 **Model lanes** (Layer 1 Harness, 4 Tool)
  - §3.4 **Worker pool** (Layer 7 Guardrails)
  - §3.5 **Hands** (Layer 4 Tool Design)
  - §3.6 **Metal** (Layer 7, 10)
- **Tabel pemetaan resmi 10 layer → bukti v5** (baris 151-164, kutip apa adanya):
  | Layer | Bukti v5 |
  |---|---|
  | 1 Harness | runner per lane dengan kurungan; probe 3/3 DENIED di luar workspace |
  | 2 Loop | Conductor 30 menit + heartbeat Paperclip; retry/fallback otomatis |
  | 3 Context | tiket + README venture + gbrain sebagai konteks; batas ukuran konteks per task |
  | 4 Tool | `.mcp.json` tunggal; tangan design & suara |
  | 5 Memory | Paperclip (state operasional), ledger v5 (peristiwa), gbrain (dokumen) |
  | 6 Orchestration | Conductor → kepala → pekerja; satu writer per worktree |
  | 7 Guardrails | Docker sandbox, guard hook, amplop otonomi §2.12-13, `/pause` |
  | 8 Evals | QA/Review = gerbang merge; acceptance per tiket harus mengeksekusi kriteria (R1-R5) |
  | 9 HITL | Telegram JARVIS: Report/Ask/Alert, lexicon, Indonesia formal, default bila diam |
  | 10 Observability | ledger v5 + trace per tiket + Report; deck mingguan |
- 8 departemen didefinisikan (baris 167 dst.): Product/PM, Engineering, Design, QA/Review,
  Ops/Infra, Finance/Kuota, Marketing/Content, Research.

### 3. `D:\AI\aidit-os-v5\docs\prd\PRD-AIDIT-OS-V5.1-HEMAT.md` §2 — versi hemat token (sudah di repo v5)
- Tanggal: 15 Sep 2026 (turunan langsung dari #2, disederhanakan untuk anggaran ±$100/bulan).
- Kutipan (baris 33-42): tabel "Peta enam layer Bennett → v5.1" — Orchestrator, Back office,
  Model lanes, Worker pool, Hands, Metal — **enam** layer, sama seperti #2, bukan 10.
- Ini SATU-SATUNYA PRD di `docs/prd/` repo v5 sebelum sesi ini (baru ditemukan: PRD 10-layer
  aslinya tidak pernah ikut dibawa/dikutip ke repo v5).

### 4. `D:\AI\aidit-os-v5\docs\architecture\10_LAYER_AIDIT_OS.md` — dokumen v5 SEKARANG (sebelum revisi instruksi-02/04)
- Framework yang dipakai: **L0 Substrate, L1 Model, L2 Prompt, L3 Context, L4 Tools, L5 Loop,
  L6 Memory, L7 Agents, L8 Orchestration, L9 Verification, L10 Interface** — 11 baris (L0-L10).
- Sumber yang diklaim: "AUDIT_AIDIT_OS_2026-09-17.md bagian 12" (sebuah audit, BUKAN PRD) +
  kerangka publik "The Agent Stack" (ditandai TIDAK DIVERIFIKASI di file itu sendiri).
- **Tidak cocok** dengan PRD 10-layer asli (#1) sama sekali — nama layer, jumlah (11 vs 10,
  karena ada L0), dan definisi semuanya berbeda. Ini KONTRADIKSI UTAMA yang ditemukan sesi ini.

### Dokumen lain bersinggungan (tidak dikutip detail, hanya dicatat lokasi — banyak sekali riwayat
`D:\AI\Aidit OS\handoffs\` dari akhir Agustus s.d. pertengahan September, mayoritas soal
reorganisasi roster/departemen, bukan definisi ulang 10 layer):
- `D:\AI\Aidit OS\docs\prd\PRD-AIDIT-OS-V2-HANDS-DAN-DETAK.md`, `PRD-AIDIT-OS-V3.md` — versi PRD
  lebih lama, sebelum 10-layer (v3 = "JARVIS", digantikan oleh #1 dan #2 per baris 5 dokumen #2).
- `D:\AI\Aidit OS\handoffs\hermes-kimi\BENNETT-ORG-PROPOSAL.md`,
  `handoffs\sjahrir\BENNETT-ROSTER-REDESIGN-PROPOSAL.md` — proposal organisasi/roster ala Bennett,
  bukan definisi layer.
- `D:\AI\Aidit OS\AUDIT.md` (top-level, 10 Sep) — audit skor per layer memakai framework PRD
  10-layer asli (#1) — **berbeda** dari `AUDIT_AIDIT_OS_2026-09-17.md` di repo v5 yang jadi sumber
  dokumen #4.

## Kontradiksi antar-dokumen

1. **Framework 10-layer beda total**: repo v5 (#4) pakai "Substrate/Model/Prompt/Context/Tools/
   Loop/Memory/Agents/Orchestration/Verification/Interface" (dari audit, tidak terverifikasi).
   PRD asli owner (#1) pakai "Harness/Loop/Context/Tool/Memory/Orchestration/Guardrails/Evals/
   HITL/Observability" (dari owner langsung, ada Ideal+Uji tiap layer). **#1 harus menang** —
   ditulis owner, punya kriteria verifikasi eksplisit, dan #2 (6-stack, disetujui owner 14 Sep)
   sudah memakainya sebagai basis pemetaan resmi.
2. **6-stack SELALU dimaksudkan sebagai overlay di atas 10-layer**, bukan pengganti atau paralel
   independen — judul dokumen #2 sendiri sudah bilang ini ("Enam Stack Bennett **di atas**
   Sepuluh Layer"). Dokumen v5 sekarang (#4) memperlakukan 10-layer dan 6-stack FounderOS sebagai
   dua kerangka SEJAJAR yang dibandingkan satu-satu (tabel "Ringkasan perbandingan dengan
   FounderOS") — ini keliru secara struktural: satu adalah organisasi/proses, satu lagi adalah
   kriteria kualitas per layer.
3. **Versi mana yang terbaru**: PRD 10-layer (#1, 10 Sep) adalah versi TERTUA dari tiga PRD utama,
   tapi tidak pernah digantikan — dokumen #2 (14 Sep) eksplisit bilang "PRD 10-Layer tetap
   sebagai standar kualitas per layer" (baris 6). Yang berubah/diringkas dari waktu ke waktu
   adalah 6-stack-nya (#2 → #3 versi hemat), bukan 10-layer-nya.
4. **Layer yang tidak pernah diimplementasikan** (dari PRD #1 §5 dan §8 Definition of Done,
   dibandingkan kondisi repo v5 hari ini per checkpoint/laporan instruksi-04/05/06):
   - **Layer 8 Evals**: "task tanpa acceptance test ditolak masuk queue" — TIDAK ADA gerbang
     seperti ini di v5; AID-102 (instruksi-04) baru mengusulkan gerbang test/typecheck sebelum
     merge, itupun untuk kode repo, bukan acceptance test per-task seperti dimaksud PRD asli.
   - **Layer 10 Observability**: `aidit trace <id>` (CLI trace per task) — tidak ada; yang ada
     cuma ledger.jsonl mentah, harus dibaca manual/`node conductor/status.mjs`.
   - **Layer 9 HITL, kriteria "0 pertanyaan teknis ke owner dari 20 task berturut-turut"** — belum
     pernah diukur; sesi-sesi sebelumnya (instruksi-01..05) justru menunjukkan banyak pertanyaan
     teknis-operasional (login akun, restart PM2) yang menurut definisi PRD asli seharusnya
     **tidak boleh** naik ke owner (itu "self-repair", bukan "keputusan fundamental").
   - **Registry `agents.registry.json`** (Layer 6, §7.1 kontrak) — konsep ini ada di Aidit OS lama
     tapi TIDAK ADA padanannya di repo v5 (v5 pakai `config/company.json` + `config/lanes.json`
     yang mirip tapi tidak identik strukturnya, dan tidak checked terhadap schema kontrak #1).

## Perbandingan tiga kerangka

| # | Kerangka | Sumber | Jumlah layer | Terverifikasi? | Status di v6 |
|---|----------|--------|--------------|-----------------|---------------|
| 1 | 10-layer Aidit (PRD asli) | `PRD-AIDIT-OS-10-LAYER.md`, owner, 10 Sep | 10 (L1-L10, tanpa L0) | ✅ ditulis owner langsung | **Usulan: jadi standar kualitas resmi v6** |
| 2 | 6-stack Bennett/FounderOS | `PRD-AIDIT-OS-V5-ENAM-STACK.md`, 14 Sep, disetujui owner | 6 | ✅ disetujui owner, tapi northstar-nya (situs+repo publik Bennett) tidak dicek ulang sesi ini | **Usulan: tetap dipakai sebagai kerangka organisasi/proses**, dipetakan ke #1 (bukan berdiri sendiri) |
| 3 | The Agent Stack (L0-L10 versi repo v5 sekarang) | Audit internal v5, bukan PRD | 11 (L0-L10) | ❌ ditandai TIDAK DIVERIFIKASI di dokumennya sendiri | **Usulan: pensiunkan** — gunakan istilahnya hanya sebagai catatan historis, bukan standar |

## Usulan kerangka resmi v6 (usulan, bukan keputusan)

**Pakai PRD 10-layer asli (#1) sebagai satu-satunya standar kualitas per layer**, dengan 6-stack
Bennett (#2) sebagai lapisan organisasi/proses yang dipetakan ke atasnya persis seperti tabel
§3.7 dokumen #2 (sudah ada, tinggal dipakai). Alasan:
1. #1 ditulis owner langsung dan setiap layer punya kriteria **Ideal + Uji** yang bisa dieksekusi
   — jauh lebih actionable daripada framework L0-L10 tebakan (#3) yang bahkan penulisnya sendiri
   menandai tidak terverifikasi.
2. #2 sudah eksplisit menyatakan dirinya sebagai overlay di atas #1, disetujui owner, dan sudah
   pernah dipetakan resmi (tabel §3.7) — tidak perlu dipetakan ulang dari nol.
3. Revisi `docs/architecture/10_LAYER_AIDIT_OS.md` (instruksi-02 bagian C, sesi ini) tetap
   berguna sebagai **snapshot status implementasi per Sep 17** tapi kolom "Nama layer" dan
   "Padanan"-nya perlu disusun ulang mengikuti #1, bukan #3, di siklus PRD v6 berikutnya.
4. Konsep registry (`agents.registry.json`, §7.1 dokumen #1) dan task spec dengan
   `acceptance_test` wajib (§7.2) layak diadopsi v6 — ini yang membuat Layer 8 (Evals) benar-benar
   bisa diverifikasi otomatis, bukan cuma kata sifat "sudah ada QA".

## File yang disalin ke repo v5 (bukan dipindah, sumber asli tetap di `D:\AI\Aidit OS\`)

- `docs/prd/legacy/PRD-AIDIT-OS-10-LAYER.md` (dari `D:\AI\Aidit OS\PRD-AIDIT-OS-10-LAYER.md`)
- `docs/prd/legacy/PRD-AIDIT-OS-V5-ENAM-STACK.md` (dari `D:\AI\Aidit OS\docs\prd\PRD-AIDIT-OS-V5-ENAM-STACK.md`)
