# Error Taxonomy

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 9)

This document defines how errors are classified across the system. The
classification feeds three consumers:

1. **Retry logic** — retryable errors get a backoff, permanent errors fail-fast.
2. **Alerting** — retryable errors are noise; permanent ones page on-call.
3. **TruthAudit** — incorrect verdicts require a calibration event; transient
   errors don't.

## Categories

### `retryable`

The error is expected to clear on retry — network blips, upstream rate
limits, transient resource exhaustion.

Examples:
- `fetch` ECONNRESET, ETIMEDOUT
- HTTP 502, 503, 504 from upstreams
- `opencode serve` returning `session.error{ type: "provider_error", retryable: true }`

Retry policy: exponential backoff with jitter, max 5 attempts before
the request is marked `failed`.

### `permanent`

The error will not clear without operator intervention — schema drift,
configuration drift, exhausted budget.

Examples:
- HTTP 400, 401, 403, 404
- Zod schema parse failure on a known-good input (regression)
- `opencode serve` returning `session.error{ type: "configuration_error" }`

Retry policy: 0 retries. Fail-fast and surface to the caller.

### `budget`

The error is a budget / quota exhaustion — meaningful for cost-aware
routing and SLO dashboards, not for reliability.

Examples:
- Anthropic 429 with `anthropic-ratelimit-tokens-remaining: 0`
- Stripe-style "credit exhausted" responses

Retry policy: depends. If the budget refreshes in a known window
(e.g. hourly rate limit), retry with `retry-after`. Otherwise treat
as `permanent`.

### `unknown`

Anything that doesn't fit. Logs to OTel with the original payload so
on-call can classify. Defensive default: treat as `retryable` with a
single retry, then `permanent`.

## Where the taxonomy is enforced

| Layer | File | Behaviour |
| ----- | ---- | --------- |
| opencode executor | `packages/core/src/opencode-executor.ts` | Maps `session.error.type` → taxonomy tag, sets `metadata.retryable` |
| provider failover | `packages/providers/src/circuit-breaker.ts` | Counts `retryable` errors against circuit; `permanent` errors skip the retry path |
| runtime | `packages/core/src/runtime.ts` (Phase 3 H5) | AbortError → propagate; other errors → fallback to in-process path |
| orchestrator | `packages/meta-system/src/orchestrator.ts` | `permanent` errors mark proposal `failed`; `retryable` errors keep proposal `pending` |

## Adding a new category

If you find yourself adding new branches to error-handling code, that's
the signal that the taxonomy needs a new category. Open an ADR and
update this doc + the consumers in the same PR.