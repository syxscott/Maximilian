# Phase 6 — Stage 2: Capability Registry (Lifecycle)

**Date**: 2026-06-22
**Status**: ✅ Completed

## Deliverable

`CapabilityRegistry` — 5-state capability lifecycle with explicit transitions.

## Lifecycle

```
proposed → experimental → active → deprecated → retired
                          ↑           │
                          └───────────┘ (revival)
```

## Tests

11 unit tests covering: creation, valid transitions, illegal transition rejection, revival path, retirement timestamp, duplicate rejection, listByStatus, recordUsage, average computation.