# ADR-012: Blueprint Persistence as JSON

**Status**: Accepted
**Date**: 2026-06-22

## Context

DAGS 生成的 Blueprint 描述了"系统应该有什么样的 Agent"。如果只存在于内存：

- 重启后丢失
- 无法被审计
- 无法支持 evolution 的版本链
- 团队结构无法复用

## Decision

所有 Blueprint 必须以 JSON 形式持久化到 `workspace/blueprints/<id>.json`。

- **Append-only**：旧版本不删除，仅标记 `retiredAt`
- **Version chain**：`parentId` 指向上一版本
- **Human-readable**：JSON 不做二进制序列化
- **复用现有 `FileWorkspaceStore` 模式**：但实现为独立的 `BlueprintStore`，避免修改现有模块

## Consequences

**正面**：
- 全部数据可审计
- Evolution 链路可追溯
- 故障后可重建

**负面**：
- 每次生成 Blueprint 都有磁盘 IO
- 大型团队下文件数量可能膨胀（不在本阶段范围）
