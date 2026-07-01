import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { t } from "@max/i18n";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
function debounce(fn, wait) {
    let timer;
    return ((...args) => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    });
}
function orderByRecency(sessions) {
    return sessions
        .filter((x) => x.parentID === undefined)
        .sort((a, b) => b.time.updated - a.time.updated)
        .map((x) => x.id);
}
function quickSwitchRange(first, last) {
    const prefix = first.slice(0, -1);
    if (first.endsWith("1") && last === `${prefix}9`)
        return `${prefix}1-9`;
    return `${first} through ${last}`;
}
export function DialogSessionList(props) {
    const [toDelete, setToDelete] = useState(undefined);
    const [search, setSearch] = useState("");
    const [searchResults, setSearchResults] = useState(undefined);
    const debouncedSet = useMemo(() => debounce((value) => setSearch(value), 150), []);
    const sessions = searchResults ?? props.sessions;
    const browseOrder = useMemo(() => orderByRecency(props.sessions), [props.sessions]);
    const quickSwitchHint = useMemo(() => {
        const first = props.quickSwitch1;
        const last = props.quickSwitch9;
        if (!first || !last)
            return undefined;
        return quickSwitchRange(first, last);
    }, [props.quickSwitch1, props.quickSwitch9]);
    const items = useMemo(() => {
        const today = new Date().toDateString();
        const sessionMap = new Map(sessions.map((x) => [x.id, x]));
        const displayOrder = searchResults ? orderByRecency(searchResults) : browseOrder;
        const pinned = (props.pinned ?? []).filter((id) => sessionMap.has(id));
        const pinnedSet = new Set(pinned);
        const slotByID = new Map((props.slots ?? []).map((id, i) => [id, i + 1]));
        const buildOption = (id, category) => {
            const x = sessionMap.get(id);
            if (!x)
                return undefined;
            const isDeleting = toDelete === x.id;
            const status = props.sessionStatus?.[x.id];
            const isWorking = status?.type === "busy" || status?.type === "retry";
            const slot = slotByID.get(x.id);
            const prefix = isWorking ? (_jsx(Text, { color: "green", children: _jsx(Spinner, { type: "dots" }) })) : slot !== undefined ? (_jsx(Text, { color: "cyan", children: slot })) : undefined;
            return {
                label: isDeleting ? `Press ${props.deleteHint ?? "delete"} again to confirm` : x.title,
                value: x.id,
                category,
                prefix,
            };
        };
        const remaining = displayOrder
            .filter((id) => !pinnedSet.has(id))
            .map((id) => {
            const x = sessionMap.get(id);
            if (!x)
                return undefined;
            const label = new Date(x.time.updated).toDateString();
            return buildOption(id, label === today ? "Today" : label);
        })
            .filter((x) => x !== undefined);
        return [
            ...pinned.map((id) => buildOption(id, "Pinned")).filter((x) => x !== undefined),
            ...remaining,
        ];
    }, [sessions, searchResults, browseOrder, toDelete, props.sessionStatus, props.slots, props.pinned, props.deleteHint]);
    const footerHints = useMemo(() => {
        if (!quickSwitchHint || (props.slots ?? []).length === 0)
            return [];
        return [{ title: "switch", label: quickSwitchHint }];
    }, [quickSwitchHint, props.slots]);
    useInput((input, key) => {
        if (key.escape) {
            setToDelete(undefined);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: t("tui.sessions") }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginY: 1, children: [_jsx(Text, { children: "Search: " }), _jsx(TextInput, { value: search, onChange: (v) => { setSearchResults(undefined); debouncedSet(v); } })] }), _jsx(Box, { children: _jsx(SelectInput, { items: items, onSelect: (item) => {
                        const session = sessions.find((s) => s.id === item.value);
                        if (session)
                            props.onSelect?.(session);
                    }, itemComponent: ({ isSelected, label, value, prefix }) => (_jsxs(Box, { flexDirection: "row", children: [prefix ? prefix : null, _jsx(Text, { children: " " }), _jsx(Text, { color: isSelected ? "green" : toDelete === value ? "red" : undefined, children: label })] })) }) }), footerHints.length > 0 && (_jsx(Box, { marginTop: 1, children: footerHints.map((h) => (_jsxs(Text, { dimColor: true, children: [h.title, ": ", h.label] }, h.title))) }))] }));
}
export default DialogSessionList;
