# CLAUDE.md

Agent guide lives in [AGENTS.md](./AGENTS.md) — read it first; it is the
authoritative source for commands, verification discipline, generated
files and architecture boundaries.

Project-specific context beyond AGENTS.md:

- **What this is**: Maximilian is a self-evolving multi-agent OS — Hono api
  - BullMQ worker + React dashboard + ink TUI on top of an evolution engine
    (metrics → reflection → candidate generation → promotion) and a
    meta-system (capability lifecycle, proposals, truth audit).
- **Default models**: presets live in
  `packages/providers/src/presets/data.ts`; the live catalog
  (`ModelCatalog`, models.dev three-tier) overrides frozen preset strings
  at boot when attached. Never hardcode a model id in code — use
  `registry.getEffectiveDefaultModel(id)`.
- **Local run**: `pnpm dev` (or `pnpm start:all` for the full stack with
  evolution + meta agent on). API on :3001, dashboard on :5173.
- **Borrowing discipline**: upstream reference clones live in
  `../borrowings/` and sibling directories — they are READ-ONLY study
  material. Never import from them, never add them to the workspace, and
  record every borrowed idea (with provenance and honesty boundaries) in
  `docs/borrowings-update-*.md`.
- **Multi-agent frontend work**: follow `apps/dashboard/CONVENTIONS.md`
  (file ownership, feature-domain i18n, model/presentation split).
