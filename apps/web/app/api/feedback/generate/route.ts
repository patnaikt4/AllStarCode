// POST /api/feedback/generate
//
// Orchestrates the full feedback generation pipeline for an All Star Code lesson plan:
//   1. Authenticate the caller (instructor or admin only)
//   2. Create a feedback row with status 'processing'
//   3. Download the lesson plan PDF from Supabase Storage
//   4. Extract plain text from the PDF
//   5. Generate structured feedback via the RAG pipeline (OpenAI + pgvector)
//   6. Render a formatted feedback PDF
//   7. Upload the PDF to Supabase Storage
//   8. Update the feedback row: status → 'ready', storage_path set
//
// On any pipeline failure the feedback row is updated to status 'failed' with a
// safe error_message before returning a consistent error JSON response.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLessonPlanFile } from '@/lib/storage/lesson-plans'
import { extractTextFromPdf, PdfCorruptError, PdfEmptyError } from '@/lib/pdf/extract'
import { getFeedbackFromRag } from '@/lib/rag/pipeline'
import { generateFeedbackPdf } from '@/lib/pdf/generate'
import { FEEDBACK_BUCKET } from '@/lib/storage/constants'

// ─── Response helpers ─────────────────────────────────────────────────────────

function errorResponse(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const sessionClient = await createClient()

  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser()

  if (authError || !user) {
    return errorResponse(401, 'UNAUTHORIZED', 'You must be logged in to generate feedback')
  }

  // Verify the caller is an instructor or admin
  const { data: profile, error: profileError } = await sessionClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return errorResponse(403, 'FORBIDDEN', 'User profile not found')
  }

  if (profile.role !== 'instructor' && profile.role !== 'admin') {
    return errorResponse(403, 'FORBIDDEN', 'Only instructors and admins may generate feedback')
  }

  // ── 2. Parse request body ──────────────────────────────────────────────────
  let lessonPlanId: string
  try {
    const body = await request.json()
    lessonPlanId = body?.lessonPlanId
    if (!lessonPlanId || typeof lessonPlanId !== 'string') {
      return errorResponse(400, 'INVALID_REQUEST', '`lessonPlanId` is required and must be a string')
    }
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Request body must be valid JSON')
  }

  const instructorId = user.id
  const adminClient  = createAdminClient()

  console.log(
    `[feedback/generate] starting generation — lessonPlanId=${lessonPlanId} instructorId=${instructorId}`
  )

  // ── 3. Create feedback row (status: processing) ────────────────────────────
  const { data: feedbackRow, error: insertError } = await adminClient
    .from('feedback')
    .insert({
      instructor_id:  instructorId,
      lesson_plan_id: lessonPlanId,
      status:         'processing',
    })
    .select('id')
    .single()

  if (insertError || !feedbackRow) {
    console.error('[feedback/generate] failed to create feedback row:', insertError?.message)
    return errorResponse(
      500,
      'DB_ERROR',
      'Failed to initialise feedback record — please try again'
    )
  }

  const feedbackId = feedbackRow.id
  console.log(`[feedback/generate] created feedback row id=${feedbackId}`)

  // Helper: update row to failed + return a consistent error response
  async function failWith(code: string, message: string, httpStatus: number): Promise<NextResponse> {
    const safeMessage = message.slice(0, 500) // never store arbitrary LLM/API errors verbatim
    console.error(`[feedback/generate] FAILED feedbackId=${feedbackId} code=${code}: ${safeMessage}`)

    await adminClient
      .from('feedback')
      .update({ status: 'failed', error_message: safeMessage })
      .eq('id', feedbackId)

    return errorResponse(httpStatus, code, message)
  }

  // ── 4. Download lesson plan PDF ────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await getLessonPlanFile(lessonPlanId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code ?? 'LESSON_PLAN_STORAGE_ERROR'
    const status = code === 'LESSON_PLAN_NOT_FOUND' ? 404 : 502
    return failWith(code, msg, status)
  }

  // ── 5. Extract text from PDF ───────────────────────────────────────────────
  let lessonText: string
  try {
    lessonText = await extractTextFromPdf(pdfBuffer)
  } catch (err) {
    if (err instanceof PdfCorruptError) {
      return failWith('PDF_CORRUPT', err.message, 422)
    }
    if (err instanceof PdfEmptyError) {
      return failWith('PDF_EMPTY', err.message, 422)
    }
    const msg = err instanceof Error ? err.message : String(err)
    return failWith('PDF_EXTRACTION_ERROR', `Failed to extract text from PDF: ${msg}`, 422)
  }

  console.log(
    `[feedback/generate] extracted ${lessonText.length} chars from PDF — feedbackId=${feedbackId}`
  )

  // ── 6. Generate feedback via RAG pipeline ──────────────────────────────────
  let feedbackText: string
  try {
    feedbackText = await getFeedbackFromRag(lessonText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return failWith('RAG_PIPELINE_ERROR', `Feedback generation failed: ${msg}`, 502)
  }

  console.log(`[feedback/generate] RAG pipeline complete — feedbackId=${feedbackId}`)

  // ── 7. Render feedback as PDF ──────────────────────────────────────────────
  let feedbackPdfBuffer: Buffer
  try {
    feedbackPdfBuffer = await generateFeedbackPdf(feedbackText, lessonPlanId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return failWith('PDF_GENERATION_ERROR', `Failed to render feedback PDF: ${msg}`, 500)
  }

  // ── 8. Upload feedback PDF to Supabase Storage ─────────────────────────────
  const storagePath = `${instructorId}/${feedbackId}.pdf`

  const { error: uploadError } = await adminClient.storage
    .from(FEEDBACK_BUCKET)
    .upload(storagePath, feedbackPdfBuffer, {
      contentType: 'application/pdf',
      upsert:      true,
    })

  if (uploadError) {
    return failWith(
      'STORAGE_ERROR',
      `Failed to upload feedback PDF: ${uploadError.message}`,
      502
    )
  }

  console.log(`[feedback/generate] uploaded PDF to ${FEEDBACK_BUCKET}/${storagePath}`)

  // ── 9. Update feedback row: status → ready ─────────────────────────────────
  const { error: updateError } = await adminClient
    .from('feedback')
    .update({ status: 'ready', storage_path: storagePath })
    .eq('id', feedbackId)

  if (updateError) {
    // The PDF was uploaded but the DB update failed.
    // Mark as failed so the user knows — they can retry and the upload will upsert.
    return failWith(
      'DB_ERROR',
      `Feedback PDF was generated but the record could not be saved: ${updateError.message}`,
      500
    )
  }

  console.log(`[feedback/generate] complete — feedbackId=${feedbackId}`)

  return NextResponse.json({ success: true, feedbackId })
}
