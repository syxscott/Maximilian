import { jsx as _jsx } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { Box } from "ink";
import { Tips } from "./tips-view";
import { useBindings } from "../../keymap";
const id = "internal:home-tips";
function View(props) {
    useBindings(() => ({
        commands: [
            {
                name: "tips.toggle",
                title: props.hidden ? "Show tips" : "Hide tips",
                category: "System",
                namespace: "palette",
                run() {
                    props.api.kv.set("tips_hidden", !props.api.kv.get("tips_hidden", false));
                    props.api.ui.dialog.clear();
                },
            },
        ],
        bindings: props.api.tuiConfig.keybinds.get("tips.toggle"),
    }));
    return (_jsx(Box, { width: "100%", maxWidth: 75, alignItems: "center", paddingTop: 3, flexShrink: 1, children: props.show && _jsx(Tips, { api: props.api, connected: props.connected }) }));
}
const tui = async (api) => {
    api.slots.register({
        order: 100,
        slots: {
            home_bottom() {
                const hidden = useMemo(() => api.kv.get("tips_hidden", false), []);
                const first = useMemo(() => api.state.session.count() === 0, []);
                const connected = useMemo(() => api.state.provider.some((item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0)), []);
                const show = useMemo(() => (!first || !connected) && !hidden, [first, connected, hidden]);
                return _jsx(View, { api: api, hidden: hidden, show: show, connected: connected });
            },
        },
    });
};
const plugin = {
    id,
    tui,
};
export default plugin;
