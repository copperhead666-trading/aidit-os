'use client';

import { useState } from 'react';
import { Check, Loader2, TriangleAlert } from 'lucide-react';

export type OwnerAction = 'SETUJU' | 'REVISI' | 'TOLAK' | 'NANTI';

const ALL_ACTIONS: OwnerAction[] = ['SETUJU', 'REVISI', 'TOLAK', 'NANTI'];

// DESIGN.md: "The brand never uppercases display sizes." Shouted labels were
// half of why this row read as four dead boxes.
const LABEL: Record<OwnerAction, string> = {
  SETUJU: 'Setuju',
  REVISI: 'Revisi',
  TOLAK: 'Tolak',
  NANTI: 'Nanti',
};

// What actually happened, said in the owner's own voice. Each line matches a
// real state change in app/api/decision/route.ts — nothing here claims more
// than the server did.
const HASIL: Record<OwnerAction, string> = {
  SETUJU: 'Disetujui. Ahmad boleh jalan; eksekusinya mulai di sapuan berikutnya.',
  REVISI: 'Permintaan revisi tercatat. Nggak ada yang dikerjakan sampai rencana barunya lo setujui.',
  TOLAK: 'Ditolak. Perkaranya ditutup dan nggak akan dikerjakan.',
  NANTI: 'Ditunda. Tetap nunggu lo, nggak ada yang berubah.',
};

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

const TOMBOL =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-sm-t border px-4 font-sans text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none';

type Keadaan =
  | { fase: 'diam' }
  | { fase: 'menulis'; aksi: 'REVISI' }
  | { fase: 'kirim'; aksi: OwnerAction }
  | { fase: 'selesai'; aksi: OwnerAction }
  | { fase: 'gagal'; aksi: OwnerAction; alasan: string };

/**
 * The four answers the owner can give, and they now land.
 *
 * A press writes a real comment on the real issue and, for Setuju and Tolak,
 * changes the real state — the same writes the Telegram buttons perform, using
 * the same comment prefixes the runner matches on. When the write fails the
 * server's own reason is shown; this component never reports success it did
 * not receive.
 *
 * `terkunci` names why Setuju is not on offer. When it is set, approving is
 * genuinely pointless and the reason replaces the button.
 */
export function OwnerActions({
  identifier,
  terkunci = null,
}: {
  identifier: string;
  terkunci?: string | null;
}) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ fase: 'diam' });
  const [alasan, setAlasan] = useState('');
  const pilihan = terkunci ? ALL_ACTIONS.filter((a) => a !== 'SETUJU') : ALL_ACTIONS;

  async function kirim(aksi: OwnerAction, catatan: string | null) {
    setKeadaan({ fase: 'kirim', aksi });
    try {
      const res = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, action: aksi, alasan: catatan }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body: unknown = await res.json().catch(() => null);
      const ok =
        res.ok &&
        typeof body === 'object' &&
        body !== null &&
        (body as { ok?: unknown }).ok === true;
      if (ok) {
        setKeadaan({ fase: 'selesai', aksi });
        return;
      }
      const reason =
        typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string'
          ? (body as { reason: string }).reason
          : `gagal tersimpan (HTTP ${res.status})`;
      setKeadaan({ fase: 'gagal', aksi, alasan: reason });
    } catch {
      setKeadaan({ fase: 'gagal', aksi, alasan: 'nggak bisa menghubungi server — keputusan lo belum tercatat' });
    }
  }

  if (keadaan.fase === 'selesai') {
    return (
      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-os-text">
        <Check className="mt-[3px] h-4 w-4 shrink-0 text-os-ok" strokeWidth={2.2} aria-hidden="true" />
        <span>{HASIL[keadaan.aksi]}</span>
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {terkunci && (
        <p className="border-l border-os-warn pl-3 text-[13px] leading-relaxed text-os-muted">
          <span className="font-semibold text-os-text">Setuju nggak ditawarin di sini.</span> {terkunci}
        </p>
      )}

      {keadaan.fase === 'menulis' ? (
        <div className="space-y-2">
          <label htmlFor={`alasan-${identifier}`} className="block text-[13px] text-os-muted">
            Apa yang mau diubah?
          </label>
          <textarea
            id={`alasan-${identifier}`}
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Contoh: jangan sentuh berkas apa pun, cukup balas di komentar."
            className={`w-full rounded-sm-t border border-os-border-strong bg-os-bg2 px-3 py-2 font-sans text-[13px] text-os-text placeholder:text-os-muted ${FOKUS}`}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={alasan.trim().length === 0}
              onClick={() => void kirim('REVISI', alasan.trim())}
              className={`${TOMBOL} border-os-accent bg-os-accent text-os-ink hover:bg-os-accent2 ${FOKUS}`}
            >
              Kirim revisi
            </button>
            <button
              type="button"
              onClick={() => setKeadaan({ fase: 'diam' })}
              className={`${TOMBOL} border-transparent text-os-muted hover:bg-os-surface2 hover:text-os-text ${FOKUS}`}
            >
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div role="group" aria-label={`Jawaban lo untuk ${identifier}`} className="flex flex-wrap gap-2">
          {pilihan.map((aksi, index) => {
            const mengirim = keadaan.fase === 'kirim';
            const utama = index === 0;
            return (
              <button
                key={aksi}
                type="button"
                disabled={mengirim}
                onClick={() =>
                  aksi === 'REVISI' ? setKeadaan({ fase: 'menulis', aksi }) : void kirim(aksi, null)
                }
                className={`${TOMBOL} ${FOKUS} ${
                  utama
                    ? 'border-os-accent bg-os-accent text-os-ink hover:bg-os-accent2'
                    : 'border-os-border-strong text-os-muted hover:bg-os-surface2 hover:text-os-text'
                }`}
              >
                {mengirim && keadaan.aksi === aksi && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                )}
                {LABEL[aksi]}
              </button>
            );
          })}
        </div>
      )}

      <p aria-live="polite" className="text-[13px] leading-relaxed text-os-muted">
        {keadaan.fase === 'gagal' ? (
          <span className="flex items-start gap-2 text-os-err">
            <TriangleAlert className="mt-[3px] h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              <span className="font-semibold">Gagal.</span> {keadaan.alasan} Coba lagi, atau jawab lewat kartu
              Telegram.
            </span>
          </span>
        ) : keadaan.fase === 'kirim' ? (
          'Menyimpan…'
        ) : (
          'Jawaban lo langsung tercatat di perkaranya.'
        )}
      </p>
    </div>
  );
}
