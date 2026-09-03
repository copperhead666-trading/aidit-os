/**
 * UI themes. The default identity follows DESIGN.md at the repo root: a night
 * instrument panel — cool blue-black ground, single sodium-brass accent. The
 * owner opens this at six in the morning on a phone in an unlit room, and that
 * is the reason for the hue. The others are full re-skins
 * the user can pick, Monolith among them. The
 * active theme lives as `data-theme` on <html>, persisted to localStorage.
 * Tailwind os.* tokens read CSS vars, so flipping the attribute re-themes the
 * whole UI with no per-component work — each theme is a token block in
 * app/globals.css.
 */
export const THEMES = ['mono', 'mono-light', 'dark', 'light', 'midnight', 'ember'] as const;
export type Theme = (typeof THEMES)[number];

/** What every fresh load gets until the user picks something else. */
export const DEFAULT_THEME: Theme = 'dark';

/** Picker metadata: display name, one-line feel, [bg, accent, text] swatch. */
export const THEME_META: Record<Theme, { name: string; blurb: string; swatch: [string, string, string] }> = {
  dark: { name: 'Night', blurb: 'instrument panel, brass accent', swatch: ['#0c0f14', '#e2a04b', '#e9ebee'] },
  light: { name: 'Day', blurb: 'warm paper, orange accent', swatch: ['#fffefb', '#ff4f00', '#201515'] },
  midnight: { name: 'Midnight', blurb: 'deep navy, signal blue', swatch: ['#070d1f', '#5ec9f8', '#e8ecf9'] },
  ember: { name: 'Ember', blurb: 'coal dark, vault orange', swatch: ['#0c0806', '#e35c35', '#f2e9e2'] },
  mono: { name: 'Monolith', blurb: 'white on black, color = status only', swatch: ['#0a0a0a', '#f2f2f2', '#2fd36f'] },
  'mono-light': { name: 'Daylight', blurb: 'soft grey on white, easy on the eyes', swatch: ['#f5f6f8', '#1b1e23', '#2b8fd8'] },
};

export const THEME_STORAGE_KEY = 'alex-theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Stored value wins if valid, otherwise the default. */
export function resolveInitialTheme(stored: string | null): Theme {
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/** Cycle the ring in registry order (kept for keyboard/quick toggling). */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.indexOf(current);
  return THEMES[(i + 1) % THEMES.length];
}

/**
 * Inline-able script (string) that applies the persisted theme before first
 * paint, so there is no theme flash. Generated from the registry so the two
 * never drift. Injected in <head> via layout.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify([...THEMES])};var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(k.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme',${JSON.stringify(DEFAULT_THEME)});}})();`;
