# Phase 5 — Data Flow

```mermaid
flowchart TB
  subgraph Input
    A[User Request]
    FB[User Feedback]
  end

  subgraph "Stage 5.1 - Capture"
    A --> EX[ExecutionStore.save]
    EX --> EXF[(executions/id.json)]
  end

  subgraph "Stage 5.2 - Review"
    EX --> RI[ReviewIntelligence]
    RI --> RVF[(reviews/taskId.json)]
  end

  subgraph "Stage 5.3 - Mine"
    EX --> FP[FailurePatternAnalyzer]
    FP --> IPF[(insights/failure-patterns.json)]
    FP --> LBI[(insights/leaderboard-insights.json)]
  end

  subgraph "Stage 5.4 - Plan"
    RVF --> EP[EvolutionPlanner]
    FP --> EP
    FB --> EP
    EP --> EPF[(evolution-plans/id.json)]
  end

  subgraph "Stage 5.5 - Generate"
    EP --> CG[CandidateGenerator]
    CG --> CDF[(candidates/role-vN.json)]
  end

  subgraph "Stage 5.6 - Promote"
    CDF --> PE[PromotionEngine]
    EX --> PE
    PE --> PHF[(promotion-history.json)]
  end

  subgraph "Stage 5.7 - Query"
    EXF --> LD[LearningAPI]
    CDF --> LD
    PHF --> LD
    LD --> JSON[/api/learning/*]
  end

  subgraph "Stage 5.8 - Take Over"
    ENV{DAGS_MODE=true?}
    ENV -->|yes| DC[DAGS.compose]
    DC --> RT[Runtime]
    RT --> EX
  end
```

## 数据契约

| 数据 | 生产者 | 消费者 |
|---|---|---|
| `ExecutionRecord` | ExecutionStore.save | FailurePatternAnalyzer, PromotionEngine, LearningAPI |
| `StructuredReview` | ReviewIntelligence | EvolutionPlanner, FailurePatternAnalyzer |
| `FailureInsight` | FailurePatternAnalyzer | EvolutionPlanner, LearningAPI |
| `EvolutionPlan` | EvolutionPlanner | CandidateGenerator, LearningAPI |
| `CandidateVersion` | CandidateGenerator | PromotionEngine, LearningAPI |
| `PromotionRecord` | PromotionEngine | LearningAPI |
