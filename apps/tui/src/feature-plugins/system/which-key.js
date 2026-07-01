import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useBindings, useKeymapSelector } from "../../keymap";
const command = {
    toggle: "which-key.toggle",
    toggleLayout: "which-key.layout.toggle",
    togglePending: "which-key.pending.toggle",
    groupPrevious: "which-key.group.previous",
    groupNext: "which-key.group.next",
    scrollUp: "which-key.scroll.up",
    scrollDown: "which-key.scroll.down",
    pageUp: "which-key.page.up",
    pageDown: "which-key.page.down",
    home: "which-key.home",
    end: "which-key.end",
};
const LAYER_PRIORITY = 900;
const KV_LAYOUT = "which_key_layout";
const KV_PENDING_PREVIEW = "which_key_pending_preview";
const toggleCommands = [command.toggle, command.toggleLayout, command.togglePending];
const scrollCommands = [
    command.scrollUp,
    command.scrollDown,
    command.pageUp,
    command.pageDown,
    command.home,
    command.end,
];
const panelCommands = [command.groupPrevious, command.groupNext, ...scrollCommands];
const COLUMN_GAP = 4;
const TAB_GAP = 3;
const MIN_TAB_GAP = 1;
const TAB_CONTENT_GAP = 1;
const MIN_COLUMN_WIDTH = 28;
const MAX_COLUMN_WIDTH = 44;
const PANEL_HEIGHT_RATIO = 0.3;
const MIN_PANEL_HEIGHT = 8;
const MAX_PANEL_HEIGHT = 16;
const PANEL_TOP_PADDING = 1;
const FOOTER_HEIGHT = 1;
const FOOTER_MARGIN = 1;
const UNKNOWN = "Unknown";
function text(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}
function ink(api, name, fallback) {
    const value = Reflect.get(api.theme.current, name);
    if (typeof value === "string")
        return value;
    return fallback;
}
function skin(api) {
    return {
        panel: ink(api, "backgroundMenu", "#1c1c1c"),
        text: ink(api, "text", "#f0f0f0"),
        muted: ink(api, "textMuted", "#a5a5a5"),
        subtle: ink(api, "borderSubtle", "#6f6f6f"),
        key: ink(api, "warning", "#ffd75f"),
        accent: ink(api, "primary", "#5f87ff"),
        tab: ink(api, "primary", "#5f87ff"),
        tabText: ink(api, "selectedListItemText", "#ffffff"),
    };
}
function activeKeyLabel(active) {
    if (active.continues)
        return text(active.tokenName) ?? text(active.display) ?? UNKNOWN;
    return (text(active.commandAttrs?.title) ?? text(active.bindingAttrs?.desc) ?? text(active.commandAttrs?.desc) ?? UNKNOWN);
}
function activeKeyGroup(active) {
    if (active.continues)
        return "System";
    return text(active.commandAttrs?.category) ?? text(active.bindingAttrs?.group) ?? UNKNOWN;
}
function activeKeyEntry(api, active) {
    const key = api.keys.formatSequence([
        {
            stroke: active.stroke,
            display: active.display,
            tokenName: active.tokenName,
        },
    ]);
    const label = activeKeyLabel(active);
    return {
        type: "entry",
        key,
        label: active.continues ? `+${label}` : label,
        group: activeKeyGroup(active),
        continues: active.continues,
    };
}
function grouped(entries) {
    const map = new Map();
    for (const entry of entries)
        map.set(entry.group, [...(map.get(entry.group) ?? []), entry]);
    return [...map]
        .map(([label, entries]) => ({
        label,
        entries: entries.toSorted((a, b) => Number(b.continues) - Number(a.continues) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)),
    }))
        .toSorted((a, b) => a.label.localeCompare(b.label));
}
function commandShortcut(api, name) {
    return useKeymapSelector((keymap) => api.keys.formatSequence(keymap.getCommandBindings({ visibility: "registered", commands: [name] }).get(name)?.[0]?.sequence));
}
function layout(value) {
    if (value === "overlay")
        return "overlay";
    return "dock";
}
function HomeHint(props) {
    const trigger = commandShortcut(props.api, command.toggle);
    const look = useMemo(() => skin(props.api), []);
    return (_jsx(Box, { width: "100%", maxWidth: 75, alignItems: "center", paddingTop: 1, flexShrink: 0, children: _jsxs(Text, { color: look.muted, wrap: "truncate-end", children: ["Show keyboard shortcuts with ", _jsx(Text, { color: look.subtle, children: trigger() || command.toggle })] }) }));
}
function WhichKeyPanel(props) {
    const [terminalWidth, setTerminalWidth] = useState(80);
    const [terminalHeight, setTerminalHeight] = useState(24);
    const [offset, setOffset] = useState(0);
    const [activeGroup, setActiveGroup] = useState();
    const pending = useKeymapSelector((keymap) => keymap.getPendingSequence());
    const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }));
    const pendingActive = useMemo(() => pending().length > 0 && active().length > 0, [pending, active]);
    const pendingAutoVisible = useMemo(() => props.mode() === "overlay" && props.pendingPreview() && pendingActive, [props.mode(), props.pendingPreview(), pendingActive]);
    const visible = useMemo(() => props.pinned() || pendingAutoVisible, [props.pinned(), pendingAutoVisible]);
    const pendingMode = useMemo(() => visible && pendingActive, [visible, pendingActive]);
    const left = 0;
    const width = useMemo(() => Math.max(1, terminalWidth), [terminalWidth]);
    const panelHeight = useMemo(() => Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.floor(terminalHeight * PANEL_HEIGHT_RATIO))), [terminalHeight]);
    const contentWidth = useMemo(() => Math.max(1, width - 2), [width]);
    const columns = useMemo(() => Math.max(1, Math.min(3, Math.floor((contentWidth + COLUMN_GAP) / (MAX_COLUMN_WIDTH + COLUMN_GAP)) || 1)), [contentWidth]);
    const entries = useMemo(() => active().map((item) => activeKeyEntry(props.api, item)), [active]);
    const groups = useMemo(() => grouped(entries), [entries]);
    const tabsVisible = useMemo(() => !pendingMode && groups.length > 0, [pendingMode, groups]);
    const headerVisible = useMemo(() => tabsVisible || pendingMode, [tabsVisible, pendingMode]);
    const footerVisible = useMemo(() => !pendingMode, [pendingMode]);
    const rows = useMemo(() => Math.max(1, panelHeight -
        PANEL_TOP_PADDING -
        (headerVisible ? 1 : 0) -
        (tabsVisible ? TAB_CONTENT_GAP : 0) -
        (footerVisible ? FOOTER_MARGIN + FOOTER_HEIGHT : 0)), [panelHeight, headerVisible, tabsVisible, footerVisible]);
    const pageSize = useMemo(() => rows * columns, [rows, columns]);
    const currentGroup = useMemo(() => {
        return groups.find((item) => item.label === activeGroup) ?? groups[0];
    }, [activeGroup, groups]);
    const activeEntries = useMemo(() => currentGroup?.entries ?? [], [currentGroup]);
    const items = useMemo(() => {
        if (!pendingMode)
            return activeEntries;
        return groups.flatMap((group) => [{ type: "group", label: group.label }, ...group.entries]);
    }, [pendingMode, activeEntries, groups]);
    const maxOffset = useMemo(() => Math.max(0, items.length - pageSize), [items, pageSize]);
    const shown = useMemo(() => {
        const columnsItems = [];
        let index = offset;
        for (let column = 0; column < columns && index < items.length; column++) {
            const list = [];
            while (list.length < rows && index < items.length) {
                list.push(items[index]);
                index += 1;
            }
            columnsItems.push(list);
        }
        return columnsItems;
    }, [offset, columns, rows, items]);
    const rowIndexes = useMemo(() => Array.from({ length: rows }, (_, index) => index), [rows]);
    const trigger = commandShortcut(props.api, command.toggle);
    const modeTrigger = commandShortcut(props.api, command.toggleLayout);
    const upActive = useMemo(() => offset > 0, [offset]);
    const downActive = useMemo(() => offset < maxOffset, [offset, maxOffset]);
    const scrollable = useMemo(() => maxOffset > 0, [maxOffset]);
    const headerItems = useMemo(() => [
        ...(tabsVisible ? groups.map((group) => ({ type: "tab", group })) : []),
        ...(scrollable ? [{ type: "scroll" }] : []),
    ], [tabsVisible, groups, scrollable]);
    const tabGap = useMemo(() => {
        const itemCount = headerItems.length;
        if (itemCount <= 1)
            return 0;
        const itemWidth = headerItems.reduce((sum, item) => sum + (item.type === "tab" ? item.group.label.length + 2 : 3), 0);
        return Math.max(MIN_TAB_GAP, Math.min(TAB_GAP, Math.floor((contentWidth - itemWidth) / (itemCount - 1))));
    }, [headerItems, contentWidth]);
    const nextMode = useMemo(() => (props.mode() === "dock" ? "overlay" : "dock"), [props.mode()]);
    const look = useMemo(() => skin(props.api), []);
    const columnWidth = useMemo(() => Math.max(1, Math.min(MAX_COLUMN_WIDTH, Math.floor((contentWidth - (columns - 1) * COLUMN_GAP) / columns))), [contentWidth, columns]);
    const clamp = (value) => Math.max(0, Math.min(maxOffset, value));
    const scroll = (delta) => setOffset((value) => clamp(value + delta));
    const moveGroup = (delta) => {
        if (pendingMode)
            return;
        if (!groups.length)
            return;
        const index = Math.max(0, groups.findIndex((item) => item.label === currentGroup?.label));
        setActiveGroup(groups[(index + delta + groups.length) % groups.length].label);
        setOffset(0);
    };
    useBindings(() => ({
        priority: 1000,
        enabled: visible,
        commands: [
            {
                name: command.groupPrevious,
                title: "Previous key binding group",
                desc: "Show the previous which-key group",
                category: "System",
                run() { moveGroup(-1); },
            },
            {
                name: command.groupNext,
                title: "Next key binding group",
                desc: "Show the next which-key group",
                category: "System",
                run() { moveGroup(1); },
            },
            {
                name: command.scrollUp,
                title: "Scroll key bindings up",
                desc: "Scroll the which-key panel up",
                category: "System",
                run() { scroll(-columns); },
            },
            {
                name: command.scrollDown,
                title: "Scroll key bindings down",
                desc: "Scroll the which-key panel down",
                category: "System",
                run() { scroll(columns); },
            },
            {
                name: command.pageUp,
                title: "Page key bindings up",
                desc: "Page the which-key panel up",
                category: "System",
                run() { scroll(-pageSize); },
            },
            {
                name: command.pageDown,
                title: "Page key bindings down",
                desc: "Page the which-key panel down",
                category: "System",
                run() { scroll(pageSize); },
            },
            {
                name: command.home,
                title: "First key binding",
                desc: "Jump to the first which-key binding",
                category: "System",
                run() { setOffset(0); },
            },
            {
                name: command.end,
                title: "Last key binding",
                desc: "Jump to the last which-key binding",
                category: "System",
                run() { setOffset(maxOffset); },
            },
        ],
        bindings: pendingMode
            ? props.api.tuiConfig.keybinds.gather("which-key.scroll", scrollCommands)
            : props.api.tuiConfig.keybinds.gather("which-key.panel", panelCommands),
    }));
    useEffect(() => {
        if (pendingMode)
            return;
        const group = currentGroup;
        if (group?.label === activeGroup)
            return;
        setActiveGroup(group?.label);
    }, [pendingMode, currentGroup]);
    useEffect(() => {
        if (pendingMode)
            return;
        setOffset(0);
    }, [activeGroup, pendingMode]);
    useEffect(() => {
        if (!visible)
            setOffset(0);
    }, [visible]);
    useEffect(() => {
        setOffset(0);
    }, [pending()]);
    useEffect(() => {
        setOffset((value) => clamp(value));
    }, [maxOffset]);
    if (!visible)
        return null;
    return (_jsxs(Box, { position: props.layout === "overlay" ? "absolute" : "relative", zIndex: 3500, left: left, bottom: props.layout === "overlay" ? 0 : undefined, width: terminalWidth, height: panelHeight, backgroundColor: look.panel, paddingLeft: 1, paddingRight: 1, paddingTop: 1, flexShrink: 0, flexDirection: "column", children: [headerVisible && (_jsx(Box, { width: "100%", flexDirection: "row", justifyContent: "center", gap: tabGap, flexShrink: 0, children: headerItems.map((item, index) => {
                    if (item.type === "scroll") {
                        return (_jsx(Box, { flexShrink: 0, children: _jsxs(Text, { wrap: "truncate-end", children: [_jsx(Text, { color: upActive ? look.text : look.muted, children: '↑' }), _jsx(Text, { color: look.muted, children: " " }), _jsx(Text, { color: downActive ? look.text : look.muted, children: '↓' })] }) }, `scroll-${index}`));
                    }
                    const selected = currentGroup?.label === item.group.label;
                    return (_jsx(Box, { paddingLeft: 1, paddingRight: 1, flexShrink: 0, backgroundColor: selected ? look.tab : undefined, onClick: () => {
                            setActiveGroup(item.group.label);
                            setOffset(0);
                        }, children: _jsx(Text, { color: selected ? look.tabText : look.muted, bold: selected, wrap: "truncate-end", children: item.group.label }) }, item.group.label));
                }) })), tabsVisible && _jsx(Box, { height: TAB_CONTENT_GAP, flexShrink: 0 }), _jsx(Box, { height: rows, flexShrink: 0, flexDirection: "column", children: shown.length === 0 ? (_jsx(Text, { color: look.muted, children: "No reachable bindings" })) : (rowIndexes.map((row) => (_jsx(Box, { width: "100%", flexDirection: "row", justifyContent: "center", gap: COLUMN_GAP, children: shown.map((column, colIndex) => {
                        const item = column[row];
                        if (!item)
                            return _jsx(Box, { width: columnWidth }, colIndex);
                        if (item.type !== "entry") {
                            return (_jsx(Box, { width: columnWidth, flexDirection: "row", gap: 1, justifyContent: "space-between", children: _jsx(Text, { color: look.accent, bold: true, wrap: "truncate", children: item.label }) }, colIndex));
                        }
                        const binding = item;
                        return (_jsxs(Box, { width: columnWidth, flexDirection: "row", gap: 1, justifyContent: "space-between", children: [_jsx(Box, { flexGrow: 1, minWidth: 0, children: _jsx(Text, { color: binding.continues ? look.accent : look.muted, wrap: "truncate", children: binding.label }) }), _jsx(Box, { flexShrink: 0, children: _jsx(Text, { color: look.text, bold: true, wrap: "truncate", children: binding.key }) })] }, colIndex));
                    }) }, row)))) }), footerVisible && (_jsxs(_Fragment, { children: [_jsx(Box, { height: FOOTER_MARGIN, flexShrink: 0 }), _jsxs(Box, { width: "100%", flexDirection: "row", justifyContent: "space-between", flexShrink: 0, children: [_jsx(Box, { children: _jsxs(Text, { color: look.text, wrap: "truncate-end", children: ["toggle ", _jsx(Text, { color: look.subtle, children: trigger() || command.toggle })] }) }), _jsx(Box, { children: _jsxs(Text, { color: look.text, wrap: "truncate-end", children: [nextMode, " ", _jsx(Text, { color: look.subtle, children: modeTrigger() || command.toggleLayout })] }) })] })] }))] }));
}
const tui = async (api) => {
    const [pinned, setPinned] = useState(false);
    const [mode, setMode] = useState(layout(api.kv.get(KV_LAYOUT, "dock")));
    const [pendingPreview, setPendingPreview] = useState(api.kv.get(KV_PENDING_PREVIEW, false));
    api.keymap.registerLayer({
        priority: LAYER_PRIORITY,
        commands: [
            {
                name: command.toggle,
                title: "Show key bindings",
                desc: "Toggle which-key overlay",
                category: "System",
                run() { setPinned((value) => !value); },
            },
            {
                name: command.toggleLayout,
                title: "Toggle key bindings layout",
                desc: "Switch which-key between dock and overlay mode",
                category: "System",
                run() {
                    setMode((value) => {
                        const next = value === "dock" ? "overlay" : "dock";
                        api.kv.set(KV_LAYOUT, next);
                        return next;
                    });
                },
            },
            {
                name: command.togglePending,
                title: "Toggle pending key preview",
                desc: "Automatically show which-key for pending key sequences in overlay mode",
                category: "System",
                run() {
                    setPendingPreview((value) => {
                        api.kv.set(KV_PENDING_PREVIEW, !value);
                        return !value;
                    });
                },
            },
        ],
        bindings: api.tuiConfig.keybinds.gather("which-key.toggle", toggleCommands),
    });
    api.slots.register({
        order: 200,
        slots: {
            home_bottom() {
                return _jsx(HomeHint, { api: api });
            },
            app() {
                return mode === "overlay" ? (_jsx(WhichKeyPanel, { api: api, layout: "overlay", mode: () => mode, pendingPreview: () => pendingPreview, pinned: () => pinned })) : null;
            },
            app_bottom() {
                return mode === "dock" ? (_jsx(WhichKeyPanel, { api: api, layout: "dock", mode: () => mode, pendingPreview: () => pendingPreview, pinned: () => pinned })) : null;
            },
        },
    });
};
const plugin = {
    id: "which-key",
    enabled: false,
    tui,
};
export default plugin;
