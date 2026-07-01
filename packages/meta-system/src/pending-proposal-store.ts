/**
 * Phase 11 — PendingProposalStore.
 *
 * File-backed store for proposals gated by HITL (Human-In-The-Loop).
 * Each pending proposal is persisted as a JSON file under
 * `<rootDir>/pending-proposals/<proposalId>.json`.
 *
 * Follows the same filesystem pattern as OrganizationMemory and CapabilityRegistry.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  PendingProposalSchema,
  type PendingProposal,
  type Proposal,
  type SimulationDelta,
  type DecisionScore,
} from "./types.js";

export class PendingProposalStore {
  constructor(private rootDir: string) {}

  private dir(): string {
    return join(this.rootDir, "pending-proposals");
  }

  private filePath(proposalId: string): string {
    return join(this.dir(), `${proposalId}.json`);
  }

  async save(input: {
    proposal: Proposal;
    simulation: SimulationDelta;
    score: DecisionScore;
    snapshotId?: string;
  }): Promise<PendingProposal> {
    await fs.mkdir(this.dir(), { recursive: true });

    const pending = PendingProposalSchema.parse({
      proposalId: input.proposal.id,
      proposal: input.proposal,
      simulation: input.simulation,
      score: input.score,
      snapshotId: input.snapshotId,
      status: "pending_human",
      requestedAt: new Date().toISOString(),
    });

    await fs.writeFile(
      this.filePath(input.proposal.id),
      JSON.stringify(pending, null, 2),
      "utf-8"
    );

    return pending;
  }

  async get(proposalId: string): Promise<PendingProposal | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(proposalId), "utf-8");
      return PendingProposalSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async listPending(): Promise<PendingProposal[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const results: PendingProposal[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(join(this.dir(), entry), "utf-8");
          const parsed = PendingProposalSchema.parse(JSON.parse(raw));
          if (parsed.status === "pending_human") {
            results.push(parsed);
          }
        } catch {
          // Skip malformed files.
        }
      }
      return results;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async resolve(
    proposalId: string,
    action: "approved" | "rejected",
    resolvedBy: string,
    reason: string
  ): Promise<PendingProposal> {
    const existing = await this.get(proposalId);
    if (!existing) {
      throw new Error(`Pending proposal ${proposalId} not found`);
    }
    if (existing.status !== "pending_human") {
      throw new Error(`Pending proposal ${proposalId} already resolved as ${existing.status}`);
    }

    const resolved: PendingProposal = {
      ...existing,
      status: action,
      resolvedAt: new Date().toISOString(),
      resolvedBy,
      resolutionReason: reason,
    };

    await fs.writeFile(
      this.filePath(proposalId),
      JSON.stringify(resolved, null, 2),
      "utf-8"
    );

    return resolved;
  }
}
