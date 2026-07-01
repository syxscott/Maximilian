export function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
