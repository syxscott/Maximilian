# Mutation Testing

Maximilian uses [Stryker](https://stryker-mutator.io/) to verify that
our test suite actually catches bugs — not just runs.

## What it does

Stryker introduces small changes ("mutations") into the source code —
flipping `&&` to `||`, removing a check, swapping a constant — and
runs the test suite for each one. If a mutation survives (tests still
pass), that means a test gap.

## Running locally

```bash
# Quick dry-run (no mutations, just checks config)
pnpm mutate:dry

# Full run — slow! ~10 min for meta-system
pnpm mutate:run
```

Output: `reports/mutation/html/index.html` — open in a browser.

## CI

Mutation tests run **nightly** via `.github/workflows/mutation.yml` to
catch regression in test coverage. Results are pushed to the
[Stryker dashboard](https://dashboard.stryker-mutator.io/).

## Scope

Currently mutates:
- `packages/meta-system/src/truth-audit.ts` — most critical, the TruthAudit math
- `packages/meta-system/src/orchestrator.ts` — decision orchestration
- `packages/meta-system/src/proposal-pipeline.ts` — simulation
- `packages/meta-system/src/governance.ts` — limits enforcement

## Thresholds

Defined in `stryker.config.json`:

| Tier | Mutation score | Effect |
|---|---|---|
| **High** | ≥ 80% | green CI |
| **Low** | 70–79% | yellow CI (warning) |
| **Break** | < 70% | red CI (failure) |

These are deliberately below 100% — mutations in unreachable code or
defensive programming shouldn't block merges.

## Adding a new file to mutation analysis

1. Add the path to `stryker.config.json > mutate`.
2. Make sure the file has tests that cover the conditions.
3. Run `pnpm mutate:dry` to verify the config.
4. Run `pnpm mutate:run` to see your mutation score.
5. If below thresholds, write more tests until they pass.

## Why mutation testing matters

A test that always passes regardless of input is worthless. Mutation
testing makes this failure mode visible — if removing a line of
production code doesn't break any test, that line wasn't being
exercised.

It's expensive (~10x normal test time) which is why we run it
nightly, not per-PR.