# Canva prompts — Aidit OS brand kit (owner mengeksekusi)

Ditulis 2026-09-12 WIB. Canva MCP tidak tersambung di sesi ini, jadi owner
menjalankan prompt di Canva (Pro), lalu export dan taruh hasilnya di
`brand-kit/<kategori>/`. Semua prompt mengikuti `DESIGN-PROMPT-STANDARD.md`
(10 bagian). Prompt ditulis dalam bahasa Inggris karena generator Canva lebih
konsisten dengan prompt Inggris; instruksi untuk owner dalam bahasa Indonesia.

## Cara export (berlaku untuk semua)

- Generate 4 kandidat per prompt, pilih 1–2, kirim preview ke sesi ini dulu
  sebelum export final (kurasi via vision).
- Export **PNG 2000 px** (transparan kalau ada opsinya) **dan SVG**. Catatan:
  SVG Canva untuk hasil AI hanya membungkus PNG (bukan vektor asli), jadi PNG
  adalah sumber yang penting; vektor dibuat di sini lewat rebuild.
- Nama file: `brand-kit/<kategori>/<slug>-<nomor-kandidat>.png`.
- Jangan pakai teks di dalam gambar AI (gibberish); tipografi ditambahkan di
  HTML.

Palet yang dipakai di semua prompt: charcoal `#0A0B0E`, panel `#14171E`,
emerald `#1E5A46`, champagne gold `#C6A860`, ivory `#EFE7D6`,
terracotta `#B0603A` (warning saja, jarang).

---

## P1 — Logo SJS SuperApps (trefoil 5 daun) → `brand-kit/logo/sjs-*.png`

Konsep terkunci: bulir/biji emas di tengah + **lima daun** hijau (ibu owner 5
bersaudara; Sederhana Jaya 5 cabang). Versi 2 daun yang sudah ada dipakai
sebagai acuan gaya (grain tekstur halus, bentuk almond, latar hitam).

```
1. GOAL & FORMAT: One logo mark, square 1:1, symbol only, no text. Centered
   emblem occupying ~45% of the canvas height, generous negative space.
2. LOCKED CONCEPT: A single golden grain (rice seed, almond shape, pointed top,
   subtle central vein) rising from FIVE green leaves arranged symmetrically
   below it: two large outer leaves curving outward, two mid leaves, one small
   center leaf pointing down like a keel. Meaning: one family, five siblings,
   five branches, one harvest. Refined heritage crest, not a farm clip-art.
3. COMPOSITION: Perfect vertical symmetry. Grain apex at 30% from top, leaf
   cluster base at 70% from top. Leaves fan out at 25°, 50°, and 90° angles.
   Silhouette must read at 32 px.
4. ELEMENT DETAIL: Grain: smooth almond, softly beveled, thin darker vein down
   the center. Leaves: almond-shaped, single midrib line, tips slightly pointed,
   edges clean, no serration. All five leaves distinct, none overlapping the
   grain.
5. PALETTE (max 4): gold #C6A860 with warm highlight #E9CC7E on the grain;
   emerald #1E5A46 with lighter #2E7A5E on leaves; background near-black
   #0A0B0E. No other hues.
6. TEXTURE / STYLE: flat vector logo with a very subtle fine paper grain, soft
   directional light from top-left, no glossy highlights, no 3D bevel, no drop
   shadow.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: heritage, rooted, calm, premium, high recognition,
   institutional crest quality.
9. AVOID: text, letters, gibberish, clip-art plant icons, cartoon shading,
   rainbow gradients, glow, sparkles, extra seeds, more or fewer than five
   leaves, busy background, frames, ribbons, watermarks.
10. FINAL ART DIRECTION: a quiet gold-and-emerald crest of one grain over five
    leaves, symmetrical, restrained, ready to sit beside the Aidit OS "A" arch
    mark as a sibling brand.
```

Variasi yang diminta: (a) daun tersusun kipas rata; (b) daun berlapis dua
tingkat (3 bawah, 2 atas). Pilih yang paling kuat di ukuran kecil.

---

## P2 — Tekstur & latar brand → `brand-kit/texture/`

Dipakai untuk slide, cover, header Telegram, halaman guideline. Tiga varian,
masing-masing satu prompt. Format landscape 16:9, 2000 px lebar.

### P2a — Panel gelap bergrain (`texture/panel-dark-*.png`)

```
1. GOAL & FORMAT: One abstract background texture, 16:9, no subject, no text.
2. LOCKED CONCEPT: a dark command-deck panel surface: charcoal, matte, very
   fine grain like anodized metal under low light.
3. COMPOSITION: uniform field; a faint vignette darkening toward edges (max 8%
   luminance drop); a very subtle diagonal light sweep from top-left.
4. ELEMENT DETAIL: micro grain visible only at 100% zoom; no seams, no dust
   specks, no scratches.
5. PALETTE: base #0A0B0E to #14171E only; a whisper of emerald #1E5A46 at 3%
   opacity in the light sweep. No gold.
6. TEXTURE / STYLE: photographic realism of a material, not an illustration.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: quiet, expensive, still.
9. AVOID: bokeh, lens flare, neon, grid lines, circuit patterns, glow, any
   object, any text, banding.
10. FINAL ART DIRECTION: a near-black matte surface a founder would rest a
    decision on.
```

### P2b — Sapuan gradien emas–emerald (`texture/wash-gold-emerald-*.png`)

```
1. GOAL & FORMAT: One abstract gradient wash, 16:9, no subject, no text.
2. LOCKED CONCEPT: dawn over a dark horizon: warm gold light rising from the
   bottom-left into deep emerald, dissolving into charcoal at the top.
3. COMPOSITION: gold occupies the lower-left 20%, emerald the middle band,
   charcoal the upper 50%. Transition is smooth and cloud-like, no hard edge.
4. ELEMENT DETAIL: soft, slightly grainy film-like gradient; no shapes.
5. PALETTE: #C6A860 → #1E5A46 → #0A0B0E only.
6. TEXTURE / STYLE: analog film grain, subtle; matte, not glossy.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: calm dawn, sovereign, warm but restrained.
9. AVOID: sun disc, clouds, landscape, rays, lens flare, saturated orange,
   neon green, rainbow, text.
10. FINAL ART DIRECTION: the color story of the Aidit OS mark expanded into a
    full-bleed backdrop.
```

### P2c — Kertas ivory (`texture/paper-ivory-*.png`)

```
1. GOAL & FORMAT: One paper texture, 16:9, no subject, no text.
2. LOCKED CONCEPT: heavy ivory cotton paper for print documents and the
   inverse (light) brand mode.
3. COMPOSITION: uniform field, edge-to-edge, evenly lit.
4. ELEMENT DETAIL: fine cotton fiber, faint laid lines, no folds, no stains.
5. PALETTE: ivory #EFE7D6 base, fiber shadows no darker than #DCD3BF.
6. TEXTURE / STYLE: photographic material scan quality.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: archival, warm, precise.
9. AVOID: yellowing, coffee stains, torn edges, watermarks, vignette, text.
10. FINAL ART DIRECTION: the paper a signed decision is printed on.
```

---

## P3 — Motif turunan mark (arch tessellation) → `brand-kit/pattern/`

Motif dari bentuk "A" arch: bingkai segitiga tumpul dengan gerbang di
dalamnya, diulang jadi pola. Dipakai untuk cover deck, latar slide pembatas,
header Telegram, dan area kosong guideline.

```
1. GOAL & FORMAT: One seamless repeating pattern tile, square 1:1, no text.
2. LOCKED CONCEPT: a geometric lattice made from a single repeated glyph: a
   pointed arch (chevron with a rounded inner gate) — the same family as the
   Aidit OS "A" mark — laid out in offset rows like architectural tiling.
3. COMPOSITION: glyphs at 8% of tile width, staggered brick layout, equal
   spacing, edges tile seamlessly. Overall density light: 70% background
   visible.
4. ELEMENT DETAIL: thin line-work (stroke ~1.5% of glyph height), consistent
   weight, sharp apex, rounded gate, no fills.
5. PALETTE: background charcoal #0A0B0E; lines champagne gold #C6A860 at 35%
   opacity; every 7th glyph emerald #1E5A46 as a quiet accent.
6. TEXTURE / STYLE: flat vector line pattern, crisp.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: ordered, architectural, discreet, premium wallpaper.
9. AVOID: circuit boards, hexagons, random scatter, gradients, glow, 3D,
   thick strokes, text, visible tile seams.
10. FINAL ART DIRECTION: an architect's lattice of small gates, barely there,
    for surfaces behind the mark.
```

Varian kedua: sama, tapi background ivory #EFE7D6 dan garis emerald #1E5A46
(untuk mode terang).

---

## P4 — Mockup aplikasi → `brand-kit/mockup/`

Untuk mockup, **jangan** biarkan AI menggambar ulang logo (akan meleset).
Alur: generate mockup dengan area kosong, lalu tempel logo vektor di Canva
(upload `docs/brand/logo/aidit-os-mark.svg` sebagai elemen) sebelum export.

### P4a — App icon di layar HP (`mockup/app-icon-phone-*.png`)

```
1. GOAL & FORMAT: One product mockup photo, portrait 4:5, no text.
2. LOCKED CONCEPT: a modern smartphone lying on dark matte stone, screen
   showing a home grid of muted, blurred app icons with ONE empty rounded
   square slot in the center row left blank (solid charcoal #14171E) for a
   logo to be placed later.
3. COMPOSITION: phone centered, slight 10° tilt, top-down camera, soft
   shadow; the empty slot at exact screen center.
4. ELEMENT DETAIL: bezel thin, screen slightly dimmed, other icons generic
   grey shapes only.
5. PALETTE: charcoal, graphite, a faint warm gold rim light from the left.
6. TEXTURE / STYLE: photoreal studio product shot.
7. TYPOGRAPHY: none.
8. VISUAL LANGUAGE: calm, premium hardware.
9. AVOID: brand logos, readable UI text, bright wallpaper, reflections of
   people, hands.
10. FINAL ART DIRECTION: a quiet stage for the Aidit OS icon.
```

### P4b — Avatar / kartu nama / cover deck

Pakai template Canva biasa (bukan AI generate): kartu nama 90×55 mm, avatar
1:1 640 px, cover deck 16:9. Latar dari P2a/P2b, logo dari SVG, teks pakai
Sora 800 (judul) dan Inter (isi). Warna teks ivory `#EFE7D6`, aksen gold.
Export PNG 2000 px + PDF untuk kartu nama.

---

## Checklist kirim balik

- [ ] `brand-kit/logo/sjs-<n>.png` (+ SVG bungkus) — 1–2 kandidat terpilih
- [ ] `brand-kit/texture/panel-dark-<n>.png`
- [ ] `brand-kit/texture/wash-gold-emerald-<n>.png`
- [ ] `brand-kit/texture/paper-ivory-<n>.png`
- [ ] `brand-kit/pattern/arch-dark-<n>.png` dan `arch-ivory-<n>.png`
- [ ] `brand-kit/mockup/app-icon-phone-<n>.png`
