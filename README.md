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
  indexer/     Collectors: git, manifests, project-context, transcripts,
               docker+dev-servers, + alert deriver
  daemon/      fs-watch daemon, Unix-socket IPC, periodic ticks
  embedder/    Pluggable embedders (OpenAI default, Voyage, Ollama),
               LLM summary + open-loop refinement
  cli/         `brain` command (standup, projects, alerts, transcripts,
               watch, status, ask, summarize, refine, …)
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
| `brain ask <q>` | Semantic search across summaries, transcripts, open loops. |
| `brain watch [--detach]` | Run the background daemon (fs-watch + periodic ticks). |
| `brain status` / `brain stop` | Inspect or terminate the running daemon. |
| `brain summarize` | Generate LLM summaries for projects and embed them. |
| `brain refine` | Rewrite messy open loops into actionable next steps. |
| `brain doctor` | Verify DB, migrations, daemon, embedder, API keys. |
| `brain mcp` | Start the MCP server on stdio (for Claude Desktop Routines). |

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
- **Phase 2** ✓ — fs-watch daemon (`brain watch`), local infra scanner (`docker ps` + `lsof` dev servers, `service_down` / `port_conflict` alerts), pluggable embedder (OpenAI default + Voyage + Ollama), LLM-synthesized project summaries via Haiku, open-loop refinement, `brain ask` semantic search
- **Phase 3** — cross-device transcript sync (Tailscale → shared Postgres on home-lab / Railway)
- **Phase 4** — web dashboard (Next.js), deploy-target API integrations (Vercel, Railway, Fly), GitHub PR/CI integration
- **Phase 2.5** ✓ — MCP server for Claude Desktop + Routines (`brain_standup`, `brain_ask`, `brain_project_detail`, …). No Anthropic API key required — the Desktop app is the LLM.
- **Phase 5** — action layer (`brain fix <alert>` spawns headless Claude Code sessions)
- **Phase 6** — Notion/Linear/Slack ingestion for a truly unified second brain

## Claude Desktop MCP + Routines

The brain exposes itself as an MCP server so Claude Desktop can call it
directly — no Anthropic API key needed, the Desktop app's subscription is
the LLM.

**Install:**

```bash
./scripts/install-mcp.sh
# then: quit + relaunch Claude Desktop
```

The script merges a `brain` entry into your existing
`~/Library/Application Support/Claude/claude_desktop_config.json` without
clobbering other MCP servers. Uninstall with `./scripts/install-mcp.sh --uninstall`.

**Exposed tools** (all read-only, no destructive ops):

| Tool | Purpose |
|------|---------|
| `brain_doctor` | Health check — start here if anything else errors |
| `brain_standup` | The morning-briefing snapshot (alerts + in-flight + loops + sessions + infra) |
| `brain_projects` | List / filter projects |
| `brain_project_detail` | Full detail on one project (deps, branches, commits, loops, alerts) |
| `brain_alerts` | Open attention items by severity |
| `brain_open_loops` | Unresolved TODO/transcript threads |
| `brain_git_dirty` | Repos with uncommitted work |
| `brain_transcripts_recent` | Recent Claude Code sessions |
| `brain_deps_across` | Find every project using a dependency |
| `brain_ask` | Semantic search (Ollama-embedded) |

**Daily Standup Routine** (in Claude Desktop → Routines):

> At 8:00 AM each weekday, call `brain_standup` with days=3 and `brain_git_dirty`.
> Synthesize a short brief in the tone of a helpful chief of staff:
> - what demands attention (urgent/warn alerts)
> - what's in flight (active projects + branches + last commits)
> - open loops with project context
> - any uncommitted work I left behind yesterday
> End with one suggested first action. After delivering, stay in the chat so
> I can dig into specifics using the same tools.

Once the Routine fires, you can keep chatting: "what's the status of that
silo thing?" / "what uses supabase across my repos?" / "find anything about
tiktok automation" — Claude will call `brain_project_detail`,
`brain_deps_across`, `brain_ask` as needed, grounded in your actual local
data.

## Environment

Copy `.env.example` to `.env` if your local Postgres isn't at the default `postgres://postgres:postgres@localhost:5432/brain`.

The `brain init` command writes config to `~/.config/brain/config.toml`. To
change embedder:

```toml
# OpenAI (default, paid) — 1536-dim
[embedder]
kind = "openai"
model = "text-embedding-3-small"
dim = 1536
# api_key = "sk-…"       # optional — otherwise read from OPENAI_API_KEY

# Ollama (local, free) — 768-dim with nomic-embed-text
[embedder]
kind = "ollama"
model = "nomic-embed-text"
dim = 768
endpoint = "http://127.0.0.1:11434/api/embeddings"

# Voyage (paid) — 1024-dim
[embedder]
kind = "voyage"
model = "voyage-3-lite"
dim = 1024
# api_key = "pa-…"       # otherwise read from VOYAGE_API_KEY
```

For the LLM summary writer (`brain summarize` / `brain refine`), set
`ANTHROPIC_API_KEY` in your shell.

### Ollama quickstart (free local embeddings)

```bash
brew install ollama
ollama serve &                      # start the daemon
ollama pull nomic-embed-text        # 768-dim, ~270MB
# then write the [embedder] block above into ~/.config/brain/config.toml
brain doctor                        # verify everything's green
```

## Running it daily

### macOS — LaunchAgent auto-start

```bash
# one-time install: renders + installs ~/Library/LaunchAgents/com.brain.daemon.plist
./scripts/install-launchagent.sh

# stop + uninstall
./scripts/install-launchagent.sh --uninstall
```

The agent runs `brain watch` on login and respawns it if it crashes. Logs
land at `~/.local/state/brain/launchd.{out,err}.log`.

### Nightly refresh

```bash
# crontab -e
30 3 * * *  cd /path/to/claude-monorepo && ./scripts/nightly-freshen.sh >> ~/.local/state/brain/freshen.log 2>&1
```

Rescans all projects, regenerates stale project summaries, and refines any
new open loops. Keeps embeddings and alerts fresh for your morning standup.

### Health check

`brain doctor` verifies every daily-use prerequisite:

- Postgres reachable
- Migrations 0001–0004 applied
- Projects discovered
- Daemon running
- Embedder configured + responding
- `ANTHROPIC_API_KEY` present
- Recent scan + embedding activity

Use `--json` for machine-readable output (for Claude Desktop MCP integration
or monitoring).
