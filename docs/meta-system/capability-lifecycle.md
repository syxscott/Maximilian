# Capability Lifecycle

A **capability** is a unit of organizational skill (e.g., `frontend`, `backend`, `mobile_app_development`). It is the *what* of the organization. Agents are the *who*.

## State Machine

```
                ┌────────────┐
                │  PROPOSED  │
                │ (new)      │
                └──────┬─────┘
                       │ cycle()
                       ▼
                ┌────────────┐
                │EXPERIMENTAL│
                └──────┬─────┘
                       │ cycle()
                       ▼
        ┌──────────────────────────┐
        │         ACTIVE           │◄────────┐
        │ (serves traffic)         │         │ revival
        └──────┬───────────────────┘         │
               │                             │
               ▼                             │
        ┌──────────────┐                     │
        │  DEPRECATED  │─────────────────────┘
        └──────┬───────┘
               │ manual / capability_retired
               ▼
        ┌──────────────┐
        │   RETIRED    │  (terminal)
        └──────────────┘
```

## Valid Transitions

Defined in `CapabilityRegistry.VALID_TRANSITIONS`:

| From | To |
|------|-----|
| `proposed` | `experimental`, `active`, `retired` |
| `experimental` | `active`, `deprecated`, `retired` |
| `active` | `deprecated`, `retired` |
| `deprecated` | `retired`, `active` (revival) |
| `retired` | (none — terminal) |

Illegal transitions throw — e.g., `proposed → deprecated` is forbidden.

## Auto-Promotion Policy

In `MetaOrchestrator.cycle()`, capabilities move forward automatically:

| Current state | Action |
|---------------|--------|
| `proposed` | → `experimental` |
| `experimental` | → `active` |
| `active` | (no auto-action) |
| `deprecated` | (no auto-action) |
| `retired` | (no auto-action) |

The conservative defaults keep new capabilities on a fast track. Future work: require N executions with avg score ≥ 7 before activating.

## Why This Shape?

1. **`proposed`**: New capability found by `CapabilityDiscoveryEngine` — not yet trusted.
2. **`experimental`**: Registered, but not yet a first-class citizen (no blueprint yet).
3. **`active`**: Has a blueprint, is available in `DAGS.compose`.
4. **`deprecated`**: Replaced or stale, but not yet deleted (revival possible).
5. **`retired`**: Terminal. Capability is dead.

## Usage Example

```typescript
import { CapabilityRegistry } from "@max/meta-system";

const registry = new CapabilityRegistry("./workspaces");

// 1. Discovery proposes a new capability
await registry.propose({
  capabilityId: "blockchain_development",
  displayName: "Blockchain Development",
  description: "Build smart contracts and DApps",
});

// 2. Auto-promotion on cycle
await registry.transition("blockchain_development", "experimental");
await registry.transition("blockchain_development", "active");

// 3. Track usage
await registry.recordUsage("blockchain_development", 8.5, 3000);

// 4. Eventually deprecate
await registry.transition("blockchain_development", "deprecated");

// 5. Or revive
await registry.transition("blockchain_development", "active");

// 6. Or retire
await registry.transition("blockchain_development", "retired");
```

## Events Emitted

Every transition is logged to `OrganizationMemory`:

| Event | When |
|-------|------|
| `capability_proposed` | `registry.propose()` |
| `capability_promoted` | Each `transition()` (with `from`/`to` in payload) |
| `capability_deprecated` | `transition to deprecated` |
| `capability_retired` | `transition to retired` |

These are append-only — see [org-evolution.md](org-evolution.md) for replayability.