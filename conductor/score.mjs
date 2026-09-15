// JARVIS score (PRD "Personal Assistant" s4) — v1, deterministic, no extra
// LLM calls (a score that itself burns tokens would defeat the point).
// Reads today's ledger.jsonl + asks.jsonl and produces two 0-100 scores:
// Orchestrator (the AI company's own health) and Personal Assistant (the
// chat surface's health), plus a plain breakdown of what's dragging each
// one down. This is a first cut — thresholds are documented inline so a
// later session can recalibrate them against real data, not just trust them.
//   node conductor/score.mjs            print today's score
//   node conductor/score.mjs --save     print AND append to state/jarvis-score.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE, wibParts, readJson, writeJson } from './lib.mjs';

function todayRows() {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return [];
  const today = wibParts().date;
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    if (!line || !line.includes(today)) continue; // cheap pre-filter before JSON.parse
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.wib?.slice(0, 10) !== today) continue;
    rows.push(row);
  }
  return rows;
}

function askOutcomesToday() {
  const file = path.join(STATE, 'asks.jsonl');
  if (!fs.existsSync(file)) return { approved: 0, answered: 0 };
  const today = wibParts().date;
  let approved = 0, answered = 0;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!row.answer || !row.answeredAt?.slice(0, 10).startsWith(today)) continue;
    answered++;
    if (row.answer === 'approve') approved++;
  }
  return { approved, answered };
}

const pct = (num, den, fallback = 100) => (den > 0 ? Math.round((num / den) * 100) : fallback);

export function computeScore() {
  const rows = todayRows();
  const ticks = rows.filter((r) => r.kind === 'conductor.tick' && !r.skipped);
  const laneRuns = rows.filter((r) => r.kind === 'lane.run');
  const chats = rows.filter((r) => r.kind === 'owner.chat');
  const lexiconRejects = rows.filter((r) => r.kind === 'lexicon.reject').length;
  // Direct regression guard for the exact bug class fixed in PRD v5.1 s7
  // (422 invalid_issue_disposition) — any recurrence tanks this sub-score
  // hard, on purpose, since it's a known-fixed class of failure.
  const dispositionErrors = rows.filter((r) => r.kind === 'head.error' && /invalid_issue_disposition|422/i.test(r.error || '')).length;
  const { approved, answered } = askOutcomesToday();

  const tickHealth = pct(ticks.filter((t) => t.ok).length, ticks.length);
  const laneReliability = pct(laneRuns.filter((r) => r.ok).length, laneRuns.length);
  const noRegressionBugs = Math.max(0, 100 - 25 * dispositionErrors);
  const askHealth = pct(approved, answered);
  const orchestrator = Math.round((tickHealth + laneReliability + noRegressionBugs + askHealth) / 4);

  const chatSuccess = pct(chats.filter((c) => c.ok).length, chats.length);
  const lexiconCleanliness = Math.round(100 * (1 - lexiconRejects / Math.max(1, chats.length)));
  const escalated = chats.filter((c) => c.escalated).length;
  const escalationDiscipline = Math.max(0, 100 - 20 * Math.max(0, escalated - 5)); // 5/day cap, see conductor-chat-sonnet budget
  const personalAssistant = Math.round((chatSuccess + lexiconCleanliness + escalationDiscipline) / 3);

  const jarvis = Math.round((orchestrator + personalAssistant) / 2);

  const drags = [];
  if (tickHealth < 100) drags.push(`${ticks.length - ticks.filter((t) => t.ok).length} tick conductor gagal`);
  if (laneReliability < 90) drags.push(`lane gagal ${100 - laneReliability}%`);
  if (dispositionErrors > 0) drags.push(`${dispositionErrors}x error disposisi 422 kambuh`);
  if (askHealth < 100 && answered > 0) drags.push(`${answered - approved} Ask ditolak`);
  if (chatSuccess < 100 && chats.length > 0) drags.push(`${chats.length - chats.filter((c) => c.ok).length} chat gagal`);
  if (lexiconRejects > 0) drags.push(`${lexiconRejects}x balasan chat kena gerbang lexicon`);

  return {
    date: wibParts().date,
    jarvis,
    orchestrator: { score: orchestrator, tickHealth, laneReliability, noRegressionBugs, askHealth, sample: { ticks: ticks.length, laneRuns: laneRuns.length, asksAnswered: answered } },
    personalAssistant: { score: personalAssistant, chatSuccess, lexiconCleanliness, escalationDiscipline, sample: { chats: chats.length, escalated, lexiconRejects } },
    drags,
  };
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const score = computeScore();
  console.log(JSON.stringify(score, null, 2));
  if (process.argv.includes('--save')) {
    const file = path.join(STATE, 'jarvis-score.json');
    const history = readJson(file, {});
    history[score.date] = score;
    writeJson(file, history);
  }
}
