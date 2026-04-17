import type { Command } from "commander";
import { desc, eq } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { makeTable, formatRelativeTime, statusBadge } from "../format.js";

export function registerProject(program: Command): void {
  program
    .command("project <name>")
    .description("show details for a single project")
    .action(async (name: string) => {
      const db = getDb();
      const [project] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.name, name))
        .limit(1);

      if (!project) {
        console.log(pc.red(`no project named '${name}'`));
        process.exitCode = 1;
        return;
      }

      const [branches, recentSessions, openLoops, openAlerts] = await Promise.all([
        db.select().from(schema.gitBranches).where(eq(schema.gitBranches.projectId, project.id)),
        db
          .select({
            device: schema.ccSessions.device,
            endedAt: schema.ccSessions.endedAt,
            messageCount: schema.ccSessions.messageCount,
            lastUserMessage: schema.ccSessions.lastUserMessage,
          })
          .from(schema.ccSessions)
          .where(eq(schema.ccSessions.projectId, project.id))
          .orderBy(desc(schema.ccSessions.endedAt))
          .limit(5),
        db
          .select({
            text: schema.openLoops.text,
            source: schema.openLoops.source,
            sourceRef: schema.openLoops.sourceRef,
            mentionedAt: schema.openLoops.mentionedAt,
          })
          .from(schema.openLoops)
          .where(eq(schema.openLoops.projectId, project.id))
          .orderBy(desc(schema.openLoops.mentionedAt))
          .limit(10),
        db
          .select({
            title: schema.alerts.title,
            severity: schema.alerts.severity,
            detectedAt: schema.alerts.detectedAt,
          })
          .from(schema.alerts)
          .where(eq(schema.alerts.projectId, project.id))
          .orderBy(desc(schema.alerts.detectedAt))
          .limit(10),
      ]);

      console.log(pc.bold(pc.cyan(project.name)) + pc.dim(`  [${project.status}]`));
      if (project.summary) console.log(`  ${project.summary}`);
      console.log(`  ${pc.dim("path:     ")} ${project.rootPath}`);
      console.log(`  ${pc.dim("kind:     ")} ${project.kind}${project.framework ? pc.dim(` · ${project.framework}`) : ""}`);
      console.log(`  ${pc.dim("language: ")} ${project.primaryLang ?? "unknown"}`);
      console.log(`  ${pc.dim("remote:   ")} ${project.gitRemote ?? pc.dim("none")}`);
      console.log(`  ${pc.dim("deploys:  ")} ${project.deployTargets.length ? project.deployTargets.join(", ") : pc.dim("none")}`);
      console.log(`  ${pc.dim("services: ")} ${project.serviceTokens.length ? project.serviceTokens.join(", ") : pc.dim("none")}`);
      console.log(`  ${pc.dim("todos:    ")} ${project.todoCount}`);
      console.log(`  ${pc.dim("last scan:")} ${formatRelativeTime(project.lastScannedAt)}`);
      console.log(`  ${pc.dim("last commit:")}${formatRelativeTime(project.lastCommitAt)}`);

      if (branches.length > 0) {
        console.log("");
        console.log(pc.bold("branches"));
        const table = makeTable(["name", "head", "status", "upstream"]);
        for (const b of branches) {
          table.push([
            b.isCurrent ? pc.green(`* ${b.name}`) : b.name,
            (b.headSha ?? "").slice(0, 8),
            statusBadge(b.isDirty),
            b.upstream ?? pc.dim("—"),
          ]);
        }
        console.log(table.toString());
      }

      if (openAlerts.length > 0) {
        console.log("");
        console.log(pc.bold("open alerts"));
        for (const a of openAlerts) {
          const sev = a.severity === "urgent" ? pc.red("!!") : a.severity === "warn" ? pc.yellow("! ") : pc.dim("· ");
          console.log(`  ${sev} ${a.title}  ${pc.dim(formatRelativeTime(a.detectedAt))}`);
        }
      }

      if (openLoops.length > 0) {
        console.log("");
        console.log(pc.bold("open loops"));
        for (const l of openLoops) {
          const src = l.source === "transcript" ? "§" : l.source === "todo_comment" ? "⌕" : "·";
          console.log(`  ${pc.dim(src)} ${l.text.slice(0, 110)}`);
          console.log(`      ${pc.dim(formatRelativeTime(l.mentionedAt))}${l.sourceRef ? pc.dim("  " + l.sourceRef) : ""}`);
        }
      }

      if (recentSessions.length > 0) {
        console.log("");
        console.log(pc.bold("recent Claude sessions"));
        const t = makeTable(["device", "msgs", "ended", "last prompt"]);
        for (const s of recentSessions) {
          const last = (s.lastUserMessage ?? "").split(/\r?\n/)[0]?.slice(0, 60) ?? "";
          t.push([s.device.slice(0, 14), String(s.messageCount), formatRelativeTime(s.endedAt), last]);
        }
        console.log(t.toString());
      }
    });
}
