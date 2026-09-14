# Provenance: forked from FounderOS-DEMO

Aidit OS v5 is a fork of Bennett's FounderOS-DEMO. The fork was made on
2026-09-14 (WIB) from the vendored copy kept in the previous Aidit OS repository
(`vendor/founderos-demo`), itself cloned with `--depth 1` on 2026-09-07.

- Upstream: https://github.com/Bennettxai/FounderOS-DEMO
- Commit:   d5e565ea1ee82069e17cd176a33c2f272619e002
- Dated:    2026-08-25T10:05:39-05:00
- Subject:  Comms: build complete inbox workspace
- Licence:  MIT, Copyright (c) 2026 FounderOS. `LICENSE` is the upstream file,
            unmodified, and stays in this repository.

## Attribution rule

Every file in this repository that originates from the upstream template keeps
its MIT notice. Files rewritten for Aidit OS carry a header line naming the
upstream and commit above ("Adapted from FounderOS-DEMO d5e565e, MIT"). Adoption
is not laundering: when Aidit OS and upstream disagree, the diff must stay
readable, so structural changes are made in place and recorded in git history,
never by silently renaming upstream files.

## What Aidit OS changed (running list)

- Port 4100 -> 4200, package renamed `aidit-os`, Node pinned to 22.x.
- `lib/seed.ts`: company Aidit OS, two ventures, eight departments (see
  `docs/prd/PRD-AIDIT-OS-V5-ENAM-STACK.md` in the previous repo).
- Brand tokens, Indonesian formal register and the JARVIS persona replace the
  upstream Monolith demo copy.
