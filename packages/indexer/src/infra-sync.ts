import { and, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@brain/db";
import { childLogger } from "@brain/shared";
import {
  scanLocalInfra,
  assignContainerToProject,
  assignDevServerToProject,
} from "./scanners/infra.js";

export interface InfraSyncResult {
  containers: number;
  devServers: number;
  stopped: number;
  errors: string[];
}

/**
 * Observe local infra (docker + dev servers), upsert into infra_resources,
 * and mark anything not seen in this run as stopped.
 */
export async function syncLocalInfra(): Promise<InfraSyncResult> {
  const log = childLogger({ scanner: "infra-sync" });
  const db = getDb();
  const snap = await scanLocalInfra();

  const projects = await db
    .select({ id: schema.projects.id, rootPath: schema.projects.rootPath })
    .from(schema.projects);

  // We stamp a shared "as of" for this scan so stopped detection is consistent.
  const asOf = new Date();

  let containers = 0;
  for (const c of snap.containers) {
    const projectId = assignContainerToProject(c, projects);
    await upsertInfra({
      kind: "container",
      name: c.name,
      projectId,
      status: c.state,
      endpoint: c.ports || null,
      metadata: {
        image: c.image,
        id: c.id,
        dockerStatus: c.status,
        composeProject: c.composeProject ?? null,
        composeService: c.composeService ?? null,
      },
      asOf,
    });
    containers++;
  }

  let devServers = 0;
  for (const d of snap.devServers) {
    const projectId = assignDevServerToProject(d.cwd, projects);
    const name = projectId
      ? `${projects.find((p: { id: string; rootPath: string }) => p.id === projectId)?.rootPath ?? "?"}:${d.port}`
      : `:${d.port}:${d.pid}`;
    await upsertInfra({
      kind: "dev_server",
      name,
      projectId,
      status: "running",
      endpoint: `127.0.0.1:${d.port}`,
      metadata: {
        pid: d.pid,
        command: d.command,
        framework: d.framework ?? null,
        cwd: d.cwd ?? null,
      },
      asOf,
    });
    devServers++;
  }

  // Anything that was "running" but isn't in this snapshot → stopped.
  const stoppedResult = await db
    .update(schema.infraResources)
    .set({ status: "stopped" })
    .where(
      and(
        inArray(schema.infraResources.kind, ["container", "dev_server"]),
        eq(schema.infraResources.status, "running"),
        or(
          lt(schema.infraResources.lastSeenAt, asOf),
          isNull(schema.infraResources.lastSeenAt),
        ),
      ),
    )
    .returning({ id: schema.infraResources.id });

  log.info(
    {
      containers,
      devServers,
      stopped: stoppedResult.length,
      errors: snap.errors.length,
    },
    "infra sync complete",
  );

  return {
    containers,
    devServers,
    stopped: stoppedResult.length,
    errors: snap.errors,
  };
}

interface UpsertArgs {
  kind: "container" | "dev_server";
  name: string;
  projectId: string | null;
  status: string;
  endpoint: string | null;
  metadata: Record<string, unknown>;
  asOf: Date;
}

async function upsertInfra(a: UpsertArgs): Promise<void> {
  const db = getDb();
  // Raw upsert keyed by the (kind, name, coalesce(project_id, ...)) unique
  // index defined in migration 0003. Drizzle's builder can't express the
  // coalesce-in-index directly.
  await db.execute(sql`
    INSERT INTO infra_resources
      (kind, name, project_id, status, endpoint, metadata, first_seen_at, last_seen_at)
    VALUES
      (${a.kind}, ${a.name}, ${a.projectId}, ${a.status}, ${a.endpoint},
       ${JSON.stringify(a.metadata)}::jsonb, ${a.asOf}, ${a.asOf})
    ON CONFLICT (kind, name, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET
      status = EXCLUDED.status,
      endpoint = EXCLUDED.endpoint,
      metadata = EXCLUDED.metadata,
      last_seen_at = EXCLUDED.last_seen_at
  `);
}
