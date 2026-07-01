# ADR-016: Structured Review Output

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 5

## Context

Phase 3 的 Review Agent 只输出 `{score, issues, suggestions, summary}`。要让 Planner 自动决定"改什么"，需要更结构化的信号：
- 优势（strengths）→ 保留
- 弱点（weaknesses）→ 修复
- 失败模式（failure_patterns）→ 触发进化
- 改进建议（improvement_suggestions）→ 写入 prompt

## Decision

Review Agent 升级为 `ReviewIntelligence`，输出：
```json
{
  "score": 0-10,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "failurePatterns": ["..."],
  "improvementSuggestions": ["..."],
  "summary": "..."
}
```

- 使用 JSON Schema 严格校验
- 字段缺失时回退空数组，不抛错
- 保存到 `workspace/reviews/<taskId>.json`

## Consequences

**正面**：
- Planner 可机械消费
- FailurePatternAnalyzer 可聚合 failure_patterns

**负面**：
- LLM 输出格式需 prompt 强化（可能用示例 few-shot）
- 老 Review 不向后兼容（v1 schema 与 v2 schema 共存）
