import { getEnv } from "@brain/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

let cached: { sql: postgres.Sql; db: Db } | undefined;

function createDb(sql: postgres.Sql) {
  return drizzle(sql, { schema, casing: "snake_case" });
}

export function getDb(): Db {
  if (cached) return cached.db;
  const sql = postgres(getEnv().DATABASE_URL, { max: 10, prepare: false });
  const db = createDb(sql);
  cached = { sql, db };
  return db;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  await cached.sql.end({ timeout: 5 });
  cached = undefined;
}
