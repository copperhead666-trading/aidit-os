# Bennett Repo Reuse Survey — 2026-09-01

Owner asked: rather than building a dashboard from scratch, find out what can actually be reused
from Bennett's GitHub repo, and migrate that. Every claim below was verified on 2026-09-01 against
the repository on disk, the GitHub API, or this machine.

## 1. What the repository is

- Upstream: `https://github.com/Bennettxai/FounderOS-DEMO` — MIT licensed, TypeScript, 747 stars,
  last pushed 2026-08-25, head `d5e565ea1`.
- Its own README calls the architecture "larp-first, real-ready": every page ships with seeded
  placeholder data so it runs with no API keys, and the repository layer is meant to be swapped for
  live sources later.
- Stack: Next.js 14 (App Router), TypeScript, Tailwind, better-sqlite3 (WAL), Zod, Vitest,
  Vercel AI SDK, `lucide-react`, `simple-icons`, `d3-force`.

## 2. Correction to the premise

The owner's regret was not cloning Bennett's repo from the start. **It was cloned.**
`D:\FounderOS-Aidit De Maestros\app` is a working git clone of that exact repository:

- `origin` = `https://github.com/Bennettxai/FounderOS-DEMO`
- remote refs present locally: `origin/main`, `origin/operator/prod-readiness-brief`
- 20+ local commits on top of upstream, all building the Ahmad orchestration layer — Telegram
  inline-keyboard decisions, confidence gating, a code-level Never-tier guard, the wake loop,
  auto-reroute on QUOTA/FAILED, real file tool-calling for the GLM worker
- plus **64 modified tracked files (+2,467 / −966) and 222 untracked new files, none committed**

Re-cloning upstream would gain nothing: the only upstream work newer than the clone is a Gmail and
Slack comms inbox (2026-08-19 → 08-25), a domain the active system does not have.

**Risk this exposes:** the personalization is largely uncommitted. Deleting the legacy folder after
migration would destroy roughly 286 files of work with no git history to recover it from.

## 3. What is reusable

### Tier 1 — take as-is: the shell (~47 KB total)

`app/layout.tsx`, `app/globals.css` (22 KB of design tokens: a dark "Monolith" terminal palette and
a light paper palette, both driven by CSS vars so one `data-theme` flip re-themes everything),
`tailwind.config.ts`, `lib/theme.ts`, `lib/nav.ts`, `components/Sidebar.tsx`, `Topbar.tsx`,
`CommandPalette.tsx`, `ThemeToggle.tsx`, `PageHeader.tsx`, `components/terminal.tsx`
(`Dot`, `Badge`, `Label`, `SectionHead`, `Kbd`, `Spark`).

It is already mobile-ready: below the `md` breakpoint the sidebar becomes an off-canvas drawer with
a backdrop and Escape handling, and the layout carries a real viewport declaration and responsive
padding.

### Tier 2 — keep the view, replace the data (8 routes)

`/` (home), `/doctor`, `/agents`, `/tasks`, `/skills`, `/brain`, `/roadmap`, `/reference`,
plus the `/ahmad` queue board.

### Tier 3 — drop (12 routes)

`/comms`, `/funnel`, `/social`, `/content`, `/finances`, `/personas`, `/integrations`,
`/workflows`, `/org`, `/analytics`, the Paperclip graph view, lead magnets. These are Bennett's
demo business domains with seeded data; they do not describe this owner's business.

### The actual work

Pages are server components marked `dynamic = 'force-dynamic'` that import from `lib/*`, which reads
a SQLite database through `getDb`. Rewiring means replacing that data layer with adapters over the
sources this system already writes:

| View | Real source |
|---|---|
| system health | `ops-watcher/heartbeat-steps.jsonl` (15 steps, currently 15/15 green) |
| lanes, quota, cooldowns | `ops-watcher/lane-usage.jsonl`, `ops-watcher/routing-state.json` |
| self-repair and supervision | `ops-watcher/self-repair-log.jsonl`, `ops-watcher/pm2-supervisor-log.jsonl` |
| agents | `config/agent-registry.json` |
| decisions | `config/decision-ledger.json` (39 records) |
| architecture gaps | `config/project-layers.json` |
| task classes | `config/skill-matrix.json` |
| issues and comments | the live Paperclip API on `127.0.0.1:3110` |

The JSX and the primitives stay; only the reads change.

## 4. Getting it onto the phone — free, no cloud

Tailscale is already running on this machine and the tailnet already contains the phone:

    100.113.151.82  asus-gray      windows
    100.87.42.3     lenovo-black   windows
    100.65.3.78     iphone-12-pro  iOS   (enrolled, last seen 6d ago)

A `tailscale serve` route already exists here, publishing an HTTPS tailnet-only URL. So the
dashboard runs locally under PM2 and is reachable from the phone through that URL: no hosting bill,
no cloud migration, nothing exposed publicly.

The honest limit: the laptop must be on. That is the same dependency the whole system already has,
and it is exactly what the deferred cloud move would remove later.

## 5. Constraints

- **Licence:** MIT. Reuse is free; the copyright notice must be kept.
- **Disk:** `D:` has 22 GB free. A Next.js install is roughly 600 MB.
- **Theme:** the owner asked for clean. The Monolith palette is monochrome with a single accent and
  sharp corners; keep the existing theme toggle so light and dark both stay available.
