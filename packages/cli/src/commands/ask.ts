import type { Command } from "commander";
import { inArray } from "drizzle-orm";
import pc from "picocolors";
import { getDb, schema } from "@brain/db";
import {
  createEmbedder,
  searchByVector,
  summarizeProjects,
  refineOpenLoops,
  type EmbeddingOwner,
} from "@brain/embedder";

interface AskOptions {
  limit?: number;
  kind?: string;
  json?: boolean;
}

export function registerAsk(program: Command): void {
  program
    .command("ask <query...>")
    .description("semantic search across projects, summaries, transcripts, and open loops")
    .option("-n, --limit <n>", "max results (default 8)", (v) => Number(v))
    .option(
      "-k, --kind <kind>",
      "restrict to owner_kind (project_summary, transcript_message, open_loop, readme_chunk, commit_msg, todo_note)",
    )
    .option("--json", "emit JSON instead of rendered text")
    .action(async (queryParts: string[], opts: AskOptions) => {
      const query = queryParts.join(" ").trim();
      if (!query) {
        console.error(pc.red("ask: empty query"));
        process.exit(1);
      }

      const embedder = createEmbedder();
      const res = await embedder.embed({ inputs: [query] });
      const vec = res.vectors[0];
      if (!vec) {
        console.error(pc.red("ask: embedder returned no vector"));
        process.exit(1);
      }

      const kinds: EmbeddingOwner[] | undefined = opts.kind
        ? [opts.kind as EmbeddingOwner]
        : undefined;
      const searchOpts: { limit: number; modelId: string; ownerKinds?: EmbeddingOwner[] } = {
        limit: opts.limit ?? 8,
        modelId: res.modelId,
      };
      if (kinds) searchOpts.ownerKinds = kinds;
      const hits = await searchByVector(vec, searchOpts);
      if (hits.length === 0) {
        console.log(pc.dim("no matches — try `brain scan` to refresh embeddings"));
        return;
      }

      const enriched = await enrich(hits);
      if (opts.json) {
        console.log(JSON.stringify({ query, model: res.modelId, hits: enriched }, null, 2));
        return;
      }

      console.log(pc.bold(pc.cyan(`matches for "${query}"`)));
      console.log(pc.dim(`  ${hits.length} hits · model ${res.modelId}`));
      console.log("");
      for (const h of enriched) {
        const score = (1 - h.distance).toFixed(3);
        console.log(`  ${pc.dim(score)}  ${pc.yellow(h.ownerKind)}  ${pc.bold(h.title)}`);
        if (h.context) console.log(`      ${pc.dim(h.context.slice(0, 160))}`);
        if (h.hint) console.log(`      ${pc.dim("→ " + h.hint)}`);
      }
    });

  program
    .command("summarize")
    .description("generate LLM project summaries + embed them")
    .option("-n, --limit <n>", "max projects", (v) => Number(v))
    .option("--force", "regenerate even if fingerprint matches")
    .action(async (opts: { limit?: number; force?: boolean }) => {
      const o: { limit?: number; skipIfFresh?: boolean } = {};
      if (opts.limit !== undefined) o.limit = opts.limit;
      if (opts.force) o.skipIfFresh = false;
      const res = await summarizeProjects(o);
      console.log(
        pc.green(
          `${res.summarized} summarized · ${res.skipped} unchanged · ${res.embedded} embedded`,
        ),
      );
    });

  program
    .command("refine")
    .description("rewrite messy open loops into actionable next steps")
    .option("-n, --limit <n>", "max loops", (v) => Number(v))
    .action(async (opts: { limit?: number }) => {
      const o: { limit?: number } = {};
      if (opts.limit !== undefined) o.limit = opts.limit;
      const res = await refineOpenLoops(o);
      console.log(pc.green(`${res.refined} refined · ${res.embedded} embedded`));
    });
}

interface EnrichedHit {
  ownerKind: string;
  ownerId: string;
  distance: number;
  title: string;
  context: string | null;
  hint: string | null;
}

async function enrich(
  hits: Array<{ ownerKind: string; ownerId: string; distance: number }>,
): Promise<EnrichedHit[]> {
  const db = getDb();
  const byKind = new Map<string, string[]>();
  for (const h of hits) {
    const bucket = byKind.get(h.ownerKind) ?? [];
    bucket.push(h.ownerId);
    byKind.set(h.ownerKind, bucket);
  }

  const results = new Map<string, { title: string; context: string | null; hint: string | null }>();

  // project_summary → projects row
  const projectIds = byKind.get("project_summary") ?? [];
  if (projectIds.length) {
    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        summary: schema.projects.summary,
        rootPath: schema.projects.rootPath,
      })
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds));
    for (const r of rows) {
      results.set(`project_summary|${r.id}`, {
        title: r.name,
        context: r.summary,
        hint: r.rootPath,
      });
    }
  }

  // open_loop → open_loops row
  const loopIds = byKind.get("open_loop") ?? [];
  if (loopIds.length) {
    const rows = await db
      .select({
        id: schema.openLoops.id,
        text: schema.openLoops.text,
        refinedText: schema.openLoops.refinedText,
        source: schema.openLoops.source,
        sourceRef: schema.openLoops.sourceRef,
      })
      .from(schema.openLoops)
      .where(inArray(schema.openLoops.id, loopIds));
    for (const r of rows) {
      results.set(`open_loop|${r.id}`, {
        title: (r.refinedText ?? r.text).slice(0, 100),
        context: r.source,
        hint: r.sourceRef,
      });
    }
  }

  // transcript_message → cc_sessions row (we embed the session summary/last msg)
  const sessIds = byKind.get("transcript_message") ?? [];
  if (sessIds.length) {
    const rows = await db
      .select({
        id: schema.ccSessions.id,
        device: schema.ccSessions.device,
        cwd: schema.ccSessions.cwd,
        summary: schema.ccSessions.summary,
        lastUserMessage: schema.ccSessions.lastUserMessage,
      })
      .from(schema.ccSessions)
      .where(inArray(schema.ccSessions.id, sessIds));
    for (const r of rows) {
      const text = r.summary ?? r.lastUserMessage ?? "";
      results.set(`transcript_message|${r.id}`, {
        title: text.split("\n")[0]?.slice(0, 80) ?? r.device,
        context: text.slice(0, 300),
        hint: r.cwd ?? r.device,
      });
    }
  }

  // readme_chunk / commit_msg / todo_note → files row (best-effort)
  const fileLike = ["readme_chunk", "commit_msg", "todo_note", "symbol", "file"];
  for (const kind of fileLike) {
    const ids = byKind.get(kind) ?? [];
    if (!ids.length) continue;
    // Minimal fallback: report the raw id so you can `brain project <name>` to investigate.
    for (const id of ids) results.set(`${kind}|${id}`, { title: id, context: null, hint: null });
  }

  return hits.map((h) => {
    const e = results.get(`${h.ownerKind}|${h.ownerId}`);
    return {
      ownerKind: h.ownerKind,
      ownerId: h.ownerId,
      distance: h.distance,
      title: e?.title ?? h.ownerId,
      context: e?.context ?? null,
      hint: e?.hint ?? null,
    };
  });
}
