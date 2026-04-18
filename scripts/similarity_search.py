"""
Similarity search over curriculum chunks for the AI Lesson Video Feedback Tool.

Uses OpenAI embeddings and pgvector cosine similarity to retrieve the most
relevant curriculum context for a given instructor transcript query.
"""

import argparse
import json
import os
import sys
from typing import Dict, List

from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client

# Load env vars from apps/web/.env.local (project convention per README)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "web", ".env.local"))

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536

# Initialise clients once at module level
_openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
_supabase = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
)


def get_query_embedding(query: str) -> List[float]:
    """
    Generate embedding vector for a search query.

    Args:
        query (str): Search query text.

    Returns:
        List[float]: Query embedding vector (1536-dim for text-embedding-3-small).
    """
    response = _openai.embeddings.create(
        model=EMBEDDING_MODEL,
        input=query,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return response.data[0].embedding


MIN_SIMILARITY = 0.15


def get_similar_chunks(query: str, k: int = 3) -> List[Dict]:
    """
    Retrieve top-k most similar curriculum chunks for the given query.

    Embeds the query text, then uses pgvector's cosine distance operator (<=>)
    in Supabase to return the nearest stored curriculum chunks.
    Chunks with similarity below MIN_SIMILARITY are filtered out so that
    irrelevant documents (e.g. a history syllabus) return nothing rather than
    forcing unrelated CS curriculum context.

    Args:
        query (str): Search text (e.g. a segment of an instructor transcript).
        k (int): Number of top results to return. Defaults to 3.

    Returns:
        List[Dict]: Ranked list of dicts, each containing:
            - chunk_text (str): The curriculum chunk content.
            - metadata (dict): Source doc name and any extra fields.
            - similarity (float): Cosine similarity score (1 = identical).
    """
    query_embedding = get_query_embedding(query)

    # pgvector cosine distance: (1 - distance) converts distance → similarity
    response = _supabase.rpc(
        "match_curriculum_chunks",
        {
            "query_embedding": query_embedding,
            "match_count": k,
        },
    ).execute()

    return [chunk for chunk in response.data if (chunk.get("similarity") or 0) >= MIN_SIMILARITY]


def main() -> int:
    """
    Small CLI wrapper so server-side TypeScript can retrieve curriculum chunks.
    """
    parser = argparse.ArgumentParser(description="Retrieve curriculum chunks for a query.")
    parser.add_argument("--query", help="Query text. If omitted, the script reads from stdin.")
    parser.add_argument("--k", type=int, default=3, help="Number of chunks to retrieve.")
    args = parser.parse_args()

    query = args.query if args.query is not None else sys.stdin.read()

    if not query or not query.strip():
        parser.error("A non-empty query is required via --query or stdin.")

    try:
        results = get_similar_chunks(query, args.k)
    except Exception as exc:
        print(f"Similarity search failed: {exc}", file=sys.stderr)
        return 1

    json.dump(results, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
