// One-shot deterministic status line for the orchestrator session and any
// wakeup (PRD v5.1 s6.1). Never open raw ledger/PM2 logs by hand — run this.
// Usage: node conductor/status.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE, ROOT, company, lanesCfg, isPaused, wibParts, readJson, run, pc } from './lib.mjs';
import { lanesStatus, laneState } from './lanes.mjs';

const co = company();

async function pm2Summary() {
  // 2026-09-18 harness fix: without an explicit PM2_HOME, `pm2 jlist` can
  // fail to reach the already-running daemon (Windows named-pipe race,
  // worse under memory pressure) and silently spawns a brand-new detached
  // daemon instead -- found live: ~100 orphaned `pm2/lib/Daemon.js`
  // processes had piled up from repeated status/deadman checks, eating the
  // RAM that then killed a real dispatch. Pinning the real home removes the
  // ambiguity that causes that spawn.
  const r = await run(process.platform === 'win32' ? 'pm2.cmd' : 'pm2', ['jlist'], { timeoutMs: 15000, env: { ...process.env, PM2_HOME: process.env.PM2_HOME || 'D:\\pm2home' } });
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

// instruksi-06 s5: pakai laneState() (lanes.mjs) langsung, bukan logika
// duplikat -- sebelumnya baris ini tidak tahu soal activeFrom/activeUntil
// dan bisa menampilkan "ready" untuk lane yang sebenarnya belum/tidak aktif.
function laneLine() {
  const cfg = lanesCfg();
  const st = lanesStatus();
  return Object.keys(cfg.lanes).map((id) => {
    const state = laneState(id);
    if (state === 'resting') {
      const until = st.lanes[id]?.until;
      return until ? `${id}=resting(${until.slice(11, 16)})` : `${id}=resting`;
    }
    return `${id}=${state}`;
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

async function claudeAccounts() {
  const dirs = { '~/.claude (orkestrator)': undefined, 'D:/aidit-claude-machine (mesin)': 'D:/aidit-claude-machine' };
  const lines = [];
  for (const [label, dir] of Object.entries(dirs)) {
    const env = dir ? { ...process.env, CLAUDE_CONFIG_DIR: dir } : process.env;
    const r = await run(process.platform === 'win32' ? 'claude.cmd' : 'claude', ['auth', 'status'], { env, timeoutMs: 15000 });
    try {
      const j = JSON.parse(r.stdout);
      lines.push(`${label}=${j.loggedIn ? j.email : 'logged out'}`);
    } catch { lines.push(`${label}=(gagal baca)`); }
  }
  return lines.join(' | ');
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

// PRD JARVIS s1: reusable by conductor/chat.mjs (and anything else that
// wants the same ~20-line deterministic snapshot) without re-running main()'s
// console.log side effects. Same fields, same values as before this split.
export async function snapshot() {
  const p = wibParts();
  const [claude, pm2, boardStr] = await Promise.all([claudeAccounts(), pm2Summary(), board()]);
  return {
    wib: `${p.date} ${p.time}`,
    paused: isPaused(),
    claude,
    pm2,
    board: boardStr,
    busyHeads: busyHeads(),
    lanes: laneLine(),
    asks: pendingAsks(),
    usageToday: usageToday(),
  };
}

async function main() {
  const s = await snapshot();
  console.log(`WIB ${s.wib} | paused=${s.paused}`);
  console.log(`claude: ${s.claude}`);
  console.log(`pm2: ${s.pm2}`);
  console.log(`papan: ${s.board}`);
  console.log(`kepala sibuk: ${s.busyHeads}`);
  console.log(`lane: ${s.lanes}`);
  console.log(`ask menunggu: ${s.asks}`);
  console.log(`pemakaian hari ini: ${s.usageToday}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((e) => { console.error('status gagal:', e.message); process.exit(1); });
