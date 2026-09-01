import { readGbrain } from '@/lib/sources';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

function relTimeMs(ms: number | null): string {
  if (ms === null) return 'never';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function BrainPage() {
  const sources = await readGbrain();

  if (sources === null) {
    return (
      <div>
        <PageHeader eyebrow="G-Brain" title="G-Brain" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="err" />
            <span className="text-os-text">readGbrain() unavailable</span>
          </div>
          <p className="mt-2 text-os-muted">
            G-Brain source could not be read. No capture data to show.
          </p>
        </div>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="G-Brain" title="G-Brain" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="off" />
            <span className="text-os-text">No sources configured</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="G-Brain" title="G-Brain" />

      <section className="mt-6">
        <SectionHead label="Sources" count={sources.length} />
        <div className="mt-2 divide-y divide-os-border border border-os-border bg-os-surface">
          {sources.map((source) => (
            <div
              key={source.name}
              className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Dot state={source.capturedAt === null ? 'err' : 'ok'} />
                <span className="truncate text-os-text">{source.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-os-muted">
                  {source.capturedAt === null ? 'never captured' : relTimeMs(source.capturedAt)}
                </span>
                {source.failureCount > 0 && (
                  <Badge tone="warn">
                    {source.failureCount} fail · {relTimeMs(source.lastAttemptMs)}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
