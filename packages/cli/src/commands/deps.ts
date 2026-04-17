import type { Command } from "commander";
import { asc, eq } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { makeTable } from "../format.js";

export function registerDeps(program: Command): void {
  program
    .command("deps [project]")
    .description("list dependencies for a project, or --across to see usage across all projects")
    .option("--across <name>", "show every project that depends on the named package")
    .option("--json", "emit JSON")
    .action(async (projectName: string | undefined, opts: { across?: string; json?: boolean }) => {
      const db = getDb();

      if (opts.across) {
        const rows = await db
          .select({
            project: schema.projects.name,
            rootPath: schema.projects.rootPath,
            source: schema.dependencies.source,
            version: schema.dependencies.version,
            isDev: schema.dependencies.isDev,
          })
          .from(schema.dependencies)
          .innerJoin(schema.projects, eq(schema.projects.id, schema.dependencies.projectId))
          .where(eq(schema.dependencies.name, opts.across))
          .orderBy(asc(schema.projects.name));

        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log(pc.dim(`no project depends on '${opts.across}'`));
          return;
        }
        const table = makeTable(["project", "source", "version", "dev"]);
        for (const r of rows) {
          table.push([pc.bold(r.project), r.source, r.version ?? "-", r.isDev ? "yes" : ""]);
        }
        console.log(table.toString());
        return;
      }

      if (!projectName) {
        console.log(pc.red("usage: brain deps <project> | brain deps --across <package>"));
        process.exitCode = 1;
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

      const deps = await db
        .select()
        .from(schema.dependencies)
        .where(eq(schema.dependencies.projectId, project.id))
        .orderBy(asc(schema.dependencies.name));

      if (opts.json) {
        console.log(JSON.stringify(deps, null, 2));
        return;
      }

      if (deps.length === 0) {
        console.log(pc.dim("no dependencies recorded"));
        return;
      }
      const table = makeTable(["name", "version", "source", "dev"]);
      for (const d of deps) {
        table.push([pc.bold(d.name), d.version ?? "-", d.source, d.isDev ? "yes" : ""]);
      }
      console.log(table.toString());
    });
}
