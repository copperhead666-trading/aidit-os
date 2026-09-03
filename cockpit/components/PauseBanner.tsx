import type { PauseState } from '@/lib/sources';

// Rendered above everything on every authenticated page. A paused FounderOS
// that renders normally is indistinguishable from a dead one, which is the
// failure this banner exists to prevent.
export function PauseBanner({ state }: { state: PauseState }) {
  if (!state.paused) return null;
  return (
    <div
      role="status"
      className="border-b border-[color-mix(in_oklab,var(--warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] px-4 py-2.5 text-[13px] text-os-text sm:px-6 md:px-8"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-baseline gap-x-2 gap-y-1 wide:max-w-[1760px] ultra:max-w-none">
        <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.09em] text-os-text">
          {state.unreadable ? 'Pause · status tidak terbaca' : 'Dijeda'}
        </span>
        <span>
          {state.unreadable
            ? 'Status pause tidak bisa dibaca, jadi FounderOS dianggap DIJEDA. Semua angka di bawah mungkin tidak bergerak.'
            : 'FounderOS dijeda. Sweep, dispatch, dan notifikasi berhenti — angka di bawah tidak akan bergerak sampai dilanjutkan.'}
        </span>
        {state.atIso ? <span className="font-mono text-[12px] text-os-muted">sejak {state.atIso}</span> : null}
        {state.by ? <span className="font-sans text-[12px] text-os-muted">oleh {state.by}</span> : null}
        {state.reason ? <span className="text-os-muted">— {state.reason}</span> : null}
      </div>
    </div>
  );
}