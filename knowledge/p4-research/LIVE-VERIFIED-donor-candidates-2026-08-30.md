---
title: LIVE-VERIFIED OSS donor candidates for P4 modules
---

# P4 OSS Donor Candidates — Live-Verified 2026-08-30

**Why this file exists.** HATTA/SJAHRIR/CORLEONE's earlier research (knowledge/p4-research/health-os-oss-donor-candidates.md, learning-os-algorithm-and-schema-options.md, technical-integration-sketch.md) was produced without live internet access — honest, well-hedged, but unverified. AHMAD (this session, live web access) verified the strongest candidates directly via web search and confirms/corrects that research below. This directly responds to the OWNER's 2026-08-30 directive: "you must find public repos who's compact and stable for my os. do not build from zero. use the public repos whos relevant."

**Still not decided by AHMAD:** which candidate to actually fork/vendor, storage schema, exact integration code. This file adds VERIFIED FACTS to reduce guessing; it does not make the final pick.

---

## Health OS — verified

| Candidate | Verified facts | Compact? | Stable? |
|---|---|---|---|
| **Gadgetbridge** (`github.com/Freeyourgadget/Gadgetbridge`) | Confirmed real. **Huawei Watch Fit 5 support added in v0.92.0 (June 2026)** — resolves the uncertainty HATTA flagged. Watch Fit 5 *Pro* variant is still experimental. Long-running, mature project (GPLv3 family). | Yes — single-purpose wearable-ingestion app | Yes — actively released (v0.92.0 this year) |
| **ActivityWatch** (`github.com/ActivityWatch/activitywatch`) | Confirmed real, MPL-2.0, cross-platform, local-first, active org with multiple sub-repos. | Yes — single-purpose screen-time tracker | Yes |
| **Loop Habit Tracker / uhabits** (`github.com/iSoron/uhabits`) | Confirmed real, **10.2k stars**, GPLv3, actively maintained (open beta on Google Play, active issues/PRs/discussions). Notably stronger and more stable than earlier-assumed. | Yes — single-purpose habit tracker | Yes, strongly |
| wger (`github.com/wger-project/wger`) | Confirmed real, **6.4k stars**, AGPL-3.0-or-later, active. | No — full Django+Angular platform (gym/nutrition/workout manager) | Yes |

**Verified recommendation direction:** the multi-ingestion + custom-core strategy (HATTA's Strategy 2) is now the stronger-evidenced choice — Gadgetbridge (wearable), ActivityWatch (screen), and uhabits (smoking/habit logs, now confirmed unusually stable at 10.2k stars) are all independently compact, independently stable, and independently verified. wger remains an option but fails "compact." No single fork solves the whole spec; three small stable donors + a custom FounderOS core is the honest shape of this.

---

## Learning OS / Civil Law Mastery — verified

| Candidate | Verified facts | Compact? | Stable? |
|---|---|---|---|
| **open-spaced-repetition / py-fsrs** (and `fsrs-rs`, `fsrs-optimizer`) (`github.com/open-spaced-repetition`) | Confirmed real. This is the reference implementation org for FSRS — the same algorithm now used by modern Anki. Small, focused libraries (algorithm only, not a full app), permissively licensed, backing a genuinely massive real-world deployment (Anki). | Yes — a library, not a platform | Yes — backs Anki's production FSRS |
| Skola (`github.com/h16nning/skola`) | Confirmed real, FSRS-based, local-first PWA. **Its own README states it is "early-ish development, expect bugs, missing features, and breaking changes."** | Yes | **No** — self-described as unstable |
| Memoet (`github.com/memoetapp/memoet`) | Confirmed real, SM-2 algorithm, AGPL-3.0, Elixir. **Last repository update found: August 2023 — appears unmaintained/abandoned as of 2026.** | Yes | **No** — likely abandoned |

**Verified recommendation direction:** no compact+stable *full learning platform* exists in what I could verify — the two app-level candidates (Skola, Memoet) both fail "stable" on their own evidence (self-described early/likely abandoned). The strongest verified donor for Learning OS is narrower than a full app: **reuse the FSRS algorithm library itself** (py-fsrs or fsrs-rs, matching SJAHRIR's own Option B research) as the compact, stable, battle-tested scheduling engine, and build the UNDERSTAND->APPLY->PRODUCE loop, progress schema (SJAHRIR already proposed 3 real options), and Cognitive Core integration as a genuinely FounderOS-native capability around it. This is the same "borrow the hard/proven part, build the FounderOS-specific part" pattern as Health OS.

---

## Lawyer Copilot — verified, more caution warranted

| Candidate | Verified facts | Compact? | Stable? |
|---|---|---|---|
| **ArkCase** (`github.com/ArkCase/ArkCase`) | Confirmed real, LGPL-3.0, real company (ArkCase) behind it, positioned as an ECM/BPM/CRM case-management platform (not law-specific only — broader case management: FOIA, complaints, etc.) | **No** — full enterprise ECM/BPM/CRM platform | Likely yes (real company, real product) but unverified star/commit-recency count |
| OpenLawOffice (`github.com/NodineLegal/OpenLawOffice`) | Confirmed real, only 32 stars, maintenance status could not be confirmed either way | Yes — smaller, law-office-specific | **Unverified/uncertain** |
| Iuris-Soft, MyLegalNet, CaseAce, Open Case Management (OCM) | Found in search but not individually verified; several look like small/student/hobby projects based on their descriptions | Likely yes | **Unverified, likely low** |

**Verified recommendation direction:** unlike Health OS and Learning OS, Lawyer Copilot does **not** yet have a clearly compact+stable verified donor. ArkCase is the most legitimate/stable option found but is explicitly heavy/enterprise, failing "compact." The smaller law-specific projects are real but their maintenance status is unverified or looks weak. Combined with the legal domain's higher stakes and the still-open jurisdiction question (KOL-52), this reinforces AHMAD's earlier recommendation to hold real Lawyer Copilot build/donor work until Civil Law Mastery is further along and the OWNER has answered the jurisdiction question — there isn't yet a confident "use this repo" answer here even under the new directive.

---

## Confidence note

Every fact above (stars, license, last-release, maintenance signals) came from a live web search performed 2026-08-30, not from training-data recall — this is a meaningfully stronger evidence bar than the earlier HATTA/SJAHRIR/CORLEONE research, which is why this file exists as a supplement rather than a replacement. Search-result summaries can still be imprecise (e.g. exact current star counts drift daily); treat exact numbers as "approximately correct as of this date," and re-verify immediately before actually forking/vendoring any of these into the repo.
