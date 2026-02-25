"""
Test script for similarity search over curriculum chunks.

Run from project root or scripts/ directory once similarity_search is implemented.
"""

from similarity_search import get_similar_chunks

if __name__ == "__main__":
    results = get_similar_chunks("How do I teach debugging?", 3)
    print(results)
