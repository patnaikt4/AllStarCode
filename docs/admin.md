# Admin API

This document covers all admin-only API routes and the shared authorization helper that guards them. For the invite flow and account setup, see also [setup.md](./setup.md).

---

## Authorization helper: `requireAdmin`

**File:** `apps/web/lib/supabase/admin.ts`

Used by every admin route as the first step before any data is touched.

```ts
requireAdmin(): Promise<RequireAdminResult>
```

**Steps:**
1. Creates a server-side Supabase client
2. Calls `supabase.auth.getUser()` to validate the session
3. Queries `profiles` to confirm `role = 'admin'`
4. Returns either `{ ok: true, supabase, user: { id } }` or `{ ok: false, status: 401 | 403, error }`

All admin routes follow this pattern:

```ts
const auth = await requireAdmin()
if (!auth.ok) {
  return NextResponse.json({ error: auth.error }, { status: auth.status })
}
```

| Condition | Response |
|---|---|
| No session | `401 Unauthorized` |
| Session exists but role ≠ `'admin'` | `403 Forbidden` |
| Admin confirmed | Proceeds with `auth.supabase` and `auth.user.id` |

---

## Instructor management

### `GET /api/admin/instructors`

**File:** `apps/web/app/api/admin/instructors/route.ts`

Returns all instructors assigned to the logged-in admin. Assignment is stored as `profiles.assigned_admin_id`.

**Response `200`:**
```json
[
  { "id": "<uuid>", "email": "instructor@example.com" }
]
```

Returns an empty array if the admin has no assigned instructors.

---

### `GET /api/admin/instructors/:instructorId/files`

**File:** `apps/web/app/api/admin/instructors/[instructorId]/files/route.ts`

Returns uploaded files for one instructor. The route verifies that the instructor is assigned to the requesting admin (`assigned_admin_id = admin.id`), not just that they exist.

**Response `200`:**
```json
[
  {
    "file_id": "<uuid>",
    "original_name": "week3-loops.pdf",
    "storage_path": "<userId>/<fileId>.pdf",
    "content_type": "application/pdf",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

| Status | Meaning |
|---|---|
| `400` | `instructorId` is not a valid UUID |
| `404` | Instructor does not exist or is not assigned to this admin |

---

### `GET /api/admin/instructors/:instructorId/feedback`

**File:** `apps/web/app/api/admin/instructors/[instructorId]/feedback/route.ts`

Returns all feedback records for one instructor. Validates that the instructor exists with `role = 'instructor'` but does **not** enforce admin assignment — any admin can view any instructor's feedback.

**Response `200`:**
```json
{
  "items": [
    {
      "id": "<uuid>",
      "user_id": "<uuid>",
      "lesson_plan_id": "<uuid>",
      "original_filename": "week3-loops.pdf",
      "status": "ready",
      "created_at": "2026-01-01T00:00:00Z",
      "storage_path": "<instructorId>/<lessonPlanId>/<feedbackId>.pdf",
      "feedback_text": "..."
    }
  ]
}
```

| Status | Meaning |
|---|---|
| `404` | Instructor not found |

---

### `PATCH /api/admin/instructors/:instructorId/video-cap`

**File:** `apps/web/app/api/admin/instructors/[instructorId]/video-cap/route.ts`

Sets or clears the maximum video upload duration for one of the admin's assigned instructors. This is stored in `profiles.max_video_duration_seconds`, which is only writable by `service_role` (not the authenticated user). The route uses the `SUPABASE_SERVICE_ROLE_KEY` server-side after verifying the admin's assignment.

**Request body:**
```json
{ "maxVideoDurationSeconds": 900 }
```

Send `null` to remove the cap:
```json
{ "maxVideoDurationSeconds": null }
```

**Response `200`:**
```json
{ "id": "<uuid>", "max_video_duration_seconds": 900 }
```

| Status | Meaning |
|---|---|
| `400` | Invalid UUID or invalid `maxVideoDurationSeconds` value |
| `404` | Instructor not found or not assigned to this admin |
| `500` | Service role key missing, or database update failed |

**How the cap is enforced:** When an instructor uploads a video, `/api/videos/upload` reads their `profiles.max_video_duration_seconds`. If the video duration exceeds the cap, the upload is rejected before storage. The `VideoDurationCap` component in the admin UI converts between minutes (display) and seconds (storage).

---

## Instructor invitation

### `POST /api/admin/invite`

**File:** `apps/web/app/api/admin/invite/route.ts`

Sends an email invitation to a new instructor. Uses the Supabase Admin API to generate a magic invite link, which the instructor clicks to set their password. The invitation sets `role: 'instructor'` and `invited_by: adminId` in the new user's metadata, which the `handle_new_user` database trigger reads on signup to populate `profiles.role` and `profiles.assigned_admin_id` automatically.

**Auth:** Must be an authenticated admin (checked via direct profile query, not `requireAdmin()`).

**Request body:**
```json
{ "email": "instructor@example.com" }
```

**Response `200`:**
```json
{
  "success": true,
  "email": "instructor@example.com",
  "inviteLink": "https://..."
}
```

| Status | Meaning |
|---|---|
| `400` | Missing or invalid email address |
| `401` | Not authenticated |
| `403` | Authenticated user is not an admin |
| `409` | An account with this email already exists |
| `500` | Service role key missing, or Supabase invite generation failed |

**Service role key requirement:** The Supabase client used for `generateLink` must be initialized with `SUPABASE_SERVICE_ROLE_KEY` because generating invite links is an admin-level operation that bypasses Row Level Security. The key is accessed server-side only and never exposed to the client.

**Invite redirect:** The generated link redirects the instructor to `/auth/invite-callback` after they set their password.

---

## Profiles table (admin-relevant columns)

| Column | Type | Description |
|---|---|---|
| `id` | uuid | FK to `auth.users.id` |
| `role` | text | `'admin'` or `'instructor'` |
| `email` | text | Copied from auth on signup |
| `assigned_admin_id` | uuid | FK to the admin who invited this instructor |
| `max_video_duration_seconds` | integer | Per-instructor video upload cap; writable by `service_role` only |

RLS ensures users can only read their own profile row. The `max_video_duration_seconds` column has a separate policy allowing only `service_role` to write it, so instructors cannot modify their own cap.
