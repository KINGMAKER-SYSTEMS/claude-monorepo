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
    await db
      .insert(daemonState)
      .values({
        id: 1,
        pid: patch.pid ?? null,
        socketPath: patch.socketPath ?? null,
        watching: patch.watching ?? [],
        scanQueue: patch.scanQueue ?? 0,
        lastTickAt: patch.lastTickAt ?? null,
        lastEventAt: patch.lastEventAt ?? null,
        metadata: patch.metadata ?? {},
      })
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
