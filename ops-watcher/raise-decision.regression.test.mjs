// ops-watcher/raise-decision.regression.test.mjs
// Offline regression coverage for the owner decision raiser. NO filesystem,
// NO network, NO Paperclip, NO real pause flag: every actuator is injected.
// Run with:
//   node ops-watcher/raise-decision.regression.test.mjs

import assert from "node:assert/strict";
import { raiseDecisionOnce } from "./raise-decision.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

const BASE = "http://paperclip.test";
const COMPANY_ID = "company-test";

function validBrief(over = {}) {
  return {
    pertanyaan: "Apakah Anda menyetujui aturan komisi bertingkat untuk kuartal ini?",
    yang_sudah_ada: [
      {
        kutipan: "Komisi saat ini masih flat tiga persen untuk semua tier.",
        sumber: "ventures/sjs-superapps config/commission.json",
      },
    ],
    pilihan: [
      {
        key: "tetap",
        label: "Tetap flat",
        konsekuensi: "Tidak ada perubahan sistem dan margin tetap seperti sekarang.",
      },
      {
        key: "bertingkat",
        label: "Pakai tier",
        konsekuensi: "Butuh perubahan konfigurasi dan margin tier bawah membaik.",
      },
    ],
    rekomendasi: {
      pilihan: "bertingkat",
      alasan: "Tier bawah punya transaksi terbesar sehingga perubahan ini memberi dampak margin paling jelas.",
    },
    kalau_didiamkan: "Komisi kuartal ini tetap terkunci dan tidak bisa dikoreksi surut.",
    ...over,
  };
}

function rawBriefWithWhitespace() {
  return validBrief({
    pertanyaan: "  Apakah Anda menyetujui aturan komisi bertingkat untuk kuartal ini?  ",
    yang_sudah_ada: [
      {
        kutipan: "  Komisi saat ini masih flat tiga persen untuk semua tier.  ",
        sumber: "  ventures/sjs-superapps config/commission.json  ",
      },
    ],
    pilihan: [
      {
        key: "  tetap  ",
        label: "  Tetap flat  ",
        konsekuensi: "  Tidak ada perubahan sistem dan margin tetap seperti sekarang.  ",
      },
      {
        key: "  bertingkat  ",
        label: "  Pakai tier  ",
        konsekuensi: "  Butuh perubahan konfigurasi dan margin tier bawah membaik.  ",
      },
    ],
    rekomendasi: {
      pilihan: "  bertingkat  ",
      alasan: "  Tier bawah punya transaksi terbesar sehingga perubahan ini memberi dampak margin paling jelas.  ",
    },
    kalau_didiamkan: "  Komisi kuartal ini tetap terkunci dan tidak bisa dikoreksi surut.  ",
  });
}

function harness(over = {}) {
  const calls = {
    httpPost: [],
    escalate: [],
    pauseState: [],
    log: [],
  };
  const deps = {
    base: BASE,
    companyId: COMPANY_ID,
    title: "Owner decision needed",
    reason: "Owner must choose the commission route.",
    brief: validBrief(),
    pauseState: async () => {
      calls.pauseState.push({});
      return over.pause ?? { paused: false };
    },
    httpPost: async (url, body) => {
      calls.httpPost.push({ url, body });
      if (over.httpPostError) throw over.httpPostError;
      return over.httpPostResult ?? {
        status: 201,
        body: { id: "issue-uuid-1", identifier: "KOL-999" },
      };
    },
    escalate: async (args) => {
      calls.escalate.push(args);
      return over.escalateResult ?? { ok: true, escalated: true, briefPosted: true };
    },
    log: (message) => { calls.log.push(message); },
    ...(over.deps || {}),
  };
  return { calls, deps };
}

async function t1_pausedRefusesBeforeAnyWrite() {
  const { calls, deps } = harness({
    pause: { paused: true, reason: "owner stop button" },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, false, "T1: paused result is red");
  assert.equal(result.reason, "paused", "T1: reason is paused");
  assert.equal(result.detail, "owner stop button", "T1: pause reason is surfaced");
  assert.equal(calls.httpPost.length, 0, "T1: paused path creates nothing");
  assert.equal(calls.escalate.length, 0, "T1: paused path escalates nothing");
  ok("T1: paused owner stop refuses before httpPost or escalate");
}

async function t2_incompleteBriefRefusesBeforeAnyWrite() {
  const { calls, deps } = harness({
    deps: {
      brief: { pertanyaan: "SJS HRD KPI commission rules need your input" },
    },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, false, "T2: incomplete brief result is red");
  assert.equal(result.reason, "brief-incomplete", "T2: reason is brief-incomplete");
  assert.deepEqual(
    result.missing,
    ["yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"],
    "T2: refusal names the four absent slots",
  );
  assert.equal(typeof result.refusal, "string", "T2: refusal string is returned");
  assert.match(result.refusal, /ESCALATION REFUSED/, "T2: refusal explains the gate");
  assert.equal(calls.httpPost.length, 0, "T2: refused brief creates nothing");
  assert.equal(calls.escalate.length, 0, "T2: refused brief escalates nothing");
  ok("T2: incomplete KOL-67 topic shape leaves no board litter");
}

async function t3_happyPathCreatesThenEscalatesWithValidatedBrief() {
  const rawBrief = rawBriefWithWhitespace();
  const expectedBrief = validBrief();
  const { calls, deps } = harness({
    deps: {
      title: "  Owner decision needed  ",
      reason: "  Owner must choose the commission route.  ",
      brief: rawBrief,
    },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, true, "T3: happy path succeeds");
  assert.deepEqual(
    result,
    { ok: true, identifier: "KOL-999", created: true, escalated: true, briefPosted: true },
    "T3: result reports created, escalated, and briefPosted",
  );
  assert.equal(calls.httpPost.length, 1, "T3: issue is created once");
  assert.deepEqual(
    calls.httpPost[0],
    {
      url: `${BASE}/api/companies/${COMPANY_ID}/issues`,
      body: {
        title: "Owner decision needed",
        description: "Owner must choose the commission route.",
      },
    },
    "T3: create body is trimmed and sent to the company issue endpoint",
  );
  assert.equal(calls.escalate.length, 1, "T3: escalation is called once");
  assert.equal(calls.escalate[0].issueIdentifier, "KOL-999", "T3: escalate receives the created identifier");
  assert.deepEqual(calls.escalate[0].brief, expectedBrief, "T3: escalate receives the validated brief");
  assert.notDeepEqual(calls.escalate[0].brief, rawBrief, "T3: raw untrimmed brief is not forwarded");
  ok("T3: happy path creates once and escalates once with the validated brief");
}

async function t4_noBaseAndMissingTitleAreZeroWriteRefusals() {
  const noBase = harness({ deps: { base: null } });
  const noBaseResult = await raiseDecisionOnce(noBase.deps);

  assert.equal(noBaseResult.ok, false, "T4: no base result is red");
  assert.equal(noBaseResult.reason, "no-base", "T4: no base reason is reported");
  assert.equal(noBase.calls.httpPost.length, 0, "T4: no base creates nothing");
  assert.equal(noBase.calls.escalate.length, 0, "T4: no base escalates nothing");

  const missingTitle = harness({ deps: { title: "   " } });
  const missingTitleResult = await raiseDecisionOnce(missingTitle.deps);

  assert.equal(missingTitleResult.ok, false, "T4: missing title result is red");
  assert.equal(missingTitleResult.reason, "missing-title", "T4: missing title reason is reported");
  assert.equal(missingTitle.calls.httpPost.length, 0, "T4: missing title creates nothing");
  assert.equal(missingTitle.calls.escalate.length, 0, "T4: missing title escalates nothing");
  ok("T4: no base and blank title both stop before any write");
}

async function t5_createFailuresNeverEscalate() {
  const network = harness({
    httpPostResult: {
      networkError: true,
      networkErrorMessage: "ECONNREFUSED",
    },
  });
  const networkResult = await raiseDecisionOnce(network.deps);

  assert.equal(networkResult.ok, false, "T5: network create failure is red");
  assert.equal(networkResult.reason, "create-network-error", "T5: network reason is reported");
  assert.equal(network.calls.httpPost.length, 1, "T5: network case tries creation once");
  assert.equal(network.calls.escalate.length, 0, "T5: network case never escalates");

  const httpFailed = harness({
    httpPostResult: { status: 503, body: { id: "ignored" } },
  });
  const httpFailedResult = await raiseDecisionOnce(httpFailed.deps);

  assert.equal(httpFailedResult.ok, false, "T5: HTTP create failure is red");
  assert.equal(httpFailedResult.reason, "create-failed", "T5: HTTP failure reason is reported");
  assert.equal(httpFailedResult.status, 503, "T5: HTTP failure carries status");
  assert.equal(httpFailed.calls.httpPost.length, 1, "T5: HTTP case tries creation once");
  assert.equal(httpFailed.calls.escalate.length, 0, "T5: HTTP case never escalates");

  const noId = harness({
    httpPostResult: { status: 200, body: { identifier: "KOL-1000" } },
  });
  const noIdResult = await raiseDecisionOnce(noId.deps);

  assert.equal(noIdResult.ok, false, "T5: body without id is red");
  assert.equal(noIdResult.reason, "create-failed", "T5: no-id create reason is reported");
  assert.equal(noIdResult.status, 200, "T5: no-id create failure carries status");
  assert.equal(noId.calls.httpPost.length, 1, "T5: no-id case tries creation once");
  assert.equal(noId.calls.escalate.length, 0, "T5: no-id case never escalates");
  ok("T5: create network, HTTP, and no-id failures never call escalate");
}

async function t6_createdWithoutIdentifierIsARealFailureClass() {
  const { calls, deps } = harness({
    httpPostResult: { status: 201, body: { id: "issue-uuid-without-identifier" } },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, false, "T6: created without identifier is red");
  assert.equal(result.reason, "created-without-identifier", "T6: reason names identifier failure");
  assert.equal(result.id, "issue-uuid-without-identifier", "T6: result carries the UUID for diagnosis");
  assert.equal(calls.httpPost.length, 1, "T6: issue was created once");
  assert.equal(calls.escalate.length, 0, "T6: unreachable issue is not escalated");
  ok("T6: created issue with no identifier is reported and not escalated");
}

async function t7_escalationFailureReportsCreatedIdentifier() {
  const { calls, deps } = harness({
    escalateResult: { ok: false, reason: "brief comment rejected", escalated: false },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, false, "T7: escalation failure is red");
  assert.match(result.reason, /escalation-failed: brief comment rejected/, "T7: reason mentions escalation failure");
  assert.equal(result.identifier, "KOL-999", "T7: result still reports the created identifier");
  assert.equal(result.created, true, "T7: caller can see the issue exists");
  assert.equal(result.escalated, false, "T7: caller can see escalation did not complete");
  assert.equal(calls.httpPost.length, 1, "T7: issue creation happened once");
  assert.equal(calls.escalate.length, 1, "T7: escalation was attempted once");
  ok("T7: escalation failure keeps created identifier visible to callers");
}

async function t8_blankReasonFallsBackToBriefQuestionInCreateBody() {
  const expectedBrief = validBrief();
  const { calls, deps } = harness({
    deps: {
      title: "  Commission route decision  ",
      reason: "   ",
      brief: expectedBrief,
    },
  });

  const result = await raiseDecisionOnce(deps);

  assert.equal(result.ok, true, "T8: blank reason fallback still succeeds");
  assert.equal(calls.httpPost.length, 1, "T8: issue is created once");
  assert.deepEqual(
    calls.httpPost[0],
    {
      url: `${BASE}/api/companies/${COMPANY_ID}/issues`,
      body: {
        title: "Commission route decision",
        description: expectedBrief.pertanyaan,
      },
    },
    "T8: creation body uses pertanyaan as the exact blank-reason fallback",
  );
  assert.equal(calls.escalate[0].reason, expectedBrief.pertanyaan, "T8: escalation reason uses the same fallback");
  ok("T8: blank reason falls back to the brief question in the exact create body");
}

async function main() {
  const tests = [
    t1_pausedRefusesBeforeAnyWrite,
    t2_incompleteBriefRefusesBeforeAnyWrite,
    t3_happyPathCreatesThenEscalatesWithValidatedBrief,
    t4_noBaseAndMissingTitleAreZeroWriteRefusals,
    t5_createFailuresNeverEscalate,
    t6_createdWithoutIdentifierIsARealFailureClass,
    t7_escalationFailureReportsCreatedIdentifier,
    t8_blankReasonFallsBackToBriefQuestionInCreateBody,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
