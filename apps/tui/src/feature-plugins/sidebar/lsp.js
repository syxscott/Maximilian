import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text } from "ink";
const id = "internal:sidebar-lsp";
function View(props) {
    const [open, setOpen] = useState(true);
    const theme = props.api.theme.current;
    const list = useMemo(() => props.api.state.lsp(), []);
    const off = useMemo(() => !props.api.state.config.lsp, []);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, onClick: () => list.length > 2 && setOpen((x) => !x), children: [list.length > 2 && _jsx(Text, { color: theme.text, children: open ? "▼" : "▶" }), _jsx(Text, { color: theme.text, bold: true, children: "LSP" })] }), (list.length <= 2 || open) && (_jsxs(_Fragment, { children: [list.length === 0 && (_jsx(Text, { color: theme.textMuted, children: off ? "LSPs are disabled" : "LSPs will activate as files are read" })), list.map((item) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: item.status === "connected" ? theme.success : theme.error, children: '•' }), _jsxs(Text, { color: theme.textMuted, children: [item.id, " ", item.root] })] }, item.id)))] }))] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 300,
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
