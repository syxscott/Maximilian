/**
 * Plugin System — extensible runtime hooks (opencode pattern).
 *
 * Plugins can hook into lifecycle events without modifying core code.
 * Each plugin declares which hooks it wants; the PluginManager dispatches
 * events to all registered plugins in order.
 *
 * Usage:
 *   const pm = new PluginManager()
 *   pm.register({
 *     name: "telemetry",
 *     hooks: {
 *       "task-start": (ctx) => telemetry.recordStart(ctx.taskId),
 *       "task-end": (ctx) => telemetry.recordEnd(ctx.taskId, ctx.duration),
 *     },
 *   })
 *   await pm.dispatch("task-start", { taskId: "t1", workspaceId: "ws-1" })
 */

export interface PluginContext {
  [key: string]: unknown
}

export type HookFn = (ctx: PluginContext) => void | Promise<void>

export interface Plugin {
  /** Unique plugin name. */
  name: string
  /** Hooks this plugin wants to receive. */
  hooks: Partial<Record<HookName, HookFn>>
  /** Optional: called once when the plugin is registered. */
  onInit?: () => void | Promise<void>
  /** Optional: called when the plugin is unregistered. */
  onDispose?: () => void | Promise<void>
}

export type HookName =
  | "task-start"
  | "task-end"
  | "task-failed"
  | "workspace-created"
  | "workspace-completed"
  | "tool-start"
  | "tool-end"
  | "plan-created"
  | "error"

export class PluginManager {
  private plugins = new Map<string, Plugin>()
  private hooks = new Map<HookName, Set<Plugin>>()

  /** Register a plugin. Throws if a plugin with the same name exists. */
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`plugin "${plugin.name}" already registered`)
    }
    this.plugins.set(plugin.name, plugin)

    // Index hooks
    for (const hookName of Object.keys(plugin.hooks) as HookName[]) {
      let set = this.hooks.get(hookName)
      if (!set) {
        set = new Set()
        this.hooks.set(hookName, set)
      }
      set.add(plugin)
    }

    await plugin.onInit?.()
  }

  /** Unregister a plugin by name. */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) return

    // Remove from hook index
    for (const set of this.hooks.values()) {
      set.delete(plugin)
    }

    await plugin.onDispose?.()
    this.plugins.delete(name)
  }

  /**
   * Dispatch an event to all plugins that registered for this hook.
   * Plugins are called in registration order. Errors in one plugin
   * do not prevent others from running.
   */
  async dispatch(hookName: HookName, ctx: PluginContext): Promise<void> {
    const plugins = this.hooks.get(hookName)
    if (!plugins || plugins.size === 0) return

    const errors: Error[] = []
    for (const plugin of plugins) {
      try {
        const fn = plugin.hooks[hookName]
        if (fn) await fn(ctx)
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }

    if (errors.length > 0) {
      // Aggregate errors but don't throw — log them
      for (const err of errors) {
        console.error(`[PluginManager] plugin error in "${hookName}":`, err.message)
      }
    }
  }

  /** Check if a plugin is registered. */
  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /** Get all registered plugin names. */
  getNames(): string[] {
    return [...this.plugins.keys()]
  }

  /** Clear all plugins (for testing). */
  async clear(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.onDispose?.()
    }
    this.plugins.clear()
    this.hooks.clear()
  }
}
