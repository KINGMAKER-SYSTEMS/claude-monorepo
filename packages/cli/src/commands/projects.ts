import type { Command } from "commander";
import { and, desc, eq } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { formatRelativeTime, makeTable, statusBadge } from "../format.js";

export function registerProjects(program: Command): void {
  program
    .command("projects")
    .description("list indexed projects")
    .option("--json", "emit JSON instead of a table")
    .option("--dep <name>", "filter to projects depending on a package")
    .action(async (opts: { json?: boolean; dep?: string }) => {
      const db = getDb();

      const baseSelect = {
        id: schema.projects.id,
        name: schema.projects.name,
        rootPath: schema.projects.rootPath,
        kind: schema.projects.kind,
        primaryLang: schema.projects.primaryLang,
        lastScannedAt: schema.projects.lastScannedAt,
      };

      const rows = opts.dep
        ? await db
            .selectDistinct(baseSelect)
            .from(schema.projects)
            .innerJoin(
              schema.dependencies,
              eq(schema.dependencies.projectId, schema.projects.id),
            )
            .where(eq(schema.dependencies.name, opts.dep))
            .orderBy(desc(schema.projects.lastScannedAt))
        : await db.select(baseSelect).from(schema.projects).orderBy(desc(schema.projects.lastScannedAt));

      const enriched = await Promise.all(
        rows.map(async (row) => {
          const [current] = await db
            .select({ name: schema.gitBranches.name, isDirty: schema.gitBranches.isDirty })
            .from(schema.gitBranches)
            .where(
              and(
                eq(schema.gitBranches.projectId, row.id),
                eq(schema.gitBranches.isCurrent, true),
              ),
            )
            .limit(1);
          return {
            ...row,
            currentBranch: current?.name ?? null,
            isDirty: current?.isDirty ?? null,
          };
        }),
      );

      if (opts.json) {
        console.log(JSON.stringify(enriched, null, 2));
        return;
      }

      if (enriched.length === 0) {
        console.log(pc.dim("No projects indexed yet. Try `brain init`."));
        return;
      }

      const table = makeTable(["name", "kind", "branch", "status", "last scan", "path"]);
      for (const row of enriched) {
        table.push([
          pc.bold(row.name),
          row.kind,
          row.currentBranch ?? pc.dim("—"),
          statusBadge(row.isDirty),
          formatRelativeTime(row.lastScannedAt),
          pc.dim(row.rootPath),
        ]);
      }
      console.log(table.toString());
    });
}
