import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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