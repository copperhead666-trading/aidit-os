// preview-sheet.mjs — one contact-sheet PNG of a run directory's artifacts for the owner (Telegram sendPhoto).
// usage: node scripts/design/preview-sheet.mjs <artifactDir> <out.png> [--title "..."] [--max 12]
// Reads <artifactDir>/manifest.json ({ artifacts:[{ path, purpose, kind?, bg? }], options?:[{ id, label, artifact }] })
// or, without a manifest, globs png/svg/html in the dir. Writes <out.png> (1400 px wide, ≤ 1.5 MB) and <out>.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = { title: '', max: 12 };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title') opt.title = args[++i] ?? '';
  else if (args[i] === '--max') opt.max = Math.max(1, Math.min(12, Number(args[++i]) || 12));
  else pos.push(args[i]);
}
const [dirArg, outArg] = pos;
if (!dirArg || !outArg) {
  console.error('usage: node scripts/design/preview-sheet.mjs <artifactDir> <out.png> [--title "..."] [--max 12]');
  process.exit(1);
}
const DIR = path.resolve(dirArg), OUT = path.resolve(outArg);
if (!fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) { console.error('not a directory:', DIR); process.exit(1); }
const MAX_BYTES = Number(process.env.PREVIEW_MAX_BYTES) || 1.5 * 1024 * 1024, WIDTH = 1400; // env override is for tests only

// ---- colours: locked brand tokens (docs/brand/tokens/tokens.json when present, else the same values inline) ----
const C = { canvas: '#0A0B0E', surface: '#14171E', elevated: '#1B1F28', border: '#232833', borderStrong: '#343A47',
  text: '#EFE7D6', secondary: '#AEB3BD', muted: '#8A919E', accent: '#C6A860', brand: '#1E5A46', ivory: '#F5EFE2', ink: '#0A0B0E' };
try {
  const t = JSON.parse(fs.readFileSync(path.resolve('docs/brand/tokens/tokens.json'), 'utf8')).semantic.dark;
  Object.assign(C, { canvas: t['bg-canvas'], surface: t['bg-surface'], elevated: t['bg-elevated'], border: t['border-subtle'],
    borderStrong: t['border-strong'], text: t['text-primary'], secondary: t['text-secondary'], muted: t['text-muted'], accent: t.accent, brand: t.brand });
} catch { /* tokens not built in this checkout; inline values are the same hexes */ }

// ---- collect tiles ----
const KINDS = { '.png': 'png', '.jpg': 'png', '.jpeg': 'png', '.webp': 'png', '.svg': 'svg', '.html': 'html', '.htm': 'html', '.webm': 'webm', '.md': 'md', '.txt': 'md' };
const kindOf = (p) => KINDS[path.extname(p).toLowerCase()] || 'other';
let manifest = null, entries = [], source = 'glob';
const mPath = path.join(DIR, 'manifest.json');
if (fs.existsSync(mPath)) {
  manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  if (!Array.isArray(manifest.artifacts)) { console.error('manifest.json has no artifacts[]'); process.exit(1); }
  source = 'manifest';
  // department manifests (department-dispatch) say `file`; the design-kit ones say `path`
  entries = manifest.artifacts.map((a) => ({ path: a.path || a.file, purpose: a.purpose || '', kind: a.kind || kindOf(a.path || a.file || ''), bg: a.bg }))
    .filter((e) => typeof e.path === 'string' && e.path);
} else {
  const walk = (d, depth = 0) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return depth < 2 ? walk(p, depth + 1) : [];
    return ['png', 'svg', 'html'].includes(kindOf(p)) ? [path.relative(DIR, p).replace(/\\/g, '/')] : [];
  });
  entries = walk(DIR).sort().map((p) => ({ path: p, purpose: path.basename(p), kind: kindOf(p) }));
}
const total = entries.length;
entries = entries.slice(0, opt.max);
const optionByArtifact = new Map();
for (const o of manifest?.options || []) optionByArtifact.set(o.artifact, o.label || o.id);

// light-surface artifacts (light lockups, ink/black monos) preview on ivory so they are visible on the dark sheet
const wantsLight = (p) => /(^|[-_/.])(light|ink|black|paper|print|inverse)([-_./]|$)/i.test(p);

const browser = await chromium.launch();
const shooter = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const tiles = [];
for (const e of entries) {
  const abs = path.join(DIR, e.path);
  const t = { path: e.path, kind: e.kind, purpose: e.purpose, option: optionByArtifact.get(e.path) || null, bg: e.bg || (wantsLight(e.path) ? C.ivory : C.elevated), ok: true, note: '' };
  try {
    if (!fs.existsSync(abs)) throw new Error('missing');
    if (t.kind === 'png') t.src = dataUri(abs);
    else if (t.kind === 'svg') t.src = 'data:image/svg+xml;base64,' + fs.readFileSync(abs).toString('base64');
    else if (t.kind === 'html') {
      await shooter.goto(pathToFileURL(abs).href, { waitUntil: 'networkidle', timeout: 20000 });
      await shooter.waitForTimeout(600);
      t.src = 'data:image/png;base64,' + (await shooter.screenshot({ type: 'png' })).toString('base64');
    } else if (t.kind === 'webm') {
      const poster = abs.replace(/\.webm$/i, '.png');
      if (fs.existsSync(poster)) { t.src = dataUri(poster); t.note = 'poster frame'; } else { t.text = 'video — no poster frame'; }
    } else if (t.kind === 'md') {
      t.text = fs.readFileSync(abs, 'utf8').split(/\r?\n/).slice(0, 12).join('\n');
    } else { t.text = path.extname(e.path).slice(1).toUpperCase() || 'file'; t.note = `${(fs.statSync(abs).size / 1024).toFixed(0)} KB`; }
  } catch (err) { t.ok = false; t.text = `unavailable: ${err.message}`; t.bg = C.elevated; }
  tiles.push(t);
}
function dataUri(p) { const ext = path.extname(p).slice(1).toLowerCase(); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(p).toString('base64')}`; }

// ---- sheet HTML ----
const fontFace = (name, file, weight) => { try { return `@font-face{font-family:'${name}';font-weight:${weight};src:url(data:font/woff;base64,${fs.readFileSync(path.join(here, 'fonts', file)).toString('base64')}) format('woff')}`; } catch { return ''; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
const PV_H = cols === 1 ? 560 : cols === 2 ? 340 : 240; // preview box height; image bounds are px because % max-height does not resolve in an auto grid row
const title = opt.title || manifest?.title || path.basename(DIR);
const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).replace(',', '') + ' WIB';
const tileHtml = tiles.map((t, i) => `
<figure class="tile${t.ok ? '' : ' bad'}">
  <div class="pv" style="background:${t.bg}">
    ${t.src ? `<img src="${t.src}" alt="">` : `<pre class="txt">${esc(t.text)}</pre>`}
    ${t.option ? `<span class="badge">${esc(t.option)}</span>` : ''}
    <span class="num">${i + 1}</span>
  </div>
  <figcaption><div class="cap">${esc(t.purpose || t.path)}</div><div class="meta">${esc(t.path)}${t.note ? ` · ${esc(t.note)}` : ''}</div></figcaption>
</figure>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
${fontFace('Sora', 'sora-600.woff', 600)}${fontFace('Inter', 'inter-400.woff', 400)}${fontFace('Inter', 'inter-500.woff', 500)}${fontFace('JetBrains Mono', 'jbmono-500.woff', 500)}
*{box-sizing:border-box;margin:0}
body{width:${WIDTH}px;background:${C.canvas};color:${C.text};font:400 14px/1.45 'Inter',system-ui,sans-serif;padding:36px 40px 32px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:24px;border-bottom:1px solid ${C.border};padding-bottom:16px;margin-bottom:24px}
h1{font:600 26px/1.15 'Sora',system-ui,sans-serif;color:${C.text};letter-spacing:-.01em}
h1 small{display:block;font:500 12px/1.4 'Inter',system-ui;letter-spacing:.06em;text-transform:uppercase;color:${C.accent};margin-bottom:6px}
.stamp{font:500 12px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${C.muted};text-align:right;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:20px}
.tile{background:${C.surface};border:1px solid ${C.border};border-radius:14px;overflow:hidden}
.tile.bad{border-color:#C4483F}
.pv{position:relative;height:${PV_H}px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.pv img{max-width:88%;max-height:${Math.round(PV_H * 0.84)}px;width:auto;height:auto;object-fit:contain;display:block}
.txt{font:500 12px/1.5 'JetBrains Mono',ui-monospace,monospace;color:${C.secondary};white-space:pre-wrap;padding:18px 20px;width:100%;height:100%;overflow:hidden;align-self:flex-start}
.badge{position:absolute;top:10px;left:10px;background:${C.accent};color:${C.ink};font:500 11px/1 'Inter',system-ui;letter-spacing:.06em;text-transform:uppercase;padding:6px 9px;border-radius:999px}
.num{position:absolute;top:10px;right:10px;background:${C.brand};color:${C.ivory};font:500 11px/1 'JetBrains Mono',ui-monospace,monospace;padding:5px 7px;border-radius:6px}
figcaption{padding:12px 14px 13px;border-top:1px solid ${C.border}}
.cap{font:500 14px/1.35 'Inter',system-ui;color:${C.text};overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.meta{font:500 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${C.muted};margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
footer{margin-top:22px;font:500 11px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${C.muted};display:flex;justify-content:space-between}
</style><body>
<header><h1><small>Aidit OS · design department · preview</small>${esc(title)}</h1><div class="stamp">${esc(stamp)}<br>${tiles.length}${total > tiles.length ? ` of ${total}` : ''} artifacts · ${source}</div></header>
<div class="grid">${tileHtml}</div>
<footer><span>${esc(path.basename(DIR))}/${manifest ? 'manifest.json' : '(no manifest — globbed png/svg/html)'}</span><span>${manifest?.options?.length ? `${manifest.options.length} options offered — reply with the badge label` : 'no options — approve or send notes'}</span></footer>
</body>`;

// ---- render, then downscale until under the Telegram photo budget ----
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(300);
let scale = 1, buf, dims;
for (;;) {
  await page.evaluate((s) => { document.body.style.zoom = String(s); }, scale);
  await page.setViewportSize({ width: Math.round(WIDTH * scale), height: 900 });
  await page.waitForTimeout(100);
  buf = await page.screenshot({ fullPage: true, type: 'png' });
  dims = await page.evaluate((s) => ({ width: Math.round(document.body.scrollWidth * s), height: Math.round(document.body.scrollHeight * s) }), scale);
  if (buf.length <= MAX_BYTES || scale <= 0.4) break;
  scale = Math.round(scale * 0.85 * 100) / 100;
}
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
const report = { title, dir: DIR, source, tiles: tiles.map(({ src, text, ...t }) => t), total, bytes: buf.length, scale, ...dims, over_budget: buf.length > MAX_BYTES };
fs.writeFileSync(OUT + '.json', JSON.stringify(report, null, 2));
console.log(`preview ${OUT} ${dims.width}×${dims.height} ${(buf.length / 1024).toFixed(0)} KB scale ${scale} tiles ${tiles.length}/${total}${report.over_budget ? ' OVER BUDGET' : ''}`);
