// crop.mjs — crop a rectangle out of a PNG (image is laid out at 2000×2000 CSS px, clip in those units).
// usage: node scripts/design/crop.mjs <in.png> <out.png> <x> <y> <w> <h>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [img,out,x,y,w,h]=process.argv.slice(2);
if(!img||!out||h===undefined){console.error('usage: node scripts/design/crop.mjs <in.png> <out.png> <x> <y> <w> <h>');process.exit(1);}
const b64=fs.readFileSync(path.resolve(img)).toString('base64');
const uri=`data:image/png;base64,${b64}`;
const br=await chromium.launch();
try{
  const p=await br.newPage({viewport:{width:2000,height:2000}});
  await p.setContent(`<style>*{margin:0;padding:0}</style><img id=i src="${uri}" width="2000" height="2000" style="display:block">`);
  await p.waitForFunction(()=>{const i=document.getElementById('i');return i&&i.complete&&i.naturalWidth>0},{timeout:15000});
  await p.screenshot({path:path.resolve(out),clip:{x:+x,y:+y,width:+w,height:+h}});
  console.log('cropped',out);
}finally{await br.close();}
