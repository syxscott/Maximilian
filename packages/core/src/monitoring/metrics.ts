/**
 * MetricsCollector — runtime metrics with budget alerts (借鉴 Kosmos core/metrics.py).
 *
 * Kosmos's MetricsCollector tracks API calls, experiments, agents, cache
 * stats, and budget consumption. Budget alerts fire at 50/75/90/100% of
 * the configured limit.
 *
 * Maximilian adapts this as a dependency-free, in-memory collector that
 * the runtime can update from existing call sites:
 *   - recordApiCall(model, inputTokens, outputTokens, durationMs)
 *   - recordTaskExecution(taskType, status, durationMs)
 *   - recordCacheHit / recordCacheMiss
 *   - setBudget({ limitUsd, period, alertThresholds })
 *   - getStatistics() — full snapshot for export
 */

export type AlertLevel = "info" | "warning" | "critical"

export interface BudgetAlert {
  id: string
  level: AlertLevel
  thresholdPct: number
  consumedUsd: number
  limitUsd: number
  timestamp: string
  message: string
}

export interface ApiCallRecord {
  model: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  success: boolean
  timestamp: string
}

export interface TaskExecutionRecord {
  taskType: string
  status: "success" | "failed" | "skipped"
  durationMs: number
  timestamp: string
}

export interface MetricsStatistics {
  apiCalls: number
  apiErrors: number
  totalInputTokens: number
  totalOutputTokens: number
  totalApiDurationMs: number
  tasksExecuted: number
  tasksFailed: number
  cacheHits: number
  cacheMisses: number
  hitRate: number
  budget: {
    enabled: boolean
    limitUsd?: number
    consumedUsd: number
    consumptionPct: number
    alertCount: number
  }
  uptimeMs: number
}

export interface MetricsCollectorOptions {
  /** Initial budget config (optional). */
  budget?: {
    limitUsd: number
    /** Approximate USD per 1K input tokens (default: 0.003). */
    usdPer1KInputTokens?: number
    /** Approximate USD per 1K output tokens (default: 0.015). */
    usdPer1KOutputTokens?: number
    alertThresholds?: number[]
  }
}

export class MetricsCollector {
  private readonly startTime = Date.now()
  // API metrics
  private apiCalls = 0
  private apiErrors = 0
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private totalApiDurationMs = 0
  private readonly apiHistory: ApiCallRecord[] = []

  // Task metrics
  private tasksExecuted = 0
  private tasksFailed = 0
  private readonly taskHistory: TaskExecutionRecord[] = []

  // Cache metrics
  private cacheHits = 0
  private cacheMisses = 0

  // Budget
  private budgetEnabled = false
  private budgetLimitUsd?: number
  private consumedUsd = 0
  private usdPer1KInputTokens = 0.003
  private usdPer1KOutputTokens = 0.015
  private alertThresholds: number[] = [50, 75, 90, 100]
  private alerts: BudgetAlert[] = []
  private firedThresholds = new Set<number>()
  private readonly alertCallbacks: Array<(alert: BudgetAlert) => void> = []

  constructor(options?: MetricsCollectorOptions) {
    if (options?.budget) {
      this.setBudget(options.budget)
    }
  }

  recordApiCall(model: string, inputTokens: number, outputTokens: number, durationMs: number, success = true): void {
    this.apiCalls++
    if (!success) this.apiErrors++
    this.totalInputTokens += inputTokens
    this.totalOutputTokens += outputTokens
    this.totalApiDurationMs += durationMs
    this.apiHistory.push({
      model, inputTokens, outputTokens, durationMs, success,
      timestamp: new Date().toISOString(),
    })
    if (this.budgetEnabled && this.budgetLimitUsd !== undefined) {
      const cost = (inputTokens / 1000) * this.usdPer1KInputTokens +
                   (outputTokens / 1000) * this.usdPer1KOutputTokens
      this.consumedUsd += cost
      this.checkBudgetAlerts()
    }
  }

  recordTaskExecution(taskType: string, status: "success" | "failed" | "skipped", durationMs: number): void {
    this.tasksExecuted++
    if (status === "failed") this.tasksFailed++
    this.taskHistory.push({
      taskType, status, durationMs,
      timestamp: new Date().toISOString(),
    })
  }

  recordCacheHit(): void { this.cacheHits++ }
  recordCacheMiss(): void { this.cacheMisses++ }

  setBudget(budget: NonNullable<MetricsCollectorOptions["budget"]>): void {
    this.budgetEnabled = true
    this.budgetLimitUsd = budget.limitUsd
    if (budget.usdPer1KInputTokens !== undefined) this.usdPer1KInputTokens = budget.usdPer1KInputTokens
    if (budget.usdPer1KOutputTokens !== undefined) this.usdPer1KOutputTokens = budget.usdPer1KOutputTokens
    if (budget.alertThresholds) this.alertThresholds = [...budget.alertThresholds]
    this.firedThresholds.clear()
    this.checkBudgetAlerts()
  }

  disableBudget(): void {
    this.budgetEnabled = false
    this.budgetLimitUsd = undefined
  }

  onAlert(callback: (alert: BudgetAlert) => void): void {
    this.alertCallbacks.push(callback)
  }

  /** Most recent N api call records. */
  recentApiCalls(limit = 50): ApiCallRecord[] {
    return this.apiHistory.slice(-limit)
  }

  /** Most recent N task records. */
  recentTasks(limit = 50): TaskExecutionRecord[] {
    return this.taskHistory.slice(-limit)
  }

  /** Snapshot of current statistics. */
  getStatistics(): MetricsStatistics {
    const totalCache = this.cacheHits + this.cacheMisses
    return {
      apiCalls: this.apiCalls,
      apiErrors: this.apiErrors,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalApiDurationMs: this.totalApiDurationMs,
      tasksExecuted: this.tasksExecuted,
      tasksFailed: this.tasksFailed,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: totalCache > 0 ? this.cacheHits / totalCache : 0,
      budget: {
        enabled: this.budgetEnabled,
        limitUsd: this.budgetLimitUsd,
        consumedUsd: this.consumedUsd,
        consumptionPct: this.budgetLimitUsd && this.budgetLimitUsd > 0
          ? (this.consumedUsd / this.budgetLimitUsd) * 100
          : 0,
        alertCount: this.alerts.length,
      },
      uptimeMs: Date.now() - this.startTime,
    }
  }

  /** All fired budget alerts. */
  getAlerts(): BudgetAlert[] {
    return [...this.alerts]
  }

  private checkBudgetAlerts(): void {
    if (!this.budgetEnabled || this.budgetLimitUsd === undefined) return
    const pct = (this.consumedUsd / this.budgetLimitUsd) * 100
    for (const threshold of this.alertThresholds) {
      if (pct >= threshold && !this.firedThresholds.has(threshold)) {
        this.firedThresholds.add(threshold)
        const level: AlertLevel =
          threshold >= 90 ? "critical" : threshold >= 75 ? "warning" : "info"
        const alert: BudgetAlert = {
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          level,
          thresholdPct: threshold,
          consumedUsd: this.consumedUsd,
          limitUsd: this.budgetLimitUsd,
          timestamp: new Date().toISOString(),
          message: `Budget consumption reached ${threshold.toFixed(0)}% ($${this.consumedUsd.toFixed(4)} / $${this.budgetLimitUsd.toFixed(2)})`,
        }
        this.alerts.push(alert)
        for (const cb of this.alertCallbacks) cb(alert)
      }
    }
  }
}