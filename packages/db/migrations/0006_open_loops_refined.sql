-- Phase 2.3 — add refined_text / refined_at to open_loops.
--
-- The schema declared these columns starting in phase 2 (used by the embedder's
-- summarize step to store an LLM-cleaned version of the loop) but no migration
-- ever shipped them. Every brain_standup / brain_open_loops query against this
-- column has been failing with "column open_loops.refined_text does not exist"
-- since the schema was added.
--
-- Both columns are nullable: most existing rows won't have a refined version
-- yet, and the embedder fills them lazily.

ALTER TABLE open_loops
  ADD COLUMN IF NOT EXISTS refined_text text,
  ADD COLUMN IF NOT EXISTS refined_at timestamptz;
