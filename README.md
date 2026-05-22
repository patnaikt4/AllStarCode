# AllStarCode

A learning platform for coding education. You'll learn everything you need to get accounts working locally.

---

## What you need before you start

### Required

- [Node.js](https://nodejs.org) version 18 or higher
- **ffmpeg** — used for video trimming and frame extraction. Install with:
  ```bash
  brew install ffmpeg        # macOS
  sudo apt install ffmpeg    # Ubuntu/Debian
  ```
- Access to the Supabase project API keys (URL + anon key + service role key)
- An **OpenAI API key** — used for transcription, feedback generation, and screen analysis
- This repository cloned to your computer

### npm packages (installed automatically via `npm install`)

These are declared in `package.json` and do not need to be installed separately:
- `ffprobe-static` — used to probe video duration before upload
- `pdfkit` — used to render feedback as a PDF

### Optional — Computer Vision (facial presence analysis)

The CV analysis runs a local Python script (`CvResearch/main.py`) that detects the instructor's face and body on camera. This is **non-fatal** — if it is not set up, feedback will still generate from transcription and screen analysis alone.

To enable it:
1. Install Python 3.9+
2. `cd CvResearch && pip install -r requirements.txt` (if a requirements file exists) or follow `CvResearch/README.md`
3. Set `CV_RESEARCH_SCRIPT_PATH` in `.env.local` if the script is not at the default path

### Supabase storage buckets

The following buckets must exist in your Supabase project (create them as **private** under Storage):

| Bucket name | Used for |
|---|---|
| `documents` | Uploaded lesson plan PDFs |
| `videos` | Uploaded lesson videos |
| `FeedbackforLessonPlans` | Generated feedback PDFs (or set `FEEDBACK_STORAGE_BUCKET` in `.env.local` to override) |

---

## Step 1 — Get Supabase API Keys

1. In your Supabase dashboard go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Inside `apps/web`, create `.env.local`.
4. Paste your values in:

```
NEXT_PUBLIC_SUPABASE_URL=paste_your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste_your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=paste_your_service_role_key_here

OPENAI_API_KEY=paste_your_openai_key_here

# Optional overrides
# FEEDBACK_STORAGE_BUCKET=FeedbackforLessonPlans
# OPENAI_FEEDBACK_MODEL=gpt-4o-mini
# OPENAI_CHAT_MODEL=gpt-4o-mini
# CV_RESEARCH_SCRIPT_PATH=/absolute/path/to/CvResearch/main.py
# CV_FFMPEG_PATH=/usr/local/bin/ffmpeg
```

---

## Step 2 — Install dependencies and run the app

Open a terminal, navigate to the web folder, and run:

```
cd apps/web
npm install
npm run dev
```

Open your browser to http://localhost:3000. You will be redirected to the login page.

---

## Creating Test Users

1. Go to http://localhost:3000/signup. 
2. Enter an email and password, then pick a role (Instructor or Admin) from the dropdown.
3. Click **Sign Up** — you will receive an email from Supabase to confirm your address.

Repeat for as many test users as you need (Note: There is a rate limit for Supabase free tier).

---

## Changing a User's Role

If you want to change an existing user's role:

1. In your Supabase dashboard click **Table Editor** in the left sidebar.
2. Open the **profiles** table.
3. Find the row for the user you want to change (the `id` column matches their user ID).
4. Click the pencil icon on that row and change the `role` value to either `admin` or `instructor`.
5. Click **Save**.

---

## Pages in the app

| URL | Who sees it |
|---|---|
| /login | Everyone (not logged in) |
| /signup | Everyone (not logged in) |
| /dashboard | Logged-in users — immediately redirects based on role |
| /admin | Admin users only |
| /instructor | Instructor users only |

Trying to visit /admin, /instructor, or /dashboard without being logged in will redirect you to /login automatically.