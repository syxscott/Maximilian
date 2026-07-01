import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { Box, Text } from "ink";
const id = "internal:sidebar-context";
const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
});
function View(props) {
    const theme = props.api.theme.current;
    const msg = useMemo(() => props.api.state.session.messages(props.session_id), [props.session_id]);
    const session = useMemo(() => props.api.state.session.get(props.session_id), [props.session_id]);
    const cost = useMemo(() => session?.cost ?? 0, [session]);
    const state = useMemo(() => {
        const last = msg.findLast((item) => item.role === "assistant" && item.tokens.output > 0);
        if (!last) {
            return {
                tokens: 0,
                percent: null,
            };
        }
        const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write;
        const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID];
        return {
            tokens,
            percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
        };
    }, [msg]);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: theme.text, bold: true, children: "Context" }), _jsxs(Text, { color: theme.textMuted, children: [state.tokens.toLocaleString(), " tokens"] }), _jsxs(Text, { color: theme.textMuted, children: [state.percent ?? 0, "% used"] }), _jsxs(Text, { color: theme.textMuted, children: [money.format(cost), " spent"] })] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 100,
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
