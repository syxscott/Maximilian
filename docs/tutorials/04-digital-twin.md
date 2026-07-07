# Tutorial 04: Digital Twin — Shadow → Canary → Full Rollout

> **Length**: 10 minutes
> **Audience**: operators rolling out a new agent version
> **Goal**: explain Digital Twin safety harness and show a canary rollout

## Pre-roll (10s)

VO: "Rolling out a new agent is risky. Maximilian's Digital Twin lets
you test in production without touching users. Shadow, canary, full —
in ten minutes."

## Shot 1 — Why Digital Twin (60s)

VO: "Staging environments lie. They never have your real traffic, your
real users, your real edge cases. The Digital Twin runs new code
side-by-side with production, on real traffic, but only the old code's
output reaches users."

Diagram:

```
                    Real traffic
                         │
                ┌────────┴────────┐
                ▼                 ▼
            [old agent]      [new agent]   ← both see the input
                │                 │
                ▼                 ▼
            user sees       logged + verified
            this            for accuracy
```

## Shot 2 — Shadow mode (2 min)

Step 1: Deploy new version, but in shadow mode:

```bash
curl -X POST http://localhost:3000/v1/digital-twin/deploy \
  -d '{
    "capabilityId": "summarizer-v3",
    "mode": "shadow",
    "trafficPercent": 100
  }'
```

VO: "100% of real traffic flows through both old and new. The user only
sees old. The new is logged and graded by an automatic eval."

Step 2: Watch the comparison:

```bash
curl http://localhost:3000/v1/digital-twin/compare/summarizer-v3
```

Output:

```json
{
  "samples": 1000,
  "matchRate": 0.94,
  "oldCorrectRate": 0.87,
  "newCorrectRate": 0.91,
  "latencyDeltaMs": -42
}
```

VO: "94% of outputs match. New is faster and slightly more accurate.
Green light for canary."

## Shot 3 — Canary mode (3 min)

Promote to canary:

```bash
curl -X POST http://localhost:3000/v1/digital-twin/promote \
  -d '{"capabilityId":"summarizer-v3"}'
```

Show dashboard — traffic split:

```
summarizer-v2: 95%
summarizer-v3: 5%   ← canary
```

VO: "5% of users see the new agent. We watch error rate, latency,
TruthAudit scores."

Show the live dashboard with three graphs:

- Error rate (old vs new)
- p99 latency (old vs new)
- User feedback signal (thumbs up/down)

After a successful 30 minutes, promote to 25%, 50%, 100%.

If any metric regresses > 10%, an auto-rollback fires:

```bash
# Watch the rollback in the logs
tail -f /var/log/maximilian/digital-twin.log
```

```
[10:42:13] summarizer-v3: error rate +18% > 10% threshold
[10:42:13] AUTO-ROLLBACK triggered
[10:42:14] summarizer-v3: trafficPercent 25% → 0%
[10:42:14] summarizer-v2: trafficPercent 75% → 100%
```

VO: "If anything goes wrong, auto-rollback. Faster than any human."

## Shot 4 — Full rollout (2 min)

```bash
curl -X POST http://localhost:3000/v1/digital-twin/promote \
  -d '{"capabilityId":"summarizer-v3"}'
```

Show traffic now at 100% new.

VO: "Full rollout. Old is retired."

```bash
curl -X POST http://localhost:3000/v1/evolution/retire \
  -d '{"capabilityId":"summarizer-v2"}'
```

## Shot 5 — Configuration (60s)

Show `config/digital-twin.json`:

```json
{
  "autoRollback": {
    "errorRateDelta": 0.10,
    "latencyDeltaMs": 500,
    "calibrationDelta": 0.05
  },
  "canaryStages": [
    { "percent": 5, "minDurationMinutes": 30 },
    { "percent": 25, "minDurationMinutes": 60 },
    { "percent": 50, "minDurationMinutes": 120 },
    { "percent": 100, "minDurationMinutes": 0 }
  ]
}
```

VO: "Configurable. Error rate delta, latency delta, calibration delta.
Stages can be tuned per capability."

## Shot 6 — Wrap-up (15s)

VO: "Shadow, canary, full. Auto-rollback on regression. That's
Maximilian's Digital Twin. Production-safe rollouts, no surprises."

## Recording checklist

- [ ] Pre-deploy the canary in shadow mode BEFORE recording.
- [ ] Pre-populate the comparison results.
- [ ] Use a fast terminal scroll — viewers don't need to read every line.
- [ ] Show the auto-rollback live (it's dramatic).

## Post-production

- Use picture-in-picture: dashboard on top, terminal on bottom.
- Animate the traffic-percent split as it changes.
- Slow-mo the auto-rollback logs.