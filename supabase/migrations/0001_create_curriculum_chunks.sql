-- Enable pgvector extension (must be run once per database)
CREATE EXTENSION IF NOT EXISTS vector;

-- Stores curriculum text chunks and their embeddings for similarity search.
-- The embedding column uses pgvector's vector type (1536 dims = text-embedding-3-small).
CREATE TABLE IF NOT EXISTS curriculum_chunks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_doc  text        NOT NULL,
  chunk_text  text        NOT NULL,
  embedding   vector(1536) NOT NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- IVFFlat index for fast approximate cosine similarity search.
-- lists=100 is a reasonable starting point; tune based on row count.
-- NOTE: IVFFlat requires data in the table before the index can be trained.
-- Run this after loading curriculum chunks, not on an empty table.
CREATE INDEX IF NOT EXISTS curriculum_chunks_embedding_idx
  ON curriculum_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC helper used by similarity_search.py.
-- Returns the top `match_count` chunks ordered by cosine similarity (highest first).
CREATE OR REPLACE FUNCTION match_curriculum_chunks(
  query_embedding vector(1536),
  match_count     int DEFAULT 3
)
RETURNS TABLE (
  id          uuid,
  source_doc  text,
  chunk_text  text,
  metadata    jsonb,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    source_doc,
    chunk_text,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity
  FROM curriculum_chunks
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
