# AllStarCode Instructor Feedback Tool
## Complete Handoff Guide

**Prepared by:** The AllStarCode Development Team  
**Date:** May 2026

---

## Table of Contents

1. [What This Tool Does](#1-what-this-tool-does)
2. [What You Need to Get Started](#2-what-you-need-to-get-started)
3. [Setting Up Your Accounts](#3-setting-up-your-accounts)
4. [Launching the Application](#4-launching-the-application)
5. [Loading Your Curriculum](#5-loading-your-curriculum)
6. [Creating Admin and Instructor Accounts](#6-creating-admin-and-instructor-accounts)
7. [How to Use the Tool — Admin Guide](#7-how-to-use-the-tool--admin-guide)
8. [How to Use the Tool — Instructor Guide](#8-how-to-use-the-tool--instructor-guide)
9. [Managing Costs and Upgrading](#9-managing-costs-and-upgrading)
10. [Technical Appendix (For Your IT Staff)](#10-technical-appendix-for-your-it-staff)

---

## 1. What This Tool Does

The AllStarCode Instructor Feedback Tool is a web application that helps your organization give AI-powered feedback to instructors on their teaching. It works in two ways:

**Lesson Plan Feedback**
An instructor uploads a PDF of their lesson plan. The AI reads it, compares it against your organization's curriculum, and produces a written feedback report — delivered as a downloadable PDF.

**Video Lesson Feedback**
An instructor uploads a recording of a lesson they taught. The system listens to the audio, converts it to text, and then generates feedback on what was said — again compared against your curriculum and delivered as a PDF report.

**AI Chat Assistant**
Instructors can have a back-and-forth conversation with an AI assistant to ask follow-up questions about their feedback or their lesson content. Chat history is saved so they can return to previous conversations.

**Admin Dashboard**
Administrators can see all of their assigned instructors in one place, review everything those instructors have uploaded, read their feedback reports, and control settings like how long a video an instructor is allowed to upload.

**What makes the feedback useful:** The AI doesn't just give generic teaching advice. It is grounded in *your* curriculum — documents you provide — so feedback is always relevant to what your instructors are actually supposed to be teaching.

---

## 2. What You Need to Get Started

This tool runs on three external services. You will need to create a free account on each. This is a one-time setup.

| Service | What it does for this tool | Cost to start |
|---|---|---|
| **Supabase** | Stores all data (user accounts, uploads, feedback) and handles login | Free |
| **OpenAI** | Powers the AI that reads lesson plans, listens to videos, and writes feedback | Pay-as-you-go (no monthly fee) |
| **Vercel** | Hosts the website so it's accessible on the internet | Free to start |

You will also need the **code** for this application, which your development team has provided as a GitHub repository.

> **A note on costs:** The free tiers of all three services are enough to get started and test the tool. Section 9 explains exactly when and how to upgrade as your usage grows.

---

## 3. Setting Up Your Accounts

### Step 1 — Create a Supabase account and project

Supabase is where all your data lives — instructor accounts, uploaded files, feedback reports, and chat history.

1. Go to **supabase.com** and click **Start your project** to create a free account.
2. Once logged in, click **New project**.
3. Give your project a name (e.g., "allstarcode"), choose a strong database password, and pick the region closest to your users.
4. Click **Create new project** and wait about two minutes for it to set up.

After setup, go to **Project Settings → API** and copy three things — you'll need them shortly:
- **Project URL** (looks like `https://abc123.supabase.co`)
- **anon / public key** (a long string of letters and numbers)
- **service_role key** (another long string — keep this one private)

### Step 2 — Create an OpenAI account

OpenAI provides the AI that powers feedback generation, transcription, and chat.

1. Go to **platform.openai.com** and create an account.
2. Go to **API Keys** and click **Create new secret key**.
3. Copy this key — you'll only see it once.
4. Add a payment method under **Billing**. You won't be charged until the tool starts generating feedback, and even then costs are small (see Section 9 for estimates).

### Step 3 — Create a Vercel account

Vercel hosts the website so instructors and admins can access it from a browser.

1. Go to **vercel.com** and create a free account.
2. Connect it to your GitHub account when prompted.

---

## 4. Launching the Application

This step is best handled by someone with basic technical comfort — or by passing these instructions to your IT contact. The process takes about 20 minutes.

### Step 1 — Set up the database

Your development team has provided a folder called `supabase/migrations/` containing 14 files. These files tell Supabase how to structure your data. You need to run them in order once.

In your Supabase dashboard:
1. Click **SQL Editor** in the left sidebar.
2. Open each migration file (in numbered order, starting with `0001`) in a text editor, copy its contents, paste it into the SQL Editor, and click **Run**.
3. Repeat for all 14 files.

> If you see an error that says something about a missing table, make sure you ran the files in order and didn't skip one.

You also need to enable one database feature called **pgvector** (this powers the curriculum search):
1. Go to **Database → Extensions** in Supabase.
2. Search for `vector` and turn it on.

### Step 2 — Deploy the website on Vercel

1. In Vercel, click **Add New → Project** and import the GitHub repository your development team provided.
2. On the setup screen, set **Root Directory** to `apps/web`.
3. Before clicking Deploy, add the following settings under **Environment Variables**:

| Variable name | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL (from Step 1 of Section 3) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `OPENAI_API_KEY` | Your OpenAI API key (from Section 3, Step 2) |

4. Click **Deploy**. Vercel will build and publish the site. When finished, it will give you a URL like `https://your-app.vercel.app`. This is your application's web address.

### Step 3 — Connect the website address back to Supabase

Supabase needs to know your website's address so that login emails send users to the right place.

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Under **Redirect URLs**, add:
   - `https://your-vercel-url.vercel.app/auth/callback`
   - `https://your-vercel-url.vercel.app/auth/invite-callback`

### Step 4 — Create the first admin account

1. In Supabase, go to **Authentication → Users**.
2. Click **Add user → Create new user** and enter the admin's email and a temporary password.
3. Go to **Table Editor → profiles**, find that user's row, and change their `role` field to `admin`.

The admin can now log in to the application and invite instructors from within the tool — no more manual steps needed after this.

---

## 5. Loading Your Curriculum

This is the most important setup step for feedback quality. The AI compares every lesson plan and video transcript against your curriculum documents. Without this step, feedback will be generic rather than specific to your content.

**What to prepare:** Gather your curriculum materials. Supported file types:
- PowerPoint files (`.pptx`) — recommended, text is extracted slide by slide
- PDF documents
- Word documents saved as text or PDF
- Plain text or Markdown files

Organize them in a folder, and nested subfolders are supported (e.g., `Week 1 / Day 1 / Lecture.pptx`).

**Who runs this:** This step requires running a command on a computer with Python installed. Your IT contact or a developer should handle it.

The command is:
```
python scripts/generate_embeddings.py --docs-dir ./your-curriculum-folder
```

This reads every document, breaks them into sections, and stores them in your Supabase database. It takes a few minutes depending on how many files you have. A success message will appear when it's done.

**When to re-run:** Any time you update or add curriculum documents, run this command again on just the new files. It is safe to re-run — it replaces old content for any file it processes.

> **Cost note:** Running the embedding script costs a small one-time OpenAI fee — typically less than $0.10 for a full curriculum load. It does not cost anything to re-run for individual files.

---

## 6. Creating Admin and Instructor Accounts

### Admin accounts

The first admin account was created manually in Section 4. For additional admins, have your IT contact repeat the same manual process in Supabase.

### Instructor accounts

Admins invite instructors directly from within the application — no developer involvement needed.

1. Log in to the application as an admin.
2. In the left sidebar of the admin dashboard, click **Invite Instructor**.
3. Enter the instructor's email address and click **Send Invite**.
4. The instructor receives an email with a link to set their password and log in. Their account is created automatically with the correct role and assigned to you as their admin.

Instructors do not need to do anything technical — they just click the link in their email.

---

## 7. How to Use the Tool — Admin Guide

### Logging in

Navigate to your application's web address and log in with your email and password. After logging in, you will be taken to the **Admin Dashboard**.

### Your dashboard

The left sidebar shows a list of all instructors assigned to you. Click any instructor's name to view their activity.

### Reviewing an instructor

An instructor's detail page shows:
- **Their uploaded files** — each file name is clickable and opens the uploaded document in a new tab
- **Their feedback reports** — each report has a **View** button that opens the AI-generated feedback PDF

### Inviting a new instructor

Click **Invite Instructor** in the sidebar, enter the instructor's email, and click **Send Invite**. That's it — they will receive an email with instructions to set up their account.

### Setting a video length limit

By default, instructors can upload videos of any length. To set a limit for a specific instructor:

1. Click that instructor's name in the sidebar.
2. Find the **Max video length** field on their detail page.
3. Enter a number of minutes and click **Save**.

To remove the limit, clear the field and click **Save**. This limit applies only to that instructor.

---

## 8. How to Use the Tool — Instructor Guide

### Logging in

You will receive an email invitation from your admin with a link to set your password. After that, navigate to the application's web address and log in.

### Your dashboard

After logging in, you will see your **Instructor Dashboard** showing all files you have uploaded and the status of any feedback reports.

### Uploading a lesson plan (PDF)

1. Click **Upload PDF** on your dashboard.
2. Select your lesson plan PDF file (must be under 5 MB).
3. Your file will appear in the list with the status **Uploaded**.
4. Click **Generate Feedback** next to the file.
5. The status will change to **Generating feedback...** — this usually takes 30 to 60 seconds.
6. When finished, click **View Feedback** to open your feedback report as a PDF.

### Uploading a lesson video

1. Click **Upload Video** on your dashboard.
2. Select your video file (MP4, MOV, or WebM format; max 500 MB).
   - If your admin has set a maximum video length, a video longer than that limit will be rejected with a message explaining the limit.
3. After the upload finishes, click **Generate Feedback**.
4. The status will walk through several stages:
   - **Uploaded** → the video has been received
   - **Transcribing audio** → the system is converting speech to text
   - **Generating feedback** → the AI is writing your feedback
   - **Feedback ready** → click **View Feedback** to open your report
5. Video feedback typically takes 1 to 3 minutes depending on the video length.

### Using the AI Chat

The AI Chat lets you ask follow-up questions about your feedback or your lesson content.

1. In the left sidebar, click **AI Chat Assistant**.
2. Click **+ New Chat** to start a new conversation.
3. Type your question and press Enter or click **Send**.
4. The AI will respond. A typing indicator (three dots) appears while the response is being written.
5. Your previous chat sessions are saved in the sidebar. Click any of them to resume an old conversation.

**Example questions you can ask:**
- "How could I improve my explanation of loops in this lesson?"
- "What does the curriculum say about how to introduce variables to beginners?"
- "What was the main weakness in my feedback report?"

---

## 9. Managing Costs and Upgrading

All three services have free tiers that are sufficient for getting started. Here is what to watch for as your usage grows.

### Supabase (your database)

**Free tier includes:** 500 MB of database storage, 1 GB of file storage, and up to 50,000 user logins per month.

**When to upgrade:**
- Your video and feedback files are the biggest storage consumers. A single 15-minute video can be 500–800 MB. If you have many instructors uploading frequently, storage will fill up within a few months.
- Check your storage usage anytime in **Supabase → Storage → Settings**.

**How to upgrade:** In Supabase, go to **Settings → Billing** and select the **Pro plan** ($25/month). This gives you 8 GB of database storage and 100 GB of file storage — enough for most organizations.

### OpenAI (the AI)

OpenAI charges based on what the AI actually does. There is no monthly fee — you only pay when feedback is generated, audio is transcribed, or the chat is used.

**Estimated costs:**

| Action | Approximate cost |
|---|---|
| Generating feedback from a lesson plan PDF | $0.01 – $0.05 per report |
| Transcribing and generating feedback from a 15-min video | $0.05 – $0.20 per report |
| One AI chat exchange | Less than $0.01 |
| Loading your entire curriculum (one-time) | $0.05 – $0.50 |

For an organization with 20 instructors each submitting 2 reports per month, expect roughly **$2–$8/month** in OpenAI costs.

**How to set a spending limit:** In the OpenAI dashboard, go to **Settings → Limits** and set a monthly maximum to prevent unexpected charges.

### Vercel (your website host)

**Free tier includes:** Enough for most small organizations. However, the free plan limits how long any single request can take — and generating feedback from a long video may hit that limit.

**When to upgrade:** If instructors report that video feedback times out or never finishes, upgrade to the **Vercel Pro plan** ($20/month). This raises the time limit from 10 seconds to 5 minutes, which is needed for video processing.

**How to upgrade:** In Vercel, go to **Settings → Billing** and click **Upgrade to Pro**.

---

## 10. Technical Appendix (For Your IT Staff)

This section is intended for the technical person handling initial setup and ongoing maintenance. It contains implementation details, database schema, and API documentation.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend and backend | Next.js 15 (React, TypeScript), hosted on Vercel |
| Database and auth | Supabase (PostgreSQL with pgvector extension) |
| File storage | Supabase Storage (three private buckets: `documents`, `videos`, `feedback`) |
| AI models | OpenAI `gpt-4o-mini` (feedback + chat), `text-embedding-3-small` (RAG), `gpt-4o-mini-transcribe` (audio) |
| CV analysis | Python + MediaPipe + OpenCV (`CvResearch/main.py`) — standalone, not integrated into the Next.js API by default |
| Video duration probe | `ffprobe-static` (Node.js) |
| PDF rendering | PDFKit (Node.js) |

### Environment variables

All variables go in `apps/web/.env.local` for local development and in the Vercel project's Environment Variables panel for production.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (used for invite flow and video duration cap updates) |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OPENAI_FEEDBACK_MODEL` | No | Model for feedback generation (default: `gpt-4o-mini`) |
| `OPENAI_FEEDBACK_MAX_OUTPUT_TOKENS` | No | Max tokens for feedback output (default: 4096) |
| `OPENAI_CHAT_MODEL` | No | Model for chat (falls back to `OPENAI_FEEDBACK_MODEL`) |
| `OPENAI_CHAT_MAX_OUTPUT_TOKENS` | No | Max tokens for chat output (default: 2048) |
| `FEEDBACK_STORAGE_BUCKET` | No | Storage bucket for generated feedback PDFs (default: `documents`) |
| `ADMIN_MAX_VIDEO_SECONDS` | No | Global video duration cap for admin uploads in seconds (e.g., `900` for 15 min) |

### Database migrations

Run all 14 files in `supabase/migrations/` in numbered order via the Supabase SQL Editor.

| File | Creates |
|---|---|
| `0001_create_curriculum_chunks.sql` | `curriculum_chunks` table + `match_curriculum_chunks` RPC function (pgvector cosine similarity) |
| `0002_create_profiles.sql` | `profiles` table (role: `admin` or `instructor`) with RLS |
| `0003_profiles_trigger.sql` | `handle_new_user` trigger — auto-creates profile on signup |
| `0004_create_feedback.sql` | `feedback` table + private `feedback` storage bucket + RLS policies |
| `0004_create_files.sql` | `files` table + `documents` storage bucket + RLS policies |
| `0005_admin_instructor_assignment.sql` | Adds `assigned_admin_id` to profiles |
| `0006_feedback_user_id_metadata.sql` | Adds `user_id` and metadata fields to feedback |
| `0007_rebuild_feedback_legacy_to_app_schema.sql` | Rebuilds feedback table to final schema |
| `0008_lesson_plans_storage_bucket.sql` | Creates `lesson-plans` storage bucket |
| `0010_invite_instructor.sql` | Updates `handle_new_user` to handle invite metadata (`role`, `invited_by`) |
| `0011_admin_read_lesson_plans.sql` | Storage policy: admins can read assigned instructors' lesson plans |
| `0012_videos_storage_bucket.sql` | Creates private `videos` storage bucket + RLS policies |
| `0013_profiles_video_duration_cap.sql` | Adds `max_video_duration_seconds` to profiles (service_role write only) |
| `0014_create_chat_sessions_and_messages.sql` | `chat_sessions` and `chat_messages` tables with RLS, triggers for `updated_at` |

### Database schema summary

**`profiles`** — one row per user, linked to `auth.users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | FK to `auth.users.id` |
| `role` | text | `'admin'` or `'instructor'` |
| `email` | text | Copied from auth on signup |
| `assigned_admin_id` | uuid | FK to the admin who invited this instructor |
| `max_video_duration_seconds` | integer | Per-instructor upload cap; writable by service_role only |

**`files`** — tracks every uploaded PDF or video

| Column | Type | Notes |
|---|---|---|
| `file_id` | uuid | Primary key |
| `user_id` | uuid | Owner |
| `storage_path` | text | Path in Supabase Storage |
| `original_name` | text | Original filename |
| `content_type` | text | MIME type |
| `status` | text | `uploaded` → `processing` → `complete` / `failed` |
| `status_detail` | text | Error detail on failure |
| `created_at` / `updated_at` | timestamptz | — |

**`feedback`** — generated feedback records

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `instructor_id` | uuid | FK to `auth.users` |
| `lesson_plan_id` | text | Source file identifier |
| `storage_path` | text | Path to the PDF in the `feedback` bucket |
| `feedback_text` | text | Raw feedback text |
| `user_id` | uuid | Who triggered generation |
| `created_at` | timestamptz | — |

**`curriculum_chunks`** — embedded curriculum text for RAG

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `source_doc` | text | Source file path |
| `chunk_text` | text | 1,000-character text chunk |
| `embedding` | vector(1536) | OpenAI `text-embedding-3-small` embedding |
| `metadata` | jsonb | Source name, chunk index, total chunks |
| `created_at` | timestamptz | — |

**`chat_sessions`** and **`chat_messages`** — persistent chat history

`chat_sessions`: `id`, `user_id`, `title`, `created_at`, `updated_at` (auto-bumped by trigger on new message)

`chat_messages`: `id`, `session_id`, `role` (`user` / `assistant`), `content`, `feedback_id` (optional), `created_at`

Both tables have RLS: users can only read/write their own sessions and messages. Message ownership is enforced via an `EXISTS` subquery against `chat_sessions`.

### Storage buckets

| Bucket | Visibility | Path format |
|---|---|---|
| `documents` | Private | `{user_id}/{file_id}.pdf` |
| `videos` | Private | `{user_id}/{file_id}.mp4/.mov/.webm` |
| `feedback` | Private | `{instructor_id}/{...}.pdf` |
| `lesson-plans` | Private | Legacy RAG upload flow |

Admins can read files belonging to their assigned instructors via RLS policies on each bucket.

### API routes

All routes require authentication. Unauthenticated requests return 401.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/admin/invite` | Invite instructor by email. Requires `SUPABASE_SERVICE_ROLE_KEY`. Body: `{ "email": "..." }` |
| GET | `/api/admin/instructors` | List instructors assigned to the logged-in admin |
| GET | `/api/admin/instructors/[id]/files` | Files uploaded by a specific instructor |
| GET | `/api/admin/instructors/[id]/feedback` | Feedback records for a specific instructor |
| PATCH | `/api/admin/instructors/[id]/video-cap` | Set or clear video duration cap. Body: `{ "maxVideoDurationSeconds": 900 }` (null to clear) |
| POST | `/api/files/upload` | Upload PDF. Multipart with `file` field. Returns `{ "file_id": "uuid" }` (201) |
| DELETE | `/api/files/[fileId]` | Delete a file |
| POST | `/api/videos/upload` | Upload video (.mp4/.mov/.webm, max 500 MB). Returns `{ "file_id": "uuid", "duration_seconds": 42.5 }` (201) |
| POST | `/api/feedback/generate` | Generate feedback. PDF: `{ "file_id": "uuid" }`. Video: `{ "source_type": "video", "instructorId": "uuid", "videoFileId": "uuid" }`. Returns `{ "success": true, "feedbackId": "uuid", "storagePath": "..." }` |
| GET | `/api/feedback/user/[userId]` | Feedback records for a user (used by status polling loop) |
| GET | `/feedback/[feedback_id]` | Stream feedback PDF inline (application/pdf) |
| POST | `/api/chat/start` | Create a chat session. Returns `{ "sessionId": "uuid" }` |
| GET | `/api/chat/sessions` | All sessions for logged-in user, ordered by most recent |
| GET | `/api/chat/sessions/[sessionId]` | Full message history for one session |
| POST | `/api/chat/message` | Send a message; upserts session on first message; returns AI response |

### PDF upload validation

1. Authenticated user required
2. Exactly one file, non-empty
3. Size ≤ `MAX_UPLOAD_BYTES` (default 5 MB)
4. MIME type must be `application/pdf`
5. First 5 bytes must match `%PDF-` (magic byte check)

Upload error codes: `MISSING_FILE`, `MULTIPLE_FILES_NOT_ALLOWED`, `EMPTY_FILE`, `INVALID_PDF`, `UNAUTHORIZED`, `FILE_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_FAILED`, `DATABASE_ERROR`. All errors return `{ "error": { "code": "...", "message": "..." } }`.

If the Storage upload succeeds but the database insert fails, the uploaded object is automatically deleted to prevent orphaned files.

### Video upload validation

1. Authenticated user required
2. MIME type: `video/mp4`, `video/quicktime`, or `video/webm`
3. Size ≤ 500 MB
4. Magic bytes checked: ISO BMFF `ftyp` box (MP4/MOV) or EBML header `0x1a45dfa3` (WebM)
5. `ffprobe-static` probes actual duration
6. Duration checked against `profiles.max_video_duration_seconds` (instructor) or `ADMIN_MAX_VIDEO_SECONDS` env var (admin)

### RAG pipeline

**Embedding generation** (`scripts/generate_embeddings.py`):
- Reads PPTX, PDF, TXT, or MD files from a directory (recursive)
- Chunks text at 1,000 characters with 200-character overlap
- Embeds each chunk via OpenAI `text-embedding-3-small` (1,536 dimensions)
- Upserts to `curriculum_chunks`; deletes old chunks for same `source_doc` first

**Retrieval at inference time** (`lib/rag/retrieve-curriculum-context.ts`):
- Spawns `scripts/similarity_search.py` as a subprocess, passing query text via stdin
- Python script calls `match_curriculum_chunks` Postgres RPC (IVFFlat cosine similarity index, top 3 chunks)
- Formatted chunks are injected into the LLM system prompt

### Transcription

**Python** (`backend/transcription.py`): `transcribe_audio(audio_path_or_url: str) -> str`. Supports local paths and HTTP/HTTPS URLs. For URLs, downloads to a temp file, transcribes, then deletes. Model: `gpt-4o-mini-transcribe`. Returns plain text (no timestamps or speaker labels).

**TypeScript** (`lib/feedback/transcribe-video.ts`): `transcribeVideoBuffer` — used inline in the feedback generation route. Writes buffer to `os.tmpdir()`, calls the same OpenAI transcription API, deletes temp file in `finally`. The resulting transcript is passed to `getFeedbackFromRag` with `source: "video_transcript"`, which activates a separate system prompt focused on spoken delivery rather than written lesson structure.

### Computer vision module (`CvResearch/main.py`)

Standalone Python module — not integrated into the Next.js API by default. Analyzes video frames for instructor presence.

```
analyze_zoom_segment(video_path, max_duration_s=300, sample_hz=1.0, start_offset_s=0.0) -> dict
```

Returns `meta` (FPS, duration, sample count, runtime), `samples` (per-frame: `has_face`, `has_pose`, `blendshapes`), and `aggregates` (`face_visibility_ratio`, `pose_visibility_ratio`, `blendshape_means`, `top_blendshapes`).

Detection models in `CvResearch/models/`: `blaze_face_short_range.tflite` (face), `pose_landmarker_lite.task` (pose). Falls back to OpenCV if MediaPipe Tasks is unavailable — blendshape data requires MediaPipe FaceLandmarker (not yet integrated; `blendshapes: {}` is returned as a placeholder).

### Feedback generation — core functions

| Function | Role |
|---|---|
| `extractTextFromPdf` | Reads a PDF buffer and returns lesson plan text |
| `getFeedbackFromRag` | Retrieves curriculum context and calls OpenAI to generate feedback text |
| `renderFeedbackPdf` | Renders feedback text into a PDF buffer via PDFKit |
| `storeFeedbackPdf` | Stores the PDF in the `feedback` bucket and creates the feedback row; returns `feedbackId` and `storagePath` |

### Dashboard status polling

The instructor dashboard polls `GET /api/feedback/user/:userId` every **2.5 seconds** while any video row is in `uploaded`, `transcribing`, or `generating` state. Polling stops when the row reaches `complete` or `failed`. Generate buttons are disabled while any video job is active.

### Admin video duration cap

Per-instructor cap stored in `profiles.max_video_duration_seconds`. Only writable by `service_role` (not by the authenticated user). Updated via `PATCH /api/admin/instructors/[instructorId]/video-cap`, which uses the service role key server-side after verifying the admin's assignment. The `VideoDurationCap` React component in the admin UI converts minutes (display) to seconds (storage).

---

*AllStarCode Instructor Feedback Tool — Handoff Documentation*  
*Developed by the AllStarCode Development Team, May 2026*
