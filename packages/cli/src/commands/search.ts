import type { Command } from "commander";
import { ilike, or, sql as drizzleSql } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import { makeTable } from "../format.js";

export function registerSearch(program: Command): void {
  program
    .command("search <query>")
    .description("lexical search across project, file, and symbol names (semantic search lands in Phase 2)")
    .option("--kind <kind>", "restrict to: project|file|symbol|dep")
    .option("--limit <n>", "max results per kind", "10")
    .option("--json", "emit JSON")
    .action(async (query: string, opts: { kind?: string; limit: string; json?: boolean }) => {
      const db = getDb();
      const limit = Math.max(1, Math.min(100, parseInt(opts.limit, 10) || 10));
      const pattern = `%${query}%`;

      const doProjects = !opts.kind || opts.kind === "project";
      const doFiles = !opts.kind || opts.kind === "file";
      const doSymbols = !opts.kind || opts.kind === "symbol";
      const doDeps = !opts.kind || opts.kind === "dep";

      const [projects, files, symbols, deps] = await Promise.all([
        doProjects
          ? db
              .select({ name: schema.projects.name, rootPath: schema.projects.rootPath })
              .from(schema.projects)
              .where(
                or(ilike(schema.projects.name, pattern), ilike(schema.projects.rootPath, pattern)),
              )
              .limit(limit)
          : Promise.resolve([] as Array<{ name: string; rootPath: string }>),
        doFiles
          ? db
              .select({
                relPath: schema.files.relPath,
                project: schema.projects.name,
              })
              .from(schema.files)
              .innerJoin(schema.projects, drizzleSql`${schema.files.projectId} = ${schema.projects.id}`)
              .where(ilike(schema.files.relPath, pattern))
              .limit(limit)
          : Promise.resolve([] as Array<{ relPath: string; project: string }>),
        doSymbols
          ? db
              .select({
                name: schema.symbols.name,
                kind: schema.symbols.kind,
                file: schema.files.relPath,
                project: schema.projects.name,
              })
              .from(schema.symbols)
              .innerJoin(schema.files, drizzleSql`${schema.symbols.fileId} = ${schema.files.id}`)
              .innerJoin(schema.projects, drizzleSql`${schema.files.projectId} = ${schema.projects.id}`)
              .where(ilike(schema.symbols.name, pattern))
              .limit(limit)
          : Promise.resolve([] as Array<{ name: string; kind: string; file: string; project: string }>),
        doDeps
          ? db
              .select({
                name: schema.dependencies.name,
                version: schema.dependencies.version,
                project: schema.projects.name,
              })
              .from(schema.dependencies)
              .innerJoin(
                schema.projects,
                drizzleSql`${schema.dependencies.projectId} = ${schema.projects.id}`,
              )
              .where(ilike(schema.dependencies.name, pattern))
              .limit(limit)
          : Promise.resolve([] as Array<{ name: string; version: string | null; project: string }>),
      ]);

      if (opts.json) {
        console.log(JSON.stringify({ projects, files, symbols, deps }, null, 2));
        return;
      }

      let printed = false;
      if (projects.length > 0) {
        printed = true;
        console.log(pc.bold("projects"));
        const t = makeTable(["name", "path"]);
        for (const r of projects) t.push([pc.bold(r.name), pc.dim(r.rootPath)]);
        console.log(t.toString());
      }
      if (files.length > 0) {
        printed = true;
        console.log(pc.bold("files"));
        const t = makeTable(["path", "project"]);
        for (const r of files) t.push([r.relPath, r.project]);
        console.log(t.toString());
      }
      if (symbols.length > 0) {
        printed = true;
        console.log(pc.bold("symbols"));
        const t = makeTable(["name", "kind", "file", "project"]);
        for (const r of symbols) t.push([pc.bold(r.name), r.kind, r.file, r.project]);
        console.log(t.toString());
      }
      if (deps.length > 0) {
        printed = true;
        console.log(pc.bold("dependencies"));
        const t = makeTable(["name", "version", "project"]);
        for (const r of deps) t.push([pc.bold(r.name), r.version ?? "-", r.project]);
        console.log(t.toString());
      }
      if (!printed) {
        console.log(pc.dim(`no matches for '${query}'`));
      }
    });
}
