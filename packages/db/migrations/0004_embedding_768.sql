-- Phase 2.1 — add 768-dim vector column for Ollama's nomic-embed-text and
-- other 768-dim embedders. HNSW index is partial so NULL rows are skipped.

ALTER TABLE embeddings
  ADD COLUMN IF NOT EXISTS embedding_768 vector(768);

CREATE INDEX IF NOT EXISTS embeddings_768_hnsw
  ON embeddings USING hnsw (embedding_768 vector_cosine_ops)
  WHERE embedding_768 IS NOT NULL;
