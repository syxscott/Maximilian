# Load Tests

k6-based load tests for the Maximilian API. Each script targets a
specific workload profile; run them in order against a fresh stack to
establish a baseline.

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) (v0.50+)
- A running Maximilian stack — local `docker-compose up` is the easiest
  target. Tests assume `BASE_URL=http://localhost:3001` by default.
- A clean Postgres — tests provision users and workspaces; reuse on
  a dirty DB will see prior load-test artifacts.

## Scripts

| Script | VUs | Target SLA | What it measures |
|--------|-----|-----------|------------------|
| `k6-auth.js` | 30 | p95 register/login < 1.5s, p95 refresh < 800ms | bcrypt throughput, refresh-token rotation, replay rejection |
| `k6-read.js` | 50 | p95 reads < 1s, p95 health < 100ms | list/get endpoints under load |
| `k6-chat.js` | 50 | p95 < 2s | chat enqueue latency |
| `k6-mixed.js` | 50 | p95 < 2s, error rate < 5% | weighted realistic workload |
| `load-test.mjs` | any | p95 reads < 1s | Node.js fallback when k6 isn't installed |

`k6-auth.js` includes a regression check for the refresh-token
TOCTOU fix in `apps/api/src/routes/auth.ts`: after a successful
refresh, replaying the old refresh token must return 401.

## Running

```bash
# Quick smoke — single VU, 10s
k6 run --vus 1 --duration 10s benchmarks/load/k6-read.js

# Full read workload
k6 run benchmarks/load/k6-read.js

# Mixed workload
k6 run benchmarks/load/k6-mixed.js

# Override target
BASE_URL=https://staging.maximilian.example k6 run benchmarks/load/k6-read.js

# Pure-Node fallback (no k6 install)
node benchmarks/load/load-test.mjs --auto-register --vu 50 --duration 30
node benchmarks/load/load-test.mjs --auth $TOKEN --path /api/executions
```

## Interpreting results

k6 prints a threshold summary at the end of each run. Failed
thresholds exit non-zero, which makes them suitable for CI gating.
The thresholds are tuned for a single-node docker-compose deployment
on developer hardware — production targets depend on the deployed
instance size and should be re-baselined.

Common failure modes:

- **`http_req_duration` p95 too high on `/api/workspaces`**: usually
  means Postgres is the bottleneck. Check `EXPLAIN ANALYZE` on the
  list query, look at index usage on `tenant_id`.
- **`auth_errors` rate > 5% in `k6-auth.js`**: bcrypt at cost 12 is
  CPU-bound. Reduce VU count or pre-provision users (the other
  scripts already do this).
- **`/api/chat` 503 spike**: worker pool saturated. Either increase
  `WORKER_CONCURRENCY` or scale the worker process.

## Environment variables

| Variable | Default | Notes |
|----------|---------|-------|
| `BASE_URL` | `http://localhost:3001` | API root |
| `LOAD_TEST_TOKEN` | (none) | JWT to use with `load-test.mjs --auth` |