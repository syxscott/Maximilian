/**
 * Public surface for the presets module.
 *
 * Consumers (registry, dashboard, CLI) should import from here, not from
 * individual files. Keeps the module graph stable when we shuffle internals.
 */

export type {
  ApiFormat,
  ProviderCategory,
  ProviderPreset,
} from "./types.js"

export {
  PROVIDER_PRESETS,
  PROVIDER_PRESETS_BY_ID,
  VISIBLE_PROVIDER_PRESETS,
} from "./data.js"

import { PROVIDER_PRESETS_BY_ID } from "./data.js"

/** Look up a preset by id. Returns undefined for unknown ids. */
export function getProviderPreset(id: string) {
  return PROVIDER_PRESETS_BY_ID.get(id)
}