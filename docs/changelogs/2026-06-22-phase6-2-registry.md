# Phase 6.2 — Capability Registry (Lifecycle State Machine)

**Date**: 2026-06-22
**Status**: Completed

## What

`CapabilityRegistry` manages capability lifecycle with explicit transitions.

## Implementation

`packages/meta-system/src/capability-registry.ts`:

- `propose(input)` — creates a capability in `proposed` status
- `transition(id, to)` — moves along lifecycle, validates against `VALID_TRANSITIONS` map
- `recordUsage(id, score, durationMs)` — updates rolling avgScore and avgDuration
- `get(id)` / `listAll()` / `listByStatus(status)`
- Persists to `<rootDir>/capability-registry/<id>.json`

## State Machine

```
proposed → experimental → active → deprecated → retired
                              ↑           │
                              └───────────┘ (revival)
```

## Decisions

- ADR-020: Capability lifecycle state machine

## Tests (11 unit tests)

- creates `proposed` capability
- transitions proposed → experimental → active
- rejects illegal transitions
- allows active → deprecated → active (revival)
- records retirement timestamp
- rejects duplicate propose
- lists by status
- recordUsage updates stats (and averages correctly)

## Verification

```bash
pnpm --filter @max/meta-system test  # 11/11 pass
```