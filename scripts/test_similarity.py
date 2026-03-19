"""
Test script for similarity search over curriculum chunks.

Run from the project root:
    python scripts/test_similarity.py

Requires OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and
NEXT_PUBLIC_SUPABASE_ANON_KEY set in apps/web/.env.local (per README).
"""

import os
import sys

# Allow running from project root: python scripts/test_similarity.py
sys.path.insert(0, os.path.dirname(__file__))

from similarity_search import get_similar_chunks

if __name__ == "__main__":
    results = get_similar_chunks("How do I teach debugging?", 3)
    print(results)
