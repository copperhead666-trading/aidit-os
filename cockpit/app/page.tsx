export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { Activity, CheckCheck, Inbox, TriangleAlert } from 'lucide-react';
import { readHeartbeat, readLanes, readSelfRepair, type LaneStat } from '@/lib/founderos';
import { readOpenDecisions, readIssues, type IssueSummary } from '@/lib/sources';
import { readInbox } from '@/lib/inbox';
import { PageHeader } from '@/components/PageHeader';
import { Dot, SectionTitle } from '@/components/terminal';
import { Tile, TileGrid, type TileMark } from '@/components/Tile';
import { DecisionCard, DecisionRow, statusIndonesia } from '@/components/DecisionCard';
import {
  butuhJawaban,
  gabung,
  nyangkut,
  umurMs,
  urutkan,
  type Menunggu,
} from '@/components/keputusan';
import { durasi, judulSingkat, sapaan, umurSingkat } from '@/components/waktu';

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

/** How many of the waiting queue to preview under the one being answered. */
const PRATINJAU = 4;

/** The line between "waiting" and "waiting too long", in the tiles. */
const EMPAT_HARI = 4 * 24 * 60 * 60 * 1000;

/** "Last night" for the repair tile: the window the owner slept through. */
const SEMALAM = 24 * 60 * 60 * 1000;

const DAFTAR = 'overflow-hidden rounded-md-t border border-os-border bg-os-surface';
const BARIS = 'flex min-h-[44px] items-center gap-3 border-b border-os-hairline px-3 last:border-b-0';

function Kosong({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="ok" />
      {children}
    </p>
  );
}

function SumberMati({ apa }: { apa: string }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="off" />
      <span className="min-w-0">
        <span className="font-semibold text-os-text">{apa} nggak kebaca.</span> Angkanya sengaja
        dikosongin.
      </span>
    </p>
  );
}

// A lane is only called out when its own numbers say something is wrong: the
// quota is spent, or it has been called enough times to know the failures are a
// pattern and not one bad night.
function laneBermasalah(lane: LaneStat): string | null {
  if (lane.quotaExhausted) {
    return lane.cooldownRemainingMs > 0
      ? `jatah habis · pulih ${durasi(lane.cooldownRemainingMs)} lagi`
      : 'jatah mingguannya habis';
  }
  if (lane.runs >= 3 && lane.ok === 0) return `${lane.runs}x dipanggil, nol jadi`;
  if (lane.runs >= 3 && lane.ok / lane.runs <= 0.5) {
    return `cuma ${Math.round((lane.ok / lane.runs) * 100)}% yang jadi`;
  }
  return null;
}

// One mark per real item, ordered ok / warn / bad. Nothing is padded and nothing
// is invented — the row length is exactly the count the tile already shows, so
// the marks cannot drift away from the number above them.
function tanda(ok: number, warn: number, bad: number, idle = 0): TileMark[] {
  return [
    ...Array<TileMark>(Math.max(0, ok)).fill('ok'),
    ...Array<TileMark>(Math.max(0, warn)).fill('warn'),
    ...Array<TileMark>(Math.max(0, bad)).fill('bad'),
    ...Array<TileMark>(Math.max(0, idle)).fill('idle'),
  ];
}

export default async function Page() {
  const [heartbeat, lanes, openDecisions, inbox, issues, repairs] = await Promise.all([
    readHeartbeat(),
    readLanes(),
    readOpenDecisions(),
    readInbox(),
    readIssues(),
    readSelfRepair(150),
  ]);

  const semua = openDecisions === null ? null : gabung(openDecisions, inbox);
  const antre = semua === null ? null : urutkan(butuhJawaban(semua));
  const macet = semua === null ? null : nyangkut(semua);
  const paling: Menunggu | null = antre && antre.length > 0 ? antre[0] : null;
  const sisanya = antre ? antre.slice(1) : [];

  const jalan: IssueSummary[] =
    issues?.filter((i) => i.status === 'in_progress' || i.status === 'in_review') ?? [];
  const laneRusak = (lanes ?? [])
    .map((l) => ({ lane: l, sebab: laneBermasalah(l) }))
    .filter((x): x is { lane: LaneStat; sebab: string } => x.sebab !== null);
  const totalMacet = (macet?.length ?? 0) + laneRusak.length;

  // Tile 1 — the queue, and how much of it has gone stale on him.
  const lamaNunggu = (antre ?? []).filter((m) => {
    const ms = umurMs(m);
    return ms !== null && ms > EMPAT_HARI;
  }).length;

  // Tile 2 — what last night's runs actually kept, and what they took back.
  const semalamIni = (repairs ?? []).filter((r) => Date.now() - r.ts < SEMALAM);
  const disimpan = semalamIni.filter(
    (r) => r.outcome === 'repaired' || r.outcome === 'done',
  ).length;
  const dibalikin = semalamIni.filter((r) => r.outcome === 'reverted').length;

  // Tile 3 — the oldest thing that is jammed, since that is the one that rots.
  const capMacet = (macet ?? [])
    .map((m) => (m.inbox?.sinceIso ? Date.parse(m.inbox.sinceIso) : NaN))
    .filter((t) => Number.isFinite(t));
  const tertua = capMacet.length > 0 ? umurSingkat(Math.min(...capMacet)) : null;

  return (
    <div className="view max-w-[900px] pb-4">
      {/* No status line under the title: the four tiles below say it in numbers. */}
      <PageHeader title={`${sapaan()}, Adit`} />

      <TileGrid>
        <Tile
          icon={Inbox}
          label="Butuh lo"
          href="/decisions"
          tone={antre !== null && antre.length > 0 ? 'butuh' : 'netral'}
          // Grey, not green: an unanswered decision is not a success. Only the
          // ones past four days earn a colour, and it is the warning one.
          marks={antre === null ? undefined : tanda(0, lamaNunggu, 0, antre.length - lamaNunggu)}
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
          icon={CheckCheck}
          label="Beres semalam"
          href="/doctor"
          value={repairs === null ? '—' : String(disimpan)}
          marks={repairs === null ? undefined : tanda(disimpan, 0, dibalikin)}
          sub={
            repairs === null
              ? 'catatan nggak kebaca'
              : dibalikin > 0
                ? `${dibalikin} dibalikin sendiri`
                : 'nggak ada yang dibalikin'
          }
        />
        <Tile
          icon={TriangleAlert}
          label="Macet"
          href="/inbox"
          tone={totalMacet > 0 ? 'buruk' : 'netral'}
          marks={semua === null && lanes === null ? undefined : tanda(0, 0, totalMacet)}
          value={semua === null && lanes === null ? '—' : String(totalMacet)}
          sub={
            semua === null && lanes === null
              ? 'sumbernya nggak kebaca'
              : totalMacet === 0
                ? 'semua gerak'
                : tertua
                  ? `paling lama ${tertua}`
                  : 'umurnya nggak kecatat'
          }
        />
        <Tile
          icon={Activity}
          label="Cek rutin"
          href="/doctor"
          value={heartbeat === null ? '—' : `${heartbeat.succeeded}/${heartbeat.total}`}
          marks={heartbeat === null ? undefined : tanda(heartbeat.succeeded, 0, heartbeat.failed)}
          sub={
            heartbeat === null
              ? 'denyut nggak kebaca'
              : heartbeat.failed === 0
                ? 'semua lolos'
                : `${heartbeat.failed} gagal`
          }
        />
      </TileGrid>

      <section className="mb-8">
        <SectionTitle count={antre?.length} link="Semua" href="/decisions">
          Butuh keputusan lo
        </SectionTitle>
        {antre === null ? (
          <SumberMati apa="Papan kerja" />
        ) : antre.length === 0 ? (
          <Kosong>Nggak ada yang nunggu lo.</Kosong>
        ) : (
          <div className="space-y-4">
            {paling && <DecisionCard m={paling} />}
            {sisanya.length > 0 && (
              <div className={DAFTAR}>
                <ul>
                  {sisanya.slice(0, PRATINJAU).map((m) => (
                    <DecisionRow key={m.d.identifier} m={m} />
                  ))}
                </ul>
                {sisanya.length > PRATINJAU && (
                  <Link
                    href="/decisions"
                    className={`hoverable flex min-h-[44px] items-center border-t border-os-border px-3 text-[13px] font-medium text-os-muted hover:bg-os-surface2 hover:text-os-text ${FOKUS}`}
                  >
                    {sisanya.length - PRATINJAU} lagi
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-8">
        <SectionTitle
          count={issues === null ? undefined : jalan.length}
          link="Semua tugas"
          href="/tasks"
        >
          Lagi dikerjain
        </SectionTitle>
        {issues === null ? (
          <SumberMati apa="Papan kerja" />
        ) : jalan.length === 0 ? (
          <Kosong>Lagi nggak ada yang jalan.</Kosong>
        ) : (
          <ul className={DAFTAR}>
            {jalan.map((i) => (
              <li key={i.identifier} className={BARIS}>
                <Dot state="warn" />
                <span className="shrink-0 font-mono text-[12px] text-os-muted">{i.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                  {judulSingkat(i.title)}
                </span>
                <span className="shrink-0 text-[12px] text-os-muted">
                  {umurSingkat(i.updatedAt) ?? statusIndonesia(i.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle
          count={semua === null && lanes === null ? undefined : totalMacet}
          link="Inbox"
          href="/inbox"
        >
          Nyangkut
        </SectionTitle>
        {semua === null && lanes === null ? (
          <SumberMati apa="Papan kerja dan catatan jalur" />
        ) : totalMacet === 0 ? (
          <Kosong>Nggak ada yang mentok.</Kosong>
        ) : (
          <ul className={DAFTAR}>
            {(macet ?? []).map((m) => {
              // Only the parts that exist, so a missing attempt count never
              // leaves a separator hanging on its own.
              const jejak = [
                m.inbox && m.inbox.attempts > 0 ? `gagal ${m.inbox.attempts}x` : null,
                umurSingkat(m.inbox?.sinceIso ?? null),
              ].filter((s): s is string => s !== null);
              return (
                <li key={m.d.identifier} className={BARIS}>
                  <Dot state="err" />
                  <span className="shrink-0 font-mono text-[12px] text-os-muted">
                    {m.d.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                    {judulSingkat(m.d.title)}
                  </span>
                  {jejak.length > 0 && (
                    <span className="shrink-0 text-[12px] text-os-muted">{jejak.join(' · ')}</span>
                  )}
                </li>
              );
            })}
            {laneRusak.map(({ lane, sebab }) => (
              <li key={lane.lane} className={BARIS}>
                <Dot state="warn" />
                <span className="shrink-0 font-mono text-[12px] text-os-muted">{lane.lane}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">{sebab}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
