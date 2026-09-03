# Cockpit visual design — handoff

**Written 2026-09-03, ASUS session.** The owner is taking the visual direction
elsewhere. Everything below is state, not opinion: what is on disk, what was
decided and why, what was measured, and what is still wrong. The next person or
tool should be able to change the look without re-deriving any of it.

---

## 1. The one thing to know

The cockpit's look is **entirely token-driven**. Fonts, radii and every colour
resolve through CSS variables and Tailwind `os.*` classes. A complete re-skin is
three files and touches no component:

| File | What it holds |
|---|---|
| `cockpit/app/globals.css` | every theme's token block (`dark`, `light`, `mono`, `mono-light`, `midnight`, `ember`) |
| `cockpit/tailwind.config.ts` | `font-sans` / `font-mono` mapping, and the `rounded-sm-t` / `md-t` / `lg-t` radius scale |
| `cockpit/app/layout.tsx` | which Google fonts are loaded into `--font-sans` / `--font-mono` |

Change those and the whole app follows. Two skins were swapped this way in one
session with zero component edits. **Do not hardcode a colour, font or radius in
a component** — that is what makes the next swap expensive.

`cockpit/lib/theme.ts` holds `DEFAULT_THEME` and the theme-picker metadata. The
bare `:root,` alias in `globals.css` must sit on the same theme block as
`DEFAULT_THEME`, or a no-JS/pre-script load flashes a different skin.

---

## 2. Where the design language comes from

`DESIGN.md` at the repo root, installed with `npx getdesign@latest add zapier`
(VoltAgent's `awesome-design-md` catalogue, MIT). 537 lines: palette, type
ramp, spacing, elevation, shapes, component specs.

It is the project's visual authority. The impeccable skill reads it, and the
design detector enforces it — a colour or font size outside it is a finding.

**Two deliberate departures, both recorded in the code that makes them:**

1. Zapier's `#ff4f00` is 3.4:1 on cream. Fine for a marketing CTA fill,
   illegible as dashboard text. `--accent` is the deepened `#bd3900` (5.1:1 on
   cards); the true brand orange lives in `--accent-2` for fills and marks.
2. Zapier ships no dark mode and no semantic palette. The dark skin is derived
   from the same warm hue family (`#100c0a` ground, `#211a16` cards, `#ff6a26`
   accent), and ok/warn/err are warm-tuned so they sit with the orange.

A **dashboard type scale** was added to DESIGN.md — Zapier's ramp stops at 14px
because nothing on a marketing site is denser than a pricing table. Six steps:
24 / 20 / 16 / 14 / 13 / 12, floor 12px. It exists in **both** the frontmatter
`typography:` block (machine-readable, what the detector reads) and the prose
table. Keep them in sync; a step in only one place will be flagged.

---

## 3. A tooling trap that will waste your time

`cockpit/package.json` makes `cockpit/` its own project root, so the detector
looks for a design system *there*, not at the repo root. Without one, **every
`design-system-*` rule is silently skipped for every file under `cockpit/`** —
from any working directory. It reports `[]` and means "not checked".

Proof, both runs from the repo root:

```
node .../detect.mjs __probe_root.tsx        -> 1 anti-pattern found
node .../detect.mjs cockpit/__probe.tsx     -> (nothing)
```

Same file content, same command. `cockpit/DESIGN.md` is a mirror of the root
file that closes the hole. If you move or rename the root DESIGN.md, update the
mirror or the blind spot comes back — quietly.

`.impeccable/config.json` holds one persisted ignore: `design-system-color` for
`#000`, because CSS `mask: linear-gradient(#000 0 0)` is an alpha stencil, not a
colour. That is the only ignore in the project.

---

## 4. Verification tooling (this is the part worth keeping)

Three sessions were spent shipping screens nobody had looked at. Two scripts now
prevent that. Both mint a session cookie the same way `app/api/session/route.ts`
does, so they can reach the authenticated pages; the bot token is used as an
HMAC key and never printed.

```bash
node scripts/shoot-cockpit.mjs            # screenshots -> .shots/
node scripts/shoot-cockpit.mjs --public   # through the Tailscale funnel
node scripts/shoot-cockpit.mjs --theme light
node scripts/audit-cockpit.mjs            # runtime audit at iPhone width
```

`shoot-cockpit.mjs` captures phone (iPhone 14 Pro) and desktop for `/` and
`/decisions`, and **fails loudly** on any 4xx/5xx response, page error, console
error, or a page that rendered with no stylesheet applied. That last check
exists because a stale `.next` served HTML whose CSS 404'd, and the owner saw an
unstyled page — twice.

`audit-cockpit.mjs` measures what a static linter cannot: real horizontal
overflow, real touch-target sizes, accessible names, and **rendered** contrast
with alpha composited down through translucent layers. Its first version read
`rgba(255,106,38,0.11)` as solid orange and invented two contrast failures; the
compositing fix is in the file with a comment saying why.

Current state: `clean` on both routes at 393px.

---

## 5. The build/restart rule, learned twice the hard way

`next start` serves a built `.next`. Running `npm run build` while the process
is live overwrites the build under it, and the served HTML then points at asset
hashes that no longer exist — CSS 404s and the page renders naked.

**Always:** `pm2 stop cockpit` → delete `.next` → `npm run build` →
`pm2 start cockpit` → `pm2 save`.

A PM2 supervisor alerts the owner every time that process goes down, so batch
changes and restart once. Only one actor should build and restart; two agents
holding that button caused both incidents.

---

## 6. What is on screen now

- **Home** (`app/page.tsx`): greeting, a 2×2 tile grid (4-up on wide screens),
  then the one decision that most needs the owner, the rest as a compact list,
  what is running, what is stuck.
- **Decisions** (`app/decisions/page.tsx`): four tiles, the waiting list, the
  ledger.
- `components/Tile.tsx` — the tile primitive. Its `marks` prop renders one small
  bar per real item (15 marks under `15/15` are the fifteen checks). It is not a
  sparkline and must never become one: no invented series, no padding.
- `components/OwnerActions.tsx` — Setuju / Revisi / Tolak / Nanti. **These write
  for real** (see §7).
- `components/DecisionCard.tsx`, `keputusan.ts`, `waktu.ts` — the card, the pure
  derivations behind it, and the Indonesian time/title helpers.

Copy is Indonesian and deliberately short: roughly 270 words were cut from the
first version. The rule used was "if a sentence runs past about eight words on
this screen, it probably belongs behind the disclosure".

---

## 7. The owner actions are live — do not break this contract

`app/api/decision/route.ts` performs the same writes the Telegram buttons do:

| Action | Effect |
|---|---|
| Setuju | drops `OWNER_REQUIRED`, posts the approval comment |
| Tolak | status `cancelled`, drops `OWNER_REQUIRED`, adds `OWNER_REJECTED` |
| Nanti | comment only |
| Revisi | comment only, with the owner's reason; never claims execution |

The comment prefixes are **not** free text. `ops-watcher/directive-runner.mjs`
matches `OWNER MENYETUJUI via Telegram` and `OWNER MENOLAK via Telegram`
literally. A decision written any other way is filed and then ignored by the
thing that acts on it. The cockpit *is* the Telegram Mini App, so the wording
stays accurate; only the trailing sentence names the surface.

State is changed before the comment is posted, and a half-applied result says so
rather than reporting success.

Error paths verified live: no session → 307, unknown action → 400, empty
identifier → 400, unknown issue → 404. **The first real button press was left to
the owner** — pressing it for him would have forged an owner decision.

---

## 8. What is still wrong

1. **Issue titles are English.** Routing prefixes are stripped in
   `waktu.ts:judulSingkat` (`OWNER DIRECTIVE:`, `P4 DECISION NEEDED:`,
   `FYI/DECISION:`, `APPROVE:`, …) but the content underneath is still English:
   *"SJS HRD KPI commission rules need your input"*. This is a **data** problem,
   not a display one, and it has a trap: `lib/sources.ts:asksOwnerByTitle`
   matches those same prefixes to decide what is waiting on the owner. Rewriting
   titles at the source without changing that filter makes eight decisions
   invisible again — the exact bug that was just fixed. Change both together or
   neither.
2. **Descriptions are English too**, for the same reason.
3. **The sidebar is still English** — `Home`, `Inbox`, `Tasks`, and the group
   headers `OPERATE` / `AGENTS` / `INTELLIGENCE` / `SYSTEM` — while the body is
   Indonesian. The topbar breadcrumb was translated; the sidebar was not.
4. **The sidebar still says "Read-Only Cockpit"**, which stopped being true when
   the owner actions started writing.
5. **Desktop wastes its width.** The layout is one long mobile column centred in
   a wide viewport. It is legible, not composed.
6. **The owner's verdict on the whole thing was "still generic".** Three
   directions were tried — dark phosphor terminal, warm paper editorial, and the
   current Zapier cream/dark. He accepted the third as workable but not good.
   The reference he kept returning to is a dark mobile analytics dashboard with
   tall rounded tiles, each carrying a real visual mark. Screenshot:
   `C:\Users\ASUS\.claude\uploads\2e40a23c-ebbc-4783-b6c0-ae65db212216\ffb06179-image.jpg`

Honest read on #6: the measurable gaps between our screens and that reference
were tile height and padding, value size, chrome (borders vs surface lift), and
one meaningful visual per tile. Four of those were closed. What remains is
composition on wide screens and the fact that a real app carries real strings of
unpredictable length, which a Figma comp never has to survive.

---

## 9. Tooling installed for this work

- **Playwright** + Chromium 151 — the two scripts above.
- **21st.dev** — MCP server (`.mcp.json`, key in `.claude/settings.local.json`
  as `API_KEY_21ST`, gitignored) plus seven skills: `21st-ui-build`,
  `21st-ui-explore`, `21st-ui-review`, `21st-ai`, `21st-cli-use`,
  `21st-registry`, `21st-design-sync`.
- **context7** — MCP for current library docs.
- **impeccable** parser modules (`htmlparser2`, `css-select`, `css-tree`,
  `domutils`) installed at `~/.claude/skills/impeccable/`, so the detector runs
  fully instead of degraded.
- **framer-motion** in `cockpit/` — installed, not yet used.
- `shadcn` MCP was removed on the owner's instruction: it timed out on every
  health check and would have introduced a second, conflicting token system.

---

## 10. Uncommitted

33 changed or new paths at handoff time, on top of `5883701`. Nothing here is
committed. Notable new files: `DESIGN.md`, `cockpit/DESIGN.md`,
`cockpit/app/api/decision/`, `cockpit/components/{Tile,DecisionCard,OwnerActions,keputusan,waktu}`,
`scripts/{shoot,audit}-cockpit.mjs`, `.impeccable/config.json`, `.shots/`.

`.shots/` is screenshot output and should probably be gitignored before this is
committed.

---

## 11. If you pick this up

Read `DESIGN.md` first, then `§3` above so the detector does not lie to you,
then run `node scripts/shoot-cockpit.mjs` and look at `.shots/home-phone.png`.
The phone is the surface that matters: the owner opens this from the Telegram
Mini App on an iPhone, most often early in the morning. Every judgement about
this interface should be made against that screenshot, not against the desktop
one and not against the code.
