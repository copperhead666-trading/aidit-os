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
        // DESIGN.md: Degular Display is proprietary; its own substitute note
        // names Inter — which is also the brand's real second face — for both
        // display and body. Mono stays for data only.
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
