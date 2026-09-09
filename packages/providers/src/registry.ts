/**
 * Provider registry — preset-driven.
 *
 * On startup, scans `PROVIDER_PRESETS` and instantiates a Provider for
 * each preset whose `envKey` is set in the environment. The set of enabled
 * providers is therefore data-driven: adding a preset requires zero code
 * changes here.
 *
 * Behavior:
 *   - API keys are read ONLY from env vars. They never enter the registry
 *     state or DB.
 *   - The default provider is `currentDefaultId` (settable via API). On
 *     boot we pick the first enabled provider if no explicit default exists.
 *   - Provider config overrides (per-provider default model) are kept in an
 *     in-memory map and survive across the singleton's lifetime.
 *   - Each provider is wrapped with retry + circuit-breaker for resilience.
 *
 * Presets marked `hidden: true` (OAuth / not-yet-implemented) are skipped.
 */

import type { Provider } from "./base.js"
import { withRetry } from "./retry.js"
import { withCircuitBreaker } from "./circuit-breaker.js"
import { withSseGuard } from "./sse-guard.js"
import { PROVIDER_PRESETS, type ProviderPreset } from "./presets/index.js"
import { createProviderForFormat } from "./formats/index.js"

export interface ProviderConfig {
  /** Override default model for this provider. */
  defaultModel?: string
  /** Whether the provider is enabled (defaults to true). */
  enabled?: boolean
}

export interface ProviderRegistry {
  list(): Provider[]
  get(id: string): Provider | undefined
  default(): Provider | undefined
  /** Set which provider is the default. */
  setDefaultProviderId(id: string): void
  /** Update the configured default model for a provider. */
  setProviderConfig(id: string, config: ProviderConfig): void
  /** Get the current config override for a provider. */
  getProviderConfig(id: string): ProviderConfig | undefined
  /** Effective default model: env override > config override > preset default. */
  getEffectiveDefaultModel(id: string): string
  /** All visible (non-hidden) presets. */
  listPresets(): ProviderPreset[]
  /** Look up a preset by id. */
  getPreset(id: string): ProviderPreset | undefined
}

/**
 * Whether a preset should be activated for the given environment.
 *
 * Default rule: `env[preset.envKey]` is truthy. Local inference presets
 * (`ollama` / `lmstudio` / `vllm`) accept a boolean-ish "enabled" flag
 * because they have no API key.
 */
function isPresetActive(preset: ProviderPreset, env: NodeJS.ProcessEnv): boolean {
  if (preset.hidden) return false
  const raw = env[preset.envKey]
  if (!raw) return false
  // For local presets, any non-empty "1"/"true" enables; otherwise key presence
  // is enough (treats the value as the API key, even though we ignore it).
  if (preset.category === "custom" && preset.id !== "custom") {
    // Local inference: skip if the env var literally says "false"/"0".
    return !/^(false|0|off|no)$/i.test(raw.trim())
  }
  return true
}

export function createRegistry(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const resilient: Provider[] = []
  const activePresetIds: string[] = []

  for (const preset of PROVIDER_PRESETS) {
    if (!isPresetActive(preset, env)) continue
    const apiKey = env[preset.envKey] ?? ""
    const modelOverride = preset.envModel ? env[preset.envModel] : undefined
    try {
      const provider = createProviderForFormat(preset.apiFormat, {
        id: preset.id,
        name: preset.name,
        apiKey,
        baseURL: preset.baseUrl,
        defaultModel: modelOverride || preset.defaultModel,
      })
      resilient.push(withCircuitBreaker(withRetry(withSseGuard(provider))))
      activePresetIds.push(preset.id)
    } catch (err) {
      // Skip providers with invalid config rather than crashing the registry.
      // Surface the error to stderr so operators can spot typos.

      console.warn(`[providers] Skipping preset ${preset.id}: ${(err as Error).message}`)
    }
  }

  // Mutable state.
  let currentDefaultId: string | undefined = activePresetIds[0]
  const configOverrides = new Map<string, ProviderConfig>()

  function findPreset(id: string): ProviderPreset | undefined {
    return PROVIDER_PRESETS.find((p) => p.id === id)
  }

  return {
    list: () => [...resilient],
    get: (id) => resilient.find((p) => p.id === id),
    default: () => {
      if (currentDefaultId) {
        const hit = resilient.find((p) => p.id === currentDefaultId)
        if (hit) return hit
      }
      return resilient[0]
    },
    setDefaultProviderId: (id) => {
      if (resilient.some((p) => p.id === id)) {
        currentDefaultId = id
      }
    },
    setProviderConfig: (id, config) => {
      configOverrides.set(id, config)
    },
    getProviderConfig: (id) => configOverrides.get(id),
    getEffectiveDefaultModel: (id) => {
      const override = configOverrides.get(id)
      if (override?.defaultModel !== undefined && override.defaultModel.length > 0) {
        return override.defaultModel
      }
      const preset = findPreset(id)
      if (preset?.envModel) {
        const fromEnv = env[preset.envModel]
        if (fromEnv) return fromEnv
      }
      const provider = resilient.find((p) => p.id === id)
      return provider?.defaultModel ?? preset?.defaultModel ?? ""
    },
    listPresets: () => PROVIDER_PRESETS.filter((p) => !p.hidden),
    getPreset: (id) => findPreset(id),
  }
}

/** Singleton registry for the running process. */
let _registry: ProviderRegistry | null = null
export function getRegistry(): ProviderRegistry {
  if (!_registry) _registry = createRegistry()
  return _registry
}

/** Test helper: reset the singleton between runs. */
export function resetRegistry(): void {
  _registry = null
}
