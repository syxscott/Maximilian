# Public Demo Deployment

This document describes the public demo of Maximilian that runs at
**https://demo.maximilian.dev** (placeholder — to be provisioned).

## What is deployed

The demo runs the **full Maximilian stack** with:

- **API**: `https://api-demo.maximilian.dev`
- **Dashboard**: `https://demo.maximilian.dev`
- **Worker**: internal (no public endpoint)
- **Database**: managed PostgreSQL (Neon free tier or Supabase free tier)
- **Redis**: Upstash free tier

It uses the same images published by the
[docker-publish workflow](../../.github/workflows/docker-publish.yml):
`ghcr.io/syxscott/maximilian-{api,dashboard}:latest`.

## Cost

Target: **$0/month** by staying within free tiers.

| Service | Tier | Limit | Current usage |
|---|---|---|---|
| Vercel (dashboard) | Free | 100 GB/mo bandwidth | < 5 GB/mo |
| Fly.io (API + worker) | Free allowance | 3 shared VMs | 2 VMs |
| Neon PostgreSQL | Free | 0.5 GB storage | < 100 MB |
| Upstash Redis | Free | 10k commands/day | < 1k/day |
| GitHub Container Registry | Free | Unlimited public | unlimited |

If usage approaches a tier limit, an alert emails the maintainer.

## Configuration

The demo is configured via:

```bash
# GitHub Actions secrets (repo → Settings → Secrets → Actions)
DEMO_FLY_API_TOKEN=...           # Fly.io deploy token
DEMO_NEON_DATABASE_URL=...       # postgres://...
DEMO_UPSTASH_REDIS_URL=...       # redis://...
DEMO_LLM_API_KEY=...             # OpenAI/Anthropic key (low quota)
DEMO_DASHBOARD_URL=...           # https://demo.maximilian.dev
DEMO_API_URL=...                 # https://api-demo.maximilian.dev
```

These are NOT in the repo. The repo only ships
[`infrastructure/demo/`](#infrastructure) which references them.

## Deployment

Pushing to `main` automatically redeploys the demo via:

```yaml
# .github/workflows/demo-deploy.yml (see repo)
on:
  push:
    branches: [main]
    paths:
      - 'apps/**'
      - 'packages/**'
      - 'infrastructure/demo/**'
      - '.github/workflows/demo-deploy.yml'
```

Steps:

1. Run `pnpm type-check` and `pnpm test` first (the regular CI).
2. Build API + dashboard images.
3. Push to GHCR with `:demo` tag.
4. `flyctl deploy` for the API.
5. `vercel deploy` for the dashboard.

A failed CI run aborts the deployment.

## Demo data

The demo **resets every 24 hours** via a cron job:

```bash
# Cron in Fly.io app
0 4 * * *  pnpm --filter @max/database reset && pnpm --filter @max/database seed
```

This is to prevent user data from accumulating on a free-tier DB. Users
who want persistent data should run Maximilian themselves.

## Seeded scenarios

The seed script (`scripts/seed-demo.ts`) creates a handful of
workspaces demonstrating each feature:

| Workspace | Demonstrates |
|---|---|
| `tour-tokyo` | Multi-agent trip planning |
| `summarize-corpus` | TruthAudit evaluation |
| `code-search-bench` | Digital Twin canary rollout |
| `self-evolve-demo` | Meta-system birth → promote → retire |

## Rate limits

The demo API is rate-limited to be polite to free tiers:

```ts
// apps/api/src/middleware/rate-limit.ts (demo mode only)
RATE_LIMITS = {
  perIp:    { points: 60, duration: 60 },   // 60 req/min
  perToken: { points: 600, duration: 60 },  // 600 req/min with API key
}
```

If you hit a 429, wait a minute. For higher limits, run your own.

## Monitoring

Public status page: **https://status.maximilian.dev** (placeholder).

- Uptime: betterstack.com or uptimerobot.com (free tier)
- Errors: Sentry free tier
- Logs: Logflare or Axiom free tier

## How to get an API key

The demo accepts requests **without** an API key, but quotas are
tighter. To get a key:

```bash
curl -X POST https://api-demo.maximilian.dev/v1/keys \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
```

You'll receive a key by email. Keys are free and capped at 600 req/min.

## Security notes

- The demo runs with `META_AGENT_ENABLED=true` and
  `EVOLUTION_GOVERNANCE=true` so users can see proposals but they
  are not auto-applied.
- `TRUTH_AUDIT_ENABLED=true` so the dashboard shows live calibration.
- The demo **never** stores user API keys for the LLM provider —
  only a single shared key with a hard usage cap.

## Tearing down

If costs become a problem:

```bash
fly apps destroy maximilian-api-demo
fly apps destroy maximilian-worker-demo
vercel projects rm maximilian-demo
neon projects delete maximilian-demo
```

The infrastructure lives in `infrastructure/demo/` and can be re-applied
later.

## Related

- [`docs/operations/deployment.md`](deployment.md) — production deployment
- [`docs/operations/runbook.md`](runbook.md) — incident response
- [`.github/workflows/docker-publish.yml`](../../.github/workflows/docker-publish.yml) — image publishing