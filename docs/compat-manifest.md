# Compatibility manifest

Machine-readable companion of `scripts/compat-check.mjs` (hermes
COMPAT_MANIFEST borrowing). Every symbol shipped in a released `@max/*`
package that consumers may depend on is tracked here in one of three
states. The manifest is the contract: removal before the stated milestone
is a breaking change and needs an ADR.

## Format

| field           | meaning                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| symbol          | exported name + package (`@max/core#RemoteError`)                                                                   |
| state           | `active` · `deprecated` (replacement exists; removal at milestone) · `moved` (old path re-exports; will be deleted) |
| since / removal | introduced / planned removal milestone (version or date)                                                            |
| replacement     | what to migrate to                                                                                                  |

## Entries

| symbol                                               | state                                           | since | removal  | replacement                       |
| ---------------------------------------------------- | ----------------------------------------------- | ----- | -------- | --------------------------------- |
| @max/core#loadProviderCredentialsFromVault           | active                                          | 1.0.0 | —        | —                                 |
| @max/session-store#SessionStore.consumeSteering      | active                                          | 0.1.0 | —        | —                                 |
| @max/session-store#SessionStore.consumeSteeringTexts | active                                          | 1.1.0 | —        | —                                 |
| @max/providers#RemoteCatalogSynchronizer             | active (library; no runtime consumer by design) | 1.1.0 | —        | ModelCatalog built-in refresh     |
| @max/queue#CrashBudget                               | active                                          | 1.1.0 | —        | —                                 |
| @max/providers (legacy in-process surface)           | deprecated                                      | 0.9.0 | Phase 4a | opencode kernel via core-thin-sdk |
| @max/llm (legacy in-process surface)                 | deprecated                                      | 0.9.0 | Phase 4a | opencode kernel via core-thin-sdk |

Rules:

1. A `deprecated` entry MUST name its replacement and removal milestone.
2. `scripts/compat-check.mjs` fails when a symbol past its removal
   milestone still exists in source.
3. SDK consumers can diff their usage against this file to detect
   upcoming breakage programmatically.
