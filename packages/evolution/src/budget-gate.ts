// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Evolution judge budget gate (borrowing mcode-stack
 * stacks/jiachen/skills/pr-review-tuning/references/backtest.md:18-55).
 *
 * Before a backtest the reference flow estimates the cost of the run,
 * records the agreed budget in durable state, and STOPS STARTING NEW
 * CASES once the budget is used up. The evolution engine runs the same
 * discipline around its judge calls: the gate persists `spent` in
 * <rootDir>/evolution-state.json through the existing atomic
 * read-modify-write surface, refuses a cycle whose estimated cost would
 * blow the limit BEFORE any judge call is made, and charges actuals as
 * the calls complete.
 */

import { readModifyWriteAtomic, writeFileAtomic } from "./atomic.js"

export interface EvolutionBudgetState {
  /** Total cost charged so far (same unit as the estimates, e.g. tokens). */
  spent: number
  /** The agreed budget. */
  limit: number
  updatedAt: string
}

export interface EvolutionBudgetGateOptions {
  /** Durable state file (default: <rootDir>/evolution-state.json). */
  statePath: string
  /** The agreed budget; a gate with limit 0 refuses every cycle. */
  limit: number
  /** Override the clock (tests). */
  now?: () => Date
}

export class EvolutionBudgetGate {
  readonly limit: number

  constructor(private readonly opts: EvolutionBudgetGateOptions) {
    this.limit = opts.limit
  }

  private async read(): Promise<EvolutionBudgetState> {
    try {
      const { promises: fs } = await import("node:fs")
      const raw = await fs.readFile(this.opts.statePath, "utf-8")
      const parsed = JSON.parse(raw) as Partial<EvolutionBudgetState>
      return {
        spent: typeof parsed.spent === "number" ? parsed.spent : 0,
        limit: typeof parsed.limit === "number" ? parsed.limit : this.opts.limit,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      }
    } catch {
      return { spent: 0, limit: this.opts.limit, updatedAt: "" }
    }
  }

  /** Remaining budget (limit − spent; never negative). */
  async remaining(): Promise<number> {
    const state = await this.read()
    return Math.max(0, state.limit - state.spent)
  }

  /**
   * Can a cycle estimated at `estimated` cost start at all? Mirrors
   * backtest.md: "stops starting new cases when its budget is used up."
   */
  async ensureHeadroom(estimated: number): Promise<boolean> {
    const state = await this.read()
    return state.spent + estimated <= state.limit
  }

  /** Charge an actual cost; persists through the atomic state surface. */
  async charge(amount: number): Promise<void> {
    if (amount <= 0) return
    const now = this.opts.now ?? (() => new Date())
    await readModifyWriteAtomic<EvolutionBudgetState>(
      this.opts.statePath,
      { spent: 0, limit: this.opts.limit, updatedAt: now().toISOString() },
      (current) => ({
        spent: (typeof current.spent === "number" ? current.spent : 0) + amount,
        limit: this.opts.limit,
        updatedAt: now().toISOString(),
      }),
    )
  }

  /** Reset the running spend (a new budget period). */
  async reset(): Promise<void> {
    const now = this.opts.now ?? (() => new Date())
    const state: EvolutionBudgetState = {
      spent: 0,
      limit: this.opts.limit,
      updatedAt: now().toISOString(),
    }
    await writeFileAtomic(this.opts.statePath, JSON.stringify(state, null, 2))
  }
}
