// render-full.mjs — full-page screenshot of an HTML file at 2x (tall pages: guideline, decks).
// usage: node scripts/design/render-full.mjs <input.html> <output.png> [width=1360]
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [inHtml,outPng,w='1360']=process.argv.slice(2);
if(!inHtml||!outPng){console.error('usage: node scripts/design/render-full.mjs <input.html> <output.png> [width]');process.exit(1);}
const b=await chromium.launch();
try{
  const p=await b.newPage({viewport:{width:Number(w),height:1000},deviceScaleFactor:2});
  await p.goto(pathToFileURL(path.resolve(inHtml)).href,{waitUntil:'networkidle'});
  await p.waitForTimeout(500);
  await p.screenshot({path:path.resolve(outPng),fullPage:true});
  console.log('rendered',outPng);
}finally{await b.close();}
