#!/usr/bin/env node
// render-design.mjs — render an HTML file to a PNG via headless Chromium (Playwright).
// Part of the Aidit OS design pipeline: lanes/curator produce HTML/CSS; this rasterizes
// it to a high-DPI image for review, curation, and delivery.
//
// usage: node scripts/design/render-design.mjs <input.html> <output.png> [width=1280] [height=720] [scale=2]
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [inHtml, outPng, w = '1280', h = '720', scale = '2'] = process.argv.slice(2);
if (!inHtml || !outPng) {
  console.error('usage: node scripts/design/render-design.mjs <input.html> <output.png> [width] [height] [scale]');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: Number(scale),
  });
  await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: 'networkidle' });
  // give web fonts a beat to settle
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.resolve(outPng) });
  console.log('rendered', outPng);
} finally {
  await browser.close();
}
