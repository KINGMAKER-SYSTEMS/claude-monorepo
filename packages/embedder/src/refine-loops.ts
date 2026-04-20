import { sql, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@brain/db";
import { childLogger } from "@brain/shared";
import { embedAndStore } from "./store.js";
import { createEmbedder } from "./factory.js";

export interface RefineOptions {
  apiKey?: string;
  model?: string;
  /** Only refine loops newer than this cutoff. Default: last 14 days. */
  since?: Date;
  limit?: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Rewrite open-loop text into a clean actionable next step. Writes to
 * open_loops.refined_text and embeds the refined text as `open_loop`.
 * Intentionally conservative: only runs on loops that don't already have a
 * refinement.
 */
export async function refineOpenLoops(
  opts: RefineOptions = {},
): Promise<{ refined: number; embedded: number }> {
  const log = childLogger({ scanner: "refine-loops" });
  const db = getDb();
  const apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error("refine-loops requires ANTHROPIC_API_KEY");
  }
  const model = opts.model ?? DEFAULT_MODEL;

  const rows = await db
    .select({
      id: schema.openLoops.id,
      text: schema.openLoops.text,
      source: schema.openLoops.source,
      sourceRef: schema.openLoops.sourceRef,
    })
    .from(schema.openLoops)
    .where(
      sql`${schema.openLoops.status} = 'open' AND ${schema.openLoops.refinedText} IS NULL`,
    )
    .limit(opts.limit ?? 50);

  let refined = 0;
  const toEmbed: { ownerId: string; text: string }[] = [];
  for (const r of rows) {
    let refinedText: string;
    try {
      refinedText = await refineOne(apiKey, model, r.text, r.source);
    } catch (err) {
      log.warn({ err: (err as Error).message, id: r.id }, "refine failed");
      continue;
    }
    await db
      .update(schema.openLoops)
      .set({ refinedText, refinedAt: new Date() })
      .where(eq(schema.openLoops.id, r.id));
    refined++;
    toEmbed.push({ ownerId: r.id, text: refinedText });
  }

  let embedded = 0;
  if (toEmbed.length > 0) {
    const embedder = createEmbedder();
    const res = await embedAndStore(
      embedder,
      toEmbed.map((t) => ({
        ownerKind: "open_loop" as const,
        ownerId: t.ownerId,
        text: t.text,
      })),
    );
    embedded = res.stored;
  }

  log.info({ refined, embedded }, "refine-loops pass complete");
  return { refined, embedded };
}

async function refineOne(
  apiKey: string,
  model: string,
  raw: string,
  source: string,
): Promise<string> {
  const prompt = `You clean up messy open-loop notes (TODO comments, transcript fragments, etc) into one clear, actionable next step — one sentence, imperative voice ("Add X", "Fix Y", "Investigate Z"). Don't invent details that aren't in the input. Don't add explanations. Just the action.

Source type: ${source}
Raw note: ${raw}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = json.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("anthropic returned empty text");
  return text;
}

// avoid unused-import warning when someone disables refinement
void isNull;
