// JARVIS structured interview (Personal Assistant PRD, part 2): when the
// company is genuinely idle, or a venture's own direction is unclear, the
// Conductor doesn't just wait — it asks the owner a short, focused set of
// foundational questions over free-text chat, then synthesizes a PRD draft
// and gates it behind a normal SETUJU/TOLAK Ask before anything is built
// from it. One interview at a time; at most once per subject per day.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ROOT, company, readJson, writeJson, wibParts, ledgerAppend } from './lib.mjs';
import { askGlm, askClaude } from './claude.mjs';
import { sendMessage } from './telegram-client.mjs';
import { alert, ask } from './owner.mjs';

const STATE_FILE = path.join(STATE, 'interview.json');
const UNCLEAR_STATUSES = new Set(['waiting-owner-readme', 'unclear', 'needs-interview']);
const IDLE_STREAK_TO_TRIGGER = 2; // consecutive idle ticks, not one blip

const QUESTIONS_SCHEMA = { type: 'object', properties: { questions: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 6 } }, required: ['questions'] };

function loadState() {
  return readJson(STATE_FILE, { active: null, lastRunDate: {}, idleStreak: 0 });
}
function saveState(s) { writeJson(STATE_FILE, s); }

/** Called every tick with the same ctx run.mjs's gather() builds. Returns
 * null (nothing to do), or starts an interview and returns what it started. */
export async function maybeStartInterview(co, ctx) {
  const st = loadState();
  if (st.active) return null; // one at a time

  const openNonEpic = ctx.issues.filter((i) => !/^EPIC /.test(i.title));
  const idleNow = openNonEpic.filter((i) => i.status === 'in_progress').length === 0 && ctx.queue.length === 0;
  st.idleStreak = idleNow ? st.idleStreak + 1 : 0;

  const today = wibParts().date;
  // Priority 1: a specific venture whose own status says its direction is
  // unclear (e.g. Caveman's "waiting-owner-readme") — concrete beats vague.
  const unclear = co.ventures.find((v) => UNCLEAR_STATUSES.has(v.status) && st.lastRunDate[v.id] !== today);
  if (unclear) {
    saveState(st);
    return startInterview(co, { subject: unclear.id, kind: 'venture-unclear', label: unclear.name, context: `Goal so far: ${unclear.goal}. Status: ${unclear.status}.` });
  }

  // Priority 2: the whole company idle for 2+ ticks in a row and every known
  // venture already has an active status and open work isn't the blocker.
  if (st.idleStreak >= IDLE_STREAK_TO_TRIGGER && st.lastRunDate['company-idle'] !== today) {
    saveState(st);
    const ventureSummary = co.ventures.map((v) => `${v.name} (${v.status}): ${v.goal}`).join(' | ');
    return startInterview(co, { subject: 'company-idle', kind: 'idle-total', label: 'Aidit OS (idle)', context: `Every existing venture: ${ventureSummary}. All appear active/clear, but there is no in-progress work and an empty queue right now.` });
  }

  saveState(st);
  return null;
}

function asQuestionStrings(raw) {
  // GLM's `format` schema is advisory, not enforced (learned the hard way in
  // chat.mjs/run.mjs already) — without the schema spelled out as literal
  // JSON in the prompt text, it can return {question: "..."} objects instead
  // of plain strings, which then render as "[object Object]" in Telegram.
  // Coerce defensively even with the schema embedded below, in case it still
  // slips.
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => (typeof q === 'string' ? q : q?.question || q?.text || q?.q || null))
    .filter((q) => typeof q === 'string' && q.trim().length > 0);
}

async function startInterview(co, { subject, kind, label, context }) {
  const prompt = `You're drafting a short foundational interview for the owner of an AI-run company, about "${label}". ${context}\n\nWrite 4-6 short, concrete, non-technical questions (Indonesian, formal, address the owner as "Bapak") that would let an autonomous team turn the answers into a real PRD: what it should become, priorities/tradeoffs, constraints, and what "done" looks like. Reply with ONLY JSON matching this exact schema (questions must be plain strings, not objects):\n${JSON.stringify(QUESTIONS_SCHEMA)}`;
  const res = await askGlm({ system: 'You help draft founder-interview questions. Be concrete, not generic.', prompt, model: co.conductor.routineModel, schema: QUESTIONS_SCHEMA, tag: 'interview.draft' });
  const drafted = res.ok ? asQuestionStrings(res.structured?.questions) : [];
  const questions = drafted.length >= 4 ? drafted : DEFAULT_QUESTIONS(label);

  const st = loadState();
  st.active = { subject, kind, label, questions, qa: [], currentIndex: 0, startedAt: new Date().toISOString() };
  saveState(st);

  await alert({
    what: kind === 'venture-unclear'
      ? `Arah "${label}" belum jelas buat saya lanjutkan sendiri. Saya mau tanya ${questions.length} hal singkat dulu lewat pesan biasa (bukan tombol) — jawab santai, kapan pun Bapak sempat.`
      : `Semua pekerjaan yang jelas arahnya sudah beres untuk saat ini. Sebelum menganggur, saya mau tanya ${questions.length} hal singkat soal langkah berikutnya — jawab lewat pesan biasa.`,
    needsOwner: true,
  });
  await sendMessage(`*Pertanyaan 1/${questions.length}*\n${questions[0]}`);
  ledgerAppend({ kind: 'interview.start', subject, kindOf: kind, questions: questions.length });
  return { subject, questions: questions.length };
}

function DEFAULT_QUESTIONS(label) {
  return [
    `Untuk "${label}", mau jadi apa sebenarnya — jelaskan dengan kata Bapak sendiri.`,
    'Kalau harus pilih satu hal yang paling penting duluan, apa itu?',
    'Ada batasan yang tidak boleh dilanggar (uang, data, orang luar, dll)?',
    'Seperti apa "selesai" untuk tahap pertama ini?',
  ];
}

export function isAwaitingAnswer() {
  return !!loadState().active;
}

/** Called from telegram.mjs's free-text handler before it falls through to
 * the stateless chatReply — an interview answer is NOT a one-off question. */
export async function recordAnswer(text) {
  const st = loadState();
  const iv = st.active;
  if (!iv) return { handled: false };
  iv.qa.push({ q: iv.questions[iv.currentIndex], a: text });
  iv.currentIndex += 1;
  if (iv.currentIndex < iv.questions.length) {
    saveState(st);
    await sendMessage(`*Pertanyaan ${iv.currentIndex + 1}/${iv.questions.length}*\n${iv.questions[iv.currentIndex]}`);
    return { handled: true, done: false };
  }
  st.active = null;
  saveState(st);
  await finalize(iv);
  return { handled: true, done: true };
}

async function finalize(iv) {
  const co = company();
  const qaText = iv.qa.map((x, i) => `${i + 1}. ${x.q}\n   ${x.a}`).join('\n\n');
  const prompt = `Turn this founder interview into a short PRD draft in Indonesian, Markdown, for "${iv.label}". Sections: Tujuan, Prioritas, Batasan, Definisi Selesai (tahap pertama), Langkah Awal (3-5 concrete first tickets). Base it only on the answers below — do not invent scope the owner didn't state.\n\n${qaText}`;
  const res = await askClaude({ system: 'You write concise, concrete Indonesian PRDs from raw interview answers.', prompt, model: co.conductor.decisionModel, tag: 'interview.synthesize' });
  const prd = res.ok ? res.text.trim() : `# PRD draft gagal disusun otomatis\n\nJawaban mentah:\n\n${qaText}`;

  const fileName = `PRD-${iv.subject}-${wibParts().date}.md`;
  const filePath = path.join(ROOT, 'docs', 'tasks', fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, prd);

  const askId = `interview-prd-${iv.subject}-${wibParts().date}`;
  await ask({
    id: askId,
    title: `Draf PRD dari wawancara: ${iv.label}`,
    lines: [`Hasil wawancara sudah saya susun jadi draf PRD di ${fileName}.`, 'Ringkasan ada di JELASKAN. Setuju supaya tim mulai bekerja sesuai draf ini?'],
    defaultIfSilent: 'saya tahan dulu, tidak mulai apa pun sampai Bapak konfirmasi.',
  });
  ledgerAppend({ kind: 'interview.finalize', subject: iv.subject, file: fileName, askId });
}

/** Called from telegram.mjs's Ask-callback handler when an
 * interview-prd-<subject>-<date> ask is answered "approve" — flips the
 * venture out of its unclear status so Conductor's normal decision loop
 * treats it as active. No-op for the "company-idle" subject (not a venture). */
export function onPrdApproved(subject) {
  const st = loadState();
  st.lastRunDate[subject] = wibParts().date;
  saveState(st);
  const cfgPath = path.join(ROOT, 'config', 'company.json');
  const co = readJson(cfgPath, null);
  if (!co) return;
  const v = co.ventures?.find((x) => x.id === subject);
  if (v && UNCLEAR_STATUSES.has(v.status)) {
    v.status = 'active';
    writeJson(cfgPath, co);
    ledgerAppend({ kind: 'interview.venture-activated', subject });
  }
}
