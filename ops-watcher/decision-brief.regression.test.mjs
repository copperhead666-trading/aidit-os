// ops-watcher/decision-brief.regression.test.mjs
// Offline regression coverage for the decision brief gate. NO filesystem,
// NO network, NO Paperclip: every input is a literal object. Run with:
//   node ops-watcher/decision-brief.regression.test.mjs

import assert from "node:assert/strict";
import {
  DECISION_BRIEF_MARKER,
  MAX_OPTIONS,
  MIN_OPTIONS,
  buildDecisionBriefCommentBody,
  parseDecisionBriefFromComments,
  renderRefusal,
  validateDecisionBrief,
} from "./decision-brief.mjs";

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

function reasonText(result) {
  return (result.reasons || []).join("\n");
}

function assertRefused(result, message) {
  assert.equal(result.ok, false, message);
  assert.ok(Array.isArray(result.reasons), `${message}: reasons is an array`);
}

function parseBodyJson(body) {
  assert.ok(body.startsWith(`${DECISION_BRIEF_MARKER}\n`), "body starts with marker and newline");
  return JSON.parse(body.slice(DECISION_BRIEF_MARKER.length).trim());
}

async function t1_realWorldTopicShapeNamesMissingSlots() {
  const result = validateDecisionBrief({
    pertanyaan: "SJS HRD KPI commission rules need your input",
  });

  assertRefused(result, "T1: KOL-67 topic shape is refused");
  assert.deepEqual(
    result.missing,
    ["yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"],
    "T1: refusal names the four missing decision slots",
  );
  for (const slot of ["yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"]) {
    assert.ok(result.missing.includes(slot), `T1: missing names ${slot}`);
  }
  ok("T1: real-world KOL-67 topic shape is refused with the four missing slots named");
}

async function t2_completeBriefPassesAndTrimsEveryField() {
  const result = validateDecisionBrief({
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

  assert.equal(result.ok, true, "T2: complete brief passes");
  assert.deepEqual(result.brief, validBrief(), "T2: returned brief trims every field");
  ok("T2: a complete valid brief passes and every returned field is trimmed");
}

async function t3_substantiveTopicWithoutQuestionMarkIsRefused() {
  const result = validateDecisionBrief(validBrief({
    pertanyaan: "Anda perlu memilih aturan komisi bertingkat untuk kuartal ini",
  }));

  assertRefused(result, "T3: substantive topic without question mark is refused");
  assert.match(reasonText(result), /\?/, "T3: reason mentions the question-mark rule");
  ok("T3: a substantive topic that is not a question is refused with the question-mark rule");
}

async function t4_quoteWithoutSourceIsRefused() {
  const result = validateDecisionBrief(validBrief({
    yang_sudah_ada: [
      { kutipan: "Komisi saat ini masih flat tiga persen untuk semua tier." },
    ],
  }));

  assertRefused(result, "T4: quoted state with no source is refused");
  assert.match(reasonText(result), /sumber/, "T4: reason names the missing source");
  ok("T4: yang_sudah_ada with a quote but no sumber is refused");
}

async function t5_optionWithoutConsequenceAndDuplicateKeysAreRefused() {
  const missingConsequence = validateDecisionBrief(validBrief({
    pilihan: [
      { key: "tetap", label: "Tetap flat", konsekuensi: "Tidak ada perubahan sistem dan margin tetap seperti sekarang." },
      { key: "bertingkat", label: "Pakai tier" },
    ],
  }));
  const duplicateKeys = validateDecisionBrief(validBrief({
    pilihan: [
      { key: "tetap", label: "Tetap flat", konsekuensi: "Tidak ada perubahan sistem dan margin tetap seperti sekarang." },
      { key: "tetap", label: "Pakai tier", konsekuensi: "Butuh perubahan konfigurasi dan margin tier bawah membaik." },
    ],
    rekomendasi: {
      pilihan: "tetap",
      alasan: "Pilihan ini paling sederhana dijalankan sambil menjaga sistem tetap stabil.",
    },
  }));

  assertRefused(missingConsequence, "T5: option missing consequence is refused");
  assert.match(reasonText(missingConsequence), /label bukan pilihan/, "T5: reason says a label is not a choice");
  assertRefused(duplicateKeys, "T5: duplicate option keys are refused");
  assert.match(reasonText(duplicateKeys), /key "tetap" dobel/, "T5: reason names the duplicate key");
  ok("T5: options without consequences and duplicate option keys are refused");
}

async function t6_optionCountBoundsAreEnforced() {
  const tooFew = validateDecisionBrief(validBrief({
    pilihan: [
      { key: "tetap", label: "Tetap flat", konsekuensi: "Tidak ada perubahan sistem dan margin tetap seperti sekarang." },
    ],
    rekomendasi: {
      pilihan: "tetap",
      alasan: "Pilihan ini paling sederhana dijalankan sambil menjaga sistem tetap stabil.",
    },
  }));
  const tooMany = validateDecisionBrief(validBrief({
    pilihan: [
      { key: "a", label: "Opsi A", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
      { key: "b", label: "Opsi B", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
      { key: "c", label: "Opsi C", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
      { key: "d", label: "Opsi D", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
      { key: "e", label: "Opsi E", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
      { key: "f", label: "Opsi F", konsekuensi: "Perubahan ini memberi dampak operasional yang jelas." },
    ],
    rekomendasi: {
      pilihan: "a",
      alasan: "Pilihan ini paling sederhana dijalankan sambil menjaga sistem tetap stabil.",
    },
  }));

  assertRefused(tooFew, "T6: fewer than MIN_OPTIONS is refused");
  assert.ok(tooFew.missing.includes("pilihan"), "T6: too few options marks pilihan missing");
  assert.match(reasonText(tooFew), new RegExp(`${MIN_OPTIONS}-${MAX_OPTIONS}`), "T6: too few reason names bounds");
  assertRefused(tooMany, "T6: more than MAX_OPTIONS is refused");
  assert.match(reasonText(tooMany), new RegExp(`${MIN_OPTIONS}-${MAX_OPTIONS}`), "T6: too many reason names bounds");
  ok("T6: fewer than MIN_OPTIONS and more than MAX_OPTIONS are both refused");
}

async function t7_recommendationMustPointAtOfferedOption() {
  const result = validateDecisionBrief(validBrief({
    rekomendasi: {
      pilihan: "jalan-c",
      alasan: "Pilihan ini terlihat menarik tetapi tidak tersedia di daftar yang diberikan.",
    },
  }));

  assertRefused(result, "T7: recommendation pointing outside options is refused");
  assert.match(reasonText(result), /"jalan-c"/, "T7: reason quotes the bad key");
  ok("T7: a recommendation pointing at a non-option key is refused and quotes the bad key");
}

async function t8_recommendationNeedsReason() {
  const result = validateDecisionBrief(validBrief({
    rekomendasi: { pilihan: "bertingkat" },
  }));

  assertRefused(result, "T8: recommendation with no alasan is refused");
  assert.match(reasonText(result), /rekomendasi: tidak menyebut alasannya/, "T8: reason names the missing alasan");
  ok("T8: a recommendation with no alasan is refused");
}

async function t9_casualRegisterIsWordBounded() {
  const badDelay = validateDecisionBrief(validBrief({
    kalau_didiamkan: "Kalau lo menunda ini, komisi tetap terkunci untuk kuartal berjalan.",
  }));
  const badReason = validateDecisionBrief(validBrief({
    rekomendasi: {
      pilihan: "bertingkat",
      alasan: "Kamu perlu memilih ini karena dampak margin tier bawah paling jelas.",
    },
  }));
  const legitimateWords = validateDecisionBrief(validBrief({
    rekomendasi: {
      pilihan: "bertingkat",
      alasan: "Tim keluar dari gudang data dan meninjau lokasi transaksi untuk memastikan dampaknya.",
    },
    kalau_didiamkan: "Tim akan terus memelototi angka lama sampai keputusan komisi dikunci.",
  }));

  assertRefused(badDelay, "T9: casual register in kalau_didiamkan is refused");
  assert.match(reasonText(badDelay), /kalau_didiamkan/, "T9: refusal names the delay slot");
  assertRefused(badReason, "T9: casual register in rekomendasi.alasan is refused");
  assert.match(reasonText(badReason), /rekomendasi\.alasan/, "T9: refusal names the recommendation reason slot");
  assert.equal(legitimateWords.ok, true, "T9: legitimate words containing similar letter sequences are not falsely refused");
  ok("T9: casual register is refused in multiple slots and the guard is word-bounded");
}

async function t10_placeholdersAreRefusedEvenWhenNonEmpty() {
  const dash = validateDecisionBrief(validBrief({
    yang_sudah_ada: [
      { kutipan: "-", sumber: "ventures/sjs-superapps config/commission.json" },
    ],
  }));
  const tbd = validateDecisionBrief(validBrief({
    pertanyaan: "TBD",
  }));
  const belumAda = validateDecisionBrief(validBrief({
    kalau_didiamkan: "belum ada",
  }));

  assertRefused(dash, "T10: dash placeholder is refused");
  assert.match(reasonText(dash), /kutipan kosong/, "T10: dash is treated as empty content");
  assertRefused(tbd, "T10: TBD placeholder is refused");
  assert.ok(tbd.missing.includes("pertanyaan"), "T10: TBD marks pertanyaan missing");
  assertRefused(belumAda, "T10: belum ada placeholder is refused");
  assert.ok(belumAda.missing.includes("kalau_didiamkan"), "T10: belum ada marks kalau_didiamkan missing");
  ok("T10: placeholder values that pass a non-empty check are refused");
}

async function t11_commentBodyThrowsOnInvalidAndCarriesMarkerJson() {
  assert.throws(
    () => buildDecisionBriefCommentBody({ pertanyaan: "SJS HRD KPI commission rules need your input" }),
    TypeError,
    "T11: invalid brief throws TypeError",
  );

  const body = buildDecisionBriefCommentBody(validBrief());
  const parsed = parseBodyJson(body);
  assert.deepEqual(parsed, { decision_brief: validBrief() }, "T11: JSON payload is parseable and carries the trimmed brief");
  ok("T11: comment body throws on invalid brief and writes marker followed by parseable JSON");
}

async function t12_parseCommentsSkipsBadMarkersAndReturnsFirstValid() {
  assert.equal(parseDecisionBriefFromComments(null), null, "T12: non-array comments returns null");
  assert.equal(parseDecisionBriefFromComments([{ body: "ordinary comment" }]), null, "T12: no marker returns null");

  const newer = validBrief({
    pertanyaan: "Apakah Anda memilih rute keputusan yang lebih baru untuk kuartal ini?",
    rekomendasi: {
      pilihan: "tetap",
      alasan: "Rute terbaru menjaga keputusan tetap sempit dan bisa dijalankan hari ini.",
    },
  });
  const older = validBrief({
    pertanyaan: "Apakah Anda memilih rute keputusan lama untuk kuartal ini?",
  });
  const parsed = parseDecisionBriefFromComments([
    { body: `${DECISION_BRIEF_MARKER}\n{ malformed json` },
    { body: `${DECISION_BRIEF_MARKER}\n${JSON.stringify({ decision_brief: { pertanyaan: "topic only" } })}` },
    { body: buildDecisionBriefCommentBody(newer) },
    { body: buildDecisionBriefCommentBody(older) },
  ]);

  assert.deepEqual(parsed, validateDecisionBrief(newer).brief, "T12: malformed and invalid marker comments are skipped");
  assert.equal(parsed.pertanyaan, newer.pertanyaan, "T12: first valid comment wins over an older valid comment");
  ok("T12: parseDecisionBriefFromComments returns null for empty cases and the first valid marker in order");
}

async function t13_renderRefusalNamesMissingSlotsAndShowsJsonExample() {
  const result = validateDecisionBrief({});
  const rendered = renderRefusal(result);

  for (const slot of ["pertanyaan", "yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"]) {
    assert.match(rendered, new RegExp(slot), `T13: rendered refusal names ${slot}`);
  }
  const jsonStart = rendered.indexOf("{\n");
  assert.ok(jsonStart > 0, "T13: rendered refusal includes a JSON example");
  const example = JSON.parse(rendered.slice(jsonStart));
  assert.deepEqual(Object.keys(example), ["pertanyaan", "yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"], "T13: JSON example has every slot");
  ok("T13: renderRefusal names every missing slot and includes a JSON example");
}

async function main() {
  const tests = [
    t1_realWorldTopicShapeNamesMissingSlots,
    t2_completeBriefPassesAndTrimsEveryField,
    t3_substantiveTopicWithoutQuestionMarkIsRefused,
    t4_quoteWithoutSourceIsRefused,
    t5_optionWithoutConsequenceAndDuplicateKeysAreRefused,
    t6_optionCountBoundsAreEnforced,
    t7_recommendationMustPointAtOfferedOption,
    t8_recommendationNeedsReason,
    t9_casualRegisterIsWordBounded,
    t10_placeholdersAreRefusedEvenWhenNonEmpty,
    t11_commentBodyThrowsOnInvalidAndCarriesMarkerJson,
    t12_parseCommentsSkipsBadMarkersAndReturnsFirstValid,
    t13_renderRefusalNamesMissingSlotsAndShowsJsonExample,
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
