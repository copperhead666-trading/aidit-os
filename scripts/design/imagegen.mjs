// imagegen.mjs — generate raster candidates from a prompt with a free, keyless endpoint (Pollinations, model flux).
// usage: node scripts/design/imagegen.mjs <brief.md|"prompt string"> <outDir> [--n 4] [--size 1024] [--seed N] [--model flux]
// A .md argument uses its first fenced ``` block (what image-brief.mjs writes); anything else is the prompt itself.
// Writes <outDir>/cand-<seed>.png per candidate and <outDir>/imagegen.json (prompt, model, seeds, bytes, ms, errors).
// One retry per candidate on non-200 / timeout (60 s). No key, no spend. Fails loudly; never falls back to another source.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { n: 4, size: 1024, seed: null, model: 'flux', width: null, height: null };
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--n') opt.n = Math.max(1, Math.min(8, Number(args[++i]) || 4));
  else if (a === '--size') opt.size = Number(args[++i]) || 1024;
  else if (a === '--seed') opt.seed = Number(args[++i]);
  else if (a === '--model') opt.model = args[++i] || 'flux';
  else if (a === '--width') opt.width = Number(args[++i]);
  else if (a === '--height') opt.height = Number(args[++i]);
  else pos.push(a);
}
const [src, outDir] = pos;
if (!src || !outDir) {
  console.error('usage: node scripts/design/imagegen.mjs <brief.md|"prompt"> <outDir> [--n 4] [--size 1024] [--seed N] [--model flux]');
  process.exit(1);
}

// ---- prompt ----
let prompt = src, promptSource = 'argument';
if (/\.md$/i.test(src) && fs.existsSync(src)) {
  const md = fs.readFileSync(src, 'utf8');
  const m = md.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) { console.error('no fenced ``` block found in', src); process.exit(1); }
  prompt = m[1].trim(); promptSource = path.resolve(src);
}
prompt = prompt.replace(/\s+/g, ' ').trim();
if (prompt.length < 8) { console.error('prompt too short'); process.exit(1); }
const W = opt.width || opt.size, H = opt.height || opt.size;
const seeds = Array.from({ length: opt.n }, (_, i) => (Number.isFinite(opt.seed) ? opt.seed + i : Math.floor(Math.random() * 1e9)));
const ENDPOINT = 'https://image.pollinations.ai/prompt/';
const TIMEOUT_MS = 60000;
fs.mkdirSync(path.resolve(outDir), { recursive: true });

async function fetchOnce(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'image/*' } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpg) throw new Error(`not an image (content-type ${type || 'none'}, ${buf.length} bytes)`);
    return { buf, type: isPng ? 'png' : 'jpeg' };
  } finally { clearTimeout(timer); }
}

const report = { endpoint: ENDPOINT, model: opt.model, width: W, height: H, prompt, promptSource, generated: new Date().toISOString(), candidates: [], errors: [] };
let ok = 0;
for (const seed of seeds) {
  const url = `${ENDPOINT}${encodeURIComponent(prompt)}?width=${W}&height=${H}&seed=${seed}&nologo=true&model=${encodeURIComponent(opt.model)}`;
  const t0 = Date.now();
  let result = null, lastErr = null;
  for (let attempt = 1; attempt <= 2 && !result; attempt++) {
    try { result = await fetchOnce(url); }
    catch (e) { lastErr = e.name === 'AbortError' ? new Error(`timeout after ${TIMEOUT_MS / 1000} s`) : e; console.error(`seed ${seed} attempt ${attempt} failed: ${lastErr.message}`); }
  }
  const ms = Date.now() - t0;
  if (!result) { report.errors.push({ seed, error: lastErr?.message || 'unknown', ms }); continue; }
  // the endpoint sometimes answers JPEG even when asked for PNG; keep the true extension so nothing downstream lies
  const file = path.join(path.resolve(outDir), `cand-${seed}.${result.type === 'png' ? 'png' : 'jpg'}`);
  fs.writeFileSync(file, result.buf);
  report.candidates.push({ seed, file: path.basename(file), bytes: result.buf.length, ms, format: result.type });
  ok++;
  console.log(`cand-${seed} ${result.type} ${(result.buf.length / 1024).toFixed(0)} KB ${ms} ms`);
}
report.ok = ok; report.requested = seeds.length;
fs.writeFileSync(path.join(path.resolve(outDir), 'imagegen.json'), JSON.stringify(report, null, 2));
if (ok === 0) {
  console.error(`imagegen: 0 of ${seeds.length} candidates produced — endpoint ${ENDPOINT} unreachable, blocked, or rejecting. No fallback; see imagegen.json errors.`);
  process.exit(2);
}
console.log(`imagegen: ${ok}/${seeds.length} candidates in ${outDir} (${W}×${H}, ${opt.model})${report.errors.length ? ` — ${report.errors.length} failed` : ''}`);
