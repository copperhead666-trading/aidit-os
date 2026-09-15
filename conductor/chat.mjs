// JARVIS chat (PRD "Personal Assistant" s1) — one shared, stateless-by-default
// backend for both Telegram free text and the dashboard chat box. Never a
// growing transcript: each call is a fresh one-shot grounded in status.mjs's
// snapshot plus (at most) one budgeted graphify/gbrain lookup, the same
// discipline the rest of conductor/ already uses for lane packets.
//   node conductor/chat.mjs --stdin   reads {text, channel} JSON from stdin,
//                                      prints the reply JSON to stdout.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, company, loadEnvLocal, ledgerAppend, laneBudget, graphifyQuery, run } from './lib.mjs';
import { askGlm, askClaude } from './claude.mjs';
import { snapshot } from './status.mjs';
import { checkOwnerText } from '../ops/voice/owner-lexicon-gate.mjs';

loadEnvLocal();

const FALLBACK_REPLY = 'Maaf, Bapak, saya belum bisa menjawab itu dengan tepat. Boleh diulang dengan kata lain?';

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Balasan untuk Bapak, Indonesia formal, singkat' },
    remember: { type: 'boolean', description: 'true hanya jika ada fakta/keputusan yang layak diingat jangka panjang' },
    memoryTitle: { type: 'string' },
    memoryBody: { type: 'string' },
    needsSonnet: { type: 'boolean', description: 'true hanya untuk pertanyaan yang butuh penalaran lebih dalam dari GLM' },
    needsSonnetReason: { type: 'string' },
  },
  required: ['reply', 'remember', 'needsSonnet'],
};

// Cheap keyword heuristic — no LLM call spent just to decide what to fetch.
export function classifyContext(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(kode|code|file|bug|error|gagal|kenapa.*(gagal|error)|implementasi|fungsi|function|script)\b/.test(t)) return 'code';
  if (/\b(kenapa.*putus|keputusan|sebelumnya|dulu|catatan|kebijakan|policy|history|riwayat)\b/.test(t)) return 'memory';
  return 'none';
}

function systemPersona(co) {
  return [
    `Anda adalah ${co.persona?.name || 'JARVIS'}, asisten pribadi digital sekaligus orkestrator ${co.company.name}.`,
    'Jawab Bapak langsung: Indonesia formal, kalimat pendek, tanpa jargon teknis, tanpa nomor tiket internal.',
    'Anda boleh menjelaskan keputusan atau Ask yang sudah ada, tapi TIDAK menggantikan tombol SETUJU/TOLAK/NANTI yang sudah berjalan — arahkan Bapak ke tombol itu untuk keputusan resmi.',
    'Jangan pernah menyebut nama lane/model teknis (mis. Claude, Sonnet, Codex, GLM, Hermes, Kimi) atau istilah arsitektur internal (lane, pool, ledger, packet) — sebut saja "tim" atau "pekerja" secara umum.',
    'Kalau tidak tahu, katakan tidak tahu — jangan mengarang.',
  ].join('\n');
}

// company().conductor.chatHistoryTurns defaults to 0 (pure stateless per
// message) — the owner explicitly hasn't decided whether a short rolling
// window is wanted yet. Turning it on later means adding a bounded read/
// append against a small `state/chat-history.jsonl` here; deliberately not
// built until asked for, so there's no unused history-window code sitting
// around forming a maintenance trap.

async function chatReply({ text, channel = 'cli' }) {
  const co = company();
  const s = await snapshot();
  const kind = classifyContext(text);
  let extra = null;
  if (kind === 'code') extra = await graphifyQuery(text, 600, ROOT);
  else if (kind === 'memory') {
    const r = await run('gbrain', ['query', text, '--no-expand'], { timeoutMs: 20000 });
    extra = r.code === 0 ? r.stdout.trim().slice(0, 1500) : null;
  }

  // Counts only, not raw lane ids — the model can't leak a technical name
  // it never saw, which is a more robust filter than relying on the
  // lexicon gate alone to catch it after generation.
  const laneStates = s.lanes.split(' ').map((l) => l.split('=')[1] || '');
  const ready = laneStates.filter((v) => v === 'ready').length;
  const resting = laneStates.filter((v) => v.startsWith('resting')).length;
  const context = [
    `Status sekarang: papan ${s.board}; ${ready} tim siap bekerja, ${resting} sedang istirahat; ask menunggu: ${s.asks}.`,
    extra ? `Konteks tambahan (${kind}):\n${extra}` : null,
  ].filter(Boolean).join('\n\n');

  const prompt = `${context}\n\nPesan Bapak: ${text}\n\nJawab HANYA dengan JSON sesuai skema ini:\n${JSON.stringify(SCHEMA)}`;
  let res = await askGlm({ system: systemPersona(co), prompt, model: co.conductor.routineModel, schema: SCHEMA, tag: 'conductor.chat' });
  let modelUsed = co.conductor.routineModel;
  let escalated = false;

  if (res.ok && res.structured?.needsSonnet) {
    const b = laneBudget('conductor-chat-sonnet', 5);
    if (b.remaining > 0) {
      const esc = await askClaude({ system: systemPersona(co), prompt: `${prompt}\n\nGLM menandai butuh penalaran lebih: ${res.structured.needsSonnetReason || ''}.`, model: co.conductor.decisionModel, schema: SCHEMA, tag: 'conductor.chat.sonnet' });
      b.spend(1);
      if (esc.ok) { res = esc; modelUsed = co.conductor.decisionModel; escalated = true; }
    }
  }

  if (!res.ok || !res.structured?.reply) {
    ledgerAppend({ kind: 'owner.chat', channel, ok: false, error: res.error || 'no reply' });
    return { ok: false, reply: FALLBACK_REPLY, modelUsed, escalated };
  }

  let reply = res.structured.reply;
  const gate = checkOwnerText(reply);
  if (!gate.ok) {
    ledgerAppend({ kind: 'lexicon.reject', channel, text: reply.slice(0, 200), hits: gate.hits.map((h) => h.token) });
    reply = FALLBACK_REPLY;
  }

  let remembered = false;
  if (res.structured.remember && res.structured.memoryBody && gate.ok) {
    const slug = `chat-${new Date().toISOString().slice(0, 10)}-${(res.structured.memoryTitle || 'catatan').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    const r = await run('gbrain', ['put', slug, '--content', res.structured.memoryBody], { timeoutMs: 20000 });
    remembered = r.code === 0;
  }

  ledgerAppend({ kind: 'owner.chat', channel, ok: true, modelUsed, escalated, remembered, contextKind: kind });
  return { ok: true, reply, modelUsed, escalated, remembered };
}

export { chatReply };

async function mainStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { console.log(JSON.stringify({ ok: false, reply: FALLBACK_REPLY, error: 'invalid stdin JSON' })); return; }
  const r = await chatReply({ text: input.text, channel: input.channel || 'cli' });
  console.log(JSON.stringify(r));
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry && process.argv.includes('--stdin')) mainStdin().catch((e) => { console.log(JSON.stringify({ ok: false, reply: FALLBACK_REPLY, error: e.message })); process.exit(1); });
