// JARVIS self-improvement (Personal Assistant PRD, Bagian 8): the score
// already names what's dragging it down (conductor/score.mjs's `drags`) --
// this turns that into real internal tickets instead of a number nobody
// acts on. Deterministic, no LLM call (same discipline as score.mjs itself):
// one ticket per unresolved drag, deduped by title exactly like the Ask fix
// in run.mjs, so a low score doesn't spam the board every tick.
import { paperclipCfg, pc, ledgerAppend } from './lib.mjs';
import { computeScore } from './score.mjs';

const SCORE_FLOOR = 80; // below this, drags become real tickets

function titleFor(drag) {
  return `[Self-improve] ${drag}`.slice(0, 120);
}

export async function maybeSelfImprove() {
  const score = computeScore();
  if (score.jarvis >= SCORE_FLOOR || !score.drags.length) {
    return { acted: false, score: score.jarvis };
  }
  const cfg = paperclipCfg();
  let existing = [];
  try {
    existing = await pc('GET', `/api/companies/${cfg.companyId}/issues`);
  } catch (e) {
    ledgerAppend({ kind: 'self-improve.error', error: e.message.slice(0, 160) });
    return { acted: false, error: e.message };
  }
  const openTitles = new Set(existing.filter((i) => !['done', 'canceled', 'cancelled', 'archived'].includes(i.status)).map((i) => i.title));

  const created = [];
  for (const drag of score.drags) {
    const title = titleFor(drag);
    if (openTitles.has(title)) continue; // already being worked, don't duplicate
    const dept = /disposisi|lane gagal|tick conductor|lexicon|chat gagal/i.test(drag) ? 'engineering' : 'platform';
    const headId = cfg.heads?.[dept];
    if (!headId) continue; // department not bootstrapped yet -- skip, don't crash
    try {
      const issue = await pc('POST', `/api/companies/${cfg.companyId}/issues`, {
        title,
        description: `Skor JARVIS hari ini ${score.jarvis}/100 (orkestrator ${score.orchestrator.score}, asisten ${score.personalAssistant.score}). Penyebab: ${drag}. Tiket ini dibuat otomatis oleh conductor/self-improve.mjs -- perbaiki akar masalahnya, bukan cuma angka skornya.`,
        projectId: cfg.projects?.internal,
        assigneeAgentId: headId,
        priority: 'medium',
        status: 'todo',
        reviewPolicy: 'anyone',
      });
      created.push(issue.identifier);
    } catch (e) { ledgerAppend({ kind: 'self-improve.error', drag, error: e.message.slice(0, 160) }); }
  }
  if (created.length) ledgerAppend({ kind: 'self-improve.created', score: score.jarvis, created, drags: score.drags });
  return { acted: created.length > 0, score: score.jarvis, created };
}
