export const dynamic = 'force-dynamic';

import { readLayers } from '@/lib/founderos';
import type { ProjectLayer, ProjectLayerStatus } from '@/lib/founderos';
import { PageHeader } from '@/components/PageHeader';
import { Dot, type DotState, SectionHead } from '@/components/terminal';

const STATUS_ORDER: ProjectLayerStatus[] = [
  'implemented',
  'partial',
  'not-started',
  'deferred',
];

const STATUS_TO_DOT: Record<ProjectLayerStatus, DotState> = {
  implemented: 'ok',
  partial: 'warn',
  'not-started': 'err',
  deferred: 'off',
};

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

function evidenceText(layer: ProjectLayer): string {
  const ev = layer.evidence;
  if (typeof ev === 'string') return ev;
  if (Array.isArray(ev)) return ev.map((x) => String(x)).join('; ');
  if (ev == null) return '';
  return JSON.stringify(ev);
}

export default async function ReferencePage() {
  const layers = await readLayers();

  if (layers === null) {
    return (
      <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
        <PageHeader eyebrow="FOUNDEROS" title="Layers" />
        <section className="space-y-2">
          <SectionHead label="Layers" />
          <EmptyState file="config/project-layers.json" />
        </section>
      </main>
    );
  }

  const counts: Record<string, number> = {};
  for (const l of layers) {
    counts[l.status] = (counts[l.status] ?? 0) + 1;
  }
  const summary = STATUS_ORDER.filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');

  return (
    <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        eyebrow="FOUNDEROS"
        title="Layers"
        right={
          <div className="flex items-center gap-2 text-xs text-os-muted">
            <Dot state="ok" />
            <span>{layers.length} layers</span>
          </div>
        }
      />

      <section className="space-y-2">
        <SectionHead label="Layers" count={layers.length} />
        <div className="border border-os-border bg-os-surface p-3 text-xs text-os-muted">
          {summary}
        </div>
      </section>

      <section className="space-y-2">
        <SectionHead label="Reference" />
        {layers.length === 0 ? (
          <div className="border border-os-border bg-os-surface p-4 flex items-center gap-2 text-xs text-os-muted">
            <Dot state="off" />
            no layers defined
          </div>
        ) : (
          <ul className="border border-os-border bg-os-surface divide-y divide-os-border">
            {layers.map((layer) => {
              const ev = evidenceText(layer);
              return (
                <li key={layer.id} className="p-3 space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <Dot state={STATUS_TO_DOT[layer.status]} />
                    <span className="text-os-text">{layer.label}</span>
                    <span className="ml-auto text-os-dim uppercase tracking-[0.08em]">
                      {layer.status}
                    </span>
                  </div>
                  <div className="text-os-muted">{layer.ownerQuestion}</div>
                  <div className="text-os-dim break-words">
                    {ev ? ev : <span className="text-os-dim">no evidence recorded</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}