// build-tokens.mjs — Aidit OS design tokens. usage: node scripts/design/build-tokens.mjs [outDir=docs/brand/tokens]
// Generates: colour ramps (OKLCH lightness steps from the locked
// brand hexes), semantic aliases, type scale, spacing/radius/shadow/motion. Writes
// docs/brand/tokens/tokens.json, tokens.css and contrast.json (WCAG ratios for the guideline).
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve(process.argv[2] || 'docs/brand/tokens');
fs.mkdirSync(OUT, { recursive: true });

// ---- colour maths (sRGB <-> OKLCH) ----
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function rgb2oklch([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}
function oklch2rgb([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), bb = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(gam);
}
const inGamut = (c) => c.every((v) => v >= -0.002 && v <= 1.002);
function ramp(hex) {
  // 50..950: fixed OKLCH lightness ladder, chroma eased toward the ends and clipped to sRGB gamut.
  const [, C, H] = rgb2oklch(hex2rgb(hex));
  const steps = { 50: 0.97, 100: 0.93, 200: 0.86, 300: 0.77, 400: 0.67, 500: 0.57, 600: 0.48, 700: 0.40, 800: 0.32, 900: 0.25, 950: 0.19 };
  const out = {};
  for (const [k, L] of Object.entries(steps)) {
    let c = C * (1 - Math.abs(L - 0.57) * 1.1); let rgb = oklch2rgb([L, c, H]);
    while (!inGamut(rgb) && c > 0) { c -= 0.005; rgb = oklch2rgb([L, c, H]); }
    out[k] = rgb2hex(rgb);
  }
  return out;
}
const lum = (hex) => { const [r, g, b] = hex2rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };

// ---- primitives ----
const brand = { charcoal: '#0A0B0E', panel: '#14171E', emerald: '#1E5A46', gold: '#C6A860', ivory: '#EFE7D6', terracotta: '#B0603A' };
const primitives = {
  emerald: ramp(brand.emerald), gold: ramp(brand.gold), terracotta: ramp(brand.terracotta),
  // neutrals ride the charcoal hue so greys never look blue-dead or brown-warm
  ink: { 0: '#000000', 950: '#0A0B0E', 900: '#14171E', 850: '#1B1F28', 800: '#232833', 700: '#343A47', 600: '#4B5261', 500: '#67707F', 400: '#8A919E', 300: '#AEB3BD', 200: '#CFD2D8', 100: '#E6E7EA', 50: '#F4F4F6' },
  ivory: { 950: '#3D3524', 900: '#5A4F36', 800: '#7C6E4E', 700: '#9C8C68', 600: '#B8A882', 500: '#D0C2A1', 400: '#DED2B6', 300: '#E7DCC6', 200: '#EFE7D6', 100: '#F5EFE2', 50: '#FAF7F0' },
  white: '#FFFFFF', black: '#000000',
};
// keep the locked brand hexes exactly at their ramp anchors
primitives.emerald[700] = brand.emerald; primitives.gold[400] = brand.gold; primitives.terracotta[500] = brand.terracotta; primitives.ivory[200] = brand.ivory;

// ---- semantic (dark = default cockpit theme; light = documents / print) ----
const semantic = {
  dark: {
    'bg-canvas': primitives.ink[950], 'bg-surface': primitives.ink[900], 'bg-elevated': primitives.ink[850], 'bg-sunken': primitives.ink[0],
    'border-subtle': primitives.ink[800], 'border-strong': primitives.ink[700], 'focus-ring': primitives.gold[400],
    'text-primary': primitives.ivory[200], 'text-secondary': primitives.ink[300], 'text-muted': primitives.ink[400], 'text-inverse': primitives.ink[950],
    'accent': primitives.gold[400], 'accent-hover': primitives.gold[300], 'accent-text-on': primitives.ink[950],
    'brand': primitives.emerald[700], 'brand-hover': primitives.emerald[600], 'brand-text-on': primitives.ivory[100],
    'success': '#3FA37A', 'warning': primitives.terracotta[500], 'danger': '#C4483F', 'info': '#5B8DEF',
    'status-live': '#3FA37A', 'status-waiting': primitives.gold[400], 'status-blocked': '#C4483F', 'status-idle': primitives.ink[500],
  },
  light: {
    'bg-canvas': primitives.ivory[100], 'bg-surface': primitives.ivory[50], 'bg-elevated': '#FFFFFF', 'bg-sunken': primitives.ivory[200],
    'border-subtle': primitives.ivory[300], 'border-strong': primitives.ivory[500], 'focus-ring': primitives.emerald[700],
    'text-primary': primitives.ink[950], 'text-secondary': primitives.ink[700], 'text-muted': primitives.ink[600], 'text-inverse': primitives.ivory[100],
    'accent': primitives.gold[600], 'accent-hover': primitives.gold[700], 'accent-text-on': primitives.ivory[50],
    'brand': primitives.emerald[700], 'brand-hover': primitives.emerald[800], 'brand-text-on': primitives.ivory[100],
    'success': '#1F7A55', 'warning': primitives.terracotta[600], 'danger': '#A6352D', 'info': '#2F5FC4',
    'status-live': '#1F7A55', 'status-waiting': primitives.gold[600], 'status-blocked': '#A6352D', 'status-idle': primitives.ink[400],
  },
};

// ---- type / space / radius / shadow / motion ----
const type = {
  family: { display: "'Sora', 'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, Consolas, monospace" },
  weight: { display: 800, 'display-medium': 600, body: 400, 'body-medium': 500, 'body-semibold': 600, mono: 500 },
  // 1.25 modular scale from 16 px; line-height tightens as size grows; display tracking negative, labels positive
  scale: {
    'display-xl': { size: 61, line: 1.05, tracking: -0.02, family: 'display', weight: 800 },
    'display-l': { size: 49, line: 1.08, tracking: -0.015, family: 'display', weight: 800 },
    'display-m': { size: 39, line: 1.12, tracking: -0.01, family: 'display', weight: 700 },
    'heading-l': { size: 31, line: 1.2, tracking: -0.005, family: 'display', weight: 600 },
    'heading-m': { size: 25, line: 1.25, tracking: 0, family: 'display', weight: 600 },
    'heading-s': { size: 20, line: 1.3, tracking: 0, family: 'display', weight: 600 },
    'body-l': { size: 18, line: 1.55, tracking: 0, family: 'body', weight: 400 },
    'body-m': { size: 16, line: 1.55, tracking: 0, family: 'body', weight: 400 },
    'body-s': { size: 14, line: 1.5, tracking: 0, family: 'body', weight: 400 },
    'label': { size: 12, line: 1.3, tracking: 0.06, family: 'body', weight: 600, transform: 'uppercase' },
    'data-l': { size: 20, line: 1.3, tracking: 0, family: 'mono', weight: 500 },
    'data-m': { size: 14, line: 1.5, tracking: 0, family: 'mono', weight: 500 },
    'data-s': { size: 12, line: 1.5, tracking: 0.02, family: 'mono', weight: 500 },
  },
};
const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 };
const radius = { none: 0, xs: 4, s: 6, m: 10, l: 14, xl: 20, pill: 999 };
const shadow = {
  dark: { s: '0 1px 2px rgba(0,0,0,.5)', m: '0 4px 14px rgba(0,0,0,.45)', l: '0 12px 32px rgba(0,0,0,.5)', glow: '0 0 0 3px rgba(198,168,96,.28)' },
  light: { s: '0 1px 2px rgba(26,22,12,.08)', m: '0 4px 14px rgba(26,22,12,.10)', l: '0 12px 32px rgba(26,22,12,.14)', glow: '0 0 0 3px rgba(30,90,70,.25)' },
};
const motion = {
  duration: { instant: 80, fast: 160, base: 240, slow: 320, reveal: 900 },
  easing: { enter: 'cubic-bezier(0.16, 1, 0.3, 1)', exit: 'cubic-bezier(0.7, 0, 0.84, 0)', standard: 'cubic-bezier(0.4, 0, 0.2, 1)', spring: 'cubic-bezier(0.34, 1.2, 0.64, 1)' },
};

// ---- contrast table for the guideline ----
const pairs = [];
for (const theme of ['dark', 'light']) {
  const s = semantic[theme];
  for (const bg of ['bg-canvas', 'bg-surface', 'bg-elevated']) for (const fg of ['text-primary', 'text-secondary', 'text-muted', 'accent', 'brand', 'success', 'warning', 'danger', 'info']) {
    const ratio = contrast(s[fg], s[bg]); pairs.push({ theme, fg, bg, ratio, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7 });
  }
  pairs.push({ theme, fg: 'accent-text-on', bg: 'accent', ratio: contrast(s['accent-text-on'], s['accent']), aa: contrast(s['accent-text-on'], s['accent']) >= 4.5 });
  pairs.push({ theme, fg: 'brand-text-on', bg: 'brand', ratio: contrast(s['brand-text-on'], s['brand']), aa: contrast(s['brand-text-on'], s['brand']) >= 4.5 });
}

// ---- write ----
const tokens = { $meta: { name: 'Aidit OS', version: '2.0.0', generated: new Date().toISOString(), brandLocked: brand }, primitives, semantic, type, space, radius, shadow, motion };
fs.writeFileSync(path.join(OUT, 'tokens.json'), JSON.stringify(tokens, null, 2));
fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify(pairs, null, 2));
let css = `/* Aidit OS design tokens v2 — generated by scripts/design/build-tokens.mjs. Do not hand-edit. */\n:root {\n`;
for (const [fam, r] of Object.entries(primitives)) { if (typeof r === 'string') { css += `  --ao-${fam}: ${r};\n`; continue; } for (const [k, v] of Object.entries(r)) css += `  --ao-${fam}-${k}: ${v};\n`; }
for (const [k, v] of Object.entries(type.family)) css += `  --ao-font-${k}: ${v};\n`;
for (const [k, v] of Object.entries(type.scale)) css += `  --ao-text-${k}: ${v.weight} ${v.size}px/${v.line} var(--ao-font-${v.family});\n  --ao-tracking-${k}: ${v.tracking}em;\n`;
for (const [k, v] of Object.entries(space)) css += `  --ao-space-${k}: ${v}px;\n`;
for (const [k, v] of Object.entries(radius)) css += `  --ao-radius-${k}: ${v}px;\n`;
for (const [k, v] of Object.entries(motion.duration)) css += `  --ao-duration-${k}: ${v}ms;\n`;
for (const [k, v] of Object.entries(motion.easing)) css += `  --ao-ease-${k}: ${v};\n`;
css += `}\n`;
for (const theme of ['dark', 'light']) {
  css += `${theme === 'dark' ? ':root, [data-theme="dark"]' : '[data-theme="light"]'} {\n  color-scheme: ${theme};\n`;
  for (const [k, v] of Object.entries(semantic[theme])) css += `  --ao-${k}: ${v};\n`;
  for (const [k, v] of Object.entries(shadow[theme])) css += `  --ao-shadow-${k}: ${v};\n`;
  css += `}\n`;
}
css += `@media (prefers-reduced-motion: reduce) { :root { --ao-duration-fast: 0ms; --ao-duration-base: 0ms; --ao-duration-slow: 0ms; --ao-duration-reveal: 0ms; } }\n`;
fs.writeFileSync(path.join(OUT, 'tokens.css'), css);
const fails = pairs.filter((p) => !p.aa && ['text-primary', 'text-secondary', 'accent-text-on', 'brand-text-on'].includes(p.fg));
console.log('tokens written to', OUT, '| contrast pairs', pairs.length, '| body-text AA failures', fails.length, fails.map((p) => `${p.theme}:${p.fg}/${p.bg}=${p.ratio}`).join(' '));
