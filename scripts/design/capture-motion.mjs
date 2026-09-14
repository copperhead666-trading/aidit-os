#!/usr/bin/env node
// capture-motion.mjs — renders a settled still AND records a .webm of the page's load-time motion.
// usage: node scripts/design/capture-motion.mjs <input.html> <out.png> <videoDir> [w=1440] [h=1024] [ms=4800]
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [inHtml, outPng, vidDir, w = '1440', h = '1024', ms = '4800'] = process.argv.slice(2);
if (!inHtml || !outPng || !vidDir) { console.error('usage: node scripts/design/capture-motion.mjs <input.html> <out.png> <videoDir> [w] [h] [ms]'); process.exit(1); }
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 1,
    recordVideo: { dir: path.resolve(vidDir), size: { width: Number(w), height: Number(h) } },
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(ms));
  await page.screenshot({ path: path.resolve(outPng) });
  const vpath = await page.video().path();
  await ctx.close(); // finalizes video file
  console.log('still:', outPng);
  console.log('video:', vpath);
} finally {
  await browser.close();
}
