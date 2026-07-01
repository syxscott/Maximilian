# Meta-System API Reference

All endpoints require `META_AGENT_ENABLED=true` in `.env`.

## `GET /api/meta/capabilities`

List all capabilities (any status).

**Response**

```json
{
  "count": 3,
  "capabilities": [
    {
      "id": "frontend",
      "displayName": "Frontend",
      "status": "active",
      "usageCount": 42,
      "totalExecutions": 42,
      "avgScore": 8.3,
      "avgDurationMs": 1200,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

## `GET /api/meta/capabilities/:id`

Get a single capability by id.

**Response 200**: CapabilityRecord (see types).
**Response 404**: `{ "error": "not_found" }`

## `GET /api/meta/proposals`

List capability proposals (immutable historical record).

**Response**

```json
{
  "count": 1,
  "proposals": [
    {
      "id": "prop-abc12345",
      "capabilityId": "mobile_app_development",
      "displayName": "Mobile App Development",
      "rationale": "Discovered new capability 'mobile_app_development' from signals: user_request_analysis.",
      "source": "user_request_analysis",
      "evidence": ["Build iOS app", "Write Swift code"],
      "proposedAt": "..."
    }
  ]
}
```

## `POST /api/meta/cycle`

Run one full meta-system cycle.

**Request body**

```json
{
  "recentExecutions": [],          // ExecutionRecord[]
  "blueprints": [],                // AgentBlueprint[]
  "graphs": [],                    // TeamGraph[]
  "discoverySignals": [            // DiscoverySignal[]
    {
      "text": "Build iOS app",
      "context": "user request",
      "source": "user_request_analysis"
    }
  ]
}
```

**Response**

```json
{
  "proposals": [],
  "activated": [],
  "births": [],
  "retirements": [],
  "changePlan": { "decisions": [], "expectedImpact": {}, "rationale": "..." },
  "teamHint": { "suggestions": [], "estimatedCost": 0 },
  "governance": { "allowed": true, "reason": "...", "currentCounts": {} },
  "recorded": 0
}
```

## `GET /api/meta/events`

List organization events (append-only log).

**Query params**

- `subject` — filter by subject (capabilityId or blueprintId)

**Response**

```json
{
  "count": 5,
  "events": [
    {
      "id": "evt-aaa11111",
      "type": "capability_proposed",
      "subject": "mobile_app_development",
      "payload": { "proposalId": "prop-abc12345", "source": "user_request_analysis" },
      "at": "2026-06-22T17:00:00Z"
    }
  ]
}
```

## `GET /api/meta/events/count`

Count events by type.

**Response**

```json
{
  "capability_proposed": 3,
  "capability_promoted": 6,
  "agent_born": 3,
  "team_optimized": 2
}
```

## `POST /api/meta/governance/check`

Check governance verdict for a hypothetical state.

**Request body**

```json
{
  "graphs": [],
  "capabilities": [],
  "blueprints": []
}
```

**Response**

```json
{
  "allowed": true,
  "reason": "Within governance limits",
  "currentCounts": { "agents": 5, "capabilities": 7, "depth": 2 }
}
```

## `POST /api/meta/simulate`

Predict cost/latency/quality/risk for a single org.

**Request body**

```json
{
  "orgName": "OrgA",
  "graph": { /* TeamGraph */ },
  "profiles": {
    "frontend": { "costPerCall": 1, "latencyMs": 1000, "qualityScore": 8 }
  },
  "serialDepth": 3
}
```

**Response**

```json
{
  "orgName": "OrgA",
  "teamSize": 1,
  "totalEstimatedCost": 1,
  "totalEstimatedLatencyMs": 1600,
  "estimatedAvgQuality": 8,
  "riskScore": 0,
  "simulatedAt": "..."
}
```

## `POST /api/meta/simulate/compare`

Compare two orgs and get a recommendation.

**Request body**

```json
{
  "a": { /* same shape as /simulate */ },
  "b": { /* same shape as /simulate */ }
}
```

**Response**

```json
{
  "a": { /* SimulationResult */ },
  "b": { /* SimulationResult */ },
  "recommendation": "A",
  "reason": "A scores 7.50 > B 5.20 (quality − cost − latency)"
}
```

## `GET /api/meta/governance/config`

Read the current governance config.

**Response**

```json
{
  "maxAgents": 20,
  "maxCapabilities": 30,
  "maxDepth": 4,
  "requireReviewForBirth": true,
  "minUsageForBirth": 0
}
```

## `PUT /api/meta/governance/config`

Update governance config (hot-reloadable).

**Request body** — same as `GET` response.

**Response**

```json
{ "ok": true, "config": { /* updated */ } }
```

## Error Format

All errors use the Hono default:

```json
{ "error": "bad_request", "issues": [...] }
```

Status codes:

- `400` — invalid request body (Zod validation failed)
- `404` — capability not found
- `500` — internal error (rare, mostly file-system)