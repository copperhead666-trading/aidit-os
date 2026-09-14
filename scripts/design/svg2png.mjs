// svg2png.mjs — rasterize an SVG centred on a 600×600 canvas at 2x (default charcoal background).
// usage: node scripts/design/svg2png.mjs <in.svg> <out.png> [bg=#0A0B0E]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [svg,out,bg='#0A0B0E']=process.argv.slice(2);
if(!svg||!out){console.error('usage: node scripts/design/svg2png.mjs <in.svg> <out.png> [bg]');process.exit(1);}
const s=fs.readFileSync(path.resolve(svg),'utf8');
const br=await chromium.launch();
try{
  const p=await br.newPage({viewport:{width:600,height:600},deviceScaleFactor:2});
  await p.setContent(`<style>*{margin:0}body{background:${bg};display:grid;place-items:center;height:600px}svg{width:420px;height:auto}</style>${s}`);
  await p.waitForTimeout(300);
  await p.screenshot({path:path.resolve(out)});
  console.log('rendered',out);
}finally{await br.close();}
