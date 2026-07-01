/**
 * 5.7 — LearningAPI
 *
 * Read-only query surface for the Learning Dashboard.
 * Aggregates from ExecutionStore, InsightsStore, CandidateGenerator,
 * PromotionEngine, EvolutionPlanner.
 */

import type { ExecutionStore } from "./execution-store.js";
import type { InsightsStore, FailurePatternAnalyzer } from "./insights-store.js";
import type { CandidateGenerator } from "./candidate-generator.js";
import type { PromotionEngine } from "./promotion-engine.js";
import type { EvolutionPlanner } from "./evolution-planner.js";

export interface LearningStatus {
  generatedAt: string;
  totalExecutions: number;
  totalCandidates: number;
  totalPromotions: number;
  totalRejections: number;
  activeInsights: number;
  roles: Array<{
    role: string;
    executions: number;
    avgScore: number;
    acceptance: number;
  }>;
}

export class LearningAPI {
  constructor(
    private executions: ExecutionStore,
    private insightsStore: InsightsStore,
    private failureAnalyzer: FailurePatternAnalyzer,
    private candidates: CandidateGenerator,
    private promotion: PromotionEngine,
    private planner: EvolutionPlanner
  ) {}

  async status(): Promise<LearningStatus> {
    const execs = await this.executions.listAll();
    const allCandidates = await this.candidates.listAll();
    const history = await this.promotion.loadHistory();
    const insights = await this.insightsStore.loadPatterns();
    const plans = await this.planner.listPlans();

    const byRole = new Map<string, { scores: number[]; accepts: number; total: number }>();
    for (const e of execs) {
      const cur = byRole.get(e.agentRole) ?? { scores: [], accepts: 0, total: 0 };
      cur.total += 1;
      if (e.review) cur.scores.push(e.review.score);
      if (e.userFeedback.length > 0) cur.accepts += 1;
      byRole.set(e.agentRole, cur);
    }

    return {
      generatedAt: new Date().toISOString(),
      totalExecutions: execs.length,
      totalCandidates: allCandidates.length,
      totalPromotions: history.filter((h) => h.reason.startsWith("Promoted")).length,
      totalRejections: history.filter((h) => h.reason.startsWith("Rejected")).length,
      activeInsights: insights.length,
      roles: Array.from(byRole.entries()).map(([role, agg]) => ({
        role,
        executions: agg.total,
        avgScore:
          agg.scores.length > 0
            ? agg.scores.reduce((a, s) => a + s, 0) / agg.scores.length
            : 0,
        acceptance: agg.total > 0 ? agg.accepts / agg.total : 0,
      })),
    };
  }

  async evolutionHistory() {
    const history = await this.promotion.loadHistory();
    const plans = await this.planner.listPlans();
    const candidates = await this.candidates.listAll();
    return {
      promotions: history,
      plans,
      candidates,
    };
  }

  async failurePatterns() {
    return this.insightsStore.loadPatterns();
  }

  async agents() {
    const execs = await this.executions.listAll();
    const byRole = new Map<string, { executions: number; scored: number; accepts: number; totalScore: number; lastRun?: string }>();
    for (const e of execs) {
      const cur = byRole.get(e.agentRole) ?? { executions: 0, scored: 0, accepts: 0, totalScore: 0 };
      cur.executions += 1;
      if (e.review) {
        cur.scored += 1;
        cur.totalScore += e.review.score;
      }
      if (e.userFeedback.length > 0) cur.accepts += 1;
      if (!cur.lastRun || e.startedAt > cur.lastRun) cur.lastRun = e.startedAt;
      byRole.set(e.agentRole, cur);
    }
    return Array.from(byRole.entries()).map(([role, agg]) => ({
      role,
      executions: agg.executions,
      avgScore: agg.scored > 0 ? agg.totalScore / agg.scored : 0,
      acceptance: agg.executions > 0 ? agg.accepts / agg.executions : 0,
      lastRun: agg.lastRun,
    }));
  }

  // expose the failureAnalyzer for on-demand mining
  getFailureAnalyzer(): FailurePatternAnalyzer {
    return this.failureAnalyzer;
  }
}
