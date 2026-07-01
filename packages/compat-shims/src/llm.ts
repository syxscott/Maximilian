/**
 * LLM SDK adapter.
 *
 * Both the openai and @anthropic-ai SDKs have churned their message shapes:
 *   - openai renamed `max_tokens` → `max_completion_tokens` in 4.x
 *   - @anthropic-ai/sdk changed `messages[].role` validation in 0.30
 *   - ai-sdk (Vercel) is its own fast-moving target
 *
 * Rather than teach every provider implementation about these shifts,
 * we expose a single normalized "chat request" shape and translate inside
 * the adapter. Providers consume the normalized shape; SDK upgrades only
 * touch this file.
 */

import { resolveMajor } from "./version.js";

/**
 * Provider-neutral chat request. This is the shape providers should build
 * and pass to `toProviderArgs()` — they should not import the SDKs
 * directly.
 */
export interface NormalizedChatRequest {
  /** Model identifier as the provider understands it. */
  model: string;
  /** System message(s). Joined with a newline for SDKs that take a single string. */
  system?: string | string[];
  /** Conversation history. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Generation parameters. All optional. */
  temperature?: number;
  maxTokens?: number;
  /** Provider-specific extras (tools, response_format, etc.). */
  extras?: Record<string, unknown>;
}

/**
 * Provider-neutral chat response. The adapter fills this in regardless of
 * which SDK produced the answer.
 */
export interface NormalizedChatResponse {
  text: string;
  /** Provider's native usage block, preserved for telemetry. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
  /** Raw provider response for debugging. */
  raw: unknown;
}

/**
 * Translate a normalized request into the args object expected by a
 * specific SDK version.
 *
 * `providerKind` tells us which family; the version resolution picks the
 * right field names inside.
 */
export function toProviderArgs(
  providerKind: "openai" | "anthropic",
  req: NormalizedChatRequest,
): Record<string, unknown> {
  const system = Array.isArray(req.system)
    ? req.system.join("\n\n")
    : req.system ?? "";

  if (providerKind === "openai") {
    const major = resolveMajor("openai", 4);
    if (major >= 5) {
      // Future-proofing: openai 5 hasn't shipped as of 2026, but when it
      // does it might rename again.
      return buildOpenAIArgs(req, system, /* paramName */ "max_completion_tokens");
    }
    if (major >= 4) {
      return buildOpenAIArgs(req, system, "max_completion_tokens");
    }
    // openai 3.x — pre-rename.
    return buildOpenAIArgs(req, system, "max_tokens");
  }

  // anthropic
  const major = resolveMajor("@anthropic-ai/sdk", 0);
  if (major >= 1) {
    // Pre-empting anthropic 1.x — the SDK team has hinted at a stable major.
    return buildAnthropicArgs(req, system);
  }
  return buildAnthropicArgs(req, system);
}

function buildOpenAIArgs(
  req: NormalizedChatRequest,
  system: string,
  maxTokensField: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    model: req.model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...req.messages,
    ],
  };
  if (req.temperature !== undefined) args.temperature = req.temperature;
  if (req.maxTokens !== undefined) args[maxTokensField] = req.maxTokens;
  if (req.extras) Object.assign(args, req.extras);
  return args;
}

function buildAnthropicArgs(
  req: NormalizedChatRequest,
  system: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  };
  if (system) args.system = system;
  if (req.temperature !== undefined) args.temperature = req.temperature;
  if (req.maxTokens !== undefined) args.max_tokens = req.maxTokens;
  if (req.extras) Object.assign(args, req.extras);
  return args;
}

/**
 * Normalize a raw SDK response into `NormalizedChatResponse`.
 *
 * Both SDKs return wildly different shapes today (openai has
 * `choices[0].message.content`, anthropic has `content[0].text`). This
 * helper collapses them so provider code doesn't need to know.
 */
export function fromProviderResponse(
  providerKind: "openai" | "anthropic",
  raw: unknown,
): NormalizedChatResponse {
  if (providerKind === "openai") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = raw as any;
    return {
      text: r?.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: r?.usage?.prompt_tokens ?? 0,
        outputTokens: r?.usage?.completion_tokens ?? 0,
        cachedInputTokens: r?.usage?.prompt_tokens_details?.cached_tokens,
      },
      raw,
    };
  }
  // anthropic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  // Anthropic content is an array of blocks; the text block is the typical
  // case but tool_use blocks need a separate path. We concatenate text
  // blocks only — tool-use handling stays in the provider for now.
  const blocks = Array.isArray(r?.content) ? r.content : [];
  const text = blocks
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b?.text ?? "")
    .join("");
  return {
    text,
    usage: {
      inputTokens: r?.usage?.input_tokens ?? 0,
      outputTokens: r?.usage?.output_tokens ?? 0,
      cachedInputTokens: r?.usage?.cache_read_input_tokens,
    },
    raw,
  };
}
