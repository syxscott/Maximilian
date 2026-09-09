/**
 * Data context: caches session, project, and location-keyed data fetched
 * from the SDK and refreshed by global events.
 *
 * Ported from OpenCode's SolidJS `data.tsx`. The original used Solid's
 * `createStore` with `produce` for fine-grained mutations. We replicate the
 * surface as a plain React state container; the `produce`-style mutation
 * helpers below mutate a draft object before committing it back to state.
 *
 * The full event-listener surface is preserved so consumers can subscribe
 * to the same event types as in the Solid version.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

type LocationRef = { directory?: string; workspaceID?: string }

type SessionInfo = Record<string, unknown>
type SessionMessage = Record<string, unknown> & { id: string; type: string }
type PermissionRequest = Record<string, unknown>
type QuestionRequest = Record<string, unknown>
type PermissionSaved = Record<string, unknown>
type AgentInfo = Record<string, unknown>
type CommandInfo = Record<string, unknown>
type IntegrationInfo = Record<string, unknown>
type ModelInfo = Record<string, unknown>
type ProviderInfo = { id: string; models: Record<string, { cost?: { input?: number } }> }
type ReferenceInfo = Record<string, unknown>
type SkillInfo = Record<string, unknown>

type LocationData = {
  agent?: AgentInfo[]
  command?: CommandInfo[]
  integration?: IntegrationInfo[]
  model?: ModelInfo[]
  provider?: ProviderInfo[]
  reference?: ReferenceInfo[]
  skill?: SkillInfo[]
}

type DataState = {
  session: {
    info: Record<string, SessionInfo>
    message: Record<string, SessionMessage[]>
    permission: Record<string, PermissionRequest[]>
    question: Record<string, QuestionRequest[]>
  }
  project: {
    permission: Record<string, PermissionSaved[]>
  }
  location: Record<string, LocationData>
}

type DataContextValue = {
  session: {
    get: (sessionID: string) => SessionInfo | undefined
    refresh: (sessionID: string) => Promise<void>
    message: {
      list: (sessionID: string) => SessionMessage[] | undefined
      refresh: (sessionID: string) => Promise<void>
    }
    permission: {
      list: (sessionID: string) => PermissionRequest[] | undefined
      refresh: (sessionID: string) => Promise<void>
    }
    question: {
      list: (sessionID: string) => QuestionRequest[] | undefined
      refresh: (sessionID: string) => Promise<void>
    }
  }
  project: {
    permission: {
      list: (projectID: string) => PermissionSaved[] | undefined
      refresh: (projectID: string) => Promise<void>
    }
  }
  location: {
    default: () => LocationRef
    refresh: (ref?: LocationRef) => Promise<void>
    agent: {
      list: (location?: LocationRef) => AgentInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    command: {
      list: (location?: LocationRef) => CommandInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    integration: {
      list: (location?: LocationRef) => IntegrationInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    model: {
      list: (location?: LocationRef) => ModelInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    provider: {
      list: (location?: LocationRef) => ProviderInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    reference: {
      list: (location?: LocationRef) => ReferenceInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
    skill: {
      list: (location?: LocationRef) => SkillInfo[] | undefined
      refresh: (ref?: LocationRef) => Promise<void>
    }
  }
}

function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

export const { use: useData, provider: DataProvider } = createSimpleContext<
  DataContextValue,
  Record<string, never>
>({
  name: "Data",
  init: () => {
    const sdk = useSDK() as any
    const [store, setStore] = useState<DataState>({
      session: { info: {}, message: {}, permission: {}, question: {} },
      project: { permission: {} },
      location: {},
    })
    const [defaultLocation, setDefaultLocation] = useState<LocationRef>({
      directory: sdk.directory ?? process.cwd(),
    })

    const updateMessage = useCallback(
      (sessionID: string, fn: (draft: SessionMessage[]) => void) => {
        setStore((prev) => {
          const existing = prev.session.message[sessionID] ?? []
          const next = [...existing]
          fn(next)
          return {
            ...prev,
            session: { ...prev.session, message: { ...prev.session.message, [sessionID]: next } },
          }
        })
      },
      [],
    )

    const prependUnique = useCallback((messages: SessionMessage[], item: SessionMessage) => {
      if (messages.some((existing) => existing.id === item.id)) return
      messages.unshift(item)
    }, [])

    const findActiveAssistant = (messages: SessionMessage[]) => {
      const item = messages.find(
        (item) => item.type === "assistant" && !(item as any).time?.completed,
      )
      return item?.type === "assistant" ? item : undefined
    }
    const findAssistant = (messages: SessionMessage[], id: string) => {
      const item = messages.find((item) => item.type === "assistant" && (item as any).id === id)
      return item?.type === "assistant" ? item : undefined
    }
    const findActiveShell = (messages: SessionMessage[], callID: string) => {
      const item = messages.find((item) => item.type === "shell" && (item as any).callID === callID)
      return item?.type === "shell" ? item : undefined
    }
    const latestTool = (assistant: any, callID?: string) =>
      assistant?.content?.findLast?.(
        (item: any) => item.type === "tool" && (callID === undefined || item.id === callID),
      )
    const latestText = (assistant: any, textID: string) =>
      assistant?.content?.findLast?.((item: any) => item.type === "text" && item.id === textID)
    const latestReasoning = (assistant: any, reasoningID: string) =>
      assistant?.content?.findLast?.(
        (item: any) => item.type === "reasoning" && item.id === reasoningID,
      )

    const setLocation = useCallback((key: string, slot: keyof LocationData, value: unknown) => {
      setStore((prev) => {
        const existing = prev.location[key] ?? {}
        const next: LocationData = { ...existing, [slot]: value as never }
        return { ...prev, location: { ...prev.location, [key]: next } }
      })
    }, [])

    const refreshLocation = useCallback(
      async (ref?: LocationRef) => {
        // Maximilian's SDK stub does not implement the `v2` namespace
        // yet. Bail silently when the surface is absent so the data
        // provider mounts and the rest of the TUI keeps working.
        const v2 = sdk.client.v2
        if (!v2?.location?.get) return
        const response = await v2.location.get(
          { location: locationQuery(ref) },
          { throwOnError: true },
        )
        const location = response.data
        const key = locationKey(location)
        setStore((prev) =>
          prev.location[key]
            ? prev
            : { ...prev, location: { ...prev.location, [key]: prev.location[key] ?? {} } },
        )
        if (!ref)
          setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
      },
      [sdk],
    )

    const message = useMemo(
      () => ({
        update(sessionID: string, fn: (draft: SessionMessage[]) => void) {
          updateMessage(sessionID, fn)
        },
        prepend: prependUnique,
        activeAssistant: findActiveAssistant,
        assistant: findAssistant,
        activeShell: findActiveShell,
        latestTool,
        latestText,
        latestReasoning,
      }),
      [updateMessage, prependUnique],
    )

    useEffect(() => {
      const handler = (event: any, metadata: any) => {
        switch (event?.type) {
          case "catalog.updated":
            void Promise.all([
              refreshLocation({ directory: metadata?.directory, workspaceID: metadata?.workspace }),
            ])
            break
          case "session.next.agent.switched":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "agent-switched",
                agent: event.properties.agent,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.model.switched":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "model-switched",
                model: event.properties.model,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.prompted":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "user",
                text: event.properties.prompt.text,
                files: event.properties.prompt.files,
                agents: event.properties.prompt.agents,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.prompt.promoted":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "user",
                text: event.properties.prompt.text,
                files: event.properties.prompt.files,
                agents: event.properties.prompt.agents,
                time: { created: event.properties.timeCreated },
              })
            })
            break
          case "session.next.context.updated":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "system",
                text: event.properties.text,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.synthetic":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "synthetic",
                sessionID: event.properties.sessionID,
                text: event.properties.text,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.shell.started":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "shell",
                callID: event.properties.callID,
                command: event.properties.command,
                output: "",
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.shell.ended":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.activeShell(draft, event.properties.callID)
              if (!match) return
              ;(match as any).output = event.properties.output
              ;((match as any).time ||= {}).completed = event.properties.timestamp
            })
            break
          case "session.next.step.started":
            message.update(event.properties.sessionID, (draft) => {
              if (draft.some((m) => m.id === event.properties.assistantMessageID)) return
              const currentAssistant = message.activeAssistant(draft) as any
              if (currentAssistant) currentAssistant.time.completed = event.properties.timestamp
              message.prepend(draft, {
                id: event.properties.assistantMessageID,
                type: "assistant",
                agent: event.properties.agent,
                model: event.properties.model,
                content: [],
                snapshot: event.properties.snapshot
                  ? { start: event.properties.snapshot }
                  : undefined,
                time: { created: event.properties.timestamp },
              })
            })
            break
          case "session.next.step.ended":
            message.update(event.properties.sessionID, (draft) => {
              const currentAssistant = message.assistant(
                draft,
                event.properties.assistantMessageID,
              ) as any
              if (!currentAssistant) return
              currentAssistant.time.completed = event.properties.timestamp
              currentAssistant.finish = event.properties.finish
              currentAssistant.cost = event.properties.cost
              currentAssistant.tokens = event.properties.tokens
              if (event.properties.snapshot) {
                currentAssistant.snapshot = {
                  ...currentAssistant.snapshot,
                  end: event.properties.snapshot,
                }
              }
            })
            break
          case "session.next.step.failed":
            message.update(event.properties.sessionID, (draft) => {
              const currentAssistant = message.assistant(
                draft,
                event.properties.assistantMessageID,
              ) as any
              if (!currentAssistant) return
              currentAssistant.time.completed = event.properties.timestamp
              currentAssistant.finish = "error"
              currentAssistant.error = event.properties.error
            })
            break
          case "session.next.text.started":
            message.update(event.properties.sessionID, (draft) => {
              const target = message.assistant(draft, event.properties.assistantMessageID) as any
              target?.content.push({ type: "text", id: event.properties.textID, text: "" })
            })
            break
          case "session.next.text.delta":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestText(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.textID,
              )
              if (match) match.text += event.properties.delta
            })
            break
          case "session.next.text.ended":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestText(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.textID,
              )
              if (match) match.text = event.properties.text
            })
            break
          case "session.next.tool.input.started":
            message.update(event.properties.sessionID, (draft) => {
              const target = message.assistant(draft, event.properties.assistantMessageID) as any
              target?.content.push({
                type: "tool",
                id: event.properties.callID,
                name: event.properties.name,
                time: { created: event.properties.timestamp },
                state: { status: "pending", input: "" },
              })
            })
            break
          case "session.next.tool.input.delta":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (match?.state?.status === "pending") match.state.input += event.properties.delta
            })
            break
          case "session.next.tool.input.ended":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (match?.state?.status === "pending") match.state.input = event.properties.text
            })
            break
          case "session.next.tool.called":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (!match) return
              match.time.ran = event.properties.timestamp
              match.provider = event.properties.provider
              match.state = {
                status: "running",
                input: event.properties.input,
                structured: {},
                content: [],
              }
            })
            break
          case "session.next.tool.progress":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (match?.state?.status !== "running") return
              match.state.structured = event.properties.structured
              match.state.content = [...event.properties.content]
            })
            break
          case "session.next.tool.success":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (match?.state?.status !== "running") return
              // Tolerate missing `provider` on the event envelope so a
              // partial sync doesn't crash the data reducer (which runs
              // inside a setStore updater and so would unmount the
              // entire React tree).
              const providerPayload =
                (event.properties.provider as
                  { executed?: unknown; metadata?: unknown } | undefined) ?? {}
              match.state = {
                status: "completed",
                input: match.state.input,
                structured: event.properties.structured,
                content: [...event.properties.content],
                result: event.properties.result,
              }
              match.provider = {
                executed: providerPayload.executed === true || match.provider?.executed === true,
                metadata: match.provider?.metadata,
                resultMetadata: providerPayload.metadata,
              }
              match.time.completed = event.properties.timestamp
            })
            break
          case "session.next.tool.failed":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestTool(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.callID,
              )
              if (!match || (match.state.status !== "pending" && match.state.status !== "running"))
                return
              // Read provider through a tolerant guard. The OpenCode SDK
              // event envelope sometimes omits `provider` for partial
              // syncs; dereferencing it without a guard crashes the data
              // reducer, which is called inside a setStore updater and
              // so unmounts the entire React tree.
              const providerPayload =
                (event.properties.provider as
                  { executed?: unknown; metadata?: unknown } | undefined) ?? {}
              match.state = {
                status: "error",
                error: event.properties.error,
                input: typeof match.state.input === "string" ? {} : match.state.input,
                structured: match.state.status === "running" ? match.state.structured : {},
                content: match.state.status === "running" ? match.state.content : [],
                result: event.properties.result,
              }
              match.provider = {
                executed: providerPayload.executed === true || match.provider?.executed === true,
                metadata: match.provider?.metadata,
                resultMetadata: providerPayload.metadata,
              }
              match.time.completed = event.properties.timestamp
            })
            break
          case "session.next.reasoning.started":
            message.update(event.properties.sessionID, (draft) => {
              const target = message.assistant(draft, event.properties.assistantMessageID) as any
              target?.content.push({
                type: "reasoning",
                id: event.properties.reasoningID,
                text: "",
                providerMetadata: event.properties.providerMetadata,
              })
            })
            break
          case "session.next.reasoning.delta":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestReasoning(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.reasoningID,
              )
              if (match) match.text += event.properties.delta
            })
            break
          case "session.next.reasoning.ended":
            message.update(event.properties.sessionID, (draft) => {
              const match = message.latestReasoning(
                message.assistant(draft, event.properties.assistantMessageID) as any,
                event.properties.reasoningID,
              )
              if (match) {
                match.text = event.properties.text
                if (event.properties.providerMetadata !== undefined) {
                  match.providerMetadata = event.properties.providerMetadata
                }
              }
            })
            break
          case "session.next.compaction.ended":
            message.update(event.properties.sessionID, (draft) => {
              message.prepend(draft, {
                id: event.properties.messageID,
                type: "compaction",
                reason: event.properties.reason,
                summary: event.properties.text,
                recent: event.properties.recent,
                time: { created: event.properties.timestamp },
              })
            })
            break
          default:
            break
        }
      }
      const unsub = sdk.event?.on?.("event", handler as any)
      return () => {
        if (typeof unsub === "function") unsub()
      }
    }, [sdk, message, refreshLocation])

    useEffect(() => {
      void Promise.allSettled([refreshLocation()]).then((settled) => {
        for (const failure of settled.filter((item) => item.status === "rejected")) {
          console.error("Failed to refresh default location data", failure.reason)
        }
      })
    }, [refreshLocation])

    const listAt = <T,>(slot: keyof LocationData, location?: LocationRef): T[] | undefined => {
      const key = locationKey(location ?? defaultLocation)
      return store.location[key]?.[slot] as T[] | undefined
    }

    const refreshAt = useCallback(
      async (
        slot: keyof LocationData,
        fetcher: () => Promise<{ data: { location: LocationRef } & any } | undefined>,
      ) => {
        // A fetcher may return undefined when the SDK stub lacks the v2
        // surface — bail instead of dereferencing `.data` of undefined.
        const result = await fetcher()
        if (!result?.data?.location) return
        const key = locationKey(result.data.location)
        setLocation(key, slot, result.data.data)
      },
      [setLocation],
    )

    return {
      session: {
        get: (sessionID: string) => store.session.info[sessionID],
        refresh: async (sessionID: string) => {
          if (!sdk.client.v2?.session?.get) return
          const result = await sdk.client.v2.session.get({ sessionID }, { throwOnError: true })
          setStore((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              info: { ...prev.session.info, [sessionID]: result.data.data },
            },
          }))
        },
        message: {
          list: (sessionID: string) => store.session.message[sessionID],
          refresh: async (sessionID: string) => {
            if (!sdk.client.v2?.session?.messages) return
            const result = await sdk.client.v2.session.messages(
              { sessionID },
              { throwOnError: true },
            )
            setStore((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                message: { ...prev.session.message, [sessionID]: result.data.data },
              },
            }))
          },
        },
        permission: {
          list: (sessionID: string) => store.session.permission[sessionID],
          refresh: async (sessionID: string) => {
            if (!sdk.client.v2?.session?.permission?.list) return
            const result = await sdk.client.v2.session.permission.list(
              { sessionID },
              { throwOnError: true },
            )
            setStore((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                permission: { ...prev.session.permission, [sessionID]: result.data.data },
              },
            }))
          },
        },
        question: {
          list: (sessionID: string) => store.session.question[sessionID],
          refresh: async (sessionID: string) => {
            if (!sdk.client.v2?.session?.question?.list) return
            const result = await sdk.client.v2.session.question.list(
              { sessionID },
              { throwOnError: true },
            )
            setStore((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                question: { ...prev.session.question, [sessionID]: result.data.data },
              },
            }))
          },
        },
      },
      project: {
        permission: {
          list: (projectID: string) => store.project.permission[projectID],
          refresh: async (projectID: string) => {
            if (!sdk.client.v2?.permission?.saved?.list) return
            const result = await sdk.client.v2.permission.saved.list(
              { projectID },
              { throwOnError: true },
            )
            setStore((prev) => ({
              ...prev,
              project: {
                ...prev.project,
                permission: { ...prev.project.permission, [projectID]: result.data.data },
              },
            }))
          },
        },
      },
      location: {
        default: () => defaultLocation,
        refresh: refreshLocation,
        agent: {
          list: (location?: LocationRef) => listAt<AgentInfo>("agent", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("agent", async () => {
              if (!sdk.client.v2?.agent?.list) return undefined
              return sdk.client.v2.agent.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        command: {
          list: (location?: LocationRef) => listAt<CommandInfo>("command", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("command", async () => {
              if (!sdk.client.v2?.command?.list) return undefined
              return sdk.client.v2.command.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        integration: {
          list: (location?: LocationRef) => listAt<IntegrationInfo>("integration", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("integration", async () => {
              if (!sdk.client.v2?.integration?.list) return undefined
              return sdk.client.v2.integration.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        model: {
          list: (location?: LocationRef) => listAt<ModelInfo>("model", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("model", async () => {
              if (!sdk.client.v2?.model?.list) return undefined
              return sdk.client.v2.model.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        provider: {
          list: (location?: LocationRef) => listAt<ProviderInfo>("provider", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("provider", async () => {
              if (!sdk.client.v2?.provider?.list) return undefined
              return sdk.client.v2.provider.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        reference: {
          list: (location?: LocationRef) => listAt<ReferenceInfo>("reference", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("reference", async () => {
              if (!sdk.client.v2?.reference?.list) return undefined
              return sdk.client.v2.reference.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
        skill: {
          list: (location?: LocationRef) => listAt<SkillInfo>("skill", location),
          refresh: (ref?: LocationRef) =>
            refreshAt("skill", async () => {
              if (!sdk.client.v2?.skill?.list) return undefined
              return sdk.client.v2.skill.list(
                { location: locationQuery(ref) },
                { throwOnError: true },
              )
            }),
        },
      },
    }
  },
})
