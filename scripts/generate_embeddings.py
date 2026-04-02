"""
Generate and insert curriculum embeddings for the AI Lesson Video Feedback Tool.

Chunks source text, embeds with OpenAI text-embedding-3-small, and stores rows in Supabase.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from openai import OpenAI
from supabase import Client, create_client

# Same env convention as similarity_search.py
load_dotenv(
    dotenv_path=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "apps",
        "web",
        ".env.local",
    )
)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536

_openai: Optional[OpenAI] = None
_supabase: Optional[Client] = None


def _get_openai() -> OpenAI:
    global _openai
    if _openai is None:
        _openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _openai


def _get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ[
            "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        ]
        _supabase = create_client(url, key)
    return _supabase


def embed_text(text: str) -> List[float]:
    """
    Generate embedding vector for given text using OpenAI text-embedding-3-small.

    Args:
        text: Input text (non-empty recommended).

    Returns:
        1536-dimensional embedding vector.
    """
    text = text.strip()
    if not text:
        raise ValueError("Cannot embed empty text.")

    response = _get_openai().embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
        dimensions=EMBEDDING_DIMENSIONS,
    )
    return response.data[0].embedding


def upsert_curriculum_chunk(
    source_doc: str,
    chunk_text: str,
    embedding: List[float],
    metadata: Dict[str, Any],
) -> None:
    """
    Insert one curriculum chunk and its embedding into Supabase.

    Args:
        source_doc: Logical name of the curriculum source (file, unit, etc.).
        chunk_text: Text chunk to store and retrieve.
        embedding: Vector from embed_text (length 1536).
        metadata: Extra JSON fields (e.g. section, page).
    """
    sb = _get_supabase()
    row = {
        "source_doc": source_doc,
        "chunk_text": chunk_text,
        "embedding": embedding,
        "metadata": metadata or {},
    }
    sb.table("curriculum_chunks").insert(row).execute()


def delete_chunks_for_source(source_doc: str) -> None:
    """Remove all rows for a given source_doc (e.g. before re-ingesting)."""
    sb = _get_supabase()
    sb.table("curriculum_chunks").delete().eq("source_doc", source_doc).execute()


def split_into_chunks(text: str, max_chars: int = 2000) -> List[str]:
    """
    Split document text into chunks for embedding.

    Prefers paragraph boundaries; hard-splits oversized paragraphs.
    """
    text = text.strip()
    if not text:
        return []

    paragraphs = re.split(r"\n\s*\n+", text)
    chunks: List[str] = []
    buf = ""

    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 2 <= max_chars:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            if len(p) <= max_chars:
                buf = p
            else:
                for i in range(0, len(p), max_chars):
                    chunks.append(p[i : i + max_chars])
                buf = ""

    if buf:
        chunks.append(buf)

    return chunks


def ingest_file(
    path: str,
    source_doc: str,
    *,
    replace: bool,
    max_chars: int,
) -> int:
    with open(path, encoding="utf-8") as f:
        body = f.read()
    return ingest_text(body, source_doc, replace=replace, max_chars=max_chars)


def ingest_text(
    body: str,
    source_doc: str,
    *,
    replace: bool,
    max_chars: int,
) -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set (e.g. in apps/web/.env.local).")

    chunks = split_into_chunks(body, max_chars=max_chars)
    if not chunks:
        raise ValueError("No text chunks produced; is the file empty?")

    if replace:
        delete_chunks_for_source(source_doc)

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        vector = embed_text(chunk)
        upsert_curriculum_chunk(
            source_doc,
            chunk,
            vector,
            {"chunk_index": i, "chunk_count": total},
        )

    return total


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Chunk curriculum text, embed with OpenAI, insert into Supabase."
    )
    parser.add_argument(
        "file",
        nargs="?",
        help="Path to a UTF-8 text or markdown file. If omitted, read stdin.",
    )
    parser.add_argument(
        "--source-doc",
        required=True,
        dest="source_doc",
        help='Logical name for this curriculum (e.g. "Unit 3 — Functions").',
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing rows with the same source_doc before inserting.",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=2000,
        dest="max_chars",
        help="Soft max size per chunk (default 2000).",
    )
    args = parser.parse_args()

    try:
        if args.file:
            count = ingest_file(
                args.file,
                args.source_doc,
                replace=args.replace,
                max_chars=args.max_chars,
            )
        else:
            body = sys.stdin.read()
            count = ingest_text(
                body,
                args.source_doc,
                replace=args.replace,
                max_chars=args.max_chars,
            )
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Inserted {count} chunk(s) for source_doc={args.source_doc!r}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
