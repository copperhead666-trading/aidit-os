// JARVIS v5 Telegram door (PRD v5 s6): long-poll listener for the owner.
// Handles /pause /resume /status /cockpit /laporan, Ask button taps
// (SETUJU/TOLAK/NANTI/JELASKAN/A-B-C), and free text (recorded for the
// Conductor as an owner note). Sends the 07:00 and 19:00 Reports. Never calls
// an LLM itself. PM2 process "telegram".
//   node conductor/telegram.mjs            loop
//   node conductor/telegram.mjs --report   send a Report now and exit
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ROOT, company, paperclipCfg, lanesCfg, loadEnvLocal, readJson, writeJson, ledgerAppend, ledgerTail, isPaused, setPaused, pc, paperclipHealth, wibParts, wibStamp, machineHealth } from './lib.mjs';
import { getUpdates, answerCallbackQuery, editMessageText, sendMessage, sendVoice, setMyCommands, OWNER_CHAT_ID } from './telegram-client.mjs';
import { answerAsk, listAsks, report } from './owner.mjs';
import { lanesStatus } from './lanes.mjs';
import { chatReply } from './chat.mjs';
import { synthesize, EN_PIPER_MODEL } from '../ops/voice/voice-out.mjs';
import { renderSpokenReport } from '../ops/voice/spoken-report.mjs';
import { computeScore } from './score.mjs';
import { isAwaitingAnswer, recordAnswer, onPrdApproved } from './interview.mjs';

loadEnvLocal();
const co = company();
const OFFSET_FILE = path.join(STATE, 'telegram-offset.json');
const REPORT_FILE = path.join(STATE, 'reports.json');
const NOTES_FILE = path.join(STATE, 'owner-notes.jsonl');
const COCKPIT_URL = process.env.COCKPIT_URL || 'https://lenovo-black.tailc7b60e.ts.net/';

const ANSWER_TEXT = { approve: 'SETUJU', reject: 'TOLAK', later: 'NANTI', explain: 'JELASKAN', optA: 'A', optB: 'B', optC: 'C' };

function isOwner(u) {
  const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? u.callback_query?.from?.id;
  return String(chat) === String(OWNER_CHAT_ID);
}

async function statusLines() {
  const cfg = paperclipCfg();
  const h = await paperclipHealth();
  let open = 0, inProgress = 0, review = 0, blocked = 0;
  if (h.ok) {
    const issues = await pc('GET', `/api/companies/${cfg.companyId}/issues`).catch(() => []);
    for (const i of issues) {
      if (['done', 'canceled', 'cancelled', 'archived'].includes(i.status)) continue;
      open++;
      if (i.status === 'in_progress') inProgress++;
      if (i.status === 'in_review') review++;
      if (i.status === 'blocked') blocked++;
    }
  }
  const m = await machineHealth();
  const lanes = lanesStatus().lanes || {};
  const resting = Object.entries(lanes).filter(([, s]) => s.state === 'resting').length;
  const asks = listAsks();
  return {
    paused: isPaused(), boardOk: h.ok, open, inProgress, review, blocked, resting, asks: asks.length, freeDiskGb: m.freeDiskGb, freeRamMb: m.freeRamMb,
    lastTick: ledgerTail(60).reverse().find((e) => e.kind === 'conductor.tick'),
  };
}

function humanStatus(s) {
  const lines = [
    s.paused ? 'Semua departemen sedang *dijeda* atas perintah Bapak.' : 'Semua departemen bekerja.',
    s.boardOk ? `Pekerjaan terbuka: ${s.open} (sedang dikerjakan ${s.inProgress}, menunggu pemeriksaan ${s.review}, tertahan ${s.blocked}).` : 'Papan kerja sedang tidak dapat dihubungi; sedang dipulihkan.',
    s.asks ? `Menunggu keputusan Bapak: ${s.asks}.` : 'Tidak ada yang menunggu keputusan Bapak.',
    s.resting ? `${s.resting} pekerja sedang beristirahat karena batas pemakaian.` : null,
    s.freeDiskGb != null && s.freeDiskGb < 10 ? `Ruang penyimpanan tersisa ${s.freeDiskGb} GB; pembersihan otomatis berjalan.` : null,
  ];
  return lines.filter(Boolean);
}

async function ventureLines() {
  const cfg = paperclipCfg();
  const issues = await pc('GET', `/api/companies/${cfg.companyId}/issues`).catch(() => []);
  return co.ventures.map((v) => {
    const pid = cfg.projects?.[v.id];
    const mine = issues.filter((i) => i.projectId === pid && !/^EPIC /.test(i.title));
    const done = mine.filter((i) => i.status === 'done').length;
    const review = mine.filter((i) => i.status === 'in_review').length;
    const next = v.milestones.find((m) => m.date >= wibParts().date);
    return `${v.name}: ${mine.length ? `${done} selesai, ${review} menunggu pemeriksaan, ${mine.length - done - review} berjalan` : 'belum ada pekerjaan berjalan'}${next ? `; berikutnya ${next.what.toLowerCase()} (${next.date.slice(8)}/${next.date.slice(5, 7)})` : ''}.`;
  });
}

// PRD v5.1 s6 step 8: one plain-Indonesian line per pool for the evening
// report (Finance/Kuota's deeper Claude-specific audit reads ~/.claude/
// projects separately — this is just the owner-facing headline count).
function poolUsageToday() {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return null;
  const today = wibParts().date;
  const laneToPool = Object.fromEntries(Object.entries(lanesCfg().lanes).map(([id, l]) => [id, l.pool]));
  const counts = {};
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    if (!line || !line.includes(today)) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.wib?.slice(0, 10) !== today) continue;
    let pool = null;
    if (row.kind === 'claude.call' || (row.kind === 'lane.run' && row.configDir)) pool = row.configDir && row.configDir !== '~/.claude' ? 'claude-mesin' : 'claude-orkestrator';
    else if (row.kind === 'lane.run') pool = laneToPool[row.lane] || row.lane;
    if (!pool) continue;
    counts[pool] = (counts[pool] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return 'Pemakaian hari ini: belum ada panggilan model.';
  return `Pemakaian hari ini: ${entries.map(([pool, n]) => `${pool} ${n}x`).join(', ')}.`;
}

function scoreLine() {
  const sc = computeScore();
  const file = path.join(STATE, 'jarvis-score.json');
  const history = readJson(file, {});
  history[sc.date] = sc;
  writeJson(file, history);
  return `Skor JARVIS hari ini: ${sc.jarvis}/100 (orkestrator ${sc.orchestrator.score}, asisten ${sc.personalAssistant.score}).`;
}

// PRD JARVIS s3: a spoken companion to the text report, English/"Sir" per
// the spoken-channel voice policy in config/persona/register.yaml (deliberate
// — distinct from the text report's Indonesian/"Bapak", not a bug). Piper
// (offline, already installed with an English voice — confirmed live this
// session) + ffmpeg wav->ogg, sent as a Telegram voice note. Best-effort:
// any failure here must never block or fail the text report.
async function sendSpokenReport(s, hour) {
  const model = path.join(process.env.LOCALAPPDATA || path.join(ROOT, 'state'), 'AiditOS', 'piper', `${EN_PIPER_MODEL}.onnx`);
  const text = renderSpokenReport({ waiting: Array.from({ length: s.asks || 0 }), stuck: s.blocked }, { hour });
  const r = await synthesize(text, { provider: 'piper', model });
  if (!r.ok) { ledgerAppend({ kind: 'voice.report', ok: false, error: r.reason, text }); return; }
  const wavFile = r.file.replace(/\.ogg$/i, '.wav');
  // Diagnostic: the first live send (2026-09-15 11:32 WIB) played as a 2s
  // clip in Telegram despite the source text having 4 lines — logging text/
  // duration/file size here so the next real send can actually be compared
  // instead of guessed at.
  let durationSec = null;
  try {
    const { execSync } = await import('node:child_process');
    durationSec = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${r.file}"`, { encoding: 'utf8', timeout: 10000 }).trim());
  } catch {}
  try {
    const vr = await sendVoice(r.file, '', { allowTechnical: true });
    ledgerAppend({ kind: 'voice.report', ok: !!vr.sent, error: vr.sent ? null : (vr.reason || vr.networkErrorMessage || null), text, chars: text.length, durationSec, bytes: fs.statSync(r.file).size });
  } finally {
    try { fs.unlinkSync(r.file); } catch {}
    try { fs.unlinkSync(wavFile); } catch {}
  }
}

export async function sendReport(kind = 'auto') {
  const p = wibParts();
  const greet = p.hour < 11 ? 'Selamat pagi' : p.hour < 15 ? 'Selamat siang' : p.hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const s = await statusLines();
  const lines = [
    `*${greet}, Bapak.* Laporan ${p.time} WIB.`,
    ...humanStatus(s).slice(0, 3),
    ...(await ventureLines()),
    ...(p.hour >= 13 ? [poolUsageToday(), scoreLine()].filter(Boolean) : []),
    `Layar rinci: ${COCKPIT_URL}`,
  ];
  const r = await report(lines);
  const st = readJson(REPORT_FILE, {});
  st[`${p.date}-${p.hour < 13 ? 'pagi' : 'malam'}`] = { at: new Date().toISOString(), sent: !!r.sent, kind, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || null) };
  writeJson(REPORT_FILE, st);
  // Awaited (not fire-and-forget): the --report CLI path calls process.exit()
  // right after sendReport() resolves, which would otherwise kill this mid-
  // synthesis. Wrapped so a voice failure never fails the text report above.
  try { await sendSpokenReport(s, p.hour); } catch (e) { ledgerAppend({ kind: 'voice.report', ok: false, error: e.message.slice(0, 160) }); }
  return r;
}

async function maybeScheduledReport() {
  const p = wibParts();
  if (!co.company.reportHours.includes(p.hour) || p.minute > 20) return;
  const key = `${p.date}-${p.hour < 13 ? 'pagi' : 'malam'}`;
  const st = readJson(REPORT_FILE, {});
  if (st[key]?.sent) return;
  await sendReport('scheduled');
}

async function handleCommand(text) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  switch (cmd) {
    case '/pause': setPaused(true); return 'Baik, Bapak. Semua departemen dihentikan sampai Bapak mengirim /resume.';
    case '/resume': setPaused(false); return 'Baik, Bapak. Semua departemen melanjutkan pekerjaan.';
    case '/status': return humanStatus(await statusLines()).join('\n');
    case '/cockpit': return `Layar rinci Aidit OS: ${COCKPIT_URL}`;
    case '/laporan': case '/report': await sendReport('manual'); return null;
    case '/start': case '/help': return 'Perintah: /status, /laporan, /pause, /resume, /cockpit. Bapak juga dapat menulis pesan bebas; saya akan menjawab langsung.';
    default: return null;
  }
}

async function handleMessage(msg) {
  const text = msg.text || (msg.voice ? '[pesan suara]' : '');
  if (!text) return;
  if (text.startsWith('/')) {
    const reply = await handleCommand(text);
    ledgerAppend({ kind: 'owner.command', text: text.slice(0, 40) });
    if (reply) await sendMessage(reply, { allowTechnical: true });
    return;
  }
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(NOTES_FILE, JSON.stringify({ ts: new Date().toISOString(), wib: wibStamp(), text }) + '\n');
  ledgerAppend({ kind: 'owner.note', text: text.slice(0, 200) });
  // A structured interview in progress owns free text until it's done — an
  // answer to "what should this venture become" is not a one-off question
  // for the stateless chatReply.
  if (isAwaitingAnswer()) { await recordAnswer(text); return; }
  const r = await chatReply({ text, channel: 'telegram' });
  await sendMessage(r.reply);
}

async function handleCallback(cq) {
  const data = String(cq.data || '');
  await answerCallbackQuery(cq.id, 'Diterima.');
  const m = data.match(/^ask:([^:]+):(\w+)$/);
  if (!m) return;
  const [, id, answer] = m;
  const ask = listAsks({ openOnly: false }).find((a) => a.id === id);
  if (answer === 'explain') {
    const detail = ask ? [`*${ask.title}*`, ...(ask.lines || []), '', 'Jika disetujui, mesin melanjutkan sesuai rencana. Jika ditolak, pekerjaan itu dihentikan dan dicatat. NANTI menunda 24 jam.'].join('\n') : 'Permintaan itu tidak lagi saya temukan.';
    await sendMessage(detail);
    return;
  }
  answerAsk(id, answer);
  const label = ANSWER_TEXT[answer] || answer;
  const msgId = cq.message?.message_id;
  if (msgId) await editMessageText(msgId, `*${ask?.title || 'Keputusan'}*\nJawaban Bapak: ${label} (${wibStamp()}).`, { removeKeyboard: true });
  const prdMatch = answer === 'approve' && id.match(/^interview-prd-(.+)-\d{4}-\d{2}-\d{2}$/);
  if (prdMatch) onPrdApproved(prdMatch[1]);
}

async function loop() {
  await setMyCommands([
    { command: 'status', description: 'Keadaan singkat' },
    { command: 'laporan', description: 'Kirim laporan sekarang' },
    { command: 'pause', description: 'Hentikan semua departemen' },
    { command: 'resume', description: 'Lanjutkan pekerjaan' },
    { command: 'cockpit', description: 'Tautan layar rinci' },
  ]).catch(() => {});
  let offset = readJson(OFFSET_FILE, { offset: 0 }).offset || 0;
  let backoff = 2000;
  for (;;) {
    try { await maybeScheduledReport(); } catch (e) { ledgerAppend({ kind: 'telegram.error', where: 'report', error: e.message }); }
    const r = await getUpdates(offset || undefined, { timeoutMs: 25000 });
    if (!r.ok) { await new Promise((res) => setTimeout(res, backoff)); backoff = Math.min(backoff * 2, 60000); continue; }
    backoff = 2000;
    for (const u of r.updates) {
      offset = u.update_id + 1;
      writeJson(OFFSET_FILE, { offset });
      if (!isOwner(u)) continue;
      try {
        if (u.callback_query) await handleCallback(u.callback_query);
        else if (u.message) await handleMessage(u.message);
      } catch (e) { ledgerAppend({ kind: 'telegram.error', error: e.message.slice(0, 200) }); }
    }
  }
}

const simulateFlagIndex = process.argv.indexOf('--simulate');
if (process.argv.includes('--report')) {
  sendReport('manual').then((r) => { console.log(JSON.stringify({ sent: !!r.sent, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage) })); process.exit(r.sent ? 0 : 1); });
} else if (simulateFlagIndex >= 0) {
  // Exercises the exact free-text path handleMessage() runs, minus the
  // network send — for verifying a chat/lexicon change without restarting
  // the PM2 "telegram" process or spending a real Telegram message.
  const text = process.argv[simulateFlagIndex + 1] || '';
  chatReply({ text, channel: 'telegram' }).then((r) => { console.log(JSON.stringify(r)); process.exit(0); });
} else {
  loop().catch((e) => { console.error(e); process.exit(1); });
}
