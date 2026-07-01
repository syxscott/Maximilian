import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
export function DialogThemeList(props) {
    const sorted = useMemo(() => [...props.themes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [props.themes]);
    const [confirmed, setConfirmed] = useState(false);
    const [active, setActive] = useState(props.initial);
    useEffect(() => {
        if (active !== undefined)
            props.onPreview?.(active);
    }, [active, props.onPreview]);
    useInput((input, key) => {
        if (key.escape && !confirmed) {
            props.onPreview?.(props.initial);
            props.onCancel?.();
        }
    });
    const items = sorted.map((value) => ({ label: value, value }));
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.themes") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, initialIndex: sorted.indexOf(props.initial), onSelect: (item) => {
                        setConfirmed(true);
                        props.onSelect?.(item.value);
                    }, onHighlight: (item) => {
                        setActive(item.value);
                    }, itemComponent: ({ isSelected, label }) => (_jsx(Text, { color: isSelected ? "green" : undefined, children: label })) }) })] }));
}
export default DialogThemeList;
