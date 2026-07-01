import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useContext } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../context/theme";
const PanelGroupContext = createContext(undefined);
function crossAxis(axis) {
    return axis === "x" ? "y" : "x";
}
function usePanelGroup() {
    return useContext(PanelGroupContext);
}
export function PanelGroup(props) {
    const { axis, children, ...boxProps } = props;
    return (_jsx(PanelGroupContext.Provider, { value: { axis }, children: _jsx(Box, { minWidth: 0, minHeight: 0, padding: 0, flexDirection: axis === "x" ? "row" : "column", ...boxProps, children: children }) }));
}
export function Panel(props) {
    const group = usePanelGroup();
    const { theme } = useTheme();
    const { border: borderProp, children, ...boxProps } = props;
    const border = borderProp ?? "start";
    const borderStyle = border === "none"
        ? {}
        : {
            borderStyle: panelBorderSides(group?.axis ?? "y", border),
            borderColor: theme.border,
        };
    return (_jsx(Box, { minWidth: 0, minHeight: 0, flexDirection: crossAxis(group?.axis ?? "y") === "x" ? "row" : "column", ...borderStyle, ...boxProps, children: children }));
}
function panelBorderSides(axis, border) {
    if (axis === "x")
        return border === "both" ? ["top", "bottom"] : [border === "start" ? "top" : "bottom"];
    return border === "both" ? ["left", "right"] : [border === "start" ? "left" : "right"];
}
export function Separator(props) {
    const group = usePanelGroup();
    const { theme } = useTheme();
    const color = props.color ?? theme.border;
    const axis = props.axis ?? crossAxis(group?.axis ?? "y");
    if (axis === "y") {
        if (props.start || props.end) {
            return (_jsxs(Box, { width: 1, flexShrink: 0, flexDirection: "column", children: [props.start && _jsx(Text, { color: color, children: verticalEdge(props.start, "start") }), _jsx(Box, { flexGrow: 1, borderLeft: true, borderColor: color }), props.end && _jsx(Text, { color: color, children: verticalEdge(props.end, "end") })] }));
        }
        return _jsx(Box, { width: 1, flexShrink: 0, borderLeft: true, borderColor: color });
    }
    if (props.start || props.end) {
        return (_jsxs(Box, { height: 1, flexShrink: 0, flexDirection: "row", children: [props.start && _jsx(Text, { color: color, children: horizontalEdge(props.start, "start") }), _jsx(Box, { flexGrow: 1, borderTop: true, borderColor: color }), props.end && _jsx(Text, { color: color, children: horizontalEdge(props.end, "end") })] }));
    }
    return _jsx(Box, { height: 1, flexShrink: 0, borderTop: true, borderColor: color });
}
function horizontalEdge(edge, side) {
    if (edge === "edge")
        return side === "start" ? "├" : "┤";
    if (edge === "edge-in")
        return "┴";
    return "┬";
}
function verticalEdge(edge, side) {
    if (edge === "edge")
        return side === "start" ? "┬" : "┴";
    if (edge === "edge-in")
        return "┤";
    return "├";
}
