# Vendored: FounderOS-DEMO

This directory is a vendored copy of Bennett's FounderOS, the repository that the
six-layer agent stack page links to as its own source. It is here to be READ and
ADOPTED FROM, not to be run as part of Aidit OS.

## Provenance

- Upstream: https://github.com/Bennettxai/FounderOS-DEMO
- Commit:   d5e565ea1ee82069e17cd176a33c2f272619e002
- Dated:    2026-08-25T10:05:39-05:00
- Subject:  Comms: build complete inbox workspace
- Cloned:   2026-09-07, --depth 1, upstream .git removed so this tree lives in
            Aidit OS's own history and reaches every lane worktree.

## Licence

MIT, Copyright (c) 2026 FounderOS. `LICENSE` in this directory is the upstream
file, unmodified. **Any file copied out of here into Aidit OS proper must carry
an attribution line naming this upstream and commit**, and the MIT notice must
survive. Adoption is not laundering.

## Why it is vendored rather than gitignored

Lanes work in their own git worktrees. A gitignored directory does not exist in
a worktree, so an ignored vendor tree would be invisible to exactly the agents
that need to read it.

## Rule for this directory

Nothing in here is edited in place. It is a reference point: when Aidit OS and
upstream disagree, the diff has to be readable. Changes belong in Aidit OS's own
files, with the adoption recorded.
