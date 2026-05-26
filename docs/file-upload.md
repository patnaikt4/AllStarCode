# File and Video Upload

This document covers the API routes for uploading and deleting files. Feedback generation (what happens after a file is uploaded) is covered in [feedback-generation.md](./feedback-generation.md).

---

## PDF Upload

### `POST /api/files/upload`

**File:** `apps/web/app/api/files/upload/route.ts`

Uploads a single PDF lesson plan for the authenticated user. Stores the file in Supabase Storage and records metadata in the `files` table.

**Auth:** Required. Unauthenticated requests return `401` before any file parsing occurs.

**Request:** `multipart/form-data` with a single `file` field containing a PDF.

**Response `201`:**
```json
{ "file_id": "<uuid>" }
```

**Storage path:** `{userId}/{fileId}.pdf` in the `documents` bucket

---

#### Validation rules

Validation runs in this order:

1. User must be authenticated
2. Exactly one file must be present
3. File must not be empty
4. File size must be ≤ `MAX_UPLOAD_BYTES` (env var, defaults to 5 MB)
5. MIME type must be `application/pdf`
6. First 5 bytes must match the PDF magic bytes `%PDF-`

The magic byte check is a second layer of defense beyond the browser-supplied MIME type. A file can be mislabeled or corrupted while still having the correct content type header; checking the actual file signature catches those cases.

#### Error response format

All errors use a consistent shape so the frontend can parse them without special-casing each failure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| `400` | `MISSING_FILE` | No file in the request |
| `400` | `MULTIPLE_FILES_NOT_ALLOWED` | More than one file provided |
| `400` | `EMPTY_FILE` | File has zero bytes |
| `400` | `INVALID_PDF` | File does not start with `%PDF-` |
| `401` | `UNAUTHORIZED` | User is not signed in |
| `413` | `FILE_TOO_LARGE` | File exceeds `MAX_UPLOAD_BYTES` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | MIME type is not `application/pdf` |
| `500` | `UPLOAD_FAILED` | Supabase Storage upload failed |
| `500` | `DATABASE_ERROR` | File metadata could not be saved |

#### Orphan prevention

If the Storage upload succeeds but the database insert fails, the uploaded object is immediately deleted from Storage. This ensures no orphaned files accumulate in the bucket.

---

#### Testing from the browser console

```js
const input = document.createElement('input')
input.type = 'file'
input.accept = 'application/pdf'
input.onchange = async () => {
  const form = new FormData()
  form.append('file', input.files[0])
  const res = await fetch('/api/files/upload', { method: 'POST', body: form })
  console.log(res.status, await res.json())
}
input.click()
```

A successful upload returns `201` with a `file_id`. Unauthenticated returns `401`. Invalid PDF returns `400`.

---

## Video Upload

### `POST /api/videos/upload`

**File:** `apps/web/app/api/videos/upload/route.ts`

Uploads a lesson video (MP4, MOV, or WebM). Validates the file format and duration, then stores the video in Supabase Storage.

**Auth:** Required. The user must have `role = 'instructor'` or `role = 'admin'` in the `profiles` table. Other roles are rejected with `403`.

**Request:** `multipart/form-data` with a single `file` field.

**Response `201`:**
```json
{
  "file_id": "<uuid>",
  "duration_seconds": 142.5
}
```

**Storage path:** `{userId}/{fileId}{ext}` in the `videos` bucket, where `ext` is `.mp4`, `.mov`, or `.webm`

---

#### Validation rules

1. User must be authenticated with `instructor` or `admin` role
2. MIME type must be `video/mp4`, `video/quicktime`, or `video/webm`
3. File size must be ≤ 500 MB
4. Magic bytes are checked to confirm actual format:
   - **MP4/MOV:** ISO BMFF container has an `ftyp` box at byte 4; brand prefix `qt` → QuickTime, otherwise MP4
   - **WebM:** EBML header starts with `0x1a45dfa3`
5. If the declared MIME type does not match the inferred type from magic bytes, the upload is rejected
6. `ffprobe-static` is used to probe the actual video duration in seconds
7. Duration is checked against the applicable cap:
   - **Instructor:** `profiles.max_video_duration_seconds` (set by their assigned admin; requires `assigned_admin_id` to be set)
   - **Admin:** `ADMIN_MAX_VIDEO_SECONDS` env var
   - If no cap is configured, there is no duration limit

#### Duration cap error

When the video exceeds the limit, the response is plain text `400`:

```
video exceeds max duration of 900 seconds
```

The frontend maps this into a user-friendly message, e.g. *"Video exceeds your admin's limit of 15 minutes."*

---

## Legacy PDF Upload

### `POST /api/lesson-plans/upload`

**File:** `apps/web/app/api/lesson-plans/upload/route.ts`

An earlier upload endpoint used by the admin-path lesson plan flow. Functionally similar to `/api/files/upload` but uses a different storage path format:

**Storage path:** `{userId}/{uuid}__{sanitized-filename}` in the `documents` bucket

This endpoint inserts into `files` without setting a `status` field. New instructor-facing code should use `/api/files/upload` instead.

---

## File Deletion

### `DELETE /api/files/:fileId`

**File:** `apps/web/app/api/files/[fileId]/route.ts`

Deletes a file (PDF or video) owned by the authenticated user, along with all associated feedback records.

**Auth:** Required. Only the file's owner can delete it.

**Response `200`:**
```json
{ "success": true }
```

#### Deletion logic

The route handles both PDFs and videos, which are stored differently:

1. **Look up in `files` table** — PDFs and some videos are tracked here. If found and owned by the session user:
   - Determines the Storage bucket from `content_type` (video MIME type → `videos` bucket, otherwise `documents`)
   - Removes the Storage object
   - Deletes all `feedback` rows where `lesson_plan_id = fileId`
   - Deletes the `files` row

2. **Fall back to `videos` bucket** — Videos uploaded through `/api/videos/upload` are stored in the `videos` bucket but not always in `files`. If not found in `files`, the route lists `{userId}/` in the `videos` bucket and searches for a file whose name starts with `fileId`:
   - Removes the Storage object
   - Deletes all `feedback` rows where `lesson_plan_id = fileId`

---

## Database table: `files`

| Column | Type | Description |
|---|---|---|
| `file_id` | uuid | Primary key, generated on upload |
| `user_id` | uuid | Owner; enforced by RLS |
| `storage_path` | text | Full path in Supabase Storage |
| `original_name` | text | Filename as provided by the user |
| `content_type` | text | MIME type (`application/pdf`, `video/mp4`, etc.) |
| `status` | text | `uploaded` → `processing` → `complete` / `failed` |
| `status_detail` | text | Error message when status is `failed` |
| `created_at` / `updated_at` | timestamptz | — |

RLS is enabled. Users can only insert and read their own rows. The same scoping applies to the `documents` Storage bucket.

---

## Storage buckets

| Bucket | Visibility | Contents |
|---|---|---|
| `documents` | Private | Uploaded lesson plan PDFs and generated feedback PDFs |
| `videos` | Private | Uploaded video recordings |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MAX_UPLOAD_BYTES` | `5242880` (5 MB) | Max PDF upload size in bytes |
| `ADMIN_MAX_VIDEO_SECONDS` | *(none)* | Global video duration cap for admin uploads (seconds) |
