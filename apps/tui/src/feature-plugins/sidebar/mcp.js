import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text } from "ink";
const id = "internal:sidebar-mcp";
function View(props) {
    const [open, setOpen] = useState(true);
    const theme = props.api.theme.current;
    const list = useMemo(() => props.api.state.mcp(), []);
    const on = useMemo(() => list.filter((item) => item.status === "connected").length, [list]);
    const bad = useMemo(() => list.filter((item) => item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration").length, [list]);
    const dot = (status) => {
        if (status === "connected")
            return theme.success;
        if (status === "failed")
            return theme.error;
        if (status === "disabled")
            return theme.textMuted;
        if (status === "needs_auth")
            return theme.warning;
        if (status === "needs_client_registration")
            return theme.error;
        return theme.textMuted;
    };
    const statusLabel = (status, error) => {
        if (status === "connected")
            return "Connected";
        if (status === "failed")
            return error ?? "Failed";
        if (status === "disabled")
            return "Disabled";
        if (status === "needs_auth")
            return "Needs auth";
        if (status === "needs_client_registration")
            return "Needs client ID";
        return status;
    };
    if (list.length === 0)
        return null;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, onClick: () => list.length > 2 && setOpen((x) => !x), children: [list.length > 2 && _jsx(Text, { color: theme.text, children: open ? "▼" : "▶" }), _jsxs(Text, { color: theme.text, bold: true, children: ["MCP", !open && (_jsxs(Text, { color: theme.textMuted, children: [" ", "(", on, " active", bad > 0 ? `, ${bad} error${bad > 1 ? "s" : ""}` : "", ")"] }))] })] }), (list.length <= 2 || open) &&
                list.map((item) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: dot(item.status), children: '•' }), _jsxs(Text, { color: theme.text, wrap: "word", children: [item.name, " ", _jsx(Text, { color: theme.textMuted, italic: item.status === "failed", children: statusLabel(item.status, item.error) })] })] }, item.name)))] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 200,
        slots: {
            sidebar_content() {
                return _jsx(View, { api: api });
            },
        },
    });
};
const plugin = {
    id,
    tui,
};
export default plugin;
