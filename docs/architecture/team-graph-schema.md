# Team Graph Data Structure

## TeamGraph

```typescript
interface TeamGraph {
  id: string;                          // "team-xxxxxxxx"
  userRequest: string;                 // 原始用户请求
  capabilities: string[];              // 能力 ID 列表
  nodes: TeamNode[];                   // 所有 Agent 节点
  edges: TeamEdge[];                   // 协作边
  layers: TeamLayer[];                 // 拓扑分层（并行识别用）
  createdAt: string;
  status: "draft" | "ready" | "executing" | "completed";
}

interface TeamNode {
  id: string;                          // 节点 ID
  blueprintId: string;                 // 关联的 Blueprint
  role: string;                        // 来自 Blueprint
  displayName: string;
  dependsOn: string[];                 // 节点 ID 列表
  modelAssignment?: {                  // 阶段 5 填充
    provider: string;
    model: string;
    reason: string;
    score: number;
  };
}

interface TeamEdge {
  from: string;                        // 源节点 ID
  to: string;                          // 目标节点 ID
  type: "data_flow" | "review" | "validation";
  description?: string;
}

interface TeamLayer {
  index: number;                       // 第几层（0=入口）
  nodeIds: string[];                   // 该层可并行执行的节点
}
```

## 构建算法

1. **入度计算**：对每个节点，统计 `dependsOn` 中依赖的节点数
2. **拓扑排序**：Kahn 算法
3. **循环检测**：拓扑排序结束时若有节点未访问 → 循环
4. **分层**：每完成一层入度归零的节点，新的一层从它们的下游开始
5. **并行识别**：同一层内的节点可并行执行

## 持久化

路径：`workspace/graphs/<teamId>.json`

复用现有 `FileWorkspaceStore` 模式（不修改其代码）。
