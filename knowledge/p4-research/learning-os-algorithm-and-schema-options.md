# P4 Research: Learning OS — Spaced-Repetition Algorithm & Progress Schema Options

**Scope**: Research and design-options only. No implementation decision is made here.  
**Source spec**: `handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md`, section 2 "Learning OS".  
**House-style references**: `config/decision-ledger.json`, `config/agent-registry.json`, `ops-watcher/ahmad-context-retrieval.mjs` (ContextBundle / Cognitive Core alignment).  
**Date**: 2026-08-30.

---

## Part 1 — Spaced-Repetition Algorithm Options

The spec explicitly requires spaced review, weak-area preferential review, and a progression from knowledge → case analysis → drafting/output → oral reasoning → full-matter simulation. Most classical spaced-repetition (SR) algorithms were designed for atomic flashcard recall, so the tradeoffs below are honest about how each maps (or does not map) to complex legal reasoning and output production.

### Option A — SM-2 (SuperMemo-2, used by Anki)

SM-2 is the interval-ease algorithm originally published by Piotr Woźniak for SuperMemo and later adopted by Anki. Each topic/card carries an ease factor (EF, typically starting at 2.5) and a current interval. After a review, the learner rates recall quality on a 0–5 scale. Correct responses increase the interval by `EF`; very good responses nudge EF up slightly; poor responses reduce EF; a failure resets the interval to a short value (often 1 day). Over time, well-remembered items grow exponentially longer intervals.

*Tradeoffs for Learning OS*:
- **Pros**: Very well understood, simple to implement, computationally cheap, proven over decades for declarative knowledge retention (e.g., remembering a rule from KUHPerdata).
- **Cons for case/drafting/oral work**: SM-2 expects discrete, quickly reviewable items. A "perikatan" case-analysis exercise or a contract-drafting output is not a single recall event; compressing it into one quality score throws away information about which sub-skills failed. It also has no built-in concept of prerequisite dependency, so a weak area in "unlawful act elements" and a weak area in "causal damages" look the same to the scheduler unless the implementation layers extra metadata on top.

### Option B — FSRS (Free Spaced Repetition Scheduler, used in modern Anki)

FSRS is a more recent scheduler now available in Anki. It models each item with latent variables roughly corresponding to difficulty, memory stability, and retrievability, and uses those variables to predict the probability of recall on any future day. It can be fitted to the user's actual review history, so intervals adapt to how difficult a specific learner finds a specific card. Reviews are scheduled at the point where predicted retrievability is about to drop below a target threshold.

*Tradeoffs for Learning OS*:
- **Pros**: Better handling of heterogeneous difficulty across cards; can capture that one learner forgets tort-law exceptions faster than contract-law basics. Mathematically more efficient than a fixed SM-2 curve once enough review history exists.
- **Cons for case/drafting/oral work**: FSRS is still card-centric and recall-centric. For an output/drafting assessment, the "review outcome" is a noisy, multi-dimensional judgment (rule accuracy, fact application, structure, language). Reducing that to a single grade fed into FSRS loses most of the diagnostic signal. It is also more complex to implement from scratch and needs a non-trivial amount of review data before its personalization beats a well-tuned SM-2; early in Civil Law Mastery there may not be enough history for the model to be meaningful.

### Option C — Leitner Box System

The Leitner system divides material into a small number of "boxes," each with its own review interval. An item is promoted to the next box after a correct recall and demoted to the first box after a failure. Box 1 is reviewed daily, Box 2 every few days, and so on. It is essentially a threshold-based, coarse-grained scheduler.

*Tradeoffs for Learning OS*:
- **Pros**: Extremely easy to explain, implement, and debug. Maps cleanly to a small number of explicit mastery states (e.g., "learning," "reviewing," "mastered"). Works well for simple factual recall and for systems where the owner wants to inspect and reason about the scheduler by hand.
- **Cons for case/drafting/oral work**: It is the least efficient of the three for long-term retention; intervals are not personalized and promotion is binary. For multi-stage mastery (UNDERSTAND → APPLY → PRODUCE), the Leitner box alone is too coarse unless each topic gets multiple box tracks (one per capability stage), which starts to look like a custom schema rather than a pure Leitner implementation.

---

## Part 2 — Progress Schema Options

The spec says the exact progress database/schema is **NOT YET DECIDED**: percentages, levels, XP, skill-tree nodes, or another metric are all still open. The schemas below follow this repository's conventions:
- `snake_case` keys.
- ISO 8601 timestamps.
- `schema_version`, `last_updated_at`, and provenance blocks.
- Arrays of records with stable `id`s and `status`/`confidence` fields.
- Alignment with the shared Cognitive Core (e.g., `canonical_pointers`, `source_claims`, and `gbrain_slug` references) rather than a second independent memory system.

Example topic used throughout: **Perikatan / Obligations** from Civil Law Mastery.

---

### Schema Option 1 — Flat Topic Records with Stage Percentages

A simple, table-like record per topic. Each topic holds a mastery percentage for each capability stage (understand, apply, produce, etc.), plus weak-area flags and next-review timestamps.

```json
{
  "schema_version": "0.1.0",
  "scope": "FounderOS-Aidit Learning OS progress snapshot",
  "last_updated_at": "2026-08-30T07:30:00+07:00",
  "source_spec": "handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md",
  "records": [
    {
      "id": "civillaw.perikatan.obligations",
      "topic": "Perikatan / Obligations",
      "domain": "civil_law",
      "status": "active",
      "mastery": {
        "understand": 0.72,
        "apply": 0.45,
        "produce": 0.20,
        "oral_reasoning": 0.00,
        "full_matter_sim": 0.00
      },
      "weak_areas": [
        {
          "skill": "apply",
          "sub_topic": "elements_of_obligation",
          "detected_at": "2026-08-28T09:15:00+07:00",
          "evidence": "case_analysis_2026-08-28_perikatan_03"
        }
      ],
      "reviews": {
        "algorithm": "sm2",
        "last_reviewed_at": "2026-08-28T09:15:00+07:00",
        "next_review_at": "2026-08-31T07:00:00+07:00",
        "interval_days": 3,
        "ease_factor": 2.36
      },
      "canonical_pointers": [
        "knowledge/civil-law/perikatan-obligations-overview.md",
        "knowledge/civil-law/cases/perikatan-case-03.md"
      ],
      "provenance": {
        "created_by": "learning_os_scheduler",
        "created_at": "2026-08-25T08:00:00+07:00",
        "updated_by": "learning_os_scheduler",
        "updated_at": "2026-08-30T07:30:00+07:00"
      }
    }
  ]
}
```

*Tradeoffs*:
- **Pros**: Easy to query, easy to render in a dashboard, maps directly to "what percent mastered am I?" questions.
- **Cons**: Percentages can be misleadingly precise; does not express prerequisite relationships (e.g., you cannot master "wanprestasi" before understanding "perikatan"); weak-area flags are separate from the mastery numbers, so drift between the two is possible.

---

### Schema Option 2 — Skill-Tree Node Graph

Topics are nodes in a directed graph. Edges represent prerequisites or capability-stage progression. Each node has a level/state rather than a continuous percentage, and advancement is gated by evidence.

```json
{
  "schema_version": "0.1.0",
  "scope": "FounderOS-Aidit Learning OS progress snapshot",
  "last_updated_at": "2026-08-30T07:30:00+07:00",
  "source_spec": "handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md",
  "nodes": [
    {
      "id": "civillaw.perikatan.obligations",
      "label": "Perikatan / Obligations",
      "domain": "civil_law",
      "status": "active",
      "level": "apply_in_progress",
      "allowed_levels": ["locked", "exposed", "understand", "apply_in_progress", "apply_mastered", "produce_in_progress", "produce_mastered", "oral_ready", "simulation_ready"],
      "capability_evidence": {
        "understand": {
          "status": "passed",
          "assessment_id": "quiz_perikatan_2026-08-25",
          "passed_at": "2026-08-25T08:30:00+07:00"
        },
        "apply": {
          "status": "needs_remediation",
          "assessment_id": "case_perikatan_2026-08-28",
          "passed_at": null,
          "weak_area_refs": ["civillaw.perikatan.obligations.elements"]
        },
        "produce": { "status": "not_started" }
      },
      "reviews": {
        "next_review_at": "2026-08-31T07:00:00+07:00",
        "review_history": [
          { "assessment_id": "quiz_perikatan_2026-08-25", "result": "pass", "at": "2026-08-25T08:30:00+07:00" },
          { "assessment_id": "case_perikatan_2026-08-28", "result": "weak", "at": "2026-08-28T09:15:00+07:00" }
        ]
      },
      "canonical_pointers": [
        "knowledge/civil-law/perikatan-obligations-overview.md",
        "knowledge/civil-law/cases/perikatan-case-03.md"
      ],
      "provenance": {
        "created_at": "2026-08-25T08:00:00+07:00",
        "updated_at": "2026-08-30T07:30:00+07:00"
      }
    },
    {
      "id": "civillaw.perikatan.obligations.elements",
      "label": "Elements of an Obligation",
      "domain": "civil_law",
      "status": "weak_area",
      "level": "understand",
      "parents": ["civillaw.perikatan.obligations"],
      "reviews": { "next_review_at": "2026-08-30T20:00:00+07:00" },
      "canonical_pointers": ["knowledge/civil-law/perikatan-elements.md"],
      "provenance": { "created_at": "2026-08-28T09:20:00+07:00", "updated_at": "2026-08-28T09:20:00+07:00" }
    }
  ],
  "edges": [
    { "from": "civillaw.perikatan.obligations.elements", "to": "civillaw.perikatan.obligations", "relation": "sub_topic_of" },
    { "from": "civillaw.perikatan.obligations", "to": "civillaw.wanprestasi.breach_of_contract", "relation": "prerequisite_for" }
  ]
}
```

*Tradeoffs*:
- **Pros**: Naturally models the spec's progression from knowledge → case analysis → drafting → oral reasoning → simulation as node levels. Edges express prerequisites and weak-area sub-topics explicitly. Fits well with Graphify/Cognitive Core graph concepts already used in this repo.
- **Cons**: More complex to query and maintain; level definitions must be designed carefully or they become arbitrary; demoting a prerequisite can have cascading effects on downstream nodes.

---

### Schema Option 3 — XP/Level Hybrid with Capability Stages

Combines a lightweight XP/level surface with per-stage completion flags. XP is gained only from demonstrated output, preventing time-based grind. Levels are coarse; the detailed state is in the capability-stage flags and review schedule.

```json
{
  "schema_version": "0.1.0",
  "scope": "FounderOS-Aidit Learning OS progress snapshot",
  "last_updated_at": "2026-08-30T07:30:00+07:00",
  "source_spec": "handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md",
  "records": [
    {
      "id": "civillaw.perikatan.obligations",
      "topic": "Perikatan / Obligations",
      "domain": "civil_law",
      "status": "active",
      "summary": {
        "level": 3,
        "level_label": "Apply - In Progress",
        "total_xp": 145,
        "xp_to_next_level": 55
      },
      "stages": [
        {
          "stage": "understand",
          "state": "completed",
          "xp_earned": 60,
          "completed_at": "2026-08-25T08:30:00+07:00",
          "assessment_ref": "quiz_perikatan_2026-08-25"
        },
        {
          "stage": "apply",
          "state": "needs_review",
          "xp_earned": 35,
          "attempts": 2,
          "last_attempt_at": "2026-08-28T09:15:00+07:00",
          "weak_area_refs": ["civillaw.perikatan.obligations.elements"]
        },
        {
          "stage": "produce",
          "state": "locked",
          "unlocks_when": ["apply:completed"]
        },
        {
          "stage": "oral_reasoning",
          "state": "locked"
        },
        {
          "stage": "full_matter_sim",
          "state": "locked"
        }
      ],
      "reviews": {
        "algorithm": "sm2",
        "next_review_at": "2026-08-31T07:00:00+07:00",
        "priority": "weak_area_first"
      },
      "boss_assessments": [
        { "type": "biweekly", "due_at": "2026-09-12T07:00:00+07:00", "status": "scheduled" }
      ],
      "canonical_pointers": [
        "knowledge/civil-law/perikatan-obligations-overview.md",
        "knowledge/civil-law/cases/perikatan-case-03.md"
      ],
      "provenance": {
        "created_at": "2026-08-25T08:00:00+07:00",
        "updated_at": "2026-08-30T07:30:00+07:00"
      }
    }
  ]
}
```

*Tradeoffs*:
- **Pros**: Levels and XP give an intuitive learner-facing progress metric while keeping the underlying state in explicit stage flags. "XP only for demonstrated output" aligns with the spec's mastery-based (not time-based) progress model.
- **Cons**: XP amounts and level thresholds are arbitrary unless calibrated against real assessments; can create a false sense of precision; still needs a separate mechanism to represent prerequisites and weak-area sub-topics.

---

## Confidence Note

The descriptions of **SM-2** and the **Leitner box system** are high-confidence; both are well-documented, widely implemented, and I am comfortable with the mechanics described. The description of **FSRS** is high-level and based on published overviews of the scheduler; I am less confident about the exact parameterization, loss function, and version-specific details, so an implementation worker should consult the current FSRS reference documentation before building against it. The schema options are design proposals, not factual claims, and are intentionally shaped to match this repository's existing conventions.
