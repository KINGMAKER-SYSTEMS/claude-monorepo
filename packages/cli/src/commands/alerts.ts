import type { Command } from "commander";
import { desc, eq, inArray, sql } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { deriveAlerts } from "@brain/indexer";
import { formatRelativeTime, makeTable } from "../format.js";

const SEVERITY_SORT = sql`CASE ${schema.alerts.severity}
  WHEN 'urgent' THEN 0 WHEN 'warn' THEN 1 WHEN 'info' THEN 2 ELSE 3 END`;

export function registerAlerts(program: Command): void {
  const cmd = program.command("alerts").description("actionable attention items across projects");

  cmd
    .command("list", { isDefault: true })
    .description("list open alerts (default)")
    .option("--all", "include resolved alerts")
    .option("--json", "emit JSON")
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.alerts.id,
          kind: schema.alerts.kind,
          severity: schema.alerts.severity,
          title: schema.alerts.title,
          detail: schema.alerts.detail,
          actionHint: schema.alerts.actionHint,
          status: schema.alerts.status,
          detectedAt: schema.alerts.detectedAt,
          projectName: schema.projects.name,
        })
        .from(schema.alerts)
        .leftJoin(schema.projects, eq(schema.alerts.projectId, schema.projects.id))
        .where(opts.all ? sql`true` : eq(schema.alerts.status, "open"))
        .orderBy(SEVERITY_SORT, desc(schema.alerts.detectedAt));

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log(pc.green("no open alerts"));
        return;
      }
      const t = makeTable(["sev", "project", "title", "age"]);
      for (const r of rows) {
        const sev =
          r.severity === "urgent"
            ? pc.red("urgent")
            : r.severity === "warn"
              ? pc.yellow("warn  ")
              : pc.dim("info  ");
        t.push([sev, r.projectName ?? pc.dim("—"), r.title, formatRelativeTime(r.detectedAt)]);
      }
      console.log(t.toString());
    });

  cmd
    .command("refresh")
    .description("re-derive alerts from the current DB state")
    .action(async () => {
      const res = await deriveAlerts();
      console.log(`${pc.green("done")} · ${res.opened} opened · ${res.resolved} resolved`);
    });

  cmd
    .command("ack <id>")
    .description("acknowledge an alert")
    .action(async (id: string) => {
      const db = getDb();
      const res = await db
        .update(schema.alerts)
        .set({ status: "acknowledged" })
        .where(eq(schema.alerts.id, id))
        .returning({ id: schema.alerts.id });
      if (res.length === 0) console.log(pc.red("not found"));
      else console.log(pc.green(`acknowledged ${id.slice(0, 8)}`));
    });

  cmd
    .command("resolve <id...>")
    .description("resolve one or more alerts by id prefix")
    .action(async (ids: string[]) => {
      const db = getDb();
      // Resolve by exact id — if caller passes prefix, they can fetch with `alerts list`.
      const res = await db
        .update(schema.alerts)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(inArray(schema.alerts.id, ids))
        .returning({ id: schema.alerts.id });
      console.log(pc.green(`resolved ${res.length}`));
    });
}
