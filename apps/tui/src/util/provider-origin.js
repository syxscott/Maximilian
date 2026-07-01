const contains = (consoleManagedProviders, providerID) => Array.isArray(consoleManagedProviders)
    ? consoleManagedProviders.includes(providerID)
    : consoleManagedProviders.has(providerID);
export const isConsoleManagedProvider = (consoleManagedProviders, providerID) => contains(consoleManagedProviders, providerID);
