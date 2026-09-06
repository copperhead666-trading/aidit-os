TUGAS: perbaiki satu positif-palsu pada pemeriksaan secret-shaped-literals di
ops-watcher/merge-steward.mjs, dengan tes.

CATATAN PENULISAN: berkas ini sengaja tidak pernah menaruh kata v-c-s tiga huruf
(g,i,t) pada baris yang sama dengan nama modul merge-steward atau dengan kata
kerja seperti commit, push, rebase, atau reset. Alasannya nyata: gerbang
keselamatan directive-runner memakai pola yang mencocokkan kata itu diikuti salah
satu kata kerja tersebut pada satu baris, dan tanda hubung adalah karakter
non-kata sehingga nama modul merge-steward sendiri ikut cocok. Directive
sebelumnya, KOL-92, ditolak persis karena itu.

MASALAHNYA, terukur 2026-09-06. Pemeriksaan secret-shaped-literals menembak pada
sebuah baris di dua worktree lane yang menulis sebuah hash SHA-1 empat puluh
karakter, seluruhnya angka nol, ke sebuah berkas stempel di dalam fixture tes.
Itu bukan kredensial.

Pemeriksaannya melakukan persis yang dispesifikasikan, yaitu deretan heksadesimal
panjang di dekat nama yang mencurigakan, dan ia salah ke arah memblokir, yang
merupakan arah aman untuk gerbang tanpa pengawasan. Tetapi ia akan memakan
perhatian pemilik pada setiap sapuan heartbeat sampai ia tahu bahwa sebuah hash
revisi bukan kredensial.

YANG HARUS BERUBAH: pemeriksaan itu tidak boleh menembak pada hash revisi.
Sebuah hash revisi adalah 40 atau 64 karakter heksadesimal huruf kecil tanpa
karakter lain. Sebuah hash yang seluruhnya nol jelas bukan rahasia; sebuah
literal dengan entropi nol tidak boleh dilaporkan sebagai kredensial.

YANG TIDAK BOLEH BERUBAH: pemeriksaan harus tetap menembak pada kredensial
sungguhan. Prefiks ghp_, sk-, dan pcp_, serta penugasan token, secret, key atau
password ke nilai acak, harus tetap gagal. Melonggarkan pemeriksaan sampai ia
berhenti menangkap apa pun lebih buruk daripada positif-palsu.

BERKAS YANG BOLEH DISUNTING, tidak ada yang lain:
- ops-watcher/merge-steward.mjs
- ops-watcher/merge-steward.regression.test.mjs

TES WAJIB:
1. Baris hash empat puluh nol itu TIDAK lagi menembak.
2. Hash revisi nyata 40 karakter heksadesimal huruf kecil TIDAK menembak.
3. Token acak 40 karakter yang ditugaskan ke nama berisi token TETAP menembak.
4. Prefiks ghp_, sk-, dan pcp_ TETAP menembak.
5. Seluruh suite tetap hijau.

VERIFIKASI dengan Node yang dipin, bukan node sistem. Node sistem v26 crash saat
teardown SETELAH tes lulus dan runner menghitungnya sebagai suite gagal. Jalankan
ops-watcher/merge-steward.regression.test.mjs lalu ops-watcher/run-all-tests.mjs
memakai D:\aidit-node\node-v22.14.0-win-x64\node.exe. Suite sekarang 86/86 dan
harus tetap 86/86.

CATATAN PERKAKAS: tulis tanda hubung ASCII, jangan em-dash. apply_patch codex
gagal berulang kali pada em-dash hari ini dan dua run mati di dinding 480 detik
karenanya.
