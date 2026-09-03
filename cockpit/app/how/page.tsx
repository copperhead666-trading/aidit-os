import { PageHeader } from '@/components/PageHeader';

/**
 * Rewritten 2026-09-03. The previous version told the owner "Cockpit nggak bisa
 * mengubah apa pun" — which stopped being true the day owner actions began
 * writing to real issues. A page that lies about what the buttons do is worse
 * than no page.
 */
export default function HowPage() {
  return (
    <div className="max-w-2xl pb-10">
      <PageHeader title="How to use" />

      <p className="mt-6 text-[14px] leading-relaxed text-os-text">
        Cockpit adalah pintunya: di sinilah Anda membaca perkara dan memberi jawaban, dan jawaban
        itu langsung tercatat di papan kerja. Telegram adalah loncengnya: ia memberi tahu Anda
        bahwa ada yang menunggu, dan tetap bisa dipakai menjawab kalau Anda sedang jauh dari
        cockpit.
      </p>

      <div className="mt-8 space-y-4">
        <section className="rounded-md-t border border-os-border bg-os-surface p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-accent">
            1 · Answering a case
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-os-text">
            Buka perkaranya dari brief, baca seluruh catatannya, lalu tekan{' '}
            <span className="font-semibold">Approve</span>,{' '}
            <span className="font-semibold">Revise</span>,{' '}
            <span className="font-semibold">Decline</span>, atau{' '}
            <span className="font-semibold">Defer</span>. Kartu tertutup di brief sengaja tidak
            membawa tombol: keputusan diberikan setelah catatannya di depan Anda, bukan sebelum.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-os-muted">
            Yang terjadi: label <code>OWNER_REQUIRED</code> dilepas, keputusan Anda tercatat
            sebagai komentar di perkara itu, dan satu sapuan heartbeat langsung dijalankan.
          </p>
        </section>

        <section className="rounded-md-t border border-os-border bg-os-surface p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-accent">
            2 · Adding a note
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-os-text">
            Balas kartu keputusan di Telegram dengan teks biasa.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-os-muted">
            Yang terjadi: balasan menempel sebagai komentar OWNER NOTE di perkara yang sama, dan
            bot mengirim konfirmasi berisi potongan teks Anda.
          </p>
        </section>

        <section className="rounded-md-t border border-os-border bg-os-surface p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-accent">
            3 · Giving an instruction
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-os-text">
            Kirim pesan biasa ke bot — bukan balasan.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-os-muted">
            Yang terjadi: pesan itu menjadi perkara baru berjudul &ldquo;OWNER DIRECTIVE:&rdquo;,
            dilabeli <code>DIRECTIVE</code>, ditugaskan ke AHMAD, dan Anda menerima tanda terima
            dalam hitungan detik. Sesudah itu AHMAD menyusun rencana dan mengembalikannya kepada
            Anda sebagai perkara — jadi memberi instruksi selalu berujung kembali ke langkah satu.
          </p>
        </section>
      </div>

      <div className="mt-8 rounded-md-t border border-os-border-strong p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">
          When something is blocked
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-os-muted">
          Rencana bisa gagal disusun, atau ditolak karena perintah verifikasinya di luar batas
          aman. Kalau itu terjadi berulang, sistem berhenti mencoba dan menaikkannya kepada Anda
          beserta alasannya. Halaman Attention menunjukkan semua yang sedang tersendat.
        </p>
      </div>

      <p className="mt-8 text-[13px] leading-relaxed text-os-dim">
        Cockpit hanya bisa dibuka dari perangkat yang tersambung ke tailnet, dan laptopnya harus
        menyala. Tambahkan ke Home Screen di iPhone: dalam mode itu Safari melepas bilah alamat
        dan layar yang terbaca bertambah dari 664 menjadi 763 titik.
      </p>
    </div>
  );
}
