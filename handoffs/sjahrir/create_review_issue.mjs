import { discoverPaperclipPort, httpPost, httpPatch } from './ops-watcher/paperclip-write-client.mjs';
const COMPANY_ID = 'a7011f31-8891-4581-b8fb-bbda8ac6a890';
const GIBRAN_ID = 'ce433688-4e0d-4902-addd-b7d27eb081b7';
const REVIEW_LABEL_ID = '1a835c0f-3eb6-4d95-ad27-4d9259c0b545';
const port = await discoverPaperclipPort();
if (!port) throw new Error('no port');
const base = 'http://127.0.0.1:'+port;
const title = 'GIBRAN REVIEW: Paperclip roster canonicalization (SJAHRIR)';
const description = [
  'Review request for the live Paperclip roster canonicalization performed by SJAHRIR.',
  '',
  'Scope: reconcile kolega corp agent records against handoffs/sjahrir/CANONICAL-ROLE-MAP.json and config/agent-registry.json.',
  '',
  'What changed (17 records total):',
  '- GIBRAN: title updated to "Independent reviewer (external runner: Hermes/Nous Free)"; capabilities note that real verdicts come via ops-watcher/review-runner.mjs -> hermes, and claude_local is only for Paperclip attribution.',
  '- Ahmad (Paperclip built-in CEO persona): title/capabilities clarified that this record is NOT the canonical AHMAD orchestrator (Claude Code CLI). Heartbeat remains disabled.',
  '- Rama (built-in demo engineer): title/capabilities clarified as Paperclip demo persona, not a canonical FounderOS role. Heartbeat remains disabled.',
  '- Reflection Coach, Summarizer: capabilities tagged as Paperclip built-ins.',
  '- 11 canonical thin specialists (TEST-RUNNER, MIGRATION-SURVEYOR, GRAPHIFY-ANALYST, GBRAIN-CURATOR, RETRIEVAL-ASSISTANT, OPS-WATCHER, PAPERCLIP-OPERATOR, STEWARD-SJS, STEWARD-CAVEMAN, TRADING-QUANT, AUDIT-CLERK, ESCALATION-SEC): capabilities updated to state they are canonical FounderOS roles but DORMANT, and that adapterType "hermes_generic" is inert (no engine implementation). External runner paths documented in metadata.adapterConfig.',
  '- No new agent records created for HATTA, SJAHRIR, CORLEONE, or HERMES because Paperclip has no honest adapter type for external runners; creating one would require inventing a fake adapterType.',
  '- No built-in or legacy records deleted.',
  '',
  'Validation performed: live GET /api/companies/{id}/agents confirms 17 records, all statuses/roles/adapterTypes as intended, zero fake executable adapters enabled.',
  '',
  'Please review and return a VERDICT: PASS / PASS WITH NOTES / REJECT.',
].join('\n');
const create = await httpPost(`${base}/api/companies/${COMPANY_ID}/issues`, {
  title,
  description,
  status: 'in_review',
  priority: 'medium',
  workMode: 'standard',
  assigneeAgentId: GIBRAN_ID,
});
if (create.networkError || !create.body || !create.body.id) {
  console.error('create failed', create);
  process.exit(1);
}
const issueId = create.body.id;
const patch = await httpPatch(`${base}/api/issues/${issueId}`, {
  labelIds: [REVIEW_LABEL_ID],
});
console.log('created', create.body.identifier, issueId, 'patch status', patch.status);
