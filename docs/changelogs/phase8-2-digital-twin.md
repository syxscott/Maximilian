# Phase 8 — 任务 2: Digital Twin (OrganizationSnapshot)

**Date**: 2026-06-22
**Status**: ✅ Completed

## 修改文件

| 文件 | 修改 |
|------|------|
| `packages/meta-system/src/types.ts` | 新增 `OrganizationSnapshotSchema`(id/capturedAt/capabilities/blueprints/graphs/leaderboards) |
| `packages/meta-system/src/digital-twin.ts` | **新文件** — `DigitalTwin.capture()` + `DigitalTwin.apply()` + `snapshotToSimulationInput()` |
| `packages/meta-system/src/index.ts` | 导出 `DigitalTwin`, `snapshotToSimulationInput`, `CaptureInput`, `TwinProposal` |

## Digital Twin 设计

```typescript
class DigitalTwin {
  // 捕获当前组织状态(只读副本)
  static capture(input: CaptureInput): OrganizationSnapshot;

  // 在副本上模拟 mutation,返回新 snapshot(原 snapshot 不变)
  static apply(snap: OrganizationSnapshot, proposal: TwinProposal): OrganizationSnapshot;
}
```

支持的 proposal kind: `birth` / `retire` / `promote` / `demote` / `merge` / `split` / `rebalance_team`。

每次 `apply()` 都克隆一个新 snapshot,**原 snapshot 永不被修改**。

`snapshotToSimulationInput(snap, orgName)` 把 snapshot 转成 `SimulationInput`,作为 `SimulationEngine.simulate()` 的输入。

## 测试

7 个 DigitalTwin 测试:
- capture: 快照包含 capabilities/blueprints/graphs/leaderboards
- apply(birth): 加 capability + blueprint
- apply(retire): capability 标 retired + blueprint 设 retiredAt
- apply(promote): experimental/active 状态切换
- apply(merge): subject 角色退休,target 保留
- apply(split): subject 退休 + target 新增
- snapshotToSimulationInput: 转换为 SimulationInput

总测试: 77 → 84 (Phase 8 单元)
## 关键约束

- OrganizationSnapshot 不写入磁盘 — 内存副本,生命周期一次 cycle
- 模拟和真实 mutation 解耦 — pipeline 跑通才进 rollout
- 原始 snapshot 始终不可变