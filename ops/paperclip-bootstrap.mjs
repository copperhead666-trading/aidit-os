// Bootstraps the Paperclip v5 board from config/company.json: one company,
// one project per venture, the Conductor plus eight department heads as
// agents, and one epic issue per venture. Idempotent: matches by name and
// records ids in config/paperclip.json (no secrets in there).
// Usage: node ops/paperclip-bootstrap.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PAPERCLIP_URL || 'http://127.0.0.1:3120';
const company = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'company.json'), 'utf8'));
const outFile = path.join(ROOT, 'config', 'paperclip.json');
const state = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { baseUrl: BASE };

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const ROLE = { product: 'pm', engineering: 'engineer', design: 'designer', qa: 'qa', ops: 'devops', finance: 'cfo', marketing: 'cmo', research: 'researcher' };

async function ensureCompany() {
  const all = await api('GET', '/api/companies');
  let c = all.find((x) => x.name === company.company.name);
  if (!c) c = await api('POST', '/api/companies', { name: company.company.name, description: 'Enam stack Bennett di atas sepuluh layer. Dua venture, delapan departemen, satu suara JARVIS.' });
  state.companyId = c.id;
  return c;
}

async function ensureAgent(companyId, spec, existing) {
  let a = existing.find((x) => x.name === spec.name);
  if (!a) a = await api('POST', `/api/companies/${companyId}/agents`, spec);
  else a = await api('PATCH', `/api/agents/${a.id}`, { adapterType: spec.adapterType, adapterConfig: spec.adapterConfig, capabilities: spec.capabilities, metadata: spec.metadata });
  return a;
}

async function ensureProject(companyId, spec, existing) {
  let p = existing.find((x) => x.name === spec.name);
  if (!p) p = await api('POST', `/api/companies/${companyId}/projects`, spec);
  return p;
}

async function ensureIssue(companyId, spec, existing) {
  let i = existing.find((x) => x.title === spec.title);
  if (!i) i = await api('POST', `/api/companies/${companyId}/issues`, spec);
  return i;
}

const c = await ensureCompany();
const agents = await api('GET', `/api/companies/${c.id}/agents`);
const conductor = await ensureAgent(c.id, {
  name: company.conductor.name,
  role: 'ceo',
  title: 'Conductor',
  capabilities: `Headless Claude (sonnet rutin, opus keputusan <= ${company.conductor.opusTurnsPerDay}/hari), bangun tiap ${company.conductor.intervalMinutes} menit; satu suara ke owner.`,
  adapterType: 'process',
  adapterConfig: { command: 'D:/aidit-node/node-v22.14.0-win-x64/node.exe', args: ['conductor/run.mjs', '--once'], cwd: ROOT },
  metadata: { lane: 'claude', department: 'conductor' },
}, agents);
state.conductorId = conductor.id;
state.heads = state.heads || {};
for (const d of company.departments) {
  const head = await ensureAgent(c.id, {
    name: `Kepala ${d.name}`,
    role: ROLE[d.id] || 'general',
    title: d.name,
    reportsTo: conductor.id,
    capabilities: `${d.mission}. Rantai lane: ${d.head.laneChain.join(' -> ')}. Pekerja: ${d.workers.join(', ')}.`,
    adapterType: 'process',
    adapterConfig: { command: 'D:/aidit-node/node-v22.14.0-win-x64/node.exe', args: ['conductor/head.mjs', '--department', d.id], cwd: ROOT },
    metadata: { department: d.id, laneChain: d.head.laneChain, workers: d.workers },
  }, agents);
  state.heads[d.id] = head.id;
}

const projects = await api('GET', `/api/companies/${c.id}/projects`);
state.projects = state.projects || {};
for (const v of company.ventures) {
  const p = await ensureProject(c.id, {
    name: v.name,
    description: `${v.goal}. Repo: ${v.repo}. Stack: ${v.stack}.`,
    status: v.status === 'active' ? 'in_progress' : 'planned',
    leadAgentId: state.heads.product,
    targetDate: v.milestones[v.milestones.length - 1]?.date,
  }, projects);
  state.projects[v.id] = p.id;
}
const internal = await ensureProject(c.id, {
  name: 'Aidit OS v5 (internal)',
  description: 'Fondasi enam stack: conductor, back office, lanes, worker pool, hands, metal.',
  status: 'in_progress',
  leadAgentId: state.heads.engineering,
}, projects);
state.projects.internal = internal.id;

const issues = await api('GET', `/api/companies/${c.id}/issues`);
state.epics = state.epics || {};
for (const v of company.ventures) {
  const e = await ensureIssue(c.id, {
    title: `EPIC ${v.name}: ${v.goal}`,
    description: ['Milestone:', ...v.milestones.map((m) => `- ${m.date}: ${m.what}`), '', `Repo: ${v.repo}`].join('\n'),
    projectId: state.projects[v.id],
    assigneeAgentId: state.heads.product,
    priority: 'high',
    status: 'todo',
  }, issues);
  state.epics[v.id] = e.id;
}

state.baseUrl = BASE;
state.updatedAt = new Date().toISOString();
fs.writeFileSync(outFile, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ company: c.id, conductor: state.conductorId, heads: Object.keys(state.heads).length, projects: Object.keys(state.projects).length, epics: Object.keys(state.epics).length }));
