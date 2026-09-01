# VOICE-01/VOICE-02 — AHMAD Voice Surface ("Jarvis Mode")

**Status:** SCOPE + ARCHITECTURE + ROADMAP drafted, 2026-08-30. No implementation started (per OWNER's own explicit priority: scope/plan now, build after P4/P5 settle). This resolves VOICE-01's previously-open OWNER decision ("Jason remains a distinct persona/runtime vs becomes Ahmad voice surface") — **voice becomes AHMAD's own surface**, no separate Jason persona.

**OWNER's own words (2026-08-30, verbatim):** "yeahhh good, but i want non-generic/slop result. u can take jarvis voice from eleven labs, and find public repos with relevance requirement for ahmad. and i want ahmad only recognized my voices from huwaei or my phone or my laptop." Clarified via follow-up: trusted devices = Huawei Watch Fit 5 + primary phone + ASUS/Lenovo laptop; recognition = **both** device-trust AND voiceprint biometric (not either alone); priority = scope now, build later.

---

## 1. Requirements (Decided)

- **Voice IS AHMAD**, not a separate persona/runtime. Same logical orchestrator, same governance, same standing rules (never solo-hero-implement, never invent NOT-YET-DECIDED items, escalate destructive/paid/credential actions) — voice is a new input/output surface on the existing orchestrator, not a new agent.
- **Quality bar: "non-generic/slop."** The OWNER explicitly does not want a bolt-on, robotic, or obviously-AI-default voice experience. This is a real constraint on model/voice selection, not just a nice-to-have.
- **TTS: ElevenLabs**, OWNER-specified directly. Confirmed (live-verified 2026-08-30) ElevenLabs' real current product surface: Eleven v3 (most expressive, inline emotion tags, 70+ languages), Flash v2.5 (sub-500ms latency, built for real-time conversational agents — the relevant model for a responsive Jarvis-style experience), Multilingual v2 (highest stability for long-form). ElevenLabs also offers realtime/batch Speech-to-Text AND a full "ElevenAgents" conversational platform (STT+TTS+LLM bundled) — this is a real architecture fork point, see Section 3.
- **Access control: BOTH device-trust AND voiceprint**, not either alone (OWNER's explicit choice from the clarifying question). A command must (a) originate from a trusted device AND (b) match the OWNER's enrolled voiceprint. Neither condition alone is sufficient.
- **Trusted devices (OWNER's explicit list):** Huawei Watch Fit 5, the OWNER's primary phone, ASUS and/or Lenovo laptop.
- **"Use public repos, don't build from zero, find relevant ones"** — same standing directive from the P4 modules, extended here. Applies to the STT/wake-word/speaker-verification pieces; does not apply to ElevenLabs itself (a commercial API, explicitly OWNER-chosen, not something to be "replaced" by a public repo).

## 2. NOT YET DECIDED — explicit open questions (do not fill these in autonomously)

1. **Exact "primary phone" make/model** — clarified as "different from Huawei if applicable" but the actual device was not named. Needed before any device-pairing work starts.
2. **Local vs. cloud STT** — real architecture fork, see Section 3. This has real privacy/cost/latency tradeoffs the OWNER should weigh, not AHMAD.
3. **Voiceprint enrollment process** — how does the OWNER's voice sample actually get captured/registered the first time? (e.g. a guided "say these phrases" setup flow.) Not designed yet.
4. **Wake word / activation phrase** — literal word/phrase to say (a real "Jarvis"-style name for AHMAD's voice mode, or reuse "Ahmad" itself, or something else entirely).
5. **Fallback behavior on a failed voice match** — what AHMAD should do if a command comes from a trusted device but the voiceprint doesn't match (silently ignore vs. explicit "voice not recognized" response vs. alert). Security-relevant, should be an explicit choice.
6. **Where always-listening runs** — a phone/watch app resource/battery budget question, a laptop-only "push to talk" model is far simpler than always-on wake-word listening on a wearable.
7. **Relationship to the existing Telegram channel** — does voice become a new alternative input alongside Telegram (FOS-13 Omnichannel Ahmad territory), or eventually the primary one? FOS-13 itself is still KEEP_BACKLOG.

## 3. Live-Verified Research (2026-08-30, real web search, not training-data recall)

| Layer | Candidate | Verified facts | Compact? | Stable? |
|---|---|---|---|---|
| **TTS** | ElevenLabs (OWNER-specified) | Confirmed real, full API+SDK suite. Flash v2.5 = sub-500ms latency, 32 languages, built for real-time conversational agents — the fit for a responsive Jarvis experience. Eleven v3 = most expressive/emotional but not optimized for lowest latency. | N/A (commercial API, not a repo to fork) | Yes — actively developed (changelog entries through April 2026) |
| **STT (cloud option)** | ElevenLabs Speech-to-Text | Confirmed real, part of the same platform as the chosen TTS — simplest integration, one vendor, one API key, but sends voice audio to a third party and requires internet. | N/A | Yes |
| **STT (local option)** | whisper.cpp (`github.com/ggml-org/whisper.cpp`) | Confirmed real, pure C/C++, zero runtime deps, single ~5MB binary, faster than realtime on a modern laptop, GPU-accelerated (Metal/CUDA/Vulkan) where available, actively maintained (v1.8.4, March 2026). Runs fully on-device — no audio leaves the laptop/phone. | Yes — genuinely compact | Yes — strongly, mature and widely used |
| **Wake word** | openWakeWord (`github.com/dscripka/openWakeWord`) | Confirmed real, fully open-source (no commercial gate, unlike Porcupine), tested more accurate than Porcupine, efficient enough to run multiple models simultaneously on a Raspberry-Pi-class core. | Yes | Yes |
| **Wake word (alt)** | Porcupine (`github.com/Picovoice/porcupine`) | Confirmed real, Apache-2.0 core repo, but **Picovoice is a commercial company** and some capability may sit behind a paid tier — less aligned with "use public repos" than openWakeWord. | Yes | Yes, but commercially-gated in part |
| **Speaker verification (voiceprint)** | pyannote-audio (`github.com/pyannote/pyannote-audio`) | Confirmed real, MIT-licensed code, established org (9.9k+ stars on a related repo), real speaker-verification pipeline with pretrained models (models on Hugging Face require accepting a free user agreement, not a paywall). The most credible, actively-maintained open speaker-verification option found. | Reasonably — a focused audio-ML toolkit, not a full platform | Yes |

**Honest gap, same pattern as the P4 research:** no single donor covers the whole voice pipeline. The realistic shape is several small, independently-verified, compact/stable pieces (wake word -> local or cloud STT -> speaker-verification gate -> device-trust check -> existing AHMAD/LLM reasoning -> ElevenLabs TTS) wired together as a FounderOS-native capability, not one repo fork.

## 4. Proposed Architecture (proposal only — every concrete choice below is a recommendation for OWNER confirmation, not a final decision)

```
[wake word: openWakeWord, on-device]
        |
        v
[device-trust check: is this session running on an enrolled device? (Watch Fit 5 / phone / laptop)]
        |  (fail -> ignore, no response, no log of command content)
        v
[STT: whisper.cpp local (recommended default) OR ElevenLabs STT cloud — OPEN QUESTION #2]
        |
        v
[speaker verification: pyannote-audio voiceprint match against OWNER's enrolled profile]
        |  (fail -> OPEN QUESTION #5: silent ignore vs explicit "not recognized" response)
        v
[existing AHMAD orchestrator — same governance, same delegation rules, same escalation boundaries
 as the Telegram surface today; voice is a new input channel into the SAME logical AHMAD]
        |
        v
[ElevenLabs TTS (Flash v2.5 for low-latency conversational replies) -> spoken response]
```

Why this shape and not "one big framework": every layer is independently swappable (matches this whole session's dependency-injection convention already used throughout ops-watcher/), keeps the highest-privacy option (fully local STT) available without being forced into it, and puts the security-critical gate (device+voiceprint) BEFORE anything reaches AHMAD's actual reasoning/action layer — a failed voice/device check should never even construct a task packet, matching the existing OWNER_REQUIRED / escalation-boundary philosophy already built into ahmad-dispatch.mjs this session.

## 5. Roadmap

**Phase 0 — Research (DONE, this document).**

**Phase 1 — Scope confirmation (next, requires OWNER input on Section 2's open questions).** Cannot proceed responsibly to prototyping without at least: primary phone identity, local-vs-cloud STT preference, and the enrollment/fallback behavior decisions — these are security/privacy-shaping choices, not implementation details.

**Phase 2 — Isolated prototype (small, bounded, delegated to HATTA/SJAHRIR/CORLEONE per this session's standing "don't solo-hero-implement" rule).** A throwaway, sandboxed proof-of-concept for JUST the riskiest/least-certain piece first — most likely the device-trust + voiceprint gate, since that's the security-critical, custom-built part (the TTS/STT/wake-word pieces are well-trodden library integrations by comparison). Test in isolation before wiring to real AHMAD dispatch.

**Phase 3 — Real build, following this session's established pattern exactly:** dependency-injected ops-watcher-style module(s), full regression test coverage, independent AHMAD verification, batched GIBRAN review — same rigor as ops-watcher/health-os.mjs and learning-os.mjs.

**Phase 4 — Testing under real conditions.** Real-device testing on the actual Watch Fit 5 / phone / laptop, real voiceprint enrollment and false-accept/false-reject testing (a real security property, must be evidence-checked, not assumed).

**Phase 5 — Maintenance.** Ongoing: wake-word/STT model updates, voiceprint re-enrollment if voice changes (illness, aging, etc.), ElevenLabs API/pricing drift monitoring, security review cadence (voice-based access control is a real attack surface — recorded-voice replay attacks, etc. — worth a dedicated security pass before this becomes a trusted control surface for anything sensitive).

## 6. Confidence note

TTS/STT/wake-word/speaker-verification facts above came from live web search performed 2026-08-30 (same standard as the P4 donor research), not training-data recall. Architecture and roadmap are AHMAD's own synthesis/proposal, explicitly not final — Section 2's open questions gate Phase 1, and no code has been written.
