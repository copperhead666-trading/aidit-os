// Model lanes (PRD v5 s3.3, s9): pick the first ready lane in a role chain,
// run a task packet on it inside a workspace, mark a lane resting on
// 503/timeout/limit, fall through to the next lane. No per-token meter.
//
// Runtimes:
//   claude-cli  claude -p --restricted + guard hook, cwd = workspace
//   codex-cli   codex exec --approve-for-me, cwd = workspace
//   ollama      small tool loop over /api/chat (read/write/list/run node)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, NODE22, lanesCfg, readJson, writeJson, run, ledgerAppend } from './lib.mjs';

const STATUS_FILE = path.join(STATE, 'lanes-status.json');
const GUARD_SETTINGS = path.join(ROOT, 'conductor', 'guard.settings.json');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export function lanesStatus() {
  return readJson(STATUS_FILE, { updatedAt: null, lanes: {} });
}

export function laneState(id) {
  const cfg = lanesCfg().lanes[id];
  if (!cfg) return 'unknown';
  if (cfg.status === 'disabled') return 'disabled';
  const s = lanesStatus().lanes[id];
  if (s?.state === 'resting' && s.until && Date.parse(s.until) > Date.now()) return 'resting';
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

/** Run a packet on the first ready lane of the chain. Returns {ok, lane, summary, raw, tried}. */
export async function runOnChain(role, packet, opts = {}) {
  const tried = [];
  for (const id of chainFor(role)) {
    const state = laneState(id);
    if (state !== 'ready') { tried.push({ lane: id, skipped: state }); continue; }
    const r = await runOnLane(id, packet, opts);
    tried.push({ lane: id, ok: r.ok, error: r.error || null, ms: r.ms });
    if (r.ok) return { ...r, lane: id, tried };
    if (LIMIT_RE.test(String(r.error || ''))) markLane(id, 'resting', { reason: String(r.error).slice(0, 160) });
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
    else if (lane.runtime === 'ollama') r = await runOllama(lane, packet, { workspace, maxSteps: maxTurns || lane.maxSteps, timeoutMs });
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
  const r = await run(process.platform === 'win32' ? 'claude.cmd' : 'claude', args, { cwd: workspace || ROOT, timeoutMs, input: packetText(packet) });
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
  const r = await run(process.platform === 'win32' ? 'codex.cmd' : 'codex', args, { cwd: workspace || ROOT, timeoutMs, input: packetText(packet) });
  let last = '';
  try { last = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch {}
  if (r.code !== 0 || !last) return { ok: false, error: ((r.stdout + '\n' + r.stderr).trim().split('\n').slice(-12).join('\n') || `exit ${r.code}`).slice(0, 400) };
  return { ok: true, summary: last };
}

// ---- Ollama tool loop ---------------------------------------------------
const OLLAMA_TOOLS = [
  { type: 'function', function: { name: 'list_dir', description: 'List files in a workspace directory', parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a workspace file (utf8, max 60kB)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write a workspace file (creates directories)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'run_node', description: 'Run one node script inside the workspace: args like ["scripts/x.mjs","--flag"] or ["node_modules/typescript/bin/tsc","--noEmit"]', parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'] } } },
  { type: 'function', function: { name: 'done', description: 'Finish the task with a summary of what was changed and verified', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
];

function insideWs(ws, p) {
  const target = path.resolve(ws, String(p || ''));
  const rel = path.relative(ws, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path escapes workspace: ${p}`);
  return target;
}

async function ollamaTool(ws, name, a, readOnly) {
  switch (name) {
    case 'list_dir': { const d = insideWs(ws, a.dir || '.'); return fs.readdirSync(d, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name)).slice(0, 300).join('\n'); }
    case 'read_file': { const f = insideWs(ws, a.path); return fs.readFileSync(f, 'utf8').slice(0, 60000); }
    case 'write_file': { if (readOnly) throw new Error('read-only task'); const f = insideWs(ws, a.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(a.content ?? '')); return `wrote ${a.path} (${String(a.content ?? '').length} chars)`; }
    case 'run_node': {
      const args = (a.args || []).map(String);
      if (!args.length) throw new Error('args required');
      insideWs(ws, args[0]);
      for (const t of args.slice(1)) if (/[\\/]/.test(t) && !t.startsWith('-')) insideWs(ws, t);
      const r = await run(NODE22, args, { cwd: ws, timeoutMs: 10 * 60000 });
      return `exit ${r.code}\n${(r.stdout + r.stderr).slice(-6000)}`;
    }
    default: throw new Error(`unknown tool ${name}`);
  }
}

async function runOllama(lane, packet, { workspace, maxSteps = 80, timeoutMs }) {
  const ws = workspace || ROOT;
  const deadline = Date.now() + timeoutMs;
  const messages = [
    { role: 'system', content: `${packet.system || 'You are a careful software worker.'}\nYou work inside one workspace with the given tools only. Paths are relative to the workspace. Finish by calling done(summary). Max ${maxSteps} steps.` },
    { role: 'user', content: packetText(packet) },
  ];
  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() > deadline) return { ok: false, error: 'timed out' };
    const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: lane.model, messages, tools: OLLAMA_TOOLS, stream: false, options: { num_ctx: 32768 } }), signal: AbortSignal.timeout(Math.min(timeoutMs, 5 * 60000)) });
    if (!res.ok) return { ok: false, error: `ollama ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    const msg = data.message || {};
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      // No tool call: treat the text as the final answer.
      return { ok: true, summary: String(msg.content || '').trim() || '(no summary)', steps: step + 1 };
    }
    for (const c of calls) {
      const name = c.function?.name; const a = c.function?.arguments || {};
      if (name === 'done') return { ok: true, summary: String(a.summary || ''), steps: step + 1 };
      let content;
      try { content = await ollamaTool(ws, name, a, packet.readOnly); } catch (e) { content = `error: ${e.message}`; }
      messages.push({ role: 'tool', content: String(content).slice(0, 60000) });
    }
  }
  return { ok: false, error: `step ceiling ${maxSteps} reached` };
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
    if (lane.runtime === 'ollama') {
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
