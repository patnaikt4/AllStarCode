# Transcription

## Overview

Transcription turns audio (from video or standalone recordings) into plain text for the feedback pipeline. The entry point is `transcribe_audio(audio_path_or_url)` in `backend/transcription.py`.

## How It Works

- **Input:** A local file path or remote URL to an audio file.
- **Output:** Plain text transcript (optionally with timestamps in a later iteration).
- **Implementation:** Uses the OpenAI Audio Transcriptions API (`gpt-4o-mini-transcribe`). If a URL is provided, the file is temporarily downloaded before being sent to the API.

## Development Usage

This module can be run directly for local testing.

1. Create a `.env` file in the project root:

   ```
   OPENAI_API_KEY=your_api_key_here
   ```

2. Install dependencies:

   ```
   python3 -m pip install -r backend/requirements.txt
   ```

3. Run a test transcription:

   ```
   python3 backend/transcription.py backend/sample_audio.m4a
   ```

In production, this function will be called programmatically by the upload/feedback pipeline rather than executed via the command line.

## Example

**Input:** `backend/sample_audio.m4a`  
**Output (example):**  
`This is a sample audio file for T4SG's All Star Code project...`

## Future Integration

- Called by the upload orchestration / feedback pipeline when instructors upload video or audio.
- Transcripts feed into chunking and edit isolation, then into the LLM feedback engine for actionable suggestions.