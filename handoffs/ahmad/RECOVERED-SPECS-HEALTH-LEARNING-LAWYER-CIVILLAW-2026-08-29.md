# Recovered Specs: Health OS, Learning OS, Lawyer Copilot, Civil Law Mastery

**Source**: OWNER-recovered from prior OWNER/ChatGPT conversation history, reconciled against the later FounderOS backlog summaries (`handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json` items PROD-04/PROD-05/PROD-06/PROD-07, all previously classified `NEEDS_RECOVERY` with "no current canonical docs or modules found"). Delivered to AHMAD verbatim on 2026-08-29 via a structured extraction prompt AHMAD wrote for the OWNER to run against ChatGPT.

**Recovery method stated by the OWNER**: "Where an older direct discussion contains a concrete decision that a later handoff merely failed to recover, I preserve the older decision. I am not upgrading proposals into decisions."

**Canonical boundary rule (OWNER's own words, binding)**: "This is the recoverable specification boundary I would treat as canonical: the material above marked as decided can safely be handed to FounderOS as recovered requirements; every NOT YET DECIDED item should remain an explicit design gap rather than be filled by AHMAD or an implementation worker autonomously."

This means: everything under a **Decided** heading below is real, usable requirements input. Everything under **NOT YET DECIDED** is an open design gap — AHMAD, HATTA, SJAHRIR, or CORLEONE must never fill these in autonomously. If implementation work on any of these four modules starts, a NOT YET DECIDED item blocking that work must go back to the OWNER as an explicit question, not get silently decided by whichever agent is building it.

**Status as of this entry**: specs recovered and persisted. No implementation work has started on any of the four modules. See `config/agent-registry.json`'s P4 tracking entry for how this changes PROD-04/05/06/07's backlog classification.

---

## 1. Health OS

### Decided

**Core domains covered:**
- Sleep and recovery.
- Physical activity and gym/training.
- General activity/steps and recovery trends.
- Screen/sedentary load.
- Smoking tracking and adaptive smoking reduction.
- General health trend detection / Health Trend Engine.
- The broader concept was also discussed as Adaptive Life OS / Adaptive Work-Life Harmonic — health signals were intended to influence daily workload and schedule decisions rather than live in an isolated health tracker.

**Data sources / inputs:**
- Huawei Watch Fit 5 explicitly selected as primary wearable input.
- Intended wearable signals: sleep, heart rate / resting heart rate, activity, steps, training, recovery trends.
- Wearable data must not blindly override subjective condition.
- Manual subjective morning check-in: Energy, Mood, Focus, Body condition, rated 1–5, intended to take ~10–20 seconds.
- Other contextual inputs: calendar, FounderOS workload/task queue, gym schedule, screen/activity info, current sleep/recovery, schedule/anchor violations, emergencies/exceptional circumstances.
- Smoking tracker inputs: fast/frictionless smoking logs, triggers, craving, substitution attempts/behavior, lapses.

**Routines and reminder logic:**
- Main adaptation loop happens in the morning after waking, combining latest sleep/recovery data, wearable data, the Energy/Mood/Focus/Body check-in, calendar, workload, and other current constraints to finalize the day's adaptive schedule.
- Normal case: one short morning check-in only; additional prompts only when wearable or schedule data shows a meaningful anomaly.
- Daily operating mode selected using a weighted combination of subjective state and Huawei data: **NORMAL**, **LOW-ENERGY**, **EMERGENCY**.
  - LOW-ENERGY: reduce/narrow work to ~2–3 highest-value items; allow lower-priority work to move/reorder/shorten/reschedule.
  - EMERGENCY: prioritize basic needs and recovery; avoid creating artificial "catch-up debt."
- Protected anchors must not simply be optimized away: sleep/recovery, relationship/family time, long-term learning, leisure/hobbies.
- Smoking reduction logic: establish baseline, adaptive reduction (not rigid punishment), smoke-free windows, capture triggers/cravings, substitution support, lapse recovery (not treating one lapse as total failure). Any actual quit-date requires explicit OWNER confirmation.

**Dashboards / views:**
- A Health Trend Engine was part of the desired capability.
- Health feeds the broader FounderOS owner experience rather than becoming an isolated OS.

**Privacy and automation boundaries:**
- Health data explicitly treated as sensitive; avoid health over-automation.
- Medical-support behavior must stay within appropriate safety boundaries.
- Wearable assistants for different people must maintain strict privacy separation; information crosses those boundaries only when explicitly permitted.
- Autonomy ladder: Ask → Ask + Predict → Recommend → Act + Notify → Trusted Autonomy. Low-risk behavior can gradually gain autonomy. Medium-risk actions require asking. **High-risk actions must never automatically graduate into autonomous execution and always require explicit approval.**
- A smoking quit-date cannot be selected autonomously — requires explicit confirmation.
- Health OS may adapt scheduling, but protected human-time anchors cannot be sacrificed to maximize productivity.

**Architecture/storage/integration:**
- Do NOT build a separate Health OS/Life OS. Health/Life exists as a capability inside FounderOS, with AHMAD as the single logical orchestrator.
- Do not build from zero if an appropriate free/open-source donor exists — find/fork/adapt an OSS foundation and integrate it.
- Connects to broader FounderOS services (calendar/goals, Cognitive Core decision infrastructure) rather than duplicating them.
- Historical backlog dependencies referenced: FOS-14/FOS-15, calendar/goals integration.

### NOT YET DECIDED
- Nutrition tracking.
- Medical-record management.
- A dedicated mental-health module or mental-health records (mood is in the daily check-in, but that's not a designed mental-health system).
- Specific third-party health apps beyond the Huawei wearable.
- Exact Huawei data-ingestion/API mechanism.
- Medical-provider or laboratory integrations.
- Exact reminder times other than the morning loop.
- Exact numeric thresholds that trigger LOW-ENERGY or EMERGENCY.
- Exact smoking reduction percentages/cadence.
- Canonical Health OS dashboard design; exact charts/cards/KPI layout/trend periods/mobile dashboard.
- Dedicated smoking dashboard.
- Whether a broader Notion/Obsidian-style cockpit (discussed elsewhere) is the canonical Health OS dashboard — no decision found that it is.
- Formal field-by-field health-data sharing policy.
- Retention periods or deletion policy for health data.
- Whether any health data may leave local infrastructure for third-party AI processing.
- Canonical Health OS storage schema/database.
- Exact wearable ingestion implementation.
- Exact OSS donor repository.

---

## 2. Learning OS

### Decided

**Curriculum / subject areas:**
- Conceived as a general structured long-term learning capability, not one fixed course.
- Learning philosophy: adaptive, mastery-based, case-based where applicable, output-based, progressive difficulty, weak-area driven, spaced review.
- Civil law is a concrete downstream learning domain, also formalized separately as Civil Law Mastery.

**Workflow:**
- Learning must produce capability, not passive notes.
- Recurring conceptual loop: **UNDERSTAND → APPLY → PRODUCE**.
- Assessment/learning complexity advances adaptively through: knowledge → case analysis → drafting/output → oral reasoning → eventually full-matter/full-case simulation. Advanced simulations not forced prematurely — progression depends on demonstrated ability.
- AI vs. user control: ~70% AI-directed next-step selection, ~30% user override.
- Note: the specific "20 min Understand + 20 min Apply + 20 min Produce" format belongs to the Civil Law Mastery discussion specifically, not established as mandatory for every Learning OS course.

**Progress model:**
- Based on demonstrated mastery, not course completion or time spent.
- Weak-area detection influences what comes next; difficulty increases progressively based on demonstrated capability.
- Assessment stack: quiz/knowledge assessment, case assessment, output/drafting assessment, oral reasoning, full-case/full-matter simulation at higher maturity.

**Memory integration:**
- Existing knowledge-architecture history: old G-Brain was a legacy/stub concept, not a functioning production CLI; an earlier Ollama/nomic-embed-text direction was abandoned; the documented production knowledge/retrieval direction became ZeroEntropy embeddings + Supabase vector storage; a local Markdown knowledge-store skeleton also exists; `memory-archive/` is curated Markdown and should be migrated selectively, not bulk-dumped.
- Learning OS should align with the shared Cognitive Core / knowledge infrastructure rather than build a second independent memory brain.

**Review cadence:**
- Spaced review explicitly required; weak areas revisited preferentially; review/difficulty adapts to demonstrated ability.
- A comprehensive "boss" assessment established at approximately every two weeks.

**Interfaces:**
- Adaptive interaction — AI drives most next-study decisions while preserving ~30% user override.
- Simple, fast, low-maintenance experience.
- Learning is protected human time in the broader FounderOS scheduling model.
- Notion does not need to be the Learning OS's central system.
- Open-source foundations and dashboard/app concepts were explored.

### NOT YET DECIDED
- A canonical multi-subject Learning OS curriculum; which non-law subjects belong in the initial release.
- One universal duration/session template for every subject.
- Canonical mastery score formula; mastery thresholds for advancing or falling back.
- Exact progress database/schema; whether progress is percentages, levels, XP, skill-tree nodes, or another metric.
- Exact Learning OS → GBrain/knowledge-store write policy; what learning artifacts become long-term memory automatically; promotion criteria from session notes → durable knowledge; how contradictions/versioning between learned material and existing knowledge are resolved.
- Exact spaced-repetition algorithm. (FSRS was discussed/proposed in an implementation concept, but not enough evidence it was finalized as canonical.)
- Exact daily/weekly review quotas or intervals.
- Canonical daily UI; whether the primary interface is Telegram, web app, native app, dashboard, Obsidian, or another surface.
- OpenTutor or any other specific donor as the final implementation.

---

## 3. Lawyer Copilot

### Decided

**Use cases / operating pattern:**
- Client meeting ingestion; voice-note ingestion/processing; transcript → structured matter understanding.
- Fact extraction / fact map; legal issue spotting; detection of missing facts; identification of missing/needed evidence or documents.
- Legal research; matter/action mapping; recommended next actions.
- Drafting and review assistance; litigation workflow support; hearing preparation/support; non-litigation matter workflows; timeline/deadline support.
- Operating pattern: **meeting/transcript → facts → issues → missing facts → evidence needed → research → matter map → next actions → drafts → litigation/hearing/non-litigation support.**
- Intended eventually as a commercial product for lawyers/law firms. May have web/desktop/mobile surfaces (platform architecture not finalized). Should begin as an internal alpha before commercialization.

**Source standards:**
- Authoritative-source provenance is mandatory. Legal reasoning must not be presented as an unsupported model assertion.
- A conceptual legal knowledge chain was discussed elsewhere (Doctrine → Statute → Jurisprudence → Case Pattern → Legal Strategy → Draft → Checklist) but there isn't enough evidence to treat this as the finalized source hierarchy — flagged as NOT YET DECIDED below despite being discussed.

**Document workflows:**
- Confirmed matter workflow (10 steps): ingest → extract facts → identify legal issues → identify missing facts → determine evidence/documents needed → research relevant law → construct matter map → identify next actions → assist with drafts/review → support litigation/hearing/non-litigation workflow.
- Confidentiality and matter/client isolation required.
- Commercial-product concerns: separate customer accounts, permissions, matter/client isolation, confidentiality, auditability, licensing concerns.

**Provenance/citation:**
- Provenance and auditability mandatory. Legal research/results must remain traceable to authoritative sources. Must be possible to distinguish source-backed legal material from AI synthesis.

**Escalation boundaries:**
- Final legal decisions remain human decisions. Provides leverage/decision support, never silently substitutes for the responsible human professional.
- No autonomous legal commitment. No autonomous filing. Important legal actions/commitments always require explicit human/OWNER approval.
- Confidentiality and permissions must be respected at matter/client level.
- Model confidence never becomes authority to cross a legal commitment boundary.

### NOT YET DECIDED
- **Jurisdiction(s) in scope.** Indonesian civil law was selected for the Civil Law Mastery *learning* track, but there's no sufficiently explicit decision that Lawyer Copilot's *commercial* jurisdiction is therefore limited to Indonesia — this matters because Lawyer Copilot was envisioned as an independent commercial product.
- Exact jurisdiction-specific authoritative source list; required statute/regulation databases; treatment of jurisprudence/Supreme Court decisions; approved doctrine/textbook corpus; source ranking when authorities conflict.
- Canonical document state machine; exact approval stages between first draft, reviewed draft, final document, external delivery; canonical document formats/templates.
- Exact citation style/format; whether inline, footnotes, side-panel provenance, or multiple representations; exact metadata required per proposition/source.
- A complete escalation matrix by risk class; exactly which work products require review by a licensed lawyer vs. another authorized human before use; autonomous deadline/calendar actions vs. recommendation-only behavior.

---

## 4. Civil Law Mastery

### Decided

**Target jurisdiction:**
- Indonesia — explicitly accepted starting point: KUHPerdata / Indonesian civil-law doctrine and practice. Narrower eventual specialization NOT YET DECIDED.

**Curriculum:**
- Explicitly accepted foundation topics: KUHPerdata; perikatan/obligations; perjanjian/contracts; wanprestasi/breach of contract; perbuatan melawan hukum (PMH)/tort; pembuktian/evidence; core foundational civil-law concepts.
- Combines theory, real judgments/cases, drafting, review. Progresses from foundational knowledge toward increasingly realistic legal work.

**Learning objectives:**
- Become genuinely strong in Indonesian civil law, not merely memorize material. Builds toward becoming a civil-law specialist lawyer (narrower specialization undecided).
- Produce usable capability: understand doctrine/rules → apply to facts → reason through cases → produce legal outputs/drafts → eventually reason orally → ultimately handle realistic full-matter simulations.
- System should expose and remediate weak areas. Difficulty rises with demonstrated mastery, not a rigid calendar. Every study cycle produces an output, not just passive reading/notes.

**Source corpus:**
- Explicitly named: KUHPerdata. Explicitly required categories: theory/doctrine, real judgments/cases. Real case decisions are part of the learning process, not just textbook examples.

**Assessment model:**
- Daily learning pattern: **20 min Understand → 20 min Apply → 20 min Produce** (evolved from an earlier theory/case/notes idea).
- Adaptive learning required: AI determines ~70% of next learning direction, ~30% user override.
- Mastery model includes weak-area detection, spaced review, progressive difficulty, output-based assessment.
- Assessment progression: Knowledge → Case Analysis → Drafting → Oral Reasoning → Full Matter/Full Case Simulation. Higher-level simulations only arrive when demonstrated capability warrants them.
- Comprehensive "boss" assessment approximately every two weeks, explicitly set.

**Relationship to Lawyer Copilot:**
- Civil Law Mastery should align with Learning OS and Lawyer Copilot — not become an unrelated standalone technical ecosystem. All intended to live under FounderOS and share common Cognitive Core/provenance/goal/calendar infrastructure where appropriate. Lawyer Copilot was planned after Civil Law Mastery in the development sequence.
- Conceptual fit: Civil Law Mastery develops the OWNER's legal capability; Lawyer Copilot is the future professional operations/product capability.

### NOT YET DECIDED
- Complete chapter-by-chapter curriculum; which specialist branch follows the common civil-law foundation; complete sequencing of all KUHPerdata topics.
- Named textbooks; named doctrine authors; specific Supreme Court jurisprudence corpus; other statutes alongside KUHPerdata; authoritative-source hierarchy and corpus versioning.
- Exact scoring rubric; pass/fail thresholds; exact spaced-repetition algorithm; formal certification/level names.
- **Whether Civil Law Mastery's content becomes**: Lawyer Copilot training data, a separate private study corpus, a retrieval corpus available to Lawyer Copilot, or some controlled combination.
- Whether personal learning notes may ever enter the commercial Lawyer Copilot corpus.
- How personal-study provenance and production legal-source provenance are separated.
