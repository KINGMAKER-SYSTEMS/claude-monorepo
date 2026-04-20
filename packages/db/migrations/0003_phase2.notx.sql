-- Phase 2: daemon state, infra indexes, embedding provenance, open-loop refinement.
-- NOTE: runs outside an explicit transaction because ALTER TYPE ... ADD VALUE
-- cannot execute inside a BEGIN/COMMIT block in Postgres. The migration runner
-- (packages/db/src/migrate.ts) wraps each file in its own connection, which is
-- fine; individual ALTERs are idempotent via IF NOT EXISTS.

-- Singleton daemon state for `brain status`
CREATE TABLE IF NOT EXISTS daemon_state (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tick_at  TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  version       TEXT NOT NULL DEFAULT 'phase2',
  pid           INTEGER,
  socket_path   TEXT,
  watching      TEXT[] NOT NULL DEFAULT '{}',
  scan_queue    INTEGER NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Infra indexes for alert derivation and fast status listings
CREATE INDEX IF NOT EXISTS infra_resources_project_status_idx
  ON infra_resources (project_id, status);

CREATE INDEX IF NOT EXISTS infra_resources_last_seen_idx
  ON infra_resources (last_seen_at DESC);

-- Stable identity for infra rows so the scanner can upsert cleanly.
-- (kind, name) is unique within the host; different projects that happen to
-- both run a container called "postgres" would collide, so include project_id.
CREATE UNIQUE INDEX IF NOT EXISTS infra_resources_identity
  ON infra_resources (kind, name, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Embedding provenance — table + seed rows
CREATE TABLE IF NOT EXISTS embedding_models (
  id            SERIAL PRIMARY KEY,
  provider      TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  dimension     INTEGER NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id)
);

INSERT INTO embedding_models (provider, model_id, dimension)
VALUES
  ('openai', 'text-embedding-3-small', 1536),
  ('openai', 'text-embedding-3-large', 3072),
  ('voyage', 'voyage-code-3', 1024),
  ('ollama', 'nomic-embed-text', 768)
ON CONFLICT (provider, model_id) DO NOTHING;

-- Expand embedding_owner enum so projects, cc_sessions, open_loops can be
-- indexed semantically. Additive: existing values stay valid.
ALTER TYPE embedding_owner ADD VALUE IF NOT EXISTS 'project_summary';
ALTER TYPE embedding_owner ADD VALUE IF NOT EXISTS 'transcript_message';
ALTER TYPE embedding_owner ADD VALUE IF NOT EXISTS 'open_loop';

-- LLM-refined open loop text (additive, never overwrites raw text)
ALTER TABLE open_loops
  ADD COLUMN IF NOT EXISTS refined_text TEXT;

ALTER TABLE open_loops
  ADD COLUMN IF NOT EXISTS refined_at TIMESTAMPTZ;

-- Project summary provenance: track when LLM synthesis ran and against what
-- hash so we don't re-synthesize unchanged inputs.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS summary_source TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS summary_hash TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMPTZ;
