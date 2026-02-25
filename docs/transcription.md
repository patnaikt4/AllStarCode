# Transcription

## Overview

Transcription turns audio (from video or standalone recordings) into plain text for the feedback pipeline. The entry point is `transcribe_audio(audio_path_or_url)` in `backend/transcription.py`.

## How It Works

- **Input:** A local file path or remote URL to an audio file.
- **Output:** Plain text transcript (optionally with timestamps in a later iteration).
- **Implementation:** To be implemented (Whisper / OpenAI API). Placeholder raises `NotImplementedError`.

## Future Integration

- Called by the upload orchestration / feedback pipeline when instructors upload video or audio.
- Transcripts feed into chunking and edit isolation, then into the LLM feedback engine for actionable suggestions.
