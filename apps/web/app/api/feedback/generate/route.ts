import { randomUUID } from 'node:crypto'

import PDFDocument from 'pdfkit'

import { getFeedbackStorageBucket } from '@/lib/feedback/feedback-storage-bucket'
import { getFeedbackFromRag } from '@/lib/feedback/get-feedback-from-rag'
import { renderFeedbackPdf } from '@/lib/feedback/render-feedback-pdf'
import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const LESSON_PLAN_BUCKET = 'lesson-plans'
const UPLOADED_FILES_BUCKET = 'documents'

type GenerateFeedbackRequest = {
  instructorId?: unknown
  lessonPlanId?: unknown
  originalFilename?: unknown
  file_id?: unknown
}

type HttpError = Error & {
  status?: number
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

function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
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

async function getUploadedPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  fileId: string
}) {
  const { supabase, fileId } = params

  const { data: fileRow, error } = await supabase
    .from('files')
    .select('file_id, user_id, storage_path, original_name, status')
    .eq('file_id', fileId)
    .maybeSingle()

  if (error) {
    throw createHttpError(500, 'Failed to look up file.')
  }

  if (!fileRow) {
    throw createHttpError(404, 'File not found.')
  }

  const { data, error: downloadError } = await supabase.storage
    .from(UPLOADED_FILES_BUCKET)
    .download(fileRow.storage_path)

  if (downloadError || !data) {
    throw createHttpError(404, 'Uploaded file not found.')
  }

  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    fileRow,
  }
}

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

  return {
    feedbackId,
    storagePath,
  }
}

export async function POST(request: Request) {
  try {
    let body: GenerateFeedbackRequest

    try {
      body = (await request.json()) as GenerateFeedbackRequest
    } catch {
      return createErrorResponse(400, 'Request body must be valid JSON.')
    }

    const fileId =
      typeof body.file_id === 'string' && body.file_id.trim()
        ? body.file_id.trim()
        : ''

    const instructorId =
      typeof body.instructorId === 'string' ? body.instructorId.trim() : ''
    const lessonPlanId =
      typeof body.lessonPlanId === 'string' ? body.lessonPlanId.trim() : ''
    const originalFilename =
      typeof body.originalFilename === 'string' && body.originalFilename.trim()
        ? body.originalFilename.trim()
        : null

    if (!fileId && (!instructorId || !lessonPlanId)) {
      return createErrorResponse(
        400,
        'Request body must include file_id or instructorId and lessonPlanId.'
      )
    }

    if (fileId && !isValidUuid(fileId)) {
      return createErrorResponse(400, 'file_id must be a valid UUID.')
    }

    if (!fileId && !isValidUuid(instructorId)) {
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

    if (fileId) {
      const uploaded = await getUploadedPdf({ supabase, fileId })

      const isOwnFile = uploaded.fileRow.user_id === user.id

      if (!isAdmin && !isOwnFile) {
        return createErrorResponse(403, 'You are not allowed to generate feedback for this file.')
      }

      if (uploaded.fileRow.status !== 'uploaded') {
        return createErrorResponse(409, 'File is not ready for processing.')
      }

      const { error: processingError } = await supabase
        .from('files')
        .update({ status: 'processing', status_detail: null })
        .eq('file_id', fileId)

      if (processingError) {
        return createErrorResponse(500, 'Failed to mark file as processing.')
      }

      try {
        const extractedText = await extractTextFromPdf(uploaded.buffer)
        const feedback = await getFeedbackFromRag(extractedText)
        const feedbackPdf = await renderFeedbackPdf({
          title: 'AllStarCode Lesson Plan Feedback',
          instructorId: uploaded.fileRow.user_id,
          lessonPlanId: fileId,
          feedback,
        })

        const { feedbackId, storagePath } = await storeFeedbackPdf({
          supabase,
          instructorId: uploaded.fileRow.user_id,
          lessonPlanId: fileId,
          feedback,
          pdfBuffer: feedbackPdf,
          originalFilename: uploaded.fileRow.original_name,
        })

        await supabase
          .from('files')
          .update({ status: 'complete', status_detail: null })
          .eq('file_id', fileId)

        return jsonResponse(
          {
            success: true,
            feedbackId,
            storagePath,
          },
          200
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to generate feedback.'

        await supabase
          .from('files')
          .update({ status: 'failed', status_detail: message })
          .eq('file_id', fileId)

        throw error
      }
    }

    const isOwnInstructorRecord = user.id === instructorId

    if (!isAdmin && !isOwnInstructorRecord) {
      return createErrorResponse(403, 'You are not allowed to generate feedback for this instructor.')
    }

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
        storagePath,
        usedPlaceholderLessonPlan: lessonPlanPdf.usedPlaceholder,
      },
      200
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate feedback.'

    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as HttpError).status === 'number'
        ? (error as HttpError).status!
        : 500

    console.error('Error in POST /api/feedback/generate:', error)

    return createErrorResponse(status, message)
  }
}