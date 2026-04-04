import { randomUUID } from 'node:crypto'

import { getFeedbackFromRag } from '@/lib/feedback/get-feedback-from-rag'
import { renderFeedbackPdf } from '@/lib/feedback/render-feedback-pdf'

import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'

// Supabase lesson plans live here.
const LESSON_PLAN_BUCKET = 'documents'

// Generated feedback PDFs are written here.
const FEEDBACK_BUCKET = 'FeedbackforLessonPlans'

type GenerateFeedbackRequest = {
  instructorId?: unknown
  fileId?: unknown
}

// Guard helper for validating the instructorId coming from the client.
function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

// Standard JSON response helper so success/error payloads stay consistent.
function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

// Convenience helper for returning typed error JSON to the client.
function createErrorResponse(status: number, error: string) {
  return jsonResponse(
    {
      success: false,
      error,
    },
    status
  )
}
// Narrows profile.role so authorization checks stay type-safe.
function isAdminRole(role: unknown): role is 'admin' {
  return role === 'admin'
}

// Loads a given lesson-plan PDF for the requested fileId.
// The file must exist in the files table and belong to the target instructor.
async function getLessonPlanPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  fileId: string
}) {
  const { supabase, instructorId, fileId } = params

  const { data: fileRow, error: fileError } = await supabase
    .from('files')
    .select('file_id, user_id, storage_path, original_name')
    .eq('file_id', fileId)
    .single()

  if (fileError || !fileRow) {
    throw new Error('The selected uploaded file could not be found.')
  }

  if (fileRow.user_id !== instructorId) {
    throw new Error('You are not allowed to generate feedback for this file.')
  }

  const { data, error } = await supabase.storage
    .from(LESSON_PLAN_BUCKET)
    .download(fileRow.storage_path)

  if (error || !data) {
    throw new Error(
      `Uploaded lesson plan "${fileRow.original_name}" could not be found in storage.`
    )
  }

  const arrayBuffer = await data.arrayBuffer()

  return {
    buffer: Buffer.from(arrayBuffer),
    file: fileRow,
  }
}

// Uploads generated feedback PDF to supabse storage and adds to client row
async function storeFeedbackPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  fileId: string
  feedback: string
  pdfBuffer: Buffer
}) {
  const { supabase, instructorId, fileId, feedback, pdfBuffer } = params
  const fileToken = randomUUID()
  const storagePath = `${instructorId}/${fileId}/${fileToken}.pdf`

  const { error: uploadError } = await supabase.storage
    .from(FEEDBACK_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Failed to upload feedback PDF: ${uploadError.message}`)
  }

  const { error: insertError } = await supabase.from('feedback').insert({
    instructor_id: instructorId,
    storage_path: storagePath,
    feedback,
  })

  if (insertError) {
    throw new Error(`Failed to save feedback record: ${insertError.message}`)
  }

  const { data: feedbackRow, error: selectError } = await supabase
    .from('feedback')
    .select('feedback_id')
    .eq('instructor_id', instructorId)
    .eq('storage_path', storagePath)
    .single()

  if (selectError || !feedbackRow) {
    throw new Error('Feedback was generated but the saved record could not be loaded.')
  }

  return {
    feedbackId: feedbackRow.feedback_id,
    storagePath,
  }
}

// Accepts instructorId and fileId, adds feedback to storage, returns response
export async function POST(request: Request) {
  try {
    let body: GenerateFeedbackRequest

    try {
      body = (await request.json()) as GenerateFeedbackRequest
    } catch {
      return createErrorResponse(400, 'Request body must be valid JSON.')
    }

    // Input jading
    const instructorId =
      typeof body.instructorId === 'string' ? body.instructorId.trim() : ''
    const fileId = typeof body.fileId === 'string' ? body.fileId.trim() : ''

    if (!instructorId || !fileId) {
      return createErrorResponse(
        400,
        'Request body must include instructorId and fileId.'
      )
    }

    if (!isValidUuid(instructorId)) {
      return createErrorResponse(400, 'instructorId must be a valid UUID.')
    }

    // Verify user has probably authority to generate feedback
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse(401, 'Unauthorized.')
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return createErrorResponse(403, 'User profile not found or access denied.')
    }

    const isAdmin = isAdminRole(profile.role)
    const isOwnInstructorRecord = user.id === instructorId

    if (!isAdmin && !isOwnInstructorRecord) {
      return createErrorResponse(403, 'You are not allowed to generate feedback for this instructor.')
    }

    // Load the pdf of the given lesson plan
    const lessonPlanPdf = await getLessonPlanPdf({
      supabase,
      instructorId,
      fileId,
    })

    // Extract text from it
    const extractedText = await extractTextFromPdf(lessonPlanPdf.buffer)

    // Run text through the rag
    const feedback = await getFeedbackFromRag(extractedText)

    // Turn resulting text back into a pdf
    const feedbackPdf = await renderFeedbackPdf({
      title: 'AllStarCode Lesson Plan Feedback',
      instructorId,
      lessonPlanId: lessonPlanPdf.file.original_name,
      feedback,
    })

    // Store feedback in storage
    const { feedbackId, storagePath } = await storeFeedbackPdf({
      supabase,
      instructorId,
      fileId,
      feedback,
      pdfBuffer: feedbackPdf,
    })

    // Return jsonResponse object
    return jsonResponse(
      {
        success: true,
        feedbackId,
        fileId,
        storagePath,
      },
      200
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate feedback.'

    console.error('Error in POST /api/feedback/generate:', error)

    return createErrorResponse(500, message)
  }
}
