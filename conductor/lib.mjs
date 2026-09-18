// Shared helpers for the v5 back office: env, WIB clock, ledger, Paperclip
// client, Opus budget, pause flag. Pure Node 22, no framework.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE = path.join(ROOT, 'state');
export const NODE22 = process.env.AIDIT_NODE || 'D:/aidit-node/node-v22.14.0-win-x64/node.exe';

// RTK (PRD v5.1 s1/s6.4): installed to a dedicated dir, not the system PATH
// (avoids the setx ~1024-char truncation risk on this machine) — lane
// spawns that need it get it prepended to their own child env instead.
export const RTK_DIR = process.env.RTK_DIR || 'D:/aidit-tools/rtk';
export function withRtkPath(env = process.env) {
  const out = { ...env };
  const key = Object.keys(out).find((k) => k.toLowerCase() === 'path') || 'PATH';
  out[key] = `${RTK_DIR}${path.delimiter}${out[key] || ''}`;
  return out;
}

export function loadEnvLocal(file = path.join(ROOT, '.env.local')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const loaded = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) { process.env[key] = val; loaded.push(key); }
  }
  return loaded;
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const company = () => readJson(path.join(ROOT, 'config', 'company.json'));
export const paperclipCfg = () => readJson(path.join(ROOT, 'config', 'paperclip.json'), { baseUrl: 'http://127.0.0.1:3120' });
export const lanesCfg = () => readJson(path.join(ROOT, 'config', 'lanes.json'), { lanes: {}, roles: {} });

// ---- Self-learning (Personal Assistant PRD Bagian 8) -----------------------
// Distinct from self-repair (bug fixes) and self-improve (score.mjs drags ->
// tickets): this is Conductor updating what it KNOWS about a venture from a
// genuine owner decision (an approved document/interview), not just flipping
// a status flag. A single bounded string per venture (not an ever-growing
// log) so run.mjs's systemPrompt line stays cheap forever -- overwritten by
// the latest decision, not appended to.
export function recordVentureLearning(ventureId, text, source = 'unknown') {
  if (!ventureId || !text) return false;
  const file = path.join(ROOT, 'config', 'company.json');
  const co = readJson(file, null);
  const v = co?.ventures?.find((x) => x.id === ventureId);
  if (!v) return false;
  v.constraints = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);
  v.learnedAt = new Date().toISOString();
  v.learnedFrom = source;
  writeJson(file, co);
  ledgerAppend({ kind: 'venture.learned', ventureId, source, chars: v.constraints.length });
  return true;
}

// ---- WIB clock -------------------------------------------------------------
const WIB = 'Asia/Jakarta';
export function wibParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: WIB, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = Object.fromEntries(f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}.${o.minute}`, hour: Number(o.hour), minute: Number(o.minute), iso: d.toISOString() };
}
export const wibStamp = (d) => { const p = wibParts(d); return `${p.date} ${p.time} WIB`; };

// 2026-09-18 harness fix: "Waktu terlindungi" (docs/DECISIONS.md, keputusan
// 2026-09-18 "Waktu terlindungi") -- diam total (tanpa broadcast/eskalasi/
// pesan proaktif) 22.00-05.00 WIB setiap hari + Sabtu-Minggu sampai jam
// 10.00 WIB -- sudah tercatat sebagai aturan mengikat sejak awal tapi TIDAK
// PERNAH diimplementasikan di kode mana pun (dicek: nol referensi di
// conductor/*.mjs sebelum ini). Ditemukan/ditutup sesi instruksi-09 tepat
// sebelum Aidit tidur -- lihat pemakaian di conductor/owner.mjs.
export function isProtectedHours(d = new Date()) {
  const p = wibParts(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: WIB, weekday: 'short' }).format(d);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  if (p.hour >= 22 || p.hour < 5) return true;
  if (isWeekend && p.hour < 10) return true;
  return false;
}

// ---- Ledger ---------------------------------------------------------------
export function ledgerAppend(event) {
  const file = path.join(STATE, 'ledger.jsonl');
  fs.mkdirSync(STATE, { recursive: true });
  const row = { ts: new Date().toISOString(), wib: wibStamp(), ...event };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}
export function ledgerTail(n = 30) {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return [];
  // Tahap 3 (2026-09-17): jangan baca ledger penuh — ambil 256 KB terakhir
  // saja (cukup untuk n entri; tiap baris << 8 KB), lalu n baris terakhir.
  const size = fs.statSync(file).size;
  const CHUNK = 256 * 1024;
  let text;
  if (size <= CHUNK) {
    text = fs.readFileSync(file, 'utf8');
  } else {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(CHUNK);
    fs.readSync(fd, buf, 0, CHUNK, size - CHUNK);
    fs.closeSync(fd);
    text = buf.toString('utf8');
    const nl = text.indexOf('\n'); // buang baris pertama yang mungkin terpotong
    if (nl >= 0) text = text.slice(nl + 1);
  }
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Rotasi ledger (Tahap 3): bila ledger.jsonl melewati maxBytes, potong
// bagian lama ke state/ledger-<tanggal>.jsonl lalu kompres .gz (arsip,
// bukan hapus — keputusan owner: tidak ada penghapusan).
export function ledgerRotate(maxBytes = 5 * 1024 * 1024) {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  if (size <= maxBytes) return null;
  const keep = Math.floor(size * 0.2); // simpan 20% terbaru di file aktif
  const fd = fs.openSync(file, 'r');
  const old = Buffer.alloc(size - keep);
  fs.readSync(fd, old, 0, size - keep, 0);
  const rest = Buffer.alloc(keep);
  fs.readSync(fd, rest, 0, keep, size - keep);
  fs.closeSync(fd);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const archPlain = path.join(STATE, `ledger-${stamp}.jsonl`);
  fs.writeFileSync(archPlain, old);
  try {
    fs.writeFileSync(archPlain + '.gz', zlib.gzipSync(old));
    fs.unlinkSync(archPlain); // .gz adalah arsipnya; file mentah perantara dihapus
  } catch { /* bila gzip gagal, .jsonl polos tetap jadi arsip */ }
  fs.writeFileSync(file, rest);
  return { rotatedTo: archPlain + '.gz', archivedBytes: size - keep };
}

// ---- Pause flag (Telegram /pause) ------------------------------------------
const PAUSE_FILE = path.join(STATE, 'pause.json');
export const isPaused = () => !!readJson(PAUSE_FILE, null)?.paused;
export function setPaused(paused, by = 'owner') {
  writeJson(PAUSE_FILE, { paused, by, at: new Date().toISOString() });
  ledgerAppend({ kind: paused ? 'pause' : 'resume', by });
}

// ---- Opus budget (per WIB day) --------------------------------------------
const BUDGET_FILE = path.join(STATE, 'conductor-budget.json');
export function opusBudget(limit) {
  const today = wibParts().date;
  const b = readJson(BUDGET_FILE, { date: today, opusTurns: 0 });
  if (b.date !== today) { b.date = today; b.opusTurns = 0; }
  return {
    used: b.opusTurns,
    remaining: Math.max(0, limit - b.opusTurns),
    spend(n = 1) { b.opusTurns += n; writeJson(BUDGET_FILE, b); return b.opusTurns; },
  };
}

// ---- Per-lane daily task/call budget (PRD v5.1 s3: Codex 30/day, etc.) ----
const LANE_BUDGET_FILE = path.join(STATE, 'lane-budget.json');
export function laneBudget(id, limit) {
  const today = wibParts().date;
  const all = readJson(LANE_BUDGET_FILE, {});
  const cur = all[id]?.date === today ? all[id] : { date: today, count: 0 };
  return {
    used: cur.count,
    remaining: limit == null ? Infinity : Math.max(0, limit - cur.count),
    spend(n = 1) { cur.count += n; all[id] = cur; writeJson(LANE_BUDGET_FILE, all); return cur.count; },
  };
}

// ---- Paperclip client -----------------------------------------------------
export async function pc(method, p, body, base = paperclipCfg().baseUrl) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${String(text).slice(0, 200)}`);
  return json;
}
export async function paperclipHealth() {
  try { const h = await pc('GET', '/api/health'); return { ok: h.status === 'ok', version: h.version }; } catch (e) { return { ok: false, error: e.message }; }
}

// ---- Process runner -------------------------------------------------------
export function run(cmd, args, { cwd = ROOT, env = process.env, timeoutMs = 600000, input } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    const child = spawn(cmd, args, { cwd, env, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd), windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (input) child.stdin.end(input); else child.stdin?.end();
  });
}

// ---- graphify (PRD v5.1 s4 / JARVIS s1) -------------------------------------
// Shared by head.mjs, run.mjs and chat.mjs so all three ask the graph the
// same way instead of three slightly different implementations.
export const GRAPHIFY = process.env.GRAPHIFY_BIN || 'C:/Users/WIN10/.local/bin/graphify.exe';

// claude.cmd's shell:true spawn (needed since Windows can't exec a .cmd
// directly) sends the whole argv through cmd.exe, which silently drops an
// EMPTY-STRING arg (our `--setting-sources ''`) and shifts every arg after
// it left by one -- surfaced live as "Invalid setting source: --tools"/
// "--json-schema" (found while wiring conductor/chat.mjs's document
// ingestion). claude.cmd just wraps a real claude.exe one level down;
// spawning that directly (shell:false, no cmd.exe involved) passes argv
// through untouched. Resolved once per process, like hermesEntry() in
// lanes.mjs.
let CLAUDE_EXE = null;
export async function resolveClaudeBin() {
  if (CLAUDE_EXE) return CLAUDE_EXE;
  if (process.env.CLAUDE_EXE && fs.existsSync(process.env.CLAUDE_EXE)) return (CLAUDE_EXE = process.env.CLAUDE_EXE);
  if (process.platform !== 'win32') return (CLAUDE_EXE = 'claude');
  const r = await run('where', ['claude.cmd'], { timeoutMs: 10000 });
  const cmdPath = r.stdout.trim().split(/\r?\n/)[0];
  // Fallback jalur absolut (audit 2026-09-17: PM2 env PATH kadang tidak
  // memuat npm-global sehingga `where claude.cmd` kosong dan proses mati
  // exit 1 — claude.exe ini terverifikasi ada di mesin ini).
  const KNOWN = 'D:/Development/npm-global/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
  if (!cmdPath) {
    if (fs.existsSync(KNOWN)) return (CLAUDE_EXE = KNOWN);
    throw new Error('claude.cmd tidak ditemukan di PATH');
  }
  const exe = path.join(path.dirname(cmdPath), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (!fs.existsSync(exe)) {
    if (fs.existsSync(KNOWN)) return (CLAUDE_EXE = KNOWN);
    throw new Error(`claude.exe tidak ada: ${exe}`);
  }
  return (CLAUDE_EXE = exe);
}
export async function graphifyQuery(question, budget, cwd = ROOT) {
  const r = await run(GRAPHIFY, ['query', question, '--budget', String(budget)], { cwd, timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.trim() : null;
}
export function graphifyUpdate(cwd = ROOT) {
  run(GRAPHIFY, ['update', cwd], { cwd, timeoutMs: 5 * 60000 }).catch(() => {});
}

// ---- Machine health (disk / RAM) -------------------------------------------
export async function machineHealth() {
  const os = await import('node:os');
  const freeRamMb = Math.round(os.freemem() / 1048576);
  let freeDiskGb = null;
  try {
    const r = await run('powershell.exe', ['-NoProfile', '-Command', "(Get-PSDrive D).Free"], { timeoutMs: 15000 });
    const n = Number(String(r.stdout).trim()); if (Number.isFinite(n)) freeDiskGb = Math.round(n / 1073741824 * 10) / 10;
  } catch {}
  return { freeRamMb, freeDiskGb };
}
