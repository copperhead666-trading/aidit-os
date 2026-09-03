/**
 * Terminal-direction primitives shared across screens.
 * Server-component friendly: no state, no handlers.
 */
import Link from 'next/link';

export type DotState = 'ok' | 'warn' | 'err' | 'off';

const DOT_FOR: Record<string, DotState> = {
  connected: 'ok',
  active: 'ok',
  ok: 'ok',
  available: 'warn',
  warn: 'warn',
  training: 'warn',
  idle: 'warn',
  error: 'err',
  fail: 'err',
  not_configured: 'off',
  planned: 'off',
  off: 'off',
};

export function dotState(state: string): DotState {
  return DOT_FOR[state] ?? 'off';
}

export function Dot({ state, pulse = false }: { state: string; pulse?: boolean }) {
  const cls = dotState(state);
  return <span className={`dot ${cls}${pulse && cls === 'ok' ? ' pulse' : ''}`} />;
}

export type BadgeTone = 'default' | 'accent' | 'ok' | 'warn' | 'err';

// The tone lives in the border and the wash; the label itself stays --text so a
// 9.5px chip is legible on every skin. As coloured text, --warn reaches only
// 3.7:1 and --ok 3.9:1 on the warm-paper and daylight backgrounds — both under
// the 4.5:1 floor for text this small.
const BADGE_TONE: Record<BadgeTone, string> = {
  default: 'border-os-border-strong text-os-muted',
  accent: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-text',
  ok: 'border-[color-mix(in_oklab,var(--ok)_45%,transparent)] bg-[color-mix(in_oklab,var(--ok)_9%,transparent)] text-os-text',
  warn: 'border-[color-mix(in_oklab,var(--warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--warn)_9%,transparent)] text-os-text',
  err: 'border-[color-mix(in_oklab,var(--err)_45%,transparent)] bg-[color-mix(in_oklab,var(--err)_9%,transparent)] text-os-text',
};

export function Badge({
  tone = 'default',
  ghost = false,
  children,
}: {
  tone?: BadgeTone;
  ghost?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm-t border px-2 py-[3px] font-sans text-[12px] font-medium uppercase tracking-[0.06em] ${BADGE_TONE[tone]} ${
        ghost ? 'border-dashed' : ''
      }`}
    >
      {children}
    </span>
  );
}

/** Mono section label: `LABEL  count ————` */
export function Label({
  children,
  count,
  rule = false,
}: {
  children: React.ReactNode;
  count?: string | number;
  rule?: boolean;
}) {
  return (
    // --text-3 is 2.8:1 on the Monolith black and 4.3:1 on the light paper, so
    // section labels ride on --text-2 instead: same greyscale role, but legible
    // at 10px in both themes.
    <div className="flex items-center gap-2 font-sans text-[12px] font-semibold uppercase tracking-[0.09em] text-os-muted">
      <span className="whitespace-nowrap">{children}</span>
      {count != null && <span className="font-mono text-os-text">{count}</span>}
      {rule && <span className="h-px flex-1 bg-os-border" />}
    </div>
  );
}

export function SectionHead({
  label,
  count,
  link,
  href,
}: {
  label: string;
  count?: string | number;
  link?: string;
  href?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Label count={count} rule>
          {label}
        </Label>
      </div>
      {link && href && (
        <a
          href={href}
          className="-my-3 inline-flex shrink-0 items-center py-3 font-sans text-[12px] font-medium text-os-muted transition-colors hover:text-os-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
        >
          {link} →
        </a>
      )}
    </div>
  );
}

/**
 * A real heading over a block of content, for the two owner-facing screens.
 * `SectionHead` above is the machine-room label used everywhere else; this one
 * is what a person reads on a phone at 6am.
 */
export function SectionTitle({
  children,
  count,
  link,
  href,
}: {
  children: React.ReactNode;
  count?: string | number;
  link?: string;
  href?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      {/* Wraps rather than truncates: a clipped heading on a narrow phone is a
          worse failure than a second line. */}
      <h2 className="min-w-0 font-sans text-[16px] font-semibold leading-snug tracking-[-0.01em] text-os-text">
        {children}
        {count != null && (
          <span className="ml-2 font-mono text-[13px] font-normal text-os-muted">{count}</span>
        )}
      </h2>
      {link && href && (
        <Link
          href={href}
          // -mx-2/px-2 and the min width keep a two-word link ("All") a real
          // 44×44 target without moving it off the heading's right edge.
          className="-mx-2 -my-3 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center px-2 py-3 font-sans text-[13px] font-medium text-os-muted transition-colors hover:text-os-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
        >
          {link}
        </Link>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm-t border border-os-border-strong bg-os-surface px-1.5 py-0.5 font-mono text-[12px] text-os-muted">
      {children}
    </kbd>
  );
}

/** Accent sparkline with a 10%-opacity fill. */
export function Spark({ data, w = 72, h = 22 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map(
    (v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 5)).toFixed(1)}`,
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="var(--accent)" opacity="0.1" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
