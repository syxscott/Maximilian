# ADR-025: OrganizationMemory is Append-Only

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 6

## Context

The organization must be replayable. To rebuild how the org evolved from proposed → active → deprecated → retired, we need an immutable record of every change.

A relational table would work, but introduces DB coupling. A mutable JSON store is dangerous (silent overwrites). An in-memory log is lost on restart.

## Decision

`OrganizationMemory` writes one JSON file per event to `<rootDir>/org-events/<evt-id>.json`:

```json
{
  "id": "evt-abc12345",
  "type": "capability_promoted",
  "subject": "mobile_app_development",
  "payload": { "from": "experimental", "to": "active" },
  "at": "2026-06-22T17:00:00.000Z"
}
```

Supported `OrgEventType` values: `capability_proposed`, `capability_promoted`, `capability_deprecated`, `capability_retired`, `agent_born`, `agent_retired`, `agent_merged`, `agent_split`, `team_optimized`, `governance_violation`.

Queries: `listAll()`, `timeline(subject)`, `countByType()`. All read-only after the fact.

## Consequences

**正面**：
- Append-only → no accidental overwrites
- File-based → no DB required, easy to inspect with `cat`
- Replayable: any agent's history is `orgMemory.timeline(subjectId)`

**负面**：
- Performance: `listAll()` reads every file (mitigation: index file in future)
- Storage grows unbounded (mitigation: archival policy in future)