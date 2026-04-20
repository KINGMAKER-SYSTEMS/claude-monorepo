#!/usr/bin/env tsx
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger, getEnv } from "@brain/shared";
import postgres from "postgres";

// Files ending in `.notx.sql` run statement-by-statement outside a transaction.
// Required for Postgres operations that cannot run inside a tx block, notably
// `ALTER TYPE ... ADD VALUE` for enum extensions.
function splitStatements(body: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDollar = false;
  let dollarTag = "";

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    const next2 = body.slice(i, i + 2);

    if (!inSingle && !inDollar && next2 === "--") {
      const nl = body.indexOf("\n", i);
      i = nl === -1 ? body.length : nl;
      continue;
    }

    if (!inDollar && c === "'") inSingle = !inSingle;

    if (!inSingle && c === "$") {
      if (!inDollar) {
        const end = body.indexOf("$", i + 1);
        if (end !== -1) {
          dollarTag = body.slice(i, end + 1);
          inDollar = true;
          buf += dollarTag;
          i = end;
          continue;
        }
      } else if (body.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length - 1;
        inDollar = false;
        dollarTag = "";
        continue;
      }
    }

    if (!inSingle && !inDollar && c === ";") {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      continue;
    }

    buf += c;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "..", "migrations");
  const sql = postgres(getEnv().DATABASE_URL, { max: 1, prepare: false });

  try {
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS __brain_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const files = readdirSync(migrationsFolder)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const existing = await sql`SELECT 1 FROM __brain_migrations WHERE id = ${file}`;
      if (existing.length > 0) {
        logger.debug({ file }, "migration already applied");
        continue;
      }
      const body = readFileSync(resolve(migrationsFolder, file), "utf8");
      logger.info({ file }, "applying migration");

      if (file.endsWith(".notx.sql")) {
        // Run each statement on its own connection; no wrapping transaction.
        for (const stmt of splitStatements(body)) {
          await sql.unsafe(stmt);
        }
        await sql`INSERT INTO __brain_migrations (id) VALUES (${file})`;
      } else {
        await sql.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`INSERT INTO __brain_migrations (id) VALUES (${file})`;
        });
      }
    }

    logger.info({ count: files.length }, "migrations complete");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
