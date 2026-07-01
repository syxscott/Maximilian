/**
 * Route context: top-level navigation state for the TUI.
 *
 * Ported from OpenCode's SolidJS `route.tsx`. Routes are one of:
 *   - { type: "home" }
 *   - { type: "session", sessionID }
 *   - { type: "plugin", id, data? }
 *
 * Optional `prompt` payloads ride along so the receiving route can seed its
 * prompt input. We model them as `unknown` to avoid pulling in the
 * PromptInfo shape from `prompt/history.tsx`.
 */

import { useState, useCallback } from "react"
import { createSimpleContext } from "./helper"
import { useTuiStartup } from "./runtime"

export type HomeRoute = {
  type: "home"
  prompt?: unknown
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  prompt?: unknown
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type Route = HomeRoute | SessionRoute | PluginRoute

function initialRoute(value: unknown): Route | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) return
  const v = value as { type: unknown } & Record<string, unknown>
  if (v.type === "home") return { type: "home" }
  if (v.type === "session" && typeof v.sessionID === "string") {
    return { type: "session", sessionID: v.sessionID }
  }
  if (v.type === "plugin" && typeof v.id === "string") {
    return { type: "plugin", id: v.id }
  }
  return
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { initialRoute?: Route }) => {
    const startup = useTuiStartup()
    const [data, setData] = useState<Route>(props.initialRoute ?? initialRoute(startup.initialRoute) ?? { type: "home" })

    const navigate = useCallback((next: Route) => {
      setData(next)
    }, [])

    return {
      data,
      navigate,
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T): Extract<Route, { type: T }> {
  const route = useRoute()
  if (route.data.type !== type) {
    throw new Error(`useRouteData<${type}> called on route of type ${route.data.type}`)
  }
  return route.data as Extract<Route, { type: T }>
}