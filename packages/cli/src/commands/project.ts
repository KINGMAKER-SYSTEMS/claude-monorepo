import type { Command } from "commander";
import { eq } from "drizzle-orm";
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

      const [depCount] = await db
        .select({ count: schema.dependencies.id })
        .from(schema.dependencies)
        .where(eq(schema.dependencies.projectId, project.id));

      const branches = await db
        .select()
        .from(schema.gitBranches)
        .where(eq(schema.gitBranches.projectId, project.id));

      console.log(pc.bold(pc.cyan(project.name)));
      console.log(`  ${pc.dim("path:      ")} ${project.rootPath}`);
      console.log(`  ${pc.dim("kind:      ")} ${project.kind}`);
      console.log(`  ${pc.dim("language:  ")} ${project.primaryLang ?? "unknown"}`);
      console.log(`  ${pc.dim("remote:    ")} ${project.gitRemote ?? pc.dim("none")}`);
      console.log(`  ${pc.dim("last scan: ")} ${formatRelativeTime(project.lastScannedAt)}`);

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
    });
}
