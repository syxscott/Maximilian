import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text } from "ink";
import { Locale } from "../../util/locale";
const id = "internal:sidebar-files";
function changeCountWidth(item) {
    return [item.additions ? `+${item.additions}` : "", item.deletions ? `-${item.deletions}` : ""]
        .filter(Boolean)
        .join(" ").length;
}
function View(props) {
    const [open, setOpen] = useState(true);
    const theme = props.api.theme.current;
    const list = useMemo(() => props.api.state.session.diff(props.session_id), [props.session_id]);
    if (list.length === 0)
        return null;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, onClick: () => list.length > 2 && setOpen((x) => !x), children: [list.length > 2 && _jsx(Text, { color: theme.text, children: open ? "▼" : "▶" }), _jsx(Text, { color: theme.text, bold: true, children: "Modified Files" })] }), (list.length <= 2 || open) &&
                list.map((item, index) => (_jsxs(Box, { flexDirection: "row", gap: 1, justifyContent: "space-between", children: [_jsx(Text, { color: theme.textMuted, wrap: "truncate", children: Locale.truncateLeft(item.file, Math.max(2, 36 - changeCountWidth(item))) }), _jsxs(Box, { flexDirection: "row", gap: 1, flexShrink: 0, children: [item.additions > 0 && _jsxs(Text, { color: theme.diffAdded, children: ["+", item.additions] }), item.deletions > 0 && _jsxs(Text, { color: theme.diffRemoved, children: ["-", item.deletions] })] })] }, index)))] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 500,
        slots: {
            sidebar_content(_ctx, props) {
                return _jsx(View, { api: api, session_id: props.session_id });
            },
        },
    });
};
const plugin = {
    id,
    tui,
};
export default plugin;
