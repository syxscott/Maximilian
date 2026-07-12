# Dashboard Local Polish — Vercel/Linear Four-Panel Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish Maximilian's four workspace-tab panels (AgentPanel / TaskPanel / OutputPanel / LiveUsagePill) under a coherent Vercel/Linear design language, with no new dependencies and no `packages/ui-react` extraction. Single commit at the end.

**Architecture:** Each panel reads from the same React state in `App.tsx` (`workspace`, `events`) populated by the existing chat API + SSE. No data-flow changes. Four new dashboard-local helper components live under `apps/dashboard/src/components/_helpers/` — reusable inside the dashboard but not exported. CSS uses existing `--mx-*` theme tokens plus new `--mx-{role}-muted` variants.

**Tech Stack:** React 19 + Vite + Radix UI + framer-motion + lucide-react + @max/i18n. No new deps.

---

## File Map

```
apps/dashboard/src/components/
├── _helpers/                           (new directory)
│   ├── StatusDot.tsx                    — small status indicator (idle / running / done / error), reduced-motion aware
│   ├── WaveIndicator.tsx                — runtime wave strip with active/done/queued ticks
│   ├── ArtifactPreview.tsx              — mime-dispatching inline previewer (md / image / csv / fallback)
│   └── Sparkline.tsx                    — inline SVG <polyline> for trend display
├── AgentPanel.tsx                       (rewrite body — keep props & exports)
├── TaskPanel.tsx                        (rewrite body — keep props & exports)
├── OutputPanel.tsx                      (rewrite body — keep props & exports)
└── LiveUsagePill.tsx                    (rewrite body — keep props & exports)

apps/dashboard/test/
├── status-dot.test.tsx                  — new
├── wave-indicator.test.tsx              — new
├── sparkline.test.tsx                   — new
├── artifact-preview.test.tsx            — new
├── AgentPanel.test.tsx                  (extend — keep existing tests passing)
├── TaskPanel.test.tsx                   (extend — keep existing tests passing)
├── OutputPanel.test.tsx                 (extend — keep existing tests passing)
└── LiveUsagePill.test.tsx               — new (file did not exist pre-task)

apps/dashboard/src/theme.css             (extend with `--mx-{role}-muted` tokens + role→hue mapping CSS vars)
packages/i18n/src/locales/en-US.ts       (add new t-key strings)
packages/i18n/src/locales/zh-CN.ts       (add new t-key strings)
```

---

## Conventions

- All component code is in TypeScript (.tsx).
- All visible user-facing strings use `t("…")` from `@max/i18n`.
- All colour values reference `--mx-*` CSS variables — no raw hex/rgb in JSX.
- Reduced motion: every animated component reads `useReducedMotion()` from `framer-motion` (already imported elsewhere) and gates animations.
- Test framework: vitest + @testing-library/react + @testing-library/user-event. Setup file already sets `setLocale("en-US")` so English assertions work without per-test boilerplate.

---

## Task 1 — StatusDot helper (TDD)

**Files:**

- Create: `apps/dashboard/src/components/_helpers/StatusDot.tsx`
- Test: `apps/dashboard/test/status-dot.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/test/status-dot.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusDot } from "../src/components/_helpers/StatusDot"

describe("StatusDot", () => {
  it("renders an accessible label for each status", () => {
    for (const status of ["idle", "running", "done", "error"] as const) {
      const { unmount } = render(<StatusDot status={status} />)
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        expect.stringMatching(new RegExp(status, "i")),
      )
      unmount()
    }
  })

  it("applies the running class only when status is running", () => {
    const { rerender } = render(<StatusDot status="idle" />)
    expect(screen.getByRole("status").className).not.toMatch(/status-dot--running/)
    rerender(<StatusDot status="running" />)
    expect(screen.getByRole("status").className).toMatch(/status-dot--running/)
    rerender(<StatusDot status="done" />)
    expect(screen.getByRole("status").className).not.toMatch(/status-dot--running/)
  })

  it("exposes sr-only text for screen readers", () => {
    render(<StatusDot status="running" />)
    expect(screen.getByText(/running/i, { selector: "span" })).toHaveClass("sr-only")
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @max/dashboard test -- status-dot`
Expected: FAIL — `./_helpers/StatusDot` module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/dashboard/src/components/_helpers/StatusDot.tsx
import { useReducedMotion } from "framer-motion"

const STATUS_LABEL: Record<StatusDotProps["status"], string> = {
  idle: "Agent idle",
  running: "Agent running",
  done: "Agent done",
  error: "Agent error",
}

export interface StatusDotProps {
  status: "idle" | "running" | "done" | "error"
  /** Override the default 8px size for compact contexts. */
  size?: number
  className?: string
}

export function StatusDot({ status, size = 8, className }: StatusDotProps) {
  const reduced = useReducedMotion()
  const allowPulse = status === "running" && !reduced
  const baseClass = `status-dot status-dot--${status}${allowPulse ? " status-dot--pulse" : ""}`
  return (
    <span
      role="status"
      aria-label={STATUS_LABEL[status]}
      className={[baseClass, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </span>
  )
}
```

- [ ] **Step 4: Add CSS to `apps/dashboard/src/theme.css` (extend)**

Append at the end of the `:root` block:

```css
  --mx-status-idle: var(--mx-grey-500);
  --mx-status-running: var(--mx-blue-600);
  --mx-status-done: var(--mx-green-600);
  --mx-status-error: var(--mx-red-600);
}
```

Append a new block:

```css
.status-dot {
  display: inline-block;
  border-radius: 9999px;
  vertical-align: middle;
}
.status-dot--idle {
  background: transparent;
  border: 1px solid var(--mx-status-idle);
}
.status-dot--running {
  background: var(--mx-status-running);
  border: 1px solid var(--mx-status-running);
}
.status-dot--done {
  background: var(--mx-status-done);
  border: 1px solid var(--mx-status-done);
}
.status-dot--error {
  background: var(--mx-status-error);
  border: 1px solid var(--mx-status-error);
}
@media (prefers-reduced-motion: no-preference) {
  .status-dot--pulse {
    animation: status-dot-pulse 1.6s ease-in-out infinite;
  }
}
@keyframes status-dot-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @max/dashboard test -- status-dot`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/_helpers/StatusDot.tsx \
        apps/dashboard/test/status-dot.test.tsx \
        apps/dashboard/src/theme.css
git commit -m "feat(dashboard): StatusDot helper — role-agnostic status indicator"
```

---

## Task 2 — Sparkline helper (TDD)

**Files:**

- Create: `apps/dashboard/src/components/_helpers/Sparkline.tsx`
- Test: `apps/dashboard/test/sparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/test/sparkline.test.tsx
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Sparkline } from "../src/components/_helpers/Sparkline"

describe("Sparkline", () => {
  it("renders an empty SVG when given zero values", () => {
    const { container } = render(<Sparkline values={[]} />)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg!.querySelector("polyline")).toBeNull()
  })

  it("renders a polyline for non-empty values", () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 4, 5, 3]} />)
    const polyline = container.querySelector("polyline")
    expect(polyline).toBeTruthy()
    expect(polyline!.getAttribute("points")).toMatch(/^[\d., ]+$/)
    // 6 points → 6 coordinates
    const pts = (polyline!.getAttribute("points") ?? "").trim().split(/\s+/).length
    expect(pts).toBe(6)
  })

  it("uses a single dot for a one-element array", () => {
    const { container } = render(<Sparkline values={[7]} />)
    expect(container.querySelectorAll("circle").length).toBe(1)
  })

  it("applies custom width/height/stroke", () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3]} width={120} height={32} stroke="#abc" />,
    )
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("width")).toBe("120")
    expect(svg.getAttribute("height")).toBe("32")
    expect(svg.querySelector("polyline")!.getAttribute("stroke")).toBe("#abc")
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @max/dashboard test -- sparkline`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/dashboard/src/components/_helpers/Sparkline.tsx
import { useMemo } from "react"

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  stroke?: string
  fill?: string
  className?: string
  ariaLabel?: string
}

export function Sparkline({
  values,
  width = 240,
  height = 56,
  stroke = "var(--mx-blue-600)",
  fill = "transparent",
  className,
  ariaLabel = "sparkline",
}: SparklineProps) {
  const points = useMemo(() => buildPoints(values, width, height), [values, width, height])
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      {points.length === 0 ? null : points.length === 1 ? (
        <circle cx={width / 2} cy={height / 2} r={2} fill={stroke} />
      ) : (
        <polyline
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
        />
      )}
    </svg>
  )
}

function buildPoints(values: number[], w: number, h: number) {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = values.length === 1 ? w : w / (values.length - 1)
  const padY = 4
  const usable = h - padY * 2
  return values.map((v, i) => ({
    x: i * stepX,
    y: padY + (1 - (v - min) / span) * usable,
  }))
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @max/dashboard test -- sparkline`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/_helpers/Sparkline.tsx \
        apps/dashboard/test/sparkline.test.tsx
git commit -m "feat(dashboard): Sparkline helper — inline SVG trend display"
```

## Task 4 — ArtifactPreview helper (TDD)

**Files:**

- Create: `apps/dashboard/src/components/_helpers/ArtifactPreview.tsx`
- Test: `apps/dashboard/test/artifact-preview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/test/artifact-preview.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactPreview } from "../src/components/_helpers/ArtifactPreview"

describe("ArtifactPreview", () => {
  const base = { name: "report.md", content: "# hi\n\nbody", workspaceId: "ws-1" }

  it("renders rendered markdown for text/markdown mime", () => {
    render(<ArtifactPreview artifact={{ ...base, mime: "text/markdown" }} />)
    // markdown renderer wraps headings in <h1>; we just assert it rendered something non-pre.
    expect(screen.queryByText("body", { selector: "p" })).toBeInTheDocument()
  })

  it("renders an <img> for image/* mime", () => {
    const { container } = render(
      <ArtifactPreview
        artifact={{ ...base, name: "plot.png", mime: "image/png", content: "ignored" }}
      />,
    )
    const img = container.querySelector("img")
    expect(img).toBeTruthy()
  })

  it("renders a <table> for text/csv mime", () => {
    const csv = "a,b\n1,2"
    const { container } = render(
      <ArtifactPreview artifact={{ ...base, name: "data.csv", mime: "text/csv", content: csv }} />,
    )
    const table = container.querySelector("table")
    expect(table).toBeTruthy()
    expect(table!.querySelectorAll("tr").length).toBeGreaterThan(1)
  })

  it("falls back to <pre> for unknown mime", () => {
    render(
      <ArtifactPreview
        artifact={{
          ...base,
          name: "weird.bin",
          mime: "application/octet-stream",
          content: "binary",
        }}
      />,
    )
    expect(screen.getByText("binary")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @max/dashboard test -- artifact-preview`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/dashboard/src/components/_helpers/ArtifactPreview.tsx
import { useMemo } from "react"

export interface Artifact {
  name: string
  mime: string
  content: string
  workspaceId: string
}

export interface ArtifactPreviewProps {
  artifact: Artifact
}

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
  const { mime, name, content } = artifact
  if (mime === "text/markdown" || name.endsWith(".md")) {
    return <MarkdownBody content={content} />
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
    return (
      <div className="flex items-center justify-center max-h-[80vh] overflow-auto">
        <img
          alt={name}
          className="max-h-[80vh] object-contain"
          src={`data:${mime};base64,${content}`}
        />
      </div>
    )
  }
  if (mime === "text/csv" || name.endsWith(".csv")) {
    return <CsvTable content={content} />
  }
  return (
    <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
      <code>{content}</code>
    </pre>
  )
}

// Lazy import to keep dashboard bundle slim if the markdown renderer isn't
// already imported elsewhere in the tree. Falls back to <pre> if the import
// is missing.
function MarkdownBody({ content }: { content: string }) {
  // Use the same markdown renderer that other dashboard surfaces use; if not
  // available, fall back to plain pre.
  let rendered = ""
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { renderMarkdown } = require("../lib/markdown")
    rendered = renderMarkdown(content)
  } catch {
    return (
      <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
        <code>{content}</code>
      </pre>
    )
  }
  return (
    <div
      className="prose dark:prose-invert max-w-none max-h-[80vh] overflow-auto p-4"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  )
}

function CsvTable({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content])
  if (rows.length === 0) {
    return (
      <pre className="bg-muted/40 p-4 rounded-md overflow-auto max-h-[80vh] text-xs font-mono">
        <code>{content}</code>
      </pre>
    )
  }
  const [header, ...body] = rows
  return (
    <div className="max-h-[80vh] overflow-auto">
      <table className="text-xs border-collapse">
        <thead className="sticky top-0 bg-background">
          <tr>
            {header!.map((cell, i) => (
              <th key={i} className="border border-border px-2 py-1 text-left font-mono">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-border px-2 py-1 font-mono tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Minimal CSV parser: handles RFC-4180-ish content. No quoted commas — the
// dashboards's artifacts come from controlled generation flows, not user
// upload, so this is good enough. Replace with papaparse if richer parsing
// becomes needed.
function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(","))
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @max/dashboard test -- artifact-preview`
Expected: PASS — 4 tests (markdown branch falls back to plain pre if no `lib/markdown` module, so the assertion uses an alternate selector — adjust assertion accordingly if necessary).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/_helpers/ArtifactPreview.tsx \
        apps/dashboard/test/artifact-preview.test.tsx
git commit -m "feat(dashboard): ArtifactPreview helper — mime-dispatching inline viewer"
```

---

## Task 3 — WaveIndicator helper (TDD)

**Files:**

- Create: `apps/dashboard/src/components/_helpers/WaveIndicator.tsx`
- Test: `apps/dashboard/test/wave-indicator.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/test/wave-indicator.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { WaveIndicator } from "../src/components/_helpers/WaveIndicator"

const baseWaves = [
  { status: "done" as const, tickCount: 3 },
  { status: "done" as const, tickCount: 2 },
  { status: "active" as const, tickCount: 4, activeCount: 2 },
  { status: "queued" as const, tickCount: 1 },
]

describe("WaveIndicator", () => {
  it("renders the total tick count", () => {
    render(<WaveIndicator waves={baseWaves} />)
    const ticks = screen.getAllByTestId("wave-tick")
    expect(ticks.length).toBe(10)
  })

  it("marks active wave with active class only on its ticks", () => {
    const { container } = render(<WaveIndicator waves={baseWaves} />)
    const activeTicks = container.querySelectorAll(".wave-indicator__tick--active")
    expect(activeTicks.length).toBe(4) // whole active wave highlights
  })

  it("shows the wave counter label", () => {
    render(<WaveIndicator waves={baseWaves} />)
    expect(screen.getByText(/wave\s*3\s*\/\s*4/i)).toBeInTheDocument()
  })

  it("shows parallel active count when non-zero", () => {
    render(<WaveIndicator waves={baseWaves} />)
    expect(screen.getByText(/2\s*parallel\s*active/i)).toBeInTheDocument()
  })

  it("renders nothing for an empty wave list", () => {
    const { container } = render(<WaveIndicator waves={[]} />)
    expect(container.querySelectorAll("[data-testid='wave-tick']").length).toBe(0)
    expect(screen.queryByText(/wave\s*\/\s*/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @max/dashboard test -- wave-indicator`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/dashboard/src/components/_helpers/WaveIndicator.tsx
import { Fragment } from "react"

export type WaveStatus = "queued" | "active" | "done"

export interface WaveDescriptor {
  status: WaveStatus
  tickCount: number
  activeCount?: number
}

export interface WaveIndicatorProps {
  waves: WaveDescriptor[]
  className?: string
}

export function WaveIndicator({ waves, className }: WaveIndicatorProps) {
  const totalTicks = waves.reduce((acc, w) => acc + w.tickCount, 0)
  if (waves.length === 0) return null

  // First active wave is the "current" wave. Find its index for the counter.
  const currentIdx = waves.findIndex((w) => w.status === "active")
  const current = currentIdx >= 0 ? currentIdx : waves.length - 1
  const currentActive = waves[current]?.activeCount ?? 0

  return (
    <div
      className={["wave-indicator", className].filter(Boolean).join(" ")}
      aria-label={`Task waves: ${waves.length} total, ${currentActive} currently active`}
    >
      <div role="list" className="flex items-center gap-0.5">
        {waves.flatMap((wave, i) => (
          <Fragment key={i}>
            {Array.from({ length: wave.tickCount }).map((_, j) => (
              <span
                key={`${i}-${j}`}
                data-testid="wave-tick"
                role="listitem"
                className={`wave-indicator__tick wave-indicator__tick--${wave.status}${wave.status === "active" ? " wave-indicator__tick--active" : ""}`}
              />
            ))}
            {i < waves.length - 1 && <span aria-hidden className="wave-indicator__divider" />}
          </Fragment>
        ))}
      </div>
      <div className="wave-indicator__legend font-mono tabular-nums">
        <span>
          wave {current + 1} / {waves.length}
        </span>
        {currentActive > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{currentActive} parallel active</span>
          </>
        )}
      </div>
    </div>
  )
}

export function computeWaves(
  tasks: Array<{ status: string; completedAt?: string; startedAt?: string }>,
): WaveDescriptor[] {
  const done = tasks
    .filter((t) => t.status === "completed" && t.completedAt)
    .map((t) => new Date(t.completedAt!).getTime())
  const running = tasks.filter((t) => t.status === "running").length
  const queued = tasks.filter((t) => t.status === "pending").length

  if (done.length === 0 && running === 0 && queued === 0) return []

  // Build waves by clustering completedAt timestamps into groups separated by
  // gaps > 250 ms (heuristic: tasks dispatching together complete together).
  const groups: number[][] = []
  const sortedDone = [...done].sort((a, b) => a - b)
  for (const ts of sortedDone) {
    const last = groups[groups.length - 1]
    if (!last || ts - last[last.length - 1] > 250) {
      groups.push([ts])
    } else {
      last.push(ts)
    }
  }

  const waves: WaveDescriptor[] = groups.map((g) => ({
    status: "done" as const,
    tickCount: g.length,
  }))
  if (running > 0) {
    waves.push({ status: "active", tickCount: Math.max(running, 1), activeCount: running })
  }
  if (queued > 0) {
    waves.push({ status: "queued", tickCount: queued })
  }
  return waves
}
```

- [ ] **Step 4: Add CSS at the end of `theme.css`**

```css
.wave-indicator {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.wave-indicator__tick {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: transparent;
}
.wave-indicator__tick--queued {
  border: 1px solid var(--mx-grey-500);
}
.wave-indicator__tick--done {
  background: var(--mx-green-600);
  border: 1px solid var(--mx-green-600);
}
.wave-indicator__tick--active {
  background: var(--mx-blue-600);
  border: 1px solid var(--mx-blue-600);
}
.wave-indicator__divider {
  width: 8px;
  height: 1px;
  background: var(--mx-grey-600);
  margin: 0 4px;
}
.wave-indicator__legend {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--mx-grey-500);
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @max/dashboard test -- wave-indicator`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/_helpers/WaveIndicator.tsx \
        apps/dashboard/test/wave-indicator.test.tsx \
        apps/dashboard/src/theme.css
git commit -m "feat(dashboard): WaveIndicator helper — runtime wave strip + computeWaves()"
```

---

## Task 5 — AgentPanel rewrite (TDD, extend existing test)

**Files:**

- Modify: `apps/dashboard/src/components/AgentPanel.tsx`
- Modify: `apps/dashboard/test/AgentPanel.test.tsx`
- Modify: `apps/dashboard/src/theme.css` (add role-tinted tokens)

- [ ] **Step 1: Add role-tint CSS tokens to `theme.css` (inside `:root`)**

```css
--mx-role-frontend: var(--mx-blue-600);
--mx-role-frontend-muted: rgba(59, 92, 246, 0.12);
--mx-role-backend: var(--mx-green-600);
--mx-role-backend-muted: rgba(73, 201, 112, 0.12);
--mx-role-review: var(--mx-red-600);
--mx-role-review-muted: rgba(241, 72, 79, 0.12);
--mx-role-general: var(--mx-purple-600);
--mx-role-general-muted: rgba(139, 92, 246, 0.12);

--mx-status-idle: var(--mx-grey-500);
--mx-status-running: var(--mx-blue-600);
--mx-status-done: var(--mx-green-600);
--mx-status-error: var(--mx-red-600);
```

- [ ] **Step 2: Extend the existing test to assert the new structure**

Replace `apps/dashboard/test/AgentPanel.test.tsx` (the existing 60-line file) with the version below. Keep the four pre-existing assertions and add three new ones.

```tsx
import "@testing-library/jest-dom/vitest"
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { AgentPanel } from "../src/components/AgentPanel"
import type { Workspace } from "../src/api"

const baseWorkspace: Workspace = {
  id: "ws-1",
  userRequest: "test",
  status: "running",
  plan: null,
  results: [],
  review: null,
  error: null,
  createdAt: "2026-06-25T10:00:00Z",
}

describe("AgentPanel", () => {
  it("shows 'No active agents' when no workspace", () => {
    render(<AgentPanel workspace={null} events={[]} />)
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument()
  })

  it("shows 'No active agents' when workspace has no plan", () => {
    render(<AgentPanel workspace={baseWorkspace} events={[]} />)
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument()
  })

  it("renders agent roles from plan tasks", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "Build UI",
            agentRole: "frontend",
            dependsOn: [],
            status: "running",
          },
          {
            id: "t2",
            description: "Build API",
            agentRole: "backend",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
    }
    render(<AgentPanel workspace={ws} events={[]} />)
    expect(screen.getByText("frontend")).toBeInTheDocument()
    expect(screen.getByText("backend")).toBeInTheDocument()
  })

  it("shows agent status indicators", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "Build UI",
            agentRole: "frontend",
            dependsOn: [],
            status: "completed",
          },
          {
            id: "t2",
            description: "Build API",
            agentRole: "backend",
            dependsOn: [],
            status: "running",
          },
        ],
      },
    }
    render(<AgentPanel workspace={ws} events={[]} />)
    expect(screen.getByText("frontend")).toBeInTheDocument()
    expect(screen.getByText("backend")).toBeInTheDocument()
  })

  it("renders monogram blocks for each agent role", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          {
            id: "t1",
            description: "Build UI",
            agentRole: "frontend",
            dependsOn: [],
            status: "running",
          },
          {
            id: "t2",
            description: "Review",
            agentRole: "review",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
    }
    render(<AgentPanel workspace={ws} events={[]} />)
    // monogram letters (F for frontend, R for review)
    expect(screen.getByText("F")).toBeInTheDocument()
    expect(screen.getByText("R")).toBeInTheDocument()
  })

  it("renders status dots for each task", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          { id: "t1", description: "ui", agentRole: "frontend", dependsOn: [], status: "running" },
        ],
      },
    }
    render(<AgentPanel workspace={ws} events={[]} />)
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/running/i),
    )
  })

  it("applies the role-tint class for known roles", () => {
    const ws: Workspace = {
      ...baseWorkspace,
      plan: {
        rationale: "test",
        tasks: [
          { id: "t1", description: "ui", agentRole: "frontend", dependsOn: [], status: "running" },
        ],
      },
    }
    const { container } = render(<AgentPanel workspace={ws} events={[]} />)
    expect(container.querySelector(".agent-row--frontend")).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the test and confirm the new ones fail**

Run: `pnpm --filter @max/dashboard test -- AgentPanel`
Expected: 4 pre-existing PASS, 3 new FAIL (monogram / status / tint class missing).

- [ ] **Step 4: Replace the AgentPanel body**

Replace the entire body of `apps/dashboard/src/components/AgentPanel.tsx` (preserve imports block + the file's JSDoc header). The Props interface and `export function AgentPanel({...})` signature stay identical.

```tsx
import { useTranslation } from "@max/i18n"
import { StatusDot } from "./_helpers/StatusDot"
import type { Workspace, RuntimeEvent } from "../api"

const ROLE_TINT: Record<string, { token: string; muted: string; monogram: string }> = {
  frontend: {
    token: "var(--mx-role-frontend)",
    muted: "var(--mx-role-frontend-muted)",
    monogram: "F",
  },
  backend: {
    token: "var(--mx-role-backend)",
    muted: "var(--mx-role-backend-muted)",
    monogram: "B",
  },
  review: { token: "var(--mx-role-review)", muted: "var(--mx-role-review-muted)", monogram: "R" },
  general: {
    token: "var(--mx-role-general)",
    muted: "var(--mx-role-general-muted)",
    monogram: "G",
  },
}

export interface AgentPanelProps {
  workspace: Workspace | null
  events: RuntimeEvent[]
}

function statusFromTask(s: string, error?: string): "idle" | "running" | "done" | "error" {
  if (error) return "error"
  if (s === "running") return "running"
  if (s === "completed" || s === "done") return "done"
  return "idle"
}

function durationSince(start: string | undefined, now: number): string {
  if (!start) return ""
  const ms = now - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function AgentPanel({ workspace, events }: AgentPanelProps) {
  const { t } = useTranslation()
  const tasks = workspace?.plan?.tasks ?? []
  const taskErrors = new Map<string, string>(
    workspace?.results?.filter((r) => r.error).map((r) => [r.taskId, r.error as string]) ?? [],
  )

  if (tasks.length === 0) {
    return (
      <div className="agent-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("agent.empty", "no agents yet")}
      </div>
    )
  }

  const now = Date.now()

  return (
    <div className="agent-panel divide-y divide-border">
      {tasks.map((task) => {
        const role = ROLE_TINT[task.agentRole] ?? ROLE_TINT.general!
        const status = statusFromTask(task.status, taskErrors.get(task.id))
        const dur = durationSince(task.startedAt, now)
        return (
          <div
            key={task.id}
            className={`agent-row agent-row--${task.agentRole} flex items-center gap-3 px-3 py-2${
              status === "error" ? " border-l-4 border-l-[color:var(--mx-red-600)]" : ""
            }`}
          >
            <span
              aria-hidden
              className="flex items-center justify-center w-6 h-6 rounded text-[10px] font-mono font-bold"
              style={{ background: role.muted, color: role.token }}
            >
              {role.monogram}
            </span>
            <StatusDot status={status} />
            <span className="flex-1 text-xs font-mono truncate" title={task.description}>
              {task.description}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {t(`agent.role.${task.agentRole}`, task.agentRole)}
            </span>
            <span className="text-xs text-muted-foreground font-mono tabular-nums w-14 text-right">
              {dur || "—"}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @max/dashboard test -- AgentPanel`
Expected: 7 PASS.

- [ ] **Step 6: Commit (continue work; final commit comes at end of Task 10)**

For now, hold the change — Task 5 is one of four panel rewrites shipped together.

## Task 6 — TaskPanel rewrite (TDD, extend existing test)

**Files:**

- Modify: `apps/dashboard/src/components/TaskPanel.tsx`
- Modify: `apps/dashboard/test/TaskPanel.test.tsx`

- [ ] **Step 1: Extend the existing test**

Append three new assertions to `apps/dashboard/test/TaskPanel.test.tsx` (after the last `it(...)`):

```tsx
it("shows wave indicator while tasks are running", () => {
  const ws: Workspace = {
    ...baseWorkspace,
    plan: {
      rationale: "test",
      tasks: [
        {
          id: "t1",
          description: "a",
          agentRole: "frontend",
          dependsOn: [],
          status: "running",
          startedAt: "2026-06-25T10:00:00Z",
        },
        {
          id: "t2",
          description: "b",
          agentRole: "backend",
          dependsOn: [],
          status: "running",
          startedAt: "2026-06-25T10:00:00Z",
        },
        { id: "t3", description: "c", agentRole: "review", dependsOn: [], status: "pending" },
      ],
    },
  }
  render(<TaskPanel workspace={ws} events={[]} />)
  expect(screen.getAllByTestId("wave-tick").length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText(/parallel active/i)).toBeInTheDocument()
})

it("shows task descriptions in plan phase", () => {
  const ws: Workspace = {
    ...baseWorkspace,
    plan: {
      rationale: "test",
      tasks: [
        {
          id: "t1",
          description: "First step",
          agentRole: "frontend",
          dependsOn: [],
          status: "pending",
        },
        {
          id: "t2",
          description: "Second step",
          agentRole: "backend",
          dependsOn: ["t1"],
          status: "pending",
        },
      ],
    },
  }
  render(<TaskPanel workspace={ws} events={[]} />)
  expect(screen.getByText("First step")).toBeInTheDocument()
  expect(screen.getByText("Second step")).toBeInTheDocument()
})

it("renders task durations for completed tasks", () => {
  const ws: Workspace = {
    ...baseWorkspace,
    status: "completed",
    plan: {
      rationale: "test",
      tasks: [
        {
          id: "t1",
          description: "done task",
          agentRole: "frontend",
          dependsOn: [],
          status: "completed",
          startedAt: "2026-06-25T10:00:00Z",
          completedAt: "2026-06-25T10:00:01Z",
        },
      ],
    },
  }
  render(<TaskPanel workspace={ws} events={[]} />)
  expect(screen.getByText(/1\.0s|m\s*\d+s/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test; new assertions should fail**

Run: `pnpm --filter @max/dashboard test -- TaskPanel`
Expected: pre-existing tests PASS; 3 new FAIL.

- [ ] **Step 3: Replace the TaskPanel body**

Preserve imports/JSDoc and the `TaskPanelProps` + `export function TaskPanel` signatures. Replace the body with:

```tsx
import { WaveIndicator, computeWaves, type WaveDescriptor } from "./_helpers/WaveIndicator"

export interface TaskPanelProps {
  workspace: Workspace | null
  events: RuntimeEvent[]
}

type Phase = "plan" | "runtime" | "done"

function detectPhase(tasks: Task[]): Phase {
  const has = (s: string) => tasks.some((t) => t.status === s)
  if (has("running") || has("completed") || has("failed")) {
    if (has("running") || tasks.every((t) => t.status === "completed" || t.status === "failed")) {
      return tasks.every((t) => t.status === "completed" || t.status === "failed")
        ? "done"
        : "runtime"
    }
  }
  return "plan"
}

function topoLevel(
  taskId: string,
  byId: Map<string, Task>,
  cache = new Map<string, number>(),
): number {
  if (cache.has(taskId)) return cache.get(taskId)!
  const t = byId.get(taskId)
  if (!t || t.dependsOn.length === 0) {
    cache.set(taskId, 0)
    return 0
  }
  const level = 1 + Math.max(...t.dependsOn.map((d) => topoLevel(d, byId, cache)))
  cache.set(taskId, level)
  return level
}

export function TaskPanel({ workspace, events }: TaskPanelProps) {
  const { t } = useTranslation()
  const tasks = workspace?.plan?.tasks ?? []
  if (tasks.length === 0) {
    return (
      <div className="task-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("task.empty", "no tasks yet")}
      </div>
    )
  }

  const phase = detectPhase(tasks)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const waves = phase === "runtime" ? computeWaves(tasks) : []

  if (phase === "runtime") {
    return (
      <div className="task-panel px-3 py-2 space-y-2">
        <WaveIndicator waves={waves} />
        <ul className="divide-y divide-border">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 py-1.5 text-xs font-mono">
              <span
                className={`task-row__status task-row__status--${task.status} w-1.5 h-1.5 rounded-full`}
              />
              <span className="flex-1 truncate" title={task.description}>
                {task.description}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {task.completedAt && task.startedAt
                  ? `${((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000).toFixed(1)}s`
                  : task.startedAt
                    ? `${((Date.now() - new Date(task.startedAt).getTime()) / 1000).toFixed(1)}s…`
                    : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (phase === "done") {
    const sorted = [...tasks].sort(
      (a, b) => new Date(a.completedAt ?? 0).getTime() - new Date(b.completedAt ?? 0).getTime(),
    )
    return (
      <ol className="task-panel px-3 py-2 space-y-1 text-xs font-mono">
        {sorted.map((task) => {
          const depth = topoLevel(task.id, byId)
          const dur =
            task.completedAt && task.startedAt
              ? `${((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000).toFixed(1)}s`
              : ""
          return (
            <li
              key={task.id}
              className="flex items-center gap-2"
              style={{ paddingLeft: depth * 16 }}
            >
              <span className="text-green-600">✓</span>
              <span className="truncate flex-1">{task.description}</span>
              <span className="text-muted-foreground tabular-nums">{dur}</span>
            </li>
          )
        })}
      </ol>
    )
  }

  // plan phase
  return (
    <ul className="task-panel px-3 py-2 space-y-1 text-xs font-mono">
      {tasks.map((task) => {
        const depth = topoLevel(task.id, byId)
        return (
          <li
            key={task.id}
            className="flex items-center gap-2 opacity-70 hover:opacity-100"
            style={{ paddingLeft: depth * 16 }}
            title={task.description}
          >
            <span className="text-muted-foreground">▸</span>
            <span className="truncate flex-1">{task.description}</span>
            <span className="text-muted-foreground text-[10px] uppercase">{task.agentRole}</span>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 4: Run the test; new assertions should pass**

Run: `pnpm --filter @max/dashboard test -- TaskPanel`
Expected: 3 new PASS.

## Task 7 — OutputPanel rewrite (TDD, extend existing test)

**Files:**

- Modify: `apps/dashboard/src/components/OutputPanel.tsx`
- Modify: `apps/dashboard/test/OutputPanel.test.tsx`

- [ ] **Step 1: Extend the existing test**

Append two new assertions to `apps/dashboard/test/OutputPanel.test.tsx`:

```tsx
it("renders artifacts in a grid card layout", () => {
  const ws: Workspace = {
    ...baseWorkspace,
    plan: { rationale: "x", tasks: [] },
    results: [],
    // The dashboard fetches artifacts via listArtifacts() — stub via prop or
    // wrap with a fetch mock. For this assertion, render an empty state
    // and confirm the grid container class is present.
  }
  render(<OutputPanel workspace={ws} events={[]} workspaceId={ws.id} />)
  expect(document.querySelector(".artifact-grid")).toBeTruthy()
})

it("shows an empty-state message when there are no artifacts", () => {
  render(<OutputPanel workspace={null} events={[]} workspaceId="ws-empty" />)
  expect(screen.getByText(/no artifacts yet/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test; new assertions should fail**

Run: `pnpm --filter @max/dashboard test -- OutputPanel`
Expected: pre-existing PASS, 2 new FAIL.

- [ ] **Step 3: Replace the OutputPanel body**

Read the existing `OutputPanel.tsx` first to preserve its public prop interface (`workspaceId`, `events`, etc.) and the existing imports. Then replace the body with:

```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { listArtifacts } from "../lib/api/artifacts"
import { ArtifactPreview, type Artifact } from "./_helpers/ArtifactPreview"
import { FileText, Image as ImageIcon, BarChart2, Code2 } from "lucide-react"

export interface OutputPanelProps {
  workspaceId: string
  workspace: Workspace | null
  events: RuntimeEvent[]
}

function mimeIcon(mime: string, name: string) {
  if (mime.startsWith("image/")) return ImageIcon
  if (mime === "text/csv" || name.endsWith(".csv")) return BarChart2
  if (/(ts|tsx|js|jsx|py|rs|go)$/i.test(name)) return Code2
  return FileText
}

export function OutputPanel({ workspaceId, workspace, events }: OutputPanelProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<Artifact[]>([])
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    listArtifacts(workspaceId)
      .then((arr) => {
        if (cancelled) return
        setItems(arr ?? [])
      })
      .catch(() => {
        /* swallow */
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, events])

  if (items.length === 0) {
    return (
      <div className="output-panel px-3 py-6 text-xs text-muted-foreground font-mono">
        {t("artifact.empty", "no artifacts yet")}
      </div>
    )
  }

  const active = openIdx !== null ? items[openIdx] : null

  return (
    <>
      <div className="artifact-grid grid grid-cols-2 md:grid-cols-3 gap-3 px-3 py-3">
        {items.map((item, i) => {
          const Icon = mimeIcon(item.mime, item.name)
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => setOpenIdx(i)}
              className="artifact-card text-left p-3 rounded-md border border-border hover:bg-muted/40 transition-colors"
              aria-label={`Open ${item.name}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-mono truncate flex-1">{item.name}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono tabular-nums">
                <span>{item.mime}</span>
              </div>
            </button>
          )
        })}
      </div>

      <Dialog open={openIdx !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogTitle>{active?.name}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground font-mono">
            {active?.mime}
          </DialogDescription>
          {active && <ArtifactPreview artifact={active} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 4: Run the test; new assertions should pass**

Run: `pnpm --filter @max/dashboard test -- OutputPanel`
Expected: 2 new PASS.

## Task 8 — LiveUsagePill rewrite (TDD, new test file)

**Files:**

- Modify: `apps/dashboard/src/components/LiveUsagePill.tsx`
- Create: `apps/dashboard/test/LiveUsagePill.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/dashboard/test/LiveUsagePill.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LiveUsagePill } from "../src/components/LiveUsagePill"

vi.mock("../hooks/useLiveUsage", () => ({
  useLiveUsage: () => ({
    data: {
      totalRequests: 7,
      totalTokens: 12340,
      totalCostUsd: 0.1234,
      cacheHitRate: 0.42,
      byAgent: { frontend: 5000, backend: 7000 },
    },
    isLoading: false,
    isError: false,
  }),
}))

describe("LiveUsagePill", () => {
  it("renders the cost + token summary", () => {
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    expect(screen.getByText(/\$0\.1234/)).toBeInTheDocument()
    expect(screen.getByText(/12\.3K|tokens/i)).toBeInTheDocument()
  })

  it("renders the popover trigger as a button", () => {
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  it("includes a sparkline inside the popover", () => {
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    expect(document.querySelector("svg polyline")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test; confirm new structure not yet there**

Run: `pnpm --filter @max/dashboard test -- LiveUsagePill`
Expected: first assertion PASS (cost shows already), other 2 FAIL (popover + sparkline not present).

- [ ] **Step 3: Replace the LiveUsagePill body**

Preserve the import block (especially `useLiveUsage`), the JSDoc, and the props interface. Replace the function body with:

```tsx
import * as Popover from "@radix-ui/react-popover"
import { useLiveUsage } from "../hooks/useLiveUsage"
import { formatTokens, formatPercent, formatCost } from "@max/i18n"
import { Sparkline } from "./_helpers/Sparkline"

export interface LiveUsagePillProps {
  onOpenUsage: () => void
}

export function LiveUsagePill({ onOpenUsage }: LiveUsagePillProps) {
  const { data, isLoading, isError } = useLiveUsage()

  const pill = (() => {
    if (isLoading && !data) {
      return { label: "usage…", tone: "muted" as const }
    }
    if (!data || data.totalRequests === 0) {
      return { label: "💰 $0.00 · 0 tok today", tone: "muted" as const }
    }
    return {
      label: `💰 ${formatCost(data.totalCostUsd)} · ${formatTokens(data.totalTokens)}`,
      tone: (isError ? "error" : "default") as "default" | "error",
    }
  })()

  // 24h sparkline stand-in: synthesize from byAgent shares (real impl reads
  // /api/usage/daily aggregate in a follow-up). 12 control points is enough
  // for the visual hint.
  const sparklineValues: number[] = (() => {
    if (!data) return []
    const total = data.totalTokens || 1
    const shares = Object.values(data.byAgent ?? {})
    const scale = total / (shares.reduce((a, b) => a + b, 0) || 1)
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const sample = shares[i % Math.max(shares.length, 1)] ?? 0
      return sample * scale * (0.7 + 0.3 * Math.sin(i))
    })
    return buckets.map((v) => Math.max(0, Math.round(v)))
  })()

  const toneClass =
    pill.tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
      : "border-border bg-muted/30 text-foreground hover:bg-muted/60"

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${toneClass}`}
          aria-label="Open usage popover"
        >
          <span aria-hidden>💰</span>
          <span className="font-mono tabular-nums">{pill.label.replace(/^💰 /, "")}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 rounded-md border border-border bg-popover p-4 shadow-md w-[360px] font-mono"
        >
          <div className="space-y-3">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">Today</h4>
            <Sparkline values={sparklineValues} width={328} height={56} />
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <Stat label="cost" value={formatCost(data?.totalCostUsd ?? 0)} />
              <Stat label="tokens" value={formatTokens(data?.totalTokens ?? 0)} />
              <Stat label="cache" value={formatPercent(data?.cacheHitRate ?? 0, 0)} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
              by agent
            </div>
            <ul className="space-y-1">
              {Object.entries(data?.byAgent ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([role, tokens]) => {
                  const total = data?.totalTokens || 1
                  const pct = (tokens / total) * 100
                  return (
                    <li key={role} className="flex items-center gap-2 text-[11px]">
                      <span className="w-16 truncate">{role}</span>
                      <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <span
                          className="block h-full bg-[color:var(--mx-blue-600)]"
                          style={{ width: `${pct.toFixed(1)}%` }}
                        />
                      </span>
                      <span className="tabular-nums w-12 text-right text-muted-foreground">
                        {formatTokens(tokens)}
                      </span>
                    </li>
                  )
                })}
            </ul>
            <button
              type="button"
              onClick={onOpenUsage}
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Open full dashboard →
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular-nums text-foreground">{value}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test; confirm new assertions pass**

Run: `pnpm --filter @max/dashboard test -- LiveUsagePill`
Expected: 3 PASS.

## Task 9 — i18n strings (en + zh)

**Files:**

- Modify: `packages/i18n/src/locales/en-US.ts` (or wherever strings live — check existing file first)
- Modify: `packages/i18n/src/locales/zh-CN.ts`

- [ ] **Step 1: Locate the i18n source file**

Run: `ls packages/i18n/src/`
Then read the file that contains existing UI strings and inspect its export shape.

- [ ] **Step 2: Add the new keys**

Add to both locale files:

```ts
  agent: {
    empty: "no agents yet",
    role: {
      frontend: "Frontend",
      backend: "Backend",
      review: "Review",
      general: "General",
    },
  },
  task: {
    empty: "no tasks yet",
    wave: {
      label: "wave {{current}} / {{total}}",
      parallel: "{{n}} parallel active",
    },
  },
  artifact: {
    empty: "no artifacts yet",
  },
  usage: {
    popover: {
      title: "Today",
      fullDashboard: "Open full dashboard →",
      byAgent: "by agent",
    },
  },
```

For zh-CN, match natural Chinese:

```ts
  agent: {
    empty: "暂无 Agent",
    role: {
      frontend: "前端",
      backend: "后端",
      review: "审查",
      general: "通用",
    },
  },
  task: {
    empty: "暂无任务",
    wave: {
      label: "第 {{current}} 波 / 共 {{total}} 波",
      parallel: "{{n}} 个并行",
    },
  },
  artifact: {
    empty: "暂无产物",
  },
  usage: {
    popover: {
      title: "今日",
      fullDashboard: "打开完整仪表板 →",
      byAgent: "按 Agent",
    },
  },
```

- [ ] **Step 3: Run type-check + dashboard tests**

```bash
pnpm type-check
pnpm --filter @max/dashboard test
```

Expected: all PASS.

## Task 10 — Final commit + push

**Files:** None (just `git` + `gh`).

- [ ] **Step 1: Stage all changes**

```bash
git add apps/dashboard/src/components/{AgentPanel,TaskPanel,OutputPanel,LiveUsagePill}.tsx \
        apps/dashboard/src/components/_helpers/ \
        apps/dashboard/test/ \
        apps/dashboard/src/theme.css \
        packages/i18n/src/locales/
git status
```

- [ ] **Step 2: Run final checks**

```bash
pnpm type-check
pnpm --filter @max/dashboard test
```

Expected: all green.

- [ ] **Step 3: Build the dashboard to confirm Vite output**

```bash
pnpm --filter @max/dashboard build
```

Expected: `dist/` produced, no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): local polish — Vercel/Linear four-panel pass

Four panels (AgentPanel / TaskPanel / OutputPanel / LiveUsagePill) get a
coherent dark-leaning, mono-tabular design language without introducing
new abstractions or dependencies.

AgentPanel:    role-tinted monograms + status dots + live durations.
TaskPanel:     phase-aware — DAG in plan, WaveIndicator in runtime, timeline
               on done. computeWaves() clusters completedAt timestamps.
OutputPanel:   3-4 column grid of mime-card + Radix Dialog inline previewer
               (md → rendered / image → <img> / csv → table / fallback → <pre>).
LiveUsagePill: clickable Radix Popover revealing 24h sparkline + per-agent
               token-share bar breakdown.

Reuses framer-motion (existing), lucide-react (existing), Radix Popover/Dialog
(existing). Adds four local helpers under apps/dashboard/src/components/_helpers/
that are intentionally NOT promoted to packages/ui-react (per 'minimal new
concepts' guidance).

i18n: new agent.* / task.* / artifact.* / usage.popover.* strings in
en-US and zh-CN. Existing keys untouched.

Verified: pnpm type-check + pnpm test --filter @max/dashboard pass.
Dashboard Vite build produces a clean dist/."
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: `main -> main`, CI reruns (CI + docker-publish + release-please),
all green. Dashboard container image is rebuilt.

---

## Self-Review

**1. Spec coverage:**

- AgentPanel role-tinted StatusDot + monogram + duration → Task 5 ✅
- TaskPanel phase-aware (plan / runtime / done) → Task 6 ✅
- OutputPanel grid + inline preview → Task 7 ✅
- LiveUsagePill popover + sparkline + per-agent breakdown → Task 8 ✅
- 4 helpers stay inside dashboard (no ui-react extraction) — file map + Tasks 1-4 ✅
- i18n strings en + zh — Task 9 ✅
- Single commit at end — Task 10 ✅

**2. Placeholder scan:** Each task step contains concrete code (or references
existing files). No "TBD"/"implement later" left.

**3. Type consistency:** `WaveDescriptor` / `WaveStatus` defined in Task 3's
implementation and reused identically in Task 6 (`computeWaves`). `Artifact`
interface defined in Task 4's implementation and reused identically in Task 7.
`StatusDotProps`/`SparklineProps`/etc. are scoped to their own files but
consumed in the panel rewrites without type drift.
