import type { Context } from "hono";
import type { ProviderRegistry } from "@max/providers";

export function listProviders(registry: ProviderRegistry) {
  return async (c: Context) => {
    const providers = registry.list().map((p) => ({
      id: p.id,
      name: p.name,
      defaultModel: p.defaultModel,
      configured: p.isConfigured(),
    }));
    return c.json({ providers, default: registry.default()?.id });
  };
}