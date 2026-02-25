"""
Generate and upsert curriculum embeddings for the AI Lesson Video Feedback Tool.

Embeds text chunks and stores them in Supabase for later similarity search.
"""

from typing import Dict, List


def embed_text(text: str) -> List[float]:
    """
    Generate embedding vector for given text.

    Args:
        text (str): Input text.

    Returns:
        List[float]: Embedding vector.
    """
    # TODO: Call OpenAI embedding model
    raise NotImplementedError


def upsert_curriculum_chunk(
    source_doc: str,
    chunk_text: str,
    embedding: List[float],
    metadata: Dict,
) -> None:
    """
    Store curriculum chunk and embedding in Supabase.

    Args:
        source_doc (str): Name of the source document.
        chunk_text (str): Text chunk.
        embedding (List[float]): Vector embedding.
        metadata (Dict): Additional metadata.
    """
    # TODO: Insert into curriculum_chunks table
    raise NotImplementedError
