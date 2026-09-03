'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, PanelLeft } from 'lucide-react';
import { OsMark } from '@/components/OsMark';
import { usePathname } from 'next/navigation';
import { NAV_PRIMARY, NAV_MORE, type NavItem } from '@/lib/nav';
import { laneRole } from '@/lib/kata';

/** One lane's week, as the rail shows it. Read on the server, passed down. */
export interface LaneLine {
  lane: string;
  runs: number;
  quotaExhausted: boolean;
}

function NavGroup({
  title,
  items,
  pathname,
  collapsed,
  onTip,
}: {
  title: string | null;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onTip: (tip: { label: string; y: number } | null) => void;
}) {
  return (
    <>
      {/* Collapsed keeps a divider where the group heading was, so the icon
          run still read as groups rather than one undifferentiated column. */}
      {title === null ? null : collapsed ? (
        <div className="mx-2 my-1.5 border-t border-os-border" aria-label={title} />
      ) : (
        <div className="px-2.5 pb-1.5 pt-3.5 font-sans text-[12px] font-semibold uppercase tracking-[0.09em] text-os-muted">
          {title}
        </div>
      )}
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            onMouseEnter={(e) =>
              collapsed
                ? onTip({ label, y: e.currentTarget.getBoundingClientRect().top })
                : undefined
            }
            onMouseLeave={() => (collapsed ? onTip(null) : undefined)}
            className={`group relative flex items-center rounded-sm-t border text-[14px] font-medium transition-colors ${
              collapsed ? 'min-h-[44px] justify-center px-0' : 'min-h-[44px] gap-2.5 px-2.5'
            } ${
              active
                ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                : 'border-transparent text-os-muted hover:bg-os-surface2 hover:text-os-text'
            }`}
          >
            <Icon className="h-[15px] w-[15px] shrink-0 opacity-85" strokeWidth={1.7} />
            {collapsed ? null : label}
          </Link>
        );
      })}
    </>
  );
}

const COLLAPSED_W = 56;
const MIN_W = 190;
const MAX_W = 420;
const DEFAULT_W = 232;

/** Below `md`, the rail is off-canvas by default; Topbar's hamburger button
    dispatches this to slide it in, same pattern as ConductorPanel's open event. */
export const SIDEBAR_TOGGLE_EVENT = 'sidebar:toggle';

export function Sidebar({ lanes = [] }: { lanes?: LaneLine[] }) {
  const pathname = usePathname();
  const [host, setHost] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // The other seven views live behind this. Opened automatically when the
  // current page is one of them, so the rail never hides where you are.
  const [moreOpen, setMoreOpen] = useState(false);
  // The nav scrolls, and any scrolling ancestor clips an absolutely positioned
  // child — so the collapsed label is rendered fixed, outside that box.
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null);
  const [width, setWidth] = useState(DEFAULT_W);
  const dragging = useRef(false);
  // Mobile-only: the rail is a slide-in drawer under `md`, toggled by Topbar
  // and closed on navigation — desktop ignores this entirely (always visible).
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onToggle = () => setMobileOpen((v) => !v);
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (NAV_MORE.some((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))) {
      setMoreOpen(true);
    }
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Restore the previous shape before first paint of the nav, so the OS opens
  // the way it was left rather than snapping after hydration.
  useEffect(() => {
    const savedW = Number(localStorage.getItem('founderos.sidebar.w'));
    if (Number.isFinite(savedW) && savedW >= MIN_W && savedW <= MAX_W) setWidth(savedW);
    setCollapsed(localStorage.getItem('founderos.sidebar.collapsed') === '1');
  }, []);

  // Where this instance actually is. Client-only: there is no location
  // during SSR.
  useEffect(() => {
    setHost(window.location.host);
  }, []);

  // A stale label must never hang around after the rail expands.
  useEffect(() => {
    if (!collapsed) setTip(null);
  }, [collapsed]);

  // The shell's left margin reads this, so the page follows the sidebar
  // instead of the width being duplicated in two places.
  useEffect(() => {
    const w = collapsed ? COLLAPSED_W : width;
    document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  }, [collapsed, width]);

  useEffect(() => {
    localStorage.setItem('founderos.sidebar.collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = 'col-resize';
      // Stop text selecting across the whole app while dragging.
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(MAX_W, Math.max(MIN_W, ev.clientX));
        setWidth(next);
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setWidth((w) => {
          localStorage.setItem('founderos.sidebar.w', String(w));
          return w;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [collapsed],
  );

  return (
    <>
      {/* Backdrop: mobile drawer only — desktop never renders this (rail is
          always in-flow there, nothing to scrim). */}
      {mobileOpen && (
        <div
          className="overlay-in fixed inset-0 z-30 bg-black/70 md:hidden"
          onClick={() => setMobileOpen(false)}
          role="presentation"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-os-border bg-os-bg2 transition-transform duration-300 md:z-20 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: collapsed ? COLLAPSED_W : width }}
      >
      <div
        className={`flex pb-[18px] pt-5 ${
          collapsed ? 'flex-col items-center gap-2 px-0' : 'items-center justify-between px-[18px]'
        }`}
      >
        {/* Collapsed, the mark IS the identity: the wordmark is gone, so the
            mark carries it and the toggle stacks underneath (34px plus a 28px
            button will not sit side by side in a 56px rail). */}
        {collapsed ? (
          <OsMark size={30} className="shrink-0" />
        ) : (
          // No second line under the wordmark. It used to read "Read-Only
          // Cockpit", which stopped being true the day owner actions began
          // writing to real issues.
          <div className="flex items-center gap-[11px]">
            <OsMark size={34} className="shrink-0" />
            <div className="font-mono text-[13px] font-semibold tracking-[0.18em] text-os-text">
              AIDIT OS
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm-t border border-transparent text-os-muted transition-colors hover:border-os-border hover:bg-os-surface2 hover:text-os-text"
        >
          <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.7} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
        <NavGroup title={null} items={NAV_PRIMARY} pathname={pathname} collapsed={collapsed} onTip={setTip} />
        {collapsed ? (
          <NavGroup title="More" items={NAV_MORE} pathname={pathname} collapsed onTip={setTip} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className="mt-1 flex min-h-[44px] items-center gap-2.5 rounded-sm-t px-2.5 text-left font-sans text-[14px] font-medium text-os-muted transition-colors hover:bg-os-surface2 hover:text-os-text"
            >
              <ChevronRight
                className={`h-[15px] w-[15px] shrink-0 transition-transform duration-150 ${
                  moreOpen ? 'rotate-90' : ''
                }`}
                strokeWidth={1.7}
              />
              More
            </button>
            {moreOpen && (
              <NavGroup title={null} items={NAV_MORE} pathname={pathname} collapsed={false} onTip={setTip} />
            )}
          </>
        )}
      </nav>
      <div
        className={`flex flex-col gap-2 border-t border-os-border py-3.5 ${
          collapsed ? 'items-center px-0' : 'px-[18px]'
        }`}
      >
        {!collapsed && lanes.length > 0 && (
          // What the workforce actually consumed. This is the only surface that
          // carries it, and it is the number the owner needs in front of him
          // when he settles the paid-account question.
          <div className="mb-1">
            <div className="pb-2 font-sans text-[12px] font-semibold uppercase tracking-[0.09em] text-os-dim">
              Lanes this week
            </div>
            <ul className="space-y-1.5">
              {lanes.map((l) => {
                const role = laneRole(l.lane);
                return (
                  <li key={l.lane} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-os-muted">
                      {l.lane}
                      {role && <span className="text-os-dim"> · {role}</span>}
                    </span>
                    <span
                      className={`shrink-0 font-mono tabular-nums ${
                        l.quotaExhausted ? 'text-os-err' : 'text-os-dim'
                      }`}
                    >
                      {l.quotaExhausted ? 'quota out' : `${l.runs} run${l.runs === 1 ? '' : 's'}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!collapsed && (
          // The host is read at runtime, so a deployed instance never claims to
          // be localhost. Wraps rather than nowrap, which used to clip the line
          // off the edge of the rail. Nothing else belongs here: the previous
          // "systems live" dot was fed by a value nothing ever supplied, so it
          // pulsed green forever regardless of the real state.
          <div className="break-words font-mono text-[12px] leading-relaxed text-os-dim">
            {host ?? '…'}
          </div>
        )}
      </div>

      {collapsed && tip && (
        <div
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-sm-t border border-os-border-strong bg-os-surface px-2 py-1 font-sans text-[12px] font-medium text-os-text"
          style={{ left: COLLAPSED_W + 8, top: tip.y + 15 }}
        >
          {tip.label}
        </div>
      )}

      {/* Drag the right edge to resize. Sits on the border itself with a wider
          invisible hit area, so it is grabbable without being a visible bar. */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          onDoubleClick={() => setWidth(DEFAULT_W)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · double-click to reset"
          className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize hover:bg-[var(--accent-soft)]"
        />
      )}
      </aside>
    </>
  );
}