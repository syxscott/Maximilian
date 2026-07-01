/**
 * Exit function exposed via context. SolidJS used `createSimpleContext` to
 * share a single `exit(reason?)` callback; we mirror the same shape here.
 */
import { createSimpleContext } from "./helper";
export const { use: useExit, provider: ExitProvider } = createSimpleContext({
    name: "Exit",
    init: (input) => input.exit,
});
