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
   */
  async step(): Promise<RolePlayMessage[]> {
    const { roleA, roleB, task, signal, timeoutMs } = this.options
    const phaseARole = this.roleRegistry.get(roleA)
    const phaseBRole = this.roleRegistry.get(roleB)

    if (!phaseARole || !phaseBRole) {
      throw new Error(`Role not found: ${!phaseARole ? roleA : roleB}`)
    }

    // Cooperative cancellation: abort local controller when external signal fires.
    const localCtrl = new AbortController()
    const timeoutHandle = setTimeout(() => localCtrl.abort(), timeoutMs)
    if (signal?.aborted) {
      clearTimeout(timeoutHandle)
      localCtrl.abort()
    } else if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutHandle)
        localCtrl.abort()
      })
    }
    const effectiveSignal = localCtrl.signal

    const chatOptions = {
      signal: effectiveSignal,
    }

    const cleanup = () => clearTimeout(timeoutHandle)
    const runA = async (prompt: string) => {
      try { return await this.agentAExecute(prompt, phaseARole, chatOptions) }
      finally { cleanup() }
    }
    const runB = async (prompt: string) => {
      try { return await this.agentBExecute(prompt, phaseBRole, chatOptions) }
      finally { cleanup() }
    }

    let aOutput: string
    let bFeedback: string

    if (this.turn === 0) {
      aOutput = await runA(task)
      bFeedback = await runB(`Review the following output from ${roleA} and provide specific, actionable feedback:\n\n${aOutput}`)
    } else {
      const lastB = this.lastMessageByRole("B")
      if (!lastB) throw new Error("Unexpected: no B message in history")
      aOutput = await runA(`Address the following feedback from ${roleB} and revise your output accordingly:\n\n${lastB.content}`)
      bFeedback = await runB(`Re-review the revised output from ${roleA} and state whether it adequately addresses your previous feedback. If still unsatisfactory, provide further corrections:\n\n${aOutput}`)
    }

    const aMsg: RolePlayMessage = { role: "A", content: aOutput, timestamp: new Date() }
    const bMsg: RolePlayMessage = { role: "B", content: bFeedback, timestamp: new Date() }
    this.history.push(aMsg, bMsg)
    this.turn++
    return [aMsg, bMsg]
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
  private async agentAExecute(
    userContent: string,
    roleSpec: { systemPrompt: string; temperature?: number },
    chatOptions: { signal?: AbortSignal },
  ): Promise<string> {
    const temp = roleSpec.temperature ?? (roleSpec.systemPrompt.includes("reviewer") ? 0.2 : 0.4)
    const messages: ChatMessage[] = [
      { role: "system", content: roleSpec.systemPrompt },
      ...this.injectHistoryAsUser(),
      { role: "user", content: userContent },
    ]
    const response = await this.agentA.provider.chat(messages, {
      model: this.options.model,
      temperature: temp,
      signal: chatOptions.signal,
    })
    return response.content
  }

  /** Build messages for agent B. */
  private async agentBExecute(
    userContent: string,
    roleSpec: { systemPrompt: string; temperature?: number },
    chatOptions: { signal?: AbortSignal },
  ): Promise<string> {
    const temp = roleSpec.temperature ?? (roleSpec.systemPrompt.includes("reviewer") ? 0.2 : 0.4)
    const messages: ChatMessage[] = [
      { role: "system", content: roleSpec.systemPrompt },
      ...this.injectHistoryAsUser(),
      { role: "user", content: userContent },
    ]
    const response = await this.agentB.provider.chat(messages, {
      model: this.options.model,
      temperature: temp,
      signal: chatOptions.signal,
    })
    return response.content
  }

  /** Inject prior messages as assistant messages so speaker identity is preserved. */
  private injectHistoryAsUser(): ChatMessage[] {
    return this.history.map((msg) => ({
      role: "assistant" as const,
      content: `[Role ${msg.role}]: ${msg.content}`,
    }))
  }

  private lastMessageByRole(role: "A" | "B"): RolePlayMessage | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.role === role) return this.history[i]
    }
    return undefined
  }

  /**
   * Heuristic: require explicit positive approval from B.
   * Requires word boundaries to avoid "not approved" matching /APPROVED/.
   */
  private estimateConsensusScore(_aOutput: string, bFeedback: string): number {
    // Explicit approval phrases with word boundaries to avoid "not approved" matching.
    const approved =
      /\b(approved|looks good|looks correct|looks acceptable|accepted|satisfied|good enough|lgtm)\b/i.test(bFeedback)
    // Explicit rejection/fix keywords.
    const needsWork =
      /\b(revise|fix|change|update|address|correct|rewrite|redo|must|should)\b/i.test(bFeedback)
    if (approved && !needsWork) return 9
    if (needsWork) return 5
    return 7
  }
}
