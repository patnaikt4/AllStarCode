import { randomUUID } from 'node:crypto'

import PDFDocument from 'pdfkit'

import { getFeedbackStorageBucket } from '@/lib/feedback/feedback-storage-bucket'
import { getFeedbackFromRag } from '@/lib/feedback/get-feedback-from-rag'
import { renderFeedbackPdf } from '@/lib/feedback/render-feedback-pdf'
import type { FeedbackStatus, SourceType } from '@/lib/feedback/status'
import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const LESSON_PLAN_BUCKET = 'lesson-plans'

type GenerateFeedbackRequest = {
  instructorId?: unknown
  lessonPlanId?: unknown
  originalFilename?: unknown
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

function createErrorResponse(status: number, error: string) {
  return jsonResponse(
    {
      success: false,
      error,
    },
    status
  )
}

function isAdminRole(role: unknown): role is 'admin' {
  return role === 'admin'
}

async function createMockLessonPlanPdf(params: {
  instructorId: string
  lessonPlanId: string
}) {
  const { instructorId, lessonPlanId } = params

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 56,
      size: 'LETTER',
      info: {
        Title: `Mock lesson plan ${lessonPlanId}`,
        Author: 'AllStarCode',
      },
    })

    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    doc.on('end', () => {
      resolve(Buffer.concat(chunks))
    })

    doc.on('error', reject)

    doc.fontSize(18).text('AllStarCode Lesson Plan')
    doc.moveDown(0.5)
    doc
      .fontSize(10)
      .fillColor('#666666')
      .text(`Instructor ID: ${instructorId}`)
      .text(`Lesson Plan ID: ${lessonPlanId}`)

    doc.moveDown()
    doc.fillColor('#111111')
    doc.fontSize(12).text(
      [
        'Objective: Students will explain variables and write simple JavaScript assignments.',
        'Opening: Begin with a relatable warm-up that asks students how computers remember information.',
        'Mini-lesson: Model variable declarations, naming conventions, and string versus number examples.',
        'Guided practice: Students follow along and predict outputs before running code.',
        'Independent practice: Students create a small profile card program using at least three variables.',
        'Assessment: Exit ticket asking students to define a variable and explain when to use one.',
        'Differentiation: Provide sentence frames, pair programming, and extension prompts for advanced learners.',
      ].join('\n\n'),
      { lineGap: 4 }
    )

    doc.end()
  })
}

async function getLessonPlanPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  lessonPlanId: string
}) {
  const { supabase, instructorId, lessonPlanId } = params

  const candidatePaths = [
    `${instructorId}/${lessonPlanId}.pdf`,
    `${lessonPlanId}.pdf`,
    lessonPlanId,
  ]

  for (const storagePath of candidatePaths) {
    const { data, error } = await supabase.storage
      .from(LESSON_PLAN_BUCKET)
      .download(storagePath)

    if (error || !data) {
      continue
    }

    const arrayBuffer = await data.arrayBuffer()

    return {
      buffer: Buffer.from(arrayBuffer),
      usedPlaceholder: false,
    }
  }

  console.warn(
    `Falling back to placeholder lesson plan PDF for lessonPlanId=${lessonPlanId}.`
  )

  return {
    buffer: await createMockLessonPlanPdf({
      instructorId,
      lessonPlanId,
    }),
    usedPlaceholder: true,
  }
}

async function createFeedbackRow(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  feedbackId: string
  instructorId: string
  lessonPlanId: string
  originalFilename: string | null
  sourceType: SourceType
  initialStatus: FeedbackStatus
}) {
  const { supabase, feedbackId, instructorId, lessonPlanId, originalFilename, sourceType, initialStatus } = params

  const { error } = await supabase.from('feedback').insert({
    id: feedbackId,
    user_id: instructorId,
    lesson_plan_id: lessonPlanId,
    original_filename: originalFilename ?? 'feedback.pdf',
    source_type: sourceType,
    status: initialStatus,
  })

  if (error) {
    throw new Error(`Failed to create feedback record: ${error.message}`)
  }
}

async function updateFeedbackStatus(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  feedbackId: string
  status: FeedbackStatus
  storagePath?: string
  feedbackText?: string
}) {
  const { supabase, feedbackId, status, storagePath, feedbackText } = params

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (storagePath !== undefined) update.storage_path = storagePath
  if (feedbackText !== undefined) update.feedback_text = feedbackText

  const { error } = await supabase
    .from('feedback')
    .update(update)
    .eq('id', feedbackId)

  if (error) {
    throw new Error(`Failed to update feedback status: ${error.message}`)
  }
}

async function uploadFeedbackPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  instructorId: string
  lessonPlanId: string
  feedbackId: string
  pdfBuffer: Buffer
}) {
  const { supabase, instructorId, lessonPlanId, feedbackId, pdfBuffer } = params
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

  return storagePath
}

export async function POST(request: Request) {
  try {
    let body: GenerateFeedbackRequest

    try {
      body = (await request.json()) as GenerateFeedbackRequest
    } catch {
      return createErrorResponse(400, 'Request body must be valid JSON.')
    }

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

    const feedbackId = randomUUID()
    const sourceType: SourceType = 'pdf'

    // Phase 1: insert a row immediately so the UI can show progress.
    await createFeedbackRow({
      supabase,
      feedbackId,
      instructorId,
      lessonPlanId,
      originalFilename,
      sourceType,
      initialStatus: 'generating',
    })

    try {
      const lessonPlanPdf = await getLessonPlanPdf({
        supabase,
        instructorId,
        lessonPlanId,
      })

      const extractedText = await extractTextFromPdf(lessonPlanPdf.buffer)
      const feedback = await getFeedbackFromRag(extractedText)
      const feedbackPdf = await renderFeedbackPdf({
        title: 'AllStarCode Lesson Plan Feedback',
        instructorId,
        lessonPlanId,
        feedback,
      })

      // Phase 2: upload PDF and mark complete.
      const storagePath = await uploadFeedbackPdf({
        supabase,
        instructorId,
        lessonPlanId,
        feedbackId,
        pdfBuffer: feedbackPdf,
      })

      await updateFeedbackStatus({
        supabase,
        feedbackId,
        status: 'complete',
        storagePath,
        feedbackText: feedback,
      })

      return jsonResponse(
        {
          success: true,
          feedbackId,
          storagePath,
          usedPlaceholderLessonPlan: lessonPlanPdf.usedPlaceholder,
        },
        200
      )
    } catch (pipelineError) {
      // Mark the row as failed so the UI can reflect the error.
      await updateFeedbackStatus({
        supabase,
        feedbackId,
        status: 'failed',
      }).catch((updateErr) => {
        console.error('Failed to mark feedback as failed:', updateErr)
      })

      throw pipelineError
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate feedback.'

    console.error('Error in POST /api/feedback/generate:', error)

    return createErrorResponse(500, message)
  }
}
