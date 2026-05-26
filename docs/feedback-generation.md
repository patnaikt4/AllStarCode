# Feedback Generation

This document covers the `POST /api/feedback/generate` route and every library function it calls. For reading and listing already-generated feedback, see [feedback-api.md](./feedback-api.md). For how curriculum context is retrieved, see [curriculum-embeddings.md](./curriculum-embeddings.md).

---

## Overview

The feedback generation route accepts either a lesson plan PDF or an instructor video, runs it through a multi-step AI pipeline, and produces:

1. A plain-text feedback string
2. A feedback PDF stored in Supabase Storage
3. A row in the `feedback` database table
4. Optionally, a pair of chat messages in the linked `chat_session`

---

## `POST /api/feedback/generate`

**File:** `apps/web/app/api/feedback/generate/route.ts`

**Auth:** Required. Instructors may only generate feedback for their own files/videos. Admins may generate for any instructor assigned to them.

### Source modes

The route supports two source types controlled by `source_type` in the request body:

| Mode | `source_type` | Required fields |
|---|---|---|
| PDF (own uploaded file) | *(omit)* | `file_id` |
| PDF (admin path) | *(omit)* | `instructorId`, `lessonPlanId` |
| Video | `"video"` | `instructorId`, `videoFileId` |

---

### Request — PDF via `file_id`

Used when an instructor generates feedback on a file they uploaded themselves.

```json
{
  "file_id": "<uuid>",
  "sessionId": "<uuid>",
  "message": "Please review this lesson plan."
}
```

`sessionId` and `message` are optional. When `sessionId` is provided, the user message and a short assistant reply are written to `chat_messages`.

**Flow:**

1. Validate `file_id` is a well-formed UUID
2. Authenticate the request user via Supabase session
3. Look up the file row in `files`; verify the requester owns it or is an admin
4. Confirm `files.status = 'uploaded'` (rejects if already processing or complete)
5. Set `files.status = 'processing'`
6. Download the PDF from the `documents` Storage bucket
7. Extract text with `extractTextFromPdf`
8. Call `getFeedbackFromRag(text)` to generate feedback via RAG + OpenAI
9. Render the feedback PDF with `renderFeedbackPdf`
10. Upload the PDF and insert the `feedback` row via `storeFeedbackPdf`
11. Set `files.status = 'complete'`
12. If any step between 7–10 throws, set `files.status = 'failed'` with the error detail

---

### Request — PDF via `instructorId` + `lessonPlanId`

Legacy admin path for files stored under the older lesson-plans flow.

```json
{
  "instructorId": "<uuid>",
  "lessonPlanId": "<uuid>",
  "originalFilename": "week3-loops.pdf",
  "sessionId": "<uuid>"
}
```

The flow is the same as the `file_id` path but looks up the PDF by `lessonPlanId` in the `files` table and verifies `instructorId` ownership.

---

### Request — Video

```json
{
  "source_type": "video",
  "instructorId": "<uuid>",
  "videoFileId": "<uuid>",
  "videoType": "webcam",
  "startSeconds": 0,
  "endSeconds": 300,
  "sessionId": "<uuid>"
}
```

`videoType` controls which analysis pipelines run:

| Value | Transcription | CV face/pose | Screen analysis |
|---|---|---|---|
| `"webcam"` | ✅ | ✅ | ❌ |
| `"screen"` | ✅ | ❌ | ✅ |
| `"combined"` | ✅ | ✅ | ✅ |

`startSeconds` / `endSeconds` are optional. When both are provided, the video buffer is trimmed to that range before any analysis begins.

**Flow:**

1. Validate `instructorId` and `videoFileId` as UUIDs
2. Authenticate and verify ownership (instructor must equal the session user, or caller must be admin)
3. List the `videos` Storage bucket for a file whose name starts with `videoFileId` to resolve the extension
4. Download the video into a buffer
5. If trim range provided, call `trimVideoBuffer` (fast stream-copy via ffmpeg, no re-encode)
6. Run three operations concurrently with `Promise.allSettled`:
   - **Transcription** — `transcribeVideoBuffer` (ffmpeg audio extraction → OpenAI Whisper)
   - **CV analysis** — `analyzeVideoCV` (runs `CvResearch/main.py` via subprocess) — *non-fatal*
   - **Frame extraction + screen analysis** — `extractVideoFrames` then `analyzeScreenContent` (GPT-4o vision) — *non-fatal*
7. If transcription failed, return `500`; CV and screen failures are silently omitted from the prompt
8. Call `getFeedbackFromRag(transcript, { source: 'video_transcript', cvMetrics, screenTimeline })`
9. Render and store the feedback PDF via `renderFeedbackPdf` + `storeFeedbackPdf`

---

### Response `200`

```json
{
  "success": true,
  "feedbackId": "<uuid>",
  "sessionId": "<uuid>",
  "storagePath": "<instructorId>/<lessonPlanId>/<feedbackId>.pdf"
}
```

`sessionId` is only present when one was provided in the request.

---

## Library functions

### `getFeedbackFromRag`

**File:** `apps/web/lib/feedback/get-feedback-from-rag.ts`

Retrieves curriculum context and calls OpenAI to generate coaching feedback.

```ts
getFeedbackFromRag(
  lessonPlanText: string,
  options?: { source?: FeedbackSource; cvMetrics?: string; screenTimeline?: string }
): Promise<string>
```

`FeedbackSource` is `'written_lesson_plan'` (default) or `'video_transcript'`.

**Steps:**

1. Strip invalid UTF-16 surrogates from all input
2. Call `retrieveCurriculumContext(lessonPlanText)` to fetch the top 3 matching curriculum chunks
3. Build the feedback prompt, inserting: curriculum context, CV metrics (if present), screen timeline (if present), and the lesson text or transcript
4. Call OpenAI with the appropriate system prompt and return the response text

**System prompts:**

- *Written lesson plan* — coaches on curriculum alignment, clarity of objectives, pacing, and sequencing
- *Video transcript* — coaches on verbal clarity, pacing, physical presence (when CV data available), and screen/speech alignment (when screen data available); flags moments where what is said does not match what is shown on screen

When no matching curriculum context is found (similarity below threshold, or similarity search unavailable), a caveat is prepended and general instructional coaching is given instead.

**Model:** `OPENAI_FEEDBACK_MODEL` env var → `gpt-4o-mini` default
**Max output:** `OPENAI_FEEDBACK_MAX_OUTPUT_TOKENS` → 4096 default, hard cap 16,000

---

### `extractTextFromPdf`

**File:** `apps/web/lib/lesson-plan/extract-pdf-text.ts`

```ts
extractTextFromPdf(buffer: Buffer): Promise<string>
```

Validates the `%PDF` magic bytes before parsing. Strips null characters from the output. Throws descriptively if the buffer is empty, not a PDF, or contains no extractable text.

---

### `renderFeedbackPdf`

**File:** `apps/web/lib/feedback/render-feedback-pdf.ts`

```ts
renderFeedbackPdf(params: {
  title: string
  instructorId: string
  lessonPlanId: string
  feedback: string
}): Promise<Buffer>
```

Renders a letter-sized PDF using PDFKit. The header displays the title, instructor ID, lesson plan ID, and ISO generation timestamp. The feedback text is split on double newlines into paragraphs, each rendered at 12pt with a 4pt line gap. Returns the complete PDF as a `Buffer`.

---

### `storeFeedbackPdf`

Defined inline in `apps/web/app/api/feedback/generate/route.ts`.

Uploads the PDF buffer to the configured feedback Storage bucket at `{instructorId}/{lessonPlanId}/{feedbackId}.pdf`, then inserts a row into the `feedback` table. Throws if the Storage upload fails (with a hint if the bucket does not exist) or if the database insert fails.

Returns `{ feedbackId, storagePath }`.

---

### `getFeedbackStorageBucket`

**File:** `apps/web/lib/feedback/feedback-storage-bucket.ts`

```ts
getFeedbackStorageBucket(): string
```

Returns `FEEDBACK_STORAGE_BUCKET` env var, or `'documents'` as the default. All feedback PDF uploads use this bucket.

---

## Database tables

### `files`

Tracks every uploaded PDF. The feedback generation route reads and writes the `status` column.

| Column | Type | Description |
|---|---|---|
| `file_id` | uuid | Primary key |
| `user_id` | uuid | Owner |
| `storage_path` | text | Path in Supabase Storage |
| `original_name` | text | Filename as uploaded |
| `content_type` | text | MIME type |
| `status` | text | `uploaded` → `processing` → `complete` / `failed` |
| `status_detail` | text | Error message on failure |
| `created_at` / `updated_at` | timestamptz | — |

**Status lifecycle:**

```
uploaded  →  processing  →  complete
                         ↘  failed  (status_detail holds the error)
```

### `feedback`

One row per generated feedback report.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | Instructor who owns this feedback |
| `lesson_plan_id` | text | Source file identifier (file UUID or video UUID) |
| `storage_path` | text | Path to the PDF in the feedback Storage bucket |
| `feedback_text` | text | Raw feedback text (same content as the PDF) |
| `original_filename` | text | Human-readable source filename |
| `status` | text | `ready` or `failed` |
| `created_at` | timestamptz | — |

---

## Storage buckets

| Bucket | Path format | Contents |
|---|---|---|
| `documents` | `{userId}/{fileId}.pdf` | Uploaded lesson plan PDFs |
| `documents` (or `FEEDBACK_STORAGE_BUCKET`) | `{instructorId}/{lessonPlanId}/{feedbackId}.pdf` | Generated feedback PDFs |
| `videos` | `{userId}/{fileId}{ext}` | Uploaded video recordings |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required |
| `OPENAI_FEEDBACK_MODEL` | `gpt-4o-mini` | OpenAI model for feedback generation |
| `OPENAI_FEEDBACK_MAX_OUTPUT_TOKENS` | `4096` | Max output tokens (hard cap: 16,000) |
| `FEEDBACK_STORAGE_BUCKET` | `documents` | Storage bucket for generated feedback PDFs |

For video-specific env vars (ffmpeg path, CV script path), see [video-analysis.md](./video-analysis.md).
