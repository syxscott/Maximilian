// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ProviderTransform (借鉴 opencode - provider/transform.ts).
 *
 * 各 provider 把统一 Message / Tool 翻译成自己模型的 wire format。
 * 统一注册成 middleware 链,ProviderRouter 按 provider id 选用。
 *
 * Maximilian 已经有 anthropic/openai/gemini 等 format 文件,本模块提供
 * 通用 registry + 默认 transform,允许 future provider 直接 register 即可。
 */

import type { ChatMessage, ToolDefinition } from "@max/llm"

export interface WireFormat {
  systemBlocks: unknown[]
  messages: unknown[]
  tools: unknown[]
}

export interface Transformer {
  /** Provider id, e.g. "anthropic" | "openai" | "gemini" | ... */
  providerId: string
  /** 把统一消息翻译成 provider wire format */
  toWire(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    system: string,
  ): WireFormat
}

const registry = new Map<string, Transformer>()

/** 借鉴 opencode - registerTransformer */
export function registerTransformer(t: Transformer): void {
  registry.set(t.providerId, t)
}

/** 借鉴 opencode - getTransformer(返回 undefined 时 caller 应使用 default pass-through) */
export function getTransformer(providerId: string): Transformer | undefined {
  return registry.get(providerId)
}

/** 借鉴 opencode - listTransformers(调试用) */
export function listTransformers(): string[] {
  return [...registry.keys()]
}

/** 借鉴 opencode - 默认 anthropic wire format(参考 opencode 实现) */
export const anthropicTransformer: Transformer = {
  providerId: "anthropic",
  toWire(messages, tools, system) {
    return {
      systemBlocks: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    }
  },
}

/** 借鉴 opencode - 默认 openai wire format */
export const openaiTransformer: Transformer = {
  providerId: "openai",
  toWire(messages, tools, system) {
    return {
      systemBlocks: [{ role: "system", content: system }],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
    }
  },
}

// 借鉴 opencode - 模块加载时自动注册默认 transformer
registerTransformer(anthropicTransformer)
registerTransformer(openaiTransformer)