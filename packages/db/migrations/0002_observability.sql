-- Phase 1.5: actionable full-stack observability primitives.
-- Adds richer project context + Claude Code transcripts + open loops + alerts.

-- ----- project status enum -----
CREATE TYPE project_status AS ENUM (
  'prototype',
  'active',
  'shipped',
  'stale',
  'abandoned',
  'unknown'
);

-- ----- projects: enrichment columns -----
ALTER TABLE projects
  ADD COLUMN summary text,
  ADD COLUMN status project_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN readme_first_para text,
  ADD COLUMN framework text,
  ADD COLUMN todo_count integer NOT NULL DEFAULT 0,
  ADD COLUMN service_tokens text[] NOT NULL DEFAULT '{}',
  ADD COLUMN deploy_targets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_commit_at timestamptz,
  ADD COLUMN last_activity_at timestamptz;

CREATE INDEX projects_status_idx ON projects(status);
CREATE INDEX projects_last_activity_idx ON projects(last_activity_at DESC NULLS LAST);

-- ----- Claude Code sessions (transcripts) -----
CREATE TABLE cc_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device text NOT NULL,
  session_uuid text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  cwd text,
  source_path text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  user_message_count integer NOT NULL DEFAULT 0,
  tool_use_count integer NOT NULL DEFAULT 0,
  first_user_message text,
  last_user_message text,
  summary text,
  content_hash text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cc_sessions_device_uuid ON cc_sessions(device, session_uuid);
CREATE INDEX cc_sessions_project_time ON cc_sessions(project_id, started_at DESC NULLS LAST);
CREATE INDEX cc_sessions_time ON cc_sessions(started_at DESC NULLS LAST);
CREATE INDEX cc_sessions_cwd_trgm ON cc_sessions USING gin (cwd gin_trgm_ops);

-- ----- open loops: things said, promised, or TODO'd -----
CREATE TYPE open_loop_source AS ENUM (
  'transcript',
  'todo_comment',
  'commit_message',
  'manual'
);

CREATE TYPE open_loop_status AS ENUM (
  'open',
  'done',
  'dismissed',
  'stale'
);

CREATE TABLE open_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  session_id uuid REFERENCES cc_sessions(id) ON DELETE SET NULL,
  source open_loop_source NOT NULL,
  text text NOT NULL,
  source_ref text,
  mentioned_at timestamptz NOT NULL DEFAULT now(),
  status open_loop_status NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  dedupe_key text
);
CREATE INDEX open_loops_project_open ON open_loops(project_id, status, mentioned_at DESC);
CREATE INDEX open_loops_status_time ON open_loops(status, mentioned_at DESC);
CREATE UNIQUE INDEX open_loops_dedupe ON open_loops(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ----- alerts: actionable attention items -----
CREATE TYPE alert_severity AS ENUM ('info', 'warn', 'urgent');
CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity alert_severity NOT NULL DEFAULT 'warn',
  title text NOT NULL,
  detail text,
  action_hint text,
  status alert_status NOT NULL DEFAULT 'open',
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  dedupe_key text,
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX alerts_open_severity ON alerts(status, severity, detected_at DESC);
CREATE INDEX alerts_project_open ON alerts(project_id, detected_at DESC) WHERE status = 'open';
CREATE UNIQUE INDEX alerts_dedupe ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL;
