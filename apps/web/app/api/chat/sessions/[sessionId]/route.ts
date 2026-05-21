import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/feedback/feedback-route-auth'

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

export type ChatMessageItem = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/**
 * GET /api/chat/sessions/:sessionId
 * Returns one owned chat session and all of its messages.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params

    if (!sessionId || !isValidUuid(sessionId)) {
      return Response.json({ error: 'Invalid sessionId.' }, { status: 400 })
    }

    const supabase = await createClient()
    const session = await getSessionUser(supabase)

    if (!session.ok) {
      return session.response
    }

    const { data: chatSession, error: sessionError } = await supabase
      .from('chat_sessions')
      .select('id, user_id, title, created_at, updated_at')
      .eq('id', sessionId)
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (sessionError) {
      console.error('GET /api/chat/sessions/[sessionId]:', sessionError)
      return Response.json(
        { error: 'Failed to load chat session.' },
        { status: 500 }
      )
    }

    if (!chatSession) {
      return Response.json(
        { error: 'Chat session not found.' },
        { status: 404 }
      )
    }

    if ((chatSession.user_id as string) !== session.user.id) {
      return Response.json(
        { error: 'Chat session not found.' },
        { status: 404 }
      )
    }

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error('GET /api/chat/sessions/[sessionId] messages:', messagesError)
      return Response.json(
        { error: 'Failed to load chat messages.' },
        { status: 500 }
      )
    }

    const items: ChatMessageItem[] = (messages ?? []).map((message) => ({
      id: message.id as string,
      role: message.role as 'user' | 'assistant',
      content: message.content as string,
      createdAt: message.created_at as string,
    }))

    return Response.json({
      session: {
        id: chatSession.id as string,
        title: chatSession.title as string | null,
        createdAt: chatSession.created_at as string,
        updatedAt: chatSession.updated_at as string,
      },
      messages: items,
    })
  } catch (error) {
    console.error('GET /api/chat/sessions/[sessionId]:', error)
    return Response.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
