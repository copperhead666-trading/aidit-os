// Screenshot the cockpit the way the owner actually sees it.
//
// The pages sit behind the Telegram session cookie, so this mints one the same
// way app/api/session/route.ts does — the bot token is used as an HMAC key and
// never printed. Shoots the phone viewport first, because that is the surface
// that matters: the owner opens this from the Telegram Mini App on an iPhone.
//
//   node scripts/shoot-cockpit.mjs [--public] [--theme dark|light|mono|...]
import { createHmac } from 'node:crypto';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/AI/Active FounderOS-Aidit';
const OWNER_UID = 8987077084;
const OUT = process.env.SHOT_DIR || path.join(ROOT, '.shots');

const args = process.argv.slice(2);
const usePublic = args.includes('--public');
const themeArg = args[args.indexOf('--theme') + 1];
const theme = args.includes('--theme') && themeArg ? themeArg : null;
const BASE = usePublic ? 'https://asus-gray.tailc7b60e.ts.net' : 'http://127.0.0.1:4200';

function botToken() {
  const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (t.slice(0, i) === 'TELEGRAM_BOT_TOKEN_AHMAD') {
      return t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('TELEGRAM_BOT_TOKEN_AHMAD not found in .env.local');
}

function sessionCookieValue() {
  const payload = Buffer.from(JSON.stringify({ uid: OWNER_UID, iat: Date.now() }), 'utf8').toString('base64url');
  const signed = `v1.${payload}`;
  return `${signed}.${createHmac('sha256', botToken()).update(signed).digest('base64url')}`;
}

const SURFACES = [
  // The owner's actual handset. 390x844, and 664 of it live in Safari --
  // DESIGN.md's first-fold budget is measured against exactly this.
  { name: 'phone', ...devices['iPhone 12 Pro'] },
  { name: 'desktop', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
];

const PAGES = [
  { slug: 'home', path: '/' },
  { slug: 'decisions', path: '/decisions' },
  // A real waiting case, so the eight-slot record is verified too. If it is
  // ever answered this renders the honest 'no longer waiting' state, which
  // is still a page worth shooting.
  { slug: 'case', path: '/case/KOL-67' },
];

fs.mkdirSync(OUT, { recursive: true });

const url = new URL(BASE);
const browser = await chromium.launch();
const problems = [];

for (const surface of SURFACES) {
  const { name, ...deviceOptions } = surface;
  const context = await browser.newContext({ ...deviceOptions, ignoreHTTPSErrors: true });
  await context.addCookies([
    {
      name: '__founderos_cockpit_session',
      value: sessionCookieValue(),
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  // Anything the browser could not load is the failure that keeps producing an
  // unstyled page; collect it rather than letting a screenshot hide it.
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`${name} ${res.status()} ${res.url().replace(BASE, '')}`);
  });
  page.on('pageerror', (err) => problems.push(`${name} pageerror: ${String(err).slice(0, 160)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name} console: ${msg.text().slice(0, 160)}`);
  });

  for (const target of PAGES) {
    await page.goto(BASE + target.path, { waitUntil: 'networkidle', timeout: 45000 });
    if (theme) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('alex-theme', t); } catch { /* private mode */ }
      }, theme);
      await page.waitForTimeout(250);
    }

    // Proof the stylesheet actually applied, not just that HTML arrived.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily.split(',')[0]);
    const sheets = await page.evaluate(() => document.styleSheets.length);
    if (bg === 'rgba(0, 0, 0, 0)' || sheets === 0) {
      problems.push(`${name} ${target.slug}: NO STYLESHEET APPLIED (body bg ${bg}, ${sheets} sheets)`);
    }

    const file = path.join(OUT, `${target.slug}-${name}${theme ? '-' + theme : ''}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${target.slug.padEnd(10)} ${name.padEnd(8)} bg ${bg.padEnd(20)} ${font.padEnd(22)} ${sheets} sheet(s) -> ${path.basename(file)}`);
  }

  await context.close();
}

await browser.close();

if (problems.length > 0) {
  console.log('\nPROBLEMS');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('\nno failed requests, no page errors, stylesheet applied everywhere');
}
