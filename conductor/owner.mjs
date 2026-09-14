// Owner door helpers (PRD v5 s6): Report, Ask, Alert to Telegram through the
// lexicon gate; asks are recorded in state/asks.jsonl so the listener can map
// button presses back and the Conductor knows what is waiting on the owner.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ledgerAppend, readJson, wibParts } from './lib.mjs';
import { sendMessage, editMessageText } from './telegram-client.mjs';

const ASKS = path.join(STATE, 'asks.jsonl');
const SILENCE = 'Jika Bapak tidak menjawab dalam 24 jam, ';

export function listAsks({ openOnly = true } = {}) {
  if (!fs.existsSync(ASKS)) return [];
  const rows = fs.readFileSync(ASKS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map();
  for (const r of rows) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  const all = [...byId.values()];
  return openOnly ? all.filter((a) => !a.answer) : all;
}

function appendAsk(row) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(ASKS, JSON.stringify(row) + '\n');
}

/** Ask: title + body lines + default if silent. Buttons SETUJU/TOLAK/NANTI/JELASKAN. */
export async function ask({ id, title, lines = [], defaultIfSilent, options = [], allowTechnical = false }) {
  const existing = listAsks({ openOnly: false }).find((a) => a.id === id);
  if (existing) return { sent: false, duplicate: true, ask: existing };
  const text = [
    `*${title}*`,
    ...lines,
    ...(options.length ? options.map((o, i) => `${'ABC'[i]}. ${o}`) : []),
    '',
    `${SILENCE}${defaultIfSilent}`,
  ].join('\n');
  const buttons = [[
    { text: 'SETUJU', callback_data: `ask:${id}:approve` },
    { text: 'TOLAK', callback_data: `ask:${id}:reject` },
  ], [
    { text: 'NANTI', callback_data: `ask:${id}:later` },
    { text: 'JELASKAN', callback_data: `ask:${id}:explain` },
  ]];
  if (options.length) buttons.push(options.map((_, i) => ({ text: 'ABC'[i], callback_data: `ask:${id}:opt${'ABC'[i]}` })));
  const r = await sendMessage(text, { buttons, allowTechnical });
  const row = { id, title, lines, options, defaultIfSilent, askedAt: new Date().toISOString(), wib: wibParts().date + ' ' + wibParts().time, messageId: r?.result?.message_id ?? null, sent: !!r.sent, sendError: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || null) };
  appendAsk(row);
  ledgerAppend({ kind: 'owner.ask', id, title, sent: !!r.sent, error: row.sendError });
  return { ...r, ask: row };
}

export function answerAsk(id, answer, by = 'owner') {
  appendAsk({ id, answer, answeredAt: new Date().toISOString(), by });
  ledgerAppend({ kind: 'owner.answer', id, answer, by });
}

export async function report(lines, { allowTechnical = false } = {}) {
  const text = lines.filter(Boolean).join('\n');
  const r = await sendMessage(text, { allowTechnical });
  ledgerAppend({ kind: 'owner.report', sent: !!r.sent, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || null), lines: lines.length });
  return r;
}

export async function alert({ what, done, needsOwner = false }) {
  const text = [`*Perhatian, Bapak.*`, what, done ? `Yang sudah dilakukan: ${done}` : null, needsOwner ? 'Perlu keputusan Bapak.' : 'Tidak perlu tindakan Bapak.'].filter(Boolean).join('\n');
  const r = await sendMessage(text);
  ledgerAppend({ kind: 'owner.alert', sent: !!r.sent, what, error: r.sent ? null : (r.reason || r.hint || null) });
  return r;
}

export { editMessageText, readJson };
