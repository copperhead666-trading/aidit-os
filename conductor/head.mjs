// Department head (PRD v5 s3.1, s4, s5). Woken by Paperclip (process adapter,
// env PAPERCLIP_AGENT_ID / PAPERCLIP_API_URL / PAPERCLIP_API_KEY / RUN_ID) or
// by hand: node conductor/head.mjs --department engineering [--issue <id>].
// Picks its highest-priority open issue, builds a task packet, runs it on the
// department's lane chain inside an isolated workspace (git worktree of this
// repo, or a clone of the venture repo), commits the result on a branch,
// comments on the issue and moves it to in_review (never done: QA does that).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, NODE22, company, paperclipCfg, loadEnvLocal, readJson, writeJson, ledgerAppend, isPaused, run, wibStamp } from './lib.mjs';
import { runOnChain } from './lanes.mjs';

loadEnvLocal();
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DEPT = flag('--department');
const ISSUE = flag('--issue');
const DRY = argv.includes('--dry');
const cfg = paperclipCfg();
const co = company();
const BASE = process.env.PAPERCLIP_API_URL && !/localhost:3100/.test(process.env.PAPERCLIP_API_URL) ? process.env.PAPERCLIP_API_URL : cfg.baseUrl;
const AGENT_ID = process.env.PAPERCLIP_AGENT_ID || cfg.heads?.[DEPT];
const CLOSED = new Set(['done', 'canceled', 'cancelled', 'archived', 'in_review']);
const WS_ROOT = path.join(STATE, 'workspaces');

async function api(method, p, body) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.PAPERCLIP_API_KEY) headers.authorization = `Bearer ${process.env.PAPERCLIP_API_KEY}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const PRIO = { critical: 0, high: 1, medium: 2, low: 3 };

async function pickIssue() {
  if (ISSUE) return api('GET', `/api/issues/${ISSUE}`);
  const all = await api('GET', `/api/companies/${cfg.companyId}/issues`);
  const mine = all.filter((i) => i.assigneeAgentId === AGENT_ID && !CLOSED.has(i.status) && !/^EPIC /.test(i.title));
  mine.sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return mine[0] || null;
}

function ventureFor(issue) {
  const key = Object.entries(cfg.projects || {}).find(([, id]) => id === issue.projectId)?.[0];
  return { key: key || 'internal', venture: co.ventures.find((v) => v.id === key) || null };
}

async function ensureWorkspace(issue, { key, venture }) {
  fs.mkdirSync(WS_ROOT, { recursive: true });
  const branch = `aid/${String(issue.identifier || issue.id).toLowerCase()}`;
  if (venture) {
    const dir = path.join(WS_ROOT, venture.id);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      const src = fs.existsSync(path.join(venture.localPath, '.git')) ? venture.localPath : venture.repo;
      const r = await run('git', ['clone', '--quiet', src, dir], { timeoutMs: 10 * 60000 });
      if (r.code !== 0) throw new Error(`clone failed: ${r.stderr.slice(0, 200)}`);
      await run('git', ['remote', 'set-url', 'origin', venture.repo], { cwd: dir });
    }
    await run('git', ['fetch', '--quiet', 'origin'], { cwd: dir, timeoutMs: 5 * 60000 });
    const base = venture.staging?.branch || 'main';
    await run('git', ['checkout', '--quiet', '-B', branch, `origin/${base}`], { cwd: dir });
    if (fs.existsSync(path.join(dir, 'package.json')) && !fs.existsSync(path.join(dir, 'node_modules'))) {
      await run('cmd.exe', ['/c', 'npm', 'ci', '--no-audit', '--no-fund'], { cwd: dir, timeoutMs: 15 * 60000, env: { ...process.env, PATH: `${path.dirname(NODE22)};${process.env.PATH}` } });
    }
    return { dir, branch, base };
  }
  // internal: git worktree of this repo
  const dir = path.join(WS_ROOT, 'internal', String(issue.identifier || issue.id).toLowerCase());
  if (!fs.existsSync(dir)) {
    const r = await run('git', ['worktree', 'add', '--quiet', '-B', branch, dir, 'HEAD'], { cwd: ROOT });
    if (r.code !== 0) throw new Error(`worktree failed: ${r.stderr.slice(0, 200)}`);
  }
  return { dir, branch, base: 'v5' };
}

function packetFor(issue, dept, comments, ws, vent) {
  const instructions = comments.filter((c) => /^\[Conductor\]/.test(c.body || '')).map((c) => c.body).slice(-3).join('\n');
  const readOnly = ['product', 'research', 'finance'].includes(dept.id) && !/\b(write|tulis|buat file|create)\b/i.test(issue.description || '');
  return {
    tag: `${dept.id}:${issue.identifier}`,
    readOnly,
    system: `You are the head of ${dept.name} at ${co.company.name}. Mission: ${dept.mission}. You work alone in the workspace at ${ws.dir} (branch ${ws.branch}). Rules: R1 every exit criterion must be executable (a test or script), R2 run the typecheck/tests before claiming done (use node node_modules/<pkg>/bin/... not npm), R3 name the model/endpoint you used, R4 owner-facing strings are formal Indonesian for "Bapak", R5 cover the adversarial case. Never touch credentials, .env files, or anything outside the workspace. Do not push. Do not mark the issue done.`,
    task: `Issue ${issue.identifier}: ${issue.title}\n\n${issue.description || ''}${instructions ? `\n\nConductor instructions:\n${instructions}` : ''}`,
    context: `Venture: ${vent.venture ? `${vent.venture.name} (${vent.venture.repo}, stack ${vent.venture.stack}, goal ${vent.venture.goal})` : 'Aidit OS v5 internal repository'}\nBase branch: ${ws.base}\nTime: ${wibStamp()}`,
    contract: readOnly
      ? 'Reply with a concise written result (markdown). If a document must be produced, put its full text in the reply; the head will file it. End with one line: "LANE: <model you are>".'
      : 'Make the change in the workspace with tests; run them; then reply with: what changed (files), how it was verified (commands + result), what remains, and one line "LANE: <model you are>". Do not commit; the head commits.',
    addDirs: [],
  };
}

async function commitWorkspace(ws, issue, dept) {
  const env = { ...process.env, GIT_AUTHOR_NAME: `HEAD_${dept.id.toUpperCase()}`, GIT_AUTHOR_EMAIL: `${dept.id}@aidit-os.local`, GIT_COMMITTER_NAME: `HEAD_${dept.id.toUpperCase()}`, GIT_COMMITTER_EMAIL: `${dept.id}@aidit-os.local` };
  const st = await run('git', ['status', '--porcelain'], { cwd: ws.dir });
  const changed = st.stdout.trim().split('\n').filter(Boolean);
  if (!changed.length) return { committed: false, files: [] };
  // never stage secrets
  const bad = changed.filter((l) => /\.env|credential|secret|password/i.test(l));
  if (bad.length) return { committed: false, files: changed, refused: bad };
  await run('git', ['add', '-A'], { cwd: ws.dir, env });
  const r = await run('git', ['commit', '-q', '-m', `${issue.identifier}: ${issue.title}`.slice(0, 120)], { cwd: ws.dir, env });
  const sha = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ws.dir })).stdout.trim();
  return { committed: r.code === 0, sha, files: changed };
}

async function main() {
  const dept = co.departments.find((d) => d.id === DEPT);
  if (!dept) { console.error('unknown --department'); process.exit(2); }
  if (isPaused()) { console.log('paused'); return; }
  const issue = await pickIssue();
  if (!issue) { console.log(JSON.stringify({ dept: DEPT, idle: true })); return; }
  const vent = ventureFor(issue);
  ledgerAppend({ kind: 'head.start', dept: DEPT, issue: issue.identifier, venture: vent.key, runId: process.env.PAPERCLIP_RUN_ID || null });
  if (!DRY) await api('PATCH', `/api/issues/${issue.id}`, { status: 'in_progress' });
  const comments = await api('GET', `/api/issues/${issue.id}/comments`).catch(() => []);
  let ws;
  try { ws = await ensureWorkspace(issue, vent); } catch (e) {
    ledgerAppend({ kind: 'head.error', dept: DEPT, issue: issue.identifier, error: e.message });
    if (!DRY) { await api('POST', `/api/issues/${issue.id}/comments`, { body: `[Kepala ${dept.name}] Workspace gagal: ${e.message.slice(0, 300)}` }); await api('PATCH', `/api/issues/${issue.id}`, { status: 'todo' }); }
    console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1);
  }
  const packet = packetFor(issue, dept, Array.isArray(comments) ? comments : [], ws, vent);
  const role = ['product', 'engineering'].includes(dept.id) ? 'head-claude' : 'head-other';
  if (DRY) { console.log(JSON.stringify({ issue: issue.identifier, role, ws, packet }, null, 1)); return; }
  const r = await runOnChain(role, packet, { workspace: ws.dir });
  let commit = { committed: false, files: [] };
  if (r.ok && !packet.readOnly) commit = await commitWorkspace(ws, issue, dept);
  if (r.ok && packet.readOnly && r.summary) {
    // file the written result next to the issue for the record
    const outDir = path.join(STATE, 'results'); fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${issue.identifier}.md`), r.summary);
  }
  const body = r.ok
    ? `[Kepala ${dept.name}] Selesai di lane ${r.lane}${commit.committed ? `, commit ${commit.sha} di ${ws.branch} (${commit.files.length} file)` : commit.refused ? ', commit DITOLAK: menyentuh berkas rahasia' : ''}.\n\n${String(r.summary).slice(0, 6000)}`
    : `[Kepala ${dept.name}] Gagal di semua lane: ${JSON.stringify(r.tried).slice(0, 800)}`;
  await api('POST', `/api/issues/${issue.id}/comments`, { body });
  await api('PATCH', `/api/issues/${issue.id}`, { status: r.ok ? 'in_review' : 'todo' });
  ledgerAppend({ kind: 'head.done', dept: DEPT, issue: issue.identifier, ok: r.ok, lane: r.lane, sha: commit.sha || null, tried: r.tried });
  console.log(JSON.stringify({ ok: r.ok, issue: issue.identifier, lane: r.lane, sha: commit.sha || null }));
  if (!r.ok) process.exit(1);
}

main().catch((e) => { ledgerAppend({ kind: 'head.error', dept: DEPT, error: e.message }); console.error(e); process.exit(1); });
