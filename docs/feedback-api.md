# Feedback HTTP routes (instructor dashboard)

These routes use the logged-in Supabase session (cookies). Call them from the browser with `credentials: 'include'` (or same-origin `<a>` / `<iframe>` for PDFs).

## `GET /feedback/user/:userId`

Returns JSON for the instructor’s feedback history. **Only the signed-in user may request their own id** — if `:userId` ≠ `auth` user, the response is **403**.

**Responses**

| Status | Meaning |
|--------|--------|
| 401 | Not logged in |
| 403 | Logged in as another user (cannot read someone else’s list) |
| 400 | `userId` is not a valid UUID |

**Body (200)**

```json
{
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "lesson_plan_id": "string",
      "original_filename": "lesson-plan-id-feedback.pdf",
      "status": "ready",
      "created_at": "2026-01-01T12:00:00.000Z",
      "storage_path": "userId/lessonPlanId/feedbackId.pdf"
    }
  ]
}
```

Use `id` to open the PDF: `/feedback/{id}`.

---

## `GET /feedback/:feedbackId`

Returns the **PDF bytes** (`Content-Type: application/pdf`). Row-level security plus the session ensure users only receive PDFs for feedback they are allowed to see (own feedback, or admin per Supabase policies). If the row is missing or not visible, the response is **404** (no distinction — avoids ID enumeration).

**Responses**

| Status | Meaning |
|--------|--------|
| 401 | Not logged in |
| 404 | Not found or not accessible |
| 400 | Invalid UUID |

**PDF response headers (200)**

| Header | Purpose |
|--------|--------|
| `Content-Disposition` | `inline; filename="..."` from `original_filename` |
| `X-Feedback-Id` | Feedback row UUID |
| `X-Feedback-Status` | `pending` \| `ready` \| `failed` |
| `X-Feedback-Created-At` | ISO timestamp |
| `X-Lesson-Plan-Id` | Lesson plan identifier |
| `X-Original-Filename` | Sanitized display name |

Metadata is **not** in the JSON body for this route (response body is raw PDF). Read headers if the UI needs status or title without a second request.

---

## Database

Apply migrations in order: `0004_create_feedback.sql`, `0006_feedback_user_id_metadata.sql`, and (if your project still has the legacy `feedback_id` bigint schema) `0007_rebuild_feedback_legacy_to_app_schema.sql`. The `feedback` table uses `user_id`, `original_filename`, and `status`, with RLS so instructors see only their rows (admins per existing policies). Storage bucket `feedback` uses paths whose first segment is the owner’s user id; policies align with that.

---

## QA with the fixture PDF

1. Place `apps/web/tests/fixtures/minimal.pdf` in the **`feedback`** storage bucket at  
   `{instructor_user_id}/qa-fixture/qa.pdf` (first path segment must match the instructor’s UUID for storage RLS).
2. Insert a row (SQL or Table Editor), e.g.:

   - `id`: new UUID  
   - `user_id`: that instructor’s UUID  
   - `lesson_plan_id`: `qa-fixture`  
   - `storage_path`: `{user_id}/qa-fixture/qa.pdf`  
   - `feedback_text`: `'qa'`  
   - `original_filename`: `minimal.pdf`  
   - `status`: `ready`

3. As that user, open `GET /feedback/{id}` — body should match the uploaded file (same size/hash as the fixture).  
4. `GET /feedback/user/{userId}` should list the row with the same metadata fields.
