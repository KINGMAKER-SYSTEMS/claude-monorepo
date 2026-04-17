import type { Command } from "commander";
import { and, desc, eq, type SQL } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { formatRelativeTime, makeTable, statusBadge } from "../format.js";

const VALID_STATUSES = ["active", "shipped", "prototype", "stale", "abandoned", "unknown"] as const;
type Status = (typeof VALID_STATUSES)[number];

const STATUS_COLOR: Record<string, (s: string) => string> = {
  active: pc.green,
  shipped: pc.cyan,
  prototype: pc.yellow,
  stale: pc.dim,
  abandoned: pc.dim,
  unknown: pc.dim,
};

export function registerProjects(program: Command): void {
  program
    .command("projects")
    .description("list indexed projects")
    .option("--json", "emit JSON instead of a table")
    .option("--dep <name>", "filter to projects depending on a package")
    .option("--status <status>", "filter by status: active|shipped|prototype|stale|abandoned|unknown")
    .action(async (opts: { json?: boolean; dep?: string; status?: string }) => {
      const db = getDb();

      const baseSelect = {
        id: schema.projects.id,
        name: schema.projects.name,
        rootPath: schema.projects.rootPath,
        kind: schema.projects.kind,
        primaryLang: schema.projects.primaryLang,
        lastScannedAt: schema.projects.lastScannedAt,
        status: schema.projects.status,
        summary: schema.projects.summary,
        framework: schema.projects.framework,
        deployTargets: schema.projects.deployTargets,
        todoCount: schema.projects.todoCount,
      };

      const filters: SQL[] = [];
      if (opts.status) {
        if (!VALID_STATUSES.includes(opts.status as Status)) {
          console.log(pc.red(`invalid status '${opts.status}'. use: ${VALID_STATUSES.join("|")}`));
          process.exitCode = 1;
          return;
        }
        filters.push(eq(schema.projects.status, opts.status as Status));
      }

      let rows;
      if (opts.dep) {
        const depFilter = eq(schema.dependencies.name, opts.dep);
        rows = await db
          .selectDistinct(baseSelect)
          .from(schema.projects)
          .innerJoin(schema.dependencies, eq(schema.dependencies.projectId, schema.projects.id))
          .where(filters.length ? and(depFilter, ...filters) : depFilter)
          .orderBy(desc(schema.projects.lastScannedAt));
      } else {
        rows = await db
          .select(baseSelect)
          .from(schema.projects)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(schema.projects.lastScannedAt));
      }

      const enriched = await Promise.all(
        rows.map(async (row) => {
          const [current] = await db
            .select({ name: schema.gitBranches.name, isDirty: schema.gitBranches.isDirty })
            .from(schema.gitBranches)
            .where(
              and(eq(schema.gitBranches.projectId, row.id), eq(schema.gitBranches.isCurrent, true)),
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

      const table = makeTable(["name", "status", "summary", "branch", "git", "last scan"]);
      for (const row of enriched) {
        const statusColor = STATUS_COLOR[row.status] ?? pc.dim;
        const summary = row.summary
          ? row.summary.slice(0, 48) + (row.summary.length > 48 ? "…" : "")
          : pc.dim(row.framework ?? row.primaryLang ?? "");
        table.push([
          pc.bold(row.name),
          statusColor(row.status),
          summary,
          row.currentBranch ?? pc.dim("—"),
          statusBadge(row.isDirty),
          formatRelativeTime(row.lastScannedAt),
        ]);
      }
      console.log(table.toString());
    });
}
