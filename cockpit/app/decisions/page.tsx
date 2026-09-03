export const dynamic = 'force-dynamic';

import { Activity, Inbox, ListChecks, TriangleAlert } from 'lucide-react';
import { readDecisions, type DecisionRecord } from '@/lib/founderos';
import { readOpenDecisions } from '@/lib/sources';
import { readInbox } from '@/lib/inbox';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, SectionHead, SectionTitle } from '@/components/terminal';
import { Tile, TileGrid } from '@/components/Tile';
import { DecisionCard, statusIndonesia } from '@/components/DecisionCard';
import {
  butuhJawaban,
  gabung,
  lagiJalan,
  nyangkut,
  umurMs,
  urutkan,
} from '@/components/keputusan';
import { judulSingkat, umurSingkat } from '@/components/waktu';

/** The line between "waiting" and "waiting too long", in the tiles. */
const EMPAT_HARI = 4 * 24 * 60 * 60 * 1000;

const DAFTAR = 'overflow-hidden rounded-md-t border border-os-border bg-os-surface';

// The ledger speaks in schema words. These are the same things said out loud.
const JENIS_ID: Record<string, string> = {
  DECISION: 'Yang udah diputusin',
  PRINCIPLE: 'Prinsip yang lo pegang',
  HISTORICAL_STATE: 'Keadaan lama',
  IMPLEMENTATION_REALITY: 'Kenyataan di lapangan',
  AGENT_GENERATED: 'Dibikin agen',
  DESIGN_REQUIRED: 'Masih perlu dirancang',
  EXTERNAL_VERIFICATION: 'Perlu dicek pihak luar',
};

const ASAL_ID: Record<string, string> = {
  OWNER_DECISION: 'keputusan lo',
  DIRECT_OWNER_STATEMENT: 'ucapan langsung lo',
  OWNER_APPROVED: 'lo setujui',
  OWNER_REQUIRED: 'nunggu lo',
  UNKNOWN: 'asalnya nggak jelas',
  SUPERSEDED: 'udah diganti',
  IMPLEMENTATION_REALITY: 'kenyataan di lapangan',
  AGENT_GENERATED: 'dibikin agen',
  DESIGN_REQUIRED: 'belum dirancang',
  LEGAL_REVIEW_REQUIRED: 'nunggu cek hukum',
};

function terjemah(kamus: Record<string, string>, kunci: string): string {
  return kamus[kunci] ?? kunci.toLowerCase().replace(/_/g, ' ');
}

function SumberMati({ apa }: { apa: string }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="off" />
      <span className="min-w-0">
        <span className="font-semibold text-os-text">{apa} nggak kebaca.</span> Isinya sengaja
        dikosongin.
      </span>
    </p>
  );
}

function Kosong({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="ok" />
      {children}
    </p>
  );
}

function BarisCatatan({ r }: { r: DecisionRecord }) {
  const diganti = r.status === 'SUPERSEDED';
  return (
    <li
      className={`space-y-1.5 border-b border-os-hairline px-3 py-3.5 last:border-b-0 ${
        diganti ? 'opacity-65' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-os-muted">
        <span className="font-mono text-[12px]">{r.id}</span>
        <span className="text-os-dim" aria-hidden="true">
          ·
        </span>
        <span>{r.domain}</span>
        <span className="text-os-dim" aria-hidden="true">
          ·
        </span>
        <span>{terjemah(ASAL_ID, r.status)}</span>
        {r.canonical === true && <Badge tone="accent">resmi</Badge>}
        {typeof r.migrated_from === 'string' && (
          <Badge tone="default" ghost>
            pindahan
          </Badge>
        )}
      </div>
      <p className="max-w-[74ch] text-[13px] leading-relaxed text-os-text">{r.statement}</p>
    </li>
  );
}

export default async function DecisionsPage() {
  const [ledger, openDecisions, inbox] = await Promise.all([
    readDecisions(),
    readOpenDecisions(),
    readInbox(),
  ]);

  const semua = openDecisions === null ? null : gabung(openDecisions, inbox);
  const antre = semua === null ? null : urutkan(butuhJawaban(semua));
  const macet = semua === null ? null : urutkan(nyangkut(semua));
  const jalan = semua === null ? null : lagiJalan(semua);
  const records = ledger?.records ?? null;

  const resmi = records?.filter((r) => r.canonical === true).length ?? 0;

  const lamaNunggu = (antre ?? []).filter((m) => {
    const ms = umurMs(m);
    return ms !== null && ms > EMPAT_HARI;
  }).length;

  const capMacet = (macet ?? [])
    .map((m) => (m.inbox?.sinceIso ? Date.parse(m.inbox.sinceIso) : NaN))
    .filter((t) => Number.isFinite(t));
  const tertua = capMacet.length > 0 ? umurSingkat(Math.min(...capMacet)) : null;

  // Groups ordered largest first, ties alphabetically — the same ordering the
  // ledger page has always used, kept so the page does not reshuffle on reload.
  const perJenis = new Map<string, DecisionRecord[]>();
  for (const r of records ?? []) {
    const arr = perJenis.get(r.type) ?? [];
    arr.push(r);
    perJenis.set(r.type, arr);
  }
  const kelompok = [...perJenis.entries()].sort((a, b) =>
    b[1].length !== a[1].length ? b[1].length - a[1].length : a[0].localeCompare(b[0]),
  );

  return (
    <div className="view max-w-[900px] pb-4">
      <PageHeader title="Keputusan" />

      <TileGrid>
        <Tile
          icon={Inbox}
          label="Nunggu lo"
          tone={antre !== null && antre.length > 0 ? 'butuh' : 'netral'}
          value={antre === null ? '—' : String(antre.length)}
          sub={
            antre === null
              ? 'papan kerja nggak kebaca'
              : antre.length === 0
                ? 'kosong'
                : lamaNunggu > 0
                  ? `${lamaNunggu} lewat 4 hari`
                  : 'semua masih baru'
          }
        />
        <Tile
          icon={TriangleAlert}
          label="Nyangkut"
          tone={macet !== null && macet.length > 0 ? 'buruk' : 'netral'}
          value={macet === null ? '—' : String(macet.length)}
          sub={
            macet === null
              ? 'papan kerja nggak kebaca'
              : macet.length === 0
                ? 'nggak ada'
                : tertua
                  ? `paling lama ${tertua}`
                  : 'umurnya nggak kecatat'
          }
        />
        <Tile
          icon={Activity}
          label="Dikerjain"
          value={jalan === null ? '—' : String(jalan.length)}
          sub={jalan === null ? 'papan kerja nggak kebaca' : 'nggak butuh lo'}
        />
        <Tile
          icon={ListChecks}
          label="Tercatat"
          value={records === null ? '—' : String(records.length)}
          sub={records === null ? 'buku keputusan nggak kebaca' : `${resmi} pegangan resmi`}
        />
      </TileGrid>

      <section className="mb-9">
        <SectionTitle count={antre?.length}>Nunggu jawaban lo</SectionTitle>
        {antre === null ? (
          <SumberMati apa="Papan kerja" />
        ) : antre.length === 0 ? (
          <Kosong>Nggak ada yang nunggu lo.</Kosong>
        ) : (
          <div className="space-y-4">
            {antre.map((m) => (
              <DecisionCard key={m.d.identifier} m={m} />
            ))}
          </div>
        )}
      </section>

      {macet !== null && macet.length > 0 && (
        <section className="mb-9">
          <SectionTitle count={macet.length}>Nyangkut — butuh arahan baru</SectionTitle>
          <div className="space-y-4">
            {macet.map((m) => (
              <DecisionCard key={m.d.identifier} m={m} />
            ))}
          </div>
        </section>
      )}

      {jalan !== null && jalan.length > 0 && (
        <section className="mb-9">
          <SectionTitle count={jalan.length}>Lagi dikerjain</SectionTitle>
          <ul className={DAFTAR}>
            {jalan.map((m) => (
              <li
                key={m.d.identifier}
                className="flex min-h-[44px] items-center gap-3 border-b border-os-hairline px-3 last:border-b-0"
              >
                <span className="shrink-0 font-mono text-[12px] text-os-muted">
                  {m.d.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                  {judulSingkat(m.d.title)}
                </span>
                <span className="shrink-0 text-[12px] text-os-muted">
                  {umurSingkat(m.inbox?.sinceIso ?? null) ?? statusIndonesia(m.d.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle count={records?.length}>Yang udah pernah diputusin</SectionTitle>
        {records === null ? (
          <SumberMati apa="Buku keputusan" />
        ) : records.length === 0 ? (
          <Kosong>Belum ada yang tercatat.</Kosong>
        ) : (
          <div className="space-y-7">
            {kelompok.map(([jenis, isi]) => (
              <div key={jenis}>
                {/* One level down from the section heading above: the archive
                    groups are a machine-room index, not four more headlines. */}
                <SectionHead label={terjemah(JENIS_ID, jenis)} count={isi.length} />
                <ul className={DAFTAR}>
                  {isi.map((r) => (
                    <BarisCatatan key={r.id} r={r} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
