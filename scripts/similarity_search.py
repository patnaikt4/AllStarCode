"""
Similarity search over curriculum chunks for the AI Lesson Video Feedback Tool.

Uses OpenAI embeddings and pgvector cosine similarity to retrieve the most
relevant curriculum context for a given instructor transcript query.
"""

import os
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
    os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
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


def get_similar_chunks(query: str, k: int = 3) -> List[Dict]:
    """
    Retrieve top-k most similar curriculum chunks for the given query.

    Embeds the query text, then uses pgvector's cosine distance operator (<=>)
    in Supabase to return the nearest stored curriculum chunks.

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

    return response.data
