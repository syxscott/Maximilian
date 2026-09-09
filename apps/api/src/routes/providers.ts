import type { Context } from "hono";
import { type ProviderRegistry, getProviderPreset } from "@max/providers";

export function listProviders(registry: ProviderRegistry) {
  return async (c: Context) => {
    // Augment each registered provider with its `category` from the static
    // preset catalog so the dashboard can render its category badge without
    // an extra round-trip per provider. `modelVariants` / failover status
    // are NOT included here — those have dedicated endpoints
    // (`/system/providers/{id}/model`) and live state on the failover queue.
    // Returns `undefined` for unknown ids so the schema stays valid.
    const providers = registry.list().map((p) => {
      const preset = getProviderPreset(p.id);
      return {
        id: p.id,
        name: p.name,
        defaultModel: p.defaultModel,
        configured: p.isConfigured(),
        category: preset?.category,
      };
    });
    return c.json({ providers, default: registry.default()?.id });
  };
}