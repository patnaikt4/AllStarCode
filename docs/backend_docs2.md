File Upload Feature 

What Was Built
A PDF upload endpoint for AllStarCode. When a logged-in user sends a PDF to the route, it gets stored in Supabase Storage and a record is saved in the database. That's it, no frontend yet. Just the backend route as requested.
How It Works
The route lives at POST /api/files/upload. Here's what happens when it gets hit:
Check if the user is logged in. If not, return 401 Unauthorized.
Read the uploaded file from the request form data.
Validate it. It must be a PDF, must not be empty, and the first four bytes must match the PDF magic bytes (%PDF).
Generate a unique file ID and upload the file to Supabase Storage under documents/{user_id}/{file_id}.pdf.
Insert a row into the files table with the file ID, user ID, storage path, original name, and content type.
If anything goes wrong after the upload (like the database insert fails), the file gets deleted from storage so nothing is left orphaned.
On success, return 201 Created with { "file_id": "..." }.
Database
A files table was created with the following columns: file_id, user_id, storage_path, original_name, content_type, and created_at. Row Level Security is enabled so users can only insert and read their own rows. The same idea applies to Supabase Storage — users can only upload to and read from their own folder.
How to Test
Since the route requires an active session, the easiest way to test is from the browser while already logged into the app. Open the browser console at localhost:3000 and paste the following:
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
This opens a file picker. Select any PDF and the console will print the response. A successful upload returns 201 and a file_id. If the user is not logged in it returns 401, and if the file is not a valid PDF it returns 400.
Verification
After a successful upload, two places should reflect it: the documents bucket in Supabase Storage should contain a folder named after the user ID with the PDF inside, and the files table in the Table Editor should have a new row matching the upload.
Admin Dashboard + File Upload 
By Jesus Barrios

What Was Built
Two features were delivered across two branches: a PDF upload endpoint and an admin dashboard UI built on top of it.
File Upload (feature/file-upload)
A POST /api/files/upload endpoint that lets any logged-in user upload a PDF. The file is validated (non-empty, correct content type, PDF magic bytes), stored in a Supabase Storage bucket called documents under a path of {user_id}/{file_id}.pdf, and recorded in a files table. If the database insert fails after a successful upload, the file is cleaned up from storage automatically. Returns 201 with a file_id on success, or 400/401/500 as appropriate.
A files table was created with columns file_id, user_id, storage_path, original_name, content_type, and created_at. Row Level Security is on — users can only insert and read their own rows.
Admin Dashboard (admin-dashboard)
The admin dashboard is a full redesign of /admin using the same sidebar shell as the instructor page. It has two parts.
The first is the instructor list. The sidebar shows all instructors assigned to the logged-in admin (linked via an assigned_admin_id column added to the profiles table). Each item shows a small avatar circle with the instructor's first initial. Clicking the AllStarCode logo navigates back to the admin home from any instructor detail view.
The second is the instructor detail page at /admin/instructors/[instructorId]. It shows an instructor card at the top (avatar, email, truncated ID), then two sections — files and feedback — each with a count. File names are underlined on hover and open the PDF in a new tab via a short-lived Supabase signed URL. Feedback entries show a view button that links to /feedback/{id}, which is the route built by SWE 4.
The admin also has a self-service section (My Files) where they can upload their own PDFs and see their own file list, using the same upload flow as instructors. File names here are plain text with no underline, since the file is opened via a click handler rather than a link.
Three API routes back the dashboard: GET /api/admin/instructors, GET /api/admin/instructors/[instructorId]/files, and GET /api/admin/instructors/[instructorId]/feedback. All require the user to be an authenticated admin and verify that the requested instructor is actually assigned to them.
How to Test
Migrations 0004 and 0005 have already been applied. To test the instructor list, go to Table Editor, open the profiles table, find an instructor row, and set assigned_admin_id to your admin user's ID. Log in as admin and the instructor will appear in the sidebar.
To test file upload from the browser console while logged in:
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
A successful upload returns 201 with a file_id. Unauthenticated requests return 401, invalid files return 400.

What Is Not Yet Implemented
Instructor Assignment UI
Assigning an instructor to an admin is currently done manually in the Supabase Table Editor. There is no UI or API route for an admin to claim or be assigned instructors. This needs to be built, likely as a settings or management page under /admin/settings or a separate admin-only route.
Feedback Generation
The feedback table and generation logic are owned by another member (SWE 3/4). The feedback sections in the dashboard are created and ready. They query /feedback/{id} and the GET .../feedback API route, but they will show empty until these members deliver the table and populate it. No changes needed on this side once feedback rows exist.
PDF Viewer Component
The view buttons on feedback entries open /feedback/{id} in a new tab, which streams the PDF as a raw response. SWE 4 is building a proper viewer component. Once delivered, the href on those buttons can be swapped out or the viewer can be embedded inline. The data is already working.
Instructor File Downloads on Detail Page
File names on the instructor detail page open via a server-generated signed URL (1 hour expiry). If the storage RLS policy for admin reads is not active, the signed URL comes back null and the file name renders as non-clickable text. Confirm that the admins read instructor storage files policy is present under Storage → Policies in the Supabase dashboard.
Instructor Self-Service (Upload + Feedback)
The instructor page (/instructor) currently shows a static UI with hardcoded messages and non-functional upload buttons. The upload button needs to be wired to POST /api/files/upload and the thread needs to reflect real uploaded files and generated feedback. This is a follow-up task.
Instructor Chat Interface
By Jesus Barrios

What Was Built
A full chat interface for AllStarCode instructors, accessible at /dashboard/instructor/chat. The page has a sidebar listing all past chat sessions and a main window showing the full message history for the selected session. Instructors can start new conversations, type messages, and receive responses from the AI assistant. A typing indicator appears while the response is being generated. A link to the chat page was added to the existing instructor dashboard sidebar.
How It Works
The chat page is a server component that checks authentication the same way the existing instructor dashboard does. It renders a client component called InstructorChatWorkspace which manages all UI state. The full flow is:
On mount, the component fetches GET /api/chat/sessions to populate the session sidebar, sorted by most recent activity.
Clicking a session fetches GET /api/chat/sessions/{sessionId} to load its full message history. A 404 response clears the selection and refreshes the list.
Clicking + New Chat generates a UUID on the client and sets it as the active draft session. No database row is created yet.
When the instructor sends a message, the user bubble is added to the thread immediately, a three-dot typing indicator appears, and POST /api/chat/message is called with the session ID and message text.
The API upserts the session row on first message (so no separate session creation endpoint is needed), persists the user turn, calls the AI, persists the assistant turn, and returns the assistant message.
On success the assistant bubble is appended and the session list is refreshed. On failure the optimistic user bubble is removed and an error banner is shown above the composer.
The send button and input are disabled while generating to prevent duplicate submissions.
API Routes Added
Two new read routes were added alongside the existing POST /api/chat/message:
GET /api/chat/sessions — returns up to 50 sessions for the authenticated user, ordered by updated_at descending.
GET /api/chat/sessions/{sessionId} — returns all messages for a single session in chronological order. Returns 404 if the session does not exist or belongs to a different user.
Both routes validate the session with supabase.auth.getUser() and return 401 if the user is not authenticated.
How to Test
Start the dev server and log in as an instructor. From the instructor dashboard at /dashboard/instructor, click the AI Chat Assistant link in the left sidebar. This opens the chat page. Click + New Chat, type a message, and press Enter or click Send. The typing indicator should appear, then the AI response should populate in the thread. The session will then appear in the sidebar. Clicking it again later will reload the full history from the database.
Verification
After sending a message, two tables in Supabase should reflect it: the chat_sessions table should contain a new row with the generated session ID and a title derived from the first message, and the chat_messages table should contain one row with role = 'user' and one with role = 'assistant', both linked to that session ID. Refreshing the page and selecting the session from the sidebar should restore the full conversation from the database.
Session-Level Aggregates for Lecture Analytics
By Jesus Barrios

What Was Built
A _compute_aggregates function in CvResearch/main.py that takes the list of per-second samples produced during video analysis and returns a summary dictionary. The flat script was also refactored into a callable analyze_zoom_segment(video_path) function that runs the full detection loop and stores the aggregates under result["aggregates"] before returning.
How It Works
_compute_aggregates receives the samples list built during the frame loop and computes the following:
Count total samples, face-visible samples, and pose-visible samples by filtering on has_face and has_pose.
Compute face_visibility_ratio and pose_visibility_ratio as the fraction of total samples where each was detected.
Sum each blendshape key across only the face-visible samples using s.get("blendshapes", {}). Divide each sum by the face sample count to get per-key means. If no face was detected the blendshape dicts are empty and callers should check face_visibility_ratio == 0 before interpreting them.
Sort the blendshape means descending and take the top top_k entries (default 5) as top_blendshapes.
Return the full result dict including sample_count and face_sample_count as raw counts.
analyze_zoom_segment wraps the existing frame loop, calls _compute_aggregates(samples) once after the loop, and returns a single dict with samples, aggregates, annotated_images, backend, setup_error, fps, and total_time_s.
Output Shape
The aggregates dict returned by _compute_aggregates has the following structure:
{
  "face_visibility_ratio": 0.93,
  "pose_visibility_ratio": 0.88,
  "blendshape_means": { "mouthSmile_L": 0.14, ... },
  "top_blendshapes": [
    {"name": "mouthSmile_L", "mean": 0.14},
    {"name": "mouthSmile_R", "mean": 0.13}
  ],
  "sample_count": 300,
  "face_sample_count": 279
}
If the OpenCV fallback is active, blendshapes is absent from every sample and blendshape_means and top_blendshapes will both be empty. The visibility ratios still compute correctly in that case.
How to Test
Place a video file at CvResearch/example_video3.mov and run the script directly:
cd CvResearch
python main.py
The script calls analyze_zoom_segment and prints face_visibility_ratio, pose_visibility_ratio, and top_blendshapes to stdout alongside the existing backend and timing lines. To inspect the full aggregate dict from another script, import and call the function directly:
from main import analyze_zoom_segment
result = analyze_zoom_segment("example_video3.mov")
print(result["aggregates"])
Verification
After running, the printed output should show face_visibility_ratio and pose_visibility_ratio as decimals between 0 and 1, and top_blendshapes as a list of up to five name/mean pairs. If the tasks backend loaded successfully, blendshape means will be non-empty. If the OpenCV fallback was used, blendshape fields will be empty lists and dicts but the visibility ratios will still be present and correct.
To verify the math manually, count the number of samples in the printed output where has_face would be true and divide by sample_count. That ratio should match face_visibility_ratio exactly. Similarly, face_sample_count should equal sample_count multiplied by face_visibility_ratio with no rounding error since both values are derived from the same integer count.
A quick sanity check for the blendshape means is to confirm that every value in blendshape_means falls between 0 and 1, since ARKit blendshape scores are normalized to that range. Any value outside that range would indicate a corrupted sample or a model returning unexpected output. The top_blendshapes list should be sorted strictly descending by mean and contain at most five entries, or fewer if the face was only detected in a small number of frames with limited blendshape diversity.
Limitations and Open Questions
Pose metrics are currently limited to a presence ratio. Finer upper-body signals such as shoulder angle, head tilt, and gesture frequency require processing the raw landmark coordinates and are out of scope for this task. The has_pose flag only indicates whether a person was detected in the frame, not how actively they were moving or whether their posture was engaged.
Blendshape data depends entirely on the FaceLandmarker model from Task 1. The current FaceDetector used in this script returns bounding boxes only, so blendshape_means and top_blendshapes will be empty until FaceLandmarker is wired in. The aggregate function handles this gracefully and no changes to _compute_aggregates will be needed when that swap is made.
Per-second blendshape time series are retained in samples alongside the aggregates. This allows callers to reconstruct the full timeline if needed, for example to detect a spike in a particular expression mid-session. Callers that only need the summary can discard samples after reading aggregates to reduce memory and payload size.
Next Steps
The aggregates produced here are the direct input to the feedback LLM. The next task will pass face_visibility_ratio, pose_visibility_ratio, and top_blendshapes as structured context into the prompt so the model can comment on instructor presence, energy, and delivery in concrete terms rather than generic coaching advice.
Beyond that, adding a per-minute breakdown alongside the session-level summary would allow the LLM to identify specific moments where presence dropped or expression shifted, making feedback more actionable. The top_k parameter on _compute_aggregates can also be raised by callers that want a wider expression profile fed into the model.

Transcription and Feedback Pipeline Integration
By Jesus Barrios

What Was Built
Extended the POST /api/feedback/generate route to accept a source_type of video. When a video source is specified, the route downloads the instructor's video from Supabase Storage, transcribes it using the OpenAI audio transcription API, and feeds the resulting transcript into the existing RAG feedback pipeline. The output is the same feedback PDF that the PDF path already produces, just sourced from spoken content instead of a written document.
How It Works
The caller adds source_type: "video" and videoFileId to the existing request body. Here is what the route does:
Validate that instructorId and videoFileId are both present and valid UUIDs.
Authenticate the user. Same rule as before: admin or the instructor acting on their own record.
List the videos bucket at {instructorId}/ and search for a file whose name starts with videoFileId to resolve the extension (.mp4, .mov, or .webm).
Download the video into a buffer and hand it to transcribeVideoBuffer.
transcribeVideoBuffer writes the buffer to a temp file under os.tmpdir(), calls client.audio.transcriptions.create with model gpt-4o-mini-transcribe, and deletes the temp file in a finally block regardless of outcome.
Pass the transcript string to getFeedbackFromRag with source: "video_transcript".
Render and store the feedback PDF. The videoFileId is used as the lesson_plan_id grouping key in the feedback row.
Return { success, feedbackId, storagePath } exactly like the PDF path does.
Files Changed
New: apps/web/lib/feedback/transcribe-video.ts contains transcribeVideoBuffer, the TypeScript in-process transcription helper that mirrors the behavior of backend/transcription.py.
Modified: apps/web/lib/feedback/get-feedback-from-rag.ts now exports a FeedbackSource type and accepts an optional { source } second argument. A separate VIDEO_FEEDBACK_SYSTEM_PROMPT is used when the source is video_transcript, targeting spoken delivery and session-level alignment rather than written lesson plan structure. All existing call sites are unaffected since the argument defaults to written_lesson_plan.
Modified: apps/web/app/api/feedback/generate/route.ts adds source_type and videoFileId to the request type, branches validation so video mode does not require lessonPlanId, and inserts the video handling block between the auth check and the existing file_id block.
How to Test
Upload a video first via POST /api/videos/upload to get a file_id, then call the feedback route from the browser console while logged in:
const res = await fetch('/api/feedback/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source_type: 'video',
    instructorId: '<your-user-uuid>',
    videoFileId: '<file_id-from-upload>',
  }),
})
console.log(res.status, await res.json())
A successful response returns 200 with a feedbackId and storagePath. Missing or invalid UUIDs return 400. Accessing another user's video returns 403. A video not found in storage returns 404.
Backward Compatibility
All existing request shapes continue to work without change. Omitting source_type or setting it to anything other than video routes through the original PDF logic. The getFeedbackFromRag signature change is additive and does not affect any existing callers.
