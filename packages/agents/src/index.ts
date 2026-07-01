import type { Provider } from "@max/providers";
import type { Agent, AgentRole } from "@max/core";
import { FrontendAgent } from "./frontend.js";
import { BackendAgent } from "./backend.js";
import { ReviewAgent } from "./review.js";

export { FrontendAgent } from "./frontend.js";
export { BackendAgent } from "./backend.js";
export { ReviewAgent } from "./review.js";

/**
 * Default agent factory used by the runtime.
 * Add new roles here; Commander will reference them by role string.
 *
 * @param getDefaultProvider - Getter function that returns the current default provider.
 *   This supports runtime changes to the default provider (dynamic switching).
 * @param providerRegistry - Optional map of provider ID → Provider for dynamic model selection.
 */
export function defaultAgentFactory(
  getDefaultProvider: () => Provider,
  providerRegistry?: Map<string, Provider>
): (role: AgentRole, preferredProvider?: string) => Agent | undefined {
  return (role, preferredProviderId) => {
    // Resolve provider: try preferred, fall back to default.
    let provider = getDefaultProvider();
    if (preferredProviderId && providerRegistry) {
      const preferred = providerRegistry.get(preferredProviderId);
      if (preferred) {
        provider = preferred;
      }
    }

    switch (role) {
      case "frontend":
        return new FrontendAgent(provider);
      case "backend":
        return new BackendAgent(provider);
      case "review":
        return new ReviewAgent(provider);
      case "general":
        return new BackendAgent(provider); // MVP fallback
      default:
        return undefined;
    }
  };
}