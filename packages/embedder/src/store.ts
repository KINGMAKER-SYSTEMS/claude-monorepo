import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@brain/db";
import type { Embedder } from "./types.js";

export type EmbeddingOwner =
  | "file"
  | "symbol"
  | "readme_chunk"
  | "commit_msg"
  | "todo_note"
  | "project_summary"
  | "transcript_message"
  | "open_loop";

export interface StoreEmbeddingInput {
  ownerKind: EmbeddingOwner;
  ownerId: string;
  text: string;
}

/**
 * Embed and upsert a batch. Dedupe by (owner_kind, owner_id, model, content_hash)
 * — if the same text was already embedded for this owner+model, skip the API call.
 */
export async function embedAndStore(
  embedder: Embedder,
  batch: StoreEmbeddingInput[],
): Promise<{ stored: number; skipped: number }> {
  if (batch.length === 0) return { stored: 0, skipped: 0 };
  const db = getDb();

  // 1. Hash each input; ask the DB which (owner, model, hash) tuples already
  //    exist so we don't waste API calls.
  const hashed = batch.map((b) => ({ ...b, hash: hashText(b.text) }));
  const existing = await db.execute(sql<{
    owner_kind: string;
    owner_id: string;
    content_hash: string;
  }>`
    SELECT owner_kind, owner_id, content_hash
    FROM embeddings
    WHERE model = ${embedder.modelId}
      AND (owner_kind, owner_id, content_hash) IN (${sql.join(
        hashed.map(
          (h) =>
            sql`(${h.ownerKind}::embedding_owner, ${h.ownerId}::uuid, ${h.hash})`,
        ),
        sql`, `,
      )})
  `);
  const seen = new Set<string>();
  const rows = (existing as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (existing as unknown as Array<Record<string, unknown>>);
  for (const row of rows) {
    seen.add(`${row["owner_kind"]}|${row["owner_id"]}|${row["content_hash"]}`);
  }

  const todo = hashed.filter((h) => !seen.has(`${h.ownerKind}|${h.ownerId}|${h.hash}`));
  if (todo.length === 0) return { stored: 0, skipped: hashed.length };

  // 2. Embed the remainder.
  const res = await embedder.embed({ inputs: todo.map((t) => t.text) });
  const col = res.dim === 1536 ? "embedding_1536" : res.dim === 384 ? "embedding_384" : null;
  if (!col) {
    throw new Error(
      `embedder returned dim=${res.dim}; only 384 and 1536 columns exist on embeddings table`,
    );
  }

  // 3. Insert. We do one statement per row to keep the vector literal simple;
  //    batch tuning can come later.
  let stored = 0;
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const vec = res.vectors[i];
    if (!t || !vec) continue;
    const literal = `[${vec.join(",")}]`;
    await db.execute(sql`
      INSERT INTO embeddings
        (owner_kind, owner_id, model, content_hash, ${sql.identifier(col)})
      VALUES
        (${t.ownerKind}::embedding_owner, ${t.ownerId}::uuid, ${res.modelId}, ${t.hash}, ${literal}::vector)
    `);
    stored++;
  }
  return { stored, skipped: hashed.length - stored };
}

/**
 * Run a vector search against a specific owner_kind set. Returns owner_id +
 * cosine distance (lower = closer).
 */
export async function searchByVector(
  queryVector: number[],
  opts: {
    ownerKinds?: EmbeddingOwner[];
    limit?: number;
    modelId?: string;
  } = {},
): Promise<Array<{ ownerKind: string; ownerId: string; distance: number }>> {
  const db = getDb();
  const dim = queryVector.length;
  const col = dim === 1536 ? "embedding_1536" : dim === 384 ? "embedding_384" : null;
  if (!col) throw new Error(`unsupported query dim: ${dim}`);
  const literal = `[${queryVector.join(",")}]`;
  const limit = opts.limit ?? 12;
  const kinds = opts.ownerKinds ?? [];

  const where = kinds.length > 0
    ? sql`AND owner_kind = ANY(${sql.raw(`ARRAY[${kinds.map((k) => `'${k}'::embedding_owner`).join(",")}]`)})`
    : sql``;
  const modelFilter = opts.modelId ? sql`AND model = ${opts.modelId}` : sql``;

  const result = await db.execute(sql`
    SELECT owner_kind, owner_id, ${sql.identifier(col)} <=> ${literal}::vector AS distance
    FROM embeddings
    WHERE ${sql.identifier(col)} IS NOT NULL ${where} ${modelFilter}
    ORDER BY ${sql.identifier(col)} <=> ${literal}::vector
    LIMIT ${limit}
  `);
  const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (result as unknown as Array<Record<string, unknown>>);
  return rows.map((r) => ({
    ownerKind: String(r["owner_kind"]),
    ownerId: String(r["owner_id"]),
    distance: Number(r["distance"]),
  }));
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
