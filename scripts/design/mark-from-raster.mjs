// mark-from-raster.mjs — fallback vector path when a geometric rebuild (build-mark) is not feasible:
// crop a raster to the mark's bounding box (luminance/colour threshold against the background sampled at the corners),
// auto-trace it (imagetracerjs, same path as vectorize.mjs), snap every fill to the nearest locked brand hex, drop the
// background so the result is transparent, and report path/colour counts to <outSvg>.json. Honest limits: the trace is
// only as clean as the raster; gradients become bands; it does not invent geometry.
// usage: node scripts/design/mark-from-raster.mjs <in.png|jpg|svg> <out.svg> [--thr 0.12] [--colors 8] [--pad 0.04] [--no-snap] [--allow-terracotta] [--ignore-bottom 0.08]
//   --ignore-bottom excludes that fraction of the height from the bbox (imagegen output carries a watermark there)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { thr: 0.12, colors: 8, pad: 0.04, snap: true, terracotta: false, ignoreBottom: 0 };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--thr') opt.thr = Number(args[++i]) || 0.12;
  else if (args[i] === '--colors') opt.colors = Math.max(2, Math.min(16, Number(args[++i]) || 8));
  else if (args[i] === '--pad') opt.pad = Number(args[++i]) || 0;
  else if (args[i] === '--no-snap') opt.snap = false;
  else if (args[i] === '--ignore-bottom') opt.ignoreBottom = Math.min(0.5, Math.max(0, Number(args[++i]) || 0));
  else if (args[i] === '--allow-terracotta') opt.terracotta = true; // terracotta is warning-only in the rubric; amber gradient bands otherwise snap to it
  else pos.push(args[i]);
}
const [inFile, outSvg] = pos;
if (!inFile || !outSvg || !fs.existsSync(inFile)) {
  console.error('usage: node scripts/design/mark-from-raster.mjs <in.png|jpg|svg> <out.svg> [--thr 0.12] [--colors 8] [--pad 0.04] [--no-snap] [--allow-terracotta] [--ignore-bottom 0.08]');
  process.exit(1);
}

// locked brand hexes (tokens $meta.brandLocked) plus the mark-gradient stops build-mark.mjs already uses
const LOCKED = { charcoal: '#0A0B0E', panel: '#14171E', emerald: '#1E5A46', gold: '#C6A860', ivory: '#EFE7D6', terracotta: '#B0603A',
  'gold-light': '#E9CC7E', 'emerald-light': '#2E7A5E', 'emerald-deep': '#12241C', olive: '#5E6B45', white: '#FFFFFF', black: '#000000' };
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nearest = (rgb) => Object.entries(LOCKED).filter(([n]) => opt.terracotta || n !== 'terracotta').map(([name, hex]) => ({ name, hex, d: dist(rgb, hex2rgb(hex)) })).sort((a, b) => a.d - b.d)[0];

const ext = path.extname(inFile).slice(1).toLowerCase();
const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
if (!mime) { console.error('unsupported input type:', ext); process.exit(1); }
const uri = `data:${mime};base64,${fs.readFileSync(inFile).toString('base64')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 2000 } });
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js' });
  const r = await page.evaluate(async ({ uri, thr, colors, pad, ignoreBottom }) => {
    const img = new Image(); img.src = uri; await img.decode();
    const W = Math.min(img.naturalWidth || 2000, 2000), H = Math.round(W * (img.naturalHeight || 2000) / (img.naturalWidth || 2000));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    // background = mean of four 6×6 corner patches (transparent corners count as background too)
    const patch = [], S = 6;
    for (const [cx, cy] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) for (let y = cy; y < cy + S; y++) for (let x = cx; x < cx + S; x++) patch.push(px(x, y));
    const bg = [0, 1, 2].map((k) => Math.round(patch.reduce((s, p) => s + p[k], 0) / patch.length));
    const bgAlpha = patch.reduce((s, p) => s + p[3], 0) / patch.length;
    const lum = (p) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    const bgL = lum(bg);
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    const yMax = Math.round(H * (1 - ignoreBottom));
    for (let y = 0; y < yMax; y++) for (let x = 0; x < W; x++) {
      const p = px(x, y);
      const fg = bgAlpha < 128 ? p[3] > 40 : (Math.abs(lum(p) - bgL) > thr || Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) / 255 > thr * 1.6);
      if (fg) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return { error: 'no foreground found — lower --thr or check the background' };
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, p = Math.round(Math.max(bw, bh) * pad);
    const cx0 = Math.max(0, x0 - p), cy0 = Math.max(0, y0 - p), cw = Math.min(W - cx0, bw + 2 * p), ch = Math.min(H - cy0, bh + 2 * p);
    const id = ctx.getImageData(cx0, cy0, cw, ch);
    // eslint-disable-next-line no-undef
    const svg = ImageTracer.imagedataToSVG(id, { numberofcolors: colors, colorquantcycles: 5, ltres: 0.6, qtres: 0.6, pathomit: 14, strokewidth: 0, scale: 1, roundcoords: 1, blurradius: 0, mincolorratio: 0.015 });
    return { svg, bg, bgAlpha, bbox: { x: x0, y: y0, w: bw, h: bh }, crop: { x: cx0, y: cy0, w: cw, h: ch }, source: { w: W, h: H }, fgPixels: n };
  }, { uri, thr: opt.thr, colors: opt.colors, pad: opt.pad, ignoreBottom: opt.ignoreBottom });
  if (r.error) { console.error(r.error); process.exit(2); }

  // ---- post-process: drop background-coloured paths, snap the rest to locked hexes ----
  const bgTol = r.bgAlpha < 128 ? -1 : 40;
  const colourMap = {}; let dropped = 0, kept = 0;
  let body = r.svg.replace(/<path\b[^>]*\/>/g, (tag) => {
    const m = tag.match(/fill="rgb\((\d+),(\d+),(\d+)\)"/);
    if (!m) return tag;
    const rgb = m.slice(1, 4).map(Number);
    if (bgTol >= 0 && dist(rgb, r.bg) <= bgTol) { dropped++; return ''; }
    const key = `rgb(${rgb.join(',')})`;
    let fill = key;
    if (opt.snap) { const s = nearest(rgb); fill = s.hex; colourMap[key] = { to: s.hex, name: s.name, distance: Math.round(s.d) }; }
    kept++;
    return tag.replace(/fill="[^"]*"/, `fill="${fill}"`).replace(/\s*stroke="[^"]*"/, '').replace(/\s*stroke-width="[^"]*"/, '').replace(/\s*opacity="1"/, '');
  });
  body = body.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<desc>[\s\S]*?<\/desc>/, '').trim();
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.crop.w} ${r.crop.h}" width="${r.crop.w}" height="${r.crop.h}"><title>traced mark — fallback vector, not a geometric rebuild</title>${body}</svg>`;
  fs.mkdirSync(path.dirname(path.resolve(outSvg)), { recursive: true });
  fs.writeFileSync(outSvg, out);
  const report = { input: path.resolve(inFile), output: path.resolve(outSvg), options: opt, background: { rgb: r.bg, alpha: Math.round(r.bgAlpha) }, source: r.source, bbox: r.bbox, crop: r.crop,
    foregroundPixels: r.fgPixels, paths: { kept, droppedBackground: dropped }, colours: colourMap, uniqueFills: [...new Set(Object.values(colourMap).map((c) => c.hex || c.to))], bytes: out.length,
    note: 'auto-trace of a raster; review the preview before use — gradients become bands, small features may merge' };
  fs.writeFileSync(outSvg + '.json', JSON.stringify(report, null, 2));
  console.log(`traced ${path.basename(inFile)} → ${outSvg}: crop ${r.crop.w}×${r.crop.h} (bbox ${r.bbox.w}×${r.bbox.h} of ${r.source.w}×${r.source.h}), paths ${kept} kept / ${dropped} background dropped, fills ${report.uniqueFills.join(' ')}, ${(out.length / 1024).toFixed(0)} KB`);
} finally { await browser.close(); }
