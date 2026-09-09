# API Reference

This directory hosts Maximilian's **TypeDoc** output for the `@max/*`
packages.

## Generating

```bash
pnpm docs:api
```

Output is written to `docs/api-ref/`. Commit the result so it ships
with GitHub Pages.

## Online

- **REST API (Swagger UI)**: <https://demo.maximilian.dev/api/docs>
- **Package reference (TypeDoc)**: <https://syxscott.github.io/Maximilian/api-ref/>

## Source

- TypeDoc config: [`typedoc.json`](../../typedoc.json)
- OpenAPI spec: [`apps/api/src/openapi-spec.ts`](../../apps/api/src/openapi-spec.ts)

## How to add a new package to TypeDoc

Add it to `typedoc.json` under `entryPoints`:

```diff
   "entryPoints": [
     "packages/core",
+    "packages/my-new-package",
     ...
   ]
```

Then run `pnpm docs:api` and commit.

## Conventions

- Every exported function / class / interface should have a JSDoc
  block with a one-line summary.
- Use `@param`, `@returns`, `@throws`, `@example` as appropriate.
- Mark unstable APIs with `@experimental`.
- Mark removed APIs with `@deprecated since X.Y.Z, removal A.B.C`.
- See [`docs/DEPRECATION.md`](../DEPRECATION.md) for the lifecycle.