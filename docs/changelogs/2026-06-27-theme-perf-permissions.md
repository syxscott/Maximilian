# 2026-06-27 — Theme · Performance · Permissions

**Status**: ✅ Completed (one-shot session)

Three connected changes landed in a single push to close the gap between the
prototype and a usable local app:

1. **Theme system** — auto-detect system dark/light + manual override, no FOUC.
2. **Performance tiering** — auto-detect hardware, virtual lists, lazy tabs.
3. **Tool permissions** — OpenCode-style allow / ask / deny with glob patterns
   and SSE-prompted runtime parking.

## New files

| File | Purpose |
|------|---------|
| `apps/dashboard/src/lib/theme.ts` | `useTheme` hook, `getStoredTheme`/`setStoredTheme`, `useSyncExternalStore` over storage + `prefers-color-scheme` |
| `apps/dashboard/src/lib/perf-tier.ts` | `usePerfTier` hook, RAF microbenchmark + `deviceMemory` × `hardwareConcurrency` heuristic, `.perf-low` / `.perf-high` class on `<html>` |
| `apps/dashboard/src/lib/permissions.ts` | `usePermissions` hook + REST client + `usePermissionPrompt` SSE subscriber |
| `apps/dashboard/src/components/ThemeToggle.tsx` | 3-state pill button in the header |
| `apps/dashboard/src/components/PermissionsMatrix.tsx` | Per-tool allow/ask/deny + glob pattern editor + test widget |
| `apps/dashboard/src/components/PermissionDialog.tsx` | Modal that surfaces `permission-request` events with Allow / Deny buttons |
| `apps/dashboard/src/components/VirtualList.tsx` | react-window v2 wrapper that falls back to plain children for small lists / high tier |
| `packages/tools/src/permission.ts` | `Permission` / `ToolName` / `Permissions` types, `DEFAULT_PERMISSIONS`, `globToRegex`, `matchPattern`, `extractTarget`, `resolvePermission`, atomic file load/save |
| `packages/tools/src/with-permission.ts` | `withPermission(materialization, provider)` wrapper + `PermissionRequestError` / `PermissionDeniedError` |
| `apps/api/src/routes/permissions.ts` | GET / PUT / resolve / test / reset / answer endpoints |

## Modified files

| File | Change |
|------|--------|
| `apps/dashboard/index.html` | Inline boot script that sets `<html class="light\|dark">` + `color-scheme` before any CSS paints, preventing FOUC |
| `apps/dashboard/src/index.css` | `.perf-low *` disables animations, transitions, shadows, backdrop-blur; `@media (prefers-reduced-motion)` fallback |
| `apps/dashboard/src/App.tsx` | All 6 tabs wrapped in `React.lazy` + `Suspense`; `ThemeToggle` in header; `PermissionDialog` mounted at root; SSE handler tracks latest `permission-request` / `permission-resolved` |
| `apps/dashboard/src/components/SettingsPanel.tsx` | Replaced placeholder card with `<PermissionsMatrix />` |
| `apps/dashboard/src/components/ExecutionCanvas.tsx` | `ScrollArea` → `VirtualList` (`itemHeight=96`) |
| `apps/dashboard/src/components/ProviderPanel.tsx` | `ScrollArea` → `VirtualList` (`itemHeight=104`) |
| `apps/dashboard/src/api.ts` | Exported shared helpers (`BASE`, `authHeaders`, `fetchJson`, `z`) so feature modules can compose their own typed clients |
| `apps/api/src/index.ts` | Mounted `/api/permissions/*` routes with auth middleware; `runtime.resolvePermission` exposed via the `/answer` endpoint |
| `apps/api/package.json` | Added `@maximilian/tools` workspace dependency |
| `packages/core/src/runtime.ts` | New `permission-request` / `permission-resolved` `RuntimeEvent` variants; `awaitPermission` / `resolvePermission` methods on `AgentRuntime`; `runToolLoopAndSubmit` now passes the resolver through |
| `packages/core/src/tool-integration.ts` | `ToolLoopOptions.awaitPermission`; `runToolLoop` catches `PermissionRequestError`, emits the event, awaits the resolver, re-executes the call |
| `packages/tools/package.json` | Added `test` / `type-check` scripts + vitest dev dep + `./permission` and `./with-permission` exports |
| `packages/tools/tsconfig.json`, `packages/tools/vitest.config.ts` | New |

## Tests added

| Suite | Count | What it covers |
|-------|-------|----------------|
| `packages/tools/test/permission.test.ts` | 16 | `globToRegex` (single segment, `**` zero or more, escapes, `?`), `matchPattern`, `extractTarget` (path vs command vs pattern), `resolvePermission` (defaults vs pattern precedence vs unknown tool), `validatePermissions` (drops unknown tools + invalid actions) |
| `packages/tools/test/with-permission.test.ts` | 10 | `allow` passes through, `deny` throws `PermissionDeniedError`, `ask` throws `PermissionRequestError` with stable `requestId`, per-tool defaults, pattern override beats default, sync / async / function providers, unknown tool passthrough, definitions passthrough, type-guard correctness |
| `packages/core/test/permission-pause.test.ts` | 4 | `awaitPermission` parks until `resolvePermission`; unknown ids return false; `permission-resolved` event fires with right workspace/task; pending count tracks in-flight |
| `packages/core/test/permission-loop-integration.test.ts` | 1 | Full cycle: registry with real `read` tool, wrapped materialization with `ask` config, tool loop parks, user flips config + calls `resolvePermission('allow')`, workspace completes with `permission-resolved` event in the stream |
| `apps/api/test/permissions.test.ts` | 7 | GET returns defaults when file is missing; PUT persists + GET reads back; PUT tolerates invalid actions / unknown tools; `POST /resolve` returns decision; invalid tool → 400; `POST /test` is pure; `POST /reset` restores defaults |
| `apps/dashboard/test/PermissionsMatrix.test.tsx` | 5 | Renders 6 tool rows, default click enables Save, add pattern reveals input, PUT called with new config, Reset hits `/reset` |

Total: **+43 tests**. Monorepo now has **723 tests passing**.

## Behaviour summary

### Theme

- `localStorage["maximilian-theme"]` holds `"system" \| "light" \| "dark"`
- Inline script in `index.html` reads localStorage and writes
  `<html class="…">` + `color-scheme` before any CSS paints
- `useTheme` subscribes to both `storage` events and `prefers-color-scheme`
  changes via `useSyncExternalStore`
- `ThemeToggle` cycles `system → light → dark`; icon flips between
  `Monitor` / `Sun` / `Moon`

### Performance

- On first mount the `detectTier` heuristic runs a 16-frame RAF microbenchmark
  and combines it with `navigator.deviceMemory` × `navigator.hardwareConcurrency`
- Effective tier lands as `.perf-low` or `.perf-high` on `<html>` so CSS can
  react without a React re-render
- `.perf-low *` disables `animation`, `transition`, `box-shadow`,
  `backdrop-filter` and forces `contain: layout style`; `prefers-reduced-motion`
  is respected as a fallback
- 6 tabs are `React.lazy()` + `<Suspense>` so the initial JS payload excludes
  the heaviest components
- `VirtualList` (`< 50` items on high tier → plain children, otherwise
  `List` from react-window v2) is in `ExecutionCanvas` + `ProviderPanel`

### Permissions

- Six tools: `bash`, `read`, `write`, `edit`, `glob`, `grep`
- Each has an `allow \| ask \| deny` default; per-tool pattern overrides
  keyed by glob (`*`, `**`, `?`, char classes, regex-meta escape)
- Match order: first pattern whose glob matches the extracted target wins,
  fall back to the tool default
- Runtime: `withPermission(materialization, provider)` checks every `settle`
  call; throws `PermissionRequestError` for `ask` and `PermissionDeniedError`
  for `deny`
- The tool loop catches `PermissionRequestError`, emits a
  `permission-request` event, and awaits a deferred on the `AgentRuntime`
- The API's `POST /api/permissions/answer { requestId, decision }` calls
  `runtime.resolvePermission`; the loop resumes and re-executes the same
  call against the (presumably updated) config
- UI: `Settings → Tool permissions` renders the matrix; the global
  `PermissionDialog` listens to the workspace's SSE stream and surfaces the
  prompt with tool + target; clicking Allow / Deny hits the API and clears
  the prompt when the matching `permission-resolved` event arrives
- Persisted to `~/.maximilian/permissions.json` (atomic write via temp
  file + rename; testable via `rootDir` override on the route factory)

## Verification

```
pnpm -r type-check     # clean across all 24 packages
pnpm -r test           # 723 tests, 0 failures
```

## Non-goals (deferred)

- API `/v1` versioning — the existing mount already serves under both
  `/api/` and `/api/v1/`, no new work needed here.
- Workspace re-execution on `deny` decision — currently the loop surfaces
  the tool failure to the LLM so it can adapt; if the user wants a hard
  kill, the workspace abort endpoint is unchanged.
- Per-call audit log of permission decisions — a small enhancement to
  `OrganizationMemory` would record every `ask → allow/deny` for later
  review, but it's not blocking the feature.
