import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { t } from "@max/i18n";
function Status(props) {
    if (props.loading)
        return _jsx(Text, { dimColor: true, children: "... Loading" });
    if (props.enabled)
        return _jsxs(Text, { color: "green", bold: true, children: ["✓", " Enabled"] });
    return _jsxs(Text, { dimColor: true, children: ["○", " Disabled"] });
}
export function DialogMcp(props) {
    const [loading, setLoading] = useState(null);
    const [mcps, setMcps] = useState(props.mcps);
    useEffect(() => {
        setMcps(props.mcps);
    }, [props.mcps]);
    const items = useMemo(() => {
        return Object.keys(mcps)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => {
            const status = mcps[name];
            return {
                label: name,
                value: name,
                description: status.status === "failed" ? "failed" : status.status,
                footer: (_jsx(Status, { enabled: !!props.isEnabled?.(name), loading: loading === name })),
            };
        });
    }, [mcps, loading, props.isEnabled]);
    const actions = useMemo(() => [
        {
            title: "toggle",
            onTrigger: async (option) => {
                if (loading !== null)
                    return;
                setLoading(option.value);
                try {
                    await props.onToggle?.(option.value);
                    if (props.onRefresh) {
                        const data = await props.onRefresh();
                        if (data)
                            setMcps(data);
                    }
                }
                finally {
                    setLoading(null);
                }
            },
        },
    ], [loading, props.onToggle, props.onRefresh]);
    useInput((input, key) => {
        if (key.return) {
            // selection handled by SelectInput
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.mcps") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, onSelect: () => {
                        // Don't close on select, only on escape
                    }, itemComponent: ({ isSelected, label, value, description, footer }) => (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), description && _jsxs(Text, { dimColor: true, children: ["  ", description] })] }), _jsx(Box, { children: footer }), _jsxs(Text, { dimColor: true, children: [actions[0]?.title, " [", value, "]"] })] })) }) })] }));
}
export default DialogMcp;
