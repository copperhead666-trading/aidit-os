# Prompt untuk sesi/agent berikutnya — tinggal copy-paste

Paste teks di bawah ini persis sebagai pesan pertama ke agent baru.

---

Lanjutin kerjaan FounderOS-Aidit yang sempet keputus. Sebelum ngapa-ngapain lagi, baca dulu dua file ini SECARA PENUH, urut:

1. `D:\AI\Active FounderOS-Aidit\handoffs\ahmad\AHMAD-SESSION-HANDOFF-2026-08-30-MASTER.md` — ringkasan komprehensif seluruh sesi: narasi percakapan, status semua fase P0-P7, ventures, modul yang dibangun, temuan investigasi P6, standing preference OWNER, dan daftar prioritas.
2. `D:\AI\Active FounderOS-Aidit\handoffs\ahmad\AHMAD-SESSION-HANDOFF-2026-08-30-TELEGRAM-FIX-INTERRUPTED.md` — detail teknis bug live yang lagi diperbaiki (masih belum selesai).

Jangan mulai kerja sebelum kedua file itu kebaca penuh — semua konteks yang lo butuh ada di situ, jangan re-derive dari nol.

Urutan prioritas setelah baca (JANGAN lompat urutan):

1. **Cek dulu**: apakah laptop OWNER masih ngespawn terminal berulang-ulang? Tanya langsung ke OWNER kalau perlu. Kalau masih kejadian, itu prioritas nomor satu di atas segalanya — lihat section 11 di file MASTER untuk arah investigasi (PM2 restart-loop, Task Scheduler, dll — belum ke-root-cause, jangan asal tebak).
2. Kalau laptop udah aman: lanjutin fix bug dynamic Telegram decision-card (section 9 file MASTER, detail penuh di file TELEGRAM-FIX-INTERRUPTED). Langkah konkretnya udah ada persis di file itu — jalanin live-verification probe ke Paperclip asli dulu SEBELUM kirim ulang card ke KOL-65/KOL-66, karena bug sebelumnya lolos justru karena cuma dites lawan mock, gak lawan API asli.
3. Baca 3 file scratchpad dari dispatch HATTA yang udah selesai tapi belum kebaca (section 8 file MASTER) — kalau filenya masih ada, itu kemungkinan besar udah berisi rencana kerja nyata buat KOL-62 (SJS) dan KOL-64 (FOS-21). Kalau filenya udah hilang, dispatch ulang pakai prompt yang sama (ada di section 8).
4. KOL-62, KOL-63, KOL-64 itu APPROVAL ASLI dari OWNER via Telegram (udah diverifikasi langsung ke Paperclip API, bukan asumsi) — aman buat mulai dieksekusi begitu langkah 2-3 beres. KOL-63 (Caveman) WAJIB tetep respect freeze trading D-4.3, jangan pernah nulis kode eksekusi trading.
5. Jangan mulai kerjaan P6 (migrasi cloud) sampai gap arsitektur di section 6 file MASTER (Cloudflare Workers gak bisa spawn child process) ada jawabannya — itu instruksi eksplisit OWNER: "fill the gap dulu baru migrasi."

Kerja seperti biasa: verifikasi pakai bukti nyata (jalanin test, cek API asli), jangan klaim selesai sebelum diverifikasi, dan kalau ada pertanyaan produk/bisnis/legal/finansial yang genuinely butuh keputusan OWNER, kirim lewat Telegram — tapi keputusan teknis/engineering putuskan sendiri (sudah standing rule dari OWNER).
