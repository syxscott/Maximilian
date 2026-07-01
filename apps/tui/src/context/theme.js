/**
 * Theme context for the Maximilian TUI.
 *
 * Ported from OpenCode's SolidJS `theme.tsx`. The original used
 * `@opentui/core` SyntaxStyle / RGBA primitives, plus `useRenderer` from
 * `@opentui/solid` for terminal palette detection.
 *
 * Maximilian's TUI is built on ink (React 19), which doesn't expose a custom
 * terminal renderer. We therefore model themes as plain string-keyed color
 * objects compatible with chalk-style consumers and `ink`'s `color` prop.
 * System palette detection and `CLI_RENDER_EVENTS` are stubbed behind a
 * no-op subscription so callers don't need to change.
 */
import { createContext, createElement, useMemo } from "react";
import { createSimpleContext } from "./helper";
const darkDefault = {
    background: "#0e0e10",
    backgroundPanel: "#18181b",
    backgroundElement: "#27272a",
    backgroundMenu: "#1f1f23",
    border: "#3f3f46",
    borderActive: "#52525b",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    primary: "#60a5fa",
    secondary: "#a78bfa",
    accent: "#34d399",
    success: "#22c55e",
    warning: "#facc15",
    error: "#f87171",
    info: "#38bdf8",
    diffAdded: "#22c55e",
    diffRemoved: "#ef4444",
    diffAddedBg: "#052e16",
    diffRemovedBg: "#3f0d12",
    diffContextBg: "#18181b",
    diffHighlightAdded: "#86efac",
    diffHighlightRemoved: "#fca5a5",
    diffLineNumber: "#71717a",
    diffAddedLineNumberBg: "#14532d",
    diffRemovedLineNumberBg: "#7f1d1d",
    markdownText: "#e4e4e7",
};
export const DEFAULT_THEMES = {
    opencode: { name: "opencode", mode: "dark", colors: darkDefault },
};
export const allThemes = () => ({ ...DEFAULT_THEMES });
export function hasTheme(name) {
    return name in DEFAULT_THEMES;
}
export function isTheme(value) {
    return !!value && typeof value === "object" && "name" in value && "colors" in value;
}
export function resolveTheme(json, _mode) {
    return { ...darkDefault, ...json.colors };
}
export function generateSystem(_colors, mode) {
    return { name: "system", mode, colors: darkDefault };
}
export function generateSyntax(_theme) {
    // ink has no native syntax highlighting; consumers should layer in
    // something like `cli-highlight` if they need it.
    return null;
}
export function generateSubtleSyntax(theme) {
    return generateSyntax(theme);
}
export function selectedForeground(_theme, background) {
    return background ?? "#ffffff";
}
export function setCustomThemes(_themes) {
    /* no-op: ink-based TUI keeps themes in-memory only */
}
export function setSystemTheme(_theme) {
    /* no-op */
}
export function subscribeThemes(_listener) {
    return () => { };
}
export function terminalMode(_colors) {
    return undefined;
}
export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
    name: "Theme",
    init: (props) => {
        const initial = DEFAULT_THEMES.opencode;
        const theme = useMemo(() => resolveTheme(initial, props.mode), [props.mode]);
        return {
            theme,
            selected: initial.name,
            all: allThemes,
            has: hasTheme,
            syntax: generateSyntax(theme),
            subtleSyntax: generateSubtleSyntax(theme),
            mode: () => props.mode,
            locked: () => false,
            lock: () => { },
            unlock: () => { },
            setMode: () => { },
            set: (name) => hasTheme(name),
            ready: true,
        };
    },
});
/**
 * Re-export so consumers can avoid importing `@opentui/core`. Returns a
 * `null`-shaped stand-in that is safe to spread into ink props.
 */
export function createSyntaxStyleMemo(factory) {
    return () => factory();
}
// Standalone helper retained so consumers that expect a JSX component can use
// `<ThemeContext.Provider value={...}>` directly if they bypass `ThemeProvider`.
export const ThemeContext = createContext(undefined);
export function ThemeInlineProvider(props) {
    return createElement(ThemeContext.Provider, { value: props.value }, props.children);
}
