// image-brief.mjs — turn a short design brief into the 10-part art-directed prompt (docs/brand/DESIGN-PROMPT-STANDARD.md)
// that imagegen.mjs consumes; missing parts are filled with brand defaults. The first fenced block of the .md is the prompt.
// usage: node scripts/design/image-brief.mjs <brief.json> <out.md> [--canva]
//   --canva appends instructions for a manual Canva run by the owner; nothing in the pipeline depends on it.
// brief.json: { goal, format, concept, composition, elements, palette, texture, typography, language, avoid, direction,
//               kind?: "logo"|"background"|"generic" (picks the defaults), title?, slug?, category?, variations? }
import fs from 'node:fs';
import path from 'node:path';

const CANVA = process.argv.includes('--canva');
const [briefPath, outPath] = process.argv.slice(2).filter((a) => a !== '--canva');
if (!briefPath || !outPath) {
  console.error('usage: node scripts/design/image-brief.mjs <brief.json> <out.md> [--canva]');
  process.exit(1);
}
let brief;
try { brief = JSON.parse(fs.readFileSync(path.resolve(briefPath), 'utf8')); }
catch (e) { console.error('cannot read brief:', e.message); process.exit(1); }
if (!brief || typeof brief !== 'object' || !brief.goal) { console.error('brief.json needs at least { goal }'); process.exit(1); }

// ---- brand defaults (locked palette; see docs/brand/tokens/tokens.json $meta.brandLocked) ----
const PALETTE = { charcoal: '#0A0B0E', panel: '#14171E', emerald: '#1E5A46', gold: '#C6A860', ivory: '#EFE7D6', terracotta: '#B0603A' };
// defaults follow the brief's kind: a logo wants symmetry and a silhouette test, a background wants an empty field
const KIND = ['logo', 'background', 'generic'].includes(brief.kind) ? brief.kind : 'logo';
const byKind = (o) => o[KIND];
const D = {
  format: byKind({ logo: 'One output, square 1:1, 2000 px, symbol only, no text. Subject centred, occupying ~45% of the canvas height, generous negative space.',
    background: 'One output, 16:9, 2000 px wide, no subject, no text. A uniform field that stays quiet behind typography added later.',
    generic: 'One output, 2000 px on the long side, no text.' }),
  concept: 'Aidit OS gateway monogram: an emerald frame with a golden arch; a family business (rumah makan roots) run with a calm, futuristic operating system. Refined heritage crest, not clip-art.',
  composition: byKind({ logo: 'Perfect vertical symmetry. Subject apex at 30% from the top, base at 70%. Silhouette must still read at 32 px. At least 25% clear space on every side.',
    background: 'Uniform field; a faint vignette darkening toward the edges (max 8%); nothing that competes with a logo or text placed on top; the centre 60% stays calm.',
    generic: 'One focal subject, centred or on a third; generous negative space (at least 30% of the canvas empty).' }),
  elements: byKind({ logo: 'Every part described: clean closed shapes, consistent stroke weight, edges crisp, no overlapping parts that muddy the silhouette.',
    background: 'Grain: very fine, even, like anodized metal or laid paper; no visible pattern repeat; no objects, no shapes, no light sources in frame.',
    generic: 'Each element clean and deliberate; consistent line weight; no incidental clutter.' }),
  palette: `charcoal ${PALETTE.charcoal} background, emerald ${PALETTE.emerald}, champagne gold ${PALETTE.gold}, ivory ${PALETTE.ivory}. No other hues.`,
  texture: 'flat vector with a very subtle fine paper grain, soft directional light from top-left, no glossy highlights, no 3D bevel, no drop shadow.',
  typography: 'none — no text in the image (typography is added later in HTML).',
  language: 'quiet, refined, premium, high-recognition, institutional, calm.',
  avoid: ['text', 'letters', 'gibberish', 'watermarks', 'clip-art icons', 'generic AI look', 'cartoon shading', 'rainbow or busy gradients', 'glow and sparkles', 'frames and ribbons', 'busy background', 'extra elements not listed above'],
  direction: byKind({ logo: 'a quiet emerald-and-gold piece, symmetrical, restrained, that sits naturally beside the Aidit OS "A" arch mark.',
    background: 'a dark, matte, almost-empty surface with one restrained brand accent; it should disappear behind the content placed on it.',
    generic: 'restrained, premium, emerald-and-gold on charcoal; nothing decorative that the brief did not ask for.' }),
};
const pick = (k) => { const v = brief[k]; return v == null || v === '' || (Array.isArray(v) && !v.length) ? D[k] : v; };
const list = (v) => (Array.isArray(v) ? v : String(v).split(/\s*[,;]\s*|\n/).filter(Boolean));
const avoid = [...new Set([...list(pick('avoid')), ...(brief.avoid ? D.avoid.slice(0, 4) : [])])]; // brief's AVOID first, brand basics always kept
const filled = ['format', 'concept', 'composition', 'elements', 'palette', 'texture', 'typography', 'language', 'direction'].filter((k) => pick(k) === D[k]);
const title = brief.title || brief.goal;
const slug = (brief.slug || String(title)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).replace(',', '') + ' WIB';

const prompt = `1. GOAL & FORMAT: ${brief.goal.trim().replace(/\.?$/, '.')} ${pick('format')}
2. LOCKED CONCEPT: ${pick('concept')}
3. COMPOSITION: ${pick('composition')}
4. ELEMENT DETAIL: ${pick('elements')}
5. PALETTE (max 4): ${pick('palette')}
6. TEXTURE / STYLE: ${pick('texture')}
7. TYPOGRAPHY: ${pick('typography')}
8. VISUAL LANGUAGE: ${pick('language')}
9. AVOID: ${avoid.join(', ')}.
10. FINAL ART DIRECTION: ${pick('direction')}`;

const variations = brief.variations?.length ? `\nVariasi yang diminta: ${list(brief.variations).map((v, i) => `(${String.fromCharCode(97 + i)}) ${v}`).join('; ')}.\n` : '';
const canvaSection = `
## Opsional — kalau owner ingin menjalankannya sendiri di Canva

- Generate 4 kandidat, pilih 1–2, kirim preview ke sesi dulu sebelum export final.
- Export **PNG 2000 px** (transparan kalau ada opsinya). SVG Canva untuk hasil AI hanya membungkus PNG, jadi PNG adalah sumber; vektor dibuat di sini (\`scripts/design/mark-from-raster.mjs\` / \`build-mark.mjs\`).
- Nama file: \`brand-kit/${brief.category || 'misc'}/${slug}-<nomor-kandidat>.png\`.
- Jangan pakai teks di dalam gambar AI; tipografi ditambahkan di HTML.
`;
const md = `# Image brief — ${title}

Ditulis ${stamp} oleh departemen design (Aidit OS). Dijalankan oleh sistem sendiri lewat
\`node scripts/design/imagegen.mjs <file ini> <outDir>\` (endpoint gratis, tanpa kunci); owner hanya menyetujui
atau menolak. Struktur mengikuti \`docs/brand/DESIGN-PROMPT-STANDARD.md\`.

## Prompt

\`\`\`
${prompt}
\`\`\`
${variations}${CANVA ? canvaSection : ''}
## Provenance

- Brief: \`${path.resolve(briefPath).replace(/\\/g, '/')}\` (kind: ${KIND}, slug: ${slug})
- Bagian yang diisi default brand (brief tidak menentukan): ${filled.length ? filled.join(', ') : 'tidak ada'}
- Palet terkunci: ${Object.entries(PALETTE).map(([k, v]) => `${k} ${v}`).join(', ')}
`;
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(path.resolve(outPath), md);
console.log('wrote', outPath, '| defaults used:', filled.join(', ') || 'none', CANVA ? '| canva section included' : '');
