# E2E Tests (Playwright)

End-to-end browser tests for the Maximilian dashboard. Tests stub API calls
via `page.route()` so they run without a live API or LLM keys.

## Quick Start

```bash
# Install browser binaries (one time)
pnpm exec playwright install chromium

# Run tests (auto-starts dashboard dev server on port 5173)
pnpm test

# With UI mode for debugging
pnpm test:ui
```

## Running Against a Live Stack

To test against a real API + dashboard:

```bash
# Terminal 1: start API
pnpm --filter @max/api dev

# Terminal 2: start dashboard
pnpm --filter @max/dashboard dev

# Terminal 3: run tests
E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:5173 pnpm test
```

## Structure

- `playwright.config.ts` — test config, browser projects, web server
- `tests/*.spec.ts` — test files
- `package.json` — `@playwright/test` dependency

## CI Integration

The Playwright config automatically:
- Uses GitHub reporter in CI (`process.env.CI`)
- Retries twice on failure in CI
- Generates HTML report at `playwright-report/`

Upload the report as a CI artifact:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: playwright-report
    path: e2e/playwright-report/
```
