# Capability Lifecycle Diagram

```
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │              ┌────────────┐                                       │
   │              │  PROPOSED  │ ◄─── CapabilityDiscoveryEngine        │
   │              │            │      "Discovered new capability"      │
   │              └─────┬──────┘                                       │
   │                    │                                              │
   │                    │ cycle()                                      │
   │                    ▼                                              │
   │              ┌────────────┐                                       │
   │              │EXPERIMENTAL│ ◄─── CapabilityRegistry.transition    │
   │              │            │      "Registered, not yet active"     │
   │              └─────┬──────┘                                       │
   │                    │                                              │
   │                    │ cycle()                                      │
   │                    ▼                                              │
   │   ┌───────────────────────────────────────┐                       │
   │   │              ACTIVE                   │ ◄─── birth()           │
   │   │   (serves traffic via DAGS)           │      "Blueprint made" │
   │   │                                       │                       │
   │   └─────────────────┬─────────────────────┘                       │
   │                     │                                             │
   │                     │ manual / governance                         │
   │                     ▼                                             │
   │              ┌────────────┐                                       │
   │              │ DEPRECATED │                                       │
   │              │(still alive│                                       │
   │              │ for query) │                                       │
   │              └─────┬──────┘                                       │
   │                    │                                             │
   │                    ├──► ACTIVE (revival)                          │
   │                    │                                             │
   │                    │ manual / capability_retired                  │
   │                    ▼                                             │
   │              ┌────────────┐                                       │
   │              │  RETIRED   │ (terminal)                           │
   │              │(no birth)  │                                       │
   │              └────────────┘                                       │
   │                                                                   │
   └───────────────────────────────────────────────────────────────────┘
```

## Transitions

| From | To | Trigger |
|------|----|---------|
| proposed | experimental | `cycle()` (auto) |
| proposed | active | (skipped — must pass through experimental) |
| proposed | retired | manual |
| experimental | active | `cycle()` (auto) |
| experimental | deprecated | manual |
| experimental | retired | manual |
| active | deprecated | manual / governance |
| active | retired | manual / capability retired |
| deprecated | active | revival (manual) |
| deprecated | retired | manual |
| retired | (none) | terminal |

## Events Emitted

```
proposed        → capability_proposed (on propose)
proposed→exp    → capability_promoted (from: proposed, to: experimental)
exp→active      → capability_promoted (from: experimental, to: active)
active→deprec   → capability_deprecated
deprec→active   → capability_promoted (revival)
any→retired     → capability_retired
```

Each event is one JSON file in `<rootDir>/org-events/`.

## State Counts (Example)

```
time →
   t0:  { proposed: 0, experimental: 0, active: 5, deprecated: 1, retired: 3 }
   t1:  { proposed: 1, experimental: 0, active: 5, deprecated: 1, retired: 3 }  ← discovered
   t2:  { proposed: 0, experimental: 1, active: 5, deprecated: 1, retired: 3 }  ← cycle
   t3:  { proposed: 0, experimental: 0, active: 6, deprecated: 1, retired: 3 }  ← cycle
   t4:  { proposed: 0, experimental: 0, active: 6, deprecated: 1, retired: 4 }  ← retired stale
```

Read at any time via `GET /api/meta/capabilities`.