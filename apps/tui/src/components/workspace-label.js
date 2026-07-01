import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Text } from "ink";
import { useTheme } from "../context/theme";
export function WorkspaceLabel(props) {
    const { theme } = useTheme();
    const color = props.status === "connected"
        ? theme.success
        : props.status === "error"
            ? theme.error
            : theme.textMuted;
    return (_jsxs(_Fragment, { children: [props.icon ? _jsx(Text, { color: color, children: "\u25CF " }) : null, _jsx(Text, { color: theme.text, children: props.name }), " ", _jsxs(Text, { color: theme.textMuted, children: ["(", props.type, ")"] })] }));
}
