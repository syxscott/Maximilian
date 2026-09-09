# Service Level Objectives (SLOs)

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 9)
**Review cadence**: Monthly

This document defines the SLOs Maximilian commits to. Each SLO has:

- a **service indicator** (the user-visible metric),
- a **target** (the threshold the indicator must stay above/below),
- a **budget** (the allowed error budget over the measurement window),
- an **alert** (the page that fires when budget is exhausted).

All SLOs are measured over a rolling **30-day window**.

## API SLOs

### SLO-1: API availability

| Field         | Value |
| ------------- | ----- |
| Indicator     | `http_server_requests{outcome="success",api_route!~"/metrics|/health"}` |
| Target        | ≥ 99.9% successful (non-5xx) responses |
| Error budget  | 0.1% × 30d = ~43 minutes of downtime |
| Alert         | Page on-call at 50% budget burned |

### SLO-2: API latency

| Field         | Value |
| ------------- | ----- |
| Indicator     | `http_server_request_duration_seconds{quantile="0.95"}` for `/api/chat` and `/api/plan` |
| Target        | P95 ≤ 2.0s |
| Error budget  | ≤ 2% of requests > 2.0s |
| Alert         | Page on-call at 75% budget burned |

## LLM Kernel SLOs

### SLO-3: TruthAudit calibration accuracy

| Field         | Value |
| ------------- | ----- |
| Indicator     | `truth_audit_verdict_accuracy` (proportion of `correct` verdicts over `total` measurements) |
| Target        | ≥ 80% over rolling 30d |
| Error budget  | 20% incorrect verdicts |
| Alert         | Page on-call at 100% budget burned (calibration drift) |

### SLO-4: opencode session leak rate

| Field         | Value |
| ------------- | ----- |
| Indicator     | `opencode_session_leak_total` (sessions abandoned without `abortSession` call) / `opencode_session_created_total` |
| Target        | < 0.01% leak rate |
| Error budget  | 1 leak per 10,000 sessions |
| Alert         | Page on-call when leak rate > 0.1% over 1h window |

## Orchestrator SLOs

### SLO-5: Meta-cycle duration

| Field         | Value |
| ------------- | ----- |
| Indicator     | `meta_cycle_duration_seconds{quantile="0.95"}` |
| Target        | P95 ≤ 60s |
| Error budget  | ≤ 5% of cycles > 60s |
| Alert         | Page on-call at 200% budget burned (10%+ cycles > 60s) |

## Implementation notes

These SLOs are **declared** and **partially instrumented** (Phase 9):

- Indicators `http_server_requests`, `http_server_request_duration_seconds`
  are emitted via `@max/telemetry`'s OpenTelemetry SDK. The OTel collector
  must be configured with an OTLP exporter to fan them to Prometheus /
  Honeycomb / Tempo. See `observability/otel-collector.yaml` for the
  commented-out Honeycomb / Tempo / Prometheus remote_write hints.
- `truth_audit_verdict_accuracy` — instrumented in
  `packages/meta-system/src/truth-audit.ts` (`buildReport` increments
  `truthAuditVerdictsTotal{verdict=...}` per verdict). SLO-3 chart =
  `accurate / total` where total = sum of all `verdict` label values.
- `opencode_session_leak_total` — instrumented in
  `packages/core/src/runtime.ts` (`abort()` calls
  `OpencodeExecutor.leakedSessionsOnAbort` per cached workspace).
- `opencode_session_created_total` — instrumented in
  `packages/core/src/opencode-executor.ts` (`executeTask` increments
  only when SessionPool actually creates a fresh session — pool hits
  don't double-count).
- `meta_cycle_duration_seconds` — instrumented in
  `packages/meta-system/src/orchestrator.ts` (`cycle()` observes at
  return).

The OTLP exporter plumbing is documented but the collector still ships
with the `debug` exporter by default. To turn on Prometheus / Honeycomb /
Tempo, uncomment the relevant block in `observability/otel-collector.yaml`
and add the exporter name to the `service.pipelines` `exporters:` array.

## How to update

SLO targets should change slowly. To propose a change:

1. Open an ADR with the proposed target, the rationale, and the
   expected user impact.
2. Add the new target as a `target_next_quarter` field next to the
   current target so dashboards can show both during the transition.
3. After a quarter, update the target and remove the field.

If a target is consistently met with budget to spare, raise it.
If a target is consistently burned, lower it (and file the
underlying reliability issue so the lower target doesn't become a
ceiling).