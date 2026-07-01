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
import { useState, useCallback } from "react";
import { createSimpleContext } from "./helper";
import { useTuiStartup } from "./runtime";
function initialRoute(value) {
    if (!value || typeof value !== "object" || !("type" in value))
        return;
    const v = value;
    if (v.type === "home")
        return { type: "home" };
    if (v.type === "session" && typeof v.sessionID === "string") {
        return { type: "session", sessionID: v.sessionID };
    }
    if (v.type === "plugin" && typeof v.id === "string") {
        return { type: "plugin", id: v.id };
    }
    return;
}
export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
    name: "Route",
    init: (props) => {
        const startup = useTuiStartup();
        const [data, setData] = useState(props.initialRoute ?? initialRoute(startup.initialRoute) ?? { type: "home" });
        const navigate = useCallback((next) => {
            setData(next);
        }, []);
        return {
            data,
            navigate,
        };
    },
});
export function useRouteData(type) {
    const route = useRoute();
    if (route.data.type !== type) {
        throw new Error(`useRouteData<${type}> called on route of type ${route.data.type}`);
    }
    return route.data;
}
