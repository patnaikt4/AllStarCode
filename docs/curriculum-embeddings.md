# Curriculum Embeddings

## Overview

Curriculum content is chunked, embedded with OpenAI's `text-embedding-3-small` model, and stored in Supabase (`curriculum_chunks` table with pgvector). This enables cosine similarity search so the LLM feedback engine can pull the most relevant All Star Code curriculum context for each instructor transcript.

---

## How It Works

### 1. Embedding Generation (`scripts/generate_embeddings.py`)

- `embed_text(text)` calls the OpenAI Embeddings API and returns a 1536-dimensional float vector.
- `upsert_curriculum_chunk(source_doc, chunk_text, embedding, metadata)` writes the chunk and its vector into the `curriculum_chunks` table in Supabase.

### 2. Database Schema (`supabase/migrations/0001_create_curriculum_chunks.sql`)

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key, auto-generated. |
| `source_doc` | `text` | Name of the source curriculum document. |
| `chunk_text` | `text` | Raw text of the chunk. |
| `embedding` | `vector(1536)` | OpenAI embedding vector (text-embedding-3-small). |
| `metadata` | `jsonb` | Arbitrary extra fields (e.g. lesson number, topic). |
| `created_at` | `timestamptz` | Insertion timestamp. |

An **IVFFlat index** (`vector_cosine_ops`) is created on `embedding` to keep queries fast as the table grows. **Run the index DDL after loading data** — IVFFlat requires rows to exist to train its cluster centroids.

A **stored function** `match_curriculum_chunks(query_embedding, match_count)` encapsulates the pgvector query and is called from Python via Supabase's `.rpc()` helper.

### 3. Similarity Search (`scripts/similarity_search.py`)

**`get_query_embedding(query: str) -> List[float]`**
- Calls OpenAI Embeddings API with the same model/dimensions as stored vectors.
- Returns the 1536-dim embedding for the query string.

**`get_similar_chunks(query: str, k: int = 3) -> List[Dict]`**
- Calls `get_query_embedding` to embed the query.
- Invokes the `match_curriculum_chunks` Supabase RPC with the query vector and `k`.
- Returns a ranked list of dicts, each with `chunk_text`, `metadata`, and `similarity` (0–1 cosine similarity score).

The underlying SQL uses pgvector's **cosine distance operator** (`<=>`):

```sql
SELECT
  id, source_doc, chunk_text, metadata,
  1 - (embedding <=> query_embedding) AS similarity
FROM curriculum_chunks
ORDER BY embedding <=> query_embedding
LIMIT match_count;
```

`1 - cosine_distance` converts pgvector's distance (lower = closer) into a similarity score (higher = more relevant).

---

## Configuration

The similarity search script reads environment variables from `apps/web/.env.local` (the same file used by the Next.js app, per README). Add your OpenAI key alongside the existing Supabase keys:

```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
OPENAI_API_KEY=your_openai_key
```

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for embedding calls. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key. |

---

## Running the Test Script

Install dependencies (from project root):

```bash
pip install -r backend/requirements.txt
```

Then run:

```bash
# From project root
python scripts/test_similarity.py
```

The script runs the query `"How do I teach debugging?"` and prints the raw list of top-3 matching chunk dicts. Expected output shape:

```
[
  {'id': 'abc...', 'source_doc': 'curriculum.pdf', 'chunk_text': '...', 'metadata': {}, 'similarity': 0.87},
  ...
]
```

---

## Design Decisions

**Why `text-embedding-3-small`?**
- 1536 dimensions — strong semantic quality at low cost (~$0.02 / 1M tokens).
- Same model is used for both storage and query, guaranteeing dimension parity.

**Why IVFFlat over HNSW?**
- IVFFlat has lower memory overhead and is simpler to tune for a small-to-medium corpus. HNSW can be swapped in later if recall or query speed becomes a concern.

**Why a stored RPC function (`match_curriculum_chunks`)?**
- Supabase's Python SDK doesn't support raw SQL through the standard client. Wrapping the pgvector query in a PostgreSQL function lets Python call it cleanly via `.rpc()` without needing a direct database connection.

---

## Future Integration

- `get_similar_chunks(transcript_segment, k=3)` will be called by the LLM feedback pipeline (MVP0/MVP1) to inject relevant curriculum context into the prompt before generating instructor feedback.
- `k` can be tuned; start with 3 and increase if LLM feedback lacks specificity.
