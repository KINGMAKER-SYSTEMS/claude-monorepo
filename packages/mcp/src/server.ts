import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  depsAcross,
  getProjectDetail,
  getStandupSnapshot,
  listAlerts,
  listDirtyRepos,
  listOpenLoops,
  listProjects,
  listRecentTranscripts,
  contracts,
} from "@brain/indexer";
import { createEmbedder, searchByVector, type EmbeddingOwner } from "@brain/embedder";
import { getDb, schema } from "@brain/db";
import { inArray, sql } from "drizzle-orm";

// -----------------------------------------------------------------------------
// Brain MCP server.
//
// This file is a thin adapter over @brain/indexer. Every tool:
//   1. Imports its input + output schemas from `contracts` (the menu)
//   2. Calls one named query function (the kitchen)
//   3. Returns `{ content, structuredContent }` so MCP clients see both forms
//
// No SQL lives here — that all hides behind the indexer functions. If you need
// to change a tool's shape, edit `packages/indexer/src/contracts.ts` first;
// the function and this file follow from the type checker.
// -----------------------------------------------------------------------------

function jsonResult<T>(payload: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "brain",
    version: "0.1.0",
  });

  // ---------------------------------------------------------------------------
  // brain_doctor — schema-less input, schema'd output
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_doctor",
    {
      title: "Brain Doctor",
      description:
        "Health check for the superbrain: confirms DB reachable, migrations applied, daemon status, embedder liveness, and data freshness. Call this first if other tools return errors.",
      inputSchema: {},
      outputSchema: contracts.DoctorOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async () => {
      const db = getDb();
      const [dbVersion] = await db.execute(sql`SELECT version() as v`);
      const [projectCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.projects);
      const [openAlerts] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.alerts)
        .where(sql`${schema.alerts.status} = 'open'`);
      const [embeddings] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.embeddings);
      return jsonResult({
        database: {
          reachable: true,
          version: (dbVersion as { v?: string })?.v ?? null,
        },
        projects: projectCount?.count ?? 0,
        openAlerts: openAlerts?.count ?? 0,
        embeddings: embeddings?.count ?? 0,
        embedder: {
          kind: process.env["BRAIN_EMBEDDER_KIND"] ?? "ollama",
        },
      });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_standup
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_standup",
    {
      title: "Morning Standup Snapshot",
      description:
        "Returns the full morning-briefing snapshot: open alerts ranked by severity, in-flight projects (with branches/dirty state/last commits), recent Claude Code sessions, open loops (TODO + transcript threads), running infra (docker + dev servers), and backlog counts. Use this as the primary input when synthesizing a daily standup brief.",
      inputSchema: contracts.StandupInputSchema.shape,
      outputSchema: contracts.StandupSnapshotSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ days }) => {
      const snapshot = await getStandupSnapshot(days !== undefined ? { days } : {});
      return jsonResult(snapshot);
    },
  );

  // ---------------------------------------------------------------------------
  // brain_projects
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_projects",
    {
      title: "List Projects",
      description:
        "List indexed projects with optional filters. Use this to scope follow-up questions (e.g., filter by status='active' and then ask about specific projects).",
      inputSchema: contracts.ProjectListInputSchema.shape,
      outputSchema: contracts.ProjectListOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const rows = await listProjects(args);
      return jsonResult({ count: rows.length, projects: rows });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_project_detail — output is heterogeneous so we don't constrain it
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_project_detail",
    {
      title: "Project Detail",
      description:
        "Full detail for a single project: metadata + dependencies + branches + recent commits + open loops + alerts. Accepts either project id (uuid) or exact name.",
      inputSchema: contracts.ProjectDetailInputSchema.shape,
      annotations: READ_ONLY,
    },
    async ({ idOrName }) => {
      const detail = await getProjectDetail(idOrName);
      if (!detail) {
        return jsonResult({
          error: `no project matching '${idOrName}' — try brain_projects with search=`,
        });
      }
      return jsonResult(detail);
    },
  );

  // ---------------------------------------------------------------------------
  // brain_alerts
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_alerts",
    {
      title: "List Alerts",
      description:
        "Actionable attention items (open by default). Alerts carry severity (urgent/warn/info), a title, detail, and an action hint.",
      inputSchema: contracts.AlertsInputSchema.shape,
      outputSchema: contracts.AlertsOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const alerts = await listAlerts(args);
      return jsonResult({ count: alerts.length, alerts });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_open_loops
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_open_loops",
    {
      title: "Open Loops",
      description:
        "Unresolved threads across projects: TODO comments, transcript mentions, and manually-added notes. Each has a source and source_ref (file:line or transcript id).",
      inputSchema: contracts.OpenLoopsInputSchema.shape,
      outputSchema: contracts.OpenLoopsOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const loops = await listOpenLoops(args);
      return jsonResult({ count: loops.length, loops });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_git_dirty
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_git_dirty",
    {
      title: "Dirty Repos",
      description:
        "Projects whose current branch has uncommitted changes. Use this to surface 'you left X dirty yesterday' in a standup.",
      inputSchema: contracts.DirtyReposInputSchema.shape,
      outputSchema: contracts.DirtyReposOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const dirty = await listDirtyRepos(args);
      return jsonResult({ count: dirty.length, dirty });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_transcripts_recent
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_transcripts_recent",
    {
      title: "Recent Claude Code Sessions",
      description:
        "Recently ended Claude Code sessions with their cwd, last user message, and auto-generated summary. Useful for 'what was I working on yesterday?'",
      inputSchema: contracts.TranscriptsInputSchema.shape,
      outputSchema: contracts.TranscriptsOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const rows = await listRecentTranscripts(args);
      return jsonResult({ count: rows.length, sessions: rows });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_deps_across
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_deps_across",
    {
      title: "Dependency Usage Across Projects",
      description:
        "Find every project that uses a given dependency (or pattern with SQL LIKE wildcards, e.g. 'react%').",
      inputSchema: contracts.DepsAcrossInputSchema.shape,
      outputSchema: contracts.DepsAcrossOutputSchema.shape,
      annotations: READ_ONLY,
    },
    async (args) => {
      const rows = await depsAcross(args);
      return jsonResult({ count: rows.length, matches: rows });
    },
  );

  // ---------------------------------------------------------------------------
  // brain_ask — semantic search. Output shape depends on the embedder so we
  // keep it loose; the structuredContent is still useful client-side.
  // ---------------------------------------------------------------------------
  server.registerTool(
    "brain_ask",
    {
      title: "Semantic Ask",
      description:
        "Semantic search across project summaries, transcripts, and open loops. Uses the locally-configured embedder (Ollama by default) — no API key required.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language query"),
        kind: z
          .enum([
            "project_summary",
            "transcript_message",
            "open_loop",
            "readme_chunk",
            "commit_msg",
            "todo_note",
          ])
          .optional()
          .describe("Restrict to one owner kind"),
        limit: z.number().int().min(1).max(50).optional().describe("Max hits (default 8)"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, kind, limit }) => {
      const embedder = createEmbedder();
      const res = await embedder.embed({ inputs: [query] });
      const vec = res.vectors[0];
      if (!vec) return jsonResult({ error: "embedder returned no vector", hits: [] });

      const searchOpts: { limit: number; modelId: string; ownerKinds?: EmbeddingOwner[] } = {
        limit: limit ?? 8,
        modelId: res.modelId,
      };
      if (kind) searchOpts.ownerKinds = [kind];
      const hits = await searchByVector(vec, searchOpts);

      // Enrich titles inline so Claude Desktop doesn't need to chase ids.
      const enriched = await enrichHits(hits);
      return jsonResult({
        query,
        model: res.modelId,
        count: enriched.length,
        hits: enriched,
      });
    },
  );

  return server;
}

// -----------------------------------------------------------------------------
// Enrich search hits with human-readable titles/context (subset of CLI ask.ts).
// -----------------------------------------------------------------------------

interface EnrichedHit {
  ownerKind: string;
  ownerId: string;
  distance: number;
  score: number;
  title: string;
  context: string | null;
  hint: string | null;
}

async function enrichHits(
  hits: Array<{ ownerKind: string; ownerId: string; distance: number }>,
): Promise<EnrichedHit[]> {
  if (hits.length === 0) return [];
  const db = getDb();
  const byKind = new Map<string, string[]>();
  for (const h of hits) {
    const bucket = byKind.get(h.ownerKind) ?? [];
    bucket.push(h.ownerId);
    byKind.set(h.ownerKind, bucket);
  }

  const meta = new Map<string, { title: string; context: string | null; hint: string | null }>();

  const projIds = byKind.get("project_summary") ?? [];
  if (projIds.length > 0) {
    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        summary: schema.projects.summary,
        rootPath: schema.projects.rootPath,
      })
      .from(schema.projects)
      .where(inArray(schema.projects.id, projIds));
    for (const r of rows) {
      meta.set(`project_summary|${r.id}`, {
        title: r.name,
        context: r.summary,
        hint: r.rootPath,
      });
    }
  }

  const loopIds = byKind.get("open_loop") ?? [];
  if (loopIds.length > 0) {
    const rows = await db
      .select({
        id: schema.openLoops.id,
        text: schema.openLoops.text,
        refinedText: schema.openLoops.refinedText,
        source: schema.openLoops.source,
        sourceRef: schema.openLoops.sourceRef,
      })
      .from(schema.openLoops)
      .where(inArray(schema.openLoops.id, loopIds));
    for (const r of rows) {
      meta.set(`open_loop|${r.id}`, {
        title: (r.refinedText ?? r.text).slice(0, 140),
        context: r.source,
        hint: r.sourceRef,
      });
    }
  }

  const sessIds = byKind.get("transcript_message") ?? [];
  if (sessIds.length > 0) {
    const rows = await db
      .select({
        id: schema.ccSessions.id,
        device: schema.ccSessions.device,
        cwd: schema.ccSessions.cwd,
        summary: schema.ccSessions.summary,
        lastUserMessage: schema.ccSessions.lastUserMessage,
      })
      .from(schema.ccSessions)
      .where(inArray(schema.ccSessions.id, sessIds));
    for (const r of rows) {
      const text = r.summary ?? r.lastUserMessage ?? "";
      meta.set(`transcript_message|${r.id}`, {
        title: text.split("\n")[0]?.slice(0, 100) ?? r.device,
        context: text.slice(0, 400),
        hint: r.cwd ?? r.device,
      });
    }
  }

  return hits.map((h) => {
    const e = meta.get(`${h.ownerKind}|${h.ownerId}`);
    return {
      ownerKind: h.ownerKind,
      ownerId: h.ownerId,
      distance: h.distance,
      score: Number((1 - h.distance).toFixed(3)),
      title: e?.title ?? h.ownerId,
      context: e?.context ?? null,
      hint: e?.hint ?? null,
    };
  });
}
