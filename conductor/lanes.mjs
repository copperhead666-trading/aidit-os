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
import { ROOT, STATE, NODE22, lanesCfg, readJson, writeJson, run, ledgerAppend, laneBudget, wibParts, withRtkPath, resolveClaudeBin } from './lib.mjs';
import { validatePromptMatrix } from './guard.mjs';

const STATUS_FILE = path.join(STATE, 'lanes-status.json');
const GUARD_SETTINGS = path.join(ROOT, 'conductor', 'guard.settings.json');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const LOCK_DIR = path.join(STATE, 'locks');
const LOCK_STALE_MS = 90 * 60000;
const LOCK_WAIT_MS = 10 * 60000;
const LOCK_POLL_MS = 15000;

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

function poolLockPath(lockDir, pool, slot) {
  const safePool = String(pool || 'default').replace(/[^a-z0-9_.-]/gi, '_');
  return path.join(lockDir, `pool-${safePool}-${slot}.lock`);
}

function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function staleLock(file, now = Date.now()) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return true; }
  const age = now - Date.parse(lock.at || 0);
  return age > LOCK_STALE_MS || !pidAlive(lock.pid);
}

export async function acquirePoolSlot(pool, limit = 1, { lockDir = LOCK_DIR, waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS } = {}) {
  fs.mkdirSync(lockDir, { recursive: true });
  const deadline = Date.now() + waitMs;
  const slots = Math.max(1, Number(limit) || 1);
  for (;;) {
    for (let slot = 0; slot < slots; slot++) {
      const file = poolLockPath(lockDir, pool, slot);
      try {
        const fd = fs.openSync(file, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), pool, slot }) + '\n');
        fs.closeSync(fd);
        return { ok: true, release: () => { try { fs.unlinkSync(file); } catch {} }, file };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (!staleLock(file)) continue;
        try { fs.unlinkSync(file); } catch {}
        slot--;
      }
    }
    if (Date.now() >= deadline) return { ok: false, error: `semaphore: ${pool} busy` };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

async function withPoolSlot(pool, limit, fn) {
  const slot = await acquirePoolSlot(pool, limit);
  if (!slot.ok) return slot;
  try { return await fn(); } finally { slot.release(); }
}

export function lanesStatus() {
  return readJson(STATUS_FILE, { updatedAt: null, lanes: {} });
}

// instruksi-06 s5: siklus hidup langganan lewat activeFrom/activeUntil (ISO
// 8601 dengan offset eksplisit, mis. "2026-09-19T23:00:00+07:00" -- WIB).
// Deterministik: hanya bandingkan angka waktu, tidak baca jam sistem/timezone
// lokal proses. Lane di luar rentang dianggap disabled (bukan resting) --
// tidak akan dicoba sama sekali, konsisten dengan cfg.status === 'disabled'.
export function isLaneActiveByDate(cfg, now = Date.now()) {
  const t = typeof now === 'number' ? now : now.getTime();
  if (cfg.activeFrom && t < Date.parse(cfg.activeFrom)) return false;
  if (cfg.activeUntil && t > Date.parse(cfg.activeUntil)) return false;
  return true;
}

export function laneState(id) {
  const cfg = lanesCfg().lanes[id];
  if (!cfg) return 'unknown';
  if (cfg.status === 'disabled') return 'disabled';
  if (!isLaneActiveByDate(cfg)) return 'disabled';
  const s = lanesStatus().lanes[id];
  if (s?.state === 'resting' && s.until && Date.parse(s.until) > Date.now()) return 'resting';
  // Keyed by pool, not lane id: gpt-6-astra and codex share one ChatGPT
  // Codex subscription (pool codex-chatgpt) — PRD's "30 tugas tersebar" is
  // one cap for that pool, not 30 per lane (would double it to 60/day).
  const limit = cfg.dailyTasks ?? cfg.dailyCalls;
  if (limit != null && laneBudget(cfg.pool || id, limit).remaining <= 0) return 'resting';
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

const LIMIT_RE = /(429|401|503|502|rate ?limit|usage limit|quota|overloaded|ETIMEDOUT|timed? ?out|ECONNRESET|Not logged in|unauthorized|403)/i;
// PRD v5.1 s2c: Ollama pool retries transient overload/connection errors
// 3x (5s/15s/45s) on the same lane before falling through to the next one.
const RETRY_RE = /(429|503|ECONNRESET)/i;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// instruksi-02 A.2: 3x gagal 429/401 berturut-turut (tanpa jeda sukses) ->
// lewati lane itu 60 menit. Bila provider sudah memberi jam reset eksplisit
// (parseResetTime), langsung resting -- tidak perlu menunggu 3x karena
// provider sudah bilang pasti gagal sampai jam itu.
export const CIRCUIT_BREAKER_THRESHOLD = 3;

export function recordLaneFailure(id, errorMsg) {
  const resetAt = parseResetTime(errorMsg);
  if (resetAt) {
    markLane(id, 'resting', { reason: String(errorMsg).slice(0, 160), until: resetAt, failCount: 0 });
    return { tripped: true, failCount: 0 };
  }
  const st = lanesStatus();
  const prev = st.lanes[id] || {};
  const failCount = (prev.failCount || 0) + 1;
  if (failCount >= CIRCUIT_BREAKER_THRESHOLD) {
    markLane(id, 'resting', { reason: String(errorMsg).slice(0, 160), failCount: 0 });
    return { tripped: true, failCount: 0 };
  }
  st.lanes[id] = { ...prev, at: new Date().toISOString(), failCount, reason: String(errorMsg).slice(0, 160) };
  st.updatedAt = new Date().toISOString();
  writeJson(STATUS_FILE, st);
  ledgerAppend({ kind: 'lane.state', lane: id, state: 'fail-cooldown-track', reason: `${failCount}/${CIRCUIT_BREAKER_THRESHOLD}` });
  return { tripped: false, failCount };
}

export function recordLaneSuccess(id) {
  const st = lanesStatus();
  const prev = st.lanes[id];
  if (prev && prev.failCount) {
    st.lanes[id] = { ...prev, failCount: 0 };
    st.updatedAt = new Date().toISOString();
    writeJson(STATUS_FILE, st);
  }
}

/** Run a packet on the first ready lane of the chain. Returns {ok, lane, summary, raw, tried}. */
export async function runOnChain(role, packet, opts = {}) {
  // Prompt Matrix (Tahap 3): tolak dispatch tanpa 8 unsur wajib
  // (docs/standards/PROMPT_MATRIX.md, validator di guard.mjs).
  const matrix = validatePromptMatrix(packetText(packet));
  if (!matrix.ok) {
    ledgerAppend({ kind: 'prompt-matrix.reject', role, tag: packet.tag || null, missing: matrix.missing });
    return { ok: false, lane: null, error: `prompt-matrix: unsur hilang (${matrix.missing.join(', ')})`, tried: [] };
  }
  const tried = [];
  for (const id of chainFor(role)) {
    const state = laneState(id);
    if (state !== 'ready') { tried.push({ lane: id, skipped: state }); continue; }
    const r = await runOnLane(id, packet, opts);
    tried.push({ lane: id, ok: r.ok, error: r.error || null, ms: r.ms });
    if (r.ok) {
      recordLaneSuccess(id);
      const cfg = lanesCfg().lanes[id];
      const limit = cfg.dailyTasks ?? cfg.dailyCalls;
      if (limit != null) laneBudget(cfg.pool || id, limit).spend(1);
      return { ...r, lane: id, tried };
    }
    if (LIMIT_RE.test(String(r.error || ''))) {
      recordLaneFailure(id, r.error);
    }
  }
  return { ok: false, lane: null, error: 'no lane succeeded', tried };
}

export function laneTimeoutMs(lane) {
  return (lane?.timeoutMinutes ?? 25) * 60000;
}

export async function runOnLane(id, packet, { workspace, maxTurns, timeoutMs } = {}) {
  // Gate dead-man switch (Tahap 2): bila Orkestrator mati, ops/deadman.mjs
  // menulis state/orkestrator-down.flag dan worker tidak boleh mengambil
  // tugas baru sampai Orkestrator hidup lagi.
  const GATE = path.join(STATE, 'orkestrator-down.flag');
  if (fs.existsSync(GATE)) return { ok: false, error: 'orkestrator down: worker gate closed (dead-man switch)', ms: 0 };
  const lane = lanesCfg().lanes[id];
  timeoutMs ??= laneTimeoutMs(lane);
  const started = Date.now();
  let r;
  try {
    if (lane.runtime === 'claude-cli') r = await runClaude(lane, packet, { workspace, maxTurns, timeoutMs });
    else if (lane.runtime === 'codex-cli') r = await runCodex(lane, packet, { workspace, timeoutMs });
    else if (lane.runtime === 'kimi-cli') r = await runKimi(lane, packet, { workspace, timeoutMs });
    else if (lane.runtime === 'hermes-cli') {
      const limit = lanesCfg().semaphore?.[lane.pool] ?? 1;
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
  const timedOut = !r.ok && r.ms >= timeoutMs && /(?:timed? ?out|exit null)/i.test(String(r.error || ''));
  ledgerAppend({ kind: 'lane.run', lane: id, ok: r.ok, ms: r.ms, error: r.error ? String(r.error).slice(0, 200) : null, timedOut, tag: packet.tag || null, tokens: r.usage?.tokens ?? null, costUsd: r.usage?.costUsd ?? null, ...(lane.runtime === 'claude-cli' ? { configDir: process.env.CLAUDE_CONFIG_DIR || '~/.claude' } : {}) });
  return r;
}

function packetText(packet) {
  return [packet.system ? `# Role\n${packet.system}` : '', `# Task\n${packet.task}`, packet.context ? `# Context\n${packet.context}` : '', packet.contract ? `# Output contract\n${packet.contract}` : ''].filter(Boolean).join('\n\n');
}

async function runClaude(lane, packet, { workspace, maxTurns, timeoutMs }) {
  const tools = packet.readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Write,Edit,Bash';
  // PRD v5.1 s6 step 6: --setting-sources "" so a headless call never inherits
  // the interactive orchestrator's ~/.claude/settings.json (plugins, hooks,
  // statusline) — only --settings GUARD_SETTINGS below applies.
  const args = ['-p', '--model', lane.model, '--output-format', 'json', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--setting-sources', '',
    '--tools', tools, '--allowedTools', tools, '--permission-mode', 'dontAsk', '--settings', GUARD_SETTINGS, '--max-turns', String(maxTurns || lane.maxTurns || 20)];
  if (packet.addDirs?.length) args.push('--add-dir', ...packet.addDirs);
  // CLAUDE_CONFIG_DIR (which account this call authenticates as) is inherited
  // from the process env, not set per-lane here: the "conductor" PM2 process
  // carries it in ecosystem.config.cjs, so a manual/orchestrator invocation
  // (this env var unset) correctly falls back to ~/.claude instead.
  // claude.exe directly, not claude.cmd: shell:true (needed for a .cmd on
  // Windows) silently drops the empty-string --setting-sources value above
  // and shifts every arg after it — found live wiring conductor/chat.mjs's
  // document ingestion. See resolveClaudeBin() in lib.mjs.
  const bin = await resolveClaudeBin();
  const r = await run(bin, args, { cwd: workspace || ROOT, timeoutMs, input: packetText(packet), env: withRtkPath() });
  let out = null; try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.is_error) return { ok: false, error: (out?.result || r.stderr || r.stdout || `exit ${r.code}`).toString().slice(0, 400), raw: r.stdout.slice(-2000) };
  return { ok: true, summary: String(out.result || '').trim(), turns: out.num_turns, raw: null, usage: out.usage ? { tokens: (out.usage.input_tokens || 0) + (out.usage.output_tokens || 0) + (out.usage.cache_read_input_tokens || 0) + (out.usage.cache_creation_input_tokens || 0), costUsd: out.total_cost_usd ?? null } : null };
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

// ---- Kimi Code CLI (PRD v5.1 s2b/s3/s6 step 6) ---------------------------
// UNVERIFIED end to end: the account has had a 403 (monthly quota) since
// 2026-09-14 with no known reset date (an owner Ask), so this has only been
// exercised against `kimi doctor`/`--help`, never a real -p call. The
// "dispatch" model (65536 ctx, no always_thinking) lives in the existing
// ~/.kimi-code/config.toml under the same already-authenticated
// managed:kimi-code provider, rather than a separate `dispatch/kimi-home`
// dir — a fresh home's oauth-token portability could not be verified while
// the account has no quota to test against, so reusing the working login
// in place was the lower-risk choice. No retry (PRD: "tanpa retry"); no
// wire.jsonl parsed for tokens yet — reparse once a real session file can be
// inspected after reset.
async function runKimi(lane, packet, { workspace, timeoutMs = 15 * 60000 }) {
  const args = ['-p', packetText(packet), '--yolo', '--add-dir', workspace || ROOT];
  if (lane.model) args.push('-m', lane.model);
  const r = await run(process.platform === 'win32' ? 'kimi.cmd' : 'kimi', args, { cwd: workspace || ROOT, timeoutMs, env: withRtkPath() });
  const text = (r.stdout || '').trim();
  if (r.code !== 0 || !text) return { ok: false, error: (r.stderr || text || `exit ${r.code}`).slice(0, 400) };
  return { ok: true, summary: text };
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
  const candidates = [];
  if (process.env.HERMES_BIN) candidates.push(process.env.HERMES_BIN);
  const r = await run('where', ['hermes.cmd'], { timeoutMs: 10000 });
  candidates.push(...r.stdout.trim().split(/\r?\n/).filter(Boolean));
  candidates.push('D:/Development/npm-global/hermes.cmd');

  const errors = [];
  for (const cmdPath of candidates) {
    if (!fs.existsSync(cmdPath)) { errors.push(`${cmdPath}: tidak ada`); continue; }
    const entry = path.join(path.dirname(cmdPath), 'node_modules', 'hermes-agent', 'bin', 'hermes.js');
    if (fs.existsSync(entry)) return (HERMES_ENTRY = entry);
    errors.push(`${entry}: tidak ada`);
  }
  throw new Error(`hermes entry tidak ditemukan setelah mencoba HERMES_BIN, PATH, dan fallback: ${errors.join('; ')}`);
}

async function runHermes(lane, packet, { workspace, timeoutMs }) {
  const entry = await hermesEntry();
  const ws = workspace || ROOT;
  const usageFile = path.join(STATE, 'conductor', `hermes-usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  const args = [entry, '-z', packetText(packet), '--usage-file', usageFile, '--in', ws, '--yolo', '--no-restore-cwd'];
  if (lane.model) args.push('-m', lane.model);
  if (lane.provider) args.push('--provider', lane.provider);
  const r = await run(NODE22, args, { cwd: ws, timeoutMs, env: { ...withRtkPath(), HERMES_ACCEPT_HOOKS: '1' } });
  let usage = null; try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch {}
  try { fs.unlinkSync(usageFile); } catch {}
  const text = (r.stdout || '').trim();
  const normUsage = usage ? { tokens: usage.total_tokens ?? null, costUsd: usage.estimated_cost_usd ?? null, model: usage.model } : null;
  if (r.code !== 0 || !text || usage?.failed) return { ok: false, error: (r.stderr || text || `exit ${r.code}`).slice(0, 400), usage: normUsage };
  return { ok: true, summary: text, usage: normUsage };
}

// ---- Probe (every 15 minutes): cheap health per pool ---------------------
export async function probeLanes() {
  const cfg = lanesCfg();
  const st = lanesStatus();
  const results = {};
  // Probe konektivitas OpenRouter sekali saja (GET /models, gratis) untuk
  // semua lane or-*: sebelumnya SEMUA lane hermes-cli diprobe ke Ollama
  // 127.0.0.1:11434 sehingga lane OpenRouter ikut jatuh (temuan audit
  // 2026-09-17 "lane or-* memanggil ollama.com").
  let openrouterOk = null;
  // Ollama: one tiny generate per distinct model in use (cloud lanes 503 loudly).
  for (const [id, lane] of Object.entries(cfg.lanes)) {
    if (lane.status === 'disabled') { results[id] = 'disabled'; continue; }
    if (laneState(id) === 'resting') { results[id] = 'resting'; continue; }
    if (lane.runtime === 'hermes-cli') {
      if (lane.provider === 'openrouter') {
        if (openrouterOk === null) {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30000) });
            openrouterOk = res.ok;
          } catch { openrouterOk = false; }
        }
        if (openrouterOk) { st.lanes[id] = { state: 'ready', at: new Date().toISOString() }; results[id] = 'ready'; }
        else { markLane(id, 'resting', { reason: 'probe openrouter.ai unreachable' }); results[id] = 'resting'; }
        continue;
      }
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
