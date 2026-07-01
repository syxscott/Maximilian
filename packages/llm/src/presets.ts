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
