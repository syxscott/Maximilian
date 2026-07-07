# Tutorial 01: Quickstart — Hello Meta-Agent

> **Length**: 3 minutes
> **Audience**: someone who just installed Maximilian
> **Goal**: end-to-end first run + first meta-agent decision

## Pre-roll (10s)

Voice-over:
> "Maximilian is a meta-agent OS — agents that build, evaluate, and
> retire other agents. In three minutes, we'll go from zero to a
> running meta-agent decision."

Visual: Maximilian logo + tagline on a black background.

## Shot 1 — Clone & install (20s)

```bash
git clone https://github.com/syxscott/Maximilian.git
cd Maximilian
pnpm install
```

VO: "Clone, install. One command. The monorepo installs 21 packages."

Cut to: install completes in ~30s.

## Shot 2 — Boot the dev stack (30s)

```bash
cp .env.example .env
# Edit .env: set LLM_DEFAULT_PROVIDER, ANTHROPIC_API_KEY
pnpm dev
```

VO: "Copy the env template, set your LLM key, and run pnpm dev. This
boots the API, the dashboard, and the worker."

Visual: terminal showing three services starting up. Browser tab
opens to `http://localhost:5173`.

## Shot 3 — Send first request (30s)

In another terminal:

```bash
curl -X POST http://localhost:3000/v1/executions \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"demo","input":"plan a 3-day trip to Tokyo"}'
```

VO: "Send a request. Maximilian's commander reads it, picks an agent,
plans the steps, and starts executing."

Visual: dashboard updates live, showing task graph.

## Shot 4 — Show the meta-system (45s)

VO: "After a few runs, the meta-system kicks in. It looks at which
agents succeeded, which failed, and proposes changes."

Switch to dashboard tab **Meta-system**:

- Show capability discovery graph growing.
- Show a `birth` proposal being generated.
- Show the proposal being auto-approved (because `META_AGENT_ENABLED=true`).

VO: "Birth, promote, retire — all automatic. With governance on, you
approve each one. With it off, Maximilian evolves itself."

## Shot 5 — Wrap-up (15s)

VO: "That's Maximilian. Three commands, one meta-agent decision.
Tutorials 02-04 dig into TruthAudit, self-evolution, and the Digital
Twin."

Visual: links to docs and other tutorials.

## Errors to show (bonus, optional)

If the LLM key is missing, show:

```
Error: ANTHROPIC_API_KEY is required
  See docs/getting-started.md#api-keys
```

And the fix. Authenticity > polish.

## Recording checklist

- [ ] Clear terminal history before recording.
- [ ] Use a fresh DB (`pnpm --filter @max/database reset`).
- [ ] Pre-populate `.env` so no awkward typing on camera.
- [ ] Test the full flow once before recording.
- [ ] Record in 30s chunks; re-do any with a stumble.

## Post-production

- Add chapter markers at shot boundaries.
- Auto-generate SRT from VO script.
- Export 1920×1080 H.264 + AAC.