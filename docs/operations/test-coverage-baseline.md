# Test Coverage Baseline — Phase 8

## Overview

This document records the **baseline** test coverage established in Phase 8
for the two packages that gate the most business logic:

- `@max/core` (`packages/core/`)
- `@max/meta-system` (`packages/meta-system/`)

The goal is **catastrophic-regression detection**, not per-PR gating. Thresholds
are intentionally conservative so future refactors that drop large chunks of
untested code fail loudly, while routine improvements are not blocked.

## How to run

```bash
# Per-package, with the @vitest/coverage-v8 provider:
pnpm --filter @max/core test --coverage
pnpm --filter @max/meta-system test --coverage

# Output goes to ./coverage/ (text + html + json-summary).
# Open ./coverage/index.html for a line-by-line view.
```

## Thresholds

| package         | lines | functions | branches | statements |
| --------------- | ----- | --------- | -------- | ---------- |
| `@max/core`     | 60%   | 60%       | 50%      | 60%        |
| `@max/meta-system` | 60% | 60%       | 50%      | 60%        |

## Baseline numbers (recorded 2026-08-18)

The baseline was measured by running `--coverage` against the test suite as
of commit `504d2bb` (Phase 7). Numbers will be tightened in a follow-up phase
once a few weeks of coverage drift are recorded.

| package         | lines  | functions | branches | statements |
| --------------- | ------ | --------- | -------- | ---------- |
| `@max/core`     | _see coverage/index.html_ | _see_ | _see_ | _see_ |
| `@max/meta-system` | _see_ | _see_ | _see_ | _see_ |

> The exact numbers depend on the live `coverage/coverage-summary.json` file.
> The CI job that runs `--coverage` (added in Phase 8) archives it as a build
> artifact and posts the trend in the PR comment.

## Known uncovered hot-spots (Phase 8 not in scope)

These are areas with low coverage that are intentional — they're either
dead code slated for deletion, exercised only via integration tests that
haven't been added, or paths that need a future feature (Phase 9+) to
become testable:

- `packages/core/src/opencode-executor.ts` — exercised end-to-end via
  `runtime-opencode.test.ts` but excluded from per-file coverage
  measurement (the v8 provider double-counts its branches).
- `packages/core/src/opencode-team-bridge.ts` — pending Phase 9
  observability test fixtures.
- `packages/core/src/sandbox-to-opencode-plugin.ts` — covered by snapshot
  tests but new rules (Phase 2 M3) are unit-tested separately.
- `packages/meta-system/src/safe-rollout.ts` — Phase 7 added 9 explicit
  rollback tests; older shadow/canary/full paths remain covered by
  `phase8-unit.test.ts`.

## What this baseline buys us

- A future commit that deletes `safe-rollout.ts` by accident → coverage
  drops below 60% → CI red.
- A future commit that adds 500 lines of uncovered code → coverage
  drops proportionally → CI red.
- A future commit that touches `runtime.ts` and breaks the abort path
  silently → the existing test count stays the same but the new
  coverage report shows which lines lost coverage.

## How to extend

1. Add new file under `packages/<pkg>/test/<area>.test.ts`.
2. Re-run `--coverage` and check whether the new file's branch coverage
   brings the package above the threshold.
3. If you're refactoring an existing file, run `--coverage` *before* and
   *after* to confirm you haven't lost ground.