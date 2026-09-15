// JARVIS chat (PRD "Personal Assistant" s1) — one shared, stateless-by-default
// backend for both Telegram free text and the dashboard chat box. Never a
// growing transcript: each call is a fresh one-shot grounded in status.mjs's
// snapshot plus (at most) one budgeted graphify/gbrain lookup, the same
// discipline the rest of conductor/ already uses for lane packets.
//   node conductor/chat.mjs --stdin   reads {text, channel} JSON from stdin,
//                                      prints the reply JSON to stdout.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { ROOT, STATE, company, paperclipCfg, loadEnvLocal, readJson, writeJson, ledgerAppend, laneBudget, graphifyQuery, run, pc, wibParts } from './lib.mjs';
import { askGlm, askClaude } from './claude.mjs';
import { snapshot } from './status.mjs';
import { checkOwnerText } from '../ops/voice/owner-lexicon-gate.mjs';
import { ask } from './owner.mjs';

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

// PRD "Personal Assistant" extension: a whole document (e.g. a ChatGPT-
// drafted vision/backlog dump, sent as a .md/.txt file — Telegram's 4096-
// char text limit doesn't apply to file uploads) is captured whole, not
// answered like a chat question. Saved to gbrain verbatim as a durable
// reference; a synthesis pass drafts candidate tickets, gated behind a
// normal SETUJU/TOLAK Ask before anything is actually created — same
// no-silent-action discipline as conductor/interview.mjs's PRD gate.
const DOC_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Ringkasan 3-5 kalimat, Indonesia formal' },
    candidateTickets: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' }, projectKey: { type: 'string', description: 'sjs-superapps | caveman-trading-os | internal' } }, required: ['title', 'why'] },
      minItems: 1, maxItems: 10,
    },
  },
  required: ['summary', 'candidateTickets'],
};

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

export async function ingestDocument({ text, fileName, channel }) {
  const co = company();
  const date = wibParts().date;
  const slug = `vision-${date}-${slugify((fileName || 'doc').replace(/\.[a-z0-9]+$/i, ''))}`;
  const gbrainRes = await run('gbrain', ['put', slug, '--content', text], { timeoutMs: 30000 });
  const remembered = gbrainRes.code === 0;

  const prompt = `Dokumen visi/backlog berikut dikirim Bapak (pemilik) untuk arah ${co.company.name}. Baca lalu (1) ringkas 3-5 kalimat Indonesia formal, (2) daftar 3-10 tiket kerja konkret paling penting berdasarkan ISI DOKUMEN INI SAJA -- jangan mengarang scope di luar dokumen.\n\nDOKUMEN:\n${text.slice(0, 12000)}\n\nJawab HANYA dengan JSON sesuai skema ini:\n${JSON.stringify(DOC_SCHEMA)}`;
  const res = await askClaude({ system: 'Anda menyusun ringkasan dan backlog kerja dari dokumen visi pemilik, Indonesia formal, konkret.', prompt, model: co.conductor.decisionModel, schema: DOC_SCHEMA, tag: 'chat.ingest-document' });
  ledgerAppend({ kind: 'owner.document', channel, fileName, chars: text.length, remembered, ok: res.ok });

  if (!res.ok || !res.structured?.summary || !res.structured?.candidateTickets?.length) {
    return { ok: true, reply: `Dokumen sudah saya simpan sebagai referensi jangka panjang${remembered ? '' : ' (penyimpanan sempat gagal, saya coba lagi nanti)'}. Ringkasan otomatis gagal disusun kali ini -- saya coba lagi di kesempatan berikutnya.` };
  }

  const tickets = res.structured.candidateTickets;
  const pendingFile = path.join(STATE, 'pending-document-tickets', `${slug}.json`);
  fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
  writeJson(pendingFile, { slug, tickets, createdAt: new Date().toISOString() });

  const askId = `document-tickets-${slug}`;
  await ask({
    id: askId,
    title: `Tiket dari dokumen: ${fileName}`,
    lines: [res.structured.summary, '', `Usulan ${tickets.length} tiket kerja:`, ...tickets.map((t, i) => `${i + 1}. ${t.title}`)],
    defaultIfSilent: 'saya tahan dulu, tidak membuat tiket apa pun sampai Bapak konfirmasi.',
  });

  return { ok: true, reply: `Dokumen sudah saya simpan sebagai referensi jangka panjang. Ringkasan: ${res.structured.summary}\n\nSaya usulkan ${tickets.length} tiket kerja -- sudah saya kirim lewat pesan terpisah untuk persetujuan Bapak.` };
}

/** Called from telegram.mjs's Ask-callback handler when a
 * document-tickets-<slug> ask is answered "approve" -- creates the real
 * Paperclip issues from the pending candidate list saved at ingest time. */
export async function onDocumentTicketsApproved(slug) {
  const pendingFile = path.join(STATE, 'pending-document-tickets', `${slug}.json`);
  const pending = readJson(pendingFile, null);
  if (!pending) return;
  const cfg = paperclipCfg();
  const created = [];
  for (const t of pending.tickets) {
    const projectId = cfg.projects?.[t.projectKey] || cfg.projects?.internal;
    try {
      const issue = await pc('POST', `/api/companies/${cfg.companyId}/issues`, { title: t.title, description: t.why, projectId, priority: 'medium', status: 'todo' });
      created.push(issue.identifier);
    } catch (e) { ledgerAppend({ kind: 'owner.document.ticket-error', slug, title: t.title, error: e.message.slice(0, 160) }); }
  }
  ledgerAppend({ kind: 'owner.document.tickets-created', slug, created });
  try { fs.unlinkSync(pendingFile); } catch {}
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
