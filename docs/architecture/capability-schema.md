# Capability Schema

## 设计原则

能力是**第一公民**，角色是**能力的运行时实例**。
一个角色可以覆盖多个能力，一个能力可以由多个角色实现。

## 字段

```typescript
interface Capability {
  id: string;                          // "frontend", "database", "research_analysis"
  displayName: string;
  description: string;
  category: CapabilityCategory;
  keywords: string[];                  // 用于关键词匹配
  defaultGoal: string;                 // 蓝图生成时的默认目标
  promptTemplate: string;              // 系统提示模板（含占位符 {{userRequest}})
  defaultTools: string[];              // 默认工具列表
  defaultConstraints: AgentConstraints;
  dependsOn: string[];                 // 该能力通常依赖的其他能力
  tags: string[];                      // 搜索/过滤用
}

type CapabilityCategory =
  | "product"        // 产品设计
  | "frontend"       // 前端
  | "backend"        // 后端
  | "data"           // 数据库 / 数据工程
  | "devops"         // 部署 / 运维
  | "testing"        // 测试
  | "research"       // 科研
  | "writing"        // 写作
  | "review"         // 评审
  | "general";       // 通用
```

## 能力库（初始版本）

位于 `packages/dags/src/capability-library.ts`，以 JSON 形式内嵌：

| ID | displayName | category | 典型关键词 |
|---|---|---|---|
| `product_design` | Product Design | product | "产品", "PRD", "需求分析" |
| `frontend` | Frontend | frontend | "前端", "UI", "网页", "HTML", "React" |
| `backend` | Backend | backend | "后端", "API", "服务端", "Node.js" |
| `database` | Database | data | "数据库", "DB", "SQL", "存储" |
| `devops` | DevOps | devops | "部署", "CI", "Docker", "K8s" |
| `testing` | Testing | testing | "测试", "QA", "单元测试" |
| `research_analysis` | Research Analysis | research | "论文", "研究", "文献", "analysis" |
| `data_visualization` | Data Visualization | data | "图表", "可视化", "dashboard" |
| `writing` | Technical Writing | writing | "文档", "README", "API doc" |
| `review` | Code Review | review | "评审", "code review" |
| `general` | General | general | fallback |

## 扩展机制

- 新增能力：往 `CAPABILITY_LIBRARY` 数组追加一条
- 运行时注入：通过 `CapabilityLibrary.register(capability)` 动态添加
- 远程加载：未来可从外部 JSON 加载（不在本阶段范围）
