// ops-watcher/decision-brief.mjs
//
// The contract an escalation has to satisfy before it is allowed to interrupt
// the owner.
//
// THE DEFECT THIS EXISTS TO CLOSE. The cockpit renders a decision record with
// eight slots and five of them are empty for most cases, because nothing
// upstream ever wrote them. KOL-67 is the standing example: "SJS HRD KPI
// commission rules need your input" names a TOPIC. It never says what the rules
// currently are, what the choices are, which one is recommended and why, or what
// it costs to wait. An owner cannot decide any of that; he can only ask the
// questions the escalation should already have answered. So the cockpit shows
// "Belum ada rekomendasi tertulis untuk perkara ini" — honest, and still a gap.
//
// The fix is not a better prompt. A prompt is a request; this is a gate.
// ahmad-escalate.mjs refuses an escalation whose brief does not validate, and
// the reasons it refuses with are the missing slots by name.
//
// STORAGE follows the convention telegram-decision-options.mjs had to learn the
// hard way: Paperclip's issue schema has no free-form field, and comment
// `metadata` is strictly schema-validated. The only place structured data
// survives a real round trip is a comment BODY behind a marker. So a brief is a
// marker line plus one JSON object, exactly like [DECISION OPTIONS].
//
// LANGUAGE. Owner-facing text is Indonesian and formal — the owner is "Anda".
// This module enforces that, because a register slip is not cosmetic here: the
// cockpit reproduces source data verbatim and never translates it, so whatever
// is written at escalation time is what the owner reads.

export const DECISION_BRIEF_MARKER = "[DECISION BRIEF]";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;

/** The five slots that were empty, named so a refusal can name them. */
export const REQUIRED_SLOTS = Object.freeze([
  "pertanyaan",
  "yang_sudah_ada",
  "pilihan",
  "rekomendasi",
  "kalau_didiamkan",
]);

// Placeholders that pass a non-empty check and carry nothing. Every one of
// these has been seen standing in for real content somewhere in this repo's
// history, which is why the list is literal rather than a length heuristic.
const EMPTY_IN_DISGUISE = new Set([
  "-", "--", "n/a", "na", "tbd", "tba", "?", "...", "belum ada", "belum tahu",
  "tidak ada", "none", "unknown", "todo", "xxx",
]);

// Casual second person. The cockpit addresses the owner as "Anda"; an
// escalation written in street register reaches him verbatim.
const CASUAL_REGISTER = /(^|\s)(lo|lu|gua|gue|elo|kamu)(\s|[.,!?]|$)/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isSubstantive(value, minWords = 3) {
  const s = text(value);
  if (!s) return false;
  if (EMPTY_IN_DISGUISE.has(s.toLowerCase())) return false;
  return s.split(/\s+/).filter(Boolean).length >= minWords;
}

function registerProblem(value, where) {
  return CASUAL_REGISTER.test(text(value))
    ? `${where}: ditulis dengan sapaan santai — pemilik disapa "Anda"`
    : null;
}

/**
 * Validate a brief. Returns { ok, brief } or { ok:false, missing[], reasons[] }.
 *
 * `missing` names the slots by their own names, because the caller is headless
 * AHMAD and a refusal it cannot act on is a refusal that will be retried
 * verbatim forever.
 */
export function validateDecisionBrief(input) {
  const missing = [];
  const reasons = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, missing: [...REQUIRED_SLOTS], reasons: ["brief bukan objek"] };
  }

  // 1. THE QUESTION. It must be a question the owner can answer by choosing,
  // not a subject line. A topic ends the sentence; a decision ends it with "?".
  const pertanyaan = text(input.pertanyaan);
  if (!isSubstantive(pertanyaan, 4)) {
    missing.push("pertanyaan");
    reasons.push("pertanyaan: kosong atau terlalu pendek untuk sebuah keputusan");
  } else if (!pertanyaan.endsWith("?")) {
    reasons.push('pertanyaan: bukan pertanyaan — sebuah topik bukan keputusan, tutup dengan "?"');
  }

  // 2. WHAT ALREADY EXISTS, and where it was read. A claim about the world with
  // no source is the thing that makes an owner go and check for himself, which
  // is the work the escalation was supposed to have done.
  const sudah = Array.isArray(input.yang_sudah_ada) ? input.yang_sudah_ada : [];
  if (sudah.length === 0) {
    missing.push("yang_sudah_ada");
    reasons.push("yang_sudah_ada: tidak ada satu pun keadaan sekarang yang dikutip");
  } else {
    sudah.forEach((row, i) => {
      if (!row || typeof row !== "object") {
        reasons.push(`yang_sudah_ada[${i}]: bukan objek`);
        return;
      }
      if (!isSubstantive(row.kutipan, 3)) reasons.push(`yang_sudah_ada[${i}]: kutipan kosong`);
      if (!text(row.sumber)) {
        reasons.push(`yang_sudah_ada[${i}]: tidak menyebut sumbernya (berkas, commit, atau tautan)`);
      }
    });
  }

  // 3. THE OPTIONS, each with what follows from it. An option without a
  // consequence is a label, and a list of labels is not a choice.
  const pilihan = Array.isArray(input.pilihan) ? input.pilihan : [];
  if (pilihan.length < MIN_OPTIONS) {
    missing.push("pilihan");
    reasons.push(`pilihan: butuh ${MIN_OPTIONS}-${MAX_OPTIONS} pilihan, ada ${pilihan.length}`);
  } else if (pilihan.length > MAX_OPTIONS) {
    reasons.push(`pilihan: butuh ${MIN_OPTIONS}-${MAX_OPTIONS} pilihan, ada ${pilihan.length}`);
  }
  const keys = new Set();
  pilihan.forEach((opt, i) => {
    if (!opt || typeof opt !== "object") {
      reasons.push(`pilihan[${i}]: bukan objek`);
      return;
    }
    const key = text(opt.key);
    if (!key) reasons.push(`pilihan[${i}]: tidak punya key`);
    else if (keys.has(key)) reasons.push(`pilihan[${i}]: key "${key}" dobel`);
    else keys.add(key);
    if (!isSubstantive(opt.label, 1)) reasons.push(`pilihan[${i}]: label kosong`);
    if (!isSubstantive(opt.konsekuensi, 3)) {
      reasons.push(`pilihan[${i}]: tidak menyebut akibatnya — sebuah label bukan pilihan`);
    }
  });

  // 4. THE RECOMMENDATION. It must point at one of the options offered, and it
  // must say why. A recommendation for something not on the list is a sixth
  // option smuggled in without its consequence.
  const rek = input.rekomendasi;
  if (!rek || typeof rek !== "object") {
    missing.push("rekomendasi");
    reasons.push("rekomendasi: tidak ada — jika memang tidak ada dasarnya, katakan itu di alasan");
  } else {
    const pick = text(rek.pilihan);
    if (!pick) reasons.push("rekomendasi: tidak menunjuk pilihan mana pun");
    else if (keys.size > 0 && !keys.has(pick)) {
      reasons.push(`rekomendasi: menunjuk "${pick}" yang tidak ada di daftar pilihan`);
    }
    if (!isSubstantive(rek.alasan, 5)) {
      reasons.push("rekomendasi: tidak menyebut alasannya");
    }
  }

  // 5. THE COST OF DOING NOTHING. Waiting is itself a choice and it has a price.
  if (!isSubstantive(input.kalau_didiamkan, 4)) {
    missing.push("kalau_didiamkan");
    reasons.push("kalau_didiamkan: tidak menyebut akibat kalau keputusan ini ditunda");
  }

  // Register, across every owner-facing string in the brief.
  const registerTargets = [
    [input.pertanyaan, "pertanyaan"],
    [input.kalau_didiamkan, "kalau_didiamkan"],
    [rek && rek.alasan, "rekomendasi.alasan"],
    ...pilihan.map((o, i) => [o && o.konsekuensi, `pilihan[${i}].konsekuensi`]),
  ];
  for (const [value, where] of registerTargets) {
    const problem = registerProblem(value, where);
    if (problem) reasons.push(problem);
  }

  if (missing.length > 0 || reasons.length > 0) {
    return { ok: false, missing, reasons };
  }

  return {
    ok: true,
    brief: {
      pertanyaan,
      yang_sudah_ada: sudah.map((r) => ({ kutipan: text(r.kutipan), sumber: text(r.sumber) })),
      pilihan: pilihan.map((o) => ({
        key: text(o.key),
        label: text(o.label),
        konsekuensi: text(o.konsekuensi),
      })),
      rekomendasi: { pilihan: text(rek.pilihan), alasan: text(rek.alasan) },
      kalau_didiamkan: text(input.kalau_didiamkan),
    },
  };
}

/**
 * The comment body to POST. Throws on an invalid brief: reaching here with one
 * is the caller's bug, not a runtime condition to degrade around.
 */
export function buildDecisionBriefCommentBody(input) {
  const v = validateDecisionBrief(input);
  if (!v.ok) {
    throw new TypeError(`invalid decision brief: ${[...v.missing, ...v.reasons].join("; ")}`);
  }
  return `${DECISION_BRIEF_MARKER}\n${JSON.stringify({ decision_brief: v.brief })}`;
}

/**
 * Read the NEWEST valid brief off an issue's comments.
 *
 * Newest-first is not an assumption here: Paperclip's comments endpoint returns
 * newest first, and a previous session read the wrong plan and the wrong
 * approval by assuming otherwise. So this scans in the order given and takes the
 * first match, and callers that hold oldest-first comments must reverse before
 * calling.
 */
export function parseDecisionBriefFromComments(comments) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    const body = typeof c?.body === "string" ? c.body : "";
    if (!body.trimStart().startsWith(DECISION_BRIEF_MARKER)) continue;
    const json = body.slice(body.indexOf(DECISION_BRIEF_MARKER) + DECISION_BRIEF_MARKER.length).trim();
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const v = validateDecisionBrief(parsed && parsed.decision_brief);
    if (v.ok) return v.brief;
  }
  return null;
}

/**
 * A refusal AHMAD can act on. Names the slots it is missing and shows the shape
 * it must send, because a refusal that only says "invalid" is retried verbatim.
 */
export function renderRefusal(result) {
  const lines = ["ESCALATION REFUSED — the brief is incomplete."];
  if (result.missing?.length) lines.push(`Missing slots: ${result.missing.join(", ")}`);
  for (const r of result.reasons || []) lines.push(`  - ${r}`);
  lines.push("");
  lines.push("A brief must carry all five slots. Owner-facing text is Indonesian, formal, addressing him as \"Anda\":");
  lines.push(JSON.stringify({
    pertanyaan: "Aturan komisi mana yang dipakai untuk kuartal ini?",
    yang_sudah_ada: [{ kutipan: "Komisi masih 3% flat di semua tier.", sumber: "ventures/sjs-superapps commit 4f2a1c9, config/commission.json" }],
    pilihan: [
      { key: "tetap", label: "Tetap 3% flat", konsekuensi: "Tidak ada perubahan sistem, margin tetap seperti sekarang." },
      { key: "bertingkat", label: "Bertingkat 2-5%", konsekuensi: "Butuh perubahan config dan satu rilis; margin naik di tier bawah." },
    ],
    rekomendasi: { pilihan: "bertingkat", alasan: "Tier bawah menyumbang 60% transaksi tetapi margin terkecil, jadi perubahan di situ paling besar dampaknya." },
    kalau_didiamkan: "Komisi kuartal ini terkunci di angka lama dan tidak bisa diubah surut.",
  }, null, 2));
  return lines.join("\n");
}
