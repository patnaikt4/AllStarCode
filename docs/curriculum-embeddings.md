# Curriculum Embeddings

## Overview

Curriculum content is chunked, embedded with a text-embedding model, and stored in Supabase (`curriculum_chunks` table with pgvector). This enables similarity search so the LLM feedback engine can pull relevant All Star Code curriculum context for each lesson.

## How It Works

- **Embedding:** `embed_text(text)` in `scripts/generate_embeddings.py` produces a vector for a chunk of text.
- **Storage:** `upsert_curriculum_chunk(...)` writes the chunk and its embedding to Supabase.
- **Search:** `get_similar_chunks(query, k)` in `scripts/similarity_search.py` embeds the query and returns the top-k nearest chunks (pgvector cosine similarity).
- **Schema:** See `supabase/migrations/0001_create_curriculum_chunks.sql` for the planned table shape.

## Future Integration

- Similarity search results are passed into the LLM feedback engine as context so suggestions are pertinent and aligned with the All Star Code curriculum (MVP0/MVP1).
