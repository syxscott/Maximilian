# Phase 4 — Stage 5: Model Assignment

**日期**: 2026-06-22
**状态**: ✅ 完成

## 实现内容

- ModelAssigner 调用 EvolutionFacade.selectForRole
- 每个节点获得 (provider, model, reason, score)
- 落盘到 graph
- 提供 resolveProvider / buildAgentContexts 给工厂使用

## 测试结果

- vitest: 2 个测试，全部通过

## 代码统计

| 文件 | 行数 |
|---|---|
| `src/model-assigner.ts` | 80 |

## 遗留问题

- 节点 role 是 string，Evolution 那边只支持 enum 角色；通过 mapToEvolutionRole 桥接
- 角色映射时把 frontend→frontend、reviewer→review、其余→general，可能导致不同动态角色共享同一份 profile
