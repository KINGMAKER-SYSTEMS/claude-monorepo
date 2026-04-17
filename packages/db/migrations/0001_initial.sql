-- Initial superbrain schema. Keep in sync with src/schema.ts.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enums
CREATE TYPE project_kind AS ENUM ('node','rust','go','python','ruby','mixed','unknown');
CREATE TYPE manifest_source AS ENUM ('package_json','pnpm_lock','cargo_toml','go_mod','pyproject_toml','requirements_txt','gemfile');
CREATE TYPE symbol_kind AS ENUM ('function','class','interface','type','const','export');
CREATE TYPE import_kind AS ENUM ('static','dynamic','type_only');
CREATE TYPE infra_kind AS ENUM ('container','dev_server','deployed_url','cloud_db','queue','bucket');
CREATE TYPE secret_source AS ENUM ('dotenv','op','doppler','railway');
CREATE TYPE embedding_owner AS ENUM ('file','symbol','readme_chunk');
CREATE TYPE outbox_op AS ENUM ('ins','upd','del');
CREATE TYPE scan_status AS ENUM ('running','ok','error');

-- projects
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_path text NOT NULL,
  name text NOT NULL,
  kind project_kind NOT NULL DEFAULT 'unknown',
  git_remote text,
  primary_lang text,
  tags text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scanned_at timestamptz
);
CREATE UNIQUE INDEX projects_root_path_unique ON projects(root_path);
CREATE INDEX projects_name_trgm ON projects USING gin (name gin_trgm_ops);

-- files
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path text NOT NULL,
  sha256 text,
  size integer,
  lang text,
  last_modified timestamptz,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX files_project_path_unique ON files(project_id, rel_path);
CREATE INDEX files_path_trgm ON files USING gin (rel_path gin_trgm_ops);

-- symbols
CREATE TABLE symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind symbol_kind NOT NULL,
  name text NOT NULL,
  signature text,
  start_line integer,
  end_line integer,
  exported boolean NOT NULL DEFAULT false
);
CREATE INDEX symbols_name_idx ON symbols(name);
CREATE INDEX symbols_file_idx ON symbols(file_id);
CREATE INDEX symbols_name_trgm ON symbols USING gin (name gin_trgm_ops);

-- imports (edge table)
CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  to_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  external_pkg text,
  kind import_kind NOT NULL DEFAULT 'static'
);
CREATE INDEX imports_from_idx ON imports(from_file_id);
CREATE INDEX imports_external_idx ON imports(external_pkg);

-- dependencies
CREATE TABLE dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source manifest_source NOT NULL,
  name text NOT NULL,
  version text,
  is_dev boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX dependencies_unique ON dependencies(project_id, source, name, is_dev);
CREATE INDEX dependencies_name_idx ON dependencies(name);

-- git
CREATE TABLE git_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  head_sha text,
  is_current boolean NOT NULL DEFAULT false,
  is_dirty boolean NOT NULL DEFAULT false,
  upstream text,
  ahead integer,
  behind integer
);
CREATE UNIQUE INDEX git_branches_unique ON git_branches(project_id, name);

CREATE TABLE git_commits (
  sha text PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author text,
  message text,
  committed_at timestamptz,
  parent_shas text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX git_commits_project_idx ON git_commits(project_id, committed_at);

-- infra
CREATE TABLE infra_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind infra_kind NOT NULL,
  name text NOT NULL,
  status text,
  endpoint text,
  metadata jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX infra_resources_kind_idx ON infra_resources(kind);

-- secrets refs (keys only, never values)
CREATE TABLE secrets_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  source secret_source NOT NULL,
  file_path text,
  line integer
);
CREATE UNIQUE INDEX secrets_refs_unique ON secrets_refs(project_id, key, source, file_path);

-- embeddings (vector columns added here directly so drizzle doesn't need to know about them)
CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind embedding_owner NOT NULL,
  owner_id uuid NOT NULL,
  model text NOT NULL,
  content_hash text NOT NULL,
  embedding_384 vector(384),
  embedding_1536 vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX embeddings_owner_idx ON embeddings(owner_kind, owner_id);
CREATE INDEX embeddings_384_hnsw ON embeddings USING hnsw (embedding_384 vector_cosine_ops) WHERE embedding_384 IS NOT NULL;
CREATE INDEX embeddings_1536_hnsw ON embeddings USING hnsw (embedding_1536 vector_cosine_ops) WHERE embedding_1536 IS NOT NULL;

-- scan + sync observability
CREATE TABLE scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  scanner text NOT NULL,
  status scan_status NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  files_changed integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX scan_runs_project_idx ON scan_runs(project_id, started_at DESC);

CREATE TABLE changes_outbox (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  row_pk text NOT NULL,
  op outbox_op NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);
CREATE INDEX changes_outbox_unsynced ON changes_outbox(id) WHERE synced_at IS NULL;
