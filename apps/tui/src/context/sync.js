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
const initialData = {
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
function reducer(state, event) {
  switch (event.type) {
    case "session.status":
      return {
        ...state,
        session_status: {
          ...state.session_status,
          [event.properties.sessionID]: event.properties.status,
        },
      }
    case "todo.updated":
      return {
        ...state,
        todo: { ...state.todo, [event.properties.sessionID]: event.properties.todos },
      }
    case "session.diff":
      return {
        ...state,
        session_diff: {
          ...state.session_diff,
          [event.properties.sessionID]: event.properties.diff,
        },
      }
    case "lsp.updated":
      return state
    case "vcs.branch.updated":
      return { ...state, vcs: { ...(state.vcs ?? {}), branch: event.properties.branch } }
    case "server.instance.disposed":
      return { ...state, status: "loading" }
    // Internal event used by `session.refresh()` so the new list actually
    // flows through React instead of being silently mutated into state.
    // The previous version assigned `(data as ...).session = list` directly
    // on the reducer state, which bypassed React's change detection — the
    // UI kept rendering the old session list forever.
    case "session.list":
      return { ...state, session: event.sessions }
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
    const bootstrapRef = useRef(null)
    const dispatchRef = useRef(dispatch)
    dispatchRef.current = dispatch
    useEffect(() => {
      const off = event.subscribe((evt) => {
        dispatch(evt)
      })
      return () => {
        // The default SDK emitter's `on` returns void (no unsubscribe);
        // the in-memory bus's `subscribe` returns a teardown. Guard
        // before calling so provider unmount doesn't crash the tree.
        if (typeof off === "function") off()
      }
    }, [event])
    async function bootstrap(input = {}) {
      const fatal = input.fatal ?? true
      if (bootstrapRef.current) return bootstrapRef.current
      bootstrapRef.current = (async () => {
        try {
          const workspace = project.workspace.current()
          // Non-blocking fetch; consumers can call `sync.ready` to gate UI.
          await Promise.all([
            sdk.client
              .get(`/config/providers?workspace=${encodeURIComponent(workspace)}`)
              .catch(() => null),
            sdk.client
              .get(`/provider/list?workspace=${encodeURIComponent(workspace)}`)
              .catch(() => null),
            sdk.client
              .get(`/app/agents?workspace=${encodeURIComponent(workspace)}`)
              .catch(() => null),
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
        get(sessionID) {
          return data.session.find((s) => s.id === sessionID)
        },
        query() {
          return { scope: "project" }
        },
        async refresh() {
          const list = await sdk.client
            .get(`/session/list?workspace=${encodeURIComponent(project.workspace.current())}`)
            .catch(() => [])
          if (Array.isArray(list)) {
            // Flow through the reducer instead of mutating state in place
            // so React picks up the change. dispatchRef avoids re-creating
            // this callback on every state update (which would invalidate
            // every consumer's effect that depends on the sync object).
            dispatchRef.current({ type: "session.list", sessions: list })
          }
        },
        status(_sessionID) {
          return "idle"
        },
        async sync(_sessionID) {
          /* server hydration is event-driven; nothing to do */
        },
      },
      bootstrap,
    }
  },
})
