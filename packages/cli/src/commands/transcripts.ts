import type { Command } from "commander";
import { desc, eq, isNotNull } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { syncTranscripts } from "@brain/indexer";
import { formatRelativeTime, makeTable } from "../format.js";

export function registerTranscripts(program: Command): void {
  const cmd = program.command("transcripts").description("Claude Code session transcripts");

  cmd
    .command("sync")
    .description("ingest ~/.claude/projects/**/*.jsonl into the brain")
    .option("--since <date>", "ISO date; ignore sessions older than this")
    .action(async (opts: { since?: string }) => {
      const res = await syncTranscripts(
        opts.since ? { since: new Date(opts.since) } : {},
      );
      console.log(
        `${pc.green("synced")} ${res.sessionsSeen} session(s), ${res.sessionsUpserted} updated, ${res.openLoopsInserted} open loop(s)`,
      );
    });

  cmd
    .command("list")
    .description("list recently-ended sessions")
    .option("--limit <n>", "max rows", "20")
    .option("--project <name>", "filter by project name")
    .option("--json", "emit JSON")
    .action(async (opts: { limit: string; project?: string; json?: boolean }) => {
      const db = getDb();
      const limit = Math.max(1, Math.min(200, parseInt(opts.limit, 10) || 20));

      let projectId: string | null = null;
      if (opts.project) {
        const [row] = await db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(eq(schema.projects.name, opts.project))
          .limit(1);
        if (!row) {
          console.log(pc.red(`no project '${opts.project}'`));
          process.exitCode = 1;
          return;
        }
        projectId = row.id;
      }

      const rows = await db
        .select({
          device: schema.ccSessions.device,
          sessionUuid: schema.ccSessions.sessionUuid,
          cwd: schema.ccSessions.cwd,
          startedAt: schema.ccSessions.startedAt,
          endedAt: schema.ccSessions.endedAt,
          messageCount: schema.ccSessions.messageCount,
          lastUserMessage: schema.ccSessions.lastUserMessage,
          projectName: schema.projects.name,
        })
        .from(schema.ccSessions)
        .leftJoin(schema.projects, eq(schema.ccSessions.projectId, schema.projects.id))
        .where(projectId ? eq(schema.ccSessions.projectId, projectId) : isNotNull(schema.ccSessions.sessionUuid))
        .orderBy(desc(schema.ccSessions.endedAt))
        .limit(limit);

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log(pc.dim("no sessions — try `brain transcripts sync`"));
        return;
      }
      const t = makeTable(["device", "project/cwd", "msgs", "ended", "last prompt"]);
      for (const r of rows) {
        const where = r.projectName ?? (r.cwd ? pc.dim(r.cwd.slice(-40)) : pc.dim("—"));
        const last = (r.lastUserMessage ?? "").split(/\r?\n/)[0]?.slice(0, 60) ?? "";
        t.push([r.device.slice(0, 14), where, String(r.messageCount), formatRelativeTime(r.endedAt), last]);
      }
      console.log(t.toString());
    });
}
