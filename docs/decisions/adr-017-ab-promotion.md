# ADR-017: A/B Promotion Requires Two Thresholds

**Status**: Accepted
**Date**: 2026-06-22
**Phase**: 5

## Context

Phase 3 的 EvolutionEngine 只有一个 margin（0.5）作为晋升门槛。Phase 5 需要更严格的规则，避免：
- 候选版本在样本噪声下偶然胜出
- 只看 score 不看 user acceptance

## Decision

PromotionEngine 决策需要同时满足：
- `MIN_SAMPLE = 20`（每边至少 20 个执行）
- `scoreGain ≥ 0.10`（score 提升 ≥ 10%）
- `acceptGain ≥ 0.15`（acceptance 提升 ≥ 15%）

任一不满足 → REJECT，记录到 promotion-history.json（连同 reason）。

## Consequences

**正面**：
- 噪声更难影响晋升
- 同时关注质量与用户满意度

**负面**：
- 进化更慢（更慢触发晋升）
- 在低流量场景下永远达不到 MIN_SAMPLE（缓解：可降级到 score-only）
