import type { PauseState } from '@/lib/sources';

// Rendered above everything on every authenticated page. A paused FounderOS
// that renders normally is indistinguishable from a dead one, which is the
// failure this banner exists to prevent.
export function PauseBanner({ state }: { state: PauseState }) {
  if (!state.paused) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[13px] text-amber-200 sm:px-6 md:px-8"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-baseline gap-x-2 gap-y-1 wide:max-w-[1760px] ultra:max-w-none">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-400">
          {state.unreadable ? 'Pause · status tidak terbaca' : 'Dijeda'}
        </span>
        <span>
          {state.unreadable
            ? 'Status pause tidak bisa dibaca, jadi FounderOS dianggap DIJEDA. Semua angka di bawah mungkin tidak bergerak.'
            : 'FounderOS dijeda. Sweep, dispatch, dan notifikasi berhenti — angka di bawah tidak akan bergerak sampai dilanjutkan.'}
        </span>
        {state.atIso ? <span className="font-mono text-[11px] text-amber-400/80">sejak {state.atIso}</span> : null}
        {state.by ? <span className="font-mono text-[11px] text-amber-400/80">oleh {state.by}</span> : null}
        {state.reason ? <span className="text-amber-200/80">— {state.reason}</span> : null}
      </div>
    </div>
  );
}