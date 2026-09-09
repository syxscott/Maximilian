import { eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { truthMeasurements, truthVerifications } from "../schema.js";

/**
 * PostgreSQL-backed persistence for TruthAudit measurements and
 * verifications. Replaces the in-memory store in @max/meta-system
 * when running with `DATABASE_URL` set.
 *
 * The shape matches the types in @max/meta-system/src/types.ts:
 *   TruthMeasurement, TruthVerification.
 *
 * This is a wiring layer, not a new abstraction — the meta-system
 * TruthAudit keeps the same interface; we just hand it a `getMeasurements`
 * function that reads from Postgres.
 */

export interface TruthMeasurementRow {
  id: string;
  proposalId: string;
  action: string;
  predicted: {
    costDelta: number;
    latencyDeltaMs: number;
    qualityDelta: number;
    riskDelta: number;
  };
  actual: {
    costDelta: number;
    latencyDeltaMs: number;
    qualityDelta: number;
    riskDelta: number;
  };
  sampleSize: number;
  recordedAt: string;
}

export interface TruthVerificationRow {
  id: string;
  proposalId: string;
  verdict: string;
  totalSamples: number;
  meanPredicted: TruthMeasurementRow["predicted"];
  meanActual: TruthMeasurementRow["actual"];
  calibrationError: number;
  generatedAt: string;
}

function rowToMeasurement(row: typeof truthMeasurements.$inferSelect): TruthMeasurementRow {
  return {
    id: row.id,
    proposalId: row.proposalId,
    action: row.action,
    predicted: row.predicted as TruthMeasurementRow["predicted"],
    actual: row.actual as TruthMeasurementRow["actual"],
    sampleSize: row.sampleSize,
    recordedAt: row.recordedAt,
  };
}

function rowToVerification(row: typeof truthVerifications.$inferSelect): TruthVerificationRow {
  return {
    id: row.id,
    proposalId: row.proposalId,
    verdict: row.verdict,
    totalSamples: row.totalSamples,
    meanPredicted: row.meanPredicted as TruthMeasurementRow["predicted"],
    meanActual: row.meanActual as TruthMeasurementRow["actual"],
    calibrationError: row.calibrationError,
    generatedAt: row.generatedAt,
  };
}

export class PgTruthStore {
  constructor(private db: PostgresJsDatabase) {}

  async saveMeasurement(m: TruthMeasurementRow): Promise<void> {
    await this.db
      .insert(truthMeasurements)
      .values({
        id: m.id,
        proposalId: m.proposalId,
        action: m.action,
        predicted: m.predicted,
        actual: m.actual,
        sampleSize: m.sampleSize,
        recordedAt: m.recordedAt,
      })
      .onConflictDoUpdate({
        target: truthMeasurements.id,
        set: {
          actual: m.actual,
          sampleSize: m.sampleSize,
        },
      });
  }

  async listMeasurements(proposalId?: string): Promise<TruthMeasurementRow[]> {
    const query = this.db
      .select()
      .from(truthMeasurements)
      .orderBy(desc(truthMeasurements.recordedAt));
    const rows = proposalId
      ? await query.where(eq(truthMeasurements.proposalId, proposalId))
      : await query;
    return rows.map(rowToMeasurement);
  }

  async listAllMeasurements(): Promise<TruthMeasurementRow[]> {
    const rows = await this.db
      .select()
      .from(truthMeasurements)
      .orderBy(desc(truthMeasurements.recordedAt));
    return rows.map(rowToMeasurement);
  }

  async saveVerification(v: TruthVerificationRow): Promise<void> {
    await this.db
      .insert(truthVerifications)
      .values({
        id: v.id,
        proposalId: v.proposalId,
        verdict: v.verdict,
        totalSamples: v.totalSamples,
        meanPredicted: v.meanPredicted,
        meanActual: v.meanActual,
        calibrationError: v.calibrationError,
        generatedAt: v.generatedAt,
      })
      .onConflictDoUpdate({
        target: truthVerifications.id,
        set: {
          verdict: v.verdict,
          totalSamples: v.totalSamples,
          meanPredicted: v.meanPredicted,
          meanActual: v.meanActual,
          calibrationError: v.calibrationError,
          generatedAt: v.generatedAt,
        },
      });
  }

  async listVerifications(proposalId?: string): Promise<TruthVerificationRow[]> {
    const query = this.db
      .select()
      .from(truthVerifications)
      .orderBy(desc(truthVerifications.generatedAt));
    const rows = proposalId
      ? await query.where(eq(truthVerifications.proposalId, proposalId))
      : await query;
    return rows.map(rowToVerification);
  }

  async getLatestVerification(proposalId: string): Promise<TruthVerificationRow | undefined> {
    const rows = await this.listVerifications(proposalId);
    return rows[0];
  }

  async deleteMeasurementsForProposal(proposalId: string): Promise<number> {
    const result = await this.db
      .delete(truthMeasurements)
      .where(eq(truthMeasurements.proposalId, proposalId));
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  }
}