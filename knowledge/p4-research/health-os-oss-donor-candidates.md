# Health OS — OSS Donor Candidates (P4 Research)

**Purpose.** This is research, not a decision. The OWNER has decided that Health OS should be built on a forked/adapted free/open-source foundation rather than from zero, but the *exact donor repository* is explicitly **NOT YET DECIDED** (see `handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md`, section 1). This file presents 2–4 realistic, genuinely-existing candidates with honest tradeoffs so the OWNER (or AHMAD after narrowing) can choose. **No implementation code. No final pick.**

**Scope the donor must eventually help cover (for judging fit only):** sleep/recovery, activity/steps/training, screen/sedentary load, smoking-reduction with adaptive baseline + lapse-recovery, a 1–5 Energy/Mood/Focus/Body morning check-in, Huawei Watch Fit 5 wearable ingestion, a Health Trend Engine, integration *into* FounderOS (not standalone), and a real autonomy ladder (low-risk automated, high-risk always explicit-approval).

**Headline honesty up front:** No single FOSS project I am confident exists covers this whole scope. The realistic pattern is either (a) adopt one project as the structural foundation and build the missing majority around it, or (b) treat several narrow donors as *ingestion/signal sources* feeding a custom FounderOS Health Trend Engine that you write yourself. The "adaptive Life OS / morning adaptive loop / autonomy ladder / smoking-reduction-with-lapse-recovery" portion of the spec is, in my honest assessment, not satisfied by any self-hosted OSS health tracker I know of — that part will almost certainly be custom regardless of donor choice.

---

## Candidate A — Gadgetbridge

**What it actually does (to the best of my knowledge):** A long-standing, actively-developed free/open-source Android app that replaces the proprietary companion apps for a wide range of wearables — predominantly the Amazfit/Huami/Xiaomi/Mi Band ecosystem and a broad set of Huawei/Honor bands and watches. It pairs directly with the device over Bluetooth, pulls notifications/heart-rate/sleep/steps/activity data, and stores it locally on the phone (not in a vendor cloud). It is the closest thing in FOSS to a "wearable-agnostic ingestion layer."

**Fit to decided scope:**
- *Strong* on the "Huawei Watch Fit 5 wearable data ingestion" requirement — the Huawei/Honor wearable family is one of its core supported categories. **Caveat I cannot confirm:** whether the *specific* Watch Fit 5 model is already supported vs. needing protocol work; Gadgetbridge's device support is per-model, and newer Huawei Watch Fit models may require reverse-engineering effort. Must verify current device matrix before relying on it.
- *Weak/none* on: Health Trend Engine, adaptive morning loop, smoking tracking, Energy/Mood/Focus/Body check-in, autonomy ladder, FounderOS integration.

**Rough tech stack:** Android (Java/Kotlin), GPL-licensed (I am fairly but not 100% confident of the exact GPL variant). Phone-side, not a server-side data platform.

**Honest gap:** Gadgetbridge solves the single hardest-to-build-from-scratch piece — getting raw data *off* a Huawei watch without the vendor cloud — and is privacy-aligned (local-first). But it gives you *ingestion only*. Everything analytic, adaptive, scheduling-aware, and FounderOS-integrated still has to be built. It also anchors the ingestion to Android; if FounderOS needs ingestion server-side or cross-platform, you'd be bridging data off an Android device rather than querying a device directly.

---

## Candidate B — wger

**What it actually does (to the best of my knowledge):** A self-hostable, web-based fitness/workout/nutrition/weight tracker. Users log workouts (with an exercise library), body weight, and nutrition; it has a REST API and a web UI. It is one of the more mature self-hosted "personal fitness manager" projects in FOSS.

**Fit to decided scope:**
- *Partial* on: activity/gym/training logging, body-weight trends. Has a real data model and REST API, which matters for "integrate into FounderOS" rather than reinventing schemas.
- *None* on: sleep/recovery, wearable ingestion (no Huawei integration), smoking-reduction adaptive logic, morning Energy/Mood/Focus/Body check-in, Health Trend Engine, autonomy ladder, the adaptive Life OS loop.

**Rough tech stack:** Python (Django) backend + Angular frontend, self-hostable via Docker. GPL-family (I am fairly but not 100% confident of exact license — verify before forking).

**Honest gap:** wger is the *broadest* "health/fitness tracker foundation" I'm confident exists, and having a real REST API + data model means you'd inherit structured activity/weight tracking instead of designing it. But the gap is large: sleep, wearable ingestion, smoking-reduction, the morning check-in, the trend engine, and the entire adaptive scheduling + autonomy-ladder layer are all absent and would be custom-built *around* it. It is also gym/nutrition-centric in a way the spec is not (the spec is recovery- and adaptive-life-centric), so its data model may need reshaping rather than just extension.

---

## Candidate C — Loop Habit Tracker

**What it actually does (to the best of my knowledge):** A mature free/open-source Android habit tracker. Fast, frictionless logging of repeating habits with streak/score computation and reminders. The logging UX (tap-to-score, quick entry, reminders) is the relevant part.

**Fit to decided scope:**
- *Partial, by analogy* on the smoking tracker's "fast/frictionless smoking logs + smoke-free windows + lapse capture" — a smoking log can be modeled as a habit with lapse entries, and Loop's quick-log pattern maps well to the spec's "fast/frictionless" requirement.
- *None* on: wearable ingestion, sleep physiology, Health Trend Engine, adaptive baseline/reduction *logic* (Loop tracks streaks; it does not compute adaptive reduction targets or lapse-recovery re-baselining), morning check-in as a structured 1–5 battery, FounderOS integration, autonomy ladder.

**Rough tech stack:** Android (Java/Kotlin), GPL-family (verify exact variant). Standalone phone app with local storage.

**Honest gap:** Loop is a *pattern donor* more than a platform donor — it demonstrates the frictionless-logging UX you'd want for smoking logs, but it has no server, no API-first design for FounderOS integration, and its "streak" model is the opposite of the spec's explicit "don't treat one lapse as total failure; adaptive re-baseline." You would likely borrow its UX ideas rather than fork its code into FounderOS.

---

## Candidate D — ActivityWatch

**What it actually does (to the best of my knowledge):** A free/open-source cross-platform (desktop) tool that automatically records which applications/windows/browsers are active and for how long, producing screen-time and activity breakdowns. It runs locally and stores locally, with a web UI and an API.

**Fit to decided scope:**
- *Narrow but real* on the "screen/sedentary load" input — this is precisely the signal source for that piece, and it's privacy-aligned (local-first, no vendor cloud).
- *None* on everything else (sleep, wearable, smoking, morning check-in, trend engine, adaptive loop, autonomy ladder, FounderOS integration).

**Rough tech stack:** Python core + native watchers per OS + browser extensions + web UI. License: **uncertain** — I recall it being FOSS but am not confident of the exact license; verify before relying on it.

**Honest gap:** ActivityWatch only contributes *one input channel* (screen/sedentary load). It is not a health platform and would never be "the" donor — at most it's an ingestion source for one signal in a multi-donor strategy.

---

## Recommendation of tradeoffs (not a final pick)

There are two honest strategies and the OWNER should choose between them, because they imply very different workloads:

1. **Single-foundation strategy:** adopt **wger** as the structural spine (real schema + REST API + activity/weight tracking) and build sleep, wearable ingestion, smoking-reduction, the morning check-in, the Health Trend Engine, the adaptive loop, the autonomy ladder, and the FounderOS integration on top of it. Lowest *schema-design* cost; largest *custom-build* cost; risk that wger's gym/nutrition-centric model shapes your health model in directions the spec doesn't want.

2. **Multi-ingestion + custom-core strategy:** use **Gadgetbridge** for Huawei wearable data, **ActivityWatch** for screen/sedentary load, optionally borrow Loop's logging *pattern* for smoking logs, and write the Health Trend Engine, adaptive morning loop, and autonomy ladder yourself as a first-class FounderOS capability. Highest *engineering* cost on the core, but the result is native to FounderOS rather than wrapped around a foreign project, and Gadgetbridge gives you the genuinely hard part (Huawei ingestion) for free.

The key uncertainty to resolve before narrowing: **(a)** confirm Gadgetbridge's *current* support status for the exact Huawei Watch Fit 5 model, and **(b)** confirm the exact licenses of all shortlisted projects before forking, since license terms materially affect a fork-and-adapt decision. If Huawei Fit 5 ingestion turns out to require significant protocol work in Gadgetbridge regardless, the calculus shifts toward building ingestion against the vendor's own export rather than through Gadgetbridge.

---

## Confidence note

I am **moderately confident** that all four named projects — Gadgetbridge, wger, Loop Habit Tracker, ActivityWatch — genuinely exist as free/open-source software and roughly do what I described. I am **less confident** on specifics I have flagged as uncertain: exact GPL variants per project, exact current device-support matrix of Gadgetbridge (and specifically whether the Huawei Watch Fit 5 is supported today), wger's exact feature surface today, and ActivityWatch's exact license. This is a claim about the real-world OSS landscape, which I cannot verify from inside this repo without live access — treat the *names and categories* as reliable and the *license/version/specific-model-support details* as "verify before forking." I did **not** invent any project name, URL, or feature; where I was not confident, I said so rather than fabricate.