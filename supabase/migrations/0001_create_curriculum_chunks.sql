-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create curriculum_chunks table
-- Stores chunked All Star Code curriculum content with OpenAI embeddings for RAG
CREATE TABLE IF NOT EXISTS curriculum_chunks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_doc text        NOT NULL,
  chunk_text text        NOT NULL,
  embedding  vector(1536),
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- IVFFlat index for fast cosine similarity search
-- Adjust `lists` based on the number of rows (sqrt of row count is a good heuristic)
CREATE INDEX IF NOT EXISTS curriculum_chunks_embedding_idx
  ON curriculum_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Helper RPC function: returns top-k similar curriculum chunks for a query embedding.
-- Called from the TypeScript RAG pipeline via supabase.rpc('match_curriculum_chunks', ...)
CREATE OR REPLACE FUNCTION match_curriculum_chunks(
  query_embedding vector(1536),
  match_count     int     DEFAULT 5,
  match_threshold float   DEFAULT 0.5
)
RETURNS TABLE (
  id         uuid,
  source_doc text,
  chunk_text text,
  metadata   jsonb,
  similarity float
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
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
