/**
 * Settings cascade — merge `user`, `project`, and `session` overrides.
 *
 * Inspired by OpenHands' Settings cascade: configuration is layered, and
 * a more-specific layer wins. The merge order is "later overrides earlier":
 *   defaults → user → project → session
 *
 * Every layer is a `Record<string, unknown>` of plain values; no
 * per-key typing is enforced (callers wrap with Zod when they need
 * validation). For nested objects we recurse one level; primitive and
 * array values replace wholesale.
 */

export type SettingsLayer = Record<string, unknown>

/**
 * Merge `overrides` into `base` with `overrides` winning. Object values
 * are recursed; arrays and primitives are replaced wholesale. Returns a
 * new object — does not mutate either input.
 */
export function mergeSettings(
  base: SettingsLayer,
  overrides: SettingsLayer | undefined,
): SettingsLayer {
  if (!overrides) return { ...base }
  const out: SettingsLayer = { ...base }
  for (const key of Object.keys(overrides)) {
    const incoming = overrides[key]
    const existing = out[key]
    if (
      incoming !== null &&
      typeof incoming === "object" &&
      !Array.isArray(incoming) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = mergeSettings(existing as SettingsLayer, incoming as SettingsLayer)
    } else {
      out[key] = incoming
    }
  }
  return out
}

/**
 * Apply the full cascade `defaults → user → project → session`. Each
 * layer is optional; missing layers are treated as empty objects.
 */
export function cascadeSettings(
  defaults: SettingsLayer,
  user?: SettingsLayer,
  project?: SettingsLayer,
  session?: SettingsLayer,
): SettingsLayer {
  return mergeSettings(mergeSettings(mergeSettings(defaults, user), project), session)
}

/**
 * Resolve a single key by walking the cascade from most-specific to
 * least-specific. Returns the first defined value (or `defaultValue`).
 */
export function resolveSetting<T = unknown>(
  key: string,
  ...layers: Array<SettingsLayer | undefined>
): T | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer && key in layer) return layer[key] as T
  }
  return undefined
}