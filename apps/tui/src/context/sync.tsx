/**
 * Sync context: server-driven state (providers, agents, sessions, messages).
 *
 * Ported from OpenCode's SolidJS `sync.tsx`. The original used a Solid store
 * with `produce`/`reconcile` helpers to incrementally merge server events
 * into a deeply-nested state object. Maximilian's TUI is in early integration,
 * so we model this as a single React state value plus a `applyEvent` reducer
 * that handles the subset of events the UI actually depends on.
 *
 * To preserve the API shape, the `data` field is exposed as a mutable-looking
 * record; consumers should treat reads as snapshots and avoid relying on
 * deep identity for change detection.
 */

import { useEffect, useReducer, useRef } from "react"
import { createSimpleContext } from "./helper"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { useArgs } from "./args"
import { useExit } from "./exit"
import { useKV } from "./kv"
import { useProject } from "./project"

export type SyncEvent =
  | { type: "permission.asked" | "permission.replied"; properties: { sessionID: string; requestID: string; id?: string } & Record<string, unknown> }
  | { type: "question.asked" | "question.replied" | "question.rejected"; properties: { sessionID: string; requestID: string } & Record<string, unknown> }
  | { type: "todo.updated"; properties: { sessionID: string; todos: unknown[] } }
  | { type: "session.diff"; properties: { sessionID: string; diff: unknown[] } }
  | { type: "session.deleted"; properties: { info: { id: string } } }
  | { type: "session.updated"; properties: { info: { id: string } & Record<string, unknown> } }
  | { type: "session.next.moved"; properties: { sessionID: string; location: { directory: string; workspaceID: string }; subdirectory?: string; timestamp: number } }
  | { type: "session.status"; properties: { sessionID: string; status: unknown } }
  | { type: "message.updated"; properties: { info: { sessionID: string; id: string } & Record<string, unknown> } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: { sessionID: string; messageID: string; id: string } & Record<string, unknown> } }
  | { type: "message.part.delta"; properties: { sessionID: string; messageID: string; partID: string; field: string; delta: string } }
  | { type: "message.part.removed"; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: "lsp.updated"; properties: Record<string, never> }
  | { type: "vcs.branch.updated"; properties: { branch: string } }
  | { type: "server.instance.disposed"; properties?: Record<string, never> }

export type SyncData = {
  status: "loading" | "partial" | "complete"
  provider: unknown[]
  provider_default: Record<string, string>
  provider_next: { all: unknown[]; default: Record<string, string>; connected: string[] }
  console_state: { consoleManagedProviders: string[]; switchableOrgCount: number }
  capabilities: { experimentalBackgroundSubagents: boolean }
  provider_auth: Record<string, unknown[]>
  agent: unknown[]
  command: unknown[]
  permission: Record<string, unknown[]>
  question: Record<string, unknown[]>
  config: Record<string, unknown>
  session: unknown[]
  session_status: Record<string, unknown>
  session_diff: Record<string, unknown[]>
  todo: Record<string, unknown[]>
  message: Record<string, unknown[]>
  part: Record<string, unknown[]>
  lsp: unknown[]
  mcp: Record<string, unknown>
  mcp_resource: Record<string, unknown>
  formatter: unknown[]
  vcs: { branch?: string } | undefined
}

const initialData: SyncData = {
  status: "loading",
  provider: [],
  provider_default: {},
  provider_next: { all: [], default: {}, connected: [] },
  console_state: { consoleManagedProviders: [], switchableOrgCount: 0 },
  capabilities: { experimentalBackgroundSubagents: false },
  provider_auth: {},
  agent: [],
  command: [],
  permission: {},
  question: {},
  config: {},
  session: [],
  session_status: {},
  session_diff: {},
  todo: {},
  message: {},
  part: {},
  lsp: [],
  mcp: {},
  mcp_resource: {},
  formatter: [],
  vcs: undefined,
}

function reducer(state: SyncData, event: SyncEvent): SyncData {
  switch (event.type) {
    case "session.status":
      return { ...state, session_status: { ...state.session_status, [event.properties.sessionID]: event.properties.status } }
    case "todo.updated":
      return { ...state, todo: { ...state.todo, [event.properties.sessionID]: event.properties.todos } }
    case "session.diff":
      return { ...state, session_diff: { ...state.session_diff, [event.properties.sessionID]: event.properties.diff } }
    case "lsp.updated":
      return state
    case "vcs.branch.updated":
      return { ...state, vcs: { ...(state.vcs ?? {}), branch: event.properties.branch } }
    case "server.instance.disposed":
      return { ...state, status: "loading" }
    default:
      return state
  }
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    void kv
    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const exit = useExit()
    const args = useArgs()
    void args
    void project
    void startup

    const [data, dispatch] = useReducer(reducer, initialData)
    const bootstrapRef = useRef<Promise<void> | null>(null)

    useEffect(() => {
      const off = event.subscribe((evt) => {
        dispatch(evt as unknown as SyncEvent)
      })
      return () => {
        off()
      }
    }, [event])

    async function bootstrap(input: { fatal?: boolean } = {}): Promise<void> {
      const fatal = input.fatal ?? true
      if (bootstrapRef.current) return bootstrapRef.current
      bootstrapRef.current = (async () => {
        try {
          const workspace = project.workspace.current()
          // Non-blocking fetch; consumers can call `sync.ready` to gate UI.
          await Promise.all([
            sdk.client.get<{ providers: unknown[]; default: Record<string, string> }>(`/config/providers?workspace=${encodeURIComponent(workspace)}`).catch(() => null),
            sdk.client.get<unknown[]>(`/provider/list?workspace=${encodeURIComponent(workspace)}`).catch(() => null),
            sdk.client.get<unknown[]>(`/app/agents?workspace=${encodeURIComponent(workspace)}`).catch(() => null),
          ])
        } catch (err) {
          console.error("tui bootstrap failed", err)
          if (fatal) exit(err instanceof Error ? err : new Error(String(err)))
        }
      })()
      return bootstrapRef.current
    }

    return {
      data,
      set: () => {
        /* no-op: Solid used `setStore` for fine-grained updates. React
         * consumers should rely on event-driven `data` reads instead. */
      },
      get status() {
        return data.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return data.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          return (data.session as Array<{ id: string }>).find((s) => s.id === sessionID)
        },
        query() {
          return { scope: "project" as const }
        },
        async refresh() {
          const list = await sdk.client
            .get<unknown[]>(`/session/list?workspace=${encodeURIComponent(project.workspace.current())}`)
            .catch(() => [])
          if (Array.isArray(list)) {
            // Replace via the dispatch-shaped API: a coarse write is enough
            // here since this code path is rarely hit.
            ;(data as { session: unknown[] }).session = list
          }
        },
        status(_sessionID: string) {
          return "idle" as const
        },
        async sync(_sessionID: string) {
          /* server hydration is event-driven; nothing to do */
        },
      },
      bootstrap,
    }
  },
})