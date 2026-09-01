# Aidit — Active Owner Principles

Verification note: Ledger ID `D20` exists in `config/decision-ledger.json`, but its statement wording differs: this file's source quote uses `"vibe coded"` while `config/decision-ledger.json` uses `'vibe coded'`.

Canonical, human-readable. Machine-readable source of truth:
`config/decision-ledger.json` (records of `type: PRINCIPLE`, `canonical: true`).
Every principle below retains full provenance — nothing here is stated without a traceable
source.

---

### Islamic identity is core, not an add-on

> Islamic identity/values were part of Aidit's intended direction during the SMJ era, not
> a new SJS-only invention. Historical absence from some SMJ artifacts must not be read as
> evidence the principle did not exist.

**Status**: ACTIVE (RESTATED_OR_STRENGTHENED, not new) · **Provenance**: DIRECT_OWNER_STATEMENT ·
**Date**: 2026-08-18 · **Ledger ID**: `D17` · **Confidence**: HIGHEST

---

### Buku Toko's current reality is respected, not dismissed

> Buku Toko is Aidit's own hand-built ("vibe coded") live operational system. Its current
> operational behavior is owner-accepted reality; its architecture is NOT automatically the
> target architecture for SJS SuperApps. Status: LEGACY-BUT-LIVE, not dead legacy.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT · **Date**: 2026-08-18 ·
**Ledger ID**: `D20` · **Confidence**: HIGHEST

**Implication**: any KEEP/MODIFY/DROP call on Buku Toko capabilities must be evidence-based
— "imperfect" is never sufficient grounds to call something obsolete.

---

### Simple for the worker, accountable in the system

> Buku Toko users are internal workers within the Sederhana Jaya family business
> environment. The application should therefore be simple, easy, low-friction, while the
> system must still know WHO performed each activity.

**Status**: ACTIVE · **Provenance**: DIRECT_OWNER_STATEMENT (verbatim intent) · **Date**:
2026-08-18 · **Ledger ID**: `D28` · **Confidence**: HIGH

**Agent-generated shorthand** (for internal reference only — see the provenance warning
below): *"SIMPLE_FOR_USER, ACCOUNTABLE_BY_SYSTEM."* This label is `AGENT_GENERATED`
(ledger ID `PIN-shorthand`, `derived_from: D28`) and **must never be presented as Aidit's
own words** — always cite the quoted statement above, not the shorthand, when attributing
this principle to Aidit.

**Implication**: low-friction authentication + strong action attribution for SJS's future
auth design. Does **not** imply preserving the legacy plaintext PIN pattern — see
legacy `owner/aidit-decisions.md`'s Implementation Realities section.

---

## How to read this file

- Every principle here is `canonical: true` in the machine ledger — the current,
  authoritative statement of something Aidit has actually said, not an agent's inference.
- Historical principle states that were superseded, and principles that once looked
  plausible but were never actually owner-ratified, are **not** listed here — see
  legacy `owner/aidit-decisions.md`'s Historical/Superseded and Agent-Generated sections.
- Full evidentiary detail behind each principle lives in `config/decision-ledger.json`.
