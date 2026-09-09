# Maximilian Demo Infrastructure

Infrastructure-as-code for the **public demo** at
https://demo.maximilian.dev.

## What's here

| File | Purpose |
|---|---|
| `fly.api.toml` | Fly.io app config for the API |
| `fly.worker.toml` | Fly.io app config for the worker |
| `vercel.json` | Vercel project config for the dashboard |
| `reset-cron.json` | Daily reset cron job |
| `README.md` | This file |

## Prerequisites

1. Install the Fly.io CLI: `curl -L https://fly.io/install.sh | sh`
2. Install the Vercel CLI: `npm i -g vercel`
3. Have a Fly.io account (free tier).
4. Have a Vercel account (free tier).

## Bootstrap (one-time)

```bash
# 1. Create Fly apps
fly apps create maximilian-api-demo
fly apps create maximilian-worker-demo

# 2. Create Vercel project
vercel link

# 3. Set secrets
fly secrets set DATABASE_URL=... -a maximilian-api-demo
fly secrets set REDIS_URL=... -a maximilian-api-demo
fly secrets set LLM_API_KEY=... -a maximilian-api-demo
vercel env add VITE_API_URL production
# ... etc

# 4. Deploy
fly deploy -c fly.api.toml
fly deploy -c fly.worker.toml
vercel --prod
```

## CI deployment

Once bootstrapped, pushes to `main` redeploy automatically via
[`.github/workflows/demo-deploy.yml`](../../.github/workflows/demo-deploy.yml).

## Tearing down

```bash
fly apps destroy maximilian-api-demo
fly apps destroy maximilian-worker-demo
vercel projects rm maximilian-demo
```

See [`docs/operations/demo-deployment.md`](../../docs/operations/demo-deployment.md)
for the full demo overview.