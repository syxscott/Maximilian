/**
 * Stall Detection + Re-planning (Magentic-One pattern).
 *
 * Monitors agent progress and triggers re-planning when stalls are detected.
 * A "stall" is defined as: N consecutive rounds with no new completed tasks
 * and no new results produced.
 *
 * Usage:
 *   const detector = new StallDetector({ maxIdleRounds: 3 })
 *   detector.observe({ completedTasks: 0, newResults: 0 })
 *   detector.observe({ completedTasks: 0, newResults: 0 })
 *   detector.observe({ completedTasks: 0, newResults: 0 })
 *   detector.isStalled() // true
 *   detector.shouldReplan() // true
 */

export interface StallDetectorOptions {
  /**
   * Number of consecutive idle rounds before declaring a stall.
   * An "idle" round is one where no tasks completed and no results were
   * produced. Default: 3.
   */
  maxIdleRounds?: number
  /**
   * Optional callback invoked when a stall is detected.
   * Can be used to trigger re-planning or alert the orchestrator.
   */
  onStall?: (info: StallInfo) => void
}

export interface ProgressSnapshot {
  /** Number of tasks completed in this round. */
  completedTasks: number
  /** Number of new results produced in this round. */
  newResults: number
}

export interface StallInfo {
  /** Number of consecutive idle rounds. */
  idleRounds: number
  /** Timestamp when the stall was detected. */
  detectedAt: number
  /** Total rounds observed. */
  totalRounds: number
}

export type ReplanStrategy = "replan" | "skip-stalled" | "abort"

export class StallDetector {
  private idleRounds = 0
  private totalRounds = 0
  private stalled = false
  private stallInfo: StallInfo | null = null
  private maxIdleRounds: number
  private onStall?: (info: StallInfo) => void

  constructor(options?: StallDetectorOptions) {
    this.maxIdleRounds = options?.maxIdleRounds ?? 3
    this.onStall = options?.onStall
  }

  /**
   * Observe a progress snapshot from the current round.
   * Returns true if the detector just transitioned to stalled.
   */
  observe(snapshot: ProgressSnapshot): boolean {
    this.totalRounds++

    if (snapshot.completedTasks > 0 || snapshot.newResults > 0) {
      // Progress was made — reset idle counter
      this.idleRounds = 0
      if (this.stalled) {
        this.stalled = false
        this.stallInfo = null
      }
      return false
    }

    // No progress
    this.idleRounds++

    if (this.idleRounds >= this.maxIdleRounds && !this.stalled) {
      this.stalled = true
      this.stallInfo = {
        idleRounds: this.idleRounds,
        detectedAt: Date.now(),
        totalRounds: this.totalRounds,
      }
      this.onStall?.(this.stallInfo)
      return true
    }

    return false
  }

  /** Whether the system is currently stalled. */
  isStalled(): boolean {
    return this.stalled
  }

  /** Get stall info if stalled, null otherwise. */
  getStallInfo(): StallInfo | null {
    return this.stallInfo
  }

  /**
   * Determine the recommended replan strategy.
   * Returns "replan" if stalled and should try a different approach,
   * "skip-stalled" if we should skip the stuck tasks and continue,
   * or "abort" if too many rounds have passed.
   */
  getReplanStrategy(): ReplanStrategy {
    if (!this.stalled) return "replan"
    if (this.totalRounds > 20) return "abort"
    return "skip-stalled"
  }

  /** Reset the detector (e.g. after a successful replan). */
  reset(): void {
    this.idleRounds = 0
    this.totalRounds = 0
    this.stalled = false
    this.stallInfo = null
  }

  /** Get the current idle round count. */
  getIdleRounds(): number {
    return this.idleRounds
  }

  /** Get total rounds observed. */
  getTotalRounds(): number {
    return this.totalRounds
  }
}
