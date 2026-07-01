# Phase 8 — 任务 4: Safe Rollout (shadow / canary / full)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/safe-rollout.ts` | **新文件** — `SafeRollout` 类 + `RolloutApplyInput` + `RolloutResult` |
| `packages/meta-system/src/types.ts` | `RolloutModeSchema`(shadow/canary/full) + `ROLLOUT_CONFIG`(defaultMode="shadow", canaryFraction=0.1) |
| `packages/meta-system/src/index.ts` | 导出 `SafeRollout`, `RolloutApplyInput`, `RolloutResult` |

## 三种模式

| 模式 | 行为 |
|------|------|
| `shadow` | **永远不 apply**,只记录(默认模式,ROLLOUT_CONFIG.defaultMode) |
| `canary` | 仅当 `hash(canaryKey) < 0.1` 时 apply,10% 流量 |
| `full` | 总是 apply |

## SafeRollout.apply()

```typescript
async apply(input: RolloutApplyInput): Promise<RolloutResult> {
  if (mode === "shadow") return { applied: false, reason: "shadow mode: simulation only" };
  if (mode === "canary") {
    const inCanary = hashFraction(input.canaryKey) < 0.1;
    if (!inCanary) return { applied: false, reason: "canary: hash ≥ 0.1, skipped" };
  }
  await input.applyMutation();
  await input.record(proposal, mode, true);
  return { applied: true, reason: `${mode} rollout: applied` };
}
```

## 测试

5 个 SafeRollout 测试:
- 默认 mode 是 shadow
- shadow 永不 apply
- full 总是 apply
- canary 部分 apply
- canaryKey 哈希决定
- setMode 切换

总测试: 91 → 96 (Phase 8 单元)
## API 接入

```bash
DIGITAL_TWIN_ENABLED=true SAFE_ROLLOUT_MODE=canary pnpm dev
```

模式可热切换: `rollout.setMode("full")`