// Headless Claude call for the Conductor: --bare (no CLAUDE.md, hooks or
// plugins), no tools, one turn, structured JSON output. The model only
// decides; conductor/run.mjs applies the decisions deterministically.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, run, ledgerAppend } from './lib.mjs';

const HOME = path.join(STATE, 'conductor', 'home');

export async function askClaude({ system, prompt, model = 'sonnet', schema, maxTurns = 4, timeoutMs = 300000, tag = 'conductor' }) {
  fs.mkdirSync(HOME, { recursive: true });
  const args = ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence', '--tools', '', '--max-turns', String(maxTurns), '--permission-mode', 'dontAsk', '--strict-mcp-config', '--setting-sources', 'user'];
  if (system) args.push('--append-system-prompt', system);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const started = Date.now();
  const r = await run(process.platform === 'win32' ? 'claude.cmd' : 'claude', args, { cwd: HOME, timeoutMs, input: prompt });
  try { fs.writeFileSync(path.join(STATE, 'conductor', 'last-raw.json'), r.stdout || r.stderr || ''); } catch {}
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* fallthrough */ }
  // Fallback: the model sometimes writes the JSON as plain text instead of
  // calling the structured-output tool; accept it when it parses.
  if (out && schema && out.structured_output == null && typeof out.result === 'string') {
    const m = out.result.match(/\{[\s\S]*\}/);
    if (m) { try { out.structured_output = JSON.parse(m[0]); } catch { /* keep null */ } }
  }
  const ok = r.code === 0 && out && !out.is_error && (!schema || out.structured_output != null);
  const result = {
    ok,
    model,
    ms: Date.now() - started,
    structured: out?.structured_output ?? null,
    text: out?.result ?? null,
    turns: out?.num_turns ?? null,
    sessionId: out?.session_id ?? null,
    error: ok ? null : (out?.result || out?.subtype || r.stderr || r.stdout || `exit ${r.code}`).toString().slice(0, 500),
    subtype: out?.subtype ?? null,
  };
  ledgerAppend({ kind: 'claude.call', tag, model, ok, ms: result.ms, turns: result.turns, error: result.error, configDir: process.env.CLAUDE_CONFIG_DIR || '~/.claude' });
  return result;
}

// PRD v5.1 s5: the Conductor's routine tick runs on GLM-5.2 (Ollama), not
// Claude — Ollama's native /api/chat `format` accepts a JSON schema directly,
// so no CLI/hermes round trip is needed for this structured-decision call.
export async function askGlm({ system, prompt, model = 'glm-5.2:cloud', schema, tag = 'conductor.routine', timeoutMs = 120000 }) {
  const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const started = Date.now();
  let ok = false, structured = null, text = null, error = null;
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, format: schema, stream: false }), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    text = data.message?.content ?? null;
    // The `format` schema keeps the shape close but not the wrapper: GLM
    // sometimes fences its JSON in ```json ... ``` anyway (caught live by
    // this session's own --dry verification of the run.mjs tick pipeline).
    const fenced = String(text || '').trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    structured = schema ? JSON.parse(fenced ? fenced[1] : text) : null;
    ok = true;
  } catch (e) { error = e.message; }
  const result = { ok, model, ms: Date.now() - started, structured, text, error };
  ledgerAppend({ kind: 'glm.call', tag, model, ok, ms: result.ms, error });
  return result;
}
