# Production Deployment Runbook

End-to-end deployment guide for Maximilian — from a clean VM to a fully
running production stack with auth, PostgreSQL, the worker, observability,
and a back-up plan.

For security disclosure and hardening, see `SECURITY.md`.
For the OpenAPI spec and Swagger UI, see `README.md` § API documentation.

## 1. Topology

```
                                    ┌──────────────────┐
                                    │  PostgreSQL 16   │
                                    │  (data plane)    │
                                    └──────────────────┘
                                             ▲
                                             │
              ┌──────────────────┐    ┌──────┴───────┐    ┌──────────────────┐
   browsers ──┤  Dashboard       │    │  API (Hono)  │    │  Worker (BullMQ) │
              │  (React 19 SPA) │───▶│  Node.js 20  │───▶│  Node.js 20     │
              │  nginx static    │    │  + JWT auth  │    │  (chat executor)│
              └──────────────────┘    └──────┬───────┘    └────────┬─────────┘
                                              │                    │
                                              ▼                    ▼
                                       ┌──────────┐        ┌──────────┐
                                       │ Redis 7  │◀───────│  BullMQ  │
                                       └──────────┘        └──────────┘
                                              ▲
                                              │
                                       ┌──────────────┐
                                       │  OTel/Prom   │
                                       │  (scrape)    │
                                       └──────────────┘
```

## 2. Prerequisites

- **Linux x86_64** host(s) with Docker 24+ and Compose v2
- 4 GB RAM minimum per API/worker instance
- Outbound HTTPS to your LLM provider (OpenAI / Anthropic / OpenRouter)
- A domain with TLS — required for `Strict-Transport-Security` and OAuth flows
- A reverse proxy (nginx, Caddy, ALB, …) for TLS termination and
  `X-Forwarded-For` plumbing

## 3. Generate secrets

**Do not commit these.** Set them in your secrets manager (Vault, AWS SSM,
GitHub Actions secrets, …) and inject them as env vars at runtime.

```bash
# 32-byte random JWT signing key
openssl rand -hex 32
# e.g. → 3f7b…64

# Admin token for /api/metrics
openssl rand -hex 24
# e.g. → 9e1a…4c

# PostgreSQL password (matches docker-compose.yml; override both)
openssl rand -hex 16
```

## 4. Configure environment

Create a `.env` (gitignored) with the following:

```bash
NODE_ENV=production
PORT=3001

# Required: at least one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Required: JWT signing
JWT_SECRET=<from step 3>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Required: PostgreSQL
DATABASE_URL=postgresql://maximilian:<db-password>@postgres:5432/maximilian?sslmode=require

# Required: ADMIN_TOKEN for /api/metrics
ADMIN_TOKEN=<from step 3>

# Required: tell the rate-limiter which proxies to trust
TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12

# CORS: the dashboard origin (no trailing slash)
CORS_ORIGIN=https://app.maximilian.example

# BullMQ + worker
REDIS_URL=redis://redis:6379
TASK_QUEUE_ENABLED=true
WORKER_CONCURRENCY=3

# Storage
WORKSPACE_DIR=/var/lib/maximilian/workspaces

# Feature flags
EVOLUTION_ENABLED=true
DAGS_MODE=false
META_AGENT_ENABLED=true
DIGITAL_TWIN_ENABLED=true
TELEMETRY_ENABLED=true
SAFE_ROLLOUT_MODE=shadow

# Observability
OTEL_ENABLED=true
OTEL_SERVICE_NAME=maximilian-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

LOG_LEVEL=info
```

## 5. Start the stack

### 5.1 Full stack with all profiles

```bash
docker compose \
  --profile queue \
  --profile observability \
  up -d
```

This brings up:
- `postgres` (always)
- `api` (always)
- `dashboard` (always)
- `redis` (queue profile)
- `worker` (queue profile)
- `otel-collector` (observability profile)
- `prometheus` (observability profile)

### 5.2 Health check

```bash
# Wait for the API to become ready
until curl -sf http://localhost:3001/api/ready; do sleep 1; done

# Inspect
curl -s http://localhost:3001/api/health | jq
curl -s http://localhost:3001/api/ready | jq
```

- `/api/health` returns 200 with `status: "ok"` when every probe passes.
- `/api/ready` returns 200 with `status: "ready"` when the database is
  reachable and LLM providers are configured. **Wire this to your K8s
  readinessProbe** — `/api/health` is a less strict liveness check.

### 5.3 Create the first admin user

```bash
# Register a user via the API
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<strong-password>","role":"admin"}'

# Save the returned access + refresh tokens
export MAX_TOKEN=<access token>
```

For a multi-tenant setup, also create the tenant first:

```bash
curl -X POST http://localhost:3001/api/tenants \
  -H "Authorization: Bearer $MAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","slug":"acme"}'
```

## 6. Reverse proxy (nginx example)

```nginx
server {
  listen 443 ssl http2;
  server_name api.maximilian.example;

  ssl_certificate     /etc/letsencrypt/live/api.maximilian.example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.maximilian.example/privkey.pem;

  # Add the proxy IP to X-Forwarded-For so the rate-limiter can read it.
  # The api service trusts IPs in TRUSTED_PROXIES.
  set_real_ip_from 10.0.0.0/8;
  real_ip_header   X-Forwarded-For;

  location / {
    proxy_pass http://api:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # SSE: disable buffering for /api/events/bus and /api/workspaces/:id/stream
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
  }
}
```

## 7. Kubernetes

A full Helm chart is out of scope for this MVP; the bare minimum is:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: maximilian-api }
spec:
  replicas: 2
  selector: { matchLabels: { app: maximilian-api } }
  template:
    metadata: { labels: { app: maximilian-api } }
    spec:
      containers:
        - name: api
          image: maximilian/api:latest
          ports: [{ containerPort: 3001 }]
          env:
            - { name: NODE_ENV, value: production }
            # … secrets via Secret references …
          readinessProbe:
            httpGet: { path: /api/ready, port: 3001 }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /api/health, port: 3001 }
            periodSeconds: 30
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { cpu: "2",    memory: "2Gi" }
```

Same shape for the worker (no readiness probe needed; liveness
`/api/worker/heartbeat` if you've enabled it via BullMQ's built-in).

## 8. Scaling

- **API**: stateless, scale horizontally. Rate limits are per-IP, so a
  single client can hit `N * 100 req/min` with N replicas — fine for
  the production plan's 100 req/min cap.
- **Worker**: scale by `WORKER_CONCURRENCY` per pod. The queue
  automatically balances across workers. Don't go above 32/worker
  without measuring LLM-provider rate limits.
- **PostgreSQL**: connection pool sizing matters. Each API instance
  opens a pool; total `pool_size × replicas` should stay under
  `max_connections - 50` (reserve 50 for migrations and admin).

## 9. Backups

```bash
# Daily: full logical backup
docker compose exec -T postgres \
  pg_dump -U maximilian -Fc maximilian \
  > /backups/max-$(date +%F).pgdump

# Restore
docker compose exec -T postgres \
  pg_restore -U maximilian -d maximilian --clean --if-exists \
  < /backups/max-2026-06-27.pgdump
```

For WAL archiving / PITR, set up `wal-g` or AWS RDS automated backups.

The `workspaces/` directory is **not** part of the PG backup — it's
the file-based fallback storage used when `DATABASE_URL` is unset. In
production with PG enabled, ephemeral agent state lives in PG and
artifacts live in PG. If you opt into the file-store for any reason
(`/api/chat` with a workspace that writes large files), back up
`WORKSPACE_DIR` separately.

## 10. Observability

### Prometheus

`prometheus` (compose observability profile) scrapes `/api/metrics` on
the API container. The default config (`observability/prometheus.yaml`)
also scrapes the worker's heartbeat. View at <http://localhost:9090>.

Key metrics:
- `maximilian_http_request_total{method,route,status}`
- `maximilian_http_request_duration_seconds_bucket{method,route,status,le}`
- `maximilian_task_total{role,status}` and `…_duration_seconds`
- `maximilian_active_workspaces`
- `maximilian_llm_tokens_total{provider,model,direction}`

### OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to a collector. The
`otel-collector` (compose) accepts both OTLP gRPC (4317) and HTTP
(4318). The collector's default config writes to stdout; in production
swap for the OTLP exporter of your choice (Tempo, Jaeger, Honeycomb,
Datadog, …).

### Logs

Logs are structured JSON (pino). Pipe to your aggregator (Loki, ELK,
CloudWatch). Each request carries a `X-Request-Id` header for
correlation — search by this to reconstruct a full call tree.

## 11. Operational procedures

### 11.1 Rolling restart

```bash
docker compose up -d --no-deps --build api
# Wait for readiness, then next replica
```

K8s: a normal `kubectl rollout restart` works. The readiness probe
gates traffic from old → new cleanly.

### 11.2 Database migration

```bash
# 1. Run migrations BEFORE the new API rolls out
DATABASE_URL=postgresql://maximilian:$DB_PASS@postgres:5432/maximilian \
  docker compose run --rm api node scripts/migrate.mjs
```

Never run migrations against a live DB while the old API is still
serving traffic if the schema change is destructive.

> Auto-migration on API startup is intentionally **not** a feature — it
> makes rolling restarts unsafe (two API replicas racing on the same
> DDL). Run migrations as a separate deploy step. Same reason the
> K8s Job pattern in §7 calls `migrator` as its own container rather
> than a preStart hook.

### 11.3 Rotate JWT_SECRET

```bash
# 1. Generate new secret
NEW=$(openssl rand -hex 32)
# 2. Update the secret in your secret store
# 3. Restart API instances one at a time
# 4. Note: ALL existing access tokens are invalidated. Refresh tokens
#    are signed with the same secret, so they also get invalidated;
#    clients must re-authenticate. Keep this in mind for the deploy
#    window — coordinate with the team or schedule for low-traffic.
```

> Zero-downtime dual-sign rotation (verify against old + new secret
> during the rollover) is a planned addition. Until it lands, plan a
> 1–2 minute window of forced re-auths across your user base.

### 11.4 Incident — chat jobs piling up

```bash
# Inspect queue depth
docker compose exec redis redis-cli LLEN bull:chat:waiting

# Scale workers
docker compose up -d --scale worker=5

# Drain
docker compose exec redis redis-cli FLUSHDB  # CAUTION: drops all jobs
```

### 11.5 Incident — disk full

```bash
# Old telemetry JSONL files pile up
docker compose exec api sh -c 'ls -la /app/telemetry* | head'
# Truncate or move aside
docker compose exec api sh -c '> /app/telemetry.jsonl'
```

For long-term, switch to a log shipper (Vector, Promtail) so logs
don't accumulate on the API disk.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/ready` returns 503 | DB unreachable | check `DATABASE_URL`, check `pg_isready` from API container |
| `/api/health` shows `llm: degraded` | provider key missing or invalid | check `ANTHROPIC_API_KEY` etc. |
| 401 on every request | `JWT_SECRET` rotated mid-session | clients re-auth; or use dual-sign |
| 429 on dashboard polls | rate limit hit | raise limit, or scope to IP range, or scale API replicas |
| `telemetry.jsonl` huge | no log rotation | add logrotate or switch to log shipper |
| Worker not picking up jobs | Redis disconnected | check `REDIS_URL`, check `docker compose ps` |
| OpenAPI spec empty | `createRoute` not used in a route file | convert to `api.openapi()` (see `apps/api/test/openapi-coverage.test.ts`) |
| `circuit breaker is OPEN` in logs | LLM provider flaky | wait for `resetTimeout` (default 30s, ±20% jitter), check provider status page |

## 13. Capacity planning (rough estimates)

- **1 vCPU, 2 GB RAM** API handles ~30 req/s sustained chat workload
  (assuming 5s LLM latency, 10 in-flight workspaces).
- **1 vCPU, 1 GB RAM** worker handles ~3 concurrent chat jobs.
- **PostgreSQL**: 1 GB disk per 10k workspaces (rough — depends on
  plan/result size).
- **Redis**: ~10 MB per 1k queued jobs.
- **SSE bus**: in-memory, ring buffer 64 events per workspace. Not a
  bottleneck for any realistic workload.

Re-baseline with `benchmarks/load/load-test.mjs` after any change to
runtime, queue config, or DB indexes.
