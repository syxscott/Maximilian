/**
 * Parsed CLI args exposed as a context. The actual parsing happens before the
 * app mounts (see `apps/tui/src/index.tsx`); this context just packages the
 * parsed value for descendants via `createSimpleContext`.
 */
import { createSimpleContext } from "./helper";
export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
    name: "Args",
    init: (props) => props,
});
