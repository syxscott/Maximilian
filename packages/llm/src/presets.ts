// Provider presets — model catalog and provider configurations
// Derived from OpenCode packages/llm/src/providers/ and packages/opencode/src/provider/
// Plain TypeScript, no Effect-TS

import type { ModelCapabilities, ModelCost, ModelLimits } from "./provider.js"

// ── Model Presets ──

export interface ModelPreset {
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly family?: string
  readonly capabilities?: ModelCapabilities
  readonly cost?: ModelCost
  readonly limits?: ModelLimits
}

export const MODEL_PRESETS: Record<string, ModelPreset[]> = {
  anthropic: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      family: "claude",
      capabilities: { temperature: true, reasoning: true, attachment: true, toolCall: true },
      cost: { input: 3, output: 15 },
      limits: { context: 200000, output: 8192 },
    },
    {
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      provider: "anthropic",
      family: "claude",
      capabilities: { temperature: true, reasoning: true, attachment: true, toolCall: true },
      cost: { input: 15, output: 75 },
      limits: { context: 200000, output: 8192 },
    },
    {
      id: "claude-haiku-3-5-20241022",
      name: "Claude Haiku 3.5",
      provider: "anthropic",
      family: "claude",
      capabilities: { temperature: true, attachment: true, toolCall: true },
      cost: { input: 0.8, output: 4 },
      limits: { context: 200000, output: 8192 },
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      family: "gpt",
      capabilities: { temperature: true, attachment: true, toolCall: true },
      cost: { input: 2.5, output: 10 },
      limits: { context: 128000, output: 16384 },
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "openai",
      family: "gpt",
      capabilities: { temperature: true, attachment: true, toolCall: true },
      cost: { input: 0.15, output: 0.6 },
      limits: { context: 128000, output: 16384 },
    },
    {
      id: "o3",
      name: "o3",
      provider: "openai",
      family: "o",
      capabilities: { reasoning: true, toolCall: true },
      cost: { input: 2, output: 8 },
      limits: { context: 200000, output: 100000 },
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      provider: "openai",
      family: "o",
      capabilities: { reasoning: true, toolCall: true },
      cost: { input: 1.1, output: 4.4 },
      limits: { context: 200000, output: 100000 },
    },
  ],
  google: [
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "google",
      family: "gemini",
      capabilities: { temperature: true, reasoning: true, attachment: true, toolCall: true },
      cost: { input: 1.25, output: 10 },
      limits: { context: 1000000, output: 65536 },
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "google",
      family: "gemini",
      capabilities: { temperature: true, reasoning: true, attachment: true, toolCall: true },
      cost: { input: 0.15, output: 0.6 },
      limits: { context: 1000000, output: 65536 },
    },
  ],
  deepseek: [
    {
      id: "deepseek-chat",
      name: "DeepSeek V3",
      provider: "deepseek",
      family: "deepseek",
      capabilities: { temperature: true, toolCall: true },
      cost: { input: 0.27, output: 1.1 },
      limits: { context: 64000, output: 8192 },
    },
    {
      id: "deepseek-reasoner",
      name: "DeepSeek R1",
      provider: "deepseek",
      family: "deepseek",
      capabilities: { reasoning: true },
      cost: { input: 0.55, output: 2.19 },
      limits: { context: 64000, output: 8192 },
    },
  ],
  xai: [
    {
      id: "grok-3",
      name: "Grok 3",
      provider: "xai",
      family: "grok",
      capabilities: { temperature: true, toolCall: true },
      cost: { input: 3, output: 15 },
      limits: { context: 131072, output: 16384 },
    },
  ],
  groq: [
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B",
      provider: "groq",
      family: "llama",
      capabilities: { temperature: true, toolCall: true },
      cost: { input: 0.59, output: 0.79 },
      limits: { context: 128000, output: 32768 },
    },
  ],
  // ── Chinese 1P vendors (added 2026-08-17) ──
  // Borrowed from cc-switch opencodeProviderPresets baseURLs. All speak
  // OpenAI Chat Completions-compatible protocol, so a single OpenAIChatProvider
  // adapter covers them — only the baseURL and default model id differ.
  //
  // M1-fix: cost is `undefined` (not `{ input: 0, output: 0 }`) for vendors
  // whose pricing we don't have a verified figure for. Setting zero was
  // misleading because the dashboard's cost chart would render a literal
  // $0 line — making it look like the API was free. `undefined` triggers the
  // "cost unknown" badge instead.
  bailian: [
    {
      id: "qwen3-max",
      name: "Qwen3 Max",
      provider: "bailian",
      family: "qwen",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 262144, output: 32768 },
    },
    {
      id: "qwen-plus",
      name: "Qwen Plus",
      provider: "bailian",
      family: "qwen",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 131072, output: 32768 },
    },
  ],
  moonshot: [
    {
      id: "kimi-k2",
      name: "Kimi K2",
      provider: "moonshot",
      family: "kimi",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 8192 },
    },
    {
      id: "kimi-latest",
      name: "Kimi Latest",
      provider: "moonshot",
      family: "kimi",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 8192 },
    },
  ],
  zhipu: [
    {
      id: "glm-4.6",
      name: "GLM-4.6",
      provider: "zhipu",
      family: "glm",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 200000, output: 8192 },
    },
  ],
  volcengine: [
    {
      // H10-note: Volcengine's ARK routing is endpoint-id based. The
      // `id` here (`doubao-seed-1-6-250615`) is the *public* model name,
      // but actual API calls need the user's ep-xxx endpoint id assigned
      // in the Volcengine console. Callers who want to invoke Doubao via
      // Volcengine should set `baseURL` to
      // `https://ark.cn-beijing.volces.com/api/v3/responses/<ep-id>` or
      // use the model id directly if they've registered it as a hosted
      // model. We keep the public id in the preset so the dashboard's
      // model picker has a friendly name; the cost chart shows
      // "cost unknown" because we don't have a verified figure for
      // per-1M-token pricing across all Doubao variants.
      id: "doubao-seed-1-6-250615",
      name: "Doubao Seed 1.6",
      provider: "volcengine",
      family: "doubao",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 16384 },
    },
  ],
  stepfun: [
    {
      id: "step-3",
      name: "Step 3",
      provider: "stepfun",
      family: "step",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 16384 },
    },
  ],
  longcat: [
    {
      // M12-fix: official model id is lowercase. Mixed case used to mismatch
      // the upstream API's id check (and tripped case-sensitive routing in
      // `resolvePreset` when callers queried by lowercase id).
      id: "longcat-flash-chat",
      name: "Longcat Flash Chat",
      provider: "longcat",
      family: "longcat",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 8192 },
    },
  ],
  xiaomi: [
    {
      // M11-fix: official model id is `mimo-v2-flash` (the v2.5 placeholder
      // was wrong — Xiaomi's API rejects unknown ids). Updated to the
      // publicly documented name; v2-pro may follow in a subsequent preset.
      id: "mimo-v2-flash",
      name: "MiMo V2 Flash",
      provider: "xiaomi",
      family: "mimo",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 8192 },
    },
  ],
  modelscope: [
    {
      id: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      name: "Qwen3 Coder 30B (ModelScope)",
      provider: "modelscope",
      family: "qwen",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 32768, output: 8192 },
    },
  ],
  // H8-fix: the original preset listed `mistral-large-latest` here, which
  // is Mistral's own model id — not MiniMax's. Routing that through
  // `api.minimaxi.com` would either 404 or, worse, succeed against a
  // silently-different upstream (MiniMax's API may proxy to a third party).
  // We replace with an explicit MiniMax model id. The cost field is left
  // as `undefined` since per-token pricing for MiniMax's hosted Anthropic
  // / OpenAI passthrough varies by region and tier; the dashboard shows
  // "cost unknown" rather than fabricating a number.
  minimax: [
    {
      id: "MiniMax-Text-01",
      name: "MiniMax Text 01",
      provider: "minimax",
      family: "minimax",
      capabilities: { temperature: true, toolCall: true },
      cost: undefined,
      limits: { context: 128000, output: 16384 },
    },
  ],
  // ── Aggregators / proxies (single baseURL, multiple models) ──
  aihubmix: [
    {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (AiHubMix)",
      provider: "aihubmix",
      family: "claude",
      capabilities: { temperature: true, reasoning: true, toolCall: true },
      cost: { input: 3, output: 15 },
      limits: { context: 200000, output: 8192 },
    },
    {
      id: "gpt-5",
      name: "GPT-5 (AiHubMix)",
      provider: "aihubmix",
      family: "gpt",
      capabilities: { temperature: true, toolCall: true },
      cost: { input: 2.5, output: 10 },
      limits: { context: 128000, output: 16384 },
    },
  ],
}

// ── Provider Env Var Mapping ──

export const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  googleVertex: ["GOOGLE_VERTEX_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"],
  githubCopilot: ["GITHUB_TOKEN"],
  amazonBedrock: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  // ── Chinese 1P vendors (added 2026-08-17, borrowed from cc-switch opencode presets) ──
  bailian: ["BAILIAN_API_KEY", "DASHSCOPE_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  zhipu: ["ZHIPU_API_KEY", "GLM_API_KEY"],
  volcengine: ["VOLCENGINE_API_KEY", "ARK_API_KEY"],
  stepfun: ["STEPFUN_API_KEY"],
  longcat: ["LONGCAT_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY", "MIMO_API_KEY"],
  modelscope: ["MODELSCOPE_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  // ── Aggregators / proxies ──
  aihubmix: ["AIHUBMIX_API_KEY"],
}

// ── Provider Default Base URLs ──────────────────────────────────────────────
//
// Each provider's default OpenAI Chat-compatible endpoint. Borrowed from
// cc-switch opencodeProviderPresets baseURLs (2026-08-17). These are the
// URLs a fresh `OpenAIChatProvider({ id, apiKey, ... })` should hit if the
// caller doesn't pass an explicit baseURL.
//
// Convention: OpenAI Chat-compatible routes end with `/v1` (or `/compatible-mode/v1`
// for Bailian/Qwen which live under DashScope's passthrough layer).
export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
  // ── Chinese 1P vendors ──
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  stepfun: "https://api.stepfun.com/step_plan/v1",
  longcat: "https://api.longcat.chat/openai/v1",
  xiaomi: "https://api.xiaomimimo.com/v1",
  modelscope: "https://api-inference.modelscope.cn/v1",
  minimax: "https://api.minimaxi.com/v1",
  // ── Aggregators ──
  aihubmix: "https://aihubmix.com/v1",
}

// ── Resolve available providers from env ──

export function resolveAvailableProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const available: string[] = []
  for (const [provider, vars] of Object.entries(PROVIDER_ENV_VARS)) {
    if (vars.some((v) => env[v])) {
      available.push(provider)
    }
  }
  return available
}

// ── Get models for a provider ──

export function getModelsForProvider(providerId: string): ModelPreset[] {
  return MODEL_PRESETS[providerId] ?? []
}

// ── Get all available models ──

export function getAllAvailableModels(env: NodeJS.ProcessEnv = process.env): ModelPreset[] {
  const providers = resolveAvailableProviders(env)
  return providers.flatMap((p) => getModelsForProvider(p))
}

// ── Preset validation (borrowed from deepseek-harness resolveAdapterOptions) ──
//
// Fail loud on malformed presets rather than silently producing a half-built
// ModelPreset. Validates:
//   - id is a non-empty string
//   - name is a non-empty string
//   - limits.context and limits.output are positive integers (when present)
//   - cost.input and cost.output are non-negative numbers (when present)
//   - capabilities, when present, only contains known boolean keys
//
// Returns a list of error messages (empty list = valid). The caller can
// choose to throw, log, or surface the messages in the UI.
const KNOWN_CAPABILITIES = new Set([
  "temperature",
  "reasoning",
  "attachment",
  "toolCall",
  "inputModalities",
  "outputModalities",
  "interleaved",
])

export interface PresetValidationError {
  readonly provider: string
  readonly modelId: string
  readonly message: string
}

export function validatePreset(
  provider: string,
  preset: ModelPreset,
): PresetValidationError[] {
  const errors: PresetValidationError[] = []
  if (!preset.id || preset.id.length === 0) {
    errors.push({ provider, modelId: preset.id, message: "model id must be non-empty" })
  }
  if (!preset.name || preset.name.length === 0) {
    errors.push({ provider, modelId: preset.id, message: "model name must be non-empty" })
  }
  if (preset.limits) {
    if (preset.limits.context !== undefined
      && (!Number.isInteger(preset.limits.context) || preset.limits.context <= 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `context window must be a positive integer (got ${preset.limits.context})`,
      })
    }
    if (preset.limits.output !== undefined
      && (!Number.isInteger(preset.limits.output) || preset.limits.output <= 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `output limit must be a positive integer (got ${preset.limits.output})`,
      })
    }
    if (preset.limits.input !== undefined
      && (!Number.isInteger(preset.limits.input) || preset.limits.input <= 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `input limit must be a positive integer (got ${preset.limits.input})`,
      })
    }
  }
  if (preset.cost) {
    if (preset.cost.input !== undefined
      && (typeof preset.cost.input !== "number" || preset.cost.input < 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `input cost must be non-negative (got ${preset.cost.input})`,
      })
    }
    if (preset.cost.output !== undefined
      && (typeof preset.cost.output !== "number" || preset.cost.output < 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `output cost must be non-negative (got ${preset.cost.output})`,
      })
    }
    if (preset.cost.cache !== undefined
      && (typeof preset.cost.cache !== "number" || preset.cost.cache < 0)) {
      errors.push({
        provider,
        modelId: preset.id,
        message: `cache cost must be non-negative (got ${preset.cost.cache})`,
      })
    }
  }
  if (preset.capabilities) {
    for (const key of Object.keys(preset.capabilities)) {
      if (!KNOWN_CAPABILITIES.has(key)) {
        errors.push({
          provider,
          modelId: preset.id,
          message: `unknown capability "${key}" (known: ${Array.from(KNOWN_CAPABILITIES).join(", ")})`,
        })
      }
    }
  }
  return errors
}

/**
 * Validate every preset in the catalog. Useful at startup so a typo in the
 * presets file is caught before the UI ships it to a user.
 *
 * @returns list of validation errors across the entire catalog
 */
export function validateAllPresets(): PresetValidationError[] {
  const errors: PresetValidationError[] = []
  for (const [provider, presets] of Object.entries(MODEL_PRESETS)) {
    const seen = new Set<string>()
    for (const preset of presets) {
      if (seen.has(preset.id)) {
        errors.push({
          provider,
          modelId: preset.id,
          message: "duplicate model id within provider",
        })
      }
      seen.add(preset.id)
      errors.push(...validatePreset(provider, preset))
    }
  }
  return errors
}

// ── resolvePreset() (borrowed from deepseek-harness resolveAdapterOptions) ──
//
// Take a raw caller-provided preset (typically from user-typed config or
// `ProviderPanel` UI) and merge it with catalog defaults. If the caller omits
// a field, fall back to the matching catalog entry; if no catalog entry
// exists, return an `Invalid` shape with the missing required fields
// surfaced so the UI can prompt the user.
export interface ResolvedPreset {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly baseURL: string
  readonly apiKeyEnv: readonly string[]
  readonly capabilities: ModelCapabilities | undefined
  readonly limits: ModelLimits | undefined
  readonly cost: ModelCost | undefined
}

export type ResolvePresetResult =
  | { readonly ok: true; readonly value: ResolvedPreset }
  | { readonly ok: false; readonly reason: string }

export function resolvePreset(input: {
  readonly provider: string
  readonly id: string
  readonly apiKeyEnv?: string
  readonly baseURL?: string
}): ResolvePresetResult {
  const provider = input.provider.trim()
  const id = input.id.trim()
  if (!provider) return { ok: false, reason: "provider is required" }
  if (!id) return { ok: false, reason: "model id is required" }

  const catalog = MODEL_PRESETS[provider]
  const envVars = PROVIDER_ENV_VARS[provider]
  const defaultBaseURL = PROVIDER_DEFAULT_BASE_URLS[provider]

  // Unknown provider: caller supplied a custom one. We still build a usable
  // ResolvedPreset if they gave us baseURL and apiKeyEnv; otherwise we report
  // what is missing so the UI can ask.
  if (!catalog) {
    if (!input.baseURL) {
      return {
        ok: false,
        reason: `unknown provider "${provider}" with no baseURL override — add baseURL or pick a known provider`,
      }
    }
    if (!input.apiKeyEnv && (!envVars || envVars.length === 0)) {
      return {
        ok: false,
        reason: `unknown provider "${provider}" with no apiKeyEnv override — add apiKeyEnv or pick a known provider`,
      }
    }
    return {
      ok: true,
      value: {
        provider,
        id,
        name: id,
        baseURL: input.baseURL,
        apiKeyEnv: input.apiKeyEnv ? [input.apiKeyEnv] : envVars ?? [],
        capabilities: undefined,
        limits: undefined,
        cost: undefined,
      },
    }
  }

  // Known provider: merge fields from catalog. Catalog hit is required for
  // name/capabilities/limits; id may be a sub-variant of a family (e.g. a
  // user-typed `kimi-k2-0905-preview` when catalog only has `kimi-k2`).
  const hit = catalog.find((p) => p.id === id)
  if (!hit) {
    // Allow forward-compat: unknown model id on a known provider. We still
    // surface name = id (no display name) and no capabilities; downstream
    // callers can fall back to provider-level defaults.
    if (!input.baseURL && !defaultBaseURL) {
      return {
        ok: false,
        reason: `provider "${provider}" has no default baseURL — pass baseURL explicitly`,
      }
    }
    return {
      ok: true,
      value: {
        provider,
        id,
        name: id,
        baseURL: input.baseURL ?? defaultBaseURL ?? "",
        apiKeyEnv: input.apiKeyEnv ? [input.apiKeyEnv] : envVars ?? [],
        capabilities: undefined,
        limits: undefined,
        cost: undefined,
      },
    }
  }

  return {
    ok: true,
    value: {
      provider,
      id: hit.id,
      name: hit.name,
      baseURL: input.baseURL ?? defaultBaseURL ?? "",
      apiKeyEnv: input.apiKeyEnv ? [input.apiKeyEnv] : envVars ?? [],
      capabilities: hit.capabilities,
      limits: hit.limits,
      cost: hit.cost,
    },
  }
}
