# Feature-domain i18n dictionaries

One JSON pair per feature domain: `<domain>.zh-CN.json` + `<domain>.en-US.json`.
Merged into the registered locales at boot by `lib/i18n-merge.ts` (via
`src/locales/index.ts`). Keys must be namespaced by domain
(`"toolRenderers.bash.command"`) and placeholders `{name}` are preserved
verbatim.
