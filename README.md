# Claude Superbrain

**Actionable full-stack observability for your development life.**

Datadog for your projects. Honeycomb for your workflow. A Postgres-backed brain that watches every repo, every running service, every Claude Code session you run across every device — and gives you one briefing each morning.

```
$ brain standup
────────────────────────────────────────────────────────────
GOOD MORNING — Friday, April 17, 2026
────────────────────────────────────────────────────────────

NEEDS YOU TODAY
  !  portfolio-v3: uncommitted for 18d
      Branch main has uncommitted changes; last activity 18 days ago.
      → cd portfolio-v3 && git status
  !  invoicing-tool: 3 unpushed commits
      Branch feat/webhooks is 3 commits ahead of upstream.
      → cd invoicing-tool && git push

IN FLIGHT (last 7d)
  kingmaker-brain  active dirty  2h ago
      Postgres-backed actionable observability for your dev life
      last: phase 1.5 — transcripts + standup  2h ago
      next.js · uses postgres,openai · 3 TODOs
  client-x-admin   shipped       2d ago
      Admin dashboard for Client X
      → fly.io · uses stripe,postgres

RECENT CLAUDE SESSIONS
  mac-studio    kingmaker-brain    2h  2h ago
      › scrap phase 1, add transcripts + standup
  macbook-air   client-x-admin    45m  2d ago
      › fix the auth redirect loop

OPEN LOOPS
  §  kingmaker-brain   tomorrow we'll add the infra scanner
      18h ago
  ⌕  invoicing-tool    TODO: refactor webhook after tests pass
      5d ago  src/webhooks.ts:42

BACKLOG
  6 stale · 12 abandoned — `brain projects --status stale`
```

## What it observes

| Observability concept | Your stack |
| --- | --- |
| **Metrics** | project count, commits/day, running services, TODOs, deploy targets |
| **Logs** | Claude Code transcripts (every session, every device), git commits |
| **Traces** | import graph, repo → services → deploys *(phase 2+)* |
| **Alerts** | CI failed, deploy failed, uncommitted/unpushed stale, service down |
| **Dashboards** | `brain standup`, `brain project <name>`, web UI *(phase 4)* |
| **Actions** | `brain fix <alert>` spawns a headless Claude Code session *(phase 5)* |

## Repository layout

```
packages/
  db/          Postgres schema + migrations + pg client
  shared/      Logger, TOML config, zod env validation
  indexer/     Collectors: git, manifests, project-context, transcripts
               + alert deriver
  cli/         `brain` command (standup, projects, alerts, transcripts, …)
infra/
  docker-compose.yml    Local pg16 + pgvector
```

## Quickstart

```bash
corepack enable
pnpm install
pnpm db:up              # Postgres 16 + pgvector in Docker
pnpm db:migrate         # applies migrations (0001 + 0002)
pnpm brain init         # discover + scan + transcript sync + alert derivation
pnpm brain standup      # the morning briefing
```

After `init`, everything is in the DB. Re-run any time:

```bash
pnpm brain scan                 # full re-scan + transcripts + alerts
pnpm brain scan ~/code/foo      # rescan one project
pnpm brain transcripts sync     # just transcripts
pnpm brain alerts refresh       # just re-derive alerts
```

## Core commands

| Command | What it does |
| --- | --- |
| `brain standup` | The morning briefing. Needs-attention, in-flight, recent sessions, open loops, backlog. |
| `brain init` | Discover project roots under `~/code`, `~/work`, etc. Run first. |
| `brain scan [path]` | Re-scan everything (or one path). Also syncs transcripts + derives alerts. |
| `brain projects [--status X] [--dep pkg]` | List indexed projects. |
| `brain project <name>` | Full project view: branches, open alerts, open loops, recent Claude sessions. |
| `brain alerts [list \| refresh \| ack <id> \| resolve <id>]` | Manage open attention items. |
| `brain transcripts [sync \| list]` | Manage Claude Code session ingestion. |
| `brain git [--dirty]` | Git state across projects. |
| `brain deps [project \| --across pkg]` | Dependency queries. |
| `brain search <q>` | Lexical search across projects/files/symbols/deps. |

## What's in the DB

- `projects` — root path, name, kind, status (active/shipped/prototype/stale/abandoned), summary, framework, service tokens, deploy targets, TODO count, last-commit-at
- `git_branches`, `git_commits` — per-project git state
- `dependencies` — parsed from every manifest (npm, cargo, go.mod, pyproject, requirements.txt, Gemfile)
- `cc_sessions` — every Claude Code session transcript, per device, matched back to the project by cwd
- `open_loops` — things you said you'd do (extracted from transcripts) or TODO/FIXME comments in source
- `alerts` — actionable attention items, derived heuristically and dedup'd
- `scan_runs` — observability on the observer itself
- …plus tables for files, symbols, imports, secrets refs, infra resources, embeddings (populated in later phases)

## Roadmap

- **Phase 1** ✓ — monorepo scaffold, Postgres schema, git + manifest scanners, `brain projects/git/deps/search/scan`
- **Phase 1.5** ✓ — project context enrichment (README, framework, infra files, TODO grep), Claude Code transcript ingestion, open loops, alert derivation, `brain standup`
- **Phase 2** — fs-watch daemon, local infra scanner (`docker ps`, dev-server port detection), LLM-synthesized project summaries, embeddings for semantic recall
- **Phase 3** — cross-device transcript sync (Tailscale → shared Postgres on home-lab / Railway)
- **Phase 4** — web dashboard (Next.js), deploy-target API integrations (Vercel, Railway, Fly), GitHub PR/CI integration
- **Phase 5** — action layer (`brain fix <alert>` spawns headless Claude Code sessions), MCP server mode so Claude Desktop can query everything natively
- **Phase 6** — Notion/Linear/Slack ingestion for a truly unified second brain

## Environment

Copy `.env.example` to `.env` if your local Postgres isn't at the default `postgres://postgres:postgres@localhost:5432/brain`.

The `brain init` command writes config to `~/.config/brain/config.toml`.
