# Tutorial 03: Self-Evolution — Birth → Promote → Retire

> **Length**: 12 minutes
> **Audience**: operators running Maximilian in production
> **Goal**: explain the 6 evolution actions and show the governance flow

## Pre-roll (10s)

VO: "Maximilian evolves itself. Six actions. Governance optional.
Three demos."

## Shot 1 — The 6 actions (90s)

Whiteboard or terminal-style ASCII:

```
┌──────────────────────────────────────────────────┐
│  BIRTH     new capability discovered            │
│  PROMOTE   shadow → canary → full               │
│  DEMOTE    full → canary → shadow                │
│  MERGE     combine two capabilities              │
│  SPLIT     one capability → two                  │
│  RETIRE    remove a capability                   │
└──────────────────────────────────────────────────┘
```

VO: "Six verbs. Each one is reversible except retire. Each one goes
through governance."

## Shot 2 — Birth (2 min)

Show the dashboard, **Evolution** tab.

1. Discover a new capability automatically:

   ```bash
   curl -X POST http://localhost:3000/v1/evolution/discover \
     -d '{"name":"code-search-v2","evidence":"100/100 eval tasks succeeded"}'
   ```

2. A `pending_proposals` row appears.

3. With governance OFF (`META_AGENT_ENABLED=true`,
   `EVOLUTION_GOVERNANCE=false`), it's auto-approved.

4. With governance ON, an admin gets a notification, opens the
   dashboard, sees:

   ```
   ┌────────────────────────────────────┐
   │  Birth: code-search-v2             │
   │  Evidence: 100/100 succeeded      │
   │  Predicted impact: +12% speedup    │
   │  [Approve]  [Reject]  [Request changes] │
   └────────────────────────────────────┘
   ```

VO: "Governance on or off, the choice is yours. For production, turn
it on. For research, leave it off."

## Shot 3 — Promote (2 min)

Show a capability in `shadow` rollout (1% traffic):

```bash
curl http://localhost:3000/v1/capabilities/code-search-v1
# { ..., "rolloutStage": "shadow", "trafficPercent": 1 }
```

Promote to `canary`:

```bash
curl -X POST http://localhost:3000/v1/evolution/promote \
  -d '{"capabilityId":"code-search-v1"}'
```

Then to `full`:

```bash
curl -X POST http://localhost:3000/v1/evolution/promote \
  -d '{"capabilityId":"code-search-v1"}'
```

VO: "Promote stages a capability through shadow, canary, full. At each
stage, TruthAudit (tutorial 02) verifies the prediction. If drift
appears, it auto-demotes."

## Shot 4 — Demote & Retire (2 min)

Show a capability with TruthAudit drift:

```bash
curl -X POST http://localhost:3000/v1/evolution/demote \
  -d '{"capabilityId":"code-search-v1","reason":"calibration drift 5.2σ"}'
```

VO: "Demote is the safe reversal. The capability goes back to canary
or shadow, traffic is reduced, and the meta-system investigates."

Then retire:

```bash
curl -X POST http://localhost:3000/v1/evolution/retire \
  -d '{"capabilityId":"code-search-v1","reason":"replaced by v2"}'
```

VO: "Retire is permanent. Use it when a capability is fully replaced or
proven broken."

## Shot 5 — Merge & Split (2 min)

Merge two summarizers:

```bash
curl -X POST http://localhost:3000/v1/evolution/merge \
  -d '{"sourceId":"summarizer-v2","targetId":"summarizer-v3"}'
```

Split one capability:

```bash
curl -X POST http://localhost:3000/v1/evolution/split \
  -d '{"sourceId":"general-summarizer","targetA":"news-summarizer","targetB":"academic-summarizer"}'
```

VO: "Merge combines. Split separates. Both create new proposals that go
through governance."

## Shot 6 — Audit trail (90s)

Show the audit log:

```bash
curl http://localhost:3000/v1/evolution/history | head -50
```

VO: "Every action is logged. Who proposed, who approved, when, why.
For compliance, this is gold."

Show `evolution_events` table directly:

```sql
SELECT created_at, action, capability_id, reason, approved_by
FROM evolution_events
ORDER BY created_at DESC LIMIT 20;
```

## Shot 7 — Wrap-up (15s)

VO: "Six actions, full audit, governance on or off. Self-evolution
with accountability. Next: Digital Twin, the shadow-mode testing
harness."

## Recording checklist

- [ ] Pre-seed several capabilities at different rollout stages.
- [ ] Pre-populate `evolution_events` with history.
- [ ] Use a slow terminal scroll so text is readable.
- [ ] Pre-test every curl command.

## Post-production

- Use side-by-side: terminal on left, dashboard on right.
- Highlight the `pending_proposals` row as it appears.
- Add a "before / after rollout" traffic chart.