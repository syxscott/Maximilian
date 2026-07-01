/**
 * Local context: agent, model, MCP toggles, and session pinning.
 *
 * Ported from OpenCode's SolidJS `local.tsx`. The original kept a Solid store
 * + reactive memos; we mirror the same surface in plain React state, which is
 * adequate because the React tree only re-renders when the provider value
 * identity changes.
 *
 * Toast notifications are stubbed via console.warn so we don't pull in a
 * `components/toast` that may not exist in early integration. Real toast
 * calls can be wired in by replacing the `notify` helper.
 */
import { useState, useMemo } from "react";
import { createSimpleContext } from "./helper";
import { useSDK } from "./sdk";
import { useSync } from "./sync";
import { useRoute } from "./route";
import { useTuiPaths } from "./runtime";
export function parseModel(model) {
    const [providerID, ...rest] = model.split("/");
    return { providerID, modelID: rest.join("/") };
}
export function recentModels(model, recent) {
    const seen = new Set();
    return [model, ...recent]
        .filter((item) => {
        const key = `${item.providerID}/${item.modelID}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .slice(0, 10)
        .map((item) => ({ providerID: item.providerID, modelID: item.modelID }));
}
function notify(variant, message) {
    // Stub: real implementations route through `useToast()` from a UI component.
    if (variant === "error")
        console.error(message);
    else
        console.warn(message);
}
export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
    name: "Local",
    init: () => {
        const sync = useSync();
        const sdk = useSDK();
        void sdk;
        const route = useRoute();
        void route;
        const paths = useTuiPaths();
        void paths;
        const syncData = sync.data;
        function isModelValid(model) {
            const provider = syncData.provider.find((item) => item.id === model.providerID);
            return !!provider?.models[model.modelID];
        }
        // ---- Agent ------------------------------------------------------------
        const agents = useMemo(() => syncData.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden), [syncData.agent]);
        const visibleAgents = useMemo(() => syncData.agent.filter((agent) => !agent.hidden), [syncData.agent]);
        const [currentAgent, setCurrentAgent] = useState(agents[0]?.name);
        const colors = useMemo(() => ({
            secondary: "#a78bfa",
            accent: "#34d399",
            success: "#22c55e",
            warning: "#facc15",
            primary: "#60a5fa",
            error: "#f87171",
            info: "#38bdf8",
        }), []);
        const agent = {
            list: () => agents,
            current: () => agents.find((x) => x.name === currentAgent) ?? agents[0],
            set: (name) => {
                if (!agents.some((x) => x.name === name)) {
                    notify("warning", `Agent not found: ${name}`);
                    return;
                }
                setCurrentAgent(name);
            },
            move: (direction) => {
                const current = agent.current();
                if (!current)
                    return;
                let next = agents.findIndex((x) => x.name === current.name) + direction;
                if (next < 0)
                    next = agents.length - 1;
                if (next >= agents.length)
                    next = 0;
                const value = agents[next];
                if (value)
                    setCurrentAgent(value.name);
            },
            color: (name) => {
                const index = visibleAgents.findIndex((x) => x.name === name);
                if (index === -1)
                    return colors.secondary;
                const entry = visibleAgents[index];
                if (entry?.color) {
                    if (entry.color.startsWith("#"))
                        return entry.color;
                    const found = colors[entry.color];
                    if (found)
                        return found;
                }
                const list = Object.values(colors);
                return list[index % list.length] ?? colors.primary;
            },
        };
        // ---- Model ------------------------------------------------------------
        const [modelByAgent, setModelByAgent] = useState({});
        const [recent, setRecent] = useState([]);
        const [favorite, setFavorite] = useState([]);
        const [variant, setVariant] = useState({});
        const fallbackModel = useMemo(() => {
            for (const item of recent)
                if (isModelValid(item))
                    return item;
            const provider = syncData.provider[0];
            if (!provider)
                return undefined;
            const firstModel = Object.values(provider.models)[0];
            if (!firstModel?.id)
                return undefined;
            return { providerID: provider.id, modelID: firstModel.id };
        }, [recent, syncData.provider]);
        const currentModel = useMemo(() => {
            const a = agent.current();
            return a ? modelByAgent[a.name] ?? a.model ?? fallbackModel : undefined;
        }, [agent, modelByAgent, fallbackModel]);
        const model = {
            current: () => currentModel,
            get ready() {
                return true;
            },
            recent: () => recent,
            favorite: () => favorite,
            parsed: () => {
                if (!currentModel)
                    return { provider: "Connect a provider", model: "No provider selected", reasoning: false };
                const provider = syncData.provider.find((item) => item.id === currentModel.providerID);
                const info = provider?.models[currentModel.modelID];
                return {
                    provider: provider?.id ?? currentModel.providerID,
                    model: info?.name ?? currentModel.modelID,
                    reasoning: info?.capabilities?.reasoning ?? false,
                };
            },
            cycle: (direction) => {
                const current = currentModel;
                if (!current)
                    return;
                const idx = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID);
                if (idx === -1)
                    return;
                let next = idx + direction;
                if (next < 0)
                    next = recent.length - 1;
                if (next >= recent.length)
                    next = 0;
                const value = recent[next];
                if (!value)
                    return;
                const a = agent.current();
                if (!a)
                    return;
                setModelByAgent((prev) => ({ ...prev, [a.name]: value }));
            },
            cycleFavorite: (_direction) => {
                notify("info", "Add a favorite model to use this shortcut");
            },
            set: (modelRef, options) => {
                if (!isModelValid(modelRef)) {
                    notify("warning", `Model ${modelRef.providerID}/${modelRef.modelID} is not valid`);
                    return;
                }
                const a = agent.current();
                if (!a)
                    return;
                setModelByAgent((prev) => ({ ...prev, [a.name]: modelRef }));
                if (options?.recent)
                    setRecent((prev) => recentModels(modelRef, prev));
            },
            toggleFavorite: (modelRef) => {
                if (!isModelValid(modelRef)) {
                    notify("warning", `Model ${modelRef.providerID}/${modelRef.modelID} is not valid`);
                    return;
                }
                setFavorite((prev) => prev.some((x) => x.providerID === modelRef.providerID && x.modelID === modelRef.modelID)
                    ? prev.filter((x) => !(x.providerID === modelRef.providerID && x.modelID === modelRef.modelID))
                    : [modelRef, ...prev]);
            },
            variant: {
                selected: () => {
                    if (!currentModel)
                        return undefined;
                    return variant[`${currentModel.providerID}/${currentModel.modelID}`];
                },
                current: () => {
                    if (!currentModel)
                        return undefined;
                    return variant[`${currentModel.providerID}/${currentModel.modelID}`];
                },
                list: () => [],
                set: (value) => {
                    if (!currentModel)
                        return;
                    setVariant((prev) => ({ ...prev, [`${currentModel.providerID}/${currentModel.modelID}`]: value }));
                },
                cycle: () => { },
            },
        };
        // ---- MCP --------------------------------------------------------------
        const mcp = {
            isEnabled: (name) => syncData.mcp[name]?.status === "connected",
            toggle: async (_name) => {
                /* delegated to caller-provided SDK action */
            },
        };
        // ---- Session pinning --------------------------------------------------
        const [pinned, setPinned] = useState([]);
        const slots = useMemo(() => {
            const existing = new Set(syncData.session.filter((x) => x.parentID === undefined).map((x) => x.id));
            return pinned.filter((id) => existing.has(id)).slice(0, 9);
        }, [pinned, syncData.session]);
        const sessionLocal = {
            get ready() {
                return true;
            },
            pinned: () => pinned,
            slots,
            isPinned: (sessionID) => pinned.includes(sessionID),
            togglePin: (sessionID) => setPinned((prev) => (prev.includes(sessionID) ? prev.filter((x) => x !== sessionID) : [...prev, sessionID])),
            quickSwitch: (slot) => {
                const target = slots[slot - 1];
                if (!target)
                    return;
                route.navigate({ type: "session", sessionID: target });
            },
        };
        return {
            model,
            agent,
            mcp,
            session: sessionLocal,
        };
    },
});
