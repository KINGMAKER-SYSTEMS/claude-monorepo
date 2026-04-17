import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const projectKind = pgEnum("project_kind", [
  "node",
  "rust",
  "go",
  "python",
  "ruby",
  "mixed",
  "unknown",
]);

export const manifestSource = pgEnum("manifest_source", [
  "package_json",
  "pnpm_lock",
  "cargo_toml",
  "go_mod",
  "pyproject_toml",
  "requirements_txt",
  "gemfile",
]);

export const symbolKind = pgEnum("symbol_kind", [
  "function",
  "class",
  "interface",
  "type",
  "const",
  "export",
]);

export const importKind = pgEnum("import_kind", ["static", "dynamic", "type_only"]);

export const infraKind = pgEnum("infra_kind", [
  "container",
  "dev_server",
  "deployed_url",
  "cloud_db",
  "queue",
  "bucket",
]);

export const secretSource = pgEnum("secret_source", ["dotenv", "op", "doppler", "railway"]);

export const embeddingOwner = pgEnum("embedding_owner", ["file", "symbol", "readme_chunk"]);

export const outboxOp = pgEnum("outbox_op", ["ins", "upd", "del"]);

export const scanStatus = pgEnum("scan_status", ["running", "ok", "error"]);

// ----- projects -----
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootPath: text("root_path").notNull(),
    name: text("name").notNull(),
    kind: projectKind("kind").notNull().default("unknown"),
    gitRemote: text("git_remote"),
    primaryLang: text("primary_lang"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  },
  (t) => ({
    rootPathUnique: uniqueIndex("projects_root_path_unique").on(t.rootPath),
  }),
);

// ----- files -----
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    sha256: text("sha256"),
    size: integer("size"),
    lang: text("lang"),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    pathUnique: uniqueIndex("files_project_path_unique").on(t.projectId, t.relPath),
  }),
);

// ----- symbols -----
export const symbols = pgTable(
  "symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    kind: symbolKind("kind").notNull(),
    name: text("name").notNull(),
    signature: text("signature"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    exported: boolean("exported").notNull().default(false),
  },
  (t) => ({
    nameIdx: index("symbols_name_idx").on(t.name),
    fileIdx: index("symbols_file_idx").on(t.fileId),
  }),
);

// ----- imports (edge table) -----
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromFileId: uuid("from_file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    toFileId: uuid("to_file_id").references(() => files.id, { onDelete: "set null" }),
    externalPkg: text("external_pkg"),
    kind: importKind("kind").notNull().default("static"),
  },
  (t) => ({
    fromIdx: index("imports_from_idx").on(t.fromFileId),
    externalIdx: index("imports_external_idx").on(t.externalPkg),
  }),
);

// ----- dependencies -----
export const dependencies = pgTable(
  "dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: manifestSource("source").notNull(),
    name: text("name").notNull(),
    version: text("version"),
    isDev: boolean("is_dev").notNull().default(false),
  },
  (t) => ({
    uniq: uniqueIndex("dependencies_unique").on(t.projectId, t.source, t.name, t.isDev),
    nameIdx: index("dependencies_name_idx").on(t.name),
  }),
);

// ----- git -----
export const gitBranches = pgTable(
  "git_branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    headSha: text("head_sha"),
    isCurrent: boolean("is_current").notNull().default(false),
    isDirty: boolean("is_dirty").notNull().default(false),
    upstream: text("upstream"),
    ahead: integer("ahead"),
    behind: integer("behind"),
  },
  (t) => ({
    uniq: uniqueIndex("git_branches_unique").on(t.projectId, t.name),
  }),
);

export const gitCommits = pgTable(
  "git_commits",
  {
    sha: text("sha").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    author: text("author"),
    message: text("message"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    parentShas: text("parent_shas").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => ({
    projectIdx: index("git_commits_project_idx").on(t.projectId, t.committedAt),
  }),
);

// ----- infra -----
export const infraResources = pgTable("infra_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  kind: infraKind("kind").notNull(),
  name: text("name").notNull(),
  status: text("status"),
  endpoint: text("endpoint"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// ----- secrets (refs only, never values) -----
export const secretsRefs = pgTable(
  "secrets_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    source: secretSource("source").notNull(),
    filePath: text("file_path"),
    line: integer("line"),
  },
  (t) => ({
    uniq: uniqueIndex("secrets_refs_unique").on(t.projectId, t.key, t.source, t.filePath),
  }),
);

// ----- embeddings (pgvector columns added via raw SQL migration) -----
export const embeddings = pgTable("embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerKind: embeddingOwner("owner_kind").notNull(),
  ownerId: uuid("owner_id").notNull(),
  model: text("model").notNull(),
  contentHash: text("content_hash").notNull(),
  // embedding_384 / embedding_1536 vector columns are added in a follow-up SQL migration
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ----- scan + sync runs -----
export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  scanner: text("scanner").notNull(),
  status: scanStatus("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  filesChanged: integer("files_changed").notNull().default(0),
  error: text("error"),
});

export const changesOutbox = pgTable("changes_outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tableName: text("table_name").notNull(),
  rowPk: text("row_pk").notNull(),
  op: outboxOp("op").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});
