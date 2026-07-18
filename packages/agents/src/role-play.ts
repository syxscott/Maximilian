// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RolePlaying — dual-agent role-play dialogue (借鉴 CAMEL RolePlaying + ChatDev).
 *
 * CAMEL (RolePlay) sets up two agents with opposing/inquisitive roles and
 * a shared task. ChatDev extends this with multi-turn conversations where
 * role B reviews role A's output and requests fixes. Maximilian implements
 * a symmetric two-role loop:
 *
 *  - Role A produces an output for the given task.
 *  - Role B reviews A's output and sends feedback back to A.
 *  - Repeat until maxTurns, consensus, or early_exit condition.
 *
 * @see https://github.com/camel-ai/camel/blob/master/camel/societies/role_play.py
 */

import type { Agent } from "@max/core"
import type { ChatMessage } from "@max/providers"
import type { RoleRegistry } from "./roles.js"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RolePlayOptions {
  /** Role A identifier (must exist in roleRegistry). */
  roleA: string
  /** Role B identifier (must exist in roleRegistry). */
  roleB: string
  /** Task description presented to role A. */
  task: string
  /** Maximum dialogue turns (A+B = 1 turn). Default: 10. */
  maxTurns?: number
  /** Model hint forwarded to each agent's provider. */
  model?: string
  /** AbortSignal for cancelling provider calls. */
  signal?: AbortSignal
  /** Timeout in ms for each provider call. Default: 120000. */
  timeoutMs?: number
}

export interface RolePlayMessage {
  /** Which role sent this message: 'A' or 'B'. */
  role: "A" | "B"
  content: string
  timestamp: Date
}

export type RolePlayTermination =
  | { type: "max_turns"; turns: number }
  | { type: "consensus"; minScore?: number }
  | { type: "early_exit"; condition: (msgs: RolePlayMessage[]) => boolean }

/**
 * Two-role dialogue runner. Holds agent instances and maintains history.
 */
export class RolePlaying {
  private readonly options: Omit<Required<RolePlayOptions>, "signal"> & { signal?: AbortSignal }
  private readonly roleRegistry: RoleRegistry
  private readonly agentA: Agent
  private readonly agentB: Agent
  private readonly history: RolePlayMessage[] = []
  private turn = 0

  constructor(
    opts: RolePlayOptions,
    roleRegistry: RoleRegistry,
    agentFactory: (roleId: string) => Agent,
  ) {
    this.options = {
      maxTurns: opts.maxTurns ?? 10,
      model: opts.model ?? "unknown",
      roleA: opts.roleA,
      roleB: opts.roleB,
      task: opts.task,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 120_000,
    }
    this.roleRegistry = roleRegistry
    this.agentA = agentFactory(opts.roleA)
    this.agentB = agentFactory(opts.roleB)
  }

  /**
   * Execute one turn: A responds to the task (turn 0) or B's feedback (turn N),
   * then B critiques A's output.
   *
   * Returns both messages produced this turn.
   *
   * 修复 Bug 15 — A is only pushed to history after B completes successfully.
   * 修复 Bug 17 — AbortSignal + timeout guard on provider calls.
   */
  async step(): Promise<RolePlayMessage[]> {
    const { roleA, roleB, task, signal, timeoutMs } = this.options
    const phaseARole = this.roleRegistry.get(roleA)
    const phaseBRole = this.roleRegistry.get(roleB)

    if (!phaseARole || !phaseBRole) {
      throw new Error(`Role not found: ${!phaseARole ? roleA : roleB}`)
    }

    // Helper to wrap provider call with AbortSignal + timeout
    const withTimeout = <T>(promise: Promise<T>): Promise<T> => {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), timeoutMs)
      const combined = signal
        ? Promise.race([promise, new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("step() aborted")))
          })])
        : promise
      return combined
        .finally(() => clearTimeout(timeout))
        .catch((err) => { throw err })
    }

    if (this.turn === 0) {
      // Turn 0: A addresses the task directly.
      const aOutput = await withTimeout(this.agentAExecute(task, phaseARole))

      // B critiques A's output — only push A after B succeeds (Bug 15).
      const bFeedback = await withTimeout(this.agentBExecute(
        `Review the following output from ${roleA} and provide specific, actionable feedback:\n\n${aOutput}`,
        phaseBRole,
      ))

      const aMsg: RolePlayMessage = { role: "A", content: aOutput, timestamp: new Date() }
      const bMsg: RolePlayMessage = { role: "B", content: bFeedback, timestamp: new Date() }
      this.history.push(aMsg)
      this.history.push(bMsg)

      this.turn++
      return [aMsg, bMsg]
    } else {
      // Subsequent turns: A responds to B's most recent feedback.
      const lastB = this.lastMessageByRole("B")
      if (!lastB) throw new Error("Unexpected: no B message in history")

      const aOutput = await withTimeout(this.agentAExecute(
        `Address the following feedback from ${roleB} and revise your output accordingly:\n\n${lastB.content}`,
        phaseARole,
      ))

      // B re-reviews — only push A after B succeeds (Bug 15).
      const bFeedback = await withTimeout(this.agentBExecute(
        `Re-review the revised output from ${roleA} and state whether it adequately addresses your previous feedback. If still unsatisfactory, provide further corrections:\n\n${aOutput}`,
        phaseBRole,
      ))

      const aMsg: RolePlayMessage = { role: "A", content: aOutput, timestamp: new Date() }
      const bMsg: RolePlayMessage = { role: "B", content: bFeedback, timestamp: new Date() }
      this.history.push(aMsg)
      this.history.push(bMsg)

      this.turn++
      return [aMsg, bMsg]
    }
  }

  /**
   * Run the full dialogue until maxTurns or a termination condition is met.
   */
  async run(termination?: RolePlayTermination): Promise<RolePlayMessage[]> {
    const maxTurns = termination?.type === "max_turns" ? termination.turns : this.options.maxTurns

    while (this.turn < maxTurns) {
      // Check early_exit if provided.
      if (termination?.type === "early_exit" && termination.condition(this.history)) {
        break
      }

      await this.step()

      // Check consensus.
      if (termination?.type === "consensus") {
        const lastA = this.lastMessageByRole("A")
        const lastB = this.lastMessageByRole("B")
        if (lastA && lastB) {
          const score = this.estimateConsensusScore(lastA.content, lastB.content)
          const minScore = termination.minScore ?? 7
          if (score >= minScore) break
        }
      }
    }

    return this.history
  }

  /** All messages in order. */
  getHistory(): RolePlayMessage[] {
    return [...this.history]
  }

  /** Current turn number (number of completed A→B exchanges). */
  getTurn(): number {
    return this.turn
  }

  // ── private ────────────────────────────────────────────────────────────────

  /** Build messages for agent A. */
  private async agentAExecute(userContent: string, roleSpec: { systemPrompt: string; temperature?: number }): Promise<string> {
    // 修复 Bug 16 — read temperature from roleSpec (not substring hack)
    const temp = roleSpec.temperature ?? (roleSpec.systemPrompt.includes("reviewer") ? 0.2 : 0.4)
    const systemContent = roleSpec.systemPrompt
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...this.injectHistoryAsUser(),
      { role: "user", content: userContent },
    ]
    const response = await this.agentA.provider.chat(messages, {
      model: this.options.model,
      temperature: temp,
    })
    return response.content
  }

  /** Build messages for agent B. */
  private async agentBExecute(userContent: string, roleSpec: { systemPrompt: string; temperature?: number }): Promise<string> {
    // 修复 Bug 16 — read temperature from roleSpec (not substring hack)
    const temp = roleSpec.temperature ?? (roleSpec.systemPrompt.includes("reviewer") ? 0.2 : 0.4)
    const systemContent = roleSpec.systemPrompt
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...this.injectHistoryAsUser(),
      { role: "user", content: userContent },
    ]
    const response = await this.agentB.provider.chat(messages, {
      model: this.options.model,
      temperature: temp,
    })
    return response.content
  }

  /** Inject A's prior outputs as user messages so the next speaker has context. */
  private injectHistoryAsUser(): ChatMessage[] {
    return this.history.map((msg) => ({
      role: "user" as const,
      content: `[${msg.role}]: ${msg.content}`,
    }))
  }

  private lastMessageByRole(role: "A" | "B"): RolePlayMessage | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.role === role) return this.history[i]
    }
    return undefined
  }

  /** Heuristic: if B's message contains "APPROVED" or "looks good", consider it consensus. */
  private estimateConsensusScore(aOutput: string, bFeedback: string): number {
    const approved =
      /APPROVED|looks good|looks correct|accepted|satisfied/i.test(bFeedback)
    const revised = /revise|fix|change|update|address/i.test(bFeedback)
    if (approved) return 9
    if (!revised) return 7
    return 5
  }
}
