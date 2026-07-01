import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { t } from "@max/i18n";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
export function DialogAgent(props) {
    const items = useMemo(() => {
        return props.agents.map((item) => ({
            label: item.name,
            value: item,
            description: item.native ? "native" : item.description,
        }));
    }, [props.agents]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.selectAgent") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: (item) => props.onSelect?.(item.value), itemComponent: ({ isSelected, label, value }) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), props.current === value.name && _jsx(Text, { dimColor: true, children: " (current)" })] })) }) })] }));
}
export default DialogAgent;
