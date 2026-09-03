'use client';

import { usePathname } from 'next/navigation';
import { Menu, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { OsMark } from '@/components/OsMark';
import { SIDEBAR_TOGGLE_EVENT } from '@/components/Sidebar';

// Page names the owner would use, not the route slugs. He is not an engineer
// and 'founder-os / home' told him nothing he did not already know.
const SEGMENT_LABELS: Record<string, string> = {
  '': 'Beranda',
  decisions: 'Keputusan',
  inbox: 'Perlu perhatian',
  tasks: 'Kerjaan',
  agents: 'Tenaga kerja',
  doctor: 'Kesehatan sistem',
  brain: 'Ingatan',
  roadmap: 'Rencana',
  skills: 'Kemampuan',
  reference: 'Acuan',
  how: 'Cara pakai',
};

export function openPalette() {
  window.dispatchEvent(new CustomEvent('alex:palette'));
}

export function Topbar() {
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