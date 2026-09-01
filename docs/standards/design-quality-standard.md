# FounderOS Design Quality Standard

Status: active standard. Written 2026-08-24 in the legacy repo, migrated 2026-09-01.

## Goal

FounderOS output must not look generic, sloppy, or like a random template. Design choices must match the project domain and the owner workflow.

## Required Sources

- `ui-ux-pro-max`: installed local skill exists at `C:\Users\ASUS\.codex\skills\ui-ux-pro-max\SKILL.md`. Use its design-system search for new pages and its targeted UX searches for component issues.
- 21st.dev: use as free inspiration for React/Tailwind/shadcn-style components. Current public docs describe it as a community registry with free browsing and React/Tailwind components copied into the repo, not a locked package dependency. Sources checked: https://21st.dev/, https://help.21st.dev/, https://21st.dev/community/components/explore/ai-component, https://github.com/21st-dev/agent-elements.
- Framer Motion: approved as an option only when a frontend change actually uses motion. Do not install it as dead weight.

## Quality Gate

Before delivery, the maker and reviewer must check:

- The first screen is the actual tool/app experience when the user asked for an app or dashboard.
- Text fits on mobile and desktop.
- Icons use `lucide-react` where available.
- Components preserve existing design tokens and layout density.
- Dashboard/ops tools stay quiet, scannable, and work-focused.
- Motion has purpose and respects reduced-motion expectations.
- No one-note palette, random gradients, decorative clutter, or nested card stacks.
- Data views show honest empty/error/loading states.

## FounderOS-Specific Direction

Paperclip and cockpit are operational surfaces. They should feel dense, calm, and immediately useful. This standard applies to any future FounderOS surface; today the only owner-facing surface is Telegram.
