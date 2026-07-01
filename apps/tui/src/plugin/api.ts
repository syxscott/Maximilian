// @ts-nocheck
import type { TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"

type RouteEntry = {
  key: symbol
  render: TuiRouteDefinition["render"]
}

export type RouteMap = Map<string, RouteEntry[]>

export function createPluginRoutes() {
  const routes: RouteMap = new Map()
  // React consumers re-render when the routes identity changes; we use a
  // version counter wrapped in a state holder so callers can subscribe to
  // route registrations/deregistrations the same way the Solid version did.
  let revision = 0
  const revisionState: { current: number } = {
    get current() {
      return revision
    },
  }
  const setRevision = (value: number | ((prev: number) => number)) => {
    revision = typeof value === "function" ? (value as (prev: number) => number)(revision) : value
    revisionState.current = revision
  }

  return {
    revision: revisionState,
    register(list: TuiRouteDefinition[]) {
      const key = Symbol()
      list.forEach((item) =>
        routes.set(item.name, [...(routes.get(item.name) ?? []), { key, render: item.render }]),
      )
      setRevision((value) => value + 1)

      return () => {
        list.forEach((item) => {
          const next = routes.get(item.name)?.filter((entry) => entry.key !== key) ?? []
          if (next.length) {
            routes.set(item.name, next)
            return
          }
          routes.delete(item.name)
        })
        setRevision((value) => value + 1)
      }
    },
    get(name: string) {
      return routes.get(name)?.at(-1)?.render
    },
  }
}

export type PluginRoutes = ReturnType<typeof createPluginRoutes>

export function createTuiApi(input: Omit<TuiPluginApi, "lifecycle">): TuiPluginApi {
  return {
    ...input,
    lifecycle: {
      signal: new AbortController().signal,
      onDispose() {
        return () => {}
      },
    },
  }
}
