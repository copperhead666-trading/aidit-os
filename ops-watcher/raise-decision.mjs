// ops-watcher/raise-decision.mjs
//
// The ONE way an agent puts a new decision in front of the owner.
//
// WHY THIS EXISTS. The owner agreed on 2026-09-04 that when an agent hits
// something only he can decide, it does not stop — it parks the question and
// keeps working. Parking is only honest if the question actually reaches him.
// A paragraph in a terminal does not: he closes the laptop and it is gone.
//
// So a parked decision becomes a real issue on the board and goes out through
// the same path AHMAD's escalations do — which means the card/digest built for
// the seventeen already carries it, reconcile.mjs counts it, and the ledger
// records it. One delivery path, not two.
//
// ahmad-escalate.mjs escalates an issue that already EXISTS. This creates the
// issue first, then hands it to that same gate. Everything after creation is
// ahmad-escalate's job, deliberately: a second escalation implementation would
// be a second set of rules, and one predicate in two places is the disease this
// whole migration removed.
//
// THE GATE BINDS THE CALLER TOO. The brief is validated BEFORE the issue is
// created, so a bad brief leaves no litter on the board. If the five slots are
// good enough to require of AHMAD, they are good enough to require here.
//
// PAUSE BINDS TOO. ops-watcher/PAUSED is the owner's emergency stop and
// pause-gate.mjs fails closed on purpose. Until now no session-agent path
// checked it — an agent could keep writing to the board after the owner had
// pressed stop. This checks it first, and writes nothing when paused.
//
//   node ops-watcher/raise-decision.mjs "<title>" "<reason>" <path/to/brief.json>

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPaperclipPort,
  httpPost,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";
import { runEscalateOnce } from "./ahmad-escalate.mjs";
import { validateDecisionBrief, renderRefusal } from "./decision-brief.mjs";
import { readPause } from "./pause-gate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The label that puts an issue in the owner's queue at all. Same string
// telegram-notify.mjs and needs-owner.mjs use; escalation applies it, this file
// only names it for the DIRECTIVE label it adds at creation.
export const DIRECTIVE_LABEL = "DIRECTIVE";

/**
 * Raise a brand-new decision to the owner.
 *
 * deps: { base, companyId, title, reason, brief, httpPost, escalate,
 *         pauseState, log }
 * All injected for tests — nothing here may touch the real board in a suite.
 */
export async function raiseDecisionOnce(deps = {}) {
  const {
    base,
    companyId = CANONICAL_COMPANY_ID,
    title,
    reason,
    brief = null,
    httpPost: _post = httpPost,
    escalate = runEscalateOnce,
    pauseState = readPause,
    log = (m) => console.log(m),
  } = deps;

  // 1. The owner's stop button, before anything else.
  const pause = await pauseState();
  if (pause && pause.paused) {
    const out = { ok: false, reason: "paused", detail: pause.reason || "" };
    log(`raise-decision: REFUSING — FounderOS is PAUSED (${out.detail})`);
    return out;
  }

  if (!base) {
    log("raise-decision: no Paperclip base resolved (instance not running)");
    return { ok: false, reason: "no-base" };
  }
  if (!title || !String(title).trim()) {
    log("raise-decision: missing title");
    return { ok: false, reason: "missing-title" };
  }

  // 2. The gate, BEFORE the write. A refused brief must leave the board
  //    untouched — no half-created issue for someone to find later and wonder
  //    about.
  const verdict = validateDecisionBrief(brief);
  if (!verdict.ok) {
    const refusal = renderRefusal(verdict);
    log(`raise-decision: REFUSED before creating anything — missing: ${verdict.missing.join(", ") || "(shape)"}`);
    return {
      ok: false,
      reason: "brief-incomplete",
      missing: verdict.missing,
      reasons: verdict.reasons,
      refusal,
    };
  }

  // 3. Create the issue. Same endpoint and shape telegram-listener.mjs:779 uses
  //    for an owner directive, so there is exactly one way an issue is born.
  const created = await _post(`${base}/api/companies/${companyId}/issues`, {
    title: String(title).trim(),
    description: String(reason || "").trim() || verdict.brief.pertanyaan,
  });
  if (created.networkError) {
    log(`raise-decision: createIssue network error: ${created.networkErrorMessage}`);
    return { ok: false, reason: "create-network-error" };
  }
  if (created.status >= 400 || !created.body || !created.body.id) {
    log(`raise-decision: createIssue failed status=${created.status}`);
    return { ok: false, reason: "create-failed", status: created.status };
  }

  const identifier = created.body.identifier || null;
  if (!identifier) {
    // Without an identifier the issue can reach no surface: buildDigest skips
    // it and a Telegram callback cannot carry a UUID. reconcile.mjs's T2b is
    // exactly this case. Report it rather than pretending the owner was reached.
    log(`raise-decision: created issue ${created.body.id} has NO identifier — it can reach no surface`);
    return { ok: false, reason: "created-without-identifier", id: created.body.id };
  }
  log(`raise-decision: created ${identifier}`);

  // 4. Hand it to the same gate AHMAD goes through. It applies OWNER_REQUIRED,
  //    posts the human sentence, then the structured brief.
  const esc = await escalate({
    base,
    companyId,
    issueIdentifier: identifier,
    reason: String(reason || "").trim() || verdict.brief.pertanyaan,
    brief: verdict.brief,
    log,
  });

  if (!esc.ok) {
    return {
      ok: false,
      reason: `escalation-failed: ${esc.reason}`,
      identifier,
      created: true,
      escalated: esc.escalated === true,
    };
  }

  return { ok: true, identifier, created: true, escalated: true, briefPosted: esc.briefPosted === true };
}

// ---- CLI ----
async function readBriefArg(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      return JSON.parse(s);
    } catch (err) {
      return { __parseError: err && err.message ? err.message : String(err) };
    }
  }
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(s, "utf8"));
  } catch (err) {
    return { __parseError: `could not read brief file ${s}: ${err && err.message ? err.message : err}` };
  }
}

async function main() {
  const title = process.argv[2];
  const reason = process.argv[3];
  const briefArg = process.argv[4];
  if (!title || !briefArg) {
    console.error('usage: node ops-watcher/raise-decision.mjs "<title>" "<reason>" \'<brief JSON>\' | <path/to/brief.json>');
    process.exit(2);
  }
  const brief = await readBriefArg(briefArg);
  if (brief && brief.__parseError) {
    console.error(`raise-decision: brief could not be read — ${brief.__parseError}`);
    process.exit(2);
  }
  // Retry discovery rather than taking one probe's word for it. The default is
  // a single sweep at 2s per candidate, and under load — a lane running the
  // suite on the same machine is enough — that probe times out and discovery
  // answers null. The caller then reports "instance not running" about an
  // instance that is answering 200, and a parked decision silently never
  // reaches the owner. Observed exactly that on 2026-09-04.
  // pm2-supervisor.mjs:504 already retries for the same reason.
  const port = await discoverPaperclipPort(undefined, { attempts: 3, retryDelayMs: 1500 });
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await raiseDecisionOnce({ base, title, reason, brief, log: (m) => console.log(m) });
  if (r.reason === "brief-incomplete") console.error(r.refusal);
  console.log(JSON.stringify({ ...r, refusal: undefined }));
  process.exit(r.ok ? 0 : 1);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((err) => {
    console.error("raise-decision fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
