// Owner door helpers (PRD v5 s6): Report, Ask, Alert to Telegram through the
// lexicon gate; asks are recorded in state/asks.jsonl so the listener can map
// button presses back and the Conductor knows what is waiting on the owner.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ledgerAppend, readJson, writeJson, wibParts, isProtectedHours } from './lib.mjs';
import { sendMessage, editMessageText } from './telegram-client.mjs';

const ASKS = path.join(STATE, 'asks.jsonl');
const SILENCE = 'Jika Bapak tidak menjawab dalam 24 jam, ';
const PENDING = path.join(STATE, 'pending-notifications.jsonl');

function queuePending(kind, payload) {
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(PENDING, JSON.stringify({ kind, payload, queuedAt: new Date().toISOString() }) + '\n');
}

/** Re-send anything queued while protected hours were active. Call from a
 * regular tick (conductor/ops.mjs) once out of protected hours -- asks are
 * simplest to replay via ask() itself (dedupes on `sent`, so a queued ask
 * with sent:false will actually go out); report/alert have no other
 * durable record, so they are replayed from PENDING and then dropped. */
export async function flushPendingNotifications() {
  if (isProtectedHours()) return { flushed: 0, reason: 'still protected hours' };
  let flushed = 0;
  for (const a of listAsks({ openOnly: true })) {
    if (a.sent) continue;
    await ask(a);
    flushed++;
  }
  if (!fs.existsSync(PENDING)) return { flushed };
  const rows = fs.readFileSync(PENDING, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const row of rows) {
    if (row.kind === 'report') await report(row.payload.lines, { allowTechnical: row.payload.allowTechnical, _skipQueue: true });
    else if (row.kind === 'alert') await alert({ ...row.payload, _skipQueue: true });
    flushed++;
  }
  fs.unlinkSync(PENDING);
  return { flushed };
}

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
  if (existing && existing.sent) return { sent: false, duplicate: true, ask: existing };
  if (isProtectedHours()) {
    const row = { id, title, lines, options, defaultIfSilent, askedAt: new Date().toISOString(), wib: wibParts().date + ' ' + wibParts().time, messageId: null, sent: false, sendError: 'waktu terlindungi (22.00-05.00 / akhir pekan s.d. 10.00 WIB) -- ditahan, dikirim otomatis setelahnya' };
    appendAsk(row);
    ledgerAppend({ kind: 'owner.ask', id, title, sent: false, error: row.sendError });
    return { sent: false, reason: 'protected hours', ask: row };
  }
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
  const row = { id, title, lines, options, defaultIfSilent, askedAt: new Date().toISOString(), wib: wibParts().date + ' ' + wibParts().time, messageId: r?.result?.message_id ?? null, sent: !!r.sent, sendError: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || r.error || null) };
  appendAsk(row);
  ledgerAppend({ kind: 'owner.ask', id, title, sent: !!r.sent, error: row.sendError });
  return { ...r, ask: row };
}

export function answerAsk(id, answer, by = 'owner') {
  appendAsk({ id, answer, answeredAt: new Date().toISOString(), by });
  ledgerAppend({ kind: 'owner.answer', id, answer, by });
}

export async function report(lines, { allowTechnical = false, _skipQueue = false } = {}) {
  if (!_skipQueue && isProtectedHours()) {
    queuePending('report', { lines, allowTechnical });
    ledgerAppend({ kind: 'owner.report', sent: false, error: 'waktu terlindungi -- ditahan di kueri', lines: lines.length });
    return { sent: false, reason: 'protected hours (queued)' };
  }
  const text = lines.filter(Boolean).join('\n');
  const r = await sendMessage(text, { allowTechnical });
  ledgerAppend({ kind: 'owner.report', sent: !!r.sent, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || r.error || null), lines: lines.length });
  return r;
}

export async function alert({ what, done, needsOwner = false, _skipQueue = false }) {
  if (!_skipQueue && isProtectedHours()) {
    queuePending('alert', { what, done, needsOwner });
    ledgerAppend({ kind: 'owner.alert', sent: false, what, error: 'waktu terlindungi -- ditahan di kueri' });
    return { sent: false, reason: 'protected hours (queued)' };
  }
  const text = [`*Perhatian, Bapak.*`, what, done ? `Yang sudah dilakukan: ${done}` : null, needsOwner ? 'Perlu keputusan Bapak.' : 'Tidak perlu tindakan Bapak.'].filter(Boolean).join('\n');
  const r = await sendMessage(text);
  ledgerAppend({ kind: 'owner.alert', sent: !!r.sent, what, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || r.error || null) });
  return r;
}

export { editMessageText, readJson };
