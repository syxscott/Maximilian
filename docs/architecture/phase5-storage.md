# Phase 5 — Storage Layout

```
<workspace-root>/
├── executions/                    # NEW (5.1) per-task complete records
│   └── <executionId>.json
├── reviews/                       # NEW (5.2) structured review artifacts
│   └── <taskId>.json
├── insights/                      # NEW (5.3) failure pattern mining
│   ├── failure-patterns.json
│   └── leaderboard-insights.json
├── evolution-plans/               # NEW (5.4)
│   └── <planId>.json
├── candidates/                    # NEW (5.5) generated candidates
│   ├── frontend-v2.json
│   ├── backend-v2.json
│   └── ...
├── promotion-history.json         # NEW (5.6) append-only
│
├── blueprints/                    # Phase 4
├── graphs/                        # Phase 4
├── metrics/                       # Phase 3
├── agents/                        # Phase 3
├── agent-versions/                # Phase 3
└── workspaces/                    # Phase 2
```

## 文件格式

### `executions/<id>.json`

```json
{
  "id": "exec-xxxxxxxx",
  "taskId": "task-1",
  "workspaceId": "ws-xxx",
  "blueprintId": "bp-frontend-xxx",
  "graphId": "team-xxx",
  "modelAssignment": { "provider": "openai", "model": "gpt-4o" },
  "artifacts": ["frontend-html-xxx.html"],
  "review": {
    "score": 7,
    "strengths": ["clear structure"],
    "weaknesses": ["missing tests"],
    "failurePatterns": ["no error handling"],
    "improvementSuggestions": ["add try/catch"]
  },
  "userFeedback": [],
  "startedAt": "...",
  "completedAt": "...",
  "durationMs": 1234
}
```

### `evolution-plans/<id>.json`

```json
{
  "id": "plan-xxxxxxxx",
  "agentRole": "frontend",
  "fromVersion": "v1",
  "toVersion": "v2",
  "changes": [
    { "type": "systemPrompt", "from": "...", "to": "...", "reason": "..." }
  ],
  "expectedImprovement": { "score": 1.5, "acceptance": 0.1 },
  "basedOn": {
    "metricCount": 30,
    "avgScore": 4.5,
    "topFailurePatterns": ["..."]
  },
  "createdAt": "..."
}
```

### `promotion-history.json`

Append-only array of:
```json
{
  "id": "promo-xxx",
  "role": "frontend",
  "fromVersion": "v1",
  "toVersion": "v2",
  "sampleSize": 22,
  "oldAvgScore": 5.5,
  "newAvgScore": 7.5,
  "scoreImprovement": 0.36,
  "oldAcceptance": 0.4,
  "newAcceptance": 0.65,
  "acceptanceImprovement": 0.625,
  "promotedAt": "...",
  "reason": "..."
}
```
