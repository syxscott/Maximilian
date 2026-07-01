import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
// Maximilian ASCII logo art (two-column layout that mirrors the visual style
// of OpenCode's wordmark without copying the exact glyphs).
const LOGO_LEFT = [
    " ███╗   ███╗",
    " ████╗ ████║",
    " ██╔████╔██║",
    " ██║╚██╔╝██║",
    " ██║ ╚═╝ ██║",
    " ╚═╝     ╚═╝",
];
const LOGO_RIGHT = [
    "  █████╗  ",
    " ██╔══██╗ ",
    " ███████║ ",
    " ██╔══██║ ",
    " ██║  ██║ ",
    " ╚═╝  ╚═╝ ",
];
export function Logo({ width = 14, color = "cyan", animated = false }) {
    // `animated` is reserved for future sub-pixel shimmer. In this port we
    // render statically; the flag is accepted to keep API parity with OpenCode.
    void animated;
    const lines = React.useMemo(() => {
        const out = [];
        const max = Math.max(LOGO_LEFT.length, LOGO_RIGHT.length);
        for (let i = 0; i < max; i++) {
            const left = LOGO_LEFT[i] ?? "";
            const right = LOGO_RIGHT[i] ?? "";
            out.push((left + right).padEnd(width, " "));
        }
        return out;
    }, [width]);
    return (_jsx(Box, { flexDirection: "column", alignItems: "center", children: lines.map((line, i) => (_jsx(Text, { color: color, bold: i === 0, children: line }, i))) }));
}
export default Logo;
