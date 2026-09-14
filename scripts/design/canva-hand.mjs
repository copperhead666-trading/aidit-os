// canva-hand.mjs — generate design candidates through the Canva MCP under the owner's Pro account, headlessly:
// spawns `claude -p` from the repo root (the project .mcp.json registers the canva server; the OAuth token lives in
// Claude Code's own store after the owner's one-time /mcp login), lets the lane call generate-design → candidates → create → export,
// then downloads each export URL to <outDir>/canva-<i>.png and writes <outDir>/canva.json (prompt, type, candidates, usage, ms).
// usage: node scripts/design/canva-hand.mjs <brief.md|"prompt"> <outDir> [--n 4] [--type logo|social|presentation] [--dry-run]
// Exit 0 ok · 1 usage · 2 CLI/parse/download failure · 3 Canva not authorised (owner runs `/mcp` in Claude Code once).
// Test hook: CANVA_HAND_CLI=<node script> replaces the claude binary (see canva-hand.test.mjs). Never fetch design.canva.ai thumbnails (403).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
// Run claude from the MAIN checkout (git common root): only that project is trusted in ~/.claude.json and
// carries the canva server in .mcp.json. A task worktree or _scratch-* worktree is untrusted → Canva silently absent.
function mainRepo() {
  try { const { execFileSync } = require('node:child_process'); const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: here, encoding: 'utf8', windowsHide: true }).trim(); return path.dirname(path.resolve(here, common)); } catch { return path.resolve(here, '..', '..'); }
}
const REPO = mainRepo();
const CANVA_URL_DEFAULT = 'https://mcp.canva.com/mcp';
const TOOLS = ['generate-design', 'generate-design-structured', 'get-design-candidates', 'create-design-from-candidate', 'export-design', 'get-export-formats'].map((t) => `mcp__canva__${t}`);
const TIMEOUT_MS = 10 * 60 * 1000, DL_TIMEOUT_MS = 60 * 1000;

const args = process.argv.slice(2);
const opt = { n: 4, type: 'logo', dryRun: false };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--n') opt.n = Math.max(1, Math.min(8, Number(args[++i]) || 4));
  else if (args[i] === '--type') opt.type = args[++i] || 'logo';
  else if (args[i] === '--dry-run') opt.dryRun = true;
  else pos.push(args[i]);
}
const [src, outDir] = pos;
if (!src || !outDir || !['logo', 'social', 'presentation'].includes(opt.type)) {
  console.error('usage: node scripts/design/canva-hand.mjs <brief.md|"prompt"> <outDir> [--n 4] [--type logo|social|presentation] [--dry-run]');
  process.exit(1);
}

// ---- prompt (same convention as imagegen: first fenced block of a .md, else the argument itself) ----
let prompt = src, promptSource = 'argument';
if (/\.md$/i.test(src) && fs.existsSync(src)) {
  const m = fs.readFileSync(src, 'utf8').match(/```[^\n]*\n([\s\S]*?)```/);
  if (!m) { console.error('no fenced ``` block found in', src); process.exit(1); }
  prompt = m[1].trim(); promptSource = path.resolve(src);
}
prompt = prompt.replace(/\s+/g, ' ').trim();
if (prompt.length < 8) { console.error('prompt too short'); process.exit(1); }

// ---- canva server must be registered in the repo .mcp.json (probe: node ops-watcher/mcp-probe.mjs → authorized: yes) ----
let canvaUrl = null;
try { canvaUrl = JSON.parse(fs.readFileSync(path.join(REPO, '.mcp.json'), 'utf8')).mcpServers?.canva?.url || null; } catch { /* no .mcp.json */ }
if (!canvaUrl && !process.env.CANVA_HAND_CLI) { console.error('canva tidak terdaftar di .mcp.json — daftarkan lalu login sekali lewat /mcp'); process.exit(3); }

const instruction = `Kamu adalah tangan desain Aidit OS. Gunakan HANYA tool Canva MCP. Jangan tulis file, jangan pakai tool lain.
Langkah:
1. Panggil generate-design dengan design_type="${opt.type}" dan prompt berikut, apa adanya:
"""
${prompt}
"""
2. Ambil kandidat dengan get-design-candidates memakai job id yang dikembalikan; ulangi sampai status selesai.
3. Untuk maksimal ${opt.n} kandidat pertama: create-design-from-candidate, lalu export-design format png dengan ukuran terbesar yang diizinkan (maks 2000 px). Jangan pernah membuka atau mengunduh thumbnail design.canva.ai.
4. Setelah selesai, cetak SATU blok JSON persis berbentuk:
{"candidates":[{"design_id":"...","edit_url":"...","export_url":"...","candidate_id":"..."}],"usage":{"generations":1,"exports":N}}
dan JANGAN menulis apa pun setelah blok itu. Kalau Canva menolak karena belum login/unauthorized, cetak hanya: CANVA_UNAUTHORIZED.`;

// Resolve the real binary: Node refuses to spawn .cmd shims without a shell, and a shell would mangle the long
// instruction. The npm shim on Windows just calls bin/claude.exe next to it; on POSIX 'claude' is a real file.
function resolveClaude() {
  if (process.env.CANVA_HAND_CLI) return process.env.CANVA_HAND_CLI;
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    for (const name of process.platform === 'win32' ? ['claude.exe', 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'] : ['claude']) {
      const p = path.join(dir, name); if (fs.existsSync(p)) return p;
    }
  }
  return 'claude';
}
const cli = resolveClaude();
// Instruction goes in as the -p argument (never stdin: headless claude waits on a closed pipe otherwise).
const cliArgs = ['-p', '<instruction>', '--output-format', 'json', '--allowedTools', TOOLS.join(','), '--max-turns', '16'];
if (opt.dryRun) {
  console.log('cwd:', REPO);
  console.log('command:', cli, cliArgs.join(' '));
  console.log('mcp:', canvaUrl || '(CANVA_HAND_CLI test mode)');
  console.log('--- instruction ---\n' + instruction);
  process.exit(0);
}

// ---- run the lane ----
const OUT = path.resolve(outDir); fs.mkdirSync(OUT, { recursive: true });
const finalArgs = cliArgs.map((a) => (a === '<instruction>' ? instruction : a));
const t0 = Date.now();
const isScript = /\.(mjs|cjs|js)$/i.test(cli);
const run = spawnSync(isScript ? process.execPath : cli, isScript ? [cli, ...finalArgs] : finalArgs, { cwd: REPO, input: isScript ? instruction : '', encoding: 'utf8', timeout: TIMEOUT_MS, shell: false, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const ms = Date.now() - t0;
const stdout = run.stdout || '', stderr = run.stderr || '';

// ---- interpret ----
let resultText = stdout;
try { const j = JSON.parse(stdout); if (typeof j.result === 'string') resultText = j.result; else if (j.is_error) resultText = JSON.stringify(j); } catch { /* not json: treat stdout as text */ }
const all = resultText + '\n' + stderr;
if (/CANVA_UNAUTHORIZED|unauthori[sz]ed|\b401\b|not authenticated|needs authentication|authentication required/i.test(all)) {
  console.error('Canva belum login: jalankan /mcp di Claude Code (sekali)');
  fs.writeFileSync(path.join(OUT, 'canva.json'), JSON.stringify({ prompt, promptSource, type: opt.type, error: 'unauthorized', ms, cliExit: run.status, stderr: stderr.slice(0, 2000) }, null, 2));
  process.exit(3);
}
if (run.error || run.status !== 0) {
  console.error(`claude CLI failed (exit ${run.status ?? run.error?.code ?? 'spawn error'}): ${(run.error?.message || stderr || stdout).slice(0, 800)}`);
  fs.writeFileSync(path.join(OUT, 'canva.json'), JSON.stringify({ prompt, promptSource, type: opt.type, error: 'cli', ms, cliExit: run.status, stderr: stderr.slice(0, 2000) }, null, 2));
  process.exit(2);
}
// last balanced {...} block that contains "candidates"
function lastJsonBlock(text) {
  const key = text.lastIndexOf('"candidates"'); if (key < 0) return null;
  for (let start = text.lastIndexOf('{', key); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) { try { const o = JSON.parse(text.slice(start, i + 1)); if (Array.isArray(o.candidates)) return o; } catch { /* keep scanning */ } break; }
    }
  }
  return null;
}
const block = lastJsonBlock(resultText);
if (!block || !block.candidates.length) {
  console.error('no candidates block in CLI output; tail:', resultText.slice(-600));
  fs.writeFileSync(path.join(OUT, 'canva.json'), JSON.stringify({ prompt, promptSource, type: opt.type, error: 'no-candidates', ms, cliExit: run.status, tail: resultText.slice(-2000) }, null, 2));
  process.exit(2);
}

// ---- download exports (presigned plain GET; file:/data: accepted for offline tests) ----
async function download(url) {
  if (url.startsWith('file://')) return fs.readFileSync(fileURLToPath(url));
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  if (/design\.canva\.ai/i.test(url)) throw new Error('refusing thumbnail host design.canva.ai');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), DL_TIMEOUT_MS);
  try { const res = await fetch(url, { signal: ctl.signal }); if (res.status !== 200) throw new Error(`HTTP ${res.status}`); return Buffer.from(await res.arrayBuffer()); }
  finally { clearTimeout(timer); }
}
const candidates = [];
for (const [i, c] of block.candidates.slice(0, opt.n).entries()) {
  const file = `canva-${i + 1}.png`;
  try {
    if (!c.export_url) throw new Error('no export_url');
    const buf = await download(c.export_url);
    if (!(buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47)) throw new Error(`not a PNG (${buf.length} bytes)`);
    fs.writeFileSync(path.join(OUT, file), buf);
    candidates.push({ ...c, file, bytes: buf.length });
    console.log(`${file} ${(buf.length / 1024).toFixed(0)} KB  design ${c.design_id || '?'}`);
  } catch (e) { candidates.push({ ...c, file: null, error: e.message }); console.error(`candidate ${i + 1}: ${e.message}`); }
}
const ok = candidates.filter((c) => c.file).length;
fs.writeFileSync(path.join(OUT, 'canva.json'), JSON.stringify({ prompt, promptSource, type: opt.type, mcp: canvaUrl, candidates, usage: block.usage || null, ms, cliExit: run.status, generated: new Date().toISOString() }, null, 2));
console.log(`canva-hand: ${ok}/${candidates.length} candidates downloaded to ${OUT} in ${ms} ms`);
process.exit(ok ? 0 : 2);
