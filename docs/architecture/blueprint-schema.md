# AgentBlueprint Schema

## 字段

```typescript
interface AgentBlueprint {
  id: string;                          // "bp-frontend-001"
  role: string;                        // 逻辑角色名
  displayName: string;
  goal: string;                        // 一句话目标
  systemPrompt: string;                // LLM 实际看到的系统提示
  capabilities: string[];              // 该 Agent 覆盖的能力
  tools: ToolSpec[];                   // 可用工具描述
  preferredModels: ModelHint[];        // 偏好模型（按优先级）
  constraints: AgentConstraints;       // 输出约束
  version: string;                     // "v1", "v2"
  parentId?: string;                   // 父 Blueprint（用于版本链）
  createdAt: string;
  updatedAt: string;
  stats: BlueprintStats;               // 累计使用统计
  metadata: Record<string, unknown>;
}

interface ToolSpec {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // JSON Schema
}

interface ModelHint {
  provider: string;
  model: string;
  reason: string;                      // 为什么推荐此模型
}

interface AgentConstraints {
  outputFormat: "code" | "json" | "markdown" | "free";
  maxTokens?: number;
  temperature?: number;
  mustIncludeCodeBlocks?: boolean;
}

interface BlueprintStats {
  totalTasks: number;
  totalSuccesses: number;
  avgScore: number;
  avgExecutionTimeMs: number;
  lastUsedAt?: string;
}
```

## 持久化

路径：`workspace/blueprints/<id>.json`

## 版本化

- `parentId` 指向上一版本 → 形成版本链
- `version: "v1" | "v2" | ...`
- 已废弃版本保留在磁盘，stats 不再更新
- `EvolutionEngine` 在蓝本级别演进（区别于角色级）
