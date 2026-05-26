1. Transcription Module
The transcription module converts lesson audio into plain text for the AI Lesson Video Feedback Tool. The transcript becomes the first text-based input consumed by downstream processing, including chunking, embedding generation, retrieval, and feedback generation.
Item
Details
Primary file
backend/transcription.py
Main entry point
transcribe_audio(audio_path_or_url: str) -> str
Supported input types
Local audio file paths and remote HTTP/HTTPS audio URLs.
Output
Plain-text transcript string.
Intended use
Called programmatically by upload, video, or feedback pipeline code rather than manually by users in production.

 
Purpose and role in the pipeline
This module is the first stage of the AI feedback pipeline when the source material is audio or video. It creates the transcript that later steps use as the text representation of the lesson. Keeping this logic in a dedicated backend module makes it reusable from command-line tests, upload handlers, and future pipeline integrations.
Function behavior
·       For local file inputs, transcribe_audio verifies that the path exists, opens the file in binary mode, and sends it to the OpenAI Audio Transcriptions API.
·       For URL inputs, the function downloads the file to a secure temporary location first, because the transcription API expects a file upload rather than a remote URL.
·       After a URL-based transcription finishes, the temporary file is removed in cleanup logic so audio files do not accumulate on the server.
·       The function returns plain text only. It does not currently return timestamps, speaker labels, or structured segments.
Model choice
Model
Use in this project
Reasoning
gpt-4o-mini-transcribe
Current default
Accurate enough for plain-text transcription and lower cost for the current pipeline needs.
gpt-4o-transcribe-diarize
Considered for later
Supports speaker differentiation and timestamped speaker segments, but the current feedback pipeline does not yet require speaker-level analysis.

 
Implementation decision
The pipeline currently needs clean transcript text more than diarization or timestamps. Diarization can be added later if feedback requirements expand to speaker-level analysis or time-aligned comments.

 
URL support helpers
Helper
Responsibility
_is_url(s: str) -> bool
Detects whether the input string is an HTTP or HTTPS URL.
_download_url_to_temp_file(url: str) -> str
Downloads remote audio, validates that the response appears to be audio, preserves the extension when possible, writes to a temporary file, and returns the temporary path.

 
URL download flow
1.         Check whether the input is a URL.
2.         Send an HTTP request to download the remote audio file.
3.         Validate the response Content-Type to confirm it looks like audio.
4.         Create a secure temporary local file, preserving the original extension when possible.
5.         Write the downloaded content to the temporary file.
6.         Pass the temporary file path to the transcription call.
7.         Delete the temporary file after transcription completes or errors.
Development usage and testing
The module can be run directly during local development. In production it is expected to be called by another backend component.
python3 -m pip install -r backend/requirements.txt
 python3 backend/transcription.py backend/sample_audio.m4a
 python3 backend/transcription.py "https://example.com/audio.m4a"
Test case
Expected result
Local .m4a file
The module opens the local file and prints/returns a plain-text transcript.
Remote audio URL
The module detects the URL, downloads it, transcribes it, and removes the temporary file afterward.
Missing local file
The function should fail before making a transcription request.
Non-audio URL response
The Content-Type validation should prevent sending the wrong file type to transcription.

 
2. Admin View API
The Admin View API provides secure endpoints for retrieving instructor-related data. The endpoints are intended for authenticated admin users and support admin workflows such as viewing instructors, reviewing instructor-uploaded files, and accessing feedback records.
Endpoint
Purpose
Expected consumer
GET /api/admin/instructors
Returns instructor records available to the logged-in admin.
Admin instructor list or dashboard sidebar.
GET /api/admin/instructors/:instructorId/files
Returns files uploaded by a specific instructor after instructor validation.
Instructor detail view, file review UI.
GET /api/admin/instructors/:instructorId/feedback
Returns feedback associated with a specific instructor after instructor validation.
Instructor detail view, feedback review UI.

 
Authentication and authorization
·       Every Admin View endpoint requires a logged-in user.
·       Admin authorization is handled through a shared helper that verifies the user role before returning protected data.
·       Unauthenticated requests return 401 Unauthorized.
·       Authenticated users without admin permissions return 403 Forbidden.
·       The shared helper keeps authorization behavior consistent across current and future admin endpoints.
Endpoint details
GET /api/admin/instructors
Returns a list of instructors available to the logged-in admin. The response may include instructor ID and email depending on available schema fields.
[
   {
 	"id": "instructor_id",
 	"email": "instructor@example.com"
   }
 ]
GET /api/admin/instructors/:instructorId/files
Returns uploaded files for one instructor. The route validates that the provided instructorId belongs to an existing instructor before retrieving file records.
[
   {
 	"id": "file_id",
 	"name": "example.pdf",
 	"url": "https://example.com/file.pdf",
 	"created_at": "2026-05-20T00:00:00Z"
   }
 ]
GET /api/admin/instructors/:instructorId/feedback
Returns feedback records associated with a specific instructor. If the instructor does not exist, the endpoint returns 404 Not Found.
[
   {
 	"id": "feedback_id",
 	"feedback": "Feedback text",
 	"created_at": "2026-05-20T00:00:00Z"
   }
 ]
Status
Meaning
401 Unauthorized
The user is not logged in.
403 Forbidden
The user is logged in but does not have admin access.
404 Not Found
The requested instructor does not exist.
500 Internal Server Error
Unexpected server or database failure.

 
3. File Upload and Feedback Generation Pipeline
This implementation connects authenticated PDF uploads to the feedback-generation pipeline. It stores PDFs in Supabase Storage, records metadata in the files table, tracks processing state, and supports generating feedback from uploaded files.
Upload API
Item
Details
Endpoint
POST /api/files/upload
Purpose
Uploads a PDF for the currently authenticated user.
Request format
multipart/form-data
Expected field
file
Success response
201 Created with { "file_id": "uuid" }.
Storage bucket
documents
Storage path format
{user_id}/{file_id}.pdf

 
Upload authentication
The route creates a server-side Supabase client and checks the current user with getUser(). If no authenticated user is found, the route returns 401 and does not attempt to parse, validate, upload, or insert the file.
Validation rules
·       A file must be present in the multipart form data.
·       Only one file is accepted per request.
·       The file cannot be empty.
·       The file size must not exceed MAX_UPLOAD_BYTES. If MAX_UPLOAD_BYTES is unset, the route defaults to 5 MB.
·       The MIME type must be application/pdf.
·       The first bytes of the file must match the PDF magic bytes %PDF-.
Why the magic-byte check matters
The browser-provided MIME type is useful, but it is not enough on its own. A file may be labeled as a PDF even if its contents are incomplete, corrupted, or not actually in PDF format. Checking the file’s PDF signature gives the backend a second layer of validation before the file is stored or used in the feedback pipeline.

 
Upload error format
Upload errors use a consistent JSON response shape so the frontend can display readable messages without special-casing every failure.
{
   "error": {
 	"code": "ERROR_CODE",
 	"message": "Readable error message"
   }
 }
Status
Code
Meaning
400
MISSING_FILE
No file was provided.
400
MULTIPLE_FILES_NOT_ALLOWED
More than one file was provided.
400
EMPTY_FILE
The file is empty.
400
INVALID_PDF
The file does not start with %PDF-.
401
UNAUTHORIZED
The user is not signed in.
413
FILE_TOO_LARGE
The file exceeds MAX_UPLOAD_BYTES.
415
UNSUPPORTED_MEDIA_TYPE
The file is not a PDF.
500
UPLOAD_FAILED
The Supabase Storage upload failed.
500
DATABASE_ERROR
File metadata could not be saved after upload.

 
Database insert and cleanup behavior
After a successful Storage upload, the route inserts a row into the files table. If the Storage upload succeeds but the database insert fails, the uploaded object is removed from Storage so the system does not leave orphaned files behind.
files column
Purpose
file_id
UUID used to identify the uploaded file throughout the pipeline.
user_id
Owner of the uploaded file.
storage_path
Path to the PDF in Supabase Storage.
original_name
Original filename provided by the user.
content_type
MIME type captured from the upload.
status
Current processing state. New uploads start as uploaded.
status_detail
Optional detail about a processing failure or status note.
created_at / updated_at
Timestamps for creation and latest update.

 
Status lifecycle
Status
Meaning
Owned by
uploaded
File was uploaded and is ready for processing.
Upload route
processing
Feedback generation has started.
Feedback route
complete
Feedback generation finished successfully.
Feedback route
failed
Feedback generation failed; details may be stored in status_detail.
Feedback route

 
Expected success path: uploaded -> processing -> complete. Failure path: uploaded -> processing -> failed.
Frontend upload UI expectations
·       The user selects a PDF from the UI.
·       The frontend creates a FormData object and appends the file under the file field.
·       The frontend sends POST /api/files/upload.
·       On success, the file list reloads or inserts the new row into visible state.
·       On error, the UI parses the JSON error and shows the returned message.
const data = await res.json().catch(() => null)
 setError(data?.error?.message ?? 'Upload failed.')
Feedback generation API
Item
Details
Endpoint
POST /api/feedback/generate
Purpose
Generates feedback from a lesson plan PDF.
Supported input flows
Existing instructorId + lessonPlanId flow and uploaded-file flow using file_id.
Uploaded-file request
{ "file_id": "uuid" }
Success response
{ "success": true, "feedbackId": "uuid", "storagePath": "path/to/generated-feedback.pdf" }

 
Uploaded-file generation flow
1.         Validate that file_id is a valid UUID.
2.         Look up the file in the files table.
3.	Verify that the requester has access to the file.
4.	Confirm the file is currently in uploaded status.
5.	Update the file status to processing.
6.	Download the PDF from the documents bucket.
7.	Extract text from the PDF buffer.
8.	Generate feedback using the RAG/OpenAI feedback pipeline.
9.	Render the feedback into a PDF.
10.	Store the generated feedback PDF and create the feedback row.
11.	Update the file status to complete. If an error occurs, update status to failed and store the error detail.
Core feedback functions
Function
Role
extractTextFromPdf
Reads a PDF buffer and extracts lesson-plan text for the pipeline.
getFeedbackFromRag
Generates feedback from extracted lesson text and configured retrieval/OpenAI context.
renderFeedbackPdf
Renders generated feedback into a PDF buffer.
storeFeedbackPdf
Stores the generated PDF and creates the feedback table row, returning feedbackId and storagePath.

 
Generated feedback retrieval
Generated feedback PDFs are served through GET /feedback/[feedback_id]. The route validates the feedback ID, looks up the feedback row, reads the storage_path, downloads the PDF from feedback storage, and returns the PDF inline with content type application/pdf.
End-to-end PDF flow
1.	User uploads a PDF.
2.	POST /api/files/upload returns file_id.
3.	A files row is created with status uploaded.
4.	POST /api/feedback/generate is called with file_id.
5.	The files row changes to processing.
6.	Feedback is generated and rendered as a PDF.
7.	The feedback PDF is stored and the feedback row is created.
8.	The files row changes to complete.
9.	The feedback can be viewed through GET /feedback/[feedback_id].
Current UI note
The backend supports the uploaded-file file_id generation flow. Some UI paths may still use the older instructorId + lessonPlanId flow. Uploaded files remain in uploaded status until POST /api/feedback/generate is called with their file_id.

 
4. Video Upload UI
Video upload support was added to the instructor dashboard alongside the existing PDF upload flow. The work allows instructors to upload lesson videos, trigger video feedback generation, see long-running status updates, and receive user-friendly errors for invalid or over-limit videos.
Primary file
Responsibility
apps/web/components/InstructorDashboardClient.tsx
Client implementation for PDF and video upload UI, upload handlers, feedback generation, polling, status rendering, and error handling.
apps/web/app/dashboard/instructor/page.tsx
Server-rendered dashboard page for authentication, role gating, initial dashboard data loading, and mapping backend rows into InstructorUploadRow objects.

 
Frontend architecture
The implementation was built in the newer dashboard UI, InstructorDashboardClient, rather than the older chat-style InstructorWorkspace flow. It uses row-based state to represent uploaded PDFs, uploaded videos, feedback status, and error information.
PDF upload flow
The existing PDF upload path remains unchanged. The user selects a PDF, the frontend validates the MIME type, creates FormData, submits the file, inserts or reloads the dashboard row, and allows the user to trigger feedback generation.
Video upload flow
·       The dashboard includes a hidden video input, an Upload Video button, upload state indicators, and upload error messaging.
·       The hidden input accepts video/* and calls handleVideoUpload when a file is selected.
·       The handler creates FormData, appends the file under file, and sends POST /api/videos/upload.
·       The frontend checks that the selected file is a video but intentionally does not enforce duration locally.
·       Video duration enforcement is delegated to the backend upload route so the server remains the source of truth for admin-configured limits.
<input
   ref={videoInputRef}
   className="dashboard-file-input"
   type="file"
   accept="video/*"
   onChange={handleVideoUpload}
 />

 const formData = new FormData()
 formData.append('file', file)

 fetch('/api/videos/upload', {
   method: 'POST',
   body: formData,
 })
Upload error handling
Scenario
Frontend behavior
Non-video selected
Rejects the file and displays: Please choose a video file.
Backend duration limit error
Maps a raw duration error into an instructor-friendly message, such as: Video exceeds your admin's limit of 15 minutes.
Unexpected upload failure
Displays a fallback upload error without crashing the dashboard.

 
Dashboard row state model
export type InstructorUploadRow = {
   fileId: string
   fileName: string
   sourceStoragePath: string
   uploadedAt: string | null
   sourceType: 'pdf' | 'video'
   feedbackStatus:
 	| 'ready'
 	| 'not_started'
 	| 'uploaded'
 	| 'transcribing'
 	| 'generating'
 	| 'failed'
   feedbackId: number | null
   errorMessage?: string | null
 }
Field group
Purpose
fileId, fileName, sourceStoragePath, uploadedAt
Identify and display each upload row.
sourceType
Distinguishes PDF rows from video rows.
feedbackStatus
Supports PDF status, long-running video status, failed-state rendering, and ready-state feedback access.
feedbackId
Enables View feedback once the generated feedback exists.
errorMessage
Stores row-specific failure text for display.

 
Feedback generation requests
Source type
Request shape
PDF
{ "instructorId": "...", "lessonPlanId": "...", "originalFilename": "..." }
Video
{ "instructorId": "...", "lessonPlanId": "...", "source_type": "video", "videoFileId": "..." }

 
The video request shape lets the backend distinguish video jobs from PDF jobs and route video sources through transcription before feedback generation.
Status polling
·       The frontend polls GET /api/feedback/user/:userId while active video jobs exist.
·       Polling runs approximately every 2.5 seconds while a video row is uploaded, transcribing, or generating.
·       Polling stops when the row reaches ready or failed.
·       Generate buttons are disabled while the current row is generating or a video pipeline job is active.
·       The View feedback button is enabled only when feedbackStatus is ready.
Backend status
UI label
uploaded
Uploaded...
transcribing
Transcribing audio...
generating
Generating feedback...
complete
Feedback ready
failed
Processing failed

 
Backend dependencies and blockers
·       POST /api/videos/upload must accept video uploads, validate MIME type, validate duration limits, persist uploaded video records, and return file_id plus duration_seconds.
·       POST /api/feedback/generate must support source_type: video.
·       GET /api/feedback/user/:userId must return pipeline status updates for polling.
·       ffprobe runtime availability is required for reliable backend duration checks.
·       profiles.max_video_duration_seconds schema support is required for admin-configured duration limits.
5. Persistent Chat Session API
This feature adds backend support for persistent chat sessions in the instructor feedback workspace. It allows a logged-in instructor to start a new chat, view previous sessions, and resume a specific session later.
Table
Important columns
Purpose
chat_sessions
id, user_id, title, created_at, updated_at
Stores one row per chat conversation and supports chat history.
chat_messages
id, session_id, role, content, feedback_id, created_at
Stores individual messages belonging to a chat session.

 
Row Level Security
·       RLS is enabled for both chat_sessions and chat_messages.
·       Users can only read, insert, or update their own chat sessions.
·       Users can only read or insert messages if the parent session belongs to them.
·       Message ownership is enforced through an EXISTS query against chat_sessions.
·       Database-level ownership checks supplement route-handler checks.
Authentication pattern
The routes reuse getSessionUser from apps/web/lib/feedback/feedback-route-auth.ts. Each route creates a Supabase server client, calls getSessionUser(supabase), and returns the existing 401 Unauthorized response if the user is not logged in.
const supabase = await createClient()
 const session = await getSessionUser(supabase)

 if (!session.ok) {
   return session.response
 }
API routes
Endpoint
Behavior
Status codes
POST /api/chat/start
Creates a new empty chat session for the authenticated user. Sets user_id to the logged-in user and title to New chat.
201 created, 401 unauthenticated, 500 creation failed.
GET /api/chat/sessions
Returns sessions owned by the logged-in user, ordered by updated_at descending, with latest-message previews truncated to about 120 characters.
200 loaded, 401 unauthenticated, 500 load failure.
GET /api/chat/sessions/[sessionId]
Validates the UUID, loads a session only if it belongs to the logged-in user, and returns messages ordered by created_at ascending.
200 loaded, 400 invalid UUID, 401 unauthenticated, 404 missing/not owned, 500 load failure.

 
Response shapes
POST /api/chat/start
 {
   "sessionId": "<uuid>"
 }

 GET /api/chat/sessions
 {
   "sessions": [
 	{
   	"id": "<uuid>",
   	"title": "New chat",
   	"createdAt": "2026-05-20T07:42:05.93231+00:00",
   	"updatedAt": "2026-05-20T07:42:05.93231+00:00",
   	"lastMessagePreview": null
 	}
   ]
 }
GET /api/chat/sessions/[sessionId]
 {
   "session": {
 	"id": "<uuid>",
 	"title": "New chat",
 	"createdAt": "<timestamp>",
 	"updatedAt": "<timestamp>"
   },
   "messages": [
 	{
   	"id": "<uuid>",
   	"role": "user",
   	"content": "Example message",
   	"createdAt": "<timestamp>"
 	}
   ]
 }
Authorization details
The session detail route scopes directly by both session ID and user ID. Returning 404 for sessions that are missing or owned by another user avoids revealing whether another user's session ID exists.
.eq('id', sessionId)
 .eq('user_id', session.user.id)
Scope limitation
This deliverable does not add a message insertion endpoint. POST /api/chat/start creates only the parent session. Future chat-send or streaming logic can insert rows into chat_messages while still using these routes for listing and resuming sessions.
Manual tests
Test
Expected result
Create a session
POST /api/chat/start returns 201 and a sessionId.
List sessions
GET /api/chat/sessions returns the created session with lastMessagePreview null when it has no messages.
Invalid session ID
GET /api/chat/sessions/not-a-uuid returns 400 with Invalid sessionId.
Load a new session
GET /api/chat/sessions/<uuid> returns 200 with session metadata and messages: [].

 
6. CV Research Video Analysis API
CvResearch/main.py was refactored from a run-once script into an importable Python module. The public API analyzes a short Zoom or lesson-video segment, samples frames, runs face and pose detection, and returns structured JSON-compatible results.
Item
Details
Primary file
CvResearch/main.py
Public function
analyze_zoom_segment(...)
Primary output
Dictionary with meta, samples, and aggregates keys.
Primary improvement
Analysis no longer runs automatically on import. The module can be called from CLI, backend route, notebook, or another Python file.

 
Public function
def analyze_zoom_segment(
 	video_path: Union[str, Path],
 	*,
 	max_duration_s: float = 300.0,
 	sample_hz: float = 1.0,
 	start_offset_s: float = 0.0,
 ) -> dict:
Parameter
Default
Description
video_path
required
Path to the video file to analyze.
max_duration_s
300.0
Maximum number of seconds to analyze.
sample_hz
1.0
Number of frames sampled per second. 1.0 samples one frame per second; 2.0 samples twice per second.
start_offset_s
0.0
Offset in seconds where analysis should begin.

 
Return schema
Top-level key
Contents
meta
Video path, backend, FPS, effective duration, sample rate, sample count, wall-clock runtime, and setup error.
samples
One object per sampled frame, including sec, frame_ms, has_face, has_pose, and blendshapes.
aggregates
Reserved for later aggregate statistics across samples; currently returned as an empty dictionary in this documented version.

 
{
   "meta": {
 	"video_path": "CvResearch/example_video3.mov",
 	"backend": "tasks",
 	"fps": 25.32,
 	"effective_duration_s": 40.2,
 	"sample_hz": 1.0,
 	"sample_count": 40,
 	"total_wall_s": 8.28,
 	"setup_error": ""
   },
   "samples": [
 	{
   	"sec": 0.0,
   	"frame_ms": 26.03,
   	"has_face": true,
   	"has_pose": true,
   	"blendshapes": {}
 	}
   ],
   "aggregates": {}
 }
Internal helper functions
Helper
Responsibility
_load_video(path)
Opens a video file with OpenCV and returns the cv2.VideoCapture object plus FPS. Raises ValueError if the file cannot be opened.
_sample_frames(cap, start_s, end_s, sample_hz)
Generator that yields sampled frames as (sec, frame_bgr). Sampling interval is 1.0 / sample_hz.
_process_frame(frame_bgr, backend, face, pose)
Runs face and pose detection on one sampled frame and returns has_face, has_pose, blendshapes, and frame_ms.
ensure_model(model_path, model_url)
Ensures required model files exist locally and downloads missing models when possible.
create_detectors()
Creates MediaPipe Tasks detectors when available or falls back to OpenCV detectors. Returns backend, face, pose, and setup_error.

 
Side effects removed by the refactor
·       No hardcoded video filename is required for import usage.
·       No automatic processing starts when importing the module.
·       The analysis path does not intentionally write output PNG files.
·       The previous cv2.imwrite PNG dump loop was removed.
·       annotated_images accumulation was removed from the API path.
·       The public analysis logic returns data instead of relying on print-driven output.
Resource cleanup
analyze_zoom_segment uses try/finally cleanup. cap.release() is called when a video was opened. MediaPipe task detectors are closed when the tasks backend is used. This prevents video handles and detector resources from staying open after analysis completes or errors.
FaceLandmarker / blendshapes note
The current implementation uses MediaPipe FaceDetector, which detects whether a face is present but does not return facial blendshape scores. Because of this, each sample currently includes blendshapes: {}. The field remains in the schema so FaceLandmarker integration can populate it later without changing the response shape.
Usage and testing
python CvResearch/main.py CvResearch/example_video3.mov

 from CvResearch.main import analyze_zoom_segment

 result = analyze_zoom_segment(
     "CvResearch/example_video3.mov",
 	max_duration_s=30,
 	sample_hz=1.0,
 	start_offset_s=0.0,
 )
Test
Expected result
CLI test
Running python CvResearch/main.py <video> prints the JSON result to stdout.
Import test
Importing analyze_zoom_segment does not start analysis, open video files, create detectors, print logs, or write files.
Short analysis test
Calling analyze_zoom_segment with max_duration_s=5 returns meta, samples, and aggregates keys and a sample count matching the sampling config.

 
7. Cross-Cutting Implementation Notes
Several implementation patterns appear across the deliverables and should be preserved as the project continues.
Pattern
Where it appears
Why it matters
Server-side authentication before work begins
Upload routes, admin routes, chat routes, feedback routes
Prevents unauthenticated requests from reaching storage, database, or model calls.
Ownership checks
Files, chat sessions, admin instructor data
Ensures users can only access their own resources unless explicitly authorized as admins.
Status fields for long-running jobs
files table, video feedback rows
Lets the UI show progress and prevents duplicate generation.
Consistent error shapes
Upload and generation flows
Allows frontend code to surface readable errors without brittle parsing.
Temporary resource cleanup
Transcription URL downloads, Storage upload rollback, CV video handles
Avoids leaked temp files, orphaned storage objects, and open processing resources.
Backward-compatible additions
Feedback generation route, dashboard upload UI
Allows new flows to coexist with existing lesson-plan and PDF workflows.

 
8. Remaining Dependencies and Follow-Ups
The following items are documented as follow-ups or dependencies rather than completed scope.
·       Wire any remaining UI actions that should call POST /api/feedback/generate with file_id for uploaded PDFs.
·       Complete and verify backend video-upload dependencies, including route stability, ffprobe availability, video record persistence, and profiles.max_video_duration_seconds support.
·       Ensure GET /api/feedback/user/:userId returns the status fields expected by the dashboard polling loop.
·       Add chat-send or streaming logic that inserts rows into chat_messages so the persistent-session APIs can resume full conversations.
·       Integrate FaceLandmarker if facial blendshape scores are needed for richer CV analysis.
·       Consider diarization or timestamps in transcription only if future feedback requirements need speaker-level or time-aligned feedback.
