import { readIssues } from '@/lib/sources';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

function relTime(iso: string | null): string {
  if (!iso) return 'tanpa timestamp';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'tanpa timestamp';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `sejak ${s} detik lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `sejak ${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `sejak ${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `sejak ${d} hari lalu`;
}

function priorityTone(priority: string): 'default' | 'accent' | 'ok' | 'warn' | 'err' {
  const p = priority.toLowerCase();
  if (p.includes('urgent') || p.includes('critical')) return 'err';
  if (p.includes('high')) return 'warn';
  return 'default';
}

export default async function TasksPage() {
  const issues = await readIssues();

  if (issues === null) {
    return (
      <div>
        <PageHeader title="Work" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="err" />
            <span className="text-os-text">readIssues() tidak tersedia</span>
          </div>
          <p className="mt-2 text-os-muted">
            Sumber issue tidak bisa dibaca. Tidak ada data task untuk ditampilkan.
          </p>
        </div>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div>
        <PageHeader title="Work" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="ok" />
            <span className="text-os-text">Tidak ada issue terbuka</span>
          </div>
        </div>
      </div>
    );
  }

  const ownerRequired = issues.filter((i) => i.ownerRequired);
  const rest = issues.filter((i) => !i.ownerRequired);

  const groups = new Map<string, typeof rest>();
  for (const issue of rest) {
    const list = groups.get(issue.status) ?? [];
    list.push(issue);
    groups.set(issue.status, list);
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        right={
          <Badge tone={ownerRequired.length > 0 ? 'warn' : 'default'}>
            {ownerRequired.length} awaiting you
          </Badge>
        }
      />

      {ownerRequired.length > 0 && (
        <section className="mt-6">
          <SectionHead label="Awaiting you" count={ownerRequired.length} />
          <div className="mt-2 divide-y divide-os-border border border-os-border-strong bg-os-surface2">
            {ownerRequired.map((issue) => (
              <div
                key={issue.identifier}
                className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-os-dim">{issue.identifier}</span>
                  <span className="truncate text-os-text">{issue.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={priorityTone(issue.priority)}>{issue.priority}</Badge>
                  <span className="text-os-muted">{relTime(issue.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Array.from(groups.entries()).map(([status, list]) => (
        <section key={status} className="mt-6">
          <SectionHead label={status} count={list.length} />
          <div className="mt-2 divide-y divide-os-border border border-os-border bg-os-surface">
            {list.map((issue) => (
              <div
                key={issue.identifier}
                className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-os-dim">{issue.identifier}</span>
                  <span className="truncate text-os-text">{issue.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={priorityTone(issue.priority)}>{issue.priority}</Badge>
                  <span className="text-os-muted">{relTime(issue.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
