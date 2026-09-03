export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { readOpenDecisions } from '@/lib/sources';
import { readInbox } from '@/lib/inbox';
import { gabung } from '@/components/keputusan';
import { kenapaGabisaDisetujui } from '@/components/keputusan';
import { CaseDetail } from '@/components/CaseDetail';
import { OwnerActions } from '@/components/OwnerActions';
import { Dot } from '@/components/terminal';
import { FRAME } from '@/lib/kata';

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

function Kembali() {
  return (
    <Link
      href="/"
      className={`-ml-2 mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm-t px-2 font-sans text-[13px] text-os-muted transition-colors hover:text-os-text ${FOKUS}`}
    >
      <ChevronLeft className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      {FRAME.brief}
    </Link>
  );
}

/**
 * One case, opened. This is where every answer is given: the closed card in the
 * brief carries no buttons, so a decision cannot be made without the record in
 * front of him.
 */
export default async function CasePage({ params }: { params: { id: string } }) {
  const identifier = decodeURIComponent(params.id);
  const [openDecisions, inbox] = await Promise.all([readOpenDecisions(), readInbox()]);

  if (openDecisions === null) {
    return (
      <div className="view max-w-[760px] pb-10">
        <Kembali />
        <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
          <Dot state="off" />
          <span>
            <span className="font-semibold text-os-text">Papan kerja tidak terbaca.</span> Isinya
            sengaja dikosongkan daripada menampilkan angka yang tidak benar.
          </span>
        </p>
      </div>
    );
  }

  const m = gabung(openDecisions, inbox).find((x) => x.d.identifier === identifier) ?? null;

  if (m === null) {
    return (
      <div className="view max-w-[760px] pb-10">
        <Kembali />
        <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
          <Dot state="ok" />
          <span>
            <span className="font-semibold text-os-text">{identifier}</span> sudah tidak menunggu
            Anda. Perkaranya ditutup, dijawab, atau tidak pernah ada di papan kerja.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="view max-w-[760px] pb-10">
      <Kembali />
      <CaseDetail m={m} />
      <div className="mt-6 border-t border-os-border pt-5">
        <OwnerActions identifier={m.d.identifier} terkunci={kenapaGabisaDisetujui(m)} />
      </div>
    </div>
  );
}
