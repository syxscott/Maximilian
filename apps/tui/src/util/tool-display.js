export function webSearchProviderLabel(provider) {
    if (provider === "parallel")
        return "Parallel Web Search";
    if (provider === "exa")
        return "Exa Web Search";
    return "Web Search";
}
export function toolDisplayMetadata(state) {
    if (!state || typeof state !== "object" || Array.isArray(state))
        return {};
    if (!("status" in state) || state.status === "pending")
        return {};
    if (!("structured" in state) || !state.structured || typeof state.structured !== "object")
        return {};
    if (Array.isArray(state.structured))
        return {};
    return state.structured;
}
