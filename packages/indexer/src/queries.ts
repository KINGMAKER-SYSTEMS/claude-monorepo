import { and, desc, eq, gte, inArray, isNotNull, or, sql, like } from "drizzle-orm";
import { getDb, schema } from "@brain/db";
import type {
  AlertRow,
  InFlightProjectRow,
  InfraRow,
  ListAlertRow,
  ListOpenLoopRow,
  OpenLoopRow,
  ProjectRow,
  SessionRow,
  StandupSnapshot,
  DirtyRepoRow,
  DepMatchRow,
} from "./contracts.js";

// Re-export the row types as a convenience for legacy callers (CLI rendering
// imports `StandupSnapshot`, `OpenLoopRow`, etc. from here today).
export type {
  AlertRow,
  InFlightProjectRow,
  InfraRow,
  ListAlertRow,
  ListOpenLoopRow,
  OpenLoopRow,
  ProjectRow,
  SessionRow,
  StandupSnapshot,
  DirtyRepoRow,
  DepMatchRow,
};

// -----------------------------------------------------------------------------
// Shared read-only queries used by the CLI rendering layer AND the MCP server.
// Keep these pure data accessors — no console output, no formatting. Callers
// decide how to render.
//
// Input/output shapes live in ./contracts.ts as Zod schemas; the types imported
// above are derived from those. If you change a query's shape, update the
// schema first and let the type errors guide the rest.
// -----------------------------------------------------------------------------

/**
 * Gather the morning-briefing snapshot used by `brain standup` and the
 * `brain_standup` MCP tool. Single round-trip, no rendering.
 */
export async function getStandupSnapshot(
  opts: import("./contracts.js").StandupInput = {},
): Promise<StandupSnapshot> {
  const db = getDb();
  const days = opts.days ?? 7;
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const [alertsRows, inFlight, stale, abandoned, openLoops, recentSessions, runningInfra] =
    await Promise.all([
      db
        .select({
          id: schema.alerts.id,
          severity: schema.alerts.severity,
          title: schema.alerts.title,
          detail: schema.alerts.detail,
          actionHint: schema.alerts.actionHint,
          detectedAt: schema.alerts.detectedAt,
          projectName: schema.projects.name,
        })
        .from(schema.alerts)
        .leftJoin(schema.projects, eq(schema.alerts.projectId, schema.projects.id))
        .where(eq(schema.alerts.status, "open"))
        .orderBy(
          sql`CASE ${schema.alerts.severity}
                WHEN 'urgent' THEN 0
                WHEN 'warn' THEN 1
                WHEN 'info' THEN 2
                ELSE 3 END`,
          desc(schema.alerts.detectedAt),
        ),

      db
        .select({
          id: schema.projects.id,
          name: schema.projects.name,
          status: schema.projects.status,
          summary: schema.projects.summary,
          framework: schema.projects.framework,
          deployTargets: schema.projects.deployTargets,
          serviceTokens: schema.projects.serviceTokens,
          lastCommitAt: schema.projects.lastCommitAt,
          lastActivityAt: schema.projects.lastActivityAt,
          todoCount: schema.projects.todoCount,
        })
        .from(schema.projects)
        .where(
          or(
            gte(schema.projects.lastActivityAt, cutoff),
            gte(schema.projects.lastCommitAt, cutoff),
          ),
        )
        .orderBy(desc(schema.projects.lastActivityAt)),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.projects)
        .where(eq(schema.projects.status, "stale")),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.projects)
        .where(eq(schema.projects.status, "abandoned")),

      db
        .select({
          id: schema.openLoops.id,
          text: schema.openLoops.text,
          refinedText: schema.openLoops.refinedText,
          source: schema.openLoops.source,
          mentionedAt: schema.openLoops.mentionedAt,
          projectName: schema.projects.name,
          sourceRef: schema.openLoops.sourceRef,
        })
        .from(schema.openLoops)
        .leftJoin(schema.projects, eq(schema.openLoops.projectId, schema.projects.id))
        .where(eq(schema.openLoops.status, "open"))
        .orderBy(desc(schema.openLoops.mentionedAt))
        .limit(30),

      db
        .select({
          id: schema.ccSessions.id,
          device: schema.ccSessions.device,
          cwd: schema.ccSessions.cwd,
          startedAt: schema.ccSessions.startedAt,
          endedAt: schema.ccSessions.endedAt,
          messageCount: schema.ccSessions.messageCount,
          lastUserMessage: schema.ccSessions.lastUserMessage,
          summary: schema.ccSessions.summary,
          projectName: schema.projects.name,
        })
        .from(schema.ccSessions)
        .leftJoin(schema.projects, eq(schema.ccSessions.projectId, schema.projects.id))
        .where(
          and(isNotNull(schema.ccSessions.endedAt), gte(schema.ccSessions.endedAt, cutoff)),
        )
        .orderBy(desc(schema.ccSessions.endedAt))
        .limit(20),

      db
        .select({
          id: schema.infraResources.id,
          kind: schema.infraResources.kind,
          name: schema.infraResources.name,
          status: schema.infraResources.status,
          endpoint: schema.infraResources.endpoint,
          metadata: schema.infraResources.metadata,
          lastSeenAt: schema.infraResources.lastSeenAt,
          projectName: schema.projects.name,
        })
        .from(schema.infraResources)
        .leftJoin(schema.projects, eq(schema.infraResources.projectId, schema.projects.id))
        .where(eq(schema.infraResources.status, "running"))
        .orderBy(desc(schema.infraResources.lastSeenAt))
        .limit(50),
    ]);

  // Enrich in-flight projects with current branch + latest commit.
  const inFlightIds = inFlight.map((p) => p.id);
  let enrichedInFlight: InFlightProjectRow[] = inFlight.map((p) => ({ ...p }));
  if (inFlightIds.length > 0) {
    const [branches, commits] = await Promise.all([
      db
        .select({
          projectId: schema.gitBranches.projectId,
          name: schema.gitBranches.name,
          isDirty: schema.gitBranches.isDirty,
          ahead: schema.gitBranches.ahead,
        })
        .from(schema.gitBranches)
        .where(
          and(
            eq(schema.gitBranches.isCurrent, true),
            inArray(schema.gitBranches.projectId, inFlightIds),
          ),
        ),
      db
        .select({
          projectId: schema.gitCommits.projectId,
          message: schema.gitCommits.message,
          committedAt: schema.gitCommits.committedAt,
          rn: sql<number>`row_number() over (partition by ${schema.gitCommits.projectId} order by ${schema.gitCommits.committedAt} desc nulls last)`,
        })
        .from(schema.gitCommits)
        .where(inArray(schema.gitCommits.projectId, inFlightIds)),
    ]);

    const branchMap = new Map(branches.map((b) => [b.projectId, b]));
    const commitMap = new Map<string, { message: string | null; committedAt: Date | null }>();
    for (const row of commits) {
      if (row.rn === 1) commitMap.set(row.projectId, row);
    }

    enrichedInFlight = inFlight.map((p) => {
      const b = branchMap.get(p.id);
      const c = commitMap.get(p.id);
      return {
        ...p,
        currentBranch: b?.name ?? null,
        isDirty: b?.isDirty ?? false,
        aheadCommits: b?.ahead ?? null,
        lastCommitMessage: c?.message ?? null,
      };
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    alerts: alertsRows.map((r) => ({ ...r, severity: r.severity ?? "info" })),
    inFlight: enrichedInFlight,
    openLoops,
    recentSessions,
    runningInfra,
    staleCount: stale[0]?.count ?? 0,
    abandonedCount: abandoned[0]?.count ?? 0,
  };
}

// -----------------------------------------------------------------------------

/**
 * Legacy alias kept for callers that imported `ProjectListFilter` directly.
 * Prefer `ProjectListInput` from "./contracts" for new code.
 */
export type ProjectListFilter = import("./contracts.js").ProjectListInput;

export async function listProjects(filter: ProjectListFilter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.status) conditions.push(eq(schema.projects.status, filter.status as never));
  if (filter.lang) conditions.push(eq(schema.projects.primaryLang, filter.lang));
  if (filter.framework) conditions.push(eq(schema.projects.framework, filter.framework));
  if (filter.tag) conditions.push(sql`${filter.tag} = ANY(${schema.projects.tags})`);
  if (filter.search) {
    conditions.push(
      or(
        like(schema.projects.name, `%${filter.search}%`),
        like(schema.projects.rootPath, `%${filter.search}%`),
      ),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      rootPath: schema.projects.rootPath,
      status: schema.projects.status,
      kind: schema.projects.kind,
      framework: schema.projects.framework,
      primaryLang: schema.projects.primaryLang,
      summary: schema.projects.summary,
      tags: schema.projects.tags,
      lastCommitAt: schema.projects.lastCommitAt,
      lastActivityAt: schema.projects.lastActivityAt,
      todoCount: schema.projects.todoCount,
    })
    .from(schema.projects);

  const rows = await (where ? query.where(where) : query)
    .orderBy(desc(schema.projects.lastActivityAt))
    .limit(filter.limit ?? 100);

  return rows;
}

export async function getProjectDetail(idOrName: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      or(eq(schema.projects.id, idOrName), eq(schema.projects.name, idOrName)),
    )
    .limit(1);

  if (!project) return null;

  const [deps, branches, recentCommits, openLoops, alerts] = await Promise.all([
    db
      .select()
      .from(schema.dependencies)
      .where(eq(schema.dependencies.projectId, project.id))
      .limit(200),
    db
      .select()
      .from(schema.gitBranches)
      .where(eq(schema.gitBranches.projectId, project.id)),
    db
      .select()
      .from(schema.gitCommits)
      .where(eq(schema.gitCommits.projectId, project.id))
      .orderBy(desc(schema.gitCommits.committedAt))
      .limit(20),
    db
      .select()
      .from(schema.openLoops)
      .where(
        and(eq(schema.openLoops.projectId, project.id), eq(schema.openLoops.status, "open")),
      )
      .orderBy(desc(schema.openLoops.mentionedAt))
      .limit(20),
    db
      .select()
      .from(schema.alerts)
      .where(
        and(eq(schema.alerts.projectId, project.id), eq(schema.alerts.status, "open")),
      )
      .orderBy(desc(schema.alerts.detectedAt))
      .limit(20),
  ]);

  return { project, dependencies: deps, branches, recentCommits, openLoops, alerts };
}

export async function listAlerts(
  opts: import("./contracts.js").AlertsInput = {},
) {
  const db = getDb();
  const conditions = [];
  conditions.push(eq(schema.alerts.status, opts.status ?? "open"));
  if (opts.severity) conditions.push(eq(schema.alerts.severity, opts.severity as never));

  return db
    .select({
      id: schema.alerts.id,
      severity: schema.alerts.severity,
      title: schema.alerts.title,
      detail: schema.alerts.detail,
      actionHint: schema.alerts.actionHint,
      kind: schema.alerts.kind,
      detectedAt: schema.alerts.detectedAt,
      projectName: schema.projects.name,
      projectId: schema.alerts.projectId,
    })
    .from(schema.alerts)
    .leftJoin(schema.projects, eq(schema.alerts.projectId, schema.projects.id))
    .where(and(...conditions))
    .orderBy(desc(schema.alerts.detectedAt))
    .limit(opts.limit ?? 50);
}

export async function listOpenLoops(
  opts: import("./contracts.js").OpenLoopsInput = {},
) {
  const db = getDb();
  const conditions = [eq(schema.openLoops.status, "open")];
  if (opts.source) conditions.push(eq(schema.openLoops.source, opts.source as never));

  const rows = await db
    .select({
      id: schema.openLoops.id,
      text: schema.openLoops.text,
      refinedText: schema.openLoops.refinedText,
      source: schema.openLoops.source,
      sourceRef: schema.openLoops.sourceRef,
      mentionedAt: schema.openLoops.mentionedAt,
      projectName: schema.projects.name,
      projectId: schema.openLoops.projectId,
    })
    .from(schema.openLoops)
    .leftJoin(schema.projects, eq(schema.openLoops.projectId, schema.projects.id))
    .where(and(...conditions))
    .orderBy(desc(schema.openLoops.mentionedAt))
    .limit(opts.limit ?? 50);

  if (opts.projectName) {
    return rows.filter((r) => r.projectName === opts.projectName);
  }
  return rows;
}

export async function listDirtyRepos(
  opts: import("./contracts.js").DirtyReposInput = {},
) {
  const db = getDb();
  return db
    .select({
      projectId: schema.gitBranches.projectId,
      projectName: schema.projects.name,
      rootPath: schema.projects.rootPath,
      branch: schema.gitBranches.name,
      ahead: schema.gitBranches.ahead,
      behind: schema.gitBranches.behind,
      upstream: schema.gitBranches.upstream,
    })
    .from(schema.gitBranches)
    .leftJoin(schema.projects, eq(schema.gitBranches.projectId, schema.projects.id))
    .where(and(eq(schema.gitBranches.isCurrent, true), eq(schema.gitBranches.isDirty, true)))
    .orderBy(desc(schema.projects.lastActivityAt))
    .limit(opts.limit ?? 50);
}

export async function listRecentTranscripts(
  opts: import("./contracts.js").TranscriptsInput = {},
) {
  const db = getDb();
  const cutoff = new Date(Date.now() - (opts.days ?? 7) * 86_400_000);
  return db
    .select({
      id: schema.ccSessions.id,
      device: schema.ccSessions.device,
      cwd: schema.ccSessions.cwd,
      startedAt: schema.ccSessions.startedAt,
      endedAt: schema.ccSessions.endedAt,
      messageCount: schema.ccSessions.messageCount,
      lastUserMessage: schema.ccSessions.lastUserMessage,
      summary: schema.ccSessions.summary,
      projectName: schema.projects.name,
    })
    .from(schema.ccSessions)
    .leftJoin(schema.projects, eq(schema.ccSessions.projectId, schema.projects.id))
    .where(gte(schema.ccSessions.endedAt, cutoff))
    .orderBy(desc(schema.ccSessions.endedAt))
    .limit(opts.limit ?? 25);
}

export async function depsAcross(opts: import("./contracts.js").DepsAcrossInput) {
  const db = getDb();
  return db
    .select({
      name: schema.dependencies.name,
      version: schema.dependencies.version,
      isDev: schema.dependencies.isDev,
      source: schema.dependencies.source,
      projectName: schema.projects.name,
      rootPath: schema.projects.rootPath,
    })
    .from(schema.dependencies)
    .innerJoin(schema.projects, eq(schema.dependencies.projectId, schema.projects.id))
    .where(like(schema.dependencies.name, opts.name))
    .orderBy(schema.projects.name)
    .limit(opts.limit ?? 200);
}
