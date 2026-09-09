# Upgrade Guides

These guides walk you through migrating between Maximilian versions.

While Maximilian is **pre-1.0**, minor versions may include breaking
changes. Always read the relevant upgrade guide before bumping.

## Available guides

| From | To | Guide | Severity |
|---|---|---|---|
| v0.1.x | v0.2.0 | [v0.1-to-v0.2.md](v0.1-to-v0.2.md) | ⚠️ Breaking (env vars renamed) |
| v0.2.x | v0.3.0 | [v0.2-to-v0.3.md](v0.2-to-v0.3.md) | ⚠️ Breaking (DB schema change) |

> **Note**: Once we hit v1.0.0, these guides will be indexed by version
> and tagged against [GitHub releases](https://github.com/syxscott/Maximilian/releases).

## How to use these guides

1. Read the **Summary** and **Breaking changes** sections first.
2. Verify you are not using any removed APIs (`grep` for `@deprecated`
   markers in your code).
3. Follow the **Step-by-step migration** procedure.
4. Run the test suite: `pnpm test`.
5. If anything fails, check [DEPRECATION.md](../DEPRECATION.md) for the
   removal lifecycle of deprecated APIs.

## For contributors

When you make a breaking change to a `@max/*` package:

1. Mark the old API with `@deprecated since X.X.X, removal Y.Y.Y`.
2. Add an entry to `docs/DEPRECATION.md` under **Pending removals**.
3. Create a new file in this directory named `vOLD-to-vNEW.md`.
4. Add a row to the table above.

## Related

- [DEPRECATION.md](../DEPRECATION.md) — deprecation lifecycle
- [changelogs/](../changelogs/) — version-by-version changelogs
- [rfcs/](../rfcs/) — design rationale for breaking changes