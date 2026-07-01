# Phase 5 — Algorithms

## FailurePatternAnalyzer

```text
ANALYZE(executions, lookback = 50):
  patterns = groupBy(executions, e =>
    e.review.failurePatterns || []
  )
  insights = []
  for (key, group) in patterns:
    insight = {
      pattern: key,
      frequency: group.length,
      agentRoles: distinct(group, e => e.agentRole),
      providers: distinct(group, e => e.modelAssignment.provider),
      examples: take(group, 3)
    }
    insights.push(insight)
  return sortBy(insights, i => -i.frequency)
```

## EvolutionPlanner

```text
PLAN(role, executions, reviews, insights):
  if count(executions for role) < MIN_SAMPLES: return null
  avgScore = mean(executions.score)
  acceptance = mean(executions.userAccepted || false)
  if avgScore >= SCORE_THRESHOLD && acceptance >= ACCEPTANCE_THRESHOLD:
    return null  # no need to evolve
  changes = proposeChanges(role, top(insights, 3))
  return {
    fromVersion: currentBlueprint.version,
    toVersion: nextVersion(),
    changes,
    expectedImprovement: { score: 1.0, acceptance: 0.1 }
  }
```

## CandidateGenerator

```text
GENERATE(plan, blueprint):
  newPrompt = applyChanges(blueprint.systemPrompt, plan.changes)
  candidate = clone(blueprint)
  candidate.id = `bp-${role}-v${N+1}`
  candidate.version = `v${N+1}`
  candidate.parentId = blueprint.id
  candidate.systemPrompt = newPrompt
  candidate.generationReason = plan.changes.map(c => c.reason)
  save(candidate)
  return candidate
```

## PromotionEngine

```text
DECIDE(role, candidate, executions, lookback = 30):
  oldRuns = filter(executions, e => e.blueprintId == currentBlueprint.id)
  newRuns = filter(executions, e => e.blueprintId == candidate.id)
  if min(len(oldRuns), len(newRuns)) < MIN_SAMPLE: return SKIP
  oldScore = mean(oldRuns.score)
  newScore = mean(newRuns.score)
  oldAccept = mean(oldRuns.userAccepted)
  newAccept = mean(newRuns.userAccepted)
  scoreGain = (newScore - oldScore) / oldScore
  acceptGain = (newAccept - oldAccept) / max(oldAccept, 0.01)
  if scoreGain >= 0.10 AND acceptGain >= 0.15:
    return PROMOTE
  else:
    return REJECT
```

默认阈值（可在配置中覆盖）：
- `MIN_SAMPLE = 20`
- `SCORE_GAIN = 0.10` (10%)
- `ACCEPT_GAIN = 0.15` (15%)
