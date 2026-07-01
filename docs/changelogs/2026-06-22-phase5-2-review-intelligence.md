# Changelog — 2026-06-22 (Phase 5.2：Review Intelligence)

## 完成内容

升级 Review 输出为结构化 JSON（`StructuredReview`）：

```json
{
  "score": 0-10,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "failurePatterns": ["truncation", "no_code_blocks"],
  "improvementSuggestions": ["..."],
  "summary": "..."
}
```

实现 `ReviewIntelligence`：
- **Live 模式**：调用 LLM provider，jsonMode=true，prompt 强制结构化输出
- **Heuristic 模式**：基于关键字的 fallback（短输出 → truncation、无 fenced code → no_code_blocks、代码块 → +strength）

存储：`<rootDir>/reviews/<reviewId>.json`

## 修改文件

无

## 新增文件

- `packages/autonomy/src/review-intelligence.ts` — `ReviewIntelligence` 类
- `packages/autonomy/src/index.ts` — 导出
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.2 单元测试（4 个）

## 删除文件

无
