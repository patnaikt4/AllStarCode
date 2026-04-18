import { randomUUID } from 'node:crypto'

import { getFeedbackStorageBucket } from '@/lib/feedback/feedback-storage-bucket'
import { getFeedbackFromRag } from '@/lib/feedback/get-feedback-from-rag'
import { renderFeedbackPdf } from '@/lib/feedback/render-feedback-pdf'

import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'

// Supabase lesson plans live here.
const LESSON_PLAN_BUCKET = 'documents'

type GenerateFeedbackRequest = {
  instructorId?: unknown
  lessonPlanId?: unknown
  originalFilename?: unknown
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

// Loads a given lesson-plan PDF for the requested lessonPlanId.
// The file must exist in the files table and belong to the target instructor.
async function getLessonPlanPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  lessonPlanId: string
}) {
  const { supabase, instructorId, lessonPlanId } = params

  const { data: fileRow, error: fileError } = await supabase
    .from('files')
    .select('file_id, user_id, storage_path, original_name')
    .eq('file_id', lessonPlanId)
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

// Uploads generated feedback PDF to supabase storage and adds to client row
async function storeFeedbackPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  lessonPlanId: string
  feedback: string
  pdfBuffer: Buffer
  originalFilename: string | null
}) {
  const { supabase, instructorId, lessonPlanId, feedback, pdfBuffer, originalFilename } = params
  const feedbackId = randomUUID()
  const storagePath = `${instructorId}/${lessonPlanId}/${feedbackId}.pdf`

  const { error: uploadError } = await supabase.storage
    .from(getFeedbackStorageBucket())
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    const hint = /bucket not found/i.test(uploadError.message)
      ? ` In Supabase, create a private Storage bucket with id "${getFeedbackStorageBucket()}" (or set FEEDBACK_STORAGE_BUCKET to your bucket name).`
      : ''
    throw new Error(
      `Failed to upload feedback PDF: ${uploadError.message}.${hint}`
    )
  }

  const { error: insertError } = await supabase.from('feedback').insert({
    id: feedbackId,
    user_id: instructorId,
    lesson_plan_id: lessonPlanId,
    storage_path: storagePath,
    feedback_text: feedback,
    original_filename: originalFilename,
    status: 'ready',
  })

  if (insertError) {
    throw new Error(`Failed to save feedback record: ${insertError.message}`)
  }

  const { data: feedbackRow, error: selectError } = await supabase
    .from('feedback')
    .select('id')
    .eq('user_id', instructorId)
    .eq('storage_path', storagePath)
    .single()

  if (selectError || !feedbackRow) {
    throw new Error('Feedback was generated but the saved record could not be loaded.')
  }

  return {
    feedbackId: feedbackRow.id,
    storagePath,
  }
}

// Accepts instructorId and lessonPlanId, adds feedback to storage, returns response
export async function POST(request: Request) {
  try {
    let body: GenerateFeedbackRequest

    try {
      body = (await request.json()) as GenerateFeedbackRequest
    } catch {
      return createErrorResponse(400, 'Request body must be valid JSON.')
    }

    // Input parsing
    const instructorId =
      typeof body.instructorId === 'string' ? body.instructorId.trim() : ''
    const lessonPlanId =
      typeof body.lessonPlanId === 'string' ? body.lessonPlanId.trim() : ''
    const originalFilename =
      typeof body.originalFilename === 'string' && body.originalFilename.trim()
        ? body.originalFilename.trim()
        : null

    if (!instructorId || !lessonPlanId) {
      return createErrorResponse(
        400,
        'Request body must include instructorId and lessonPlanId.'
      )
    }

    if (!isValidUuid(instructorId)) {
      return createErrorResponse(400, 'instructorId must be a valid UUID.')
    }

    // Verify user has authority to generate feedback
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
      lessonPlanId,
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
      lessonPlanId,
      feedback,
      pdfBuffer: feedbackPdf,
      originalFilename,
    })

    return jsonResponse(
      {
        success: true,
        feedbackId,
        lessonPlanId,
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
