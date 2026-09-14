// JARVIS v5 Telegram door (PRD v5 s6): long-poll listener for the owner.
// Handles /pause /resume /status /cockpit /laporan, Ask button taps
// (SETUJU/TOLAK/NANTI/JELASKAN/A-B-C), and free text (recorded for the
// Conductor as an owner note). Sends the 07:00 and 19:00 Reports. Never calls
// an LLM itself. PM2 process "telegram".
//   node conductor/telegram.mjs            loop
//   node conductor/telegram.mjs --report   send a Report now and exit
import fs from 'node:fs';
import path from 'node:path';
import { STATE, ROOT, company, paperclipCfg, loadEnvLocal, readJson, writeJson, ledgerAppend, ledgerTail, isPaused, setPaused, pc, paperclipHealth, wibParts, wibStamp, machineHealth } from './lib.mjs';
import { getUpdates, answerCallbackQuery, editMessageText, sendMessage, setMyCommands, OWNER_CHAT_ID } from './telegram-client.mjs';
import { answerAsk, listAsks, report } from './owner.mjs';
import { lanesStatus } from './lanes.mjs';

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

export async function sendReport(kind = 'auto') {
  const p = wibParts();
  const greet = p.hour < 11 ? 'Selamat pagi' : p.hour < 15 ? 'Selamat siang' : p.hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const s = await statusLines();
  const lines = [
    `*${greet}, Bapak.* Laporan ${p.time} WIB.`,
    ...humanStatus(s).slice(0, 3),
    ...(await ventureLines()),
    `Layar rinci: ${COCKPIT_URL}`,
  ];
  const r = await report(lines);
  const st = readJson(REPORT_FILE, {});
  st[`${p.date}-${p.hour < 13 ? 'pagi' : 'malam'}`] = { at: new Date().toISOString(), sent: !!r.sent, kind, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage || null) };
  writeJson(REPORT_FILE, st);
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
    case '/start': case '/help': return 'Perintah: /status, /laporan, /pause, /resume, /cockpit. Bapak juga dapat menulis pesan bebas; saya catat dan tindak lanjuti.';
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
  await sendMessage('Baik, Bapak. Pesan Bapak saya catat dan akan saya tindak lanjuti pada putaran berikutnya.');
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

if (process.argv.includes('--report')) {
  sendReport('manual').then((r) => { console.log(JSON.stringify({ sent: !!r.sent, error: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage) })); process.exit(r.sent ? 0 : 1); });
} else {
  loop().catch((e) => { console.error(e); process.exit(1); });
}
