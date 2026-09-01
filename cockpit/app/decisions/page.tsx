export const dynamic = 'force-dynamic';

import { readDecisions } from '@/lib/founderos';
import type { DecisionRecord } from '@/lib/founderos';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';

function EmptyState({ file }: { file: string }) {
  return (
    <div className="border border-os-border bg-os-surface p-4 text-xs text-os-muted">
      <span className="inline-flex items-center gap-2">
        <Dot state="off" />
        source missing — <span className="text-os-dim">{file}</span> not found
      </span>
    </div>
  );
}

function isCanonical(record: DecisionRecord): boolean {
  return record.canonical === true;
}

function isMigrated(record: DecisionRecord): boolean {
  return typeof record.migrated_from === 'string';
}

export default async function DecisionsPage() {
  const ledger = await readDecisions();
  const records = ledger?.records ?? null;

  if (records === null) {
    return (
      <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
        <PageHeader eyebrow="FOUNDEROS" title="Decisions" />
        <section className="space-y-2">
          <SectionHead label="Ledger" />
          <EmptyState file="config/decision-ledger.json" />
        </section>
      </main>
    );
  }

  const total = records.length;
  const canonicalCount = records.filter(isCanonical).length;
  const migratedCount = records.filter(isMigrated).length;

  // Group by type, order groups largest first (ties broken alphabetically).
  const byType = new Map<string, DecisionRecord[]>();
  for (const r of records) {
    const arr = byType.get(r.type) ?? [];
    arr.push(r);
    byType.set(r.type, arr);
  }
  const orderedGroups = [...byType.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const countLine = [
    `${total} decisions logged`,
    canonicalCount > 0 ? `${canonicalCount} canonical` : null,
    migratedCount > 0 ? `${migratedCount} migrated` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        eyebrow="FOUNDEROS"
        title="Decisions"
        right={
          <div className="flex items-center gap-2 text-xs text-os-muted">
            <Dot state="ok" />
            <span>{total} records</span>
          </div>
        }
      />

      <section className="space-y-2">
        <SectionHead label="Ledger" />
        <div className="border border-os-border bg-os-surface p-3 text-xs text-os-muted">
          {countLine}
        </div>
      </section>

      {total === 0 ? (
        <section className="space-y-2">
          <SectionHead label="Records" count={0} />
          <div className="border border-os-border bg-os-surface p-4 flex items-center gap-2 text-xs text-os-muted">
            <Dot state="off" />
            no decisions recorded
          </div>
        </section>
      ) : (
        <div className="space-y-8">
          {orderedGroups.map(([type, groupRecords]) => (
            <section key={type} className="space-y-2">
              <SectionHead label={type} count={groupRecords.length} />
              <ul className="border border-os-border bg-os-surface divide-y divide-os-border">
                {groupRecords.map((r) => (
                  <li key={r.id} className="p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-os-text">{r.id}</span>
                      <span className="text-os-dim">·</span>
                      <span className="text-os-dim uppercase tracking-[0.08em]">{r.status}</span>
                      <span className="ml-auto flex items-center gap-1.5">
                        {isCanonical(r) && <Badge tone="accent">canonical</Badge>}
                        {isMigrated(r) && (
                          <Badge tone="default" ghost>
                            migrated
                          </Badge>
                        )}
                      </span>
                    </div>
                    <p className="text-os-muted line-clamp-2">{r.statement}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}