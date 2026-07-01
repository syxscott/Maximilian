/**
 * Lightweight dependency injection container (OpenHands Injector pattern).
 *
 * Supports singleton and transient lifecycle. Factories receive the
 * container itself so they can resolve their own dependencies.
 *
 * Usage:
 *   const container = new Container()
 *   container.register("db", () => createDb(url), "singleton")
 *   container.register("logger", () => getLogger("app"), "singleton")
 *   container.register("userService", (c) => new UserService(c.resolve("db")), "transient")
 *
 *   const db = container.resolve<Db>("db")     // same instance every time
 *   const svc = container.resolve<UserService>("userService")  // new instance each time
 */

export type Lifecycle = "singleton" | "transient"

interface Registration<T = unknown> {
  factory: (container: Container) => T
  lifecycle: Lifecycle
  instance?: T
}

export class Container {
  private readonly registry = new Map<string, Registration>()

  /**
   * Register a factory for the given token.
   * `singleton` — created once on first resolve, then cached.
   * `transient` — new instance on every resolve.
   */
  register<T>(token: string, factory: (c: Container) => T, lifecycle: Lifecycle = "singleton"): void {
    this.registry.set(token, { factory, lifecycle } as Registration<T>)
  }

  /**
   * Resolve an instance by token. Throws if the token is not registered.
   */
  resolve<T>(token: string): T {
    const reg = this.registry.get(token)
    if (!reg) throw new Error(`[DI] token "${token}" not registered`)

    if (reg.lifecycle === "singleton") {
      if (reg.instance === undefined) {
        reg.instance = reg.factory(this)
      }
      return reg.instance as T
    }

    // transient
    return reg.factory(this) as T
  }

  /**
   * Try to resolve; return undefined if not registered.
   */
  tryResolve<T>(token: string): T | undefined {
    try {
      return this.resolve<T>(token)
    } catch {
      return undefined
    }
  }

  /**
   * Check if a token is registered.
   */
  has(token: string): boolean {
    return this.registry.has(token)
  }

  /**
   * Override an existing registration (useful for testing).
   * Creates the registration if it doesn't exist.
   */
  override<T>(token: string, factory: (c: Container) => T, lifecycle: Lifecycle = "singleton"): void {
    this.registry.set(token, { factory, lifecycle } as Registration<T>)
  }

  /**
   * Create a child container that inherits the parent's registrations.
   * Overrides in the child do not affect the parent.
   */
  child(): Container {
    const child = new Container()
    for (const [token, reg] of this.registry) {
      child.registry.set(token, { ...reg })
    }
    return child
  }

  /**
   * Reset all registrations (for testing).
   */
  clear(): void {
    this.registry.clear()
  }
}

/**
 * Pre-defined tokens for common dependencies.
 * Using string constants avoids typos and enables autocomplete.
 */
export const TOKENS = {
  DB: "db",
  LOGGER: "logger",
  PROVIDER_REGISTRY: "providerRegistry",
  WORKSPACE_STORE: "workspaceStore",
  METRICS_STORE: "metricsStore",
  EXECUTION_STORE: "executionStore",
  EVOLUTION_FACADE: "evolutionFacade",
  MODEL_ROUTER: "modelRouter",
  JWT_SECRET: "jwtSecret",
  CONFIG: "config",
} as const
