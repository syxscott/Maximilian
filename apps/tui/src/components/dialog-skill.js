import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
export function DialogSkill(props) {
    const [skills, setSkills] = useState(props.skills ?? []);
    const [loading, setLoading] = useState(props.loading ?? false);
    const [query, setQuery] = useState("");
    useEffect(() => {
        if (props.skills)
            setSkills(props.skills);
    }, [props.skills]);
    useEffect(() => {
        if (!props.onLoad || (props.skills && props.skills.length > 0))
            return;
        let cancelled = false;
        setLoading(true);
        void (async () => {
            try {
                const data = await props.onLoad?.();
                if (!cancelled)
                    setSkills(data ?? []);
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [props.onLoad, props.skills]);
    const items = useMemo(() => {
        const maxWidth = Math.max(0, ...skills.map((s) => s.name.length));
        return skills.map((skill) => ({
            label: skill.name.padEnd(maxWidth),
            value: skill.name,
            description: skill.description?.replace(/\s+/g, " ").trim(),
        }));
    }, [skills]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return items;
        return items.filter((i) => i.value.toLowerCase().includes(q));
    }, [items, query]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.skills") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginY: 1, children: [_jsx(Text, { children: "Search: " }), _jsx(TextInput, { value: query, onChange: setQuery, placeholder: "Search skills..." })] }), _jsx(Box, { children: loading ? (_jsx(Text, { dimColor: true, children: "Loading skills..." })) : (_jsx(SelectInput, { items: filtered, onSelect: (item) => {
                        props.onSelect?.(item.value);
                    }, itemComponent: ({ isSelected, label, description }) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), description && (_jsxs(Text, { dimColor: true, children: ["  ", description] }))] })) })) })] }));
}
export default DialogSkill;
