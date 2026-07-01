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
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSimpleContext } from "./helper";
import { useSDK } from "./sdk";
function locationKey(location) {
    return JSON.stringify([location.directory, location.workspaceID]);
}
function locationQuery(ref) {
    return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined;
}
export const { use: useData, provider: DataProvider } = createSimpleContext({
    name: "Data",
    init: () => {
        const sdk = useSDK();
        const [store, setStore] = useState({
            session: { info: {}, message: {}, permission: {}, question: {} },
            project: { permission: {} },
            location: {},
        });
        const [defaultLocation, setDefaultLocation] = useState({
            directory: sdk.directory ?? process.cwd(),
        });
        const updateMessage = useCallback((sessionID, fn) => {
            setStore((prev) => {
                const existing = prev.session.message[sessionID] ?? [];
                const next = [...existing];
                fn(next);
                return {
                    ...prev,
                    session: { ...prev.session, message: { ...prev.session.message, [sessionID]: next } },
                };
            });
        }, []);
        const prependUnique = useCallback((messages, item) => {
            if (messages.some((existing) => existing.id === item.id))
                return;
            messages.unshift(item);
        }, []);
        const findActiveAssistant = (messages) => {
            const item = messages.find((item) => item.type === "assistant" && !item.time?.completed);
            return item?.type === "assistant" ? item : undefined;
        };
        const findAssistant = (messages, id) => {
            const item = messages.find((item) => item.type === "assistant" && item.id === id);
            return item?.type === "assistant" ? item : undefined;
        };
        const findActiveShell = (messages, callID) => {
            const item = messages.find((item) => item.type === "shell" && item.callID === callID);
            return item?.type === "shell" ? item : undefined;
        };
        const latestTool = (assistant, callID) => assistant?.content?.findLast?.((item) => item.type === "tool" && (callID === undefined || item.id === callID));
        const latestText = (assistant, textID) => assistant?.content?.findLast?.((item) => item.type === "text" && item.id === textID);
        const latestReasoning = (assistant, reasoningID) => assistant?.content?.findLast?.((item) => item.type === "reasoning" && item.id === reasoningID);
        const setLocation = useCallback((key, slot, value) => {
            setStore((prev) => {
                const existing = prev.location[key] ?? {};
                const next = { ...existing, [slot]: value };
                return { ...prev, location: { ...prev.location, [key]: next } };
            });
        }, []);
        const refreshLocation = useCallback(async (ref) => {
            const response = await sdk.client.v2.location
                .get({ location: locationQuery(ref) }, { throwOnError: true });
            const location = response.data;
            const key = locationKey(location);
            setStore((prev) => prev.location[key]
                ? prev
                : { ...prev, location: { ...prev.location, [key]: prev.location[key] ?? {} } });
            if (!ref)
                setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID });
        }, [sdk]);
        const message = useMemo(() => ({
            update(sessionID, fn) {
                updateMessage(sessionID, fn);
            },
            prepend: prependUnique,
            activeAssistant: findActiveAssistant,
            assistant: findAssistant,
            activeShell: findActiveShell,
            latestTool,
            latestText,
            latestReasoning,
        }), [updateMessage, prependUnique]);
        useEffect(() => {
            const handler = (event, metadata) => {
                switch (event?.type) {
                    case "catalog.updated":
                        void Promise.all([
                            refreshLocation({ directory: metadata?.directory, workspaceID: metadata?.workspace }),
                        ]);
                        break;
                    case "session.next.agent.switched":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "agent-switched",
                                agent: event.properties.agent,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.model.switched":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "model-switched",
                                model: event.properties.model,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.prompted":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "user",
                                text: event.properties.prompt.text,
                                files: event.properties.prompt.files,
                                agents: event.properties.prompt.agents,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.prompt.promoted":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "user",
                                text: event.properties.prompt.text,
                                files: event.properties.prompt.files,
                                agents: event.properties.prompt.agents,
                                time: { created: event.properties.timeCreated },
                            });
                        });
                        break;
                    case "session.next.context.updated":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "system",
                                text: event.properties.text,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.synthetic":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "synthetic",
                                sessionID: event.properties.sessionID,
                                text: event.properties.text,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.shell.started":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "shell",
                                callID: event.properties.callID,
                                command: event.properties.command,
                                output: "",
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.shell.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.activeShell(draft, event.properties.callID);
                            if (!match)
                                return;
                            match.output = event.properties.output;
                            (match.time ||= {}).completed = event.properties.timestamp;
                        });
                        break;
                    case "session.next.step.started":
                        message.update(event.properties.sessionID, (draft) => {
                            if (draft.some((m) => m.id === event.properties.assistantMessageID))
                                return;
                            const currentAssistant = message.activeAssistant(draft);
                            if (currentAssistant)
                                currentAssistant.time.completed = event.properties.timestamp;
                            message.prepend(draft, {
                                id: event.properties.assistantMessageID,
                                type: "assistant",
                                agent: event.properties.agent,
                                model: event.properties.model,
                                content: [],
                                snapshot: event.properties.snapshot ? { start: event.properties.snapshot } : undefined,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    case "session.next.step.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            const currentAssistant = message.assistant(draft, event.properties.assistantMessageID);
                            if (!currentAssistant)
                                return;
                            currentAssistant.time.completed = event.properties.timestamp;
                            currentAssistant.finish = event.properties.finish;
                            currentAssistant.cost = event.properties.cost;
                            currentAssistant.tokens = event.properties.tokens;
                            if (event.properties.snapshot) {
                                currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.properties.snapshot };
                            }
                        });
                        break;
                    case "session.next.step.failed":
                        message.update(event.properties.sessionID, (draft) => {
                            const currentAssistant = message.assistant(draft, event.properties.assistantMessageID);
                            if (!currentAssistant)
                                return;
                            currentAssistant.time.completed = event.properties.timestamp;
                            currentAssistant.finish = "error";
                            currentAssistant.error = event.properties.error;
                        });
                        break;
                    case "session.next.text.started":
                        message.update(event.properties.sessionID, (draft) => {
                            const target = message.assistant(draft, event.properties.assistantMessageID);
                            target?.content.push({ type: "text", id: event.properties.textID, text: "" });
                        });
                        break;
                    case "session.next.text.delta":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestText(message.assistant(draft, event.properties.assistantMessageID), event.properties.textID);
                            if (match)
                                match.text += event.properties.delta;
                        });
                        break;
                    case "session.next.text.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestText(message.assistant(draft, event.properties.assistantMessageID), event.properties.textID);
                            if (match)
                                match.text = event.properties.text;
                        });
                        break;
                    case "session.next.tool.input.started":
                        message.update(event.properties.sessionID, (draft) => {
                            const target = message.assistant(draft, event.properties.assistantMessageID);
                            target?.content.push({
                                type: "tool",
                                id: event.properties.callID,
                                name: event.properties.name,
                                time: { created: event.properties.timestamp },
                                state: { status: "pending", input: "" },
                            });
                        });
                        break;
                    case "session.next.tool.input.delta":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (match?.state?.status === "pending")
                                match.state.input += event.properties.delta;
                        });
                        break;
                    case "session.next.tool.input.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (match?.state?.status === "pending")
                                match.state.input = event.properties.text;
                        });
                        break;
                    case "session.next.tool.called":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (!match)
                                return;
                            match.time.ran = event.properties.timestamp;
                            match.provider = event.properties.provider;
                            match.state = {
                                status: "running",
                                input: event.properties.input,
                                structured: {},
                                content: [],
                            };
                        });
                        break;
                    case "session.next.tool.progress":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (match?.state?.status !== "running")
                                return;
                            match.state.structured = event.properties.structured;
                            match.state.content = [...event.properties.content];
                        });
                        break;
                    case "session.next.tool.success":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (match?.state?.status !== "running")
                                return;
                            match.state = {
                                status: "completed",
                                input: match.state.input,
                                structured: event.properties.structured,
                                content: [...event.properties.content],
                                result: event.properties.result,
                            };
                            match.provider = {
                                executed: event.properties.provider.executed || match.provider?.executed === true,
                                metadata: match.provider?.metadata,
                                resultMetadata: event.properties.provider.metadata,
                            };
                            match.time.completed = event.properties.timestamp;
                        });
                        break;
                    case "session.next.tool.failed":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestTool(message.assistant(draft, event.properties.assistantMessageID), event.properties.callID);
                            if (!match || (match.state.status !== "pending" && match.state.status !== "running"))
                                return;
                            match.state = {
                                status: "error",
                                error: event.properties.error,
                                input: typeof match.state.input === "string" ? {} : match.state.input,
                                structured: match.state.status === "running" ? match.state.structured : {},
                                content: match.state.status === "running" ? match.state.content : [],
                                result: event.properties.result,
                            };
                            match.provider = {
                                executed: event.properties.provider.executed || match.provider?.executed === true,
                                metadata: match.provider?.metadata,
                                resultMetadata: event.properties.provider.metadata,
                            };
                            match.time.completed = event.properties.timestamp;
                        });
                        break;
                    case "session.next.reasoning.started":
                        message.update(event.properties.sessionID, (draft) => {
                            const target = message.assistant(draft, event.properties.assistantMessageID);
                            target?.content.push({
                                type: "reasoning",
                                id: event.properties.reasoningID,
                                text: "",
                                providerMetadata: event.properties.providerMetadata,
                            });
                        });
                        break;
                    case "session.next.reasoning.delta":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestReasoning(message.assistant(draft, event.properties.assistantMessageID), event.properties.reasoningID);
                            if (match)
                                match.text += event.properties.delta;
                        });
                        break;
                    case "session.next.reasoning.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            const match = message.latestReasoning(message.assistant(draft, event.properties.assistantMessageID), event.properties.reasoningID);
                            if (match) {
                                match.text = event.properties.text;
                                if (event.properties.providerMetadata !== undefined) {
                                    match.providerMetadata = event.properties.providerMetadata;
                                }
                            }
                        });
                        break;
                    case "session.next.compaction.ended":
                        message.update(event.properties.sessionID, (draft) => {
                            message.prepend(draft, {
                                id: event.properties.messageID,
                                type: "compaction",
                                reason: event.properties.reason,
                                summary: event.properties.text,
                                recent: event.properties.recent,
                                time: { created: event.properties.timestamp },
                            });
                        });
                        break;
                    default:
                        break;
                }
            };
            const unsub = sdk.event?.on?.("event", handler);
            return () => {
                if (typeof unsub === "function")
                    unsub();
            };
        }, [sdk, message, refreshLocation]);
        useEffect(() => {
            void Promise.allSettled([
                refreshLocation(),
            ]).then((settled) => {
                for (const failure of settled.filter((item) => item.status === "rejected")) {
                    console.error("Failed to refresh default location data", failure.reason);
                }
            });
        }, [refreshLocation]);
        const listAt = (slot, location) => {
            const key = locationKey(location ?? defaultLocation);
            return store.location[key]?.[slot];
        };
        const refreshAt = useCallback(async (slot, fetcher) => {
            const result = await fetcher();
            const key = locationKey(result.data.location);
            setLocation(key, slot, result.data.data);
        }, [setLocation]);
        return {
            session: {
                get: (sessionID) => store.session.info[sessionID],
                refresh: async (sessionID) => {
                    const result = await sdk.client.v2.session.get({ sessionID }, { throwOnError: true });
                    setStore((prev) => ({
                        ...prev,
                        session: { ...prev.session, info: { ...prev.session.info, [sessionID]: result.data.data } },
                    }));
                },
                message: {
                    list: (sessionID) => store.session.message[sessionID],
                    refresh: async (sessionID) => {
                        const result = await sdk.client.v2.session.messages({ sessionID }, { throwOnError: true });
                        setStore((prev) => ({
                            ...prev,
                            session: { ...prev.session, message: { ...prev.session.message, [sessionID]: result.data.data } },
                        }));
                    },
                },
                permission: {
                    list: (sessionID) => store.session.permission[sessionID],
                    refresh: async (sessionID) => {
                        const result = await sdk.client.v2.session.permission.list({ sessionID }, { throwOnError: true });
                        setStore((prev) => ({
                            ...prev,
                            session: { ...prev.session, permission: { ...prev.session.permission, [sessionID]: result.data.data } },
                        }));
                    },
                },
                question: {
                    list: (sessionID) => store.session.question[sessionID],
                    refresh: async (sessionID) => {
                        const result = await sdk.client.v2.session.question.list({ sessionID }, { throwOnError: true });
                        setStore((prev) => ({
                            ...prev,
                            session: { ...prev.session, question: { ...prev.session.question, [sessionID]: result.data.data } },
                        }));
                    },
                },
            },
            project: {
                permission: {
                    list: (projectID) => store.project.permission[projectID],
                    refresh: async (projectID) => {
                        const result = await sdk.client.v2.permission.saved.list({ projectID }, { throwOnError: true });
                        setStore((prev) => ({
                            ...prev,
                            project: { ...prev.project, permission: { ...prev.project.permission, [projectID]: result.data.data } },
                        }));
                    },
                },
            },
            location: {
                default: () => defaultLocation,
                refresh: refreshLocation,
                agent: {
                    list: (location) => listAt("agent", location),
                    refresh: (ref) => refreshAt("agent", () => sdk.client.v2.agent.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                command: {
                    list: (location) => listAt("command", location),
                    refresh: (ref) => refreshAt("command", () => sdk.client.v2.command.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                integration: {
                    list: (location) => listAt("integration", location),
                    refresh: (ref) => refreshAt("integration", () => sdk.client.v2.integration.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                model: {
                    list: (location) => listAt("model", location),
                    refresh: (ref) => refreshAt("model", () => sdk.client.v2.model.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                provider: {
                    list: (location) => listAt("provider", location),
                    refresh: (ref) => refreshAt("provider", () => sdk.client.v2.provider.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                reference: {
                    list: (location) => listAt("reference", location),
                    refresh: (ref) => refreshAt("reference", () => sdk.client.v2.reference.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
                skill: {
                    list: (location) => listAt("skill", location),
                    refresh: (ref) => refreshAt("skill", () => sdk.client.v2.skill.list({ location: locationQuery(ref) }, { throwOnError: true })),
                },
            },
        };
    },
});
