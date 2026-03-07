"""
Transcription module for the AI Lesson Video Feedback Tool.

Provides a single entry point to transcribe audio (file or URL) into plain text.
"""

import os
import tempfile
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


def _is_url(s: str) -> bool:
    try:
        p = urlparse(s)
        return p.scheme in ("http", "https")
    except Exception:
        return False


def _download_url_to_temp_file(url: str) -> str:
    """
    Download a remote audio file to a temporary local file and return its path.
    """
    headers = {"User-Agent": "AllStarCode-Transcription/1.0"}
    resp = requests.get(url, stream=True, timeout=60, headers=headers)
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    if not content_type.startswith("audio/"):
        raise ValueError(
            f"URL does not appear to be audio. Content-Type: {content_type}"
        )

    ext = os.path.splitext(urlparse(url).path)[1]
    suffix = ext if ext else ".audio"

    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)

    with open(tmp_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)

    return tmp_path


def transcribe_audio(audio_path_or_url: str) -> str:
    """
    Transcribe an audio file or URL into plain text.

    Args:
        audio_path_or_url (str): Local file path or remote URL.

    Returns:
        str: Transcript text.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY. Add it to your .env file.")

    temp_path = None
    local_path = audio_path_or_url

    if _is_url(audio_path_or_url):
        temp_path = _download_url_to_temp_file(audio_path_or_url)
        local_path = temp_path
    else:
        if not os.path.exists(local_path):
            raise FileNotFoundError(f"Audio file not found: {local_path}")

    try:
        client = OpenAI(api_key=api_key)
        with open(local_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="gpt-4o-mini-transcribe",
                file=audio_file,
            )

        return transcription.text.strip()

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 backend/transcription.py <audio_path_or_url>")
        raise SystemExit(1)

    print(transcribe_audio(sys.argv[1]))