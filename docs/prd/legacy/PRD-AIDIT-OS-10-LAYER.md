# PRD — Aidit OS: 10-Layer Agentic System

**Versi:** 1.0
**Owner:** Aidit
**Status:** untuk dieksekusi oleh agent terminal (interactive session)
**Hard constraint:** Lenovo B40-70 (10GB RAM, no Docker) sebagai satu-satunya mesin lokal

---

## 1. Masalah

Aidit OS dibangun untuk mengeksekusi pekerjaan owner (venture, backlog, operasional) tanpa owner mengurus jalannya sistem itu sendiri. Hari ini sistemnya belum sampai di sana:

- Orkestrator (Ahmad) pernah dicoba lewat Telegram dan hasilnya berantakan.
- Worker sempat dihapus karena rebutan quota pool yang sama.
- Aidit OS saat ini justru dibangun **secara manual lewat interactive session**, bukan oleh Aidit OS sendiri.

Akar masalahnya bukan kurang canggih, tapi belum ada **gerbang dispatch**: kontrak formal yang bikin orkestrator mampu memilih, memanggil, dan memverifikasi agent di bawahnya secara aman dan tidak saling tabrakan.

## 2. Tujuan

1. **Gerbang dispatch berfungsi** — orkestrator bisa mendelegasikan pekerjaan ke agent/runtime manapun yang terdaftar di registry, tanpa quota clash dan tanpa tabrakan filesystem.
2. **10 layer terimplementasi sampai "ideal"** (definisi di §5), sebagian besar dikerjakan oleh Aidit OS sendiri lewat gerbang dispatch tadi.
3. **Owner lepas dari maintenance** — owner hanya menyentuh keputusan fundamental, tidak pernah keputusan teknis.
4. Setelah ideal: orkestrator menjalankan payload (prioritas SJS Super Apps) dan mengusulkan PRD untuk backlog yang belum punya PRD.

## 3. Non-Goals (v1)

- Bukan "Jarvis". Voice, proaktivitas, dan inisiatif mandiri **ditunda** sampai 10 layer ideal.
- Bukan zero-mistake. Target yang benar: **contained, detected, reversible** (lihat §4.1).
- Bukan multi-mesin. Tidak ada VPS, tidak ada node kedua, tidak ada Docker.
- Bukan menulis ulang Aidit OS dari nol. Yang ada dipakai, yang kurang ditambal.

## 4. Prinsip Desain (mengikat, tidak boleh dilanggar agent)

**4.1 — Salah itu wajar, lolos ke produksi itu tidak.**
Setiap kesalahan harus: terjadi di workspace terisolasi, terdeteksi oleh acceptance test sebelum merge, dan bisa di-rollback dengan satu perintah. Sistem yang mengejar "tidak pernah salah" akan berubah jadi sistem yang bertanya terus ke owner — itu kegagalan, bukan kehati-hatian.

**4.2 — Paralelisme dibatasi quota pool, bukan ambisi.**
Dua agent boleh jalan bersamaan **hanya jika** quota pool-nya berbeda (contoh: runtime lokal/cloud non-Claude vs runtime Claude). Agent dengan quota pool sama **antre**, tidak paralel. Ini pelajaran dari kegagalan sebelumnya dan bersifat mengikat.

**4.3 — Satu task, satu workspace.**
Tidak ada dua agent menulis di working directory yang sama. Isolasi lewat git worktree per task.

**4.4 — Orkestrator tidak menulis kode.**
Orkestrator hanya: decompose → route → verify → escalate. Begitu orkestrator menulis kode sendiri, layer orkestrasi runtuh jadi single-agent.

**4.5 — Konteks masuk lewat graph, bukan lewat repo mentah.**
Agent tidak pernah membaca seluruh repo. Masuk lewat index Graphify + task brief. Graphify saat ini belum meng-cover semua repo — melengkapinya adalah bagian dari Layer 3.

**4.6 — Registry adalah sumber kebenaran soal agent.**
Tidak ada nama agent atau runtime yang di-hardcode di kode manapun. Semua dibaca dari `agents.registry.json`. Agent yang mengerjakan PRD ini **wajib membaca registry yang ada**, bukan mengarang daftar agent.

---

## 5. Definisi "Ideal" per Layer

Format: **Ideal** = kondisi target. **Uji** = cara membuktikannya, harus otomatis dan bisa diulang.

### Layer 1 — Harness Engineering
**Ideal:** setiap task berjalan di git worktree sendiri dengan path allowlist. Agent tidak bisa menulis di luar workspace-nya, tidak bisa menyentuh `.env`, branch `main`, atau direktori data operasional.
**Uji:** jalankan task sintetis yang mencoba menulis ke `../` dan ke `main` → keduanya ditolak dan tercatat di trace.

### Layer 2 — Loop Engineering
**Ideal:** setiap run punya tiga batas eksplisit: max steps, max wall-clock, max cost/token. Stop condition: exit criteria terpenuhi **atau** budget habis **atau** dua kali gagal verifikasi berturut-turut. Tidak ada loop tanpa ujung.
**Uji:** task yang sengaja tidak mungkin selesai harus berhenti sendiri dalam batas waktu yang ditetapkan, dengan status `failed:budget_exhausted`, bukan menggantung.

### Layer 3 — Context Engineering
**Ideal:** Graphify meng-cover 100% repo aktif. Agent menerima paket konteks = graph slice relevan + task brief + kontrak, bukan dump direktori. Token per task tercatat per run.
**Uji:** `graphify status` melaporkan coverage per repo; token/task tercatat di trace dan tren turun dibanding baseline audit.

### Layer 4 — Tool Design
**Ideal:** setiap tool punya schema input/output, klasifikasi efek samping (`read` / `write` / `destructive`), dan mode dry-run. Tool `destructive` wajib lewat guardrail Layer 7. Tidak ada tool tanpa test.
**Uji:** tool registry lengkap; setiap tool punya minimal satu test; dry-run bisa dipanggil untuk semua tool `write` dan `destructive`.

### Layer 5 — Memory Architecture
**Ideal:** tiga tingkat memori dengan aturan lupa eksplisit —
- *task memory*: hidup selama run, dibuang saat task selesai;
- *project memory*: keputusan & ADR, persist, append-only;
- *system memory*: registry, policy, kalibrasi routing.
**Uji:** matikan mesin di tengah antrian, nyalakan lagi → orkestrator melanjutkan tanpa owner menjelaskan ulang apapun.

### Layer 6 — Orchestration Patterns
**Ideal:** satu orkestrator + N worker dari registry. Orkestrator memilih runtime berdasarkan capability + quota pool + cost class + health check, lalu memverifikasi hasil sebelum merge. Antrean per quota pool dengan lock; pool berbeda boleh jalan bersamaan.
**Uji:** kirim 3 task sekaligus yang butuh 2 pool berbeda → yang beda pool jalan paralel, yang sama pool antre, nol quota clash, nol konflik file.

### Layer 7 — Guardrails & Permissions
**Ideal:** allowlist perintah shell; protected paths (`main`, `.env`, kredensial, data uang/stok/karyawan); semua perubahan masuk lewat branch + PR, tidak pernah push langsung ke `main`; kill switch tersedia dari Telegram dan CLI; rollback satu perintah.
**Uji:** lima percobaan pelanggaran (push ke main, baca `.env`, hapus direktori, install paket di luar allowlist, akses data operasional) → lima-limanya ditolak dan ter-log.

### Layer 8 — Evals for Agents
**Ideal:** acceptance test ditulis **sebelum** task dieksekusi dan jadi bagian dari task spec. Ada golden set trajectory untuk menguji regresi keputusan orkestrator (routing benar, eskalasi benar, stop benar).
**Uji:** `aidit eval` jalan satu perintah dan melaporkan pass rate; task tanpa acceptance test **ditolak masuk queue**.

### Layer 9 — Human-in-the-Loop Design
**Ideal:** eskalasi ke owner **hanya** untuk keputusan fundamental:
- definisi produk / perubahan scope PRD
- uang keluar (biaya baru, langganan, tarif)
- akses atau perubahan data karyawan/pelanggan/stok riil
- penghapusan data permanen
- konflik antar PRD atau prioritas antar venture

Keputusan teknis (library, struktur folder, pola kode, urutan kerja, nama variabel, trade-off implementasi) **100% didelegasikan** — agent memutuskan sendiri dan mencatat alasannya di ADR.
Format eskalasi wajib: satu pertanyaan + opsi A/B/C + rekomendasi + konsekuensi + **default jika owner diam >24 jam**.
**Uji:** dari 20 task berturut-turut, jumlah pertanyaan teknis ke owner = 0.

### Layer 10 — Observability & Tracing
**Ideal:** satu trace ID per task, log terstruktur per step (input ringkas, tool call, hasil, biaya, durasi), dan `aidit trace <id>` bisa menunjukkan langkah ke-14 dari 30 tanpa owner membuka log mentah.
**Uji:** ambil satu task yang gagal, reproduksi titik kegagalannya hanya lewat perintah `aidit trace`, tanpa membaca file log manual.

### Kriteria "Ideal" tingkat sistem
Aidit OS dinyatakan ideal jika: **owner tidak menyentuh laptop selama 7 hari berturut-turut, antrean tetap jalan atau berhenti dengan aman, dan tidak ada satupun pertanyaan teknis masuk ke Telegram owner.**

---

## 6. Fase Eksekusi

### Fase 0 — Audit (wajib pertama, tidak boleh dilewati)
Agent memetakan kondisi nyata Aidit OS lewat Graphify dan menghasilkan `AUDIT.md`:
- skor tiap layer: `0 = tidak ada`, `1 = ada sebagian`, `2 = jalan tapi rapuh`, `3 = ideal per §5`
- bukti untuk tiap skor (path file, perintah yang dijalankan, output)
- isi `agents.registry.json` yang **ditemukan**, bukan yang diasumsikan
- daftar quota pool dan siapa saja yang berbagi pool
- coverage Graphify per repo
- tiga bottleneck teratas

Audit tidak boleh mengubah file apapun.

### Fase 1 — Gerbang Dispatch (Layer 6 + fondasi 1, 2, 10)
Deliverable:
1. `agents.registry.json` — schema §7.1, diisi dari kondisi nyata hasil audit
2. Task spec schema — §7.2
3. Router — dipimpin LLM orkestrator, **tapi terkurung**: hanya boleh memilih agent yang ada di registry, lolos health check, dan pool-nya bebas
4. Adapter per runtime dengan interface seragam (`prepare → run → collect → verify`)
5. Queue + lock per quota pool
6. Trace logger (Layer 10 minimum viable: trace ID, step log, biaya)
7. CLI: `aidit audit | dispatch | status | trace | kill`

**Gate keluar Fase 1:** uji Layer 6 di §5 lulus (3 task, 2 pool, nol clash). Sebelum lulus, dilarang lanjut ke Fase 2.

### Fase 2 — Sisa layer, dikerjakan oleh Aidit OS sendiri
Setiap layer yang skornya < 3 dijadikan task, masuk queue, dan dieksekusi lewat gerbang dispatch. Urutan wajib: **7 (guardrails) → 1 → 2 → 10 → 3 → 5 → 4 → 8 → 9**. Guardrail didahulukan karena mulai titik ini sistem menulis kodenya sendiri.

Agent terminal berpindah peran di fase ini: dari pelaksana jadi **supervisor** — memantau queue, memperbaiki yang macet, tidak lagi menulis fitur sendiri.

### Fase 3 — Payload
Setelah semua layer skor 3:
- PRD yang sudah ada (prioritas: SJS Super Apps) → orkestrator decompose dan tunjuk agent
- Backlog tanpa PRD (mis. Health OS) → orkestrator **menyusun draft PRD dan mengusulkan ke owner** lewat format eskalasi §5 Layer 9; tidak mengeksekusi sebelum PRD disetujui
- Beberapa PRD boleh jalan bersamaan sepanjang aturan quota pool §4.2 terpenuhi

---

## 7. Kontrak

### 7.1 `agents.registry.json`
```json
{
  "agents": [{
    "id": "string",
    "runtime": "string",
    "endpoint": "string",
    "capabilities": ["coding", "heavy_reasoning", "review", "orchestration"],
    "quota_pool": "string",
    "cost_class": "free | metered | premium",
    "max_concurrency": 1,
    "context_window": 0,
    "health_check": "perintah atau endpoint",
    "status": "active | disabled",
    "notes": "string"
  }]
}
```
Dua agent dengan `quota_pool` sama tidak pernah dijadwalkan bersamaan.

### 7.2 Task Spec
```json
{
  "id": "string",
  "goal": "satu kalimat",
  "exit_criteria": ["terukur, bukan kata sifat"],
  "acceptance_test": "perintah yang mengembalikan exit code",
  "context_refs": ["graphify slice / path"],
  "constraints": { "max_steps": 0, "max_minutes": 0, "max_cost": 0 },
  "required_capabilities": ["..."],
  "protected": ["path yang haram disentuh"],
  "escalation": "fundamental_only",
  "trace_id": "string"
}
```
Task tanpa `acceptance_test` ditolak masuk queue.

### 7.3 Format Eskalasi ke Owner
```
[ESKALASI] <judul singkat>
Konteks: 2 kalimat maksimal
Pertanyaan: satu pertanyaan saja
Opsi: A) ... B) ... C) ...
Rekomendasi: <opsi> — alasan satu kalimat
Konsekuensi: apa yang berubah dari tiap opsi
Default jika tidak dijawab 24 jam: <opsi>
```

---

## 8. Definition of Done

Aidit OS v1 selesai ketika **semua** berikut benar:

1. `AUDIT.md` menunjukkan sepuluh layer berskor 3, dengan bukti uji tiap layer.
2. Uji Layer 6 lulus: 3 task, 2 quota pool, nol clash, nol konflik file.
3. Uji Layer 7 lulus: lima percobaan pelanggaran ditolak semua.
4. `aidit trace <id>` bisa menampilkan step ke-14 dari task 30 step.
5. Restart mesin di tengah antrean → antrean lanjut sendiri.
6. Dua puluh task berturut-turut selesai dengan nol pertanyaan teknis ke owner.
7. Orkestrator berhasil mengusulkan minimal satu draft PRD dari backlog tanpa PRD.

## 9. Larangan Mutlak untuk Agent Pelaksana

- Dilarang mengarang nama agent atau runtime yang tidak ada di registry.
- Dilarang menulis kode apapun sebelum `AUDIT.md` selesai.
- Dilarang push langsung ke `main`.
- Dilarang menambah dependensi berat atau layanan yang butuh mesin kedua (Docker, cluster, VPS).
- Dilarang menjalankan dua agent ber-quota pool sama secara bersamaan.
- Dilarang bertanya ke owner soal keputusan teknis — putuskan sendiri, catat di ADR.
- Dilarang menandai layer sebagai "ideal" tanpa menjalankan uji di §5 dan melampirkan outputnya.
