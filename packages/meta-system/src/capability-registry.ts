/**
 * 6.2 — CapabilityRegistry
 *
 * Manages the lifecycle of a capability:
 *   proposed → experimental → active → deprecated → retired
 *
 * Persists to <rootDir>/capability-registry/<id>.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CapabilityRecordSchema,
  type CapabilityRecord,
  type CapabilityStatus,
} from "./types.js";

const VALID_TRANSITIONS: Record<CapabilityStatus, CapabilityStatus[]> = {
  proposed: ["experimental", "active", "retired"],
  experimental: ["active", "deprecated", "retired"],
  active: ["deprecated", "retired"],
  deprecated: ["retired", "active"],
  retired: [],
};

export class CapabilityRegistry {
  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "capability-registry");
  }

  private file(id: string): string {
    return path.join(this.dir(), `${id}.json`);
  }

  async propose(input: {
    capabilityId: string;
    displayName: string;
    description?: string;
    proposalId?: string;
  }): Promise<CapabilityRecord> {
    const existing = await this.get(input.capabilityId);
    if (existing) {
      throw new Error(`Capability ${input.capabilityId} already exists in status ${existing.status}`);
    }
    const now = new Date().toISOString();
    const record: CapabilityRecord = CapabilityRecordSchema.parse({
      id: input.capabilityId,
      displayName: input.displayName,
      description: input.description ?? "",
      status: "proposed",
      proposalId: input.proposalId,
      createdAt: now,
      updatedAt: now,
    });
    await this.save(record);
    return record;
  }

  async transition(
    id: string,
    to: CapabilityStatus
  ): Promise<CapabilityRecord> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Capability ${id} not found`);
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed.includes(to)) {
      throw new Error(
        `Illegal transition: ${existing.status} → ${to} (allowed: ${allowed.join(", ") || "none"})`
      );
    }
    const now = new Date().toISOString();
    const updated: CapabilityRecord = CapabilityRecordSchema.parse({
      ...existing,
      status: to,
      promotedAt: to === "active" ? now : existing.promotedAt,
      retiredAt: to === "retired" ? now : existing.retiredAt,
      updatedAt: now,
    });
    await this.save(updated);
    return updated;
  }

  async get(id: string): Promise<CapabilityRecord | undefined> {
    try {
      const raw = await fs.readFile(this.file(id), "utf-8");
      return CapabilityRecordSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async listAll(): Promise<CapabilityRecord[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const out: CapabilityRecord[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8");
        out.push(CapabilityRecordSchema.parse(JSON.parse(raw)));
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async listByStatus(status: CapabilityStatus): Promise<CapabilityRecord[]> {
    const all = await this.listAll();
    return all.filter((c) => c.status === status);
  }

  private async save(record: CapabilityRecord): Promise<void> {
    const validated = CapabilityRecordSchema.parse(record);
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(this.file(validated.id), JSON.stringify(validated, null, 2), "utf-8");
  }
}
