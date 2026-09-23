# Contributing to Maximilian

Thanks for contributing. This document covers the workflow; architecture
rules live in [AGENTS.md](./AGENTS.md) and `docs/architecture/`.

## Development environment

```bash
pnpm install                # installs 26 packages + 4 apps via pnpm workspaces
pnpm --filter @max/api dev  # API on :3001 (see .env.example for required vars)
pnpm --filter @max/dashboard dev   # dashboard on :5173
pnpm test                   # full unit suite
pnpm type-check             # strict TS across the workspace
```

Copy `.env.example` to `.env` and fill in what you need — every variable is
documented there. `pnpm start:all` / `pnpm start:full` run the full stack
with the evolution engine (and worker) enabled.

## Commit messages

We use [release-please](https://github.com/googleapis/release-please):
**commit messages follow Conventional Commits** (`feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`) — `feat` and `fix` on `main`
drive the automatic version bumps and changelog. Scope is optional:
`feat(dashboard): …`.

## Pull requests

1. Branch from `main`; keep the diff focused — one concern per PR.
2. CI runs: gitleaks, lint, format check (scoped to your diff), strict
   type-check, full tests against a real PostgreSQL, build, bundle-size,
   Docker smoke, architecture policy, license headers, commit-message
   validation. All of them must pass; none are optional.
3. New API routes: update the contract snapshot
   (`pnpm --filter @max/api contract:update`) and run the boot smoke
   (see AGENTS.md).
4. New UI surfaces: follow the feature-federation rules in
   `apps/dashboard/src/features/README.md`, add zh + en strings, and add
   model-layer unit tests.

## Code style

- Prettier and ESLint are enforced (`pnpm format`, `pnpm lint`).
- Strict TypeScript everywhere (`docs/decisions/0006-strict-typescript-rollout.md`).
- Every user-visible string goes through i18n (zh-CN + en-US).
- Every package carries the MIT license header on new files
  (`pnpm license:check`).

## Tests

- Unit tests per package (Vitest). CI runs them against real PostgreSQL.
- Dashboard: model-layer unit tests + render smoke
  (`apps/dashboard/test/`); visual baselines via `pnpm e2e`.
- Mutation testing runs nightly (`pnpm mutate:run`); don't weaken
  assertions to satisfy it — add stronger ones.

## Documentation

- Architecture changes need an ADR in `docs/decisions/`.
- User-facing features need `.env.example` / docs updates in the same PR.
- Borrowings from upstream projects are recorded with provenance and
  honesty boundaries in `docs/borrowings-update-*.md`.

## Security

Never commit secrets (gitleaks blocks the push). Report vulnerabilities
per [SECURITY.md](./SECURITY.md).
