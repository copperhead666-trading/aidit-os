'use client';

import { usePathname } from 'next/navigation';
import { Menu, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { OsMark } from '@/components/OsMark';
import { SIDEBAR_TOGGLE_EVENT } from '@/components/Sidebar';

// Page names, not route slugs. English: a page name is frame, not substance.
const SEGMENT_LABELS: Record<string, string> = {
  '': 'Brief',
  case: 'Case',
  decisions: 'Decisions',
  inbox: 'Attention',
  tasks: 'Work',
  agents: 'Agents',
  doctor: 'System',
  brain: 'Memory',
  roadmap: 'Roadmap',
  skills: 'Skills',
  reference: 'Layers',
  how: 'How to use',
};

export function openPalette() {
  window.dispatchEvent(new CustomEvent('alex:palette'));
}

/**
 * `check` is the standing answer to "is this thing alive?". Silence and death
 * look identical without it, and this stack has died with a terminal session
 * before. Formatted on the server so a client clock cannot disagree with it.
 */
export function Topbar({
  check = null,
}: {
  check?: { short: string; full: string; ok: boolean } | null;
}) {
  const pathname = usePathname();
  const segment = pathname.split('/')[1] ?? '';
  const here = SEGMENT_LABELS[segment] ?? segment;

  return (
    <div className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-3.5 border-b border-os-border bg-os-bg2/70 px-4 backdrop-blur sm:px-6">
      {/* Rail is off-canvas under `md` — this is the only way to open it there. */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT))}
        title="Toggle navigation"
        aria-label="Toggle navigation"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-sm-t border border-os-border bg-os-surface text-os-muted transition-colors hover:border-os-border-strong hover:text-os-text md:hidden"
      >
        <Menu className="h-3.5 w-3.5" />
      </button>
      <div className="flex min-w-0 items-center gap-[7px] overflow-hidden font-sans text-[13px] text-os-muted">
        <span className="truncate text-os-text">{here}</span>
      </div>
      {check && (
        // Never hidden on a phone: the phone is the surface he actually opens,
        // and a proof of life that only appears on a laptop proves nothing at
        // six in the morning. Only the words are dropped, never the reading.
        <span
          className={`ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums sm:ml-3 sm:gap-2 ${
            check.ok ? 'text-os-dim' : 'text-os-err'
          }`}
          title={check.full}
        >
          <span className={`dot ${check.ok ? 'ok' : 'err'}`} />
          <span className="sm:hidden">{check.short}</span>
          <span className="hidden sm:inline">{check.full}</span>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
        <ThemeToggle />
        <button
          onClick={openPalette}
          title="Command palette (⌘K)"
          className="grid h-11 w-11 place-items-center rounded-sm-t border border-os-border bg-os-surface text-os-muted transition-colors hover:border-os-border-strong hover:text-os-text"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        {/* the OS mark, anchoring the brand in the top-right corner */}
        <OsMark size={26} className="ml-1 shrink-0" />
      </div>
    </div>
  );
}