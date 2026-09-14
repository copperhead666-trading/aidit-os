// vectorize.mjs — trace a raster (Canva export) into a flat-colour SVG via imagetracerjs (loaded from jsDelivr CDN).
// usage: node scripts/design/vectorize.mjs <in.png> <out.svg>   (needs network for the tracer lib; no paid spend)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [img,outSvg]=process.argv.slice(2);
if(!img||!outSvg){console.error('usage: node scripts/design/vectorize.mjs <in.png> <out.svg>');process.exit(1);}
const b64=fs.readFileSync(path.resolve(img)).toString('base64');
const uri=`data:image/png;base64,${b64}`;
const br=await chromium.launch();
try{
  const p=await br.newPage();
  await p.addScriptTag({url:'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js'});
  const svg=await p.evaluate(async(uri)=>{
    const img=new Image(); img.src=uri; await img.decode();
    const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
    const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
    const id=ctx.getImageData(0,0,c.width,c.height);
    // eslint-disable-next-line no-undef
    return ImageTracer.imagedataToSVG(id,{numberofcolors:6,colorquantcycles:6,ltres:0.5,qtres:0.5,pathomit:12,strokewidth:0,scale:1,roundcoords:1,blurradius:0,mincolorratio:0.02});
  },uri);
  fs.writeFileSync(path.resolve(outSvg),svg);
  console.log('svg bytes',svg.length);
}finally{await br.close();}
