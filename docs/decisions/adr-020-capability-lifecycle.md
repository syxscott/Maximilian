# ADR-020: Capability Lifecycle State Machine

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

Capabilities (frontend, backend, mobile_app_development, …) are the unit of organizational capability. They need:

1. A way to be **proposed** when the system encounters a new request type
2. A way to be **experimentally validated** before full commitment
3. A way to be **active** and serve traffic
4. A way to be **deprecated** when replaced
5. A way to be **retired** permanently

Without a lifecycle, capabilities are binary (exists/doesn't exist), making it hard to do safe experimentation.

## Decision

Define a 5-state lifecycle with explicit valid transitions:

```
proposed → experimental → active → deprecated → retired
                          ↑           ↓
                          └───────────┘  (revival)
```

Implemented in `CapabilityRegistry.transition()` with a `VALID_TRANSITIONS` map. Illegal transitions throw (e.g., proposed → deprecated is forbidden).

Auto-promotion in `MetaOrchestrator.cycle()`:
- `proposed` → `experimental` (always, on cycle)
- `experimental` → `active` (always, on cycle)

The conservative defaults keep new capabilities on a fast track but still observable in `organizationMemory` (each transition is logged).

## Consequences

**正面**：
- Traceable history: every transition logged to `OrganizationMemory`
- Safe experimentation: capabilities can be `experimental` without serving traffic
- Easy revival: `deprecated → active` is valid

**负面**：
- More state to track (5 states vs 2)
- Auto-promotion may move capabilities too fast (mitigation: `experimental` window in future)