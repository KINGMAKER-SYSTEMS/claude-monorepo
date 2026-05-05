-- Phase 2.2 — replace partial unique indexes on dedupe_key with full unique
-- indexes so Drizzle's `onConflictDoNothing({ target: dedupeKey })` can match
-- them. Postgres requires ON CONFLICT predicates to match partial index
-- predicates exactly (error 42P10). Full unique btree treats NULLs as
-- distinct, so behavior is equivalent for our usage.

DROP INDEX IF EXISTS open_loops_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS open_loops_dedupe
  ON open_loops (dedupe_key);

DROP INDEX IF EXISTS alerts_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe
  ON alerts (dedupe_key);
