# Video Analysis Pipeline (TypeScript)

This document covers the TypeScript library modules that process video during feedback generation. They are all called from `POST /api/feedback/generate` when `source_type: "video"` is set. See [feedback-generation.md](./feedback-generation.md) for how these modules are orchestrated together.

For the Python computer vision module (`CvResearch/main.py`), see [cv-analysis.md](./cv-analysis.md).

---

## Overview

When a video feedback request arrives, three analysis pipelines run concurrently:

```
Video buffer
   ├── trimVideoBuffer          (optional, if startSeconds/endSeconds provided)
   │
   ├── transcribeVideoBuffer    → timestamped transcript  ──────────────┐
   ├── analyzeVideoCV           → face/pose metrics (non-fatal)  ───────┤  getFeedbackFromRag
   └── extractVideoFrames       → analyzeScreenContent            ───────┘
         (frames)                   → screen timeline (non-fatal)
```

Transcription is fatal — if it fails, the whole request returns `500`. CV analysis and screen analysis are non-fatal — if they fail, feedback is generated without those signals.

---

## Video trimming

### `trimVideoBuffer` / `validateTrimRange`

**File:** `apps/web/lib/feedback/trim-video.ts`

```ts
validateTrimRange(
  start: unknown,
  end: unknown,
  videoDurationSeconds?: number
): TrimRange | { error: string }
```

Validates the `startSeconds`/`endSeconds` values from the request body. Returns `{ error: 'no range' }` when both inputs are `undefined` — this is the normal "no trim" case, not a validation failure. Any other error (negative start, end ≤ start, etc.) is a real validation error that produces a `400` response.

```ts
trimVideoBuffer(
  buffer: Buffer,
  extension: string,
  { startSeconds, endSeconds }: TrimRange
): Promise<Buffer>
```

Trims the video using ffmpeg with `-ss {startSeconds} -to {endSeconds} -c copy`. The `-c copy` flag performs a stream copy — no re-encoding — so trimming is very fast regardless of video length. Writes input and output to temp files in `os.tmpdir()`, both of which are cleaned up in a `finally` block.

---

## Audio transcription

### `transcribeVideoBuffer`

**File:** `apps/web/lib/feedback/transcribe-video.ts`

```ts
transcribeVideoBuffer(params: {
  buffer: Buffer
  extension: string
}): Promise<TranscriptResult>

type TranscriptResult = {
  text: string
  segments: TranscriptSegment[]
}

type TranscriptSegment = {
  start: number  // seconds
  end: number
  text: string
}
```

**Steps:**

1. Write the video buffer to a temp file at `os.tmpdir()`
2. Probe for an audio stream using ffmpeg (`-i {file} -hide_banner`; scans stderr for `Stream.*Audio`)
3. If no audio stream is found, return `{ text: '', segments: [] }` immediately — screen-only recordings with no microphone are valid
4. Extract audio and re-encode as MP3 at VBR ~190 kbps using `libmp3lame` — Whisper accepts MP3 reliably regardless of source codec
5. Send the MP3 to OpenAI Whisper (`whisper-1`) with `response_format: 'verbose_json'` and `timestamp_granularities: ['segment']`
6. Return the plain-text transcript and the array of timestamped segments
7. Delete both temp files in a `finally` block

**ffmpeg path:** Reads `CV_FFMPEG_PATH` env var, falls back to `'ffmpeg'`.

---

### `formatTimestampedTranscript`

```ts
formatTimestampedTranscript(segments: TranscriptSegment[]): string
```

Converts the segments array into a human-readable string for the LLM prompt:

```
[0:00] Welcome everyone, today we're going to talk about variables.
[0:14] A variable is like a labeled box that holds a value.
[1:03] Let's look at how to declare one in JavaScript.
```

This format allows the feedback LLM to reference specific moments in its feedback (e.g. "At 1:03, you introduced variable declaration but didn't show an example on screen").

---

## Computer vision analysis

### `analyzeVideoCV`

**File:** `apps/web/lib/feedback/analyze-video-cv.ts`

```ts
analyzeVideoCV(videoBuffer: Buffer, extension: string): Promise<CvAnalysisResult | null>
```

Writes the video buffer to a temp file, then runs `CvResearch/main.py` as a subprocess using Node's `execFileAsync`. Returns `null` on any error (non-fatal).

**Script resolution:** Reads `CV_RESEARCH_SCRIPT_PATH` env var. If not set, resolves `../../CvResearch/main.py` relative to `process.cwd()`.

**Python executable:** Reads `CV_PYTHON_EXECUTABLE` env var, defaults to `'python'`.

**Timeout:** 120 seconds.

**Return type:**

```ts
type CvAnalysisResult = {
  aggregates: {
    face_visibility_ratio: number       // fraction of frames where face detected
    pose_visibility_ratio: number       // fraction of frames where body detected
    blendshape_means: Record<string, number>  // mean score per facial expression
    top_blendshapes: { name: string; mean: number }[]  // top 5 expressions
    sample_count: number
    face_sample_count: number
  }
  meta: {
    backend: string                     // 'tasks' or 'opencv'
    effective_duration_s: number
    sample_count: number
    setup_error: string | null
  }
}
```

---

### `formatCvMetrics`

```ts
formatCvMetrics(result: CvAnalysisResult): string
```

Formats the CV analysis result into a plain-text block for the feedback prompt:

```
Computer vision analysis (first 5.0 min, 300 frames sampled):
- Instructor face visible: 93% of frames
- Instructor body visible: 88% of frames
- Dominant facial expressions: mouthSmile_L (avg 0.140), browInnerUp (avg 0.060)
```

---

## Screen content analysis

### `extractVideoFrames`

**File:** `apps/web/lib/feedback/extract-video-frames.ts`

```ts
extractVideoFrames(videoBuffer: Buffer, extension: string): Promise<VideoFrame[]>

type VideoFrame = {
  timestampSeconds: number
  base64: string  // base64-encoded JPEG
}
```

Extracts a sample of frames from the video for screen content analysis.

**Steps:**

1. Write the buffer to a temp file; create a temp directory for output frames
2. Probe video duration using `ffprobe-static`
3. Calculate sampling interval: `videoDuration / 12`, clamped between 5 and 30 seconds — this guarantees at most 12 frames regardless of video length
4. Run ffmpeg: `fps=1/{interval},scale=960:-2` — one frame per interval, scaled to 960px wide (enough to read code on screen without excessive token cost)
5. Read each output JPEG, convert to base64, pair with its timestamp
6. Clean up all temp files in a `finally` block

Returns `[]` on any error (non-fatal).

---

### `analyzeScreenContent`

**File:** `apps/web/lib/feedback/analyze-screen-content.ts`

```ts
analyzeScreenContent(frames: VideoFrame[]): Promise<ScreenTimeline | null>

type ScreenTimeline = {
  entries: { timestampSeconds: number; description: string }[]
  formatted: string
}
```

Sends frames to GPT-4o (vision) to generate a timestamped description of what is on screen.

**Process:**

1. Batch frames into groups of 5 (GPT-4o handles ~800 tokens per 960px image; 5 frames ≈ 4,000 image tokens per batch)
2. For each batch, send a `chat.completions` request with all frames as `image_url` content parts
3. The model is prompted to describe each frame in 1–2 sentences: what is displayed (code editor, browser, terminal, blank desktop, slide, etc.) and the specific content visible (e.g., *"JavaScript variable declaration: `let x = 5`"*)
4. Parse the `[MM:SS] description` lines from the response; fall back to positional ordering if timestamps are missing
5. Combine entries from all batches into a single sorted timeline

Returns `null` if no frames, if `OPENAI_API_KEY` is not set, or on any API error (non-fatal).

---

### `formatScreenTimeline`

```ts
formatScreenTimeline(timeline: ScreenTimeline): string
```

Returns `timeline.formatted`, which looks like:

```
Screen recording timeline:
[0:00] Blank code editor open in VS Code
[0:30] JavaScript variable declaration: let name = "Alex"
[1:00] Browser open showing MDN documentation for typeof operator
[2:00] Terminal showing node execution output: Alex
```

This timeline is injected into the video feedback prompt alongside the transcript. The LLM is instructed to cross-reference the two: flag moments where the instructor explains a concept verbally but the screen is blank or unrelated, and moments where the screen shows content with no verbal explanation.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for Whisper transcription and GPT-4o screen analysis |
| `CV_FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary (used for audio extraction, frame extraction, and trimming) |
| `CV_RESEARCH_SCRIPT_PATH` | `../../CvResearch/main.py` | Path to the Python CV analysis script |
| `CV_PYTHON_EXECUTABLE` | `python` | Python executable for the CV script |
