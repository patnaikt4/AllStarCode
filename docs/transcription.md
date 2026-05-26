# Transcription

Transcription converts audio or video content into text for the feedback pipeline. The project has two transcription implementations — a Python module used for standalone testing, and a TypeScript function used in the live feedback generation route.

---

## TypeScript: `transcribeVideoBuffer` (production)

**File:** `apps/web/lib/feedback/transcribe-video.ts`

This is the transcription implementation called by `POST /api/feedback/generate` when processing video feedback. It runs in-process within the Next.js API route.

```ts
transcribeVideoBuffer(params: {
  buffer: Buffer
  extension: string  // e.g. '.mp4', '.mov', '.webm'
}): Promise<TranscriptResult>

type TranscriptResult = {
  text: string               // full transcript as a single string
  segments: TranscriptSegment[]
}

type TranscriptSegment = {
  start: number  // seconds
  end: number
  text: string
}
```

### How it works

1. Write the video buffer to a temp file at `os.tmpdir()`
2. Probe for an audio stream by running `ffmpeg -i {file} -hide_banner` and checking for `Stream.*Audio` in stderr
3. If no audio stream is detected, return `{ text: '', segments: [] }` — screen-only recordings with no microphone are valid inputs and are not an error
4. Extract audio and re-encode as MP3 at VBR ~190 kbps using `ffmpeg` with `-acodec libmp3lame`; this ensures Whisper receives a consistently supported format regardless of the source video codec
5. Send the MP3 to OpenAI Whisper (`whisper-1`) with `response_format: 'verbose_json'` and `timestamp_granularities: ['segment']`
6. Return the plain-text transcript and the array of timestamped segments
7. Delete both temp files in a `finally` block, regardless of whether transcription succeeded or failed

### Output format helper

```ts
formatTimestampedTranscript(segments: TranscriptSegment[]): string
```

Converts the segments array into a prompt-ready string:

```
[0:00] Welcome everyone, today we're going to cover variables.
[0:18] A variable is like a named box that stores a value.
[1:05] Let's write our first variable declaration in JavaScript.
```

This timestamped format lets the feedback LLM reference specific moments, e.g. flagging that a concept was explained verbally at `[1:05]` but not shown on screen.

### Model

OpenAI `whisper-1` — provides accurate transcription with segment-level timestamps. Returns plain text; no speaker diarization.

### ffmpeg path

Reads `CV_FFMPEG_PATH` env var, falls back to `'ffmpeg'`.

---

## Python: `transcribe_audio` (standalone / testing)

**File:** `backend/transcription.py`

A standalone Python module used for local testing and as a reference implementation. In production, the TypeScript `transcribeVideoBuffer` above is used instead.

```python
transcribe_audio(audio_path_or_url: str) -> str
```

**Input:** A local file path or an HTTP/HTTPS URL to an audio file.
**Output:** Plain text transcript string (no timestamps or speaker labels).

### How it works

**For local file paths:**
1. Verify the file exists
2. Open the file in binary mode
3. Send to OpenAI Audio Transcriptions API

**For URLs:**
1. `_is_url(s)` detects whether the input is an HTTP/HTTPS URL
2. `_download_url_to_temp_file(url)` downloads the file, validates the response `Content-Type` is audio, preserves the original extension, and writes to a secure temp file
3. The temp file path is passed to the transcription call
4. The temp file is deleted after transcription completes or errors

### Model

`gpt-4o-mini-transcribe` — accurate for plain-text transcription at lower cost. Diarization (`gpt-4o-transcribe-diarize`) is available but not currently needed since the feedback pipeline does not require speaker-level analysis.

### Helper functions

| Function | Responsibility |
|---|---|
| `_is_url(s: str) -> bool` | Returns `True` if the input is an HTTP or HTTPS URL |
| `_download_url_to_temp_file(url: str) -> str` | Downloads remote audio, validates Content-Type, writes to a temp file, returns the temp path |

### Development usage

```bash
pip install -r backend/requirements.txt
python3 backend/transcription.py backend/sample_audio.m4a
python3 backend/transcription.py "https://example.com/audio.m4a"
```

| Test case | Expected result |
|---|---|
| Local `.m4a` file | Opens and transcribes; returns plain text |
| Remote audio URL | Downloads, transcribes, cleans up temp file; returns plain text |
| Missing local file | Fails before making any API request |
| Non-audio URL response | Content-Type validation blocks the transcription call |

---

## Comparison

| | TypeScript (`transcribeVideoBuffer`) | Python (`transcribe_audio`) |
|---|---|---|
| **Used in** | `POST /api/feedback/generate` (live) | Local testing only |
| **Input** | Video buffer (any format) | Audio file path or URL |
| **Audio extraction** | ffmpeg (strips video, re-encodes to MP3) | Not needed — audio-only input |
| **Output** | `{ text, segments[] }` with timestamps | Plain text string |
| **Model** | `whisper-1` | `gpt-4o-mini-transcribe` |
| **Temp file cleanup** | `finally` block | After transcription or on error |
| **No-audio handling** | Returns empty result (non-error) | N/A |
