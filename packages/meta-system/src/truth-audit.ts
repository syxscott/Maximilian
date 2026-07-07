/**
 * Phase 8.7 — TruthAudit (runtime prediction-vs-reality verification).
 *
 * Maximilian's meta-system produces a lot of *predictions*:
 *   - SimulationEngine predicts cost/latency/quality/risk deltas
 *   - ReplayEngine predicts historical quality delta
 *   - ProposalPipeline scores utility = qualityGain − costPenalty − ...
 *   - GovernanceEngine issues allow/deny verdicts on risky actions
 *
 * The previous phase 8.7 delivered only a documentation audit (where
 * mutations are gated) — there was no runtime engine that actually
 * *measured* whether those predictions matched reality.
 *
 * TruthAudit closes the loop. After every proposal rollout, callers
 * record a TruthMeasurement (predicted vs observed). TruthAudit then:
 *   - verifies single proposals (TruthVerification)
 *   - emits global calibration reports (TruthReport)
 *   - flags proposals that need model recalibration
 *
 * Borrowed in spirit from Kosmos's `verification/truth_audit.py` —
 * Maximilian adapts it as a runtime module the orchestrator can call
 * per cycle to detect when its simulation models have drifted.
 */

import {
  TruthMeasurementSchema,
  TruthVerificationSchema,
  TruthReportSchema,
  TRUTH_AUDIT_CONFIG,
  type TruthMeasurement,
  type TruthVerification,
  type TruthReport,
  type TruthVerdict,
  type ProposalAction,
} from "./types.js";

export interface TruthAuditDeps {
  /** Source of historical measurements (e.g. orchestrator's outcome store). */
  getMeasurements?: () => Promise<TruthMeasurement[]> | TruthMeasurement[];
  /**
   * Persistence hooks. When provided, every recordMeasurement() and
   * verify() call is mirrored to durable storage (e.g. PgTruthStore).
   * Survives restarts so calibration drift is visible across cycles.
   */
  saveMeasurement?: (m: TruthMeasurement) => Promise<void> | void;
  saveVerification?: (v: TruthVerification) => Promise<void> | void;
  /** Override tolerance / thresholds (mostly for testing). */
  config?: Partial<typeof TRUTH_AUDIT_CONFIG>;
  /** Override the current time (for deterministic tests). */
  now?: () => Date;
  /** Source of id generator (defaults to randomUUID). */
  idGenerator?: () => string;
}

export class TruthAudit {
  private readonly measurements: TruthMeasurement[] = [];
  private readonly config: typeof TRUTH_AUDIT_CONFIG;
  private readonly now: () => Date;

  constructor(private deps: TruthAuditDeps = {}) {
    this.config = { ...TRUTH_AUDIT_CONFIG, ...(deps.config ?? {}) };
    this.now = deps.now ?? (() => new Date());
    this.loadHistoricalMeasurements();
  }

  /** Load measurements from the persistence layer into memory. */
  private async loadHistoricalMeasurements(): Promise<void> {
    if (!this.deps.getMeasurements) return;
    const historical = await this.deps.getMeasurements();
    for (const m of historical) {
      this.measurements.push(m);
    }
  }

  /**
   * Record a single prediction-vs-actual measurement. The caller is
   * typically the orchestrator after a proposal reaches `applied` status
   * and enough post-rollout executions have been observed.
   *
   * When a saveMeasurement persistence hook is configured, the record
   * is mirrored to durable storage asynchronously. Failures are logged
   * but do not block the in-memory write — durability is best-effort
   * because meta-system decisions should not halt on a transient DB blip.
   */
  recordMeasurement(input: Omit<TruthMeasurement, "recordedAt">): TruthMeasurement {
    const m = TruthMeasurementSchema.parse({
      ...input,
      recordedAt: this.now().toISOString(),
    });
    this.measurements.push(m);
    if (this.deps.saveMeasurement) {
      Promise.resolve(this.deps.saveMeasurement(m)).catch((err) => {
        // Use console.warn — telemetry may not be initialized at this layer.
        // Production should monitor this via the persistence layer's own metrics.
        console.warn(`[TruthAudit] saveMeasurement failed: ${(err as Error).message}`);
      });
    }
    return m;
  }

  /**
   * Verify a single proposal's prediction against all measurements recorded
   * for it. Returns null if no measurement exists yet (insufficient data).
   */
  verify(proposalId: string): TruthVerification | null {
    const samples = this.measurements.filter((m) => m.proposalId === proposalId);
    if (samples.length === 0) return null;

    const totalSamples = samples.reduce((s, m) => s + m.sampleSize, 0);
    const meanActual = average(samples.map((s) => s.actual.costDelta));
    const meanPredCost = average(samples.map((s) => s.predicted.costDelta));
    const meanPredLatency = average(samples.map((s) => s.predicted.latencyDeltaMs));
    const meanPredQuality = average(samples.map((s) => s.predicted.qualityDelta));
    const meanPredRisk = average(samples.map((s) => s.predicted.riskDelta));

    const meanActualLat = average(samples.map((s) => s.actual.latencyDeltaMs));
    const meanActualQual = average(samples.map((s) => s.actual.qualityDelta));
    const meanActualRisk = average(samples.map((s) => s.actual.riskDelta));

    const driftCost = meanActual - meanPredCost;
    const driftLat = meanActualLat - meanPredLatency;
    const driftQual = meanActualQual - meanPredQuality;
    const driftRisk = meanActualRisk - meanPredRisk;

    const absCost = Math.abs(driftCost);
    const absLat = Math.abs(driftLat);
    const absQual = Math.abs(driftQual);
    const absRisk = Math.abs(driftRisk);

    const maxAbsError = Math.max(absCost, absLat, absQual, absRisk);

    const relCost = safeRelativeError(driftCost, meanPredCost);
    const relLat = safeRelativeError(driftLat, meanPredLatency);
    const relQual = safeRelativeError(driftQual, meanPredQuality);
    const relRisk = safeRelativeError(driftRisk, meanPredRisk);
    const maxRelError = Math.max(relCost, relLat, relQual, relRisk);

    const verdict = this.computeVerdict({
      absCost,
      absLat,
      absQual,
      absRisk,
      sampleSize: totalSamples,
      actualQualityDelta: meanActualQual,
      predictedQualityDelta: meanPredQuality,
    });

    const needsRecalibration = verdict === "over_predicted" || verdict === "under_predicted"
      ? maxRelError >= 1.0
      : false;

    const verification = TruthVerificationSchema.parse({
      proposalId,
      verdict,
      maxAbsoluteError: round2(maxAbsError),
      maxRelativeError: round2(maxRelError),
      drifts: {
        costDelta: round2(driftCost),
        latencyDeltaMs: round2(driftLat),
        qualityDelta: round2(driftQual),
        riskDelta: round2(driftRisk),
      },
      sampleSize: totalSamples,
      needsRecalibration,
      verifiedAt: this.now().toISOString(),
    });

    if (this.deps.saveVerification) {
      Promise.resolve(this.deps.saveVerification(verification)).catch((err) => {
        console.warn(`[TruthAudit] saveVerification failed: ${(err as Error).message}`);
      });
    }

    return verification;
  }

  /**
   * Generate a calibration report over the current measurement window.
   * If `getMeasurements` is provided, the report covers *both* the in-memory
   * store and the external source (deduped by proposalId+recordedAt).
   */
  async report(): Promise<TruthReport> {
    const external = this.deps.getMeasurements
      ? await this.deps.getMeasurements()
      : [];
    const merged = mergeMeasurements(this.measurements, external);
    return this.buildReport(merged);
  }

  /**
   * Find the proposals with the largest drift, useful for surfacing
   * the worst-calibrated simulations.
   */
  async findDrift(limit = this.config.driftLeaderCount): Promise<
    Array<{ proposalId: string; maxAbsoluteError: number; verdict: TruthVerdict }>
  > {
    const external = this.deps.getMeasurements
      ? await this.deps.getMeasurements()
      : [];
    const merged = mergeMeasurements(this.measurements, external);
    const ids = unique(merged.map((m) => m.proposalId));

    const leaders = ids
      .map((id) => this.verifyFromSamples(id, merged.filter((m) => m.proposalId === id)))
      .filter((v): v is TruthVerification => v !== null)
      .sort((a, b) => b.maxAbsoluteError - a.maxAbsoluteError)
      .slice(0, limit)
      .map((v) => ({
        proposalId: v.proposalId,
        maxAbsoluteError: v.maxAbsoluteError,
        verdict: v.verdict,
      }));

    return leaders;
  }

  /** Reset in-memory store (does NOT touch the external source). */
  clear(): void {
    this.measurements.length = 0;
  }

  /** Total measurements currently held (in-memory only). */
  size(): number {
    return this.measurements.length;
  }

  /** Verify a proposal using an explicit sample set (no in-memory lookup). */
  private verifyFromSamples(proposalId: string, samples: TruthMeasurement[]): TruthVerification | null {
    if (samples.length === 0) return null;
    const prev = this.measurements;
    this.measurements.length = 0;
    this.measurements.push(...samples);
    try {
      return this.verify(proposalId);
    } finally {
      this.measurements.length = 0;
      this.measurements.push(...prev);
    }
  }

  private computeVerdict(d: {
    absCost: number;
    absLat: number;
    absQual: number;
    absRisk: number;
    sampleSize: number;
    actualQualityDelta: number;
    predictedQualityDelta: number;
  }): TruthVerdict {
    if (d.sampleSize < this.config.minSampleSize) return "insufficient_data";
    const tol = this.config.tolerance;
    const within = d.absCost <= tol.costDelta
      && d.absLat <= tol.latencyDeltaMs
      && d.absQual <= tol.qualityDelta
      && d.absRisk <= tol.riskDelta;
    if (within) return "accurate";
    // Quality drift direction is the load-bearing signal: if predicted
    // qualityDelta was positive but actual was worse, that's over-predicting
    // (a real-world disappointment). Conversely if actual quality was
    // *better* than predicted, that's under-predicting (a missed opportunity).
    if (d.actualQualityDelta < d.predictedQualityDelta) return "over_predicted";
    return "under_predicted";
  }

  private buildReport(samples: TruthMeasurement[]): TruthReport {
    const ids = unique(samples.map((s) => s.proposalId));
    const verdicts: Record<TruthVerdict, number> = {
      accurate: 0,
      under_predicted: 0,
      over_predicted: 0,
      insufficient_data: 0,
    };

    let maeCost = 0, maeLat = 0, maeQual = 0, maeRisk = 0;
    let mseCost = 0, mseLat = 0, mseQual = 0, mseRisk = 0;
    let count = 0;

    for (const id of ids) {
      const v = this.verifyFromSamples(id, samples.filter((s) => s.proposalId === id));
      if (!v) continue;
      verdicts[v.verdict] += 1;
      if (v.verdict !== "insufficient_data") {
        // Use the verification's per-dimension drifts (which are already
        // mean-across-samples) for MAE/MSE accounting.
        maeCost += Math.abs(v.drifts.costDelta);
        maeLat += Math.abs(v.drifts.latencyDeltaMs);
        maeQual += Math.abs(v.drifts.qualityDelta);
        maeRisk += Math.abs(v.drifts.riskDelta);
        mseCost += v.drifts.costDelta;
        mseLat += v.drifts.latencyDeltaMs;
        mseQual += v.drifts.qualityDelta;
        mseRisk += v.drifts.riskDelta;
        count += 1;
      }
    }

    const meanAbs = (s: number) => (count > 0 ? s / count : 0);
    const meanSigned = (s: number) => (count > 0 ? s / count : 0);

    return TruthReportSchema.parse({
      windowStart: samples[0]?.recordedAt ?? this.now().toISOString(),
      windowEnd: samples[samples.length - 1]?.recordedAt ?? this.now().toISOString(),
      totalMeasurements: samples.length,
      meanAbsoluteError: {
        costDelta: round2(meanAbs(maeCost)),
        latencyDeltaMs: round2(meanAbs(maeLat)),
        qualityDelta: round2(meanAbs(maeQual)),
        riskDelta: round2(meanAbs(maeRisk)),
      },
      meanSignedError: {
        costDelta: round2(meanSigned(mseCost)),
        latencyDeltaMs: round2(meanSigned(mseLat)),
        qualityDelta: round2(meanSigned(mseQual)),
        riskDelta: round2(meanSigned(mseRisk)),
      },
      verdictCounts: verdicts,
      driftLeaders: [],
      recalibrationRecommended: meanAbs(maeQual) > this.config.recalibrationThreshold,
      generatedAt: this.now().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeRelativeError(actualMinusPredicted: number, predicted: number): number {
  if (predicted === 0) {
    return actualMinusPredicted === 0 ? 0 : 1;
  }
  return Math.abs(actualMinusPredicted) / Math.max(Math.abs(predicted), 1e-9);
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function mergeMeasurements(a: TruthMeasurement[], b: TruthMeasurement[]): TruthMeasurement[] {
  const seen = new Set<string>();
  const out: TruthMeasurement[] = [];
  for (const m of [...a, ...b]) {
    const key = `${m.proposalId}::${m.recordedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Convenience constructor: build a TruthMeasurement from a simulation delta
 * and a set of observed post-rollout executions.
 */
export function buildMeasurement(input: {
  proposalId: string;
  proposalAction: ProposalAction;
  predicted: { costDelta: number; latencyDeltaMs: number; qualityDelta: number; riskDelta: number };
  actual: { costDelta: number; latencyDeltaMs: number; qualityDelta: number; riskDelta: number };
  sampleSize?: number;
  recordedAt?: string;
}): TruthMeasurement {
  return TruthMeasurementSchema.parse({
    proposalId: input.proposalId,
    proposalAction: input.proposalAction,
    predicted: input.predicted,
    actual: input.actual,
    sampleSize: input.sampleSize ?? 1,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
}