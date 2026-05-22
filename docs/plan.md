Please inspect this codebase and help me create SWE deliverables in the following Notion-style format for each task/feature I give you.

For each deliverable, produce:

# ☀️ Overview

A brief, high-level PM-style description of the task. Keep this understandable to a non-engineer. Describe what the user/admin/instructor should be able to do when the task is complete.

# 🔨 Technical details

A concrete SSWE-style implementation plan based on the actual codebase. Include:
1. Relevant files/components/routes/API endpoints to modify or create.
2. Database/schema/storage/RLS changes if needed.
3. Frontend state/UI flow.
4. Backend logic and validation.
5. Edge cases and notes for the SWE.
6. Any assumptions or open questions.

Be specific with file paths and function/component names whenever possible. Do not be vague.

# 📚 References

List useful internal references from the codebase and external docs/tutorials. Include:
- Existing files in this repo that are similar.
- Relevant API/library docs.
- Any database diagrams, Supabase docs, Next.js docs, etc.

Tone/style:
- Use concise bullets.
- Write like a senior SWE handing off implementation guidance to another SWE.
- Do not over-explain basic concepts.
- Keep it copy-pasteable into Notion.
- If you are unsure about something, mark it as an assumption or open question instead of inventing details.

Before writing the deliverable:
1. Search the repo structure.
2. Identify the relevant existing patterns.
3. Then produce the deliverable in the exact format above.

Task 1: Add expression-capable face pipeline

Use MediaPipe Face Landmarker Tasks API with face blendshapes enabled to move beyond binary `has_face`.

Create the deliverable using the Overview / Technical details / References format.

Task 2: Formal `analyze_zoom_segment` API and JSON schema

Create a callable function/module:

`analyze_zoom_segment(video_path: str | Path, *, max_duration_s: float = 300.0, sample_hz: float = 1.0) -> dict`

It should return `meta`, `samples`, and later support `aggregates`. Refactor the current face/pose script logic into reusable functions and remove hardcoded video paths.

Create the deliverable using the Overview / Technical details / References format.

Task 3: Enforce and document the 5-minute analysis window

Explicitly cap analysis to at most 5 minutes of video, with `max_duration_s=300.0` and configurable `start_offset_s=0`.

Handle shorter files by processing the full available duration and reporting `meta.effective_duration_s`.

Create the deliverable using the Overview / Technical details / References format.

Task 4: Session-level aggregates for lecture analytics

Compute summary metrics from the sampled time series, including face visibility ratios, coarse expression distributions or top-k mean blendshape scores, and minimal pose/upper-body proxies.

Store these under `aggregates` in the same JSON output as the formal API.

Create the deliverable using the Overview / Technical details / References format.

Task 5: Reproducible package + smoke validation

Make `CvResearch` runnable on a fresh machine. Pin dependencies, update the README with a short runbook, and add a minimal smoke test that verifies the output contains `meta`, `samples`, and `aggregates`.

Create the deliverable using the Overview / Technical details / References format.

Important context:
The current implementation appears to use MediaPipe FaceDetector and pose logic in `CvResearch/main.py`. These tasks should build on the existing `ensure_model` pattern, but Task 1 requires FaceLandmarker because blendshapes are not available from FaceDetector.

Please inspect the actual codebase before writing each deliverable. Use exact file paths, existing function names, and current patterns where possible.