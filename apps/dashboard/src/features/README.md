# Feature federation (deepseek ui-* borrowing)

Each directory under `features/<domain>/` is a SELF-CONTAINED feature
domain — the dashboard's unit of product:

    features/<domain>/
      index.ts        # public surface: export * from the entry component(s)
      model.ts        # pure view-model derivation (unit-tested)
      <Component>.tsx # presentation
      ...additional pieces as the domain grows

Rules:

1. A domain may import from `@/components/ui/*` primitives, `@/lib/*`,
   `@/hooks/*`, `@/api`, and OTHER domains' public `index.ts` — never
   another domain's internals.
2. `src/components/` holds CROSS-domain shared components only; domain-
   specific panels belong here.
3. `src/components/tool-renderers/`, `ai-elements/`, `settings/` and the
   live surfaces keep their historical paths until the E-batch migration
   moves them; new domains start here directly.
4. Every domain registers its strings under `src/locales/<domain>.*.json`
   (flat dotted keys namespaced by domain) — the aggregator in
   `src/locales/index.ts` flattens and merges them at boot.
