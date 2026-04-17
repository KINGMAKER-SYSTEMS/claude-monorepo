# Claude Superbrain

A Postgres-backed "superbrain" that indexes every project and piece of infrastructure on your machine, exposes it to Claude Code / Claude Desktop via a rich `brain` CLI (with MCP server mode), and mirrors the data to a Railway-hosted cloud instance reachable from any device over Tailscale.

Designed so Claude Desktop routines can perform **targeted maintenance across an entire agency's project estate**: dep audits, drift detection, secret rotation, service-map analysis, and cross-project refactors.

## Repository Layout

```
packages/
  db/          Drizzle schema + migrations + pg client
  shared/      Shared types, zod schemas, pino logger, config
  indexer/     Scanner pipeline (git, manifests, ...)
  cli/         `brain` command
infra/
  docker-compose.yml    Local pg16 + pgvector
```

More packages (`embeddings`, `sync`, `api`, `web`, `daemon`) land in later phases — see `/root/.claude/plans/i-want-to-explore-greedy-marble.md` for the full plan.

## Phase 1 Status

Day-1 routine this phase enables: **Inventory & Health Sweep** — "Monday agency standup: dirty branches, outdated deps, running dev servers across every project."

Currently implemented:
- Monorepo scaffold (pnpm + turbo + TS 5.6)
- Local Postgres 16 + pgvector via docker-compose
- `@brain/db` — Drizzle schema and migrations
- `@brain/shared` — logger, zod config
- `@brain/indexer` — git + manifest scanners, project-root walker
- `@brain/cli` — `brain init`, `projects`, `project`, `deps`, `git`, `search`, `scan`

## Quickstart (on a real machine, not this remote session)

```bash
corepack enable
pnpm install
pnpm db:up            # starts local pg16 + pgvector in Docker
pnpm db:migrate       # applies migrations
pnpm build
pnpm brain init       # discovers projects under ~/code, ~/work, ...
pnpm brain projects   # lists indexed projects
pnpm brain deps --outdated
```

Or install the CLI globally once built:

```bash
pnpm --filter @brain/cli link --global
brain init
brain projects
```

## Environment

Copy `.env.example` to `.env` and adjust if your local Postgres runs elsewhere.

## Full Plan

See `/root/.claude/plans/i-want-to-explore-greedy-marble.md` for the full phased roadmap through cloud sync (Railway), Tailscale, web dashboard, and MCP integration.
