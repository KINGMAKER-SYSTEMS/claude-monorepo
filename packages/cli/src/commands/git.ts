import type { Command } from "commander";
import { desc, eq } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { makeTable, statusBadge } from "../format.js";

export function registerGit(program: Command): void {
  program
    .command("git [project]")
    .description("show git state for a project, or --dirty to list all dirty projects")
    .option("--dirty", "show only projects with dirty working trees")
    .option("--json", "emit JSON")
    .action(async (projectName: string | undefined, opts: { dirty?: boolean; json?: boolean }) => {
      const db = getDb();

      if (opts.dirty || !projectName) {
        const rows = await db
          .select({
            project: schema.projects.name,
            rootPath: schema.projects.rootPath,
            branch: schema.gitBranches.name,
            isDirty: schema.gitBranches.isDirty,
            ahead: schema.gitBranches.ahead,
            behind: schema.gitBranches.behind,
          })
          .from(schema.gitBranches)
          .innerJoin(schema.projects, eq(schema.projects.id, schema.gitBranches.projectId))
          .where(eq(schema.gitBranches.isCurrent, true))
          .orderBy(desc(schema.projects.lastScannedAt));

        const filtered = opts.dirty ? rows.filter((r) => r.isDirty) : rows;

        if (opts.json) {
          console.log(JSON.stringify(filtered, null, 2));
          return;
        }
        if (filtered.length === 0) {
          console.log(pc.dim("nothing to show"));
          return;
        }
        const table = makeTable(["project", "branch", "status", "ahead", "behind"]);
        for (const r of filtered) {
          table.push([
            pc.bold(r.project),
            r.branch,
            statusBadge(r.isDirty),
            r.ahead?.toString() ?? "-",
            r.behind?.toString() ?? "-",
          ]);
        }
        console.log(table.toString());
        return;
      }

      const [project] = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.name, projectName))
        .limit(1);
      if (!project) {
        console.log(pc.red(`no project named '${projectName}'`));
        process.exitCode = 1;
        return;
      }

      const branches = await db
        .select()
        .from(schema.gitBranches)
        .where(eq(schema.gitBranches.projectId, project.id));

      const commits = await db
        .select()
        .from(schema.gitCommits)
        .where(eq(schema.gitCommits.projectId, project.id))
        .orderBy(desc(schema.gitCommits.committedAt))
        .limit(10);

      if (opts.json) {
        console.log(JSON.stringify({ branches, commits }, null, 2));
        return;
      }

      console.log(pc.bold("branches"));
      const bt = makeTable(["name", "head", "status", "upstream"]);
      for (const b of branches) {
        bt.push([
          b.isCurrent ? pc.green(`* ${b.name}`) : b.name,
          (b.headSha ?? "").slice(0, 8),
          statusBadge(b.isDirty),
          b.upstream ?? pc.dim("—"),
        ]);
      }
      console.log(bt.toString());

      console.log("");
      console.log(pc.bold("recent commits"));
      const ct = makeTable(["sha", "author", "message"]);
      for (const c of commits) {
        ct.push([(c.sha ?? "").slice(0, 8), c.author ?? "?", (c.message ?? "").split("\n")[0] ?? ""]);
      }
      console.log(ct.toString());
    });
}
