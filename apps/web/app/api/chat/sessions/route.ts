import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/feedback/feedback-route-auth'

const PREVIEW_LENGTH = 120

export type ChatSessionHistoryItem = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessagePreview: string | null
}

function truncatePreview(content: string | null): string | null {
  if (!content) {
    return null
  }

  if (content.length <= PREVIEW_LENGTH) {
    return content
  }

  return `${content.slice(0, PREVIEW_LENGTH)}…`
}

/**
 * GET /api/chat/sessions[?fileId=uuid]
 * Returns chat sessions owned by the logged-in user.
 * When fileId is provided, returns only sessions linked to that lesson plan.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('fileId')

    const supabase = await createClient()
    const session = await getSessionUser(supabase)

    if (!session.ok) {
      return session.response
    }

    let query = supabase
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('user_id', session.user.id)
      .order('updated_at', { ascending: false })

    if (fileId) {
      query = query.eq('file_id', fileId)
    }

    const { data: sessions, error: sessionsError } = await query

    if (sessionsError) {
      console.error('GET /api/chat/sessions:', sessionsError)
      return Response.json(
        { error: 'Failed to load chat sessions.' },
        { status: 500 }
      )
    }

    if (!sessions || sessions.length === 0) {
      return Response.json({ sessions: [] })
    }

    const sessionIds = sessions.map((chatSession) => chatSession.id as string)

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('session_id, content, created_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false })

    if (messagesError) {
      console.error('GET /api/chat/sessions messages:', messagesError)
      return Response.json(
        { error: 'Failed to load chat sessions.' },
        { status: 500 }
      )
    }

    const latestMessageBySessionId = new Map<string, string>()

    for (const message of messages ?? []) {
      const sessionId = message.session_id as string

      if (!latestMessageBySessionId.has(sessionId)) {
        latestMessageBySessionId.set(sessionId, message.content as string)
      }
    }

    const items: ChatSessionHistoryItem[] = sessions.map((chatSession) => {
      const id = chatSession.id as string

      return {
        id,
        title: chatSession.title as string | null,
        createdAt: chatSession.created_at as string,
        updatedAt: chatSession.updated_at as string,
        lastMessagePreview: truncatePreview(
          latestMessageBySessionId.get(id) ?? null
        ),
      }
    })

    return Response.json({ sessions: items })
  } catch (error) {
    console.error('GET /api/chat/sessions:', error)
    return Response.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
