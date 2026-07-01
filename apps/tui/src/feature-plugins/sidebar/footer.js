import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { Box, Text } from "ink";
import { abbreviateHome } from "../../runtime";
import { useTuiPaths } from "../../context/runtime";
const id = "internal:sidebar-footer";
function View(props) {
    const paths = useTuiPaths();
    const theme = props.api.theme.current;
    const has = useMemo(() => props.api.state.provider.some((item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0)), []);
    const done = useMemo(() => props.api.kv.get("dismissed_getting_started", false), []);
    const show = useMemo(() => !has && !done, [has, done]);
    const path = useMemo(() => {
        const session = props.api.state.session.get(props.sessionID);
        const dir = session?.directory || props.api.state.path.directory || paths.cwd;
        const out = abbreviateHome(dir, paths.home);
        const branch = session?.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined;
        const text = branch ? out + ":" + branch : out;
        const list = text.split("/");
        return {
            parent: list.slice(0, -1).join("/"),
            name: list.at(-1) ?? "",
        };
    }, [props.sessionID]);
    return (_jsxs(Box, { flexDirection: "column", gap: 1, children: [show && (_jsxs(Box, { backgroundColor: theme.backgroundElement, paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, flexDirection: "row", gap: 1, children: [_jsx(Text, { color: theme.text, children: '⬖' }), _jsxs(Box, { flexGrow: 1, flexDirection: "column", gap: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { color: theme.text, bold: true, children: "Getting started" }), _jsx(Text, { color: theme.textMuted, onClick: () => props.api.kv.set("dismissed_getting_started", true), children: "\u2715" })] }), _jsx(Text, { color: theme.textMuted, children: "OpenCode includes free models so you can start immediately." }), _jsx(Text, { color: theme.textMuted, children: "Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc" }), _jsxs(Box, { flexDirection: "row", gap: 1, justifyContent: "space-between", children: [_jsx(Text, { color: theme.text, children: "Connect provider" }), _jsx(Text, { color: theme.textMuted, children: "/connect" })] })] })] })), _jsxs(Text, { children: [_jsxs(Text, { color: theme.textMuted, children: [path.parent, "/"] }), _jsx(Text, { color: theme.text, children: path.name })] }), _jsxs(Text, { color: theme.textMuted, children: [_jsx(Text, { color: theme.success, children: '•' }), " ", _jsx(Text, { bold: true, children: "Open" }), _jsx(Text, { color: theme.text, bold: true, children: "Code" }), " ", _jsx(Text, { children: props.api.app.version })] })] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 100,
        slots: {
            sidebar_footer(_ctx, props) {
                return _jsx(View, { api: api, sessionID: props.session_id });
            },
        },
    });
};
const plugin = {
    id,
    tui,
};
export default plugin;
