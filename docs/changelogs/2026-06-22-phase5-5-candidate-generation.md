# Changelog — 2026-06-22 (Phase 5.5：Candidate Generation)

## 完成内容

实现 `CandidateGenerator.generate(plan, parentBlueprint)`：
- 复制 parent blueprint，更新 id 为 `bp-{role}-v{N}-{rand}`、version 来自 plan
- 把 plan.changes 合并到 systemPrompt
- 记录 `parentBlueprintId` / `parentVersion` / `planId` / `generationReason`
- 初始 stats 为空、status = `candidate`

存储：`<rootDir>/agent-versions/<candidateId>.json`

## 修改文件

无

## 新增文件

- `packages/autonomy/src/candidate-generator.ts` — `CandidateGenerator`
- `packages/autonomy/src/types.ts` — `CandidateVersionSchema`
- `packages/autonomy/test/autonomy-unit.test.ts` — 5.5 单元测试（2 个）

## 删除文件

无
