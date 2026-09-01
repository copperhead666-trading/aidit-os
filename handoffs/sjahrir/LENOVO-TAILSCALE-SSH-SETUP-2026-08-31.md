# Setup Tailscale + SSH: ASUS <-> Lenovo Black

## Temuan
Owner ingin dua mesin Windows (ASUS 'asus-gray' dan 'Lenovo black') bisa SSH connect otomatis kapan saja kedua mesin hidup, tanpa setting IP manual tiap kali.

Diagnosis 2026-08-31:
- ASUS **SUDAH** terhubung ke Tailscale tailnet (akun `pusatberasmurah@`, IP tailscale `100.113.151.82`, hostname `asus-gray`).
- OpenSSH SSH Server **SUDAH** running di ASUS.
- Firewall rule `OpenSSH SSH Server (sshd)` sudah enabled untuk inbound.
- SSH client (OpenSSH) tersedia di ASUS.
- **TAPI** `Lenovo black` belum pernah join tailnet yang sama sekali (dicek via `tailscale status` di ASUS, cuma muncul `asus-gray` + 1 iPhone offline).

Ini akar masalah kenapa dua mesin itu "tidak nyambung" — bukan masalah SSH config, tapi Lenovo belum ada di jaringan Tailscale yang sama.

## Langkah di Lenovo Black (jalankan manual oleh owner)

1. Install Tailscale di Lenovo: download dari https://tailscale.com/download/windows lalu install.
2. Jalankan `tailscale up` dan login pakai akun **YANG SAMA** (`pusatberasmurah@`) supaya Lenovo join tailnet yang sama dengan ASUS.
3. Enable OpenSSH SSH Server di Lenovo (PowerShell as Administrator):
   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```
4. Pastikan firewall Windows di Lenovo mengizinkan inbound port 22 (biasanya otomatis dibuat rule `OpenSSH SSH Server (sshd)` saat sshd pertama kali start; kalau tidak ada, buat manual:
   ```powershell
   New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH SSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
   ```

## Verifikasi dari ASUS setelah langkah di atas selesai

1. Jalankan `tailscale status` di ASUS → harus muncul entry baru untuk Lenovo dengan IP `100.x.x.x`.
2. Jalankan `ssh <username-windows-lenovo>@<ip-tailscale-lenovo>` dari ASUS untuk test connect (akan diminta password Windows Lenovo pertama kali).

## Kenapa ini "otomatis nyambung kalau kedua mesin hidup"

Tailscale berjalan sebagai service yang auto-start bareng Windows di kedua mesin. Begitu keduanya online dan login ke tailnet yang sama, IP tailscale masing-masing (`100.x.x.x`) selalu stabil dan reachable dari mesin satunya selama sama-sama nyala dan konek internet — tidak perlu setup port-forwarding, dynamic DNS, atau daemon tambahan.

SSH sendiri sifatnya on-demand (baru connect kalau ada yang menjalankan command ssh), jadi "otomatis" di sini berarti IP address dan network path-nya selalu siap dipakai, bukan berarti ada koneksi yang selalu terbuka.

## Opsional: SSH tanpa password tiap connect

Kalau owner mau tidak diminta password tiap SSH:

1. Di ASUS, generate key pair kalau belum ada: `ssh-keygen -t ed25519` (tekan Enter semua prompt untuk default, boleh kasih passphrase atau kosong).
2. Copy isi file public key (`~/.ssh/id_ed25519.pub`) di ASUS.
3. Di Lenovo, tempel isi itu ke file `C:\Users\<username>\.ssh\authorized_keys` (buat foldernya kalau belum ada).
   - Untuk akun Administrator Windows, lokasinya beda: `C:\ProgramData\ssh\administrators_authorized_keys`, dan perlu di-set permission read-only untuk SYSTEM + Administrators saja (lihat dokumentasi resmi Microsoft OpenSSH kalau user Lenovo adalah admin).
4. Setelah itu `ssh user@ip-tailscale-lenovo` tidak akan minta password lagi.
