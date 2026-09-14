// Conductor (JARVIS) — PRD v5 s3.1. Every 30 minutes: read Paperclip, ledger,
// lanes and machine health; ask Claude (sonnet; opus only when it flags a real
// decision and budget remains) for a JSON decision list; apply it: assign
// issues to department heads, queue work for the runner, comment, ask/alert
// the owner. Writes the ledger and commits its decision log as CONDUCTOR.
//   node conductor/run.mjs --once      one tick
//   node conductor/run.mjs             loop (PM2 process "conductor")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, STATE, company, paperclipCfg, loadEnvLocal, readJson, writeJson,
  ledgerAppend, ledgerTail, isPaused, opusBudget, pc, paperclipHealth, machineHealth, run, wibStamp, wibParts,
} from './lib.mjs';
import { askClaude } from './claude.mjs';
import { ask, alert, listAsks } from './owner.mjs';

loadEnvLocal();
const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');
const QUEUE = path.join(STATE, 'queue');
const DECISIONS_DIR = path.join(ROOT, 'docs', 'conductor');
const CLOSED = new Set(['done', 'canceled', 'cancelled', 'archived']);

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One line, Indonesian, what the company is doing now' },
    needsOpus: { type: 'boolean', description: 'true only for a genuine hard decision: spec conflict, priority tradeoff, stuck integration' },
    needsOpusReason: { type: 'string' },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['assign', 'comment', 'create_issue', 'ask', 'alert', 'note'] },
          issueId: { type: 'string' },
          department: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          projectKey: { type: 'string', description: 'sjs-superapps | caveman-trading-os | internal' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          askId: { type: 'string' },
          defaultIfSilent: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['type'],
      },
    },
  },
  required: ['summary', 'needsOpus', 'decisions'],
};

function systemPrompt(co) {
  return [
    `You are ${co.conductor.name}, the Conductor of ${co.company.name}: an AI company on one Windows laptop that builds the owner's ventures.`,
    'You never write code yourself. You decide: which open issue goes to which department head, what to tell them, what to ask the owner.',
    'Departments: ' + co.departments.map((d) => `${d.id} (${d.name}: ${d.mission})`).join('; ') + '.',
    'Ventures: ' + co.ventures.map((v) => `${v.id} (${v.name}: ${v.goal})`).join('; ') + '.',
    'Rules: production, money, outside people and purchases require an ask to the owner; everything in the autonomy envelope proceeds without asking.',
    'Owner-facing text (ask/alert body, titles shown to the owner) must be formal Indonesian addressing the owner as "Bapak", no technical jargon, no ticket numbers, short sentences.',
    'Issue comments and instructions to department heads may be technical and in English or Indonesian.',
    'Only assign an issue that is currently unassigned, has no department, or is stuck; do not reassign work that is queued or in progress. At most 6 decisions per tick. Prefer "note" when nothing needs to change.',
    'Never create duplicate issues: check the open list first. Never mark anything done: heads do that when acceptance passes.',
    'You have NO tools and cannot run commands or read files: everything you need is in the JSON state given to you. Answer ONLY with the structured JSON output (summary, needsOpus, decisions). Do not write prose, plans or shell commands.',
  ].join('\n');
}

async function gather(co) {
  const cfg = paperclipCfg();
  const health = await paperclipHealth();
  let issues = [];
  let agents = [];
  if (health.ok) {
    issues = await pc('GET', `/api/companies/${cfg.companyId}/issues`);
    agents = await pc('GET', `/api/companies/${cfg.companyId}/agents`);
  }
  const headById = Object.fromEntries(Object.entries(cfg.heads || {}).map(([dept, id]) => [id, dept]));
  const open = issues.filter((i) => !CLOSED.has(i.status)).map((i) => ({
    id: i.id, key: i.identifier, title: i.title, status: i.status, priority: i.priority,
    department: headById[i.assigneeAgentId] || null, project: i.projectId, updatedAt: i.updatedAt,
  }));
  const queue = fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(QUEUE, f))).filter(Boolean) : [];
  const b = opusBudget(co.conductor.opusTurnsPerDay);
  return {
    now: wibStamp(),
    paperclip: health,
    machine: await machineHealth(),
    lanes: readJson(path.join(STATE, 'lanes-status.json'), { note: 'no probe yet' }),
    opus: { used: b.used, remaining: b.remaining },
    openAsks: listAsks().map((a) => ({ id: a.id, title: a.title, askedAt: a.wib })),
    issues: open,
    agents: agents.map((a) => ({ name: a.name, status: a.status, dept: headById[a.id] || (a.id === cfg.conductorId ? 'conductor' : null) })),
    queue: queue.map((q) => ({ issueId: q.issueId, department: q.department, status: q.status, attempts: q.attempts })),
    ledger: ledgerTail(25).map((e) => ({ wib: e.wib, kind: e.kind, ...(e.summary ? { summary: e.summary } : {}), ...(e.error ? { error: String(e.error).slice(0, 120) } : {}) })),
  };
}

function enqueue(issueId, department, instructions) {
  fs.mkdirSync(QUEUE, { recursive: true });
  const qf = path.join(QUEUE, `${issueId}.json`);
  const prev = readJson(qf, null);
  writeJson(qf, { issueId, department, instructions: instructions || '', status: 'queued', attempts: prev?.attempts || 0, queuedAt: new Date().toISOString() });
}

async function applyDecision(d, cfg, log) {
  const heads = cfg.heads || {};
  switch (d.type) {
    case 'assign': {
      const headId = heads[d.department];
      if (!d.issueId || !headId) { log.push(`skip assign: unknown issue/department ${d.issueId}/${d.department}`); return; }
      if (!DRY) {
        await pc('PATCH', `/api/issues/${d.issueId}`, { assigneeAgentId: headId, status: 'todo' });
        if (d.body) await pc('POST', `/api/issues/${d.issueId}/comments`, { body: `[Conductor] ${d.body}` });
        enqueue(d.issueId, d.department, d.body);
      }
      log.push(`assign ${d.issueId} -> ${d.department}`);
      return;
    }
    case 'comment': {
      if (!d.issueId || !d.body) { log.push('skip comment: missing issue/body'); return; }
      if (!DRY) await pc('POST', `/api/issues/${d.issueId}/comments`, { body: `[Conductor] ${d.body}` });
      log.push(`comment ${d.issueId}`);
      return;
    }
    case 'create_issue': {
      if (!d.title) { log.push('skip create_issue: no title'); return; }
      const projectId = cfg.projects?.[d.projectKey] || cfg.projects?.internal;
      const dept = heads[d.department] ? d.department : 'product';
      if (DRY) { log.push(`create_issue (dry) ${d.title}`); return; }
      const i = await pc('POST', `/api/companies/${cfg.companyId}/issues`, { title: d.title, description: d.body || '', projectId, assigneeAgentId: heads[dept], priority: d.priority || 'medium', status: 'todo' });
      enqueue(i.id, dept, d.body);
      log.push(`create_issue ${i.identifier} -> ${dept}`);
      return;
    }
    case 'ask': {
      const id = d.askId || `ask-${Date.now()}`;
      if (DRY) { log.push(`ask (dry) ${id}`); return; }
      const r = await ask({ id, title: d.title || 'Keputusan', lines: (d.body || '').split('\n'), defaultIfSilent: d.defaultIfSilent || 'saya lanjutkan dengan pilihan paling aman.', options: d.options || [] });
      log.push(`ask ${id} sent=${!!r.sent}${r.duplicate ? ' (duplicate)' : ''}${r.hint ? ' lexicon:' + r.hint : ''}`);
      return;
    }
    case 'alert': {
      if (DRY) { log.push('alert (dry)'); return; }
      const r = await alert({ what: d.body || d.title || '', needsOwner: false });
      log.push(`alert sent=${!!r.sent}`);
      return;
    }
    default:
      log.push(`note: ${(d.body || d.title || '').slice(0, 140)}`);
  }
}

async function commitDecisions(co, text) {
  fs.mkdirSync(DECISIONS_DIR, { recursive: true });
  const file = path.join(DECISIONS_DIR, `${wibParts().date}.md`);
  fs.appendFileSync(file, text + '\n');
  const a = co.conductor.gitAuthor;
  const env = { ...process.env, GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_COMMITTER_NAME: a.name, GIT_COMMITTER_EMAIL: a.email };
  await run('git', ['add', path.relative(ROOT, file)], { env });
  const r = await run('git', ['commit', '-q', '-m', `conductor: decisions ${wibStamp()}`], { env });
  return r.code === 0;
}

export async function tick() {
  const co = company();
  const cfg = paperclipCfg();
  if (isPaused()) { ledgerAppend({ kind: 'conductor.tick', paused: true }); return { paused: true }; }
  const ctx = await gather(co);
  if (!ctx.paperclip.ok) {
    ledgerAppend({ kind: 'conductor.tick', ok: false, error: 'paperclip down' });
    return { ok: false, error: 'paperclip down' };
  }
  const prompt = `Waktu: ${ctx.now}\n\nKeadaan perusahaan (JSON):\n${JSON.stringify(ctx, null, 1)}\n\nPutuskan langkah 30 menit ke depan. Jawab HANYA dengan JSON persis mengikuti skema ini (tanpa prosa):
${JSON.stringify(SCHEMA)}`;
  let res = await askClaude({ system: systemPrompt(co), prompt, model: co.conductor.routineModel, schema: SCHEMA, tag: 'conductor.routine' });
  let modelUsed = co.conductor.routineModel;
  if (res.ok && res.structured?.needsOpus) {
    const b = opusBudget(co.conductor.opusTurnsPerDay);
    if (b.remaining > 0) {
      const opusRes = await askClaude({ system: systemPrompt(co), prompt: `${prompt}\n\nSonnet flagged a hard decision: ${res.structured.needsOpusReason || ''}. Decide it.`, model: co.conductor.decisionModel, schema: SCHEMA, tag: 'conductor.decision' });
      b.spend(1);
      if (opusRes.ok) { res = opusRes; modelUsed = co.conductor.decisionModel; }
    }
  }
  if (!res.ok || !res.structured) {
    ledgerAppend({ kind: 'conductor.tick', ok: false, error: res.error });
    return { ok: false, error: res.error };
  }
  const out = res.structured;
  const log = [];
  for (const d of (out.decisions || []).slice(0, 6)) {
    try { await applyDecision(d, cfg, log); } catch (e) { log.push(`error ${d.type}: ${e.message.slice(0, 160)}`); }
  }
  ledgerAppend({ kind: 'conductor.tick', ok: true, model: modelUsed, summary: out.summary, decisions: log });
  if (!DRY) await commitDecisions(co, `## ${wibStamp()} (${modelUsed})\n${out.summary}\n${log.map((l) => `- ${l}`).join('\n')}\n`);
  return { ok: true, summary: out.summary, log };
}

async function main() {
  const co = company();
  console.log(JSON.stringify(await tick()));
  if (ONCE) return;
  setInterval(async () => {
    try { console.log(JSON.stringify(await tick())); } catch (e) { ledgerAppend({ kind: 'conductor.tick', ok: false, error: e.message }); console.error(e); }
  }, co.conductor.intervalMinutes * 60000);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().catch((e) => { console.error(e); process.exit(1); });
