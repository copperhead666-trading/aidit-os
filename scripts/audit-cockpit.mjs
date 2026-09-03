// Runtime audit of the cockpit at phone width: the things a static linter
// cannot prove — real horizontal overflow, real touch-target sizes, real
// contrast of rendered text, accessible names, and focus visibility.
import { createHmac } from 'node:crypto';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/AI/Active FounderOS-Aidit';
const BASE = process.argv.includes('--public')
  ? 'https://asus-gray.tailc7b60e.ts.net'
  : 'http://127.0.0.1:4200';

function botToken() {
  const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (t.slice(0, i) === 'TELEGRAM_BOT_TOKEN_AHMAD') return t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('bot token not found');
}

const payload = Buffer.from(JSON.stringify({ uid: 8987077084, iat: Date.now() }), 'utf8').toString('base64url');
const signed = `v1.${payload}`;
const cookieValue = `${signed}.${createHmac('sha256', botToken()).update(signed).digest('base64url')}`;

const url = new URL(BASE);
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 12 Pro'], ignoreHTTPSErrors: true });
await context.addCookies([{
  name: '__founderos_cockpit_session',
  value: cookieValue,
  domain: url.hostname,
  path: '/',
  httpOnly: true,
  secure: url.protocol === 'https:',
  sameSite: 'Lax',
}]);

const page = await context.newPage();
let failures = 0;

for (const route of ['/', '/decisions', '/case/KOL-67']) {
  await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
  console.log(`\n── ${route} @ ${devices['iPhone 12 Pro'].viewport.width}px ──`);

  const report = await page.evaluate(() => {
    const out = { overflow: null, wide: [], smallTargets: [], namelessControls: [], lowContrast: [] };

    out.overflow = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };

    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > document.documentElement.clientWidth + 1) {
        out.wide.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} ${Math.round(r.width)}px`);
      }
    }

    const name = (el) =>
      el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim();
    for (const el of document.querySelectorAll('button, a[href], input, [role="button"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // Sub-pixel layout: a 44px target measures 43.99. Half a pixel of slack.
      if (r.height < 43.5 || r.width < 24) {
        out.smallTargets.push(`${el.tagName.toLowerCase()} "${name(el).slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      if (!name(el)) out.namelessControls.push(el.outerHTML.slice(0, 90));
    }

    // Rendered contrast, sampled from the paint rather than from tokens.
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Alpha matters. A wash like rgba(255,106,38,0.11) is not an orange
    // background, it is a whisper of orange over whatever sits behind it.
    // Reading only the first three numbers made every tinted badge look like
    // light-text-on-orange and invented two contrast failures.
    const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const over = (fg, bg) => {
      const a = fg.length > 3 ? fg[3] : 1;
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    };
    // Composite every translucent layer down onto the first opaque one.
    const bgOf = (el) => {
      const stack = [];
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        const a = c.length > 3 ? c[3] : 1;
        if (a > 0) {
          stack.push(c);
          if (a === 1) break;
        }
        n = n.parentElement;
      }
      const base = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      let acc = base;
      if (stack.length > 0 && (stack[stack.length - 1][3] ?? 1) === 1) acc = stack.pop().slice(0, 3);
      while (stack.length > 0) acc = over(stack.pop(), acc);
      return acc;
    };
    for (const el of document.querySelectorAll('p, span, h1, h2, h3, a, button, li, dt, dd, small')) {
      const text = (el.textContent || '').trim();
      if (!text || el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const bg = bgOf(el);
      const fg = over(parse(cs.color), bg);
      if (fg.length < 3 || bg.length < 3) continue;
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        out.lowContrast.push(`${ratio.toFixed(2)}:1 (need ${need}) ${size}px "${text.slice(0, 34)}"`);
      }
    }
    return out;
  });

  const overflows = report.overflow.scrollWidth > report.overflow.clientWidth + 1;
  console.log(`  horizontal overflow : ${overflows ? `YES — ${report.overflow.scrollWidth}px in ${report.overflow.clientWidth}px` : 'no'}`);
  if (overflows) failures += 1;

  const show = (label, list) => {
    const unique = [...new Set(list)];
    console.log(`  ${label.padEnd(20)}: ${unique.length === 0 ? 'none' : unique.length}`);
    for (const item of unique.slice(0, 6)) console.log(`      ${item}`);
    if (unique.length > 0) failures += 1;
  };
  show('wider than viewport', report.wide);
  show('touch targets <44px', report.smallTargets);
  show('controls with no name', report.namelessControls);
  show('contrast below AA', report.lowContrast);
}

await browser.close();
console.log(failures === 0 ? '\nclean' : `\n${failures} problem group(s)`);
process.exitCode = failures === 0 ? 0 : 1;
