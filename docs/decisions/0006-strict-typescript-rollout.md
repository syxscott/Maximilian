# ADR-0006: Strict TypeScript Rollout

> **Status**: accepted
> **Date**: 2026-07-07
> **Deciders**: @syxscott

## Context

The base `tsconfig.base.json` enables `strict: true` (which turns on
`noImplicitAny`, `strictNullChecks`, etc.), but does not enable the
**next tier** of strict flags:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noPropertyAccessFromIndexSignature`
- `useUnknownInCatchVariables`

Enabling them all at once across 21 packages would surface many real
bugs (some exist in production code paths). A gradual rollout is
needed.

## Decision

1. **`tsconfig.strict.json` is created** at the root, extending the
   base config with the additional strict flags enabled.

2. **Per-package opt-in**: a package opts into strict mode by
   extending `tsconfig.strict.json` instead of `tsconfig.base.json`.

3. **Migration order** (smallest → largest):
   1. `packages/config` (small, pure)
   2. `packages/i18n`
   3. `packages/agents`
   4. `packages/core`
   5. remaining packages

4. **CI does not enforce strict mode yet** — packages opt in voluntarily.
   Once all packages are migrated, we flip the enforcement.

## Consequences

- New code in opted-in packages gets the stricter checks automatically.
- Mixed strictness between packages is acceptable during migration.
- The `pnpm type-check` command runs against each package's chosen
  config — so a strict-mode package will fail on any relaxed-typing
  regression.

## How to migrate a package

```diff
- // packages/<name>/tsconfig.json
- { "extends": "../../tsconfig.base.json", ... }
+ { "extends": "../../tsconfig.strict.json", ... }
```

Run `pnpm --filter @max/<name> type-check`. Fix any new errors. Common
fixes:

| Error | Fix |
|---|---|
| `Element implicitly has an 'any' type` | Add an explicit type or `!` assertion after indexing |
| `Types of property X are incompatible` | Use `X?: T` consistently with optional handling |
| `Type 'undefined' is not assignable` | Add `if (x)` guard or `x ?? defaultValue` |
| `'X' is possibly 'undefined'` | Add a non-null assertion or early-return guard |

## References

- [TypeScript strict options docs](https://www.typescriptlang.org/tsconfig#strict)
- [`tsconfig.base.json`](../../tsconfig.base.json)
- [`tsconfig.strict.json`](../../tsconfig.strict.json)