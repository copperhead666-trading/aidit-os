import { PageHeader } from '@/components/PageHeader';

export default function HowPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Cara Pakai" />

      <p className="mt-6 text-os-text">
        Cockpit ini buat <span className="text-os-accent">melihat</span>, Telegram buat{' '}
        <span className="text-os-accent">bertindak</span>. Cockpit nggak bisa mengubah apa pun.
      </p>

      <div className="mt-8 space-y-8">
        <section className="border border-os-border p-4">
          <h2 className="text-os-text font-bold">
            <span className="text-os-accent">1.</span> Menyetujui
          </h2>
          <p className="mt-2 text-os-text">
            Ketuk tombol <span className="text-os-warn">SETUJUI</span> atau{' '}
            <span className="text-os-err">TOLAK</span> di kartu keputusan yang masuk ke Telegram.
            Tombol <span className="text-os-text">DETAIL</span> menampilkan info lebih lanjut
            tentang item itu, dan <span className="text-os-text">TUNDA</span> menunda keputusannya.
          </p>
          <p className="mt-2 text-os-muted">
            Yang terjadi: label <code>OWNER_REQUIRED</code> dilepas, keputusan tercatat sebagai
            komentar di isu itu, dan satu sapuan heartbeat langsung dijalankan.
          </p>
        </section>

        <section className="border border-os-border p-4">
          <h2 className="text-os-text font-bold">
            <span className="text-os-accent">2.</span> Berkomentar
          </h2>
          <p className="mt-2 text-os-text">
            Balas (reply) kartu keputusan itu dengan teks biasa.
          </p>
          <p className="mt-2 text-os-muted">
            Yang terjadi: balasan menempel sebagai komentar OWNER NOTE di isu yang sama, dan bot
            mengirim konfirmasi berisi potongan teks lo.
          </p>
        </section>

        <section className="border border-os-border p-4">
          <h2 className="text-os-text font-bold">
            <span className="text-os-accent">3.</span> Menugaskan
          </h2>
          <p className="mt-2 text-os-text">
            Kirim pesan biasa ke bot, bukan reply.
          </p>
          <p className="mt-2 text-os-muted">
            Yang terjadi: pesan itu jadi isu baru berjudul &ldquo;OWNER DIRECTIVE:&rdquo;, dilabeli{' '}
            <code>DIRECTIVE</code>, ditugaskan ke AHMAD, dan lo dapat tanda terima dalam hitungan
            detik. Sesudah itu AHMAD menyusun rencana dan mengirimkannya balik ke lo sebagai
            kartu — jadi menugaskan selalu berujung ke gerakan nomor satu.
          </p>
        </section>
      </div>

      <div className="mt-8 border border-os-border-strong p-4">
        <h2 className="text-os-text font-bold">Kalau ada yang macet</h2>
        <p className="mt-2 text-os-muted">
          Rencana bisa gagal disusun, atau ditolak karena perintah verifikasinya di luar batas
          aman. Kalau itu terjadi berulang, sistem menyerah dan menaikkannya ke lo sebagai kartu
          dengan alasannya. Halaman Tasks di cockpit ini menunjukkan apa yang sedang menunggu lo.
        </p>
      </div>

      <p className="mt-8 text-os-dim text-sm">
        Cockpit ini cuma bisa dilihat dari perangkat yang tersambung ke tailnet, dan laptopnya
        harus menyala.
      </p>
    </div>
  );
}