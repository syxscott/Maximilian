import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
// Default theme tokens; consumers can wrap with a ThemeProvider for overrides.
const DEFAULT_COLORS = {
    textMuted: "gray",
    warning: "yellow",
    success: "green",
};
export function TodoItem({ status, content }) {
    const color = status === "in_progress"
        ? DEFAULT_COLORS.warning
        : status === "completed"
            ? DEFAULT_COLORS.success
            : DEFAULT_COLORS.textMuted;
    const marker = status === "completed" ? "✓" : status === "in_progress" ? "•" : " ";
    return (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: color, children: ["[", marker, "] "] }), _jsx(Box, { flexGrow: 1, children: _jsx(Text, { color: color, wrap: "wrap", children: content }) })] }));
}
export default TodoItem;
