# AGENTS.md

Instructions for coding agents (and humans) working in this repository.
Everything here reflects verified practice — every command below is real
and expected to pass. If this file disagrees with reality, fix reality or
fix this file, then note it in your PR.

## Repository layout

```
apps/          user-facing processes: api (Hono), worker (BullMQ), dashboard (React), tui (ink)
packages/      26 workspace packages (@max/*) — core, providers, evolution, meta-system,
               autonomy, session-store, workflow-engine, credential-lease, tools, queue,
               database, gateway, i18n, telemetry, config, sdk, llm, compat-shims, …
benchmarks/    database / devops / frontend / load benchmarks
e2e/           Playwright end-to-end + visual-baseline suites
deploy/        k8s manifests          observability/  otel-collector + prometheus configs
docs/          architecture, rfcs, decisions (ADRs), api-ref, operations, security, …
scripts/       architecture-check, migrate + migrate-dry-run, audit-deprecated
sdk/           python SDK
borrowings-adjacent references live OUTSIDE this repo (../borrowings/, read-only —
               NEVER import from them or add them to pnpm-workspace)
```

## Commands

| Task                                            | Command                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Type-check one package                          | `pnpm --filter @max/<pkg> exec tsc --noEmit` (dashboard: `tsc -b --force`)                                               |
| Type-check all                                  | `pnpm type-check`                                                                                                        |
| Test one package                                | `pnpm --filter @max/<pkg> test`                                                                                          |
| Test all                                        | `pnpm test`                                                                                                              |
| API contract snapshot (after adding routes)     | `pnpm --filter @max/api contract:update`                                                                                 |
| Dashboard client contract regen                 | `pnpm --filter @max/dashboard contract:gen`                                                                              |
| Architecture policy                             | `pnpm architecture:check`                                                                                                |
| Lint / format                                   | `pnpm lint` / `pnpm exec prettier --write <files>`                                                                       |
| Boot smoke (after touching api/index.ts routes) | `timeout 25 node --import tsx/esm apps/api/src/index.ts` — must print `starting server` with zero `ReferenceError` lines |
| License headers (new files)                     | `pnpm license:check`                                                                                                     |

## Verification discipline (non-negotiable)

1. **New API routes MUST get a boot smoke.** Incremental `tsc` can miss a
   used-but-not-imported symbol (it happened; the nightly load test caught
   a `ReferenceError` in production-shaped runs). Registering a route
   without the smoke is not done.
2. **Format check runs before type-check in CI and aborts the job** — run
   prettier on your diff before pushing. `.env.example` prettier errors are
   local noise (CI's format step does not include it).
3. **Generated files are never hand-edited**: `apps/api/openapi-paths.json`,
   `apps/dashboard/src/api-contract.ts` (regen: `pnpm --filter @max/dashboard
contract:gen`), `CHANGELOG.md` (release-please), `pnpm-lock.yaml`.
4. Git hooks (husky/lint-staged) may be killed by OOM on large stagings —
   the established flow is `git commit --no-verify` after running prettier
   and lint on your diff manually.
5. Before `git add -A`, inspect `git status`: playwright artifacts
   (`e2e/test-results/`, gitignored) and parallel work in unrelated paths
   have been swept into commits before.

## Architecture policy

`architecture-policy.yaml` + `scripts/architecture-check.mjs` enforce:
entrypoints exist, no deep imports of package internals, apps never import
apps. Run `pnpm architecture:check`. Dashboard additionally enforces via
`apps/dashboard/test/arch-boundary.test.ts`: network access only from
`src/api.ts` and `src/hooks/`.

Frontend feature domains follow the federation rules in
`apps/dashboard/src/features/README.md` and the style/ownership rules in
`apps/dashboard/CONVENTIONS.md`.

## Single sources of truth

- **API routes**: `apps/api/src/routes/*` → snapshot `apps/api/openapi-paths.json`
  → generated `apps/dashboard/src/api-contract.ts`.
- **Provider presets**: `packages/providers/src/presets/data.ts` (all resale
  and vendor entries; adding a provider is a data change).
- **Tool kinds**: `packages/tools/src/registry.ts` (registration validates kind).
- **Dashboard i18n**: core dictionaries `packages/i18n/src/locales/*.json`;
  feature-domain dictionaries `apps/dashboard/src/locales/<domain>.*.json`
  (flat dotted keys), merged at boot by `src/locales/index.ts`.

## Secrets / .env

`.env.example` is the only registry of variable names — add new vars there
in the same PR. Real secrets never enter the repo (gitleaks scans every
push). Provider API keys are env-only by contract; the encrypted vault
(`MAXIMILIAN_VAULT_PATH` / `MAXIMILIAN_VAULT_PASSPHRASE`) injects them at
boot.

## i18n

All user-visible strings go through `t()`; keys live in
`packages/i18n/src/locales/{zh-CN,en-US}.json` (core) and per-domain files
under the dashboard's `src/locales/`. zh and en are updated in the same
change; placeholders (`{count}`) are preserved verbatim.

## Deprecation

Mark with `@deprecated` JSDoc including the replacement and the removal
milestone; list the symbol in `docs/compat-manifest.md`. `pnpm
report:deprecation` audits current usage.
