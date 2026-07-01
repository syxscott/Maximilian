/**
 * 6.7 — OrganizationMemory
 *
 * Append-only log of all meta-system events:
 *   - capability_proposed / promoted / deprecated / retired
 *   - agent_born / retired / merged / split
 *   - team_optimized
 *   - governance_violation
 *
 * Persists to <rootDir>/org-events/<id>.json
 * Provides a timeline query for re-building organization evolution.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  OrganizationEventSchema,
  type OrganizationEvent,
  type OrgEventType,
} from "./types.js";

export class OrganizationMemory {
  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "org-events");
  }

  async record(
    type: OrgEventType,
    subject: string,
    payload: Record<string, unknown> = {}
  ): Promise<OrganizationEvent> {
    const event: OrganizationEvent = OrganizationEventSchema.parse({
      id: `evt-${randomUUID().slice(0, 8)}`,
      type,
      subject,
      payload,
      at: new Date().toISOString(),
    });
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(
      path.join(this.dir(), `${event.id}.json`),
      JSON.stringify(event, null, 2),
      "utf-8"
    );
    return event;
  }

  async listAll(): Promise<OrganizationEvent[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const out: OrganizationEvent[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8");
        out.push(OrganizationEventSchema.parse(JSON.parse(raw)));
      }
      out.sort((a, b) => a.at.localeCompare(b.at));
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async timeline(subject?: string): Promise<OrganizationEvent[]> {
    const all = await this.listAll();
    return subject ? all.filter((e) => e.subject === subject) : all;
  }

  async countByType(): Promise<Record<OrgEventType, number>> {
    const all = await this.listAll();
    const out = {} as Record<OrgEventType, number>;
    for (const e of all) {
      out[e.type] = (out[e.type] ?? 0) + 1;
    }
    return out;
  }
}
