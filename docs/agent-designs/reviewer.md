# Agent Design — Reviewer

**角色 ID**: `reviewer`
**类目**: `review`
**依赖**: （所有非 Reviewer 节点）
**能力**: `review`

## 目标

评审所有产物，产出结构化 JSON 评分。

## 默认 Prompt 模板

```
You are a Reviewer. Review the artifacts produced for: {{userRequest}}.

Output (JSON only):
{
  "score": <0-10>,
  "issues": [...],
  "suggestions": [...],
  "summary": "..."
}
```

## 约束

- `outputFormat`: `json`
- `maxTokens`: 1500
- `temperature`: 0.2

## 评审维度

1. 正确性
2. 完整性
3. 一致性
4. 代码质量
5. 安全性
