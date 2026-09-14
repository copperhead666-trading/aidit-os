// canva-hand.test.mjs — offline tests for canva-hand.mjs: a fake `claude` (CANVA_HAND_CLI) prints canned CLI json,
// export URLs point at a local PNG (file://) and a data: URI. No network, no Canva login needed.
// usage: node --test scripts/design/canva-hand.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.join(here, 'canva-hand.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-hand-test-'));
// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pngPath = path.join(tmp, 'export.png'); fs.writeFileSync(pngPath, PNG);

function fakeCli(name, body) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, `// fake claude CLI for tests\nlet input='';process.stdin.on('data',(d)=>input+=d).on('end',()=>{${body}});\n`);
  return p;
}
const run = (cli, extra = [], out = fs.mkdtempSync(path.join(tmp, 'out-'))) => ({
  out, r: spawnSync(process.execPath, [HAND, 'one golden rice grain above five emerald leaves, flat vector logo, no text', out, '--n', '2', ...extra], { encoding: 'utf8', env: { ...process.env, CANVA_HAND_CLI: cli }, windowsHide: true }),
});

test('dry-run prints command and instruction, exits 0, writes nothing', () => {
  const { out, r } = run('unused.mjs', ['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--allowedTools mcp__canva__generate-design/);
  assert.match(r.stdout, /mcp__canva__generate-design/);
  assert.match(r.stdout, /design_type="logo"/);
  assert.match(r.stdout, /five emerald leaves/);
  assert.equal(fs.existsSync(path.join(out, 'canva.json')), false);
});

test('happy path: parses the final JSON block from result, downloads exports, writes canva.json', () => {
  const block = JSON.stringify({ candidates: [
    { design_id: 'D1', edit_url: 'https://www.canva.com/design/D1/edit', export_url: pathToFileURL(pngPath).href, candidate_id: 'c1' },
    { design_id: 'D2', edit_url: 'https://www.canva.com/design/D2/edit', export_url: `data:image/png;base64,${PNG.toString('base64')}`, candidate_id: 'c2' },
    { design_id: 'D3', edit_url: 'x', export_url: 'file:///nope.png', candidate_id: 'c3' } ], usage: { generations: 1, exports: 2 } });
  const cli = fakeCli('ok.mjs', `if(!input.includes('generate-design'))process.exit(9);
    const result='Membuat desain...\\n'+${JSON.stringify(block)};
    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result,num_turns:6}));`);
  const { out, r } = run(cli);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(out, 'canva-1.png')));
  assert.ok(fs.existsSync(path.join(out, 'canva-2.png')));
  assert.equal(fs.existsSync(path.join(out, 'canva-3.png')), false, '--n 2 caps downloads');
  const j = JSON.parse(fs.readFileSync(path.join(out, 'canva.json'), 'utf8'));
  assert.equal(j.candidates.length, 2);
  assert.equal(j.candidates[0].bytes, PNG.length);
  assert.deepEqual(j.usage, { generations: 1, exports: 2 });
  assert.equal(j.type, 'logo');
  assert.equal(j.cliExit, 0);
});

test('unauthorized: exits 3 with the login hint', () => {
  const cli = fakeCli('auth.mjs', `process.stdout.write(JSON.stringify({type:'result',is_error:true,result:'MCP server canva: 401 Unauthorized — needs authentication'}));`);
  const { out, r } = run(cli);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Canva belum login: jalankan \/mcp/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'canva.json'), 'utf8')).error, 'unauthorized');
});

test('no candidates block: exits 2 and keeps the tail for debugging', () => {
  const cli = fakeCli('empty.mjs', `process.stdout.write(JSON.stringify({type:'result',is_error:false,result:'Saya tidak bisa membuat desain.'}));`);
  const { out, r } = run(cli);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no candidates block/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'canva.json'), 'utf8')).error, 'no-candidates');
});

test('thumbnail host is refused, never fetched', () => {
  const block = JSON.stringify({ candidates: [{ design_id: 'D1', export_url: 'https://design.canva.ai/thumb/1.png', candidate_id: 'c1' }], usage: { generations: 1, exports: 1 } });
  const cli = fakeCli('thumb.mjs', `process.stdout.write(JSON.stringify({type:'result',is_error:false,result:${JSON.stringify(block)}}));`);
  const { r } = run(cli);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing thumbnail host/);
});

test('cli crash: exits 2 with the exit code', () => {
  const cli = fakeCli('crash.mjs', `process.stderr.write('boom');process.exit(7);`);
  const { r } = run(cli);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /claude CLI failed \(exit 7\)/);
});
