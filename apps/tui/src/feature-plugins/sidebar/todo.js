import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text } from "ink";
import { TodoItem } from "../../components/todo-item";
const id = "internal:sidebar-todo";
function View(props) {
    const [open, setOpen] = useState(true);
    const theme = props.api.theme.current;
    const list = useMemo(() => props.api.state.session.todo(props.session_id), [props.session_id]);
    const show = useMemo(() => list.length > 0 && list.some((item) => item.status !== "completed"), [list]);
    if (!show)
        return null;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, onClick: () => list.length > 2 && setOpen((x) => !x), children: [list.length > 2 && _jsx(Text, { color: theme.text, children: open ? "▼" : "▶" }), _jsx(Text, { color: theme.text, bold: true, children: "Todo" })] }), (list.length <= 2 || open) &&
                list.map((item, index) => _jsx(TodoItem, { status: item.status, content: item.content }, index))] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 400,
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
