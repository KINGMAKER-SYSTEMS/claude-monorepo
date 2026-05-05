import { sql } from "drizzle-orm";
import type { Db } from "@brain/db";
import { daemonState } from "@brain/db/schema";
import { logger } from "@brain/shared";

/**
 * Upsert the singleton daemon_state row. Called on startup and on every
 * status-worthy event (tick completion, watch event). Failures are logged
 * but non-fatal — the daemon should keep running even if Postgres blinks.
 */
export async function updateDaemonState(
  db: Db,
  patch: {
    lastTickAt?: Date;
    lastEventAt?: Date;
    pid?: number;
    socketPath?: string;
    watching?: string[];
    scanQueue?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const values: Record<string, unknown> = {
      id: 1,
      watching: patch.watching ?? [],
      scanQueue: patch.scanQueue ?? 0,
      metadata: patch.metadata ?? {},
    };
    if (patch.pid !== undefined) values["pid"] = patch.pid;
    if (patch.socketPath !== undefined) values["socketPath"] = patch.socketPath;
    if (patch.lastTickAt !== undefined) values["lastTickAt"] = patch.lastTickAt;
    if (patch.lastEventAt !== undefined) values["lastEventAt"] = patch.lastEventAt;

    await db
      .insert(daemonState)
      .values(values as never)
      .onConflictDoUpdate({
        target: daemonState.id,
        set: {
          ...(patch.pid !== undefined && { pid: patch.pid }),
          ...(patch.socketPath !== undefined && { socketPath: patch.socketPath }),
          ...(patch.watching !== undefined && { watching: patch.watching }),
          ...(patch.scanQueue !== undefined && { scanQueue: patch.scanQueue }),
          ...(patch.lastTickAt !== undefined && { lastTickAt: patch.lastTickAt }),
          ...(patch.lastEventAt !== undefined && { lastEventAt: patch.lastEventAt }),
          ...(patch.metadata !== undefined && { metadata: patch.metadata }),
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    logger.warn({ err }, "failed to update daemon_state");
  }
}

export async function clearDaemonState(db: Db): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE daemon_state
      SET pid = NULL, socket_path = NULL, scan_queue = 0, updated_at = now()
      WHERE id = 1
    `);
  } catch (err) {
    logger.warn({ err }, "failed to clear daemon_state");
  }
}
