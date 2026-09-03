import type { Config } from 'tailwindcss';

// Terminal direction tokens — source of truth mirrored as CSS vars in globals.css
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Wide-screen tiers for the layout shell (see app/layout.tsx).
        // `wide` ≈ large desktop monitor, `ultra` ≈ 32" / ultrawide.
        wide: '1800px',
        ultra: '2200px',
      },
      colors: {
        // Tokens read CSS vars (defined in globals.css) so a single
        // data-theme flip on <html> re-themes every os.* class at once.
        os: {
          bg: 'var(--bg)',
          bg2: 'var(--bg-2)',
          surface: 'var(--surface)',
          // `raised` predates the revamp (= surface-2); /org still uses it
          raised: 'var(--surface-2)',
          surface2: 'var(--surface-2)',
          surface3: 'var(--surface-3)',
          border: 'var(--border)',
          // hairline row dividers inside lists/tables (Monolith handoff)
          hairline: 'var(--hairline)',
          // `border-bright` predates the revamp (= border-strong)
          'border-bright': 'var(--border-strong)',
          'border-strong': 'var(--border-strong)',
          text: 'var(--text)',
          muted: 'var(--text-2)',
          dim: 'var(--text-3)',
          accent: 'var(--accent)',
          accent2: 'var(--accent-2)',
          ink: 'var(--accent-ink)',
          ok: 'var(--ok)',
          warn: 'var(--warn)',
          err: 'var(--err)',
        },
      },
      fontFamily: {
        // DESIGN.md (2026-09-03): Public Sans is the working face — the
        // vernacular of official briefs; Azeret Mono carries figures and
        // identifiers; the serif is rationed to the dateline and case
        // subjects, which is what makes a case read as a document.
        sans: ['var(--font-sans)', '"Public Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"Azeret Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        serif: ['var(--font-serif)', '"Source Serif 4"', 'Georgia', 'ui-serif', 'serif'],
      },
      borderRadius: {
        // DESIGN.md radius scale: 6px inline pills and inputs, 12px the
        // canonical button and card radius.
        'sm-t': '6px',
        'md-t': '12px',
        'lg-t': '12px',
      },
    },
  },
  plugins: [],
};

export default config;
