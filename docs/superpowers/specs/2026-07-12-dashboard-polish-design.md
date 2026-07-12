# Dashboard Local Polish — Vercel/Linear-Flavoured Four-Panel Pass

**Date:** 2026-07-12
**Status:** Approved (user /goal "全部完成")
**Scope:** apps/dashboard (no packages/ui-react changes, no TUI changes, no API / SSE / state-shape changes)

---

## Context

Maximilian's dashboard is React 19 + Vite + Radix + shadcn-style components. The
Workspace tab surfaces five panels (ChatPanel / AgentPanel / TaskPanel / OutputPanel /
ReviewPanel) plus a top-bar `LiveUsagePill`. The four non-Chat panels were built
incrementally across previous feature tasks; their visual language is inconsistent
(mixed Tailwind utility colours, no role-specific tinting, plain task lists with no
execution-flow visualization, file list without inline preview, pill without
expandable breakdown).

The user asked for a check on what could be improved in the frontend UI, scoped
explicitly to "局部优化已有 panel/dialog" (局部优化 = targeted enhancement, not
rearchitect). Design language chosen: **Vercel/Linear-flavoured** — dark-leaning,
high-contrast, minimal motion, mono/geist typography, generous whitespace, all
data visible at a glance. Four panels in scope: **AgentPanel**, **TaskPanel**,
**OutputPanel**, **LiveUsagePill**.

The user's `feedback_minimal_new_concepts` memory biases the design away from
new abstractions: helpers live **inside the dashboard**, not in `packages/ui-react`.
No new dependencies. Reuse existing motion (framer-motion), icon set (lucide-react),
popover primitives (Radix).

---

## Goals

1. Each of the four panels feels coherent and looks intentional (single design
   language across the workspace tab).
2. Information density goes up — runtime state (durations, parallel wave counts,
   per-agent cost share) becomes readable at a glance without clicking through.
3. `LiveUsagePill` is no longer a static label; one click reveals trends.
4. Zero new runtime deps, zero new abstractions shared across packages.
5. CI keeps passing — type-check + tests + Docker dashboard build all green.

## Non-Goals

- No TUI changes.
- No `packages/ui-react` export additions (helpers stay local to dashboard).
- No API / SSE / state-shape / persistence changes.
- No new chart library, no DAG-rendering library, no monaco editor.
- No analytics or event reporting.

---

## Design (Per-Panel)

### 1. AgentPanel — `apps/dashboard/src/components/AgentPanel.tsx`

**Change set:**

- Each agent row gets a **role-tinted `RoleBadge`**:
  `planner=indigo · code=emerald · review=rose · theory=amber`. Colours come from
  existing `--accent-*` theme tokens; only muted backgrounds and saturated text
  are used, no raw colour fills.
- Row left-edge gets a **12-cell monogram block** (P/C/R/T/V) — Linear's
  member-list avatar block. Background = `--accent-{role}` at 12 % opacity;
  foreground = the same colour at 90 %.
- Inline **`StatusDot`** next to the monogram:
  - `idle` → 8 px ring, hollow (border-only)
  - `running` → 8 px solid, indigo, slow pulse via CSS `@keyframes`
    wrapped in `@media (prefers-reduced-motion: no-preference)`
  - `done` → 8 px solid, emerald
  - `error` → 8 px solid, rose
- Row trailing column shows live duration:
  `runtime.execute(startTs, now) → "1.2s"` (refreshed via the same SSE tick
  that the panel already re-renders on; no new interval).
- On `done`, duration freezes and the dot commits to emerald.
- On `error`, the trailing cell shows `(failed after Xs)` and the row gets a
  4 px rose left border.

**New local helper:** `apps/dashboard/src/components/_helpers/StatusDot.tsx`
(status-only prop, 1 px / 8 px / pulse reduced-motion aware).

### 2. TaskPanel — `apps/dashboard/src/components/TaskPanel.tsx`

**Change set:**

Three-phase rendering driven by `tasksByPhase`:

- **Plan phase** (no task has `status: "running"|"complete"` yet): render a
  **minimal horizontal DAG** — one row per task, columns laid out by
  topological level, `dependsOn` edges rendered as ASCII-style connector lines
  via CSS `:before` / `:after` pseudo-elements. No graph layout library.
  Hover a task → tooltip with `description`. Tasks the user hasn't started
  yet are dimmed.
- **Runtime phase**: render a **`WaveIndicator`** strip on top of the task
  list. Strip is one row of N tick cells (1 per task). Wave boundaries are
  computed from `completedAt` timestamps (a new wave starts when ≥1 task
  completes in the previous one). The currently active wave is highlighted
  (indigo fill); done waves are emerald; queued waves are ring-only. Strip
  trail shows `▸ wave M / N · K parallel active`.
- **Done phase**: render a vertical **timeline** of completed-task entries
  sorted by `completedAt`, each showing task description + agent role badge +
  duration. Indent each entry by its `dependsOn` chain depth so reviewers see
  the cascade shape at a glance.

**New local helper:** `apps/dashboard/src/components/_helpers/WaveIndicator.tsx`
— pure presentational, takes `waves: Wave[]` prop where `Wave = { status,
tickCount, activeCount, boundaries }`.

### 3. OutputPanel — `apps/dashboard/src/components/OutputPanel.tsx`

**Change set:**

- File list becomes a **3-or-4-column responsive grid** (CSS grid, no
  library). Card per artifact shows: mime-type icon (lucide; md/text ·
  image · code · csv), size, generated-at timestamp, optional streaming
  indicator (animated dot).
- Clicking a card opens a **Radix `Dialog` with inline preview** —
  no navigation. Preview dispatches on mime:
  - `text/markdown` → existing markdown renderer (already used elsewhere
    in app); fallback to plain pre.
  - `image/*` → `<img>` with object-fit contain, max-h 80vh.
  - `text/csv` → simple `<table>` render (parse via `papaparse` — add as a
    dep **only here if needed**, or fall back to plain `<pre>` if not
    already in graph).
  - everything else → `<pre>` with line numbers.
- Dialog closes on Escape; **j / k vim-style navigation** cycles between
  artifacts in the same workspace (focus stays on dialog body so a
  single keystroke works). Implemented via `useKey` from `@max/ui-state`
  if it already exposes one, otherwise a tiny local `useKey` listener on
  the dialog content ref.

**New local helper:** `apps/dashboard/src/components/_helpers/ArtifactPreview.tsx`
— mime-dispatching component, accessible name attr via Radix Dialog
`Dialog.Title`.

### 4. LiveUsagePill — `apps/dashboard/src/components/LiveUsagePill.tsx`

**Change set:**

- The pill becomes **clickable** and opens a **`Popover`** (Radix
  `Popover` / `PopoverTrigger` + `PopoverContent`). Pill role becomes
  `button`; pre-existing click handler `onOpenUsage` (which navigates to the
  Usage tab) moves to an explicit `Open full dashboard →` link inside
  popover content.
- Popover content (max-w 360 px, p-4, sticky-positioned beside pill):
  - **Sparkline** (24 h token usage, SVG inline, ~12 control points from
    bucketed aggregates already served by `/api/usage`). No chart library;
    SVG path computed from the data array.
  - Stat block: today's **cost** ($) computed at the rate returned by
    `/api/usage` config; **avg latency** from `/api/usage/latency`; current
    active agent count from React state already tracking agents in the
    workspace.
  - **Per-agent breakdown**: 5 rows max (top 5 by token share); each row
    shows the role badge + horizontal bar (width = share of total tokens).
    Bar component is the local `Sparkline` retargeted to a single segment,
    or a tiny inline `<span>` with `width: ${pct}%`.

**New local helper:** `apps/dashboard/src/components/_helpers/Sparkline.tsx`
— props `{ values: number[]; width?: number; height?: number; stroke?: string }`.
Renders an inline `<svg>` with a single `<polyline>`.

---

## Cross-Cutting Details

### Typography

- `Geist` and `Geist Mono` fonts are already shipped with the dashboard
  (`index.html`). Use them:
  - All panel titles: `font-mono text-xs uppercase tracking-wider
text-muted-foreground`.
  - All primary numbers (durations, token counts, costs): `font-mono
tabular-nums`.

### Colour tokens

- Reuse existing `--accent-{indigo,emerald,rose,amber}` defined in
  `apps/dashboard/src/theme.css`. If a **muted variant** is missing, add
  one — e.g. `--accent-indigo-muted: rgb(99 102 241 / 0.12)`. No raw hex
  colours in component CSS.

### Motion

- framer-motion is already a dep. Use `motion.li` or `AnimatePresence`
  sparingly: only for popover, dialog open/close, and status-dot pulse.
- Add a `useReducedMotion()`-gated branch on every animated component —
  default to no animation when the user prefers reduced motion.

### i18n

- All visible user-facing strings route through `t("...")` from
  `@max/i18n`. New keys:
  - `agent.role.planner`, `agent.role.code`, `agent.role.review`,
    `agent.role.theory`, `agent.role.verifier` (if those roles exist).
  - `agent.status.{idle,running,done,error}`.
  - `task.phase.{plan,runtime,done}`.
  - `task.wave.label` ("wave M / N").
  - `artifact.preview.{title,empty,close}`.
  - `usage.popover.{title,fullDashboard,costLabel,latencyLabel,
activeAgentsLabel,perAgentBreakdown}`.
- Add entries to **zh-CN** and **en** locales. The repo's i18n source-of-truth
  pattern (English-first) is preserved.

### Accessibility

- All interactive elements stay keyboard-reachable; Radix primitives give
  this for free but the new monogram blocks need `aria-label={role}` set
  from the role enum.
- StatusDot's text-style alternative (`sr-only` "running") added for screen
  readers.

---

## Architecture / File Layout

```
apps/dashboard/src/components/
├── AgentPanel.tsx                  (rewrite body; props unchanged)
├── TaskPanel.tsx                   (rewrite body; props unchanged)
├── OutputPanel.tsx                 (rewrite body; props unchanged)
├── LiveUsagePill.tsx               (rewrite body; props unchanged)
└── _helpers/                       (new directory)
    ├── StatusDot.tsx
    ├── WaveIndicator.tsx
    ├── ArtifactPreview.tsx
    └── Sparkline.tsx
apps/dashboard/test/
├── status-dot.test.tsx
├── wave-indicator.test.tsx
├── sparkline.test.tsx
└── artifact-preview.test.tsx       (mime dispatch + reduced-motion)
```

`packages/ui-react/`, `apps/tui/`, `apps/api/`, **any** consumer of these
panels — untouched.

---

## Data Flow (unchanged)

- The four panels continue to read from the same React state in `App.tsx`
  (`workspace`, `events`) populated by `chatApi.chat` + `EventSource` on
  `/api/workspaces/:id/stream`. No new fetches, no new polling, no new
  endpoints.
- `LiveUsagePill` continues to call `useLiveUsage()` (30s polling,
  existing). Popover uses the same data; the sparkline reads aggregates
  already returned.
- `ArtifactPreview` reads from the existing `workspaces/:id/artifacts`
  endpoint surfaced via the existing `OutputPanel` API; no new endpoints.

---

## Testing

### Unit (vitest + RTL)

- `StatusDot.test.tsx` — colour map by status; reduced-motion branch
  produces no pulse.
- `WaveIndicator.test.tsx` — given `waves` array, renders the right tick
  count, active wave index highlighted, `M / N` text correct.
- `Sparkline.test.tsx` — empty array → empty SVG; 1-element array →
  single dot; renders `<polyline points="…">` matching the values.
- `ArtifactPreview.test.tsx` — mime dispatch: markdown→rendered HTML,
  image→`<img>`, csv→table, fallback→`<pre>`. Each case asserts the
  rendered element selector.

### Snapshot

- `Sparkline` and `WaveIndicator` get a `.toMatchSnapshot()` for visual
  regression (sanity-check the path output).

### Visual regression

- Storybook stories for the four helpers under `packages/ui-react/src/_stories/`
  are out of scope here (kept out per "no ui-react changes"). Instead, the
  dashboard tests use `getByRole` + class assertions to lock down
  layout-critical class strings (`status-dot--running`, `wave-indicator__tick--active`).

### CI

- `pnpm type-check`, `pnpm test --filter @max/dashboard`, dashboard build
  (`pnpm --filter @max/dashboard run build`) all pass.
- Docker dashboard build (`apps/dashboard/Dockerfile`) keeps passing —
  no Dockerfile change.

---

## Rollout

- **Single commit**: `fix(ui): local polish — Vercel/Linear four-panel pass`.
  The four panels are mutually reinforcing; splitting across N PRs adds
  review overhead without benefit, and the cross-panel coherence is the
  point.
- Push to `main`. CI reruns; docker-publish will rebuild the dashboard
  image.
- Post-deploy: smoke-check the live dashboard for any obvious regression
  in the four panels (`/workspace` tab + a fresh chat session).

---

## Edge Cases

- **No live workspace** (initial load, before `chatApi.chat` returns):
  all four panels render their existing empty-state copy unchanged.
- **Failed workspace** (`status: "failed"`): TaskPanel still shows a
  timeline (with the failed task flagged rose); OutputPanel still
  shows any partial artifacts; AgentPanel still shows agents that ran
  with their final status.
- **Reduced motion**: dot pulses and popover transitions become instant;
  sparkline and DAG still render — they're static SVG.
- **Long content** (very deep plan, very large artifact): containers
  scroll; sparkline width clamps at 360 px; dialog body max-h 80vh +
  overflow-y auto.

---

## Open Questions (none remaining)

All clarified with the user via the brainstorm flow:

- Scope: 局部优化 ✅
- Panels in scope: AgentPanel / TaskPanel / OutputPanel / LiveUsagePill ✅
- Design language: Vercel/Linear ✅
- Approach: Scoped style pass (no ui-react extraction, no new deps) ✅
- Single commit vs split: single commit ✅

---

## Spec Self-Review (filled at write time)

- **Placeholder scan**: no "TBD" / "TODO" left in the spec.
- **Internal consistency**: each helper section names the same file path
  (`_helpers/...`); per-panel "new helper" bullets match the file-list
  above. Single-commit rule matches the Rollout section.
- **Scope check**: one focused implementation — four panels in one app,
  no shared-package changes. Sized for a single implementation plan.
- **Ambiguity check**: ambiguous phrases caught and pinned down —
  "linear-style" → Geist mono + tabular-nums; "wave" → explicitly defined
  as bounded by the previous wave's last `completedAt`; "muted variant" →
  `--accent-X-muted` token convention.
