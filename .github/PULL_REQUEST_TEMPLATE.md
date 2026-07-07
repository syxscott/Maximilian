<!--
Thanks for sending a PR! Please fill out this template so reviewers can act fast.
Replace each placeholder. Delete any section that does not apply.
-->

## Summary

<!-- One or two sentences. What changed and why? -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactor (no behavior change)
- [ ] Performance improvement
- [ ] Test addition / improvement

## Related issues

<!-- Link any related issue: `Fixes #NNN`, `Closes #NNN`, or `Refs #NNN` -->

## How to test

<!-- Concrete steps a reviewer can follow to verify the change works.
     Include the exact commands and any required env vars. -->

1. `pnpm install`
2. `pnpm test --filter @max/<affected-package>`
3. ...

## Checklist

- [ ] I added/updated tests for new behavior
- [ ] I added/updated documentation (README, docs/, JSDoc)
- [ ] I ran `pnpm type-check` — no errors
- [ ] I ran `pnpm test` — all green
- [ ] I ran `pnpm lint` — no errors
- [ ] For breaking changes, I added a migration note to `docs/upgrades/`
- [ ] I respected the project's "minimal new concepts" preference — no new abstractions unless necessary

## Risk / blast radius

<!-- What breaks if this PR has a bug? What did you specifically test? -->

## Screenshots / logs

<!-- If visual change: attach before/after.
     If behavior change: attach sample log lines. -->