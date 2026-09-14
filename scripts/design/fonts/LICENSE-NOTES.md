# Fonts and libraries bundled for the design hands

| File | Source | Licence |
|---|---|---|
| `sora-400.woff`, `sora-600.woff`, `sora-800.woff` | Google Fonts — Sora (Jonathan Barnbrook et al.) | SIL Open Font License 1.1 |
| `inter-400.woff`, `inter-500.woff`, `inter-600.woff` | Google Fonts — Inter (Rasmus Andersson) | SIL Open Font License 1.1 |
| `jbmono-500.woff` | Google Fonts — JetBrains Mono (JetBrains) | SIL Open Font License 1.1 |
| `opentype.min.js` | opentype.js (https://github.com/opentypejs/opentype.js) | MIT |

The woff files are subsets served by Google Fonts and are used only to convert
text to SVG outlines (`text2path.mjs`) and to render previews. OFL permits
bundling and embedding; it forbids selling the fonts on their own. opentype.js
is loaded into headless Chromium by `text2path.mjs`; the MIT notice is retained
in the minified file's header comment upstream.
