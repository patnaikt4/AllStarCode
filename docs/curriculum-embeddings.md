# Curriculum embeddings

Vector embeddings for All Star Code curriculum text so LLM feedback can cite relevant material via retrieval-augmented generation (RAG).

---

## Current schema

Defined in `supabase/migrations/0001_create_curriculum_chunks.sql`.

| Column | Type | Purpose |
|--------|------|--------|
| `id` | `uuid` | Primary key (default `gen_random_uuid()`). |
| `source_doc` | `text` | Human-readable source name (file, unit, etc.). |
| `chunk_text` | `text` | Text segment that was embedded. |
| `embedding` | `vector(1536)` | Embedding from OpenAI `text-embedding-3-small`. |
| `metadata` | `jsonb` | Extra fields (e.g. `chunk_index`, `chunk_count`). |
| `created_at` | `timestamptz` | Insert time. |

**Extensions / indexes**

- `CREATE EXTENSION vector` enables pgvector.
- IVFFlat index on `embedding` with `vector_cosine_ops` for approximate nearest-neighbor search.

**RPC**

- `match_curriculum_chunks(query_embedding vector(1536), match_count int)` returns the top `match_count` rows by cosine distance, with `similarity = 1 - (embedding <=> query_embedding)`.

Apply migrations with the Supabase CLI or paste SQL into the SQL editor so the table and function exist before ingesting data.

---

## How embeddings are generated

1. **Model:** OpenAI `text-embedding-3-small`, **1536 dimensions** (must match the `vector(1536)` column).
2. **Script:** `scripts/generate_embeddings.py`
   - `embed_text(text: str) -> list[float]` calls the Embeddings API with the same model and `dimensions=1536` as `scripts/similarity_search.py` (query embeddings must match stored vectors).
3. **Chunking:** Ingestion splits input on blank lines and packs paragraphs up to `--max-chars` (default 2000), hard-splitting very long paragraphs so each stored chunk fits the model context.

**Environment** (read from `apps/web/.env.local`):

- `OPENAI_API_KEY` — required for embedding calls.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required for inserts.
- `SUPABASE_SERVICE_ROLE_KEY` (optional) — use for ingestion if Row Level Security or policies block anon inserts; **do not** expose this key in client-side code.

---

## How to insert new curriculum later

1. Install Python deps: `pip install -r backend/requirements.txt` (from repo root).
2. Ingest a file:

   ```bash
   python scripts/generate_embeddings.py path/to/curriculum.md --source-doc "Unit 2 — Loops"
   ```

3. **Re-import the same source** (replace old chunks for that name):

   ```bash
   python scripts/generate_embeddings.py path/to/curriculum.md --source-doc "Unit 2 — Loops" --replace
   ```

4. **Stdin** (no file argument):

   ```bash
   type some.txt | python scripts/generate_embeddings.py --source-doc "Scratch notes"
   ```

Each chunk is inserted as its own row (new `id`). The CLI stores `metadata.chunk_index` / `chunk_count` for ordering within a source.

**IVFFlat:** If the index was created on an empty table, consider dropping and recreating it after a large bulk load, or use `REINDEX`, so centroids reflect real data (see [Supabase AI / pgvector docs](https://supabase.com/docs/guides/ai)).

---

## How retrieval works

1. **Query embedding:** `scripts/similarity_search.py` embeds the query text (e.g. lesson plan excerpt) with the same model and dimensions.
2. **Search:** It calls Supabase `.rpc("match_curriculum_chunks", { "query_embedding": ..., "match_count": k })`.
3. **Ranking:** PostgreSQL orders by cosine distance `<=>`; smaller distance means closer vectors. The RPC exposes similarity as `1 - distance`.

Smoke test:

```bash
python scripts/test_similarity.py
```

---

## How this plugs into the LLM prompt

1. **API routes:** `apps/web/app/api/feedback/generate/route.ts` calls `getFeedbackFromRag()` for lesson-plan feedback. `apps/web/app/api/chat/message/route.ts` calls `getChatResponseFromRag()` for text-only chat.
2. **RAG step:** shared helper `apps/web/lib/rag/retrieve-curriculum-context.ts` runs `similarity_search.py` with the query text on stdin and reads JSON chunks from stdout. If the script is missing or fails, it falls back to a placeholder string.
3. **Feedback prompting:** `getFeedbackFromRag()` retrieves with the **extracted lesson plan text**, then injects the formatted curriculum context plus lesson plan text into the feedback prompt. `FEEDBACK_SYSTEM_PROMPT` sets the coach role. The model is configured via `OPENAI_FEEDBACK_MODEL` (default `gpt-5-mini`).
4. **Chat prompting:** `getChatResponseFromRag()` retrieves with the **current user message**, then answers with a dedicated instructional-assistant system prompt grounded in the retrieved curriculum and recent capped chat history. The model is configured via `OPENAI_CHAT_MODEL`, falling back to `OPENAI_FEEDBACK_MODEL`, then `gpt-5-mini`.

So: **lesson plan text or chat message → embed + match chunks → stringify context → task-specific LLM prompt**.

---

## References

- [Supabase AI / vectors](https://supabase.com/docs/guides/ai)
- [OpenAI cookbook: semantic search with Supabase](https://cookbook.openai.com/examples/vector_databases/supabase/semantic-search)
- [pgvector](https://github.com/pgvector/pgvector)
