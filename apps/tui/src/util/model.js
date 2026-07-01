export function parse(value) {
    const [providerID, ...modelID] = value.split("/");
    return { providerID, modelID: modelID.join("/") };
}
export function index(list) {
    return new Map((list ?? []).map((item) => [item.id, item]));
}
export function get(list, providerID, modelID) {
    const provider = list instanceof Map
        ? list.get(providerID)
        : Array.isArray(list)
            ? list.find((item) => item.id === providerID)
            : undefined;
    return provider?.models[modelID];
}
export function name(list, providerID, modelID) {
    return get(list, providerID, modelID)?.name ?? modelID;
}
