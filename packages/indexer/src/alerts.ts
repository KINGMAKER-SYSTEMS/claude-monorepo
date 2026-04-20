import { createHash } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@brain/db";

export interface DerivedAlert {
  projectId: string | null;
  kind: string;
  severity: "info" | "warn" | "urgent";
  title: string;
  detail?: string | null;
  actionHint?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * Run heuristic alert derivation against the current DB state.
 * Inserts new alerts (dedupe via key), and resolves previously-open alerts
 * whose trigger no longer applies.
 */
export async function deriveAlerts(): Promise<{ opened: number; resolved: number }> {
  const db = getDb();
  const now = new Date();

  const projectsRows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      lastCommitAt: schema.projects.lastCommitAt,
      lastActivityAt: schema.projects.lastActivityAt,
      status: schema.projects.status,
    })
    .from(schema.projects);

  const dirty = await db
    .select({
      projectId: schema.gitBranches.projectId,
      isDirty: schema.gitBranches.isDirty,
      ahead: schema.gitBranches.ahead,
      behind: schema.gitBranches.behind,
      branch: schema.gitBranches.name,
    })
    .from(schema.gitBranches)
    .where(eq(schema.gitBranches.isCurrent, true));

  const dirtyByProject = new Map(dirty.map((r) => [r.projectId, r]));
  const derived: DerivedAlert[] = [];

  for (const p of projectsRows) {
    if (p.status === "abandoned") continue;
    const branch = dirtyByProject.get(p.id);
    const lastActivity = p.lastActivityAt ?? p.lastCommitAt ?? null;
    const daysSince = lastActivity ? (now.getTime() - lastActivity.getTime()) / 86_400_000 : null;

    if (branch?.isDirty && daysSince !== null && daysSince > 7) {
      derived.push({
        projectId: p.id,
        kind: "uncommitted_stale",
        severity: daysSince > 21 ? "urgent" : "warn",
        title: `${p.name}: uncommitted for ${Math.round(daysSince)}d`,
        detail: `Branch ${branch.branch ?? "?"} has uncommitted changes; last activity ${Math.round(daysSince)} days ago.`,
        actionHint: `cd ${p.name} && git status`,
        dedupeKey: keyFor("uncommitted_stale", p.id),
        metadata: { days: Math.round(daysSince), branch: branch.branch },
      });
    }

    if (branch && (branch.ahead ?? 0) > 0 && daysSince !== null && daysSince > 3) {
      derived.push({
        projectId: p.id,
        kind: "unpushed_stale",
        severity: "warn",
        title: `${p.name}: ${branch.ahead} unpushed commits`,
        detail: `Branch ${branch.branch ?? "?"} is ${branch.ahead} commits ahead of upstream.`,
        actionHint: `cd ${p.name} && git push`,
        dedupeKey: keyFor("unpushed_stale", p.id),
        metadata: { ahead: branch.ahead, branch: branch.branch },
      });
    }
  }

  // --- infra-derived alerts ---
  const recently = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const projectNameById = new Map(projectsRows.map((p) => [p.id, p.name]));

  // service_down: container with a project binding, last seen recently, but not running.
  const downContainers = await db
    .select({
      id: schema.infraResources.id,
      name: schema.infraResources.name,
      projectId: schema.infraResources.projectId,
      status: schema.infraResources.status,
      lastSeenAt: schema.infraResources.lastSeenAt,
      metadata: schema.infraResources.metadata,
    })
    .from(schema.infraResources)
    .where(
      and(
        eq(schema.infraResources.kind, "container"),
        inArray(schema.infraResources.status, ["exited", "stopped", "dead", "restarting"]),
        gte(schema.infraResources.lastSeenAt, recently),
      ),
    );

  for (const c of downContainers) {
    if (!c.projectId) continue;
    const pname = projectNameById.get(c.projectId) ?? "?";
    derived.push({
      projectId: c.projectId,
      kind: "service_down",
      severity: "warn",
      title: `${pname}: container ${c.name} is ${c.status}`,
      detail: `Docker container ${c.name} was last seen ${c.status} at ${c.lastSeenAt?.toISOString() ?? "?"}.`,
      actionHint: `docker start ${c.name}`,
      dedupeKey: keyFor("service_down", `${c.projectId}|${c.name}`),
      metadata: { container: c.name, status: c.status },
    });
  }

  // port_conflict: same endpoint claimed by >1 distinct dev_server pid in the
  // last hour. We look at rows with status=running first (cheap), then cross-
  // check metadata pids.
  const recentDev = await db
    .select({
      id: schema.infraResources.id,
      name: schema.infraResources.name,
      projectId: schema.infraResources.projectId,
      endpoint: schema.infraResources.endpoint,
      metadata: schema.infraResources.metadata,
      lastSeenAt: schema.infraResources.lastSeenAt,
    })
    .from(schema.infraResources)
    .where(
      and(
        eq(schema.infraResources.kind, "dev_server"),
        gte(schema.infraResources.lastSeenAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );

  const byEndpoint = new Map<string, typeof recentDev>();
  for (const d of recentDev) {
    const key = d.endpoint ?? d.name;
    const bucket = byEndpoint.get(key) ?? [];
    bucket.push(d);
    byEndpoint.set(key, bucket);
  }
  for (const [endpoint, rows] of byEndpoint) {
    const pids = new Set(
      rows.map((r) => (r.metadata as { pid?: number } | null)?.pid).filter((v) => typeof v === "number"),
    );
    if (pids.size < 2) continue;
    const firstRow = rows[0];
    if (!firstRow) continue;
    const projectId = rows.find((r) => r.projectId)?.projectId ?? null;
    const pname = projectId ? projectNameById.get(projectId) ?? "?" : "local";
    derived.push({
      projectId,
      kind: "port_conflict",
      severity: "warn",
      title: `${pname}: port ${endpoint} claimed by ${pids.size} processes`,
      detail: `Multiple pids recently listened on ${endpoint}: ${[...pids].join(", ")}.`,
      actionHint: `lsof -i ${endpoint}`,
      dedupeKey: keyFor("port_conflict", endpoint),
      metadata: { endpoint, pids: [...pids] },
    });
  }


  // Insert (ignore duplicates by dedupe key).
  let opened = 0;
  for (const a of derived) {
    const res = await db
      .insert(schema.alerts)
      .values({
        projectId: a.projectId,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        detail: a.detail ?? null,
        actionHint: a.actionHint ?? null,
        dedupeKey: a.dedupeKey,
        metadata: a.metadata ?? {},
      })
      .onConflictDoNothing({ target: schema.alerts.dedupeKey })
      .returning({ id: schema.alerts.id });
    opened += res.length;
  }

  // Resolve any previously-open alerts whose dedupe keys are no longer derived.
  const activeKeys = new Set(derived.map((d) => d.dedupeKey));
  const openAlerts = await db
    .select({ id: schema.alerts.id, dedupeKey: schema.alerts.dedupeKey })
    .from(schema.alerts)
    .where(eq(schema.alerts.status, "open"));

  const toResolve = openAlerts
    .filter((r) => r.dedupeKey && !activeKeys.has(r.dedupeKey))
    .map((r) => r.id);

  let resolved = 0;
  if (toResolve.length) {
    const res = await db
      .update(schema.alerts)
      .set({ status: "resolved", resolvedAt: now })
      .where(inArray(schema.alerts.id, toResolve))
      .returning({ id: schema.alerts.id });
    resolved = res.length;
  }

  return { opened, resolved };
}

function keyFor(kind: string, projectId: string): string {
  return createHash("sha1").update(`${kind}|${projectId}`).digest("hex").slice(0, 20);
}
