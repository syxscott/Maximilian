/**
 * BlockAssembler — 借鉴 deepseek-harness llm/src/assembler.ts.
 *
 * Incrementally assembles raw StreamChunks into ContentBlocks and a final assistant Message.
 * Used by provider adapters to convert streaming protocol deltas into structured output.
 *
 * Usage:
 *   const assembler = new BlockAssembler()
 *   for await (const chunk of stream) {
 *     assembler.push(chunk)
 *   }
 *   const blocks = assembler.blocks()
 *   const usage = assembler.usage
 *   const finish = assembler.finish
 */

// ── Inline Stream Types (duplicated from core/stream.ts for providers independence) ──

export interface TextBlock {
  readonly type: "text"
  readonly text: string
}
export interface ReasoningBlock {
  readonly type: "reasoning"
  readonly text: string
}
export interface ToolCallBlock {
  readonly type: "tool-call"
  readonly id: string
  readonly name: string
  readonly arguments: string
}
export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | { readonly type: "image"; readonly mediaType: string; readonly data: string }
  | ToolCallBlock
  | {
      readonly type: "tool-result"
      readonly toolCallId: string
      readonly content: ContentBlock[]
      readonly isError?: boolean
    }

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

export interface LlmFailure {
  readonly message: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
}

export type FinishReason =
  | { readonly kind: "stop" }
  | { readonly kind: "tool-calls" }
  | { readonly kind: "max-tokens" }
  | { readonly kind: "aborted"; readonly failure: LlmFailure }
  | { readonly kind: "error"; readonly failure: LlmFailure }

export type StreamChunk =
  | {
      readonly type: "block-start"
      readonly index: number
      readonly blockType: ContentBlock["type"]
    }
  | { readonly type: "text-delta"; readonly index: number; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly index: number; readonly text: string }
  | {
      readonly type: "tool-call-delta"
      readonly index: number
      readonly id: string
      readonly name?: string
      readonly argumentsDelta: string
    }
  | { readonly type: "block-end"; readonly index: number; readonly block: ContentBlock }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | {
      readonly type: "finish"
      readonly reason: FinishReason
      readonly replayState?: unknown
      readonly usage?: TokenUsage
    }

// ── Partial Block ────────────────────────────────────────────────────────

interface PartialBlock {
  blockType: string
  text: string
  toolCallId?: string
  toolCallName?: string
  toolCallArguments: string
  /** Set by `block-end` — authoritative, freezes the partial. */
  block?: ContentBlock
}

// ── BlockAssembler ───────────────────────────────────────────────────────

export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private _usage?: TokenUsage
  private _finish?: FinishReason
  private _replayState?: unknown

  /**
   * Feed one raw chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order
   */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "block-start": {
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index)
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: "",
            toolCallArguments: "",
          })
        }
        return
      }
      case "text-delta": {
        const partial = this.ensure(chunk.index, "text")
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.text += chunk.text
        return
      }
      case "reasoning-delta": {
        const partial = this.ensure(chunk.index, "reasoning")
        if (partial.block) return
        partial.text += chunk.text
        return
      }
      case "tool-call-delta": {
        const partial = this.ensure(chunk.index, "tool-call")
        if (partial.block) return
        partial.toolCallId = chunk.id
        if (chunk.name) partial.toolCallName = chunk.name
        partial.toolCallArguments += chunk.argumentsDelta
        return
      }
      case "block-end": {
        const partial = this.ensure(chunk.index, chunk.block.type)
        if (partial.block) return // first close wins
        partial.block = chunk.block
        return
      }
      case "usage": {
        this._usage = chunk.usage
        return
      }
      case "finish": {
        this._finish = chunk.reason
        this._replayState = chunk.replayState
        if (chunk.usage) this._usage = chunk.usage
        return
      }
    }
  }

  private ensure(index: number, blockType: string): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: "", toolCallArguments: "" }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  private assemble(partial: PartialBlock, index: number): ContentBlock {
    if (partial.block) return partial.block
    switch (partial.blockType) {
      case "text":
        return { type: "text", text: partial.text } as TextBlock
      case "reasoning":
        return { type: "reasoning", text: partial.text } as ReasoningBlock
      case "tool-call":
        return {
          type: "tool-call",
          id: partial.toolCallId ?? `call-${index}`,
          name: partial.toolCallName ?? "",
          arguments: partial.toolCallArguments,
        } as ToolCallBlock
      default:
        throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`)
    }
  }

  private mustGet(index: number): PartialBlock {
    const partial = this.partials.get(index)
    if (!partial)
      throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`)
    return partial
  }

  /**
   * Assemble all blocks seen so far, in stream order.
   *
   * When finish reason is `max-tokens`, tool calls are filtered out because
   * they may have been truncated mid-argument (incomplete JSON).
   */
  blocks(): ContentBlock[] {
    const blocks = this.order.map((index) => this.assemble(this.mustGet(index), index))
    // Max-token truncation: drop potentially incomplete tool calls
    if (this.finish.kind === "max-tokens") {
      return blocks.filter((block) => block.type !== "tool-call")
    }
    return blocks
  }

  /** Token usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined {
    return this._usage
  }

  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` as default when no finish chunk arrived. */
  get finish(): FinishReason {
    return this._finish ?? { kind: "stop" }
  }

  /** Adapter-private replay state from the terminal finish chunk. */
  get replayState(): unknown {
    return this._replayState
  }
}
