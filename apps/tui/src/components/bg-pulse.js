import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
function usePulse(periodMs = 1600) {
    const [phase, setPhase] = React.useState(0);
    React.useEffect(() => {
        const start = Date.now();
        const id = setInterval(() => {
            setPhase(((Date.now() - start) % periodMs) / periodMs);
        }, 80);
        return () => clearInterval(id);
    }, [periodMs]);
    return phase;
}
export function BgPulse({ width = "100%", height = "100%", primary = "yellow", logoBase = "gray", }) {
    const phase = usePulse();
    const rows = 8;
    const cols = 24;
    return (_jsx(Box, { flexDirection: "column", width: width, height: height, alignItems: "center", justifyContent: "center", children: Array.from({ length: rows }).map((_, r) => (_jsx(Box, { flexDirection: "row", children: Array.from({ length: cols }).map((__, c) => {
                // Diagonal wave: cells closer to the origin get brighter.
                const dx = c + 0.5 - 4.5;
                const dy = (r + 0.5) * 2 - 13.5;
                const dist = Math.hypot(dx, dy);
                const _falloff = Math.exp(-(dist * dist) / 24);
                void _falloff;
                const lit = (r + c + Math.floor(phase * 6)) % 5 === 0;
                const color = lit ? primary : logoBase;
                const char = lit ? "▓" : " ";
                return (_jsx(Text, { color: color, children: char }, c));
            }) }, r))) }));
}
export default BgPulse;
