import { readInbox, type InboxItem, type InboxState } from '@/lib/inbox';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, Label, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

function relativeTime(sinceIso: string | null): string {
  if (!sinceIso) return '';
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return '';
  const diffMs = Date.now() - since;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `sejak ${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `sejak ${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `sejak ${days} hari lalu`;
}

function summarize(items: InboxItem[]): string {
  const counts: Record<InboxState, number> = {
    'needs-you': 0,
    'awaiting-your-approval': 0,
    working: 0,
    stuck: 0,
    done: 0,
  };
  for (const item of items) counts[item.state] += 1;

  const decisions = counts['needs-you'] + counts['awaiting-your-approval'];
  const stuck = counts.stuck;
  const working = counts.working;

  if (decisions === 0 && stuck === 0 && working === 0) {
    return 'Bersih. Tidak ada yang butuh lo sekarang.';
  }

  const parts: string[] = [];
  if (decisions > 0) parts.push(`${decisions} butuh keputusan lo`);
  if (stuck > 0) parts.push(`${stuck} macet`);
  if (working > 0) parts.push(`${working} sedang dikerjakan`);

  if (stuck > 0) {
    return `Ada yang macet — ${parts.join(', ')}.`;
  }
  return parts.join(', ') + '.';
}

function Row({ item, showAttempts }: { item: InboxItem; showAttempts?: boolean }) {
  return (
    <div className="border-b border-os-border px-3 py-3 last:border-b-0 sm:px-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-os-dim">{item.identifier}</span>
        {showAttempts && item.attempts > 0 && (
          <Badge tone="err" ghost>
            {item.attempts}x
          </Badge>
        )}
      </div>
      <div className="mt-1 text-sm text-os-text">{item.title}</div>
      {item.reason && <div className="mt-1 text-xs text-os-muted">{item.reason}</div>}
      {showAttempts && item.sinceIso && (
        <div className="mt-1 text-xs text-os-err">{relativeTime(item.sinceIso)}</div>
      )}
      {item.action && (
        <div className="mt-2 border border-os-border-strong bg-os-surface2 px-2 py-1.5 text-xs text-os-accent">
          {item.action}
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  items,
  dotState,
  pulse,
  quiet,
  showAttempts,
}: {
  label: string;
  items: InboxItem[];
  dotState: 'warn' | 'err' | 'off';
  pulse?: boolean;
  quiet?: boolean;
  showAttempts?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className={quiet ? 'opacity-70' : undefined}>
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <Dot state={dotState} pulse={pulse} />
        <SectionHead label={label} count={items.length} />
      </div>
      <div className="border border-os-border bg-os-surface">
        {items.map((item) => (
          <Row key={item.identifier} item={item} showAttempts={showAttempts} />
        ))}
      </div>
    </section>
  );
}

export default async function InboxPage() {
  const items = await readInbox();

  if (items === null) {
    return (
      <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4">
        <PageHeader title="Inbox" />
        <div className="mt-4 border border-os-border-strong bg-os-surface2 px-3 py-4">
          <div className="text-sm text-os-err">Sumber tidak bisa dibaca.</div>
          <div className="mt-1 text-xs text-os-muted">
            Paperclip API tidak merespons. Tidak ada data inbox untuk ditampilkan.
          </div>
        </div>
      </div>
    );
  }

  const decisions = items.filter(
    (item) => item.state === 'needs-you' || item.state === 'awaiting-your-approval',
  );
  const stuck = items.filter((item) => item.state === 'stuck');
  const working = items.filter((item) => item.state === 'working');

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4">
      <PageHeader title="Inbox" />
      <div className="mt-2 text-sm text-os-text">{summarize(items)}</div>

      <div className="mt-4 flex flex-col gap-4">
        <Group label="Butuh keputusan lo" items={decisions} dotState="warn" pulse />
        <Group label="Macet" items={stuck} dotState="err" showAttempts />
        <Group label="Sedang dikerjakan" items={working} dotState="off" quiet />
      </div>
    </div>
  );
}
