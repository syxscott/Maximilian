import type { Provider } from "@max/providers"
import type { Agent, AgentRole } from "@max/core"
import { FrontendAgent } from "./frontend.js"
import { BackendAgent } from "./backend.js"
import { ReviewAgent } from "./review.js"

export { FrontendAgent } from "./frontend.js"
export { BackendAgent } from "./backend.js"
export { ReviewAgent } from "./review.js"

// Role registry + role-playing (借鉴 ChatDev RoleConfig.json + CAMEL RolePlaying)
export { DefaultRoleRegistry, BUILT_IN_ROLES, type RoleSpec, type RoleRegistry } from "./roles.js"
export {
  RolePlaying,
  type RolePlayOptions,
  type RolePlayMessage,
  type RolePlayTermination,
} from "./role-play.js"

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
  providerRegistry?: Map<string, Provider>,
): (role: AgentRole, preferredProvider?: string) => Agent | undefined {
  return constructAgent(getDefaultProvider, providerRegistry)
}

function constructAgent(
  getDefaultProvider: () => Provider,
  providerRegistry: Map<string, Provider> | undefined,
): (role: AgentRole, preferredProvider?: string) => Agent | undefined {
  return (role, preferredProviderId) => {
    // Resolve provider: try preferred, fall back to default.
    let provider = getDefaultProvider()
    if (preferredProviderId && providerRegistry) {
      const preferred = providerRegistry.get(preferredProviderId)
      if (preferred) {
        provider = preferred
      }
    }

    switch (role) {
      case "frontend":
        return new FrontendAgent(provider)
      case "backend":
        return new BackendAgent(provider)
      case "review":
        return new ReviewAgent(provider)
      case "general":
        return new BackendAgent(provider) // MVP fallback
      default: {
        // "reviewer" from BUILT_IN_ROLES is not in the AgentRole enum.
        const roleStr = role as string
        if (roleStr === "reviewer") return new ReviewAgent(provider)
        return undefined
      }
    }
  }
}

/**
 * Tool-loop-enabled factory (minimax-code borrowing): same role mapping as
 * {@link defaultAgentFactory}, but every agent gets a `ToolEnabledProvider`
 * backed by the PERMISSION-GATED builtin registry — so when the runtime runs
 * with `enableToolLoop: true`, agents execute real tools (bash/read/write/
 * edit/glob/grep) through the multi-round loop, with bash/write/edit prompts
 * surfaced to the human via the permission system and secret paths denied
 * outright. The registry is built ONCE up front (this is why the factory is
 * async) and attached synchronously per agent — no first-task race.
 */
export async function createDefaultAgentFactory(
  getDefaultProvider: () => Provider,
  providerRegistry?: Map<string, Provider>,
): Promise<(role: AgentRole, preferredProvider?: string) => Agent | undefined> {
  const { createPermissionedToolRegistry, ToolEnabledProvider } = await import("@max/core")
  const registry = await createPermissionedToolRegistry()
  const construct = constructAgent(getDefaultProvider, providerRegistry)
  return (role, preferredProviderId) => {
    const agent = construct(role, preferredProviderId)
    if (!agent) return undefined
    // Mirror constructAgent's provider resolution so the tool provider talks
    // to the same provider instance the agent will use for LLM calls.
    agent.setToolProvider(new ToolEnabledProvider(agent.provider, registry))
    return agent
  }
}
