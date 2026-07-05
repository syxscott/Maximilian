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
  /**
   * Recent outputs to compare against for loop detection. Optional.
   * When provided, the detector hashes new outputs and compares against
   * the buffer; repeated outputs (n-gram similarity ≥ 0.8 across ≥3
   * consecutive rounds) trigger a "loop-detected" signal which counts
   * as a stall even when completedTasks/newResults are zero.
   *
   * Borrowed from autogen Magentic-One Orchestrator (借鉴 D): the
   * original distinguishes `is_progress_being_made=False` (slow but
   * moving) from `is_in_loop=True` (genuinely stuck). The hash buffer
   * here gives us a cheap approximation of that signal without an
   * extra LLM call.
   */
  recentOutputs?: string[]
}

export interface StallInfo {
  /** Number of consecutive idle rounds. */
  idleRounds: number
  /** Timestamp when the stall was detected. */
  detectedAt: number
  /** Total rounds observed. */
  totalRounds: number
  /** Reason the stall fired — borrowed from autogen Magentic-One. */
  reason: StallReason
}

/**
 * Why a stall fired. The original StallDetector only knew "idle" (zero
 * progress). Borrowing autogen Magentic-One's three-state signal
 * (借鉴 D) lets us distinguish slow-but-progressing from genuinely
 * looping.
 */
export type StallReason = "idle" | "loop-detected"

export type ReplanStrategy = "replan" | "skip-stalled" | "abort"

export class StallDetector {
  private idleRounds = 0
  private totalRounds = 0
  private stalled = false
  private stallInfo: StallInfo | null = null
  private maxIdleRounds: number
  private onStall?: (info: StallInfo) => void
  /** Sliding buffer of recent output hashes for loop detection. */
  private recentHashes: string[] = []
  /** How many of the most recent rounds must match for loop-detected. */
  private static readonly LOOP_WINDOW = 3

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
      // Progress was made — reset idle counter and clear loop buffer.
      this.idleRounds = 0
      this.recentHashes = []
      if (this.stalled) {
        this.stalled = false
        this.stallInfo = null
      }
      return false
    }

    // No progress. Update the loop-detection buffer if outputs provided.
    if (snapshot.recentOutputs && snapshot.recentOutputs.length > 0) {
      const hash = fingerprintOutputs(snapshot.recentOutputs)
      this.recentHashes.push(hash)
      if (this.recentHashes.length > StallDetector.LOOP_WINDOW) {
        this.recentHashes.shift()
      }
    }

    // Detect loop: same fingerprint appears in the last LOOP_WINDOW rounds.
    if (
      this.recentHashes.length === StallDetector.LOOP_WINDOW &&
      this.recentHashes.every((h) => h === this.recentHashes[0])
    ) {
      this.idleRounds++
      if (!this.stalled) {
        this.stalled = true
        this.stallInfo = {
          idleRounds: this.idleRounds,
          detectedAt: Date.now(),
          totalRounds: this.totalRounds,
          reason: "loop-detected",
        }
        this.onStall?.(this.stallInfo)
        return true
      }
      return false
    }

    this.idleRounds++

    if (this.idleRounds >= this.maxIdleRounds && !this.stalled) {
      this.stalled = true
      this.stallInfo = {
        idleRounds: this.idleRounds,
        detectedAt: Date.now(),
        totalRounds: this.totalRounds,
        reason: "idle",
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
    this.recentHashes = []
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

/**
 * Cheap output fingerprint for loop detection. We don't need a real
 * hash — just a stable signature that's equal when two outputs are
 * "similar enough" to suggest the agent is repeating itself.
 *
 * Strategy: sort 4-grams of normalized text and join. Two outputs that
 * share most of their 4-grams in the same multiset will collide. This
 * is a deliberately rough heuristic — the goal is to catch obvious
 * "agent says the same thing again" loops, not subtle semantic
 * similarity.
 */
function fingerprintOutputs(outputs: string[]): string {
  const text = outputs.join("\n").toLowerCase().replace(/\s+/g, " ").trim()
  if (text.length === 0) return ""
  const grams: string[] = []
  for (let i = 0; i <= text.length - 4; i++) {
    grams.push(text.slice(i, i + 4))
  }
  grams.sort()
  return grams.join("|")
}
