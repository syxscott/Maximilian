/**
 * ProviderRouter — LiteLLM-style model routing with fallback chains.
 *
 * Wraps multiple providers and routes requests based on:
 *   - Priority order (first healthy provider wins)
 *   - Round-robin load balancing within same priority
 *   - Automatic fallback when a provider fails
 *   - Circuit breaker + retry integration per provider
 *
 * Usage:
 *   const router = new ProviderRouter([
 *     { provider: openai, priority: 1 },
 *     { provider: anthropic, priority: 2 },
 *     { provider: openrouter, priority: 3 },
 *   ]);
 *   const response = await router.chat(messages, options);
 */

import type {
  Provider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  EmbeddingResponse,
} from "./base.js";
import { ProviderError } from "./base.js";
import { withRetry, type RetryOptions } from "./retry.js";
import { withCircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";

export interface RouteEntry {
  provider: Provider;
  priority: number; // lower = higher priority
}

export interface RouterOptions {
  /** Retry options applied to each provider call. */
  retry?: Partial<RetryOptions>;
  /** Circuit breaker options per provider. */
  circuitBreaker?: Partial<CircuitBreakerOptions>;
  /** Max attempts across all providers before giving up. */
  maxTotalAttempts?: number;
}

export class ProviderRouter implements Provider {
  readonly id = "router";
  readonly name = "Provider Router";
  readonly defaultModel: string;

  private readonly entries: RouteEntry[];
  private readonly wrappedProviders: Map<string, Provider> = new Map();
  private readonly maxTotalAttempts: number;
  private roundRobinIndex = 0;

  constructor(entries: RouteEntry[], opts?: RouterOptions) {
    if (entries.length === 0) {
      throw new Error("[ProviderRouter] At least one provider entry required");
    }
    this.entries = [...entries].sort((a, b) => a.priority - b.priority);
    this.defaultModel = this.entries[0].provider.defaultModel;
    this.maxTotalAttempts = opts?.maxTotalAttempts ?? entries.length * 2;

    // Pre-wrap each provider with circuit breaker + retry
    for (const entry of this.entries) {
      const wrapped = withRetry(
        withCircuitBreaker(entry.provider, opts?.circuitBreaker),
        opts?.retry,
      );
      this.wrappedProviders.set(entry.provider.id, wrapped);
    }
  }

  isConfigured(): boolean {
    return this.entries.some((e) => e.provider.isConfigured());
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    return this.route((p) => p.chat(messages, options));
  }

  async *stream(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const ordered = this.getOrderedEntries();
    const errors: Error[] = [];

    for (const entry of ordered) {
      if (!entry.provider.isConfigured()) continue;

      const wrapped = this.wrappedProviders.get(entry.provider.id) ?? entry.provider;
      try {
        yield* wrapped.stream(messages, options);
        return;
      } catch (err) {
        errors.push(err as Error);
        if (errors.length >= this.maxTotalAttempts) break;
      }
    }

    if (errors.length === 0) {
      throw new ProviderError(
        "router",
        undefined,
        "No providers are configured",
      );
    }
    const messages_ = errors.map((e) => e.message).join("; ");
    throw new ProviderError(
      "router",
      undefined,
      `All providers failed (${errors.length} attempts): ${messages_}`,
    );
  }

  async embeddings(
    input: string | string[],
    model?: string,
  ): Promise<EmbeddingResponse> {
    return this.route((p) => {
      if (!p.embeddings) {
        throw new ProviderError(p.id, undefined, "Embeddings not supported");
      }
      return p.embeddings(input, model);
    });
  }

  getProvider(id: string): Provider | undefined {
    return this.entries.find((e) => e.provider.id === id)?.provider;
  }

  listProviderIds(): string[] {
    return this.entries.map((e) => e.provider.id);
  }

  // ── Internal routing ────────────────────────────────────────────────────

  private async route<T>(
    fn: (provider: Provider) => Promise<T>,
  ): Promise<T> {
    const ordered = this.getOrderedEntries();
    const errors: Error[] = [];

    for (const entry of ordered) {
      if (!entry.provider.isConfigured()) continue;

      const wrapped = this.wrappedProviders.get(entry.provider.id) ?? entry.provider;
      try {
        return await fn(wrapped);
      } catch (err) {
        errors.push(err as Error);
        if (errors.length >= this.maxTotalAttempts) break;
      }
    }

    if (errors.length === 0) {
      // Every entry was skipped via `!isConfigured()` — surface that as a
      // distinct error rather than the misleading "0 attempts" message.
      throw new ProviderError(
        "router",
        undefined,
        "No providers are configured (set the relevant API keys / enable flags)",
      );
    }
    const messages = errors.map((e) => e.message).join("; ");
    throw new ProviderError(
      "router",
      undefined,
      `All providers failed (${errors.length} attempts): ${messages}`,
    );
  }

  private getOrderedEntries(): RouteEntry[] {
    const groups = new Map<number, RouteEntry[]>();
    for (const entry of this.entries) {
      const group = groups.get(entry.priority) ?? [];
      group.push(entry);
      groups.set(entry.priority, group);
    }

    const result: RouteEntry[] = [];
    const sortedPriorities = [...groups.keys()].sort((a, b) => a - b);

    for (const priority of sortedPriorities) {
      const group = groups.get(priority)!;
      if (group.length === 1) {
        result.push(group[0]);
      } else {
        const idx = this.roundRobinIndex % group.length;
        this.roundRobinIndex++;
        for (let i = 0; i < group.length; i++) {
          result.push(group[(idx + i) % group.length]);
        }
      }
    }

    return result;
  }

  private selectProvider(): Provider {
    const ordered = this.getOrderedEntries();
    for (const entry of ordered) {
      if (entry.provider.isConfigured()) return entry.provider;
    }
    return ordered[0].provider;
  }
}
