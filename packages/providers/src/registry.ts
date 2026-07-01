/**
 * Provider registry.
 *
 * Resolves providers from environment variables.
 * To add a new provider:
 *   1. Implement the Provider interface (e.g. MyProvider.ts)
 *   2. Register it in fromEnv() below
 */

import type { Provider } from "./base.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenRouterProvider } from "./openrouter.js";
import { DeepSeekProvider } from "./deepseek.js";
import { withRetry } from "./retry.js";
import { withCircuitBreaker } from "./circuit-breaker.js";

export interface ProviderConfig {
  /** Override default model for this provider. */
  defaultModel?: string;
  /** Whether the provider is enabled (defaults to true). */
  enabled?: boolean;
}

export interface ProviderRegistry {
  list(): Provider[];
  get(id: string): Provider | undefined;
  default(): Provider | undefined;
  /** Set which provider is the default. */
  setDefaultProviderId(id: string): void;
  /** Update the configured default model for a provider. */
  setProviderConfig(id: string, config: ProviderConfig): void;
  /** Get the current config override for a provider (undefined means use env defaults). */
  getProviderConfig(id: string): ProviderConfig | undefined;
  /** Get the effective default model for a provider (config override or provider's built-in default). */
  getEffectiveDefaultModel(id: string): string;
}

export function createRegistry(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const providers: Provider[] = [];

  if (env.OPENAI_API_KEY) {
    providers.push(
      new OpenAIProvider({
        apiKey: env.OPENAI_API_KEY,
        defaultModel: env.OPENAI_MODEL,
      })
    );
  }

  if (env.ANTHROPIC_API_KEY) {
    providers.push(
      new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        defaultModel: env.ANTHROPIC_MODEL,
      })
    );
  }

  if (env.OPENROUTER_API_KEY) {
    providers.push(
      new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        defaultModel: env.OPENROUTER_MODEL,
      })
    );
  }

  if (env.DEEPSEEK_API_KEY) {
    providers.push(
      new DeepSeekProvider({
        apiKey: env.DEEPSEEK_API_KEY,
        defaultModel: env.DEEPSEEK_MODEL,
      })
    );
  }

  // Wrap each provider with retry + circuit breaker for resilience.
  const resilient: Provider[] = providers.map((p) => withRetry(withCircuitBreaker(p)));

  // Mutable state: default provider id and config overrides.
  let currentDefaultId: string | undefined = resilient[0]?.id;
  const configOverrides = new Map<string, ProviderConfig>();

  return {
    list: () => [...resilient],
    get: (id) => resilient.find((p) => p.id === id),
    default: () => {
      if (!currentDefaultId) return resilient[0];
      return resilient.find((p) => p.id === currentDefaultId) ?? resilient[0];
    },
    setDefaultProviderId: (id: string) => {
      // Only allow setting default to a provider that actually exists
      if (resilient.some((p) => p.id === id)) {
        currentDefaultId = id;
      }
    },
    setProviderConfig: (id: string, config: ProviderConfig) => {
      configOverrides.set(id, config);
    },
    getProviderConfig: (id: string) => {
      return configOverrides.get(id);
    },
    getEffectiveDefaultModel: (id: string) => {
      const override = configOverrides.get(id);
      if (override?.defaultModel !== undefined && override.defaultModel.length > 0) {
        return override.defaultModel;
      }
      const provider = resilient.find((p) => p.id === id);
      return provider?.defaultModel ?? "";
    },
  };
}

/** Singleton registry for the running process. */
let _registry: ProviderRegistry | null = null;
export function getRegistry(): ProviderRegistry {
  if (!_registry) _registry = createRegistry();
  return _registry;
}