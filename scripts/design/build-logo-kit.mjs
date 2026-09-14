// build-logo-kit.mjs — generate the Aidit OS logo system from the fitted mark params.
// usage: node scripts/design/build-logo-kit.mjs [outDir=docs/brand/logo] [fontsDir=scripts/design/fonts]
// Requires <outDir>/aidit-os-mark.params.json to exist (the owner-approved fit).
// Outputs: mark variants (gradient / inverse / mono), wordmark, lockups (h/v, dark/light),
// icons (favicon, apple-touch, PWA, maskable, OG, Telegram avatar), manifest + head snippet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { buildMark } from './build-mark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || 'docs/brand/logo');
const FONTS = process.argv[3] || path.join(here, 'fonts');
const P = JSON.parse(fs.readFileSync(path.join(OUT, 'aidit-os-mark.params.json'), 'utf8')).P;
const C = { charcoal: '#0A0B0E', panel: '#14171E', emerald: '#1E5A46', gold: '#C6A860', ivory: '#EFE7D6', ink: '#0A0B0E' };
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
const f = (n) => Math.round(n * 1000) / 1000;

// ---- tight bounds of the mark, analytic (getBBox ignores stroke width) ----
const br = await chromium.launch();
const page = await br.newPage({ viewport: { width: 1200, height: 1200 } });
const m0 = buildMark(P, 'faithful');
const r0 = P.w / 2, theta = Math.atan(P.s); // half-angle at the apex (leg vs vertical)
const B = { x: P.vx - r0, y: P.ay - r0 / Math.sin(theta), w: 2 * (131.5 - (P.vx - r0)), h: m0.bottom - (P.ay - r0 / Math.sin(theta)) };
const MW = f(B.w), MH = f(B.h); // tight mark size (mark units)

function markSvg(mode, gid = 'g') {
  const m = buildMark(P, mode, gid);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW} ${MH}" width="${MW}" height="${MH}"><title>Aidit OS mark</title>${m.defs ? `<defs>${m.defs}</defs>` : ''}<g transform="translate(${f(-B.x)} ${f(-B.y)})">${m.body}</g></svg>`;
}
// mark placed inside another svg at (x,y) with height h
function markAt(mode, x, y, h, gid) {
  const m = buildMark(P, mode, gid); const s = h / MH;
  return { defs: m.defs, body: `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)}) translate(${f(-B.x)} ${f(-B.y)})">${m.body}</g>`, w: MW * s };
}

const variants = { 'aidit-os-mark': 'faithful', 'aidit-os-mark-flat': 'brand', 'aidit-os-mark-inverse': 'inverse',
  'aidit-os-mark-mono-gold': `mono:${C.gold}`, 'aidit-os-mark-mono-emerald': `mono:${C.emerald}`, 'aidit-os-mark-mono-ink': `mono:${C.ink}`,
  'aidit-os-mark-mono-ivory': `mono:${C.ivory}`, 'aidit-os-mark-mono-white': 'mono:#FFFFFF', 'aidit-os-mark-mono-black': 'mono:#000000' };
for (const [name, mode] of Object.entries(variants)) fs.writeFileSync(path.join(OUT, `${name}.svg`), markSvg(mode, name.replace('aidit-os-', 'ao-')));

// ---- wordmark: "AIDIT OS", Sora 800, tracking +4% ----
const t2p = path.join(here, 'text2path.mjs');
const word = JSON.parse(execFileSync('node', [t2p, path.join(FONTS, 'sora-800.woff'), 'AIDIT OS', '100', '0.04'], { windowsHide: true }).toString());
const wordSvg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${f(-word.capHeight)} ${f(word.width)} ${f(word.capHeight)}" width="${f(word.width)}" height="${f(word.capHeight)}"><title>Aidit OS wordmark</title><path fill="${fill}" d="${word.d}"/></svg>`;
fs.writeFileSync(path.join(OUT, 'aidit-os-wordmark-ivory.svg'), wordSvg(C.ivory));
fs.writeFileSync(path.join(OUT, 'aidit-os-wordmark-ink.svg'), wordSvg(C.ink));

// ---- lockups ----
// Horizontal: mark height 100 units; wordmark cap height = 0.5 × mark height; gap = 0.28 × mark height; text baseline-aligned to mark optical centre.
function lockupH(theme) {
  const H = 100, cap = 50, gap = 28, pad = 0; const s = cap / word.capHeight;
  const mk = markAt(theme === 'dark' ? 'faithful' : 'inverse', pad, 0, H, `ao-lh-${theme}`);
  const tx = pad + mk.w + gap, ty = H / 2 + cap / 2; const W = tx + word.width * s + pad;
  const fill = theme === 'dark' ? C.ivory : C.ink;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${H}" width="${f(W)}" height="${H}"><title>Aidit OS</title><defs>${mk.defs}</defs>${mk.body}<path fill="${fill}" transform="translate(${f(tx)} ${f(ty)}) scale(${f(s)})" d="${word.d}"/></svg>`;
}
// Vertical: mark height 100; wordmark cap 22, centred, gap 24.
function lockupV(theme) {
  const H = 100, cap = 22, gap = 24; const s = cap / word.capHeight; const tw = word.width * s; const W = Math.max(MW * (H / MH), tw);
  const mk = markAt(theme === 'dark' ? 'faithful' : 'inverse', (W - MW * (H / MH)) / 2, 0, H, `ao-lv-${theme}`);
  const fill = theme === 'dark' ? C.ivory : C.ink; const ty = H + gap + cap;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(ty)}" width="${f(W)}" height="${f(ty)}"><title>Aidit OS</title><defs>${mk.defs}</defs>${mk.body}<path fill="${fill}" transform="translate(${f((W - tw) / 2)} ${f(ty)}) scale(${f(s)})" d="${word.d}"/></svg>`;
}
for (const th of ['dark', 'light']) { fs.writeFileSync(path.join(OUT, `aidit-os-lockup-h-${th}.svg`), lockupH(th)); fs.writeFileSync(path.join(OUT, `aidit-os-lockup-v-${th}.svg`), lockupV(th)); }

// ---- icons ----
// App tile: charcoal rounded square, mark at 62% of tile height, optically centred (arch apex sits high, so shift down 2%).
function tileSvg(size, radiusPct, markPct = 0.62, bg = C.charcoal, safe = false) {
  const mh = size * markPct; const mk = markAt('faithful', 0, 0, mh, 'ao-tile'); const x = (size - mk.w) / 2, y = (size - mh) / 2 + size * 0.02;
  const r = size * radiusPct; const body = mk.body.replace('translate(0 0)', `translate(${f(x)} ${f(y)})`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs>${mk.defs}</defs><rect width="${size}" height="${size}" rx="${f(r)}" fill="${bg}"/>${safe ? '' : ''}${body}</svg>`;
}
async function png(svg, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>*{margin:0}body{background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const icons = path.join(OUT, 'icons');
fs.writeFileSync(path.join(icons, 'favicon.svg'), tileSvg(64, 0.2, 0.7));
for (const s of [16, 32, 48]) await png(tileSvg(s, 0.2, 0.72), s, s, path.join(icons, `favicon-${s}.png`));
await png(tileSvg(180, 0, 0.62), 180, 180, path.join(icons, 'apple-touch-180.png'));
for (const s of [192, 512]) await png(tileSvg(s, 0.18, 0.62), s, s, path.join(icons, `pwa-${s}.png`));
await png(tileSvg(512, 0, 0.56), 512, 512, path.join(icons, 'maskable-512.png'));
await png(tileSvg(1024, 0.22, 0.62), 1024, 1024, path.join(icons, 'app-icon-1024.png'));
await png(tileSvg(640, 0.5, 0.58), 640, 640, path.join(icons, 'telegram-avatar-640.png'));
// OG image 1200×630: dark panel, horizontal lockup centred at 40% height
{
  const lk = lockupH('dark'); const vb = lk.match(/viewBox="0 0 ([\d.]+) 100"/)[1]; const lw = +vb; const s = 220 / 100; const w = lw * s;
  const inner = lk.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace('<title>Aidit OS</title>', '');
  const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${C.charcoal}"/><rect x="0" y="0" width="1200" height="630" fill="${C.panel}" opacity="0.6"/><g transform="translate(${f((1200 - w) / 2)} ${f((630 - 220) / 2)}) scale(${s})">${inner}</g></svg>`;
  await png(og, 1200, 630, path.join(icons, 'og-1200x630.png'));
}
fs.writeFileSync(path.join(icons, 'site.webmanifest'), JSON.stringify({ name: 'Aidit OS', short_name: 'Aidit', theme_color: C.charcoal, background_color: C.charcoal, display: 'standalone',
  icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }, { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' }, { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, null, 2));
fs.writeFileSync(path.join(icons, 'head-snippet.html'), `<!-- Aidit OS — tab & icon tags (paths relative to /icons/) -->
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/icons/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-180.png">
<link rel="manifest" href="/icons/site.webmanifest">
<meta name="theme-color" content="${C.charcoal}">
<meta property="og:image" content="/icons/og-1200x630.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
`);
await br.close();
console.log('logo kit written to', OUT, `mark ${MW}×${MH}`, 'wordmark', f(word.width), 'cap', f(word.capHeight));
