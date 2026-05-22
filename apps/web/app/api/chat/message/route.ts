import { getChatResponseFromRag, type ChatHistoryTurn } from '@/lib/chat/get-chat-response-from-rag'
import { extractTextFromPdf } from '@/lib/lesson-plan/extract-pdf-text'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_MODEL_HISTORY_MESSAGES = 10
const UPLOADED_FILES_BUCKET = 'documents'

type ChatMessageRequest = {
  sessionId?: unknown
  message?: unknown
  fileId?: unknown
}

type HttpError = Error & {
  status?: number
}

type ChatMessageRow = {
  id: string
  role: string
  content: string
  created_at: string | null
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status })
}

function createErrorResponse(status: number, error: string) {
  return jsonResponse({ success: false, error }, status)
}

function createHttpError(status: number, message: string) {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

function getRequiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getOptionalUuid(value: unknown) {
  return typeof value === 'string' && isValidUuid(value.trim()) ? value.trim() : null
}

function createSessionTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function toHistoryTurn(row: ChatMessageRow): ChatHistoryTurn | null {
  if (row.role !== 'user' && row.role !== 'assistant') return null
  if (!row.content.trim()) return null
  return { role: row.role, content: row.content }
}

async function getLessonPlanText(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  fileId: string
}): Promise<string | null> {
  const { supabase, userId, fileId } = params

  const { data: fileRow, error } = await supabase
    .from('files')
    .select('storage_path, original_name, user_id')
    .eq('file_id', fileId)
    .maybeSingle()

  if (error || !fileRow || fileRow.user_id !== userId) return null

  const { data, error: downloadError } = await supabase.storage
    .from(UPLOADED_FILES_BUCKET)
    .download(fileRow.storage_path)

  if (downloadError || !data) return null

  try {
    const buffer = Buffer.from(await data.arrayBuffer())
    return await extractTextFromPdf(buffer)
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    let body: ChatMessageRequest

    try {
      body = (await request.json()) as ChatMessageRequest
    } catch {
      return createErrorResponse(400, 'Request body must be valid JSON.')
    }

    const sessionId = getRequiredString(body.sessionId)
    const message = getRequiredString(body.message)
    const fileId = getOptionalUuid(body.fileId)

    if (!sessionId || !isValidUuid(sessionId)) {
      return createErrorResponse(400, 'sessionId must be a valid UUID.')
    }

    if (!message) {
      return createErrorResponse(400, 'message must be a non-empty string.')
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return createErrorResponse(401, 'Unauthorized.')
    }

    // Fetch lesson plan text if fileId provided (do this before upserting session so we have the filename for the title)
    let lessonPlanText: string | null = null

    if (fileId) {
      lessonPlanText = await getLessonPlanText({ supabase, userId: user.id, fileId })
    }

    // Upsert the session. On first message, also set file_id if provided.
    const { error: upsertSessionError } = await supabase
      .from('chat_sessions')
      .upsert(
        {
          id: sessionId,
          user_id: user.id,
          title: createSessionTitle(message),
          ...(fileId ? { file_id: fileId } : {}),
        },
        { onConflict: 'id', ignoreDuplicates: true }
      )

    if (upsertSessionError) {
      throw createHttpError(500, 'Failed to save chat session.')
    }

    const { data: chatSession, error: sessionError } = await supabase
      .from('chat_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (sessionError) throw createHttpError(500, 'Failed to load chat session.')
    if (!chatSession) return createErrorResponse(404, 'Chat session not found.')

    const { data: historyRows, error: historyError } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MAX_MODEL_HISTORY_MESSAGES)

    if (historyError) throw createHttpError(500, 'Failed to load chat history.')

    const history = ((historyRows ?? []) as ChatMessageRow[])
      .reverse()
      .map(toHistoryTurn)
      .filter((turn): turn is ChatHistoryTurn => Boolean(turn))

    // Persist user message before the LLM call so a failed generation still leaves an auditable user message.
    const { data: userMessageRow, error: userMessageError } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, role: 'user', content: message })
      .select('id')
      .single()

    if (userMessageError || !userMessageRow) {
      throw createHttpError(500, 'Failed to save user message.')
    }

    const assistantMessage = await getChatResponseFromRag({
      message,
      history,
      lessonPlanText: lessonPlanText ?? undefined,
    })

    const { data: assistantMessageRow, error: assistantMessageError } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, role: 'assistant', content: assistantMessage })
      .select('id')
      .single()

    if (assistantMessageError || !assistantMessageRow) {
      throw createHttpError(500, 'Failed to save assistant message.')
    }

    return jsonResponse(
      {
        success: true,
        sessionId,
        assistantMessage,
        userMessageId: userMessageRow.id,
        assistantMessageId: assistantMessageRow.id,
      },
      200
    )
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as HttpError).status === 'number'
        ? (error as HttpError).status!
        : 500
    const message =
      status === 500
        ? 'Failed to generate chat response.'
        : error instanceof Error
          ? error.message
          : 'Failed to generate chat response.'

    console.error('Error in POST /api/chat/message:', error)
    return createErrorResponse(status, message)
  }
}
