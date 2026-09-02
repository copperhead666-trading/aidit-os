import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { PauseBanner } from '@/components/PauseBanner';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { readPauseState } from '@/lib/sources';
import {
  ALLOWED_TELEGRAM_USER_IDS_ENV,
  SESSION_COOKIE_NAME,
  parseAllowedTelegramUserIds,
  verifySessionCookieValue,
} from '@/lib/session';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const TELEGRAM_BOT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN_AHMAD';

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'FounderOS Cockpit',
  description: 'Personal operating system and AI agent command center for a single person company',
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
      <html lang="en" className={fontMono.variable} suppressHydrationWarning>
        <head>
          {/* Apply the persisted theme before first paint — no dark↔light flash. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    );
  }

  const pauseState = await readPauseState();

  return (
    <html lang="en" className={fontMono.variable} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no dark↔light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="overflow-x-hidden">
        <Sidebar />
        {/* os-shell reserves the sidebar rail. Below `md` the rail is an
            off-canvas drawer (see Sidebar), so the column owns the full width
            there; at `md`+ it reserves --sidebar-w (kept in sync with the
            rail's own width, including drag-resize). */}
        <div
          className="os-shell flex min-h-screen min-w-0 flex-col md:ml-[var(--sidebar-w,232px)]"
          style={{ marginRight: 'var(--conductor-w, 0px)' }}
        >
          <PauseBanner state={pauseState} />
          <Topbar />
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