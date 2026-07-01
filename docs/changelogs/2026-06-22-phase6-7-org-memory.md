# Phase 6.7 — Organization Memory

**Date**: 2026-06-22
**Status**: Completed

## What

`OrganizationMemory` is the append-only event log of all meta-system changes.

## Implementation

`packages/meta-system/src/organization-memory.ts`:

- `record(type, subject, payload)` — writes one JSON file per event
- `listAll()` — sorted chronologically
- `timeline(subject)` — filter by subject
- `countByType()` — aggregate counts

Persists to `<rootDir>/org-events/<evt-id>.json`.

## Decisions

- ADR-025: OrganizationMemory is append-only

## Tests (6 unit tests)

- records a capability_proposed event
- lists all events
- filters timeline by subject
- counts events by type
- returns empty list when no events
- sorts events chronologically

## Verification

```bash
pnpm --filter @max/meta-system test  # 6/6 pass
```