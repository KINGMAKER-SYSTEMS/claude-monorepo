# Superbrain Phase 2 — PRD

**Status:** In progress
**Branch:** `claude/zen-davinci-67fc85` (worktree off `claude/postgres-project-database-7udcO`)
**Baseline:** `cd36f34` (Phase 1.5 shipped)

## Goal

Turn the Superbrain from an on-demand snapshot tool into a **live, self-refreshing
dev observability plane** with semantic recall. Three slices that compound:

1. **Daemon (`brain watch`)** — long-running process, fs-watches all roots,
   incremental rescans, periodic ticks, IPC over Unix socket.
2. **Infra scanner** — docker containers + dev-server port detection, wired into
   daemon ticks. New `infra_resources` population, `service_down` + `port_conflict`
   alerts, "RUNNING NOW" standup section.
3. **Embeddings + semantic recall** — pluggable model client, embed
   READMEs/summaries/transcripts/open-loops, `brain ask "<query>"` vector search,
   LLM-synthesized project summaries, LLM open-loop refinement.

## Non-goals (Phase 2)

- Cross-device sync (`changes_outbox` stays an unwritten seam — Phase 3).
- Web UI / Claude Desktop integration.
- Remote daemon (loopback only).
- Cost tracking for LLM calls (deferred — just log token counts).

## Slice A — `brain watch` daemon

### Architecture

```
┌─ brain CLI ───────┐       Unix socket        ┌─ brain daemon ──────────────┐
│  projects         │ ◄──► ~/.brain/sock  ◄──► │  BrainServer (JSON-RPC-ish) │
│  standup          │                          │  ├─ WatchManager (chokidar) │
│  ask              │   falls back to direct   │  ├─ TickScheduler (60s)     │
│  status           │     DB when socket       │  ├─ IndexerRunner (debounced)│
│  ...              │     missing              │  └─ Postgres pool (shared)  │
└───────────────────┘                          └──────────────────────────────┘
```

### Behaviors

- `brain watch` — foreground. Logs to stderr.
- `brain watch --detach` — forks, writes `~/.brain/daemon.pid`, logs to
  `~/.brain/daemon.log`.
- `brain status` — pings socket, reports uptime, last tick, watched roots,
  pending scans.
- `brain stop` — sends shutdown over socket; falls back to `kill <pid>`.

### Triggers

- **fs-watch** (chokidar, ignoring `node_modules/**`, `.git/objects/**`,
  `dist/**`, `.next/**`, `target/**`, `.turbo/**`): debounced 2s per project.
  On fire → re-run `scanGit` + `scanManifests` + `scanProjectContext` for that
  project only. Update `projects.last_activity_at` to `now()` (filesystem mtime
  beats git date).
- **Periodic tick** (60s): derive alerts, sync transcripts, run infra scanner.
- **Every 6h**: full `discoverProjects` walk (catches new repos on disk).

### IPC protocol

Newline-delimited JSON over Unix socket. Every request has `id` + `method`.
Methods:

- `ping` → `{ uptimeMs, version, watching: string[], lastTickAt }`
- `projects` → same shape as current `listProjects()`
- `rescan` `{ projectId? | path? }` → forces immediate rescan
- `ask` `{ query, k? }` → vector search results (Slice C)
- `shutdown` → graceful exit

Unknown method → `{ error: "unknown_method" }`. Malformed frame → drop
connection. 1MB frame cap.

### CLI fallback

Every command tries socket first. If `ECONNREFUSED` / missing → direct DB
access (current behavior). This keeps things working when the daemon isn't up.

## Slice B — Infra scanner

### Sources

- `docker ps --format '{{json .}}'` → running containers (id, image, names,
  ports, status, labels). Parse `com.docker.compose.project` + `.service`
  labels to associate with a project (match against
  `infra/docker-compose.yml` paths).
- `lsof -iTCP -sTCP:LISTEN -P -n -F pcPn` → port → pid → process name.
  Each PID → `/proc` fallback or `ps -p <pid> -o command=` for cwd-ish info.
- Port range scan: skip. `lsof` covers everything we need without noise.

### Writes

- Upsert into `infra_resources` keyed by `(kind, name)`:
  - `kind: 'container'`, `name: <docker name>` — metadata: image, ports, status
  - `kind: 'dev_server'`, `name: '<project>:<port>'` — metadata: pid, command,
    framework guess from command (`next dev` → Next, `vite` → Vite, etc.)
- `project_id` set when we can map (docker compose label, or lsof cwd contained
  in a project path).
- Soft-delete: any `infra_resources` row not seen in the current scan gets
  `status='stopped'` and `last_seen_at` left alone.

### Alerts

- `service_down` — row with `status='stopped'` that was `running` in last tick
  **and** project has dirty git or recent commits. (Signal: you were working on
  it; the server died.)
- `port_conflict` — two projects both trying to claim the same port in their
  `.env.example` or `package.json` scripts (detected via new scanner pass).

### Standup

New section right after "Last activity":

```
RUNNING NOW
- my-app dev server on :3000 (next dev, pid 12345)
- postgres container "superbrain-db" (healthy)
```

## Slice C — Embeddings + semantic recall

### Model layer

New package `packages/embedder`. Pluggable `Embedder` interface:

```ts
export interface Embedder {
  readonly dimension: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}
```

Implementations:
- `OpenAIEmbedder` (default; `text-embedding-3-small`, 1536-dim, matches schema)
- `VoyageEmbedder` (optional; `voyage-code-3`, 1024-dim — needs schema column)
- `OllamaEmbedder` (optional; `nomic-embed-text`, 768-dim — needs schema column)

Picked via `~/.config/brain/config.toml` → `[embedder] provider = "openai"`.
API keys from env (`OPENAI_API_KEY`, `VOYAGE_API_KEY`). Missing key → embedder
disabled (Slice A and B still work).

### What gets embedded

Written into `embeddings(owner_type, owner_id, content_hash, embedding_1536)`:

- `project.summary` (after LLM synthesis — see below)
- `project.readme_excerpt` (first paragraph, dedup by hash)
- `transcript_message.content` (user messages only, chunked to 8k chars)
- `open_loop.text`

Writes happen in the daemon tick, after scanners, batched. Skip if
`content_hash` unchanged.

### LLM summaries

When project data changes materially (new commits, manifest change, README
edit), run a bounded prompt against Claude:

> System: You summarize dev projects in one or two sentences. Plain English.
> User: README excerpt, manifest name/description, frameworks detected,
>   last 10 commit subjects, last 5 transcript topics.

Claude Haiku 4.5 — cheap, fast. Result stored back to `projects.summary`.
Guard: only re-run if `content_hash(inputs)` changed.

### `brain ask`

```
$ brain ask "where did we leave off with the n8n campaign workflow"
```

1. Embed query via configured embedder.
2. `SELECT ... FROM embeddings ORDER BY embedding_1536 <-> $1 LIMIT k` across
   all owner types.
3. Join back to source rows for display.
4. Format: owner type/name, snippet, source (file path or transcript session),
   distance score.

### Open-loop refinement (optional)

After transcript scanner extracts candidate open loops, send batch to Haiku:

> Return only items that represent actionable, unresolved work. Dedupe.
> Drop polite phrases, greetings, filler.

Keeps regex-matched results as raw, stores refined list in a new column
`open_loops.refined_text` (additive — no schema break).

## Schema changes

Additive only. New migration `0003_phase2.sql`:

- `daemon_state` table: singleton row — `started_at`, `last_tick_at`,
  `version`, `watching_count`, `scan_queue_depth`. For `brain status`.
- `infra_resources.status` — already exists. Add index on
  `(project_id, status)`.
- `open_loops.refined_text TEXT NULL` — additive.
- `embedding_models` table (additive, useful metadata): `id`, `provider`,
  `model_id`, `dimension`, `first_seen_at`. Tracks which model produced which
  embedding.
- `embeddings.model_id` FK → `embedding_models.id`. Backfill nullable; new
  rows required.

## Testing

Vitest. Target: all new scanners + IPC protocol + embedder contracts.

- `packages/indexer/src/scanners/infra.test.ts` — fixture-based docker/lsof
  output parsing.
- `packages/daemon/src/ipc.test.ts` — round-trip every RPC method, malformed
  frames, socket reconnect.
- `packages/embedder/src/openai.test.ts` — mocked HTTP, dimension assertions.
- `packages/daemon/src/watch.test.ts` — chokidar event → debounced rescan.

## Rollout order

Build in this order, commit per slice:

1. `0003_phase2.sql` migration
2. Slice A: `packages/daemon` + `brain watch|status|stop` + IPC
3. Slice B: `packages/indexer/src/scanners/infra.ts` + standup section + new
   alert kinds
4. Slice C: `packages/embedder` + `brain ask` + LLM summary writer + optional
   open-loop refinement
5. Tests + docs

Final commit: update root `README.md` to reflect Phase 2.

## Open questions (answered, for the record)

- Slice order: A → B → C.
- IPC: Unix socket, newline-delimited JSON.
- Embedding default: OpenAI `text-embedding-3-small` (1536, matches existing
  column). Voyage / Ollama behind config.
- Tests: Vitest, new scanners + IPC + embedder.
- Postgres first: yes — bring up before any Phase 2 code is wired end-to-end.
- PRD doc: this file.
