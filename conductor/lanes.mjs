// Model lanes (PRD v5.1 s2c, s3, s4): pick the first ready lane in a role
// chain, run a task packet on it inside a workspace, mark a lane resting on
// 503/timeout/limit, fall through to the next lane. No per-token meter.
//
// Runtimes:
//   claude-cli  claude -p --restricted + guard hook, cwd = workspace
//   codex-cli   codex exec --approve-for-me, cwd = workspace
//   hermes-cli  hermes -z <packet> --in <workspace> --yolo (Ollama Cloud
//               primary, config.yaml fallback chain glm-5.1 -> flash -> Nous;
//               no home-grown tool loop — hermes brings its own tools)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, NODE22, lanesCfg, readJson, writeJson, run, ledgerAppend, laneBudget, wibParts, withRtkPath } from './lib.mjs';

const STATUS_FILE = path.join(STATE, 'lanes-status.json');
const GUARD_SETTINGS = path.join(ROOT, 'conductor', 'guard.settings.json');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// PRD v5.1 s2c: "resting sampai jam di pesan" — parse "resets at HH:MM" /
// "try again at HH:MM" from a lane error and rest until that WIB clock time
// (today, or tomorrow if it already passed) instead of the flat restMinutes.
export function parseResetTime(msg) {
  const m = String(msg || '').match(/(?:resets?|try again)\s*(?:at)?\s*(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  const p = wibParts();
  const hh = Number(m[1]), mm = Number(m[2]);
  const target = new Date(`${p.date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

const POOL_INFLIGHT = new Map(); // pool -> count, in-process semaphore
async function withPoolSlot(pool, limit, fn) {
  const cur = POOL_INFLIGHT.get(pool) || 0;
  if (cur >= limit) return { ok: false, error: `semaphore: ${pool} at ${limit} concurrent already` };
  POOL_INFLIGHT.set(pool, cur + 1);
  try { return await fn(); } finally { POOL_INFLIGHT.set(pool, (POOL_INFLIGHT.get(pool) || 1) - 1); }
}

export function lanesStatus() {
  return readJson(STATUS_FILE, { updatedAt: null, lanes: {} });
}

export function laneState(id) {
  const cfg = lanesCfg().lanes[id];
  if (!cfg) return 'unknown';
  if (cfg.status === 'disabled') return 'disabled';
  const s = lanesStatus().lanes[id];
  if (s?.state === 'resting' && s.until && Date.parse(s.until) > Date.now()) return 'resting';
  const limit = cfg.dailyTasks ?? cfg.dailyCalls;
  if (limit != null && laneBudget(id, limit).remaining <= 0) return 'resting';
  return 'ready';
}

export function markLane(id, state, extra = {}) {
  const st = lanesStatus();
  const restMin = lanesCfg().probe?.restMinutes ?? 60;
  st.lanes[id] = { state, at: new Date().toISOString(), ...(state === 'resting' ? { until: new Date(Date.now() + restMin * 60000).toISOString() } : {}), ...extra };
  st.updatedAt = new Date().toISOString();
  writeJson(STATUS_FILE, st);
  ledgerAppend({ kind: 'lane.state', lane: id, state, reason: extra.reason || null });
}

export function chainFor(role) {
  const cfg = lanesCfg();
  return (cfg.roles[role] || []).filter((id) => cfg.lanes[id]);
}

const LIMIT_RE = /(429|503|502|rate ?limit|usage limit|quota|overloaded|ETIMEDOUT|timed? ?out|ECONNRESET|Not logged in|unauthorized|403)/i;
// PRD v5.1 s2c: Ollama pool retries transient overload/connection errors
// 3x (5s/15s/45s) on the same lane before falling through to the next one.
const RETRY_RE = /(429|503|ECONNRESET)/i;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Run a packet on the first ready lane of the chain. Returns {ok, lane, summary, raw, tried}. */
export async function runOnChain(role, packet, opts = {}) {
  const tried = [];
  for (const id of chainFor(role)) {
    const state = laneState(id);
    if (state !== 'ready') { tried.push({ lane: id, skipped: state }); continue; }
    const r = await runOnLane(id, packet, opts);
    tried.push({ lane: id, ok: r.ok, error: r.error || null, ms: r.ms });
    if (r.ok) {
      const limit = lanesCfg().lanes[id].dailyTasks ?? lanesCfg().lanes[id].dailyCalls;
      if (limit != null) laneBudget(id, limit).spend(1);
      return { ...r, lane: id, tried };
    }
    if (LIMIT_RE.test(String(r.error || ''))) {
      const resetAt = parseResetTime(r.error);
      markLane(id, 'resting', { reason: String(r.error).slice(0, 160), ...(resetAt ? { until: resetAt } : {}) });
    }
  }
  return { ok: false, lane: null, error: 'no lane succeeded', tried };
}

export async function runOnLane(id, packet, { workspace, maxTurns, timeoutMs = 25 * 60000 } = {}) {
  const lane = lanesCfg().lanes[id];
  const started = Date.now();
  let r;
  try {
    if (lane.runtime === 'claude-cli') r = await runClaude(lane, packet, { workspace, maxTurns, timeoutMs });
    else if (lane.runtime === 'codex-cli') r = await runCodex(lane, packet, { workspace, timeoutMs });
    else if (lane.runtime === 'hermes-cli') {
      const limit = lanesCfg().semaphore?.[lane.pool] ?? 2;
      const delays = [5000, 15000, 45000];
      for (let attempt = 0; ; attempt++) {
        r = await withPoolSlot(lane.pool, limit, () => runHermes(lane, packet, { workspace, timeoutMs }));
        if (r.ok || attempt >= delays.length || !RETRY_RE.test(String(r.error || ''))) break;
        await sleep(delays[attempt]);
      }
    }
    else r = { ok: false, error: `runtime ${lane.runtime} not implemented` };
  } catch (e) { r = { ok: false, error: e.message }; }
  r.ms = Date.now() - started;
  ledgerAppend({ kind: 'lane.run', lane: id, ok: r.ok, ms: r.ms, error: r.error ? String(r.error).slice(0, 200) : null, tag: packet.tag || null });
  return r;
}

function packetText(packet) {
  return [packet.system ? `# Role\n${packet.system}` : '', `# Task\n${packet.task}`, packet.context ? `# Context\n${packet.context}` : '', packet.contract ? `# Output contract\n${packet.contract}` : ''].filter(Boolean).join('\n\n');
}

async function runClaude(lane, packet, { workspace, maxTurns, timeoutMs }) {
  const tools = packet.readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Write,Edit,Bash';
  const args = ['-p', '--model', lane.model, '--output-format', 'json', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--setting-sources', 'user',
    '--tools', tools, '--allowedTools', tools, '--permission-mode', 'dontAsk', '--settings', GUARD_SETTINGS, '--max-turns', String(maxTurns || lane.maxTurns || 40)];
  if (packet.addDirs?.length) args.push('--add-dir', ...packet.addDirs);
  const r = await run(process.platform === 'win32' ? 'claude.cmd' : 'claude', args, { cwd: workspace || ROOT, timeoutMs, input: packetText(packet), env: withRtkPath() });
  let out = null; try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.is_error) return { ok: false, error: (out?.result || r.stderr || r.stdout || `exit ${r.code}`).toString().slice(0, 400), raw: r.stdout.slice(-2000) };
  return { ok: true, summary: String(out.result || '').trim(), turns: out.num_turns, raw: null };
}

async function runCodex(lane, packet, { workspace, timeoutMs }) {
  const outFile = path.join(STATE, 'conductor', `codex-${Date.now()}.txt`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const args = ['exec', '--approve-for-me', '--skip-git-repo-check', '--ephemeral', '--cd', workspace || ROOT, '-o', outFile];
  if (lane.model && lane.model !== 'default') args.push('-m', lane.model);
  args.push('-');
  const r = await run(process.platform === 'win32' ? 'codex.cmd' : 'codex', args, { cwd: workspace || ROOT, timeoutMs, input: packetText(packet), env: withRtkPath() });
  let last = '';
  try { last = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch {}
  if (r.code !== 0 || !last) return { ok: false, error: ((r.stdout + '\n' + r.stderr).trim().split('\n').slice(-12).join('\n') || `exit ${r.code}`).slice(0, 400) };
  return { ok: true, summary: last };
}

// ---- Hermes CLI (PRD v5.1 s4/s6.3) ---------------------------------------
// Max steps (40) and the Ollama-primary/Nous-fallback chain live in the
// shared ~/.hermes config.yaml, not per-call flags (hermes has none for
// one-shot mode). We invoke hermes-agent's bin/hermes.js directly with
// NODE22 instead of hermes.cmd: an 8kB packet as a single argv entry can
// exceed cmd.exe's 8191-char line limit, and spawning the .js entry with
// shell:false goes straight through CreateProcess (no cmd.exe involved).
let HERMES_ENTRY = null;
async function hermesEntry() {
  if (HERMES_ENTRY) return HERMES_ENTRY;
  if (process.env.HERMES_ENTRY_JS && fs.existsSync(process.env.HERMES_ENTRY_JS)) return (HERMES_ENTRY = process.env.HERMES_ENTRY_JS);
  const r = await run('where', ['hermes.cmd'], { timeoutMs: 10000 });
  const cmdPath = r.stdout.trim().split(/\r?\n/)[0];
  if (!cmdPath) throw new Error('hermes.cmd tidak ditemukan di PATH');
  const entry = path.join(path.dirname(cmdPath), 'node_modules', 'hermes-agent', 'bin', 'hermes.js');
  if (!fs.existsSync(entry)) throw new Error(`hermes entry tidak ada: ${entry}`);
  return (HERMES_ENTRY = entry);
}

async function runHermes(lane, packet, { workspace, timeoutMs = 25 * 60000 }) {
  const entry = await hermesEntry();
  const ws = workspace || ROOT;
  const usageFile = path.join(STATE, 'conductor', `hermes-usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  const args = [entry, '-z', packetText(packet), '--usage-file', usageFile, '--in', ws, '--yolo', '--no-restore-cwd'];
  if (lane.model) args.push('-m', lane.model);
  const r = await run(NODE22, args, { cwd: ws, timeoutMs, env: { ...withRtkPath(), HERMES_ACCEPT_HOOKS: '1' } });
  let usage = null; try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch {}
  try { fs.unlinkSync(usageFile); } catch {}
  const text = (r.stdout || '').trim();
  if (r.code !== 0 || !text || usage?.failed) return { ok: false, error: (r.stderr || text || `exit ${r.code}`).slice(0, 400), usage };
  return { ok: true, summary: text, usage };
}

// ---- Probe (every 15 minutes): cheap health per pool ---------------------
export async function probeLanes() {
  const cfg = lanesCfg();
  const st = lanesStatus();
  const results = {};
  // Ollama: one tiny generate per distinct model in use (cloud lanes 503 loudly).
  for (const [id, lane] of Object.entries(cfg.lanes)) {
    if (lane.status === 'disabled') { results[id] = 'disabled'; continue; }
    if (laneState(id) === 'resting') { results[id] = 'resting'; continue; }
    if (lane.runtime === 'hermes-cli') {
      try {
        const res = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: lane.model, prompt: 'ping', stream: false, options: { num_predict: 4 } }), signal: AbortSignal.timeout(60000) });
        if (res.ok) { st.lanes[id] = { state: 'ready', at: new Date().toISOString() }; results[id] = 'ready'; }
        else { markLane(id, 'resting', { reason: `probe ${res.status}` }); results[id] = 'resting'; }
      } catch (e) { markLane(id, 'resting', { reason: `probe ${e.message}`.slice(0, 120) }); results[id] = 'resting'; }
    } else {
      // CLI lanes are not probed with a paid call; they stay as last observed.
      results[id] = laneState(id);
    }
  }
  const fresh = lanesStatus();
  fresh.updatedAt = new Date().toISOString();
  for (const [id, r] of Object.entries(results)) if (!fresh.lanes[id]) fresh.lanes[id] = { state: r, at: fresh.updatedAt };
  writeJson(STATUS_FILE, fresh);
  ledgerAppend({ kind: 'lane.probe', results });
  return results;
}
