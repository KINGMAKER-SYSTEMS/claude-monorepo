#!/usr/bin/env tsx
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger, getEnv } from "@brain/shared";
import postgres from "postgres";

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
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO __brain_migrations (id) VALUES (${file})`;
      });
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
