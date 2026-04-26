import { randomUUID } from 'node:crypto'

import { getFeedbackStorageBucket } from '@/lib/feedback/feedback-storage-bucket'
import { getFeedbackFromRag } from '@/lib/feedback/get-feedback-from-rag'
import { renderFeedbackPdf } from '@/lib/feedback/render-feedback-pdf'

import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'
import PDFDocument from 'pdfkit'
export const runtime = 'nodejs'

const LESSON_PLAN_BUCKET = 'documents'
const UPLOADED_FILES_BUCKET = 'documents'

type GenerateFeedbackRequest = {
  instructorId?: unknown
  lessonPlanId?: unknown
  originalFilename?: unknown
  file_id?: unknown
  sessionId?: unknown
  message?: unknown
}

type HttpError = Error & {
  status?: number
}

type ChatMessageRole = 'user' | 'assistant'

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

function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

function getOptionalTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function createChatTitle(params: {
  message: string
  originalFilename: string | null
}) {
  const { message, originalFilename } = params

  if (originalFilename) {
    return originalFilename.replace(/\.pdf$/i, '')
  }

  const normalized = message.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return null
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function createDefaultUserMessage(params: {
  originalFilename: string | null
  usesUploadedFile: boolean
}) {
  const { originalFilename, usesUploadedFile } = params

  if (originalFilename) {
    return `Please review ${originalFilename} and suggest improvements.`
  }

  if (usesUploadedFile) {
    return 'Please review this lesson plan and suggest improvements.'
  }

  return 'Generate curriculum-aligned feedback for the sample lesson plan.'
}

async function ensureChatSession(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  sessionId: string | null
  title: string | null
}) {
  const { supabase, userId, sessionId, title } = params
  const resolvedSessionId = sessionId ?? randomUUID()

  const { error: upsertError } = await supabase
    .from('chat_sessions')
    .upsert(
      {
        id: resolvedSessionId,
        user_id: userId,
        title,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: true,
      }
    )

  if (upsertError) {
    throw createHttpError(
      500,
      `Failed to save chat session: ${upsertError.message}`
    )
  }

  const { data: chatSession, error: selectError } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', resolvedSessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (selectError) {
    throw createHttpError(
      500,
      `Failed to load chat session: ${selectError.message}`
    )
  }

  if (!chatSession) {
    throw createHttpError(403, 'Chat session not found or access denied.')
  }

  return resolvedSessionId
}

async function insertChatMessage(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  sessionId: string
  role: ChatMessageRole
  content: string
  feedbackId?: string
}) {
  const { supabase, sessionId, role, content, feedbackId } = params

  const { error } = await supabase.from('chat_messages').insert({
    session_id: sessionId,
    role,
    content,
    ...(feedbackId ? { feedback_id: feedbackId } : {}),
  })

  if (error) {
    throw createHttpError(
      500,
      `Failed to save chat message: ${error.message}`
    )
  }
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

// Generates lesson-plan feedback and records the turn in chat history when sessionId is provided.
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
    const originalFilename = getOptionalTrimmedString(body.originalFilename)
    const requestedSessionId = getOptionalTrimmedString(body.sessionId)
    const requestMessage = getOptionalTrimmedString(body.message)

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

    if (requestedSessionId && !isValidUuid(requestedSessionId)) {
      return createErrorResponse(400, 'sessionId must be a valid UUID.')
    }

    const userMessage =
      requestMessage ??
      createDefaultUserMessage({
        originalFilename,
        usesUploadedFile: Boolean(fileId || lessonPlanId),
      })
    const chatTitle = createChatTitle({ message: userMessage, originalFilename })

    // Verify user has authority to generate feedback.
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

      const chatSessionId = await ensureChatSession({
        supabase,
        userId: user.id,
        sessionId: requestedSessionId,
        title: chatTitle,
      })

      await insertChatMessage({
        supabase,
        sessionId: chatSessionId,
        role: 'user',
        content: userMessage,
      })

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

        const assistantMessage = 'Your feedback PDF is ready. Open it for the full write-up.'

        await insertChatMessage({
          supabase,
          sessionId: chatSessionId,
          role: 'assistant',
          content: assistantMessage,
          feedbackId,
        })

        await supabase
          .from('files')
          .update({ status: 'complete', status_detail: null })
          .eq('file_id', fileId)

        return jsonResponse(
          {
            success: true,
            feedbackId,
            sessionId: chatSessionId,
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

    const chatSessionId = await ensureChatSession({
      supabase,
      userId: user.id,
      sessionId: requestedSessionId,
      title: chatTitle,
    })

    await insertChatMessage({
      supabase,
      sessionId: chatSessionId,
      role: 'user',
      content: userMessage,
    })

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

    const assistantMessage = 'Your feedback PDF is ready. Open it for the full write-up.'

    await insertChatMessage({
      supabase,
      sessionId: chatSessionId,
      role: 'assistant',
      content: assistantMessage,
      feedbackId,
    })

    return jsonResponse(
      {
        success: true,
        feedbackId,
        lessonPlanId,
        sessionId: chatSessionId,
        storagePath,
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
