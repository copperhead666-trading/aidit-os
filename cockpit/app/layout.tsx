import type { Metadata, Viewport } from 'next';
import { Public_Sans, Azeret_Mono, Source_Serif_4 } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { PauseBanner } from '@/components/PauseBanner';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { readPauseState } from '@/lib/sources';
import { readHeartbeat, readLanes } from '@/lib/founderos';
import { sejakInggris } from '@/lib/kata';
import {
  ALLOWED_TELEGRAM_USER_IDS_ENV,
  SESSION_COOKIE_NAME,
  parseAllowedTelegramUserIds,
  verifySessionCookieValue,
} from '@/lib/session';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const TELEGRAM_BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN_AHMAD';

// The house faces (interface standard, 2026-09-03). Public Sans is the working
// face of official briefs; Azeret Mono carries figures and identifiers; Source
// Serif 4 appears in exactly two places — the dateline and a case subject —
// which is what makes a case read as a document rather than a row.
const fontMono = Azeret_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

const fontSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
});

const fontSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'Aidit OS',
  description: 'The standing brief: what is waiting on the owner, and the evidence behind it',
};

function hasValidSession(): boolean {
  const allowedIds = parseAllowedTelegramUserIds(process.env[ALLOWED_TELEGRAM_USER_IDS_ENV]);
  if (!allowedIds.ok) {
    return false;
  }

  const cookieValue = cookies().get(SESSION_COOKIE_NAME)?.value;
  return verifySessionCookieValue(cookieValue, process.env[TELEGRAM_BOT_TOKEN_ENV], {
    allowedIds: allowedIds.ids,
  }).ok;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  if (!hasValidSession()) {
    return (
      <html lang="en" className={`${fontSans.variable} ${fontMono.variable} ${fontSerif.variable}`} suppressHydrationWarning>
        <head>
          {/* Apply the persisted theme before first paint — no dark↔light flash. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    );
  }

  const [pauseState, lanes, heartbeat] = await Promise.all([
    readPauseState(),
    readLanes(),
    readHeartbeat(),
  ]);

  // The standing proof of life. Unreadable is reported as unreadable, never as
  // a healthy silence.
  const since = heartbeat === null ? null : sejakInggris(Date.now() - heartbeat.ts);
  const check =
    heartbeat === null || since === null
      ? { short: 'no check', full: 'Last check unknown', ok: false }
      : {
          short: `${since.replace(' ago', '')} · ${heartbeat.succeeded}/${heartbeat.total}`,
          full: `Last check ${since} · ${heartbeat.succeeded}/${heartbeat.total}`,
          ok: heartbeat.failed === 0,
        };

  // Only the three fields the rail draws. A lane that never ran this week is
  // still listed — a silent lane is information, not an absence.
  const laneLines = (lanes ?? []).map((l) => ({
    lane: l.lane,
    runs: l.runs,
    quotaExhausted: l.quotaExhausted,
  }));

  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable} ${fontSerif.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no dark↔light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="overflow-x-hidden">
        <Sidebar lanes={laneLines} />
        {/* os-shell reserves the sidebar rail. Below `md` the rail is an
            off-canvas drawer (see Sidebar), so the column owns the full width
            there; at `md`+ it reserves --sidebar-w (kept in sync with the
            rail's own width, including drag-resize). */}
        <div
          className="os-shell flex min-h-screen min-w-0 flex-col md:ml-[var(--sidebar-w,232px)]"
          style={{ marginRight: 'var(--conductor-w, 0px)' }}
        >
          <PauseBanner state={pauseState} />
          <Topbar check={check} />
          <main className="min-w-0 flex-1 px-4 pb-16 pt-7 sm:px-6 md:px-8 wide:px-10 ultra:px-12">
            {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
                full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
            <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
              {children}
            </div>
          </main>
        </div>
        <CommandPalette commands={[]} />
      </body>
    </html>
  );
}