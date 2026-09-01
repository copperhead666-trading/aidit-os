import { discoverPaperclipPort, httpPatch, httpGet } from './ops-watcher/paperclip-write-client.mjs';

const COMPANY_ID = 'a7011f31-8891-4581-b8fb-bbda8ac6a890';
const CLASSIFICATION = {
  // built-ins
  'fcae00e6-1476-4bde-9495-e1e154992052': { cls: 'BUILT-IN', title: null, capabilities: 'Paperclip built-in Reflection Coach. Not part of the canonical FounderOS roster.', path: 'Paperclip built-in reflection routine' },
  '49e32f0f-19f4-4288-abc2-56645b1dc196': { cls: 'BUILT-IN', title: null, capabilities: 'Paperclip built-in Summarizer. Not part of the canonical FounderOS roster.', path: 'Paperclip built-in summarization routine' },
  'cdea95bd-b9db-4035-854b-8ea677c1326e': { cls: 'BUILT-IN', title: 'Paperclip built-in CEO persona (NOT canonical AHMAD)', capabilities: 'This Paperclip agent record is the platform\'s built-in CEO persona. It is NOT the canonical AHMAD orchestrator, which runs as Claude Code CLI (this interactive session). Heartbeat is disabled to avoid Anthropic quota collision.', path: 'Paperclip built-in CEO heartbeat (disabled)' },
  '4145df2c-8d46-40ba-a032-335cc0e96826': { cls: 'BUILT-IN', title: 'Built-in demo engineer (not canonical FounderOS role)', capabilities: 'Paperclip default founding-engineer demo persona. Not part of the canonical FounderOS roster. Heartbeat is disabled.', path: 'Paperclip built-in demo routine (disabled)' },
  // canonical reviewer
  'ce433688-4e0d-4902-addd-b7d27eb081b7': { cls: 'CANONICAL', title: 'Independent reviewer (external runner: Hermes/Nous Free)', capabilities: 'Canonical GIBRAN reviewer. Real verdicts are produced externally via Hermes/Nous Free (upstage/solar-pro4:free) dispatched by ops-watcher/review-runner.mjs. The native claude_local adapter on this record is used only for Paperclip comment attribution.', path: 'ops-watcher/review-runner.mjs -> hermes -z ... --provider nous -m upstage/solar-pro4:free' },
  // dormant canonical specialists
  '86097684-137c-4d79-b853-94f903567486': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS TEST-RUNNER role; currently DORMANT. adapterType hermes_generic is inert (no engine implementation). Real runner: ops-watcher/test-runner.mjs.', path: 'ops-watcher/test-runner.mjs' },
  'f3c0dd5b-f686-4c52-9577-e3487527775f': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS MIGRATION-SURVEYOR role; currently DORMANT. adapterType hermes_generic is inert. Real runner: Ahmad task packet / Kimi K3 fallback.', path: 'Ahmad task packet -> Kimi K3 (when activated)' },
  '75943266-0995-4fe9-a535-be2b136fe518': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS GRAPHIFY-ANALYST role; currently DORMANT. adapterType hermes_generic is inert.', path: 'Ahmad task packet (when activated)' },
  'cc93c8fe-af78-4a53-abde-db8ac0127d56': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS GBRAIN-CURATOR role; currently DORMANT. adapterType hermes_generic is inert.', path: 'Ahmad task packet / cron (when activated)' },
  'cf6ffcf1-3abf-40c4-841a-debe7cf963ef': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS RETRIEVAL-ASSISTANT role; currently DORMANT. adapterType hermes_generic is inert.', path: 'Ahmad dispatch prep (when activated)' },
  '79060e98-c048-44fb-8c29-2dd3cf5868a6': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS OPS-WATCHER role; the live runner is ops-watcher/watcher.mjs (deterministic node, no LLM). This Paperclip record is inert/DORMANT because adapterType hermes_generic has no engine implementation.', path: 'ops-watcher/watcher.mjs (node, no LLM)' },
  '0119711f-c023-4b85-bfc1-c468824788ce': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS PAPERCLIP-OPERATOR role; currently DORMANT. adapterType hermes_generic is inert. Activation is human+gated.', path: 'human+gated admin action' },
  'a55dbfd8-b828-4c86-9e97-3c9b478c3a9e': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS STEWARD-SJS role; currently DORMANT. adapterType hermes_generic is inert.', path: 'Ahmad task packet (when activated)' },
  '516fd58f-24e6-4d8f-8234-34df848e2352': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS STEWARD-CAVEMAN role; currently DORMANT. adapterType hermes_generic is inert. Live/micro-live trading stays disabled; risk changes owner-gated.', path: 'Ahmad task packet (when activated)' },
  '339f7f03-25db-4c9b-b729-a3195e326314': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS TRADING-QUANT role; currently DORMANT. adapterType hermes_generic is inert. Owner-gated; SOEKARNO scarce fallback only until 2026-09-14.', path: 'owner-gated; SOEKARNO scarce fallback until lapse' },
  'c6246f04-050f-4457-9cfb-d966d8fac268': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS AUDIT-CLERK role; currently DORMANT. adapterType hermes_generic is inert.', path: 'weekly cron / ledger write (when activated)' },
  'f33c6b86-39e8-4ce2-8e84-cb56204b7b37': { cls: 'DORMANT', title: null, capabilities: 'Canonical FounderOS ESCALATION-SEC role; currently DORMANT. adapterType hermes_generic is inert.', path: 'owner-blocker state write (when activated)' },
};

const port = await discoverPaperclipPort();
if (!port) { console.error('Paperclip not reachable'); process.exit(1); }
const base = 'http://127.0.0.1:' + port;

const results = [];
for (const [id, cfg] of Object.entries(CLASSIFICATION)) {
  const getRes = await httpGet(`${base}/api/agents/${id}`);
  if (getRes.networkError || !getRes.body) {
    results.push({ id, error: 'fetch failed' });
    continue;
  }
  const agent = getRes.body;
  const payload = {};
  if (cfg.title !== null && cfg.title !== agent.title) payload.title = cfg.title;
  if (cfg.capabilities !== null && cfg.capabilities !== agent.capabilities) payload.capabilities = cfg.capabilities;
  const meta = { ...(agent.metadata || {}) };
  meta.canonical_classification = cfg.cls;
  if (cfg.path) meta.external_runner_path = cfg.path;
  if (agent.metadata && agent.metadata.paperclipBuiltInAgent) {
    meta.paperclipBuiltInAgent = agent.metadata.paperclipBuiltInAgent;
  }
  if (agent.metadata && agent.metadata.dormant_default !== undefined) {
    meta.dormant_default = agent.metadata.dormant_default;
    meta.created_by_migration = agent.metadata.created_by_migration;
    meta.dept = agent.metadata.dept;
  }
  payload.metadata = meta;
  const adapterCfg = { ...(agent.adapterConfig || {}) };
  adapterCfg.canonical_classification = cfg.cls;
  if (cfg.path) adapterCfg.external_runner_path = cfg.path;
  payload.adapterConfig = adapterCfg;
  payload.replaceAdapterConfig = false;

  if (cfg.cls === 'DORMANT' && agent.status !== 'paused') {
    payload.status = 'paused';
  }

  const patchRes = await httpPatch(`${base}/api/agents/${id}`, payload);
  results.push({ id: agent.name || id, status: patchRes.status, networkError: patchRes.networkError, changed: Object.keys(payload).filter(k => k !== 'replaceAdapterConfig') });
}
console.log(JSON.stringify(results, null, 2));
