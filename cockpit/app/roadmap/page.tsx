import { readBacklog } from '@/lib/sources';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

const ORDER = [
  'OWNER_DECISION',
  'NEEDS_RECOVERY',
  'ACTIVE',
  'KEEP_BACKLOG',
  'SUPERSEDED',
  'DROP_RECOMMENDED',
  'DONE',
];

function dotState(classification: string): 'ok' | 'warn' | 'off' {
  if (classification === 'ACTIVE') return 'ok';
  if (classification === 'OWNER_DECISION' || classification === 'NEEDS_RECOVERY') return 'warn';
  return 'off';
}

export default async function RoadmapPage() {
  const backlog = await readBacklog();

  if (backlog === null) {
    return (
      <div>
        <PageHeader title="Roadmap" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="err" />
            <span className="text-os-text">readBacklog() unavailable</span>
          </div>
          <p className="mt-2 text-os-muted">
            Backlog source could not be read. No roadmap data to show.
          </p>
        </div>
      </div>
    );
  }

  if (backlog.length === 0) {
    return (
      <div>
        <PageHeader title="Roadmap" />
        <div className="mt-6 border border-os-border bg-os-surface p-4">
          <div className="flex items-center gap-2">
            <Dot state="ok" />
            <span className="text-os-text">Backlog is empty</span>
          </div>
        </div>
      </div>
    );
  }

  const groups = new Map<string, typeof backlog>();
  for (const item of backlog) {
    const list = groups.get(item.classification) ?? [];
    list.push(item);
    groups.set(item.classification, list);
  }

  const known = ORDER.filter((c) => groups.has(c));
  const unknown = Array.from(groups.keys())
    .filter((c) => !ORDER.includes(c))
    .sort((a, b) => a.localeCompare(b));
  const hasDone = known.includes('DONE');
  const orderedKnown = known.filter((c) => c !== 'DONE');
  const classificationOrder = [...orderedKnown, ...unknown, ...(hasDone ? ['DONE'] : [])];

  return (
    <div>
      <PageHeader title="Roadmap" />

      <section className="mt-6">
        <SectionHead label="Summary" count={backlog.length} />
        <div className="mt-2 flex flex-wrap gap-2">
          {classificationOrder.map((c) => (
            <Badge key={c} tone="default" ghost>
              {c}: {groups.get(c)?.length ?? 0}
            </Badge>
          ))}
        </div>
      </section>

      {classificationOrder.map((c) => {
        const items = groups.get(c) ?? [];
        return (
          <section key={c} className="mt-6">
            <SectionHead label={c} count={items.length} />
            <div className="mt-2 divide-y divide-os-border border border-os-border bg-os-surface">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 p-3">
                  <Dot state={dotState(c)} />
                  <span className="shrink-0 text-os-dim">{item.id}</span>
                  <span className="truncate text-os-text">{item.title}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
