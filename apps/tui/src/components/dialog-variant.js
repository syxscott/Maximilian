import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo } from "react";
import { t } from "@max/i18n";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
export function DialogVariant(props) {
    const items = useMemo(() => {
        return [
            {
                label: "Default",
                value: "__default__",
            },
            ...props.variants.map((variant) => ({
                label: variant,
                value: variant,
            })),
        ];
    }, [props.variants]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.selectVariant") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, initialIndex: items.findIndex((i) => i.value === "__default__"
                        ? props.current === undefined || props.current === "default"
                        : i.value === props.current), onSelect: (item) => {
                        if (item.value === "__default__") {
                            props.onSelect?.(undefined);
                        }
                        else {
                            props.onSelect?.(item.value);
                        }
                    }, itemComponent: ({ isSelected, label, value }) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), value === props.current && _jsx(Text, { dimColor: true, children: " (current)" })] })) }) })] }));
}
export default DialogVariant;
