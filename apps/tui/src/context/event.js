/**
 * Event hook: typed subscription to the SDK global event stream.
 *
 * Ported from OpenCode's `context/event.ts`. The original filtered out
 * `sync` events and unwrapped `event.payload`; we mirror that on top of the
 * SDK context defined in `./sdk.tsx`.
 */
import { useSDK } from "./sdk"
import { useProject } from "./project"
export function useEvent() {
  const sdk = useSDK()
  const project = useProject()
  function subscribe(handler) {
    return sdk.event.on("event", (event) => {
      if (event.type === "sync") return
      handler(
        { type: event.type, properties: event.properties },
        // Previously this was hardcoded to `""` / `undefined`. Pipe the real
        // SDK directory and project workspace through so consumers receive
        // accurate metadata instead of "nowhere". Note: nothing currently
        // sets `workspace` in the project context, so the field is still
        // `undefined` in practice — the directory is the only meaningful
        // value today, kept for future workspace-scoped consumers.
        { directory: sdk.directory ?? "", workspace: project.workspace.current() },
      )
    })
  }
  function on(type, handler) {
    return subscribe((event, metadata) => {
      if (event.type !== type) return
      handler(event, metadata)
    })
  }
  return {
    subscribe,
    on,
  }
}
