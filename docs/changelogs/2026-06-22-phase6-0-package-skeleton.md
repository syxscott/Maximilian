# Phase 6.0 — Meta-System Package Skeleton

**Date**: 2026-06-22
**Status**: Completed

## What

Created the `@max/meta-system` workspace package.

## Files

- `packages/meta-system/package.json` — workspace package, deps on `@max/autonomy`, `@max/dags`, `@max/evolution`, `@max/core`, `zod`
- `packages/meta-system/tsconfig.json` — extends base tsconfig
- `packages/meta-system/src/types.ts` — All Phase 6 Zod schemas (`CapabilityRecord`, `CapabilityProposal`, `AgentChangePlan`, `TeamOptimizerHint`, `AgentBirthResult`, `RetirementDecision`, `OrganizationEvent`, `SimulationResult`, `GovernanceConfig`, defaults)

## Decisions

- ADR-019: dedicated `meta-system` package
- Package depends on `@max/dags` (TeamGraph/AgentBlueprint) and `@max/autonomy` (ExecutionRecord), but not on `@max/api`

## Verification

```bash
pnpm --filter @max/meta-system type-check  # OK
```