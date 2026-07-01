import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useMemo, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
function fuzzyScore(needle, hay) {
    if (!hay)
        return 0;
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();
    if (h.includes(n))
        return 100 - h.indexOf(n);
    let score = 0;
    let i = 0;
    for (const ch of h) {
        if (i < n.length && ch === n[i]) {
            score += 5;
            i += 1;
        }
    }
    return i === n.length ? score : 0;
}
export function sortModelOptions(options, newestFirst) {
    const copy = [...options];
    if (newestFirst) {
        return copy.sort((a, b) => {
            const ar = a.releaseDate ?? "";
            const br = b.releaseDate ?? "";
            if (ar !== br)
                return br < ar ? -1 : 1;
            return a.title.localeCompare(b.title);
        });
    }
    return copy.sort((a, b) => {
        const aFree = a.footer === "Free";
        const bFree = b.footer === "Free";
        if (aFree !== bFree)
            return aFree ? -1 : 1;
        return a.title.localeCompare(b.title);
    });
}
export function DialogModel(props) {
    const [query, setQuery] = useState(props.query ?? "");
    const items = useMemo(() => {
        const needle = query.trim();
        const showSections = props.connected && !props.providerID && needle.length === 0;
        const favorites = props.connected ? props.favorites ?? [] : [];
        const recents = props.recents ?? [];
        const favoriteOptions = showSections
            ? favorites.flatMap((item) => {
                const provider = props.providers.find((p) => p.id === item.providerID);
                if (!provider)
                    return [];
                const model = provider.models[item.modelID];
                if (!model)
                    return [];
                return [
                    {
                        label: model.name ?? item.modelID,
                        value: { providerID: provider.id, modelID: model.id ?? item.modelID },
                        description: provider.name,
                        disabled: provider.id === "opencode" && (model.id ?? "").includes("-nano"),
                    },
                ];
            })
            : [];
        const recentOptions = showSections
            ? recents
                .filter((item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID))
                .flatMap((item) => {
                const provider = props.providers.find((p) => p.id === item.providerID);
                if (!provider)
                    return [];
                const model = provider.models[item.modelID];
                if (!model)
                    return [];
                return [
                    {
                        label: model.name ?? item.modelID,
                        value: { providerID: provider.id, modelID: model.id ?? item.modelID },
                        description: provider.name,
                        disabled: provider.id === "opencode" && (model.id ?? "").includes("-nano"),
                    },
                ];
            })
            : [];
        const providerOptions = props.providers
            .slice()
            .sort((a, b) => {
            const aIsOC = a.id === "opencode" ? 0 : 1;
            const bIsOC = b.id === "opencode" ? 0 : 1;
            if (aIsOC !== bIsOC)
                return aIsOC - bIsOC;
            return a.name.localeCompare(b.name);
        })
            .flatMap((provider) => {
            return Object.entries(provider.models)
                .filter(([_, info]) => info.status !== "deprecated")
                .filter(([_, info]) => props.providerID ? info.providerID === props.providerID : true)
                .map(([modelID, info]) => {
                const id = info.id ?? modelID;
                const isFavorite = favorites.some((fav) => fav.providerID === provider.id && fav.modelID === modelID);
                const isRecent = recents.some((item) => item.providerID === provider.id && item.modelID === modelID);
                const isFree = info.cost?.input === 0 && provider.id === "opencode";
                return {
                    label: info.name ?? modelID,
                    value: { providerID: provider.id, modelID: id },
                    description: isFavorite ? "(Favorite)" : undefined,
                    disabled: provider.id === "opencode" && id.includes("-nano"),
                    footer: isFree ? "Free" : undefined,
                    _releaseDate: info.release_date,
                    _showSections: showSections,
                    _isFavorite: isFavorite,
                    _isRecent: isRecent,
                };
            })
                .filter((option) => {
                if (!showSections)
                    return true;
                const o = option;
                if (o._isFavorite)
                    return false;
                if (o._isRecent)
                    return false;
                return true;
            })
                .map(({ _releaseDate, _showSections, _isFavorite, _isRecent, ...rest }) => {
                void _showSections;
                void _isFavorite;
                void _isRecent;
                return { ...rest, _releaseDate };
            });
        });
        const sortedProvider = sortModelOptions(providerOptions, props.providerID !== undefined).map((opt) => {
            const { _releaseDate, ...rest } = opt;
            void _releaseDate;
            return rest;
        });
        const all = [...favoriteOptions, ...recentOptions, ...sortedProvider];
        if (needle) {
            const scored = all
                .map((opt) => ({
                opt,
                score: Math.max(fuzzyScore(needle, opt.label), fuzzyScore(needle, opt.description) / 2),
            }))
                .filter((entry) => entry.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((entry) => entry.opt);
            return scored;
        }
        return all;
    }, [props.providers, props.connected, props.providerID, props.favorites, props.recents, query]);
    const title = useMemo(() => {
        if (!props.providerID)
            return "Select model";
        const p = props.providers.find((item) => item.id === props.providerID);
        return p?.name ?? "Select model";
    }, [props.providerID, props.providers]);
    const handleSelect = (item) => {
        if (item.disabled)
            return;
        props.onSelect?.(item.value.providerID, item.value.modelID);
    };
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, children: title }), _jsx(Text, { dimColor: true, children: "esc" })] }), _jsxs(Box, { marginY: 1, children: [_jsx(Text, { children: "Search: " }), _jsx(TextInput, { value: query, onChange: (v) => {
                            setQuery(v);
                            props.onChangeQuery?.(v);
                        } })] }), _jsx(Box, { children: _jsx(SelectInput, { items: items, onSelect: handleSelect, itemComponent: ({ isSelected, label, value }) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: isSelected ? "green" : undefined, children: label }), props.current?.providerID === value.providerID && props.current?.modelID === value.modelID && (_jsx(Text, { dimColor: true, children: " (current)" }))] })) }) })] }));
}
export default DialogModel;
