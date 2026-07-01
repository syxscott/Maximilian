/**
 * 5.6 — PromotionEngine
 *
 * Compares candidate executions vs current executions.
 * Decides PROMOTE / REJECT / SKIP.
 * Appends to promotion-history.json.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PromotionRecordSchema,
  DEFAULT_PROMOTION_CONFIG,
  type ExecutionRecord,
  type PromotionRecord,
  type CandidateVersion,
} from "./types.js";
import type { CandidateGenerator } from "./candidate-generator.js";

export interface PromotionConfig {
  minSample: number;
  minScoreGain: number;
  minAcceptanceGain: number;
}

export const DEFAULT_CONFIG: PromotionConfig = DEFAULT_PROMOTION_CONFIG;

export type PromotionVerdict = "promote" | "reject" | "skip";

export interface PromotionDecision {
  verdict: PromotionVerdict;
  record?: PromotionRecord;
  reason: string;
}

export class PromotionEngine {
  private history: PromotionRecord[] = [];

  constructor(
    private rootDir: string,
    private candidates: CandidateGenerator,
    private config: PromotionConfig = DEFAULT_CONFIG
  ) {}

  private historyFile(): string {
    return path.join(this.rootDir, "promotion-history.json");
  }

  async loadHistory(): Promise<PromotionRecord[]> {
    try {
      const raw = await fs.readFile(this.historyFile(), "utf-8");
      this.history = (JSON.parse(raw) as unknown[]).map((x) =>
        PromotionRecordSchema.parse(x)
      );
      return this.history;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.history = [];
        return this.history;
      }
      throw err;
    }
  }

  async appendHistory(record: PromotionRecord): Promise<void> {
    this.history.push(record);
    await fs.writeFile(
      this.historyFile(),
      JSON.stringify(this.history, null, 2),
      "utf-8"
    );
  }

  /**
   * Compare candidate against current.
   * `currentBlueprintId` identifies "the production" runs.
   * `candidateBlueprintId` identifies "the candidate" runs.
   */
  async decide(
    candidate: CandidateVersion,
    currentBlueprintId: string,
    allExecutions: ExecutionRecord[]
  ): Promise<PromotionDecision> {
    const currentRuns = allExecutions.filter(
      (e) => e.blueprintId === currentBlueprintId
    );
    const candidateRuns = allExecutions.filter(
      (e) => e.blueprintId === candidate.id
    );

    if (
      currentRuns.length < this.config.minSample ||
      candidateRuns.length < this.config.minSample
    ) {
      return {
        verdict: "skip",
        reason: `Insufficient samples: current=${currentRuns.length}, candidate=${candidateRuns.length}, need=${this.config.minSample}`,
      };
    }

    const oldScore = mean(currentRuns.map((e) => e.review?.score).filter(isNum));
    const newScore = mean(candidateRuns.map((e) => e.review?.score).filter(isNum));
    const oldAccept = acceptanceRate(currentRuns);
    const newAccept = acceptanceRate(candidateRuns);

    const scoreGain = oldScore > 0 ? (newScore - oldScore) / oldScore : 0;
    const acceptGain = oldAccept > 0 ? (newAccept - oldAccept) / oldAccept : (newAccept > 0 ? 1 : 0);

    const passesScore = scoreGain >= this.config.minScoreGain;
    const passesAccept = acceptGain >= this.config.minAcceptanceGain;

    const baseRecord = {
      id: `promo-${randomUUID()}`,
      role: candidate.agentRole,
      fromVersion: candidate.parentVersion,
      toVersion: candidate.version,
      sampleSize: Math.min(currentRuns.length, candidateRuns.length),
      oldAvgScore: oldScore,
      newAvgScore: newScore,
      scoreGain,
      oldAcceptance: oldAccept,
      newAcceptance: newAccept,
      acceptanceGain: acceptGain,
      promotedAt: new Date().toISOString(),
      rule: {
        minSample: this.config.minSample,
        minScoreGain: this.config.minScoreGain,
        minAcceptanceGain: this.config.minAcceptanceGain,
      },
    };

    if (passesScore && passesAccept) {
      const record = PromotionRecordSchema.parse({
        ...baseRecord,
        reason: `Promoted: scoreGain=${(scoreGain * 100).toFixed(1)}%, acceptGain=${(acceptGain * 100).toFixed(1)}%`,
      });
      await this.appendHistory(record);
      await this.candidates.setStatus(candidate.id, "promoted");
      return { verdict: "promote", record, reason: record.reason };
    }

    const reasonParts: string[] = [];
    if (!passesScore) reasonParts.push(`score gain ${(scoreGain * 100).toFixed(1)}% < ${this.config.minScoreGain * 100}%`);
    if (!passesAccept) reasonParts.push(`acceptance gain ${(acceptGain * 100).toFixed(1)}% < ${this.config.minAcceptanceGain * 100}%`);
    const reason = `Rejected: ${reasonParts.join("; ")}`;

    const record = PromotionRecordSchema.parse({
      ...baseRecord,
      reason,
    });
    await this.appendHistory(record);
    await this.candidates.setStatus(candidate.id, "rejected");
    return { verdict: "reject", record, reason };
  }
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function acceptanceRate(records: ExecutionRecord[]): number {
  if (records.length === 0) return 0;
  const accepted = records.filter((r) => r.userFeedback.length > 0).length;
  return accepted / records.length;
}
