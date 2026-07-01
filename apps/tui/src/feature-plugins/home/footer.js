import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { Box, Text } from "ink";
import { abbreviateHome } from "../../runtime";
import { useTuiPaths } from "../../context/runtime";
import { useHomeSessionDestination } from "../../routes/home/session-destination";
const id = "internal:home-footer";
function Directory(props) {
    const theme = props.api.theme.current;
    const destination = useHomeSessionDestination();
    const paths = useTuiPaths();
    const dir = useMemo(() => {
        const selected = destination?.destination();
        if (!selected || selected.type === "new")
            return undefined;
        const out = abbreviateHome(selected.directory, paths.home);
        const branch = selected.directory === (props.api.state.path.directory || paths.cwd) ? props.api.state.vcs?.branch : undefined;
        if (branch)
            return out + ":" + branch;
        return out;
    }, [destination]);
    if (!dir)
        return null;
    return _jsx(Text, { color: theme.textMuted, children: dir });
}
function Mcp(props) {
    const theme = props.api.theme.current;
    const list = useMemo(() => props.api.state.mcp(), []);
    const has = useMemo(() => list.length > 0, [list]);
    const err = useMemo(() => list.some((item) => item.status === "failed"), [list]);
    const count = useMemo(() => list.filter((item) => item.status === "connected").length, [list]);
    if (!has)
        return null;
    return (_jsxs(Box, { gap: 1, flexDirection: "row", flexShrink: 0, children: [_jsxs(Text, { color: theme.text, children: [_jsx(Text, { color: err ? theme.error : count > 0 ? theme.success : theme.textMuted, children: '⊙ ' }), count, " MCP"] }), _jsx(Text, { color: theme.textMuted, children: "/status" })] }));
}
function Version(props) {
    const theme = props.api.theme.current;
    return (_jsx(Box, { flexShrink: 0, children: _jsx(Text, { color: theme.textMuted, children: props.api.app.version }) }));
}
function View(props) {
    return (_jsxs(Box, { width: "100%", paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, flexDirection: "row", flexShrink: 0, gap: 2, children: [_jsx(Directory, { api: props.api }), _jsx(Mcp, { api: props.api }), _jsx(Box, { flexGrow: 1 }), _jsx(Version, { api: props.api })] }));
}
const tui = async (api) => {
    api.slots.register({
        order: 100,
        slots: {
            home_footer() {
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
