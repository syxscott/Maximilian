/**
 * Event hook: typed subscription to the SDK global event stream.
 *
 * Ported from OpenCode's `context/event.ts`. The original filtered out
 * `sync` events and unwrapped `event.payload`; we mirror that on top of the
 * SDK context defined in `./sdk.tsx`.
 */

import { useSDK, type GlobalEvent } from "./sdk"
import { useProject } from "./project"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

export function useEvent() {
  const sdk = useSDK()
  const project = useProject()

  function subscribe(
    handler: (
      event: { type: string; properties?: Record<string, unknown> },
      metadata: EventMetadata,
    ) => void,
  ) {
    return sdk.event.on("event", (event: GlobalEvent) => {
      if (event.type === "sync") return
      handler(
        { type: event.type, properties: event.properties },
        // Previously this was hardcoded to `""` / `undefined`. That meant
        // every downstream consumer (permission routing, workspace-scoped
        // telemetry, governance filters) thought events came from "nowhere"
        // — they'd drop the event, fall back to global aggregation, or log
        // a confusing "no workspace" warning. Pipe the real SDK directory
        // and project workspace through so multi-tenant routing actually
        // works.
        { directory: sdk.directory ?? "", workspace: project.workspace.current() },
      )
    })
  }

  function on<T extends string>(
    type: T,
    handler: (
      event: { type: T; properties?: Record<string, unknown> },
      metadata: EventMetadata,
    ) => void,
  ) {
    return subscribe((event, metadata) => {
      if (event.type !== type) return
      handler(event as { type: T; properties?: Record<string, unknown> }, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
