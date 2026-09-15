// One-shot deterministic status line for the orchestrator session and any
// wakeup (PRD v5.1 s6.1). Never open raw ledger/PM2 logs by hand — run this.
// Usage: node conductor/status.mjs
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ROOT, company, lanesCfg, isPaused, wibParts, readJson, run, pc } from './lib.mjs';
import { lanesStatus } from './lanes.mjs';

const co = company();

async function pm2Summary() {
  const r = await run(process.platform === 'win32' ? 'pm2.cmd' : 'pm2', ['jlist'], { timeoutMs: 15000 });
  try {
    const list = JSON.parse(r.stdout);
    return list.map((p) => `${p.name}:${p.pm2_env.status}`).join(', ');
  } catch { return `(pm2 jlist gagal: ${r.stderr.slice(0, 120)})`; }
}

async function board() {
  try {
    const issues = await pc('GET', `/api/companies/${readJson(path.join(ROOT, 'config', 'paperclip.json')).companyId}/issues`);
    const byStatus = {};
    for (const i of issues) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    return Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(' ');
  } catch (e) { return `(paperclip gagal: ${e.message.slice(0, 120)})`; }
}

function busyHeads() {
  const dir = path.join(STATE, 'locks');
  if (!fs.existsSync(dir)) return '(tidak ada)';
  const busy = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^head-(.+)\.lock$/);
    if (!m) continue;
    const lock = readJson(path.join(dir, f), null);
    if (!lock) continue;
    if (Date.now() - Date.parse(lock.at) < 2 * 3600000) busy.push(m[1]);
  }
  return busy.length ? busy.join(', ') : '(tidak ada)';
}

function laneLine() {
  const cfg = lanesCfg();
  const st = lanesStatus();
  return Object.keys(cfg.lanes).map((id) => {
    if (cfg.lanes[id].status === 'disabled') return `${id}=disabled`;
    const s = st.lanes[id];
    if (s?.state === 'resting' && s.until && Date.parse(s.until) > Date.now()) return `${id}=resting(${s.until.slice(11, 16)})`;
    return `${id}=ready`;
  }).join(' ');
}

function pendingAsks() {
  const file = path.join(STATE, 'asks.jsonl');
  if (!fs.existsSync(file)) return '(tidak ada)';
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byId = new Map();
  for (const r of rows) {
    if (r.answer) byId.delete(r.id);
    else byId.set(r.id, r.title || r.id);
  }
  return byId.size ? [...byId.values()].join('; ') : '(tidak ada)';
}

function usageToday() {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return '(ledger kosong)';
  const today = wibParts().date;
  const counts = { 'claude.call': {}, 'lane.run': {} };
  const stream = fs.readFileSync(file, 'utf8').trim().split('\n');
  for (const line of stream) {
    if (!line || !line.includes(today)) continue; // cheap pre-filter before JSON.parse
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.wib?.slice(0, 10) !== today) continue;
    if (row.kind === 'claude.call') {
      const k = `${row.model}${row.ok ? '' : '!'}`;
      counts['claude.call'][k] = (counts['claude.call'][k] || 0) + 1;
    } else if (row.kind === 'lane.run') {
      const k = `${row.lane}${row.ok ? '' : '!'}`;
      counts['lane.run'][k] = (counts['lane.run'][k] || 0) + 1;
    }
  }
  const claude = Object.entries(counts['claude.call']).map(([k, n]) => `${k}=${n}`).join(' ') || '(nihil)';
  const lane = Object.entries(counts['lane.run']).map(([k, n]) => `${k}=${n}`).join(' ') || '(nihil)';
  return `claude[${claude}] lane[${lane}]`;
}

async function main() {
  const p = wibParts();
  console.log(`WIB ${p.date} ${p.time} | paused=${isPaused()}`);
  console.log(`pm2: ${await pm2Summary()}`);
  console.log(`papan: ${await board()}`);
  console.log(`kepala sibuk: ${busyHeads()}`);
  console.log(`lane: ${laneLine()}`);
  console.log(`ask menunggu: ${pendingAsks()}`);
  console.log(`pemakaian hari ini: ${usageToday()}`);
}

main().catch((e) => { console.error('status gagal:', e.message); process.exit(1); });
