export const dynamic = 'force-dynamic';

import { readSkillMatrix } from '@/lib/founderos';
import type { SkillMatrixEntry } from '@/lib/founderos';
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm-t border border-os-border-strong bg-os-surface px-1.5 py-[3px] font-mono text-[10px] text-os-muted">
      {children}
    </span>
  );
}

function SkillBlock({ entry }: { entry: SkillMatrixEntry }) {
  return (
    <li className="border border-os-border bg-os-surface p-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-os-text">{entry.taskClass}</span>
        <div className="flex items-center gap-1.5">
          <Badge tone="accent" ghost>
            maker · {entry.preferredMaker}
          </Badge>
          <Badge tone="default" ghost>
            reviewer · {entry.preferredReviewer}
          </Badge>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
            skills
          </span>
          {entry.requiredSkills.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
            standards
          </span>
          {entry.requiredStandards.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
      </div>

      <p className="text-os-muted">{entry.compactContextRule}</p>

      <div className="space-y-1.5">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
          hard stops
        </div>
        <ul className="space-y-1">
          {entry.hardStops.map((stop, i) => (
            <li key={i} className="flex items-start gap-2 text-os-text">
              <span className="mt-px font-mono text-os-err">×</span>
              <span>{stop}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export default async function SkillsPage() {
  const matrix = await readSkillMatrix();

  if (matrix === null) {
    return (
      <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
        <PageHeader eyebrow="FOUNDEROS" title="Skills" />
        <section className="space-y-2">
          <SectionHead label="Matrix" />
          <EmptyState file="config/skill-matrix.json" />
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        eyebrow="FOUNDEROS"
        title="Skills"
        right={
          <div className="flex items-center gap-2 text-xs text-os-muted">
            <Dot state="ok" />
            <span>{matrix.length} task classes</span>
          </div>
        }
      />

      <section className="space-y-2">
        <SectionHead label="Matrix" count={matrix.length} />
        <ul className="space-y-3">
          {matrix.map((entry) => (
            <SkillBlock key={entry.taskClass} entry={entry} />
          ))}
        </ul>
      </section>
    </main>
  );
}