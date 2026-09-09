# Performance Baseline

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 12)
**Review cadence**: After every monthly perf-PR drill

This document records the current synthetic-load performance baseline
for Maximilian. It pairs with `docs/operations/slo.md` — every SLO
target is paired with a number here, and the perf-pr workflow
(`.github/workflows/perf-pr.yml`) checks the baseline.

## How to read this

The baseline is the **p95 latency** measured against a fresh
docker-compose stack on the GH runner. The numbers are what we
*currently* get; they're not aspirational. The SLO targets live in
`slo.md`; this document tracks the distance between the baseline and
the target.

## How to run

```bash
# Local — single VU
docker-compose up -d
k6 run --vus 1 --duration 10s benchmarks/load/k6-read.js

# CI — see .github/workflows/perf-pr.yml
# Apply the `perf-check` label to a PR and the workflow runs.
```

## Baselines (commit `ed68f05`, Phase 11)

These numbers are **provisional** — they'll be replaced with measured
numbers after the first nightly `load.yml` run on `main`. The point of
this section is to have a place to record them so the perf-pr
workflow has a target.

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | SLO target | Status |
| -------- | -------- | -------- | -------- | ---------- | ------ |
| `GET /api/health` | _pending measurement_ | _pending_ | _pending_ | — | — |
| `GET /api/workspaces` | _pending_ | _pending_ | _pending_ | p95 ≤ 1s | — |
| `GET /api/workspaces/:id` | _pending_ | _pending_ | _pending_ | — | — |
| `POST /api/auth/login` | _pending_ | _pending_ | _pending_ | p95 ≤ 1.5s | — |
| `POST /api/chat` (stub provider) | _pending_ | _pending_ | _pending_ | p95 ≤ 2s | — |

Each row is mirrored in `benchmarks/load/baselines/p95-{label}-ms.json`:

```
benchmarks/load/baselines/
  p95-read-ms.json
  p95-chat-ms.json
```

These JSON files are referenced by the perf-pr workflow to compute the
`delta` percentage.

## What "stub provider" means

The k6 chat script uses a stub LLM provider (set via `OPENAI_API_KEY=sk-fake`).
This measures **Maximilian overhead** (request parsing, RBAC, runtime
start, ledger writes, SSE bootstrap) but not LLM round-trip time. The
SLO-2 P95 ≤ 2s budget for `/api/chat` includes real LLM latency in
production; the stub-provider measurement gives us the floor.

To get a production-realistic baseline, run k6 against a real provider
account with budget alerts set:

```bash
OPENAI_API_KEY=<real-key> \
k6 run --vus 5 --duration 60s benchmarks/load/k6-chat.js
```

## Throughput baseline

Throughput is recorded as **requests per second at p99 ≤ 1s** per
endpoint. Provisional target (post Phase 12 measurement):

| Endpoint | Target RPS |
| -------- | ---------- |
| `GET /api/health` | 1000 |
| `GET /api/workspaces` | 200 |
| `POST /api/auth/login` | 50 (bcrypt-bound) |
| `POST /api/chat` | 20 |

## Meta-cycle baseline (Phase 1)

The `meta_cycle_duration_seconds` histogram (Phase 9) records each
MetaOrchestrator cycle duration. Provisional targets, based on the
buckets:

| Bucket | Healthy | Warning | Concerning |
| ------ | ------- | ------- | ---------- |
| < 30s | ≥ 95% of cycles | 80-95% | < 80% |
| 30-60s | ≤ 5% | 5-15% | > 15% |
| > 60s | 0% | ≤ 5% | > 5% |

SLO-5 says P95 ≤ 60s, so > 60s should be ≤ 5%.

## What can break the baseline

Operations that historically moved the baseline by > 20%:

- **Adding Zod validation** in a hot path (10-30ms per parse)
- **Removing a single `WHERE tenant_id = ?` clause** (catastrophic — full-table scan)
- **Switching from BullMQ to in-memory queue for tests** (10x faster but
  changes the deployment shape — never do this in production code)
- **Adding a new event listener to `Runtime.emit()`** (each emit fans
  out to SSE + ledger + memory)

The perf-pr workflow catches all of these within 5 minutes (the
default k6 duration + comparison step).

## How to update this doc

1. Run the nightly `load.yml` workflow on `main`.
2. Download the artifact from the workflow run.
3. Update the "Baselines" table with the measured numbers.
4. Update the corresponding JSON file under `benchmarks/load/baselines/`.
5. Open a PR titled "chore: update perf baseline" with the changes.
6. Re-run perf-pr on that PR to confirm no regression.

## Related docs

- [`slo.md`](slo.md) — the SLO targets this baseline measures against
- [`runbook.md`](runbook.md) — INC-002 (LLM provider rate-limited) talks
  to throughput
- [`multi-region.md`](multi-region.md) — RTO/RPO are independent of
  single-region latency but worth checking together