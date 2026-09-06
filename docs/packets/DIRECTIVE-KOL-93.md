TUGAS: perbaiki satu pesan yang berbohong di ops-watcher/lane-worktree.mjs,
dengan tes. Perubahan kecil, tetapi menyangkut kejujuran laporan.

MASALAHNYA, tercatat saat KOL-89 di-merge 2026-09-06. Di dalam
ensureLaneWorktree, satu blok catch menangani dua kegagalan yang berbeda: nama
lane yang tidak sah, dan sourceRepo yang tidak menghasilkan segmen direktori yang
sah. Keduanya dilaporkan dengan awalan yang sama, yaitu "bad lane name". Jadi
sebuah sourceRepo seperti "///" dilaporkan sebagai masalah nama lane.

Penyebab sebenarnya memang masih tersebut di dalam pesan, karena pesan error asli
ikut disalin, sehingga pembaca akhirnya melihat "sourceRepo directory name is
required". Dan derajat kegagalannya sudah benar: isolated bernilai false dan path
menunjuk source repo. Hanya awalannya yang berbohong.

Itu tetap layak diperbaiki. Modul ini ada justru karena kegagalan diam-diam
membuat orang percaya sesuatu yang tidak benar, dan sebuah awalan yang menyebut
sebab yang salah adalah bentuk kecil dari penyakit yang sama.

YANG HARUS BERUBAH: nama lane yang tidak sah tetap dilaporkan sebagai masalah
nama lane, dan sourceRepo yang tidak sah dilaporkan sebagai masalah sourceRepo.
Cara mencapainya diserahkan kepadamu; yang penting kedua sebab dapat dibedakan
oleh pembaca log tanpa harus menebak.

YANG TIDAK BOLEH BERUBAH: ensureLaneWorktree TIDAK BOLEH melempar, apa pun yang
terjadi. Itu kontraknya, dan sebuah dispatcher yang tidak bisa mendapat pohon
terisolasi harus tetap bisa berjalan. Derajat kegagalannya juga tetap: isolated
false, path menunjuk source repo yang sudah di-resolve, reason tidak kosong.
Perilaku tanpa sourceRepo harus tetap sama persis, dan suite yang ada sudah
menegaskan itu secara harfiah.

BERKAS YANG BOLEH DISUNTING, tidak ada yang lain:
- ops-watcher/lane-worktree.mjs
- ops-watcher/lane-worktree.regression.test.mjs

TES WAJIB:
1. Nama lane yang tidak sah menghasilkan reason yang menyebut nama lane.
2. sourceRepo yang tidak sah, misalnya "///", menghasilkan reason yang menyebut
   sourceRepo dan TIDAK menyebut nama lane sebagai sebabnya.
3. Kedua kasus tetap mengembalikan isolated false dan reason yang tidak kosong,
   dan tidak satu pun melempar.
4. Tes W3b yang menegaskan perilaku tanpa sourceRepo tidak berubah harus tetap
   lulus tanpa disunting.

VERIFIKASI dengan Node yang dipin di D:\aidit-node\node-v22.14.0-win-x64\node.exe,
bukan node sistem. Node sistem v26 crash saat teardown SETELAH tes lulus dan
runner menghitungnya sebagai suite gagal. Jalankan
ops-watcher/lane-worktree.regression.test.mjs lalu ops-watcher/run-all-tests.mjs.
Suite sekarang 86/86 dan harus tetap 86/86.

CATATAN PERKAKAS: tulis tanda hubung ASCII, jangan em-dash. apply_patch codex
gagal berulang kali pada em-dash hari ini dan dua run mati di dinding 480 detik
karenanya.
