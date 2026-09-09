/**
 * SDK client for the Feature Flag HTTP API.
 *
 * Usage:
 *   import { createFlagsClient } from "@max/sdk/feature-flags"
 *   const flags = createFlagsClient({ baseUrl: "https://api.maximilian.dev", token })
 *   if (await flags.isEnabled("META_AGENT_ENABLED")) { ... }
 */

export interface FlagsClientConfig {
  baseUrl: string
  token?: string
  /** Cache TTL in ms; defaults to 5 s. Set to 0 to disable caching. */
  cacheTtlMs?: number
  /** User ID for allowlist / percentage-rollout targeting. */
  userId?: string
}

interface CacheEntry {
  expiresAt: number
  value: boolean
}

export interface FlagInfo {
  name: string
  enabled: boolean
  defaultValue: boolean
  rolloutPercentage?: number
  description?: string
}

export class FlagsClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly cacheTtlMs: number
  private readonly userId?: string
  private readonly cache = new Map<string, CacheEntry>()

  constructor(config: FlagsClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.token = config.token
    this.cacheTtlMs = config.cacheTtlMs ?? 5_000
    this.userId = config.userId
  }

  /** Fetch the current value of a single flag. */
  async isEnabled(name: string): Promise<boolean> {
    const cached = this.cache.get(name)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const params = new URLSearchParams()
    if (this.userId) params.set("userId", this.userId)

    const url = `${this.baseUrl}/api/flags/${encodeURIComponent(name)}${
      params.size > 0 ? `?${params}` : ""
    }`
    const res = await this.fetchJson(url)
    if (res.status === 404) {
      this.cacheMiss(name, false)
      return false
    }
    if (!res.ok) throw new Error(`flag fetch failed: ${res.status}`)
    const data = (await res.json()) as FlagInfo
    this.cacheMiss(name, data.enabled)
    return data.enabled
  }

  /** Bulk-evaluate multiple flags in one round-trip. */
  async evaluate(names: string[]): Promise<Record<string, boolean>> {
    const url = `${this.baseUrl}/api/flags/evaluate`
    const res = await this.fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flagNames: names, userId: this.userId }),
    })
    if (!res.ok) throw new Error(`evaluate failed: ${res.status}`)
    const data = (await res.json()) as { values: Record<string, boolean> }
    for (const [name, value] of Object.entries(data.values)) {
      this.cacheMiss(name, value)
    }
    return data.values
  }

  /** Apply a runtime override (admin only). */
  async override(name: string, value: boolean, reason?: string): Promise<void> {
    const url = `${this.baseUrl}/api/flags/${encodeURIComponent(name)}/override`
    const res = await this.fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value, reason }),
    })
    if (!res.ok) throw new Error(`override failed: ${res.status}`)
    this.cacheMiss(name, value)
  }

  /** Clear a runtime override (admin only). */
  async clearOverride(name: string): Promise<void> {
    const url = `${this.baseUrl}/api/flags/${encodeURIComponent(name)}/override`
    const res = await this.fetchJson(url, { method: "DELETE" })
    if (!res.ok) throw new Error(`clearOverride failed: ${res.status}`)
    this.cache.delete(name)
  }

  /** List all flag definitions. */
  async list(): Promise<FlagInfo[]> {
    const url = `${this.baseUrl}/api/flags`
    const res = await this.fetchJson(url)
    if (!res.ok) throw new Error(`list failed: ${res.status}`)
    const data = (await res.json()) as { flags: FlagInfo[] }
    return data.flags
  }

  private cacheMiss(name: string, value: boolean): void {
    if (this.cacheTtlMs <= 0) return
    this.cache.set(name, { value, expiresAt: Date.now() + this.cacheTtlMs })
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    return fetch(url, { ...init, headers })
  }
}

export function createFlagsClient(config: FlagsClientConfig): FlagsClient {
  return new FlagsClient(config)
}