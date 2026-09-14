// text2path.mjs — glyph outlines of a string as one SVG path (origin baseline-left), via opentype.js in Chromium.
// usage: node scripts/design/text2path.mjs <font.woff|ttf> <text> [fontSize=100] [letterSpacingEm=0] [opentype.min.js=scripts/design/fonts/opentype.min.js]
// Prints JSON { d, width, ascender, descender, capHeight, family }.
import { chromium } from 'playwright'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [font, text, size = '100', ls = '0', lib = path.join(here, 'fonts', 'opentype.min.js')] = process.argv.slice(2);
if (!font || !text) { console.error('usage: node scripts/design/text2path.mjs <font> <text> [size] [letterSpacingEm] [opentype.min.js]'); process.exit(1); }
const br = await chromium.launch(); const p = await br.newPage();
await p.setContent(`<script>${fs.readFileSync(lib, 'utf8')}</script>`);
const out = await p.evaluate(([b64, text, size, ls]) => {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; const f = opentype.parse(bin);
  const fs = +size, sp = +ls * fs; let x = 0; const parts = [];
  const glyphs = f.stringToGlyphs(text);
  glyphs.forEach((g, i) => { const path = g.getPath(x, 0, fs); parts.push(path.toPathData(2)); x += g.advanceWidth / f.unitsPerEm * fs + sp; if (i < glyphs.length - 1 && glyphs[i + 1]) x += (f.getKerningValue(g, glyphs[i + 1]) / f.unitsPerEm) * fs; });
  return { d: parts.join(' '), width: x - sp, ascender: f.ascender / f.unitsPerEm * fs, descender: f.descender / f.unitsPerEm * fs, capHeight: (f.tables.os2?.sCapHeight || 0) / f.unitsPerEm * fs, family: f.names.fontFamily?.en };
}, [fs.readFileSync(font).toString('base64'), text, size, ls]);
await br.close(); console.log(JSON.stringify(out));
