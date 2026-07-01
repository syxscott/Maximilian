/**
 * Frecency tracking for file paths used by the prompt autocomplete. Each
 * path accumulates a frequency count and `lastOpen` timestamp; callers
 * compute a recency-weighted score with `getFrecency(path)`.
 *
 * Ported from OpenCode's SolidJS `prompt/frecency.tsx`. The original loaded
 * the JSONL file inside `onMount`; we use `useEffect` for parity.
 */
import { useCallback, useEffect, useState } from "react";
import path from "node:path";
import { createSimpleContext } from "../../context/helper";
import { useTuiPaths } from "../../context/runtime";
export const MAX_FRECENCY_ENTRIES = 1000;
export function parseFrecency(text) {
    const latest = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return undefined;
        }
    })
        .filter((line) => line !== undefined)
        .reduce((result, entry) => {
        result[entry.path] = entry;
        return result;
    }, {});
    return Object.values(latest)
        .sort((a, b) => b.lastOpen - a.lastOpen)
        .slice(0, MAX_FRECENCY_ENTRIES);
}
function calculateFrecency(entry) {
    if (!entry)
        return 0;
    return entry.frequency / (1 + (Date.now() - entry.lastOpen) / 86400000);
}
async function readText(file) {
    const fs = await import("node:fs/promises");
    try {
        return await fs.readFile(file, "utf8");
    }
    catch {
        return "";
    }
}
async function appendText(file, chunk) {
    const fs = await import("node:fs/promises");
    await fs.appendFile(file, chunk, "utf8");
}
async function writeText(file, content) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(file, content, "utf8");
}
export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
    name: "Frecency",
    init: () => {
        const paths = useTuiPaths();
        const frecencyPath = path.join(paths.state, "frecency.jsonl");
        const [data, setData] = useState({});
        useEffect(() => {
            let cancelled = false;
            void readText(frecencyPath).then((text) => {
                if (cancelled)
                    return;
                const lines = parseFrecency(text);
                setData(Object.fromEntries(lines.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }])));
                if (lines.length > 0) {
                    void writeText(frecencyPath, lines.map((entry) => JSON.stringify(entry)).join("\n") + "\n").catch(() => { });
                }
            });
            return () => {
                cancelled = true;
            };
        }, [frecencyPath]);
        const updateFrecency = useCallback((filePath) => {
            const absolutePath = path.resolve(paths.cwd, filePath);
            let persisted = data;
            setData((prev) => {
                const existing = prev[absolutePath];
                const next = {
                    ...prev,
                    [absolutePath]: { frequency: (existing?.frequency || 0) + 1, lastOpen: Date.now() },
                };
                if (Object.keys(next).length <= MAX_FRECENCY_ENTRIES) {
                    persisted = next;
                    void appendText(frecencyPath, JSON.stringify({ path: absolutePath, ...next[absolutePath] }) + "\n").catch(() => { });
                    return next;
                }
                const sorted = Object.entries(next)
                    .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
                    .slice(0, MAX_FRECENCY_ENTRIES);
                const trimmed = Object.fromEntries(sorted);
                persisted = trimmed;
                void writeText(frecencyPath, sorted
                    .map(([entryPath, entry]) => JSON.stringify({ path: entryPath, ...entry }))
                    .join("\n") + "\n").catch(() => { });
                return trimmed;
            });
            void persisted;
        }, [data, frecencyPath, paths.cwd]);
        const getFrecency = useCallback((filePath) => {
            const absolutePath = path.resolve(paths.cwd, filePath);
            return calculateFrecency(data[absolutePath]);
        }, [data, paths.cwd]);
        return {
            getFrecency,
            updateFrecency,
            data: () => data,
        };
    },
});
