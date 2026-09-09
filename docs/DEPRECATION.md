# Deprecation Policy

This document defines how Maximilian marks APIs as deprecated, how long they
remain supported, and how customers should plan upgrades.

## Goals

- Customers get **clear warning** before any API goes away.
- Backward compatibility is preserved for **at least one minor version**.
- Deprecations are documented in **CHANGELOG**, **JSDoc**, and the runtime
  warning system.

## Versioning rules

Maximilian follows [Semantic Versioning 2.0.0](https://semver.org/):

- **Patch** (0.0.x) — bug fixes, internal refactors, doc-only changes.
  No breaking changes. Safe to upgrade.
- **Minor** (0.x.0) — new features, new optional APIs.
  Deprecations are allowed (but not removals).
  Pre-1.0: minor may include breaking changes; see below.
- **Major** (x.0.0) — breaking changes allowed.
  Removal of deprecated APIs goes here.

### Pre-1.0 exception

Until `1.0.0` is released, **minor versions may include breaking changes**.
We will still:
1. Mark removed APIs with `@deprecated` at least one minor version ahead.
2. Log a runtime warning on first use of any deprecated API.
3. Document the change in CHANGELOG with a `⚠️ BREAKING` marker.

This is a deliberate trade-off: shipping faster in exchange for some churn.
After `1.0.0`, this exception ends.

## Deprecation lifecycle

A typical deprecation follows this timeline:

```
0.x.0   API marked @deprecated; JSDoc lists replacement + removal version
        Runtime warning logged on first use (rate-limited)
        CHANGELOG entry: "⚠️ DEPRECATED: oldApi → use newApi"
0.x+1.0 Removal happens here if removal version was committed
        (Removed in major version if post-1.0)
```

**Minimum support window:**
- **Internal / beta APIs**: 1 minor version of warning before removal.
- **Public / GA APIs**: 2 minor versions + 6 months.
- **Anything called out as "experimental"**: 1 minor version is enough.

## How to mark an API deprecated

In TypeScript:

```ts
/**
 * @deprecated since 0.4.0 — use {@link newApi} instead.
 * Removal planned for 0.6.0.
 */
export function oldApi(...): ... { ... }
```

Then run `pnpm lint` — the `no-deprecated-api` rule will check that every
deprecated symbol has the since/removal fields filled in.

In addition, the runtime should call `warnDeprecation("oldApi")` on first
invocation:

```ts
import { warnDeprecation } from "@max/core";

export function oldApi(...) {
  warnDeprecation("oldApi", { since: "0.4.0", removal: "0.6.0", use: "newApi" });
  ...
}
```

## Experimental APIs

APIs that are not yet stable are marked `@experimental`:

```ts
/**
 * @experimental — API may change in any release until promoted to stable.
 */
export function draftApi(...) { ... }
```

Experimental APIs are exempt from the deprecation policy: they can change
or be removed without notice. Once promoted to stable, the regular
deprecation policy applies.

## Customer-facing stability tier

When you import from Maximilian, you can tell at a glance whether a symbol
is stable by checking its JSDoc:

| Marker | Meaning | Removal policy |
|---|---|---|
| (none) | **Stable** — covered by SemVer | 2 minor + 6 months notice |
| `@experimental` | Draft, may change | None — any release |
| `@deprecated` since X, removal Y | Scheduled for removal | Removed at Y |

## Stability tier per package

Some packages are stable-by-default; others are explicitly experimental:

| Package | Stability |
|---|---|
| `@max/core`, `@max/agents`, `@max/commander`, `@max/providers` | Stable |
| `@max/dags`, `@max/database`, `@max/queue`, `@max/telemetry` | Stable |
| `@max/evolution`, `@max/meta-system` | Stable but **governance-impacting** — read [docs/architecture/evolution-vs-meta-system.md](architecture/evolution-vs-meta-system.md) before relying on them |
| `@max/autonomy` | `@experimental` |
| `@max/sdk` | Stable |

## Questions

Open an issue or discussion if:
- You're depending on an API we marked deprecated and the removal
  timeline is too aggressive.
- You want us to mark something experimental that we shipped as stable.

## See also

- [docs/upgrades/](./upgrades/) — version-specific migration guides.
- [CHANGELOG.md](../CHANGELOG.md) — release notes.