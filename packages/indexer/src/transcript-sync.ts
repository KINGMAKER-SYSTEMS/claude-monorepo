import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@brain/db";
import { childLogger } from "@brain/shared";
import { extractOpenLoops, scanTranscripts, type TranscriptScanOptions } from "./scanners/transcripts.js";

export interface SyncTranscriptsResult {
  sessionsSeen: number;
  sessionsUpserted: number;
  openLoopsInserted: number;
}

/**
 * Ingest Claude Code session transcripts into the DB.
 * Matches sessions to projects by longest-prefix cwd match.
 * Extracts naive "open loops" from user messages.
 */
export async function syncTranscripts(opts: TranscriptScanOptions = {}): Promise<SyncTranscriptsResult> {
  const log = childLogger({ scanner: "transcripts" });
  const sessions = scanTranscripts(opts);
  log.info({ count: sessions.length }, "scanned transcripts");
  if (sessions.length === 0) {
    return { sessionsSeen: 0, sessionsUpserted: 0, openLoopsInserted: 0 };
  }

  const db = getDb();

  const projects = await db
    .select({ id: schema.projects.id, rootPath: schema.projects.rootPath })
    .from(schema.projects);
  const rootPaths = projects
    .map((p) => ({ id: p.id, rootPath: p.rootPath }))
    .sort((a, b) => b.rootPath.length - a.rootPath.length);

  const matchProject = (cwd: string | null): string | null => {
    if (!cwd) return null;
    for (const p of rootPaths) {
      if (cwd === p.rootPath || cwd.startsWith(p.rootPath + "/")) return p.id;
    }
    return null;
  };

  let sessionsUpserted = 0;
  let openLoopsInserted = 0;

  for (const s of sessions) {
    const projectId = matchProject(s.cwd);

    const [existing] = await db
      .select({ id: schema.ccSessions.id, contentHash: schema.ccSessions.contentHash })
      .from(schema.ccSessions)
      .where(
        and(
          eq(schema.ccSessions.device, s.device),
          eq(schema.ccSessions.sessionUuid, s.sessionUuid),
        ),
      )
      .limit(1);

    let sessionId: string;
    if (existing) {
      sessionId = existing.id;
      if (existing.contentHash !== s.contentHash) {
        await db
          .update(schema.ccSessions)
          .set({
            projectId,
            cwd: s.cwd,
            sourcePath: s.sourcePath,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            messageCount: s.messageCount,
            userMessageCount: s.userMessageCount,
            toolUseCount: s.toolUseCount,
            firstUserMessage: s.firstUserMessage,
            lastUserMessage: s.lastUserMessage,
            contentHash: s.contentHash,
            lastSyncedAt: new Date(),
          })
          .where(eq(schema.ccSessions.id, sessionId));
        sessionsUpserted++;
      }
    } else {
      const [row] = await db
        .insert(schema.ccSessions)
        .values({
          device: s.device,
          sessionUuid: s.sessionUuid,
          projectId,
          cwd: s.cwd,
          sourcePath: s.sourcePath,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          messageCount: s.messageCount,
          userMessageCount: s.userMessageCount,
          toolUseCount: s.toolUseCount,
          firstUserMessage: s.firstUserMessage,
          lastUserMessage: s.lastUserMessage,
          contentHash: s.contentHash,
        })
        .returning({ id: schema.ccSessions.id });
      if (!row) continue;
      sessionId = row.id;
      sessionsUpserted++;
    }

    // Extract open loops only from the *last* user message as a heuristic —
    // earlier statements are usually already acted upon.
    if (s.lastUserMessage) {
      const phrases = extractOpenLoops(s.lastUserMessage);
      for (const phrase of phrases) {
        const dedupeKey = createHash("sha1")
          .update(`${sessionId}|${phrase.slice(0, 80)}`)
          .digest("hex")
          .slice(0, 20);
        const res = await db
          .insert(schema.openLoops)
          .values({
            projectId,
            sessionId,
            source: "transcript",
            text: phrase,
            sourceRef: s.sourcePath,
            mentionedAt: s.endedAt ?? s.startedAt ?? new Date(),
            dedupeKey,
          })
          .onConflictDoNothing({ target: schema.openLoops.dedupeKey })
          .returning({ id: schema.openLoops.id });
        openLoopsInserted += res.length;
      }
    }
  }

  await db.insert(schema.scanRuns).values({
    scanner: "transcripts",
    status: "ok",
    finishedAt: new Date(),
    filesChanged: sessionsUpserted,
  });

  return { sessionsSeen: sessions.length, sessionsUpserted, openLoopsInserted };
}
