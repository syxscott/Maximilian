import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listLocales, getLocale, setLocale, localeDisplayName, t } from "@max/i18n";
export function DialogLanguageList(props) {
    const initial = getLocale();
    const sorted = useMemo(() => [...listLocales()].sort((a, b) => localeDisplayName(a).localeCompare(localeDisplayName(b), undefined, { sensitivity: "base" })), []);
    const [active, setActive] = useState(initial);
    useInput((input, key) => {
        if (key.escape) {
            props.onCancel?.();
        }
    });
    const items = sorted.map((value) => ({
        label: `${localeDisplayName(value)} (${value})`,
        value,
    }));
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.language") }), _jsx(Text, { dimColor: true, children: t("tui.esc") })] }), _jsx(Box, { marginTop: 1, children: _jsx(SelectInput, { items: items, initialIndex: Math.max(0, sorted.indexOf(initial)), onSelect: (item) => {
                        setLocale(item.value);
                        props.onSelect?.(item.value);
                    }, onHighlight: (item) => {
                        setActive(item.value);
                    }, itemComponent: ({ isSelected, label }) => (_jsx(Text, { color: isSelected ? "green" : undefined, children: label })) }) }), active ? (_jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: active }) })) : null] }));
}
// useEffect import kept for parity with DialogThemeList; will be wired when
// preview-then-confirm flow lands.
void useEffect;
export default DialogLanguageList;
